// 阅读引擎 React 壳（v20）：只消费 service.createKernel 的 ReaderKernel 接口，
// 不 import 任何具体引擎（foliate-js 在 src/lib/reader/foliate/ 后面）。
// 模式/外观设置由父层持有内核引用（onReady）后自行应用——本组件只负责生命周期与事件转发。
import { useEffect, useRef } from "react";
import {
  createKernel,
  type BookSource,
  type ContentPointerUpInfo,
  type LinkInfo,
  type ReaderImageRef,
  type ReaderKernel,
  type ReaderLocation,
  type RelocateInfo
} from "../../lib/reader/service";

interface Props {
  source: BookSource;
  /** 阅读引擎（v28 PDF 原生阅读）：默认 foliate；PDF 书传 "pdf" */
  engine?: "foliate" | "pdf";
  /** 打开时恢复的位置（上次阅读进度；跳转访问时不传） */
  initLocation?: ReaderLocation | null;
  /** 跳转原文（复习卡/卡片浏览）：cfi → pageIndex（PDF）→ chapterIndex → anchorText 文本搜索 */
  jump?: { cfi?: string; pageIndex?: number; chapterIndex?: number; anchorText: string } | null;
  onRelocate: (info: RelocateInfo) => void;
  onLink: (info: LinkInfo) => void;
  onContentPointerUp: (pos: ContentPointerUpInfo) => void;
  /** 正文图片点击（v25 图片点选聚焦） */
  onImageClick: (image: ReaderImageRef) => void;
  /** 内核就绪（open 完成）：父层在此保存引用并应用初始模式/外观 */
  onReady: (kernel: ReaderKernel) => void;
  /**
   * 打开失败（文件损坏 / 格式不支持 / 资源缺失）。
   * 此前整段异步体没有 try/catch：createKernel 或 k.open 一 reject 就是
   * 未处理的 Promise 异常 —— 界面只剩一个空白宿主 div，用户无从分辨
   * 「这本书坏了」还是「软件挂了」，也没有任何重试入口。
   */
  onError?: (message: string) => void;
}

export default function ReaderEngine({
  source,
  engine = "foliate",
  initLocation,
  jump,
  onRelocate,
  onLink,
  onContentPointerUp,
  onImageClick,
  onReady,
  onError
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  // 回调经 ref 转发，避免父层每轮渲染的新函数触发内核重建
  const handlers = useRef({ onRelocate, onLink, onContentPointerUp, onImageClick, onReady, onError, jump, initLocation });
  handlers.current = { onRelocate, onLink, onContentPointerUp, onImageClick, onReady, onError, jump, initLocation };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let kernel: ReaderKernel | null = null;
    let disposed = false;
    (async () => {
      try {
        const k = await createKernel(host, engine);
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
          // 跳转顺序（v35）：cfi → pageIndex（PDF）→ chapterIndex → anchorText 文本搜索（判空守卫）
          const okCfi = j.cfi ? await k.goTo({ cfi: j.cfi }) : false;
          const okPage = !okCfi && j.pageIndex != null ? await k.goTo({ pageIndex: j.pageIndex }) : false;
          const okChapter = !okCfi && !okPage && j.chapterIndex != null ? await k.goTo({ chapterIndex: j.chapterIndex }) : false;
          const query = (j.anchorText || "").trim().slice(0, 30);
          if (!okCfi && !okPage && !okChapter && query) {
            try {
              await k.goTo({ search: query });
            } catch { /* 搜索失败即停留当前（已着陆）位置，不回退 */ }
          }
        }
        handlers.current.onReady(k);
      } catch (err) {
        if (disposed) return;
        // open 半途失败时内核可能已经建了 iframe，必须先拆掉再报状态，
        // 否则残留的宿主会和新宿主叠在一起
        try {
          kernel?.destroy();
        } catch { /* 拆不动就忽略，报错优先 */ }
        kernel = null;
        handlers.current.onError?.(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      disposed = true;
      kernel?.destroy();
    };
    // 仅挂载/换书/换引擎时重建内核；回调变化经 handlers.ref 转发，不触发重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, engine]);

  return <div ref={hostRef} className="reader-engine-host" />;
}
