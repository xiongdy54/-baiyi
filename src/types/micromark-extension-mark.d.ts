// micromark-extension-mark 无自带类型（v1.0.2 仅 JS）——按其 README 导出面声明（D97 标注）。
// pandocMark＝micromark 语法扩展（进 unified data().micromarkExtensions）。
declare module "micromark-extension-mark" {
  /** 返回 never＝可赋给任何扩展数组元素位（真实值为 micromark 语法扩展闭包，无公共类型） */
  export function pandocMark(): never;
}
