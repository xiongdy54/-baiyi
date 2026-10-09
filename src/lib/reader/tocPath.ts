// D121 §2.2：章节路径（纯函数，零依赖）
// tocPathByHref：嵌套目录 → 从顶层到命中项的 label 链；headingPathAt：markdown ATX 标题层级栈。

interface TocLike {
  label: string;
  href: string;
  subitems?: TocLike[];
}

function baseHref(h: string): string {
  const i = h.indexOf("#");
  return i >= 0 ? h.slice(0, i) : h;
}

/** 先全等匹配；无则按去锚 href 匹配（取最深一项，同深度取文档序最先）。未命中返回 []。 */
export function tocPathByHref(items: TocLike[] | undefined | null, href: string | undefined | null): string[] {
  if (!items || !items.length || !href) return [];
  let exact: string[] | null = null;
  let loose: string[] = [];
  const base = baseHref(href);
  const walk = (list: TocLike[], trail: string[]) => {
    for (const it of list) {
      if (exact) return;
      const path = [...trail, it.label];
      if (it.href === href) {
        exact = path;
        return;
      }
      if (base && baseHref(it.href) === base && path.length > loose.length) loose = path;
      if (it.subitems && it.subitems.length) walk(it.subitems, path);
    }
  };
  walk(items, []);
  return exact ?? loose;
}

/** 取 index 之前出现的 ATX 标题，维护层级栈，返回当前所在标题链（忽略围栏代码块内的 #）。 */
export function headingPathAt(markdown: string, index: number): string[] {
  if (!markdown) return [];
  const upto = markdown.slice(0, Math.max(0, index));
  const stack: { level: number; text: string }[] = [];
  let inFence = false;
  for (const line of upto.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const level = m[1].length;
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    stack.push({ level, text: m[2].trim() });
  }
  return stack.map((s) => s.text);
}
