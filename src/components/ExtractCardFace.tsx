import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { attachRipple, settle } from "../lib/press";
import { extractStatusLabel, type ExtractEngine } from "../lib/sessionQueue";
import type { DueTopic } from "../lib/readingWorkflow";
import {
  paintBodyAnnotations,
  paintQuoteRanges,
  type BodyAnnotationGroup
} from "../lib/reader/bodyAnnotations";
import {
  buildOffsetMap,
  blockIndexForSrc,
  domToSrc,
  resolveCaret,
  srcToRange,
  type OffsetMap
} from "../lib/editor/markdownOffsetMap";
import { ExtractEditor, type ExtractEditorApi } from "./editor/ExtractEditor";
import { useExtractFaceTypography } from "../lib/extractCardSettings";
import { t, useT } from "../lib/i18n";

const DAY = 86400000;

/** 时间显示：与批注栏同档（MM-DD HH:mm，AnnotationPanel 同款） */
function fmtTime(t: number): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/* 优先级＝滑块 0–100（右侧数字可直接输入）：旧的离散档位下拉与快捷推迟 1/3/7/30 均已退役
   （用户 2026-10-01：快捷推迟不需要了；优先级要做成滑块 + 可输入数字）。 */

/** 距下次推送的文案（与队列口径一致：到期显示「现已到期」） */
export function nextAtText(nextAt?: number, now = Date.now()): string {
  const at = Number(nextAt);
  if (!Number.isFinite(at)) return "";
  const delta = at - now;
  if (delta <= 0) return t("现已到期");
  const days = delta / DAY;
  if (days < 1) return t("今日稍后推送");
  return t("{n} 天后推送", { n: Math.round(days) });
}

/** `quote_range_json`（字符串或数组）→ 规范化区间；坏数据一律空数组（不抛） */
export function parseQuoteRanges(raw: unknown): Array<{ start: number; end: number }> {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  return v
    .map((r) => ({
      start: Math.max(0, Math.floor(Number((r as { start?: unknown })?.start) || 0)),
      end: Math.max(0, Math.ceil(Number((r as { end?: unknown })?.end) || 0))
    }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
}

// 读态渲染管线（D95 §1/§B.1 → §J.2 收口）：抽到共享组件 `editor/ReadMarkdown`（与日记等一切
// markdown 展示面同一份管线），此处只消费——保证「同一段 markdown 全应用渲染一致」。
import ReadMarkdown from "./editor/ReadMarkdown";

/**
 * 当前选区在**该卡正文**里的字符偏移（D95 §C.6）：经源偏移↔渲染 DOM 双向映射换算，
 * 多段不相邻选择＝多组偏移、越界/塌缩过滤、排序——与旧 `selectionOffsetsInBody` 同形，
 * 消费方（ExtractReviewView 集合运算）零改动。选区起点取 before、终点取 after：
 * 端点落在公式等 unmappable 缝隙时高亮罩住整段。
 */
export function selectionOffsetsViaMap(root: HTMLElement, map: OffsetMap | null): Array<{ start: number; end: number }> {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (!sel || !sel.rangeCount || !map) return [];
  const out: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < sel.rangeCount; i++) {
    const r = sel.getRangeAt(i);
    if (!root.contains(r.commonAncestorContainer)) continue;
    const sc = resolveCaret(r.startContainer, r.startOffset);
    const ec = resolveCaret(r.endContainer, r.endOffset);
    if (!sc || !ec) continue;
    const s = domToSrc(map, sc.node, sc.off, "before");
    const e = domToSrc(map, ec.node, ec.off, "after");
    if (s === null || e === null || e <= s) continue;
    out.push({ start: s, end: e });
  }
  return out.sort((a, b) => a.start - b.start);
}

export interface ExtractFaceHandlers {
  /** 会话态的调度动作：可选——**查看态**（面包屑回看某层）不传任何写动作 */
  onAdvance?: () => void;
  onPostpone?: (days: number) => void;
  onPriority?: (priority: number) => void;
  onGraduate?: () => void;
  onEdit?: (text: string) => void;
  onJumpToSource?: () => void;
  onUndo?: () => void;
  /**
   * 规格 §1.2：就地另立子摘录——载荷＝卡面里**选中的那段**（文本 + 该段在本卡正文里的字符偏移），
   * 没有选区时＝整条正文（`ranges` ＝整条区间）。父侧偏移由外层写进子摘录 contextRef.parentRange，
   * 子卡「跳转原文」据此回到父卡并高亮所选那句。
   */
  /**
   * 批 4 Task 10（规格 §3）：把「正文里的这次选区」报给外层，供选区菜单定位与动作取文本。
   * 采集时机与 `picked` 快照同源（mouseup/keyup），载荷含 rect（视口坐标，菜单锚点 R22）、
   * 各段在本卡正文里的偏移、以及按偏移切出的文本（与落库文本逐字符对齐）。
   * 选区落到正文之外或塌缩 ⇒ 报 null（外层据此收起菜单）。
   */
  onSelection?: (
    payload: { rect: { x: number; y: number; width: number; height: number }; ranges: Array<{ start: number; end: number }>; text: string } | null,
    /** 指针事件的修饰位（v48.38 / D78：摘录页卡面 Ctrl 多段选择；键盘采集不带修饰＝替换） */
    modifier?: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean }
  ) => void;
  /**
   * D95 §D.3：READ 态点高亮命中段锚批注 → 宿主据此开批注浮层（与批注轨 onJump 同一浮层同一落库链）。
   * handler 缺失时点高亮＝不进编辑也不弹层（合并复习分支宿主未接批注编排的现状语义）。
   */
  onHighlightClick?: (annotationId: string) => void;
}

