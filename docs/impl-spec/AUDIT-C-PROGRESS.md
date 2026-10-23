# C 项审计修复进度账

> **报告（只读）**：`C:\Users\xiongdy\Desktop\report_confirmed.md`（303 KB，3658 行，48 项 C-01…C-48）。
> **本账本**：只记状态、提交/合并、验收摘要、偏离；标题、根因、修复步骤与验收标准一律以报告 §2 / §3 / 对应 C-xx 小节为准。
> **更新时间**：2026-10-24。**本账最近更新时 main HEAD**：`0f7a1b9`（C-23 合并）。

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
- **测试规模**：102 个 `tests/*.test.cjs`，分布 **61 electron-node / 33 electron / 8 system-node**（C-45 guard、C-08 `bookasset-path`、C-09 `csp-policy` 落在 electron-node；C-09 `csp-enforcement` 与 C-10 `schema-version`、C-15 `settings-file` 落在 electron；C-11 `userData` 与 C-12 `backup-zip64` 落在 electron-node；C-13 `restore-flow` 落在 electron-node；C-18 `today-queue-fastpath` 落在 electron；C-19 `ai-stream` 落在 electron）；报告基线为 89 个，C-45 / C-08 / C-09 / C-10 / C-11 / C-12 / C-13 各按报告预期 +1 / +1 / +2 / +1 / +1 / +1 / +1，C-18 按验收新增 1 个，C-19 按验收新增 1 个。C-12 的 `backup-zip64` **默认跳过**（`NUT_BIG_TESTS=1` 时运行，普通全量不计入失败）。**测试基数更正**：C-14 后记为 97，实际 98——`settings-notices.test.cjs`（system-node）随 D206 批次合入，非审计项改动；C-15 新增 `settings-file.test.cjs`（electron）后为 99；C-18 新增 `today-queue-fastpath.test.cjs`（electron）后为 100；C-19 新增 `ai-stream.test.cjs`（electron）后为 **101 个 = 61 electron-node / 32 electron / 8 system-node**；C-20 新增 `ai-keyvault.test.cjs`（electron）后为 **102 个 = 61 electron-node / 33 electron / 8 system-node**；C-22 新增 `assets-integrity.test.cjs`（electron）后为 **103 个 = 61 electron-node / 34 electron / 8 system-node**。
- **本机 Windows 基线（2026-10-23，C-02 前）**：`npm test` → **89 个：82 过 / 7 败 / 0 超时**；结果写入 `tests/.results/latest.json`。C-02 后两次全量均为 **81 过 / 8 败**，多出的 `lensWindow` G1 是时序 flake（见 §1.1），其余 7 败归属不变。**C-03 后一次全量为 83 过 / 6 败**：两个 artifact 失败已消除，`lensWindow` G1 本轮回落到失败集，其余 5 败归属不变。**C-04 后一次全量为 84 过 / 5 败**：`lensWindow` 本轮通过，其余 5 败归属不变，无新增失败文件。**C-05 后全量为 85 过 / 4 败**：m1.prompts / m7.prompts 转绿；失败集合 = applog、i18n、m14、m15v2.route（性能阈值 flake，单独跑通过；与 `tsc` 并行的首轮另有 `lensWindow` G1）。**C-06 后全量为 87 过 / 2 败**：i18n 转绿；失败集合 = applog、m14（均为既有未归属项）；`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。**C-45 后全量为 90 个 87 过 / 3 败**：guard 测试通过；多出的 `lensWindow` G1 是时序 flake（直跑复现），失败集合 = applog、lensWindow、m14，无新增失败文件。**C-08 后全量为 91 个 88 过 / 3 败**：新增 `bookasset-path` 通过；失败集合 = applog、m14、`m15v2.route`（性能阈值 flake，中位 30.7ms vs ≤30ms，与本项无关），`lensWindow` 本轮通过，无新增失败文件。**C-09 后全量为 93 个 91 过 / 2 败**：新增 `csp-policy` / `csp-enforcement` 均通过；失败集合 = applog、m14（均为既有未归属项）；`lensWindow` 与 `m15v2.route` 本轮通过，无新增失败文件。**C-10 后全量为 94 个 92 过 / 2 败**：新增 `schema-version` 13 断言全过；失败集合 = applog、m14（均为既有未归属项），`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。**C-11 后两轮全量均为 95 个**：首轮 91 过 / 3 败 / 1 超时（applog、lensWindow G1 flake、m14 + `card-links` 超时）；复跑钉定脚本后单独跑 `card-links` 通过（840ms），干净第二轮 **92 过 / 3 败 / 0 超时**（applog、lensWindow G1、m14，无新增失败文件）。**C-12 后全量为 96 个 94 过 / 2 败 / 0 超时**（applog、m14，均为既有未归属项）；`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。**C-13 后一次全量为 97 个 96 过 / 1 败 / 0 超时**：**m14 转绿**（EBUSY 复核修复 + 过期期望更新，见 §3.14），失败集合仅剩 applog（既有未归属项）；`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。**C-14 后一次全量为 97 个 95 过 / 2 败 / 0 超时**：失败集合 = applog（既有未归属项）+ `m15v2.route`（性能阈值 flake，单独复跑通过，与备份改动无关）；`lensWindow` 本轮通过，无新增失败文件。**C-15 前基线（2026-10-24，含 D206 批次）为 98 个 96 过 / 2 败**（applog、`m15v2.route`）；**C-15 后最终树复跑 99 个 97 过 / 2 败 / 0 超时**，失败集合与基线一致，无新增失败文件。**C-16 后一次全量为 99 个 98 过 / 1 败 / 0 超时**：唯一失败 = applog（既有未归属项）；`m15v2.route` 本轮通过，无新增失败文件。**C-17 后一次全量为 99 个 98 过 / 1 败 / 0 超时**：失败集合与 C-16 基线完全一致（仅 applog）；`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。**C-18 后一次全量为 100 个 99 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项）；新增 `today-queue-fastpath` 通过，`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。**C-19 后一次全量为 101 个 100 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项，第 11 节子进程崩溃日志两条，与 C-19 无关）；新增 `ai-stream` 通过，`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。**C-20 后一次全量为 102 个 101 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项）；新增 `ai-keyvault` 通过，`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。**C-21 后一次全量为 102 个 101 过 / 1 败 / 0 超时**：失败集合与 C-20 基线完全一致（仅 applog），无新增失败文件（测试规模不变，验收落在 F38 流程侧，见 §3.22）。**C-22 后一次全量为 103 个 102 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项）；新增 `assets-integrity` 通过，`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。流程侧 F59（资产去重纪律，非 103 套件）：改动前 **1/4**（D1 同名书 / D2 资产重复 / D4 备份放大三红），改动后 **3/4**——D2「同一字节流第二次入库必须复用」与 D4「备份不得放大冗余」双双转绿；剩余 D1（createFromPaste 同名书导入不可区分）是独立既有缺陷，与 C-22 无关。**C-23 后两轮全量：首轮 101 过 / 2 败**（applog + `assets-integrity` 4a——后者经干净 main worktree 实证为 **C-22 遗留竞态**，与 C-23 无关，见 §1.1），**复跑干净轮 103 个 102 过 / 1 败 / 0 超时**：唯一失败 = applog，失败集合与 C-22 基线完全一致，无新增失败文件（测试规模不变，验收扩既有两套件）。流程侧（非 99 套件）：C-17 改动前基线 F37 8/8、F35 12/13（M1a）、F04 31/33（G1 两处——F35/F04 的旧注入自 D137 起已失效，属 main 既有失败）；C-17 后 F37 8/8（新语义）、F35 **14/14**、F04 **33/33**（后两者修复既有失败，非放宽）。
- **报告 Linux 基线**：89 个 66 过 / 23 败（见报告 §1.3 / 附录 C）。跨平台比较以本机实测为准，并在回报中注明平台。
- **已完成**：C-07、C-01、C-02、C-03、C-04、C-05、C-06、C-45、C-08、C-09、C-10、C-11、C-12、C-13、C-14、C-15、C-16、C-17、C-18、C-19、C-20、C-21、C-22、C-23。
- **下一项**：**C-43**（卡片浏览分块扫描期间主库写入抛错；P1；报告小节 :1680 起）。
- **D-02 决策记录（2026-10-23，用户在本会话逐项确认）**：发布仓库冻结为 **xiongdy54/Nutation**（本地 origin 已指向它，实测可访问）；appId = **io.github.xiongdy54.nutation**（Flathub 对 GitHub 托管应用的强制命名，为上 Flathub 留后路）；对外 productName = **Nutation**（沿用 D187 既定名）；package.json author = **xiongdy54 + `152503729+xiongdy54@users.noreply.github.com`**（GitHub noreply，零真实信息暴露；数字 ID 经 `github.com/<user>.png` 跳转实测）。另确认：LICENSE 已是 PolyForm Noncommercial 1.0.0（不影响作者本人将来商业化）；代码签名属 C-30，本项不涉及。

### 1.1 已知失败与归属（2026-10-23，Windows）

| 测试文件 | 归属 | 说明 |
| --- | --- | --- |
| `tests/applog.test.cjs` | 待确认 | 报告 U-28 曾标为 Linux/Xvfb 环境差异；Windows 仍失败，暂不归属到 C-01。2026-10-23 复核：本机宿主全局注入 `ELECTRON_RUN_AS_NODE=1`，第 11 节 spawn 的 Electron 子进程继承该变量后以 Node 身份启动（`app` undefined），故无崩溃日志；C-09 改动前基线同样失败，与本项无关（runner 对 electron-node 运行时本身也设置该变量，属于测试脚手架的宿主环境差异）。 |
| `tests/assets-integrity.test.cjs` | 已修复（主控跟进 `c332f58` / 合并 `a1be98e`，2026-10-24） | **2026-10-24 C-23 期间发现**：断言 (4a) 间歇失败。根因：测试以 `minAgeMs: 0` 写入 `stray-occl.png` 后立即扫描，`sweepOrphanAssetFiles` 的 `now - mtimeMs >= minAgeMs` 中 NTFS mtime 为亚毫秒精度而 `Date.now()` 截断到毫秒，同毫秒内差值为负 → 文件不列入孤儿清单；干净 main worktree 复现 8 轮 4 败，与 C-23 无关。**主控修复**：测试侧把 stray 文件 mtime 确定性回拨 1s（`fs.utimesSync`），4d 的 1h 年龄断言不受影响（1s < 1h 仍不列）；连跑 6/6 通过。产品语义未动。 |
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
| 18 | C-17 | 完成 | `a0da0fe` / `0e4136a` | persist busy 不再误报失败；验收见 §3.18。 |

### 阶段 2 · 正确性与规模

| # | 编号 | 状态 | 提交 / 合并 | 备注 |
| --- | --- | --- | --- | --- |
| 19 | C-18 | 完成 | `0a46124` + `5083437` + `2042187` + `12b0385` + `1864cee` / `68daaee` | 10 万卡复习性能；基准脚本 + a 索引 / b 快速路径 / c 专用接口 + 等价测试共 5 提交，验收见 §3.19。 |
| 20 | C-19 | 完成 | `93b5320` + `c9c2dc4` / `ea91c71` | AI 流式传输；a 多字节/截断/非 SSE/4xx/脱敏 + b fetch 传输层系统代理两提交，验收见 §3.20。 |
| 21 | C-20 | 完成 | `369477c` / `f427e49` | API Key 收口 keyVault；会话内存 + 明文迁移清除，验收见 §3.21。 |
| 22 | C-21 | 完成 | `b7e43be` / `3cf0b0d` | 写入口参数校验；F38 既有 6 红探针转绿，验收见 §3.22。 |
| 23 | C-22 | 完成 | `c3daaaa` / `8caf173` | 软删除过滤 / 资产去重原子写 / 孤儿清扫；验收见 §3.23。 |
| 24 | C-23 | 完成 | `468bd08` / `0f7a1b9` | 启动 quick_check 移除 + 完整性参与轮换；验收见 §3.24。 |
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

### 3.18 C-17 · `persist()` 把已提交的写入误报为失败

- **提交**：`a0da0fe fix(C-17): persist() 不再把已提交的写入误报为失败——checkpoint busy 只记日志延后合并`；合并 `0e4136a`。
- **改动**（7 文件，+133/−72）：
  - `electron/db.js`：`persist()` 按报告代码重写——checkpoint busy/异常不抛错，记日志 + 2s 后一次 PASSIVE 补合并（timer unref，回调检查 `db && db.open`）；**busy=1 是 pragma 的正常返回值（不抛异常），与异常同属「checkpoint 未完成」，两种形态都记同一条日志**（报告代码只在 catch 记，busy 路径静默不可观察，故并入；消息前缀 `[db] checkpoint 失败（数据已提交，仅合并延后）：` 保持报告原样）。新增 `checkpointStrict()`（忙碌即抛 `checkpoint busy`）并导出；`persistNow` 改调它（严格语义保留，UI「重试保存」失败可观察）。83 个 `persist()` 调用点零改动；`saveReview` / `deleteCard` 上方描述旧失败语义的注释同步改述。
  - `electron/main.js`：`backupOpts` 的 `flush` 由 `dbModule.persistDb()` 改为 `dbModule.checkpointStrict()`（备份开始时主文件必须自足，不能用不抛错的 persist）。
  - `tests/m14.test.cjs`：M14-12 备份 flush 注入同步改为 `db.checkpointStrict()`（与 main.js 生产注入同语义）。
  - `tests/persist.test.cjs`：P2 翻转为「checkpoint 忙碌 → 写入 API 成功返回 + 提交数据同连接可读 + 主文件逐字节未变 + persistNow 严格收敛」（blocker 改用报告验收给定的 `BEGIN; SELECT 1 FROM cards LIMIT 1`，原为读 review_logs 的等价持锁）；P3 保留「忙碌窗口内 persistNow 仍 throw」；文件头注释改述新语义；14 断言数量不变。
  - `tests/flows/f37-persist-fault-injection.cjs`：注入命中改经 console.error 捕获 `[db] checkpoint` 日志判定（旧法靠 throw 消息）；M1（F37-1）翻转为「busy 时业务写入必须成功返回，不误报失败」；M2（F37-2）改为「提交真实可见」（实测 9/16 用例可观察，阈值 ≥8，probe 盲区用例单独记录）；F37-0/3/4/5/6 判据不变。
  - `tests/flows/f35-stale-grade-guard.cjs`：M1 的 renameSync 旧注入（D137 后已失效）换为第二连接持读事务；M1a 翻转为「成功返回」+ 新增 M1a-2「checkpoint 失败只记日志（可观察）」；M1b 判据不变；头部注释补 C-17 说明。
  - `tests/flows/f04-crash-recovery.cjs`：G1 的 tmp 目录占位旧注入（D137 后已失效）换为持读事务注入；断言「busy 时评分成功返回 + 主文件字节不变 + 快照完整」；G2 去掉清 tmp 障碍，断言「persistNow 严格收敛不重放」；头部注释补 C-17 说明。
- **验收（2026-10-24，Windows；Electron 31.7.7 / Node 24.15.0）**：
  - 改动前基线：`node scripts/run-tests.mjs persist undo m12` → 3 通过 / 0 失败；流程 `--only F04,F35,F37` → F37 8/8 过、F35 12/13（M1a）、F04 31/33（G1 两处）——F35/F04 的旧注入自 D137 起已失效，属 main 既有失败。
  - 改动后：`node scripts/run-tests.mjs persist undo m12` → **3 通过 / 0 失败**（persist 直跑 **14/14**，P2 五断言即报告验收场景：第二连接开读事务不提交时写入 API 返回成功、数据可读）。
  - `node tests/flows/run.cjs --only F04,F35,F37 --cycles 1` → **F04 33/33、F35 14/14、F37 8/8**（F37-0 注入 16/16 命中、F37-2 可观察 9/16）。
  - `npm run typecheck` → exit 0。
  - `npm test`（无并行负载）→ 99 个 **98 过 / 1 败 / 0 超时**；唯一失败 = applog（§1.1 既有未归属项），失败集合与 C-16 基线完全一致，无新增失败文件。
- **偏离**：
  1. **persist() 在 busy 正常返回路径也记日志**：报告代码只在 catch 分支记日志，而 busy=1 是 `db.pragma` 的正常返回值（不抛异常）——不记日志则报告步骤 3 要求验证的「checkpoint 失败只记日志」在 busy 路径不可观察（首轮 F37/F35 用日志判定注入即因此 0 命中）。两种形态并入同一条日志，消息前缀保持报告原样。
  2. **f35 / f04 的旧注入一并换新**：报告步骤 3 只点名 f37，但 f35 M1（renameSync mock）与 f04 G1（tmp 目录占位）注入自 D137 起就不再落在 persist 路径上，两流程在 main 上已是失败项（与 C-17 无关的既有失败）。按「等期望 persist 失败即 reject 的测试按新语义更新」的口径一并换为第二连接持读事务注入 + 新语义断言，改后 14/14、33/33（修复既有失败，未放宽任何断言；f35 M2b/M5 的 A-7 陈旧写防护断言逐字保留）。
  3. F37-2 可观察阈值 ≥8 为本项自定（报告未给数值；实测 9/16 用例 probe 可观察提交，盲区用例在 record 中单独列出）。
  4. m14 的备份 flush 注入同步改 checkpointStrict：报告步骤 2 要求「备份 opts.flush 调用它」，生产注入点在 main.js，测试注入同步保持同语义（该测试原本就模仿 main.js）。
  5. persist.test.cjs P2 的 blocker 语句改为报告验收给定的 `SELECT 1 FROM cards LIMIT 1`（原为等价的读 review_logs 持锁）。

### 3.19 C-18 · 复习队列与全量取卡在 10 万卡规模下的性能

- **提交**（分支 `fix/c18-review-queue-perf`，5 个）：`0a46124 chore(bench): 规模基准脚本（审计附录 A）`、`5083437 fix(C-18a): due 表达式索引 idx_cards_due（MIGRATIONS v3，SCHEMA_VERSION 3）`、`2042187 fix(C-18b): 热路径改走到期超集快速路径（TODAY_QUEUE_DUE_SQL + idx_cards_due），生产调用方全部切换`、`12b0385 fix(C-18c): 计数/分组改走专用接口……`、`1864cee fix(C-18): 新增 today-queue-fastpath 测试……`；合并 `68daaee`。
- **改动**（11 文件，+367/−29）：
  - `electron/schemaVersion.js`：`DUE_EXPR` 常量（json_valid + json_type in ('integer','real') 才取 $.due，否则 NULL）+ MIGRATIONS v3 `idx_cards_due ON cards(is_deleted, DUE_EXPR)`；`SCHEMA_VERSION` 2→3 并导出 `DUE_EXPR`。未用生成列（报告明示会改变 `SELECT c.*` 形状）。
  - `electron/db.js`：`TODAY_QUEUE_DUE_SQL`（与 TODAY_QUEUE_SQL 同一 JOIN，只多 `DUE_EXPR IS NULL OR DUE_EXPR <= ?`）；`computeTodayQueue(now, opts)` 增加 `withDamaged`（默认 true = 原全量参考实现，f13/f48b/f69b 不受影响；false 走快速路径，`damaged: []` + `damagedOmitted: true`）；`listDueCards` / `listDeferredToday` / `computeCardCounts` / `computeSessionQueue` 与 main.js IPC `cards:todayQueue` 全部切换快速路径（`rg "computeTodayQueue\("` 锚点全量核对，测试调用点不动）；导出 `TODAY_QUEUE_DUE_SQL`。新增 `countCardsByExtract()`（SQL 聚合 extractId→张数）与 `listCardsWithKnowledgePoint()`（非空 KP 活卡，形状同 listAllCards）。
  - `electron/main.js` / `electron/preload.js` / `src/lib/cards.ts`：IPC `cards:countByExtract` / `cards:listWithKnowledgePoint` + preload 两行 + cardsApi 两个包装。
  - 渲染层：`Reader.tsx`（已制卡数直卡计数改 `countByExtract`，聚合口径 D85 不变）、`ExtractReviewView.tsx`（同）、`KnowledgeManager.tsx`（改 `listWithKnowledgePoint`，byKp/byId 构造逻辑不变）；`DisambiguateModal.tsx` **保留 listAll** 并补注释（rankDisambiguationCandidates 需全库卡面文本算 bigram Jaccard，meta 轻量行无正文列）。
  - 新增 `tests/today-queue-fastpath.test.cjs`（electron，25 断言）与 `scripts/bench-queue.cjs`（附录 A 原样）。
- **验收（2026-10-24，Windows；Electron 31.7.7 / Node 24.15.0）**：
  - 本机基线（改动前，附录 A 约定）：`BENCH_N=10000` 全量队列中位 80.0ms / listAll 80.2ms（9.6 MB）/ RSS 181MB；`BENCH_N=100000` 全量队列中位 1245.6ms / listAll 1350.8ms（95.9 MB）/ RSS 812MB（与报告 Linux 基线 2644/2542ms 同数量级；改动前第二参数被忽略、两行结果相同 ✓）。
  - `node scripts/run-tests.mjs schema-version` → 1 通过（迁移链 v2→v3 兼容；探针证实新库 user_version=3 且 `idx_cards_due` 存在）。
  - `node scripts/run-tests.mjs today-queue-fastpath` → 1 通过 / 0 失败，直跑 **25/25**：播种覆盖 fsrs NULL / 非法 JSON / due 缺失 / due 字符串 / 已到期 / 未到期 / leech 挂起 / 归档 / 已删除 / 同源组（perDay=1 恰 1 放行 1 延后），三个 now（播种时刻 / +1 天 / +400 天）下两条路径 `cards` 逐 id 与 `deferred`（id:kind）完全相同；EXPLAIN QUERY PLAN 含 `SEARCH c USING INDEX idx_cards_due`；C-18c 两接口口径（含按 extractId 而非卡 id 聚合、排除已删/损坏 context_ref_json、非空 KP 活卡）。
  - 验收基准（最终树）：`BENCH_N=100000` 全量中位 1930.5ms vs 快速路径中位 315.8ms = **16.4% ≤ 25%**，输出「索引命中：是」；`BENCH_N=100000 BENCH_DUE_EVERY=100`（1% 到期）快速路径中位 **148.7ms < 300ms**，同样「索引命中：是」；两轮到期张数（10000/1000）两路径一致。
  - `npm run typecheck` → exit 0。
  - `node scripts/run-tests.mjs --list | tail -1` → `{"electron-node":61,"electron":31,"system-node":8}`（100 个，+1 electron）。
  - `npm test`（无并行负载）→ 100 个 **99 过 / 1 败 / 0 超时**；唯一失败 = applog（§1.1 既有未归属项），`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。
