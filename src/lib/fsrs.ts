// FSRS 调度封装（文档§1 锁定 ts-fsrs v6）
import {
  fsrs,
  generatorParameters,
  createEmptyCard,
  type Card as FsrsCard,
  type Grade,
  type FSRSParameters
} from "ts-fsrs";

const params: FSRSParameters = generatorParameters({ enable_fuzz: true });
const engine = fsrs(params);

export type Rating = "Again" | "Hard" | "Good" | "Easy";

const GRADE_MAP: Record<Rating, Grade> = {
  Again: 1 as Grade,
  Hard: 2 as Grade,
  Good: 3 as Grade,
  Easy: 4 as Grade
};

// 数据库存的 fsrsJson <-> ts-fsrs Card 转换
function toFsrsCard(state: { state?: string; due?: number; lapses?: number } | null | undefined): FsrsCard {
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
    state: stateMap[state.state ?? "new"] ?? 0,
    due: state.due ? new Date(state.due) : base.due,
    lapses: state.lapses ?? 0
  };
}

function fromFsrsCard(card: FsrsCard) {
  const stateNames = ["new", "learning", "review", "relearning"];
  return {
    state: stateNames[card.state] ?? "new",
    due: card.due.getTime(),
    lapses: card.lapses,
    lastReview: card.last_review ? card.last_review.getTime() : null
  };
}

export const fsrsEngine = {
  preview(cardState: { state?: string; due?: number; lapses?: number } | null) {
    const card = toFsrsCard(cardState);
    const now = new Date();
    const result = engine.repeat(card, now);
    return (["Again", "Hard", "Good", "Easy"] as Rating[]).map((rating) => {
      const item = result[GRADE_MAP[rating]];
      return {
        rating,
        dueText: formatInterval(item.card.due.getTime() - now.getTime())
      };
    });
  },
  next(cardState: { state?: string; due?: number; lapses?: number } | null, rating: Rating) {
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
