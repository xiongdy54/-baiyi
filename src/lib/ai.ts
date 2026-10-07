// AIGateway 渲染层客户端（文档§3.11）— 所有 AI 功能经此，不直调 LLM

// 供应商注册表元数据（v48.68 / D112）：随 ai:getConfig 下发，仅公开字段、永不含 Key
export interface AiPresetMeta {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  keyUrl: string;
  hint: string;
  group: string;
}

// 本地运行时探测结果（v48.68 / D112）：未命中 detected:false + 可读指引，主进程不抛错
export interface LocalDetectResult {
  detected: boolean;
  runtime?: string;
  runtimeName?: string;
  baseUrl?: string;
  models?: string[];
  message?: string;
}

declare global {
  interface Window {
    aiAPI?: {
      getConfig: () => Promise<{ preset: string; baseUrl: string; model: string; hasKey: boolean; keyUrl?: string; hint?: string; presetName?: string; reasoningEffort?: string; presets?: AiPresetMeta[] }>;
      setConfig: (partial: unknown) => Promise<unknown>;
      test: () => Promise<{ ok: boolean; message: string }>;
      listModels: () => Promise<string[]>;
      detectLocal?: () => Promise<LocalDetectResult>;
      websearch: (query: string) => Promise<{ title: string; snippet: string }[]>;
      chat: (requestId: string, messages: unknown[], temperature?: number) => void;
      onStream: (cb: (requestId: string, msg: { delta?: string; thinking?: number; done?: boolean; error?: string }) => void) => () => void;
    };
  }
}

export interface AIConfig {
  preset: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  reasoningEffort?: string;
  presets?: AiPresetMeta[];
}

// 「AI 功能可用」单一判据（v48.68 / D112）：本地预设免 Key（与主进程 needKey 纪律对齐）。
// kpExtract / InsightPanel / SettingsPanel 的无 Key 预检统一走这里——
// 此前 kpExtract/InsightPanel 只看 hasKey，本地无 Key 配置被误判为「无 Key」而静默跳过。
export function aiConfigUsable(cfg: { hasKey: boolean; preset: string } | null | undefined): boolean {
  return Boolean(cfg && (cfg.hasKey || cfg.preset === "local"));
}

// M1.1：多模态消息（图片挖空走 GLM vision）。文本消息保持 string 形态不变
export interface ChatTextPart {
  type: "text";
  text: string;
}
export interface ChatImagePart {
  type: "image_url";
  image_url: { url: string };
}
export interface ChatMessage {
  role: string;
  content: string | (ChatTextPart | ChatImagePart)[];
}

export const aiGateway = {
  async getConfig(): Promise<AIConfig | null> {
    if (!window.aiAPI) return null;
    return window.aiAPI.getConfig();
  },
  async setConfig(partial: Record<string, unknown>): Promise<void> {
    await window.aiAPI?.setConfig(partial);
  },
  async test(): Promise<{ ok: boolean; message: string }> {
    if (!window.aiAPI) return { ok: false, message: "API 不可用" };
    return window.aiAPI.test();
  },
  async listModels(): Promise<string[]> {
    if (!window.aiAPI) return [];
    return window.aiAPI.listModels();
  },
  async detectLocal(): Promise<LocalDetectResult | null> {
    if (!window.aiAPI?.detectLocal) return null;
    return window.aiAPI.detectLocal();
  },
  async websearch(query: string): Promise<{ title: string; snippet: string }[]> {
    if (!window.aiAPI) return [];
    return window.aiAPI.websearch(query);
  },
  // 流式对话：onDelta 累积增量；onThinking 上报思考模型（reasoning_content）的已思考字数；resolve 返回全文
  chat(
    messages: ChatMessage[],
    onDelta?: (acc: string, delta: string) => void,
    temperature?: number,
    onThinking?: (thinkChars: number) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!window.aiAPI) {
        reject(new Error("AI API 不可用"));
        return;
      }
      const requestId = Math.random().toString(36).slice(2);
      let acc = "";
      let finished = false;
      const off = window.aiAPI.onStream((rid, msg) => {
        if (rid !== requestId) return;
        if (msg.error) {
          if (!finished) {
            finished = true;
            off();
            reject(new Error(msg.error));
          }
          return;
        }
        if (msg.thinking !== undefined) {
          onThinking?.(msg.thinking);
        }
        if (msg.delta) {
          acc += msg.delta;
          onDelta?.(acc, msg.delta);
        }
        if (msg.done && !finished) {
          finished = true;
          off();
          resolve(acc);
        }
      });
      window.aiAPI.chat(requestId, messages, temperature);
    });
  }
};
