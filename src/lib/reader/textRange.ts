// 正文文本定位（阅读透镜 v2「正文强调」，2026-10-18）：在一篇已渲染的文档里，按「首 / 尾原文探针」找回一段 Range。
// 纯 DOM、不依赖任何阅读引擎（foliate / PDF 文本层都能用）。空白不敏感：探针与正文都去掉全部空白后比对，
// 再映射回文本节点与偏移——canonical 文本（块间 \n、块内空白折叠）与渲染 DOM 的空白差异因此不影响命中。

// 与 canonical 抽取（adapter documentToText）同口径：去掉 script/style/noscript/template/head，注音（rt）保留
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD"]);

export interface TextIndex {
  /** 去空白后的全文 */
  flat: string;
  /** flat 每个字符 → 所在文本节点下标 */
  node: number[];
  /** flat 每个字符 → 在该文本节点里的偏移（UTF-16） */
  off: number[];
  texts: Text[];
}

export function buildTextIndex(root: Node): TextIndex {
  const texts: Text[] = [];
  const node: number[] = [];
  const off: number[] = [];
  let flat = "";
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, {
    acceptNode(n: Node) {
      let p = n.parentElement;
      while (p) {
        if (SKIP.has(p.tagName.toUpperCase())) return 2; // FILTER_REJECT
        p = p.parentElement;
      }
      return 1; // FILTER_ACCEPT
    },
  } as NodeFilter);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    const s = t.data;
    const k = texts.length;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (/\s/.test(c) || c === "\u200b" || c === "\u00ad") continue;
      flat += c;
      node.push(k);
      off.push(i);
    }
    texts.push(t);
  }
  return { flat, node, off, texts };
}

const strip = (s: string) => String(s || "").replace(/[\s\u200b\u00ad]+/g, "");

/**
 * 按首尾探针找一段：head 在 from 之后首次出现处起，到 head 之后首次出现的 tail 末尾止；
 * tail 找不到时退到 head 本身。head 去空白后不足 2 字、或整段找不到 → null。
 * 返回 flat 坐标 [start, end)，便于调用方按序继续找下一段（from = end）。
 */
export function findFlatSpan(idx: TextIndex, head: string, tail: string, from = 0): [number, number] | null {
  const h = strip(head);
  if (h.length < 2) return null;
  let i = idx.flat.indexOf(h, from);
  if (i < 0 && h.length > 12) {
    // 渲染差异（注音、脚注号）可能打断长探针：退到前 12 字
    i = idx.flat.indexOf(h.slice(0, 12), from);
  }
  if (i < 0) return null;
  const t = strip(tail);
  let end = i + Math.min(h.length, idx.flat.length - i);
  if (t.length >= 2) {
    const j = idx.flat.indexOf(t, i);
    if (j >= 0) end = j + t.length;
    else if (t.length > 12) {
      const j2 = idx.flat.indexOf(t.slice(-12), i);
      if (j2 >= 0) end = j2 + 12;
    }
  }
  return [i, Math.max(end, i + 1)];
}

export function spanToRange(doc: Document, idx: TextIndex, span: [number, number]): Range | null {
  const [s, e] = span;
  if (s < 0 || e > idx.flat.length || e <= s) return null;
  try {
    const r = doc.createRange();
    r.setStart(idx.texts[idx.node[s]], idx.off[s]);
    r.setEnd(idx.texts[idx.node[e - 1]], idx.off[e - 1] + 1);
    return r;
  } catch {
    return null;
  }
}

/** 便捷：一次找一段 Range */
export function findTextRange(doc: Document, root: Node, head: string, tail: string): Range | null {
  const idx = buildTextIndex(root);
  const span = findFlatSpan(idx, head, tail);
  return span ? spanToRange(doc, idx, span) : null;
}
