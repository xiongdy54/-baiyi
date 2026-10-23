# C 项审计修复进度账

> **报告（只读）**：`C:\Users\xiongdy\Desktop\report_confirmed.md`（303 KB，3658 行，48 项 C-01…C-48）。
> **本账本**：只记状态、提交/合并、验收摘要、偏离；标题、根因、修复步骤与验收标准一律以报告 §2 / §3 / 对应 C-xx 小节为准。
> **更新时间**：2026-10-23。**本账最近更新时 main HEAD**：`5b920b2`（C-03 合并；账本建立于 `91824ee`）。

## 0. 执行规则（摘要，完整规则见报告 §0）

1. **一次会话只做一项 C-xx**；一项一提交，提交信息 `fix(C-xx): 简述`；验收通过后 `git merge --no-ff` 回 main（本仓无远程）。
2. **报告只读**。按 §0、§3、目标 C-xx 小节分段读，不要整份读入（超过 Read 工具上限）。
3. **先跑基线再改，再跑验收**。失败数不得多于本项开始前的基线，且失败集合不得新增文件；新增失败必须查明归属并在本账本记录。
4. **绝不触碰真实 userData**（`%APPDATA%\incremental-reading-dev` / `~/.config/incremental-reading-dev` / `~/Library/Application Support/incremental-reading-dev`）；测试用 `fs.mkdtempSync` + `app.setPath("userData", dir)`。
5. **不升级依赖**（除 C-24、C-41）；不运行 `npm audit fix --force`；不删除已有测试（期望过期只按 C-05 更新）。
6. **测试副产物**：`tests/*.bundle.cjs`、`tests/.results/`、`tests/tmp-*` 可能变脏；提交用显式路径，不要 `git add -A`。
7. **锚点优先**：报告行号只作参考；先 `rg -n "锚点"` 定位，找不到或代码与描述不一致时停下，按 §0 第 7 条回报。

## 1. 当前状态（2026-10-23）

- **报告快照对齐**：报告是在 `feat/floating-atlas-d203`（D203/D204 纸片图谱）功能分支的打包提交上产出的。该分支已于 2026-10-23 以 `--no-ff` 合入 main：`dde0a81`（分支 HEAD `1267cad`，32 文件 +6590/−509）。main 现在与报告快照的测试规模一致。
- **D203/D204 功能状态**：代码已进 main，但 **D204 实机 UX 仍未验收**（用户反馈「效果还是不好」；D205 窗内 morph 已实机否决并还原到 `1267cad`）。C-31/C-32/C-33 的 lensWindow 锚点现在存在，但仍按报告执行，不要假定该功能已验收。
- **测试规模**：89 个 `tests/*.test.cjs`，分布 **27 electron / 7 system-node / 55 electron-node**，与报告 §0 期望一致。
- **本机 Windows 基线（2026-10-23，C-02 前）**：`npm test` → **89 个：82 过 / 7 败 / 0 超时**；结果写入 `tests/.results/latest.json`。C-02 后两次全量均为 **81 过 / 8 败**，多出的 `lensWindow` G1 是时序 flake（见 §1.1），其余 7 败归属不变。**C-03 后一次全量为 83 过 / 6 败**：两个 artifact 失败已消除，`lensWindow` G1 本轮回落到失败集，其余 5 败归属不变。
- **报告 Linux 基线**：89 个 66 过 / 23 败（见报告 §1.3 / 附录 C）。跨平台比较以本机实测为准，并在回报中注明平台。
- **已完成**：C-07、C-01、C-02、C-03。
- **下一项**：**C-04**（`src/lib/epub.ts` 源码内字面 NUL 字符）。

### 1.1 已知失败与归属（2026-10-23，Windows）

