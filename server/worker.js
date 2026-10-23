/* Standalone media worker (Phase 13). Run any number of these next to the API:
 *   MEDIA_WORKER=external node server/server.js   # API only
 *   node server/worker.js                          # processing only (scale out horizontally) */
process.env.MEDIA_WORKER_ROLE = "worker";
const { createApp } = require("./server");
(async () => {
  const app = await createApp({ worker: true });
  app.ctx.queue.start();
  console.log(JSON.stringify({ msg: "media worker started", id: app.ctx.queue.workerId }));
  const stop = async () => { app.ctx.queue.stop(); await app.ctx.queue.drain(30e3); process.exit(0); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
})();
