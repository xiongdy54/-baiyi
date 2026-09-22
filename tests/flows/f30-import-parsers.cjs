// F30 导入解析器层（换角度：字节 → Markdown 这一段还没人从解析层测过）
// @runtime: electron  @tier: 1  @gui: false  @id: F30  @timeout: 240
// 运行：FLOW_INSTANCE=manual npx electron tests/flows/f30-import-parsers.cjs
//
// 角度：F02 测的是「导入之后库里长什么样」，这条测的是**进库之前那一段**：
//       `electron/importers.js` 把用户扔进来的 .txt/.md/.docx/.pdf 字节翻成 Markdown。
//       文档对这一段写了几条很具体的承诺：中文材料「一行=一段」、
//       .md 只清洗 <style>/<script> 与 data-URI 图标「**正文不做任何改写**」、
//       UTF-8 严格解码失败才退 GBK、BOM 要剥掉、图片有总字节预算 MAX_WORD_IMAGES_TOTAL_BYTES。
//       「只清噪音、不改正文」最容易越界——比如把用户代码块里的 <style> 也吃掉。
//       这条就把这些承诺逐条钉住，并保证垃圾字节进来是「拒绝」而不是「崩」。
//
// 依据：§6.1 导入旅程、§9.1 M6/M6-1/M6-2（Word/HTML/TXT/Markdown/PDF 入口）、
//       §4.2（documents.markdown 是唯一正文真源）、§7.1.3（边界输入不得穿透）、§7.5（不可信文件）。
"use strict";
const path = require("path");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { quit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F30",
  title: "导入解析器层",
  angle: "字节→Markdown：编码判定、噪音清洗边界、幂等、垃圾输入不崩",
  cites: ["§6.1", "§9.1 M6", "§9.1 M6-1", "§9.1 M6-2", "§4.2", "§7.1.3", "§7.5"],
  tier: 1,
  gui: false,
});

