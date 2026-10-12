# STARTUP-LAG-DIAGNOSIS — 启动期「前几十秒点击要过一段时间才有反应」诊断报告

> 状态：**只读诊断（core-engineer 诊断模式，未改任何产品代码）** · 日期：2026-10-12 · 上游：D137/D134/D124/D119、`docs/design/SETTINGS-OPEN-JANK-D116.md`（测量手法先例）、用户 2026-10-12 反馈。
> 产物：本文件 + 测量件 `tests/tmp-lag-run.cjs`（宿主）/ `tests/tmp-lag-instrument.cjs`（主进程注入）/ `tests/tmp-lag-analyze.cjs` / `tests/tmp-lag-profile-detail.cjs` / `tests/tmp-lag-count.cjs` + 原始日志 `tests/tmp-lag/*.app.log|*.page.json|*.cpuprofile`（临时件，按仓规「用完即删」，见 §7 处置意见）。

---

## 0. 一句话结论

主进程（= Chromium browser 进程 UI 线程）在启动后前 ~20 秒被三段**同步代码**连续占用——**① 当天首次启动时 `await backup.autoBackupIfNeeded()`（`main.js:2089`）全程 40.3s~90.8s 在启动链上同步执行：其中 `dictDb.open()` 的 `PRAGMA quick_check`（835MB dictionary.db）实测 1.2s（稳定）~21.6s（一次性极值）、`db.backup()` 835MB 页拷贝 2.5s、835MB 快照整读、**JSZip DEFLATE（pako 纯主线程 JS）0.3~1.4s 空洞若干**、整包写盘 0.65~0.9s；② 每次启动 +8s 的 `desktopCapturer.getSources` 预热（实测 2.3~2.8s 单次阻塞）；③ +20s 的 `learnerRefresh` 全管线（实测 0.7~1.4s，含 0.5~0.9s 连续阻塞）**。渲染层无罪（longtask 仅 1 条 = 被主进程拖住的 2.4s；IPC p50=1ms）。用户「点击要过一段时间才有反应」的机理与 D116 同源：主进程 UI 线程阻塞期间输入事件派发停摆——点击落在 ② 窗口内实测**反应延迟 2.64~2.71s**；落在首启备份窗口内实测**1.06s 反应 / 15s 无反应（超时）**。

**「每次启动都卡前几十秒」只在「当天第一次启动且自动备份未完成」时逐字成立**（§5 差异说明）。

---

## 1. 测量方法与口径

### 1.1 数据环境（真实数据副本，绝不碰真实库）

- 隔离 userData：`tests/tmp-lag/realdata-userdata/`（**真实 `%APPDATA%/incremental-reading-dev` 的副本**，由 `tmp-lag-run.cjs` 首次运行时拷贝：`library.db`(17.5MB)/`learner.db`(5.8MB)/`dictionary.db`(835MB)/`settings.json`/`ai-config.json`/`memory/`/`assets/`(421MB)/`dicts/`(221MB)，合计 ~1.5GB；真实目录全程只读）。
- 真实数据规模（对副本只读统计，`node node_modules/electron/cli.js tests/tmp-lag-count.cjs`，ELECTRON_RUN_AS_NODE 通道）：主库 `library_items 405 / documents 405 / cards 538 / review_logs 548 / extracts 54 / reading_events 2011 / knowledge_points 3 / extract_ops 552`；learner.db `content_units 1877 / lexemes 14252 / lexeme_states 14252`。
- 空库环境：`tests/tmp-lag/empty-userdata/`（每轮清空重建）。

### 1.2 探针（全部为进程外/注入式，零产品代码改动）

| 探针 | 位置 | 作用 |
| --- | --- | --- |
| 主进程注入 | `NODE_OPTIONS=--require tests/tmp-lag-instrument.cjs`（先例：上轮 `tests/tmp-app-instrument.cjs`） | ① 50ms 心跳，>100ms 记 `hole`（比产品 `[DIAG-MAIN]` 的 300ms 门限更细）；② 包装 `better-sqlite3` `exec/pragma/run/get/all`（≥20ms 记 SQL）；③ 包装 `fs.*Sync`（≥50ms）；④ 包装 `desktopCapturer.getSources`、`dictDb.open`、`learnerDb.open/save`、`initDb`、`autoBackupIfNeeded/createBackup/backfillSidecars`、`memoryTidy.startupBackfillIfDue`、`learnerRefresh.refresh`（+5ms 相位轮询）、`JSZip.prototype.generateAsync`；每行带 epoch ms 便于与 CDP 侧对齐。 |
| 页内探针 | CDP `Page.addScriptToEvaluateOnNewDocument`（抗导航换上下文；首轮曾因 evaluate 落在导航前旧上下文而丢探针，已修） | ① `settings.get` IPC 往返（200ms 间隔；纯内存读，不制造负载）；② rAF 空档；③ `PerformanceObserver(longtask)`；④ 导航 active 文本变化记录器（8ms 轮询，被阻塞时不运行、恢复后时间戳仍为真实时刻）。 |
| 真实点击 | CDP `Input.dispatchMouseEvent` 打在顶栏 `.topbar-nav .nav-item` 真实按钮上；**点击时刻 = send 时刻（不 await 回执）**，反应时刻 = 页内记录到 active 变化 | 端到端「点击 → 界面反应」；输入事件同样经主进程派发，主进程阻塞时同样被拖住（D116 机理） |
| 主进程 CPU 采样 | `--inspect=<port>` + CDP `Profiler.setSamplingInterval(200µs)`，全程采样 | 空洞窗口的函数级归因（self/inclusive + 父链） |

