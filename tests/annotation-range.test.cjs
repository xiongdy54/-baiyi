// 批注范围锚（规格 §2.2 / 待登记 D61）单元测试——纯 node，无 electron
// @runtime: node  @tier: 1  @gui: false  @id: ANNORANGE  @timeout: 120
// 运行：node tests/annotation-range.test.cjs
// 契约：① 编辑脚本正确（相隔两处编辑拆两条）；② §2.2 变换表逐行成立；
//       ③ 端点规则＝插入点落在 [start,end] 闭区间一律继承（用户 2026-09-25 拍死）；
//       ④ 区间被删空必须 dropped（不许谎称还有锚）；⑤ 入参不被修改。
const { diffEdits, transformRange, transformRanges, normalizeRanges } = require("../electron/annotationRange.js");

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const OLD = "abcdefghij";
const R = (s, e) => ({ start: s, end: e });
/** 单区间用例：old → new，区间 [2,5) 的期望结果 */
function t(name, newText, expected, range = R(2, 5)) {
  const got = transformRanges([range], OLD, newText).ranges;
  check(name, eq(got, expected), expected, got);
}

console.log("== A 编辑脚本 ==");
check("A1 无变化 → 空脚本", eq(diffEdits(OLD, OLD), []), [], diffEdits(OLD, OLD));
{
  const e = diffEdits("abc def ghi", "abXc def ghiY");
  check("A2 相隔两处编辑拆成两条", e.length === 2, 2, e.length);
  check("A3 两条编辑的坐标正确",
    eq(e, [{ start: 2, end: 2, text: "X" }, { start: 11, end: 11, text: "Y" }]),
    [{ start: 2, end: 2, text: "X" }, { start: 11, end: 11, text: "Y" }], e);
}
{
  const e = diffEdits("XYZzzzzz", "ABCzzzzz");
  check("A4 无公共锚点 → 退化为一条替换", e.length === 1 && e[0].text === "ABC", 1, e);
}

console.log("== B §2.2 变换表（区间 [2,5)） ==");
t("B1 区间内插入 → 继承（end += n）", "abcXdefghij", [R(2, 6)]);
t("B2 起点处插入 → 继承（用户裁定）", "abXcdefghij", [R(2, 6)]);
t("B3 终点处插入 → 继承", "abcdeXfghij", [R(2, 6)]);
t("B4 区间前插入 → 整体右移", "Xabcdefghij", [R(3, 6)]);
t("B5 区间后插入 → 不动", "abcdefghijX", [R(2, 5)]);
t("B6 区间内删除 → 区间缩短", "abcefghij", [R(2, 4)]);
t("B7 删除跨越终点 → 按交集裁剪", "abcdefghij".slice(0, 4) + "hij", [R(2, 4)]);
t("B8 替换区间内两字 → 新字继承", "abcXYfghij", [R(2, 5)]);
{
  const got = transformRanges([R(2, 5)], "abcdefghij", "abfghij").ranges;
  check("B9 区间被整段删除 → dropped（不再谎称有锚）", eq(got, []), [], got);
}
{
  const got = transformRanges([R(2, 5)], "Xabcdefghij", "abcdefghij").ranges;
  check("B10 区间前删除 → 整体左移", eq(got, [R(1, 4)]), [R(1, 4)], got);
}

console.log("== C 多区间（多段选择） ==");
{
  const got = transformRanges([R(0, 2), R(6, 8)], OLD, "abcXdefghij").ranges;
  check("C1 第一段不动、第二段按端点规则处理", eq(got, [R(0, 2), R(7, 9)]), [R(0, 2), R(7, 9)], got);
}
{
  const got = transformRanges([R(5, 8)], "abc def ghi", "abXc def ghiY").ranges;
  check("C2 两处相隔编辑的顺序作用", eq(got, [R(6, 9)]), [R(6, 9)], got);
}
{
  const r = transformRanges([R(0, 2), R(6, 8)], OLD, "");
  check("C3 两条独立区间同时落空 → dropped 计数正确", r.dropped === 2 && eq(r.ranges, []), { dropped: 2 }, r);
}
{
  const r = transformRanges([R(2, 5), R(2, 5)], OLD, "abfghij");
  check("C4 重复区间先合并再变换 → dropped 只为 1", r.dropped === 1 && eq(r.ranges, []), { dropped: 1 }, r);
}

console.log("== D 规范化与边界 ==");
check("D1 乱序+相接 → 排序并合并", eq(normalizeRanges([R(5, 8), R(0, 2), R(2, 4)], 10), [R(0, 4), R(5, 8)]), [R(0, 4), R(5, 8)], normalizeRanges([R(5, 8), R(0, 2), R(2, 4)], 10));
check("D2 越界 → clamp 到文本长度", eq(normalizeRanges([R(-5, 999)], 10), [R(0, 10)]), [R(0, 10)], normalizeRanges([R(-5, 999)], 10));
check("D3 空/反向区间被丢弃", eq(normalizeRanges([R(3, 3), R(6, 4)], 10), []), [], normalizeRanges([R(3, 3), R(6, 4)], 10));
check("D4 空文本 → 全落空", eq(normalizeRanges([R(0, 3)], 0), []), [], normalizeRanges([R(0, 3)], 0));

console.log("== E 不修改入参 / 连续编辑稳定 ==");
{
  const input = [R(2, 5)];
  const snapshot = JSON.stringify(input);
  transformRanges(input, OLD, "abcXdefghij");
  check("E1 入参未被改写", JSON.stringify(input) === snapshot, snapshot, JSON.stringify(input));
}
{
  const step1 = transformRanges([R(2, 5)], OLD, "abXcdefghij").ranges;
  const step2 = transformRanges(step1, "abXcdefghij", "abXcdefghijY").ranges;
  check("E2 连续两次编辑的结果可预期（第二次插入在区间之后 → 不动）", eq(step2, [R(2, 6)]), [R(2, 6)], step2);
}
{
  const got = transformRange(R(2, 5), { start: 0, end: 0, text: "XX" });
  check("E3 单条编辑作用单区间（纯插入在区间前）", eq(got, R(4, 7)), R(4, 7), got);
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
