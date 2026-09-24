// F41 AI 传输层故障注入（真实 socket · 本地 node:http 黑洞/截断/畸形服务）
// @runtime: electron  @id: F41  @tier: 2  @gui: false  @timeout: 900
// 运行：npx electron tests/flows/f41-ai-transport-faults.cjs
//       F41_FAST=1 npx electron tests/flows/f41-ai-transport-faults.cjs   （跳过 120s 黑洞与 30s 滴流）
//
// 既有覆盖的空白：F06 证明「离线时制卡闸门不产生垃圾卡」，F04 证明「DB 崩溃可恢复」，
//   F37 证明「落盘失败不静默」。**三者都没有碰过一根真的 socket** —— F06 直接对字符串跑
//   extractJson，绕过了 http.request / SSE 分帧 / 超时看门狗 / 重试退避。
//   「服务端不守规矩」这一整类（黑洞连接、半途 RST、429/500、Content-Type 说谎、
//   JSON 形状不对、字节级龟速、调用方取消、重复 id）从未被任何流程驱动过。
//
// 本层在 127.0.0.1 ephemeral 端口起一个可配置行为的 node:http 服务，把 ai-config.json 指向它，
//   用真实 ai.chatStream 打过去，并按 src/lib/cards.ts:431 的同一条后链路收口
//   （累积 delta → extractJson → db.createAIGenBatch → persistNow → 只读审计磁盘）。
//   每个场景两条判据：
//   T1 半截/畸形响应**不得**让任何草稿落到库里（宁可全丢，不可半落）
//   T2 调用方可见状态必须收敛：要么如实报错，要么真的有磁盘变化；
//      「resolve 成功但磁盘零变化」= 本仓库所称的 **假成功**。
//
// 依据：§3.11 AIGateway、v45 补记（socket 不活动超时）、v48.11（Retry-After 优先 / unknown_outcome）、
//       §4.4.9 成功边界、§7.1.4 重启不丢数据、A-10（ai_gen_batches 读出口）。
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, quit } = require("./lib/dbenv.cjs");

const DUMMY_KEY = "sk-test-dummy-DO-NOT-LEAK";
const MARK = "F41ZZ"; // 只可能来自本流程服务端响应的文本指纹
const FAST = process.env.F41_FAST === "1";

const flow = new Flow({
  id: "F41",
  title: "AI 传输层故障注入",
  angle: "真实 socket 上十种服务端越界行为是否造成半截卡入库或假成功",
  cites: ["§3.11", "§4.4.9", "§7.1.4", "v45", "v48.11"],
  tier: 2,
  gui: false,
});

// ---------------------------------------------------------------- 服务端夹具
function fullCardJson() {
  return JSON.stringify({
    cards: [
      { frontMarkdown: `${MARK}-Q1`, backMarkdown: `${MARK}-A1`, cardType: "qa" },
      { frontMarkdown: `${MARK}-Q2`, backMarkdown: `${MARK}-A2`, cardType: "qa" },
      { frontMarkdown: `${MARK}-Q3`, backMarkdown: `${MARK}-A3`, cardType: "qa" },
    ],
  });
}
/** 整份卡片 JSON 切成 n 段 SSE delta —— 任何一次截断都会留下「半张卡」的字节 */
function contentPieces(n = 10) {
  const s = fullCardJson();
  const size = Math.ceil(s.length / n);
  const out = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}
const sseData = (o) => "data: " + JSON.stringify(o) + "\n\n";
const usageLine = () => sseData({ id: "u1", choices: [], usage: { prompt_tokens: 111, completion_tokens: 222, total_tokens: 333 } });
const DONE = "data: [DONE]\n\n";
const deltaLine = (t, id) => sseData(id ? { id, choices: [{ index: 0, delta: { content: t } }] } : { choices: [{ index: 0, delta: { content: t } }] });

