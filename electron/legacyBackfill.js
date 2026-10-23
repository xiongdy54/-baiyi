// §9.4「历史数据兼容」可回填部分：一次性版本化启动回填（总控裁定范围：① fsrs_json 缺 S/D 基线回填 +
// ② 存量 cloze 卡 hint 拆答案；③ 无锚点 / ④ 遮挡卡无 shapes 降级路径已存在、无数据可回填——降级即终态）。
//
// 结构：纯函数判定（node 直测）与 db 写入编排分离。编排由 db.js initDb 挂载（与其他迁移同点），
// 依赖全部注入（db / queryAll / readSettings / writeSettings / now），可在隔离临时库直测。
//
// ① S/D 基线回填（判定从严）：
//    - 只动「新卡态」行：state 为 "new" / 缺失 / null——与 db.js mapCardRow A-2 闸门的 isNewState
//      **同一口径**（state 为未知名的行闸门按非新卡判，回填 S/D=0 会被判 damaged 从队列缺席，故不碰）。
//    - 基线值 = ts-fsrs createEmptyCard() 的 stability=0 / difficulty=0（实测 v5.4.2；GUIDE §4.4.1 规则 1
//      「createEmptyCard 兜底仅限首次创建与**历史缺字段基线回填**」；src/lib/fsrs.ts「新卡的 S/D 合法为 0」）。
//    - 只补缺失（undefined/null）字段，已有非空值原样保留；渲染层 toFsrsCard 对新卡态恒取库基线，
//      回填前后逐值等价（st===0 分支不读存量 S/D）。
//    - 非 new 态（learning/review/relearning）缺 S/D 行**不回填**：渲染层 toFsrsCard 已运行时归一——
//      缺省（undefined/null）走 base 分支取基线，显式 0 才落值域钳制分支 0→1（src/lib/fsrs.ts toFsrsCard
//      三元分支：st===0/缺省 → base，其余 clamp [1,10]）；而显式写 0/0 会令 difficulty 走钳制 0→1、
//      S=0 遭 ts-fsrs 拒绝（Invalid memory state {difficulty:1, stability:0}，实测 ts-fsrs 5.4.2）——
//      回填即回归；无历史依据可推导真实 S/D，该类行以「渲染层兼容即终态」处理（与 §9.4 ③④同族）。
//      **勿改 toFsrsCard 三元分支的先后次序**：本裁定以「缺省走 base、显式 0 才钳制」为前提，
//      若把钳制提前到缺省分支之前，缺省值也被钳 0→1，本裁定即失效且引入新回归。
//
// ② cloze hint 拆答案（判定从严，**不改 front_markdown / note_text**）：
//    - 渲染层答案显示链（CardBrowser CardFace cloze 分支）：back_markdown 非空白则直接显示；
//      否则按被遮 ord 逐空 extractClozeAnswer 拼接（content＋「（hint）」段，多空加圈号 U+3000 join）。
//    - 回填 = 把渲染层会拼出的**同一字符串**物化进 back_markdown——显示逐字符不变，运行时拆分退役。
//    - 行为面申报（不止显示）：物化使 back_markdown 由空白变非空，读该字段作闸的路径随之启用——
//      复习页 ReviewView canJudge 以 back_markdown 非空为闸（src/components/ReviewView.tsx），存量
//      cloze hint 卡的 AI 判答（作答后交 AI 与标准答案比对）随物化自动可判；辨析弹窗 / 制卡预查
//      同读该字段。显示逐字符不变（P0/P3 对拍把守），但「可判答」是随本回填启用的行为面变化。
//    - 触发条件＝运行时拆分确实命中显示：card_type='cloze' ∧ back_markdown 空白 ∧ 被遮 ord 的答案串
//      含非空 hint 拼段。front/note 不改写（改写会让卡片浏览 frontPreview（render(null) 只显示 content）
//      的显示变化，破坏逐字符对拍）。
//
// 写路径：单事务（BEGIN→UPDATE→COMMIT，异常 ROLLBACK 后 rethrow）；数据持久化走挂载点 initDb 末尾的
// persist()（与全部既有迁移同一原子写路径，不新增 §7.2 例外）。
// 完成标记（P1 时序纪律）：runLegacyBackfill **不写标记**，只回传 mark() 回调——挂载点必须在
// persist() 成功之后才调 mark() 落盘（C-10 起为 app_meta.legacyBackfillV1；未迁移旧库回落
// settings.app.legacyBackfillV1。v23 fsrsWeights 先例是「先写 settings 后 persist」，本回填不能
// 照抄：标记是重跑跳过的唯一安全网，先于数据落盘会在「标记已写、数据未持久化即崩溃」时把存量
// 旧数据永久锁死在未回填态）。标记存在即跳过；未标记但全库已合规 →
// 零写入后照常标记。崩溃中断：文件库只在上次完整 persist 版本，重启后未标记 → 重跑（事务保证中途
// 失败零残留；数据已 persist 而标记未写 → 重跑判定已合规 → 零写入 → 补标记）。

