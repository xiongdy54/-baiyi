// D121 §2.3：选区前后文（纯函数，零依赖）
// 选区前 2 段、后 1 段；before ≤600 字（从远端截断）、after ≤400 字；段内空白归一。

const BEFORE_PARAS = 2;
const AFTER_PARAS = 1;
const BEFORE_CAP = 600;
const AFTER_CAP = 400;

const ws = (s: string) => s.replace(/\s+/g, " ").trim();

/** 在 body 中定位 selection：精确 indexOf，失败则空白归一后定位（返回原文 [start,end)）。 */
function locate(body: string, selection: string): { start: number; end: number } | null {
  const exact = body.indexOf(selection);
  if (exact >= 0) return { start: exact, end: exact + selection.length };
  const target = ws(selection);
  if (!target) return null;
  // 构造归一化文本与到原文下标的映射
  let norm = "";
  const map: number[] = [];
  let prevSpace = true;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (/\s/.test(ch)) {
      if (!prevSpace) {
        norm += " ";
        map.push(i);
        prevSpace = true;
      }
    } else {
      norm += ch;
      map.push(i);
      prevSpace = false;
    }
  }
  const at = norm.indexOf(target);
  if (at < 0) return null;
  return { start: map[at], end: map[at + target.length - 1] + 1 };
}

export function paragraphContext(body: string, selection: string): { before: string; after: string } | null {
  if (!body || !selection || !selection.trim()) return null;
  const loc = locate(body, selection);
  if (!loc) return null;
  const paras = (s: string) => s.split(/\r?\n\s*\r?\n/).map(ws).filter(Boolean);
  // 选区所在段的段内前后部分也算入相邻上下文：以选区起止之外的同段文字并入前/后段
  const headRaw = body.slice(0, loc.start);
  const tailRaw = body.slice(loc.end);
  const headParas = paras(headRaw);
  const tailParas = paras(tailRaw);
  // 选区起点若在段中间，headRaw 末段是同段前半，计为 1 段；终点同理
  const beforeParas = headParas.slice(-BEFORE_PARAS);
  const afterParas = tailParas.slice(0, AFTER_PARAS);
  let before = beforeParas.join("\n");
  let after = afterParas.join("\n");
  if (before.length > BEFORE_CAP) before = before.slice(before.length - BEFORE_CAP);
  if (after.length > AFTER_CAP) after = after.slice(0, AFTER_CAP);
  if (!before && !after) return null;
  return { before, after };
}
