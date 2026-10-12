# SQLITE3-MIGRATION-D137 — better-sqlite3 迁移设计与可行性结论

> 状态：**设计稿（已实机探测，未实施）** · 日期：2026-10-12 · 上游：GUIDE §9.4 技术债表「better-sqlite3 迁移」行、§8.2 已接受偏差表「数据库 sql.js 而非 better-sqlite3」行、§7.2 数据完整性、§7.1.8 并发纪律、D1（接口已对齐）。
> 本稿只做设计与可行性探测，**不实施迁移**。实施须按 §7.1.5 先把附录 B 的登记文本落入 GUIDE，再按 §4 任务拆解表分批动码。

---

## 1. 可行性探测（三条结论，均本机实测）

探测环境：临时目录 `%TEMP%\bs3-probe-d137`（不入仓库、不动仓库 node_modules/package.json）；npm registry 走 `https://registry.npmmirror.com`；预编译二进制镜像走 `https://registry.npmmirror.com/-/binary/better-sqlite3`（经 `npm_config_better_sqlite3_binary_host_mirror` 环境变量注入 prebuild-install）。本机基线：Node 24.15.0（ABI 137）、npm 11.13.0、electron 31.7.7（仓库 devDependency，ABI 125）、electron-builder 26.15.3。

### 结论① Node ABI 预编译：**可得（双通道验证）**

- **v13.0.3**（`npm install better-sqlite3` 默认拉到）：预编译 NAPI 二进制**直接内置在 npm tarball 内**（`prebuilds/win32-x64.node` 等 8 平台，prebuildify 模式），**零下载、零镜像依赖**。Node 24.15.0 实测：内存库建表/插入/查询/更新/事务/BLOB 全绿（`NODE_OK ... napi 10 node 24.15.0 abi 137`）。
- **v12.11.1 / v11.10.0**（prebuild-install 按运行时下载 per-ABI 预编译）：`npx prebuild-install --runtime node --target 24.15.0` 经镜像 **HTTP 200** 拉到 `node-v137-win32-x64`，Node 24.15.0 实测通过（`NODE24_V12_OK abi=137 ... lastId=2`，`lastInsertRowid` 可用）。注意 v11 系**没有** node-v137（最高 node-v131），v12.4.1 起才有。
- npmmirror 二进制镜像连通性实测：目录枚举、tar.gz 下载均 200（本机 curl 直连 registry 会 TLS 失败，但 **Node 网络栈可达**——npm 与 prebuild-install 都是 Node 栈，不经过 curl 的失败路径）。

### 结论② Electron ABI（31.7.7 / ABI 125）：**可得，但版本强相关（本探测最关键发现）**

| 版本 | 预编译形态 | electron 31.7.7 实测结果 |
| --- | --- | --- |
| **v12.11.1**（electron-v125 专用预编译） | per-ABI，经镜像 `prebuild-install --runtime electron --target 31.7.7` HTTP 200 拉取 | **全绿**：内存库 CRUD/事务/`db.transaction`、WAL 文件库 `journal_mode=wal`、`db.backup()` 快照回读、**直接打开 sql.js 导出的既有库文件**（TEXT+BLOB 列完整往返：`ELECTRON31_V12_OK rows=2 blob=2 abi=125 electron=31.7.7`；v11.10.0 同法全绿，另验了 `readonly` 打开） |
| **v13.0.3**（NAPI 内置预编译） | tarball 内置，零下载 | **不可用**：模块能 `require` 成功（probe1 `REQ_OK`），但**首个 Database 操作即硬崩**（进程消失、仅留 `crashpad_client_win.cc not connected`、exit 127；bare 脚本三连通过、Node 24 与 electron 44.7.0 下同一脚本全绿，已排除脚本与环境因素） |

- 结论：**v13 的 NAPI 构建与 electron 31 不兼容**（疑似其 N-API 用法/依赖基线高于 electron 31 的 Node 20.18）。在 electron 31 上必须钉 **v12.x（推荐 12.11.1）或 v11.10.0**，用 per-ABI 预编译 + 镜像下载；v13（零 ABI 管理）是**升级 electron 之后**的战略选项（electron 44 实测全绿）。
- 双运行时补充：`ELECTRON_RUN_AS_NODE=1` 下 electron 31.7.7（其内嵌 Node 20.18 / ABI 125）加载 electron-ABI 二进制成功（`RUN_AS_NODE_V11_OK abi=125 node=20.18.0`）——这给「node 直跑测试套件」提供了不换二进制的运行通道（见 §3.9）。

