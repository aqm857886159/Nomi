# 模型菜单和方式菜单

选中节点底栏最左的两颗下拉：模型芯片（选哪个模型）和方式（视频节点：文生 / 图生 / 首尾帧 / 全能参考）。

## Sub-features

- 模型菜单：按供应商列出可用模型，每行带能力和清晰度上限；底部「隐藏模型」。
- 方式菜单（视频节点）：生成方式四项；缺参考图的项是灰的并写明要几张图。
- 分镜行上也有同一套模型 / 方式下拉（见 storyboard.md）。

## How to get to it (user POV)

画布上选中节点 → 点底栏模型名；视频节点再点旁边的「文生视频」那颗。

## Driving it with ui.mjs

```bash
node tests/ux/ui.mjs goto model-menu             # 图片节点的模型菜单（listbox）
node tests/ux/ui.mjs goto model-menu video
node tests/ux/ui.mjs goto mode-menu              # 视频节点的方式菜单
node tests/ux/ui.mjs press Escape
node tests/ux/ui.mjs click 'aria:模型'            # 菜单关着时手点模型芯片（英文界面是 aria:Model）
```

## Gotchas

- 隔离实例没接任何供应商钥匙，菜单里仍有内置目录的模型（即梦 / Seedance 等）；选得了、生成不了。
- 菜单是 Mantine 的 listbox，关着时它也挂在 DOM 里（高度 0）——判「开了」看可见，别看存在。
- 1280×800 下图片节点的底栏会被时间轴条盖住（见 canvas.md），`goto` 会先缩小画布；手点之前先确认没被盖住。
- 方式菜单的出口是 `tests/ux/_modeMenu.mjs`（唯一出口），别另写选择器。