| 测试文件 | 归属 | 说明 |
| --- | --- | --- |
| `tests/applog.test.cjs` | 待确认 | 报告 U-28 曾标为 Linux/Xvfb 环境差异；Windows 仍失败，暂不归属到 C-01。 |
| `tests/d111-artifact.test.cjs` | 已修复（C-03） | Windows CRLF 导致产物逐字节比较失败；C-03 改为规范化后比较并通过。 |
| `tests/i18n.test.cjs` | **C-06** | en / ja 各缺 4 个键；C-06 修复前预期失败。 |
| `tests/lensWindowFit.artifact.test.cjs` | 已修复（C-03） | D203 合并后新增；现场重打包 7053 B vs 仓库 7224 B，差值 171 B；C-03 改为规范化后比较并通过。 |
| `tests/lensWindow.test.cjs` | 未归属（时序 flake） | C-02 后两次全量均失败于 G1（55ms 采样 180ms 缓动）；该文件与 `electron/lensWindow.js` 未被 C-02 改动，单独连跑 3 次 1 过 2 败。 |
| `tests/m1.prompts.test.cjs` | **C-05** | prompt 版本期望 7，实际 8（过期期望）。 |
| `tests/m14.test.cjs` | 待确认 | Windows `EBUSY: rename ... library.db -> .pre-restore`（恢复换入）；暂不归属，执行 C-13 时复核。 |
| `tests/m7.prompts.test.cjs` | **C-05** | 主制卡 prompt 期望 v6，实际 8（过期期望）。 |

> 说明：C-01 在合并 D203 前是 85 个测试 79 过 / 6 败；合并后为 89 个 82 过 / 7 败。新增的唯一失败是 `lensWindowFit.artifact`，属 C-03，不是 C-01 回归。
> C-02 后两次全量均 81 过 / 8 败：多出的 `lensWindow` G1 是时序 flake（非 C-02 代码路径），其余 7 败与上表一致；20 个受 C-02 影响的测试 19 过 / 1 败（m14 既有 EBUSY），与基线相同。
> C-03 后全量 83 过 / 6 败：失败集合 = applog、i18n、lensWindow（时序 flake 本轮复现）、m1.prompts、m14、m7.prompts；两个 artifact 已不再失败，无新增失败文件。

## 2. 执行顺序与状态

状态图例：**完成** / **进行中** / **待做** / **中止** / **部分**。顺序严格按报告 §3。

### 阶段 0 · 工具链（C-07 → C-01 → C-02 → C-03 → C-04 → C-05 → C-06 → C-45）

| # | 编号 | 状态 | 提交 / 合并 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | C-07 | 完成 | `2610a74` / `c881615` | postinstall 无头 Linux 可诊断；`NUTATION_SKIP_ABI_VERIFY`。 |
| 2 | C-01 | 完成 | `951fbd9` / `ebba5ef`；合并后补头 `91824ee` | 统一入口 + esbuild + @runtime；验收见 §3.1。 |
| 3 | C-02 | 完成 | `f927189` / `4938cfa` | 32 个 ROOT + 3 处 Electron 二进制 + flows node 分支；验收见 §3.3。 |
| 4 | C-03 | 完成 | `d1a7ca4` + `829932c` + `42682e0` / `5b920b2` | `.gitattributes` 与行尾规范化各单独提交；验收见 §3.4。 |
| 5 | C-04 | 待做 | — | `epub.ts` 源码内字面 NUL。 |
| 6 | C-05 | 待做 | — | 两个过期 prompt 版本期望。 |
| 7 | C-06 | 待做 | — | 报告记 en / ja 各缺 17 键；当前实测各缺 4 键（以执行 C-06 时为准）。 |
| 8 | C-45 | 待做 | — | 10 条 Electron 流程测试跑完不退出。 |

### 阶段 1 · 首发前必须完成（P0）

| # | 编号 | 状态 | 提交 / 合并 | 备注 |
| --- | --- | --- | --- | --- |
| 9 | C-08 | 待做 | — | `bookasset://` 路径穿越。 |
| 10 | C-09 | 待做 | — | 渲染页无 CSP + 无权限请求处理器；依赖 C-08。 |
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
- 当前下一项：**C-04**。
- 基线：89 个测试；C-03 后 83 过 / 6 败（Windows，2026-10-23；失败集合见 §1.1）。
