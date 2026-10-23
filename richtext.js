/* مجتمع بلس — Rich text (Phases 11–12). One module shared by the browser and the server.
 * Content is stored as a presentation-independent document:
 *   { v: 1, blocks: [ { id, t, r?, items?, lang?, text?, media?, alt?, caption?, rows? } ] }
 *   t ∈ p | h2 | h3 | quote | code | ul | ol | img | table | hr
 *   r (runs) = [[text, marks?, href?]]  marks ⊂ "bisc" (bold, italic, strike, code)
 * Authors write lightweight Markdown; parse() turns it into a document, validate() sanitises any
 * document coming from a client, and toHTML()/toText()/toMarkdown() render it back out. */
(function (root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(); else root.RichText = factory(); })(typeof self !== "undefined" ? self : this, function () {
  const TYPES = ["p", "h2", "h3", "quote", "code", "ul", "ol", "img", "table", "hr"];
  const MAX_BLOCKS = 600, MAX_TEXT = 60000;
  const esc = (s = "") => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => { try { const x = new URL(u, "https://x.invalid"); return ["http:", "https:"].includes(x.protocol) && /^https?:\/\//.test(u) ? u.slice(0, 500) : null; } catch { return null; } };
  const safeMedia = (m) => typeof m === "string" && /^\/media\/[\w.-]{6,100}$/.test(m) ? m : null;
  let seq = 0; const bid = () => "b" + Date.now().toString(36).slice(-4) + (seq++).toString(36);

  /* ---- inline: **bold** *italic* _italic_ ~~strike~~ `code` [label](https://…) ---- */
  function inline(src) {
    const runs = []; let i = 0, buf = "";
    const flush = () => { if (buf) { runs.push([buf]); buf = ""; } };
    const tryMark = (open, close, mark) => {
      if (!src.startsWith(open, i)) return false;
      const end = src.indexOf(close, i + open.length); if (end <= i + open.length) return false;
      const inner = src.slice(i + open.length, end); if (/^\s|\s$/.test(inner) && mark !== "c") return false;
      flush();
      if (mark === "c") runs.push([inner, "c"]);
      else for (const r of inline(inner)) runs.push([r[0], [...new Set(((r[1] || "") + mark).split(""))].join(""), r[2]].filter((x, k) => k === 0 || x));
      i = end + close.length; return true;
    };
    while (i < src.length) {
      if (src[i] === "\\" && i + 1 < src.length) { buf += src[i + 1]; i += 2; continue; }
      if (tryMark("`", "`", "c") || tryMark("**", "**", "b") || tryMark("~~", "~~", "s") || tryMark("*", "*", "i") || (/[\s(]|^$/.test(src[i - 1] || "") && tryMark("_", "_", "i"))) continue;
      if (src[i] === "[") { const m = /^\[([^\]]{1,200})\]\((https?:\/\/[^\s)]{1,500})\)/.exec(src.slice(i)); if (m && safeUrl(m[2])) { flush(); runs.push([m[1], "", m[2]]); i += m[0].length; continue; } }
      buf += src[i++];
    }
    flush();
    return runs.map(r => r[2] ? r : r[1] ? [r[0], r[1]] : [r[0]]);
  }
  const runsText = (r = []) => r.map(x => x[0]).join("");

  /* ---- block parser ---- */
  function parse(md = "") {
    const lines = String(md).replace(/\r\n?/g, "\n").slice(0, MAX_TEXT).split("\n"); const blocks = []; let i = 0;
    const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l || "");
    const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map(c => inline(c.trim()));
    while (i < lines.length && blocks.length < MAX_BLOCKS) {
      const l = lines[i];
      if (!l.trim()) { i++; continue; }
      let m;
      if ((m = /^```\s*([\w+-]{0,20})\s*$/.exec(l))) { const body = []; i++; while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]); i++; blocks.push({ id: bid(), t: "code", lang: m[1] || "", text: body.join("\n") }); continue; }
      if ((m = /^(#{1,3})\s+(.+)$/.exec(l))) { blocks.push({ id: bid(), t: m[1].length >= 2 ? "h3" : "h2", r: inline(m[2].trim()) }); i++; continue; }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { blocks.push({ id: bid(), t: "hr" }); i++; continue; }
      if ((m = /^!\[([^\]]{0,300})\]\((\/media\/[\w.-]{6,100})\)\s*(.*)$/.exec(l.trim()))) { blocks.push({ id: bid(), t: "img", media: m[2], alt: m[1], caption: m[3] || "" }); i++; continue; }
      if (/^\s*\|/.test(l) && isTableSep(lines[i + 1])) { const rows = [cells(l)]; i += 2; while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++])); blocks.push({ id: bid(), t: "table", rows: rows.slice(0, 60).map(r => r.slice(0, 10)) }); continue; }
      if (/^>\s?/.test(l)) { const body = []; while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, "")); blocks.push({ id: bid(), t: "quote", r: inline(body.join(" ")) }); continue; }
      if (/^\s*[-*•]\s+/.test(l)) { const items = []; while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) items.push(inline(lines[i++].replace(/^\s*[-*•]\s+/, ""))); blocks.push({ id: bid(), t: "ul", items: items.slice(0, 100) }); continue; }
      if (/^\s*[0-9٠-٩]+[.)]\s+/.test(l)) { const items = []; while (i < lines.length && /^\s*[0-9٠-٩]+[.)]\s+/.test(lines[i])) items.push(inline(lines[i++].replace(/^\s*[0-9٠-٩]+[.)]\s+/, ""))); blocks.push({ id: bid(), t: "ol", items: items.slice(0, 100) }); continue; }
      const body = []; while (i < lines.length && lines[i].trim() && !/^(```|#{1,3}\s|>|\s*[-*•]\s|\s*[0-9٠-٩]+[.)]\s|!\[|\s*(-{3,}|\*{3,})\s*$)/.test(lines[i]) && !(/^\s*\|/.test(lines[i]) && isTableSep(lines[i + 1]))) body.push(lines[i++]);
      blocks.push({ id: bid(), t: "p", r: inline(body.join("\n")) });
    }
    return { v: 1, blocks };
  }

  /* ---- sanitise a document from an untrusted client ---- */
  function cleanRuns(r) {
    if (!Array.isArray(r)) return [];
    return r.slice(0, 400).map(x => { if (!Array.isArray(x) || typeof x[0] !== "string") return null; const marks = typeof x[1] === "string" ? [...new Set(x[1].replace(/[^bisc]/g, "").split(""))].join("") : ""; const href = x[2] ? safeUrl(String(x[2])) : null; return href ? [x[0].slice(0, 5000), marks, href] : marks ? [x[0].slice(0, 5000), marks] : [x[0].slice(0, 5000)]; }).filter(Boolean);
  }
  function validate(doc) {
    if (!doc || typeof doc !== "object" || !Array.isArray(doc.blocks)) return null;
    const out = []; const ids = new Set();
    for (const b of doc.blocks.slice(0, MAX_BLOCKS)) {
      if (!b || !TYPES.includes(b.t)) continue;
      const id = typeof b.id === "string" && /^[\w-]{1,24}$/.test(b.id) && !ids.has(b.id) ? b.id : bid(); ids.add(id);
      const o = { id, t: b.t };
      if (["p", "h2", "h3", "quote"].includes(b.t)) o.r = cleanRuns(b.r);
      if (["ul", "ol"].includes(b.t)) o.items = (Array.isArray(b.items) ? b.items : []).slice(0, 100).map(cleanRuns);
      if (b.t === "code") { o.text = String(b.text || "").slice(0, 20000); o.lang = String(b.lang || "").replace(/[^\w+-]/g, "").slice(0, 20); }
      if (b.t === "img") { o.media = safeMedia(b.media); if (!o.media) continue; o.alt = String(b.alt || "").slice(0, 300); o.caption = String(b.caption || "").slice(0, 300); }
      if (b.t === "table") o.rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 60).map(row => (Array.isArray(row) ? row : []).slice(0, 10).map(cleanRuns));
      out.push(o);
    }
    return { v: 1, blocks: out };
  }

  /* ---- renderers ---- */
  function runsHTML(r = []) {
    return r.map(([t, m = "", href]) => {
      let h = esc(t).replace(/\n/g, "<br>");
      if (m.includes("c")) h = `<code>${h}</code>`; if (m.includes("b")) h = `<strong>${h}</strong>`; if (m.includes("i")) h = `<em>${h}</em>`; if (m.includes("s")) h = `<s>${h}</s>`;
      if (href) h = `<a href="${esc(href)}" target="_blank" rel="noopener nofollow ugc">${h}</a>`;
      return h;
    }).join("");
  }
  function toHTML(doc, opts = {}) {
    if (!doc || !doc.blocks) return "";
    const media = opts.media || ((m) => m), anchors = !!opts.anchors, counts = opts.counts || {};
    return doc.blocks.map(b => {
      const a = anchors ? ` id="${esc(b.id)}" data-block="${esc(b.id)}"` : "";
      const badge = anchors && counts[b.id] ? `<button class="para-c" data-para="${esc(b.id)}" aria-label="${counts[b.id]} تعليق">${counts[b.id]}</button>` : anchors && ["p", "quote"].includes(b.t) ? `<button class="para-c empty" data-para="${esc(b.id)}" aria-label="علّق على الفقرة">+</button>` : "";
      switch (b.t) {
        case "p": return `<p${a}>${runsHTML(b.r)}${badge}</p>`;
        case "h2": return `<h2${a}>${runsHTML(b.r)}</h2>`;
        case "h3": return `<h3${a}>${runsHTML(b.r)}</h3>`;
        case "quote": return `<blockquote${a}>${runsHTML(b.r)}${badge}</blockquote>`;
        case "code": return `<pre${a} dir="ltr"><code${b.lang ? ` class="lang-${esc(b.lang)}"` : ""}>${esc(b.text)}</code></pre>`;
        case "ul": case "ol": return `<${b.t}${a}>${b.items.map(it => `<li>${runsHTML(it)}</li>`).join("")}</${b.t}>`;
        case "hr": return `<hr${a}>`;
        case "img": return `<figure${a}><img src="${esc(media(b.media))}" alt="${esc(b.alt)}" loading="lazy" decoding="async">${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}</figure>`;
        case "table": return `<div class="tbl"${a}><table>${b.rows.map((row, i) => `<tr>${row.map(c => i === 0 ? `<th>${runsHTML(c)}</th>` : `<td>${runsHTML(c)}</td>`).join("")}</tr>`).join("")}</table></div>`;
        default: return "";
      }
    }).join("\n");
  }
  function toText(doc) {
    if (!doc || !doc.blocks) return "";
    return doc.blocks.map(b => b.r ? runsText(b.r) : b.items ? b.items.map(runsText).join("\n") : b.t === "code" ? b.text : b.t === "img" ? (b.alt || "") : b.t === "table" ? b.rows.map(r => r.map(runsText).join(" | ")).join("\n") : "").filter(Boolean).join("\n\n");
  }
  function runsMd(r = []) { return r.map(([t, m = "", href]) => { let s = t; if (m.includes("c")) s = "`" + s + "`"; if (m.includes("b")) s = `**${s}**`; if (m.includes("i")) s = `*${s}*`; if (m.includes("s")) s = `~~${s}~~`; return href ? `[${s}](${href})` : s; }).join(""); }
  function toMarkdown(doc) {
    if (!doc || !doc.blocks) return "";
    return doc.blocks.map(b => ({ p: () => runsMd(b.r), h2: () => "# " + runsMd(b.r), h3: () => "## " + runsMd(b.r), quote: () => "> " + runsMd(b.r), code: () => "```" + (b.lang || "") + "\n" + b.text + "\n```",
      ul: () => b.items.map(i => "- " + runsMd(i)).join("\n"), ol: () => b.items.map((i, k) => `${k + 1}. ` + runsMd(i)).join("\n"), hr: () => "---",
      img: () => `![${b.alt || ""}](${b.media})${b.caption ? " " + b.caption : ""}`, table: () => b.rows.map((r, i) => "| " + r.map(runsMd).join(" | ") + " |" + (i === 0 ? "\n|" + r.map(() => " --- |").join("") : "")).join("\n") }[b.t] || (() => ""))()).join("\n\n");
  }
  /* reading time: ~200 Arabic words/min, +12s per image */
  function readingMinutes(doc) { const words = toText(doc).split(/\s+/).filter(Boolean).length; const imgs = (doc?.blocks || []).filter(b => b.t === "img").length; return Math.max(1, Math.round(words / 200 + imgs * 0.2)); }
  function toc(doc) { return (doc?.blocks || []).filter(b => b.t === "h2" || b.t === "h3").map(b => ({ id: b.id, level: b.t === "h2" ? 2 : 3, text: runsText(b.r) })); }
  const isRich = (doc) => !!doc && doc.blocks.some(b => b.t !== "p" || (b.r || []).some(r => r[1] || r[2]));
  return { parse, validate, toHTML, toText, toMarkdown, readingMinutes, toc, inline, isRich, esc };
});
