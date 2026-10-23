# C 项审计修复进度账

> **报告（只读）**：`C:\Users\xiongdy\Desktop\report_confirmed.md`（303 KB，3658 行，48 项 C-01…C-48）。
> **本账本**：只记状态、提交/合并、验收摘要、偏离；标题、根因、修复步骤与验收标准一律以报告 §2 / §3 / 对应 C-xx 小节为准。
> **更新时间**：2026-10-23。**本账最近更新时 main HEAD**：`2400489`（C-09 合并；账本上一版于 `1ceccbb`）。

## 0. 执行规则（摘要，完整规则见报告 §0）

1. **一次会话只做一项 C-xx**；一项一提交，提交信息 `fix(C-xx): 简述`；验收通过后 `git merge --no-ff` 回 main（本仓无远程）。
2. **报告只读**。按 §0、§3、目标 C-xx 小节分段读，不要整份读入（超过 Read 工具上限）。
3. **先跑基线再改，再跑验收**。失败数不得多于本项开始前的基线，且失败集合不得新增文件；新增失败必须查明归属并在本账本记录。
4. **绝不触碰真实 userData**（`%APPDATA%\incremental-reading-dev` / `~/.config/incremental-reading-dev` / `~/Library/Application Support/incremental-reading-dev`）；测试用 `fs.mkdtempSync` + `app.setPath("userData", dir)`。
5. **不升级依赖**（除 C-24、C-41）；不运行 `npm audit fix --force`；不删除已有测试（期望过期只按 C-05 更新）。
6. **测试副产物**：`tests/*.bundle.cjs`、`tests/.results/`、`tests/tmp-*` 可能变脏；提交用显式路径，不要 `git add -A`。
7. **锚点优先**：报告行号只作参考；先 `rg -n "锚点"` 定位，找不到或代码与描述不一致时停下，按 §0 第 7 条回报。

## 1. 当前状态（2026-10-23）

