// @runtime: system-node
// D248 / T1：BDI 事件注册表（electron/behavior/registry.js）与 uuid7 的机器闸门。
// 运行：node tests/behavior-registry.test.cjs（或 node scripts/run-tests.mjs behavior-registry）
// 覆盖（设计稿 §14 behavior-registry）：所有事件与 props 显式类型；非法数值/嵌套/超长/未知来源；
//   catalog 生成结构稳定；短文本开关；intentOnly 登记；uuid7 格式/时间/唯一性。
"use strict";
const path = require("path");

const ROOT = path.join(__dirname, "..");
const reg = require(path.join(ROOT, "electron", "behavior", "registry.js"));
const { uuid7, uuid7Time, isUuid } = require(path.join(ROOT, "electron", "behavior", "uuid7.js"));

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

const OWNERS = new Set(["M", "R", "B", "W", "M+R"]);
const PROP_TYPES = new Set(["string", "int", "num", "bool", "enum", "scalar", "strarray"]);
const NAME_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** 一条最小合法事件（app.started，src=main）。 */
function mk(overrides) {
  return {
    type: "app.started",
    src: "main",
    session_id: "sess-1",
    ts: 1700000000000,
    recv_ts: 1700000000000,
    day: "2026-10-28",
    tz_offset: -480,
    cutoff_hour: 4,
    ...overrides,
  };
}
const okOf = (e, opts) => {
  const r = reg.validate(e, opts);
  return r.ok ? "ok" : r.code;
};

console.log("== A 事件目录完整性 ==");
check("CATALOG_VERSION 为 1", reg.CATALOG_VERSION === 1, 1, reg.CATALOG_VERSION);
check("事件数量 ≥ 60（目录覆盖 §6 全部语义动作）", reg.EVENT_NAMES.length >= 60, ">=60", reg.EVENT_NAMES.length);
const badName = reg.EVENT_NAMES.filter((n) => !NAME_RE.test(n));
check("事件名一律「组.动作」小写蛇形", badName.length === 0, "全部合法", badName);
const dupes = reg.EVENT_NAMES.filter((n, i) => reg.EVENT_NAMES.indexOf(n) !== i);
check("事件名唯一", dupes.length === 0, "无重复", dupes);
const sectionIds = new Set(reg.SECTIONS.map((s) => s.id));
const badSection = reg.EVENT_NAMES.filter((n) => !sectionIds.has(reg.EVENTS[n].section));
check("每个事件都归入已登记的小节", badSection.length === 0, "全部归节", badSection);
const badOwner = reg.EVENT_NAMES.filter((n) => !OWNERS.has(reg.EVENTS[n].owner));
check("owner 只取 M/R/B/W（含 M+R）", badOwner.length === 0, "全部合法", badOwner);
const badRate = reg.EVENT_NAMES.filter((n) => !Number.isInteger(reg.EVENTS[n].maxPerMin) || reg.EVENTS[n].maxPerMin < 1 || reg.EVENTS[n].maxPerMin > 3600);
check("maxPerMin 为 1..3600 的整数", badRate.length === 0, "全部合法", badRate);
const badSpec = [];
for (const n of reg.EVENT_NAMES) {
  for (const [pn, spec] of Object.entries(reg.EVENTS[n].props)) {
    if (!spec || !PROP_TYPES.has(spec.type)) badSpec.push(`${n}.${pn}`);
    else if (spec.type === "enum" && (!Array.isArray(spec.values) || spec.values.length === 0)) badSpec.push(`${n}.${pn}`);
    else if (spec.type === "string" && !(Number.isInteger(spec.maxLen) && spec.maxLen > 0)) badSpec.push(`${n}.${pn}`);
    else if (spec.type === "strarray" && !(Number.isInteger(spec.maxItems) && spec.maxItems > 0)) badSpec.push(`${n}.${pn}`);
  }
}
check("每个 props 都有显式类型与合法约束（enum 非空 / string 有长度）", badSpec.length === 0, "全部显式", badSpec);
const intentOnly = reg.EVENT_NAMES.filter((n) => reg.EVENTS[n].intentOnly).sort();
check("intentOnly 恰为登记的三类（card.regenerated / card.disambiguated / growth.feedback_shown）",
  JSON.stringify(intentOnly), JSON.stringify(["card.disambiguated", "card.regenerated", "growth.feedback_shown"]));
