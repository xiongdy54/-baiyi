// @runtime: electron-node
// C-46：记忆文件必须原子写——写入中途进程被杀，只能留下"旧的完整内容"或"新的完整内容"
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const ROOT = path.resolve(__dirname, "..");

if (process.argv[2] === "--child") {
  const { writeTextAtomic } = require(path.join(ROOT, "electron", "jsonFile.js"));
  const [file, size] = [process.argv[3], Number(process.argv[4])];
  for (let i = 0; ; i++) {
    writeTextAtomic(file, (i % 2 ? "B" : "A").repeat(size));
    if (i === 0) process.stdout.write("ready\n");
  }
}

(async () => {
  const { writeTextAtomic } = require(path.join(ROOT, "electron", "jsonFile.js"));
  const store = require(path.join(ROOT, "electron", "memoryStore.js"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "c46-"));
  try {
    // ① 基本写入正确、无 tmp 残留
    const f = path.join(dir, "a.md");
    writeTextAtomic(f, "你好\n");
    assert.strictEqual(fs.readFileSync(f, "utf8"), "你好\n");
    assert.deepStrictEqual(fs.readdirSync(dir).filter((n) => n.includes(".tmp-")), []);

    // ② 随机时刻 SIGKILL 30 次：文件只能是完整的 A… 或 B…
    const SIZE = 200000;
    const target = path.join(dir, "torn.md");
    let torn = 0;
    for (let k = 0; k < 30; k++) {
      fs.writeFileSync(target, "A".repeat(SIZE));
      await new Promise((resolve) => {
        const c = spawn(process.execPath, [__filename, "--child", target, String(SIZE)], { stdio: ["ignore", "pipe", "inherit"] });
        c.stdout.once("data", () => setTimeout(() => c.kill("SIGKILL"), 5 + Math.random() * 40));
        c.on("exit", resolve);
      });
      const t = fs.readFileSync(target, "utf8");
      if (!(t.length === SIZE && /^(A+|B+)$/.test(t))) torn++;
    }
    assert.strictEqual(torn, 0, `撕裂 ${torn}/30`);

    // ③ ensureTree 清理崩溃残留的 tmp
    const mem = path.join(dir, "memory");
    store.ensureTree(mem);
    const stray = path.join(mem, "core.md.tmp-123-456");
    fs.writeFileSync(stray, "x");
    store.ensureTree(mem);
    assert.ok(!fs.existsSync(stray), "ensureTree 应清理 *.tmp-<pid>-<时间戳> 残留");

    // ④ 静态：memoryStore.js 不再直接覆盖写
    const src = fs.readFileSync(path.join(ROOT, "electron", "memoryStore.js"), "utf8");
    assert.ok(!/fs\.writeFileSync\(/.test(src), "memoryStore.js 仍有 fs.writeFileSync(");
    const jf = fs.readFileSync(path.join(ROOT, "electron", "jsonFile.js"), "utf8");
    assert.ok(!/fs\.writeSync\(/.test(jf), "jsonFile.js 不得使用 fs.writeSync(（磁盘将满时会静默短写）");
    console.log("memory-atomic: 4/4 通过");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
