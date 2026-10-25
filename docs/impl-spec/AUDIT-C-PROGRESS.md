# C 项审计修复进度账

> **报告（只读）**：`C:\Users\xiongdy\Desktop\report_confirmed.md`（303 KB，3658 行，48 项 C-01…C-48）。
> **本账本**：只记状态、提交/合并、验收摘要、偏离；标题、根因、修复步骤与验收标准一律以报告 §2 / §3 / 对应 C-xx 小节为准。
> **更新时间**：2026-10-25。**本账最近更新时 main HEAD**：`1cc207c`（C-41 合并）

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
- **测试规模**：105 个 `tests/*.test.cjs`，分布 **62 electron-node / 35 electron / 8 system-node**（截至 C-46；C-45 guard、C-08 `bookasset-path`、C-09 `csp-policy` 落在 electron-node；C-09 `csp-enforcement` 与 C-10 `schema-version`、C-15 `settings-file` 落在 electron；C-11 `userData` 与 C-12 `backup-zip64` 落在 electron-node；C-13 `restore-flow` 落在 electron-node；C-18 `today-queue-fastpath` 落在 electron；C-19 `ai-stream` 落在 electron）；报告基线为 89 个，C-45 / C-08 / C-09 / C-10 / C-11 / C-12 / C-13 各按报告预期 +1 / +1 / +2 / +1 / +1 / +1 / +1，C-18 按验收新增 1 个，C-19 按验收新增 1 个。C-12 的 `backup-zip64` **默认跳过**（`NUT_BIG_TESTS=1` 时运行，普通全量不计入失败）。**测试基数更正**：C-14 后记为 97，实际 98——`settings-notices.test.cjs`（system-node）随 D206 批次合入，非审计项改动；C-15 新增 `settings-file.test.cjs`（electron）后为 99；C-18 新增 `today-queue-fastpath.test.cjs`（electron）后为 100；C-19 新增 `ai-stream.test.cjs`（electron）后为 **101 个 = 61 electron-node / 32 electron / 8 system-node**；C-20 新增 `ai-keyvault.test.cjs`（electron）后为 **102 个 = 61 electron-node / 33 electron / 8 system-node**；C-22 新增 `assets-integrity.test.cjs`（electron）后为 **103 个 = 61 electron-node / 34 electron / 8 system-node**；C-43 新增 `scan-write-concurrency.test.cjs`（electron）后为 **104 个 = 61 electron-node / 35 electron / 8 system-node**（C-44 只扩既有 pluginhost 套件，规模不变）；C-46 新增 `memory-atomic.test.cjs`（electron-node）后为 **105 个 = 62 electron-node / 35 electron / 8 system-node**；C-47 新增 `import-atomic.test.cjs`（electron）后为 **106 个 = 62 electron-node / 36 electron / 8 system-node**；C-48 新增 `fsrs-weights-migration.test.cjs`（electron）后为 **107 个 = 62 electron-node / 37 electron / 8 system-node**；C-25 新增 `app-menu.test.cjs`（electron-node）后为 **108 个 = 63 electron-node / 37 electron / 8 system-node**；C-26 新增 `commands-combo.test.cjs`（system-node）后为 **109 个 = 63 electron-node / 37 electron / 9 system-node**；C-28 新增 `close-to-tray.test.cjs`（electron-node）后为 **110 个 = 64 electron-node / 37 electron / 9 system-node**；C-29 新增 `autostart-linux.test.cjs`（electron-node）后为 **111 个 = 65 electron-node / 37 electron / 9 system-node**；C-30 新增 `updater-source.test.cjs`（electron-node）后为 **112 个 = 66 electron-node / 37 electron / 9 system-node**；C-31 新增 `window-skin.test.cjs`（system-node）后为 **113 个 = 66 electron-node / 37 electron / 10 system-node**；C-32 新增 `m15v2.lensfit-cache`（electron-node）/ `lensWindowFit.binary`（electron-node）/ `m15v2.motion`（system-node）三套件后为 **116 个 = 68 electron-node / 37 electron / 11 system-node**；C-37 扩既有 `window-skin` 套件（零新增测试文件），规模与分布不变；C-38 新增 `sync-tables`（electron）/ `sync-triggers`（electron）/ `settings-layers`（electron-node）三套件后为 **119 个 = 69 electron-node / 39 electron / 11 system-node**；C-39 新增 `anki-export`（electron-node）后为 **120 个 = 70 electron-node / 39 electron / 11 system-node**；C-40 后为 **123 个 = 73 electron-node / 39 electron / 11 system-node**（§3.46）；**C-41 零新增测试文件**，规模与分布不变（123），改动前基线与改动后全量均为 122 过 / 1 败（唯一失败 = applog 既有，失败集合一致）。
- **本机 Windows 基线（2026-10-23，C-02 前）**：`npm test` → **89 个：82 过 / 7 败 / 0 超时**；结果写入 `tests/.results/latest.json`。C-02 后两次全量均为 **81 过 / 8 败**，多出的 `lensWindow` G1 是时序 flake（见 §1.1），其余 7 败归属不变。**C-03 后一次全量为 83 过 / 6 败**：两个 artifact 失败已消除，`lensWindow` G1 本轮回落到失败集，其余 5 败归属不变。**C-04 后一次全量为 84 过 / 5 败**：`lensWindow` 本轮通过，其余 5 败归属不变，无新增失败文件。**C-05 后全量为 85 过 / 4 败**：m1.prompts / m7.prompts 转绿；失败集合 = applog、i18n、m14、m15v2.route（性能阈值 flake，单独跑通过；与 `tsc` 并行的首轮另有 `lensWindow` G1）。**C-06 后全量为 87 过 / 2 败**：i18n 转绿；失败集合 = applog、m14（均为既有未归属项）；`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。**C-45 后全量为 90 个 87 过 / 3 败**：guard 测试通过；多出的 `lensWindow` G1 是时序 flake（直跑复现），失败集合 = applog、lensWindow、m14，无新增失败文件。**C-08 后全量为 91 个 88 过 / 3 败**：新增 `bookasset-path` 通过；失败集合 = applog、m14、`m15v2.route`（性能阈值 flake，中位 30.7ms vs ≤30ms，与本项无关），`lensWindow` 本轮通过，无新增失败文件。**C-09 后全量为 93 个 91 过 / 2 败**：新增 `csp-policy` / `csp-enforcement` 均通过；失败集合 = applog、m14（均为既有未归属项）；`lensWindow` 与 `m15v2.route` 本轮通过，无新增失败文件。**C-10 后全量为 94 个 92 过 / 2 败**：新增 `schema-version` 13 断言全过；失败集合 = applog、m14（均为既有未归属项），`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。**C-11 后两轮全量均为 95 个**：首轮 91 过 / 3 败 / 1 超时（applog、lensWindow G1 flake、m14 + `card-links` 超时）；复跑钉定脚本后单独跑 `card-links` 通过（840ms），干净第二轮 **92 过 / 3 败 / 0 超时**（applog、lensWindow G1、m14，无新增失败文件）。**C-12 后全量为 96 个 94 过 / 2 败 / 0 超时**（applog、m14，均为既有未归属项）；`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。**C-13 后一次全量为 97 个 96 过 / 1 败 / 0 超时**：**m14 转绿**（EBUSY 复核修复 + 过期期望更新，见 §3.14），失败集合仅剩 applog（既有未归属项）；`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。**C-14 后一次全量为 97 个 95 过 / 2 败 / 0 超时**：失败集合 = applog（既有未归属项）+ `m15v2.route`（性能阈值 flake，单独复跑通过，与备份改动无关）；`lensWindow` 本轮通过，无新增失败文件。**C-15 前基线（2026-10-24，含 D206 批次）为 98 个 96 过 / 2 败**（applog、`m15v2.route`）；**C-15 后最终树复跑 99 个 97 过 / 2 败 / 0 超时**，失败集合与基线一致，无新增失败文件。**C-16 后一次全量为 99 个 98 过 / 1 败 / 0 超时**：唯一失败 = applog（既有未归属项）；`m15v2.route` 本轮通过，无新增失败文件。**C-17 后一次全量为 99 个 98 过 / 1 败 / 0 超时**：失败集合与 C-16 基线完全一致（仅 applog）；`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。**C-18 后一次全量为 100 个 99 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项）；新增 `today-queue-fastpath` 通过，`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。**C-19 后一次全量为 101 个 100 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项，第 11 节子进程崩溃日志两条，与 C-19 无关）；新增 `ai-stream` 通过，`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。**C-20 后一次全量为 102 个 101 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项）；新增 `ai-keyvault` 通过，`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。**C-21 后一次全量为 102 个 101 过 / 1 败 / 0 超时**：失败集合与 C-20 基线完全一致（仅 applog），无新增失败文件（测试规模不变，验收落在 F38 流程侧，见 §3.22）。**C-22 后一次全量为 103 个 102 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项）；新增 `assets-integrity` 通过，`lensWindow` / `m15v2.route` 本轮通过，无新增失败文件。流程侧 F59（资产去重纪律，非 103 套件）：改动前 **1/4**（D1 同名书 / D2 资产重复 / D4 备份放大三红），改动后 **3/4**——D2「同一字节流第二次入库必须复用」与 D4「备份不得放大冗余」双双转绿；剩余 D1（createFromPaste 同名书导入不可区分）是独立既有缺陷，与 C-22 无关。**C-23 后两轮全量：首轮 101 过 / 2 败**（applog + `assets-integrity` 4a——后者经干净 main worktree 实证为 **C-22 遗留竞态**，与 C-23 无关，见 §1.1），**复跑干净轮 103 个 102 过 / 1 败 / 0 超时**：唯一失败 = applog，失败集合与 C-22 基线完全一致，无新增失败文件（测试规模不变，验收扩既有两套件）。**C-43 后一次全量为 104 个 103 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项，第 11 节崩溃日志两条）；新增 `scan-write-concurrency` 通过，失败集合与 C-23 干净轮完全一致，无新增失败文件。**C-44 后一次全量为 104 个 103 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项）；pluginhost 155 断言全过（+6 条 C-44 断言），失败集合与 C-43 基线完全一致，无新增失败文件。**C-46 后一次全量为 105 个 104 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项）；新增 `memory-atomic` 通过（双运行时直跑均 4/4），失败集合与 C-44 基线完全一致，无新增失败文件。**C-47 后一次全量为 106 个 105 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项）；新增 `import-atomic` 通过，失败集合与 C-46 基线完全一致，无新增失败文件。**C-48 后一次全量为 107 个 106 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项）；新增 `fsrs-weights-migration` 通过，失败集合与 C-47 基线完全一致，无新增失败文件。**C-25 后一次全量为 108 个 107 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项）；新增 `app-menu` 通过（改动前基线实测 107 个 106 过 / 1 败，亦仅 applog），失败集合与基线完全一致，无新增失败文件。**C-26 后一次全量为 109 个 108 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项）；新增 `commands-combo` 通过（改动前基线实测 108 个 107 过 / 1 败，亦仅 applog），失败集合与基线完全一致，无新增失败文件。**C-27 后一次全量为 109 个 108 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项）；未新增测试（规模与分布不变），失败集合与 C-26 基线完全一致，无新增失败文件。**C-28 改动前基线实测 109 个 107 过 / 2 败**（applog + `d112-providers` 负载 flake——S1 `getAIConfig().presets` undefined，单独复跑 197ms 通过，见 §1.1）；**C-28 后一次全量为 110 个 109 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项），flake 本轮未复现；新增 `close-to-tray` 通过，失败集合不劣于基线，无新增失败文件。**C-29 改动前基线实测 110 个 109 过 / 1 败 / 0 超时**（唯一失败 = applog，本会话复跑确认）；**C-29 后一次全量为 111 个 110 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项）；新增 `autostart-linux` 通过，m8 / close-to-tray / commands-combo / app-menu 等 quickCapture 相邻套件全绿，失败集合与基线完全一致，无新增失败文件。**C-30 改动前基线实测 111 个 110 过 / 1 败 / 0 超时**（唯一失败 = applog，本会话复跑确认）；**C-30 后一次全量为 112 个 111 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项）；新增 `updater-source` 通过（12 断言），失败集合与基线完全一致，无新增失败文件。**C-31 改动前基线实测 112 个 111 过 / 1 败 / 0 超时**（唯一失败 = applog，本会话复跑确认）；**C-31 后一次全量为 113 个 112 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项）；新增 `window-skin` 通过（readAppearance 语义 4 场景 + 刷新过滤矩阵 + 静态接线），失败集合与基线完全一致，无新增失败文件。流程闸门复跑：F21 **7/7**（settings:changed 两头齐、无死通道）、F11 **14/16** 与 F18 **90/91**（失败集合与 §3.30 基线口径逐条一致：F11 = 既有 L1 vendor/kpScopes.js + L6 表数声明，F18 = 既有 `app.back` 消费者扫描误报且「文档未登记 0」——本项零新设置键），无新增失败。**C-32 改动前基线实测 113 个 112 过 / 1 败 / 0 超时**（唯一失败 = applog，本会话复跑确认）；**C-32 后一次全量为 116 个 115 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项）；新增三套件（`m15v2.lensfit-cache` / `lensWindowFit.binary` / `m15v2.motion`）全部通过，`mindmap lens` 过滤 7 套件与 `m15v2` 过滤 22 套件均全绿，失败集合与基线完全一致，无新增失败文件。**CI 侧（GitHub Actions 三平台，tag `v0.0.1-rc1` = `0015698`，run 40084725879）**：112 个各平台 3–5 败——linux 3（applog、lm-db、userData）、win 4（applog、lensWindow G1 flake、lm-db、sqlite-migration）、mac 5（applog、lensWindow、lm-db、m8、userData）——全部 CI 环境归属（applog 既有 §1.1；lensWindow 时序 flake；lm-db 66/67 子测、userData、m8、sqlite-migration 为 runner 环境差异，本地 Windows 均通过），无 C-30 归属失败；远优于报告 §1.3 的 Linux 基线 23 败。流程侧（非 99 套件）：C-17 改动前基线 F37 8/8、F35 12/13（M1a）、F04 31/33（G1 两处——F35/F04 的旧注入自 D137 起已失效，属 main 既有失败）；C-17 后 F37 8/8（新语义）、F35 **14/14**、F04 **33/33**（后两者修复既有失败，非放宽）。**C-37 后一次全量为 116 个 115 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项）；扩既有 `window-skin` 套件通过，失败集合与改动前基线完全一致（基线实测 116 个 115 过 / 1 败，本会话复跑确认），无新增失败文件。**C-38 改动前基线实测 116 个 115 过 / 1 败 / 0 超时**（唯一失败 = applog，本会话复跑确认；附录 A 基准同轮采集：播种 10000 = 71ms / 更新 2000 次 = 6.4ms / computeTodayQueue 中位 40.3ms / 快速路径 7.2ms / listAll 34.7ms / RSS 167MB）；**C-38 后一次全量为 119 个 118 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项）；新增三套件全部通过，失败集合与基线完全一致，无新增失败文件。**C-39 改动前基线实测 119 个 118 过 / 1 败 / 0 超时**（唯一失败 = applog，本会话复跑确认；typecheck 0 / i18n-check 1803 键 exit 0 / lint:consistency OK 同轮采集）；**C-39 后一次全量为 120 个 119 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项）；新增 `anki-export` 31 断言通过，失败集合与基线完全一致，无新增失败文件。
- **报告 Linux 基线**：89 个 66 过 / 23 败（见报告 §1.3 / 附录 C）。跨平台比较以本机实测为准，并在回报中注明平台。
- **已完成**：C-07、C-01、C-02、C-03、C-04、C-05、C-06、C-45、C-08、C-09、C-10、C-11、C-12、C-13、C-14、C-15、C-16、C-17、C-18、C-19、C-20、C-21、C-22、C-23、C-43、C-44、C-46、C-47、C-48、C-24、C-25、C-26、C-27、C-28、C-29、C-30（阶段 3 全部完成）、**C-31**、**C-32**、**C-33**、**C-34**、**C-35**、**C-36**、**C-37**、**C-38**、**C-39**。、**C-40**、**C-41**
- **下一项**：**C-42**（AGENTS.md 等开发指引过时，报告 :3412 起；测试规模现为 123 = 73 electron-node / 39 electron / 11 system-node）。
- **D-04 决策记录（2026-10-24，主控 AskUserQuestion 用户答复）**：结构图谱点击穿透 = **A（现阶段不做）**——只做 C-32 + C-33 前 5 步（B1–B5：窗口一次落位 + prevBounds 补偿 + 动画全进网页内）；U-01 量化数据支持时再议 B（穿透）；移动端立项时一并做 C；C-33 第 6 步（`setIgnoreMouseEvents` / `setShape`）**禁做**。C-33 已按 A 口径执行完毕（D203 头注「明确不做：点击穿透」继续有效）。
- **运行时基线变更（C-24）**：Electron **31.7.7 → 45.0.0**；better-sqlite3 **v12 → 13.0.3**（NAPI 预编译，Electron 45 ABI）。107 个测试 106 过 / 1 败（applog 既有）。后续会话的运行时事实以此为准（`npx electron -v` = v45.0.0）。
- **C-48 数据检查结论（2026-10-24，报告第 3 步只读检查）**：真实开发数据（`%APPDATA%\Nutation-dev` 副本）输出 `pointer: "cfg-default"`、`legacyWeightsStillPresent: false`、`optimizerRows: []`——库内零 optimizer 行说明 v23 迁移从未在该数据上触发，**未受 C-48 影响**，无需用户决策（报告的「问用户」分支仅在存在 optimizer 行时适用）。
- **D-01 / D-10 决策记录（2026-10-24，主控 AskUserQuestion 用户答复）**：**D-10 目标 Electron 版本 = 45**（2026-10-20 发布的最新稳定版，支持到 2027-04-27，报告推荐项）；**D-01 Windows 32 位 = 放弃 ia32**（electron-builder 目标不含 ia32，README/发布说明写明「Windows 10/11 64 位（x64 / ARM64）」，报告推荐项）。C-24 解除阻塞。
- **D-02 决策记录（2026-10-23，用户在本会话逐项确认）**：发布仓库冻结为 **xiongdy54/Nutation**（本地 origin 已指向它，实测可访问）；appId = **io.github.xiongdy54.nutation**（Flathub 对 GitHub 托管应用的强制命名，为上 Flathub 留后路）；对外 productName = **Nutation**（沿用 D187 既定名）；package.json author = **xiongdy54 + `152503729+xiongdy54@users.noreply.github.com`**（GitHub noreply，零真实信息暴露；数字 ID 经 `github.com/<user>.png` 跳转实测）。另确认：LICENSE 已是 PolyForm Noncommercial 1.0.0（不影响作者本人将来商业化）；代码签名属 C-30，本项不涉及。
- **D-03 决策记录（2026-10-24，主控 AskUserQuestion 用户答复）**：默认键位 = **B（Alt 系，报告推荐项）**——阅读场景五键改 `Alt+Z` 制卡 / `Alt+C` AI 制卡 / `Alt+E` AI 解释 / `Alt+X` 摘录 / `Alt+D` 查词（Ctrl/Cmd+Z/X/A/S 还给系统通用含义）；全局快捷键 Windows/Linux 保持 `Ctrl+Alt+Space`、mac 改 `Cmd+Shift+Space`（注册失败提示用户改键）。C-26 步骤 3/4 解除禁做。已登记 GUIDE §8.1 **D207**（v49.36）。
- **D-05 决策记录（2026-10-25，主控 AskUserQuestion 用户答复）**：移动端技术路线 = **A Capacitor**（复用现有 Web 前端，存储换 SQLite 插件或 Worker 内 WASM+OPFS；时机在桌面首发之后，iPad 优先；先做 C-40 解耦与 U-15 真机可行性矩阵）。C-40 移植准备文档按 Capacitor 框架定稿。
- **D-09 决策记录（2026-10-24，主控 AskUserQuestion 用户答复）**：Linux 上「关闭窗口 = 最小化到托盘」**默认关闭**（点关闭即退出——GNOME 默认无托盘区，收进托盘后应用看起来像"消失"）；Windows/macOS 保持默认开启；用户显式设置（true/false）一律尊重。C-28 第 4 步按 D-09=A 落地（`electron/closeToTray.js`，渲染层设置页默认显示同规）。
- **C-30 三项已确认决策（2026-10-24，主控交接包载明用户答复）**：①**U-25 图标源图** = 用户提供的 SVG `C:\Users\xiongdy\Downloads\nutation-icon-kit-v2\out\nutation-icon-light.svg`（viewBox 1024，仓库外一次性输入）——光栅化出 `build/icon.png`（1024）+ 报告命令生成 `build/icon.ico`；SVG 副本留档 `build/icon.svg`（不引用不打包，仅留档再生成来源）。②**U-16 签名** = 暂无证书——workflow 机密为空走未签名路径（仅非空才注入 env，`CSC_IDENTITY_AUTO_DISCOVERY=false`）；yml 的 notarize/entitlements 布线保留，证书后补 secrets 即启用。③**推送授权** = origin（`https://github.com/xiongdy54/Nutation.git`）。
- **仓库合流决策 C（2026-10-24，主控 AskUserQuestion 用户答复）**：远端 `xiongdy54/Nutation` 的 main（`d3c8898`）与本地开发历史**无共同祖先**（远端 = 手工展示仓：三语 README + 实库截图 + PolyForm LICENSE 共 5 提交；本地根也有 README.md，合流必撞）——拍板 **本地 main 推 `origin/dev` 跑 CI，远端展示 main 原封不动**；**最终 main 合流方式（展示 README/截图/视频与开发历史）留待发布前专项决策**。CI 触发方式补充裁定（主控，同日）：workflow_dispatch 因「workflow 只从默认分支注册」404 不可用（远端 main 无 .github/），改推 **tag `v0.0.1-rc0`（→ run 40084018090，mac 因空机密崩）→ 修复后再推 `v0.0.1-rc1`（→ run 40084725879 三平台全绿）**；两 tag 保留作可追溯锚点（如需清理：`git push origin :v0.0.1-rc0 :v0.0.1-rc1`）。

### 1.1 已知失败与归属（2026-10-23，Windows）

| 测试文件 | 归属 | 说明 |
| --- | --- | --- |
| `tests/applog.test.cjs` | 待确认 | 报告 U-28 曾标为 Linux/Xvfb 环境差异；Windows 仍失败，暂不归属到 C-01。2026-10-23 复核：本机宿主全局注入 `ELECTRON_RUN_AS_NODE=1`，第 11 节 spawn 的 Electron 子进程继承该变量后以 Node 身份启动（`app` undefined），故无崩溃日志；C-09 改动前基线同样失败，与本项无关（runner 对 electron-node 运行时本身也设置该变量，属于测试脚手架的宿主环境差异）。 |
| `tests/assets-integrity.test.cjs` | 已修复（主控跟进 `c332f58` / 合并 `a1be98e`，2026-10-24） | **2026-10-24 C-23 期间发现**：断言 (4a) 间歇失败。根因：测试以 `minAgeMs: 0` 写入 `stray-occl.png` 后立即扫描，`sweepOrphanAssetFiles` 的 `now - mtimeMs >= minAgeMs` 中 NTFS mtime 为亚毫秒精度而 `Date.now()` 截断到毫秒，同毫秒内差值为负 → 文件不列入孤儿清单；干净 main worktree 复现 8 轮 4 败，与 C-23 无关。**主控修复**：测试侧把 stray 文件 mtime 确定性回拨 1s（`fs.utimesSync`），4d 的 1h 年龄断言不受影响（1s < 1h 仍不列）；连跑 6/6 通过。产品语义未动。 |
| `tests/backup.test.cjs` | 未归属（跨午夜时序 flake） | 2026-10-25 C-35 会话实测（上一执行会话）：第 8 节两次 `autoBackupIfNeeded({now:new Date()})` 跨 00:00 后「同日再启动跳过」断言失败，单独复跑 57/57 全过；只在午夜前后几分钟可复现，与 lensWindow/m15v2.route/persist P2 同族环境归属。 |
| `tests/d111-artifact.test.cjs` | 已修复（C-03） | Windows CRLF 导致产物逐字节比较失败；C-03 改为规范化后比较并通过。 |
| `tests/d112-providers.test.cjs` | 未归属（负载 flake） | 2026-10-24 C-28 改动前基线（109 个）全量中 S1 报 `TypeError: Cannot read properties of undefined (reading 'length')`（:98 `ai.getAIConfig().presets` 为 undefined）；单独复跑 **197ms 通过**，C-28 后全量（110 个）未复现。仅在全量并行负载下出现一次，该测试只 import `electron/ai.js`（C-28 未触碰），与本项无关。 |
| `tests/i18n.test.cjs` | 已修复（C-06） | en / ja 各缺 17 个键；C-06 补齐后 `i18n-check` 退出码 0、测试转绿。 |
| `tests/lensWindowFit.artifact.test.cjs` | 已修复（C-03） | D203 合并后新增；现场重打包 7053 B vs 仓库 7224 B，差值 171 B；C-03 改为规范化后比较并通过。 |
| `tests/lensWindow.test.cjs` | 未归属（时序 flake） | C-02 后两次全量均失败于 G1（55ms 采样 180ms 缓动）；该文件与 `electron/lensWindow.js` 未被 C-02 改动，单独连跑 3 次 1 过 2 败。C-04 全量本轮通过；C-05 与 `tsc` 并行的首轮复现，随后单独跑与干净全量均通过。C-45 全量复现（G1），直跑同样 1 败；本项只改 `tests/flows` 与新增 guard，与该文件无关。C-08 全量本轮通过。**C-33 期间**：G1 已随 B1 重写为「一次落位」期望；与 `m15v2.lens.dom` 同批并行负载下复现过一轮 B2/C2/C3/D1 时序假失败（重载/悬挂/离屏的状态机断言被宿主负载拖慢），复跑即全绿（16.7s），失败集合无新增文件——与 G1 同族的宿主负载时序敏感。 |
| `tests/m1.prompts.test.cjs` | 已修复（C-05） | prompt 版本期望 7，实际 8（过期期望）；C-05 改为引用 `db.CARD_PROMPT_TARGET_VERSION` 并通过。 |
| `tests/m14.test.cjs` | 已修复（C-13） | D137 后主库是 better-sqlite3 原生连接，Windows 上连接不关 rename `library.db -> .pre-restore` 必 EBUSY；真实路径 `applyPendingRestore` 在启动期 initDb 之前执行、从无此占用。C-13 让测试对齐真实时序（先 `closeDb` 再换入再 `initDb`）；随之暴露 M14-13 的过期期望 `version === 7`（该段此前因 EBUSY 中断从未执行到），按 C-05 手法改引用 `db.CARD_PROMPT_TARGET_VERSION`。 |
| `tests/m15v2.route.test.cjs` | 未归属（性能阈值 flake） | C-05 全量中位 30.5ms vs 阈值 ≤30ms（最快 26.2 / 最慢 32.9）；单独跑通过。该测试只 import `src/lib/mindmap/v2`，不 require `electron/db.js`，与 C-05 改动无关。C-08 全量复现（中位 30.7ms，最快 28.4 / 最慢 33.3）；不 require `electron/main.js`，与本项无关。C-15 前基线（98 个）与最终树复跑（99 个）均复现（中位 48.4ms，全程并行负载），与本项无关。2026-10-24 主控会话：空载单跑 3 连败（中位 32.9ms vs ≤30ms），import 闭包与 C-33 通过树零 diff（git diff 2943aee..HEAD --stat 为空），宿主负载/热节流嫌疑，非 C-34（C-34 会话期间曾并行 build×4+全量×4）。 |
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
| 25 | C-43 | 完成 | `484541e` / `9ae3b43` | 分块扫描期间写入抛错；验收见 §3.25。 |
| 26 | C-44 | 完成 | `eaad771` / `88f489e` | 主题插件 CSS 零网络校验封堵 image-set()/src()。 |
| 27 | C-46 | 完成 | `0013a0d` / `ec360d0` | 记忆文件原子写 + ensureTree 残留清理；验收见 §3.27。 |
| 28 | C-47 | 完成 | `21bcafc` / `97e0aca` | 导入书目/正文同一事务 + 失败清理资产目录；验收见 §3.28。 |
| 29 | C-48 | 完成 | `d249718` / `16e36f3` | v23 FSRS 迁移指针不再被旧快照覆盖；验收见 §3.29。**阶段 2 全部完成。** |

### 阶段 3 · 平台

| # | 编号 | 状态 | 提交 / 合并 | 备注 |
| --- | --- | --- | --- | --- |
| 30 | C-24 | 完成 | `0674ec5`…`bcefe2a`（9 提交）/ 合并见 §3.30 | D-01/D-10 已答复（Electron 45 / 放弃 ia32）；验收见 §3.30。 |
| 31 | C-25 | 完成 | `830e682` / `d7c72d2` | macOS 应用菜单（三 role 模板，非 mac 保持 null）；验收见 §3.31。 |
| 32 | C-26 | 完成 | `987c0a3` + `aaf95e3`（文档先行 `c7f5c97`；漂移校正 `6776636`）/ `70fd0ba`（修正合并 `3643279`） | 物理键回落 + Mod 抽象 + 默认键位 Alt 系（D-03=B）+ mac 全局快捷键默认值；验收见 §3.32。 |
| 33 | C-27 | 完成 | `8570950` + `6b5ea08` / `6218de8` + `e1d2abc` | IME 组字守卫统一 `src/lib/ime.ts`（14 文件 28 处 + 3 文件收敛 5 处 + commands.ts 全局分发 + m4 bundle 重打包）；修正复审补 2 处 Escape 守卫（AIPanel / SelectionPanels，见 §3.33 偏离 3）；验收见 §3.33。 |
| 34 | C-28 | 完成 | `357a5eb` + `12b084f`（修正复审）/ `be90b2d` + `9627a8b` | 托盘/窗口图标平台适配 + closeToTray 平台默认（D-09=A：Linux 默认关）；GUIDE v49.37/D208 登记 + 注释同步（修正复审）；阻塞-解封（magick → 主控装 ImageMagick 7.1.2-34）与修正见 §3.34。 |
| 35 | C-29 | 完成 | `ed941e6` / `334cb71` | Linux 按 XDG autostart 写 nutation.desktop + 平台分支；win/mac app API 不变；验收见 §3.35。 |
| 36 | C-30 | 完成 | `caeaa00`+`8b4ed0c`+`497d99a`+`c073e64`+`8580f06`+`2e1ffcd`（修正）/ 合并 `9d001e8`+`0015698` | 三平台双架构矩阵 + npmRebuild:false + updater unsupported 渠道（GUIDE v49.38/D209）+ CI workflow；CI run 40084725879 三平台全绿出包（tag v0.0.1-rc1）；验收见 §3.36。 |

### 阶段 4 · 体验一致性

| # | 编号 | 状态 | 提交 / 合并 | 备注 |
| --- | --- | --- | --- | --- |
| 37 | C-31 | 完成 | `ad4f11e` / `0b37f7a`；修正 `05eb171` / `5e0db6c`（D210 登记） | 皮肤/动效设置同步到 lens / 制卡台 / 捕获窗口（readAppearance 唯一读取面 + WindowSkin + settings:changed 广播）；验收见 §3.37。 |
| 38 | C-32 | 完成 | `1b402a0`+`54e8012`+`9e705ad`+`350ef10`+`b27dc4d`+`a30dd57`（A1…A6 每步一提交）/ `58ea419` | Phase A 渲染层：perf 测量工具 + 布局缓存复用（等价闸门）+ 聚焦二分（等价闸门）+ 动效 Token + 应用动效三态 + 过渡帧减负；验收与偏离见 §3.38。 |
| 39 | C-33 | 完成 | `e236115`（GUIDE 先行）→ `0855748`（B1）→ `6c4e581`（B2-B5）→ `d106e53`+`14f94d9`（量测基准）/ `e77c48d` | B1–B5 完成（D-04=A 禁做第 6 步穿透）；验收见 §3.39。 |
| 40 | C-34 | 完成 | `c3b86e8`（a）+ `2ac50e5`（b）+ `849232a`（c）+ `968c0ea`（d）/ `d9c63b3` | 编辑契约 docs/EDIT-CONTRACT.md + 6 处 ReactMarkdown→ReadMarkdown + 删孤儿 EditableText；CardFace 读态渲染+点击编辑（CardFields/EditableField/ClozeDraftEditor）；AnnotationPanel Esc 保存统一；CardPane 用 MdField + textarea 白名单；验收与偏离见 §3.40。 |
| 41 | C-35 | 完成 | `d97be71`（a）+ `603d807`（b）+ `9841b36`（c）/ `9ecd7b9` | 八规则闸门 scripts/consistency-check.mjs + `lint:consistency` 常驻（CI 阻断步骤）+ E1 四组 Token 修复 + F09 24/28→28/28；验收与偏离见 §3.41。 |
| 42 | C-36 | 完成 | `b1d51ef` / `3dd7464` | 触控/仅 hover 可见：.reveal-on-hover 工具类 + 44px 命中区 + 4 控件收编 + 规则 7 收口（REVEAL_ALLOW 豁免 + 基线 7→0）+ docs/UI-CONVENTIONS.md；验收与偏离见 §3.42。 |
| 43 | C-37 | 完成 | `dd39c9c` / `c922497` | 主题模式跟随系统（三档按钮 + resolveThemeMode 唯一解析面 + App/WindowSkin system 档 mq 监听 + themeBackground×2 nativeTheme，默认值保持 light）；验收与偏离见 §3.43。 |

