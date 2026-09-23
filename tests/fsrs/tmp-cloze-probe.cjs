// 探针：手动/AI 填空题（cloze）的两个纯函数缺陷（子代理 B-7#6 / #9）
//  #6 跨行挖空：正则缺 s 标志 → . 不跨行 → 匹配不到 → 正面原样吐出 {{c1::答案}}，题面泄漏答案
//  #9 同卡重复 ord（{{c1::甲}}…{{c1::乙}}）：ords 是 Set 只剩一个 1，但 render 全局替换把两空都遮，
//     背面 extractClozeAnswer 用非全局正则只取第一个 → 第二个空的答案永远丢失
// 运行：npx esbuild src/lib/cards.ts --bundle --platform=node --format=cjs \
//         --outfile=tests/fsrs/cards.probe.bundle.cjs && node tests/fsrs/tmp-cloze-probe.cjs
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const { parseCloze, extractClozeAnswer, extractClozeAnswers } = require(path.join(__dirname, "cards.probe.bundle.cjs"));

let red = 0;
const t = (name, cond, detail) => { console.log(`  ${cond ? "✓" : "✗"} ${name}${cond ? "" : "   ← " + detail}`); if (!cond) red++; };

console.log("== #6 跨行挖空 ==");
const multiline = "前文 {{c1::第一行答案\n第二行续写}} 后文";
const p6 = parseCloze(multiline);
const front6 = p6.render([1]);
console.log(`  ords = ${JSON.stringify(p6.ords)}`);
console.log(`  正面 = ${JSON.stringify(front6)}`);
console.log(`  背面 = ${JSON.stringify(extractClozeAnswer(multiline, 1))}`);
t("M6-1 跨行挖空应被识别出 1 个空", p6.ords.length === 1, `ords=${JSON.stringify(p6.ords)}（0 个 → lint 也数不到）`);
t("M6-2 正面必须遮蔽答案，不得出现字面量 {{c1::", !front6.includes("{{c1::"), `正面原文吐出标记：${JSON.stringify(front6)}`);
t("M6-3 正面不得含答案内容", !front6.includes("第一行答案"), `答案「第一行答案」直接印在题面上`);
t("M6-4 背面应取回完整答案", extractClozeAnswer(multiline, 1).includes("第一行答案"), JSON.stringify(extractClozeAnswer(multiline, 1)));

console.log("\n== #9 同一张卡里重复 ord ==");
const dup = "甲是 {{c1::答案甲}}，乙是 {{c1::答案乙}}。";
const p9 = parseCloze(dup);
const front9 = p9.render([1]);
const back9 = extractClozeAnswer(dup, 1);
console.log(`  ords = ${JSON.stringify(p9.ords)}`);
console.log(`  正面 = ${JSON.stringify(front9)}`);
console.log(`  背面 = ${JSON.stringify(back9)}`);
console.log(`  按 ord 数组取 = ${JSON.stringify(extractClozeAnswers(dup, p9.ords))}`);
t("M9-1 正面两个空都应被遮", !front9.includes("答案甲") && !front9.includes("答案乙"), JSON.stringify(front9));
t("M9-2 背面应含**两个**空的答案（内容不得丢）", back9.includes("答案甲") && back9.includes("答案乙"), `背面只有 ${JSON.stringify(back9)} —— 「答案乙」永久丢失`);

console.log("\n== 对照：正常单行挖空（证明探针本身没坏） ==");
const ok = "正常 {{c1::答案一}} 结束。";
const pok = parseCloze(ok);
t("对照-1 ords 识别到 1", pok.ords.length === 1, JSON.stringify(pok.ords));
t("对照-2 正面已遮蔽", pok.render([1]) === "正常 […] 结束。", JSON.stringify(pok.render([1])));
t("对照-3 背面取回答案", extractClozeAnswer(ok, 1) === "答案一", JSON.stringify(extractClozeAnswer(ok, 1)));

console.log("\n== 对照：带 hint 与多空同答 ==");
const hint = "带提示 {{c1::正文::提示语}}。";
t("对照-4 hint 不上正面", !parseCloze(hint).render([1]).includes("提示语"), JSON.stringify(parseCloze(hint).render([1])));
const multi = "A{{c1::一}}B{{c2::二}}";
t("对照-5 分答两 ord 各自可取", extractClozeAnswers(multi, [1, 2]).join("|") === "一|二", JSON.stringify(extractClozeAnswers(multi, [1, 2])));

console.log(`\n判红 ${red} 条`);
process.exitCode = red ? 1 : 0;
