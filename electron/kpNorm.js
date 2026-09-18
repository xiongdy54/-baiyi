// v41（K2-A，D38 / §4.6「AI 抽取归一硬性规范」）：知识归一纯函数层（零依赖，主进程与测试共用）。
// 三层确定性架构的「入层」与「幂等键」都依赖本模块——AI 跑多少次结果不变，靠这里的规则保证：
//   ① normalizeKpLabel：NFKC + 去标点空白 + 大小写折叠 → normKey（同 normKey 全库至多一个 active KP）
//   ② kpClusterKeyFor：批次簇键——新卡 batch:<genBatchId>:<kp> / 存量 doc:<documentId>:<kp> / 无锚 legacy:<kp>
//      （AI 制卡写入的 knowledge_point_id 是**每批材料内部簇编号**，跨材料必然同名碰撞，簇键解绑）
//   ③ kpProposalFingerprint：提案幂等键——同指纹（任何状态，含已拒绝）已存在即跳过，否决即事实。
const crypto = require("crypto");

// 归一化：NFKC 折叠全角/半角与兼容字符，去掉所有空白与常见标点，再小写。
// 目的不是展示（展示永远用原始写法），而是「同一概念的不同写法收敛到同一 normKey」。
function normalizeKpLabel(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "")
    .replace(/[·・.,，。、；;：:!！?？"'“”‘’`´()（）\[\]【】{}<>《》〈〉\-—_/\\|~^*+=&%$#@°′″]/g, "");
}

// 批次簇键：同一簇 = 同一制卡动作内的一段材料。优先级 batch > doc > legacy。
function kpClusterKeyFor({ genBatchId, documentId, knowledgePointId } = {}) {
  const kp = String(knowledgePointId ?? "").trim();
  if (!kp) return "";
  const batch = String(genBatchId ?? "").trim();
  if (batch) return `batch:${batch}:${kp}`;
  const doc = String(documentId ?? "").trim();
  if (doc) return `doc:${doc}:${kp}`;
  return `legacy:${kp}`;
}

// 提案指纹：kind + 各部件（端点/簇键/动作/归一标签），sha1 定长。
function kpProposalFingerprint(kind, parts) {
  const list = Array.isArray(parts) ? parts : [parts];
  return crypto
    .createHash("sha1")
    .update([String(kind), ...list.map((p) => String(p ?? ""))].join("\u0000"))
    .digest("hex");
}

// 簇编号识别：「kp1 / KP_2 / kp-3」这类无语义编号不做别名（跨书必然碰撞，做别名有害）。
function isOpaqueClusterId(text) {
  const t = String(text ?? "").trim();
  if (!t) return true;
  return /^kp[\s_-]*\d+$/i.test(t);
}

module.exports = { normalizeKpLabel, kpClusterKeyFor, kpProposalFingerprint, isOpaqueClusterId };
