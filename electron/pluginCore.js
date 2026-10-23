// pluginCore.js — 插件/主题体系**纯函数内核**（v48.89 / D132，设计 docs/design/PLUGIN-SYSTEM-D132.md §4.1）
//
// 零 electron 依赖、零 fs 依赖（宿主 pluginHost.js 负责磁盘，本模块只吃文本/对象），node 直测。
// 承载全部安全面校验：清单 schema（§3.1）/ versions.json 兼容性声明（§3.2）/ 受限 YAML 子集
// `/* @settings */` 解析（§3.4、§5.4）/ CSS fail-closed 校验器（§6.2）/ 亮暗对比度机器审计（§6.6）/
// 设置值读侧归一 assembleVars（§4.5）/ 内置皮肤与主题插件双槽互斥矩阵 nextAppearanceState（§7.3）。
//
// 纪律：一切失败一律 fail-closed（拒载 + 可读原因，含行号/实际比值），不做猜测式解析；
// main.js（插件代码）**永不执行**（§9.1）——本模块不存在任何会运行插件代码的通路。
"use strict";

// ---------- 常量 ----------

const PLUGINS_DIRNAME = "plugins";
const MANIFEST_MAX_BYTES = 64 * 1024; // plugin.json ≤ 64KB（§3.1）
const CSS_MAX_BYTES = 512 * 1024; // styles.css ≤ 512KB（§6.2 规则 1）
const SETTINGS_MAX_ITEMS = 24; // @settings 可调项上限（§3.4）
const SETTINGS_LINE_MAX = 200; // YAML 子集单行上限（§3.4）
const TEXT_VALUE_MAX = 100; // text 型值上限（§3.4 类型表）

// 插件 id：2–32 字符，小写字母/数字/连字符，不得以连字符开头（结尾由显式检查补上，§3.1）
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;
// 设置项 id：1–32 字符（§3.4 键位表）
const SETTING_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const SETTING_TYPES = ["toggle", "range", "dropdown", "color", "text"];
const ITEM_KEYS = ["id", "name", "type", "default", "description", "min", "max", "step", "options"];

// 对比度审计对象（§6.6）：受审计 Token 与亮暗两档基线默认值（= theme.css `:root` / `body.theme-dark` 现值）。
// `--text-primary` 未声明时以 `--ink` 代（theme.css 中前者即 var(--ink)）。
const AUDITED_TOKENS = ["--paper", "--ink", "--text-primary", "--text-secondary", "--accent", "--accent-on"];
const MODE_DEFAULTS = {
  light: { "--paper": "#fafaf8", "--ink": "#0a0a0a", "--text-secondary": "#525252", "--accent": "#166a59", "--accent-on": "#ffffff" },
  dark: { "--paper": "#101010", "--ink": "#f5f5f2", "--text-secondary": "#b5b5b0", "--accent": "#3fa08a", "--accent-on": "#0a0a0a" }
};
// 档位选择器 → 亮暗档（§6.2 规则 4）：单选择器逐字相等才算档位块；组合选择器一律拒载。
const MODE_SELECTORS = {
  ":root": "light",
  "html": "light",
  "body": "light",
  "body.theme-light": "light",
  "body.theme-dark": "dark"
};

// ---------- 清单校验（§3.1）----------

/**
 * 校验 plugin.json 文本（调用方先读文本再传入——64KB 上限在本函数内机械执行，§12.1.1 矩阵可直测）。
 * 返回 {ok:true, manifest} 或 {ok:false, reason}。manifest 只含白名单字段（未知字段忽略，前向兼容）。
 */
function validateManifest(text, folderName) {
  if (typeof text !== "string") return { ok: false, reason: "plugin.json 不可读" };
  if (Buffer.byteLength(text, "utf-8") > MANIFEST_MAX_BYTES) {
    return { ok: false, reason: `plugin.json 超过 ${Math.round(MANIFEST_MAX_BYTES / 1024)}KB 上限` };
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: `plugin.json 不是合法 JSON：${err instanceof Error ? err.message : String(err)}` };
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, reason: "plugin.json 内容不是 JSON 对象" };
  }
  const fail = (reason) => ({ ok: false, reason });

  // id：必填 + charset + 与文件夹名逐字相等（防清单与目录漂移）
  const id = json.id;
  if (typeof id !== "string" || !id) return fail("缺少必填字段 id");
  if (!PLUGIN_ID_RE.test(id)) {
    return fail(`id「${id}」不合法（2–32 字符，小写字母/数字/连字符，且不得以连字符开头）`);
  }
  if (id.endsWith("-")) return fail(`id「${id}」不得以连字符结尾`);
  if (id !== folderName) return fail(`id（${id}）与所在文件夹名（${folderName}）不相等`);

  // name：必填，1–40 字符（trim 后）
  const name = typeof json.name === "string" ? json.name.trim() : "";
  if (!name || name.length > 40) return fail("缺少必填字段 name（1–40 字符）");

  // version：必填 semver（major.minor.patch 纯数字段）
  if (typeof json.version !== "string" || !SEMVER_RE.test(json.version)) {
    return fail("缺少必填字段 version（semver：major.minor.patch 纯数字段）");
  }

  // minAppVersion：可选，缺省 "0.0.0"
  let minAppVersion = "0.0.0";
  if (json.minAppVersion !== undefined) {
    if (typeof json.minAppVersion !== "string" || !SEMVER_RE.test(json.minAppVersion)) {
      return fail("minAppVersion 必须是 semver（major.minor.patch 纯数字段）");
    }
    minAppVersion = json.minAppVersion;
  }

  // author / description：可选字符串上限
  if (json.author !== undefined && (typeof json.author !== "string" || json.author.length > 60)) {
    return fail("author 必须是不超过 60 字符的字符串");
  }
  if (json.description !== undefined && (typeof json.description !== "string" || json.description.length > 200)) {
    return fail("description 必须是不超过 200 字符的字符串");
  }

  // type：取值域本期封闭为 "theme"（§2.2 第 2 条——其他类型给可读原因）
  if (typeof json.type !== "string" || !json.type) return fail("缺少必填字段 type");
  if (json.type !== "theme") return fail(`本期仅支持主题插件（type:theme），收到「${json.type}」`);

  // styles：type:theme 必填；缺省名即 "styles.css"；禁止 ".." 与绝对路径形态
  let styles = "styles.css";
  if (json.styles !== undefined) {
    const s = json.styles;
    if (typeof s !== "string" || !s) return fail("styles 必须是非空字符串");
    if (s.includes("..") || s.includes("\\") || /^[/\\]/.test(s) || /^[A-Za-z]:/.test(s)) {
      return fail(`styles 路径不合法（须为插件目录内相对路径，禁止 ".." 与绝对路径形态）：${s}`);
    }
    styles = s;
  }

  // main 字段为 §4.15 形态预留：宿主不读取、不校验、不执行（§9.1）——此处刻意不做任何检查。

  return {
    ok: true,
    manifest: {
      id,
      name,
      version: json.version,
      minAppVersion,
      author: typeof json.author === "string" ? json.author : "",
      description: typeof json.description === "string" ? json.description : "",
      type: "theme",
      styles
    }
  };
}

