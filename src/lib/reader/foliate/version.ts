// 阅读引擎版本（单一来源）：数据中的 cfi/进度都带此标记，CFI 回归可精确归因到 vendor 快照。
// 升级 vendor/foliate-js 后必须更新此值并在 AI_DEVELOPMENT_GUIDE.md 的引擎版本日志中记录。
// 对应 vendor/foliate-js/MANIFEST.json commit 78914aef4466eb960965702401634c2cb348e9b1。
export const READER_ENGINE_VERSION = "foliate-78914aef";
// PDF 原生阅读引擎版本（v28）：contextRef/progress 中 readerEngineVersion=此值即页码锚点系。
// pdfjs-dist 版本升级时同步更新本值（存量页码锚点按 anchorText 降级，不强制迁移）。
export const PDF_ENGINE_VERSION = "pdfjs-6.3.289";
