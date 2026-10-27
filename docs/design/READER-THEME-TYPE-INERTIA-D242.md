# 阅读惯性、中文字体与主题一致性（D242 / v49.71）

## 范围

承接 D241，仅修复用户实测的三项阅读体验问题：跨章后惯性继续滚动甚至连跳、中文默认字体过粗、整窗阅读主题不同步。不改变数据库、IPC、依赖、PDF 固定版式或显式自定义字体，不增加界面文案。

## 诊断与契约

### 跨章惯性

原逻辑用处理时刻判断手势，章节加载造成的主线程停顿可把排队惯性误判为新手势；幅度抖动也可能命中宽松的重新发力阈值。触发跨章后，余下事件仍可原生滚动新章。

- 输入时间使用 wheel 事件时间戳，按 iframe timeOrigin 归一到宿主时间轴。
- 静默阈值 160ms；重新发力须至少 16px、超过前一事件 2.2 倍且距上次翻页超过 320ms。
- 滚动、竖向翻页与横滑跨章后进入惯性吸收；事件 preventDefault，直到静默或跨章 400ms 后明显重新发力。
- 滚动模式换章锁期间禁止原生滚动。新章停在章首（反向停上一章末），保留 D241 淡出微移 / 淡入与减少动效契约。

### 默认中文字体

macOS 的 Songti SC 常规 / 细体可能未安装，400 字重会匹配已安装的粗体。移除默认栈中的 Songti SC、STSong、日文明朝、SimSun 及最终 serif；繁体中文同样移除 Songti TC / PMingLiU。思源 / Noto 宋体仍优先，缺失时中文落苹方 / 微软雅黑 / 思源黑体等常规字体；西文保留 Iowan / Charter / Georgia 等衬线。日文、韩文地区覆盖不变。用户显式字体不变，不以强行 font-weight 覆盖出版方标题或强调。

### 整窗主题

原阅读色只在阅读滚动容器内生效；顶栏、按钮、浮层仍消费应用或皮肤的白底 Token。旧 foliate-paginator::part(filter) 选择器无法穿过 foliate-view 的 shadow 边界，分页边缘 / 顶部背景保留旧色。

- 阅读器挂载期间在 body 内联发布阅读背景 / 前景，并把表面、文本、灰阶与描边 Token 映射到同层派生值，压过皮肤声明；不改变语义强调色。
- 派生色以背景与文字色按灰阶比例混合；所有布局使用同一路径。filter 背景通过 foliate-view::part(filter) 命中。
- 纸白 / 羊皮同步浅色档，暗夜同步深色档；自定义背景按 sRGB 相对亮度 <0.4 判为深色。离开阅读器撤销阅读 Token，恢复应用主题。

## 任务与机械验收

| 任务 | 执行角色 | 文件 | 验收 | 依赖 |
| --- | --- | --- | --- | --- |
| 惯性吸收与事件时间归一 | 核心修复 | vendor/foliate-js/paginator.js、MANIFEST.json | d242-reader-inertia 真实原生输入 11 项；D241 动效回归 | D241 |
| 字体与明暗档 | 修复 | appearance.ts、service.ts、reader.appearance.test.cjs | 默认栈、显式字体和自定义亮度单测 | 无 |
| 整窗阅读色与 part 选择器 | 修复 | Reader.tsx、theme.css | 滚动 / 分页 / 对开 × 四主题，基线 / claude 皮肤，按钮及背景取样、退出恢复 | 明暗档 |
| 回归与交付 | 验证 | tests、GUIDE、本文件 | build、typecheck、consistency、i18n、skin-audit、个性化 / 分页 / 内核套件 | 前述全部 |

## 验证命令

- `node scripts/run-tests.mjs reader.appearance d241-reader-motion d242-reader-inertia`
- `npm run build` 后运行 `node tests/d242-reader-theme-sync.gui.mjs`、`node tests/reader.personalization.gui.mjs`、`node tests/reader.paging.gui.mjs`。
- `node_modules/.bin/electron --no-sandbox tests/reader.kernel.cjs`。
- `npm run typecheck`、`node scripts/consistency-check.mjs`、`node scripts/i18n-check.mjs`、`node scripts/skin-audit.mjs`。
- 所有 Electron / GUI 运行使用隔离测试 userData；不接触真实数据目录。

## 验收记录

- 类型检查、构建、consistency、i18n、skin-audit 均退出 0；!important 保持 14，未新增 TSX 颜色字面量或界面文案。
- 惯性专项 **11/11**，原 D241 动效 **30/30**，外观 / 字体 / 明暗档 **69/69**；真实阅读内核 **75/75**，分页 GUI **9/9**。
- 阅读个性化 GUI **48/48**（当前与原 dev 串行运行均通过）；补跑标注视图模型 **9/9**、fake marks **8/8**。并行 GUI 的背景窗口会影响视图过渡调度，验收以无其它 GUI 实例抢占的串行结果为准。
- 新主题 GUI **152/152**：滚动 / 分页 / 对开 × 纸白 / 羊皮 / 暗夜 / 深色自定义，以及 claude 皮肤，覆盖顶栏、按钮、正文、内核页边、整窗色带取样与离开阅读器恢复。截图人工复核暗夜滚动与羊皮对开，无白色残留、正文常规字重清晰。
- 原 dev `cb3da70` 与本次补丁的 F20 **30/30**、F21 **7/7**；F11 **13/16**、F18 **90/91**、F24 **11/12**、F27 **13/14** 的失败结构逐项相同，均为基线既有（缺失旧文件 / 表数声明、app.back/getPath 读数扫描、F91/F92 缺依据、旧里程碑文案共现），未混入本次修改。
- 先前差分验证：惯性新专项原实现仅 **7/11**，修复后 **11/11**，可复现缺陷而非只验证内部状态。
- GUI 测试须在构建完成后、串行运行；构建会临时移除 dist，导致运行中 reload 的应用加载失败。退出恢复断言的基准明确固定为同一皮肤的浅色档书架，再于阅读器切纸白后退出，避免拿前一轮遗留的深色档作基准。
