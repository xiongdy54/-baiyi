// M1 制卡体系升级回归测试（v15）
// 覆盖：材料类型路由（M1.2）、CardLint L11 语义修正（M1.1b）、cloze 契约不回归（Non-Goal 验证）、
//       翻转问答卡（M1.1a）的字段流转约束
// 运行：node tests/m1.test.cjs（依赖 tests/m1.cards.bundle.cjs，由 esbuild 打包 src/lib/cards.ts 生成）
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
check("rects 为空同样触发 L11", occEmptyRects.some((i) => i.ruleId === "L11"), "L11", occEmptyRects);

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

console.log(`\nM1 完成：${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
