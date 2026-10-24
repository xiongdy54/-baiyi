"use strict";
// 导出到 Anki · Phase 1（规则见审计报告 C-39）。纯函数 + 一个写文件入口。
// GUIDE v49.42 / D213 登记（§6.8-9 导出例外）；决策行含映射规则摘要。
const fs = require("fs");
const path = require("path");
const MarkdownIt = require("markdown-it");
const { resolveBookassetPath } = require("./bookassetPath"); // C-08

const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: true });
// 与 src/lib/cards.ts parseCloze 的正则逐字相同
const CLOZE_SRC = "\\{\\{c(\\d+)::([\\s\\S]*?)(?:::([\\s\\S]*?))?\\}\\}";

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const decodeAttr = (s) => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** 被遮的空 → {{c1::…}}；不遮的空 → 原文；hint 收集起来放 Back Extra */
function convertCloze(text, clozeOrds) {
  const src = String(text || "");
  const all = new Set([...src.matchAll(new RegExp(CLOZE_SRC, "g"))].map((m) => Number(m[1])));
  const mask = Array.isArray(clozeOrds) && clozeOrds.length ? new Set(clozeOrds.map(Number)) : all;
  const hints = [];
  let masked = 0;
  const out = src.replace(new RegExp(CLOZE_SRC, "g"), (_s, ord, content, hint) => {
    if (!mask.has(Number(ord))) return content;
    masked++;
    if (hint) hints.push(hint);
    return `{{c1::${content}}}`;
  });
  return { text: out, hints, masked };
}

/** 公式换成占位符（代码段里的 $ 不动），渲染后再还原成 MathJax 定界符 */
function protectMath(src) {
  const math = [];
  const parts = String(src || "").split(/(`{3}[\s\S]*?`{3}|`[^`\n]*`)/g); // 奇数下标是代码
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i]
      .replace(/\$\$([\s\S]+?)\$\$/g, (_m, body) => { math.push(["block", body]); return `NUTMATH${math.length - 1}X`; })
      .replace(/\$(?=\S)([^$\n]*?\S)\$/g, (_m, body) => { math.push(["inline", body]); return `NUTMATH${math.length - 1}X`; });
  }
  return { s: parts.join(""), math };
}
function restoreMath(html, math) {
  return html.replace(/NUTMATH(\d+)X/g, (_m, i) => {
    const [kind, body] = math[Number(i)];
    const safe = escapeHtml(body).replace(/\r?\n/g, " ").replace(/\}\}/g, "} }");
    return kind === "block" ? `\\[${safe}\\]` : `\\(${safe}\\)`;
  });
}

function copyMedia(src, ctx) {
  let file = null;
  let itemId = null;
  if (src.startsWith("bookasset://")) {
    file = resolveBookassetPath(ctx.userData, src); // 越界/非法 → null
    try { itemId = new URL(src).hostname; } catch { itemId = null; }
  } else if (/^[\w.-]+$/.test(src) && ctx.libraryItemId) { // 文档里的相对图片名，如 img-0.png
    itemId = ctx.libraryItemId;
    file = resolveBookassetPath(ctx.userData, `bookasset://${itemId}/${src}`);
  }
  if (!file || !itemId || !fs.existsSync(file)) { ctx.warnings.push(`图片未找到或不允许：${src}`); return null; }
  const name = `nut_${itemId}_${path.basename(file)}`;
  if (!ctx.copied.has(name)) {
    fs.copyFileSync(file, path.join(ctx.mediaDir, name));
    ctx.copied.add(name);
  }
  return name;
}

function renderField(markdown, ctx) {
  const { s, math } = protectMath(markdown);
  let html = restoreMath(md.render(s), math).trim();
  html = html.replace(/<img src="([^"]*)"/g, (whole, src) => {
    const name = copyMedia(decodeAttr(src), ctx);
    return name ? `<img src="${name}"` : whole;
  });
  // TSV 一行一条：块级标签之间的换行去掉，其余换行改为 <br>（填空跨行必须这样，见 Anki 文档）
  return html.replace(/<br>\s*\n/g, "<br>").replace(/>\s*\n\s*</g, "><").replace(/\r?\n/g, "<br>").replace(/\t/g, "    ");
}

const div = (cls, html) => (html ? `<div class="${cls}">${html}</div>` : "");
const deckOf = (card) => {
  const t = String(card.docTitle || (card.sourceRef && card.sourceRef.title) || "未归属")
    .replace(/::/g, "：").replace(/[\t\r\n]+/g, " ").trim().slice(0, 100) || "未归属";
  return `Nutation::${t}`;
};
const tagsOf = (card) => {
  const tags = (Array.isArray(card.tags) ? card.tags : []).map((t) => String(t).trim().replace(/\s+/g, "_")).filter(Boolean);
  tags.push("nutation");
  if (card.status === "archived") tags.push("nutation::archived");
  if (card.leech && card.leech.suspended) tags.push("nutation::suspended");
  return tags.join(" ");
};
const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
const row = (cols) => cols.map(q).join("\t");

