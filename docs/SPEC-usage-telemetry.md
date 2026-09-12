# 规格文档：AI 用量计量 + 匿名遥测（商业化数据基建 v1）

> **给 ZCode 的执行指令**：本文档是唯一实现依据。实现顺序按 §7 任务清单，每个 Phase 验证通过后 git commit（message 格式见 §7）。
> **约束**：①不得修改 `AI_DEVELOPMENT_GUIDE.md`（锁定文档）；②不得引入除 `posthog-node`（可选方案 B）以外的任何 npm 依赖；③所有新增用户可见文案为简体中文；④遵守项目现有代码风格（主进程 CommonJS require、渲染层 ES Module + TypeScript）。
> **北极星**：所有采集只服务一个决策——「该不该买资源包 / 去和模型提供商谈折扣」。不采集任何用户内容。

---

## 0. 背景与目标

软件现状：用户自配 API Key（`electron/ai.js` 统一网关，全部 LLM 调用经 `chatStream`）。商业化路线：将来软件内充值、由开发者供 Key。需要在此之前建立数据能力：

| 目标数据 | 精度 | 手段 |
|---|---|---|
| 用户量、活跃、留存、功能使用频率 | 事件级 | 匿名遥测（PostHog Cloud 免费版） |
| 每用户的 API 调用次数 / token 消耗 | 精确（本地）+ 聚合（上报） | 主进程计量落库 + 每日聚合上报 |
| 决策依据：月采购量预估 | 估算 | 本地按参考单价折算月成本 |

**红线（必须 100% 满足，任何一条被破坏即实现错误）**：
1. 首次启动弹《隐私政策》征得同意后，遥测才允许发出第一个字节；拒绝则永不联网上报。
2. 不采集：阅读材料内容、生成的卡片内容、发送给 LLM 的任何消息文本、API Key、文件路径、硬件标识。
3. 设置内提供「匿名使用统计」开关，关闭后进程内零遥测网络请求（不是"少报"，是"不发"）。
4. 本地计量表只存数值与元数据（时间/服务商/模型/token 数/耗时），永不存 prompt 与 completion 正文。

---

## 1. 现有代码接触点（已勘察，直接对照）

| 文件 | 现状 | 本次改动 |
|---|---|---|
| `electron/ai.js` | `chatStream({messages, temperature}, send)` 流式调用 LLM；SSE 解析在 `res.on("data")`；`PRESETS` 四预设 goat/zai/custom/local；`testConnection` | 解析 SSE 里的 `usage` 字段；无 usage 时估算；每次调用（成功/失败）落库；`chatStream` 与 `testConnection` 增加 `meta.source` |
| `electron/db.js` | sql.js，schema 常量含 `CREATE TABLE IF NOT EXISTS`，`initDb()` 建表，`users` 表有 `'local-user'` | 新增 `ai_usage` 表 + `recordUsage` / `getUsageSummary` / `getDailyRollup` 三个函数 |
| `electron/main.js` | IPC 注册区；`readSettings/writeSettings`（settings.json，scope 结构 `{app, theme}`）；`app.whenReady`；`ai:chat` handler | 注册 `usage:summary` IPC；`ai:chat` 透传 `meta`；启动/退出钩子挂遥测 |
| `electron/preload.js` | `contextBridge.exposeInMainWorld` 各 API | `aiAPI.chat` 增加 meta 参数；新增 `usageAPI` |
| `src/lib/ai.ts` | `aiGateway.chat(messages, onDelta, temperature, onThinking)` | 增加第 5 参 `source`；新增 `usageAPI` 类型声明 |
| `src/components/SettingsPanel.tsx` | 设置面板（含 AI 服务区） | 新增「AI 用量」区块 + 「匿名使用统计」开关 |
| `src/App.tsx` | 应用根组件 | 首启《隐私政策》同意对话框 |
| `tests/fsrs/*.cjs` | Node 直跑 db.js 的测试约定（临时 userData 沙盒） | 新增 `tests/usage.test.cjs`、`tests/telemetry.test.cjs` 沿用同一约定 |

