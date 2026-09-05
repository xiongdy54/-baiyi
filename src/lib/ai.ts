// AIGateway 渲染层客户端（文档§3.11）— 所有 AI 功能经此，不直调 LLM
declare global {
  interface Window {
    aiAPI?: {
      getConfig: () => Promise<{ preset: string; baseUrl: string; model: string; hasKey: boolean; keyUrl?: string; hint?: string; presetName?: string; reasoningEffort?: string }>;
      setConfig: (partial: unknown) => Promise<unknown>;
      test: () => Promise<{ ok: boolean; message: string }>;
      listModels: () => Promise<string[]>;
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
  async websearch(query: string): Promise<{ title: string; snippet: string }[]> {
    if (!window.aiAPI) return [];
    return window.aiAPI.websearch(query);
  },
  // 流式对话：onDelta 累积增量；onThinking 上报思考模型（reasoning_content）的已思考字数；resolve 返回全文
  chat(
    messages: { role: string; content: string }[],
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