- **偏离**：
  1. **countCardsByExtract 的报告原 SQL 有别名遮蔽缺陷**：`json_extract(...) AS id` 的输出别名 `id` 与 cards 表自身的 `id` 列同名，SQLite 的 `GROUP BY id` 优先解析到表列——实测按卡 id 分组、每卡 n=1，JS 侧同键覆盖后 extract-A 3 张只剩 1（探针复现）。改为 `AS extract_id` + `GROUP BY json_extract(context_ref_json,'$.extractId')`（语义与报告意图一致，按提取点聚合）；测试 S4-1 钉住该行为。
  2. **getStatsOverview（db.js，queryAll(TODAY_QUEUE_SQL) 直扫）未改**：报告 C-18b 的锚点命令是 `rg "computeTodayQueue\(" electron/`，该处不调用 computeTodayQueue 且其 KPI 阈值是「今日 24 点」而非 now（快速路径参数化后语义可适配但超出报告步骤），保持全量参考实现；统计页打开才调用、非每评分一次。后续如需再优化可单列。
  3. 报告要求渲染层类型「damaged 保持 Array」：快速路径返回 `damaged: []` + 新键 `damagedOmitted`，`src/lib/sessionQueue.ts` 类型声明未动（渲染层无 damaged 消费点，rg 复核）。
  4. bench 脚本与 5 提交结构：报告 §0 要求「一项一提交」但 C-18 自身明确分 3 提交，附录 A 另要求 bench 脚本单独提交（可与 C-18a 同批），测试文件按仓库惯例（C-03 先例：分支多提交 + 单次 --no-ff 合并）作第 5 个提交。
  5. 本机 Windows 首次运行基准无「基准失败」行、退出码 0；RSS 从基线 812MB 降到 ~685MB（快速路径不再全量物化 10 万行）。