aiGateway.chat 的现有调用方（需逐一加 `source` 参数）：先 `grep -rn "aiGateway.chat" src/` 找全，按调用场景赋值：制卡 → `card_gen`，联网背景补充相关的 LLM 调用 → `enrich`，其余新场景各自命名。**不传则默认 `unknown`**。

---

## 2. 数据库：`ai_usage` 表（本地精确计量）

### 2.1 Schema（追加到 db.js 的 schema 常量末尾）

```sql
CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY,            -- crypto.randomUUID()
  ts INTEGER NOT NULL,            -- 调用完成时刻 Date.now()
  preset TEXT NOT NULL,           -- 'goat' | 'zai' | 'custom' | 'local'
  model TEXT NOT NULL,            -- 请求的模型名，原样记录（如 'z-ai/glm-5.3-flash'）
  source TEXT NOT NULL,           -- 'card_gen' | 'enrich' | 'test' | 'unknown' | ...
  status TEXT NOT NULL,           -- 'ok' | 'error'
  error_code TEXT,                -- 失败时：'AI_NO_KEY' | 'HTTP_4xx' | 'HTTP_5xx' | 'CONN' | 'TIMEOUT'，成功为 NULL
  prompt_tokens INTEGER,          -- 精确或估算，见 2.2
  completion_tokens INTEGER,
  total_tokens INTEGER,
  usage_source TEXT NOT NULL,     -- 'exact' | 'estimated'
  duration_ms INTEGER             -- 请求发出到流结束
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_ts ON ai_usage(ts);
```

### 2.2 token 数的获取（核心逻辑，写在 electron/ai.js）

**精确路径**：SSE 流中任何 chunk 的 `json.usage`（OpenAI 兼容流式的最后一个 chunk 常带，字段 `prompt_tokens` / `completion_tokens`）。当前解析代码只取 `json.choices[0].delta`，需在同层补充：`if (json.usage) capturedUsage = json.usage;`。注意最后 usage chunk 可能是 `"choices":[]`，现有代码 `json.choices?.[0]?.delta || {}` 天然兼容，不要改动该行为。
**不主动发送 `stream_options: {include_usage: true}`**：部分 OpenAI 兼容网关会对未知参数报 400，风险大于收益。默认依赖各提供商自动回传 + 估算兜底。
**估算路径**（`usage_source: 'estimated'`，当流结束仍无 usage）：

```js
// 中文按 0.7 token/字，非中文按 4 字符/token（GLM/Qwen 系分词器的粗均值，误差 ±30%，足够商业决策）
function estimateTokens(text) {
  const s = String(text || "");
  const cjk = (s.match(/[\u4e00-\u9fff\u3040-\u30ff]/g) || []).length;
  const other = s.length - cjk;
  return Math.max(1, Math.ceil(cjk * 0.7 + other / 4));
}
// prompt_tokens = estimateTokens(messages.map(m => m.content).join("\n"))
// completion_tokens = estimateTokens(完整正文累积)   ← 渲染层已能拿到 acc，但计量在主进程做：
//   在 chatStream 内累积 d.content 的长度传给估算（新增局部变量 contentAcc += d.content）
```

**记录时机**：`res.on("end")` / `[DONE]`（成功）与所有 `reject` 路径（失败，token 可为 NULL）之后，调用 `usage.recordUsage({...})`。`testConnection` 传 `source: 'test'`。
**局部模型也记录**（preset='local'，成本为 0 但有行为分析价值）。

### 2.3 db.js 新增函数

- `recordUsage(entry)`：INSERT，任何异常吞掉并 `console.warn`——**计量绝不能影响制卡主流程**。
- `getUsageSummary(days = 30)`：返回近 N 天 `{ calls, okCalls, errorCalls, promptTokens, completionTokens, byPreset: [{preset, calls, tokens}], byDay: [{date, calls, tokens}] }`。
- `getDailyRollup(date)`：单日聚合（供遥测 usage_daily 事件用），返回 `{date, calls, ok, errors, prompt_tokens, completion_tokens, by_preset:{...}}`，无数据返回 null。

---

