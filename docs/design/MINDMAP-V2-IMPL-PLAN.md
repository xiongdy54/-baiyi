# 材料导图 v2 · 主软件实施方案（MINDMAP-V2-IMPL-PLAN v1）

> 依据：`docs/design/MINDMAP-V2-FAST-PROGRESSIVE.md` rev.2（「设计稿」）+ `docs/design/MINDMAP-V2-P0-CONTRACT.md` v1.1（「契约」）。
> 用户 2026-10-17：「请直接在主软件里实施吧，也可以根据主软件里的效果调整。」——prompt-lab 将被淘汰，P0 基准取消，真实模型实测改由用户在主软件内完成（面板内置实测读数条）。
> 登记：`AI_DEVELOPMENT_GUIDE.md` v49.19 / **D192**。
> 沙箱事实：能跑纯 node 测试与 `node node_modules/typescript/bin/tsc --noEmit -p .`；不能跑 Electron、`vite build`（esbuild/rollup 仅 win32 二进制）、better-sqlite3、模型 API。需 Electron 的测试按 `@runtime: electron` 惯例写好，由用户在 Windows 跑。**任何代理禁止运行 git。**

## 0. 对设计稿的六处偏差（已定，按此执行）

| # | 设计稿 | 现状约束 | 处理 |
|---|---|---|---|
| X1 | §6.1-2 当前章节先取文 | 块号须全材料递增 | 每单元各自切块后全局编号（`segmentUnits`），单元**按文档顺序**送入主进程；每送完一个单元其作用域即可排队；调度上当前阅读章节仍优先 |
| X2 | §9.3 `ai.js` 新增 `chatStreamLines` | `mindmapOutline.createLineParser().push()` 已有行缓冲 | `ai.js` 只加可选 `model` / `maxTokens`；引擎把 delta 交 `parser.push`，不写第二份行缓冲 |
| X3 | 基准 planScopes 合并 <800 字章 | 合章后一个顶层节点跨两个目录节点，违反 §15.1 唯一归属 | **不合章**：每个拥有原文的目录节点一个作用域；<400 字直接 floor 零调用；>20,000 字按块边界切 ≤12,000 字子作用域、挂同一目录节点下 |
| X4 | §10.3 悬停预取默认开 | §4.19-12 要求用户主动触发 + 发送前预览 | 预取只在用户已对该图主动发过 AI 请求后生效（确认过整图生成，或本会话手动深挖过一次）；整图生成按钮旁显示预估（段数/字数/模型/预计调用数）作为发送前预览 |
| X5 | §15.8 每帧重绘 | v1 每次渲染整份过 DOMPurify，2,000 节点每帧太贵 | 帧内所有文本经 `escapeXml` 严格转义写入（单测守护恶意标题）；DOMPurify 只用于导出 SVG。**code-reviewer 必审** |
| X6 | 节点 id＝全局短号 k7 | 4 路并发按到达顺序分号不确定；缓存回放 `#k7` 会错指 | **路径式 id**：outline＝`作用域id + 层级号`（`t3.2.1`），expand＝`目标id + 相对层级号`（即解析器 `basePath`）；提示词里的 `#k` 改为**每次调用一张别名表**（按引用清单顺序确定性编号），缓存文本哈希含此表 |

## 1. v1 集成面（现状调用链）

1. 宿主 `src/components/Reader.tsx` 侧栏打开时挂载 `<MindmapTab kernel documentId title canvasHost initialMapId initialResumeRunId onJumpToText onMakeCardsFromNode>`；`onMakeCardsFromNode` → `runAICards(section, undefined, "card-structure", { focus, mindmapNodeId })`；`cards.context_ref_json.mindmapNodeId` 反查学习状态（`db.listMindmapLearningStatus`，LIKE 匹配）。
2. 取文：MindmapTab 挂载时 `kernel.getSectionAnchors()` 后**串行**全部 `getSectionText`，组成 `{tocItems(flattenToc(kernel.getTOC())), unitAnchors, textByUnit}`，每次生成/深挖整包随 IPC 发送。
3. IPC（`electron/main.js` 约 1746–1854；`preload.js` 暴露 `window.mindmapAPI`；`src/lib/mindmap.ts` 的 `mindmapApi` 类型化包装）：`mindmap:preview/generate/deepen/pendingRuns/cancel/repairConfirm/list/get/getActive/mapTree/setActive/delete/runs/learningStatus`。
4. 引擎 `mindmapEngine.generate/deepen` 用 `ctx.chat = mindmapChat`（把 `chatStream` 攒成全文，不流式）；线性化 `mindmapCore.buildLinearization`（单元间 `"\n"`，D44 UTF-16 坐标）。
5. 进度：`ctx.broadcast` → `mindmap:changed` → `installMindmapBridge` → EventBus `mindmap/changed`；消费者 `src/lib/activity.ts` `applyProgress`（runId/stage/done/total/calls/budget/mapId/published；阶段归一 `STAGE_ALIAS/KNOWN_PHASES`）与 MindmapTab。指示器 `BackgroundActivity.tsx` 取消走 `mindmapApi.cancel(runId)`；重启 `reconcileStaleMaterialMapRuns`→`interrupted`，`listResumableMaterialMapRuns`→「继续生成」→ `initialResumeRunId`。
6. 库：`material_maps`（`structure_json` 内嵌节点；同文档单 `is_active`；删除物理删，§7.2 已登记）、`material_map_shards`（缓存，唯一索引含 provider/model/modelConfigHash）、`material_map_runs`、`material_map_calls`（账本，已有 ttft_ms/first_byte_ms/depth/parent_node_id/span_chars，守卫式 ALTER 补列）。提示词由 `db.js` `ensurePromptTemplates` 按 `MM_TARGETS` 补播 5 个 `material-map-*` scope。
7. 版本区：`mindmapApi.list`；`setActive` 切换；`remove` 删除。
8. 结构制卡语义包：`src/lib/mindmap.ts` `buildStructureCardPackage(node, structure, 1200)`（title/authorialRole/centralQuestion/mainMove/progression/relationToParent/groupingBasis、父链、直接子结构、证据 ≤6、`structure.summaryText`；`unitAnchors` 取 `node.unitAnchors`）。
9. 跳正文：`kernel.goTo({href: unitAnchors[0]})` + quote 前 20 字 `goTo({search})` best-effort + `onJumpToText()`。
10. 设置：`app.mindmapMaxCalls/mindmapConcurrency/mindmapRetryMax/mindmapPricing/mindmapSectionChunkChars` 仅 mindmapEngine 读；`SettingsPanel.tsx` 目前无导图小节。

**复用**：`mindmapBlocks.js`（追加 `segmentUnits`）、`mindmapOutline.js`、`mindmapCore.buildTocTree/normalizeTocTree/buildExtractionModel/buildLinearization`、`chatStream` 重试与 TTFT 打点、`material_map_shards`（作 v2 缓存）、`material_map_calls`（补列）、`material_map_runs`（降级为一次用户动作）、`mindmap:changed` + 指示器、`mindmap:list/get/getActive/setActive/delete/runs/pendingRuns/learningStatus/cancel`、card-structure 链路、`kernel.goTo`。
**替换**：MindmapTab 的生成/深化/续跑状态机；`src/lib/mindmap/{layout,render}.ts` 由 `src/lib/mindmap/v2/*` 承接；新增提示词 scope `material-map-outline/expand/explain`；取文改为逐单元送入主进程常驻缓存。
**保留不动到 P5**：`mindmapEngine.js` 全部、`mindmap:preview/generate/deepen/repairConfirm/mapTree`、5 个旧 scope 与播种、`src/lib/mindmap/{layout,render}.ts`、`tests/m15r.*`（保持绿）、`prompt-lab/*`（`mindmapV2Prompts.js` 改为转发新模块的薄壳）。

## 2. v1 → v2 切换

1. 新生成一律 v2；UI 不再调用 `mindmap:generate/deepen/repairConfirm/preview`；无引擎开关。
2. 统一读取口 `mindmap:graphLoad(mapId | {documentId})` → `{ meta, nodes, edges, view, textReady }`：v2 图读 nodes/edges 表；v1 图经 `adaptV1Structure(structure, blocks?)`——`authorialRole`→v2 类型（映射表在 `mindmapV2Core.js`）、`sourceSpans`→相交块区间（原文未送入时区间留空、节点照常显示）、状态（有 childIds→open；`expandable!==false` 且有区间→more；否则 floor）、已有 centralQuestion/mainMove/relationTo* 合成 explain（零调用）；再叠加同 mapId 在 nodes 表里的 v2 深挖产物（parentId 可指向 v1 节点 id）。不批量转换（Q8）。
3. 旧 v1 图只读：不重排不精修；仅 `more` 末端可深挖，产物写 v2 节点表；v1 `structure_json` 永不改写。
4. `isActive`＝当前显示的版本：「生成/重新生成」新建版本行（`generator_version='m15v2-engine-1'`），先不激活、写入骨架节点；**首个 AI 节点批次提交时激活**，旧激活版本降为历史；未提交任何 AI 节点就失败/取消→旧图完全不受影响。深挖/explain/改视图写当前行不新建版本。版本区 v1/v2 混排，每行加「v2 / 旧版」小标；setActive/删除通道不变；删除连带物理删除该版本 nodes/edges（扩展 §7.2 例外）。Published/Candidate、section_ready、review_failed 在 v2 不再出现。
5. 中断恢复：生成 run `input_json={engine:'v2', mapId}`；重启后既有对账仍标 `interrupted`→指示器「继续生成」→打开页签后 `graphResume(runId)` 把**尚未 outline 的作用域节点**（source='toc'、state=more、无 AI 子节点）重新排队。不新增状态机。

