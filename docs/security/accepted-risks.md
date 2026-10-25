# 已接受的风险（accepted risks）

> 登记本仓**知情保留**的依赖风险：为什么不修、为什么不可达、何时复查。
> 每条必须包含：包名、advisory 编号（或「今日 audit 已不标记」的实测证据）、不可达论证、复查触发条件。
> 新增条目须在提交说明中注明来源（审计报告条目号或 npm audit 快照）。

## 1. sprintf-js（经 mammoth → argparse 引入；报告 C-41 步骤 4）

- **登记时间**：2026-10-25（C-41）。
- **依赖链（实测 `npm ls sprintf-js --omit=dev`）**：`mammoth@1.12.3 → argparse@1.0.10 → sprintf-js@1.0.3`——链**仍在生产依赖树中**（另有 dev 链 `electron-builder → @electron/get → global-agent → roarr → sprintf-js@1.1.3`，不随安装包分发）。
- **advisory 状态（实测）**：审计报告快照（`r1/raw/npm_audit.log`，--omit=dev，12 个漏洞）将其列为 moderate；**2026-10-25 实测 `npm audit --omit=dev` 的 9 个漏洞清单中已无 sprintf-js**（advisory 上游状态变化，报告快照未给出 GHSA 编号，今日亦无法从 audit 输出取证编号）。为防 advisory 再次生效，按不可达论证继续接受该风险。
- **为什么不可达（实测 `rg -n "argparse" node_modules/mammoth/lib` → 0 匹配）**：argparse 只被 mammoth 的**命令行入口**（`node_modules/mammoth/bin/mammoth`）引用；本仓唯一用法是 `electron/importers.js` 走 mammoth 的库 API（`require("mammoth")` 的 `convertToHtml` 等），主进程从不以子进程方式调用 mammoth CLI，argparse/sprintf-js 代码路径在生产运行时不可达。
- **为什么不修**：修复需要 `npm audit fix --force` 把 mammoth 降级（报告口径：破坏性），违反本仓「不运行 `npm audit fix --force`」纪律。
- **复查触发条件**：①升级 mammoth 时（重新验证 argparse 是否仍只挂在 CLI 入口）；②未来 `npm audit --omit=dev` 再次标记 sprintf-js 时（重新评估不可达论证是否仍成立）；③例行 `npm audit` 快照对比（每次 C 项会话的依赖类改动）。
