# D142 制卡台（CardDock）样式改版 · 实施报告

> 日期：2026-10-12 ｜ 分支：`main`（未 commit / 未切分支，按任务约束） ｜ 实施：frontend-builder
> 方案唯一来源：`docs/design/D142-CARDDOCK-RESTYLE.md`（用户裁定：文本框 **V1 下缘一划** · 发送钮 hover **H1 深一档** · 禁用字色 **D2 略提亮**）
> 代码面写入：仅 `src/theme.css`（零 TSX / 零 DOM / 零 electron 改动）；文档面：GUIDE D142 行翻实施记录 + 设计稿头部登记标注（v48.99 预留不动）
> 环境：DPR 2.5、内窗 1100×750；GUI 为自起实例（`M7_TEST_USERDATA` 隔离目录，端口 9252），全程未做全局 taskkill、自起自清
> （过程留痕：首轮自起实例的 PID 树清理曾被执行时序绕过而短暂残留，经命令行（`--remote-debugging-port=9252` + 本仓 `tests/tmp-d142-*` userData）与启动时间双向核实为**本轮自起实例**后按 PID 定向 `/T /F` 清理，未触及任何其它进程；脚本随后修正为 finally 统一清理）

## 一、改动清单（`src/theme.css`，行号为落盘后实测）

| # | 位置（现 L） | 改动 | 对应设计稿 |
| --- | --- | --- | --- |
| 1 | L8105–8107 | `.wb-ai` 上缘 strong 线删除；底部放置的 `border-left` 同步删除（注释改写为 R1 口径；`.wb-manual` 的 subtle 右缘线**未动**——唯一竖线，风险 5 已核） | §2 #9 / R1 |
| 2 | L8111–8147 | `.wb-field`：四边框→`border:0; border-bottom:1px solid var(--border-subtle)`（1px 占位保留，聚焦零位移）；`background:transparent`；`caret-color:var(--accent)`；悬停 `:hover:not(:focus-within)` 线色 strong；聚焦 `:focus-within` 线色 accent + `box-shadow:0 1px 0 0 var(--accent)` 瞬时厚化（不入过渡）；旧 `:focus-within{border-color/background}` 两条随边框**删除**（风险 4）；过渡改「进 200ms `--ease-enter` / 出 100ms `--ease-exit`」双写；`.wb-field-clip` 高度过渡保留 | §2 #2 / §3.1 / R2 / R3 |
| 3 | L8139 | `.wb-field-inner { padding: 4px 0 }`（原 `4px var(--sp-2)`；文字左缘 25px→16px） | §3.3 / R3 |
| 4 | L8195 | `.wb-line` 下缘 `dashed var(--border-strong)` → `solid var(--border-subtle)`（聚焦 accent 保留） | §2 #6 / R4 |
| 5 | L8232、L8235–8241 | `.wb-more .dd-btn` 去 `border-color` 改写 `padding:0`；新增坞内收紧组：`.side-dock .dd-btn`（`border:0; padding-left/right:0; color:var(--text-helper)`）、`.side-dock .dd-btn:hover`（grey-1 灰底 + 墨字）、`.wb-more .tag-input-box input`（裸排：`padding:0;border:0;background:none`）、`.side-dock .btn-outline:disabled`（grey-1 底 + `border-color:transparent`，与 base 禁用一致 grey-2 字） | §2 #4/#5/#11/#14 / R5 / R8 |
| 6 | L8256–8273 | `.wb-free textarea`：去框 + V1（`padding:4px 0 5px`、`border-bottom:1px solid var(--border-subtle)`、bg 透明、`caret-color:accent`）；高度 30 不变；hover 线 strong / focus accent+厚化 | §2 #12/#18 / §3.3 / R6 |
| 7 | L8277–8299 | 两类 textarea 过渡：线色进 200/出 100 双写 + 高度沿用 `--dur-panel`（全在 `no-preference` 块内） | §3.1 / §7 #10 |
| 8 | L8300–8306 | 占位 token 化：`.wb-free textarea::placeholder` / `.wb-composer textarea::placeholder` → `--text-placeholder`；新增 reduce 块：坞内输入面 `transition:none`（归零全应用 `input,textarea` 基线 120ms 对聚焦线的影响，兑现 #10「reduce 瞬时出现」） | §3.4 / R9 / §7 #10 |
| 9 | L8307–8321 | `.wb-composer` 上缘 strong→subtle；`.wb-composer textarea` V1（`padding:5px 0 6px`、下缘 subtle、bg 透明、caret accent，高度 32 不变）；hover/focus；发送钮 `:hover:not(:disabled)` → `--accent-hover`（H1 只变色，零阴影零位移）、`:disabled` 字色 → `--text-placeholder`（D2） | §2 #15/#16/#17 / R7 / R10 / §4 |
| 10 | L8421–8422 | `.wb-cloze-btn` 转文字钮（去框、bg 透明、hover grey-1、disabled＝placeholder 字无框）；`.wb-cloze-input` 无需规则（所属 `.wb-field` 承担底线机制，computed 已核） | §2.1 同政策延伸 |
| 11 | L3024、L3103 | base 两条 `:focus` 残留的 `border-color: strong` 清理（仅留 `outline:none`；旧 4 边色随去框退役，防幽灵边框） | §7 #2 精神 / R6 |

