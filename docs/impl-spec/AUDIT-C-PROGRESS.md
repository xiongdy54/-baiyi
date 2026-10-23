# C 项审计修复进度账

> **报告（只读）**：`C:\Users\xiongdy\Desktop\report_confirmed.md`（303 KB，3658 行，48 项 C-01…C-48）。
> **本账本**：只记状态、提交/合并、验收摘要、偏离；标题、根因、修复步骤与验收标准一律以报告 §2 / §3 / 对应 C-xx 小节为准。
> **更新时间**：2026-10-24。**本账最近更新时 main HEAD**：`b86659c`（C-16 合并）。

## 0. 执行规则（摘要，完整规则见报告 §0）

1. **一次会话只做一项 C-xx**；一项一提交，提交信息 `fix(C-xx): 简述`；验收通过后 `git merge --no-ff` 回 main（本仓无远程）。
2. **报告只读**。按 §0、§3、目标 C-xx 小节分段读，不要整份读入（超过 Read 工具上限）。
3. **先跑基线再改，再跑验收**。失败数不得多于本项开始前的基线，且失败集合不得新增文件；新增失败必须查明归属并在本账本记录。
4. **绝不触碰真实 userData**（`%APPDATA%\incremental-reading-dev` / `~/.config/incremental-reading-dev` / `~/Library/Application Support/incremental-reading-dev`）；测试用 `fs.mkdtempSync` + `app.setPath("userData", dir)`。
5. **不升级依赖**（除 C-24、C-41）；不运行 `npm audit fix --force`；不删除已有测试（期望过期只按 C-05 更新）。
6. **测试副产物**：`tests/*.bundle.cjs`、`tests/.results/`、`tests/tmp-*` 可能变脏；提交用显式路径，不要 `git add -A`。
7. **锚点优先**：报告行号只作参考；先 `rg -n "锚点"` 定位，找不到或代码与描述不一致时停下，按 §0 第 7 条回报。

## 1. 当前状态（2026-10-24）

- **报告快照对齐**：报告是在 `feat/floating-atlas-d203`（D203/D204 纸片图谱）功能分支的打包提交上产出的。该分支已于 2026-10-23 以 `--no-ff` 合入 main：`dde0a81`（分支 HEAD `1267cad`，32 文件 +6590/−509）。C-45 前 main 与报告快照的 89 个测试规模一致；C-45 与 C-08 按报告预期各新增 1 个测试、C-09 新增 2 个、C-10 新增 1 个，现为 94 个。
- **D203/D204 功能状态**：代码已进 main，但 **D204 实机 UX 仍未验收**（用户反馈「效果还是不好」；D205 窗内 morph 已实机否决并还原到 `1267cad`）。C-31/C-32/C-33 的 lensWindow 锚点现在存在，但仍按报告执行，不要假定该功能已验收。
- **测试规模**：99 个 `tests/*.test.cjs`，分布 **61 electron-node / 30 electron / 8 system-node**（C-45 guard、C-08 `bookasset-path`、C-09 `csp-policy` 落在 electron-node；C-09 `csp-enforcement` 与 C-10 `schema-version`、C-15 `settings-file` 落在 electron；C-11 `userData` 与 C-12 `backup-zip64` 落在 electron-node；C-13 `restore-flow` 落在 electron-node）；报告基线为 89 个，C-45 / C-08 / C-09 / C-10 / C-11 / C-12 / C-13 各按报告预期 +1 / +1 / +2 / +1 / +1 / +1 / +1。C-12 的 `backup-zip64` **默认跳过**（`NUT_BIG_TESTS=1` 时运行，普通全量不计入失败）。**测试基数更正**：C-14 后记为 97，实际 98——`settings-notices.test.cjs`（system-node）随 D206 批次合入，非审计项改动；C-15 新增 `settings-file.test.cjs`（electron）后为 **99 个 = 61 electron-node / 30 electron / 8 system-node**。
- **本机 Windows 基线（2026-10-23，C-02 前）**：`npm test` → **89 个：82 过 / 7 败 / 0 超时**；结果写入 `tests/.results/latest.json`。C-02 后两次全量均为 **81 过 / 8 败**，多出的 `lensWindow` G1 是时序 flake（见 §1.1），其余 7 败归属不变。**C-03 后一次全量为 83 过 / 6 败**：两个 artifact 失败已消除，`lensWindow` G1 本轮回落到失败集，其余 5 败归属不变。**C-04 后一次全量为 84 过 / 5 败**：`lensWindow` 本轮通过，其余 5 败归属不变，无新增失败文件。**C-05 后全量为 85 过 / 4 败**：m1.prompts / m7.prompts 转绿；失败集合 = applog、i18n、m14、m15v2.route（性能阈值 flake，单独跑通过；与 `tsc` 并行的首轮另有 `lensWindow` G1）。**C-06 后全量为 87 过 / 2 败**：i18n 转绿；失败集合 = applog、m14（均为既有未归属项）；`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。**C-45 后全量为 90 个 87 过 / 3 败**：guard 测试通过；多出的 `lensWindow` G1 是时序 flake（直跑复现），失败集合 = applog、lensWindow、m14，无新增失败文件。**C-08 后全量为 91 个 88 过 / 3 败**：新增 `bookasset-path` 通过；失败集合 = applog、m14、`m15v2.route`（性能阈值 flake，中位 30.7ms vs ≤30ms，与本项无关），`lensWindow` 本轮通过，无新增失败文件。**C-09 后全量为 93 个 91 过 / 2 败**：新增 `csp-policy` / `csp-enforcement` 均通过；失败集合 = applog、m14（均为既有未归属项）；`lensWindow` 与 `m15v2.route` 本轮通过，无新增失败文件。**C-10 后全量为 94 个 92 过 / 2 败**：新增 `schema-version` 13 断言全过；失败集合 = applog、m14（均为既有未归属项），`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。**C-11 后两轮全量均为 95 个**：首轮 91 过 / 3 败 / 1 超时（applog、lensWindow G1 flake、m14 + `card-links` 超时）；复跑钉定脚本后单独跑 `card-links` 通过（840ms），干净第二轮 **92 过 / 3 败 / 0 超时**（applog、lensWindow G1、m14，无新增失败文件）。**C-12 后全量为 96 个 94 过 / 2 败 / 0 超时**（applog、m14，均为既有未归属项）；`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。**C-13 后一次全量为 97 个 96 过 / 1 败 / 0 超时**：**m14 转绿**（EBUSY 复核修复 + 过期期望更新，见 §3.14），失败集合仅剩 applog（既有未归属项）；`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。**C-14 后一次全量为 97 个 95 过 / 2 败 / 0 超时**：失败集合 = applog（既有未归属项）+ `m15v2.route`（性能阈值 flake，单独复跑通过，与备份改动无关）；`lensWindow` 本轮通过，无新增失败文件。**C-15 前基线（2026-10-24，含 D206 批次）为 98 个 96 过 / 2 败**（applog、`m15v2.route`）；**C-15 后最终树复跑 99 个 97 过 / 2 败 / 0 超时**，失败集合与基线一致，无新增失败文件。**C-16 后一次全量为 99 个 98 过 / 1 败 / 0 超时**：唯一失败 = applog（既有未归属项）；`m15v2.route` 本轮通过，无新增失败文件。
- **报告 Linux 基线**：89 个 66 过 / 23 败（见报告 §1.3 / 附录 C）。跨平台比较以本机实测为准，并在回报中注明平台。
- **已完成**：C-07、C-01、C-02、C-03、C-04、C-05、C-06、C-45、C-08、C-09、C-10、C-11、C-12、C-13、C-14、C-15、C-16。
- **下一项**：**C-17**（`persist()` 把已提交的写入误报为失败；P2；无依赖）。
- **D-02 决策记录（2026-10-23，用户在本会话逐项确认）**：发布仓库冻结为 **xiongdy54/Nutation**（本地 origin 已指向它，实测可访问）；appId = **io.github.xiongdy54.nutation**（Flathub 对 GitHub 托管应用的强制命名，为上 Flathub 留后路）；对外 productName = **Nutation**（沿用 D187 既定名）；package.json author = **xiongdy54 + `152503729+xiongdy54@users.noreply.github.com`**（GitHub noreply，零真实信息暴露；数字 ID 经 `github.com/<user>.png` 跳转实测）。另确认：LICENSE 已是 PolyForm Noncommercial 1.0.0（不影响作者本人将来商业化）；代码签名属 C-30，本项不涉及。

