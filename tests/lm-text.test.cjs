// @runtime: node
// 运行：node tests/lm-text.test.cjs
// D124 §13.1：lmText 用例（markdownToPlain / segmentMarkdown / segmentPages / detectLang）
const assert = require("node:assert");
const path = require("node:path");
const lmText = require(path.join(__dirname, "..", "electron", "lmText.js"));

let n = 0;
function ok(cond, label) {
  assert.ok(cond, label);
  n++;
}

// 1. markdownToPlain
ok(
  lmText.markdownToPlain("# 标题\n**粗**和[链接](http://x)![图](a.png)").trim() === "标题\n粗和链接图",
  "markdownToPlain 基本替换"
);

// 2. 合并
const md2 = "# A\n" + "a".repeat(1000) + "\n# B\n" + "b".repeat(1000) + "\n# C\n" + "c".repeat(4000);
const u2 = lmText.segmentMarkdown(md2);
ok(u2.length === 2, "合并后 2 个单元");
ok(u2[0].title === "A" && u2[1].title === "C", "标题保留 cur 的");
ok(u2[0].mdFrom === 0, "第 1 个单元 mdFrom=0");
ok(u2[1].mdFrom === md2.indexOf("# C"), "第 2 个单元 mdFrom = # C 偏移");
ok(u2[u2.length - 1].mdTo === md2.length, "最后一个 mdTo = md.length");

// 3. 拆分
const md3 = "# T\n" + Array.from({ length: 13 }, () => "x".repeat(1000)).join("\n\n");
const u3 = lmText.segmentMarkdown(md3);
ok(u3.length === 4, "超长拆成 4 块");
ok(
  JSON.stringify(u3.map((u) => u.title)) === JSON.stringify(["T（1/4）", "T（2/4）", "T（3/4）", "T（4/4）"]),
  "拆分标题带（i/k）"
);

// 4. 无标题
const u4 = lmText.segmentMarkdown("y".repeat(800));
ok(u4.length === 1 && u4[0].title === "开篇", "无标题整篇一个单元，标题开篇");

// 5. 空章节被删
const u5 = lmText.segmentMarkdown("# A\n\n# B\n" + "b".repeat(2000));
ok(u5.length === 1 && u5[0].title === "B", "空章节在合并前被丢弃");

// 6. isExercise
const u6 = lmText.segmentMarkdown("# 第三章 习题\n" + "q".repeat(2000));
ok(u6.length === 1 && u6[0].isExercise === 1, "习题标题 isExercise=1");

// 7. segmentPages
const u7 = lmText.segmentPages(["a".repeat(2000), "b".repeat(2000), "c".repeat(500)]);
ok(u7.length === 1 && u7[0].pageFrom === 0 && u7[0].pageTo === 2, "PDF 三页并一个单元（末块并入）");