### 1.3 探针自证（不是「没打点＝没问题」）

- 正对照 1：产品自带 `[DIAG-MAIN]`（300ms 门限，独立于我的探针）与我的 100ms 探针在**同一时刻**报出同一空洞（例：首启运行 `hole …8493020 -> …514754 (21734ms)` ⇔ `[DIAG-MAIN] 主进程事件循环空洞 1791784493020 -> 1791784514754 (21734ms)`）。
- 正对照 2：同样的空洞在**三种独立观测口径**下同时出现——主进程探针（hole）、页内 IPC 往返（`settings.get` 2219ms / rAF 空档 2698ms）、CDP 宿主侧回执延迟（首启 run#1 里宿主 evaluate 被卡 ~22s 才能发出第一次点击）。
- 正对照 3（合成负载）：注入件包装的 `desktopCapturer.getSources` 打印 `enter/exit …dur=2631ms`，与同期 hole 2584ms、CPU 画像 `getSources @ browser_init 2415ms` 三方互证。
- 空转自检：心跳另打 `alive @<epoch>`（每 5s），全程可见（探针存活）；`sql.get 21642ms :: PRAGMA quick_check` 等计数器与画像互证。
- 已知干扰与排除：① 上一版页内探针交替 ping `library:list`（每次 ~70ms、每 500ms 一次）**自己把主进程打出周期性 100ms+ 空洞**——已改为纯内存 `settings.get`（见 §6 未取证假设 U4）；② 后台窗口下 Windows/Chromium 可能对定时器做合并——前台复测（`Page.bringToFront`）后 +56s/+61s 处两个 2.18s/0.53s 空洞不再出现，判为环境伪影（§6 U3）；③ 所有关键归因都有**JS 调用内计时**（instrument 的 `dur=`）作双保险，不受计时器合并影响。

### 1.4 复现命令（逐字；总控可机械照跑）

```bash
cd "C:/Users/xiongdy/Documents/OpenCode/Incremental reading Dev"

# 前置自检（脚本内亦会自动检查）
ls dist/index.html                                  # 必须存在（本轮 773B / mtime 2026-10-12T05:36:11.927Z）
tasklist //FI "IMAGENAME eq electron.exe"           # 必须无实例（单实例锁）
# 若 dist 缺失：npm run build

# 场景 A：同日第二次启动（复现用户 13:14 会话；在隔离副本里占位今日 backup-auto-<today>.zip）
node tests/tmp-lag-run.cjs same-day 100

# 场景 B：当天首次启动（删除占位 → autoBackupIfNeeded 真实执行：835MB 词典快照 + JSZip 打包）
node tests/tmp-lag-run.cjs first-of-day 300

# 场景 C：空库基线
node tests/tmp-lag-run.cjs empty 60

# 汇总（时间线 + 页内数据 + 画像窗口归因；first-of-day 的大窗口单独看）
node tests/tmp-lag-analyze.cjs same-day
node tests/tmp-lag-analyze.cjs first-of-day
node tests/tmp-lag-profile-detail.cjs first-of-day 700 22400     # 21.7s 阻塞窗口归因
node tests/tmp-lag-profile-detail.cjs same-day 21240 22060       # 0.8s 刷新阻塞窗口归因
```

期望输出形态：`[host] spawn pid=… epoch=…`；`[LAG] hole <开始epoch> -> <结束epoch> (<ms>ms)`；`[LAG] enter/exit desktopCapturer.getSources dur=<ms>`；`[DIAG-MAIN] 主进程事件循环空洞 …`；末尾 `[host] 页内数据 → tests/tmp-lag/<场景>.page.json`、`[host] 主进程 CPU 画像 → tests/tmp-lag/<场景>.cpuprofile`，并自检打印 `[host] 收尾后 electron 实例: 无`。脚本自带：`dist` 存在性、无并发 electron、只杀自己 spawn 的进程树（`taskkill /PID <pid> /T /F`）。

---

## 2. 实测时间线

> 全部数值来自 `tests/tmp-lag/*.app.log`（主进程 stdout 原样落盘）与 `*.page.json`（页内）。相对时刻以 `[LAG] proc.start epoch` 为 T0。

### 2.1 场景 A：同日第二次启动（same-day，前台运行，2026-10-12 13:47:39 起）

主进程空洞（>100ms 全量，合计 **3900ms**）：

```
+2ms      209ms
+211ms    211ms
+8240ms   2584ms   ← desktopCapturer.getSources 预热（enter @+8260 / dur=2631ms）
+20223ms  171ms    ← learnerRefresh（+20.19s 进入 / dur=977ms）
+20452ms  208ms
+20716ms  517ms
（之后至 +100s 无 >100ms 空洞）
```

主进程关键事件（原始行节选）：

