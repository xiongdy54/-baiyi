# 成长信号重设计（GROWTH-SIGNALS-REDESIGN）

> 起因：用户 2026-10-19 指令——「这种设计缺陷的信号全部去掉，请你帮我先完全重新设计有哪些值得并且可以发现的用户成长信号，请完全从头设计」。作用面＝**三端一起修**（复习提示条 / 会话成果汇总 / 成长记录）。
> 上游契约：`AI_DEVELOPMENT_GUIDE.md` §4.17（成长反馈只读契约）、§6.6.1（正反馈分级总表）；实现居所 `electron/growth.js`（判定口径唯一）、`electron/db.js`（只读出口）、`src/lib/growthStrings.ts`（文案唯一）。
> 本文件是**设计稿**，已于 **v49.23 / D196 全部实现**（登记见 `AI_DEVELOPMENT_GUIDE.md` §8.1 决策 D196；涉及引擎 `electron/growth.js`、出口 `electron/db.js`、文案 `src/lib/growthStrings.ts`、测试三套件与契约章节 §4.17-5 / §6.6.1）。

---

## 0. 缺陷根因（为什么必须重设计）

现有 `material` / `group` 信号的口径是**现状比率/现状集合**，却被当成「历史里程碑」使用：

| 维度 | 现状写法（`electron/growth.js`） | 问题 |
| --- | --- | --- |
| `material` | 覆盖率 = 已巩固卡数 / **当前**活跃卡总数；≥50% 记「过半」、=100% 记「全覆盖」；`firstCrossings` 掉回阈值下方即**重新武装** | 分母是**当前**材料规模：用户持续制卡 → 分母变大 → 全部历史点覆盖率被摊薄 → 掉回阈值下（重新武装）→ 后续再把新卡巩固 → **再报一次**同一里程碑 |
| `group` | 组成员 = **当前** `sibling_key` / `knowledge_point_id` 集合；「全员达同一阶段」按重放求首达 | 新增同组卡 → 全员达标不再成立 → 重新武装 → 再报一次；且早先跨档点会**挪位** |

**实测证据**（直接调用 `electron/growth.js` 纯函数 `deriveMaterialEvents` / `deriveGroupEvents`）：

```
阶段1  20 卡全巩固            → material/full seq=20   material/half seq=10
阶段2  新加 1 张(未复习)       → material/half seq=11           (full 消失)
阶段3  新卡首次复习            → material/half seq=11
阶段4  新卡巩固(seq22)        → material/full seq=22   material/half seq=11   ← 「已全部」再次触发，落在刚评分的卡上
阶段5  再加 10 卡并巩固        → material/full seq=32   material/half seq=16
--- group ---
组内 2 卡均 review            → group seq=2
再加 1 张同组卡(seq5 达 review) → group seq=5            ← 同一组的毕业事件整体挪位
```

后果（三端）：① 复习页**提示条重复弹**——`getGrowthAfterReview` 的防回灌只按 `triggerSeq === 本次评分 seq` 过滤，而漂移后的跨档点恰好落在刚评分的卡上（阶段 4）；② 会话汇总同理；③ 成长记录里该材料的**日期一路后移**，不是稳定历史。

同类缺陷在 D175（v49.1）已为 `relearning-recovery` 修过一次（「每卡仅首次」），但 material / group 未享同样修法。

---

## 1. 设计原则（新，硬性）

- **P1 真实性（沿用 §4.17-3）**：信号一律 = 对既有原始证据（`review_logs` 含 before/after 快照 + `cards`，GF-2 加 `knowledge_evidence` 等）的**纯函数重算**；零新表、零新写路径、不写 FSRS/LKM、不进调度与推荐。
- **P2 单调性（本次新增，最关键）**：一个信号所依赖的量，必须在**该实体（卡 / 材料 / 领域）的整个生命周期内单调不减**。**禁止**任何以「当前集大小 / 当前总量」为分母的**现状比率**型指标当历史里程碑（这正是 material/group 的病根）。
- **P3 一次即永**：每个 `(事件类型, 实体, 维度)` 只报一次；实现上用**「取序列首个跨档点」**（`find` 语义），**不再使用「掉回阈值下方即重新武装」**。
- **P4 分面纪律（本次新增）**：**成长记录**（历史档案、被动盘点）只收**聚合型 / 稀有型**信号；**每卡都会经历**的过程性信号只进**即时提示条**与**会话汇总**（随时间流动，不堆积成墙）。
- **P5 撤销联动（沿用 §4.17-6②）**：撤销评分物理删日志 → 派生事件**静默回退**；重评真实跨越可再次触发（对 P3 的 `find` 而言：首个跨档点被删则顺延到下一个）。
- **P6 沿用红线**：防回灌（只报刚提交评分触发的跨越）、单次评分至多一条（取最高级）、L2 单日折叠、措辞分层（记忆层只说记忆语言）、无惩罚 / 无总分 / 无庆祝动画 / 无排行榜 / 无推送（§4.17-3/-7、§6.6.5）。

