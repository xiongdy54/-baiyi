# D143 代码审查报告（code-reviewer · 独立语义审查）

> 审查对象：分支 `feat/d143-startup-lag` 工作区未提交改动（9 tracked + 新增未跟踪 `electron/backup-build-worker.js`）。
> 方案/验收基线：`docs/design/STARTUP-LAG-DIAGNOSIS.md`（§3 根因 / §4 拆解表）、`docs/design/D143-STARTUP-LAG-FIX-REPORT.md`（含 §8 总控复核补记）。
> 方法：读 diff → 全读 `backup.js` / `backup-build-worker.js` / `learnerDb.js` / `dictDb.js` / `screenCapture.js` 与 learnerRefresh/db/main 相关段 → 追调用链（backupOpts/autoBackup/initDb/will-quit/learner:rebuild）→ 对照 GUIDE 不变量（D137 附录 C、§7.2、§8.1）→ 复跑套件与闸门 → 抽查报告所述数值与 artifact。
> 环境：机器空闲（用户 dev 实例 `npm run dev` 在场，经命令行核实非测试残留，未清理）；复核期间按要求未运行 `tests/tmp-lag-run.cjs`（会覆写 D143 验收 artifact），计时类证据以总控 §8 空闲轮 + 现存日志为准。

---

## 验收结论

**不合格**——必须修复项 3 条（2 条文档/登记类 + 1 条中断残留清扫缺口，均为局部小改；核心改动本体的语义审查**通过**）。

---

## 一、必须修复项

### M1（闸门，HIGH）—— f11 L4 决策号缺口：D143 登记使文档集出现 D142 空洞

- 位置：`AI_DEVELOPMENT_GUIDE.md` §8.1 新增 D143 行（diff 第 1471 行）。
- 问题：本批把文档集最大决策号从 D141 推到 D143，但 D142 未在任何受闸门文档中出现（D142 属并行线，其设计稿表头自述「待 GUIDE §8.1 登记」）。
- 证据（可复跑）：
  - `node tests/flows/f11-doc-code-drift.cjs` → `F11 FAIL 14/16`，L4 ✗ `["D142"]`；L1 ✗ `readerActionsSettings.ts`（既有红，见下"已知红核对"）。
  - HEAD 复算：`git show HEAD` 文档集 D1…D141 无缺号（gaps=[]）——即该红由本批登记引入，而非基线。
- 修复归属：**core-engineer**（文档登记/合并序协调，无代码改动）。
- 可机械检查的通过条件：`node tests/flows/f11-doc-code-drift.cjs` 的 L4 恢复 ✓（「D1…Dmax 无缺号」）。实现方式二选一：① D142 线先登记落地（推荐，编号真实）；② 本批在 §8.1 D143 行以显式并行线注记占用 D142 编号（禁止以占位/伪造内容蒙混 L4 的语义，注记须与 `docs/design/D142-CARDDOCK-RESTYLE.md` 事实一致）。

### M2（文档自相矛盾，MED）—— GUIDE §8.1 D143 行内「f80/f81 全绿」与「f80 既有红」并存

- 位置：`AI_DEVELOPMENT_GUIDE.md` §8.1 D143 行，同段先写「autoBackup 语义不变（…）；**f80/f81 全绿**」，后写「套件：…；**f05/f80 为 D137/D134 既有红**，已最小复现归因」。
- 问题：同一行对同一事实两套表述（违反 §1.9 精神；实施报告 §3 与实测均表明 f80=5/7 红，S2/S4）。
- 证据：本审查复跑 `node tests/flows/f80-backup-roundtrip.cjs` → `F80 FAIL 5/7`，失败项恰为 S2、S4（与报告 §3 归因一致）；GUIDE 行自身两句互斥。
- 修复归属：**core-engineer**（一行措辞，如「f81 全绿；f80 见下既有红」）。
- 可机械检查的通过条件：D143 行内不再同时出现「f80…全绿」与「f80…既有红」两种表述；且与 `D143-STARTUP-LAG-FIX-REPORT.md` §3 记录一致。

### M3（中断残留无清扫；T1 调度变化放大暴露面，MED）—— `backups/.snapshot-*` 与跨日 `.part` 泄漏

