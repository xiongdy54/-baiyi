// 工具条图标集（D97 用户指令「按钮统一使用图标，悬停显示功能名称」）。
// 瑞士风：16×16、stroke currentColor 1.5、无填充、直角几何；B/I/S 用**字形本身**承载
// 语义（斜体＝真斜体、删除线＝真带删除线——用户实测「斜体图标是直的、删除线缺少删除线」）。
// 功能名称由按钮的 title 承担（悬停提示），图标只承载形状。
import type { ReactNode } from "react";

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const Svg = ({ children, box = 16 }: { children: ReactNode; box?: number }) => (
  <svg width="16" height="16" viewBox={`0 0 ${box} ${box}`} aria-hidden="true" focusable="false">
    {children}
  </svg>
);

/** 字形钮：B / I / S —— 语义由排版样式承载（粗体/斜体/删除线），比抽象图形更准确 */
export const GlyphBold = () => <span className="md-glyph md-glyph-bold" aria-hidden="true">B</span>;
export const GlyphItalic = () => <span className="md-glyph md-glyph-italic" aria-hidden="true">I</span>;
export const GlyphStrike = () => <span className="md-glyph md-glyph-strike" aria-hidden="true">S</span>;

export const IconCodeInline = () => (
  <Svg>
    <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" {...S} />
  </Svg>
);

export const IconLink = () => (
  <Svg>
    <path d="M6.5 9.5 9.5 6.5" {...S} />
    <path d="M7.5 4.5 9 3a3 3 0 0 1 4 4l-1.5 1.5M8.5 11.5 7 13a3 3 0 0 1-4-4l1.5-1.5" {...S} />
  </Svg>
);

export const IconInlineMath = () => (
  <Svg>
    <path d="M3 12c1.6 0 2-1.2 2-3V6.5C5 5 5.8 4 7.4 4" {...S} />
    <path d="M3.4 8h4.2M9.5 11.5 13.5 5.5M13.5 11.5 9.5 5.5" {...S} />
  </Svg>
);

export const IconQuote = () => (
  <Svg>
    <path d="M4 5.5h2.8v2.8H4zM9.2 5.5H12v2.8H9.2z" {...S} />
    <path d="M6.8 8.3c0 1.6-.9 2.6-2.4 3M12 8.3c0 1.6-.9 2.6-2.4 3" {...S} />
  </Svg>
);

export const IconUl = () => (
  <Svg>
    <circle cx="3.2" cy="4.5" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="3.2" cy="8" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="3.2" cy="11.5" r="0.9" fill="currentColor" stroke="none" />
    <path d="M6.5 4.5H14M6.5 8H14M6.5 11.5H14" {...S} />
  </Svg>
);

export const IconOl = () => (
  <Svg>
    <path d="M6.5 4.5H14M6.5 8H14M6.5 11.5H14" {...S} />
    <text x="1" y="6.2" fontSize="4.6" fill="currentColor" stroke="none" fontFamily="var(--font-mono, monospace)">1</text>
    <text x="1" y="9.7" fontSize="4.6" fill="currentColor" stroke="none" fontFamily="var(--font-mono, monospace)">2</text>
    <text x="1" y="13.2" fontSize="4.6" fill="currentColor" stroke="none" fontFamily="var(--font-mono, monospace)">3</text>
  </Svg>
);

export const IconTask = () => (
  <Svg>
    <rect x="3" y="3" width="10" height="10" {...S} />
    <path d="m5.8 8 1.8 1.8 3.4-3.6" {...S} />
  </Svg>
);

export const IconTable = () => (
  <Svg>
    <rect x="2.5" y="3.5" width="11" height="9" {...S} />
    <path d="M2.5 6.5h11M2.5 9.5h11M7 3.5v9M11 3.5v9" {...S} />
  </Svg>
);

export const IconCodeBlock = () => (
  <Svg>
    <rect x="2.5" y="3" width="11" height="10" {...S} />
    <path d="M6.5 6.5 4.8 8l1.7 1.5M9.5 6.5 11.2 8l-1.7 1.5" {...S} />
  </Svg>
);

export const IconHr = () => (
  <Svg>
    <path d="M2.5 8h11" {...S} />
  </Svg>
);

export const IconMathBlock = () => (
  <Svg>
    <path d="M4 3.5h8.5M4 12.5h8.5M11.5 3.5C7.5 5 7 8 9.5 8c-2.5 0-2 3 2 4.5" {...S} />
  </Svg>
);

/** 图表（Mermaid）：左上小方块经肘线指向右下小方块（流程图的极简形） */
export const IconMermaid = () => (
  <Svg>
    <rect x="2.5" y="2.5" width="4" height="3.5" {...S} />
    <rect x="9.5" y="10" width="4" height="3.5" {...S} />
    <path d="M4.5 6v5.75h2.5" {...S} />
    <path d="m7.5 10.25 2 1.5-2 1.5" {...S} />
  </Svg>
);

/** 标注：斜置荧光笔（笔杆 + 出墨斜面 + 一道被涂亮的线） */
export const IconMark = () => (
  <Svg>
    <path d="m9.2 3.2 3.6 3.6-6 6-4.4.8.8-4.4z" {...S} />
    <path d="m7.5 4.9 3.6 3.6" {...S} />
  </Svg>
);

/** 折叠列表：实心下箭头（折叠指示）+ 两行内容 */
export const IconDetails = () => (
  <Svg>
    <path d="M4 5.5h8" {...S} />
    <path d="m6.5 8 1.5 1.8L9.5 8" {...S} />
    <path d="M4 12h8" {...S} />
  </Svg>
);

export const IconUndo = () => (
  <Svg>
    <path d="M4.5 6.5H10a3 3 0 0 1 0 6H6" {...S} />
    <path d="m6.5 4.5-2 2 2 2" {...S} />
  </Svg>
);

export const IconRedo = () => (
  <Svg>
    <path d="M11.5 6.5H6a3 3 0 0 0 0 6h4" {...S} />
    <path d="m9.5 4.5 2 2-2 2" {...S} />
  </Svg>
);

/** 标题层级下拉钮：H + 下箭头 */
export const IconHeading = () => (
  <Svg>
    <path d="M3 13V3.5M9.5 13V3.5M3 8.2h6.5" {...S} />
    <path d="m11.5 8.5 1.5 2 1.5-2" {...S} />
  </Svg>
);