### 结论③ 源码编译兜底：**可行（工具链在场，网络是唯一历史障碍）**

- VS 工具链在场：`vswhere` 实测 `C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools`（含 `Microsoft.VisualStudio.Component.VC.Tools.x86.x64`）；Python 3.14.4 在场。
- 此前 `npm install better-sqlite3@11`（无镜像 env）失败原因**不是缺工具链**，而是 prebuild-install 拉不到预编译后回落 node-gyp，node-gyp 下载 Node 头文件时 `Client network socket disconnected before secure TLS connection was established`（nodejs.org 不可达）。头文件可走镜像（`npm_config_disturl=https://npmmirror.com/mirrors/node/`）。即：预编译镜像失效时，编译兜底在本机成立。
- （探测中的环境杂音：electron 31.7.7 app 模式偶发 crashpad 连接失败后重试即好，bare 脚本 3/3 通过；与本迁移无关。）

### 裁决

**迁移在当前主机可交付**：三条探测全部成立，无 BLOCKED 项。硬条件三条——①版本钉 `better-sqlite3@^12.11.1`（勿用 v13，直至 electron 升级）；②安装/打包须带 npmmirror 二进制镜像 env（或完成一次 electron-ABI 预编译后按 §3.8 免网打包）；③双运行时测试按 §3.9 通道执行。

---

## 2. 现状盘点（代码实测，迁移面）

| 项 | 现状 |
| --- | --- |
| 主库 | `electron/db.js`（7876 行）：模块级 `db` 单实例；`initSqlJs` 异步初始化；`db.run(SCHEMA)` + 逐条 `ALTER TABLE ... ADD COLUMN` try/catch 幂等迁移；**36 张表**（§4.1） |
| 读写原语 | 全部经 4 个局部原语：`db.run(sql, params)`（写）、`queryAll(sql, params)`（`prepare→bind→step→getAsObject→free`，207 处调用）、`rowExists()`、`withTransaction(fn)`（`BEGIN/COMMIT/ROLLBACK` 经 `db.run`）；`db.exec` **零使用**、`queryOne` 不存在（一律 `queryAll(...)[0]`）；评分落库另有手写 `BEGIN→COMMIT→persist` 序列（db.js:2002–2072） |
| persist() | `db.export()` 全量导出 Buffer → 同目录 tmp → `fs.writeSync` + `fs.fsyncSync` → `renameSync` 原子替换（db.js:902–923）；`persistNow()` 供 `cards:persistNow` IPC 重试；tmp 残留启动清理 |
| 派生库 | `electron/dictDb.js`（130 行，dictionary.db）：`prepare/bind/step/reset/free`、手写 `BEGIN/COMMIT/ROLLBACK`、**`db.exec(sql, params)`（带参 exec，仅 countBySource 一处）**、`VACUUM`、`export()+save()`；`electron/learnerDb.js`（229 行，learner.db）：`prepare/bind/step/getAsObject/free`、`INSERT ... ON CONFLICT`、schema_version 全量重建规则、`export()+save()` |
| 退出 | `main.js` will-quit 仅 `dictDb.saveOnQuit()/learnerDb.saveOnQuit()`（主库逐写即时 persist，无退出兜底） |
| 备份（M2） | `electron/backup.js:204/214` **裸 `readFileSync` 读 library.db / dictionary.db 字节**入 zip |
| BLOB | 三库 schema 有 BLOB 列（cards.occlusion 等 JSON 主体为 TEXT；探测夹具含 BLOB 往返）；绑定值多为 TEXT/NUMBER/NULL；资产文件走文件系统不入库 |
| 词典外部文件读取 | `electron/dictStore.js` 用 sql.js **只读** ECDICT 等外部 sqlite 文件（M7 导入器）——**非应用数据库，建议保留 sql.js 不迁**（范围外，见 §7） |
| 测试 | 多个套件直接拿 sql.js 作独立读卡器复核落盘文件（如 card-links.test.cjs C2、m13、legacyBackfill、fsrstest）；sql.js 为 runtime dependency |

