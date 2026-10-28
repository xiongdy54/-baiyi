// BDI（D248 / T6）：渲染层采集 SDK——环形缓冲（500 条 / 1MiB）、2s 或 100 条冲刷、behavior:batch。
// 唯一实现依据：docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md §7.2。
// 硬约束：track() 只在事件处理/受控 effect 中调用；不得放 render；不得新增 React state / 同步 IO。
import type { BdiEventName } from "./catalog.generated";
import { dayString, tzOffsetMinutes } from "./day";
import type { Origin } from "./origin";

const CAPACITY = 500;
const MAX_BYTES = 1024 * 1024;
const FLUSH_MS = 2000;
const FLUSH_COUNT = 100;
const TEXT_MAX = 200;

export interface TrackContext {
  surface?: string;
  entityType?: string;
  entityId?: string;
  libraryItemId?: string;
  cardId?: string;
  extractId?: string;
  kpId?: string;
  ctxId?: string;
  origin?: Origin;
  actor?: "user" | "background" | "unknown";
}

export interface TrackPayload extends TrackContext {
  props?: Record<string, unknown>;
  ts?: number;
  sourceTs?: number;
  opId?: string;
  presentationId?: string;
  docPos?: number;
  durMs?: number;
  num?: number;
  text?: string;
}

interface BufferEntry {
  item: Record<string, unknown>;
  bytes: number;
}

interface TrackConfig {
  enabled: boolean;
  generation: number;
  recordQueryText: boolean;
  cutoffHour: number;
  renderId: string;
}

let config: TrackConfig = {
  enabled: true,
  generation: 1,
  recordQueryText: false,
  cutoffHour: 4,
  renderId: newUuid7(),
};
let context: TrackContext = {};
let events: BufferEntry[] = [];
let spans: BufferEntry[] = [];
let bytes = 0;
let dropped = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const installed: Array<() => void> = [];

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  const c = (globalThis as unknown as { crypto?: { getRandomValues?: (a: Uint8Array) => void } }).crypto;
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
  return b;
}

