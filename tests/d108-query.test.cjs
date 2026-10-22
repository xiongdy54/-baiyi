// D108 查询语法 v3＝布尔结构与通配 纯函数回归（node 直跑：node tests/d108-query.test.cjs）
// 覆盖：AST 解析（or/括号/hasGroups）/ 无 or/括号查询与扁平逐条 AND 的等值差分 /
//       NOT 算子矩阵（-book:/-status:/-type:/-kind:/-priority<op>）/ 通配符 /
//       优先级（括号 > AND > or）/ 宽容解析（缺右括号·孤儿右括号·or 尾随·引号 or）/
//       闪卡侧「整串 includes 全灭」缺陷修复对照（D108 ⑦）/ 摘录行判定 / extractScopeConditions 兼容
// 契约：GUIDE §6.8-6 v3（v48.64 / D108）
"use strict";
const path = require("path");
const ROOT = require("path").resolve(__dirname, "..");
const q = require(path.join(ROOT, "tests", "d108-query.bundle.cjs"));

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 样例行：一张卡 + 一条摘录
const CARD = {
  frontMarkdown: "错题整理",
  backMarkdown: "答案：三项",
  noteText: "",
  contextPrefix: "",
  docTitle: "高等数学",
  domain: ["数学"],
  tags: ["考研::英语"],
  cardType: "qa",
  status: "active",
  leechSuspended: false,
  fsrsState: "review",
  priority: 30
};
const EXTRACT = {
  contentMarkdown: "一段正文内容，讨论极限。",
  docTitle: "英语文献",
  status: "open",
  tagJson: JSON.stringify(["考研::英语"]),
  priority: 50
};
const T = (name, cond) => check(name, cond === true, true, cond);
const m = (query) => q.parseCardQuery(query);

console.log("== D108-T1 解析与 hasGroups ==");
T("无组查询 hasGroups 不设", m("book:数学 tag:考研").hasGroups === undefined);
T("or 查询 hasGroups=true", m("book:数学 or book:英语").hasGroups === true);
T("括号查询 hasGroups=true", m("( tag:考研 )").hasGroups === true);
T("or 顶层为 or 节点", m("book:数学 or book:英语").ast?.t === "or");
T("括号组内 and 节点", m("( book:数学 tag:考研 )").ast?.t === "and");
T("无组查询顶层为 leaf（单条件）", m("book:数学").ast?.t === "leaf");
T("扁平产物 kind 照旧（页签联动用）", eq({ kind: m("kind:card").kind, book: m("book:物理").book, priority: m("priority<=30").priority }, { kind: "card", book: "物理", priority: { op: "<=", value: 30 } }));

console.log("== D108-T2 无 or/括号查询与扁平逐条 AND 等值 ==");
T("单字段 kind:card 对卡行命中", q.cardRowMatches(m("kind:card"), CARD));
T("kind:extract 对卡行不命中", q.cardRowMatches(m("kind:extract"), CARD) === false);
T("book 子串命中", q.cardRowMatches(m("book:数学"), CARD));
T("status 命中 fsrs state", q.cardRowMatches(m("status:review"), CARD));
T("status:archived 走生命周期维度（active≠archived）", q.cardRowMatches(m("status:archived"), CARD) === false);
T("type 命中 cardType", q.cardRowMatches(m("type:qa"), CARD));
T("type 大小写不敏感", q.cardRowMatches(m("type:QA"), CARD));
T("tag 层级前缀命中", q.cardRowMatches(m("tag:考研"), CARD));
T("tag 层级边界（考研英语不命中）", q.cardRowMatches(m("tag:口语"), { ...CARD, tags: ["考研英语"] }) === false);
T("-tag: 排除", q.cardRowMatches(m("-tag:考研"), CARD) === false);
T("-tag: 不反向命中子级", q.cardRowMatches(m("-tag:英语"), CARD));
T("文本子串命中题面", q.cardRowMatches(m("错题"), CARD));
T("多词 AND：命中", q.cardRowMatches(m("错题 答案"), CARD));
T("多词 AND：不命中", q.cardRowMatches(m("错题 物理"), CARD) === false);
T("引号短语整串命中", q.cardRowMatches(m('"错题整理"'), CARD));
T("-priority=30 取反", q.cardRowMatches(m("-priority=30"), CARD) === false);
T("两 tag token 多值 OR（v1/v2 语义保持）", q.cardRowMatches(m("tag:口语 tag:考研"), CARD));
T("单值字段后写覆盖（book:物理 book:数学 ≡ book:数学）", q.cardRowMatches(m("book:物理 book:数学"), CARD) === q.cardRowMatches(m("book:数学"), CARD));