### 1.1 已知失败与归属（2026-10-23，Windows）

| 测试文件 | 归属 | 说明 |
| --- | --- | --- |
| `tests/applog.test.cjs` | 待确认 | 报告 U-28 曾标为 Linux/Xvfb 环境差异；Windows 仍失败，暂不归属到 C-01。2026-10-23 复核：本机宿主全局注入 `ELECTRON_RUN_AS_NODE=1`，第 11 节 spawn 的 Electron 子进程继承该变量后以 Node 身份启动（`app` undefined），故无崩溃日志；C-09 改动前基线同样失败，与本项无关（runner 对 electron-node 运行时本身也设置该变量，属于测试脚手架的宿主环境差异）。 |
| `tests/d111-artifact.test.cjs` | 已修复（C-03） | Windows CRLF 导致产物逐字节比较失败；C-03 改为规范化后比较并通过。 |
| `tests/i18n.test.cjs` | 已修复（C-06） | en / ja 各缺 17 个键；C-06 补齐后 `i18n-check` 退出码 0、测试转绿。 |
| `tests/lensWindowFit.artifact.test.cjs` | 已修复（C-03） | D203 合并后新增；现场重打包 7053 B vs 仓库 7224 B，差值 171 B；C-03 改为规范化后比较并通过。 |
| `tests/lensWindow.test.cjs` | 未归属（时序 flake） | C-02 后两次全量均失败于 G1（55ms 采样 180ms 缓动）；该文件与 `electron/lensWindow.js` 未被 C-02 改动，单独连跑 3 次 1 过 2 败。C-04 全量本轮通过；C-05 与 `tsc` 并行的首轮复现，随后单独跑与干净全量均通过。C-45 全量复现（G1），直跑同样 1 败；本项只改 `tests/flows` 与新增 guard，与该文件无关。C-08 全量本轮通过。 |
| `tests/m1.prompts.test.cjs` | 已修复（C-05） | prompt 版本期望 7，实际 8（过期期望）；C-05 改为引用 `db.CARD_PROMPT_TARGET_VERSION` 并通过。 |
| `tests/m14.test.cjs` | 已修复（C-13） | D137 后主库是 better-sqlite3 原生连接，Windows 上连接不关 rename `library.db -> .pre-restore` 必 EBUSY；真实路径 `applyPendingRestore` 在启动期 initDb 之前执行、从无此占用。C-13 让测试对齐真实时序（先 `closeDb` 再换入再 `initDb`）；随之暴露 M14-13 的过期期望 `version === 7`（该段此前因 EBUSY 中断从未执行到），按 C-05 手法改引用 `db.CARD_PROMPT_TARGET_VERSION`。 |
| `tests/m15v2.route.test.cjs` | 未归属（性能阈值 flake） | C-05 全量中位 30.5ms vs 阈值 ≤30ms（最快 26.2 / 最慢 32.9）；单独跑通过。该测试只 import `src/lib/mindmap/v2`，不 require `electron/db.js`，与 C-05 改动无关。C-08 全量复现（中位 30.7ms，最快 28.4 / 最慢 33.3）；不 require `electron/main.js`，与本项无关。C-15 前基线（98 个）与最终树复跑（99 个）均复现（中位 48.4ms，全程并行负载），与本项无关。 |
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
> C-10 后：全量 94 个 **92 过 / 2 败**（applog、m14）；新增 `schema-version` 通过，无新增失败文件。`m15v2.dbstatic` 曾因静态守卫断言旧 ALTER 字面量短暂转红，随本项同步更新为新契约后转绿（不是产品缺陷）。

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
| 11 | C-10 | 完成 | `b20d4dd` / `d1735e8` | user_version + 事务化 MIGRATIONS + 迁移前快照 + app_meta；验收见 §3.11。 |
| 12 | C-11 | 完成 | `e3b6aa5` / `7647752` | D-02 已答复（见 §1 决策记录）；userData.js 纯函数化；验收见 §3.12。 |
| 13 | C-12 | 完成 | `83b318c` / `b75c31d` | 备份/恢复流式化（yazl/yauzl，ZIP64）；验收见 §3.13。 |
| 14 | C-13 | 完成 | `dc9a2a8` / `00d7a66` | relaunch 走 quit / learner.db 换库让位 / 设备设置保留；m14 EBUSY 已复核修复，验收见 §3.14。 |
| 15 | C-14 | 完成 | `96cfb7a` / `7b1c4dc` | 轮换 protect + clockSkewSuspected；验收见 §3.15。 |
| 16 | C-15 | 完成 | `17384fc` / `4f80aa1` | settings.json 两份实现合并到 jsonFile；验收见 §3.16。 |
| 17 | C-16 | 完成 | `d063014` / `b86659c` | 撤销评分不回落；验收见 §3.17。 |
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

### 3.11 C-10 · 数据库 schema 版本化 + 事务化迁移 + 迁移前快照