### 阶段 5 · 未来能力预留

| # | 编号 | 状态 | 提交 / 合并 | 备注 |
| --- | --- | --- | --- | --- |
| 44 | C-38 | 完成 | `df86c76`+`5657d21`+`1ce8b22`+`2676d98`+`779de18`（docs）/ `8227488` | 云同步预留四件套；GUIDE v49.41/D212 登记触发器例外；验收见 §3.44。 |
| 45 | C-39 | 完成 | `5feccb9`（docs）+ `18d2662`（impl）+ `9188f51`（test）/ `58e923c` | 导出到 Anki Phase 1（TSV + 媒体，单向）；GUIDE v49.42/D213 登记；验收见 §3.45。 |
| 46 | C-40 | 完成 | `f6d036d`+`c2fcaa1`+`6f3e520`+`4be04c0`（a…d）/ `0bd52a0` | 移动端准备（D-05=A 解锁）；验收与执行代理被用户中途取消（模型问题，见 §3.46 偏离 4）后由主控对抗审查通过合并；验收见 §3.46 |
| 47 | C-41 | 完成 | `3823500` / `1cc207c` | 生产依赖漏洞：audit fix 三升级 + C-41b katex overrides 单份 0.18.5 + accepted-risks 登记；C-41c 延后备查（核实清单见 §3.47 偏离 5）；主控对抗审查通过（独立复跑见 §3.47 末行）；验收见 §3.47。 |
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

### 3.25 C-43 · 卡片浏览分块扫描期间，主数据库上的任何写入都会抛错

- **提交**：`484541e fix(C-43): 分块扫描不再跨 await 持有游标——扫描期间主库写入可并发执行`；合并 `9ae3b43`。
- **改动**（2 文件，+148/−24）：
  - `electron/db.js`：
    * `scanCards` 按报告代码重写：签名 `(sql, params, handleRow)` → `(cols, handleRow, chunk = 2000)`；同步取有序 id（`SELECT id FROM cards WHERE is_deleted = 0 ORDER BY created_at DESC`，`.pluck().all()`），再按块 `SELECT ${cols} ${BROWSER_JOIN} AND c.id IN (SELECT value FROM json_each(?))` 用主键取整行，块与块之间 `await nextTick()`——任何时刻不跨 await 持有游标（better-sqlite3 游标打开期间同连接写入抛 `This database connection is busy executing a query`）；两次让出之间被删除的卡经 `byId.get(id)` 自然跳过。
    * 两个调用点（`getCardBrowserMeta` / `queryCardBrowserIds`）改为只传列清单（去掉 `SELECT`、`${BROWSER_JOIN}`、`ORDER BY …` 与空参数数组 `[]`），列清单与回调逐字保留。
    * **偏离 1**：`BROWSER_JOIN` 首行补 `INDEXED BY sqlite_autoindex_cards_1`（见偏离说明）。
    * **偏离 2**：`nextTick` 上方 D137 注释随实现改述（「惰性迭代游标分块消费」→「分块消费（C-43 起不再用游标，按块主键取整行）」），注释级改动。
  - 新增 `tests/scan-write-concurrency.test.cjs`（`@runtime: electron`，10 断言）：临时 userData → `await initDb()` → 第二 better-sqlite3 连接按附录 A INSERT 播 6000 张卡（created_at 各不相同）→ 关连接；S1 `getCardBrowserMeta` 不 await 立即 `deleteCard("bench-5")`（不抛错 + true + total 6000/5999）；S2 重算 total=5999 且 id 序与全序 SQL 完全一致；S3 `queryCardBrowserIds("问题")`（已验证 parseCardQuery 走文本扫描分支）同样不 await 立即写；S4 静态守卫 `electron/*.js` 无未标注 `// sync-iterate-ok` 的 `.iterate(`。
- **验收（2026-10-24，Windows；Electron 31.7.7 / Node 24.15.0）**：
  - **TDD 差分（报告第 3 步要求）**：改动前直跑新测试 → **3 过 / 7 败**，(1a) 与 (3b) 的错误信息逐字为 `This database connection is busy executing a query`，(4a) 静态守卫列出 `db.js:2126`（改动前唯一 `.iterate(`）——测试确实抓住缺陷。
  - 改动后直跑 → **10/10 全过**；`node scripts/run-tests.mjs scan-write-concurrency d111-mpquery` → **2 通过 / 0 失败**（d111 是改动前基线 1 过，浏览器查询主覆盖套件）。
  - `rg -n "\.iterate\(" electron/*.js` → 无输出（0 命中）。
  - `node scripts/run-tests.mjs --list | tail -1` → `{"electron":35,"electron-node":61,"system-node":8}`（104 个，报告 103 → +1 electron）。
  - `npm run typecheck` → exit 0。
  - **附录 A 基准**（`BENCH_N=100000 npx electron scripts/bench-queue.cjs`）：改动前基线 `getCardBrowserMeta()` 首次 **926.0 ms**；改动后首次 **941.5 ms**（≤ 1.5× = 1389 ms，比值 1.02）；RSS 703 → 681 MB。
  - `npm test`（无并行负载）→ 104 个 **103 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项），失败集合与 C-23 干净轮完全一致，无新增失败文件。
- **偏离**：
  1. **`BROWSER_JOIN` 补 `INDEXED BY sqlite_autoindex_cards_1`（报告给定代码没有）**：报告的分块方案验证用的是「简化表结构（同样的 BROWSER_JOIN）」——该简化库没有 C-18a 的 `idx_cards_due(is_deleted, DUE_EXPR)` 表达式索引。真实 schema 上规划器对每块选择 `SEARCH c USING INDEX idx_cards_due (is_deleted=?)`，即每个分块全扫 100 000 条 `is_deleted=0` 索引项再逐行测 `id IN`（临时探针实测 50 块 6766.8 ms；报告原样代码在附录 A 基准里 10.6 s，超 1.5× 验收上限 11.5 倍）。加 `INDEXED BY` 后计划逐字回到报告声称的 `SEARCH c USING INDEX sqlite_autoindex_cards_1 (id=?)`，50 块 452.1 ms（对照：字面 IN 占位符 7495.5 ms 仍选错索引；rowid json_each 699.9 ms 计划仍显示 idx_cards_due）。`BROWSER_JOIN` 此时只剩 `scanCards` 一个消费方（两个调用点已改为列清单），改动无外溢；`INDEXED BY` 若规划器无法用该索引会直接抛错而非静默退化，失败面可观察。
  2. `nextTick` 上方 D137 注释改述（原注释描述「惰性迭代游标」，实现已无游标，保留会误导），注释级改动。
  3. 报告步骤 3 的「断言 total 为 6000 或 5999」在测试里同时断言了 (1c) 与 S2 的确定值 5999；(3d) 对文本扫描命中数加了 5997–5999 的宽松区间（播种 6000 − S1/S3 各删 1，块读取时序容差），属同场景收紧/明确，非范围扩大。
  4. 测试 (3a) 额外断言 `parseCardQuery("问题")` 确实产生文本叶子（复刻 db.js 的 hasTextOrTagLeaf 判定），防止查询不走扫描分支使 (3b)/(3c) 恒真。
  5. 临时诊断脚本 `tests/tmp-c43-plan/diag/diag2/diag3/diag4.cjs`（查询计划与分块计时定位）已全部删除，未入库；测试副产物 `tests/m15r.activity.bundle.cjs` / `m15r.layout.bundle.cjs` 全量后变脏，提交前已还原；提交用显式路径（2 文件）。

### 3.26 C-44 · 主题插件 CSS 的「零网络」校验可被 `image-set()` 绕过

- **提交**：`eaad771 fix(C-44): 主题插件 CSS 零网络校验封堵 image-set()/src() 字符串 URL 绕过`；合并 `88f489e`。
- **改动**（3 文件，+18/−2）：
  - `electron/pluginCore.js`：`validateAndAuditCss` 内、`url()` 检查的 while 循环之后、`// 规则 4/5 + §6.6` 注释之前，按报告代码原样插入 `urlFnRe = /(?:-webkit-)?image-set\s*\(|(?<![\w-])src\s*\(/gi`——命中即拒载（failWithLine 报行号，消息含「零网络红线一律拒绝」）；`(?<![\w-])` 负向后行断言保证 `--src-tone` 这类含 `src` 子串的自定义属性名不误伤。
  - `tests/pluginhost.test.cjs`：第 5 节（CSS 校验器 fail-closed）`url(javascript:) 拒` 之后新增 6 条断言——`image-set("https://…" 1x)` / `-webkit-image-set(…)` / `IMAGE-SET(…)`（大写）/ `src("https://…")` 四种写法 `ok === false`；基准 CSS `body.theme-dark { --ink: #888888; --paper: #101010; }` 与 `--src-tone: #123456` 两种写法 `ok === true`。
  - `docs/design/PLUGIN-SYSTEM-D132.md`：§6.2 规则 3 禁忌构造清单 +1 条（image-set/-webkit-image-set/src 任意大小写、字符串 URL 不经 url()、C-44）；§9.2 安全分析表 S3 行（风险 + 缓解列）与 S6 行（缓解列）同步补 image-set()/src() 全禁（见偏离 2）。
- **验收（2026-10-24，Windows；Electron 31.7.7 / Node 24.18.0）**：
  - 改动前基线：`node scripts/run-tests.mjs pluginhost` → 1 通过 / 0 失败。
  - **TDD 差分**：先落 6 条断言再改实现 → 直跑 **151 过 / 4 败**，4 败逐字对应报告实测矩阵（image-set / -webkit-image-set / IMAGE-SET / src() 均通过校验＝缺陷现场），2 条对照（基准 CSS、--src-tone）通过。
  - 改实现后：`node scripts/run-tests.mjs pluginhost` → **1 通过 / 0 失败**；直跑 **155 通过 / 0 失败**（149 旧 + 6 新）。
  - 临时探针（`tests/tmp-c44/probe.cjs`，已删；Electron-as-node 直调 validateAndAuditCss）：改动前 image-set / -webkit-image-set / IMAGE-SET / src() 四种写法全部通过校验、`url(https://…)` 被拒（与报告实测表逐字一致）；改动后四种写法全部拒载，基准 CSS / `--src-tone` / `url("data:image/png;base64,…")` 三个正例照常通过。
  - `npm run typecheck` → exit 0。
  - `npm test`（无并行负载）→ 104 个 **103 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项），失败集合与 C-43 基线完全一致，无新增失败文件；测试规模不变（只扩既有套件，`--list` 仍 61 electron-node / 35 electron / 8 system-node）。
  - 合并后 main 上复跑 `node scripts/run-tests.mjs pluginhost` → 1 通过 / 0 失败。
- **偏离**：
  1. 报告步骤 2 说「`const v = …` 附近新增断言」：文件里有**两处**该 helper（:170 第 5 节、:193 第 5b 节）；断言落在第 5 节禁忌构造区（`url(javascript:) 拒` 之后）——第 5 节才是零网络禁忌构造断言的家，第 5b 节是 P0-1 反斜杠绕路专节。
  2. 文档更新范围：报告字面是「列禁用构造的段落」（单数）；实际同步了 §6.2 规则 3 清单（报告字面）+ §9.2 表 S3/S6 行——S3 的缓解列原本枚举「@import 全禁、url() 仅 data:image」即规则 3 的摘要，规则 3 加条目后不同步会自相矛盾；S6 的「url() 已仅剩 data:image——无远端可收」论断恰是 C-44 修正的对象（image-set 字符串 URL 是外传通道）。§12.1 测试矩阵（:595）未改——该矩阵描述批次交付规格快照、本就不逐断言同步（5b 节亦未同步），非本项遗漏。
  3. GUIDE §4.15/:1513 D132 条目也提及「@import/url() 白名单」，但报告步骤 3 明确限定 `rg -n "@import" docs`（docs 目录），GUIDE 在仓库根且 §8.1 属决策日志（历史档案），未改。
  4. 测试副产物 `tests/m15r.activity.bundle.cjs` / `m15r.layout.bundle.cjs` 全量后变脏，提交前已还原；提交用显式路径（3 文件）。

### 3.27 C-46 · 记忆文件（memory/）原地整文件重写：写入中途进程中断会留下空文件或截断文件

- **提交**：`0013a0d fix(C-46): 记忆文件原子写——writeTextAtomic 进 jsonFile，memoryStore 6 处覆盖写收口，ensureTree 清理崩溃残留`；合并 `ec360d0`。
- **改动**（3 文件，+103/−7）：
  - `electron/jsonFile.js`：新增 `writeTextAtomic(file, text)`（报告代码原样）：同目录 `${file}.tmp-${pid}-${Date.now()}` → `writeFileSync(fd)` + `fsyncSync` → `renameSync`（EPERM/EBUSY/EACCES 时 50ms×(i+1) 退避重试至多 6 次）→（POSIX）fsync 目录；失败删 tmp 并抛出。`module.exports` 改为 `{ readJsonObject, writeJsonAtomic, writeTextAtomic, preserveCorrupt }`。
  - `electron/memoryStore.js`：`const path = require("path")` 下一行加 `require("./jsonFile")` 的 `writeTextAtomic`；6 处 `fs.writeFileSync(X, Y, "utf8")` 全部改为 `writeTextAtomic(X, Y)`（:94 建脚手架 core、:99 建脚手架 index、:120 手写区引导升级、:317 merge、:329 mark、:400 rebuildIndex），参数原样、只去 `"utf8"`；`ensureTree` 在 `const corePath` 之前插入报告原样的 `sweep` IIFE——递归（深度 ≤3）清理 `*.tmp-<pid>-<时间戳>` 崩溃残留。
  - 新增 `tests/memory-atomic.test.cjs`（`@runtime: electron-node`，报告全文原样）：① 基本写 + 无 tmp 残留；② 随机时刻 SIGKILL 30 轮 × 200 KB——目标文件必须始终是完整 A… 或 B…；③ ensureTree 清理 `core.md.tmp-123-456` 残留；④ 静态：memoryStore.js 无 `fs.writeFileSync(`、jsonFile.js 无 `fs.writeSync(`。
- **验收（2026-10-24，Windows；Electron 31.7.7 / Node 24.18.0）**：
  - 锚点：`rg -n "fs\.writeFileSync\(" electron/memoryStore.js` → 无输出。
  - `node scripts/run-tests.mjs memory-atomic` → 1 通过 / 0 失败（3482–3688ms）；直跑双运行时均输出 `memory-atomic: 4/4 通过`、exit 0：`node tests/memory-atomic.test.cjs`（系统 Node）与 `ELECTRON_RUN_AS_NODE=1 npx electron tests/memory-atomic.test.cjs`（Electron 31.7.7 as node）。
  - **TDD 差分**：`git stash` 只还原 memoryStore.js（保留 jsonFile.js 与新测试）→ 直跑 **FAIL**，失败信息逐字为报告所写的第 ③ 条 `ensureTree 应清理 *.tmp-<pid>-<时间戳> 残留`（先失败、后通过）。
  - 改动前后：`tests/m14.test.cjs` 均 PASS；流程 `--only F07,F73` 改动前后均 **F07 40/40、F73 5/5**，不差于基线。
  - 关联套件 `node scripts/run-tests.mjs settings-file memory-atomic m14` → 3 通过 / 0 失败（settings-file 覆盖 jsonFile.js 静态断言）。
  - `npm run typecheck` → exit 0。
  - `node scripts/run-tests.mjs --list | tail -1` → `{"electron":35,"electron-node":62,"system-node":8}`（105 个，报告 104 → +1 electron-node）。
  - `npm test`（无并行负载）→ 105 个 **104 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项），失败集合与 C-44 基线完全一致，无新增失败文件。
- **偏离**：
  1. 无实现级偏离：`writeTextAtomic`、sweep、6 处替换、测试全文均按报告逐字落地（唯一手工调整是 sweep 代码块的缩进对齐 ensureTree 函数体）。
  2. 操作性提示（留档）：直跑该测试用完整 Electron（不带 `ELECTRON_RUN_AS_NODE=1`）会在成功后挂住——完整 Electron 主进程不因脚本结束而退出；runner（electron-node）与带 env 的直跑都正常，测试本身无问题。
  3. 测试副产物 `tests/m15r.activity.bundle.cjs` / `tests/m15r.layout.bundle.cjs` 全量后变脏，提交前已还原；提交用显式路径（3 文件）。

### 3.28 C-47 · 导入书籍时「书目」和「正文」分两次提交：写入失败留半条书目与孤儿资产目录

- **提交**：`21bcafc fix(C-47): 导入书目与正文同一事务——写入失败不再留半条书目与孤儿资产目录`；合并 `97e0aca`。
- **改动**（2 文件，+132/−65）：
  - `electron/db.js` 三个导入函数按报告整段替换（其余语句逐字相同，仅三点变化：全部写入包进 `withTransaction`、删函数末尾 `persist()`、EPUB/通用导入失败且书目未落库时删本次新建的 `assets/<itemId>/` 目录后 rethrow）：
    * `createFromPaste`（:1201）：两条 INSERT 包进 `withTransaction`，无文件写入。
    * `createFromEpub`（:1368）：封面/原文件写盘 + `addAssetRow` + 两条 INSERT 全部包进 `withTransaction`；catch 里 `!rowExists("library_items", itemId, false)`（第三参 false = 不滤软删，判「行是否已落库」）时 `fs.rmSync(dir, {recursive, force})`——persist() 在 COMMIT 后抛错时行已落库、文件保留。
    * `createImportedDoc`（:1440）：原文件/内嵌图写盘 + 资产行 + 两条 INSERT 同一事务 + 同款 catch 清理。
  - 新增 `tests/import-atomic.test.cjs`（`@runtime: electron`，报告全文原样）：第二连接装 `BEFORE INSERT ON documents RAISE(ABORT, 'c47-injected')` 触发器模拟第二条 INSERT 失败 → 三种导入必须抛错、不留书目、不留资产目录；撤触发器后三种导入正常且有正文。
- **验收（2026-10-24，Windows；Electron 31.7.7 / Node 24.18.0）**：
  - 改动前锚点：`rg "createFromPaste\(|createFromEpub\(|createImportedDoc\(" electron` → 仅 db.js 3 个定义 + main.js 8 处调用（:411/:436/:467/:486/:503/:566/:584/:643）；main.js 无 `withTransaction`，无嵌套事务。三个函数逐行对照报告「原代码」，无审计后新增语句。
  - **TDD 差分**：先落测试、未改代码直跑 → FAIL，失败信息逐字为报告所写 `失败的导入不得留下书目：C47-粘贴`（第一条 INSERT 已自动提交、第二条失败，半条书目留在库里 = 缺陷现场）。
  - 改动后 `node scripts/run-tests.mjs import-atomic` → **1 通过 / 0 失败**；直跑输出 `import-atomic: 通过（3 种导入 × 失败回滚 + 正常写入）`（与报告验收文案逐字一致）、exit 0。
  - 关联套件：`node scripts/run-tests.mjs persist library-author` 改动前后均 **2 通过 / 0 失败**。
  - 流程：`--only F02,F25,F40,F88` 改动前后各一轮——F02 **42/42**、F25 **22/22**（均 PASS）；F40 **152/168**、F88 **3/4**（失败条目与基线逐条逐序一致：F40 的 16 败均为时序/内存预算与对抗语料既有项，F88 的 1 败为 blocks_json 判据既有项），不差于基线。
  - `npm run typecheck` → exit 0。
  - `node scripts/run-tests.mjs --list` 分布 → **62 electron-node / 36 electron / 8 system-node**（106 个，报告 105 → +1 electron）。
  - `npm test`（无并行负载）→ 106 个 **105 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项），失败集合与 C-46 基线完全一致，无新增失败文件。
- **偏离**：
  1. 无实现级偏离：三个函数与测试全文均按报告逐字落地；报告原代码行号 :1179/:1263/:1324 已漂移至 :1201/:1368/:1440（前序项所致），按锚点定位。
  2. F40 流程会重写语料 PDF（索引内 LF 规范化版本被还原为工作树 CRLF 字节），与 bundle 副产物一并提交前还原；提交用显式路径（2 文件）。

### 3.29 C-48 · 旧版 FSRS 优化参数迁移覆盖了自己刚写下的指针

- **提交**：`d249718 fix(C-48): v23 FSRS 迁移指针与删旧字段同一 writeSettings——不再被旧快照覆盖回落默认参数`；合并 `16e36f3`。
- **改动**（2 文件，+45/−1）：
  - `electron/db.js`（:539-551）：v23 迁移段按报告整段替换——`setActiveFsrsConfig(id);` 换成 `s0.app.fsrsConfigId = id;`（设指针与删旧字段同一次 `writeSettings` 完成），并按报告加 3 行 C-48 注释；段内其余语句逐字不变。C-10 后 `setActiveFsrsConfig` 写 app_meta、旧快照只覆盖 settings，但真正旧库升级路径（首次 initDb、app_meta 未建表）`writeAppMeta` 回落 settings 后照样被覆盖——本修复消除两种形态；指针随后由 initDb 末尾 `migrateSettingsFactsToAppMeta`（:964）照常搬入 app_meta。
  - 新增 `tests/fsrs-weights-migration.test.cjs`（`@runtime: electron`，报告全文 + 一处 Windows 适配见偏离 2）：预写含 `fsrsWeights`（21 数）+ `c48Keep` 的 settings.json → 首次 `initDb` → 断言指针存在 / 旧字段已删 / 其他设置保留 / 活跃配置 = 指针所指 optimizer 行 / 权重 deepEqual。
- **验收（2026-10-24，Windows；Electron 31.7.7 / Node 24.15.0）**：
  - 锚点：报告原行号 :518-527 漂移至 :539-548（前序项所致），段落与报告证据代码逐字一致后替换。
  - **TDD 差分**：先落测试未改代码 → `node scripts/run-tests.mjs fsrs-weights-migration` 失败，断言消息逐字为报告所写 `迁移后 settings.app.fsrsConfigId 必须存在（不得被迁移自己的旧快照覆盖掉）`；改后 → **1 通过 / 0 失败**（726ms），main 合并后复跑同样 PASS。
  - **F43 C2 段**：流程本体在 A3 段确定性崩溃（`audit(fileA)` sql.js 读 D137 后 better-sqlite3 落盘文件报 `database disk image is malformed`，进度账 C-10 偏离 6 已登记的既有夹具问题，C2 段（:811 起）根本执行不到；改动前后 F43 签名同为 8/10）。改用**临时探针**（`tests/tmp-c48-c2-probe.cjs`，用后已删）按 F43 C2 段源码逐句复刻判据（盘上审计换 better-sqlite3 只读，查询等价）：改动前 **5 过 / 3 败**（C2a-3 / C2a-5 / C2c-3 红 = stale write 现场逐字复现），改动后 **8/8 全绿**（C2a-0/2/3/4/5、C2b、C2c-3/4）。
  - 关联套件：`node scripts/run-tests.mjs m13 persist schema-version m14 undo m12 legacyBackfill` 改动前后均全过（后 7 通过 / 0 失败）。
  - `npm run typecheck` → exit 0。
  - `node scripts/run-tests.mjs --list` → **62 electron-node / 37 electron / 8 system-node**（107 个，报告 106 → +1 electron）。
  - `npm test`（无并行负载）→ 107 个 **106 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项），失败集合与 C-47 基线完全一致，无新增失败文件。
  - **报告第 3 步只读检查**（副本上跑，源目录零写入）：真实开发数据输出 `pointer: "cfg-default"` / `legacyWeightsStillPresent: false` / `optimizerRows: []`——零 optimizer 行 ⇒ v23 迁移从未在该数据触发，**未受影响**，无需用户决策；检查脚本与副本（`tests/tmp-audit/`）用后已删，未入库。
- **偏离**：
  1. **F43 流程本体无法复跑**（见验收）：A2/A2b/A3 的 sql.js 覆盖注入与 D137 better-sqlite3 不兼容是 C-10 偏离 6 已登记的既有阻塞，非本项引入、也未在本项内修（超范围）；C2 段判据以逐句复刻探针覆盖（先红后绿），**F43 A3 夹具修复建议主控单列**。探针同时观察到：C-10 的 app_meta 优先写入使「两段 boot」场景（F43 C2a 形态）下活跃配置在**修复前**也已由 app_meta 救回（C2a-4/C2b 修复前即绿）——但报告验收点名的真实现场「旧库单次升级」（= 新测试场景，app_meta 尚未建表、writeAppMeta 回落 settings 后被覆盖）修复前完全失败，与新测试 TDD 红一致；历史 F43 红档（2026-09-24）产自 C-10 之前的代码。
  2. **新测试末尾 `fs.rmSync` 包了 try/catch**（报告全文唯一改动）：Windows 断言失败路径 `closeDb()` 未执行，打开的 better-sqlite3 连接使 rmSync 抛 EBUSY、挡住 `app.exit` → 首跑 180s 超时（Linux unlink 语义无此问题，报告在 Linux 验证；与 C-19 偏离 5 同族）。包后失败路径 779ms 干净失败（exit 1），成功路径 `closeDb` 后正常清理；断言语句零改动。
  3. C2c 的 `renameSync(library.db)` 注入自 D137 起已死（persist 不再改名 library.db），C2c-1 在探针中 err=null（该项不在 C-48 验收清单，仅记录）；C2c-3/4 按现存判据复刻评估。
  4. 边缘语义注记（未改行为，仅记录）：修复后若「app_meta 已有指针 + 恢复了带 fsrsWeights 的旧 settings」混合态，`migrateSettingsFactsToAppMeta` 不覆盖既有 app_meta 指针 → 活跃配置仍取库内旧指针（C-10「库内事实优先」语义）；修复前该边缘态会被 setActiveFsrsConfig 改写成迁移行。报告修复代码即 `s0.app.fsrsConfigId = id` 字面行为，未另行发明。
  5. 测试副产物 `tests/m15r.activity.bundle.cjs` / `tests/m15r.layout.bundle.cjs` 全量后变脏，提交前已还原；提交用显式路径（2 文件）。

### 3.30 C-24 · Electron 31 → 45 升级 + 放弃 ia32（D-01）+ Wayland 保底 + keyVault 异步化（D-10）

- **决策**：D-10 = Electron 45（2026-10-24 用户答复）；D-01 = 放弃 ia32（同日答复）。见 §1 决策记录。
- **提交**（分支 `upgrade/electron-45`，9 个）：
  - `0674ec5` chore: 升级 Electron 31.7.7 → 45.0.0；better-sqlite3 v12 → v13.0.3（NAPI 内置预编译，D137 升级后战略选项）
  - `1debf57` fix: console-message 迁移到事件对象参数（Electron 35 弃用位置参数）
  - `a1f37a2` fix: import-atomic 清理对 Electron 45 GPU 磁盘缓存写入竞争免疫
  - `e5710e1` fix: library:list 启动闸——E45 渲染层挂载快于 initDb 建列，新库首启不再空书架
  - `c50de42` chore: 放弃 ia32（D-01）——README 写明 Windows 10/11 64 位（x64 / ARM64），Electron 徽章 31→45
  - `c48b457` fix: Linux 默认 XWayland——Wayland 会话下结构图谱/捕获窗口的程序化定位能力保底
  - `00224bc` fix: keyVault 迁移 safeStorage 异步 API（C-20 TODO 收口）——getAIConfig/setAIConfig 变 async，调用方全量加 await
  - `cad9546` test: m15 系测试适配引擎异步化——graph*/preview 调用点加 await，mock 桥 inv 先 await 再 clone
  - `bcefe2a` fix: 首启竞态闸扩展——mindmap:pendingRuns 走 dbReadyGate，plugins:getActive 提前注册 + init 放行
- **验收（2026-10-24，Windows；Electron 45.0.0 / better-sqlite3 13.0.3 / SQLite 3.53.4）**：
  - `npx electron -v` → v45.0.0；`ELECTRON_RUN_AS_NODE=1 npx electron -e "...better-sqlite3..."` → sqlite 3.53.4（ABI 就绪）。
  - `npm run typecheck` → exit 0；`npm run build` → 成功。
  - `rg "safeStorage\.(isEncryptionAvailable|encryptString|decryptString)\(" electron` → **0 命中**（全部异步化，keyVault.js 为唯一入口）。
  - 首启竞态：隔离 userData 干净首启 app.log **0 条 Error**（library:list / mindmap:pendingRuns / plugins:getActive 三处闸全生效；闸前曾复现 no such column li.author、no such table material_map_runs、No handler registered）。
  - `npm test` → **107 个 106 过 / 1 败 / 0 超时**，唯一失败 = applog（§1.1 既有项），失败集合与 C-24 前基线完全一致。
  - GUI 冒烟（隔离 userData + CDP，报告第 4 步可自动化子集）：**8/9 过**——① 启动 #root 挂载；② EPUB 建册（真实 IPC createFromEpub）+ 书架列表；④ 手动制卡（cards:create）；⑤ todayQueue 含新卡；⑥ 备份创建 + 列表；⑦ 设置页可开。③ EPUB 阅读正文渲染：冒烟内联轮询未命中（探针时序伪差），但**独立调试探针 body.innerText 含正文 + 冒烟截图目视确认阅读器已渲染**，判定通过。**未验项（需人工/网络/Linux 实机）**：PDF 文件导入、逐页翻页、摘录交互、AI 制卡（无 Key）、截图制卡（CAPTURE_DISABLED）、托盘菜单、全局快捷键、检查更新、Wayland 实机（U-03）；其中窗口类由 workbenchWindow / lensWindow / csp-enforcement 等真实 Electron 套件在 E45 全量中覆盖。
- **破坏性变更对照（32.0 → 45，官方 breaking-changes 页逐 API rg 全仓）**：
  | 版本 | 条目 | 命中 | 处理 |
  |---|---|---|---|
  | 45 | safeStorage 同步 API 弃用 | keyVault.js | ✅ 异步化（00224bc） |
  | 45 | 沙箱 preload 移除 Node shim（Buffer/setImmediate/require('events') 等） | preload*.js 0 命中 | 无 |
  | 45 | getUserMedia chromeMediaSource 拒绝 WebContents source id / window.open 子窗沙箱 / contentTracing / ASAR fd | 0 命中或无该用法 | 无 |
  | 44 | clipboard 富 API 移除 + 渲染层 clipboard 移除 | 只用 readText/writeText（W3C 对齐保留）；渲染层无引用 | 无 |
  | 44 | ia32/armv7l 移除 | D-01 放弃 | ✅ c50de42 |
  | 44 | openAsHidden 移除（登录项）/ net.request frame / macOS 12 | 0 命中 | 无 |
  | 43 | 对话框默认目录 / showHiddenFiles / 圆角 / toBitmap 色彩空间 | 对话框均显式 defaultPath；余 0 命中 | 无 |
  | 42 | postinstall 不再下载 electron / UNNotification / OSR DSF | 升级流程显式 npm i；无 Notification API 用法 | 无 |
  | 41/40 | PDF OOPIF / clipboard 渲染层弃用 / dSYM | pdf.js 应用侧管线不受 OOPIF 影响 | 无 |
  | 38 | plugin-crashed / OZONE_HINT / routingId / macOS 11 | 0 命中 | 无 |
  | 36 | app.commandLine 大小写 / 扩展 API 弃用 / getBitmap | appendSwitch 值均小写；0 命中 | 无 |
  | 35 | **console-message 位置参数弃用** | main.js（生产）+ tests/pdf.kernel.cjs、tests/reader.kernel.cjs（测试辅助） | ✅ 生产已迁事件对象（1debf57）；kernel 辅助仍用弃用位置参数（45 仍可用，测试基建另行更新） |
  | 35 | WebRequestFilter urls 缺省 | 无 webRequest 用法 | 无 |
  | 33 | 自定义协议 Windows URL 处理变化 | bookasset/pdfres（protocol.handle） | 实测无回归（bookasset-path 套件 + 冒烟 EPUB/备份全过） |
  | 32 | File.path / WebContents 导航方法弃用 | 0 命中（报告已确认） | 无 |
  另有两处**运行期发现**的 E45 行为适配：a1f37a2（GPU 磁盘缓存写入竞争——import-atomic 清理与新 Chromium 缓存文件并发）、e5710e1 + bcefe2a（渲染层挂载变快暴露的三处首启竞态闸）。
- **偏离**：
  1. **better-sqlite3 v12 → 13.0.3**：报告只要求「按流程获取新 ABI 二进制」；v12 系对 Electron 45 ABI（NODE_MODULE_VERSION 145+）无官方预编译，pin 脚本改装 v13（NAPI 预编译、免 ABI 钉扎——D137 的「钉扎」工作流在 v13 下退化为版本选择）。属升级目标的必要伴生。
  2. **执行事故与接管**：本项由子代理会话执行至约 80%（6 提交）时死于平台并发限流（keyVault 异步化半途）；主控接管补完（ai-keyvault 与 m15 系 5 套件的 async 适配、首启闸扩展、冒烟、账本）。子代理派发曾连续返回「model concurrency limit exceeded」但**服务端仍实际启动了执行**——后续会话派发失败时必须先检查仓库现场（分支/脏文件/mtime/进程）再重试，防双写（纪律已入 §5）。
  3. 冒烟 ③ 的判定采用「独立探针 + 截图」双证据而非冒烟脚本内联断言（内联轮询未命中的原因未深究，探针伪差）；Wayland（U-03）按报告代码落地但无 Linux 实机验证。
  4. kernel 测试辅助（pdf/reader.kernel.cjs）仍用 console-message 弃用位置参数——45 下仍工作，未在本项顺带改（避免触碰与升级无关的测试基建），留待后续。
  5. 临时探针（tmp-c24-smoke / tmp-c24-dbg / tmp-c24-fresh）已全部删除未入库；冒烟截图留在 tests/flows/results/（不入库）。

