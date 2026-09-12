// UDC 受控领域清单（与 electron/udc.js 同源；chart/卡片编辑用）
export interface UdcLeaf {
  code: string;
  label: string;
  main: string;
}

export const UDC_MAIN: { code: string; label: string }[] = [
  { code: "0", label: "总论·信息" },
  { code: "1", label: "哲学·心理" },
  { code: "2", label: "宗教·神学" },
  { code: "3", label: "社会科学" },
  { code: "5", label: "数学·自然" },
  { code: "6", label: "应用科技·健康" },
  { code: "7", label: "艺术·体育" },
  { code: "8", label: "语言·文学" },
  { code: "9", label: "历史·地理" }
];

export const UDC_LEAVES: UdcLeaf[] = [
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

export const UDC_OTHER = "other";
export const UDC_MAX = 2;

export function udcLabel(code: string): string {
  if (code === UDC_OTHER) return "其他";
  return UDC_LEAVES.find((l) => l.code === code)?.label ?? code;
}

// 过滤 AI 返回的 domain：非法剔除、去重、截断至上限
export function sanitizeDomain(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  const valid = new Set(UDC_LEAVES.map((l) => l.code));
  valid.add(UDC_OTHER);
  const out: string[] = [];
  for (const v of arr) {
    const s = String(v ?? "").trim();
    if (!s || !valid.has(s) || out.includes(s)) continue;
    out.push(s);
    if (out.length >= UDC_MAX) break;
  }
  return out;
}
