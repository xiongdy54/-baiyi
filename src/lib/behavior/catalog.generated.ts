// 本文件由 scripts/gen-bdi-catalog.mjs 从 electron/behavior/registry.js 生成，禁止手改。
// 唯一事实来源：docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md §6；BDI_CATALOG_VERSION = 1。

export const BDI_CATALOG_VERSION = 1 as const;

export type BdiEventName =
  | "app.started"
  | "app.updated"
  | "app.window_state"
  | "app.power"
  | "nav.view"
  | "nav.overlay"
  | "cmd.invoked"
  | "tray.action"
  | "library.imported"
  | "library.deleted"
  | "library.meta_edited"
  | "library.opened"
  | "library.closed"
  | "shelf.filtered"
  | "reader.jumped"
  | "reader.searched"
  | "reader.selection_action"
  | "reader.sidebar_tab"
  | "reader.image_focused"
  | "reader.appearance"
  | "reader.workflow"
  | "reader.finished"
  | "extract.created"
  | "extract.op"
  | "extract.session"
  | "extract.shown"
  | "extract.reviewed"
  | "card.created"
  | "card.edited"
  | "card.deleted"
  | "card.suspended"
  | "card.tags_changed"
  | "card.regenerated"
  | "card.disambiguated"
  | "card.issue"
  | "ai_batch.created"
  | "ai_batch.resolved"
  | "card.leech_resolved"
  | "review.session"
  | "review.shown"
  | "review.revealed"
  | "review.extra_revealed"
  | "review.rated"
  | "review.undone"
  | "review.skipped"
  | "review.source_opened"
  | "review.answer_judged"
  | "review.leech"
  | "growth.feedback_shown"
  | "browse.queried"
  | "browse.card_opened"
  | "browse.bulk_op"
  | "dict.lookup"
  | "dict.source_op"
  | "similarity.queried"
  | "ai.invoked"
  | "ai.panel_turn"
  | "ai.websearch"
  | "mindmap.generated"
  | "mindmap.node_action"
  | "mindmap.viewed"
  | "knowledge.op"
  | "knowledge.viewed"
  | "learner.track_op"
  | "learner.panel_action"
  | "learner.exercise"
  | "journal.written"
  | "capture.used"
  | "memory.op"
  | "insight.op"
  | "insight.viewed"
  | "meaning.op"
  | "stats.viewed"
  | "settings.changed"
  | "fsrs.optimizer"
  | "backup.op"
  | "anki.exported"
  | "op.undo"
  | "app.error";

export type BdiEventOwner = "M" | "R" | "B" | "W" | "M+R";

export interface BdiEventMeta {
  readonly owner: BdiEventOwner;
  readonly intentOnly: boolean;
  readonly allowText: boolean;
}