```
[LAG] enter initDb epoch=1791785259475
[LAG] sql.get 21ms [library.db] :: PRAGMA quick_check
[LAG] exit  initDb dur=41ms
[LAG] exit  autoBackupIfNeeded dur=1ms r={"ok":true,"skipped":"already-today"}
[LAG] exit  backfillSidecars dur=2ms r={"ok":true,...}
[LAG] enter desktopCapturer.getSources thumbnail={"width":1,"height":1} epoch=1791785267383
[LAG] exit  desktopCapturer.getSources dur=2631ms sources=1 epoch=1791785270014
[LAG] enter learnerRefresh.refresh epoch=1791785279382
[LAG] exit  learnerRefresh.refresh dur=977ms result={"ok":true,"ms":977}
[DIAG-IPC] stats:overview 慢 152ms @1791785279603      ← 点击「数据」触发，非启动负载
```

端到端（页面侧）：

| 时刻 | 指标 | 值 |
| --- | --- | --- |
| 全程 | `settings.get` IPC 往返 | n=464，p50 **1ms**，p90 1ms，p99 11ms，max **347ms**（+20.97s，刷新窗口） |
| +8.44s | 渲染层 longtask | **1 条，2412ms**（被主进程 dC 阻塞拖住的那一段） |
| +10.92s | rAF 空档 | **2698ms**（同窗口） |
| +3.51s | 点击「卡片」→ active 切换 | **558ms** |
| +8.21s | 点击「复习」→ active 切换 | **2711ms** ← 落在 dC 阻塞窗口前缘 |
| +20.31s | 点击「数据」→ active 切换 | 227ms（+ `stats:overview` 152ms） |
| +45.01s | 点击「日记」 | 264ms |
| +75.02s | 点击「书架」 | 350ms |

> 口径说明：**200ms 间隔的 IPC ping 可能漏掉 2.6s 级阻塞**——阻塞期间该 ping 的 `setTimeout` 根本不触发，计时被「计时器延后」吸收（本前台轮 max 只有 347ms 即此因；后台轮恰有一次 in-flight ping，实测到 2219ms）。该窗口的端到端证据由**点击延迟 2711ms + rAF 空档 2698ms + 渲染层 longtask 2412ms** 三条独立口径给出。

同一场景的另两轮复跑（后台窗口）：空洞合计 6.9s（含 §6 U3 的两个环境伪影 2183ms/528ms），dC 空洞 2289ms、刷新空洞 810ms、IPC max 2219ms（+8.37s，正值 dC 窗口）；点击 76/17/14/22/260ms（**说明点击只要不落在上述三个窗口内就正常**）。

### 2.2 场景 B：当天首次启动（first-of-day，真实 auto-backup；共 3 轮）

**B-1（2026-10-12 13:54:52 起；一次性最强阻塞，未复现）：主进程空洞 >100ms 合计 30,914ms / 13 段**

```
+312ms     417ms
+786ms   21734ms   ← dictDb.open() → PRAGMA quick_check（835MB dictionary.db，sql.get 21642ms）
+22520ms  2646ms   ← db.backup() 页拷贝 835MB（CPU 画像 step@backup.js:41 2497ms）+（被延后的）dC 预热
+25166ms  1006ms
+26459ms   846ms
+29925ms  1420ms
+42475ms   332ms   ← 以下进入 JSZip DEFLATE 区
+82717ms   369ms
+90190ms  1348ms   ← fs.writeFileSync 906ms（写 ~900MB zip）
+99538ms   341ms
```
关键事件：`enter autoBackupIfNeeded @+710ms` → `exit dur=90827ms`（**90.8 秒**）；`sql.get 21642ms [dictionary.db] :: PRAGMA quick_check`；JSZip 进度 `library.db → dictionary.db(3.4%…12.1%) → dicts/* → assets/* 86.2%`；`fs.writeFileSync 906ms`。
页面侧（主进程阻塞把宿主发指令也卡住）：`+26177ms 点击「卡片」页内=1061ms`；`+27433ms 点击「复习」**15s 内无任何反应（超时）**`；第一次点击前的坐标查询（CDP evaluate）被卡 **~22s**。原始行节选见 `tests/tmp-lag/first-of-day-B1.excerpt.log`（原 `first-of-day.app.log` 已被后续轮次覆盖）。

**B-2（13:58 起，全热，同一副本）：空洞合计 8,198ms / 16 段；`quick_check 1223ms`；`autoBackupIfNeeded 40281ms`；`fs.writeFileSync 648ms`；`desktopCapturer dur=2559ms`（@+8.36s）**

```
+80ms 214ms | +294ms 229ms | +573ms 1319ms | +3540ms 766ms | +8311ms 2526ms | +20728ms 563ms | +26490ms 259ms | +39938ms 851ms | …
[host] +3510ms 点击「卡片」页内=129ms
[host] +8213ms 点击「复习」页内=2640ms     ← 点中 dC 窗口，2.64s 才有反应
[host] +20310ms「数据」233ms；+45006ms「日记」244ms；+75001ms「书架」238ms
```
（原始日志留档：`tests/tmp-lag/first-of-day-warm.app.log` / `first-of-day-warm.page.json` / `first-of-day2.host.log`。）

