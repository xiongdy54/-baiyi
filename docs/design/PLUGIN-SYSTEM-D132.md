# 插件/主题体系实现规范（D132，建议版本 v48.89）

> 任务来源：主线盘点项「§4.15 插件/主题体系：插件文件夹结构、主题即插件、`/* @settings */` 可调项、皮肤体系——整套规范未实现（是 M11 的前置）」。本文档为**设计稿**，不含实现；实施按 §11 任务拆解表由总控逐项派发。
>
> 设计依据：`AI_DEVELOPMENT_GUIDE.md` §4.15（概念规范）/ §4.2-4（PluginHost）/ §4.2-16（UI Slots `themeCSS`）/ §3（进程与模块结构）/ §5.5（皮肤体系）/ §7.2（数据完整性）/ §7.5（安全）/ §9.2 M11 行；`docs/swiss-international-style.md`「Token 落地 → 皮肤层」五条边界；`docs/design/READER-PERSONALIZATION-D130.md`（R3，**边界划分见 §1.3**）。
>
> 约束回顾：零网络；零新依赖（YAML 用自研受限子集解析器，§5.4）；零 schema（插件设置走 SettingsStore 既有 `plugin.<id>` 层与 settings.json 既有持久化，不建表）；不破坏 §7.2 持久化纪律（**宿主对插件目录零写入**，§4.6）；§4.15 既定形态（文件夹插件 / versions.json / type:theme / @settings）必须遵守；安全优先、能力最小化。

---

## 1. 现状盘点与边界考据（代码取证）

### 1.1 §4.15 概念规范与代码现状的相容性结论

§4.15 概念与代码现状**无根本冲突**，可在约束内完成实现设计（不需 REFRAME）。概念中每一要素都能落到现有机制上：

| §4.15 概念要素 | 代码现状锚点 | 相容性 |
| --- | --- | --- |
| 插件 = 文件夹 `plugins/<id>/` | Electron `app.getPath("userData")` 既有约定（settings.json / memory/ 同层） | 落 `<userData>/plugins/<id>/`（§4.1 裁定为何不在安装目录） |
| plugin.json + main.js + styles.css + data.json | 无现成物 | 新增清单 schema（§3）；main.js 本期**不执行**（§9.1 裁定） |
| versions.json 版本回落 | 应用版本 `package.json → app.getVersion() = "0.0.1"` | 落兼容性声明校验面（§3.2；真回落属 M11 更新渠道） |
| 主题是 type:theme 特殊插件 | 渲染层 Token 体系完备（theme.css `:root` 浅档 + `body.theme-dark` 深档） | 主题插件 = 整套 Token 覆盖层，注入链见 §6 |
| `/* @settings */` YAML 可调项 | package.json 无 YAML 依赖 | 自研受限子集解析器（§5.4），零新依赖 |
| SettingsStore `plugin.<id>` 层（§4.2-3 预留） | `electron/main.js` 的 `settings:get/set` 对 scope 无白名单（`all[scope][key]=value` 通用写法），`plugin.<id>` 作为字符串 scope **今天就能用**，动态 import eventbus 广播 `settings/changed` 同样通用 | 零新设置通道，复用既有 IPC |
| PluginHost（§4.2-4）/ UI Slots `themeCSS`（§4.2-16） | 均未实现 | 本文 §4 / §6 即其实现设计 |

### 1.2 宿主侧相关现状（事实清单）

- **窗口与安全基线**（`electron/main.js:1848-1877`）：主窗口 `webPreferences = { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }`；`will-navigate` 拦截页面级导航；`setWindowOpenHandler` 仅放行 http(s) 到系统浏览器。渲染层没有 Node 能力，这是本设计一切安全裁定的地基。
- **preload 模式**（`electron/preload.js` / `preload-capture.js`）：`contextBridge.exposeInMainWorld` 按 API 域暴露闭包函数，`ipcRenderer.invoke/on` 封装在内。插件桥必须走同一模式（§4.4）。
- **特权协议先例**（`electron/main.js:190-195`）：`bookasset` / `pdfres` 经 `protocol.registerSchemesAsPrivileged` 注册——**本期不新增协议**（§6.2 方案对比后裁定）。
- **CSP 现状（已实测核对）**：`dist/index.html` **无** CSP meta（grep 计数 0）；全仓仅 `electron/captureOverlay.html` 声明 CSP；`electron/main.js` 无 `onHeadersReceived`/webRequest 头注入。§6.5 给出核对结论与未来耦合注记。
- **设置持久化**（`electron/main.js:233-298` + `electron/settingsStore.js`）：`settings.json` 原子写（tmp+rename，D-TEST-30）；`settings:set` 对部分 `app.*` 键做写侧归一，scope 本身不设限。两份 readSettings（main.js 局部版与 settingsStore.js）长期分叉属既有技术债，本期不合并。
- **主题现状**（`src/App.tsx:124-296` + `src/theme.css`）：亮暗 = `theme.mode` 落 `theme` 层，`body.theme-light/theme-dark` 类切换；皮肤 = `app.skinId` 落 `app` 层 + `src/skins/index.ts` 注册表（仅 `none` 一支）+ `has-skin` body 类；强调色 = `app.accentColor` + `src/lib/accentVar.ts` `applyAccent` **在 body 与 documentElement 上写内联自定义属性**（并按亮度自动翻转 `--accent-on`）。**内联写 body 是本仓已验证的动态主题通道**（v48.14 深色档缺陷修复的结论：声明在 body 上的规则胜过 `:root` 继承），主题插件的变量注入沿用同一纪律（§6.4）。
- **皮肤扩展点现状**（`src/theme.css:92-103,206-267`）：`--shadow-panel` / `--radius` / `--radius-panel` / `--radius-pill` / `--field-line` / `--band-line` 均为已登记扩展点，基线取值即瑞士风默认；深浅两档各自声明（`--shadow-panel` 的 var() 同元素求值教训已在档内注明）。
- **备份范围**（`electron/backup.js:2,204-242`）：备份 = `library.db` + `assets/**` + `settings.json`（ai-config 勾选才含）+ `memory/`（v45 起）。**插件目录不在备份内**——本期裁定维持（§9.4 有意取舍）。
- **EventBus**（`src/lib/eventbus.ts`）：锁定事件含 `theme/changed` / `settings/changed`；插件变更走**新增主进程推送 `plugins:changed`** 渲染层桥接为 EventBus 事件（§4.4），不占用锁定事件名。
- **设置页**（`src/components/SettingsPanel.tsx:92-107,2833-2860`）：D114 后 5 组信息架构；「主题与颜色」= `sec-appearance`（界面组），内部 `h4` 子块：主题模式 / 皮肤 / 强调色。主题插件落位此节（§8），**不新增导航项**（SECTION_GROUPS 契约零改动）。

### 1.3 与 R3（D130，READER-PERSONALIZATION）的边界划分

两文**互相独立、零设置键重叠、零生效层重叠**：

| | R3 自定义主题保存（D130） | 本稿主题插件（D132） |
| --- | --- | --- |
| 本质 | **阅读器内**的外观预设速记本：命名保存一组背景/文字色 | **全局**皮肤/主题体系：整套替换应用 Token |
| 设置键 | `app.readerSettings.customThemes`（`{id,name,bgColor,fgColor,createdAt}[]`，≤12 套） | `app.activeThemePlugin` + `plugin.<id>` 层 `values`（本稿 §4.5） |
| 生效层 | `settings.app.readerSettings.appearance` → 阅读内核 `resolveAppearance` → 阅读器容器与章节 iframe（**只在阅读器内生效**） | `theme.css` Token 层（`--paper` / `--grey-*` / `--accent*` …）→ **全应用生效**（书架/复习/设置/各窗口） |
| 来源 | 应用内置（渲染层设置数据，无文件） | 用户放置于 `<userData>/plugins/` 的文件夹（磁盘内容，经宿主校验） |
| 与皮肤的关系 | 不占用皮肤槽（`app.skinId` / `app.activeThemePlugin` 均不动） | 占用主题槽，与内置皮肤互斥（§7.3） |

本文档 §2 的「不做」清单与 R3 §2.2 互为镜像（R3 不触碰应用皮肤；本稿不触碰 `readerSettings`）。两文互引即边界声明，无重叠键。

---

## 2. 本期范围（做 / 不做）

### 2.1 做（最小完整闭环）