未动：`.wb-pick`（V1 保留 paper 底，§3.5「V3 才需改」）、`.wb-check` 13px 方框、`.wb-more` 上缘 hairline、`.ai-kp`/`.ai-kps-head`/chip 族/`.ai-error`/`.dd-menu` 浮层（§2 与 §2.1 判定「保留」项）；`.wb-manual`（底部放置）右缘 subtle 线；页签/标题行语法；全部高度契约与 `max-height` 逻辑。

## 二、设计稿 §7 可机械检查验收逐条（全部通过）

| # | 判据 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | `.wb-ai` 无可见上缘线 | ✅ | 源码 grep：`wb-ai` 仅余注释与 `.wb-ai-head`（无 border 规则）；GUI computed `0/0/0/0`（右/底/独立窗口三处）；样张复核 `ai区上缘线 V1.borderTopWidth === "0px"` 复现；截图像素比对：原 CSS y212 强线（rgb163）消失 |
| 2 | `.wb-field` `border:0` + 下缘 1px；无 4 边 strong 残留 | ✅ | `grep -n "wb-field" -A3`：`border: 0; border-bottom: 1px solid var(--border-subtle)`（L8118-8119）、hover/聚焦仅改 `border-bottom-color`；GUI computed `0/0/0.8/0`、`bcBottom rgb(224,224,224)`、bg 透明 |
| 3 | `.wb-line` 上下文 `dashed` 命中 0 | ✅ | `grep -n "dashed"`：仅 `.kind-tag.t-unlocated` / `.disamb-single` / `.cx-empty` / `.journal-draft`，wb-line 上下文 0；GUI computed `0/0/0.8/0` 实底 subtle |
| 4 | `.side-dock .btn-outline:disabled` 存在且填充式 | ✅ | L8241 `{ background: var(--grey-1); border-color: transparent; }`；GUI（AI 制卡钮）`bg rgb(240,240,238)`、`bcTop rgba(0,0,0,0)`、`color rgb(212,212,210)` |
| 5 | placeholder token 化 ≥2 处 | ✅ | `grep` 命中 2 行（L8301-8302）；运行时样式表复核两条 `::placeholder => color:var(--text-placeholder)`、token 解析 `rgb(138,138,138)`（注：Chromium 不支持 `getComputedStyle(el,'::placeholder')`，CDP 伪元素枚举亦不含 placeholder，改用运行时样式表求证 + 截图像素佐证：占位字形最暗像素 = 138） |
| 6 | 高度契约 32=32 与 flex-end | ✅ | GUI：`composerTa.h=32`、`send.h=32`、底对齐（bottom 742=742，gap 0）；输入第二行后 `h=52` 且仍 flex-end 底对齐（gap 0）；自由材料 30、追问行裁切 `29≤29 / 31≤31 ok` |
| 7 | 样张复核（数值一致） | ✅ | `npx electron design-samples/D142-carddock-restyle-shot.cjs` 复跑：线条审计 V1 `7 元素/7 段/0 盒框`（§2.2 一致）、字段 V1 `h30 / subtle / accent+0px 1px 0px 0px / bg 透明`（§3.2 一致）、发送钮五态 `boxShadow:none` 全成立且 H1=`color(srgb 0.07592 0.36580 0.30714)`、D2=`rgb(138,138,138)`（§4 一致）；theme.css 未改任何矩阵数 |
| 8 | build + GUI 冒烟无布局跳动 | ✅ | `npm run build` exit 0；冒烟 44/44 PASS；聚焦/失焦零位移实测：字段 top `90.8→90.8`、自由材料 `283.6→283.6`、追问 `710→710`（±0.6 容差内零差）；聚焦厚化不占布局（h 29.8 不变） |
| 9 | diff 范围 | ✅ | `git diff --stat`：`src/theme.css`（代码面唯一）+ `AI_DEVELOPMENT_GUIDE.md`（任务要求的登记行）；**无任何 TSX / electron/ 改动**；另新增本报告（任务要求）；design-samples 未删改 |
| 10 | reduced-motion | ✅ | 新增过渡全部位于 `@media (prefers-reduced-motion: no-preference)` 块；reduce 模拟下 `.wb-field` 与 `.wb-composer textarea` `transitionDuration=0s`，聚焦线瞬时可见（accent + `0px 1px 0px 0px` 厚化仍在场） |

