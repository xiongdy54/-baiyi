// M7 词典主进程解析层（v32）——在线 Provider 代理 + 各格式词条解析器（纯函数供测试）。
// 在线一律走主进程 net.fetch（继承系统代理，渲染层不直 fetch）。
// 实测结论（2026-09-14）：dictionaryapi.dev 直连超时（需系统代理）；Jisho 非官方 API 已下线（真 404 页），
// 在线日语查词由 JMDict 本地包替代——Jisho provider 已移除。
// 词条存储走独立 dictionary.db（electron/dictDb.js），避免大词典拖慢主库 persist。
const { net, dialog } = require("electron");
const path = require("path");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function fetchJson(url, ms = 12000) {
  const res = await net.fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Free Dictionary API（EN，免 Key）：https://dictionaryapi.dev/（需可直连或系统代理） */
async function lookupFreeDictionary(word) {
  const data = await fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  const first = Array.isArray(data) ? data[0] : null;
  if (!first) return null;
  const meanings = first.meanings || [];
  const definitions = [];
  const pos = [];
  const examples = [];
  for (const m of meanings) {
    if (m.partOfSpeech && !pos.includes(m.partOfSpeech)) pos.push(m.partOfSpeech);
    for (const d of m.definitions || []) {
      if (d.definition) definitions.push(d.definition);
      if (d.example) examples.push(d.example);
    }
  }
  const phon = first.phonetic || (first.phonetics || []).find((p) => p.text)?.text || null;
  const audio = (first.phonetics || []).find((p) => p.audio)?.audio || null;
  if (definitions.length === 0) return null;
  return {
    word: first.word || word, reading: null, pronunciation: phon, audio,
    definitions: definitions.slice(0, 6), partOfSpeech: pos, examples: examples.slice(0, 3),
    source: "Free Dictionary API", language: "en", normalizedWord: word,
    capabilities: ["definition", "pronunciation", ...(audio ? ["audio"] : []), "partOfSpeech", "examples"],
  };
}

async function lookupOnline(providerId, word) {
  if (providerId === "free-dictionary-api") return lookupFreeDictionary(word);
  throw new Error(`未知在线词典: ${providerId}`);
}

// ---------- 词条解析器（async generator：分片让出主进程——大词典同步解析曾把窗口卡死，v32 修复） ----------
// 产物 {headword, phonetic, html, pos} 流交 dictDb.insertRows（for await 消费）。

const YIELD_EVERY = 5000;
const yieldNow = () => new Promise((r) => setImmediate(r));

/** RFC4180 引号感知切分单行（处理字段内逗号与 "" 转义） */
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** 把可能含引号跨行字段的 CSV 文本切成完整逻辑行（引号配平才算一行结束） */
function csvLogicalLines(text) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  let buf = null;
  for (const line of lines) {
    if (buf === null) buf = line;
    else buf += "\n" + line;
    // 引号数为偶数 → 本逻辑行完整
    const quotes = (buf.match(/"/g) || []).length;
    if (quotes % 2 === 0) { out.push(buf); buf = null; }
  }
  if (buf !== null) out.push(buf);
  return out;
}

/** ECDICT CSV：word,phonetic,definition,translation,pos,…（字段可含逗号/引号/换行） */
async function* parseEcdictCsv(text) {
  const lines = csvLogicalLines(text);
  const head = splitCsvLine(lines.shift() || "");
  const wi = head.indexOf("word");
  const pi = head.indexOf("phonetic");
  const ti = head.indexOf("translation");
  const posi = head.indexOf("pos");
  if (wi < 0) return;
  let n = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = splitCsvLine(line);
    const word = (cols[wi] || "").trim();
    if (!word) continue;
    yield {
      headword: word,
      phonetic: pi >= 0 ? (cols[pi] || "").trim() : "",
      html: (ti >= 0 ? (cols[ti] || "") : "").slice(0, 500),
      pos: posi >= 0 ? (cols[posi] || "").trim().slice(0, 60) : "",
    };
    if (++n % YIELD_EVERY === 0) await yieldNow();
  }
}

/** CC-CEDICT：繁体 简体 [拼音] /释义1/释义2/（# 开头为注释）；繁简各插一行便于双向查询。
 *  去重用 Set——曾用 out.some() 线性扫描，12 万词条 O(n²) 把主进程堵死（用户实测 55% 无响应）。 */
async function* parseCedictText(text) {
  const seen = new Set();
  let n = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/\s*$/);
    if (!m) continue;
    const [, trad, simp, pinyin, gloss] = m;
    const html = gloss.split("/").filter(Boolean).slice(0, 8).join("\n").slice(0, 500);
    for (const hw of [trad, simp]) {
      if (!hw || seen.has(hw)) continue;
      seen.add(hw);
      yield { headword: hw, phonetic: pinyin, html, pos: "" };
    }
    if (++n % YIELD_EVERY === 0) await yieldNow();
  }
}

