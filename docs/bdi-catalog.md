# BDI 事件目录（D248）

> 由 `electron/behavior/registry.js` 生成（`node scripts/gen-bdi-docs.mjs`），**禁止手改**。CATALOG_VERSION = 1。
> 唯一实现依据：`docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md` §6 / §5.2。与注册表不一致时 `behavior-catalog-docs` 测试失败。
>
> 命名 `组.动作`。采集：**M**=主进程 tap；**R**=渲染层 `track()`；**B**=eventBus 桥；**W**=host 内部。每个事件在 `registry.js` 登记 `owner` / `props` / `allowText` / `maxPerMin` / `intentOnly`。`intentOnly` 事件只记意图，不计产出。
>
> 每个事件都带公共列：`ts / recv_ts / source_ts / day / tz_name / tz_offset / cutoff_hour / clock_flags / type / v / src / render_id / window_id / session_id / ctx_id / presentation_id / op_id / actor / surface / origin / entity_type / entity_id / library_item_id / card_id / extract_id / kp_id / doc_pos / dur_ms / num / text / props`（见设计稿 §5.2）；下表只列事件特有的关键字段 / props。

## 6.1 应用 / 会话 / 导航

| 事件 | 采集 | 关键字段 / props |
| --- | --- | --- |
| `app.started` | W | launchKind(cold/relaunch/login_item), appVersion |
| `app.updated` | W | fromVersion, toVersion |
| `app.window_state` | W | window(main/lens/workbench/capture), state(focus/blur/minimize/restore/show/hide/tray), prevTs, durMs |
| `app.power` | W | state(suspend/resume/lock/unlock) |
| `nav.view` | B | from, to |
| `nav.overlay` | B | overlayId, action(open/close)；关闭时 durMs |
| `cmd.invoked` | R | commandId, via(shortcut/palette/menu/button) |
| `tray.action` | M | action |

## 6.2 书架 / 导入 / 阅读

| 事件 | 采集 | 关键字段 / props |
| --- | --- | --- |
| `library.imported` | M | entity=library_item；sourceType, via(picker/paste/drag/capture/html/url), sizeBytes, ok |
| `library.deleted` | M | entity=library_item |
| `library.meta_edited` | M | field(title/author/lang/priority) |
| `library.opened` | R | entity=library_item；origin；ctx_id=新阅读会话；doc_pos=恢复位置 |
| `library.closed` | R | ctx_id；progressPct |
| `shelf.filtered` | R | kind(sort/filter/search), value（枚举）；text=搜索词（allowText） |
| `reader.jumped` | R | doc_pos=目标；method(toc/search/link/mindmap/annotation/extract/bookmark/progress_bar), fromPos |
| `reader.searched` | R | text=查询词（allowText）；num=命中数 |
| `reader.selection_action` | R | num=选中字数；action(extract/annotate/highlight/explain/ste/translate/dict/card/copy/mindmap/search/other) |
| `reader.sidebar_tab` | R | tab |
| `reader.image_focused` | R | — |
| `reader.appearance` | R | key（只记改了哪项） |
| `reader.workflow` | B | state |
| `reader.finished` | R | progressPct；每 (dataEpoch,itemId) 一次 |

## 6.3 摘录 / 批注 / 摘录复习

| 事件 | 采集 | 关键字段 / props |
| --- | --- | --- |
| `extract.created` | M | extract_id；num=字数；via(selection/ai_next/capture/manual), priority, kind(extract/highlight) |
| `extract.op` | M | extract_id；op(postpone/postponeDays/advance/update/setPriority/setStatus/delete/batch/spanSet/switchEngine/rerankNow), delta, batchSize, annotation(bool), fieldNames[], color；**不记正文** |
| `extract.session` | R | ctx_id；phase(start/end), planned, done；dur_ms |
| `extract.shown` | R | extract_id, ctx_id；origin=queue；position |
| `extract.reviewed` | R | extract_id, ctx_id；props: outcome(resolved/postponed/deferred)、thinkMs |

## 6.4 制卡

| 事件 | 采集 | 关键字段 / props |
| --- | --- | --- |
| `card.created` | M | card_id, extract_id；cardType, generatedBy(manual/ai), genBatchId, via(selection/manual_editor/occlusion/ai_batch/disambiguate/workbench) |
| `card.edited` | M | card_id；fields(变更字段名数组), cardType（surface 区分复习中编辑） |
| `card.deleted` | M | card_id |
| `card.suspended` | M | card_id；suspended(bool) |
| `card.tags_changed` | M | card_id；tagsCount |
| `card.regenerated` | R | **intentOnly**；card_id；reason |
| `card.disambiguated` | R | **intentOnly**；candidates, chosen |
| `card.issue` | M | card_id；op(add/resolve), ruleId, severity |
| `ai_batch.created` | M | entity=batch；scope, draftCount |
| `ai_batch.resolved` | M | entity=batch；status, accepted, rejected, editedBeforeAccept |
| `card.leech_resolved` | M | card_id；resolution |

## 6.5 复习

