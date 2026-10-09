// 简化版仪表盘布局模型（v2）：
// - 组件是**有序列表**，每项可声明 size: 'wide'（通栏）| 'half'（半幅）
// - 渲染：从上到下流动；half 组件相邻时两两成行（row），否则独占一行
// - 拖拽：把组件拖到目标上方 → 列表交换位置（HTML5 DnD，无分割树）
// - 持久化：{ order: WidgetId[], sizes: Record<WidgetId, 'wide'|'half'> }
export type WidgetSize = "wide" | "half";

export interface DashLayoutV2 {
  order: string[];
  sizes: Record<string, WidgetSize>;
}

export function defaultLayoutV2(hidden: string[]): DashLayoutV2 {
  const all = [
    { id: "kpi", size: "wide" },
    { id: "timeline", size: "wide" },
    { id: "heatmap", size: "wide" },
    { id: "today", size: "half" },
    { id: "domains", size: "half" },
    { id: "rhythm", size: "half" },
    { id: "ratings", size: "half" },
    { id: "domainrank", size: "half" },
    { id: "queueflow", size: "half" },
    { id: "duration", size: "half" },
    { id: "funnel", size: "half" },
    { id: "reading", size: "wide" },
    { id: "sources", size: "wide" }
  ] as const;
  const visible = all.filter((w) => !hidden.includes(w.id));
  return {
    order: visible.map((w) => w.id),
    sizes: Object.fromEntries(visible.map((w) => [w.id, w.size]))
  };
}

export function isSaneLayoutV2(l: DashLayoutV2 | null | undefined): boolean {
  return Boolean(l && Array.isArray(l.order) && l.order.length >= 2);
}

// 行分解：顺序扫描，half+half 相邻成行，其余独行
export type LayoutRow =
  | { kind: "single"; id: string; size: WidgetSize }
  | { kind: "pair"; ids: [string, string] };

export function toRows(layout: DashLayoutV2): LayoutRow[] {
  const rows: LayoutRow[] = [];
  let i = 0;
  while (i < layout.order.length) {
    const a = layout.order[i];
    const b = layout.order[i + 1];
    const aHalf = layout.sizes[a] === "half";
    const bHalf = b !== undefined && layout.sizes[b] === "half";
    if (aHalf && bHalf) {
      rows.push({ kind: "pair", ids: [a, b] });
      i += 2;
    } else {
      rows.push({ kind: "single", id: a, size: layout.sizes[a] === "half" ? "half" : "wide" });
      i += 1;
    }
  }
  return rows;
}

// 拖拽交换：把 source 移到 target 的位置，target 顺延
export function reorder(layout: DashLayoutV2, sourceId: string, targetId: string): DashLayoutV2 {
  if (sourceId === targetId) return layout;
  const order = [...layout.order];
  const from = order.indexOf(sourceId);
  const to = order.indexOf(targetId);
  if (from < 0 || to < 0) return layout;
  order.splice(from, 1);
  order.splice(to, 0, sourceId);
  return { ...layout, order };
}

export function setWidgetSize(layout: DashLayoutV2, widgetId: string, size: WidgetSize): DashLayoutV2 {
  return { ...layout, sizes: { ...layout.sizes, [widgetId]: size } };
}

// 设置面板开关组件后：补入新显示的（追加到末尾）、移除隐藏的
export function syncHidden(layout: DashLayoutV2, hidden: string[]): DashLayoutV2 {
  const def = defaultLayoutV2(hidden);
  const order = layout.order.filter((id) => !hidden.includes(id));
  // 新出现的组件（含版本升级新增的，如「一日时间轴」）按默认顺序插到它前一个组件之后，
  // 而不是一律追加到末尾——否则老用户升级后新图表埋在页面最底部看不见。
  def.order.forEach((id, i) => {
    if (order.includes(id)) return;
    const prev = i > 0 ? order.indexOf(def.order[i - 1]) : -1;
    order.splice(prev + 1, 0, id);
  });
  const sizes = { ...def.sizes, ...layout.sizes };
  return { order, sizes };
}
