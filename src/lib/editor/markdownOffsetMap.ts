// 源 markdown 偏移 ↔ 读态渲染 DOM 位置的双向映射纯函数（D95 §C.3）。
// 不变式（§C.1）：quote_range_json / contextRef.parentRange / viewRanges 仍是 content_markdown
// 的**源字符偏移**，零迁移；写侧重映射链（electron/annotationRange.js）零改动。本模块只负责
// 「渲染出来的 DOM」与「源偏移」之间的换算，让既有偏移数据在 markdown 渲染读态下继续可用。
//
// 解析器：remark-parse ^11（与 react-markdown 10 内部同版本同构造，直接依赖声明固定）。
// 每个文本承载叶带 position.start.offset / end.offset（原始源区间），而叶 value 是**解码后**
// 文本（反斜杠转义、字符引用已解）——段内长度可能不等，按 CommonMark 两类构造逐 run 对齐。
// 解码直接复用 micromark 同款工具（decode-named-character-reference /
// micromark-util-decode-numeric-character-reference，remark 生态的传递依赖），保证与解析器逐字节一致。
import { unified, type Plugin } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Root, Content, Parent } from "mdast";
import { defaultSchema } from "hast-util-sanitize";
import { decodeNamedCharacterReference } from "decode-named-character-reference";
import { decodeNumericCharacterReference } from "micromark-util-decode-numeric-character-reference";

/** 读态渲染的 mdast 解析（与 react-markdown 读态同族同选项；导出供映射单测复用同一解析）。
 *  注意两点：remarkSoftBreaks 是 tree transform，只在 run 阶段执行，单 parse 不触发；
 *  runSync 必须把带 value 的 file 传回去——分离调用 runSync(parse()) 时 VFile 不会自动携带，
 *  而插件的源切片基准正是 file.value。 */
export function parseForMap(markdown: string): Root {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkSoftBreaks);
  return processor.runSync(processor.parse(markdown), { value: markdown }) as Root;
}

/**
 * v1.4 软换行＝可见换行（用户反馈「编辑后换行消失」）：把段内 text 叶按 \n 拆成
 * text + break + text。**自写而不用 remark-breaks**——它经 mdast-util-find-and-replace 替换，
 * 拆出的节点不带 position，而源偏移映射（本模块）依赖叶级 position。这里以原始源切片为基准
 * 逐段重算 offset：raw 与 decoded 在 \n 处必然对齐（反斜杠转义与字符引用都不跨换行），
 * value 沿用解码值分段，break 的源区间＝那 1 个 \n 字符（与既有 br↔break 配对口径一致）。
 * code/inlineCode 的 value 与一切非 text 节点不动；空行本就成段，不经此处。
 * line/column 仅给占位（映射契约只用 offset；hast 渲染不消费 position）。
 */
export const remarkSoftBreaks: Plugin<[]> = function () {
  return (tree, file) => {
    const raw = typeof file.value === "string" ? file.value : String(file.value ?? "");
    const walk = (parent: Parent) => {
      if (!Array.isArray(parent.children)) return;
      const next: Content[] = [];
      for (const child of parent.children) {
        const pos = child.position;
        if (
          child.type === "text" && child.value.includes("\n") && pos &&
          typeof pos.start.offset === "number" && typeof pos.end.offset === "number"
        ) {
          const s = pos.start.offset;
          const rawParts = raw.slice(s, pos.end.offset).split("\n");
          const valParts = child.value.split("\n");
          if (rawParts.length === valParts.length) {
            let off = s;
            rawParts.forEach((rp, i) => {
              if (i > 0) {
                next.push({ type: "break", position: { start: { line: 1, column: 1, offset: off }, end: { line: 1, column: 1, offset: off + 1 } } });
                off += 1;
              }
              if (rp.length > 0) {
                next.push({ type: "text", value: valParts[i], position: { start: { line: 1, column: 1, offset: off }, end: { line: 1, column: 1, offset: off + rp.length } } });
                off += rp.length;
              }
            });
            continue;
          }
          // raw/decoded 段数不一致（理论不可达）：整叶放弃拆分，回落 CommonMark 空格语义
        }
        next.push(child);
        if (Array.isArray((child as Parent).children)) walk(child as Parent);
      }
      parent.children = next;
    };
    walk(tree as Parent);
  };
};