- **提交**：`b20d4dd fix(C-10): schema 版本化 + 事务化迁移 + 迁移前快照`；合并 `d1735e8`。
- **改动**：
  - 新建 `electron/schemaVersion.js`：`SCHEMA_VERSION = 2`；`MIGRATIONS` v2 = `app_meta(key,value,updated_at)`；`DbTooNewError`（code `DB_TOO_NEW`）；`readUserVersion` / `assertNotTooNew` / `snapshotBeforeMigration` / `runMigrations`（每项一个事务 + 同事务写 `user_version`，版本必须连续）。
  - `electron/db.js`：开库后先 `assertNotTooNew`（库比程序新 → 关库抛出，不写任何东西）；已有数据且版本落后 → `db.backup()` 快照到 `userData/backups/pre-migration/`（保留最近 3 份）；基线代码块首行加冻结横幅；24 处 `ALTER TABLE … catch` 全部改为 `addColumnIfMissing`（`pragma_table_info` 显式探测，标识符加引号）；末尾写 `user_version = 1` 后执行 `runMigrations`，再 `migrateSettingsFactsToAppMeta`（`fsrsConfigId` / `legacyBackfillV1` 从 settings 复制进 `app_meta`）。
  - `electron/legacyBackfill.js`：标记读 `app_meta` 优先、旧库回落 settings；`mark()` 经注入的 `writeAppMeta` 只写 `app_meta`（未注入时保持设置存储，兼容纯单测）。
  - `electron/main.js`：`initDb()` 外捕获 `DB_TOO_NEW` → `dialog.showMessageBoxSync` 提示「数据版本过新」+ 数据文件夹，`app.exit(1)`；其他错误原样上抛。
  - `electron/backup.js`：`restoreBackup` 解包后以只读连接读 staging 的 `user_version`，大于 `SCHEMA_VERSION` → 删 staging、返回「该备份来自更新版本的 Nutation，请先升级程序再恢复」；打不开也删 staging 并返回可读错误。
  - 新增 `tests/schema-version.test.cjs`（`@runtime: electron`，5 场景 13 断言）。
  - `tests/legacyBackfill.test.cjs` P5 改为从 `app_meta` 读/清标记；`tests/m15v2.dbstatic.test.cjs` 的两条静态守卫从「ALTER 字面量」改为「addColumnIfMissing 契约」，并新增 helper 定义断言。