// 标记键：C-10 起存库内 app_meta（与库同恢复）；未迁移旧库读 settings.app 同键回落
const MARKER_KEY = "legacyBackfillV1";

// ---------- ① fsrs_json 缺 S/D 判定（纯函数） ----------

/**
 * 判定一行 fsrs_json 是否需要 S/D 基线回填。
 * @param {string} raw cards.fsrs_json 原文（调用方保证非 null/空串）
 * @returns {{ next: string, filled: string[] } | null} null=不回填；next=回填后的完整 JSON 串
 *         （原字段逐键保值保序，缺失字段以 createEmptyCard 基线 0 追加）
 */
function needsFsrsBaseline(raw) {
  let f;
  try {
    f = JSON.parse(raw);
  } catch {
    return null; // 损坏行走既有 damaged 降级链（mapCardRow），回填不碰
  }
  if (f === null || typeof f !== "object" || Array.isArray(f)) return null;
  // isNewState 与 db.js mapCardRow A-2 闸门的 isNewState（db.js 同名判定处）**同源口径，两处互为镜像，
  // 改一处必改另一处**（漂移＝回填认新卡而闸门认非新卡，值域判定分裂）。未知 state 名不算新卡态——
  // 闸门按非新卡判值域，回填 S/D=0 会被判 damaged 从队列缺席，故不碰。
  const isNewState = f.state === "new" || f.state === undefined || f.state === null;
  if (!isNewState) return null;
  const missS = f.stability === undefined || f.stability === null;
  const missD = f.difficulty === undefined || f.difficulty === null;
  if (!missS && !missD) return null;
  const next = { ...f };
  const filled = [];
  // 基线 = createEmptyCard()（ts-fsrs v5.4.2 实测 stability:0 / difficulty:0；§4.4.1 历史缺字段基线回填）
  if (missS) { next.stability = 0; filled.push("stability"); }
  if (missD) { next.difficulty = 0; filled.push("difficulty"); }
  return { next: JSON.stringify(next), filled };
}

// ---------- ② cloze hint 拆答案判定（纯函数） ----------
// 以下四个函数与 src/lib/cards.ts 的 parseCloze / extractClozeAnswer / extractClozeAnswers **逐字符同源**
// （渲染层与主进程无法共享模块——F79 双路径纪律；tests/legacyBackfill.test.cjs 用 esbuild 现场打包
// cards.ts 与本文件对拍把守，两处任一改动失配即红）。

/** 与 cards.ts parseCloze 的收集段同源：ords 去重升序（mask-all 兜底口径 = parsed.ords） */
function clozeOrdsSorted(text) {
  const re = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;
  const ords = new Set();
  let m;
  while ((m = re.exec(text))) ords.add(Number(m[1]));
  return [...ords].sort((a, b) => a - b);
}

/** 与 cards.ts parseCloze renderWith 同源（B-6 跨行版），回传首现序 maskedOrds（CardBrowser 答案 join 顺序） */
function renderDetailPort(text, hiddenOrds) {
  const mask = hiddenOrds === null || hiddenOrds === undefined
    ? null
    : new Set(Array.isArray(hiddenOrds) ? hiddenOrds : [hiddenOrds]);
  const maskedOrds = [];
  const out = text.replace(/\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g, (_s, ordStr, content, hint) => {
    const ord = Number(ordStr);
    if (mask === null || !mask.has(ord)) return content;
    if (!maskedOrds.includes(ord)) maskedOrds.push(ord);
    return "[…]";
  });
  return { text: out, maskedOrds };
}

