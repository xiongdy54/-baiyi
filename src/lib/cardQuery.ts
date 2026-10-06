// v48.22（D58 §6.8-6）：卡片浏览器查询语法（**自研子集**，只参考 Anki 手册的功能描述，零代码搬运）。
// 纯函数、零依赖——可独立测试。
//
// 支持（v1）：
//   空格分隔（引号内保留空格）  "短语 in quotes"
//   负号排除                   -term / -priority=N
//   字段前缀                   kind:card|extract · book:<书名子串> · status:<状态> · priority 比较
//   优先级比较                 priority<=30 / priority>=70 / priority=50
//   其余一切                   → 子串匹配（题面/答案/备注/前缀/来源/领域/标签/摘录正文）
// v48.60（D101 §6.8-6 v2）：
//   tag:<路径>                 层级边界前缀匹配（考研 命中 考研::英语 不命中 考研英语）；
//                              大小写不敏感；tag:"错题 本" 引号含空格；-tag: 排除；
//                              多个 tag: token 取 OR；卡片行/摘录行两 kind 通用（匹配由调用方做）
//   type:<卡形式>              匹配 card_type（大小写不敏感，qa/cloze/…），仅闪卡行
// v48.64（D108 §6.8-6 v3）＝布尔结构与通配（AST 求值）：
//   or（独立 token、大小写不敏感）取并，优先级低于隐式 AND（空格）
//   ( ) 分组括号——必须为独立 token（词内括号按普通字符，不破坏书名括号）
//   * 通配符——文本项与字段值含 * 时按通配模式匹配（*＝任意串、其余字面、不锚定）
//   负号统一为 NOT 算子——-book:/-status:/-type: 生效；-kind:/-priority<op> 由 v1/v2 的
//   「落 exclude 静默无效」（登记的保守落法；kind 取反三元实为死代码）升级为有效语义
//   语法优先级：括号 > NOT > AND（隐式空格）> or
//   无 or/括号的查询：AST 做等值变换（tag 正值归组 OR、单值字段取最后一次出现）≡ 扁平逐条 AND
//   含 or/括号的查询：纯布尔语义（tag 多值按 AND；消费端不做 kind 页签联动）
//   v3 顺带修复（实证，D108 ⑦）：闪卡侧曾对**整条原始查询串**做 hay.includes——任何含字段
//   前缀或多 token 的查询恒 false 全灭；v3 文本项逐词判定（多词＝AND、引号短语整串）
//   仍未实现：is:/prop:/note:/deck: 族、嵌套引号内括号、字段值内空白分组、对括号组的负号
//   （文档不得声称已支持）
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
  /** v48.64（D108）：布尔结构 AST（无 or/括号时＝等值变换后的全 AND 树） */
  ast?: QueryNode;
  /** v48.64（D108）：查询含 or/括号（消费端据此不做 kind 页签联动） */
  hasGroups?: boolean;
}

/** v48.64（D108）：查询 AST——and/or/not 组合节点与字段叶子 */
export type QueryNode =
  | { t: "and"; kids: QueryNode[] }
  | { t: "or"; kids: QueryNode[] }
  | { t: "not"; kid: QueryNode }
  | { t: "leaf"; leaf: QueryLeaf };

export type QueryLeaf =
  | { f: "text"; value: string }
  | { f: "kind"; value: "card" | "extract" }
  | { f: "book"; value: string }
  | { f: "status"; value: string }
  | { f: "tag"; value: string }
  | { f: "type"; value: string }
  | { f: "priority"; op: "<=" | ">=" | "<" | ">" | "="; value: number };

const KNOWN_FIELDS = ["kind", "book", "status", "priority", "tag", "type"];
const PRIORITY_RE = /^priority(<=|>=|<|>|=)(\d{1,3})$/;

interface QueryToken {
  text: string;
  /** token 内出现过引号（引号短语永远不当 or/括号） */
  quoted: boolean;
}