| # | 项 | 说明 |
| --- | --- | --- |
| F1 | 插件清单格式定稿 | plugin.json 全字段 schema、versions.json 规则、type:theme 额外约束（§3） |
| F2 | PluginHost（§4.2-4 兑现） | `electron/pluginCore.js`（纯函数内核）+ `electron/pluginHost.js`（主进程面）：`load/unload/enable/disable + contributes` 映射（§4.3）；出错隔离（§4.7） |
| F3 | 主题插件注入链 | styles.css 校验 → IPC 下发文本 → 渲染层 `<style>` 注入 + `--pl-*` 变量写 body（§6） |
| F4 | `/* @settings */` 可调项 | 受限 YAML 子集解析、类型系统、动态设置页控件、`plugin.<id>` 层读写（§5） |
| F5 | 对比度校验义务 | 亮暗两档 ≥4.5:1 的**机器校验**（宿主拒载 fail-closed，§6.6） |
| F6 | 内置皮肤共存规则 | `src/skins/` 内置皮肤与主题插件的互斥切换（§7） |
| F7 | 设置页 UI | `sec-appearance` 内「主题插件」子块（§8） |
| F8 | 示例夹具 + 测试 | sepia-demo 示例插件（§10）+ node/GUI 测试计划（§12） |

### 2.2 不做（Non-Goals，本期裁定清单）

1. **main.js 不执行**（显式裁定与理由见 §9.1——本稿最重要的安全裁定）。
2. **非 theme 类型插件不加载**：plugin.json `type` 字段取值域本期封闭为 `"theme"`；其他取值在清单中显示可读原因「本期仅支持主题插件」（夹具 not-a-theme 验证）。
3. **不做插件 API 面**：`contributes` 本期仅 `{css, settingsSchema}`；无命令注册、无视图槽位（commandPalette / sidebarView / statusBarWidget / editorSlash / blockMenu 各槽 §4.2-16 保持空置）、无 JS 钩子。
4. **不做插件市场 / 上传渠道 / 签名分发 / API 分发**（M11 范围；§9.4 池已登记「插件市场全量」）。
5. **不做 versions.json 真回落**（回落本体 = 多版本存储 + 更新渠道，M11；本期 versions.json 是兼容性声明校验面，§3.2）。
6. **不做 fs.watch 热重载**：变更以「重新扫描」按钮 + 设置页打开时自动扫描触发。
7. **不做应用内删除插件**：提供「打开插件文件夹」，删除由用户在文件管理器完成，删后重新扫描即消失。
8. **插件目录不入 M2 备份**（§9.4 有意取舍：插件是可重装的外来内容，settings.json 里的启用状态与 `plugin.<id>` 值随既有备份恢复，孤儿值无害——激活指针指向不存在的插件时按 §6.3 回落默认外观，与 `getSkin` 对已删除 id 回落默认皮肤的既有先例同一纪律）。
9. **不引入 CSP**（现状无 CSP，本期注入方式与之兼容；未来耦合注记见 §6.5）。
10. **不做主题插件的多套并存叠加**：同一时刻至多激活一套主题插件（Token 覆盖层的叠序是未定义行为，禁止）。
11. **不改 R3 范围**：`readerSettings` 各键、阅读器内主题下拉、`sec-reader` 区块一律不动（§1.3）。

---

## 3. 插件清单文件格式定稿

### 3.1 plugin.json 全字段 schema

存放于 `<userData>/plugins/<id>/plugin.json`，UTF-8，≤ 64KB。**`id` 必须与所在文件夹名逐字相等**（防清单与目录漂移）。

```jsonc
{
  "id": "sepia-demo",              // 必填。^[a-z0-9][a-z0-9-]{1,31}$（2–32 字符，小写字母/数字/连字符，
                                   //   不得以连字符开头结尾）。与文件夹名不等 → 校验失败。
  "name": "羊皮纸",                 // 必填。展示名，1–40 字符（trim 后）。
  "version": "1.0.0",              // 必填。semver（major.minor.patch，纯数字段）。
  "minAppVersion": "0.0.1",        // 可选。缺省 = "0.0.0"（不设兼容下限）。当前应用版本 < 它 → 拒载。
  "author": "…",                   // 可选。字符串 ≤ 60 字符。
  "description": "…",              // 可选。字符串 ≤ 200 字符。
  "type": "theme",                 // 必填。取值域本期封闭 = "theme"；其他值 → 状态 error（可读原因）。
  "styles": "styles.css",          // type:theme 必填。相对路径，禁止含 ".." 与绝对路径形态；缺省名即 "styles.css"。
  "main": "main.js"                // 预留字段（维持 §4.15 文件夹形态）。本期宿主**不读取、不校验、不执行**（§9.1）。
}
```

规则：未知字段**忽略**（前向兼容）；JSON 解析失败 / 非 / 超限 → 该插件状态 `error` 并带可读原因；文件夹内**其余文件一律不扫描**（本期只认 plugin.json 声明的文件 + 约定存在的 versions.json + data.json）。

### 3.2 versions.json 回落规则（本期语义）

`<userData>/plugins/<id>/versions.json`，可选。格式：`{ "<minAppVersion>": "<pluginVersion>", … }`（键值均为字符串，键为 semver）。

- **本期裁定：versions.json 是兼容性声明校验面与可读错误来源，不做真回落。** 理由：真回落 = 本机保留多版本文件 + 按应用版本挑选加载，其本体是**更新渠道**的事（下载/覆盖/回滚），属 M11 社区渠道范围（§2.2 第 5 条）。本地单副本场景下，可机械执行且诚实的语义是：
  1. 文件不存在 → 合法（无历史记录）。
  2. 存在但非法（非对象 / 键值非字符串）→ **按不存在处理**，不报错（历史附文件损坏不拖累主文件）。
  3. 加载时的唯一用途：当 `plugin.json.minAppVersion` > 当前应用版本而拒载时，错误信息附 `versions.json` 中 **minAppVersion ≤ 当前应用版本的条目里最大的 pluginVersion**（形如「需要应用 ≥ 0.2.0（当前 0.0.1）；versions.json 记录的最近兼容版本为 0.9.0，但本机仅保留一份插件文件，无法回落」）。
  4. 宿主**从不写** versions.json（§4.6 只读纪律）。

### 3.3 type:theme 主题插件的额外字段与约束

- `styles` 指向的 styles.css：≤ 512KB；UTF-8；通过 CSS 校验器（§6.2）与对比度审计（§6.6），任一失败 → **拒载**（fail-closed，原因可读）。
- styles.css 内可含**一个** `/* @settings … */` 注释块声明可调项（§5）；多于一个 → 校验失败。
- 可调项 ≤ 24 个；id 重复 → 校验失败。
- styles.css 可缺省吗？**不可**——type:theme 无 css 即无意义，缺文件按清单校验失败处理。
- data.json：可选。§4.15 形态中的插件自有数据区。本期宿主**只读不解析不消费**；存在但非法 JSON → 校验失败（防止坏文件在将来 API 开放时才炸）；不存在 → 合法。
- main.js：可存在可不存在（§9.1：不读不执行）。

### 3.4 `/* @settings */` YAML 键位与类型系统

**声明位置**：styles.css 首个 `/* @settings` 开头、`*/` 结尾的注释块。**YAML 子集**（自研解析器，零新依赖；与 Obsidian 的 `@settings` 形似但**不承诺兼容**，键位为本文定稿）：

```css
/* @settings
name: 羊皮纸设置
description: 主题插件的对外可调项
settings:
  - id: paper-tint
    name: 纸色
    type: color
    default: "#f4ede1"
    description: 正文与界面底色
  - id: heading-accent
    name: 标题强调色
    type: color
    default: "#8a4b2a"
  - id: radius-panels
    name: 面板圆角
    type: dropdown
    default: "0"
    options:
      - label: 直角
        value: "0"
      - label: 圆角 6px
        value: "6px"
      - label: 圆角 12px
        value: "12px"
  - id: decor-band
    name: 顶部装饰带
    type: toggle
    default: true
  - id: heading-scale
    name: 标题缩放
    type: range
    default: 1.0
    min: 0.8
    max: 1.6
    step: 0.05
*/
```

键位定稿：

