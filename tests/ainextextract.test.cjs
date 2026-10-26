// @runtime: node  @tier: 1  @gui: false  @id: AINEXT  @timeout: 120
// 运行：node tests/ainextextract.test.cjs
// v48.22 M16 批次 5：AI 推送引擎本地因子层（§6.4.1 两段式 E1）单元测试（纯 node，无 electron）
// 契约：确定性（同输入同输出）、因子单调性、多样性降权、理由可验证、不修改入参
const { scoreExtracts, explainExtract, rankExtracts, rankWithAI, rerankFingerprint } = require("../electron/aiNextExtract.js");

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
// v49.62 / D233：方向统一为「数字越大越优先」（存量值由 schemaVersion v5 翻转 p→100−p，与改前同分）
const byPriority = scoreExtracts([mk("lo", { priority: 10 }), mk("hi", { priority: 90 })], NOW);
check("优先级数字越大越靠前（D233 起，原样尊重不反转）", byPriority[0].id === "hi", "hi", byPriority.map((x) => x.id));
// 翻转等价：新值 p' 的 userPriority 与改前 1 − p/100（p＝100 − p'）逐值相等
check(
  "翻转等价：userPriority(p') ＝ 改前 1 − (100 − p')/100",
  [0, 10, 37, 50, 90, 100].every((p) => Math.abs(scoreExtracts([mk("x", { priority: p })], NOW)[0].factors.userPriority - (1 - (100 - p) / 100)) < 1e-12),
  true,
  [0, 10, 37, 50, 90, 100].map((p) => scoreExtracts([mk("x", { priority: p })], NOW)[0].factors.userPriority)
);
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