function tokenize(raw: string): QueryToken[] {
  const out: QueryToken[] = [];
  let cur = "";
  let curQuoted = false;
  let inQuote = false;
  const flush = () => {
    if (cur) out.push({ text: cur, quoted: curQuoted });
    cur = "";
    curQuoted = false;
  };
  for (const ch of String(raw ?? "")) {
    if (ch === '"') {
      inQuote = !inQuote;
      curQuoted = true;
      continue;
    }
    if (!inQuote && /\s/.test(ch)) {
      flush();
      continue;
    }
    cur += ch;
  }
  flush();
  return out;
}

type LexToken = { t: "(" } | { t: ")" } | { t: "or" } | { t: "term"; text: string; quoted: boolean };

function lex(tokens: QueryToken[]): LexToken[] {
  return tokens.map((tk) => {
    if (!tk.quoted && tk.text === "(") return { t: "(" as const };
    if (!tk.quoted && tk.text === ")") return { t: ")" as const };
    if (!tk.quoted && tk.text.toLowerCase() === "or") return { t: "or" as const };
    return { t: "term" as const, text: tk.text, quoted: tk.quoted };
  });
}

/** v48.64（D108）：与 CardBrowser.tsx / electron/db.js 的 foldSearch 同式（渲染层与主进程无法共享模块） */
export function foldQueryText(s: unknown): string {
  return String(s ?? "").normalize("NFKC").trim().toLowerCase();
}

const globCache = new Map<string, RegExp>();

/** v48.64（D108）：值匹配——含 * 按通配（*＝任意串、其余字面、不锚定），否则子串 */
export function valueMatches(hay: string, pattern: string): boolean {
  if (!pattern) return true;
  if (!pattern.includes("*")) return hay.includes(pattern);
  let re = globCache.get(pattern);
  if (!re) {
    const src = pattern
      .split("*")
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\s\\S]*");
    re = new RegExp(src);
    globCache.set(pattern, re);
  }
  return re.test(hay);
}

/** token → 叶子（含负号包裹）。返回 null＝该 token 不产生任何条件（空字段值，v1/v2 同为忽略） */
function leafFromTerm(text: string, quoted: boolean): QueryNode | null {
  const negated = !quoted && text.startsWith("-") && text.length > 1;
  const body = negated ? text.slice(1) : text;
  const leaf = leafFromBody(body);
  if (!leaf) return null;
  return negated ? { t: "not", kid: { t: "leaf", leaf } } : { t: "leaf", leaf };
}

function leafFromBody(body: string): QueryLeaf | null {
  // v48.64（D108）：无冒号比较式（priority<=30）优先——v1 文档声称此写法，实现从未接通（解析路径死路）
  const pm0 = PRIORITY_RE.exec(body);
  if (pm0) return { f: "priority", op: pm0[1] as "<=" | ">=" | "<" | ">" | "=", value: Number(pm0[2]) };
  const m = /^([A-Za-z]+):(.*)$/.exec(body);
  if (m && KNOWN_FIELDS.includes(m[1].toLowerCase())) {
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (!value) return null;
    if (field === "priority") {
      // priority:30 这种非比较写法按子串处理（不猜测语义，v1 同）
      const pm = PRIORITY_RE.exec(value);
      if (pm) return { f: "priority", op: pm[1] as "<=" | ">=" | "<" | ">" | "=", value: Number(pm[2]) };
      return { f: "text", value: body };
    }
    if (field === "tag") return { f: "tag", value };
    if (field === "type") return { f: "type", value: value.toLowerCase() };
    if (field === "kind") {
      const v = value.toLowerCase();
      // kind:foo 未知值按文本处理（v1 同）
      if (v === "card" || v === "extract") return { f: "kind", value: v };
      return { f: "text", value: body };
    }
    if (field === "book") return { f: "book", value };
    return { f: "status", value: value.toLowerCase() };
  }
  return { f: "text", value: body };
}