| 键 | 适用类型 | 规则 |
| --- | --- | --- |
| `id` | 全部 | 必填，`^[a-z0-9][a-z0-9-]{0,31}$`；全表唯一 |
| `name` | 全部 | 必填，1–40 字符 |
| `type` | 全部 | 必填，枚举 `toggle / range / dropdown / color / text` |
| `default` | 全部 | 必填，类型匹配（toggle=布尔；range/dropdown=数值或数值串；color=`#rgb`/`#rrggbb`；text=字符串） |
| `description` | 全部 | 可选，≤ 200 字符 |
| `min` / `max` / `step` | range | 可选数值；给出时须 `min < max` 且 `0 < step ≤ max-min` |
| `options` | dropdown | 必填于此类型；2–8 项；每项 `label`（1–24 字符）+ `value`（1–24 字符，项间 value 唯一） |

**YAML 子集文法**（解析器实现边界，全部 fail-closed——不认识的形态报错并给出行号，不做猜测式解析）：

- 逐行解析；缩进只允许空格，**Tab 即错误**；顶层键允许 `name` / `description` / `settings`，其他顶层键即错误。
- 列表项形如 `- id: …`（`- ` 后直接跟首键），后续键以更深层缩进 `key: value` 书写；`options` 同法嵌套一层。
- 标量：去除首尾空白后，成对的单/双引号剥除；`true`/`false` 解析为布尔；数值字面量解析为 number。
- **不支持**：锚点/引用、多行标量（`|`/`>`）、流式集合（`[a, b]` / `{k: v}`）、注释（`#` 开头行）、空行容忍（空行跳过）。命中不支持形态 → 解析失败（插件拒载，原因含行号）。
- 数量上限：`settings` 项 ≤ 24；单行 ≤ 200 字符。

**类型系统与 CSS 变量映射**（可调项 → 渲染层生效的唯一通道）：

| type | 值形态（存 `plugin.<id>` 层） | 注入为 CSS 变量 | 设置页控件 |
| --- | --- | --- | --- |
| `toggle` | boolean | `"true"`/`"false"` 字符串 | checkbox |
| `range` | number（宿主按 min/max 钳制） | 数值字符串（无单位——单位由插件 CSS 在使用处自加） | slider（min/max/step 来自 schema） |
| `dropdown` | string（必须 ∈ options.value） | 原样 | select |
| `color` | string `#rgb`/`#rrggbb` | 原样 | color input |
| `text` | string（≤ 100 字符） | 原样 | text input |

变量命名约定：`--pl-<pluginId>-<settingId>`（两段 id 均已过 charset 校验，无注入面）。插件 CSS 消费形如 `var(--pl-sepia-demo-paper-tint, #f4ede1)`——**回退值必须写**，保证宿主未注入值时插件 CSS 独立可用。

---

## 4. PluginHost 实现设计

### 4.1 文件落点与模块拆分

```
electron/
  pluginCore.js      纯函数内核（零 electron 依赖，node 直测）：
                     validateManifest(json, folderName) / readVersionsRule(text) / compareSemver(a,b) /
                     parseSettingsBlock(cssText) / validateAndAuditCss(cssText, settingsSchema) /
                     auditContrast(tokens, modeDefaults) / assembleVars(schema, values) / PLUGINS_DIRNAME
  pluginHost.js      主进程面（require electron）：
                     scan() 扫描 <userData>/plugins/（惰性 + 缓存 + rescan 失效）→ 插件记录表；
                     getActivePayload() / activate(id) / deactivate()；
                     ipcMain 注册 plugins:* 四通道；plugins:changed 多窗口广播
  main.js            仅挂接：require pluginHost + 启动后注册（新增 IPC 计入 §3 清单口径）
```

拆分理由与仓内先例一致：`appLog.js`（D119）证明「纯函数零依赖 electron + 独立 node 测试」的模块可以承载安全关键逻辑；`pluginCore.js` 承载全部校验/解析/审计，是可机械测试的安全面。

### 4.2 插件目录

`<userData>/plugins/`（常量 `PLUGINS_DIRNAME = "plugins"`）。裁定理由：安装目录可能只读（Program Files；electron-builder D133 打包后还有 asar），`userData` 是用户自有可写区且已有 settings.json / memory/ / logs/ 先例。目录不存在 = 空列表（**不自动创建**；仅 `plugins:openFolder` 时 mkdir）。防路径逃逸：目录遍历只取 `fs.readdirSync(root, {withFileTypes:true})` 的一层目录项，`id` 过 charset 校验后再 `path.join(root, id)`；对每项做 `fs.realpathSync` 前缀核对（拒绝符号链接指到 plugins 目录之外）。

### 4.3 生命周期（§4.2-4 接口的落点映射）

| §4.2-4 接口 | 本期落点 | 说明 |
| --- | --- | --- |
| `load` | `scan()`：读取并校验全部插件文件夹 → 内存记录表 `{id → {manifest, settingsSchema, cssText?, status, reason?}}` | 惰性触发：渲染层首次 `plugins:list` 或 `rescan`；css 惰性读取（列表不读 css，激活/下发时读并缓存） |
| `unload` | `rescan()` 对已消失的文件夹清除记录；激活中的插件被删除 → 自动失效 | 失效广播 `plugins:changed`；渲染层回落默认外观（§6.3） |
| `enable` / `disable` | `activate(id)` / `deactivate()`：写 `app.activeThemePlugin`（settings.json `app` 层） | 主题插件的「启用」＝激活为当前主题；「停用」＝清除激活。同时执行与内置皮肤的互斥（§7.3） |
| `contributes` | 记录表内 `{css, settingsSchema}` | 其余 contribute 类型不存在（§2.2 第 3 条） |

激活语义细节：`activate(id)` 时宿主重读并**重新校验**该插件（缓存失效防目录内容在激活间隙被替换）；校验不过 → 返回 `{ok:false, reason}`，激活指针不变。激活成功 → `app.activeThemePlugin = id` + 清 `app.skinId = "none"`（§7.3）→ 广播 `plugins:changed` → 各窗口拉取 `plugins:getActive`。

### 4.4 IPC 面与 preload 桥

新增 4 个 invoke 通道 + 1 个推送（计入 `electron/main.js` IPC 注册清单口径）：

| 通道 | 方向 | 载荷 |
| --- | --- | --- |
| `plugins:list` | 渲染 → 主 | → `[{id,name,version,author,description,type,status:"ok"\|"error",reason?,active,settingsSchema}]`（不含 css） |
| `plugins:getActive` | 渲染 → 主 | → `{id, css, vars:[{key,value}]}` 或 `null`（css 与装配好的 `--pl-*` 变量一次下发） |
| `plugins:setActive` | 渲染 → 主 | `(id: string)`；空串 = 停用；→ `{ok, reason?}` |
| `plugins:openFolder` | 渲染 → 主 | → mkdir（缺则建）+ `shell.openPath` |
| `plugins:changed`（推送） | 主 → 渲染 | 无载荷；渲染层桥接为 EventBus `plugins/changed`（**非** §4.2-1 锁定名，新增事件名） |

preload：`contextBridge.exposeInMainWorld("pluginsAPI", { list, getActive, setActive, openFolder, rescan, onChanged })`，全部闭包封装 `ipcRenderer.invoke/on`，返回退订函数（`onChanged`），与 windowAPI 既有模式逐字同构。`preload-capture.js` 同法加最小子集 `{ getActive, onChanged }`（捕获窗口跟随主题）。

设置值读写**不走新通道**：`settingsStore.get/set("plugin.<id>", "values", …)` 直接用既有 `settingsAPI`（§1.2 已核对通用性）。

### 4.5 与 SettingsStore `plugin.<id>` 层的读写路径

- **唯一键**：每个插件在 `plugin.<id>` scope 下只有一个键 `values`（对象，`{<settingId>: value}`）。不做逐设置项一键——动态键会击穿 F18 的 DOC_KEYS 静态扫描口径（§附录 A.5 给豁免登记文本）。
- **写路径**：设置页控件 → `settingsStore.set("plugin.sepia-demo", "values", nextValues)` → 既有 IPC `settings:set`（scope 无白名单，通用放行）→ settings.json 原子写 → 广播 `settings/changed {scope:"plugin.<id>", key:"values"}`。
- **读路径（生效）**：渲染层应用链（§6.4）每次装配变量时：`values = await settingsAPI.get("plugin.<id>", "values")` → `assembleVars(schema, values)`（缺省合并 default、range 钳制、dropdown 校验 ∈ options、非法丢弃）→ 注入。
- **双侧归一纪律**：主进程 `settings:set` 对 `plugin.*` scope **不做写侧归一**（写侧无法知道各插件 schema，与 R3 D130 同一立场：新增字段可缺省 + 读侧钳制已封闭值域）；读侧归一在 `pluginCore.assembleVars`（宿主装配，激活链）与 `src/lib/themePlugins.ts`（渲染层控件显示，同一套规则镜像）双侧执行。**安全边界在宿主**：`settings:set` 写进来的脏值最多让控件显示异常，生效值恒过 `assembleVars` 钳制。
- settings.json 随 M2 备份 → `plugin.<id>` 值天然随备份走（插件文件夹本身不备份，§2.2 第 8 条）。