/** 纯函数：卡片数组 → 两份 TSV 文本 + 跳过清单（图片复制是唯一副作用，经 ctx 完成） */
function buildExport(cards, ctx) {
  const basic = [];
  const cloze = [];
  const skipped = [];
  const sorted = [...cards].sort((a, b) => (a.createdAt - b.createdAt) || String(a.id).localeCompare(String(b.id)));
  for (const c of sorted) {
    const local = { ...ctx, libraryItemId: c.libraryItemId || null };
    const extras = div("nut-mnemonic", c.mnemonic ? renderField(c.mnemonic, local) : "") + div("nut-example", c.example ? renderField(c.example, local) : "");
    const prefix = div("nut-prefix", c.contextPrefix ? escapeHtml(c.contextPrefix) : "");
    const meta = [tagsOf(c), deckOf(c), `nut-${c.id}`];
    if (c.cardType === "qa") {
      basic.push(row([prefix + renderField(c.frontMarkdown || c.noteText, local), renderField(c.backMarkdown, local) + extras, ...meta]));
    } else if (c.cardType === "cloze") {
      const conv = convertCloze(c.frontMarkdown || c.noteText, c.clozeOrds);
      if (conv.masked === 0) { skipped.push([c.id, c.cardType, "没有可识别的挖空"]); continue; }
      const back = (c.backMarkdown && c.backMarkdown.trim() ? renderField(c.backMarkdown, local) : "")
        + div("nut-hint", conv.hints.length ? escapeHtml("提示：" + conv.hints.join(" / ")) : "") + extras;
      cloze.push(row([prefix + renderField(conv.text, local), back, ...meta]));
    } else {
      skipped.push([c.id, c.cardType, c.cardType === "imageOcclusion" ? "图片遮挡卡暂不支持（Phase 2）" : "未知卡片类型"]);
    }
  }
  const head = (notetype, f1, f2) => [
    "#separator:Tab", "#html:true", `#notetype:${notetype}`,
    `#columns:${[f1, f2, "Tags", "Deck", "GUID"].join("\t")}`,
    "#tags column:3", "#deck column:4", "#guid column:5",
  ].join("\n");
  return {
    basicTxt: head("Basic", "Front", "Back") + "\n" + basic.join("\n") + "\n",
    clozeTxt: head("Cloze", "Text", "Back Extra") + "\n" + cloze.join("\n") + "\n",
    skippedTxt: skipped.map((r) => r.join("\t")).join("\n") + (skipped.length ? "\n" : ""),
    counts: { basic: basic.length, cloze: cloze.length, skipped: skipped.length },
  };
}

/** 写文件入口：outRoot 下新建 Nutation-Anki-<时间戳>/ */
function writeExport({ cards, userData, outRoot, now = new Date() }) {
  const p2 = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
  const dir = path.join(outRoot, `Nutation-Anki-${stamp}`);
  const mediaDir = path.join(dir, "media");
  fs.mkdirSync(mediaDir, { recursive: true });
  const ctx = { userData, mediaDir, copied: new Set(), warnings: [] };
  const r = buildExport(cards, ctx);
  fs.writeFileSync(path.join(dir, "basic.txt"), r.basicTxt, "utf8");
  fs.writeFileSync(path.join(dir, "cloze.txt"), r.clozeTxt, "utf8");
  fs.writeFileSync(path.join(dir, "skipped.txt"), r.skippedTxt + ctx.warnings.map((w) => `-\t-\t${w}`).join("\n"), "utf8");
  fs.writeFileSync(path.join(dir, "README.txt"), README_TEXT, "utf8");
  return { ok: true, dir, ...r.counts, media: ctx.copied.size, warnings: ctx.warnings.length };
}

const README_TEXT = [
  "导入到 Anki（需要 Anki 2.1.54 或更高版本）",
  "1. 把 media 文件夹里的所有文件复制到 Anki 的 collection.media 文件夹：",
  "   Windows: %APPDATA%\\Anki2\\<用户名>\\collection.media",
  "   macOS:   ~/Library/Application Support/Anki2/<用户名>/collection.media",
  "   Linux:   ~/.local/share/Anki2/<用户名>/collection.media",
  "2. Anki → 文件 → 导入 → 选择 basic.txt；笔记类型选「Basic / 问答题」（非英文界面的名字可能不同，手动选择即可）；确认已勾选允许 HTML。",
  "3. 同样导入 cloze.txt，笔记类型选「Cloze / 填空题」。",
  "4. 每本书会进入 Anki 的 Deck「Nutation::书名」。再次导出、再次导入不会产生重复，会更新已有笔记，Anki 中已有的复习进度保留。",
  "5. skipped.txt 列出了本次没有导出的卡片（例如图片遮挡卡）及原因。",
].join("\n") + "\n";

module.exports = { convertCloze, protectMath, restoreMath, renderField, buildExport, writeExport };
