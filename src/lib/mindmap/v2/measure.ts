// 材料导图 v2 · 确定性估宽与卡片尺寸（MINDMAP-V2-IMPL-PLAN §5.1 measure.ts，D42）。
// 不用 canvas measureText（字体/平台相关 → 不确定）：按码位分类估宽，常量可调。
// 所有尺寸取 4px 网格整数；卡片高度取 8 的倍数，使「卡片中线」也落在 4px 网格上
// （版式按中线对齐时无需再取整）。

import type { V2Node } from "./types";

/** 每码位宽度（单位 em）。可调常量：改动会改变全部布局快照。 */
export const EM = {
  /** CJK 统一表意文字、假名、谚文、全角符号 */
  cjk: 1,
  /** 可打印 ASCII（字母、数字、半角标点） */
  ascii: 0.55,
  /** 半角空格 */
  space: 0.3,
  /** 其他（拉丁扩展、希腊、数学符号如 √ ⇒ 等） */
  other: 0.6,
} as const;

/** 字号（px）与卡片几何常量。 */
export const CARD = {
  titleSize: 13,
  typeSize: 11,
  rootSize: 15,
  /** 根卡片标题粗体放宽系数 */
  rootBold: 1.06,
  labelSize: 11,
  /** 卡片左右内边距合计 */
  padX: 24,
  /** 右侧徽标（＋ / +N / • / 呼吸点）预留 */
  badgeW: 20,
  minW: 96,
  maxW: 320,
  h: 48,
  rootPadX: 32,
  rootMinW: 160,
  rootMaxW: 400,
  rootH: 56,
  /** LOD「另有 N 项」卡片 */
  moreW: 112,
  moreH: 32,
} as const;

/** 向上取整到 4px 网格 */
export const r4 = (v: number): number => Math.ceil(v / 4 - 1e-9) * 4;
/** 就近取整到 4px 网格（用于居中等可能出现半格的位置） */
export const g4 = (v: number): number => Math.round(v / 4) * 4;

function isCjk(c: number): boolean {
  return (
    (c >= 0x1100 && c <= 0x11ff) ||
    (c >= 0x2e80 && c <= 0x303f) ||
    (c >= 0x3040 && c <= 0x9fff) ||
    (c >= 0xa960 && c <= 0xa97f) ||
    (c >= 0xac00 && c <= 0xd7af) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x1f300 && c <= 0x1faff) ||
    (c >= 0x20000 && c <= 0x3ffff)
  );
}

/** 单码位宽度（em） */
export function charEm(cp: number): number {
  if (cp < 0x80) return cp === 0x20 ? EM.space : cp < 0x20 ? 0 : EM.ascii;
  return isCjk(cp) ? EM.cjk : EM.other;
}

/** 文本估宽（px，未取整） */
export function textWidth(text: string, size: number): number {
  let em = 0;
  for (const ch of String(text ?? "")) em += charEm(ch.codePointAt(0) as number);
  return em * size;
}

/** 截断到 maxW（含省略号）；svg 渲染卡片标题时用，保证与布局估宽同口径 */
export function fitText(text: string, size: number, maxW: number): string {
  const s = String(text ?? "");
  if (textWidth(s, size) <= maxW) return s;
  const ell = "…";
  const budget = maxW - textWidth(ell, size);
  let w = 0;
  let out = "";
  for (const ch of s) {
    const cw = charEm(ch.codePointAt(0) as number) * size;
    if (w + cw > budget) break;
    w += cw;
    out += ch;
  }
  return out + ell;
}

export interface Size {
  w: number;
  h: number;
}

/** 普通节点卡片：两行（类型 11px / 标题 13px），宽度按较宽一行 */
export function cardSize(node: Pick<V2Node, "title" | "type">): Size {
  const tw = Math.max(textWidth(node.title, CARD.titleSize), textWidth(String(node.type ?? ""), CARD.typeSize));
  const w = Math.min(CARD.maxW, Math.max(CARD.minW, r4(tw + CARD.padX + CARD.badgeW)));
  return { w, h: CARD.h };
}

/** 合成根（材料标题）卡片 */
export function rootSize(title: string): Size {
  const tw = textWidth(title, CARD.rootSize) * CARD.rootBold;
  return { w: Math.min(CARD.rootMaxW, Math.max(CARD.rootMinW, r4(tw + CARD.rootPadX))), h: CARD.rootH };
}

/** LOD「另有 N 项」卡片 */
export function moreSize(): Size {
  return { w: CARD.moreW, h: CARD.moreH };
}

/** 卡片内标题可用宽度（svg 截断用） */
export function titleRoom(w: number, isRoot = false): number {
  return isRoot ? w - CARD.rootPadX : w - CARD.padX - CARD.badgeW;
}