---

## 3. 迁移方案

### 3.1 sql.js → better-sqlite3 API 映射表

| sql.js（现） | better-sqlite3 v12（新） | 备注 |
| --- | --- | --- |
| `await initSqlJs(); new SQL.Database(bytes?)` | `new Database(file)`（同步构造；文件不存在即创建） | initDb/dictDb/learnerDb 的 open 去 async 化，但**对外保持 async 签名**（调用面零改动） |
| `db.run(sql, params)` | `db.run(sql, params)` 同签名 | 返回值从忽略变为 `{changes, lastInsertRowid}`；现库无 `last_insert_rowid` 消费者，行为兼容 |
| `stmt = db.prepare(sql); stmt.bind(p); while(stmt.step()) rows.push(stmt.getAsObject()); stmt.free()` | `rows = db.prepare(sql).all(params)` | `queryAll` 一处替换，207 处调用点零改动；`getAsObject` 键名/NULL 语义一致（BLOB 由 Uint8Array 变 **Buffer**，是 Uint8Array 子类，下游 `new Uint8Array(buf)` 包裹/透传兼容） |
| `db.exec(sql, params)`（带参，dictDb 一处） | `db.prepare(sql).get(params)` | **better-sqlite3 `.exec()` 不收参数**——带参 exec 一律改 prepare().get()/all() |
| `db.run("BEGIN"/"COMMIT"/"ROLLBACK")` | 保留手写（经 `db.exec`）或 `db.transaction(fn)` | 见 §3.3 |
| `Buffer.from(db.export())` | **删除** | 库即文件，无导出概念；persist() 重定义见 §3.4 |
| `fs.readFileSync(dbFile)` 喂构造器 | 直接 `new Database(dbFile)` | 崩溃恢复（journal/WAL 回放）由 SQLite 打开时自动完成 |
| `db.run("VACUUM")` | `db.exec("VACUUM")`（或 `db.pragma`） | dictDb.removeSource 同义替换 |
| 绑定 `undefined` | **必须显式 `null`** | sql.js 容忍 undefined，better-sqlite3 抛 `Invalid value`——在 `db.run`/`queryAll` 两个原语内做一层 `params.map(v => v === undefined ? null : v)` 归一（一处兜底，杜绝散点） |
| 绑定 `Uint8Array`/`Buffer` | `Buffer` | 现库绑定面以 TEXT/NULL 为主；如出现 Uint8Array 绑定，`Buffer.from(u8)` 包一层 |
| `stmt.reset()` 复用绑定循环（dictDb.insertRows） | `const stmt = db.prepare(...); stmt.run(params)` 循环复用 | 语句对象天然可复用，无 free/reset |

### 3.2 三库切换面（顺序 = 风险升序）

1. **learnerDb.js**（派生库、可整库重建、不进备份）：构造器替换、`allSync` 用 `.all()`、`save()` 重定义（§3.4）、schema_version 重建规则原样保留。
2. **dictDb.js**（独立库、仅导入/删除时写）：`insertRows` 大事务改 `db.transaction` + 语句复用（每 5000 行 `setImmediate` 让出主进程的节奏**保留**——better-sqlite3 同步执行，让出点语义不变）；`countBySource` 改 prepare().get()；`removeSource` 的 VACUUM 保留。
3. **db.js 主库**（36 表 + 全部业务写路径）：四个原语替换（`db.run`/`queryAll`/`rowExists`/`withTransaction`），评分落库手写 BEGIN 序列并入 `withTransaction` 语义；迁移段 `ALTER TABLE ... ADD COLUMN` try/catch **原样保留**（better-sqlite3 下同一写法）；`persist()/persistNow()` 重定义（§3.4）。
4. **main.js**：will-quit 增三库 `db.close()`（clean shutdown = WAL 自动 checkpoint + 删 sidecar）；启动序列不变（`await initDb()` 兼容）。
5. **dictStore.js 不动**（外部文件只读，继续 sql.js；m7 测试打包命令 `--external:sql.js` 因此不变）。

### 3.3 事务语义