/** 与 cards.ts extractClozeAnswer 逐字符同源（B-9 全局取全 + 「（hint）」拼接 + " / " join） */
function extractClozeAnswerPort(text, ord) {
  const re = new RegExp(`\\{\\{c${ord}::([\\s\\S]*?)(?:::([\\s\\S]*?))?\\}\\}`, "g");
  const parts = [];
  let m;
  while ((m = re.exec(text))) parts.push((m[1] ?? "") + (m[2] ? `（${m[2]}）` : ""));
  return parts.join(" / ");
}

/** 被遮 ords 中是否存在非空 hint 拼段（渲染层运行时拆分的命中判据） */
function maskedOrdsHaveHint(text, ords) {
  for (const ord of ords) {
    const re = new RegExp(`\\{\\{c${ord}::([\\s\\S]*?)(?:::([\\s\\S]*?))?\\}\\}`, "g");
    let m;
    while ((m = re.exec(text))) {
      if (m[2]) return true;
    }
  }
  return false;
}

/**
 * 判定一行卡是否需要 cloze hint 答案物化，并给出与渲染层显示逐字符相等的 back_markdown。
 * @param {object} row { cardType, backMarkdown, frontMarkdown, noteText, clozeOrds }
 * @returns {{ backMarkdown: string } | null} null=不回填
 */
function planClozeBackfill(row) {
  if (!row || row.cardType !== "cloze") return null; // qa/图片挖空等卡不跑渲染层拆分（正则命中也不拆）
  const back = row.backMarkdown;
  // 渲染层：back_markdown 非空白则直接显示——运行时拼接未参与显示，无从「规范化」
  if (back !== null && back !== undefined && String(back).trim() !== "") return null;
  const front = row.frontMarkdown || row.noteText || ""; // CardFace 同款取面口径
  const co = Array.isArray(row.clozeOrds) ? row.clozeOrds : [];
  // CardBrowser：clozeOrds 空 = 遮全部 ord（parsed.ords 升序）；非空 = 只遮自己（per-blank 拆卡后每张）
  const maskOrds = co.length > 0 ? co : clozeOrdsSorted(front);
  const { maskedOrds } = renderDetailPort(front, maskOrds);
  // 触发条件：被遮 ord 的答案串确有 hint 拼段（无 hint 的卡零写入）
  if (!maskedOrdsHaveHint(front, maskedOrds)) return null;
  const answers = maskedOrds.map((o) => extractClozeAnswerPort(front, o));
  // 与 CardBrowser clozeAnswer 兜底公式逐字符同源（圈号 + 半角空格；多空 U+3000 join）
  const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩";
  const joined = answers.length > 1
    ? answers.map((a, i) => `${CIRCLED[i] ?? "·"} ${a}`).join("　")
    : (answers[0] ?? "");
  if (joined === "") return null;
  return { backMarkdown: joined };
}

// ---------- 编排（db 注入；由 db.js initDb 挂载，也可在测试里对隔离库直跑） ----------

/** cloze_ords 列 → 数组（与 mapCardRow 的 j() 同口径：空/损坏一律 []） */
function parseClozeOrdsField(text) {
  if (text === null || text === undefined || text === "") return [];
  try {
    const v = JSON.parse(text);
    return v === null || v === undefined ? [] : v;
  } catch {
    return [];
  }
}

/**
 * 执行一次性回填。返回 { ran, reason?, fsrsFixed, clozeFixed, markedAt, mark? }。
 * - 标记已存在 → { ran:false, reason:"marked" }（幂等短路，零读零写）
 * - 单事务：BEGIN → 逐行 UPDATE → COMMIT；异常 ROLLBACK 后 rethrow（下次启动重试）
 * - 数据持久化不在此处：挂载点 initDb 末尾统一 persist()（与其他迁移同路径）
 * - 完成标记不在此处落盘（P1 时序）：回传 mark() 回调，挂载点必须在 persist() **成功之后**调用——
 *   标记是重跑跳过的唯一安全网，先于数据落盘会把未回填的存量数据永久锁死在旧形态。
 */
