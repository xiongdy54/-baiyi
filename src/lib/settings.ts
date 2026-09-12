// SettingsStore — 三层 app / theme / plugin.<id>（Phase 0 用主进程 JSON 文件持久化）
// 接口与文档锁定一致，将来迁移 SQLite 不改调用方。
declare global {
  interface Window {
    settingsAPI?: {
      get: (scope: string, key?: string) => Promise<unknown>;
      set: (scope: string, key: string, value: unknown) => Promise<boolean>;
    };
    // v23（D20/§4.4.10）：FSRS 参数环境——活跃配置完整快照 + 主进程事实层推送（F9 热生效）
    fsrsAPI?: {
      getActiveConfig: () => Promise<{
        id: string;
        algorithm: string;
        algorithmVersion: number;
        weights: number[];
        schedulerOptions: Record<string, unknown> | null;
        source: string;
      } | null>;
      onConfigChanged: (callback: (configId: string) => void) => () => void;
    };
  }
}

const memoryFallback = new Map<string, unknown>();

// set 后广播 settings/changed（动态 import 避免循环依赖）
async function emitChanged(scope: string, key: string) {
  try {
    const { eventBus } = await import("./eventbus");
    eventBus.emit("settings/changed", { scope, key });
  } catch {
    /* 事件可选 */
  }
}

export const settingsStore = {
  async get<T>(scope: string, key: string, defaultValue: T): Promise<T> {
    try {
      if (!window.settingsAPI) {
        return (memoryFallback.get(`${scope}.${key}`) as T) ?? defaultValue;
      }
      const v = (await window.settingsAPI.get(scope, key)) as T | undefined;
      return v ?? defaultValue;
    } catch {
      return defaultValue;
    }
  },
  async set(scope: string, key: string, value: unknown): Promise<void> {
    if (!window.settingsAPI) {
      memoryFallback.set(`${scope}.${key}`, value);
      void emitChanged(scope, key);
      return;
    }
    await window.settingsAPI.set(scope, key, value);
    void emitChanged(scope, key);
  }
};
