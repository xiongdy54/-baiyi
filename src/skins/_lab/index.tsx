// 引擎实验台模块（仅 DEV，v49.0 / D170 P6）——把引擎全部扩展点跑一遍：
// ① Background：canvas 缓慢漂移柔光色斑（transform/opacity only；document.hidden / motion≠full 时停 rAF）
// ② Overlay：订阅 ui/session-complete 播 1.2s 彩带（canvas，结束清空）
// ③ activate：订阅 ui/review-grade 用 WAAPI + springEasing 让复习卡轻弹；signal 随停用 abort
// ④ lab.css：@property --skin-lab-hue 色相循环（仅 motion-full）+ 顶栏受控玻璃（backdrop-filter ×1）
import { useEffect, useRef } from "react";
import css from "./lab.css?inline";
import { UI_EVENTS } from "../runtime/uiEvents";
import { springEasing } from "../runtime/spring";
import type { SkinModule, SkinLayerProps } from "../types";

/** 背景层：漂移柔光色斑（A7：只动 transform/opacity/canvas；DPR ≤1.5；隐藏/非 full 停 rAF） */
function LabBackground({ motion }: SkinLayerProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || motion !== "full") return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      cv.width = Math.floor(window.innerWidth * dpr);
      cv.height = Math.floor(window.innerHeight * dpr);
    };
    resize();
    window.addEventListener("resize", resize);
    const blobs = Array.from({ length: 5 }, (_, i) => ({
      x: Math.random(), y: Math.random(),
      r: 0.18 + Math.random() * 0.12,
      vx: (Math.random() - 0.5) * 0.00004,
      vy: (Math.random() - 0.5) * 0.00004,
      hue: 150 + i * 14,
    }));
    let raf = 0;
    let running = true;
    const tick = (t: number) => {
      if (!running) return;
      const w = cv.width, h = cv.height;
      ctx.clearRect(0, 0, w, h);
      const dark = document.body.classList.contains("theme-dark");
      for (const b of blobs) {
        b.x += b.vx * 16; b.y += b.vy * 16;
        if (b.x < -0.2 || b.x > 1.2) b.vx *= -1;
        if (b.y < -0.2 || b.y > 1.2) b.vy *= -1;
        const g = ctx.createRadialGradient(b.x * w, b.y * h, 0, b.x * w, b.y * h, b.r * Math.max(w, h));
        g.addColorStop(0, `hsla(${b.hue}, 40%, ${dark ? 30 : 62}%, ${dark ? 0.14 : 0.10})`);
        g.addColorStop(1, "hsla(0, 0%, 0%, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onVis = () => {
      running = !document.hidden;
      if (running) raf = requestAnimationFrame(tick);
      else cancelAnimationFrame(raf);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [motion]);
  return <canvas ref={ref} style={{ position: "absolute", inset: 0 }} />;
}

/** 前景层：session-complete 彩带（1.2s，结束清空；不挡点击由宿主 .skin-overlay 保证） */
function LabOverlay({ motion }: SkinLayerProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || motion !== "full") return;
    const ctx2d = cv.getContext("2d");
    if (!ctx2d) return;
    let raf = 0;
    const fire = () => {
      cv.width = window.innerWidth;
      cv.height = window.innerHeight;
      const parts = Array.from({ length: 60 }, () => ({
        x: cv.width / 2, y: cv.height / 2,
        vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 12 - 4,
        c: `hsl(${Math.random() * 360}, 60%, 55%)`, s: 3 + Math.random() * 4,
      }));
      const t0 = performance.now();
      const tick = (t: number) => {
        const el = t - t0;
        ctx2d.clearRect(0, 0, cv.width, cv.height);
        if (el > 1200) return;
        for (const p of parts) {
          p.x += p.vx; p.y += p.vy; p.vy += 0.35;
          ctx2d.globalAlpha = Math.max(0, 1 - el / 1200);
          ctx2d.fillStyle = p.c;
          ctx2d.fillRect(p.x, p.y, p.s, p.s);
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("lab-fire", fire as EventListener);
    return () => {
      window.removeEventListener("lab-fire", fire as EventListener);
      cancelAnimationFrame(raf);
    };
  }, [motion]);
  return <canvas ref={ref} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />;
}

const mod: SkinModule = {
  css,
  Background: LabBackground,
  Overlay: LabOverlay,
  activate: (ctx) => {
    // WAAPI + springEasing：评分后复习卡轻弹（BOUNCY 预设）
    const offGrade = ctx.onUiEvent(UI_EVENTS.reviewGrade, () => {
      if (ctx.getMotion() !== "full") return;
      const el = document.querySelector('[data-ui="review-card"]');
      if (!(el instanceof HTMLElement)) return;
      const { easing, duration } = springEasing(600, 30);
      el.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.02)", offset: 0.3 }, { transform: "scale(1)" }],
        { duration, easing }
      );
    });
    // 彩带触发桥（Overlay 渲染层监听 window 自定义事件）
    const offSession = ctx.onUiEvent(UI_EVENTS.sessionComplete, () => {
      if (ctx.getMotion() !== "full") return;
      window.dispatchEvent(new CustomEvent("lab-fire"));
    });
    return () => {
      offGrade();
      offSession();
    };
  },
};
export default mod;
