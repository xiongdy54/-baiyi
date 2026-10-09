# 卡片辨析与制卡语境包（D121，v48.77）

> 用户需求（2026-10-09）：复习中发现两张卡对相近问题给出矛盾答案（例：「优绩主义主张按什么分配社会回报与地位？」→「才能、努力、成绩」vs 另一张「财富和资产增值」）。根因可能是①卡片错误 ②限定条件缺失（不同人/流派/应然 vs 实然/时代）③重复 ④真易混。
> 本设计稿 = 实现合同。各任务执行者只按本稿实现；与本稿冲突的地方停下来报告，不得自行改契约。
> **明确不做**：「本书语境说明」（用户 2026-10-09 否决）。

## 0. 现状缺陷（实测）

- 复习页「更多 → 对比卡」点击无反应：`ReviewView.tsx` 仍 `setContrastOpen(true)`，但 `<ContrastCardModal>` 渲染行在提交 `82c5267`（复习页 chrome 对齐）中被误删。
- 旧对比卡（D29）：候选只发每卡 front 前 50 字（看不到答案/来源→发现不了答案矛盾）；B 由 AI 盲选；唯一出口是再产三张卡（错误卡/缺限定卡原样保留）；打开即调 AI；新卡 sourceRef 沿用 A。
- AI 制卡请求只带「选区 + 书名 + section（主路径实际恒 undefined）」：无作者、无章节路径、无前后文、无相关已有卡 → R19 归属规则无从执行。

## 1. 数据模型

### 1.1 `library_items.author TEXT`（可空）
- 迁移：`initDb` 末尾追加 `try { ALTER TABLE library_items ADD COLUMN author TEXT } catch {}`。
- 导入时填充（取不到即 NULL，绝不猜）：
  - EPUB：OPF `dc:creator`（多值用「、」连接）。EPUB 标题当前由渲染层传入 payload，作者同法随 payload 传入（渲染层从 foliate `book.metadata.author` 取：可能是 string / {name} / 数组，统一归一为字符串）。
  - PDF：pdfjs `getMetadata()` 的 `info.Author`（trim，空串→NULL）。
  - DOCX：zip 内 `docProps/core.xml` 的 `<dc:creator>`（用 mammoth 依赖链已有的 jszip；无则跳过）。
  - 其余格式：NULL。
- IPC：`library:setItemAuthor(id, author)` → `db.setLibraryItemAuthor`（trim；空串→NULL；>200 字拒绝；`UPDATE ... updated_at=?`；`persist()`）。preload `libraryAPI.setItemAuthor`；`src/lib/library.ts` 包装；`LibraryItem` 类型加 `author?: string | null`；list/get 映射带出。
- UI：书架现有改名入口旁增「作者」编辑（同一交互模式，空=未知）。

### 1.2 `card_links`（新表，第 28 张实建表）
```sql
CREATE TABLE IF NOT EXISTS card_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  card_a TEXT NOT NULL,
  card_b TEXT,            -- 单卡辨析（「这题本身问得不清」）为 NULL
  kind TEXT NOT NULL DEFAULT 'disambiguated',
  verdict TEXT,           -- §3.3 六枚举之一；用户未跑 AI 仅手动处理时为 'manual'
  note TEXT,              -- AI explanation 或用户备注（≤500 字）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sync_version INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_card_links_a ON card_links(card_a);
CREATE INDEX IF NOT EXISTS idx_card_links_b ON card_links(card_b);
```
- 为什么不用 `knowledge_relations.contrasts_with`：该表连接的是 KnowledgePoint，而卡的 `knowledge_point_id` 多为批内簇编号（kp1/kp2，D38 已记录跨材料碰撞），无法可靠承载「这两张卡」的关系。
- IPC：`card-links:add({cardA, cardB|null, verdict, note})` → 返回 id；`card-links:listForCard(cardId)` → 该卡作为 a 或 b 的未删除链接，附对端卡 `{id, front(≤60字), docTitle}`（对端已软删则不返回）。preload `cardLinksAPI`；渲染层 `src/lib/cardLinks.ts`。
- 只是展示/溯源用的结构数据：**不参与 FSRS、不参与队列**。