- 位置：`electron/backup.js:254`（`mkdtempSync(destDir/.snapshot-)`，仅 `finally` 清理）、`:314/331`（`.part` 仅本函数 catch 清理）；全仓无启动清扫（唯一孤儿清扫是 D117 的 sidecar 版，`backfillSidecars` 只扫 `meta/`）。
- 问题：T1 把备份从「启动期主线程同步」改为「正常使用期间后台在途 ~50s（+30s 起）」。旧实现下主线程被占、正常退出路径（托盘退出 / `app:relaunch` / closeToTray 关）无法穿透备份窗口；新实现下**正常退出即可中断在途备份**，中断后：`destFile+".part"` 依赖「同日重试覆盖」才回收（跨日即永久孤儿）；`.snapshot-*` 用 mkdtemp 唯一名，**一旦中断永久残留**（每个 ≈ dict 813.6MB + lib ≈17.5MB）。
- 证据：本机真实 `%APPDATA%/incremental-reading-dev/backups/` 实测 6 个 `.snapshot-*`，`ls` 统计合计 **≈4.2GB**（今日 08:36–10:55 创建——正是 D143 前「备份被强杀」时期产物，反证该类残留真实发生）；`will-quit`（main.js:2170-2178）无任何在途备份/快照清理；`.part` 命名含日期（`backup-auto-<day>.zip.part`），跨日不回收。
- 修复归属：**core-engineer**（备份链核心域；建议复用 D117 `backfillSidecars` 启动清扫先例，扩为清扫 `backups/` 下 `.snapshot-*`（非本进程、非今日）与 `backup-*.zip.part`（日期 ≠ 今日）；或在退出路径加兜底清理）。
- 可机械检查的通过条件：新增最小断言（`tests/backup.test.cjs` 增 2 条）——在隔离目录预置假 `.snapshot-xxx/` 与 `backup-auto-<非今日>.zip.part` 后调用清扫（或启动路径）：二者被删；当日 `.part`（可能在途）不误删；`backup.test.cjs` 保持 34/34，f80 失败项不新增（仍为 S2/S4）。

---

## 二、建议项（不阻塞验收）

| # | 项 | 内容 |
| --- | --- | --- |
| S1 | worker 构建无兜底 | `buildZipInWorker` 失败即 `{ok:false}`，无主线程回退（D117 `parseZipMetaFallback` 有 sync 兜底先例）。worker 不可用（打包 asar 加载/线程资源）时全部备份（含恢复前 safety→会中止恢复）失效。建议：打包产物实测一次 worker 加载；或加一次主线程降级构建（低频路径，不影响启动指标）。 |
| S2 | `replaceBatch` 直接单测缺口 | 现行 lm-db 67 是经 refresh 间接覆盖。建议补：①两轮 refresh 后 `lexeme_states` 全量相等（幂等）；②注入插入失败断言 ROLLBACK 后表 = 旧值（旧实现为部分提交，这是新语义）；③让出点确为宏任务（计数 setImmediate）。 |
| S3 | initDb 由「原子同步块」变为可让出 | 新增 8 个让出点后，理论上 renderer IPC 可在 schema 未建完的窗口进入（命中 no such table）。实测窗口在窗口创建后 <300ms 内，而渲染层挂载晚于此后（历史首点击 +3.5s），判**低风险**；如要闭合可加「initDb 完成前查询就绪门」。 |
| S4 | 30s 延迟跨午夜漂移 | 23:59:50 启动 → 00:00:20 产出次日 zip，当日无备份。极低频；登记口径即可。 |
| S5 | 注释过度声明 | `backup-build-worker.js:11`「逐字节等价」——zip 条目时间戳为构建时 `new Date()`，应为「条目集/顺序/压缩口径等价」。同理报告 §1「遮罩窗口先行显示（黑底先行显示）」不准确：overlay 的黑底显示挂在 `captureOverlay.html` 的 `bg.onload`（=抓屏+解码完成后），首次截图的前 2.3~2.8s 实际是「窗口已透明、遮罩未显示」的空白等待（行为取舍本身已获用户拍板，措辞修正即可）。 |
| S6 | 证据索引漂移 | 报告 §6 称修复后产物在 `tests/tmp-lag/same-day.{app.log,...}`，实况该文件是总控 §8 的**差分（修复前）轮**（内含 `getSources thumbnail={"width":1,...}` 行，可作差分自证）；修复后终轮在 `same-day-recheck1.*`。另 `tests/tmp-d143-*` 实际文件多于 §6 所列（recheck 日志、`tmp-d143-worker-inner.cjs` 等）。T6 清理/引档时一并核对。 |
| S7 | 记录保留建议 | 总控 §8 空闲复核 R1 的启动段 322–373ms（>300，R2 回落 262/203/141）已在 §8 如实登记；建议最终验收记录保留该事实，避免「全 <300」被读成每一轮都成立（DIAG-MAIN 100ms 采样量化也会放大读数）。 |

