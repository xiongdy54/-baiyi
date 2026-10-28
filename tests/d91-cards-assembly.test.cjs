// @runtime: electron-node
// v49.76（D247）「简明解读」v4 请求装配回归：cards.ts ste 分支必须
// ①全量替换 {{OUTPUT_LANG_NAME}}（模板中出现多次，replace 只换首处会漏占位符）；
// ②按界面语言注入分析/输出 pack（zh-CN→zh-Hans / zh-TW→zh-Hant / en→en / ja→ja）；
// ③用户消息携带正确【解读语言】；④温度保持 0.3。
// 运行：node scripts/run-tests.mjs d91-cards-assembly（Electron 运行时，等价于 electron tests/d91-cards-assembly.test.cjs）
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const P = require(path.join(ROOT, "electron", "prompts.js"));

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}

/** 以指定界面语言重新装载 cards bundle（bundle 内 i18n 的 currentLocale 是模块级状态） */
function loadCards(locale) {
  delete require.cache[require.resolve(path.join(ROOT, "tests", "m1.cards.bundle.cjs"))];
  const state = { messages: null, temperature: null, handler: null };
  global.window = {
    localStorage: { getItem: (k) => (k === "ir.locale" ? locale : null), setItem: () => {} },
    promptsAPI: { get: async (scope) => (scope === "reader-explain-ste" ? { content: P.READER_EXPLAIN_STE_PROMPT } : null) },
    aiAPI: {
      getConfig: async () => ({}),
      onStream: (fn) => { state.handler = fn; return () => {}; },
      chat: (requestId, messages, temperature) => {
        state.messages = messages;
        state.temperature = temperature;
        setTimeout(() => state.handler && state.handler(requestId, { done: true }), 0);
      },
      abortChat: () => {}
    }
  };
  return { cards: require(path.join(ROOT, "tests", "m1.cards.bundle.cjs")), state };
}

async function runCase(name, locale, matLang, expectedOutLang, outLangLabel, packName) {
  const { cards, state } = loadCards(locale);
  await cards.cardGenerator.explain("测试材料。", "", "", () => {}, () => {}, { mode: "ste", matLang });
  const sys = state.messages?.[0]?.content || "";
  const user = state.messages?.[1]?.content || "";
  console.log(`== ${name} ==`);
  check("system 为 v4 模板（逐句解释）", sys.includes("用 ASD-STE100 式的受控简明语言"), true, sys.slice(0, 40));
  check("{{OUTPUT_LANG_NAME}} 已全量替换（无残留占位符）", !sys.includes("{{OUTPUT_LANG_NAME}}"), false, sys.includes("{{OUTPUT_LANG_NAME}}"));
  check(`输出语言人读名为「${outLangLabel}」`, sys.includes(`「${outLangLabel}」`), outLangLabel, (sys.match(/一律使用「([^」]+)」/) || [])[1]);
  check(`分析/输出 pack 命中 ${packName}`, sys.includes(packName), packName, (sys.match(/【([^（]+)（[a-zA-Z-]+）】/) || [])[1]);
  check("{{ANALYSIS_PROFILE}} / {{OUTPUT_PROFILE}} 均已替换", !sys.includes("{{ANALYSIS_PROFILE}}") && !sys.includes("{{OUTPUT_PROFILE}}"), false, sys.includes("{{ANALYSIS_PROFILE}}") || sys.includes("{{OUTPUT_PROFILE}}"));
  check(`用户消息【解读语言】= ${expectedOutLang}`, user.includes(`【解读语言】${expectedOutLang}`), `【解读语言】${expectedOutLang}`, (user.match(/【解读语言】[^\n]*/) || [])[0]);
  check("温度 0.3", state.temperature === 0.3, 0.3, state.temperature);
}

(async () => {
  try {
    await runCase("简体中文（默认）", null, "zh-Hans", "zh-Hans", "中文", "简明中文剖面");
    await runCase("繁體中文", "zh-TW", "zh-Hant", "zh-Hant", "繁體中文", "簡明中文剖面");
    await runCase("English", "en", "en", "en", "English", "Plain English Profile");
    await runCase("日本語", "ja", "ja", "ja", "日本語", "やさしい日本語プロファイル");
  } catch (err) {
    fail++;
    console.log("  ✗ 测试执行异常: " + (err && err.stack || err));
  } finally {
    console.log(`\n${fail === 0 ? "ALL PASS" : "FAILED"}: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
