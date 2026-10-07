# D116 诊断报告：打开设置卡顿数秒、期间页面滚不动

> 只读诊断（core-engineer，两阶段流程第一阶段）。不实施修复。用户原话：「还有一个大问题是打开设置窗口后会卡好几秒，这几秒里页面都滚不动，过几秒才好。」
> 探针与量测产物：`tests/tmp-jank-probe.mjs`（现行）、`tests/tmp-jank-probe-baseline.mjs`（基线变体）、`tests/tmp-jank-ipc.mjs`、`tests/tmp-jank/*.json|png`（用完即删类临时件）。

## 0. 一句话结论

卡顿**不是 D114 引入**（基线 4d07c33 同口径同样卡 14.5s）：根因是**打开设置即挂载 BackupSection，其 mount 触发 `backup:list`，主进程在事件循环上同步 `fs.readFileSync` 整个 zip（单份 ~895MB，共 11GB/12 份）再用 JSZip 解析出 `backup-meta.json`**，主进程（= Chromium browser 进程 UI 线程）被阻塞 10–17s，输入派发与合成器出帧停摆 → 页面滚不动。渲染层主线程无罪（全程 longtask 仅 65–130ms，rIC 零忙段）。

## 1. 量测数据

### 1.1 方法

- Electron 起 `--remote-debugging-port=93xx/94xx` + `--inspect=94xx`；CDP 连主窗口与主进程双端 `Profiler.setSamplingInterval(250us)` 采样画像；`PerformanceObserver(longtask)` + `requestIdleCallback` 忙段链；`Input.dispatchMouseEvent` 真实点击顶栏「设置」按钮 + 滚轮打在 `.settings-layout` 中心，逐轮查 `scrollTop` 得 firstScroll。
- 数据环境：`tests/tmp-jank-userdata/`（真实用户数据副本，`backups` 符号链接指向真实备份目录）。真实备份目录：**12 个 zip，其中 9 份 ~895MB，合计 11GB**。
- 注：两轮画像中主进程内 wrap `listBackups` 计时均因 inspector 上下文无 `require` 而失败（fnLog=[]）；`backup.list` 耗时由独立逐 IPC 探针（`tmp-jank-ipc.mjs`，冷启动逐条调用，同数据）取证，画像热点互证。

### 1.2 现行版本（v48.71 = cc25d70 + 工作树 theme.css D116 草稿，head-v3b.json）

| 指标 | 值 |
| --- | --- |
| 点击 → 面板可见（DOM 出现） | **69 ms** |
| 点击 → 首次滚动成功（scrollTop>40） | **9831 ms** |
| 渲染层 longtask | **1 条，共 65 ms**（start 6589, dur 65） |
| 渲染层 rIC 忙段（>250ms） | **0 段** |
| 设置面板 DOM | 308 节点 / scrollHeight 4020px |
| 渲染层画像窗口 CPU | idle 5753ms / 12740ms（≈45%） |
| 主进程画像窗口 CPU | `(native)` 2681ms + `nm:jszip` 2514ms / 14154ms |

主进程热点（函数 / self / 文件:行号）：`ArrayReader` 2501ms（jszip 内部 `reader/ArrayReader.js:5`）、`read` 2328ms + 299ms、`(garbage collector)` 13ms、`FastBuffer` 4ms（`node:internal/buffer:960`）、`readSettings` 1ms（`electron/main.js:143`）。——即画像窗口内 **~5.2s 花在「把 zip 读进内存 + JSZip 解析」**。

### 1.3 逐 IPC 冷耗时（head-ipc.json，同数据冷启动按挂载顺序逐条）

| 调用（触发处） | 耗时 |
| --- | --- |
| **backup.list（BackupSection mount）** | **16851 ms** |
| backup.info（BackupSection mount） | 14 ms |
| optimizer.stats（FSRSSection mount） | 81 ms |
| 其余全部（ai.getConfig / dict.sources / memory.status / limits.state / settings.get / fsrs / shortcuts） | 0–4 ms |

### 1.4 longtask 清单口径说明

渲染层 longtask 全量仅 2 条（现行 65ms；基线 76+54ms），不构成秒级卡顿源；秒级阻塞在主进程，以画像热点（§1.2）+ 逐 IPC（§1.3）呈现——上表即为「函数/时长/文件:行号」清单。

