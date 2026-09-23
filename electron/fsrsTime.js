// FSRS 时间语义层（v23，§4.4.8/§4.4.11）——优化器 delta_t 唯一出口 + 产品学习日（仅统计）。
// calculateFsrsDeltaT 是「锁定版本 ts-fsrs 5.4.2 时间语义的复刻，非 FSRS 永久规范」：
// 复刻对象 = ts-fsrs AbstractScheduler.init 的 dateDiffInDays(last_review, review_time)——
// 两个 UTC 日历日（Date.UTC(y,m,d)）之差，与调度器 elapsed_days 精确同语义。
// 本文件独立实现、绝不 import ts-fsrs（§4.4.11 边界）；L6-A 用 repeat().log.elapsed_days
// 做行为级 oracle：依赖升级若改变日语义，L6-A 红灯 = 触发重新审计（预期绊线，非缺陷）。
// learningDayIndex/learningDayStartMs 是产品学习日（D21，本地钟面日切点），仅供统计口径，
// 禁止进入 FSRS 调度与训练。

// 某时刻所属的 UTC 日历日序号（自 epoch 起的天数）
function utcCalendarDay(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000;
}

// canonical delta_t：与调度器 elapsed_days 同语义（UTC 日历日差，可为负，调用方钳制/首评恒 0）
function calculateFsrsDeltaT(prevMs, curMs) {
  return utcCalendarDay(curMs) - utcCalendarDay(prevMs);
}

// 产品学习日序号：本地钟面按切点平移后的绝对日序。
// cutoffHour=0 即本地自然日；cutoffHour=4 时本地 0:00-4:00 仍属前一学习日（D21）。
function learningDayIndex(ms, cutoffHour = 0) {
  const d = new Date(ms);
  const localWall = ms - d.getTimezoneOffset() * 60000; // 本地钟面（平移为伪 UTC 表示）
  return Math.floor((localWall - cutoffHour * 3600000) / 86400000);
}

// 该时刻所属学习日的起点（本地 cutoff 点）
// B-4（审计 F34）：原实现用「传入时刻 ms 的时区偏移」去还原日界，在 DST 切换日会失效 ——
// 春进那天日切点落进被跳过的那一小时，于是 learningDayIndex(learningDayStartMs(t)) !== learningDayIndex(t)，
// 日桶凭空错位（实测 TZ=America/New_York 下 2026-03-09 复现，cutoff 0/1/2 三档全中）。
// 改为**迭代求不动点**：用候选时刻自身的偏移而不是 ms 的偏移，让返回的时刻真正落回同一学习日。
function learningDayStartMs(ms, cutoffHour = 0) {
  const idx = learningDayIndex(ms, cutoffHour);
  const base = idx * 86400000 + cutoffHour * 3600000;
  let guess = base + new Date(ms).getTimezoneOffset() * 60000;
  for (let i = 0; i < 4; i++) {
    const off = new Date(guess).getTimezoneOffset() * 60000;
    const next = base + off;
    if (next === guess) break;
    guess = next;
  }
  // 春进日 corner case：cutoff 落在**被跳过的那一小时**（如 America/New_York 3 月 2:00→3:00）时，
  // 本地根本不存在 02:00，迭代没有精确解、可能落到相邻学习日。此时在候选附近搜一个仍属 idx 的时刻 ——
  // 契约要的是「返回的时刻属于该学习日」，而不是「本地钟面正好等于 cutoff」。
  if (learningDayIndex(guess, cutoffHour) !== idx) {
    for (const delta of [3600000, -3600000, 7200000, -7200000, 10800000, -10800000]) {
      const cand = guess + delta;
      if (learningDayIndex(cand, cutoffHour) === idx) { guess = cand; break; }
    }
  }
  return guess;
}

module.exports = { calculateFsrsDeltaT, learningDayIndex, learningDayStartMs };