- **报告快照对齐**：报告是在 `feat/floating-atlas-d203`（D203/D204 纸片图谱）功能分支的打包提交上产出的。该分支已于 2026-10-23 以 `--no-ff` 合入 main：`dde0a81`（分支 HEAD `1267cad`，32 文件 +6590/−509）。C-45 前 main 与报告快照的 89 个测试规模一致；C-45 与 C-08 按报告预期各新增 1 个测试、C-09 新增 2 个，现为 93 个。
- **D203/D204 功能状态**：代码已进 main，但 **D204 实机 UX 仍未验收**（用户反馈「效果还是不好」；D205 窗内 morph 已实机否决并还原到 `1267cad`）。C-31/C-32/C-33 的 lensWindow 锚点现在存在，但仍按报告执行，不要假定该功能已验收。
- **测试规模**：93 个 `tests/*.test.cjs`，分布 **28 electron / 7 system-node / 58 electron-node**（C-45 guard、C-08 `bookasset-path`、C-09 `csp-policy` 落在 electron-node；C-09 `csp-enforcement` 落在 electron）；报告基线为 89 个，C-45 / C-08 / C-09 各按报告预期 +1 / +1 / +2。
- **本机 Windows 基线（2026-10-23，C-02 前）**：`npm test` → **89 个：82 过 / 7 败 / 0 超时**；结果写入 `tests/.results/latest.json`。C-02 后两次全量均为 **81 过 / 8 败**，多出的 `lensWindow` G1 是时序 flake（见 §1.1），其余 7 败归属不变。**C-03 后一次全量为 83 过 / 6 败**：两个 artifact 失败已消除，`lensWindow` G1 本轮回落到失败集，其余 5 败归属不变。**C-04 后一次全量为 84 过 / 5 败**：`lensWindow` 本轮通过，其余 5 败归属不变，无新增失败文件。**C-05 后全量为 85 过 / 4 败**：m1.prompts / m7.prompts 转绿；失败集合 = applog、i18n、m14、m15v2.route（性能阈值 flake，单独跑通过；与 `tsc` 并行的首轮另有 `lensWindow` G1）。**C-06 后全量为 87 过 / 2 败**：i18n 转绿；失败集合 = applog、m14（均为既有未归属项）；`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。**C-45 后全量为 90 个 87 过 / 3 败**：guard 测试通过；多出的 `lensWindow` G1 是时序 flake（直跑复现），失败集合 = applog、lensWindow、m14，无新增失败文件。**C-08 后全量为 91 个 88 过 / 3 败**：新增 `bookasset-path` 通过；失败集合 = applog、m14、`m15v2.route`（性能阈值 flake，中位 30.7ms vs ≤30ms，与本项无关），`lensWindow` 本轮通过，无新增失败文件。**C-09 后全量为 93 个 91 过 / 2 败**：新增 `csp-policy` / `csp-enforcement` 均通过；失败集合 = applog、m14（均为既有未归属项）；`lensWindow` 与 `m15v2.route` 本轮通过，无新增失败文件。
- **报告 Linux 基线**：89 个 66 过 / 23 败（见报告 §1.3 / 附录 C）。跨平台比较以本机实测为准，并在回报中注明平台。
- **已完成**：C-07、C-01、C-02、C-03、C-04、C-05、C-06、C-45、C-08、C-09。
- **下一项**：**C-10**（数据库 schema 版本化 + 事务化迁移 + 迁移前快照，P0；依赖 C-01，已完成）。

### 1.1 已知失败与归属（2026-10-23，Windows）

| 测试文件 | 归属 | 说明 |
| --- | --- | --- |
| `tests/applog.test.cjs` | 待确认 | 报告 U-28 曾标为 Linux/Xvfb 环境差异；Windows 仍失败，暂不归属到 C-01。2026-10-23 复核：本机宿主全局注入 `ELECTRON_RUN_AS_NODE=1`，第 11 节 spawn 的 Electron 子进程继承该变量后以 Node 身份启动（`app` undefined），故无崩溃日志；C-09 改动前基线同样失败，与本项无关（runner 对 electron-node 运行时本身也设置该变量，属于测试脚手架的宿主环境差异）。 |
| `tests/d111-artifact.test.cjs` | 已修复（C-03） | Windows CRLF 导致产物逐字节比较失败；C-03 改为规范化后比较并通过。 |
| `tests/i18n.test.cjs` | 已修复（C-06） | en / ja 各缺 17 个键；C-06 补齐后 `i18n-check` 退出码 0、测试转绿。 |
| `tests/lensWindowFit.artifact.test.cjs` | 已修复（C-03） | D203 合并后新增；现场重打包 7053 B vs 仓库 7224 B，差值 171 B；C-03 改为规范化后比较并通过。 |
| `tests/lensWindow.test.cjs` | 未归属（时序 flake） | C-02 后两次全量均失败于 G1（55ms 采样 180ms 缓动）；该文件与 `electron/lensWindow.js` 未被 C-02 改动，单独连跑 3 次 1 过 2 败。C-04 全量本轮通过；C-05 与 `tsc` 并行的首轮复现，随后单独跑与干净全量均通过。C-45 全量复现（G1），直跑同样 1 败；本项只改 `tests/flows` 与新增 guard，与该文件无关。C-08 全量本轮通过。 |
| `tests/m1.prompts.test.cjs` | 已修复（C-05） | prompt 版本期望 7，实际 8（过期期望）；C-05 改为引用 `db.CARD_PROMPT_TARGET_VERSION` 并通过。 |
| `tests/m14.test.cjs` | 待确认 | Windows `EBUSY: rename ... library.db -> .pre-restore`（恢复换入）；暂不归属，执行 C-13 时复核。 |
| `tests/m15v2.route.test.cjs` | 未归属（性能阈值 flake） | C-05 全量中位 30.5ms vs 阈值 ≤30ms（最快 26.2 / 最慢 32.9）；单独跑通过。该测试只 import `src/lib/mindmap/v2`，不 require `electron/db.js`，与 C-05 改动无关。C-08 全量复现（中位 30.7ms，最快 28.4 / 最慢 33.3）；不 require `electron/main.js`，与本项无关。 |
| `tests/m7.prompts.test.cjs` | 已修复（C-05） | 主制卡 prompt 期望 v6，实际 8（过期期望）；C-05 改为引用 `db.CARD_PROMPT_TARGET_VERSION` 并通过。 |

> 说明：C-01 在合并 D203 前是 85 个测试 79 过 / 6 败；合并后为 89 个 82 过 / 7 败。新增的唯一失败是 `lensWindowFit.artifact`，属 C-03，不是 C-01 回归。
> C-02 后两次全量均 81 过 / 8 败：多出的 `lensWindow` G1 是时序 flake（非 C-02 代码路径），其余 7 败与上表一致；20 个受 C-02 影响的测试 19 过 / 1 败（m14 既有 EBUSY），与基线相同。
> C-03 后全量 83 过 / 6 败：失败集合 = applog、i18n、lensWindow（时序 flake 本轮复现）、m1.prompts、m14、m7.prompts；两个 artifact 已不再失败，无新增失败文件。
> C-04 后全量 84 过 / 5 败：失败集合 = applog、i18n、m1.prompts、m14、m7.prompts；`lensWindow` 本轮通过，无新增失败文件。
> C-05 后：全量首轮与 `npm run typecheck` 并行，84 过 / 5 败（`lensWindow` G1 + `m15v2.route` ④）；无并行负载的干净全量 85 过 / 4 败（applog、i18n、m14、m15v2.route）。`m15v2.route` 单独跑通过，`lensWindow` 单独跑 3 套件全通过。
> C-06 后：全量 89 个 **87 过 / 2 败**（applog、m14）；i18n 转绿，`lensWindow` 与 `m15v2.route` 本轮均通过；失败集合无新增。
> C-45 后：全量 90 个 **87 过 / 3 败**（applog、lensWindow G1、m14）；新增的 `flow-exit-guard` 通过，无新增失败文件。流程套件额外复跑 10 条：F84 / F86 / F88 各 3/4 为流程内既有行为断言（F84 = 已登记 D-TEST-88，F86 / F88 与 2026-09-24 旧结果一致），不计入 `tests/*.test.cjs` 失败。
> C-08 后：全量 91 个 **88 过 / 3 败**（applog、m14、m15v2.route 阈值 flake）；新增 `bookasset-path` 通过，`lensWindow` 本轮通过，无新增失败文件。
> C-09 后：全量 93 个 **91 过 / 2 败**（applog、m14）；新增 `csp-policy` / `csp-enforcement` 通过，`lensWindow` 与 `m15v2.route` 本轮通过，无新增失败文件。

## 2. 执行顺序与状态

状态图例：**完成** / **进行中** / **待做** / **中止** / **部分**。顺序严格按报告 §3。

### 阶段 0 · 工具链（C-07 → C-01 → C-02 → C-03 → C-04 → C-05 → C-06 → C-45）

| # | 编号 | 状态 | 提交 / 合并 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | C-07 | 完成 | `2610a74` / `c881615` | postinstall 无头 Linux 可诊断；`NUTATION_SKIP_ABI_VERIFY`。 |
| 2 | C-01 | 完成 | `951fbd9` / `ebba5ef`；合并后补头 `91824ee` | 统一入口 + esbuild + @runtime；验收见 §3.1。 |
| 3 | C-02 | 完成 | `f927189` / `4938cfa` | 32 个 ROOT + 3 处 Electron 二进制 + flows node 分支；验收见 §3.3。 |
| 4 | C-03 | 完成 | `d1a7ca4` + `829932c` + `42682e0` / `5b920b2` | `.gitattributes` 与行尾规范化各单独提交；验收见 §3.4。 |
| 5 | C-04 | 完成 | `cfa14ae` / `190bb35` | `file` 现识别为文本；报告给的 `epub` 过滤词命中 0 个测试，改用 `m6-1`；验收见 §3.5。 |
| 6 | C-05 | 完成 | `bc8492d` / `65ea513` | 目标版本导出为 `CARD_PROMPT_TARGET_VERSION`；两个测试改引用常量；验收见 §3.6。 |
| 7 | C-06 | 完成 | `95108e5` / `a5aaac1` | 补齐 en / ja 各 17 键；验收见 §3.7。 |
| 8 | C-45 | 完成 | `b66d345` / `b8ebf24` | 10 条流程补显式退出 + `flow-exit-guard`；验收见 §3.8。 |

### 阶段 1 · 首发前必须完成（P0）

| # | 编号 | 状态 | 提交 / 合并 | 备注 |
| --- | --- | --- | --- | --- |
| 9 | C-08 | 完成 | `3081287` / `7bb6809` | 纯函数路径校验 + 真实 Electron 探针；验收见 §3.9。 |
| 10 | C-09 | 完成 | `ff3b448` / `2400489` | 构建期 CSP + 权限处理器 + foliate 脚本剔除；验收见 §3.10。 |
| 11 | C-10 | 待做 | — | schema 版本化 + 事务化迁移 + 迁移前快照。 |
| 12 | C-11 | 待做 | — | 冻结发布身份；⛔ 决策 D-02。 |
| 13 | C-12 | 待做 | — | 备份/恢复流式化，ZIP64 / >2 GiB。 |
| 14 | C-13 | 待做 | — | 恢复流程（退出清理 / learner.db / 设备设置）；同时复核 m14 EBUSY。 |
| 15 | C-14 | 待做 | — | 备份轮换按 mtime 排序。 |
| 16 | C-15 | 待做 | — | settings.json 两份实现合并。 |
| 17 | C-16 | 待做 | — | 撤销评分选错卡。 |
| 18 | C-17 | 待做 | — | persist 把已提交写入误报失败。 |

### 阶段 2 · 正确性与规模

| # | 编号 | 状态 | 提交 / 合并 | 备注 |
| --- | --- | --- | --- | --- |
| 19 | C-18 | 待做 | — | 10 万卡复习性能。 |
| 20 | C-19 | 待做 | — | AI 流式传输。 |
| 21 | C-20 | 待做 | — | API Key 存储。 |
| 22 | C-21 | 待做 | — | 写入口参数校验。 |
| 23 | C-22 | 待做 | — | 软删除过滤 / 资产孤儿。 |
| 24 | C-23 | 待做 | — | 启动 quick_check 阻塞。 |
| 25 | C-43 | 待做 | — | 分块扫描期间写入抛错。 |
| 26 | C-44 | 待做 | — | 主题插件 CSS 零网络校验绕过。 |
| 27 | C-46 | 待做 | — | memory 原子写。 |
| 28 | C-47 | 待做 | — | 导入书目/正文两次提交。 |
| 29 | C-48 | 待做 | — | FSRS 参数迁移指针覆盖。 |

### 阶段 3 · 平台

| # | 编号 | 状态 | 提交 / 合并 | 备注 |
| --- | --- | --- | --- | --- |
| 30 | C-24 | 待做 | — | Electron 升级路线；⛔ 决策 D-01 / D-10。 |
| 31 | C-25 | 待做 | — | macOS 应用菜单导致 Cmd+C/V/Q 失效。 |
| 32 | C-26 | 待做 | — | 快捷键跨平台；⛔ 决策 D-03（仅默认键位）。 |
| 33 | C-27 | 待做 | — | IME 组字回车误提交。 |
| 34 | C-28 | 待做 | — | 托盘/窗口图标平台适配；⛔ 决策 D-09（仅第 4 步）。 |
| 35 | C-29 | 待做 | — | 开机自启平台判断。 |
| 36 | C-30 | 待做 | — | 全平台打包矩阵 + 签名公证 + CI。 |

### 阶段 4 · 体验一致性

| # | 编号 | 状态 | 提交 / 合并 | 备注 |
| --- | --- | --- | --- | --- |
| 37 | C-31 | 待做 | — | 皮肤/动效设置同步到 lens / 制卡台 / 捕获窗口。 |
| 38 | C-32 | 待做 | — | 结构图谱流畅度 Phase A（渲染层）。 |
| 39 | C-33 | 待做 | — | 结构图谱流畅度 Phase B（去掉逐帧 setBounds）；依赖 C-32；⛔ 决策 D-04。 |
| 40 | C-34 | 待做 | — | 文本编辑器统一。 |
| 41 | C-35 | 待做 | — | 一致性机器闸门。 |
| 42 | C-36 | 待做 | — | 触控/仅 hover 可见。 |
| 43 | C-37 | 待做 | — | 主题模式跟随系统。 |

### 阶段 5 · 未来能力预留

| # | 编号 | 状态 | 提交 / 合并 | 备注 |
| --- | --- | --- | --- | --- |
| 44 | C-38 | 待做 | — | 云同步预留。 |
| 45 | C-39 | 待做 | — | 导出 Anki。 |
| 46 | C-40 | 待做 | — | 移动端准备；⛔ 决策 D-05。 |
| 47 | C-41 | 待做 | — | 生产依赖漏洞（npm audit）。 |
| 48 | C-42 | 待做 | — | AGENTS.md 等开发指引过时。 |

> 注意：报告 §3 把 C-45 放在阶段 0 末尾（C-07→C-01→C-02→C-03→C-04→C-05→C-06→C-45），不要按编号顺序提前做。

## 3. 已完成项详情

### 3.1 C-01 · 统一测试入口 + 声明缺失的 devDependency

- **提交**：`951fbd9 fix(C-01): 统一测试入口，补齐 @runtime 头并声明 esbuild 依赖`；合并 `ebba5ef`。
- **D203 合并后补齐**：`91824ee`（`tests/m15v2.canvas-api.dom.test.cjs` 的 `@runtime: system-node`；该文件是 C-01 清单里原本缺失、随 D203/D204 合并进来的）。
- **改动**：
  - `package.json`：`engines.node >=22.12`；`test` / `typecheck` / `i18n:check`；`esbuild` 固定 `0.25.12`。
  - `scripts/run-tests.mjs`：按 `@runtime` 三值分流；`--list` / 过滤词 / `--timeout=`；结果写 `tests/.results/latest.json`。
  - `.gitignore`：`tests/.results/`。
  - `tests/m7.test.cjs`：运行时自动 esbuild 到 `tests/tmp-m7`；15s 阈值乘 `NUT_PERF_FACTOR`。
  - `tests/m15v2.route.test.cjs`：30 / 10ms 阈值乘 `NUT_PERF_FACTOR`。
  - `tests/m15v2.layout.test.cjs`：16 / 16 / 200ms 阈值乘 `NUT_PERF_FACTOR`。
  - 27 个 electron 测试补 / 改 `@runtime: electron`；7 个 system-node 测试补 / 改 `@runtime: system-node`。
- **验收（2026-10-23，Windows，合并 D203 后）**：
  - `node scripts/run-tests.mjs --list | tail -1` → `{"electron-node":55,"electron":27,"system-node":7}`（与报告 27/7/55 一致）。
  - `node scripts/run-tests.mjs persist i18n` → persist PASS；i18n FAIL（C-06 预期）。
  - `npm test` → 89 个：82 过 / 7 败 / 0 超时；`tests/.results/latest.json` 已写出；失败集合见 §1.1。
  - `npm run typecheck` → 0 错误。
- **偏离**：
  - runner 在真实 Electron 运行时启动前显式删除继承的 `ELECTRON_RUN_AS_NODE`；本机宿主会全局注入 `1`，否则 27 个 electron 测试全部 `app` undefined 假失败。不要移除这行。
  - 报告原代码只要求 route 的 30ms 阈值可调；按 C-01 第 7 步“其他 ms 阈值同样处理”，扩展到了 layout 与 m7。
  - 报告快照 89 个测试；C-01 首次在 main 执行时只有 85 个（D203/D204 未合并）。2026-10-23 合并功能分支后重跑，`--list` 才与报告完全一致。
  - 合并带入的 4 个测试：3 个 electron-node（`lensFocusLayout` / `lensWindowFit` / `lensWindowFit.artifact`）+ 1 个 system-node（`m15v2.canvas-api.dom`）；其中 `lensWindowFit.artifact` 在 Windows 因 CRLF 失败，其余通过。
  - 合并后新增的 `lensWindowFit.artifact` 失败是 C-03 的 CRLF 问题（171 B），不是 C-01 回归。
  - 测试会重写 `tests/m15r.activity.bundle.cjs`、`tests/m15r.layout.bundle.cjs`、`tests/m6-1.epub.bundle.cjs`；这些是副产物，未提交，提交时用显式路径。

### 3.2 C-07 · postinstall 在无头 Linux/CI 的失败不可诊断

- **提交**：`2610a74 fix(C-07): postinstall 失败时提示 Linux 系统库依赖，支持 NUTATION_SKIP_ABI_VERIFY`；合并 `c881615`。
- 详细验收见该提交与报告 C-07 小节；本账本不重复。

### 3.3 C-02 · 去掉测试/脚本里硬编码的 Windows 绝对路径

- **提交**：`f927189 fix(C-02): 去掉测试/脚本里硬编码的 Windows 绝对路径`；合并 `4938cfa`。验收边界补充：`23d92bb` / merge `0fc9888`（未跑 GUI / 非 Windows 实机）。
- **改动**：
  - 32 个 `tests/` 根层文件：`const ROOT = "C:/Users/xiongdy/.../Incremental reading Dev"` → `require("path").resolve(__dirname, "..")`。
  - `tests/flows/run.cjs`：`electronExe()` 改由 `tests/lib/electronBin.cjs` 按平台解析；非 electron 流程改用 Electron-as-node（`ELECTRON_RUN_AS_NODE=1`），electron 流程显式删除宿主继承的该变量（与 C-01 runner 同口径）。
  - `tests/flows/lib/guienv.cjs`、`tests/flows/f39-fs-environment-adversary.cjs`：Electron 二进制同样走 `electronBin()`。
  - 新增 `tests/lib/electronBin.cjs`：`require("electron")` 返回当前平台可执行文件路径。
  - 一次性 codemod `scripts/codemods/fix-hardcoded-root.cjs` 按报告新建并执行后删除（未入库）。
- **验收（2026-10-23，Windows）**：
  - `node scripts/run-tests.mjs --list | tail -1` → `{"electron-node":55,"electron":27,"system-node":7}`（不变）。
  - `rg -n -F 'dist", "electron.exe' tests scripts` → 无输出。
  - `git grep -n -F "Incremental reading Dev" -- tests scripts` → 仅 `tests/flows/fixtures/f40/spec.out`（报告明确不改的输出样本）+ `tests/m6-1.epub.bundle.cjs`（esbuild 生成注释；22 个 `*.bundle.cjs` 是仓库既有跟踪副产物）。加 `--glob '!*.out' --glob '!*.bundle.cjs'` 后无输出。
  - `node scripts/run-tests.mjs k1 undo m14 lm-db` → k1 / lm-db / undo 通过，m14 既有 EBUSY；无 `ENOENT 'C:/Users/...'`。
  - 20 个受影响测试复验 → 19 过 / 1 败（m14 既有 EBUSY），与改动前基线逐项一致。
  - `node tests/flows/run.cjs --only F27 --cycles 1 --gap 0` → 13/14，与系统 Node 直跑 F27 完全一致（W6 既有失败），证明 node 分支的 Electron-as-node 切换正常。
  - `npm test` → 两次均 89 个 81 过 / 8 败；失败集合 = §1.1 的 7 条已知 + `lensWindow` G1 时序 flake。
- **验收边界**：仅在 Windows 实机复跑；未在 Linux/macOS 实机执行（跨平台结论来自静态清零、`electron` 包路径解析与 flows node 分支 smoke）。10 个 `.gui.seed.cjs` 与 2 个其他 seed 随 ROOT 改动，GUI 套件需 `npm run build` + CDP，本次未运行，仅做 `node --check` 语法校验。
- **偏离**：
  - codemod 实际改 36 个文件：32 个跟踪文件 + 4 个未跟踪的 `tests/tmp-*.seed.cjs` 本机临时文件（被 `.gitignore` 忽略）。codemod 的模式字面量本身会命中验收 rg，故执行后删除、未入库。
  - 验收 1 在脏工作区还会命中未跟踪的 `tests/tmp-*`、`*.log`（干净克隆不存在）与生成的 bundle 注释；源码面用 `git grep` 复核为零。
  - 报告未枚举、本次未动的两处绝对路径：`scripts/gen-icons.cjs:10`（图标设计包 `KIT`，仓库外一次性资产生成器）与 `tests/fsrs/audit.cjs:13`（`--db` 默认指向作者真实 userData，只读审计脚本）。建议后续单列，不在 C-02 内自行扩大范围。
  - 报告把 `tests/flows/fixtures/f39-writer-child.cjs` 的注释计为第 4 处 `electron.exe` 引用；该处仅为说明文字、无 `path.join`/可执行引用，未改。
  - flows 的 electron 分支额外显式删除继承的 `ELECTRON_RUN_AS_NODE`（报告只要求改 node 分支）；本机宿主全局注入 1，否则 electron 流程会以 node 身份启动、`app` undefined。
  - `lensWindow` G1 是既有时序 flake，未修；见 §1.1。

### 3.4 C-03 · 行尾规范化 + 产物比较对 CRLF 免疫

- **提交**：`d1a7ca4 chore(C-03): add .gitattributes`、`829932c chore(C-03): normalize line endings`、`42682e0 fix(C-03): 产物比较对 CRLF 免疫`；合并 `5b920b2`。
- **改动**：
  - 新建 `.gitattributes`：`* text=auto eol=lf`；`*.bat/*.cmd/*.ps1` 为 `eol=crlf`；图片 / 字体 / 归档 / 数据库 / 音视频 / 词典等二进制清单（按报告原样）。
  - `tests/d111-artifact.test.cjs`、`tests/lensWindowFit.artifact.test.cjs`：比较前用 `norm = (s) => s.replace(/\r\n/g, "\n")` 归一化；失败提示的判定同步改用 `norm`。
- **验收（2026-10-23，Windows）**：
  - `git ls-files --eol | awk '{print $2}' | sort | uniq -c` → `256 w/-text / 3 w/crlf / 907 w/lf / 7 w/none`。3 个 `w/crlf` = `启动提示词测试台.bat`（`eol=crlf`）+ 两个已标 `binary` 的 f40 语料 PDF。
  - `node scripts/run-tests.mjs artifact` → 2 通过 / 0 失败（基线为 0 通过 / 2 失败，见 §1.1）。
  - **CRLF 免疫差分实测**：把 `electron/cardQuery.bundle.cjs`、`electron/lensWindowFit.bundle.cjs` 强制改为 CRLF（分别 442 / 171 个 CR），旧比较 `rawEq=false`、新比较 `normEq=true`；再跑 artifact → 2 通过；随后还原为 LF（CR=0）。
  - `npm test` → 89 个 **83 过 / 6 败 / 0 超时**；失败集合 = applog、i18n、lensWindow（时序 flake）、m1.prompts、m14、m7.prompts；无新增失败文件。
  - `npm run typecheck` → exit 0。
- **偏离**：
  - **规范化提交实际只含 2 个 PDF**：仓库索引里的全部文本文件本来就是 LF（`i/lf`），747 个 `w/crlf` 只是本机检出状态，因此 `git add -u --renormalize .` 没有任何文本改动可提交。工作树随后通过 `touch` 全部跟踪文件 + `git checkout-index -f -a` 重新检出为 LF（checkout-index 会跳过 stat 未变的文件，必须先 touch）。
  - `*.pdf binary` 使两个 f40 语料 PDF 从索引里的文本规范化版本（46816 / 472528 B，LF）恢复为工作树里的原始二进制字节（48487 / 489049 B，CRLF）。报告未点明此副作用，但符合 `*.pdf binary` 的意图；f40 一直读的是工作树文件，行为不变。
  - 执行前还原了测试副产物 `tests/m15r.activity.bundle.cjs`、`tests/m15r.layout.bundle.cjs`、`tests/m6-1.epub.bundle.cjs`；全量测试后会再次变脏，未提交。
  - 断言文案仍叫“逐字节一致”，实际语义变为“行尾归一后逐字节一致”（即报告步骤 3 的要求）。
  - 未运行 GUI 套件与 flows（与本项无关）；平台仅 Windows。

### 3.5 C-04 · `src/lib/epub.ts` 源码内字面 NUL 字符

- **提交**：`cfa14ae fix(C-04): epub.ts 源码内字面 NUL 改为 \u0000 转义`；合并 `190bb35`。
- **改动**：`src/lib/epub.ts:335` 模板字符串中 `stableHash(title + "␀" + markdown …)` 的唯一 0x00 字节替换为 6 字符转义 `\u0000`（运行时值不变）。文件 16622 → 16627 B。
- **验收（2026-10-23，Windows）**：
  - 字节计数 → 修改前 1 个 NUL；修改后 0。`file src/lib/epub.ts` 由 `data` 变为 `JavaScript source, Unicode text, UTF-8 text`。
  - `rg -c "u0000" src/lib/epub.ts` → 1。
  - `git diff -- src/lib/epub.ts` → 仅 1 行（`" "` → `"\u0000"`）。
  - `node scripts/run-tests.mjs m6-1` → 修改前 1 通过 / 0 失败；修改后 1 通过 / 0 失败。
  - `npm run typecheck` → exit 0，无新错误。
  - `npm test` → 89 个 **84 过 / 5 败 / 0 超时**；失败集合 = applog、i18n、m1.prompts、m14、m7.prompts，均为已知项；`lensWindow` 时序 flake 本轮通过；无新增失败文件。
- **偏离**：
  - 报告验收写的 `node scripts/run-tests.mjs epub` 命中 **0 个测试**（仓库无文件名含 epub 的套件）；改用直接覆盖 `src/lib/epub.ts` 的 `m6-1`（其文件头明确要求改 epub.ts 后该套件全绿），并以全量 `npm test` 兜底。
  - 报告给出的 `node -e` 命令在 Git Bash 下输出了 `ok`，但未改写文件（NUL 仍为 1、字节数不变）——命令行参数中的 NUL 在 Windows 上被吞。最终用「定位唯一个 0x00 字节并以 ASCII 码 `[92,117,48,48,48,48]` 拼接」的等价手法完成同一变换；diff 与上述验收证明结果与报告要求一致。

### 3.6 C-05 · 两个过期的测试期望（prompt 版本号）

- **提交**：`bc8492d fix(C-05): 制卡族目标版本改为导出常量，更新过期测试期望`；合并 `65ea513`。
- **改动**：
  - `electron/db.js`：函数内 `const TARGET_VERSION = 8;` 提升为模块级 `const CARD_PROMPT_TARGET_VERSION = 8;`（置于 `ensurePromptTemplates` 之前），`seedScope` 内 2 处引用改名；`module.exports` 在 `ensurePromptTemplates` 后导出该常量。
  - `tests/m1.prompts.test.cjs`：P1/P2/P4 中指向当前目标版本的文案与断言改引用 `db.CARD_PROMPT_TARGET_VERSION`（`lit.version`、`gen2.version`、`lit2.version`）。
  - `tests/m7.prompts.test.cjs`：主制卡版本断言（原 `=== 6`）改引用 `db.CARD_PROMPT_TARGET_VERSION`。
  - 模拟旧库夹具按报告保持不变：`OLD-V6-CONTENT` / `OLD-LIT-V6-CONTENT`、v6 行插入、`还原成功：card-generation 停在 v6`、`旧 v6 行保留留痕`。
- **验收（2026-10-23，Windows）**：
  - `node scripts/run-tests.mjs m1.prompts m7.prompts` → **2 通过 / 0 失败**（改动前基线 0 通过 / 2 失败）。
  - 内容断言（R18 / R20 / memoryRef / G9 等）全部通过，未触发报告第 3 步的「内容升版导致断言失败 → 停止回报」。
  - `npm run typecheck` → exit 0。
  - `npm test`（无并行负载）→ 89 个 **85 过 / 4 败 / 0 超时**；失败集合 = applog、i18n、m14、m15v2.route；m1.prompts / m7.prompts 已转绿。
- **偏离**：
  - 首轮全量与 `npm run typecheck` 并行执行，结果为 84 过 / 5 败，多出 `lensWindow` G1（已知时序 flake）与 `m15v2.route`（中位 31.5ms vs 阈值 ≤30ms）；停止并行后的干净全量为 85 过 / 4 败。`m15v2.route` 单独跑通过，且只 import `src/lib/mindmap/v2`、不 require `electron/db.js`，判定为性能阈值 flake，已在 §1.1 登记为未归属。
  - 报告要求「文案中的 v7/v6 改为模板字符串」；只改了指向**当前目标版本**的断言名与日志标题。历史沿革文案（m1 第 1 行「v46/UM-2 升 v7」、P1 中「v6 专用模板」、m7 第 1 行「既有 v6」）与模拟旧库夹具保留原样，避免篡改版本历史与夹具语义。
  - 顺带更正本账 C-06 的过期计数：§1.1 与 §2 原记「各缺 4 键」，本次 i18n 实测输出为 en / ja 各缺 17 键（与报告一致）。

### 3.7 C-06 · i18n：en / ja 各缺 17 个键

- **提交**：`95108e5 fix(C-06): 补齐 en/ja 缺失的 17 个结构图谱与成长记录译文`；合并 `a5aaac1`。
- **改动**：
  - `src/i18n/locales/en.ts`：末尾 `};` 前追加报告给定的 17 条英文译文（含 3 条 `{ one, other }` 复数对象）。
  - `src/i18n/locales/ja.ts`：同位置追加 17 条日文译文。
  - 键与源码 `T("…")` 字面量逐字一致；未改动任何源码组件或 i18n 运行时。
- **验收（2026-10-23，Windows）**：
  - `node scripts/i18n-check.mjs` → `[i18n-check] t() 字面量键 1791 个` / `[i18n-check] OK`，退出码 0（改动前：en 17 + ja 17 缺漏，退出码 1）。
  - `node scripts/run-tests.mjs i18n` → 1 通过 / 0 失败（改动前 0 通过 / 1 失败）。
  - `npm run typecheck` → exit 0。
  - `npm test`（无并行负载）→ 89 个 **87 过 / 2 败 / 0 超时**；失败集合 = applog、m14，均为既有未归属项；无新增失败文件。
  - `node scripts/run-tests.mjs --list | tail -1` → `{"electron-node":55,"electron":27,"system-node":7}`（未新增测试，分布不变）。
- **偏离**：无。

### 3.8 C-45 · 10 条 Electron 流程测试跑完不退出

- **提交**：`b66d345 fix(C-45): Electron 流程测试补显式退出并加防回归闸门`；合并 `b8ebf24`。
- **改动**：
  - 10 个 `@tier 1` 流程（F76 / F77 / F84 / F85 / F86 / F87 / F88 / F89 / F91 / F92）：`.catch(...)` 后补 `.finally(() => setTimeout(() => app.exit(process.exitCode || 0), 200));`，流程逻辑未动。
  - 新增 `tests/flow-exit-guard.test.cjs`：静态扫描 `tests/flows/f*.cjs`，要求所有 `@runtime: electron` 流程出现 `app.exit` / `app.quit` / `quit(`；首行显式声明 `// @runtime: electron-node`（见偏离）。
- **验收（2026-10-23，Windows）**：
  - 改动前锚点命令 → 恰好 10 个文件，与报告清单逐字一致；10 个文件 `tail -5` 均与报告模板一致（无需中止改写）。
  - 改动前 `node tests/flow-exit-guard.test.cjs` → 失败并列出上述 10 个文件；改动后 → PASS。
  - `node scripts/run-tests.mjs flow-exit-guard` → 1 通过 / 0 失败（94ms，electron-node）。
  - `node scripts/run-tests.mjs --list | tail -1` → `{"electron-node":56,"electron":27,"system-node":7}`（90 个，符合报告 89 → 90）。
  - `node tests/flows/run.cjs --only F76,F84,F92 --cycles 1` → **F76 PASS 1537ms 8/8、F84 FAIL 1303ms 3/4、F92 PASS 1114ms 6/6**；命令墙钟 4s，无 `RETRY` 行，三条均远低于 60 秒。
  - 额外把其余 7 条同批文件各跑 1 轮：F77 PASS 7/7（1.9s）、F85 PASS 4/4、F86 FAIL 3/4（18.6s）、F87 PASS 2/2（93.1s）、F88 FAIL 3/4、F89 PASS 5/5、F91 PASS 12/12；7 条总计 118s，全部自行退出，无 `RETRY`。F87 的 93s 是其持久化延迟测量本身，不是空等。
  - `npm test` → 90 个 **87 过 / 3 败 / 0 超时**；失败集合 = applog、lensWindow（G1 时序 flake，直跑复现）、m14；无新增失败文件。
  - `npm run typecheck` → exit 0。
- **偏离**：
  1. **guard 测试首行加了 `// @runtime: electron-node`**。报告给的代码首行注释含字面 `@runtime: electron`，C-01 的 `classify()` 读前 5 行，会把纯文件扫描测试误判为真实 Electron 运行时；实测该分类会启动完整 Electron（含 GPU / network 子进程）并永不退出，正是 C-45 的症状，runner 需人工停止。显式头使其落到 electron-node，测试语义不变。
  2. 报告验收只要求 F76 / F84 / F92；额外把 10 个文件全部跑过一轮，用于证明每条都自行退出（见上）。
  3. F84 的 3/4 是流程内 S4 行为断言（`pendingToday` 与队列实发差额 2 / 3 / 2），即已登记的 **D-TEST-88**（测试战役记录逐字一致）；F86 / F88 的 3/4 与 2026-09-24 旧结果一致。三者均发生在退出之前，与本次收尾改动无关，不是新增失败。
  4. 改动前基线（同机 89 个）为 87 过 / 2 败（applog、m14）；改动后全量因 `lensWindow` G1 flake 落到 87 过 / 3 败，失败集合无新增文件。

### 3.9 C-08 · `bookasset://` 协议路径穿越

- **提交**：`3081287 fix(C-08): bookasset 路径穿越收口为纯函数校验，pdfres 补目录包含检查`；合并 `7bb6809`。
- **改动**：
  - 新建 `electron/bookassetPath.js`：`resolveBookassetPath(userData, requestUrl)` 纯函数；itemId `^[A-Za-z0-9_-]{1,128}$`、filename `^[A-Za-z0-9_-][A-Za-z0-9._-]{0,254}$`；`path.resolve` 后要求落在 `userData/assets` 内，非法返回 `null`。
  - `electron/main.js`：bookasset handler 改用该函数；`types` 表提为 handler 外的 `BOOKASSET_TYPES`（内容原样）；读取由同步 `readFileSync` 改为 `fs.promises.readFile`。
  - `electron/main.js` pdfres handler：按报告第 3 步补 `path.resolve` + `startsWith(root + sep)` 包含校验（filename 仍走原 `^[A-Za-z0-9._-]+$` 白名单）。
  - 新建 `tests/bookasset-path.test.cjs`：报告给定的 2 正例 + 6 反例，默认 electron-node 运行时。
- **验收（2026-10-23，Windows）**：
  - TDD：先落测试 → `node scripts/run-tests.mjs bookasset-path` 失败（`MODULE_NOT_FOUND: ../electron/bookassetPath`）；实现后 → **1 通过 / 0 失败**（87ms）。
  - 真实 Electron 协议探针（临时脚本，已删）：`net.fetch` 合法路径 → 200 `image/png`；`bookasset://../secret.txt`、`bookasset://%2e%2e/secret.txt`、`bookasset://<id>/..%2Fsecret.txt`、`.hidden`、`a.b/<file>` → 全部 400；缺失文件 → 404；响应中无 `TOP-SECRET` 泄漏。
  - 真实应用隔离 GUI 探针（临时脚本，已删；`M7_TEST_USERDATA` 指向 `tests/tmp-d161-userdata` 的副本）：书架 1 张 `.cover-img` + 5 张文件夹纸片背景全部从 `bookasset://` 加载成功（naturalWidth 400），遮挡图 `occl-*.png` 160×90 加载成功；渲染层 `fetch("bookasset://../settings.json")` → 400；截图目视确认封面正常显示。
  - `node scripts/run-tests.mjs --list | tail -1` → `{"electron-node":57,"electron":27,"system-node":7}`（91 个，符合报告 90 → 91）。
  - `npm run build` → 成功；`npm run typecheck` → exit 0。
  - `npm test` → 91 个 **88 过 / 3 败 / 0 超时**；失败集合 = applog、m14、m15v2.route（性能阈值 flake，中位 30.7ms vs ≤30ms），均为既有项；新增测试通过，无新增失败文件。
- **偏离**：
  1. 报告验收写 `npm run build && npx electron .` 后检查真实库；按报告 §0 第 3 条改为隔离 userData（既有测试种子副本）启动真实应用的 GUI 探针，未触碰真实 userData。书架封面 / 文件夹纸片 / 遮挡图均实测加载并目视确认。
  2. 「词典发音」在当前代码中不经 `bookasset://`：`src/lib/dictClient.ts` 的 `playAudioUrl` 直接播放词典服务 URL，缺失时走系统 TTS；全仓无 `dict-audio` 资产构造（只有 MIME 表保留音频类型）。因此无 bookasset 音频路径可复测，`mp3/ogg/wav/m4a` 映射原样保留。
  3. pdfres 的 `filename=".."` 原可通过旧白名单，但 `readFileSync` 读目录必抛错（落到 404）；本次按报告第 3 步补包含校验后显式返回 400，属加固。
  4. 全量中 `m15v2.route` 复现性能阈值 flake；该测试不 require `electron/main.js`，与本项无关（见 §1.1）。
  5. 临时探针与隔离 userData 均已清理，未入库；提交只含 3 个源文件。

### 3.10 C-09 · 渲染页面无 CSP + 无权限请求处理器

- **提交**：`ff3b448 fix(C-09): 构建期注入 CSP，权限请求默认拒绝，foliate 剔除脚本`；合并 `2400489`。
- **改动**：
  - 新建 `src/lib/cspPolicy.ts`：`CSP_DIRECTIVES` / `CSP_POLICY`（唯一策略源）与 `cspPlugin()`（`apply: "build"`，`transformIndexHtml` 在 `<head>` 后注入 meta）。
  - `vite.config.ts`：`plugins: [react(), cspPlugin()]`。
  - 新建 `src/lib/cspReport.ts`：`securitypolicyviolation` 监听，`console.warn` + `logsAPI.report({ kind: "console", message })`；同一违规去重、上限 20 条；四个入口首行 `import "./lib/cspReport"`（main / lens / workbench / capture）。
  - 新建 `electron/permissions.js`：`ALLOWED_PERMISSIONS = { "clipboard-sanitized-write" }`；`installPermissionHandlers(session)` 同时设置 request 与 check 处理器，拒绝时输出 `[perm] denied <name>`。
  - `electron/main.js`：`whenReady` 内、`createWindow()` 前安装权限处理器；新增 `app.on("web-contents-created")` + `console-message` 兜底日志（只记含 `Content Security Policy` 的消息，排除 Electron 的 Insecure-CSP 开发警告）。
  - `src/lib/reader/foliate/adapter.ts`：`load` 事件里 `stripActiveContent(doc)` 删除 `script` 与所有 `on*` 属性（纵深防御）。
  - 新增 `tests/csp-policy.test.cjs`（electron-node）、`tests/csp-enforcement.test.cjs`（electron）。
- **验收（2026-10-23，Windows；Electron 31.7.7）**：
  - `npm run build` → 成功；`rg -c "Content-Security-Policy" dist/index.html dist/lens.html dist/workbench.html dist/capture.html` → 各 `1`。
  - `rg -o "new Function\(|(^|[^A-Za-z0-9_$])eval\(" dist/assets/*.js` → `new Function(` 1 处（`main-*.js` 的 setImmediate polyfill 字符串回调分支）、`eval(` 0 处；真实应用探针运行期 `window.__fnCalls() = 0`（走过 EPUB / PDF / 设置页后），该分支未被调用。
  - `node scripts/run-tests.mjs csp-policy csp-enforcement` → **2 通过 / 0 失败**。`csp-enforcement` 直跑 **10/10**：对照窗口（无 CSP）同一 blob iframe 内联脚本会执行；CSP 下同源外部脚本照常执行、blob iframe 内联脚本与主文档动态内联脚本被拦、`securitypolicyviolation` 可捕获 `script-src`、权限从默认 granted 差分到 denied、聚焦窗口 `clipboard.writeText` 仍 ok。
  - `node scripts/run-tests.mjs --list | tail -1` → `{"electron-node":58,"electron":28,"system-node":7}`（93 个；报告 91 → +2）。
  - `npm run typecheck` → exit 0。
  - `npm test`（无并行负载）→ 93 个 **91 过 / 2 败 / 0 超时**；失败集合 = applog、m14（均为既有未归属项），新增 CSP 测试通过，无新增失败文件。
  - 真实应用隔离 GUI 探针（临时脚本，已删；`M7_TEST_USERDATA` 指向 `%TEMP%\incremental-reading-flows\flow-c09-csp-userdata`）→ **18/18**：
    * 带 `<script>` 与 `onclick` 的 EPUB：正文渲染出 “Scripted chapter”；父窗口未收到 `PWNED-C09`；应用日志恰有 1 条 `[CSP] ... "script-src 'self' 'wasm-unsafe-eval'"`；CDP isolated world 读到 script 数 0、`data-pwned` / `data-clicked` 均为 null（适配器清理生效）。
    * 书架封面经 `bookasset://` 在 CSP 下 `naturalWidth > 0`；PDF（150 页）pdf.js canvas 正常渲染；设置页可打开；lens / workbench 窗口在 CSP 下 `#root` 正常挂载。
    * 主流程日志无其他 `[CSP]` 记录。截图：`tests/flows/results/c09-epub.png`、`c09-settings.png`、`c09-pdf.png`（目视确认正文 / PDF 正常）。
- **偏离**：
  1. 策略提取为 `src/lib/cspPolicy.ts`（报告为 `vite.config.ts` 内联），同时供测试复用；渲染包不含该常量（`rg "nutation-csp|CSP_DIRECTIVES" dist/assets/*.js` → 0）。
  2. `media-src` 在报告基础上加 `https:`：在线词典真人发音（`settings.app.dictAudioSource="online"` 时渲染层 `new Audio(url)` 直连 dictionaryapi.dev 的 https 音频）。报告验收允许「按被拦截资源类型补充指令并写明原因」；`img-src https:` 仍按报告保留（决策 D-08 未答复）。
  3. 报告第 2 步的 `logsAPI.write("warn", ...)` 不存在（preload 只有 `openFolder` / `report`）；改用现有 `logsAPI.report({ kind: "console" })` 转发，保留 `console.warn`。
  4. 新增主进程 `console-message` 兜底日志：实测 `securitypolicyviolation` 只在违规文档触发、不冒泡到父文档，报告第 2 步的渲染层上报无法记录 EPUB blob iframe 的违规；兜底把 Chromium 拒绝消息（含 `script-src`）写入 `main.log`。
  5. 权限处理器提取到 `electron/permissions.js`（报告为 main.js 内联），便于纯逻辑矩阵测试；`session.defaultSession` 覆盖四窗口（全仓无自定义 partition）。
  6. foliate 的 `load` 事件在 iframe 解析完成之后才触发，**不能**阻止首屏内联 `<script>` 执行；真实拦截靠 CSP。适配器清理只覆盖 load 后仍可触发的 `on*` 与再插入脚本（报告称「第二道防线」，此处明确其时序边界）。
  7. capture 窗口未实测：D159 已设 `CAPTURE_DISABLED`（快速记录暂停），窗口不会创建；`dist/capture.html` 的 CSP 由构建验收 + `csp-policy` 注入契约覆盖。主题插件切换与在线词典发音未实测（隔离 userData 无插件 / 词典）；策略已为 `style-src 'unsafe-inline'`、`media-src https:` 预留。
  8. 构建注入未做成「读取 dist」的回归测试（需先构建）；注入逻辑由 `csp-policy` 的 `transformIndexHtml` 契约测试 + 验收命令覆盖。
  9. `tests/tmp-c09/` 为测试临时打包产物（`tests/tmp-*` 忽略）；探针脚本与隔离 userData 已清理，未入库。

## 4. 每项收尾时必须更新本账本

1. 把对应行状态改为 **完成**（或 **中止** / **部分**）。
2. 填 `提交 / 合并`：`fix(C-xx)` 的 hash / `--no-ff` 合并提交 hash。
3. 在 §3 增加该小节：改动文件、验收命令与结果、偏离说明。
4. 若基线失败集合发生变化，更新 §1.1 与 `§1 当前状态`。
5. 更新顶部 `本账建立时 main HEAD` 和 `更新时间`（或改为最近一次执行项的 main HEAD）。
6. 若新增测试 / 新文件改变了 `--list` 分布，同步记录实际值，不要硬套报告数字。

## 5. 给下一次会话的最短入口

- 报告：`C:\Users\xiongdy\Desktop\report_confirmed.md`；只读 §0、§3 和目标 C-xx 小节。
- 进度：本文件 + `git log --grep 'C-xx'`。
- 当前下一项：**C-10**（阶段 1 首发前必须完成，P0；依赖 C-01，已完成）。
- 基线：93 个测试；C-09 后全量 91 过 / 2 败（Windows，2026-10-23；applog、m14，见 §1.1）。
