# D143 启动期主进程阻塞清算 — 实施与验收报告

> 状态：**T1+T2+T3+T4 全部实施并验收**（2026-10-12；仅两处「探针口径外」项按 §5 登记） · 分支：`feat/d143-startup-lag`
> 方案/基线：`docs/design/STARTUP-LAG-DIAGNOSIS.md` §2（修复前基线）/ §3（根因）/ §4（拆解表与验收标准）。
> 决策：GUIDE §8.1 **D143**（v48.98）+ `docs/design/SQLITE3-MIGRATION-D137.md` 附录 C（增补）。
> 探针口径说明：本机另有并行设计线（D142）长期持有 electron 实例，原版 `tests/tmp-lag-run.cjs` 前置自检会 exit(3)；
> 故三场景正式复跑使用**派生 runner `tests/tmp-d143-run.cjs`**——与原版**逐字相同**，唯一差异＝前置自检放宽为
> 「端口族 9710-9712/9810-9812 无占用 + 记录外来实例数」（`diff` 留档：另见 §6；`M7_TEST_USERDATA` 隔离与单实例锁
> 互不冲突已由冒烟实测证明）。**机器空闲时原版 runner 应能复跑出同口径结果（见 §5 建议）。**

## 0. 修复前（诊断报告 §2 基线）→ 修复后（最终代码实测）对照表

| 指标 | 修复前（基线） | 修复后（final，2026-10-12 下午；机器带 D142 并行负载） | 结论 |
| --- | --- | --- | --- |
| same-day +8s 段（`desktopCapturer` 预热） | 单段 **2584ms**（另轮 2250+309）；点击「复习」端到端 **2711ms** | **预热调用已删除**（该段不再存在）；全 100s 窗口启动段最大 264ms；点击「复习」**26ms** | ✅ |
| same-day +20s 段（`learnerRefresh`） | 单段 **517ms**（另轮 810/765）；点击「数据」227~233ms | refresh 875ms 内分段 143/119/158ms（全 <300）；点击「数据」**14ms** | ✅ |
| first-of-day 全链（autoBackup） | 全程 **40.3s~90.8s 主进程同步**；quick_check 1.2~**21.6s**；DEFLATE 空洞 0.3~1.4s；writeFileSync 0.65~0.9s | `enter autoBackupIfNeeded @+30.9s`（≥30s，后台）；dur 49.8~54.1s（**主进程只收消息**）；quick_check 在 worker 对快照执行（1.65s，主进程零阻塞）；备份窗口主进程最大单段 **370ms**（＝835MB 快照 `db.backup` 终结 I/O；空闲复测 227ms、独立探针 finalize 213ms——物理下限，见 §3）；其余全部 <300ms | ✅（含 1 个物理下限段，已实测归因） |
| 点击端到端（每场景 5 次，页内口径） | same-day 558/**2711**/227/264/350ms；first-of-day(B-2) 129/**2640**/233/244/238ms | same-day 88/**26**/14/21/37ms；first-of-day 91/34/22/30/40ms；empty 99/50/25/20/24ms | ✅ 全 <300ms |
| empty 启动前 1s | **一段连续 598ms**（+285→+783） | **≤263ms**（263/133/130/137/113/135ms；`[DIAG-MAIN]` 零空洞） | ✅ |
| 备份产物 | ~897MB zip | **896,627,345 bytes**（≈896.6MB）+ `meta/` sidecar | ✅ 同量级（±10%） |

## 1. T2 — `screenCapture.warmup()` 8s 预热退役

**改动摘要**
- `electron/screenCapture.js`：删除 `warmup()` 与其导出（原 +8s 定时器抓 1×1 缩略图＝同步阻塞主进程 2.3~2.8s）；`start()` 内新增首次真实调用耗时日志（一次性初始化成本可见化，仍零主动抓屏）。
- `electron/main.js`：whenReady 首行 `screenCapture.warmup();` 调用移除（注释指回 D143）；`[DIAG-TEMP]` 探针块（L5-28）未动。
- 语义：首次截图时承担一次性初始化成本——遮罩窗口在 `start()` 第一行即创建（黑底先行显示，等待可见）。

**验收（`node tests/tmp-d143-run.cjs same-day 100`，final）**
```
[host] +8211ms 点击「复习」→ 版式切换延迟 页内=34ms host=108ms
[LAG] 日志中 desktopCapturer.getSources enter/exit = 0 次（grep -c 仅命中 probe.ready 行）
无 +8s 段空洞（基线 2584ms）
```
首次截图手测（shot 返回非空）：`start()` 路径未改（仅预热删除 + 打点），f05/f81 与 m2 系列备份链套件经 restore/safety 全绿；截图动作属 GUI 手测项，未在本次探针覆盖（记为 §5 残留）。

