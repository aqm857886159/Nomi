# 参数面板和高级设置

选中节点底栏「模型｜方式｜参数｜高级设置」里的参数那一格（摘要如「1:1」「16:9 · 5s」），点开是这个模型常用参数一次摊开；不常改的在旁边「高级设置」。画布节点和分镜行是同一只底栏。

## Sub-features

- 图片节点（即梦图片 5.0）：比例、清晰度。
- 视频节点（即梦 Seedance 快速）：比例、清晰度、时长（滑杆）。
- 只有一个参数的模型直接出那一组（`data-parameter-solo`）；没有可调参数的模型没有这颗摘要。
- 「高级设置」：底栏单独一格（`[data-advanced-settings-toggle]`），只在模型有种子、水印、输出格式、提交前审核、返回尾帧这类参数时才出现；内置的即梦模型没有这一格。展开后每项是 `[data-advanced-setting=<键>]`，改过的会带 `data-advanced-settings-changed`。
- 生成方式不在参数面板里，是底栏单独一格（见 model-and-mode-menus.md）。
- 「高级与连接设置」（接供应商那种）在模型设置页首页，和这里不是一回事（见 model-settings.md）。

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
- 摘要的文字随模型和参数变（例：视频节点是「16:9 · 5s」），按 `data-parameter-summary` 读，别按文案找。
- `goto` 里没有「高级设置」：隔离实例的内置模型都没有这一格；要验它得先接一个带种子等参数的模型，按 `[data-advanced-settings-toggle]` 点。