## 三、§8 #5 独立窗口同源 + #6 GUI 冒烟（44/44 PASS）

- **#5 独立窗口（Ctrl+Alt+K 宿主）**：`windowAPI.workbench("toggle")` 呼出后经 CDP 连 `workbench.html`，与右侧栏逐参数核对 `wbAi / fieldFront / freeTa / composer / composerTa / send / ddAuto`（border/bcBottom/bg/pad/h/shadow）**全部一致**（容器只比样式参数，高度随宿主布局不参与）；`data-placement=window` 且 `.wb-ai` 上缘 0。侧栏截图 `tests/tmp-d142-after-manual.png` ↔ 窗口截图 `tests/tmp-d142-after-window.png`。
- **#6 冒烟场景**（同脚本内 44 断言全绿）：右/底/独立窗口三处开合（顶栏入口 + Esc + `workbench toggle`）；手动页签 问答题↔填空题 与 AI 页签 解释↔制卡 切换；正面/背面字段与自由材料/追问输入（CDP `Input.insertText` 中文落值）；聚焦/失焦零位移；字段悬停线 strong、聚焦 accent+厚化；发送钮 禁用（grey-1 + D2 138 字 + default 光标）→启用（accent + 白字）→hover（`--accent-hover` 深一档、无阴影）→移出回落；更多区展开（dd ghost、标签裸排、wb-line 实底）；填空工具行 ghost；Esc 收起/重开（右、底两处）；reduce 模式。

## 四、复拍对比结论（与基线同视角，2750×1875）

复拍 `tests/tmp-d142-after-{manual,解释,制卡}.png`（流程与 `tmp-d142-dock-census.mjs` 完全一致：同 fixture、同等待、先拍后交互）。对照结论：
1. **盒框全消失**——两字段、两个下拉（选择领域/自动）、标签输入、两 textarea（自由材料/追问）、禁用描边（AI 制卡）7 处四边盒框全覆盖消失；像素扫描印证：基线同列 13 段线（其中强灰 163 共 8 段）→ 新版 7 段（全部 subtle 224 或 accent）。
2. **无 1px 裁字**——`scrollHeight ≤ clientHeight`（29/29、31/31）；裁剪区目检无截字。
3. **左缘 16px 对齐（R3）**——字段内文与标题行左缘 diff = 0（原 25px 叠加错位消失）；自由材料/追问占位文字同为 16px（裁剪目检）。
4. **双线噪点消除**——`.wb-ai` 上缘 strong 线与标题 hairline 的「双线」像素级确认消失（y212 强线 → 无）。

## 五、偏离项（按 §8.1 口径登记 2 条）

1. **样张 `.wb-field-inner` 的 `position:relative; z-index:1` 未复刻**。原因：`.wb-pick`（absolute、z auto）与内容（z:1）绘制层级会反转，破坏「paper 底遮住下方文字」的 D123 保留项（§6.2-5）；该属性不在 §3.2 参数矩阵与 §7 测量口径内，对验收数值零影响（字段 h/border/bg/boxShadow 实测与样张一致）。2. **两类 textarea 的「出」档过渡（`--dur-exit/--ease-exit`）为按 §3.1 机制补齐**。样张仅 `.wb-field` 写出档；数值均取既有 token，未改任何矩阵数；reduce 下经 `transition:none` 归零（#10 要求「瞬时出现」在四类输入面同时成立；样张未含此块，属机制补全）。

## 六、证据文件索引（tests/ 下，tmp- 前缀为临时产物的既有惯例）