## 3. 数据层

### 3.1 DDL（挂在 `db.js` initDb 的 v48 导图建表段之后，沿用 `try { CREATE … IF NOT EXISTS } catch {}` 守卫）

```sql
CREATE TABLE IF NOT EXISTS material_map_nodes (
  id TEXT PRIMARY KEY,                -- `${map_id}|${node_id}`
  user_id TEXT NOT NULL, map_id TEXT NOT NULL, node_id TEXT NOT NULL,   -- 路径式 id（X6）
  parent_id TEXT, ord INTEGER NOT NULL,          -- ord = 起始块号*1000 + 序（S1 原文顺序）
  title TEXT NOT NULL, type TEXT NOT NULL, time_text TEXT, pattern_hint TEXT,
  block_start INTEGER, block_end INTEGER, spans_json TEXT,
  state TEXT NOT NULL,                -- more | open | floor | stub（streaming 只在内存）
  source TEXT NOT NULL,               -- toc | ai | local（桩）| v1ext
  warnings_json TEXT, explain_json TEXT, job_id TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  sync_version INTEGER NOT NULL DEFAULT 0, is_deleted INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mmnodes_key ON material_map_nodes(map_id, node_id);
CREATE INDEX IF NOT EXISTS idx_mmnodes_parent ON material_map_nodes(map_id, parent_id, ord);
CREATE TABLE IF NOT EXISTS material_map_edges (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, map_id TEXT NOT NULL,
  from_id TEXT NOT NULL, to_id TEXT NOT NULL, code TEXT NOT NULL,   -- 支驳据推因比例答
  origin TEXT NOT NULL DEFAULT 'text', job_id TEXT,
  created_at INTEGER NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mmedges_key ON material_map_edges(map_id, from_id, to_id, code);
CREATE INDEX IF NOT EXISTS idx_mmedges_to ON material_map_edges(map_id, to_id);
ALTER TABLE material_maps ADD COLUMN view_json TEXT;  -- { patterns:{nodeId:key}, collapsed:[…] }
-- material_map_calls 守卫式补列：model TEXT, ttfn_ms INTEGER, lines INTEGER, lines_dropped INTEGER,
--   drop_json TEXT, rels_dropped INTEGER, reasoning_chars INTEGER, trigger TEXT  -- click|prefetch|auto|all
```

v2 版本行 `structure_json` 只存元信息 `{schemaVersion:2, title, blocksVersion, outlineVersion, promptVersions:{outline,expand,explain}, model}`（满足 NOT NULL；无 `nodes` → `mindmap:mapTree` 对 v2 自然返回 null）。

### 3.2 仓储 API（`db.js` 导出）

```js
createMaterialMapV2({ documentId, title, meta, skeleton: NodeRow[], sourceRevisionHash, provider, model, modelConfigHash, promptVersion }) -> { mapId }   // 不激活
commitMaterialMapJob({ mapId, jobId, upserts: NodeRow[], states: {nodeId,state}[], edges: EdgeRow[], activate?: boolean }) -> { nodeCount }
listMaterialMapNodes(mapId) -> NodeRow[]          // parent_id, ord 排序
listMaterialMapEdges(mapId) -> EdgeRow[]
setMaterialMapNodeExplain(mapId, nodeId, explain: { text, model, promptVersion, at })
setMaterialMapView(mapId, view)                   // getMaterialMap 返回新增 view、schemaVersion
countMaterialMapCallsSince(documentId, { trigger, sinceMs }) -> number
saveMaterialMapCall({...现有字段, model, ttfnMs, lines, linesDropped, dropJson, relsDropped, reasoningChars, trigger})
deleteMaterialMap(id)                             // 同事务连带物理删除 nodes/edges
// NodeRow = { nodeId, parentId, ord, title, type, time, pattern, blockStart, blockEnd, spans, state, source, warnings, explain, jobId }
// EdgeRow = { fromId, toId, code, origin, jobId }
```

### 3.3 落盘纪律（不变量 4）
`commitMaterialMapJob` 用 `withTransaction`（BEGIN IMMEDIATE）一次写完节点 upsert/状态/边/node_count/可选激活，提交后 `persist()`——落库粒度＝一个任务；流式中只经 `mindmap:delta` 推内存，**无需登记例外**。explain/view/call 写入各自 `persist()`；视图只在离散动作（切版式、折叠）写，平移缩放不写。崩溃只丢正在流式的那个任务，重启后对应节点仍 `more`。

## 4. 主进程引擎 v2

### 4.1 模块（CommonJS；除接线层外依赖注入，node 可测）

| 文件 | 职责 |
|---|---|
| `electron/mindmapBlocks.js`（追加） | `segmentUnits(linearization) -> Block[]`（每单元 `segmentBlocks` 后按 unitBase 平移、全局重编号，块加 `unit` 字段）；常量 `UNIT_BLOCKS_VERSION=1` |
| `electron/mindmapV2Core.js`（新，纯） | 骨架（目录→NodeRow，复用 core 含「正文」伪节点修复）；作用域规划（X3）；按序送入时只放出已定型作用域（前缀稳定）；别名表与可引用清单（X6）；解析节点→NodeRow 状态判定（封顶 1、2 门）；第 3 门回判；覆盖缺口「其余 N 段」桩；`finish_reason=length` 祖先回标 more；v1 适配器与类型映射；结构语义包字段派生；缓存键 |
| `electron/mindmapV2Prompts.js`（新，迁自 prompt-lab） | `buildOutlineUser/buildExpandUser/buildExplainUser/targetDepth`、`PROMPT_VERSION`；system 文本由 `prompts.js` 导出 |
| `electron/mindmapScheduler.js`（新，纯） | 优先级队列、并发阶梯、节点锁、去重、提档、取消（注入 now/setTimeout） |
| `electron/mindmapEngineV2.js`（新） | 会话与原文缓存、任务编排、缓存、账本、增量广播、读数（注入 store/chatStream/readSettings/getAIConfig/getPromptTemplate/broadcastChanged/broadcastDelta/now） |
| `electron/main.js`（接线） | store 门面（db 函数子集）、注册 IPC、两条广播 |

### 4.2 IPC（名字不带数字；全部写进 §4.19）

| 通道 | 载荷 → 返回 |
|---|---|
| `mindmap:graphLoad` | `(mapId \| {documentId})` → `{ meta, nodes: V2Node[], edges, view, textReady }`（documentId 取当前激活版本） |
| `mindmap:graphFeed` | `{ documentId, title, tocItems, unitAnchors, index, text, last }` → `{ blocksReady, scopesReady }`；严格文档顺序；`last=true` 时算 sourceRevisionHash |
| `mindmap:graphEstimate` | `{ documentId }` → `{ scopes, chars, estPromptTokens, estCompletionTokens, model, concurrency }` |
| `mindmap:graphGenerate` | `{ documentId, title, force? }` → `{ runId, mapId }`（立即返回，进展走广播） |
| `mindmap:graphExpand` | `{ mapId, nodeId, trigger: 'click'\|'prefetch'\|'all', force? }` → `{ jobId, skipped?: 'floor'\|'cached'\|'quota'\|'busy' }` |
| `mindmap:graphExpandAll` | `{ mapId }` → `{ runId, queued }`（预算 `app.mindmapMaxCalls`） |
| `mindmap:graphExplain` | `{ mapId, nodeId }` → `{ jobId \| cached: true, explain? }` |
| `mindmap:graphCancel` | `{ jobId?, runId?, mapId? }` → `true` |
| `mindmap:graphResume` | `{ runId }` → `{ queued }` |
| `mindmap:graphSetView` | `{ mapId, view }` → `true` |
| `mindmap:graphMetrics` | `{ mapId }` → `RunMetrics`（重启后由账本重新聚合） |
| `mindmap:graphNodeText` | `{ mapId, nodeId }` → `{ text, unitAnchor }`（区间原文，零 AI） |
| 推送 `mindmap:delta` | `{ documentId, mapId, jobId, kind, nodes?, states?: {id,state}[], edges?, explainDelta?: {nodeId,text}, jobDone?: {ok, error?, finishReason}, metrics? }`，≤100ms 一批 |
| 推送 `mindmap:changed`（既有） | 仅「生成整图」「深挖全部」两类 run：`stage ∈ running/completed/partial/cancelled/failed`、`done/total`＝完成段数/总段数、`calls`、`label`（如「框架 3/12 段」）；单次深挖/explain/预取不进指示器 |

`RunMetrics = { model, startedAt, ttfnMs, firstTtftMs, frameworkMs, calls, cacheHits, promptTokens, completionTokens, reasoningChars, lines, linesDropped, byReason, relsDropped, concurrencyNow, rateLimitDowngrades }`

### 4.3 `ai.js` 最小改动
`chatStream({ messages, temperature, abortSignal, retry, model, maxTokens }, send)` 透传给 `chatStreamOnce`；内部 `const useModel = (typeof model==='string' && model.trim()) || cfg.model`；`bodyObj.model = useModel`；`supportsReasoningEffort(useModel)`；`maxTokens` 有限正数时 `bodyObj.max_tokens = Math.floor(maxTokens)`。**不传新参数时请求体与现状逐字节一致**（测试守护）。导图模型共用全局服务商地址与 Key。

