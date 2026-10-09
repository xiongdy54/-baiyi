// D121 §3.2 底部动作条：保存修改 / AI 诊断 / 关闭（review 来源另有「关闭后跳过本卡」勾选，默认勾选）
export default function Footer({
  step,
  origin,
  dirty,
  saving,
  aiUsable,
  diagnosing,
  skipAfter,
  onSkipAfter,
  onBack,
  onSave,
  onDiagnose,
  onClose
}: {
  step: "pick" | "compare";
  origin: "review" | "browser" | "manual";
  dirty: boolean;
  saving: boolean;
  aiUsable: boolean | null;
  diagnosing: boolean;
  skipAfter: boolean;
  onSkipAfter: (v: boolean) => void;
  onBack: () => void;
  onSave: () => void;
  onDiagnose: () => void;
  onClose: () => void;
}) {
  return (
    <div className="disamb-footer">
      {step === "compare" && (
        <>
          <button type="button" className="btn btn-outline btn-sm" onClick={onBack}>重选对照卡</button>
          <button type="button" className="btn btn-primary btn-sm" data-testid="disamb-save" disabled={!dirty || saving} onClick={onSave}>
            {saving ? "保存中…" : "保存修改"}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            data-testid="disamb-ai"
            disabled={!aiUsable || diagnosing}
            title={aiUsable ? "让 AI 判断矛盾的原因（点击才会调用）" : "未配置 AI Key：请先到 设置 → AI 服务 配置"}
            onClick={onDiagnose}
          >
            {diagnosing ? "诊断中…" : "AI 诊断"}
          </button>
        </>
      )}
      <span className="form-actions-spacer" />
      {origin === "review" && (
        <label className="disamb-skip">
          <input type="checkbox" data-testid="disamb-skip-toggle" checked={skipAfter} onChange={(e) => onSkipAfter(e.target.checked)} />
          关闭后跳过本卡（本次不评分）
        </label>
      )}
      <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>关闭</button>
    </div>
  );
}
