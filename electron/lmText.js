// D124 学习者模型 LM-1（设计 docs/design/LEARNER-MODEL-REDESIGN-D124.md §6.1/§6.2）：纯文本与内容单元切分。
// 纯函数、零 IO；依赖方向 lmParams ← lmText（§0.1-10），只允许 require ./lmParams 与 node 内置。
const lmParams = require("./lmParams");

// 设计稿 §6.1：无标题材料的首个单元标题（单元标题是落库数据；lmStrings 只服务 lmRecommend，
// 依赖方向禁止 lmText 反向引用，故此处为具名常量，出处＝设计稿 §6.1 第 1 条）。
const PREAMBLE_TITLE = "开篇";

const HEADING_RE = /^(#{1,3})\s+(.+)$/;
const FENCE_RE = /^\s*(```|~~~)/;

// ---------- markdown 转纯文本（设计稿 §6.1 markdownToPlain，逐行按序替换） ----------

function markdownToPlain(md) {
  const src = String(md ?? "");
  const lines = src.split("\n");
  const out = [];
  let inFence = false;
  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue; // 围栏标记行本身删除；围栏内其余行原样保留（设计稿 §6.1 第 0 条）
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    let s = line;
    s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1"); // 1 图片 → alt
    s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"); // 2 链接 → 文字
    s = s.replace(/<[^>]+>/g, ""); // 3 HTML 标签
    s = s.replace(/^#{1,6}\s+/, ""); // 4 行首标题标记
    s = s.replace(/^>\s?/, ""); // 5 行首引用
    s = s.replace(/^\s*([-*+]|\d+\.)\s+/, ""); // 6 行首列表标记
    s = s.replace(/\*\*|__|\*|~~/g, ""); // 7 强调与删除线（单个 _ 不删）
    s = s.replace(/`/g, ""); // 8 行内代码反引号
    s = s.replace(/\|/g, " "); // 9 表格竖线
    out.push(s);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n"); // 10 三个以上连续换行压成两个
}

// ---------- 切句（设计稿 §6.1 splitSentences；返回 {text,start,end}，偏移相对原文） ----------

function splitSentences(text) {
  const src = String(text ?? "");
  const out = [];
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const seg = new Intl.Segmenter(undefined, { granularity: "sentence" });
    for (const s of seg.segment(src)) {
      if (s.segment) out.push({ text: s.segment, start: s.index, end: s.index + s.segment.length });
    }
    if (out.length > 0) return out;
  }
  // 退化（极旧环境或 Segmenter 缺席）：正则切句
  const re = /[^。！？.!?\n]+[。！？.!?]?/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[0]) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// ---------- markdown 切内容单元（设计稿 §6.1 segmentMarkdown） ----------

function isExerciseTitle(title) {
  return /习题|练习|例题|思考题|exercise|problem|quiz/i.test(title) ? 1 : 0;
}