### 4.4 提示词迁入
`prompts.js` 新增导出 `MATERIAL_MAP_OUTLINE_PROMPT / MATERIAL_MAP_EXPAND_PROMPT / MATERIAL_MAP_EXPLAIN_PROMPT`（逐字迁自 `prompt-lab/mindmapV2Prompts.js`）；`db.js ensurePromptTemplates` 新增 scope `material-map-outline`「导图框架 v1」/ `material-map-expand`「导图深挖 v1」/ `material-map-explain`「节点讲解 v1」，目标版本 1，沿用低于目标即插入，`situationRequiredFor` 返回 0。引擎运行时 `getPromptTemplate(scope).content` 作 system。`prompt-lab/mindmapV2Prompts.js` 改薄壳；`tests/m15v2.prompts.test.cjs` 引新模块并断言三常量 === few-shot 守护文本。

### 4.5 缓存键（复用 `material_map_shards` 唯一索引）
`unit_anchor`＝`blk:${from}-${to}`（expand 加 `#${nodeId}`）；`run_kind`＝outline/expand；`granularity`＝'v2'；`prompt_scope/prompt_version`；`text_hash`＝sha256(用户消息全文，含带号原文/层数/别名表)；`provider/model`＝实际模型；`model_config_hash`＝sha256([model, reasoningEffort(仅 GLM5.2+), 'm15v2-engine-1', UNIT_BLOCKS_VERSION, OUTLINE_VERSION, maxTokens])；`content_json`＝`{ lines: 已接受原始行[], finishReason }`。命中时重新喂解析器得相同节点；命中不写账本、`cacheHits+1`。explain 缓存在 `explain_json`。

### 4.6 账本 `material_map_calls`
每次真实调用一行：run_kind(outline/expand/explain)、node_anchor、chars、span_chars、depth、parent_node_id、outcome(completed/failed/cancelled/unknown_outcome)、finish_reason、wall_ms、ttft_ms、first_byte_ms、prompt/completion_tokens + 新列 model、ttfn_ms、lines、lines_dropped、drop_json、rels_dropped、reasoning_chars（累计 `send({thinking})`）、trigger。run 归属：整图生成/深挖全部各自一行 run；单次深挖/explain/预取归「交互容器 run」（同图同应用会话一行，status='completed'，`input_json.kind='interactive'`，不参与对账续跑）。

### 4.7 封顶三门
① 本地：`nodeStateOf(parsed, blocks, depth)` 调 `isLocalFloor`；作用域 <400 字 outline 前即 floor；不出＋、调度器拒收。② 模型 `.`→floor；outline 最末层行尾 `+` 才 more。③ `recheckAfterExpand(target, children)`：直接子 <2 或子覆盖同一块→丢弃唯一子节点、目标 floor、照常写缓存（再点零调用）。逃生口 `graphExpand({force:true})`（详情底部小字「仍要尝试深挖」）跳过 ②③，① 仍生效。

### 4.8 调度器 `createScheduler({ maxConcurrency, now, setTimeout })`
优先级 P0 点击深挖/explain > P1 悬停预取 > P2 首轮 outline（当前阅读与视口内章节先，其余文档顺序）> P3 深挖全部；同级 FIFO（确定性序号）。`enqueue({ key, priority, lockKey, run(signal) })`：同 key 去重；已排队低优先级被同 key 高优先级**提档**；`lockKey=mapId|nodeId` 同节点串行。并发阶梯：起始 `app.mindmapConcurrency`（默认 4，夹 1–8）；任务报 rateLimited → 减半 + 60s 冷却；连续 3 次成功升一档至配置值。`cancel(key)` / `cancelWhere(pred)`：排队移除、运行中 abort，已提交不受影响。生命周期主进程持有，离开页签不取消。

### 4.9 任务执行
- 会话：每 documentId 一份 `{ linear, blocks, units, scopes, title }` 内存，LRU 3 文档；原文不入库。深挖时原文未送入→「等待原文」，`graphFeed` 送到对应单元后自动放行。
- outline：`buildOutlineUser({ title, path: 骨架祖先标题, numberedText: renderNumbered(scope), depth: targetDepth(chars), refs })` → 查缓存 → `chatStream({ model: mindmapModel, maxTokens: 3000, temperature: 0.3, retry })`，delta → `parser.push`；每接受节点转 NodeRow、父 more→open、进 100ms 增量缓冲广播；结束 `parser.end()`、补覆盖桩、length 回标；`commitMaterialMapJob`（本图首个 AI 批次同时 activate）；写账本；`jobDone` 广播；更新生成 run 进度、算 frameworkMs。
- expand：同流程；`buildExpandUser`（祖先/兄弟/自身区间原文）；层数＝区间 ≤8 块 1 层否则 2 层；`maxTokens: 1500`；`basePath = nodeId`；每节点关系 ≤3。
- explain：`buildExplainUser`，流式文本经 `explainDelta` 推送，结束 `setMaterialMapNodeExplain`；`app.mindmapExplainAuto` 为真时选中即发起。
- 预取：检查同意条件（X4）、`app.mindmapPrefetch.enabled`、`countMaterialMapCallsSince(documentId,{trigger:'prefetch', sinceMs: 当天零点}) < dailyLimit`（默认 30），否则 `skipped:'quota'`。
- 取消：已校验行照样落库；目标节点无子节点时保持 more。

### 4.10 指示器对接
整图生成与深挖全部发 `mindmap:changed`，阶段都在 `KNOWN_PHASES` 内 → `activity.ts` 不改代码，只新增 v2 阶段序列测试夹具。

## 5. 渲染层

### 5.1 纯模块 `src/lib/mindmap/v2/`（纯函数、确定性、无 DOM；移植自 `design-samples/mindmap-v2-canvas.html`）
| 文件 | 内容 |
|---|---|
| `types.ts` | `V2Node / V2Edge / V2View / GraphState / Delta / RunMetrics`，与主进程 DTO 字段一一对应 |
| `graph.ts` | `applyDelta(state, delta)` 纯 reducer（同节点后到覆盖）、可见集合（折叠）、祖先链、`related(id)` |
| `measure.ts` | 确定性估宽（CJK 1em、ASCII 0.55em）、卡片尺寸、4px 网格整数（不用 canvas measureText，D42） |
| `pattern.ts` | §15.4 选择器：手动 > 模型提示（校验前提）> 规则表 1–7；`materialLabel()`；S5 `lockPattern`（一个任务内最多换一次） |
| `layout.ts` | 块组合框架：每组自底向上 `{w,h,items(相对坐标),anchor}`；按「组 id + 子块尺寸序列 + 版式 + 视图」签名缓存，只重算脏祖先链；同版式嵌套并框；可见子 >12 时前 7 + 「另有 N 项」；`layoutGraph(state, opts) -> Display` |
| `patterns/{tree,chain,timeline,layered,argument,compare,grid}.ts` | 七版式，统一签名 `(header, childBlocks, ctx) -> Block` |
| `route.ts` | 端点提升到最近可见祖先、同向合并 ×N、端点已展开挂框边、跨组判定、通道绕行（障碍＝卡片 + 不含任一端点的组框）、同通道平行边 4px 分道、↗N 计数 |
| `svg.ts` | `buildCanvasSvg(display, frameState, theme, opts)`：所有文本 `escapeXml`（X5）；四态徽标（＋ / +N / • / 呼吸点）；八类关系线型（不用颜色区分）；框与「版式 · 来源」标注；导出 `{ static: true }` |
| `animate.ts` | `interpolate(from,to,e)`、进入位置（从父卡片长出）、离场淡出、锚点补偿 `compensateView(anchorBefore, targetRect, view)`、S4 单调节流（≤4 次/秒）；reduced-motion 时长 0 |

### 5.2 组件
- `src/components/reader/mindmap/MindmapCanvasV2.tsx`：rAF 驱动写 `<g>`；拖拽/点击判定（沿用 v1「位移超阈值才捕获指针」修复）；悬停 400ms 发起预取（移开取消计时）；`data-node-id / data-act="deepen"` 委托；适应窗口/缩放/键盘可达；「全部关系」「关系透视」开关；（小地图可延后）。
- `src/components/reader/mindmap/NodeDetailV2.tsx`：标题、类型、区间原文（`graphNodeText`）、explain 流式、关系清单（可点跳转、Tab/Enter 可达）、排列方式（自动 + 七版式，写 view）、跳正文、就此制卡、学习状态、「仍要尝试深挖」。
- `src/components/reader/mindmap/MetricsBar.tsx`：**实测读数条** `模型 · 首节点 x.xs · 框架完成 x.xs · 调用 N（缓存 M） · token 入/出 · 思考 N 字 · 丢弃行 a/b（按原因） · 关系丢弃 r · 并发 c（降档 d）` + 「复制读数」（多行纯文本）；数据来自 delta.metrics，重开页签调 `graphMetrics`。

