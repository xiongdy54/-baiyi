# D143 独立审查修复批报告（M1 / M2 / M3）

> 依据：`docs/design/D143-CODE-REVIEW.md` §一「必须修复项」（逐条照其位置、证据与「可机械检查的通过条件」执行，未改变口径）。
> 载体：分支 `feat/d143-startup-lag`（未提交改动上实施；不 commit / 不切分支 / 不 stash）。
> 环境约定：审查下达时注明用户 dev 实例（`npm run dev`）在场（本批全程未清理、未做任何全局 kill）；收官核查 `tasklist | grep -i electron` = 无匹配进程（dev 实例已不在场/已关闭，本批测试亦零残留）。**未运行任何会起窗口的 GUI 套件**（`*.gui.mjs` 全部跳过）。
> **未触碰真实 `%APPDATA%/incremental-reading-dev/backups/`**——其中 6 个 `.snapshot-*`≈4.2GB 历史残留由用户下次启动经本批新增的清扫机制自然回收；
> M3 的全部验证只在隔离临时目录进行（下文每处标注）。
> 改动文件（4 个）：`AI_DEVELOPMENT_GUIDE.md`、`electron/backup.js`、`electron/main.js`（启动清扫挂点日志一行）、`tests/backup.test.cjs`。零新增设置键、零 §/D 编号结构改动。

---

## M1（闸门，HIGH）f11 L4 决策号缺口 → 已修复（实现方式①：D142 预登记落地）

**修复方式**：选项①——按 D136「预登记」先例（参考 `AI_DEVELOPMENT_GUIDE.md` §8.1 D136 行；git `0688ccd`「D137 v48.93 + D136 预登记」：预留下一版本号 + 标题同步 bump），
在 §8.1 以**预留版本 v48.99** 登记 D142 行；内容与 `docs/design/D142-CARDDOCK-RESTYLE.md` 事实逐条一致（线条收敛 / 输入面变体矩阵 V1·V2·V3 / 发送钮矩阵 H1·H2·D1·D2；
用户已裁定 V1·H1·D2；样张与截图交付物；任务拆解表 7 项；**实施尚未启动（预登记，待实施批）**——无占位、无伪造内容）。

**改动点**：
- `AI_DEVELOPMENT_GUIDE.md` L1：标题 `（**v48.98**）` → `（**v48.99**）`（预留 D142 版本，f11 L3 自洽：标题 = 正文最高版本）。
- `AI_DEVELOPMENT_GUIDE.md` §8.1：D128 行后（版本降序位：48.99 > 48.98）插入 D142 行（4 列结构与表一致）。

**验证**：`node tests/flows/f11-doc-code-drift.cjs`（原始输出摘录）
```
---- F11 · L3 版本号自洽（标题版本必须等于正文最高版本；D50 那类错误的机械化防线） ----
  · 标题版本 / 正文最高版本 = 48.99 / 48.99
  ✓ 标题版本 = 正文最高版本
---- F11 · L4 决策号不缺号（§8.1 决策日志的完整性） ----
  · 正文用到的最大决策号 = D143
  ✓ D1…Dmax 无缺号（缺号＝决策未登记或编号打错）
  ✓ 最新决策号 D143 已在 §8.1 登记

==== F11 FAIL 15/16 断言 · 已知缺陷 0 · 意外转绿 0 · 83ms · seed=3720178443 cycle=0 ====
  失败: [L1 文档指向的文件必须存在（§7.3 是合同不是愿望清单）] 描述现状的段落不指向不存在的文件
```
（L1 项 `实际:` 现仅 `["src/lib/readerActionsSettings.ts"]`——本报告文件创建后，其 L1 引用已自然解析；ms 为运行读数）
- L4 ✓「D1…Dmax 无缺号」（D142 空洞关闭）——**本项通过条件达成**；L1 唯一失败为 `src/lib/readerActionsSettings.ts`（文档记载既有红，见审查报告 §9；本批 diff 未触碰）。
- L3 附带保持 ✓（若不加标题 bump 则 48.99 会打破 L3，已按 D136 先例同步）。

---

## M2（文档自相矛盾，MED）D143 行「f80 全绿」与「f80 既有红」并存 → 已修复

