/* v2.128 search stage 5 — X-style search operators, parsed out of the query box:
 *   from:@handle  to:@handle (mentions)  @handle  #وسم  "عبارة دقيقة"  -كلمة  -"عبارة"  word OR word (kept for the engine)
 *   since:2026-01-31  until:2026-02-28  min_faves:10  min_replies:3  lang:ar|en  near:جدة
 *   filter:media|images|videos|links|questions|polls|articles|quotes   (-filter:… excludes)
 * Arabic aliases: من: ، إلى: ، منذ: ، حتى: ، قرب: . Unknown «x:y» stays as text. Returns the free text left for the engine. */
const OPS = { from: "from", "من": "from", to: "to", "إلى": "to", "الى": "to", since: "since", "منذ": "since", until: "until", "حتى": "until",
  min_faves: "minFaves", min_likes: "minFaves", min_replies: "minReplies", min_comments: "minReplies", lang: "lang", near: "near", "قرب": "near", filter: "filter" };
const FILTERS = ["media", "images", "videos", "links", "questions", "polls", "articles", "quotes"];
const day = (s) => { const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))); if (!m) return null; const t = Date.UTC(+m[1], +m[2] - 1, +m[3]); return isNaN(t) ? null : t; };
const handle = (s) => String(s || "").replace(/^@/, "").toLowerCase().replace(/[^\w.]/g, "").slice(0, 40);
function parse(raw) {
  const ops = { from: [], to: [], mention: [], tags: [], phrases: [], exclude: [], excludePhrases: [], filters: [], notFilters: [], since: null, until: null, minFaves: 0, minReplies: 0, lang: null, near: null };
  let s = String(raw || "");
  s = s.replace(/(^|\s)(-?)"([^"]{1,80})"/g, (_, sp, neg, ph) => { (neg ? ops.excludePhrases : ops.phrases).push(ph.trim()); return sp + (neg ? "" : ph); }); // the phrase's words still feed retrieval
  s = s.replace(/[«»]/g, '"');
  const words = s.split(/\s+/).filter(Boolean), text = [];
  // a lone «@handle» or «#tag» keeps its classic meaning (find that person / that tag in every group), not an operator
  if (words.length === 1 && /^[@#][^\s@#]{1,60}$/.test(words[0]) && !ops.phrases.length && !ops.excludePhrases.length) return { text: String(raw).trim(), ops, active: false };
  for (const w of words) {
    const m = /^(-?)([\p{L}_]+):(.+)$/u.exec(w);
    if (m && OPS[m[2].toLowerCase()]) {
      const k = OPS[m[2].toLowerCase()], v = m[3], neg = !!m[1];
      if (k === "from" || k === "to") { const h = handle(v); if (h) ops[k].push(h); }
      else if (k === "since" || k === "until") { const t = day(v); if (t != null) ops[k] = new Date(k === "until" ? t + 864e5 - 1 : t).toISOString(); }
      else if (k === "minFaves" || k === "minReplies") ops[k] = Math.max(0, Math.min(1e6, parseInt(v, 10) || 0));
      else if (k === "lang") { if (["ar", "en"].includes(v.toLowerCase())) ops.lang = v.toLowerCase(); }
      else if (k === "near") ops.near = v.replace(/_/g, " ").slice(0, 60);
      else if (k === "filter") { const fl = v.toLowerCase(); if (FILTERS.includes(fl)) (neg ? ops.notFilters : ops.filters).push(fl); }
      continue;
    }
    if (/^-[^\s-]/.test(w) && w.length > 2) { ops.exclude.push(w.slice(1)); continue; }
    if (/^@[\w.]{2,40}$/.test(w)) { ops.mention.push(handle(w)); continue; }
    if (/^#[^\s#]{1,60}$/.test(w)) { ops.tags.push(w.slice(1)); continue; } // a tag is a filter (post_hashtags), not free text
    text.push(w);
  }
  const active = !!(ops.from.length || ops.to.length || ops.mention.length || ops.tags.length || ops.phrases.length || ops.exclude.length || ops.excludePhrases.length ||
    ops.filters.length || ops.notFilters.length || ops.since || ops.until || ops.minFaves || ops.minReplies || ops.lang || ops.near);
  return { text: text.join(" ").replace(/\s+/g, " ").trim(), ops, active };
}
module.exports = { parse, FILTERS };
