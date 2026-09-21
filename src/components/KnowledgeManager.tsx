// 知识地基管理面板（v40，K1，D37 / §9.1 K1-4 最小管理面）：
// KP 搜索 / 新建 / 别名查看与维护 / 合并（确认制，可回滚）/ 关系与外部 ID / 旧字段归一提案。
// 完整图谱 UI 留 K8、AI staging 确认流留 K2；本面板是 K1 阶段唯一的 KP 人机面。
import { useCallback, useEffect, useMemo, useState } from "react";
import { cardsApi, type CardRecord } from "../lib/cards";
import { runKpAiProcessing } from "../lib/kpExtract";
import {
  KP_RELATION_TYPES,
  KP_RELATION_LABELS,
  knowledgeApi,
  relationLabel,
  type KnowledgePoint,
  type KnowledgeProposal,
  type KnowledgeRelation,
  type KnowledgeExternalRef,
  type KnowledgeLintIssue
} from "../lib/knowledge";
import { UDC_LEAVES, udcLabel } from "../lib/udc";
import { IconClose } from "./icons";

type Selected = KnowledgePoint | null;

function statusChip(status: KnowledgePoint["status"]): string {
  if (status === "merged") return "已合并";
  if (status === "deprecated") return "已弃用";
  return "";
}

