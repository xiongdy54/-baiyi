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

这些输入按「是否存在提交/取消键语义」分两档（2026-10-24 C-34 对抗审查后按实态收敛；C-35 机器闸门按此检查）：

- **有提交/取消键语义的面**（文件内存在提交或取消的 `onKeyDown` 分支）：必须带 `isImeComposing` 守卫（`src/lib/ime.ts`，C-27）；Esc / Ctrl+Enter 语义按上方行为规则表（提交并退出，不是放弃）。
- **一次性输入面**（textarea 本体无提交键）：Esc 归弹窗/浮层关闭语义＝**放弃**（关闭/收起由弹窗层或容器承担），不适用「Esc 提交」；存在键分支处仍须 IME 守卫。

白名单清单（文件 + 用途）：

| 文件 | 用途 |
|---|---|
| `src/components/SelectionPanels.tsx` | 待处理文字 |
| `src/components/SelectionMenu.tsx` | 选区批注速记 |
| `src/components/learner/SelfExplainDialog.tsx` | 自我解释作答 |
| `src/components/editor/OcclusionEditor.tsx` | 遮挡区标签 |
| `src/components/AIPanel.tsx` | AI 对话与草稿 |
| `src/components/AnswerJudgeModal.tsx` | 答题输入 |
| `src/components/editor/CardFields.tsx` | `ClozeField`（填空源文本——挖空工具要操作原始文本选区） |
| `src/components/AnnotationEditor.tsx` | 批注编辑浮层（400 ms 防抖 + 失焦保存；Esc＝保存并收起——契约「长文本面」档） |
| `src/components/reader/AnnotationPanel.tsx` | 批注列表就地编辑（失焦 / Ctrl+Enter / Esc＝保存并收起，C-34c 统一） |

逐文件实态（2026-10-24 对抗审查核实，行号以当期为准）：

| 文件 | 档 | IME 守卫 | Esc 实态 |
|---|---|---|---|
| `SelectionPanels.tsx`（待处理文字 trio） | 一次性 | trio 容器层有（onKey :477） | textarea 无提交键；Esc＝关闭 trio（放弃，:479） |
| `SelectionMenu.tsx`（选区批注速记） | 提交键 | 有（:192） | Ctrl+Enter＝保存；Esc＝收面板**不保存（放弃）**（:196-198） |
| `SelfExplainDialog.tsx`（自我解释作答） | 一次性 | 0 | textarea 无 onKeyDown；Esc＝useDialogA11y 关窗（放弃） |
| `OcclusionEditor.tsx`（遮挡区标签） | 一次性 | 0 | textarea 无提交键；Esc＝编辑器级逐层退出链（裁剪草稿→…→dirty 确认→关窗，:656-668） |
| `AIPanel.tsx`（AI 对话与草稿） | 提交键 | 有（3 处） | composer Enter＝发送；条目内联编辑 Enter＝提交、**Esc＝放弃**（:382-384） |
| `AnswerJudgeModal.tsx`（答题输入） | 一次性 | 0 | textarea 无键语义；Esc＝useDialogA11y 关窗（作答弃） |
| `AnnotationEditor.tsx`（批注浮层） | 提交键（保存并收起） | 0（文件内；Esc 走 dialogA11y） | Esc＝`closeAndSave`＝**保存并收起**；另有 400 ms 防抖 + 失焦保存 |
| `reader/AnnotationPanel.tsx`（批注就地编辑） | 提交键 | 有（4 处） | Esc＝保存并收起（C-34c）；Ctrl+Enter＝保存；失焦保存 |
| `editor/CardFields.tsx`（ClozeField） | 提交键（在包装层） | 有（ClozeDraftEditor） | textarea 本体只有 Ctrl+Shift+C 挖空键；提交＝Esc / Ctrl+Enter（包装层，IME 守卫在） |

> **已知例外（C-27 族既有缺口，登记待单列收编，本契约不修代码）**：`src/lib/dialogA11y.ts` 的
> document 级 Esc 处理器（:49-55）无 IME 守卫——组字中按 Esc（输入法取消候选）会直接关闭模态；
> 所有 useDialogA11y 模态共享此路径（SelfExplainDialog / AnswerJudgeModal / AnnotationEditor 的
> 「保存并收起」/ ManualCardEditor 等）。C-27 的 31 处守卫只覆盖组件内 onKeyDown，未收编该共享库。
> C-35 闸门的机检查询＝「文件内 `onKeyDown` 存在提交/取消分支 ⇒ 其附近有 `isImeComposing`（或显式
> 豁免标记）」，`dialogA11y.ts` 列为已知例外行，不得据弹窗层路径报组件级违规。

> 补登说明（C-34 偏离）：报告 C-34d 的白名单只列了前 7 项，但其证据 6 把批注两套编辑行为
> （`AnnotationEditor.tsx` / `reader/AnnotationPanel.tsx` 的 textarea）定为「保留、只统一按键语义」
> （C-34c），且验收判据要求「`<textarea>` 文件全部在白名单内」——故按验收判据把这两处批注
> textarea 补登进白名单（其余报告清单项照抄）。报告完成后 `disambiguate/CardPane.tsx` 已改用
> `MdField`，不再含 textarea，无需登记。