### 1.3 `sourceRef.author`
- `CardRecord.sourceRef` / `CardDraft.sourceRef` / `CardUpsert.sourceRef` 类型加 `author?: string`。
- AI 草稿入库（`createAcceptedCard`）与手动制卡在有书籍上下文时：`sourceRef.title` 缺省填书名、`sourceRef.author` 填 `library_items.author`（有值才写）。

## 2. AI 制卡语境包（R21）

### 2.1 请求装配（`cardGenerator.generateCards` 的 context 新增字段，均可选）
| 字段 | 来源 | 注入块（user 消息） |
| --- | --- | --- |
| `author` | `library_items.author` | 并入【来源】：`【来源】《书名》 · 作者：X · 章节：A › B › C` |
| `sectionPath` | 见 2.2 | 同上（替代原 `section`；`section` 仍兼容） |
| `surrounding` `{before, after}` | 见 2.3 | `【前后文（只用于判断这段话是谁的观点、在什么前提下成立；禁止对前后文出卡）】\n…前文…\n〔选区〕\n…后文…` |
| `relatedCards: string[]` | 见 2.4 | `【相关已有卡（含答案，用于发现答案冲突与限定缺失；禁止重复或换皮）】\n每行一张` |
- 注入顺序：材料 → 来源 → 前后文 → 本次重点 → 联网背景 → 已有卡(existingCards，原样保留) → 相关已有卡 → 画像 → 记忆。
- 批次 `context_json` 留痕：`authorPresent: bool`、`sectionPath`、`surroundingChars`、`relatedCardsCount`（不存前后文全文与相关卡全文，避免批次表膨胀）。

### 2.2 章节路径 `sectionPath`
- 新纯函数 `src/lib/reader/tocPath.ts`：
  - `tocPathByHref(items: ReaderTocItem[], href: string | undefined): string[]` —— DFS 嵌套目录，返回从顶层到命中项的 label 链（href 比较忽略 `#` 之后部分作为二次匹配：先全等，再按去锚 href 匹配最深一项）。
  - `headingPathAt(markdown: string, index: number): string[]` —— 对 markdown 文本，取 index 之前出现的 ATX 标题（`#`~`######`）维护层级栈，返回当前所在标题链。
- Reader 适配：`ReaderAdapter.labels.section` 改为由 `sectionPath.join(" › ")` 提供（引擎书用 tocPath，自渲染 markdown 书用 headingPathAt；都取不到为 undefined）。顺带修复 `Reader.tsx:1381` 只查顶层目录的 `chapterLabel`（改用 tocPathByHref 的最后一项）。
- 摘录复习页（`ExtractReviewView`）：有 markdown 正文时用 headingPathAt；否则 undefined。

### 2.3 前后文 `surrounding`
- 规则：选区前 **2 个段落**、后 **1 个段落**；before ≤ 600 字（超出从远端截断）、after ≤ 400 字；段落内文本做空白归一。
- 新纯函数 `src/lib/selectionContext.ts`：`paragraphContext(body: string, selection: string): {before, after} | null` —— 在 markdown/纯文本中定位选区（先精确 indexOf，失败则按空白归一后定位），按空行切段。找不到返回 null。
- 引擎书（EPUB/PDF，无 markdown 正文）：`ReaderKernel` 增可选方法 `getSelectionContext?(): {before: string; after: string} | null`：
  - foliate：从当前选区 Range 的起点所在块级祖先出发，取前 2 个、后 1 个有文本的兄弟块（与 `extractImageContext` 同思路，复用其块级判定）；
  - PDF：取选区所在页 text layer 文本，以选区文本定位后按句末标点/换行近似切段（无法定位则取页内选区前 600 / 后 400 字）。
- `ReaderAdapter` 增可选 `selectionSurrounding?(): {before, after} | null`：Reader 优先调 kernel 方法，否则对 `bodyText` 调 `paragraphContext`。
- 必须在 `clearSelection()` 之前采集（与 parentRange 同处理）。