/** JMdict（JMdict_e.gz 解压后的 XML）：每个 entry 取 keb/reb 与英文 gloss */
async function* parseJmdictXml(xml) {
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  let n = 0;
  while ((m = entryRe.exec(xml)) && n < 500000) {
    const block = m[1];
    const keb = (block.match(/<keb>([^<]*)<\/keb>/) || [])[1] || null;
    const reb = (block.match(/<reb>([^<]*)<\/reb>/) || [])[1] || null;
    const glosses = [...block.matchAll(/<gloss[^>]*>([^<]*)<\/gloss>/g)].map((g) => g[1]);
    if (glosses.length > 0) {
      const html = glosses.slice(0, 8).join("\n").slice(0, 500);
      const pos = [...block.matchAll(/<pos>([^<]*)<\/pos>/g)].map((p) => p[1].replace(/&apos;/g, "'")).slice(0, 3).join("/");
      const seen = new Set();
      for (const hw of [keb, reb]) {
        if (!hw || seen.has(hw)) continue;
        seen.add(hw);
        yield { headword: hw, phonetic: reb || "", html, pos };
      }
    }
    if (++n % YIELD_EVERY === 0) await yieldNow();
  }
}

/** ECDICT sqlite（ecdict-sqlite-28.zip 内 .db）：自动探测含 word+translation 列的表，流式产出词条 */
async function* iterEcdictSqlite(bytes) {
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  const db = new SQL.Database(bytes);
  const tables = [];
  const q = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
  for (const row of (q[0]?.values ?? [])) tables.push(String(row[0]));
  let table = null;
  for (const t of tables) {
    const cols = db.exec(`PRAGMA table_info(${JSON.stringify(t).replace(/"/g, "")})`);
    const names = (cols[0]?.values ?? []).map((r) => String(r[1]));
    if (names.includes("word") && names.includes("translation")) { table = t; break; }
  }
  if (!table) throw new Error("该 sqlite 中找不到含 word/translation 列的词典表");
  const stmt = db.prepare(`SELECT word, phonetic, translation, pos FROM ${table}`);
  while (stmt.step()) {
    const r = stmt.getAsObject();
    const word = String(r.word ?? "").trim();
    if (!word) continue;
    yield {
      headword: word,
      phonetic: String(r.phonetic ?? "").slice(0, 80),
      // ECDICT 全量 340 万行——单行释义截断以压 dictionary.db 体积（sql.js 全内存架构）
      html: String(r.translation ?? "").slice(0, 250),
      pos: String(r.pos ?? "").slice(0, 60),
    };
  }
  stmt.free();
  db.close();
}

// ---------- v38（D35）日→中两部词典解析器 ----------

const KANA_RE = /[\u3040-\u30ff]/;