## 3. 遥测模块 `electron/telemetry.js`（新建）

### 3.1 方案选择

- **方案 A（推荐，默认实现）**：直连 PostHog Cloud batch 接口。零 npm 依赖，约 80 行：
  `POST https://us.i.posthog.com/batch/`，body `{ api_key: "<phc_项目Key>", batch: [{event, distinct_id, properties, timestamp}] }`，超时 5s。EU 区用户把域名换 `eu.i.posthog.com`。
- 方案 B（备选）：`npm i posthog-node`，功能等价，多一个依赖。仅在用户要求时采用。

### 3.2 配置（模块顶部常量）

```js
const POSTHOG_HOST = "https://us.i.posthog.com";
const POSTHOG_API_KEY = "phc_REPLACE_ME";   // 上线前由用户在 PostHog Cloud 建项目后粘贴（Project API key）
const APP_VERSION = require("../package.json").version;
```

`POSTHOG_API_KEY` 为占位符时模块自动进入"未配置"休眠态（等价于用户拒绝），不报错。

### 3.3 身份与存储

- `installId`：`crypto.randomUUID()` 首次生成后存 settings.json 的 `app.telemetryInstallId`（复用 main.js 的 readSettings/writeSettings，经 IPC 由 main.js 传入，telemetry.js 不直接读写文件）。
- consent：`app.telemetryConsent`，取值 `'granted' | 'denied' | null`（null = 尚未询问）。**telemetry 模块对外唯一入口检查该值**。
- 待发队列：`userData/telemetry-queue.json`，数组，上限 500 条，超出丢最旧。发送成功即清除；失败保留，下次启动重试。

### 3.4 事件规范（字段名逐字实现）

所有事件公共 properties：`{ app_version, os: process.platform, locale: app.getLocale(), $lib: 'incremental-reading' }`。

| 事件名 | 触发时机 | 专有 properties |
|---|---|---|
| `app_launch` | `app.whenReady()` 且 consent=granted（拒绝后开启的当次会话也补发一次） | 无 |
| `card_generated` | 每次 LLM 调用成功且 source='card_gen' | `preset, model, prompt_tokens, completion_tokens, duration_ms, usage_source` |
| `ai_call` | 其他 source 的成功调用（enrich/test/unknown） | 同上 + `source` |
| `ai_call_failed` | LLM 调用失败（任何 source） | `preset, model, error_code, source, duration_ms`。**绝不发送错误消息正文** |
| `key_configured` | `ai:setConfig` 后 hasKey=true 且（首次配置该 preset 或 preset 变更） | `preset, model`。**绝不发送 key 任何部分** |
| `usage_daily` | 每次启动时，补发「昨天」的 `getDailyRollup`（幂等：内存 Set 记录已发日期 + settings.json 存 `app.telemetryLastDaily` 防跨日重复） | `date, calls, ok, errors, prompt_tokens, completion_tokens, by_preset` |

### 3.5 发送策略

- 内存队列 + 10s 防抖批量 flush（batch 单次 ≤ 50 条）；`app.on("before-quit")` 尽力 flush 一次。
- 网络失败→写回队列文件，下次启动重试。**遥测任何失败静默处理，绝不向用户弹错**。
- consent !== 'granted' 时，所有 API 直接 return，队列文件也不得写入。

### 3.6 隐私政策对话框文案（App.tsx 首启展示，用户点「同意并继续」或「拒绝」）

> **匿名使用统计说明**
> 为了改进软件，我们希望匿名收集以下数据：功能使用次数（如制卡次数）、AI 调用的技术信息（服务商、模型名称、token 用量、耗时）、错误类型代码、应用版本与操作系统类型。
> 我们承诺：**绝不收集您阅读的内容、生成的卡片、任何输入或输出的文本、您的 API Key**；数据不含任何可识别您个人身份的信息；数据仅用于改进产品与规划服务能力。
> 您可以随时在「设置 → 通用」中开启或关闭匿名统计。关闭后软件将不再发送任何统计数据。

---

## 4. 主进程装配 `electron/main.js`

