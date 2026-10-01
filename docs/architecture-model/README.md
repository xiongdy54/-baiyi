# docs/architecture-model

增量阅读桌面应用的**当前态架构模型**。与 `docs/diagrams/`（业务与算法叙事图）并列，不取代它。

> ⚠️ **时效警告（2026-10-01）**：本目录是 `780ea84`（指南 v48.14 时期）的快照，**已落后于当前指南 v48.28**——其中的计数（IPC 通道、库表数量、主进程模块清单）与技术栈描述不保证仍然成立。**现行事实以 `AI_DEVELOPMENT_GUIDE.md` §3 / §4 与代码为准**；本目录的四方差异登记见 `docs-vs-code-vs-model.md`。

- 事实源：`system-model.structurizr.dsl`
- 状态：current-state only。不含目标态、不含风险评级、不含修复建议
- 生成：2026-09-21 @ `780ea84`，分支 `docs/architecture-model-v48.14`
- 方法：`architecture-visualization` 包的 `explore` → `system-modeler` + `c4model`，业务侧套用 `business-application-fitness`

## 按受众选起点

| 你要做什么 | 读这个 |
| --- | --- |
| **在这个仓库里改代码**（含 AI 编码代理） | `architecture-understanding.md` §4 四道边界 → §5 契约簇 → §6 回归路径参与方。配合 DSL 的 `L2` 容器视图 |
| **自己做架构判断 / 复盘耦合** | `module-map.dot`（写入归属与依赖汇聚点）+ `system-model.evidence.md` §1.1 扇入表 + §3.2 作者归属表 |
| **拿给别人看** | `showcase.html`（直接双击，沿用 `docs/diagrams` 的瑞士风房规） |
| **想知道文档哪里过期了** | `docs-vs-code-vs-model.md` |
| **想验证我有没有瞎说** | `system-model.evidence.md` §1 每个计数都附复算命令 |

## 文件

```
system-model.structurizr.dsl      事实源 · 53 元素 / 76 关系 / 5 视图（L0 L1 L2 L3-main L3-renderer）
system-model.evidence.md          逐条 file:line + 置信度 + V1–V9 未知项
system-model.summary.md           模型摘要（边界 / 四条核心关系 / 证据强度 / 未知项）
architecture-understanding.md     业务语言的架构理解（AI 开发参照版）
module-map.dot                    主进程耦合与写入归属稠密图（Graphviz）
showcase.html                     对外展示：一张 L2 视图（手绘内联 SVG，派生物）
docs-vs-code-vs-model.md          指南 / 既有图 / 代码 / 模型 四方差异
tools/                            三个离线自检脚本
```

## 查看与渲染

- **DSL**：Qoder 的 Structurizr DSL 格式查看器；或 Structurizr Playground / CLI。五个视图 key 为 `L0` `L1` `L2` `L3-main` `L3-renderer`。
- **DOT**：本机 **未安装 graphviz**（`command -v dot` 未命中），所以 `.dot` 目前只有文本与 Qoder DOT 查看器两条路；要出图需 `dot -Tsvg module-map.dot -o module-map.svg`。
- **showcase.html**：浏览器直接打开，无外部依赖、无脚本。

## 自检（改完必跑）

```bash
cd docs/architecture-model
node tools/dsl-check.cjs  system-model.structurizr.dsl   # 括号/引用 id/视图 key 唯一/位置参数非逗号/声明元数
node tools/dot-check.cjs  module-map.dot                 # 括号方括号/HTML-like 标签配对/未闭合字符串
node tools/svg-geom-check.cjs showcase.html              # 框越界/框重叠/文字溢出画布/marker 引用有效
```

三个脚本都是在本次交付中写的，因为它们各自抓到过真实缺陷：DSL 的 `technology`/`tags` 位置参数写反、组件 id 与顶层 `views` 块关键字同名、几何检查器自身 `stroke-width` 被误当成 `width` 导致检查空转。

## 维护规则

1. 改架构事实 → 改 `.structurizr.dsl`，再同步 `evidence.md`。不要手改 `showcase.html` 里的框来"修正"结论。
2. `evidence.md` §1 的计数都给了 grep 命令。代码改动后重跑一遍，数字变了就是模型漂移了。
3. 置信度不许悄悄升级。`Inferred` / `Unknown` / `ContractOnly` 三种标记要有代码级依据才能去掉。
4. 结构性断言（"唯一写入者""零 require"）必须附复算方式 —— 这类断言最容易在重构后变成假的。
