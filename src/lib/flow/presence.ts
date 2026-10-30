// 结构流 · 进出场保留（STRUCTURE-FLOW-PLAN §5.8 照抄）。
// 用途：场景切换时旧标签 / 旧图元 / 旧流带在退场时长内仍留在树上（phase="exit"），
// 渲染器据 phase 决定起点 / 终点几何；新项在下一帧转 live（保证 CSS 过渡从初始态出发）。
// §16.1.4：代级淡入淡出（useGenFade）——两层同一小帧开始、同一曲线；CSS transition 依赖 2 帧翻转，起点不可控。
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type Phase = "enter" | "live" | "exit";

export function usePresence<T extends { id: string }>(items: readonly T[], exitMs: number): { item: T; phase: Phase }[] {
  const [, force] = useState(0);
  const store = useRef(new Map<string, { item: T; phase: Phase; t?: number }>());
  const order = useRef<string[]>([]);
  useLayoutEffect(() => {
    const m = store.current;
    const seen = new Set<string>();
    let changed = false;
    for (const it of items) {
      seen.add(it.id);
      const e = m.get(it.id);
      if (!e) {
        m.set(it.id, { item: it, phase: "enter" });
        changed = true;
        continue;
      }
      if (e.t != null) {
        window.clearTimeout(e.t);
        e.t = undefined;
      }
      if (e.item !== it) {
        e.item = it;
        changed = true;
      }
      if (e.phase === "exit") {
        e.phase = "live";
        changed = true;
      }
    }
    for (const [id, e] of m)
      if (!seen.has(id) && e.phase !== "exit") {
        e.phase = "exit";
        changed = true;
        e.t = window.setTimeout(() => {
          m.delete(id);
          order.current = order.current.filter((x) => x !== id);
          force((n) => n + 1);
        }, exitMs);
      }
    const next = items.map((i) => i.id);
    order.current.forEach((id, i) => {
      if (!seen.has(id) && m.has(id)) next.splice(Math.min(i, next.length), 0, id);
    });
    order.current = next;
    if (changed) force((n) => n + 1);
    if (![...m.values()].some((e) => e.phase === "enter")) return;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        for (const e of m.values()) if (e.phase === "enter") e.phase = "live";
        force((n) => n + 1);
      });
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, [items, exitMs]);
  useEffect(
    () => () => {
      for (const e of store.current.values()) if (e.t != null) window.clearTimeout(e.t);
    },
    [],
  );
  return order.current
    .map((id) => store.current.get(id))
    .filter((e): e is { item: T; phase: Phase } => !!e)
    .map((e) => ({ item: e.item, phase: e.phase }));
}

/**
 * §16.1.4 代级淡入淡出：一次换代＝旧代整体 120ms ease-in 淡出、新代 200ms ease-out 延迟 100ms 淡入。
 * 混合层 <g> 与上层 <div> 各调一次本 hook，同一次 commit 的 layout effect 里启动 → 浏览器给同一 start time。
 * 退场途中被「救回」（快速来回滚）从当前值 160ms 淡回 1。
 * 无 WAAPI（jsdom / 旧内核）或动效关闭时不做动画，直接落到终态。
 */
export function useGenFade(ref: { current: Element | null }, phase: Phase, fadeIn: boolean, off: boolean) {
  const anim = useRef<Animation | null>(null);
  const mounted = useRef(false);
  const prevPhase = useRef<Phase>(phase);
  useLayoutEffect(() => {
    const el = ref.current as (Element & { animate?: Element["animate"] }) | null;
    if (!el || off || typeof el.animate !== "function") return;
    const now = () => Number(getComputedStyle(el).opacity || 1);
    if (!mounted.current) {
      mounted.current = true;
      if (fadeIn) anim.current = el.animate([{ opacity: 0 }, { opacity: 1 }],
        { duration: 200, delay: 100, easing: "cubic-bezier(0, 0, 0.2, 1)", fill: "backwards" });
    } else if (phase === "exit" && prevPhase.current !== "exit") {
      const from = now();                       // 先读当前值（可能还在淡入途中）
      anim.current?.cancel();
      anim.current = el.animate([{ opacity: from }, { opacity: 0 }],
        { duration: Math.max(40, 120 * from), easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
    } else if (phase !== "exit" && prevPhase.current === "exit") {
      const from = now();                       // 来回滚：退场途中被"救回"
      anim.current?.cancel();
      anim.current = el.animate([{ opacity: from }, { opacity: 1 }],
        { duration: 160, easing: "cubic-bezier(0, 0, 0.2, 1)", fill: "none" });
    }
    prevPhase.current = phase;
  }, [phase, fadeIn, off]);
  useEffect(() => () => anim.current?.cancel(), []);
}