### 4.6 宿主只读纪律（§7.2 零负担声明）

**宿主对 `<userData>/plugins/` 内的一切文件零写入**。本设计不新增任何 §7.2 需登记的写路径：插件设置走 settings.json 既有原子写；插件文件夹是用户自管的只读内容区。versions.json 不由宿主追加（§3.2）；data.json 不由宿主消费或回写（§3.3）。

### 4.7 出错隔离（坏插件不拖垮主进程）

| 层 | 隔离手段 |
| --- | --- |
| 扫描 | 每个文件夹独立 try/catch → 记录为 `status:"error"` 条目（含可读 reason），继续扫其余；整体扫描再包一层；**启动主流程不调用扫描**（惰性，首拉才扫），插件目录整体损坏不可能阻塞启动 |
| 清单 | JSON.parse + schema 全在 `validateManifest` 纯函数内，异常 → error 条目 |
| css | 读取/校验/审计全 try/catch；激活时校验失败 → 返回 `{ok:false,reason}`，指针不变 |
| IPC | `plugins:*` handler 对插件内容错误**返回状态载荷而不 throw**；仅参数类型滥用 throw（调用方契约错误） |
| 文件竞态 | 激活/下发时文件消失（ENOENT）→ 可读错误，记录表标失效并广播 |
| 渲染层 | 注入链 try/catch（§6.4）；最坏情形 = 一段已通过校验的 css 把界面画得难看，不存在脚本执行面（§9.1 裁定消灭） |
| 无代码执行 | main.js 不执行 + 渲染层不收 JS——**结构性消灭**任意代码风险，而非运行时拦截 |

---

## 5. `/* @settings */` 可调项端到端

### 5.1 解析（宿主侧）

`pluginCore.parseSettingsBlock(cssText)`：提取首个 `/* @settings` 注释块 → 逐行按 §3.4 文法解析 → 输出 schema（数组）。解析失败 = 插件校验失败（reason 含行号）。纯函数，夹具矩阵直测（§12.1）。

### 5.2 值存储（`plugin.<id>` 层）

见 §4.5。控件改动即时落 `settingsStore.set`，即触发既有 `settings/changed` 广播。

### 5.3 值生效（变量装配与下发）

`plugins:getActive` 返回的 `vars` = `assembleVars(schema, values)` 输出：每项 `{key: "<settingId>", value: <归一后字符串>}`。渲染层写成 `--pl-<pluginId>-<settingId>` 内联自定义属性（§6.4）。**改动即时生效路径**：控件 set → `settings/changed`（scope `plugin.<id>`）→ 渲染层应用链重拉 `plugins:getActive` → 重写变量。变量写 body 内联样式，改值无需重注入 css。

### 5.4 零依赖裁定（YAML）

package.json 现无 YAML 库；引入 js-yaml 等违反本批「零新依赖」约束，且完整 YAML 的攻击面（别名递归、多形态标量）远超需求。**裁定：自研受限子集解析器**（§3.4 文法 ≈ 100 行纯函数），解析失败一律拒载。子集覆盖本文全部用例（§3.4 示例 + §10 夹具），任何超出子集的主题 = 拒载并给出可读原因——作者可改写，成本一次性。

---

## 6. 主题插件注入链（styles.css → 渲染层）

### 6.1 全链路

```
激活（plugins:setActive）
  └ 宿主：重读 styles.css → validateAndAuditCss（§6.2/§6.6）→ 失败拒载
        → 内存缓存 {cssText}
下发（plugins:getActive）
  └ 宿主：{id, css, vars}（vars = assembleVars，§5.3）一次返回
应用（渲染层 src/lib/themePlugins.ts applyThemePlugin(payload)）
  ├ 移除旧 <style data-plugin-css>（若有）
  ├ <style data-plugin-css="<id>"> 建元素 → textContent = css → append head
  │    （textContent 赋值 = 纯文本节点，无 HTML 解析面）
  ├ 变量：清旧前缀 --pl-<oldId>-* → body 与 documentElement 内联写入 --pl-<id>-<key>（vars 全量）
  └ try/catch：失败 console + logsAPI.report（fire-and-forget），界面回落默认外观
停用（setActive("")）→ 移除 style 元素 + 清变量 → 回落 theme.css 基线
```

### 6.2 CSS 校验器（fail-closed，全部拒载而非静默剥离）

`validateAndAuditCss(cssText, settingsSchema)` 纯函数，规则定稿：

1. 字节数 ≤ 512KB（超限拒载）。
2. 扫描前先剥除 `/* */` 注释（@settings 块除外）得 scan 副本，注释内出现的禁忌串不算违规（作者可能在注释里写示例）。
3. **禁忌构造**（scan 副本上检测，命中即拒载并给出行号）：
   - `@import`（任意大小写）——零网络红线的静态入口，连相对路径一并禁止（相对 URL 会解析到应用自身 origin，语义混乱且无正当用例）。
   - `url(...)` 中除 `data:image/` 开头的任何取值——即仅允许内嵌 data 图（纹理/噪点等自包含资源）；`http(s):`、`file:`、`javascript:`、相对路径全部拒绝。
   - `image-set()` / `-webkit-image-set()` / `src()`（任意大小写）——三者都接受**字符串形式的 URL**（不经 `url()`），可绕过 url() 规则发起网络请求（C-44）；Token 覆盖层没有正当用例，一律拒绝（fail-closed）。
   - 任意位置的 `javascript:`。
   - `position: fixed` **不禁**（玻璃面板等皮肤 legitimately 用得到；UI 伪装残余风险见 §9.2 表）。
4. **选择器形态**：Token 覆盖块的顶层选择器仅允许单选择器 `:root`、`html`、`body`、`body.theme-light`、`body.theme-dark`（含逗号的组合选择器 → 拒载：组合选择器让档位归属无法静态判定）。其余选择器（组件级微调）不在此限、不受审计。
5. **受审计 Token 的值形态**：字面 `#rgb`/`#rrggbb`，或 `var(--pl-<本插件id>-<settingId>, #hex)`（回退必须字面 hex）。引用其他 var / color-mix / 命名色 → 拒载（对比度审计需要可计算值；派生 Token 的 color-mix 纪律见 swiss「派生 Token 必须与依赖同层」，插件沿用）。

### 6.3 生效模型与回落

- 插件 css 的浅档 Token 声明在 `body`（或 `:root`），深档声明在 `body.theme-dark`——与 theme.css 的档位结构同构，特异性链 `body.theme-dark > body > :root` 保证亮暗互不越档（swiss 深色档纪律：显形值声明在 body 上）。
- `--pl-*` 变量写在 body **内联**（最高优先级），但它们只作为插件 css 内 `var()` 的取值源；插件深档块用字面值重新声明 Token 时，深档不消费浅档的设置变量——设置值只影响作者把它接进的那一档（双档创作契约，§10 夹具演示）。
- **回落**：激活插件被删除 / 校验失败 / 注入异常 → 移除 style + 清变量 → 界面回到 theme.css 基线（默认瑞士风）。与 `getSkin` 对已删除 id 回落默认皮肤同一纪律（App.tsx:262-272 注释明文）。

### 6.4 渲染层落点

- 新文件 `src/lib/themePlugins.ts`：`useThemePlugin()` hook（订阅 EventBus `plugins/changed` + `settings/changed` scope 前缀 `plugin.`，重拉 `plugins:getActive` 并应用）+ `applyThemePlugin()` + `removeThemePlugin()`。App.tsx 顶层级调用一次；`src/capture.tsx` 与 `src/workbench.tsx` 各调用一次（同一模块，多窗口一致）。
- 多窗口推送：主进程 `plugins:changed` 用既有 `sendToMainWindow` 模式逐窗发送（含捕获/制卡台窗口）；无桥的窗口自然忽略。

### 6.5 CSP 核对结论