// ---------- semver 与 versions.json（§3.2）----------

/** 比较 a 与 b；任一非法（位数不齐/非数字段）返回 null（拒），否则 -1/0/1 */
function compareSemver(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return null;
  const pa = a.split(".");
  const pb = b.split(".");
  if (pa.length !== 3 || pb.length !== 3) return null;
  const na = pa.map((s) => (/^\d+$/.test(s) ? Number(s) : NaN));
  const nb = pb.map((s) => (/^\d+$/.test(s) ? Number(s) : NaN));
  if (na.some(Number.isNaN) || nb.some(Number.isNaN)) return null;
  for (let i = 0; i < 3; i++) {
    if (na[i] !== nb[i]) return na[i] < nb[i] ? -1 : 1;
  }
  return 0;
}

/**
 * 解析 versions.json 文本（§3.2 本期语义：兼容性声明校验面，不做真回落）。
 * 文件不存在/为空 → {exists:false}；存在但非法（非对象，或值非字符串——映射形状整体破坏）→ 按不存在处理；
 * 合法映射 → {exists:true, entries:[{app,plugin}]}（semver 非法的条目剔除——§12.1.2「键含合法与非法混排」
 * 指键位混排，值均为字符串的映射仍算存在，仅非法条目不参与提示）。
 */
function readVersionsRule(text) {
  if (typeof text !== "string" || !text.trim()) return { exists: false, entries: [] };
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { exists: false, entries: [] };
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return { exists: false, entries: [] };
  const entries = [];
  for (const [k, v] of Object.entries(json)) {
    if (typeof v !== "string") return { exists: false, entries: [] }; // 值非字符串 → 整个映射形状非法
    if (!SEMVER_RE.test(k) || !SEMVER_RE.test(v)) continue; // 键/值非 semver 的条目剔除（混排场景）
    entries.push({ app: k, plugin: v });
  }
  return { exists: true, entries };
}

/** versions.json 中 minAppVersion ≤ appVersion 的条目里最大的 pluginVersion（拒载提示用，§3.2 第 3 条） */
function latestCompatibleVersion(rule, appVersion) {
  if (!rule || !rule.exists) return null;
  let best = null;
  for (const e of rule.entries) {
    const cmp = compareSemver(e.app, appVersion);
    if (cmp === null || cmp > 0) continue;
    if (best === null || compareSemver(e.plugin, best) > 0) best = e.plugin;
  }
  return best;
}

// ---------- `/* @settings */` 受限 YAML 子集（§3.4、§5.4）----------

/**
 * 字符串/注释感知的布局扫描（P0-1/P1-1 加固）：逐字符状态机（普通 | 字符串 | 注释）。
 * 返回 { comments, strings, unterminated }：
 *  - comments：[{start,end,inner}] 全部真注释块——引号串内的 "/*" 不是注释（引号串不得干扰注释剥离判定）；
 *  - strings：[{start,end}] 引号串区间（含引号本身）；
 *  - unterminated：未闭合引号串的起始下标（-1 = 无）。字符串内裸换行按 CSS bad-string 语义视为未闭合。
 * 前提：调用方先用反斜杠拒载规则挡掉转义（validateAndAuditCss 首条规则），字符串内不存在 \" 转义引号，
 * 引号配对判定因此是封闭的；扫描器仍防御性跳过 \x，保证该前提被破坏时行为不劣化。
 */
