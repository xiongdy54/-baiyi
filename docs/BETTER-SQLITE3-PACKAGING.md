# better-sqlite3 安装与打包说明（D137 / v48.92；C-24 / D207 修订）

> 配套设计稿：`docs/design/SQLITE3-MIGRATION-D137.md`（§1 探测结论、§3.8 打包、§3.9 双运行时）。
> 本文回答两件事：better-sqlite3 为什么随 Electron 版本走 v12/v13 两条线；安装/打包时二进制从哪里来。

## 版本线（硬条件）

- **Electron 31 时代（D137，已随 C-24 结束）**：钉 `better-sqlite3@^12.11.1`（per-ABI 原生模块）。
  v12 的 NAPI 内置预编译在 electron 31.7.7 上「能 require、首个 Database 操作即硬崩」
  （设计稿探测②实机复现；Node 24 与 electron 44 全绿，属 electron 31 兼容性问题）。
- **Electron 45 时代（C-24 / D207，2026-10-24 起）**：钉 **`better-sqlite3@13.0.3`（精确）**。
  ① v12 系没有任何 Electron 45（ABI 150）预编译（GitHub Releases 最高 v148 = Electron 43，
  npmmirror 同步缺位，实测双通道 404）——per-ABI 拉取路线在 Electron 45 上不可用；
  ② v13 起预编译 NAPI 二进制**直接内置在 npm tarball 内**（`prebuilds/` 8 平台，prebuildify
  模式），同一份二进制跨 Node / Electron 版本通用，零下载、零镜像依赖、零本地编译；
  ③ D137 登记的「electron 升级批次的验收标准里加 v13 复测项」已在 C-24 执行：Electron 45
  完整主进程模式实测全绿（建表 / 插入 / 查询 / 事务 / WAL，`napi=10 node=24.22.0`），
  Electron-as-Node 与系统 Node 24 同一二进制均通过。
- **禁降回 v13 以下**：v12 在 Electron 45 上无预编译（源码编译需本机 MSVC + Python，
  且 postinstall 的 per-ABI 拉取会 404 失败）；除非连同 Electron 一起降回 31。

## 二进制来源（C-24 后单通道）

better-sqlite3 v13 = NAPI 内置预编译：`npm install`（或 `npm ci`）即得正确二进制，
**不再需要** prebuild-install 拉取与 npmmirror 镜像 env（v13 已移除该依赖）。

1. **postinstall 验证（默认路径）**：`npm install` 后 `scripts/pin-better-sqlite3-electron.cjs`
   自动执行——检测到 `node_modules/better-sqlite3/prebuilds/`（v13+）即跳过拉取，
   只经 `ELECTRON_RUN_AS_NODE` 通道做「能加载 + 能建库」硬验证（`PIN_OK abi=150`）。
   脚本保留 v12 per-ABI 拉取分支（含 npmmirror 镜像默认值）以兼容降级场景。
2. **手工兜底**：`prebuilds/` 缺位时重装即可（`npm i better-sqlite3 --ignore-scripts`）；
   本地源码编译仅极端场景需要（VS Build Tools + Python，Electron 45 起原生模块需 C++20）。

## electron-builder

- `npmRebuild: true`（D137 起）：v13 后 better-sqlite3 无 install 脚本、NAPI 二进制运行时无关，
  @electron/rebuild 对其无 per-ABI 工作可做；fsrs-rs-nodejs（NAPI）、sql.js（WASM）同样无需重编。
- **免网保底路径**：v13 的 NAPI 预编译随 node_modules 原样收集即可用
  （`asarUnpack: "**/*.node"` 覆盖 `prebuilds/*.node`）。

## 测试通道（§3.9）

「node 直跑」套件统一经 `ELECTRON_RUN_AS_NODE=1 node node_modules/electron/cli.js tests/<套件>` 执行；
纯 electron 通道套件照旧 `npx electron tests/<套件>`。v13 NAPI 起，两个通道加载的是
**同一份**内置预编译二进制，双运行时 ABI 管理问题整体消失（D137 §4「长期」项兑现）。
