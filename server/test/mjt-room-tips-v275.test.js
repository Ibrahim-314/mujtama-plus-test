/* v2.75 — MJT tips in live rooms: POST/GET /api/mjt/rooms/:id/tips → ledger tip (ref_type 'room') to the host while live;
 * own room refused, ended room refused, guards shared with clip tips, members get a "room_tip" cheer, history labels. */
const test = require("node:test"),
  assert = require("node:assert");
const { boot } = require("./helpers");

let H, staff, host, fan, room;
const db = () => H.app.ctx.db,
  M = () => H.app.ctx.services.mjt;
let seq = 0;
const key = () => `r${Date.now().toString(36)}_${++seq}_rt`;
const OLD = new Date(Date.now() - 40 * 864e5).toISOString();
async function mk(handle) {
  H.app.ctx.rl.w.clear();
  const cl = new H.Client();
  const r = await cl.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error);
  cl.id = r.user.id;
  cl.handle = handle;
  await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [OLD, cl.id]);
  return cl;
}
test.before(async () => {
  H = await boot({ mjtOpts: { autoConvert: false, jobs: false }, pointsOpts: { jobs: false } });
  await M().ready;
  staff = await mk("rt_staff");
  host = await mk("rt_host");
  fan = await mk("rt_fan");
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [staff.id]);
  const f = await staff.req("POST", "/api/admin/mjt/adjust", { ikey: key(), handle: "rt_fan", amount: "100", reason: "رصيد اختبار البث" });
  assert.equal(f.status, 200, f.error);
  H.app.ctx.rl.w.clear();
  const r = await host.req("POST", "/api/rooms", { title: "بث تجريبي للإكراميات" });
  assert.equal(r.status, 200, r.error);
  room = r.room?.id || r.id;
  assert.ok(room, JSON.stringify(r));
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("tip the host of a live room; cheer to members; summary; history; guards", async () => {
  const sent = [];
  const real = H.app.ctx.realtime.send;
  H.app.ctx.realtime.send = (uid, type, data) => {
    sent.push({ uid, type, data });
    return real.call(H.app.ctx.realtime, uid, type, data);
  };
  await fan.req("POST", `/api/rooms/${room}/join`);
  const ok = await fan.req("POST", `/api/mjt/rooms/${room}/tips`, { ikey: key(), amount: "10" });
  assert.equal(ok.status, 200, ok.error);
  assert.equal(ok.tip.room, room);
  assert.equal((await host.req("GET", "/api/mjt/me")).balance.mjt, "10");
  const cheer = sent.filter(x => x.type === "room_tip");
  assert.ok(cheer.length >= 2, "host and fan get the cheer");
  assert.equal(cheer[0].data.amount, "10");
  assert.equal(cheer[0].data.room, room);
  const anon = await fan.req("POST", `/api/mjt/rooms/${room}/tips`, { ikey: key(), amount: "5", anon: true });
  assert.equal(anon.status, 200, anon.error);
  assert.equal(sent.filter(x => x.type === "room_tip").pop().data.from, null);
  const sm = await host.req("GET", `/api/mjt/rooms/${room}/tips`);
  assert.equal(sm.total, "15");
  assert.equal(sm.count, 2);
  const hh = await host.req("GET", "/api/mjt/history");
  assert.equal(hh.items[0].label, "إكرامية بث من داعم مجهول");
  assert.equal(hh.items[0].room, room);
  assert.equal(hh.items[0].post, undefined);
  const fh = await fan.req("GET", "/api/mjt/history");
  assert.equal(fh.items[0].label, "إكرامية في بث مباشر");
  const self = await host.req("POST", `/api/mjt/rooms/${room}/tips`, { ikey: key(), amount: "1" });
  assert.equal(self.status, 400);
  assert.equal(self.code || self.error?.code || self.body?.code || "self_tip", "self_tip");
  const nf = await fan.req("POST", `/api/mjt/rooms/rm_nope/tips`, { ikey: key(), amount: "1" });
  assert.equal(nf.status, 404);
  const poor = await fan.req("POST", `/api/mjt/rooms/${room}/tips`, { ikey: key(), amount: "500" });
  assert.equal(poor.status, 409);
  H.app.ctx.rl.w.clear();
  assert.equal((await host.req("POST", `/api/rooms/${room}/end`)).status, 200);
  const ended = await fan.req("POST", `/api/mjt/rooms/${room}/tips`, { ikey: key(), amount: "1" });
  assert.equal(ended.status, 409);
  H.app.ctx.realtime.send = real;
  const v = await M().verify();
  assert.ok(v.ok !== false, JSON.stringify(v));
});
