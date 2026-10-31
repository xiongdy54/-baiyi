// 随文结构 → 结构全景的共享元素交接（D254 v2；docs/design/STRUCTURE-ATLAS-D254.md §9.2）。
// 同步采集快照（必须在任何 setState 之前调用）；克隆两层直接挂 body 并淡出（不包容器，保住混合层）。
import type { DOMRectLike, FlowSnapshot } from "../../../lib/flow/atlasLayout";
import { ATLAS_T } from "../../../lib/flow/atlasLayout";
import { motionPreference } from "../../../lib/mindmap/v2/animate";

const rectOf = (el: Element): DOMRectLike => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

/** 同步采集随文结构当前代（必须在任何 setState 之前调用）。随文结构未打开 → null */
export function captureFlowSnapshot(doc: Document): FlowSnapshot | null {
  const layer = doc.querySelector<HTMLElement>(".flow-layer");
  if (!layer) return null;
  const gens = Array.from(layer.querySelectorAll<HTMLElement>('.flow-gen:not([data-phase="exit"])'));
  const gen = gens[gens.length - 1];
  if (!gen) return null;
  const gk = gen.getAttribute("data-gen");
  const snap: FlowSnapshot = { cut: gk && gk !== "none" ? gk : null, readingId: null, items: new Map(), bars: new Map() };
  for (const el of Array.from(gen.querySelectorAll<HTMLElement>(".flow-item[data-flow-item]"))) {
    if (el.classList.contains("is-peek") || el.classList.contains("is-exit")) continue;
    const id = el.getAttribute("data-flow-item")!;
    snap.items.set(id, rectOf(el));
    // 阅读节点：模块级 readingId 在 FlowItem 上写 data-reading="1"
    if (el.getAttribute("data-reading") === "1" && id.startsWith("n:")) snap.readingId = id.slice(2);
  }
  for (const el of Array.from(gen.querySelectorAll('[data-prim-id^="bar:"]'))) snap.bars.set(el.getAttribute("data-prim-id")!.slice(4), rectOf(el));
  return snap;
}

/** 克隆两层并淡出（各自直接挂 body——不要包容器，否则混合层的 mix-blend-mode 被隔离） */
export function playFlowGhost(doc: Document, snap: FlowSnapshot): void {
  const off = motionPreference() === "off";
  const ghost = (src: Element | null, ms: number, hideMatched: boolean) => {
    if (!src) return;
    const c = src.cloneNode(true) as HTMLElement;
    c.setAttribute("data-atlas-ghost", "1");
    c.style.pointerEvents = "none";
    c.style.zIndex = "25";
    if (hideMatched) {
      for (const el of Array.from(c.querySelectorAll<HTMLElement>(".flow-item[data-flow-item]"))) {
        const id = el.getAttribute("data-flow-item")!;
        if (id.startsWith("n:") && snap.items.has(id)) el.style.visibility = "hidden";
      }
    }
    doc.body.appendChild(c);
    const dur = off ? ATLAS_T.REDUCED : ms;
    if (typeof c.animate === "function") c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
    else c.style.opacity = "0";
    window.setTimeout(() => c.remove(), Math.max(dur, ATLAS_T.GHOST_REMOVE));
  };
  ghost(doc.querySelector(".flow-blend"), ATLAS_T.GHOST_BLEND_OUT, false);
  ghost(doc.querySelector(".flow-layer"), ATLAS_T.GHOST_LAYER_OUT, true);
}
