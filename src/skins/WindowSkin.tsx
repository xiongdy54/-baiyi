// 独立窗口皮肤宿主（C-31）：lens / 制卡台 / 捕获三个独立窗口的外观挂载点——
// 复用主窗口的 SkinHost（皮肤 CSS 注入 / body 类 / html[data-skin] / 背景前景层 / activate 生命周期），
// 外观读取走唯一实现面 readAppearance（与主窗口 App.tsx 同源），落类走 applyAppearanceToDocument。
// 变更来源两条：
//   ① 主进程 settings:changed 广播（scope=theme，或 scope=app 且 key ∈ 外观四键）——窗口开着时即时跟随；
//   ② 每次呼出（win:workbenchShown / lens:window / capture:shown）宿主调 applyCaptureAppearance()，
//      该函数末尾经 requestWindowSkinRefresh() 反压本组件刷新（保留「呼出重读」既有行为）。
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { SkinHost } from "./SkinHost";
import { DEFAULT_SKIN_ID, loadSkin } from "./index";
import {
  applyAppearanceToDocument,
  isAppearanceSettingsChange,
  readAppearance,
  runAppearanceTransition,
  type Appearance
} from "./runtime/readAppearance";

/** 已挂载 WindowSkin 的刷新函数注册表（每窗口一个；applyCaptureAppearance 反压触发用） */
const refreshers = new Set<() => void>();

/** 请求本窗口已挂载的 WindowSkin 重读外观（未挂载时无操作；幂等） */
export function requestWindowSkinRefresh(): void {
  for (const fn of [...refreshers]) fn();
}

export function WindowSkin() {
  const [ap, setAp] = useState<Appearance | null>(null);
  // C-37：theme.mode = "system" 时的系统深浅色监听要调到挂载 effect 内的 refresh（epoch 守卫同源），
  // 经 ref 暴露给下方按 modeSetting 开关的 effect。
  const refreshRef = useRef<(() => void) | null>(null);
  // v49.90 / D257：首拉外观不做过渡（窗口刚挂载/呼出，避免启动闪一次淡化）；之后的设置变更、
  // 系统深浅色翻转与皮肤切换统一走 runAppearanceTransition（数据属性 + 皮肤 CSS 同步提交）。
  const appliedRef = useRef(false);
  useEffect(() => {
    let disposed = false;
    let epoch = 0; // 只认最后一次发起的读取（连续设置变更时旧响应不得回写旧外观）
    const refresh = async () => {
      const my = ++epoch;
      try {
        const next = await readAppearance();
        if (disposed || my !== epoch) return;
        if (!appliedRef.current) {
          appliedRef.current = true;
          applyAppearanceToDocument(next); // 主题 / 动效 body 类与强调色即时落，不等 React 渲染
          setAp(next);
          return;
        }
        // 主题 / 皮肤切换：flushSync 让 SkinHost 的 useLayoutEffect（皮肤 CSS / body 类）
        // 与外观类都在快照回调内同步完成，新快照即最终画面。
        runAppearanceTransition(() => {
          applyAppearanceToDocument(next);
          flushSync(() => setAp(next));
        });
      } catch {
        document.body.classList.add("theme-light"); // 与旧 applyCaptureAppearance 的兜底一致
      }
    };
    refreshRef.current = refresh;
    void refresh();
    refreshers.add(refresh);
    // 主进程设置变更广播：只过滤外观相关 scope/key（与主窗口 settings/changed 事件消费同口径）
    const offChanged = window.settingsAPI?.onChanged?.((p) => {
      if (isAppearanceSettingsChange(p)) void refresh();
    });
    // 系统级「减少动态效果」变化：跟随系统档需重解析（与主窗口 App 的 mq 监听同规）
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMq = () => void refresh();
    mq.addEventListener("change", onMq);
    return () => {
      disposed = true;
      refreshRef.current = null;
      refreshers.delete(refresh);
      offChanged?.();
      mq.removeEventListener("change", onMq);
    };
  }, []);
  // C-37：theme.mode = "system" 时本窗口跟随系统深浅色——mq change 重读外观（readAppearance 内
  // resolveThemeMode 现场解析）；切回 light/dark 显式档时随 effect 重跑移除监听（报告 C-37 步骤 2）。
  // 与主窗口 App 的同名 mq 监听同规；refresh 走读取面，主进程 settings:changed / 呼出重读不受影响。
  const modeSetting = ap?.modeSetting;
  useEffect(() => {
    if (modeSetting !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => void refreshRef.current?.();
    mq.addEventListener("change", onScheme);
    return () => mq.removeEventListener("change", onScheme);
  }, [modeSetting]);
  if (!ap) return null;
  return (
    <SkinHost
      skinId={ap.skinId}
      mode={ap.mode}
      motion={ap.motion}
      onFail={() => {
        // 皮肤激活 / 渲染异常：本窗口本地回落默认皮肤（默认皮空模块恒成功）。
        // 不写回设置——独立窗口加载失败不得改动用户保存的皮肤选择。
        void loadSkin(DEFAULT_SKIN_ID).then(() => {
          setAp((cur) => (cur ? { ...cur, skinId: DEFAULT_SKIN_ID } : cur));
        });
      }}
    />
  );
}
