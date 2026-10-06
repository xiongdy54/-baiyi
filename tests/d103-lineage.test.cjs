// D103 批C 血缘树纯函数回归（node 直跑：node tests/d103-lineage.test.cjs）
// 覆盖：buildLineageTree 祖先链 / 子孙闭包 / 本卡高亮 / D85 聚合计数 / 引文首行截断 ≤40 字 /
//       断链与成环的如实降级 / 空态（extractId 缺失或摘录行不存在）→「无来源锚」
// 契约：设计稿 docs/design/CARD-SYSTEM-ANKI-ADAPTATION-D94.md §3.1 + GUIDE §6.8-6 行详情（D103）
"use strict";
const path = require("path");
const ROOT = "C:/Users/xiongdy/Documents/OpenCode/Incremental reading Dev";
const lineage = require(path.join(ROOT, "tests", "d103-lineage.bundle.cjs"));

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 夹具：root → mid → leaf（摘录树），另有一条独立链 orphan
const extracts = [
  { id: "root", contentMarkdown: "根摘录第一行\n第二行不该出现", documentId: "doc-1", contextRef: { anchorText: "根锚" } },
  { id: "mid", contentMarkdown: "中间摘录", documentId: "doc-1", contextRef: { parentExtractId: "root", anchorText: "中锚", anchorRatio: 0.5 } },
  { id: "leaf", contentMarkdown: "叶摘录", documentId: "doc-1", contextRef: { parentExtractId: "mid" } },
  { id: "leaf2", contentMarkdown: "叶摘录二", documentId: "doc-1", contextRef: { parentExtractId: "mid" } },
  { id: "orphan", contentMarkdown: "孤儿链", documentId: "doc-2", contextRef: {} }
];
// 直卡：root×1、leaf×2、leaf2×1（mid 自身 0 直卡，但聚合 = 3）
const cards = [
  { contextRef: { extractId: "root" } },
  { contextRef: { extractId: "leaf" } },
  { contextRef: { extractId: "leaf" } },
  { contextRef: { extractId: "leaf2" } }
];

console.log("== D103-L1 空态（无来源锚）==");
check("extractId 缺失 → hasSource=false", lineage.buildLineageTree({ extractId: null, extracts, cards }).hasSource === false, false, lineage.buildLineageTree({ extractId: null, extracts, cards }));
check("extractId 不在摘录面 → hasSource=false（不猜）", lineage.buildLineageTree({ extractId: "ghost", extracts, cards }).hasSource === false, false, "hasSource=false");
check("空摘录面 → hasSource=false", lineage.buildLineageTree({ extractId: "leaf", extracts: [], cards }).hasSource === false, false, "hasSource=false");

console.log("== D103-L2 祖先链（叶视角：root → mid → leaf）==");
const t = lineage.buildLineageTree({ extractId: "leaf", extracts, cards });
check("hasSource=true", t.hasSource === true, true, t.hasSource);
check("祖先链 = [root, mid, leaf]", eq(t.ancestors.map((n) => n.id), ["root", "mid", "leaf"]), ["root", "mid", "leaf"], t.ancestors.map((n) => n.id));
check("本卡节点高亮在 leaf", t.ancestors[2].isCurrent === true && t.ancestors[0].isCurrent === false, "leaf 高亮", t.ancestors.map((n) => n.isCurrent));
check("depth 连续标尺 root=0/leaf=2", eq(t.ancestors.map((n) => n.depth), [0, 1, 2]), [0, 1, 2], t.ancestors.map((n) => n.depth));
check("引文取首行（第二行不混入）", t.ancestors[0].label === "根摘录第一行", "根摘录第一行", t.ancestors[0].label);
check("根节点锚点字段透传", t.ancestors[0].documentId === "doc-1" && t.ancestors[0].anchorText === "根锚", "doc-1/根锚", t.ancestors[0]);

