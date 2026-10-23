/* v2.77 «مركز الذكاء» (#/aihub, #/admin/aihub). Lazy chunk `aihub` + aihub.css. Server: server/services/aihub.js.
 * The member links THEIR OWN account and uses it inside Mujtama Plus:
 *   • OpenRouter — one tap (official OAuth PKCE). The key is created on the member's OpenRouter account, billed to their credits.
 *   • Gemini / Groq / OpenAI API / Claude / DeepSeek / Mistral / Grok — the member pastes an API key from the provider's own page.
 *   • ChatGPT sign-in — shown as «بانتظار موافقة OpenAI» with no button until OpenAI approves (no cookies, no passwords, ever).
 * Keys never come back to the browser (only ••••1234). Chat text is never stored: the conversation lives in this tab's memory only.
 * Strings are bilingual here (ar/en) and the screen carries data-noi18n, so the global word-swapper never touches it. */
(function AIHubUI() {
  if (window.MPAIHub) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const on = () => typeof Remote !== "undefined" && Remote.on && typeof DB !== "undefined" && DB.me;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ic = (n, c = "") => (window.UI ? UI.icon(n, c) : "");
  const en = () => (typeof DB !== "undefined" && DB.settings && DB.settings.lang === "en");
  const T = {
    title: ["مركز الذكاء", "AI Hub"],
    sub: ["اربط حسابك في الذكاء الاصطناعي واستخدمه هنا داخل مجتمع بلس", "Link your own AI account and use it right here in Mujtama Plus"],
    signIn: ["سجّل دخولك لتستخدم مركز الذكاء", "Sign in to use the AI Hub"], signInX: ["الربط والمحادثة مرتبطان بحسابك في مجتمع بلس.", "Linking and chat are tied to your Mujtama Plus account."],
    load: ["تعذر تحميل مركز الذكاء", "Couldn't load the AI Hub"], retry: ["إعادة المحاولة", "Try again"],
    free: ["الاستخدام المجاني اليوم", "Free today"], freeOff: ["الاستخدام المجاني غير مفعّل بعد", "Free use isn't on yet"],
    freeOffX: ["اربط حسابك بالأسفل لتبدأ الآن. OpenRouter فيه نماذج مجانية.", "Link an account below to start now. OpenRouter has free models."],
    freeLeft: (l, d) => [`باقي ${l} من ${d} طلبات`, `${l} of ${d} requests left`], resets: ["يتجدد عند منتصف الليل (UTC)", "Resets at midnight (UTC)"],
    quick: ["الأسرع: ربط بضغطة واحدة", "Fastest: one-tap link"], oneTap: ["ربط بضغطة واحدة", "Link in one tap"], opening: ["جارٍ فتح OpenRouter…", "Opening OpenRouter…"],
    oneTapX: ["تسجّل دخولك في OpenRouter وتوافق، ثم ترجع هنا مرتبطاً. لا نرى كلمة مرورك.", "Sign in to OpenRouter and approve, then you come back linked. We never see your password."],
    providers: ["الحسابات", "Accounts"], linked: ["مرتبط", "Linked"], notLinked: ["غير مرتبط", "Not linked"], needs: ["يحتاج تحديث", "Needs update"],
    quota: ["انتهى الرصيد", "Out of credit"], pending: ["بانتظار موافقة OpenAI", "Awaiting OpenAI approval"],
    pendingX: ["سنفعّل الدخول بحساب ChatGPT فور موافقة OpenAI الرسمية. حتى ذلك الحين يمكنك استخدام نماذج ChatGPT عبر OpenRouter أو مفتاح OpenAI API.", "ChatGPT sign-in goes live as soon as OpenAI officially approves it. Meanwhile, use ChatGPT models through OpenRouter or an OpenAI API key."],
    hasFree: ["فيه خطة مجانية", "Has a free tier"], linkKey: ["ربط بمفتاح", "Link with a key"], getKey: ["افتح صفحة المفتاح", "Open the key page"],
    keyLbl: (n) => [`مفتاح ${n}`, `${n} key`], keyPh: ["الصق المفتاح هنا", "Paste the key here"], show: ["إظهار المفتاح", "Show key"], hide: ["إخفاء المفتاح", "Hide key"],
    save: ["تحقق واربط", "Verify and link"], checking: ["جارٍ التحقق من المفتاح…", "Checking the key…"], keyNote: ["نتحقق من المفتاح مع المزوّد مباشرة، ثم نحفظه مشفّراً.", "We check the key with the provider, then store it encrypted."],
    model: ["النموذج", "Model"], loadingModels: ["جارٍ جلب النماذج…", "Loading models…"], unlink: ["فصل الربط", "Unlink"],
    unlinkQ: (n) => [`فصل ${n}؟ سيُحذف المفتاح من مجتمع بلس نهائياً.`, `Unlink ${n}? The key is deleted from Mujtama Plus.`],
    unlinked: ["تم فصل الربط", "Unlinked"], linkedOk: (n) => [`تم ربط ${n}`, `${n} linked`], saved: ["تم الحفظ", "Saved"],
    relink: ["حدّث المفتاح", "Update key"], since: ["مرتبط منذ", "Linked"], via: ["عبر", "via"],
    prefs: ["التفضيلات", "Preferences"], defP: ["الحساب الافتراضي للمحادثة", "Default account for chat"], asst: ["مساعد الكتابة واقتراح الردود", "Writing helper and reply suggestions"],
    asstApp: ["مساعد التطبيق (افتراضي)", "The app's helper (default)"], freeOpt: ["الاستخدام المجاني", "Free use"], auto: ["تلقائي", "Automatic"],
    asstX: ["إذا اخترت حسابك، يعمل المساعد على حسابك بلا اشتراك وبلا حدود التطبيق.", "Pick your account and the helper runs on it, with no subscription and no app limits."],
    chat: ["محادثة", "Chat"], newChat: ["محادثة جديدة", "New chat"], ph: ["اكتب سؤالك…", "Ask anything…"], send: ["إرسال", "Send"], thinking: ["يكتب…", "Thinking…"],
    you: ["أنت", "You"], ai: ["الذكاء", "AI"], copy: ["نسخ", "Copy"], copied: ["تم النسخ", "Copied"], again: ["أعد المحاولة", "Retry"],
    chatEmpty: ["ابدأ بسؤال", "Start with a question"], chatEmptyX: ["مثلاً: لخّص لي فكرة، أو صغ منشوراً، أو اشرح شيئاً ببساطة.", "e.g. summarise an idea, draft a post, or explain something simply."],
    noAcct: ["اربط حساباً أولاً", "Link an account first"], noAcctX: ["اختر من «الحسابات» بالأعلى، وOpenRouter أسرعها.", "Pick one under Accounts above; OpenRouter is the fastest."],
    tooLong: ["المحادثة طويلة. ابدأ محادثة جديدة.", "This chat is long. Start a new one."], memOnly: ["المحادثة في هذه الصفحة فقط ولا تُحفظ.", "This chat lives on this page only and isn't saved."],
    privacy: ["الخصوصية والشفافية", "Privacy and transparency"], sent: ["ما يُرسل", "What is sent"], notSent: ["ما لا يُرسل", "What is never sent"], kept: ["ما نحفظه", "What we keep"],
    sentX: ["ما تكتبه في المحادثة فقط، إلى الحساب الذي تختاره.", "Only what you type in the chat, to the account you pick."],
    minor: ["حسابك لمن دون 18: الردود مقيّدة بمحتوى آمن ومناسب.", "Under-18 account: replies are kept safe and age-appropriate."],
    help: ["كيف يعمل؟", "How it works"], admin: ["إدارة مركز الذكاء", "AI Hub admin"], freeDaily: ["الحد المجاني اليومي لكل عضو", "Free daily limit per member"],
    freeKey: ["مفتاح الاستخدام المجاني (AIHUB_FREE_KEY)", "Free-use key (AIHUB_FREE_KEY)"], set: ["مضبوط", "Set"], unset: ["غير مضبوط", "Not set"],
    enabled: ["مفعّل للأعضاء", "On for members"], links: ["ربط", "links"], todayU: ["اليوم", "Today"], req: ["طلب", "requests"], mem: ["عضو", "members"], none: ["لا استخدام اليوم", "No use today"],
    linkErr: { denied: ["ألغيت الربط من OpenRouter.", "You cancelled the link on OpenRouter."], missing: ["رجع الربط ناقصاً. حاول مرة أخرى.", "The link came back incomplete. Try again."],
      expired: ["انتهت مهلة الربط (10 دقائق). اضغط «ربط بضغطة واحدة» من جديد.", "The link timed out (10 minutes). Tap «Link in one tap» again."],
      exchange: ["لم يكتمل الربط مع OpenRouter. حاول بعد قليل.", "OpenRouter didn't finish the link. Try again shortly."], user: ["تعذر إكمال الربط لحسابك.", "Couldn't finish the link for your account."] },
    err: { bad_key: ["المفتاح غير صحيح أو أُلغي. انسخه من جديد من صفحة المزوّد.", "The key is wrong or revoked. Copy it again from the provider."],
      key_format: ["هذا لا يبدو مفتاحاً صحيحاً. انسخه كاملاً.", "That doesn't look like a valid key. Copy all of it."],
      quota: ["انتهى رصيدك أو حصتك لدى المزوّد. اشحن الرصيد ثم أعد المحاولة.", "You're out of credit or quota with the provider. Top up, then retry."],
      rate: ["طلبات كثيرة في وقت قصير. انتظر دقيقة ثم أعد المحاولة.", "Too many requests. Wait a minute and retry."],
      free_limit: ["انتهى الاستخدام المجاني لليوم. اربط حسابك لتكمل، أو عُد غداً.", "Today's free use is over. Link an account to continue, or come back tomorrow."],
      not_configured: ["الاستخدام المجاني غير مفعّل بعد. اربط حسابك لتبدأ.", "Free use isn't on yet. Link an account to start."],
      not_linked: ["اربط هذا الحساب أولاً.", "Link this account first."], provider_disabled: ["هذا المزوّد موقوف مؤقتاً.", "This provider is paused for now."],
      too_long: ["المحادثة طويلة. ابدأ محادثة جديدة.", "This chat is long. Start a new one."], empty: ["لم يصل رد. جرّب نموذجاً آخر.", "No reply came back. Try another model."],
      offline: ["لا يوجد اتصال بالإنترنت. تحقق من الشبكة ثم أعد المحاولة.", "You're offline. Check the connection and retry."],
      timeout: ["تأخر المزوّد في الرد. أعد المحاولة.", "The provider took too long. Retry."], siwc_pending: ["بانتظار موافقة OpenAI.", "Awaiting OpenAI approval."] }
  };
  const t = (k, ...a) => { const v = typeof T[k] === "function" ? T[k](...a) : T[k]; return Array.isArray(v) ? v[en() ? 1 : 0] : String(v ?? k); };
  const pick = (pair) => (Array.isArray(pair) ? pair[en() ? 1 : 0] : "");
  const errText = (e) => (e && T.err[e.code] ? pick(T.err[e.code]) : e && e.status === 0 ? pick(T.err.offline) : (e && e.message) || t("load"));
  const toastT = (m) => (typeof toast === "function" ? toast(m) : 0);
  const dfmt = (iso) => { try { return new Intl.DateTimeFormat(en() ? "en" : "ar", { dateStyle: "medium", numberingSystem: "latn" }).format(new Date(iso)); } catch { return ""; } };

  let data = null, chatLog = [], busy = false;
  const models = {}; // provider → [{id,name,free}]
  const head = () => UI.pageHead({ back: ["#/menu", en() ? "More" : "المزيد"], title: t("title"), icon: "sparkle", sub: t("sub") });
  const state = (p) => { const l = p.linked; if (p.link === "siwc" && !p.available) return ["pend", t("pending")]; if (!l) return ["off", t("notLinked")]; if (l.state === "bad_key") return ["warn", t("needs")]; if (l.state === "quota") return ["warn", t("quota")]; return ["ok", t("linked")]; };
  const mono = (p) => `<span class="ah-mono" aria-hidden="true" data-c="${/^#[0-9a-f]{6}$/i.test(p.color || "") ? p.color : ""}">${esc(p.mono || p.name.slice(0, 2))}</span>`;
  /* brand tint + meter width are applied as CSS properties (no inline style attributes in the markup; CSP-friendly) */
  const blurb = (p) => (en() && p.en && p.en.blurb) || p.blurb;
  const paint = (root) => {
    for (const el of root.querySelectorAll("[data-c]")) if (el.dataset.c) el.style.setProperty("--ah-c", el.dataset.c);
    for (const el of root.querySelectorAll("[data-w]")) el.style.width = el.dataset.w + "%";
  };

  let flash = null; // the ?linked / ?link_error note survives the core's own re-render of the route (read once, kept briefly)
  async function view0() {
    view.innerHTML = `<div class="wrap ah" data-noi18n>${head()}<div id="ah-box" aria-busy="true"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div></div>`;
    const box = view.querySelector("#ah-box");
    if (!on()) { box.removeAttribute("aria-busy"); box.innerHTML = UI.empty({ title: t("signIn"), text: t("signInX") }); return; }
    const q = new URLSearchParams((location.hash.split("?")[1]) || "");
    if (q.get("linked") || q.get("link_error")) {
      flash = { linked: q.get("linked"), lerr: q.get("link_error"), until: Date.now() + 4000 };
      try { history.replaceState(null, "", "#/aihub"); } catch { /* ok */ }
    }
    const f = flash && flash.until > Date.now() ? flash : null, linked = f && f.linked, lerr = f && f.lerr;
    try { data = await api("GET", "/api/aihub"); } catch (e) {
      box.removeAttribute("aria-busy");
      box.innerHTML = UI.empty({ title: t("load"), text: errText(e), action: `<button class="btn" type="button" id="ah-retry">${ic("refresh", "sm")} ${esc(t("retry"))}</button>` });
      box.querySelector("#ah-retry").addEventListener("click", view0); return;
    }
    box.removeAttribute("aria-busy");
    render(box, { linked, lerr });
  }

  function render(box, { linked, lerr } = {}) {
    const d = data, ps = d.providers, or = ps.find((p) => p.id === "openrouter"), rest = ps.filter((p) => p.id !== "openrouter");
    const orLinked = !!(or && or.linked);
    box.innerHTML = `
      ${lerr ? `<div class="ah-banner bad" role="alert">${ic("alert", "sm")}<span>${esc(pick(T.linkErr[lerr]) || pick(T.linkErr.exchange))}</span></div>` : ""}
      ${linked ? `<div class="ah-banner good" role="status">${ic("check", "sm")}<span>${esc(t("linkedOk", (ps.find((p) => p.id === linked) || { name: linked }).name))}</span></div>` : ""}
      ${d.minor ? `<p class="ah-note">${ic("shield", "sm")} ${esc(t("minor"))}</p>` : ""}
      ${freeCard(d.free)}
      ${or && !orLinked ? `<section class="card ah-hero" aria-labelledby="ah-q-h"><div class="ah-hero-top">${mono(or)}<div class="ah-grow"><h3 id="ah-q-h">${esc(t("quick"))}</h3><p class="muted">${esc(blurb(or))}</p></div></div>
        <button class="btn ah-cta" type="button" data-oauth="openrouter">${ic("sparkle", "sm")} ${esc(t("oneTap"))}</button><p class="ah-fine">${ic("lock", "sm")} ${esc(t("oneTapX"))}</p></section>` : ""}
      <h3 class="ah-h">${esc(t("providers"))}</h3>
      <div class="ah-list">${(orLinked ? [or, ...rest] : rest).map(card).join("")}</div>
      ${prefsCard(d)}
      ${chatCard(d)}
      ${privacyCard(d)}`;
    wire(box);
    paint(box);
    if (linked) box.querySelector(`[data-p="${CSS.escape(linked)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    for (const p of ps) if (p.linked) fillModels(box, p);
  }

  function freeCard(f) {
    if (!f.enabled) return `<section class="card ah-free off"><div class="ah-row">${ic("clock")}<div class="ah-grow"><b>${esc(t("freeOff"))}</b><small class="muted">${esc(t("freeOffX"))}</small></div></div></section>`;
    const pct = f.daily ? Math.round((f.used / f.daily) * 100) : 0;
    return `<section class="card ah-free" aria-labelledby="ah-free-h"><div class="ah-row"><div class="ah-grow"><b id="ah-free-h">${esc(t("free"))}</b><small class="muted">${esc(t("freeLeft", f.left, f.daily))} · ${esc(t("resets"))}</small></div><span class="ah-big">${UI.num(f.left)}</span></div>
      <div class="ah-meter" role="progressbar" aria-label="${esc(t("free"))}" aria-valuemin="0" aria-valuemax="${f.daily}" aria-valuenow="${f.used}"><i data-w="${Math.max(0, Math.min(100, Math.round(pct)))}"></i></div></section>`;
  }

  function card(p) {
    const [cls, lbl] = state(p), l = p.linked, pend = p.link === "siwc" && !p.available;
    const chip = `<span class="ah-chip ${cls}">${cls === "ok" ? ic("check", "sm") : cls === "warn" ? ic("alert", "sm") : cls === "pend" ? ic("hourglass", "sm") : ""}${esc(lbl)}</span>`;
    let body = "";
    if (pend) body = `<p class="ah-fine">${ic("clock", "sm")} ${esc(t("pendingX"))}</p>`;
    else if (l) body = `<div class="ah-linked">
        <label class="ah-lbl" for="ah-m-${p.id}">${esc(t("model"))}</label>
        <select id="ah-m-${p.id}" data-model="${p.id}" dir="ltr" disabled><option>${esc(l.model || t("loadingModels"))}</option></select>
        <p class="ah-fine muted" dir="auto"><span data-noi18n>${esc(l.hint || "")}</span> · ${esc(t("since"))} ${esc(dfmt(l.linkedAt))}</p>
        <div class="ah-acts">${l.state !== "ok" && p.link === "key" ? `<button class="btn ghost" type="button" data-relink="${p.id}">${ic("refresh", "sm")} ${esc(t("relink"))}</button>` : ""}
        ${l.state !== "ok" && p.link === "oauth" ? `<button class="btn ghost" type="button" data-oauth="${p.id}">${ic("refresh", "sm")} ${esc(t("oneTap"))}</button>` : ""}
        <button class="btn ghost ah-danger" type="button" data-unlink="${p.id}">${ic("trash", "sm")} ${esc(t("unlink"))}</button></div></div>${p.link === "key" ? keyForm(p, true) : ""}`;
    else if (p.link === "oauth") body = `<button class="btn ah-cta" type="button" data-oauth="${p.id}">${ic("sparkle", "sm")} ${esc(t("oneTap"))}</button>`;
    else body = keyForm(p, false);
    return `<article class="card ah-p${l ? " is-linked" : ""}${pend ? " is-pend" : ""}" data-p="${p.id}" aria-labelledby="ah-p-${p.id}">
      <div class="ah-row">${mono(p)}<div class="ah-grow"><h4 id="ah-p-${p.id}">${esc(p.name)} <small class="muted">${esc(p.maker)}</small></h4>${p.free && !l ? `<span class="ah-tag">${esc(t("hasFree"))}</span>` : ""}</div>${chip}</div>
      ${l ? "" : `<p class="ah-blurb muted">${esc(blurb(p))}</p>`}${body}</article>`;
  }

  function keyForm(p, hidden) {
    const steps = ((en() && p.en && p.en.steps) || p.steps || []).map((s) => `<li>${esc(s)}</li>`).join("");
    return `<details class="ah-key"${hidden ? ` hidden data-keyfor="${p.id}"` : ""}><summary>${ic("lock", "sm")} ${esc(t("linkKey"))}</summary>
      ${steps ? `<ol class="ah-steps">${steps}</ol>` : ""}
      ${p.keyUrl ? `<a class="btn ghost ah-keyurl" href="${esc(p.keyUrl)}" target="_blank" rel="noopener noreferrer">${esc(t("getKey"))} <span class="ah-ext" aria-hidden="true">↗</span></a>` : ""}
      <form class="ah-kf" data-key="${p.id}" novalidate><label class="ah-lbl" for="ah-k-${p.id}">${esc(t("keyLbl", p.name))}</label>
      <div class="ah-kin"><input id="ah-k-${p.id}" type="password" dir="ltr" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="text" placeholder="${esc(t("keyPh"))}" aria-describedby="ah-kn-${p.id} ah-ke-${p.id}" maxlength="400" required>
      <button type="button" class="icon-btn" data-peek="${p.id}" aria-label="${esc(t("show"))}" aria-pressed="false">${ic("eye", "sm")}</button></div>
      <p class="ah-err" id="ah-ke-${p.id}" role="alert"></p><p class="ah-fine muted" id="ah-kn-${p.id}">${esc(t("keyNote"))}</p>
      <button class="btn ah-cta" type="submit">${ic("check", "sm")} ${esc(t("save"))}</button></form></details>`;
  }

  function prefsCard(d) {
    const linked = d.providers.filter((p) => p.linked);
    if (!linked.length) return "";
    const opt = (v, txt, cur) => `<option value="${esc(v)}"${cur === v ? " selected" : ""}>${esc(txt)}</option>`;
    const cur = d.prefs.defaultProvider || "", asst = (d.prefs.features || {}).assistant || "";
    return `<section class="card ah-prefs" aria-labelledby="ah-pr-h"><h3 id="ah-pr-h">${esc(t("prefs"))}</h3>
      <label class="ah-lbl" for="ah-def">${esc(t("defP"))}</label><select id="ah-def">${linked.map((p) => opt(p.id, p.name, cur)).join("")}${d.free.enabled ? opt("free", t("freeOpt"), cur) : ""}</select>
      <label class="ah-lbl" for="ah-asst">${esc(t("asst"))}</label><select id="ah-asst">${opt("", t("asstApp"), asst)}${linked.map((p) => opt(p.id, p.name, asst)).join("")}</select>
      <p class="ah-fine muted">${esc(t("asstX"))}</p></section>`;
  }

  function chatCard(d) {
    const usable = d.providers.filter((p) => p.linked && p.linked.state === "ok");
    const can = usable.length || d.free.enabled;
    const cur = d.prefs.defaultProvider && (d.prefs.defaultProvider === "free" ? d.free.enabled : usable.some((p) => p.id === d.prefs.defaultProvider)) ? d.prefs.defaultProvider : usable[0]?.id || (d.free.enabled ? "free" : "");
    return `<section class="card ah-chat" aria-labelledby="ah-c-h"><div class="ah-row"><h3 id="ah-c-h" class="ah-grow">${ic("comment", "sm")} ${esc(t("chat"))}</h3>
      ${can ? `<select id="ah-cp" aria-label="${esc(t("defP"))}">${usable.map((p) => `<option value="${p.id}"${cur === p.id ? " selected" : ""}>${esc(p.name)}</option>`).join("")}${d.free.enabled ? `<option value="free"${cur === "free" ? " selected" : ""}>${esc(t("freeOpt"))}</option>` : ""}</select>
      <button class="icon-btn" type="button" id="ah-new" aria-label="${esc(t("newChat"))}" title="${esc(t("newChat"))}">${ic("plus", "sm")}</button>` : ""}</div>
      ${can ? `<div class="ah-log" id="ah-log" role="log" aria-live="polite" aria-relevant="additions" tabindex="0" aria-label="${esc(t("chat"))}"></div>
      <form class="ah-cf" id="ah-cf"><label class="ah-sr" for="ah-in">${esc(t("ph"))}</label><textarea id="ah-in" rows="1" dir="auto" maxlength="8000" placeholder="${esc(t("ph"))}"></textarea>
      <button class="btn ah-send" type="submit" aria-label="${esc(t("send"))}">${ic("arrowUp")}</button></form><p class="ah-fine muted">${ic("lock", "sm")} ${esc(t("memOnly"))}</p>`
      : UI.empty({ title: t("noAcct"), text: t("noAcctX") })}</section>`;
  }

  function privacyCard(d) {
    const pv = d.privacy || {};
    return `<section class="card ah-priv" aria-labelledby="ah-pv-h"><h3 id="ah-pv-h">${ic("shield", "sm")} ${esc(t("privacy"))}</h3>
      <dl><dt>${esc(t("sent"))}</dt><dd>${esc(en() ? "Only what you type in the chat (and text you ask the writing helper to improve), to the account you pick." : t("sentX"))}</dd>
      <dt>${esc(t("notSent"))}</dt><dd>${esc(en() ? "Your private messages and account data are never sent to a provider on our own." : pv.never || "")}</dd>
      <dt>${esc(t("kept"))}</dt><dd>${esc(en() ? "We don't store your messages or AI replies — only a daily request count. Keys are encrypted, never shown again, and you can delete them any time." : `${pv.stored || ""} ${pv.keys || ""}`)}</dd></dl></section>`;
  }

  /* ---------- behaviour ---------- */
  function wire(box) {
    box.addEventListener("click", async (e) => {
      const b = e.target.closest("button"); if (!b || b.disabled) return;
      if (b.dataset.oauth) return oauth(b);
      if (b.dataset.unlink) return unlink(b.dataset.unlink);
      if (b.dataset.relink) { const det = box.querySelector(`[data-keyfor="${CSS.escape(b.dataset.relink)}"]`); if (det) { det.hidden = false; det.open = true; det.querySelector("input")?.focus(); } return; }
      if (b.dataset.peek) { const i = box.querySelector("#ah-k-" + CSS.escape(b.dataset.peek)), show = i.type === "password"; i.type = show ? "text" : "password"; b.setAttribute("aria-pressed", String(show)); b.setAttribute("aria-label", t(show ? "hide" : "show")); b.innerHTML = ic(show ? "eyeOff" : "eye", "sm"); return; }
      if (b.id === "ah-new") { chatLog = []; paintLog(box); box.querySelector("#ah-in")?.focus(); return; }
      if (b.dataset.copy != null) { const m = chatLog[+b.dataset.copy]; try { await navigator.clipboard.writeText(m.content); toastT(t("copied")); } catch { /* clipboard blocked */ } return; }
      if (b.dataset.retry != null) { chatLog = chatLog.filter((m) => !m.err); send(box); }
    });
    box.querySelectorAll("form.ah-kf").forEach((f) => f.addEventListener("submit", (e) => { e.preventDefault(); linkKey(f); }));
    box.querySelectorAll("select[data-model]").forEach((s) => s.addEventListener("change", async () => {
      s.disabled = true; try { await api("PUT", "/api/aihub/links/" + s.dataset.model, { model: s.value }); toastT(t("saved")); } catch (e) { toastT(errText(e)); } finally { s.disabled = false; }
    }));
    const pr = (body) => async () => { try { data.prefs = await api("PUT", "/api/aihub/prefs", body()); toastT(t("saved")); } catch (e) { toastT(errText(e)); } };
    box.querySelector("#ah-def")?.addEventListener("change", pr(() => ({ defaultProvider: box.querySelector("#ah-def").value })));
    box.querySelector("#ah-asst")?.addEventListener("change", pr(() => ({ features: { assistant: box.querySelector("#ah-asst").value || null } })));
    const ta = box.querySelector("#ah-in");
    if (ta) {
      const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 180) + "px"; };
      ta.addEventListener("input", grow);
      ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(pointer:fine)").matches) { e.preventDefault(); box.querySelector("#ah-cf").requestSubmit(); } });
      box.querySelector("#ah-cf").addEventListener("submit", (e) => { e.preventDefault(); const v = ta.value.trim(); if (!v || busy) return; chatLog.push({ role: "user", content: v }); ta.value = ""; grow(); send(box); });
      paintLog(box);
    }
  }

  async function oauth(b) {
    const old = b.innerHTML; b.disabled = true; b.setAttribute("aria-busy", "true"); b.textContent = t("opening");
    try { const r = await api("POST", "/api/aihub/oauth/" + b.dataset.oauth + "/start", {}); if (!/^https:\/\/openrouter\.ai\//.test(r.url)) throw new Error(t("load")); location.assign(r.url); }
    catch (e) { toastT(errText(e)); b.disabled = false; b.removeAttribute("aria-busy"); b.innerHTML = old; }
  }

  async function linkKey(f) {
    const pid = f.dataset.key, inp = f.querySelector("input"), err = f.querySelector(".ah-err"), btn = f.querySelector("[type=submit]");
    const key = inp.value.trim(); err.textContent = "";
    if (key.length < 16) { err.textContent = pick(T.err.key_format); inp.setAttribute("aria-invalid", "true"); inp.focus(); return; }
    const old = btn.innerHTML; btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = t("checking"); inp.removeAttribute("aria-invalid");
    try {
      const r = await api("POST", "/api/aihub/links/" + pid, { key });
      inp.value = ""; models[pid] = r.models || [];
      const p = data.providers.find((x) => x.id === pid); p.linked = r.link;
      try { data = await api("GET", "/api/aihub"); } catch { /* keep the local copy */ }
      toastT(t("linkedOk", p.name)); render(view.querySelector("#ah-box"), {});
      view.querySelector(`[data-p="${CSS.escape(pid)}"] select`)?.focus();
    } catch (e) { err.textContent = errText(e); inp.setAttribute("aria-invalid", "true"); inp.focus(); btn.disabled = false; btn.removeAttribute("aria-busy"); btn.innerHTML = old; }
  }

  async function unlink(pid) {
    const p = data.providers.find((x) => x.id === pid);
    if (!confirm(t("unlinkQ", p.name))) return;
    try { await api("DELETE", "/api/aihub/links/" + pid); delete models[pid]; data = await api("GET", "/api/aihub"); toastT(t("unlinked")); render(view.querySelector("#ah-box"), {}); }
    catch (e) { toastT(errText(e)); }
  }

  async function fillModels(box, p) {
    const s = box.querySelector(`select[data-model="${CSS.escape(p.id)}"]`); if (!s) return;
    let list = models[p.id];
    if (!list) { try { list = (await api("GET", `/api/aihub/links/${p.id}/models`)).models || []; models[p.id] = list; } catch { list = []; } }
    const cur = p.linked.model;
    if (!s.isConnected) return;
    const has = list.some((m) => m.id === cur);
    s.innerHTML = (has || !cur ? "" : `<option value="${esc(cur)}" selected>${esc(cur)}</option>`) + list.map((m) => `<option value="${esc(m.id)}"${m.id === cur ? " selected" : ""}>${esc(m.name || m.id)}${m.free ? (en() ? " · free" : " · مجاني") : ""}</option>`).join("");
    s.disabled = !list.length && !cur ? true : false;
  }

  function paintLog(box) {
    const log = box.querySelector("#ah-log"); if (!log) return;
    if (!chatLog.length) { log.innerHTML = `<div class="ah-hint"><b>${esc(t("chatEmpty"))}</b><small class="muted">${esc(t("chatEmptyX"))}</small></div>`; return; }
    log.innerHTML = chatLog.map((m, i) => `<div class="ah-msg ${m.role === "user" ? "me" : m.err ? "bad" : "ai"}"><span class="ah-sr">${esc(m.role === "user" ? t("you") : t("ai"))}: </span><div class="ah-bub" dir="auto">${esc(m.content).replace(/\n/g, "<br>")}</div>
      ${m.role === "assistant" && !m.err ? `<div class="ah-meta"><small class="muted" dir="ltr">${esc(m.model || "")}</small><button type="button" class="icon-btn ah-ib" data-copy="${i}" aria-label="${esc(t("copy"))}">${ic("copy", "sm")}</button></div>` : ""}
      ${m.err ? `<button type="button" class="btn ghost" data-retry="${i}">${ic("refresh", "sm")} ${esc(t("again"))}</button>` : ""}</div>`).join("")
      + (busy ? `<div class="ah-msg ai"><div class="ah-bub ah-typing" role="status"><span class="ah-sr">${esc(t("thinking"))}</span><i></i><i></i><i></i></div></div>` : "");
    log.scrollTop = log.scrollHeight;
  }

  async function send(box) {
    if (busy) return; busy = true; paintLog(box);
    const btn = box.querySelector(".ah-send"); if (btn) btn.disabled = true;
    const provider = box.querySelector("#ah-cp")?.value || undefined;
    const msgs = chatLog.filter((m) => !m.err).slice(-30).map(({ role, content }) => ({ role, content }));
    try {
      const r = await api("POST", "/api/aihub/chat", { messages: msgs, provider });
      chatLog.push({ role: "assistant", content: r.text, model: r.model });
      if (r.free && data) { data.free.used = r.free.used; data.free.left = r.free.left; const fc = box.querySelector(".ah-free"); if (fc) fc.outerHTML = freeCard(data.free); }
    } catch (e) { chatLog.push({ role: "assistant", content: errText(e), err: true }); }
    finally { busy = false; if (btn) btn.disabled = false; paintLog(box); }
  }

  /* ---------- #/admin/aihub ---------- */
  async function adminView() {
    if (!DB.isAdmin) return Views.notFound();
    view.innerHTML = `<div class="wrap ah" data-noi18n>${UI.pageHead({ back: ["#/admin", en() ? "Admin" : "الإدارة"], title: t("admin"), icon: "sparkle" })}<div id="ah-adm" aria-busy="true"><div class="skel"></div></div></div>`;
    const box = view.querySelector("#ah-adm");
    let a; try { a = await api("GET", "/api/admin/aihub"); } catch (e) { box.removeAttribute("aria-busy"); box.innerHTML = UI.empty({ title: t("load"), text: errText(e) }); return; }
    box.removeAttribute("aria-busy");
    box.innerHTML = `<section class="card"><label class="ah-lbl" for="ah-fd">${esc(t("freeDaily"))}</label><input id="ah-fd" type="number" min="0" max="100" step="1" value="${a.settings.freeDaily}" dir="ltr">
      <p class="ah-fine">${esc(t("freeKey"))}: <b>${esc(a.freeConfigured ? t("set") : t("unset"))}</b>${a.freeVia ? ` · <span dir="ltr">${esc(a.freeVia)}</span>` : ""}</p>
      ${a.siwc && !a.siwc.ready ? `<p class="ah-fine muted">${ic("hourglass", "sm")} ${esc(a.siwc.note || t("pending"))}</p>` : ""}</section>
      <section class="card"><div class="list flat">${a.providers.map((p) => `<label class="ah-row ah-adm-p"><span class="ah-grow"><b>${esc(p.name)}</b><small class="muted">${UI.num(p.links)} ${esc(t("links"))}</small></span><input type="checkbox" data-en="${p.id}"${p.enabled ? " checked" : ""} aria-label="${esc(t("enabled"))}: ${esc(p.name)}"></label>`).join("")}</div></section>
      <section class="card"><h3>${esc(t("todayU"))}</h3>${a.today.length ? a.today.map((x) => `<p class="ah-row"><span class="ah-grow" dir="ltr">${esc(x.provider)}</span><span>${UI.num(x.requests)} ${esc(t("req"))} · ${UI.num(x.members)} ${esc(t("mem"))}</span></p>`).join("") : `<p class="muted">${esc(t("none"))}</p>`}</section>
      <button class="btn" type="button" id="ah-asave">${esc(en() ? "Save" : "حفظ")}</button>`;
    box.querySelector("#ah-asave").addEventListener("click", async (e) => {
      const b = e.currentTarget; b.disabled = true;
      const enabled = Object.fromEntries([...box.querySelectorAll("[data-en]")].map((x) => [x.dataset.en, x.checked]));
      try { await api("PUT", "/api/admin/aihub", { freeDaily: Number(box.querySelector("#ah-fd").value), enabled }); toastT(t("saved")); } catch (err) { toastT(errText(err)); } finally { b.disabled = false; }
    });
  }

  MPRoutes.extend(() => ({ aihub: () => view0() }));
  MPRoutes.add("admin", (a, b, next) => {
    if (a === "aihub") return adminView();
    next();
    if (!a && DB.isAdmin) setTimeout(() => { if (location.hash === "#/admin" && !document.getElementById("ah-adm-link")) view.querySelector(".wrap h2")?.insertAdjacentHTML("afterend", `<a class="u-db u-ci card" id="ah-adm-link" href="#/admin/aihub">${ic("sparkle")} <b>${esc(t("admin"))}</b></a>`); }, 0);
  });
  window.MPAIHub = { view: view0, adminView, version: "2.77.0" };
  if (typeof DB !== "undefined" && DB.onboarded && /^#\/(aihub|admin\/aihub)(\/|$|\?)/.test(location.hash) && typeof route === "function") route();
})();
