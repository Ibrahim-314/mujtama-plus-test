/* Arabic email templates (Phase 29): responsive RTL, table-based layout with inline CSS (works in Gmail,
 * Outlook desktop/web, Apple Mail, mobile clients). Every template returns { subject, html, text, preheader }.
 * Colours mirror theme.css (--brand-1 #6d3cf4, --text #15121f, --muted #625c76, --bg #f5f4fa); CSS variables
 * are not available in mail clients, so the literal values are inlined. */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const C = { brand: "#6d3cf4", brand2: "#c04cf0", ink: "#15121f", text2: "#3d3850", muted: "#625c76", bg: "#f5f4fa", line: "#e9e6f2", soft: "#efe9ff", accentInk: "#4f22d1", danger: "#d6453a", warnBg: "#fff4e5" };
const FONT = "Tahoma,'Segoe UI','Noto Sans Arabic','SF Arabic',Arial,sans-serif";

function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0"><tr><td align="center" bgcolor="${C.brand}" style="border-radius:12px;background:${C.brand}">
<a href="${esc(href)}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:12px">${esc(label)}</a></td></tr></table>`;
}
const p = (html, style = "") => `<p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.8;color:${C.text2};${style}">${html}</p>`;
const h1 = (t) => `<h1 style="margin:0 0 10px;font-family:${FONT};font-size:22px;line-height:1.5;color:${C.ink};font-weight:bold">${esc(t)}</h1>`;
const note = (html, tone = "soft") => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 16px"><tr><td style="background:${tone === "warn" ? C.warnBg : C.soft};border-radius:12px;padding:14px 16px;font-family:${FONT};font-size:14px;line-height:1.8;color:${tone === "warn" ? "#7a4b00" : C.accentInk}">${html}</td></tr></table>`;
const fallbackLink = (href) => p(`إن لم يعمل الزر، انسخ هذا الرابط في المتصفح:<br><a href="${esc(href)}" style="color:${C.brand};word-break:break-all;direction:ltr;unicode-bidi:embed">${esc(href)}</a>`, `font-size:13px;color:${C.muted}`);

