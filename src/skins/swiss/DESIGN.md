# 默认皮肤（瑞士风）· DESIGN.md

本皮肤 `id: "none"`，是应用基线本体。**设计语言正本 = `docs/swiss-international-style.md`**（作用域声明：仅约束本皮肤）。

要点（详见正本）：直角、零阴影（浮层单层 `--shadow-float` 除外）、单一焦点色（默认深绿 #166a59 / 深色 #3fa08a，用户可自定义）、8px 网格、Hairline 分割、D120 hover 纪律（只变底色不位移不抬升）、`--spring` 冻结白名单、浮层 150/100ms、`pop-in`/`settle`/涟漪白名单（D88 §5.4）。

本皮肤不注册任何 CSS（SkinHost 对 `none` 不注入样式、不加 body 类）；它的外观全部来自 `theme.css`（base 层）。
