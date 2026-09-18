// M1 制卡体系升级回归测试（v15；v31 增 M1-11/12）
// 覆盖：材料类型路由（M1.2）、CardLint L11 语义修正（M1.1b）、cloze 契约不回归（Non-Goal 验证）、
//       翻转问答卡（M1.1a）的字段流转约束、CardLint L16 宽容度标注（v31 缺口 L-C；L-A 数字密度经用户反馈取消）、
//       提示词基线 v6（取消 G9、文学模板接上、G6/G7 对齐）
// 运行：node tests/m1.test.cjs（依赖 tests/m1.cards.bundle.cjs，由 esbuild 打包 src/lib/cards.ts 生成）
// 重新打包：node_modules/.bin/esbuild src/lib/cards.ts --bundle --platform=node --format=cjs --outfile=tests/m1.cards.bundle.cjs
const cards = require("./m1.cards.bundle.cjs");

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}

console.log("== M1-1 材料类型路由（本地规则，M1.2） ==");
const rFormula = cards.detectMaterialType("质能方程 E=mc^2 揭示了质量与能量的公式关系");
check("公式材料 → card-formula", rFormula.scope === "card-formula" && rFormula.materialType === "formula", "card-formula/formula", rFormula);
const rSeq = cards.detectMaterialType("光 合作用 首先 吸收光能，然后 转化为化学能，最后 释放氧气");
check("流程材料 → card-seq", rSeq.scope === "card-seq" && rSeq.materialType === "sequence", "card-seq/sequence", rSeq);
const rEnum = cards.detectMaterialType("影响气候的因素：列出 有哪些 主要因素、分别说明");
check("枚举材料 → card-enum", rEnum.scope === "card-enum" && rEnum.materialType === "enumeration", "card-enum/enumeration", rEnum);
const rConcept = cards.detectMaterialType("中位数是把一组数据排序后位于中间位置的数，它对极端值不敏感。");
check("概念材料 → card-generation", rConcept.scope === "card-generation" && rConcept.materialType === "concept", "card-generation/concept", rConcept);
check("概念默认形式=问答", rConcept.defaultForm === "问答", "问答", rConcept.defaultForm);
check("枚举默认形式=挖空", rEnum.defaultForm === "挖空", "挖空", rEnum.defaultForm);
check("映射表含图片材料 → card-occlusion/图片挖空", cards.MATERIAL_ROUTES.image.scope === "card-occlusion" && cards.MATERIAL_ROUTES.image.defaultForm === "图片挖空", "card-occlusion/图片挖空", cards.MATERIAL_ROUTES.image);
check("detectMode 旧接口保持兼容（公式）", cards.detectMode("勾股定理 公式 a^2+b^2=c^2") === "card-formula", "card-formula", cards.detectMode("勾股定理 公式 a^2+b^2=c^2"));

console.log("== M1-2 CardLint L11 语义（M1.1b：缺资产而非缺 front） ==");
const occOk = cards.lintCard({ front: "图中遮挡区域对应的是什么？", back: "海马体", cardType: "imageOcclusion", occlusion: { assetPath: "bookasset://x/y.png", rects: [{ x: 1, y: 2, w: 3, h: 4, ord: 0 }] } });
check("带 occlusion 资产的遮挡卡不触发 L11", !occOk.some((i) => i.ruleId === "L11"), "无 L11", occOk);
const occMissing = cards.lintCard({ front: "图中遮挡区域对应的是什么？", back: "海马体", cardType: "imageOcclusion", occlusion: null });
check("缺 occlusion 资产的遮挡卡触发 L11(error)", occMissing.some((i) => i.ruleId === "L11" && i.severity === "error"), "L11/error", occMissing);
const occEmptyRects = cards.lintCard({ front: "x", back: "y", cardType: "imageOcclusion", occlusion: { assetPath: "bookasset://x/y.png", rects: [] } });
// v29 将 L11 放宽为「有 asset 即有效」，v30 D28 用户拍板定版看图问答卡（rects=[] 挂图+题面）为合法形态
check("rects 为空的看图问答卡（有 asset）不触发 L11", !occEmptyRects.some((i) => i.ruleId === "L11"), "无 L11", occEmptyRects);

