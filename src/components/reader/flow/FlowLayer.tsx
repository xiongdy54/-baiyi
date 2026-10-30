// 结构流 · 渲染器（STRUCTURE-FLOW-PLAN §7 / §8 / §12.2 / §12.3 / §12.4.5；§16 一代一层）。
// 三层：① 混合层 SVG（高亮流带，mix-blend-mode 叠在正文上）② 上层 SVG（脊线 / 轴 / 节点条 / 关系线）
// ③ HTML（标签 / 动作行 / 讲解 / 空态）。所有几何都由布局产出，本文件只负责画。
// §16.1：以「代（generation）」为单位进出场——一次换代＝旧代整体淡出 + 新代整体淡入，一个时钟。
import { createElement, memo, useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ReactElement, ReactNode, SVGProps } from "react";
import type { FlowItem, FlowPrim, FlowScene, FlowShape, FlowStrand } from "../../../lib/flow/types";
import {
  FLOW,
  collapseAtEdge,
  collapseAtLeft,
  collapseAtNode,
  explainBoxH,
  parseRgb,
  shapeGradientStops,
  shapePath,
  strandPath,
} from "../../../lib/flow/layout";
import { useGenFade, usePresence, type Phase } from "../../../lib/flow/presence";
import { motionPreference } from "../../../lib/mindmap/v2/animate";
import { REL_STYLE } from "../../../lib/mindmap/v2/route";
import { useT } from "../../../lib/i18n";

export type FlowEvent =
  | { kind: "hover"; nodeId: string | null }
  | { kind: "click"; nodeId: string; peek?: boolean }
  | { kind: "dblclick"; nodeId: string }
  | { kind: "more"; nodeId: string | null; moreKind?: "above" | "below" | "kids" }
  | { kind: "action"; name: "back" | "jump" | "explain" | "closeExplain" | "deepen" | "generate" | "openInMap" | "cmpPrev" | "cmpNext" };

export interface FlowLayerProps {
  scene: FlowScene;
  onEvent: (ev: FlowEvent) => void;
  /** §13.3.4 / §16.1.2：滚动模式下宿主按「代」注册颈部 path 元素，逐帧直接写 d（不走 React） */
  registerShape?: (genKey: string, id: string, el: SVGPathElement | null) => void;
}

/** §16.1.3：代级参数（退场 120 / 入场 200 延迟 100 / 救回 160 / 卸载 140；与 useGenFade 内的时长同源） */
export const GEN = { OUT_MS: 120, IN_MS: 200, IN_DELAY: 100, REVIVE_MS: 160, REMOVE_MS: 140 } as const;

/** §16.4：零件级退场时长（≥ --flow-t-out 120 + 一帧余量） */
const EXIT_MS = 160;

const stagger = (i: number, step: number, cap: number) => Math.min(i * step, cap);
const vars = (delay: number) => ({ "--flow-delay": `${Math.round(delay)}ms` }) as CSSProperties;
/** §16.1.5：所有 defs id 都带代前缀——两代同时在文档里时不能互相解析到对方的渐变 / marker */
const genNs = (genKey: string) => genKey.replace(/[^a-zA-Z0-9_-]/g, "_");
const rawId = (raw: string | number) => String(raw).replace(/[^a-zA-Z0-9_-]/g, "_");

/** 结构流的两层画布根（业务代码的内联 SVG 棘轮只许变少：这里用 createElement 建根，避免新增字面量） */
const SvgRoot = (props: SVGProps<SVGSVGElement> & { children?: ReactNode } & Record<string, unknown>): ReactElement => createElement("svg", props);

/** 颜色 → 渐变下标（整场稳定：按 palette 顺序先占位） */
function colorIndexer(colors: FlowScene["colors"]) {
  const list = [...colors.palette, colors.accent, colors.counter, colors.fg];
  const map = new Map<string, number>();
  list.forEach((c, i) => {
    if (!map.has(c)) map.set(c, i);
  });
  return (color: string) => {
    let i = map.get(color);
    if (i == null) {
      i = map.size;
      map.set(color, i);
    }
    return i;
  };
}

/** §16.2（R2'）：退场图元只改透明度，不收几何——收几何 + 淡出在 120ms 里看不出收缩，只会和彩带错位 */
function exitPrim(p: FlowPrim): FlowPrim {
  return { ...p, opacity: 0 };
}

