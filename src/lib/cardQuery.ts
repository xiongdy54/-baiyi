// v48.22（D58 §6.8-6）：卡片浏览器查询语法（**自研子集**，只参考 Anki 手册的功能描述，零代码搬运）。
// 纯函数、零依赖——可独立测试。
//
// 支持（v1）：
//   空格分隔（引号内保留空格）  "短语 in quotes"
//   负号排除                   -term / -kind:extract
//   字段前缀                   kind:card|extract · book:<书名子串> · status:<状态> · priority 比较
//   优先级比较                 priority<=30 / priority>=70 / priority=50
//   其余一切                   → 子串匹配（题面/答案/备注/前缀/来源/领域/标签/摘录正文）
export interface ParsedCardQuery {
  text: string;
  exclude: string[];
  kind?: "card" | "extract";
  book?: string;
  status?: string;
  priority?: { op: "<=" | ">=" | "<" | ">" | "="; value: number };
  /** -priority=N：不等于 N（等号没有可用的反向算子，单独存） */
  priorityNot?: number;
}

const KNOWN_FIELDS = ["kind", "book", "status", "priority"];
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
      if (field === "priority") {
        const pm = PRIORITY_RE.exec(body);
        if (pm) {
          const op = pm[1] as "<=" | ">=" | "<" | ">" | "=";
          const value = Number(pm[2]);
          if (!negated) q.priority = { op, value };
          else if (op === "=") q.priorityNot = value;
          else {
            const inv = { "<=": ">", ">=": "<", "<": ">=", ">": "<=" } as const;
            q.priority = { op: inv[op as keyof typeof inv], value };
          }
          continue;
        }
        texts.push(body);
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
