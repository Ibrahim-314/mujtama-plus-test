/* Optional Meilisearch adapter (Phase 22). Used only when MEILI_URL is set; the built-in index stays
 * up to date as the fallback. Documents carry both the original text (for display/highlighting) and the
 * Arabic-normalised text (`norm`), and queries are normalised the same way, so hamza/tashkeel/taa marbuta
 * variants meet even before Meilisearch's own Arabic tokenizer (charabia) and typo tolerance apply.
 * Zero dependencies: plain fetch against the REST API. */
const A = require("./arabic");
/** @param {{ url: string, key?: string|null, index?: string, fetchImpl?: typeof fetch, log?: Pick<Console, "error"|"warn"> }} o */
function createMeili({ url, key, index = "mp_docs", fetchImpl = fetch, log = console }) {
  const base = url.replace(/\/$/, "");
  const call = async (method, path, body) => {
    const r = await fetchImpl(base + path, { method, headers: { "Content-Type": "application/json", ...(key ? { Authorization: "Bearer " + key } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(`meili ${method} ${path} → ${r.status}`);
    return r.status === 204 ? {} : r.json();
  };
  const uid = (kind, id) => `${kind}__${id}`.replace(/[^A-Za-z0-9_-]/g, "_");
  let ready = null;
  async function setup() {
    return (ready ||= (async () => {
      await call("POST", "/indexes", { uid: index, primaryKey: "uid" }).catch(() => { });
      await call("PATCH", `/indexes/${index}/settings`, {
        searchableAttributes: ["title", "norm", "body"],
        filterableAttributes: ["kind", "ptype", "community", "lang", "ts", "visibility"],
        sortableAttributes: ["ts"],
        typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 } }
      });
    })().catch(e => { ready = null; throw e; }));
  }
  return {
    name: "meilisearch",
    async index(doc) {
      await setup();
      await call("POST", `/indexes/${index}/documents`, [{ uid: uid(doc.kind, doc.id), id: doc.id, kind: doc.kind, title: doc.title || "", body: doc.body || "", norm: A.normalize(`${doc.title || ""} ${doc.body || ""}`), ptype: doc.ptype || null, community: doc.community || null, lang: doc.lang || null, visibility: doc.visibility || "public", ts: Date.parse(doc.created_at) || 0 }]);
    },
    async remove(kind, id) { await setup(); await call("DELETE", `/indexes/${index}/documents/${uid(kind, id)}`); },
    /** ids ordered by relevance
     * @param {string} q @param {{ kinds?: string[], ptype?: string, community?: string, lang?: string, from?: string, to?: string, limit?: number }} [o]
     * @returns {Promise<{ kind: string, id: string }[]>} */
    async search(q, { kinds, ptype, community, lang, from, to, limit = 60 } = {}) {
      await setup();
      const f = [];
      if (kinds?.length) f.push(`kind IN [${kinds.map(k => JSON.stringify(k)).join(",")}]`);
      if (ptype) f.push(`ptype = ${JSON.stringify(ptype)}`);
      if (community) f.push(`community = ${JSON.stringify(community)}`);
      if (lang) f.push(`lang = ${JSON.stringify(lang)}`);
      if (from) f.push(`ts >= ${Date.parse(from)}`);
      if (to) f.push(`ts <= ${Date.parse(to)}`);
      const r = await call("POST", `/indexes/${index}/search`, { q: A.normalize(q), limit, filter: f.length ? f.join(" AND ") : undefined, attributesToRetrieve: ["id", "kind"] });
      return (r.hits || []).map(h => ({ kind: h.kind, id: h.id }));
    },
    async health() { try { await call("GET", "/health"); return true; } catch (e) { log.error?.("meili health", { err: e.message }); return false; } }
  };
}
module.exports = { createMeili };
