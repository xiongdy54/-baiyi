// BDI（D248 / T6）：注意力状态机——单调时钟精确积分、idle 切分、30s 心跳、5min 切段、跨学习日切段。
// 唯一实现依据：docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md §7.3。
// 这是行为代理（窗口在前台、获焦且最近有输入），不证实在场/理解，不宣称「真实学习时长」。
import { dayString, tzOffsetMinutes } from "./day";
import { newUuid7, trackSpan } from "./track";
import type { Origin } from "./origin";

export type AttentionSurface = "read" | "review" | "xreview" | "author" | "browse" | "other";

export interface AttentionContext {
  surface: AttentionSurface;
  entityType?: string;
  entityId?: string;
  libraryItemId?: string;
  cardId?: string;
  extractId?: string;
  ctxId?: string;
  origin?: Origin;
}

export interface AttentionOptions {
  now?: () => number;
  mono?: () => number;
  doc?: Document | null;
  win?: Window | null;
  idleLimitFor?: (surface: AttentionSurface) => number;
  cutoffHour?: number;
  emitSpan?: (span: Record<string, unknown>) => void;
  intervalMs?: number;
  heartbeatMs?: number;
}

export const DEFAULT_IDLE_LIMITS: Record<AttentionSurface, number> = {
  read: 180000,
  review: 90000,
  xreview: 90000,
  author: 60000,
  browse: 60000,
  other: 60000,
};

const MAX_SPAN_MS = 300000;
const MIN_SPAN_MS = 1000;
const CLOCK_GAP_MS = 5000;
const MAX_RANGES = 20;
const MAX_POS_GAP = 5000;

interface SpanState {
  uid: string;
  day: string;
  startTs: number;
  startMono: number;
  lastTs: number;
  lastMono: number;
  activeMs: number;
  idleMs: number;
  monoMs: number;
  lastInputMono: number | null;
  keys: number;
  clicks: number;
  scrollPx: number;
  ranges: Array<[number, number]>;
  lastPos: number | null;
  revision: number;
  clockFlags: number;
  cutoff: number;
}

type EndReason = "switch" | "idle" | "blur" | "hidden" | "unload" | "split" | "day_cut" | "clock" | "suspend" | "lock";

export interface Attention {
  start(): void;
  stop(reason?: EndReason): void;
  setContext(next: AttentionContext | null): void;
  getContext(): AttentionContext | null;
  noteInput(kind: "key" | "pointer" | "wheel" | "poke", value?: number): void;
  notePosition(charPos: number, opts?: { jump?: boolean }): void;
  tick(): void;
  heartbeat(): void;
  flush(): void;
  status(): { active: boolean; hasSpan: boolean; surface: AttentionSurface | null; activeMs: number; idleMs: number };
  _peekSpan(): Record<string, unknown> | null;
}