### 反模式清单（重设计后永久禁止）

- **A1 现状比率型**：分母取「当前集大小」（材料规模、组成员数、全库总量）。→ 删 `material`(旧) / `group`。
- **A2 重新武装型**：阈值量掉回下方后再次跨越即再报（`firstCrossings` 的 armed 逻辑）。→ retention 类改 `find`。
- **A3 线性堆积型**：每卡一条、随卡数线性增长。→ 只进提示条/汇总，**不进成长记录**。

---

## 2. 新信号总表（GF-1 记忆层＝本批可落地）

| 序 | tier | 事件 | 触发口径（可重算） | 单调性 | 投放面 | 文案（示例） |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | L2 建制 | `material`（**重定义**：材料累计巩固关口） | 该材料（书维 / 领域维）**累计「曾进入长期记忆」的卡数**首次达到关口 N（**N ∈ {50, 100, 150, 200, …}，每 50 一档、无上限**）；`曾进入长期记忆` = 存在某条 `≤ 该 seq` 的日志其 `after` 满足 `state==="review" && stability>21`（与 stats 漏斗「已巩固」同阈值，口径唯一） | ✅ **单调不减**（某卡一旦达标则此后恒算数；新增卡在加入前不贡献计数 → 历史跨档点稳定不漂移） | 提示条 + 汇总 + **记录** | 「《XX》已有 150 张卡进入长期记忆」/「『XX 领域』已有 200 张卡进入长期记忆」 |
| 2 | L1 结构 | `domain-entry`（**GF-1 简化版，新增**） | 某 UDC 主领域码**首次**出现「曾进入长期记忆」的卡（该领域第一条 `stability>21 && state==="review"` 日志） | ✅ 首次型（单调首次，一旦达成永不复报） | 提示条 + 汇总 + **记录** | 「开始进入新领域：XX」 |
| 3 | L2 建制 | `leech-recovery`（**保留判定，但退出数据页**） | 曾 leech（历史 `leech_before_json` 非空或现挂 `leech_json`）的卡其后**首次** `state==="review" && stability≥21` | ✅ 每卡至多一次 | 提示条 + 汇总（**不入成长记录**） | 「那张总记不住的卡稳住了」 |
| 4 | L2 建制 | `retention-180`（**改 `find`**） | 单卡 `stability` **首次** ≥180 天（取序列首个跨档点，不再重新武装） | ✅ 历史首次固定（回落不重复报） | 提示条 + 汇总（**不入成长记录**） | 「这张卡半年不用复习了」 |
| 5 | L3 次要 | `retention-60`（**改 `find`**） | 单卡 `stability` 首次 ≥60 天 | ✅ 同上 | **仅会话汇总** | 「这张卡进入 60 天档」 |
| 6 | L2 建制 | `relearning-recovery`（**保留判定，但退出数据页**） | 单卡**首次** `relearning → review`（D175 已定；判定不变） | ✅ 每卡至多一次 | 提示条 + 汇总（**不入成长记录**） | 「这张卡遗忘后又回来了」 |

> 说明：第 1、2 项是本批的**聚合型 / 稀有型**信号，也是**数据页「成长记录」的唯一来源**（P4 分面纪律）；第 3–6 项都是**逐卡**信号（频率≈卡数），一律只进复习提示条与会话汇总，**绝不入成长记录**（否则又会堆成一堵墙）。

### 2.1 口径细节（消除歧义）

