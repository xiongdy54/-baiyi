// 皮肤引擎 v2 · 注册表（v49.0 / D170）
// 构建期注册 + 懒加载：load() 返回 Promise<SkinModule>，模块缓存避免二次加载；
// 未知 id 回落默认皮肤（getSkinEntry 永不失败——旧持久化值安全降级，D132 互斥不变）。
import type { SkinEntry, SkinModule } from "./types";
import { swissManifest } from "./swiss/manifest";
import { claudeManifest } from "./claude/manifest";

const BUILTIN: SkinEntry[] = [
  { manifest: swissManifest, load: async () => ({}) },
  // v49.0 / D173：Claude（陶土）——第一支 v2 皮肤，懒加载不进主包
  { manifest: claudeManifest, load: () => import("./claude").then((m) => m.default) },
];

// v49.0 / D170（P6）：引擎能力回归样本——仅开发环境注册；生产构建产物搜不到 skin-lab
if (import.meta.env.DEV) {
  BUILTIN.push({
    manifest: (await import("./_lab/manifest")).labManifest,
    load: () => import("./_lab/index").then((m) => m.default),
  });
}

export const SKINS: readonly SkinEntry[] = BUILTIN;
export const DEFAULT_SKIN_ID = "none";

export function getSkinEntry(id: string): SkinEntry {
  return SKINS.find((s) => s.manifest.id === id) ?? SKINS[0];
}

const cache = new Map<string, SkinModule>();

/** 加载并缓存皮肤模块；失败时抛错，由调用方回落默认皮肤 */
export async function loadSkin(id: string): Promise<SkinModule> {
  const entry = getSkinEntry(id);
  const hit = cache.get(entry.manifest.id);
  if (hit) return hit;
  const mod = await entry.load();
  cache.set(entry.manifest.id, mod);
  return mod;
}

export function getCachedSkin(id: string): SkinModule | undefined {
  return cache.get(getSkinEntry(id).manifest.id);
}