- `withTransaction(fn)`：**保留手写 `BEGIN → COMMIT / ROLLBACK`**（better-sqlite3 完全允许，diff 最小、F38「撤销只删最大 seq ⇒ 序号稠密」等既有断言零改写）。两处加固：① `BEGIN` 改 `BEGIN IMMEDIATE`（单写者应用下杜绝 deferred→write 升级时的 SQLITE_BUSY 边角）；② COMMIT 失败时显式 ROLLBACK 并 rethrow（与现 catch 对称）。
- dictDb.insertRows：循环包进 `db.transaction`（10 万行级单事务一次提交）；显式 BEGIN/COMMIT 字符串退役。
- **同步性说明**：better-sqlite3 是同步 API——既有代码本就在主进程同步执行 SQL（sql.js 同为同步），事件循环让出点不变；唯一新增约束是**事务回调内不得 await**（现状检查：现有手写事务体内无 await，评分落库、batchCardOps、undo 均为纯同步段，成立）。

### 3.4 persist() 职责重定义（§7.2 语义变化核心）

- **现语义**：内存库 + 每写一次全量导出 + tmp/fsync/rename 原子替换；崩溃丢「上次 persist 之后」的写入；磁盘任意时刻持有上一份完整快照。
- **新语义**：SQLite 引擎原生落盘——事务提交即写 WAL，`synchronous=FULL` 下**每次提交 fsync**，持久性由引擎保证，**「每次落库即落盘」在新语义下由 SQLite 提交语义直接成立，不再依赖全量导出**。
- **persist() 新定义**：`PRAGMA wal_checkpoint(TRUNCATE)`——把 WAL 合并回主文件并截断，使「磁盘上 `library.db` 单文件 = 完整最新状态」这一既有外部假设继续成立（外部脚本、直接拷贝、旧工具链均安全）。调用点**全部保留不裁剪**（diff 最小、F33/F37 故障注入语义不变：checkpoint 失败同样 throw → IPC reject → UI 封锁评分 → persistNow 重试）。
- **persistNow()**：语义变为「重试 checkpoint」，导出名与 `cards:persistNow` IPC 不变。
- **write-ahead 语义登记**：persist 调用点之间的窗口内，磁盘上主文件落后于 WAL（数据在 WAL 里且已 fsync，**不丢**，但「单文件自足」暂时不成立）。因此外部读取磁盘库的三条纪律：① M2 备份走 `db.backup()`（§3.6）；② 外部脚本直接读/拷 `library.db` 前应用须已退出或刚 checkpoint（并入 §7.1.8 纪律句）；③ 恢复/手工换库时**必须同删 `-wal`/`-shm` sidecar**（陈旧 WAL 配错配文件 = 损坏）。

### 3.5 数据文件兼容性

- **同为 SQLite 文件格式，零数据迁移**：三库现有 `library.db / dictionary.db / learner.db` 由 better-sqlite3 直接打开（探测②已用 sql.js 导出文件实测，TEXT+BLOB 往返完整；sql.js 即 SQLite WASM，格式同源）。**无需转换脚本，无需停机迁移**——首次以 better-sqlite3 启动即完成切换。
- schema 版本：主库沿用「启动时 `ALTER TABLE ... ADD COLUMN` + try/catch」幂等迁移（不变）；learner.db 沿用 `lm_meta.schema_version` 不匹配即删库重建（不变）；新增启动后 `PRAGMA quick_check` 一次（结果仅入应用日志，不阻塞——损坏早暴露、零行为变更）。
- **回滚单向性**：以 WAL 打开后，旧版（sql.js）应用若直接打开会缺 WAL 侧数据。回滚路径 = 先 `PRAGMA wal_checkpoint(TRUNCATE)`（或退出应用，will-quit close 即 checkpoint）再回退旧版；设计上接受此单向性并在 GUIDE 登记。

### 3.6 备份 / 恢复（M2）影响