console.log("== D108-T3 NOT 算子（负号字段条件生效，D108 ④） ==");
T("-book:物理 → 命中", q.cardRowMatches(m("-book:物理"), CARD));
T("-book:数学 → 不命中", q.cardRowMatches(m("-book:数学"), CARD) === false);
T("-status:review → 不命中", q.cardRowMatches(m("-status:review"), CARD) === false);
T("-type:qa → 不命中", q.cardRowMatches(m("-type:qa"), CARD) === false);
T("-kind:extract → 卡行命中", q.cardRowMatches(m("-kind:extract"), CARD));
T("-kind:card → 卡行不命中", q.cardRowMatches(m("-kind:card"), CARD) === false);
T("-priority<=29 → 命中（p=30 > 29）", q.cardRowMatches(m("-priority<=29"), CARD));
T("-priority<=30 → 不命中（p=30 ≤ 30）", q.cardRowMatches(m("-priority<=30"), CARD) === false);
T("NOT 与文本组合：错题 -book:物理 → 命中", q.cardRowMatches(m("错题 -book:物理"), CARD));
T("NOT 与文本组合：错题 -book:数学 → 不命中", q.cardRowMatches(m("错题 -book:数学"), CARD) === false);

console.log("== D108-T4 通配符（D108 ③） ==");
T("book:高* 前缀通配命中", q.cardRowMatches(m("book:高*"), CARD));
T("*数学 后缀通配命中", q.cardRowMatches(m("*数学"), CARD));
T("题*整理 中置通配命中", q.cardRowMatches(m("题*整理"), CARD));
T("*物理* 不命中", q.cardRowMatches(m("*物理*"), CARD) === false);
T("通配在字段值：book:*数学 命中", q.cardRowMatches(m("book:*数学"), CARD));
T("通配在 tag：tag:考研* 命中层级子级", q.cardRowMatches(m("tag:考研*"), CARD));
T("无通配符行为不变（子串）", q.cardRowMatches(m("学"), CARD));

console.log("== D108-T5 优先级（括号 > AND > or，D108 ①②） ==");
T("or 两侧：book:物理 or book:数学 → 命中", q.cardRowMatches(m("book:物理 or book:数学"), CARD));
T("or 两侧：book:物理 or book:化学 → 不命中", q.cardRowMatches(m("book:物理 or book:化学"), CARD) === false);
T("AND 先结合：kind:card tag:考研 or book:物理 → 命中", q.cardRowMatches(m("kind:card tag:考研 or book:物理"), CARD));
T("AND 先结合：kind:extract tag:考研 or book:物理 → 不命中", q.cardRowMatches(m("kind:extract tag:考研 or book:物理"), CARD) === false);
T("括号改优先：( kind:extract or kind:card ) tag:考研 → 命中", q.cardRowMatches(m("( kind:extract or kind:card ) tag:考研"), CARD));
T("括号组：kind:extract or ( tag:考研 tag:口语 ) → 不命中", q.cardRowMatches(m("kind:extract or ( tag:考研 tag:口语 )"), CARD) === false);
T("or 链三值：book:物理 or book:化学 or book:数学 → 命中", q.cardRowMatches(m("book:物理 or book:化学 or book:数学"), CARD));
T("or 大小写不敏感：OR 亦可", q.cardRowMatches(m("book:物理 OR book:数学"), CARD));