- **验收（2026-10-23，Windows；Electron 31.7.7）**：
  - 改动前基线：`npm test` → 93 个 91 过 / 2 败（applog、m14）。
  - `node scripts/run-tests.mjs schema-version` → **1 通过 / 0 失败**；直跑 **13/13**：新库 `user_version = 2` 且无快照；`user_version = 3` → `DB_TOO_NEW` 且库文件 sha256 不变；v0 旧库升级 → 1 份 `library-v0-to-v2-*.db`、快照 `quick_check = ok`；二次 `initDb` 不新增快照；连续 5 次旧库升级 → 快照恰为 3 份。
  - `node scripts/run-tests.mjs --list | tail -1` → `{"electron-node":58,"electron":29,"system-node":7}`（94 个）。
  - `npm test`（无并行负载）→ 94 个 **92 过 / 2 败 / 0 超时**；失败集合 = applog、m14（均为既有未归属项）；`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。
  - `npm run typecheck` → exit 0。
  - **真实开发库拷贝升级**（临时探针，已删；原库只读 `db.backup()` 到隔离 userData，启动后 6/6）：`user_version 0 → 2`；生成 1 份 v0→v2 快照且 `quick_check = ok`；`app_meta` 有 `legacyBackfillV1` 与 `fsrsConfigId`；`main.log` 无 db 错误；**原库 sha256 前后一致**（未触碰）。
  - **恢复版本闸门**（临时探针，已删）：`user_version=99` 的备份 → `ok:false` + 「更新版本」且 staging 已删；`user_version=0` 的备份 → `ok:true` + staging 落盘（正反对照）。
  - 历史流程抽查：**F43** 的 P0-1（库内 schema 版本判据）由红转绿（`user_version = 2`）；**F50** 仍红 3 项（见偏离 6）。
- **偏离**：
  1. **迁移执行点**：报告要求放在「legacy 回填与最后一次 `persist()` 之后、`return` 之前」。实际顺序为 `legacy 回填 → ensurePromptTemplates → persist → user_version=1 → runMigrations → 搬 settings 事实 → mark()`。唯一差异是 `mark()` 移到迁移之后：v2 迁移才建 `app_meta`，标记必须在表存在后落库，否则首次升级会把标记写回 settings（报告要求「写标记只写 app_meta」）。
  2. `addColumnIfMissing` 对表名/列名加双引号（报告示例未加）。这是报告第 4 步「942 行列名带双引号，传入时去掉引号再在 SQL 中加回」的必要实现；`trigger` 是 SQLite 关键字。
  3. `writeAppMeta` 在 `app_meta` 尚不存在时回落 settings（基线 v23 `fsrsWeights` 迁移会先调 `setActiveFsrsConfig`）。迁移完成后正常写入只落 `app_meta`；随后 `migrateSettingsFactsToAppMeta` 把 settings 里的旧值复制进库。
  4. `fsrsConfigId` 按报告「复制进 app_meta」，未删除 settings 中的旧副本；读取侧以 `app_meta` 优先。这样 F43 C2a-3（迁移后 settings 里仍有指针）保持原样，旧版代码也有回落值。
  5. 测试契约同步：`legacyBackfill.test.cjs` P5 的标记读写改查 `app_meta`（追加读/清 helper，断言数不变）；`m15v2.dbstatic.test.cjs` 两条静态守卫原样钉住旧 ALTER 字面量，改为 `addColumnIfMissing` 契约并 +1 条 helper 定义断言。未删除任何测试。
  6. **流程侧观察（非 C-10 回归）**：F43 A2b-1 仍红（`database disk image is malformed`），已用最小探针确认是 D137（2026-10-12 起 better-sqlite3）后既有夹具问题——F43 用 sql.js 覆盖仍被旧连接占用的库文件，按旧顺序先执行 `journal_mode = wal` 也同样首读即 malformed；失败发生在 C-10 新增的 pragma 读取之前，与本项无关。F43 的 P0-4（settings 格式版本键）与 A4/A5 不在 C-10 范围。F50 的 S3/S4/S5 仍未绿：剩余盲吞站点都在非 ALTER 的建表/回填/backup.js，C-10 只按报告消除 ALTER 吞错；S2 的 `pragmaTableInfo` 探针为正则 `PRAGMA table_info`，不匹配 `pragma_table_info()` 表值函数（`columnHelper` 已识别 `addColumnIfMissing`）。
  7. 临时探针与隔离 userData 均已删除，未入库；提交只含 8 个源/测试文件。

### 3.12 C-11 · 冻结发布身份：appId / productName / userData 目录 / 发布仓库

- **决策 D-02（本项前置，用户 2026-10-23 逐项确认）**：发布仓库 `xiongdy54/Nutation`；appId `io.github.xiongdy54.nutation`；productName `Nutation`；author `xiongdy54` + GitHub noreply 邮箱。详见 §1 决策记录。
- **提交**：`e3b6aa5 fix(C-11): 冻结发布身份 appId/productName/userData 目录/发布仓库（D-02 已答复）`；合并 `7647752`。
- **改动**（18 文件）：
  - 新建 `electron/userData.js`：`resolveUserData({ appData, isPackaged, existsSync, renameSync })` 纯函数——目标 `<appData>/Nutation`（打包）或 `Nutation-dev`（开发）；旧目录 `incremental-reading-dev` 存在且目标不存在时整目录改名迁移，改名抛错则回退旧目录并带出 error。
  - `electron/main.js`：`pinUserData()` IIFE（M7_TEST_USERDATA → NUTATION_USER_DATA → resolveUserData，M7 优先且命中即跳过迁移）；`setAppUserModelId(NUTATION_APP_ID)` 与 appId 统一。
  - `electron-builder.yml`：appId / productName=Nutation / publish owner=xiongdy54 repo=Nutation / `artifactName: Nutation-${version}-win-${arch}-setup.${ext}`；冻结注释更新（数据目录由 pinUserData 固定、与 productName 解耦）。
  - `package.json`：`name: nutation` + productName / description / author / homepage / repository；`npm install --package-lock-only` 同步 lock（diff 仅 2 个 name 字段 + C-01 engines 补录）。
  - `electron/backup.js`：`APP_TAG` 加冻结注释，值不改。
  - 测试/脚本不再默认指向真实 userData，改 `NUTATION_USER_DATA` 必填、缺省报错退出：`tests/m4.cleanup.cjs`、`tests/fsrstest.cleanup.cjs`（FSRSTEST_USERDATA 优先保留）、`tests/fsrs/audit.cjs`、`scripts/mindmap-profile.cjs`、`tests/flows/f49b-realdata-gui.cjs`、`tests/m2.gui.mjs`、`tests/m6-1/m6-2/m6-2native/m6-3.gui.mjs`。
  - `scripts/run-tests.mjs`：`runOne` 为每个测试注入 `NUTATION_USER_DATA = fs.mkdtempSync(...)`，close 后 `rmSync`（maxRetries 5）。
  - 新增 `tests/userData.test.cjs`（electron-node，6 场景）。
- **验收（2026-10-23，Windows；Electron 31.7.7）**：
  - 迁移三条路径（dev 新装 / 打包新装 / 改名迁移 / 目标已存在不改名 / 注入 EBUSY 回退 / **Windows 真实占用差分**：better-sqlite3 只读连接占住 `legacy/library.db` → 真实 `renameSync` 失败回退旧目录，连接关闭后同一改名成功——证明失败确由占用引起）：`node scripts/run-tests.mjs userData` → 1 通过 / 0 失败（123ms）。
  - 真实应用启动冒烟（临时探针，已删；`NUTATION_USER_DATA` 指向临时目录）→ **4/4**：library.db 建在该目录、main.log 落在该目录、日志无迁移失败、二次启动复用同目录（追加第二会话头）。
  - `npm run build` 无需（dist 既有）；`npx electron-builder --dir --publish never` 成功（包内 `Nutation.exe`）；完整 NSIS `npx electron-builder --win --publish never` → `release/win-unpacked/resources/app-update.yml` = `owner: xiongdy54 / repo: Nutation / provider: github`；安装包 `release/Nutation-0.0.1-win-x64-setup.exe`（121 MB）。
  - `node scripts/run-tests.mjs --list | tail -1` → `{"electron-node":59,"electron":29,"system-node":7}`（95 个，报告 94 → +1）。
  - `npm run typecheck` → exit 0。
  - `npm test` 两轮：首轮 91 过 / 3 败 / 1 超时（`card-links` 超时，见偏离 5）；复跑钉定脚本后干净第二轮 **92 过 / 3 败 / 0 超时**，失败集合 = applog、lensWindow（G1 时序 flake）、m14，无新增失败文件。
- **偏离**：
  1. **pinUserData 提取为 `electron/userData.js` 纯函数**（报告要求内联在 main.js）。原因：实测 **Windows 上 Electron 的 `app.getPath("appData")` 不跟随 `%APPDATA%` 环境变量**（设了仍返回真实 Roaming，探针实证）——报告验收设想的「沙箱 APPDATA 迁移实测」在本机不可行，这也正是本仓一直用 `M7_TEST_USERDATA` 自定义开关隔离的原因。纯函数化（fs 可注入）+ fs 级测试（含真实占用差分）覆盖报告三条验收路径，且满足执行规则 4（绝不触碰真实 userData）。真实应用侧用 NUTATION_USER_DATA 启动冒烟补接线验证。
  2. **报告验收 1/2（真实迁移 / 真实占用下启动）改由单元测试覆盖**，未在真实 `%APPDATA%` 上演练迁移——用户自己的下次 dev 启动会触发真实改名迁移（这正是特性）；日志若出现「迁移失败，继续使用旧目录」属预期回退，数据不丢。
  3. **app-update.yml 验收改跑完整 NSIS 目标**：`--dir` 目标不生成 app-update.yml（electron-builder 只为安装器目标写更新描述）；`--win --publish never` 实测生成且 owner/repo 正确。
  4. 报告步骤 5 说「约 10 处」：实际改动 10 个文件、11 处路径/守卫（含 5 个 GUI 套件）；backup-meta 的 `app: "incremental-reading-dev"` 字面量（backup.test / f05 / f39 / f43 / f82）与 `nodeSqliteShim.getName()` 是冻结格式标识/显示名，按报告明确不改。
  5. **首轮全量 `card-links` 超时一次**（180s，单独复跑同样超时）；重跑 `scripts/pin-better-sqlite3-electron.cjs`（PIN_OK abi=125，绑定文件实际未被 electron-builder 改动）后单独跑通过（840ms），干净全量第二轮通过。未复现、根因未定位（疑似打包后环境瞬时状态或系统级停顿），判定与本项代码无关；如再复现应单独立项排查。
  6. **文档收口（已补做，2026-10-23 第二回合）**：GUIDE §4:80 旧数据路径 `%APPDATA%/incremental-reading-dev/library.db` 已改为 pinUserData 固定的 `<appData>/Nutation`（打包）/ `Nutation-dev`（开发），§8.1 登记决策 **D205**（显式接管并废止 D133 / D187 的旧冻结条款），标题版本 bump v49.30 → v49.31；提交 `718cfcc`，合并 `dfda976`。f11 闸门回到基线 14/16（L1 `vendor/kpScopes.js` 与 L6 表数声明为既有失败，与本改动无关）；`tests/userData.test.cjs` 文件头因被 §8.1 点名而补「直跑」运行时声明（f11 L9 要求）。
  7. 测试副产物 `tests/m15r.activity.bundle.cjs` / `m15r.layout.bundle.cjs` 在全量后变脏，提交前已还原；临时探针与沙箱均删除未入库。



### 3.13 C-12 · 备份/恢复流式化，支持 ZIP64 与 >2 GiB 文件

- **提交**：`83b318c fix(C-12): 备份/恢复流式化（yazl/yauzl，自动 ZIP64）`；合并 `b75c31d`。
- **改动**（8 文件，+324/−76）：
  - `electron/backup-build-worker.js`：JSZip 整包内存生成改为 **yazl 流式**（文件条目由 yazl 内部 ReadStream 读取，内存与文件大小无关）；`.part` 写完 **fsync 后再改名**（断电不留「改名成功但内容未落盘」的备份）；头注释 ③ 由「逐字节等价」改为「流式写入，自动 ZIP64」。quick_check 步骤原样保留。
  - 新建 `electron/zipRead.js`：yauzl Promise 封装——`openZip` / `forEachEntry` / `readEntryText` / `readBackupMeta`（只读中央目录 + 单个小条目，GB 级备份毫秒级）/ `extractAll`（逐条目 pipe 落盘；拒绝反斜杠、绝对路径、`..` 越界）。
  - `electron/backup-meta-worker.js`：整包 `readFile` + `JSZip.loadAsync` 改为 `readBackupMeta`（消灭 2 GiB 的 `ERR_FS_FILE_TOO_LARGE` 上限）。
  - `electron/backup.js`：`restoreBackup` 改为 readBackupMeta 校验 → openZip/forEachEntry 确认 `library.db` 并累加 `uncompressedSize` → **解包前磁盘空间预检**（`fs.statfsSync`，需 `total×1.1 + 200MB`）→ `extractAll` 流式解包；`createBackup` 构建前同做空间检查（需 `total + 200MB`）；`isIntactSqliteFile` 改为只读 100 字节头 + 页大小/页数与 stat 自洽（原实现为看头部而整文件 readFileSync，>2GiB 即抛错、校验反成拦路虎）；worker 不可用的同步兜底 `readBackupMetaSync` 一并改走 zipRead（见偏离 4）；JSZip require 移除，剩余 `readFileSync` 仅 settings/ai-config/sidecar/marker 小 JSON（报告第 8 步复查通过）。
  - `tests/backup.test.cjs` 第 4 节：穿越条目从「跳过」改为「整体中止」的期望同步（见偏离 3）。
  - 新建 `tests/backup-zip64.test.cjs`（electron-node，`NUT_BIG_TESTS=1` 门控，默认跳过）。
  - `package.json`：`+yazl 3.3.1`、`+yauzl 3.4.0`（`--save-exact`）；JSZip 保留（importers / main / epub 仍在用）。
- **验收（2026-10-23，Windows；Electron 31.7.7 / Node 24.15.0）**：
  - `node scripts/run-tests.mjs backup backup-zip64` → **2 通过 / 0 失败**（改动前基线 backup 1 过 / 0 败）。
  - `NUT_BIG_TESTS=1` 大文件实测 → **6 通过 / 0 失败**（29.7s）：4.5 GB 稀疏文件（`openSync`+`ftruncateSync`）作为 dictionary.db 走 `createBackup`（打包 19.5s，zip 4.7 MB——4.5 GB 零被 DEFLATE）→ `readBackupMeta` 与 `backup.readBackupMeta`（sidecar/worker 路径）都读回清单（meta 解析 6ms）→ `extractAll` 解出（9.2s）后 library.db / dictionary.db **大小逐字节比对一致（ZIP64 条目无截断）**；`process.memoryUsage().rss` 峰值 **71 MB** < 500 MB。quick_check 对稀疏零文件报「file is not a database」属预期（仅入日志，不影响备份成败，顺带证明上报路径存活）。
  - 真机主进程探针（临时脚本，已删；真实 Electron + 隔离 userData + 真实 `db.backup()` 快照，即 IPC `backup:create`/`backup:restore` 同路径）→ **7/7**：createBackup 成功、listBackups valid、破坏当前库后 restoreBackup 受理且需重启、staging 解包、`applyPendingRestore` 换入、换入后卡片数与材料标题与备份前一致。
  - 流程差分：**F82**（0/1，prep 子进程 `app undefined`——node 分支流程以 Electron-as-node 启动、其 spawn 的 electron 子进程继承 `ELECTRON_RUN_AS_NODE=1`）与 **F05**（15/16，「备份含 settings.json」假 + apply 后 rimraf `library.db` EBUSY）在 **main 基线 worktree** 上逐项一致——均为既有失败，非本项回归；F05 B1 恰好以 JSZip 逐条目读出 yazl 产物的全部 5 个条目，证明跨库兼容。
  - `node scripts/run-tests.mjs --list | tail -1` → `{"electron-node":60,"electron":29,"system-node":7}`（96 个，报告 95 → +1）。
  - `npm run typecheck` → exit 0。
  - `npm test`（无并行负载）→ 96 个 **94 过 / 2 败 / 0 超时**；失败集合 = applog、m14（均为既有未归属项）；`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。
