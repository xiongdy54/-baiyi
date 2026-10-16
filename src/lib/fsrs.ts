// FSRS 调度封装（文档§2 技术栈锁定 ts-fsrs v6；§4.4 调度契约 v11；§4.4.7 参数优化 v12）
// §4.4.1 全量持久化：fsrs_json 含 {state,due,lapses,stability,difficulty,reps,lastReview,learningSteps}
//   （v20/F7 补 learningSteps＝ts-fsrs 学习步进索引：缺失会使 learning 档第 2 步的 Good 永不毕业）
// §4.4.2 fuzz 锁定关闭：预览值即算法真实值
// §4.4.3 预览与实际调度同源：preview() 一次算出四档完整结果，评分时取对应档
// §4.4.7 优化器：活跃参数环境 = settings.app.fsrsConfigId 指针所指的 fsrs_configs 快照行（v23/D22 起该字段已废除，仅 initDb 一次性迁移读它）
import {
  fsrs,
  generatorParameters,
  createEmptyCard,
  type Card as FsrsCard,
  type Grade,
  type FSRSParameters
} from "ts-fsrs";
import { t } from "./i18n";

const BASE_PARAMS: FSRSParameters = generatorParameters({ enable_fuzz: false });
let engine = fsrs(BASE_PARAMS);
let activeConfigId: string | null = null;
// C-1（审计 F34）：出层再钳一次 due 用。ts-fsrs 的 next_interval 自身会把区间钳到
// maximum_interval，但 repeat() 在钳制**之后**又叠加 +1/+2 的档位修正 → 实际落库的 due
// 会越过配置值（实测 S≥5e4 时 Good→36501、Easy→36502 天，50 年正常使用的闰日链即可自然抵达）。
// §4.4.10 要求 scheduler_options 涵盖所有影响调度结果的 option，故这里必须兜住。
let activeMaxIntervalDays = 36500;

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
    activeMaxIntervalDays = typeof opts.maximumInterval === "number" && opts.maximumInterval > 0 ? opts.maximumInterval : 36500;
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
// A-2 的第二道防线（审计 F34）：即使调用方绕过队列闸门把值域非法的 state 送进来
// （单测 / 迁移脚本 / 手工改库），引擎也不该抛 —— ts-fsrs 会对 S<=0 或 D∉[1,10] 抛
// Invalid memory state，而调用点在 React 生命周期里，抛出即被根错误边界接管。
function numOr(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toFsrsCard(state: Record<string, unknown> | null | undefined): FsrsCard {
  const base = createEmptyCard();
  if (!state) return base;
  const stateMap: Record<string, FsrsCard["state"]> = {
    new: 0,
    learning: 1,
    review: 2,
    relearning: 3
  };
  const st = stateMap[(state.state as string) ?? "new"] ?? 0;
  return {
    ...base,
    state: st,
    due: state.due && Number.isFinite(Number(state.due)) ? new Date(Number(state.due)) : base.due,
    lapses: Math.max(0, numOr(state.lapses, 0)),
    // 历史卡可能缺 S/D/reps/learningSteps（v11/v20 前的存量数据）：缺省时以库默认基线回填，
    // 由于历史卡调度本已失真，此回填只保证「不再二次失真」，无法还原历史
    // 注意：**新卡的 S/D 合法为 0**（首评前），不能无条件钳进 [1,10] —— 那会把 0 变成 1
    // 并让 ts-fsrs 的新卡路径抛 Invalid memory state。只在「值存在且非法」时归一。
    // A-2 第二道防线：**新卡的 S/D 恒为 0**（首评前还没有记忆状态），一律取 base ——
    // 若按传入值钳制，一个非法 state 名会被归一成 new 却带着 D=10，ts-fsrs 会抛
    // Invalid memory state { difficulty: 10, stability: 0 }。
    // 非新卡才做值域归一：S 必须 >0、D 必须 ∈[1,10]，否则 ts-fsrs 同样会拒
    // （那类语义自相矛盾的行由 A-2 的值域闸门挡在队列外，见 F34）。
    stability:
      st === 0 || state.stability === undefined || state.stability === null
        ? base.stability
        : (() => { const v = numOr(state.stability, base.stability); return v > 0 ? v : base.stability; })(),
    difficulty:
      st === 0 || state.difficulty === undefined || state.difficulty === null
        ? base.difficulty
        : Math.min(10, Math.max(1, numOr(state.difficulty, base.difficulty))),
    reps: Math.max(0, numOr(state.reps, 0)),
    learning_steps:
      typeof state.learningSteps === "number" ? state.learningSteps : base.learning_steps,
    last_review:
      state.lastReview && Number.isFinite(Number(state.lastReview))
        ? new Date(Number(state.lastReview))
        : base.last_review
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

// A-1（审计 F34）：存量脏数据里的 lastReview 可能落在未来（时钟回拨 / 从时钟超前的机器恢复备份）。
// ts-fsrs 据此算出负 delta_t 会抛 FSRSValidationError，而调用点在 React 生命周期里
// （ReviewView 的 useEffect 与渲染期）→ 抛出即被根错误边界接管，整应用停止渲染。
// 这里把未来时间戳**钳到当前时刻**，让调度器对存量脏数据降级而非抛错（elapsed_days 取 0）。
function clampFutureTime(card: FsrsCard, at: Date): FsrsCard {
  const t = at.getTime();
  if (card.last_review && card.last_review.getTime() > t) return { ...card, last_review: at };
  return card;
}

// C-1：把超出 maximum_interval 的 due 钳回来（只动 due，不动 S/D/reps）
function clampItemDue<T extends { card: FsrsCard }>(item: T, at: Date): T {
  const maxDue = at.getTime() + activeMaxIntervalDays * 86400000;
  if (item.card.due.getTime() <= maxDue) return item;
  return { ...item, card: { ...item.card, due: new Date(maxDue) } };
}

export const fsrsEngine = {
  // §4.4.3 一次计算四档完整结果；评分时复用，保证预览=落库
  preview(cardState: Record<string, unknown> | null, now?: Date | number) {
    const card = clampFutureTime(toFsrsCard(cardState), toDate(now));
    const at = toDate(now);
    const result = engine.repeat(card, at);
    return (["Again", "Hard", "Good", "Easy"] as Rating[]).map((rating) => {
      const item = clampItemDue(result[GRADE_MAP[rating]], at);
      return {
        rating,
        dueText: formatInterval(item.card.due.getTime() - at.getTime()),
        // 完整落库状态（含 S/D/reps/learningSteps），评分时直接采用
        fsrsState: fromFsrsCard(item.card)
      };
    });
  },
  next(cardState: Record<string, unknown> | null, rating: Rating, now?: Date | number) {
    const card = clampFutureTime(toFsrsCard(cardState), toDate(now));
    const at = toDate(now);
    const result = clampItemDue(engine.repeat(card, at)[GRADE_MAP[rating]], at);
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
  if (days < 1 / 24) return t("{n} 分钟", { n: Math.max(1, Math.round(ms / 60000)) });
  if (days < 1) return t("{n} 小时", { n: Math.round(days * 24) });
  if (days < 30) return t("{n} 天", { n: Math.round(days) });
  if (days < 365) return t("{n} 个月", { n: (days / 30).toFixed(1) });
  return t("{n} 年", { n: (days / 365).toFixed(1) });
}
