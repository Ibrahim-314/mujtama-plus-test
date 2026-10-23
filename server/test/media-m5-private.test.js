/* v2.60 M5: media of posts in PRIVATE / invite-only communities is members-only on /media/.
 * member / owner / site admin → 200 (+Range 206, HEAD) with Cache-Control: private, no-store;
 * non-member, pending, banned, logged-out → 404 (never 403: existence is not leaked);
 * media of public posts → unchanged (200 logged-out, public immutable cache). */
const test = require("node:test"), assert = require("node:assert"), crypto = require("node:crypto");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
process.env.LOG_SILENT = "1";
const { createApp } = require("../server");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mp-m5-"));
let app, base;
const png = (n) => Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), crypto.randomBytes(n)]);
class Client {
  constructor() { this.cookie = ""; }
  async req(method, p, body) {
    const r = await fetch(base + p, { method, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json", Cookie: this.cookie, Origin: base }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  }
  async raw(p, buf) { const r = await fetch(base + p, { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "application/octet-stream", Cookie: this.cookie, Origin: base }, body: buf }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }
  get(p, headers = {}, method = "GET") { return fetch(base + p, { method, headers: { Cookie: this.cookie, ...headers } }); }
}
const O = new Client(), M = new Client(), N = new Client(), P = new Client(), ADM = new Client(), ANON = new Client();
const ids = {};
test.before(async () => {
  app = await createApp({ databaseUrl: "sqlite:" + path.join(tmp, "db.sqlite"), storageDir: path.join(tmp, "st"), storageDriver: "db", seedDemo: false, queuePollMs: 100 });
  await new Promise(r => app.server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + app.server.address().port;
  for (const [c, h] of [[O, "m5owner"], [M, "m5member"], [N, "m5outsider"], [P, "m5pending"], [ADM, "m5admin"]]) {
    const r = await c.req("POST", "/api/auth/register", { name: "مستخدم " + h, handle: h, password: "secret123" }); assert.equal(r.status, 200, r.error); ids[h] = r.user.id;
  }
  await app.ctx.db.run("UPDATE users SET role='admin' WHERE id=$1", [ids.m5admin]);
});
test.after(() => app.close());

const expect404 = async (c, u, label) => { const r = await c.get(u); assert.equal(r.status, 404, label); await r.arrayBuffer(); const rr = await c.get(u, { Range: "bytes=0-9" }); assert.equal(rr.status, 404, label + " (Range)"); await rr.arrayBuffer(); const h = await c.get(u, {}, "HEAD"); assert.equal(h.status, 404, label + " (HEAD)"); };

test("private community media: members only, 404 for everyone else; public media unchanged", async () => {
  const pc = (await O.req("POST", "/api/communities", { name: "نادي خاص للوسائط", type: "private" })).community.id;
  await app.ctx.db.run("INSERT INTO memberships(community,user_id,role,joined_at,status) VALUES($1,$2,'member',$3,'active')", [pc, ids.m5member, new Date().toISOString()]);
  await app.ctx.db.run("INSERT INTO memberships(community,user_id,role,joined_at,status) VALUES($1,$2,'pending',$3,'pending')", [pc, ids.m5pending, new Date().toISOString()]);
  const img = png(4000), size = img.length;
  const up = await O.raw("/api/media", img); assert.equal(up.status, 200, up.error);
  const u = up.media.url;
  const pre = await ANON.get(u); assert.equal(pre.status, 200, "before the post the upload is still plain media"); await pre.arrayBuffer(); // warms the gate cache with "public"
  const p = await O.req("POST", "/api/posts", { text: "صورة للأعضاء فقط", community: pc, images: [u] }); assert.equal(p.status, 200, p.error); // must invalidate it

  for (const [c, label] of [[M, "member"], [O, "community owner / uploader"], [ADM, "site admin"]]) {
    const r = await c.get(u); assert.equal(r.status, 200, label); assert.equal(r.headers.get("cache-control"), "private, no-store", label);
    assert.equal(r.headers.get("access-control-allow-origin"), null, label + ": no wildcard CORS on private media");
    assert.ok(Buffer.from(await r.arrayBuffer()).equals(img), label);
  }
  const rr = await M.get(u, { Range: "bytes=10-19" }); assert.equal(rr.status, 206); assert.equal(rr.headers.get("content-range"), `bytes 10-19/${size}`); assert.equal(rr.headers.get("cache-control"), "private, no-store");
  assert.ok(Buffer.from(await rr.arrayBuffer()).equals(img.subarray(10, 20)));
  const suf = await M.get(u, { Range: "bytes=-100" }); assert.equal(suf.status, 206); assert.equal(suf.headers.get("content-range"), `bytes ${size - 100}-${size - 1}/${size}`); await suf.arrayBuffer();
  const h = await M.get(u, {}, "HEAD"); assert.equal(h.status, 200); assert.equal(h.headers.get("content-length"), String(size)); assert.equal((await h.arrayBuffer()).byteLength, 0);

  await expect404(N, u, "non-member");
  await expect404(P, u, "pending member");
  await expect404(ANON, u, "logged-out");
  const body = await (await ANON.get(u)).json(); assert.equal(body.code, undefined, "no paid_locked / forbidden hint"); assert.equal(body.error, "غير موجود");

  // banned member loses access (after the short gate cache, which only caches the post lookup, not the viewer's role)
  await app.ctx.db.run("UPDATE memberships SET role='banned' WHERE community=$1 AND user_id=$2", [pc, ids.m5member]);
  await expect404(M, u, "banned member");
});

test("public media: 200 logged-out with the long public cache (unchanged)", async () => {
  const img = png(3000);
  const up = await ADM.raw("/api/media", img); assert.equal(up.status, 200, up.error);
  const pub = (await ADM.req("POST", "/api/communities", { name: "نادي عام للوسائط" })).community.id;
  assert.equal((await ADM.req("POST", "/api/posts", { text: "صورة عامة", community: pub, images: [up.media.url] })).status, 200);
  const r = await ANON.get(up.media.url); assert.equal(r.status, 200); assert.match(r.headers.get("cache-control"), /public, max-age=31536000, immutable/); await r.arrayBuffer();
  const rr = await ANON.get(up.media.url, { Range: "bytes=0-9" }); assert.equal(rr.status, 206); await rr.arrayBuffer();
  const o = await ANON.get("/media/md_doesnotexist1.png"); assert.equal(o.status, 404); await o.arrayBuffer();
});
