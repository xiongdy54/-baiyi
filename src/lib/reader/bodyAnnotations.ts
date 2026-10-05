// 摘录页卡面正文里的**批注痕迹**（批 4 修正：样张 `.q` 同规）。
// 样张的摘录页正文有三类痕迹：`.hl`＝该层自身范围锚、`.q`＝段锚批注（底色＝该批注色的透明档）。
// 本项目正文曾是 `EditableText` 裸壳（React 不接管子节点）⇒ **不得往 DOM 插 `<mark>`**（§3.3b），
// 故一律用 CSS Custom Highlight API 画在绘制层：按**颜色分组**注册（一个注册名只能一种底色）。
// D95 起读态换 markdown 渲染（React 可描述 DOM），绘制层原则不变——往 React 子树插 mark 会复活
// removeChild 崩溃；新增 map 参走「源偏移 ↔ 渲染 DOM」双向映射（src/lib/editor/markdownOffsetMap.ts），
// 无 map 时回落旧同构口径（文本节点累加 + br 计 1）。
import { annotKey, annotSoft, annotSolid } from "./annotColor";
import { srcToRange, type OffsetMap } from "../editor/markdownOffsetMap";

const STYLE_ID = "annot-body-highlight-style";
const NAME_PREFIX = "annot-body";
/** 本档注册过的高亮名（清空时要逐个 delete，避免残留） */
let registered: string[] = [];

const highlightName = (key: string) => `${NAME_PREFIX}-${key.replace(/[^a-z0-9-]/gi, "")}`;

/** 宿主文档里的规则表：每个（色键×形式）一条（宿主有 Token，直接引 var()） */
function ensureStyle(doc: Document, keys: { key: string; color?: string | null; underline?: boolean }[]) {
  let el = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = doc.createElement("style");
    el.id = STYLE_ID;
    (doc.head ?? doc.documentElement).appendChild(el);
  }
  const css = keys
    .map((k) =>
      k.underline
        ? // v48.41（D81）：下划线形式＝透明底 + 批注实色 2px 下划线（::highlight 允许 text-decoration）
          `::highlight(${highlightName(k.key)}){background-color:transparent;text-decoration:underline;text-decoration-color:${annotSolid(k.color)};text-decoration-thickness:2px;text-underline-offset:3px;}`
        : `::highlight(${highlightName(k.key)}){background-color:${annotSoft(k.color)};}`
    )
    .join("\n");
  if (el.textContent !== css) el.textContent = css;
}

/**
 * 把字符偏移区间换成 Range（旧纯文本同构口径：文本节点长度累加、`<br>` 计 1 ——
 * 偏移来自旧 EditableText 的 innerText；D95 起读态走 markdownOffsetMap 映射，本函数仅作无 map 回落）。
 */
function rangeFromOffsets(root: Node, start: number, end: number): Range | null {
  let acc = 0;
  let sNode: Node | null = null;
  let sOff = 0;
  let eNode: Node | null = null;
  let eOff = 0;
  const visit = (node: Node): boolean => {
    if (node.nodeType === 3) {
      const len = (node.textContent || "").length;
      if (sNode === null && acc + len >= start) {
        sNode = node;
        sOff = Math.max(0, start - acc);
      }
      if (acc + len >= end) {
        eNode = node;
        eOff = Math.max(0, end - acc);
        return true;
      }
      acc += len;
      return false;
    }
    if (node.nodeType === 1 && (node as Element).tagName === "BR") {
      const len = 1;
      if (sNode === null && acc + len >= start) {
        sNode = node.parentNode;
        sOff = Array.prototype.indexOf.call((node.parentNode as Node).childNodes, node);
      }
      if (acc + len >= end) {
        eNode = node.parentNode;
        eOff = Array.prototype.indexOf.call((node.parentNode as Node).childNodes, node) + 1;
        return true;
      }
      acc += len;
      return false;
    }
    if (node.nodeType === 1) {
      for (const kid of Array.from(node.childNodes)) if (visit(kid)) return true;
    }
    return false;
  };
  visit(root);
  if (!sNode || !eNode) return null;
  try {
    const r = root.ownerDocument!.createRange();
    r.setStart(sNode, sOff);
    r.setEnd(eNode, eOff);
    return r;
  } catch {
    return null;
  }
}

/**
 * 字符区间 → **视口矩形**（批注浮层的锚点用）：旧纯文本同构口径（文本节点长度累加、`<br>` 计 1），
 * 故栏内条目与文中那段一定对得上；D95 起有映射表时走 rectFromMappedOffsets。
 * 取整段包围盒（跨行时是并集盒）——与选区菜单同规：锚点＝包围盒而不是某个点。
 * 区间越界/空文本/量不到尺寸时返回 null（调用方退回卡面矩形，别把浮层丢到视口原点）。
 */
