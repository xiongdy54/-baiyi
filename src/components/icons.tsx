import type { ReactNode } from "react";

/**
 * 项目内联图标 —— 本地内嵌 Lucide path（ISC 许可、零依赖、无 CDN），
 * 不引入 lucide-react（§4.19 D42-④ / 规则 19「不新增不必要依赖」）。
 *
 * 存在的理由：此前多处用字符代替图标（🔊 / ⚠ / ▾ / × / ⋮⋮），
 * 违反瑞士风禁止清单「emoji 代替图标」「9px 圆点装饰」，且跨平台字形不一致。
 *
 * 规格：尺寸只用 16 / 20 / 24；同一界面 stroke 统一（默认 1.5）；
 * 颜色一律 currentColor，由所在元素的 color Token 决定，深色模式自动跟随。
 */
type IconProps = {
  size?: number;
  strokeWidth?: number;
  className?: string;
  /** 纯装饰时保持默认（aria-hidden）；图标按钮若无任何文字，请改用 aria-label 包在按钮上 */
  title?: string;
};

function Svg({ size = 16, strokeWidth = 1.5, className, title, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/** 关闭 / 移除 */
export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Svg>
);

/** 下拉指示 */
export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

/** 翻页：上一页（阅读器工具栏） */
export const IconChevronLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="m15 18-6-6 6-6" />
  </Svg>
);

/** 翻页：下一页（阅读器工具栏） */
export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 18 6-6-6-6" />
  </Svg>
);

/** 成功确认（用于状态文字前，尺寸跟随字号；规范：状态优先用颜色+文字，图标可选） */
export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);

/** 播放发音 */
export const IconVolume = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 5 6 9H2v6h4l5 4V5z" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
  </Svg>
);

/** 警告（三角 + 感叹号） */
export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Svg>
);

/**
 * 拖拽把手：2×3 直角小方块，而不是 Lucide 原版的六个圆点 ——
 * 瑞士风「用 8×8 直角小方块替代圆点装饰」。格子吸附 4px 网格（24 视口内）。
 */
export const IconGrip = (p: IconProps) => (
  <Svg {...p} strokeWidth={0}>
    <g fill="currentColor" stroke="none">
      {[9, 15].map((x) =>
        [5, 12, 19].map((y) => <rect key={`${x}-${y}`} x={x - 1.5} y={y - 1.5} width={3} height={3} />)
      )}
    </g>
  </Svg>
);

/**
 * 以下四个从「组件里各写一份裸 <svg>」收编而来：
 * 同一支书架加号在 App/Bookshelf/AddBookModal 里被手写了三遍，
 * 线宽分别 1.5 / 1.5 / 2、尺寸 15 / 16 / 24 混着用 —— 图标一致性（P3.6）的缺口就在这。
 */

/** 新建 / 添加 */
export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </Svg>
);

/** 改名 / 编辑 */
export const IconPencil = (p: IconProps) => (
  <Svg {...p}>
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </Svg>
);

/** 删除 */
export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </Svg>
);

/** 导入文件 */
export const IconImport = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v12" />
    <path d="m8 11 4 4 4-4" />
    <path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4" />
  </Svg>
);