**B-3（14:12 起，先把副本 dictionary.db 整盘重写一遍再跑，检验「冷读/脏页」假设）：`quick_check 1239ms`，未复现 B-1 的 21.6s。**
（原始日志留档：`tests/tmp-lag/first-of-day-run3.app.log` / `-run3.host.log` / `-run3.cpuprofile`。）

**结论（B）**：**首启 auto-backup 全程 40.3s~90.8s 是「首次启动前几十秒卡」的主体**，其中稳定复现的成分 = `db.backup()` 页拷贝 2.5s + 835MB 快照整读 + **JSZip DEFLATE（主线程 JS，0.3~1.4s 空洞若干）** + `fs.writeFileSync` 0.65~0.9s + `quick_check` 1.2s（热）；B-1 的 `quick_check 21.6s` 是一次性极值（NVMe 磁盘排除冷读，怀疑 OS/杀软首次访问，未取证 → §6 U5）。

### 2.3 场景 C：空库基线（empty）

空洞 184ms(+62)、598ms(+285)、2415ms(+8341，dC)、432ms(+10782)；`initDb 429ms`（其中 `CREATE TABLE` 86ms、`legacyBackfill` 判定 104ms）；`autoBackupIfNeeded 121ms`（空库也真的建了一份 5.9KB zip）；`desktopCapturer.getSources 2770ms`；`learnerRefresh 71ms`（无数据）。→ **dC 预热 2.4~2.8s 与数据规模无关（固定环境成本）**；其余与数据量正相关。

### 2.4 用户会话原始日志对账（2026-10-12 13:14:39）

| 用户日志行 | 我的复现（同口径） | 判定 |
| --- | --- | --- |
| `空洞 1791782079090 -> …447 (357ms)`（启动 burst） | A 场景 +2ms/209ms + +211ms/211ms（后台轮 223+393ms） | 同源（init 段，见 R4） |
| `backfillSidecars 定时器触发 @…440 / 结束 @…445`（5ms） | `enter/exit backfillSidecars dur=2ms`（占位目录仅 1 份 zip；真实目录 17 份 + sidecar 命中时同为毫秒级） | 一致，**排除**（非瓶颈） |
| `空洞 …087039 -> …089289 (2250ms)` + `…089289 -> …089598 (309ms)` | `desktopCapturer.getSources dur=2631/2559/2289ms`（enter 在 +8.26s，与用户 +7.9s 对齐） | **同源 = R2** |
| `learnerRefresh 定时器触发 @…099140 / 结束 @…099847`（707ms）内含 `空洞 (479ms)` | `refresh dur=977ms`（空洞 171+208+517ms）/ `dur=1401ms`（空洞 810ms）/ `dur=1116ms`（空洞 765ms） | **同源 = R3** |
| （用户日志中 autoBackup 无痕 = 被跳过） | A 场景 `autoBackupIfNeeded dur=1ms skipped:"already-today"` | 用户那次是「同日第二次启动」；**首次启动形态不在用户日志里 = R1 靠本次 B 场景补测** |

---

## 3. 根因（按阻塞量级排序；每条 = 代码位置 + 实测证据）

### R1（最大，量级：首启全程 40.3s~90.8s；单段 1.2s~21.6s）——首次启动 `autoBackupIfNeeded` 全链在主线程上同步前台执行

**调用点** `electron/main.js:2089` `await backup.autoBackupIfNeeded(backupOpts())`（在 `app.whenReady()` 链上、`createWindow()` 之后**同步等待**）→ `electron/backup.js:501 autoBackupIfNeeded` → `:176 createBackup`。三段成本各附证据：

**R1a（结构性，三连复现）——`dictDb.snapshotTo` → `dictDb.open()` 的 `PRAGMA quick_check`（835MB 库）**
`main.js:938 backupOpts().snapshotDict` → `electron/dictDb.js:142 snapshotTo` → `:15 open()` → `:25-31 db.pragma("quick_check")`。
证据：`[LAG] sql.get 1239ms / 1223ms / 1216ms [dictionary.db] :: PRAGMA quick_check`（三轮，热态）；同期 hole 1293/1319ms。
**一次性的 21.6s（B-1，未复现）**：`sql.get 21642ms`，hole 21,734ms；CPU 画像 inclusive 链 `snapOf@backup.js:207 21519ms → createBackup@backup.js:176 → snapshotTo@dictDb.js:142 → open@dictDb.js:15 → pragma@better-sqlite3 → get(native) 21512ms`。
**为什么 21.6s 不是磁盘瓶颈**：本机磁盘为 **Samsung PM9A1 NVMe SSD（1TB，顺序读 GB/s 级）**，835MB 顺序读应 <1s；且我特意把 dictionary.db 重新整盘写一遍再跑（B-3）也只得到 1239ms —— 「脏页/冷读」不成立。怀疑 OS 层首次访问（杀软实时扫描等），**未取证，见 §6 U5**。

