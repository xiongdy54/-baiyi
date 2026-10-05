// 摘录卡编辑器/字号设置（D95 §E/§F + v1.4）——五新键的读侧归一 + typography 桥。
//   app.extractEditorToolbar        bool        默认 true（编辑器下方富文本工具栏开关）
//   app.extractEditorToolbarFloat   bool        默认 false（v1.4：false＝钉在文本框底端，true＝悬浮面板）
//   app.extractFaceFontFollow       bool        默认 true（字号/字体跟随阅读器外观；行高恒跟随）
//   app.extractFaceFontSize         int 10–40   默认 17（follow=false 时的卡面字号）
//   app.extractFaceFontFamily       string      默认 ""（独立字体键；留空一律回落应用无衬线栈，v1.3）
// 写侧归一在 electron/main.js settings:set（仿 annotateCustomEnabled 先例）；这里是渲染层读侧的第二道，
// 脏值一律回落默认，绝不把非法值传到组件里。
import { useEffect, useState } from "react";
import { settingsStore } from "./settings";
import { eventBus } from "./eventbus";
import { DEFAULT_READER_SETTINGS, resolveAppearance, type ReaderSettings } from "./reader/foliate/appearance";

export const DEFAULT_EXTRACT_EDITOR_TOOLBAR = true;
export const DEFAULT_EXTRACT_EDITOR_TOOLBAR_FLOAT = false;
export const DEFAULT_EXTRACT_FACE_FONT_FOLLOW = true;
export const DEFAULT_EXTRACT_FACE_FONT_SIZE = 17;
export const DEFAULT_EXTRACT_FACE_FONT_FAMILY = "";

/** 仅严格 true 为真（仿 normalizeAnnotateCustomEnabled 先例） */
export function normalizeExtractEditorToolbar(v: unknown): boolean {
  return v === true;
}

export function normalizeExtractEditorToolbarFloat(v: unknown): boolean {
  return v === true;
}

export function normalizeExtractFaceFontFollow(v: unknown): boolean {
  return v === true;
}

/** round 后落 10–40 区间，否则回落 17（与 resolveAppearance 的钳制口径一致） */
export function normalizeExtractFaceFontSize(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 10 && n <= 40 ? n : DEFAULT_EXTRACT_FACE_FONT_SIZE;
}

export function normalizeExtractFaceFontFamily(v: unknown): string {
  return typeof v === "string" ? v.trim() : DEFAULT_EXTRACT_FACE_FONT_FAMILY;
}

export interface ExtractCardSettings {
  extractEditorToolbar: boolean;
  extractEditorToolbarFloat: boolean;
  extractFaceFontFollow: boolean;
  extractFaceFontSize: number;
  extractFaceFontFamily: string;
}

/** 一次读齐五键（都是读侧归一后的值） */
export async function readExtractCardSettings(): Promise<ExtractCardSettings> {
  const [toolbar, toolbarFloat, follow, fontSize, fontFamily] = await Promise.all([
    settingsStore.get<unknown>("app", "extractEditorToolbar", DEFAULT_EXTRACT_EDITOR_TOOLBAR),
    settingsStore.get<unknown>("app", "extractEditorToolbarFloat", DEFAULT_EXTRACT_EDITOR_TOOLBAR_FLOAT),
    settingsStore.get<unknown>("app", "extractFaceFontFollow", DEFAULT_EXTRACT_FACE_FONT_FOLLOW),
    settingsStore.get<unknown>("app", "extractFaceFontSize", DEFAULT_EXTRACT_FACE_FONT_SIZE),
    settingsStore.get<unknown>("app", "extractFaceFontFamily", DEFAULT_EXTRACT_FACE_FONT_FAMILY)
  ]);
  return {
    extractEditorToolbar: normalizeExtractEditorToolbar(toolbar),
    extractEditorToolbarFloat: normalizeExtractEditorToolbarFloat(toolbarFloat),
    extractFaceFontFollow: normalizeExtractFaceFontFollow(follow),
    extractFaceFontSize: normalizeExtractFaceFontSize(fontSize),
    extractFaceFontFamily: normalizeExtractFaceFontFamily(fontFamily)
  };
}