/** UUIDv7（与主进程同构）；渲染层每次事件生成一次、重试不换。 */
export function newUuid7(nowMs: number = Date.now()): string {
  const b = randomBytes(16);
  let ts = Math.floor(nowMs);
  for (let i = 5; i >= 0; i--) {
    b[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

interface BehaviorBridge {
  batch?: (payload: unknown) => void;
}

function bridge(): BehaviorBridge | undefined {
  return (globalThis as unknown as { behaviorAPI?: BehaviorBridge }).behaviorAPI;
}

function sizeOf(item: Record<string, unknown>): number {
  try {
    return 96 + JSON.stringify(item.props || {}).length + String(item.text || "").length;
  } catch {
    return 256;
  }
}

function trimToCapacity(): void {
  while (events.length + spans.length > CAPACITY || bytes > MAX_BYTES) {
    if (!events.length && !spans.length) break;
    const e = events.length ? events.shift()! : spans.shift()!;
    bytes = Math.max(0, bytes - e.bytes);
    dropped++;
  }
}

function ensureTimer(): void {
  if (timer || (!events.length && !spans.length)) return;
  timer = setInterval(() => { flushTrack(); }, FLUSH_MS);
}

function stopTimer(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

function snakeContext(c: TrackContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (c.surface) out.surface = c.surface;
  if (c.entityType) out.entity_type = c.entityType;
  if (c.entityId) out.entity_id = c.entityId;
  if (c.libraryItemId) out.library_item_id = c.libraryItemId;
  if (c.cardId) out.card_id = c.cardId;
  if (c.extractId) out.extract_id = c.extractId;
  if (c.kpId) out.kp_id = c.kpId;
  if (c.ctxId) out.ctx_id = c.ctxId;
  if (c.origin) out.origin = c.origin;
  if (c.actor) out.actor = c.actor;
  return out;
}

/** 更新/清空当前采集上下文（路由或实体离开时必须 clear，§7.2）。 */
export function setTrackContext(next: TrackContext | null): void {
  context = next ? { ...next } : {};
}

export function getTrackContext(): TrackContext {
  return { ...context };
}

/** 配置：禁用/清除时清空缓冲；generation 由主进程推送（behavior:config）。 */
export function configureTrack(next: Partial<TrackConfig>): void {
  config = { ...config, ...next };
  if (!config.enabled) {
    events = [];
    spans = [];
    bytes = 0;
    stopTimer();
  }
}

export function getTrackConfig(): TrackConfig {
  return { ...config };
}

/** 采集一条事件（热路径：只做算术与数组写入）。 */
export function track(type: BdiEventName | string, payload: TrackPayload = {}): void {
  if (!config.enabled) return;
  const ts = Number.isFinite(payload.ts) ? (payload.ts as number) : Date.now();
  const merged: Record<string, unknown> = {
    ...snakeContext(context),
    ...snakeContext(payload),
    type,
    uid: newUuid7(ts),
    ts,
    source_ts: Number.isFinite(payload.sourceTs) ? payload.sourceTs : ts,
    day: dayString(ts, config.cutoffHour),
    tz_offset: tzOffsetMinutes(ts),
    cutoff_hour: config.cutoffHour,
    props: payload.props && typeof payload.props === "object" ? payload.props : {},
  };
  if (payload.opId) merged.op_id = payload.opId;
  if (payload.presentationId) merged.presentation_id = payload.presentationId;
  if (Number.isFinite(payload.docPos)) merged.doc_pos = payload.docPos;
  if (Number.isFinite(payload.durMs)) merged.dur_ms = payload.durMs;
  if (Number.isFinite(payload.num)) merged.num = payload.num;
  if (payload.text != null) {
    // 默认不记原文；开启后也只存 ≤200 字（主进程仍会再校验一次）
    if (config.recordQueryText) merged.text = String(payload.text).slice(0, TEXT_MAX);
  }
  if (!merged.actor) merged.actor = "unknown";
  const entry = { item: merged, bytes: sizeOf(merged) };
  events.push(entry);
  bytes += entry.bytes;
  trimToCapacity();
  if (events.length + spans.length >= FLUSH_COUNT) flushTrack();
  else ensureTimer();
}

/** 采集一条注意力 span（attention.ts 调用；心跳复用 uid + 递增 revision）。 */
export function trackSpan(span: Record<string, unknown>): void {
  if (!config.enabled) return;
  const entry = { item: span, bytes: 200 };
  spans.push(entry);
  bytes += entry.bytes;
  trimToCapacity();
  if (events.length + spans.length >= FLUSH_COUNT) flushTrack();
  else ensureTimer();
}

/** 立即冲刷到主进程；桥不可用/抛错时保留缓冲（uid 不变，主进程按 uid 去重）。 */
export function flushTrack(): boolean {
  const api = bridge();
  if (!api || typeof api.batch !== "function") return false;
  if (!events.length && !spans.length) { stopTimer(); return true; }
  const payload = {
    generation: config.generation,
    renderId: config.renderId,
    events: events.map((e) => e.item),
    spans: spans.map((s) => s.item),
  };
  try {
    api.batch(payload);
  } catch {
    return false;
  }
  events = [];
  spans = [];
  bytes = 0;
  stopTimer();
  return true;
}

/** 页面生命周期冲刷（hidden / pagehide / beforeunload）。 */
export function installFlushHooks(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (installed.length) return;
  const onHidden = () => { if (document.visibilityState === "hidden") flushTrack(); };
  const onLeave = () => { flushTrack(); };
  document.addEventListener("visibilitychange", onHidden);
  window.addEventListener("pagehide", onLeave);
  window.addEventListener("beforeunload", onLeave);
  installed.push(() => document.removeEventListener("visibilitychange", onHidden));
  installed.push(() => window.removeEventListener("pagehide", onLeave));
  installed.push(() => window.removeEventListener("beforeunload", onLeave));
}

export function trackStatus(): { enabled: boolean; generation: number; events: number; spans: number; bytes: number; dropped: number } {
  return { enabled: config.enabled, generation: config.generation, events: events.length, spans: spans.length, bytes, dropped };
}

/** 仅测试用：复位模块状态。 */
export function resetTrackForTest(): void {
  config = { enabled: true, generation: 1, recordQueryText: false, cutoffHour: 4, renderId: newUuid7() };
  context = {};
  events = [];
  spans = [];
  bytes = 0;
  dropped = 0;
  stopTimer();
  while (installed.length) installed.pop()!();
}

installFlushHooks();