### 2.4 相关已有卡 `relatedCards`
- 取法（纯本地、零网络）：`similaritySearch.findSimilar(selectionText, 6)` → 逐个 `cardsApi.get` → 过滤已删除/归档 → 格式化：
  `Q：{front 或 cloze 渲染，≤80字} ｜ A：{back，≤60字} ｜ 来源：《{sourceRef.title||docTitle||"未知"}》{author? " · "+author : ""}`
- 上限 6 行；为空不注入该块。失败静默跳过（不阻塞制卡）。

### 2.5 提示词 R21（制卡族 TARGET_VERSION 7 → **8**）
在 `CARD_GEN_PROMPT` 的 R19 之后、【第三步】之前插入以下原文（逐字）：

```
R21 限定完整性（v8，D121 辨析）：卡面必须带够「让答案唯一成立」的限定条件。出卡前对每张卡逐层判断，缺哪层补哪层：
   ①归属层——这句话是材料作者本人的观点、作者转述的他人观点、还是作者批判/反驳的对象？
     转述与批判对象一律写明持有者（如「罗尔斯认为…」「桑德尔指出，优绩主义者主张…」）；
     作者与持有者都无法确定时，按 R19 写「材料中的作者认为…」并把 qualifier.stance 记为 "unknown"。
   ②应然/实然层——是「主张应当如何」还是「实际如何运作/结果如何」？两者答案常常相反，
     front 必须用措辞区分（「主张应按…分配」vs「实际上按…分配」）。
   ③时空与范围层——结论只在特定时代、地域、人群、条件下成立时写明（「20 世纪美国」「在完全竞争市场中」）。
   ④框架与口径层——答案依赖某一理论框架或定义口径时写明（「按 X 的定义」「在新古典框架下」）。
   限定语要短（通常 ≤12 字），放在 front 或 contextPrefix；不得为了限定把问题撑成长句。
   【前后文】块只用来做以上判断——禁止对前后文本身出卡，答案仍只能来自【材料】。
   【相关已有卡】中若有问题相近但答案不同的卡：先判断是否因限定层不同导致，是则本卡必须写出
   区分它们的那一层限定，并在 warnings 写「与已有卡『…』答案不同：限定于…」；
   若判断为已有卡有误或矛盾无法由限定解释，在 warnings 写「与已有卡『…』答案矛盾，建议辨析」。
   每张卡输出 qualifier 字段：{"stance":"author|reported|criticized|consensus|unknown","holder":"持有者全名或学派，无则 null","note":"所补的限定层，一句话，无则 null"}。
```
- 在【第三步：输出前自检】的「假阴性排查」条目后追加一条（逐字）：
```
- 限定排查（R21）：遮住来源只读卡面——半年后的你能否判断这是谁、在什么前提下的说法？不能则补限定。
```
- 输出 schema 示例对象中 `"warnings"` 之前增加：`"qualifier": {"stance":"author","holder":null,"note":null},`
- `prompts.js` 中 R6、R19 的文字不改；版本注释写入 `ensurePromptTemplates` 的变更说明（v8：R21 限定完整性 + qualifier 字段）；seed name 由「v6」类改为「v8」。
- 非 CARD_GEN_PROMPT 派生的模板（occlusion / structure / vocab 独立 scope）本批不动。

### 2.6 `qualifier` 字段与确认面板
- `CardDraft.qualifier?: { stance: "author"|"reported"|"criticized"|"consensus"|"unknown"; holder: string|null; note: string|null } | null`；`extractJson` 后归一：非法 stance → 视为缺失（null），holder/note 非字符串 → null，各 ≤60 字。
- **不入库**（只在批次 result_json 留痕），因此不需要 cards 新列。
- `AIPanel` 草稿卡：
  - 有 qualifier 时在 contextPrefix 行显示小标签：作者观点 / 转述·{holder} / 批判对象·{holder} / 公认 / **归属未定**（unknown 用 warn 色，Token 用既有 warn 变量，不新造颜色）。note 有值时 title 提示。
  - stance=unknown 或 qualifier 缺失且卡含观点性措辞（复用 §5.2 L18 判定函数）时，在该草稿下显示单行输入「补限定（如：桑德尔认为，）」+「补上」按钮：把输入文本（trim 后）拼到 front 开头（cloze 卡拼到 cloze 文本开头），并把 stance 置为 `reported`、holder 置为输入文本。

