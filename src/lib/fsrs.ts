// FSRS 调度封装（文档§1 锁定 ts-fsrs v6；§11 调度契约 v11；§11.7 参数优化 v12）
// §11.1 全量持久化：fsrs_json 含 {state,due,lapses,stability,difficulty,reps,lastReview}
// §11.2 fuzz 锁定关闭：预览值即算法真实值
// §11.3 预览与实际调度同源：preview() 一次算出四档完整结果，评分时取对应档
// §11.7 优化器：启动时读取 settings.app.fsrsWeights（由 optimizer:apply 写入）注入权重
import {
  fsrs,
  generatorParameters,
  createEmptyCard,
  type Card as FsrsCard,
  type Grade,
  type FSRSParameters
} from "ts-fsrs";

const BASE_PARAMS: FSRSParameters = generatorParameters({ enable_fuzz: false });
let engine = fsrs(BASE_PARAMS);

// 异步注入优化权重：settings 就绪后重建 engine；失败静默回退默认（调度永不阻塞）
async function initOptimizerWeights() {
  try {
    const w = (await window.settingsAPI?.get("app", "fsrsWeights")) as number[] | undefined;
    if (Array.isArray(w) && w.length === 21 && w.every((x) => typeof x === "number")) {
      engine = fsrs(generatorParameters({ enable_fuzz: false, w }));
    }
  } catch {
    /* 保持默认权重 */
  }
}
void initOptimizerWeights();

export type Rating = "Again" | "Hard" | "Good" | "Easy";

const GRADE_MAP: Record<Rating, Grade> = {
  Again: 1 as Grade,
  Hard: 2 as Grade,
  Good: 3 as Grade,
  Easy: 4 as Grade
};

// 数据库存的 fsrsJson <-> ts-fsrs Card 转换（§11.1 全字段往返）
function toFsrsCard(state: Record<string, unknown> | null | undefined): FsrsCard {
  const base = createEmptyCard();
  if (!state) return base;
  const stateMap: Record<string, FsrsCard["state"]> = {
    new: 0,
    learning: 1,
    review: 2,
    relearning: 3
  };
  return {
    ...base,
    state: stateMap[(state.state as string) ?? "new"] ?? 0,
    due: state.due ? new Date(state.due as number) : base.due,
    lapses: (state.lapses as number) ?? 0,
    // 历史卡可能缺 S/D/reps（v11 前的存量数据）：缺省时以库默认基线回填，
    // 由于历史卡调度本已失真，此回填只保证「不再二次失真」，无法还原历史
    stability: (state.stability as number) ?? base.stability,
    difficulty: (state.difficulty as number) ?? base.difficulty,
    reps: (state.reps as number) ?? 0,
    last_review: state.lastReview ? new Date(state.lastReview as number) : base.last_review
  };
}

function fromFsrsCard(card: FsrsCard) {
  const stateNames = ["new", "learning", "review", "relearning"];
  return {
    state: stateNames[card.state] ?? "new",
    due: card.due.getTime(),
    lapses: card.lapses,
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lastReview: card.last_review ? card.last_review.getTime() : null
  };
}

export const fsrsEngine = {
  // §11.3 一次计算四档完整结果；评分时复用，保证预览=落库
  preview(cardState: Record<string, unknown> | null) {
    const card = toFsrsCard(cardState);
    const now = new Date();
    const result = engine.repeat(card, now);
    return (["Again", "Hard", "Good", "Easy"] as Rating[]).map((rating) => {
      const item = result[GRADE_MAP[rating]];
      return {
        rating,
        dueText: formatInterval(item.card.due.getTime() - now.getTime()),
        // 完整落库状态（含 S/D/reps），评分时直接采用
        fsrsState: fromFsrsCard(item.card)
      };
    });
  },
  next(cardState: Record<string, unknown> | null, rating: Rating) {
    const card = toFsrsCard(cardState);
    const result = engine.repeat(card, new Date())[GRADE_MAP[rating]];
    return {
      fsrsState: fromFsrsCard(result.card),
      intervalText: formatInterval(result.card.due.getTime() - Date.now())
    };
  },
  isLeech(lapses: number, threshold: number) {
    return lapses >= threshold;
  }
};

function formatInterval(ms: number): string {
  const days = ms / 86400000;
  if (days < 1 / 24) return `${Math.max(1, Math.round(ms / 60000))} 分钟`;
  if (days < 1) return `${Math.round(days * 24)} 小时`;
  if (days < 30) return `${Math.round(days)} 天`;
  if (days < 365) return `${(days / 30).toFixed(1)} 个月`;
  return `${(days / 365).toFixed(1)} 年`;
}