console.log("== D108-T6 宽容解析 ==");
T("or 尾随（缺右操作数）等价单项", q.cardRowMatches(m("book:数学 or"), CARD));
T("缺右括号自动闭合", q.cardRowMatches(m("( book:数学 or book:物理"), CARD));
T("孤儿右括号丢弃", q.cardRowMatches(m("book:数学 )"), CARD));
T("引号包裹的 or 按文本搜", q.cardRowMatches(m('"or"'), { ...CARD, frontMarkdown: "or 应按文本搜" }));
T("引号包裹的括号按文本搜", q.cardRowMatches(m('"("'), { ...CARD, frontMarkdown: "( 括号文本" }));
T("词内 or 不触发（doctor）", q.cardRowMatches(m("doctor"), { ...CARD, frontMarkdown: "doctor says" }));
T("词内括号不触发分组：book:高等数学(第二版) 按子串", q.cardRowMatches(m("book:高等数学(第二版)"), { ...CARD, docTitle: "高等数学(第二版)" }));
T("空查询恒真", q.cardRowMatches(m(""), CARD));
T("纯空格恒真", q.cardRowMatches(m("   "), CARD));
T("空字段值忽略：book: 恒真", q.cardRowMatches(m("book:"), CARD));

console.log("== D108-T7 缺陷修复对照（D108 ⑦：闪卡侧整串 includes 全灭） ==");
// 修复前（CardBrowser 旧 L313）：hay.includes(foldSearch(query)) 对以下查询恒 false → 全灭。
// v3 统一 AST 后文本项逐词判定，字段过滤真正生效。
T("kind:card 单独查询命中（旧全灭）", q.cardRowMatches(m("kind:card"), CARD));
T("tag:考研 单独查询命中（旧全灭）", q.cardRowMatches(m("tag:考研"), CARD));
T("priority<=30 单独查询命中（旧全灭且解析死路）", q.cardRowMatches(m("priority<=30"), CARD));
T("book:数学 单独查询命中（旧全灭）", q.cardRowMatches(m("book:数学"), CARD));
T("status:review 单独查询命中（旧全灭）", q.cardRowMatches(m("status:review"), CARD));
T("字段+文本组合：book:数学 错题 → 命中", q.cardRowMatches(m("book:数学 错题"), CARD));
T("字段+文本组合：book:物理 错题 → 不命中", q.cardRowMatches(m("book:物理 错题"), CARD) === false);

console.log("== D108-T8 摘录行判定 ==");
T("kind:card 对摘录行恒不命中", q.extractRowMatches(m("kind:card"), EXTRACT) === false);
T("kind:extract 对摘录行命中", q.extractRowMatches(m("kind:extract"), EXTRACT));
T("type: 对摘录行恒不命中（摘录无卡形式，诚实语义）", q.extractRowMatches(m("type:qa"), EXTRACT) === false);
T("tag 经 tagJson 匹配", q.extractRowMatches(m("tag:考研"), EXTRACT));
T("-tag: 经 tagJson 排除", q.extractRowMatches(m("-tag:考研"), EXTRACT) === false);
T("正文子串命中", q.extractRowMatches(m("极限"), EXTRACT));
T("正文逐词 AND", q.extractRowMatches(m("一段 极限"), EXTRACT));
T("正文逐词 AND 不命中", q.extractRowMatches(m("一段 物理"), EXTRACT) === false);
T("status 命中", q.extractRowMatches(m("status:open"), EXTRACT));
T("-status:open 取反", q.extractRowMatches(m("-status:open"), EXTRACT) === false);
T("book 子串命中", q.extractRowMatches(m("book:英语"), EXTRACT));
T("priority<=50 命中", q.extractRowMatches(m("priority<=50"), EXTRACT));
T("or：book:数学 or book:英语 → 命中", q.extractRowMatches(m("book:数学 or book:英语"), EXTRACT));
T("-kind:card → 摘录行命中", q.extractRowMatches(m("-kind:card"), EXTRACT));

console.log("== D108-T9 extractScopeConditions 兼容（D105 消费点不变） ==");
check("提取 tag 与 book", eq(q.extractScopeConditions("book:物理 tag:考研 错题"), { tags: ["考研"], bookNames: ["物理"] }), { tags: ["考研"], bookNames: ["物理"] }, q.extractScopeConditions("book:物理 tag:考研 错题"));
check("无条件查询提取空", eq(q.extractScopeConditions("错题"), { tags: [], bookNames: [] }), { tags: [], bookNames: [] }, q.extractScopeConditions("错题"));

console.log(`\n==== d108-query：${pass} 通过 / ${fail} 失败 ====`);
process.exit(fail === 0 ? 0 : 1);