export default function FlowLayer({ scene, onEvent, registerShape }: FlowLayerProps) {
  const T = useT();
  const { colors, plan, layout, inline } = scene;
  const motionOff = motionPreference() === "off";

  // §16.1.3：代列表。同一时刻最多两代：一个 live + 一个 exit（第三代到来时最老的 exit 立即卸载）
  const genItems = useMemo(() => [{ id: scene.genKey, scene }], [scene]);
  const gensAll = usePresence(genItems, GEN.REMOVE_MS);
  // 减弱动效时 exit 代直接不画（否则会实心停 140ms）
  const exits = motionOff ? [] : gensAll.filter((g) => g.phase === "exit").slice(-1);
  const gens = [...exits, ...gensAll.filter((g) => g.phase !== "exit")]; // exit 在下，live 在上
  const fadeIn = gens.length > 1; // 只有「换代」才淡入；首次打开走原来的 open 编排

  // §14.2-2：动作行只锚主体行——预览行不是可操作目标（否则会浮在预览行上盖住主体）
  const selected = layout.items.find((i) => i.nodeId === inline.forId && !i.peek && (i.kind === "node" || i.kind === "kid"));
  const inlineAt = layout.inlineAt ?? (selected ? { x: selected.x, y: selected.y + selected.h, w: selected.w } : null);
  const explainH = inline.explainOpen ? explainBoxH(inline.explainText, plan.labelW, inline.explainBusy) : 0;

  return (
    <>
      {/* ① 混合层：只放高亮流带（与正文混合；自身及祖先不得有 transform / opacity / filter；
         根内部的 <g> 上做 opacity 动画不影响混合，§16.1.3） */}
      <SvgRoot
        className="flow-blend"
        data-dark={colors.dark ? "1" : undefined}
        data-tracking={scene.tracking ? "1" : undefined}
        data-smooth={scene.smooth ? "1" : undefined}
        data-motion={motionOff ? "off" : undefined}
        data-flow-motion={scene.motion}
        style={{
          position: "fixed", inset: 0, width: "100vw", height: "100vh", pointerEvents: "none", zIndex: 23,
          mixBlendMode: colors.dark ? "screen" : "multiply", overflow: "visible",
          // §8.8：正文滑行时先隐去高亮，落定后从节点伸回
          opacity: scene.shifting ? 0 : 1,
          transition: motionOff ? "none" : "opacity 120ms var(--flow-ease)",
        }}
      >
        {gens.map(({ item, phase }) => (
          <BlendGen key={item.id} scene={item.scene} phase={phase} fadeIn={fadeIn} registerShape={registerShape} />
        ))}
      </SvgRoot>

      {/* ② + ③ 上层：普通合成 */}
      <div className="flow-layer" data-motion={motionOff ? "off" : undefined} data-mode={scene.mode}>
        {gens.map(({ item, phase }) => (
          <UpperGen key={item.id} base={item.scene} phase={phase} fadeIn={fadeIn} onEvent={onEvent} />
        ))}

        {/* 动作行 / 讲解 / 状态：只按 live 代的 scene 渲染 */}
        {inlineAt && inline.forId && scene.mode !== "whisper" ? (
          <div className="flow-inline" style={{ transform: `translate(${inlineAt.x}px, ${inlineAt.y + scene.dy}px)`, width: inlineAt.w }}>
            <div className="flow-actions">
              <button type="button" onClick={() => onEvent({ kind: "action", name: "jump" })}>{T("跳到原文")}</button>
              <span aria-hidden="true">·</span>
              <button type="button" onClick={() => onEvent({ kind: "action", name: inline.explainOpen ? "closeExplain" : "explain" })}>{inline.explainOpen ? T("收起讲解") : T("讲解")}</button>
              <span aria-hidden="true">·</span>
              <button type="button" onClick={() => onEvent({ kind: "action", name: "deepen" })}>{T("深挖")}</button>
              <span aria-hidden="true">·</span>
              <button type="button" onClick={() => onEvent({ kind: "action", name: "openInMap" })}>{T("在完整图谱中打开")}</button>
            </div>
            {inline.explainOpen ? (
              // D255：高度由宿主预留口径 explainBoxH 决定（min=max）——文字再多也在框内滚动，不会长出预留区压住下一条
              <div className="flow-explain" style={{ maxHeight: explainH, minHeight: explainH }}>
                {inline.explainBusy && !inline.explainText ? <span className="flow-dots" aria-label={T("正在生成…")}><i /><i /><i /></span> : null}
                {inline.explainText ? <span>{inline.explainText}</span> : inline.explainBusy ? null : <span className="flow-explain-empty">{T("还没有讲解")}</span>}
              </div>
            ) : null}
            {inline.status ? <div className="flow-status">{inline.status}</div> : null}
          </div>
        ) : inline.status && scene.mode !== "whisper" ? (
          <div className="flow-status flow-status-float" style={{ transform: `translate(${plan.labelX}px, ${scene.viewport.bottom - 24}px)` }}>{inline.status}</div>
        ) : null}

        {/* 空态 */}
        {scene.panel.kind !== "ok" && scene.mode !== "whisper" ? (
          <div className="flow-empty" style={{ transform: `translate(${plan.labelX}px, ${Math.round((scene.viewport.top + scene.viewport.bottom) / 2 - 14)}px)`, width: Math.max(120, plan.labelW) }}>
            {scene.panel.kind === "feeding" ? (
              <>
                <div>{T("原文读取中 {i}/{n}", { i: scene.panel.feedDone, n: scene.panel.feedTotal })}</div>
                <div className="flow-progress"><i style={{ width: `${scene.panel.feedTotal ? (scene.panel.feedDone / scene.panel.feedTotal) * plan.labelW : 0}px` }} /></div>
              </>
            ) : scene.panel.kind === "empty" ? (
              <>
                <div>{T("本节还没有结构")}</div>
                <button type="button" className="flow-empty-action" onClick={() => onEvent({ kind: "action", name: "generate" })}>{T("为本节生成 →")}</button>
              </>
            ) : scene.panel.kind === "nokey" ? (
              <div>{T("需要先在设置里配置 AI")}</div>
            ) : (
              <>
                <div>{T("正在生成…")}</div>
                <div className="flow-progress flow-progress-busy"><i /></div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- 混合层 · 一代

interface BlendGenProps {
  scene: FlowScene;
  phase: Phase;
  fadeIn: boolean;
  registerShape?: FlowLayerProps["registerShape"];
}

function BlendGen({ scene, phase, fadeIn, registerShape }: BlendGenProps) {
  const ref = useRef<SVGGElement>(null);
  const motionOff = motionPreference() === "off";
  useGenFade(ref, phase, fadeIn, motionOff);
  const { colors, plan, layout, shapes, hoverId, armed, motion } = scene;
  const ns = genNs(scene.genKey);
  const gid = (kind: string, raw: string | number) => `${kind}-${ns}-${rawId(raw)}`;
  /** §13.4.3：颜色兜底——解析不了就退色调色板第一色，绝不把 color-mix() 写进 SVG */
  const safe = (c: string) => (parseRgb(c) ? c : colors.palette[0]);

  const shapesP = usePresence(shapes, EXIT_MS);
  const refFor = useMemo(() => {
    const cache = new Map<string, (el: SVGPathElement | null) => void>();
    return (id: string) => {
      let fn = cache.get(id);
      if (!fn) {
        fn = (el: SVGPathElement | null) => registerShape?.(scene.genKey, id, el);
        cache.set(id, fn);
      }
      return fn;
    };
  }, [registerShape, scene.genKey]);

  // §16.3：stagger / 位移只在 open / close / turn 下生效
  const choreo = motion === "open" || motion === "close" || motion === "turn";

  // 打开 / 翻页：首帧折叠、下一帧靠 CSS d 过渡展开；armed=false 时画折叠态
  /** §8.7：子项入场时，流带的终点先落在父条的区间里（再由 CSS d 过渡长到自己的 port） */
  const splitFromParent = (s: FlowShape): FlowShape | null => {
    if (s.stub) return null;
    const parent = layout.parentOf?.[s.nodeId];
    if (!parent) return null;
    const pi = layout.items.find((i) => i.nodeId === parent && (i.kind === "node" || i.kind === "kid"));
    if (!pi) return null;
    const x = plan.barX + (pi.lane ?? 0) * FLOW.LANE_DX + 3;
    // 条在 .flow-items 的局部坐标里，几何是 client 坐标 → 加上列的 dy
    return { ...s, x1: x, t0: pi.y + scene.dy + 1, t1: pi.y + scene.dy + pi.h - 1 };
  };

  const shapeGeom = (s: FlowShape, ph: Phase): FlowShape => {
    if (ph === "exit") return collapseAtNode(s);
    if (!armed && (motion === "open" || motion === "turn")) return motion === "open" ? collapseAtLeft(s) : collapseAtNode(s);
    if (motion === "close") return collapseAtLeft(s);
    return s;
  };

  const shapeDelay = (i: number) =>
    motion === "open" ? stagger(i, 30, 240) : motion === "close" ? 100 + stagger(i, 14, 110) : motion === "turn" ? 220 + stagger(i, 18, 120) : 0;

  return (
    <g ref={ref} className="flow-gen" data-gen={scene.genKey} data-phase={phase}>
      <defs>
        {/* §15.1：矩形段与颈部共用一条路径，渐变四停点：左端透明 → 接缝前 HL_FADE_W 内起坡 → 接缝 aHL → 节点端 aEnd */}
        {shapesP.filter(({ item: s }) => !s.stub).map(({ item: s }) => {
          const g = shapeGradientStops(s, colors, s.tone);
          return (
            <linearGradient key={gid("fg", s.id)} id={gid("fg", s.id)} gradientUnits="userSpaceOnUse" x1={g.x1} y1="0" x2={g.x2} y2="0">
              {g.stops.map((st, k) => (
                <stop key={k} offset={st.offset} stopColor={safe(s.color)} stopOpacity={st.opacity} />
              ))}
            </linearGradient>
          );
        })}
        {shapesP.filter(({ item }) => item.stub).map(({ item }) => (
          <linearGradient key={gid("fst", item.id)} id={gid("fst", item.id)} gradientUnits="userSpaceOnUse" x1={item.L} y1="0" x2={item.x1} y2="0">
            <stop offset="0" stopColor={safe(item.color)} stopOpacity={0} />
            <stop offset="1" stopColor={safe(item.color)} stopOpacity={0.16} />
          </linearGradient>
        ))}
      </defs>
      <g className="flow-shapes">
        {shapesP.map(({ item: s, phase: ph }, i) => {
          const from = ph === "enter" && choreo ? splitFromParent(s) : null;
          const g = from
            ? from
            : scene.smooth
              ? // §16.2：滚动模式下退场不再 collapseAtEdge——几何保持原样，只淡出
                (!armed && motion === "open") || motion === "close"
                ? collapseAtEdge(s)
                : s
              : shapeGeom(s, ph);
          const d = shapePath(g);
          const dim = !!hoverId && s.nodeId !== hoverId && s.tone === 0;
          return (
            <path
              key={s.id}
              ref={refFor(s.id)}
              className={`flow-shape${dim ? " is-dim" : ""}`}
              d={d}
              fill={s.stub ? `url(#${gid("fst", s.id)})` : `url(#${gid("fg", s.id)})`}
              style={{ d: `path("${d}")`, opacity: ph === "exit" || ph === "enter" ? 0 : 1, ...vars(shapeDelay(i)) }}
              data-node-id={s.nodeId}
              data-tone={s.tone}
            />
          );
        })}
      </g>
    </g>
  );
}

// ---------------------------------------------------------------- 上层 · 一代

interface UpperGenProps {
  base: FlowScene;
  phase: Phase;
  fadeIn: boolean;
  onEvent: (ev: FlowEvent) => void;
}

function UpperGenImpl({ base, phase, fadeIn, onEvent }: UpperGenProps) {
  const T = useT();
  const ref = useRef<HTMLDivElement>(null);
  const motionOff = motionPreference() === "off";
  useGenFade(ref, phase, fadeIn, motionOff);
  const { colors, layout, strands, dy, hoverId, motion, armed, mode } = base;
  const ns = genNs(base.genKey);
  const gid = (kind: string, raw: string | number) => `${kind}-${ns}-${rawId(raw)}`;
  const ci = useMemo(() => colorIndexer(colors), [colors]);

  // 图元 / 关系线 / 标签的进出场保留（§5.8）；§16.4：零件级退场 160ms（≥ --flow-t-out 120 + 一帧余量）
  const prims = usePresence(mode === "whisper" ? layout.prims.filter((p) => /^(peek:)?bar:/.test(p.id)) : layout.prims, EXIT_MS);
  const strandsP = usePresence(strands, EXIT_MS);
  const itemsP = usePresence(layout.items, EXIT_MS);

  // §16.3：代内零件一律无延迟、无位移、只淡入淡出；stagger 只在 open / close 下生效
  const delayFor = (i: number, ph: Phase) => {
    if (motion === "open") return ph === "exit" ? 0 : 360 + stagger(i, 22, 200);
    if (motion === "close") return stagger(i, 12, 96);
    return 0;
  };
  const strandDelay = (i: number) => (motion === "open" ? 760 + stagger(i, 40, 240) : 0);
  const primDelay = () => (motion === "open" ? 480 : motion === "close" ? 60 : 0);

  // draw 线：进场用 WAAPI 从 dashoffset 1 → 0（CSS 过渡对首帧挂载不生效）；§16.3：只在打开编排时执行
  useEffect(() => {
    if (motion !== "open" || !armed) return;
    const host = ref.current;
    if (!host || typeof (host.querySelector as Function) !== "function") return;
    const els = Array.from(host.querySelectorAll("[data-draw='1']")) as (SVGElement & { animate?: (k: Keyframe[], o: KeyframeAnimationOptions) => unknown })[];
    for (const el of els) {
      if (typeof el.animate !== "function") continue;
      const delay = Number(el.getAttribute("data-delay") || 0);
      try {
        el.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 480, delay, easing: "cubic-bezier(.16,1,.3,1)", fill: "both" });
      } catch {
        /* 动画能力缺失时直接显示 */
      }
    }
  }, [base.seq, armed, motion]);

  const strandColor = (s: FlowStrand) => (s.strong ? colors.accent : `url(#${gid("gs", s.order)})`);
  const strandEndColor = (s: FlowStrand) => (s.strong ? colors.accent : s.colorB);

  function renderPrim(p: FlowPrim, q: FlowPrim, delay: number, cix: (c: string) => number, ph: Phase = "live") {
    const off = q.off ?? 0;
    const ent = ph === "enter";
    const wrap = (node: ReactElement) => (
      <g key={p.id} transform={off ? `translate(0,${off})` : undefined} data-prim-off={off || undefined}>
        {node}
      </g>
    );
    if (q.k === "path") {
      const draw = !!q.draw;
      return wrap(
        <path
          d={q.d}
          fill="none"
          stroke={q.grad ? `url(#${gid("g", p.id)})` : q.stroke}
          strokeWidth={q.strokeW}
          strokeDasharray={draw ? "1" : q.dash || undefined}
          strokeLinecap="round"
          pathLength={draw ? 1 : undefined}
          opacity={ent ? 0 : q.opacity ?? 1}
          style={{ ...vars(delay), strokeDashoffset: draw ? (q.opacity === 0 ? 1 : 0) : undefined }}
          data-draw={draw ? "1" : undefined}
          data-delay={delay}
          data-prim-id={p.id}
          markerEnd={q.endMark ? `url(#${gid("mk", p.id)}-end)` : undefined}
          markerStart={q.startMark ? `url(#${gid("mk", p.id)}-start)` : undefined}
        />,
      );
    }
    if (q.k === "rect") {
      return wrap(
        <rect
          x={q.x}
          y={q.y}
          width={q.w}
          height={q.h}
          rx={q.rx}
          fill={q.hatch ? `url(#${gid("h", cix(q.fill))})` : q.fill}
          opacity={ent ? 0 : q.opacity ?? 1}
          // §16.2（R6）：入场缩放只在打开编排时用；CSS 已加 transform-box: fill-box + origin 50% 0
          style={{ ...vars(delay), x: q.x, y: q.y, width: q.w, height: q.h, transform: ent && motion === "open" ? "scaleY(0)" : undefined }}
          data-prim-id={p.id}
        />,
      );
    }
    if (q.k === "circle") {
      return wrap(
        <circle
          cx={q.cx}
          cy={q.cy}
          r={q.r}
          fill={q.fill}
          stroke={q.stroke}
          strokeWidth={q.strokeW}
          opacity={ent ? 0 : q.opacity ?? 1}
          style={{ ...vars(delay), cx: q.cx, cy: q.cy, r: q.r, transform: ent && motion === "open" ? "scale(0)" : undefined }}
          data-prim-id={p.id}
        />,
      );
    }
    return wrap(
      <text x={q.x} y={q.y} fontSize={q.fs} fontWeight={q.weight} fill={q.fill} textAnchor={q.anchor ?? "start"} opacity={ent ? 0 : q.opacity ?? 1} style={vars(delay)}>
        {q.text}
      </text>,
    );
  }

  function renderItem(it: FlowItem, ph: Phase, delay: number) {
    if (mode === "whisper" && it.kind === "head") return null;
    const whisper = mode === "whisper";
    const isBack = it.id === "back";
    const isPager = it.meta === "pager";
    const counter = it.chip?.style === "counter";
    const ex = ph === "exit";
    const ent = ph === "enter";
    const scale = it.peek ? FLOW_SCALE_PEEK : 1;
    // §16.3：删除 regroup ±10 / steady ±8——换组已由整代淡入淡出负责；位移只在打开时向左 6px
    const dx = motion === "open" && ent ? -6 : 0;
    const dy = 0;
    const content = it.lines.map((line, li) => (
      // §16.2（R1）：行文字不随退场瞬间透明，退场只由外层 .flow-item 的 opacity 负责
      <span key={li} className="flow-line" style={{ fontSize: it.fs, lineHeight: `${it.lh}px`, fontWeight: it.weight, opacity: it.tone / 100 }}>
        {it.reading ? <mark className="flow-pill">{line}</mark> : line}
      </span>
    ));
    return (
      <div
        key={it.id}
        className={`flow-item${ex ? " is-exit" : ""}${it.peek ? " is-peek" : ""}`}
        data-flow-item={it.id}
        data-kind={it.kind}
        data-lane={it.lane}
        data-counter={counter ? "1" : undefined}
        data-reading={it.reading ? "1" : undefined}
        data-selected={it.selected ? "1" : undefined}
        data-expanded={it.expanded ? "1" : undefined}
        style={{
          transform:
            `translate(${it.x}px, ${it.y}px)` +
            (scale !== 1 ? ` scale(${scale})` : "") +
            (dx || dy ? ` translate(${dx}px, ${dy}px)` : ""),
          width: it.w,
          height: it.h,
          opacity: whisper ? 0 : ex || ent ? 0 : 1,
          // §16.1.3：退场代整体不吃指针（内联写 none，样式表压不过内联）
          pointerEvents: phase === "exit" ? "none" : whisper ? "auto" : it.kind === "head" && !isBack && !it.peek ? "none" : "auto",
          transformOrigin: it.peek ? "0 50%" : undefined,
          ...vars(delay),
        }}
        onPointerEnter={it.kind === "head" ? undefined : () => onEvent({ kind: "hover", nodeId: it.nodeId })}
        onPointerLeave={it.kind === "head" ? undefined : () => onEvent({ kind: "hover", nodeId: null })}
        onClick={(e) => {
          if (it.nodeId == null) {
            if (isBack) onEvent({ kind: "action", name: "back" });
            else if (isPager) {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              onEvent({ kind: "action", name: e.clientX - r.left < r.width / 2 ? "cmpPrev" : "cmpNext" });
            } else if (it.moreKind) onEvent({ kind: "more", nodeId: it.nodeId, moreKind: it.moreKind });
            return;
          }
          if (it.kind === "more") {
            onEvent({ kind: "more", nodeId: it.nodeId, moreKind: it.moreKind });
            return;
          }
          onEvent({ kind: "click", nodeId: it.nodeId, peek: it.peek });
        }}
        onDoubleClick={() => (it.nodeId ? onEvent({ kind: "dblclick", nodeId: it.nodeId }) : undefined)}
        title={it.kind === "head" && isBack ? T("回到刚才读的位置") : it.lines.join(" ")}
      >
        {it.time ? <span className="flow-time">{it.time}</span> : null}
        {isBack ? <span className="flow-line flow-back-line" style={{ fontSize: 11, lineHeight: "22px", opacity: it.tone / 100 }}>↩ {T("回到刚才读的位置")}</span> : null}
        {!isBack && it.kind === "more" ? (
          <span className="flow-line" style={{ fontSize: 11, lineHeight: `${it.lh}px`, opacity: it.tone / 100 }}>
            {isPager ? T("{a} / {b}", { a: it.lines[0]?.split(" / ")[0] ?? "", b: it.lines[0]?.split(" / ")[1] ?? "" }) : it.moreKind === "above" ? T("上方另 {n} 项", { n: it.moreCount ?? 0 }) : it.moreKind === "below" ? T("下方另 {n} 项", { n: it.moreCount ?? 0 }) : T("另 {n} 项", { n: it.moreCount ?? 0 })}
          </span>
        ) : null}
        {!isBack && it.kind !== "more" ? content : null}
        {it.meta && it.kind !== "more" && !isBack ? (
          <span className="flow-meta" style={{ lineHeight: `${it.lh}px`, opacity: it.tone / 100 }}>
            {counter ? `⟂ ${it.meta}` : it.meta}
          </span>
        ) : null}
      </div>
    );
  }

  function whisperTag() {
    const it = layout.items.find((i) => i.nodeId === hoverId);
    if (!it) return null;
    return (
      <div className="flow-whisper-tag" style={{ transform: `translate(${it.x + 8}px, ${it.y}px)` }} aria-hidden="true">
        {it.lines[0]}
      </div>
    );
  }

  return (
    <div ref={ref} className="flow-gen" data-gen={base.genKey} data-phase={phase}>
      <SvgRoot className="flow-svg" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
        <defs>
          {/* 图元渐变 */}
          {prims.flatMap(({ item: p }) =>
            p.k === "path" && p.grad ? [
              <linearGradient key={gid("g", p.id)} id={gid("g", p.id)} gradientUnits="userSpaceOnUse" x1={p.grad.x1} y1={p.grad.y1} x2={p.grad.x2} y2={p.grad.y2}>
                <stop offset="0" stopColor={p.grad.from} />
                <stop offset="1" stopColor={p.grad.to} />
              </linearGradient>,
            ] : [],
          )}
          {/* 关系线渐变 */}
          {strandsP.map(({ item: s }) =>
            s.strong ? null : (
              <linearGradient key={gid("gs", s.order)} id={gid("gs", s.order)} gradientUnits="userSpaceOnUse" x1={s.xa} y1={s.ya} x2={s.xb} y2={s.yb}>
                <stop offset="0" stopColor={s.colorA} />
                <stop offset="1" stopColor={s.colorB} />
              </linearGradient>
            ),
          )}
          {/* 反方斜纹 */}
          {Array.from(new Set(prims.filter(({ item: p }) => p.k === "rect" && p.hatch).map(({ item }) => (item as Extract<FlowPrim, { k: "rect" }>).fill))).map((fill) => {
            const i = ci(fill);
            return (
              <pattern key={gid("h", i)} id={gid("h", i)} width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width={2} height={4} fill={fill} />
              </pattern>
            );
          })}
          {/* 端头 marker */}
          {prims.flatMap(({ item: p }) => (p.k === "path" ? markerDefs(gid("mk", p.id), p) : []))}
          {strandsP.flatMap(({ item: s }) => {
            const st = REL_STYLE[s.code as keyof typeof REL_STYLE];
            const out = [];
            if (st.end) out.push(marker(gid("mk", s.id), "end", st.end, strandEndColor(s)));
            if (st.start) out.push(marker(gid("mk", s.id), "start", st.start, s.strong ? colors.accent : s.colorA));
            return out;
          })}
        </defs>

        <g className="flow-col" style={{ transform: `translateY(${dy}px)` }}>
          {/* §16.2（R5）：两个图元层按 layer 过滤，不再各画一遍全量 */}
          <g className="flow-prims-under">
            {prims.filter(({ item: p }) => p.layer === "under").map(({ item: p, phase: ph }) => renderPrim(p, ph === "exit" ? exitPrim(p) : p, ph === "exit" ? 0 : primDelay(), ci, ph))}
          </g>
        </g>
        <g className="flow-strands">
          {strandsP.map(({ item: s, phase: ph }, i) => {
            const st = REL_STYLE[s.code as keyof typeof REL_STYLE];
            const rev = s.reverse;
            const endMark = rev ? st.start : st.end;
            const startMark = rev ? st.end : st.start;
            return (
              <g key={s.id}>
                <path
                  // §16.2：退场只设 opacity 0，不再 collapseStrand（否则线会先缩回节点再消失）
                  d={strandPath(s)}
                  fill="none"
                  stroke={strandColor(s)}
                  strokeWidth={st.width + 0.25}
                  strokeDasharray={st.dash || undefined}
                  strokeLinecap="round"
                  opacity={ph === "exit" || ph === "enter" ? 0 : colors.strandA}
                  style={vars(strandDelay(i))}
                  markerEnd={endMark ? `url(#${gid("mk", s.id)}-end)` : undefined}
                  markerStart={startMark ? `url(#${gid("mk", s.id)}-start)` : undefined}
                  data-strand-id={s.id}
                />
                {Math.abs(s.ya - s.yb) >= 28 && ph !== "exit" ? (
                  <g opacity={colors.strandA}>
                    <circle cx={Math.min(s.xa, s.xb) - 0.75 * s.bulge} cy={(s.ya + s.yb) / 2} r={8} fill={colors.bg} stroke={strandEndColor(s)} strokeWidth={1} />
                    <text x={Math.min(s.xa, s.xb) - 0.75 * s.bulge} y={(s.ya + s.yb) / 2 + 3.6} textAnchor="middle" fontSize={10} fill={strandEndColor(s)}>{s.code}</text>
                  </g>
                ) : null}
              </g>
            );
          })}
        </g>
        <g className="flow-col" style={{ transform: `translateY(${dy}px)` }}>
          <g className="flow-prims-over">
            {prims.filter(({ item: p }) => p.layer === "over").map(({ item: p, phase: ph }) => renderPrim(p, ph === "exit" ? exitPrim(p) : p, ph === "exit" ? 0 : primDelay(), ci, ph))}
          </g>
        </g>
      </SvgRoot>

      {/* 标签列 */}
      <div className="flow-items" style={{ transform: `translateY(${dy}px)` }}>
        {itemsP.map(({ item, phase: ph }, i) => renderItem(item, ph, delayFor(i, ph)))}
        {mode === "whisper" && hoverId ? whisperTag() : null}
      </div>
    </div>
  );
}

// §16.1.3 / §16.6.2：比较 base 的版式输入（引用相等即可），不比较 shapes——逐帧补渲染只重渲混合层
function sameBase(a: FlowScene, b: FlowScene): boolean {
  return (
    a.layout === b.layout &&
    a.strands === b.strands &&
    a.dy === b.dy &&
    a.plan === b.plan &&
    a.colors === b.colors &&
    a.hoverId === b.hoverId &&
    a.motion === b.motion &&
    a.armed === b.armed &&
    a.mode === b.mode &&
    a.inline.forId === b.inline.forId
  );
}

const UpperGen = memo(UpperGenImpl, (prev, next) => prev.phase === next.phase && prev.fadeIn === next.fadeIn && sameBase(prev.base, next.base));

const FLOW_SCALE_PEEK = 0.86;

// ---------------------------------------------------------------- 端头 marker
function marker(id: string, side: "end" | "start", kind: string, color: string) {
  const mid = `${id}-${side}`;
  const fill = kind === "open" ? "none" : color;
  const stroke = kind === "open" ? color : undefined;
  return (
    <marker key={mid} id={mid} viewBox="0 0 5 5" refX={side === "end" ? 4.5 : 0.5} refY={2.5} markerWidth={6} markerHeight={6} markerUnits="userSpaceOnUse" orient="auto">
      {kind === "arrow" ? <path d="M0,0 L5,2.5 L0,5 Z" fill={color} /> : null}
      {kind === "open" ? <path d="M0.6,0.6 L4.4,2.5 L0.6,4.4 Z" fill={fill} stroke={stroke} strokeWidth={1} /> : null}
      {kind === "bar" ? <rect x={2} y={0} width={1.5} height={5} fill={color} /> : null}
      {kind === "dot" ? <circle cx={2.5} cy={2.5} r={2} fill={color} /> : null}
    </marker>
  );
}
function markerDefs(id: string, p: Extract<FlowPrim, { k: "path" }>) {
  const color = p.grad ? p.grad.to : p.stroke;
  const out = [];
  if (p.endMark) out.push(marker(id, "end", p.endMark, color));
  if (p.startMark) out.push(marker(id, "start", p.startMark, color));
  return out;
}