### 3.20 C-19 · AI 流式传输：多字节乱码 / 截断当成功 / 非 SSE 当成功 / 4xx 被重试 / 不走系统代理

- **提交**（分支 `fix/c19-ai-stream`，2 个）：`93b5320 fix(C-19a): AI 流式传输修正——setEncoding 多字节拼接、截断/非 SSE 不再当成功、4xx 不重试、瞬时网络错误归类、错误正文脱敏`、`c9c2dc4 fix(C-19b): AI 网关切换 fetch 传输层——Electron net.fetch 优先，继承系统代理`；合并 `ea91c71`。
- **改动**（3 文件，+640/−159）：
  - **C-19a**（`electron/ai.js`，报告第 1–6 步）：
    * 第 1 步：响应回调首行 `res.setEncoding("utf8")`（StringDecoder 拼接跨 chunk 多字节字符），`chunk.toString("utf-8")` 改 `chunk`；`requestJSON` 响应回调同样处理。
    * 第 2/8 步：done 只发一次（`sendDoneOnce`）；逐行解析抽成 `handleLine`，end 时补处理无换行符的末行；既无 `[DONE]` 也无 `finish_reason` 的提前收尾按 `code:"truncated"`（`retriable:false`、`streamStarted:true`）拒绝。
    * 第 3 步：200 分支检查 content-type——`text/html` 与整包 `application/json` 不再静默当「空成功」；JSON 整包有 `choices[0].message.content` 则作为一次 delta 发出并正常结束（usage/finishReason 透传），否则 `bad_content_type`（消息附脱敏后前 200 字）；其余类型（含缺失）继续按 SSE 解析。
    * 第 4 步：`chatStream` 重试判定改 `err && err.retriable === true`（4xx / cancelled / truncated 不再吃指数退避）。
    * 第 5 步：`NET_CODES`（ECONNRESET/EPIPE/ENOTFOUND/EAI_AGAIN/ENETUNREACH/EHOSTUNREACH/ECONNABORTED）统一归 `network`（原系统码保留 `.sysCode`）；ETIMEDOUT→`timeout` 维持不重试。
    * 第 6 步：`redact()` 脱敏 Bearer 与 sk/ak/pk/key 形态；`classifyHttpError` 错误正文先脱敏再进消息。
  - **C-19b**（新建 `electron/aiTransport.js` + `electron/ai.js` 切换，报告第 7 步）：
    * `postSSE(url,{headers,body,signal,idleMs})` / `getJSON(url,{headers,timeoutMs})`；`pickFetch` 优先 `electron.net.fetch`（Chromium 网络栈，app ready 后可用，**继承系统代理**），测试/纯 Node 回落 `globalThis.fetch`。
    * 正文解码统一 `TextDecoder("utf-8")` 的 `stream:true`（第 1 步规则在传输层保持）；空闲超时（默认 120s）覆盖「连接 / 响应头 / 每个正文 chunk」全程、收到数据即重置（v45 网络黑洞防护语义）；调用方提前停止消费（[DONE]）自动 `reader.cancel()` 断开。
    * `chatStreamOnce` 重写为 async 流程（非 200 错误体读取 + classifyHttpError、content-type 分流、SSE 行级规则全部保留）；`requestJSON` 委托 `getJSON`（返回形状 `{status,json}` 不变）。
    * fetch 层错误先还原系统码（undici cause 链 + `AggregateError.errors`；Chromium `net::ERR_*` 映射表 `CHROMIUM_NET_CODES`）再走第 5 步同一段归类；ECONNREFUSED 友好文案、abort 归因（`abortErrorOf(signal)`）保留；`Content-Length` 改由 fetch 层自行计算（forbidden header）。
  - 新增 `tests/ai-stream.test.cjs`（electron 运行时，报告验收场景 a–h + C-19b 传输层判据 i，20 断言）：`http.createServer` 模拟 OpenAI 兼容端点，`setAIConfig({preset:"local"})` + 指向 `127.0.0.1` baseUrl（本地预设免 Key），隔离 userData。