- **备份**：`backup.js` 对 library.db / dictionary.db 的裸 `readFileSync` **必须改**（WAL 下裸读可能缺最近提交且无事务一致性保证）→ 新增 `db.snapshotTo(destPath)`（`db.backup(dest)` 异步在线快照，不阻塞写路径；learner.db 同法）→ zip 打快照产物。settings/assets/memory/dicts 各文件段不变。
- **恢复**：staging 换入逻辑不变；**换入时同删目标三库的 `-wal`/`-shm`**；换入后首启走既有 `initDb()`。
- 自动备份、按天轮换、sidecar 缓存（D117）逻辑不动；`getBackupCounts` 等统计经 db 层读，不受影响。
- dictionary.db 950MB 级大库：`db.backup()` 为页拷贝非全量导出，速度与内存特性优于现 sql.js 全量 export 路径（现路径本就要 readFileSync 整文件，无回退风险）。

### 3.7 journal 模式选择：**WAL + synchronous=FULL**

- 备选对比：`DELETE`（回滚 journal）+ FULL 每事务 fsync、提交后无 sidecar、裸读安全——但写放大（journal+主文件双写）且词典 340 万行导入场景吞吐差；`WAL + NORMAL` 吞吐最好但掉电可丢最后若干提交（违反「每次落库即落盘」精神，排除）；`WAL + FULL` 每提交 fsync WAL，持久性 = DELETE+FULL，且读不阻塞写、大事务只需一次 fsync。
- 单实例桌面场景（`requestSingleInstanceLock` 已保证单写者）：WAL 的多读并发优势用不上，但**大事务吞吐**（词典导入、learner 索引重建）与**主文件不再整体重写**（对比 sql.js 全量导出）是本迁移的核心收益，选 **WAL + synchronous=FULL**；`busy_timeout=3000` 兜底外部工具短暂持锁。三库打开时统一 `db.pragma(...)` 设定（WAL 标志持久在库头，重复设置幂等）。

### 3.8 打包分发（electron-builder）

- `electron-builder.yml`：`npmRebuild: false → true`（better-sqlite3 是 per-ABI 原生模块，必须按 Electron ABI 就位）；`asarUnpack: "**/*.node"` **已有先例，覆盖** `better_sqlite3.node`，无需改；`files` 生产依赖自动收集，无需改。
- 本机打包网络：`npmRebuild: true` 走 @electron/rebuild，其对 prebuild-install 型模块直接以其 install 脚本带 electron 运行时参数拉预编译 → 须带镜像 env（`npm_config_better_sqlite3_binary_host_mirror`；编译兜底另加 `npm_config_disturl` 指镜像）。**免网保底路径**：仓库存 electron-ABI 二进制（§3.9 postinstall 钉定）+ 打包临时 `npmRebuild: false` 亦可出正确产物——两条路径写入打包 README，任选其一。
- fsrs-rs-nodejs（NAPI）、sql.js（WASM，dictStore 继续用）不受 npmRebuild 变更影响（rebuild 只动原生模块）。

### 3.9 双运行时（node 直跑 / electron）测试通道

- `node_modules` 里 better-sqlite3 二进制只能装一份 ABI。**决策：仓库常驻 electron-v125 二进制**（postinstall：`prebuild-install --runtime electron --target <electron版本>` 于 better-sqlite3 目录内，镜像 env 文档化）——应用与 electron 套件（m8/m12/e2e/gui）直接可用。
- 「node 直跑」套件（persist/backup/undo/m1/m5/m6-*/m7/prompts/applog/annotation-range 等）：命令改为 `ELECTRON_RUN_AS_NODE=1 node node_modules/electron/cli.js tests/<x>`（探测②已验证该通道 ABI 125 加载 + 全套 SQLite 操作）——机械上仍是「无 GUI node 语义」，GUIDE §7.3 命令文本随附录 B 一并更新；node-ABI 二进制的独立通道保留为可选项（`prebuild-install --runtime node`），不作默认。
- 长期：electron 升级至 v13 支持线后改用 NAPI 内置预编译，双运行时问题整体消失（v13 在 electron 44 实测全绿）。

---

## 4. 任务拆解表（建议 6 批，一次只派一项）