function serve(req, res, st) {
  const mode = st.mode;
  res.on("error", () => { /* 对端已断，正常 */ });
  const t0 = Date.now();
  res.on("close", () => {
    if (!res.writableEnded) st.clientClosedAt.push({ atSec: +((Date.now() - t0) / 1000).toFixed(2), bytes: st.lastBytes || 0 });
  });
  const sseHead = { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" };

  switch (mode) {
    case "blackhole": // (a) 接受连接、读完请求体，然后永不应答
      st.startedAt = Date.now();
      return;

    case "reset-mid-body": {
      // (b) 流式响应写到 ~30% 时 RST 复位
      res.writeHead(200, sseHead);
      const pieces = contentPieces(10);
      const upto = Math.max(1, Math.round(pieces.length * 0.3));
      for (let i = 0; i < upto; i++) res.write(deltaLine(pieces[i]));
      setTimeout(() => { st.resets += 1; hardReset(res); }, 40);
      return;
    }

    case "truncated-json": {
      // (c) SSE 断在 JSON 中间，然后 EOF，且不发 [DONE]
      res.writeHead(200, sseHead);
      const pieces = contentPieces(10);
      for (let i = 0; i < 6; i++) res.write(deltaLine(pieces[i]));
      res.write('data: {"choices":[{"index":0,"delta":{"content":"' + MARK + '-半');
      res.end();
      return;
    }

    case "http-429": // (d) 限流 + Retry-After
      res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "2" });
      res.end(JSON.stringify({ error: { message: "rate capped by F41 fixture" } }));
      return;

    case "http-500-html": {
      // (e) 500 + HTML 正文（坏网关常见形态：把请求头回显在报错页上）
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end("<html><body><h1>502 Bad Gateway</h1><pre>req headers: " + String(req.headers.authorization || "") + " / " + String(req.headers["user-agent"] || "") + "</pre></body></html>");
      return;
    }

    case "200-html": // (f) 200 但 Content-Type 说谎
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<!DOCTYPE html><html><body>登录已过期，请重新登录 " + DUMMY_KEY + "</body></html>");
      return;

    case "wrong-shape": // (g) 200 + 合法 JSON，形状不对
      res.writeHead(200, sseHead);
      res.write(sseData({ choices: [] })); // choices 空数组
      res.write(sseData({ choices: { delta: { content: "该是数组处给了对象" } } }));
      res.write(sseData({ choices: [{ index: 0, delta: { content: fullCardJson() } }], usage: { prompt_tokens: -999, completion_tokens: 1e18, total_tokens: "NaN?" } }));
      res.write(usageLine() + DONE);
      res.end();
      return;

    case "drip": {
      // (h) 1 字节 / 200ms 持续 30 秒后 EOF（既测看门狗，也测截断收口）
      res.writeHead(200, sseHead);
      const body = contentPieces(40).map((p) => deltaLine(p)).join("") + usageLine() + DONE;
      let i = 0;
      const timer = setInterval(() => {
        if (!res.socket || res.socket.destroyed) { clearInterval(timer); return; }
        if (Date.now() - st.dripStart > 30000 || i >= body.length) { clearInterval(timer); res.end(); return; } // 30s 后 EOF
        res.write(body.slice(i, i + 1));
        st.lastBytes = ++i;
      }, 200);
      timer.unref && timer.unref();
      return;
    }

    case "abort-mid-stream": {
      // (i) 客户端中途取消 —— 服务端必须观察到 socket 关闭
      res.writeHead(200, sseHead);
      const pieces = contentPieces(60);
      let i = 0;
      const timer = setInterval(() => {
        if (!res.socket || res.socket.destroyed) { clearInterval(timer); return; }
        if (i >= pieces.length) { clearInterval(timer); res.end(); return; }
        res.write(deltaLine(pieces[i++]));
      }, 100);
      timer.unref && timer.unref();
      return;
    }

    case "dup-id": {
      // (j) 同一 SSE id 投递两次（重复帧 / 客户端重连后服务端重放）
      res.writeHead(200, sseHead);
      const one = deltaLine(fullCardJson(), "dup-1");
      res.write(one);
      res.write(one);
      res.write(usageLine() + usageLine() + DONE);
      res.end();
      return;
    }

    case "absurd-usage": {
      // (g2) 只有一份荒谬 usage（无后续合法 usage 覆盖）
      res.writeHead(200, sseHead);
      for (const p of contentPieces(10)) res.write(deltaLine(p));
      res.write(sseData({ choices: [], usage: { prompt_tokens: -999, completion_tokens: 1e18, total_tokens: "NaN?", hidden_cost_usd: 9e99 } }));
      res.write(DONE);
      res.end();
      return;
    }

    case "garbage-card": {
      // (g3) 形状合法的 JSON，但卡片本身残缺（空 back / 缺字段 / 非对象元素）
      res.writeHead(200, sseHead);
      res.write(deltaLine(JSON.stringify({ cards: [{ frontMarkdown: `${MARK}-半卡`, backMarkdown: "" }, { nope: 123 }, "字符串冒充卡", { frontMarkdown: `${MARK}-Q3`, backMarkdown: `${MARK}-A3`, cardType: "qa" }] })));
      res.write(usageLine() + DONE);
      res.end();
      return;
    }

    default: {
      // 基线：诚实完整的流
      res.writeHead(200, sseHead);
      for (const p of contentPieces(10)) res.write(deltaLine(p));
      res.write(usageLine() + DONE);
      res.end();
    }
  }
}

