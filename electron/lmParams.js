"use strict";
// D124 学习者模型参数（LM-1）。改任何数值都必须 bump PARAM_VERSION 并在指导文档 §4.20 记录。
module.exports = Object.freeze({
  LM_VERSION: "LM-1",
  PARAM_VERSION: 1,
  LEARNER_DB_SCHEMA: 1,
  SEG_VERSION: 1,
  LEX_VERSION: 1,
  DAY_MS: 86400000,
  UNIT_MIN_CHARS: 1500,
  UNIT_TARGET_CHARS: 3000,
  UNIT_MAX_CHARS: 6000,
  SESSION_GAP_MS: 30 * 60 * 1000,
  JUMP_CHARS: 20000,
  END_RATIO: 0.97,
  PDF_JUMP_PAGES: 30,
  FREQ_STOP_TOP: 50,          // 无停用词表的语言：频次前 50 的词项视同停用词（设计稿 §6.2）
  LANG_VOTE_MIN: 5,           // detectLang 拉丁语言停用词投票的最低票数（设计稿 §6.2）
  FSRS_DEFAULT_DECAY: 0.1542,
  KP: { STABLE_S: 21, LONG_S: 60, R_CONSOL: 0.85, R_SOLID: 0.90, R_FADING: 0.75,
        STABLE_RATIO: 0.5, LONG_RATIO: 0.6, LAPSE_WINDOW_DAYS: 30, SELF_EXPLAIN_WINDOW_DAYS: 90,
        STUCK_R: 0.8, STUCK_LAPSES: 2 },
  LEX: { FAMILIAR_PASSES: 3, FAMILIAR_TOKENS: 8, POST_LOOKUP_PASSES: 5, POST_LOOKUP_DAYS: 14,
         CARD_KNOWN_S: 21, CARD_KNOWN_R: 0.85, COLD_START_KNOWN: 200, PLACEMENT_MIN_LEXEMES: 300 },
  BANDS: { EASY: 0.98, OPTIMAL: 0.95, INTENSIVE: 0.90 },
  BAND_FIT: { easy: 0.7, optimal: 1.0, intensive: 0.6, hard: 0 },
  READ_SPEED: { cjk: 400, other: 1000 }, // cjk = zh ja ko 及 LANG_PROFILE.spaced=false 的语言
  REREAD_INTERVALS_DAYS: [3, 7, 16, 35, 75],
  REREAD_MIN_LEARNING: 5,
  REREAD_MAX_PASSES: 6,
  NOVELTY_TARGET: 0.3,
  READINESS_BLOCK: 0.4,
  READINESS_EMPTY: 0.7,
  READY_SCORE: 0.6,
  TRACK: { WINDOW_DAYS: 28, HALF_LIFE_DAYS: 14, PINNED_MIN_SHARE: 0.3 },
  REC: {
    DEFAULT_COUNT: 6, MIN_COUNT: 3, MAX_COUNT: 10, MAX_PER_KIND: 2, MAX_PER_MATERIAL: 2,
    W: { fit: 0.35, value: 0.25, urgency: 0.15, momentum: 0.15, priority: 0.10 },
    KIND_PRIOR: { continue: 1.0, start: 0.85, "extract-batch": 0.95, "extract-to-card": 0.8,
                  reinforce: 0.9, "cross-material": 0.7, "self-explain": 0.75, practice: 0.85,
                  "find-material": 0.6, reread: 0.9, "context-reel": 0.8, "sentence-mine": 0.8 },
    NOT_INTERESTED_DECAY: 0.7, NOT_INTERESTED_FLOOR: 0.3,
    DONE_COOLDOWN_H: 12, SNOOZE_DAYS: 3, DISMISS_DAYS: 3, NOT_INTERESTED_DAYS: 60,
    FEEDBACK_WINDOW_DAYS: 90, BAND_SHIFT_STEP: 0.01, BAND_SHIFT_MAX: 0.03,
    NOVELTY_SHIFT_STEP: 0.05, NOVELTY_SHIFT_MAX: 0.15, AUTO_DONE_WINDOW_DAYS: 7,
    STALE_MS: 10 * 60 * 1000, RUNS_KEEP: 300
  }
});
