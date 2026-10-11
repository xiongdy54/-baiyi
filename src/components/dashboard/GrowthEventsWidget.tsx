// v48.85（D129，B4 / 设计稿 §5.3）：仪表盘「成长记录」widget（Growth 层，wide）。
// 数据 = overview.recentEvents（L0–L2 档案，triggerSeq 倒序）+ 头部计数 totals——经 useGrowthOverview
// 自取数（模块级缓存 + 800ms 防抖，不进 stats:overview、不改既有刷新链，Timeline 先例）。
// 定位（§4.17-6③）：历史档案的「一次性盘点入口」——被动陈列，不弹窗、不推送；空态真实文案
// （MOTION-DESIGN-SPEC §6.2 不画假轴假数据；禁「再接再厉」类打鸡血文案）。
// 文案出自 growthStrings.ts（§6.6.1 唯一事实来源）；本组件零判定逻辑。
import { useGrowthOverview } from "../../lib/growth";
import {
  growthEventText,
  growthRecordDate,
  growthRecordSource,
  growthRecordsEmptyText,
  growthTotalsText
} from "../../lib/growthStrings";

export default function GrowthEventsWidget() {
  const { data } = useGrowthOverview();
  const events = data?.recentEvents ?? [];
  const totals = data?.totals ?? null;
  return (
    <div className="growth-records" data-widget-body>
      {totals && <p className="growth-records-totals mono">{growthTotalsText(totals)}</p>}
      {events.length > 0 ? (
        <ol className="growth-record-list">
          {events.map((h) => (
            <li
              key={`${h.key}:${h.triggerSeq}`}
              className="growth-record"
              data-growth-record
              data-growth-event={h.type}
              data-growth-tier={h.tier}
            >
              <span className="growth-record-date mono">{growthRecordDate(h.triggerAt)}</span>
              <span className="growth-record-text">{growthEventText(h)}</span>
              <span className="growth-record-src mono">{growthRecordSource(h)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="growth-empty">{growthRecordsEmptyText()}</p>
      )}
    </div>
  );
}
