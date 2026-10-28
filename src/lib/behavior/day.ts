// BDI（D248 / T6）：学习日纯函数——与 electron/fsrsTime.js 逐时点同口径（DST 安全）。
// 只做本地钟面平移；禁止进入 FSRS 调度（§4.4.8 边界）。
export function learningDayIndex(ms: number, cutoffHour = 0): number {
  const d = new Date(ms);
  const localWall = ms - d.getTimezoneOffset() * 60000;
  return Math.floor((localWall - cutoffHour * 3600000) / 86400000);
}

export function learningDayStartMs(ms: number, cutoffHour = 0): number {
  const idx = learningDayIndex(ms, cutoffHour);
  const base = idx * 86400000 + cutoffHour * 3600000;
  let guess = base + new Date(ms).getTimezoneOffset() * 60000;
  for (let i = 0; i < 4; i++) {
    const off = new Date(guess).getTimezoneOffset() * 60000;
    const next = base + off;
    if (next === guess) break;
    guess = next;
  }
  if (learningDayIndex(guess, cutoffHour) !== idx) {
    for (const delta of [3600000, -3600000, 7200000, -7200000, 10800000, -10800000]) {
      const cand = guess + delta;
      if (learningDayIndex(cand, cutoffHour) === idx) { guess = cand; break; }
    }
  }
  return guess;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 学习日标签 'YYYY-MM-DD'（取学习日起点所在本地日期）。 */
export function dayString(ms: number, cutoffHour = 0): string {
  const d = new Date(learningDayStartMs(ms, cutoffHour));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 本地时区偏移（分钟，与 -getTimezoneOffset() 同口径）。 */
export function tzOffsetMinutes(ms: number): number {
  return -new Date(ms).getTimezoneOffset();
}