**改动点**：`AI_DEVELOPMENT_GUIDE.md` §8.1 D143 行内两处表述改为单一事实，与 `docs/design/D143-STARTUP-LAG-FIX-REPORT.md` §3 记录一致（实测 f80=5/7，恰 S2/S4）：
- 原文「…产物可被既有恢复路径识别）；**f80/f81 全绿**。」→ 同处改为「…；**f81 全绿；f80 见下既有红（实测 5/7，恰为 S2/S4）**。」（其后 M3 补记插在同一括号——见下）。
- 同段后文原本已写「f05/f80 为 D137（WAL sidecar 不入包）/D134（重启回填 fsrs_json）既有红，已最小复现归因（测试对齐另批）」，保留不变——现全行只有一种 f80 表述。

**验证**（GUIDE D143 行自查，grep 原始输出）
```
$ grep -n -o "产物可被既有恢复路径识别；复审 M3 修复批补启动清扫[^）]*）；f81 全绿；f80 见下既有红（实测 5/7，恰为 S2/S4）" AI_DEVELOPMENT_GUIDE.md
1472:产物可被既有恢复路径识别；复审 M3 修复批补启动清扫——`backups/` 下非本进程且非今日的 `.snapshot-*` 孤儿与跨日 `backup-*.zip.part` 回收、当日 `.part` 不误删，`electron/backup.js` `sweepBackupOrphans`，见 `docs/design/D143-REVIEW-FIX-REPORT.md`）；f81 全绿；f80 见下既有红（实测 5/7，恰为 S2/S4）

$ grep -c "f80/f81 全绿" AI_DEVELOPMENT_GUIDE.md
0
```
- **本项通过条件达成**：行内不再出现「f80…全绿」与「f80…既有红」并存；仅剩「f81 全绿；f80 见下既有红（5/7 恰 S2/S4）」+ 后文既有红归因，两者互相一致。
- 同行套件数随 M3 同步为实况：`套件：backup 36（复审 M3 新增 2 条残留清扫断言）/lm-db 67/legacyBackfill 89/f81 22 全绿`。

---

## M3（中断残留无清扫，MED）`backups/.snapshot-*` 与跨日 `.part` 泄漏 → 已修复（启动清扫）

**修复方式**：复用 D117 `backfillSidecars` 启动空闲清扫先例（main.js 既有 +5s 定时挂点，零新增定时器），扩为清扫 `backups/` 下两类中断残留；
**绝不误删在途备份**（安全边界见下）。

**改动点**：
1. `electron/backup.js` 新增 `sweepBackupOrphans(opts)` + `partFileDayTag(name)`（纯 fs、同步、永不抛出）：
   - `destDir/.snapshot-*`：**跳过本进程在途登记**（新 `activeSnapshotDirs` Set：`createBackup` mkdtemp 时登记、`finally` 清理后注销）**且只清 mtime 非今日的**——当日残留可能仍被他进程占用（单实例锁下防御性保留），次日启动自然回收；
   - `backup-*.zip.part`：从文件名解析日期（auto=`YYYY-MM-DD`；manual/safety=`YYYYMMDD-HHMMSS`，兼容 `-2` 去重后缀），**日期 = 今日的一律保留**（可能是在途构建，同日重试会覆盖复用）；解析不出日期的一律保留（保守）。
2. `backfillSidecars` 头部挂载清扫；返回对象新增 `snapshotsSwept` / `partsSwept`；导出 `sweepBackupOrphans`。
3. `electron/main.js` 启动挂点日志一行扩列（`清残留快照 N、清过期 .part M`）——让用户下次启动的 4.2GB 回收在应用日志可见（挂点本身未变，仍是 D117 的 +5s）。
4. `tests/backup.test.cjs` 新增 §7（**+2 条最小断言**，34 → 36）：隔离目录预置假 `.snapshot-orphan/`（mtime 3 天前）与非今日 `backup-auto-<3天前>.zip.part` → 被删；当日 `.part`（可能在途）→ 不误删。

**验证 1（套件 36/36）**：`ELECTRON_RUN_AS_NODE=1 npx electron tests/backup.test.cjs`（原始输出摘录）
```
== 7) 中断残留清扫（D143 复审 M3）：旧 .snapshot-* 与非今日 .part 回收、当日 .part 保留 ==
  ✓ 旧 .snapshot-* 与非今日 .part 被清扫（中断残留孤儿回收）
  ✓ 当日 .part 不误删（可能是在途构建）

M2 备份单元测试：36 通过 / 0 失败
```