- **偏离**：
  1. **4.5 GB 条目实际是 DEFLATE 而非报告所写 STORE**：`createBackup` 对 `dictionary.db` 硬编码 DEFLATE（`isAlreadyCompressed` 只作用于 dicts/assets 按扩展名），改压缩策略超出本项范围。ZIP64 触发条件是 `uncompressedSize > 4 GiB`（与压缩方式无关），实测 yazl 产出的 ZIP64 条目可被 yauzl 正确解出；副作用是 4.5 GB 零被压成 4.7 MB 的 zip。
  2. **穿越条目的第一道拦截发生在 yauzl 自身**：含 `../` / 绝对路径条目的 zip 在 `openZip`/`forEachEntry` 阶段即被 yauzl 以 `invalid relative path` 拒绝，错误消息为「无法读取备份文件（不是有效的 zip）：invalid relative path: ../」而非 `extractAll` 的「条目路径越界」——两者语义都是整体中止；`extractAll` 的自检保留为第二道防线（面向 yauzl 放行但 path 解析越界的名字）。`backup.test.cjs` 断言相应放宽为 `/越界|无效|非法|无法读取/`。
  3. **报告只提 f82 的期望，实际还有 `tests/backup.test.cjs:129`** 断言「路径穿越 zip 恢复请求成功（穿越条目被剔除）」——按新语义改为断言「整体中止、无标记、未换入任何东西、library.db 保持原样」。
  4. **`readBackupMetaSync`（worker 不可用时的同步兜底）报告未点名**：其 `readFileSync` + `JSZip.loadAsync` 同样有 2 GiB 上限且整包进内存，一并改为 zipRead 流式实现（函数名沿用既有调用方，本就是 async）。
  5. 磁盘空间检查用 `fs.statfsSync`（Node ≥18.15，Windows 走 GetDiskFreeSpaceExW）；statfs 不可用时**跳过预检**、写盘失败照常报错（报告未写降级路径，防御性处理）。
  6. 报告「手动：设置页立即备份→恢复走一遍」以真机主进程探针覆盖（见验收）：设置页 UI 胶水（IPC `backup:create`/`backup:restore`）本项未改，改的全是主进程逻辑，探针与 IPC 调用同一函数同一参数（`backupOpts()` 等价复刻）。
  7. 测试副产物 `tests/m15r.activity.bundle.cjs` / `m15r.layout.bundle.cjs` 全量后变脏，提交前已还原；提交用显式路径（8 文件）。

