// M4 快捷键回归测试（CommandRegistry 纯逻辑层，§9.1 M4 / §4.2-2）
// 覆盖：默认键位表=用户锁定表 / eventToCombo 规范化 / 分发命中与 when 门卫 /
//       抑制与 repeat / 覆盖项持久化（settings.app.keybindings）与重启重载 / 冲突检测 / 恢复默认
// 运行：node tests/m4.test.cjs（依赖 tests/m4.commands.bundle.cjs，由 esbuild 打包 src/lib/commands.ts 生成）
// 重新打包：node_modules/.bin/esbuild src/lib/commands.ts --bundle --platform=node --format=cjs --outfile=tests/m4.commands.bundle.cjs
const path = require("path");
const BUNDLE = path.join(__dirname, "m4.commands.bundle.cjs");

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}

// 伪 settingsAPI：settings.app.* 落内存 map，模拟 settings.json 持久化（须在 require 前挂上）
const store = new Map();
global.window = {
  settingsAPI: {
    get: async (scope, key) => store.get(`${scope}.${key}`),
    set: async (scope, key, v) => { store.set(`${scope}.${key}`, v); return true; }
  }
};

// 删除缓存重新 require → 全新模块状态（覆盖项缓存清零，模拟应用重启）
function fresh() {
  delete require.cache[require.resolve(BUNDLE)];
  return require(BUNDLE);
}

