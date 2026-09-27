// 文中标记的浮层（v48.24 批3 §4 文中留痕）：原文 + 批注文字 + 已制卡数 + 「就此制卡」。
// 只读语义：浮层不改正文、不改摘录（编辑永远在卡片上进行），动作只有「就此制卡」（走既有手动制卡链）。
// 位置（批 4 Task 8 起）：放置算法统一走 src/lib/popoverPlace.ts（与 SelectionMenu、AnnotationEditor 同一份）——
// 实测后再定位，先渲染在视口外一帧（left:-9999）等测量，避免首帧闪到错误位置。
import { useLayoutEffect, useRef, useState } from "react";
import { placePopover } from "../../lib/popoverPlace";
import type { ReaderDocMark, ReaderRect } from "../../lib/reader/service";

export default function MarkPopover({
  mark,
  anchor,
  onMakeCard,
  onKeepOpen,
  onRelease,
  onClose
}: {
  mark: ReaderDocMark;
  /** 命中标记的包围盒（宿主视口坐标） */
  anchor: ReaderRect;
  onMakeCard: () => void;
  /** 指针进入浮层：取消「离开标记就收起」的延时 */
  onKeepOpen: () => void;
  /** 指针离开浮层：未钉住则延时收起 */
  onRelease: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // prefer="below"：标记浮层恒优先钉在标记下方（下方放不下才翻到上方），左右夹在视口内
    const { left, top } = placePopover({
      anchor,
      size: { width: el.offsetWidth, height: el.offsetHeight },
      prefer: "below"
    });
    setPos({ left, top });
  }, [mark.id, mark.comment, mark.cardCount, anchor.x, anchor.y, anchor.width, anchor.height]);

  return (
    <div
      ref={ref}
      className="reader-mark-pop"
      role="dialog"
      aria-label="摘录标记"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
      onMouseEnter={onKeepOpen}
      onMouseLeave={onRelease}
    >
      <p className="reader-mark-pop-quote card-marked">{mark.text}</p>
      {mark.comment ? <p className="reader-mark-pop-comment">{mark.comment}</p> : null}
      <div className="reader-mark-pop-foot">
        <span className="reader-mark-pop-meta">已制卡 {mark.cardCount ?? 0} 张</span>
        <div className="reader-mark-pop-actions">
          <button className="reader-mark-pop-close" onClick={onClose}>
            关闭
          </button>
          <button className="btn btn-outline btn-sm" onClick={onMakeCard}>
            就此制卡
          </button>
        </div>
      </div>
    </div>
  );
}