/**
 * 读态 sanitize schema（D95 §C 已知坑的最小放行）：rehype 管线固定为
 * rehype-raw → rehype-sanitize → rehype-katex（sanitize 先于 katex，katex 输出不参与净化），
 * 须保证到 katex 替换为止这些构造存活：gfm 任务列表的 className、表格对齐 align、
 * remark-math 的 math-inline/math-display/language-math 类。
 */
export const extractSanitizeSchema: typeof defaultSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    li: [...(defaultSchema.attributes?.li ?? []), ["className", "task-list-item"]],
    ul: [...(defaultSchema.attributes?.ul ?? []), ["className", "contains-task-list"]],
    ol: [...(defaultSchema.attributes?.ol ?? []), ["className", "contains-task-list"]],
    th: [...(defaultSchema.attributes?.th ?? []), "align"],
    td: [...(defaultSchema.attributes?.td ?? []), "align"],
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", /^language-./, "math-inline", "math-display"]
    ]
  }
};

// ---------- 段内 raw↔decoded 逐 run 对齐 ----------

const ASCII_PUNCT = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;
const isAsciiPunct = (ch: string | undefined) => !!ch && ch.length === 1 && ASCII_PUNCT.test(ch);

/**
 * raw[i] 起是否一个（remark 口径的）字符引用；是则返回解码字符与其 raw 长度。
 * 覆盖两类：`&#dd;`/`&#xhh;` 数字引用、`&name;` 命名引用（实测本版 remark-parse：
 * 无分号的 `&notit;` 原样保留，不做传统无分号引用解码）。非法引用返回 null——调用方按字面 1:1。
 */
function decodeCharRefAt(raw: string, i: number): { char: string; len: number } | null {
  if (raw[i] !== "&") return null;
  const rest = raw.slice(i + 1);
  const dec = /^#([0-9]+);/.exec(rest);
  const hex = /^#[xX]([0-9a-fA-F]+);/.exec(rest);
  if (dec || hex) {
    const m = (dec ?? hex)!;
    const char = decodeNumericCharacterReference(m[1], dec ? 10 : 16);
    return { char, len: 1 + m[0].length };
  }
  const named = /^([a-zA-Z][a-zA-Z0-9]{0,47});/.exec(rest);
  if (named) {
    const decoded = decodeNamedCharacterReference(named[1]);
    if (decoded) return { char: decoded, len: 1 + named[0].length };
  }
  return null;
}

/** 一个对齐 run：r = raw 长度，d = decoded 长度 */
interface AlignRun {
  r: number;
  d: number;
}

/**
 * 对一段文本叶的原始切片与解码 value 构造 run 表；逐字复算不上即判 null（该段 unmappable）。
 * 纯确定性：字符引用优先 → 反斜杠转义 → 字面 1:1；连续 1:1 合并成一个 run（缩短查询步进表）。
 */
function buildRuns(raw: string, value: string): AlignRun[] | null {
  const runs: AlignRun[] = [];
  let ri = 0;
  let vi = 0;
  while (ri < raw.length) {
    if (vi >= value.length) return null;
    const ch = raw[ri];
    if (ch === "\\" && isAsciiPunct(raw[ri + 1]) && value[vi] === raw[ri + 1]) {
      runs.push({ r: 2, d: 1 });
      ri += 2;
      vi += 1;
      continue;
    }
    if (ch === "&") {
      const ref = decodeCharRefAt(raw, ri);
      if (ref && ref.char.length > 0 && value.startsWith(ref.char, vi)) {
        runs.push({ r: ref.len, d: ref.char.length });
        ri += ref.len;
        vi += ref.char.length;
        continue;
      }
    }
    if (raw[ri] === value[vi]) {
      const last = runs[runs.length - 1];
      if (last && last.r === last.d) {
        // 连续 1:1 合并进上一个 run（两侧同长，同步增长）
        last.r += 1;
        last.d += 1;
      } else runs.push({ r: 1, d: 1 });
      ri += 1;
      vi += 1;
      continue;
    }
    return null;
  }
  if (vi !== value.length) return null;
  return runs;
}