// 8. detectLang（公有领域作品开头，200 词以上真实文本）
const JA = "むかしむかし、あるところにおじいさんとおばあさんがいました。おじいさんは山へしばかりに、おばあさんは川へせんたくに行きました。川で大きなももをひろったので、もちかえって食べたところ、中から元気な男のこどもがうまれました。おじいさんとおばあさんは大よろこびで、桃太郎という名前をつけて大切にそだてました。桃太郎はすくすくと育ち、やがて村いちばんの力持ちになって、鬼が島の鬼をこらしめるために旅立ちました。";
const ZH = "从前有一座山，山上有一座庙，庙里有一个老和尚和一个小和尚。老和尚常常给小和尚讲故事，讲的是从前有座山的故事。小和尚听着听着就睡着了，醒来又缠着老和尚再讲一遍。山下的村里人们常常上山来烧香拜佛，祈求风调雨顺、家人平安。庙前的石阶被岁月磨得光滑，每一步都记录着几十年来上山下山的人们的故事。老和尚说，山不会说话，但山记得一切。";
const EN = "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, and what is the use of a book, thought Alice, without pictures or conversations? So she was considering in her own mind, as well as she could, for the hot day made her feel very sleepy and stupid, whether the pleasure of making a daisy-chain would be worth the trouble of getting up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her.";
const FR = "Il y avait en Westphalie, dans le château de M. le baron de Thunder-ten-tronckh, un jeune garçon à qui la nature avait donné les mœurs les plus douces. Son visage était l'âme du sien ; il avait le jugement assez droit, avec l'esprit le plus simple ; c'est, je crois, pourquoi on le nommait Candide. Les anciens de la maison le soupçonnaient d'être fils de la sœur du baron, et cette sœur ne put jamais se résoudre à épouser aucun des souverains de l'Allemagne, qui n'avaient pas soixante-quartiers.";
const DE = "Es ist ein alter Traum der Menschen, mit den Vögeln zu fliegen. Die Technik hat es sich zur Aufgabe gemacht, diesen Traum zu erfüllen, und so ist das Flugzeug zu einem der wichtigsten Verkehrsmittel unserer Zeit geworden. Wer mit dem Flugzeug reist, der sieht die Erde von oben, und er versteht, wie klein die Menschen sind, wenn sie sich aus der Ferne betrachten. Doch der Traum ist älter als die Maschine, und er lebt in jedem fort, der die Wolken sehen will.";
const ES = "En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero, adarga antigua, rocín flaco y galgo corredor. Una olla de algo más vaca que carnero, salpicón las más noches, duelos y quebrantos los sábados, lentejas los viernes, algún palomino de añadidura los domingos, consumían las tres partes de su hacienda.";
const RU = "Все счастливые семьи похожи друг на друга, каждая несчастливая семья несчастлива по-своему. Все смешалось в доме Облонских. Жена выяснила, что муж был в связи с бывшею в их доме француженкою, и объявила мужу, что не может жить с ним в одном доме. Положение это продолжалось уже третий день и мучительно чувствовалось и самими супругами, и всеми членами семьи, и домочадцами.";
const TH = "เมื่อวานนี้ฉันไปที่ตลาดกับแม่ของฉันเพื่อซื้อผลไม้และผักสดสำหรับทำอาหารเย็นนี้ให้ครอบครัวได้กินด้วยกัน ที่ตลาดคนเยอะมากและของก็สดใหม่ทุกอย่าง แม่ซื้อมะม่วงกล้วยและส้มมาเป็นจำนวนมาก ฉันช่วยแม่ถือถุงเดินกลับบ้านด้วยกันอย่างมีความสุข";
const AR = "كان يا ما كان في قديم الزمان تاجر كبير اسمه علي وكان لديه ثلاثة أبناء يعيشون في مدينة بغداد الجميلة ويعملون في تجارة الحرير وال التوابل بين البلاد العربية والأجنبية وكان الابن الأكبر ذكيا جدا يحب القراءة والتعلم في كل وقت.";
ok(lmText.detectLang(JA) === "ja", "detectLang 日文");
ok(lmText.detectLang(ZH) === "zh", "detectLang 中文");
ok(lmText.detectLang(EN) === "en", "detectLang 英文");
ok(lmText.detectLang(FR) === "fr", "detectLang 法文");
ok(lmText.detectLang(DE) === "de", "detectLang 德文");
ok(lmText.detectLang(ES) === "es", "detectLang 西班牙文");
ok(lmText.detectLang(RU) === "ru", "detectLang 俄文");
ok(lmText.detectLang(TH) === "th", "detectLang 泰文");
ok(lmText.detectLang(AR) === "ar", "detectLang 阿拉伯文");
ok(lmText.detectLang("the quick fox") === "", "3 个拉丁词的短句 → 未知");
ok(lmText.detectLang("123") === "", "纯数字 → 未知");

// 9. 代码围栏内的 # 不是标题 不切分
const md9 = "# 真标题\n" + "t".repeat(2000) + "\n```python\n# 不是标题\nprint(1)\n```\n" + "s".repeat(2000);
const u9 = lmText.segmentMarkdown(md9);
ok(u9.length === 1 && u9[0].title === "真标题", "围栏内的 # 不切分");

console.log(`${n} passed`);