**验证 2（f80 失败项不新增）**：`node tests/flows/f80-backup-roundtrip.cjs`（原始输出摘录）
```
==== F80 FAIL 5/7 断言 · 已知缺陷 0 · 意外转绿 0 · 3173ms · seed=3534491801 cycle=0 ====
  失败: [S2 包内覆盖面：userData 里每个数据文件是否都进了包] 每个数据文件都必须在包里（漏一个 ⇒ 换机还原后永久丢失）
  失败: [S4 模拟重启后逐表逐字段对账] 逐行逐字段必须一致
```
仍为 5/7 且失败项**恰为 S2/S4**（与审查基线一致，零新增失败）。

**验证 3（f81 不回归）**：`node tests/flows/f81-restore-fault-injection.cjs` → `F81 PASS 22/22 断言` ✓。

**验证 4（启动路径集成 + 在途保护，隔离目录探针，真实 backups/ 未触碰）**
- 经 `backfillSidecars`（= main.js 启动路径）调用：预置旧 `.snapshot-abc/`、旧 `backup-auto-<旧日>.zip.part`、旧 `backup-manual-<旧日>-235959-2.zip.part`、当日 `.part` 各一：
```
sorted-backfillSidecars 返回 = {"ok":true,"dir":"…\\Temp\\m3-sweep-tvBYmF","scanned":0,"written":0,"swept":0,"snapshotsSwept":1,"partsSwept":2}
清扫后目录内容 = ["backup-auto-2026-10-12.zip.part","data"]
```
  旧快照 + 两条旧 `.part` 被回收，当日 `.part` 保留。
- 在途保护（备份进行中并发清扫）：注入式快照函数内触发清扫 →
```
在途 .snapshot-* = .snapshot-ZMs25h | 在途中清扫 = {"ok":true,…,"snapshots":0,"parts":0} | 在途目录仍在 = true
完成后目录内容 = ["backup-manual-20261012-162124.zip","data","meta"]
```
  本进程持有的 `.snapshot-*` 不被清扫触碰，备份完成后由 `finally` 正常清理。

**通过条件达成说明**：套件 36/36（含 2 条新断言）、f80 失败项不新增（仍 S2/S4）、f81 22/22；
真实 `%APPDATA%/incremental-reading-dev/backups/` 全程零触碰（其 6 个历史 `.snapshot-*` 按设计留给用户下次启动回收——首日不删当日 mtime 残留、次日启动回收，属审查建议口径「非本进程、非今日」）。

---

## 附：回归保险（GUIDE 改动波及面的机械核对，均与审查基线一致）

```
npx electron tests/flows/f18-settings-matrix.cjs    → F18 PASS 84/84 ✓
npx electron tests/flows/f20-command-contract.cjs   → F20 PASS 26/26 ✓
node tests/flows/f21-ipc-bridge.cjs                 → F21 PASS 7/7 ✓
node tests/flows/f24-coverage-audit.cjs             → F24 FAIL 11/12（唯一红 R3=F91/F92 缺 § 依据，既有红）
node tests/flows/f27-restraint-redlines.cjs         → F27 FAIL 13/14（唯一红 W6，既有红）
node tests/flows/f11-doc-code-drift.cjs             → F11 FAIL 15/16（唯一红 L1=readerActionsSettings.ts，既有红；L4 已转 ✓）
```

## 附：残留与边界

- 未运行 GUI 套件（本批无 UI 改动面；审查下达时用户 dev 实例在场，本批全程未清理、收官时已不在场）。`ELECTRON_RUN_AS_NODE` 通道（backup）与 f80/f81/f18/f20/f21 无窗口流程照跑。
- 收官 `tasklist | grep -i electron` **无匹配进程**——本批未做任何全局 kill；f80/f81/f18/f20 的 electron 子进程全部正常退出，零测试残留（用户 dev 实例若在场为主线占用、不算残留，本批未触碰其数据）。
- 无 stash、无 commit、无分支切换；diff 范围 = 上列 4 文件（+ 本报告）。
