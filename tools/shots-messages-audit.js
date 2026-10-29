/* Audit only (not shipped): screenshots of the messages page with the demo chats, phone light/dark + desktop.
 *   node tools/shots-messages-audit.js <outDir> */
process.env.DEMO_MESSAGES = "1";
const path = require("node:path"), fs = require("node:fs");
const { startStack, onboard, MOBILE, DESKTOP } = require("../tests/e2e/harness");
(async () => {
  const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
  const S = await startStack(); const report = [];
  const run = async (name, opts) => {
    const ctx = await S.browser.newContext({ ...opts, reducedMotion: "reduce" }); const P = await ctx.newPage(); const errs = [];
    P.on("pageerror", (e) => errs.push("pageerror: " + e.message)); P.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 200)); });
    await onboard(P, S.base, "audit_" + name, "هيمو");
    const me = await P.evaluate(async () => (await (await fetch("/api/me")).json()).user.id);
    await S.app.ctx.services.demoMessages.seedFor(me);
    await P.evaluate(() => { document.querySelectorAll(".toast,#toasts").forEach((x) => x.remove()); });
    const shot = async (n) => { await P.waitForTimeout(500); await P.evaluate(() => document.querySelectorAll(".toast,#toasts>*").forEach((x) => x.remove())); await P.screenshot({ path: path.join(out, `${name}-${n}.png`) });
      const ov = await P.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (ov > 1) errs.push(`overflow ${n}: ${ov}px`); };
    await P.goto(S.base + "/?nosw#/messages"); await P.waitForSelector(".cm-row"); await shot("1-list");
    await P.evaluate(() => window.scrollTo(0, 99999)); await shot("2-list-bottom"); await P.evaluate(() => window.scrollTo(0, 0));
    const rows = await P.$$eval(".cm-row", (r) => r.map((x) => x.getAttribute("href") || x.dataset.cid || x.textContent.slice(0, 30)));
    report.push(name + " rows: " + rows.length);
    await P.click(".cm-row"); await P.waitForSelector("#cm-thread .cm-m"); await shot("3-thread-first");
    await P.goto(S.base + "/?nosw#/messages"); await P.waitForSelector(".cm-row");
    const grp = await P.$$(".cm-row"); await grp[Math.min(3, grp.length - 1)].click(); await P.waitForSelector("#cm-thread .cm-m"); await shot("4-thread-2");
    await P.evaluate(() => { const t = document.querySelector("#cm-thread"); (t?.closest(".cm-scroll") || document.scrollingElement).scrollTop = 0; window.scrollTo(0, 0); }); await shot("5-thread-top");
    const info = await P.$("#cm-info, [aria-label='معلومات المحادثة'], .cm-hd [data-info]"); if (info) { await info.click(); await shot("6-info"); }
    await P.goto(S.base + "/?nosw#/messages"); await P.waitForSelector(".cm-row");
    const nb = await P.$("#cm-new, [aria-label*='محادثة جديدة']"); if (nb) { await nb.click(); await shot("7-new"); }
    report.push(name + " errors: " + JSON.stringify(errs));
    await ctx.close();
  };
  await run("phone", MOBILE);
  await run("dark", { ...MOBILE, colorScheme: "dark" });
  await run("desk", DESKTOP);
  fs.writeFileSync(path.join(out, "report.txt"), report.join("\n")); console.log(report.join("\n"));
  await S.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