- **验收（2026-10-24，Windows；Electron 31.7.7）**：
  - C-19a 后：`node scripts/run-tests.mjs ai-stream` → **1 通过 / 0 失败**，直跑 **18/18**：(a) 「中」字第 2 字节处切断分两次写出 → 拼出 `中文测试` 且无 U+FFFD；(b) 无 [DONE] 无 finish_reason → `truncated` 且不重试；(c) `finish_reason:"stop"` 无 [DONE] → resolve；(d) 200+text/html → `bad_content_type` 不重试；(e) 200 整包 JSON → content 一次 delta + done 恰 1 次 + usage 透传；(f) 401 + maxAttempts 3 → 服务端只收 1 次请求、code `http`/status 401、错误消息中 `sk-abcdef…` 被脱敏；(g) 503 → 恰 3 次请求；(h) [DONE] 时 done 恰 1 次。
  - C-19b 后：同一套件不改 a–h 断言复跑 → **20/20 全过**（(i) app ready 后 `usesElectronNet()===true` + `pickFetch()` 可调用）；`node scripts/run-tests.mjs d112-providers` → **通过**（listModels /api/tags 降级与 detectLocalRuntime 探针经 `getJSON` 的本地服务器回归）。
  - `npm run typecheck` → exit 0（C-19a、C-19b 后各一次）。
  - `node scripts/run-tests.mjs --list | tail -1` → `{"electron-node":61,"electron":32,"system-node":8}`（101 个，本项 +1 electron）。
  - `npm test`（合并前最终树，无并行负载）→ 101 个 **100 过 / 1 败 / 0 超时**；唯一失败 = applog（§1.1 既有未归属项，第 11 节崩溃日志两条，与 C-19 无关）；`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。
  - C-19b 手工验收（Windows 系统代理 + OpenAI 预设「测试连接」）**未执行**——本机无 Clash 等代理与 OpenAI Key；以 (i) 传输层选择判据（生产路径选 Electron net.fetch = 系统代理路径）+ d112 本地服务器经 net.fetch 的回归作离线替代，见偏离 3。
- **偏离**：
  1. **报告第 2 步给的 `handleLine` 代码把 `usage/finishReason` 闭包进函数**：实现按报告结构照搬（状态外提为回调外的局部变量），语义与报告一致；报告省略的 `:457-477` JSON 解析/usage/finishReason/ttft/think 节流逻辑逐字搬入。
  2. **第 3 步的 `bad_content_type` 补 `streamStarted:true`**（报告只要求 `retriable:false`）：200 响应已收到，按 §3.7「流已开始」纪律记录，防将来重试判定误吞。
  3. **C-19b 手工代理验收未执行**（本机无系统代理与海外服务商 Key）：以套件 (i) 断言生产环境 app ready 后选择 Electron net.fetch（该路径继承系统代理，与词典 main.js:1134 同一网络栈）+ d112-providers 经 net.fetch 的本地服务器回归作为离线替代；待有代理环境时可在设置页复测 OpenAI 预设。
  4. **fetch 层错误码还原为本项必要新增**（报告第 7 步未展开）：undici 的 `TypeError("fetch failed")` 不带 Node 系统码（藏在 cause 链 / AggregateError.errors），Chromium net.fetch 报 `net::ERR_*`——不还原则第 5 步归类与 ECONNREFUSED 友好文案全部失效。`CHROMIUM_NET_CODES` 只映射常见网络错误，未知 `ERR_*` 原样透传走「非 NET_CODES 保留原 code」分支。
  5. **net.fetch 会初始化 Chromium 磁盘缓存锁住 userData**：测试进程末尾 `fs.rmSync(userData)` 被无限期卡死（输出全部完成后进程 25s+ 不退，逐场景二分定位 + `disable-http-cache` 差分证实）。测试首行 `app.commandLine.appendSwitch("disable-http-cache")` 后 4.8s 干净退出；残余 EBUSY 由既有 try/catch 兜住（%TEMP% 可能残留小目录，无害）。生产行为不受影响（只是测试进程开关）。
  6. **fetch 默认跟随 3xx 重定向**（Node http.request 不跟随，旧实现对 3xx 按 `code:"http"` 报错）：OpenAI 兼容端点不重定向 POST，影响面可忽略；如遇网关重定向行为差异属 fetch 规范语义。
  7. 测试文件首行的 U+FFFD 字面量在写入时被转成 U+0096（工具链编码损坏），已改为 `"\uFFFD"` 转义（断言语义不变）；临时探针（bisect/netfetch-probe 共 6 个 `tests/tmp-c19-*`）已全部删除，未入库。
  8. 测试副产物 `tests/m15r.activity.bundle.cjs` / `m15r.layout.bundle.cjs` 全量后变脏，合并后已还原；提交用显式路径（3 文件）。


### 3.21 C-20 · API Key：系统加密不可用时「明文保存却读不出来」+ safeStorage 收口 keyVault

- **提交**：`369477c fix(C-20): API Key 收口 keyVault——加密不可用时只留会话内存，不再明文落盘读不出`；合并 `f427e49`。
- **改动**（8 文件，+249/−15）：
  - 新建 `electron/keyVault.js`（报告代码原样 + 顶部 TODO）：`strength()`（"secure" / Linux `basic_text` → "weak" / 不可用 → "none"）与 `encrypt` / `decrypt`；**全仓 safeStorage 调用只出现在此文件**；TODO 登记 C-24 升级后改 `isAsyncEncryptionAvailable` / `encryptStringAsync` / `decryptStringAsync` 并把 `getAIConfig` 改 async（本项不做）。
  - `electron/ai.js`：
    * 模块级 `const sessionKeys = new Map()`（preset → key，只留内存不落盘）；`safeStorage` 直接引用替换为 `keyVault`。
    * `getAIConfig`：先解密 `apiKeyEnc`（`strength() !== "none"` 时）；为空回落 `sessionKeys.get(cfg.preset || "custom")`——修复「保存了 Key 却读不出来」；返回新增 `keyStorage`（encrypted/session/none）与 `encryptionStrength`。
    * `setAIConfig` Key 分支：secure → 加密落盘 + `keys[preset]` 留存（同现状）；否则（none/weak）→ `sessionKeys.set`、`apiKeyEnc = null`、`delete cfg.apiKeyPlain`、删 `keys[preset]`，**不再写明文**；清除分支同步 `sessionKeys.delete`。
    * 预设切换分支：`plain:` 旧值只进 `sessionKeys` 后从 `cfg.keys` 删除，不再写回 `apiKeyPlain`；分支尾 `delete cfg.apiKeyPlain` 纵深防御。
    * `readConfig` 迁移：存量 `apiKeyPlain` 与 `keys` 里所有 `plain:` 值移进 `sessionKeys` 后 `writeConfig` 清盘（这些 Key 旧版本就读不出来，删除不损失功能）；v10.3 密文归档逻辑不变。
  - `src/lib/ai.ts`：`AIConfig` 增 `keyStorage?` / `encryptionStrength?`（含注释）。
  - `src/components/SettingsPanel.tsx`：API Key 字段下 `keyStorage === "session"` 时渲染 `form-hint` 提示（报告给定文案）。
  - `src/i18n/locales/en.ts` / `ja.ts`：提示文案各 +1 键（zh 即键本身）。
  - `tests/flows/f16-security-boundary.cjs`：U4 的「Key 只经 safeStorage 加密落盘」静态判据锚点随迁移——keyVault.js 必须含 `safeStorage.encryptString|decryptString`，且 ai.js 不得再直接出现二者（判据收紧）。
  - 新增 `tests/ai-keyvault.test.cjs`（electron，25 断言）：真 keyVault 先留底，再按报告验收注入 require.cache stub（strength "none" + encrypt 抛错）。
- **验收（2026-10-24，Windows；Electron 31.7.7）**：
  - 改动前基线：`ai-stream` / `d112-providers` / `m15v2.ai` 3 套件全过；流程 F16 **31/32**（既有失败 = 幽灵通道）、F41 **58/68**（10 败均为 C-19 语义既有差量，含 RST·T2 机读码族 / usage 钳制 / 残缺卡片等）。
  - `node scripts/run-tests.mjs ai-keyvault` → 1 通过 / 0 失败；直跑 **25/25**：Phase 1（注入 none）`setAIConfig({apiKey:"sk-test-123456"})` → `getAIConfig().apiKey` 读回、`keyStorage="session"`、`ai-config.json` 不含 `sk-test`、无 `apiKeyPlain`、无 `plain:`、setAIConfig 返回体剥 apiKey 带 keyStorage、切预设不串用 / 切回内存恢复、清除后全空；Phase 2 预写含 `apiKeyPlain` + 两个 `plain:` 键的旧配置并重载模块 → 当前预设 Key 本次运行可用、磁盘明文全清、其他预设同样迁移、迁移幂等；Phase 3 注入 "secure"（**真实 DPAPI encrypt/decrypt**）→ 密文落盘、`keys[preset]` 留存、解密读回、切回恢复、清除全删——与修改前行为一致。
  - `node scripts/run-tests.mjs ai-stream d112-providers m15v2.ai ai-keyvault` → **4 通过 / 0 失败**。
  - `node scripts/i18n-check.mjs` → 1800 键 OK，退出码 0。
  - `npm run typecheck` → exit 0。
  - `node scripts/run-tests.mjs --list | tail -1` → `{"electron-node":61,"electron":33,"system-node":8}`（102 个，报告 101 → +1）。
  - 流程复跑：F16 **31/32**（失败仍仅幽灵通道，keyVault 判据 ✓）、F41 **58/68**（失败集合与基线逐条一致，两条 Key 断言 ✓）——均无新增失败。
  - `npm test`（无并行负载）→ 102 个 **101 过 / 1 败 / 0 超时**；唯一失败 = applog（§1.1 既有未归属项）；`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。