### 3.14 C-13 · 恢复流程：重启走 quit、learner.db 换库让位重建、设备相关设置不随恢复覆盖

- **提交**：`dc9a2a8 fix(C-13): 恢复流程收口——relaunch 走 quit、learner.db 换库让位重建、设备设置不随恢复覆盖`；合并 `00d7a66`。
- **改动**（4 文件，+159/−4）：
  - `electron/main.js`：`app:relaunch` 由 `app.exit(0)` 改为 `app.quit()`——before-quit（D123 `appQuitting` 置位 + 草稿刷盘）与 will-quit（`dictDb/learnerDb.saveOnQuit` + 三库显式 close，WAL 自动 checkpoint）不再被跳过。
  - `electron/backup.js` `applyPendingRestore`：
    * 换入 library.db 成功后，把 `learner.db` 及 `-wal`/`-shm` 让位为 `*.pre-restore`（让位前先删旧残留，只保留一份）；`restored` 记 `learner.db(reset)`。启动时 learner.db 不存在即新建、刷新管线全量重建（`learnerDb.js` open + `learnerRefresh.js` 已核实），不再依赖「水位超前则清零重算」启发式（恢复后先产生新阅读事件 / 时钟回拨即失守）。
    * 新增 `DEVICE_KEYS = ["backupDir", "closeToTray"]` 与 `preserveDeviceSettings(p, liveAppBefore)`：换入 settings.json **前**先读线上 `app` 对象，换入后把设备键写回（线上没设过的键一并删除），另保留嵌套的 `app.globalShortcuts.autoLaunch`（开机自启）；settings 写回走 `.tmp` + rename 原子替换（C-15 未完成，按报告临时手法）。
  - `tests/m14.test.cjs`：M14-12 换入前 `db.closeDb()`、断言后 `await db.initDb()` 重开（见验收 3）。
  - 新增 `tests/restore-flow.test.cjs`（electron-node，17 断言，better-sqlite3 真 SQLite 夹具）。
