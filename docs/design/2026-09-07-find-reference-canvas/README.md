# 找参考 · 设计画布源文件

已发布画布：<https://claude.ai/code/artifact/309a8fc2-4599-4f63-8e5b-379e97768ccf>
设计文档：[`../2026-09-07-find-reference-design.md`](../2026-09-07-find-reference-design.md)

这里是画布的**源**（每个 `.dc.html` 是一块画板，`canvas.json` 是布局）。
改画布从这些文件重新生成，**不要手改已发布的那个 2.4MB 单页**（它是编辑器 + 内容打包在一起的产物，不进 git）。

| 画板 | 内容 |
|---|---|
| `EmptyEntry.dc.html` | 空态入口（卡点① 的修法：空态主 CTA + 就地内嵌输入框） |
| `Main.dc.html` | 搜索结果，**平台 chip 可点**——切一下能看见角标语义/转译回显/筛选维度同时变 |
| `PlatformEvidence.dc.html` | 三平台证据格对照（数据面不对等的实调证据） |
| `FailStates.dc.html` | 转译回显 + 空结果三段式 |

颜色/圆角/阴影/字号全部取自 `src/theme/nomi-tokens.css`；图标是内联 Tabler SVG（不用 emoji）。