| # | 任务 | 涉及文件 | 可机械检查的验收标准 | 依赖 |
| --- | --- | --- | --- | --- |
| B1 | 依赖与 ABI 钉定：package.json 增 `better-sqlite3@^12.11.1` + postinstall 钉 electron 预编译；README 注明镜像 env | `package.json`、`docs/`（打包说明） | `node_modules/better-sqlite3/build/Release/better_sqlite3.node` 为 electron-ABI（`ELECTRON_RUN_AS_NODE=1 electron -e "require(...)"` 通过）；npm install 在带镜像 env 下从零可复现 | 无 |
| B2 | learnerDb.js 切换（趟路批） | `electron/learnerDb.js` | `ELECTRON_RUN_AS_NODE` 下 require + `open/save/all/getMeta/setMeta/reset` 冒烟绿；learner.db 旧文件直接打开且 schema_version 重建规则生效 | B1 |
| B3 | dictDb.js 切换 | `electron/dictDb.js` | `tests/m7.dict.e2e.mjs`（真下载建索引）+ `tests/m7.ecdict.e2e.mjs` 全绿；`countBySource`/`removeSource`+VACUUM 冒烟；10 万行导入计时不劣于基线 ±20% | B1 |
| B4 | db.js 主库切换 + persist 重定义 | `electron/db.js` | 四原语替换后 `tests/persist.test.cjs(14)/undo.test.cjs(29)/card-links.test.cjs` 全绿；`PRAGMA journal_mode` 实测 wal、`synchronous` 实测 full（3）；F33/F37/F38/F62 全绿 | B2、B3 |
| B5 | M2 备份快照化 + 恢复 sidecar 清理 | `electron/db.js`（snapshotTo）、`electron/backup.js`、`electron/main.js`（will-quit close） | `tests/backup.test.cjs(33)` + `tests/m2.gui.mjs` 全绿；「备份→恢复→重启不丢」演示成立；恢复后目标目录无 `-wal/-shm` 残留断言 | B4 |
| B6 | 全量回归 + GUIDE 落版 | 无新码（或测试 wrapper） | §7.3 全套件 + `tests/flows/` f11/f18/f20/f21/f24/f27/f31/f32/f33/f37/f38/f50/f61/f62 全绿；tsc 0；`npm run dist` 产物 asar 抽查 `better_sqlite3.node` 已 unpack 且应用启动可跑主流程 | B5 |

（实施时按交接包模板逐批派发；B4 是风险最高批，先派 `core-engineer` 出实施版 diff 再执行。）

---

## 5. 测试计划

**现有直接打 db 层的回归面（全量必跑）**：`tests/persist.test.cjs`(14)、`tests/backup.test.cjs`(33)、`tests/undo.test.cjs`(29)、`tests/card-links.test.cjs`、`tests/fsrs/` 六件套（L2 db 23 直打调度落库）、`tests/m12.test.cjs`(electron 42)、`tests/m8.test.cjs`(electron 65，journal 草稿防抖)、`tests/m7.*`（dictStore 段除外）、`tests/legacyBackfill.test.cjs`、`tests/m13.test.cjs`、机械闸门 `f33/f37/f38/f50/f61/f62` 与文档闸门 `f11/f18/f20/f21/f24/f27`；GUI 面按 §7.3 各自触发条件抽跑（m2/m8/shelf/marks/annotations）。

**新增套件（建议 `tests/sqlite-migration.test.cjs`，electron 通道跑）**：

1. **数据文件往返**：sql.js 写 BLOB/TEXT 库 → better-sqlite3 读；better-sqlite3 写 → sql.js 读（独立读卡器继续可用）；`undefined→null` 绑定归一断言。
2. **崩溃恢复**：事务中途 `process.exit`/kill 子进程后重开库 → journal 回放至一致状态、未提交事务消失、已提交事务完整（对应 F37 新语义）。
3. **大事务**：10 万行单事务插入（dictDb.insertRows 形态）计数/计时/让出节奏断言；`wal_checkpoint(TRUNCATE)` 后主文件自足断言（checkpoint 后仅凭 .db 文件可读全部行）。
4. **备份链路**：写入后不 checkpoint 直接 `db.backup()` → 快照含最新提交（裸 readFileSync 会缺，作对照断言）；恢复换入后 `-wal/-shm` 清理断言。
5. **persist 故障语义**：checkpoint 失败 → throw → persistNow 重试成功（沿用 F37 注入手法定期回放）。

---

## 6. 风险清单（TOP 5）

