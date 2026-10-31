// 结构全景 · 焦点节点卡（D254 v2；docs/design/STRUCTURE-ATLAS-D254.md §6）。
// 浮在焦点字形下方 8px；动作行 + 讲解 + 详情；复用随文结构的 .flow-actions / .flow-explain / .flow-dots / .flow-status。
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { GraphState, PatternKey, V2Node } from "../../../lib/mindmap/v2/types";
import { PATTERN_KEYS, ROOT_ID } from "../../../lib/mindmap/v2/types";
import { PATTERN_LABEL } from "../../../lib/flow/layout";
import { REL_STYLE } from "../../../lib/mindmap/v2/route";
import { edgesOf } from "../../../lib/mindmap/v2/graph";
import { mindmapV2Api, type GraphNodeText } from "../../../lib/mindmapV2";
import { useT } from "../../../lib/i18n";
import { FLOW } from "../../../lib/flow/layout";

const STATE_LABEL: Record<string, string> = {
  more: "可深挖",
  open: "已展开",
  floor: "已触底",
  stub: "其余部分（可深挖）",
  streaming: "正在生成",
};

export interface AtlasCardProps {
  graph: GraphState;
  mapId: string | null;
  node: V2Node;
  isRoot: boolean;
  preview: boolean;
  explainText: string | null;
  explainBusy: boolean;
  explainOpen: boolean;
  onToggleExplain: () => void;
  detailOpen: boolean;
  onToggleDetail: () => void;
  learnStatus: { cardCount: number; kpExists: boolean } | null;
  canMakeCards: boolean;
  expanded: boolean;
  delay: number;
  onJump: () => void;
  onDeepen: (force?: boolean) => void;
  onMakeCards: () => void;
  onToggleFold: () => void;
  onFocusNode: (id: string) => void;
  onSetPattern: (id: string, key: PatternKey | null) => void;
}

export default function AtlasCard(p: AtlasCardProps) {
  const T = useT();
  const { node } = p;
  const streaming = node.state === "streaming";
  const canDeepen = !p.preview && (node.state === "more" || node.state === "stub");
  const canJump = node.blockStart != null;
  const canExplain = node.blockStart != null && !streaming;
  const kidsCount = p.graph.children[p.isRoot ? ROOT_ID : node.id]?.length ?? 0;
  const canFold = kidsCount > 0;
  const acts: ReactNode[] = [];
  const sep = (k: string) => <span key={k} aria-hidden="true">·</span>;
  if (canJump) acts.push(<button key="jump" type="button" data-atlas-act="jump" onClick={p.onJump}>{T("跳到原文")}</button>);
  if (canExplain) acts.push(<button key="explain" type="button" data-atlas-act="explain" onClick={p.onToggleExplain}>{p.explainOpen ? T("收起讲解") : T("讲解")}</button>);
  if (canDeepen) acts.push(<button key="deepen" type="button" data-atlas-act="deepen" onClick={() => p.onDeepen(false)}>{T("深挖")}</button>);
  if (p.canMakeCards && !streaming) acts.push(<button key="cards" type="button" data-atlas-act="cards" onClick={p.onMakeCards}>{T("制卡")}</button>);
  if (canFold) acts.push(<button key="fold" type="button" data-atlas-act="fold" onClick={p.onToggleFold}>{p.expanded ? T("收起结构") : T("展开结构")}</button>);
  acts.push(<button key="detail" type="button" data-atlas-act="detail" onClick={p.onToggleDetail}>{p.detailOpen ? T("收起详情") : T("详情")}</button>);

  return (
    <div className="atlas-card" data-atlas-card={node.id} style={{ "--flow-delay": `${p.delay}ms` } as unknown as CSSProperties}>
      <div className="flow-actions">
        {acts.map((a, i) => (
          <span key={i} className="atlas-card-act">{i ? sep(`s${i}`) : null}{a}</span>
        ))}
        {p.preview && (node.state === "more" || node.state === "stub") ? <span className="atlas-card-hint">{T("生成导图后可以继续深挖")}</span> : null}
      </div>
      {p.explainOpen ? (
        <div className="flow-explain" style={{ maxHeight: FLOW.EXPLAIN_MAX_H }}>
          {p.explainBusy && !p.explainText ? <span className="flow-dots" aria-label={T("正在生成…")}><i /><i /><i /></span> : null}
          {p.explainText ? <span>{p.explainText}</span> : p.explainBusy ? null : <span className="flow-explain-empty">{T("还没有讲解")}</span>}
        </div>
      ) : null}
      {p.detailOpen ? (
        <AtlasDetail
          graph={p.graph}
          mapId={p.mapId}
          node={node}
          isRoot={p.isRoot}
          learnStatus={p.learnStatus}
          onFocusNode={p.onFocusNode}
          onSetPattern={p.onSetPattern}
          onDeepen={p.onDeepen}
        />
      ) : null}
    </div>
  );
}

