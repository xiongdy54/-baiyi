// v48 批1 M15 重做——mindmapCore 纯函数回归（node 直跑：node tests/m15r.core.test.cjs）。
// 契约：§4.19 v48 + D41/D42——提取单元模型（文档线性化 + next-boundary 以兄弟/更高层为界）/
// 区间集合差 parentOwnedText（禁字符串减法）/ 粒度裁剪（深层并入父）/ 证据命中数裁决
// （0→REJECT 1→ACCEPT 多→offset 消歧否则 AMBIGUOUS）/ 段落分片（永不截断）/ 结构校验器 / remap / 有界摘要。
// electron 模块直 require（纯 JS 零依赖，node 可跑——m7/m12 bundle 同款纪律）。
const path = require("path");
const core = require(path.join(__dirname, "..", "electron", "mindmapCore.js"));

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
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- M15R-1 封闭枚举与粒度 ----------
{
  console.log("---- M15R-1 枚举与粒度 ----");
  check("authorialRole 17 个封闭枚举", core.AUTHORIAL_ROLES.length === 17, core.AUTHORIAL_ROLES.length);
  check("grouping 9 个封闭枚举", core.GROUPING_TYPES.length === 9, core.GROUPING_TYPES.length);
  check("粒度 cap：overview=1 / standard=2 / detailed=∞", core.GRANULARITY_CAP.overview === 1 && core.GRANULARITY_CAP.standard === 2 && core.GRANULARITY_CAP.detailed === Infinity, JSON.stringify(core.GRANULARITY_CAP));
}

// ---------- M15R-2 提取单元模型（线性化 + 边界 + 钳制） ----------
{
  console.log("---- M15R-2 提取单元模型 ----");
  // 书 → ch1(s1) / ch2(s2, 子 2.1(s2#x 同文件) 2.2(s3)) / ch3(s4)
  const tree = core.buildTocTree([
    { anchor: "s1.xhtml", label: "第一章" },
    {
      anchor: "s2.xhtml", label: "第二章",
      children: [
        { anchor: "s2.xhtml#x", label: "2.1" },
        { anchor: "s3.xhtml", label: "2.2" }
      ]
    },
    { anchor: "s4.xhtml", label: "第三章" }
  ], "测试书");
  const model = core.buildExtractionModel(tree, ["s1.xhtml", "s2.xhtml", "s3.xhtml", "s4.xhtml"]);
  const rangeOf = (label) => {
    const f = model.flat.find((x) => x.node.label === label);
    return model.nodeRange.get(model.nodeKeyOf(f));
  };
  check("根覆盖全部单元", eq(rangeOf("测试书"), [0, 4]), rangeOf("测试书"));
  check("ch1 区间 [0,1)", eq(rangeOf("第一章"), [0, 1]), rangeOf("第一章"));
  check("ch2 区间 [1,3)（含同文件子节 2.1 与子章 2.2，不被后代截断）", eq(rangeOf("第二章"), [1, 3]), rangeOf("第二章"));
  check("2.1（同 href 深层节点）区间 [1,2)", eq(rangeOf("2.1"), [1, 2]), rangeOf("2.1"));
  check("2.2 区间 [2,3)", eq(rangeOf("2.2"), [2, 3]), rangeOf("2.2"));
  check("ch3 区间 [3,4)", eq(rangeOf("第三章"), [3, 4]), rangeOf("第三章"));
  // 无锚节点（封面）：空区间
  const tree2 = core.buildTocTree([
    { anchor: "cover.xhtml", label: "封面" },
    { anchor: "s1.xhtml", label: "正文" }
  ], "书二");
  const model2 = core.buildExtractionModel(tree2, ["cover.xhtml", "s1.xhtml"]);
  // cover.xhtml 可解析 → 正常区间；换不可解析锚验证空区间
  const tree3 = core.buildTocTree([{ anchor: "s1.xhtml", label: "正文" }], "书三");
  const model3 = core.buildExtractionModel(tree3, ["s1.xhtml"]);
  const f3 = model3.flat.find((x) => x.node.label === "书三");
  check("根（无真实锚）回退到单元 0", eq(model3.nodeRange.get(model3.nodeKeyOf(f3)), [0, 1]), model3.nodeRange.get(model3.nodeKeyOf(f3)));
  void tree2; void model2;
}