## 2. 基线对照（同口径，4d07c33 = v48.68，D114 前；baseline-v3.json）

| 指标 | 基线 4d07c33（D114 前） | 现行 cc25d70+D116 草稿 |
| --- | --- | --- |
| 点击 → 面板可见 | 84 ms | 69 ms |
| 点击 → 首次滚动成功 | **14471 ms** | 9831 ms |
| 渲染层 longtask | 2 条共 130 ms | 1 条共 65 ms |
| 渲染层 rIC 忙段 | 0 段 | 0 段 |
| 主进程 CPU Top | `(native)` 3645ms + `nm:jszip` 3489ms / 14s 窗口（`ArrayReader` 3472 + `read` 3152+318） | `(native)` 2681ms + `nm:jszip` 2514ms / 14.2s 窗口 |

**结论：D114 前后同口径均卡 10–15s，卡顿预存，与 D114 重设计无关**（D114 只改信息架构/样式/tooltip，未改挂载结构——基线 SettingsPanel.tsx:1614 `<BackupSection/>` 已无条件渲染于 :2531，现行 :2630，渲染层 longtask 反而更小）。两次实测时长差（9.8s vs 14.5s vs 16.9s）来自 OS 文件缓存冷热；`listCache`（electron/backup.js:249，按 mtime+size 键、进程内存）使**同一次运行内第二次打开设置很快**——与用户「过几秒才好」的体感一致（每次冷启动后的第一次打开必卡）。

## 3. 根因链（证据 → 结论）

1. **证据**：App.tsx:512 设置按钮 → `setSettingsOpen(true)`（:561）挂载 SettingsPanel；现行/基线均把 `<BackupSection/>` 无条件渲染在常挂载列表里（src/components/SettingsPanel.tsx:2630 现行 / 基线 :2531）。
2. **证据**：BackupSection mount 即 `reload()` → `Promise.all([api.info(), api.list()])`（src/components/SettingsPanel.tsx:1733–1745）；`backup:list` handler（electron/main.js:742）→ `listBackups()`（electron/backup.js:268）逐文件 `readBackupMeta(full)`（:284–288）。
3. **证据**：`readBackupMeta` = **`fs.readFileSync(file)` 整包读入 + `JSZip.loadAsync(buf)` 仅取 `backup-meta.json`**（electron/backup.js:253–266）。
4. **证据**：真实备份目录 12 份 zip 共 11GB（9 份 ~895MB）；`backup.list` 冷耗时 **16851ms**，其余 mount IPC ≤81ms；主进程画像热点集中于 jszip `ArrayReader/read` + native 读。
5. **结论（主进程归位）**：打开设置 → BackupSection mount → `backup:list` 在**主进程事件循环上同步串行**读入并解析 ~10GB → 主进程阻塞 10–17s。
6. **结论（渲染层归位与「滚不动」机理）**：渲染层 longtask 仅 65–130ms、rIC 零忙段——渲染层 JS 主线程空闲。Electron main 进程即 Chromium **browser 进程 UI 线程**，其阻塞期间输入事件派发与合成器帧调度（BeginFrame）停摆，渲染层收不到滚轮输入、也出不了新帧 → 表现为「页面滚不动、过几秒才好」。card-fill/containment/32 tooltip 等 D114 渲染层变更与本卡顿无关（面板 DOM 仅 308 节点、69–84ms 即可见）。

## 4. 修复方案（文件级，未实施）

### 4.1 A（根治）：备份 meta 改走 sidecar，列表不再解压 zip

- **electron/backup.js**
  - `createBackup`（:181 附近）写 zip 的同时，把已算出的 `meta` 同步落一份 sidecar：`<zip 名>.json`（~几百字节，`JSON.stringify(meta)`，临时文件+rename 原子写，遵守「每次落库即落盘」精神）。
  - `readBackupMeta`（:253）优先读 sidecar：存在且 key（mtime+size，复用 :249 listCache 键先例）匹配 → 直接返回，**不再 readFileSync 整包**；仅 sidecar 缺失（旧档）才回退 zip 解析，解析成功后**补写 sidecar 自愈**。
  - `listBackups`（:268）逻辑不变，仍按 `^backup-(manual|auto|safety)-.+\d\.zip$` 过滤，sidecar 文件名不匹配该正则、天然不进列表；轮转/删除（rotateSafetyBackups :330、rotate :357、恢复清理）需同步 `fs.rmSync` 对应 sidecar。
  - 建议顺手把回退解析改为 `fs.promises.readFile` + 移入 `worker_threads`（见 B），避免旧档首列仍阻塞。