console.log("== M1-3 cloze 契约不回归（Non-Goal 验证，§5.4/§7.2） ==");
const clozeText = "线粒体是细胞的{{c1::能量工厂}}，DNA 复制发生在{{c2::细胞核}}。";
const parsed = cards.parseCloze(clozeText);
check("挖空 ords 解析", JSON.stringify(parsed.ords) === "[1,2]", "[1,2]", parsed.ords);
check("正面全遮蔽为 […]（不含 hint 内容）", parsed.render(1).includes("[…]"), "含[…]", parsed.render(1));
check("未遮蔽挖空显示原文", parsed.render(1).includes("细胞核"), "含原文", parsed.render(1));
// v15 修复 extractClozeAnswer 组序 bug：此前恒返回 hint（无 hint 卡背面空串，违反答案区契约）
check("背面答案=content（无 hint）", cards.extractClozeAnswer("线粒体是{{c1::能量工厂}}的场所", 1) === "能量工厂", "能量工厂", cards.extractClozeAnswer("线粒体是{{c1::能量工厂}}的场所", 1));
check("背面答案完整（含 hint 拼回）", cards.extractClozeAnswer("细胞是{{c1::线粒体::动力}}的家", 1) === "线粒体（动力）", "线粒体（动力）", cards.extractClozeAnswer("细胞是{{c1::线粒体::动力}}的家", 1));
check("挖空 >2 处触发 L9", cards.lintCard({ front: "x", back: "y", cardType: "cloze", cloze: "a{{c1::1}}b{{c2::2}}c{{c3::3}}" }).some((i) => i.ruleId === "L9"), "L9", true);

console.log("== M1-4 翻转问答=两张独立问答卡（v16 D18：各面独立按 qa 语义过 lint） ==");
// 手动/拆分路径产出的两张独立 qa 卡，各自过 lint（与普通 qa 卡同标准）
const aFace = cards.lintCard({ front: "统计: 中位数是什么？", back: "排序后位于中间位置的数", cardType: "qa" });
check("正向卡 lint 通过", aFace.filter((i) => i.severity === "error").length === 0, "0 error", aFace);
const bFace = cards.lintCard({ front: "统计: 排序后位于中间位置的数叫什么？", back: "中位数", cardType: "qa" });
check("反向卡 lint 通过", bFace.filter((i) => i.severity === "error").length === 0, "0 error", bFace);
const overloadedB = cards.lintCard({ front: "反向卡题面", back: "字".repeat(70), cardType: "qa" });
check("反向卡过载同样触发 L1（独立卡同标准）", overloadedB.some((i) => i.ruleId === "L1"), "L1", overloadedB);

console.log("== M1-5 JSON 容错（管线第⑤步复用） ==");
const okJson = cards.extractJson('前置噪音{"knowledgePoints":[],"blockReasons":[],"cards":[{"cardType":"qa","front":"A","back":"a","ruleNotes":["R2"]}]}后置噪音');
check("容错解析未知字段安全透传", okJson.cards[0].cardType === "qa" && okJson.cards[0].ruleNotes[0] === "R2", "qa/R2", okJson.cards[0]);
let threw = false;
try { cards.extractJson("没有 JSON"); } catch { threw = true; }
check("无 JSON 时抛错", threw, "throw", "no-throw");