| 事件 | 采集 | 关键字段 / props |
| --- | --- | --- |
| `review.session` | R | ctx_id；phase(start/end), mode(due/mixed/custom), planned, done；dur_ms |
| `review.shown` | R | card_id, ctx_id, presentation_id；cardType, queue, position, isNew |
| `review.revealed` | R | card_id, ctx_id, presentation_id；dur_ms=think_ms（performance.now） |
| `review.extra_revealed` | R | card_id；kind(mnemonic/example/context/source) |
| `review.rated` | M | card_id；ts=t1；dur_ms=单调 tap 耗时；props: tapStartTs, tapEndTs, tapSeq, durationMs（渲染层墙钟入参原样） |
| `review.undone` | M | card_id |
| `review.skipped` | M | card_id |
| `review.source_opened` | R | card_id（主动动作证据，不等于已证明兴趣） |
| `review.answer_judged` | R | card_id；mode, verdict |
| `review.leech` | B | card_id |
| `growth.feedback_shown` | R | **intentOnly**；tier |

## 6.6 浏览 / 搜索 / 查词 / AI

| 事件 | 采集 | 关键字段 / props |
| --- | --- | --- |
| `browse.queried` | R | text=查询词（allowText）；num=结果数；filters(过滤器键名数组), sort |
| `browse.card_opened` | R | card_id；origin=browse |
| `browse.bulk_op` | R | op, count |
| `dict.lookup` | M | text=词（allowText，默认关）；lang, source(local/online), hit；**无正文/例句** |
| `dict.source_op` | M | op(toggle/remove/import/download) |
| `similarity.queried` | M | num=返回数 |
| `ai.invoked` | R | feature(card_gen/explain/ste/translate/chat/next_extract/mindmap/kp_extract/insight/memory/judge/other), outcome(ok/error/aborted)；dur_ms；num=输出字数 |
| `ai.panel_turn` | R | num=提问字数（不记正文） |
| `ai.websearch` | M | num=结果数（不记查询词） |

## 6.7 导图 / 知识点 / 学习者 / 日记 / 其他

| 事件 | 采集 | 关键字段 / props |
| --- | --- | --- |
| `mindmap.generated` | M | library_item_id；kind, ok |
| `mindmap.node_action` | M+R | entity=map_node；action(expand/expand_all/explain/deepen/jump) |
| `mindmap.viewed` | R | library_item_id；origin |
| `knowledge.op` | M | kp_id；op(create/update/merge/unmerge/relation/deleteRelation/ref/resolveProposal/extractApply) |
| `knowledge.viewed` | R | kp_id；origin |
| `learner.track_op` | M | entity=track；op(save/delete/setMaterial), mode |
| `learner.panel_action` | B | action；origin=recommend |
| `learner.exercise` | M | kind(lexeme_mark/placement/unit_reread/reel_done/self_explain), outcome；**不读 payload 正文** |
| `journal.written` | M | num=字数；op(create/update/draftSend/delete), via(page/quick_capture/draft_send) |
| `capture.used` | M | kind(screen/text/image/region), trigger(global_shortcut/tray/button) |
| `memory.op` | M | op(setEnabled/backfillStart/backfillCancel/tidyNow/reset) |
| `insight.op` | M | op |
| `insight.viewed` | R | viewed 记打开 |
| `meaning.op` | M | op(create/resolve/delete) |
| `stats.viewed` | R | tab |
| `settings.changed` | M | key；白名单键另记 to（枚举/数值）；**AI Key/URL/路径永不记** |
| `fsrs.optimizer` | M | op(train/apply/reset), ok |
| `backup.op` | M | op, ok |
| `anki.exported` | M | op, ok |
| `op.undo` | M | domain(card/extract/other) |
| `app.error` | M | module/代码（**不记消息正文**） |

## 6.8 明确不采集

鼠标坐标与轨迹、按键值（只计次数）、剪贴板、任何正文（材料/摘录/卡片/批注/日记/AI 对话）、材料与卡片标题、文件路径、窗口标题、其他应用信息、网络请求内容、API Key/URL。

## 6.9 采集责任（防重复）

- **持久化成功由 M 记**；R/B 只记「点击/发起/显示」。同一动作不得两个 owner 都算成功。
- `ai.invoked` 只表示一次 AI 调用完成；`ai_batch.resolved` 表示批次状态改变；`card.created` 表示落库。三者可组合，但不把 100 张自动生成卡算成 100 次主动创作。
- `dict.lookup` 与 `learning_events.dict_lookup`：前者是 BDI 行为记录（无正文），后者是学习者模型真源（有正文）；查询层按用途分开，不做计数合并。
- `learner.exercise` 只从 `learner:logEvent` 投影 `kind/outcome`，不读 payload；`learning_events` 仍是真源。
- `review.rated` 不存 rating；rating 从 `review_logs` 读。
- `reader.finished` 是「到达末尾代理指标」，不是「已读完/已理解」。
- `ipc_daily` 是诊断计数，不是用户学习次数；不得当行为指标。

## 6.10 通道覆盖

- `tests/behavior-coverage.test.cjs` 扫描 `electron/**/*.js` 的 `ipcMain.handle/on` 通道，与 `taps.js` + `ipcStats` 的显式登记表比对。
- 每个写通道必须二选一：登记事件映射，或带理由只计数（如 `reading:event` 真源是 `reading_events`、`library:updateProgress` 真源是 `progress_json`、`cards:persistNow` 纯重试）。
- 未登记写通道 → 测试失败；新增通道先改 `taps.js` 与本文，再实现。