**R1b（结构性，三连复现）——`db.backup()` 页拷贝 + 835MB 快照整读 + **JSZip DEFLATE（pako，纯主线程 JS）** + 整包写盘**
`backup.js:229/239`（`snapOf` 读快照入 zip）→ `:272 generateAsync(DEFLATE)` → `:274-276 fs.writeFileSync(tmp)` + `renameSync`。
证据（B-1/B-2 双轮一致）：`db.backup()` 835MB 页拷贝 2.5s（画像 `step@backup.js:41 2497ms` + `transfer 2483ms`）；`fs.readFileSync` 835MB 快照多条 120~350ms；**JSZip 进度 3.4%→86.2% 之间的 300~1420ms 空洞**（画像窗口 +82..91s：`Crc32Probe.processChunk@jszip 3413ms`、`deflate_slow@pako 432ms`、`longest_match@pako 423ms`、`crc32wrapper 255ms`）；`fs.writeFileSync 906ms / 648ms`（写 ~900MB）；`autoBackupIfNeeded 全程 90,827ms / 40,281ms`。
**用户感知**：B-1 中宿主 CDP 指令被卡 ~22s、第一次点击 1061ms、第二次点击 **15s 无反应**；B-2 中点击 ~240ms（降级但可用）。

**R1c（同源第二入口，未在本轮复现）**：**会话内首次词典查询** `dict:lookup → dictDb.lookup → open()`（`dictDb.js:100-104`）同样触发 R1a 的 `quick_check`——「启动时没查词 → 首次查词瞬间再卡 1.2~21.6s」。

### R2（中等，每次启动，2.3~2.8s 单次）——`desktopCapturer.getSources` 预热阻塞主进程

**调用点** `electron/screenCapture.js:130-135 warmup()`（`main.js:1979` 在 whenReady 第一行调用）→ `setTimeout(…, 8000)` → `:133 desktopCapturer.getSources({types:["screen"], fetchWindowIcons:false, thumbnailSize:1×1})`。注释自述「首次调用有一次性的初始化成本（数百毫秒～数秒）……启动后空闲时抓一张 1×1 缩略图把它摊掉」——但该「摊掉」本身是**同步阻塞主进程**的。

证据（四轮复现，固定成本与数据无关）：
| 轮次 | enter 时刻 | dur | 同期 hole |
| --- | --- | --- | --- |
| empty | +8.34s | 2770ms | 2415+432ms |
| same-day(后台) | +8.35s | 2740ms | 2376+386ms |
| same-day(前台) | +8.26s | **2631ms** | 2584ms |
| first-of-day B-2 | +8.36s | 2559ms | 2526ms |
| 用户日志 | ≈+7.9s | — | 2250+309ms |

CPU 画像（A 场景 +8..10.5s 窗口）：`(anon)@node:electron/js2c/browser_init:2 2074ms`（= Chromium 原生实现，在 JS 调用帧内）；B-1 场景画像栈直接给出 `(anon)@electron/screenCapture.js:132 2416ms → getSources@browser_init 2415ms`。
**用户感知**：点击落在该窗口内 → 反应延迟 **2711ms**（A，前台）/ **2640ms**（B-2）；IPC 往返 2219ms；rAF 空档 2698ms。

### R3（中等，每次启动，0.5~0.9s 连续阻塞）——`learnerRefresh`（+20s）单段不间断 SQL 写链

**调用点** `electron/main.js:1984-1987`（whenReady 内 `setTimeout(…, 20000)`）→ `electron/learnerRefresh.js:89 refresh()` 六步管线（§9.1 D124）。

证据：
1. `refresh dur= 707(用户)/977/1116/1401ms`；内部空洞 479(用户)/517+208+171/765/810ms——**一段连续阻塞**（轮询相位打点在阻塞期间被饿死，故不能用相位判断；改用画像）。
2. CPU 画像（A 场景 +21240..22060ms 窗口，即 810ms 空洞）：inclusive `learnerDb.run@learnerDb.js:175 582ms`（其中原生 `run` self 432ms、`Statement` 119ms、`prepare` 138ms）+ self `run@:0 432ms`；配合源码 `learnerRefresh.js:1154-1160`（`DELETE FROM lexeme_states` + 逐行 `await learnerDb.run("INSERT INTO lexeme_states …")`）与实测行数 **lexeme_states = 14252 行**：≈每次刷新把整表重写一遍，14,252 次逐行 INSERT 以 await 微任务链连续执行（`learnerDb.run` 同步执行 SQL，await 不产生宏任务让出点）→ 单段 ~0.6s。
3. 另一轮 20-22s 窗口 inclusive：`stepLinks@learnerRefresh.js:481 358ms`（内含 `unitPlainOf:204/plainOf:500/markdownToPlain@lmText.js:14` = markdown→纯文本兜底定位、`normalizeKpLabel@kpNorm.js:11 121ms`、`loadFacts@144→learnerFacts@db.js:7621 104ms`）；两轮合计说明该阻塞由 `stepLinks`（逐卡定位单元）与 `stepLex`（词项状态整表重写）等**无让出点的同步批次**构成，具体占比随数据/次序波动。
4. 用户感知：落在窗口内的点击 227~233ms（A/B-2）；IPC max 347ms；rAF 空档 217ms。

### R4（小，每次启动，~0.2~0.8s 合计）——启动同步 burst（initDb/建表/回填判定/窗口与托盘/插件等）