### 3.31 C-25 · macOS：去掉应用菜单导致 Cmd+C / Cmd+V / Cmd+Q 失效

- **提交**：`830e682 fix(C-25): macOS 应用菜单——appMenu.js 三菜单模板，非 mac 保持 null`；合并 `d7c72d2`。
- **改动**（3 文件，+37/−1）：
  - 新建 `electron/appMenu.js`（报告代码原样，仅加 C-25 头注释）：`buildAppMenuTemplate(platform = process.platform)` 非 darwin 返回 `null`、darwin 返回 `[{role:"appMenu"},{role:"editMenu"},{role:"windowMenu"}]`（不放 viewMenu，避免 Cmd+R 误刷新）；`applyAppMenu()` = `Menu.setApplicationMenu(tpl ? Menu.buildFromTemplate(tpl) : null)`。
  - `electron/main.js`（锚点 :2144，报告原 :2100 漂移——前序项所致）：`Menu.setApplicationMenu(null);` → `require("./appMenu").applyAppMenu();`（加一行 C-25 注释；仍在 whenReady 内、C-09 权限处理器与 `createWindow()` 之前，位置不变）。
  - 新增 `tests/app-menu.test.cjs`（`@runtime: electron-node`）：`require.cache[require.resolve("electron")] = { exports: { Menu: {} } }` 桩后加载 appMenu.js；win32 / linux → `null`，darwin → role 序列 `["appMenu","editMenu","windowMenu"]`。
- **验收（2026-10-24，Windows；Electron 45.0.0）**：
  - 改动前基线：`npm test` → **107 个 106 过 / 1 败**（唯一失败 applog，与 §5 记录一致）。
  - `node scripts/run-tests.mjs app-menu` → **1 通过 / 0 失败**（57ms）。
  - **Windows 实机菜单注册探针**（临时脚本，已删；真实 Electron 45 无头）：win32 上调用 `applyAppMenu()` 后 `Menu.getApplicationMenu() === null`（调用前是 Electron 默认菜单 File/Edit/View/Window，调用后清空——与旧代码 `setApplicationMenu(null)` 行为一致，Windows/Linux 无回归）。
  - **darwin 接线离线探针**（临时脚本，已删；electron-node + stub Menu + `Object.defineProperty(process,"platform")` 临时改 darwin）：`applyAppMenu()` 恰好走 `buildFromTemplate(三 role 模板)` → `setApplicationMenu(其返回值)` 各一次。
  - **步骤 3 静态核实**（Cmd+Q 与收托盘不冲突）：mac 应用菜单 `role:"appMenu"` 内置的退出项触发 `app.quit()` → `before-quit`（main.js:2382）置 `appQuitting = true` → 主窗口 `close` 处理器（:2081 `if (appQuitting) return;`）放行销毁，`workbench/lens/quickCapture` 的 `prepareQuit()` 同批置位——收托盘不会拦截 Cmd+Q，无需另改（与报告结论一致；报告原 :2280 漂移至 :2382）。
  - `npm run typecheck` → exit 0。
  - `node scripts/run-tests.mjs --list | tail -1` → `{"electron":37,"electron-node":63,"system-node":8}`（108 个，报告 107 → +1 electron-node）。
  - `npm test`（无并行负载）→ **108 个 107 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项），失败集合与基线完全一致，无新增失败文件。
  - 合并后 main 上复跑 `node scripts/run-tests.mjs app-menu` → 1 通过 / 0 失败。
- **偏离**：
  1. **mac 实机验证未执行（本机 Windows）**：报告验收的「输入框与 Markdown 编辑器内 Cmd+C/V/X/A/Z 可用；开『关闭到托盘』时 Cmd+Q 仍能退出」无法离线复现，按报告口径记「**未验证**」；可离线部分以三平台模板单测 + win32 实机注册探针 + darwin 接线离线探针 + 步骤 3 静态调用链覆盖。
  2. `main.js` 顶部解构的 `Menu` 在 main.js 内不再被使用（唯一调用点移入 appMenu.js）；报告未要求动 import，按最小 diff 保留（仓无 lint 闸门，零运行时影响）。
  3. 测试首行加了显式 `// @runtime: electron-node`（报告未写头；与 userData.test.cjs 等既有 C 项测试口径一致），不依赖 runner 的默认分类。
  4. 测试副产物 `tests/m15r.activity.bundle.cjs` / `tests/m15r.layout.bundle.cjs` 全量后变脏，提交前已还原；提交用显式路径（3 文件）；两个临时探针脚本用后已删，未入库。

### 3.32 C-26 · 快捷键跨平台：物理键识别、Mod 抽象、默认键位（D-03=B）、mac 全局快捷键默认值

- **决策**：D-03 = **B（Alt 系）**于本项执行中途由主控转达用户答复（2026-10-24）——本会话按「步骤 3/4 禁做」启动，收到决策后在同一轮补齐全部四步；已登记 GUIDE §8.1 **D207**（v49.36），文档先行（`c7f5c97`）。
- **提交**：`c7f5c97 docs(C-26): GUIDE v49.36——M4 锁定表阅读默认键位改 Alt 系 + D207 决策登记（D-03=B）`；`987c0a3 fix(C-26): 快捷键跨平台——物理键回落、Mod 抽象、默认键位 Alt 系（D-03=B）、mac 全局快捷键默认值`；`aaf95e3 fix(C-26): f20 焦点守卫事件同步 Alt+Z`；合并 `70fd0ba`（分支 `fix/c26-keymap-crossplatform`）。
- **改动**（15 文件，+7425/−115）：
  - `src/lib/commands.ts`：①`IS_MAC`（navigator.platform/userAgent，模块加载期求值、导出供设置页用）与 `keyFromCode(code)`（`Key[A-Z]`→字母、`Digit[0-9]`→数字、其余 null）；②`eventToCombo` 在 Space 归一后加物理键回落——`nonAscii`（单字符且非 \x20-\x7e）或 mac+Alt 时以 `keyFromCode(e.code)` 替换 `e.key`，code 缺省/非字母数字键保持原行为；③`ComboInput` 加 `code?: string`（Pick 交叉 `{ code?: string }`，保持可选——真实 KeyboardEvent 天然携带，两个 SettingsPanel 捕获点无需改对象构造）；④`resolveMod`（`(^|\+)Mod(?=\+)` → IS_MAC ? Meta : Ctrl）导出，**只接在 `getBinding` 唯一出口**（默认值与用户覆盖共用该函数），存储串保持写法原样、`conflictWith`/`getAllBindings` 全部经 resolved 值比较；⑤`displayCombo`（mac 上 Meta→⌘、Alt→⌥，仅显示层）导出；⑥阅读五条默认键改 Alt 系：makeCard `Alt+Z`、aiCards `Alt+C`、aiExplain `Alt+E`、extract `Alt+X`、lookupWord `Alt+D`（review 侧 12 条与 turnPrev/turnNext 不动）。
  - `electron/quickCapture.js`：`DEFAULT_ACCEL_CAPTURE` 平台分支——`process.platform === "darwin" ? "Cmd+Shift+Space" : "Ctrl+Alt+Space"`（Windows/Linux 逐字节不变）；注册失败提示复用既有 `tryRegister → status.error → 设置页「被占用」`链路（报告「注册失败时应提示用户改键」的既有机制），未新增 UI；`Ctrl+Alt+N` / `Ctrl+Alt+K` 不动。
  - `src/components/SettingsPanel.tsx`：应用内键位与全局快捷键两处显示改 `displayCombo(binding)`（`customized`/`isDefault` 比较保持原始串）；`DEFAULT_GLOBAL_SHORTCUTS.quickCapture.accelerator` 同步平台分支（`IS_MAC ? "Cmd+Shift+Space" : "Ctrl+Alt+Space"`，与主进程一致——重置按钮与 isDefault 判定同源）；多段选择修饰键提示文案的键位示例更新为 Alt 系。
  - `src/components/SelectionMenu.tsx`：浮条四个 tooltip 字面量更新为新默认键位（就地制卡 · Alt+Z / AI 制卡 · Alt+C / AI 解释 · Alt+E / 查词 · Alt+D）+ 注释；`src/components/Reader.tsx:1718` 注释同步。
  - `src/i18n/locales/en.ts` / `ja.ts`：上述 5 个 zh 键同步改（key 与 value 一致改），`i18n-check` 1801 键 OK。
  - 新增 `tests/commands-combo.test.cjs`（`@runtime: system-node`，28 断言）：esbuild 现打包 commands.ts（platform neutral → `tests/tmp-commands-combo/`，不提交），`Object.defineProperty(globalThis, "navigator")` 在 require 前注入 → 双实例（MacIntel / win32）分别覆盖 IS_MAC 两分支；含报告验收四断言、修饰键顺序、Tab 不回落、Digit 回落、code 缺省旧行为（Ctrl+ч→Ctrl+Ч 既有大写归一）、resolveMod/displayCombo 三态、COMMANDS 17 条默认键逐条守卫（D-03=B 清单）、quickCapture 与设置页平台分支静态守卫。
  - 过期期望更新（C-05 手法，未删测试）：`tests/m4.test.cjs` M4-1 LOCKED 表 13→17 条（**陈旧跟踪产物掩盖期望过期**，见偏离 2）+ 阅读四键改 Alt 系；`tests/flows/f60-key-command-matrix.cjs` GUIDE_TABLE 五键 + S4 探针 combo/标签改 Alt 系（原生 Ctrl+A 全选按 D207 还给系统的口径改写）；`tests/flows/f20-command-contract.cjs` W3 焦点守卫事件 Ctrl+Z→Alt+Z（保持「不守卫就命中」的差分力）；`tests/m4.gui.mjs` 键事件 `{key,altKey}` 化 + 标签/注释同步；`tests/m4.cleanup.cjs` 注释同步；跟踪产物 `tests/m4.commands.bundle.cjs` 按文件头命令重打包。
- **验收（2026-10-24，Windows；Electron 45.0.0）**：
  - 改动前基线：`npm test` → **108 个 107 过 / 1 败 / 0 超时**（唯一失败 applog，§1.1 既有）。
  - `node scripts/run-tests.mjs commands-combo` → **1 通过 / 0 失败**（直跑 28/28 断言全过；报告四断言在其中第 1 节逐字覆盖）。
  - `node scripts/run-tests.mjs m4 commands-combo` → 2 通过 / 0 失败（bundle 重建 + LOCKED 表补齐后）。
  - `npm run i18n:check` → `t() 字面量键 1801 个 / OK`（+4 净增：tooltip 4 键改写）。`npm run typecheck` → exit 0。`npm run build` → 成功（7.12s）。
  - **F20 键盘命令契约流程实跑**：`node tests/flows/run.cjs --only F20 --cycles 1` → **PASS 26/26 断言**（W1 GUIDE 锁定表 ↔ COMMANDS 逐条对表含新 Alt 系、W2 归一化矩阵、W3 焦点守卫 Alt+Z、W4 三道闸、W5 覆盖项、quickCapture 对表全绿）。
  - `npm test` → **109 个 108 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项）；失败集合与基线完全一致，无新增失败文件。
  - `node scripts/run-tests.mjs --list | tail -1` → `{"electron":37,"electron-node":63,"system-node":9}`（109 个，108 → +1 system-node）。
  - 合并后 main 上复跑 `commands-combo` + `m4` → 2 通过 / 0 失败；`npm run typecheck` → exit 0。
- **偏离**：
  1. **执行中途收到 D-03 决策**：任务以「步骤 3/4 禁做（部分完成口径）」派发，主控在基线确认后转达用户答复 D-03=B；按追加指示在同一轮补齐步骤 3/4，C-26 状态记「完成」而非「部分」。
  2. **`tests/m4.commands.bundle.cjs` 陈旧产物掩盖 m4 期望过期**：该跟踪产物是 m4.test.cjs 的依赖（旧打包，COMMANDS 只有 D130 前的 13 条），基线里 m4「假绿」；重建后「共 13 条命令」即失败——按 C-05 手法把 LOCKED 表补齐到真实 17 条（含 lookupWord/turnPrev/turnNext/disambiguate 四条既有命令 + 阅读四键 Alt 系），未放宽任何断言。**教训已入 §5：改 commands.ts 必须重打包该产物**。
  3. `commands-combo.test.cjs` 断言超报告四条：报告只给四断言；本测试另加修饰键顺序 / Tab 不回落 / Digit 回落 / code 缺省旧行为 / resolveMod·displayCombo 三态 / 17 条默认键逐条守卫 / quickCapture·设置页平台分支静态守卫（机械可查，防回归）。
  4. 首版测试对「Ctrl+ч（无 code）」期望写成 `Ctrl+ч`，被差分拦截——既有代码对单字符统一大写（ч→Ч），旧行为实为 `Ctrl+Ч`；修正期望并加注说明（非产品行为变更）。
  5. mac 显示（Meta→⌘ / Alt→⌥）只接了报告点名的**设置页**两处（应用内键位 + 全局快捷键）；`bindingHint`（ReviewView 按钮提示）与 SelectionMenu tooltip 未接 displayCombo——前者报告未要求，后者提示串直接改成新默认键位字面量（既有硬编码模式，改造成动态取值属重构、超范围）。mac 实机未验证（本机 Windows），mac 路径由双实例单测 + 静态守卫覆盖。
  6. `JournalView.tsx:38` 的 `useState("Ctrl+Alt+Space")` 未动——D159 日记功能整体停用、视图不在场；重实装时应同步 quickCapture 的平台分支（见 §5）。
  7. GUI 套件 `m4.gui.mjs` 键事件与文案已同步 Alt 系但**未实跑**（需 npm run build + 真实应用 CDP，按 C-02 先例仅做 esbuild 解析校验 M4GUI_PARSE_OK）。
  8. 测试副产物 `tests/m15r.activity.bundle.cjs` / `tests/m15r.layout.bundle.cjs` 全量后变脏，提交前已还原；提交用显式路径（13 文件），`tests/tmp-commands-combo/` 为新测试运行时产物（`tests/tmp-*` 已忽略）。
  9. **主控对抗式审查补漏（P2 活规格残留）**：审查发现 GUIDE §6.2 M5 手动制卡段 :679「快捷键 Ctrl+Z」未随 D207 改键（该「快捷键」即 `reader.makeCard`——Reader.tsx:1722 `run: () => selAct.manual()` 与选区菜单同源，GUIDE :1149 D141 段自证「制卡快捷键 = reader.makeCard」）。执行会话全 GUIDE 重扫（大小写不敏感 `ctrl[ ＋+]*[z/x/a/s/d]` 含全角＋/空格变体 + Cmd/Control/⌘ 形式）确认**唯一残留**：其余 10 处 Ctrl+Z/X/A/S/D 命中分类为——:617/:1298 D98 编辑器内部撤销栈（自有键）、:682/:683/:1074/:1089 跨类撤销与批量回退 undo:last（D-03「Ctrl+Z 还给撤销」的正主）、:1375/:1429/:1523 §8.1 历史决策（不改写）、:1660 M4 表注记（有意沿革说明）。漂移校正提交 `6776636 docs(C-26): GUIDE §6.2 M5 手动制卡入口快捷键对齐 D207（Alt+Z）`（单行修正 + 沿革注记，diff 恰 1 插 1 删）、合并 `3643279`；不 bump 版本、不新增 D 号（v49.36/D207 已是现行契约）。闸门复跑：F20 **PASS 26/26**（与基线一致）、F11 **14/16**（2 败 = 既有 L1 vendor/kpScopes.js 与 L6 表数声明，§5 记录在案，无新增失败）。教训：c7f5c97 只更新了 §9.1 表 + D207 + 版本号，漏了活规格散文里的键位重述——**改默认键位时须对 GUIDE 做「绑定表 + 散文重述」双面扫描**（重述点 = 该命令的所有入口描述，参照 :1149 这类「快捷键 = 命令 id」的配对句式定位）。

### 3.33 C-27 · 输入法（IME）组字时按回车被误提交

- **提交**：`8570950 fix(C-27): IME 组字时 Enter/Escape 不再误提交——统一 isImeComposing 守卫`；合并 `6218de8`（分支 `fix/c27-ime-enter-guard`）。
- **改动**（20 文件，+66/−8）：
  - 新建 `src/lib/ime.ts`（报告给定代码逐字）：`isImeComposing(e)` = `Boolean(ne.isComposing) || ne.keyCode === 229`，React 合成事件取 `nativeEvent`，对 undefined 字段返回 false（f20 等测试投喂事件不含组字字段 → 不破坏既有焦点守卫差分）。
  - 报告 14 文件加首行守卫 `if (isImeComposing(e)) return;` 共 **28 处**——覆盖每个处理 Enter **或 Escape** 的 keydown 处理器（报告步骤 2「处理 Enter（以及 Escape）」口径，含 document/window 级 Escape-only 监听）：Bookshelf 3（目录 Esc 收菜单监听 / onCardKeyDown Enter+Space / 重命名输入 Enter+Esc）、CaptureEditor 1（Ctrl+Enter 发送）、CardBrowser 4（方案菜单 Esc 监听 / 方案编辑器 Esc / 牌组名 Enter / contentEditable Esc 失焦）、ExtractReviewView 1（window onKey：Esc/Space/Enter/z）、JournalView 1、KnowledgeManager 1（行内箭头函数改块）、Reader 3（多段选集 Esc 监听 / 工具菜单 Esc 监听 / 主题命名输入）、SelectionMenu 1（批注 Ctrl+Enter/Esc）、SettingsPanel 5（两个模型下拉 Esc / 主题重命名 Enter+Esc / 两处键位捕获 onKey）、TagInput 1、GrowthEventsWidget 1、NativeLangsPicker 2（capture 层 Esc 拦截 / 自定义语言 Enter）、AnnotationPanel 3（菜单 Esc 监听 / 条目 Enter+Space / 编辑 textarea Esc+Ctrl+Enter）、MindmapTab 1（Esc/方向键/Enter/Space 同一 handler）。仅处理其他键的处理器未动（见偏离 1）。
  - 3 个已有判断文件收敛为同一写法（报告步骤 3，仅替换不新增）：AIPanel 2 处、ManualCardEditor 2 处、SelectionPanels 1 处 `!e.nativeEvent.isComposing` → `!isImeComposing(e)`。修正复审（`6b5ea08`）再为 AIPanel 内联编辑与 SelectionPanels trio onKey 各补 1 处首行守卫、并移除 AIPanel 的冗余内联条件（见偏离 3）。
  - `src/lib/commands.ts`：`install()` 的 window keydown（capture）回调首行加 `if (isImeComposing(e)) return;`（报告步骤 4「window keydown 处理开头」；`dispatchKey` 纯逻辑签名是 ComboInput，不接该守卫，见偏离 4）。
  - `tests/m4.commands.bundle.cjs` 跟踪产物重打包（+7 行，ime.ts 函数入包；cmp 确认与现打包输出逐字节一致）。
- **验收（2026-10-24，Windows；Electron 45.0.0）**：
  - 改动前基线：`npm test` → **109 个 108 过 / 1 败 / 0 超时**（唯一失败 applog，§1.1 既有）。
  - 报告验收 1：`for f in $(rg -l 'key === "Enter"' src); do rg -q "isImeComposing" "$f" || echo "缺: $f"; done` → **输出为空**（17 文件全含 isImeComposing；清单外无第 18 个 Enter 文件）。
  - 报告验收 2：`rg -l "isComposing|keyCode === 229" src` → **仅 `src/lib/ime.ts`**（全仓只有一种写法）。
  - `npm run typecheck` → exit 0。
  - `npm test` → **109 个 108 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项）；失败集合与基线完全一致，无新增失败文件。
  - `node scripts/run-tests.mjs m4 commands-combo`（bundle 重建后）→ 2 通过 / 0 失败；合并回 main 后复跑同样 2 通过 / 0 失败。
  - **F20 键盘命令契约流程**：`node tests/flows/run.cjs --only F20 --cycles 1` → **PASS 26/26**（W3 焦点守卫等差分不受 install() 守卫影响）。
  - **手工验收的自动化替身（隔离 GUI 差分探针，临时脚本已删）**：真实 OS 输入法无法由程序驱动，按 C-08/C-09 先例克隆 `tests/d106.gui.mjs` 模式（`M7_TEST_USERDATA` 隔离 userData + `tests/d106.gui.seed.cjs` 播种 + `npm run build` 后 dist + CDP），在真实应用复习页快捷打标的 TagInput 上注入 `KeyboardEvent` 差分事件 → **12/12 通过**：组字 Enter（isComposing:true）不新增标签且输入框文本保留（=候选确认语义）、组字 Enter（keyCode:229）同样拦截（Safari/兜底路径）、组字 Esc 不收建议面板；非组字 Enter 照常提交 `nihao` chip 并清空输入框（=报告「再按一次回车才提交」）、非组字 Esc 照旧收面板（既有行为零回归）。
- **偏离**：
  1. **守卫覆盖口径从宽**：报告步骤 2 字面为「每个处理 Enter（以及 Escape）的 onKeyDown 处理器」，执行时把 14 文件内处理 **Escape-only** 的 keydown 处理器（含 document/window 监听与 SettingsPanel 两处键位捕获 onKey）也加了守卫（否则组字中按 Esc 取消候选词会误收菜单/误关弹层/误捕获成键位，与 Enter 同类缺陷）；仅处理其他键的处理器一律未动（Bookshelf onReorderKeyDown 仅 Alt+方向键、Reader 翻页 onKey 仅 PageUp/PageDown/空格、AnnotationPanel 4 处裸 `stopPropagation` onKeyDown）——「Escape 之外的其他键位」仍按范围外处理。守卫总计 28 处 + commands.ts 1 处。
  2. **手工验收未在真实微软拼音下执行**：真实 IME 的 trusted keydown 无法程序化驱动；以上述差分探针替代（守卫只读 `isComposing`/`keyCode` 两个字段，探针已精确覆盖这两个判定输入的正反两面）。探针脚本与隔离 userData 已删（`tests/tmp-*` 忽略），未入库。
  3. **修正复审补漏（主控对抗式审查派发，`6b5ea08` / 合并 `e1d2abc`）**：收敛 3 文件内尚有**两处未守卫的 Escape 处理器**（与 14 文件的 Escape 守卫口径不一致，属执行漏报）——① `AIPanel.tsx` 内联编辑 onKeyDown：组字 Esc 命中 `else if (e.key === "Escape")` 直接关闭编辑框丢草稿（首版执行仅在偏离里披露、未修）；② `SelectionPanels.tsx` trio 浮层 document 级 `onKey`（**首版完全未披露**：组字 Esc 误关浮层并 `preventDefault()`，后者会放大到独立窗口 workbench 的 `!e.defaultPrevented` 收窗判据）。两处均已补首行守卫；AIPanel 同步移除 Enter 分支冗余内联 `!isImeComposing(e)`（收敛为全仓唯一「首行守卫」写法），SelectionPanels 的 §4.4 单层语义注释原样保留。互斥细节：AIPanel Esc 分支 `stopPropagation` 使「编辑框开着」与「trio 开着」两条误触发路径不会同键连锁。修正后验收：两条 rg 验收不变（空 / 仅 ime.ts）、typecheck 0、全量 **109 个 108 过 / 1 败**（applog，与基线一致）、F20 26/26；未重打包 bundle（commands.ts 未动）。3 收敛文件经全量扫描复核无第三处（ManualCardEditor 零 Escape，其 :223 处理器仅 Ctrl+Shift+C 挖空）。
  4. **commands.ts 守卫落点在 `install()` 监听回调而非 `dispatchKey` 内部**：后者参数类型是 `ComboInput`（结构子集，无 isComposing/keyCode），塞入需类型强转；报告字面「window keydown 处理开头」即 install() 回调。`__testHooks.dispatchKey` 直驱路径不含组字字段，行为不变。
  5. **锚点漂移**（rg 重定位，报告行号仅参考）：ExtractReviewView 677→660（handler）、KnowledgeManager 543→545、Reader 2077→2074、SettingsPanel 1720→1724、CardBrowser 1285→1286；文件清单与 rg 结果逐字一致（14+3，无清单外文件），无需中止。
  6. **运维事故（已处置，不影响产物）**：定位 F60 流程 id 时误用 `node tests/flows/run.cjs --list`（run.cjs 无 `--list` 旗标 → 按默认参数启动 cycles=∞ 全流程 soak）意外拉起全流程循环跑；发现后 `taskkill //T //F` 终结（PID 41432 进程树）。该 soak 跑了 1 轮：F33/F36 等通过；失败 F34 2/2（crash「database disk image is malformed」，与 C-10 偏离 6 同夹具族）、F38 135/144（与 §5 已知清单逐条对应）、F39 63/89（双实例文件锁对手流程）均为既有问题，与渲染层键盘守卫无关。soak 副产物已全部还原/清理（m15r 两 bundle、`f24-coverage-baseline.json`（flowCount 89→90 自愈回写）、f40 corpus 两 PDF、`adapter.f34.bundle.cjs`、`stored-3mb.epub`、`f40cache/`）。**F60 未实跑**：`@gui: true` 流程被 run.cjs 的 allow-gui=false 排除（`--gui` 非其旗标，两次尝试均「0 条流程」）；C-26 验收同样只跑 F20，本项行为差分由探针覆盖。
  7. 测试副产物 `tests/m15r.activity.bundle.cjs` / `tests/m15r.layout.bundle.cjs` 在全量后变脏，提交前已还原；提交用显式路径（20 文件）。

### 3.34 C-28 · 托盘与窗口图标平台适配 + closeToTray 平台默认（D-09=A）

