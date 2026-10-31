// @runtime: system-node
// 运行：node tests/overlay-focus.test.cjs（或 node scripts/run-tests.mjs overlay-focus）
// D256 纯逻辑回归：图片 contain 几何 + 外部关闭双命中状态机。
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    console.log(`  ✗ ${name} | ${e?.message || e}`);
  }
}
function near(actual, expected, eps = 0.01) {
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} != ${expected}`);
}

(async () => {
  const root = path.resolve(__dirname, "..");
  const fit = await import(pathToFileURL(path.join(root, "src", "lib", "imageFit.mjs")));
  const dismiss = await import(pathToFileURL(path.join(root, "src", "lib", "overlayDismissCore.mjs")));

  check("横图受可用宽度约束（2400×800 → 1000×333.33）", () => {
    const r = fit.fitImage(2400, 800, 1000, 800);
    near(r.width, 1000);
    near(r.height, 333.33);
    near(r.fitScale, 1000 / 2400);
  });

  check("竖图受可用高度约束（800×2400 → 266.67×800）", () => {
    const r = fit.fitImage(800, 2400, 1000, 800);
    near(r.width, 266.67);
    near(r.height, 800);
    near(r.fitScale, 800 / 2400);
  });

  check("小图按可用盒放大（120×80 → 1000×666.67）", () => {
    const r = fit.fitImage(120, 80, 1000, 800);
    near(r.width, 1000);
    near(r.height, 666.67);
    near(r.fitScale, 1000 / 120);
  });

  check("用户缩放叠加在 contain 比例上（1000×800 输入 1.5 → 1500×1200）", () => {
    const r = fit.fitImage(2400, 800, 1000, 800, 1.5);
    near(r.width, 1500);
    near(r.height, 500);
    near(r.fitScale, 1000 / 2400);
  });

  check("自然尺寸 / 可用尺寸 / zoom 非法时归零，不产生 Infinity 盒", () => {
    for (const args of [
      [0, 100, 100, 100],
      [100, 0, 100, 100],
      [100, 100, 0, 100],
      [100, 100, 100, 0],
      [NaN, 100, 100, 100],
      [100, 100, Infinity, 100],
      [100, 100, 100, 100, 0],
      [100, 100, 100, 100, -1]
    ]) {
      const r = fit.fitImage(...args);
      assert.equal(r.width, 0, JSON.stringify(args));
      assert.equal(r.height, 0, JSON.stringify(args));
      assert.equal(r.fitScale, 0, JSON.stringify(args));
    }
  });

  const ev = (target, currentTarget, extra = {}) => ({
    target,
    currentTarget,
    button: 0,
    isPrimary: true,
    pointerId: 1,
    ...extra
  });
  const blank = { name: "blank" };
  const panel = { name: "panel" };
  const closeAfter = (guard, down, up, downTop = true, upTop = true) => {
    guard.down(ev(down.target, blank, down.extra), downTop);
    return guard.up(ev(up.target, blank, up.extra), upTop);
  };

  check("外部按下 + 外部抬起 → 只关闭一次", () => {
    const guard = dismiss.createBackdropDismissGuard();
    assert.equal(closeAfter(guard, { target: blank }, { target: blank }), true);
    assert.equal(guard.up(ev(blank, blank), true), false);
  });

  check("内容按下 → 外部抬起不关闭", () => {
    const guard = dismiss.createBackdropDismissGuard();
    assert.equal(closeAfter(guard, { target: panel }, { target: blank }), false);
  });

  check("外部按下 → 内容抬起不关闭", () => {
    const guard = dismiss.createBackdropDismissGuard();
    assert.equal(closeAfter(guard, { target: blank }, { target: panel }), false);
  });

  check("不同 pointerId / 非主指针 / 非左键均不关闭", () => {
    for (const extra of [
      { pointerId: 2 },
      { isPrimary: false },
      { button: 2 }
    ]) {
      const guard = dismiss.createBackdropDismissGuard();
      assert.equal(closeAfter(guard, { target: blank, extra }, { target: blank }), false, JSON.stringify(extra));
    }
  });

  check("非 dialog 栈顶时按下或抬起都不关闭", () => {
    for (const [downTop, upTop] of [[false, true], [true, false]]) {
      const guard = dismiss.createBackdropDismissGuard();
      assert.equal(closeAfter(guard, { target: blank }, { target: blank }, downTop, upTop), false);
    }
  });

  check("pointercancel 清空本次命中，后续抬起不关闭", () => {
    const guard = dismiss.createBackdropDismissGuard();
    guard.down(ev(blank, blank), true);
    guard.cancel();
    assert.equal(guard.up(ev(blank, blank), true), false);
  });

  check("自定义空白判定可把图片舞台空白纳入、图片本体排除", () => {
    const stage = { name: "stage" };
    const image = { name: "image" };
    const isBlank = (target, currentTarget) => target === currentTarget || target === stage;
    const guard = dismiss.createBackdropDismissGuard(isBlank);
    guard.down(ev(stage, blank), true);
    assert.equal(guard.up(ev(stage, blank), true), true);

    const guard2 = dismiss.createBackdropDismissGuard(isBlank);
    guard2.down(ev(image, blank), true);
    assert.equal(guard2.up(ev(image, blank), true), false);

    const guard3 = dismiss.createBackdropDismissGuard(isBlank);
    guard3.down(ev(stage, blank), true);
    assert.equal(guard3.up(ev(image, blank), true), false);
  });

  console.log(`\nD256 overlay focus pure: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