// ---------- 映射表 ----------

/** 段记录：一个 DOM 文本节点 ↔ 一个 mdast 文本承载叶的源区间 */
export interface OffsetSegment {
  /** 原始源区间（含转义/字符引用等 raw 字符） */
  sStart: number;
  sEnd: number;
  /** DOM 文本节点 */
  textNode: Text;
  /** 解码后长度（= textNode.data.length） */
  dLen: number;
  /** DOM 文本节点开头的无源前缀长度（任务列表复选框后 remark-rehype 注入的空格，经 rehype-raw
   *  的 parse 往返与本叶文本合并成单节点；该前缀在源文没有对应字符） */
  decShift: number;
  /** 段内对齐 run 表与两个坐标系的前缀和（null = 配对校验失败的 unmappable 段） */
  runs: AlignRun[] | null;
  cumR: number[] | null;
  cumD: number[] | null;
}

export interface OffsetMap {
  source: string;
  root: Node | null;
  /** 可映射段（按 sStart 升序；unmappable 段不在其中——换算一律按缝隙吸附处理） */
  segments: OffsetSegment[];
  /** 顶层块（mdast root 直接子节点）的源区间，供块级焦点落点（§D.2 P0） */
  blockRanges: Array<{ start: number; end: number }>;
  /** 已配对且可映射段，domToSrc 精确反查用 */
  byNode: Map<Text, OffsetSegment>;
  /** unmappable 节点（KaTeX 输出、游离节点、配对失败段等）→ 最近已映射边界 */
  boundaries: Map<Node, { before: number | null; after: number | null }>;
}

const EMPTY_BOUNDARIES = { before: null, after: null };

function emptyMap(source: string, root: Node | null): OffsetMap {
  return { source, root, segments: [], blockRanges: [], byNode: new Map(), boundaries: new Map() };
}

type DomEntry = { kind: "text"; node: Text } | { kind: "br"; node: Element };

/** mdast 文本承载叶：text / inlineCode / 代码块的 value、break（硬换行） */
type MdLeaf =
  | { kind: "text" | "inlineCode" | "code"; value: string; start: number; end: number }
  | { kind: "break"; start: number; end: number };

function isKatex(n: Node): boolean {
  let cur: Node | null = n.nodeType === 1 ? n : n.parentElement;
  while (cur) {
    if (cur.nodeType === 1 && (cur as Element).classList.contains("katex")) return true;
    cur = cur.parentElement;
  }
  return false;
}

/**
 * 按文档序收集 root 内的 Text 与 <br>。
 * all = 全量（供 unmappable 节点的边界定位）；pairable = 可配对节点；
 * skipped = KaTeX 输出子树（.katex）内的节点——绘制层不可映射，但点击/划选要按最近边界判。
 */
function collectDomEntries(root: Node): { all: Node[]; pairable: DomEntry[]; skipped: Node[] } {
  const all: Node[] = [];
  const pairable: DomEntry[] = [];
  const skipped: Node[] = [];
  // NodeFilter 数值常量：1 = SHOW_ELEMENT，4 = SHOW_TEXT（不经全局 NodeFilter，node 环境可测）
  const walker = root.ownerDocument!.createTreeWalker(root, 1 | 4);
  let cur = walker.nextNode();
  while (cur) {
    all.push(cur);
    if (isKatex(cur)) skipped.push(cur);
    else if (cur.nodeType === 3) pairable.push({ kind: "text", node: cur as Text });
    else if (cur.nodeType === 1 && (cur as Element).tagName === "BR") pairable.push({ kind: "br", node: cur as Element });
    cur = walker.nextNode();
  }
  return { all, pairable, skipped };
}