// ---------- M15R-3 区间集合差 parentOwnedText（D41-② 禁字符串减法） ----------
{
  console.log("---- M15R-3 区间集合差 ----");
  const tree = core.buildTocTree([
    {
      anchor: "u1.xhtml", label: "章一",
      children: [
        { anchor: "u2.xhtml", label: "节A" },
        { anchor: "u3.xhtml", label: "节B" }
      ]
    }
  ], "书");
  const model = core.buildExtractionModel(tree, ["u0.xhtml", "u1.xhtml", "u2.xhtml", "u3.xhtml"]);
  const textByUnit = new Map([
    ["u0.xhtml", "卷首语（不属于任何章）。"],
    ["u1.xhtml", "章一导语。"],
    ["u2.xhtml", "节A正文。"],
    ["u3.xhtml", "节B正文。"]
  ]);
  const keyOf = (label) => model.nodeKeyOf(model.flat.find((x) => x.node.label === label));
  // 章一 own = [1,4) − [2,3) − [3,4) = [1,2) = 导语
  check("章一 parentOwned = 导语单元（区间差）", core.ownedText(model, keyOf("章一"), textByUnit) === "章一导语。", core.ownedText(model, keyOf("章一"), textByUnit));
  // 根 own = [0,4) − [1,4) = [0,1) = 卷首语
  check("根 parentOwned = 卷首语（目录外文本不丢）", core.ownedText(model, keyOf("书"), textByUnit) === "卷首语（不属于任何章）。", core.ownedText(model, keyOf("书"), textByUnit));
  check("节A own = 全区间", core.ownedText(model, keyOf("节A"), textByUnit) === "节A正文。", core.ownedText(model, keyOf("节A"), textByUnit));
  // 粒度裁剪：只分析根与章一（cap=1）→ 章一 skipChildKeys=[] → own = 全区间（子文本并入父）
  const full = core.ownedText(model, keyOf("章一"), textByUnit, { skipChildKeys: [] });
  check("粒度裁剪后父文本并入未分析子节", full === "章一导语。\n节A正文。\n节B正文。", JSON.stringify(full));
  // 同 base 多深层节点共享区间：2.1/2.1b 均 own 同一单元（引擎按共享文本分组分析）
  const treeS = core.buildTocTree([
    { anchor: "s2.xhtml", label: "章", children: [{ anchor: "s2.xhtml#a", label: "甲" }, { anchor: "s2.xhtml#b", label: "乙" }] }
  ], "书");
  const modelS = core.buildExtractionModel(treeS, ["s1.xhtml", "s2.xhtml"]);
  const kA = modelS.nodeKeyOf(modelS.flat.find((x) => x.node.label === "甲"));
  const kB = modelS.nodeKeyOf(modelS.flat.find((x) => x.node.label === "乙"));
  check("同 base 深层兄弟共享区间（均 [1,2)）", eq(modelS.nodeRange.get(kA), [1, 2]) && eq(modelS.nodeRange.get(kB), [1, 2]), [modelS.nodeRange.get(kA), modelS.nodeRange.get(kB)]);
}

// ---------- M15R-4 证据命中数裁决 ----------
{
  console.log("---- M15R-4 证据裁决 ----");
  const text = "甲乙丙丁戊己庚辛壬癸。甲乙丙丁戊己庚辛壬癸。";
  const r1 = core.locateEvidence("完全无关的文本内容。", "甲乙丙丁");
  check("0 命中 → reject", r1.status === "reject" && r1.hits === 0, r1);
  const r2 = core.locateEvidence("唯一的引文在这里。", "唯一的引文");
  check("1 命中 → accept 且坐标正确", r2.status === "accept" && r2.matchStart === 0 && r2.matchEnd === 5, r2);
  const r3 = core.locateEvidence(text, "甲乙丙丁");
  check("多命中无 hint → ambiguous", r3.status === "ambiguous" && r3.hits === 2, r3);
  const r4 = core.locateEvidence(text, "甲乙丙丁", 12); // 第二段内（10-20）
  check("多命中 + hint 消歧 → 唯一命中", r4.status === "accept" && r4.matchStart === 11, r4);
  const r5 = core.locateEvidence(text, "甲乙丙丁", 7.5); // 两段命中区间正中点，等距
  check("hint 等距 → ambiguous", r5.status === "ambiguous", r5);
  const r6 = core.locateEvidence(text, "", 0);
  check("空 quote → reject", r6.status === "reject", r6);
}

