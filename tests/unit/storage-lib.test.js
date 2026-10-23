/* db storage helpers: key validation, import key mapping, tar reader (ustar, GNU long names, pax paths, gzip). */
const test = require("node:test"),
  assert = require("node:assert");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { execFileSync } = require("node:child_process");
const { validKey, mimeOf } = require("../../server/lib/storage");
const { keyFor, tarEntries } = require("../../server/scripts/import-media");

test("validKey accepts flat and chat/ keys only", () => {
  for (const k of ["md_abc.png", "pf-u1-avatar-ab12-256.webp", "chat/cb_x1", "md_1_360_000.ts"]) assert.ok(validKey(k), k);
  for (const k of ["", "../x", "chat/../x", "a/b/c", "/abs", "a b.png", "chat/..", ".", "x\\y", "a".repeat(121)]) assert.ok(!validKey(k), k);
  assert.equal(mimeOf("a.png"), "image/png");
  assert.equal(mimeOf("noext"), "application/octet-stream");
});
test("keyFor maps archive paths to storage keys", () => {
  assert.equal(keyFor("./md_1.png"), "md_1.png");
  assert.equal(keyFor("tmp/storage/md_1.png"), "md_1.png");
  assert.equal(keyFor("./chat/cb_1"), "chat/cb_1");
  assert.equal(keyFor("storage/chat/cb_1"), "chat/cb_1");
  assert.equal(keyFor("../x"), null);
  assert.equal(keyFor("./"), null);
});
test("tarEntries reads GNU long names, pax paths and gzip", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mp-tar-")),
    long = "md_" + "x".repeat(110) + ".png";
  fs.mkdirSync(path.join(d, "src", "chat"), { recursive: true });
  fs.writeFileSync(path.join(d, "src", long), "L");
  fs.writeFileSync(path.join(d, "src", "chat", "cb_1"), Buffer.alloc(1500, 7));
  const out = {};
  for (const fmt of ["gnu", "pax", "ustar"]) {
    const t = path.join(d, fmt + ".tar");
    try {
      execFileSync("tar", ["--format=" + fmt, "-cf", t, "-C", path.join(d, "src"), "."], { stdio: "ignore" });
    } catch {
      continue;
    }
    out[fmt] = [...tarEntries(t)].map(e => [keyFor(e.name), e.data.length]).sort();
  }
  assert.deepEqual(
    out.gnu,
    [
      ["chat/cb_1", 1500],
      [long, 1]
    ].sort()
  );
  assert.deepEqual(out.pax, out.gnu);
  execFileSync("sh", ["-c", `gzip -c "${path.join(d, "gnu.tar")}" > "${path.join(d, "g.tar.gz")}"`]);
  assert.deepEqual([...tarEntries(path.join(d, "g.tar.gz"))].map(e => [keyFor(e.name), e.data.length]).sort(), out.gnu);
  fs.rmSync(d, { recursive: true, force: true });
});