/** 收集 mdast 文本承载叶（前序 = 文档序）；math/inlineMath/image/html 等非文本承载节点跳过 */
function collectLeaves(node: Root | Content, out: MdLeaf[]): void {
  const kids = (node as { children?: Content[] }).children;
  if (Array.isArray(kids)) {
    for (const child of kids) collectLeaves(child, out);
    return;
  }
  const pos = node.position;
  if (!pos || pos.start.offset == null || pos.end.offset == null) return;
  const start = pos.start.offset;
  const end = pos.end.offset;
  if (node.type === "text") {
    if (node.value) out.push({ kind: "text", value: node.value, start, end });
  } else if (node.type === "inlineCode" || node.type === "code") {
    if (node.value) out.push({ kind: node.type, value: node.value, start, end });
  } else if (node.type === "break") {
    out.push({ kind: "break", start, end });
  }
}

/** 段内 raw 偏移 → decoded 偏移（多字符 run 内部一律吸附到该 run 的解码端点） */
function rawToDec(seg: OffsetSegment, rawOff: number): number {
  if (!seg.runs || !seg.cumR || !seg.cumD) return Math.max(0, Math.min(rawOff, seg.dLen));
  const off = Math.max(0, Math.min(rawOff, seg.cumR[seg.cumR.length - 1]));
  for (let k = 0; k < seg.runs.length; k++) {
    if (off <= seg.cumR[k + 1]) {
      const local = off - seg.cumR[k];
      return seg.cumD[k] + Math.min(local, seg.runs[k].d);
    }
  }
  return seg.cumD[seg.cumD.length - 1];
}

/** 段内 decoded 偏移 → raw 偏移（对称规则；压缩 run（r≠d）内非起点位置一律吸附到 run 尾） */
function decToRaw(seg: OffsetSegment, decOff: number): number {
  if (!seg.runs || !seg.cumR || !seg.cumD) return Math.max(0, Math.min(decOff, seg.sEnd - seg.sStart));
  const off = Math.max(0, Math.min(decOff, seg.cumD[seg.cumD.length - 1]));
  for (let k = 0; k < seg.runs.length; k++) {
    if (off <= seg.cumD[k + 1]) {
      const local = off - seg.cumD[k];
      if (seg.runs[k].r === seg.runs[k].d) return seg.cumR[k] + local;
      return local === 0 ? seg.cumR[k] : seg.cumR[k + 1];
    }
  }
  return seg.cumR[seg.cumR.length - 1];
}

function makeSegment(
  sStart: number,
  sEnd: number,
  textNode: Text,
  runs: AlignRun[] | null,
  decShift = 0
): OffsetSegment {
  if (!runs) {
    return { sStart, sEnd, textNode, dLen: textNode.data.length, decShift, runs: null, cumR: null, cumD: null };
  }
  const cumR = [0];
  const cumD = [0];
  for (const run of runs) {
    cumR.push(cumR[cumR.length - 1] + run.r);
    cumD.push(cumD[cumD.length - 1] + run.d);
  }
  return { sStart, sEnd, textNode, dLen: textNode.data.length, decShift, runs, cumR, cumD };
}

/** mdast 叶在渲染 DOM 侧的文本口径（mdast-util-to-hast 惯例：块代码 value 尾补一个 \n，text/inlineCode 原样） */
function leafDomValue(leaf: Extract<MdLeaf, { kind: "text" | "inlineCode" | "code" }>): string {
  return leaf.kind === "code" ? `${leaf.value}\n` : leaf.value;
}