- **现状**：应用页面（dist/index.html）无 CSP meta（实测 grep=0），无响应头注入。`<style>` 元素注入在现状下**直接可用**，本设计不因 CSP 增加任何机制。
- **未来耦合注记**（登记给将来引入 CSP 的批次）：插件 css 走 `<style>` 内联 → 届时 `style-src` 必须包含 `'unsafe-inline'` 或为插件样式开 nonce 通道；`data:` 图片需 `img-src data:`。本链路对两种方案均兼容（文本已在校验器内封闭，不存在远程资源引用），届时仅需 CSP 侧放行，插件链零改动。
- 渲染进程 `contextIsolation: true, nodeIntegration: false` 现状不变——本设计**不新增任何 webPreferences 放宽**，不新增特权协议（styles 不走 `pluginres://`，走宿主读取 + 文本下发：少一个协议面，且校验天然在文本通道上完成）。

### 6.6 亮暗对比 ≥4.5:1 的校验义务（机器执行）

`auditContrast` 在宿主加载时执行，**不过即拒载**（fail-closed；理由：可读性是本仓无障碍硬底线，swiss 皮肤层第 5 条明文）：

- **审计对象**：插件 css 各档块（§6.2 第 4 条的档位选择器）内声明的受审计 Token：`--paper`、`--ink`、`--text-primary`、`--text-secondary`、`--accent`、`--accent-on`。插件未声明的受审计 Token 取该档基线默认（浅：paper `#fafaf8` / ink `#0a0a0a` / text-secondary `#525252` / accent `#166a59` / accent-on `#ffffff`；深：paper `#101010` / ink `#f5f5f2` / text-secondary `#b5b5b0` / accent `#3fa08a` / accent-on `#0a0a0a`——即 theme.css `:root` / `body.theme-dark` 现值）。`--text-primary` 未声明时以 `--ink` 代（theme.css 中前者即 var(--ink)）。
- **只审计被触碰的档**：插件只声明 `body.theme-dark` 块 → 只审计深档（浅档未被改动，基线天然达标）。
- **断言集**（WCAG 相对亮度公式，与 `src/lib/accentVar.ts` relLum 同式，port 进 pluginCore）：每档 `ink_eff vs paper_eff ≥ 4.5`、`text-secondary_eff vs paper_eff ≥ 4.5`、`accent_eff vs paper_eff ≥ 4.5`、`accent-on_eff vs accent_eff ≥ 4.5`。
- **配对规则**：声明 `--accent` 的块必须同块声明 `--accent-on`（swiss 皮肤层第 5 条），否则拒载。
- **值域来源**：字面 hex 或设置变量回退 hex（§6.2 第 5 条）——审计的是**默认值**；用户经 @settings 改色后的运行时对比度不做宿主拦截（与应用强调色「任意选色 + 亮度自动翻转反白档」同一取舍，残余风险登记 §9.2）。
- 失败信息带每对的实际比值（如「accent-on #b0b0b0 对 accent #8a4b2a = 2.31:1 < 4.5:1」），作者可据此修色。
- 测试义务：夹具 `sepia-demo` 全对通过（已预计算：浅档 11.15 / 5.78 / 6.73 / 7.29，深档 13.19 / 7.54 / 7.54 / 7.41）；`broken-theme` 夹具构造 accent-on 对比 2.31:1 断言拒载（§12.1 矩阵）。

---

## 7. 内置皮肤体系（§5.5）与主题插件的关系界定

### 7.1 两条独立供给线

| | 内置皮肤 | 主题插件 |
| --- | --- | --- |
| 来源 | 随应用发行：`src/skins/index.ts` 注册表（`SkinDef{id,name,component,props,bodyClass}`）+ 皮肤 Token 块（theme.css 或 `src/skins/<id>/` 专属样式文件，随构建打包） | 用户放入 `<userData>/plugins/<id>/` 的磁盘内容，宿主运行时校验 |
| 质量 | 代码评审门禁（swiss 皮肤层五条边界 + §7.3 测试义务逐条人工核对） | 机器校验门禁（清单 schema + CSS 校验器 + 对比度审计，§6），结构规则类边界只写进创作指引（§10），不做人工审查 |
| 注册 | 构建期静态（SKINS 数组） | 运行时扫描（plugins:list） |
| 槽位 | `app.skinId` | `app.activeThemePlugin` |
| 渲染钩子 | `has-skin` body 类 + `SkinDef.component`（组件层，本期仅 none=null） | `<style data-plugin-css>` + `--pl-*` 内联变量（纯 Token 覆盖层，**无组件层**——插件不能带 React 组件/JS） |

### 7.2 共同纪律

两者同为「整套替换 Token」层，同受 `docs/swiss-international-style.md` 皮肤层五条边界约束：Token 块 + 极少量只引用 `var(--…)` 的结构规则；自带色注册 `--skin-*`；换纸色整组换灰阶；圆角/阴影走 `--radius*`/`--shadow-panel`；改 `--accent` 必带 `--accent-on` 并实测 ≥4.5:1。区别只在执行方式：内置皮肤靠评审，插件靠 §6 的机器校验子集（accent 配对 + 数值审计）+ 创作指引。

### 7.3 共存与切换规则（互斥）

主题插件与内置皮肤都是 Token 覆盖层，叠加则叠序未定义——**裁定互斥**：

1. 激活主题插件（`plugins:setActive(id)`）→ 宿主同时写 `app.skinId = "none"`；渲染层 `has-skin` 随解析后的 skinId 自动摘除（既有 effect，App.tsx:262-272）。
2. 用户选择非 `none` 内置皮肤（设置页「皮肤」区）→ UI 层同时调 `plugins:setActive("")` 清插件激活。
3. 状态判定唯一口径：`getActive` 非 null = 主题插件在管；否则按 `app.skinId` 走内置皮肤链。两个槽位不允许同时非默认值——由上述两处写入点保证，node 纯函数 `nextAppearanceState`（pluginCore 内，接收当前两槽 + 一次动作 → 输出两槽新值）单测锁定互斥矩阵。
4. 设置页两区相邻展示，激活态互显（§8），保证「现在谁在管外观」一眼可判。

---

## 8. 设置页 UI（D114 架构内落位）

### 8.1 落位

`sec-appearance`（界面组「主题与颜色」，SettingsPanel.tsx:2833）内部新增 `<h4>主题插件</h4>` 子块，位于「皮肤」与「强调色」之间。**不新增 SECTION_GROUPS 导航项**（D114 的 5 组 15 项契约零改动），不新增 sec-* 锚（子块在 sec-appearance 内，无直达需求）。

### 8.2 内容结构

```
主题与颜色（sec-appearance，既有）
  主题模式  [浅色|深色]                （既有）
  皮肤      [默认（纯色）]             （既有，SKINS 注册表）
  ── 主题插件 ──                        ★新增 h4 子块
  form-hint：主题插件来自 userData/plugins/ 文件夹，本期仅支持主题（type:theme）。
  [插件行] 羊皮纸  v1.0.0  某作者        data-plugin-item="sepia-demo"
           状态：已激活 / [启用]        data-plugin-activate / data-plugin-deactivate
           ▸ 可调项（展开 @settings 控件）data-plugin-settings
              [纸色  ■]                data-plugin-setting="sepia-demo:paper-tint"
              [面板圆角 ▾]             data-plugin-setting="sepia-demo:radius-panels"
              …（toggle→checkbox / range→slider / dropdown→select / color→色块 / text→输入框）
  [插件行·错误态] broken-theme          状态文案用 --error：校验失败原因（含对比度比值）
           [启用] 禁用态 + title=原因
  [打开插件文件夹]  [重新扫描]          data-plugin-open-folder / data-plugin-rescan
  强调色  …                            （既有）
```

规则：启用/停用为文字钮（swiss 按钮语言，非 accent 填充）；错误原因整行 Meta 档 `--error` 文字；控件行沿用 `.settings-row` 网格；全部设置键读写经 `settingsStore`（scope `plugin.<id>`，key `values`）即时生效（§5.3 链）；无「卸载」钮（§2.2 第 7 条）。

### 8.3 互斥接线

`onSkinChange(id)`（非 none）内部追加 `void pluginsApi.setActive("")`；插件「启用」成功后由 `plugins:changed` 驱动 UI 刷新，skin 列表选中态因 `app.skinId` 已被宿主写回 `none` 而自动回落——两处均无手工同步状态。

---

## 9. 安全分析

### 9.1 main.js 执行边界裁定

**裁定：本期插件代码一律不执行。main.js 既不加载进主进程，也不注入渲染层；type:theme 之外的一切类型拒载。**

