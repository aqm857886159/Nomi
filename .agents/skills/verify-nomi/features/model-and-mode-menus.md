# 模型菜单和方式菜单

选中节点底栏「模型｜方式｜参数｜高级设置」的前两格：模型芯片（选哪个模型）和生成方式（视频：文生 / 图生 / 首尾帧 / 参考；图片：文生图 / 改图）。画布节点和分镜行是同一只底栏。

## Sub-features

- 模型菜单：按类别（图片模型 / 视频模型）列出可用模型，每行带能力和清晰度上限；有模型时底部有「隐藏模型」，空状态没有这一行。
- 方式菜单：视频四项，缺参考的项是灰的、写明还缺几张；图片两项（文生图 / 改图）。方式是单独一格，视频的这一格只有图标、图片的带字。
- 分镜行上是同一只底栏（见 storyboard.md）。

## How to get to it (user POV)

画布上选中节点 → 点底栏模型名；再点紧挨着的方式那一格（视频只有图标）。

## Driving it with ui.mjs

```bash
node tests/ux/ui.mjs goto model-menu             # 图片节点的模型菜单（listbox）
node tests/ux/ui.mjs goto model-menu video
node tests/ux/ui.mjs goto mode-menu              # 视频节点的方式菜单
node tests/ux/ui.mjs press Escape
node tests/ux/ui.mjs click 'aria:模型'            # 菜单关着时手点模型芯片（英文 aria:Model）
node tests/ux/ui.mjs click 'aria:生成方式'        # 手点方式那一格（英文 aria:Mode）
```

## Gotchas

- 隔离实例没接任何供应商钥匙，菜单里仍有内置目录的模型（即梦 / Seedance 等）；选得了、生成不了。
- 菜单是 Mantine 的 listbox，关着时它也挂在 DOM 里（高度 0）——判「开了」看可见，别看存在。
- 1280×800 下图片节点的底栏会被时间轴条盖住（见 canvas.md），`goto` 会先缩小画布；手点之前先确认没被盖住。
- 方式菜单的出口是 `tests/ux/_modeMenu.mjs`（唯一出口），别另写选择器。
- 菜单项按 `role:option=<名字>` 点；`text:` 是模糊匹配，会撞上同页藏着的模型说明（例：「改图」先命中「文生图/改图 · 最高 4K」）。
