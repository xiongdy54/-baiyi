// v48.63（D107，用户指令）：标签功能总开关 `app.tagsEnabled`（默认开）。
// 语义：一键隐藏**全部标签入口与展示**——手动制卡标签行、AI 制卡的批注标签继承与建议（批 F 届时同受此开关）、
// 复习页标签区与快捷打标、浏览器批量打标/去标、卡详情标签区、筛选牌组构建器的标签条件输入；
// **数据零改动**——已存 tags_json 原样保留，重新打开即全部回来；查询语法 tag: 与已存 scope 的 tags 条件照常生效。
// 主进程 settings:set 写侧（electron/main.js）与这里同规：仅严格 false 为关。
import { useEffect, useState } from "react";
import { settingsStore } from "./settings";
import { eventBus } from "./eventbus";

export function normalizeTagsEnabled(v: unknown): boolean {
  return v !== false;
}

/** 消费方钩子：null 不外泄——加载中按开（默认态）处理，避免闪烁隐藏 */
export function useTagsEnabled(): boolean {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      settingsStore.get<unknown>("app", "tagsEnabled", null).then((v) => {
        if (!cancelled) setEnabled(normalizeTagsEnabled(v));
      });
    };
    load();
    // 设置模态常开在当前视图之上（复习页不重挂载）——订阅 settings/changed 即时生效（D81 先例）
    const off = eventBus.on("settings/changed", (p) => {
      if (p && (p as { key?: string }).key === "tagsEnabled") load();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);
  return enabled;
}