## 3. 辨析功能（替换「对比卡」）

### 3.1 入口
- 复习页「更多」菜单：「对比卡」→「辨析 / 有疑问」，带快捷键提示。新命令 `review.disambiguate`，默认键 **E**（复习作用域，`commands.ts` COMMANDS 登记 + 命令表文档登记；F20 闸门同步）。答案翻开前后均可用。
- 卡片浏览详情：「生成对比卡」按钮 →「辨析」（打开同一组件）；Leech 向导 Step 2 文案中的「生成对比卡区分（需在阅读器…）」改为「若存在相似卡，点「辨析」比较并修正」。
- 新组件 `src/components/DisambiguateModal.tsx`，props：`{ card: CardRecord; presetOther?: string /* cardId */; origin: "review" | "browser" | "manual"; onClose(result: {changed: boolean; archivedIds: string[]}): void }`。
- 旧 `ContrastCardModal.tsx` 删除；其草稿逐张入库/放弃 UI 抽成 `ContrastDraftList`（同文件夹新组件）供 §3.3 ④ 复用。`buildContrastCandidates` 若无其他引用一并删除（以 tsc/测试为准）；`generateContrastDrafts` 改签名为显式 A/B（见 3.3 ④）。

### 3.2 第一步：选定另一张卡（纯本地，无 AI 也完整可用）
- 打开即显示（无任何网络调用）：
  - 顶部：搜索框（对全部卡 front/back/来源书名做不区分大小写子串匹配，最多 20 条）。
  - 默认列表：本地候选 Top 5（下列打分）。
  - 末项固定：「不是另一张，是这题本身问得不清」→ 单卡模式（B = 无）。
  - 每个候选显示：问题（≤80 字）、答案（≤60 字）、来源《书名》· 作者、已归档/暂停标识。
  - `presetOther` 给定时直接跳到第二屏。
- 候选打分（纯函数 `rankDisambiguationCandidates(base, all, k=5)`，放 `src/lib/disambiguateCore.mjs` + `.d.mts`（ESM 纯函数，零依赖；渲染层直接 import，node 测试经动态 import() 加载））：
  - 文本：front 用 cloze 渲染后文本（图片卡用 back）；全部做空白归一、去标点。
  - `score = 0.55·J(frontA, frontB) + 0.2·J(backA, backB) + 0.15·[同 knowledgePointId 且同 genBatch 或同 documentId] + 0.05·[同主 domain] + 0.05·[同来源书]`，J = 字符 bigram Jaccard。
  - 排除：自身、软删除。归档卡保留（可能正是那张错卡），标识「已归档」。
  - score < 0.08 的不进默认列表（宁可空列表也不凑数；空时提示「没找到相近卡，可用搜索」）。
- 第二屏（左右并排；窄宽度时上下）：A 与 B 各一栏，字段可编辑：contextPrefix、front（cloze 卡编辑 cloze 原文）、back。每栏下方显示来源（书名·作者·章节锚文本）与「原文」折叠区：`genBatchId` → `batchesAPI.get(id).sourceText`（≤1500 字）；否则 `contextRef.anchorText`；都无则「无原文记录」。
- 底部动作：「保存修改」（仅有改动时可点，逐卡 `cardsApi.update`，编辑语义复用 `ReviewView` 现有编辑保存路径对 frontMarkdown/backMarkdown/noteText/cloze 的处理；保存后写 `card_links`（verdict='manual'，若此次尚无链接））、「AI 诊断」（无 AI Key 时禁用并提示去设置）、「关闭」。
- `origin === "review"` 时底部显示复选框「关闭后跳过本卡（本次不评分）」，**默认勾选**；勾选时关闭后 ReviewView 调既有 `skip()`（只记跳过事件、due+10min、不写 review_logs、不动 FSRS 记忆状态）。若当前卡在弹窗中被归档，则走 `archiveAndNext` 推进（不再 skip）。
- 修改问题不重置 FSRS。front 与原 front 的 bigram 相似度 < 0.5 时，保存成功提示里追加一句「改动较大，如需按新卡重新学习，可在卡片浏览中手动重置」（只提示，不提供自动重置）。

