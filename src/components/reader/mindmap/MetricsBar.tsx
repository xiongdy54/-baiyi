// 材料导图 v2 · 实测读数条（MINDMAP-V2-IMPL-PLAN §5.2）。
// 模型 · 首节点 · 框架完成 · 调用（缓存）· token 入/出 · 思考字数 · 丢弃行（按原因）· 关系丢弃 · 并发（降档）+「复制读数」。
// 数据来自 delta.metrics；重开页签由 MindmapTab 调 graphMetrics 补齐。字段口径见 src/lib/mindmapV2.ts metricsSegments。
import { useState } from "react";
import type { RunMetrics } from "../../../lib/mindmap/v2/types";
import { metricsCopyText, metricsSegments } from "../../../lib/mindmapV2";
import { useT } from "../../../lib/i18n";

export default function MetricsBar({ metrics }: { metrics: RunMetrics | null }) {
  const T = useT();
  const [copied, setCopied] = useState(false);
  if (!metrics) return null;
  const segs = metricsSegments(metrics, T);
  const copy = async () => {
    const text = metricsCopyText(metrics, T);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* 忽略 */
      }
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="mm2-metrics" role="status" aria-label={T("实测读数")}>
      <span className="mm2-metrics-text">
        {segs.map((s, i) => (
          <span key={i} className="mm2-metrics-seg">
            {i > 0 ? " · " : ""}
            {s.text}
          </span>
        ))}
      </span>
      <button className="btn btn-outline btn-sm mm2-metrics-copy" onClick={() => void copy()}>
        {copied ? T("已复制") : T("复制读数")}
      </button>
    </div>
  );
}