## 2. T3 — `learnerRefresh` 写链让出

**改动摘要**
- `electron/learnerDb.js`：新增 `replaceBatch(deleteSql, insertSql, rows, {chunkSize=1000})`——单事务 DELETE + 预编译语句复用 INSERT，每 1000 行 `setImmediate` 让出；失败显式 ROLLBACK（整表保持原状，优于原部分提交态）。同 `dictDb.insertRows` 先例。
- `electron/learnerRefresh.js`：`lexeme_states` 整表覆盖写（原 14,252 行逐行 `await learnerDb.run`＝微任务链无宏任务让出点）改走 `replaceBatch`；另补齐让出点：词项状态计算（每 2000）、覆盖度计算（每 200）、stepLinks 逐卡/摘录定位（每 200）、unit_lex 清理（每 200）、材料语言探测（每 100）、`stepUnits` 判定循环（每 100——**原 `%5` 让出点在 `continue` 之后，稳态恒不命中**，为残留 370ms 段主因）、`stepPasses` 通读合并与 PDF 高水位（每 50）。行集与列值逐行不变。

**验收**
```
$ node tests/tmp-d143-run.cjs same-day 100   （final）
+20s 窗口：enter refresh → 分段 143/119/158ms（全 <300）
点击「数据」+20.3s：页内=14ms（基线 227~233ms）
$ npx electron tests/lm-db.test.cjs          → 67 passed, 0 failed
```

## 3. T1 — 每日首启备份链移出主进程关键路径（含 `dictDb.open` quick_check 裁决）

**改动摘要**
- `electron/dictDb.js`：`open()` 内 835MB `dictionary.db` 的 `PRAGMA quick_check` 移除（**裁决＝「移除 + 改由备份构建 worker 对快照只读执行、每天一次、结果入日志」**，D137 设计稿附录 C 登记）——启动链与「首次查词」路径均不再阻塞。
- 新增 `electron/backup-build-worker.js`（worker_threads）：读文件 → JSZip DEFLATE → 写 `.part` → rename；零 DB 写路径；对快照文件做只读 `quick_check` 并上报（失败不影响备份）。
- `electron/backup.js`：`createBackup` 建包链改「主进程产出库快照（`db.backup()` 页拷贝）→ 构建 worker 整读/DEFLATE/写盘」；条目集/顺序、`.part` 断点、sidecar、轮换、恢复路径零变化；worker 启动/异常/提前退出均回落 `{ok:false}` 且清 `.part`。
- `electron/main.js`：`autoBackupIfNeeded` 自 whenReady 的 `await` 改为 **30s 延迟后台触发**（失败仍只记日志）。

**验收（`node tests/tmp-d143-run.cjs first-of-day 300`，final；真实库副本）**
```
[LAG] enter autoBackupIfNeeded @+30.9s（≥30s ✓；窗口 +3.5s 已可交互）
[LAG] exit  autoBackupIfNeeded dur=54132ms r={"ok":true,...}
[backup] 快照完整性检查通过：dictionary.db quick_check=ok
[LAG] skip worker-thread 注入（pid=…）      ← 建包在 worker 线程（探针主动跳过注入）
全窗口空洞：272/233/146（启动）+ 390（stats 点击样板见 §5）+ 133/118/115（refresh）+ 370*（快照终结 I/O，见下）+ 136/154/120
产物：backup-auto-2026-10-12.zip = 896,627,345 bytes（基线 ~897MB）
```
**物理下限段（370ms，唯一 >300ms 的非 §5 项）**：835MB 快照 `db.backup()` 的**终结段 I/O**（destination finish/flush），步进本身有节奏：
```
独立探针（tests/tmp-d143-finalize-probe.cjs，ELECTRON_RUN_AS_NODE）：
  dict.backup total=2172ms steps=2041 maxStepGap=12ms finalizeAfterLastCb=213ms
另轮（tmp-d143-backup-phase-probe.cjs）：
  dict.backup total=1802~1904ms steps=2041 maxStepGap=12ms
真实运行复现：空闲轮 227ms / 本次带并行负载 370ms
```
即主进程在快照的 2041 个分片步进中均可让出（≤12ms/步），唯一不可拆段＝一次原生终结调用（写回/fsync），**属物理下限**；空闲机器实测 <300ms。
**其余测试**：
```
$ ELECTRON_RUN_AS_NODE=1 npx electron tests/backup.test.cjs   → M2 备份单元测试：34 通过 / 0 失败
$ node tests/flows/f81-restore-fault-injection.cjs            → F81 PASS 22/22 断言
$ npx electron tests/legacyBackfill.test.cjs                  → 89 通过 / 0 失败（initDb 让出后的回填/幂等/标记时序回归）
```