### 5.3 `MindmapTab.tsx` 改造（保留文件名、Props、宿主契约）
1. 挂载先 `graphLoad({documentId})`：有图立即画（零调用）；无图用 `kernel.getTOC()` 本地画骨架预览（≤300ms）。
2. 后台按文档顺序逐单元 `getSectionText` → `graphFeed`；面板显示「正在读取原文 i/n」，不阻塞画布。
3. 生成：先显示 `graphEstimate` 预估（发送前预览），点击后 `graphGenerate`。
4. 流式合入：订阅 EventBus `mindmap/delta`（`installMindmapBridge` 新增此桥），只认当前 mapId，`applyDelta` 合入；布局节流 ≤4 次/秒；生成中以根或当前选中节点为锚（S3）。
5. 四态：more「＋」→ `graphExpand(trigger:'click')`，锚＝该节点（S3/S6）；open 加折叠「+N」；floor「•」；生成中虚线+呼吸点；stub（灰「其余 N 段」）可深挖。
6. 选中→NodeDetailV2；`mindmapExplainAuto` 为真自动 explain。
7. 就此制卡：`buildStructureCardPackageV2(node, graph)`（`src/lib/mindmapV2.ts`）——类型映射回旧 authorialRole 口径；explain 文本入「作者动作」，缺则先触发 explain；证据由区间原文截取 ≤3 段每段 ≤60 字；总长 ≤1200；`unitAnchors` 由块 `unit` 推出；`mindmapNodeId = "v2:" + mapId + ":" + nodeId`，learningStatus 同 id。
8. 跳正文：`unitAnchors[0]` + 首块前 20 字 `goTo({search})`。
9. 版本区沿用，加「v2 / 旧版」小标。
10. 删除 v1 UI 元素：预览面板、取消续跑、修复确认、覆盖审计提示；「自动深挖全部」改「深挖全部」（`graphExpandAll`）。
11. 搜索：按节点标题与 explain 文本。

### 5.4 设置页
`SettingsPanel.tsx` AI 服务区下方新增「材料导图」小节：导图模型（文本框 + 复用已拉取模型列表的下拉；留空＝跟随全局；提示推荐非推理快模型如 `deepseek-ai/DeepSeek-V4.1-Flash`）、并发数（1–8 默认 4）、悬停预取（开关默认开 + 每日上限默认 30）、选中节点自动讲解（默认关）。测速按钮本期不做（读数条承担）。写侧在 `main.js` `settings:set` 逐键字面量归一（沿用先例）；读侧在 `mindmapEngineV2` `readMindmapSettings()` 统一归一。

### 5.5 新设置键（同步 F18 `DOC_KEYS` 与 Y4 非法值清单）
`app.mindmapModel`（string，默认 ""，空＝跟随全局）；`app.mindmapPrefetch`（`{ enabled: true, dailyLimit: 30 }`，对象键形态参照 `app.extracts`）；`app.mindmapExplainAuto`（bool 默认 false，仅严格 true 为开）；`app.mindmapConcurrency`（既有，v2 读侧默认 4）；`app.mindmapMaxCalls`（既有，复用为深挖全部预算）；`app.mindmapRetryMax`（既有）。`app.mindmapRefineModel` 推到 P6。

### 5.6 i18n
新文案一律 `T("中文键")`，en/ja 补齐，`node scripts/i18n-check.mjs` 验收。

## 6. 任务拆解表

**沙箱通用前置**：TS 纯模块测试统一用新建 `tests/lib/tsload.cjs`（注册 `.ts` require 钩子，`typescript.transpileModule` 转 CommonJS，解析无扩展名导入）；v2 新测试**不得**依赖 esbuild。
**每项通用验收**：`node node_modules/typescript/bin/tsc --noEmit -p .` 为 0；改动的 `.js` `node --check` 通过；`tests/m15v2.{blocks,outline,prompts,bench}.test.cjs` 与 `tests/m15r.core.test.cjs` 保持全绿。

| # | 任务 | 模型 | 文件 | 验收（沙箱可机械检查） | 依赖 |
|---|---|---|---|---|---|
| T1 | 主进程纯核心（§4.1 mindmapV2Core 全部 + segmentUnits） | Opus | `electron/mindmapBlocks.js`（只追加）、新 `electron/mindmapV2Core.js`、新 `tests/m15v2.core.test.cjs` | ① segmentUnits ×100 逐字节一致、块号连续、unit 正确；② 任意前缀送入已放出作用域与全量规划一致；③ <400 字 floor、>2 万字切 ≤1.2 万子作用域挂同一目录节点；④ 第 3 门 0/1 子→floor 且唯一子丢；⑤ 桩仅父区间连续 ≥2 块未覆盖才生成；⑥ v1 夹具（取 `tests/m15r.engine.test.cjs` 结构形态）适配后成树、状态正确；⑦ 别名表确定性 | — |
| T2 | 数据层 + 提示词迁入（§3、§4.4）+ 内存版 store + store 契约测试 | Sonnet | `electron/db.js`、`electron/prompts.js`、新 `electron/mindmapV2Prompts.js`、`prompt-lab/mindmapV2Prompts.js`、新 `tests/lib/mindmapMemoryStore.cjs`、新 `tests/m15v2.store.contract.cjs`、新 `tests/m15v2.db.test.cjs`（`@runtime: electron`）、新 `tests/m15v2.dbstatic.test.cjs`、`tests/m15v2.prompts.test.cjs` | ① store 契约（内存实现）全绿；② prompts 测试全绿含「常量 === 迁入文本」；③ `node --check electron/db.js`；④ 静态测试确认 db.js 含 DDL/三 scope 播种；⑤ electron 测试按惯例写好 | — |
| T3 | 调度器 + 引擎 v2（§4.5–4.10） | Opus | 新 `electron/mindmapScheduler.js`、`electron/mindmapEngineV2.js`、`tests/m15v2.scheduler.test.cjs`、`tests/m15v2.engine.test.cjs` | 调度器：抢占/提档/去重/同节点互斥/429 降半冷却阶梯升档（假计时器）/取消不影响已完成。引擎（假 chatStream 分块吐行 + 内存 store）：① 基准样例产出完整树、delta 节点数递增；② 首个 delta 早于流结束；③ 同输入二次生成零调用且节点逐字节同；④ floor 节点 expand 返回 skipped:'floor' 零调用；⑤ 首个 AI 批次前失败旧激活版本不变；⑥ length 回标；⑦ 取消后已校验行落库；⑧ 预取超额 quota；⑨ 每调用一行账本字段齐；⑩ 仅整图/深挖全部发 changed 且阶段 ∈ KNOWN_PHASES | T1、T2 |
| T4 | 接线：ai.js、main.js（store 门面、§4.2 IPC、delta、settings:set 归一）、preload、`src/lib/mindmapV2.ts`（客户端/类型/delta 桥/`buildStructureCardPackageV2`）、`installMindmapBridge` 加桥、设置页小节、F18 DOC_KEYS 与 Y4、activity v2 夹具 | Sonnet | `electron/ai.js`、`electron/main.js`、`electron/preload.js`、新 `src/lib/mindmapV2.ts`、`src/lib/mindmap.ts`（只加桥）、`src/components/SettingsPanel.tsx`、`tests/flows/f18-settings-matrix.cjs`、新 `tests/m15v2.ai.test.cjs`、新 `tests/m15v2.ipc.test.cjs` | ① ai 测试（stub electron + 本地 http SSE 假服务）：不传参请求体逐字节一致 / 覆盖模型生效且 reasoning_effort 按覆盖模型判定 / max_tokens 出现；② ipc 静态测试 preload 与 main 的 `mindmap:graph*` 双向一致；③ tsc 0；④ node --check main/preload/ai/f18 | T3 |
| T5 | 画布纯模块 I：tsload + types/graph/measure/pattern/layout + tree/chain | Opus | `src/lib/mindmap/v2/{types,graph,measure,pattern,layout}.ts`、`patterns/{tree,chain}.ts`、`tests/lib/tsload.cjs`、`tests/m15v2.layout.test.cjs` | ① ×100 逐字节一致；② S1；③ S2（祖先链外子树相对坐标逐字节不变）；④ S7；⑤ 卡片不重叠；⑥ 规则表每行 ≥1 正例 1 反例；⑦ S5；⑧ 2,000 节点单组变化重排 ≤16ms（10 次中位） | — |
| T6 | 其余五版式 timeline/layered（重心法）/argument/compare/grid | Sonnet | `src/lib/mindmap/v2/patterns/*.ts`、`tests/m15v2.layout.test.cjs`（追加） | 每版式不重叠、×100 一致、S2 成立；时间线按原文顺序；论证图反驳挂其针对的反方下方；对照每行同维度对齐；网格列数 ⌈√n⌉ | T5 |
| T7 | route/svg/animate | Opus | `src/lib/mindmap/v2/{route,svg,animate}.ts`、`tests/m15v2.route.test.cjs`、`tests/m15v2.svg.test.cjs` | ① 跨组边穿卡 0（密采样几何断言）；② 同通道平行边 ≥4px；③ 路由确定性；④ 500 边 ≤30ms；⑤ 标题含 `<script>`/`&`/`"` 输出无原样标签；⑥ 锚点补偿位移 ≤1px；⑦ 单调节流框高不减；⑧ reduced-motion 插值 1 帧 | T5 |
| T8 | MindmapTab 改造 + 三组件 + theme.css + v1 兼容 + card-structure 对接 | Opus | `src/components/reader/MindmapTab.tsx`、`src/components/reader/mindmap/*.tsx`、`src/theme.css`、`src/lib/mindmapV2.ts` | ① tsc 0；② `tests/m15v2.cardpkg.test.cjs`（tsload）：v2 语义包 ≤1200、字段齐、无超长原文；③ grep 测试：MindmapTab 不再引用 `mindmapApi.generate/deepen/repairConfirm/preview`；④ 读数条字段与 RunMetrics 一一对应 | T4、T6、T7 |
| T9 | en/ja 词典补齐 | Haiku | `src/i18n/locales/{en,ja}.ts` | `node scripts/i18n-check.mjs` 退出码 0 | T8 |
| T10 | 文档登记（§8）+ GUI 套件适配（`tests/m15r.gui.mjs` 改 v2 口径；新 `tests/m15v2.gui.mjs` 骨架） | Sonnet（措辞 Opus 复核） | `AI_DEVELOPMENT_GUIDE.md`、`tests/m15r.gui.mjs`、新 `tests/m15v2.gui.mjs` | ① `node tests/flows/f11-doc-code-drift.cjs` 失败项不超出基线（基线已知红：L1 / L9 两条，见 §7.3 既有缺失文件）；② GUI 文件 node --check | T1–T9 |
| 审查 | 每批完成后 code-reviewer；X5、T3 并发、T8 v1 兼容必审 | Opus | — | 「合格」 | 每批 |

