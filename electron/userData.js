// C-11（D-02）：发布身份——userData 目录解析。
// 打包版 = <appData>/Nutation，开发版 = <appData>/Nutation-dev；旧目录 incremental-reading-dev
// 首次启动整目录改名迁移，改名失败（文件被占用/跨盘/权限）继续用旧目录——绝不新建空目录造成
// 「数据消失」。纯函数化（appData/isPackaged/fs 可注入）以便测试覆盖 Windows 真实占用场景；
// 环境变量分支（M7_TEST_USERDATA / NUTATION_USER_DATA）留在 main.js 的 pinUserData 内。
const path = require("path");
const fs = require("fs");

function resolveUserData({ appData, isPackaged, existsSync = fs.existsSync, renameSync = fs.renameSync }) {
  const target = path.join(appData, isPackaged ? "Nutation" : "Nutation-dev");
  const legacy = path.join(appData, "incremental-reading-dev");
  if (!existsSync(target) && existsSync(legacy)) {
    try {
      renameSync(legacy, target);
      return { dir: target, migrated: true };
    } catch (e) {
      return { dir: legacy, migrated: false, error: e };
    }
  }
  return { dir: target, migrated: false };
}

module.exports = { resolveUserData };
