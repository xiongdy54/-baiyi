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

/** 图片定位查询（v35）：按 alt/周边文字在正文中找回原图 */
export interface ImageLocateQuery {
  alt?: string;
  contextText?: string;
}

/** 图片定位命中（v35）：宿主视口坐标框，供叠加图内区域高亮 */
export interface ImageLocateHit {
  rect: ReaderRect;
}

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

/** 提取单元信息（v48 批1，§4.19-4）：文档序的原子文本区间锚。
 *  foliate 引擎 = spine section（anchor 即 section href）；PDF 引擎 = 逐页（anchor = "pdfpage:<0基页码>"，与目录 href 同域）。
 *  目录锚（可含 #fragment）经 baseOf 归一后匹配到单元；anchor 可回喂 getSectionText / goTo。 */
export interface SectionUnitInfo {
  anchor: string;
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

/** 正文内指针抬起载荷（宿主视口坐标 + 指针事件的修饰位；修饰位供多段选择判定，见 §6.8-11） */
export interface ContentPointerUpInfo {
  x: number;
  y: number;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}

/** 源文档锚点几何（v48.24 批3 §4「文中留痕」的写入侧）：当前选区在**源文档**里的落点。
 *  PDF＝0 基页码 + 该页内**百分比矩形**（0-100，与 occlusion 同一坐标口径，换算走同一实现面）；
 *  EPUB 不回矩形（cfi 已表达位置，见 ReaderSelection.cfi）。 */
export interface SourceAnchorGeometry {
  pageIndex?: number;
  rects?: { x: number; y: number; w: number; h: number; ord: number }[];
}

/** 文中留痕（v48.24 批3 §4）：一条根摘录在**文档正文里**的只读标记。
 *  数据面由壳层给（源＝根摘录 `contextRef.sourceAnchor`），**绘制与命中全在内核**——
 *  页容器/章节 iframe 的 DOM 只在 adapter 里碰（防腐层纪律），业务层拿不到。 */
export interface ReaderDocMark {
  /** 摘录 id：指针事件与浮层都按它回查数据 */
  id: string;
  /** 标记原文（浮层第一行）＝摘录正文 */
  text: string;
  /** 读者批注（有则 PDF 加角标、浮层多一行） */
  comment?: string | null;
  /** 批 4（R33/Task 16）：批注色（色板 id 或 #hex）——角标**必须**跟随它（§5.2 硬约束①） */
  color?: string | null;
  /** 批 4（R39/Task 16）：分族——`highlight`＝纯高亮（**不画角标**，§5.4） */
  kind?: "highlight" | "extract";
  /** 已制卡数（浮层信息行） */
  cardCount?: number;
  /** EPUB：根锚 cfi（cfi → Range 画 ::highlight） */
  cfi?: string;
  /** PDF：0 基页码 + 该页内百分比矩形 */
  pageIndex?: number;
  rects?: { x: number; y: number; w: number; h: number; ord?: number }[];
}

/** 文中标记的指针事件载荷（宿主视口坐标；rect＝命中标记的包围盒，浮层按它定位） */
export interface MarkPointerInfo {
  /** 指针进入的标记 id；null＝离开了全部标记（markHover 专用） */
  id: string | null;
  rect: ReaderRect | null;
}

export interface ReaderKernel {
  open(source: BookSource, init?: { location?: ReaderLocation }): Promise<void>;
  /** 跳转：CFI 位置 / 页码（PDF 引擎）/ 章节索引 / 目录 href / 文本搜索定位（返回是否发生导航） */
  goTo(target: ReaderLocation | { pageIndex: number } | { chapterIndex: number } | { href: string } | { search: string }): Promise<boolean>;
  /** 按标记 id 精确定位，并仅使用引擎支持的锚点（EPUB：CFI；PDF：pageIndex + rects）。
   *  无匹配标记或锚点不可解析时返回 false；不回退到文本搜索。 */
  goToMark(id: string): Promise<boolean>;
  /** 翻页（异步：杜绝「翻页后立刻读位置拿到旧值」的竞态）；boolean=是否发生导航（书边界返回 false） */
  next(): Promise<boolean>;
  prev(): Promise<boolean>;
  setMode(mode: ReaderModeConfig): Promise<void>;
  applyAppearance(appearance: ReaderAppearance): void;
  getTOC(): ReaderTocItem[];
  /** 提取单元清单（v48 批1 §4.19-4，可选能力）：文档序单元锚数组，线性化坐标系的基础。
   *  引擎未实现（如旧 fake）时业务侧走降级路径（无导图/预览取不到文）。 */
  getSectionAnchors?(): SectionUnitInfo[];
  /** 按提取单元取正文文本（v48 批1 §4.19-4，可选能力，全格式通用，确定性）：
   *  无 endAnchor 取 start 单元自身；有 endAnchor 取 [start, end)（自 start 单元起、至 end 单元开始前，跨单元以 \n 拼接）。
   *  文本形态（canonical）：块间 \n 分隔、块内空白折叠——AI 引文与本地逐字校验必须同用本函数输出，禁止另行归一。 */
  getSectionText?(startAnchor: string, endAnchor?: string): Promise<string>;
  /** 当前选区语义数据（制卡管线唯一入口）；无选区返回 null */
  getSelection(): ReaderSelection | null;
  /** 正文图片定位（v35）：按 alt/周边文字找回原图并滚动到可见；命中返回宿主坐标框，未命中返回 null */
  locateImage?(query: ImageLocateQuery): Promise<ImageLocateHit | null>;
  /** 选区几何（宿主视口坐标）；仅供浮动菜单定位，非语义数据 */
  getSelectionGeometry(): ReaderRect | null;
  /** 清除当前选区（选区菜单动作完成后由壳层调用） */
  deselect(): void;
  /**
   * 多段选择高亮（v48.23 / D61 §6.8-11）：以 CSS Custom Highlight API 在当前选区文档上
   * 并入/移除一段高亮，**不碰正文 DOM**（EditableText 的「React 不接管子节点」契约不受影响）。
   * action 由壳层按修饰键语义给出（replace/append/remove），内核只负责「画到哪一篇文档上」。
   * 引擎不支持时可不实现（壳层按可选能力调用）——此时多段采集与载荷落库仍然成立。
   */
  multiSelectHighlight?(action: "replace" | "append" | "remove"): void;
  /** 清空多段选择高亮（选区清空 / 菜单动作完成 / Esc / 章切换） */
  clearMultiSelectHighlight?(): void;
  /**
   * 文中留痕（v48.24 批3 §4，可选能力）：把「本文档的根摘录标记」交给内核绘制。
   * PDF＝文本层之上的矩形覆盖层；EPUB＝cfi→Range 的 CSS Custom Highlight。两者都不碰正文 DOM。
   * 壳层只给数据；引擎不支持时可不实现（壳层按可选能力调用）。
   * 每次调用整体替换当前标记列表；`goToMark` 按标记 id 精确匹配，并仅使用引擎支持的锚点（EPUB：CFI；PDF：pageIndex + rects）。
   * 无匹配标记或锚点不可解析时返回 false，不回退到文本搜索。
   */
  setDocumentMarks?(marks: ReaderDocMark[]): void;
  /**
   * **引擎侧位置序**（D67 §3，可选能力）：当前可解析成段的标记 id，按文档序（EPUB＝章节序 + Range
   * 文档序）。CFI 只在引擎里 resolve，数据面比不了——PDF 的位置序由数据面算（pageIndex + 首矩形
   * 几何，见 buildAnnotationItems），故 PDF 内核不需要实现它。
   * 不在列＝当前不可解析（老 CFI / 章节未加载）／根本没有锚；调用方按稳定回退接在已定位之后。
   */
  getMarkOrder?(): string[];
  /**
   * 源锚几何采集（v48.24 批3 §4，可选能力）：当前选区在源文档里的落点（PDF 回页内百分比矩形），
   * 供摘录的 `contextRef.sourceAnchor` 落库——留痕据此重画。无选区/引擎无几何概念时返回 null。
   */
  getSourceAnchor?(): SourceAnchorGeometry | null;
  getCurrentLocation(): ReaderLocation | null;
  destroy(): void;
  /** 重定位（进度/统计/目录高亮数据源） */
  on(event: "relocate", handler: (info: RelocateInfo) => void): () => void;
  /** 链接点击（internal=false 为外链，壳层负责系统浏览器打开并已拦截默认行为） */
  on(event: "link", handler: (info: LinkInfo) => void): () => void;
  /** 正文内指针抬起（宿主坐标 + 指针事件的修饰位——多段选择按住 Ctrl 再选时判定用） */
  on(event: "contentPointerUp", handler: (pos: ContentPointerUpInfo) => void): () => void;
  /** 正文图片点击（v25）：壳层据此进入图片聚焦（上浮 + 周围模糊 + 选区工具条） */
  on(event: "imageClick", handler: (image: ReaderImageRef) => void): () => void;
  /** 指针进入/离开文中标记（v48.24 批3 §4）：壳层据此出浮层（原文 + 批注 + 已制卡数 + 就此制卡） */
  on(event: "markHover", handler: (info: MarkPointerInfo) => void): () => void;
  /** 点中文中标记（v48.24 批3 §4）：壳层据此钉住浮层（标记只读，编辑永远在卡片上做） */
  on(event: "markClick", handler: (info: MarkPointerInfo) => void): () => void;
}