- **偏离**：
  1. **未做「旧实现差分」**：缺陷路径（保存后读不出）只在 safeStorage 不可用环境触发，本机 Windows 恒 secure（DPAPI），旧代码在本机全量里该路径不红；新测试靠 keyVault stub 注入模拟 none，而旧代码不经 keyVault，无法复用同一注入点。缺陷存在性以报告证据静态证实（改动前 `rg -n "apiKeyPlain" electron` 只有写入与备份剥离、无读取）。
  2. **清除 Key 分支补 `sessionKeys.delete`**（报告未点名）：否则 none 环境下「清除 Key」后 getAIConfig 仍从 sessionKeys 读回旧 Key，清除语义失效——修复「保存却读不出」的对称面。
  3. **f16 流程 U4 静态判据锚点随迁移**（报告未点名）：safeStorage 调用收口 keyVault 后原判据（读 ai.js）必失效，按 C-17 口径更新判据读 keyVault.js 并收紧「ai.js 不得再直接出现 safeStorage 加解密」；失败集合与基线一致，未放宽。
  4. `getSelectedStorageBackend` 在 Linux 才探测（报告代码原样）；本机 Windows 上 "weak" 分支未实机触发，由 Phase 1 stub 的 "none" 路径与代码审读覆盖。
  5. 测试 Phase 3 的 encrypt/decrypt 用真实 safeStorage（真 keyVault 留底后注入），非自造对称函数——报告「真实 encrypt/decrypt」的字面要求。
  6. 测试不发网络请求，无需 C-19 的 `disable-http-cache` 开关（已在文件头注明差异原因）。
  7. 测试副产物 `tests/m15r.activity.bundle.cjs` / `m15r.layout.bundle.cjs` 全量后变脏，提交前已还原；提交用显式路径（8 文件）。

### 3.22 C-21 · 写入口参数校验：阅读位置、语言标签、跳过记录、问题标记

- **提交**：`b7e43be fix(C-21): 写入口参数校验——addReadingEvent 有限性/非负、setLibraryItemLang 补 BCP47 标准校验、saveSkip/resolveCardIssue 查父行不假成功`；合并 `3cf0b0d`。
- **改动**（2 文件，+73/−11）：
  - `electron/db.js` 四处（报告代码原样，锚点行号随前序项漂移：addReadingEvent :2399→、setLibraryItemLang :1136→、saveSkip :2388→、resolveCardIssue :2496→）：
    * `addReadingEvent`：`Math.max(0, Math.round(Number(x) || 0))` 改为 `Number.isFinite(n) && n >= 0` 才收（`Infinity`/`NaN`/负值返回 false、零落盘）；未做文档长度上限（见偏离 1）。
    * `setLibraryItemLang`：形状正则通过后补 `try { Intl.getCanonicalLocales(raw); } catch { return false; }`（空串不经此校验，空串会抛 RangeError）；「en-US-x 是合法私有段」的错误注释改写为「singleton 后必须再跟子标签，合法形态是 en-US-x-foo」。
    * `saveSkip`：`rowExists("cards", cardId)`（默认连软删一起过滤）不通过返回 false；`String(cardId)` 归一。
    * `resolveCardIssue`：按 `db.run` 返回的 better-sqlite3 RunResult 判定 `Boolean(info && info.changes > 0)`；`String(id)` 归一。
  - `tests/flows/f38-write-fuzz.cjs`：
    * S1 `skip` op 模型记账同步：saveSkip 被拒（已删卡/幽灵卡）时不推入 `M.skips` / 不 `gain(review_skips)`。
    * `buildProbes` 新增 D2 组（7 条探针）：`addReadingEvent(Infinity/NaN/-5)` 拒收且零落盘 ×3；`setLibraryItemLang("en-us-x")` 拒收且零落盘；`setLibraryItemLang("en-US"/"zh-Hans-CN"/"ja"/"")` 受理且落值正确（小写化）；`saveSkip("不存在的id")`、`resolveCardIssue("不存在的id")` 拒收且零落盘（与 A 组 NOPE 探针互补，覆盖非 UUID 字符串 id）。活书目取长跑存续项，全被软删时 `createFromPaste` 自建（S7 探针本就允许改盘）。
    * **F38-8g 陈旧期望修复（前置解阻塞）**：原 `readFileSync(settings.json)` 直读在全新流程目录上 ENOENT 崩掉整条流程（C-10 后 `setActiveFsrsConfig` 只写 app_meta、settings.json 可能从未被写过）——改为按 C-10 事实源取指针（app_meta 优先、settings 回落），判据语义不变（指针不得悬空）；顺带改 `setActiveFsrsConfig` 探针消息里的「settings.json 的指针」措辞。
