// @runtime: electron-node
// C-39（审计，GUIDE v49.42 / D213）：导出到 Anki Phase 1 的机器闸门——
// electron/ankiExport.js 纯函数 + writeExport 的转换语义与逐字节确定性。
// 运行：ELECTRON_RUN_AS_NODE=1 npx electron tests/anki-export.test.cjs
// 覆盖（报告 C-39 步骤 5 的断言清单）：问答卡 5 列 / GUID / Deck、同答卡与分答卡的
//   {{c1::…}} 转换、hint 进 Back Extra、跨行 <br> 与引号 ""、MathJax 定界符（行内/块级/代码原样）、
//   bookasset 图片复制与越界拒绝（C-08 resolveBookassetPath）、标签层级、
//   图片遮挡卡进 skipped.txt、同一输入两次导出逐字节相同。
"use strict";
const os = require("os");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const anki = require(path.join(ROOT, "electron", "ankiExport.js"));

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`);
  }
}

// ---------- 临时 userData（绝不触碰真实数据目录） ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nut-anki-"));
const imgDir = path.join(tmp, "assets", "item1");
fs.mkdirSync(imgDir, { recursive: true });
fs.writeFileSync(path.join(imgDir, "img-0.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]));

let seq = 0;
const mk = (over) => ({
  id: `card-${++seq}`,
  cardType: "qa",
  frontMarkdown: "题面",
  backMarkdown: "答案",
  docTitle: "书名",
  tags: [],
  clozeOrds: [],
  createdAt: 1000 + seq,
  libraryItemId: null,
  ...over,
});

/** TSV 解析：头部 7 行（# 开头），数据行每列都被 q() 包裹成 "..."（内部 " 写成 ""） */
function parseTsv(txt) {
  const lines = txt.split("\n");
  const header = lines.slice(0, 7);
  const data = [];
  for (const l of lines.slice(7)) {
    if (l === "") continue;
    data.push(l.split("\t").map((c) => c.slice(1, -1).replace(/""/g, '"')));
  }
  return { header, data };
}
function dataLines(txt) {
  return txt.split("\n").filter((l) => l !== "" && !l.startsWith("#"));
}

function newCtx() {
  const mediaDir = path.join(tmp, `media-${++seq}`);
  fs.mkdirSync(mediaDir, { recursive: true });
  return { userData: tmp, mediaDir, copied: new Set(), warnings: [] };
}

try {
  // ---------- 1. 问答卡：basic.txt 数据行 5 列 / GUID / Deck ----------
  console.log("1. 问答卡 → Basic（5 列 / nut-<id> / Nutation::书名）");
  {
    const ctx = newCtx();
    const card = mk({ id: "qa-x1" });
    const r = anki.buildExport([card], ctx);
    const { header, data } = parseTsv(r.basicTxt);
    check("头部 7 行且 notetype 为 Basic", header.length === 7 && header[2] === "#notetype:Basic", ["7 行", "#notetype:Basic"], [header.length, header[2]]);
    check("数据行 1 条且 5 列", data.length === 1 && data[0].length === 5, [1, 5], [data.length, data[0] && data[0].length]);
    check("第 5 列 GUID = nut-<id>", data[0][4] === "nut-qa-x1", "nut-qa-x1", data[0][4]);
    check("第 4 列 Deck = Nutation::书名", data[0][3] === "Nutation::书名", "Nutation::书名", data[0][3]);
    check("counts.basic = 1", r.counts.basic === 1 && r.counts.cloze === 0 && r.counts.skipped === 0, { basic: 1, cloze: 0, skipped: 0 }, r.counts);
  }

  // ---------- 2. 同答卡：clozeOrds 空 → 所有空都改 c1 ----------
  console.log("2. 同答卡 clozeOrds=[] → 全部挖空改 {{c1::…}}");
  {
    const conv = anki.convertCloze("{{c1::甲}}和{{c2::乙}}", []);
    check("convertCloze 语义", conv.text === "{{c1::甲}}和{{c1::乙}}" && conv.masked === 2, { text: "{{c1::甲}}和{{c1::乙}}", masked: 2 }, { text: conv.text, masked: conv.masked });
    const ctx = newCtx();
    const r = anki.buildExport([mk({ cardType: "cloze", frontMarkdown: "{{c1::甲}}和{{c2::乙}}", clozeOrds: [] })], ctx);
    const { data } = parseTsv(r.clozeTxt);
    check("cloze.txt Text 列含转换结果", data.length === 1 && data[0][0].includes("{{c1::甲}}和{{c1::乙}}"), "含 {{c1::甲}}和{{c1::乙}}", data[0] && data[0][0]);
  }

  // ---------- 3. 分答卡：clozeOrds=[2] → 只遮自己的空 ----------
  console.log("3. 分答卡 clozeOrds=[2] → 甲和{{c1::乙}}");
  {
    const conv = anki.convertCloze("{{c1::甲}}和{{c2::乙}}", [2]);
    check("convertCloze 语义", conv.text === "甲和{{c1::乙}}" && conv.masked === 1, { text: "甲和{{c1::乙}}", masked: 1 }, { text: conv.text, masked: conv.masked });
    const ctx = newCtx();
    const r = anki.buildExport([mk({ cardType: "cloze", frontMarkdown: "{{c1::甲}}和{{c2::乙}}", clozeOrds: [2] })], ctx);
    const { data } = parseTsv(r.clozeTxt);
    check("cloze.txt Text 列 = 甲和{{c1::乙}}", data[0][0].includes("甲和{{c1::乙}}"), "含 甲和{{c1::乙}}", data[0][0]);
  }

  // ---------- 4. 带提示：hint 不上正面，进 Back Extra ----------
  console.log("4. 带提示 {{c1::甲::提示}} → 正文无提示 / Back Extra 含「提示：提示」");
  {
    const conv = anki.convertCloze("{{c1::甲::提示}}", null);
    check("convertCloze 收集 hint", conv.text === "{{c1::甲}}" && JSON.stringify(conv.hints) === JSON.stringify(["提示"]), { text: "{{c1::甲}}", hints: ["提示"] }, { text: conv.text, hints: conv.hints });
    const ctx = newCtx();
    const r = anki.buildExport([mk({ cardType: "cloze", frontMarkdown: "{{c1::甲::提示}}" })], ctx);
    const { data } = parseTsv(r.clozeTxt);
    check("Text 列不含「提示」", !data[0][0].includes("提示"), "不含", data[0][0]);
    check("Back Extra 含「提示：提示」", data[0][1].includes("提示：提示"), "含", data[0][1]);
  }

  // ---------- 5. 跨行答案与引号：无裸 \n、含 <br>；" 包裹并写成 "" ----------
  console.log("5. 跨行 <br> / 引号转义 / 数据行无裸换行");
  {
    const ctx = newCtx();
    const cards = [
      mk({ cardType: "cloze", frontMarkdown: "{{c1::甲\n乙}}" }),
      mk({ frontMarkdown: "题面", backMarkdown: "答", docTitle: '书名"引' }),
      mk({ frontMarkdown: "题面", contextPrefix: '前 "引"' }),
    ];
    const r = anki.buildExport(cards, ctx);
    const basicAll = dataLines(r.basicTxt);
    const clozeAll = dataLines(r.clozeTxt);
    check("cloze 数据行无裸换行且含 <br>", clozeAll.length === 1 && !clozeAll[0].includes("\n") && clozeAll[0].includes("<br>"),
      "1 行 / 无 \\n / 含 <br>", [clozeAll.length, clozeAll[0] && clozeAll[0].includes("\n"), clozeAll[0] && clozeAll[0].includes("<br>")]);
    const { data } = parseTsv(r.basicTxt);
    const rowQuote = data.find((cols) => cols[3].includes('"'));
    check('Deck 中的 " 被包裹并写成 ""（原文还原正确）', !!rowQuote && rowQuote[3] === 'Nutation::书名"引' && r.basicTxt.includes('""'),
      'Nutation::书名"引 且原文含 ""', rowQuote && [rowQuote[3], r.basicTxt.includes('""')]);
    const rowPrefix = data.find((cols) => cols[0].includes("前"));
    check('contextPrefix 中的 " 原样还原', !!rowPrefix && rowPrefix[0].includes('前 "引"'), '含 前 "引"', rowPrefix && rowPrefix[0]);
    for (const [label, lines] of [["basic", basicAll], ["cloze", clozeAll]]) {
      check(`${label} 每条数据行都以引号开头（无断行碎片）`, lines.every((l) => l.startsWith('"')), "全部 \" 开头", lines.map((l) => l.slice(0, 6)));
    }
  }

  // ---------- 6. 数学公式：MathJax 定界符；代码原样 ----------
  console.log("6. $x_1$ → \\(x_1\\) / $$…$$ → \\[…\\] / 行内代码原样");
  {
    const ctx = newCtx();
    const cards = [
      mk({ frontMarkdown: "$x_1$", backMarkdown: "答" }),
      mk({ frontMarkdown: "$$\\frac{a}{b}$$", backMarkdown: "答" }),
      mk({ frontMarkdown: "`$PATH`", backMarkdown: "答" }),
    ];
    const r = anki.buildExport(cards, ctx);
    const rows = parseTsv(r.basicTxt).data;
    check("$x_1$ → \\(x_1\\) 且无 <em>", rows[0][0].includes("\\(x_1\\)") && !rows[0][0].includes("<em>"), "\\(x_1\\)", rows[0][0]);
    check("$$\\frac{a}{b}$$ → \\[\\frac{a}{b}\\]", rows[1][0].includes("\\[\\frac{a}{b}\\]"), "\\[\\frac{a}{b}\\]", rows[1][0]);
    check("行内代码 `$PATH` 原样", rows[2][0].includes("<code>$PATH</code>"), "<code>$PATH</code>", rows[2][0]);
  }

  // ---------- 7. 图片：bookasset 复制进 media / 越界拒绝进 warnings ----------
  console.log("7. bookasset 图片复制与越界拒绝");
  {
    const cards = [
      mk({ frontMarkdown: "![](bookasset://item1/img-0.png)", backMarkdown: "答" }),
      mk({ frontMarkdown: "![](bookasset://item1/..%2F..%2Fsettings.json)", backMarkdown: "答" }),
    ];
    const outRoot = path.join(tmp, "out-media");
    const r = anki.writeExport({ cards, userData: tmp, outRoot, now: new Date(2026, 0, 15, 8, 30, 5) });
    const mediaFiles = fs.readdirSync(path.join(r.dir, "media"));
    check("media 中出现 nut_item1_img-0.png", mediaFiles.includes("nut_item1_img-0.png") && mediaFiles.length === 1, ["nut_item1_img-0.png"], mediaFiles);
    const basicTxt = fs.readFileSync(path.join(r.dir, "basic.txt"), "utf8");
    const imgRow = parseTsv(basicTxt).data.find((cols) => cols[0].includes("<img"));
    check("HTML 引用 media 文件名", !!imgRow && imgRow[0].includes('<img src="nut_item1_img-0.png"'), 'src="nut_item1_img-0.png"', imgRow && imgRow[0]);
    const skippedTxt = fs.readFileSync(path.join(r.dir, "skipped.txt"), "utf8");
    check("越界 URL 不复制且计入 warnings（skipped.txt）", r.warnings === 1 && skippedTxt.includes("图片未找到或不允许") && skippedTxt.includes("settings.json"),
      "warnings=1 且 skipped.txt 记录", [r.warnings, skippedTxt.trim()]);
    check("README.txt 存在", fs.existsSync(path.join(r.dir, "README.txt")), true, fs.existsSync(path.join(r.dir, "README.txt")));
  }

  // ---------- 8. 标签：层级保留 + 空白换 _ + nutation ----------
  console.log("8. 标签 [考研::英语, a b] → 考研::英语 a_b nutation");
  {
    const ctx = newCtx();
    const r = anki.buildExport([mk({ tags: ["考研::英语", "a b"] })], ctx);
    const { data } = parseTsv(r.basicTxt);
    check("Tags 列", data[0][2] === "考研::英语 a_b nutation", "考研::英语 a_b nutation", data[0][2]);
  }

  // ---------- 9. 图片遮挡卡 → skipped.txt ----------
  console.log("9. 图片遮挡卡进 skipped.txt（Phase 1 不支持）");
  {
    const occl = mk({ cardType: "imageOcclusion" });
    const outRoot = path.join(tmp, "out-skip");
    const r = anki.writeExport({ cards: [occl], userData: tmp, outRoot, now: new Date(2026, 0, 15, 8, 30, 6) });
    const skippedTxt = fs.readFileSync(path.join(r.dir, "skipped.txt"), "utf8");
    check("skipped.txt 含卡 id、类型与原因", skippedTxt.includes(occl.id) && skippedTxt.includes("imageOcclusion"),
      `含 ${occl.id} 与 imageOcclusion`, skippedTxt.trim());
    check("原因注明 Phase 2", skippedTxt.includes("图片遮挡卡暂不支持（Phase 2）"), "图片遮挡卡暂不支持（Phase 2）", skippedTxt.trim());
    check("counts.skipped = 1 / basic 与 cloze 为 0", r.skipped === 1 && r.basic === 0 && r.cloze === 0, { skipped: 1, basic: 0, cloze: 0 }, { skipped: r.skipped, basic: r.basic, cloze: r.cloze });
  }

  // ---------- 10. 确定性：同一输入两次导出逐字节相同 ----------
  console.log("10. 同一输入两次导出（固定 now、不同目录）逐字节相同");
  {
    const cards = [
      mk({ id: "det-qa", frontMarkdown: "问题 $x$" }),
      mk({ id: "det-cl", cardType: "cloze", frontMarkdown: "{{c1::甲\n乙}}", clozeOrds: [] }),
    ];
    const fixed = new Date(2026, 0, 15, 8, 30, 7);
    const a = anki.writeExport({ cards, userData: tmp, outRoot: path.join(tmp, "det-a"), now: fixed });
    const b = anki.writeExport({ cards, userData: tmp, outRoot: path.join(tmp, "det-b"), now: fixed });
    const ba = fs.readFileSync(path.join(a.dir, "basic.txt"));
    const bb = fs.readFileSync(path.join(b.dir, "basic.txt"));
    const ca = fs.readFileSync(path.join(a.dir, "cloze.txt"));
    const cb = fs.readFileSync(path.join(b.dir, "cloze.txt"));
    check("basic.txt 逐字节相同", ba.equals(bb), true, `${ba.length} vs ${bb.length} 字节`);
    check("cloze.txt 逐字节相同", ca.equals(cb), true, `${ca.length} vs ${cb.length} 字节`);
    check("目录名含固定时间戳", path.basename(a.dir) === "Nutation-Anki-20260115-083007", "Nutation-Anki-20260115-083007", path.basename(a.dir));
  }
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
}

console.log(`\n合计：通过 ${pass} / 失败 ${fail}`);
process.exitCode = fail ? 1 : 0;
