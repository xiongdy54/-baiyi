// v48.85（D129，B2 / 设计稿 §5.1）：复习页微反馈条组件。
// 形态：绝对定位浮层（.growth-toast，不占布局流 → 结构性保证「不推挤卡面」）；单槽替换由父组件
// （ReviewView）以新 state 直接覆盖 + key 重挂实现（新命中直接替换，不排队不堆叠）。
// 行为：5s 计时从渲染完成起算（D129-G5 定稿值）；「证据」展开走 MOTION-DESIGN-SPEC §7 折叠模式
// （.collapse-clip grid 0fr↔1fr），展开期暂停自动消失计时、收起后重新计时；出场动画完卸载。
// 无障碍：role="status" + aria-live="polite"（评分后焦点不在条上）；不抢焦点、不注册任何快捷键（§6.6.2）。
import { useCallback, useEffect, useRef, useState } from "react";
import type { GrowthEventHit } from "../lib/growth";
import { growthEventText, growthEvidenceLines } from "../lib/growthStrings";

// 5s 自动消失（§5.1 行为细则：4–6s 取中，D129-G5 定稿；JS 计时器非动画参数）
const AUTO_DISMISS_MS = 5000;

export default function GrowthToast({ hit, onDone }: { hit: GrowthEventHit; onDone: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const doneRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  }, [onDone]);

  // 自动消失计时：只在收起态计时（展开期暂停，收起后重新计时——§5.1 行为细则）
  useEffect(() => {
    if (expanded || closing) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    timerRef.current = window.setTimeout(() => setClosing(true), AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [expanded, closing]);

  // 出场：--dur-exit(100ms) 动画完卸载（动画规则在 no-preference 作用域，theme.css §5.1 动效表）；
  // reduce 档无动画 → 立即卸载（显示/消失瞬时，§5.1 reduce 行）；兜底定时器防 animationend 丢失
  // （间隔略长于 --dur-exit(100ms) 的安全值，仅 JS 兜底非动画声明）。
  useEffect(() => {
    if (!closing) return;
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      finish();
      return;
    }
    const fallback = window.setTimeout(finish, 300);
    return () => window.clearTimeout(fallback);
  }, [closing, finish]);

  const lines = growthEvidenceLines(hit);

  return (
    <div
      className={`growth-toast${closing ? " is-closing" : ""}`}
      role="status"
      aria-live="polite"
      data-growth-toast
      data-growth-tier={hit.tier}
      data-growth-event={hit.type}
      onAnimationEnd={(e) => {
        // 只认出场动画（入场动画 growth-toast-in 的 animationend 不可触发卸载）
        if (e.animationName === "growth-toast-out") finish();
      }}
    >
      <p className="growth-toast-text">{growthEventText(hit)}</p>
      {lines.length > 0 && (
        <button
          type="button"
          className="growth-toast-more"
          data-testid="growth-toast-expand"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          证据
        </button>
      )}
      {/* 证据链：组内卡 / 来源材料 / 相关日志摘要（mono meta 行），§6.6.2 可追溯；
          折叠走 §7 通用模式（.collapse-clip 0fr↔1fr），展开/收起由 aria-expanded 与类名同步 */}
      <div className={`collapse-clip${expanded ? " is-open" : ""}`} data-growth-detail>
        <div className="collapse-inner">
          <div className="growth-toast-detail">
            {lines.map((l, i) => (
              <p key={i} className="mono">
                {l}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