---

## 三、审查通过面（逐项已核）

### 1. 备份链拆分语义（`backup.js` ↔ `backup-build-worker.js`）——通过
- **条目集/顺序**逐条比对旧实现（HEAD）：library.db → settings.json → ai-config.json → dictionary.db → dicts/* → assets/*（跳过 deletedItemIds，计数不变）→ memory/* → backup-meta.json——新旧完全一致；`isAlreadyCompressed` 的 STORE/DEFLATE 映射逐条保持；JSZip 按插入序写出，zip 条目序不变。
- **`.part` 断点与 rename 收尾**：worker 内 `writeFileSync(tmp)` → `renameSync(dest)`，与旧主线程同语义；失败路径由 `createBackup` catch 清 `destFile+".part"`（`backup.test.cjs`「无 .part 残留」✓）。`snapDir` 在 `finally` 清理（含失败路径），worker 读取发生在清理前（settle 后才进入 finally）。
- **sidecar/轮换/恢复**：`writeSidecar(statSync(destFile))` 在 worker settle 后由主进程执行，语义不变；`rotateAutoBackups/rotateSafetyBackups` 未动；`restoreBackup/applyPendingRestore`（f81 的 C1–C8、f80 的 S3a/S3b/S5）未受影响——`f81 22/22` ✓、f80 失败项不超出既有 S2/S4。
- **worker 生命周期**：settle-once（`settled` 闩）+ `terminate()`；`message(done/quickCheck)` / `error` / `exit` 三事件归一；quickCheck 只上报（ok/异常/失败三态都只是日志，不影响备份成败，与 D137 §3.5「结果仅入日志」语义一致）；worker 内唯一 DB 句柄（只读快照）在 `finally` close；重入由 `settled` 防二次 resolve；`workerData` 只传小文件 `data`（settings/ai-config/meta）与 835MB 级文件的**路径**——大文件跨线程零拷贝（读在 worker 内），方案正确。实测日志佐证：`[backup] 快照完整性检查通过：dictionary.db quick_check=ok` + `skip worker-thread 注入` 行在场。
- 唯一非缺陷观察：`done` 消息与 rename 之间进程级崩溃会「产物完整但报失败」（.part 已被 rename，catch 只清 .part）——极端窗口，产物本身完整可被恢复路径识别，报错仅日志层（不列为必修）。

### 2. autoBackup 调度（main.js:2105-2112）——通过
- 语义等价：旧 `await`+try/catch（只记日志）⇔ 新 fire-and-forget `.then(!ok→log).catch(log)`；返回值其余用途为零（旧代码同样丢弃）。
- skip 双保险未变（`autoBackupIfNeeded` 查 today 文件 + `createBackup` label=auto 再查）；`backups/.snapshot-*` 与 `.part` 均不匹配 `BACKUP_ZIP_RE`/`AUTO_RE`，不会冒充可用备份。
- 与其它定时器交互：`backfillSidecars`(5s) 现在先于 autoBackup(30s) 运行（旧实现里它排在备份之后调度）——两者无共享状态（sidecar 各自读写、无同名文件竞争），无回归；`learnerRefresh`(20s) 与备份无交点。退出时在途：见 M3（残留问题），正确性上「未完成→次日/同日重试」成立。

### 3. `learnerDb.replaceBatch` + learnerRefresh 让出——通过
- 事务边界：`BEGIN IMMEDIATE`→（DELETE+预编译 INSERT×N，每 1000 行 setImmediate）→`COMMIT`；catch 显式 `ROLLBACK` 后 rethrow（整表保持旧值，优于旧「DELETE 已提交+部分 INSERT」）。
- 行集等价：`stateRows.map(...)` 逐行取自同一数组、列序与旧 INSERT 相同；`normParams` 仅做 undefined→null（旧路径传入值全为有值或 null，等价）。
- 让出点不改求值顺序：所有新 yield 均为独立语句（不夹在表达式/条件中）；计数器全部在循环外声明；`stepUnits` 的旧 `%5` 让出仍在（只在重切分分支可达），新 `%100` 覆盖稳态快路径——与报告归因（370ms 段主因）一致。
- 单飞锁 `running` 防并发 refresh；事务在途期间唯一外部写口是 `learner:rebuild`（reset→close）与 `saveOnQuit`，交互会以 ROLLBACK+throw 收场并被 refresh catch 捕获——同类竞态 D143 前已存在（仅窗口略大），无新增语义面（S3 提及）。

### 4. 让出点全量核对——通过（报告 ↔ 代码逐条相符）
- main.js 3 处（createWindow 后 / 协议注册+待恢复后 initDb 前 / initDb 后）；db.js 8 处（open+pragma 后、quick_check 后、SCHEMA 后、首批 ALTER 后、词典·日记·知识地基段后、导图·作者段后、legacyBackfill 前、legacyBackfill 后）；learnerRefresh 报告所列 8 类让出（`%2000/%200/%200×2/%200/%100/%100/%50×2`）与 replaceBatch `%1000` 全部在场，位置与报告描述一致。
- 顺序/语义约束：v45.1「协议注册必须先于 await initDb()」保持（新增让出在注册**之前**一宏任务，渲染层无法在一个 setImmediate 内完成进程启动并发请求，实测无回潮迹象）；quickCapture/workbench/tray/pluginHost/memoryTidy/reconcile 相对顺序与各自 try/catch 全部保留；`[DIAG-TEMP]` L5-28 未动。
- `nextTick()` 复用（db.js:1901 setImmediate Promise）语义正确，与 scanCards 既有口径一致。
- **T4「可选低优先」已实施的理由核查——成立**：移除 `await autoBackup` 后 whenReady 前缀合回单一宏任务（空库实测 ~730ms，>300ms），必然违反 T1 的全窗口 ≤300ms 验收；T4 自身验收（empty 前 1s ≤263ms、DIAG-MAIN 零空洞）也在 artifact 中成立。诊断表的「可选」标注被 T1 验收条件覆盖，属合理升级。

### 5. `dictDb.open()` 移除 quick_check——通过
- 启动链与「首次查词」路径不再触发 1.2s（热）/21.6s（极值）阻塞；主库（db.js）与 learner.db 的启动 quick_check 维持不变，与 GUIDE D143 行 + D137 附录 C 登记逐条一致；改由 worker 对**每日备份快照**只读执行（每天一次、结果入日志）——实测日志行在场。查询路径对损坏库的即时暴露（sqlite 报错）仍成立。

### 6. `screenCapture.warmup()` 删除——通过
- `start()` 主体仅新增 t0/日志（行为零变化）；mac 分支无影响（warmup 原本 win32-only）；全仓（含 src/、preload）零 `warmup` 引用残留（仅 tmp-* 测量件引用）；`module.exports = { start }` 与调用面一致。

### 7. 工程边界——通过（除 M1/M2 两项文档登记面）
- 无 `src/` 改动；无新设置键（f18 84/84 独立复跑 ✓；diff 内零 settings 键新增）；GUIDE 标题版本 48.98 = 文档集最高版本（f11 L3 ✓）；§ 引用无悬空（f11 L2 ✓）；`[DIAG-TEMP]` 未动；无 stash 残留（`git stash list` 空）。
- 闸门复跑（本审查）：f21 7/7 ✓、f18 84/84 ✓、f20 26/26 ✓、f11 14/16（L1 既有红 + **L4 本批红=M1**）、f24 11/12（R3=F91/F92 缺 § 依据，两文件未改动，既有红）、f27 13/14（W6 既有红，growth.js 未改）。

### 8. 报告 ↔ 代码/artifact 一致性抽查——通过（除 S5/S6 文字层）
- 「refresh 分段全 <300」：artifact 佐证（`first-of-day-d143final.app.log`：refresh dur=791ms 内分段 133/118/115ms）。
- 「autoBackup enter ≥30s」：artifact 佐证（proc.start≈1791789771084 → enter 1791789802133 ≈ +31.0s）。
- 「唯一 >300ms 段 = 快照终结 I/O（370ms，空闲 343ms）」：artifact 佐证（370ms hole 落在快照相；独立探针 213ms finalize 佐证下限归因）。
- 总控 §8 差分判定可信：差分轮 `tests/tmp-lag/same-day.app.log` 实含 `getSources thumbnail={"width":1,...}`（只有修复前代码有）与 `stats:overview 327ms`——自证链成立；`stats:overview` 与 D143 改动面（backup/dictDb/learner*/main/screenCapture/db 让出）无交集，判独立既有项成立。
- 「代码做了但报告没写」：仅扫到 S5/S6 文字层偏差，无隐藏实现。

