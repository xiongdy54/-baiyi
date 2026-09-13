// 遮挡区域渲染（v25）：shapes（矩形/椭圆/多点多边形）为精确轮廓；无 shapes 时回退 rects 矩形（存量卡）。
// 展示规范（v16-c 定、v30 修订用户拍板）：正面 = 原始图片 + 遮挡块——**默认全部遮挡块用考察区
// accent 色**（D26 起遮挡区域每卡自带，卡上的每块都是本卡考察区，同遮同答同色）；
// 仅当 occlusion_json 显式 regionScope:"shared"（旧 v1 共享区域链路：json 含全图所有区域、
// cardOrd 选中考察区）时保留「考察区 accent、其余区域 ink」的旧语义。答案面 = 原始图片无覆盖。
// 复习端（CardBrowser.CardFace）与 AI 确认面板共用本组件，保证同一份 occlusion_json 两处渲染一致。
import { occlusionShapes, shapeToSvg, type OcclusionShape } from "../lib/occlusion";

export interface OcclusionLike {
  assetPath?: string;
  rects?: { x: number; y: number; w: number; h: number; ord: number }[];
  shapes?: (OcclusionShape | null | undefined)[] | null;
  /** v30：区域归属——"shared"=json 含多卡共享的全图区域（按 cardOrd 单区高亮）；缺省=每卡自带（全 accent） */
  regionScope?: string;
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
  // v30（用户拍板）：默认每卡自带区域全部 accent（同遮同答同色）；shared 才按 cardOrd 单区高亮
  const shared = occlusion?.regionScope === "shared";
  return (
    <svg className="occlusion-shapes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {shapes.map((s, i) => {
        const { tag, attrs } = shapeToSvg(s);
        const ord = Number.isFinite(Number(s.ord)) ? Number(s.ord) : i;
        const cls =
          variant === "proposal"
            ? "occlusion-shape occlusion-proposal"
            : `occlusion-shape ${shared && ord !== cardOrd ? "occlusion-hidden" : "occlusion-exam"}`;
        const common = { className: cls, vectorEffect: "non-scaling-stroke" as const };
        if (tag === "ellipse") return <ellipse key={i} {...(attrs as object)} {...common} />;
        if (tag === "polygon") return <polygon key={i} {...(attrs as object)} {...common} />;
        return <rect key={i} {...(attrs as object)} {...common} />;
      })}
    </svg>
  );
}
