// v48.12 M15 重做——「就此制卡」结构语义包回归（node 直跑：node tests/m15r.cardpkg.test.cjs）
// 契约：§4.19-10 + card-structure 提示词【输入块】——输入=节点结构语义包
// （本节点/父链/直接子结构/证据引文/材料级结构摘要，≤1200 字），**不携带章节原文全文**。
// 背景（用户实测 bug）：此前 makeCards 把 collect.textByUnit 的章节原文（≤2400 字）当【材料】发出，
// 与提示词「你拿不到原文全文」直接矛盾，也让成本虚高。
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "")}`);
  }
}

const outFile = path.join(__dirname, "m15r.cardpkg.bundle.cjs");
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "m15r.cardpkg.entry.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: outFile,
  logLevel: "silent"
});
const mod = require(outFile);
const { buildStructureCardPackage } = mod;

// 夹具：材料摘要 + 三层节点（root → 父 → 目标节点 → 子结构）
const RAW_SENTENCE = "这是一段只应出现在原文里的章节句子，绝不应进入结构语义包。";
const structure = {
  version: 1,
  generatorVersion: "test",
  title: "优绩主义批判结构",
  rootNodeId: "root",
  summaryText: "【优绩主义批判结构 · 结构摘要】\n- 现象（summary）\n- 论战（contrast）",
  nodes: [
    { id: "root", parentId: null, title: "优绩主义批判结构", authorialRole: "synthesis", unitAnchors: [], evidence: [], childIds: ["n1"] },
    { id: "n1", parentId: "root", title: "反优绩与反反优绩的论战", authorialRole: "contrast", relationToParent: "全书第二层", unitAnchors: ["c0"],
      evidence: [{ quote: "毕业生发文" }], childIds: ["n2"] },
    { id: "n2", parentId: "n1", title: "翻译：标签转写与真实所指", authorialRole: "distinguish", centralQuestion: "这些标签到底指什么", mainMove: "逐条转写", progression: "从标签到所指",
      relationToParent: "论战中的第一环", groupingBasis: { type: "parallel", explanation: "三个标签并列" }, unitAnchors: ["c0"],
      evidence: [{ quote: "考研失败的所指" }, { quote: "水硕的所指" }, { quote: "县里上班的所指" }], childIds: ["n3", "n4"] },
    { id: "n3", parentId: "n2", title: "考研失败的所指", authorialRole: "example", relationToParent: "标签一", unitAnchors: ["c0"], evidence: [], childIds: [] },
    { id: "n4", parentId: "n2", title: "水硕的所指", authorialRole: "example", relationToParent: "标签二", unitAnchors: ["c0"], evidence: [], childIds: [] }
  ]
};

console.log("---- M15R-CARDPKG 结构语义包（不再发原文） ----");
{
  const node = structure.nodes.find((n) => n.id === "n2");
  const pkg = buildStructureCardPackage(node, structure, 1200);
  check("包以【结构语义包】开头（对齐 card-structure 提示词输入块）", pkg.startsWith("【结构语义包】"), pkg.slice(0, 30));
  check("包含五个契约字段", ["本节点", "父链", "直接子结构", "证据引文", "材料级结构摘要"].every((k) => pkg.includes(k)), pkg.slice(0, 200));
  check("本节点字段齐全（role/question/move/progression/grouping/relationToParent）", ["authorialRole", "centralQuestion", "mainMove", "progression", "groupingBasis", "relationToParent"].every((k) => pkg.includes(k)), pkg.slice(0, 300));
  check("父链按由远及近排列（root → n1）", pkg.indexOf("优绩主义批判结构") < pkg.indexOf("反优绩与反反优绩的论战"), pkg.slice(0, 200));
  check("直接子结构含两个子节点及其对父关系", pkg.includes("考研失败的所指") && pkg.includes("水硕的所指") && pkg.includes("标签一"), pkg);
  check("证据引文为作者原话片段", pkg.includes("考研失败的所指") && pkg.includes("水硕的所指"), pkg);
  check("**不含原文句子**（核心红线：结构卡不看原文）", !pkg.includes(RAW_SENTENCE), "");
  check("有界：≤1200 字", pkg.length <= 1200, pkg.length);

  // 超长场景：摘要很长时优先砍摘要与证据条数，绝不回退塞原文
  const big = JSON.parse(JSON.stringify(structure));
  big.summaryText = "摘".repeat(5000);
  const node2 = big.nodes.find((n) => n.id === "n2");
  node2.evidence = Array.from({ length: 8 }, (_, i) => ({ quote: `引文${i}` }));
  const pkg2 = buildStructureCardPackage(node2, big, 1200);
  check("超长时仍 ≤1200 字（有界）", pkg2.length <= 1200, pkg2.length);
  check("超长裁剪后仍保留核心字段（本节点/父链/直接子结构）", ["本节点", "父链", "直接子结构"].every((k) => pkg2.includes(k)), pkg2.slice(0, 200));
  check("超长裁剪后证据条数收敛（≤3）", (pkg2.match(/引文\d/g) || []).length <= 3, pkg2);

  // 叶子节点（无子结构）：不报错且字段为空数组
  const leaf = structure.nodes.find((n) => n.id === "n3");
  const pkg3 = buildStructureCardPackage(leaf, structure, 1200);
  check("叶子节点包可用（直接子结构为空数组）", pkg3.includes("【结构语义包】") && pkg3.includes("直接子结构"), pkg3.slice(0, 160));

  try {
    fs.unlinkSync(outFile);
  } catch {
    /* 清理失败不影响结果 */
  }
}

console.log(`\n==== SUMMARY ${pass}/${pass + fail} ====`);
if (fail) {
  console.log("FAILED items exist");
  process.exit(1);
}
