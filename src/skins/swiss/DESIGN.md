# 默认皮肤（瑞士风）· DESIGN.md

本皮肤 `id: "none"`，是应用基线本体。**设计语言正本 = `docs/swiss-international-style.md`**（作用域声明：仅约束本皮肤）。

要点（详见正本）：直角、零阴影（浮层单层 `--shadow-float` 除外）、单一焦点色、8px 网格、Hairline 分割、D120 hover 纪律（只变底色不位移不抬升）、`--spring` 冻结白名单、浮层 150/100ms、`pop-in`/`settle`/涟漪白名单（D88 §5.4）。**配色（v49.90 / D257）**：浅色保持原基线（焦点色 #166a59）；**深色改用品牌临时设计系统「夜读」**——bg #0D1311 / surface #141C19 / surface-2 #1A2420 / text #E4DFCF / muted rgba(228,223,207,.62) / border rgba(207,201,182,.13) / ink #CFC9B6 / on-ink #0D1311（焦点色 #CFC9B6）。

本皮肤不注册任何 CSS（SkinHost 对 `none` 不注入样式、不加 body 类）；它的外观全部来自 `theme.css`（base 层）。