console.log("== M1-6 递进补卡：「后续可补」注记解析（v16） ==");
const groups = cards.parseFollowUps([
  "中国哲学家在论证、说明方面逊于西洋与印度哲学家（后续可补：原因卡、举例卡、与冯友兰其他观点的联系卡）",
  "逊色的原因：中国哲学家之『不为』，非尽『不能』（后续可补：『不为/不能』的出处《孟子·梁惠王上》齐宣王问『不为者与不能者之形』卡）",
  "普通知识点摘要无注记"
]);
check("解析出 2 个带注记的知识点", groups.length === 2, groups.length);
check("注记剥离后保留 kp 标题", groups[0].kpTitle === "中国哲学家在论证、说明方面逊于西洋与印度哲学家", groups[0].kpTitle);
check("逐项按顿号拆分", groups[0].items.length === 3 && groups[0].items[0] === "原因卡", groups[0].items);
check("含书名号/引号的整项不被误拆", groups[1].items.length === 1 && groups[1].items[0].includes("孟子"), groups[1].items);
const half = cards.parseFollowUps(["X(后续可补: A，B)"]);
check("半角括号/冒号兼容", half.length === 1 && half[0].items.length === 2, half);
check("无注记不产组", cards.parseFollowUps(["普通"]).length === 0, 0);
check("非数组输入安全", cards.parseFollowUps(null).length === 0, 0);

console.log("== M1-7 材料识别：诗词 → 文学/诗歌背诵（v16 修复，雨霖铃案例） ==");
const yulinling = `《雨霖铃·寒蝉凄切》
寒蝉凄切。对长亭晚，骤雨初歇。都门帐饮无绪，留恋处，兰舟催发。
执手相看泪眼，竟无语凝噎。
念去去，千里烟波，暮霭沉沉楚天阔。
多情自古伤离别，更那堪，冷落清秋节！
今宵酒醒何处？杨柳岸，晓风残月。
此去经年，应是良辰好景虚设。
便纵有千种风情，更与何人说？`;
const rPoem = cards.detectMaterialType(yulinling);
check("词牌标题+行密度 → literature", rPoem.materialType === "literature" && rPoem.scope === "card-literature", "literature/card-literature", rPoem);
const rPoemPara = cards.detectMaterialType("《雨霖铃·寒蝉凄切》 寒蝉凄切。对长亭晚，骤雨初歇。都门帐饮无绪，留恋处，兰舟催发。执手相看泪眼，竟无语凝噎。念去去，千里烟波，暮霭沉沉楚天阔。多情自古伤离别，更那堪，冷落清秋节！今宵酒醒何处？杨柳岸，晓风残月。此去经年，应是良辰好景虚设。便纵有千种风情，更与何人说？");
check("单段粘贴的词（短句密度）→ literature", rPoemPara.materialType === "literature", rPoemPara);
const rMencius = cards.detectMaterialType("《孟子·梁惠王上》节选与今译：齐宣王问曰：齐桓、晋文之事，可得闻乎？孟子对曰：仲尼之徒，无道桓、文之事者，是以后世无传焉，臣未之闻也。无以，则王乎？曰：德何如，则可以王矣？曰：保民而王，莫之能御也。现代译文：齐宣王问道，齐桓公、晋文公在春秋时代先后称霸的事实，能够讲给我听听吗……这段对话体现了孟子劝导统治者施行仁政的核心论证路径，后世儒者对此多有阐发。");
check("文言书名+长句译文 → 不误判 literature", rMencius.materialType !== "literature", rMencius);
check("概念材料仍 → concept", cards.detectMaterialType("中位数是把一组数据排序后位于中间位置的数，它对极端值不敏感。").materialType === "concept", "concept");
check("流程/枚举/公式路由不受影响", cards.detectMaterialType("首先吸收光能，然后转化为化学能，最后释放氧气").scope === "card-seq" && cards.detectMaterialType("列出 有哪些 因素、分别说明").scope === "card-enum", "seq/enum");
console.log("== M1-7b 识别扩展：唐诗/现代自由诗（v16-c） ==");
const jingyesi = "床前明月光，\n疑是地上霜。\n举头望明月，\n低头思故乡。";
check("唐诗五言定长 → literature（无标题也能识别）", cards.detectMaterialType(jingyesi).materialType === "literature", cards.detectMaterialType(jingyesi));
const fengqiao = "月落乌啼霜满天，\n江枫渔火对愁眠。\n姑苏城外寒山寺，\n夜半钟声到客船。";
check("唐诗七言定长 → literature", cards.detectMaterialType(fengqiao).materialType === "literature", cards.detectMaterialType(fengqiao));
const zaibie = "《再别康桥》\n轻轻的我走了，\n正如我轻轻的来；\n我轻轻的招手，\n作别西天的云彩。";
check("现代自由诗（标题+诗行）→ literature", cards.detectMaterialType(zaibie).materialType === "literature", cards.detectMaterialType(zaibie));
const condiment = "红烧肉\n糖醋排骨\n鱼香肉丝\n宫保鸡丁\n水煮鱼\n回锅肉";
check("无标点清单不误判", cards.detectMaterialType(condiment).materialType !== "literature", cards.detectMaterialType(condiment));
const steps = "第一步，切肉。\n第二步，腌肉。\n第三步，焯水。\n第四步，炖煮一小时。";
check("步骤材料不误判", cards.detectMaterialType(steps).materialType !== "literature", cards.detectMaterialType(steps));
const ciLabel = "宋词《雨霖铃》\n寒蝉凄切。对长亭晚，骤雨初歇。\n都门帐饮无绪，留恋处，兰舟催发。执手相看泪眼，竟无语凝噎。\n念去去，千里烟波，暮霭沉沉楚天阔。";
check("诗体标识词+长行分行 → literature（v16-c 标记兜底）", cards.detectMaterialType(ciLabel).materialType === "literature", cards.detectMaterialType(ciLabel));
const ciTwoStanza = `《雨霖铃·寒蝉凄切》
寒蝉凄切。对长亭晚，骤雨初歇。都门帐饮无绪，留恋处，兰舟催发。
多情自古伤离别，更那堪，冷落清秋节！今宵酒醒何处？杨柳岸，晓风残月。`;
check("上下阕两行长行 + 词牌题 → literature", cards.detectMaterialType(ciTwoStanza).materialType === "literature", cards.detectMaterialType(ciTwoStanza));
const zhs = "《中国哲学史》\n冯友兰认为中国哲学家在论证、说明方面逊于西洋与印度哲学家。\n这一差距的原因值得深入探讨，涉及表达方式与思维传统的差异。\n后世学者对此提出了多种解释，构成了理解中国哲学特点的重要视角。";
check("无诗体词的普通书名标题 → 不误判", cards.detectMaterialType(zhs).materialType !== "literature", cards.detectMaterialType(zhs));

