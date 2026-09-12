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
function learningDayStartMs(ms, cutoffHour = 0) {
  return (
    learningDayIndex(ms, cutoffHour) * 86400000 +
    cutoffHour * 3600000 +
    new Date(ms).getTimezoneOffset() * 60000
  );
}

module.exports = { calculateFsrsDeltaT, learningDayIndex, learningDayStartMs };