关键路径：（T1 ∥ T2 ∥ T5）→（T3 → T4）∥（T6 ∥ T7）→ T8 → T9 → T10。

## 7. 风险与 Windows 验证

| 风险 | 对策 |
|---|---|
| DeepSeek-V4.1-Flash 在硅基流动可能默认思考 | 读数条显示「思考 N 字」；>0 且首节点慢时再评估关思考参数；本期不盲发未知参数（非 GLM 模型发 reasoning_effort 会 400） |
| GLM-5.3-Flash 思考不可关 | 照常可用，读数条如实显示 |
| 4 路并发 429 | 自适应降档，读数条显示降档次数，可设并发 1 |
| 解析器容忍度不够 | 读数条按原因显示丢弃；>3% 时用户贴「复制读数」再放宽 |
| 路径式 id 使跨版本学习状态不互通 | 新卡 `mindmapNodeId` 带 mapId；remap 推到 P5/P6，§4.19 写明 |
| 每帧 innerHTML 性能 | 视口外裁剪 + 缩放 <0.5 整框收摘要卡 |
| v1 GUI 套件失效 | T10 适配；v1 图只读显示是回归重点 |

用户 Windows 验证步骤见交付说明（由总控整理给用户）。

## 8. 文档义务
1. 标题 v49.19、§8.1 **D192**（X1–X6、切换策略、scope、表、IPC、设置键）、§9.2 / §9.5 同步（P5 退役与 P6 精修/spine/微调列为后续）。
2. §4.19：生成管线改用 D192 契约——替换 §4.19-3/5（块区间，Q1）/6（逐行校验）/8（预览＝段数/字数/模型，X4）/11、v48.13 收口 ①②③④ 与 v48.x 追记的现行效力（原文保留作沿革）；§4.19-7 追加 nodes/edges/view_json 与 v2 缓存键；§4.19-9 追加结构画布、S1–S8、X5；§4.19-1、§4.19-10（追加 v2 语义包与 `v2:` 节点 id）、§4.19-12（追加 X4）、收口 ⑤⑥⑦ 保留。
3. §4.1 表数 +2（`material_map_nodes`、`material_map_edges`），`material_maps.view_json`，`material_map_calls` 新增 8 列。
4. §4 IPC 清单登记 §4.2 全部新通道与推送 `mindmap:delta`。
5. §7.2 物理删除例外扩展为「版本行及其 nodes/edges 子行」；v2 落库粒度＝一个任务（无新例外）。
6. §7.3 登记新测试（每个带 `@runtime` 头）与 `tests/lib/tsload.cjs` 用法。
7. §7.4 新 scope 三个（消费方 `electron/mindmapEngineV2.js`，旧 5 个保留到 P5）；新设置键与 `app.mindmapConcurrency` 默认值语义。
8. §8.1 D41-③④⑤、D44–D49、D84 各加「v49.19 / D192 起由 v2 替代或修订」指针；D191 标「已实施（除 P5/P6）」。

## 9. 实测后增补（2026-10-18，用户 Windows 实测反馈）

### 9.1 修复
- `npm run dev` 曾因「dist 存在即优先」加载旧构建：dev 脚本改为 `electron . --dev-server`（df79865）。
- 画布空白：React StrictMode 双挂载下 rafRef 未置空 → 从不绘制；关系 0 条：`material_map_edges` INSERT 列数不符；解析器同父同区间判重 → 改接受（OUTLINE_VERSION 2）（ef33046）。
- 测试面补齐：`tests/m15v2.tab.dom.test.cjs`（jsdom + 真实页签 + 真实引擎，包 StrictMode）、`tests/lib/nodeSqliteShim.cjs` + `tests/m15v2.realdb.test.cjs`（node:sqlite 跑真实 db.js SQL）。

### 9.2 调整（f2ce944）
- 实测读数条从界面移除（读数仍写入 `material_map_runs.output_json.metrics`）。
- 去重：标题为「目录 / Contents / 索引 / 版权页 …」的作用域直接封顶；模型把目标标题再写一遍的顶层「回声」节点不建行、子挂目标；目录节点与「其他」类型不显示类型行。
- 流畅：平移 / 同档缩放只改外层 transform；几何未变不起过渡；过渡不与用户拖动抢视图；>200 节点的图首次打开默认收起 AI 第 2 层以下。

### 9.3 结构透镜（阅读透镜）
用户：阅读正文时随时查看所读段落的图谱，或就地为所在段落生成，不必跳到图谱页签；要「炫酷高端但简洁干净」。
- **形态**：正文右缘 3px 结构轨（按章节篇幅分段：已生成实、未生成虚；强调色珠子标当前位置）；点轨展开轨旁玻璃面板：祖先阶梯 / 一根细线串起同层要点、珠子停在正在读的那一点并随阅读滑动 / 当前点的下一层 / 关系 ≤3 行 / 「在图谱中打开」。唯一动效＝珠子滑动 + 新要点落线；尊重 reduced-motion。只用阅读区前景 / 背景与 accent（前景经 currentColor 混色，适配 `--reader-fg: inherit`）。
- **定位**：内核可选能力 `getReadingProbe()` → `{ unitAnchor, text(所在段落开头 ≤80 字) }`（foliate 取 relocate 的可见起点 Range；PDF 取当前页、text 空）→ `mindmap:graphLocate` 在线性化原文里空白不敏感查找 → 块号 → 包含该块的最深节点（及所在目录作用域）。零 AI。
- **就地生成**：`mindmap:graphEnsureMap`（无激活 v2 版本时建仅含目录骨架的 v2 版本并激活，零调用；旧版留历史）→ `graphExpand(所在目录节点, click)` 只 outline 该作用域（约 1 次调用；交互容器 run，不进全局指示器）。
- **原文送入**：`src/lib/mindmapFeed.ts` 进程内单例（内核实例 + documentId），图谱页签与透镜共用，杜绝两处交错送入导致 out_of_order；已送完的文档再开页签不重送；主进程 LRU 挤出后 reset 重送。透镜只在用户展开过之后才送原文。
- **测试**：`tests/m15v2.lens.dom.test.cjs`（17 项）、`tests/m15v2.engine.test.cjs` 透镜段（10 项）。
- 待登记：AI_DEVELOPMENT_GUIDE §4.19 / IPC 清单（`mindmap:graphLocate` / `mindmap:graphEnsureMap`）/ 内核契约（`getReadingProbe`）随 T10 一并写入。

### 9.4 结构图（阅读透镜 v2「聚焦图谱」，取代 9.3 的结构轨 + 列表面板）
用户第二轮反馈（2026-10-18）：结构轨像阅读进度条、点轨任意处都弹同一菜单；列表看不出对应正文哪几段；祖先项「第一章」一点就跳去目录页、回不来；要的是**真正的图谱**——从完整图谱裁出、聚焦当前段落及与之相连的部分，并在正文里强调对应段落。
- **入口**：工具栏「结构图」开关（`localStorage mm2.lens.open`）。结构轨删除。（第一稿是右侧停靠栏，同日第三轮被否，见下「摆放」。）
- **裁图**（`v2/focus.ts` `buildFocus`，纯函数；第五轮已随本方案整体退役，见 §12）：焦点 F＝阅读位置最深节点 / 用户点选节点；整体 W＝F 的父；成员＝W 的子（>7 取以 F 为中心的窗口 + 与 F 相连者，其余折「另 N 项」）；F 的下一层 ≤5；关系：一端在图内的全部边，图外对端作「别处」节点 ≤5（碰 F 3 分 > 碰 F 的子 / W 2 分 > 只碰其他成员 1 分；1 分的 ≤2 个，且对端在图内某点子树里的不算别处）。W 以上只留标题链（纯文字，不可点、不跳）。
- **排版·纵向树**（`layoutTree`，tree / grid 版式）：左结构、右关系——左侧树干串成员（F 加重 + 左侧强调条，子缩进挂 F 下），图内关系画成卡片右侧的弧（3 条泳道），通往别处的关系连到右列卡片（卡片标「所在整体 · 类型」）；关系码徽标沿曲线避让。线型 / 端头沿用 `REL_STYLE`；碰 F 的关系用 accent。
- **摆放与排法随结构类型（第三轮，用户 2026-10-18）**：右侧栏窄而挤、装不下时间轴等宽结构。做法＝「由 AI 返回的参数决定用哪个 UI 组件展示」：AI 生成图谱时每组本就附带 `{版式}` 提示（`patternHint`；无则 `selectPattern` 规则推断，手动覆盖优先），聚焦图取「整体」这一组的版式 → 排法家族 + 摆放：
  - tree / grid → 纵向树，**浮窗**；argument → 论证图（论点在上，支持一侧在左下，反方观点 / 反驳 / 让步在右下），**浮窗**；
  - chain（先后箭头）/ timeline（时间轴 + 刻度，卡片元信息带时间）/ layered（只画关系）→ 横向流程，**正文下方**；compare → 对照分栏（每栏挂该成员的子 ≤4），**正文下方**；别处节点排在最下一行；
  - 浮窗＝`.reader-lens-float-host`（正文视口覆盖层，空时不拦指针），标题栏拖动、右下角缩放，初始宽高按图的自然尺寸，用户动过后记住（`mm2.lens.float`）；下方＝`.reader-lens-dock-host`（右列末行，正文让位），上缘拖高（`mm2.lens.dockH`），图在左、详情在右；
  - 头部显示结构类型（标注来源：模型提示 / 自动推断 / 手动），一键在浮窗 / 下方之间切换（`mm2.lens.host`，切回与类型默认一致时恢复「自动」）。
  - 关系线：按两卡相对位置选端口；同一行的走上方弧（泳道）；会穿过中间卡片时从侧面绕行；父与它下挂的子之间不再画线，只在子卡角上挂关系码。