// ---------- M15R-5 段落分片（永不截断） ----------
{
  console.log("---- M15R-5 段落分片 ----");
  const text = "AAAA\nBBBB\nCCCCCCCCCCCCCC\nDDDD\nEEEE";
  const LONGC = "CCCCCCCCCCCCCC";
  const chunks = core.splitByParagraphs(text, 10);
  check("分片均 ≤ cap（除超长段整段）", chunks.every((c) => c.text.length <= 10 || c.text === LONGC), JSON.stringify(chunks.map((c) => c.text)));
  check("超长段独立成片不截断", chunks.some((c) => c.text === LONGC), chunks.map((c) => c.text));
  check("offset 与原文对齐", chunks.every((c) => text.slice(c.start, c.end) === c.text), "");
  check("分片拼接覆盖全部非空行（无丢失）", chunks.map((c) => c.text).join("\n").replace(/\n/g, "\n").length === text.replace(/\n\n/g, "\n").split("\n").filter(Boolean).join("\n").length, "");
  const whole = core.splitByParagraphs("短文本", 6000);
  check("短文本单片", whole.length === 1 && whole[0].text === "短文本", whole);
  check("空文本 → 空数组", core.splitByParagraphs("", 100).length === 0, "");
}

// ---------- M15R-6 结构校验器（§4.19-6） ----------
{
  console.log("---- M15R-6 结构校验器 ----");
  const unitTexts = new Map([
    ["u1.xhtml", "作者在此给出定义：知识即经过检验的信念。"],
    ["u2.xhtml", "随后作者用两个案例说明定义的边界。"],
    ["u3.xhtml", "最后作者指出理论的应用限制。"]
  ]);
  const good = {
    title: "测试导图",
    nodes: [
      { id: "n1", parentId: null, title: "全书主线", unitAnchors: [], evidence: [], compositionalEvidence: ["n2", "n4"], groupingBasis: { type: "sequence", explanation: "定义→说明→限制的推进" } },
      { id: "n2", parentId: "n1", title: "概念建立", authorialRole: "introduce", unitAnchors: ["u1.xhtml"], evidence: [{ quote: "知识即经过检验的信念", startOffset: 9 }] },
      { id: "n3", parentId: "n2", title: "重复的节点", unitAnchors: ["u2.xhtml"], evidence: [{ quote: "两个案例说明定义的边界" }] },
      { id: "n4", parentId: "n1", title: "重复的节点", unitAnchors: ["u2.xhtml"], evidence: [{ quote: "两个案例说明定义的边界" }] },
      { id: "n5", parentId: "n1", title: "重复的节点", unitAnchors: ["u2.xhtml"], evidence: [{ quote: "两个案例说明定义的边界" }] },
      { id: "n6", parentId: "n1", title: "总结", unitAnchors: ["u3.xhtml"], evidence: [{ quote: "应用限制" }], authorialRole: "summary" }
    ]
  };
  const v = core.validateMapStructure(good, { textByUnit: unitTexts });
  check("校验通过且节点齐全", v.ok && v.nodes.length === 6, v.dropped);
  const n2 = v.nodes.find((n) => n.id === "n2");
  check("direct 证据 accept + 坐标落位", n2 && n2.evidence.length === 1 && n2.evidence[0].matchStart === 9 && !n2.evidence[0].positionAmbiguous, n2 && n2.evidence[0]);
  check("compositional 证据支撑高层节点（n1 无 direct）", v.nodes.find((n) => n.id === "n1").evidence.length === 0, "");
  check("同层 ≥3 重复标题警告", v.warnings.some((w) => w.includes("重复的节点")), v.warnings);
  check("笼统空盒标题警告（总结带子节点才警告；此处叶子不警告）", !v.warnings.some((w) => w.includes("笼统")), v.warnings);

  // 多命中消歧与 ambiguous 保留（根节点经 ctx.rootId 显式豁免）
  const vAmb = core.validateMapStructure({
    nodes: [
      { id: "a1", parentId: null, title: "根" },
      { id: "a2", parentId: "a1", title: "子", unitAnchors: ["dup.xhtml"], evidence: [{ quote: "重复句", startOffset: 40 }] }
    ]
  }, { textByUnit: new Map([["dup.xhtml", "重复句。中间。重复句。"]]), rootId: "a1" });
  const a2 = vAmb.nodes.find((n) => n.id === "a2");
  check("多命中 hint 消歧成功", a2 && a2.evidence.length === 1 && a2.evidence[0].positionAmbiguous === false, a2 && a2.evidence[0]);
  const vAmb2 = core.validateMapStructure({
    nodes: [
      { id: "a1", parentId: null, title: "根" },
      { id: "a2", parentId: "a1", title: "子", unitAnchors: ["dup.xhtml"], evidence: [{ quote: "重复句" }] }
    ]
  }, { textByUnit: new Map([["dup.xhtml", "重复句。中间。重复句。"]]), rootId: "a1" });
  const a22 = vAmb2.nodes.find((n) => n.id === "a2");
  check("多命中无 hint → AMBIGUOUS（证据有效，标记 positionAmbiguous）", a22 && a22.evidence.length === 1 && a22.evidence[0].positionAmbiguous === true, a22 && a22.evidence[0]);

  // 拒绝矩阵
  const bad = {
    nodes: [
      { id: "b0", parentId: null, title: "根" },
      { id: "b1", parentId: "ghost", title: "孤儿", unitAnchors: ["u1.xhtml"], evidence: [{ quote: "知识即经过检验的信念" }] },
      { id: "b2", parentId: "b2", title: "自环", unitAnchors: ["u1.xhtml"], evidence: [{ quote: "知识即经过检验的信念" }] },
      { id: "b3", parentId: "b0", title: "编造锚", unitAnchors: ["nope.xhtml"], evidence: [{ quote: "随便" }] },
      { id: "b4", parentId: "b0", title: "无证据", unitAnchors: ["u1.xhtml"], evidence: [{ quote: "原文中不存在的句子" }] },
      { id: "b5", parentId: "b4", title: "不可达", unitAnchors: ["u1.xhtml"], evidence: [{ quote: "知识即经过检验的信念" }] }
    ]
  };
  const vb = core.validateMapStructure(bad, { textByUnit: unitTexts });
  const reasons = vb.dropped.map((d) => d.reason).join("|");
  check("孤儿 REJECT", reasons.includes("孤儿"), vb.dropped);
  check("成环 REJECT", reasons.includes("成环"), vb.dropped);
  check("编造锚 REJECT", reasons.includes("编造"), vb.dropped);
  check("证据全不命中 → 非根无证据 REJECT", reasons.includes("无有效证据"), vb.dropped);
  check("父被拒后子节点级联拒绝（孤儿）", (vb.dropped.find((d) => d.id === "b5") || {}).reason.includes("孤儿"), vb.dropped);
  check("坏图整体拒绝渲染（ok=false 且零节点）", vb.ok === false && vb.nodes.length === 0, vb.nodes.map((n) => n.id));
  // role 越界警告 + grouping 越界警告
  const ve = core.validateMapStructure({
    nodes: [
      { id: "c1", parentId: null, title: "根" },
      { id: "c2", parentId: "c1", title: "越界角色", authorialRole: "magic", unitAnchors: ["u1.xhtml"], evidence: [{ quote: "知识即经过检验的信念" }] }
    ]
  }, { textByUnit: unitTexts, rootId: "c1" });
  check("role 越界置空并警告", ve.nodes.find((n) => n.id === "c2").authorialRole === null && ve.warnings.some((w) => w.includes("authorialRole")), ve.warnings);
}

