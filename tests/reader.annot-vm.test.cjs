// 阅读器注解面板数据面（D67 §3）的纯函数测试。唯一命名的 esbuild 产物在 finally 里删除。
// Run: node tests/reader.annot-vm.test.cjs
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const outfile = path.join(__dirname, `.tmp-reader-annot-vm-${process.pid}.cjs`);
let pass = 0;
let fail = 0;

(async () => {
  try {
    await esbuild.build({
      entryPoints: [path.join(__dirname, "reader.annot-vm.entry.ts")],
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile,
      logLevel: "silent"
    });
    const { run } = require(outfile);
    const results = await run();
    for (const r of results) {
      if (r.pass) {
        pass++;
        console.log(`  ✓ ${r.name}`);
      } else {
        fail++;
        console.log(`  ✗ ${r.name} | ${r.detail || "条件不成立"}`);
      }
    }
    console.log(`\n==== reader.annot-vm: ${pass}/${pass + fail} ====\n`);
    process.exitCode = fail ? 1 : 0;
  } catch (err) {
    console.error(err?.stack || err);
    process.exitCode = 2;
  } finally {
    try { fs.rmSync(outfile, { force: true }); } catch { /* temporary bundle */ }
  }
})();
