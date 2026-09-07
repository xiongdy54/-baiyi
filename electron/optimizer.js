// FSRS 参数优化器（v12）— 集成 open-spaced-repetition/fsrs-rs-nodejs
// 从 review_logs + cards 构建时序复习序列，训练个性化权重；应用/重置走 settings.json
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { FSRS, FSRSItem, FSRSReview } = require("fsrs-rs-nodejs");

const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeSettings(all) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(all, null, 2), "utf-8");
}

// 最低数据门槛：官方建议 400+ 条复习记录；低于此值训练不可靠（仍允许跑，UI 提示）
const MIN_RECOMMENDED_REVIEWS = 400;

const DAY_MS = 86400000;

// 从 review_logs 构建每卡时序序列 → FSRSItem[]
// rating 映射：Again=1 Hard=2 Good=3 Easy=4（与应用存储一致，无需转换）
// delta_t = 与上一条复习的间隔天数（向下取整，首条为 0）
function buildTrainSet(db) {
  const cards = db.listAllCards();
  const logsByCard = new Map();
  for (const card of cards) {
    logsByCard.set(card.id, []);
  }
  // review_logs 无 listAll 接口——用 db 内部导出的 queryAll 不可行，逐卡查询太慢；
  // 这里在 db.js 增加辅助（见 main.js 接线），当前通过 cards 表 review 顺序重建：
  // review_logs 表按 reviewed_at 排序即可。
  const allLogs = db.listAllReviewLogs();
  for (const log of allLogs) {
    const arr = logsByCard.get(log.cardId);
    if (arr) arr.push(log);
  }
  const items = [];
  let reviewCount = 0;
  let cardCount = 0;
  const RATING_MAP = { Again: 1, Hard: 2, Good: 3, Easy: 4 };
  for (const logs of logsByCard.values()) {
    if (logs.length === 0) continue;
    logs.sort((a, b) => a.reviewedAt - b.reviewedAt);
    const reviews = [];
    let prevAt = null;
    for (const log of logs) {
      const rating = RATING_MAP[log.rating];
      if (!rating) continue;
      const deltaT = prevAt === null ? 0 : Math.max(0, Math.floor((log.reviewedAt - prevAt) / DAY_MS));
      reviews.push(new FSRSReview(rating, deltaT));
      prevAt = log.reviewedAt;
      reviewCount++;
    }
    // FSRSItem 要求「每条复习一个实例、携带此前全部历史」，且至少含一条 delta_t>0 的复习
    // （fsrs-rs dataset.rs：全零间隔序列会 panic）——单次复习或全同日复习的卡跳过
    if (reviews.length < 2) continue;
    const hasGap = reviews.some((r, i) => i > 0 && r.deltaT > 0);
    if (!hasGap) continue;
    for (let i = 1; i < reviews.length; i++) {
      // 每个前缀子序列也必须含 delta_t>0（首条 delta_t 恒为 0，从 i=1 起的前缀含 reviews[1]）
      const prefix = reviews.slice(0, i + 1);
      if (!prefix.some((r, j) => j > 0 && r.deltaT > 0)) continue;
      items.push(new FSRSItem(prefix));
    }
    cardCount++;
  }
  return { items, reviewCount, cardCount };
}

function getOptimizerStats(db) {
  const { reviewCount, cardCount } = buildTrainSet(db);
  return {
    reviewCount,
    cardCount,
    minRecommended: MIN_RECOMMENDED_REVIEWS,
    enough: reviewCount >= MIN_RECOMMENDED_REVIEWS
  };
}

async function train(db, onProgress) {
  const { items, reviewCount, cardCount } = buildTrainSet(db);
  if (items.length === 0) {
    throw new Error("暂无复习记录，无法优化。先复习一些卡片吧。");
  }
  const f = new FSRS([]);
  const weights = await f.computeParameters(items, {
    numEpochs: items.length >= 1000 ? 25 : 10,
    progress: onProgress
      ? (_err, value) => onProgress(value)
      : undefined
  });
  const evaluation = f.evaluate(items);
  return {
    weights,
    reviewCount,
    cardCount,
    logLoss: evaluation.logLoss,
    rmseBins: evaluation.rmseBins
  };
}

function getAppliedWeights() {
  const s = readSettings();
  const w = s.app && s.app.fsrsWeights;
  return Array.isArray(w) && w.length === 21 ? w : null;
}

function applyWeights(weights) {
  if (!Array.isArray(weights) || weights.length !== 21) {
    throw new Error("权重格式错误：需要 21 个数值");
  }
  const s = readSettings();
  if (!s.app) s.app = {};
  s.app.fsrsWeights = weights.map(Number);
  writeSettings(s);
  return true;
}

function resetWeights() {
  const s = readSettings();
  if (s.app) delete s.app.fsrsWeights;
  writeSettings(s);
  return true;
}

module.exports = {
  MIN_RECOMMENDED_REVIEWS,
  buildTrainSet,
  getOptimizerStats,
  train,
  getAppliedWeights,
  applyWeights,
  resetWeights
};
