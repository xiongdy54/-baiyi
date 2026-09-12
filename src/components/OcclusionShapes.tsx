// 遮挡区域渲染（v25）：shapes（矩形/椭圆/多点多边形）为精确轮廓；无 shapes 时回退 rects 矩形（存量卡）。
// 展示规范（v16-c，用户钦定）：正面 = 原始图片 + 遮挡块（考察区域 accent、其余区域 ink）；答案面 = 原始图片无覆盖。
// 复习端（CardBrowser.CardFace）与 AI 确认面板共用本组件，保证同一份 occlusion_json 两处渲染一致。
import { occlusionShapes, shapeToSvg, type OcclusionShape } from "../lib/occlusion";

export interface OcclusionLike {
  assetPath?: string;
  rects?: { x: number; y: number; w: number; h: number; ord: number }[];
  shapes?: (OcclusionShape | null | undefined)[] | null;
}

export function occlusionShapeList(occlusion: OcclusionLike | null | undefined): OcclusionShape[] {
  return occlusionShapes(occlusion ?? null);
}

export default function OcclusionShapes({
  occlusion,
  cardOrd,
  hidden,
  variant = "card"
}: {
  occlusion: OcclusionLike | null | undefined;
  /** 本卡考察的区域序号（accent 高亮） */
  cardOrd: number;
  /** 答案面：不渲染任何遮挡 */
  hidden?: boolean;
  /** card=复习卡面（考察区 accent 填充、其余 ink 填充）；proposal=AI 确认面板（全部描边预览） */
  variant?: "card" | "proposal";
}) {
  if (hidden) return null;
  const shapes = occlusionShapeList(occlusion);
  if (shapes.length === 0) return null;
  return (
    <svg className="occlusion-shapes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {shapes.map((s, i) => {
        const { tag, attrs } = shapeToSvg(s);
        const ord = Number.isFinite(Number(s.ord)) ? Number(s.ord) : i;
        const cls =
          variant === "proposal"
            ? "occlusion-shape occlusion-proposal"
            : `occlusion-shape ${ord === cardOrd ? "occlusion-exam" : "occlusion-hidden"}`;
        const common = { className: cls, vectorEffect: "non-scaling-stroke" as const };
        if (tag === "ellipse") return <ellipse key={i} {...(attrs as object)} {...common} />;
        if (tag === "polygon") return <polygon key={i} {...(attrs as object)} {...common} />;
        return <rect key={i} {...(attrs as object)} {...common} />;
      })}
    </svg>
  );
}
