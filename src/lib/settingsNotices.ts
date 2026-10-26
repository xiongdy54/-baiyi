// 设置页置顶通知框的数据合成（v49.32 / D206）：输入全部是渲染层已取得的 IPC 快照纯数据，
// 输出待告知条目列表（无待告知内容 = 空数组，组件层据此零 DOM）。文案与样式在组件层，
// 本模块不依赖 i18n / window / electron，可独立单测。

export type SettingsNoticeLevel = "info" | "warn" | "error";
export type SettingsNoticeKind =
  | "update" // 绿：发现可用更新
  | "update-ready" // 绿：更新包已下载就绪
  | "update-error" // 红：更新检查出错
  | "backup-failed" // 红：最近一次自动备份失败
  | "backup-integrity" // 红：主库快照完整性检查发现问题，旧备份轮换已暂停（C-23）
  | "clock-skew" // 黄：系统时钟疑似被回拨（C-14 探测位）
  | "backup-none" // 黄：还没有任何备份
  | "backup-stale"; // 黄：超过阈值天数没有备份

export interface SettingsNotice {
  level: SettingsNoticeLevel;
  kind: SettingsNoticeKind;
  params?: Record<string, string | number>;
}

export const BACKUP_STALE_DAYS = 7;
const DAY_MS = 86_400_000;

export interface SettingsNoticesInput {
  /** update:status 快照的 state（github 渠道的状态机；store/dev/unconfigured/unsupported 不产通知） */
  updateState?: string | null;
  updateVersion?: string | null;
  updateError?: string | null;
  /** backup:list 里最新一份备份的 createdAt；一份备份都没有 → null */
  latestBackupAt?: number | null;
  /**
   * D235：backup:info 的 clockSkew（时钟回拨现场探测，每次现取）：备份目录里修改时间晚于「当前 + 1 天」的
   * 本软件备份份数与最晚时间。提供时以它为准（现场消除即不再提示）；未提供时回落 lastAuto.clockSkewSuspected。
   */
  clockSkew?: { suspected?: boolean; count?: number; latestAt?: number | null } | null;
  /** backup:info 的 lastAuto（最近一次启动期自动备份的结局；本轮还没跑过 → null） */
  lastAuto?: {
    ok?: boolean;
    error?: string | null;
    clockSkewSuspected?: boolean;
    /** C-23：主库快照 quick_check 不通过（true = 已暂停删除旧备份，需用户介入） */
    integrityWarning?: boolean;
  } | null;
  now?: number;
}

const LEVEL_ORDER: Record<SettingsNoticeLevel, number> = { error: 0, warn: 1, info: 2 };

/**
 * D235：「最近一次备份时间」——排除建于「未来」（晚于当前 + 1 天，时钟回拨遗留）的备份，否则
 * 未来时间会让「已 N 天没有备份」永远不触发。返回值语义对应 SettingsNoticesInput.latestBackupAt：
 * 一份备份都没有 → null（产 backup-none）；有备份但全部建于未来 → undefined（不判定新旧，交给 clock-skew 提示）。
 */
export function latestSaneBackupAt(createdAts: readonly number[], now: number = Date.now()): number | null | undefined {
  if (createdAts.length === 0) return null;
  let best: number | undefined;
  for (const t of createdAts) {
    if (!Number.isFinite(t) || t > now + DAY_MS) continue;
    if (best === undefined || t > best) best = t;
  }
  return best;
}

export function computeSettingsNotices(input: SettingsNoticesInput): SettingsNotice[] {
  const now = input.now ?? Date.now();
  const out: SettingsNotice[] = [];
  if (input.updateState === "available") {
    out.push({ level: "info", kind: "update", params: { version: input.updateVersion ?? "?" } });
  } else if (input.updateState === "downloaded") {
    out.push({ level: "info", kind: "update-ready", params: { version: input.updateVersion ?? "?" } });
  } else if (input.updateState === "error") {
    out.push({ level: "error", kind: "update-error", params: { msg: input.updateError ?? "" } });
  }
  const lastAuto = input.lastAuto;
  if (lastAuto && lastAuto.ok === false) {
    out.push({ level: "error", kind: "backup-failed", params: { msg: lastAuto.error ?? "" } });
  }
  // C-23：备份本体成功但主库快照 quick_check 不通过——轮换已暂停，此时备份是唯一自救途径
  if (lastAuto?.integrityWarning) out.push({ level: "error", kind: "backup-integrity" });
  // D235：时钟回拨——现场探测优先（带份数 / 最晚时间，组件层据此给可核对的说明）；无现场数据才用启动期标记
  const skew = input.clockSkew;
  if (skew) {
    if (skew.suspected && (skew.count ?? 0) > 0) {
      out.push({ level: "warn", kind: "clock-skew", params: { count: skew.count ?? 0, latestAt: skew.latestAt ?? 0 } });
    }
  } else if (lastAuto?.clockSkewSuspected) {
    out.push({ level: "warn", kind: "clock-skew" });
  }
  // 「未提供」（没查过备份列表）与「明确为 null」（查了、确实一份都没有）语义不同：前者不产通知
  if (input.latestBackupAt === null) {
    out.push({ level: "warn", kind: "backup-none" });
  } else if (input.latestBackupAt != null) {
    const days = Math.floor((now - input.latestBackupAt) / DAY_MS);
    if (days >= BACKUP_STALE_DAYS) {
      out.push({ level: "warn", kind: "backup-stale", params: { days } });
    }
  }
  return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}
