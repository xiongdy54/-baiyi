// 批注栏（批 4 Task 13，规格 §5.3 / §5.4 R24/R28/R32/R33/R39）。
// 形态（源出样张 design-samples/annotation-two-modes.html；v48.82/D126 起条目方点退役，该点不再对版）：
//   · 条目：左竖线（段锚＝批注色实色 / 整卡＝--accent）+ 所引原文（2 行截断）+ 批注文字 + 时间（mono）+ 右缘色条。
//   · **整卡批注恒置顶**（R32）：任何排序下都成立——整块 --accent-soft 底 + 左缘 2px --accent。
//   · **段锚左竖线＝文中高亮同色**（R33）：竖线 2px 实色（--annot-*），文中高亮＝该 token 的透明档。
//   · **两类可辨**（R39，D126 起方点退役）：摘录/高亮由 meta 行 kind-tag（「摘录」/「高亮」标签）独自承担。
//   · **引用式色线 + meta 行 ⋯ 选单（D126 R4.1，Zotero 式）**：色线贴引文行左侧、与其等高（纯指示，
//     不可点）；改色与更多操作（添加/编辑批注、删除）收进 meta 行右端 ⋯ 弹出选单——dd-menu 族样式
//     + §8.4 pop-in 动效，开向随滚动容器底缘翻边；条目不再画任何边线色条（基线与轨内一致）。
//   · **没写批注就不显示批注行**（不放占位字）；纯高亮不画角标（那是绘制层的事）。
//   · 筛选段控「全部/摘录/高亮」；排序段控「位置/时间」（会话内视图偏好，**不落设置键**）。
//   · 条目内联编辑批注（失焦保存）、删除带就地二次确认（入口在 ⋯ 选单，确认态行内常显）。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { annotColorCss } from "../AnnotationEditor";
import { IconEllipsis } from "../icons";
import { useT } from "../../lib/i18n";

export interface AnnotItem {
  id: string;
  kind: "highlight" | "extract";
  /** 所引原文（截断展示） */
  quote: string;
  comment: string | null;
  color: string | null;
  /** 生成时间（毫秒；栏内按 mono 短格式显示） */
  time: number;
  /** 锚在整卡（无区间）＝自身的批注，恒置顶 */
  anchorWhole: boolean;
  /** 有可解析的定位锚（D67 §3）：false＝栏内显示中性「不可定位」（老数据/导航有界失败） */
  locatable?: boolean;
}

export type AnnotFilter = "all" | "extract" | "highlight";
export type AnnotSort = "pos" | "time";

/** 时间显示：与样张同档（MM-DD HH:mm） */
function fmtTime(t: number): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 色板中文名（R4 选单行显示；未知 id 原样、#hex 显示「自定义」） */
const COLOR_NAMES: Record<string, string> = {
  yellow: "黄色", red: "红色", green: "绿色", blue: "蓝色", purple: "紫色",
  teal: "青色", orange: "橙色", magenta: "洋红色", grey: "灰色", gray: "灰色"
};
const colorName = (c: string) => (c.startsWith("#") ? "自定义" : COLOR_NAMES[c] ?? c);

