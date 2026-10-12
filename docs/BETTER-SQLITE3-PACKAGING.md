# better-sqlite3 安装与打包说明（D137 / v48.92）

> 配套设计稿：`docs/design/SQLITE3-MIGRATION-D137.md`（§1 探测结论、§3.8 打包、§3.9 双运行时）。
> 本文回答两件事：为什么 better-sqlite3 必须 v12 而非 v13；安装/打包时预编译二进制从哪里来。

## 版本锁定（硬条件）

- 依赖钉 **`better-sqlite3@^12.11.1`**（package.json `dependencies` —— 运行时依赖，非 dev）。
- **禁用 v13**：v13 的 NAPI 内置预编译在 electron 31.7.7 上「能 require、首个 Database 操作即硬崩」
  （设计稿探测②实机复现；Node 24 与 electron 44 全绿，属 electron 31 兼容性问题）。
  electron 升级批次的验收标准里含 v13 复测项，升级前不得动大版本。

## 预编译二进制来源（双通道）

better-sqlite3 v12 是 per-ABI 原生模块：`node_modules` 里只能装一份 ABI。

1. **postinstall 自动钉定（默认路径）**：`npm install` 后 `scripts/pin-better-sqlite3-electron.cjs`
   自动执行——在 better-sqlite3 目录内按 `--runtime electron --target <electron 版本>` 重拉预编译，
   并经 `ELECTRON_RUN_AS_NODE` 通道硬验证（`PIN_OK abi=125`）。镜像 env 未设时默认走 npmmirror：

   ```
   npm_config_better_sqlite3_binary_host_mirror=https://registry.npmmirror.com/-/binary/better-sqlite3
   ```

2. **手工兜底**：`cd node_modules/better-sqlite3 && npx prebuild-install --runtime electron --target <electron 版本>`
   （同一镜像 env）。源码编译兜底另加 `npm_config_disturl=https://npmmirror.com/mirrors/node/`。

## electron-builder

- `npmRebuild: true`（D137 起）：@electron/rebuild 对 prebuild-install 型模块直接带 electron 运行时参数
  拉预编译 → **打包机必须带同一镜像 env**（或可直连 GitHub）。
- **免网保底路径**：仓库已常驻 electron-ABI 二进制（postinstall 钉定），临时改回 `npmRebuild: false`
  打包亦可出正确产物——electron-builder 原样收集 node_modules，`asarUnpack: "**/*.node"` 已覆盖
  `better_sqlite3.node`。两条路径任选其一。
- fsrs-rs-nodejs（NAPI）、sql.js（WASM，dictStore 外部文件只读器继续用）不受 npmRebuild 变更影响。

## 测试通道（§3.9）

「node 直跑」套件统一经 `ELECTRON_RUN_AS_NODE=1 node node_modules/electron/cli.js tests/<套件>` 执行
（加载同一份 electron-ABI 二进制，机械上仍是无 GUI node 语义）；纯 electron 通道套件照旧
`npx electron tests/<套件>`。
