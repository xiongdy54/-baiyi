// 批 4（规格 §9.2）：就地批注的四个设置键——渲染层读侧归一 + 默认值。
// 键与默认值：
//   app.annotateMode          "highlight" | "extract"      默认 "highlight"（R38 模式段控持久记忆）
//   app.annotatePalette       string[]（色板 id 或 #hex，有序去重、上限 8）默认 6 支标准色
//   app.annotateCustomEnabled bool                          默认 true（调色排末位「自定义取色」）
//   app.annotationFilter      "all" | "extract" | "highlight" 默认 "all"（R39 栏顶筛选记忆）
// 主进程在 settings:set 写侧已归一（electron/db.js）；这里是渲染层读侧的第二道，
// 与 --annot-* Token 同名——脏值一律回落默认，绝不把非法值传到组件里。
import { useEffect, useState } from "react";
import { settingsStore } from "./settings";
import { eventBus } from "./eventbus";
import { ANNOT_COLORS } from "../components/SelectionMenu";

export type AnnotateMode = "highlight" | "extract";
export type AnnotationFilter = "all" | "extract" | "highlight";

export const DEFAULT_ANNOTATE_MODE: AnnotateMode = "highlight";
export const DEFAULT_ANNOTATION_FILTER: AnnotationFilter = "all";
export const DEFAULT_ANNOTATE_PALETTE: string[] = ["yellow", "red", "green", "blue", "purple", "magenta"];
export const ANNOT_PALETTE_MAX = 8;
const COLOR_IDS: readonly string[] = ANNOT_COLORS;

export function normalizeAnnotateMode(v: unknown): AnnotateMode {
  return v === "extract" || v === "highlight" ? v : DEFAULT_ANNOTATE_MODE;
}

export function normalizeAnnotationFilter(v: unknown): AnnotationFilter {
  return v === "extract" || v === "highlight" ? v : DEFAULT_ANNOTATION_FILTER;
}

export function isAnnotColor(v: unknown): boolean {
  return typeof v === "string" && (COLOR_IDS.includes(v) || /^#[0-9a-fA-F]{3,8}$/.test(v));
}

export function normalizeAnnotatePalette(v: unknown): string[] {
  const list = Array.isArray(v) ? v.filter(isAnnotColor) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of list as string[]) {
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
    if (out.length >= ANNOT_PALETTE_MAX) break;
  }
  return out.length ? out : [...DEFAULT_ANNOTATE_PALETTE];
}

export interface AnnotationSettings {
  annotateMode: AnnotateMode;
  annotatePalette: string[];
  annotateCustomEnabled: boolean;
  annotationFilter: AnnotationFilter;
}

/** 一次读齐四键（都是读侧归一后的值） */
export async function readAnnotationSettings(): Promise<AnnotationSettings> {
  const [mode, palette, custom, filter] = await Promise.all([
    settingsStore.get<unknown>("app", "annotateMode", DEFAULT_ANNOTATE_MODE),
    settingsStore.get<unknown>("app", "annotatePalette", DEFAULT_ANNOTATE_PALETTE),
    settingsStore.get<unknown>("app", "annotateCustomEnabled", true),
    settingsStore.get<unknown>("app", "annotationFilter", DEFAULT_ANNOTATION_FILTER)
  ]);
  return {
    annotateMode: normalizeAnnotateMode(mode),
    annotatePalette: normalizeAnnotatePalette(palette),
    annotateCustomEnabled: custom !== false,
    annotationFilter: normalizeAnnotationFilter(filter)
  };
}

/**
 * 写单键（主进程写侧还会再归一一次）。
 * 注意：这里**不写 `settingsStore.set("app", 变量名, v)`**——f18 的消费者扫描器会把
 * 传入的标识符按「常量名→字面量」反查（`constToKey`），而 `key` 这个名字在别处被绑到
 * 了 JSX 的 `key="doc"`，于是凭空多出一个 `app.doc` 键、把 Y1/Y2 判成孤儿+漏测（实测踩过）。
 * 改成逐键显式字面量后，扫描器一路无歧义。
 */
export async function writeAnnotationSetting<K extends keyof AnnotationSettings>(
  settingKey: K,
  value: AnnotationSettings[K]
): Promise<void> {
  switch (settingKey) {
    case "annotateMode":
      await settingsStore.set("app", "annotateMode", value);
      return;
    case "annotatePalette":
      await settingsStore.set("app", "annotatePalette", value);
      return;
    case "annotateCustomEnabled":
      await settingsStore.set("app", "annotateCustomEnabled", value);
      return;
    case "annotationFilter":
      await settingsStore.set("app", "annotationFilter", value);
      return;
  }
}

/**
 * 四键的渲染层订阅（阅读器/摘录页共用）：
 * 初值＝默认值，挂载后读一次，**设置页改动即时生效**（监听 settings/changed 里这四个键）。
 */
export function annotateSettingsEqual(a: AnnotationSettings, b: AnnotationSettings): boolean {
  return (
    a.annotateMode === b.annotateMode &&
    a.annotateCustomEnabled === b.annotateCustomEnabled &&
    a.annotationFilter === b.annotationFilter &&
    a.annotatePalette.length === b.annotatePalette.length &&
    a.annotatePalette.every((c, i) => c === b.annotatePalette[i])
  );
}

const ANNOT_KEYS = ["annotateMode", "annotatePalette", "annotateCustomEnabled", "annotationFilter"] as const;

/** 订阅四键（组件内直接用；默认值与读侧归一保证首帧就有合法值） */
export function useAnnotationSettings(): AnnotationSettings {
  const [state, setState] = useState<AnnotationSettings>({
    annotateMode: DEFAULT_ANNOTATE_MODE,
    annotatePalette: [...DEFAULT_ANNOTATE_PALETTE],
    annotateCustomEnabled: true,
    annotationFilter: DEFAULT_ANNOTATION_FILTER
  });
  useEffect(() => {
    let alive = true;
    const load = () => {
      void readAnnotationSettings().then((next) => {
        if (alive) setState((prev) => (annotateSettingsEqual(prev, next) ? prev : next));
      });
    };
    load();
    const off = eventBus.on("settings/changed", (p) => {
      const payload = p as { scope?: string; key?: string } | undefined;
      if (payload?.scope === "app" && ANNOT_KEYS.includes(payload.key as (typeof ANNOT_KEYS)[number])) load();
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}
