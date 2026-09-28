// 摘录页卡面正文里的**批注痕迹**（批 4 修正：样张 `.q` 同规）。
// 样张的摘录页正文有三类痕迹：`.hl`＝该层自身范围锚、`.q`＝段锚批注（底色＝该批注色的透明档）。
// 本项目正文是 `EditableText` 裸壳（React 不接管子节点）⇒ **不得往 DOM 插 `<mark>`**（§3.3b），
// 故一律用 CSS Custom Highlight API 画在绘制层：按**颜色分组**注册（一个注册名只能一种底色）。
import { annotKey, annotSoft } from "./annotColor";

const STYLE_ID = "annot-body-highlight-style";
const NAME_PREFIX = "annot-body";
/** 本档注册过的高亮名（清空时要逐个 delete，避免残留） */
let registered: string[] = [];

const highlightName = (key: string) => `${NAME_PREFIX}-${key.replace(/[^a-z0-9-]/gi, "")}`;

/** 宿主文档里的规则表：每个色键一条（宿主有 Token，直接引 var()） */
function ensureStyle(doc: Document, keys: { key: string; color?: string | null }[]) {
  let el = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = doc.createElement("style");
    el.id = STYLE_ID;
    (doc.head ?? doc.documentElement).appendChild(el);
  }
  const css = keys
    .map((k) => `::highlight(${highlightName(k.key)}){background-color:${annotSoft(k.color)};}`)
    .join("\n");
  if (el.textContent !== css) el.textContent = css;
}

/**
 * 把字符偏移区间换成 Range（与 `ExtractCardFace.domTextOffset` **同一口径**：
 * 文本节点长度累加、`<br>` 计 1 —— 偏移来自 innerText，两端口径必须同构）。
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

export interface BodyAnnotationGroup {
  /** 该条的批注色（色板 id 或 #hex）；null＝未选色 */
  color?: string | null;
  ranges: { start: number; end: number }[];
}

/**
 * 重画卡面正文里的批注痕迹（**幂等**：先撤本档全部注册名，再按当前数据全量重建）。
 * 无痕迹时只做清理。环境不支持 Highlight API 时静默降级（正文照常可读可编辑）。
 */
export function paintBodyAnnotations(body: HTMLElement | null, groups: BodyAnnotationGroup[]): void {
  const doc = body?.ownerDocument;
  const win = doc?.defaultView as (Window & {
    CSS?: { highlights?: { set(n: string, h: unknown): void; delete(n: string): boolean } };
    Highlight?: new (...r: Range[]) => unknown;
  }) | null;
  if (!doc || !win?.CSS?.highlights || typeof win.Highlight !== "function") return;

  for (const name of registered) win.CSS.highlights.delete(name);
  registered = [];
  if (!body || groups.length === 0) return;

  // 按色键归并（一个注册名一种底色）
  const byKey = new Map<string, { color?: string | null; ranges: Range[] }>();
  for (const g of groups) {
    const k = annotKey(g.color);
    const bucket = byKey.get(k) ?? { color: g.color, ranges: [] };
    for (const r of g.ranges) {
      if (!(r.end > r.start)) continue;
      const range = rangeFromOffsets(body, r.start, r.end);
      if (range) bucket.ranges.push(range);
    }
    byKey.set(k, bucket);
  }
  const keys = [...byKey.entries()]
    .filter(([, v]) => v.ranges.length > 0)
    .map(([key, v]) => ({ key, color: v.color }));
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
