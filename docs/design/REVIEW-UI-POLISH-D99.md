# 复习界面优化四项（D99 / v48.58）设计稿

> 状态：实施中。分支 `d99-review-ui`。GUIDE 登记：§5.3（评分模块修订）、§6.8-16（新节）、§7.4（dictAutoSpeak 默认值变更 + review-answer-judge scope）、§8.1 D99。

## §0 用户原话（逐字，2026-10-06）

> 复习界面优化。
> 一、增加按钮
> 在用户回答问答卡片时，有时会回答一个与标准答案不同的答案，但无法十分确定该答案是否正确。例如，问题正面是："袖带红脖是哪个群体对袖带蓝领的蔑称？"目前的标准答案是"新兴精英阶层"。当用户回答"新兴资产阶级"时，他不知道这个答案是否准确。此时应点击该按钮，输入用户认为的答案，再由 AI 判断该回答是否准确，并说明原因。
> 二、复习界面深色模式下的发音按钮
> 在复习界面中，若将主题模式切换为深色，外语卡片的发音按钮会看不见，只有在鼠标悬停到翻页按钮上方时，才会出现主题色的描边。请增加按钮的可见度，并默认自动发音：当按钮出现在屏幕上时，自动发音。
> 三、复习界面进度条对齐
> 复习界面上方的进度条，左右未与下方卡片及更下方的按钮对齐，请将其对齐。
> 四、底栏按钮高度对齐
> 底栏按钮上的评估按钮（重来、困难、良好、简单），其高度未与"显示答案"按钮对齐，请将其对齐。

## §1 范围

**Goals**：四项全部落地于复习页（`ReviewView` + `CardFace` 词卡分支 + theme.css 复习作用域）；新提示词 scope `review-answer-judge` v1 播种；GUI 测试套件锁定四项判据。

**Non-Goals**：不改 FSRS/调度/队列口径；不改卡面排版字号；不做 AI 判答的流式输出与历史记录；不修 `ContrastCardModal` / `ImageLightbox` 已导入未渲染的既有死按钮（另行登记）；不给挖空/图片挖空卡扩展判答（无 backMarkdown 时按钮禁用）。

## §2 设计与实现

### 2.1 ① AI 判答按钮

- **入口**：底栏 `.review-bar-side` 首位新增 `bar-btn ghost`「AI 判答」（`data-testid="review-judge-btn"`），正反两面恒在；`backMarkdown` 为空的卡（挖空缺省态等）禁用并提示原因。
- **模态**：新组件 `src/components/AnswerJudgeModal.tsx`（`modal-backdrop`/`modal-panel` 家族 + `useDialogA11y`，Esc/点背板关闭）：
  - 题面只读预览（ReactMarkdown + math，与卡面同管线）；
  - 学生答案输入 `textarea`（`data-testid="judge-input"`）；
  - 「让 AI 判断」提交（`data-testid="judge-submit"`）→ `aiGateway.chat`（system = PromptTemplate `review-answer-judge`，渲染层兜底常量；temperature 0.2）；
  - 结果：裁决徽标（等价/部分正确/不一致/无法判断，`data-testid="judge-verdict"`）+ 理由（`data-testid="judge-explanation"`）；JSON 解析失败回落原文展示（LeechWizard 同法）；
  - 页脚固定提示「AI 判断仅供参考：不写入任何数据，评分仍由你决定」——§1.9/§1.10 AI 不是事实源的呈现层表达。
- **零写入**：模态不产生任何 IPC 写路径（只读 prompts:get + ai chat 流）。
- **提示词**（scope `review-answer-judge` v1，`electron/prompts.js` 常量 + `electron/db.js` per-scope `COUNT(*)==0` 播种，与 `extract-rerank` 同法、与制卡族 TARGET_VERSION 无关，存量库启动即补种）：等价而非逐字（同义改写/等值单位/更宽泛但含核心 = 等价）；补充内容正确=partial、错误=incorrect；只依据题面与标准答案、信息不足用 unknown；输出严格 JSON `{"verdict":"correct|partial|incorrect|unknown","explanation":"…"}`。
- **换卡安全**：`current?.id` 变化即关闭模态（防止键盘快捷键换卡后模态显示旧卡）。

### 2.2 ② 发音按钮可见度 + 默认自动发音

- **可见度**：`.vocab-speak-btn` 描边 `--border-subtle` → `--border-strong`（D76「全栏可见描边一种灰」同族），显式 `color: var(--text-secondary)`；深色档 border-strong #4a4a46 / 文字 #b5b5b0 对 #101010 底均可见（hover accent 描边保留）。
- **自动发音改判（v32 追记六「出到单词卡即朗读」→ D99「按钮出现即朗读」）**：`ReviewView` effect 改为跟随发音按钮的出现面——听音卡（按钮嵌题面，且背面题面同嵌）出卡即读一次；其余单词卡（按钮嵌答案区）翻面即读；`autoSpokenRef` 按 `cardId:face` 去重（同一面不重复触发，翻回再翻到可再触发一次）。`dictAutoSpeak` 默认值 false → **true**（`ReviewView` 与 `SettingsPanel` 两处读侧默认值同步改；用户显式存过 `false` 的库不受影响）。

### 2.3 ③ 进度条对齐

- `.review-progress` 增 `max-width: 720px; margin-inline: auto;`——与 `.review-head-inner` / `.review-session` / `.stage-bar-inner` 同一 720 内列公式（构造性对齐，非测量补偿）；原 D88「随头带贯通全宽」条款作废。空态收尾页同 class 同步生效。

### 2.4 ④ 评估按钮等高

- `.review-bar .grade`：`min-height:64px` 两行卡式 → **`height:40px` 单行**（与 `.bar-btn` 同一 40 档），`.grade-name` 与 `.grade-due`（间隔预览）横排同行居中；推荐档 Good 保留 accent 填充 + accent-on 文字，**加高 72px 退役**（D88 §7.4 的 Staging 加高条款作废）。DOM 结构与类名不变（m4 断言钩子不动），纯 CSS 改判。

## §3 测试计划（tests/d99-review.gui.mjs，CDP 真实应用 + 隔离 userdata + AI mock 服务器）

1. **AI 判答**：播种 qa 卡 → 点「AI 判答」→ 模态出现 → 输入学生答案 → 提交 → mock 返回 JSON → 裁决徽标与理由渲染；AI 未返回 JSON 时回落原文。
2. **自动发音**：播种带 `dictJson`（kind=en2cn）的卡 → spy `speechSynthesis.speak` → 正面 0 次 → 点「显示答案」→ 1 次（文本=词）；`dictAutoSpeak` 默认开（全新库）。
3. **深色可见度**：`settingsAPI.set("theme","mode","dark")` + reload（真实主题路径）→ `.vocab-speak-btn` border-color 与卡面底色亮度差 > 阈值、文字色与底色亮度差 > 阈值。
4. **进度条对齐**：`.review-progress` 与 `.review-session` 的 left/right 差 ≤ 2px。
5. **评分钮等高**：正面 `.bar-btn.primary` 高度 == 背面 `.grade` 高度（±1px）。
6. 回归：`F11` / `F18` / `F20` / `F21` / `F24` / `F27` + `tsc --noEmit`。

## §4 修订记录

| 版本 | 内容 |
|---|---|
| v1 | 初版（四项 + 测试计划），随 D99 实施批创建 |
