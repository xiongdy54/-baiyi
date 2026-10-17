// @runtime: node
// 导图 v2 基准页纯函数回归（node 直跑：node tests/m15v2.bench.test.cjs）。
// 覆盖 prompt-lab/mindmapBenchCore.js（HTML→文本、EPUB 解析、作用域规划、指标汇总、KPI、CSV、历史折叠）
// 与 prompt-lab/mindmapBenchRunner.js（用假 chatStream 验证 outline/expand/explain 编排）。
const path = require("path");
const root = path.join(__dirname, "..");
const C = require(path.join(root, "prompt-lab", "mindmapBenchCore.js"));
const R = require(path.join(root, "prompt-lab", "mindmapBenchRunner.js"));
const B = require(path.join(root, "electron", "mindmapBlocks.js"));
const P = require(path.join(root, "prompt-lab", "mindmapV2Prompts.js"));
const S = require(path.join(root, "prompt-lab", "mindmapBenchSample.js"));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "")}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const para = (n, ch = "字") => (ch.repeat(30) + "。").repeat(Math.ceil(n / 31)).slice(0, n);

console.log("---- 1 htmlToText / 标题 / 实体 ----");
{
  const html = `<?xml version="1.0"?><html><head><title>T</title><style>p{color:red}</style></head><body>
    <h2 class="c">第一章 &amp; 起点</h2><p>甲&nbsp;乙 &lt;b&gt; &#20013;&#x6587;</p><div>丙<br/>丁</div>
    <script>alert(1)</script><ul><li>项一</li><li>项二</li></ul><table><tr><td>a</td><td>b</td></tr></table><!-- 注释 --></body></html>`;
  const t = C.htmlToText(html);
  check("块级换行、去标签/脚本/样式/注释、解实体", eq(t.split("\n"), ["第一章 & 起点", "甲 乙 <b> 中文", "丙", "丁", "项一", "项二", "a b"]), t);
  check("实体解码后的尖括号不会被当成标签再剥掉", t.includes("<b>"));
  check("firstHeading 取首个 h1-h3", C.firstHeading(html) === "第一章 & 起点" && C.firstHeading("<p>x</p><h4>y</h4>") === null);
  check("firstHeading ≤40 字", [...C.firstHeading(`<h1>${"长".repeat(60)}</h1>`)].length === 40);
  const ch = C.buildChaptersFromHtml(["<h1>甲章</h1><p>正文一</p>", "<p>   </p>", "<p>无标题章</p>", "<h3>丙章</h3><p>x</p>"]);
  check("章标题：首个 h1–h3，否则「第 i 部分」；空章跳过", eq(ch.map((c) => c.title), ["甲章", "第 2 部分", "丙章"]), ch);
  check("未知实体保持原样", C.decodeEntities("&foo; &amp;") === "&foo; &");
}

