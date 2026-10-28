// AI 抽取归一编排（v41，K2-A，D38）——渲染层唯一入口，位置与制卡/洞察管线一致：
// 主进程只做输入装配（kpExtractPrepare）与确定性裁决（kpExtractApply）；本模块只负责调 AI
// （两个 scope 各一次、temperature 0.1、无 Key 静默跳过）。AI 跑几次结果不变由主进程裁决器保证。
import { aiConfigUsable, aiGateway } from "./ai";
import { knowledgeApi, type KpExtractionSummary } from "./knowledge";

export type KpAiSkipReason = "unsupported" | "no-clusters" | "no-key" | "no-prompt" | null;

export interface KpAiResult {
  skipped: KpAiSkipReason;
  clusterCount: number;
  summary: KpExtractionSummary | null;
  error?: string;
}

/** 跑一轮 AI 抽取归一 + 关系抽取（batch=存量全量；sources=制卡顺带）。失败不抛，返回可读结果。 */
export async function runKpAiProcessing(opts: { sources?: { knowledgePointId: string; genBatchId?: string | null; documentId?: string | null }[] } = {}): Promise<KpAiResult> {
  if (!window.knowledgeAPI?.kpExtractPrepare) return { skipped: "unsupported", clusterCount: 0, summary: null };
  const prep = await knowledgeApi.kpExtractPrepare(opts);
  if (!prep || prep.clusterCount === 0) return { skipped: "no-clusters", clusterCount: 0, summary: null };
  const cfg = await aiGateway.getConfig();
  // aiConfigUsable：本地预设免 Key（v48.68 / D112——此前只看 hasKey，本地无 Key 配置被误判静默跳过）
  if (!aiConfigUsable(cfg)) return { skipped: "no-key", clusterCount: prep.clusterCount, summary: null };
  const tplE = await window.promptsAPI?.get("knowledge-extraction");
  if (!tplE?.content) return { skipped: "no-prompt", clusterCount: prep.clusterCount, summary: null };
  try {
    const rawE = await aiGateway.chat(
      [
        { role: "system", content: tplE.content },
        { role: "user", content: prep.extractionInput }
      ],
      undefined,
      0.1,
      undefined,
      undefined,
      "kp_extract"
    );
    let rawR = "";
    if (prep.relationInput) {
      const tplR = await window.promptsAPI?.get("knowledge-relation");
      if (tplR?.content) {
        try {
          rawR = await aiGateway.chat(
            [
              { role: "system", content: tplR.content },
              { role: "user", content: prep.relationInput }
            ],
            undefined,
            0.1,
            undefined,
            undefined,
            "kp_extract"
          );
        } catch {
          rawR = ""; // 关系抽取失败不阻塞归一主结果
        }
      }
    }
    const summary = await knowledgeApi.kpExtractApply(rawE, rawR);
    return { skipped: null, clusterCount: prep.clusterCount, summary };
  } catch (err) {
    return { skipped: null, clusterCount: prep.clusterCount, summary: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 制卡顺带（D38 触发方式①）：接受入库后按批次簇后台静默处理——不阻塞、不弹窗、失败静默。 */
export function autoQueueKpAiProcessing(sources: { knowledgePointId: string; genBatchId?: string | null; documentId?: string | null }[]): void {
  const valid = (sources || []).filter((s) => s && String(s.knowledgePointId || "").trim());
  if (!valid.length) return;
  // 同一批（同 genBatchId）内按簇去重，避免一次接受多张卡触发多轮相同处理
  const seen = new Set<string>();
  const uniq = [];
  for (const s of valid) {
    const key = `${s.genBatchId || ""}|${s.documentId || ""}|${s.knowledgePointId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(s);
  }
  void runKpAiProcessing({ sources: uniq }).catch(() => {
    /* 顺带路径静默失败：不打扰制卡（用户可随时在知识点页签手动 AI 整理） */
  });
}