function segmentMarkdown(md) {
  const src = String(md ?? "");
  // 0. 按行扫描（\r\n 视为换行；偏移按原字符串计算）
  const sections = [];
  const lines = [];
  let pos = 0;
  for (const raw of src.split("\n")) {
    lines.push({ start: pos, end: pos + raw.length, text: raw });
    pos += raw.length + 1; // +1 = 被split吃掉的 \n（末行无）
  }
  let inFence = false;
  let firstHeadingAt = -1;
  const headingIdx = new Map(); // line index → { level, title }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (FENCE_RE.test(l.text)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = HEADING_RE.exec(l.text);
    if (m) {
      headingIdx.set(i, { level: m[1].length, title: m[2].trim() });
      if (firstHeadingAt < 0) firstHeadingAt = i;
    }
  }
  // 标题行定位 section：section.mdFrom = 标题行首偏移，mdTo = 下一个标题行首偏移
  const headingLines = [...headingIdx.keys()].sort((a, b) => a - b);
  const sectionOfLine = new Map(); // heading line index → section
  for (let h = 0; h < headingLines.length; h++) {
    const li = headingLines[h];
    const { level, title } = headingIdx.get(li);
    const path = [];
    for (let p = h - 1; p >= 0; p--) {
      const prev = headingIdx.get(headingLines[p]);
      if (prev.level < level) {
        path.unshift(prev.title);
        if (path.length >= level) break;
      }
    }
    const nextFrom = h + 1 < headingLines.length ? lines[headingLines[h + 1]].start : src.length;
    sections.push({ title, headingPath: path, mdFrom: lines[li].start, mdTo: nextFrom, plainLen: 0 });
    sectionOfLine.set(li, sections.length - 1);
  }
  // 第一个标题前若有非空文字 → 开篇 section
  if (firstHeadingAt > 0) {
    let hasText = false;
    for (let i = 0; i < firstHeadingAt; i++) {
      if (lines[i].text.trim()) {
        hasText = true;
        break;
      }
    }
    if (hasText) {
      sections.unshift({ title: PREAMBLE_TITLE, headingPath: [], mdFrom: 0, mdTo: lines[firstHeadingAt].start, plainLen: 0 });
    }
  }
  // 没有任何标题：整篇当一个 section（设计稿 §6.1 第 5 条）
  if (sections.length === 0) {
    if (src.trim()) sections.push({ title: PREAMBLE_TITLE, headingPath: [], mdFrom: 0, mdTo: src.length, plainLen: 0 });
  }
  // 2. plainLen；丢弃 < 50 的空章节（必须在合并之前）
  for (const s of sections) s.plainLen = markdownToPlain(src.slice(s.mdFrom, s.mdTo)).trim().length;
  let kept = sections.filter((s) => s.plainLen >= 50);

  // 3. 合并
  const merged = [];
  let cur = null;
  for (const s of kept) {
    if (!cur) {
      cur = { ...s };
      continue;
    }
    if (cur.plainLen < lmParams.UNIT_MIN_CHARS || cur.plainLen + s.plainLen <= lmParams.UNIT_TARGET_CHARS) {
      cur.mdTo = s.mdTo;
      cur.plainLen += s.plainLen;
    } else {
      merged.push(cur);
      cur = { ...s };
    }
  }
  if (cur) merged.push(cur);

  // 4. 拆分（plainLen > UNIT_MAX_CHARS，在 markdown 原文片段上找段边界）
  const finalUnits = [];
  for (const u of merged) {
    if (u.plainLen <= lmParams.UNIT_MAX_CHARS) {
      finalUnits.push(u);
      continue;
    }
    const frag = src.slice(u.mdFrom, u.mdTo);
    // 段边界：\n[ \t]*\r?\n；每段在其片段内的起止偏移
    const paras = [];
    let pFrom = 0;
    const sepRe = /\n[ \t]*\r?\n/g;
    let m2;
    while ((m2 = sepRe.exec(frag)) !== null) {
      paras.push({ from: pFrom, to: m2.index, len: 0 });
      pFrom = m2.index + m2[0].length;
    }
    paras.push({ from: pFrom, to: frag.length, len: 0 });
    for (const p of paras) p.len = markdownToPlain(frag.slice(p.from, p.to)).trim().length;
    // 逐段累加，累计 >= UNIT_TARGET_CHARS 就切一刀
    const cuts = [];
    let acc = 0;
    let blkFrom = 0;
    let blkLen = 0;
    for (const p of paras) {
      if (blkLen === 0) {
        blkFrom = p.from;
        acc = 0;
      }
      acc += p.len;
      blkLen += 1;
      if (acc >= lmParams.UNIT_TARGET_CHARS) {
        cuts.push({ from: blkFrom, to: p.to, len: acc });
        blkLen = 0;
        acc = 0;
      }
    }
    if (blkLen > 0) cuts.push({ from: blkFrom, to: paras[paras.length - 1].to, len: acc });
    // 最后一块 < UNIT_MIN_CHARS 并入前一块
    if (cuts.length >= 2 && cuts[cuts.length - 1].len < lmParams.UNIT_MIN_CHARS) {
      const last = cuts.pop();
      cuts[cuts.length - 1].to = last.to;
      cuts[cuts.length - 1].len += last.len;
    }
    const k = cuts.length;
    for (let i = 0; i < k; i++) {
      finalUnits.push({
        title: k > 1 ? `${u.title}（${i + 1}/${k}）` : u.title,
        headingPath: u.headingPath,
        mdFrom: u.mdFrom + cuts[i].from,
        // 子单元 mdTo = 下一子单元 mdFrom（首尾相接不留缝）；最后一个 = 原单元 mdTo
        mdTo: i + 1 < k ? u.mdFrom + cuts[i + 1].from : u.mdTo,
        plainLen: cuts[i].len
      });
    }
  }

  // 6. 保险再删一次 < 50，重新编号
  const units = finalUnits.filter((u) => u.plainLen >= 50);
  return units.map((u, i) => ({
    ord: i,
    title: u.title,
    headingPath: u.headingPath,
    mdFrom: u.mdFrom,
    mdTo: u.mdTo,
    plainLen: u.plainLen,
    isExercise: isExerciseTitle(u.title)
  }));
}

// ---------- PDF 按页切单元（设计稿 §6.1 segmentPages；页码 0 起，闭区间） ----------

