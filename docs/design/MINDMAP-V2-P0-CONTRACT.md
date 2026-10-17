# 材料导图 v2 · P0 基准实验 · 模块接口契约（v1）

> 上游：`docs/design/MINDMAP-V2-FAST-PROGRESSIVE.md` rev.2（§6 管线、§7 封顶、§8 类型与关系、§9 行协议与校验、§15.3 版式）。本文件只定 P0 所需三个模块的**接口**，语义以上游设计稿为准；冲突时以设计稿为准并在本文件追记。
> P0 范围：新建独立模块 + prompt-lab 基准页；**不接入主软件引擎、不改 `electron/mindmapEngine.js` / `electron/prompts.js` / 主软件 UI / schema**。

## M1 `electron/mindmapBlocks.js`（CommonJS，纯函数，零依赖）— T3

```js
const BLOCKS_VERSION = 1;
segmentBlocks(linear: string, opts?: { maxLen?: 600, minLen?: 20, headingMax?: 40 }) -> Block[]
// Block = { no: number /* 1 起，全材料递增 */, start: number, end: number /* UTF-16 [start,end)，指向去首尾空白后的文本 */, heading: boolean }
renderNumbered(linear, blocks, fromNo, toNo) -> string   // 每块一行 "[n] 文本"（块内换行替换为空格），"\n" 连接
blockRangeToSpan(blocks, fromNo, toNo) -> [start, end]   // 闭区间块号 → 一维码元区间
blockTextLength(blocks, fromNo, toNo) -> number          // 区间内块文本码元总长
```

切分规则（设计稿 §6.1-3）：段落＝以换行分隔的非空行；>maxLen 的段按句末标点（。！？!?；; 以及后随空白的 `.`）在 ≤maxLen 处最近的位置切，找不到则硬切 maxLen；<minLen 的非标题碎块并入**下一**块（末块并入上一块）；标题判定＝长度 ≤headingMax 且不以句末标点结尾的行，标题独立成块、不参与合并。同一输入恒同一输出。

## M2 `electron/mindmapOutline.js`（CommonJS，纯函数，零依赖）— T4

```js
TYPES       // 设计稿 §8.1 类型表全部中文标签 + "其他"
PATTERNS    // { 树:'tree', 链:'chain', 时间线:'timeline', 分层:'layered', 论证:'argument', 对照:'compare', 网格:'grid' }
REL_CODES   // ['支','驳','据','推','因','比','例','答']
createLineParser(opts) -> { push(chunk: string): void, end(): Stats }
// opts = {
//   scope: { blockFrom, blockTo },      // 本次调用可用块号闭区间（顶层节点的父区间）
//   basePath?: string,                  // expand 时目标节点路径（如 "2.4"）；模型输出相对路径 "1","1.2"… 解析器映射为 "2.4.1"…；outline 时省略
//   refs?: Set<string>,                 // 允许引用的外部短号（输入清单里的 "#k7" 等，含 '#'）
//   maxRelsPerNode?: 3,
//   onNode(node), onDrop({ raw, reason })
// }
// node = { path, parentPath /* 顶层= basePath ?? null */, type, title, time /* 〈〉内容或 null */,
//          blockFrom, blockTo, more /* '+' true / '.' false */, pattern /* 英文键或 null */,
//          rels: [{ code, target /* 绝对路径或 '#k7' */ }], warnings: string[] }
// Stats = { lines, accepted, dropped, byReason: { [reason]: n }, relsDropped, clamped }
isLocalFloor({ blockFrom, blockTo }, blocks, depth) -> boolean   // 设计稿 §7 第 1 道门（本地确定性下限）
```

行语法（设计稿 §9.1）：`层级号 [类型] 标题 [〈时间〉] @起块-止块 (+|.) [{版式}] [&码目标 …]`。容忍：行首 `- ` / `* ` / 缩进、``` 代码围栏、全角括号【】、`@12–15` / `@12~15` / `@12`（单块）、行尾多余空白。校验与丢弃理由（`reason` 取值）：`unparsable` / `orphan`（父路径未出现）/ `out_of_scope`（与父区间无交集；有交集则钳制并 `clamped++`）/ `duplicate`（同父同标题或同区间，后者丢）/ `truncated`（`end()` 时残行不完整）。未知类型→`其他` 并加 warning；笼统空盒标题（概述/内容/相关知识/其他/总结/基础/核心 等）加 warning 不丢；关系目标须为**本次已出现**路径或 `refs` 中短号，否则丢该关系（`relsDropped++`）不丢节点；自指丢弃。

v1.1：关系目标允许前向引用，延迟解析，onRel 回调（`opts.onRel({ from, code, target })`；挂起关系计入每节点上限 3，`end()` 时未解析者丢弃并计入 `relsDropped`）。

## M3 `prompt-lab/mindmapV2Prompts.js`（CommonJS）— T1

```js
PROMPT_VERSION = 1
OUTLINE_SYSTEM, EXPAND_SYSTEM, EXPLAIN_SYSTEM : string
buildOutlineUser({ title, path: string[] /* 结构路径 */, numberedText, depth /* 目标层数 */, refs?: [{ id:'#k7', title }] }) -> string
buildExpandUser({ title, ancestors: string[], siblings: string[], node: { title, type }, numberedText, depth, refs? }) -> string
buildExplainUser({ title, ancestors: string[], node: { title, type }, numberedText }) -> string   // 输出 2–4 句纯文本
targetDepth(charCount) -> number   // ≤3000→4；≤12000→3；更大→2（设计稿 §6.2）
```

输出只能是行协议（outline/expand）；expand 输出相对路径从 `1` 开始。few-shot 至少覆盖：论证、证明、对照、叙事/时间线。

## M4 prompt-lab「导图 v2 基准」页 — T2

依赖 M1–M3；复用 `electron/ai.js` 的 `chatStream`（与 prompt-lab 现有用法一致，模型＝测试台当前 AI 配置）。验收见交接包。
