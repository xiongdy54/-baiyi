// 查看原图 lightbox（v35）：应用内全图查看——遮挡显隐切换 + 滚轮/按钮缩放 + Esc/背景关闭。
// 第二查看交互（不进阅读器）：复习与卡片浏览的图片卡共用，遮挡渲染与复习卡面同组件（OcclusionShapes）。
import { useState } from "react";
import { useDialogA11y } from "../lib/dialogA11y";
import OcclusionShapes from "./OcclusionShapes";
import type { OcclusionShape } from "../lib/occlusion";
import { useT } from "../lib/i18n";

export default function ImageLightbox({
  assetPath,
  rects,
  shapes,
  regionScope,
  cardOrd,
  onClose
}: {
  assetPath: string;
  rects: { x: number; y: number; w: number; h: number; ord: number }[];
  shapes?: OcclusionShape[] | null;
  regionScope?: string;
  cardOrd: number;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [showShapes, setShowShapes] = useState(true);
  // 此前本组件是全仓唯一绑定了 Esc 的模态；现统一走 useDialogA11y
  const panelRef = useDialogA11y<HTMLDivElement>(onClose);
  const T = useT();

  const clamp = (v: number) => Math.min(4, Math.max(0.4, v));
  return (
    <div className="modal-backdrop image-lightbox-backdrop" onClick={onClose}>
      <div className="image-lightbox" ref={panelRef} role="dialog" aria-modal="true" aria-label={T("原图查看")} onClick={(e) => e.stopPropagation()}>
        <div className="image-lightbox-bar">
          <span className="image-lightbox-title">{T("原图")}</span>
          <div className="image-lightbox-tools">
            {rects.length > 0 && (
              <button className="btn btn-outline btn-sm" onClick={() => setShowShapes((v) => !v)}>
                {showShapes ? T("隐藏遮挡") : T("显示遮挡")}
              </button>
            )}
            <button className="btn btn-outline btn-sm" aria-label={T("缩小")} onClick={() => setScale((s) => clamp(+(s - 0.2).toFixed(2)))}>−</button>
            <span className="mono image-lightbox-zoom">{Math.round(scale * 100)}%</span>
            <button className="btn btn-outline btn-sm" aria-label={T("放大")} onClick={() => setScale((s) => clamp(+(s + 0.2).toFixed(2)))}>＋</button>
            <button className="btn btn-secondary btn-sm" onClick={onClose}>{T("关闭")}</button>
          </div>
        </div>
        <div
          className="image-lightbox-stage"
          onWheel={(e) => {
            e.preventDefault();
            setScale((s) => clamp(+(s - Math.sign(e.deltaY) * 0.1).toFixed(2)));
          }}
        >
          <div className="occlusion-stage image-lightbox-occlusion" style={{ transform: `scale(${scale})` }}>
            <img src={assetPath} alt="" className="occlusion-img" />
            {showShapes && <OcclusionShapes occlusion={{ rects, shapes, regionScope }} cardOrd={cardOrd} />}
          </div>
        </div>
      </div>
    </div>
  );
}
