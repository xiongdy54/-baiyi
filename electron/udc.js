// UDC 受控领域清单（主类 + 精选二级，编号取自 Universal Decimal Classification）
// 单卡最多 2 个领域，首个为主领域（统计归档口径）。chart 侧渲染层用 src/lib/udc.ts（同源复制）。
const UDC_MAIN = [
  { code: "0", label: "总论·信息", children: ["004"] },
  { code: "1", label: "哲学·心理", children: ["1", "159.9"] },
  { code: "2", label: "宗教·神学", children: ["2"] },
  { code: "3", label: "社会科学", children: ["316", "32", "33", "34", "37"] },
  { code: "5", label: "数学·自然", children: ["51", "53", "54", "55", "57"] },
  { code: "6", label: "应用科技·健康", children: ["61", "62", "63"] },
  { code: "7", label: "艺术·体育", children: ["7", "78", "79", "796"] },
  { code: "8", label: "语言·文学", children: ["8"] },
  { code: "9", label: "历史·地理", children: ["91", "93"] }
];

// AI 可选的二级类目（主类 code 为前缀树上的父节点）
const UDC_LEAVES = [
  { code: "004", label: "计算机·AI", main: "0" },
  { code: "1", label: "哲学·逻辑", main: "1" },
  { code: "159.9", label: "心理学", main: "1" },
  { code: "2", label: "宗教·神学", main: "2" },
  { code: "316", label: "社会学·人类学", main: "3" },
  { code: "32", label: "政治·法律", main: "3" },
  { code: "33", label: "经济·金融", main: "3" },
  { code: "37", label: "教育·教学", main: "3" },
  { code: "51", label: "数学·统计", main: "5" },
  { code: "53", label: "物理·天文", main: "5" },
  { code: "54", label: "化学", main: "5" },
  { code: "55", label: "地球·环境", main: "5" },
  { code: "57", label: "生物", main: "5" },
  { code: "61", label: "医学·健康", main: "6" },
  { code: "62", label: "工程技术", main: "6" },
  { code: "63", label: "农业", main: "6" },
  { code: "7", label: "艺术·设计", main: "7" },
  { code: "78", label: "音乐", main: "7" },
  { code: "79", label: "影视·游戏", main: "7" },
  { code: "796", label: "体育·运动科学", main: "7" },
  { code: "8", label: "语言·文学", main: "8" },
  { code: "91", label: "地理", main: "9" },
  { code: "93", label: "历史·考古", main: "9" }
];

const UDC_OTHER = "other"; // 兜底：不属于任何类
const UDC_MAX = 2;         // 单卡领域上限

function udcPromptList() {
  return UDC_LEAVES.map((l) => `${l.code} ${l.label}`).join("；") + `；${UDC_OTHER} 其他`;
}

// 过滤 AI 返回的 domain：非法剔除、去重、截断至上限
function sanitizeDomain(arr) {
  if (!Array.isArray(arr)) return [];
  const valid = new Set(UDC_LEAVES.map((l) => l.code));
  valid.add(UDC_OTHER);
  const out = [];
  for (const v of arr) {
    const s = String(v ?? "").trim();
    if (!s || !valid.has(s) || out.includes(s)) continue;
    out.push(s);
    if (out.length >= UDC_MAX) break;
  }
  return out;
}

// context_prefix 关键词 → UDC 编号（旧卡回填用；匹配不到返回 null = 未分类）
const PREFIX_MAP = [
  [/统计|概率|线代|线性代数|数学|微积分|代数|几何|数理/, "51"],
  [/哲学|逻辑|伦理|美学|形而上/, "1"],
  [/心理|认知|情绪|记忆研究/, "159.9"],
  [/宗教|神学|佛|基督|圣经/, "2"],
  [/社会|政治|法律|人类|教育|传播|优绩|阶层|公共政策/, "316"],
  [/经济|金融|市场|货币|贸易/, "33"],
  [/计算机|编程|算法|AI|人工智能|机器学习|软件|网络/, "004"],
  [/物理|天文|量子|相对论|宇宙/, "53"],
  [/化学/, "54"],
  [/地质|气候|环境|地理|生态/, "55"],
  [/生物|基因|演化|神经|脑科学/, "57"],
  [/医学|健康|营养|疾病|药|解剖|生理/, "61"],
  [/工程|制造|机械|建筑|电子/, "62"],
  [/农业|作物|种植|畜牧/, "63"],
  [/艺术|设计|美术|绘画|电影|摄影/, "7"],
  [/音乐|乐理|乐器/, "78"],
  [/游戏|影视|戏剧/, "79"],
  [/运动|健身|训练|体育|力量|体能/, "796"],
  [/语言|英语|拉丁|语法|外语|文学|诗歌|写作/, "8"],
  [/历史|考古|文明|王朝|革命/, "93"]
];

function domainFromPrefix(prefix) {
  const p = String(prefix || "").replace(/[:：\s]/g, "");
  if (!p) return null;
  for (const [re, code] of PREFIX_MAP) {
    if (re.test(p)) return code;
  }
  return null;
}

module.exports = { UDC_MAIN, UDC_LEAVES, UDC_OTHER, UDC_MAX, udcPromptList, sanitizeDomain, domainFromPrefix };
