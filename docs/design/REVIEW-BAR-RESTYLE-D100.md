# 复习界面重设计第二批（D100 / v48.59）设计稿

> 状态：实施中。分支 `d99-review-ui`（D100 随 D99 分支续批）。GUIDE 登记：§5.3（评分模块与计数模块再修订）、§6.8-16 增补段、§8.1 D100。
> 上批：D99（v48.58）——进度条对齐 / 评分钮 40px 等高 / AI 判答 / 发音按钮。
> **皮肤约束（用户同日更正一）**：当前是默认皮肤，**默认皮肤全部使用方角设计**——本批不引入任何圆角/胶囊/圆形，全部走既有方角 Token。
> **范围澄清（用户同日更正二）**：「不要方块」指**颜色块（8×8 方形色点）不要正方形设计**，颜色改以其他干净优雅的方式表达；按钮盒体与尺寸不在更正范围（D99 的 40px 等高获批「大小没问题」）。

## §0 用户原话（逐字，2026-10-06）

> 一、复习页面顶部：未学习、学习中、待复习，以及下面的具体数据。这个模块下面有一条浅浅的细线，这个细线的左右两端同样和底下的卡片内容、卡片框相对齐（左右对齐），以及和最下面的按钮左右两端对齐。也就是把这个期限缩短。
>
> 二、点击显示答案后的四个判断按钮：重来、困难、良好、简单。大小没问题了，但是它的样式请重新设计，不要方块。以dylantarre/animation-principles 中的相关skill为指导来设计。
>
> 三、右上角的那个未学习、学习中、待复习以及下面数据，它的样式也请重新设计，不要方块。同样以dylantarre/animation-principles 中的相关skill为指导来设计。
>
> （更正一）请注意当前是默认皮肤，默认皮肤全部使用方角设计。
>
> （更正二）我之前说的"不要方块"是指颜色块不要正方形方形设计，可以以其他方式来干净优雅地表现颜色。

## §1 范围

**Goals**：①复习页头带下缘 hairline 收进 720 内列；②评分四钮内方形色点退役、语义色改左缘色条表达；③三档计数方形色点退役、语义色改数字文字色表达。全部映射既有 D88 动效 Token，不新增 Token、不改任何 Token 基线（`--radius-*` 保持零消费者不动）。

**Non-Goals**：不引入圆角/胶囊/圆形（更正一）；不改按钮盒体形态与 40px 等高（更正二圈定只动色块表达；推荐档 accent 填充保留）；不改「显示答案 / AI 判答 / 更多」；不改摘录页头带（`.extract-page-head` 全宽 hairline 契约不动）；不改卡面排版与队列/调度；不改快捷键与命令（F20 钩子零变更）。

## §2 设计

### 2.1 ① 头带细线缩短（用户指令一）

细线 = `.review-head` 的全宽 `border-bottom`（`--band-line`）。修订：复习页头带 `border-bottom: none`，改 `::after` 伪元素在头带内画线——`max-width: 720px + margin-inline: auto`，与 `.review-head-inner` / `.review-progress` / `.review-session` / `.stage-bar-inner` **同一 720 内列公式**（构造性对齐，非测量补偿）。摘录页头带共用规则不动（只覆写 `.review-head` 作用域）。

### 2.2 ② 评分四钮：常态无彩色，hover 揭示语义色（用户指令二 + 四更正定稿）

