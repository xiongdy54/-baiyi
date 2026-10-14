// D158：方案条件在卡片浏览器表格侧的过滤。语义与会话组队逐条一致（GUIDE §6.8-5「表格侧语义」）：
// 来源书多选 IN；标签层级边界前缀、多值 OR（复用 tagFilterMatches——其单标签匹配经 tags.ts 的
// anyTagMatches/tagPathMatches 语义源，与会话侧主进程镜像 scopeTagMatches 由 d105-scope 闸门锁定同族）；
// 知识点按归并族、仅闪卡行命中；条件间 AND。
import { tagFilterMatches, type ParsedCardQuery } from "./cardQuery";

export interface SchemeFilter {
  books: Set<string> | null;    // null = 不限来源书
  tags: string[];               // [] = 不限标签
  kpFamily: Set<string> | null; // null = 不限知识点
}

export function buildSchemeFilter(input: {
  bookItemIds: string[];
  tags: string[];
  kpIds: string[];
  kpFamily: Set<string> | null; // 归并族尚未解析完成时传 null，回退为所选 id 本身（只会更少，不会更多）
}): SchemeFilter | null {
  const books = input.bookItemIds.length ? new Set(input.bookItemIds) : null;
  const tags = input.tags.map((t) => t.trim()).filter((t) => t !== "");
  const kpFamily = input.kpIds.length ? input.kpFamily ?? new Set(input.kpIds) : null;
  if (!books && tags.length === 0 && !kpFamily) return null;
  return { books, tags, kpFamily };
}

/** 方案标签条件的 ParsedCardQuery 形态——tagFilterMatches 只读 q.tag / q.tagNeg（调用形式适配，见 D158） */
function schemeTagQuery(tags: string[]): ParsedCardQuery {
  return { text: "", exclude: [], tag: tags };
}

export function cardMatchesScheme(
  f: SchemeFilter,
  row: { bookId: string | null; tags?: string[]; kpId?: string }
): boolean {
  if (f.books && !f.books.has(String(row.bookId || ""))) return false;
  if (f.tags.length && !tagFilterMatches(schemeTagQuery(f.tags), row.tags ?? [])) return false;
  if (f.kpFamily && !(row.kpId && f.kpFamily.has(row.kpId))) return false;
  return true;
}

export function extractMatchesScheme(
  f: SchemeFilter,
  libraryItemId: string | null | undefined,
  getTags: () => string[] // 惰性：只有方案含标签条件时才解析摘录行的 tagJson
): boolean {
  if (f.kpFamily) return false; // 合同：知识点条件仅闪卡行命中，摘录行不命中
  if (f.books && !f.books.has(String(libraryItemId || ""))) return false;
  if (f.tags.length) {
    const tags = getTags();
    if (!tagFilterMatches(schemeTagQuery(f.tags), tags)) return false;
  }
  return true;
}
