// v48.85（D129，B1）：§6.6.1 正反馈分级总表的**文案模板唯一实现**（keyed by 事件类型；插值参数化）。
// 契约：设计稿 §2「文案只在 growthStrings.ts」+ §6.6.1（文案与优先级的唯一事实来源，禁自行发明文案）。
// 措辞分层（D36③）：记忆层事件只说记忆语言（卡片 / 间隔 / 复习节奏）；禁「掌握 +1」「你已掌握」（§4.7-6）。
// 取消项占位说明（§6.6.1 序 13/14，用户 2026-09-15 判定，**禁加回**）：
//   "consolidate-21d"（单卡巩固 21 天）与 "learning-graduate"（学习步毕业）**不是** GrowthEventType 枚举
//   成员——判定函数（electron/growth.js）显式不产事件，故本表无其条目；此处仅登记占位，防止未来实现者
//   「顺手补表加回」。同理本文件也不提供其任何文案。
import type { GrowthEventHit, GrowthEventType, GrowthTerritoryRow, GrowthTotals } from "./growth";
// v49.8（D182）：成长反馈文案随界面语言
import { t } from "./i18n";

type Hit = GrowthEventHit;

// tier 标签（§6.6.1 级别列；汇总行 tier 标签用文字不用颜色——设计稿 §5.2 样式纪律）
export function growthTierLabel(tier: Hit["tier"]): string {
  return t({ 0: "能力", 1: "结构", 2: "建制", 3: "次要" }[tier] ?? "");
}

// 材料名：书维 = evidence.docTitle（书名）；领域维 = entityLabel（UDC 主领域码，无书名可回补）
function materialName(h: Hit): string {
  return String(h.evidence.docTitle || h.entityLabel || "");
}

// —— §6.6.1 文案列（示例即定稿，D129-G4 随稿登记；插值参数 = hit 的结构化字段） ——
// 12 个键 ≡ 12 个事件类型（B1 验收：文案表键集合 ≡ §6.6.1 的 12 个 type）。
const GROWTH_EVENT_TEMPLATES: Record<GrowthEventType, (h: Hit) => string> = {
  // —— L0 能力（GF-2 预留：类型在场、判定阻塞于缺口 G1，出现即按表渲染） ——
  "transfer-first": (h) => t("首次迁移成功：你把『{name}』用到了新情境里", { name: h.entityLabel }),
  "application-first": (h) => t("首次应用成功：你用『{name}』解决了一个实际问题", { name: h.entityLabel }),
  "kp-strong": (h) => t("『{name}』达到 strong：能回忆、能讲清、能应用", { name: h.entityLabel }),
  "kp-functional": (h) => t("『{name}』达到 functional：第一次能脱离提示讲清楚", { name: h.entityLabel }),
  // —— L1 结构（GF-2 预留） ——
  "structure-link": (h) => t("你确认了一条跨领域连接：『{name}』", { name: h.entityLabel }),
  "domain-entry": (h) => t("开始进入新领域：{name}", { name: h.entityLabel }),
  // —— L2 建制（GF-1） ——
  "material": (h) => {
    const name = materialName(h);
    return h.evidence.docTitle
      ? (h.dimension === "full" ? t("《{name}》已全部进入长期记忆", { name }) : t("《{name}》已过半进入长期记忆", { name }))
      : (h.dimension === "full" ? t("领域「{name}」已全部进入长期记忆", { name }) : t("领域「{name}」已过半进入长期记忆", { name }));
  },
  "group": (h) => t("这一组 {n} 张卡全部进入长期复习", { n: h.evidence.groupSize ?? h.entityLabel }),
  "leech-recovery": () => t("那张总记不住的卡稳住了"),
  "relearning-recovery": () => t("这张卡遗忘后又回来了"),
  "retention-180": () => t("这张卡半年不用复习了"),
  "retention-60": () => t("这张卡进入 60 天档")
};

// 事件主文案（提示条 / 会话汇总 / 成长记录共用同一模板——三消费端零第二套文案，§2 消费端隔离）
export function growthEventText(h: Hit): string {
  const tpl = GROWTH_EVENT_TEMPLATES[h.type];
  return tpl ? tpl(h) : "";
}

// L2 单日折叠行文案（§4.17-6⑤ 契约原文示例：「今天另有 3 张卡进入长期维持」）
export function growthFoldText(count: number): string {
  return t("今天另有 {n} 张卡进入长期维持", { n: count });
}

// 证据链 mono 摘要行（§5.1 detail / §5.2 行内「证据」展开共用；可追溯 §4.17-4③）
export function growthEvidenceLines(h: Hit): string[] {
  const lines: string[] = [];
  const fronts = h.evidence.cardFronts ?? [];
  for (const f of fronts.slice(0, 4)) lines.push(t("卡面：{text}", { text: f }));
  if (h.evidence.groupSize != null) lines.push(t("组内 {n} 张卡", { n: h.evidence.groupSize }));
  if (h.evidence.docTitle) lines.push(t("来源：《{name}》", { name: h.evidence.docTitle }));
  if (h.evidence.stabilityDays != null) lines.push(t("稳定度 {n} 天", { n: Math.round(h.evidence.stabilityDays) }));
  if (h.evidence.lapses != null) lines.push(t("遗忘 {n} 次", { n: h.evidence.lapses }));
  if (h.evidence.documentId && h.evidence.anchorText) lines.push(t("原文锚：{text}", { text: String(h.evidence.anchorText).slice(0, 24) }));
  return lines;
}

// ---------- 仪表盘 growth-events widget（§5.3） ----------

export function growthRecordsEmptyText(): string {
  return t("暂无成长记录——完成复习后，真实的跨越会出现在这里。");
}

// 头部计数（§5.3：`L0 能力 N · L1 结构 N · L2 建制 N`，mono meta）
export function growthTotalsText(t2: GrowthTotals): string {
  return t("L0 能力 {l0} · L1 结构 {l1} · L2 建制 {l2}", { l0: t2.l0, l1: t2.l1, l2: t2.l2 });
}

// 行首日期（设计稿示例「09-14」；记录 ts = triggerAt）
export function growthRecordDate(ts: number): string {
  const d = new Date(Number(ts));
  if (!Number.isFinite(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 行尾来源（书名《XX》/ 领域码；无来源给空串）
export function growthRecordSource(h: Hit): string {
  if (h.evidence.docTitle) return `《${h.evidence.docTitle}》`;
  if (h.type === "material") return String(h.entityLabel || "");
  return "";
}

// ---------- 仪表盘 territory widget（§5.3，GF-1 材料/领域巩固地图——不自称知识疆域） ----------

// aria-label（设计稿 §5.3 示例：「共 24 张：未学 4 · 学习中 6 · 长期复习 8 · 已巩固 6」）
export function territoryAriaLabel(r: GrowthTerritoryRow): string {
  return t("共 {total} 张：未学 {n} · 学习中 {l} · 长期复习 {r} · 已巩固 {c}", { total: r.total, n: r.new, l: r.learning, r: r.reviewing, c: r.consolidated });
}

// 脚注（设计稿示例：「覆盖 = 已巩固 / 活跃卡 · ≥8 张参与 · 已过半材料 3 本」）
export function territoryFootText(crossedHalfCount: number): string {
  return t("覆盖 = 已巩固 / 活跃卡 · ≥8 张参与 · 已过半材料 {n} 本", { n: crossedHalfCount });
}

// 覆盖率百分比（四舍五入取整；回落呈现纪律 §4.17-7③：只显示现状）
export function territoryPctText(r: GrowthTerritoryRow): string {
  return `${Math.round(r.coverage * 100)}%`;
}