console.log("== M1-8 JSON 容错：JSON 后附带杂质文字（v16 修复，雨霖铃首跑报错案例） ==");
const goodJson = '{"knowledgePoints":[],"blockReasons":[],"cards":[{"cardType":"seq","front":"开头 …","back":"寒蝉凄切"}]}';
const withTail = cards.extractJson(goodJson + "\n\n以上即为按诗歌脚本生成的续写卡，共覆盖全篇。} 注：可根据需要调整。");
check("JSON 后带尾注仍能解析", withTail.cards[0].back === "寒蝉凄切", withTail.cards[0]);
const withHead = cards.extractJson("好的，以下是制卡结果：\n" + goodJson + "\n完");
check("JSON 前有导语仍能解析", withTail.cards.length === 1 && withHead.cards.length === 1, "ok");
const truncated = cards.extractJson('{"cards":[{"cardType":"qa","front":"x","back":"y"}],"knowledgePoints":[]} 后缀 {');
check("旧策略仍兜底可用", truncated.cards.length === 1, truncated.cards.length);

console.log("== M1-9 一卡多空两形态（v30 D27：同答/分答，用户拍板） ==");
const multiText = "中国优绩主义的两大根脉：{{c1::科举制度}}＋{{c2::儒家伦理}}——成绩即道德合法性";
const pm = cards.parseCloze(multiText);
check("render(number) 兼容旧签名（只遮单空、其余显示原文）", pm.render(1).includes("[…]") && pm.render(1).includes("儒家伦理"), "单空遮蔽", pm.render(1));
const detail = pm.renderDetail([1, 2]);
check("同答卡两空全遮蔽（正面无答案泄漏）", detail.text.includes("[…]") && !detail.text.includes("科举制度") && !detail.text.includes("儒家伦理"), "全遮", detail.text);
check("maskedOrds 记录被遮空（默认场景）", JSON.stringify(detail.maskedOrds) === "[1,2]", "[1,2]", detail.maskedOrds);
const reversed = cards.parseCloze("{{c2::后项}}在前，{{c1::前项}}在后");
check("maskedOrds 按文本顺序而非 ord 升序（对位还原依据）", JSON.stringify(reversed.renderDetail([1, 2]).maskedOrds) === "[2,1]", "[2,1]", reversed.renderDetail([1, 2]).maskedOrds);
check("extractClozeAnswers 逐空取答案（含顺序）", JSON.stringify(cards.extractClozeAnswers(multiText, [1, 2])) === JSON.stringify(["科举制度", "儒家伦理"]), '["科举制度","儒家伦理"]', cards.extractClozeAnswers(multiText, [1, 2]));
check("extractClozeAnswers 对缺失 ord 返回空串", JSON.stringify(cards.extractClozeAnswers(multiText, [3])) === JSON.stringify([""]), '[""]', cards.extractClozeAnswers(multiText, [3]));
const split = cards.expandClozeDraft({ cardType: "cloze", front: multiText, back: "", cloze: multiText, clozeMode: "per-blank" });
check("per-blank 草稿拆为每空一张", split.length === 2, 2, split.length);
check("拆卡各自带 clozeOrds=[自己的空]", JSON.stringify(split.map((s) => s.clozeOrds)) === "[[1],[2]]", "[[1],[2]]", split.map((s) => s.clozeOrds));
check("拆卡 ord 依序编号", JSON.stringify(split.map((s) => s.ord)) === "[0,1]", "[0,1]", split.map((s) => s.ord));
check("together（缺省）不拆卡", cards.expandClozeDraft({ cardType: "cloze", front: multiText, back: "", cloze: multiText }).length === 1, 1, 1);
check("单空 per-blank 不拆", cards.expandClozeDraft({ cardType: "cloze", front: "a{{c1::b}}", back: "", clozeMode: "per-blank" }).length === 1, 1, 1);
check("非 cloze 草稿原样返回", cards.expandClozeDraft({ cardType: "qa", front: "x", back: "y" }).length === 1, 1, 1);