function andOf(kids: QueryNode[]): QueryNode | undefined {
  const real = kids.filter((k): k is QueryNode => k !== null);
  if (real.length === 0) return undefined;
  if (real.length === 1) return real[0];
  return { t: "and", kids: real };
}

/** 无 or/括号查询的等值构建：线性收集 → 单值字段取最后一次出现（模拟 v1/v2 覆盖语义）→ tag 正值归组 OR */
function buildFlatAst(lts: LexToken[]): { ast: QueryNode | undefined; kindSeen: boolean } {
  const leaves: QueryNode[] = [];
  let kindSeen = false;
  for (const lt of lts) {
    if (lt.t !== "term") continue;
    const node = leafFromTerm(lt.text, lt.quoted);
    if (node) leaves.push(node);
    const body = lt.text.startsWith("-") && lt.text.length > 1 ? lt.text.slice(1) : lt.text;
    const m = /^([A-Za-z]+):/.exec(body);
    if (m && m[1].toLowerCase() === "kind") kindSeen = true;
  }
  // 单值槽位取最后一次出现：kind/book/status/type/priority 比较式、priority NOT 等式
  const lastOf = (pred: (n: QueryNode) => boolean) => {
    let last: QueryNode | null = null;
    for (const n of leaves) if (pred(n)) last = n;
    return last;
  };
  const isLeafOf = (n: QueryNode) => n.t === "leaf" || n.t === "not";
  const keep = new Set<QueryNode>();
  const slotPreds: ((n: QueryNode) => boolean)[] = [
    (n) => isLeafOf(n) && leafField(n) === "kind",
    (n) => isLeafOf(n) && leafField(n) === "book",
    (n) => isLeafOf(n) && leafField(n) === "status",
    (n) => isLeafOf(n) && leafField(n) === "type",
    (n) => n.t === "leaf" && n.leaf.f === "priority",
    (n) => n.t === "not" && n.kid.t === "leaf" && n.kid.leaf.f === "priority",
  ];
  for (const sp of slotPreds) {
    const last = lastOf(sp);
    if (last) keep.add(last);
  }
  // tag 正值归组 OR（v1/v2 多值 OR 语义）；tagNeg 各自 NOT 保留（全部不命中 ≡ AND(NOT…)）
  const tagPositives = leaves.filter((n) => n.t === "leaf" && n.leaf.f === "tag");
  const tagGroup: QueryNode | null =
    tagPositives.length === 0 ? null : tagPositives.length === 1 ? tagPositives[0] : { t: "or", kids: tagPositives };
  const kids: QueryNode[] = [];
  let tagPlaced = false;
  for (const n of leaves) {
    if (n.t === "leaf" && n.leaf.f === "tag") {
      if (!tagPlaced && tagGroup) {
        kids.push(tagGroup);
        tagPlaced = true;
      }
      continue; // 其余 tag 正值由组承载
    }
    // 非首位单值槽位 leaf（被最后一次覆盖）丢弃
    const inSlot = slotPreds.some((sp) => sp(n));
    if (inSlot && !keep.has(n)) continue;
    kids.push(n);
  }
  return { ast: andOf(kids), kindSeen };
}

function leafField(n: QueryNode): string | null {
  if (n.t === "leaf") return n.leaf.f;
  if (n.t === "not" && n.kid.t === "leaf") return n.kid.leaf.f;
  return null;
}

/** 递归下降：orExpr := andExpr (or andExpr)* ；andExpr := atom* ；atom := ( orExpr ) | term。
 *  宽容解析：缺右括号自动闭合、孤儿右括号丢弃、or 缺右操作数丢弃 or。
 *  优先级：括号 > AND（隐式空格）> or——parseAnd 吃尽相邻 atom，parseOr 只在 or 处分流。 */
