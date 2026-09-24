// v48.22 M16 批次 5：AI 推送引擎本地因子层（§6.4.1 两段式 E1）单元测试（纯 node，无 electron）
// @runtime: node  @tier: 1  @gui: false  @id: AINEXT  @timeout: 120
// 契约：确定性（同输入同输出）、因子单调性、多样性降权、理由可验证、不修改入参
const { scoreExtracts, explainExtract, rankExtracts } = require("../electron/aiNextExtract.js");

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}

const DAY = 86400000;
const NOW = Date.parse("2026-09-25T00:00:00Z");
const mk = (id, over = {}) => ({
  id,
  priority: 50,
  topicNextAt: NOW,
  postponeCount: 0,
  depth: 1,
  libraryItemId: "book-A",
  ...over
});

console.log("== A1 确定性与边界 ==");
const input = [mk("e1"), mk("e2", { priority: 20 }), mk("e3", { libraryItemId: "book-B", depth: 2 })];
const r1 = JSON.stringify(scoreExtracts(input, NOW).map((x) => [x.id, x.score]));
const r2 = JSON.stringify(scoreExtracts(input, NOW).map((x) => [x.id, x.score]));
check("同一输入两次调用逐字节相等（零随机源）", r1 === r2, r1, r2);
check("空输入 → 空输出", scoreExtracts([], NOW).length === 0, 0, scoreExtracts([], NOW).length);
check("非数组输入不抛错（按空处理）", scoreExtracts(null, NOW).length === 0, 0, scoreExtracts(null, NOW).length);

console.log("== A2 因子单调性 ==");
const byPriority = scoreExtracts([mk("lo", { priority: 90 }), mk("hi", { priority: 10 })], NOW);
check("优先级数字越小越靠前（原样尊重不反转）", byPriority[0].id === "hi", "hi", byPriority.map((x) => x.id));
const byDue = scoreExtracts(
  [mk("fresh", { topicNextAt: NOW }), mk("overdue", { topicNextAt: NOW - 20 * DAY })],
  NOW
);
check("逾期更久更靠前", byDue[0].id === "overdue", "overdue", byDue.map((x) => x.id));
const byStale = scoreExtracts([mk("new0", { postponeCount: 0 }), mk("stale5", { postponeCount: 5 })], NOW);
check("搁置更久（推迟计数大）更靠前", byStale[0].id === "stale5", "stale5", byStale.map((x) => x.id));
const byDepth = scoreExtracts(
  [mk("top", { depth: 1, libraryItemId: "b1" }), mk("deep", { depth: 3, libraryItemId: "b2" })],
  NOW
);
check("子摘录（更深、更具体）略优先", byDepth[0].id === "deep", "deep", byDepth.map((x) => x.id));

console.log("== A3 多样性降权（防隧道） ==");
const diverse = scoreExtracts(
  [mk("a1"), mk("a2"), mk("b1", { libraryItemId: "book-B" })],
  NOW
);
check("同书第二条被降权（不得占据第 2 位）", diverse[1].id === "b1", "b1", diverse.map((x) => x.id));
check("同书第二条 diversityBurst=1", diverse.find((x) => x.id === "a2")?.diversityBurst === 1, 1, diverse.find((x) => x.id === "a2")?.diversityBurst);
check("第 1 位未被降权（diversityBurst=0）", diverse[0].diversityBurst === 0, 0, diverse[0].diversityBurst);

console.log("== A4 理由可验证且不编造 ==");
const entry = scoreExtracts([mk("why", { priority: 30, postponeCount: 2, topicNextAt: NOW - 3 * DAY })], NOW)[0];
const reason = explainExtract(entry);
check("理由含该条自身优先级数字", reason.includes("优先级 30"), reason);
check("理由含逾期天数（取自自身因子）", reason.includes("逾期 3 天"), reason);
check("理由含推迟次数", reason.includes("推迟 2 次"), reason);
check("理由含得分（数值可对账）", reason.includes(entry.score.toFixed(3)), reason);

console.log("== A5 rankExtracts 包装层 ==");
const before = JSON.stringify(input);
const ranked = rankExtracts(input, NOW);
check("不修改入参（调用前后入参逐字节相等）", JSON.stringify(input) === before, "相等", "已改动");
check("输出长度与入参一致", ranked.length === input.length, input.length, ranked.length);
check("每条都带 engineScore 与 engineReason", ranked.every((x) => typeof x.engineScore === "number" && typeof x.engineReason === "string"), true, ranked.map((x) => typeof x.engineScore));
check("engineScore 为有限数（无 NaN）", ranked.every((x) => Number.isFinite(x.engineScore)), true, ranked.map((x) => x.engineScore));
const orig1 = input.find((x) => x.id === "e1");
check("原字段未被污染（无 engineScore 残留）", orig1.engineScore === undefined, undefined, orig1.engineScore);

console.log(`\n==== ainextextract.test：${pass} 通过 / ${fail} 失败 ====`);
process.exit(fail === 0 ? 0 : 1);