### 3.3 第二步：AI 诊断（点击才调用）
- 新 prompt scope **`card-disambiguate` v1**（per-scope `COUNT(*)==0` 播种，与制卡族 TARGET_VERSION 无关，同 `review-answer-judge` 法；`situationRequiredFor` 返回 0）。系统提示词逐字见 §3.4。
- user 消息（由 `buildDisambiguateInput({a, b|null})` 纯函数生成，放 `disambiguateCore.mjs`）：
```
【卡 A】
问题：{A 当前编辑框里的 front（含 contextPrefix 前缀，用「前缀 + 问题」拼接）}
答案：{A back}
来源：《书名》 · 作者 · 章节锚
A 的原文：{原文 ≤1500 字，或「（无原文记录）」}

【卡 B】（单卡模式时整块替换为「【模式】单卡：用户认为卡 A 本身问得不清，没有对照卡。」）
…同上…
```
- 输出 JSON（模型侧）：
```json
{
  "verdict": "missing-qualifier | one-wrong | duplicate | confusable | no-conflict | insufficient",
  "explanation": "≤150 字",
  "evidence": [{"card": "A|B", "quote": "从该卡原文逐字摘出的片段 ≤80 字"}],
  "fixes": [{"card": "A|B", "field": "contextPrefix|front|back", "after": "修改后的完整字段值"}],
  "wrongCard": "A|B|null",
  "keepCard": "A|B|null"
}
```
- 本地出层校验 `validateDisambiguateOutput(raw, {hasB, originA, originB})`（`disambiguateCore.mjs`，纯函数）：
  - 先用既有 balanced-brace 思路提取 JSON；解析失败 → `{verdict:"insufficient", explanation: 原文前 150 字, evidence:[], fixes:[]}`。
  - verdict 不在枚举 → insufficient。单卡模式下 duplicate/confusable → insufficient。
  - evidence：card 非 A/B、或单卡模式出现 B → 丢弃；quote 经空白归一后**必须是对应原文的子串**，否则标 `verified:false`（UI 显示「未能在原文中核实」，灰显，不丢弃）；原文缺失时一律 `verified:false`。
  - fixes：card/field 枚举外、单卡模式 card=B、after 空或 >500 字、after 与当前值相同 → 丢弃。
  - wrongCard/keepCard 非枚举 → null；verdict=one-wrong 时 wrongCard 为 null → 降级为 insufficient；verdict=duplicate 且 keepCard 为 null → keepCard="A"。
  - explanation 截断 150 字。
- UI 按 verdict：
  | verdict | 标题 | 动作 |
  | --- | --- | --- |
  | missing-qualifier | 两张都对，前提不同 | 列出 fixes：每条显示「卡 X · 字段」+ 原值→新值（公共前后缀之外的差异段高亮）+「采纳」 |
  | one-wrong | 卡 {wrongCard} 可能有误 | fixes 同上 + 「归档卡 {wrongCard}」 |
  | duplicate | 重复，只是说法不同 | 「归档卡 {非 keepCard}」（默认建议），也可选归档另一张 |
  | confusable | 两个概念确实易混 | 「生成对比卡」→ 内嵌 `ContrastDraftList` |
  | no-conflict | 没有冲突 | 只显示解释 |
  | insufficient | 依据不足，无法判断 | 只显示解释，提示可手动修改 |
  - 所有 verdict 都显示 explanation 与 evidence 列表。
  - 「采纳」只把 after 写入第二屏对应编辑框（标为已改，可再手改），**不直接落库**；落库统一走「保存修改」。
  - 归档 = `cardsApi.batch("archive", [id])`（D102 语义，无 FSRS 写），二次确认。
  - 诊断完成即写/更新 `card_links`：verdict 与 explanation（≤500 字）。同一弹窗会话只写一条（后续更新同 id）。
- ④ 对比卡生成：`generateContrastDrafts({a, b})`——material 改为 A、B 两张卡的问题/答案/来源完整文本（不再发 500 条候选），focus 改为「A、B 已由用户确定为易混对，按对比卡规则产三件套」；走现有 `card-contrast` 模板；草稿入库沿用 `createAcceptedCard`，siblingKey 用 `act:contrast-<uuid>`，`sourceTitle` 取 A 的来源（三张卡都同时引用 A、B，contextPrefix 已含「对照:A vs B」）。

