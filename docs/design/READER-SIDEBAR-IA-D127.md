# 阅读器侧栏信息架构重排（D127，v48.83）

> 用户 2026-10-11 实机反馈（附截图）：①目录/摘录/图谱三页签排在下方，而只对摘录页签生效的「全部/摘录/高亮/位置/时间」五个筛选排序钮排在它们上面——层级颠倒；②侧栏顶部按钮行与右列「制卡/截图」工具按钮高度未对齐；③收起/展开钮在收起、展开两态下位置不一致。要求按 better-layout / better-typography 重排，页签层级调整后样式同步。排版依据：组间 2× 组内节奏（better-layout）、共享对齐缘、主役页签用全应用既有的「文字 + 2px accent 下划线」语言（顶栏页签同款）、控制件与内容区分。

## 1. 信息架构（自上而下）

```
.reader-sidebar
  ├ 页签行（主役导航）：目录 | 摘录 | 图谱 —— 高 56 与右列工具行同带（8+40+8），左让位 64px 给浮动开关钮
  │   激活态＝顶栏页签同款 2px accent 下划线（非灰底块）；hover＝reader-fg 8% 混色
  └ 页签面板（flex 1）
      ├ 目录：目录列表（不变）
      ├ 摘录：上下文工具行（筛选段 3 + 排序段 2，高 24，3:2 铺满，贴面板顶、hairline 分隔）
      │        + 注解列表（AnnotationPanel showHead=false 不变，列表自带滚动）
      └ 图谱：导图面板（不变）
```

- **层级原则**（better-layout「Order by importance / 控制件与内容区分」）：主导航（页签）置顶；只作用于摘录列表的筛选/排序是**上下文控件**，随摘录页签出现、放列表上方——不再悬浮在页签之上冒充全局控件。
- **筛选/排序行**随页签常驻列表顶部（不随列表滚动）：摘录面板改 flex 列（工具行 flex:none + 列表 flex:1 自滚），hairline 与列表分隔。

## 2. 几何对齐

- **开关钮 `.annot-toggle.bar-btn[data-reader-sidebar-toggle]`**：`top: calc(48px + var(--sp-2))`、**高 40px**（与 `.btn` 同高）——**两态同位同高**（作废 R4 时代「收起态 56 / 展开态 60」的双轨）。宽 40 不变；左 16 不变。摘录页共用的 `.annot-toggle` 基线（40×24、top 60）不动，仅阅读器实例按 attribute 覆盖。
- **页签行**：`height: 56px`（= 工具行 8+40+8）、`padding-left: var(--sp-16)`（16+40+8 让位浮动开关钮，D85 同一让位 Token）；页签钮高 40、`fs-secondary`。
- 右列 `.reader-engine-controls`（制卡/截图…）不动——对齐由侧栏侧主动靠齐实现。

## 3. 退役

- 侧栏顶部 `.annot-side-head`（筛选/排序行）整体移除；`.reader-side-rail .annot-side-head` 系列覆盖规则（与摘录页轨共享的选择器组拆分，摘录页轨保留）全部退役。
- 页签旧样式（24 高/meta/grey-1 底块选中）退役，换文字+下划线语言。
- `.annot-toggle[aria-expanded="false"]` 的收起态 top 覆盖规则退役（两态同位）。

## 4. 动效与可达性

- 页签 hover 底色 160ms `--ease-out-soft`（既有 token）；下划线瞬切（与顶栏页签同款，不做位移动画）；`role="tablist"/tab/aria-selected` 既有语义保留。
- 收起/展开钮：两态同位——点击热区不再漂移；`aria-expanded` 语义不变。

## 5. 验收（可机械检查）

1. `tsc` + `npm run build` 通过；d126 套件全绿；annotations 套件 ⑪ 系列按新几何更新后全绿（⑪a3 开关钮 fixed(16,56) 40×40 两态一致）。
2. 探针：展开态页签行 top=48+8=56、高 56；开关钮 top=56、高 40，与右列 `.reader-engine-controls .btn` 同带；收起态开关钮 top 不变。
3. 筛选/排序段控仅在摘录页签在场（目录/图谱页签下无 `[data-annot-filterseg]`）。