- **验收（2026-10-24，Windows；Electron 31.7.7）**：
  - 改动前基线：F38（FLOW_SEED=7）36/38 后在 S5 F38-8g 处 ENOENT 崩溃（自 C-10 起的 main 既有问题，S6/S7 从未跑到）；先只修 F38-8g 取得真实 S7 基线 = **16 项失败**（含 saveSkip 幽灵/空串/已软删 ×3、resolveCardIssue 幽灵、F38-2g 悬空跳过 = 本项缺陷的现场）。
  - 改动后 F38 同种子：**133/144**；报告验收点全部 ✓（`addReadingEvent(位置=Infinity/NaN/-5)`、`setLibraryItemLang(en-us-x 必须拒)`、`(en-US/zh-Hans-CN/ja/空串必须收)`、`saveSkip(不存在的id)`、`resolveCardIssue(不存在的id)` 7 条新探针全过）；**6 条既有红探针转绿**（saveSkip 幽灵/空串/已软删 ×3、resolveCardIssue 幽灵、F38-2g）；失败集 **16 → 11**，逐项核对全部为基线已有（F38-1、F38-1b、T3、createCard 幽灵引用 ×2、resolveCardIssue 重复收口、saveReview 评级/fsrs 形状 ×4、F38-2z 汇总），无新增。第二种子（FLOW_SEED=42）复核：8 条 C-21 相关探针全 ✓、10 项失败同属既有集合、F38-1b 本轮通过。
  - F38-1 违规形态不变（仅 C-16 撤销不回退语义的模型分歧 1 种 ×4，见偏离 7）；F38-8l 已删卡跳过 1 → 0（写入口侧不再产生）；F38-1b 跳过 4 → 3 仍 ≥3 阈值，失败原因不变（本种子未造出 KP 关系边，边 0）。
  - `node scripts/run-tests.mjs lm-db undo m12 restore-flow` → **4 通过 / 0 失败**（lm-db 是唯一直接覆盖 setLibraryItemLang/addReadingEvent 的套件，改动前后均过）。
  - `npm run typecheck` → exit 0。
  - `npm test` → 102 个 **101 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项），失败集合与 C-20 基线完全一致，无新增失败文件；测试规模不变（验收落在流程侧）。
  - 调用方核对：`saveSkip`/`resolveCardIssue` 的渲染层包装（`src/lib/cards.ts` skip 忽略返回值、resolveIssue 已有 `?? false` 回落，且无组件消费 resolveIssue 返回值）对 false 均不抛错；`setLibraryItemLang` 生产调用方（`library:setItemLang` IPC ← Bookshelf/PasteMaterialModal 的 `BOOK_LANGUAGES` 下拉，全部为 2 字母码或空串）不受新校验影响。
- **偏离**：
  1. **`docPlainLengthOf` 未实现**：报告给的检索模式（`plain_len|plainLen|markdown_length|LENGTH\(markdown`）在 electron/db.js 命中 0（electron/ 全域的 `plain_len` 命中都在 learner 子系统的分节索引表，非整篇文档长度；:8110 的 `LENGTH(COALESCE(markdown,''))` 是快照导出查询里的原始 markdown 长度、非纯文本长度，且不匹配报告模式）——按报告明示的回落口径「找不到就不要新建，只保留有限性检查」，未建长度来源，`1e300` 这类有限超大值仍可入库（IPC 层 `Number(charPos)` 后传主进程，正常渲染层不会构造）。
  2. **F38-8g 修复是本项的前置解阻塞**（报告未点名）：不修则流程在 S5 崩溃、报告要求的 f38 验收用例根本跑不到。属「陈旧期望按新契约更新」（C-13 m14 / C-17 f35·f04 同口径），判据语义未放宽。
  3. **F38 S1 skip op 记账同步**（报告未点名）：saveSkip 拒收已删卡后模型必须只在受理时记账，否则每步电池报「落盘行数≠模型」。同时该 op 的「跳过了一张已删的卡」note 分支成为不可达（受理的跳过必为活卡），保留 M.skips 的 ghost 字段形状不变。
  4. **saveSkip 的拒收面比报告字面宽**：`rowExists("cards")` 默认 `is_deleted=0`，已软删卡的跳过同样拒收——与批次 E（D-TEST-15）既有惯例一致，且让 f38 既有 B 组探针「saveSkip(已软删卡)」转绿（该探针本来就判定此行为违规）。
  5. **resolveCardIssue(已收口 issue 再收一次) 探针仍红**：报告给定代码不加 status 过滤，对已存在行的重复收口 `changes=1` 仍返回 true（resolved_at 被重写，快照里被剥列后不可见）。属重复收口幂等语义，超出 C-21 字面范围，维持现状（基线即红，非本项新增）。
  6. **F38-1 / F38-1b 仍红（既有）**：F38-1 的唯一违规形态「模型认为 seq=N 可撤，读口却拒」是 f38 影子模型仍按 C-16 之前的「回落撤销」语义搜索候选，与 C-16「只撤全局最新一条、不可撤即拒」的新语义分歧——F38 自 C-10/C-16 后未再跑过，属陈旧模型期望，与写入口校验无关，未在本项内扩大范围去改；F38-1b 为该种子的覆盖自检（边 0）。**建议后续项（或主控复核时）单列一次 f38 影子模型对 C-16 语义的对齐**。
  7. 报告验收里的 `saveSkip("不存在的id")` / `resolveCardIssue("不存在的id")` 在 f38 已有等价 NOPE 探针（A 组，基线即红、本项转绿）；D2 组仍按报告字面补了「不存在的id」字符串 id 探针，覆盖非 UUID 形状输入。
  8. 测试副产物 `tests/m15r.activity.bundle.cjs` / `tests/m15r.layout.bundle.cjs` 全量后变脏，提交前已还原；提交用显式路径（2 文件）。

### 3.23 C-22 · 软删除过滤遗漏、资产写入留下孤儿文件、资产不去重

- **提交**：`c3daaaa fix(C-22): 软删除过滤遗漏、资产写入不留孤儿、资产内容寻址去重`；合并 `8caf173`。
- **改动**（3 文件，+234/−3）：
  - `electron/db.js` 四处：
    * `createExtract`：`rowExists("documents", …)` 之后加 `if (String(parentType) === "extract" && !rowExists("extracts", parentId)) return false;`——extracts 表确认带 `is_deleted` 软删位（:3230 INSERT 与多处 `WHERE is_deleted = 0`），`rowExists` 默认连软删一起过滤，无需第三参。
    * `buildKpExtractionInput` 书名查询（:5990→）加 `AND li.is_deleted = 0`——已软删书籍的标题不再进入发给 AI 的提示词。
    * `createAssetForItem` 按报告代码改为「sha256 查重（`library_item_id + hash + is_deleted=0`，命中且文件在盘 → 直接复用返回）→ 写 `.part` 临时文件 → `withTransaction(addAssetRow)` → `renameSync`」；catch 里先 `DELETE FROM assets WHERE library_item_id = ? AND path = ?` + `persist()`（rename 失败=行已提交而文件不在 → 删行；插库失败=事务已回滚、DELETE 零命中 no-op）再 `rmSync(tmpPath, {force:true})` 后 rethrow。`addAssetRow` 上方补「复用前提」注释（多卡共用同一 path，删卡顺带删文件必须先查无其他行引用）。软删行不复用（软删书资产视为退出流通，回收时机属 D-06）。
    * 新增 `sweepOrphanAssetFiles({ dryRun = true, minAgeMs = 3600_000, partOnly = false } = {})`：遍历 `userData/assets/*/`，`assets` 表（**含软删行**）无任何行引用、且（mtime 早于 `minAgeMs` 或以 `.part` 结尾）的文件为孤儿；`dryRun=false` 删除，`partOnly=true` 时只删 `.part`、其余孤儿进 `keptForDecision` 仅登记（返回 `{ skipped, orphans, removed, keptForDecision }`）。导出加 `sweepOrphanAssetFiles`。
  - `electron/main.js`：启动 5 分钟后（`setTimeout 300000`，与 D143 autoBackup 同段）调 `sweepOrphanAssetFiles({ dryRun: false, partOnly: true })`——只自愈删 `.part` 残留，其余孤儿 `[assets]` 日志登记不自动删；失败只记日志不阻塞启动。
  - 新增 `tests/assets-integrity.test.cjs`（`@runtime: electron`，23 断言）。