function scanCssLayout(cssText) {
  const comments = [];
  const strings = [];
  let unterminated = -1;
  const n = cssText.length;
  let i = 0;
  while (i < n) {
    const ch = cssText[i];
    if (ch === "/" && cssText[i + 1] === "*") {
      const end = cssText.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      comments.push({ start: i, end: stop, inner: cssText.slice(i + 2, end < 0 ? n : end) });
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const c = cssText[j];
        if (c === "\\") {
          j += 2; // 转义（上游已 ban，防御性跳过——转义引号不闭合字符串）
          continue;
        }
        if (c === "\n") break; // 字符串内裸换行 = bad-string（未闭合）
        if (c === ch) {
          closed = true;
          break;
        }
        j++;
      }
      if (!closed) {
        unterminated = i;
        break;
      }
      strings.push({ start: i, end: j + 1 });
      i = j + 1;
      continue;
    }
    i++;
  }
  return { comments, strings, unterminated };
}

/** 提取 cssText 内全部 /* ... *\/ 注释块（字符串感知：引号串内的 "/*" 不算注释；CSS 注释不可嵌套） */
function findCommentBlocks(cssText) {
  return scanCssLayout(cssText).comments;
}

function lineAt(cssText, index) {
  let n = 1;
  for (let i = 0; i < index && i < cssText.length; i++) {
    if (cssText.charCodeAt(i) === 10) n++;
  }
  return n;
}

