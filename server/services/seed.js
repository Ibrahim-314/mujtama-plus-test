/* Demo seed: reuses the web app's own seed so server and offline modes show the same world. */
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { now } = require("../lib/core");

function loadClientSeed(root) {
  const ctx = vm.createContext({ console, localStorage: { getItem: () => null, setItem: () => { } }, window: {}, Date, Math, JSON });
  vm.runInContext(fs.readFileSync(path.join(root, "store.js"), "utf8"), ctx);
  const v12 = fs.readFileSync(path.join(root, "v12.js"), "utf8");
  const mig = v12.slice(v12.indexOf("(function migrate()"), v12.indexOf("})();", v12.indexOf("(function migrate()")) + 5);
  vm.runInContext("DB = seed(); DB.muted ||= {}; " + mig + "; globalThis.__seed = DB;", ctx);
  return ctx.__seed;
}

module.exports = async function seed(ctx, root) {
  const { db } = ctx;
  if ((await db.get("SELECT COUNT(*) n FROM posts")).n > 0) return false;
  const S = loadClientSeed(root);
  const uid = (x) => x === "u0" ? null : "u_demo" + x.slice(1).padStart(4, "0"); // stable demo ids
  const pid = (x) => x;
  await db.tx(async t => {
    for (const u of S.users) if (uid(u.id)) await t.run("INSERT INTO users(id,handle,name,bio,color,badge,role,prefs,created_at) VALUES($1,$2,$3,$4,$5,$6,'user',$7,$8) ON CONFLICT DO NOTHING", [uid(u.id), u.handle, u.name, u.bio, u.color, u.badge, { onboarded: true, interests: u.topics }, u.joinedAt]);
    for (const c of S.communities) await t.run("INSERT INTO communities(id,name,descr,topic,type,color,owner,rules,settings,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [c.id, c.name, c.desc, c.topic, c.type, c.color, uid(c.owner), c.rules, { requireApproval: !!c.requireApproval }, c.createdAt]);
    for (const m of S.memberships) if (uid(m.user)) await t.run("INSERT INTO memberships(community,user_id,role,joined_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [m.community, uid(m.user), m.role, m.joinedAt]);
    for (const e of S.events) await t.run("INSERT INTO events(id,name,descr,starts_at,place,organizer,community,color,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [e.id, e.name, e.desc, e.startsAt, e.place, uid(e.organizer), e.community, e.color, now()]);
    for (const e of S.events) for (const g of e.going) if (uid(g)) await t.run("INSERT INTO event_rsvps(event_id,user_id,kind,at) VALUES($1,$2,'going',$3) ON CONFLICT DO NOTHING", [e.id, uid(g), now()]);
    const tags = require("../lib/core").Classifier.hashtags;
    for (const p of S.posts) {
      if (!uid(p.author)) continue;
      const data = {}; for (const k of ["media", "images", "video", "poll", "stances", "acceptedAnswer", "event", "translations"]) if (p[k] !== undefined && p[k] !== null) data[k] = p[k];
      if (data.poll) { data.poll = { ...data.poll, endsAt: new Date(Date.now() + 7 * 864e5).toISOString() }; delete data.poll.voters; }
      if (data.stances) data.stances = data.stances.map(s => ({ ...s }));
      await t.run(`INSERT INTO posts(id,author,type,title,text,topic,lang,visibility,status,community,quote_of,repost_of,series,part,parts,sponsored,views,data,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,'public','published',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [pid(p.id), uid(p.author), p.type, p.title, p.text || "", p.topic, p.lang || (/[\u0600-\u06FF]/.test(p.text + (p.title || "")) ? "ar" : "en"), p.community, p.quoteOf, p.repostOf, p.series || null, p.part || null, p.parts || null, p.sponsored ? 1 : 0, p.views || 0, data, p.createdAt]);
      for (const tag of tags(`${p.title || ""} ${p.text}`)) await t.run("INSERT INTO post_hashtags(post_id,tag,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [p.id, tag, p.createdAt]);
    }
    for (const c of S.comments) if (uid(c.author)) await t.run("INSERT INTO comments(id,post,author,parent,text,created_at) VALUES($1,$2,$3,$4,$5,$6)", [c.id, c.post, uid(c.author), c.parent, c.text, c.createdAt]);
    for (const f of S.follows) if (uid(f.from) && uid(f.to)) await t.run("INSERT INTO follows(src,dst,at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [uid(f.from), uid(f.to), f.at]);
    for (const r of S.reactions) if (uid(r.user)) await t.run("INSERT INTO reactions(target,user_id,type,at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [r.target, uid(r.user), r.type, r.at]);
  });
  return true;
};