const allowText = reg.EVENT_NAMES.filter((n) => reg.EVENTS[n].allowText).sort();
check("allowText 恰为四类查询/文本事件（browse.queried / dict.lookup / reader.searched / shelf.filtered）",
  JSON.stringify(allowText), JSON.stringify(["browse.queried", "dict.lookup", "reader.searched", "shelf.filtered"]));
const cat = reg.catalog();
check("catalog() 与 EVENTS 逐项一致（含 section/doc/owner）", cat.length === reg.EVENT_NAMES.length && cat.every((r) => reg.EVENTS[r.type] && reg.EVENTS[r.type].section === r.section && reg.EVENTS[r.type].doc === r.doc), "一致", cat.length);
check("catalog() 顺序稳定（重复调用逐字相同）", JSON.stringify(cat) === JSON.stringify(reg.catalog()), "稳定", "不稳定");

console.log("== B validate：合法事件 ==");
check("最小合法事件通过", okOf(mk()), "ok", okOf(mk()));
check("v 缺省视为 1", okOf(mk({ v: undefined })), "ok", okOf(mk({ v: undefined })));
check("v=1 通过", okOf(mk({ v: 1 })), "ok", okOf(mk({ v: 1 })));
check("合法 uid（uuid7）通过", okOf(mk({ uid: uuid7() })), "ok", "fail");
check("intentOnly 事件合法通过", okOf(mk({ type: "card.regenerated", src: "lens", props: { reason: "manual" } })), "ok", "fail");
check("enum props 合法值通过", okOf(mk({ type: "review.session", props: { phase: "start", mode: "due", planned: 20 } })), "ok", "fail");
check("scalar props 三类值通过", ["a", 1.5, true].every((v) => okOf(mk({ type: "settings.changed", props: { key: "app.language", to: v } })) === "ok"), "ok", "fail");
check("strarray props 通过", okOf(mk({ type: "card.edited", props: { fields: ["front", "back"] } })), "ok", "fail");

