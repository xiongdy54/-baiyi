# M15 材料知识导图——已回滚实现存档（2026-09-18）

生成质量不达用户预期（主干结构空洞、SVG 图示观感差、长 SVG 成功率低），经用户决定整体回滚，
回滚前的完整实现快照存于此目录，供将来重新设计时参考（亦可直接删除）。

对应回滚掉的非文件级改动（重做时可参考，但提示词/表结构应按新设计重定）：
- `electron/db.js`：material_mindmaps + material_mindmap_shards 两表与 8 个仓储函数（分片缓存键
  documentId+锚+prompt_scope，命中要求 prompt_version 一致）；diagram-generation scope 播种。
- `electron/prompts.js`：DIAGRAM_GENERATION_PROMPT（aggregate/render 双契约 + diagram-design 风格移植）。
- `electron/main.js`：mindmap:* IPC（list/get/save/delete/feedback/shardGet/shardSave/learningStatus）。
- `electron/preload.js`：mindmapAPI。
- `src/lib/reader/kernel.ts` + foliate/pdf adapter：getSectionText（[start,end) 章节区间原文抽取，
  foliate 经 book.resolveHref + sections[].createDocument()，pdf 逐页 getTextContent）——
  该能力与导图无关、全格式通用，重新设计时建议恢复。
- `src/components/Reader.tsx`：导图入口按钮、runNodeCards（节点制卡 → 既有确认管线 + 结构摘要有界注入）。