- **验收（2026-10-24，Windows；Electron 31.7.7）**：
  - 改动前基线：`node scripts/run-tests.mjs extracts d105-scope annotation-db d101-lifecycle m8b schema-version` → 6 通过 / 0 失败。
  - `node scripts/run-tests.mjs assets-integrity` → **1 通过 / 0 失败**，直跑 **23/23**：(1a–1d) 同 Buffer 同书两次 → 同一 filename/assetPath、目录仅 1 文件、复用文件字节一致；(2a) 不同字节仍各自落盘；(3a–3d) 触发器挡 INSERT 后抛错、目录无新文件无 `.part`、assets 表无悬空行、撤触发器后同图重试成功；(4a–4h) dryRun 列出无主文件与 `.part`、被引用文件不进清单、dryRun 不删、未到 minAgeMs 不列（`.part` 不看年龄）、partOnly 只删 `.part` 其余进 keptForDecision、全量模式删净且清单与删除一致；(5a–5e) 活文档建根摘录 / 活父建子摘录成功、软删父摘录下建子摘录返回 false、幽灵父摘录返回 false；(6a) workbench-assets 归属同图去重。
  - 关联套件 `node scripts/run-tests.mjs assets-integrity extracts d105-scope annotation-db d101-lifecycle m8b schema-version backup` → **9 通过 / 0 失败**。
  - 流程差分：**F59**（D2 节即本缺陷现场）改动前 **1/4**（stash 实测：D1/D2/D4 红），改动后 **3/4**——D2「同一字节流第二次入库必须复用已有文件」与 D4「备份不得静默放大冗余」转绿（盘上物理文件 1 / 重复 hash 0）；剩余 D1（createFromPaste 同名书双份不可区分）为独立既有缺陷，与本项无关。
  - `node scripts/run-tests.mjs --list | tail -1` → `{"electron":34,"electron-node":61,"system-node":8}`（103 个，报告 102 → +1 electron）。
  - `npm run typecheck` → exit 0。
  - `npm test`（无并行负载）→ 103 个 **102 过 / 1 败 / 0 超时**；唯一失败 = applog（§1.1 既有未归属项），失败集合与 C-21 基线完全一致，无新增失败文件。
- **偏离**：
  1. **插库失败注入方式与报告两种给法都不同**：`require.cache` 换 `addAssetRow` 不可行——它与 `createAssetForItem` 同模块，内部直接引用换不掉；报告另一方案「先 DROP TABLE assets」会让查重 SELECT 先抛错，走不到「写文件后插库失败」的目标路径。改用第二个 better-sqlite3 连接建 `BEFORE INSERT … RAISE(ABORT)` 触发器注入，验收意图不变（抛错后无新文件、无 `.part`），另补「无悬空行」「撤障后重试成功」两条断言。
  2. **`sweepOrphanAssetFiles` 增加 `partOnly` 参数**（报告签名只有 dryRun/minAgeMs）：报告正文要求「启动 5 分钟后以 dryRun:false 只清理 `.part`，其余孤儿只记日志不自动删除」，原签名无法表达「只删 `.part`」；`partOnly=true` 时其余孤儿进 `keptForDecision` 登记保留，语义即报告原文。
  3. **未加 `assets(library_item_id, hash)` MIGRATIONS 索引**（报告依赖项标注「若需要」）：查重查询每次制卡交互执行一次、assets 行数与图片数同量级（千级全表扫描亚毫秒），判定不需要；顺带避免 SCHEMA_VERSION 3→4 连带 schema-version 测试期望更新。
  4. **`withTransaction` 自带 `persist()`**（D137 实现，COMMIT 后即 checkpoint）：报告代码尾部再 `persist()` 保留原样（幂等 checkpoint，无害）。
  5. 测试在同场景内补收紧断言（不同字节不合并 / 复用文件字节一致 / dryRun 不删 / 年龄条件与 `.part` 例外 / 活父与幽灵父对照 / workbench 归属），非范围扩大。
  6. 测试副产物 `tests/m15r.activity.bundle.cjs` / `m15r.layout.bundle.cjs` 全量后变脏，提交前已还原；提交用显式路径（3 文件）。

### 3.24 C-23 · 启动时 quick_check 阻塞主线程；完整性结果不参与备份轮换

- **提交**：`468bd08 fix(C-23): 移除启动 quick_check，快照完整性检查纳入备份轮换决策`；合并 `0f7a1b9`。
- **改动**（11 文件，+133/−23）：
  - `electron/db.js`：`initDb()` 内的启动 `PRAGMA quick_check`（原 D137 §3.5「损坏早暴露」）整段删除，留注释说明 D143 裁决推广到主库、检查移到备份 worker；D143 分相让出的两处 `await nextTick()` 原样保留（注释措辞随 quick_check 移除更新）。
  - `electron/learnerDb.js`：`open()` 内同款 quick_check 删除——learner.db 是派生可重建库，不检查。
  - `electron/backup.js`：
    * `buildZipInWorker`：新增 `integrity` 收集对象，`quickCheck` 消息按 `name → "ok" | 错误文本` 记录（原三行日志保留），`done` ok 分支随结果带出 `integrity`。
    * `createBackup`：worker 的 `quickCheck` 清单按报告代码改为主库快照 + 词典快照（`libSrc !== p.dbFile` 时才查主库——只查快照不查在线文件；未注入 snapshotLibrary 的既有单测环境不受影响）；返回值新增 `integrity`。
    * `autoBackupIfNeeded`：`integrity["library.db"]` 存在且 ≠ `"ok"` → **跳过 `rotateAutoBackups`**，返回体带 `integrityWarning`（报告给定文案）与 `integrity`；正常路径行为不变。
  - `electron/main.js`：启动 30s 自动备份任务消费 `integrityWarning` → `console.error` + `mainWindow.webContents.send("backup:integrityWarning", { message, integrity })`（本仓无既有 backup 推送通道，按报告新增）；`lastAutoBackup`（D206 `backup:info` 消费）新增 `integrityWarning` 布尔。
  - `electron/preload.js`：`backupAPI.onIntegrityWarning`（注册/注销，同 `dict:downloadProgress` 模式）。
  - `src/lib/settingsNotices.ts`：`lastAuto` 类型 + 新通知种类 `backup-integrity`（error 级）——设置页通知框（D206）同源提示，与 C-14 clockSkewSuspected 同一呈现面。
  - `src/components/SettingsPanel.tsx`：`LastAutoBackup` 类型 + `noticeText` 文案分支 + `backupAPI` 类型；`NOTICE_TARGETS` 不给处理按钮（处置是保留备份 + 导出诊断，应用内无对应按钮）。
  - `src/i18n/locales/en.ts` / `ja.ts`：新文案键各 +1。
  - `tests/backup.test.cjs` 新增第 9 节（12 断言）+ `corruptSqliteBytes()` 夹具；`tests/settings-notices.test.cjs` 新增 3 断言。
- **验收（2026-10-24，Windows；Electron 31.7.7 / Node 24.15.0）**：
  - 改动前基线：`node scripts/run-tests.mjs backup m14 restore-flow settings-notices` → 5 通过 / 0 失败。
  - `node scripts/run-tests.mjs backup settings-notices` → **3 通过 / 0 失败**；`backup.test.cjs` 直跑 **57/57**（原 45 + 新 12）：第 9 节 (9a) 静态守卫 db.js/learnerDb.js 无 `pragma("quick_check")`；(9b) 未注入快照 → `integrity["library.db"] === undefined`（不检查在线文件）、注入快照 → 正常库 `"ok"`；(9c) 中部整页写坏的多页真库 → 备份本体 `ok:true`、`integrityWarning` 含「已暂停删除旧备份」、`integrity["library.db"]` 为 `btreeInitPage() returns error code 11` 错误文本、**两份旧自动备份原样保留（轮换未执行）**；(9d) 库修复后次日 → 无 integrityWarning、轮换恢复（总数回 keep=2）。
  - `node scripts/run-tests.mjs m14 restore-flow lm-db undo m12 schema-version settings-file` → **7 通过 / 0 失败**（m14 真实 initDb 走改动后路径、lm-db 覆盖 learnerDb.open）。
  - **真实应用冒烟探针**（临时脚本 `tests/tmp-c23-smoke.cjs`，已删；隔离 userData）→ **PROBE-PASS**：initDb / learnerDb.open 正常建库；`logs/main.log` 中 `quick_check` 行 = **0**。
  - `rg -n 'pragma\(\s*["'"'"']quick_check' electron/db.js electron/learnerDb.js` → 无输出（仅剩注释）。
  - `node scripts/i18n-check.mjs` → 1801 键 OK，退出码 0。
  - `npm run typecheck` → exit 0。
  - `node tests/flows/run.cjs --only F91 --cycles 1` → **PASS 12/12（1077ms）**（轮换回归，C-14 套件）。
  - `npm test` 两轮：首轮 **101 过 / 2 败**（applog + `assets-integrity` 4a 时序竞态——干净 main worktree 实证为 C-22 遗留，见 §1.1 与偏离 6）；复跑干净轮 **103 个 102 过 / 1 败 / 0 超时**，唯一失败 = applog（§1.1 既有未归属项），失败集合与 C-22 基线完全一致，无新增失败文件。