1. `const telemetry = require("./telemetry"); const usage = require("./usage");`（若计量函数放独立文件；放 db.js 内则只 require db）。
2. `ai:chat` handler 签名扩展：`ipcMain.on("ai:chat", (e, requestId, messages, temperature, meta) => ...)`，把 `meta?.source` 传入 chatStream。
3. `ai:setConfig` handler 内（或 ai.js setAIConfig 返回后）检测 key_configured 条件并 `telemetry.capture(...)`。
4. 新 IPC：`ipcMain.handle("usage:summary", (_e, days) => getUsageSummary(Number(days) || 30))`。
5. 生命周期：`app.whenReady().then(...)` 内 `telemetry.init({ getSetting, setSetting, appVersion, rollupFn: getDailyRollup }); telemetry.captureAppLaunch();`；`before-quit` 内 `telemetry.flushOnQuit()`。

preload.js 增量：

```js
contextBridge.exposeInMainWorld("usageAPI", {
  summary: (days) => ipcRenderer.invoke("usage:summary", days)
});
// aiAPI.chat 增加 meta 透传：
chat: (requestId, messages, temperature, meta) => ipcRenderer.send("ai:chat", requestId, messages, temperature, meta)
```

src/lib/ai.ts 增量：`chat(messages, onDelta?, temperature?, onThinking?, source?: string)` 内部 `window.aiAPI.chat(requestId, messages, temperature, { source });`；新增 `usageAPI` 的全局类型声明（`summary(days): Promise<UsageSummary>`，结构见 §2.3）。

---

## 5. 渲染层 UI

### 5.1 SettingsPanel.tsx —「AI 用量」区块（放在 AI 服务区下方）

- 近 30 天汇总一行：`调用 N 次 · 输入 X tokens · 输出 Y tokens`。
- 按服务商小表：服务商 / 次数 / tokens（preset 显示为预设名，复用现有 presetName 映射）。
- 近 7 日迷你表：日期 / 次数 / tokens。
- **成本参考行（P3 可选）**：代码内置单价表 `{模型名子串: 元/百万tokens}`（写死几个常见模型：glm-4.7-flash≈0、deepseek 系、glm-5 系，注释注明"参考价，上线前手动更新"），`tokens × 单价` 折算显示 `≈ ¥N.NN/月`，旁边标注"按公开牌价估算"。单价表缺失的模型不计入。

### 5.2 SettingsPanel.tsx —「匿名使用统计」开关（通用区）

- 读取 `app.telemetryConsent`，开关即写 'granted'/'denied'。
- 开关旁小字链接「我们收集什么？」→ 展开静态列表（照抄 §3.6 承诺清单）。
- 首启对话框出现在 App.tsx：`telemetryConsent === null` 时渲染模态框（两种选择都必须可点，默认焦点在「拒绝」上）。同意后当次会话立即补发 `app_launch`。

---

## 6. 测试与验收

### 6.1 自动化测试（沿用 tests/fsrs 的 Node 直跑 + 临时沙盒约定）

`tests/usage.test.cjs`：
1. 起本地 http 假 LLM 服务：①流含 usage chunk → 断言落库 `usage_source='exact'`、数值一致；②流不含 usage → 断言 `'estimated'` 且 prompt/completion 均 >0；③非 200 响应 → 断言 status='error'、error_code 匹配 `HTTP_4xx`。
2. 断言 `getDailyRollup` 聚合数值正确、`getUsageSummary` byPreset/byDay 正确。
3. 断言 ai_usage 表无任何正文列、recordUsage 异常不抛出。

`tests/telemetry.test.cjs`（指向本地 mock 服务器的 batch 端点）：
1. consent='denied' → 任意 capture 后 mock 服务器收到 0 请求、队列文件不存在。
2. consent='granted' → batch body 含 `api_key`、`batch` 数组、`distinct_id` 为 UUID、公共 properties 齐全。
3. mock 返回 500 → 事件保留在 telemetry-queue.json；重启 init 后重发成功并清空。
4. 构造一条含"敏感词"属性的调用 → 断言队列里不含消息正文（白名单字段校验）。

