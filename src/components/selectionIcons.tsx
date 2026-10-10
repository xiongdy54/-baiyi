// 选区浮条图标集（D122）——规格与编辑条（editor/toolbarIcons.tsx）完全一致：
// 16×16 画布、stroke currentColor 1.5、圆角端点、无填充；按钮 26×24（.sel-btn.ic）。
// 功能名称由按钮 title 承担（悬停提示）；颜色一律 currentColor，深浅色自动跟随。
import type { ReactNode } from "react";
import { IconMark } from "./editor/toolbarIcons";

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const Svg = ({ children }: { children: ReactNode }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

/** 批注：对话气泡（带尾）+ 两行文字——一眼是「写评论」，与「制卡」的叠卡造型区分 */
export const IconSelNote = () => (
  <Svg>
    <path d="M2.5 3.5h11v7.2H8.1L5 13.3v-2.6H2.5z" {...S} />
    <path d="M5.2 6.1h5.6M5.2 8.3h3.4" {...S} />
  </Svg>
);

/** 制卡：叠放的两张卡（后卡露出上沿与右沿）+ 前卡中央加号 */
export const IconSelCard = () => (
  <Svg>
    <path d="M5 3.2h8.5v7.3" {...S} />
    <rect x="2.5" y="5.5" width="9" height="7.5" {...S} />
    <path d="M7 7.6v3.3M5.35 9.25h3.3" {...S} />
  </Svg>
);

/** AI 制卡：四角星 + 小十字（与「制卡」的叠卡区分，沿用 AI 通用星芒语义） */
export const IconSelAiCards = () => (
  <Svg>
    <path d="M6.7 3 8 6.4 11.4 7.7 8 9 6.7 12.4 5.4 9 2 7.7 5.4 6.4z" {...S} />
    <path d="M12.5 2.5v3M11 4h3" {...S} />
  </Svg>
);

/** AI 解释：灯泡 */
export const IconSelExplain = () => (
  <Svg>
    <path d="M8 2.5a3.8 3.8 0 0 0-2 7c.4.3.5.7.5 1h3c0-.3.1-.7.5-1a3.8 3.8 0 0 0-2-7z" {...S} />
    <path d="M6.3 12.3h3.4M6.8 14h2.4" {...S} />
  </Svg>
);

/** 查词：摊开的书 */
export const IconSelLookup = () => (
  <Svg>
    <path d="M2.5 3.5h3.3A2.2 2.2 0 0 1 8 5.7V13a2 2 0 0 0-2-1.5H2.5z" {...S} />
    <path d="M13.5 3.5h-3.3A2.2 2.2 0 0 0 8 5.7V13a2 2 0 0 1 2-1.5h3.5z" {...S} />
  </Svg>
);

/** 截图（工具栏）：取景框四角 + 中心点 */
export const IconSelCapture = () => (
  <Svg>
    <path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3" {...S} />
    <rect x="6.5" y="6.5" width="3" height="3" {...S} />
  </Svg>
);

/** 向右展开箭头（展开后由 CSS 旋转 180°） */
export const IconSelChevron = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="m6 3.5 4.5 4.5L6 12.5" {...S} />
  </svg>
);

/** 标注选项钮（折叠态）：荧光笔，沿用编辑条「标注」同款图标 */
export { IconMark as IconSelMark };