console.log("== M1-10 对比卡候选清单（v30 D29 候选增强：以当前卡为基准语义检索易混卡） ==");
const candCards = [
  { id: "a", cardType: "qa", frontMarkdown: "基准卡题目？", noteText: "基准卡题目？", backMarkdown: "答案A", domain: ["1"], leech: null },
  { id: "b", cardType: "qa", frontMarkdown: "易混卡题目？", noteText: "易混卡题目？", backMarkdown: "答案B", domain: ["1"], leech: null },
  { id: "c", cardType: "cloze", frontMarkdown: "挖空{{c1::内容}}卡", noteText: "挖空{{c1::内容}}卡", backMarkdown: "", domain: ["2"], leech: null },
  { id: "d", cardType: "imageOcclusion", frontMarkdown: "图中遮挡区域对应的是什么？", noteText: "图中遮挡区域对应的是什么？", backMarkdown: "图卡答案", domain: ["1"], leech: null },
  { id: "e", cardType: "qa", frontMarkdown: "挂起卡题目", noteText: "挂起卡题目", backMarkdown: "", domain: ["1"], leech: { suspended: true } }
];
const cands = cards.buildContrastCandidates(candCards, "a", ["1"]);
check("排除基准卡本身", !cands.some((t) => t.includes("基准卡")), "排除", cands);
check("挂起卡保留（用户暂停的疑似重复卡正是对比卡要找回的候选）", cands.some((t) => t.includes("挂起卡")), "保留", cands);
check("同主领域卡排前（域1在前、域2在后）", JSON.stringify(cands) === JSON.stringify(["易混卡题目？", "[图片卡] 图卡答案", "挂起卡题目", "挖空内容卡"]), "域优先序", cands);
check("挖空卡候选按展示文本展开", cands.some((t) => t.includes("内容")), "展开", cands);
check("图片卡候选用 back（front 无区分度）", cands.some((t) => t.includes("[图片卡] 图卡答案")), "[图片卡]", cands);
check("文本去重", cards.buildContrastCandidates([
  { id: "x1", cardType: "qa", frontMarkdown: "重复文本", noteText: "重复文本", backMarkdown: "" },
  { id: "x2", cardType: "qa", frontMarkdown: "重复文本", noteText: "重复文本", backMarkdown: "" }
], "").length === 1, 1, "dedupe");
check("逐条截断 ≤50 字", cards.buildContrastCandidates([{ id: "x", cardType: "qa", frontMarkdown: "长".repeat(80), noteText: "长".repeat(80), backMarkdown: "" }], "").every((t) => t.length <= 50), true, "≤50");
check("总量 cap=500", cards.buildContrastCandidates(Array.from({ length: 800 }, (_, i) => ({ id: String(i), cardType: "qa", frontMarkdown: "卡" + i, noteText: "卡" + i, backMarkdown: "" })), "").length === 500, 500, "cap");

