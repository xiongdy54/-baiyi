// v48.85（D129，B4 / 设计稿 §5.3）：仪表盘「巩固疆域」widget（Territory 层，half）。
// GF-1 形态 = 材料/领域巩固地图——**不自称知识疆域**（§6.6.4：知识疆域属 GF-2 且阻塞于缺口 G2）。
// 数据 = overview.territory.rows（书维聚合，total 降序取前 8；活跃卡 <8 的书已被主进程按 material
// 同一样本门槛过滤，口径同源 isConsolidated）；经 useGrowthOverview 自取数（Timeline 先例）。
// 回落呈现纪律（§4.17-7③）：只显示现状（覆盖率可回落），无回落提示无警告——Growth Records 才是历史。
import { useGrowthOverview, type GrowthTerritoryRow } from "../../lib/growth";
import { territoryAriaLabel, territoryFootText, territoryPctText } from "../../lib/growthStrings";

function TerritoryRowView({ row, index }: { row: GrowthTerritoryRow; index: number }) {
  // 四段只渲染 count>0 的段（0 宽段会留下 1px 幽灵缝）；段顺序/配色 = 设计稿 §5.3 视觉阶梯
  const segs = (
    [
      ["territory-seg-new", row.new],
      ["territory-seg-learning", row.learning],
      ["territory-seg-reviewing", row.reviewing],
      ["territory-seg-consolidated", row.consolidated]
    ] as const
  ).filter(([, n]) => n > 0);
  return (
    <div className="territory-row" data-territory-row data-territory-id={row.id}>
      <span className="territory-name">{row.label}</span>
      <span className="territory-seg" role="img" aria-label={territoryAriaLabel(row)}>
        {segs.map(([cls, n], i) => (
          <i key={cls} className={cls} style={{ flexGrow: n, "--seg-i": Math.min(index * 4 + i, 8) } as React.CSSProperties} />
        ))}
      </span>
      <span className="territory-pct mono tnum">{territoryPctText(row)}</span>
    </div>
  );
}

export default function TerritoryWidget() {
  const { data } = useGrowthOverview();
  const rows = (data?.territory.rows ?? []).filter((r) => r.kind === "book").slice(0, 8);
  return (
    <div className="territory-map" data-widget-body>
      {rows.map((r, i) => (
        <TerritoryRowView key={`${r.kind}:${r.id}`} row={r} index={i} />
      ))}
      {rows.length > 0 ? (
        <p className="territory-foot mono">{territoryFootText(rows.filter((r) => r.crossedHalf).length)}</p>
      ) : (
        <p className="growth-empty">暂无可展示的材料——至少 8 张活跃卡的材料才会出现在这里。</p>
      )}
    </div>
  );
}
