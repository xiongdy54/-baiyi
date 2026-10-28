// @runtime: system-node
// D248 / T1：BDI 合同文档与注册表逐字一致（docs/bdi-catalog.md / docs/bdi-metrics.md / catalog.generated.ts）。
// 运行：node tests/behavior-catalog-docs.test.cjs（或 node scripts/run-tests.mjs behavior-catalog-docs）
// 覆盖（设计稿 §14 behavior-catalog-docs）：三份生成物与生成器输出逐字节相同；指标/信号注册表自洽；
//   每个 metric/signal 都有唯一条目且覆盖键合法；文档点到了全部事件。
"use strict";
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const reg = require(path.join(ROOT, "electron", "behavior", "registry.js"));
const met = require(path.join(ROOT, "electron", "behavior", "metrics.js"));
const sig = require(path.join(ROOT, "electron", "behavior", "signals.js"));

let pass = 0;
let fail = 0;
function check(name, cond, expected, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`);
  }
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

(async () => {
  const docs = await import(pathToFileURL(path.join(ROOT, "scripts", "gen-bdi-docs.mjs")).href);
  const catTs = await import(pathToFileURL(path.join(ROOT, "scripts", "gen-bdi-catalog.mjs")).href);

  console.log("== A 生成物与生成器逐字节一致（禁止手改） ==");
  const catalogDoc = read("docs/bdi-catalog.md");
  const metricsDoc = read("docs/bdi-metrics.md");
  const generatedTs = read("src/lib/behavior/catalog.generated.ts");
  check("docs/bdi-catalog.md = buildCatalogDoc()", catalogDoc === docs.buildCatalogDoc(), "逐字一致", "存在漂移");
  check("docs/bdi-metrics.md = buildMetricsDoc()", metricsDoc === docs.buildMetricsDoc(), "逐字一致", "存在漂移");
  check("src/lib/behavior/catalog.generated.ts = buildCatalogTs()", generatedTs === catTs.buildCatalogTs(), "逐字一致", "存在漂移");
  check("三份生成物均以换行结尾", [catalogDoc, metricsDoc, generatedTs].every((t) => t.endsWith("\n")), "均以 \\n 结尾", "存在缺尾换行");

  console.log("== B 文档覆盖全部事件 ==");
  const missing = reg.EVENT_NAMES.filter((n) => !catalogDoc.includes(`\`${n}\``));
  check("catalog 文档点到每个事件（反引号全名）", missing.length === 0, "全部出现", missing);
  const missingMetrics = met.METRIC_IDS.filter((id) => !metricsDoc.includes(id.replace(/\|/g, "\\|")));
  check("metrics 文档点到每个指标 id", missingMetrics.length === 0, "全部出现", missingMetrics);
  const missingSignals = sig.SIGNAL_IDS.filter((id) => !metricsDoc.includes(`\`${id}\``));
  check("metrics 文档点到每个信号 id", missingSignals.length === 0, "全部出现", missingSignals);
  check("catalog 文档写明 CATALOG_VERSION", catalogDoc.includes(`CATALOG_VERSION = ${reg.CATALOG_VERSION}`), reg.CATALOG_VERSION, "缺版本");
  check("metrics 文档写明两个注册表版本", metricsDoc.includes(`METRICS_VERSION = ${met.METRICS_VERSION}`) && metricsDoc.includes(`SIGNALS_VERSION = ${sig.SIGNALS_VERSION}`), "两处版本", "缺版本");

  console.log("== C 指标注册表自洽 ==");
  const REQUIRED = ["id", "unit", "grain", "source", "coverageKey", "definition", "nullPolicy", "estimatePolicy", "additivity", "version"];
  const badFields = met.METRICS.filter((m) => REQUIRED.some((k) => m[k] === undefined || m[k] === null || m[k] === ""));
  check("每个指标十项必填字段齐全", badFields.length === 0, "全部齐全", badFields.map((m) => m.id));
  const dupIds = met.METRIC_IDS.filter((id, i) => met.METRIC_IDS.indexOf(id) !== i);
  check("指标 id 唯一", dupIds.length === 0, "无重复", dupIds);
  const COVERAGE = new Set(["events", "attention", "review", "reading", "domains", "sessions", "ipc"]);
  const badCov = met.METRICS.filter((m) => !COVERAGE.has(m.coverageKey));
  check("coverageKey 只在 coverage_day 的六个枚举里", badCov.length === 0, "全部合法", badCov.map((m) => `${m.id}:${m.coverageKey}`));
  check("每个指标都有 version=1", met.METRICS.every((m) => m.version === 1), "全部 1", met.METRICS.filter((m) => m.version !== 1).map((m) => m.id));
  const cols = met.DOMAIN_COLUMNS.map((c) => c.column);
  check("domain_day 列不重复", new Set(cols).size === cols.length, "无重复", cols.filter((c, i) => cols.indexOf(c) !== i));
  check("domain_day 列都带单位", met.DOMAIN_COLUMNS.every((c) => typeof c.unit === "string" && c.unit !== ""), "全部带单位", "存在缺单位");

  console.log("== D 信号注册表自洽 ==");
  const sDup = sig.SIGNAL_IDS.filter((id, i) => sig.SIGNAL_IDS.indexOf(id) !== i);
  check("信号 id 唯一", sDup.length === 0, "无重复", sDup);
  check("信号极性只取 +1/-1", sig.SIGNALS.every((s) => s.polarity === 1 || s.polarity === -1), "全部合法", sig.SIGNALS.filter((s) => s.polarity !== 1 && s.polarity !== -1).map((s) => s.id));
  check("每个信号都有真源说明与单位", sig.SIGNALS.every((s) => s.doc && s.unit && typeof s.note === "string"), "全部齐全", "存在缺项");
  check("负极性信号只限于 skip/defer/delete 四类", JSON.stringify(sig.SIGNALS.filter((s) => s.polarity === -1).map((s) => s.id).sort()),
    JSON.stringify(["card_delete", "extract_defer", "item_delete", "skip"]));

  console.log(`\n==== behavior-catalog-docs ${pass}/${pass + fail} 断言 ====`);
  if (fail > 0) console.log(`  失败 ${fail} 项`);
  process.exitCode = fail === 0 ? 0 : 1;
})().catch((e) => {
  console.error("顶层异常：" + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