export const BDI_EVENTS = {
  "app.started": { owner: "W", intentOnly: false, allowText: false },
  "app.updated": { owner: "W", intentOnly: false, allowText: false },
  "app.window_state": { owner: "W", intentOnly: false, allowText: false },
  "app.power": { owner: "W", intentOnly: false, allowText: false },
  "nav.view": { owner: "B", intentOnly: false, allowText: false },
  "nav.overlay": { owner: "B", intentOnly: false, allowText: false },
  "cmd.invoked": { owner: "R", intentOnly: false, allowText: false },
  "tray.action": { owner: "M", intentOnly: false, allowText: false },
  "library.imported": { owner: "M", intentOnly: false, allowText: false },
  "library.deleted": { owner: "M", intentOnly: false, allowText: false },
  "library.meta_edited": { owner: "M", intentOnly: false, allowText: false },
  "library.opened": { owner: "R", intentOnly: false, allowText: false },
  "library.closed": { owner: "R", intentOnly: false, allowText: false },
  "shelf.filtered": { owner: "R", intentOnly: false, allowText: true },
  "reader.jumped": { owner: "R", intentOnly: false, allowText: false },
  "reader.searched": { owner: "R", intentOnly: false, allowText: true },
  "reader.selection_action": { owner: "R", intentOnly: false, allowText: false },
  "reader.sidebar_tab": { owner: "R", intentOnly: false, allowText: false },
  "reader.image_focused": { owner: "R", intentOnly: false, allowText: false },
  "reader.appearance": { owner: "R", intentOnly: false, allowText: false },
  "reader.workflow": { owner: "B", intentOnly: false, allowText: false },
  "reader.finished": { owner: "R", intentOnly: false, allowText: false },
  "extract.created": { owner: "M", intentOnly: false, allowText: false },
  "extract.op": { owner: "M", intentOnly: false, allowText: false },
  "extract.session": { owner: "R", intentOnly: false, allowText: false },
  "extract.shown": { owner: "R", intentOnly: false, allowText: false },
  "extract.reviewed": { owner: "R", intentOnly: false, allowText: false },
  "card.created": { owner: "M", intentOnly: false, allowText: false },
  "card.edited": { owner: "M", intentOnly: false, allowText: false },
  "card.deleted": { owner: "M", intentOnly: false, allowText: false },
  "card.suspended": { owner: "M", intentOnly: false, allowText: false },
  "card.tags_changed": { owner: "M", intentOnly: false, allowText: false },
  "card.regenerated": { owner: "R", intentOnly: true, allowText: false },
  "card.disambiguated": { owner: "R", intentOnly: true, allowText: false },
  "card.issue": { owner: "M", intentOnly: false, allowText: false },
  "ai_batch.created": { owner: "M", intentOnly: false, allowText: false },
  "ai_batch.resolved": { owner: "M", intentOnly: false, allowText: false },
  "card.leech_resolved": { owner: "M", intentOnly: false, allowText: false },
  "review.session": { owner: "R", intentOnly: false, allowText: false },
  "review.shown": { owner: "R", intentOnly: false, allowText: false },
  "review.revealed": { owner: "R", intentOnly: false, allowText: false },
  "review.extra_revealed": { owner: "R", intentOnly: false, allowText: false },
  "review.rated": { owner: "M", intentOnly: false, allowText: false },
  "review.undone": { owner: "M", intentOnly: false, allowText: false },
  "review.skipped": { owner: "M", intentOnly: false, allowText: false },
  "review.source_opened": { owner: "R", intentOnly: false, allowText: false },
  "review.answer_judged": { owner: "R", intentOnly: false, allowText: false },
  "review.leech": { owner: "B", intentOnly: false, allowText: false },
  "growth.feedback_shown": { owner: "R", intentOnly: true, allowText: false },
  "browse.queried": { owner: "R", intentOnly: false, allowText: true },
  "browse.card_opened": { owner: "R", intentOnly: false, allowText: false },
  "browse.bulk_op": { owner: "R", intentOnly: false, allowText: false },
  "dict.lookup": { owner: "M", intentOnly: false, allowText: true },
  "dict.source_op": { owner: "M", intentOnly: false, allowText: false },
  "similarity.queried": { owner: "M", intentOnly: false, allowText: false },
  "ai.invoked": { owner: "R", intentOnly: false, allowText: false },
  "ai.panel_turn": { owner: "R", intentOnly: false, allowText: false },
  "ai.websearch": { owner: "M", intentOnly: false, allowText: false },
  "mindmap.generated": { owner: "M", intentOnly: false, allowText: false },
  "mindmap.node_action": { owner: "M+R", intentOnly: false, allowText: false },
  "mindmap.viewed": { owner: "R", intentOnly: false, allowText: false },
  "knowledge.op": { owner: "M", intentOnly: false, allowText: false },
  "knowledge.viewed": { owner: "R", intentOnly: false, allowText: false },
  "learner.track_op": { owner: "M", intentOnly: false, allowText: false },
  "learner.panel_action": { owner: "B", intentOnly: false, allowText: false },
  "learner.exercise": { owner: "M", intentOnly: false, allowText: false },
  "journal.written": { owner: "M", intentOnly: false, allowText: false },
  "capture.used": { owner: "M", intentOnly: false, allowText: false },
  "memory.op": { owner: "M", intentOnly: false, allowText: false },
  "insight.op": { owner: "M", intentOnly: false, allowText: false },
  "insight.viewed": { owner: "R", intentOnly: false, allowText: false },
  "meaning.op": { owner: "M", intentOnly: false, allowText: false },
  "stats.viewed": { owner: "R", intentOnly: false, allowText: false },
  "settings.changed": { owner: "M", intentOnly: false, allowText: false },
  "fsrs.optimizer": { owner: "M", intentOnly: false, allowText: false },
  "backup.op": { owner: "M", intentOnly: false, allowText: false },
  "anki.exported": { owner: "M", intentOnly: false, allowText: false },
  "op.undo": { owner: "M", intentOnly: false, allowText: false },
  "app.error": { owner: "M", intentOnly: false, allowText: false },
} as const satisfies Record<BdiEventName, BdiEventMeta>;

export const BDI_EVENT_NAMES = [
  "app.started",
  "app.updated",
  "app.window_state",
  "app.power",
  "nav.view",
  "nav.overlay",
  "cmd.invoked",
  "tray.action",
  "library.imported",
  "library.deleted",
  "library.meta_edited",
  "library.opened",
  "library.closed",
  "shelf.filtered",
  "reader.jumped",
  "reader.searched",
  "reader.selection_action",
  "reader.sidebar_tab",
  "reader.image_focused",
  "reader.appearance",
  "reader.workflow",
  "reader.finished",
  "extract.created",
  "extract.op",
  "extract.session",
  "extract.shown",
  "extract.reviewed",
  "card.created",
  "card.edited",
  "card.deleted",
  "card.suspended",
  "card.tags_changed",
  "card.regenerated",
  "card.disambiguated",
  "card.issue",
  "ai_batch.created",
  "ai_batch.resolved",
  "card.leech_resolved",
  "review.session",
  "review.shown",
  "review.revealed",
  "review.extra_revealed",
  "review.rated",
  "review.undone",
  "review.skipped",
  "review.source_opened",
  "review.answer_judged",
  "review.leech",
  "growth.feedback_shown",
  "browse.queried",
  "browse.card_opened",
  "browse.bulk_op",
  "dict.lookup",
  "dict.source_op",
  "similarity.queried",
  "ai.invoked",
  "ai.panel_turn",
  "ai.websearch",
  "mindmap.generated",
  "mindmap.node_action",
  "mindmap.viewed",
  "knowledge.op",
  "knowledge.viewed",
  "learner.track_op",
  "learner.panel_action",
  "learner.exercise",
  "journal.written",
  "capture.used",
  "memory.op",
  "insight.op",
  "insight.viewed",
  "meaning.op",
  "stats.viewed",
  "settings.changed",
  "fsrs.optimizer",
  "backup.op",
  "anki.exported",
  "op.undo",
  "app.error",
] as const satisfies readonly BdiEventName[];

export function isBdiEventName(value: string): value is BdiEventName {
  return Object.prototype.hasOwnProperty.call(BDI_EVENTS, value);
}