// ---------- M15R-7 remap（D41-⑥ 优先级 ①锚 ②hash ③标题） ----------
{
  console.log("---- M15R-7 remap ----");
  const oldNodes = [
    { id: "o1", unitAnchors: ["u1.xhtml"], quoteHashes: ["h1", "h2"], title: "概念A" },
    { id: "o2", unitAnchors: ["u2.xhtml"], quoteHashes: ["h3"], title: "概念B" }
  ];
  const newNodes = [
    { id: "w1", unitAnchors: ["u1.xhtml"], quoteHashes: ["h1", "h2"], title: "概念A（新）" },
    { id: "w2", unitAnchors: ["u2.xhtml"], quoteHashes: [], title: "概念B" }
  ];
  const m = core.remapNodes(oldNodes, newNodes);
  check("锚重叠优先配对", m.get("o1") === "w1" && m.get("o2") === "w2", [...m.entries()]);
  const m2 = core.remapNodes(
    [{ id: "o1", unitAnchors: [], quoteHashes: [], title: "总结" }],
    [{ id: "w9", unitAnchors: [], quoteHashes: [], title: "总结" }]
  );
  // v48.5（用户审查约束 3）：标题相等仅为弱辅助信号，不得单独触发映射（同名节点遍布全书必误绑）
  check("仅标题相等不映射（弱信号约束）", m2.size === 0, [...m2.entries()]);
  const m3 = core.remapNodes(
    [{ id: "o1", unitAnchors: ["u1.xhtml"], quoteHashes: ["h1"], title: "X" }],
    [{ id: "w1", unitAnchors: ["u9.xhtml"], quoteHashes: [], title: "Y" }]
  );
  check("无信号不强行配对", m3.size === 0, [...m3.entries()]);
}