- **`material` 关口集合**：`N = 50, 100, 150, 200, …`（**每 50 一档、无上限**——长书 / 大领域会摘出很多卡，不设顶）；`dimension = "<book|domain>:<N>"`（如 `book:150`）。entity = 书 id / UDC 主领域码。**历史序列的构建**仍按成员日志 seq 升序重放，但**值 = 累计曾达标卡数**（整数），阈值判定 `count ≥ N`；实现＝对每个材料把「50 的整数倍」逐个作为阈值求首达（累计不足 50 张的材料零事件）。原「样本门槛 ≥8」不再是事件门槛（Territory 行的样本门槛另算，不受影响）。
- **书维 / 领域维归属**：书维 `libraryItemId`（经 `contextRef.documentId` join，在 db 出口完成）；领域维 `domain[0]`（UDC 主领域码，与 `stats:overview` 同口径）。无归属的卡不入相应维度（沿用现有规则）。
- **活跃卡判据**：沿用 `isActiveCard`（非归档、非挂起）；已删卡由 SQL 层过滤。**挂起不改变历史累计**（挂起是现状，不是历史抹除）。
- **撤销**：删日志 → 该卡的「曾进入长期记忆」证据若落在被删日志上则回退 → 计数可能回落 → **跨档点顺延**（P5，静默）。
- **v22 前无快照旧日志**：不参与判定；全无可读快照的卡按当前状态恒定参与（沿用既有妥协，须在设计稿登记该边界）。

---

## 3. 退役清单

| 退役项 | 理由 |
| --- | --- |
| `material`（旧口径：过半 / 全覆盖比率） | A1 现状比率型；分母随扩容 → 反复触发 / 时点漂移（见 §0 实测）。**由 §2 第 1 项「累计巩固关口」取代**。 |
| `group`（组级毕业） | 同上（A1）；且组为**制卡动作单元**概念（翻转对 / 分字拆卡 / 词典四卡），对用户**不可见**（无法点开看是哪几张），信号价值低。**整体移除**（不再产出）。 |
| `firstCrossings` 的「重新武装」分支（对 memory 层） | A2；retention 类改 `find`。GF-2 若将来需要「真实的重做」语义，须单独论证后登记。 |

> `relearning-recovery` **判定保留、投放面收窄**（移出成长记录）：它满足 P2/P3，但属 A3 线性堆积型（会遗忘的卡都会经历一次，频率≈卡数），放进记录会重新变成「一面墙」——正是用户最初抱怨的对象。

---

## 4. GF-2 知识层（维持原表，阻塞于缺口 G1，本批不动）

`transfer-first` / `application-first` / `kp-strong` / `kp-functional` / `structure-link` / `domain-entry`——数据面依赖 `knowledge_evidence` / `learner_knowledge_states` / `knowledge_relations` / Frontier，**契约修订前不实现**（`deriveKnowledgeEvents` 现状即抛错占位）。本次重设计不改其口径；实现时须同样满足 P2/P3。

---

## 5. 成长记录（Growth Records）的新构成

- 记录面 ＝ **`material`（新口径）+ `domain-entry`（GF-1 简化版）+ GF-2 各项**。**全部逐卡型信号（`leech-recovery` / `relearning-recovery` / `retention-60` / `retention-180`）一律不入成长记录**（用户 2026-10-19：「这四个不要出现在数据页面中，因为这个也会很多」）。
- 每页 6 条分页（v49.22 / D195 已实现），页码窗口 + 省略号跳页。
- 头部计数 `totals` 随记录同源计数（口径同步更新）。
- 无任何逐卡型项进入记录（`leech-recovery` / `relearning-recovery` / `retention-60` / `retention-180`）；这些只在复习提示条与会话汇总出现。

---

## 6. 实现影响与任务拆解