理由（对照 Electron 现状逐条）：

1. **无隔离基础设施**。主进程插件 JS = 完整 Node 权限（fs/net/child_process/加密材料所在），Electron 无现成的权限代理层；utilityProcess/沙箱子进程方案需要全新 IPC 面与 API 设计，是 M11 级工程，不是本期最小单元。
2. **渲染层同样无安全落点**。`contextIsolation: true` 保护的是应用不被页面逃逸，反向让第三方 JS 进渲染层需要给它造 preload 或放宽 webPreferences——任一都是把 `window.settingsAPI` 等全部既有桥的攻击面交给插件代码，违背能力最小化。
3. **本期用例不需要代码**。主题插件的全部价值 = Token 覆盖 + 可调项，纯声明式即可完整交付（§6/§5）；「插件能做事」的真实需求（命令/视图/钩子）对应 §4.2-16 其余 UI Slots，属 M11 后的 API 面设计，须另立契约。
4. **维持 §4.15 形态零损失**。文件夹内保留 main.js 位置（schema 预留 `main` 字段，宿主不读不执行），未来开放执行时清单格式不变，存量主题插件零迁移。

### 9.2 安全分析表（能力 / 风险 / 缓解）

| # | 能力面 | 风险 | 缓解 | 残余风险 |
| --- | --- | --- | --- | --- |
| S1 | 文件夹扫描 | 路径逃逸（`../`、符号链接把读取面引出 plugins 目录） | id charset 校验 + 目录名逐字相等 + `realpath` 前缀核对（§4.2）；清单内相对路径禁 `..`（§3.1） | 无已知残余 |
| S2 | 清单/数据解析 | JSON 炸弹、超长字段 | 64KB 上限 + 字段长度上限 + 非 theme 拒载（§3.1/3.3） | 无 |
| S3 | styles.css 注入 | **网络外呼**（@import / url(http) / image-set() 等字符串 URL 打破零网络红线） | fail-closed 校验器（§6.2 规则 3）：@import 全禁、url() 仅 data:image、image-set()/src() 全禁（C-44） | 无（静态可判定） |
| S4 | styles.css 注入 | 脚本执行（javascript: URI 等） | 同上 + `javascript:` 全文禁；Chromium 现代版 CSS 本已不执行脚本，此条为纵深 | 无 |
| S5 | styles.css 注入 | **UI 伪装**（position:fixed 全屏覆盖层仿造登录框钓 AI Key 等敏感输入） | 结构上不执行脚本、无网络可回传；主题是用户自装内容（威胁模型 = 用户给自己机器装样式，与装任何 userstyle 同级） | **接受并登记**：本机伪装面存在；缓解靠 M11 签名/来源机制（不在本期） |
| S6 | styles.css 注入 | 属性选择器 + url() 逐字符外传（CSS exfiltration） | url() 已仅剩 data:image，image-set()/src() 亦全禁（C-44，字符串 URL 同样无远端可收） | 无网络出口即无外传通道 |
| S7 | @settings 解析 | 解析器被畸形输入打挂（ReDoS/深递归） | 受限文法逐行解析、无回溯正则、行数/行长/项数上限（§3.4）；解析在宿主、失败即拒载 | 无 |
| S8 | 设置值写路径 | 脏值直写 CSS 变量（`var()` 注入恶意值串） | `assembleVars` 类型钳制：color 必须过 `#rgb/#rrggbb`、range 数值钳制、dropdown ∈ options、text ≤100 字符（§4.5/§3.4）；注入 body 的只有归一后标量 | 无 |
| S9 | IPC 面 | 渲染层借 plugins:* 做任意文件读写 | 四通道无路径参数（openFolder 打开固定目录）；读面只限 plugins 目录一层 | 无 |
| S10 | 对比度 | 插件默认值低对比伤可读性 | §6.6 机器审计，不过拒载 | 无 |
| S11 | 对比度 | 用户经 @settings 把色改到低对比 | 运行时不拦截（与应用强调色任意选色同一取舍，§6.6） | 接受；UI 控件 description 可写引导 |
| S12 | 资源滥用 | data 图膨胀 / 无限动画拖慢渲染 | css 总量 512KB 封顶；动画不做限制（用户自装内容的自担面，卸载即消失） | 接受 |

### 9.3 「本期不做」能力封闭清单（对将来开放执行的守门）

开放 main.js 执行前，以下每一项都需要先立契约：插件 API 面（§2.2 第 3 条）、进程归属（utilityProcess 沙箱或独立渲染进程）、权限清单与 consent UI、签名/来源（M11）、卸载清理语义。本稿的清单 schema（`main` 字段预留）与文件夹形态为此保持不变。

### 9.4 有意取舍登记

- **插件目录不入 M2 备份**（§2.2 第 8 条）：外来内容可重装，入包徒增体积与「备份里带着第三方代码」的语义负担；启用状态与设置值随 settings.json 恢复，孤儿值无害（§6.3 回落）。
- **不引 CSP**（§6.5）：现状零 CSP，本期注入方式兼容；引入 CSP 是独立加固批次的事，届时插件链零改动。

---

## 10. 示例主题插件（验收夹具，完整内容）

落盘 `tests/fixtures/plugins/sepia-demo/`（4 文件；GUI 测试复制进临时 userData）。全部数值已按 §6.6 公式预验（比值见括号）。

### 10.1 `plugin.json`

```json
{
  "id": "sepia-demo",
  "name": "羊皮纸（示例）",
  "version": "1.0.0",
  "minAppVersion": "0.0.1",
  "author": "本仓库",
  "description": "最小可用的 type:theme 示例：双档 Token 覆盖 + @settings 可调项。作验收夹具与创作模板。",
  "type": "theme",
  "styles": "styles.css",
  "main": "main.js"
}
```

### 10.2 `styles.css`（含 @settings 块）

```css
/* @settings
name: 羊皮纸设置
description: 示例主题的对外可调项
settings:
  - id: paper-tint
    name: 纸色
    type: color
    default: "#f4ede1"
  - id: heading-accent
    name: 标题强调色
    type: color
    default: "#8a4b2a"
  - id: radius-panels
    name: 面板圆角
    type: dropdown
    default: "0"
    options:
      - label: 直角
        value: "0"
      - label: 圆角 6px
        value: "6px"
*/
/* 羊皮纸示例主题 —— 浅档声明在 body（胜 :root、让 body.theme-dark），
   深档字面重声明（双档创作契约：设置变量只接进被触碰的档）。
   受审计 Token 全部为字面 hex 或 var(--pl-sepia-demo-*, #hex) 形态（§6.2 规则 5）。 */
body {
  --paper: var(--pl-sepia-demo-paper-tint, #f4ede1);
  --grey-1: #ece2d0;
  --grey-2: #d8c9b0;
  --grey-3: #8a7a62;
  --ink: #3b2f24;                       /* 对 paper-tint 默认 11.15:1 */
  --text-secondary: #5a4a3a;            /* 7.29:1 */
  --border-subtle: #ddd0ba;
  --border-strong: #b0a084;
  --accent: var(--pl-sepia-demo-heading-accent, #8a4b2a);   /* 对纸色 5.78:1 */
  --accent-on: #ffffff;                 /* 对 accent 6.73:1 */
  --radius-panel: var(--pl-sepia-demo-radius-panels, 0);
  --shadow-panel: 0 8px 24px rgba(58, 44, 30, 0.16);
  --band-line: #ddd0ba;
}
body.theme-dark {
  --paper: #1f1a15;
  --grey-1: #2a241d;
  --grey-2: #3d352a;
  --grey-3: #96876f;
  --ink: #e8e0d5;                       /* 13.19:1 */
  --text-secondary: #b5a897;            /* 7.41:1 */
  --border-subtle: #33291f;
  --border-strong: #55483a;
  --accent: #d9a066;                    /* 7.54:1 */
  --accent-on: #1f1a15;                 /* 7.54:1 */
  --accent-soft: color-mix(in srgb, var(--accent) 16%, transparent);
  --shadow-panel: 0 8px 24px rgba(0, 0, 0, 0.5);
}
body {
  background: var(--paper);
  color: var(--ink);
}
```

### 10.3 `versions.json`

```json
{ "0.0.1": "1.0.0" }
```

### 10.4 `main.js`（**宿主从不执行**——存在只为演示 §4.15 文件夹形态的容错）

