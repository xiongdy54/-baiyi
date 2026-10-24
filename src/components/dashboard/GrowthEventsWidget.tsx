// v48.85（D129，B4 / 设计稿 §5.3）：仪表盘「成长记录」widget（Growth 层，wide）。
// 数据 = overview.recentEvents（L0–L2 档案，triggerSeq 倒序）+ 头部计数 totals——经 useGrowthOverview
// 自取数（模块级缓存 + 800ms 防抖，不进 stats:overview、不改既有刷新链，Timeline 先例）。
// 定位（§4.17-6③）：历史档案的「一次性盘点入口」——被动陈列，不弹窗、不推送；空态真实文案
// （MOTION-DESIGN-SPEC §6.2 不画假轴假数据；禁「再接再厉」类打鸡血文案）。
// 文案出自 growthStrings.ts（§6.6.1 唯一事实来源）；本组件零判定逻辑。
// v49.22（D195）：档案只收「建制级」真实跨越（判定在 electron/db.js，本组件零口径）；改为分页展示——
// 每页 6 条 + 页码窗口（省略号折叠）+ 点省略号就地输入跳页（纯渲染层，零 IPC）。
import { useEffect, useState } from "react";
import { isImeComposing } from "../../lib/ime";
import { useGrowthOverview } from "../../lib/growth";
import {
  growthEventText,
  growthRecordDate,
  growthRecordSource,
  growthRecordsEmptyText,
  growthTotalsText
} from "../../lib/growthStrings";
import { useT } from "../../lib/i18n";

// 每页 6 条（v49.22 / D195）：数据页其余模块卡高 `min-height: 300px`，6 行 + 头部计数 + 分页条 ≈ 同量级高度。
const PAGE_SIZE = 6;

// 页码窗口（v49.22 / D195）：总数 ≤7 全显；否则首尾页恒显 + 当前 ±2，中间折叠为省略号（"gap"）。
// 例（当前 1、总 30）：`1 2 3 4 5 … 30`。
type PageItem = number | "gap";

function pageWindow(current: number, total: number): PageItem[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, "gap", total];
  if (current >= total - 3) return [1, "gap", total - 4, total - 3, total - 2, total - 1, total];
  return [1, "gap", current - 1, current, current + 1, "gap", total];
}

export default function GrowthEventsWidget() {
  const T = useT();
  const { data } = useGrowthOverview();
  const events = data?.recentEvents ?? [];
  const totals = data?.totals ?? null;
  const totalPages = Math.max(1, Math.ceil(events.length / PAGE_SIZE));
  const [page, setPage] = useState(1);
  const [gapIdx, setGapIdx] = useState<number | null>(null); // 正在输入页码的省略号在 items 里的下标

  // 数据条数变化后把当前页钳回 [1, totalPages]
  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages]);

  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const pageEvents = events.slice(start, start + PAGE_SIZE);

  // 省略号输入提交：解析数字 → 钳制到 [1, totalPages] → 跳页（回车/失焦提交，Esc 取消）
  const commitJump = (raw: string) => {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) setPage(Math.min(Math.max(1, n), totalPages));
    setGapIdx(null);
  };

  return (
    <div className="growth-records" data-widget-body>
      {totals && <p className="growth-records-totals mono">{growthTotalsText(totals)}</p>}
      {events.length > 0 ? (
        <>
          <ol className="growth-record-list">
            {pageEvents.map((h) => (
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
          {totalPages > 1 && (
            <nav className="growth-pager" aria-label={T("成长记录分页")}>
              {pageWindow(safePage, totalPages).map((item, i) =>
                item === "gap" ? (
                  gapIdx === i ? (
                    <input
                      key={`gap-input-${i}`}
                      className="growth-pager-input"
                      type="text"
                      inputMode="numeric"
                      autoFocus
                      defaultValue={safePage}
                      aria-label={T("输入页码跳转")}
                      onKeyDown={(e) => {
                        if (isImeComposing(e)) return; // 组字中的 Enter/Esc 属于输入法（确认/取消候选词）
                        if (e.key === "Enter") commitJump(e.currentTarget.value);
                        else if (e.key === "Escape") setGapIdx(null);
                      }}
                      onBlur={(e) => commitJump(e.currentTarget.value)}
                    />
                  ) : (
                    <button
                      key={`gap-${i}`}
                      type="button"
                      className="growth-pager-gap"
                      aria-label={T("输入页码跳转")}
                      onClick={() => setGapIdx(i)}
                    >
                      …
                    </button>
                  )
                ) : (
                  <button
                    key={`page-${item}`}
                    type="button"
                    className="growth-pager-btn"
                    aria-current={item === safePage ? "page" : undefined}
                    aria-label={T("第 {n} 页", { n: item })}
                    onClick={() => setPage(item)}
                  >
                    {item}
                  </button>
                )
              )}
            </nav>
          )}
        </>
      ) : (
        <p className="growth-empty">{growthRecordsEmptyText()}</p>
      )}
    </div>
  );
}
