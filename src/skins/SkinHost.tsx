// 皮肤宿主（v49.0 / D170）：App 内唯一皮肤挂载点。
// 职责：皮肤 CSS 注入/移除（@layer skin 包裹）、body 类管理（skin-<id>/has-skin/skin-chrome-transparent/skin-vt）、
// html[data-skin]、背景层与前景层渲染、activate(ctx) 生命周期（AbortController + cleanup + onFail 回落）。
// 前置条件：调用方保证 skinId 对应模块已 loadSkin 缓存（默认皮肤空模块恒在场）。
import { useLayoutEffect, useState, Component } from "react";
import type { ReactNode } from "react";
import { getCachedSkin, getSkinEntry, DEFAULT_SKIN_ID } from "./index";
import { eventBus } from "../lib/eventbus";
import type { ColorMode, MotionLevel, SkinModule } from "./types";

const MANAGED_PREFIX = "skin-";

function clearSkinClasses(body: HTMLElement) {
  [...body.classList].filter((c) => c.startsWith(MANAGED_PREFIX)).forEach((c) => body.classList.remove(c));
  body.classList.remove("has-skin");
  delete document.documentElement.dataset.skin;
}

/** 皮肤层渲染兜底（A8/A1）：皮肤层组件抛错不拖垮应用，回落默认皮肤 */
class SkinLayerBoundary extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error("[skin] 皮肤层渲染失败，回落默认皮肤", err);
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

interface Props {
  skinId: string; // 调用方保证：传进来之前已 await loadSkin(skinId)
  mode: ColorMode;
  motion: MotionLevel;
  onFail: () => void; // 皮肤异常时回落默认
}

export function SkinHost({ skinId, mode, motion, onFail }: Props) {
  const entry = getSkinEntry(skinId);
  const id = entry.manifest.id;
  const [mod, setMod] = useState<SkinModule | null>(null);

  useLayoutEffect(() => {
    const m = getCachedSkin(id);
    if (!m) {
      if (id !== DEFAULT_SKIN_ID) onFail();
      return;
    }
    const body = document.body;
    const ac = new AbortController();
    let styleEl: HTMLStyleElement | null = null;
    let cleanup: void | (() => void);

    try {
      if (m.css) {
        styleEl = document.createElement("style");
        styleEl.dataset.skinCss = id;
        styleEl.textContent = `@layer skin {\n${m.css}\n}`;
        document.head.appendChild(styleEl);
      }
      clearSkinClasses(body);
      if (id !== DEFAULT_SKIN_ID) {
        body.classList.add("has-skin", `skin-${id}`);
        if (entry.manifest.chrome === "transparent") body.classList.add("skin-chrome-transparent");
        if (entry.manifest.features?.viewTransitions) body.classList.add("skin-vt");
        document.documentElement.dataset.skin = id;
      }
      cleanup = m.activate?.({
        getMode: () => (body.classList.contains("theme-dark") ? "dark" : "light"),
        getMotion: () => (body.classList.contains("motion-full") ? "full" : body.classList.contains("motion-off") ? "off" : "reduced"),
        body,
        signal: ac.signal,
        onUiEvent: (type, handler) => {
          const off = eventBus.on(type as never, handler as (p?: unknown) => void);
          ac.signal.addEventListener("abort", off, { once: true });
          return off;
        },
      });
      setMod(m);
    } catch (err) {
      console.error(`[skin] 激活 ${id} 失败，回落默认皮肤`, err);
      onFail();
    }

    return () => {
      ac.abort();
      try {
        cleanup?.();
      } catch (err) {
        console.error("[skin] cleanup 失败", err);
      }
      styleEl?.remove();
      clearSkinClasses(body);
      setMod(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖 id/mode 即可：模块由调用方预载入缓存，onFail 稳定
  }, [id]);

  const Bg = mod?.Background;
  const Fg = mod?.Overlay;
  if (!Bg && !Fg) return null;
  return (
    <>
      {Bg && (
        <div className="skin-layer" aria-hidden="true">
          <SkinLayerBoundary onFail={onFail}>
            <Bg mode={mode} motion={motion} />
          </SkinLayerBoundary>
        </div>
      )}
      {Fg && (
        <div className="skin-overlay" aria-hidden="true">
          <SkinLayerBoundary onFail={onFail}>
            <Fg mode={mode} motion={motion} />
          </SkinLayerBoundary>
        </div>
      )}
    </>
  );
}
