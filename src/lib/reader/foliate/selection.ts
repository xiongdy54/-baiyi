// 选区语义化：从 iframe 内原生 Selection 提取 kernel 契约数据（text + cfi + anchorText）。
// anchorText = 选区起点附近的原文片段（≤60 字），是 CFI 失效后的文本级兜底锚点（可降级恢复链最后一环）。
import type { ReaderRect, ReaderSelection } from "../kernel";

type FoliateView = {
  getCFI(index: number, range?: Range): string;
} & HTMLElement;

type ContentEntry = { doc: Document; index: number };

/** 选区起点附近文本：优先同文本节点前后窗，不足则回落到所在块级容器文本开头 */
export function deriveAnchorText(range: Range): string {
  const node = range.startContainer;
  const text = node.textContent ?? "";
  const off = range.startOffset;
  const window = text.slice(Math.max(0, off - 30), off + 30).trim();
  if (window.replace(/\s/g, "").length >= 8) return window.slice(0, 60);
  const block = (node.parentElement ?? node.ownerDocument?.body) as HTMLElement | null;
  return (block?.textContent ?? "").trim().slice(0, 60);
}

export function getSelectionFromContents(
  view: FoliateView,
  contents: ContentEntry[]
): ReaderSelection | null {
  for (const { doc, index } of contents) {
    const sel = doc.defaultView?.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) continue;
    const text = sel.toString();
    if (!text.trim()) continue;
    const range = sel.getRangeAt(0);
    return {
      text,
      cfi: view.getCFI(index, range),
      anchorText: deriveAnchorText(range)
    };
  }
  return null;
}

/** 选区几何：iframe 内坐标换算为宿主视口坐标（供浮动菜单定位，非语义数据） */
export function getSelectionGeometryFromContents(
  contents: ContentEntry[]
): ReaderRect | null {
  for (const { doc } of contents) {
    const sel = doc.defaultView?.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) continue;
    const range = sel.getRangeAt(0);
    let r = range.getBoundingClientRect();
    if ((!r.width && !r.height) || Number.isNaN(r.left)) {
      r = range.getClientRects()[0] ?? r;
    }
    const frame = doc.defaultView?.frameElement as HTMLElement | null;
    if (!frame) return null;
    const fr = frame.getBoundingClientRect();
    return {
      x: fr.left + r.left,
      y: fr.top + r.top,
      width: r.width,
      height: r.height
    };
  }
  return null;
}

/** 内容指针事件坐标 → 宿主视口坐标 */
export function pointerToHost(doc: Document, clientX: number, clientY: number) {
  const frame = doc.defaultView?.frameElement as HTMLElement | null;
  const fr = frame?.getBoundingClientRect();
  return {
    x: (fr?.left ?? 0) + clientX,
    y: (fr?.top ?? 0) + clientY
  };
}
