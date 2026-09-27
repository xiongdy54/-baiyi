// 手动制卡编辑器（Phase 3：引用 + 可编辑副本；M1.1 增翻转问答；M5/v25 字段对齐 AI 制卡）
// 批 4（Task 4）：从 Reader.tsx 原样搬出（纯移动，零行为改动）——摘录页与阅读器共用同一份实现。
// UdcPicker 只被本文件使用，一并搬入。
import { useEffect, useRef, useState } from "react";
import { UDC_LEAVES, UDC_MAX, UDC_OTHER, udcLabel } from "../lib/udc";
import { useDialogA11y } from "../lib/dialogA11y";
import { IconChevronDown, IconClose } from "./icons";
import OcclusionShapes from "./OcclusionShapes";
import type { OcclusionRect, OcclusionShape } from "../lib/occlusion";

/** 手动制卡的提交载荷（原在 Reader.tsx，Task 4 随组件一并搬出） */
export interface ManualCardPayload {
  mode: "qa" | "reverse" | "cloze" | "imageOcclusion";
  front: string;
  back: string;
  cloze?: string;
  reversePair?: { bFront: string; bBack: string };
  imageRegion?: { dataUrl: string; alt: string; shape: OcclusionShape; rect: OcclusionRect };
  priority: number;
  contextPrefix?: string;
  domain?: string[];
  mnemonic?: string;
  knowledgePointId?: string;
  dateStamp?: string | null;
}