console.log("== D103-L3 子孙闭包 + D85 聚合计数 ==");
check("leaf 无子孙", eq(t.descendants.map((n) => n.id), [], "无"), [], t.descendants.map((n) => n.id));
check("leaf 聚合 = 自身 2 直卡", t.ancestors[2].count === 2, 2, t.ancestors[2].count);
const tMid = lineage.buildLineageTree({ extractId: "mid", extracts, cards });
check("mid 子孙 = [leaf, leaf2]", eq(tMid.descendants.map((n) => n.id), ["leaf", "leaf2"]), ["leaf", "leaf2"], tMid.descendants.map((n) => n.id));
check("mid 聚合 = 0 自身 + 3 后代", tMid.ancestors[1].count === 3, 3, tMid.ancestors[1].count);
check("mid 子孙深度接在祖先标尺后（=2）", eq(tMid.descendants.map((n) => n.depth), [2, 2]), [2, 2], tMid.descendants.map((n) => n.depth));
check("mid 子孙不标 current", tMid.descendants.every((n) => !n.isCurrent), "全 false", tMid.descendants.map((n) => n.isCurrent));
const tRoot = lineage.buildLineageTree({ extractId: "root", extracts, cards });
check("root 祖先链 = 自身", eq(tRoot.ancestors.map((n) => n.id), ["root"]), ["root"], tRoot.ancestors.map((n) => n.id));
check("root 聚合 = 4（全树直卡）", tRoot.ancestors[0].count === 4, 4, tRoot.ancestors[0].count);
check("orphan 不混入他人闭包（独立键空间）", !tRoot.descendants.some((n) => n.id === "orphan"), "不含 orphan", tRoot.descendants.map((n) => n.id));

console.log("== D103-L4 断链与成环如实降级（不抛）==");
const broken = [{ id: "a", contentMarkdown: "甲", contextRef: { parentExtractId: "missing-parent" } }];
const tb = lineage.buildLineageTree({ extractId: "a", extracts: broken, cards: [] });
check("父缺失 → 祖先链只有自身（断链止步）", eq(tb.ancestors.map((n) => n.id), ["a"]), ["a"], tb.ancestors.map((n) => n.id));
const cyc = [
  { id: "x", contentMarkdown: "X", contextRef: { parentExtractId: "y" } },
  { id: "y", contentMarkdown: "Y", contextRef: { parentExtractId: "x" } }
];
const tc = lineage.buildLineageTree({ extractId: "x", extracts: cyc, cards: [] });
check("环 → 祖先链 x→y 止步不抛", eq(tc.ancestors.map((n) => n.id), ["y", "x"]), ["y", "x"], tc.ancestors.map((n) => n.id));
const selfCyc = [{ id: "s", contentMarkdown: "S", contextRef: { parentExtractId: "s" } }];
const ts = lineage.buildLineageTree({ extractId: "s", extracts: selfCyc, cards: [] });
check("自环 → 祖先链只有自身", eq(ts.ancestors.map((n) => n.id), ["s"]), ["s"], ts.ancestors.map((n) => n.id));
check("自环无子孙（visited 拦截）", eq(ts.descendants, []), [], ts.descendants);

console.log("== D103-L5 引文标签 ≤40 字 ==");
const long = "一".repeat(40); // 恰好 40 字
check("恰好 40 字不截断", lineage.firstLineLabel(long).length === 40, 40, lineage.firstLineLabel(long).length);
check("41 字截断加省略号", lineage.firstLineLabel(long + "末") === long + "…", long + "…", lineage.firstLineLabel(long + "末"));
check("空白行跳过取次行", lineage.firstLineLabel("\n  \n真实内容"), "真实内容", lineage.firstLineLabel("\n  \n真实内容"));
check("null/undefined → 空串", lineage.firstLineLabel(null) === "" && lineage.firstLineLabel(undefined) === "", "空串", [lineage.firstLineLabel(null), lineage.firstLineLabel(undefined)]);

console.log(`\nD103-lineage: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