function hardReset(res) {
  try {
    if (res.socket && typeof res.socket.resetAndDestroy === "function") { res.socket.resetAndDestroy(); return "resetAndDestroy(RST)"; }
    if (res.socket) { res.socket.destroy(); return "destroy(FIN)"; }
  } catch { /* ignore */ }
  return "none";
}

function makeFakeAI() {
  const st = { mode: "ok", requests: [], clientClosedAt: [], resets: 0, dripStart: 0, lastBytes: 0 };
  const server = http.createServer((req, res) => {
    const acc = [];
    req.on("data", (c) => acc.push(c));
    req.on("error", () => { /* abort 竞态 */ });
    req.on("end", () => {
      st.requests.push({ url: req.url, method: req.method, headers: req.headers, body: Buffer.concat(acc).toString("utf-8") });
      st.dripStart = Date.now();
      try { serve(req, res, st); } catch (e) { console.log("  ! 夹具服务端异常：" + e.message); }
    });
  });
  server.on("clientError", () => { /* RST 竞态 */ });
  const sockets = new Set();
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  return { server, st, sockets };
}
const listen = (server) => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => resolve(server.address().port));
});

// ---------------------------------------------------------------- 磁盘事实
const EXPECTED = [
  { frontMarkdown: `${MARK}-Q1`, backMarkdown: `${MARK}-A1` },
  { frontMarkdown: `${MARK}-Q2`, backMarkdown: `${MARK}-A2` },
  { frontMarkdown: `${MARK}-Q3`, backMarkdown: `${MARK}-A3` },
];
/** ai.js v48 批2 承诺的机读错误码（§4.19-8）；不在集合内的说明错误没被归一化 */
const MACHINE_CODES = new Set(["rate_limit", "network", "http", "timeout", "cancelled", "AI_NO_KEY"]);

/** 只读审计落盘文件：草稿计数 + 与预期集合的偏离 + 全库文本指纹扫描 */
async function diskFacts(dbFile) {
  const a = await audit(dbFile);
  const tables = a.tables();
  const out = { batches: a.count("ai_gen_batches"), cards: a.count("cards"), rows: [], markHits: [], tables };
  const res = a.rows("SELECT id, scope, source_text, context_json, result_json, status FROM ai_gen_batches ORDER BY created_at");
  for (const r of res) {
    let j = null;
    try { j = JSON.parse(r.result_json || "null"); } catch { j = "unparseable"; }
    const drafts = j && Array.isArray(j.cards) ? j.cards : [];
    out.rows.push({ id: r.id, status: r.status, n: drafts.length, drafts: drafts.map((c) => ({ front: String(c?.frontMarkdown ?? ""), back: String(c?.backMarkdown ?? "") })) });
  }
  // 每张卡的每个 text 列里是否出现 MARK（服务端可控文本是否落库）
  for (const t of tables) {
    for (const col of a.columns(t)) {
      let n = 0;
      try { n = a.one(`SELECT COUNT(*) AS n FROM "${t}" WHERE CAST("${col}" AS TEXT) LIKE ?`, [`%${MARK}%`])?.n || 0; } catch { n = 0; }
      if (n) out.markHits.push(`${t}.${col}=${n}`);
    }
  }
  out.cardCols = out.rows.flatMap((r) => r.drafts).length;
  a.close();
  return out;
}

