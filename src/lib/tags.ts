// v48.60（D101，设计稿 docs/design/CARD-SYSTEM-ANKI-ADAPTATION-D94.md §1）：
// 用户意图标签的唯一规则源（第四组织轴，与书/知识点/domain 正交）。
// 纯函数、零依赖——手动表单、批量打标、复习页打标、批注继承四处共用；
// CardLint L17 与本文件共享同一组常量（制卡原则单一事实源精神，§6.3.1）。
// 可被 esbuild 打包进测试与 prompt-lab vendor（禁 window/IPC 依赖）。

/** 层级分隔符（Anki 语法）；段内禁止出现半角冒号 */
export const TAG_SEP = "::";
/** 每卡标签数上限（超限 L17 info 提示，不阻断） */
export const TAG_MAX_PER_CARD = 8;
/** 单标签（完整层级路径）字符上限 */
export const TAG_MAX_LEN = 24;
/** 层级深度上限（段数） */
export const TAG_MAX_DEPTH = 3;

export type TagNormalizeResult = { ok: true; tag: string } | { ok: false; reason: string };

/**
 * 规范化单个标签：整体与每段首尾 strip；`::` 分层；段内禁半角冒号与控制字符；
 * 空段（`a::` / `::b` / `a::::b`）非法；单标签 ≤24 字、深度 ≤3。
 * 存储保留用户首次输入的写法；大小写在去重/匹配层处理（tagKey）。
 */
export function normalizeTag(raw: string): TagNormalizeResult {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: false, reason: "标签为空" };
  if (/[\u0000-\u001f\u007f]/.test(text)) return { ok: false, reason: "标签含控制字符" };
  const parts = text.split(TAG_SEP).map((p) => p.trim());
  if (parts.some((p) => !p)) return { ok: false, reason: "层级段不能为空" };
  for (const p of parts) {
    if (p.includes(":")) return { ok: false, reason: `「${p}」内不能再含半角冒号（层级用 ::）` };
  }
  if (parts.length > TAG_MAX_DEPTH) return { ok: false, reason: `层级超过 ${TAG_MAX_DEPTH} 层` };
  const tag = parts.join(TAG_SEP);
  if ([...tag].length > TAG_MAX_LEN) return { ok: false, reason: `标签超过 ${TAG_MAX_LEN} 字` };
  return { ok: true, tag };
}

/** 匹配/去重用的规范键：NFKC 折叠 + 小写（全链路大小写不敏感） */
export function tagKey(tag: string): string {
  return String(tag ?? "").normalize("NFKC").toLowerCase();
}

/** 归一化一组标签：逐个 normalizeTag，大小写不敏感去重（保留首个写法）。非法项丢弃不抛。 */
export function normalizeTags(list: unknown): string[] {
  const arr = Array.isArray(list) ? list : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of arr) {
    if (typeof raw !== "string") continue;
    const r = normalizeTag(raw);
    if (!r.ok) continue;
    const key = tagKey(r.tag);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r.tag);
  }
  return out;
}

/**
 * 层级边界前缀匹配（查询语义，§1.5）：`tag:考研` 命中 `考研` 与 `考研::英语`，
 * 不命中 `考研英语`（前缀必须落在 :: 边界或整串相等）；大小写不敏感。
 */
export function tagPathMatches(tag: string, prefix: string): boolean {
  const t = tagKey(tag);
  const p = tagKey(prefix);
  if (!t || !p) return false;
  return t === p || t.startsWith(p + TAG_SEP);
}

/** 一组标签中是否有命中层级前缀的项 */
export function anyTagMatches(tags: string[] | null | undefined, prefix: string): boolean {
  return (tags ?? []).some((t) => tagPathMatches(t, prefix));
}

/**
 * 并集加 / 差集删（写入口共用语义，§1.4）：加＝只增不减（已有该标签的卡跳过）；
 * 删＝按层级前缀语义移除（删 `考研` 连 `考研::英语` 一起删）。
 * 大小写不敏感判定，保留卡上既有写法。返回统计供 toast 如实报告。
 */
export function applyTagDelta(
  current: string[] | null | undefined,
  add: string[],
  remove: string[]
): { tags: string[]; added: number; removed: number } {
  const tags = [...(current ?? [])];
  let added = 0;
  for (const raw of add) {
    const r = normalizeTag(raw);
    if (!r.ok) continue;
    const key = tagKey(r.tag);
    if (tags.some((t) => tagKey(t) === key)) continue;
    tags.push(r.tag);
    added += 1;
  }
  let removed = 0;
  for (const raw of remove) {
    const r = normalizeTag(raw);
    if (!r.ok) continue;
    const before = tags.length;
    const kept = tags.filter((t) => !tagPathMatches(t, r.tag));
    if (kept.length !== before) removed += before - kept.length;
    tags.length = 0;
    tags.push(...kept);
  }
  return { tags, added, removed };
}

/** 批 A 词表条目（cards:listTags 输出；display 保留首次写法） */
export interface TagVocabEntry {
  display: string;
  cardCount: number;
  extractCount: number;
  lastUsedAt: number;
}

/** 合并两源词表（卡片 + 摘录批注）：按规范键合并计数，display 取最近使用一方的写法 */
export function mergeTagVocab(
  cards: Array<{ display: string; count: number; lastUsedAt: number }>,
  extracts: Array<{ display: string; count: number; lastUsedAt: number }>
): TagVocabEntry[] {
  const map = new Map<string, TagVocabEntry>();
  const put = (src: { display: string; count: number; lastUsedAt: number }, field: "cardCount" | "extractCount") => {
    const key = tagKey(src.display);
    if (!key) return;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, { display: src.display, cardCount: 0, extractCount: 0, lastUsedAt: src.lastUsedAt });
    }
    const e = map.get(key)!;
    e[field] += src.count;
    if (src.lastUsedAt > e.lastUsedAt || (src.lastUsedAt === e.lastUsedAt && field === "cardCount")) e.display = src.display;
  };
  for (const c of cards) put(c, "cardCount");
  for (const e of extracts) put(e, "extractCount");
  return [...map.values()].sort(
    (a, b) => b.cardCount + b.extractCount - (a.cardCount + a.extractCount) || a.display.localeCompare(b.display)
  );
}
