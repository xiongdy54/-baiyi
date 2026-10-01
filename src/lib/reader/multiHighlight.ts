// 多段选择的高亮渲染（v48.23 / D61 §6.8-11）：CSS Custom Highlight API（Highlight + CSS.highlights）。
// 为什么不是 DOM：EditableText 的「React 不接管子节点」是既定契约（§5.4），往正文插 <mark> 会与它打架；
// 而 ::highlight() 只画在绘制层——正文 DOM、markdown 管线、导出全都不动。
// 两个引擎共用本模块，只有两处引擎差异由调用方传入：
//   ① 当前活动选区在哪个文档（foliate = 章节 iframe 的 document，pdf = 宿主 document）；
//   ② ::highlight(multi-select) 的规则从哪来（宿主侧由 src/theme.css 的 Token 提供；
//      iframe 拿不到宿主 Token，故注入时把 --hl-multi 的求值结果写成字面值）。
// Range 是活对象：章节重排/文档卸载即失效，repaint 会按 isConnected 剪掉失效段（清理义务见 §6.8-11）。

/** 高亮名（CSS.highlights 注册名；与 src/theme.css 里 ::highlight(multi-select) 必须同名） */
export const MULTI_HIGHLIGHT_NAME = "multi-select";

/** 多段选择的集合动作（与 electron/annotationRange.js 的 updateSpanSet 返回同域） */
export type MultiHighlightAction = "replace" | "append" | "remove";

export interface MultiHighlightOptions {
  /** 当前有非折叠选区的文档（一个引擎同时只有一个活动选区；无则返回 null） */
  currentDoc(): Document | null;
  /** 返回要注入该文档的 ::highlight 规则文本；返回 null = 规则已在文档样式表里（宿主 theme.css 路径） */
  styleFor?(doc: Document): string | null;
}

export function createMultiHighlight(opts: MultiHighlightOptions) {
  const entries: { doc: Document; range: Range }[] = [];
  /** 被本模块挂过高亮的文档：清理时只在这些文档上 delete，不碰别处 */
  const registered = new Set<Document>();
  const styles = new Map<Document, HTMLStyleElement>();

  const winOf = (doc: Document) => doc.defaultView as (Window & {
    CSS?: { highlights?: { set(name: string, hl: unknown): void; delete(name: string): boolean } };
    Highlight?: new (...ranges: Range[]) => unknown;
  }) | null;

  /** 同一边界 ＝ 同一段（用原生边界比较，不引入文本/几何判据的第二套等价规则） */
  const sameBoundaries = (a: Range, b: Range) =>
    a.compareBoundaryPoints(Range.START_TO_START, b) === 0 && a.compareBoundaryPoints(Range.END_TO_END, b) === 0;

  /** 注入/更新该文档的 ::highlight 规则（主题切换后重新求值，不是一次性的） */
  const ensureStyle = (doc: Document) => {
    const css = opts.styleFor?.(doc);
    if (!css) return;
    let el = styles.get(doc);
    if (!el || !el.isConnected) {
      el = doc.createElement("style");
      el.setAttribute("data-reader-multi-highlight", "1");
      (doc.head ?? doc.documentElement)?.appendChild(el);
      styles.set(doc, el);
    }
    if (el.textContent !== css) el.textContent = css;
  };

  const drop = (doc: Document) => {
    winOf(doc)?.CSS?.highlights?.delete(MULTI_HIGHLIGHT_NAME);
    registered.delete(doc);
  };

  /** 重画：先剪失效段，再按文档分组注册（每文档一个 Highlight 实例，覆盖全部段） */
  const repaint = () => {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (!entries[i].range.startContainer.isConnected) entries.splice(i, 1);
    }
    const byDoc = new Map<Document, Range[]>();
    for (const e of entries) {
      const list = byDoc.get(e.doc) ?? [];
      list.push(e.range);
      byDoc.set(e.doc, list);
    }
    for (const doc of [...registered]) if (!byDoc.has(doc)) drop(doc);
    for (const [doc, ranges] of byDoc) {
      const win = winOf(doc);
      if (!win?.CSS?.highlights || typeof win.Highlight !== "function") continue; // 引擎/环境不支持 → 静默降级（菜单与载荷不受影响）
      ensureStyle(doc);
      win.CSS.highlights.set(MULTI_HIGHLIGHT_NAME, new win.Highlight(...ranges));
      registered.add(doc);
    }
  };

  return {
    /**
     * 按集合动作并入/移除「当前选区」：
     * replace＝只留当前选区；append＝并入；remove＝移除与当前选区边界相同的那段（再点同一段＝移出）。
     */
    update(action: MultiHighlightAction) {
      const doc = opts.currentDoc();
      const range = doc?.defaultView?.getSelection()?.rangeCount ? doc.defaultView.getSelection()?.getRangeAt(0) : null;
      if (!doc || !range || !range.toString().trim()) return; // 无选区可画（壳层只在有选区时调用）
      if (action === "replace") entries.length = 0;
      const hit = entries.findIndex((e) => e.doc === doc && sameBoundaries(e.range, range));
      if (action === "remove") {
        if (hit >= 0) entries.splice(hit, 1);
      } else {
        if (hit >= 0) entries.splice(hit, 1); // 同段重复采集：先摘掉再加（幂等）
        entries.push({ doc, range });
      }
      repaint();
    },
    /** 清空全部高亮（选区被清空 / 菜单动作完成 / Esc / 章切换由壳层调用） */
    clear() {
      entries.length = 0;
      for (const doc of [...registered]) drop(doc);
    },
    /** 当前存活段数（调试/测试用；失效段不计） */
    count() {
      return entries.filter((e) => e.range.startContainer.isConnected).length;
    }
  };
}