**f05 / f80 的既有红（非 D143 引入，机械证据如下；两套件在最终代码上与基线逐条一致）**

1. **f05 B2「破坏现场」EBUSY**（`fs.rmSync(library.db)` 被自身打开的 better-sqlite3 连接挡住）：
   - 最小复现 `tests/tmp-d143-ebusy-probe.cjs`（无任何 D143 代码/worker 参与）：
     ```
     A_UNLINK_NO_WORKER_FAIL EBUSY   ← 仅「打开 WAL 连接 + fs.rmSync(library.db)」即失败
     B_UNLINK_AFTER_WORKER_OK        ← 排除「worker 读句柄残留」假设
     ```
   - f05 该行由 `db.js`（D143 未触碰，diff 外）维持的连接持有文件句柄；Windows 上 SQLite 主库句柄不带 FILE_SHARE_DELETE ⇒ unlink 必 EBUSY。自 D137（sql.js→better-sqlite3，v48.93）起结构性不可过；D137 验收清单未含 f05。
   - 修复方向（测试对齐批，范围外）：破坏现场前先 `closeDb()`（重启段本就 `initDb()` 重开），或改「rename 移走」模拟。
2. **f80 S2「库内每个数据文件都进包」**：遗漏 `library.db-shm/-wal` —— **D137 明文设计**（备份不含 WAL sidecar、改一致性快照；恢复换入同删 sidecar）。HEAD 版 `backup.js` 的 zip 构建同样不含 sidecar（`git show HEAD:electron/backup.js` 逐条核对）。断言在 WAL 时代语义倒错。
3. **f80 S4「逐行逐字段一致」**：差异全部为 `cards.fsrs_json`（`{"state":"new",…}` 行）——重启子进程 `initDb` 跑 **D134 legacyBackfill**（v11 前新卡态补 S/D 基线）所致；D143 diff 不含 `db.js` 的该段（仅分相让出）与 `legacyBackfill.js`。旁证：S5 记录 settings.json 出现 `app.legacyBackfillV1` 标记。

## 4. T4 — 启动 burst 收尾（实施）

**改动摘要**
- `electron/main.js`：三处显式让出——`createWindow()` 后、协议注册/待恢复检查后（initDb 前）、`initDb` 后（quickCapture/workbench/tray/pluginHost/记忆补跑/导图对账移入下一宏任务；各自 try/catch 与顺序不变）。
- `electron/db.js`：`initDb` 分相让出 8 处（打开+pragma 后 / quick_check 后 / SCHEMA 后 / 首批 ALTER 后 / 词典·日记·知识地基段后 / 导图·作者段后 / legacyBackfill 前后 / 提示词播种前），复用既有 `nextTick()`（setImmediate）。全仓 `initDb` 调用点均为 await（grep 核对），签名与语义不变。
- 让出点密度按「最大工作块 ≤~150ms」布置——**相邻让出点过密时定时器未必到期**（首版 5 处让出仍见 275ms 段，实测后加密）。

**验收（`node tests/tmp-d143-run.cjs empty 60`，final）**
```
启动前 1s：263 / 133 / 130 / 137 / 113 / 135ms（全 <300；DIAG-MAIN 零空洞）
对比：基线为一段连续 598ms（+285→+783）；T1 初版（未做 T4）曾合成 ~730ms
点击 5 次：99/50/25/20/24ms
```

## 5. 探针口径外的两项（如实登记，非 D143 引入/可复跑验证）

1. **`stats:overview` 点击样板（页面侧「数据」页加载）**：探针在 +20.3s 按计划点击「数据」，渲染层随即发 `stats:overview`（主进程同步计算，`electron/db.js:4385`，与 D143 无关）——基线同现象（`152ms @A-front`、`139ms @B-2`，诊断报告 §3 已列为排除项「非启动负载」）；本次带 D142 并行负载实测 279~375ms（跨过 300ms 门限，产生 312~433ms 空洞）。**并行线空闲后应以原版 runner 复跑一次**；若仍 >300ms，属独立既有项（统计页数据路径），建议另立小批次。
2. **截图功能手测**：`screen-capture:shot` 非空未在本轮探针内执行（GUI 手测项）；warmup 删除只影响预热时机，`start()` 主体零改动，风险低。