/**
 * 摘录卡面（v48.22 / D58 §6.8）：沉浸式连续处理页与复习页**共用同一组件**。
 * D95 §B.1 三分支：`viewOnly`（查看态）与会话**读态**（新默认）都走 ReactMarkdown 渲染 + 绘制层高亮；
 * 会话读态点非高亮区进编辑（ExtractEditor，WYSIWYG），点高亮弹批注浮层，划选不进编辑（§D）。
 * `viewOnly` ＝面包屑查看态（只读渲染 + 高亮该层范围，不出现任何调度动作，无编辑出口 §D.4）。
 */
export default function ExtractCardFace({
  extract,
  madeCardCount,
  engine,
  busy,
  viewOnly,
  quoteRanges,
  bodyAnnotations,
  onOffsetMap,
  handlers
}: {
  extract: DueTopic;
  madeCardCount?: number;
  engine?: ExtractEngine;
  busy?: boolean;
  /** 查看态：只读正文 + 高亮，不出动作行（不推进调度、不改队列） */
  viewOnly?: boolean;
  /** 要呈现为高亮的区间（相对本条正文；落点用） */
  quoteRanges?: Array<{ start: number; end: number }> | null;
  /**
   * 批 4 修正（样张 `.q` 同规）：挂在本卡上的**段锚批注**——按色画在正文绘制层里
   * （CSS Custom Highlight API，不碰 DOM）。栏内条目与文中那段据此对上。
   */
  bodyAnnotations?: BodyAnnotationGroup[];
  /** D95 §D.3：映射表建好/销毁时上报宿主（浮层锚点 anchorForAnnotation 换算用） */
  onOffsetMap?: (map: OffsetMap | null) => void;
  handlers: ExtractFaceHandlers;
}) {
  const T = useT();
  const depth = Number(extract.depth) || 1;
  const bodyRef = useRef<HTMLDivElement | null>(null);
  /** viewOnly 落点滚动用：第一个可映射区间（尽力而为，§C.5） */
  const hlRangeRef = useRef<Range | null>(null);
  /** D95 §D.1 读/写状态机（每卡一份，随 extract.id 重置；viewOnly 恒 READ） */
  const [editing, setEditing] = useState(false);
  /** 编辑器 API（提交/焦点落点） */
  const editorApiRef = useRef<ExtractEditorApi | null>(null);
  /** 进入编辑时的焦点块索引（§D.2 P0 块级；null＝文档开头） */
  const pendingFocusRef = useRef<number | null>(null);
  /** 源偏移↔渲染 DOM 映射（读态建表；选区采集/点击路由/高亮绘制共用） */
  const mapRef = useRef<OffsetMap | null>(null);
  /** D95 v1.3：摘录自身的**原始批注**（在原文中摘录本段时所做；与批注轨里的子批注不同层级）。
      listDueExtracts 的 SELECT 已透传 e.comment（DueTopic 类型未声明，读取处收窄，
      同 annotationColor 的 cast 口径）；空批注不渲染块。 */
  const ownComment = String((extract as DueTopic & { comment?: string | null }).comment ?? "").trim();
  /** v1.4：批注块节点——读态直排正文下、编辑态经 footer 进编辑器（正文与工具条之间） */
  const annotBlock = ownComment ? (
    <div className="extract-face-annot" data-testid="extract-face-comment" data-noedit="1">
      <div className="sec-label">{T("批注")}</div>
      <div className="extract-face-annot-text">{ownComment}</div>
    </div>
  ) : null;
  /** §F：字号/字体桥（两宿主共用本组件，桥随组件挂/卸）。工具条开关与形态（§J.2「随组件走」）
      由 MarkdownEditor 内部读设置键，宿主不再逐层透传。 */
  useExtractFaceTypography();
  /**
   * 本次拖选手势**起手**的修饰位（v48.39 / D79）：document mousedown 上采样，mouseup 收尾求或。
   * 必须是组件级 ref 而非 effect 闭包变量——handlers 依赖每次渲染都是新身份，effect 重挂会
   * 把闭包变量重置；拖选中途任何重渲染（如 keyup 采集引发的 setFaceSel）都会抹掉起手采样。
   */
  const gestureDownModRef = useRef({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });
  /** 指针拖选进行中（v48.39 / D79）：拖选期间抑制 keyup 的键盘采集（见 onKey），收尾以 mouseup 为准 */
  const pointerDownActiveRef = useRef(false);
  /** onOffsetMap 的最新引用（映射重建 effect 不随 handlers/prop 身份变化重跑） */
  const onOffsetMapRef = useRef(onOffsetMap);
  onOffsetMapRef.current = onOffsetMap;

  // 换卡即清快照并退出编辑态（偏移是相对**这一版正文**的，跨卡复用会把范围锚写歪；§D.1 状态机随卡重置）
  useEffect(() => {
    setEditing(false);
    handlers.onSelection?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extract.id]);

  /** 进入编辑（§D.2）：src＝点击源偏移（可空＝映射不可用，光标落文档开头） */
  const enterEdit = (src: number | null) => {
    if (src !== null && mapRef.current) {
      pendingFocusRef.current = blockIndexForSrc(mapRef.current, src);
    } else {
      pendingFocusRef.current = null;
    }
    // 清掉可能残留的多段选区快照（编辑态内划选＝编辑器内原生选择，不进宿主集合）
    handlers.onSelection?.(null);
    window.getSelection()?.removeAllRanges();
    setEditing(true);
  };

  /**
   * 点击路由（§C.7/§D.2，仅会话读态）：①选区塌缩（真点击，划选收尾不触发）；②映射换算源偏移；
   * 命中段锚批注 → onHighlightClick（缺失＝不动）；未命中 → 进编辑。映射无内容（空卡）→ 直接进编辑。
   */
  const onBodyClick = (e: ReactMouseEvent) => {
    if (viewOnly || editing || !handlers.onEdit) return;
    const target = e.target as Node | null;
    if (target && (target as HTMLElement).closest?.(".extract-face-toolbar")) return; // 工具栏自身不算正文点击
    if (target && (target as HTMLElement).closest?.("[data-noedit]")) return; // 批注块等非正文区（v1.4）
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (!sel || !sel.isCollapsed) return; // 划选不进编辑（§D.4）
    const map = mapRef.current;
    if (!map) return; // 渲染未就绪（本帧刚切换态等）：忽略本次点击
    const caret = resolveCaret(sel.anchorNode, sel.anchorOffset);
    const src = caret ? domToSrc(map, caret.node, caret.off, "before") : null;
    if (src === null) {
      if (map.segments.length === 0) enterEdit(null); // 空卡：点正文任意处开始编辑
      return;
    }
    const hit = (bodyAnnotations ?? []).find(
      (g) => g.id && g.ranges.some((r) => src >= r.start && src <= r.end)
    );
    if (hit?.id) {
      handlers.onHighlightClick?.(hit.id); // 命中高亮 → 浮层（handler 缺失＝不进编辑）
      return;
    }
    enterEdit(src);
  };

  /** 编辑态 Esc＝提交并退回 READ（§D.5；与 EditableText 现行语义一致） */
  const onBodyKeyDown = (e: ReactKeyboardEvent) => {
    if (!editing) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      editorApiRef.current?.commit();
    }
  };

  /** 编辑器提交：无变更/幂等（null）直接退读态；有变更走既有 onEdit → updateContent 落库链（§B.3） */
  const handleEditorCommit = (text: string | null) => {
    setEditing(false);
    if (text !== null) handlers.onEdit?.(text);
  };

  /**
   * 读态映射建表（§C.3）：ReactMarkdown 提交后按当前正文重建（换卡/内容变化即重建），
   * 并据此重画批注痕迹、上报宿主。编辑态不建（§D.1：编辑中内容在变、区间映射失效，重映射在提交时由 db 完成）。
   */
  useEffect(() => {
    if (viewOnly || editing) return;
    const body = bodyRef.current;
    if (!body) return;
    const md = String(extract.contentMarkdown || "");
    const map = buildOffsetMap(md, body);
    mapRef.current = map;
    onOffsetMapRef.current?.(map);
    paintBodyAnnotations(body, bodyAnnotations ?? [], map);
    return () => {
      paintBodyAnnotations(null, []);
      onOffsetMapRef.current?.(null);
      mapRef.current = null;
    };
  }, [viewOnly, editing, extract.id, extract.contentMarkdown, bodyAnnotations]);

  /**
   * viewOnly：quoteRanges 经映射画到绘制层（§C.5，`<mark class="extract-quote-hl">` 已退役），
   * 并记录第一个可映射区间供落点滚动（尽力而为）。
   */
  useEffect(() => {
    if (!viewOnly) return;
    const body = bodyRef.current;
    if (!body) return;
    const map = buildOffsetMap(String(extract.contentMarkdown || ""), body);
    const ranges = quoteRanges ?? [];
    paintQuoteRanges(body, ranges, map);
    hlRangeRef.current = null;
    for (const r of ranges) {
      const range = srcToRange(map, r.start, r.end);
      if (range) {
        hlRangeRef.current = range;
        break;
      }
    }
    return () => {
      paintQuoteRanges(null, [], null);
      hlRangeRef.current = null;
    };
  }, [viewOnly, extract.id, extract.contentMarkdown, quoteRanges]);

  // 落点（尽力而为）：映射 Range → 视口矩形 → 滚动容器居中（容器不可滚时是一次 no-op，§C.5）
  useEffect(() => {
    if (!viewOnly) return;
    const body = bodyRef.current;
    const range = hlRangeRef.current;
    if (!body || !range) return;
    // D97：正文区自身即滚动容器（卡面定高、内部滚动）——从 body 起步向上找
    let scroller: HTMLElement | null = body;
    while (scroller && scroller.scrollHeight <= scroller.clientHeight + 1) {
      scroller = scroller.parentElement;
    }
    if (!scroller) return;
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return;
    const box = scroller.getBoundingClientRect();
    const target = rect.top - box.top + scroller.scrollTop + rect.height / 2 - scroller.clientHeight / 2;
    scroller.scrollTop = Math.max(0, target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewOnly, extract.id]);

  useEffect(() => {
    if (viewOnly || editing) return;
    const body = bodyRef.current;
    if (!body) return;
    const face = body.closest(".extract-face");
    // v48.38 / D78：capture 携带指针修饰位——集合运算（替换/加选/移出）由宿主按 app.multiSelectKey 判定
    // v48.39（D79）：修饰键按**手势全程**判定——mousedown 起手采样（组件级 ref，见其注释），mouseup 收尾求或：
    // 真实用户收尾常先松修饰键再松鼠标，只看 mouseup 会把这次加选误判成「替换」、抹掉已累计的集合
    const onDown = (e: MouseEvent) => {
      pointerDownActiveRef.current = true;
      gestureDownModRef.current = { ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey: e.metaKey };
    };
    const capture = (modifier?: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean }) => {
      const full = String(extract.contentMarkdown || "");
      const ok = selectionOffsetsViaMap(body, mapRef.current).filter((r) => r.start < full.length && r.end <= full.length);
      const text = ok.map((r) => full.slice(r.start, r.end)).join("\n\n");
      const live = ok.length && text.trim() ? { text, ranges: ok } : null;
      // 批 4 Task 10：同一采集点把选区报给外层（含视口坐标 rect＝菜单锚点；R22 不用 pointerup 点）——
         // 摘录页的「摘录」从这里取载荷（无选区时菜单动作不出现，不再有整条兜底那条路）
      const sel = typeof window !== "undefined" ? window.getSelection() : null;
      const r = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
      handlers.onSelection?.(
        live && r && (r.width || r.height)
          ? { rect: { x: r.left, y: r.top, width: r.width, height: r.height }, ranges: live.ranges, text: live.text }
          : null,
        modifier
      );
    };
    const onUp = (e: Event) => {
      pointerDownActiveRef.current = false;
      const t = e.target as Node | null;
      if (t && body.contains(t)) {
        const me = e as MouseEvent;
        // v48.39（D79）：起手（mousedown）与收尾（mouseup）修饰位求或——手势全程判定
        const dm = gestureDownModRef.current;
        capture({
          ctrlKey: me.ctrlKey || dm.ctrlKey,
          altKey: me.altKey || dm.altKey,
          shiftKey: me.shiftKey || dm.shiftKey,
          metaKey: me.metaKey || dm.metaKey
        });
        return;
      }
      // 卡外落下＝选区作废（卡片外的动作面除外：菜单/面板/工具栏自身的 mouseup 不算）。
      // 批 4 Task 10：选区菜单与三个面板渲染在**卡面之外**（页级），点它们同样是「动作面」而非
      // 「点别处」——不豁免的话，mouseup 会先清掉快照/选区，按钮的 onClick 再读就晚了（实测三动作全哑）。
      // v48.41（D81）：页头工具栏（.extract-toolbar，动作行新宿主）同列豁免。
      const el = t as HTMLElement | null;
      const inActionSurface =
        !!el && typeof el.closest === "function" &&
        !!(el.closest(".selection-menu") || el.closest(".modal-panel") || el.closest(".dict-panel") || el.closest(".ai-panel") || el.closest(".extract-toolbar"));
      if (inActionSurface) return;
      if (!(t && face && face.contains(t))) {
        handlers.onSelection?.(null);
      }
    };
    const onKey = () => {
      // v48.39（D79）：指针拖选进行中的 keyup 不采集——松修饰键（如 Ctrl）会走到这里，
      // 按无修饰＝替换上报会把拖选尚未定型的部分选区当成新选区、当场抹掉已累计的集合；
      // 收尾由 mouseup 统一采集（起手/收尾修饰位求或）。纯键盘选区（无指针拖选）不受影响。
      if (pointerDownActiveRef.current) return;
      const a = document.activeElement;
      if (a && (a === body || body.contains(a))) capture();
    };
    const onWindowBlur = () => {
      // mouseup 可能丢（在窗口外松开）：失焦即复位拖选态，避免键盘采集被永久抑制
      pointerDownActiveRef.current = false;
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("keyup", onKey);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [extract.id, extract.contentMarkdown, viewOnly, editing, handlers]);

  const bodyText = String(extract.contentMarkdown || "");

  return (
    <div className="extract-face" data-extract-id={extract.id} data-view-only={viewOnly ? "1" : undefined}>
      {/* v48.41（D81）：卡面 meta 行整体移除——来源上移顶栏中间（onMaterialName 链路），
          右上「状态/优先级/下次推送」文字按用户指令删除（信息仍在卡片浏览器与批注栏）。
          D88 §6.4 卡面 ctas 化（本批白名单＝仅类名/节标签）：正文节挂 .sec.sec-quote + 节标签
          「摘录原文」（v48.51/D95 v1.3 前为「原文摘录」，用户反馈改名；预览的「我的批注」节
          在本项目无对应渲染位——批注驻留左侧批注轨，D72 契约，不发明新节）。
          D95 §B.1：三分支重组——viewOnly 与会话读态都走 ReactMarkdown（绘制层高亮），
          会话态点击路由进 ExtractEditor（WYSIWYG）；EditableText 退役（组件保留给闪卡面）。
          D95 v1.3：正文下方增「批注」块（摘录自身原始批注，空则不渲染）；引文左缘色条退役。 */}

      <div className="sec sec-quote">
        {/* D97：编辑态节标签经 header 插槽进编辑器（工具条钉顶时排到标签之前＝「固定在摘录原文的
            上面」）；读态/查看态仍由宿主直排（无双份）。 */}
        {(!editing || viewOnly || !handlers.onEdit) && <div className="sec-label">{T("摘录原文")}</div>}
        <div className="extract-face-body" ref={bodyRef} onClick={onBodyClick} onKeyDown={onBodyKeyDown} data-editing={editing ? "1" : undefined}>
          {viewOnly || !handlers.onEdit || !editing ? <ReadMarkdown text={bodyText} /> : null}
          {!viewOnly && handlers.onEdit && editing && (
            <ExtractEditor
              ref={editorApiRef}
              defaultValue={bodyText}
              pendingFocusIndex={pendingFocusRef.current}
              footer={annotBlock}
              header={<div className="sec-label">{T("摘录原文")}</div>}
              onCommit={handleEditorCommit}
            />
          )}
          {/* v1.4：批注块（摘录自身原始批注，空则不渲染）。读态直排正文之下；编辑态经 footer
              传入编辑器（内容与工具条之间），data-noedit＝点击豁免（批注不是正文，点了不进编辑）。 */}
          {(!editing || viewOnly || !handlers.onEdit) && annotBlock}
        </div>
      </div>
      {/* §E：编辑态时工具栏由 ExtractEditor 渲染在编辑器 host 之后（.extract-face-toolbar，
          data-testid="extract-editor-toolbar"）；app.extractEditorToolbar=false 整行不渲染 */}

      {/* D88 §6.4 P1 补全 b：meta 行（预览 .cardmeta 项目化）——添加时间（mono）· 来源层级 ·
          已制卡 N 张（mono 只读文字）· 右端「跳转原文」（仅锚在场；复用底栏既有跳转动作语义，
          同 title 文案；不采纳预览的「生成卡片」钮与 kbd 角标）。
          来源层级沿用 D81 前口径：depth>1 才显「第 N 层摘录」，根摘录不造假层级。
          无计数数据时不渲染空节（bordered 空节会露出一条无内容的 hairline）。 */}
      {typeof madeCardCount === "number" && (
        <div className="extract-face-derived sec cardmeta">
          {extract.createdAt ? <span className="mono">{fmtTime(extract.createdAt)}</span> : null}
          {depth > 1 ? <span>{T("第{n}层摘录", { n: depth })}</span> : null}
          <span className="mono">{madeCardCount > 0 ? T("已制卡 {n} 张", { n: madeCardCount }) : T("尚未就此制卡")}</span>
          {handlers.onJumpToSource && (
            <button
              type="button"
              className="cardmeta-jump"
              onClick={() => handlers.onJumpToSource?.()}
              title={
                extract.contextRef?.parentExtractId
                  ? T("回到父摘录卡片，并高亮这条子摘录所引的那一段（不推进调度）")
                  : T("跳回材料中的原位置（不写入阅读进度）")
              }
            >
              {T("跳转原文")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 底部动作栏（EXCERPT-REVIEW-LAYOUT-REDESIGN v2 §8.2）：自 `ExtractCardFace` **原样平移**为命名导出。
 * 摘录页与复习页「合并复习」分支各自把它渲染成页面滚动根的**末子节点**（几何＝共用 `.stage-bar`：
 * 流内 + sticky bottom:0 零偏移）⇒ 两页底栏几何构造性相等。
 * 类名与 data 钩子（`.extract-face-actions` / `data-extract-bar`）全部保留，测试按按钮文本点击不受影响。
 * 只在会话态渲染；查看态由宿主给一条只读提示（不出现任何调度动作）。
 */
export function ExtractActionsBar({
  extract,
  busy,
  handlers
}: {
  extract: DueTopic;
  /** 与卡面同源的引擎标记（props 形状与 ExtractCardFace 一致；本栏当前不消费） */
  engine?: ExtractEngine;
  busy?: boolean;
  handlers: ExtractFaceHandlers;
}) {
  const T = useT();
  const [postponeDays, setPostponeDays] = useState(7);
  /**
   * 优先级滑块去闪（v48.32/D72 去抖 + v48.33/D73 草稿保留）：滑块是受控值，而 onPriority 每次都走
   * 完整 run()（IPC 写 + persist + cardsApi.listAll 全量刷新）——拖动中每个刻度一次往返，值被旧 prop
   * 反复回拉 ⇒ 整页闪烁。修法＝本地草稿值即时上屏（拇指/填充/数字输入零延迟），停手 350ms 后才提交一次；
   * **提交后不清草稿**——等写库+刷新回流、`extract.priority` 追上草稿时才回落（v5 先清后提交会让滑块
   * 在回流前跳回旧位再跳新位＝用户实测残留闪烁）；换卡时草稿复位，卸载时清计时器。
   */
  const [prioDraft, setPrioDraft] = useState<number | null>(null);
  const prioTimerRef = useRef<number | null>(null);
  const clampPriority = (v: number) => Math.max(0, Math.min(100, Number.isFinite(v) ? Math.round(v) : 0));
  useEffect(() => {
    if (prioDraft !== null && clampPriority(Number(extract.priority)) === prioDraft) setPrioDraft(null);
  }, [extract.priority, prioDraft]);
  useEffect(() => {
    setPrioDraft(null);
  }, [extract.id]);
  useEffect(
    () => () => {
      if (prioTimerRef.current !== null) window.clearTimeout(prioTimerRef.current);
    },
    []
  );
  const shownPriority = prioDraft ?? clampPriority(Number(extract.priority) || 0);
  const queuePriority = (v: number) => {
    const c = clampPriority(v);
    setPrioDraft(c);
    if (prioTimerRef.current !== null) window.clearTimeout(prioTimerRef.current);
    prioTimerRef.current = window.setTimeout(() => {
      prioTimerRef.current = null;
      handlers.onPriority?.(c);
    }, 350);
  };
  /** 底栏「更多」弹层（同刻只开这一个；点外部/Esc 由下方 effect 收） */
  const [moreOpen, setMoreOpen] = useState(false);
  const moreWrapRef = useRef<HTMLSpanElement | null>(null);
  /** D88 §4.2/§4.3：主 CTA「下一条」＝填充钮白名单成员——涟漪挂载 + 点击 settle（真实事件驱动） */
  const advanceRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const el = advanceRef.current;
    if (!el) return;
    return attachRipple(el);
  }, []);
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && moreWrapRef.current?.contains(t)) return;
      setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  return (
    /* 底部动作区（与复习页同规格）：主行动常驻 + 推迟 / 优先级 / 毕业；其余进右下角「更多」（向上弹）。
       「摘录」（就地另立子摘录）已删：无选区时它兜底摘整条正文 ⇒ 看起来像复制卡片（用户实测）；
       选中一段再摘录仍可走拖选菜单（同一条 annotateParent 路径）。
       「快捷推迟」1/3/7/30 已删；推迟天数改由输入框给。 */
    <div className="stage-bar extract-face-actions" data-extract-bar>
      {/* D89：内容列与卡面/头带内列同盒（≤720 居中，仅摘录页作用域约束，见 theme.css .stage-bar-inner） */}
      <div className="stage-bar-inner">
      {handlers.onAdvance && (
        <button
          ref={advanceRef}
          className="bar-btn primary grow"
          disabled={busy}
          onClick={(e) => {
            // D88 §4.2：settle 回弹＝真实点击主 CTA 的按压反馈（Exaggeration；animationend 自摘）
            settle(e.currentTarget);
            handlers.onAdvance?.();
          }}
          title={T("处理完这条，按 A-Factor 推进调度（快捷键：空格）")}
        >
          {T("下一条")}
        </button>
      )}

      {handlers.onPostpone && (
        /* 功能簇（v48.36/D76，L1「一盒一功能」）：一盒一功能，盒内裸排（数字/单位/文字钮），不再套小框 */
        <span className="bar-cluster">
          <input
            className="bare-num"
            type="number"
            min={1}
            max={36500}
            value={postponeDays}
            onChange={(e) => setPostponeDays(Math.max(1, Math.min(36500, Number(e.target.value) || 1)))}
            aria-label={T("推迟天数")}
          />
          <span className="unit">{T("天")}</span>
          <button className="text-btn" disabled={busy} onClick={() => handlers.onPostpone?.(postponeDays)}>
            {T("推迟")}
          </button>
        </span>
      )}

      {handlers.onPriority && (
        /* 优先级簇（v48.36/D76，L1）：一盒一功能——标签/滑轨/数字盒内裸排，滑轨维持 140×20（D75 裁定）。
            值走本地草稿（shownPriority），停手 350ms 才提交（D72 去闪）。 */
        <label className="bar-cluster" title={T("优先级：拖动滑块或直接输入数字（数字越大越靠后）")}>
          <span className="unit">{T("优先级")}</span>
          <span className="prio-track">
            <span className="prio-fill" style={{ width: `${shownPriority}%` }} />
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={shownPriority}
              aria-label={T("优先级")}
              onChange={(e) => queuePriority(Number(e.target.value))}
            />
          </span>
          <input
            className="bare-num prio-num"
            type="number"
            min={0}
            max={100}
            step={1}
            value={shownPriority}
            aria-label={T("优先级数值")}
            onChange={(e) => queuePriority(Number(e.target.value))}
          />
        </label>
      )}

      {handlers.onGraduate && (
        <button className="bar-btn" disabled={busy} onClick={() => handlers.onGraduate?.()} title={T("处理后认为再无值得制卡的内容：不再推送，仍保留在卡片浏览器")}>
          {T("毕业")}
        </button>
      )}

      {(handlers.onJumpToSource || handlers.onUndo) && (
        <span className="bar-more" data-menu ref={moreWrapRef}>
          <button
            className="bar-btn"
            data-toggle
            aria-expanded={moreOpen}
            aria-controls="extract-bar-more"
            onClick={() => setMoreOpen((v) => !v)}
          >
            {T("更多")}<span className="caret">▲</span>
          </button>
          {moreOpen && (
            <div className="bar-pop" id="extract-bar-more" data-pop>
              {handlers.onJumpToSource && (
                <button
                  disabled={busy}
                  onClick={() => {
                    setMoreOpen(false);
                    handlers.onJumpToSource?.();
                  }}
                  title={
                    extract.contextRef?.parentExtractId
                      ? T("回到父摘录卡片，并高亮这条子摘录所引的那一段（不推进调度）")
                      : T("跳回材料中的原位置（不写入阅读进度）")
                  }
                >
                  {T("跳转原文")}
                </button>
              )}
              {handlers.onUndo && (
                <button
                  disabled={busy}
                  onClick={() => {
                    setMoreOpen(false);
                    handlers.onUndo?.();
                  }}
                  title={T("撤销最近一次操作（Z）")}
                >
                  {T("撤销")}<span className="k mono">Z</span>
                </button>
              )}
            </div>
          )}
        </span>
      )}
      </div>
    </div>
  );
}
