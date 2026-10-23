// C-09：Electron 默认放行所有权限请求（摄像头/麦克风/通知/地理位置…）。
// 渲染层实际只需要剪贴板写入（NextStepsPanel / JournalView 的 navigator.clipboard.writeText）。
const ALLOWED_PERMISSIONS = new Set(["clipboard-sanitized-write"]);

function installPermissionHandlers(session, warn = console.warn) {
  session.setPermissionRequestHandler((_wc, permission, callback) => {
    const ok = ALLOWED_PERMISSIONS.has(permission);
    if (!ok) warn(`[perm] denied ${permission}`);
    callback(ok);
  });
  session.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
}

module.exports = { ALLOWED_PERMISSIONS, installPermissionHandlers };
