// 给 A-13 取证用：在指定 userData 里造一本材料 + 一条 status='interrupted' 的导图运行
// 用 db.execRawSql（db.js:1589 明写「仅供测试与一次性迁移脚本使用」）改状态，
// 避免依赖真实 AI Key 走完整生成链。
// 运行：SEED_USERDATA=<dir> npx electron tests/fsrs/tmp-seed-mmrun.cjs
// 用环境变量而不是 argv：经 npx + shell:true 转发时 argv 下标会漂（实测踩过）。
const { app } = require("electron");
const path = require("path");

const dir = process.env.SEED_USERDATA;
if (!dir) { console.error("缺 SEED_USERDATA 环境变量；argv=" + JSON.stringify(process.argv)); process.exit(2); }
app.setPath("userData", dir);

app.whenReady().then(async () => {
  const db = require(path.join(__dirname, "..", "..", "electron", "db.js"));
  await db.initDb();
  const NL = String.fromCharCode(10);
  const bk = db.createFromPaste(
    "A13 取证书",
    ["# 第一章 反馈", "", "负反馈调节使系统回归稳定，这是控制论的核心概念。", "", "# 第二章 控制", "", "控制论把反馈作为核心机制来研究系统的调节。"].join(NL)
  );
  const run = db.createMaterialMapRun({ documentId: bk.documentId, scopeAnchor: "book", scopeKind: "book", granularity: "standard" });
  db.execRawSql("UPDATE material_map_runs SET status = 'interrupted', error_code = 'interrupted', error_text = ?, updated_at = ? WHERE id = ?", [
    "运行被应用关闭打断（启动对账）；已完成分片保留在缓存，继续生成零重复计费",
    Date.now() - 60_000,
    run.id,
  ]);
  // 再造一条同材料的更旧历史运行：用来验 D53 的「同材料只播最新一条」在真实播种下成立
  const run2 = db.createMaterialMapRun({ documentId: bk.documentId, scopeAnchor: "book", scopeKind: "book", granularity: "standard" });
  db.execRawSql("UPDATE material_map_runs SET status = 'section_ready', updated_at = ? WHERE id = ?", [Date.now() - 7_200_000, run2.id]);
  // 第二份**不同材料**的可续跑运行：D53② 要验「切换展开行时 Δ总高=0、Δ顶边=0」，
  // 必须界面上真有两行同时存在；同材料会被播种去重成一行（那是 D53⑤ 的正确行为），测不到②。
  const bkB = db.createFromPaste(
    "A13 取证书二",
    ["# 第一章 混沌", "", "初始条件对确定性系统的长期行为具有敏感依赖。"].join(NL)
  );
  const runB = db.createMaterialMapRun({ documentId: bkB.documentId, scopeAnchor: "book", scopeKind: "book", granularity: "standard" });
  db.execRawSql("UPDATE material_map_runs SET status = 'section_ready', updated_at = ? WHERE id = ?", [Date.now() - 120_000, runB.id]);
  db.persistNow();
  console.log(JSON.stringify({ documentId: bk.documentId, runs: [run.id, run2.id, runB.id] }));
  const resumable = db.listResumableMaterialMapRuns();
  console.log("RESUMABLE=" + JSON.stringify(resumable.map((r) => ({ id: r.id.slice(0, 8), status: r.status, title: r.materialTitle, updatedAt: r.updatedAt }))));
  app.exit(0);
}).catch((e) => { console.error("SEED FAIL " + (e && e.stack ? e.stack : e)); app.exit(1); });
