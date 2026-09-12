// 阅读引擎 React 壳（v20）：只消费 service.createKernel 的 ReaderKernel 接口，
// 不 import 任何具体引擎（foliate-js 在 src/lib/reader/foliate/ 后面）。
// 模式/外观设置由父层持有内核引用（onReady）后自行应用——本组件只负责生命周期与事件转发。
import { useEffect, useRef } from "react";
import {
  createKernel,
  type BookSource,
  type LinkInfo,
  type ReaderImageRef,
  type ReaderKernel,
  type ReaderLocation,
  type RelocateInfo
} from "../../lib/reader/service";

interface Props {
  source: BookSource;
  /** 打开时恢复的位置（上次阅读进度；跳转访问时不传） */
  initLocation?: ReaderLocation | null;
  /** 跳转原文（复习卡/卡片浏览）：优先 cfi，失败按 anchorText 文本搜索定位 */
  jump?: { cfi?: string; anchorText: string } | null;
  onRelocate: (info: RelocateInfo) => void;
  onLink: (info: LinkInfo) => void;
  onContentPointerUp: (pos: { x: number; y: number }) => void;
  /** 正文图片点击（v25 图片点选聚焦） */
  onImageClick: (image: ReaderImageRef) => void;
  /** 内核就绪（open 完成）：父层在此保存引用并应用初始模式/外观 */
  onReady: (kernel: ReaderKernel) => void;
}

export default function ReaderEngine({
  source,
  initLocation,
  jump,
  onRelocate,
  onLink,
  onContentPointerUp,
  onImageClick,
  onReady
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  // 回调经 ref 转发，避免父层每轮渲染的新函数触发内核重建
  const handlers = useRef({ onRelocate, onLink, onContentPointerUp, onImageClick, onReady, jump, initLocation });
  handlers.current = { onRelocate, onLink, onContentPointerUp, onImageClick, onReady, jump, initLocation };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let kernel: ReaderKernel | null = null;
    let disposed = false;
    (async () => {
      const k = await createKernel(host);
      if (disposed) {
        k.destroy();
        return;
      }
      kernel = k;
      k.on("relocate", (i) => handlers.current.onRelocate(i));
      k.on("link", (i) => handlers.current.onLink(i));
      k.on("contentPointerUp", (p) => handlers.current.onContentPointerUp(p));
      k.on("imageClick", (i) => handlers.current.onImageClick(i));
      const j = handlers.current.jump;
      await k.open(source, { location: j ? undefined : (handlers.current.initLocation ?? undefined) });
      if (disposed) return;
      if (j) {
        const ok = j.cfi ? await k.goTo({ cfi: j.cfi }) : false;
        if (!ok) await k.goTo({ search: j.anchorText.slice(0, 30) });
      }
      handlers.current.onReady(k);
    })();
    return () => {
      disposed = true;
      kernel?.destroy();
    };
    // 仅挂载/换书时重建内核；回调变化经 handlers.ref 转发，不触发重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  return <div ref={hostRef} className="reader-engine-host" />;
}
