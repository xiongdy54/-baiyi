// v49.8（D182）：主进程界面语言（electron/i18n.js）——与渲染层 src/lib/i18n.ts 同一自然键制。
// 覆盖面＝主进程直接呈现给用户的文字：托盘菜单/气泡（tray.js）、系统对话框标题与文件过滤器（main.js 等）。
// 语言真源＝settings.json 的 app.language（唯一真源），经 settings:set 写路径钩子同步（main.js），
// 渲染层不额外发 IPC（D182 ③：零新增 IPC）。
"use strict";

const { readJsonObject } = require("./jsonFile");

const LANGS = ["zh-CN", "zh-TW", "en", "ja"];
const DEFAULT_LANG = "zh-CN";

// ---------- 自然键词典（en / ja；zh-CN 恒等；zh-TW 见下方转换） ----------

const EN = {
  "打开主窗口": "Open main window",
  "制卡台": "Workbench",
  "退出": "Quit",
  "Nutation仍在运行": "Nutation is still running",
  "已收进系统托盘；点击托盘图标恢复，右键菜单可退出。":
    "Minimized to the system tray. Click the tray icon to restore; right-click for the menu to quit.",
  "EPUB 电子书": "EPUB e-books",
  "Word 文档": "Word documents",
  "文本文档": "Text documents",
  "Markdown 文档": "Markdown documents",
  "全部支持的阅读材料": "All supported reading materials",
  "电子书": "E-books",
  "文档": "Documents",
  "图片": "Images",
  "选择备份保存位置": "Choose where to save the backup",
  "选择备份文件": "Choose a backup file",
  "备份文件": "Backup files"
};

const JA = {
  "打开主窗口": "メインウィンドウを開く",
  "制卡台": "ワークベンチ",
  "退出": "終了",
  "Nutation仍在运行": "Nutationは動作中です",
  "已收进系统托盘；点击托盘图标恢复，右键菜单可退出。":
    "システムトレイに格納しました。アイコンをクリックで復元、右クリックメニューから終了できます。",
  "EPUB 电子书": "EPUB 電子書籍",
  "Word 文档": "Word 文書",
  "文本文档": "テキスト文書",
  "Markdown 文档": "Markdown 文書",
  "全部支持的阅读材料": "対応するすべての閲読素材",
  "电子书": "電子書籍",
  "文档": "文書",
  "图片": "画像",
  "选择备份保存位置": "バックアップの保存先を選択",
  "选择备份文件": "バックアップファイルを選択",
  "备份文件": "バックアップファイル"
};

// ---------- 状态 ----------

let currentLang = DEFAULT_LANG;
// settings.json 位置由 main.js 注入（app.getPath userData 初始化后）
let settingsFile = null;

/** zh-TW＝opencc-js（cn→twp）+ 覆盖表；转换器懒加载，失败静默回落原文 */
let twConvert = null;
let twFailed = false;
let openccPromise = null;
const twCache = new Map();
const TW_OVERRIDES = [
  ["材料导图", "材料心智圖"],
  ["导图", "心智圖"],
  ["制卡", "製卡"],
  ["批注", "註解"]
];

function ensureTwConvert() {
  if (twConvert || twFailed) return twConvert;
  if (!openccPromise) {
    openccPromise = import("opencc-js")
      .then((mod) => {
        const conv = (mod.default || mod).Converter({ from: "cn", to: "twp" });
        twConvert = conv;
        return conv;
      })
      .catch(() => {
        twFailed = true;
        return null;
      });
  }
  // 同步语境（托盘/对话框都是同步取词）——首帧 zh-TW 若转换器未就绪则回落原文，
  // 转换器就绪后（毫秒级）由 rebuildTray 触发的新一轮取词即为繁体
  return twConvert;
}

function toZhTw(s) {
  const cached = twCache.get(s);
  if (cached !== undefined) return cached;
  let out = s;
  for (const [k, v] of TW_OVERRIDES) {
    if (out.includes(k)) out = out.split(k).join(v);
  }
  const conv = ensureTwConvert();
  if (conv) {
    try {
      out = conv(out);
    } catch {
      /* 转换失败回落覆盖后文本 */
    }
  }
  twCache.set(s, out);
  return out;
}

/** 归一（与渲染层 normalizeLocale 同规；非法一律回落 zh-CN） */
function normalizeLanguage(v) {
  return typeof v === "string" && LANGS.includes(v) ? v : DEFAULT_LANG;
}

/** 启动时装载（main.js 在 userData 就绪后调用；settingsFile 由调用方传入） */
function initMainLocale(file) {
  settingsFile = file;
  // C-15：与 settingsStore 共用 jsonFile 读取（BOM 容忍 / 非对象留档），避免主进程语言与设置页读到两套结果
  const v = readJsonObject(file, () => ({}));
  currentLang = normalizeLanguage(v && v.app ? v.app.language : undefined);
  if (currentLang === "zh-TW") ensureTwConvert();
  return currentLang;
}

/** settings:set 写路径钩子：app.language 落盘后调用（main.js） */
function onLanguageWritten(value) {
  const next = normalizeLanguage(value);
  if (next === currentLang) return next;
  currentLang = next;
  if (next === "zh-TW") ensureTwConvert();
  return next;
}

function getMainLang() {
  return currentLang;
}

/** 主进程取词：zh-CN 恒等 / zh-TW 转换 / en、ja 查词典（缺译回落原文） */
function tMain(key) {
  if (currentLang === "zh-CN") return key;
  if (currentLang === "zh-TW") return toZhTw(key);
  const dict = currentLang === "ja" ? JA : EN;
  const v = dict[key];
  return v === undefined ? key : v;
}

module.exports = { initMainLocale, onLanguageWritten, getMainLang, tMain, normalizeLanguage, DEFAULT_LANG };
