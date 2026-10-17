// 版式：分层图（§15.3；依据/推出/因果的 DAG，如证明、推导网络）。
// 1. 边：组内「据/推/因」关系（ctx.siblingEdges 经 ctx.rel 登记为已消化；「据」已被反转为 目标→本节点，
//    故边方向＝信息流向，from 在上层、to 在下层）。
// 2. 分层：最长路（层＝所有前驱层的最大值 + 1），自上而下。有环时按原文顺序做 DFS，遇到指回当前栈内节点的
//    「回边」不参与分层（仍画出）——只取决于原文顺序与边集，确定性。
// 3. 层内排序：重心法——第 0 层按原文顺序；其后每层按「前驱锚点中心的平均横坐标」升序，无前驱者排最后（原文顺序）；
//    横向落位时尽量对齐重心（left = max(重心 - 锚点半宽, 已占用右缘)）。
// 4. LOD「另有 N 项」另起末行。多条边汇入同一卡片时错开终点分位 tf。
// 生长方向（S7）：块变宽/高只把同层右侧、下层向右/下推（重心对齐只会取 max，不会向左收）。

import type { Block, BlockEdge, ChildBlock, Header, PatternCtx, PatternDef, Place } from "../layout";

export const LAYERED = { GX: 32, GY: 36 } as const;

const FLOW = new Set(["据", "推", "因"]);

function layoutLayered(header: Header, kids: readonly ChildBlock[], ctx: PatternCtx): Block {
  const { GX, GY } = LAYERED;
  const idx = new Map<string, number>();
  kids.forEach((k, i) => {
    if (k.kind === "node") idx.set(k.id, i);
  });
  // 流边（信息流向；ctx.rel 已处理「据」反转），按 siblingEdges 的确定性顺序
  const flow: BlockEdge[] = [];
  const fi: [number, number][] = [];
  for (const e of ctx.siblingEdges) {
    if (!FLOW.has(e.code) || e.from === e.to || !idx.has(e.from) || !idx.has(e.to)) continue;
    const be = ctx.rel(e.from, e.to, e.code);
    flow.push(be);
    fi.push([idx.get(be.from) as number, idx.get(be.to) as number]);
  }
  const n = kids.length;
  const out: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of fi) out[a].push(b);
  for (const l of out) l.sort((a, b) => a - b);

  // 迭代 DFS（原文顺序）：断环 + 逆后序拓扑序
  const color = new Uint8Array(n);
  const post: number[] = [];
  const back = new Set<number>();
  const key = (a: number, b: number) => a * (n + 1) + b;
  for (let s = 0; s < n; s++) {
    if (color[s]) continue;
    const stack: [number, number][] = [[s, 0]];
    color[s] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1];
      const v = top[0];
      if (top[1] < out[v].length) {
        const w = out[v][top[1]++];
        if (color[w] === 1) back.add(key(v, w));
        else if (color[w] === 0) {
          color[w] = 1;
          stack.push([w, 0]);
        }
      } else {
        color[v] = 2;
        post.push(v);
        stack.pop();
      }
    }
  }
  const preds: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of fi) if (!back.has(key(a, b))) preds[b].push(a);
  const layer = new Int32Array(n);
  for (let i = post.length - 1; i >= 0; i--) {
    const v = post[i];
    let l = 0;
    for (const p of preds[v]) if (layer[p] + 1 > l) l = layer[p] + 1;
    layer[v] = l;
  }

  const rows: number[][] = [];
  const moreIdx: number[] = [];
  for (let i = 0; i < n; i++) {
    if (kids[i].kind !== "node") {
      moreIdx.push(i);
      continue;
    }
    (rows[layer[i]] ||= []).push(i);
  }
  for (const m of moreIdx) rows.push([m]);

  const cx: number[] = new Array(n).fill(0);
  const left: number[] = new Array(n).fill(0);
  const places: Place[] = [];
  let y = 0;
  let w = 0;
  rows.forEach((row, ri) => {
    const want = row.map((i, pos) => {
      const ps = preds[i];
      const c = ri > 0 && ps.length ? ps.reduce((a, p) => a + cx[p], 0) / ps.length : null;
      return { i, pos, c };
    });
    if (ri > 0) want.sort((a, b) => (a.c == null ? 1e9 : a.c) - (b.c == null ? 1e9 : b.c) || a.pos - b.pos);
    let x = 0;
    let rh = 0;
    for (const { i, c } of want) {
      const b = kids[i];
      const half = b.anchor.x + b.anchor.w / 2;
      const l = ctx.g4(c != null ? Math.max(c - half, x) : x);
      left[i] = l;
      cx[i] = l + half;
      places.push({ id: b.id, x: l, y });
      x = l + b.w + GX;
      if (l + b.w > w) w = l + b.w;
      if (b.h > rh) rh = b.h;
    }
    y += rh + GY;
  });

  // 汇入同一卡片的多条边错开终点分位
  const incoming = new Map<string, number[]>();
  flow.forEach((e, i) => {
    const l = incoming.get(e.to);
    if (l) l.push(i);
    else incoming.set(e.to, [i]);
  });
  const edges: BlockEdge[] = flow.map((e) => ({ ...e }));
  for (const [, list] of incoming) {
    if (list.length < 2) continue;
    list.sort((a, b) => cx[idx.get(edges[a].from) as number] - cx[idx.get(edges[b].from) as number] || a - b);
    list.forEach((ei, k) => {
      edges[ei].tf = (k + 1) / (list.length + 1);
    });
  }
  return ctx.frame(header, { w, h: Math.max(0, y - GY), items: [], places, edges });
}

export const layered: PatternDef = { key: "layered", layout: layoutLayered };