export default function AnnotationPanel({
  items,
  currentId,
  filter,
  onFilter,
  onJump,
  onEdit,
  onColor,
  onDelete,
  palette,
  width = 280,
  showCount = true,
  showHead = true,
  sort: sortProp,
  onSort: onSortProp
}: {
  /** 全部注解（含纯高亮）；排序与置顶由本组件按 R32 处理 */
  items: AnnotItem[];
  /** 文中当前定位的条目（高亮其栏内条目；无＝null） */
  currentId?: string | null;
  filter: AnnotFilter;
  onFilter: (f: AnnotFilter) => void;
  /** 点条目 → 文中滚动到锚点并短暂强调 */
  onJump: (item: AnnotItem) => void;
  /** 内联编辑批注（失焦/回车保存；空串 ⇒ null ＝删批注） */
  onEdit: (item: AnnotItem, comment: string | null) => void;
  /** 改色（右缘色条 → 色板选色） */
  onColor: (item: AnnotItem, color: string) => void;
  /** 删除整条（调用方已含确认？——本组件就地二次确认后再调它） */
  onDelete: (item: AnnotItem) => void;
  /** 用户色板（设置键 annotatePalette） */
  palette: readonly string[];
  /** 占位宽度：摘录页＝280（规格 §5.3）；阅读器右侧栏里传 "100%" 随栏宽 */
  width?: number | string;
  /** 头行「注解 N」计数：摘录页关掉以省一行（v48.33 / D73，用户裁定）；阅读器默认保留 */
  showCount?: boolean;
  /**
   * v48.45（D85）：不渲染栏头行——阅读器侧栏的筛选/排序段控上移到**栏头行**（开关钮旁，
   * 与摘录页批注栏头同一几何），面板本体不再重复表达。缺省 true（摘录页照旧）。
   */
  showHead?: boolean;
  /** v48.45（D85）：排序受控态（宿主＝阅读器栏头段控；缺省＝内部会话态，摘录页照旧） */
  sort?: AnnotSort;
  onSort?: (s: AnnotSort) => void;
}) {
  const T = useT();
  const [sortState, setSortState] = useState<AnnotSort>("pos");
  const sort = sortProp ?? sortState;
  const setSort = (s: AnnotSort) => (onSortProp ? onSortProp(s) : setSortState(s));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number; up: boolean } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLElement | null>(null);

  // 开单（R4.2）：选单改 **fixed 视口定位**——阅读器侧栏的轨（overflow:hidden 开合动画）与列表
  // 滚动容器（overflow:auto）都会把 absolute 选单裁掉/盖住（条目靠可视区底部时实测）。
  // 锚点＝⋯ 钮下缘 +4px、右缘贴条目右缘 -8px；上/下开向在挂载后按选单实高与视口翻边。
  const openMenu = (it: AnnotItem, btn: HTMLButtonElement) => {
    const item = btn.closest(".zitem") as HTMLElement | null;
    const br = btn.getBoundingClientRect();
    const ir = item?.getBoundingClientRect();
    setMenuPos({
      top: br.bottom + 4,
      right: Math.max(8, window.innerWidth - (ir ? ir.right : br.right) + 8),
      up: false
    });
    setMenuFor(menuFor === it.id ? null : it.id);
  };

  // 点别处 / 滚动 / 缩放 / Esc 收起选单（fixed 选单不随列表滚，滚动即收——§8.4 popover 惯例）
  useEffect(() => {
    if (!menuFor) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && boxRef.current?.contains(t)) return;
      setMenuFor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuFor(null);
    };
    const onScrollOrResize = () => setMenuFor(null);
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [menuFor]);

  // 挂载后量选单实高翻边（pre-paint，无闪跳）：下方放不下且上方放得下 → 向上开
  useLayoutEffect(() => {
    if (!menuFor || !menuRef.current || !menuPos) return;
    const menu = menuRef.current;
    const item = menu.closest(".zitem") as HTMLElement | null;
    if (!item) return;
    const ir = item.getBoundingClientRect();
    const mh = menu.offsetHeight;
    const fitsDown = menuPos.top + mh <= window.innerHeight - 8;
    const fitsUp = ir.top - mh >= 8;
    if (!fitsDown && fitsUp) {
      setMenuPos((pos) => (pos ? { ...pos, top: Math.max(8, ir.top - mh - 4), up: true } : pos));
    }
  }, [menuFor]);

  const visible = items.filter((it) => (filter === "all" ? true : it.kind === filter));
  // R32：整卡批注恒置顶（任何排序下都成立）——先按置顶分组，组内再按所选排序
  const whole = visible.filter((it) => it.anchorWhole);
  const anchored = visible.filter((it) => !it.anchorWhole);
  // 「位置」＝保持传入顺序（调用方按文中位置给序）；「时间」＝按 time 升序
  const sortedAnchored = sort === "time" ? [...anchored].sort((a, b) => a.time - b.time) : anchored;
  const listed = [...whole, ...sortedAnchored];

  const commitEdit = (it: AnnotItem) => {
    const next = draft.trim();
    if (next !== (it.comment ?? "")) onEdit(it, next ? next : null);
    setEditingId(null);
  };

  return (
    <aside className="annot-side" ref={boxRef} style={{ width }} data-annot-panel>
      {showHead && (
      <div className="annot-side-head">
        {showCount && <span className="mono" data-annot-count>{T("注解 {n}", { n: listed.length })}</span>}
        <span className="filter" data-annot-filterseg>
          {([["all", "全部"], ["extract", "摘录"], ["highlight", "高亮"]] as const).map(([id, label]) => (
            <button key={id} className={filter === id ? "on" : ""} data-f={id} onClick={() => onFilter(id)}>
              {T(label)}
            </button>
          ))}
        </span>
        <span className="sort" data-annot-sortseg>
          {([["pos", "位置"], ["time", "时间"]] as const).map(([id, label]) => (
            <button key={id} className={sort === id ? "on" : ""} data-sort={id} onClick={() => setSort(id)}>
              {T(label)}
            </button>
          ))}
        </span>
      </div>
      )}

      <div className="annot-side-body" data-annot-list>
        {listed.map((it) => {
          const isWhole = it.anchorWhole;
          // R32/R33 的颜色口径：整卡＝accent；段锚＝该条自己的批注色——引用式色线与文中高亮同源
          const annotCss = isWhole ? "var(--accent)" : annotColorCss(it.color);
          return (
            <div
              key={it.id}
              className={`zitem${isWhole ? " whole" : ""}${currentId === it.id ? " on" : ""}${menuFor === it.id ? " menu-open" : ""}${confirmId === it.id ? " confirming" : ""}`}
              data-zitem=""
              data-annot-id={it.id}
              data-kind={it.kind}
              data-whole={isWhole ? "1" : undefined}
              role="button"
              tabIndex={0}
              title={T("点击条目：文中跳到锚点并短暂强调")}
              onClick={() => {
                // 点条目＝跳转（样张 §5.3「点击条目 → 文中滚动到锚点并短暂强调」）；
                // ⋯ 选单 / 删除确认 / 输入区不触发（各自 stopPropagation）；选单开着时点条目＝先收单
                if (menuFor === it.id) {
                  setMenuFor(null);
                  return;
                }
                if (confirmId !== it.id && editingId !== it.id) onJump(it);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onJump(it);
                }
              }}
            >
              <div className="annot-body">
                {/* R4.1：色线改引用样式——贴着引文行、与其等高（原文两行），距条目左缘一个内距 */}
                <div className="zbody-quote">
                  <i className="zbar" data-annot-color="" aria-hidden="true" style={{ background: annotCss }} />
                  <p className={`zq${isWhole ? " tag-whole" : ""}`} data-zq>
                    {isWhole ? T("本条批注 · 锚在整卡") : it.quote}
                  </p>
                </div>
                {/* 「没写批注就不显示批注行」（R33）：纯高亮与无批注条目只留引文 */}
                {editingId === it.id ? (
                  <textarea
                    className="annot-edit"
                    data-annot-edit
                    rows={3}
                    value={draft}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commitEdit(it)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setEditingId(null);
                      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        commitEdit(it);
                      }
                    }}
                  />
                ) : it.comment ? (
                  <p
                    className="zn"
                    data-zn
                    title={T("点一下改批注")}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingId(it.id);
                      setDraft(it.comment ?? "");
                    }}
                  >
                    {it.comment}
                  </p>
                ) : null}
                {/* meta 行严格照样张：时间 · 类型标签 · 段锚/整卡（三项）。
                    删除只在 hover/键盘聚焦时显形——样张的静态形态里没有动作按钮，
                    常驻会把「高亮」标签挤成竖排（实测）。 */}
                <p className="zmeta mono">
                  <span>{fmtTime(it.time)}</span>
                  <span className={`kind-tag${it.kind === "extract" ? " t-extract" : ""}`} data-kindtag>
                    {it.kind === "extract" ? T("摘录") : T("高亮")}
                  </span>
                  {it.locatable === false ? (
                    <span className="kind-tag t-unlocated" data-annot-unlocated title={T("这条没有可定位的锚点（老数据或导航失败）")}>
                      {T("不可定位")}
                    </span>
                  ) : (
                    <span>{isWhole ? T("整卡") : T("段锚")}</span>
                  )}
                  {/* 删除确认态（R4：删除入口在 ⋯ 选单里；确认/取消回到行内常显——§8.2 破坏性操作退路） */}
                  {confirmId === it.id && (
                    <span className="annot-acts">
                      <button
                        type="button"
                        className="annot-del"
                        data-annot-del-confirm
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(it);
                          setConfirmId(null);
                        }}
                      >
                        {T("确认删除")}
                      </button>
                      <button
                        type="button"
                        className="annot-act"
                        data-annot-del-cancel
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmId(null);
                        }}
                      >
                        {T("取消")}
                      </button>
                    </span>
                  )}
                  {/* R4.1：更多操作钮移入 meta 行右端（不再悬浮在引文上；常显，点它开合 ⋯ 选单） */}
                  <button
                    type="button"
                    className="zdots"
                    data-zdots=""
                    aria-label={T("更多操作")}
                    aria-haspopup="menu"
                    aria-expanded={menuFor === it.id}
                    title={T("更多操作")}
                onClick={(e) => {
                  e.stopPropagation();
                  openMenu(it, e.currentTarget);
                }}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <IconEllipsis size={14} />
                  </button>
                </p>
              </div>
              {/* D126 R4（Zotero 式）：⋯ 选单（换色组 + 编辑批注 + 删除）条件挂载；
                  右缘不再挂任何元素——色线已改引用样式进引文行。keydown 止泡，
                  避免 zitem 的 Enter/Space 跳转 preventDefault 吞掉原生激活。 */}
              {menuFor === it.id && menuPos && (
                <div
                  className={`zmenu dd-menu${menuPos.up ? " dd-menu-up" : " dd-menu-down"}`}
                  data-zmenu=""
                  role="menu"
                  ref={menuRef}
                  style={{ top: menuPos.top, right: menuPos.right }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* 换色组：仅段锚条目显示——整卡批注色恒为 --accent（R32），无换色语义 */}
                  {!isWhole && (
                    <>
                      {palette.map((c) => (
                        <button
                          key={c}
                          type="button"
                          role="menuitemradio"
                          aria-checked={it.color === c}
                          className="dd-item zmenu-color"
                          data-annot-pick={c}
                          title={c}
                          onClick={() => {
                            onColor(it, c);
                            setMenuFor(null);
                          }}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <span className="zmenu-check" aria-hidden="true">{it.color === c ? "✓" : ""}</span>
                          <span className="zmenu-swatch" style={{ background: annotColorCss(c) }} aria-hidden="true" />
                          <span className="zmenu-name">{T(colorName(c))}</span>
                        </button>
                      ))}
                      <div className="zmenu-sep" aria-hidden="true" />
                    </>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className="dd-item"
                    data-annot-editmenu=""
                    onClick={() => {
                      setMenuFor(null);
                      setEditingId(it.id);
                      setDraft(it.comment ?? "");
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <span className="zmenu-check" aria-hidden="true" />
                    <span className="zmenu-name">{it.comment ? T("编辑批注") : T("添加批注")}</span>
                  </button>
                  <div className="zmenu-sep" aria-hidden="true" />
                  <button
                    type="button"
                    role="menuitem"
                    className="dd-item"
                    data-annot-del=""
                    onClick={() => {
                      // 整卡批注＝本卡自身的元批注：删它＝**清掉这条批注**，绝不删用户的卡
                      // （R36 的「删除摘录/删除高亮」说的是段锚注解那条独立行）
                      setMenuFor(null);
                      setConfirmId(it.id);
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <span className="zmenu-check" aria-hidden="true" />
                    <span className="zmenu-name">{isWhole ? T("删除批注") : it.kind === "highlight" ? T("删除高亮") : T("删除摘录")}</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {listed.length === 0 && <p className="annot-empty mono">{T("（筛选后无条目）")}</p>}
      </div>
    </aside>
  );
}