function segmentPages(pageTexts) {
  const pages = (Array.isArray(pageTexts) ? pageTexts : []).map((t) => String(t ?? ""));
  const out = [];
  let accLen = 0;
  let blkFrom = 0;
  const pushUnit = (from, to, len) => {
    out.push({
      ord: out.length,
      title: from === to ? `第 ${from + 1} 页` : `第 ${from + 1}–${to + 1} 页`,
      headingPath: [],
      mdFrom: null,
      mdTo: null,
      pageFrom: from,
      pageTo: to,
      plainLen: len,
      isExercise: 0
    });
  };
  for (let i = 0; i < pages.length; i++) {
    accLen += pages[i].length;
    if (accLen >= lmParams.UNIT_TARGET_CHARS) {
      pushUnit(blkFrom, i, accLen);
      blkFrom = i + 1;
      accLen = 0;
    }
  }
  if (blkFrom < pages.length) {
    if (out.length > 0 && accLen < lmParams.UNIT_MIN_CHARS) {
      // 最后一块并入前一块
      const last = out[out.length - 1];
      last.pageTo = pages.length - 1;
      last.plainLen += accLen;
      last.title = last.pageFrom === last.pageTo ? `第 ${last.pageFrom + 1} 页` : `第 ${last.pageFrom + 1}–${last.pageTo + 1} 页`;
    } else {
      pushUnit(blkFrom, pages.length - 1, accLen);
    }
  }
  return out;
}

// ---------- 语言检测（设计稿 §6.2 detectLang；兜底用，library_items.lang 永远优先） ----------

const LATIN_VOTE_SETS = {
  en: ["the", "and", "of", "to", "is", "that", "it", "with", "for", "was"],
  fr: ["le", "la", "les", "des", "est", "une", "dans", "pour", "qui", "pas"],
  de: ["der", "die", "und", "das", "ist", "nicht", "ein", "eine", "mit", "sich"],
  es: ["el", "los", "las", "que", "una", "por", "con", "para", "del", "está"],
  it: ["il", "che", "di", "della", "per", "non", "sono", "una", "gli", "è"],
  pt: ["o", "os", "que", "não", "uma", "para", "com", "do", "da", "são"],
  nl: ["de", "het", "een", "en", "van", "dat", "niet", "ik", "zijn", "met"]
};

function countScript(text, re) {
  const m = text.match(re);
  return m ? m.length : 0;
}

function detectLang(text) {
  const src = String(text ?? "").slice(0, 3000);
  if (!src) return "";
  const kana = countScript(src, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const han = countScript(src, /\p{Script=Han}/gu);
  const hangul = countScript(src, /\p{Script=Hangul}/gu);
  const thai = countScript(src, /\p{Script=Thai}/gu);
  const arabic = countScript(src, /\p{Script=Arabic}/gu);
  const hebrew = countScript(src, /\p{Script=Hebrew}/gu);
  const cyrillic = countScript(src, /\p{Script=Cyrillic}/gu);
  const greek = countScript(src, /\p{Script=Greek}/gu);
  const devanagari = countScript(src, /\p{Script=Devanagari}/gu);
  const latin = countScript(src, /\p{Script=Latin}/gu);
  // 1. 假名优先于汉字（日语混汉字）
  if (kana > 20 && kana >= 0.05 * (kana + han)) return "ja";
  // 2. 汉字
  if (han > 50 && han > latin) return "zh";
  // 3. 其他大文字块
  if (hangul > 50) return "ko";
  if (thai > 50) return "th";
  if (hebrew > 50) return "he";
  if (greek > 50) return "el";
  if (devanagari > 50) return "hi";
  // 4. 阿拉伯（波斯语等同文字语言无法区分，用户须在书籍属性里手动指定）
  if (arabic > 50) return "ar";
  // 5. 西里尔（乌克兰语含 ї є і ґ 任一 > 5 次）
  if (cyrillic > 50) {
    for (const ch of ["ї", "є", "і", "ґ"]) {
      if (countScript(src, new RegExp(ch, "gu")) > 5) return "uk";
    }
    return "ru";
  }
  // 6. 拉丁 → 停用词投票
  if (latin > 200) {
    const words = src.toLowerCase().split(/[\s\p{P}\p{S}]+/u).filter(Boolean);
    const votes = {};
    for (const [lang, set] of Object.entries(LATIN_VOTE_SETS)) {
      let n = 0;
      for (const w of words) if (set.includes(w)) n++;
      votes[lang] = n;
    }
    let best = "";
    let bestN = lmParams.LANG_VOTE_MIN - 1;
    for (const lang of Object.keys(votes).sort()) {
      if (votes[lang] > bestN) {
        best = lang;
        bestN = votes[lang];
      }
    }
    return bestN >= lmParams.LANG_VOTE_MIN ? best : "";
  }
  // 7. 其余未知
  return "";
}

module.exports = { markdownToPlain, segmentMarkdown, segmentPages, splitSentences, detectLang, PREAMBLE_TITLE };