- **常态**：四钮**完全无彩色**——1px `--border-subtle` 描边 + `--grey-1` 底 + `--text-primary` 档名 + helper 间隔预览，四钮同灰（含推荐档 Good：accent 填充移出常态；`recommended` 类保留＝涟漪白名单与焦点 outline 钩子）。40px 单行等高不变（D99 获批）。
- **hover 揭示**（用户定稿指令：「评分按钮和文字都先不添加彩色，鼠标悬停在按钮上时再将按钮显示为对应颜色」）：悬停时**整钮**以对应语义色填充——重来=`--error`/`--error-on`、困难=`--warning`/`--warning-on`、简单=`--success`/`--success-on`（配对 Token 本批补齐，同 error-on/warning-on 族：浅 #ffffff / 深 #0a0a0a）、良好=`--accent`/`--accent-on`；边框随填充同色；间隔预览 `color: inherit + opacity .85` 随钮身收淡。过渡由 §4.1 通用档承担（background/border/color 均 `--dur-hover` `--ease-out-soft`，reduced-motion 降级为瞬时换色）。
- **动效语义（skill 映射）**：hover 填充＝**Anticipation**（颜色预告该档的语义，按下即确认——feedback-indicators 的「action location 反馈」）；staging-mastery：静止时底栏唯一的视觉层次来自排版与留白，无色彩竞争；state-changes：hover↔rest 两态可逆、150ms 档。
- **交互**：hover -3px 抬升 + 阴影、active scale(.95)、涟漪白名单**不变**（recommended 仍是填充钮成员——hover 瞬间即填充态）；disabled 维持灰（无语义色可落）。
- **DOM 变更最小**：仅删除 `<i class="grade-dot">`；按钮类名结构不变（`grade grade-*` / `recommended`）。

### 2.3 ③ 计数模块：去点、无彩色、分隔线结构（用户指令三 + 更正收敛）

- **形态**：三档保持「标签上 / 数字下」竖排悬浮，**8×8 方形色点退役**；随「不要以文字承色」更正，计数**无彩色**（标签 helper、数字 `--text-primary`）——颜色预算集中到评分钮的 hover 交互。
- **结构分隔**：三档之间加 1px hairline 竖分隔（`--border-subtle`，批注栏竖线同族词汇）承载结构性。
- **动效（state-changes）**：数字 bump 既有（200ms `--spring` scale 1.18）不变；motion differential——只有变化的那档在动。`prefers-reduced-motion` 全降级。
- **测试钩子**：`[data-review-counts]` 容器类、三档文案、textContent（f46/f60/reader.engine 只读文本）零变更。

### 2.4 动效映射表（dylantarre/animation-principles → 既有 Token，零新增）

| 交互 | skill 依据 | 实现 |
| --- | --- | --- |
| hover 揭示语义色 | anticipation-mastery（悬停＝预告，按下＝确认）+ feedback-indicators（反馈出现在动作位置） | 整钮语义色填充 + `-on` 文字，`--dur-hover` 过渡（§4.1 通用档已含 background/border/color） |
| 推荐档 | staging-mastery（单焦点） | 常态四钮同灰（无色彩竞争）；hover 才见 accent |
| hover 抬升 | anticipation-mastery（D88 既有） | -3px + 阴影；按压 scale(.95) `--dur-press` |
| 计数变化 | state-changes（micro 档）+ staging（motion differential） | bump 200ms `--spring` 只动变化的那档（既有） |
| 次级信息 | secondary-action-mastery（次级不抢主） | 间隔预览 meta/helper 档（hover 时随 currentColor 收淡）；计数标签 helper 档 |
| 降级 | universal-patterns | `prefers-reduced-motion: reduce` 过渡全关（状态瞬时生效） |

### 2.5 语义色承载变更登记

D88 立的「语义色唯一承载＝8px 色点」（评分钮 4 枚 + 计数三档 3 枚直角方块点）随本批**修订为「语义色承载＝hover 揭示」**：常态无彩色，悬停整钮填充对应语义色（`-on` 配对文字）。新增配对 Token `--success-on`（浅 `#ffffff` / 深 `#0a0a0a`，补齐 `--error-on`/`--warning-on` 同族——§5.1 求值层纪律两处声明）。中途候选「左缘 4px 色条」（v3）与「档名/数字文字承色」（v4）均经用户否决；计数模块随「不要以文字承色」收敛为无彩色。这是 swiss 文档「8×8 直角方块替代圆点装饰」条款在复习页的**用户裁定退出**（受控于复习页头带与底栏，不外溢）。

## §3 测试计划（tests/d100-review-restyle.gui.mjs，CDP + 隔离 userdata）

