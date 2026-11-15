# 参数面板和高级设置

选中节点底栏右侧那颗参数摘要（如「1:1」「5s」），点开是这个模型的全部可调参数。

## Sub-features

- 图片节点（即梦图片 5.0）：比例、清晰度。
- 视频节点（即梦 Seedance 快速）：比例、清晰度、时长（滑杆）。
- 只有一个参数的模型直接出那一组（`data-parameter-solo`）；没有可调参数的模型没有这颗摘要。
- 「高级」：面板里没有单独的高级折叠，所有参数一次摊开；「高级与连接设置」在模型设置页首页（见 model-settings.md）。

## How to get to it (user POV)

画布上选中一个节点 → 点底栏的参数摘要。

## Driving it with ui.mjs

```bash
node tests/ux/ui.mjs goto params                 # 图片节点
node tests/ux/ui.mjs goto params video           # 视频节点（多一个时长）
node tests/ux/ui.mjs read "document.querySelector('[data-parameter-summary]')?.getAttribute('data-parameter-summary')"
node tests/ux/ui.mjs shot params-open
```

改了参数，从摘要上读回来（上面那条 `read`），别只看面板里按下了哪颗。

## Gotchas

- 面板开着时再点模型芯片，面板会先收起；要看模型菜单就单独 `goto model-menu`。
- 摘要的文字随模型和参数变（例：视频节点是「5s」），按 `data-parameter-summary` 读，别按文案找。