| # | 任务 | 建议执行者 | 涉及文件 | 可机械检查的验收标准 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| T1 | 判定层：`material` 改累计巩固关口（书 / 领域两维 × `N = 50, 100, 150, …`，每 50 一档、无上限）；**新增 `domain-entry`（GF-1 简化版）**；删 `deriveGroupEvents`；retention 类改 `find` 语义（新增 `firstOnly` 或改 `firstCrossings` 用法） | core-engineer | `electron/growth.js`、`tests/growth.test.cjs` | `node tests/growth.test.cjs` 全绿；新增「扩容不重触发」用例（复现 §0 探针：加卡后 `material` 跨档 seq 不变、不产生第二事件） | — |
| T2 | 数据出口：`getGrowthOverview` / `getGrowthAfterReview` / `getGrowthSessionSummary` 停止调用 `deriveGroupEvents`；**成长记录档案收窄为只含 `material` / `domain-entry`**（`group` / `leech-recovery` / `relearning-recovery` / `retention-*` 全部移出档案） | core-engineer | `electron/db.js`、`tests/m13.test.cjs` | `node tests/m13.test.cjs` 全绿；断言档案不含任何逐卡型（`group`/`leech-recovery`/`relearning-recovery`/`retention-60`/`retention-180`），只含 `material` / `domain-entry` | T1 |
| T3 | 文案层：`material` 文案改累计计数；**新增 `domain-entry` 文案**；删 `group` 文案；口径注释同步 | frontend-builder | `src/lib/growthStrings.ts`、`src/i18n/locales/{en,ja}.ts` | `node tests/i18n.test.cjs` 0；`tsc --noEmit` 0 | T1 |
| T4 | 呈现层：成长记录分页保持（D195）；`data-*` 探针不变 | — | `src/components/dashboard/GrowthEventsWidget.tsx` | 已实现，无需再改（若 `material` dimension 形式变化则同步探针） | T2 |
| T5 | 回归：`m13.gui.mjs` 种子改以「**多领域 domain-entry**（8 张卡各带一个不同 UDC 领域码并巩固 → 8 条记录 = 2 页）」或「书维 material ≥50 巩固卡」造档案并断言；全量 GUI/闸门与 main 基线对照 | bug-fixer | `tests/m13.gui.mjs`、`tests/flows/*` | `npm run build` 通过；m13 三套件 + `f27` 全绿或与 main 基线一致 | T1–T3 |
| T6 | 文档收口：§4.17-5 事件模型、§6.6.1 总表、设计稿 `GROWTH-FEEDBACK-D129.md` §3.2/§5.3 按本稿改写 | 总控（机械） | `AI_DEVELOPMENT_GUIDE.md`、`docs/design/GROWTH-FEEDBACK-D129.md` | `f11` / `f18` / `f24` 闸门全绿 | T1–T3 |

**顺序**：T6 的契约改写（§4.17-5 / §6.6.1）先于 T1 动码（§7.1.5「先改文档再编码」）；其余 T1 → T2/T3 → T5。

---

## 7. 已裁定（用户 2026-10-19）

1. **`material` 关口集合**：`N = 50, 100, 150, 200, …`——**每 50 一档、无上限**（长书 / 大领域会摘出很多卡，不设顶）。取代首轮裁定的 `{8, 25, 50, 100, 250}`。
2. **`domain-entry`**：**GF-1 先落简化版**（某 UDC 主领域码首次出现「曾进入长期记忆」的卡）。
3. **数据页「成长记录」只收聚合 / 稀有型**：`leech-recovery` / `relearning-recovery` / `retention-60` / `retention-180` 这四个**逐卡型一律不出现于数据页**（只保留在复习提示条与会话汇总）；`leech-recovery` 相应从记录面移出（取代首轮「保留 leech-recovery 入记录」）。
4. **`material` 文案**：照本稿「《XX》已有 N 张卡进入长期记忆」措辞（实现批可微调，须回改 §6.6.1）。

## 8. 登记与取代关系

- 本稿实现时登记 **D196（v49.23）**：其口径部分**取代 D195（v49.22）**中「档案保留 material / group / leech-recovery」的表述——`group` 整体移除、`material` 改累计关口（每 50 一档、无上限）、新增 `domain-entry`、**成长记录只收 `material` / `domain-entry`**（四个逐卡型全部移出数据页）。
- 实现前先按 §7.1.5 改写 `AI_DEVELOPMENT_GUIDE.md` §4.17-5（事件模型）与 §6.6.1（分级总表），并把本稿 §2 总表逐行搬入 §6.6.1。
- D195 已实现且**不被本稿推翻**的部分：取消取数上限、成长记录分页。
