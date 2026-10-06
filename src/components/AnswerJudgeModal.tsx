// 复习页「AI 判答」模态（v48.58 / D99，设计 docs/design/REVIEW-UI-POLISH-D99.md §2.1）：
// 学生先自行作答，再把答案交给 AI 与标准答案做**等价比对**（同义改写/等值单位/更宽泛但含核心＝等价），
// 输出四档裁决（等价/部分正确/不一致/无法判断）+ 理由。
// 只读辅助面：零写库、零调度写入；§1.9/§1.10 AI 不是事实源——评分仍由用户自评（页脚固定提示）。
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { aiGateway } from "../lib/ai";
import type { CardRecord } from "../lib/cards";
import { useDialogA11y } from "../lib/dialogA11y";
import { IconAlert } from "./icons";

// PromptTemplate `review-answer-judge` 缺失时的渲染层兜底（与播种模板 §7.4 保持同文）
const FALLBACK_PROMPT = `你是间隔重复学习软件里的「答案判定助手」。学生先尝试回忆卡片答案，再把自己的答案交给你，与标准答案比对。你的任务：判断学生的答案与标准答案是否表达同一（或等价）的知识点，并解释理由。

规则：
1. 判定等价而非逐字：同义改写、不同语言表述、单位换算后等值、比标准答案更宽泛但包含其核心的表述，都算等价（verdict "correct"）。
2. 学生答案在标准答案之外补充了内容：补充内容正确判 "partial"，补充内容错误判 "incorrect"，都要在理由里指出。
3. 只依据题面与标准答案判定，不引入外部事实；题面与标准答案不足以得出结论时 verdict 用 "unknown" 并说明缺什么。
4. 不讨论评分与调度；你的判断仅供参考。
5. 输出严格 JSON（无代码块围栏）：{"verdict": "correct" | "partial" | "incorrect" | "unknown", "explanation": "简短理由，中文，1-3 句"}`;

type Verdict = "correct" | "partial" | "incorrect" | "unknown";
const VERDICT_LABEL: Record<Verdict, string> = {
  correct: "等价",
  partial: "部分正确",
  incorrect: "不一致",
  unknown: "无法判断",
};

export default function AnswerJudgeModal({ card, onClose }: { card: CardRecord; onClose: () => void }) {
  const panelRef = useDialogA11y<HTMLDivElement>(onClose);
  const [answer, setAnswer] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ verdict: Verdict | null; explanation: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const front = card.frontMarkdown || card.noteText || "";

  async function judge() {
    const userAnswer = answer.trim();
    if (!userAnswer || running) return;
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const tpl = await window.promptsAPI?.get("review-answer-judge");
      const raw = await aiGateway.chat(
        [
          { role: "system", content: tpl?.content || FALLBACK_PROMPT },
          {
            role: "user",
            content: `【题面】\n${front}\n\n【标准答案】\n${card.backMarkdown}\n\n【学生答案】\n${userAnswer}`
          }
        ],
        undefined,
        0.2
      );
      if (!mounted.current) return;
      let parsed: { verdict?: string; explanation?: string } | null = null;
      try {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]);
      } catch { /* 非 JSON 回落原文展示 */ }
      const v = parsed?.verdict;
      setResult({
        verdict: v === "correct" || v === "partial" || v === "incorrect" || v === "unknown" ? v : null,
        explanation: parsed?.explanation || raw
      });
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setRunning(false);
    }
  }

  const md = (s: string) => (
    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{s}</ReactMarkdown>
  );

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="modal-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="AI 判答"
        data-testid="answer-judge-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>AI 判答</h2>
          <button className="icon-btn modal-close" title="关闭" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="modal-scroll">
          {front && (
            <>
              <span className="book-card-label">题面</span>
              <div className="judge-front">{md(front)}</div>
            </>
          )}
          <textarea
            className="judge-input"
            data-testid="judge-input"
            placeholder="输入你认为的答案…"
            rows={3}
            value={answer}
            disabled={running}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <div className="ai-actions">
            <button
              className="btn btn-primary btn-sm"
              data-testid="judge-submit"
              disabled={running || !answer.trim()}
              onClick={judge}
            >
              让 AI 判断
            </button>
          </div>
          {running && <p className="form-hint">AI 正在把你的答案与标准答案比对…</p>}
          {!running && error && (
            <p className="ai-draft-warnings"><IconAlert size={14} /> {error}</p>
          )}
          {!running && result && (
            <div className="judge-result">
              <span className={`judge-verdict${result.verdict ? ` ${result.verdict}` : " unknown"}`} data-testid="judge-verdict">
                {result.verdict ? VERDICT_LABEL[result.verdict] : "无法解析"}
              </span>
              <div className="judge-explanation" data-testid="judge-explanation">{result.explanation}</div>
            </div>
          )}
          <p className="form-hint">AI 判断仅供参考：不写入任何数据，评分仍由你决定。</p>
        </div>
      </div>
    </div>
  );
}