export function rectFromOffsets(
  root: HTMLElement | null,
  start: number,
  end: number
): { x: number; y: number; width: number; height: number } | null {
  if (!root || !(end > start)) return null;
  const range = rangeFromOffsets(root, start, end);
  if (!range) return null;
  const rect = range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return null;
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

export interface BodyAnnotationGroup {
  /** D95 §C.8：批注 id（点高亮 → 浮层的路由判据；纯增字段，零迁移） */
  id?: string;
  /** 该条的批注色（色板 id 或 #hex）；null＝未选色 */
  color?: string | null;
  /** v48.41（D81）：标记形式——true＝下划线（透明底+色线），缺省＝底色高亮 */
  underline?: boolean;
  ranges: { start: number; end: number }[];
}

/** 有映射表时：源偏移区间 → Range（D95 §C.4；缝隙端点吸附与 unmappable 降级在映射层完成） */
export function rangeFromMappedOffsets(map: OffsetMap, start: number, end: number): Range | null {
  return srcToRange(map, start, end);
}

/** 有映射表时的浮层锚点矩形（D95 §D.3；与 rectFromOffsets 同规，换算换映射） */
export function rectFromMappedOffsets(
  root: HTMLElement | null,
  map: OffsetMap | null,
  start: number,
  end: number
): { x: number; y: number; width: number; height: number } | null {
  if (!root || !map || !(end > start)) return null;
  const range = srcToRange(map, start, end);
  if (!range) return null;
  const rect = range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return null;
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

/**
 * 重画卡面正文里的批注痕迹（**幂等**：先撤本档全部注册名，再按当前数据全量重建）。
 * 无痕迹时只做清理。环境不支持 Highlight API 时静默降级（正文照常可读可编辑）。
 * map 在场＝markdown 读态（D95 §C.4，偏移经映射换 Range）；缺省＝旧纯文本同构口径。
 */
export function paintBodyAnnotations(body: HTMLElement | null, groups: BodyAnnotationGroup[], map?: OffsetMap | null): void {
  const doc = body?.ownerDocument;
  const win = doc?.defaultView as (Window & {
    CSS?: { highlights?: { set(n: string, h: unknown): void; delete(n: string): boolean } };
    Highlight?: new (...r: Range[]) => unknown;
  }) | null;
  if (!doc || !win?.CSS?.highlights || typeof win.Highlight !== "function") return;

  for (const name of registered) win.CSS.highlights.delete(name);
  registered = [];
  if (!body || groups.length === 0) return;

  // 按（色键×形式）归并（一个注册名一种画法）
  const byKey = new Map<string, { color?: string | null; underline: boolean; ranges: Range[] }>();
  for (const g of groups) {
    const k = `${annotKey(g.color)}${g.underline ? "|u" : ""}`;
    const bucket = byKey.get(k) ?? { color: g.color, underline: Boolean(g.underline), ranges: [] };
    for (const r of g.ranges) {
      if (!(r.end > r.start)) continue;
      const range = map ? rangeFromMappedOffsets(map, r.start, r.end) : rangeFromOffsets(body, r.start, r.end);
      if (range) bucket.ranges.push(range);
    }
    byKey.set(k, bucket);
  }
  const keys = [...byKey.entries()]
    .filter(([, v]) => v.ranges.length > 0)
    .map(([key, v]) => ({ key, color: v.color, underline: v.underline }));
  if (keys.length === 0) {
    const el = doc.getElementById(STYLE_ID);
    if (el) el.textContent = "";
    return;
  }
  ensureStyle(doc, keys);
  for (const [key, v] of byKey) {
    if (!v.ranges.length) continue;
    const name = highlightName(key);
    win.CSS.highlights.set(name, new win.Highlight(...v.ranges));
    registered.push(name);
  }
}

// ---------- viewOnly 的 quoteRanges 绘制（D95 §C.5：<mark class="extract-quote-hl"> 退役 → 绘制层） ----------

const QUOTE_STYLE_ID = "extract-quote-hl-style";
/** 注册名与退役的 DOM 类同名——::highlight 规则色值与旧 .extract-quote-hl 同为 var(--hl-multi) */
const QUOTE_NAME = "extract-quote-hl";
let quoteRegistered = false;

/**
 * 面包屑查看态的「该层自身范围」高亮（§C.5）：经映射表把源偏移区间画到渲染 DOM 的绘制层。
 * 旧 `<mark class="extract-quote-hl">` DOM 实现退役（§B.2：不再往 React 子树插 mark）；
 * 区间不可映射（如整段落在公式/围栏缝隙）时静默跳过——尽力而为语义不变。
 */
export function paintQuoteRanges(
  body: HTMLElement | null,
  ranges: Array<{ start: number; end: number }> | null | undefined,
  map: OffsetMap | null
): void {
  const doc = body?.ownerDocument;
  const win = doc?.defaultView as (Window & {
    CSS?: { highlights?: { set(n: string, h: unknown): void; delete(n: string): boolean } };
    Highlight?: new (...r: Range[]) => unknown;
  }) | null;
  if (!doc || !win?.CSS?.highlights || typeof win.Highlight !== "function") return;

  if (quoteRegistered) {
    win.CSS.highlights.delete(QUOTE_NAME);
    quoteRegistered = false;
  }
  if (!body || !map || !ranges || ranges.length === 0) return;

  const list: Range[] = [];
  for (const r of ranges) {
    if (!(r.end > r.start)) continue;
    const range = rangeFromMappedOffsets(map, r.start, r.end);
    if (range) list.push(range);
  }
  if (list.length === 0) return;

  let el = doc.getElementById(QUOTE_STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = doc.createElement("style");
    el.id = QUOTE_STYLE_ID;
    (doc.head ?? doc.documentElement).appendChild(el);
  }
  const css = `::highlight(${QUOTE_NAME}){background-color:var(--hl-multi);}`;
  if (el.textContent !== css) el.textContent = css;
  win.CSS.highlights.set(QUOTE_NAME, new win.Highlight(...list));
  quoteRegistered = true;
}