### 9. 已知红核对（不误判为本批）——通过
- f05：复跑复现 B2 `EBUSY: unlink ...flow-f05-userdata\library.db`（未到备份链即崩，与报告最小复现一致）。
- f80：5/7，恰为 S2（`library.db-wal/-shm` 被算作"数据文件"——D137 明文不入包；已核 HEAD 版 backup.js 同样不含 sidecar）+ S4（差异全为 `cards.fsrs_json`；S5 输出含 `app.legacyBackfillV1` 标记——D134 重启回填机制对得上）。
- f11 L1（`readerActionsSettings.ts`）为文档记载的既有红（M13 行），diff 未触碰该处。

### 10. 套件/闸门独立复跑记录（本审查执行）
```
ELECTRON_RUN_AS_NODE=1 npx electron tests/backup.test.cjs   → 34/34 ✓
npx electron tests/lm-db.test.cjs                            → 67/67 ✓
npx electron tests/legacyBackfill.test.cjs                   → 89/89 ✓
node tests/flows/f81-restore-fault-injection.cjs             → 22/22 ✓
node tests/flows/f80-backup-roundtrip.cjs                    → 5/7（恰 S2/S4 既有红）
npx electron tests/flows/f05-data-lifecycle.cjs              → B2 EBUSY（既有红复现）
npx electron tests/flows/f18-settings-matrix.cjs             → 84/84 ✓
npx electron tests/flows/f20-command-contract.cjs            → 26/26 ✓
node tests/flows/f21-ipc-bridge.cjs                          → 7/7 ✓
node tests/flows/f11-doc-code-drift.cjs                      → 14/16（L1 既有红；L4 = M1 本批红）
node tests/flows/f24-coverage-audit.cjs                      → 11/12（R3 既有红）
node tests/flows/f27-restraint-redlines.cjs                  → 13/14（W6 既有红）
```
（未运行 `tests/tmp-lag-run.cjs`：会覆写 D143 验收 artifact；定量口径以总控 §8 空闲轮为准。）

