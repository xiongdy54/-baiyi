# 增量阅读 · AI 入口（AGENTS.md）

> 给 AI 编码代理的**极短入口**：先读这里，再按下方路由表按需取文件。**不要通读整份指导文档**（它约 49 万字符（`wc -m AI_DEVELOPMENT_GUIDE.md` 查看实际值），且历史上单次读不完）。

## 项目一句话

本地优先的桌面「渐进阅读」学习软件。Electron 主进程（`electron/*.js`，CommonJS + better-sqlite3（WAL、`synchronous=FULL`，D137）；词典导入解析仍用 sql.js）+ React/TS 渲染层（`src/`）。主流程：书架 → 阅读（PDF / EPUB / Word / TXT / MD / HTML）→ 摘录与就地批注 → AI 制卡 → FSRS 复习 → 材料导图 / 知识图谱。

## 四条硬不变量（改任何东西前先确认没破）

1. **纯本地优先** —— 核心功能零网络、零账号（指导文档 §1.1）。
2. **同一份事实不允许两套解释** —— 调度真源唯一（`review_logs` + `fsrs_configs`）；**AI 不是事实源**（§1.9 / §1.10、§4.4）。
3. **先改文档再编码** —— 需求或契约变更先 bump 版本号 + 记决策号（§8.1），再动代码（§7.1.5）。
4. **每次落库即落盘** —— SQLite 事务提交即持久（WAL + `synchronous=FULL`）；`persist()` 现为显式 checkpoint（D137）；例外必须在 §7.2 登记（例外＝日记草稿节流 D34、应用日志追加写 D119）。

## 弱模型必读（每次动手前核对）

1. **跑测试**：只用 `node scripts/run-tests.mjs [过滤词]`。不要直接 `node tests/x.test.cjs`——better-sqlite3 是 Electron ABI，系统 Node 直接加载会报假失败。
2. **绝不碰真实数据目录**：`%APPDATA%\incremental-reading-dev`、`~/.config/incremental-reading-dev`、`~/Library/Application Support/incremental-reading-dev`（发布后还有 `Nutation`）。测试一律用 `fs.mkdtempSync` 临时目录 + `app.setPath("userData", dir)`。
3. **改表结构**：只能在 `electron/schemaVersion.js` 的 `MIGRATIONS` 末尾追加一项，并把 `SCHEMA_VERSION` +1；禁止修改已发布的项；禁止在 `initDb` 的基线代码块里新增 ALTER/CREATE。新表必须在 `electron/syncTables.js` 登记分类；同步/追加表禁止新增物理删除（除非登记）。
4. **编辑文本**：卡片/摘录/批注的编辑一律用统一的编辑组件与契约（`src/components/editing/`，见审计 C-34），不要新写 textarea 或 contentEditable。
5. **样式与动效**：颜色只用主题 Token，动效时长从 Token 读取并遵守"动效关闭"设置；提交前跑一致性闸门（审计 C-35）。
6. **界面文字**：新增或修改文案必须四语同步（简/繁/英/日），提交前 `node scripts/i18n-check.mjs` 退出 0。
7. **回车提交**：所有"按 Enter 提交"的输入框必须先判断 `e.nativeEvent.isComposing || e.keyCode === 229`（输入法组字中不提交）。
8. **搜索代码**：`rg` 输出 "binary file matches" 时加 `-a` 重试。
9. **拿不准就停**：按本文件的 BLOCKED 协议返回，不要猜。

## 做什么 → 读哪里

| 你要做的事 | 读这个 |
| --- | --- |
| 表结构 / 数据模型 / IPC 接口 / 设置键 | `AI_DEVELOPMENT_GUIDE.md` **§4** |
| UI / Design Token / 瑞士风 / 组件规范 | **§5** + `docs/swiss-international-style.md` |
| 产品规格 / 用户流程 / 摘录复习 / 导图 | **§6**（摘录复习 §6.8；材料导图 §4.19） |
| 编码硬约束 / 测试义务 / 提示词与配置 / 安全 | **§7**（测试义务 §7.3、配置与提示词 §7.4） |
| 架构现状（容器 / 组件 / 依赖 / 写入归属） | `docs/architecture-model/README.md` → `architecture-understanding.md` |
| 某条决策的来龙去脉 | **§8.1 决策日志**（按 D 编号查） |
| 当前进度 / 下一步 | **§9.2 主线状态表**、**§9.5 下一步** |
| 历史版本叙述 / 批次详情 / 旧变更记录 | `docs/HISTORY.md` —— **编码时不必读** |

## 工作方式（本仓约定）

- **子代理模型（用户指定 + 2026-10-25 教训）**：审计修复链执行单元 = `.zcode/agents/audit-flash.md`，模型 **GLM-5.3**、最高思考强度（用户 2026-10-24 指令「之后派子代理请使用 glm5.3 模型」）。该文件的 `model` 字段在**会话启动时快照加载**——会话中途改它对本会话后续 Agent 派发**不生效**（实证：C-40 派发仍以 GLM-5.3-Flash 运行 13 分钟被用户取消）；改代理模型后必须**重启客户端**，派发后核对子代理面板顶部的模型标签再放手。
- **改动开新分支，`main` 保持干净**（除非当次另有指示）。
- 一次只实现一个最小单元；动手前先对齐契约。
- 测试统一用 `node scripts/run-tests.mjs [过滤词]`（C-01）；新测试文件第 1 行必须写 `// @runtime: electron | electron-node | system-node`；GUI 套件（`*.gui.mjs`）跑前先 `npm run build`。
- 完工验收线见 §7.1.4（主流程可演示 + 重启不丢数据）与 §7.3（按里程碑的测试义务）。
- **文档即合同**：`AI_DEVELOPMENT_GUIDE.md` 的 § 编号与 D 编号是**被机器闸门解析的公共接口**（`tests/flows/` 的 `f11` / `f18` / `f20` / `f21` / `f24` / `f27` 直接读它），改编号会打碎闸门；`docs/HISTORY.md` 与指导文档**合并为一个文档集**参与 `f11` 的判据。