console.log("== A6 AI 重排层（E1 第二半）：本地裁决 + 失败回退 ==");
const aiItems = [
  mk("x1", { priority: 50, libraryItemId: "b1" }),
  mk("x2", { priority: 50, libraryItemId: "b2" }),
  mk("x3", { priority: 50, libraryItemId: "b3" })
];
const localOrder = rankExtracts(aiItems, NOW).map((e) => e.id).join(",");
const fakeOrder = (order) => async () => JSON.stringify({ order });
(async () => {
  const okRes = await rankWithAI(aiItems, NOW, fakeOrder([{ id: "x3", reason: "内容更接近当前主题" }, { id: "x1", reason: "优先级与逾期都靠前" }]));
  check("AI 重排：usedAI=true 且按其顺序", okRes.usedAI === true && okRes.items[0].id === "x3" && okRes.items[1].id === "x1", "x3,x1", okRes.items.map((e) => e.id).join(","));
  check("AI 重排：未提到的条目按本地序追加（不丢条）", okRes.items.length === 3 && okRes.items[2].id === "x2", "3 条且 x2 殿后", okRes.items.map((e) => e.id).join(","));
  check("AI 重排：理由带 AI：前缀且保留本地理由", String(okRes.items[0].engineReason).startsWith("AI：") && String(okRes.items[0].engineReason).includes("优先级"), okRes.items[0].engineReason);

  const badId = await rankWithAI(aiItems, NOW, fakeOrder([{ id: "不存在的卡", reason: "编造" }, { id: "x2", reason: "ok" }]));
  check("越界 id 被丢弃但其余生效", badId.usedAI === true && badId.items[0].id === "x2", "x2 首位", badId.items.map((e) => e.id).join(","));
  check("越界 id 留痕（issues 含 UNKNOWN_ID）", badId.issues.some((i) => i.code === "UNKNOWN_ID"), true, JSON.stringify(badId.issues));

  const fabNum = await rankWithAI(aiItems, NOW, fakeOrder([{ id: "x1", reason: "这条比另外 7 条都重要" }]));
  check("理由含编造数字 ⇒ 该条理由被清空（座位保留）", fabNum.usedAI === true && !String(fabNum.items[0].engineReason).startsWith("AI："), fabNum.items[0].engineReason);
  check("编造数字留痕（FABRICATED_NUMBER）", fabNum.issues.some((i) => i.code === "FABRICATED_NUMBER"), true, JSON.stringify(fabNum.issues));

  const throwRes = await rankWithAI(aiItems, NOW, async () => { throw new Error("模拟网关失败"); });
  check("AI 失败 ⇒ 回退本地序且 usedAI=false", throwRes.usedAI === false && throwRes.items.map((e) => e.id).join(",") === localOrder, localOrder, throwRes.items.map((e) => e.id).join(","));
  check("AI 失败留痕（AI_CALL_FAILED）", throwRes.issues.some((i) => i.code === "AI_CALL_FAILED"), true, JSON.stringify(throwRes.issues));

  const junk = await rankWithAI(aiItems, NOW, async () => "这不是 JSON");
  check("输出不可解析 ⇒ 回退本地序", junk.usedAI === false && junk.items.map((e) => e.id).join(",") === localOrder, localOrder, junk.items.map((e) => e.id).join(","));
  const emptyOrder = await rankWithAI(aiItems, NOW, fakeOrder([]));
  check("空 order ⇒ 回退本地序（EMPTY_ORDER）", emptyOrder.usedAI === false && emptyOrder.issues.some((i) => i.code === "EMPTY_ORDER"), true, JSON.stringify(emptyOrder.issues));
  const noAI = await rankWithAI(aiItems, NOW, null);
  check("未提供 AI 调用 ⇒ 直接本地序（离线回退）", noAI.usedAI === false && noAI.items.map((e) => e.id).join(",") === localOrder, localOrder, noAI.items.map((e) => e.id).join(","));

  const many = Array.from({ length: 25 }, (_, i) => mk(`m${i}`, { priority: 50 }));
  let seenPayload = null;
  await rankWithAI(many, NOW, async (payload) => { seenPayload = payload; return JSON.stringify({ order: [] }); });
  check("只把前 20 条交给模型（§6.4.1 Stage B 的窗口）", seenPayload?.candidates?.length === 20, 20, seenPayload?.candidates?.length);
  check("交给模型的候选只含白名单字段（无整条对象外泄）", seenPayload?.candidates?.every((c) => Object.keys(c).every((k) => ["id", "text", "priority", "sourceTitle", "overdueDays", "localScore"].includes(k))) === true, true, JSON.stringify(Object.keys(seenPayload?.candidates?.[0] || {})));
  check("候选文本截断到 160 字", seenPayload?.candidates?.every((c) => c.text.length <= 160) === true, true, seenPayload?.candidates?.[0]?.text?.length);

  const fp1 = rerankFingerprint(aiItems);
  const fp2 = rerankFingerprint(aiItems.map((e, i) => (i === 0 ? { ...e, priority: 10 } : e)));
  check("指纹随候选变化（用于缓存失效）", fp1 !== fp2 && fp1 === rerankFingerprint(aiItems), "变/不变", `${fp1 === fp2}/${fp1 === rerankFingerprint(aiItems)}`);

  // ---- v48.80（D124 / 设计稿 §9.5 E2）：kpFactorOf 接入 ----
  {
    // D233：优先级取改前 10/20/30 的翻转值（越大越优先），本地因子序与改前一致（e-1 居首）
    const base = [
      mk(`e-1`, { libraryItemId: `bA`, priority: 90 }),
      mk(`e-2`, { libraryItemId: `bB`, priority: 80 }),
      mk(`e-3`, { libraryItemId: `bC`, priority: 70 })
    ];
    const plain = rankExtracts(base, NOW);
    const withOne = rankExtracts(base, NOW, { kpFactorOf: () => 1 });
    check(
      `kpFactorOf 恒返回 1 时排序与不传 opts 完全相同`,
      JSON.stringify(plain.map((x) => x.id)) === JSON.stringify(withOne.map((x) => x.id)) &&
        JSON.stringify(plain.map((x) => x.engineScore)) === JSON.stringify(withOne.map((x) => x.engineScore)),
      true,
      { plain: plain.map((x) => [x.id, x.engineScore]), withOne: withOne.map((x) => [x.id, x.engineScore]) }
    );
    const boosted = rankExtracts(base, NOW, { kpFactorOf: (id) => (id === `e-3` ? 1.3 : id === `e-1` ? 0.85 : 1) });
    check(
      `kpFactor 1.3 的摘录排在 0.85 之前（其余因子相同）`,
      boosted.findIndex((x) => x.id === `e-3`) < boosted.findIndex((x) => x.id === `e-1`),
      true,
      boosted.map((x) => [x.id, x.engineScore])
    );
    check(`不传 opts 时排序保持本地因子原语义（E1 行为不变）`, plain[0].id === `e-1`, `e-1`, plain.map((x) => x.id));
  }

  console.log(`\n==== ainextextract.test：${pass} 通过 / ${fail} 失败 ====`);
  process.exit(fail === 0 ? 0 : 1);
})();