- **（可选一次性迁移）electron/main.js** 启动空闲时（`app.whenReady` 后 requestIdleCallback/setTimeout）对缺 sidecar 的旧档后台补齐，让用户第二次打开即全量走 sidecar。

- **预期收益**：打开设置 → BackupSection 列表数据毫秒级返回，主进程不再秒级阻塞 → firstScroll 从 9831/14471ms 降至 **<300ms**（渲染层本身仅 69–84ms 挂载 + 65ms longtask）。
- **风险**：sidecar 与 zip 失步（以 mtime+size 键失效，篡改 zip 后回退重解析一次即可自愈）；备份目录多出 .json 文件（用户可见，文档需说明）；旧档首次列表仍慢一次（可被启动迁移掩盖）。
- **回归清单**：备份列表/创建/恢复/轮转/删除的既有 GUI 用例；autoBackup 定时任务；「恢复后 sidecar 失效」专项；`backup:list` 在 11GB 数据下冷/热两次打开的耗时断言；按 §8.1 **先立决策号（建议 D117）+ bump 版本**，§4 IPC 契约补 sidecar 行为描述后再编码。

### 4.2 B（防御纵深，可与 A 合并实施）

`readBackupMeta` 的 zip 回退路径挪入 `worker_threads`（worker 脚本仅此一件事），主进程事件循环永远不再被单文件整包读阻塞；收益：任何数据规模下 UI 线程不冻结；风险：worker 与主线程通信错误面、需处理 worker 崩溃回退（同步路径兜底）。

### 4.3 C（不推荐单独做）

仅把 `readFileSync` 换 `fs.promises.readFile` **不解决**问题：磁盘读虽走线程池，895MB 的内存分配/GC 与 JSZip 解析仍阻塞主进程事件循环，且 10GB 峰值内存压力更差。

## 5. 附：产物索引

- 探针：`tests/tmp-jank-probe.mjs`（现行版）、`tests/tmp-jank-probe-baseline.mjs`（基线变体，ROOT 指向 worktree）、`tests/tmp-jank-ipc.mjs`（逐 IPC）
- 结果：`tests/tmp-jank/head-v3b.json`（现行）、`tests/tmp-jank/head-ipc.json`（逐 IPC）、`tests/tmp-jank/baseline-v3.json`（基线）、`tests/tmp-jank/head-open*.json|head-v3.json`（前次中断会话的早期轮次）
- 数据环境：`tests/tmp-jank-userdata/`（真实数据副本；backups/dicts/assets 为指向真实 userData 的符号链接，诊断后保留供修复实施复测）
- 基线工作树（4d07c33，junction 复用 node_modules）已拆除，其结果已复制回 `tests/tmp-jank/`

## 6. 实施修订记录（D117 / v48.73，core-engineer，2026-10-07）

> 本节为文末追加，不改 §1–§5 既有结论。实施依据 = §4.1 方案 A（sidecar 根治）+ §4.2 方案 B（worker_threads 防御纵深）合并实施；§4.3 方案 C 维持不做。

### 6.1 改动清单

| 文件 | 改动 |
| --- | --- |
| `electron/backup.js`（+174 行） | ①`createBackup` 落盘 zip 后同步写 meta sidecar（原子写：`.new` 临时名 + rename，写失败吞错不影响备份本体）；②新增 `sidecarPathFor / statKeyOf / readSidecar / writeSidecar / removeSidecar`；③`readBackupMeta` 改为「sidecar 命中（key = zip 的 mtime+size）→ 零解压返回；未命中 → zip 回退解析一次并补写自愈」；④回退解析经 `parseMetaInWorker`（worker_threads）执行，worker 崩溃/超时（60s）/不可用时同步路径 `readBackupMetaSync` 兜底；⑤同文件并发解析按路径去重（`inflightZipParses`）；⑥`rotateSafetyBackups / rotateAutoBackups` 删 zip 时同步删 sidecar；⑦新增 `backfillSidecars`：启动空闲补齐缺 sidecar 旧档 + 回收孤儿 sidecar/半成品 `.json.new`；⑧`listBackups` 过滤正则与返回形状零变更（sidecar 在 `meta/` 子目录，不匹配 `BACKUP_ZIP_RE` 天然不进列表） |
| `electron/backup-meta-worker.js`（新增） | §4.2 worker：职责仅「整包读入一份 zip + JSZip 取 `backup-meta.json`」，`fs.promises.readFile` + JSZip；失败 postMessage `{ok:false}` 由主进程兜底 |
| `electron/main.js`（+14 行） | `app.whenReady` 后延迟 5s 调度 `backup.backfillSidecars()`（后台串行 worker 解析、不阻塞主进程；失败仅影响下次列表速度）。**backup:list IPC 通道名与返回形状零变更**；渲染层零改动 |