console.log("---- 2 EPUB：container → OPF → spine ----");
{
  const container = `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
  const opf = `<package><manifest>
    <item id="c2" href="text/ch%202.xhtml" media-type="application/xhtml+xml"/>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="img" href="cover.jpg" media-type="image/jpeg"/>
    <item id="nav" href="../nav.xhtml" media-type="application/xhtml+xml"/></manifest>
    <spine><itemref idref="c1"/><itemref idref="img"/><itemref idref="c2"/><itemref idref="missing"/></spine></package>`;
  check("parseContainerXml", C.parseContainerXml(container) === "OEBPS/content.opf");
  const sp = C.parseOpfSpine(opf, "OEBPS/content.opf");
  check("spine 顺序、跳过非 xhtml/缺失项、URI 解码、相对 OPF 目录归一", eq(sp, ["OEBPS/text/ch1.xhtml", "OEBPS/text/ch 2.xhtml"]), sp);
  check("posixJoin 处理 ..", C.posixJoin("a/b", "../c.xhtml") === "a/c.xhtml");
  const files = {
    "META-INF/container.xml": container, "OEBPS/content.opf": opf,
    "OEBPS/text/ch1.xhtml": "<html><body><h1>开端</h1><p>第一章正文。</p></body></html>",
    "OEBPS/text/ch 2.xhtml": "<html><body><p>第二章没有标题。</p></body></html>",
  };
  const zip = { file: (n) => (files[n] != null ? { async: async () => files[n] } : null) };
  C.chaptersFromEpubZip(zip).then((chs) => {
    check("chaptersFromEpubZip（假 zip）", eq(chs.map((c) => c.title), ["开端", "第 2 部分"]) && chs[1].text === "第二章没有标题。", chs);
  }).catch((e) => check("chaptersFromEpubZip（假 zip）", false, String(e)));
  C.chaptersFromEpubZip({ file: () => null }).then(() => check("缺 container.xml 抛错", false), () => check("缺 container.xml 抛错", true));
}

console.log("---- 3 作用域规划（§6.1-4） ----");
{
  const plan = (chapters) => {
    const lin = C.linearize(chapters);
    const blocks = B.segmentBlocks(lin.linear);
    return { lin, blocks, scopes: C.planScopes(chapters, blocks, lin) };
  };
  const mk = (n, i) => ({ title: `章${i}`, text: Array.from({ length: Math.ceil(n / 500) }, () => para(500)).join("\n") });
  const lin = C.linearize([{ title: "甲", text: "AAA" }, { title: "乙", text: " BBB " }, { title: "丙", text: "  " }]);
  check("linearize：\\n\\n 连接，空章跳过，spans 对得上", lin.linear === "AAA\n\nBBB" && eq(lin.spans.map((s) => [s.start, s.end]), [[0, 3], [5, 8]]), lin);

  const one = plan([mk(5000, 1)]);
  check("单章 ≤15000 字 → 一个 scope（c1，覆盖全部块）", one.scopes.length === 1 && one.scopes[0].id === "c1" && one.scopes[0].blockFrom === 1 && one.scopes[0].blockTo === one.blocks.length, one.scopes);
  const longOne = plan([mk(40000, 1)]);
  const lo = longOne.scopes;
  check("单章 >15000 字 → 按块边界切 ≤12000 字，连续无缝覆盖", lo.length >= 4 && lo.every((s) => s.chars <= 12000) && lo[0].blockFrom === 1 && lo[lo.length - 1].blockTo === longOne.blocks.length && lo.every((s, i) => i === 0 || s.blockFrom === lo[i - 1].blockTo + 1), lo.map((s) => [s.blockFrom, s.blockTo, s.chars]));
  check("切分 scope id 递增", lo.every((s, i) => s.id === `c${i + 1}`));

  const multi = plan([mk(3000, 1), mk(5000, 2), mk(4000, 3)]);
  check("多章：每章一个 scope，路径 c1..c3，块号为全局号", multi.scopes.length === 3 && multi.scopes[1].blockFrom === multi.scopes[0].blockTo + 1 && multi.scopes[2].blockTo === multi.blocks.length && eq(multi.scopes.map((s) => s.title), ["章1", "章2", "章3"]), multi.scopes);
  const small = plan([mk(3000, 1), { title: "短", text: para(300) }, mk(4000, 3)]);
  check("<800 字的章并入相邻章（前一章吸收）", small.scopes.length === 2 && small.scopes[0].title === "章1、短" && small.scopes[1].title === "章3", small.scopes.map((s) => s.title));
  const lead = plan([{ title: "序", text: para(200) }, mk(3000, 2)]);
  check("开头的小章并入后一章", lead.scopes.length === 1 && lead.scopes[0].title === "序、章2", lead.scopes.map((s) => s.title));
  const big = plan([mk(3000, 1), mk(30000, 2)]);
  const bs = big.scopes;
  check("多章中 >20000 字的章切成 ≤12000 字的子 scope", bs.length >= 4 && bs[0].title === "章1" && bs.slice(1).every((s) => s.chars <= 12000 && s.title.startsWith("章2（")), bs.map((s) => [s.title, s.chars]));
  const mid = plan([mk(3000, 1), mk(15000, 2)]);
  check("多章中 12000–20000 字的章保持一个 scope", mid.scopes.length === 2, mid.scopes.map((s) => s.chars));
  check("空输入 → 无 scope", eq(C.planScopes([], [], { linear: "", spans: [] }), []));
  const sp = C.splitByBlocks([{ start: 0, end: 500 }, { start: 500, end: 1000 }, { start: 1000, end: 1500 }], 1, 3, 1000);
  check("splitByBlocks 贪心且每段至少一块", eq(sp.map((x) => [x.from, x.to, x.chars]), [[1, 2, 1000], [3, 3, 500]]), sp);
  const sample = plan([{ title: S.SAMPLE_TITLE, text: S.SAMPLE_TEXT }]);
  check("示例材料 ≈1,500 字 → 单 scope", S.SAMPLE_TEXT.length > 1300 && S.SAMPLE_TEXT.length < 1700 && sample.scopes.length === 1 && P.targetDepth(sample.scopes[0].chars) === 4, [S.SAMPLE_TEXT.length, sample.scopes]);
}

console.log("---- 4 指标汇总 / KPI ----");
{
  const call = (o) => Object.assign({ kind: "outline", key: "c1", startOffsetMs: 0, ttftMs: 800, ttfnMs: 1500, totalMs: 9000, promptTokens: 1000, completionTokens: 800, lines: 40, accepted: 39, dropped: 1, byReason: { unparsable: 1, orphan: 0, out_of_scope: 0, duplicate: 0, truncated: 0 }, relsDropped: 1, clamped: 2, error: null }, o);
  const calls = [
    call({}),
    call({ key: "c2", startOffsetMs: 200, ttftMs: 500, ttfnMs: 900, totalMs: 12000, lines: 60, accepted: 60, dropped: 0, byReason: { unparsable: 0, orphan: 0, out_of_scope: 0, duplicate: 0, truncated: 0 }, relsDropped: 0, clamped: 0 }),
    call({ kind: "expand", key: "c1.1", totalMs: 4000, ttfnMs: 700, ttftMs: 500, lines: 5, accepted: 5, dropped: 0, byReason: {}, promptTokens: 300, completionTokens: 200 }),
    call({ kind: "expand", key: "c1.2", totalMs: 10000, lines: 1, accepted: 0, dropped: 1, byReason: { unparsable: 1 }, promptTokens: 300, completionTokens: 50 }),
    call({ kind: "explain", key: "c1.1", totalMs: 3000, lines: null, accepted: null, dropped: null, byReason: null, relsDropped: null, clamped: null, promptTokens: 200, completionTokens: 90 }),
  ];
  const s = C.summarizeRun(calls, { wallMs: 14000, outlineComplete: true, tree: { total: 100, plus: 30 } });
  check("调用数 / token", s.calls === 5 && s.outlineCalls === 2 && s.expandCalls === 2 && s.explainCalls === 1 && s.promptTokens === 2800 && s.completionTokens === 1940 && s.totalTokens === 4740, s);
  check("全局 TTFN = min(起点偏移+调用内 TTFN)；与 TTFT 之差取同一调用", s.ttfnMs === 1100 && s.ttfnOverTtftMs === 400, [s.ttfnMs, s.ttfnOverTtftMs]);
  check("节点数 / 丢弃行率（只计 outline+expand）", s.nodes === 104 && s.lines === 106 && s.dropped === 2 && Math.abs(s.dropRate - 2 / 106) < 1e-9 && s.byReason.unparsable === 2, s);
  check("+ 节点占比 / 关系丢弃 / 钳制", s.plusRatio === 0.3 && s.relsDropped === 3 && s.clamped === 6, s);
  check("深挖 P50/P90 与零产出率", s.expandP50Ms === 4000 && s.expandP90Ms === 10000 && s.expandZeroRate === 0.5, s);
  check("percentile 最近秩", C.percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50) === 5 && C.percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90) === 9 && C.percentile([], 50) === null);
  const k = Object.fromEntries(C.judgeKpi(s, { chars: 2688 }).map((x) => [x.key, x.status]));
  check("KPI 判定：框架 14s 过、TTFN 差过、P50/P90 过、零产出 50% 挂、丢弃率 1.9% 过", eq(k, { framework: "pass", ttfn: "pass", expandP50: "pass", expandP90: "pass", zeroRate: "fail", dropRate: "pass" }), k);
  const k2 = Object.fromEntries(C.judgeKpi(C.summarizeRun(calls.slice(0, 1), { wallMs: 35000, outlineComplete: true, tree: { total: 10, plus: 1 } }), { chars: 2000 }).map((x) => [x.key, x.status]));
  check("框架 35s → 红；无深挖 → 深挖项 na", k2.framework === "fail" && k2.expandP50 === "na" && k2.zeroRate === "na", k2);
  const k3 = C.judgeKpi(s, { chars: 20000 }).find((x) => x.key === "framework");
  check("长材料 / 未完成 run：框架 KPI 口径不适用 → na", k3.status === "na" && C.judgeKpi(C.summarizeRun(calls, { wallMs: 1, outlineComplete: false }), { chars: 100 })[0].status === "na");
  const dr = C.judgeKpi(C.summarizeRun([call({ lines: 100, accepted: 96, dropped: 4 })], { wallMs: 1000, outlineComplete: true }), { chars: 100 }).find((x) => x.key === "dropRate");
  check("丢弃率 4% → 红", dr.status === "fail", dr);
  const empty = C.summarizeRun([], {});
  check("空调用不抛、比率为 null", empty.calls === 0 && empty.dropRate === null && empty.ttfnMs === null && empty.plusRatio === null);
}

console.log("---- 5 CSV / 历史折叠 ----");
{
  const csv = C.toCsv([{ a: "x,y", b: 'he said "hi"', c: "line1\nline2", d: null, e: 3, f: "=SUM(A1)", g: "-5" }], [{ key: "a", title: "甲" }, { key: "b", title: "乙" }, { key: "c", title: "丙" }, { key: "d", title: "丁" }, { key: "e", title: "戊" }, { key: "f", title: "己" }, { key: "g", title: "庚" }]);
  check("CSV 转义（逗号/引号/换行）、空值、CRLF、公式前缀", csv === '甲,乙,丙,丁,戊,己,庚\r\n"x,y","he said ""hi""","line1\nline2",,3,\'=SUM(A1),-5\r\n', JSON.stringify(csv));
  const run = { type: "run", runId: "r1", ts: Date.UTC(2026, 9, 17, 4, 5, 6), material: "示例", chars: 1436, blocks: 14, scopes: 1, concurrency: 4, preset: "goat", model: "m", summary: { wallMs: 9000, ttfnMs: 1200, calls: 2 }, kpi: [] };
  const row = C.runToRow(run);
  check("runToRow 合并汇总字段", row.runId === "r1" && row.model === "m" && row.wallMs === 9000 && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(row.time), row);
  const callRow = C.callToRow({ runId: "r1", ts: run.ts, kind: "outline", byReason: { orphan: 2 } });
  check("callToRow 展开 byReason", callRow.orphan === 2 && callRow.kind === "outline");
  const txt = [JSON.stringify(run), JSON.stringify({ type: "call", runId: "r1", kind: "outline" }), "坏行{", "", JSON.stringify(Object.assign({}, run, { ts: run.ts, summary: { wallMs: 9500, calls: 3 } })), JSON.stringify(Object.assign({}, run, { runId: "r2", ts: run.ts + 1000 }))].join("\n");
  const h = C.foldHistory(txt);
  check("foldHistory：同 runId 取最新、坏行跳过、按时间倒序、calls 分组", eq(h.runs.map((r) => r.runId), ["r2", "r1"]) && h.runs[1].summary.wallMs === 9500 && h.calls.get("r1").length === 1, h.runs.map((r) => [r.runId, r.summary.wallMs]));
  const cols = C.RUN_COLUMNS.concat(C.CALL_COLUMNS);
  check("列定义无重复 key（各表内）", new Set(C.RUN_COLUMNS.map((c) => c.key)).size === C.RUN_COLUMNS.length && new Set(C.CALL_COLUMNS.map((c) => c.key)).size === C.CALL_COLUMNS.length && cols.length > 40);
}

console.log("---- 6 Runner（假 chatStream）：outline → expand → explain ----");
async function runnerTests() {
  const events = [], persisted = [];
  let tick = 0;
  const OUT = "1 [问题] 总问题 @1-14 + {链}\n1.1 [叙事] 起点 〈公元前六世纪〉 @1-4 . &因1.2\n1.2 [论点] 危机 @5-14 + &驳1.1\n1.3 [结论] 收束 @9-14 + &支9.9\n";
  const calls = [];
  const fake = async ({ messages, abortSignal }, send) => {
    const sys = messages[0].content;
    calls.push(sys === P.OUTLINE_SYSTEM ? "outline" : sys === P.EXPAND_SYSTEM ? "expand" : sys === P.EXPLAIN_SYSTEM ? "explain" : "?");
    if (abortSignal && abortSignal.aborted) { const e = new Error("已取消"); e.code = "cancelled"; throw e; }
    send({ thinking: 123 });
    const text = sys === P.OUTLINE_SYSTEM ? OUT : sys === P.EXPAND_SYSTEM ? (messages[1].content.includes("【当前节点】[论点] 危机") ? "1 [理由] 甲 @5-7 .\n" : "1 [理由] 甲 @9-10 .\n2 [理由] 乙 @11-12 .\n") : "这一部分回答问题。";
    for (const ch of text) send({ delta: ch });
    return { usage: { prompt_tokens: 500, completion_tokens: 120 }, finishReason: "stop", ttftMs: 300, firstByteMs: 200 };
  };
  const runner = R.createBenchRunner({
    chatStream: fake, getAIConfig: () => ({ preset: "goat", presetName: "Goat", model: "fake-1", apiKey: "SECRET" }),
    emit: (e) => events.push(e), persist: (r) => persisted.push(r), now: () => (tick += 50),
  });
  const { runId, done } = runner.startRun({ title: "示例", chapters: [{ title: "示例", text: S.SAMPLE_TEXT }], concurrency: 99 });
  await done;
  const nodeEv = events.filter((e) => e.t === "node");
  check("run-start 带块文本与 scope；并发被夹到 ≤8", events[0].t === "run-start" && events[0].blocks.length === 14 && events[0].scopes[0].id === "c1" && events[0].concurrency === 8, events[0].concurrency);
  check("节点路径挂在本地章节点 c1 下（basePath=c1）", nodeEv.map((e) => e.node.path).join() === "c1.1,c1.1.1,c1.1.2,c1.1.3" && nodeEv[0].node.parentPath === "c1", nodeEv.map((e) => e.node.path));
  const relEv = events.filter((e) => e.t === "rel");
  check("前向引用 &因1.2 在 1.2 出现后经 onRel 补回；&支9.9 到 end 丢弃", relEv.length === 1 && relEv[0].from === "c1.1.1" && relEv[0].target === "c1.1.2" && events.find((e) => e.t === "summary").summary.relsDropped === 1, relEv);
  const rec = persisted.find((p) => p.type === "call");
  check("调用记录：token / TTFT / TTFN / finishReason / 行数", rec.promptTokens === 500 && rec.completionTokens === 120 && rec.ttftMs === 300 && rec.firstByteMs === 200 && rec.finishReason === "stop" && rec.ttfnMs > 0 && rec.lines === 4 && rec.accepted === 4 && rec.model === "fake-1", rec);
  check("Key 不进入任何事件/记录", !JSON.stringify(events).includes("SECRET") && !JSON.stringify(persisted).includes("SECRET"));
  const st = (p) => runner.getRun(runId).nodes.get(p).state;
  check("封顶门：本地下限/模型 . 状态", st("c1.1.1") === "leaf" || st("c1.1.1") === "floor", st("c1.1.1"));
  const nodesOf = () => runner.getRun(runId).nodes;
  check("存在可深挖的 + 节点（未触底）", st("c1.1.2") === "open" && st("c1.1.3") === "open" && st("c1.1") === "expanded", [...nodesOf().values()].map((n) => [n.path, n.state]));
  const r1 = await runner.expand(runId, "c1.1.3");
  check("expand 返回 ≥2 个新子节点 → expanded，子路径挂在节点下", st("c1.1.3") === "expanded" && r1.children === 2 && nodesOf().has("c1.1.3.2") && nodesOf().get("c1.1.3.2").parentPath === "c1.1.3", r1);
  const r2b = await runner.expand(runId, "c1.1.2");
  check("expand 返回 <2 个子节点 → 回判（•回判，不再给 +）", st("c1.1.2") === "recheck" && r2b.children === 1, r2b);
  check("已展开/回判节点再点不重复调用", (await runner.expand(runId, "c1.1.2")).skipped === true && calls.filter((c) => c === "expand").length === 2, calls);
  const ex1 = events.filter((e) => e.t === "state").map((e) => e.state);
  check("状态事件序列：有子节点的 + 先转已展开；深挖 expanding → expanded / recheck", eq(ex1, ["expanded", "expanding", "expanded", "expanding", "recheck"]), ex1);
  const ex = await runner.explain(runId, "c1.1.2");
  check("explain 流式文本与账本", ex.text === "这一部分回答问题。" && events.filter((e) => e.t === "explain-delta").length === ex.text.length && persisted.some((p) => p.type === "call" && p.kind === "explain"));
  const last = [...persisted].reverse().find((p) => p.type === "run");
  check("run 记录随每次调用重写（最新者含 explain/expand 计数）", last.summary.explainCalls === 1 && last.summary.outlineCalls === 1 && last.model === "fake-1", last.summary);
  check("expand 对 . 节点不调用", (await runner.expand(runId, "c1.1.1")).skipped === true);
  // 取消
  const ev2 = [];
  const runner2 = R.createBenchRunner({ chatStream: fake, getAIConfig: () => ({ preset: "p", model: "m" }), emit: (e) => ev2.push(e), persist: () => {}, now: () => (tick += 10) });
  const r2 = runner2.startRun({ title: "x", chapters: [{ title: "a", text: para(3000) + "\n" + para(3000) }] });
  runner2.cancel(r2.runId);
  await r2.done;
  const sum2 = ev2.find((e) => e.t === "summary");
  check("取消：run-done(cancelled)、outline 未完成 → 框架 KPI na", ev2.some((e) => e.t === "run-done" && e.cancelled) && sum2.summary.outlineComplete === false && sum2.kpi[0].status === "na");
  let threw = false;
  try { runner.startRun({ title: "x", chapters: [{ title: "a", text: "   " }] }); } catch { threw = true; }
  check("空材料抛错", threw);
}

runnerTests().then(() => {
  setTimeout(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }, 50);
}).catch((e) => { console.log("  ✗ runner 测试异常", e); process.exit(1); });