function buildGroupAst(lts: LexToken[]): QueryNode | undefined {
  let pos = 0;
  const peek = () => lts[pos];
  const parseOr = (): QueryNode | null => {
    const parts: QueryNode[] = [];
    const first = parseAnd();
    if (first) parts.push(first);
    while (peek()?.t === "or") {
      pos++;
      const next = parseAnd();
      if (next) parts.push(next);
    }
    if (parts.length === 0) return null;
    return parts.length === 1 ? parts[0] : { t: "or", kids: parts };
  };
  const parseAnd = (): QueryNode | null => {
    const kids: QueryNode[] = [];
    while (true) {
      const tk = peek();
      if (!tk || tk.t === "or" || tk.t === ")") break;
      pos++;
      if (tk.t === "(") {
        const inner = parseOr();
        if (inner) kids.push(inner);
        if (peek()?.t === ")") pos++; // 缺右括号时到底即止（宽容闭合）
        continue;
      }
      const node = leafFromTerm(tk.text, tk.quoted);
      if (node) kids.push(node);
    }
    if (kids.length === 0) return null;
    return kids.length === 1 ? kids[0] : { t: "and", kids };
  };
  return parseOr() ?? undefined;
}

export function parseCardQuery(raw: string): ParsedCardQuery {
  const q: ParsedCardQuery = { text: "", exclude: [] };
  const texts: string[] = [];
  const lts = lex(tokenize(raw));
  const hasGroups = lts.some((lt) => lt.t === "(" || lt.t === ")" || lt.t === "or");
  for (const lt of lts) {
    if (lt.t !== "term") continue; // or/括号 token 不参与扁平结构（字段收集照旧只认 term）
    const token = lt.text;
    const negated = !lt.quoted && token.startsWith("-") && token.length > 1;
    const body = negated ? token.slice(1) : token;
    // v48.64（D108）：无冒号比较式（priority<=30）与 AST 同路——v1 文档声称此写法，实现从未接通
    const pm0 = PRIORITY_RE.exec(body);
    if (pm0) {
      if (!negated) q.priority = { op: pm0[1] as "<=" | ">=" | "<" | ">" | "=", value: Number(pm0[2]) };
      else q.exclude.push(body);
      continue;
    }
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
      // v48.60（D101）：type: 卡形式。-type: 在 v1/v2 落 exclude（不静默改义）；v3 起为有效 NOT（D108）
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
  // v48.64（D108）：AST 构建——扁平结构保持原样（extractScopeConditions 等消费点不变），
  // 行判定统一走 ast（CardBrowser 不再自建分散过滤链）
  if (hasGroups) {
    q.hasGroups = true;
    const ast = buildGroupAst(lts);
    if (ast) q.ast = ast;
  } else {
    const { ast } = buildFlatAst(lts);
    if (ast) q.ast = ast;
  }
  return q;
}

/** v48.64（D108）：行谓词表——两种行各自构造，evalQueryNode 查表求值 */
export interface QueryPredicates {
  text: (v: string) => boolean;
  kind: (v: "card" | "extract") => boolean;
  book: (v: string) => boolean;
  status: (v: string) => boolean;
  tag: (v: string) => boolean;
  type: (v: string) => boolean;
  priority: (op: "<=" | ">=" | "<" | ">" | "=", value: number) => boolean;
}

export function evalQueryNode(node: QueryNode | undefined, p: QueryPredicates): boolean {
  if (!node) return true;
  switch (node.t) {
    case "and":
      return node.kids.every((k) => evalQueryNode(k, p));
    case "or":
      return node.kids.some((k) => evalQueryNode(k, p));
    case "not":
      return !evalQueryNode(node.kid, p);
    case "leaf": {
      const l = node.leaf;
      if (l.f === "text") return p.text(l.value);
      if (l.f === "kind") return p.kind(l.value);
      if (l.f === "book") return p.book(l.value);
      if (l.f === "status") return p.status(l.value);
      if (l.f === "tag") return p.tag(l.value);
      if (l.f === "type") return p.type(l.value);
      return p.priority(l.op, l.value);
    }
  }
}

function priorityPredicate(rowPriority: number | string | null | undefined) {
  return (op: "<=" | ">=" | "<" | ">" | "=", value: number): boolean => {
    const p = Number(rowPriority) || 0;
    if (op === "<=") return p <= value;
    if (op === ">=") return p >= value;
    if (op === "<") return p < value;
    if (op === ">") return p > value;
    return p === value;
  };
}

/** v48.64（D108）：闪卡行数据（字段清单与 CardBrowser 过滤链逐字同源） */
export interface CardQueryCardRow {
  frontMarkdown?: string | null;
  backMarkdown?: string | null;
  noteText?: string | null;
  contextPrefix?: string | null;
  docTitle?: string | null;
  domain?: string[] | null;
  tags?: string[] | null;
  cardType?: string | null;
  status?: string | null;
  leechSuspended?: boolean;
  fsrsState?: string | null;
  priority?: number | string | null;
}

export function makeCardPredicates(row: CardQueryCardRow): QueryPredicates {
  const hay = [
    row.frontMarkdown,
    row.backMarkdown,
    row.noteText,
    row.contextPrefix || "",
    row.docTitle || "",
    ...(row.domain ?? []),
    ...(row.tags ?? [])
  ]
    .join("\n")
    .normalize("NFKC")
    .toLowerCase();
  return {
    text: (v) => valueMatches(hay, foldQueryText(v)),
    kind: (v) => v === "card",
    book: (v) => valueMatches(foldQueryText(String(row.docTitle || "")), foldQueryText(v)),
    status: (v) => {
      if (v === "archived" || v === "已归档") return row.status === "archived";
      const s = row.leechSuspended ? "suspended" : row.fsrsState ?? "new";
      return String(s).toLowerCase() === v;
    },
    tag: (v) =>
      // v48.64（D108）：tag 值含 * 时按通配对标签数组逐项匹配；否则层级边界前缀语义（v1/v2 同）
      v.includes("*")
        ? (row.tags ?? []).some((t) => valueMatches(String(t).toLowerCase(), foldQueryText(v)))
        : anyTagMatches(row.tags ?? [], v),
    type: (v) => String(row.cardType || "").toLowerCase() === v,
    priority: priorityPredicate(row.priority)
  };
}

/** v48.64（D108）：闪卡行整体判定（AST 求值；ast 缺省＝无条件恒真） */
export function cardRowMatches(q: ParsedCardQuery, row: CardQueryCardRow): boolean {
  return evalQueryNode(q.ast, makeCardPredicates(row));
}

/** v48.64（D108）：摘录行数据 */
export interface CardQueryExtractRow {
  contentMarkdown?: string | null;
  docTitle?: string | null;
  status?: string | null;
  tagJson?: string | null;
  priority?: number | string | null;
}

export function makeExtractPredicates(row: CardQueryExtractRow): QueryPredicates {
  const hay = `${row.contentMarkdown ?? ""}\n${row.docTitle ?? ""}`.toLowerCase();
  return {
    text: (v) => valueMatches(hay, foldQueryText(v)),
    kind: (v) => v === "extract",
    book: (v) => valueMatches(foldQueryText(String(row.docTitle || "")), foldQueryText(v)),
    status: (v) => String(row.status ?? "open").toLowerCase() === v,
    tag: (v) =>
      v.includes("*")
        ? extractTagsOf(row).some((t) => valueMatches(String(t).toLowerCase(), foldQueryText(v)))
        : anyTagMatches(extractTagsOf(row), v),
    // 摘录行无卡形式——type: 对摘录行恒不命中（D108 ⑦：type: 查询摘录页签恒空＝诚实语义）
    type: () => false,
    priority: priorityPredicate(row.priority)
  };
}

/** v48.64（D108）：摘录行整体判定 */
export function extractRowMatches(q: ParsedCardQuery, row: CardQueryExtractRow): boolean {
  return evalQueryNode(q.ast, makeExtractPredicates(row));
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
