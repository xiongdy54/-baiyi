# 编辑契约（EDIT-CONTRACT）

> 来源：审计修复项 C-34（`docs/impl-spec/AUDIT-C-PROGRESS.md` §3.40；报告 C-34 小节）。
> 适用范围：应用内一切「编辑用户内容」的面——卡片字段、摘录、日记、批注、辨析、AI 输入等。
> C-35 的一致性机器闸门按本文件检查（白名单见文末）。

## 行为规则

| 行为 | 规则 |
|---|---|
| Esc | **提交并退出编辑**（不是放弃），与 MarkdownEditor 现状一致 |
| Ctrl/Cmd+Enter | 提交并退出 |
| 失焦 | 提交 |
| 自动保存 | 长文本面（摘录、日记、批注）输入停止 400 ms 后保存；卡片字段在退出编辑时保存 |
| 输入法 | 每个 `onKeyDown` 第一行 `if (isImeComposing(e)) return;`（`src/lib/ime.ts`，C-27），Esc 也一样 |
| 清空必填字段 | 不保存，并在字段旁显示"内容为空，未保存"，3 秒后消失——**不允许静默恢复** |
| 空白与换行 | 不改写用户输入的空白和空行 |
| 卡片/摘录内容 | 只能用 `MdField`（问答字段）或 `ClozeField`（填空源文本）编辑；只读展示只能用 `ReadMarkdown` |

## 组件归属

| 组件 | 路径 | 用途 |
|---|---|---|
| `MarkdownEditor` | `src/components/editor/MarkdownEditor.tsx` | 所见即所得编辑（新建/摘录/日记/捕获/设置/粘贴材料/卡片问答字段） |
| `MdField` / `ClozeField` | `src/components/editor/CardFields.tsx` | 卡片字段编辑（问答 = MdField；填空源文本 = ClozeField） |
| `EditableField` | `src/components/editor/EditableField.tsx` | 卡面「读态渲染 + 点击进入编辑」的外壳（读态走 ReadMarkdown） |
| `ReadMarkdown` | `src/components/editor/ReadMarkdown.tsx` | 全应用统一的 markdown **读态**渲染管线（唯一允许 `<ReactMarkdown>` 的文件） |

## 保留的裸 `<textarea>` 白名单

（C-34d 登记；C-35 的机器闸门按这份清单检查——清单之外的文件出现新的 `<textarea>` 即为违规。）

这些输入是「一次性输入」（AI 输入框、答题框、标签输入等），不是卡片内容，保留裸 textarea，
但必须遵守上方行为规则（Esc 提交、IME 守卫等）：

| 文件 | 用途 |
|---|---|
| `src/components/SelectionPanels.tsx` | 待处理文字 |
| `src/components/SelectionMenu.tsx` | 选区批注速记 |
| `src/components/learner/SelfExplainDialog.tsx` | 自我解释作答 |
| `src/components/editor/OcclusionEditor.tsx` | 遮挡区标签 |
| `src/components/AIPanel.tsx` | AI 对话与草稿 |
| `src/components/AnswerJudgeModal.tsx` | 答题输入 |
| `src/components/editor/CardFields.tsx` | `ClozeField`（填空源文本——挖空工具要操作原始文本选区） |