- **阻塞-解封记录**：首派会话因本机无 ImageMagick 按报告 §0 第 7 条**零改动中止**（`magick -version` command not found；winget list / Program Files / %LOCALAPPDATA%\Programs / scoop / choco shims 全查无，`where convert` 唯一命中 Windows 自带 NTFS 转换器）；主控 winget 安装 **ImageMagick 7.1.2-34 Q16-HDRI x64**（`C:\Program Files\ImageMagick-7.1.2-Q16-HDRI\`）后原样重派，报告命令逐字执行。首派勘察（锚点重定位、资产在位）直接沿用。
- **提交**：`357a5eb fix(C-28): 托盘/窗口图标平台适配 + closeToTray 平台默认（D-09=A）`；合并 `be90b2d`（分支 `fix/c28-tray-icon-platform`）。
- **改动**（11 文件，+88/−13）：
  - 4 个新 PNG 产物（报告第 1 步命令逐字；两 ICO 均为 [0]16/[1]24/[2]32 三帧，**最大帧 K=2**）：`electron/icons/trayTemplate.png` 16x16（1061B）、`trayTemplate@2x.png` 32x32（1783B）、`tray-linux-light.png`（源 tray-white.ico）与 `tray-linux-dark.png`（源 tray-black.ico）各 24x24，均 PNG32。
  - `electron/tray.js`：`loadTrayIcon()` 改报告给定平台三分支——win32 明暗 ico（D187 语义不变）/ darwin `trayTemplate.png` + `setTemplateImage(true)` / linux 按主题明暗取 `tray-linux-light.png`（暗任务栏）/`tray-linux-dark.png`（亮任务栏）；回落 `icon.png` 统一 resize 16x16；`module.exports` 增加导出 `loadTrayIcon`（探针用）。
  - `electron/lensWindow.js` 与 `electron/workbenchWindow.js` 的窗口 `icon`（报告 :77 / :58，实测一致）：三元——win32 用 `icon.ico`，其余平台用 `icons/icon-light.png`。
  - 新建 `electron/closeToTray.js`：`closeToTrayEnabled(raw)`（报告第 4 步代码逐字语义——显式 true/false 尊重，未设置按平台默认，linux 关）。
  - `electron/main.js`：顶部 require；写侧归一（报告 :282 → 实际 :298）`value = value !== false` → `closeToTrayEnabled(value)`；win `close` 处理（报告 :2041 → 实际 :2085）`readSettings().app?.closeToTray !== false` → `closeToTrayEnabled(readSettings().app?.closeToTray)`；两处 D123 注释同步 D-09 口径。
  - `src/components/SettingsPanel.tsx` TrayRow（:3075）：`settingsStore.get` 默认值不再硬编码 `true`，改为 navigator 平台探测（`!/Linux/i.test(navigator.platform || navigator.userAgent)`，与 `src/lib/commands.ts` IS_MAC 同法）计算平台默认。
  - 新增 `tests/close-to-tray.test.cjs`（electron-node，mock `process.platform`，11 断言：linux 默认关 + 显式尊重 ×2 + 杂值回落、win32 默认开 + 显式尊重 ×2 + 杂值回落、darwin 默认开、mock 还原）。
- **验收（2026-10-24，Windows；Electron 45.0.0；ImageMagick 7.1.2-34）**：
  - 报告验收 1：`node -e "…execSync('magick identify electron/icons/trayTemplate.png')…"` → `PNG 16x16 16x16+0+0 8-bit sRGB 1061B`；四个 PNG 均入库（`.gitattributes` `*.png binary` 生效，merge 显示 Bin）。
  - 报告验收 2：`node scripts/run-tests.mjs close-to-tray` → 1 通过 / 0 失败（52ms）；`--list` → `{"electron":37,"electron-node":64,"system-node":9}`（110 = 基线 109 + 1，符合交接预期）。
  - `npm run typecheck` → exit 0。
  - `npm test` → **110 个 109 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项）；失败集合不劣于改动前基线（107 过 / 2 败，flake 本轮未复现），无新增失败文件。合并回 main 后复跑 `close-to-tray` 通过。
  - 报告验收 4（Windows 托盘外观一致）：真实 Electron 45 探针（隔离 userData `mkdtemp` + `NUTATION_USER_DATA`，临时脚本与产物已删，`tests/tmp-*` 忽略）→ **7/7**：①win32 下新 `loadTrayIcon()` 与旧逻辑（明暗→tray-white/black.ico）**toPNG 逐字节一致**（tray-before.png ≡ tray-after.png，sha256 `537bfe03…`，各 45201B——同一 setImage 输入 ⇒ 通知区渲染必然一致）；②尺寸一致（Electron 解码该 ICO 为 256x256，新旧相同）；③非空；④darwin(mock) `trayTemplate.png` 加载 16x16 非空；⑤⑥两个 linux PNG 资产 24x24 非空；⑦linux(mock) `loadTrayIcon()` 走 tray-linux-* 24px 非空；真实 `tray.init()` 创建托盘成功。
- **偏离**：
  1. **`closeToTrayEnabled` 抽为 `electron/closeToTray.js` 而非 main.js 内联**（报告第 4 步字面「在 main.js 新增一个函数」）：main.js 顶层即调 `app.commandLine.appendSwitch` / `app.setPath`，测试无法 require 整个 main.js；按 C-11 userData.js / C-25 appMenu.js 同款先例抽纯函数模块，函数体语义与报告代码逐字一致。
  2. **渲染层默认显示非字面「同一函数的结果」**：渲染端无法 import 主进程 CJS 模块（tsc 无 allowJs / electron 目录不在 tsconfig 内），SettingsPanel 用 navigator 探测计算同值默认，与 `commands.ts` IS_MAC 同法；两处注释互指（改默认值必须同步）。
  3. **报告验收 4 的「截图对比」部分在本会话不可用**：PowerShell `CopyFromScreen` 全屏捕获返回全黑帧（1536x960 / 7.5KB，宿主会话非交互/锁屏，探针期间两次实测均黑）；以更强的机械等价证据替代——真实 Electron 下新旧逻辑托盘图标 `toPNG` 逐字节一致（偏离 3 与验收 4①）。
  4. **`setTemplateImage` 是 macOS 专属 API**：win32 上为 no-op（`isTemplateImage()` 恒 false，探针首版断言被拦后修正），Template 反色只能在真实 mac 验证；mac/Linux 行为本机未实机验证（报告口径允许记「未验证」），覆盖方式 = 三分支资产加载/尺寸探针 + 平台默认单测矩阵。报告验收 1 的 16x16 与 `@2x`/明暗资产就位已实证。
  5. **锚点漂移**（rg 重定位，无需中止）：main.js :282→:298（写侧归一）、:2041→:2085（close 处理）；「主窗口 main.js:2013 已用 PNG」实际 :2057（另 :2035 applyThemeIcons `setIcon` 同源 PNG）——主窗口本就平台无关，无需改动。tray.js :17-19 / lensWindow.js:77 / workbenchWindow.js:58 与报告一致。
  6. **基线比账本原记录多一败**：C-28 改动前全量 109 个 107 过 / 2 败（applog + `d112-providers` 负载 flake，单跑通过）；C-28 后全量 109 过 / 1 败（flake 未复现）。d112-providers 已登记 §1.1（未归属·负载 flake）。
  7. 测试副产物 `tests/m15r.activity.bundle.cjs` / `tests/m15r.layout.bundle.cjs` 变脏已还原；探针脚本、隔离 userData 与截图产物已删（`tests/tmp-*` 忽略），未入库；提交用显式路径（11 文件）。
- **修正复审（主控对抗式审查派发，`12b084f` / 合并 `9627a8b`，分支 `docs/c28-d208-closeToTray`；代码零行为改动，4 文件 +7/−6）**：主控审查发现两处活规格残留 + 一个流程缺口，执行会话对抗审查（勿改只证）全部证实并补报一处，主控采纳后派发修正：
  1. **GUIDE §7.4 :1331 活规格漂移**——「默认 `true`，仅严格 `false` 为关」两处过时（默认已平台化 / 写侧归一已收敛 `closeToTrayEnabled`）。实证 f18 **机械不拦**（:230 只查「代码在读的键已在文档登记」的存在性，不解析默认值散文；:276 round-trip 值 `false` 在新语义下仍往返成立；closeToTray 无非法值用例）——但 §7.4 是键语义规范源，按「文档即合同」口径必须修（C-26 :679 同型，当时亦机械不拦）。
  2. **tray.js:1 文件头「默认开」残留**（与 main.js:2083 同仓矛盾）；按同文件 D187 追记先例保留 v48.79/D123 标签 + 追加 v49.37/D208 口径。
  3. **流程缺口（AGENTS.md 硬不变量 3）**：D-09 契约变更只进了进度账未入 GUIDE——补 §8.1 **D208** 行（四列格式，源列「审计报告 C-28 + 决策 D-09=A（用户 2026-10-24 确认）」）+ 标题 **v49.36→v49.37** + §7.4 :1331 重写。GUIDE :208（§4.1 v48.79 沿革「默认 true」——当时事实）/:1520（§8.1 D123 行）历史条目按 C-26 口径不改写。
  4. 执行会话补报 **main.js:302**「与 closeToTray 同口径」残留（updateAutoCheck 仍 `!== false`，两键不再同口径；该注释紧邻上轮编辑区，属执行遗漏）。
  5. f18-settings-matrix.cjs:276 夹具注释顺带同步（夹具值 `false` 与断言零改动）。
- **修正后闸门复跑（合并回 main 后，2026-10-24）**：**F11 14/16**——2 败 = 既有 L1（vendor/kpScopes.js）+ L6（表数声明），**L3 绿**（标题 49.37 / 正文最高 49.37）、**L4 绿**（「正文用到的最大决策号 = D208 已在 §8.1 登记」）；**F18 90/91**——唯一失败「往返用例覆盖代码在读的全部层.键：实际 `["app.back"]`」**为既有失败非本项引入**：main（改动前）复跑同样 90/91 同断言同键（Bookshelf.tsx:592 JSX `key="back"` 被消费者扫描器反查成 settings 读点假键——f18 头注 D-DOC-07 记载的「key 名绑定 JSX 字面量」同族误报，属独立既有缺陷建议单列）；**F20 26/26**（零回归见证）；`npm run typecheck` 0。全量与 GUI 未跑（代码零行为改动，主控口径）。
- **教训（§5 已同步）**：改设置键默认值/归一口径＝契约变更，必须同步 GUIDE §7.4 登记行 + §8.1 D 号 + 标题版本 bump——f11 L3/L4 把不变量 3 机械化，**引了 D 号/版本号而不登记即红**；F18 coverage 类失败先到 main 复跑定归属再动手（本次实证 main 同败，避免误吞）。

### 3.35 C-29 · 开机自启：Linux 上开关无效（app.setLoginItemSettings 为 no-op）

- **提交**：`ed941e6 fix(C-29): 开机自启平台分支——Linux 按 XDG autostart 写 .desktop，win/mac 保持 app API`；合并 `334cb71`（分支 `fix/c29-autostart-linux`）。
- **改动**（2 文件，+148）：
  - `electron/quickCapture.js`：①顶部补 `const os = require("os")`（`fs` 原已引入）；②新增 `linuxAutostartFile()`——`$XDG_CONFIG_HOME/autostart/nutation.desktop`（未设置回落 `~/.config/autostart`）；③`isAutoLaunchOn()` 加 linux 分支 = `fs.existsSync(linuxAutostartFile())`（文件存在即视为开启，XDG autostart 规范语义），其余平台保持 `app.getLoginItemSettings().openAtLogin` 原样；④`applyAutoLaunch(enabled)` 加 linux 分支（报告代码逐字）——关 = `fs.rmSync(f, { force: true })`；开 = `mkdirSync(recursive)` + 写 `[Desktop Entry]`（`Exec=` 取 `process.env.APPIMAGE || process.execPath`，AppImage 必须指向 .AppImage 本身；dev 态追加应用目录参数；`X-GNOME-Autostart-enabled=true`），失败只记日志与原分支同口径；win/mac 分支原样保留（含原注释）；⑤`module.exports` 补导出 `applyAutoLaunch`（见偏离 1）。
  - 新增 `tests/autostart-linux.test.cjs`（electron-node，17 断言）：electron 桩注入（`require.cache[require.resolve("electron")]`，参照 `tests/app-menu.test.cjs` 先例，app 桩记录 `setLoginItemSettings` 调用）；`XDG_CONFIG_HOME` 指向 `fs.mkdtempSync` 临时目录（绝不写真实 `~/.config/autostart`）；`withPlatform` mock 手法参照 `tests/close-to-tray.test.cjs`（含还原断言）。覆盖报告验收三条 + APPIMAGE 优先 + win32/darwin 守卫（仍走 app API 桩、不落 XDG 文件）。
- **契约自查结论（§5 C-28 教训要求）**：**不构成契约变更，GUIDE 零改动、不新增 D 号、不 bump 版本**——`app.globalShortcuts.autoLaunch` 键语义（bool、默认 false、存于 globalShortcuts 下）完全不变；该键经 §7.4 :1324（v48.16 / D52 / D-DOC-08「设置键登记补全」）以 `app.globalShortcuts` 整键登记在案，GUIDE/HISTORY 全文无 autoLaunch 实现机制描述、也无「Linux 无效」之类活规格（`rg -n "autoLaunch" AI_DEVELOPMENT_GUIDE.md docs/HISTORY.md` 零命中）；本项只是把已登记语义在 Linux 上补齐实现（bug 修复），不满足 C-28 教训「改默认值/归一口径」的契约变更条件。
- **验收（2026-10-24，Windows；Electron 45.0.0）**：
  - 改动前基线：`npm test` → 110 个 109 过 / 1 败 / 0 超时（唯一失败 applog，本会话复跑确认与 §1 一致）。
  - 报告验收 1-3（linux 分支）：`node scripts/run-tests.mjs autostart-linux` → 1 通过 / 0 失败（90ms，17 断言）——`XDG_CONFIG_HOME` 指临时目录后 mock linux 调 `applyAutoLaunch(true)` → `autostart/nutation.desktop` 存在且含 `Exec=`（另验 `[Desktop Entry]` / `Type=Application` / `X-GNOME-Autostart-enabled=true`）；`isAutoLaunchOn() === true`；`applyAutoLaunch(false)` → 文件被删除、读回 false；APPIMAGE 置位时 `Exec=` 指向 `.AppImage` 文件本身。
  - 报告验收「Windows 行为不变」单测侧：mock win32/darwin 下 `applyAutoLaunch` 仍走 app API 桩（openAtLogin true/false 原样传递）且不落 XDG 文件；`isAutoLaunchOn()` 仍读 `getLoginItemSettings`。
  - `node scripts/run-tests.mjs --list | tail -1` → `{"electron":37,"electron-node":65,"system-node":9}`（111 = 基线 110 + 1）。
  - `npm run typecheck` → exit 0。
  - `npm test` → **111 个 110 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项）；新增 `autostart-linux` 通过，m8 / m8b / close-to-tray / commands-combo / app-menu（quickCapture 相邻套件）全绿，失败集合与基线完全一致，无新增失败文件。
  - 报告验收 4（Windows 实测回归）：真实 Electron 45 应用探针（临时脚本 `tests/tmp-c29/probe-autostart.cjs`，已删）→ **11/11 PROBE-PASS**：win32 下 `applyAutoLaunch(true/false)` 各恰一次调用 `app.setLoginItemSettings`、`openAtLogin`/`path=process.execPath`/开发态 args 原样传递；`isAutoLaunchOn()` 走真实 `app.getLoginItemSettings()` 返回 boolean（读路径存活）；不落 XDG 文件。**零副作用设计**：探针内以间谍桩替换 `app.setLoginItemSettings`（只记录不转发，真实注册表零写入），userData 与 `XDG_CONFIG_HOME` 均 mkdtemp 隔离。
- **偏离**：
  1. **`applyAutoLaunch` 新增导出**（报告代码未提及导出面）：报告验收要求直接调用 `applyAutoLaunch(true/false)`，而该函数原本未导出（`isAutoLaunchOn` 已在 `module.exports`）；对既有导出面纯追加，风险最小。
  2. **锚点漂移**（rg 重定位，无需中止）：报告 `:155-162` → 实际 `isAutoLaunchOn` :151-157 / `applyAutoLaunch` :159-170（报告 :147 指的配置读取行实际 :147 的 `autoLaunch: raw.autoLaunch === true` 未变）；代码结构与报告描述完全一致。「`fs` 若未引入需补」——`fs` 原已在 :15 引入，仅补 `os`。
  3. **Linux 分支无法在 Windows 实机运行**（本机 Windows，无 Linux 环境）：报告验收 1-3 本就是 Linux 环境命令，覆盖方式 = 平台 mock + XDG 临时目录单测全断言（electron-node 真实文件系统读写，仅平台分支 mock）；XDG 桌面环境真实 autostart 生效性（GNOME/krars 开机拉起）未实机验证，按报告口径记「未验证」——本项改的是应用侧写文件行为，单测已证明文件内容符合 XDG autostart 规范。
  4. **首版测试自伤一处（测试侧 bug，产品代码零回退）**：linux 段 APPIMAGE 用例复开自启后未清场，win32 守卫的「不落 XDG 文件」断言读到残留文件而红；linux 段末尾补 `applyAutoLaunch(false)` 清场（顺带多一条「复开后再关」断言）后全绿。
  5. 测试副产物 `tests/m15r.activity.bundle.cjs` / `tests/m15r.layout.bundle.cjs` 全量后变脏已还原；探针脚本与隔离目录已删（`tests/tmp-*` 忽略），未入库；提交用显式路径（2 文件）。

### 3.36 C-30 · 全平台打包矩阵 + 签名公证 + CI

- **提交**：`caeaa00 docs(C-30) GUIDE v49.38/D209`（文档先行）→ `8b4ed0c 图标/entitlements` → `497d99a yml+dist 脚本+npmRebuild:false` → `c073e64 updater/设置页/i18n/单测` → `8580f06 CI workflow` → `2e1ffcd 修正（CI 机密仅非空注入）`；合并 `9d001e8` + `0015698`（分支 `fix/c30-packaging-ci`）。
- **决策输入**：D-02（C-11 已冻结发布身份）、D-01（无 ia32）、U-16（无证书 → 未签名路径）、U-25（用户 SVG 源图）、仓库合流决策 C + tag 触发裁定（见 §1 决策记录）。
- **改动**（14 文件 +288/−16，修正 +18/−5）：
  - `build/icon.png` 256→**1024**（SVG 光栅化，ImageMagick 7.1.2-34 全路径）；`build/icon.ico` 重生成（报告命令 `magick build/icon.png -define icon:auto-resize=256,128,64,48,32,16` 原样）；`build/icon.svg` 留档；新增 `build/entitlements.mac.plist`（报告 plist 逐字）。
  - `electron-builder.yml`：win nsis arch +arm64（D-01）；新增 mac 段（dmg+zip 各 x64+arm64、category public.app-category.education、hardenedRuntime、gatekeeperAssess:false、entitlements/Inherit、notarize:true）；linux 段补 category Education + AppImage+deb 各 x64+arm64（executableArgs 沿 C-24）；**npmRebuild true→false**（见偏离 1）。
  - `package.json`：`dist` = dist:win 别名 + `dist:win`/`dist:mac`/`dist:linux`（报告第 3 步；CLI 一律 --publish never）。
  - `electron/updater.js`：`source()` 增 linux 分支（报告第 4 步逐字：`process.platform === "linux" && !process.env.APPIMAGE → "unsupported"`）+ 头注；`snapshot().enabled` 对 unsupported 自然为 false（自更新控件隐藏、零网络）。
  - `src/components/SettingsPanel.tsx`：`UpdateSource` 增 "unsupported" + 提示「当前由系统软件包管理器（deb/rpm）安装，应用内不自更新，请通过软件包管理器更新。」；`src/lib/settingsNotices.ts` 注释同步；en/ja 各 +1 键。
  - 新增 `tests/updater-source.test.cjs`（electron-node，12 断言：electron 桩参照 app-menu.test.cjs、platform/resourcesPath mock 参照 close-to-tray.test.cjs）。
  - 新增 `.github/workflows/build.yml`（push tag `v*` + workflow_dispatch；三平台矩阵；tests 非阻塞并上传 latest.json；跨架构原生可选依赖显式补装；机密仅非空注入——修正提交）。
- **契约自查（§5 C-28 教训）**：`update:status` 的 `source` 枚举增值 = §4.2-17 收录的公共接口变更 → **GUIDE 先行登记**（提交顺序 docs 在代码前）：标题 v49.37→v49.38、§4.2-17 枚举行、§7.2 联网例外前置条件（unsupported 零网络）、§9.2 M9 行、§8.1 新增 **D209**。闸门复跑：F11 **14/16**（与既有基线持平）、F18 90/91（唯一失败 `app.back` 既有误报）、F20 26/26 全过、F21 7/7 全过、F24 11/12（R3 = F91/F92 流程缺 § cites，既有）、F27 13/14（W6 既有）——全部与 main 既有口径一致，无新增失败。
- **验收（2026-10-24，Windows；Electron 45.0.0 / electron-builder 26.15.3 / ImageMagick 7.1.2-34）**：
  - 改动前基线：111 个 110 过 / 1 败（applog，本会话复跑确认）；改动后全量 **112 个 111 过 / 1 败 / 0 超时**（唯一失败 applog，无新增失败文件）；`npm run typecheck` exit 0；`node scripts/i18n-check.mjs` OK（1801 键）；`node scripts/run-tests.mjs --list | tail -1` → `{"electron":37,"electron-node":66,"system-node":9}`（112 = 基线 111 + 1）。
  - updater-source 单测 **12 断言全过**：linux 无 APPIMAGE → unsupported + 快照 enabled=false；linux APPIMAGE → 读 app-update.yml → github + enabled=true；dev / store / win32（占位 slug、无 yml）/ darwin 渠道行为不变；platform 与 resourcesPath mock 已还原。
  - `npm run dist:win`（未签名路径）→ exit 0：`release/Nutation-0.0.1-win-x64-setup.exe`（171 MB）+ `Nutation-0.0.1-win-arm64-setup.exe`（165 MB）+ `Nutation-0.0.1-win-setup.exe`（335 MB，electron-builder 多架构 NSIS 自动附加的双合一包，偏离 3）；Get-AuthenticodeSignature → 安装包与 Nutation.exe 均 **NotSigned**；`release/win-unpacked/resources/app-update.yml` = owner xiongdy54 / repo Nutation / provider github。
  - **arm64 包内容验**：`release/win-arm64-unpacked/resources/app.asar.unpacked/node_modules/` 含 `fsrs-rs-nodejs-win32-arm64-msvc` + `@napi-rs/canvas-win32-arm64-msvc`（workflow 同款 `npm install --no-save --force` 本地预演）+ better-sqlite3 `prebuilds/` 全 8 平台变体（lib/binding.js getPrebuildPath 运行时自选）——跨架构原生依赖布线实测有效。
  - **安装启动隔离实测（Windows）**：x64 安装包 `/S` 静默安装（perMachine:false → `%LOCALAPPDATA%\Programs\Nutation`）→ `NUTATION_USER_DATA=mkdtemp` 启动 → main.log `version 0.0.1 · packaged true · electron 45.0.0`，library.db / learner.db / settings.json 全部建在隔离目录（**真实 userData 零触碰**），better-sqlite3 原生模块从安装目录加载成功；+30s 自动检查触发 → 「No published versions on GitHub」（预期：Release 未发布，D180 静默降级路径实测存活）→ 结束进程 → `Uninstall Nutation.exe /S` 静默卸载干净。注：`/S` 经 Git Bash 直传会被 MSYS 路径改写吃掉（首次卡在安装向导），必须经 `cmd /c` 传参。
  - **三平台 CI 实跑**（远端 `xiongdy54/Nutation`，dev 分支 = 本地 main；远端展示 main 未动）：
    - run 1（tag `v0.0.1-rc0` = `9d001e8`）：**https://github.com/xiongdy54/Nutation/actions/runs/40084018090** — win ✅ / linux ✅ / mac ❌（空 CSC_LINK 被当证书路径 → 修复 `2e1ffcd`，见偏离 4）。
    - run 2（tag `v0.0.1-rc1` = `0015698`）：**https://github.com/xiongdy54/Nutation/actions/runs/40084725879** — **三平台全绿**（7m14s），产物 6 件：`packages-windows-latest`（638.7 MB）、`packages-ubuntu-latest`（701.3 MB）、`packages-macos-latest`（780.9 MB）+ 三份 `test-results-*`。job 日志核出的安装包清单：win `Nutation-0.0.1-win-x64-setup.exe` / `-win-arm64-setup.exe` / `-win-setup.exe`；mac `Nutation-0.0.1.dmg`（x64）/ `Nutation-0.0.1-arm64.dmg` / `Nutation-0.0.1-mac.zip`（x64）/ `Nutation-0.0.1-arm64-mac.zip`；linux `Nutation-0.0.1.AppImage`（x64）/ `Nutation-0.0.1-arm64.AppImage` / `nutation_0.0.1_amd64.deb` / `nutation_0.0.1_arm64.deb`——**验收矩阵逐项命中（win x64/arm64 NSIS、mac x64/arm64 dmg+zip、linux x64/arm64 AppImage+deb）**。
    - CI 测试步骤结果（latest.json artifacts，非阻塞但已归档）：linux 3 败（applog、lm-db、userData）、win 4 败（applog、lensWindow、lm-db、sqlite-migration）、mac 5 败（applog、lensWindow、lm-db、m8、userData）——全部 runner 环境归属（applog 既有；lensWindow §1.1 flake；lm-db 66/67 子测、userData、m8、sqlite-migration 本地 Windows 全过），`updater-source` 三平台全过；远优于报告 §1.3 Linux 基线 23 败。
  - **mac `spctl` 验收项**：不适用（未签名，U-16 无证书；报告该条仅在已签名公证时要求）。
  - **mac/linux 干净实机全流程（导入 EPUB→制卡→复习→重启数据仍在）**：未验证（本机仅 Windows；Windows 实测见上）。
- **偏离**：
  1. **npmRebuild true→false**（报告 yml 未提及，必要修正）：better-sqlite3 v13 NAPI 预编译已内置全平台全架构二进制（`prebuilds/` 运行时自选），`npmRebuild: true` 只会触发 @electron/rebuild 源码编译——本地 win-arm64 实测 MSB8020（缺 v145 工具集）失败、CI linux-arm64/mac-x64 交叉编译同理需交叉工具链；关闭后日志 `skipped dependencies rebuild`，双架构出包成功（GUIDE D209 ③ 登记）。
  2. **图标设计与既有窗口图标不同源**：用户 v2 SVG 与仓库既有 `electron/icon.png` 差异明显（RMSE 0.22，ImageMagick compare 实测）——按 U-25 以 SVG 为源生成 build/ 打包图标；`electron/` 窗口与托盘图标（C-28 范围）未动。安装器/应用图标（新设计）与窗口图标（旧设计）暂不同源，统一与否属后续决策。
  3. **合并安装包 `Nutation-0.0.1-win-setup.exe`**：报告产物清单未提及——electron-builder 26 对 NSIS 多架构自动追加双合一安装包，如实记录（local 335 MB / CI 同样产出）。
  4. **CI 机密注入方式修正（`2e1ffcd`，run 1 mac 失败归因）**：`env: CSC_LINK: ${{ secrets.CSC_LINK }}` 在机密为空时注入**空字符串**——electron-builder mac 对「存在但为空」的 CSC_LINK 走 importCertificate → `resolveCscLinkPath("")` 落到项目目录 → `⨯ .../Nutation not a file`（app-builder-lib codesign.js :27）；windows/linux 的签名路径对空串免疫故 run 1 两平台通过。修复：机密经中间步骤**仅非空写入 GITHUB_ENV**，Package 步只保留 `CSC_IDENTITY_AUTO_DISCOVERY=false`。报告第 5 步「机密为空时跳过签名」的意图不变，实现口径修正。
  5. **跨架构原生可选依赖显式补装**（报告未提，U-06 落地）：npm ci 只装宿主架构的 napi-rs 平台分包；workflow 每平台 `npm install --no-save --force <目标架构的 fsrs-rs-nodejs 与 @napi-rs/canvas 分包>`——@napi-rs 平台分包声明 os/cpu 限制，非宿主架构必须 --force（EBADPLATFORM）；`--no-save` 实测不动 package.json/package-lock（本地 lock 零 diff）。
  6. **测试步骤 continue-on-error**（报告验收口径判断，交接包明示由本会话裁定）：C-30 验收 = 三平台出包；报告 Linux 基线 23 败已知且 win/mac CI 结果事前不可验证，测试阻塞打包则验收不可达。处理：tests 步骤 continue-on-error + `tests/.results/latest.json` 随 artifacts 上传（非静默吞），CI 实测各平台仅 3–5 败且全部环境归属（见验收）。后续 Linux 基线收敛后可移除。
  7. **push 阻塞-决策-解封全程**：`git fetch origin` 发现远端 main 与本地历史无共同祖先（远端 = 展示仓 5 提交）→ 按交接包纪律停下回报 → 用户拍板**决策 C**（dev 分支跑 CI）→ push `main:dev` 正常完成；workflow_dispatch 因「workflow 仅从默认分支注册」仍 404（远端 main 无 .github/，`GET /actions/workflows` total_count 0）→ 主控裁定推 tag 触发（`v0.0.1-rc0` → run1 → mac 修复 → `v0.0.1-rc1` → run2 三平台全绿）；两 tag 保留作追溯锚点。gh CLI 本机未装，全程 GitHub REST API + git credential PAT（scopes repo+workflow 实测够用）。
  8. **GUIDE 登记超出报告字面**：报告 C-30 未点名 GUIDE，但 source 枚举是机器闸门解析的公共接口（§4.2-17 / D209 / v49.38，硬不变量 3）；f11/f18/f20/f21/f24/f27 复跑无新增失败（闸门口径见契约自查段）。
  9. **f24 基线夹具自动收紧未随本项提交**：F24 每次运行按现状重写 `tests/flows/fixtures/f24-coverage-baseline.json`（flowCount 89→90、§4 节 19→20——D93 后基线未随批刷新，main 既有陈旧）；与 C-30 无关，已还原未提交，主控单列处置（§5 已留提示）。
  10. 测试副产物 `tests/m15r.*.bundle.cjs` 全量后变脏已还原；提交用显式路径（14 文件 + 修正 1 文件）；本地打包产物 `release/` 与临时探针/隔离 userData（c30-installed-*、/tmp 摘要）不入库。

1. 把对应行状态改为 **完成**（或 **中止** / **部分**）。
2. 填 `提交 / 合并`：`fix(C-xx)` 的 hash / `--no-ff` 合并提交 hash。
3. 在 §3 增加该小节：改动文件、验收命令与结果、偏离说明。
4. 若基线失败集合发生变化，更新 §1.1 与 `§1 当前状态`。
5. 更新顶部 `本账建立时 main HEAD` 和 `更新时间`（或改为最近一次执行项的 main HEAD）。
6. 若新增测试 / 新文件改变了 `--list` 分布，同步记录实际值，不要硬套报告数字。

### 3.37 C-31 · 换肤与动效设置同步到结构图谱、制卡台、快速捕获窗口

- **提交**：`ad4f11e fix(C-31): 换肤与动效设置同步到结构图谱/制卡台/捕获窗口——readAppearance 唯一读取面 + WindowSkin + settings:changed 广播`；合并 `0b37f7a`（分支 `fix/c-31-window-skin-sync`）。
- **改动**（13 文件，+350/−37）：
  - 新建 `src/skins/runtime/readAppearance.ts`：`readAppearance()` 逻辑逐行搬自 App.tsx 原初始化段（读 theme.mode / app.skinId / accentColor / accentBySkin / motionLevel；loadSkin 失败回落默认皮肤；D172 有效强调色 = 默认皮肤用原键、其他皮肤用 `accentBySkin[skinId]`）；`applyAppearanceToDocument()`（theme 双类 + motion 三态类 + `applyAccent` 三件套，主窗口 effect 与独立窗口共用同一条落类规则）；`isAppearanceSettingsChange()`（scope=theme 任意键，或 scope=app 且 key ∈ skinId/accentColor/accentBySkin/motionLevel）。
  - 新建 `src/skins/WindowSkin.tsx`：独立窗口外观挂载点——挂载时 / 收到变更时 / 呼出反压时调 `readAppearance()` 并渲染 `<SkinHost skinId mode motion onFail>`；onFail 只在**本窗口本地**回落默认皮肤（不写回设置）；系统 prefers-reduced-motion 变化也重读（与主窗口 mq 监听同规）；epoch 守卫只认最后一次读取。
  - `src/App.tsx`：初始化外观五键改为调 `readAppearance()`（行为不变；语言读取与 8s 兜底 / eventBus 订阅原样保留）；effect 仍用 resolveMotion/motionClass 未动。
  - `src/components/CaptureEditor.tsx`：`applyCaptureAppearance()` 保留为呼出重读入口，内部改为 `readAppearance` + `applyAppearanceToDocument`（原「只切 theme-dark/light + accentColor 原键」的两套逻辑移除），末尾 `requestWindowSkinRefresh()` 反压本窗口 WindowSkin。
  - 三入口挂载：`src/lens.tsx`（`.lens-root` 首子节点）、`src/workbench.tsx`（`.wbw` 首子节点）、`src/capture.tsx`（React 根内 `<WindowSkin /><CaptureEditor />`）。
  - `electron/main.js`：`settings:set` 处理器 `writeSettings(all)` 成功后向**除发起写入外**的所有窗口广播 `settings:changed {scope, key}`；事件名与载荷形状写头注（单向推送不计入 IPC 注册清单，D123/D180/D197 口径）。
  - `electron/preload.js` + `electron/preload-capture.js`：`settingsAPI.onChanged(cb)` 订阅（返回退订函数，与既有 on* 同构；capture 窗口用独立最小桥，两处都要加）。
  - `src/lib/settings.ts`：`Window.settingsAPI` 接口补 `onChanged?` 类型。
  - `src/skins/SkinHost.tsx`：头注 1 行更新（「App 内唯一皮肤挂载点」→ 主窗口直挂 + 独立窗口经 WindowSkin 挂载；纯注释）。
  - `src/lens.tsx:4-5` 注释更正（报告修复步骤 5）：换肤/动效/强调色同步的真实机制 = settings:changed 广播 + WindowSkin。
  - 新增 `tests/window-skin.test.cjs`（system-node，直跑）：esbuild 双打包验证 readAppearance 语义（A 空设置全默认 / B claude 成功加载用 accentBySkin 记忆值 / C loadSkin 失败回落默认 + accent 回原键——external:./claude 让动态导入在 Node 必然失败 / D 默认皮肤恒用原键）+ isAppearanceSettingsChange 过滤矩阵（theme ✓ / 外观四键 ✓ / language、limits、plugin.* ✗）+ 静态接线守卫（main.js 广播在 settings:set 处理器内、两个 preload 有 onChanged、三入口挂 `<WindowSkin />`、App/CaptureEditor 走 readAppearance）。
- **验收（2026-10-24，Windows；Electron 45.0.0）**：
  - `npm run typecheck` → exit 0。
  - `npm run build` → 成功（6.98s）。
  - `npm test` → **113 个 112 过 / 1 败 / 0 超时**；唯一失败 = applog（§1.1 既有未归属项）；新增 `window-skin` 通过，失败集合与改动前基线完全一致（基线实测 112 个 111 过 / 1 败，本会话复跑确认），无新增失败文件。
  - **隔离 GUI 探针（临时脚本已删；真实 Electron + CDP，`M7_TEST_USERDATA` 指向临时目录，未触碰真实 userData）→ PROBE-PASS**：
    * 主窗口 `lensAPI.control("show")` 呼出结构图窗口（经主进程 win:lens 建窗），从主窗口模拟 Reader 同形状 context 推送使面板渲染（MindmapLens 的 supported 闸需要 documentId）。
    * 基线：lens `data-skin` 不存在、body = `lens-body theme-light motion-full`。
    * 主窗口 `settingsAPI.set("theme","mode","dark"/"light")` → lens body 类同步 **7ms / 1ms**。
    * `set("app","skinId","claude")` → **36ms** 内 lens `documentElement.dataset.skin === "claude"`、body 含 `skin-claude` + `has-skin`、`style[data-skin-css="claude"]` 已注入（验收线 500ms）。
    * `set("app","motionLevel","off")` → **2ms** 内 lens body 含 `motion-off`（验收线 500ms）。
    * 非默认皮肤下 `set("app","accentBySkin",{claude:"#b45309"})` → **2ms** 内 lens `--user-accent` = `#b45309`；主窗口 Page.reload 后（readAppearance 初始化路径）主窗 `data-skin=claude`、body `has-skin skin-claude skin-vt motion-off`，两窗 `--user-accent` 与 `--accent` 计算值**逐字节相同**（均 `#b45309`）。
    * 截图：`tests/flows/results/c31-main.png`（主窗口 claude 皮）、`c31-lens.png`（结构图窗口 claude 皮——陶土纸面 + 陶土强调色置顶钮）、并排 `c31-side-by-side.png`（ImageMagick +append；lens 是 D203 透明纸片窗，CDP 截图先 `Emulation.setDefaultBackgroundColorOverride` 覆底再截）。三张均为本机证据文件，不入库（`tests/flows/results/` 未跟踪，与 C-09 同口径）。
  - 流程闸门：F21 **7/7**（新通道两头齐、无死通道）、F11 **14/16** / F18 **90/91**（失败集合与 §3.30 基线逐条一致，均为既有；F18「文档未登记 0」——本项零新设置键）。
- **契约自查（§5 C-28 教训）**：**GUIDE 零改动、不新增 D 号、不 bump 版本**——①`settings:changed` 是主进程→渲染层单向推送（非 invoke 通道），按 D123/D180/D197 明文口径「不计入注册清单，事件名见头注」，事件名与载荷形状已写 main.js 头注（交接包已确认此口径）；②`settingsAPI.onChanged` 与 windowAPI.onDockMode / lensAPI.onPush 等既有 on* 订阅函数同族，各 D 条均未单独登记；③零新设置键（读的全是 §7.4 已登记键）。**遗留提示（主控裁决项，已裁决补登记——见下）**：GUIDE §8.1 D170 的「SkinHost（App 内唯一挂载点）」表述自本项起被取代（SkinHost 仍是唯一实现，挂载方 = 主窗口 App 直挂 + 独立窗口 WindowSkin）；因属历史决策记录未改写，是否补一条 D 号登记由主控定。
- **修正（主控对抗式审查裁决，2026-10-24）**：机械验收全过，唯一 P3 = 挂载架构变更缺 §8.1 接管登记 + 活文档漂移——按 D205 显式接管先例（进度账 §3.12 偏离 6）补登记。执行会话对抗式复审同意并补报一处主控清单外的 `src/App.tsx:750` 活注释漂移（并入同提交）；全仓「唯一挂载点」扫出 3 处：D170 历史行（不改写，经 D210 接管）、`docs/skins/AUTHORING.md:43`（活文档漂移，改）、`App.tsx:750`（改）；`docs/skins/RECON.md:24` 为 v49.0 时点侦察档案（时点快照，同 HISTORY 性质）裁决不动。**修正提交**：`05eb171 docs(C-31): GUIDE v49.39/D210 独立窗口 WindowSkin 挂载接管登记 + AUTHORING/App 注释同步`（GUIDE 标题 v49.38→v49.39 + §8.1 D210 行 + §5 :407 补语「；独立窗口经 WindowSkin（D210）」+ AUTHORING §4.1 树改 SkinHost 行并补 `WindowSkin.tsx` / `runtime/readAppearance.ts` 两行与 :119 补 `/WindowSkin` + App.tsx:750 注释；3 文件 +8/−5）；**合并** `5e0db6c`。**验收**：F11 **14/16 持平**（L1 既有 vendor/kpScopes.js 与 L6 既有表数声明不动；**L3 ✓ 49.39/49.39、L4 ✓ 正文最大决策号 = D210 无缺号 + 已在 §8.1 登记**）、F18 **90/91 持平**（唯一失败 = 既有 `app.back` 扫描误报，`实际: ["app.back"]` 复核一致）、`npm run typecheck` exit 0；f24 按评估不跑（避免夹具自动收紧变脏）、全量/GUI 不跑（零行为改动）。
- **偏离**：
  1. **`Appearance` 接口在报告给定的 5 字段之外补 2 个超集字段** `accentLegacy` / `accentBySkin`：App.tsx 初始化还要水合 `accentColorLegacy` / `accentBySkin` 两个 React state，若按报告接口则主窗口得二次读键（两处读取面）。超集字段让报告的 5 字段名与语义逐字保留、主窗口单次读取完成水合。
  2. **WindowSkin 同时落 motion 三态类**：报告修复步骤 2 只点名 applyAccent + theme 类切换，但验收要求 lens body 含 `motion-off`——motion 类是外观的一部分，经共享的 `applyAppearanceToDocument` 统一落（与主窗口 App effect 同规则），另补 prefers-reduced-motion 变化重读（与主窗口同规）。未触碰 lensWindow 的窗口行为 / D204 缓动（交接包红线）。
  3. **applyCaptureAppearance 末尾反压 WindowSkin 刷新**：报告步骤 3 说「改为触发 WindowSkin 刷新」——实现为 `requestWindowSkinRefresh()`（模块级注册表），保留「每次呼出重读」既有行为且皮肤 CSS / `html[data-skin]` 也随呼出刷新（仅落 body 类不换皮肤 CSS 是不完整的）。
  4. **onFail 语义**：WindowSkin 的皮肤异常回落只改本窗口 state，不写回设置（App 的 handleSkinChange 会写回 `app.skinId`）——独立窗口加载失败不得改动用户保存的皮肤选择；报告未规定该分支的写回语义，按最小副作用处理。
  5. **探针两项非产品修正**：①lens.html body 有静态类 `lens-body`，基线断言须等 React 挂上主题类再读；②自定义属性的计算值是原 token 流（`#b45309` 不转 rgb），等值比较按大小写无关。均属探针脚本自身，不影响产品代码。
  6. 测试副产物 `tests/m15r.*.bundle.cjs` 全量后变脏已还原；提交用显式路径（13 文件）；探针脚本 / 隔离 userData（os.tmpdir）/ `tests/tmp-c31/` 打包产物不入库。
  7. 未实测项：**capture 窗口**（D159 `CAPTURE_DISABLED=true` 窗口不会创建，按交接包口径记「未验证」——静态接线证据 = capture.tsx 挂载 `<WindowSkin />` + preload-capture.js 有 onChanged + `applyCaptureAppearance` 走 readAppearance，静态守卫测试覆盖）；**workbench 窗口实机**（本次探针只实开了 lens；workbench 与 lens 共用同一条 WindowSkin / preload.js 广播链路，静态守卫覆盖其挂载）。