const EXTRACT_KEYS = ["extractEditorToolbar", "extractEditorToolbarFloat", "extractFaceFontFollow", "extractFaceFontSize", "extractFaceFontFamily"] as const;

/** 工具栏开关的渲染层订阅（设置页改动即时生效） */
export function useExtractEditorToolbar(): boolean {
  const [on, setOn] = useState(DEFAULT_EXTRACT_EDITOR_TOOLBAR);
  useEffect(() => {
    let alive = true;
    const load = () => {
      void readExtractCardSettings().then((s) => {
        if (alive) setOn(s.extractEditorToolbar);
      });
    };
    load();
    const off = eventBus.on("settings/changed", (p) => {
      const payload = p as { scope?: string; key?: string } | undefined;
      if (payload?.scope === "app" && payload.key === "extractEditorToolbar") load();
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return on;
}

/** 工具栏形态订阅（v1.4：false＝钉底 dock，true＝悬浮面板） */
export function useExtractEditorToolbarFloat(): boolean {
  const [float, setFloat] = useState(DEFAULT_EXTRACT_EDITOR_TOOLBAR_FLOAT);
  useEffect(() => {
    let alive = true;
    const load = () => {
      void readExtractCardSettings().then((s) => {
        if (alive) setFloat(s.extractEditorToolbarFloat);
      });
    };
    load();
    const off = eventBus.on("settings/changed", (p) => {
      const payload = p as { scope?: string; key?: string } | undefined;
      if (payload?.scope === "app" && payload.key === "extractEditorToolbarFloat") load();
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return float;
}

/**
 * 摘录卡字号/字体/行高桥（§F.1）：订阅 app.readerSettings.appearance 与四新键（settings/changed 即时重算），
 * 经 resolveAppearance 同一套钳制后写 document.body 上的三个根级 CSS 变量（运行时注入，applyAccent 先例；
 * 变量由本模块独占写入，卸载时移除还原基线）。follow=true ⇒ 全部跟随阅读器；false ⇒ 字号/字体用独立键、
 * 行高恒跟随（§F.2，不单列）。theme.css 消费：--extract-face-fs / --extract-face-font / --extract-face-lh。
 */
export function useExtractFaceTypography(): void {
  useEffect(() => {
    let alive = true;
    const apply = () => {
      void (async () => {
        const [reader, card] = await Promise.all([
          settingsStore.get<ReaderSettings>("app", "readerSettings", DEFAULT_READER_SETTINGS),
          readExtractCardSettings()
        ]);
        if (!alive) return;
        const resolved = resolveAppearance({
          mode: { ...DEFAULT_READER_SETTINGS.mode, ...reader.mode },
          appearance: { ...DEFAULT_READER_SETTINGS.appearance, ...reader.appearance }
        });
        const fs = card.extractFaceFontFollow ? resolved.fontSize : card.extractFaceFontSize;
        // D95 v1.3（用户反馈「默认字体改为无衬线字体」）：family 只跟随**显式设置值**——
        // follow 时读阅读器 appearance 的原始 fontFamily（留空＝未显式设置），独立模式读独立键；
        // 两者留空一律回落应用无衬线栈（不再继承阅读器的衬线默认栈）。
        const customFamily = card.extractFaceFontFollow
          ? String((reader.appearance as { fontFamily?: unknown } | undefined)?.fontFamily ?? "").trim()
          : card.extractFaceFontFamily;
        const font = customFamily || "var(--font-sans)";
        const lh = resolved.lineHeight; // 行高恒跟随（§F.2）
        const style = document.body.style;
        style.setProperty("--extract-face-fs", `${fs}px`);
        style.setProperty("--extract-face-font", font);
        style.setProperty("--extract-face-lh", String(lh));
      })();
    };
    apply();
    const off = eventBus.on("settings/changed", (p) => {
      const payload = p as { scope?: string; key?: string } | undefined;
      if (payload?.scope === "app" && (payload.key === "readerSettings" || EXTRACT_KEYS.includes(payload.key as (typeof EXTRACT_KEYS)[number]))) apply();
    });
    return () => {
      alive = false;
      off();
      const style = document.body.style;
      style.removeProperty("--extract-face-fs");
      style.removeProperty("--extract-face-font");
      style.removeProperty("--extract-face-lh");
    };
  }, []);
}
