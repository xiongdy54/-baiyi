// 材料知识导图——SVG 渲染器（v48 批3，M15，D42 / §4.19-9）。
// 纯函数：只读 validated map + layout + theme，产出 SVG 字符串。AI 输出永不直接进渲染器。
// 视觉契约（瑞士风）：单 accent（root 为全图唯一 accent 焦点）、直角、无阴影无渐变、1px hairline、
// 正交肘形连线、4px 网格坐标（布局层保证）。色值由调用方解析自 CSS 变量（交互视图）或写死（自包含导出）。

import type { LayoutResult, LayoutNode } from "./layout";

export interface MapTheme {
  paper: string;
  ink: string;
  inkSoft: string;
  border: string;
  accent: string;
  accentOn: string;
  accentSoft: string;
  fontFamily: string;
  fontSize: number;
}

export interface RenderOptions {
  selectedId?: string | null;
  /** 自包含导出：无交互态、色值内置（调用方传实际色值即可，本开关只影响结构） */
  static?: boolean;
}

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncateForWidth(title: string, w: number, fontSize: number): string {
  const maxChars = Math.max(2, Math.floor((w - 24) / fontSize));
  const t = String(title ?? "");
  return t.length > maxChars ? t.slice(0, Math.max(1, maxChars - 1)) + "…" : t;
}

export function buildMapSvg(layout: LayoutResult, theme: MapTheme, opts: RenderOptions = {}): string {
  const { nodes, edges, bounds } = layout;
  const pad = 24;
  const w = Math.max(bounds.w + pad * 2, 320);
  const h = Math.max(bounds.h + pad * 2, 200);
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${-pad} ${-pad} ${w} ${h}" font-family="${esc(theme.fontFamily)}">`
  );
  // 背景（paper——导出自包含时必须有底色；交互视图同色即隐形）
  parts.push(`<rect x="${-pad}" y="${-pad}" width="${w}" height="${h}" fill="${theme.paper}"/>`);
  // 边在下层：1px hairline、正交肘形、无交叉（树布局保证）
  for (const e of edges) {
    parts.push(`<path d="${e.d}" fill="none" stroke="${theme.border}" stroke-width="1"/>`);
  }
  // 节点：直角矩形 + 单行标题；root = 全图唯一 accent 焦点；selected = accent 描边 + accentSoft 底
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    parts.push(renderNode(n, (n.parentId && byId.get(n.parentId)) || null, theme, opts));
  }
  parts.push("</svg>");
  return parts.join("");
}

function renderNode(n: LayoutNode, parent: LayoutNode | null, theme: MapTheme, opts: RenderOptions): string {
  const isRoot = !parent;
  const selected = opts.selectedId === n.id;
  const fill = isRoot ? theme.accent : selected ? theme.accentSoft : theme.paper;
  const stroke = isRoot ? theme.accent : selected ? theme.accent : theme.border;
  const strokeWidth = selected ? 2 : 1;
  const textFill = isRoot ? theme.accentOn : theme.ink;
  const label = truncateForWidth(n.title, n.w, theme.fontSize);
  const parts: string[] = [];
  parts.push(
    `<g data-node-id="${esc(n.id)}">` +
      `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>` +
      `<text x="${n.x + 12}" y="${n.y + n.h / 2}" dominant-baseline="central" font-size="${theme.fontSize}" fill="${textFill}">${esc(label)}</text>`
  );
  if (n.deepenable) {
    // v48.13 P4：可深化徽标——右缘外挂小方块（与折叠徽标同槽位；二者互斥：折叠要求有子节点）。
    // 语义＝「此处尚有更深的结构未生成」，与「已到底的叶」在视觉上必须可区分。
    const bx = n.x + n.w + 6;
    const by = n.y + n.h / 2 - 10;
    parts.push(
      `<rect x="${bx}" y="${by}" width="20" height="20" fill="${theme.paper}" stroke="${theme.border}" stroke-width="1"/>` +
        `<text x="${bx + 10}" y="${by + 10}" text-anchor="middle" dominant-baseline="central" font-size="11" fill="${theme.inkSoft}">＋</text>` +
        `<title>尚无更深结构 · 可深化</title>`
    );
  }
  if (n.collapsed) {
    // 折叠徽标：右缘外挂小方块（直角、hairline、无装饰）
    const bw = 8 + String(n.collapsedCount).length * 8;
    const bx = n.x + n.w + 6;
    const by = n.y + n.h / 2 - 10;
    parts.push(
      `<rect x="${bx}" y="${by}" width="${bw}" height="20" fill="${theme.paper}" stroke="${theme.border}" stroke-width="1"/>` +
        `<text x="${bx + bw / 2}" y="${by + 10}" text-anchor="middle" dominant-baseline="central" font-size="11" fill="${theme.inkSoft}">+${n.collapsedCount}</text>`
    );
  }
  parts.push("</g>");
  return parts.join("");
}