/**
 * 建表（换卡/内容变化时重建一次）：解析 + DOM/叶配对 + 段表。
 * 配对失败（value 对不上）、KaTeX 输出、游离 <br> 等按 §C.3 降级为 unmappable，绝不整卡失效。
 */
export function buildOffsetMap(markdown: string, root: Node | null): OffsetMap {
  const source = String(markdown ?? "");
  if (!root || !source) return emptyMap(source, root);
  const tree = parseForMap(source);

  const blockRanges: Array<{ start: number; end: number }> = [];
  for (const child of tree.children) {
    const p = child.position;
    if (p?.start.offset != null && p?.end.offset != null) blockRanges.push({ start: p.start.offset, end: p.end.offset });
  }

  const leaves: MdLeaf[] = [];
  collectLeaves(tree, leaves);
  const { all, pairable, skipped } = collectDomEntries(root);
  const allIndexOf = new Map<Node, number>();
  all.forEach((n, i) => allIndexOf.set(n, i));

  const segments: OffsetSegment[] = [];
  const byNode = new Map<Text, OffsetSegment>();
  const unmappedNodes = new Set<Node>();
  for (const n of skipped) unmappedNodes.add(n);
  let li = 0;
  let di = 0;
  while (li < leaves.length && di < pairable.length) {
    const leaf = leaves[li];
    const entry = pairable[di];
    if (leaf.kind === "break") {
      if (entry.kind === "br") {
        li += 1;
        di += 1;
      } else {
        // 源里这个硬换行在 DOM 没有对应 br → 叶跳过（不消费 DOM，留给下一个叶重试）
        li += 1;
      }
      continue;
    }
    if (entry.kind === "br") {
      // 游离 <br>（rehype-raw 的原始 HTML 等）：按缝隙处理，不配对
      unmappedNodes.add(entry.node);
      di += 1;
      continue;
    }
    const data = entry.node.data;
    // mdast-util-to-hast 的两个注入惯例（经 rehype-raw 的 parse 往返与相邻文本合并成单节点）：
    // ① 任务列表复选框后注入的 " "；② 硬换行 <br> 后注入的 "\n"。前缀都是无源空白，按 decShift 处理。
    let shift = 0;
    const domValue = leafDomValue(leaf);
    if (data !== domValue && data.endsWith(domValue)) {
      const prefix = data.slice(0, data.length - domValue.length);
      if (prefix.length > 0 && prefix.trim() === "") shift = prefix.length;
    }
    if (shift > 0 || data === domValue) {
      // 段内源区间：text 叶 = position 覆盖的 raw 区间；code 叶 = value 在 raw 切片内的实际位置
      //（inlineCode 的 position 含两侧反引号、块代码含围栏行，value 本体才是渲染出来的部分）
      let sStart = leaf.start;
      let sEnd = leaf.end;
      let runs: AlignRun[] | null;
      if (leaf.kind !== "text") {
        const rawSlice = source.slice(leaf.start, leaf.end);
        // 围栏代码块的 value 本体从围栏行之后才开始：info 串可能恰好包含内容首行前缀
        //（如 info="javascript live"、内容首行 "live"），从头 indexOf 会命中围栏区造成源坐标错位
        let from = 0;
        const fenceHead = source.slice(leaf.start, leaf.start + 3);
        if (fenceHead === "```" || fenceHead === "~~~") {
          const nl = rawSlice.indexOf("\n");
          if (nl >= 0) from = nl + 1;
        }
        const idx = rawSlice.indexOf(leaf.value, from);
        if (idx < 0) {
          unmappedNodes.add(entry.node);
          li += 1;
          di += 1;
          continue;
        }
        sStart = leaf.start + idx;
        sEnd = sStart + leaf.value.length;
        runs = [{ r: leaf.value.length, d: leaf.value.length }];
      } else {
        runs = buildRuns(source.slice(sStart, sEnd), leaf.value);
      }
      const seg = makeSegment(sStart, sEnd, entry.node, runs, shift);
      if (runs) {
        segments.push(seg);
        byNode.set(entry.node, seg);
      } else {
        byNode.set(entry.node, seg);
        unmappedNodes.add(entry.node);
      }
      li += 1;
      di += 1;
      continue;
    }
    // value 对不上：若当前 DOM 节点其实对应**下一个**叶（DOM 缺了当前叶的节点）→ 叶降级、DOM 留着重试；
    // 否则 DOM 多出节点 → 节点降级、叶留着重试。每轮至少推进一个指针，必然终止。
    const nextLeaf = leaves[li + 1];
    if (nextLeaf && nextLeaf.kind !== "break" && data === leafDomValue(nextLeaf)) {
      li += 1;
      continue;
    }
    unmappedNodes.add(entry.node);
    di += 1;
  }
  while (di < pairable.length) {
    unmappedNodes.add(pairable[di].node);
    di += 1;
  }

  // 为全部 unmappable 节点计算「最近已映射边界」（全量 DOM 序：before = 前段尾，after = 后段首）
  const mappedInDomOrder = [...segments].sort(
    (a, b) => (allIndexOf.get(a.textNode) ?? 0) - (allIndexOf.get(b.textNode) ?? 0)
  );
  const boundaries = new Map<Node, { before: number | null; after: number | null }>();
  for (const node of unmappedNodes) {
    const idx = allIndexOf.get(node);
    if (idx == null) {
      boundaries.set(node, EMPTY_BOUNDARIES);
      continue;
    }
    let before: number | null = null;
    let after: number | null = null;
    for (const s of mappedInDomOrder) {
      const i = allIndexOf.get(s.textNode)!;
      if (i < idx) before = s.sEnd;
      else {
        after = s.sStart;
        break;
      }
    }
    boundaries.set(node, { before, after });
  }

  const ordered = [...segments].sort((a, b) => a.sStart - b.sStart);
  return { source, root, segments: ordered, blockRanges, byNode, boundaries };
}

