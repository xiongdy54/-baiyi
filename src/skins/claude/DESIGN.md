# 陶土（Claude）皮肤 · DESIGN.md

第一支 v2 皮肤（v49.0 / D173 建；v49.1 / D175 显示名去前缀为「陶土」并统一选中强调；v49.10 / D183 对齐 CDS 2.0 动效档；v49.11 / D184 输入件圆角 12px；v49.12 / D185 发丝边/骨架扫光/数字等宽；v49.13 / D186 VT 转场 300ms）。定调：把 Claude Desktop 的视觉气质搬进本应用，**不改变信息架构与交互流程**——布局、按钮位置、文字、快捷键、字体栈与字号全部不变。

## 允许

- 暖奶油纸面（浅 #f5f5f3 / 深 #0b0b0a）、纯白卡片与弹层、柔和双层阴影（浅 .05–.08 / 深 .30–.50）、hover 阴影抬升（只变阴影不位移）。
- 圆角阶梯 4 / 8 / 10 / 12 / 16 / 999px（组件级 Token 承载；嵌套圆角「内 = 外 − 内边距」）。**全应用浮层/菜单圆角经 `--radius-popover`、行级部件经 `--radius-xs` 全局生效（D175 起基线消费，皮肤零结构规则）**。**输入件 12px（v49.11 / D184）**：`--radius-input` 8→12px 对齐 CDS 2.0「输入框圆角 12px」档（用户点名采用），10 处消费面随 Token 全局生效；其余档位对齐 CDS（按钮 8=rounded-lg、卡片 10=rounded-panel、浮层 12、对话框 16、胶囊 999）。
- 陶土强调色双角色：`--accent` 浅档 #ae5630（白字 5.03:1）/ 深档 #d97757 配深字（6.34:1）；`--skin-brand: #d97757` 纯装饰（选区底、进度条、品牌点、光晕）。
- **选中强调统一（D175）**：全应用「被选中」＝ `--accent-soft` 软底 + accent 字（顶栏「制卡台」is-on 同款语言）+ `--radius-xs/control` 圆角；基线的下划线（`::after` / inset box-shadow / border-bottom）与左缘条（border-left）两类瑞士遗留指示在 skin 层全部退役。**填充语言的几何随行（D175-b/c）**：下划线让位用的非对称内衬（`.seg-tabs` 上 0/下 8px）在皮肤层改对称；**圆角选单满 bleed**——`.dd-menu`/`.md-tb-menu`/`.bar-pop` 块向内衬归零 + `overflow:hidden`，行底由容器圆角统一裁切，首/末行选中不留白边；**框式分段控件退役**——`.shelf-seg` 容器框与分隔线在皮肤层去框（软底填充下「框套框」），affordance 交给选中底 + hover。
- CDS 动效档：expo 曲线（cubic-bezier(0.16,1,0.3,1)）、按压缩放 `--press-scale: 0.98`、弹层弹簧（linear() 四预设）、视图切换淡入上浮（覆盖 D120 VT 动画）——**全部在 `body.motion-full` 作用域下**。**CDS 2.0 时长档对齐（v49.10 / D183，权威＝Skill tokens.md §7）**：按压 60ms（利落捕捉曲线不变）、视图切换 450ms（页面级大转场档，只动 skin 层 VT 规则、`--dur-view` Token 不动；**v49.13 / D186 用户裁定降 300ms**——450ms 实测体感似卡顿）；其余档位已一致——卡片悬停阴影 200ms、弹层弹簧 SNAPPY、悬停变色 150ms、退出 120ms。2.0 手册其余描述逐项处置：输入框 12px（D184 点名采用）、0.5px 发丝边（D185 点名采用，见下）、color-mix() 皮肤已用（品牌软底/焦点环）。
- **D185 三项点名启用（v49.12）**：①**0.5px 发丝边**——基线 1px 细线描边/分隔线 Token 化（`--bw-hairline`，默认 1px=瑞士不变），皮肤按 CDS `--cds-ring-hairline` 阶梯 ≥2dppx→0.5px、≥3dppx→calc(1px/3)；100%/125%/150% 显示缩放保持 1px（2x 屏才可见，与官方一致）；accent/选中类 1px 描边不参与。②**骨架屏扫光**——CDS SkeletonShimmer 同配方（90deg 白 45% 渐变带、1.8s、translateX 扫过）替换基线 1.2s 脉冲；OS 减动效时骨架静止（优于基线脉冲）。③**数字等宽**——`tabular-nums` 补基线缺口（.cap-meta/.col-num/.review-count/.review-meta；基线图表/页签计数等 25+ 处已有）。
- 焦点环走 outline（2px / 85% accent / 偏移 2px，跟随圆角）。

## 不允许

- 背景装饰层、玻璃拟态（backdrop-filter）、hover 位移/缩放、长列表逐条入场动画。
- 改字体、加载字体文件、改字号阶梯。
- 覆盖功能色族：批注 8 色 `--annot-*`、图表 `--chart-2…6`、语义色 `--success/--warning/--error` 族、书架文件夹 `--folder-*`、默认封面 `--cover-warm-*`、`--overlay-*` 固定深色覆盖层。
- 使用 CDS「0 0 0 1px 描边环」阴影（弹层/卡片已有 1px border，会变双线）。
- 任何不在 `motion-full` 作用域内的非必要动画（A6）。

## 对比度承诺（A3，skin-audit 机器复测）

`--ink` 压纸面 16.73/18.06、`--text-secondary` 压纸面 7.16/7.81、`--grey-3` 压纸面 5.28/5.68、`--accent-on` 压 `--accent` 5.03/6.34、`--accent` 压纸面 4.61/6.31——全部 ≥ 4.5:1。CDS 原色 #d97757 白字仅 3.12:1，浅色档不用它当 accent。
