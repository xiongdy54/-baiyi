// 材料导图 v2 · 节点详情（MINDMAP-V2-IMPL-PLAN §5.2 NodeDetailV2）。
// 标题 / 类型 / 状态、区间原文（graphNodeText，零 AI）、explain 流式、关系清单（可点跳转、Tab/Enter 可达）、
// 排列方式（自动 + 七版式，写 view）、跳正文、就此制卡、学习状态、深挖 / 「仍要尝试深挖」（force）。
import { useEffect, useState } from "react";
import type { GraphState, PatternKey, V2Node } from "../../../lib/mindmap/v2/types";
import { PATTERN_KEYS, ROOT_ID } from "../../../lib/mindmap/v2/types";
import { PATTERN_NAMES } from "../../../lib/mindmap/v2/pattern";
import { REL_STYLE } from "../../../lib/mindmap/v2/route";
import { edgesOf } from "../../../lib/mindmap/v2/graph";
import { mindmapV2Api, type GraphNodeText } from "../../../lib/mindmapV2";
import { useT } from "../../../lib/i18n";

const STATE_LABEL: Record<string, string> = {
  more: "可深挖",
  open: "已展开",
  floor: "已触底",
  stub: "其余部分（可深挖）",
  streaming: "正在生成",
};

export interface NodeDetailV2Props {
  graph: GraphState;
  mapId: string;
  node: V2Node;
  /** 是否为材料根（画布合成根卡映射而来） */
  isRoot: boolean;
  explainText: string | null;
  explainBusy: boolean;
  learnStatus: { cardCount: number; kpExists: boolean } | null;
  canMakeCards: boolean;
  onFocusNode: (id: string) => void;
  onDeepen: (id: string, force: boolean) => void;
  onExplain: (id: string) => void;
  onSetPattern: (id: string, key: PatternKey | null) => void;
  onToggleCollapse: (id: string) => void;
  onJump: (node: V2Node, text: GraphNodeText | null) => void;
  onMakeCards: (node: V2Node, text: GraphNodeText | null) => void;
}

export default function NodeDetailV2(p: NodeDetailV2Props) {
  const T = useT();
  const { graph, node } = p;
  const [text, setText] = useState<GraphNodeText | null>(null);
  const [showText, setShowText] = useState(false);

  useEffect(() => {
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
  const collapsed = graph.collapsed.has(node.id);
  const canDeepen = node.state === "more" || node.state === "stub";
  const streaming = node.state === "streaming";
  const titleOf = (id: string) => graph.nodes[id]?.title ?? id;

  return (
    <section className="mindmap-side-sec mindmap-node-detail mm2-detail">
      <h3>{T("节点详情")}</h3>
      <p className="mindmap-node-title">{node.title}</p>
      <p className="mindmap-meta">
        {T(String(node.type))}
        {node.timeText ? ` · ${node.timeText}` : ""} · {T(STATE_LABEL[node.state] ?? node.state)}
        {node.source === "v1ext" ? ` · ${T("旧版")}` : ""}
      </p>
      {p.learnStatus && (
        <p className="mindmap-meta">
          {T("已有 {n} 张卡", { n: p.learnStatus.cardCount })}
          {p.learnStatus.kpExists ? ` · ${T("知识点已存在")}` : ""}
        </p>
      )}

      <div className="mindmap-node-actions">
        {canDeepen && (
          <button className="btn btn-primary btn-sm" onClick={() => p.onDeepen(node.id, false)} disabled={streaming}>
            {T("深挖此节点")}
          </button>
        )}
        {kids.length > 0 && !p.isRoot && (
          <button className="btn btn-outline btn-sm" onClick={() => p.onToggleCollapse(node.id)}>
            {collapsed ? T("展开子树") : T("收起子树")}
          </button>
        )}
        <button className="btn btn-outline btn-sm" onClick={() => p.onJump(node, text)} disabled={!text?.unitAnchor}>
          {T("跳到正文")}
        </button>
        {p.canMakeCards && (
          <button className="btn btn-outline btn-sm" onClick={() => p.onMakeCards(node, text)} disabled={streaming}>
            {T("就此制卡")}
          </button>
        )}
      </div>

      <div className="mm2-detail-block">
        <div className="mm2-detail-head">
          <span>{T("讲解")}</span>
          {!p.explainText && !p.explainBusy && (
            <button className="btn btn-outline btn-sm" onClick={() => p.onExplain(node.id)} disabled={node.blockStart == null}>
              {T("讲解此节点")}
            </button>
          )}
        </div>
        {p.explainText ? (
          <p className="mm2-explain">{p.explainText}</p>
        ) : p.explainBusy ? (
          <p className="mindmap-meta">{T("正在讲解…")}</p>
        ) : (
          <p className="mindmap-meta">{T("尚无讲解（点击上方按钮生成，约 1 次调用）")}</p>
        )}
      </div>

      {rels.length > 0 && (
        <div className="mm2-detail-block">
          <div className="mm2-detail-head">
            <span>{T("关系")}</span>
          </div>
          <ul className="mm2-rel-list">
            {rels.map((e) => {
              const out = e.from === node.id;
              const other = out ? e.to : e.from;
              const name = T(REL_STYLE[e.code]?.name ?? e.code);
              return (
                <li key={`${e.from}|${e.to}|${e.code}`}>
                  <button className="mm2-rel-item" onClick={() => p.onFocusNode(other)}>
                    {out ? T("本节点 {rel} → {title}", { rel: name, title: titleOf(other) }) : T("{title} {rel} → 本节点", { rel: name, title: titleOf(other) })}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {kids.length > 1 && (
        <div className="mm2-detail-block">
          <label className="mm2-detail-head" htmlFor="mm2-pattern">
            <span>{T("排列方式")}</span>
          </label>
          <select
            id="mm2-pattern"
            className="mindmap-search"
            value={manual ?? ""}
            onChange={(e) => p.onSetPattern(gid, (e.target.value || null) as PatternKey | null)}
          >
            <option value="">{T("自动")}</option>
            {PATTERN_KEYS.map((k) => (
              <option key={k} value={k}>
                {T(PATTERN_NAMES[k])}
              </option>
            ))}
          </select>
        </div>
      )}

      {text?.text && (
        <div className="mm2-detail-block">
          <button className="mm2-link" onClick={() => setShowText((v) => !v)}>
            {showText ? T("收起原文") : T("查看对应原文（{n} 字）", { n: text.text.length })}
          </button>
          {showText && <blockquote className="mindmap-quote mm2-source">{text.text.length > 4000 ? text.text.slice(0, 4000) + "…" : text.text}</blockquote>}
        </div>
      )}

      {node.state === "floor" && !p.isRoot && node.blockStart != null && (
        <p className="mindmap-meta">
          {T("这个节点被判定为没有更深的结构。")}
          <button className="mm2-link" onClick={() => p.onDeepen(node.id, true)}>
            {T("仍要尝试深挖")}
          </button>
        </p>
      )}
    </section>
  );
}