/** 草稿是否严格等于「完整 3 张卡」——多一张、少一张、字段被截断都算越界 */
function partiality(rows) {
  const drafts = rows.flatMap((r) => r.drafts);
  const bad = [];
  drafts.forEach((d, i) => {
    const e = EXPECTED[i];
    if (!e || d.front !== e.frontMarkdown || d.back !== e.backMarkdown) bad.push(`#${i}{${d.front}|${d.back}}`);
  });
  const missing = drafts.length < EXPECTED.length ? `缺 ${EXPECTED.length - drafts.length} 张` : "";
  return { total: drafts.length, bad, missing };
}

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f41"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();

    const ai = require(path.join(ROOT, "electron", "ai.js"));
    const cardsBundle = require(path.join(ROOT, "tests", "m12.cards.bundle.cjs"));
    const extractJson = cardsBundle.extractJson;

    const { server, st, sockets } = makeFakeAI();
    const port = await listen(server);
    let base = `http://127.0.0.1:${port}/v1`;

    const s = await runFlow(flow, async () => {
      flow.guard("夹具服务只在 127.0.0.1 上监听", () => server.address().address === "127.0.0.1");
      flow.guard("extractJson 可从 m12 bundle 取到（真解析器，非复刻）", () => typeof extractJson === "function");
      flow.guard("ai.js 导出 chatStream/setAIConfig/getAIConfig", () => typeof ai.chatStream === "function" && typeof ai.setAIConfig === "function");

      // ---------- 配置指向本地假服务 ----------
      flow.section("S0 配置指向 127.0.0.1 ephemeral 端口 + dummy Key");
      ai.setAIConfig({ preset: "custom", baseUrl: base, model: "f41-fake-model", apiKey: DUMMY_KEY });
      const cfg = ai.getAIConfig();
      flow.eq("baseUrl 已生效", cfg.baseUrl, base);
      flow.eq("Key 可回读（safeStorage 往返或明文回落）", cfg.apiKey, DUMMY_KEY);
      flow.record("safeStorage 可用 / Key 落盘形态", `enc=${fs.existsSync(path.join(dir, "ai-config.json")) ? String(fs.readFileSync(path.join(dir, "ai-config.json"), "utf8")).includes("apiKeyEnc") : "?"}`);

      /** 打一次 + 走后链路：delta 累积 → extractJson → createAIGenBatch → persistNow → 读盘 */
      async function drive(mode, opts = {}) {
        st.mode = mode;
        st.requests = [];
        st.clientClosedAt = [];
        st.resets = 0;
        st.lastBytes = 0;
        const before = await diskFacts(dbFile);
        let acc = "";
        let deltas = 0;
        let dones = 0;
        let thinkingMsgs = 0;
        let resolvedMeta = null;
        let err = null;
        const t0 = Date.now();
        let abortTimer = null;
        if (opts.abortAfterMs && opts.abortController) {
          abortTimer = setTimeout(() => { try { opts.abortController.abort(); } catch { /* ignore */ } }, opts.abortAfterMs);
        }
        try {
          resolvedMeta = await ai.chatStream(
            { messages: [{ role: "user", content: "F41 传输故障注入" }], temperature: 0.1, abortSignal: opts.abortController ? opts.abortController.signal : opts.abortSignal, retry: opts.retry },
            (m) => {
              if (m && m.delta) { acc += m.delta; deltas += 1; }
              if (m && m.thinking != null) thinkingMsgs += 1;
              if (m && m.done) dones += 1;
            }
          );
        } catch (e) {
          err = e;
        } finally {
          if (abortTimer) clearTimeout(abortTimer);
        }
        if (opts.onSettle) opts.onSettle();
        const secs = +((Date.now() - t0) / 1000).toFixed(2);
        await new Promise((r2) => setTimeout(r2, 120)); // 让服务端 close/error 记账落定
        let parseOut = null;
        let parseErr = null;
        if (!err) {
          try { parseOut = extractJson(acc); } catch (e) { parseErr = String(e && e.message); }
          db.createAIGenBatch({ scope: "card-generation", sourceText: `F41 ${mode} 源文本`, context: { drivenBy: "f41" }, promptTemplateId: null, result: parseOut || { cards: [] } });
        }
        db.persistNow();
        const after = await diskFacts(dbFile);
        return {
          mode, secs, acc, deltas, dones, thinkingMsgs, resolvedMeta, parseOut, parseErr, before, after,
          errored: !!err,
          batches: after.batches - before.batches,
          errCode: err ? err.code : null,
          errName: err ? String(err.name || "") : null,
          errMsg: err ? String(err.message || "") : null,
          errStatus: err && err.status !== undefined ? err.status : null,
          retriable: err ? !!err.retriable : null,
          streamStarted: err ? !!err.streamStarted : null,
          retryAfterMs: err && err.retryAfterMs !== undefined ? err.retryAfterMs : null,
          reqCount: st.requests.length,
          reqAuth: st.requests[0] ? st.requests[0].headers.authorization : null,
          reqUrl: st.requests[0] ? st.requests[0].url : null,
          closes: st.clientClosedAt.slice(),
          stRef: st,
        };
      }

      /** T1/T2 两条通用判据（只看**本场景新增**的那批草稿，避免与基线行混算） */
      function judge(r, { expectError, expectCards, tag }) {
        const newRows = r.after.rows.slice(r.before.rows.length);
        const p = partiality(newRows);
        r.newDrafts = p.total;
        r.newBad = p.bad;
        if (r.errored) {
          flow.check(`${tag}·T1 报错路径零草稿落库（不半落）`, r.batches === 0, "0 新批次", `${r.batches} 新批次 / 草稿 ${p.total}`);
          flow.check(`${tag}·T2 错误如实可辨（有机读 code）`, typeof r.errCode === "string" && r.errCode.length > 0, "code 非空", JSON.stringify({ code: r.errCode, status: r.errStatus, msg: (r.errMsg || "").slice(0, 90) }));
          flow.check(`${tag}·T2b code 属于 v48 机读集合`, MACHINE_CODES.has(String(r.errCode)), [...MACHINE_CODES].join("|"), JSON.stringify({ code: r.errCode, msg: (r.errMsg || "").slice(0, 60) }));
        } else {
          flow.check(`${tag}·T1 落库草稿必须严格等于 ${expectCards} 张完整卡（半截/多余一律不许）`, p.total === expectCards && p.bad.length === 0, `${expectCards} 张完整`, `实得 ${p.total} 张；越界 ${JSON.stringify(p.bad).slice(0, 180)}${p.missing ? "；" + p.missing : ""}`);
          flow.check(`${tag}·T2 无「假成功」：resolve 成功必须伴随磁盘变化`, r.batches >= 1, "≥1 新批次", `批次 +${r.batches}，done 帧 ${r.dones}，delta ${r.deltas}`);
        }
        if (expectError) flow.check(`${tag}·必须报错而非静默成功`, r.errored, "抛错", `resolve 成功：done=${r.dones} delta=${r.deltas} 累计字符=${r.acc.length} 草稿=${p.total}`);
        return p;
      }

      // ---------- 基线 ----------
      flow.section("S1 基线：诚实完整的 SSE 流（后续场景的对照组）");
      const rBase = await drive("ok");
      flow.eq("基线请求打到 /v1/chat/completions", rBase.reqUrl, "/v1/chat/completions");
      flow.check("基线带 Authorization 头", rBase.reqAuth === `Bearer ${DUMMY_KEY}`, "Bearer <dummy>", rBase.reqAuth);
      flow.check("基线请求体声明 stream + include_usage", /"stream":true/.test(st.requests[0].body) && /include_usage/.test(st.requests[0].body), "含二者", st.requests[0].body.slice(0, 120));
      flow.eq("基线 done 帧恰为 1", rBase.dones, 1);
      judge(rBase, { expectError: false, expectCards: 3, tag: "基线" });
      flow.record("基线 usage/ttft", JSON.stringify(rBase.resolvedMeta));

      // ---------- (a) 黑洞连接 ----------
      flow.section("S2 (a) 服务端收下请求但永不应答：客户端到底卡多久");
      if (FAST) flow.record("S2/S9", "F41_FAST=1：120s 黑洞与 30s 滴流本轮跳过");
      else {
        const r = await drive("blackhole");
        flow.record("黑洞实测卡住秒数", r.secs);
        flow.record("黑洞后错误对象", JSON.stringify({ code: r.errCode, retriable: r.retriable, streamStarted: r.streamStarted, msg: (r.errMsg || "").slice(0, 60) }));
        flow.check("存在客户端看门狗：不得无限期挂死（≤130s 内必须结算）", r.secs <= 130, "≤130s", `${r.secs}s`);
        flow.check("超时看门狗报的是 timeout，不是含糊的网络错", r.errCode === "timeout", "timeout", JSON.stringify({ code: r.errCode, msg: (r.errMsg || "").slice(0, 60) }));
        judge(r, { expectError: true, expectCards: 0, tag: "黑洞" });
      }

      // ---------- (b) RST 半途复位 ----------
      flow.section("S3 (b) 流写到 ~30% 时 socket 复位（RST）");
      const rRst = await drive("reset-mid-body");
      flow.record("RST 前收到的 delta 数 / 累计字符", `${rRst.deltas} / ${rRst.acc.length}`);
      flow.record("RST 错误", JSON.stringify({ code: rRst.errCode, msg: (rRst.errMsg || "").slice(0, 70), streamStarted: rRst.streamStarted }));
      judge(rRst, { expectError: false, expectCards: 0, tag: "RST" });
      flow.check("流已开始后的失败必须标 unknown_outcome（streamStarted=true → 不重试）", rRst.errored && rRst.streamStarted === true && rRst.reqCount === 1, "true 且只请求 1 次", JSON.stringify({ errored: rRst.errored, streamStarted: rRst.streamStarted, reqCount: rRst.reqCount }));

      // ---------- (c) SSE 断在 JSON 中间后 EOF ----------
      flow.section("S4 (c) SSE 截断在 JSON 中间，随后 EOF（无 [DONE]）");
      const rTr = await drive("truncated-json");
      flow.record("截断流：done 帧数 / delta 数 / 累计字符", `${rTr.dones} / ${rTr.deltas} / ${rTr.acc.length}`);
      flow.record("解析器产出（仅本场景新增批次）", JSON.stringify(partiality(rTr.after.rows.slice(rTr.before.rows.length))).slice(0, 240));
      judge(rTr, { expectError: true, expectCards: 0, tag: "截断EOF" });

      // ---------- (d) 429 + Retry-After ----------
      flow.section("S5 (d) 429 带 Retry-After: 2");
      const r429 = await drive("http-429");
      flow.eq("HTTP 429 → code=rate_limit", r429.errCode, "rate_limit");
      flow.eq("Retry-After 解析为毫秒", r429.retryAfterMs, 2000);
      flow.eq("429 标为可重试", r429.retriable, true);
      flow.check("错误文本不含服务端 HTML/头回显", !/Bearer|<html/i.test(r429.errMsg || ""), "干净", (r429.errMsg || "").slice(0, 90));
      judge(r429, { expectError: true, expectCards: 0, tag: "429" });
      const r429b = await drive("http-429", { retry: { maxAttempts: 2 } });
      flow.record("退避后重试：请求次数/耗时", `${r429b.reqCount} 次 / ${r429b.secs}s`);
      flow.check("Retry-After 被真正遵守（重试间隔 ≈2s，不是 0 或指数退避）", r429b.reqCount === 2 && r429b.secs >= 1.9 && r429b.secs <= 3.2, "2 次请求·间隔~2s", JSON.stringify({ reqCount: r429b.reqCount, secs: r429b.secs }));

      // ---------- (e) 500 + HTML ----------
      flow.section("S6 (e) 500 且正文是 HTML（坏网关把请求头回显在错误页）");
      const r500 = await drive("http-500-html");
      flow.eq("HTTP 500 → code=http", r500.errCode, "http");
      flow.eq("500 标为可重试", r500.retriable, true);
      flow.check("错误文本必须截断且不带服务端 HTML 标签", !/<html|<pre|502 Bad/i.test(r500.errMsg || ""), "无 HTML 残留", (r500.errMsg || "").slice(0, 160));
      flow.check("错误文本绝不含 Authorization 回显（Key 不得进 UI 文案）", !/DO-NOT-LEAK/.test(r500.errMsg || ""), "零泄漏", (r500.errMsg || "").slice(0, 200));
      judge(r500, { expectError: true, expectCards: 0, tag: "500HTML" });

      // ---------- (f) 200 + text/html ----------
      flow.section("S7 (f) 200 但 Content-Type: text/html（说谎的登录页）");
      const rHtml = await drive("200-html");
      flow.record("200-HTML：err?", rHtml.err ? String(rHtml.errCode) : "无（resolve 成功）");
      flow.record("200-HTML：done 帧/delta 数/累计字符", `${rHtml.dones} / ${rHtml.deltas} / ${rHtml.acc.length}`);
      judge(rHtml, { expectError: true, expectCards: 0, tag: "200HTML" });

      // ---------- (g) 200 合法 JSON，形状不对 ----------
      flow.section("S8 (g) 200 + 合法 JSON 但形状不对（choices:[] / 对象冒充数组 / 荒谬 usage）");
      const rShape = await drive("wrong-shape");
      flow.record("形状异常：usage", JSON.stringify(rShape.resolvedMeta && rShape.resolvedMeta.usage));
      flow.check("后到的合法 usage 静默覆盖了前一份畸形 usage（无校验，纯巧合）", JSON.stringify((rShape.resolvedMeta || {}).usage) !== JSON.stringify({ prompt_tokens: -999, completion_tokens: 1e18, total_tokens: "NaN?" }), "记录即可", JSON.stringify((rShape.resolvedMeta || {}).usage));
      judge(rShape, { expectError: false, expectCards: 3, tag: "形状异常" });
      const rUsage = await drive("absurd-usage");
      flow.record("仅一份畸形 usage 时上报给调用方的值", JSON.stringify(rUsage.resolvedMeta && rUsage.resolvedMeta.usage));
      flow.check("荒谬 usage 不得原样交给调用方（负数/1e18/非数值须钳制或丢弃）", (() => { const u = (rUsage.resolvedMeta || {}).usage || {}; return Object.values(u).every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e9); })(), "usage 数值合理", JSON.stringify((rUsage.resolvedMeta || {}).usage));
      judge(rUsage, { expectError: false, expectCards: 3, tag: "畸形usage" });
      const rGarb = await drive("garbage-card");
      flow.record("残缺卡片：解析器留下几张 / 内容", JSON.stringify(rGarb.parseOut && rGarb.parseOut.cards && rGarb.parseOut.cards.map((c) => `${c.frontMarkdown}|${c.backMarkdown}`)));
      judge(rGarb, { expectError: false, expectCards: 0, tag: "残缺卡片" });

      // ---------- (h) 字节级龟速滴流 ----------
      flow.section("S9 (h) 1 字节 / 200ms 滴流 30 秒后 EOF");
      if (!FAST) {
        const rDrip = await drive("drip");
        flow.record("滴流：卡住秒数 / delta / 累计字节 / done 帧", `${rDrip.secs}s / ${rDrip.deltas} / ${rDrip.acc.length} / ${rDrip.dones}`);
        flow.check("滴流不得把看门狗饿死（不活动计时每字节都复位）", rDrip.secs <= 160, "≤160s", `${rDrip.secs}s`);
        judge(rDrip, { expectError: true, expectCards: 0, tag: "滴流" });
      }

      // ---------- (i) 调用方取消 ----------
      flow.section("S10 (i) 调用方 mid-stream 取消：服务端必须看到 socket 关闭");
      {
        const ac = new AbortController();
        const r = await drive("abort-mid-stream", { abortController: ac, abortAfterMs: 700 });
        await new Promise((res2) => setTimeout(res2, 250)); // 让服务端 close 事件落账
        flow.record("取消：客户端错误", JSON.stringify({ code: r.errCode, name: r.errName, msg: (r.errMsg || "").slice(0, 40) }));
        flow.record("取消：服务端观察到的 socket 关闭", JSON.stringify(r.stRef.clientClosedAt));
        flow.record("取消：已收到的 delta 数", r.deltas);
        flow.check("服务端确实看到 socket 提前关闭", r.stRef.clientClosedAt.length >= 1, "≥1 次关闭", JSON.stringify(r.stRef.clientClosedAt));
        flow.eq("取消归因为 cancelled（不是 timeout / 不是裸 DOMException.code=20）", r.errCode, "cancelled");
        flow.check("取消后零草稿落库", r.batches === 0, "0 新批次", r.batches);
      }

      // ---------- (j) 同一 SSE id 投递两次 ----------
      flow.section("S11 (j) 同一 SSE id 的 data 帧投递两次（重复帧/重放）");
      const rDup = await drive("dup-id");
      flow.eq("重复帧不得让 done 出现两次（同一批 data 也应只结算一次）", rDup.dones, 1);
      {
        const p = partiality(rDup.after.rows.slice(rDup.before.rows.length));
        flow.record("重复帧：本场景落库草稿数", p.total);
        flow.check("重复帧不得翻倍草稿（内容按 id 去重或至少不重复入批）", p.total === 3 && p.bad.length === 0, "3 张", `实得 ${p.total} 张 ${JSON.stringify(p.bad).slice(0, 160)}`);
        flow.check("重复帧不得让服务端可控文本在调用方累积串里出现两份", rDup.acc.split(MARK + "-Q1").length - 1 <= 1, "Q1 只出现一次", `${rDup.acc.split(MARK + "-Q1").length - 1} 次（ai.js 不看 SSE id，无去重）`);
      }

      // ---------- 跨场景：Key 泄漏普查 ----------
      flow.section("S12 跨场景普查：dummy Key 是否出现在库 / settings.json / *.log / 任何沙箱文件");
      const leaks = [];
      {
        const a = await audit(dbFile);
        for (const t of a.tables()) {
          for (const col of a.columns(t)) {
            let n = 0;
            try { n = a.one(`SELECT COUNT(*) AS n FROM "${t}" WHERE CAST("${col}" AS TEXT) LIKE ?`, [`%${DUMMY_KEY}%`])?.n || 0; } catch { n = 0; }
            if (n) leaks.push(`library.db:${t}.${col} (${n} 行)`);
          }
        }
        a.close();
      }
      const filesScanned = [];
      const walk = (d) => {
        for (const name of fs.readdirSync(d)) {
          const full = path.join(d, name);
          const stat = fs.statSync(full);
          if (stat.isDirectory()) { walk(full); continue; }
          filesScanned.push(path.relative(dir, full));
          if (/\.(log|json|db|txt|jsonl)$/i.test(name)) {
            try {
              const txt = fs.readFileSync(full, "latin1");
              if (txt.includes(DUMMY_KEY)) leaks.push(`${path.relative(dir, full)} (文件明文含 Key)`);
            } catch { /* 忽略读不动的文件 */ }
          }
        }
      };
      walk(dir);
      const keyEncryptedAtRest = !leaks.some((l) => /ai-config\.json/.test(l));
      flow.check("ai-config.json 不得明文存 Key（safeStorage 必须可用）", keyEncryptedAtRest, "密文", JSON.stringify(leaks.filter((l) => /ai-config/.test(l))));
      flow.check("全库文本列 + settings.json + *.log 零 Key 泄漏", leaks.length === 0, "0 处", JSON.stringify(leaks));
      // Key 虽未落盘，但是否进了「调用方可见文案」——那是 main.js:674 send({error}) 的直通管道
      const echoHits = [r500, rHtml, r429, rShape].filter((r) => (r.errMsg || "").includes(DUMMY_KEY) || r.acc.includes(DUMMY_KEY));
      flow.record("Key 出现在调用方可见文案的场景", echoHits.map((r) => r.mode).join(" ") || "（无）");
      flow.check("服务端回显的 Key 不得进入调用方可见的错误文案/累积正文", echoHits.length === 0, "0 处", echoHits.map((r) => `${r.mode}: ${(r.errMsg || r.acc).slice(0, 110)}`).join(" || "));
      flow.record("扫描过的文件", filesScanned.join(" "));
      flow.record("服务端可控文本落库位置（MARK 命中）", JSON.stringify((await diskFacts(dbFile)).markHits));
      flow.record("最终磁盘事实", JSON.stringify(await diskFacts(dbFile).then((f) => ({ batches: f.batches, cards: f.cards, drafts: f.rows.map((r) => r.n) }))));

      // ---------- 收尾：重启后自洽（§7.1.4） ----------
      flow.section("S13 故障注入后重启：磁盘态自洽，无半写");
      db.persistNow();
      sockets.forEach((sock) => { try { sock.destroy(); } catch { /* ignore */ } });
      server.close();
      const aud = await audit(dbFile);
      const cardsOnDisk = aud.one("SELECT COUNT(*) AS n FROM cards WHERE is_deleted = 0")?.n ?? -1;
      const batchesOnDisk = aud.count("ai_gen_batches");
      aud.close();
      flow.eq("故障注入全程不得产生任何真实卡片行", cardsOnDisk, 0);
      const { reopenFlowDb } = require("./lib/dbenv.cjs");
      const db2 = await reopenFlowDb(dir);
      flow.eq("重启后 ai_gen_batches 行数与落盘一致（无半写）", db2.listAllCards ? (await diskFacts(dbFile)).batches : -1, batchesOnDisk);
      flow.eq("重启后卡片仍为 0", db2.listAllCards().length, 0);
    });

    console.log(flow.summary());
    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F41 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String(e && e.message ? e.message : e) });
    process.exit(1);
  });