/**
 * 源偏移区间 → DOM Range（高亮绘制、落点滚动、浮层锚点）。
 * 起点落缝 → 吸附到其后首段首；终点落缝 → 吸附到其前末段尾（§C.3）；
 * 吸附后无已映射内容（如整段落在公式/围栏语法缝隙）→ null。
 */
export function srcToRange(map: OffsetMap, start: number, end: number): Range | null {
  if (!map.root || !map.segments.length) return null;
  const srcLen = map.source.length;
  const s = Math.max(0, Math.min(start, srcLen));
  const e = Math.max(0, Math.min(end, srcLen));
  if (!(e > s)) return null;
  // 起点段：第一个 sEnd > s 的段（起点在段内 → 段内定位；在缝隙 → 段首吸附）
  let si = 0;
  while (si < map.segments.length && map.segments[si].sEnd <= s) si += 1;
  if (si >= map.segments.length) return null;
  const startSeg = map.segments[si];
  const startOff = rawToDec(startSeg, Math.max(0, Math.min(s, startSeg.sEnd) - startSeg.sStart));
  // 终点段：最后一个 sStart < e 的段（终点在段内 → 段内定位；在缝隙 → 段尾吸附）
  let ei = map.segments.length - 1;
  while (ei >= 0 && map.segments[ei].sStart >= e) ei -= 1;
  if (ei < si) return null;
  const endSeg = map.segments[ei];
  const endOff = rawToDec(endSeg, Math.max(0, Math.min(e, endSeg.sEnd) - endSeg.sStart));
  if (si === ei && endOff <= startOff) return null;
  try {
    const range = map.root.ownerDocument!.createRange();
    range.setStart(startSeg.textNode, startSeg.decShift + startOff);
    range.setEnd(endSeg.textNode, endSeg.decShift + endOff);
    return range;
  } catch {
    return null;
  }
}