/** 从 wiktextract 的日语词条对象里尽力取假名读音：sounds[].other/form（东京腔假名）→ forms[].ruby 的假名侧 */
function kaikkiJaReading(o) {
  for (const s of Array.isArray(o.sounds) ? o.sounds : []) {
    for (const key of ["other", "form", "hira", "kana"]) {
      const v = String(s?.[key] ?? "").trim();
      if (v && KANA_RE.test(v)) return v.slice(0, 60);
    }
  }
  for (const f of Array.isArray(o.forms) ? o.forms : []) {
    if (Array.isArray(f?.ruby) && f.ruby.length) {
      const kana = f.ruby
        .map((r) => (Array.isArray(r) ? String(r[1] ?? "") : ""))
        .filter((x) => KANA_RE.test(x))
        .join("");
      if (kana) return kana.slice(0, 60);
    }
  }
  return "";
}

/**
 * kaikki zhwiktionary 原始提取（raw-wiktextract-data.jsonl[.gz]，v38 D35）：
 * 中文维基词典全语言词条，每行一个 JSON 对象，按 lang_code==="ja" 过滤出日语词条（中文释义）。
 * 原始包 216MB gz 解压后 GB 级——必须流式逐行，绝不可整体 readFileSync；
 * 同一词头多行（词性/繁简变体）在内存合并释义去重后产出（dictDb 首条胜，不合并会丢词性变体）。
 * onScanProgress(行数)：扫描阶段（占大头）的进度回报。
 */
async function* parseKaikkiJsonlFile(filePath, onScanProgress = null) {
  const fs = require("fs");
  const zlib = require("zlib");
  const readline = require("readline");
  const fd = fs.openSync(filePath, "r");
  const magic = Buffer.alloc(2);
  fs.readSync(fd, magic, 0, 2, 0);
  fs.closeSync(fd);
  let input = fs.createReadStream(filePath);
  if (magic[0] === 0x1f && magic[1] === 0x8b) input = input.pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const merged = new Map();
  let scanned = 0;
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      scanned++;
      if (onScanProgress && scanned % 50000 === 0) {
        try { onScanProgress(scanned); } catch { /* 忽略 */ }
        await yieldNow();
      }
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (!o || o.lang_code !== "ja") continue;
      const word = String(o.word || "").trim();
      if (!word) continue;
      const defs = [];
      for (const s of Array.isArray(o.senses) ? o.senses : []) {
        const gs = Array.isArray(s?.raw_glosses) ? s.raw_glosses : Array.isArray(s?.glosses) ? s.glosses : [];
        for (const g of gs) {
          const t = String(g || "").trim();
          if (t && !defs.includes(t)) defs.push(t);
          if (defs.length >= 8) break;
        }
        if (defs.length >= 8) break;
      }
      if (defs.length === 0) continue;
      const reading = kaikkiJaReading(o);
      const pos = String(o.pos || "").slice(0, 30);
      const prev = merged.get(word);
      if (prev) {
        for (const d of defs) if (!prev.defs.includes(d)) prev.defs.push(d);
        if (!prev.phonetic && reading) prev.phonetic = reading;
        if (!prev.pos && pos) prev.pos = pos;
      } else {
        merged.set(word, { phonetic: reading, defs, pos });
      }
    }
  } finally {
    rl.close();
    if (typeof input.destroy === "function") input.destroy();
  }
  let n = 0;
  for (const [headword, v] of merged) {
    yield { headword, phonetic: v.phonetic, html: v.defs.join("\n").slice(0, 500), pos: v.pos };
    if (++n % YIELD_EVERY === 0) await yieldNow();
  }
}

/** gzip 文件头部小样解压（截断流用 Z_SYNC_FLUSH 取部分输出）——.gz 分支嗅探路由用 */
function sniffGzHead(filePath, bytes = 256 * 1024) {
  const fs = require("fs");
  const zlib = require("zlib");
  const buf = Buffer.alloc(bytes);
  const fd = fs.openSync(filePath, "r");
  let read = 0;
  try {
    read = fs.readSync(fd, buf, 0, bytes, 0);
  } finally {
    fs.closeSync(fd);
  }
  const slice = buf.subarray(0, read);
  const opts = { finishFlush: zlib.constants.Z_SYNC_FLUSH };
  // .gz 恒为 gzip 容器（gunzip）；inflate 兜底防 zlib 容器误存；截断流靠 Z_SYNC_FLUSH 取部分输出
  for (const fn of ["gunzipSync", "inflateSync"]) {
    try {
      return zlib[fn](slice, opts).toString("utf8");
    } catch { /* 试下一种容器 */ }
  }
  return slice.toString("utf8");
}