/** 标量解析：成对单/双引号剥除；true/false → 布尔；数值字面量 → number；其余为字符串 */
function parseScalar(raw, fail) {
  if (raw === undefined || raw === "") return "";
  if (raw.startsWith("|") || raw.startsWith(">")) fail("不支持多行标量（| 或 >）");
  if (raw.startsWith("[") || raw.startsWith("{")) fail("不支持流式集合（[a, b] / {k: v}）");
  if (raw.startsWith("&") || raw.startsWith("*")) fail("不支持锚点/引用");
  const q = raw[0];
  if (q === '"' || q === "'") {
    if (raw.length >= 2 && raw.endsWith(q)) return raw.slice(1, -1);
    fail("引号不配对");
  }
  if (raw.startsWith("#")) fail("以 # 开头的值按注释语义拒绝——颜色值请加引号（如 \"#f4ede1\"）");
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

/**
 * 解析 styles.css 中的 `/* @settings … *\/` 块 → schema 数组。
 * 无块 → {ok:true, schema:[]}（@settings 可选）；多于一个 → 校验失败（§3.3）；
 * 解析失败 → {ok:false, reason}（reason 含行号）。文法与缩进边界见 §3.4：
 * 顶层键缩进 0（name/description/settings）；settings 列表项 "- " 缩进 2；项内键缩进 4；
 * options 列表项 "- " 缩进 6；项内键缩进 8。其他缩进一律报错（受限子集，不做猜测式解析）。
 */
function parseSettingsBlock(cssText) {
  if (typeof cssText !== "string") return { ok: false, schema: [], reason: "styles.css 不可读" };
  const settingBlocks = findCommentBlocks(cssText).filter((b) => /^\s*@settings\b/.test(b.inner));
  if (settingBlocks.length === 0) return { ok: true, schema: [] };
  if (settingBlocks.length > 1) {
    const second = settingBlocks[1];
    return {
      ok: false,
      schema: [],
      reason: `styles.css 含 ${settingBlocks.length} 个 /* @settings */ 注释块（至多一个；第 2 个在第 ${lineAt(cssText, second.start)} 行）`
    };
  }
  const block = settingBlocks[0];
  const marker = /^\s*@settings/.exec(block.inner);
  const bodyOffset = block.start + 2 + marker[0].length; // 块体（@settings 标记之后）在 cssText 中的偏移
  const segments = block.inner.slice(marker[0].length).split("\n");

  const fail = (msg, offset) => {
    throw new Error(`${msg}（第 ${lineAt(cssText, offset)} 行）`);
  };

  const schema = [];
  const header = { name: null, description: null };
  let cur = null; // 当前 settings 列表项
  let curOptions = null; // 当前项的 options 列表（解析中）
  let seenSettings = false;
  let mode = "top"; // top | items | options

  try {
    let offset = bodyOffset;
    for (const rawLine of segments) {
      const lineOffset = offset;
      offset += rawLine.length + 1; // +1 = 换行符
      if (!rawLine.trim()) continue; // 空行跳过（§3.4）
      if (rawLine.includes("\t")) fail("缩进含 Tab（本子集只允许空格）", lineOffset);
      if (rawLine.length > SETTINGS_LINE_MAX) fail(`单行超过 ${SETTINGS_LINE_MAX} 字符上限`, lineOffset);
      const indent = rawLine.length - rawLine.replace(/^ +/, "").length;
      const content = rawLine.trim();
      if (content.startsWith("#")) fail("不支持注释（# 开头的行）", lineOffset);
      const isDash = content === "-" || content.startsWith("- ");
      const dashRest = content === "-" ? "" : content.slice(2).trim();

      if (isDash) {
        // 列表项：settings 项（缩进 2）/ options 项（缩进 6）；更深/更浅或未开列表 → 结构错误
        if (indent === 2) {
          if (mode === "top") fail("意外的列表项（settings: 尚未声明）", lineOffset);
          if (schema.length >= SETTINGS_MAX_ITEMS) fail(`可调项超过 ${SETTINGS_MAX_ITEMS} 个上限`, lineOffset);
          if (mode === "options") mode = "items"; // options 列表结束后直接跟下一项
          const kv = splitKeyValue(dashRest);
          if (!kv) fail("列表项首键格式错误（应为「- key: value」）", lineOffset);
          if (kv.key === "options") fail("options 不能作为列表项首键（应写在项内键层级）", lineOffset);
          if (ITEM_KEYS.indexOf(kv.key) < 0) fail(`可调项未知键「${kv.key}」`, lineOffset);
          cur = {};
          cur[kv.key] = parseScalar(kv.value, (m) => fail(m, lineOffset));
          curOptions = null;
          schema.push(cur);
          continue;
        }
        if (indent === 6) {
          if (mode !== "options" || !cur) fail("options 列表项出现在 options: 之外", lineOffset);
          const kv = splitKeyValue(dashRest);
          if (!kv || (kv.key !== "label" && kv.key !== "value")) fail("options 列表项首键应为 label 或 value", lineOffset);
          const opt = {};
          opt[kv.key] = parseScalar(kv.value, (m) => fail(m, lineOffset));
          curOptions.push(opt);
          continue;
        }
        fail("列表项缩进层级不符（settings 项 2 空格 / options 项 6 空格）", lineOffset);
      }

      // 键行
      const kv = splitKeyValue(content);
      if (!kv) fail("无法识别的行（应为 key: value）", lineOffset);
      if (indent === 0) {
        if (seenSettings) fail("settings 列表开始后出现意外的顶层键（缩进 0）", lineOffset);
        if (kv.key === "name" || kv.key === "description") {
          if (header[kv.key] !== null) fail(`顶层键「${kv.key}」重复`, lineOffset);
          header[kv.key] = parseScalar(kv.value, (m) => fail(m, lineOffset));
        } else if (kv.key === "settings") {
          if (kv.value) fail("settings: 后应为换行缩进的列表项", lineOffset);
          seenSettings = true;
          mode = "items";
        } else {
          fail(`未知顶层键「${kv.key}」（只允许 name / description / settings）`, lineOffset);
        }
        continue;
      }
      if (indent === 4 && (mode === "items" || mode === "options")) {
        if (!cur) fail("可调项键出现在列表项之外", lineOffset);
        mode = "items";
        if (Object.prototype.hasOwnProperty.call(cur, kv.key) && kv.key !== "options") {
          fail(`可调项键「${kv.key}」重复`, lineOffset);
        }
        if (kv.key === "options") {
          if (kv.value) fail("options: 后应为换行缩进的列表项", lineOffset);
          if (cur.options) fail("options 重复", lineOffset);
          curOptions = [];
          cur.options = curOptions;
          mode = "options";
        } else if (ITEM_KEYS.indexOf(kv.key) < 0) {
          fail(`可调项未知键「${kv.key}」`, lineOffset);
        } else {
          cur[kv.key] = parseScalar(kv.value, (m) => fail(m, lineOffset));
        }
        continue;
      }
      if (indent === 8 && mode === "options") {
        if (!curOptions || !curOptions.length) fail("options 项键出现在列表项之外", lineOffset);
        const opt = curOptions[curOptions.length - 1];
        if (Object.prototype.hasOwnProperty.call(opt, kv.key)) fail(`options 项键「${kv.key}」重复`, lineOffset);
        if (kv.key !== "label" && kv.key !== "value") fail(`options 项未知键「${kv.key}」`, lineOffset);
        opt[kv.key] = parseScalar(kv.value, (m) => fail(m, lineOffset));
        continue;
      }
      fail("缩进层级不符（顶层 0 / 项键 4 / options 项键 8）", lineOffset);
    }
  } catch (err) {
    return { ok: false, schema: [], reason: `@settings 解析失败：${err instanceof Error ? err.message : String(err)}` };
  }

  const vs = validateSettingsSchema(schema);
  if (!vs.ok) return { ok: false, schema: [], reason: vs.reason };
  return { ok: true, schema: vs.schema };
}

/** "key: value" 拆分（首个冒号；键 trim；值保留原样交 parseScalar）；无冒号或键名空 → null（调用方报行号） */
function splitKeyValue(content) {
  const ci = content.indexOf(":");
  if (ci < 0) return null;
  const key = content.slice(0, ci).trim();
  const value = content.slice(ci + 1).trim();
  if (!key) return null;
  return { key, value };
}

/** schema 逐项校验（§3.4 键位表与类型系统；fail-closed） */
function validateSettingsSchema(items) {
  const seenIds = new Set();
  const out = [];
  for (const it of items) {
    const fail = (reason) => ({ ok: false, reason });
    if (!it || typeof it !== "object") return fail("可调项格式错误");
    const id = it.id;
    if (typeof id !== "string" || !SETTING_ID_RE.test(id)) {
      return fail(`可调项 id「${String(id)}」不合法（1–32 字符，小写字母/数字/连字符，不得以连字符开头）`);
    }
    if (seenIds.has(id)) return fail(`可调项 id 重复：${id}`);
    seenIds.add(id);
    const name = typeof it.name === "string" ? it.name.trim() : "";
    if (!name || name.length > 40) return fail(`可调项 ${id} 缺少 name（1–40 字符）`);
    if (typeof it.type !== "string" || SETTING_TYPES.indexOf(it.type) < 0) {
      return fail(`可调项 ${id} 的 type「${String(it.type)}」不在 toggle/range/dropdown/color/text 之内`);
    }
    if (it.description !== undefined && (typeof it.description !== "string" || it.description.length > 200)) {
      return fail(`可调项 ${id} 的 description 必须是不超过 200 字符的字符串`);
    }
    const entry = { id, name, type: it.type, default: it.default };
    if (it.description !== undefined) entry.description = it.description;

    if (it.type === "toggle") {
      if (typeof it.default !== "boolean") return fail(`可调项 ${id}（toggle）的 default 必须是布尔`);
    } else if (it.type === "range") {
      const d = it.default;
      if (typeof d !== "number" || !Number.isFinite(d)) {
        return fail(`可调项 ${id}（range）的 default 必须是数值`);
      }
      const num = (v, label) => {
        if (v === undefined) return undefined;
        const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
        if (!Number.isFinite(n)) throw new Error(`可调项 ${id} 的 ${label} 必须是数值`);
        return n;
      };
      let min;
      let max;
      let step;
      try {
        min = num(it.min, "min");
        max = num(it.max, "max");
        step = num(it.step, "step");
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
      if (min !== undefined && max !== undefined && !(min < max)) {
        return fail(`可调项 ${id}（range）须 min < max（${min} !< ${max}）`);
      }
      if (step !== undefined && !(step > 0)) return fail(`可调项 ${id}（range）须 step > 0`);
      if (min !== undefined && max !== undefined && step !== undefined && !(step <= max - min)) {
        return fail(`可调项 ${id}（range）须 0 < step ≤ max-min`);
      }
      if (min !== undefined) entry.min = min;
      if (max !== undefined) entry.max = max;
      if (step !== undefined) entry.step = step;
    } else if (it.type === "dropdown") {
      const rawDefault = it.default;
      if (typeof rawDefault !== "string" && typeof rawDefault !== "number") {
        return fail(`可调项 ${id}（dropdown）的 default 必须是数值或数值串`);
      }
      const opts = it.options;
      if (!Array.isArray(opts) || opts.length < 2 || opts.length > 8) {
        return fail(`可调项 ${id}（dropdown）的 options 必须是 2–8 项的列表`);
      }
      const values = [];
      const normOptions = [];
      for (const o of opts) {
        if (!o || typeof o !== "object") return fail(`可调项 ${id}（dropdown）options 项格式错误`);
        const label = typeof o.label === "string" ? o.label : "";
        const value = typeof o.value === "string" ? o.value : "";
        if (!label || label.length > 24) return fail(`可调项 ${id}（dropdown）options 的 label 须为 1–24 字符`);
        if (!value || value.length > 24) return fail(`可调项 ${id}（dropdown）options 的 value 须为 1–24 字符`);
        if (values.indexOf(value) >= 0) return fail(`可调项 ${id}（dropdown）options 的 value 重复：${value}`);
        values.push(value);
        normOptions.push({ label, value });
      }
      const defStr = String(rawDefault);
      if (values.indexOf(defStr) < 0) {
        return fail(`可调项 ${id}（dropdown）的 default（${defStr}）不在 options 取值内`);
      }
      entry.default = defStr;
      entry.options = normOptions;
    } else if (it.type === "color") {
      if (typeof it.default !== "string" || !HEX_RE.test(it.default)) {
        return fail(`可调项 ${id}（color）的 default 必须是 #rgb / #rrggbb 字面 hex（加引号）`);
      }
    } else if (it.type === "text") {
      if (typeof it.default !== "string") return fail(`可调项 ${id}（text）的 default 必须是字符串`);
    }
    out.push(entry);
  }
  return { ok: true, schema: out };
}

// ---------- CSS 校验器（§6.2）+ 对比度审计（§6.6）----------

/** relLum / contrastRatio：WCAG 相对亮度公式（与 src/lib/accentVar.ts relLum 同式，port 进内核） */
function relLum(hex) {
  const m = HEX_RE.exec(hex.trim());
  if (!m) return null;
  const h = hex.trim();
  const n = h.length === 4 ? 1 : 2;
  const chan = (i) => parseInt(h.slice(1 + i * n, 1 + (i + 1) * n), 16) / (n === 1 ? 15 : 255);
  const toLin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * toLin(chan(0)) + 0.7152 * toLin(chan(1)) + 0.0722 * toLin(chan(2));
}

function contrastRatio(a, b) {
  const la = relLum(a);
  const lb = relLum(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * 对比度审计（§6.6）：tokens = {light: {token: hex 声明值}, dark: {...}}（仅被声明的档参与审计），
 * defaults = MODE_DEFAULTS。断言集：ink/text-secondary/accent 对 paper ≥4.5，accent-on 对 accent ≥4.5。
 * 返回 {ok, ratios:[{label,ratio}], failures, reason?}——失败 reason 逐对带实际比值。
 */
function auditContrast(tokens, defaults) {
  const defs = defaults || MODE_DEFAULTS;
  const failures = [];
  const ratios = [];
  for (const mode of ["light", "dark"]) {
    const declared = (tokens && tokens[mode]) || {};
    const touched = AUDITED_TOKENS.some((t) => declared[t] !== undefined);
    if (!touched) continue; // 只审计被触碰的档（未触碰档取基线，天然达标）
    const def = defs[mode];
    const inkEff = declared["--text-primary"] ?? declared["--ink"] ?? def["--ink"];
    const paperEff = declared["--paper"] ?? def["--paper"];
    const textSecondaryEff = declared["--text-secondary"] ?? def["--text-secondary"];
    const accentEff = declared["--accent"] ?? def["--accent"];
    const accentOnEff = declared["--accent-on"] ?? def["--accent-on"];
    const pairs = [
      ["ink 对 paper", inkEff, paperEff],
      ["text-secondary 对 paper", textSecondaryEff, paperEff],
      ["accent 对 paper", accentEff, paperEff],
      ["accent-on 对 accent", accentOnEff, accentEff]
    ];
    for (const [label, a, b] of pairs) {
      const r = contrastRatio(a, b);
      if (r === null) {
        failures.push(`${mode === "light" ? "浅" : "深"}档 ${label}：色值无法解析（${a} / ${b}）`);
        continue;
      }
      ratios.push({ mode, label, ratio: r });
      if (r < 4.5) {
        failures.push(
          `${mode === "light" ? "浅" : "深"}档 ${label}：${a} 对 ${b} = ${r.toFixed(2)}:1 < 4.5:1`
        );
      }
    }
  }
  if (failures.length) {
    return { ok: false, ratios, failures, reason: `对比度审计未通过（要求亮暗两档 ≥4.5:1）：${failures.join("；")}` };
  }
  return { ok: true, ratios, failures: [] };
}

/**
 * 解析档位块内受审计 Token 的声明（§6.2 规则 5 的值形态校验也在这里做）。
 * 返回 {ok, reason?, modes: {light: {token: hex}, dark: {token: hex}}}。
 * hex = 字面 hex 或 var(--pl-<本插件id>-<设置id>, #hex) 的回退 hex（审计的是默认值）。
 * P1-1：引号串感知——串内 { } ; 不得干扰块边界与声明切分（上游已拒未闭合串，此处必然闭合）。
 */
function extractAuditedDeclarations(scanStruct, pluginId, failWithLine) {
  const modes = { light: {}, dark: {} };
  const prefix = `var(--pl-${pluginId}-`;
  let depth = 0;
  let selStart = -1;
  let blockStart = -1;
  let selector = "";
  for (let i = 0; i < scanStruct.length; i++) {
    const ch = scanStruct[i];
    if (ch === '"' || ch === "'") {
      const close = scanStruct.indexOf(ch, i + 1);
      i = close < 0 ? scanStruct.length : close; // 跳过整个引号串
      continue;
    }
    if (ch === "{") {
      if (depth === 0) {
        selector = scanStruct.slice(selStart < 0 ? 0 : selStart, i).trim();
        blockStart = i + 1;
      }
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && blockStart >= 0) {
        const body = scanStruct.slice(blockStart, i);
        const offset = blockStart;
        blockStart = -1;
        selStart = i + 1;
        // 组合选择器：档位块禁用（档位归属无法静态判定）；纯组件组合不受限不受审计
        if (selector.includes(",")) {
          const parts = selector.split(",").map((s) => s.trim());
          if (parts.some((p) => Object.prototype.hasOwnProperty.call(MODE_SELECTORS, p))) {
            return { ok: false, reason: failWithLine(`组合选择器「${selector}」禁止（档位归属无法静态判定）`, offset) };
          }
        } else {
          const mode = MODE_SELECTORS[selector];
          if (mode) {
            const declared = modes[mode];
            let hasAccent = false;
            let hasAccentOn = false;
            let segStart = 0;
            for (const decl of body.split(";")) {
              const ci = decl.indexOf(":");
              segStart += decl.length + 1;
              if (ci < 0) continue;
              const prop = decl.slice(0, ci).trim();
              if (AUDITED_TOKENS.indexOf(prop) < 0) continue;
              const value = decl.slice(ci + 1).trim();
              const declOffset = offset + segStart - decl.length - 1 + decl.indexOf(prop);
              let hex = null;
              if (HEX_RE.test(value)) {
                hex = value;
              } else if (value.startsWith(prefix)) {
                // var(--pl-<本插件id>-<设置id>, #hex)——回退必须字面 hex（审计默认值）
                const inner = value.slice(prefix.length, value.lastIndexOf(")"));
                const comma = inner.indexOf(",");
                const key = comma >= 0 ? inner.slice(0, comma).trim() : "";
                const fb = comma >= 0 ? inner.slice(comma + 1).trim() : "";
                if (!SETTING_ID_RE.test(key) || !HEX_RE.test(fb)) {
                  return {
                    ok: false,
                    reason: failWithLine(
                      `受审计 Token ${prop} 的 var() 形态须为 ${prefix}<设置id>, #hex)（回退必须字面 hex），收到「${value.slice(0, 80)}」`,
                      declOffset
                    )
                  };
                }
                hex = fb;
              } else if (value.startsWith("var(--pl-")) {
                return {
                  ok: false,
                  reason: failWithLine(
                    `受审计 Token ${prop} 引用了外部插件前缀的设置变量（只允许本插件 ${prefix}…），收到「${value.slice(0, 80)}」`,
                    declOffset
                  )
                };
              } else {
                return {
                  ok: false,
                  reason: failWithLine(
                    `受审计 Token ${prop} 的值必须是字面 hex 或 var(${prefix}<设置id>, #hex)（引用其他 var / color-mix / 命名色均拒载），收到「${value.slice(0, 80)}」`,
                    declOffset
                  )
                };
              }
              declared[prop] = hex;
              if (prop === "--accent") hasAccent = true;
              if (prop === "--accent-on") hasAccentOn = true;
            }
            // 配对规则（swiss 皮肤层第 5 条）：声明 --accent 的块必须同块声明 --accent-on
            if (hasAccent && !hasAccentOn) {
              return {
                ok: false,
                reason: failWithLine(
                  `档位块「${selector}」声明了 --accent 但未同块声明 --accent-on（瑞士风皮肤层第 5 条）`,
                  offset
                )
              };
            }
          }
        }
      }
    }
  }
  return { ok: true, modes };
}

/**
 * CSS fail-closed 校验器（§6.2 规则 1–5）+ 对比度审计（§6.6）。
 * 任一规则不过 → {ok:false, reason}（拒载，原因可读含行号/比值）；全过 → {ok:true, ratios}。
 * schema 参数为 parseSettingsBlock 的产物（本函数不重复解析 @settings，只做构造与形态校验）。
 */
function validateAndAuditCss(cssText, schema, pluginId) {
  void schema; // 形态校验只认 var(--pl-<id>-<key>, #hex) 文法本身；key 是否在 schema 内不影响安全（未注入即走回退）
  if (typeof cssText !== "string") return { ok: false, reason: "styles.css 不可读" };
  if (Buffer.byteLength(cssText, "utf-8") > CSS_MAX_BYTES) {
    return { ok: false, reason: `styles.css 超过 ${Math.round(CSS_MAX_BYTES / 1024)}KB 上限` };
  }
  if (typeof pluginId !== "string" || !PLUGIN_ID_RE.test(pluginId) || pluginId.endsWith("-")) {
    return { ok: false, reason: "插件 id 非法，无法校验 styles.css" };
  }

  const failWithLine = (msg, index) => `${msg}（styles.css 第 ${lineAt(cssText, index)} 行）`;

  // 规则 0（P0-1 加固）：反斜杠 fail-closed。一切 CSS 转义序列（\70 十六进制转义等）都以字面反斜杠开头，
  // 可把 @import / url( 伪装成普通标识符骗过禁忌扫描（如 @im\70 ort、u\72 l()）；复刻 CSS tokenizer 做
  // 转义解码的差分风险高，而受审计面（Token 覆盖层：字面 hex / var(--pl-…) / 固定档位选择器 / 受限
  // YAML 子集）没有任何需要反斜杠的合法构造——故含任意反斜杠（含注释内）一律拒载，最简且无解码面。
  const bs = cssText.indexOf("\\");
  if (bs >= 0) {
    return {
      ok: false,
      reason: failWithLine(
        "styles.css 含反斜杠「\\」（CSS 转义序列可伪装 @import/url() 等禁忌构造绕过校验，fail-closed 一律拒绝；主题 Token 覆盖层无正当用例）",
        bs
      )
    };
  }

  // 规则 0b（P1-1 加固）：引号必须成对（字符串内不允许裸换行，同 CSS bad-string 语义）。
  // 未闭合串会让其后文本的归属（字符串内容 vs 结构）无法静态判定，fail-closed 拒绝。
  const layout = scanCssLayout(cssText);
  if (layout.unterminated >= 0) {
    return {
      ok: false,
      reason: failWithLine("styles.css 存在未闭合的引号字符串（引号须成对，字符串内不允许裸换行）", layout.unterminated)
    };
  }

  // 剥注释：注释内容打码为空格（换行保留 → 行号与原文对齐）。
  // 禁忌扫描副本保留 @settings 块（§6.2 规则 2「@settings 块除外」）与引号串内容（url("data:…") 需配对引号）；
  // 结构解析副本全剥注释，并把引号串内部一并打码——串内 { } ; 不得干扰块边界与声明切分（P1-1）。
  const blankAll = (keepSettings, blankStrings) => {
    const ranges = [];
    for (const b of layout.comments) {
      if (!(keepSettings && /^\s*@settings\b/.test(b.inner))) ranges.push({ start: b.start, end: b.end });
    }
    if (blankStrings) {
      for (const s of layout.strings) ranges.push({ start: s.start + 1, end: s.end - 1 }); // 打码串内部，保留引号
    }
    if (!ranges.length) return cssText;
    ranges.sort((a, b2) => a.start - b2.start);
    let out = "";
    let last = 0;
    for (const r of ranges) {
      out += cssText.slice(last, r.start);
      out += cssText.slice(r.start, r.end).replace(/[^\n]/g, " ");
      last = r.end;
    }
    return out + cssText.slice(last);
  };

  const scanForbidden = blankAll(true, false);
  const scanStruct = blankAll(false, true);

  // 规则 3：禁忌构造（scanForbidden 副本上检测）
  let m;
  const importRe = /@import/gi;
  while ((m = importRe.exec(scanForbidden))) {
    return { ok: false, reason: failWithLine("styles.css 含 @import（零网络红线：任意大小写、含相对路径一律拒绝）", m.index) };
  }
  const jsRe = /javascript\s*:/gi;
  while ((m = jsRe.exec(scanForbidden))) {
    return { ok: false, reason: failWithLine("styles.css 含 javascript: URI（禁止）", m.index) };
  }
  const urlRe = /url\(\s*(['"]?)([\s\S]*?)\1\s*\)/gi;
  while ((m = urlRe.exec(scanForbidden))) {
    const v = m[2].trim();
    if (!/^data:image\//i.test(v)) {
      return {
        ok: false,
        reason: failWithLine(`url() 仅允许 data:image/ 开头的内嵌图，收到「${v.slice(0, 60) || "(空)"}」`, m.index)
      };
    }
  }

  // C-44：image-set() / -webkit-image-set() 接受"字符串形式的 URL"（不经 url()），可绕过上面的 url() 检查发起网络请求；
  // src() 是 CSS 新增的 URL 函数，同理。Token 覆盖层没有正当用例 → 一律拒绝（fail-closed）。
  const urlFnRe = /(?:-webkit-)?image-set\s*\(|(?<![\w-])src\s*\(/gi;
  while ((m = urlFnRe.exec(scanForbidden))) {
    return { ok: false, reason: failWithLine("styles.css 含 image-set()/src()（可用字符串 URL 联网，零网络红线一律拒绝）", m.index) };
  }

  // 规则 4/5 + §6.6：档位块选择器形态、受审计 Token 值形态、accent 配对、对比度数值审计
  const ext = extractAuditedDeclarations(scanStruct, pluginId, failWithLine);
  if (!ext.ok) return { ok: false, reason: ext.reason };
  const verdict = auditContrast(ext.modes, MODE_DEFAULTS);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  return { ok: true, ratios: verdict.ratios };
}

// ---------- 设置值读侧归一（§4.5 / §5.3）----------

/**
 * assembleVars(schema, values) → [{key: <settingId>, value: <归一后字符串>}]。
 * 缺省合并 default；range 钳制 min/max；dropdown 必须 ∈ options（否则回落 default）；
 * color 必须 hex；text 截 100 字符；脏类型（对象/数组/函数等）丢弃取 default。
 * 值注入 CSS 变量前恒经本函数——settings:set 写进来的脏值最多让控件显示异常，生效值封闭在归一后标量（§9.2 S8）。
 */
function assembleVars(schema, values) {
  const src = values && typeof values === "object" && !Array.isArray(values) ? values : {};
  const out = [];
  for (const s of Array.isArray(schema) ? schema : []) {
    if (!s || typeof s.id !== "string") continue;
    const raw = Object.prototype.hasOwnProperty.call(src, s.id) ? src[s.id] : undefined;
    const dirty = raw !== undefined && (typeof raw === "object" || typeof raw === "function");
    let value;
    switch (s.type) {
      case "toggle": {
        const v = typeof raw === "boolean" ? raw : s.default;
        value = v === true ? "true" : "false";
        break;
      }
      case "range": {
        let n =
          typeof raw === "number" && Number.isFinite(raw)
            ? raw
            : typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))
              ? Number(raw)
              : NaN;
        if (!Number.isFinite(n)) n = typeof s.default === "number" ? s.default : Number(s.default);
        if (!Number.isFinite(n)) n = 0;
        if (typeof s.min === "number" && Number.isFinite(s.min)) n = Math.max(s.min, n);
        if (typeof s.max === "number" && Number.isFinite(s.max)) n = Math.min(s.max, n);
        value = String(n);
        break;
      }
      case "dropdown": {
        const vals = Array.isArray(s.options) ? s.options.map((o) => o.value) : [];
        if (typeof raw === "string" && vals.indexOf(raw) >= 0) value = raw;
        else if (typeof raw === "number" && vals.indexOf(String(raw)) >= 0) value = String(raw);
        else value = typeof s.default === "string" ? s.default : String(s.default ?? "");
        break;
      }
      case "color": {
        value = !dirty && typeof raw === "string" && HEX_RE.test(raw) ? raw : String(s.default ?? "");
        break;
      }
      case "text": {
        value = !dirty && typeof raw === "string" ? raw.slice(0, TEXT_VALUE_MAX) : String(s.default ?? "");
        break;
      }
      default:
        continue; // 未知类型不注入（schema 校验已拒，此处兜底）
    }
    out.push({ key: s.id, value });
  }
  return out;
}

// ---------- 内置皮肤 × 主题插件 双槽互斥（§7.3）----------

/**
 * 外观双槽（app.skinId / app.activeThemePlugin）的一次动作迁移（纯函数，单测锁定互斥矩阵）。
 * action：{type:"activate-plugin", id} | {type:"deactivate-plugin"} | {type:"select-skin", id}。
 * 规则（§7.3）：激活主题插件 → skinId 归 "none"；选择非 none 内置皮肤 → 插件激活清空；
 * 选 "none" 皮肤仅归位皮肤槽（停用插件须走 deactivate-plugin，两区 UI 各有显式出口）。
 */
function nextAppearanceState(state, action) {
  const cur = {
    skinId: state && typeof state.skinId === "string" ? state.skinId : "none",
    activeThemePlugin: state && typeof state.activeThemePlugin === "string" ? state.activeThemePlugin : ""
  };
  if (!action || typeof action !== "object") return cur;
  if (action.type === "activate-plugin") {
    const id = typeof action.id === "string" ? action.id : cur.activeThemePlugin;
    return { skinId: "none", activeThemePlugin: id };
  }
  if (action.type === "deactivate-plugin") {
    return { ...cur, activeThemePlugin: "" };
  }
  if (action.type === "select-skin") {
    const id = typeof action.id === "string" ? action.id : "none";
    return id === "none" ? { ...cur, skinId: "none" } : { skinId: id, activeThemePlugin: "" };
  }
  return cur;
}

module.exports = {
  PLUGINS_DIRNAME,
  MANIFEST_MAX_BYTES,
  CSS_MAX_BYTES,
  SETTINGS_MAX_ITEMS,
  TEXT_VALUE_MAX,
  PLUGIN_ID_RE,
  SETTING_ID_RE,
  AUDITED_TOKENS,
  MODE_DEFAULTS,
  MODE_SELECTORS,
  validateManifest,
  compareSemver,
  readVersionsRule,
  latestCompatibleVersion,
  parseSettingsBlock,
  validateAndAuditCss,
  auditContrast,
  contrastRatio,
  relLum,
  assembleVars,
  nextAppearanceState
};