export default function ManualCardEditor({
  quote,
  imageRegion,
  onCancel,
  onSave
}: {
  quote: string;
  /** v25：来自图片聚焦选区（工具条「手动制卡」）——提供时默认进入图片挖空页签 */
  imageRegion?: { dataUrl: string; alt: string; shape: OcclusionShape; rect: OcclusionRect };
  onCancel: () => void;
  onSave: (payload: ManualCardPayload) => Promise<void>;
}) {
  const panelRef = useDialogA11y<HTMLDivElement>(onCancel);
  const [mode, setMode] = useState<"qa" | "reverse" | "cloze" | "imageOcclusion">(imageRegion ? "imageOcclusion" : "qa");
  const [front, setFront] = useState(imageRegion ? "" : quote);
  const [back, setBack] = useState("");
  const [bFront, setBFront] = useState("");
  const [bBack, setBBack] = useState("");
  const [priority, setPriority] = useState(50);
  const [saving, setSaving] = useState(false);
  // M5：与 AI 制卡同构的元数据字段（领域标签对齐 R17：≤2 个、首个为主）
  const [domain, setDomain] = useState<string[]>([]);
  const [contextPrefix, setContextPrefix] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [knowledgePointId, setKnowledgePointId] = useState("");
  const [dateStamped, setDateStamped] = useState(false);

  useEffect(() => {
    if (mode === "qa" || mode === "imageOcclusion") {
      setFront((f) => (f ? f : ""));
    } else {
      setFront(quote);
    }
  }, [mode, quote]);

  async function save() {
    setSaving(true);
    const meta = {
      priority,
      contextPrefix: contextPrefix.trim(),
      domain,
      mnemonic: mnemonic.trim(),
      knowledgePointId: knowledgePointId.trim(),
      // 日期标记（R11/规则19）：易变内容勾选后写入当日日期
      dateStamp: dateStamped ? new Date().toISOString().slice(0, 10) : null
    };
    const clozeText = mode === "cloze" ? toCloze(front) : undefined;
    await onSave({
      mode,
      front: mode === "cloze" ? clozeText ?? "" : front,
      back,
      cloze: clozeText,
      reversePair:
        mode === "reverse"
          ? { bFront: bFront.trim() || back, bBack: bBack.trim() || front }
          : undefined,
      imageRegion: mode === "imageOcclusion" ? imageRegion : undefined,
      ...meta
    });
    setSaving(false);
  }

  function toCloze(text: string): string {
    // 简易挖空：用户用 **粗体** 或〔〕标记答案，否则保持原文
    const bold = /\*\*(.+?)\*\*/.exec(text);
    if (bold) return text.replace(bold[0], `{{c1::${bold[1]}}}`);
    const bracket = /〔(.+?)〕/.exec(text);
    if (bracket) return text.replace(bracket[0], `{{c1::${bracket[1]}}}`);
    return text;
  }

  const canSave =
    mode === "imageOcclusion"
      ? Boolean(imageRegion) && Boolean(back.trim())
      : mode === "qa" || mode === "reverse"
        ? Boolean(front.trim()) && Boolean(back.trim())
        : Boolean(front.trim());

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-panel" ref={panelRef} role="dialog" aria-modal="true" aria-label="手动制卡" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>手动制卡</h2>
          <button className="icon-btn modal-close" title="关闭" onClick={onCancel}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <div className="modal-scroll">
        {quote && <blockquote className="card-quote card-marked">{quote}</blockquote>}

        <div className="seg-tabs">
          <button className={mode === "qa" ? "active" : ""} onClick={() => setMode("qa")}>
            问答题
          </button>
          <button className={mode === "reverse" ? "active" : ""} onClick={() => setMode("reverse")}>
            翻转问答
          </button>
          <button className={mode === "cloze" ? "active" : ""} onClick={() => setMode("cloze")}>
            填空题
          </button>
          <button className={mode === "imageOcclusion" ? "active" : ""} onClick={() => setMode("imageOcclusion")}>
            图片挖空
          </button>
        </div>

        {mode === "reverse" ? (
          <>
            <p className="form-hint">翻转问答：一次性创建两张互为翻转的独立问答卡（B 面留空则自动正反互换），各自有独立的复习调度。</p>
            <div className="form-field">
              <label>A 面 · 题面（建议「领域前缀: 问题」）</label>
              <textarea className="ta-short" value={front} onChange={(e) => setFront(e.target.value)} placeholder="例：统计: 中位数是什么？" />
            </div>
            <div className="form-field">
              <label>A 面 · 答案（目标 ≤15 字）</label>
              <textarea className="ta-short" value={back} onChange={(e) => setBack(e.target.value)} placeholder="例：排序后位于中间位置的数" />
            </div>
            <div className="form-field">
              <label>B 面 · 题面（留空则自动用 A 面答案反向提问）</label>
              <textarea className="ta-short" value={bFront} onChange={(e) => setBFront(e.target.value)} placeholder="例：统计: 排序后位于中间位置的数叫什么？" />
            </div>
            <div className="form-field">
              <label>B 面 · 答案（留空则自动用 A 面题面）</label>
              <textarea className="ta-short" value={bBack} onChange={(e) => setBBack(e.target.value)} placeholder="例：中位数" />
            </div>
          </>
        ) : mode === "qa" ? (
          <>
            <div className="form-field">
              <label>正面（问题，建议「领域前缀: 问题」）</label>
              <textarea className="ta-short" value={front} onChange={(e) => setFront(e.target.value)} placeholder="例：统计: 中位数是什么？" />
            </div>
            <div className="form-field">
              <label>背面（答案，目标 ≤15 字）</label>
              <textarea className="ta-short" value={back} onChange={(e) => setBack(e.target.value)} placeholder="例：排序后位于中间位置的数" />
            </div>
          </>
        ) : mode === "cloze" ? (
          <div className="form-field">
            <label>
              挖空文本（用 **双星号** 或〔括号〕包住答案，自动转 Anki 挖空；多挖空用 c1/c2 编号语法）
            </label>
            <textarea className="ta-short" value={front} onChange={(e) => setFront(e.target.value)} />
            <p className="form-preview mono">{front.replace(/\*\*(.+?)\*\*/g, "〔$1〕")}</p>
          </div>
        ) : (
          <>
            <p className="form-hint">
              图片挖空：正面按所选区域遮挡，答案面显示原图与答案文本。区域来自阅读器中的图片选区。
            </p>
            {imageRegion ? (
              <>
                <div className="occlusion-stage occlusion-preview manual-region-preview">
                  <img src={imageRegion.dataUrl} alt="" className="occlusion-img" />
                  <OcclusionShapes occlusion={{ shapes: [imageRegion.shape] }} cardOrd={0} />
                </div>
                <div className="form-field">
                  <label>正面（问题，默认「图中遮挡区域对应的是什么？」）</label>
                  <textarea className="ta-short" value={front} onChange={(e) => setFront(e.target.value)} placeholder="图中遮挡区域对应的是什么？" />
                </div>
                <div className="form-field">
                  <label>背面（答案，必填）</label>
                  <textarea className="ta-short" value={back} onChange={(e) => setBack(e.target.value)} placeholder="例：海马体" />
                </div>
              </>
            ) : (
              <p className="form-hint">
                尚未选择图片区域：请关闭本窗口，点击阅读材料中的图片进入聚焦，用工具条框选区域后选择「手动制卡」。
              </p>
            )}
          </>
        )}

        {/* M5：与 AI 制卡同构的元数据（领域标签 / 上下文前缀 / 助记 / 知识点分组 / 日期标记） */}
        <div className="form-field">
          <label>领域标签（对齐 R17：UDC 受控清单，≤2 个、首个为主领域）</label>
          <UdcPicker value={domain} onChange={setDomain} />
        </div>
        <div className="form-field">
          <label>上下文前缀（可选；只能写领域/学科名，禁止泄漏答案——规则16）</label>
          <input
            type="text"
            value={contextPrefix}
            onChange={(e) => setContextPrefix(e.target.value)}
            placeholder="例：统计:"
          />
        </div>
        <div className="form-field">
          <label>助记（可选，规则7 克制使用）</label>
          <input type="text" value={mnemonic} onChange={(e) => setMnemonic(e.target.value)} placeholder="例：中位数的「中」= 位置在正中间" />
        </div>
        <div className="form-field">
          <label>知识点分组（可选；同组卡片共享同一 knowledgePointId）</label>
          <input
            type="text"
            value={knowledgePointId}
            onChange={(e) => setKnowledgePointId(e.target.value)}
            placeholder="例：kp-中位数"
          />
        </div>
        <div className="form-field form-check">
          <label className="backup-checkline">
            <input type="checkbox" checked={dateStamped} onChange={(e) => setDateStamped(e.target.checked)} />
            标注日期（规则19：统计数字/版本/价格等易变内容勾选，写入今日日期）
          </label>
        </div>

        <div className="form-field">
          <label>优先级（0-100，越高越先复习）</label>
          <input type="range" min={0} max={100} value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
          <span className="mono">{priority}</span>
        </div>

        <div className="form-actions">
          <button className="btn btn-secondary" onClick={onCancel}>取消</button>
          <button className="btn btn-primary" disabled={saving || !canSave} onClick={save}>
            {saving ? "保存中…" : "创建卡片"}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

/** UDC 领域多选（M5/R17）：选中的标签以 chip 展示（点击移除），菜单只列受控清单 */
function UdcPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const options = [...UDC_LEAVES.map((l) => ({ code: l.code, label: `${l.code} ${l.label}` })), { code: UDC_OTHER, label: "其他" }];
  return (
    <div className="udc-picker" ref={ref}>
      {value.length > 0 && (
        <div className="udc-chips">
          {value.map((code, i) => (
            <button
              key={code}
              type="button"
              className="udc-chip"
              title={i === 0 ? "主领域（点击移除）" : "点击移除"}
              onClick={() => onChange(value.filter((c) => c !== code))}
            >
              {udcLabel(code)}
              {i === 0 && <span className="udc-chip-main mono">主</span>}
              <IconClose size={12} />
            </button>
          ))}
        </div>
      )}
      {value.length < UDC_MAX && (
        <div className="dd">
          <button type="button" className="dd-btn" onClick={() => setOpen((o) => !o)}>
            {value.length === 0 ? "选择领域" : "再加一个领域"}
            <IconChevronDown size={12} className="dd-caret" />
          </button>
          {open && (
            <div className="dd-menu dd-menu-left udc-menu" role="listbox">
              {options.map((o) => (
                <button
                  key={o.code}
                  type="button"
                  role="option"
                  aria-selected={value.includes(o.code)}
                  className="dd-item"
                  disabled={value.includes(o.code)}
                  onClick={() => {
                    onChange([...value, o.code]);
                    setOpen(false);
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
