// v48.22（D58 §6.8-6）：卡片浏览器查询语法（**自研子集**，只参考 Anki 手册的功能描述，零代码搬运）。
// 纯函数、零依赖——可独立测试。
//
// 支持（v1）：
//   空格分隔（引号内保留空格）  "短语 in quotes"
//   负号排除                   -term / -kind:extract
//   字段前缀                   kind:card|extract · book:<书名子串> · status:<状态> · priority 比较
//   优先级比较                 priority<=30 / priority>=70 / priority=50
//   其余一切                   → 子串匹配（题面/答案/备注/前缀/来源/领域/标签/摘录正文）
// v48.60（D101 §6.8-6 v2）：
//   tag:<路径>                 层级边界前缀匹配（考研 命中 考研::英语 不命中 考研英语）；
//                              大小写不敏感；tag:"错题 本" 引号含空格；-tag: 排除；
//                              多个 tag: token 取 OR；卡片行/摘录行两 kind 通用（匹配由调用方做）
//   type:<卡形式>              匹配 card_type（大小写不敏感，qa/cloze/…），仅闪卡行
//   仍未实现                   or / 括号 / 通配符 / -book: / -status: / -type: 取反（文档不得声称已支持）
import { anyTagMatches } from "./tags";

export interface ParsedCardQuery {
  text: string;
  exclude: string[];
  kind?: "card" | "extract";
  book?: string;
  status?: string;
  priority?: { op: "<=" | ">=" | "<" | ">" | "="; value: number };
  /** -priority=N：不等于 N（等号没有可用的反向算子，单独存） */
  priorityNot?: number;
  /** v48.60（D101）：tag: 肯定/否定清单（多值 OR / 全部排除） */
  tag?: string[];
  tagNeg?: string[];
  /** v48.60（D101）：type: 卡形式（小写） */
  type?: string;
}

const KNOWN_FIELDS = ["kind", "book", "status", "priority", "tag", "type"];
const PRIORITY_RE = /^priority(<=|>=|<|>|=)(\d{1,3})$/;

function tokenize(raw: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (const ch of String(raw ?? "")) {
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && /\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

export function parseCardQuery(raw: string): ParsedCardQuery {
  const q: ParsedCardQuery = { text: "", exclude: [] };
  const texts: string[] = [];
  for (const token of tokenize(raw)) {
    const negated = token.startsWith("-") && token.length > 1;
    const body = negated ? token.slice(1) : token;
    const m = /^([A-Za-z]+):(.*)$/.exec(body);
    if (m && KNOWN_FIELDS.includes(m[1].toLowerCase())) {
      const field = m[1].toLowerCase();
      const value = m[2].trim();
      if (!value) {
        if (negated) q.exclude.push(`${field}:`);
        continue;
      }
      if (field === "priority") {
        const pm = PRIORITY_RE.exec(body);
        if (pm) {
          if (!negated) q.priority = { op: pm[1] as "<=" | ">=" | "<" | ">" | "=", value: Number(pm[2]) };
          else q.exclude.push(body);
          continue;
        }
        // priority:30 这种非比较写法按子串处理（不猜测语义）
        texts.push(body);
        continue;
      }
      // v48.60（D101）：tag: 肯定/否定（引号内空格已在 tokenize 保留；多值 OR，调用方求并）。
      // 必须在通用「负号落 exclude」分支**之前**——否则 -tag: 会被静默吞掉（d101-tags T4 实测）。
      if (field === "tag") {
        if (negated) (q.tagNeg ??= []).push(value);
        else (q.tag ??= []).push(value);
        continue;
      }
      // v48.60（D101）：type: 卡形式。-type: 未实现，落 exclude（与 -book: 同一处理，不静默改义）
      if (field === "type") {
        if (!negated) q.type = value.toLowerCase();
        else q.exclude.push(body);
        continue;
      }
      if (negated) {
        q.exclude.push(body);
        continue;
      }
      if (field === "kind") {
        const v = value.toLowerCase();
        if (v === "card" || v === "extract") {
          // 负号取反：-kind:extract ≡ kind:card（不留静默无效的 token）
          q.kind = negated ? (v === "card" ? "extract" : "card") : v;
        } else texts.push(body);
        continue;
      }
      if (field === "book") {
        q.book = value;
        continue;
      }
      q.status = value.toLowerCase();
      continue;
    }
    if (negated) q.exclude.push(body);
    else texts.push(body);
  }
  q.text = texts.join(" ").trim();
  return q;
}

/** 摘录是否命中（正文 + 来源书名；负号与字段在调用方按同一 parse 结果处理） */
export function extractMatches(q: ParsedCardQuery, extract: { contentMarkdown?: string; docTitle?: string; status?: string }): boolean {
  const text = `${extract.contentMarkdown ?? ""}\n${extract.docTitle ?? ""}`;
  return textMatches(q, text) && statusMatches(q, String(extract.status ?? "open"));
}

/** 通用文本命中：主串（已折叠）+ 负号排除 */
export function textMatches(q: ParsedCardQuery, haystack: string): boolean {
  const hay = haystack.toLowerCase();
  if (q.text && !hay.includes(q.text.toLowerCase())) return false;
  for (const ex of q.exclude) {
    if (!ex || ex.includes(":")) continue; // 形如 kind:xxx 的负号由调用方按类别处理
    if (hay.includes(ex.toLowerCase())) return false;
  }
  return true;
}

export function statusMatches(q: ParsedCardQuery, status: string): boolean {
  if (!q.status) return true;
  return status.toLowerCase() === q.status;
}

/** v48.60（D101）：摘录行 tagJson（主进程透传的原始 JSON 串）→ 标签数组（坏 JSON / 非串元素回落丢弃） */
export function extractTagsOf(row: { tagJson?: string | null }): string[] {
  if (!row.tagJson) return [];
  try {
    const v = JSON.parse(row.tagJson);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** v48.60（D101）：tag: / -tag: 对一组标签的判定（多值 OR；否定＝全部不命中） */
export function tagFilterMatches(q: ParsedCardQuery, tags: string[] | null | undefined): boolean {
  if (q.tag?.length && !q.tag.some((t) => anyTagMatches(tags ?? [], t))) return false;
  if (q.tagNeg?.length && q.tagNeg.some((t) => anyTagMatches(tags ?? [], t))) return false;
  return true;
}

/** v48.61（D105，D94 设计稿 §3.4）：「用当前查询创建」——从查询文本提取 `book:` / `tag:` 条件转结构化。
 *  供筛选牌组保存时合并进 scope（bookItemIds 由调用方按书名子串解析为 libraryItemId）；
 *  负号排除（-tag:）不提取——排除语义 scope v1 不承载，如实丢弃而非静默反转。 */
export function extractScopeConditions(query: string): { tags: string[]; bookNames: string[] } {
  const parsed = parseCardQuery(query);
  return { tags: [...(parsed.tag ?? [])], bookNames: parsed.book ? [parsed.book] : [] };
}
