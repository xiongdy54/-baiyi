// M7 card-vocab 播种回归（v32）：新 scope 首版 v1 生效 + 既有 v6 不受影响 + 幂等
// 运行：node_modules/.bin/electron tests/m7.prompts.test.cjs
// 隔离 userData：必须在 require electron/db.js 之前 setPath，避免触碰真实库。
const path = require("path");
const os = require("os");
const fs = require("fs");
const { app } = require("electron");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m7prompt-"));
app.setPath("userData", tmp);

const db = require("../electron/db");
const P = require("../electron/prompts");

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}

(async () => {
  await db.initDb();
  const vocab = db.getPromptTemplate("card-vocab");
  check("card-vocab 已播种 v1", vocab && vocab.version === 1, "v1", vocab && vocab.version);
  check("card-vocab 含四卡专属条款", vocab && vocab.content.includes("必产四张卡"), true, false);
  check("card-vocab 含挖空条款", vocab && vocab.content.includes("{{c1::}}"), true, false);
  const main = db.getPromptTemplate("card-generation");
  check("主制卡仍为 v6（不受 M7 影响）", main && main.version === 6, "v6", main && main.version);
  const before = db.listPromptTemplates().filter((t) => t.scope === "card-vocab").length;
  await db.ensurePromptTemplates();
  const after = db.listPromptTemplates().filter((t) => t.scope === "card-vocab").length;
  check("重复播种幂等（不增行）", before === after, before, after);
  check("CARD_VOCAB_PROMPT 已导出", typeof P.CARD_VOCAB_PROMPT === "string" && P.CARD_VOCAB_PROMPT.length > 500, true, false);
  console.log(`\nM7 prompts: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("异常", e); process.exit(1); });