export function createAttention(opts: AttentionOptions = {}): Attention {
  const now = opts.now || (() => Date.now());
  const mono = opts.mono || (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const doc = opts.doc !== undefined ? opts.doc : (typeof document !== "undefined" ? document : null);
  const win = opts.win !== undefined ? opts.win : (typeof window !== "undefined" ? window : null);
  const idleLimitFor = opts.idleLimitFor || ((s: AttentionSurface) => DEFAULT_IDLE_LIMITS[s] ?? 60000);
  const cutoff = Number.isInteger(opts.cutoffHour) ? (opts.cutoffHour as number) : 4;
  const emit = opts.emitSpan || ((span) => trackSpan(span));
  const intervalMs = opts.intervalMs && opts.intervalMs > 0 ? opts.intervalMs : 1000;
  const heartbeatMs = opts.heartbeatMs && opts.heartbeatMs > 0 ? opts.heartbeatMs : 30000;

  let ctx: AttentionContext | null = null;
  let span: SpanState | null = null;
  let active = false;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let beatTimer: ReturnType<typeof setInterval> | null = null;
  let pointerMoveAt = 0;
  const offs: Array<() => void> = [];

  const isForeground = () => {
    if (!doc) return true;
    const visible = doc.visibilityState === "visible";
    const focused = typeof doc.hasFocus === "function" ? doc.hasFocus() : true;
    return visible && focused;
  };

  function newSpan(wall: number, m: number): void {
    if (!ctx) return;
    span = {
      uid: newUuid7(wall), day: dayString(wall, cutoff), startTs: wall, startMono: m,
      lastTs: wall, lastMono: m, activeMs: 0, idleMs: 0, monoMs: 0, lastInputMono: null,
      keys: 0, clicks: 0, scrollPx: 0, ranges: [], lastPos: null, revision: 0, clockFlags: 0, cutoff,
    };
  }

  /** 精确积分：上个单调时刻 → now，在 lastInput+idleLimit 处切开。 */
  function integrate(m: number, wall: number): void {
    if (!span || m <= span.lastMono) return;
    const from = span.lastMono;
    const limit = idleLimitFor(ctx ? ctx.surface : "other");
    const activeEnd = span.lastInputMono == null ? from : Math.min(m, span.lastInputMono + limit);
    const activeMs = Math.max(0, activeEnd - from);
    span.activeMs += activeMs;
    span.idleMs += (m - from) - activeMs;
    span.monoMs += m - from;
    span.lastMono = m;
    span.lastTs = wall;
  }

  function payload(endReason: EndReason | null): Record<string, unknown> {
    const s = span!;
    return {
      uid: s.uid,
      start_ts: s.startTs,
      end_ts: s.lastTs,
      surface: ctx ? ctx.surface : "other",
      entity_type: ctx?.entityType ?? null,
      entity_id: ctx?.entityId ?? null,
      library_item_id: ctx?.libraryItemId ?? null,
      card_id: ctx?.cardId ?? null,
      extract_id: ctx?.extractId ?? null,
      ctx_id: ctx?.ctxId ?? null,
      origin: ctx?.origin ?? null,
      active_ms: Math.round(s.activeMs),
      idle_ms: Math.round(s.idleMs),
      mono_ms: s.monoMs,
      pos_ranges: s.ranges.length ? s.ranges : null,
      keys: s.keys,
      clicks: s.clicks,
      scroll_px: Math.round(s.scrollPx),
      revision: s.revision,
      closed: endReason ? 1 : 0,
      end_reason: endReason,
      day: s.day,
      tz_offset: tzOffsetMinutes(s.lastTs),
      cutoff_hour: s.cutoff,
      clock_flags: s.clockFlags,
    };
  }

  function seal(reason: EndReason): void {
    if (!span) return;
    integrate(mono(), now());
    span.revision++;
    if (span.monoMs >= MIN_SPAN_MS) emit(payload(reason));
    span = null;
  }

  function startSpanIfNeeded(): void {
    if (span || !ctx || !active) return;
    newSpan(now(), mono());
  }

  function tick(): void {
    if (!active) return;
    if (ctx && !span) return; // 无上下文时不凭空计时
    if (!span) return;
    const wall = now();
    const m = mono();
    if (!isForeground()) {
      seal(doc && doc.visibilityState !== "visible" ? "hidden" : "blur");
      return;
    }
    const monoDelta = m - span.lastMono;
    const wallDelta = wall - span.lastTs;
    if (monoDelta <= 0) {
      if (wallDelta > 0) span.lastTs = wall;
      return;
    }
    if (Math.abs(wallDelta - monoDelta) > CLOCK_GAP_MS) {
      // 时钟纠偏/回拨：结束旧段并置标记，不把偏移后的时长假装完整
      span.clockFlags |= 1;
      seal("clock");
      return;
    }
    if (monoDelta > CLOCK_GAP_MS) span.clockFlags |= 8; // 大调度缺口：标缺口，不重算未观测部分
    integrate(m, wall);
    const day = dayString(wall, cutoff);
    if (day !== span.day) { seal("day_cut"); return; }
    if (m - span.startMono >= MAX_SPAN_MS) { seal("split"); }
  }

  function heartbeat(): void {
    if (!span) return;
    integrate(mono(), now());
    span.revision++;
    emit(payload(null));
  }

  function noteInput(kind: "key" | "pointer" | "wheel" | "poke", value?: number): void {
    if (!active || !ctx) return;
    if (!isForeground()) return;
    startSpanIfNeeded();
    if (!span) return;
    const m = mono();
    span.lastInputMono = m;
    if (kind === "key") span.keys++;
    else if (kind === "pointer") span.clicks++;
    else if (kind === "wheel") span.scrollPx += Math.abs(Number(value) || 0);
  }

  function notePosition(charPos: number, optsPos: { jump?: boolean } = {}): void {
    if (!active || !ctx || !span) return;
    const pos = Math.round(Number(charPos));
    if (!Number.isFinite(pos) || pos < 0) return;
    const jump = !!optsPos.jump;
    const last = span.lastPos;
    const discontinuous = jump || last == null || Math.abs(pos - last) > MAX_POS_GAP;
    if (discontinuous) {
      span.ranges.push([pos, pos]);
    } else {
      const cur = span.ranges[span.ranges.length - 1];
      if (!cur) span.ranges.push([pos, pos]);
      else { cur[0] = Math.min(cur[0], pos); cur[1] = Math.max(cur[1], pos); }
    }
    span.lastPos = pos;
    if (span.ranges.length > MAX_RANGES) span.ranges = span.ranges.slice(0, MAX_RANGES); // 保留已知部分，结果是下界
  }

  function attach(): void {
    if (!win || !doc || offs.length) return;
    const onKey = () => noteInput("key");
    const onPointer = () => noteInput("pointer");
    const onWheel = (e: Event) => noteInput("wheel", (e as WheelEvent).deltaY);
    const onMove = () => {
      const t = mono();
      if (t - pointerMoveAt < 100) return; // 节流
      pointerMoveAt = t;
      noteInput("pointer");
    };
    const onBlur = () => seal("blur");
    const onVisible = () => { if (doc.visibilityState === "hidden") seal("hidden"); };
    const onUnload = () => seal("unload");
    win.addEventListener("keydown", onKey, true);
    win.addEventListener("pointerdown", onPointer, true);
    win.addEventListener("wheel", onWheel, { capture: true, passive: true });
    win.addEventListener("pointermove", onMove, { capture: true, passive: true });
    win.addEventListener("blur", onBlur);
    win.addEventListener("pagehide", onUnload);
    doc.addEventListener("visibilitychange", onVisible);
    offs.push(() => win.removeEventListener("keydown", onKey, true));
    offs.push(() => win.removeEventListener("pointerdown", onPointer, true));
    offs.push(() => win.removeEventListener("wheel", onWheel, true));
    offs.push(() => win.removeEventListener("pointermove", onMove, true));
    offs.push(() => win.removeEventListener("blur", onBlur));
    offs.push(() => win.removeEventListener("pagehide", onUnload));
    offs.push(() => doc.removeEventListener("visibilitychange", onVisible));
  }

  function detach(): void {
    while (offs.length) offs.pop()!();
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    if (beatTimer) { clearInterval(beatTimer); beatTimer = null; }
  }

  return {
    start() {
      if (active) return;
      active = true;
      attach();
      tickTimer = setInterval(tick, intervalMs);
      beatTimer = setInterval(heartbeat, heartbeatMs);
    },
    stop(reason: EndReason = "unload") {
      seal(reason);
      detach();
      active = false;
      ctx = null;
      span = null;
    },
    setContext(next) {
      if (ctx && next && ctx.surface === next.surface && ctx.entityId === next.entityId && ctx.ctxId === next.ctxId) {
        ctx = { ...ctx, ...next };
        return;
      }
      seal("switch");
      ctx = next ? { ...next } : null;
      if (ctx && active) startSpanIfNeeded();
    },
    getContext: () => (ctx ? { ...ctx } : null),
    noteInput,
    notePosition,
    tick,
    heartbeat,
    flush() { seal("idle"); },
    status() {
      return { active, hasSpan: !!span, surface: ctx ? ctx.surface : null, activeMs: span ? Math.round(span.activeMs) : 0, idleMs: span ? Math.round(span.idleMs) : 0 };
    },
    _peekSpan() { return span ? payload(null) : null; },
  };
}
