// useCommandActions — 把视图组件的动作表挂进 CommandRegistry（M4）
// actions 对象每帧渲染都写入 ref：keydown 时刻经 getter 读到的是最新闭包
// （selection/showBack 等状态变化无需重新注册）；卸载时注销。
import { useEffect, useRef } from "react";
import { setActionSource, type CommandAction } from "./commands";

export function useCommandActions(owner: string, actions: Record<string, CommandAction> | null): void {
  const ref = useRef(actions);
  ref.current = actions;
  useEffect(() => {
    setActionSource(owner, () => ref.current);
    return () => setActionSource(owner, null);
  }, [owner]);
}
