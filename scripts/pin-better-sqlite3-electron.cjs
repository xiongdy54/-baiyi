// D137（v48.92）：better-sqlite3 预编译二进制钉定为 Electron ABI（postinstall 钩子）。
// 背景：仓库常驻 electron 二进制（设计稿 SQLITE3-MIGRATION-D137 §3.9）——node_modules 里
// 只能装一份 ABI，应用与 electron 通道测试（m8/m12/e2e/gui）都按 electron ABI 加载；
// 「node 直跑」套件统一走 ELECTRON_RUN_AS_NODE 通道（同一二进制），不再单独维护 node-ABI 二进制。
// C-24（D207，v49.36）：Electron 31.7.7 → 45.0.0 后 better-sqlite3 升 v13（NAPI）——v13 起
// 预编译 NAPI 二进制直接内置在 npm tarball 内（prebuilds/ 目录，prebuildify 模式），
// 同一份二进制跨 Node / Electron 版本通用，per-ABI 拉取（prebuild-install）整体退役。
// 行为：v13+（存在 prebuilds/ 目录）＝零拉取，只做「能加载 + 能建库」的硬验证；
// v12 回退形态（prebuild-install 存在）保留原 per-ABI 拉取路径（npmmirror 镜像）。
// 失败即非零退出——应用启动依赖正确的二进制，静默放过会炸在更远处。
const { execFileSync, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const repoRoot = path.resolve(__dirname, "..");
const bs3Dir = path.join(repoRoot, "node_modules", "better-sqlite3");
const electronVer = require(path.join(repoRoot, "node_modules", "electron", "package.json")).version;
// v13+：npm tarball 内置 NAPI 预编译（prebuilds/）；v12：需 prebuild-install 按 ABI 拉取。
const napiBundled = fs.existsSync(path.join(bs3Dir, "prebuilds"));

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
  // ELECTRON_RUN_AS_NODE=1：electron 内嵌 Node（45 = 24.x；31 = 20.18 / ABI 125）——
  // v13 NAPI 二进制跨 ABI 通用，加载成功 + 建库即验证（D137 设计稿探测②同法）
  const probe = "const D=require('better-sqlite3');const d=new D(':memory:');d.exec('CREATE TABLE t(x)');d.prepare('INSERT INTO t VALUES (?)').run(1);if(d.prepare('SELECT COUNT(*) AS n FROM t').get().n!==1)throw new Error('count!=1');console.log('PIN_OK abi='+process.versions.modules+' electron='+process.versions.electron||'');";
  const cli = path.join(repoRoot, "node_modules", "electron", "cli.js");
  const r = spawnSync(process.execPath, [cli, "-e", probe], {
    cwd: repoRoot,
    encoding: "utf-8",
    timeout: 120000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
  });
  if (r.status !== 0 || !String(r.stdout || "").includes("PIN_OK")) {
    const stderr = String(r.stderr || "");
    // C-07：无头 Linux/CI 上最常见的失败是缺少 Electron 动态链接的系统库，原始报错只有一行 ld 错误
    const linuxLibsHint = /error while loading shared libraries/i.test(stderr)
      ? "\nLinux 缺少 Electron 运行所需系统库。安装方法：\n" +
        "  Debian/Ubuntu: sudo apt-get install -y libgtk-3-0 libnss3 libxss1 libgbm1 libasound2 xvfb   （Ubuntu 24.04 起 libasound2 改名 libasound2t64）\n" +
        "  Fedora/RHEL/Amazon Linux: sudo dnf install -y gtk3 nss libXScrnSaver mesa-libgbm alsa-lib xorg-x11-server-Xvfb"
      : "";
    throw new Error(
      `electron-ABI 验证失败（status=${r.status}）\nstdout: ${r.stdout}\nstderr: ${r.stderr}${linuxLibsHint}`
    );
  }
  process.stdout.write(String(r.stdout).trim() + "\n");
}

function main() {
  if (!fs.existsSync(path.join(bs3Dir, "package.json"))) {
    throw new Error("node_modules/better-sqlite3 不存在（先 npm install）");
  }
  if (napiBundled) {
    // C-24（D207）：v13+ NAPI 内置预编译——零下载、零镜像依赖，只需验证加载。
    process.stdout.write(
      `[pin-better-sqlite3] better-sqlite3 v13+ NAPI 内置预编译（prebuilds/ 就位），跳过 per-ABI 拉取\n`
    );
  } else {
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
  }
  if (process.env.NUTATION_SKIP_ABI_VERIFY === "1") {
    // C-07：只做构建、不启动 Electron 的 CI 步骤可用它跳过验证（此时无法加载 Electron 二进制）
    process.stdout.write(
      "[pin-better-sqlite3] 警告：NUTATION_SKIP_ABI_VERIFY=1，已跳过 electron-ABI 验证（仅适用于不运行 Electron 的构建环境）\n"
    );
  } else {
    verifyElectronAbi();
  }
  process.stdout.write(
    napiBundled
      ? `[pin-better-sqlite3] NAPI 预编译验证通过（electron ${electronVer}）\n`
      : `[pin-better-sqlite3] 已钉定 electron-ABI（electron ${electronVer}）\n`
  );
}

try {
  main();
} catch (e) {
  console.error("[pin-better-sqlite3] 失败：", e.message || e);
  if (!napiBundled) {
    console.error("[pin-better-sqlite3] 处理：确认网络可达 npmmirror，或手动执行");
    console.error(
      "  cd node_modules/better-sqlite3 && npx prebuild-install --runtime electron --target <electron 版本>"
    );
  } else {
    console.error("[pin-better-sqlite3] 处理：v13+ NAPI 内置预编译无需拉取——检查 node_modules/better-sqlite3/prebuilds/ 是否就位（重装：npm i better-sqlite3 --ignore-scripts）");
  }
  console.error(
    "[pin-better-sqlite3] 只做构建、不运行 Electron 的环境可设置 NUTATION_SKIP_ABI_VERIFY=1 跳过验证"
  );
  process.exit(1);
}