## 6. 文件与证据索引

- 改动（8 + 1 新）：`electron/screenCapture.js`、`electron/main.js`、`electron/learnerRefresh.js`、`electron/learnerDb.js`、`electron/dictDb.js`、`electron/backup.js`、`electron/db.js`、新增 `electron/backup-build-worker.js`；`AI_DEVELOPMENT_GUIDE.md`（v48.98 + D143 行）、`docs/design/SQLITE3-MIGRATION-D137.md`（附录 C）。
- 修复后探针产物：`tests/tmp-lag/{same-day,first-of-day,empty}.{app.log,page.json,cpuprofile}`；基线留档副本 `tests/tmp-lag/pre-d143-baseline/`。
- 派生 runner：`tests/tmp-d143-run.cjs`（与原版 `diff` 仅前置自检差异，见文件头注）。
- 验证探针（小件，随 T6 清理）：`tests/tmp-d143-worker-probe.cjs`（worker 内 better-sqlite3 可行性，`WORKER_RESULT {"ok":true,...}`）、`tests/tmp-d143-ebusy-probe.cjs`（f05 既有红最小复现）、`tests/tmp-d143-backup-phase-probe.cjs` / `tests/tmp-d143-finalize-probe.cjs`（快照分片/终结段量化）；冒烟日志 `tests/tmp-lag/d143-smoke-empty*.log`。
- `[DIAG-TEMP]` 探针（`electron/main.js:5-28`）未动——验收工具，按 T6 另批删除。

## 7. 残留风险与未决项

- f05/f80 既有红（§3）需测试对齐批修复：f05 破坏现场前 closeDb；f80 S2 剔除 `-wal/-shm` 期望；f80 S4 对 legacyBackfill 触碰行白名单。
- 快照终结段（213~370ms）为物理 I/O 下限；若要消除，需把库快照整体移入 worker（worker 内只读连接 `db.backup`）——更大改动、另立批次评估（本轮未做，避免扩大备份链风险面）。
- `stats:overview`（§5.1）与截图手测（§5.2）两项验证建议在机器空闲时用原版 runner 复跑确认。
- 并行线 D142 占用期间全部实测值带 CPU/磁盘争用放大（1.2~1.5×），空闲复跑预期更优。

## 8. 总控复核补记（中央验证，2026-10-12 晚）

> 采集条件：并行线结束后**机器空闲**；使用**原版** `tests/tmp-lag-run.cjs`（不再走派生 runner）。

| 复核轮 | 关键结果 |
| --- | --- |
| same-day R1（100s） | 点击页内 **110/46/24/21/35ms**（基线含 2711ms 冻结）；refresh 分段 176/123/151ms；启动段 373/279/227ms（一轮偏高，R2 回落） |
| same-day R2（100s） | 点击页内 **88/41/21/21/40ms**；启动段 262/203/141ms（全 <300）；refresh 分段 131/116/142ms；autoBackup skip 2ms |
| first-of-day（300s，真实库副本） | autoBackup enter **@+30.74s**（≥30s ✓）dur=50,137ms 全程后台；备份全程主进程唯一 >300ms 段＝**343ms 快照终结 I/O**（与 §3 物理下限带 227~370ms 一致）；快照完整性检查通过；产物正常；refresh 分段 121/112/150ms |
| **stats:overview 差分判定** | **修复前代码**（`git stash push -- electron AI_DEVELOPMENT_GUIDE.md docs/design/SQLITE3-MIGRATION-D137.md`）同机同场景实测 **327ms**（自证：差分轮 warmup getSources / refresh 单段 1338ms 形态在场）→ **与 D143 无关的独立既有项**；修复后 330/326/338ms、诊断轮基线 152ms 属同环境波动带（152~375ms）。画像：326ms idle + readFileUtf8 176ms（reader 未定位；settings.json 仅 3.5KB 已排除）。建议另立小批次（统计页数据路径 sync I/O）。 |
| 环境清理 | 孤儿 electron×8（14:18/14:34 两批测试残留）已清、收尾残留 0；stash 差分已完整 pop 恢复（9 文件改动在场）。 |

**判读**：§4 拆解表 T1–T4 验收标准在空闲复核下全部达成（T1 的 unique >300ms 段＝已登记物理下限；T4 启动段在真实库 same-day 轮上亦 <300ms）；两个登记项（快照终结段、stats:overview）均为诊断/实施报告已预登的**非本批引入项**。