### 3.4 `card-disambiguate` v1 系统提示词（逐字）
```
你是记忆卡片辨析员。用户在复习时发现卡 A（以及对照卡 B）的问题相近但答案看起来矛盾，或卡 A 本身问得不清。你的任务是诊断原因并给出最小修改方案。

【判定类别（只能选一个）】
- missing-qualifier：两张卡（或单卡的唯一合理解读）都没有错，矛盾来自限定条件缺失——如不同人物/学派的观点、作者本人观点 vs 作者转述或批判的对象、「主张应当如何」vs「实际如何运作」、不同时代/地域/范围、不同理论框架或定义口径。
- one-wrong：其中一张卡的答案与它自己的原文不符，或问题与答案不对应。
- duplicate：两张卡考的是同一知识点，只是措辞不同（答案并不真正矛盾）。
- confusable：两张卡都对且限定清楚，只是两个概念本身相似、容易混淆。
- no-conflict：两张卡并不矛盾，是用户记混了。
- insufficient：现有信息（含原文）不足以判断。宁可选它，也不要猜。

【依据】
- 判断必须以每张卡自己的【原文】为准；原文缺失时只能依据卡面本身，并在 explanation 中说明「无原文记录」。
- evidence 里的 quote 必须从对应卡的原文中逐字摘录（≤80 字），不得改写、不得拼接、不得编造。原文缺失则 evidence 为空数组。
- 禁止使用原文之外的知识来判定「谁对谁错」；外部常识只可用于提示「可能需要核实」。

【修改方案（fixes）】
- 只改必要的字段，改动越小越好：missing-qualifier 时通常只在 front 或 contextPrefix 补一段短限定语（≤12 字），例如把「优绩主义主张按什么分配…」改为「据桑德尔转述，优绩主义主张按什么分配…」或「优绩社会实际上按什么分配…」。
- 补限定后，每张卡仍须一卡一问、答案简短；不得把答案内容写进问题（泄题）。
- after 填修改后的完整字段值，不是差异片段。
- one-wrong 时修正错误卡的 back（或 front），并在 wrongCard 标明哪张；duplicate 时在 keepCard 标明建议保留措辞更好的一张；confusable / no-conflict / insufficient 时 fixes 为空数组。
- 单卡模式没有卡 B：只能输出 missing-qualifier / one-wrong / no-conflict / insufficient，fixes 只能改 A。

【输出】严格输出 JSON，不输出其他文字：
{"verdict":"…","explanation":"≤150 字，说明为什么","evidence":[{"card":"A","quote":"…"}],"fixes":[{"card":"A","field":"front","after":"…"}],"wrongCard":null,"keepCard":null}
```

### 3.5 复习页「已辨析」提示
- ReviewView 换卡时 `cardLinks.listForCard(current.id)`（失败静默）。有链接且 **答案已翻开** 时，在背面辅助区底部显示一行小字：`已与「{对端 front ≤30 字}」辨析` + verdict 中文名；点击 → 打开 DisambiguateModal（presetOther=对端 id）。单卡链接显示「已辨析（单卡）」。翻开前不显示（防止泄题）。

## 4. 手动制卡预防

### 4.1 保存前相似卡预检
- `ManualCardEditor` 点「创建卡片」时先 `findSimilar(front 文本, 3)` → `cardsApi.get` 补全答案与来源。无命中直接保存（现状路径）。
- 有命中：保存按钮上方展开「相似已有卡」面板（不弹窗），每条显示问题/答案/来源与相似度；若某条答案与本卡 back 的 bigram Jaccard < 0.3，标「答案不同」。三个按钮：「仍然保存」（走原路径）、「保存并辨析」（保存后以新卡为 A、该条为 B 打开 `DisambiguateModal` origin="manual"）、「返回修改」（收起面板）。
- 面板只出现一次：用户修改 front 后再次保存才重新检索。
- 保存后 S1 落 card_issues 的既有逻辑不变。

