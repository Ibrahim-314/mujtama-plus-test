/* Community permission engine (v2.56.0, «المجتمع 3.0» stage 1) — the ONE place that answers
 * "may this member do X in this community?" and "may this member act on that member?".
 *
 * Resolution: base role (memberships.role: owner > admin > moderator > member; muted/pending/banned are statuses that
 * mirror into role for backward compatibility) → custom roles (member_roles → community_roles.perms) which can only ADD
 * keys, never the owner-only ones → result. Hierarchy: every action on another member requires a strictly higher rank;
 * a muted/banned member keeps the rank of the role they held before (memberships.prev_role).
 *
 * The base grants reproduce EXACTLY what the four services (communities, cspace, cmod, knowledge) enforced up to v2.55
 * (parity is asserted in server/test/cperm.test.js). Legacy names (CanPost, CanManageMembers, …) still resolve. */
const RANK = { owner: 100, admin: 80, moderator: 60, member: 20, muted: 10, pending: 0, banned: -1 };
const STAFF = ["owner", "admin", "moderator"];
const ACTIVE = (r) => !!r && !["pending", "banned"].includes(r);

/* 31 keys in 5 groups. Arabic labels feed the roles editor (v2.57). */
const GROUPS = {
  content: { label: "المحتوى", keys: { post: "النشر", comment: "التعليق", upload_media: "رفع الوسائط", post_links: "نشر الروابط", poll: "الاستطلاعات", event: "إنشاء فعالية", pin: "تثبيت المنشورات", announce: "النشر في قنوات الإعلانات" } },
  moderation: { label: "الإشراف", keys: { queue_review: "مراجعة الطابور", remove_content: "حذف المحتوى", warn: "إنذار", mute: "كتم", ban: "حظر", view_notes: "ملاحظات المشرفين", export_log: "سجل الإشراف وتصديره", view_automod: "رؤية القواعد الآلية" } },
  members: { label: "الأعضاء", keys: { approve_requests: "قبول طلبات الانضمام", invite: "الدعوة", manage_roles: "إدارة الأدوار الأدنى" } },
  admin: { label: "الإدارة", keys: { edit_identity: "تعديل الهوية", manage_channels: "القنوات", edit_rules: "القواعد", manage_automod: "الإشراف الآلي", edit_settings: "الإعدادات العامة", manage_integrations: "التكاملات والشراكات", view_analytics: "التحليلات", view_health: "تقرير الصحة", manage_challenges: "التحديات" } },
  knowledge: { label: "المعرفة", keys: { wiki_edit: "تعديل الويكي", wiki_lock: "قفل الصفحات وإدارتها", faq_edit: "الأسئلة الشائعة" } }
};
const KEYS = Object.values(GROUPS).flatMap(g => Object.keys(g.keys));
const MEMBER = ["post", "comment", "upload_media", "post_links", "poll", "event", "invite", "wiki_edit"];
const MOD = [...MEMBER, "pin", "announce", "queue_review", "remove_content", "warn", "mute", "ban", "view_notes", "export_log", "view_automod", "approve_requests", "view_analytics", "manage_challenges", "wiki_lock", "faq_edit"];
const ADMIN = [...MOD, "manage_roles", "edit_identity", "manage_channels", "manage_automod", "manage_integrations", "view_health"];
const BASE = { owner: KEYS.slice(), admin: ADMIN, moderator: MOD, member: MEMBER, muted: [], pending: [], banned: [] }; // v2.62: a muted member no longer comments (T5 enforces it in content.js)
/* never grantable through a custom role */
const OWNER_ONLY = ["edit_settings", "edit_rules", "manage_roles"];
/* legacy PERMS names (communities.js ≤ v2.55) */
const LEGACY = { CanPost: "post", CanComment: "comment", CanInvite: "invite", CanModerate: "view_analytics", CanEditRules: "edit_settings", CanManageMembers: "manage_roles", CanManagePosts: "queue_review" };

const rankOf = (m) => m ? (["muted", "banned"].includes(m.role) && m.prev_role ? Math.max(RANK[m.prev_role] ?? 0, 0) : RANK[m.role] ?? 0) : -2;

module.exports = function cperm(db, E) {
  const customCache = new Map(); // community → { at, has }
  const invalidate = (cid) => customCache.delete(cid);
  async function hasCustom(cid) {
    const c = customCache.get(cid); if (c && Date.now() - c.at < 30e3) return c.has;
    const has = !!(await db.get("SELECT 1 x FROM community_roles WHERE community=$1 AND is_system=0 LIMIT 1", [cid]).catch(() => null));
    customCache.set(cid, { at: Date.now(), has }); return has;
  }
  async function member(cid, uid) { return uid ? await db.get("SELECT role, status, prev_role, joined_at, muted_until FROM memberships WHERE community=$1 AND user_id=$2", [cid, uid]) : null; }
  /** all keys this user holds in this community */
  async function keys(cid, uid, m) {
    if (m === undefined) m = await member(cid, uid);
    const out = new Set(m ? BASE[m.role] || [] : []);
    if (m && ["member", "moderator", "admin"].includes(m.role) && await hasCustom(cid)) {
      for (const r of await db.all("SELECT r.perms FROM member_roles mr JOIN community_roles r ON r.id=mr.role_id WHERE mr.community=$1 AND mr.user_id=$2", [cid, uid]))
        for (const k of (Array.isArray(r.perms) ? r.perms : [])) if (KEYS.includes(k) && !OWNER_ONLY.includes(k)) out.add(k);
    }
    return out;
  }
  const norm = (k) => LEGACY[k] || k;
  async function has(cid, uid, key) { return (await keys(cid, uid)).has(norm(key)); }
  /** throws 403 unless allowed; returns the membership row (role, status, …) */
  async function need(cid, uid, key, msg) {
    const m = await member(cid, uid);
    if (!(await keys(cid, uid, m)).has(norm(key))) throw E.forbid(msg);
    return m;
  }
  /** strict hierarchy: actor must outrank target (target's pre-sanction role counts) */
  async function canAct(cid, actorUid, targetUid) {
    if (actorUid === targetUid) return false;
    const [a, t] = await Promise.all([member(cid, actorUid), member(cid, targetUid)]);
    return !!a && ACTIVE(a.role) && a.role !== "muted" && rankOf(a) > rankOf(t);
  }
  async function needAct(cid, actorUid, targetUid, msg) { if (!(await canAct(cid, actorUid, targetUid))) throw E.forbid(msg || "لا يمكنك اتخاذ إجراء على عضو في رتبتك أو أعلى"); }
  /** the highest base role an actor may hand out: one below its own rank (owner may appoint admins) */
  const assignable = (actorRole) => ["admin", "moderator", "member"].filter(r => RANK[r] < (RANK[actorRole] ?? 0));
  return { member, keys, has, need, canAct, needAct, assignable, invalidate, hasCustom };
};
module.exports.RANK = RANK;
module.exports.STAFF = STAFF;
module.exports.ACTIVE = ACTIVE;
module.exports.GROUPS = GROUPS;
module.exports.KEYS = KEYS;
module.exports.BASE = BASE;
module.exports.OWNER_ONLY = OWNER_ONLY;
module.exports.LEGACY = LEGACY;
module.exports.rankOf = rankOf;
