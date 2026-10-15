// 皮肤 API · ui/* 事件名常量（v49.0 / D174；SKIN_API_VERSION 2）
// 发出点都是纯表现层（一行 eventBus.emit）；皮肤在 activate(ctx) 里经 ctx.onUiEvent 订阅。
// 事件名已登记 eventBus ALLOWED_EVENTS 白名单；新增事件必须 bump SKIN_API_VERSION 并登记 GUIDE。
export const UI_EVENTS = {
  /** 主视图切换（App.changeView） */
  viewChange: "ui/view-change",
  /** 通用弹层开/关（useDialogA11y；kind: dialog） */
  overlayOpen: "ui/overlay-open",
  overlayClose: "ui/overlay-close",
  /** 复习卡片翻面（ReviewView showBack） */
  reviewFlip: "ui/review-flip",
  /** 复习评分提交后（ReviewView.grade 成功路径） */
  reviewGrade: "ui/review-grade",
  /** 复习会话完成（ReviewView 队列清空；阅读会话完成点待批次，见 AUTHORING §4.4） */
  sessionComplete: "ui/session-complete",
  /** 制卡成功（确认面板/手动保存链落库后） */
  cardCreated: "ui/card-created",
} as const;

export type UiEventName = (typeof UI_EVENTS)[keyof typeof UI_EVENTS];
