// v48.61（D104，D94 设计稿 §3.5）：卡面信息密度设置键 `app.cardFaceExtras` 的读侧归一。
// 三开关（mnemonic 助记 / example 例子 / sourceRef 来源）——纯显示开关：关闭即不渲染对应块，
// 不改卡内数据、不影响 CardLint。主进程 settings:set 写侧（electron/main.js）与这里同规（双侧归一）。
// 可被 esbuild 打包进 F18 真模块矩阵（禁 window/IPC 依赖）。

export interface CardFaceExtras {
  mnemonic: boolean;
  example: boolean;
  sourceRef: boolean;
}

export const CARD_FACE_EXTRAS_KEYS = ["mnemonic", "example", "sourceRef"] as const;

export const DEFAULT_CARD_FACE_EXTRAS: CardFaceExtras = { mnemonic: true, example: true, sourceRef: true };

/**
 * 归一：对象逐键取值——仅严格 true 为真，其余（false/缺失/非法类型）回落 true（默认全开）。
 * 非对象输入整体回落默认（脏值不落盘显示半态）。与写侧保持同一规则。
 */
export function normalizeCardFaceExtras(v: unknown): CardFaceExtras {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ...DEFAULT_CARD_FACE_EXTRAS };
  const src = v as Record<string, unknown>;
  return {
    mnemonic: src.mnemonic === false ? false : true,
    example: src.example === false ? false : true,
    sourceRef: src.sourceRef === false ? false : true
  };
}
