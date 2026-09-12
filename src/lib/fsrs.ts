// FSRS 调度封装（文档§2 技术栈锁定 ts-fsrs v6；§4.4 调度契约 v11；§4.4.7 参数优化 v12）
// §4.4.1 全量持久化：fsrs_json 含 {state,due,lapses,stability,difficulty,reps,lastReview,learningSteps}
//   （v20/F7 补 learningSteps＝ts-fsrs 学习步进索引：缺失会使 learning 档第 2 步的 Good 永不毕业）
// §4.4.2 fuzz 锁定关闭：预览值即算法真实值
// §4.4.3 预览与实际调度同源：preview() 一次算出四档完整结果，评分时取对应档
// §4.4.7 优化器：启动时读取 settings.app.fsrsWeights（由 optimizer:apply 写入）注入权重
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
let activeConfigId: string | null = null;

interface FsrsConfigSnapshot {
  id?: string;
  weights?: unknown;
  schedulerOptions?: Record<string, unknown> | null;
}

// 由完整配置快照构建引擎（§4.4.10）：校验锁定项（§4.4.2 enable_fuzz 必须为 false，非法/被篡改配置
// 拒绝应用并回退默认权重引擎——被篡改的快照不得破坏确定性调度契约）
function buildEngineFromConfig(cfg: FsrsConfigSnapshot | null | undefined): boolean {
  try {
    const w = cfg?.weights;
    const opts = (cfg?.schedulerOptions ?? {}) as Record<string, unknown>;
    if (!Array.isArray(w) || w.length !== 21 || !w.every((x) => typeof x === "number" && Number.isFinite(x))) {
      return false;
    }
    if (opts.enableFuzz !== false) return false;
    const params = generatorParameters({
      enable_fuzz: false,
      w: w as number[],
      request_retention: typeof opts.requestRetention === "number" ? opts.requestRetention : undefined,
      maximum_interval: typeof opts.maximumInterval === "number" ? opts.maximumInterval : undefined,
      enable_short_term: typeof opts.enableShortTerm === "boolean" ? opts.enableShortTerm : undefined,
      learning_steps: Array.isArray(opts.learningSteps) ? (opts.learningSteps as unknown as FSRSParameters["learning_steps"]) : undefined,
      relearning_steps: Array.isArray(opts.relearningSteps) ? (opts.relearningSteps as unknown as FSRSParameters["relearning_steps"]) : undefined
    });
    engine = fsrs(params);
    activeConfigId = cfg?.id ?? null;
    return true;
  } catch {
    return false;
  }
}

// F9 热生效（v23，§4.4.9/§4.4.10）：从主进程事实层拉取活跃配置并重建引擎。
// configId 未变 → 不重建（避免无谓状态替换）；失败静默保持现有引擎（调度永不阻塞）。
async function reloadEngine(): Promise<boolean> {
  try {
    const cfg = (await window.fsrsAPI?.getActiveConfig()) as FsrsConfigSnapshot | undefined | null;
    if (!cfg) return false;
    if (cfg.id !== undefined && cfg.id === activeConfigId) return false;
    return buildEngineFromConfig(cfg);
  } catch {
    return false;
  }
}

void reloadEngine();
// 订阅主进程事实层推送（apply/reset 提交成功后 fsrs:configChanged）——事件由配置写入层发出，UI 不参与
if (typeof window !== "undefined" && window.fsrsAPI?.onConfigChanged) {
  window.fsrsAPI.onConfigChanged(() => {
    void reloadEngine();
  });
}

export type Rating = "Again" | "Hard" | "Good" | "Easy";

const GRADE_MAP: Record<Rating, Grade> = {
  Again: 1 as Grade,
  Hard: 2 as Grade,
  Good: 3 as Grade,
  Easy: 4 as Grade
};

// 可选时间注入（§4.4.3 v20）：缺省取真实时间，M3 时间轴模拟注入显式 now
function toDate(now?: Date | number): Date {
  if (now == null) return new Date();
  return now instanceof Date ? now : new Date(now);
}

// 数据库存的 fsrsJson <-> ts-fsrs Card 转换（§4.4.1 全字段往返）
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
    // 历史卡可能缺 S/D/reps/learningSteps（v11/v20 前的存量数据）：缺省时以库默认基线回填，
    // 由于历史卡调度本已失真，此回填只保证「不再二次失真」，无法还原历史
    stability: (state.stability as number) ?? base.stability,
    difficulty: (state.difficulty as number) ?? base.difficulty,
    reps: (state.reps as number) ?? 0,
    learning_steps:
      typeof state.learningSteps === "number" ? state.learningSteps : base.learning_steps,
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
    learningSteps: card.learning_steps ?? 0,
    lastReview: card.last_review ? card.last_review.getTime() : null
  };
}

export const fsrsEngine = {
  // §4.4.3 一次计算四档完整结果；评分时复用，保证预览=落库
  preview(cardState: Record<string, unknown> | null, now?: Date | number) {
    const card = toFsrsCard(cardState);
    const at = toDate(now);
    const result = engine.repeat(card, at);
    return (["Again", "Hard", "Good", "Easy"] as Rating[]).map((rating) => {
      const item = result[GRADE_MAP[rating]];
      return {
        rating,
        dueText: formatInterval(item.card.due.getTime() - at.getTime()),
        // 完整落库状态（含 S/D/reps/learningSteps），评分时直接采用
        fsrsState: fromFsrsCard(item.card)
      };
    });
  },
  next(cardState: Record<string, unknown> | null, rating: Rating, now?: Date | number) {
    const card = toFsrsCard(cardState);
    const at = toDate(now);
    const result = engine.repeat(card, at)[GRADE_MAP[rating]];
    return {
      fsrsState: fromFsrsCard(result.card),
      intervalText: formatInterval(result.card.due.getTime() - at.getTime())
    };
  },
  isLeech(lapses: number, threshold: number) {
    return lapses >= threshold;
  },
  // v23 测试/调试接口：当前引擎所属配置 id 与手动热重载（F9 断言用）
  activeConfigId: () => activeConfigId,
  reloadEngine: () => reloadEngine()
};

function formatInterval(ms: number): string {
  const days = ms / 86400000;
  if (days < 1 / 24) return `${Math.max(1, Math.round(ms / 60000))} 分钟`;
  if (days < 1) return `${Math.round(days * 24)} 小时`;
  if (days < 30) return `${Math.round(days)} 天`;
  if (days < 365) return `${(days / 30).toFixed(1)} 个月`;
  return `${(days / 365).toFixed(1)} 年`;
}