- **图 ↔ 正文**：`mindmap:graphNodeAnchors`（零 AI）给节点每个单元一对首尾 ≤32 字原文探针 → 内核可选能力 `setStructureHighlights(regions)`（foliate：`src/lib/reader/textRange.ts` 去空白比对找回 Range → CSS Custom Highlight `structure-focus` / `structure-hover`，章节重载自动重画、销毁时清除）。焦点节点的段落常亮；指针停在图中任一节点，它的段落也亮。PDF 暂未实现强调（能力缺省 → 静默降级）。
- **导航纪律**：单击节点＝在图里换焦点（「浏览中」，正文不动；正在读的那一点仍有标记，可「回到正在读的段落」）；双击 / 详情「跳到原文」才跳，跳前记下最初的阅读位置 → 面板顶部「回到刚才读的位置」。
- **详情**：类型 + 标题 + 讲解（已缓存则显示；否则「它在说什么」按需 1 次调用，走 `graphExplain`）+ 深挖 + 在完整图谱中打开 + 关系图例。
- **测试**：`focus.test.cjs`（38，第五轮已随裁图模块退役，见 §12）、`tests/m15v2.textrange.test.cjs`（7）、`tests/m15v2.lens.dom.test.cjs` 重写（30 → 第五轮再重写为 41）、engine +3、ipc 15 通道。
- 待登记（随 T10）：IPC `mindmap:graphNodeAnchors`；内核契约 `setStructureHighlights` / `ReaderStructureRegion`。

## 10. 交接说明（2026-10-18，给下一位接手的 agent）

**现状**：T1–T9 已提交（main：…ed08589 → 06846f2）。「结构图」（§9.4）为第二轮方案，**第五轮已由 §12 取代**（透镜改为内嵌完整图谱画布；§9.4 的裁图 / 纵向树 / 按版式选摆放退役，§9.3 的结构轨 + 列表面板已被用户否决并删除）。结构图**未在真实应用里验收过**（开发沙箱跑不了 Electron，只做了 jsdom 页面测试与离线渲染预览）。

**结构图入口文件**
- ~~`v2/focus.ts`：`buildFocus`（从完整图谱裁出聚焦小图）+ `layoutFocus`（按版式选排法；`FAMILY_OF` / `HOST_OF`）~~ **第五轮已退役**（见 §12）：透镜改为内嵌完整图谱画布，不再自绘裁图；其单测 `focus.test.cjs` 一并删除。
- `src/components/reader/MindmapLens.tsx`：面板组件（定位、生成本节、正文强调、浏览 / 跟随、跳转与「回到刚才读的位置」、浮窗拖动缩放、下方拖高、浮窗 / 下方切换）。页面测试 `tests/m15v2.lens.dom.test.cjs`。
- `src/components/Reader.tsx`：工具栏「结构图」开关、两个宿主 `.reader-lens-float-host`（正文视口覆盖层）/ `.reader-lens-dock-host`（右列末行）。
- `electron/mindmapEngineV2.js`：`graphLocate` / `graphEnsureMap` / `graphNodeAnchors`（均零 AI）。
- `src/lib/reader/kernel.ts` + `src/lib/reader/foliate/adapter.ts` + `src/lib/reader/textRange.ts`：`getReadingProbe`、`setStructureHighlights`（CSS Custom Highlight，按首尾原文探针找回 Range）。
- 样式：`src/theme.css` 末尾「结构图（阅读透镜 v2」一节；文案 en / ja 已补齐（`node scripts/i18n-check.mjs` OK）。
- localStorage 视图偏好（非设置键，不进 F18）：`mm2.lens.open` / `mm2.lens.host` / `mm2.lens.float` / `mm2.lens.dockH`。

**已知未完成 / 待打磨**
1. PDF 引擎未实现 `setStructureHighlights`（能力缺省→无正文强调）；`getReadingProbe` 在 PDF 只给页、不给段落片段，定位粒度是页。
2. 时间线排法里同一行卡片之间的关系弧会擦过时间轴；`wrapText` 会在英文单词中间断行。
3. 浮窗初始几何依赖 `floatHost` 尺寸；窗口缩放后不会自动收回越界的浮窗。
4. 关系线是启发式路由（`routeRel`：端口按相对位置选，穿卡时侧绕），复杂图仍可能交叉；未接 `route.ts` 的通道路由。
5. ~~用户口头方向：按结构类型选「最优展示形式」~~ **第五轮已作废**（见 §12）：透镜改为内嵌完整图谱画布，排法一律沿用完整图谱的块组合布局（不再有 `layoutFocus` 的家族选型 / `opts.family`）。
6. T10 文档落盘（见 AI_DEVELOPMENT_GUIDE §9.5）与 GUI 套件适配。

**验证方式**：`node tests/m15v2.{textrange,lens.dom,engine,ipc,tab.dom}.test.cjs` 全绿（`focus.test.cjs` 第五轮已退役）；`node node_modules/typescript/bin/tsc --noEmit -p .` 为 0；真实效果需 `npm run dev` 打开一本已生成图谱的 EPUB，点工具栏「结构图」。用户的应用日志与数据库在 `%APPDATA%/incremental-reading-dev`（`logs/main.log`、`library.db`）。

## 11. 第四轮打磨（2026-10-18，用户第二轮实测反馈）

用户：结构图（§9.4）功能方向对，但① 图样式与完整图谱不一致；② 浮窗「在完整图谱中打开」跳过去却不定位到该节点；③ 信息冗余（顶端「跟随阅读」、面包屑、底部「正在读 其余 N 段」说明）；④ 工具栏「结构图」开关样式与同排按钮不统一、点亮后内容贴边；⑤ 点「跳到原文」错跳目录页（BUG）；⑥ 点「它在说什么」输出里同一句重复两遍（BUG）；⑦ 输出无法收起。

决策与实现（本分支 `feat/mindmap-lens-polish`）：
1. **样式统一**：结构图 SVG 改用完整图谱同一套视觉 Token（对齐 `src/lib/mindmap/v2/svg.ts`：卡片底 `--paper`、描边 `--border-strong`；标题 `--ink`；元信息 `--text-secondary`；关系 `--text-secondary`（碰焦点转 accent）；装饰 `--paper` / `--border-subtle`）；卡片去圆角成直角 hairline；**图区底改 `--paper`**（对齐完整图谱 `.reader-map-stage` 的底），使卡片与底色关系一致。图内不再用阅读区 currentColor 混色；面板外壳（头 / 详情 / 按钮）仍随阅读主题。
2. **「在完整图谱中打开」定位**：`MindmapCanvasHandle` 增 `reveal(id): boolean`——命中布局项才返回 true；先把缩放抬到 `LOD.zoom`（0.5）以上（否则深层节点被 LOD 摘要卡隐藏，居中到空处＝实测「没定位」），再居中。`MindmapTab` 聚焦改为**有限重试**调用 `reveal`（画布 / 布局晚于请求就绪也生效）。
3. **去冗余**：去头部「跟随阅读」字样（保留「浏览中」与「回到正在读的段落」，后者是导航纪律的一部分）；去头部面包屑行（`mm2-focus-crumbs`，`buildFocus` 的 `crumbs` 字段随之不再消费）；去详情「正在读」徽标 + 节点标题行（即用户所指「正在读 其余 N 段」），点选节点后由图内高亮承担识别；去图内 reading tag 文字（保留阅读位置的强调色条）。
4. **「结构图」开关**：去图标，只留文字；`reader-lens-btn` 明确 `padding: 0 var(--sp-3)` 与同排 `.btn-sm` 一致。
5. **「跳到原文」**：旧实现「先 `goTo({href: unitAnchor})` 再 `goTo({search: 首 20 字})`」——兜底是**整书搜索、命中即止**，命中落在目录页就跳目录（与 §9.2 旧结构轨同因）。改为**仅在锚点跳转失败时**才用文本搜索兜底；正常路径只按单元锚点跳。精确段落由既有正文强调（§9.4「图 ↔ 正文」）在跳转后的单元里承担。
6. **输出重复（根因）**：React StrictMode 下 `App.tsx` 的 `installMindmapBridge()` 被调两次（返回值被丢弃、无清理）→ `window.mindmapAPI.onDelta` 注册两份 → `mindmap:delta` 在 EventBus 上发两次 → 结构图对每条增量应用两次 → 讲解文本被追加两遍（大纲 / 深挖因节点按 id 覆盖，看不出）。修：`installMindmapBridge` 加安装守卫（与 `installActivityStore` 一致）。
7. **讲解收起**：结构图讲解复用制卡台「AI 解释」的收起机制与样式类（`CardDock.tsx`：`.collapse-clip.wb-explain-clip` + `.collapse-inner` + `.wb-explain-toggle`，内容在上、把手在下、同箭头方向），默认展开（内容到达即展开）、点把手收起；结构图不是坞体（无尺寸查询容器）→ 局部覆盖 `.mm2-focus .wb-explain-clip`（`max-height: none`）、把滚动放到 `.collapse-inner`、并去掉 D149③ 的坞内顶缘 24px 渐隐（在浮窗里会压暗首行）。皮肤改动仍一处生效（换肤改 `.wb-explain-*` 两处同步）。