/**
 * DOM 位置 → 源偏移（划选取偏移、点击命中）。
 * 已映射文本节点按段内对齐精确反查；unmappable 节点（KaTeX 输出等）按「最近已映射边界」判，
 * prefer="before" 取前段尾、"after" 取后段首（划选起点取 before、终点取 after＝高亮罩住整段）。
 */
export function domToSrc(
  map: OffsetMap,
  node: Node | null,
  offset: number,
  prefer: "before" | "after" = "before"
): number | null {
  if (!node) return null;
  if (node.nodeType === 3) {
    const seg = map.byNode.get(node as Text);
    if (seg && seg.runs) {
      const off = Math.max(0, Math.min(offset - seg.decShift, seg.dLen - seg.decShift));
      return seg.sStart + decToRaw(seg, off);
    }
  }
  const b = map.boundaries.get(node) ?? EMPTY_BOUNDARIES;
  return prefer === "before" ? (b.before ?? b.after) : (b.after ?? b.before);
}

function firstTextIn(n: Node): Text | null {
  for (const child of Array.from(n.childNodes)) {
    if (child.nodeType === 3 && (child.textContent || "").length) return child as Text;
    if (child.nodeType === 1) {
      const deep = firstTextIn(child);
      if (deep) return deep;
    }
  }
  return null;
}

function lastTextIn(n: Node): Text | null {
  const kids = Array.from(n.childNodes);
  for (let i = kids.length - 1; i >= 0; i--) {
    const child = kids[i];
    if (child.nodeType === 3 && (child.textContent || "").length) return child as Text;
    if (child.nodeType === 1) {
      const deep = lastTextIn(child);
      if (deep) return deep;
    }
  }
  return null;
}

/**
 * 把选区/点击的 (container, offset) 解析成一个 Text 节点内位置：
 * container 是元素时，offset 指「第 offset 个子节点之前」——解析该子树的首个文本节点；
 * offset 越界（= 元素末尾）则取容器子树的末个文本节点；落点前没有文本时往前找最近的文本尾。
 * 找不到任何文本（空容器/纯缝隙元素）返回 null。
 */
export function resolveCaret(container: Node | null, offset: number): { node: Text; off: number } | null {
  if (!container) return null;
  if (container.nodeType === 3) {
    const t = container as Text;
    return { node: t, off: Math.max(0, Math.min(offset, t.data.length)) };
  }
  if (container.nodeType !== 1) return null;
  const el = container as Element;
  const child = el.childNodes[offset] ?? null;
  if (child) {
    const t = firstTextIn(child);
    if (t) return { node: t, off: 0 };
    // 落点子树没有可解析文本（br/公式/图片）：取该位置之前的最近文本尾，否则之后的最近文本头
    const kids = Array.from(el.childNodes).slice(0, offset);
    for (let i = kids.length - 1; i >= 0; i--) {
      const prev = kids[i];
      if (prev.nodeType === 3 && (prev.textContent || "").length) {
        return { node: prev as Text, off: (prev as Text).data.length };
      }
      if (prev.nodeType === 1) {
        const deep = lastTextIn(prev);
        if (deep) return { node: deep, off: deep.data.length };
      }
    }
    const after = firstTextIn(el);
    return after ? { node: after, off: 0 } : null;
  }
  const tail = lastTextIn(el);
  return tail ? { node: tail, off: tail.data.length } : null;
}

/**
 * 点击源偏移 → 顶层块索引（§D.2 P0 块级焦点落点）。
 * 缝隙（空行/相邻块之间）归后一个块；越界钳到首/末块。
 */
export function blockIndexForSrc(map: OffsetMap, src: number): number {
  const blocks = map.blockRanges;
  if (!blocks.length) return 0;
  if (src < blocks[0].start) return 0;
  let lo = 0;
  let hi = blocks.length - 1;
  let ans = blocks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].start <= src) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (src <= blocks[ans].end) return ans;
  return Math.min(ans + 1, blocks.length - 1);
}