- 复拍：`tmp-d142-after-manual.png` / `-解释.png` / `-制卡.png`；底部与窗口：`tmp-d142-after-bottom.png` / `-window.png`
- 机械明细：`tmp-d142-after-census.json`（44 断言 + 各态 computed 快照）；控制台留档 `tmp-d142-after-gui.log`
- 探针脚本：`tmp-d142-after-gui.mjs`（自起自清版 GUI 冒烟）；`tmp-d142-pixel-scan.cjs` / `tmp-d142-window-scan.cjs`（像素线审计）；`tmp-d142-crop*.cjs` + `tmp-d142-crop-*.png`（局部比对）
- 样张复跑：`tmp-d142-sample-metrics.log`；构建：`tmp-d142-build.log`

## 七、终审修复（2026-10-12 · R11 坞内「标签」输入焦点可见性）

> 触发：`docs/design/D142-CODE-REVIEW.md` §三【必须修复 1】（终审「不合格」，唯一必修项——键盘焦点可见性回归）。口径唯一来源：设计稿 §6.1 R11 + §6.3（落点与机械验收 ①–⑥）。归属链：ui-ux-architect 补口径（已登记 R11/§6.3）→ frontend-builder 落规则（本节）。

**1. 修复内容**（`src/theme.css` 两处，零 TSX / 零 DOM；本文件 L>8238 的行号相对第一节清单**后移 5 行**）：

- L8238 就地修订（同选择器、同 `.wb-more` 作用域，其余声明不动）：
  `.wb-more .tag-input-box input { padding: 0; background: none; border: 0; border-bottom: 1px solid var(--border-subtle); }`
  ——四边框仍删（§2 #5「输入面不用盒框」政策不回归），下缘 1px `--border-subtle` 底线常驻。
- L8239–8243 紧随新增（必需）：
  `.wb-more .tag-input-box input:focus, .wb-more .tag-input-box.expanded input { border-bottom-color: var(--accent); }`
  ——坞内 base 与 base `:focus`/`.expanded`（L4096/L4097）同为 (0,2,1) 且坞内规则源序更后，不显式 (0,3,1) 覆盖则聚焦/展开期底线取色会被反向压回 subtle。不加 transition（同 `.wb-line` 瞬时色迁）、不加 `!important`。

**2. 机械验收数据**（GUI 复跑，自起自清；`tests/tmp-d142-after-census.json` 新增 tagFocus / tagPanel / tagBlur / tagDark 快照）：

| 判据（§6.3） | 实测 |
| --- | --- |
| ① 坞内两组规则在场 | `grep -n "tag-input-box"`：L8238（subtle 底线）+ L8242–8243（accent 覆盖） |
| ② 聚焦（终审条件②） | `borderBottomColor` rgb(22,106,89)、`borderBottomWidth` 0.8px（=1px@DPR2.5 吸附回算，宽>0）、`borderTopWidth` 0px（顶/左/右全 0——无四边盒框回归） |
| ③ 失焦（面板收回卸载后） | rgb(224,224,224)（rest 底线在场） |
| ④ 面板展开（输入 ≥1 字 → `.expanded`） | panelTop 231.2 = inputBottom 232.2 − 1（gap 0，|gap| ≤ 0.5：D106 共享边线无断口）；同刻底缘仍 rgb(22,106,89)（审查条件④） |
| ⑤ 盒高 | 26（±0.5 内，行契约不变） |
| ⑥ build | `npm run build` ✓（新规则已入 `dist/assets/theme-*.css` 构建产物） |
| 深色顺带核验 | 聚焦底线 = rgb(63,160,138) = `body.theme-dark` 的 `--accent`（token 跟随，零新增规则） |

**3. 套件与证据**：`tests/tmp-d142-after-gui.mjs` 断言 **44 → 49**（新增 5 条：聚焦 / 面板共线 / 盒高 / 失焦 / 深色；原「#5b 标签输入裸排」随 R11 修订为「四边框仍删 + 下缘底线常驻」口径并更新放行值）；**49/49 PASS**，新旧断言零回归（原 43 条未触碰断言全部原样通过）。截图（同一裁剪区 818×165、DPR 2.5）：`tests/tmp-d142-r11-focus-on.png`（聚焦：accent 底线 + 面板共享边线）/ `tests/tmp-d142-r11-focus-off.png`（失焦：subtle 微线）。f11 闸门 `node tests/flows/f11-doc-code-drift.cjs` 15/16（唯一 L1 既有红，与 D143 基线同条，与本批无关）。
- 复跑备注：三轮复跑中首轮 47/49——2 条**未改动路径**的既有 hover 断言（发送钮 H1、领域 dd-btn）为 CDP 合成鼠标事件偶发未命中；二、三轮均 49/49（同 2 条通过），R11 新增 5 条三轮全绿。判定为环境抖动，非本批回归。
