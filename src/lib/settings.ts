// SettingsStore — 三层 app / theme / plugin.<id>（Phase 0 用主进程 JSON 文件持久化）
// 接口与文档锁定一致，将来迁移 SQLite 不改调用方。
declare global {
  interface Window {
    settingsAPI?: {
      get: (scope: string, key?: string) => Promise<unknown>;
      set: (scope: string, key: string, value: unknown) => Promise<boolean>;
    };
  }
}

const memoryFallback = new Map<string, unknown>();

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
      return;
    }
    await window.settingsAPI.set(scope, key, value);
  }
};