```js
// 本文件在宿主中从不执行（D132 §9.1 裁定）。未来开放插件执行时将承载 API 钩子。
module.exports = {};
```

### 10.5 反例夹具（测试用，不入示例包）

- `tests/fixtures/plugins/broken-theme/`：plugin.json 合法（type:theme），styles.css 在 `body` 块声明 `--accent: #8a4b2a; --accent-on: #b0b0b0;`（accent-on 对 accent = 2.31:1 < 4.5）→ 断言拒载原因含比值。
- `tests/fixtures/plugins/not-a-theme/`：plugin.json `"type": "widget"` → 断言可读原因「本期仅支持主题插件」。
- `tests/fixtures/plugins/remote-css/`：styles.css 含 `@import url("https://example.com/x.css");` → 断言拒载（零网络守卫）。

---

## 11. 任务拆解表（总控逐项派发；核心域改动完成后经 code-reviewer 审查）

| 任务 | 内容 | 涉及文件 | 验收标准（可机械检查） | 依赖 |
| --- | --- | --- | --- | --- |
| T1 | 纯函数内核：validateManifest / readVersionsRule / compareSemver / parseSettingsBlock / validateAndAuditCss / auditContrast / assembleVars / nextAppearanceState（互斥矩阵） | `electron/pluginCore.js`（新） | `node tests/pluginhost.test.cjs` 全绿（§12.1 矩阵）；零 electron require（grep 可查）；`tsc --noEmit` 0 | — |
| T2 | 主进程面：scan 缓存 + `plugins:list/getActive/setActive/openFolder/rescan` 四 handler + `plugins:changed` 多窗广播 + 激活互斥写 skinId；main.js 挂接 | `electron/pluginHost.js`（新）、`electron/main.js`（挂接段） | `npx electron tests/pluginhost.electron.test.cjs`（§12.1 第 11 节）全绿：坏插件在场启动不崩、list 返回 error 条目、激活返回 ok/reason 正确；IPC 注册数清单同步 | T1 |
| T3 | 渲染层链路：pluginsAPI 桥（主窗）+ 最小子集桥（capture）+ `themePlugins.ts` 应用/清除 + App/capture/workbench 接线 + EventBus `plugins/changed` 桥 | `electron/preload.js`、`electron/preload-capture.js`、`src/lib/themePlugins.ts`（新）、`src/App.tsx`、`src/capture.tsx`、`src/workbench.tsx` | `tsc --noEmit` 0 + `npm run build` 成功；重启不丢激活态（GUI H 组）；`style[data-plugin-css]` 与 `--pl-*` 探针可查 | T2 |
| T4 | 设置页 UI：sec-appearance「主题插件」子块 + 五类动态控件 + 错误态 + 两钮 + 互斥接线 | `src/components/SettingsPanel.tsx`、`src/theme.css`（子块样式） | `tsc --noEmit` 0 + build 成功；SECTION_GROUPS 零 diff（grep）；GUI B/C/D 组断言全绿；新样式零硬编码色值（走 Token，grep 审查） | T3 |
| T5 | 夹具：sepia-demo + 三反例夹具落 `tests/fixtures/plugins/`；GUI 套件 `tests/plugins.gui.mjs` | `tests/fixtures/plugins/**`（新）、`tests/plugins.gui.mjs`（新） | §12.2 断言清单全绿（`node tests/plugins.gui.mjs`，M7_TEST_USERDATA 隔离，自启自关） | T1–T4 |
| T6 | GUIDE 登记块逐字落地（附录 A 全部文本：版本号 v48.89、§8.1 D132 行、§4.15 重写、§4.2-4 状态、§9.2 新行、§7.4 plugin 层登记与 F18 豁免） | `AI_DEVELOPMENT_GUIDE.md` | f11 / f18 / f20 / f21 / f24 / f27 闸门全绿 | T5 全绿后 |

派发顺序：T1 → T2 → T3 → T4 → T5 → T6。T1/T2 属核心域（Electron 主进程 + 安全面），实施后必须经 `code-reviewer` 审查。

---

## 12. 测试计划

### 12.1 node（`@runtime node` 直跑；`tests/pluginhost.test.cjs` 新建）

1. **清单矩阵**：缺 id/name/version/type 各拒；id 非法字符 / 与文件夹名不等拒；type=widget 拒且原因可读；未知字段忽略；main 字段无副作用（含 main.js 的插件与不含者记录等价）；字段超长拒；64KB 超限拒。
2. **versions.json**：缺省合法；非法（数组/标量/值非串）按不存在处理；键含合法与非法混排时取「minAppVersion ≤ 当前」中最大 pluginVersion 作错误提示。
3. **compareSemver**：等/大于/小于/位数不齐/非数字段拒。
4. **@settings 解析**：正常块解析；引号剥除；Tab 缩进报错含行号；流式 `[...]` 报错；锚点报错；未知 type 报错；缺 default 报错；id 重复报错；>24 项报错；range min/max/step 关系非法报错；options value 重复报错；color default 非 hex 报错。
5. **CSS 校验器**：@import 拒（http/相对/大小写各一）；url(http) 拒；url(javascript:) 拒；url(data:image/png;base64,…) 过；注释内禁忌串忽略；组合选择器拒；受审计 Token 用 var(--pl-外部前缀) 拒；512KB 超限拒。
6. **对比度审计**：sepia-demo 全对过（断言比值 ≥4.5 且与 §10 预计算一致）；broken-theme 拒且信息含 2.31:1；只声明深档时浅档不审计（构造用例）；accent 缺 accent-on 拒。
7. **assembleVars**：缺省合并 default；range 越界钳制；dropdown 非法值丢弃取 default；text 截 100；脏类型（对象/数组）丢弃。
8. **nextAppearanceState 互斥矩阵**：activate 插件 → skinId 归 none；选皮肤 → 插件激活清空；两者已互斥时重复动作幂等。

### 12.2 electron 与 GUI

- **electron 段**（`tests/pluginhost.electron.test.cjs` 或并入上文件第 11 节，仿 `applog.test.cjs` 第 11 节 spawn 模式，无 dist 跳过）：`M7_TEST_USERDATA` 指向预置坏插件的临时目录 → 启动 → `plugins:list` 经 bridge 可查、含 error 条目与原因 → 进程存活 → `plugins:setActive` 拒载路径返回 `{ok:false}` → 退出码 0。
- **GUI 套件**（`tests/plugins.gui.mjs` 新建；CDP 自启自关；`M7_TEST_USERDATA → tests/tmp-plugins-userdata`；启动前把 sepia-demo 与三个反例夹具复制进临时 `plugins/`；跑前 `npm run build`）：

| 组 | 断言要点 |
| --- | --- |
| A 列表 | 设置页 sec-appearance 出现「主题插件」区；sepia-demo 行在场（name/version）；not-a-theme 行显示「本期仅支持主题插件」；broken-theme 行显示含比值的拒载原因 |
| B 激活 | 点启用 → `document.head` 出现 `style[data-plugin-css="sepia-demo"]`；`getComputedStyle(document.body).getPropertyValue("--paper")` 变为夹具浅档值；重启应用后仍激活（**重启不丢** §7.1.4） |
| C 可调项 | 改 paper-tint 色 → body 内联 `--pl-sepia-demo-paper-tint` 即时变化 → computed `--paper` 跟随；radius-panels 选 6px → `--pl-…-radius-panels`="6px"；值写入 settings.json 的 `plugin.sepia-demo.values`；重启后控件值与生效值一致 |
| D 互斥 | 激活插件 → `body.has-skin` false 且 `app.skinId` 回 "none"（读 settingsAPI）；停用插件 → computed `--paper` 回 theme.css 基线 #fafaf8 |
| E 错误隔离 | remote-css / broken-theme 激活被拒 → 激活态不变、界面不变、控制台零未捕获错误（套件既有过滤口径） |
| F 亮暗两档 | 插件激活下切深色 → computed `--paper` = 夹具深档 #1f1a15、`--accent` = #d9a066（深档字面重声明不被浅档设置变量污染） |
| G 探针回归 | `data-plugin-item/activate/deactivate/setting/open-folder/rescan` 全部在场可点 |
| H 多窗口 | 打开捕获窗口 → 其 document 存在 `style[data-plugin-css]`（若 T3 捕获段交付；未交付则本组标注 Not verified 并入后续批） |
| I 回归 | `tests/accent.gui.mjs` 全绿（applyAccent 内联与 `--pl-*` 内联共存）；`tests/m12.gui.mjs`（SettingsPanel 改动的直达锚点回归）；`tsc --noEmit` 0；`npm run build` 成功 |

