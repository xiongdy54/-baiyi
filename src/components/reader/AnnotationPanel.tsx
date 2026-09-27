// 批注栏（批 4 Task 13，规格 §5.3 / §5.4 R24/R28/R32/R33/R39）。
// 形态（样张 design-samples/annotation-two-modes.html 对版）：
//   · 条目：左竖线（段锚＝批注色实色 / 整卡＝--accent）+ 方点 + 所引原文（2 行截断）+ 批注文字 + 时间（mono）。
//   · **整卡批注恒置顶**（R32：任何排序下都成立）——整块 --accent-soft 底 + 左缘 2px --accent，色点 --accent。
//   · **段锚左竖线＝文中高亮同色**（R33）：竖线 2px 实色（--annot-*），文中高亮＝该 token 的透明档。
//   · **两类可辨**（R39）：摘录＝实心方点 + 「摘录」标签；纯高亮＝空心方点 + 「高亮」标签。
//   · **没写批注就不显示批注行**（不放占位字）；纯高亮不画角标（那是绘制层的事）。
//   · 筛选段控「全部/摘录/高亮」；排序段控「位置/时间」（会话内视图偏好，**不落设置键**）。
//   · 条目内联编辑批注（失焦保存）、删除带就地二次确认、色点可点改色。
import { useEffect, useRef, useState } from "react";
import { annotColorCss } from "../AnnotationEditor";

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
  width = 280
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
  /** 改色（色点下拉选色） */
  onColor: (item: AnnotItem, color: string) => void;
  /** 删除整条（调用方已含确认？——本组件就地二次确认后再调它） */
  onDelete: (item: AnnotItem) => void;
  /** 用户色板（设置键 annotatePalette） */
  palette: readonly string[];
  width?: number;
}) {
  const [sort, setSort] = useState<AnnotSort>("pos");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [colorFor, setColorFor] = useState<string | null>(null);
  const boxRef = useRef<HTMLElement | null>(null);

  // 点别处收起色点下拉
  useEffect(() => {
    if (!colorFor) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && boxRef.current?.contains(t)) return;
      setColorFor(null);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [colorFor]);

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
      <div className="annot-side-head">
        <span className="mono" data-annot-count>{`注解 ${listed.length}`}</span>
        <span className="filter" data-annot-filterseg>
          {([["all", "全部"], ["extract", "摘录"], ["highlight", "高亮"]] as const).map(([id, label]) => (
            <button key={id} className={filter === id ? "on" : ""} data-f={id} onClick={() => onFilter(id)}>
              {label}
            </button>
          ))}
        </span>
        <span className="sort" data-annot-sortseg>
          {([["pos", "位置"], ["time", "时间"]] as const).map(([id, label]) => (
            <button key={id} className={sort === id ? "on" : ""} data-sort={id} onClick={() => setSort(id)}>
              {label}
            </button>
          ))}
        </span>
      </div>

      <div className="annot-side-body" data-annot-list>
        {listed.map((it) => {
          const isWhole = it.anchorWhole;
          // R32/R33 的颜色口径：整卡＝accent；段锚＝该条自己的批注色
          const lineCss = isWhole ? "var(--accent)" : annotColorCss(it.color);
          const dotCss = isWhole ? "var(--accent)" : annotColorCss(it.color);
          return (
            <div
              key={it.id}
              className={`zitem${isWhole ? " whole" : ""}${currentId === it.id ? " on" : ""}`}
              data-zitem=""
              data-annot-id={it.id}
              data-kind={it.kind}
              data-whole={isWhole ? "1" : undefined}
              style={{ "--zline": lineCss } as React.CSSProperties}
            >
              {/* R39：摘录＝实心方点；纯高亮＝空心方点（不靠颜色区分——颜色已被批注色占用） */}
              <i className={`mark-kind${it.kind === "extract" ? " k-extract filled" : " k-extract"}`} data-kindmark="" style={{ color: dotCss }} />
              <div className="annot-body">
                <p className={`zq${isWhole ? " tag-whole" : ""}`} data-zq>
                  {isWhole ? "本条批注 · 锚在整卡" : it.quote}
                </p>
                {/* 「没写批注就不显示批注行」（R33）：纯高亮与无批注条目只留引文 */}
                {editingId === it.id ? (
                  <textarea
                    className="annot-edit"
                    data-annot-edit
                    rows={3}
                    value={draft}
                    autoFocus
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
                    title="点一下改批注"
                    onClick={() => {
                      setEditingId(it.id);
                      setDraft(it.comment ?? "");
                    }}
                  >
                    {it.comment}
                  </p>
                ) : null}
                <p className="zmeta mono">
                  <span>{fmtTime(it.time)}</span>
                  <span className={`kind-tag${it.kind === "extract" ? " t-extract" : ""}`} data-kindtag>
                    {it.kind === "extract" ? "摘录" : "高亮"}
                  </span>
                  <span>{isWhole ? "整卡" : "段锚"}</span>
                  <span className="annot-acts">
                    {/* 色点：点开用户色板改色（复用调色排尺度） */}
                    <button
                      type="button"
                      className="annot-dot"
                      data-annot-color
                      title="改高亮颜色"
                      aria-label="改高亮颜色"
                      style={{ background: dotCss }}
                      onClick={() => setColorFor(colorFor === it.id ? null : it.id)}
                    />
                    <button type="button" className="annot-act" data-annot-jump onClick={() => onJump(it)}>
                      定位
                    </button>
                    {confirmId === it.id ? (
                      <>
                        <button type="button" className="annot-del" data-annot-del-confirm onClick={() => { onDelete(it); setConfirmId(null); }}>
                          确认删除
                        </button>
                        <button type="button" className="annot-act" data-annot-del-cancel onClick={() => setConfirmId(null)}>
                          取消
                        </button>
                      </>
                    ) : (
                      <button type="button" className="annot-del" data-annot-del onClick={() => setConfirmId(it.id)}>
                        {/* 整卡批注＝本卡自身的元批注：删它＝**清掉这条批注**，绝不删用户的卡
                            （R36 的「删除摘录/删除高亮」说的是段锚注解那条独立行） */}
                        {isWhole ? "删除批注" : it.kind === "highlight" ? "删除高亮" : "删除摘录"}
                      </button>
                    )}
                  </span>
                </p>
                {colorFor === it.id && (
                  <div className="palette" data-annot-palette>
                    {palette.map((c) => (
                      <button
                        key={c}
                        type="button"
                        data-annot-pick={c}
                        title={c}
                        aria-label={`改为 ${c}`}
                        style={{ background: annotColorCss(c) }}
                        onClick={() => {
                          onColor(it, c);
                          setColorFor(null);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {listed.length === 0 && <p className="annot-empty mono">（筛选后无条目）</p>}
      </div>
    </aside>
  );
}
