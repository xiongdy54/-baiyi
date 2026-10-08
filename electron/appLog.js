// 应用日志（v48.75 / D119，设计 docs/design/APP-LOGGING-D119.md）
//
// 零依赖手写（否决 electron-log：功能面只需追加写 + 轮转，几十行可覆盖）。
// 目录由调用方 init 注入（模块加载零副作用，纯 node 可测，不 require electron）；
// 主进程唯一写入点，渲染层只经 logs:rendererError IPC 转发（渲染层不持 IO）。
//
// 格式：行式人类可读——`本地时区时间戳(+偏移) [级别] [模块] 消息`，堆栈另起 4 空格缩进块；
// 轮转：单文件超 maxBytes（默认 2MB）按大小轮转，保留当前 + keepFiles 份历史（默认 4）。
//
// §7.2 豁免（已登记，D119）：日志是诊断文件、非用户数据、非调度事实源；appendFileSync
// 直写不走 persist() tmp+rename 原子替换——追加语义与整文件替换冲突，单行丢失不影响
// 诊断完整性；写失败一律 try/catch 静默（目录被删等故障只丢日志、永不抛出、不阻塞业务）。
//
// 隐私白名单（§7.5）：只记时间戳/级别/模块/错误消息与堆栈/版本与平台元信息；
// 不写文档正文、摘录内容、AI 对话原文、业务数据载荷、Key/Cookie。
const fs = require("fs");
const path = require("path");

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2MB
const DEFAULT_KEEP_FILES = 4; // 历史轮转文件份数（main.log.1–.4，总量上限约 10MB）
const MAX_MESSAGE_CHARS = 2000; // 渲染层转发载荷的消息截断
const MAX_STACK_CHARS = 4000; // 堆栈截断
const MAX_SOURCE_CHARS = 200; // 渲染层 source（URL）截断
const LOG_FILE_NAME = "main.log";

// state 常量在模块级（而非闭包）——未 init 时各写入口 no-op，绝不抛错
const state = {
  inited: false,
  dir: "",
  file: "",
  maxBytes: DEFAULT_MAX_BYTES,
  keepFiles: DEFAULT_KEEP_FILES
};