### 3.38 C-32 · 结构图谱展开/收起不流畅 · Phase A（渲染层：先测量，再减少每帧工作）

- **提交**（每步一个、每步用 A1 工具对比）：`1b402a0 fix(C-32): A1 测量工具` → `54e8012 A2 布局缓存复用` → `9e705ad A3 chooseFocusBinary 二分聚焦档` → `350ef10 A4 动效 Token` → `b27dc4d A5 认应用动效设置` → `a30dd57 A6 过渡帧减负`；合并 `58ea419`（分支 `fix/c-32-mm-perf-phase-a`，基线 main `66db3a7`）。
- **改动**（11 文件 +854/−35）：
  - 新建 `src/lib/mindmap/v2/perf.ts`（A1，报告代码逐字）：`localStorage.mmPerf === "1"` 启用；`perfBegin/perfLayout/perfIpc/perfFrame/perfEnd`，结果挂 `window.__mmPerf` 并 console.table。
  - `src/components/reader/MindmapLens.tsx`（A1/A2/A3）：`toggleCollapse` 里 `perfBegin(next ? "expand" : "collapse")`；`measureGraph` 计时调 `perfLayout` 并新增第 4 参 `cache?`（缺省＝每次新缓存，原行为）；`requestFit` 开头 `createLayoutCache()` 供本次请求所有 `measureGraph` 共用（A2）；`callFit` 前后计时走 `fitTimed` 包装调 `perfIpc`（A1）；`chooseFocus` → `chooseFocusBinary`（A3）。
  - `src/components/reader/mindmap/MindmapCanvasV2.tsx`（A1/A5/A6）：`tick` 记相邻过渡帧间隔 `perfFrame`、`f.done` 时 `perfEnd`；过渡被丢弃（fit/setViewScale/autoFit/换图清 trRef）也 `perfEnd`（A1）；`prefersReducedMotion()` 布尔删除，改 `animate.motionPreference()` 三态并传 `motionMode`（A5）；`paint()` 过渡期（trRef 非空）传模块级 `EMPTY_ROUTE` 空路由结果，终帧（trRef 已清）完整 `routeRelations`（A6）。
  - `src/lib/mindmap/v2/animate.ts`（A4/A5）：新增 `readMotion()`（读 `--mm-move/--mm-enter/--mm-exit`，**ms/s 双单位换算**）与 `motionPreference()`（body motion-off → "off"、motion-reduced → "reduced"、否则系统 prefers-reduced-motion（命中＝off）、再否则 "full"）；`Transition` 加可选 `motion` 字段；`planTransition` 加 `motionMode`（"off"＝瞬时；"reduced"＝时长 ceil(max/2)、几何直达终态只做透明度过渡、视图不动画）。
  - `src/lib/lensWindowFit.ts`（A3）：新增 `chooseFocusBinary`（快路径①top 可行即返、②N=1 兜底、其余二分，不变式 fits(1)=true/fits(total−1)=false）；线性 `chooseFocus` 保留作等价基准与回退。
  - `src/theme.css`（A4）：`:root` 动效段新增 `--mm-move: 260ms / --mm-enter: 240ms / --mm-exit: 200ms / --mm-ease: cubic-bezier(0.2,0.7,0.2,1)`，注释与 `electron/lensWindow.js` EASE 互指。
  - `electron/lensWindow.js`（A1/A4）：`animateBounds` 内 `setBounds` 计数、结束时 `console.log("[lens] setBounds x" + n)`；`EASE` 注释与 `--mm-ease` 互指（**窗口行为零改动**——animateBounds/fit 原样，C-33 域）。
  - `electron/lensWindowFit.bundle.cjs`（A3）：跟踪产物随源码重打包（artifact 闸门把守）。
  - 新增测试：`tests/m15v2.lensfit-cache.test.cjs`（A2 合入闸门 16 断言）、`tests/lensWindowFit.binary.test.cjs`（A3 合入闸门 6 断言）、`tests/m15v2.motion.test.cjs`（A4/A5/A6 共 27 断言）。
- **实机测量（Windows / Electron 45，隔离探针 `tests/tmp-c32/probe.cjs`，临时不入库；真实应用 + CDP + `M7_TEST_USERDATA` 隔离，绝不触碰真实 userData）**：
  - 探针构成：真实应用内 `createFromPaste` 建两份 MD 文档 → 关闭 → node:sqlite 直写 `material_maps/material_map_nodes(+edges)` 种两张图（**reader 的 documentId 是 documents.id 而非 library_items.id——按 `documents.library_item_id` 反查**）→ 重启 → 书架点书 → 工具栏「结构图」开 lens → `localStorage.mmPerf=1` → 真实点击徽标展开/收起。场景 A = 25 节点透镜子树（100% 档、比例 1→1、过渡完整播放）；场景 B = 145 节点透镜子树、48 子项（聚焦档，触发 chooseFocus）。`window.__mmPerf` 10 次/向 + 主进程 `[lens] setBounds x N` 日志。
  - **逐步对比（场景 B 聚焦档展开；layoutMs 为 10 次中位）**：
    | 步骤 | layouts | layoutMs | 说明 |
    | --- | --- | --- | --- |
    | A1 基线（A2/A3 前） | 31（收起 32） | 4ms | 线性扫描 47→界 ≈29 次完整布局 |
    | A2 缓存复用后 | 31（收起 32） | 2-3ms | 次数不变（预期）、单次布局变廉价；Node 微基准（`m15v2.lensfit-cache` ④）29 次布局 12.48ms → 3.59ms（**−71.2%**） |
    | A3 二分后 | **10（收起 9）** | **1ms** | base(1) + 快路径2 + 二分5 + 终态1；次数 −68% |
  - **场景 A（100% 档）帧指标（多轮，环境噪声显著）**：基线 frames 14-16 / p95 17-33 / over33 0-4（最差帧 173-195ms）；A6 后 frames 13-14 / p95 18-24（个别环境毛刺 108-221）/ over33 0-5。最好一轮 p95 17-18 且 over33=0 达报告线（≤20 / 0），多轮中位 22-24——**逐字达标受宿主机噪声限制**，如实记录。
  - **A4 皮肤覆盖**：注入 `:root { --mm-move:80ms; --mm-enter:80ms; --mm-exit:60ms }`（与皮肤样式表同一条 CSS 级联面）→ 过渡 frames 12-14 → **4-5**、过渡段 totalMs 272 → ~90ms——「切换覆盖动效 Token 的皮肤后过渡时长随之改变」实测成立。
  - **A5 motion-off**：`settingsAPI.set("app","motionLevel","off")` → lens body = `lens-body theme-light motion-off` → frames **0**、totalMs 1-2ms（无过渡帧）；切回 full 恢复 14 帧。`motion-reduced` 语义由单测覆盖（时长 ceil(max/2)、几何直达终态仅透明度、视图不动画）。
  - **setBounds 计数**：每次展开/收起窗口缓动 **x7-8**（报告证据估 ~11——16ms setInterval 在本机合并为 7-8 次），C-33 Phase B 的基线。
  - **A6 pre/post 差分**（给种图补 12 条组内 + 8 条跨组关系边后，A5 代码 vs A6 代码同夹具对比）：场景 A 展开 p95 中位 29（pre）vs 24（post）——**差异在本机噪声内**：≤200 节点规模下每帧关系路由本就亚毫秒，A6 的收益要在大图 + 多关系 + relAll/选中场景才显著；机制由单测锁定（空路由 → 关系线 0 绘制、结构线照画、卡片照画）。
- **验收命令与结果**：`npm run typecheck` exit 0（每步均跑）；`node scripts/run-tests.mjs mindmap lens` → 7 套件全过；`node scripts/run-tests.mjs m15v2` → 22 套件全过；`npm run build` 成功（每步）；`npm test` → **116 个 115 过 / 1 败 / 0 超时**（唯一失败 applog §1.1 既有，无新增失败文件）。
- **偏离**：
  1. **报告验收「一次展开 layouts ≤ 3」只在 100% 档满足（=1）；聚焦档为 10（A3 前 31）**。聚焦档 layouts = base(1) + 快路径①②(≤2) + ⌈log2(total−2)⌉ + 终态(1)——48 子项的数学下限即 ~9-10，二分无法降到 3；报告证据「几十次完整布局」（本机实测 31）已消除为 10 且 layoutMs −75%（4ms → 1ms）。若主控要求聚焦档也 ≤3，需改 requestFit 结构（如 chooseFocusBinary 返回 Display 省掉终态量测、或跳过 base 量测），超出报告字面，未自行扩权。
  2. **A4 的 readMotion 必须处理 s 单位**（报告只写 parseFloat）：esbuild CSS 压缩把 `260ms` 归一成 `.26s`，不换算则过渡被读成 0.26ms 瞬间结束（A4 首轮实测踩坑、皮肤覆盖子场景因此失真）；已按单位换算并在 theme.css 注释写明 ms/s 均可。`Transition` 接口加可选 `motion` 字段（向后兼容，缺省回落 MOTION 常量）。
  3. **A5 把三态解析落为 `animate.motionPreference()` 并替换掉 MindmapCanvasV2 的 `prefersReducedMotion()`**（报告字面是「prefersReducedMotion() 改为…」）：行为完全一致（body 类优先、系统 prefers-reduced-motion 命中仍＝瞬时/直接跳终态），落点移动是为了可单测（body 三态 + matchMedia 注入均已覆盖）；`reducedMotion?: boolean` 旧参数保留兼容（测试与旧调用方）。
  4. **A6 选了报告给的两个选项之一——「直接传空路由结果」**（比「relAll:false 不传高亮」更省：跳过整段路由含障碍索引构建）；**可见变化**：过渡期（约 0.25s，Token 可调）关系线（组内 + 跨组）整段消失、结构线照画、过渡结束最后一帧完整绘制——报告明示接受并在此登记。**「增量更新」子步骤未做**：实测该规模图（≤200 节点）每帧开销不以 buildCanvasSvg+innerHTML 为主（中帧 p95 中位 18-30ms vs 16.7ms 帧间隔），满足报告「仅测量证明必要时做」的不做条件。
  5. **A3 保留线性 `chooseFocus`**（等价测试基准 + 报告的止损路径）；`lensWindowFit.bundle.cjs` 是跟踪产物、随源码重打包并入 A3 提交（报告未点名该产物；artifact 闸门测试先红后绿验证）。
  6. **A2 等价测试超出报告最低要求**：除「同图 maxChildren 1…total 共享 vs 新缓存 bounds 全等」外，加测 noLod 混合序列、同节点 id 双视图状态交替（reorder 变体，缓存按 id 存、deps 含 rev）、10 张确定性随机树与两档扫描序（升/降序）；共享 vs 新缓存全部逐字节全等。
  7. **探针工程细节（一次性脚本 `tests/tmp-c32/`，不入库）**：种图用 node:sqlite 直写隔离库（material_maps + material_map_nodes + material_map_edges），阅读节点靠「唯一带 block_start/end 的节点」定位、cut 子树即透镜展示范围；MD 每单元 ≥400 字（SCOPE_FLOOR_CHARS），否则 scope 被判 floor、透镜落「篇幅很短」种子不渲染；场景 B 曾用 24 子项（边界偏高线性只扫 5-8 次），为贴近报告「几十次布局」证据改 48 子项。
  8. **锚点漂移**（rg 重定位，无需中止）：MindmapLens `measureGraph` :456 → :454-460、`requestFit` :539 → :538 起、`startHostFix` :512-531；lensWindow.js `EASE` :244 / `animateBounds` :280-304 与报告一致；其余锚点（CanvasV2 tick/paint、lensWindowFit chooseFocus :222/:235、animate MOTION :20-29、theme.css :148-166、layout 缓存 :342-460、svg.ts :255）全部命中。
  9. 副产物 `tests/m15r.*.bundle.cjs` 全量后变脏已还原；探针、隔离 userData（tests/tmp-c32/userdata*）与 results-*.json 不入库（`tests/tmp-*` 忽略）；提交用显式路径（6 提交共 11 文件）。

### 3.39 C-33 · 结构图谱流畅度 · Phase B（窗口层：去掉逐帧 setBounds；D-04=A 不做点击穿透）

- **提交**（文档先行 + 每步一提交）：`e236115 docs(C-33): GUIDE v49.40/D211`（lens:fit 响应面 prevBounds 契约登记，先于编码）→ `0855748 B1 主进程一次落位` → `6c4e581 B2-B5 渲染层窗口过渡` → `d106e53 注释措辞收敛` → `14f94d9 captureNodeScreen 量测基准取卡片矩形`；合并 `e77c48d`（分支 `fix/c-33-lens-window-phase-b`，基线 main `05db1d8`）。7 文件 +361/−69。
- **改动**：
  - `electron/lensWindow.js`（B1）：`fit()` 收到 `animate: true` 不再调 `animateBounds`（D204 的 180ms setInterval×16ms 逐帧 setBounds 删除），改为**一次 `setBounds(r.bounds)`**（控制台打 `[lens] setBounds x1 (C-33 B1 oneshot)`——沿用 C-32 A1 计数格式供探针解析），返回值附 `prevBounds`（落窗前 `w.getBounds()` 快照，仅 animate 落窗路径附带）；`animateBounds`/`easeAt` 保留但不再被调用并注明原因（报告明示下一版本再删）；`stopBoundsAnim`（reveal/hide/closed 的兜底）原样保留。
  - `src/lib/lensBridge.ts`：`LensFitReply` 增可选 `prevBounds`（GUIDE §4.2-17 v49.40/D211 登记的响应面变更）；`animate` 注释同步。
  - `src/components/reader/MindmapLens.tsx`（B2/B3/B4/B5）：
    - **B2 展开**：fit 回复后在「下一个 resize」（尺寸已应用则回落 rAF；once 监听 + 200ms 兜底）一次性设 `translate(prevBounds − bounds)`，再 CSS 过渡回 0（`transform var(--mm-move) var(--mm-ease)`）；纸片 `clip-path: inset()` 从旧尺寸过渡到 `inset(0)`（透明窗口在动画完成前看不到放大区）。
    - **B3 收起**：先在窗内把宿主/纸片 CSS 过渡到估计目标（宿主 `"" → translate(锚点client中心 − 留白 − 新布局锚矩形×估计比例)`、纸片 `inset(0) → 目标矩形`；估计比例/尺寸用主进程同一套 `computeFit` + `window.screen` workArea 估计，目标原点用锚点 client 坐标换算＝窗口即将移动的量），`transitionend` + `var(--mm-move)+50ms` 超时兜底后再请求 fit；主进程一次 setBounds 缩窗、resize 落点同步清除补偿。预动画只挂在会落窗的 fit 前（auto 分支探测前估计划级 ≠ focus 才预挂；聚焦分支落窗 fit 前预挂；showAll 无收起场景）。
    - **B4 删轮询**：`startHostFix`（280ms 每帧读 screenX）与 `growRaf`/`growToken` 删除；补偿量一律来自 fit 响应的 `prevBounds`。全文件 `window.screenX|window.screenY` 只剩 `captureNodeScreen` 计算点击位置一处（验收 rg 干净，注释措辞已收敛）。
    - **B5**：所有窗口层 CSS 过渡的时长/曲线一律 `var(--mm-move)`/`var(--mm-ease)`（C-32 A4 Token，皮肤覆盖自然生效；motion-off 跳过过渡、motion-reduced 时长减半与画布 planTransition 同规——JS 侧读 `readMotion()`/`motionPreference()` 保证等待与 CSS 一致）。
    - 新增 `data-mm2-win-comp` 观测点（宿主 dataset，记录已应用补偿量，过渡结束/复位清除）——jsdom 下 CSS 过渡终值瞬时生效、transform 中间态不可观测，dom 测试改断言该观测点。
  - `src/lib/mindmap/v2/perf.ts`：增 `perfPinDeviation`（被点节点过渡前后屏幕位置偏差写当前/最近一行 `pinDeviationPx`；窗口层落位晚于画布过渡结束，测量窗可能已关）。
  - 测试同步：`tests/lensWindow.test.cjs` G1 从「缓动中间值」改为「fit 返回即目标 ±1px + prevBounds 旧尺寸」（D204 缓动行为已被报告 B1 删除），G4 保留、新增 G5「非 animate 不带 prevBounds」；`tests/m15v2.lens.dom.test.cjs` 假宿主 fakeFit 补 `prevBounds`（仿真主进程），D204 宿主 translate 断言改为 awaited 观测点断言。未新增/未删除测试文件（116 个不变 = 68 electron-node / 37 electron / 11 system-node）。
- **实机测量（Windows / Electron 45，隔离探针 `tests/tmp-c32/probe.cjs`，M7_TEST_USERDATA 隔离；基线 `results-c33base.json` → 改后 `results-c33after2.json` + 提交后复验 `results-c33final.json`）**：
  | 指标 | 基线（D204） | C-33 B1-B5 后 | 验收线 |
  | --- | --- | --- | --- |
  | 一次展开/收起 setBounds 次数 | **x7-8**（40 次过渡 min7/max8） | **x1**（40 次过渡全部 =1） | ≤2 ✓ |
  | `MindmapLens.tsx` 的 `window.screenX/Y` | 逐帧轮询（:525-527 每 rAF 一读） | **1 处**（captureNodeScreen 计算点击位置） | 只剩 :488 等价位置 ✓ |
  | 被点节点屏幕位置偏差 pinDeviationPx | —（指标为本项新增） | **med 1.41 / 稳态全部 1.41**（=screenX+client 取整的下限 √(1²+1²)）；场景 B 1.0；唯一离群 = 首轮展开 232px（贴边钳制，见偏离 5） | ≤2px ✓（稳态/非贴边） |
  | p95FrameMs（场景 A 100% 档） | med 17 / max 33 | **med 17-18 / max 25**（另有一轮 50=首轮预热，同轮 over33=1） | ≤20 ✓（中位口径，C-32 同款披露） |
  | over33ms（40 次过渡累计） | 1 | **0**（c33after2；c33final 见下） | =0 ✓ |
  | 场景 B（聚焦档）帧 | 0（setViewScale 因比例变化杀过渡，既有行为） | 0-1（同既有） | — |
  - **captureNodeScreen 量测基准修正**（14f94d9，本项发现并修正的测量缺陷）：首次实测锚点偏差呈确定性 8.06px——根因是 `g[data-node-id]` 的 bbox **含折叠徽标**（收起态 "+N" 徽标伸出卡右缘 w/2≈14-16px，bbox 中心横移 ≈ w/4≈8px），展开/收起切换徽标使 bbox 中心移动而卡片本体不动；captureNodeScreen 改取 **g 的首个 rect 子元素（卡片矩形）**，与主进程 computeFit 锚点公式的布局矩形同基准——偏差 8.06 → 1.41px。几何佐证（capture.cjs DIAG dump）：展开前后节点 client 位置逐字节相同 (232.8, 104.8)，窗口 origin (1152,356)→(1024,357)、尺寸 360×440→512×576。
- **Windows 实机前后对比（CDP `Page.captureScreenshot` 序列，`tests/tmp-c32/frames-before/`（main HEAD 源码换回构建）vs `frames-after/`）**：展开序列（before → expand-00…13 → after-expand）全程无白闪/无半成品帧/无黑块，终帧完整（新节点「刚到达」虚线描边＝画布生长动画签名）；收起序列（collapse-00…21）纸片/内容连续收敛、落窗无跳变。**披露**：CDP 截图往返 ~100-200ms/帧，快于 260ms 过渡的帧级平滑性捕获不可行（CopyFromScreen 宿主全黑不可用，同 C-32）；帧级平滑由 __mmPerf 帧间隔数据佐证（p95 med 17-18ms ≈ 帧间隔 16.7ms 阈内）。
- **提交后复验（`results-c33final.json`，提交 `14f94d9` 构建实测）**：setBounds 40/40 = x1；p95 med A 18/17、B 0/17；over33 累计 1（A 展开首轮预热，同基线）；pinDeviation med A 1.41 / B 1.0、离群仍为首轮展开 232px（贴边钳制）——与 c33after2 一致，验收结论稳定。
- **验收命令与结果**：`npm run typecheck` exit 0（每步均跑）；`node scripts/run-tests.mjs mindmap lens m15v2` → **27 套件全过**；`npm test` → **116 个 115 过 / 1 败 / 0 超时**（唯一失败 applog §1.1 既有，失败集合与基线一致，无新增失败文件）；文档闸门 F11 **14/16**（L1 既有 vendor/kpScopes.js + L6 既有表数声明；**L3 ✓ 49.40/49.40、L4 ✓ 最大决策号 D211 已登记**）、F18 **90/91**（唯一失败 = 既有 `app.back` 扫描误报）——均与 C-31/C-32 基线逐条一致，GUIDE 变更零新增闸门失败。
- **偏离**：
  1. **报告 B3 的「目标尺寸和位置」按主进程同一套 computeFit 在渲染层本地估计**（报告未写明估计来源；workArea 用 `window.screen` avail* 估计、落窗仍以主进程真实值为准）：估计准确（无窗口拖动 + workArea 一致）时收起落窗瞬间无可见变化；估计误差（原生拖动后 bounds 缓存过期 / 多显示器 workArea 出入）以落窗瞬间一次修正呈现并计入 pinDeviationPx。目标原点特意用锚点 client 坐标换算（＝窗口即将移动的量），不依赖可能过期的 bounds 缓存。
  2. **auto 分支的收起预动画以「估计划级 ≠ focus」为前置**（估计划级 = focus 时探测不落窗、落窗在聚焦分支 fit 前）——估计与真实划级在 workArea 出入处可能分歧，代价是该罕见路径少一次预动画或多一次无效预动画（被 fit 回复后的复位吸收），不影响落窗正确性。
  3. **C-32 给定的 `perfBegin(next ? "expand" : "collapse")` 极性反相修正**（6c4e581）：`next` 真实语义＝「该节点将变为收起」（overrides 真值＝收起；lensGraph 派生 :411 `overrides.get(id) ?? true` 即收起），故 unfold 点击（展开动作）next=false 被旧式记作 "collapse"——探针实证（基线 results-c33base.json 首行 kind=collapse 而首击为 unfold）；C-32 场景 A 两类指标对称未暴露、**场景 B 的展开/收起标签对调**（真实展开 layouts=10、收起=9，§3.38 表内两行应互换读）。`markExpanding` 的 dir（B2/B3 编排依据）按正确极性接线。计量数据本身不受影响（只是标签）。
  4. **`captureNodeScreen` 量测基准改取卡片矩形**（14f94d9，见上）——属验收 #3 的测量基础修正，同时让 D204 的 anchorScreen 与主进程锚点公式同基准（此前 g-bbox 中心含徽标偏移，窗口落位以「含徽标中心」为不变点，卡片本体实际会移 ~8px）。
  5. **首轮展开 pinDeviation 232px 离群**：该轮同帧 p95=50/over33=1（首轮预热噪声族）；几何上与 capture DIAG 实证的**贴边钳制**机制一致——computeFit 落位被 workArea 钳制时锚点真实漂移（computeFit 已有 clamped 标记与「边缘钳制」标注设计，D203），非本项回归；稳态 39/40 行 ≤5px、非贴边场景 = 1.41px（取整下限）。
  6. **`lensWindow.test.cjs` G1 期望重写**（缓动中间值 → 一次落位）：D204 的 180ms 缓动行为被报告 B1 明文删除，属「期望过期按 C-05 指引更新」而非删测试；G2-G4 保留（G4 的「缓动中 hide 先补到目标」在新机制下天然成立）。该套件在与 `m15v2.lens.dom` 同批并行负载下复现过一轮 B2/C2/C3/D1 时序假失败（宿主负载拖慢重载/悬挂断言），复跑即绿，已记 §1.1（与 G1 同族）。
  7. **B5「节点 DOM 复用」衔接项**：C-32 第 6 步实际选择了「过渡期空路由」方案（§3.38 偏离 4），无节点 DOM 复用可衔接——按报告「没做也不影响本项」处理，纸片动画独立实现（clip-path + 宿主补偿），与画布 planTransition 并行不冲突。
  8. **`data-mm2-win-comp` 观测点**为本项新增的宿主 dataset 标记（报告未点名）：jsdom 下 CSS 过渡终值瞬时生效、transform 中间态不可观测，dom 测试以该标记断言「补偿已应用」；产品行为不受影响（过渡结束即清除）。
  9. 副产物 `tests/m15r.*.bundle.cjs` 全量后变脏已还原；探针/capture 脚本与 `tests/tmp-c32/` 全部产物（results-*.json、frames-before/after、userdata*）不入库（`tests/tmp-*` 忽略）；提交用显式路径（5 提交共 7 文件）。

### 3.40 C-34 · 文本编辑器统一（同一张卡在不同页面用不同的编辑器，P1）

- **提交**（每步一提交）：`c3b86e8`（a 编辑契约+统一渲染+删孤儿）→ `2ac50e5`（b 卡面读态渲染+点击编辑）→ `849232a`（c 批注编辑语义统一）→ `968c0ea`（d 辨析弹窗统一+白名单）；合并 `d9c63b3`（分支 `fix/C-34`，基线 main `2943aee`）。14 文件 +440/−383（其中 docs/EDIT-CONTRACT.md 新建 52 行）。
- **改动**：
  - **a**：新建 `docs/EDIT-CONTRACT.md`（行为契约表：Esc=提交并退出 / Ctrl+Enter / 失焦提交 / 长文本 400ms 自动保存 / IME 守卫 / 清空必填提示不静默恢复 / 不改写空白 / 卡片内容只用 MdField/ClozeField、读态只用 ReadMarkdown）；6 处裸 `<ReactMarkdown remarkMath+rehypeKatex>`（CardBrowser 卡面 `md()` / Reader.tsx 粘贴书 / AnswerJudgeModal / AIPanel ×3）统一为 `ReadMarkdown`（GFM+软换行+==高亮==+rehype-raw+sanitize）；删除孤儿 `src/components/EditableText.tsx`（删除前复跑 `rg "EditableText\""` src tests 零 import 引用）。
  - **b**：`MdField`/`ClozeField`（连同容器依赖 `GrowField` 与 `nextClozeOrd`/`wrapCloze`/`unwrapCloze`）从 ManualCardEditor.tsx **原样纯移动**到新文件 `src/components/editor/CardFields.tsx` 并 export；新增 `src/components/editor/EditableField.tsx`（读态 ReadMarkdown + 点击/Enter/F2 进入编辑 + 清空必填提示 3s 自消）与 `ClozeDraftEditor`（填空源文本草稿层：失焦/Ctrl+Enter/Esc 提交、挂载即聚焦、工具行内 Tab 不误提交）；CardFace 本地 `EditableText`（contentEditable 纯文本裸壳）退役，6 个使用点（imgOc 前/后、cloze 题/答、qa 前/答的编辑分支）改 `EditableField`；**填空题面改编辑原始源文本 `frontText`（含 `{{cN::…}}`），读态 `display=md(questionText)`，删除 `commitQuestion` 的 `[…]` 顺序还原猜测**；正反面 inert 逻辑不变（编辑器仍只在背面可聚焦）；浏览器详情区提示文案随行为更新（"挖空卡自动回填挖空语法"→"填空卡直接编辑挖空源文本"，en/ja 同步）；i18n 新键「内容为空，未保存」（en/ja）；theme.css 增 `.field-read`（cursor:text + hover 虚线提示 + focus-visible 2px accent，与 .review-editable 同口径）与 `.field-empty-hint`。
  - **c**：`reader/AnnotationPanel.tsx` 批注就地编辑 Esc 从 `setEditingId(null)`（放弃、静默丢改动）改为 `commitEdit(it)`（先保存再收起，补 preventDefault），与 AnnotationEditor 的 Esc 保存语义及契约一致；Ctrl/Cmd+Enter 原语义保留。
  - **d**：`disambiguate/CardPane.tsx` 正反面裸 `<textarea rows=3>` 改 `MdField`（受控 onChange 语义不变，`minRows=3` 对齐原几何）；EDIT-CONTRACT.md 登记「允许保留的 textarea」白名单（C-35 闸门按此检查）。
- **验收**：`rg -n "contentEditable" src --glob '*.tsx'` → 0 命中（连带注释措辞收敛）；`rg -n "<ReactMarkdown" src` → 仅 `editor/ReadMarkdown.tsx`；`rg -l "<textarea" src` → 9 文件全部在白名单内；`npx tsc --noEmit` 0 错误；`npm run build` 成功（b/d 后各验一次）；`npm run i18n:check` OK（1802 键）；`node scripts/run-tests.mjs review cards annotation` 2/2 通过；**最终干净全量 116 个 115 过 / 1 败 = applog（§1.1 既有），失败集合与基线完全一致**（中途两轮全量的 `m15v2.route` ④ 阈值 flake 与 `persist.test.cjs` P2 计时失败均为宿主负载所致——两者单独复跑均通过，C-34 只改渲染层零交集，见 §1.1 m15v2.route 既有记录）；GUI 冒烟 `tests/cards.gui.mjs`（自隔离 userdata）16 过 / 6 败——**与 main 基线逐字节同构**（checkout main 重建复跑同为 16/6，6 败为 D80 断言漂移既有项）。
- **偏离说明**：
  1. **白名单补登批注两处**：报告 C-34d 白名单 7 项未含 `AnnotationEditor.tsx` / `reader/AnnotationPanel.tsx` 的批注 textarea，但报告证据 6 明确保留批注双套外观（C-34c 只统一按键语义）、且验收判据要求「`<textarea>` 文件全部在白名单内」——按验收判据把两处补登进白名单（docs/EDIT-CONTRACT.md 有补登说明）。报告其余 7 项照抄，未增删。
  2. **GrowField 随 ClozeField 同迁**：报告只说移 `MdField`/`ClozeField`，但 ClozeField 依赖 GrowField（含挖空助手三函数），为避免循环 import 一并原样搬入 CardFields.tsx；纯移动零行为改动。
  3. **报告明示的行为变化（照单执行）**：ReadMarkdown 带 rehype-raw+净化后，卡面/AI 回答/判答理由里字面写的 `<b>x</b>` 从显示为文字变为显示为粗体（经净化无脚本风险）；表格/删除线/任务列表/单换行在闪卡上生效；报告已要求在偏离说明写明。
  4. **净化对图片 src 的影响（新发现，未越权处理）**：rehype-sanitize 默认 schema `protocols.src = [http, https]`，`![](bookasset://…)` / data: URI 图片的 src 会被剥掉（CSP img-src 本身放行 bookasset:/data:）。这是 D95 起 ReadMarkdown 管线在摘录读态的既有属性，C-34a 把它扩展到了闪卡面/粘贴书/AI 面——对无 sanitize 的旧闪卡管线是收窄。第一方流程不产生 markdown 内嵌 bookasset 图片（图片遮挡卡图片走 occlusionJson 直渲染 `<img>` 不经 markdown），AI/粘贴书引用 http(s) 图片不受影响；如需放行 bookasset:/data: 须改 extractSanitizeSchema（D95 域决策），本项未动，建议主控裁定是否单列。
     - **主控对抗审查更正（2026-10-24）**：原文「对无 sanitize 的旧闪卡管线是收窄」表述**错误**，予以更正（原文保留备溯）。实证：react-markdown v10.1.0 **渲染期** URL 过滤无条件生效——`node_modules/react-markdown/lib/index.js:124` `safeProtocol = /^(https?|ircs?|mailto|xmpp)$/i`、`:320` `const urlTransform = options.urlTransform || defaultUrlTransform`（与装了什么 rehype 插件无关）、`:374-389` 遍历 hast 树对 img src 逐个过 urlTransform、`:421-441` `defaultUrlTransform` 对白名单外协议返回空串；C-34 前旧管线（仅 remarkMath+rehypeKatex）**同样剥** `![](bookasset://…)`/`![](data:…)` 的 src（实测 renderToStaticMarkup 复现 `<img src="">`；旧管线裸 HTML `<img>` 则渲染为转义文字，根本不是图）。Milkdown 侧：`preset-commonmark` image spec 原样收发 src（parseDOM/toMarkdown，lib/index.js:960-1010），`paste|drop|files` 零命中，`plugin-upload`/`plugin-clipboard` 未装配（rg src 零引用），prosemirror-view `doPaste`（dist/index.cjs:3552-3563）对文件剪贴板 `if (!slice) return false`——二进制粘贴不插入。⇒ **C-34a 对图片的唯一行为增量 = 裸 HTML `<img>`（经 rehype-raw+净化）从「转义文字」变为「真实 img 元素（http(s) 有图，非 http(s) src 被剥）」；markdown 图片类零变化，无回归、无收窄**。验收 ⑤ 的可达形态 = 网页图片复制（text/html，http(s) src）端到端成立；二进制粘贴不插入是 Milkdown 编辑器既有能力边界（补齐须新增图片上传写通道，超报告范围；旧 EditableText 时代为「假插入+静默丢失」，更差）。**裁定（主控 2026-10-24）：不修代码**；本条更正后原「收窄」表述作废。
  5. **填空题面补 `required`**：报告未明说填空题面是否必填，按契约「清空必填字段不保存并提示」与既有 EditableText「清空不落库」保护等价性，给填空题面（与问答/图片遮挡题面一致）加了 `required`——否则清空保存会把整张填空卡挖空源清成空串（弱于改动前保护）。
  6. **浏览器详情区提示文案变更**：原提示"挖空卡自动回填挖空语法"描述的 `[…]` 还原机制已删除，文案改为"填空卡直接编辑挖空源文本"（en/ja 同步；无测试断言该串）。
  7. **手工 5 卡验收以替代手段完成（本会话无法实机截图）**：①-⑤ 逐项代码级走查（① qa/cloze 背面编辑分支 = EditableField 读态 = ReadMarkdown 渲染；② 点击→MarkdownEditor WYSIWYG、Esc→commit→onDone→回读态；③ ClozeDraftEditor 显示并保存 `{{cN::…}}` 原文、无顺序还原、挖空数量编号逐字节保留；④ required 清空→emptyHint 3s、原值不动；⑤ http(s) 图片经 Milkdown 序列化 `![](http…)` 存活且 ReadMarkdown 放行）+ 真实管线等价断言（node 直跑 ReadMarkdown 插件序列：`**粗体**`→`<strong>`、`<b>`→元素渲染、GFM 表格默认放行、math/markdown-offset-map 套件锁定）+ 自隔离 GUI 冒烟（cards.gui 与 main 同构）。截图验收留待主控实机复核。（更正尾注 2026-10-24 对抗审查：⑤ 中 data:/bookasset src 的图在**新旧管线同不渲染**——react-markdown 渲染期 URL 过滤所致，非 C-34 变化；⑤ 的完整可达形态与证据见偏离 4 更正段。）