/** shared shell: preheader, header, card, footer (why you got it + unsubscribe / preferences) */
function layout({ title, preheader = "", body, footer = "", unsubscribeUrl = null, prefsUrl = null, origin = "" }) {
  const links = [prefsUrl && `<a href="${esc(prefsUrl)}" style="color:${C.muted};text-decoration:underline">تفضيلات البريد</a>`, unsubscribeUrl && `<a href="${esc(unsubscribeUrl)}" style="color:${C.muted};text-decoration:underline">إلغاء الاشتراك بنقرة</a>`].filter(Boolean).join(" · ");
  return `<!doctype html>
<html lang="ar" dir="rtl" xmlns="http://www.w3.org/1999/xhtml">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(title)}</title>
<style>
@media only screen and (max-width:600px){ .mp-card{width:100%!important;border-radius:0!important} .mp-pad{padding:22px 18px!important} .mp-outer{padding:0!important} }
@media (prefers-color-scheme:dark){ .mp-body{background:#0b0a10!important} .mp-card{background:#15131d!important} .mp-card h1,.mp-card td,.mp-card p{color:#f3f1fa!important} }
</style></head>
<body class="mp-body" dir="rtl" style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%;text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}&#8203;&zwnj;&nbsp;&#8203;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg}"><tr><td class="mp-outer" align="center" style="padding:24px 12px">
<table role="presentation" class="mp-card" width="560" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="width:560px;max-width:560px;background:#ffffff;border-radius:18px;border:1px solid ${C.line}">
<tr><td class="mp-pad" style="padding:22px 28px 0;text-align:right" align="right">
<a href="${esc(origin || "#")}" style="text-decoration:none;font-family:${FONT};font-size:17px;font-weight:bold;color:${C.ink}"><span style="display:inline-block;width:30px;height:30px;line-height:30px;text-align:center;border-radius:10px;background:${C.brand};color:#ffffff;font-size:18px;vertical-align:middle">+</span>&nbsp; مجتمع بلس</a>
</td></tr>
<tr><td class="mp-pad" style="padding:18px 28px 8px;text-align:right;direction:rtl" align="right">${body}</td></tr>
<tr><td class="mp-pad" style="padding:0 28px 22px;text-align:right" align="right"><hr style="border:0;border-top:1px solid ${C.line};margin:6px 0 14px">
<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:1.7;color:${C.muted}">${footer}</p>
${links ? `<p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.7;color:${C.muted}">${links}</p>` : ""}
</td></tr></table>
<p style="margin:14px 0 0;font-family:${FONT};font-size:11px;color:${C.muted}">مجتمع بلس — منصة اجتماعية عربية</p>
</td></tr></table></body></html>`;
}
const textFooter = (o) => ["", "—", o.footer ? o.footer.replace(/<[^>]+>/g, "") : "", o.prefsUrl ? "تفضيلات البريد: " + o.prefsUrl : "", o.unsubscribeUrl ? "إلغاء الاشتراك: " + o.unsubscribeUrl : ""].filter(x => x !== "").join("\n");

const T = {
  verify({ name, url, origin }) {
    const subject = "أكّد بريدك الإلكتروني في مجتمع بلس", preheader = "خطوة واحدة لتفعيل بريدك واستعادة حسابك عند الحاجة";
    const body = h1("أكّد بريدك الإلكتروني") + p(`مرحباً ${esc(name)}، اضغط الزر لتأكيد أن هذا البريد لك. سنستخدمه لاستعادة حسابك وتنبيهات الأمان والنشرات التي تختارها فقط.`) + button(url, "تأكيد البريد") + p("ينتهي الرابط خلال ٢٤ ساعة.", `font-size:13px;color:${C.muted}`) + fallbackLink(url);
    const footer = "إن لم تطلب هذا، تجاهل الرسالة ولن يُربط البريد بأي حساب.";
    return { subject, preheader, html: layout({ title: subject, preheader, body, footer, origin }), text: `${subject}\n\nمرحباً ${name}،\nأكّد بريدك من الرابط (ينتهي خلال ٢٤ ساعة):\n${url}\n\n${footer}` };
  },
  reset({ name, url, origin, ip, device }) {
    const subject = "استعادة كلمة المرور — مجتمع بلس", preheader = "رابط لتعيين كلمة مرور جديدة، صالح لساعة واحدة";
    const body = h1("تعيين كلمة مرور جديدة") + p(`مرحباً ${esc(name)}، وصلنا طلب لاستعادة كلمة مرور حسابك${device ? ` من ${esc(device)}` : ""}. اضغط الزر لاختيار كلمة مرور جديدة.`) + button(url, "تعيين كلمة المرور") +
      note("الرابط صالح لساعة واحدة ويُستخدم مرة واحدة. بعد التعيين نسجّل خروجك من كل الأجهزة الأخرى.") + fallbackLink(url);
    const footer = `لم تطلب الاستعادة؟ تجاهل الرسالة وستبقى كلمة مرورك كما هي.${ip ? " عنوان الطلب: " + esc(ip) : ""}`;
    return { subject, preheader, html: layout({ title: subject, preheader, body, footer, origin }), text: `${subject}\n\nمرحباً ${name}،\nلتعيين كلمة مرور جديدة (صالح لساعة واحدة):\n${url}\n\n${footer.replace(/<[^>]+>/g, "")}` };
  },
  /** kind: login | password | email */
  security({ name, kind, detail, when, origin }) {
    const titles = { login: "تسجيل دخول من جهاز جديد", password: "تم تغيير كلمة مرور حسابك", email: "تم تغيير البريد الإلكتروني لحسابك" };
    const lead = { login: `سُجّل الدخول إلى حسابك من <b>${esc(detail || "جهاز جديد")}</b>.`, password: "تغيّرت كلمة مرور حسابك وسُجّل خروجك من الأجهزة الأخرى.", email: `أصبح بريد حسابك <b dir="ltr">${esc(detail || "")}</b>.` };
    const subject = `تنبيه أمني: ${titles[kind] || "نشاط جديد على حسابك"}`, preheader = "إن كان هذا أنت فلا داعي لأي إجراء";
    const url = `${origin}/#/security`;
    const body = h1(titles[kind] || "نشاط جديد على حسابك") + p(`مرحباً ${esc(name)}، ${lead[kind] || ""}`) + (when ? p(`الوقت: ${esc(when)}`, `font-size:13px;color:${C.muted}`) : "") +
      note("إن كان هذا أنت فلا داعي لأي إجراء. وإن لم يكن، غيّر كلمة المرور فوراً وسجّل الخروج من الأجهزة غير المعروفة من صفحة الأمان.", "warn") + button(url, "مراجعة أمان حسابي");
    const footer = "هذه رسالة أمان تُرسل دائماً لحماية حسابك ولا يمكن إلغاء الاشتراك فيها.";
    return { subject, preheader, html: layout({ title: subject, preheader, body, footer, origin }), text: `${subject}\n\nمرحباً ${name}، ${String(lead[kind] || "").replace(/<[^>]+>/g, "")}\nإن لم يكن هذا أنت: ${url}\n\n${footer}` };
  },
  /** one notification by email (the user enabled email for this kind) */
  notification({ name, sentence, url, origin, unsubscribeUrl, prefsUrl, kindLabel }) {
    const subject = sentence.length > 70 ? sentence.slice(0, 68) + "…" : sentence, preheader = "إشعار جديد في مجتمع بلس";
    const body = h1(sentence) + p(`مرحباً ${esc(name)}، لديك إشعار جديد.`) + button(url, "فتح في مجتمع بلس");
    const footer = `تصلك هذه الرسالة لأنك فعّلت البريد لإشعارات «${esc(kindLabel || "")}».`;
    const o = { footer, unsubscribeUrl, prefsUrl };
    return { subject, preheader, html: layout({ title: subject, preheader, body, footer, unsubscribeUrl, prefsUrl, origin }), text: `${sentence}\n${url}${textFooter(o)}` };
  },
  /** weekly digest (content prepared by services/summaries.js) */
  weekly({ name, counts, points = [], posts = [], label, origin, unsubscribeUrl, prefsUrl }) {
    const subject = "أسبوعك في مجتمع بلس ✨", preheader = `${counts.posts} منشوراً من ${counts.people} شخصاً هذا الأسبوع`;
    const pts = points.map(pt => `<li style="margin:0 0 8px">${esc(pt.text)} ${pt.cites.map(c => `<a href="${esc(origin)}/#/post/${esc(c.kind === "post" ? c.id : "")}" style="color:${C.brand};font-size:12px">[${esc(c.author || "مصدر")}]</a>`).join(" ")}</li>`).join("");
    const rows = posts.map(x => `<tr><td style="padding:12px 0;border-top:1px solid ${C.line};font-family:${FONT};font-size:15px;line-height:1.7"><a href="${esc(origin)}/#/post/${esc(x.id)}" style="color:${C.ink};text-decoration:none"><b>${esc(String(x.title || x.text || "").slice(0, 90))}</b></a></td></tr>`).join("");
    const body = h1("أسبوعك في مجتمع بلس") + p(`مرحباً ${esc(name)}، هذا أبرز ما دار خلال الأسبوع: ${counts.posts} منشوراً من ${counts.people} شخصاً.`) +
      (pts ? note(`<p style="margin:0 0 8px;font-size:12px;color:${C.accentInk}">✨ ${esc(label)}</p><ul style="padding-inline-start:18px;padding-right:18px;margin:0">${pts}</ul>`) : "") +
      (rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px">${rows}</table>` : "") + button(origin + "/#/home", "افتح مجتمع بلس");
    const footer = "تصلك هذه الرسالة لأنك فعّلت النشرة الأسبوعية.";
    const o = { footer, unsubscribeUrl, prefsUrl };
    const text = [`أسبوعك في مجتمع بلس — ${counts.posts} منشوراً`, ...points.map(x => "• " + x.text), "", "(ملخص مولّد آلياً)"].join("\n") + textFooter(o);
    return { subject, preheader, html: layout({ title: subject, preheader, body, footer, unsubscribeUrl, prefsUrl, origin }), text };
  }
};

/** small standalone RTL page for the one-click unsubscribe landing (served from /api/email/unsubscribe) */
function page({ title, body }) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{margin:0;background:${C.bg};font-family:${FONT};color:${C.ink};display:grid;place-items:center;min-height:100vh}main{background:#fff;border:1px solid ${C.line};border-radius:18px;padding:28px;max-width:420px;margin:16px;text-align:right}h1{font-size:20px;margin:0 0 10px}p{color:${C.text2};line-height:1.8}button,a.b{display:inline-block;background:${C.brand};color:#fff;border:0;border-radius:12px;padding:12px 22px;font:inherit;font-weight:bold;cursor:pointer;text-decoration:none}button:focus-visible,a:focus-visible{outline:3px solid ${C.brand2};outline-offset:2px}a{color:${C.brand}}@media (prefers-color-scheme:dark){body{background:#0b0a10;color:#f3f1fa}main{background:#15131d;border-color:#24212f}p{color:#cfcadf}}</style></head>
<body><main>${body}</main></body></html>`;
}
module.exports = { ...T, layout, page, esc };