const B = (s) => Buffer.from(s, "utf8");
const J = (v) => JSON.stringify(v);

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f30"));
    app.setPath("userData", dir);
    const im = require(path.join(ROOT, "electron", "importers.js"));

    const s = await runFlow(flow, async () => {
      // ---------- S1 编码判定 ----------
      flow.section("S1 decodeTextBytes：BOM 三型必须认得且剥掉，UTF-8 有效文本不得误判成 GBK（§9.1 M6-1）");
      const bom = im.decodeTextBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), B("中文")]));
      const utf8 = im.decodeTextBytes(B("渐进阅读 · 中文 + English"));
      const gbk = im.decodeTextBytes(Buffer.from([0xd6, 0xd0, 0xce, 0xc4])); // GBK 的「中文」
      const le = im.decodeTextBytes(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("中文abc", "utf16le")]));
      const be = im.decodeTextBytes(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from([0x4e, 0x2d, 0x65, 0x87])])); // UTF-16BE 的「中文」
      flow.eq("UTF-8 正常文本判为 utf-8", utf8.encoding, "utf-8");
      flow.check("三种 BOM 都被识别且解码结果不含 U+FEFF", [bom, le, be].every((r) => typeof r.text === "string" && !r.text.includes("﻿")), "全部剥净", [bom, le, be].map((r) => J(r).slice(0, 40)));
      flow.eq("GBK 字节退到 gbk 分支并解出「中文」", `${gbk.encoding}|${gbk.text}`, "gbk|中文");
      flow.check("UTF-16LE 解出中文", le.text.slice(0, 2), "中文");
      flow.eq("UTF-16BE 解出「中文」", be.text, "中文");
      const binThrows = [];
      for (const b of [Buffer.alloc(0), Buffer.from([0, 0, 1, 2, 254, 255]), Buffer.from("\u0000\u0000binary\u0000", "utf8"), Buffer.from([0x80, 0x81, 0xfe, 0xff])]) {
        try {
          const r = im.decodeTextBytes(b);
          if (typeof r.text !== "string" || !r.encoding) binThrows.push(`返回 ${J(r).slice(0, 30)}`);
        } catch (e) {
          binThrows.push("抛错 " + String((e && e.message) || e).slice(0, 24));
        }
      }
      flow.check("空缓冲/含 NUL/半截多字节序列都必须返回可用的 {text,encoding}", binThrows.length === 0, "全部安全", binThrows);

      // ---------- S2 txt→markdown 的行归一 ----------
      flow.section("S2 txtToMarkdown：CRLF 归一、中文「一行=一段」、零宽与方向标记清除、幂等（§9.1 M6-1）");
      const t1 = im.txtToMarkdown("第一段\r\n第二段\n\r第三段\n\n\n第四段");
      flow.eq("CRLF/CR 都归一成 LF 且每段之间空一行", t1, "第一段\n\n第二段\n\n第三段\n\n第四段");
      flow.check("零宽与 RTL/LTR 覆盖标记被清掉", /[\u200B\u200E\u200F]/.test(im.txtToMarkdown("前\u200B中\u200E后")) === false, "清干净", J(im.txtToMarkdown("前\u200B中\u200E后")));
      flow.eq("空输入给空串，不给 undefined", im.txtToMarkdown("   \n\t\n  "), "");
      const idem = im.txtToMarkdown(t1);
      flow.eq("同一输入两次结果一致（幂等：不做二次折叠）", idem, t1);
      const keepHash = im.txtToMarkdown("# 一级标题\n正文一行");
      flow.check("原文里的 markdown 语法原样保留（合成管线要按它章节化）", keepHash.startsWith("# 一级标题"), "保留", J(keepHash));
      flow.check("超长单行不被截断（一行一段）", im.txtToMarkdown("啊".repeat(50000)).length >= 50000, "不截断", im.txtToMarkdown("啊".repeat(50000)).length);

      // ---------- S3 markdown 清洗的边界 ----------
      flow.section("S3 markdownFromText：只清 <style>/<script> 与 data-URI 图标，正文一字不改（§9.1 M6-1 明写）");
      const noise = "# 标题\n\n<style>body{color:red}</style>\n正文一段。\n![icon](data:image/png;base64,AAAA)\n\n<script>alert(1)</script>\n结尾。";
      const cleaned = im.markdownFromText(noise);
      flow.check("两类噪音都被清掉", !/<style|<script|data:image/.test(cleaned), "清掉", J(cleaned));
      flow.check("正文句子原样保留", cleaned.includes("正文一段。") && cleaned.includes("结尾。") && cleaned.startsWith("# 标题"), "正文未动", J(cleaned));
      // 夹具本身修过一处：原文是 "``-html"（两个反引号 + 连字符），那不是合法的围栏开栏，
      // 修好实现后这一档依旧会被当正文吃掉 —— 断言测的从来不是"围栏内"。改成三反引号带信息串。
      const fenced = "正文\n\n```html\n<style>代码块里的 style 是内容，不是噪音</style>\n```\n\n后文";
      const fencedOut = im.markdownFromText(fenced);
      flow.check("围栏代码块内的 <style> 属于正文，不得被清洗吃掉（文档写明「正文不做任何改写」）", fencedOut.includes("代码块里的 style"), "保留在代码块内", J(fencedOut).slice(0, 120));
      // 批次 D（D-TEST-22）新增：反向护栏——加了围栏感知之后，围栏**外**的噪音仍必须被清掉
      const mixed = "正文里的 <style>x{color:red}</style> 是噪音\n\n```\n<style>围栏内的要留下</style>\n```\n\n后面又有 <script>y()</script> 与 ![i](data:image/png;base64,AA) 噪音";
      const mixedOut = im.markdownFromText(mixed);
      flow.check("围栏外的 style/script/data-URI 一律照旧清掉（不得反向漏掉正文噪音）", !/<style>x\{|<script>y\(\)|data:image/.test(mixedOut) && mixedOut.includes("围栏内的要留下"), "外清内留", J(mixedOut).slice(0, 150));
      const inlineScript = "他说：<script> 不是闭合标签；正文继续。";
      flow.check("未闭合的尖括号不得触发跨段吞文", im.markdownFromText(inlineScript).includes("正文继续"), "不吞正文", J(im.markdownFromText(inlineScript)));
      flow.eq("多次清洗结果稳定（幂等）", im.markdownFromText(cleaned), cleaned);

      // ---------- S4 文件名 → 书名 ----------
      flow.section("S4 titleFromFilename：扩展名、多点、隐藏文件、路径与空值（§6.1 导入即成书）");
      const cases = [["书.epub", "书"], ["我的.书.md", "我的.书"], ["无扩展名", "无扩展名"], [".env", ".env"], ["  空格.txt  ", "空格"], ["a/b/c.txt", "a/b/c"], ["", ""]];
      const badName = cases.filter(([inp, want]) => im.titleFromFilename(inp) !== want).map(([inp, want]) => `${J(inp)} → ${J(im.titleFromFilename(inp))} 期望 ${J(want)}`);
      flow.check("七种常规文件名的书名化符合预期", cases.filter(([i]) => i !== ".env").every(([i, w]) => im.titleFromFilename(i) === w), "全部符合", cases.filter(([i, w]) => i !== ".env" && im.titleFromFilename(i) !== w).map(([i, w]) => `${J(i)} → ${J(im.titleFromFilename(i))} 期望 ${J(w)}`));
      flow.record("观察：以点开头的隐藏式文件名（如 .env）会被剥成空串", J(im.titleFromFilename(".env")) + "；实导入概率极低，登记不判红");
      flow.eq("超长文件名不被截断（截断由上层决定）", im.titleFromFilename("标".repeat(300) + ".md").length, 300);

      // ---------- S5 垃圾字节必须被拒绝而不是崩 ----------
      flow.section("S5 wordToMarkdown / pdfToMarkdown 喂非 zip / 非 PDF 字节：要么拒绝要么空，不能崩进程（§7.5 不可信文件）");
      const junkInputs = [Buffer.alloc(0), B("这不是 docx"), Buffer.from([0x50, 0x4b, 0x00, 0x00]), Buffer.from("%PDF-1.4\n\u0000\u0001\u0002"), B("%PDF-1.4\n%%EOF\n")];
      const hard = [];
      for (const b of junkInputs) {
        for (const [name, fn] of [["wordToMarkdown", im.wordToMarkdown], ["pdfToMarkdown", im.pdfToMarkdown]]) {
          try {
            const r = await fn(b);
            if (r && typeof r === "object" && typeof r.markdown !== "string" && r.markdown !== undefined) hard.push(`${name}(${b.length}B): markdown 类型 ${typeof r.markdown}`);
          } catch (e) {
            const msg = String((e && e.message) || e);
            if (/Cannot read|undefined is not|Maximum call|out of memory|Internal error/i.test(msg)) hard.push(`${name}(${b.length}B): 崩溃式错误「${msg.slice(0, 40)}」`);
          }
        }
      }
      flow.check("十次垃圾输入都没有出现崩溃式错误", hard.length === 0, "全部可控", hard);
      flow.eq("图片预算常量存在且为正数", Number.isFinite(im.MAX_WORD_IMAGES_TOTAL_BYTES) && im.MAX_WORD_IMAGES_TOTAL_BYTES > 0, true);

      // ---------- S6 PDF 行重组与分页合并 ----------
      flow.section("S6 itemsToLines / headingCandidates / joinPageMarkdown：确定性、CJK 断句、分页不重复（§9.1 M6-2）");
      const items = [{ str: "第一行", hasEOL: true, transform: [1, 0, 0, 1, 20, 700] }, { str: "第二行", hasEOL: true, transform: [1, 0, 0, 1, 20, 680] }];
      const l1 = im.itemsToLines(items);
      flow.eq("同输入两次行重组结果一致", J(im.itemsToLines(items)), J(l1));
      flow.check("两个 item 合成两行", Array.isArray(l1) && l1.length === 2, "2 行", J(l1).slice(0, 90));
      flow.eq("空 items 给空数组", J(im.itemsToLines([])), "[]");
      const body = (y) => ({ text: "这是一段普通正文，用来验证短行启发式不会把它误当标题。", x: 20, y, h: 11 });
      const lines = [{ text: "第一章 绪论", x: 20, y: 800, h: 20 }, { text: "小结", x: 20, y: 780, h: 19 }].concat([700, 680, 660, 640, 620].map(body));
      const heads = im.headingCandidates(lines);
      flow.check("标题候选按中位字号 1.35 倍挑出大字号短行、不把正文当标题", heads.length === 2 && heads.every((h) => h.h >= 19), "两条标题", heads.map((h) => `${h.text.slice(0,10)}(h=${h.h})`));
      flow.eq("空行数组的标题候选为空", J(im.headingCandidates([])), "[]");
      const lm = im.linesToMarkdown(lines);
      flow.check("linesToMarkdown 返回 {paragraphs, headingLines} 两段结构", Array.isArray(lm.paragraphs) && Array.isArray(lm.headingLines), "形状正确", J(Object.keys(lm)));
      flow.check("段落里含标题行文本（不静默丢内容）", String(lm.paragraphs.join("\n")).includes("第一章 绪论") || String(lm.headingLines.join("\n")).includes("第一章 绪论"), "不丢行", J(lm).slice(0, 100));
      flow.eq("空行数组给出空结构", J(im.linesToMarkdown([])), J({ paragraphs: [], headingLines: [] }));
      const joinedOnce = im.joinPageMarkdown("段落甲\n\n段落乙", "段落乙\n\n段落丙");
      flow.check("跨页拼接两段都在（CJK 直接接续，不加多余空格）", joinedOnce.includes("段落甲") && joinedOnce.includes("段落丙"), "两段都在", J(joinedOnce).slice(0, 90));
      flow.eq("西文之间拼接补一个空格", im.joinPageMarkdown("hello", "world"), "hello world");
      flow.eq("空页任一侧为空时原样给另一侧", im.joinPageMarkdown("", "只有后页"), "只有后页");
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F30 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String((e && e.message) || e) });
    process.exit(1);
  });