| # | 风险 | 等级 | 缓解 |
| --- | --- | --- | --- |
| 1 | **双 ABI 运行时管理**：node_modules 单一二进制，node 直跑与 electron 运行互斥；打包链（npmRebuild=true）在无镜像 env 时失败 | 高 | B1 postinstall 钉 electron-ABI + §3.9 ELECTRON_RUN_AS_NODE 通道；打包双路径（rebuild / 免网保底）写入 README；镜像 env 本机已实测可用 |
| 2 | **WAL sidecar 语义外溢**：M2 裸读备份缺数据、恢复漏删 sidecar 损库、外部脚本/旧版应用读单文件缺尾 | 高 | backup 走 `db.backup()`；恢复清 sidecar；§7.1.8/§7.2 登记纪律句；persist()=checkpoint 保「单文件自足」常态 |
| 3 | **版本锁定**：v13 NAPI 在 electron 31 硬崩（实测），v12 钉死 electron 31 支持线；electron 升级前不能升 better-sqlite3 大版本 | 中 | 钉 `^12.11.1` 并在 package.json 注释；electron 升级批次的验收标准里加 v13 复测项 |
| 4 | **同步大事务阻塞主进程**：better-sqlite3 与 sql.js 同为同步，但事务放大后单段耗时上升 | 中 | 让出节奏保留（5000 行 setImmediate）；词典导入实测基线对照（B3 验收）；backup 改异步 `db.backup()` |
| 5 | **闸门语义漂移**：F37（persist 故障注入）、F33（持久化保真）断言围绕「导出+rename」写就 | 中 | persist() 调用点零裁剪、仅换内部实现；故障注入在新原语上先行人工回放再跑闸门（B4 验收内含） |

---

## 7. 范围外（本设计明确不做）

- `electron/dictStore.js`（外部词典文件只读器）继续用 sql.js；M7 测试打包命令不变。
- 不做数据迁移脚本、不改任何表结构、不动 FSRS/摘录调度语义。
- 不在本设计稿内升级 electron（v13/NAPI 是升级后的战略选项，另行立项）。
- 不改 sql.js 依赖的移除时机（dictStore 仍依赖 → sql.js 保留为 dependency，迁移后仅三库不再用它）。

---

## 附录 A：探测命令复现（临时目录，均可丢弃）

```bash
T=$(cygpath -w "$TMP/bs3-probe-d137")   # C:\Users\xiongdy\AppData\Local\Temp\bs3-probe-d137
export npm_config_better_sqlite3_binary_host_mirror="https://registry.npmmirror.com/-/binary/better-sqlite3"
npm install better-sqlite3@12 --ignore-scripts --registry=https://registry.npmmirror.com
cd node_modules/better-sqlite3 && npx prebuild-install --runtime electron --target 31.7.7   # HTTP 200
node <repo>/node_modules/electron/cli.js probe-v12.js   # ELECTRON31_V12_OK abi=125 electron=31.7.7
```

## 附录 B：GUIDE 登记块（实施批次合入时粘贴；当前只写文本，版本 v48.92）

**§2 技术栈表（第 80 行）该行改为**：

> `| 本地数据库 | **better-sqlite3（原生 SQLite，v48.92 / D137 自 sql.js 迁移）**，WAL journal 原生落盘 | 文件在 %APPDATA%/incremental-reading-dev/library.db（另 dictionary.db / learner.db 同目录）。persist() 保留为显式 checkpoint（wal_checkpoint(TRUNCATE)）；外部读/拷库前须应用退出或刚 checkpoint（§7.1.8） |`

**§7.1.8 并发纪律句追加**：

> 「sql.js 并发纪律」自 v48.92 起由「内存库 + 全量回写」变更为「SQLite WAL 原生落盘」：运行期外部脚本改 library.db 仍必须先关闭应用；**外部拷贝/直读 library.db 单文件前，应用须已退出或刚过 persist() checkpoint（WAL 合并）**；手工换库必须同删 `-wal`/`-shm`。

**§7.2 新增登记条目（例外清单之后）**：

> - **better-sqlite3 迁移后的落盘语义（v48.92 / D137）**：「每次落库即落盘」由 SQLite 事务提交 + `synchronous=FULL` 的 WAL fsync 承担；`persist()` 保留为显式 `wal_checkpoint(TRUNCATE)`（调用点不裁剪），`persistNow()` 为其重试。M2 备份对三库改走 `db.backup()` 快照（WAL 下裸读文件无一致性保证）；恢复换入必须同删 `-wal`/`-shm`。D34 日记节流与 D119 日志追加写两例外语义不变。