/**
 * jamdict-cn sqlite（jamdict schema，v38 D35）：Entry/Kanji/Kana/Sense/SenseGloss 表族，
 * 中文释义在 SenseGloss.lang='chn'（实测 36.6 万条；另含 eng——只取 chn）。
 * 先把中文释义按 idseq 物化成 Map，再单遍扫 Entry×Kanji×Kana 产出：
 * 汉字词头（读音=假名）与假名词头各一行（照抄 JMdict 解析器的 keb/reb 双行策略，双向可查）。
 * NE*（专名列族）不入——JMdict 解析器同样不含 JMnedict，控制 dictionary.db 体积。
 */
async function* iterJamdictSqlite(bytes) {
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  const db = new SQL.Database(bytes);
  const tables = [];
  const q = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
  for (const row of (q[0]?.values ?? [])) tables.push(String(row[0]));
  if (!tables.includes("Entry") || !tables.includes("SenseGloss")) {
    db.close();
    throw new Error("该 sqlite 不是 jamdict 词典库（缺 Entry/SenseGloss 表）");
  }
  const glossMap = new Map();
  const gstmt = db.prepare("SELECT s.idseq AS idseq, sg.text AS text FROM Sense s JOIN SenseGloss sg ON sg.sid = s.ID WHERE sg.lang = 'chn'");
  while (gstmt.step()) {
    const r = gstmt.getAsObject();
    const t = String(r.text ?? "").trim();
    if (!t) continue;
    const id = String(r.idseq);
    const arr = glossMap.get(id);
    if (arr) {
      if (!arr.includes(t) && arr.length < 8) arr.push(t);
    } else {
      glossMap.set(id, [t]);
    }
  }
  gstmt.free();
  const estmt = db.prepare("SELECT e.idseq AS idseq, k.text AS kanji, ka.text AS kana FROM Entry e LEFT JOIN Kanji k ON k.idseq = e.idseq LEFT JOIN Kana ka ON ka.idseq = e.idseq");
  const seenHw = new Set();
  let n = 0;
  while (estmt.step()) {
    const r = estmt.getAsObject();
    const kanji = String(r.kanji ?? "").trim();
    const kana = String(r.kana ?? "").trim();
    const defs = glossMap.get(String(r.idseq));
    if (!defs || defs.length === 0) continue;
    const html = defs.join("\n").slice(0, 500);
    if (kanji && !seenHw.has(kanji)) {
      seenHw.add(kanji);
      yield { headword: kanji, phonetic: kana, html, pos: "" };
    }
    if (kana && kana !== kanji && !seenHw.has(kana)) {
      seenHw.add(kana);
      yield { headword: kana, phonetic: "", html, pos: "" };
    }
    if (++n % YIELD_EVERY === 0) await yieldNow();
  }
  estmt.free();
  db.close();
}

/** sqlite 词典库类型探测（.db/.zip 内 .db 的路由依据）：jamdict schema 优先于 ECDICT */
async function detectSqliteKind(bytes) {
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  const db = new SQL.Database(bytes);
  try {
    const q = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const names = (q[0]?.values ?? []).map((r) => String(r[0]));
    if (names.includes("Entry") && names.includes("SenseGloss")) return "jamdict";
    return "unknown";
  } finally {
    db.close();
  }
}

// ---------- StarDict 三件套（目录形态；.dict.dz = gzip 全量可解） ----------

function parseStarDictIdx(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const z = buf.indexOf(0, i);
    if (z < 0 || z + 9 > buf.length) break;
    const word = buf.toString("utf8", i, z);
    const offset = buf.readUInt32BE(z + 1);
    const size = buf.readUInt32BE(z + 5);
    out.push({ word, offset, size });
    i = z + 9;
  }
  return out;
}