运行命令：`node tests/usage.test.cjs && node tests/telemetry.test.cjs`（如项目测试有统一入口则用统一入口）。

### 6.2 手工验收清单

- [ ] `npm run build` 通过；`npm run dev` 启动正常。
- [ ] 删除 userData 下 settings.json 模拟首启 → 弹隐私政策；点拒绝 → 开发者工具 Network 面板与主进程日志零遥测请求；点同意 → PostHog Live events 立即看到 `app_launch`。
- [ ] 配置真实 Key 制卡一次 → 设置页「AI 用量」出现数字；PostHog 收到 `card_generated`（含 preset/model/tokens）。
- [ ] 用本地 Ollama 跑一次 → usage 表记录 preset='local'。
- [ ] 断网状态制卡 → 制卡正常成功、遥测静默失败、telemetry-queue.json 有待发条目；恢复网络重启后队列清空。
- [ ] 设置开关关闭 → Network 面板确认再无任何 posthog 请求。
- [ ] `git grep -n "apiKey" electron/telemetry.js electron/usage.js` 零结果（Key 不进遥测代码路径）。

### 6.3 每个 Phase 的提交

验证全过后 commit：`feat(usage): P1 本地计量` / `feat(telemetry): P2 匿名遥测` / `feat(ui): P3 用量面板与同意流` / `test: P4 用量与遥测测试`，随后 push origin。

---

## 7. 任务清单（按序执行）

| # | 任务 | 涉及文件 | 验收 |
|---|---|---|---|
| P1 | ai_usage 表 + recordUsage/summary/rollup + ai.js usage 解析与估算 + record 埋入 chatStream/testConnection | db.js, ai.js | usage.test.cjs ①②③ 过；手工制卡后 sqlite 有行 |
| P2 | telemetry.js（方案 A）+ main.js 装配 + consent 读取 + 队列文件 | telemetry.js(新), main.js | telemetry.test.cjs 1–3 过；拒绝态零网络 |
| P3 | preload/ai.ts 类型 + SettingsPanel 用量区 + 匿名统计开关 + App.tsx 首启同意框 + aiGateway.chat source 透传（含全部调用方补参） | preload.js, ai.ts, SettingsPanel.tsx, App.tsx, 调用方若干 | 手工验收 1–6 全过 |
| P4 | 两个测试文件补全 + 全量回归 + （可选）成本参考行 | tests/ | 全部测试过、build 过 |
| P5 | （可选）`include_usage` 按 preset 白名单试发 + 400 自动回退；成本估算行 | ai.js, SettingsPanel.tsx | 手工验证不破坏原调用 |

**规模预估**：P1–P4 合计约 6–9 个文件、净增 ~600 行。P1+P2 可一次会话完成，P3 一次，P4 一次。

---

## 8. 数据消费口径（给所有者，非开发任务）

数据上线 4–8 周后按此表决策：

| 信号（按官方牌价折算的月 token 成本） | 动作 |
|---|---|
| < ¥100 | 不动作，按量付费 |
| ¥100–1000 且连续增长 | 买资源包（百炼/火山等，约 5.5–7 折） |
| 稳定 > ¥1000、连续 3 个月上升 | 带账单与增长曲线找提供商商务谈承诺折扣 |
| > ¥1 万 | 多提供商比价 + 智能路由 |

辅助指标：周 `card_generated` 活跃用户数（北极星）、人均月 tokens（定价依据）、`key_configured` 的 preset 分布（先跟谁谈）、`ai_call_failed` 的 error_code 分布（稳定性）。

## 9. 上线前人工步骤（ZCode 之外，所有者自己做）

1. 注册 PostHog Cloud（免费 100 万事件/月）→ 建项目 → 复制 Project API key（phc_ 开头）→ 填入 telemetry.js 的 `POSTHOG_API_KEY`。
2. 隐私政策文本（§3.6）同步放进软件分发页/官网。
3. 若日后上架国内安卓商店：确认商店对 SDK 的合规申报要求，PostHog 属境外服务，必要时切换为自托管（本项目事件量小，单机 sqlite + 简单接收端即可，接口规范保持 §3.4 不变）。
