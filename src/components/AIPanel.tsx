// AI 面板（解释侧栏 / 制卡预览）
// 批 4（Task 5）：从 Reader.tsx 原样搬出（纯移动，零行为改动）——摘录页与阅读器共用同一份实现。
// v48.51（D91 §5.2/§5.5）：explain 分支首行加三态「解读方式」切换器（等待回答时也可切换，切换即重跑；
// 重跑逻辑在宿主 changeExplainMode）+ 答案尾部的事后建议轻提示行（仅 auto 路由进 ste 且 points=0 且
// 改写≈原文时出现——用户多半更想要概念解释）。
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { lintCard, parseCloze, parseFollowUps, type CardDraft, type CardGenMode, type FollowUpGroup, type OcclusionRegion } from "../lib/cards";
import { sanitizeDomain } from "../lib/udc";
import { isLikelySameText, parseSteMarkers, stripSteMarkers, type ExplainModePref } from "../lib/explainRouter";
import Dropdown from "./Dropdown";
import OcclusionShapes from "./OcclusionShapes";
import { IconAlert } from "./icons";

// 防 AI 返回字段类型漂移导致渲染崩溃（ruleNotes/warnings 可能是字符串）
function toList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string" && v.trim()) return v.split(/[,;；、]/).map((s) => s.trim()).filter(Boolean);
  return [];
}

/**
 * v48.51（D91 §5.2/§4.4）：解读方式三态切换器（自动（默认）｜通用｜简明）。
 * 独立导出：AI 解释页签体的空态指引同位复用（D92——「先开坞、先调方式、内容后到」）。
 * 主文案不出现 ASD-STE100（全球用户不认识该编号，法务上弱化商标使用）。
 */
export function ExplainModeSwitcher({
  value,
  onChange
}: {
  value: ExplainModePref;
  onChange: (m: ExplainModePref) => void;
}) {
  return (
    <div className="ai-explain-mode" data-testid="explain-mode" data-value={value}>
      <span className="ai-explain-mode-label mono">解读方式</span>
      <Dropdown
        align="left"
        title="解读方式"
        value={value}
        options={[
          { value: "auto", label: "自动" },
          { value: "general", label: "通用解读" },
          { value: "ste", label: "简明解读" }
        ]}
        onChange={(m) => onChange(m as ExplainModePref)}
      />
    </div>
  );
}