---

## 四、未确认风险（无法在本环境闭合）

1. **打包（asar）路径下 worker 加载**：`new Worker(__dirname/backup-build-worker.js)` 与 D117 `backup-meta-worker.js` 同机制（该机制已在包内使用），但本轮未在 electron-builder 产物中实测；若 asar 内 worker 加载受限，将影响全部备份（S1）。建议总控在下一次打包验证时顺手实跑一次「首启自动备份」。
2. mac/linux 未测（本就无 warmup；`desktopCapturer`/worker 路径平台差异未取数）。
3. R1 启动段 322–373ms 的成因未逐项拆解（DIAG-MAIN 100ms 采样量化 + 真实数据建窗成本混合）；已由 §8 登记为轮间波动（R2 达标），如需根治再评估 T4 加密。
4. 本机并行 dev 实例在场期间的复跑为**功能性口径**（套件断言、闸门、逻辑）；计时级结论以总控 §8 空闲轮与现存 artifact 为准，未重新采集。

---

# 复审（第 2 轮 · code-reviewer）—— M1/M2/M3 闭环复核

> 范围：仅第一轮「必须修复项」M1/M2/M3 的闭环质量（其余审查面第一轮已核，不重审）。
> 基线：`docs/design/D143-REVIEW-FIX-REPORT.md`；工作区仍为分支 `feat/d143-startup-lag` 未提交 diff（复审期间零代码改动、零 commit / stash / 切分支）。
> 环境：机器空闲（复查前后 `tasklist | grep -i electron` 均无匹配）；真实 `%APPDATA%/incremental-reading-dev/backups/` **只读**（6 个 `.snapshot-*` 原样在场，未触碰）；M3 验证全部在 OS 临时目录隔离进行（本轮自写探针跑于 `%TEMP%`，用后即删）；未触碰 `design-samples/`、`docs/design/D142-*`、`tests/tmp-d142-*`。

## 复审结论

**合格** —— M1/M2/M3 三条均达成第一轮「可机械检查的通过条件」，闭环成立；**无新增必须修复项**。附建议项 6 条（不阻塞）。

