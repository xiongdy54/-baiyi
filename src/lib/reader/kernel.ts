// ReaderKernel——阅读内核防腐层接口（v20，D20）
// 纪律（AI_DEVELOPMENT_GUIDE §7）：业务代码（制卡/摘录/复习/统计等）只允许依赖本模块与 service.ts，
// 禁止直接 import foliate-js；全仓库唯一豁免目录 = src/lib/reader/foliate/**。
// 内核可替换：未来如需更换引擎（如 epub.js 兜底 adapter，见文档可选池），业务代码与存量数据（cfi+anchorText 双锚）不受影响。
// 表述红线：CFI 绑定特定 EPUB 结构、并非永久 ID；定位体系是「可降级恢复」（cfi → 章节索引+文本 → 全文搜索），不是零失效。

export type ReaderLocation = { cfi?: string; fraction?: number; pageIndex?: number };

/** 阅读模式：开放配置对象（未来可扩展字段，不使用封闭枚举） */
export type ReaderModeConfig = {
  flow: "scrolled" | "paged";
  /** 分页模式下的对开双页（仅 paged 生效） */
  spread?: boolean;
};

/** 选区语义数据（纯语义；UI 坐标走 getSelectionGeometry） */
export interface ReaderSelection {
  text: string;
  /** foliate 引擎的 CFI 定位；PDF 引擎无 CFI 时为空（用 pageIndex 定位） */
  cfi?: string;
  /** PDF 引擎的页码定位（0 基）；foliate 引擎为空 */
  pageIndex?: number;
  /** 选区起点附近的原文片段（文本级兜底锚点，约 ≤60 字） */
  anchorText: string;
}

/** 宿主视口坐标（UI 专用，非语义数据） */
export interface ReaderRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 正文图片引用（v25 图片点选聚焦）：语义仅到「哪张图 + 在哪 + 多大」，
 *  字节由壳层按 src 自行取（blob:/data:/bookasset: 同源可 fetch）——内核不搬运图片数据。 */
export interface ReaderImageRef {
  /** 图片源（foliate 渲染期为 blob: URL；粘贴书为原始 src） */
  src: string;
  alt: string;
  /** 显示框在宿主视口中的位置（聚焦动画起点 + 命中判定） */
  rect: ReaderRect;
  naturalWidth: number;
  naturalHeight: number;
  /** v29 图片周边文字上下文（foliate 系=章节 DOM 上 1 段下 2 段；PDF 系=同页文本层文字，限长）。
   *  供 AI 图片制卡结合上下文出题——与图片无关时由模型自行忽略。 */
  contextText?: string;
}

export type ReaderTheme = "paper" | "sepia" | "dark" | "custom";

export interface ReaderAppearance {
  theme: ReaderTheme;
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  /** theme="custom" 时的背景/文字色 */
  bgColor?: string;
  fgColor?: string;
  /** 页边距 px（分页模式生效） */
  margin?: number;
  /** v29 PDF 引擎专用缩放：预设适应模式或百分比（50-300，100=原始大小）；foliate 引擎忽略 */
  zoom?: "page-width" | "page-fit" | number;
}

export interface ReaderTocItem {
  label: string;
  href: string;
  subitems?: ReaderTocItem[];
}

/** 打开书的数据源：原书字节（EPUB/MOBI/FB2/CBZ/PDF） */
export type BookSource = {
  kind: "bytes";
  bytes: Uint8Array;
  /** 文件名（供内核识别格式） */
  name: string;
};

export interface RelocateInfo {
  location: ReaderLocation;
  /** 全书进度 0-1 */
  fraction: number;
  /** foliate 引擎的章节索引；PDF 引擎为空（按页定位） */
  chapterIndex?: number;
  chapterHref?: string;
}

export interface LinkInfo {
  internal: boolean;
  href: string;
}

export interface ReaderKernel {
  open(source: BookSource, init?: { location?: ReaderLocation }): Promise<void>;
  /** 跳转：CFI 位置 / 页码（PDF 引擎）/ 章节索引 / 目录 href / 文本搜索定位（返回是否发生导航） */
  goTo(target: ReaderLocation | { pageIndex: number } | { chapterIndex: number } | { href: string } | { search: string }): Promise<boolean>;
  /** 翻页（异步：杜绝「翻页后立刻读位置拿到旧值」的竞态）；boolean=是否发生导航（书边界返回 false） */
  next(): Promise<boolean>;
  prev(): Promise<boolean>;
  setMode(mode: ReaderModeConfig): Promise<void>;
  applyAppearance(appearance: ReaderAppearance): void;
  getTOC(): ReaderTocItem[];
  /** 当前选区语义数据（制卡管线唯一入口）；无选区返回 null */
  getSelection(): ReaderSelection | null;
  /** 选区几何（宿主视口坐标）；仅供浮动菜单定位，非语义数据 */
  getSelectionGeometry(): ReaderRect | null;
  /** 清除当前选区（选区菜单动作完成后由壳层调用） */
  deselect(): void;
  getCurrentLocation(): ReaderLocation | null;
  destroy(): void;
  /** 重定位（进度/统计/目录高亮数据源） */
  on(event: "relocate", handler: (info: RelocateInfo) => void): () => void;
  /** 链接点击（internal=false 为外链，壳层负责系统浏览器打开并已拦截默认行为） */
  on(event: "link", handler: (info: LinkInfo) => void): () => void;
  /** 正文内指针抬起（宿主坐标；壳层在此刻调用 getSelection 决定是否弹菜单） */
  on(event: "contentPointerUp", handler: (pos: { x: number; y: number }) => void): () => void;
  /** 正文图片点击（v25）：壳层据此进入图片聚焦（上浮 + 周围模糊 + 选区工具条） */
  on(event: "imageClick", handler: (image: ReaderImageRef) => void): () => void;
}
