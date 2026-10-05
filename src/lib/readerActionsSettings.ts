// 阅读器选区动作组呈现设置（D95 §K.4）——app.readerActionsFloat 的读侧归一 + 订阅 hook。
//   app.readerActionsFloat   bool   默认 false（false＝固定在阅读器顶栏（现状），true＝选中文字时动作组
//                                   以**选区锚定弹层**呈现，与 SelectionMenu/AnnotationEditor/悬浮工具条
//                                   同一族 placePopover 定位逻辑）
// 写侧归一在 electron/main.js settings:set（仅严格 true 为真）；这里是渲染层读侧的第二道。
import { useEffect, useState } from "react";
import { settingsStore } from "./settings";
import { eventBus } from "./eventbus";

export const DEFAULT_READER_ACTIONS_FLOAT = false;

/** 仅严格 true 为真（与 extractCardSettings 同一套布尔归一口径） */
export function normalizeReaderActionsFloat(v: unknown): boolean {
  return v === true;
}

/** 阅读器选区动作组呈现订阅（设置页改动即时生效） */
export function useReaderActionsFloat(): boolean {
  const [float, setFloat] = useState(DEFAULT_READER_ACTIONS_FLOAT);
  useEffect(() => {
    let alive = true;
    const load = () => {
      void settingsStore
        .get<unknown>("app", "readerActionsFloat", DEFAULT_READER_ACTIONS_FLOAT)
        .then((v) => {
          if (alive) setFloat(normalizeReaderActionsFloat(v));
        });
    };
    load();
    const off = eventBus.on("settings/changed", (p) => {
      const payload = p as { scope?: string; key?: string } | undefined;
      if (payload?.scope === "app" && payload.key === "readerActionsFloat") load();
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return float;
}
