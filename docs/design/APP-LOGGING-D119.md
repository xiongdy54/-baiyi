# 应用日志 App Logging 设计（D119 · v48.75）

> 用户需求（2026-10-08 原话）：「我了解到"日志 logging 功能，是几乎所有正式发布的软件都有的标准配置"。那么，请你帮我设计并实现这个日志功能。也就是说，我希望软件发布之后，用户在使用的过程中如果出错，可以在设置中找到"日志"，点击即可打开错误日志的文件位置，然后用户可以把这个文件发给我。」
>
> 契约登记：`AI_DEVELOPMENT_GUIDE.md` §7.2（追加写例外）、§7.3（测试义务）、§8.1 D119。
> 本文件为 D119 的设计展开，验收以交接包 + §7.3 为准。

## 1. 目标与非目标

**目标**：发布后用户出错时，可在设置 → 「数据与效率」→「日志」一键打开日志文件夹，把日志文件发给开发者排障。

**非目标**：不做日志查看器界面；不做任何网络上传/遥测（§7.6 一键上传是另一独立未实现通道）；不做崩溃弹窗重设计；不改打包配置。

## 2. 架构与数据流

```
渲染层（src/main.tsx）                          主进程（electron/）
  window error  ─┐
  unhandledrej  ─┼─ logsAPI.report(payload) ──send──▶ ipcMain.on("logs:rendererError")
  console.error ─┘   (fire-and-forget)                  │
                                                        ▼
设置页（SettingsPanel LogsSection）               electron/appLog.js（零依赖、纯 node 可测）
  logsAPI.openFolder() ──invoke──▶ logs:openFolder ──▶ shell.openPath(<userData>/logs)
                                                        │ appendFileSync
                                                        ▼
主进程 process.on(uncaughtException/unhandledRejection) ▶ <userData>/logs/main.log
生命周期：app start 横幅 / app ready 行 / will-quit 行   （2MB 轮转，main.log.1–.4）
```

**写路径归属**：日志写入只发生在主进程 `appLog.js` 单点；渲染层只经 IPC 转发，不写文件（与 DB/设置同构的"渲染层不持 IO"纪律）。

## 3. 日志格式（人类可读行式）

```
2026-10-08 15:32:01.123+08:00 [ERROR] [main] uncaughtException: cannot read property of undefined
    at fn (electron/main.js:123:45)
    at ...
================ app start ================
version 0.0.1 · packaged false
platform win32/x64 · electron 31.7.7 · node 20.x
```

- 时间戳：本地时区 + 时区偏移（用户与开发者同区直读；带偏移跨区可换算）。
- 行格式：`<时间戳> [<级别>] [<模块>] <消息>`；模块＝`main` / `renderer` / `app`（生命周期）。
- 消息内换行单行化为字面 `\n`（保证一行一事件，grep 友好）；Error 堆栈另起 4 空格缩进块。
- 级别：`ERROR`（异常/拒绝/渲染层错误）、`WARN`、`INFO`（生命周期）。

## 4. 轮转（方案从简）

- 单文件超过 **2MB**（写前 `statSync` 检查）触发轮转：`main.log.4` 删除、`.3→.4`、`.2→.3`、`.1→.2`、`main.log→main.log.1`、新建 `main.log`。
- 保留当前 + **4 份历史**，总量上限约 10MB。
- 轮转失败（如文件被占用）静默继续写当前文件——轮转是优化不是正确性前提。
- 阈值/份数可经 `init({ maxBytes, keepFiles })` 注入（测试注入小值）。

## 5. §7.2 豁免理由（已登记）

日志**不走 `persist()` tmp+rename 原子写**，理由：

1. 日志是诊断文件，不是用户数据、不是调度事实源（不变量 2「同一份事实不允许两套解释」不涉及——日志是旁观者不是事实源）。
2. append-only 流水的追加语义与「整文件原子替换」冲突——tmp+rename 每次写都要复制全文件。
3. 单行丢失（进程崩溃落在追加中途）不影响诊断完整性；日志无事务性要求。
4. 写失败必须静默降级（`try/catch` 全吞），绝不能因日志故障阻塞任何业务路径——这与 persist() 失败需要显式报错重试的语义相反。

## 6. 隐私白名单（§7.5 纪律）

- **只记录**：时间戳、级别、模块、错误消息与堆栈、app 版本、平台/Electron/Node 版本、packaged 标志。
- **永不记录**：文档正文、摘录内容、AI 对话原文、业务数据载荷、API Key/Cookie。
- 渲染层转发载荷在主进程 `logRendererError` 按**字段白名单**归一：只取 `kind / message / stack / source / line / col`，其余字段一律丢弃；截断：消息 2000、堆栈 4000、source 200 字符。
- 用户手动发送日志文件给开发者是用户自己的决定，不构成上传通道。

## 7. 崩溃语义决策（uncaughtException 监听的副作用）

挂 `process.on("uncaughtException")` 后 Node 默认的「打印并退出」被抑制——**有意决策**：桌面应用工作现场优先（用户未保存的阅读位置/输入现场不因一次异步意外全丢），electron-log 等生产日志库同惯例；状态不一致风险由主进程既有的业务级 try/catch 防线（IPC handler 普遍地 catch 返回 `{ok:false}`）兜底。`unhandledRejection` 默认本就不退出，监听零语义变化。

## 8. IPC 契约

| 通道 | 类型 | 方向 | 载荷/返回 |
| --- | --- | --- | --- |
| `logs:rendererError` | `ipcMain.on` | 渲染→主（fire-and-forget） | `{kind:"error"|"rejection"|"console", message, stack?, source?, line?, col?}` |
| `logs:openFolder` | `ipcMain.handle` | 渲染↔主（invoke） | 返回 `true`；目录不存在先建（零日志状态也能打开） |

preload 暴露 `window.logsAPI = { openFolder, report }`。

## 9. 渲染层接线（src/main.tsx）

- 既有 `window error` / `unhandledrejection` 监听保留 console 行为，追加 `report(...)`。
- `console.error` hook：包装原函数，首参为 string/Error 时转发（React/库警告也随之入日志，截断+轮转控制体积）；`[global]`/`[unhandled]` 前缀跳过（已被 error/rejection 监听完整记录，防双写）。
- 上报动作整体 try/catch 静默——报告失败绝不触发新错误。

## 10. 设置入口（SettingsPanel）

- 导航：「数据与效率」组新增 `{ id: "logs", label: "日志" }`（第 14 项，备份与恢复之后）。
- `sec-logs` 节：一句话说明（含隐私边界，操作必需）+「打开日志文件夹」按钮（`btn btn-outline btn-sm`，先例＝备份节「打开备份文件夹」），notice 反馈复用 `ai-test-ok` / `ai-test-fail` 样式类。
- 零设置键、零 schema 变更。

## 11. 验收清单（机械可查）

1. `npm run build` 成功；`npx tsc --noEmit` 零错误。
2. `node tests/applog.test.cjs` 全绿（写盘/格式/轮转/错误捕获/载荷归一/静默边界）。
3. 手工链路：启动应用 → `<userData>/logs/main.log` 生成且含启动横幅；设置 → 日志 → 打开日志文件夹 → 资源管理器定位该目录。
4. 重启不丢数据；书架/阅读/复习主流程无副作用（日志路径独立于 DB）。
5. D119 已登记；§7.2 例外、§7.3 义务已同步。