- **副产物**：`tests/m15r.*.bundle.cjs` 变脏已还原；提交用显式路径。

### 3.41 C-35 · 一致性机器闸门（已有的闸门已被突破且没人运行，P2）

- **提交**（每步一提交）：`d97be71`（a E1 Token 修复 + F09 E1 豁免）→ `603d807`（b 一致性闸门脚本 + lint:consistency + 基线 JSON）→ `9841b36`（c CI 接入 + F09 E2 口径与基线更新）；合并 `9ecd7b9`（分支 `fix/C-35`，基线 main `4fdc738`）。7 文件 +369/−28。
- **改动**：
  - **a**：`src/theme.css` 全局替换 `var(--hairline)`×11 → `var(--border-subtle)`（:36/:212 在册）、`var(--mono)`×9 → `var(--font-mono)`（:73）、`var(--sans)`×2 → `var(--font-sans)`（:70）——原 11 处 hairline 全部在学习者页 `.learner-*` 区块（:8966-:9021，报告引用的 :8867 是旧快照行号）；`.cb-deck-pop`（:4609）回落值 `var(--bg-1)` → `var(--surface-overlay)`（主控裁定，见偏离 1）。F09 E1 加两豁免：TS `setProperty("--xxx"` 注入的 Token 视为已定义（报告 C-35 步骤 1，`--wb-main-w` 误报——workbenchLayout.ts:109）；扫描前剥离 CSS 注释（偏离 2）。
  - **b**：新建 `scripts/consistency-check.mjs`（纯 Node 无依赖，实测 ~0.27s）：规则 1 未定义 Token（同 F09 E1 + setProperty 豁免 + 注释剥离）/ 规则 2 颜色字面量（#hex + rgb(a)( + hsla(a)(，跳过注释行；COLOR_ALLOW = `src/skins/**/manifest.ts` + `src/lib/accentVar.ts` + `src/lib/reader/foliate/appearance.ts`，其余按「文件→次数」棘轮）/ 规则 3 !important 与内联 svg 只许变少 / 规则 4 动效时长写死（C-32 后硬 0）/ 规则 5 编辑器白名单（EDIT-CONTRACT 9 文件 + contentEditable=0 + ReactMarkdown 仅 ReadMarkdown.tsx，跳过注释行）/ 规则 6 含 `key === "Enter"` 必含 `isImeComposing`（dialogA11y.ts 无 Enter 分支天然不涉及，脚本头注登记口径）/ 规则 7 `:hover` 设 `opacity:1` 须 `.reveal-on-hover`（C-36 前棘轮）/ 规则 8 子进程 skin-audit + i18n-check。失败退出码 1 逐条「文件:行 规则 修法」；`--update-baseline` 只许收紧（新增非零计数文件拒绝入基线的防放宽守卫，实测生效）；`package.json` 加 `lint:consistency`；基线 `scripts/consistency-baseline.json`。
  - **c**：`.github/workflows/build.yml` 在 npm ci/跨架构依赖之后、测试之前加阻断步骤 `npm run lint:consistency`（js-yaml 解析验证步骤序列）；F09 E2 按 C-35b 的 COLOR_ALLOW 口径重算（皮肤 manifest/accentVar/EPUB appearance 豁免，注释与脚本互指）+ 基线更新（hardcodedHexFiles 6→6 数值未变口径已换、importantCount 7→14、rawSvgCount 19→35）。
- **验收**：`npm run lint:consistency` 退出码 0（分支与合并后 main 双验）；负例——Bookshelf.tsx 临时加 `style={{ color: "#ff0000" }}` → 退出码 1 且逐条 `src/components/Bookshelf.tsx:947 规则2 颜色字面量(新文件)`（验证后撤销；带违规跑 `--update-baseline` 被防放宽守卫拒绝亦验证）；`rg -n "var\(--(hairline|mono|sans)\)" src/theme.css` 无结果（连带 `--bg-1`）；F09 从改动前 **FAIL 24/28 → PASS 28/28**（E1/E2/E3/E5 四败全消）；`npm run typecheck` 0 错误；**最终干净全量 116 个 115 过 / 1 败 / 0 超时 = applog（§1.1 既有）**，失败集合与基线完全一致，无新增失败文件；截图验收以替代证据完成（偏离 6）：确定性级联解析探针对真实 theme.css+claude.css 求值——11 条学习者分隔线规则（与原 --hairline 计数一一对应）与 `.cb-deck-pop` 背景在 swiss/claude × 深/浅 4 组合全部解析为具体颜色（--border-subtle：#e0e0e0 / #2a2a27 / rgba(20,20,20,.10) / rgba(255,255,255,.09)；.cb-deck-pop 背景：#fafaf8 / #101010 / #ffffff / #222220），--font-sans/--font-mono 同过；实机截图留待主控复核。
- **规则 1-8 最终基线值与违规数实测**：

  | 规则 | 实测违规/计数 | 基线 |
  |---|---|---|
  | 1 未定义 Token | 0 | 硬 0 |
  | 2 颜色字面量 | 7 文件 38 处（AnnotationEditor 1 / Reader 4 / SettingsPanel 4 / charts/kit 16 / mindmap/v2/svg 9 / main.tsx 1 / _lab/index.tsx 3） | 同左逐文件棘轮 |
  | 3 !important / 内联 svg | 14 / 35 | 14 / 35 棘轮 |
  | 4 动效时长写死 | 0（animate.ts:200 `duration: number` 是类型声明非字面量） | 硬 0 |
  | 5 编辑器白名单 | 0（textarea 9 文件全在白名单；contentEditable=0；ReactMarkdown 仅 ReadMarkdown.tsx） | 硬 0 |
  | 6 IME 守卫 | 0（19 个含 Enter 文件全有 isImeComposing） | 硬 0 |
  | 7 hover-opacity | 7 | 7 棘轮（报告「4 处」为行级口径，见偏离 4） |
  | 8 子审计 | skin-audit OK / i18n-check OK（存量即绿，无归属处理） | 退出码 0 |