**调用点** `main.js:1978-2125` whenReady 顺序段：`screenCapture.warmup` → `createWindow()` → `protocol.handle ×2` → `applyPendingRestore` → `await initDb()`（`db.js:329`：`applyStandardPragmas` + `quick_check`（17.5MB 库实测 21~163ms）+ `db.exec(SCHEMA)`（CREATE TABLE 36 张，实测 86ms）+ ALTER 迁移 + `legacyBackfill` 判定（`r={"ran":false,"reason":"marked"}` 4ms））→ `quickCapture.init` → `workbenchWindow/tray.init` → `pluginHost.init` → `autoBackupIfNeeded` → `setTimeout(backfillSidecars,5000)` → `memoryTidy.startupBackfillIfDue`（2ms，`r=false`）→ `reconcileStaleMaterialMapRuns`。

证据：四轮空洞 +62..+573ms（223/393、209+211、417、214+229+1319ms）+ `initDb dur=429/41/182ms` + 用户日志 357ms。量级小，但**它是「窗口已出现、点击尚无反应」的第一段**（`createWindow()` 在前、`await initDb()` 在后，此段内渲染层任何 IPC 都要排队）。

### 排除项（有证据、非本问题）

| 候选 | 证据 | 判定 |
| --- | --- | --- |
| `backfillSidecars` 定时器 | 占位目录 2ms / 真实规模（用户日志）5ms | 排除 |
| `wal_checkpoint(TRUNCATE)` / persist() | 启动路径未见 >20ms 的 persistDb；`learnerDb.save` 无 ≥20ms 记录 | 排除（本问题内） |
| `synchronous=FULL`（主库/词典库） | 启动期主库写入极少；实测空洞均归因上述三项 | 排除（本问题内） |
| `legacyBackfill`（D134 单事务） | `r={"ran":false,"reason":"marked"}`（标记已存在，4ms）；空库 104ms（planned:0） | 排除（已回填过；未回填的历史库另议） |
| 渲染层 JS / 启动 IPC 风暴 | 页内 longtask 仅 1 条（被 dC 拖住的 2412ms）；IPC(settings.get) p50=1ms；`[DIAG-IPC]` 仅用户动作触发（`stats:overview` 117~318ms、`library:list` 78~96ms） | 渲染层无罪（除 R1-R3 的下游效应） |

---

## 4. 任务拆解表（供总控逐项派发；**本轮不实施**）

> 约束提醒：R1-R4 全部落在核心域（Electron 主进程 / DB / 备份链），实施必须由 `core-engineer`（实施模式）执行，且**先改文档（§8.1 记新决策号 + bump 版本）再动码**（§7.1.5）。每项修复的验收都以本报告 §1.4 的脚本为准。

| # | 任务 | 建议执行者 | 涉及文件 | 可机械检查的验收标准 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| T1 | R1-a：`dictDb.open()` 的 `quick_check` 不再阻塞启动路径（方案面：延后/降频/移除三选一，含「首次查词」路径一并裁决）+ `createBackup` 的快照读取→DEFLATE→写盘移出主线程（worker/分片让出），并给 `autoBackupIfNeeded` 定「不阻塞启动前 N 秒」的调度（改 `main.js:2089` 的 await 位置或改调度） | core-engineer（实施模式） | `electron/dictDb.js`、`electron/backup.js`、`electron/main.js`、`AI_DEVELOPMENT_GUIDE.md`（§7.2/§8.1 登记）、`docs/design/SQLITE3-MIGRATION-D137.md`（增补） | 修复后 `node tests/tmp-lag-run.cjs first-of-day 300`：① 全窗口无单段 >300ms 主进程空洞（`[LAG] hole` 与 `[DIAG-MAIN]` 均无）；② `[LAG] enter/exit autoBackupIfNeeded` 不早于窗口可交互（或全程不出现于前 30s）；③ 备份产物 `backups/backup-auto-<today>.zip` 生成成功且大小与修复前 ±10% 同量级；④ `tests/backup.test.cjs`、`tests/flows/f05-data-lifecycle.cjs`、`f80-backup-roundtrip`、`f81-restore-fault-injection` 全绿 | 波次 1（先） |
| T2 | R2：`screenCapture.warmup()` 的 8s 预热改为不阻塞（方案面：删除预热 / 延后到用户空闲或首次截图前 / 仅记录首次真实调用成本） | core-engineer（实施模式） | `electron/screenCapture.js`、`AI_DEVELOPMENT_GUIDE.md`（若涉决策登记） | 修复后 `node tests/tmp-lag-run.cjs same-day 100`：① +8s 窗口无 >300ms 空洞；② 点击「复习」在 +8.2s 的端到端延迟 <300ms（修复前 2711ms）；③ 首次真实截图功能手测可用（`screen-capture:shot` 返回非空） | 波次 1（可与 T1 并行，不同文件） |
| T3 | R3：`learnerRefresh` 写链让出——`lexeme_states` 整表重写（`learnerRefresh.js:1154-1160`，14,252 行逐行 INSERT，**全循环无让出点**）改「单事务 + 分批 setImmediate 让出」（词项索引循环已有 `:937` 每 200 单元让出的先例可对齐）；`stepLinks`（`:481`）的逐卡单元定位同理考虑缓存/让出 | core-engineer（实施模式） | `electron/learnerRefresh.js`、`electron/learnerDb.js`（如需批量口） | 修复后 `node tests/tmp-lag-run.cjs same-day 100`：① +20s 窗口无单段 >300ms 空洞；② 点击「数据」在 +20.3s 的延迟 <300ms；③ `tests/lm-db.test.cjs` 全绿（learner.db 语义不变，含幂等/整表一致性断言） | 波次 1 |
| T4 | R4：启动 burst 收尾（可选、低优先）——把 `await initDb()` 之后的非关键初始化（quickCapture/workbench/tray/pluginHost/reconcile）移出启动前 1s 关键段或延后到窗口可交互后 | core-engineer（实施模式） | `electron/main.js` | `node tests/tmp-lag-run.cjs empty 60`：启动前 1s 内无 >300ms 空洞；托盘/快捷键/插件可用性各一条手测 | 波次 2 |
| T5 | 修复后回归验证（机械照跑 §1.4 三场景 + 对照用户原话「点击要过一段时间才有反应」） | core-engineer（验证）→ `code-reviewer` | `tests/tmp-lag/*`（脚本保留至验收结束） | ① same-day：无 >300ms 空洞、5 次点击延迟全 <300ms、IPC p99 <50ms；② first-of-day：同标准；③ 与修复前数据并列成表（本报告 §2 为基线） | T1、T2、T3 |
| T6 | `[DIAG-TEMP]` 探针处置（见 §7）：T5 通过后，一次性删除 `electron/main.js:5-28` 两个探针 + 删除 `tests/tmp-lag-*.cjs` 测量件；如决定长期保留心跳则改为文档登记的小节 | bug-fixer（纯机械删除） | `electron/main.js`、`tests/tmp-lag-*.cjs` | `grep -c "DIAG-TEMP\|DIAG-MAIN\|DIAG-IPC" electron/main.js` 为 0（若删除）；`npm run build` 成功；`npx electron tests/flows/f05-data-lifecycle.cjs` 冒烟通过 | T5 |