// ---------- M15R-8 有界摘要 ----------
{
  console.log("---- M15R-8 结构摘要 ----");
  const map = {
    title: "书",
    nodes: [
      { id: "r", parentId: null, title: "根" },
      { id: "a", parentId: "r", title: "甲" },
      { id: "b", parentId: "r", title: "乙" }
    ]
  };
  const s = core.deriveStructureSummary(map, 1200);
  check("摘要含全部节点且带角色标注位", s.includes("甲") && s.includes("乙"), s);
  const long = core.deriveStructureSummary({
    title: "书",
    nodes: Array.from({ length: 300 }, (_, i) => ({ id: `n${i}`, parentId: i ? `n${i - 1}` : null, title: `节点${i}（很长的标题文本以填充字数）` }))
  }, 500);
  check("超长截断并标注", long.length <= 520 && long.endsWith("（超长截断）"), long.slice(-20));
}

console.log("---- M15R-9 质量指标（Task 52，本地统计） ----");
{
  const map = {
    nodes: [
      { id: "root", parentId: null, title: "根", childIds: ["a", "b"], evidence: [], groupingBasis: { type: "sequence", explanation: "x" } },
      { id: "a", parentId: "root", title: "甲", childIds: [], evidence: [{ quote: "q" }], compositionalEvidence: [] },
      { id: "b", parentId: "root", title: "总结", childIds: [], evidence: [], compositionalEvidence: ["a"], groupingBasis: null }
    ]
  };
  const m = core.computeMapMetrics(map);
  check("节点计数与证据覆盖率（2/3）", m.nodeCount === 3 && m.evidenceCoverage === 0.67, m);
  check("最大深度 1 / 分支因子 2", m.maxDepth === 1 && m.branchingFactor === 2, m);
  check("空洞父率：伞形标题的叶子不算父（恒 0）", m.genericParentRate === 0, m);
  check("目录回声率（缺 grouping 的内部节点=0）", m.tocEchoRate === 0, m);
}

console.log(`\n==== SUMMARY ${pass}/${pass + fail} ====`);
if (fail) {
  console.log("FAILED items exist");
  process.exit(1);
}