1. 头带细线：`.review-head` computed `border-bottom-width` = 0px，`::after` content 非空且 `max-width` = 720px。
2. 评分钮：`.grade-dot` 不在 DOM；**常态四钮无彩色**（background 互同且为灰、档名色 = 主文字色）；CDP 真鼠标 hover「重来」→ 整钮填充 `--error`（computed background 变红）+ 文字翻转 `-on`；hover「良好」→ accent 填充；移开后回落灰；height 仍 40px（d99 套件继续钉等高）。
3. 计数：`.count-dot` 不在 DOM；三档数字同为无彩色（互同色）；相邻 `.qi` 有 1px 左分隔；三档文案在场。
4. 回归：`tests/d99-review.gui.mjs` 17 项全数重跑（等高/对齐/判答/发音不受影响）；F11 / F18 / F20 / F21 基线 + F24/F27 既有红灯口径 + `tsc --noEmit` + build。

## §4 修订记录

| 版本 | 内容 |
| --- | --- |
| v1 | 初版——评分钮与计数走胶囊化（`--radius-pill` 激活 + 圆形色点） |
| v2 | 用户更正一「默认皮肤全部使用方角设计」：胶囊/圆形方案作废，`--radius-pill` 不动；改判为去盒去点的文字级设计 |
| v3 | 用户更正二「不要方块指颜色块不要正方形，以其他方式干净优雅地表现颜色」：盒体与 accent 填充保留，色点退役——评分钮语义色改左缘 4px 色条（恢复 D88 前条款），计数语义色改数字文字色 + hairline 分隔 |
| v4 | 用户否决色条（"色条也不太好看，请按照 skill 为指导重新设计"）：按 feedback-indicators（文字承载）/ exaggerated-clarity（一眼可辨）/ staging（accent 填充唯一焦点）重定——评分钮档名文字承色（重来=error／困难=warning／简单=success；Good=accent 填充不撞 success 绿），计数维持数字承色 |
| v5 | 用户定稿（"不要以文字承色，评分按钮和文字都先不添加彩色，鼠标悬停在按钮上时再将按钮显示为对应颜色"）：**常态四钮完全无彩色，hover 整钮语义色填充揭示**（Anticipation：颜色预告语义、按下即确认）；计数随「不要以文字承色」收敛为无彩色（结构性＝分隔线）；新增配对 Token `--success-on`（补齐 error-on/warning-on 同族）。§2/§3 按 v5 定稿 |

### R2（同日实测两项，用户截图）

> 1. 可以看到"重来"和"困难"两个按钮，按钮上的文字变成竖排了，请确保不会出现这样的情况。
> 2. 右上角的"未学习""学习中""待复习"的文字和下面的数据请放到同一行，以免占据太高的空间，这个信息并没有那么重要。

**决议**：

1. **竖排根因＝评分行被侧簇挤窄 + 无 nowrap**（侧簇三钮「AI 判答/跳转原文/更多」在场时行宽 ≈420px，每列 ≈100px，装不下「重来 10 分钟」）。双保险：① `.review-bar .grade { white-space: nowrap }`——任何宽度下按钮文字**永不逐字竖排**；② `.grade-row` 升级**行级容器查询**（`container-type: inline-size`）：行宽 <480px（每列 <~110px）时**先藏间隔预览**（secondary-action 次级信息让位；间隔仍完整保留在按钮 title 气泡「重来（快捷键：1）· 间隔 10分钟」），档名单行恒可读。窗口宽度不改变行宽（底栏内容列恒 ≤720 封顶），触发条件只随侧簇按钮数量变化——有「跳转原文」的卡自动进入紧凑档。
2. **计数单行**：`.qi` 改「标签 + 数字同行」（baseline 对齐，20/300 tabular 数字不变），头带内列 `min-height` 撤销（改 `padding-block: var(--sp-2)`）——头带高度 ≈51px → ≈40px，纵向空间还给卡面；分隔线/bump/测试钩子不变。