console.log("== M1-11 CardLint L16 宽容度标注（v31：M1 缺口 L-C 落地；L-A 数字密度经用户反馈取消） ==");
// L16（=报告 L-C，对应 R2/R5 的 G7）：集合/开放式问法必须给出可字面判定的合格线
const tolMissing = cards.lintCard({ front: "哲学: 儒家有哪些核心德目？", back: "仁、义、礼、智、信", cardType: "qa" });
check("L16 集合问法缺合格线告警(warn)", tolMissing.some((i) => i.ruleId === "L16" && i.severity === "warn"), "L16/warn", tolMissing);
const tolOk = cards.lintCard({ front: "哲学: 儒家核心德目至少回忆三种？", back: "仁、义、礼", cardType: "qa" });
check("L16 已写合格线（至少）不告警", !tolOk.some((i) => i.ruleId === "L16"), "无 L16", tolOk);
const tolNa = cards.lintCard({ front: "统计: 中位数是什么？", back: "中间位置的数", cardType: "qa" });
check("L16 非集合问法不告警", !tolNa.some((i) => i.ruleId === "L16"), "无 L16", tolNa);
// L15 已取消（用户 2026-09-13 反馈「≥2 个数字即不合格」过严）：确认不再产出 L15
const noL15 = cards.lintCard({ front: "经济: GDP 增速从 3.2% 升到 5.1%？", back: "两个数字", cardType: "qa" });
check("L15 已删除：多数字卡不再触发数字密度告警", !noL15.some((i) => i.ruleId === "L15"), "无 L15", noL15);

console.log("== M1-12 提示词基线 v7（v31 定基线；v46/UM-2 组装 R20 记忆情境接地段） ==");
const fs = require("fs");
const path = require("path");
const prompts = require("../electron/prompts");
check("v7 基线含 R20 记忆接地契约与 situationRequired 注册表（card-generation/card-mnemonic/knowledge-probe=true，journal-insight 不在表）",
  prompts.CARD_GEN_PROMPT.includes("记忆情境接地（R20") && prompts.CARD_GEN_PROMPT.includes("memoryRef")
    && prompts.CARD_MNEMONIC_PROMPT.includes("memoryRef")
    && prompts.SITUATION_REQUIRED_SCOPES["card-generation"] === true
    && prompts.SITUATION_REQUIRED_SCOPES["card-mnemonic"] === true
    && prompts.SITUATION_REQUIRED_SCOPES["knowledge-probe"] === true
    && !prompts.SITUATION_REQUIRED_SCOPES["journal-insight"],
  "含 R20 契约与注册表", false);