## 复跑命令与输出摘录（本轮独立执行）

```
$ node tests/flows/f11-doc-code-drift.cjs
  · 标题版本 / 正文最高版本 = 48.99 / 48.99            ✓（L3）
  · 正文用到的最大决策号 = D143
  ✓ D1…Dmax 无缺号（缺号＝决策未登记或编号打错）        （L4）
  ✓ 最新决策号 D143 已在 §8.1 登记                      （L4）
  ==== F11 FAIL 15/16 · 唯一失败 [L1] 实际: ["src/lib/readerActionsSettings.ts"]（文档记载既有红，diff 未触碰）

$ grep -c "f80/f81 全绿" AI_DEVELOPMENT_GUIDE.md            → 0
$ grep -c "f81 全绿；f80 见下既有红" AI_DEVELOPMENT_GUIDE.md → 1（完整句见 L1472）

$ ELECTRON_RUN_AS_NODE=1 npx electron tests/backup.test.cjs
  ✓ 旧 .snapshot-* 与非今日 .part 被清扫（中断残留孤儿回收）
  ✓ 当日 .part 不误删（可能是在途构建）
  M2 备份单元测试：36 通过 / 0 失败

$ node tests/flows/f81-restore-fault-injection.cjs   → F81 PASS 22/22 断言
$ node tests/flows/f80-backup-roundtrip.cjs          → F80 FAIL 5/7（失败项恰为 S2、S4，与第一轮基线一致）
```

独立隔离探针（本轮自写，`%TEMP%`，**20/20 通过**；`sweepBackupOrphans` 逐语义）：
```
旧 .snapshot-*（非今日 mtime）→ 删；今日 mtime .snapshot-* → 保留
旧 auto / manual / manual-2（去重后缀）/ safety .part → 删；今日 .part → 保留
解析不出日期（backup-weird-name.zip.part）→ 保留；非 .zip.part 结尾 → 不动；终态 .zip → 不动
目录不存在 / backupDir 是文件（ENOTDIR）→ 不抛出（ok:true, 0/0）
在途保护：createBackup（注入 snapshotLibrary，其内触发清扫）——登记目录 mtime 改旧仍被保留，
          同轮未登记旧目录照样被清；createBackup 完成后目录 finally 清零、产物 zip 在、无 .part 残留
backfillSidecars 挂点集成：snapshotsSwept / partsSwept 字段返回且清扫生效
```
稳定/并发压力探针：25/25 顺序 createBackup 成功；3 个并发同秒 manual createBackup 全部 ok 但**同写同一 destFile**（既有行为，见 R2-S2）。

## M1 闭环判定（f11 L4，预登记路径）——✓

- **事实逐条一致**（GUIDE §8.1 D142 行 ↔ `docs/design/D142-CARDDOCK-RESTYLE.md`）：线条收敛（普查 20 处·处置矩阵）；变体矩阵 V1 下缘一划 / V2 无痕浮线 / V3 灰纸块；发送钮 H1 深一档 / H2 反白幽灵 + 禁用 D1 / D2；用户裁定 V1·H1·D2（2026-10-12 样张选定）；交付＝样张 html + 对照/状态截图（`design-samples/D142-carddock-restyle{,-docks,-states}` 均在）+ 零依赖零网络 + 验收清单 §7（10 条）+ 任务拆解表 §8（7 项）；D123 修订点 R1–R10；两条用户指令来源（设计稿 §0）——**无占位、无夸称**；「实施尚未启动（预登记，待实施批）」与 diff 实况一致（本批无 `src/` 改动）。
- **闸门**：L4 ✓（D1…D143 无缺号，D142 空洞关闭；D142/D143 各仅 1 行）；L3 ✓（48.99/48.99）。先例核对：`git show 0688ccd` 标题即为 v48.94（= D136 预留版），「预留版本 + 标题联动 bump」机制成立。
- **附加判断（D142 实施批文档债，→ R2-S6）**：**无结构性债务**（编号已占、v48.99 已预留、标题已联动、L4/L3 均绿）。实施批 GUIDE 动作应为：① 把 D142 行「实施尚未启动（预登记，待实施批）——零 DOM 变更（纯 src/theme.css）」替换为实施记录（实施批次、验收 §7 逐项结果、GUI 冒烟、审查结论），删「预登记」字样；② 版本保持 v48.99 不再 bump（标题已 48.99，L3 天然自洽）；③ 同步 `D142-CARDDOCK-RESTYLE.md` 头部「决策号 D142（待 GUIDE §8.1 登记）」→「已登记」——**该句现已 stale**，实施批顺手更新；④ 实施如被迫偏离矩阵数值（设计 §7#7 禁止改数）须按 §8.1 口径登记偏差。若 ① 遗忘，该行将以「实施尚未启动」描述已实施现实（§1.9 级漂移，一行字成本）。

