/* Developer portal «بوابة المطورين» (phase 47). Lazy chunk `dev`, loaded on demand by the `ai` chunk for #/developers, #/oauth and
 * #/settings (0 bytes in core). Contract: docs/integration/p47.md. No inline handlers (CSP); CSS lives in this chunk.
 * • #/developers            my apps (create), connected apps (revoke), links to docs/admin
 * • #/developers/app/<id>   client id, redirect URIs, scopes, rotate secret, API keys (create/rotate/revoke, shown once),
 *                            webhooks (+ test, delivery log, retry), bot (create, commands, install into a community), delete
 * • #/developers/docs       interactive Arabic docs rendered from /api/v1/openapi.json with «جرّبها» (try-it)
 * • #/developers/admin      all apps: suspend/activate, rate limit (admins)
 * • #/oauth?client_id=…     OAuth consent screen (GET /oauth/authorize redirects here) */
(function DevUI() {
  const api = (m, p, b) => Remote.api(m, p, b);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const T = (s) => (window.MPI18n ? window.MPI18n.t(s) : s);
  const signedIn = () => typeof Remote !== "undefined" && Remote.on && typeof DB !== "undefined" && DB.me;
  const fmt = (d) => (d ? new Date(d).toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" }) : "—");
  const st = document.createElement("style");
  st.textContent = `.dv .card{margin:0 0 var(--s3)}.dv .card>h3{display:flex;align-items:center;gap:8px;margin:0 0 var(--s2);font-size:var(--fs-lg)}.dv .card>h3 .ix{color:var(--accent)}.dv .app{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap;padding:var(--s2) 0;margin:0;border-top:1px solid var(--line)}.dv .app:first-of-type{border:0}.dv .app .grow{flex:1;min-width:0}#dv-mine summary{display:flex;align-items:center;gap:8px;font-weight:600;color:var(--accent-ink)}.dv code,.dv pre{direction:ltr;unicode-bidi:isolate;font-family:ui-monospace,monospace;font-size:12.5px}
.dv pre{white-space:pre-wrap;word-break:break-all;background:var(--line);padding:8px;border-radius:8px;max-height:320px;overflow:auto}
.dv .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.dv input,.dv textarea,.dv select{font:inherit;width:100%;box-sizing:border-box;margin:4px 0}
.dv .k{font-size:12px;color:var(--muted)}.dv .tag{display:inline-flex;align-items:center;border-radius:var(--r-pill);padding:1px 9px;font-size:var(--fs-xs);font-weight:600;margin:2px;background:var(--surface-sunken);color:var(--text-2)}
.dv .once{border:2px dashed var(--accent);padding:8px;border-radius:8px}.dv .m{font-weight:700;font-size:11px;padding:2px 6px;border-radius:6px;background:var(--accent);color:#fff;direction:ltr}
.dv details{border-top:1px solid var(--line);padding:8px 0}.dv summary{cursor:pointer}.dv label{display:block;margin:4px 0}
.dv input[type=checkbox]{width:20px;height:20px;margin:0;flex:none;accent-color:var(--accent)}.dv label:has(>input[type=checkbox]){display:flex;align-items:center;gap:10px;min-height:40px;margin:0}
.dv fieldset{border:1px solid var(--line);border-radius:var(--r-sm);padding:var(--s1) var(--s3) var(--s2);margin:var(--s3) 0}.dv legend{font-weight:700;font-size:var(--fs-sm);padding:0 6px;color:var(--text-2)}.dv form .btn{margin-top:var(--s2)}.dv .ok{color:var(--ok-ink)}.dv .bad{color:var(--danger)}`;
  document.head.appendChild(st);
  const box = () => { view.innerHTML = `<div class="wrap dv"></div>`; return view.querySelector(".dv"); };
  const on = (root, sel, ev, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, (e) => fn(e, el)));
  const fail = (e) => toast(e?.message || T("تعذّر التنفيذ"));
  const once = (label, value) => `<div class="once"><b>${esc(label)}</b><p class="k">${T("انسخه الآن؛ لن يظهر مرة أخرى.")}</p><pre>${esc(value)}</pre></div>`;
  let meta = null, reveal = null; // a secret shown once survives app re-renders until dismissed or the route changes
  const keep = (html) => { reveal = { h: location.hash, html: html + `<button class="btn ghost" type="button" data-gone>${T("نسختُه")}</button>` }; paint(); };
  const paint = () => { const t = document.getElementById("dv-once"); if (!t) return; t.innerHTML = reveal && reveal.h === location.hash ? reveal.html : ""; t.querySelector("[data-gone]")?.addEventListener("click", () => { reveal = null; paint(); }); };
  const loadMeta = async () => (meta ||= await api("GET", "/api/dev/meta"));
  const needLogin = (el) => { el.innerHTML = UI.empty({ title: T("سجّل الدخول للمتابعة."), action: `<a class="btn" href="#/settings">${T("تسجيل الدخول")}</a>` }); };
  const sub = (title, ico) => UI.pageHead({ back: ["#/developers", T("بوابة المطورين")], title, icon: ico });

  /* ---------- portal ---------- */
  async function portal() {
    const el = box();
    el.innerHTML = `${UI.pageHead({ back: ["#/settings", T("الإعدادات")], title: T("بوابة المطورين"), icon: "code", sub: T("ابنِ تطبيقات وبوتات فوق مجتمع+ عبر واجهة REST عامة وOAuth وWebhooks. لا يصل أي تطبيق إلى الرسائل الخاصة أو المحادثات المشفّرة أو محتوى المجتمعات الخاصة."),
      actions: `<a class="btn" href="#/developers/docs">${MPFeat.ico("book","sm")} ${T("الوثائق التفاعلية")}</a><a class="btn outline" href="/api/v1/openapi.json" target="_blank" rel="noopener">${MPFeat.ico("code","sm")} OpenAPI JSON</a>${DB.isAdmin ? `<a class="btn outline" href="#/developers/admin">${UI.icon("settings","sm")} ${T("إدارة التطبيقات")}</a>` : ""}` })}
      <div id="dv-once"></div><div id="dv-mine"></div><div id="dv-conn"></div>`;
    paint();
    if (!signedIn()) return needLogin(el.querySelector("#dv-mine"));
    const [m, apps, conns] = await Promise.all([loadMeta(), api("GET", "/api/dev/apps"), api("GET", "/api/dev/connections")]).catch((e) => (fail(e), []));
    if (!m) return;
    const mine = el.querySelector("#dv-mine");
    mine.innerHTML = `<div class="card"><h3>${MPFeat.ico("grid")}${T("تطبيقاتي")}</h3>${apps.apps.length ? apps.apps.map((a) => `<p class="app"><a class="grow" href="#/developers/app/${esc(a.id)}"><b>${esc(a.name)}</b></a> <span class="tag">${esc(a.status)}</span> <code>${esc(a.id)}</code></p>`).join("") : `<p class="k">${T("لا توجد تطبيقات بعد.")}</p>`}
      <details><summary>${UI.icon("plus","sm")} ${T("تطبيق جديد")}</summary><form id="dv-new"><label>${T("الاسم")}<input name="name" required minlength="2" maxlength="60"></label><label>${T("الوصف")}<input name="description" maxlength="300"></label>
      <label>${T("رابط الموقع")}<input name="homepage" type="url" dir="ltr"></label><label>${T("عناوين إعادة التوجيه (سطر لكل عنوان)")}<textarea name="uris" rows="2" dir="ltr" placeholder="https://example.com/callback"></textarea></label>
      <fieldset><legend>${T("الصلاحيات")}</legend>${m.userScopes.map((s) => `<label><input type="checkbox" name="scope" value="${s}" ${s === "read" ? "checked" : ""}> <code>${s}</code> — ${esc(m.scopes[s])}</label>`).join("")}</fieldset>
      <button class="btn" type="submit">${T("إنشاء")}</button></form></details></div>`;
    on(mine, "#dv-new", "submit", async (e, f) => {
      e.preventDefault();
      const fd = new FormData(f);
      try {
        const r = await api("POST", "/api/dev/apps", { name: fd.get("name"), description: fd.get("description"), homepage: fd.get("homepage") || undefined, redirectUris: String(fd.get("uris") || "").split(/\s+/).filter(Boolean), scopes: fd.getAll("scope") });
        f.reset();
        keep(`<p>${T("معرّف العميل")}: <code>${esc(r.app.id)}</code></p>${once(T("سرّ العميل"), r.clientSecret)}<a class="btn" href="#/developers/app/${esc(r.app.id)}">${T("إدارة التطبيق")}</a> `);
      } catch (err) { fail(err); }
    });
    const c = el.querySelector("#dv-conn");
    c.innerHTML = `<div class="card"><h3>${UI.icon("link")}${T("التطبيقات المتصلة بحسابي")}</h3>${conns.items.length ? conns.items.map((x) => `<p><b>${esc(x.name)}</b> ${x.scopes.map((s) => `<span class="tag" title="${esc(s.label)}">${esc(s.scope)}</span>`).join("")} <span class="k">${fmt(x.grantedAt)}</span> <button class="btn ghost" type="button" data-rv="${esc(x.app)}">${T("سحب الصلاحية")}</button></p>`).join("") : `<p class="k">${T("لم تمنح أي تطبيق صلاحية.")}</p>`}</div>`;
    on(c, "[data-rv]", "click", async (e, b) => { if (!confirm(T("سحب صلاحية هذا التطبيق؟"))) return; try { await api("DELETE", "/api/dev/connections/" + encodeURIComponent(b.dataset.rv)); toast(T("سُحبت الصلاحية")); portal(); } catch (err) { fail(err); } });
  }

  /* ---------- one app ---------- */
  async function appView(aid) {
    const el = box();
    if (!signedIn()) return needLogin(el);
    let a, m;
    try { [{ app: a }, m] = await Promise.all([api("GET", "/api/dev/apps/" + encodeURIComponent(aid)), loadMeta()]); } catch (e) { el.innerHTML = `<p>${esc(e.message)}</p>`; return; }
    const out = `<div id="dv-once"></div>`;
    el.innerHTML = `${sub(a.name, "grid")}<p><span class="sbadge ${a.status === "active" ? "ok" : "warn"}">${esc({ active: T("نشط"), suspended: T("موقوف") }[a.status] || a.status)}</span></p>${out}
    <div class="card"><p class="k">${T("معرّف العميل")}</p><pre>${esc(a.id)}</pre><p class="k">${T("السر")}: <code>${esc(a.secretHint)}</code> · ${T("حد المعدل")}: ${a.rateLimit}/${T("دقيقة")} · ${T("مستخدمون")}: ${a.users}</p>
      <form id="dv-edit"><label>${T("عناوين إعادة التوجيه")}<textarea name="uris" rows="2" dir="ltr">${esc(a.redirectUris.join("\n"))}</textarea></label>
      <fieldset><legend>${T("الصلاحيات")}</legend>${m.userScopes.map((s) => `<label><input type="checkbox" name="scope" value="${s}" ${a.scopes.includes(s) ? "checked" : ""}> <code>${s}</code></label>`).join("")}</fieldset>
      <button class="btn" type="submit">${T("حفظ")}</button> <button class="btn ghost" type="button" id="dv-rot">${T("تدوير السر")}</button> <button class="btn ghost bad" type="button" id="dv-del">${T("حذف التطبيق")}</button></form></div>
    <div class="card"><h3>${MPFeat.ico("code", "sm")} ${T("مفاتيح API")}</h3><p class="k">${T("المفتاح يعمل باسمك بالصلاحيات المختارة؛ يُخزَّن مشفّراً بدالة تجزئة ويظهر مرة واحدة.")}</p>
      ${a.keys.map((k) => `<p><b>${esc(k.name)}</b> <code>${esc(k.hint)}</code> ${k.scopes.map((s) => `<span class="tag">${esc(s)}</span>`).join("")} <span class="tag">${esc(k.status)}</span> <span class="k">${T("آخر استخدام")}: ${fmt(k.lastUsedAt)}</span>
        ${k.status === "active" ? `<button class="btn ghost" type="button" data-krot="${esc(k.id)}">${T("تدوير")}</button> <button class="btn ghost" type="button" data-kdel="${esc(k.id)}">${T("سحب")}</button>` : ""}</p>`).join("")}
      <form id="dv-key" class="row"><input name="name" placeholder="${T("اسم المفتاح")}" maxlength="40"> ${a.scopes.map((s) => `<label><input type="checkbox" name="scope" value="${s}" ${s === "read" ? "checked" : ""}> ${s}</label>`).join("")}<input name="rate" type="number" min="1" placeholder="${T("حد/دقيقة (اختياري)")}"><button class="btn" type="submit">${T("مفتاح جديد")}</button></form></div>
    <div class="card"><h3>${UI.icon("bell", "sm")} Webhooks</h3>${a.webhooks.map((w) => `<p><code>${esc(w.url)}</code> ${w.events.map((x) => `<span class="tag">${esc(x)}</span>`).join("")} <button class="btn ghost" type="button" data-wtest="${esc(w.id)}">${T("اختبار")}</button> <button class="btn ghost" type="button" data-wdel="${esc(w.id)}">${T("حذف")}</button></p>`).join("")}
      <form id="dv-wh"><input name="url" type="url" dir="ltr" placeholder="https://example.com/webhooks" required>${Object.entries(m.events).map(([k, v]) => `<label><input type="checkbox" name="ev" value="${k}"> <code>${k}</code> — ${esc(v)}</label>`).join("")}<button class="btn" type="submit">${T("إضافة")}</button></form>
      <p class="k">${T("التوقيع")}: <code>X-Mujtama-Signature: t=&lt;ts&gt;,v1=HMAC_SHA256(secret, ts + "." + body)</code> · ${T("إعادة المحاولة بتراجع أُسّي حتى 6 مرات")}</p>
      <details id="dv-log"><summary>${T("سجل التسليم")}</summary><div></div></details></div>
    <div class="card"><h3>${UI.icon("sparkle", "sm")} ${T("البوت")}</h3>${a.bot ? `<p>@${esc(a.bot.handle)} — ${esc(a.bot.name)}</p>
      <form id="dv-cmd"><label>${T("الأوامر المائلة (سطر لكل أمر: الاسم الوصف)")}<textarea name="cmds" rows="3" dir="auto">${esc(a.commands.map((c) => c.name + " " + c.description).join("\n"))}</textarea></label><button class="btn" type="submit">${T("حفظ الأوامر")}</button></form>
      <p class="k">${T("المجتمعات")}: ${a.installs.map((i) => `<span class="tag">${esc(i.name)} <button class="btn ghost" type="button" data-uninst="${esc(i.community)}" aria-label="${T("إزالة")}">×</button></span>`).join("") || "—"}</p>
      <form id="dv-inst" class="row"><input name="c" placeholder="${T("معرّف مجتمع عام تديره")}" dir="ltr" required><button class="btn ghost" type="submit">${T("تثبيت")}</button></form>
      <p class="k">${T("يحصل البوت على رمز عبر client_credentials ويستقبل bot.command وbot.mention. المجتمعات العامة فقط.")}</p>`
      : `<form id="dv-bot" class="row"><input name="handle" placeholder="mybot" dir="ltr" required pattern="[A-Za-z0-9_]{3,20}"><input name="name" placeholder="${T("اسم العرض")}"><button class="btn" type="submit">${T("إنشاء بوت")}</button></form><p class="k">${T("المعرّف ينتهي بـ bot")}</p>`}</div>`;
    paint();
    const showOnce = (html) => { keep(html); scrollTo(0, 0); };
    const act = (fn) => async (e, x) => { e.preventDefault?.(); try { await fn(e, x); } catch (err) { fail(err); } };
    const reload = () => appView(aid);
    on(el, "#dv-edit", "submit", act(async (e, f) => { const fd = new FormData(f); await api("PATCH", "/api/dev/apps/" + a.id, { redirectUris: String(fd.get("uris")).split(/\s+/).filter(Boolean), scopes: fd.getAll("scope") }); toast(T("حُفظ")); reload(); }));
    on(el, "#dv-rot", "click", act(async () => { if (!confirm(T("سيتوقف السر الحالي فوراً. متابعة؟"))) return; const r = await api("POST", `/api/dev/apps/${a.id}/secret`); showOnce(once(T("سرّ العميل الجديد"), r.clientSecret)); }));
    on(el, "#dv-del", "click", act(async () => { if (!confirm(T("حذف التطبيق وسحب كل مفاتيحه ورموزه؟"))) return; await api("DELETE", "/api/dev/apps/" + a.id); location.hash = "#/developers"; }));
    on(el, "#dv-key", "submit", act(async (e, f) => { const fd = new FormData(f); const r = await api("POST", `/api/dev/apps/${a.id}/keys`, { name: fd.get("name"), scopes: fd.getAll("scope"), rateLimit: +fd.get("rate") || undefined }); await reload(); showOnce(once(T("مفتاح API"), r.key)); }));
    on(el, "[data-krot]", "click", act(async (e, b) => { const r = await api("POST", `/api/dev/keys/${b.dataset.krot}/rotate`); await reload(); showOnce(once(T("المفتاح الجديد"), r.key)); }));
    on(el, "[data-kdel]", "click", act(async (e, b) => { if (!confirm(T("سحب المفتاح؟"))) return; await api("DELETE", "/api/dev/keys/" + b.dataset.kdel); reload(); }));
    on(el, "#dv-wh", "submit", act(async (e, f) => { const fd = new FormData(f); const r = await api("POST", `/api/dev/apps/${a.id}/webhooks`, { url: fd.get("url"), events: fd.getAll("ev") }); await reload(); showOnce(once(T("سرّ توقيع Webhook"), r.secret)); }));
    on(el, "[data-wdel]", "click", act(async (e, b) => { await api("DELETE", "/api/dev/webhooks/" + b.dataset.wdel); reload(); }));
    on(el, "[data-wtest]", "click", act(async (e, b) => { await api("POST", `/api/dev/webhooks/${b.dataset.wtest}/test`); toast(T("أُرسل حدث ping")); }));
    on(el, "#dv-log", "toggle", act(async (e, d) => {
      if (!d.open) return;
      const r = await api("GET", `/api/dev/apps/${a.id}/deliveries`);
      d.querySelector("div").innerHTML = r.items.length ? r.items.map((x) => `<p><span class="${x.status === "ok" ? "ok" : x.status === "failed" ? "bad" : ""}">${esc(x.status)}</span> <code>${esc(x.event)}</code> ${T("محاولات")}: ${x.attempts} ${x.lastCode ? "· " + x.lastCode : ""} ${x.lastError ? "· " + esc(x.lastError) : ""} <span class="k">${fmt(x.createdAt)}</span>${x.status !== "ok" ? ` <button class="btn ghost" type="button" data-retry="${esc(x.id)}">${T("إعادة")}</button>` : ""}</p>`).join("") : `<p class="k">${T("لا يوجد تسليم بعد")}</p>`;
      on(d, "[data-retry]", "click", act(async (ev, b) => { await api("POST", `/api/dev/deliveries/${b.dataset.retry}/retry`); toast(T("أُعيدت الجدولة")); }));
    }));
    on(el, "#dv-bot", "submit", act(async (e, f) => { const fd = new FormData(f); await api("POST", `/api/dev/apps/${a.id}/bot`, { handle: fd.get("handle"), name: fd.get("name") }); reload(); }));
    on(el, "#dv-cmd", "submit", act(async (e, f) => { const cmds = String(new FormData(f).get("cmds")).split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [n, ...d] = l.split(/\s+/); return { name: n, description: d.join(" ") }; }); await api("PATCH", "/api/dev/apps/" + a.id, { commands: cmds }); toast(T("حُفظ")); reload(); }));
    on(el, "#dv-inst", "submit", act(async (e, f) => { await api("POST", `/api/dev/apps/${a.id}/installs`, { community: new FormData(f).get("c").trim() }); reload(); }));
    on(el, "[data-uninst]", "click", act(async (e, b) => { await api("DELETE", `/api/dev/apps/${a.id}/installs/${encodeURIComponent(b.dataset.uninst)}`); reload(); }));
  }

  /* ---------- interactive docs (OpenAPI → Arabic page with try-it) ---------- */
  async function docs() {
    const el = box();
    el.innerHTML = `${sub(T("وثائق الواجهة البرمجية"), "book")}<div class="skel"></div>`;
    let s; try { s = await fetch("/api/v1/openapi.json").then((r) => r.json()); } catch (e) { return fail(e); }
    const ops = []; for (const [p, v] of Object.entries(s.paths)) for (const [m, op] of Object.entries(v)) ops.push({ p, m, op });
    const tags = [...new Set(ops.map((o) => o.op.tags[0]))];
    el.innerHTML = `${sub(s.info.title, "book")}<div class="card"><p>${esc(s.info.description)}</p>
      <p class="k">${T("المصادقة")}: <code>Authorization: Bearer mpk_… | mpa_…</code> · OAuth: <code>/oauth/authorize</code> + <code>/api/oauth/token</code> (PKCE S256) · ${T("حدود المعدل")}: <code>X-RateLimit-*</code></p>
      <label>${T("مفتاح للتجربة (يبقى في هذه الصفحة فقط)")}<input id="dv-tk" type="password" dir="ltr" autocomplete="off" placeholder="mpk_…"></label></div>
      ${tags.map((t) => `<div class="card"><h3>${esc(t)}</h3>${ops.filter((o) => o.op.tags[0] === t).map((o, i) => opHtml(o, t + i)).join("")}</div>`).join("")}
      <div class="card"><h3>${T("أحداث Webhooks")}</h3>${Object.entries(s["x-webhook-events"] || {}).map(([k, v]) => `<p><code>${esc(k)}</code> — ${esc(v)}</p>`).join("")}</div>`;
    on(el, "form[data-op]", "submit", async (e, f) => {
      e.preventDefault();
      const o = ops[+f.dataset.op], fd = new FormData(f), outEl = f.querySelector("pre");
      let path = o.p; const q = new URLSearchParams();
      for (const prm of o.op.parameters || []) { const v = String(fd.get("p_" + prm.name) || ""); if (!v) continue; if (prm.in === "path") path = path.replace("{" + prm.name + "}", encodeURIComponent(v)); else q.set(prm.name, v); }
      if (/\{/.test(path)) return toast(T("أكمل الحقول المطلوبة"));
      const tk = el.querySelector("#dv-tk").value.trim(), h = {}; if (tk) h.Authorization = "Bearer " + tk;
      let body; if (o.op.requestBody) { body = String(fd.get("body") || "{}"); h["Content-Type"] = "application/json"; try { JSON.parse(body); } catch { return toast(T("JSON غير صالح")); } }
      outEl.textContent = "…";
      try { // third-party style call: bearer only, no session cookie
        const r = await fetch(path + (q.toString() ? "?" + q : ""), { method: o.m.toUpperCase(), headers: h, body, credentials: "omit" });
        const txt = await r.text(); let pretty = txt; try { pretty = JSON.stringify(JSON.parse(txt), null, 2); } catch { /* raw */ }
        outEl.textContent = `HTTP ${r.status}  ${r.headers.get("x-ratelimit-remaining") != null ? "· remaining " + r.headers.get("x-ratelimit-remaining") : ""}\n` + pretty.slice(0, 20000);
      } catch (err) { outEl.textContent = String(err.message || err); }
    });
    function opHtml(o) {
      const i = ops.indexOf(o), ex = o.op.requestBody ? JSON.stringify(Object.fromEntries(Object.entries(Object.values(o.op.requestBody.content)[0].schema.properties || {}).filter(([k]) => (Object.values(o.op.requestBody.content)[0].schema.required || []).includes(k)).map(([k]) => [k, "…"])), null, 1) : "";
      return `<details><summary><span class="m">${o.m.toUpperCase()}</span> <code>${esc(o.p)}</code> — ${esc(o.op.summary)}${o.op["x-scope"] ? ` <span class="tag">${esc(o.op["x-scope"])}</span>` : ""}</summary>
        ${o.op.description ? `<p class="k">${esc(o.op.description)}</p>` : ""}<form data-op="${i}">${(o.op.parameters || []).map((p) => `<label><code>${esc(p.name)}</code> <span class="k">${p.in === "path" ? T("مطلوب") : esc(p.description || "")}</span><input name="p_${esc(p.name)}" dir="ltr" ${p.required ? "required" : ""}></label>`).join("")}
        ${o.op.requestBody ? `<label>${T("جسم الطلب")} (JSON)<textarea name="body" rows="4" dir="ltr">${esc(ex)}</textarea></label>` : ""}<button class="btn" type="submit">${UI.icon("play","sm")} ${T("جرّبها")}</button><pre aria-live="polite"></pre></form></details>`;
    }
  }

  /* ---------- admin ---------- */
  async function adminView() {
    const el = box();
    if (!DB.isAdmin) { el.innerHTML = `<p>${T("للإدارة فقط")}</p>`; return; }
    const [r, s] = await Promise.all([api("GET", "/api/dev/apps?all=1"), api("GET", "/api/admin/devapi/stats")]).catch((e) => (fail(e), []));
    if (!r) return;
    el.innerHTML = `${sub(T("إدارة التطبيقات والمفاتيح"), "settings")}<div class="card row"><span>${T("تطبيقات نشطة")}: <b>${s.apps}</b></span><span>${T("مفاتيح")}: <b>${s.keys}</b></span><span>${T("موافقات")}: <b>${s.grants}</b></span><span>${T("تسليم معلّق")}: <b>${s.pending}</b></span><span>${T("فاشل")}: <b>${s.failed}</b></span></div>
      ${r.apps.map((a) => `<div class="card"><b>${esc(a.name)}</b> <code>${esc(a.id)}</code> <span class="tag">${esc(a.status)}</span>${a.bot ? ` ${T("بوت")} @${esc(a.bot.handle)}` : ""}<div class="row">
        ${a.status === "revoked" ? "" : `<button class="btn ghost" type="button" data-st="${esc(a.id)}" data-v="${a.status === "active" ? "suspended" : "active"}">${a.status === "active" ? T("إيقاف") : T("تفعيل")}</button>`}
        <input type="number" min="1" value="${a.rateLimit}" data-rl="${esc(a.id)}" aria-label="${T("حد المعدل")}" style="width:110px"><button class="btn ghost" type="button" data-rls="${esc(a.id)}">${T("حفظ الحد")}</button><a class="btn ghost" href="#/developers/app/${esc(a.id)}">${T("تفاصيل")}</a></div></div>`).join("")}`;
    on(el, "[data-st]", "click", async (e, b) => { try { await api("POST", "/api/admin/devapi/apps/" + b.dataset.st, { status: b.dataset.v }); adminView(); } catch (err) { fail(err); } });
    on(el, "[data-rls]", "click", async (e, b) => { try { await api("POST", "/api/admin/devapi/apps/" + b.dataset.rls, { rateLimit: +el.querySelector(`[data-rl="${b.dataset.rls}"]`).value }); toast(T("حُفظ")); } catch (err) { fail(err); } });
  }

  /* ---------- OAuth consent ---------- */
  async function consent() {
    const el = box(), q = new URLSearchParams(location.hash.split("?")[1] || "");
    if (!signedIn()) { el.innerHTML = `<h2>${T("تسجيل الدخول مطلوب")}</h2><div class="card">${T("سجّل الدخول ثم افتح الرابط مرة أخرى لمنح التطبيق الصلاحية.")}</div>`; return; }
    let info; try { info = await api("GET", "/api/oauth/authorize?" + q); } catch (e) { el.innerHTML = `<h2>${T("طلب تفويض غير صالح")}</h2><div class="card">${esc(e.message)}</div>`; return; }
    el.innerHTML = `<h2>${T("السماح لتطبيق")} «${esc(info.app.name)}»؟</h2><div class="card">${info.app.description ? `<p>${esc(info.app.description)}</p>` : ""}
      <p class="k">${T("المطوّر")}: @${esc(info.app.owner?.handle || "")} · ${T("سيُعاد توجيهك إلى")} <code>${esc(info.host)}</code></p>
      <h3>${T("سيتمكن من")}:</h3><ul>${info.scopes.map((s) => `<li>${esc(s.label)}</li>`).join("")}</ul>
      <h3>${T("لن يتمكن أبداً من")}:</h3><ul>${info.never.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
      <p class="k">${T("يمكنك سحب الصلاحية في أي وقت من بوابة المطورين.")}</p>
      <div class="row"><button class="btn" type="button" data-d="allow">${T("السماح")}</button><button class="btn ghost" type="button" data-d="deny">${T("رفض")}</button></div></div>`;
    on(el, "[data-d]", "click", async (e, b) => {
      el.querySelectorAll("[data-d]").forEach((x) => (x.disabled = true));
      try { const r = await api("POST", "/api/oauth/authorize", { ...Object.fromEntries(q), decision: b.dataset.d }); location.href = r.redirect; } catch (err) { fail(err); el.querySelectorAll("[data-d]").forEach((x) => (x.disabled = false)); }
    });
  }

  /* ---------- routes + settings entry ---------- */
  MPRoutes.extend((a, b) => ({ developers: () => (a === "app" && b ? appView(b) : a === "docs" ? docs() : a === "admin" ? adminView() : portal()).catch?.(fail),
    oauth: () => consent().catch(fail) }));
  const card = () => { if (/^#\/settings\/?(\?|$)/.test(location.hash) && !document.getElementById("mp-dev-set")) (view.querySelector(".wrap") || view).insertAdjacentHTML("beforeend", `<div class="card" id="mp-dev-set"><h3 class="u-m0 u-mb8 u-t-lg">${T("المطورون")}</h3><a class="btn ghost" href="#/developers">${T("بوابة المطورين")}</a> <a class="btn ghost" href="#/developers/docs">${T("الوثائق")}</a></div>`); };
  addEventListener("hashchange", () => setTimeout(card, 0)); setTimeout(card, 0);
  window.MPDev = { portal, docs, consent };
})();