**§8.1 决策日志新增行**：

> `| D137 | **better-sqlite3 迁移（v48.92，用户 2026-10-12 指令「全部实现和处理」下的技术债清算项）**：三库（library/dictionary/learner）自 sql.js 迁 better-sqlite3@^12.11.1（v13 NAPI 在 electron 31 硬崩经实机探测排除；electron-v125 预编译经 npmmirror 镜像实测全绿）；WAL + synchronous=FULL；persist() 重定义为显式 checkpoint；M2 备份改 db.backup() 快照 + 恢复清 sidecar；node 直跑测试改 ELECTRON_RUN_AS_NODE 通道（仓库常驻 electron-ABI 二进制）；dictStore.js 外部文件只读器保留 sql.js；electron-builder npmRebuild false→true（asarUnpack **/*.node 既有先例覆盖） | §9.4 技术债 / §8.2 偏差销项；docs/design/SQLITE3-MIGRATION-D137.md 实机探测三结论 | v48.92 |`

**§8.2 已接受偏差表该行销项（改为）**：

> `| 数据库 sql.js 而非 better-sqlite3 | §2 表 | ~~sql.js 全量回写~~ | **已销项（v48.92 / D137）**：better-sqlite3 迁移实施，偏差消除 |`

**§9.4 技术债表该行更新为**：

> `| better-sqlite3 迁移 | ✅ 已清算（v48.92 / D137） | 设计与可行性＝docs/design/SQLITE3-MIGRATION-D137.md；实施按其 §4 批次表分批交付 |`

**§7.3 测试命令通道补注**：

> - 「node 直跑」套件在 better-sqlite3 迁移（D137）后统一经 `ELECTRON_RUN_AS_NODE=1 node node_modules/electron/cli.js tests/<套件>` 执行（仓库常驻 electron-ABI 原生模块，ABI 125；v13/NAPI 随 electron 升级另议）。

---

## 附录 C：v48.98 / D143 增补——启动期阻塞清算对 D137 条的修订

> 上游：`docs/design/STARTUP-LAG-DIAGNOSIS.md`（2026-10-12 只读诊断）+ GUIDE §8.1 D143（用户拍板 T1+T2+T3 全量修）。本附录修订 D137 迁移批留下的两处**启动期阻塞**（均为「结果仅入日志、不阻塞」注释与实测不符的偏差）：

1. **§3.5「启动后 PRAGMA quick_check 一次……不阻塞」修订（仅 dictionary.db）**：`dictDb.open()` 内对 835MB `dictionary.db` 的 `quick_check` 实测 1.2s（热态稳定）~21.6s（B-1 一次性极值），且发生在启动链与「首次查词」同步路径上（诊断 §3 R1a/R1c）。v48.98 起该检查**自 `dictDb.open()` 移除**——`open()`（含首次查词 `dict:lookup`）不再做完整性检查，不再产生 1.2s~21.6s 阻塞；改由 `backup-build-worker.js` 对**每日备份快照文件**以只读连接执行一次（每自然日一次，结果回传主进程入应用日志），保留「损坏早暴露」目的的降频实现。主库（17.5MB，实测 21~163ms）与 learner.db（派生可重建）的启动 quick_check 维持不变。
2. **§3.6 备份链补充实测口径**：better-sqlite3 `db.backup()` 页拷贝本身（逐小步 setImmediate 让出）实测不产生 >100ms 主进程空洞（诊断 §3 R1 的空洞来自别处）；剩余启动期阻塞实测来自**快照整读（835MB `fs.readFileSync`）+ JSZip DEFLATE（pako 纯主线程）+ `fs.writeFileSync`（~900MB）**——v48.98 起三者连同 zip 构建整体移入 `worker_threads`（`electron/backup-build-worker.js`：只读文件、零 DB 访问、三库单连接纪律不变）；`autoBackupIfNeeded` 自 whenReady 链上的 `await` 改为 30s 延迟后台触发（失败仍只记日志）。备份产物格式/恢复路径/每日一份/轮换/`.part` 断点语义零变化。