## M2 闭环判定（措辞）——✓

- `grep -c "f80/f81 全绿"` = **0**；`"f81 全绿；f80 见下既有红"` = **1**，完整句「…见 `docs/design/D143-REVIEW-FIX-REPORT.md`）；f81 全绿；f80 见下既有红（实测 5/7，恰为 S2/S4）。」（L1472）；行内后文「f05/f80 为 D137…/D134…既有红」与之一致——全行单一 f80 事实，无并存矛盾。
- 与 `D143-STARTUP-LAG-FIX-REPORT.md` §3 一致：§3 的 f80 既有红归因即 S2（WAL sidecar 不入包）/S4（legacyBackfill fsrs_json）；「实测 5/7」由本轮复跑（5/7，恰 S2/S4）与第一轮复跑（5/7，恰 S2/S4）双重佐证。
- 套件数同步为实况（backup 36）经本轮复跑证实（36/36，含 2 条新增断言）。

## M3 闭环判定（清扫机制，独立语义审查）——✓

1. **在途保护**：生命周期正确——`mkdtemp` 后立即登记（`activeSnapshotDirs`），`finally` 中 rm 后注销（失败路径同经 finally；探针「缺失快照文件」用例证实失败后零残留）。**并发 createBackup 非单飞**（无锁）：但保护不依赖单飞——每次调用独享 mkdtemp 目录并各自登记；同秒同 label 并发会撞同一 destFile/.part（**既有行为**，`git show HEAD:electron/backup.js` 命名/去重段与本批逐字一致，非本批引入 → R2-S2）。登记判定保守性：登记目录**即使 mtime 已旧**也保留（专测）；未登记且非今日 mtime 才删——所有歧义方向均偏向「保留」。
2. **日期解析**：`partFileDayTag` 覆盖 auto（`YYYY-MM-DD`；auto 无去重分支——命中即 skipped，已核命名代码）/ manual + safety（`YYYYMMDD-HHMMSS` + `-\d+` 去重后缀，`-2`/`-10` 均兼容）；「今日」= `dayTag` 本地时间，与命名 `dayTag`/`stamp` 同源同口径；解析失败 / 非 `.zip.part` 一律保留（探针逐项验证）。
3. **挂点与交互**：sweep 挂 `backfillSidecars` 头（+5s，**零新增定时器**）→ autoBackup +30s。**顺序交互无洞**：+5s 保留的当日 `.part` 在 +30s 重跑时被同一路径覆盖复用（worker 重写 `.part` → rename，不读旧内容；「今日 final zip 缺失」为触发前提）；跨日 `.part` 与旧 `.snapshot-*` 由 sweep 回收。sweep 全部 fs 操作单独 try/catch（不存在 / ENOTDIR 均返回 ok:true 0/0）；唯一前置＝`getBackupDir` 环境判定，与既有 `backfillSidecars` 同前置，main.js 挂点另有 `.catch` 兜底——**「不抛出」成立**。
4. **午夜跨界窄窗（→ R2-S3，登记口径即可）**：启动于午夜前 ~5s 内的用户手动备份，其 `.part` 名日 tag＝旧日而 +5s sweep 的「今日」已翻页 → 理论可删在途 `.part`；Windows 下写句柄挡删（Node 不开 FILE_SHARE_DELETE）实际无害，POSIX 最坏＝该次构建失败入日志。窗口 ~5s×午夜、失败仅日志级，不阻塞。
5. **测试强度判定**：套件新增 2 条断言覆盖「旧快照 + 旧 auto .part 删 / 当日 .part 留」——**满足第一轮通过条件**；未入套件的两处：① 在途登记保护（安全关键分支）；② manual/safety/去重后缀解析与解析失败保守保留。**判建议补（非阻塞）**：失败模式上限＝在途备份构建失败（日志可见、次日/同日重试）+ 残留回收延迟，不涉用户数据丢失；机制已由三个独立探针（修复报告验证 4 + 本轮 20/20 + 等价 v1 场景 3/3）覆盖。**成本独立估算**：复用现有 BAK 夹具新增 ~20 行（解析类 3-4 个 `.part` 文件名 + 2 断言 ≈ 6 行；在途保护＝`snapshotLibrary` 注入内触发 sweep + 断言登记目录存活与 finally 清零 ≈ 12 行），运行开销 <1s。归属：`bug-fixer`。
6. **修复报告验证 4 可复现性**：其描述（`backfillSidecars` 返回 `snapshotsSwept:1 / partsSwept:2`、剩余「当日 .part + data」；注入式快照内并发清扫 → `snapshots:0` 且在途目录仍在、完成后目录＝「产物 zip + data + meta」）与本轮独立等价探针逐条吻合，证据链自洽充分（其探针为一次性脚本未落盘，但步骤可完全重建）。**验证 4 成立**。
7. **偶发观察（→ R2-S1，LOW）**：本轮首个探针（人工在途清扫场景）中 `createBackup` 曾**一次性**返回 `{ok:false}`（错误串未捕获）；随后 4 轮等价复跑（3/3 + 20/20）+ 25 轮顺序构建 + 套件全量**零复现**。最可疑机制＝`buildZipInWorker` 的 `exit`/`message` 投递竞态（settle-once 先到先得，exit 映射为失败），无法坐实。影响面：失败仅入日志、次日/手动重试，不损坏数据。建议（可选）`exit` settle 加一次 `setImmediate` 让消息先到。