---

## 5. 「用户感知几十秒」 vs 实测 差异说明（必读）

| 形态 | 用户可感知冻结时长（实测） | 出现条件 |
| --- | --- | --- |
| 当天首次启动（自动备份真实执行） | 备份全程 **40.3s（全热）~90.8s（含一次性极值）** 内主进程间断被占：空洞合计 8.2s~30.9s；单段最大 2.5s（热）~21.7s（一次性极值）；点击实测 **2.64s 有反应 / 15s 无反应**；备份尾部（DEFLATE 区间）点击 ~240ms（降级但可用） | 当天首次启动且 `backups/backup-auto-<today>.zip` 不存在 |
| 同日再次启动（用户贴的日志形态） | 三段离散冻结：+0.2~0.6s（~0.4s）、+8.3s（**2.4~2.8s**）、+20.2s（0.5~0.9s）；其余时间点击 14~350ms 正常 | 今日备份已存在（跳过备份） |

**如实说明**：用户原话是「**每次**启动软件后，前几十秒都会感觉有些卡」。我的复测表明——
1. 「**几十秒**」量级只在**当天首次启动**形态下成立（备份全程 40.3s~90.8s；单段极值 21.7s 为一次性，稳定成分是 JSZip DEFLATE 区间的 0.3~1.4s 连续空洞 + db.backup 2.5s）；
2. 同日再次启动只有 ~3.3s 的离散冻结（其中 2.6s 那一段正好落在启动后 8 秒附近，是「点击了没反应」的高命中窗口）；
3. 用户提供的日志本身是**同日再次启动**（`autoBackupIfNeeded` 被跳过），其中并不包含备份形态——所以**「每次」的感知最可能来自**：(a) 用户日常一天只启动一次（开发者常见），每次都命中「首次启动」形态；或 (b) **备份从未跑完就被关掉**——备份产物在 `.part` 阶段、结束时才 rename（`backup.js:274-276`），中断即不产生 `backup-auto-<date>.zip`，于是**下一次启动又从头来 40~90s**，形成「每次启动都卡几十秒」的循环。此二假设**均未取证**（见 §6 U1/U2），下一步取证办法：
   - 让用户看一眼 `%APPDATA%/incremental-reading-dev/backups/`：当天 `backup-auto-YYYY-MM-DD.zip` 是否存在、大小是否 ~897MB（存在且正常 ⇒ 首启形态只发生一次/天；缺失或只有 `.part`/`.snapshot-*` 残留 ⇒ 假设 (b) 成立）；
   - 或让用户下一次启动前记录时间，启动后运行一条机械命令（`node tests/tmp-lag-run.cjs same-day 100` 的同款探针，或直接看应用日志 `<userData>/logs/main.log` 中 `app ready` 与后续行的时间差）；
   - 我方可先按 §4 T1 消除首启 90s 与 T2 消除 2.6s 窗口——这两项修完，两种形态的「点击无反应」都应在 <300ms 内。

---

## 6. 未取证假设 与 Not verified 清单