- **偏离**：
  1. **「提示用户」落到两层**（报告只要求推事件）：除 `backup:integrityWarning` 推送（main.js + preload）外，经 `lastAutoBackup.integrityWarning` 接入 D206 设置页通知框（error 级红条，文案即报告给定文本）——与 C-14 `clockSkewSuspected` 同一呈现面；纯推送事件在渲染层无既有监听者，只发事件用户看不到。preload 暴露 `onIntegrityWarning` 供后续接线。
  2. **坏库夹具用「多页真库 + 中部 2 页整页覆盖」而非报告字面的「随机字节到文件中部」直接覆盖最小夹具**：最小单表库只坏 payload 字节时 b-tree 结构可能完好、quick_check 仍 `ok`（漏检）；整页覆盖页头才确定性触发 `btreeInitPage` 错误（原型验证后落测试），语义与报告验收意图一致。
  3. `buildZipInWorker` 失败分支不带回 `integrity`（报告未要求；失败路径调用方只看 error）。
  4. 轮换暂停仅由 `integrity["library.db"]` 门控（报告字面）；词典快照检查结果仍只记日志——词典是可重下载数据，不拦轮换。
  5. `integrity` 收集对 `m.result`/`m.error` 均转字符串（worker 两形态：pragma 返回错误文本 / 打开即抛）。
  6. **`assets-integrity` 4a 竞态登记**（非本项回归）：首轮全量失败后定位到 `now - mtimeMs >= minAgeMs` 的亚毫秒边界；干净 main worktree 复现 8 轮 4 败，归属 C-22 测试遗留，已在 §1.1 登记，**未在本项内修**（超范围），建议单列。
  7. **执行事故（已恢复）**：为验证偏离 6 在干净 main 上建了 git worktree 并以 junction 链接主仓 `node_modules`，`git worktree remove --force` 穿越 junction **递归删除了主仓 `node_modules`**（Windows junction 经典陷阱）。恢复：`npm ci` 从完好的 package-lock.json 精确重装（499 包，electron 二进制与 better-sqlite3 Electron-ABI 绑定均就位），随后 backup 套件、全量 103 套件复跑全部通过。**教训（给后续会话）：验证类 worktree 需先 `rmdir` 掉 junction 再 remove worktree，或改用 `npm ci` 在 worktree 内独立装依赖。**
  8. 测试副产物 `tests/m15r.activity.bundle.cjs` / `m15r.layout.bundle.cjs` 全量后变脏，提交前已还原；提交用显式路径（11 文件）。

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
- 当前下一项：**C-43**（阶段 2 正确性与规模，P1：卡片浏览分块扫描期间主数据库写入抛错——报告小节 :1680 起，`rg -n "C-43" 报告` 定位精确范围；报告含给定的 `scanCards` 替换代码、两个调用点列清单与新测试 `tests/scan-write-concurrency.test.cjs` 要求；证据行号随前序项漂移以锚点为准，先跑 `rg -n "async function scanCards" electron/db.js` 与 `rg -n "const BROWSER_JOIN" -A 4 electron/db.js`）。
- 基线：103 个测试（61 electron-node / 34 electron / 8 system-node）；C-23 后全量 102 过 / 1 败（Windows，2026-10-24；仅 applog 既有未归属项，见 §1.1）。**注意 `tests/assets-integrity.test.cjs` 4a 是 C-22 遗留时序竞态（约半数概率失败，§1.1 有根因与候选修法），全量若只多出它不算新增回归，复跑即可**。C-12 的 `backup-zip64` 默认跳过，`NUT_BIG_TESTS=1` 才跑（需临时盘 ≥6GB）。C-17 已改 `persist()` 语义：busy 只记日志（前缀 `[db] checkpoint 失败`），严格语义在 `persistNow` / `checkpointStrict`（备份 flush）。C-18 后 schema `user_version = 3`（idx_cards_due），新库自动到位；`computeTodayQueue` 增加 `damagedOmitted` 键。C-19 后 AI 网关走 `electron/aiTransport.js`（net.fetch 优先，fetch 层错误先经 `unwrapSysCode`/`CHROMIUM_NET_CODES` 还原系统码再归类）；写 `tests/ai-stream.test.cjs` 同款 electron 测试时注意：必须 `app.commandLine.appendSwitch("disable-http-cache")`，否则 net.fetch 的磁盘缓存会锁住 userData、rmSync 卡死进程退出。C-20 后 safeStorage 只经 `electron/keyVault.js` 访问（strength/encrypt/decrypt；`ai.js` 的 `getAIConfig` 带 `keyStorage`/`encryptionStrength`；明文 Key 只进内存 sessionKeys）；写需要 stub 加密环境的测试用 `require.cache[require.resolve("../electron/keyVault.js")] = { exports: stub }` 注入（参照 `tests/ai-keyvault.test.cjs`）。**C-21 后**：`addReadingEvent` 只收非负有限数、`setLibraryItemLang` 形状正则后还有 `Intl.getCanonicalLocales` 标准校验（空串除外，存值小写化）、`saveSkip`/`resolveCardIssue` 查父行（rowExists 默认连软删过滤）且后者按 `changes>0` 返回。**C-22 后**：`createExtract` 在 parentType=extract 时查父摘录（软删/幽灵父均返回 false）；`buildKpExtractionInput` 书名查询过滤 `li.is_deleted`；`createAssetForItem` 内容寻址去重（同书同 hash 复用既有文件，软删行不复用）+ `.part` 原子写 + 失败双向清理（删行再删 .part）；`sweepOrphanAssetFiles({dryRun,minAgeMs,partOnly})` 孤儿扫描（main.js 启动 5 分钟后只清 `.part`，其余孤儿 `[assets]` 日志登记，回收属 D-06）；**写 electron 运行时直调 db 的测试注意 `initDb()` 是 async、必须 await**（`tests/assets-integrity.test.cjs` 首版漏 await 踩过，症状是「no such table」）；同模块内部函数无法用 require.cache 换桩，注入「写文件后插库失败」用第二 better-sqlite3 连接建 `BEFORE INSERT … RAISE(ABORT)` 触发器。**C-23 后**：启动路径（db.js `initDb` / learnerDb.js `open`）不再执行 `quick_check`（勿加回）；`createBackup` 返回体新增 `integrity`（仅注入 `snapshotLibrary` 时含 `"library.db"`）；`autoBackupIfNeeded` 在 `integrity["library.db"] !== "ok"` 时跳过轮换并带 `integrityWarning`（main.js 经 `backup:integrityWarning` 事件 + D206 通知框提示）。**F38 流程现状（2026-10-24 实测，FLOW_SEED=7/42）**：F38-8g 已按 C-10 指针语义（app_meta 优先）修复，S6/S7 可跑；剩余失败全部既有 = F38-1（f38 影子模型仍是 C-16 前的「回落撤销」语义，与撤销不回退新语义分歧，建议单列对齐）、F38-1b（种子覆盖自检）、T3（仪表盘已删卡计数，D-TEST-23 族）、createCard 幽灵 KP/文档引用 ×2（C-22 相邻域）、resolveCardIssue 重复收口幂等、saveReview 评级/fsrs 形状 ×4；写 f38 探针注意：探针 run 内 `changed` 判定剥 `resolved_at/updated_at` 等列，落值断言要按小写化 lang 比对。**F59 流程**：D2/D4 已随 C-22 转绿（3/4），剩余 D1（createFromPaste 同名书双份不可区分）是独立既有缺陷、不属 C-22/C-47 字面范围。**worktree 验证纪律（C-23 事故教训）**：在主仓外建 worktree 验证时，绝不要把主仓 `node_modules` 以 junction/symlink 挂进 worktree——`git worktree remove --force` 会穿越 junction 递归删除目标内容（C-23 实测清空主仓 node_modules，靠 `npm ci` 恢复）；需要依赖就在 worktree 里独立 `npm ci`。
- **Token 账与执行协议（2026-10-24 用户指令更新）**：**Token 计账终止**——用户指示不再计算 Token 消耗（停更前最后已知状态：累计约 49M / 2 亿，其中 12M 实测，本行留档停更）。**新协议**：主控（编排会话）固定 GLM 5.3；执行单元（新会话）全部改用 **GLM 5.3 Flash 最高思考强度**（代理定义 `.zcode/agents/audit-flash.md`）；每个执行单元完成后，主控必须**审查一遍是否真正正确解决了报告中要解决的问题**（对照报告小节核 diff + 抽跑验收），审查通过才继续下一项（C-16 主控自做；C-17 / C-18 主控已复核 diff 与验收实测，均通过：C-17 persist 新语义与 checkpointStrict 落位、第二连接持读事务验收断言逐字落实；C-18 索引/快速路径/专用接口三段提交、`AS id` 别名遮蔽偏离属实、基准 140.5ms<300ms 与索引命中由主控独立复跑证实）。
