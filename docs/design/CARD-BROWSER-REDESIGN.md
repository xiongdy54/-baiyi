# 卡片页重排 + 摘录详情 + 摘录页「摘录」落库修复 · 设计稿（v1）

> 状态：**已实现**（与 D80 同批落地）。本文档是 D80 的设计依据与验收清单。
> 前置：`docs/design/EXCERPT-REVIEW-LAYOUT-REDESIGN.md`（v2–v11，D70–D78 的舞台语言）、`AI_DEVELOPMENT_GUIDE.md` v48.40。
> 设计规范：better-layout（分组/对齐/渐进披露）+ swiss-international-style（Token/直角/单一焦点色/表格规范）。
> 决策登记：`AI_DEVELOPMENT_GUIDE.md` §8.1 **D80**。

---

## 0. 用户原话（2026-10-03，逐字留痕）

1. 「现在可以补充划选了，但是我刚才尝试两遍依次划选3段文字，并点击了"摘录"，但是在"卡片"页面中点击"摘录"却找不到我摘录的那段内容。」
2. 「并且卡片页面请按照排版相关的skill重新排版整理好，而且整体设计调性要与我的摘录页面复习页面看齐。」
3. 「而且卡片页面中的摘录卡片现在还有一个问题就是点击条目的任何地方都只能选中卡片，而无法查看卡片详情。」
4. （补记）「我是在摘录卡片中进行摘录时遇到找不到摘录内容的问题的」——指摘录复习页卡面，非阅读器。

---

## 1. 诊断

### 缺陷 ①：摘录页「摘录」静默不落库（HIGH）

**取证**：真实库 `%APPDATA%/incremental-reading-dev/library.db` 只读检查——

- 今天（2026-10-03）**零新增**摘录行（最新 created_at = 2026-09-30 23:32）；而用户确在摘录页卡面做过两轮 3 段划选并点「摘录」（看到了成功 toast）。
- 摘录队列最前的两条卡（9-05 到期，「优绩主义/鸭腿阿姨」两条真实内容）`context_ref_json` 为 **NULL**（早期版本数据，`document_id` 列有值）。

**根因链**：摘录页「摘录」菜单动作走 `useSelectionActions.writeExtract`，其落库父级**只认 `sourceContext` 的两个字段**（`contextRef.extractId` / `contextRef.documentId`）——contextRef 为 NULL 的老卡两字段皆空 ⇒ 两个分支都不进 ⇒ **静默 no-op**，但函数尾部的「已摘录进学习队列」toast 照弹。
次生偏差：对**有** documentId 的卡，该动作落的是 parentType="document" 的**新根摘录**（挂在源文档上），违反规格 §3.4「摘录页＝恒挂在当前卡上」（点色的 `createAnnotation` 走 `annotateParent` 是对的，「摘录」动作漏了同一装配）。

**修法**：
- `writeExtract` 改为 **`annotateParent()` 优先**（阅读器不传该注入 ⇒ 回落旧分支，逐字节不变）；`parentRange` 以动作时的显式入参合并进 contextRefPatch（`actExtractSelection` 先清选区后落库，`annotateParent` 闭包里的 faceSel 已为 null，不能依赖它）。
- `ExtractReviewView.annotateParent` 守卫放宽：`contextRef?.documentId` 缺失时回退行原生 `document_id` 列（listDueExtracts 原样透传；能进队列的行必然 INNER JOIN 过 documents ⇒ 该列必有效，不会造出挂不上 JOIN 的孤儿行）。
- 落库失败不再谎报成功：三个分支都没进时 toast「此处没有可挂靠的来源，未创建摘录」。

### 缺陷 ②：摘录行无详情（HIGH）

取证：`CardBrowser.tsx` 摘录行 `onClick={toggleSel}` + title「摘录行不展开详情，管理动作走批量条」——设计上的缺口，非回归。

**修法**：摘录行对齐闪卡行语义——**普通点击＝打开详情**，Ctrl/⌘/Shift＝多选（复选框不受影响）；新增 `ExtractDetail` 模态（与 `CardDetail` 同构）：全文（多段按 \n\n 分段展示 + 引文段数）、meta（状态/优先级/下次推送/来源/批注/创建时间）、动作（跳转原文 / 推迟 7 天 / 优先级 30·70 / 毕业·召回·归档·不再关心 / 删除），全部复用批量条同一 IPC（单条＝ids 长度 1）。

### 缺陷 ③：排版（MEDIUM，better-layout 审计）

| Severity | 位置 | 现状 | 违反原则 |
|---|---|---|---|
| MEDIUM | `.cb-toolbar` | 搜索框+3 下拉+开关+类别页签+书下拉挤成一条无框带 | better-layout「控件与内容可区分」/「按重要性排序」 |
| MEDIUM | `.cb-batch`（批量条） | 无选中时整条常驻空白；有选中时 8+ 个平铺按钮无分组 | better-layout「渐进披露需可见线索」；D70-D78「一盒一功能」 |
| MEDIUM | `.cb-batch`（牌组条） | 与批量条同款常驻条，双层条视觉重量相等 | 分组间距 ≥ 2× 组内（无组可辨） |
| LOW | 摘录表 | 完全忽略 sortBy；新摘录按到期升序沉底 | 可发现性（缺陷①的用户观感放大器） |
| LOW | 头部计数 | `.review-count` 悬空、与页签无带状关系 | 与摘录/复习页头带语言不一致 |

**修法**（结构，全部 data-* 钩子与文案保留）：

```
┌ cb-head（吸顶头带，band-line 下缘 hairline）
│  计数 meta（共·到期·难点·暂停，mono）+ preset 页签（全部/到期/难点/暂缓/知识点）
├ cb-toolbar（工具行：一盒一功能，16px gap）
│  [搜索 grow] [筛选：类型▾ 状态▾ 排序▾] [类别：闪卡|摘录|全部] [来源书▾] [记忆接地]
├ cb-deck（筛选牌组 cluster 行）
├ 表格（全宽单模块：Meta 600 表头 + grey-1 底、行 hairline、hover grey-1、数字列 mono 右对齐）
│  摘录行：普通点＝详情、Ctrl/Shift＝多选
└ stage-bar（吸底舞台栏，72px，与摘录/复习页同几何）
   左＝选择提示（未选）/ 选中计数 + 批量动作 cluster（推迟/优先级/毕业/召回/归档/不再关心/删除/查找替换）
   右＝清除选择
```

- 表格列、按钮文案、data-* 钩子逐个保留（extract.gui 78 断言依赖）。
- 摘录表按 sortBy 排序（到期=topicNextAt 升序、创建=createdAt **降**序、优先级=desc）。
- 空态、leech 卡列表、CardDetail、LeechWizard、KnowledgeManager 不动。

---

## 2. 验收清单（机械判据）

1. `tests/cards.gui.mjs`（新增，自足种子）：null-contextRef 老卡上 3 段划选摘录 ⇒ ① listAll 出现 content_markdown 三段拼接行；② `parent_type='extract'` 且 `parent_id=该卡 id`；③ 卡片页「摘录」签可见该行；④ 点行开详情模态且含全文；⑤ 关闭后多选/批量钩子仍在位。
2. `tests/multiselect.gui` ≥31 断言不回退（阅读器路径逐字节不变）。
3. `tests/extract.gui` 78 断言不回退（data-* 钩子与文案保留）。
4. `annotation-range.test` / f11 / f18 全绿。