check("v7 排除 scope 注明不适用（vocab/literature 均含 R20 不适用段）",
  prompts.CARD_VOCAB_PROMPT.includes("本卡型不适用") && prompts.CARD_LITERATURE_PROMPT.includes("本卡型不适用"),
  "含不适用段", false);
check("主制卡提示词已无 G9 退出红线（取消「一张也别产」）",
  !prompts.CARD_GEN_PROMPT.includes("退出红线") && !prompts.CARD_GEN_PROMPT.includes("一张也别产"),
  "无 G9", prompts.CARD_GEN_PROMPT.includes("退出红线"));
check("改为「值得记才做、可以少做但不做空」且保留下限",
  prompts.CARD_GEN_PROMPT.includes("不做空") && prompts.CARD_GEN_PROMPT.includes("至少 2 张"),
  "含不做空+下限", false);
check("R18 已取消数字硬性门槛（无 ≥2 计数、无 L15 引用）",
  !prompts.CARD_GEN_PROMPT.includes("≥2 个阿拉伯数字") && !prompts.CARD_GEN_PROMPT.includes("L15"),
  "无硬性门槛", false);
check("R5 合格线要求可字面判定措辞（与 L16 对齐）",
  prompts.CARD_GEN_PROMPT.includes("可字面判定") && prompts.CARD_GEN_PROMPT.includes("L16"),
  "含可字面判定+L16", false);
check("R19 归属措辞要求可字面识别（含归属动词+人名）",
  prompts.CARD_GEN_PROMPT.includes("可字面识别") && prompts.CARD_GEN_PROMPT.includes("归属动词"),
  "含可字面识别", false);
check("文学专用模板已存在且区别于序列模板",
  prompts.CARD_LITERATURE_PROMPT.includes("L1 续写卡为骨架") && prompts.CARD_LITERATURE_PROMPT !== prompts.CARD_SEQ_PROMPT,
  "含 L1 且 ≠seq", false);
// 死代码回归防护：db.js 播种 card-literature 必须引用专用文学模板（v31 修复）
const dbSrc = fs.readFileSync(path.join(__dirname, "..", "electron", "db.js"), "utf8");
check("db.js 导入 CARD_LITERATURE_PROMPT", /CARD_LITERATURE_PROMPT,/.test(dbSrc), "已导入", false);
check("db.js 播种 card-literature 使用专用文学模板（防死代码回归）",
  /seedScope\("card-literature"[^)]*CARD_LITERATURE_PROMPT/.test(dbSrc), "引用 CARD_LITERATURE_PROMPT", false);
check("db.js 不再用 CARD_SEQ_PROMPT 占位 card-literature",
  !/seedV5\("card-literature"[^)]*CARD_SEQ_PROMPT/.test(dbSrc) && !/'card-literature', '文学\/诗歌背诵 v1/.test(dbSrc),
  "无序列占位", false);

console.log("== M1-13 词汇路由（v32 M7：纯单词形 → card-vocab，不误伤概念短句） ==");
check("单个英文词 → card-vocab", cards.detectMaterialType("abandon").scope === "card-vocab", "card-vocab", cards.detectMaterialType("abandon").scope);
check("日语单词 → card-vocab", cards.detectMaterialType("見逃す").scope === "card-vocab", "card-vocab", cards.detectMaterialType("見逃す").scope);
check("概念短句仍走 concept（M1 回归保护）", cards.detectMaterialType("中位数是把一组数据排序后位于中间位置的数，它对极端值不敏感。").scope === "card-generation", "card-generation", true);
check("公式短句仍走 formula", cards.detectMaterialType("质能方程 E=mc^2 揭示了质量与能量的公式关系").scope === "card-formula", "card-formula", true);
check("映射表含词汇 → card-vocab/单词四卡", cards.MATERIAL_ROUTES.vocab.scope === "card-vocab" && cards.MATERIAL_ROUTES.vocab.defaultForm === "单词四卡", "card-vocab/单词四卡", cards.MATERIAL_ROUTES.vocab);

console.log(`\nM1 完成：${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
