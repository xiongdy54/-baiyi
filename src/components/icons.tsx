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

type SvgProps = IconProps & {
  /** 非 24×24 图标（如空态插画）时显式给出 viewBox / 宽高 */
  viewBox?: string;
  width?: number;
  height?: number;
  fill?: string;
  stroke?: string;
};

function Svg({
  size = 16,
  strokeWidth = 1.5,
  className,
  title,
  children,
  viewBox = "0 0 24 24",
  width,
  height,
  fill = "none",
  stroke = "currentColor"
}: SvgProps & { children: ReactNode }) {
  return (
    <svg
      width={width ?? size}
      height={height ?? size}
      viewBox={viewBox}
      fill={fill}
      stroke={stroke}
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

/* ---------- v48.15 / D51 书架重设计新增（全部为 Lucide 路径内联） ---------- */

/** 书籍语言（v38 D35 的语言路由信号；v48.15 起由卡面原生 select 换成图标 + 菜单） */
export const IconLanguages = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 8 6 6" />
    <path d="m4 14 6-6 2-3" />
    <path d="M22 10l-4 6-4-6" />
    <path d="M14 18h4" />
  </Svg>
);

/** 视图：封面墙 */
export const IconLayoutGrid = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </Svg>
);

/** 视图：目录表 */
export const IconList = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 6h13" />
    <path d="M8 12h13" />
    <path d="M8 18h13" />
    <path d="M3 6h.01" />
    <path d="M3 12h.01" />
    <path d="M3 18h.01" />
  </Svg>
);

/** 文件夹（打开文件夹 / 空文件夹示意） */
export const IconFolder = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </Svg>
);

/** 归入文件夹 / 新建文件夹并放入 */
export const IconFolderPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    <path d="M12 10v6" />
    <path d="M9 13h6" />
  </Svg>
);

/** 文件夹操作菜单（SVG 三点，替代被禁止的「⋮」字符） */
export const IconEllipsis = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </Svg>
);

/** 返回书架 */
export const IconArrowLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </Svg>
);

/** 书架空态插画（v49.90 / D257）：品牌设计系统「空状态 empty」——地平线 + 点线螺旋 + 种子。
 *  参数与点线坐标照抄 nutation-design docs/10-components.md「空状态」与
 *  assets/components/empty-light.svg；颜色全部走 theme.css 的角色 Token
 *  （--border-strong / --accent / --dot / --empty-seed-line）。 */
const EMPTY_SEED_DOTS: ReadonlyArray<readonly [number, number]> = [
  [112.8, 90.4], [119.2, 85.0], [123.8, 78.1], [123.7, 69.9], [118.5, 63.4],
  [111.2, 59.3], [103.1, 57.1], [94.7, 56.5], [86.5, 58.1], [85.3, 64.3],
  [93.3, 66.8], [101.7, 67.0], [109.9, 65.7], [117.9, 63.0], [124.9, 58.5],
  [129.7, 51.7], [130.0, 43.4], [126.5, 35.8], [121.0, 29.5], [114.3, 24.4],
  [106.9, 20.6]
];

export function EmptyShelfArt({ className }: { className?: string }) {
  return (
    <Svg viewBox="0 0 200 130" width={200} height={130} stroke="none" className={className}>
      <path className="shelf-empty-ground" d="M40 96H160" />
      <g className="shelf-empty-trace" opacity="0.5">
        {EMPTY_SEED_DOTS.map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r={1.8} />
        ))}
      </g>
      <g transform="translate(100 109)">
        <path
          className="shelf-empty-seed"
          d="M-9.425 0C-4.24125 -5.7681 4.7125 -6.1074 9.048 -1.131Q10.3675 0 9.048 1.131C4.7125 6.1074 -4.24125 5.7681 -9.425 0Z"
          transform="rotate(-32)"
        />
        <path
          className="shelf-empty-seam"
          d="M-4.71 0.33Q0 -1.43 5.18 0.13"
          transform="rotate(-32)"
        />
      </g>
    </Svg>
  );
}
