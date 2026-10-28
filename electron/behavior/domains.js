// BDI（D248 / T10）：领域归因——显式种子优先、禁止 card↔extract↔item 递归、leaf/lang/none 三基础层、
// `_none` 残差、删除实体保留最后已知并标 stale（§8.2 / §8.3）。
// 数据只来自主库只读投影 pull（bdiPull），写只落 behavior.db 的 entity_domains / dirty_days。
"use strict";

const ATTRIBUTION_VERSION = 1;
const LEAF_RE = /^\d+$/;

function createDomains(opts) {
  const db = opts.db;
  const pull = opts.pull;
  const now = typeof opts.now === "function" ? opts.now : Date.now;
  const attributionVersion = Number.isInteger(opts.attributionVersion) ? opts.attributionVersion : ATTRIBUTION_VERSION;
  const dirtyReason = "domains";

  const upsert = db.prepare(`INSERT INTO entity_domains
    (entity_type, entity_id, udc_json, udc_main, lang, method, quality, attribution_version, resolved_at, stale)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(entity_type, entity_id) DO UPDATE SET
      udc_json = excluded.udc_json, udc_main = excluded.udc_main, lang = excluded.lang,
      method = excluded.method, quality = excluded.quality, attribution_version = excluded.attribution_version,
      resolved_at = excluded.resolved_at, stale = excluded.stale`);
  const selectRow = db.prepare("SELECT * FROM entity_domains WHERE entity_type = ? AND entity_id = ?");
  const allRows = db.prepare("SELECT entity_type, entity_id FROM entity_domains");
  const insertDirty = db.prepare("INSERT OR IGNORE INTO dirty_days (day, reason) VALUES (?, ?)");
  const eventDays = db.prepare(`SELECT DISTINCT day FROM events
    WHERE card_id = ? OR extract_id = ? OR (entity_type = ? AND entity_id = ?) LIMIT 40`);

  function scanAll(table) {
    const out = [];
    let cursor = 0;
    for (;;) {
      const rows = pull({ table, mode: "scan", cursor, limit: 500 });
      if (!rows.length) break;
      out.push(...rows);
      cursor = rows[rows.length - 1]._rowid;
      if (rows.length < 500) break;
    }
    return out;
  }

  function parseCodes(raw, max = 3) {
    let arr = raw;
    if (typeof raw === "string") {
      try { arr = JSON.parse(raw); } catch { arr = null; }
    }
    if (!Array.isArray(arr)) return [];
    const codes = [];
    for (const x of arr) {
      const code = x && typeof x === "object" ? String(x.code ?? "") : String(x ?? "");
      if (!code || code === "null" || code === "undefined") continue;
      if (!codes.includes(code)) codes.push(code);
      if (codes.length >= max) break;
    }
    return codes;
  }

  function bucket(code) {
    if (code === "_none") return { code, level: "none" };
    if (code.startsWith("lang:")) return { code, level: "lang" };
    if (LEAF_RE.test(code)) return { code, level: "leaf" };
    return null; // 非叶子/非语言码不入基础层
  }

  function normalize(weights) {
    const entries = [...weights.entries()].filter(([, w]) => Number.isFinite(w) && w > 0);
    let sum = entries.reduce((s, [, w]) => s + w, 0);
    const out = [];
    if (sum <= 0) return out;
    for (const [code, w] of entries) {
      const b = bucket(code);
      if (!b) continue;
      out.push({ code: b.code, level: b.level, w: w / sum });
    }
    out.sort((a, b) => b.w - a.w || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    return out;
  }

  function withResidual(list, keep = 3, minShare = 0.1) {
    const kept = list.slice(0, keep).filter((x) => x.w >= minShare);
    const keptSum = kept.reduce((s, x) => s + x.w, 0);
    const residual = Math.max(0, 1 - keptSum);
    if (residual > 1e-9) kept.push({ code: "_none", level: "none", w: residual });
    return kept;
  }

  function mainOf(list) {
    const top = list.find((x) => x.code !== "_none");
    return top ? top.code : null;
  }

  function add(map, code, w) {
    if (!code) return;
    const b = bucket(code);
    if (!b) return;
    map.set(code, (map.get(code) || 0) + w);
  }

  /** 全量刷新（按表分页；页间不阻塞读取）。返回 { written, changed, stale }。 */
  function refreshAll() {
    const cards = scanAll("cards");
    const extracts = scanAll("extracts");
    const documents = scanAll("documents");
    const items = scanAll("library_items");
    const kps = scanAll("knowledge_points");
    const tracks = scanAll("learner_tracks");
    const tms = scanAll("track_materials");
    const t = now();

    const cardById = new Map(cards.map((c) => [c.id, c]));
    const extractById = new Map(extracts.map((e) => [e.id, e]));
    const docById = new Map(documents.map((d) => [d.id, d]));
    const itemById = new Map(items.map((i) => [i.id, i]));
    const kpById = new Map(kps.map((k) => [k.id, k]));
    const trackById = new Map(tracks.map((x) => [x.id, x]));

    // 卡片显式领域（首 0.7 / 次 0.3）；只取显式，不在此处回落（防递归）
    const cardExplicit = new Map(); // cardId → [{code,w}]
    for (const c of cards) {
      if (c.is_deleted) continue;
      const codes = parseCodes(c.domain, 2);
      if (!codes.length) continue;
      const m = new Map();
      codes.forEach((code, i) => add(m, code, i === 0 && codes.length > 1 ? 0.7 : i === 1 ? 0.3 : 1));
      const list = normalize(m);
      if (list.length) cardExplicit.set(c.id, list);
    }

    // KP 种子（merged_into 链 ≤10 跳，环/目标缺失 → unknown）
    function kpSeed(kpId) {
      let id = kpId;
      const seen = new Set();
      for (let i = 0; i < 10 && id; i++) {
        if (seen.has(id)) return null;
        seen.add(id);
        const kp = kpById.get(id);
        if (!kp) return null;
        if (kp.domain_id) {
          const map = new Map();
          add(map, String(kp.domain_id), 1);
          const list = normalize(map);
          return list.length ? list : null;
        }
        id = kp.merged_into || null;
      }
      return null;
    }

    // 卡片 → 文档/条目映射（contextRef.documentId 与 extract→document 两路去重）
    function itemOfCard(c) {
      if (c.extract_id) {
        const ex = extractById.get(c.extract_id);
        if (ex?.document_id) return docById.get(ex.document_id)?.library_item_id || null;
      }
      if (c.document_id) return docById.get(c.document_id)?.library_item_id || null;
      return null;
    }

    // 条目直方图：关联卡片的显式领域（按卡去重；矛盾不重复计）
    const itemHist = new Map(); // itemId → {counts, cards}
    for (const c of cards) {
      if (c.is_deleted) continue;
      const exp = cardExplicit.get(c.id);
      if (!exp) continue;
      const itemId = itemOfCard(c);
      if (!itemId) continue;
      let h = itemHist.get(itemId);
      if (!h) { h = { counts: new Map(), cards: new Set() }; itemHist.set(itemId, h); }
      if (h.cards.has(c.id)) continue;
      h.cards.add(c.id);
      for (const x of exp) add(h.counts, x.code, x.w);
    }

    const results = new Map(); // `${type}\u0000${id}` → { type, id, list, lang, method, quality }

    // item
    for (const [itemId, h] of itemHist) {
      if (!itemById.has(itemId) || itemById.get(itemId).is_deleted) continue;
      const list = withResidual(normalize(h.counts), 3, 0.1);
      if (!list.length) continue;
      results.set(`library_item\u0000${itemId}`, {
        type: "library_item", id: itemId, list, lang: itemById.get(itemId).lang || null,
        method: "doc_cards", quality: h.cards.size < 3 ? "low_support" : "ok",
      });
    }

    // extract：显式卡聚合；无种子继承 item
    const extractHist = new Map();
    for (const c of cards) {
      if (c.is_deleted || !c.extract_id) continue;
      const exp = cardExplicit.get(c.id);
      if (!exp) continue;
      let h = extractHist.get(c.extract_id);
      if (!h) { h = new Map(); extractHist.set(c.extract_id, h); }
      for (const x of exp) add(h, x.code, x.w);
    }
    for (const ex of extracts) {
      if (ex.is_deleted) continue;
      let list = null;
      let method = "extract_cards";
      let quality = "ok";
      if (extractHist.has(ex.id)) {
        list = normalize(extractHist.get(ex.id));
      } else {
        const itemId = ex.document_id ? docById.get(ex.document_id)?.library_item_id : null;
        const it = itemId ? results.get(`library_item\u0000${itemId}`) : null;
        if (it) {
          list = it.list.map((x) => ({ ...x }));
          method = "doc_cards";
          quality = it.quality === "low_support" ? "low_support" : "ok";
        }
      }
      if (list && list.length) results.set(`extract\u0000${ex.id}`, { type: "extract", id: ex.id, list, lang: null, method, quality });
    }

    // card：显式 → kp → extract 显式种子（不是继承 item 的结果）→ item
    for (const c of cards) {
      if (c.is_deleted) continue;
      const exp = cardExplicit.get(c.id);
      if (exp) {
        results.set(`card\u0000${c.id}`, { type: "card", id: c.id, list: exp, lang: null, method: "card_domain", quality: "ok" });
        continue;
      }
      const kp = c.knowledge_point_id ? kpSeed(c.knowledge_point_id) : null;
      if (kp) {
        results.set(`card\u0000${c.id}`, { type: "card", id: c.id, list: kp, lang: null, method: "kp", quality: "ok" });
        continue;
      }
      if (c.extract_id && extractHist.has(c.extract_id)) {
        const list = normalize(extractHist.get(c.extract_id));
        if (list.length) {
          results.set(`card\u0000${c.id}`, { type: "card", id: c.id, list, lang: null, method: "extract_cards", quality: "ok" });
          continue;
        }
      }
      const itemId = itemOfCard(c);
      const it = itemId ? results.get(`library_item\u0000${itemId}`) : null;
      if (it) {
        results.set(`card\u0000${c.id}`, { type: "card", id: c.id, list: it.list.map((x) => ({ ...x })), lang: null, method: "doc_cards", quality: it.quality });
      }
    }

    // kp
    for (const kp of kps) {
      if (kp.is_deleted) continue;
      const list = kpSeed(kp.id);
      if (list) results.set(`kp\u0000${kp.id}`, { type: "kp", id: kp.id, list, lang: null, method: "kp", quality: "ok" });
    }

    // track：member=1 且未被 member=0 排除；udc 平分；language 轨道 → lang:<iso>
    const trackMembers = new Map();
    for (const tm of tms) {
      if (tm.is_deleted) continue;
      let set = trackMembers.get(tm.track_id);
      if (!set) { set = { in: new Set(), out: new Set() }; trackMembers.set(tm.track_id, set); }
      if (Number(tm.member) === 0) set.out.add(tm.library_item_id);
      else if (Number(tm.member) === 1) set.in.add(tm.library_item_id);
    }
    for (const [trackId, set] of trackMembers) {
      const track = trackById.get(trackId);
      if (!track || track.is_deleted) continue;
      const list = [];
      if (track.mode === "language" && track.lang) {
        list.push({ code: `lang:${String(track.lang)}`, level: "lang", w: 1 });
      } else {
        const codes = parseCodes(track.udc_codes_json, 8);
        if (codes.length) {
          const m = new Map();
          for (const code of codes) add(m, code, 1 / codes.length);
          list.push(...normalize(m));
        }
      }
      if (list.length) results.set(`track\u0000${trackId}`, { type: "track", id: trackId, list, lang: track.lang || null, method: "track", quality: "ok" });
    }

    let written = 0;
    let changed = 0;
    db.transaction(() => {
      for (const r of results.values()) {
        const prev = selectRow.get(r.type, r.id);
        const udcJson = JSON.stringify(r.list);
        const main = mainOf(r.list);
        const prevSame = prev && prev.udc_json === udcJson && Number(prev.stale) === 0;
        upsert.run(r.type, r.id, udcJson, main, r.lang, r.method, r.quality, attributionVersion, t, 0);
        written++;
        if (!prevSame) {
          changed++;
          // 任一次刷新使 udc_main 或权重改变 → 把该实体出现过的 day 标 dirty（含次领域变化）
          for (const row of eventDays.all(r.id, r.id, r.type, r.id)) {
            if (row.day) insertDirty.run(row.day, dirtyReason);
          }
        }
      }
      // 源实体缺失/软删：保留最后已知并标 stale，不删除行
      for (const row of allRows.all()) {
        const key = `${row.entity_type}\u0000${row.entity_id}`;
        if (results.has(key)) continue;
        const alive = row.entity_type === "card" ? cardById.get(row.entity_id) && !cardById.get(row.entity_id).is_deleted
          : row.entity_type === "extract" ? extractById.get(row.entity_id) && !extractById.get(row.entity_id).is_deleted
          : row.entity_type === "library_item" ? itemById.get(row.entity_id) && !itemById.get(row.entity_id).is_deleted
          : row.entity_type === "kp" ? kpById.get(row.entity_id) && !kpById.get(row.entity_id).is_deleted
          : row.entity_type === "track" ? trackById.get(row.entity_id) : null;
        if (!alive && Number(row.stale) !== 1) {
          db.prepare("UPDATE entity_domains SET stale = 1, quality = 'stale', resolved_at = ? WHERE entity_type = ? AND entity_id = ?")
            .run(t, row.entity_type, row.entity_id);
        }
      }
      db.prepare("INSERT INTO bdi_meta (key, value) VALUES ('domains_refreshed_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(String(t));
      db.prepare("INSERT INTO bdi_meta (key, value) VALUES ('attribution_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(String(attributionVersion));
    })();
    return { written, changed, total: results.size };
  }

  return { refreshAll, attributionVersion };
}

module.exports = { ATTRIBUTION_VERSION, createDomains };
