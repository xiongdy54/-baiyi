# AI 供应商注册表扩容 + 本地模型可用性（D112 / v48.68）设计稿

## §0 用户原话（逐字，2026-10-07）

> 完善大模型供应商设置和本地大模型接入设置，请你先完成研究和设计：
> 请先联网检索成熟的大模型供应商APIkey接入方案方式（如果没有的话可以参考Hermes），确保设计无误，然后增加软件中对主流大模型供应商官方APIkey接入的支持（例如deepseek、mimo、gpt、火山、硅基流动、grok、Claude还有更多主流的官方的请你自行检索添加支持）
> 还有就是完善本地大模型接入功能，确保它确实可用。

## §1 研究结论（2026-10-07 联网核实）

### 1.1 业界方案

- 参考对象 [Hermes Agent（NousResearch）](https://github.com/NousResearch/hermes-agent)：供应商设置＝「选供应商 + 贴 API Key + 选模型」，Key 集中管理、与子环境隔离；供应商切换只换 Key。本软件既有 AIGateway（`electron/ai.js`）与此同构，差距只在**预置供应商数量**与**本地运行时的可用性保障**，不需要引入任何第三方框架。
- 多供应商客户端的通用做法（Cherry Studio、Hermes、各家官方 SDK 文档一致）：**统一走 OpenAI 兼容协议 `/chat/completions`，官方原生协议只是备选**。Anthropic 与 Google 均已提供官方 OpenAI 兼容层（见 1.2），因此本软件**零改动传输层**即可覆盖全部主流供应商——这是本设计不引 SDK、不改协议的依据。

### 1.2 各供应商官方端点核实表（全部经官方文档/多方来源核实，2026-10-07）

| 供应商 | Base URL | 协议 | 默认模型（可拉取/手改） | Key 获取 |
| --- | --- | --- | --- | --- |
| Command Code GOAT（既有） | `https://api.commandcode.ai/provider/v1` | OpenAI 兼容 | `z-ai/glm-5.3-flash` | commandcode.ai |
| 智谱官方（既有） | `https://open.bigmodel.cn/api/paas/v4` | OpenAI 兼容 | `glm-4.7-flash` | bigmodel.cn |
| DeepSeek 官方 | `https://api.deepseek.com/v1` | OpenAI 兼容（[官方文档](https://api-docs.deepseek.com)） | `deepseek-chat` / `deepseek-reasoner` | platform.deepseek.com |
| 小米 MiMo 开放平台 | `https://api.xiaomimimo.com/v1` | OpenAI 兼容（[官方入口 mimo.mi.com](https://mimo.mi.com)） | `MiMo-V2-Flash` | mimo.mi.com |
| OpenAI 官方 | `https://api.openai.com/v1` | 原生 | `gpt-4o-mini` | platform.openai.com |
| 火山方舟（豆包） | `https://ark.cn-beijing.volces.com/api/v3` | OpenAI 兼容（[官方文档](https://www.volcengine.com/docs/82379)） | 空（填推理接入点 `ep-…` 或模型名） | console.volcengine.com/ark |
| 硅基流动 | `https://api.siliconflow.cn/v1` | OpenAI 兼容（[官方文档](https://docs.siliconflow.cn)） | `Qwen/Qwen2.5-7B-Instruct` | cloud.siliconflow.cn |
| xAI Grok | `https://api.x.ai/v1` | OpenAI 兼容，`/v1/models` 可用 | `grok-3` | console.x.ai |
| Anthropic Claude | `https://api.anthropic.com/v1/` | **官方 OpenAI SDK 兼容层**（[官方文档](https://platform.claude.com/docs/en/api/openai-sdk)）：Bearer 鉴权、流式全支持；温度上限 1（本软件全部调用 ≤0.7 ✓）；不提供该层 `/models` 列表 → 手输模型 | `claude-sonnet-4-6` | console.anthropic.com |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | **官方 OpenAI 兼容层**（AI Studio 文档） | `gemini-2.5-flash` | aistudio.google.com/apikey |
| Kimi（月之暗面） | `https://api.moonshot.cn/v1` | OpenAI 兼容（官方开放平台） | `kimi-k2-0905-preview` | platform.moonshot.cn |
| 阿里云百炼（Qwen） | `https://dashscope.aliyuncs.com/compatible-mode/v1` | OpenAI 兼容（官方 compatible-mode） | `qwen-plus` | bailian.console.aliyun.com |
| OpenRouter（聚合） | `https://openrouter.ai/api/v1` | OpenAI 兼容，`/models` 可用 | 空（拉取列表自选） | openrouter.ai/keys |
| 本地 Ollama | `http://localhost:11434/v1` | OpenAI 兼容（另存原生 `/api/tags`） | `qwen3:8b` | 无需 Key |
| 本地 LM Studio | `http://localhost:1234/v1` | OpenAI 兼容 | 拉取列表 | 无需 Key |

兼容性已核对的本软件请求形状：`POST {base}/chat/completions` + `Authorization: Bearer` + SSE 流式 + `stream_options.include_usage` + `reasoning_effort`（仅 GLM-5.2+ 按模型名注入）。Anthropic 兼容层对以上各项「Fully supported」或忽略；温度全部 ≤0.7 不触其上限。

## §2 设计

### 2.1 供应商注册表（`electron/ai.js` PRESETS 单一来源）

PRESETS 从 4 项扩至 **15 项**（上表逐项落库），每项形状不变（`{id,name,baseUrl,model,keyUrl,hint}`）＋新增分组字段 `group`（`official`｜`agg`｜`local`｜`custom`，渲染层分组展示用）。**传输层、ai-config.json 文件形状、`keys[preset]` 按服务商独立加密存储、切换预设只恢复该服务自己的 Key——全部零改动**（既有 `setAIConfig` 逻辑对新 id 天然生效）。

`getAIConfig()` 返回体**追加** `presets` 元数据数组（`[{id,name,baseUrl,model,keyUrl,hint,group}]`，**不含任何 Key**），经既有 `ai:getConfig` 通道下发，渲染层 UI 从单一来源渲染，删除硬编码的 4 项 `PRESET_OPTIONS`。

新增 IPC **`ai:detectLocal`**（invoke）：主进程 `detectLocalRuntime()` 依次探测 `http://localhost:11434/v1/models`（Ollama）→ `http://localhost:1234/v1/models`（LM Studio），每探针 4 秒超时；命中即返回 `{detected:true, runtime, baseUrl, models[]}`，全不命中返回 `{detected:false, message}`（含可读指引，绝不抛错）。Ollama 探针在 `/v1/models` 非 200 时降级尝试原生 `/api/tags`（旧版兼容，解析 `{models:[{name}]}`）。

`listModels()` 对本地预设补**同款降级**：`{base}/models` 失败时尝试同源 `/api/tags`，仍失败才报「无法连接本地模型服务」。

### 2.2 渲染层 UI（`SettingsPanel.tsx` AISection）

- 预设列表改由 `cfg.presets` 驱动，按 group 分组小标题（官方云服务 / 聚合平台 / 本地运行时 / 通用）平铺，按钮样式沿用既有 `skin-list`/`ai-preset-name` 语言，**零新 Design Token**；`cfg.presets` 缺席时回落旧 4 项静态表（兜底 GUI 测试桩）。
- 各预设的 Key 创建链接与提示改为读注册表元数据（`keyUrl`/`hint`），替换 goat/zai/local 三段硬编码条件渲染。
- **本地预设新增「检测本地服务」按钮**：调用 `ai:detectLocal`，结果显示运行时名/地址/模型数，一键「采用检测地址」并直接把返回的模型列表填入下拉。
- 火山方舟/OpenRouter/Claude 等无默认模型或不支持列表的，靠 hint 引导手输（模型名输入框本就允许手输）。

### 2.3 本地模型「确实可用」修复（潜伏缺陷）

主进程三处（`chatStreamOnce`/`listModels`/`testConnection`）对本地预设免 Key，但渲染层两处只看 `hasKey`，导致**无 Key 的本地配置被误判为「无 Key」而静默跳过**：

- `src/lib/kpExtract.ts`（K2-A 知识抽取：`!cfg?.hasKey` → no-key 静默跳过）；
- `src/components/InsightPanel.tsx`（M8-B 洞察：`setNoKey(!cfg?.hasKey)` 置灰）。

修复：`src/lib/ai.ts` 新增单一判据 `aiConfigUsable(cfg)`＝`Boolean(cfg && (cfg.hasKey || cfg.preset === "local"))`，上述两处与 `SettingsPanel.handleTest` 三处消费方统一换用（与主进程 `needKey = cfg.preset !== "local"` 纪律对齐）。

## §3 测试计划

- `tests/d112-providers.test.cjs`（@runtime electron）：① 注册表完整性——15 项、id 唯一、cloud 项 baseUrl 为 https 且含版本路径、4 个既有 id（goat/zai/custom/local）形状不回退；② `setAIConfig` 切换预设互不串 Key（deepseek↔zai 往返）；③ `detectLocalRuntime` 对本地 mock http 服务命中/超时未命中两态；④ `listModels` 的 `/api/tags` 降级。userdata 隔离沿用 f41 做法。
- `tests/d112.gui.mjs`（@runtime electron，先 `npm run build`）：设置页渲染 15 项分组列表、切换预设提示语义、本地预设出现「检测本地服务」且无本地服务时给出可读失败（不挂死）。
- 回归：F11（文档闸门）/ F16（安全边界：Key 不出主进程）/ F41（传输故障注入，传输层零改动必须全绿）+ `npm run build` + tsc。

## §4 验收清单（可机械检查）

1. `npm run build` 成功；`npx tsc --noEmit` 0 错误。
2. `tests/d112-providers.test.cjs` 全断言通过。
3. `tests/d112.gui.mjs` 全断言通过。
4. F11 / F16 / F41 全绿。
5. 指导文档：标题版本 = v48.68；§8.1 存在 D112 且 D1…D112 无缺号；§2 AI 网关行列出注册表；§7.4 登记 `ai:detectLocal（`（f21 括号点名通道必须在主进程注册）。
6. 渲染层 grep `!cfg?.hasKey` 在 kpExtract/InsightPanel 为 0 处（替换为 `aiConfigUsable`）。

## §5 修订记录

- v1（2026-10-07）：首版。研究来源：Hermes Agent、Anthropic OpenAI SDK 兼容层官方文档、DeepSeek/火山方舟/硅基流动/xAI/小米 MiMo 官方与多方来源检索（见 §1.2 链接）。
- v2（2026-10-07，D113 / v48.69）：①**邀请奖励活动核实**（用户指令「调查这些供应商有没有邀请用户来获得奖励的活动」）——15 家中仅 4 家有官方邀请奖励：硅基流动「[推荐官」计划](https://www.siliconflow.cn)（邀请得全平台通用代金券，个人链 `cloud.siliconflow.cn/i/<邀请码>`）、火山方舟「[邀请有礼](https://docs.volcengine.com)」（双方至高 145 元代金券；Coding Plan 邀请 9 折/10% 代金券）、阿里云百炼 Token Plan（[邀请得 1000 元 Credits](https://developer.aliyun.com)）、智谱「拼好模」拼团（`?ic=` 邀请链，Coding Plan 立省 20%）；其余（DeepSeek/小米 MiMo/OpenAI/Anthropic/Gemini/xAI/Kimi/OpenRouter/Command Code GOAT/OpenRouter）无个人邀请制活动。②用户交付硅基流动邀请链 `https://cloud.siliconflow.cn/i/AL4iBJ0e` → `PRESETS.siliconflow.keyUrl` 替换 + 注册表置顶（用户指令「将它排在最顶部」）；hint 注明「经邀请链接注册后在控制台创建 API Key」。③顺带修正 kimi keyUrl：platform.moonshot.cn 已迁移 [platform.kimi.com](https://platform.kimi.com)。其余三家（火山方舟/阿里云百炼/智谱）待用户提供个人邀请链后按同法替换。
