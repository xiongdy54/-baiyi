// 结构全景（D254）节流值：布局重算降到 ≤4 次/秒（ATLAS_T.LAYOUT_THROTTLE）。
import { useEffect, useRef, useState } from "react";

export function useThrottled<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  const last = useRef(0), timer = useRef<number | null>(null), latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    const now = performance.now(), wait = last.current + ms - now;
    if (wait <= 0) { last.current = now; setV(value); return; }
    if (timer.current == null) timer.current = window.setTimeout(() => { timer.current = null; last.current = performance.now(); setV(latest.current); }, wait);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ms]);
  useEffect(() => () => { if (timer.current != null) window.clearTimeout(timer.current); }, []);
  return v;
}