测试：`tests/m15v2.lens.dom.test.cjs` 增/改用例（去冗余文案、讲解可收起、跳转不再整书搜索）；`node tests/m15v2.*.test.cjs` 全绿；`tsc --noEmit` 为 0。
待登记（随 T10）：无新 IPC / 内核契约（`reveal` 是画布组件方法，非内核契约）；本轮决策同上并入 T10 的 §4.19 / D 编号登记。

## 12. 第五轮打磨（2026-10-18，用户第三轮实测反馈）

用户：① 结构图里「展开解释 / 收起解释」的横条走到解释内容**下方**了，应在上方；② 解释上方带方框的「定义」二字要去掉；③ **浮窗里的图与完整图谱排布对不上**（图 2 vs 图 3）——要的是「以当前阅读段落所处节点为中心、展示完整结构图」的**左右排布清晰结构**，子节点分叉默认收起（点击才展开，免得图太大），并复用完整图谱生成时的**生长动画**到所有展开动作；④ 设置页皮肤卡「陶土」右侧四字说明改「从容以赴」。

决策与实现（本分支 `feat/mindmap-lens-polish`）：
1. **解释横条移到内容上方 + 去「定义」框**：`MindmapLens.tsx` 详情区改为**把手在上**（`.wb-explain-toggle` 先于 `.collapse-clip` 渲染），箭头随几何翻向（展开＝朝上＝收起／收起＝朝下＝展开，`.is-flip`），`title` 随开合在「收起解释 / 展开解释」间切换。同时删除详情区标题行（`mm2-focus-detail-title`，即用户所指带方框的「定义」二字）——节点身份由图内高亮承担（承接第四轮 §11-3 去标题行的口径）。
2. **放弃「自绘裁图」，改为内嵌完整图谱画布**（本轮主体）：删除透镜裁图模块（`v2/focus.ts`：`buildFocus` 裁图 + `layoutFocus` 四排法 + `FAMILY_OF` / `HOST_OF`）与其单测（`focus.test.cjs`）；`MindmapLens.tsx` 不再自绘 `.mm2f-*`，改为直接渲染 `<MindmapCanvasV2 graph={lensGraph} …>`——**与图谱页签同一份 `GraphState`、同一套 `layoutGraph` / `routeRelations` / `buildCanvasSvg`**，从而**天然获得完整图谱的左右排布与生长动画**，不再有「透镜一套排法、图谱另一套」的不一致。
3. **折叠口径（透镜唯一改动的输入）**：`lensGraph = setView(graph, { collapsed })`——除**阅读节点的祖先链**（`ancestors(graph, readingId)`）外，所有有子节点的默认收起（`collapsed` 集合）；用户手动开合过的节点记 `overrides: Map<id, boolean>` 真值，**不随阅读位置重置**；`setView` 用 `new Set` 重建（graph.ts 纯 reducer 语义不变）。
4. **单击＝选中并开合分叉、展开走生长动画**：`onSelect(id)` → `setSel` + 有子节点则翻转其 `collapsed`；`onToggleCollapse(id)`（画布「+N」徽标）同逻辑。**折叠 / 展开与「整图生成」走同一代码路径**——`layoutGraph` 增量重排 → `planTransition`（新进入帧记 `freshRef`、`FRESH_MS=1200` 虚线描边 + `frameOp.opacity` 过渡），故展开动作自带完整图谱同款生长动画（用户要求 ③「把这个展开动画应用到所有图谱的展开动作」）。
5. **画布补三个最小能力**（`MindmapCanvasV2.tsx`，不改既有语义）：`onNodeDoubleClick?`（给了就接管双击——透镜用它＝双击跳原文，不再折叠切换）、`onHoverNode?`（指针进出节点回调 `null` ——透镜用它点亮对应段落）、`readingId?`（阅读位置节点加左条 + `data-reading`，浏览别处时仍看得出读到哪）。`svg.ts` 的 `SvgOptions` 增 `reading`，卡片加 `${isReading ? data("reading","1") : ""}` + 左侧 3px `--accent` 条。
6. **折叠带动画的一个坑（已修）**：`toggleCollapse` / `onSelect` 的 `setOverrides` **更新器必须纯**——原先把 `!collapsedRef.current.has(id)` 写在更新器内，React 18 StrictMode 重放更新器时 ref 已被上一次渲染改过 → 结果被翻转（实测点了展开反而收起）。修法＝把 `next` 在更新器**外**算好。
7. **摆放**：`host` 一律 `float`（`hostPref==="auto"` → `"float"`），不再按版式推断（完整图谱要地方）；浮窗默认几何 `FLOAT_MIN_W=420` / `MAX_W=640` / `MIN_H=340` / `MAX_H=580`，右下角；用户拖过 / 缩放过之后记住（`mm2.lens.float`）。
8. **设置页短标**：`src/skins/claude/manifest.ts` `tagline` 「闲庭信步」→「从容以赴」（`SKIN_API_VERSION=3` 契约不动）；en/ja 词典键同步（`Calmly committed` / `悠然と挑む`）；`AI_DEVELOPMENT_GUIDE.md` D188 行同步订正。
9. **退役**：透镜裁图模块 `v2/focus.ts` 与其单测 `focus.test.cjs`（全仓 grep 确认无其它引用 / 无 f11 等闸门引用）；`src/theme.css` 删 `.mm2-focus-svg` + `@keyframes mm2-focus-in` + 整段 `.mm2f-*`（约 40 行）+ `.mm2-focus-legend*`，`.mm2-focus-canvas` 改 `display:flex` 包住画布。§9.4 的「裁图 / 排版·纵向树 / 摆放与排法随结构类型」三步随之作废（保留为历史叙述）。

测试：`tests/m15v2.lens.dom.test.cjs` 重写为**画布 DOM 断言**（41 项全绿）——选择器改 `.mm2-focus-canvas svg` 的 `g[data-node-id]` / `[data-sel='1']` / `[data-reading='1']` / `[data-act="unfold"]` / `[data-edge-id]` / `rect[stroke-dasharray]`（生长动画证据）；覆盖「阅读节点被标出且居中 / 同整体成员都在图上 / 关系线带标签 / 结构类型 / 默认收起 / 点击展开且带生长动画 / 单击选中 / 回到跟随 / 双击跳原文 + 回到刚才读的位置 / 讲解把手在内容上方 / 在完整图谱中打开 / 摆放切换 / 关闭清强调」。`node tests/m15v2.*.test.cjs` 全绿（17 套件）、`tsc --noEmit` 为 0。
登记：`AI_DEVELOPMENT_GUIDE.md` §8.1 **D193 / v49.20** 已登记；D188 行「陶土＝从容以赴」已订正；§4.19 相关条款随 T10 落盘。无新 IPC / 内核契约。

## 13. 第六轮打磨（2026-10-18，用户第四轮实测反馈）

用户：「从截图中可以看到，阅读界面的结构图面板中当前正在阅读图谱节点的高亮方式是加了一个主题色的框，且框的粗细不均匀，左侧线较粗，其他方向较细。我希望把当前阅读节点的高亮方式改成图中『动物化的后现代』那个主节点的强调方式，即整个节点使用主题色底色、白色文字。这样当前阅读节点会更明显。另外，虽然当前节点的子节点被收起，但其父节点太长太多，占用空间过大。以图中为例，父节点仅保留到『御宅族系文化所展现的后现代主义姿态』这个节点，其余更高层级的父节点请省略，不与展示。如果用户想查看更多父节点，需点击『在完整图谱中打开』按钮跳转到完整图谱。跳转后应该将阅读界面结构图所展示内容在完整结构图当中的相应区域，以高亮区域形式短暂强调，以便快速定位。」

决策与实现（本分支 `feat/mindmap-lens-polish`）：

