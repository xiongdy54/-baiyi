// mindmapCore.js 的类型声明（渲染层导入用；实现见同名 .js——主进程/测试/渲染层单一真源）
export interface SummaryNode {
  id: string;
  parentId: string | null;
  title: string;
  authorialRole?: string | null;
}
export interface SummaryMap {
  title?: string;
  nodes: SummaryNode[];
}
export function deriveStructureSummary(map: SummaryMap, maxChars?: number): string;
