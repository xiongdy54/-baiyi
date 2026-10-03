import { useEffect, useRef, useState, type ReactNode } from "react";
import Dropdown from "./Dropdown";
import EditableText from "./EditableText";
import { extractStatusLabel, type ExtractEngine } from "../lib/sessionQueue";
import type { DueTopic } from "../lib/readingWorkflow";
import { paintBodyAnnotations, type BodyAnnotationGroup } from "../lib/reader/bodyAnnotations";

const DAY = 86400000;
/* 优先级＝滑块 0–100（右侧数字可直接输入）：旧的离散档位下拉与快捷推迟 1/3/7/30 均已退役
   （用户 2026-10-01：快捷推迟不需要了；优先级要做成滑块 + 可输入数字）。 */

/** 距下次推送的文案（与队列口径一致：到期显示「现已到期」） */
export function nextAtText(nextAt?: number, now = Date.now()): string {
  const t = Number(nextAt);
  if (!Number.isFinite(t)) return "";
  const delta = t - now;
  if (delta <= 0) return "现已到期";
  const days = delta / DAY;
  if (days < 1) return "今日稍后推送";
  return `${Math.round(days)} 天后推送`;
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

/**
 * DOM 文本坐标（规格 §1.2 / 工单 ②）：自 root 起按文档序累加文本节点长度，`<br>` 计 1 个换行。
 * `EditableText` 的落库口径是 `innerText`，而 Chromium 的 innerText setter 把 `\n` 落成 `<br>`
 * （实测：`"a\n\nb"` → `a<br><br>b`，见 tests/breadcrumb.gui.mjs 的多段正文用例）——
 * 因此「文本节点长度 + br 计 1」与 `content_markdown` 逐字符同构，选区偏移可直接当范围锚用。
 */
function domTextOffset(root: Node, container: Node, offset: number): number | null {
  let acc = 0;
  let hit: number | null = null;
  const visit = (node: Node): void => {
    if (hit !== null) return;
    if (node === container) {
      if (node.nodeType === 3 /* TEXT_NODE */) {
        hit = acc + offset;
        return;
      }
      // 元素容器：点＝「第 offset 个子节点之前」，先把之前的兄弟累加完再落点
      const kids = node.childNodes;
      for (let i = 0; i < offset && i < kids.length; i++) visit(kids[i]);
      if (hit === null) hit = acc;
      return;
    }
    if (node.nodeType === 3) {
      acc += (node.textContent || "").length;
      return;
    }
    if (node.nodeType === 1 && (node as Element).tagName === "BR") {
      acc += 1;
      return;
    }
    if (node.nodeType === 1) {
      const kids = node.childNodes;
      for (let i = 0; i < kids.length; i++) visit(kids[i]);
    }
  };
  visit(root);
  return hit;
}

/**
 * 当前选区在**该卡正文**里的字符偏移（纯函数式，不写 DOM、不落库；工单 ②「采集父侧偏移」）。
 * 多段不相邻选择＝多组偏移（`selection.rangeCount > 1` 时逐段取；与阅读器侧 spans 集合同构），
 * 选区落在正文之外（如卡面元信息行）或塌缩时返回空数组——调用方据此回退「整条正文」。
 */
export function selectionOffsetsInBody(root: HTMLElement): Array<{ start: number; end: number }> {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (!sel || !sel.rangeCount) return [];
  const out: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < sel.rangeCount; i++) {
    const r = sel.getRangeAt(i);
    if (!root.contains(r.commonAncestorContainer)) continue;
    const s = domTextOffset(root, r.startContainer, r.startOffset);
    const e = domTextOffset(root, r.endContainer, r.endOffset);
    if (s === null || e === null || e <= s) continue;
    out.push({ start: s, end: e });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * 「摘录」动作的载荷（工单 ②）：文本＝卡面里选中的那段（无选区＝整条正文），
 * ranges＝选区在**本卡 content_markdown** 里的字符偏移（父卡坐标，逐段对应；多段选择即多组）。
 * 文本取 `slice` 而非 `selection.toString()`：落库文本与范围锚逐字符对齐（父卡跳回来高亮的就是它）。
 */
export interface ExtractPickPayload {
  text: string;
  ranges: Array<{ start: number; end: number }>;
}

/**
 * 把正文按高亮区间切成交错节点（只读渲染用，规格 §1.2 R13 落点）。
 * 区间超出正文长度一律裁剪；重叠区间按游标裁剪，保证不重复输出同一段文字。
 */
function textWithRanges(text: string, ranges: Array<{ start: number; end: number }> | null | undefined, hlRef: (el: HTMLElement | null) => void) {
  const body = String(text || "");
  const list = (ranges || []).filter((r) => r.start < body.length && r.end > r.start);
  if (!list.length) return body;
  const out: ReactNode[] = [];
  let cursor = 0;
  let first = true;
  list.forEach((r, i) => {
    const s = Math.max(cursor, r.start);
    const e = Math.min(body.length, r.end);
    if (s > cursor) out.push(body.slice(cursor, s));
    if (e > s) {
      out.push(
        <mark key={`hl-${i}`} className="extract-quote-hl" ref={first ? hlRef : undefined}>
          {body.slice(s, e)}
        </mark>
      );
      first = false;
    }
    cursor = Math.max(cursor, e);
  });
  if (cursor < body.length) out.push(body.slice(cursor));
  return out;
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
}

/**
 * 摘录卡面（v48.22 / D58 §6.8）：沉浸式连续处理页与复习页**共用同一组件**。
 * 正文与闪卡一样可就地编辑（EditableText）；动作集＝下一条 / 推迟 / 优先级 / 毕业 / 跳转原文 / 摘录。
 * **批 4 Task 18（R29）**：`extractReader` 专用页已退役——「打开摘录」动作随之删除。
 * `viewOnly` ＝面包屑查看态（只读渲染 + 高亮该层范围，不出现任何调度动作）。
 */
export default function ExtractCardFace({
  extract,
  madeCardCount,
  engine,
  busy,
  viewOnly,
  quoteRanges,
  bodyAnnotations,
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
  handlers: ExtractFaceHandlers;
}) {
  const depth = Number(extract.depth) || 1;
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const hlRef = useRef<HTMLElement | null>(null);

  // 换卡即清快照（偏移是相对**这一版正文**的，跨卡复用会把范围锚写歪）
  useEffect(() => {
    handlers.onSelection?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extract.id]);

  useEffect(() => {
    if (viewOnly) return;
    const body = bodyRef.current;
    if (!body) return;
    const face = body.closest(".extract-face");
    // v48.38 / D78：capture 携带指针修饰位——集合运算（替换/加选/移出）由宿主按 app.multiSelectKey 判定
    const capture = (modifier?: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean }) => {
      const full = String(extract.contentMarkdown || "");
      const ok = selectionOffsetsInBody(body).filter((r) => r.start < full.length && r.end <= full.length);
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
      const t = e.target as Node | null;
      if (t && body.contains(t)) {
        const me = e as MouseEvent;
        capture({ ctrlKey: me.ctrlKey, altKey: me.altKey, shiftKey: me.shiftKey, metaKey: me.metaKey });
        return;
      }
      // 卡外落下＝选区作废（卡片外的动作面除外：菜单/面板自身的 mouseup 不算）。
      // 批 4 Task 10：选区菜单与三个面板渲染在**卡面之外**（页级），点它们同样是「动作面」而非
      // 「点别处」——不豁免的话，mouseup 会先清掉快照/选区，按钮的 onClick 再读就晚了（实测三动作全哑）。
      const el = t as HTMLElement | null;
      const inActionSurface =
        !!el && typeof el.closest === "function" &&
        !!(el.closest(".selection-menu") || el.closest(".modal-panel") || el.closest(".dict-panel") || el.closest(".ai-panel"));
      if (inActionSurface) return;
      if (!(t && face && face.contains(t))) {
        handlers.onSelection?.(null);
      }
    };
    const onKey = () => {
      const a = document.activeElement;
      if (a && (a === body || body.contains(a))) capture();
    };
    document.addEventListener("mouseup", onUp);
    document.addEventListener("keyup", onKey);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("keyup", onKey);
    };
  }, [extract.id, extract.contentMarkdown, viewOnly, handlers]);

  /**
   * 卡面正文里的批注痕迹（批 4 修正，样张 `.q` 同规）：按**该条批注色**画在绘制层
   * （CSS Custom Highlight API）——栏内条目与文中那段据此对上（R33）。
   * 只画**段锚**批注；整卡批注是元批注，文中不画（§5.4）。重画幂等（内部先撤后建）。
   */
  useEffect(() => {
    if (viewOnly) return;
    paintBodyAnnotations(bodyRef.current, bodyAnnotations ?? []);
    return () => paintBodyAnnotations(null, []);
  }, [viewOnly, extract.id, extract.contentMarkdown, bodyAnnotations]);

  // 落点（尽力而为）：高亮段落在卡面上可见即滚到可视区中部（容器不可滚时是一次 no-op）
  useEffect(() => {
    if (!viewOnly) return;
    hlRef.current?.scrollIntoView({ block: "center" });
  }, [viewOnly, extract.id]);

  /**
   * 「摘录」取的载荷：**实时选区优先、快照兜底**（含父卡坐标的范围），两者皆无＝整条正文。
   * 选区在正文之外（元信息行等）时同样回退整条——不用外部选区当锚，避免把范围锚写歪。
   */

  return (
    <div className="extract-face" data-extract-id={extract.id} data-view-only={viewOnly ? "1" : undefined}>
      <div className="extract-face-meta">
        <span className="extract-face-source">
          来自《{extract.docTitle || "未知材料"}》
          {depth > 1 ? ` · 第${depth}层摘录` : ""}
        </span>
        <span className="extract-face-tags">
          <span className="mono">{extractStatusLabel(extract.status)}</span>
          <span className="mono">优先级 {extract.priority}</span>
          <span className="mono">{nextAtText(extract.topicNextAt)}</span>
          {engine === "ai-next-extract" ? <span className="badge-experimental">实验引擎</span> : null}
        </span>
      </div>

      <div className="extract-face-body" ref={bodyRef}>
        {viewOnly ? (
          <div className="extract-face-text">
            {textWithRanges(extract.contentMarkdown || "", quoteRanges, (el) => {
              hlRef.current = el;
            })}
          </div>
        ) : handlers.onEdit ? (
          <EditableText value={extract.contentMarkdown || ""} onCommit={(t) => handlers.onEdit?.(t)} />
        ) : (
          <div className="extract-face-text">{extract.contentMarkdown}</div>
        )}
      </div>

      <div className="extract-face-derived mono">
        {typeof madeCardCount === "number"
          ? madeCardCount > 0
            ? `已就此摘录制卡 ${madeCardCount} 张`
            : "尚未就此制卡"
          : ""}
      </div>
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
      {handlers.onAdvance && (
        <button className="bar-btn primary grow" disabled={busy} onClick={() => handlers.onAdvance?.()} title="处理完这条，按 A-Factor 推进调度（快捷键：空格）">
          下一条
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
            aria-label="推迟天数"
          />
          <span className="unit">天</span>
          <button className="text-btn" disabled={busy} onClick={() => handlers.onPostpone?.(postponeDays)}>
            推迟
          </button>
        </span>
      )}

      {handlers.onPriority && (
        /* 优先级簇（v48.36/D76，L1）：一盒一功能——标签/滑轨/数字盒内裸排，滑轨维持 140×20（D75 裁定）。
            值走本地草稿（shownPriority），停手 350ms 才提交（D72 去闪）。 */
        <label className="bar-cluster" title="优先级：拖动滑块或直接输入数字（数字越大越靠后）">
          <span className="unit">优先级</span>
          <span className="prio-track">
            <span className="prio-fill" style={{ width: `${shownPriority}%` }} />
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={shownPriority}
              aria-label="优先级"
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
            aria-label="优先级数值"
            onChange={(e) => queuePriority(Number(e.target.value))}
          />
        </label>
      )}

      {handlers.onGraduate && (
        <button className="bar-btn" disabled={busy} onClick={() => handlers.onGraduate?.()} title="处理后认为再无值得制卡的内容：不再推送，仍保留在卡片浏览器">
          毕业
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
            更多<span className="caret">▲</span>
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
                      ? "回到父摘录卡片，并高亮这条子摘录所引的那一段（不推进调度）"
                      : "跳回材料中的原位置（不写入阅读进度）"
                  }
                >
                  跳转原文
                </button>
              )}
              {handlers.onUndo && (
                <button
                  disabled={busy}
                  onClick={() => {
                    setMoreOpen(false);
                    handlers.onUndo?.();
                  }}
                  title="撤销最近一次操作（Z）"
                >
                  撤销<span className="k mono">Z</span>
                </button>
              )}
            </div>
          )}
        </span>
      )}
    </div>
  );
}