1. **阅读节点＝顶卡同款强调（需求①）**（`svg.ts`）：删掉阅读节点左侧那条 3px `--accent` 填充（用户所指「框粗细不均、左侧较粗」的来源，第五轮 §12-5 的遗留），改为**整卡主题色底 + 白字**——`fill` 走 `isRoot || isReading ? "var(--accent)" : "var(--paper)"`，类型行与标题行的文字色走 `isReading ? "var(--accent-on)"`，描边也并入 `isRoot || isReading` 分支走 `--accent`（否则主题色底上会压一条 `--border-strong` 灰边）。`data-reading` 探针与「阅读节点居中」逻辑不变。
2. **父链截断：以阅读节点的直接父节点为图顶（需求②）**（`MindmapLens.tsx`）：第五轮口径是「整树 + 除祖先链外全收起」，父链一路铺到书根 / 目录 / 章，占掉大半画布。新口径＝新增纯函数 `pruneToCut(state, cut)`：`cut = graph.nodes[readingId].parentId`，`keep = cut 的整棵子树`；`cut` 自身不进 `nodes`，其直接子节点 `parentId` 置 `null`（挂到合成根 `ROOT_ID`）；`cut.title` 交给画布顶卡的 `rootTitle` 呈现——于是透镜里只剩「截断点的标题（顶卡）+ 截断点下面那一层成员及其分支」，书根 / 目录 / 章一律不再出现。`patterns[cut]` 迁到 `patterns[ROOT_ID]` 以免组框与版式标签丢失；折叠集合仍为「除顶卡外所有有子节点默认收起」，`overrides: Map<id, boolean>` 手动开合记忆不变。想看更高层父节点的唯一通道＝「在完整图谱中打开」。
3. **跳转后把透镜展示过的区域框出来（需求③）**：透镜侧算出 `lensRegionIds`＝顶节点（`cut`）+ 其下**所有未收起的后代**（即透镜实际画出来的那一片），`onOpenInMap(nodeId, region)` 一并交出；`Reader.tsx` 的 `mapFocus` / `MindmapTab.tsx` 的 `focusRequest` 增可选 `flash?: string[]`，`MindmapTab` 用 `flashNow` 置 4.2s 定时状态并透传给画布 `flashIds`；`buildCanvasSvg` 在卡片之后追加 `<rect class="mm2-flash">`（区域节点的包围盒外扩 8px，`rx=6`），样式落在 `theme.css`：`.mm2-flash { fill: var(--accent); fill-opacity: .1; stroke: var(--accent) }` + `@keyframes mm2-flash`（12% 淡入 → 60% 保持 → 100% 淡出，2400ms forwards），到点由定时器把元素撤掉。
4. **画布补一处重绘依赖**（`MindmapCanvasV2.tsx`）：`flashIds` 必须进 `requestPaint` 的依赖数组——连着两次「在完整图谱中打开」可能选中同一个节点（`selectedId` 不变），只靠 `selectedId` 触发的重绘会漏掉第二次的高亮区。
5. **一次性消费**：`focusRequest` 用掉即由 `MindmapTab` 经 `onFocusConsumed` 回执，`Reader` 把 `mapFocus` 清空——图谱页签切走会卸载 `MindmapTab`，留着旧请求会在下次进来时重复聚焦 / 重复高亮（`focusSeqRef` 只能挡同一次挂载内的重放）。

测试：`tests/m15v2.lens.dom.test.cjs`（44 项全绿）按新语义改写受影响断言——「上方是它所属的整体（父节点卡也在图上）」→「以阅读节点的直接父节点为顶、更高层级父节点不展示、顶卡承载截断点标题」；「第二章分叉默认收起」→ 把阅读位置挪到未生成细分的第二章（阅读节点＝目录层级的「第二章」→ 以书根下一层为顶，「第一章」有子节点故默认收起）→ 点「+3」徽标展开（虚线描边＝生长动画证据）/ 点节点收起 / 再点又展开；「在完整图谱中打开」处补断言同步带出 `region`（含顶节点与各成员、不含被截断的祖先）。`tests/m15v2.tab.dom.test.cjs`（26 项全绿）增一节：传 `focusRequest{nodeId, seq, flash}` → 画布选中指定节点 + `.mm2-flash` 出现（有宽高）→ 反馈 `onFocusConsumed` → 过一会儿自动撤掉 → 再挂载（模拟切走页签再回来）不重复聚焦 / 不重复高亮。`tsc --noEmit` 为 0；`node tests/m15v2.*.test.cjs` 全绿（`m15v2.db` 为 `@runtime: electron`，node 直跑不适用）。

登记：`AI_DEVELOPMENT_GUIDE.md` §8.1 **D194 / v49.21**。无新 IPC / 内核契约。

## 14. 第七轮打磨（2026-10-19，用户第五轮实测反馈）：结构图面板改为独立窗口

用户：「从图中可以看到，悬浮结构图当前只有拖动右下角可以改变大小，并且它是当前窗口内部的结构，悬浮结构图窗口如果向外拖动超出软件窗口的内容就消失了，所以我希望把它改成一个独立的窗口，这样它可以放到主阅读界面外面不会遮挡阅读内容，同时它作为一个窗口也可以实现拖动四边或者边角方便地调整大小。这样结构图放到正文下方的功能也不需要了，可以一并去掉。」

追问后用户拍板两条：(a) 窗口样式＝**无边框、与应用一致**（沿用软件自绘语言，不用系统原生标题栏）；(b) **默认始终置顶**，与全局快捷键唤出的制卡台窗口统一——**并且两个窗口要统一：将来换皮肤要一处修改两窗同步生效**。

决策与实现：

1. **窗口承载**（新增 `electron/lensWindow.js` / `lens.html` / `src/lens.tsx`）：与独立制卡台窗口（`workbenchWindow.js`）逐条同构——无边框自绘、**默认置顶**（窗口内可切）、关闭＝隐藏（单例复用，真正退出才销毁）、`ready-to-show` 后才 show、首次呼出**优先贴主窗口右侧**（放不下退左侧、再退工作区右缘，保证默认不遮正文）。**四边 / 边角缩放＝系统原生**（`resizable: true`；无边框窗口在 Windows 上仍带原生缩放边框，无需自绘把手）；面板头行＝窗口拖动区（`.lens-root .mm2-focus-head { -webkit-app-region: drag; user-select: none }`，行内按钮显式 `no-drag`）；头行沿用同一套窗口控件语言——置顶钮（`data-mm2-pin`，`is-on` 时点主题色）+ 关闭钮。`vite.config.ts` 增 `lens` 多入口（产物 `dist/lens.html`）。
2. **跨窗口接线**（改 `electron/main.js` / `electron/preload.js` / `src/components/Reader.tsx`）：面板住在结构图窗口，正文与内核留在阅读窗口——全经主进程转发（§4.2-17 新增 `win:lens` / `lens:ask` / `lens:reply` / `lens:push` 四通道 + 一条 `lens:window` 状态推送）：
   - 阅读窗口 → 结构图窗口（**推**）：上下文（文档 / 标题 / 目录 / 单元锚，`getTOC` / `getSectionAnchors` 必须同步可用 → 推完本地缓存）与阅读位置（探针 + 当前定位，每次 `relocate` 再推一次，并在结构图窗口 `on("relocate")` 语义下分发）；
   - 结构图窗口 → 阅读窗口（**请求**）：`sectionText`（区间原文，取文靠阅读窗口的内核）与 `goto`（跳正文）——带 `id` 等回执（8s 超时兜底）；
   - 结构图窗口 → 阅读窗口（**命令**，不等回执）：`highlights`（正文强调）与 `openInMap`（在完整图谱中打开）；
   - 窗口状态：主进程在 show / hide / pin 后把 `{visible, pinned}` 播给两窗——主窗口据此同步工具栏开关（窗口被关掉＝按钮同步取消），结构图窗口据此同步置顶钮。
   阅读窗口侧只多出「宿主」职责（推上下文 / 阅读位置、应答请求、离开阅读界面时收窗并清强调）；面板不再渲染在阅读窗口内。
3. **面板组件零改口径**（改 `src/components/reader/MindmapLens.tsx`）：仍是同一份实现——同一套完整图谱画布（`MindmapCanvasV2`）、父链截断到阅读节点的直接父节点、阅读节点整卡主题色底 + 白字、单击展开 / 收起、双击或「跳到原文」才跳、讲解可收起、「在完整图谱中打开」带区域。只把「内核」换成宿主注入的 **`LensKernel` 子集**（`getTOC` / `getSectionAnchors` / `getSectionText` / `getReadingProbe` / `getCurrentLocation` / `goTo` / `setStructureHighlights` / `on("relocate")`）：阅读窗口可直传真实内核（结构上是超集；DOM 测试里的假内核同样满足），独立窗口传 `src/lib/lensBridge.ts` 的 IPC 代理（同步取值走缓存、异步取文与跳转走回执、强调与开图谱走单向命令）。原文送入（`src/lib/mindmapFeed.ts`）的形参类型同步收窄为 `FeedKernel`（只取文那三件事），两宿主共用同一份送入流程与进度订阅。
4. **退役**（改 `src/theme.css` / `Reader.tsx`）：`浮窗 / 正文下方` 两种摆放、`data-mm2-host-toggle` 与 `data-host`、自绘拖动（标题行 `onPointerDown`）/ 拖高（`.mm2-focus-dock-resize`）/ 右下角缩放（`.mm2-focus-size`）、`.reader-lens-float-host` 与 `.reader-lens-dock-host` 两个宿主及其样式、`@keyframes mm2-focus-pop`、localStorage 三键（`mm2.lens.host` / `mm2.lens.float` / `mm2.lens.dockH`）全部删除；`mm2.lens.open` 保留（工具栏开关照样跨会话记住）。
5. **主题 / 皮肤统一**（`src/lens.tsx`）：结构图窗口与制卡台窗口共用同一套引导——`styles/layers.css` + `theme.css`、`installThemePluginBridge()`（皮肤插件注入链）、每次呼出重读主题 / 强调色（`lens:window` 推送时重跑 `applyCaptureAppearance()`）、`initLocale(app.language)` 首绘前装载。换肤一处改、两窗同步生效。

测试：`tests/m15v2.lens.dom.test.cjs` 受影响的三条「摆放切换」断言改写为一条「标出结构类型；面板已不含『浮窗 / 正文下方』摆放切换（改由独立窗口承载）」——面板仍就地渲染（跨进程宿主与窗口行为由 electron 侧承担）。`tsc --noEmit` 0；`npm run build` ✓（新增 `dist/lens.html`）；`node tests/m15v2.*.test.cjs` 全绿（`lens.dom` 42/0）；F21 进程间桥对账 7/7（新增通道「主进程注册 ↔ 桥面调用」两头齐、无死通道、文档点名通道全部落地）。

登记：`AI_DEVELOPMENT_GUIDE.md` §8.1 **D197 / v49.24**、§4.2-17（4 通道 + 1 推送）、§9.5。零 schema / 零设置键 / 零内核契约 / 零调度改动。真实窗口行为（拖动 / 四边缩放 / 置顶 / 跨窗口同步 / 换肤同步）待用户实机验收。