## 建议项（不阻塞；编号接第一轮 S7 后另起）

| # | 项 | 内容 | 建议归属 |
| --- | --- | --- | --- |
| R2-S1 | worker exit/message 竞态加固（LOW，偶发未复现） | `buildZipInWorker` 的 `exit` 分支 settle 加 `setImmediate` 一 tick，避免「done 已发、exit 先到」被记为失败 | bug-fixer（一行） |
| R2-S2 | 并发同秒 manual 备份撞同一 destFile（既有，非本批） | 3 并发实测同写同一 `.part`/destFile（均报同一文件名）；HEAD 命名代码相同。可选防护：命名去重改独占写（`wx`）或 IPC 串行化；当前 UI 路径风险低，仅登记 | core-engineer（如要动） |
| R2-S3 | 午夜跨界窄窗登记口径 | 如需完全闭合可在 `.part` 判据加 mtime 并列条件；现状（Windows 无害 / POSIX 日志级失败）可不做——确定口径即可 | core-engineer（口径） |
| R2-S4 | 修复报告措辞 | 「由用户下次启动……自然回收」精确化为「次日（及以后）启动回收」——6 个真实残留 mtime 为今日（10-12 08:36–10:55），**同日重启不会回收**；报告后文「次日启动回收」已准确，前句对齐即可 | 文档维护者 |
| R2-S5 | 沿用断言计数漂移（既有） | GUIDE §7.3 行「33 断言」与 L1226「34 断言」（HEAD 已如此，非本批引入）vs D143 行现「backup 36」三处并存；下次触碰文档时同步（或标注历史） | 文档维护者 |
| R2-S6 | D142 实施批文档动作（M1 附加判断） | 见 M1 节四条：翻状态句（GUIDE 行 + 设计稿头「待登记」）、版本不再 bump、数值不得改（改则按 §8.1 记偏差） | 实施批（总控编排） |

## 复审通过面小结

- M1：D142 预登记行与设计稿逐条一致（无占位 / 无夸称 / 待实施状态如实）；f11 L4 ✓、L3 ✓；标题 v48.99 联动（0688ccd 先例机制核对成立）。
- M2：行内单一事实；grep 计数 0 / 1 达标；与报告 §3 及实测 5/7（恰 S2/S4）一致。
- M3：清扫语义（在途保护 / 日期解析 / 挂点交互 / 不抛出）经代码走读 + 20/20 独立探针 + 25 轮压力探针 + 套件 36/36 + f80 5/7(S2/S4) + f81 22/22 交叉证实；f11 唯一失败＝L1 既有红（`readerActionsSettings.ts`，diff 未触碰）。
- 环境尾部：复审结束 `tasklist | grep -i electron` 无匹配；探针脚本已从 `%TEMP%` 删除；真实 `backups/` 只读未动。

**复审结论：合格**（M1/M2/M3 闭环，无必须修复项；R2-S1…S6 均为建议，不阻塞）。
