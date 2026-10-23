/* ESLint flat config (Phase 1). Client files are classic scripts that share globals across files,
 * so cross-file `no-undef` is off there; everything else follows eslint:recommended. */
const js = require("@eslint/js"); const globals = require("globals");
const shared = { "no-unused-vars": ["warn", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }], "no-empty": ["error", { allowEmptyCatch: true }], "no-cond-assign": ["error", "except-parens"], eqeqeq: ["error", "smart"], "no-var": "error", "prefer-const": ["warn", { destructuring: "all" }] };
module.exports = [
  { ignores: ["dist/**", "node_modules/**", "server/node_modules/**", "vendor/**", "server/storage/**", "roadmap/**", "tests/visual/**"] },
  js.configs.recommended,
  // client classic scripts: a top-level declaration IS the cross-file API (PiAdapter, Cmd, Search…), so only locals are checked for "unused"
  { files: ["*.js", "video/**/*.js"], ignores: ["eslint.config.js", "sw.js"], languageOptions: { ecmaVersion: 2022, sourceType: "script", globals: { ...globals.browser, Pi: "readonly", qrcode: "readonly" } }, rules: { ...shared, "no-unused-vars": ["warn", { vars: "local", args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }], "no-undef": "off", "no-redeclare": "off", "no-func-assign": "off", "no-global-assign": "off" } },
  { files: ["sw.js"], languageOptions: { sourceType: "script", globals: globals.serviceworker }, rules: shared },
  { files: ["server/**/*.js", "tests/**/*.js", "eslint.config.js"], languageOptions: { ecmaVersion: 2022, sourceType: "commonjs", globals: { ...globals.node } }, rules: shared },
  // e2e + dev tools: code inside page.evaluate() runs in the page, so the app's page globals are declared here (v2.51)
  { files: ["tests/e2e/**/*.js"], languageOptions: { globals: { ...globals.browser, axe: "readonly", closeSheet: "readonly", DB: "readonly", refresh: "readonly", S: "readonly", MPDiscovery: "readonly", Remote: "readonly", save: "readonly", route: "readonly" } }, rules: { "no-redeclare": ["error", { builtinGlobals: false }] } },
  { files: ["tools/design-shots.mjs", "tools/flash-audit.mjs"], languageOptions: { globals: { ...globals.browser, Remote: "readonly", DB: "readonly", save: "readonly", axe: "readonly" } } },
  { files: ["tools/shots-*.js"], languageOptions: { ecmaVersion: 2022, sourceType: "commonjs", globals: { ...globals.node, ...globals.browser, refresh: "readonly", closeSheet: "readonly" } }, rules: shared },
  { files: ["tools/chromium.js"], languageOptions: { ecmaVersion: 2022, sourceType: "commonjs", globals: globals.node }, rules: shared },
  { files: ["tools/k6-load.js"], languageOptions: { sourceType: "module", globals: { __ENV: "readonly" } } },
  { files: ["tools/**/*.mjs"], languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: globals.node }, rules: shared }
];
