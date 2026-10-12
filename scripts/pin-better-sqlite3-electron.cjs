// D137（v48.92）：better-sqlite3 预编译二进制钉定为 Electron ABI（postinstall 钩子）。
// 背景：仓库常驻 electron-v125 二进制（设计稿 SQLITE3-MIGRATION-D137 §3.9）——node_modules 里
// 只能装一份 ABI，应用与 electron 通道测试（m8/m12/e2e/gui）都按 electron ABI 加载；
// 「node 直跑」套件统一走 ELECTRON_RUN_AS_NODE 通道（同一二进制），不再单独维护 node-ABI 二进制。
// 行为：better-sqlite3 自身的 install 脚本先装好 node-ABI 预编译；本脚本在其上用 prebuild-install
// 按 electron 运行时重新拉取，并用 ELECTRON_RUN_AS_NODE 通道做「能加载 + 能建库」的硬验证。
// 镜像：默认走 npmmirror 二进制镜像（本机实测可达）；已设 npm_config_better_sqlite3_binary_host_mirror
// 时尊重外部值。失败即非零退出——打包链（npmRebuild: true）与应用启动都依赖正确的 ABI，静默放过会炸在更远处。
const { execFileSync, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const repoRoot = path.resolve(__dirname, "..");
const bs3Dir = path.join(repoRoot, "node_modules", "better-sqlite3");
const electronVer = require(path.join(repoRoot, "node_modules", "electron", "package.json")).version;

function resolvePrebuildInstallBin() {
  // prebuild-install 是 better-sqlite3 的依赖：先找它的 node_modules，再找提升位
  const candidates = [
    path.join(bs3Dir, "node_modules", "prebuild-install", "bin.js"),
    path.join(repoRoot, "node_modules", "prebuild-install", "bin.js")
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error("prebuild-install 不存在（npm install 是否用了 --ignore-scripts / --omit=dev？）");
}

function verifyElectronAbi() {
  // ELECTRON_RUN_AS_NODE=1：electron 31 内嵌 Node 20.18（ABI 125）——加载成功即 ABI 匹配（设计稿探测②同法）
  const probe = "const D=require('better-sqlite3');const d=new D(':memory:');d.exec('CREATE TABLE t(x)');d.prepare('INSERT INTO t VALUES (?)').run(1);if(d.prepare('SELECT COUNT(*) AS n FROM t').get().n!==1)throw new Error('count!=1');console.log('PIN_OK abi='+process.versions.modules+' electron='+process.versions.electron||'');";
  const cli = path.join(repoRoot, "node_modules", "electron", "cli.js");
  const r = spawnSync(process.execPath, [cli, "-e", probe], {
    cwd: repoRoot,
    encoding: "utf-8",
    timeout: 120000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
  });
  if (r.status !== 0 || !String(r.stdout || "").includes("PIN_OK")) {
    throw new Error(
      `electron-ABI 验证失败（status=${r.status}）\nstdout: ${r.stdout}\nstderr: ${r.stderr}`
    );
  }
  process.stdout.write(String(r.stdout).trim() + "\n");
}

function main() {
  if (!fs.existsSync(path.join(bs3Dir, "package.json"))) {
    throw new Error("node_modules/better-sqlite3 不存在（先 npm install）");
  }
  const bin = resolvePrebuildInstallBin();
  const env = { ...process.env };
  // npmmirror 二进制镜像默认值：nodejs.org / GitHub 下载在部分网络不可达（设计稿探测③）
  env.npm_config_better_sqlite3_binary_host_mirror =
    env.npm_config_better_sqlite3_binary_host_mirror ||
    "https://registry.npmmirror.com/-/binary/better-sqlite3";
  process.stdout.write(`[pin-better-sqlite3] 拉取 electron@${electronVer} (ABI) 预编译……\n`);
  execFileSync(
    process.execPath,
    [bin, "--runtime", "electron", "--target", electronVer, "--verbose"],
    { cwd: bs3Dir, env, stdio: ["ignore", "pipe", "pipe"], timeout: 300000 }
  );
  verifyElectronAbi();
  process.stdout.write(`[pin-better-sqlite3] 已钉定 electron-ABI（electron ${electronVer}）\n`);
}

try {
  main();
} catch (e) {
  console.error("[pin-better-sqlite3] 失败：", e.message || e);
  console.error("[pin-better-sqlite3] 处理：确认网络可达 npmmirror，或手动执行");
  console.error(
    "  cd node_modules/better-sqlite3 && npx prebuild-install --runtime electron --target <electron 版本>"
  );
  process.exit(1);
}
