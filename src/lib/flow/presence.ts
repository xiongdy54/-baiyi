// 结构流 · 进出场保留（STRUCTURE-FLOW-PLAN §5.8 照抄）。
// 用途：场景切换时旧标签 / 旧图元 / 旧流带在退场时长内仍留在树上（phase="exit"），
// 渲染器据 phase 决定起点 / 终点几何；新项在下一帧转 live（保证 CSS 过渡从初始态出发）。
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