### 4.2 来源自动填充
- 手动制卡在阅读器/摘录复习上下文中：`sourceRef` 自动 `{title: 书名, author: 作者}`（作者有值才写）——如编辑器已有来源字段则作为预填可改，否则静默写入。

### 4.3 CardLint L18（info，不阻断）
- 判定函数 `needsAttribution(front, contextPrefix)` 导出自 `src/lib/cards.ts`（供 L18 与 AIPanel 复用）：
  - front（去掉 cloze 语法后）含观点词 `/认为|主张|观点|学派|流派|声称|提出|倡导|批判/`；
  - 且 contextPrefix 为空或仅是领域词（不含「:」前的人名——判定法：contextPrefix 去尾部冒号后 ≤4 字且不含「·」「（」视为领域词）；
  - 且观点词之前的主语为空或为泛指词（`这|该|其|他|她|他们|有人|一些人|某些人|人们|作者|材料`）——「材料中的作者认为」视为已按 R19 处理，不报；
  - 满足以上三条报 L18：`含观点性措辞但未写明是谁的观点或在什么前提下成立（如「桑德尔认为…」「在…看来」）`。
- `lintCard` 增 L18；AI 卡与手动卡一视同仁（§6.3.4 原则）。

## 5. 任务拆解表

| # | 任务 | 执行者 | 涉及文件 | 验收（可机械检查） | 依赖 |
| --- | --- | --- | --- | --- | --- |
| T1 | 修复复习页对比卡弹窗渲染遗漏（过渡，随 T5 被替换） | Opus（主控，单行） | ReviewView.tsx | tsc 0 | — |
| T2 | §1.1 作者字段 + 导入元数据 + IPC + 书架编辑；§1.3 sourceRef.author | Sonnet | db.js, main.js, preload.js, importers.js, library.ts, Bookshelf.tsx, cards.ts, manualCard.ts | tsc 0；新增 node 测试：迁移后列存在、setLibraryItemAuthor 规则；F21 通过 | — |
| T3 | §2 语境包 + R21 + qualifier + AIPanel 标签与补限定 | Sonnet | cards.ts, useSelectionActions.ts, Reader.tsx, ExtractReviewView.tsx, reader/kernel.ts, foliate/pdf adapter, tocPath.ts, selectionContext.ts, prompts.js, db.js, AIPanel.tsx | tsc 0；tocPath/headingPathAt/paragraphContext node 单测；prompts.js 含 R21 原文；F06 通过 | T2 |
| T4 | §1.2 card_links + §3.2 打分 + §3.3 校验/输入构造 + §3.4 播种 | Sonnet | db.js, main.js, preload.js, cardLinks.ts, src/lib/disambiguateCore.mjs(+.d.mts), prompts.js | node 单测覆盖 rank/validate/build 全部分支；F11/F21 通过 | T3 |
| T5 | §3 DisambiguateModal + 入口替换 + 命令 E + 已辨析提示 + ContrastDraftList | Sonnet | DisambiguateModal.tsx, ContrastDraftList.tsx, ReviewView.tsx, CardBrowser.tsx, commands.ts, cards.ts | tsc 0；build 成功；F20 通过；GUI 冒烟：复习页按 E 弹窗出现、候选列表渲染、关闭后跳过 | T4 |
| T6 | §4 手动制卡预检 + 来源填充 + L18 | Sonnet | ManualCardEditor.tsx, manualCard.ts, cards.ts, SelectionPanels.tsx | tsc 0；L18 node 单测（正例/反例各 ≥4） | T5 |
| T7 | 指导文档登记（版本 v48.77、D121、§4.1 表与列、§4.2 接口、§6.3.3/§6.3.4、§7.4 scope、命令表、§9.2） | Sonnet | AI_DEVELOPMENT_GUIDE.md, AGENTS.md(如需) | F11/F18/F20/F21/F24/F27 通过（与 main 基线对照） | T6 |
| T8 | 全量回归运行并对照 main 基线报告 | Haiku | — | 报告每套件通过数/失败项 | T7 |
| 审查 | 每个 T 完成后代码审查 | Opus | — | — | — |
