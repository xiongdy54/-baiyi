// v48.61（D104，D94 设计稿 §3.5）：卡面背面辅助字段区（助记 / 例子 / 来源三块）。
// 复习页背面与卡详情卡面预览消费**同一组件**——`app.cardFaceExtras` 三开关自动继承；
// 开关关闭即不渲染对应块（纯显示开关，不改卡内数据、不影响 CardLint）。
// 字段缺省（卡上没有该字段）同样不渲染——开关只决定「有也不显」。
import { useEffect, useState } from "react";
import { settingsStore } from "../lib/settings";
import { DEFAULT_CARD_FACE_EXTRAS, normalizeCardFaceExtras, type CardFaceExtras } from "../lib/cardFaceExtras";
import type { CardRecord } from "../lib/cards";
import { useT } from "../lib/i18n";

export default function CardFaceExtrasBlock({ card }: { card: Pick<CardRecord, "mnemonic" | "example" | "sourceRef"> }) {
  const T = useT();
  const [extras, setExtras] = useState<CardFaceExtras>(DEFAULT_CARD_FACE_EXTRAS);
  useEffect(() => {
    let cancelled = false;
    settingsStore.get<unknown>("app", "cardFaceExtras", null).then((v) => {
      if (!cancelled) setExtras(normalizeCardFaceExtras(v));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const blocks: Array<{ key: keyof CardFaceExtras; label: string; text: string }> = [];
  if (extras.mnemonic && card.mnemonic) blocks.push({ key: "mnemonic", label: "助记", text: card.mnemonic });
  if (extras.example && card.example) blocks.push({ key: "example", label: "例子", text: card.example });
  if (extras.sourceRef && card.sourceRef) {
    const s = card.sourceRef;
    const text = [s.title ? `《${s.title}》` : "", s.page != null ? `p.${s.page}` : ""].filter(Boolean).join(" · ");
    if (text) blocks.push({ key: "sourceRef", label: "来源", text });
  }
  if (blocks.length === 0) return null;
  return (
    <div className="card-extras" data-testid="card-face-extras">
      {blocks.map((b) => (
        <div key={b.key} className="review-mnemonic" data-testid={`card-extra-${b.key}`}>
          <span className="book-card-label">{T(b.label)}</span>
          {b.text}
        </div>
      ))}
    </div>
  );
}
