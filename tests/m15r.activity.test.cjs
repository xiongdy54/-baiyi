// v48.13（M15 批 P2）——全局后台活动指示器的状态口径回归（node 直跑：node tests/m15r.activity.test.cjs）。
// 契约：§4.19-12——指示器与界面无关（只吃全局广播）；终态文案必须诚实
// （「已更新」不是「生成完成」、候选不是失败、未继续深化不是失败、失败不覆盖旧图）。
// node 直跑（esbuild JS API 现场打包——Windows 下 execSync+npx 挂起禁用，m15r.layout 同款纪律）。
const path = require("path");
const esbuild = require("esbuild");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "")}`); }
}

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "m15r.activity.entry.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: path.join(__dirname, "m15r.activity.bundle.cjs"),
  logLevel: "silent"
});
const A = require("./m15r.activity.bundle.cjs");

const RUN = "run-1";
const DOC = "doc-1";
const emit = (p) => A.eventBus.emit("mindmap/changed", p);
const view = () => A.describeTask(A.primaryTask());

console.log("---- M15R-A1 广播 → 状态归并（指示器与所在界面无关） ----");
A.resetActivity();
A.installActivityStore();
emit({ runId: RUN, documentId: DOC, title: "优绩主义", stage: "running", done: 6, total: 19, calls: 6, budget: 300 });
{
  const v = view();
  const t = A.primaryTask();
  check("A1①：广播即可驱动状态（无需任何组件挂载）", Boolean(t) && t.documentId === DOC && t.title === "优绩主义", t);
  check("A1②：百分比由 done/total 得出", v.percent === 32, v);
  check("A1③：运行中 tone=busy 且文案是「生成中」", v.tone === "busy" && v.short.includes("生成中"), v);
  check("A1④：未完成时不可打开（没有可看的版本）", v.canOpen === false, v);
}

console.log("---- M15R-A2 阶段标签（「当前在做什么」不闪断） ----");
A.resetActivity();
emit({ runId: RUN, documentId: DOC, stage: "waiting_model", label: "深挖·本原问题", calls: 7, budget: 300 });
{
  const t1 = A.primaryTask();
  check("A2①：waiting_model 归一到运行中并记录当前节点", t1.phase === "running" && t1.label === "深挖·本原问题", t1);
  emit({ runId: RUN, documentId: DOC, stage: "running", done: 8, total: 19, calls: 8, budget: 300 });
  const t2 = A.primaryTask();
  check("A2②：随后的 running（不带 label）保留上一次标签", t2.label === "深挖·本原问题" && t2.done === 8, t2);
  check("A2③：展开面板详情含当前处理节点", A.describeTask(t2).detail.includes("深挖·本原问题"), A.describeTask(t2));
}

console.log("---- M15R-A3 终态文案诚实性 ----");
A.resetActivity();
emit({ runId: RUN, documentId: DOC, title: "优绩主义", stage: "running", done: 17, total: 19 });
emit({ runId: RUN, documentId: DOC, title: "优绩主义", stage: "completed", mapId: "map-1", published: true });
{
  const v = view();
  check("A3①：完成文案是「导图已更新」而非「生成完成」", v.short === "导图已更新", v);
  check("A3②：完成后可打开导图", v.canOpen === true && v.tone === "done", v);
  check("A3③：终态百分比收尾到 100（不停在 89% 这种不诚实读数）", v.percent === 100, v);
}

A.resetActivity();
emit({ runId: RUN, documentId: DOC, stage: "partial", mapId: "map-2", done: 9, total: 30 });
{
  const v = view();
  check("A3④：部分完成 → 明说「部分更新」且旧版本仍可用", v.short === "导图已部分更新" && v.detail.includes("旧版本"), v);
}

A.resetActivity();
emit({ runId: RUN, documentId: DOC, stage: "failed", code: "network" });
{
  const v = view();
  check("A3⑤：失败 → tone=error 且给出机读归因", v.tone === "error" && v.detail.includes("网络中断") && v.detail.includes("旧版本仍然可用"), v);
  check("A3⑥：失败不提供打开（不把旧图当成本次产物）", v.canOpen === false, v);
}

A.resetActivity();
emit({ runId: RUN, documentId: DOC, stage: "review_failed", issues: 2 });
{
  const v = view();
  check("A3⑦：语义评审未通过 → warn 而非 error（可在确认后修复）", v.tone === "warn" && v.short === "导图待确认", v);
  check("A3⑧：明说「不发布」且旧版本仍可用", v.detail.includes("不发布") && v.detail.includes("旧版本"), v);
}

A.resetActivity();
emit({ runId: RUN, documentId: DOC, stage: "cancelled", code: "cancelled" });
{
  const v = view();
  check("A3⑨：取消 → 说明缓存保留、重生成自动续跑", v.detail.includes("缓存") && v.detail.includes("续跑"), v);
}

console.log("---- M15R-A4 首层就绪 = 「可继续深化」，不是「未完成」更不是失败 ----");
A.resetActivity();
emit({ runId: RUN, documentId: DOC, title: "优绩主义", stage: "section_ready", mapId: "map-3", published: true });
{
  const v = view();
  check("A4①：已发布的首层 →「已可用 · 可继续深化」", v.short.includes("可继续深化") && v.tone === "done" && v.canOpen === true, v);
}
A.resetActivity();
emit({ runId: RUN, documentId: DOC, title: "优绩主义", stage: "section_ready", mapId: "map-4", published: false });
{
  const v = view();
  check(
    "A4②：候选首层（未顶掉旧图）→ 明说当前显示的是旧版本，且不算失败",
    v.short.includes("候选") && v.tone === "partial" && v.canOpen === true,
    v
  );
}

console.log("---- M15R-A5 多任务与处置 ----");
A.resetActivity();
emit({ runId: "run-old", documentId: DOC, stage: "completed", mapId: "map-old", published: true });
emit({ runId: "run-new", documentId: DOC, stage: "running", done: 1, total: 5 });
{
  const t = A.primaryTask();
  check("A5①：有未收敛任务时优先展示它（不被刚完成的旧任务顶掉）", t.runId === "run-new", t);
}
A.dismissTask("run-new");
{
  const t = A.primaryTask();
  check("A5②：关闭终态/收敛后回落到剩下的一条", t && t.runId === "run-old", t);
}
A.dismissAllFinished();
check("A5③：批量清理后指示器消失（返回 null，不渲染）", A.primaryTask() === null && A.describeTask(null) === null, A.listTasks());

console.log("---- M15R-A6 v48.13 P3 重启续跑：被打断 ≠ 失败（启动播种） ----");
{
  A.resetActivity();
  // 模拟应用重启后从主进程取回的「可续跑运行」
  A.seedFromRuns([
    { id: "run-interrupted", documentId: "doc-a", status: "interrupted", materialTitle: "优绩主义", callsDone: 7, updatedAt: 2000 },
    { id: "run-ready", documentId: "doc-a", status: "section_ready", materialTitle: "优绩主义", callsDone: 2, updatedAt: 3000 },
    { id: "run-done", documentId: "doc-a", status: "completed", materialTitle: "优绩主义", callsDone: 9, updatedAt: 1000 }
  ]);
  {
    const t = A.primaryTask();
    check("A6①：播种后指示器出现（用户能看到「上次那轮可以继续」）", Boolean(t), t);
    check("A6②：已完成的运行不参与播种（不反复提示已完成）", A.listTasks().every((x) => x.runId !== "run-done"), A.listTasks().map((x) => x.runId));
  }
  {
    const t = A.listTasks().find((x) => x.runId === "run-interrupted");
    check("A6③：被关闭打断 → phase=interrupted 而非 failed", t && t.phase === "interrupted", t && t.phase);
    const v = A.describeTask(t);
    check("A6④：文案是「被中断 · 可继续」而不是失败", v.short.includes("被中断") && v.short.includes("可继续") && v.tone === "partial", v);
    check("A6⑤：明说不是失败、缓存保留、零重复计费", v.detail.includes("不是失败") && v.detail.includes("零重复计费"), v);
    check("A6⑥：可打开（续跑入口）", v.canOpen === true, v);
  }
  {
    const t = A.listTasks().find((x) => x.runId === "run-ready");
    const v = A.describeTask(t);
    check("A6⑦：首层就绪的旧 run →「可继续深化」而非失败", v.short.includes("可继续深化") && t.phase === "section_ready", { s: v.short, p: t.phase });
  }
  {
    // 续跑开始后广播到达 → 同一 runId 由「被中断」变回「运行中」
    emit({ runId: "run-interrupted", documentId: "doc-a", title: "优绩主义", stage: "running", done: 1, total: 4 });
    const t = A.primaryTask();
    check("A6⑧：续跑的进度广播接管同一 runId（状态回到运行中）", t.runId === "run-interrupted" && t.phase === "running", t);
  }
  A.resetActivity();
}

console.log("---- M15R-A7 引擎子事件不得污染状态（真实现场：运行中被显示成「已取消」） ----");
{
  A.resetActivity();
  // 真实 run 50074faf 现场：深挖阶段每完成一个作业就广播一次 stage=expand，
  // 另有 coverage_audit / retry 子事件。P2 首版把 stage 直接当阶段存，
  // describeTask 落到 default 分支 → 指示器显示「已取消」（用户在一次正常运行里看到两次）。
  emit({ runId: "run-sub", documentId: "doc-b", title: "优绩主义", stage: "running", done: 2, total: 22 });
  emit({ runId: "run-sub", documentId: "doc-b", title: "优绩主义", stage: "expand", done: 5, total: 22, calls: 5 });
  {
    const t = A.primaryTask();
    const v = A.describeTask(t);
    check("A7①：expand 子事件后仍是「生成中」而非「已取消」", t.phase === "running" && v.short.includes("生成中"), { phase: t.phase, short: v.short });
  }
  emit({ runId: "run-sub", documentId: "doc-b", stage: "coverage_audit", transitionChars: 10, structuralChars: 0, tasks: 0, gapChars: 0 });
  emit({ runId: "run-sub", documentId: "doc-b", stage: "retry", attempt: 2 });
  {
    const t = A.primaryTask();
    const v = A.describeTask(t);
    check("A7②：coverage_audit / retry 子事件后仍是「生成中」", t.phase === "running" && v.short.includes("生成中"), { phase: t.phase, short: v.short });
    check("A7③：进度数字保守不回退（子事件不带 done 时保留既有值）", t.done === 5 && t.total === 22, { done: t.done, total: t.total });
  }
  // 未知事件绝不编造状态
  emit({ runId: "run-sub", documentId: "doc-b", stage: "something_new_from_future" });
  {
    const t = A.primaryTask();
    check("A7④：未知阶段沿用上一次状态（不编造「已取消」）", t.phase === "running", t.phase);
  }
  // 终态仍然是终态（子事件归一没有把终态吞掉）
  emit({ runId: "run-sub", documentId: "doc-b", stage: "completed", mapId: "m1", published: true });
  {
    const v = A.describeTask(A.primaryTask());
    check("A7⑤：终态不受影响（仍能正确显示「导图已更新」）", v.short === "导图已更新", v);
  }
  A.resetActivity();
}

console.log(`\n==== SUMMARY ${pass}/${pass + fail} ====`);
if (fail) process.exit(1);
