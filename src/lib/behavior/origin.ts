// BDI（D248 / T6）：来源（origin）多槽 token——(window, entityType, entityId, nonce) → origin，3s 过期、一次消费。
// 唯一实现依据：docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md §7.4 / V1-4。禁止全局单槽（快速打开 A/B 会串来源）。
export type Origin =
  | "shelf" | "search" | "browse" | "card_source" | "link" | "mindmap" | "kp" | "journal" | "resume"
  | "queue" | "recommend" | "review_flow" | "notification" | "capture" | "reader_toc" | "reader_internal"
  | "workbench" | "unknown";

export interface OriginTarget {
  window?: string;
  entityType?: string;
  entityId?: string;
  nonce?: string;
}

interface Slot extends OriginTarget {
  origin: Origin;
  at: number;
}

const TTL_MS = 3000;
let slots: Slot[] = [];
let clock: () => number = () => Date.now();

/** 测试注入时钟。 */
export function setOriginClock(fn: () => number): void {
  clock = fn;
}

export function clearOrigins(): void {
  slots = [];
}

function sameTarget(a: OriginTarget, b: OriginTarget): boolean {
  return (a.window ?? null) === (b.window ?? null) &&
    (a.entityType ?? null) === (b.entityType ?? null) &&
    (a.entityId ?? null) === (b.entityId ?? null) &&
    (!b.nonce || (a.nonce ?? null) === b.nonce);
}

/** 登记一次即将发生的打开/跳转来源；同一 target 多次登记以最后一次为准。 */
export function markOrigin(target: OriginTarget, origin: Origin): void {
  const now = clock();
  slots = slots.filter((s) => !(sameTarget(s, target) && s.origin === origin));
  slots.push({ ...target, origin, at: now });
  if (slots.length > 32) slots = slots.slice(-32); // 有界
}

/** 消费一次来源（一次性）；无匹配/已过期 → "unknown"。 */
export function consumeOrigin(target: OriginTarget): Origin {
  const now = clock();
  slots = slots.filter((s) => now - s.at <= TTL_MS);
  for (let i = slots.length - 1; i >= 0; i--) {
    const s = slots[i];
    if (sameTarget(s, target)) {
      const origin = s.origin;
      slots.splice(i, 1);
      return origin;
    }
  }
  return "unknown";
}

/** 取消尚未消费的来源（用户取消打开/导航失败）。 */
export function cancelOrigin(target: OriginTarget): void {
  slots = slots.filter((s) => !sameTarget(s, target));
}

export function originDebugSlots(): Array<{ origin: Origin; at: number; window?: string; entityType?: string; entityId?: string; nonce?: string }> {
  return slots.map((s) => ({ ...s }));
}