function runLegacyBackfill(deps) {
  const { db, queryAll, readSettings, writeSettings, readAppMeta, writeAppMeta } = deps;
  const now = typeof deps.now === "function" ? deps.now : Date.now;
  // C-10：标记优先读 app_meta（库内事实），未迁移旧库回落 settings
  const metaMarker = typeof readAppMeta === "function" ? readAppMeta(MARKER_KEY) : undefined;
  const s0 = readSettings();
  const settingsMarker = s0 && s0.app ? s0.app[MARKER_KEY] : undefined;
  if ((metaMarker !== undefined && metaMarker !== null) || (settingsMarker !== undefined && settingsMarker !== null)) {
    return { ran: false, reason: "marked", fsrsFixed: 0, clozeFixed: 0 };
  }
  const rows = queryAll(
    "SELECT id, note_text, card_type, cloze_ords, front_markdown, back_markdown, fsrs_json FROM cards WHERE is_deleted = 0"
  );
  const updates = [];
  for (const r of rows) {
    const patch = {};
    if (r.fsrs_json !== null && r.fsrs_json !== undefined && r.fsrs_json !== "") {
      const fb = needsFsrsBaseline(r.fsrs_json);
      if (fb) patch.fsrsJson = fb.next;
    }
    const cb = planClozeBackfill({
      cardType: r.card_type,
      backMarkdown: r.back_markdown,
      frontMarkdown: r.front_markdown,
      noteText: r.note_text,
      clozeOrds: parseClozeOrdsField(r.cloze_ords)
    });
    if (cb) patch.backMarkdown = cb.backMarkdown;
    if (patch.fsrsJson !== undefined || patch.backMarkdown !== undefined) {
      updates.push({ id: r.id, fsrsJson: patch.fsrsJson, backMarkdown: patch.backMarkdown });
    }
  }
  let fsrsFixed = 0;
  let clozeFixed = 0;
  if (updates.length > 0) {
    db.run("BEGIN");
    try {
      for (const u of updates) {
        if (u.fsrsJson !== undefined && u.backMarkdown !== undefined) {
          db.run("UPDATE cards SET fsrs_json = ?, back_markdown = ? WHERE id = ?", [u.fsrsJson, u.backMarkdown, u.id]);
        } else if (u.fsrsJson !== undefined) {
          db.run("UPDATE cards SET fsrs_json = ? WHERE id = ?", [u.fsrsJson, u.id]);
        } else {
          db.run("UPDATE cards SET back_markdown = ? WHERE id = ?", [u.backMarkdown, u.id]);
        }
        if (u.fsrsJson !== undefined) fsrsFixed++;
        if (u.backMarkdown !== undefined) clozeFixed++;
      }
      db.run("COMMIT");
    } catch (e) {
      try { db.run("ROLLBACK"); } catch { /* 回滚失败仅吞并，避免掩盖原异常（saveReview 同纪律） */ }
      throw e;
    }
  }
  // 完成标记（P1 时序）：本函数**不写 settings**，只回传 mark() 回调——挂载点在 persist() 成功后才
  // 调 mark() 落盘（persist 抛错/未到达 → 标记不写 → 下次启动重跑可续：事务零残留；若数据其实已
  // 持久化，重跑判定已合规 → 零写入 → 补标记）。mark() 自身抛出（标记写盘失败）同样交挂载点处置。
  const markedAt = now();
  return {
    ran: true,
    fsrsFixed,
    clozeFixed,
    markedAt,
    planned: updates.length,
    mark: () => {
      if (typeof writeAppMeta === "function") {
        writeAppMeta(MARKER_KEY, markedAt); // C-10：标记只写库内 app_meta（挂载点保证表已存在）
        return;
      }
      const s1 = readSettings();
      s1.app = { ...(s1.app || {}), [MARKER_KEY]: markedAt };
      writeSettings(s1);
    }
  };
}

module.exports = {
  MARKER_KEY,
  needsFsrsBaseline,
  clozeOrdsSorted,
  renderDetailPort,
  extractClozeAnswerPort,
  maskedOrdsHaveHint,
  planClozeBackfill,
  parseClozeOrdsField,
  runLegacyBackfill
};
