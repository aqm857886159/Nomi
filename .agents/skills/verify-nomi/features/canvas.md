# 生成画布

生成工作区的画布视图：底部正中加节点条，左下缩放簇，选中节点后节点下方出生成框（提示词 + 底栏）。

## Sub-features

- 加节点条：图片 / 视频 / 声音 / 文字 / 剪辑 | 导入 / +（更多种类）。
- 左下缩放簇：适应视图 / − 百分比 + / ⋯ 视图选项。
- 选中节点 → 生成框：加参考、提示词、快捷预设，底栏 = 模型芯片 · 方式（视频）· 参数摘要 · 提示词工具 · 生成。

## How to get to it (user POV)

项目里点顶栏「生成」，顶栏「画布 ↔ 列表」切到画布；点加节点条上的「图片」新建一个节点，它会自动选中。

## Driving it with ui.mjs

```bash
node tests/ux/ui.mjs goto canvas                 # 没项目就新建一个，切到生成 · 画布
node tests/ux/ui.mjs goto canvas-node            # 选中（没有就加）一个图片节点，底栏点得到
node tests/ux/ui.mjs goto canvas-node video
node tests/ux/ui.mjs click 'aria:适应视图'
node tests/ux/ui.mjs fill 'css:[data-prompt-box] .ProseMirror' '远景，雨后天台'
node tests/ux/ui.mjs read "document.querySelector('[data-prompt-box] .ProseMirror')?.textContent"
```

## Gotchas

- 1280×800 下新建图片节点后，生成框底栏落在底部「时间轴」条下面（2026-11-15 实测：模型芯片中心点上最顶层是时间轴条），点不到也截不到。`goto canvas-node` 照人的做法逐档缩小画布直到底栏露出来；自己点底栏前先看它是不是被盖住。
- 「适应视图」会把节点放大到占满高度，生成框反而更靠下——别拿它当「让底栏露出来」。
- 点节点正中可能点到「参考图生图」这类入口；选中节点点左上角（出口就这么点）。
- 生成框只有选中的那个节点有；点画布空白处会取消选中、生成框消失。
- 不要点「生成」：隔离实例没钥匙，验证不花钱。