- **验收（2026-10-23，Windows；Electron 31.7.7 / Node 24.15.0）**：
  - `node scripts/run-tests.mjs restore-flow m14 backup userData` → **5 通过 / 0 失败**（改动前基线：restore-flow 不存在，m14 1 败）。
  - `npm test` → 97 个 **96 过 / 1 败 / 0 超时**；唯一失败 = applog（既有未归属项）；**m14 转绿**，`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。
  - `npm run typecheck` → exit 0。
  - **真实应用 CDP 探针**（临时脚本 `tests/tmp-c13/probe-relaunch.cjs`，已删；隔离 userData `NUTATION_USER_DATA`）：主窗口内 `window.backupAPI.relaunch()` → 首实例 **0.2s 内真实退出（exit code 0，未被 D123 拦成收托盘）**，`main.log` 含 will-quit 的 `app quit` 记录；relaunch 拉起的第二实例按命令行匹配的 PID 清理（未全局杀 electron）。PROBE-PASS。
  - `node scripts/run-tests.mjs --list | tail -1` → `{"electron-node":61,"electron":29,"system-node":7}`（97 个）。
- **m14 EBUSY 复核结论**（进度账 §1.1 挂账项）：D137（2026-10-12 起）主库换 better-sqlite3 原生引擎后，连接打开期间 Windows 不允许 rename `library.db`；m14 旧测试在连接未关时调 `applyPendingRestore` 故必 EBUSY。真实产品路径（`main.js` whenReady 内先 `applyPendingRestore` 再 `initDb`）从无此占用——**非产品缺陷，是测试未对齐 D137 后的真实时序**。修复后随之暴露 M14-13 的过期期望（`card-generation version === 7`，实际目标版本 8；该段此前因异常中断从未执行到），按 C-05 手法改引用 `db.CARD_PROMPT_TARGET_VERSION`。
- **偏离**：
  1. **步骤 2（渲染层「只提供立即重启」）零改动**：现状已满足报告要求——恢复成功即提示「重启应用后生效——重启前请勿继续使用软件」（`SettingsPanel.tsx` doRestore），`restored=true` 后备份 / 恢复 / 选文件按钮全部禁用，只提供「重启应用」一个按钮；`needsRestart` 命名不存在，等价物即 `restored` 状态。
  2. **设备键清单按实际代码核实**（报告第 4 步要求只保留真实存在的）：`app.backupDir`（backup.js 备份位置）、`app.closeToTray`（D123）、`app.globalShortcuts.autoLaunch`（开机自启，**嵌套在 globalShortcuts 下**，报告示例只处理 flat 键）；「窗口位置/尺寸类」**无持久化键**（窗口 bounds 只用于 resize 增量计算，不落 settings），跳过。
  3. **报告手动验收「恢复后重启，日志出现 before-quit/will-quit 关闭记录」以真实应用 CDP 探针覆盖**（见验收）：触发方式与设置页按钮完全同路径（`backupAPI().relaunch()` → IPC `app:relaunch`）。
  4. `preserveDeviceSettings` 首版曾在换入**后**读线上值（读到的是备份内容），由新增测试的设备键断言当场拦截后改为换入前捕获 `liveAppBefore`——差分测试按预期拦住实现错误，留档。
  5. m14 修复涉及测试改动（报告 C-13 小节未点名，属进度账「同时复核 m14 EBUSY」挂账项的收口）：改动仅为对齐真实时序与更新过期期望，未删除断言、未放宽任何契约。
  6. 测试副产物 `tests/m15r.activity.bundle.cjs` / `m15r.layout.bundle.cjs` 全量后变脏，提交前已还原；提交用显式路径（4 文件）。


### 3.15 C-14 · 备份轮换按 mtime 排序：时钟回拨会删掉最新备份

- **提交**：`96cfb7a fix(C-14): 备份轮换 protect 保护刚生成的备份，时钟回拨不再删最新`；合并 `7b1c4dc`。
- **改动**（2 文件，+78/−12）：
  - `electron/backup.js`：
    * `rotateAutoBackups(dir, keep, protect = new Set())` 与 `rotateSafetyBackups(dir, keep, protect = new Set())` 增加第三参：删除候选先 `filter((f) => !protect.has(f))`，保留额按 `keepOthers = max(0, keep - protect.size)` 计算（总数仍为 keep）。空 protect 时行为与改动前逐字节一致（f05/f51/f91 直接调用均不传参，向后兼容）。
    * 调用处：`autoBackupIfNeeded` 传 `new Set([path.basename(r.file)])`；`createBackup` 的 safety 分支传 `new Set([path.basename(destFile)])`。
    * `listByMtimeAsc` 上方注释修正：原「mtime 由文件系统给，不受时钟影响」是错的——新文件的 mtime 就是当前系统时间；改为「时钟回拨时 mtime 不可信，调用方必须用 protect 保护刚创建的文件」。
    * 新增 `detectClockSkew(dir, now)`：目录中存在 mtime 晚于「当前时间 + 1 天」的自动备份（AUTO_RE 匹配项）→ true；目录不可读时 false。`autoBackupIfNeeded` 的成功返回与 already-today 跳过返回均带出 `clockSkewSuspected`（见偏离 1）。
  - `tests/backup.test.cjs` 新增第 8 节（11 断言）：3 份自动备份 mtime 拨到「当前 + 2 天」→ `autoBackupIfNeeded`（keep=3）生成新备份 → 新备份仍在、总数 = 3、clockSkewSuspected = true；同日再启动跳过且同样带 skew；safety 分支同策略（protect 保新清旧）；两条**无 protect 差分**复现缺陷（auto 与 safety 各一条：旧行为确实会把刚生成的备份当「最旧」删掉）。
- **验收（2026-10-23，Windows；Electron 31.7.7 / Node 24.15.0）**：
  - 改动前基线：`node scripts/run-tests.mjs backup` → 2 通过 / 0 失败。
  - 改动后 `node scripts/run-tests.mjs backup` → **2 通过 / 0 失败**（backup.test.cjs 由 33 断言增至 44：`45 通过 / 1 失败` 中那 1 失败为差分造数错误，修正后直跑 46/46 全绿）。
  - `npm run typecheck` → exit 0。
  - **F91**（D-TEST-35 mtime 轮换回归流程）`node tests/flows/run.cjs --only F91 --cycles 1` → **PASS 12/12（1.1s）**，签名向后兼容证实。
  - `npm test` → 97 个 **95 过 / 2 败 / 0 超时**；失败集合 = applog（既有未归属项）+ `m15v2.route`（性能阈值 flake，单独复跑通过），无新增失败文件。
  - 测试规模不变（97 个；本项只改既有套件、未新增文件）。
- **偏离**：
  1. **`clockSkewSuspected` 同时挂在 already-today 跳过路径**：报告只说「在返回值中加」，未指明哪条返回。时钟回拨场景下「同日已备份」恰是「连续多天不备份」的症状路径（今天的文件名几天前就以未来日期建好），只挂成功路径会漏报，故两条返回都带出。
  2. **设置页提示未接线**：`autoBackupIfNeeded` 唯一调用方是 main.js 启动后 30s 的后台任务（D143），返回值只消费 `r.ok` 记日志；报告修复步骤未含渲染层/IPC 改动，flag 先随返回值带出，UI 提示待后续接线（属报告步骤 4 的「由设置页提示」尚未落到 UI，已记此处）。
  3. 报告验收只要求 auto 一条用例；额外补了 safety protect、同日跳过带 skew、及两条无 protect 差分断言（证明用例确实覆盖缺陷，而非恒真）。
  4. 差分造数坑（留档）：protect 轮换在多份 mtime 相同的旧档中删 readdir 序第一份；补差分现场必须用**新文件名**——若覆盖仍存在的旧名，目录数不变、`rotateAutoBackups(dir, keep)` 删 0 份，差分假失败（实测踩中一次）。
  5. 测试副产物 `tests/m15r.activity.bundle.cjs` / `m15r.layout.bundle.cjs` 全量后变脏，提交前已还原；提交用显式路径（2 文件）。




### 3.16 C-15 · settings.json 两份实现合并 + BOM/非对象/留档/fsync

- **提交**：`17384fc fix(C-15): settings.json 两份实现合并到 jsonFile（BOM/留档/原子写）`；合并 `4f80aa1`。
- **改动**（8 文件，+211/−101）：
  - 新建 `electron/jsonFile.js`（报告代码原样）：`preserveCorrupt` 把损坏文件改名为 `.corrupt-<ISO 时间戳>` 并按名称时间序保留最近 5 份；`readJsonObject` 去 UTF-8 BOM、缺失→fallback、解析失败或非对象→留档后 fallback；`writeJsonAtomic` 走 tmp → `writeFileSync(fd)` → `fsyncSync(fd)` → rename →（POSIX）fsync 目录，失败删 tmp 并抛出。
  - `electron/settingsStore.js`：改为基于 jsonFile 的两行实现，默认形状统一 `{ app: {}, theme: {} }`；`SETTINGS_FILE` 仍在模块加载时固化（pinUserData 之后）。
  - `electron/main.js`：删除自带的 `SETTINGS_FILE/readSettings/writeSettings`，改为 `require("./settingsStore")`（位置仍在 pinUserData 与 `require("./db")` 之后，加载顺序不变）。
  - `electron/backup.js`：`readAppSettings` 改 `readJsonObject`（BOM 可读；坏 JSON / 非对象留档后回默认）。
  - `electron/ai.js`：`readConfig` 改 `readJsonObject`（v10.3 Key 迁移逻辑保持），`writeConfig` 改 `writeJsonAtomic`；顺手移除已无用的 `fs` 引入。
  - `electron/i18n.js`：`initMainLocale` 的直读 `JSON.parse(fs.readFileSync)` 一并收口到 `readJsonObject`。
  - 新增 `tests/settings-file.test.cjs`（`@runtime: electron`，11 断言）：① BOM；② null 返回默认形状 + 留档内容逐字一致；③ 连续 7 次损坏后恰好保留最近 5 份（按实际生成的时间戳集合逐一比对）；④ 写后可解析、读回一致、无 `.tmp`；⑤ 静态断言 `jsonFile.js` 不含 `fs.writeSync(` 且必须用 `writeFileSync(fd)` + `fsyncSync(fd)`。
  - `tests/flows/f91-fix-batch2.cjs` S2：留档名断言由固定 `settings.json.corrupt` 更新为 `.corrupt-<时间戳>`，兜底断言同步为默认形状含 `app`（未删断言）。
- **验收（2026-10-24，Windows；Electron 31.7.7 / Node 24.18.0）**：
  - 改动前基线：`npm test` → 98 个 96 过 / 2 败（applog、`m15v2.route`）。
  - `node scripts/run-tests.mjs settings-file` → 1 通过 / 0 失败；直跑 **11/11**。
  - `node scripts/run-tests.mjs d105-scope m12 d101-lifecycle legacyBackfill m14 backup restore-flow userData` → **9 通过 / 0 失败**。
  - `node tests/flows/run.cjs --only F91 --cycles 1` → **PASS 12/12（1664ms）**。
  - `rg -n "function readSettings" electron` → 仅 `electron/settingsStore.js:10` 一处。
  - `node scripts/run-tests.mjs --list | tail -1` → `{"electron-node":61,"electron":30,"system-node":8}`（99 个，本项 +1）。
  - `npm run typecheck` → exit 0。
  - `npm test`（最终树复跑，无并行负载）→ 99 个 **97 过 / 2 败 / 0 超时**；失败集合 = applog + `m15v2.route`（性能阈值 flake，中位 48.4ms），与改动前基线同一集合，无新增失败文件。
  - **真实应用冒烟**（临时探针，已删；`NUTATION_USER_DATA` 指向临时目录 + CDP 9333）→ **8/8**：预置带 BOM 的 settings.json 启动后未被判损坏（无 `.corrupt-*`）；`settingsAPI.get('app','language')` 读出 `ja`；`settingsAPI.set('app','smokeC15','ok')` 落盘为合法 JSON，原 `ja` 保留、无 `.tmp`、无新留档；主日志无 pinUserData / settings 报错。
- **偏离**：
  1. **F91 S2 是过期期望更新**（执行规则 6 / C-05 手法）：D-TEST-30 的固定 `.corrupt` 文件名被 C-15 的 `.corrupt-<stamp>`（保留 5 份）取代；只改期望值与描述，未删除断言；兜底断言同时收紧为「对象含 app」，用于证明默认形状已统一。`docs/test-flows/DEFECTS.md` 的 D-TEST-30 条目是历史档案，未改。
  2. **i18n 的第三份读取一并收口**：报告第 4 步要求检查其它直接读写 settings.json 的位置；`electron/i18n.js:initMainLocale` 虽经注入路径直读、`rg "settings.json"` 只命中注释，但它是实际存在的第三份解析（带 BOM 时会让主进程语言回落默认、与设置页不一致），故一并走 `readJsonObject`。
  3. **backup.js 保留两处原样读取**：备份载荷 `fs.readFileSync(p.settingsFile)` 必须逐字节进 zip（不能解析后再序列化，会改变用户文件内容）；`isJsonObjectFile(stagedSettings)` 校验的是暂存目录里的备份内容，不能因校验触发留档改名。二者不属于「settings 的运行期读取入口」，未动。
  4. **默认形状从 `{}` 统一为 `{ app: {}, theme: {} }`**：报告明示两份默认不同并要求统一；`settings:set` 的 `all[scope][key]` 与 db 侧 `readSettings().app?.x` 均已兼容，受影响的 9 套件全绿。
  5. **备份目录读取对非对象收紧**：原 `readAppSettings` 的 `JSON.parse(...) || {}` 对 `null` 兜底、对 `[]` 会把数组漏给调用方；统一后数组同样留档并回默认，属报告「非对象留档」的预期行为。
  6. **ai-config 坏文件从静默回默认改为留档**：报告第 5 步要求共用实现；写路径同时获得 fsync，坏文件留下 `.corrupt-*` 供排查。
  7. 测试基数更正：C-14 后实际是 98 个（`settings-notices.test.cjs` 随 D206 合入），C-15 新增 1 个后为 99；本项未新增决策号。

### 3.17 C-16 · 撤销评分：最新日志的卡已删时不回落撤销别的卡

- **提交**：`d063014 fix(C-16): 撤销评分不再回落——最新日志的卡已删时返回 null，不撤销别的卡`；合并 `b86659c`。
- **改动**（2 文件，+26/−7）：
  - `electron/db.js` `getLastUndoableReview`：按报告代码原样重写——先取**全局最新一条日志**（`LEFT JOIN cards`，SQL 层不再过滤已删卡/无快照日志，改带出 `hasSnaps` / `cardDeleted` 辅助字段），该条本身不可撤销（无双快照、卡已删/不存在）即返回 `null`，**不向更早日志回落**；after 解析与 `fsrsStatesEqual` 判定保持原样；返回前剥离两个辅助字段，调用方可见字段（logId/cardId/rating/reviewedAt/reviewSeq）不变。函数头注释同步改述新语义。
  - `tests/undo.test.cjs` 新增 U10（4 断言）：建 P、Q → 评 P → 评 Q → 软删 Q → `getLastUndoableReview()` 为 `null`、`undoLastReview().ok === false`、P 的 fsrs 不变、P 的评分日志仍在（比报告验收多一条日志存留断言）。
- **验收（2026-10-24，Windows；Electron 31.7.7 / Node 24.15.0）**：
  - 改动前基线：`node scripts/run-tests.mjs undo` → 1 通过 / 0 失败（29 断言）。
  - **TDD 差分**：先落 U10 再改实现 → undo 套件失败，明细与报告缺陷逐字一致：`getLastUndoableReview()` 返回了 P 的日志（期望 null）、`undoLastReview()` `ok:true` 且把 P 的 fsrs 从 `review/reps:1` 回退成 `new/reps:0`、P 的评分日志被物理删除；U1–U9 其余 29 断言全过（4 败全在 U10）。
  - 改实现后：`node scripts/run-tests.mjs undo` → 1 通过 / 0 失败（**33/33**）。
  - 关联套件：`node scripts/run-tests.mjs undo m12 m13` → 3 通过 / 0 失败；独立脚本 `npx electron tests/fsrs/simulate.test.cjs`（不在 runner 99 个内，S7 直接调 `undoLastReview`）→ **451 通过 / 0 失败**。
  - `node scripts/run-tests.mjs --list | tail -1` → `{"electron-node":61,"electron":30,"system-node":8}`（99 个不变，本项只扩既有套件）。
  - `npm run typecheck` → exit 0。
  - `npm test`（无并行负载）→ 99 个 **98 过 / 1 败 / 0 超时**；唯一失败 = applog（§1.1 既有未归属项），`m15v2.route` 本轮通过，无新增失败文件。
- **偏离**：
  1. U10 比报告验收多一条「P 的评分日志仍在」断言（撤销被拒时日志不得被物理删除），属同一场景的收紧，非范围扩大。
  2. 报告给的替换代码用 `// ……保持原样……` 省略 after 解析与 `fsrsStatesEqual` 判定，实际逐字保留原实现；函数头注释按新语义改述（报告未提注释，顺带更新）。
  3. 修复同时覆盖「最新日志无快照（v22 旧日志形态）」的回落变体：旧实现同样会跳过它撤销更早的别的卡，新实现统一返回 null——即报告修复步骤「先取全局最新一条日志，再判断它是否可撤销」的字面行为，非额外改动。

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
- 当前下一项：**C-17**（阶段 1 首发前必须完成，P2：`persist()` 把已提交的写入误报为失败；无依赖）。
- 基线：99 个测试；C-16 后全量 98 过 / 1 败（Windows，2026-10-24；仅 applog 既有未归属项，`m15v2.route` 本轮通过，见 §1.1）。C-12 的 `backup-zip64` 默认跳过，`NUT_BIG_TESTS=1` 才跑（需临时盘 ≥6GB）。
- **Token 账（Goal 要求，每会话收尾时更新本行）**：额度 2 亿（GLM 5.3）。C-01…C-15 各会话未留逐会话记录，按每项上界 2M 估算累计 ≤32M；**C-16 本会话估算 ~0.2M**（无子代理，直改直验）。累计估算 ≤32.2M，余额充足——**下一会话（C-17）继续用 GLM 5.3**；若后续累计估算逼近 1.6 亿（留 20% 裕量），新会话改用 GLM 5.3 Flash 最高思考强度，且此后所有会话沿用 Flash。
