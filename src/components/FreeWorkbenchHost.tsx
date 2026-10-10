// 自由制卡台宿主（v48.79 / D123）：没有「当前阅读位置」的页面（书架/复习/卡片/日记/数据）与独立制卡台窗口
// 共用同一套 useSelectionActions + SelectionPanels——手动制卡免选区、AI 解释/制卡走「粘贴文字」入口，
// 卡片不带来源锚（contextRef=null，与既有「contextRef 为 NULL 的老卡」同口径）。
// 阅读器与摘录页有自己的宿主（带选区/来源上下文），不会与本宿主同时挂载。
import { useCallback, useRef, useState } from "react";
import SelectionPanels from "./SelectionPanels";
import { useSelectionActions } from "../lib/useSelectionActions";

export default function FreeWorkbenchHost({ standalone = false }: { standalone?: boolean }) {
  const [flash, setFlash] = useState<string | null>(null);
  const sourceTextRef = useRef("");
  const occlusionSourceRef = useRef<"engine" | "library">("engine");
  const showToast = useCallback((msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 1800);
  }, []);

  const sel = useSelectionActions({
    selectionText: () => null,
    selectionSpans: () => undefined,
    contextRef: () => null,
    sourceContext: () => ({}),
    labels: {},
    ownerKey: () => "",
    sourceTextRef,
    lookupLocator: () => ({}),
    anchorText: () => null,
    rememberAnchor: () => {},
    clearSelection: () => {},
    clearAnchor: () => {},
    occlusionSourceRef,
    showToast,
    buildSourceAnchor: () => null,
    focus: { get: () => null, close: () => {}, setBusy: () => {} }
  });

  return (
    <>
      <SelectionPanels sel={sel} placementOverride={standalone ? "window" : undefined} />
      {flash && (
        <div className="wb-toast" role="status">
          {flash}
        </div>
      )}
    </>
  );
}