console.log("== C validate：非法输入 ==");
check("未知事件类型被拒", okOf(mk({ type: "nope.nope" })), "type_unknown", okOf(mk({ type: "nope.nope" })));
check("未知来源被拒", okOf(mk({ src: "server" })), "src_unknown", okOf(mk({ src: "server" })));
check("未知顶层字段被拒", okOf(mk({ payload: {} })), "field_unknown", okOf(mk({ payload: {} })));
check("未知 props 键被拒", okOf(mk({ props: { nope: 1 } })), "prop_unknown", okOf(mk({ props: { nope: 1 } })));
check("props 非对象被拒", okOf(mk({ props: [] })), "props_not_object", okOf(mk({ props: [] })));
check("props 嵌套对象被拒", okOf(mk({ props: { launchKind: { a: 1 } } })), "prop_type", okOf(mk({ props: { launchKind: { a: 1 } } })));
check("props 数组含对象被拒", okOf(mk({ type: "card.edited", props: { fields: ["a", { b: 1 }] } })), "prop_nested", "fail");
check("int props 小数被拒", okOf(mk({ type: "review.rated", props: { tapSeq: 1.5 } })), "prop_type", "fail");
check("num props NaN 被拒", okOf(mk({ type: "review.rated", props: { tapStartTs: NaN } })), "prop_type", "fail");
check("bool props 非布尔被拒", okOf(mk({ type: "library.imported", props: { ok: "yes" } })), "prop_type", "fail");
check("enum 越界被拒", okOf(mk({ type: "review.session", props: { mode: "random" } })), "prop_enum", "fail");
check("scalar 嵌套被拒", okOf(mk({ type: "settings.changed", props: { to: ["x"] } })), "prop_type", "fail");
check("props 字符串超长被拒", okOf(mk({ type: "card.regenerated", props: { reason: "x".repeat(201) } })), "prop_too_long", "fail");
check("props 数组超条目被拒", okOf(mk({ type: "card.edited", props: { fields: Array.from({ length: 25 }, (_, i) => `f${i}`) } })), "prop_too_many", "fail");
check("v=2 被拒", okOf(mk({ v: 2 })), "version_unsupported", "fail");
check("session_id 缺失被拒", okOf(mk({ session_id: "" })), "session_missing", "fail");
check("ts 非整数被拒", okOf(mk({ ts: 1.5 })), "ts_invalid", "fail");
check("ts<=0 被拒", okOf(mk({ ts: 0 })), "ts_invalid", "fail");
check("recv_ts 缺失被拒", okOf(mk({ recv_ts: undefined })), "ts_invalid", "fail");
check("day 非 YYYY-MM-DD 被拒", okOf(mk({ day: "2026/10/28" })), "day_invalid", "fail");
check("tz_offset 越界被拒", okOf(mk({ tz_offset: 900 })), "tz_offset_invalid", "fail");
check("cutoff_hour 越界被拒", okOf(mk({ cutoff_hour: 24 })), "cutoff_invalid", "fail");
check("clock_flags 越界被拒", okOf(mk({ clock_flags: 16 })), "clock_flags_invalid", "fail");
check("actor 越界被拒", okOf(mk({ actor: "robot" })), "actor_invalid", "fail");
check("origin 越界被拒", okOf(mk({ origin: "elsewhere" })), "origin_invalid", "fail");
check("entity_type 越界被拒", okOf(mk({ entity_type: "planet" })), "entity_type_invalid", "fail");
check("uid 非 UUID 被拒", okOf(mk({ uid: "not-a-uuid" })), "uid_invalid", "fail");
check("doc_pos 负数被拒", okOf(mk({ doc_pos: -1 })), "doc_pos_invalid", "fail");
check("dur_ms 负数被拒", okOf(mk({ dur_ms: -5 })), "dur_invalid", "fail");
check("num 非有限被拒", okOf(mk({ num: Infinity })), "num_invalid", "fail");

console.log("== D validate：短文本开关 ==");
const lookup = (text) => mk({ type: "dict.lookup", src: "main", props: { lang: "en", source: "local", hit: true }, text });
check("未开 recordQueryText 时 text 被拒", okOf(lookup("apple")), "text_disabled", okOf(lookup("apple")));
check("开启 recordQueryText 后短文本通过", okOf(lookup("apple"), { recordQueryText: true }), "ok", "fail");
check("开启后超长文本（>200）仍被拒", okOf(lookup("x".repeat(201)), { recordQueryText: true }), "text_too_long", "fail");
check("非 allowText 事件带 text 被拒（即使开启）", okOf(mk({ type: "review.rated", text: "x", props: {} }), { recordQueryText: true }), "text_not_allowed", "fail");

console.log("== E uuid7 ==");
const ids = Array.from({ length: 1000 }, () => uuid7());
check("1000 个 uuid7 全部唯一", new Set(ids).size === 1000, 1000, new Set(ids).size);
check("格式为 8-4-4-4-12 小写十六进制", ids.every(isUuid), "全部合法", ids.find((x) => !isUuid(x)));
check("版本位为 7", ids.every((x) => x[14] === "7"), "全部 v7", "存在非 v7");
check("变体位为 8/9/a/b", ids.every((x) => "89ab".includes(x[19])), "全部合法", "存在非法变体");
const stamp = 1735689600123;
const id = uuid7(stamp);
check("uuid7Time 可解回注入的毫秒时间戳", uuid7Time(id) === stamp, stamp, uuid7Time(id));
check("非 v7 UUID 解时间返回 null", uuid7Time("550e8400-e29b-41d4-a716-446655440000") === null, null, uuid7Time("550e8400-e29b-41d4-a716-446655440000"));
check("同一毫秒内 uuid7 仍唯一（随机位撑开）", new Set(Array.from({ length: 200 }, () => uuid7(stamp))).size === 200, 200, "存在重复");

console.log(`\n==== behavior-registry ${pass}/${pass + fail} 断言 ====`);
if (fail > 0) console.log(`  失败 ${fail} 项`);
process.exitCode = fail === 0 ? 0 : 1;