export default function AIPanel({
  panel,
  onAccept,
  onAcceptOcclusion,
  onEdit,
  onSplitReverse,
  onRejectAll,
  onExplain,
  onMakeCards,
  onModeChange,
  mode = "auto",
  onSearchBackground,
  onFollowUpCards,
  onExploration,
  explainMode = "auto",
  onExplainModeChange,
  elapsedTick = 0
}: {
  panel: {
    kind: "explain" | "cards" | "occlusion";
    text: string;
    answer?: string;
    drafts?: CardDraft[];
    accepted?: Set<number>;
    blockReasons?: string[];
    batchId?: string;
    running: boolean;
    progress?: number;
    thinking?: number;
    startedAt?: number;
    elapsedSec?: number;
    searching?: boolean;
    searched?: boolean;
    error?: string;
    mode?: CardGenMode;
    routeLabel?: string;
    routeForm?: string;
    image?: { dataUrl: string; assetPath: string };
    regions?: OcclusionRegion[];
    kps?: { id: string; summary: string }[];
    supplemental?: Set<number>;
    followUpBusy?: string[];
    followUpStarted?: Record<string, number | undefined>;
    followUpErrors?: Record<string, string>;
    explorations?: {
      id: number;
      item: string;
      kpTitle: string;
      question: string;
      answer?: string;
      running: boolean;
      startedAt?: number;
      thinking?: number;
      error?: string;
    }[];
  };
  onAccept: (draft: CardDraft, draftIndex: number, edited?: Partial<CardDraft>) => Promise<void>;
  onAcceptOcclusion: (draft: CardDraft, draftIndex: number) => Promise<void>;
  onEdit: (draftIndex: number, patch: Partial<CardDraft>) => void;
  onSplitReverse: (draftIndex: number) => void;
  onRejectAll: () => void;
  onExplain: (question: string | null) => void;
  onMakeCards: () => void;
  onModeChange: (mode: CardGenMode) => void;
  mode?: CardGenMode;
  onSearchBackground: () => void;
  onFollowUpCards: (item: string, kpTitle: string, hint?: string) => void;
  onExploration: (item: string, kpTitle: string) => void;
  /** v48.51（D91 §5.2）：解读方式三态（会话内记忆，auto=默认） */
  explainMode?: ExplainModePref;
  /** v48.51（D91 §5.3）：切换即重跑（重发请求在宿主 changeExplainMode） */
  onExplainModeChange?: (m: ExplainModePref) => void;
  elapsedTick?: number;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Record<number, { front?: string; back?: string }>>({});
  // v46（M14-UM2，§6.7.3）：memoryRef 校验失败的卡「情境来源存疑」默认不勾选——接受按钮需二次点击确认
  const [memoryWarnArmed, setMemoryWarnArmed] = useState<Set<number>>(new Set());
  // v48.51（D91 §5.5 事后建议）：仅 auto 路由进 ste 的结果、流式完成后，机器标记 points=0
  // 且改写与原文几乎一致（文本其实清晰，用户多半更想要概念解释）→ 答案尾部一行轻提示。
  // 显式选择「简明解读」= 用户自判需要简化流程，不打扰（§4.1 门控取消的本意）。
  const steMarkers = panel.kind === "explain" && panel.answer ? parseSteMarkers(panel.answer) : null;
  const suggestGeneral =
    panel.kind === "explain" &&
    !!panel.answer &&
    !panel.running &&
    !panel.error &&
    explainMode === "auto" &&
    !!onExplainModeChange &&
    steMarkers !== null &&
    steMarkers.points === 0 &&
    isLikelySameText(panel.text, stripSteMarkers(panel.answer));
  const isOcclusion = panel.kind === "occlusion";
  const followUpGroups: FollowUpGroup[] = panel.kps ? parseFollowUps(panel.kps) : [];
  const nowTick = elapsedTick;
  const busySec = (item: string) => {
    const started = panel.followUpStarted?.[item];
    return started ? Math.max(0, Math.round((nowTick - started) / 1000)) : 0;
  };
  const explSec = (e: { startedAt?: number }) =>
    e.startedAt ? Math.max(0, Math.round((nowTick - e.startedAt) / 1000)) : 0;

  return (
    <div className="ai-panel">
      {/* v48.52（D92 §6.1）：CardDock 头行改为页签条（AI 解释｜AI 制卡）+「＋制卡」+ 收起/关闭，
          不再承载标题（`.ai-panel-title` 仅存于 DictPanel 自有头行）；关闭＝dock 的 data-dock-close 钮，
          走宿主既有关闭链含批次 reject。本组件只渲染 .ai-panel-body（全部钩子零改动）。 */}

      <div className="ai-panel-body">
        {/* v48.51（D91 §5.2）：解读方式切换器＝explain 分支首行（等待回答时也可切换，切换即重发） */}
        {panel.kind === "explain" && (
          <ExplainModeSwitcher value={explainMode} onChange={(m) => onExplainModeChange?.(m)} />
        )}
        <blockquote className="ai-quote">{panel.text}</blockquote>

        {(panel.kind === "cards" || isOcclusion) && panel.running && (
          <div className="ai-streaming mono">
            {panel.progress
              ? `生成中… 已输出 ${panel.progress} 字 · 已等待 ${panel.elapsedSec ?? 0} 秒（大模型生成长 JSON 通常需要 1-2 分钟，请保持窗口打开）`
              : panel.thinking
                ? `模型思考中… 已思考 ${panel.thinking} 字 · 已等待 ${panel.elapsedSec ?? 0} 秒`
                : `正在等待模型响应… 已等待 ${panel.elapsedSec ?? 0} 秒（推理模型输出正文前会先思考约 0.5-1 分钟）`}
          </div>
        )}
        {panel.searching && <div className="ai-streaming mono">正在联网检索事件背景…</div>}
        {panel.error && <div className="ai-error">{panel.error}</div>}

        {panel.kind === "explain" && panel.running && !panel.answer && (
          <div className="ai-streaming mono" aria-live="polite">
            {panel.thinking
              ? `模型思考中… 已思考 ${panel.thinking} 字 · 已等待 ${panel.elapsedSec ?? 0} 秒`
              : `正在等待模型响应… 已等待 ${panel.elapsedSec ?? 0} 秒（推理模型输出正文前会先思考约 0.5-1 分钟）`}
          </div>
        )}

        {panel.kind === "explain" && panel.answer && (
          <>
            <div className="ai-answer">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {panel.answer}
              </ReactMarkdown>
            </div>
            {/* v48.51（D91 §5.5）：事后建议——路由错配的语义级纠偏，点击即按通用解读重跑（reader-explain scope） */}
            {suggestGeneral && (
              <div className="ai-suggest" data-testid="explain-suggest">
                <span>这段更像概念解释，切换到通用解读？</span>
                <button className="btn btn-outline btn-sm" onClick={() => onExplainModeChange?.("general")}>
                  切换到通用解读
                </button>
              </div>
            )}
            <div className="ai-actions">
              <button className="btn btn-outline btn-sm" onClick={() => onExplain("通俗解释")}>通俗解释</button>
              <button className="btn btn-outline btn-sm" onClick={() => onExplain("严格定义")}>严格定义</button>
              <button className="btn btn-outline btn-sm" onClick={() => onExplain("举个例子")}>举个例子</button>
              <button className="btn btn-outline btn-sm" onClick={() => onExplain("为什么会这样")}>为什么</button>
            </div>
            <div className="ai-actions">
              <button className="btn btn-secondary btn-sm" disabled={panel.running} onClick={onMakeCards}>
                就此制卡
              </button>
            </div>
          </>
        )}

        {/* M1.2：材料类型路由展示 + 手动覆盖 */}
        {panel.kind === "cards" && (
          <div className="ai-route-row">
            <span className="mono">
              {panel.routeLabel ? `材料类型：${panel.routeLabel} · 默认形式：${panel.routeForm}` : "材料类型：自动识别"}
            </span>
            <Dropdown
              align="left"
              title="材料类型"
              value={mode}
              options={[
                { value: "auto", label: "自动识别" },
                { value: "card-generation", label: "概念论述" },
                { value: "card-formula", label: "公式推导" },
                { value: "card-seq", label: "流程背诵" },
                { value: "card-enum", label: "枚举清单" },
                { value: "card-literature", label: "文学/诗歌背诵" }
              ]}
              onChange={(m) => onModeChange(m as CardGenMode)}
            />
            {(panel.drafts?.length || panel.error) && !panel.running && (
              <button className="btn btn-outline btn-sm" onClick={onMakeCards}>
                按此类型重跑
              </button>
            )}
          </div>
        )}

        {/* v16 递进补卡：知识点「后续可补」注记 → 逐项两个按钮 */}
        {panel.kind === "cards" && followUpGroups.length > 0 && (
          <div className="ai-kps">
            <p className="ai-kps-title">知识点与后续可补</p>
            {followUpGroups.map((g, gi) => (
              <div key={gi} className="ai-kp">
                <div className="ai-kp-title">{g.kpTitle}</div>
                {g.items.map((item) => {
                  const busy = (panel.followUpBusy ?? []).includes(item);
                  const err = panel.followUpErrors?.[item];
                  return (
                    <div key={item} className="ai-kp-item">
                      <span className="ai-kp-item-text">{item}</span>
                      <button
                        className="btn btn-outline btn-sm"
                        disabled={busy || panel.running}
                        onClick={() => onExploration(item, g.kpTitle)}
                      >
                        询问 AI 相关内容
                      </button>
                      <button
                        className="btn btn-outline btn-sm"
                        disabled={busy || panel.running}
                        onClick={() => onFollowUpCards(item, g.kpTitle)}
                      >
                        直接制卡
                      </button>
                      {busy && <span className="mono ai-kp-busy">补充制卡中… {busySec(item)} 秒（推理模型约需 0.5-1 分钟）</span>}
                      {err && <span className="lint lint-error">{err}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {isOcclusion && panel.image && !panel.running && (
          <div className="occlusion-stage occlusion-preview">
            <img src={panel.image.assetPath} alt="" className="occlusion-img" />
            {/* v25：形状化预览（矩形/椭圆/多边形）——与复习端同口径渲染 */}
            <OcclusionShapes
              occlusion={{
                rects: (panel.regions ?? []).map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, ord: r.ord })),
                shapes: (panel.regions ?? []).map((r) => r.shape ?? null)
              }}
              cardOrd={0}
              variant="proposal"
            />
            {(panel.regions ?? []).map((r) => (
              <span
                key={r.ord}
                className="occlusion-ord mono"
                style={{ left: `${r.x}%`, top: `${r.y}%` }}
              >
                {r.ord + 1}
              </span>
            ))}
          </div>
        )}

        {(panel.kind === "cards" || isOcclusion) && (
          <>
            {panel.blockReasons && panel.blockReasons.length > 0 && (
              <div className="ai-block-reasons">
                <p>该{isOcclusion ? "图片" : "文本"}依赖未建立的理解：</p>
                <ul>{panel.blockReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                {!isOcclusion && !panel.searched && (
                  <div className="ai-actions">
                    <button
                      className="btn btn-outline btn-sm"
                      disabled={panel.searching || panel.running}
                      onClick={onSearchBackground}
                    >
                      {panel.searching ? "检索中…" : "搜索网络补充背景后重试"}
                    </button>
                  </div>
                )}
                {!isOcclusion && panel.searched && (
                  <p className="form-hint">已注入联网检索到的事件背景；若仍提示缺背景，建议手动补充来源文本。</p>
                )}
              </div>
            )}
            {panel.drafts?.map((rawDraft, i) => {
              if (panel.accepted?.has(i)) {
                return (
                  <div key={i} className="ai-draft card-fill ai-draft-accepted">
                    <div className="ai-draft-accepted-badge">已加入 FSRS 队列</div>
                    <div className="ai-draft-front">
                      <div className="ai-draft-text">{String(rawDraft?.front ?? "")}</div>
                    </div>
                  </div>
                );
              }
              // 深度防御：字段类型强制归一，杜绝渲染期异常
              const d: CardDraft = {
                ...(rawDraft as CardDraft),
                front: String(rawDraft?.front ?? ""),
                back: String(rawDraft?.back ?? ""),
                cloze: rawDraft?.cloze ? String(rawDraft.cloze) : null,
                contextPrefix: rawDraft?.contextPrefix ? String(rawDraft.contextPrefix) : undefined,
                domain: sanitizeDomain((rawDraft as CardDraft)?.domain),
                ruleNotes: toList((rawDraft as CardDraft)?.ruleNotes),
                warnings: toList((rawDraft as CardDraft)?.warnings)
              };
              // v29 D26 逐张分流：面板可混排遮挡卡与看图问答卡——按 draft 自身判断
              // 遮挡 draft = imageOcclusion 且带非空 rects；看图问答 draft = imageOcclusion 且 rects 空（挂图无遮挡）
              const dIsOcc = d.cardType === "imageOcclusion" && !!d.occlusion && d.occlusion.rects.length > 0;
              const issues = lintCard({
                front: d.front,
                back: d.back,
                cardType: d.cardType,
                occlusion: d.occlusion ? { assetPath: d.occlusion.assetPath, rects: d.occlusion.rects } : null,
                cloze: d.cloze || null,
                contextPrefix: d.contextPrefix,
                sourceRef: d.sourceRef,
                dateStamp: d.dateStamp
              });
              const isEditing = editing === i;
              const editText = editValues[i] ?? {};
              const shownFront = editText.front !== undefined ? editText.front : (d.cardType === "cloze" ? d.cloze || d.front : d.front);
              const shownBack = editText.back !== undefined ? editText.back : d.back;
              const occlLabel = d.occlusion?.label ? d.occlusion.label : "";
              return (
                <div key={i} className="ai-draft">
                  {isEditing ? (
                    <>
                      <textarea
                        className="ta-short mono"
                        value={shownFront}
                        onChange={(e) =>
                          setEditValues((v) => ({
                            ...v,
                            [i]: { ...v[i], front: e.target.value }
                          }))
                        }
                      />
                      <textarea
                        className="ta-short mono"
                        value={shownBack}
                        onChange={(e) =>
                          setEditValues((v) => ({
                            ...v,
                            [i]: { ...v[i], back: e.target.value }
                          }))
                        }
                      />
                      <div className="ai-actions">
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => {
                            // 把编辑写回父组件 state（drafts 数组本体）
                            onEdit(i, {
                              ...(d.cardType === "cloze" ? { cloze: shownFront } : { front: shownFront }),
                              back: shownBack,
                              // 编辑后 front/cloze 变了，同步 noteText 的来源字段
                              front: d.cardType === "cloze" ? d.front : shownFront
                            });
                            setEditValues((v) => {
                              const { [i]: _removed, ...rest } = v;
                              return rest;
                            });
                            setEditing(null);
                          }}
                        >
                          完成
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="ai-draft-front">
                        <span className="ai-draft-type mono">{d.cardType}</span>
                        {/* v30（D27）：分答多空卡徽标——接受时自动拆成每空一张 */}
                        {d.cardType === "cloze" && d.clozeMode === "per-blank" && (
                          <span className="ai-draft-supplement mono">
                            分答·拆{Math.max(2, parseCloze(d.cloze || d.front || "").ords.length)}张
                          </span>
                        )}
                        {panel.supplemental?.has(i) && <span className="ai-draft-supplement mono">补充</span>}
                        {d.contextPrefix && <span className="ai-draft-prefix mono">{d.contextPrefix}</span>}
                        <div className="ai-draft-text">
                          {d.cardType === "cloze"
                            ? (d.cloze || "").replace(/\{\{c\d+::(.*?)(?:::(.*?))?\}\}/g, "〔$1〕")
                            : d.front}
                        </div>
                      </div>
                      <div className="ai-draft-back">{d.back}</div>
                      {dIsOcc && occlLabel && (
                        <div className="ai-draft-notes mono">区域 {(d.ord ?? d.occlusion?.ord ?? 0) + 1} · {occlLabel}</div>
                      )}
                      {toList(d.ruleNotes).length > 0 && (
                        <div className="ai-draft-notes mono">{toList(d.ruleNotes).join(" · ")}</div>
                      )}
                      {toList(d.warnings).length > 0 && (
                        <div className="ai-draft-warnings"><IconAlert size={14} /> {toList(d.warnings).join("；")}</div>
                      )}
                      {/* v46（M14-UM2，§6.7.3）：记忆接地轻标记——成功「情境来自记忆」（点开看引用行），
                          失败「情境来源存疑」（默认不勾选：接受按钮需二次点击确认，不阻断整批） */}
                      {d.memoryRef && (
                        <div className="ai-draft-issues">
                          <span
                            className={`lint ${d.memoryRefValid ? "lint-info" : "lint-warn"}`}
                            title={`引用记忆行：${d.memoryRef}${d.memoryRefValid ? "" : "\n（该行未能在本次注入的记忆块中找到——可能记忆已被整理更新）"}`}
                          >
                            {d.memoryRefValid ? "情境来自记忆" : "情境来源存疑"}
                          </span>
                        </div>
                      )}
                      {issues.length > 0 && (
                        <div className="ai-draft-issues">
                          {issues.map((it, j) => (
                            <span key={j} className={`lint lint-${it.severity}`}>
                              {it.ruleId} {it.message}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="ai-actions">
                        {dIsOcc ? (
                          <button className="btn btn-primary btn-sm" onClick={() => onAcceptOcclusion(d, i)}>接受</button>
                        ) : d.memoryRef && d.memoryRefValid === false && !memoryWarnArmed.has(i) ? (
                          <button
                            className="btn btn-secondary btn-sm"
                            title="情境来源存疑：该记忆引用未能校验。再点一次确认接受（可自行决定保留），点「编辑」可删掉情境。"
                            onClick={() => setMemoryWarnArmed((s) => new Set([...s, i]))}
                          >
                            情境存疑·仍接受？
                          </button>
                        ) : (
                          <button className="btn btn-primary btn-sm" onClick={() => onAccept(d, i)}>接受</button>
                        )}
                        <button className="btn btn-secondary btn-sm" onClick={() => setEditing(i)}>编辑</button>
                        {d.cardType === "qa" && (
                          <button
                            className="btn btn-secondary btn-sm"
                            title="拆为两张互为翻转的独立问答卡（各自有独立 FSRS 调度状态）"
                            onClick={() => onSplitReverse(i)}
                          >
                            转翻转卡
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
            {(panel.kind === "cards" || isOcclusion) && !panel.running && panel.drafts && panel.drafts.length > 0 && (
              <div className="ai-actions">
                <button className="btn btn-outline btn-sm" onClick={onRejectAll}>整批拒绝</button>
              </div>
            )}
          </>
        )}

        {/* v16：询问 AI 的解释区——追加在面板最下方，解释末尾带「直接制卡」 */}
        {(panel.explorations ?? []).length > 0 && (
          <div className="ai-explorations">
            {(panel.explorations ?? []).map((e) => (
              <div key={e.id} className="ai-exploration">
                <div className="ai-exploration-q mono">问（{e.item}）：{e.question}</div>
                {e.running && (
                  <div className="ai-streaming mono">
                    {e.thinking
                      ? `思考中… 已思考 ${e.thinking} 字 · 已等待 ${explSec(e)} 秒`
                      : `等待模型响应… 已等待 ${explSec(e)} 秒（推理模型约需 0.5-1 分钟）`}
                  </div>
                )}
                {e.error && <div className="ai-error">{e.error}</div>}
                {e.answer && (
                  <div className="ai-answer">
                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                      {e.answer}
                    </ReactMarkdown>
                  </div>
                )}
                {!e.running && e.answer && (
                  <div className="ai-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={(panel.followUpBusy ?? []).includes(e.item) || panel.running}
                      onClick={() => onFollowUpCards(e.item, e.kpTitle, e.answer)}
                    >
                      直接制卡
                    </button>
                    {(panel.followUpBusy ?? []).includes(e.item) && (
                      <span className="mono ai-kp-busy">补充制卡中… {busySec(e.item)} 秒</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