(async () => {
  console.log("== M4-1 默认键位表 = 用户锁定表（AI_DEVELOPMENT_GUIDE.md §9.1 M4；阅读五键 v49.36/D207 改 Alt 系，v22 增补撤销评分） ==");
  {
    const cmds = fresh().commandRegistry.COMMANDS;
    const LOCKED = [
      ["reader.makeCard", "阅读", "Alt+Z"],
      ["reader.aiCards", "阅读", "Alt+C"],
      ["reader.aiExplain", "阅读", "Alt+E"],
      ["reader.extract", "阅读", "Alt+X"],
      ["reader.lookupWord", "阅读", "Alt+D"],
      ["reader.turnPrev", "阅读", "ArrowLeft"],
      ["reader.turnNext", "阅读", "ArrowRight"],
      ["review.showAnswer", "复习", "Space"],
      ["review.again", "复习", "1"],
      ["review.hard", "复习", "2"],
      ["review.good", "复习", "3"],
      ["review.easy", "复习", "4"],
      ["review.undo", "复习", "Z"],
      ["review.markSuspend", "复习", "Q"],
      ["review.skip", "复习", "W"],
      ["review.delete", "复习", "D"],
      ["review.disambiguate", "复习", "E"]
    ];
    check("共 17 条命令", cmds.length === LOCKED.length, LOCKED.length, cmds.length);
    for (const [id, scene, key] of LOCKED) {
      const def = cmds.find((c) => c.id === id);
      check(`${id} = ${key}（${scene}）`, !!def && def.scene === scene && def.defaultKey === key, `${scene}/${key}`, def);
    }
  }

  console.log("== M4-2 eventToCombo 规范化（存储=展示同串） ==");
  {
    const { commandRegistry } = fresh();
    const toCombo = (key, mods = {}) =>
      commandRegistry.eventToCombo({ key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });
    check("Ctrl+z → Ctrl+Z", toCombo("z", { ctrlKey: true }) === "Ctrl+Z", "Ctrl+Z", toCombo("z", { ctrlKey: true }));
    check("Ctrl+Shift+Z → Ctrl+Shift+Z", toCombo("Z", { ctrlKey: true, shiftKey: true }) === "Ctrl+Shift+Z", "Ctrl+Shift+Z", toCombo("Z", { ctrlKey: true, shiftKey: true }));
    check("空格 → Space", toCombo(" ") === "Space", "Space", toCombo(" "));
    check("数字 1 → 1", toCombo("1") === "1", "1", toCombo("1"));
    check("字母 q → Q", toCombo("q") === "Q", "Q", toCombo("q"));
    check("纯修饰键 Control → null（不构成键位）", toCombo("Control") === null, null, toCombo("Control"));
    check("命名键 ArrowUp 原样", toCombo("ArrowUp") === "ArrowUp", "ArrowUp", toCombo("ArrowUp"));
  }

  console.log("== M4-3 分发命中与 when 门卫 ==");
  {
    const { commandRegistry, __testHooks } = fresh();
    const ran = [];
    commandRegistry.setActionSource("review", () => ({
      "review.showAnswer": { when: () => true, run: () => ran.push("showAnswer") },
      "review.good": { when: () => false, run: () => ran.push("good") }
    }));
    check("空格命中 showAnswer", __testHooks.dispatchKey({ key: " " }) === true && ran.join() === "showAnswer", "showAnswer", ran.join(","));
    check("when 拒绝时不命中且不执行（数字 3）", __testHooks.dispatchKey({ key: "3" }) === false && ran.join() === "showAnswer", "showAnswer", ran.join(","));
    commandRegistry.setActionSource("review", null);
    check("动作源注销后不再命中", __testHooks.dispatchKey({ key: " " }) === false, false, "true");
  }

  console.log("== M4-4 抑制与 repeat（长按不连发） ==");
  {
    const { commandRegistry, __testHooks } = fresh();
    const ran = [];
    commandRegistry.setActionSource("review", () => ({ "review.showAnswer": { run: () => ran.push("showAnswer") } }));
    commandRegistry.pushSuppress("kb-capture");
    check("抑制期间不分发", __testHooks.dispatchKey({ key: " " }) === false && ran.length === 0, 0, ran.length);
    commandRegistry.popSuppress("kb-capture");
    check("解除抑制后恢复分发", __testHooks.dispatchKey({ key: " " }) === true && ran.length === 1, 1, ran.length);
    check("repeat 事件不分发", __testHooks.dispatchKey({ key: " ", repeat: true }) === false && ran.length === 1, 1, ran.length);
    commandRegistry.setActionSource("review", null);
  }

  console.log("== M4-5 覆盖项持久化（settings.app.keybindings）与重启重载 ==");
  {
    const { commandRegistry, __testHooks } = fresh();
    await commandRegistry.init();
    check("初始为默认键位（Again=1）", commandRegistry.getAllBindings()["review.again"] === "1", "1", commandRegistry.getAllBindings()["review.again"]);
    await commandRegistry.setOverride("review.again", "5");
    check("覆盖后生效键 = 5", commandRegistry.getAllBindings()["review.again"] === "5", "5", commandRegistry.getAllBindings()["review.again"]);
    const persisted = store.get("app.keybindings") || {};
    check("覆盖项已落 settings 存储", persisted["review.again"] === "5", "5", persisted);

    // 覆盖键位参与分发：注册 Again 动作后按 "5" 命中
    const ran = [];
    commandRegistry.setActionSource("review", () => ({ "review.again": { run: () => ran.push("again") } }));
    check("覆盖分发同步生效（按 5 → Again 动作）", __testHooks.dispatchKey({ key: "5" }) === true && ran.join() === "again", "again", ran.join(","));
    check("原默认键 1 不再命中 Again", __testHooks.dispatchKey({ key: "1" }) === false, false, "true");
    commandRegistry.setActionSource("review", null);

    // 模拟应用重启：重新 require + init 从伪 settingsAPI 重读
    const reborn = fresh();
    await reborn.commandRegistry.init();
    check("重启后覆盖键位保持", reborn.commandRegistry.getAllBindings()["review.again"] === "5", "5", reborn.commandRegistry.getAllBindings()["review.again"]);
    check("重启后未覆盖的默认键位不受影响", reborn.commandRegistry.getAllBindings()["review.good"] === "3", "3", reborn.commandRegistry.getAllBindings()["review.good"]);

    // 恢复单条默认
    await reborn.commandRegistry.setOverride("review.again", null);
    check("恢复单条默认键位（Again=1）", reborn.commandRegistry.getAllBindings()["review.again"] === "1", "1", reborn.commandRegistry.getAllBindings()["review.again"]);
    check("清除后存储不含该覆盖", !((store.get("app.keybindings") || {})["review.again"]), "无 review.again 覆盖", store.get("app.keybindings"));
  }

  console.log("== M4-6 冲突检测（excludeId 排除自身） ==");
  {
    const { commandRegistry } = fresh();
    await commandRegistry.init();
    await commandRegistry.setOverride("review.again", "5");
    const hit = commandRegistry.conflictWith("5", "review.hard");
    check("把 Hard 改成 Again 的 5 → 冲突命中 review.again", !!hit && hit.id === "review.again", "review.again", hit);
    check("排除自身（Again 自己改 5）不冲突", commandRegistry.conflictWith("5", "review.again") === null, null, commandRegistry.conflictWith("5", "review.again"));
    check("默认键位互不冲突（1 排除 again 自身）", commandRegistry.conflictWith("1", "review.again") === null, null, commandRegistry.conflictWith("1", "review.again"));
    await commandRegistry.resetAll();
    check("全部恢复默认后存储为空对象", JSON.stringify(store.get("app.keybindings") || {}) === "{}", "{}", store.get("app.keybindings"));
  }

  console.log(`\nM4 结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((err) => {
  console.error("测试执行异常：", err);
  process.exit(1);
});