- **偏离说明**：
  1. **:4609 回落值按主控裁定改为 `var(--surface-overlay)`**（上一会话按报告明令 BLOCKED，主控对抗复核后裁决）：报告原文 `var(--bg-surface)` 的前提为空集——`--bg-surface` 与全部 `--bg-*` 在任何提交中从未存在（`rg "^\s*--bg-\w+\s*:" src/theme.css` 零命中、`git log -S "--bg-surface"` 空）；`--surface-overlay` 是实际 Token 家族中语义唯一正确者——theme.css:313 body 级注释「弹层/菜单/对话框/tooltip/toast」，claude.css :32/:103 浅深双档覆盖，swiss 无 CSS 走 body 默认派生 `--paper`；`.cb-deck-pop` 是弹层。只换回落值，保留 `--bg-elevated` 主槽位（带回落形式 F09 E1 不计，该行清零）。
  2. **F09 E1 加注释剥离（报告未列）**：theme.css:9616 分节注释里的 `var(--token)` 会被 F09 正则当成引用（报告快照后 mindmap v2 批次出现的注释），不剥离则 C-35a 后 E1 仍红；属扫描口径修正（与规则 2「跳过注释行」同精神），零行为改动。unusedTokens 记录值 22（剥离前后同值；基线 2 为陈旧最小值，无失败断言挂靠，未动）。
  3. **规则 2 口径比 F09 E2 宽（+rgb/hsl、跳注释行）**：文件集 7 与 F09 E2 hex-only 豁免后 6 不同——差异 = `src/skins/_lab/index.tsx`（3 处 rgb(，报告 COLOR_ALLOW 未覆盖，未擅自扩豁免，按棘轮入基线）与注释跳过造成的次数差；F09 E2 与闸门口径已在两侧注释互指。
  4. **规则 7 实测 7 处 vs 报告「当前 4 处」**：报告口径为行级 rg（漏 3 条多行选择器规则 annot-acts:1992 / reader-theme-manage-actions:4199 / journal-entry-actions:4791）；脚本按 CSS 块解析计 7（:1992/:3108/:4170/:4199/:4575/:4791/:6696），按实测棘轮 7——C-36 收编后应收紧到 0。
  5. **E3/E5 实测 14/35 vs 报告 13/34**（主树自报告快照演进所致；上一会话曾实测 E5=32，属口径/时点差）——一律以本次 F09 自身扫描为准并落入基线。
  6. **截图验收以替代证据完成（本会话 CopyFromScreen 全黑帧，§5 既有环境事实）**：确定性级联解析探针（/tmp 一次性，未入库）对真实 theme.css+claude.css 按 `@layer base{:root→body→body.theme-dark}` + `body.skin-claude[.theme-dark]` 顺序求值、var() 链递归解析（含 fallback 与循环防护），11 条 `.learner-*` 分隔线与 `.cb-deck-pop` 背景 4 组合全部解析为具体颜色、字体 Token 同过；实机截图留待主控复核。
  7. **backup 跨午夜 flake 登记进 §1.1**（主控批准，不改测试代码）。
- **副产物**：`tests/m15r.activity.bundle.cjs` / `tests/m15r.layout.bundle.cjs` 被全量跑脏两次，均 `git checkout --` 还原未入库；提交全部显式路径。

### 3.42 C-36 · 平板/触控：只在鼠标悬停时出现的操作，在触屏上找不到（P2）

- **提交**：`b1d51ef`（fix，单一改动面未拆子提交）/ 合并 `3dd7464`（分支 `fix/C-36`，基线 main `5370a0b`）。8 文件 +115/−30（src/theme.css、AIPanel.tsx、JournalView.tsx、SettingsPanel.tsx、editor/CardFields.tsx、scripts/consistency-check.mjs、scripts/consistency-baseline.json、docs/UI-CONVENTIONS.md 新建）。
- **改动**：
  - `src/theme.css` 新增「悬停显形工具类」节（报告 :2843-2854 **逐字**）：`.reveal-on-hover { opacity: 0; pointer-events: none; }` / `:is(:hover, :focus-within) > .reveal-on-hover` 与 `> * > .reveal-on-hover` 父级链两档 / `.reveal-on-hover:focus-visible` / `@media (hover: none), (pointer: coarse)` 常显 / `prefers-reduced-motion: no-preference` + `body.motion-full` 过渡（--dur-hover/--ease-out-soft 在册 Token）；另加报告 :2855 的 `.reveal-scope:is(:hover, :focus-within) .reveal-on-hover` 变体（本项 4 控件全部是行元素直接子级，变体未被消费，备而不用）+ 报告 :2857-2861 **逐字**命中区 `@media (pointer: coarse) { .zdots, .icon-btn { min-width: 44px; min-height: 44px; } }`。
  - 4 控件改造（行号按 rg 锚点实测，报告行号系旧快照）：`.ai-kp-pencil`（旧 :4209-4210，AIPanel.tsx:398）/ `.reader-theme-manage-actions`（旧 :5735-5743，SettingsPanel.tsx:1745+1754）/ `.journal-entry-actions`（旧 :6608-6618，JournalView.tsx:282+332 两处）/ `.wb-pick`（旧 :8679-8699，CardFields.tsx:90）——TSX 挂 `reveal-on-hover` 类，删除各自 `opacity: 0` / `:hover{opacity:1}` / `pointer-events:none` 规则；`-show` 强制显示类保留兼容（TSX 两态 span 均挂 reveal-on-hover，`.reader-theme-manage-actions-show { opacity: 1; pointer-events: auto; }` 在工具类之后覆盖——确认删除态恒常显）；`.journal-entry-actions` 的无条件 `transition` 与 `.wb-pick` 的 no-preference `transition` 一并删除（显形过渡移交工具类 motion-full 作用域，C-32 三态纪律）。
  - 规则 7 收口：`scripts/consistency-check.mjs` 顶部加 `REVEAL_ALLOW` 三条豁免（各附证据注释，见下表），规则 7 计数 = 非 `.reveal-on-hover` 且不在豁免表的 `:hover{opacity:1}` 块；`--update-baseline` 收紧 `hoverOpacityCount` **7 → 0**；负例验证（临时追加 `.ztest-wrap:hover .ztest-fake { opacity: 1 }`）→ 闸门报「规则棘轮回退 1 > 基线 0」失败，还原后 OK。
  - 新约定文档 `docs/UI-CONVENTIONS.md`（选型：报告要求「EDIT-CONTRACT.md 旁边的 UI 约定」——EDIT-CONTRACT.md 是闸门规则 5 机器读取的编辑行为契约，悬停显形属另一关切面，故新建并列文件而非混入；reveal 写法全仓统一约定 + REVEAL_ALLOW 扩表须先在文档登记 + 44px 命中区校核口径 + 豁免证据表）。
- **规则 7 逐条收口证据表（原 7 处 → 4 处工具类收编 + 3 处豁免）**：

  | 原规则（选择器） | 基础态 | 去向 |
  |---|---|---|
  | `.ai-kp-row:hover .ai-kp-pencil` | `opacity: 0` | **转换**：工具类收编（TSX 挂类 + 删规则） |
  | `.reader-theme-manage-row:hover …-actions, …-actions-show` | `opacity: 0` | **转换**：工具类收编；`-show` 强制显示类保留（工具类之后覆盖 opacity/pointer-events） |
  | `.journal-entry:hover .journal-entry-actions, …:focus-within` | `opacity: 0` | **转换**：工具类收编 |
  | `.wb-field:hover .wb-pick, …, .wb-pick:focus-visible` | `opacity: 0; pointer-events: none` | **转换**：工具类收编（基础态两属性与工具类一致） |
  | `.annot-side .zitem:hover .annot-acts` | `opacity: 0` | **豁免（报告判定）**：报告 C-36 证据段原文「`.annot-acts` 的删除确认…有 `.zitem.confirming` 常显规则，没有问题」——实测 `.annot-acts` 只在确认态挂载（AnnotationPanel.tsx:293），`.zitem.confirming .annot-acts { opacity: 1 }`（theme.css :3047）恒显兜底；交接包范围外明令不改 |
  | `.reader-tap-zone:hover .reader-tap-hint` | `opacity: 0; pointer-events: none` | **豁免（非操作）**：装饰性翻页 chevron 提示，本体不可点；操作本体＝翻页热区常在常可点；报告证据清单只列可操作控件；改它会改变触屏 UX（提示常显），超范围 |
  | `.chart-svg:hover .chart-dot`（含基础态同在 `@media (hover: hover)` 内） | `opacity: 0`（仅 hover 设备） | **豁免（已有触控替代）**：基础态与显形规则整体包在 `(hover: hover)` 内，无 hover 能力时数据点常显（theme.css 块注释自证「无 hover 能力时数据点常显」）；图表 hover-dim 强调效果，非可操作控件 |

- **验收**：报告 rg 锚点——`rg -n "\.ai-kp-pencil \{ opacity: 0|\.journal-entry-actions \{" src/theme.css` 第一分支 0 命中；第二分支命中 :6629 布局块（flex/gap/padding，**无 opacity**，非隐藏规则，属报告 rg 模式偏宽的合法残留，精确口径「不再出现单独的隐藏规则」成立）；旧显形选择器全仓 0 命中（`.reader-theme-manage-row:hover` 残留命中为 D130 行 hover 背景高亮，与显形无关）。`npm run typecheck` **0 错误**；`npm run build` 成功（dist/assets/theme-*.css 与主 chunk 均含 reveal-on-hover）；`npm run lint:consistency` 退出码 0（规则 7 = 0，分支与合并后 main 双验）；**最终干净全量 116 个 115 过 / 1 败 / 0 超时 = applog（§1.1 既有）**，改动前基线实测同为 116 个 115 过 / 1 败（applog），失败集合完全一致，无新增失败文件。
- **触屏验收（替代证据，偏离 2）**：本环境 CopyFromScreen 全黑帧 + 无实机触屏（§5 环境事实），按交接包批准走 CDP 探针 `tests/tmp-c36/probe-c36.mjs`（一次性未入库）对 **dist 真实应用 + 真实 theme.css 级联**断言，**26/26 全过**：①鼠标默认态 4 控件 opacity=0/pointer-events=none（与改前一致）、`-show` 恒显可点；②`Input.dispatchMouseEvent` 真实悬停行 → `.ai-kp-pencil` opacity=1、移开回 0（鼠标行为不变）；③键盘 focus 行内按钮 → `:focus-within` 显形（journal/wb-pick 双验）；④触屏模拟 4 控件 + `-show` 不悬停 opacity=1/pointer-events=auto；⑤`.zdots`/`.icon-btn`（夹具 + 顶栏真实按钮）44px 命中区生效；⑥768px+触屏：批注行/zmeta 无横向溢出、单行不换行（高度<60px）、顶栏 48px 不增、无溢出；⑦768px+鼠标：44px 命中区不泄漏（min-width 恢复 0/auto）。探针 DOM 类名链逐一取自真实 TSX（AIPanel/SettingsPanel/JournalView/CardFields/AnnotationPanel）。
- **偏离说明**：
  1. **规则 7 语义按交接包授权收敛并加 REVEAL_ALLOW 豁免表**：交接包原拟语义「非悬停态隐藏的 :hover{opacity:1}」在该语义下剩余 3 条（annot-acts/reader-tap-hint/chart-dot 基础态全为隐藏）仍会计数，与「genuine hover-reveal 必须为 0」及「不扩面改控件/不改 .annot-acts」直接冲突——按报告意图（规则 7 原题「悬停才显示的**操作**必须有触控替代」）实现为「非 .reveal-on-hover 且不在 REVEAL_ALLOW 的 :hover{opacity:1}」，3 条豁免逐条证据见上表与脚本顶部注释，扩豁免须先在 docs/UI-CONVENTIONS.md 登记。基线 hoverOpacityCount 7→0 已落地。
  2. **触屏验收以 CDP 设备模拟替代实机**（报告验收原文允许「Chromium 开发者工具中开启设备模拟（触控）」）：实测 Electron 45 CDP `Emulation.setEmulatedMedia({features:[…]})` 返回成功但对 matchMedia/媒体查询 **no-op**（dbg-media*.mjs 两轮实证）——改用 DevTools 设备工具栏同机制 `setDeviceMetricsOverride({mobile:true}) + setTouchEmulationEnabled`，matchMedia `(hover:none)`/`(pointer:coarse)` 均翻转，与报告原定断言等价；768px 布局检查同机制。实机触屏走查仍归 U-23。
  3. **报告 rg 验收第二分支合法残留**：`.journal-entry-actions {` 命中的是布局块（无 opacity），报告模式未区分「隐藏规则」与「布局规则」；精确判据（无单独隐藏规则）成立，如上验收段载明。
  4. **`.journal-entry-actions` 与 `.wb-pick` 的旧无条件 transition 一并删除**（报告只列删 opacity/:hover 规则）：该过渡是显形动画的实现，移交工具类 motion-full 作用域后若保留会与工具类双写同一属性且绕过 C-32 三态纪律（motion-off 下仍动画），属收编的组成部分而非行为收窄——probe 断言鼠标态显隐行为与改前一致。
  5. **流程闸门零波及**：本项不触设置键/文档集/IPC，未复跑 F 系（C-33/C-34 同口径）。
- **副产物**：`tests/m15r.activity.bundle.cjs` / `tests/m15r.layout.bundle.cjs` 全量跑脏，`git checkout --` 还原未入库；`tests/tmp-c36/`（probe/dbg 脚本、日志、隔离 userdata）按 tmp 不入库；提交显式路径。

### 3.43 C-37 · 主题模式没有"跟随系统"（P3）

- **提交**：`dd39c9c`（fix，单一改动面未拆子提交）/ 合并 `c922497`（分支 `fix/C-37`，基线 main `3a1c4de`）。7 文件 +182/−21（src/App.tsx、src/components/SettingsPanel.tsx、src/skins/WindowSkin.tsx、src/skins/runtime/readAppearance.ts、electron/workbenchWindow.js、electron/quickCapture.js、tests/window-skin.test.cjs）。
- **改动**：
  - `ThemeMode`（SettingsPanel.tsx:63，报告 :61 行号漂移）增加 `"system"`；设置页「主题模式」三档按钮 浅色/深色/跟随系统——高亮按新增 `themeMode` 原始档 prop（`"system"` 时浅/深都不亮）；i18n **零新键**（`跟随系统`/`浅色`/`深色` 三语键 D170 动效设置时已登记，en.ts/ja.ts :59/:60/:69 实测在册）。
  - `readAppearance.ts`：报告 :2880-2885 **逐字**新增 `resolveThemeMode(mode): "light"|"dark"`（显式档原样；"system" 与未知值 → `matchMedia("(prefers-color-scheme: dark)")`）；`Appearance` 增超集字段 `modeSetting`（原始档，未知值归一 `"system"`，与 resolveThemeMode 未知值语义一致；先例=accentLegacy/motionSetting）；`readAppearance()` 改出 `mode: resolveThemeMode(m)` + `modeSetting` 双出。
  - `App.tsx`：`themeMode`（原始档真源）与 `theme`（解析档，恒 `"light"|"dark"`，与 SkinHost `ColorMode` 同型）双 state（与 motion 的 motionSetting/motion 同构）；`handleThemeChange` 现场解析并 `eventBus.emit("theme/changed", resolved)` 发**解析后的**值（App.tsx / Reader.tsx:1607 / dashboard/Dashboard.tsx:83 三监听者零修改）；新增 effect：themeMode==="system" 时挂 `prefers-color-scheme: dark` mq change 监听（重解析 + 发 theme/changed），切回显式档随 effect 重跑移除；初始化 `setThemeMode(ap.modeSetting)`；设置面板透传 `themeMode`。
  - `WindowSkin.tsx`：`refreshRef` 暴露挂载 effect 内的 refresh（epoch 守卫同源）；新增 effect：`ap.modeSetting==="system"` 时挂同名 mq 监听重读外观，切回显式档移除——lens/制卡台/捕获三独立窗口同一条链路。
  - 主进程 `themeBackground()` 两处（workbenchWindow.js:38 逐字锚点命中 / quickCapture.js:254，报告 :228 行号漂移）：`mode === "dark" || (mode === "system" && nativeTheme.shouldUseDarkColors)`（workbench #111111/#fafaf8、capture #111111/#ffffff）；未知值维持既有回落浅色；两处导出 `themeBackground` 供桩测试（C-29 isAutoLaunchOn/applyAutoLaunch 先例）。
  - 默认值保持 `"light"`（报告步骤 5，不改变现有用户外观）。
- **契约判定（交接包待决项，留主控复核）**：**GUIDE 零改动、不新增 D 号、不 bump 版本**——①零新设置键（`theme.mode` 在 F18 DOC_KEYS :83 键级已登记，本项仅扩枚举值）；②默认值与写侧归一零改动（C-28 教训「改默认值/归一口径＝契约变更」的触发条件不成立）；③GUIDE §7.4/§4.2 **无 theme.mode 值域登记行可同步**（全文档 `rg "theme.mode"` 仅 :621「暗色随 `theme.mode`」表述性提及，扩枚举后仍为真；设计档案 SETTINGS-REDESIGN-D114.md「seg-tabs ×2」是 D114 时点设计稿非机器闸门面，未改）；④零新 IPC/事件通道（settings:changed 广播、eventBus 锁定事件表均未动）。流程闸门零波及，未复跑 F 系（C-33/C-34/C-36 同口径）。
- **验收（2026-10-25，Windows；Electron 45.0.0）**：
  - `npm run typecheck` → exit 0（两轮到位：首轮暴露解析档/原始档分型点 2 处——App `theme` state 收窄 `"light"|"dark"` 与 SkinHost ColorMode 对齐、SettingsPanel `Props.theme` 收窄解析档修正 `defaultAccent?.[theme]` 索引——修正后通过）。
  - 改动前基线实测：116 个 115 过 / 1 败（applog §1.1 既有，本会话复跑确认）+ typecheck / lint:consistency / i18n:check 全绿。
  - **最终干净全量（合并后 main）116 个 115 过 / 1 败 / 0 超时**：唯一失败 = applog；`window-skin` 扩展后通过，失败集合与基线完全一致，无新增失败文件。`npm run build` 成功（6.71s）；`npm run lint:consistency` 退出码 0（规则 2 颜色字面量棘轮零新增——本项零颜色字面量）；`npm run i18n:check` 通过（1802 键，零新键）。
  - `tests/window-skin.test.cjs` 扩展（C-31 套件原地扩，零新增测试文件）：A 场景期望补 `modeSetting`；resolveThemeMode 纯函数矩阵 7 断言（light/dark 原样、system/未知值 × 深/浅两系统档）；readAppearance system/未知值双出 6 断言；themeBackground electron require.cache 桩 12 断言（workbench/capture × dark/light/system×浅深/设置缺失，nativeTheme.shouldUseDarkColors 受控翻转，桩模式同 tests/app-menu.test.cjs）；C-37 静态接线 5 组（App 消费 resolveThemeMode + mq 监听 + 发解析值 / WindowSkin mq 监听 / 设置页三档按钮 / 两主进程 system→nativeTheme 分支）。
  - **CDP 探针替代验收**（报告验收要求实机切系统深浅色；本环境不可行——CopyFromScreen 全黑帧 §5 环境事实 + C-36 实证 Electron 45 `Emulation.setEmulatedMedia` 对媒体特征 no-op；按交接包批准的替代方案①执行，未伪造截图/实机声明）：`tests/tmp-c37/probe-c37.mjs`（一次性未入库）对 dist 真实应用 + 页内 matchMedia 桩（prefers-color-scheme 单例 MQL + 受控 matches + 真 addEventListener/removeEventListener 语义，dispatch 等价 MediaQueryListEvent 的 change；resolveThemeMode 重查询取到新 matches，与真实系统切换后 mq 既有 matches 又派发 change 等价）**21/21 全过**：
    * 主窗口（**真实 UI 路径**：开设置弹窗 → 按钮组形状定位点 seg-tabs 按钮 → onThemeChange → handleThemeChange）A1-A9：显式 dark → theme-dark 不回归；点「跟随系统」→ resolveThemeMode 现场解析落 theme-light；`settingsAPI.get("theme","mode")` = `"system"`（原始档落盘）；三档高亮仅「跟随系统」active；系统切深色 **36ms** 内 theme-dark（验收线 1s）；App 监听数=1；系统切浅色跟随；切回显式 light 后监听数=0 且系统再切不翻面；重选 system 监听重挂并跟随深色。
    * lens（WindowSkin 链路）B1-B6：system 档系统切深色 **2ms**；监听数=1；主窗切显式 light 经 settings:changed 广播 → lens 重读跟随且监听移除（本地再 dispatch 不翻面）；主窗重选 system → lens 监听重挂跟随。
    * 制卡台 C1-C3：system 档系统切深色 **3ms** 跟随。
    * 三窗均远低于「1 秒内同时切换」验收线（0-36ms）。
- **偏离说明**：
  1. **主窗口探针必须走真实 UI 点击而非 `settingsAPI.set`**：`settings:set` 广播只发给除发起窗口外的所有窗口（C-31 机制），主窗口自身的 App state 不随 settingsAPI.set 变化——探针首版 3 处假失败即此机制误用，已按真实路径重写；反而额外锁定「设置页点击 → 现场解析 → 发解析值 → 落类」全链（A2/A4）。
  2. **`Appearance` 增 `modeSetting` 超集字段**（报告接口之外，与 accentLegacy/motionSetting 同先例）：调用方需要原始档决定监听挂载与按钮高亮，按报告接口则要二次读键（两处读取面）；未知值归一 `"system"` 使按钮高亮与 resolveThemeMode 的未知值解析语义一致（否则出现「高亮浅色、落窗深色」脱节）。
  3. **`Props.theme` 分型收窄 + 新增 `themeMode` prop**（报告步骤 1 未规定 prop 拆分）：SettingsPanel 的 `theme` prop 收窄 `"light" | "dark"`（解析档；消费方 = `defaultAccent?.[theme]` 索引），`themeMode` 承载原始档——按「解析档/原始档」语义的最小组合，typecheck 首轮 2 错误的修正即此分型。
  4. **capture 窗口未实机验证**（D159 `CAPTURE_DISABLED=true` 窗口不创建，C-31 偏离 7 同口径记「未验证」）：静态接线证据 = capture.tsx 挂 `<WindowSkin />`（system 档监听与 lens/制卡台同链路）+ preload-capture.js onChanged + window-skin 桩测试覆盖其 themeBackground system×深浅两档（#111111/#ffffff）；「无白闪」机制未动（createWindow `backgroundColor` + show 前 `setBackgroundColor` 既有两挂点，报告步骤 4 只改取值函数）。
  5. **resolveThemeMode 对未知值跟随系统**是报告 :2880-2885 逐字规定（行内注释「"system" 与未知值」），与旧实现「未知值 → light」不同——属报告明令的行为变更非回归；主进程 themeBackground 对未知值维持保守回落浅色（报告步骤 4 只规定 system 档，未知值无规定，取不改变既有行为的最小解，两处注释已载明）。
- **副产物**：`tests/m15r.activity.bundle.cjs` / `tests/m15r.layout.bundle.cjs` 两次全量跑脏，`git checkout --` 还原未入库；`tests/tmp-c37/`（probe 脚本、日志、隔离 userdata）按 tmp 不入库；提交显式路径 7 文件。

### 3.44 C-38 · 云同步预留：让"同步四件套"名副其实、登记每张表、设置分层（P2）

- **提交**（分支 `fix/C-38`，5 个）：`df86c76`（a 登记表）、`5657d21`（b 迁移+触发器+两测试）、`1ce8b22`（c 设备 ID）、`2676d98`（d 设置分层）、`779de18`（docs：GUIDE v49.41/D212）；合并 `8227488`（基线 main `c922497`）。16 文件 +490/−11。
- **改动**：
  - `electron/syncTables.js`（新建，报告 :2925-2969 逐字）：SYNC 23 / APPEND 5 / LOCAL 12 共 40 表恰好三分（与 db.js 38 CREATE TABLE + app_meta + sync_tombstones 逐一核对，无 C-10 后新增表、无 ⚠D-07 增项）；LOCAL_COLUMNS / NATURAL_KEYS / PHYSICAL_DELETE_ALLOWLIST。**偏离 1**：允许清单增 `{ table: "assets", fn: "createAssetForItem" }`——报告清单遗漏了 db.js:1295 的 `DELETE FROM assets`（C-22 rename 失败补偿、删无文件对应的悬空行），tests/sync-tables 的静态扫描契约会拦，实测补登并注明（墓碑照写；对从未传输过的行按 no-op 处理属 D-07 范畴）。
  - `electron/schemaVersion.js`：MIGRATIONS v4 `sync_prep`（报告 :2976-2988 逐字）——card_issues / ai_gen_batches / material_map_edges 补 sync_version + is_deleted（"is_deleted 现无代码置 1、不加查询过滤"照报告执行）；建 `sync_tombstones`（tbl+row_id 主键 WITHOUT ROWID）；SCHEMA_VERSION 3→4。
  - `electron/syncTriggers.js`（新建，报告 :2993-3029 逐字，仅文件头补 D212/GUIDE 登记指针注释）：`installSyncTriggers(db)` 在 initDb 的 `runMigrations` 之后调用（db.js 一处接线）——每次启动先删后建幂等重建；AFTER DELETE 写墓碑、AFTER INSERT 同 id 重插撤销墓碑、AFTER UPDATE 仅在「业务语句没自己递增且确实有列变化」时 +1（内部 UPDATE 使 WHEN 不成立，recursive_triggers=ON 也不递归；绝不改 updated_at）。**零业务代码改动**：现有 UPDATE/DELETE 语句零修改（rg 复核）。
  - **文档登记（报告称「C-10 规则唯一登记例外」）**：GUIDE 中该规则的登记行现状 = §4 表结构域 + §7.2 + §7.2 不变量清单三处「schema 变更只有一种方式」行（**C-10 当时未登记进 GUIDE，三处仍是 C-10 前的「启动时 ALTER + try/catch」旧口径**）——按「文档先行」随本项一并改述为 MIGRATIONS 现状并登记触发器例外，标题 bump v49.40→v49.41，§8.1 新增 **D212**；F11 复跑 14/16 与基线同口径（L1 `src/lib/readerActionsSettings.ts` 与 L6 表数声明为既有红，GUIDE :1706 自证；L3 版本 49.41/49.41、L4 D212 无缺号、L5 零重复全过）。
  - `electron/deviceId.js`（新建，报告 :3037-3057 逐字）+ `getDeviceId(app.getPath("userData"))` 进 main.js backupOpts + 备份 meta 增 `deviceId` / `schemaVersion`（backup.js meta 构建处，缺省 null 向后兼容）；备份清单成员不变（device.json **不加入**，显式列举核验）；新只读 invoke 通道 **`backup:meta`**（main.js + preload backupAPI.meta + SettingsPanel 类型）——恢复确认对话框按 `fromOtherDevice` 追加「此备份来自另一台设备。」（只提示不阻止；i18n en/ja 各 +1 键=1803，zh-TW 经 opencc，zh-CN 为源键——「四语」口径与仓内 en.ts/ja.ts/zhTwOverrides 结构一致）。
  - `electron/settingsLayers.js`（新建，报告 :3064-3077 逐字）：DEVICE_KEYS 7 键 + DEVICE_FILES（ai-config.json、device.json）+ layerOf；C-13 的 `DEVICE_KEYS = ["backupDir", "closeToTray"]` 本地常量删除、改从这里导入（注释同步）；globalShortcuts.autoLaunch 嵌套特判原样保留。
- **测试**（3 个新文件，28 断言）：`tests/sync-tables.test.cjs`（electron，6）——每张表恰好三分/登记名真实存在/SYNC 三列齐/APPEND 有 id/DELETE FROM 静态扫描全在允许清单/允许清单表名真实存在；`tests/sync-triggers.test.cjs`（electron，13，第二连接直跑 SQL）——报告 9 组全落（插入 0 / 真变化 +1 且 updated_at 不变 / 同值不增 / 手写 +1 不重复 / recursive_triggers=ON 仍只 +1 / 删→墓碑→同 id 重插撤销 / review_logs 墓碑 / 重启幂等 / ALTER 新列纳入）；`tests/settings-layers.test.cjs`（electron-node，9）——登记键真实存在/清单字面量只在 settingsLayers（扫描面=electron/src/scripts/tests 四代码目录，docs 叙述不算副本；字面量动态拼装防自命中）/layerOf 抽查。
- **验收（2026-10-25，Windows；Electron 45.0.0）**：
  - 改动前基线：`npm test` → 116 个 115 过 / 1 败 / 0 超时（applog 既有，本会话复跑确认）；附录 A 基准：播种 71ms / 更新 2000 次 6.4ms / computeTodayQueue 中位 40.3ms（快速路径 7.2）/ listAll 34.7ms / RSS 167MB。
  - `node scripts/run-tests.mjs schema-version sync-tables sync-triggers` → 3 通过 / 0 失败；直跑 6+13 断言全过（迁移链 v2→v3→v4 兼容，新库 user_version=4）。
  - `node scripts/run-tests.mjs settings-layers` → 1 通过 / 0 失败。
  - 邻接套件：undo / restore-flow / backup / m14 / m13 / legacyBackfill / m15v2.dbstatic / userData / persist → 11 通过 / 0 失败（**报告预设的测试期望处置两处均未触发**：无「撤销后整行含 sync_version」比较（undo 只比 fsrs 对象），无断言「表的完整清单」需补 sync_tombstones 的站点——m13 快照只取 KEEP 表、m15v2.dbstatic 是列契约静态守卫）。
  - **附录 A 对比（最终树）**：播种 **78ms（1.10× ≤ 2×）** / 更新 2000 次 **11.2ms（1.75× ≤ 2×，2000 次触发器 WHEN 求值+内层 UPDATE）** / computeTodayQueue 中位 **40.5ms（+0.5%，±10% 内）** / 快速路径 7.4ms / listAll 34.5ms / RSS 165MB——三线全过，「索引命中：是」不变。
  - `npm run typecheck` → exit 0（三轮全绿）；`npm run build` 成功（8.31s）；`npm run lint:consistency` 退出码 0；`npm run i18n:check` 通过（1803 键，净增 1）。
  - `npm test`（无并行负载）→ 119 个 **118 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项），失败集合与基线完全一致，无新增失败文件。
  - **手动三则的等价替代（红线：绝不触碰真实 userData——未拷贝开发库，用临时目录从头建库 + 业务 API 全路径探针 12/12，临时已删）**：①评分（saveReview）→ sync_version 0→1；②撤销（undoLastReview）→ sync_tombstones 出现 ('review_logs', logId) 且卡 sync_version 再 +1（撤销也是一次变更）；③createMaterialMapV2（2 节点+1 边）→ deleteMaterialMap → 墓碑含版本行 + 两节点 + 一边（**墓碑键 = 各表主键 id**：nodes/edges 的主键是 UUID id 而非 node_id/自然键——将来同步引擎按 id 对账，D-07 须知）。deviceId 链路另有探针 7/7：首生成落盘/同 host 稳定/meta 回读一致/host 不一致重生成/旧档 deviceId=null。
- **偏离**：
  1. **PHYSICAL_DELETE_ALLOWLIST 增 assets 一条**（报告 4 条 → 5 条）：报告清单遗漏 db.js:1295 `DELETE FROM assets`（createAssetForItem 的 C-22 rename 失败补偿——删「已插行、无文件」的悬空行，行从未对用户可见）；tests/sync-tables 的「SYNC/APPEND 物理删除必须入清单」契约拦下，实测补登并注释。语义评估：墓碑照写，将来同步引擎对从未传输的行按 no-op——登记为 D-07 待议项。
  2. **tests/sync-tables.test.cjs 随 C-38b 提交**（报告步骤顺序是 C-38a 登记表 → C-38b 迁移）：其「SYNC 表都有 sync_version/is_deleted」断言依赖 v4 迁移的三个补列，随 a 提交即红；按仓库绿提交纪律（C-03/C-18 先例）落到 b，提交说明载明。
  3. **报告手动验收的「评分后 updated_at 不变」与 saveReview 既有业务行为冲突**：saveReview 的 `UPDATE cards SET fsrs_json, fsrs_config_id, updated_at = now`（db.js:2363）本就写 updated_at，且报告「零业务代码改动」红线禁止动它——按可验证口径执行：触发器绝不改 updated_at（sync-triggers S2 原样覆盖：不触 updated_at 的 UPDATE 后 updated_at 不变），业务评分后 updated_at 前进属既有行为（探针如实断言）。**未做实机手动验证声明**：三项均以临时目录 + 业务 API 全路径等价探针覆盖（12/12），真实开发库未拷贝未触碰。
  4. **报告 syncTriggers.js 代码块文件头补一行 D212/GUIDE 登记指针注释**（逻辑零改动）；**GUIDE 三处规则行的「MIGRATIONS 现状」改述超出触发器例外登记的最小面**——C-10 改机制时未登记 GUIDE（三处仍是 C-10 前旧口径），例外登记必须挂在正确的机制描述上，属一并纠偏；F11 验证通过。
  5. **backup:meta 新 IPC 通道**（报告只说「恢复确认对话框」未给机制）：恢复确认在渲染层、meta 在 zip 内，最小实现 = 只读 invoke 通道 + preload 桥 + SettingsPanel pickRestoreFile 预读；已在 D212 登记（D206「backup:info 增字段只登记决策行」同口径）。
  6. **DEVICE_KEYS 未新增键**：报告 7 键 rg 核对全部真实存在（backupDir/autoBackupKeep/closeToTray/updateAutoCheck/keybindings/multiSelectKey/activeThemePlugin）；报告给的两条 rg 侦察未见其他「明显本机专属」平铺键——globalShortcuts（含 autoLaunch）是嵌套对象键且 C-13 已有嵌套特判，窗口位置/尺寸无持久化键（C-13 已核），均不加入、如实列出。settingsLayers 语义影响 = C-13 恢复的设备键保护范围 2 键 → 7 键（报告明示意图）。
  7. **tests/settings-layers.test.cjs 清单字面量扫描面 = 代码目录四处**（electron/src/scripts/tests），非全仓：进度账与 GUIDE 的叙述性提及（如本账 §3.14 的旧常量记述）不应判红；字面量在测试内动态拼装防自命中。
- **副产物**：tests/m15r.activity.bundle.cjs / m15r.layout.bundle.cjs 两次全量跑脏，git checkout -- 还原未入库；tests/tmp-c38/ 探针与隔离目录按 tmp 不入库（已删）。

### 3.45 C-39 · 导出到 Anki · Phase 1（TSV + 媒体，单向）（P2）

- **提交**（分支 `fix/C-39`，3 个）：`5feccb9`（docs：GUIDE v49.42/D213 文档先行）、`18d2662`（impl）、`9188f51`（test）；合并 `58e923c`（基线 main `8330ffd`）。8 文件 +470/−3。
- **改动**：
  - `electron/ankiExport.js`（新建，报告 :3131-3292 **逐字采用**，仅文件头加一行 GUIDE/D213 指针注释）：convertCloze（CLOZE_SRC 与 `src/lib/cards.ts` parseCloze 正则**逐字相同**，读源核对 `/\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g` 一致；被遮空一律 `{{c1::…}}` 对应同答卡、hint 收集进 Back Extra）、protectMath/restoreMath（`$$…$$`→`\[…\]`、`$…$`→`\(…\)`，代码段内 `$` 不动，公式内 `}}` 写成 `} }`）、copyMedia（bookasset 与文档相对名两路；**唯一副本路径经 C-08 `resolveBookassetPath`**，越界/非法/不存在 → null → 计 warnings）、renderField（TSV 单行化：`<br>\s*\n`→`<br>`、`>\s*\n\s*<`→`><`、其余换行→`<br>`、`\t`→4 空格）、deckOf（`Nutation::<书名>`，`::`→全角「：」，无书名「未归属」）、tagsOf（原标签空白换 `_` + `nutation` + archived/suspended 子标签）、buildExport（纯函数；qa→Basic、cloze→Cloze、masked=0 跳过、其余类型进 skipped；Anki 2.1.54+ 文件头 `#separator/#html/#notetype/#columns/#tags column/#deck column/#guid column`）、writeExport（`Nutation-Anki-<时间戳>/`：basic.txt / cloze.txt / skipped.txt / README.txt + media/）；不 require electron，markdown-it `html:false`（与 epub 同安全选项）。
  - `electron/main.js`：`anki:export` handler（报告代码逐字——dialog 选目录 → `writeExport({ cards: dbModule.listAllCards(), userData: app.getPath("userData"), outRoot })`，异常 `{ok:false,error}`）+ 新增 `anki:openDir`（见偏离 1）。
  - `electron/preload.js`：backupAPI 增 `exportAnki`（报告点名）+ `openAnkiDir`（偏离 1 机制）。
  - `src/components/SettingsPanel.tsx`：backupAPI 局部类型补 `exportAnki`/`openAnkiDir`；`sec-backup` 分区末尾（「从备份文件恢复…」行之后）加「导出到 Anki」标题行 + 按钮（busy 三态扩 `anki`）+「打开文件夹」（有结果时）+ 说明文案 + 完成统计行；界面文案**零「牌组」**（D157，rg 复核仅注释含该词）。
  - `src/i18n/locales/en.ts` / `ja.ts`：各 +7 键（导出到 Anki / 导出到 Anki… / 导出中… / 说明句 / 统计句 / 打开文件夹 / 导出失败：{msg}）；zh-CN 为源键、zh-TW 经 opencc（C-38 同口径）。
  - `package.json` **零改动**：`markdown-it` 实测已在 `dependencies`（:50，^14.3.1）——报告「必须留在 dependencies」现状已满足，C-41b 瘦身时不得移走。
  - GUIDE（`5feccb9`）：标题 v49.41→v49.42；§6.8-9 非目标「导出」→「导出（例外：D213 导出到 Anki Phase 1）」（**未改任何 § 编号与既有 D 号**）；§8.1 新增 D213（编号取当时实测最大 D212+1，报告快照的「最大 D204」已过时）。
- **测试**：`tests/anki-export.test.cjs`（electron-node，**31 断言**）——报告步骤 5 清单逐条：①问答卡 5 列 / GUID=`nut-<id>` / Deck=`Nutation::书名`（含 #notetype:Basic 头）；②同答卡 `clozeOrds:[]` → `{{c1::甲}}和{{c1::乙}}`（convertCloze 直测 + buildExport 端到端）；③分答卡 `clozeOrds:[2]` → `甲和{{c1::乙}}`；④`{{c1::甲::提示}}` 正文无「提示」、Back Extra 含「提示：提示」；⑤跨行答案无裸 `\n` 且含 `<br>`（每条数据行都以引号开头=无断行碎片）+ Deck/前缀中 `"` 包裹并双写 `""`；⑥`$x_1$`→`\(x_1\)` 无 `<em>`、`$$\frac{a}{b}$$`→`\[\frac{a}{b}\]`、行内代码 `` `$PATH` `` 原样 `<code>$PATH</code>`；⑦`![](bookasset://item1/img-0.png)` → media 出现 `nut_item1_img-0.png` 且 HTML 引用该名、`..%2F..%2Fsettings.json` 不复制 + warnings 记入 skipped.txt、README.txt 存在；⑧标签 `["考研::英语","a b"]` → `考研::英语 a_b nutation`；⑨图片遮挡卡进 skipped.txt（含 id/类型/「图片遮挡卡暂不支持（Phase 2）」）；⑩固定 `now` 两次导出 basic.txt/cloze.txt **逐字节相同** + 目录名时间戳确定。临时 userData + `assets/item1/img-0.png`，绝不触碰真实数据目录。
- **验收（2026-10-25，Windows；Electron 45.0.0）**：
  - 改动前基线：`npm test` → 119 个 118 过 / 1 败 / 0 超时（applog 既有，本会话复跑确认）；typecheck 0 / i18n-check 1803 键 exit 0 / lint:consistency OK。
  - `node scripts/run-tests.mjs anki-export` → 1 通过 / 0 失败（31 断言；直跑同结果）。
  - `npm test`（无并行负载）→ 120 个 **119 过 / 1 败 / 0 超时**：唯一失败 = applog（§1.1 既有未归属项），失败集合与基线完全一致，无新增失败文件；规模 119→120（69/39/11 → 70/39/11）。
  - `npm run typecheck` → exit 0；`node scripts/i18n-check.mjs` → exit 0（1810 键，净增 7）；`npm run build` → 成功（8.74s）；`npm run lint:consistency` → 退出码 0。
  - 流程闸门：F11 **14/16** 回基线口径（文档先行提交点曾 13/16——L1/L9 新增两条即 D213 点名的 `electron/ankiExport.js` / `tests/anki-export.test.cjs` 落点，实现提交后消除；余下 L1 `readerActionsSettings.ts` 与 L6 表数为既有红）；F21 **7/7**（`anki:export`/`anki:openDir` 主进程注册 + preload 桥面两头齐、domain:verb 命名合规、无死通道）；F18 **90/91**（唯一失败 = 既有 `app.back` 消费者扫描误报，§3.37 基线口径一致）。
  - **性能（附录 A，`BENCH_N=100000 BENCH_ANKI=1`）**：播种 794ms / 更新 2000 次 11.2ms / computeTodayQueue 中位 546.7ms（快速路径 218.7ms、索引命中：是）/ listAllCards 中位 945.3ms（95.9MB）/ RSS 628MB；**Anki 导出 10 万张问答卡 = 1551ms < 3 秒阈值** → 按报告条件**不移 worker**（Phase 1 主进程直出）。
- **偏离**：
  1. **新增 `anki:openDir` 通道 + preload `openAnkiDir`**（报告只给 `exportAnki` 一个桥，并说「打开文件夹」复用现有 shell 打开目录 IPC）：现有通道无一能开「导出目录」（`backup:openDir` 开备份目录、`memory:openFolder` 开记忆目录、`log` 开日志目录），给既有通道加任意路径参数会扩大攻击面——改为 main.js 记住**最近一次 `anki:export` 自己创建的目录**（模块内 `lastAnkiExportDir`），`anki:openDir` 无参只开它（渲染层无法注入任意路径）；C-38 `backup:meta`「报告未给机制时最小新增只读通道」同口径。
  2. **报告「实机 Anki 2.1.54+ 导入验证（截图）」不可行，未做也未声明**：本环境无 Anki，且宿主 `CopyFromScreen` 全黑帧（§5 环境事实）。替代证据：测试已覆盖转换语义与**逐字节确定性**（同输入两次导出 basic/cloze 逐字节相同）；README.txt 含完整导入步骤。**「实机导入抽查 10 张 + 二次导入 0 新增」登记为遗留项**（需用户实机执行）。
  3. **报告行号漂移**（锚点制下无影响）：`listAllCards` 实际在 db.js:1970（报告写 1818）；`backupAPI` 局部类型在 SettingsPanel.tsx:2035、`sec-backup` 在 :2619（报告写约 2010 / 约 2430——D206/D212 批次使其下移）；均按锚点实测落位。
  4. **报告「本轮快照最大为 D204」已过时**：C-26…C-38 期间已登记至 D212，D213 按当前 GUIDE 实测最大+1 取号（交接包预判正确）。
  5. **D157「牌组」边界的落位**：「Deck」一词只出现在生成的 README.txt（Anki 概念，报告设计节明示允许）与 GUIDE D213 登记行；设置页渲染层 UI 字符串零「牌组」（rg 复核：SettingsPanel 中该词仅存在于既有注释与本次注释，无任何 T() 字符串）。
- **副产物**：tests/m15r.activity.bundle.cjs / m15r.layout.bundle.cjs 三次全量跑脏，git checkout -- 还原未入库；基准临时目录 `nut-bench-*` 由脚本自清。

### 3.46 C-40 · 移动端准备：业务核心与 Node/Electron 解耦（P2，D-05=A 解锁）

- **提交**：`f6d036d`（a 数据目录注入）→ `c2fcaa1`（b 纯净核心闸门）→ `6f3e520`（c 接口清单）→ `4be04c0`（d MOBILE-READINESS）；合并 `0bd52a0`（分支 fix/C-40，基线 main `016994f`）。11 文件 +2123/−27（其中 docs/ipc-contract.json 1712 行为生成产物）。
- **改动**：a——db.js 删模块加载期 electron 依赖（DATA_DIR/dataDir() 惰性 + initDb(opts) 第一行注入回落；文件内 10 处 app.getPath → dataDir()，rg 只剩 initDb 回退 1 处）+ settingsStore 惰性 file()/configure/兼容 getter + dictDb/learnerDb 同式 + main.js 唯一调用处显式传参（零行为变化）；b——CORE 27 模块 require 扫描闸门（禁 I/O/平台依赖清单、相对闭包不越界、第三方仅 opencc-js/ts-fsrs、crypto 恰等 NEEDS_CRYPTO_SHIM 四文件）；c——gen-ipc-contract.mjs 解析 preload 33 个桥块输出 docs/ipc-contract.json（285 条 = 253 invoke / 11 send / 21 on）+ 逐字节再生成闸门；d——MOBILE-READINESS.md 按 D-05=A Capacitor 定稿（纯核心 23/crypto 4/存储二选一待 U-15/文件/网络/安全存储/fsrs-rs/桌面专属不移植 + U-15 矩阵 5 项）。
- **验收（主控独立复验）**：core-/ipc-contract 三套件亲跑通过；rg 门通过（:394 为报告规定的 initDb 回退行本身）；tsc 0 错误；lint:consistency 0；build 成功；**全量 123 个 122 过 / 1 败 = applog（§1.1 既有）**（规模 120→123 = 73 electron-node / 39 electron / 11 system-node），失败集合与基线一致，无新增失败文件。
- **偏离说明**：
  1. CORE 实测补入报告未列的 lmStrings（lmRecommend 经 opencc-js 的实际落点，传递闭包要求）。
  2. 报告行号漂移（锚点制无影响）；「应用正常启动/导入/复习无变化」以全量既有套件 + 零行为 diff 审查替代实机走查。
  3. ipc-contract.json 285 条与 preload 方法严格 1:1（生成器与闸门共用同一解析实现，负路径实测有效）。
  4. **执行代理在完成 4 子提交后被用户中途取消**（用户发现子代理仍在用 GLM-5.3-Flash 运行——2026-10-25 用户已指示执行单元改用 GLM-5.3，.zcode/agents/audit-flash.md 已改但**会话内代理定义为启动时快照，中途改文件对后续派发不生效**，详见 §5「执行单元模型」段）；未执行的收尾（合并/进度账）由主控按用户「这一次任务完全完成之后停止」指示补齐。产物经主控独立对抗审查合格后合并。

### 3.47 C-41 · 生产依赖漏洞：npm audit（P2）

- **提交**：`3823500`（单提交，分支 `audit-c41`，基线 main `6b31ea0`；合并 `1cc207c`，账本提交 `6e96abc`）。3 文件 +54/−87：package.json、package-lock.json、docs/security/accepted-risks.md（新建）。
- **改动**：
  - **audit fix（无 --force）**：生产侧 dompurify 3.4.14→3.4.17（critical，5 个 GHSA）、markdown-it 14.3.1→14.3.3（high，3 个 GHSA）、source-map-js 1.2.1→1.2.2（high）——全部同主版本、`package.json` 的 dependencies/devDependencies **版本范围零变化**（fix 后 `git diff package.json` 为空）；dev 侧连带范围内小版本 bump 9 项（concurrently 9.2.5 / fast-uri 3.1.9 / follow-redirects 1.16.1 / http-cache-semantics 4.3.0 / joi 18.3.0 / node-gyp 内 undici 6.29.1 / shell-quote 1.12.0 / undici 8.12.3 / vite 6.4.5——`npm audit fix` 默认含 dev 的连带结果）。
  - **C-41b**：`package.json` 新增 `"overrides": { "katex": "$katex" }`（+3 行）；lock 删除嵌套 `katex@0.16.47` ×2（rehype-katex、micromark-extension-math 各一）与随之失去引用的 `commander@8.3.0` ×2。
  - **accepted-risks**：`docs/security/accepted-risks.md` 登记 sprintf-js（见偏离 2）。
- **验收（2026-10-25，Windows）**：
  - 基线：`npm test` → 123 个 122 过 / 1 败（applog §1.1 既有，会话内实测）。
  - audit 前：`npm audit --omit=dev` → **9 个 = 1 critical + 2 high + 6 low**（快照 `audit-before.txt` 未提交）；fix 后 `npm audit --omit=dev --audit-level=high` → **exit 0**；C-41b 后最终 `npm audit --omit=dev` → **found 0 vulnerabilities（exit 0）**。
  - katex 树：fix 前 `npm ls katex` = 根 0.18.5 + 嵌套 0.16.47 ×2；overrides 后（含 `npm ci` 复装）= **全树单份 0.18.5**（root / @milkdown/crepe / rehype-katex / micromark-extension-math 全 dedupe）。
  - 渲染等价（GUI 手检的机械替代，`tests/tmp-c41/` 不入库）：临时脚本 import 与 `src/components/editor/ReadMarkdown.tsx` 完全同一份管线与源码模块（remark-gfm/math/mark/softBreaks→rehype-raw→sanitize(extractSanitizeSchema)→rehype-katex），渲染行内 / `$$` 块级 / `\frac` / `\begin{aligned}` / 单行 `$$` / 混合卡片共 5 用例：overrides 前后**均 5/5 通过、无 katex-error**；指纹差异仅 3 处类名前缀化（`base→katex-base`、`strut→katex-strut`、`sizing→katex-sizing`），前缀归一化后**逐字符相同**——应用 CSS（`Reader.tsx:3` 与 `epub.ts:161` 均引根 katex 的 `dist/katex.min.css`）本就是 0.18.5 前缀类名（`rg` 实测无 `.base/.strut` 选择器），即 overrides **消除的是既有「0.16.47 JS 标记 + 0.18.5 CSS」错配**，非引入渲染差异 → 不触发报告「有差异就撤销」条款。
  - 相关套件：`m6-1`（epub.ts）与 `markdown-offset-map` 单跑均通过。
  - `npm ci`（postinstall ABI 钉定通过）→ `npm run typecheck` 0 错误 → `npm run build` 成功（两轮：audit fix 后 7.39s、overrides 后 7.53s）。
  - 最终全量：`npm test` → **123 个 122 过 / 1 败 / 0 超时**（唯一失败 = applog），失败集合与基线完全一致，无新增失败文件；artifact 闸门 `d111-artifact` / `lensWindowFit.artifact` 均通过（两个 bundle 经 rg 实测不含任何被升级的包，无需重生成）。
  - **主控复核（合并前，2026-10-25）**：全新 `npm ci`（提交的 lock）复现——全树单份 katex 0.18.5 / `npm audit --omit=dev` 0 漏洞 / typecheck 0 错误 / build 6.78s / 全量 123 个 122 过 1 败（applog 既有）独立复跑；指纹差异独立对账 = 32 处前缀 × 6 字符 = 192（长度差精确相等、归一化后逐字符相同）；sprintf-js 生产链（mammoth→argparse@1.0.10→sprintf-js@1.0.3）与 CSS 错配论证（`Reader.tsx:3`/`epub.ts:161` 引根 0.18.5 CSS、min.css 无 `.base/.strut` 选择器）均独立证实；账本 §1/§2/§3.47/§5 核对无误。审查通过。
- **偏离**：
  1. **今日 audit 面貌与报告快照不同**：报告 12 个（7 low/3 moderate/2 high），2026-10-25 实测 9 个（**1 critical** dompurify <=3.4.16（5 个 GHSA）+ 2 high（markdown-it <=14.3.2、source-map-js）+ 6 low 嵌套 katex）；dompurify 由报告时的 moderate 升为 critical 且 `npm audit fix` 可修（无需 --force）；处置路径与报告一致。
  2. **sprintf-js 链未消失**（主控交接预判「已不在生产链」不成立）：实测 `npm ls sprintf-js --omit=dev` = `mammoth@1.12.3 → argparse@1.0.10 → sprintf-js@1.0.3` 仍在生产树；变化的是 **今日 audit 的 advisory 清单已不含 sprintf-js**（9 个漏洞无它，编号无从取证；报告快照亦未给 GHSA 编号）。不可达论证按报告口径复核成立：`rg -n "argparse" node_modules/mammoth/lib` → 0 匹配，argparse 仅 `node_modules/mammoth/bin/mammoth`（CLI 入口）引用，本仓唯一用法 `electron/importers.js` 走库 API。accepted-risks.md 按真实现状登记（链在树中 + 今日不标记 + 复查触发条件）。
  3. **GUI 手检替代**：报告步骤 3「手动打开 EPUB / 含公式 Markdown」与步骤 5「用卡片与摘录检查渲染」不可实机执行——以 `m6-1` + `markdown-offset-map` 套件 + 上述渲染等价脚本（同一管线、前后指纹比对）机械替代。
  4. **C-41b 实施细节**：首带 overrides 的 `npm install` 曾把 `^` 范围重解析到最新（milkdown 7.22.2→7.22.3、katex 0.18.10；crepe 7.22.3 要求 katex ^0.19.1 与 overrides 冲突报 invalid）——处置：恢复 lock 重装（保持既有解析）、`npm install katex@0.18.5` 把根 katex 钉回 0.18.5（范围 `^0.18.5` 不变），再重跑 `npm audit fix` 补回三升级，最终全树单份 katex 0.18.5、milkdown 保持 7.22.2。
  5. **C-41c（依赖搬移瘦身）延后不做**：报告前置条件「C-30 打包冒烟测试可用」未满足（`.github/workflows/build.yml` 只出包无安装包冒烟）。**只读核实清单**（`rg` 扫 `electron/` 全目录实测，供搬移时直接用；报告快照清单漏 yazl/yauzl）：better-sqlite3（db.js / dictDb.js / learnerDb.js / backup.js / backup-build-worker.js）、sql.js（dictStore.js）、jszip（importers.js / main.js）、**yazl（backup-build-worker.js，C-12）**、**yauzl（zipRead.js，C-12）**、turndown（importers.js）、opencc-js（i18n.js / lmStrings.js，静态+动态各一）、markdown-it（ankiExport.js，C-39）、mammoth（importers.js）、fsrs-rs-nodejs（optimizer.js）、electron-updater（updater.js）、pdfjs-dist（main.js / importers.js 动态 import）——共 12 包；未动任何包的 dependencies/devDependencies 归类，未改 electron-builder.yml。
- **副产物**：`audit-before.txt`、`tests/.results/*.log`、`tests/tmp-c41/`（不入库）；全量跑脏的 `tests/m15r.activity/m15r.layout/m6-1.epub/m6-3.htmlimport.bundle.cjs`（差异=内联 dompurify 升级所致，测试每次现场重打包）已 `git checkout --` 还原未入库。

## 5. 给下一次会话的最短入口




- 报告：`C:\Users\xiongdy\Desktop\report_confirmed.md`；只读 §0、§3 和目标 C-xx 小节。
- 进度：本文件 + `git log --grep 'C-xx'`。
- 当前下一项：**C-42**（AGENTS.md 等开发指引过时——242K 字符数过时 / 「CommonJS + sql.js」过时（实为 better-sqlite3，D137）/ persist() 描述过时（C-17）/ @runtime 分流描述与 C-01 实况不符；报告 :3412 起）。测试基线 123 个 122 过/1 败（applog）。**C-41 已完成合并 `1cc207c`**（2026-10-25 主控对抗审查通过：验收与偏离见 §3.47；合并后依赖事实：dompurify 3.4.17 / markdown-it 14.3.3 / source-map-js 1.2.2 / katex 全树单份 0.18.5（overrides `$katex`）/ `npm audit --omit=dev` = 0 漏洞 / accepted-risks 登记 `docs/security/accepted-risks.md`；**注意**：未来 milkdown 若升到要求 katex ^0.19 的版本，overrides 会冲突报 invalid（C-41b 实证），届时需同步放宽根 katex 范围）。
- **环境事实（2026-10-24）**：**ImageMagick 7.1.2-34 Q16-HDRI x64 已装于 `C:\Program Files\ImageMagick-7.1.2-Q16-HDRI\`**（主控 winget 安装，为 C-28 解封）——Git Bash 里 `magick` 不在默认 PATH，需 `export PATH="/c/Program Files/ImageMagick-7.1.2-Q16-HDRI:$PATH"` 或用全路径调用；后续图标/打包类 C 项（C-30 等）可直接用。另：本会话宿主 PowerShell `CopyFromScreen` 全屏捕获返回全黑帧（会话非交互/锁屏）——需要屏幕截图取证的验收不可走此路，改用像素级/字节级等价证据。
- **运行时事实**：Electron 45.0.0 / better-sqlite3 13.0.3（C-24 起）；116 个测试基线 115 过 / 1 败（applog §1.1；`lensWindow` 与 `m15v2.route` 为负载 flake 见 §1.1；C-34 期间另证 `persist.test.cjs` P2 在宿主高负载下偶发、单跑 14/14 过）。**C-34 后**：markdown 读态渲染全应用唯一管线 = `src/components/editor/ReadMarkdown.tsx`（`rg "<ReactMarkdown" src` 应只剩它一处；GFM+软换行+remarkMark==高亮==+rehype-raw+extractSanitizeSchema 净化+katex）——卡面/粘贴书/AI 回答/判答理由全部走它，新增 markdown 读态面**不得**再裸写 `<ReactMarkdown>`；卡面编辑唯一形态 = `EditableField`（读态渲染+点击/Enter/F2 进入编辑，`renderEditor` 注入编辑器）+ `editor/CardFields.tsx` 的 `MdField`（问答）/`ClozeField`（填空源文本，textarea 白名单在册）/`ClozeDraftEditor`（填空草稿层）；v11.2 `EditableText` 纯文本裸壳已删（src/components/EditableText.tsx 不复存在），`theme.css` 的 `.review-editable` 规则成死样式（下次清 CSS 时删）；填空题面复习期直接编辑 `{{cN::…}}` 源文本（`commitQuestion` 的 `[…]` 还原已删），挖空增删用 ClozeField 工具行；批注编辑 Esc = 保存并收起（AnnotationPanel 与 AnnotationEditor 两侧同语义）；编辑行为契约与 textarea 白名单的唯一登记处 = `docs/EDIT-CONTRACT.md`（C-35 闸门的机器检查面）；**注意净化剥 src**：extractSanitizeSchema 默认 `protocols.src=http/https`，markdown 里的 `![](bookasset://…)`/data: 图在**读态**不渲染 src（D95 起摘录读态既有属性，C-34 起扩展到闪卡面；CSP img-src 放行但净化先剥——要放行需改 D95 的 sanitize schema，未动，待主控裁定）。**2026-10-24 对抗审查更正**：C-34 前旧管线同样剥——react-markdown 渲染期 `defaultUrlTransform` 先于净化生效，非 http(s) img src 新旧管线同不渲染（非收窄、非回归，证据与裁定详见 §3.40 偏离 4 更正段）；i18n 新键「内容为空，未保存」已登记 en/ja。**C-31 后**：窗口外观同步唯一读取面 = `src/skins/runtime/readAppearance.ts`（主窗口 App.tsx 初始化与独立窗口共用；`applyAppearanceToDocument` 统一落 theme/motion body 类 + `--user-accent` 三件套；`isAppearanceSettingsChange` = WindowSkin 刷新过滤规则）+ `src/skins/WindowSkin.tsx`（lens/workbench/capture 三入口挂载；onFail 只本地回落默认皮肤不写回设置）；`applyCaptureAppearance`（CaptureEditor.tsx 导出）保留为「呼出重读」入口，末尾 `requestWindowSkinRefresh()` 反压 WindowSkin；主进程唯一广播点 = `electron/main.js` settings:set 写入成功后的 `settings:changed {scope,key}`（发给除发起写入外所有窗口；单向推送不计入 IPC 注册清单——D123/D180/D197 口径，事件名见 main.js 头注；F21 已对账）；**preload 订阅面 = `settingsAPI.onChanged` 两处都要加**（preload.js 主桥 + preload-capture.js 最小桥——capture 用独立 preload）；D170「SkinHost App 内唯一挂载点」表述自此取代（主窗口直挂 + 独立窗口经 WindowSkin，SkinHost 仍是唯一实现）；lens 面板需 documentId 才渲染（MindmapLens `supported` 闸）——空库探针验外观须先从主窗口模拟 Reader 的 context 推送；自定义属性计算值是原 token 流（hex 不转 rgb），等值比较用字符串。**C-33 后**：结构图窗口层过渡唯一机制 = `lens:fit` animate 一次 `setBounds` 落位 + 响应 `prevBounds` 一次性补偿（D211/v49.40；D204 的 180ms 逐帧缓动已删——`animateBounds`/`easeAt` 保留不再被调用，下一版本删）；展开 = 落窗后 resize 落点瞬时补偿 + CSS 过渡回 0 + 纸片 clip-path 从旧尺寸过渡（B2）；收起 = 先窗内预动画（估计目标 = computeFit + window.screen workArea 估计 + 锚点 client 坐标）→ transitionend(+50ms) → fit → resize 同步清除（B3）；`startHostFix`/`growRaf` 已删，`MindmapLens.tsx` 的 `window.screenX|screenY` 只剩 captureNodeScreen 计算点击位置一处（**量测基准 = g 的首个 rect 子元素卡片矩形**，g bbox 含折叠徽标会横移 ~8px——改锚点采集/主进程锚点公式时两边必须同基准）；窗口层过渡时长/曲线一律 `var(--mm-move)/var(--mm-ease)`，motion-off 跳过预动画、reduced 减半（与画布 planTransition 同规）；`perfPinDeviation` 把被点节点偏差写 `__mmPerf.pinDeviationPx`（稳态 1.41px = 取整下限；贴边钳制时真实漂移，computeFit clamped 语义）；**展开/收起方向真值 = overrides（true=收起）**——`toggleCollapse` 的 next=「将变为收起」，写展开/收起判定时勿再把极性写反（C-32 的 perfBegin 标签反相即此因，已修）；jsdom 下 CSS 过渡终值瞬时生效，中间态不可观测——dom 测试用宿主 `data-mm2-win-comp` 观测点断言补偿已应用；隔离探针 `tests/tmp-c32/probe.cjs`（结果 results-*.json）与逐帧截图 `capture.cjs`（frames-*/）在 `tests/tmp-*` 下不入库，CDP 截图往返 ~100-200ms/帧不能当帧级录屏用。**C-32 后**：结构图谱过渡的性能测量唯一开关 = `localStorage.mmPerf === "1"`（perf.ts，结果挂 `window.__mmPerf`、主进程 `[lens] setBounds x N` 日志——C-33 的基线；实测窗口缓动每次 x7-8 次 setBounds）；动效时长唯一真源 = theme.css `:root` 的 `--mm-move/--mm-enter/--mm-exit/--mm-ease`（JS 侧 `animate.readMotion()` 每次 planTransition 读取、ms/s 双单位——CSS 产物压缩把 ms 归一成 s，勿删换算；皮肤可覆盖、换肤后下一场过渡生效）；应用动效三态唯一解析面 = `animate.motionPreference()`（body motion-off → 瞬时、motion-reduced → 时长减半仅透明度、否则系统 prefers-reduced-motion 命中＝瞬时）——MindmapCanvasV2 不再有自己的 prefersReducedMotion；聚焦档选择唯一实现 = `lensWindowFit.chooseFocusBinary`（线性 chooseFocus 保留为等价基准/回退；requestFit 内所有 measureGraph 共用一个 layoutGraph 缓存，等价闸门 = tests/m15v2.lensfit-cache + lensWindowFit.binary，改 layout.ts 的 deps 或 lensWindowFit 后必须重跑）；画布过渡期传空路由（关系线整段淡出、结构线照画、终帧全绘——改 paint() 路由策略时注意 EMPTY_ROUTE 占位）；`lensWindowFit.bundle.cjs` 是跟踪产物，改 lensWindowFit.ts 后须按 tests/lensWindowFit.artifact.test.cjs 的 banner 重打包。**C-30 后**：打包唯一真源 = `electron-builder.yml`（三平台双架构矩阵、npmRebuild:**false**——better-sqlite3 v13 prebuilds/ 内置全平台，rebuild 反而会触发交叉源码编译失败；`dist:win`/`dist:mac`/`dist:linux`，CLI 一律 --publish never）；updater 渠道唯一实现面 = `electron/updater.js` 的 `source()`（dev / store / **unsupported＝linux 非 AppImage** / unconfigured / github，GUIDE §4.2-17 + D209 v49.38 登记；单测 `tests/updater-source.test.cjs` 用 require.cache electron 桩 + platform/resourcesPath defineProperty mock——Electron 运行时下 `process.resourcesPath` 只读）；CI = `.github/workflows/build.yml`（push tag `v*` + workflow_dispatch；**GitHub 只从默认分支注册 workflow——远端 main 无 .github/ 时 dispatch 404，本仓用 tag 触发**；机密仅非空注入 GITHUB_ENV——空字符串 CSC_LINK 在 mac 被当证书路径解析直接崩；跨架构出包必须显式补装目标架构的 napi-rs 可选分包且 @napi-rs/canvas 分包带 os/cpu 限制必须 --force；测试步骤 continue-on-error + latest.json 上传）；NSIS 静默安装参数 `/S` 经 Git Bash 直传会被 MSYS 路径改写吃掉（须 cmd /c 传参）；CI 运行链接与产物：run 40084725879（tag v0.0.1-rc1）三平台全绿。**F24 夹具提示（主控观察项）**：`tests/flows/fixtures/f24-coverage-baseline.json` 会被 F24 每次运行按现状自动收紧（flowCount/节计数自 D93 后陈旧），跑 F24 后该文件会变脏——不属当次改动，还原勿提交，待单列刷新。**C-28 后**：closeToTray 取值归一唯一实现面 = `electron/closeToTray.js` 的 `closeToTrayEnabled(raw)`（显式 true/false 尊重、未设置按平台默认——win/mac 开、**linux 关**，D-09=A）——main.js 写侧归一与 win `close` 处理共用，渲染层 `SettingsPanel.tsx` TrayRow 用 navigator 探测算同值默认（两处注释互指，改默认必须同步）；`electron/tray.js` 导出 `loadTrayIcon`（平台三分支：win32 明暗 ico / darwin `trayTemplate.png`+`setTemplateImage` / linux 明暗 PNG，回落 icon.png 统一 16px）；`setTemplateImage`/`isTemplateImage` 是 macOS 专属 API（win32 上 no-op）；lens/workbench 子窗口 `icon` 已平台三元（win32 icon.ico，其余 icons/icon-light.png）。**教训（C-28 修正复审）**：改设置键默认值/归一口径＝契约变更，必须同步 GUIDE §7.4 登记行 + §8.1 D 号 + 标题版本 bump（f11 L3/L4 机械强制，引而不登即红）；F18 coverage 失败先到 main 复跑定归属（其消费者扫描器会把 JSX `key="…"` 反查成假设置键——`app.back` 既有误报，D-DOC-07 同族）。**C-29 后**：开机自启唯一实现面 = `electron/quickCapture.js` 的 `isAutoLaunchOn` / `applyAutoLaunch`（**两者均已导出**，测试可直调）——linux 分支按 XDG autostart 读写 `$XDG_CONFIG_HOME/autostart/nutation.desktop`（未设置回落 `~/.config`；`Exec=` 取 `process.env.APPIMAGE || process.execPath`，dev 态追加应用目录参数；**文件存在即视为开启**），win/mac 仍走 `app.setLoginItemSettings`/`getLoginItemSettings` 原语义；单测注入 electron 桩参照 `tests/app-menu.test.cjs`（`require.cache[require.resolve("electron")]`）、platform mock 参照 `tests/close-to-tray.test.cjs`（`withPlatform` + 还原断言）；`app.globalShortcuts.autoLaunch` 键语义未变（GUIDE §7.4 :1324 以 `app.globalShortcuts` 整键登记，非契约变更、无 D 号）。**C-27 后**：IME 组字判断全仓唯一写法 = `src/lib/ime.ts` 的 `isImeComposing`——首行守卫 31 处（14 组件文件 28 处 + commands.ts install() 1 处 + 修正复审补 AIPanel 内联编辑 / SelectionPanels trio onKey 2 处）+ 行内条件收敛 4 处（AIPanel composer 的 `!e.shiftKey && !isImeComposing(e)`——shiftKey 组合判别属条件表达式非守卫、ManualCardEditor 2、SelectionPanels 1）——新增 Enter/Escape 处理器必须同款（C-35 将收编为常驻闸门，本次无闸门测试）；**`tests/flows/run.cjs` 无 `--list` 旗标**——传了会按默认参数启动 cycles=∞ 全流程 soak（本项实证），列流程清单用 `node scripts/run-tests.mjs --list` 或直接读 `tests/flows/f*.cjs` 头部 `@id`；GUI 流程（`@gui: true`，如 F60）不能经 run.cjs 直跑（allow-gui=false 排除，「0 条流程」），参照 `tests/d106.gui.mjs` 的自驱 CDP 模式。**C-35 后**：一致性常驻闸门 = `npm run lint:consistency`（`scripts/consistency-check.mjs`，纯 Node 亚秒级 ~0.27s；CI 在 build.yml 的 npm ci/跨架构依赖之后、测试之前**阻断**）——8 规则与基线协议：规则 1 未定义 Token（同 F09 E1：TS setProperty 注入豁免 + CSS 注释剥离，注释里的示例代码不算引用）；规则 2 颜色字面量按「文件→次数」棘轮，COLOR_ALLOW 三条（`src/skins/**/manifest.ts`、`accentVar.ts`、`foliate/appearance.ts`）写在脚本顶部，`_lab/index.tsx` 的 rgb( 3 处也在基线（未扩豁免）；规则 3 !important/内联 svg 棘轮（14/35）；规则 4 动效时长硬 0（`duration: number` 类型声明不算）；规则 5 编辑器白名单——**机器读的是脚本内白名单数组，改白名单必须三处同步（脚本 + docs/EDIT-CONTRACT.md + 报告口径）**；规则 6 Enter⇒isImeComposing（dialogA11y.ts 无 Enter 分支天然不涉及，勿据弹窗层路径报组件级违规）；规则 7 :hover opacity:1 须 `.reveal-on-hover`，当前棘轮 7 处（报告 4 是行级口径漏了 3 条多行选择器）留待 C-36 收编后收紧；规则 8 子进程 skin-audit+i18n-check。基线 `scripts/consistency-baseline.json` **只许变小**：当前值更小 → 脚本提示 `--update-baseline` 收紧；更大 → 失败；带新违规跑 `--update-baseline` 会被防放宽守卫拒绝（无放宽参数）。**F09 每次运行会按 Math.min 自动收紧自己的 fixture**（`tests/flows/fixtures/f09-presentation-baseline.json`）——跑 F09 后该文件可能变脏：数值变小属预期收紧可提交（提交说明列新旧数值），其余情况还原勿提交；F09 E1/E2 口径已与闸门一致（E1 = setProperty 豁免 + 注释剥离；E2 = COLOR_ALLOW 豁免后 hex 文件数）。E1 修复后事实：theme.css 无 `--hairline/--mono/--sans/--bg-1` 引用（`--bw-hairline` 是另一个在册 Token 勿混淆）；`.cb-deck-pop` 背景 = `var(--bg-elevated, var(--surface-overlay))`（**--bg-* Token 家族全历史从未存在**，主控 2026-10-25 裁定回落 `--surface-overlay`——弹层语义 body 级 Token，claude 双档覆盖、swiss 派生 --paper）；学习者页 11 条 `.learner-*` 分隔线与 .cb-deck-pop 背景 4 组合（swiss/claude × 深/浅）var() 链全解析为具体颜色（确定性级联解析实证 2026-10-25，--border-subtle 四值：#e0e0e0/#2a2a27/rgba(20,20,20,.10)/rgba(255,255,255,.09)）。**C-36 后**：悬停显形唯一合法写法 = `src/theme.css`「悬停显形工具类」节的 `.reveal-on-hover`（TSX 挂类：鼠标悬停/键盘聚焦显形、`(hover:none)/(pointer:coarse)` 常显＝触控替代、motion-full 过渡；控件距行元素超两层时行上加 `.reveal-scope` 走变体）——手写 `opacity: 0` + `:hover{opacity: 1}` 会被规则 7 闸门挡下（基线 `hoverOpacityCount` **硬 0**）；存量豁免 3 条在 `scripts/consistency-check.mjs` 顶部 `REVEAL_ALLOW`（`.annot-acts` 报告判定无问题 / `.reader-tap-hint` 非操作装饰提示 / `.chart-dot` 已有 `(hover:hover)` 结构性触控替代），**扩豁免须先在 docs/UI-CONVENTIONS.md 登记**；`.zdots`/`.icon-btn` 的 44px 粗指针命中区也在工具类节统一提供；UI 交互约定登记处 = `docs/UI-CONVENTIONS.md`（EDIT-CONTRACT 旁，C-36 新建，规则 5 不读它）；4 控件（ai-kp-pencil/reader-theme-manage-actions[-show 强制显示类兼容]/journal-entry-actions/wb-pick）已收编，`.annot-acts` 按报告判定不动（确认态 `.zitem.confirming .annot-acts` 恒显兜底，且实际只在确认态挂载）；**CDP 触屏模拟坑**：Electron 45 的 `Emulation.setEmulatedMedia({features:[…]})` 返回成功但媒体查询 **no-op**——用 `setDeviceMetricsOverride({mobile:true}) + setTouchEmulationEnabled` 代替（DevTools 设备工具栏同机制，matchMedia `(hover:none)`/`(pointer:coarse)` 真翻转），参照探针 `tests/tmp-c36/probe-c36.mjs`（tmp 不入库）。**C-37 后**：主题模式唯一解析面 = `src/skins/runtime/readAppearance.ts` 的 `resolveThemeMode(mode)`（报告 C-37 :2880-2885 逐字：显式 light/dark 原样、"system" 与未知值 → `matchMedia("(prefers-color-scheme: dark)")`；`Appearance` 双出 `mode`=解析值 + `modeSetting`=原始档归一，未知值归一 system——按钮高亮与落窗档不脱节）；**四窗口监听挂载点** = 主窗口 `App.tsx` effect（keyed on `themeMode` state："system" 挂 `prefers-color-scheme: dark` mq change → 重解析 + `eventBus.emit("theme/changed", resolved)`，切回显式档随 effect 重跑移除）+ 独立三窗 `WindowSkin.tsx` 第二 effect（keyed on `ap?.modeSetting`，经 `refreshRef` 调挂载 effect 内的 refresh 走 epoch 守卫；capture 窗口同链路、D159 静态覆盖）；`theme/changed` 恒发解析后的 "light"|"dark"（App.tsx / Reader.tsx / dashboard/Dashboard.tsx 监听者零修改，新增发射点必须同口径）；主进程窗口底色唯一实现点 = `themeBackground()` 两处（workbenchWindow.js / quickCapture.js，**均已导出**供桩测试：`mode==="dark" || (mode==="system" && nativeTheme.shouldUseDarkColors)`，未知值回落浅色；electron require.cache 桩 + 受控 `nativeTheme.shouldUseDarkColors` 见 `tests/window-skin.test.cjs` 第 6 节）；设置页主题三档高亮真源 = App `themeMode` state（原始档）≠ `theme` state（解析档，与 SkinHost `ColorMode` 同型）——改主题流必须双 state 同落（`handleThemeChange` 与 mq effect 两处）；SettingsPanel 三档按钮高亮按 `themeMode` prop、强调色默认值索引按解析档 `theme` prop；**CDP 验证 system 档的可行机制** = 页内 matchMedia 桩（prefers-color-scheme 单例 MQL + 真 addEventListener 语义 + dispatch change；setEmulatedMedia 对该特征同样 no-op），探针 `tests/tmp-c37/probe-c37.mjs`（tmp 不入库）21/21——**主窗口断言必须走真实 UI 点击**（settingsAPI.set 只广播给其它窗口、不回灌发起窗口自身 state）。
- **C-38 后（2026-10-25 合并 8227488）**：同步预留唯一真源 = `electron/syncTables.js`（SYNC 23 / APPEND 5 / LOCAL 12，新增表必须登记否则 `tests/sync-tables.test.cjs` 红；物理删除 SYNC/APPEND 表必须入 PHYSICAL_DELETE_ALLOWLIST——现状 5 条：review_logs 撤销 / material_map×3 D192 / assets C-22 补偿）；schema `user_version = 4`（sync_prep：card_issues/ai_gen_batches/material_map_edges 补 sync_version+is_deleted、建 sync_tombstones）；**同步触发器每次启动先删后建幂等重建 = C-10 结构变更规则的唯一登记例外**（GUIDE v49.41/D212，`electron/syncTriggers.js`，initDb 在 runMigrations 后调用——新增列自动纳入真变化判断；触发器只 +sync_version 绝不改 updated_at；写测试直连 db 时 UPDATE 会自动 +1，比较行内容要排除 sync_version 或预期 +1，撤销也是一次变更）；设备 ID = `electron/deviceId.js`（device.json，host 不一致重生成，**不进备份清单**）；备份 meta 增 deviceId/schemaVersion（缺省 null 向后兼容），恢复确认框「此备份来自另一台设备」经 `backup:meta` 只读通道（backupAPI.meta）；设置分层唯一真源 = `electron/settingsLayers.js`（DEVICE_KEYS 7 键 + DEVICE_FILES + layerOf；C-13 恢复保护范围 2→7 键；新增本机专属设置必须登记，否则 `tests/settings-layers.test.cjs` 红）；墓碑键 = 各表主键 id（material_map_nodes/edges 的主键是 UUID id 非 node_id/自然键，同步对账勿用错）；基准：触发器写入开销 播种 1.10×/更新 2000 次 1.75×（≤2× 达标）、computeTodayQueue +0.5%（±10% 内）。
- **C-39 后（2026-10-25 合并 58e923c）**：导出到 Anki Phase 1 唯一实现面 = `electron/ankiExport.js`（纯函数 + writeExport；**不 require electron**，convertCloze 的 CLOZE_SRC 与 `src/lib/cards.ts` parseCloze 正则**逐字镜像——改任一侧必须同步另一侧**；GUIDE v49.42/D213 登记）；IPC = `anki:export`（dialog 选目录 → writeExport(listAllCards())）+ `anki:openDir`（只开主进程记忆的最近导出目录，不接受任意路径——偏离 1）；preload backupAPI.exportAnki/openAnkiDir；设置页入口在 sec-backup 分区末尾（按钮+统计+打开文件夹；文案零「牌组」D157）；**markdown-it 必须留在 dependencies**（现状已满足，package.json:50——C-41b 瘦身不得移走，主进程 ankiExport 依赖它）；基准 `BENCH_N=100000 BENCH_ANKI=1` 十万卡导出 1551ms < 3s（不移 worker；bench-queue.cjs 的 BENCH_ANKI 钩子 C-38 前已预置）；**遗留项（需用户实机）**：Anki 2.1.54+ 导入抽查（挖空/公式/图片 10 张 + 二次导入 0 新增）——本环境无 Anki 未做未声明，README.txt 已含完整步骤；Phase 2（U-13）：.apkg 复习历史导出 + 图片遮挡卡。
- **派发纪律（C-24 事故教训）**：Agent 派发返回错误不代表未启动——服务端可能仍已在执行。派发失败重试前，先 `git log --all --oneline -5` + `git status` + 查分支/文件 mtime/node 进程确认无人接管现场，防双写。
- 基线：120 个测试（70 electron-node / 39 electron / 11 system-node）；C-33 后全量 115 过 / 1 败（Windows，2026-10-24；仅 applog 既有未归属项，见 §1.1）；C-34 后全量 115 过 / 1 败（失败集合与基线一致，测试规模与分布不变）；C-35 后全量 115 过 / 1 败（仍仅 applog，2026-10-25；本项零新增测试）；C-36 后全量 115 过 / 1 败（仍仅 applog，2026-10-25；本项零新增测试，改动前基线实测同值）；C-37 后全量 115 过 / 1 败（仍仅 applog，2026-10-25；本项扩既有 `window-skin` 套件零新增测试文件，改动前基线实测同值）；C-39 后全量 120 个 119 过 / 1 败（仍仅 applog，2026-10-25；新增 `anki-export` 31 断言，改动前基线实测 119 个 118 过 / 1 败同值）。`tests/assets-integrity.test.cjs` 4a 竞态已由主控修复（`c332f58` / 合并 `a1be98e`，2026-10-24），全量应稳定 1 败。C-12 的 `backup-zip64` 默认跳过，`NUT_BIG_TESTS=1` 才跑（需临时盘 ≥6GB）。C-17 已改 `persist()` 语义：busy 只记日志（前缀 `[db] checkpoint 失败`），严格语义在 `persistNow` / `checkpointStrict`（备份 flush）。C-18 后 schema `user_version = 3`（idx_cards_due），新库自动到位；`computeTodayQueue` 增加 `damagedOmitted` 键。C-19 后 AI 网关走 `electron/aiTransport.js`（net.fetch 优先，fetch 层错误先经 `unwrapSysCode`/`CHROMIUM_NET_CODES` 还原系统码再归类）；写 `tests/ai-stream.test.cjs` 同款 electron 测试时注意：必须 `app.commandLine.appendSwitch("disable-http-cache")`，否则 net.fetch 的磁盘缓存会锁住 userData、rmSync 卡死进程退出。C-20 后 safeStorage 只经 `electron/keyVault.js` 访问（strength/encrypt/decrypt；`ai.js` 的 `getAIConfig` 带 `keyStorage`/`encryptionStrength`；明文 Key 只进内存 sessionKeys）；写需要 stub 加密环境的测试用 `require.cache[require.resolve("../electron/keyVault.js")] = { exports: stub }` 注入（参照 `tests/ai-keyvault.test.cjs`）。**C-21 后**：`addReadingEvent` 只收非负有限数、`setLibraryItemLang` 形状正则后还有 `Intl.getCanonicalLocales` 标准校验（空串除外，存值小写化）、`saveSkip`/`resolveCardIssue` 查父行（rowExists 默认连软删过滤）且后者按 `changes>0` 返回。**C-22 后**：`createExtract` 在 parentType=extract 时查父摘录（软删/幽灵父均返回 false）；`buildKpExtractionInput` 书名查询过滤 `li.is_deleted`；`createAssetForItem` 内容寻址去重（同书同 hash 复用既有文件，软删行不复用）+ `.part` 原子写 + 失败双向清理（删行再删 .part）；`sweepOrphanAssetFiles({dryRun,minAgeMs,partOnly})` 孤儿扫描（main.js 启动 5 分钟后只清 `.part`，其余孤儿 `[assets]` 日志登记，回收属 D-06）；**写 electron 运行时直调 db 的测试注意 `initDb()` 是 async、必须 await**（`tests/assets-integrity.test.cjs` 首版漏 await 踩过，症状是「no such table」）；同模块内部函数无法用 require.cache 换桩，注入「写文件后插库失败」用第二 better-sqlite3 连接建 `BEFORE INSERT … RAISE(ABORT)` 触发器。**C-23 后**：启动路径（db.js `initDb` / learnerDb.js `open`）不再执行 `quick_check`（勿加回）；`createBackup` 返回体新增 `integrity`（仅注入 `snapshotLibrary` 时含 `"library.db"`）；`autoBackupIfNeeded` 在 `integrity["library.db"] !== "ok"` 时跳过轮换并带 `integrityWarning`（main.js 经 `backup:integrityWarning` 事件 + D206 通知框提示）。**C-43 后**：`scanCards(cols, handleRow, chunk=2000)` 签名已改（列清单入参，不再收整条 SQL），分块主键取行、任何时刻不跨 await 持有游标；`BROWSER_JOIN` 首行带 `INDEXED BY sqlite_autoindex_cards_1`（防规划器选 idx_cards_due 全扫，勿删，删则 10 万卡扫描慢 ~15×）；`electron/*.js` 全域禁用 `.iterate(`（静态守卫在 `tests/scan-write-concurrency.test.cjs` S4，将来确需游标必须在同步循环内用完并加 `// sync-iterate-ok` 行内注释）。**C-44 后**：`validateAndAuditCss`（electron/pluginCore.js）规则 3 禁忌构造多一条——`image-set()` / `-webkit-image-set()` / `src()`（任意大小写）一律拒载（正则 `urlFnRe` 带 `(?<![\w-])` 负向后行断言，`--src-*` 自定义属性名不误伤）；插件禁用清单文档在 `docs/design/PLUGIN-SYSTEM-D132.md` §6.2 规则 3 + §9.2 S3/S6。**C-46 后**：记忆文件（memory/ 全部 6 处写入）一律经 `writeTextAtomic`（`electron/jsonFile.js`，jsonFile 现导出 `{ readJsonObject, writeJsonAtomic, writeTextAtomic, preserveCorrupt }`）原子写——`memoryStore.js` 已无 `fs.writeFileSync(`（静态守卫在 `tests/memory-atomic.test.cjs` ④）；`ensureTree` 启动时递归清理 `*.tmp-<pid>-<时间戳>` 崩溃残留；直跑 electron-node 测试记得带 `ELECTRON_RUN_AS_NODE=1`，否则完整 Electron 成功后不退出会挂住。**C-47 后**：三个导入函数（`createFromPaste` / `createFromEpub` / `createImportedDoc`，electron/db.js）全部写入已包进 `withTransaction`（函数内不要再加 `persist()`，事务在 COMMIT 后自动调用）；EPUB/通用导入失败且 `rowExists("library_items", itemId, false)` 为假时会删除本次新建的 `assets/<itemId>/` 目录——写测试注入「第二条 INSERT 失败」用第二连接 `BEFORE INSERT ON documents RAISE(ABORT, ...)` 触发器（参照 `tests/import-atomic.test.cjs`）。**C-48 后**：v23 迁移（db.js :539 起）设指针 = `s0.app.fsrsConfigId = id` 后与删旧字段同一 `writeSettings`（**勿改回 `setActiveFsrsConfig(id)`**——它读-改-写一次 settings 后又被旧快照覆盖；优化器 applyWeights/resetWeights 仍正常用它）；F43 流程本体仍在 A3 段被既有夹具崩溃挡住（sql.js 覆盖 vs better-sqlite3，C-10 偏离 6；C2 段复跑需先修该夹具，建议主控单列）。**C-25 后**：应用菜单统一经 `electron/appMenu.js`（whenReady 内 `applyAppMenu()`：mac = appMenu/editMenu/windowMenu 三 role，非 mac = null）——main.js 等处不要再直接 `Menu.setApplicationMenu`。**F38 流程现状（2026-10-24 实测，FLOW_SEED=7/42）**：F38-8g 已按 C-10 指针语义（app_meta 优先）修复，S6/S7 可跑；剩余失败全部既有 = F38-1（f38 影子模型仍是 C-16 前的「回落撤销」语义，与撤销不回退新语义分歧，建议单列对齐）、F38-1b（种子覆盖自检）、T3（仪表盘已删卡计数，D-TEST-23 族）、createCard 幽灵 KP/文档引用 ×2（C-22 相邻域）、resolveCardIssue 重复收口幂等、saveReview 评级/fsrs 形状 ×4；写 f38 探针注意：探针 run 内 `changed` 判定剥 `resolved_at/updated_at` 等列，落值断言要按小写化 lang 比对。**F59 流程**：D2/D4 已随 C-22 转绿（3/4），剩余 D1（createFromPaste 同名书双份不可区分）是独立既有缺陷、不属 C-22/C-47 字面范围。**worktree 验证纪律（C-23 事故教训）**：在主仓外建 worktree 验证时，绝不要把主仓 `node_modules` 以 junction/symlink 挂进 worktree——`git worktree remove --force` 会穿越 junction 递归删除目标内容（C-23 实测清空主仓 node_modules，靠 `npm ci` 恢复）；需要依赖就在 worktree 里独立 `npm ci`。**C-26 后**：阅读场景默认键位 = **Alt 系（Alt+Z 制卡 / Alt+C AI 制卡 / Alt+E AI 解释 / Alt+X 摘录 / Alt+D 查词，D207）**，Ctrl+Z 仍是摘录复习的「跨类撤销」硬编码键（readingWorkflow，未动）；`commands.ts` 现有 `IS_MAC`（导出）/ `keyFromCode` / `resolveMod`（导出，只接在 `getBinding` 唯一出口）/ `displayCombo`（导出，设置页 mac 显示 ⌘/⌥）四个跨平台件，`ComboInput` 带 `code?`——**改 commands.ts 后必须重打包跟踪产物 `tests/m4.commands.bundle.cjs`**（`node_modules/.bin/esbuild src/lib/commands.ts --bundle --platform=node --format=cjs --outfile=tests/m4.commands.bundle.cjs`），否则 m4.test.cjs 按旧 bundle 假绿（C-26 实证：陈旧产物曾把 LOCKED 13 条的过期期望掩盖成通过）；quickCapture 全局快捷键默认值平台分支 darwin→`Cmd+Shift+Space` / 其余→`Ctrl+Alt+Space`，设置页 `DEFAULT_GLOBAL_SHORTCUTS` 用 `IS_MAC` 保持同源；写键位单测参照 `tests/commands-combo.test.cjs`——esbuild 现打包 + require 前 `defineProperty(globalThis,"navigator")` 注入 IS_MAC 双实例。
- **Token 账与执行协议（2026-10-24 用户指令更新）**：**Token 计账终止**——用户指示不再计算 Token 消耗（停更前最后已知状态：累计约 49M / 2 亿，其中 12M 实测，本行留档停更）。**新协议**：主控（编排会话）固定 GLM 5.3；执行单元（新会话）改用代理定义 `.zcode/agents/audit-flash.md` 所载模型（2026-10-24 起为 **GLM 5.3 最高思考强度**——用户指令「之后派子代理请使用 glm5.3 模型」，此前为 GLM 5.3 Flash）。**机制教训（2026-10-25 实证）**：代理定义（.zcode/agents/*.md 的 model 字段）在**会话启动时快照加载**，会话中途改文件对本会话后续 Agent 派发**不生效**（C-40 派发仍用 Flash 运行 13 分钟被用户发现取消）——改代理模型后必须**重启客户端**再派发，并核对子代理面板顶部的模型标签；每个执行单元完成后，主控必须**审查一遍是否真正正确解决了报告中要解决的问题**（对照报告小节核 diff + 抽跑验收），审查通过才继续下一项（C-16 主控自做；C-17 / C-18 主控已复核 diff 与验收实测，均通过：C-17 persist 新语义与 checkpointStrict 落位、第二连接持读事务验收断言逐字落实；C-18 索引/快速路径/专用接口三段提交、`AS id` 别名遮蔽偏离属实、基准 140.5ms<300ms 与索引命中由主控独立复跑证实）。
