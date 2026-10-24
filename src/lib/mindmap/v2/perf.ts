// 材料导图 v2 · 过渡性能测量（审计 C-32 A1）。
// 仅在 localStorage.mmPerf === "1" 时启用；结果挂在 window.__mmPerf 上，并 console.table 输出。
// 测量窗：MindmapLens.toggleCollapse 的展开/收起点 perfBegin → 画布过渡结束（f.done / 被丢弃）perfEnd；
// 窗内累计：measureGraph 的布局次数与耗时（perfLayout）、fit IPC 往返耗时（perfIpc）、相邻过渡帧间隔（perfFrame）。
// 窗口层的逐帧 setBounds 次数由主进程 electron/lensWindow.js 的 animateBounds 结束时打印
// "[lens] setBounds x N"（C-33 Phase B 去掉逐帧 setBounds 的基线）。
// C-33 B2/B3：被点节点过渡前后屏幕位置偏差由 perfPinDeviation 补写进当前/最近一行（pinDeviationPx）——
// 窗口层落位（resize 一次性补偿 / 收起缩窗）晚于画布过渡结束，测量窗可能已关闭。
// 纯测量：不开启时除一次 localStorage 读外零开销；不参与任何渲染决策。

type Rec = { kind: string; startedAt: number; layouts: number; layoutMs: number; ipcMs: number; frames: number[]; setBounds?: number; pinDeviationPx?: number };
let cur: Rec | null = null;
let lastRow: { pinDeviationPx?: number } | null = null;

export const perfOn = () => {
  try {
    return localStorage.getItem("mmPerf") === "1";
  } catch {
    return false;
  }
};

export function perfBegin(kind: string) {
  if (!perfOn()) return;
  cur = { kind, startedAt: performance.now(), layouts: 0, layoutMs: 0, ipcMs: 0, frames: [] };
}

export function perfLayout(ms: number) {
  if (cur) {
    cur.layouts++;
    cur.layoutMs += ms;
  }
}

export function perfIpc(ms: number) {
  if (cur) cur.ipcMs += ms;
}

export function perfFrame(dt: number) {
  if (cur) cur.frames.push(dt);
}

/** C-33：被点节点过渡前后屏幕位置偏差（px）。测量窗仍开着写当前窗；已关闭（窗口层落位晚于画布
 * 过渡结束）则补写最近一行——row 以引用推入 __mmPerf，事后改写对调用方可见。 */
export function perfPinDeviation(px: number) {
  const target = cur ?? lastRow;
  if (target) target.pinDeviationPx = Math.round(px * 100) / 100;
}

export function perfEnd() {
  if (!cur) return;
  const f = [...cur.frames].sort((a, b) => a - b);
  const p95 = f.length ? f[Math.min(f.length - 1, Math.floor(f.length * 0.95))] : 0;
  const row = {
    kind: cur.kind,
    totalMs: Math.round(performance.now() - cur.startedAt),
    layouts: cur.layouts,
    layoutMs: Math.round(cur.layoutMs),
    ipcMs: Math.round(cur.ipcMs),
    frames: f.length,
    p95FrameMs: Math.round(p95),
    over33ms: f.filter((x) => x > 33).length,
    ...(cur.pinDeviationPx != null ? { pinDeviationPx: cur.pinDeviationPx } : {}),
  };
  if (cur.pinDeviationPx != null) row.pinDeviationPx = cur.pinDeviationPx;
  const w = window as unknown as { __mmPerf?: unknown[] };
  (w.__mmPerf ??= []).push(row);
  lastRow = row;
  console.table([row]);
  cur = null;
}