export default function KnowledgeManager() {
  const [query, setQuery] = useState("");
  const [points, setPoints] = useState<KnowledgePoint[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Selected>(null);
  const [relations, setRelations] = useState<KnowledgeRelation[]>([]);
  const [refs, setRefs] = useState<KnowledgeExternalRef[]>([]);
  const [proposals, setProposals] = useState<KnowledgeProposal[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // 新建表单
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newDomain, setNewDomain] = useState("");
  // 合并流程（两步确认：选目标 → confirm）
  const [merging, setMerging] = useState(false);
  const [mergeQuery, setMergeQuery] = useState("");
  const [mergeTarget, setMergeTarget] = useState<Selected>(null);
  // 别名 / 外部 ID / 关系 的行内输入
  const [aliasInput, setAliasInput] = useState("");
  const [refKind, setRefKind] = useState<KnowledgeExternalRef["refKind"]>("wikidata-qid");
  const [refValue, setRefValue] = useState("");
  const [relTarget, setRelTarget] = useState<Selected>(null);
  const [relType, setRelType] = useState<(typeof KP_RELATION_TYPES)[number]>("related_to");
  const [relQuery, setRelQuery] = useState("");
  // 归一提案决策辅助：旧值 → 受影响卡片（提案只存旧值字符串，决策需看到卡面内容——
  // AI 制卡的 knowledgePointId 常是无语义簇 ID「kp1」，只看提案原文无法决策）
  const [legacyCardMap, setLegacyCardMap] = useState<Map<string, CardRecord[]>>(new Map());
  const [cardById, setCardById] = useState<Map<string, CardRecord>>(new Map());
  // 新建类提案接受前的名称修订（旧值「kp1」→ 正式名称）
  const [labelEdits, setLabelEdits] = useState<Record<string, string>>({});
  // v41（K2-A，D38）：AI 整理（存量簇）与一键全接受
  const [aiBusy, setAiBusy] = useState(false);
  const [clusterCount, setClusterCount] = useState(0);
  // v43（K2-B）：KnowledgeLint K4/K7/K8 报告型检查（手动触发、只读非阻断；null＝尚未跑过）
  const [lintBusy, setLintBusy] = useState(false);
  const [lintIssues, setLintIssues] = useState<KnowledgeLintIssue[] | null>(null);

  const loadLegacyCards = useCallback(async () => {
    try {
      const all = await cardsApi.listAll();
      const byKp = new Map<string, CardRecord[]>();
      const byId = new Map<string, CardRecord>();
      for (const c of all) {
        byId.set(c.id, c);
        const key = (c.knowledgePointId || "").trim();
        if (!key) continue;
        const bucket = byKp.get(key) || [];
        bucket.push(c);
        byKp.set(key, bucket);
      }
      setLegacyCardMap(byKp);
      setCardById(byId);
    } catch {
      setLegacyCardMap(new Map());
      setCardById(new Map());
    }
  }, []);

  const loadClusterCount = useCallback(async () => {
    try {
      const res = await knowledgeApi.kpClusters();
      setClusterCount(res?.totalUnnormalized ?? 0);
    } catch {
      setClusterCount(0);
    }
  }, []);

  async function runAiOrganize() {
    setError("");
    setNotice("");
    setAiBusy(true);
    try {
      const res = await runKpAiProcessing({});
      if (res.skipped === "no-key") setNotice("未配置 AI 服务 Key——「AI 整理」需要 AI；可在 设置 → AI 服务 配置后重试。");
      else if (res.skipped === "no-prompt") setNotice("知识抽取提示词（knowledge-extraction）未播种，请重启应用完成播种。");
      else if (res.skipped === "no-clusters") setNotice("没有待归一的卡片簇。");
      else if (res.error) setError(`AI 整理失败：${res.error}`);
      else if (res.summary) {
        const s = res.summary;
        setNotice(
          `AI 整理完成（${res.clusterCount} 簇）：自动归一 ${s.autoLinked.length} · 新建提案 ${s.created.length} · 归并提案 ${s.linked.length} · 关系 ${s.relations.length}` +
            (s.conflicts.length ? ` · 歧义待决 ${s.conflicts.length}` : "") +
            (s.dedupSkipped ? ` · 重复跳过 ${s.dedupSkipped}` : "") +
            (s.skipped.length ? ` · 跳过 ${s.skipped.length}` : "")
        );
      }
      await Promise.all([loadProposals(), loadLegacyCards(), loadPoints(query), loadClusterCount()]);
    } catch (err) {
      fail(err);
    } finally {
      setAiBusy(false);
    }
  }

  async function acceptAll() {
    if (!proposals.length) return;
    if (!window.confirm(`接受全部 ${proposals.length} 条提案？\n\n顺序：新建知识点 → 归并 → 关系 → 合并；单条失败不中断。`)) return;
    setError("");
    try {
      const res = await knowledgeApi.acceptAllPending();
      if (res) {
        setNotice(`已接受 ${res.accepted.length} 条${res.failed.length ? `，失败 ${res.failed.length} 条：${res.failed.map((f) => f.error).slice(0, 3).join("；")}` : ""}`);
        if (res.failed.length) setError(res.failed.map((f) => f.error).join("；"));
      }
      await Promise.all([loadProposals(), loadPoints(query), loadClusterCount(), loadLegacyCards()]);
      if (selected) await loadDetail(await knowledgeApi.getPoint(selected.id));
    } catch (err) {
      fail(err);
    }
  }

  const loadPoints = useCallback(
    async (q?: string) => {
      const res = await knowledgeApi.listPoints({ query: q, limit: 300 });
      setPoints(res.points);
      setTotal(res.total);
    },
    []
  );

  const loadProposals = useCallback(async () => {
    setProposals(await knowledgeApi.listProposals({ status: "pending" }));
  }, []);

  const loadDetail = useCallback(async (kp: Selected) => {
    setSelected(kp);
    if (!kp) {
      setRelations([]);
      setRefs([]);
      return;
    }
    setRelations(await knowledgeApi.listRelations({ kpId: kp.id, limit: 200 }));
    setRefs(await knowledgeApi.listRefs(kp.id));
  }, []);

  useEffect(() => {
    void loadPoints();
    void loadProposals();
    void loadLegacyCards();
    void loadClusterCount();
  }, [loadPoints, loadProposals, loadLegacyCards, loadClusterCount]);

  function fail(err: unknown) {
    setError(err instanceof Error ? err.message : String(err));
  }

  async function create() {
    const label = newLabel.trim();
    if (!label) return;
    setError("");
    try {
      const kp = await knowledgeApi.createPoint({ canonicalLabel: label, domainId: newDomain || null, aliases: [] });
      setNewLabel("");
      setNewDomain("");
      setCreating(false);
      setNotice(`已创建「${kp?.canonicalLabel ?? label}」`);
      await loadPoints(query);
      await loadDetail(kp);
    } catch (err) {
      fail(err);
    }
  }

  async function doMerge() {
    if (!selected || !mergeTarget) return;
    if (!window.confirm(`确定把「${selected.canonicalLabel}」合并进「${mergeTarget.canonicalLabel}」？\n\n合并可回滚：别名并入目标，被合并方保留（可解除合并）。`)) return;
    setError("");
    try {
      await knowledgeApi.mergePoints(selected.id, mergeTarget.id);
      setMerging(false);
      setMergeTarget(null);
      setMergeQuery("");
      setNotice(`已合并。可在目标「${mergeTarget.canonicalLabel}」下查看别名。`);
      await loadPoints(query);
      await loadDetail(await knowledgeApi.getPoint(mergeTarget.id));
    } catch (err) {
      fail(err);
    }
  }

  async function unmerge(kp: KnowledgePoint) {
    if (!window.confirm(`解除合并：「${kp.canonicalLabel}」将恢复为独立知识点（别名还原）。`)) return;
    setError("");
    try {
      await knowledgeApi.unmergePoint(kp.id);
      await loadPoints(query);
      await loadDetail(await knowledgeApi.getPoint(kp.id));
    } catch (err) {
      fail(err);
    }
  }

  async function toggleDeprecated(kp: KnowledgePoint) {
    const to = kp.status === "deprecated" ? "active" : "deprecated";
    setError("");
    try {
      await knowledgeApi.updatePoint(kp.id, { status: to });
      await loadPoints(query);
      await loadDetail(await knowledgeApi.getPoint(kp.id));
    } catch (err) {
      fail(err);
    }
  }

  async function addAlias() {
    if (!selected || !aliasInput.trim()) return;
    setError("");
    try {
      const next = [...(selected.aliases || [])];
      if (!next.includes(aliasInput.trim())) next.push(aliasInput.trim());
      const kp = await knowledgeApi.updatePoint(selected.id, { aliases: next });
      setAliasInput("");
      if (kp) await loadDetail(kp);
      await loadPoints(query);
    } catch (err) {
      fail(err);
    }
  }

  async function removeAlias(alias: string) {
    if (!selected) return;
    setError("");
    try {
      const kp = await knowledgeApi.updatePoint(selected.id, { aliases: (selected.aliases || []).filter((a) => a !== alias) });
      if (kp) await loadDetail(kp);
      await loadPoints(query);
    } catch (err) {
      fail(err);
    }
  }

  async function addRef() {
    if (!selected || !refValue.trim()) return;
    setError("");
    try {
      await knowledgeApi.createRef({ knowledgePointId: selected.id, refKind, refValue: refValue.trim() });
      setRefValue("");
      setRefs(await knowledgeApi.listRefs(selected.id));
    } catch (err) {
      fail(err);
    }
  }

  async function addRelation() {
    if (!selected || !relTarget) return;
    setError("");
    try {
      await knowledgeApi.createRelation({
        fromKnowledgePointId: selected.id,
        toKnowledgePointId: relTarget.id,
        relationType: relType,
        source: "user"
      });
      setRelTarget(null);
      setRelQuery("");
      setRelations(await knowledgeApi.listRelations({ kpId: selected.id, limit: 200 }));
    } catch (err) {
      fail(err);
    }
  }

  async function scanMigration() {
    setError("");
    try {
      const res = await knowledgeApi.migrationSuggestions();
      if (res) setNotice(`归一建议：新增 ${res.created} 条（跳过 ${res.skipped}，扫描 ${res.scanned} 个旧字段值）`);
      await loadLegacyCards(); // 受影响卡索引同步刷新（提案决策卡的卡面预览依赖它）
      await loadProposals();
    } catch (err) {
      fail(err);
    }
  }

  // v43（K2-B）：KnowledgeLint K4/K7/K8——确定性本地检查，结果只读（不阻断任何操作）
  async function runLint() {
    setError("");
    setLintBusy(true);
    try {
      const issues = await knowledgeApi.lint();
      setLintIssues(issues);
      const warns = issues.filter((i) => i.severity === "warn").length;
      setNotice(
        issues.length
          ? `质量检查完成：共 ${issues.length} 条（警告 ${warns} · 提示 ${issues.length - warns}）。均为非阻断提示。`
          : "质量检查完成：未发现问题。"
      );
    } catch (err) {
      fail(err);
    } finally {
      setLintBusy(false);
    }
  }

  async function jumpToLintKp(id: string) {
    const kp = await knowledgeApi.getPoint(id);
    if (kp) await loadDetail(kp);
  }

  async function resolveProposal(p: KnowledgeProposal, accept: boolean) {
    setError("");
    try {
      // 新建类提案：接受前允许用户把无语义旧值（如 AI 簇 ID「kp1」）修订为正式名称
      const override =
        p.proposalKind === "point" && p.payload.action !== "link" && labelEdits[p.id]?.trim()
          ? { canonicalLabel: labelEdits[p.id].trim() }
          : undefined;
      await knowledgeApi.resolveProposal(p.id, accept, override);
      setLabelEdits((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
      await loadProposals();
      await loadLegacyCards();
      await loadPoints(query);
      if (selected) await loadDetail(await knowledgeApi.getPoint(selected.id));
    } catch (err) {
      fail(err);
    }
  }

  const mergeTargets = points.filter((p) => p.status === "active" && p.id !== selected?.id && (!mergeQuery.trim() || p.canonicalLabel.toLowerCase().includes(mergeQuery.trim().toLowerCase()) || (p.aliases || []).some((a) => a.toLowerCase().includes(mergeQuery.trim().toLowerCase()))));
  const relTargets = points.filter((p) => p.status === "active" && p.id !== selected?.id && (!relQuery.trim() || p.canonicalLabel.toLowerCase().includes(relQuery.trim().toLowerCase())));

  return (
    <div className="kmg-wrap">
      <div className="cb-toolbar">
        <input
          className="cb-search"
          placeholder="搜索知识点名称或别名…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            void loadPoints(e.target.value);
          }}
        />
        <button className="btn btn-outline btn-sm" onClick={() => setCreating((v) => !v)}>
          {creating ? "取消" : "新建知识点"}
        </button>
        <button className="btn btn-outline btn-sm" onClick={() => void scanMigration()} title="本地扫描：有语义的旧值（非 kp1 编号）与已有知识点做字符串匹配，生成提案。编号簇请用「AI 整理」。">
          扫描归一建议
        </button>
        {/* v41（K2-A，D38）：AI 抽取归一——批量处理存量待归一簇（编号簇 kp1… 必须走这条） */}
        <button
          className="btn btn-outline btn-sm"
          disabled={aiBusy}
          onClick={() => void runAiOrganize()}
          title="用 AI 读取每个卡片簇的实际卡面内容，归一到已有知识点或建议新建（多次运行结果一致；无 Key 时静默跳过）"
        >
          {aiBusy ? "AI 整理中…" : `AI 整理${clusterCount > 0 ? `（${clusterCount} 簇待归一）` : ""}`}
        </button>
        {/* v43（K2-B）：KnowledgeLint K4/K7/K8 报告型检查（只读非阻断） */}
        <button
          className="btn btn-outline btn-sm"
          disabled={lintBusy}
          onClick={() => void runLint()}
          title="本地确定性检查：K4 领域受控清单/卡与知识点领域不一致（警告）、K7 概念过宽（提示）、K8 概念过窄单例孤立（提示）。不修改任何数据。"
        >
          {lintBusy ? "检查中…" : "质量检查"}
        </button>
        <span className="mono kmg-count">{total} 个知识点</span>
      </div>

      {(error || notice) && (
        <div className={`kmg-msg mono ${error ? "kmg-msg-error" : ""}`}>
          {error || notice}
          <button className="journal-link" onClick={() => { setError(""); setNotice(""); }}>
            关闭
          </button>
        </div>
      )}

      {creating && (
        <div className="kmg-form">
          <input className="cb-search" placeholder="知识点名称（canonical label）" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          <select className="dd-btn" value={newDomain} onChange={(e) => setNewDomain(e.target.value)}>
            <option value="">领域（可空）</option>
            {UDC_LEAVES.map((d) => (
              <option key={d.code} value={d.code}>
                {d.code} {d.label}
              </option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" disabled={!newLabel.trim()} onClick={() => void create()}>
            创建
          </button>
        </div>
      )}

      <div className="kmg-cols">
        <div className="kmg-list">
          {points.map((p) => (
            <div key={p.id} className={`kmg-row${selected?.id === p.id ? " active" : ""}`} onClick={() => void loadDetail(p)}>
              <div className="kmg-row-head">
                <span className="kmg-row-label">{p.canonicalLabel}</span>
                <span className="mono kmg-row-meta">
                  {p.domainId ? udcLabel(p.domainId) || p.domainId : ""}
                  {statusChip(p.status) ? ` · ${statusChip(p.status)}` : ""}
                </span>
              </div>
              {(p.aliases || []).length > 0 && <div className="kmg-row-alias">别名：{(p.aliases || []).join(" / ")}</div>}
            </div>
          ))}
          {points.length === 0 && <div className="empty-state"><p className="empty-text">还没有知识点。新建，或「扫描归一建议」从存量卡片生成提案。</p></div>}
        </div>

        <div className="kmg-detail">
          {!selected && <div className="empty-state"><p className="empty-text">左侧选择一个知识点查看详情。</p></div>}
          {selected && (
            <>
              <div className="kmg-detail-head">
                <h3>{selected.canonicalLabel}</h3>
                <span className="mono">
                  {selected.domainId ? udcLabel(selected.domainId) || selected.domainId : "无领域"}
                  {statusChip(selected.status) ? ` · ${statusChip(selected.status)}` : ""}
                  {selected.mergedInto ? " · 已并入" : ""}
                </span>
              </div>
              {selected.description && <p className="kmg-desc">{selected.description}</p>}

              <div className="kmg-actions">
                {selected.status === "active" && (
                  <button className="btn btn-outline btn-sm" onClick={() => setMerging((v) => !v)}>
                    {merging ? "取消合并" : "合并到…"}
                  </button>
                )}
                {selected.status === "merged" && (
                  <button className="btn btn-outline btn-sm" onClick={() => void unmerge(selected)}>
                    解除合并
                  </button>
                )}
                <button className="btn btn-outline btn-sm" onClick={() => void toggleDeprecated(selected)}>
                  {selected.status === "deprecated" ? "恢复为 active" : "弃用"}
                </button>
              </div>

              {merging && (
                <div className="kmg-form">
                  <input className="cb-search" placeholder="搜索目标知识点…" value={mergeQuery} onChange={(e) => setMergeQuery(e.target.value)} />
                  <div className="kmg-pick">
                    {mergeTargets.slice(0, 20).map((p) => (
                      <button key={p.id} className={`kmg-pick-item${mergeTarget?.id === p.id ? " active" : ""}`} onClick={() => setMergeTarget(p)}>
                        {p.canonicalLabel}
                      </button>
                    ))}
                  </div>
                  <button className="btn btn-primary btn-sm" disabled={!mergeTarget} onClick={() => void doMerge()}>
                    {mergeTarget ? `合并进「${mergeTarget.canonicalLabel}」` : "先选目标"}
                  </button>
                </div>
              )}

              <p className="kmg-sec">别名（canonical label 之外的检索入口）</p>
              <div className="kmg-alias-list">
                {(selected.aliases || []).map((a) => (
                  <span key={a} className="kmg-chip">
                    {a}
                    <button className="kmg-chip-x" title="删除别名" onClick={() => void removeAlias(a)}>
                      <IconClose size={12} />
                    </button>
                  </span>
                ))}
                {(selected.aliases || []).length === 0 && <span className="mono kmg-row-meta">（无别名）</span>}
              </div>
              {selected.status === "active" && (
                <div className="kmg-form">
                  <input className="cb-search" placeholder="添加别名…" value={aliasInput} onChange={(e) => setAliasInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void addAlias()} />
                  <button className="btn btn-outline btn-sm" disabled={!aliasInput.trim()} onClick={() => void addAlias()}>
                    加别名
                  </button>
                </div>
              )}

              <p className="kmg-sec">关系（一跳）</p>
              <div className="kmg-rel-list">
                {relations.map((r) => {
                  const outbound = r.fromKnowledgePointId === selected.id || (selected.mergedInto && r.fromKnowledgePointId === selected.id);
                  const dirLabel = outbound ? "→" : "←";
                  const otherId = outbound ? r.toKnowledgePointId : r.fromKnowledgePointId;
                  return (
                    <div key={r.id} className="kmg-rel-row">
                      <span className="mono">
                        {dirLabel} {relationLabel(r.relationType)} {dirLabel}
                      </span>
                      <span className="kmg-rel-other">{points.find((p) => p.id === otherId)?.canonicalLabel || otherId.slice(0, 8)}</span>
                      <span className="mono kmg-row-meta">
                        {r.source === "ai-inference" ? "AI 提议" : r.source === "user" ? "手动" : r.source}
                      </span>
                      <button
                        className="journal-link"
                        onClick={() => {
                          void knowledgeApi.deleteRelation(r.id).then(() => knowledgeApi.listRelations({ kpId: selected.id, limit: 200 }).then(setRelations));
                        }}
                      >
                        删除
                      </button>
                    </div>
                  );
                })}
                {relations.length === 0 && <span className="mono kmg-row-meta">（暂无关系）</span>}
              </div>
              {selected.status === "active" && (
                <div className="kmg-form">
                  <input className="cb-search" placeholder="搜索另一端知识点…" value={relQuery} onChange={(e) => setRelQuery(e.target.value)} />
                  <select className="dd-btn" value={relType} onChange={(e) => setRelType(e.target.value as (typeof KP_RELATION_TYPES)[number])}>
                    {KP_RELATION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {KP_RELATION_LABELS[t]}
                      </option>
                    ))}
                  </select>
                  <div className="kmg-pick">
                    {relTargets.slice(0, 20).map((p) => (
                      <button key={p.id} className={`kmg-pick-item${relTarget?.id === p.id ? " active" : ""}`} onClick={() => setRelTarget(p)}>
                        {p.canonicalLabel}
                      </button>
                    ))}
                  </div>
                  <button className="btn btn-outline btn-sm" disabled={!relTarget} onClick={() => void addRelation()}>
                    {relTarget ? `建边 →「${relTarget.canonicalLabel}」` : "先选另一端"}
                  </button>
                </div>
              )}

              <p className="kmg-sec">外部 ID grounding</p>
              <div className="kmg-rel-list">
                {refs.map((r) => (
                  <div key={r.id} className="kmg-rel-row">
                    <span className="mono kmg-row-meta">{r.refKind}</span>
                    <span>{r.refValue}</span>
                    <button
                      className="journal-link"
                      onClick={() => {
                        void knowledgeApi.deleteRef(r.id).then(() => knowledgeApi.listRefs(selected.id).then(setRefs));
                      }}
                    >
                      删除
                    </button>
                  </div>
                ))}
                {refs.length === 0 && <span className="mono kmg-row-meta">（无外部 ID）</span>}
              </div>
              {selected.status === "active" && (
                <div className="kmg-form">
                  <select className="dd-btn" value={refKind} onChange={(e) => setRefKind(e.target.value as KnowledgeExternalRef["refKind"])}>
                    <option value="wikidata-qid">Wikidata QID</option>
                    <option value="wikipedia-url">Wikipedia URL</option>
                    <option value="isbn">ISBN</option>
                    <option value="doi">DOI</option>
                    <option value="custom">自定义</option>
                  </select>
                  <input className="cb-search" placeholder="外部 ID 值…" value={refValue} onChange={(e) => setRefValue(e.target.value)} />
                  <button className="btn btn-outline btn-sm" disabled={!refValue.trim()} onClick={() => void addRef()}>
                    添加
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* v43（K2-B）：KnowledgeLint K4/K7/K8 检查结果（只读；点知识点名可跳详情） */}
      {lintIssues !== null && (
        <div>
          <p className="kmg-sec mb-1">
            质量检查结果（KnowledgeLint）
            <button className="journal-link ml-3" onClick={() => setLintIssues(null)}>
              收起
            </button>
          </p>
          <div className="kmg-lint-list">
            {lintIssues.length === 0 && <span className="mono kmg-row-meta">未发现问题（K4 领域一致性 · K7 过宽 · K8 过窄）。</span>}
            {lintIssues.map((i, idx) => (
              <div key={`${i.ruleId}-${i.knowledgePointId}-${idx}`} className="kmg-rel-row">
                <span className={`kmg-chip${i.severity === "warn" ? " kmg-chip-warn" : ""}`}>
                  {i.ruleId} · {i.severity === "warn" ? "警告" : "提示"}
                </span>
                <button className="journal-link" onClick={() => void jumpToLintKp(i.knowledgePointId)}>
                  {i.kpLabel}
                </button>
                <span className="kmg-rel-other">{i.message}</span>
                <span className="kmg-lint-detail">{i.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="kmg-sec">
        归一提案（pending {proposals.length}）
        {proposals.length > 0 && (
          <button className="btn btn-primary btn-sm ml-3" onClick={() => void acceptAll()}>
            全部接受（{proposals.length}）
          </button>
        )}
      </p>
      <div className="kmg-prop-list">
        {proposals.map((p) => {
          const pay = p.payload || {};
          const clusters = Array.isArray(pay.clusters) ? pay.clusters : [];
          // 受影响卡：优先用 clusters[].cardIds（v41 新形状，跨书精确），回落旧值索引（K1 形状）
          const affectedFromClusters = clusters.flatMap((c) => (c.cardIds || []).map((id) => cardById.get(String(id))).filter(Boolean)) as CardRecord[];
          const affected = affectedFromClusters.length ? affectedFromClusters : legacyCardMap.get(String(pay.legacyKey || "")) || [];
          const kindTag =
            p.proposalKind === "point" ? (pay.action === "link" ? "归一链接" : "新建建议") :
            p.proposalKind === "relation" ? "关系提案" : "合并提案";
          const editedLabel = labelEdits[p.id] ?? String(pay.canonicalLabel ?? pay.legacyKey ?? "");
          const kpName = (id?: string | null, fallback?: string | null) =>
            (id && points.find((x) => x.id === id)?.canonicalLabel) || fallback || (id ? id.slice(0, 8) : "?");
          const unresolvedRel = p.proposalKind === "relation" && (!pay.fromKnowledgePointId || !pay.toKnowledgePointId);
          return (
            <div key={p.id} className="kmg-prop-card card-outlined">
              <div className="kmg-prop-head">
                <span className="kmg-chip">{kindTag}</span>
                {p.proposalKind === "point" && (
                  <span className="kmg-prop-main">
                    {clusters.length > 1 ? (
                      <>
                        归并 {clusters.length} 个卡片簇：<strong>「{clusters.map((c) => c.legacyKey).join("」「")}」</strong> · 共 {clusters.reduce((n, c) => n + (c.cardCount || 0), 0)} 张卡
                      </>
                    ) : (
                      <>
                        旧字段值 <strong>「{String(pay.legacyKey ?? clusters[0]?.legacyKey ?? "?")}」</strong> · 影响 {pay.cardCount ?? clusters[0]?.cardCount ?? affected.length} 张卡
                      </>
                    )}
                    {pay.aiAssisted && <span className="mono kmg-row-meta">（AI 整理建议）</span>}
                    {pay.targetInvalid && <span className="mono kmg-row-meta">（AI 目标越界已降级为新建）</span>}
                  </span>
                )}
                {p.proposalKind === "relation" && (
                  <span className="kmg-prop-main">
                    {kpName(pay.fromKnowledgePointId, pay.fromRef?.label)} <strong>{relationLabel(pay.relationType || "")}</strong> {kpName(pay.toKnowledgePointId, pay.toRef?.label)}
                    {unresolvedRel && <span className="mono kmg-row-meta">（等待端点归一后可用）</span>}
                  </span>
                )}
                {p.proposalKind === "merge" && (
                  <span className="kmg-prop-main">
                    合并 {kpName(pay.sourceId)} → {kpName(pay.targetKpId || pay.targetId)}
                  </span>
                )}
                {pay.confidence != null && p.proposalKind !== "merge" && (
                  <span className="mono kmg-row-meta">置信 {pay.confidence}</span>
                )}
              </div>
              {p.proposalKind === "point" && pay.action === "link" && (
                <div className="kmg-prop-line">
                  → 归并到「{kpName(pay.targetKpId, pay.targetLabel)}」{pay.similarity != null ? `（相似度 ${Math.round(Number(pay.similarity) * 100)}%）` : ""}
                  {Array.isArray(pay.aliases) && pay.aliases.length > 0 ? `，并记别名：${pay.aliases.join("、")}` : ""}
                </div>
              )}
              {p.proposalKind === "point" && pay.action !== "link" && (
                <div className="kmg-prop-line kmg-prop-edit">
                  → 新建知识点，名称：
                  <input
                    className="cb-search"
                    value={editedLabel}
                    onChange={(e) => setLabelEdits((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    placeholder="正式名称（可修订，默认用 AI/旧值）"
                  />
                  {pay.description ? <span className="mono kmg-row-meta">{pay.description}</span> : null}
                </div>
              )}
              {p.proposalKind === "relation" && pay.evidence && (
                <div className="kmg-prop-line mono kmg-row-meta">依据：{pay.evidence}</div>
              )}
              {p.proposalKind !== "merge" && (affected.length > 0 ? (
                <div className="kmg-prop-evidence">
                  <span className="mono kmg-row-meta">受影响卡面预览：</span>
                  {affected.slice(0, 4).map((c) => (
                    <p key={c.id} className="kmg-prop-card-front">
                      {c.contextPrefix ? `${c.contextPrefix} ` : ""}
                      {(c.frontMarkdown || c.noteText || "").slice(0, 60)}
                      {(c.frontMarkdown || c.noteText || "").length > 60 ? "…" : ""}
                    </p>
                  ))}
                  {affected.length > 4 && <span className="mono kmg-row-meta">…另有 {affected.length - 4} 张</span>}
                </div>
              ) : (
                <div className="kmg-prop-evidence">
                  <span className="mono kmg-row-meta">（未在当前卡片库找到该旧值的卡片——可能已被删除）</span>
                </div>
              ))}
              <div className="kmg-prop-actions">
                <button className="btn btn-primary btn-sm" onClick={() => void resolveProposal(p, true)}>
                  接受
                </button>
                <button className="btn btn-outline btn-sm" onClick={() => void resolveProposal(p, false)}>
                  拒绝
                </button>
              </div>
            </div>
          );
        })}
        {proposals.length === 0 && <span className="mono kmg-row-meta">（暂无待处理提案）</span>}
      </div>
    </div>
  );
}
