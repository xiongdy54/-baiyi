// FSRS 参数环境常量与指纹（v23，D20 / §4.4.10）
// FSRS6_DEFAULT_WEIGHTS 必须与锁定版本 ts-fsrs 5.4.2 generatorParameters().w 逐位一致——
// S7 测试以 live ts-fsrs 断言该校验；升级 ts-fsrs 时须重新核对，并作为新 config 行播种。
// scheduler_options_json 必须涵盖所有影响 FSRS 调度结果的 option（§4.4.10 契约）。
const crypto = require("crypto");

const DEFAULT_CONFIG_ID = "cfg-default";
const ALGORITHM = "FSRS";
const ALGORITHM_VERSION = 6; // FSRS 算法代际（非 npm 包版本）

// 与 ts-fsrs 5.4.2 generatorParameters() 默认值逐位一致（已实测核对；S7 断言持续校验）
const FSRS6_DEFAULT_WEIGHTS = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666,
  0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658,
  0.1542
];

const DEFAULT_SCHEDULER_OPTIONS = {
  requestRetention: 0.9,
  maximumInterval: 36500,
  enableShortTerm: true,
  learningSteps: ["1m", "10m"],
  relearningSteps: ["10m"],
  enableFuzz: false
};

// 规范序列化（键排序，数组保序）——指纹与键序无关
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
}

// 配置指纹：algorithm+代际+weights+options 的规范哈希（同一配置永远一个 config_id）
function configFingerprint(weights, schedulerOptions) {
  const payload = canonicalJson({
    algorithm: ALGORITHM,
    algorithm_version: ALGORITHM_VERSION,
    weights,
    scheduler_options: schedulerOptions
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

module.exports = {
  DEFAULT_CONFIG_ID,
  ALGORITHM,
  ALGORITHM_VERSION,
  FSRS6_DEFAULT_WEIGHTS,
  DEFAULT_SCHEDULER_OPTIONS,
  canonicalJson,
  configFingerprint
};
