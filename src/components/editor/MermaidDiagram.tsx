// D223：Mermaid 图表块（读态）入口——真正渲染器在 MermaidDiagramImpl，按需懒加载。
// D224：pele 只有页面里真的出现 mermaid 围栏时才进入 bundle（首屏不再背 33 种图型解析器）。
// 语法错误/加载失败由实现文件的回落分支处理；加载中只占一行轻提示。
import { lazy, Suspense } from "react";
import { useT } from "../../lib/i18n";

const MermaidDiagramImpl = lazy(() => import("./MermaidDiagramImpl"));

export default function MermaidDiagram({ code }: { code: string }) {
  const T = useT();
  return (
    <Suspense
      fallback={
        <div className="mermaid-loading" role="status">
          {T("正在绘制图表…")}
        </div>
      }
    >
      <MermaidDiagramImpl code={code} />
    </Suspense>
  );
}
