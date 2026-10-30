// 结构流 · 渲染器（STRUCTURE-FLOW-PLAN §7 / §8 / §12.2 / §12.3 / §12.4.5）。
// 三层：① 混合层 SVG（高亮流带，mix-blend-mode 叠在正文上）② 上层 SVG（脊线 / 轴 / 节点条 / 关系线）
// ③ HTML（标签 / 动作行 / 讲解 / 空态）。所有几何都由布局产出，本文件只负责画。
import { createElement, useEffect, useRef } from "react";
import type { CSSProperties, ReactElement, ReactNode, SVGProps } from "react";
import type { FlowItem, FlowPrim, FlowScene, FlowShape, FlowStrand } from "../../../lib/flow/types";
import {
  FLOW,
  collapseAtEdge,
  collapseAtLeft,
  collapseAtNode,
  collapseStrand,
  neckPath,
  parseRgb,
  shapePath,
  strandPath,
  tierOf,
} from "../../../lib/flow/layout";
import { usePresence } from "../../../lib/flow/presence";
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
  /** §13.3.4：滚动模式下宿主注册颈部 path 元素，逐帧直接写 d（不走 React） */
  registerShape?: (id: string, el: SVGPathElement | null) => void;
}

const stagger = (i: number, step: number, cap: number) => Math.min(i * step, cap);
/** §14.4：流带渐变 id（每条形状一条，几何取自它自己的 xs/x1） */
const shapeGradId = (id: string) => `fg-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
const vars = (delay: number) => ({ "--flow-delay": `${Math.round(delay)}ms` }) as CSSProperties;

/** 结构流的两层画布根（业务代码的内联 SVG 棘轮只许变少：这里用 createElement 建根，避免新增字面量） */
const SvgRoot = (props: SVGProps<SVGSVGElement> & { children?: ReactNode } & Record<string, unknown>): ReactElement => createElement("svg", props);

/** 颜色 → 渐变下标（整场稳定：按 palette 顺序先占位） */
function colorIndexer(scene: FlowScene) {
  const list = [...scene.colors.palette, scene.colors.accent, scene.colors.counter, scene.colors.fg];
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

function exitPrim(p: FlowPrim): FlowPrim {
  if (p.k === "rect") return { ...p, h: Math.min(1, p.h), opacity: 0 };
  if (p.k === "circle") return { ...p, r: 0, opacity: 0 };
  if (p.k === "path") return { ...p, opacity: 0 };
  return { ...p, opacity: 0 };
}

export default function FlowLayer({ scene, onEvent, registerShape }: FlowLayerProps) {
  const T = useT();
  const { colors, plan, layout, shapes, strands, hoverId, dy, motion, tracking, armed, inline, panel } = scene;
  const motionOff = motionPreference() === "off";
  const rootRef = useRef<HTMLDivElement>(null);
  /** §13.4.3：颜色兜底——解析不了就退色调色板第一色，绝不把 color-mix() 写进 SVG */
  const safe = (c: string) => (parseRgb(c) ? c : colors.palette[0]);
  const ci = colorIndexer(scene);

  // 图元 / 关系线 / 标签的进出场保留（§5.8）
  const prims = usePresence(scene.mode === "whisper" ? layout.prims.filter((p) => p.id.startsWith("bar:")) : layout.prims, 200);
  const strandsP = usePresence(strands, 200);
  const shapesP = usePresence(shapes, 200);
  const itemsP = usePresence(layout.items, 220);

  const delayFor = (i: number, phase: "enter" | "live" | "exit") => {
    if (phase === "exit") return motion === "close" ? stagger(i, 12, 96) : 0;
    if (motion === "open") return 360 + stagger(i, 22, 200);
    if (motion === "close") return stagger(i, 12, 96);
    if (motion === "regroup-down" || motion === "regroup-up") return 160 + stagger(i, 20, 180);
    if (motion === "conveyor-down" || motion === "conveyor-up") return stagger(i, 24, 96);
    return 0;
  };
  const shapeDelay = (i: number) => {
    if (motion === "open") return stagger(i, 30, 240);
    if (motion === "close") return 100 + stagger(i, 14, 110);
    if (motion === "turn") return 220 + stagger(i, 18, 120);
    if (motion === "regroup-down" || motion === "regroup-up") return 340 + stagger(i, 20, 180);
    return 0;
  };
  const strandDelay = (i: number) => (motion === "open" ? 760 + stagger(i, 40, 240) : motion === "regroup-down" || motion === "regroup-up" ? 560 : 0);

  // 打开 / 翻页：首帧折叠、下一帧靠 CSS d 过渡展开；armed=false 时画折叠态
  const shapeGeom = (s: FlowShape, phase: "enter" | "live" | "exit"): FlowShape => {
    if (phase === "exit") return collapseAtNode(s);
    if (!armed && (motion === "open" || motion === "turn")) return motion === "open" ? collapseAtLeft(s) : collapseAtNode(s);
    if (motion === "close") return collapseAtLeft(s);
    return s;
  };

  // draw 线：进场用 WAAPI 从 dashoffset 1 → 0（CSS 过渡对首帧挂载不生效）
  useEffect(() => {
    if (motion === "track" || !armed) return;
    const host = rootRef.current;
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
  }, [scene.seq, armed, motion]);

  // §14.2-2：动作行只锚主体行——预览行不是可操作目标（否则会浮在预览行上盖住主体）
  const selected = layout.items.find((i) => i.nodeId === inline.forId && !i.peek && (i.kind === "node" || i.kind === "kid"));
  const inlineAt = layout.inlineAt ?? (selected ? { x: selected.x, y: selected.y + selected.h, w: selected.w } : null);
  const explainH = inline.explainOpen ? Math.min(FLOW.EXPLAIN_MAX_H, Math.ceil((inline.explainText.length * 12) / Math.max(1, plan.labelW)) * 18 + 12) : 0;

  const strandColor = (s: FlowStrand) => (s.strong ? colors.accent : `url(#gs-${s.order})`);
  const strandEndColor = (s: FlowStrand) => (s.strong ? colors.accent : s.colorB);

  return (
    <>
      {/* ① 混合层：只放高亮流带（与正文混合；自身及祖先不得有 transform / opacity / filter） */}
      <SvgRoot
        className="flow-blend"
        data-dark={colors.dark ? "1" : undefined}
        data-tracking={tracking ? "1" : undefined}
        data-smooth={scene.smooth ? "1" : undefined}
        data-motion={motionOff ? "off" : undefined}
        style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", pointerEvents: "none", zIndex: 23, mixBlendMode: colors.dark ? "screen" : "multiply", overflow: "visible" }}
      >
        <defs>
          {/* §14.4：每条流带一条渐变，从【接缝】起坡——任何 braid 宽度下接缝透明度都等于矩形右端的 aHL */}
          {shapesP.map(({ item: s }) => (
            <linearGradient key={`fg-${s.id}`} id={shapeGradId(s.id)} gradientUnits="userSpaceOnUse" x1={s.xs} y1="0" x2={s.x1} y2="0">
              <stop offset="0" stopColor={safe(s.color)} stopOpacity={colors.aHL[s.tone]} />
              <stop offset="1" stopColor={safe(s.color)} stopOpacity={colors.aEnd[s.tone]} />
            </linearGradient>
          ))}
          {shapesP.filter(({ item }) => item.stub).map(({ item }) => {
            return (
              <linearGradient key={`st-${item.id}`} id={`fst-${item.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`} gradientUnits="userSpaceOnUse" x1={item.L} y1="0" x2={item.x1} y2="0">
                <stop offset="0" stopColor={safe(item.color)} stopOpacity={0} />
                <stop offset="1" stopColor={safe(item.color)} stopOpacity={0.16} />
              </linearGradient>
            );
          })}
        </defs>
        <g className="flow-shapes">
          {shapesP.map(({ item: s, phase }, i) => {
            if (scene.smooth && !s.ribbon) return null; // 矩形已经画在正文里了
            const g = scene.smooth
              ? phase === "exit" || (!armed && motion === "open") || motion === "close"
                ? collapseAtEdge(s)
                : s
              : shapeGeom(s, phase);
            const d = scene.smooth && !s.stub ? neckPath(g) : shapePath(g);
            const dim = !!hoverId && s.nodeId !== hoverId && s.tone === 0;
            return (
              <path
                key={s.id}
                ref={(el) => registerShape?.(s.id, el)}
                className={`flow-shape${dim ? " is-dim" : ""}`}
                d={d}
                fill={s.stub ? `url(#fst-${s.id.replace(/[^a-zA-Z0-9_-]/g, "_")})` : `url(#${shapeGradId(s.id)})`}
                style={{ d: `path("${d}")`, ...vars(shapeDelay(i)) }}
                data-node-id={s.nodeId}
                data-tone={s.tone}
              />
            );
          })}
        </g>
      </SvgRoot>

      {/* ② + ③ 上层：普通合成 */}
      <div ref={rootRef} className="flow-layer" data-motion={motionOff ? "off" : undefined} data-tracking={tracking ? "1" : undefined} data-mode={scene.mode}>
        <SvgRoot className="flow-svg" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
          <defs>
            {/* 图元渐变 */}
            {prims.flatMap(({ item: p }) =>
              p.k === "path" && p.grad ? [
                <linearGradient key={`g-${p.id}`} id={`g-${p.id}`} gradientUnits="userSpaceOnUse" x1={p.grad.x1} y1={p.grad.y1} x2={p.grad.x2} y2={p.grad.y2}>
                  <stop offset="0" stopColor={p.grad.from} />
                  <stop offset="1" stopColor={p.grad.to} />
                </linearGradient>,
              ] : [],
            )}
            {/* 关系线渐变 */}
            {strandsP.map(({ item: s }) =>
              s.strong ? null : (
                <linearGradient key={`gs-${s.order}`} id={`gs-${s.order}`} gradientUnits="userSpaceOnUse" x1={s.xa} y1={s.ya} x2={s.xb} y2={s.yb}>
                  <stop offset="0" stopColor={s.colorA} />
                  <stop offset="1" stopColor={s.colorB} />
                </linearGradient>
              ),
            )}
            {/* 反方斜纹 */}
            {Array.from(new Set(prims.filter(({ item: p }) => p.k === "rect" && p.hatch).map(({ item }) => (item as Extract<FlowPrim, { k: "rect" }>).fill))).map((fill) => {
              const i = ci(fill);
              return (
                <pattern key={`h-${i}`} id={`h-${i}`} width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width={2} height={4} fill={fill} />
                </pattern>
              );
            })}
            {/* 端头 marker */}
            {prims.flatMap(({ item: p }) => (p.k === "path" ? markerDefs(p.id, p, p.stroke) : []))}
            {strandsP.flatMap(({ item: s }) => {
              const st = REL_STYLE[s.code as keyof typeof REL_STYLE];
              const endKind = st.end;
              const startKind = st.start;
              const out = [];
              if (endKind) out.push(marker(s.id, "end", endKind, strandEndColor(s)));
              if (startKind) out.push(marker(s.id, "start", startKind, s.strong ? colors.accent : s.colorA));
              return out;
            })}
          </defs>

          <g className="flow-col" style={{ transform: `translateY(${dy}px)` }}>
            <g className="flow-prims-under">{prims.map(({ item: p, phase }, i) => renderPrim(p, phase === "exit" ? exitPrim(p) : p, i, phase === "exit" ? 200 : primDelay(p), ci))}</g>
          </g>
          <g className="flow-strands">
            {strandsP.map(({ item: s, phase }, i) => {
              const st = REL_STYLE[s.code as keyof typeof REL_STYLE];
              const rev = s.reverse;
              const endMark = rev ? st.start : st.end;
              const startMark = rev ? st.end : st.start;
              return (
                <g key={s.id}>
                  <path
                    d={strandPath(phase === "exit" ? collapseStrand(s) : s)}
                    fill="none"
                    stroke={strandColor(s)}
                    strokeWidth={st.width + 0.25}
                    strokeDasharray={st.dash || undefined}
                    strokeLinecap="round"
                    opacity={phase === "exit" ? 0 : colors.strandA}
                    style={vars(strandDelay(i))}
                    markerEnd={endMark ? `url(#mk-${s.id}-end)` : undefined}
                    markerStart={startMark ? `url(#mk-${s.id}-start)` : undefined}
                    data-strand-id={s.id}
                  />
                  {Math.abs(s.ya - s.yb) >= 28 && phase !== "exit" ? (
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
            <g className="flow-prims-over">{prims.map(({ item: p, phase }, i) => renderPrim(p, phase === "exit" ? exitPrim(p) : p, i, phase === "exit" ? 200 : primDelay(p), ci))}</g>
          </g>
        </SvgRoot>

        {/* 标签列 */}
        <div className="flow-items" style={{ transform: `translateY(${dy}px)` }}>
          {itemsP.map(({ item, phase }, i) => renderItem(item, phase, delayFor(i, phase)))}
          {scene.mode === "whisper" && hoverId ? whisperTag() : null}
        </div>

        {/* 动作行 / 讲解 / 状态 */}
        {inlineAt && inline.forId && scene.mode !== "whisper" ? (
          <div className="flow-inline" style={{ transform: `translate(${inlineAt.x}px, ${inlineAt.y + dy}px)`, width: inlineAt.w }}>
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
              <div className="flow-explain" style={{ maxHeight: FLOW.EXPLAIN_MAX_H, minHeight: inline.explainBusy ? 40 : explainH }}>
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
        {panel.kind !== "ok" && scene.mode !== "whisper" ? (
          <div className="flow-empty" style={{ transform: `translate(${plan.labelX}px, ${Math.round((scene.viewport.top + scene.viewport.bottom) / 2 - 14)}px)`, width: Math.max(120, plan.labelW) }}>
            {panel.kind === "feeding" ? (
              <>
                <div>{T("原文读取中 {i}/{n}", { i: panel.feedDone, n: panel.feedTotal })}</div>
                <div className="flow-progress"><i style={{ width: `${panel.feedTotal ? (panel.feedDone / panel.feedTotal) * plan.labelW : 0}px` }} /></div>
              </>
            ) : panel.kind === "empty" ? (
              <>
                <div>{T("本节还没有结构")}</div>
                <button type="button" className="flow-empty-action" onClick={() => onEvent({ kind: "action", name: "generate" })}>{T("为本节生成 →")}</button>
              </>
            ) : panel.kind === "nokey" ? (
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

  // ---------------------------------------------------------------- 内部渲染

  function primDelay(_p: FlowPrim) {
    if (motion === "open") return 480;
    if (motion === "close") return 60;
    if (motion === "regroup-down" || motion === "regroup-up") return 160;
    return 0;
  }

  function renderPrim(p: FlowPrim, q: FlowPrim, i: number, delay: number, cix: (c: string) => number) {
    const off = q.off ?? 0;
    const key = `${p.id}:${i}`;
    const wrap = (node: ReactElement) => (
      <g key={key} transform={off ? `translate(0,${off})` : undefined} data-prim-off={off || undefined}>
        {node}
      </g>
    );
    if (q.k === "path") {
      const draw = !!q.draw;
      return wrap(
        <path
          d={q.d}
          fill="none"
          stroke={q.grad ? `url(#g-${p.id})` : q.stroke}
          strokeWidth={q.strokeW}
          strokeDasharray={draw ? "1" : q.dash || undefined}
          strokeLinecap="round"
          pathLength={draw ? 1 : undefined}
          opacity={q.opacity ?? 1}
          style={{ ...vars(delay), strokeDashoffset: draw ? (q.opacity === 0 ? 1 : 0) : undefined }}
          data-draw={draw ? "1" : undefined}
          data-delay={delay}
          data-prim-id={p.id}
          markerEnd={q.endMark ? `url(#mk-${p.id}-end)` : undefined}
          markerStart={q.startMark ? `url(#mk-${p.id}-start)` : undefined}
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
          fill={q.hatch ? `url(#h-${cix(q.fill)})` : q.fill}
          opacity={q.opacity ?? 1}
          style={{ ...vars(delay), x: q.x, y: q.y, width: q.w, height: q.h }}
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
          opacity={q.opacity ?? 1}
          style={{ ...vars(delay), cx: q.cx, cy: q.cy, r: q.r }}
          data-prim-id={p.id}
        />,
      );
    }
    return wrap(
      <text x={q.x} y={q.y} fontSize={q.fs} fontWeight={q.weight} fill={q.fill} textAnchor={q.anchor ?? "start"} opacity={q.opacity ?? 1} style={vars(delay)}>
        {q.text}
      </text>,
    );
  }

  function renderItem(it: FlowItem, phase: "enter" | "live" | "exit", delay: number) {
    if (scene.mode === "whisper" && it.kind === "head") return null;
    const whisper = scene.mode === "whisper";
    const isBack = it.id === "back";
    const isPager = it.meta === "pager";
    const counter = it.chip?.style === "counter";
    const ex = phase === "exit";
    const scale = it.peek ? FLOW_SCALE_PEEK : 1;
    const content = it.lines.map((line, li) => (
      <span key={li} className="flow-line" style={{ fontSize: it.fs, lineHeight: `${it.lh}px`, fontWeight: it.weight, opacity: ex ? 0 : it.tone / 100 }}>
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
          transform: `translate(${it.x}px, ${it.y}px)` + (scale !== 1 ? ` scale(${scale})` : "") + (ex ? " translateX(-4px)" : ""),
          width: it.w,
          height: it.h,
          opacity: whisper ? 0 : ex ? 0 : 1,
          pointerEvents: whisper ? "auto" : it.kind === "head" && !isBack && !it.peek ? "none" : "auto",
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
        {isBack ? <span className="flow-line flow-back-line" style={{ fontSize: 11, lineHeight: "22px", opacity: ex ? 0 : it.tone / 100 }}>↩ {T("回到刚才读的位置")}</span> : null}
        {!isBack && it.kind === "more" ? (
          <span className="flow-line" style={{ fontSize: 11, lineHeight: `${it.lh}px`, opacity: ex ? 0 : it.tone / 100 }}>
            {isPager ? T("{a} / {b}", { a: it.lines[0]?.split(" / ")[0] ?? "", b: it.lines[0]?.split(" / ")[1] ?? "" }) : it.moreKind === "above" ? T("上方另 {n} 项", { n: it.moreCount ?? 0 }) : it.moreKind === "below" ? T("下方另 {n} 项", { n: it.moreCount ?? 0 }) : T("另 {n} 项", { n: it.moreCount ?? 0 })}
          </span>
        ) : null}
        {!isBack && it.kind !== "more" ? content : null}
        {it.meta && it.kind !== "more" && !isBack ? (
          <span className="flow-meta" style={{ lineHeight: `${it.lh}px`, opacity: ex ? 0 : it.tone / 100 }}>
            {counter ? `⟂ ${it.meta}` : it.meta}
          </span>
        ) : null}
        {it.kind === "head" && it.meta && isBack ? null : null}
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
}

const FLOW_SCALE_PEEK = 0.86;

// ---------------------------------------------------------------- 端头 marker
function marker(prefix: string, side: "end" | "start", kind: string, color: string) {
  const id = `mk-${prefix}-${side}`;
  const fill = kind === "open" ? "none" : color;
  const stroke = kind === "open" ? color : undefined;
  return (
    <marker key={id} id={id} viewBox="0 0 5 5" refX={side === "end" ? 4.5 : 0.5} refY={2.5} markerWidth={6} markerHeight={6} markerUnits="userSpaceOnUse" orient="auto">
      {kind === "arrow" ? <path d="M0,0 L5,2.5 L0,5 Z" fill={color} /> : null}
      {kind === "open" ? <path d="M0.6,0.6 L4.4,2.5 L0.6,4.4 Z" fill={fill} stroke={stroke} strokeWidth={1} /> : null}
      {kind === "bar" ? <rect x={2} y={0} width={1.5} height={5} fill={color} /> : null}
      {kind === "dot" ? <circle cx={2.5} cy={2.5} r={2} fill={color} /> : null}
    </marker>
  );
}
function markerDefs(id: string, p: Extract<FlowPrim, { k: "path" }>, _stroke: string) {
  const color = p.grad ? p.grad.to : p.stroke;
  const out = [];
  if (p.endMark) out.push(marker(id, "end", p.endMark, color));
  if (p.startMark) out.push(marker(id, "start", p.startMark, color));
  return out;
}