**未取证假设（无双证据，不得当结论用）**
- U1：用户「每次」= 每天只启动一次（首启形态）。
- U2：自动备份被中断 → 下次启动重跑 40~90s → 「每次」卡。机制成立（`rename` 收尾 + `.part` 中间态），但**无用户侧证据**。
- U3：后台运行时的 2.18s/0.53s（+56.2s/+61.4s）空洞——JS 画像为空（idle）、前台复测消失，疑似 Windows 定时器合并/Chromium 后台节流；未定位到具体机理，**未计入任何根因**。
- U4：把 `synchronous=FULL`（D137）作为本问题的嫌疑——**已排除**（启动期主库/词典库几乎无提交；空洞均已归因他处），但若未来在启动路径新增批量写入需重新评估。
- U5：B-1 的 `quick_check 21.6s` 归因于 OS 层首次访问（杀软扫描等）——仅排除磁盘（NVMe + 重写复测 1239ms），**未取得直接证据**。
- U6：B-2/B-3 之间 ~28s 的备份总时长差（40.3s vs 90.8s 之差扣除 quick_check 差）来自页缓存之外的何种因素——未拆解。

**Not verified 清单**
1. **B-1 的 `quick_check 21.6s`（一次性极值）成因**：本机磁盘为 **Samsung PM9A1 NVMe SSD（1TB）**，835MB 顺序读应 <1s，且「把 dictionary.db 整盘重写后再跑」（B-3）仍只有 1239ms，**排除冷读/脏页**；怀疑 OS 层首次访问（Windows Defender 实时扫描新建大文件等），未取证（U5）。三次复现值：1239ms / 1223ms / 1216ms（热态稳定）。
2. **用户真实会话形态**：只拿到用户 6 行 stdout 与「每次」描述，未拿到其 `backups/` 目录状态、`logs/main.log`、启动频次（U1/U2 因此未取证）。
3. 渲染层 FCP / 可交互时刻：页内探针在导航前注入，`first-contentful-paint` 未取到（`fcp:null`）；只有间接证据（+3.5s 的真实点击可用，且 `[DIAG-IPC]` 无启动期慢 handler）。
4. `library:list` 单次 52~96ms（405 行）的成因（每行 progress_json 处理？）——非本问题主因，未深挖。
5. macOS/Linux 形态：`desktopCapturer` 预热仅 win32（`screenCapture.js:131`），其他平台未测。
6. 修复收益预估（T1-T3 实施后的实际数值）——未实施，仅按归因推理。
7. B-1 与 B-2/B-3 的备份总时长差中扣除 quick_check 之外的部分（~28s，U6）未逐项拆解（DEFLATE 进度时间线未带 epoch，只按日志顺序对齐）。

---

## 7. `[DIAG-TEMP]` 探针处置意见（本轮不实施）

结论：**「先留、修完再删」**，理由与边界如下：

1. **留的原因**：这两个探针（`electron/main.js:5-11` 心跳 >300ms、`:13-28` `ipcMain.handle` 慢 ≥50ms）是本轮唯一能自证在工作的低成本回归哨兵——四轮复测里它们与我的独立探针**逐条互证**（同 epoch 同毫秒数）。T1-T3 修复的验收（§4 T5）必须用它们判「空洞归零」，提前删掉等于自断验收工具。
2. **不要在本轮改**：门限（300ms）与格式（`[DIAG-MAIN]`/`[DIAG-IPC]` 前缀 + epoch）已被本报告与用户日志引用；改动会让新旧数据不可比。
3. **删除时机与方式**：作为修复批次的**最后一步**（T6）——先跑完 T5 三场景验收并留档，再用一个纯机械提交删除 `electron/main.js:5-28` 全部 `[DIAG-TEMP]` 块（含 `__diagOrigHandle` 包装还原），同时删除 `tests/tmp-lag-*.cjs` 测量件与 `tests/tmp-lag/`（`.app.log/.page.json/.cpuprofile` 可留档到 `docs/` 引用或直接删）。删除后跑 `npm run build` + `f05/f37` 冒烟即可（§/D 编号与 `tests/flows` 闸门均不解析这两个探针文本，f11 不受影响）。
4. **若希望长期保留**（次优）：把心跳降噪（仅启动前 60s 生效 + 阈值 500ms）并搬进 `appLog`（D119 通道），随 GUIDE §7 登记为诊断项——但按「用后即删」的原注释精神，仍建议按 3 删除。

---

## 8. 附：关键原始输出索引（本机实测留档）

| 文件 | 内容 |
| --- | --- |
| `tests/tmp-lag/same-day-front.app.log` / `.page.json` / `.cpuprofile` | 场景 A 前台轮（主进程逐行 + 页内 + 画像） |
| `tests/tmp-lag/same-day2.host.log` | 场景 A 后台轮（含 self-ping 干扰那轮已被替换） |
| `tests/tmp-lag/first-of-day.app.log|.cpuprofile|.page.json` | 场景 B-2（热）；`first-of-day2.host.log` 为其宿主日志 |
| B-1（冷，21.6s quick_check）原始行保留于本报告 §2.2 与 `first-of-day.host.log`（同名文件已被 B-2 覆盖，关键行已摘录于 §2.2/§3 R1） | — |
| `tests/tmp-lag/empty.app.log` | 场景 C 基线 |
| `tests/tmp-lag-count.cjs`（ELECTRON_RUN_AS_NODE 通道） | 真实数据副本行数统计 |

（测量件与临时 userData 目录 `tests/tmp-lag/` 合计 ~1.5GB×2，验收后随 T6 一并清理；`realdata-userdata` 是副本，删除不影响真实数据。）