---

## 13. 风险清单

| # | 风险 | 处置 |
| --- | --- | --- |
| R1 | 自研 YAML 子集与潜在主题作者的书写习惯不匹配（Obsidian 兼容主题抄过来即拒载） | 显式不承诺兼容（§3.4）；拒载信息含行号可自修；M11 若上渠道再评估解析器扩展，本期零依赖红线不动 |
| R2 | fail-closed 校验器误伤合理创作（如组合选择器、相对 url 引用包内资源） | 包内相对资源本期无解析通道（styles 不走协议，§6.5），拒绝是诚实语义而非限制；组合选择器场景在双档创作契约下无必要；误伤案例出现时按 §3.4 文法显式扩条目并同步测试矩阵 |
| R3 | UI 伪装残余风险（S5） | 本期接受并登记（§9.2）；M11 的来源/签名机制是既定后续，不预支 |
| R4 | `--pl-*` 内联变量与 `applyAccent` 内联变量共存次序 | 两者写不同前缀的自定义属性，互不覆盖；accent.gui 回归（GUI I 组）锁定 |
| R5 | settings.json 两份 readSettings 分叉（既有技术债）遇上 plugin scope | 本期读写都走 main.js 侧 settings:get/set 单一入口，不触碰 settingsStore.js 侧；分叉合并另立批次 |
| R6 | F18 动态 scope 豁免文本落地遗漏 → 闸门误报 | 附录 A.5 给出逐字文本；T6 以 f18 实跑为验收 |
| R7 | 插件激活态指向被删插件（用户手删文件夹后重启） | scan 失效 + 渲染层回落基线（§6.3），与 getSkin 先例同纪律；GUI B 组含重启断言 |

---

## 附录 A：GUIDE 登记块（建议文本，实施批 T6 逐字落地）

### A.1 版本号

**v48.89**（v48.85=M13 D129、v48.86=electron-builder D133、v48.87=R3 D130、v48.88=官网 D131 已按落库顺序预留；若顺序有变由总控顺延调整，D 编号不变）。

### A.2 §8.1 决策日志新增行（D132）

```markdown
| D132 | **v48.89 插件/主题体系实现规范定稿（设计 `docs/design/PLUGIN-SYSTEM-D132.md`；§4.15 概念不变，实现按稿）**：① **清单定稿**——`<userData>/plugins/<id>/`（plugin.json 全字段 schema + styles.css + 可选 versions.json/data.json/main.js 预留），id 与文件夹名逐字相等，versions.json 本期=兼容性声明校验面（真回落属 M11 更新渠道）；② **PluginHost 落地设计**——`electron/pluginCore.js`（纯函数校验/解析/审计内核）+ `electron/pluginHost.js`（scan/activate + `plugins:list/getActive/setActive/openFolder/rescan` + `plugins:changed` 推送），§4.2-4 load/unload/enable/disable+contributes 映射其中，出错隔离=逐文件夹 try/catch + 惰性扫描 + fail-closed；③ **注入链**——宿主校验后文本下发 → 渲染层 `<style data-plugin-css>` + `--pl-<id>-<key>` 变量写 body/documentElement 内联（applyAccent 同纪律），浅档声明 body、深档 body.theme-dark，失效回落 theme.css 基线；④ **main.js 本期不执行**（§4.2-4 内含能力裁定：无沙箱基础设施 + 本期用例纯声明式可满足 + schema 预留字段零迁移），非 theme 类型拒载，无插件 API 面；⑤ **@settings**——自研受限 YAML 子集解析（零新依赖），五类型 toggle/range/dropdown/color/text，值落 `plugin.<id>` 层唯一键 `values`（读侧 assembleVars 双侧归一，写侧不归一）；⑥ **对比度义务机器化**——亮暗两档 ink/text-secondary/accent/accent-on 对 paper ≥4.5:1 宿主审计，不过拒载；⑦ **内置皮肤（§5.5 src/skins/）与主题插件互斥**——`app.skinId` 与新键 `app.activeThemePlugin` 双槽互斥（激活一方清另一方），同受 swiss 皮肤层五条边界；⑧ 宿主对插件目录零写入（§7.2 零新负担），插件目录不入 M2 备份（有意取舍，孤儿值无害回落）；⑨ 与 R3/D130 边界互认：`readerSettings.customThemes` 是阅读器内预设（readerSettings 层），主题插件是全局 Token 层，两文零设置键重叠。新增设置键 `app.activeThemePlugin`（string，默认 ""）；`plugin.<id>` 动态 scope 唯一键 `values` | 主线盘点（用户 2026-10-12 指令全部实现处理）；§4.15 是 M11 前置 | v48.89 |
```

### A.3 §4.15 全节重写文本（替换现三行）

```markdown
### 4.15 插件/主题体系（规范；**实现规范定稿 `docs/design/PLUGIN-SYSTEM-D132.md`（v48.89 / D132），未实现**）

- 插件 = 文件夹 `<userData>/plugins/<id>/`（plugin.json 全字段 schema 见 D132 §3.1 + styles.css + 可选 versions.json / data.json；`main.js` 为预留位，**本期宿主不读取不执行**，能力开放须先立 §9.3 守门契约）。`versions.json` 本期＝兼容性声明校验面（拒载时给出最近兼容版本提示；多版本真回落属 M11 更新渠道）。
- 主题是特殊插件（type:theme，本期唯一支持类型）：styles.css 为整套 Token 覆盖层（浅档声明 `body`、深档 `body.theme-dark`，同受 swiss 皮肤层五条边界），经宿主 fail-closed 校验（@import/url() 白名单、受审计 Token 值形态、亮暗对比 ≥4.5:1 机器审计）后由渲染层 `<style data-plugin-css>` 注入，`--pl-<id>-<key>` 可调变量写 body 内联；`/* @settings */` 受限 YAML 子集声明可调项（五类型，落 SettingsStore `plugin.<id>` 层唯一键 `values`，读侧归一）。
- 皮肤体系：内置 `src/skins/<id>/`（构建期注册表，评审门禁）与主题插件（运行时扫描，机器门禁）**互斥共存**：`app.skinId` 与 `app.activeThemePlugin` 双槽，激活一方即清另一方；每套皮肤只改表现层；亮暗对比 ≥4.5:1（内置=评审实测，插件=宿主审计拒载）；先规范后代码。
```

### A.4 §4.2-4 状态更新文本（替换第 4 项）

```markdown
4. `PluginHost`：`load/unload/enable/disable + contributes`（📐 实现规范定稿 `docs/design/PLUGIN-SYSTEM-D132.md`（v48.89 / D132）：`electron/pluginCore.js` + `electron/pluginHost.js`，contributes 本期仅 `{css, settingsSchema}`，main.js 本期不执行；未实现）
```

### A.5 §9.2 新增行文本（追加至表尾）+ §7.4 登记文本

§9.2 追加：

```markdown
| D132 | 插件/主题体系（设计 `docs/design/PLUGIN-SYSTEM-D132.md`；PluginHost + 主题插件注入链 + @settings 可调项 + 内置皮肤互斥共存；main.js 本期不执行） | 📐 v48.89 设计定稿（任务拆解 T1–T6 见稿 §11）；未实现，M11 前置 |
```

§7.4 末尾追加登记段：

```markdown
- **插件/主题键（v48.89 / D132，设计 `docs/design/PLUGIN-SYSTEM-D132.md`）**：`app.activeThemePlugin`（string，默认 `""`）＝激活的主题插件 id，空串＝未激活；与 `app.skinId` 互斥（激活一方清另一方，写入点=pluginHost.activate 与设置页 onSkinChange 两处，互斥矩阵由 pluginCore.nextAppearanceState 纯函数锁定）。**`plugin.<id>` 为动态 scope**（id=插件文件夹名，`F18` 的 DOC_KEYS 逐键登记不适用，登记豁免：凡 `plugin.` 前缀 scope 免登记），其下唯一键 `values`（对象 `{<settingId>: value}`，值域由各插件 `/* @settings */` schema 约定、宿主 assembleVars 读侧归一：color=hex、range 钳制、dropdown ∈ options、text ≤100 字符、toggle 布尔；写侧不归一）。宿主对 `<userData>/plugins/` 零写入；该目录不入 M2 备份（有意取舍 D132 §9.4）。
```
