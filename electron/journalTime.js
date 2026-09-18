// 日记自然日（v36，M8-A，§4.1/§6.5.2，决策 D34）——零依赖纯函数，可独立测试（与 fsrsTime.js 同构）。
//
// 「当天的日记」按**本地钟面自然日 00:00** 切，**不随学习日切点（settings.app.dayCutoffHour）漂移**：
// 学习日是统计数据口径（D23），可被用户随时调整；日记是事实记录——归属若随设置变化漂移，
// 用户改一次设置就会让历史条目集体换天（用户 2026-09-14 拍板）。将来若需要「学习日视图」，
// 由 entry_date + created_at 派生计算，不反向写库。
//
// 边界固定为本地时区钟面：00:00:00.000 属新一天，23:59:59.999 属旧一天；跨月/跨年由 Date 归一化处理。

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

// 某时刻所属自然日 'YYYY-MM-DD'（本地时区钟面）
function journalDateOf(ms) {
  const d = new Date(Number(ms));
  if (!Number.isFinite(d.getTime())) throw new Error("journalDateOf: 非法时间戳");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 'YYYY-MM-DD' 合法性（含真实日历校验：2026-02-30 非法）
function isJournalDate(value) {
  const s = String(value ?? "");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const probe = new Date(y, mo - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === mo - 1 && probe.getDate() === d;
}

// 'YYYY-MM-DD' 加减天数（用于「回到今天」/日期轴等展示派生；非法输入返回 null）
function journalDateAddDays(dateStr, days) {
  if (!isJournalDate(dateStr)) return null;
  const [y, mo, d] = String(dateStr).split("-").map(Number);
  const base = new Date(y, mo - 1, d);
  base.setDate(base.getDate() + Number(days || 0));
  return journalDateOf(base.getTime());
}

module.exports = { journalDateOf, isJournalDate, journalDateAddDays };