/** 本地时区时间戳 + 偏移：`2026-10-08 15:32:01.123+08:00`（用户与开发者直读） */
function timestamp() {
  const d = new Date();
  const p = (x, n = 2) => String(x).padStart(n, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}` +
    `${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`
  );
}

/** 消息单行化：换行替换为字面 `\n`（一行一事件，grep 友好） */
function oneLine(s) {
  return String(s).replace(/\r?\n/g, "\\n");
}

function clip(s, max) {
  const v = String(s ?? "");
  return v.length > max ? v.slice(0, max) + `…（截断，共 ${v.length} 字符）` : v;
}

/** meta 对象格式化为 `(k=v k2=v2)` 追加段；只取白名单内的原始类型值 */
function metaSuffix(meta) {
  if (!meta || typeof meta !== "object") return "";
  const parts = [];
  for (const [k, v] of Object.entries(meta)) {
    if (v === null || v === undefined) continue;
    parts.push(`${oneLine(clip(k, 60))}=${oneLine(clip(v, 200))}`);
  }
  return parts.length ? ` (${parts.join(" ")})` : "";
}

/**
 * 初始化：建目录并写启动横幅。可重复调用（后一次生效——测试隔离用）。
 * @param {{dir:string, version:string, platform:string, electronVersion?:string,
 *          nodeVersion?:string, packaged?:boolean, maxBytes?:number, keepFiles?:number}} opts
 */
function init(opts) {
  const o = opts || {};
  state.dir = String(o.dir || "");
  state.file = state.dir ? path.join(state.dir, LOG_FILE_NAME) : "";
  state.maxBytes = Number.isFinite(o.maxBytes) && o.maxBytes > 0 ? o.maxBytes : DEFAULT_MAX_BYTES;
  state.keepFiles = Number.isFinite(o.keepFiles) && o.keepFiles >= 0 ? Math.floor(o.keepFiles) : DEFAULT_KEEP_FILES;
  state.inited = !!state.file;
  if (!state.inited) return;
  writeBlock(
    `================ app start ================\n` +
      `version ${oneLine(clip(o.version ?? "?", 100))} · packaged ${o.packaged === true}\n` +
      `platform ${oneLine(clip(o.platform ?? "?", 100))}` +
      (o.electronVersion ? ` · electron ${oneLine(clip(o.electronVersion, 60))}` : "") +
      (o.nodeVersion ? ` · node ${oneLine(clip(o.nodeVersion, 60))}` : "") +
      `\n===========================================`
  );
}

/** 超阈值时轮转：.4 删、.3→.4 … main.log→.1；失败静默（继续写当前文件） */
function rotateIfNeeded() {
  try {
    let size;
    try {
      size = fs.statSync(state.file).size;
    } catch {
      return; // 文件不存在（首写）无需轮转
    }
    if (size < state.maxBytes) return;
    if (state.keepFiles < 1) {
      // v48.75 审查修订：0 份历史＝只留当前文件——超阈值直接清空重来，不产生 .1
      fs.rmSync(state.file, { force: true });
      return;
    }
    for (let i = state.keepFiles; i >= 1; i--) {
      const src = `${state.file}.${i}`;
      if (!fs.existsSync(src)) continue;
      if (i === state.keepFiles) fs.rmSync(src, { force: true });
      else fs.renameSync(src, `${state.file}.${i + 1}`);
    }
    fs.renameSync(state.file, `${state.file}.1`);
  } catch {
    /* 轮转失败静默：追加写继续，体积控制是优化非正确性前提 */
  }
}

/** 追加一段文本（可多行）。全部 try/catch 静默——日志故障永不外溢（D119 §5）。 */
function writeBlock(text) {
  if (!state.inited) return;
  try {
    rotateIfNeeded();
    try {
      fs.appendFileSync(state.file, text.endsWith("\n") ? text : text + "\n", "utf-8");
    } catch (err) {
      // 目录被外部删除等场景：重建一次目录再试（用户清目录后日志自愈）
      try {
        fs.mkdirSync(state.dir, { recursive: true });
        fs.appendFileSync(state.file, text.endsWith("\n") ? text : text + "\n", "utf-8");
      } catch {
        /* 仍然失败（盘满/权限）则放弃本条，绝不抛出 */
        void err;
      }
    }
  } catch {
    /* 双保险：任何路径都不抛 */
  }
}

/**
 * 写一条日志。level: "ERROR" | "WARN" | "INFO"；stack 可选（Error.stack，缩进块）。
 * message 任意类型字符串化后单行化。
 */
function log(level, moduleName, message, stack) {
  if (!state.inited) return;
  const line = `${timestamp()} [${level}] [${moduleName}] ${oneLine(clip(message, MAX_MESSAGE_CHARS))}`;
  const st = stack ? clip(String(stack), MAX_STACK_CHARS) : "";
  writeBlock(st ? `${line}\n${st.replace(/^/gm, "    ")}` : line);
}

/** Error（或任意值）便捷入口；meta 附加段只取原始类型值 */
function logError(moduleName, err, meta) {
  const e = err instanceof Error ? err : new Error(String(err));
  log("ERROR", moduleName, `${e.name}: ${e.message}${metaSuffix(meta)}`, e.stack);
}

/**
 * 渲染层转发载荷（logs:rendererError）——**字段白名单 + 截断**（D119 §6）：
 * 只取 kind / message / stack / source / line / col，其余字段一律丢弃（隐私边界）。
 * 载荷非法（非对象/缺字段）安全降级，绝不抛出（fire-and-forget 通道）。
 */
function logRendererError(payload) {
  if (!state.inited) return;
  const p = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const kind = p.kind === "console" || p.kind === "rejection" ? p.kind : "error";
  let where = "";
  if (typeof p.source === "string" && p.source) {
    where = ` @ ${clip(p.source, MAX_SOURCE_CHARS)}:${p.line ?? "?"}:${p.col ?? "?"}`;
  }
  const message = clip(p.message ?? "(no message)", MAX_MESSAGE_CHARS);
  log("ERROR", "renderer", `${kind}${where}: ${message}`, typeof p.stack === "string" ? p.stack : undefined);
}

/** 日志目录（供 logs:openFolder；测试断言用） */
function getLogDir() {
  return state.dir;
}

/** 确保目录存在（openFolder 前置——零日志状态也能打开） */
function ensureDir() {
  if (!state.inited) return false;
  try {
    fs.mkdirSync(state.dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

module.exports = { init, log, logError, logRendererError, getLogDir, ensureDir, LOG_FILE_NAME };