### 6.2 对 §4.1 的实施修订（报告未尽事项，按最小惊讶原则裁定）

1. **sidecar 存放位置**：§4.1 原文「`<zip 名>.json`（备份目录顶层）」→ 实施为 **`<backupDir>/meta/<zip 名>.json` 子目录**。原因：既有闸门/单测按「备份目录顶层文件名」过滤计数（f05 B6 的 `^backup-auto-` 计数、`backup.test.cjs` 同型断言），顶层散放 `.json` 会被一并计入而误报；子目录同时让用户视角的备份目录保持「只有 zip」。
2. **原子写临时名后缀**：用 `.json.new`（避开 f39 leftovers 哨兵的 `.tmp/.part` 模式）；`writeFileSync` + `renameSync` 背靠背同步、中间无 await，进程被杀也造不出半成品 sidecar；`backfillSidecars` 巡检顺带回收孤儿 `.json.new`。
3. **sidecar 失效键**：`key = mtimeMs-size`（复用既有 listCache 键先例，§4.1 已建议）；zip 被篡改/替换 → key 失配 → 回退重解析并以 zip 内 meta 为准重写 sidecar（「zip 本体是唯一事实源」的机械落实）。
4. **worker 兜底**：§4.2 的「worker 崩溃回退（同步路径兜底）」落实为 worker 起不动/超时 60s/非零退出三级都降级到 `readBackupMetaSync`（仍能出正确结果，只是该次会阻塞主进程——正常路径不再走到）。
5. **IPC 形状**：`backup:list` 返回形状零变更（`valid/counts/assetFiles/…` 字段语义不变，仅数据来源从「每次解压 zip」变为「sidecar 优先」），渲染层无需配合改动。

### 6.3 验收结果矩阵

| 验收项 | 命令 | 结果 |
| --- | --- | --- |
| sidecar 自愈路径自证（验收 #5，临时探针 11 组 32 断言：创建即写/命中零解压/删 sidecar 自愈/损坏自愈/zip 替换 key 失配重解析/backfill 补齐/轮转同步清/孤儿回收/恢复不依赖 sidecar/sidecar 写失败不伤备份本体/半成品回收） | `node tests/tmp-sidecar-probe.mjs` | **32 通过 / 0 失败**（探针用完即删） |
| 文档-代码漂移闸门 | `node tests/flows/f11-doc-code-drift.cjs` | **PASS 17/17** |
| 数据生命周期闸门（备份/恢复/轮转回归） | `npx electron tests/flows/f05-data-lifecycle.cjs` | **PASS 43/43** |
| 崩溃恢复闸门（落盘相邻域回归） | `npx electron tests/flows/f04-crash-recovery.cjs` | **PASS 33/33** |
| 类型检查 | `npx tsc --noEmit` | **0 错误** |
| 构建 | `npm run build` | **成功**（7.50s） |
| GUI 备份恢复端到端 | build 后 9224 启动 + `node tests/m2.gui.mjs` | **21/22**（唯一失败经下述取证确证为**预存数据序伪影**，与本批无关，见 6.4） |

### 6.4 m2.gui 唯一失败的取证（预存，非实现缺陷）

