// 查看原图 lightbox（v35）：应用内全图查看——遮挡显隐切换 + 滚轮/按钮缩放 + Esc/背景关闭。
// 第二查看交互（不进阅读器）：复习与卡片浏览的图片卡共用，遮挡渲染与复习卡面同组件（OcclusionShapes）。
import { useLayoutEffect, useRef, useState } from "react";
import { useDialogA11y } from "../lib/dialogA11y";
import { useOverlayBackdrop } from "../lib/overlayDismiss";
import { fitImage } from "../lib/imageFit.mjs";
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
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [box, setBox] = useState({ w: 0, h: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const panelRef = useDialogA11y<HTMLDivElement>(onClose);
  const backdrop = useOverlayBackdrop(panelRef, onClose, {
    isBlank: (target, currentTarget) =>
      target === currentTarget ||
      (target instanceof Element && target.classList.contains("image-lightbox-stage"))
  });
  const T = useT();

  const clamp = (v: number) => Math.min(4, Math.max(0.4, v));

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || natural.w <= 0 || natural.h <= 0) {
      if (box.w || box.h) setBox({ w: 0, h: 0 });
      return;
    }
    const measure = () => {
      const cs = getComputedStyle(stage);
      const availableW = stage.clientWidth - parseFloat(cs.paddingLeft || "0") - parseFloat(cs.paddingRight || "0");
      const availableH = stage.clientHeight - parseFloat(cs.paddingTop || "0") - parseFloat(cs.paddingBottom || "0");
      const fitted = fitImage(natural.w, natural.h, availableW, availableH, scale);
      setBox((prev) => (
        Math.abs(prev.w - fitted.width) < 0.5 && Math.abs(prev.h - fitted.height) < 0.5
          ? prev
          : { w: fitted.width, h: fitted.height }
      ));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [natural.w, natural.h, scale]);

  return (
    <div className="modal-backdrop image-lightbox-backdrop" {...backdrop}>
      <div className="image-lightbox" ref={panelRef} role="dialog" aria-modal="true" aria-label={T("原图查看")} onClick={(e) => e.stopPropagation()}>
        <div className="image-lightbox-bar image-overlay-toolbar">
          <span className="image-lightbox-title image-overlay-group">{T("原图")}</span>
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
          ref={stageRef}
          className="image-lightbox-stage"
          onWheel={(e) => {
            e.preventDefault();
            setScale((s) => clamp(+(s - Math.sign(e.deltaY) * 0.1).toFixed(2)));
          }}
        >
          <div
            className="occlusion-stage image-lightbox-occlusion"
            style={box.w > 0 ? { width: `${box.w}px`, height: `${box.h}px` } : { visibility: "hidden" }}
          >
            <img
              src={assetPath}
              alt=""
              className="occlusion-img"
              onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            />
            {showShapes && <OcclusionShapes occlusion={{ rects, shapes, regionScope }} cardOrd={cardOrd} />}
          </div>
        </div>
      </div>
    </div>
  );
}