function gunzipBestEffort(buf) {
  try {
    const zlib = require("zlib");
    return zlib.gunzipSync(buf);
  } catch {
    return buf;
  }
}

/** 从目录读 StarDict 全量词条（导入用，量中等） */
function starDictRowsFromDir(dir) {
  const fs = require("fs");
  const files = fs.readdirSync(dir);
  const idxF = files.find((f) => f.endsWith(".idx"));
  const dictF = files.find((f) => f.endsWith(".dict.dz") || f.endsWith(".dict"));
  if (!idxF || !dictF) throw new Error("StarDict 目录缺少 .idx/.dict 文件");
  const zlib = require("zlib");
  let dictBuf;
  try {
    dictBuf = zlib.gunzipSync(fs.readFileSync(path.join(dir, dictF)));
  } catch {
    dictBuf = fs.readFileSync(path.join(dir, dictF));
  }
  const idx = parseStarDictIdx(fs.readFileSync(path.join(dir, idxF)));
  return idx.slice(0, 500000).map((e) => ({
    headword: e.word,
    phonetic: "",
    html: dictBuf.toString("utf8", e.offset, Math.min(dictBuf.length, e.offset + e.size)).replace(/\0/g, "").slice(0, 2000),
    pos: "",
  }));
}

/** 单词查一条（冒烟/调试用） */
function lookupStarDictSync(dir, word) {
  const fs = require("fs");
  const files = fs.readdirSync(dir);
  const ifo = files.find((f) => f.endsWith(".ifo"));
  const idxF = files.find((f) => f.endsWith(".idx"));
  const dictF = files.find((f) => f.endsWith(".dict.dz") || f.endsWith(".dict"));
  if (!ifo || !idxF || !dictF) throw new Error("StarDict 目录缺少 .ifo/.idx/.dict 文件");
  const idx = parseStarDictIdx(fs.readFileSync(path.join(dir, idxF)));
  const key = String(word).toLowerCase();
  let lo = 0, hi = idx.length - 1, hit = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const w = idx[mid].word.toLowerCase();
    if (w === key) { hit = idx[mid]; break; }
    if (w < key) lo = mid + 1; else hi = mid - 1;
  }
  if (!hit) hit = idx.find((e) => e.word.toLowerCase() === key) || null;
  if (!hit) return null;
  const dictBuf = gunzipBestEffort(require("fs").readFileSync(path.join(dir, dictF)));
  const html = dictBuf.toString("utf8", hit.offset, hit.offset + hit.size).replace(/\0/g, "");
  return { headword: hit.word, phonetic: "", html, pos: "" };
}

/** Lingvo DSL（纯文本行格式）：非 # 非空行=headword，缩进行=释义块 */
function parseDsl(text) {
  const out = [];
  let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim() || line.startsWith("#")) continue;
    if (/^\s/.test(line) && cur) {
      cur.html += `${line.trim()}\n`;
    } else {
      if (cur && cur.html.trim()) out.push(cur);
      cur = { headword: line.trim(), phonetic: "", html: "", pos: "" };
    }
  }
  if (cur && cur.html.trim()) out.push(cur);
  return out;
}

module.exports = {
  lookupOnline,
  lookupFreeDictionary,
  splitCsvLine,
  csvLogicalLines,
  parseEcdictCsv,
  parseCedictText,
  parseJmdictXml,
  parseDsl,
  iterEcdictSqlite,
  iterJamdictSqlite,
  detectSqliteKind,
  parseKaikkiJsonlFile,
  sniffGzHead,
  parseStarDictIdx,
  starDictRowsFromDir,
  lookupStarDictSync,
  gunzipBestEffort,
  pickDictFile: async () => {
    const { dialog: dlg } = require("electron");
    const r = await dlg.showOpenDialog({
      filters: [{ name: "词典文件", extensions: ["csv", "u8", "ifo", "idx", "dict", "dz", "dsl", "zip", "gz", "db", "sqlite", "jsonl"] }],
      properties: ["openFile", "openDirectory"],
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    return { name: path.basename(r.filePaths[0]), path: r.filePaths[0] };
  },
};