## 智能体分工与路由（`.trae/agents/`）

本项目配置 5 个子智能体，内置 Agent 担任总控：**只做路由、指针传递、机械验证，不做诊断和设计决策**。

**白名单（总控直接做）**：文案、样式微调、简单 CRUD、明确局部的小 Bug。

**路由**：
- 新 UI 设计 / 交互方案 / "应该怎样设计" → `ui-ux-architect`（设计稿落 `docs/design/`）
- 已实现类前端工作（有设计稿） → `frontend-builder`
- 明确普通 Bug → `bug-fixer`
- 核心领域（FSRS / DB / Reader / KG / AI 制卡 / Electron 主进程 / 并发事务）→ `core-engineer`（默认诊断模式出方案；实施模式仅限核心域改动），完成后必须经 `code-reviewer` 审查
- 拿不准 → 向上升级（DeepSeek → GLM-5.3 / Kimi-K3）；用户点名 → 直接分派、跳过路由
- 同一子代理对同一问题最多分派 2 次，仍失败则升级或停下来问用户

**模型分层**：设计层 `ui-ux-architect`（kimi-k3）；核心层 `core-engineer` / `code-reviewer`（glm-5.3）；执行层 `frontend-builder` / `bug-fixer`（glm-5.3-flash）。贵模型只做高智能工作（诊断、设计、核心域逻辑、审查），零碎执行一律下沉执行层。

**子代理不可互调**（平台限制：仅内置 Agent 可调 Subagent）：强代理"委派"执行层的唯一方式 = 方案中的**任务拆解表**（每项含任务 / 建议执行者 / 涉及文件 / 可机械检查的验收标准 / 依赖），由总控逐项代为派发。

**复杂任务标准循环**（总控编排，直至合格）：
1. 派 `core-engineer` / `ui-ux-architect`（**默认诊断模式**，只读）→ 方案落 `docs/design/`，含任务拆解表；核心域改动需实施时，由总控在交接包中明确标注「实施模式」并限定核心域范围。
2. 总控按拆解表逐项派发 `frontend-builder` / `bug-fixer`（一次一项，交接包指向方案路径）；一次只派一项，不整包下发。
3. 每轮执行完成 → 派 `code-reviewer` 审查 → 验收结论**合格**即收尾；**不合格** → 把「必须修复项」原样转派给结论中标注的修复归属代理修改 → 复审。
4. 同一任务连续 2 轮不合格 → 升级（换强代理）或停下来问用户。

**弱主控红线**：总控不自创诊断、设计或验收标准；不对强代理产出做语义判断（语义把关在 `code-reviewer`），只核对机械验证结果——跑测试/lint/build、核对 diff 范围、对照 GUIDE 不变量清单。**禁止把完整功能（设计+实现+收尾）整包派给 `core-engineer` 直接实施**——除非改动完全落在核心域清单内，否则必须走上面的标准循环。

### 交接包模板（指针式交接）

```text
【目标】一句话说明要做什么。
【用户原话】逐字引用用户的原始需求（禁止改写、概括）。
【入口】相关 § 编号、文件路径、HISTORY 条目号、docs/design/ 方案路径——只给指针，
        由子代理自行阅读原文。禁止替子代理总结文档内容。
【已确认决策】仅列出用户或上游强代理已明确拍板的决策（附来源）。
【约束】不能改什么、必须遵守什么。
【验收标准】可机械检查的条件：测试/lint/build 命令、GUIDE 不变量编号、diff 范围限制。
            复杂任务的验收标准必须来自上游方案文件，不得自创。
【范围外】明确不做什么。
【输出要求】返回报告格式；长产出写入 docs/ 后只返回路径。
```

禁止给出"根因是…""应该改成…"这类诊断性结论——那是子代理的职责。

### BLOCKED / REFRAME 协议

**BLOCKED**（所有子代理）：信息不足、方案无法实施、或问题超出职责时，禁止猜测、禁止硬着头皮改，立即停止并返回：

```text
BLOCKED
缺失信息 / 阻塞原因：…
需要补充：…（具体到 § 编号、文件、或需用户确认的决策）
已完成的部分：…（如有）
```

**REFRAME**（仅 `ui-ux-architect` / `core-engineer`）：子代理若判断**任务框定本身错误**（根因在别处、范围定错、设计方向错误、验收标准不合理），有权且有义务停止执行并返回：

```text
REFRAME
原框定的问题：…
实际的问题 / 正确的范围：…
证据：…（文件、调用链、数据流）
建议的处理路径：…
```

总控收到 REFRAME 后不得强行坚持原框定：采纳则按新框定重新分派，存疑则升级或转述给用户裁决。

### 文档使用

- `AI_DEVELOPMENT_GUIDE.md`（合同）：**只给 § 编号，子代理自取原文**，禁止总控代读代总结。
- `docs/HISTORY.md`（档案）：默认不读；相关时只传具体条目号/日期，任何代理不得全文扫描。
- 跨代理长内容一律落盘 `docs/design/`，只传路径不传全文。