function AtlasDetail(p: {
  graph: GraphState;
  mapId: string | null;
  node: V2Node;
  isRoot: boolean;
  learnStatus: { cardCount: number; kpExists: boolean } | null;
  onFocusNode: (id: string) => void;
  onSetPattern: (id: string, key: PatternKey | null) => void;
  onDeepen: (force?: boolean) => void;
}) {
  const T = useT();
  const { graph, node } = p;
  const [text, setText] = useState<GraphNodeText | null>(null);
  const [showText, setShowText] = useState(false);

  useEffect(() => {
    if (!p.mapId) {
      setText(null);
      return;
    }
    let alive = true;
    setText(null);
    mindmapV2Api
      .nodeText(p.mapId, node.id)
      .then((r) => alive && setText(r))
      .catch(() => alive && setText(null));
    return () => {
      alive = false;
    };
  }, [p.mapId, node.id, node.blockStart, node.blockEnd]);

  const gid = p.isRoot ? ROOT_ID : node.id;
  const kids = graph.children[gid] ?? [];
  const rels = p.isRoot ? [] : edgesOf(graph, node.id);
  const manual = graph.view.patterns[gid] ?? null;
  const titleOf = (id: string) => graph.nodes[id]?.title ?? id;

  return (
    <div className="atlas-detail">
      <p className="atlas-detail-meta">
        {T(String(node.type))}
        {node.timeText ? ` · ${node.timeText}` : ""} · {T(STATE_LABEL[node.state] ?? node.state)}
        {node.source === "v1ext" ? ` · ${T("旧版")}` : ""}
      </p>
      {p.learnStatus ? (
        <p className="atlas-detail-meta">
          {T("已有 {n} 张卡", { n: p.learnStatus.cardCount })}
          {p.learnStatus.kpExists ? ` · ${T("知识点已存在")}` : ""}
        </p>
      ) : null}
      {rels.length > 0 ? (
        <ul className="atlas-rel-list">
          {rels.map((e) => {
            const out = e.from === node.id;
            const other = out ? e.to : e.from;
            const name = T(REL_STYLE[e.code]?.name ?? e.code);
            return (
              <li key={`${e.from}|${e.to}|${e.code}`}>
                <button type="button" onClick={() => p.onFocusNode(other)}>
                  {out ? T("本节点 {rel} → {title}", { rel: name, title: titleOf(other) }) : T("{title} {rel} → 本节点", { rel: name, title: titleOf(other) })}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {kids.length > 1 ? (
        <label className="atlas-detail-row">
          <span>{T("排列方式")}</span>
          <select className="atlas-select" value={manual ?? ""} onChange={(e) => p.onSetPattern(gid, (e.target.value || null) as PatternKey | null)}>
            <option value="">{T("自动")}</option>
            {PATTERN_KEYS.map((k) => (
              <option key={k} value={k}>{T(PATTERN_LABEL[k])}</option>
            ))}
          </select>
        </label>
      ) : null}
      {text?.text ? (
        <button type="button" className="atlas-link-btn" onClick={() => setShowText((v) => !v)}>
          {showText ? T("收起原文") : T("查看对应原文（{n} 字）", { n: text.text.length })}
        </button>
      ) : null}
      {showText && text?.text ? <blockquote className="atlas-source">{text.text.length > 4000 ? text.text.slice(0, 4000) + "…" : text.text}</blockquote> : null}
      {node.state === "floor" && !p.isRoot && node.blockStart != null ? (
        <button type="button" className="atlas-link-btn" onClick={() => p.onDeepen(true)}>{T("仍要尝试深挖")}</button>
      ) : null}
    </div>
  );
}