失败断言：「备份列表渲染出条目（含手动/自动/安全标签）」——其实现是**把列表行文本 join 后截断到前 400 字符**再要求三个标签齐全。取证：对运行中的应用 dump 全部 17 行 DOM，三标签齐全、排序（createdAt 降序）与计数全部正确；首个「自动」行出现在第 **464** 字符——被今日历次 m2 跑自己产生的 4 对「手动+安全」备份（18:42/18:45/19:15/19:16/22:47）挤出 400 字符窗口。**stash 对照（A/B 同目录同状态）**：用 HEAD 版（D117 前）`listBackups` 与 D117 版对同一真实备份目录各跑一遍，17 行输出**逐字段完全一致**（file/label/createdAt/size/valid/counts/assetFiles/含 Key）⇒ 渲染层输入相同 ⇒ 预存代码在该数据态下必然同样失败。另：D114 提交（e1b6f39）已记录 m2×2 为预存基线失败（经 stash 对照）。

### 6.5 性能前后对照（§1 同口径）

数据环境同 §1（`tests/tmp-jank-userdata/`，junction 指向真实备份目录，17 份 zip ≈ 11.4GB；sidecar 已由启动补齐全部写入）。

| 指标（§1 口径） | 修复前（§1.2/§1.3，v48.71） | 修复后（D117 v48.73） | 改善 |
| --- | --- | --- | --- |
| `backup:list` 冷耗时（逐 IPC，BackupSection mount 顺序） | **16851 ms** | **4 ms** | ~4200×（3 个数量级），远低于 <300ms 验收线 |
| `listBackups` 同目录 A/B（node 直调，17 份 11.4GB） | 16495 ms（HEAD 版逐 zip 整包解压） | 6 ms | **2749×** |
| 点击「设置」→ 面板可见 | 69 ms | 102 ms | 持平（挂载本身，量级相同） |
| 点击 → 首次滚动成功（scrollTop>40） | 9831 ms | **346 ms** | ~28×（残值 = 探针 100ms 轮询粒度 × 2 tick + 挂载 144ms longtask，主进程已无阻塞段） |
| 渲染层 longtask | 1 条共 65 ms | 2 条共 144 ms | 持平量级（面板挂载本身，与卡顿无关） |
| 渲染层 rIC 忙段（>250ms） | 0 段 | 0 段 | 持平 |
| 设置面板 DOM | 308 节点 / scrollHeight 4020px | 308 节点 / 4020px | 持平 |

结论：§0 根因链（主进程事件循环被整包解压阻塞）已被消除——`backup:list` 从秒级（10–17s）降至毫秒级（4–6ms），首次滚动恢复到与「面板可见」同量级（346ms ≈ 挂载 102ms + 探针轮询粒度），「卡好几秒、整窗滚不动」不复现。

### 6.6 残留与移交说明

1. **旧档首列仍慢一次**：无 sidecar 的旧档第一次列表走 worker 回退解析（不阻塞主进程 UI 线程，但该 IPC 本身要等解析完）——启动 5s 后的 `backfillSidecars` 会后台补齐，用户第二次打开即全量走 sidecar。真实环境实测：启动补齐一次写齐 15 份 sidecar。
2. **sidecar 是缓存非事实源**：zip 本体仍是唯一事实源（§1.9）；sidecar 缺失/损坏/失配一律回退 zip 解析并重写自愈（探针第 3/4/5/10 组自证），恢复路径完全不读 sidecar（探针第 9 组自证）。
3. **进程/环境遗留**：`tests/tmp-jank-userdata/` 中的 backups/dicts/assets 是指向**用户真实数据**的 junction，为避免误删真实数据**保留不清理**（内含本批启动补齐写入的真实 sidecar，属修复产物，无害）；本批量测后临时探针脚本（`tests/tmp-sidecar-probe.mjs`、`tests/tmp-d117-*.mjs` 及诊断期 `tmp-jank-*.mjs`）与 `tests/tmp-jank/` 量测产物已按「用完即删」清理。m2 跑在其设计的真实用户数据环境产生了一份「手动+安全」备份对（22:47，该套件固有行为，数据=当时现场，无害）。
4. **验收标准第 1 条的说明**：`npx tsc --noEmit` 已跑且 0 错误（渲染层未改动，tsc 覆盖面未受本批影响）；本批主进程改动为 `electron/*.js`（不在 tsconfig 编译范围），tsc 结果与修复前一致。
5. 主进程 inspector 上下文无 `require`（§1.1 已记录的现象在 D117 探针中复现），主进程内 wrap 计时不可用，`backup:list` 耗时以逐 IPC 冷口径（§1.3 同法）+ node 直调 A/B 双口径取证。
