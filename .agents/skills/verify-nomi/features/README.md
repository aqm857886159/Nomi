# Nomi 功能地图

每个功能一份文件，固定四节：子功能、从用户角度怎么走到、用 `ui.mjs` 怎么驱动、坑。`goto` 名字以 `node tests/ux/ui.mjs features` 为准，名字和到达步骤住在 `tests/ux/verifyFeatures.mjs`；`check:walkthroughs` 核对这里写的每个 `goto` 名字都在、每份文件四节齐全、都列在下面。

| 功能 | 文件 | goto 名字 |
|---|---|---|
| 项目库 | [library.md](./library.md) | `library` |
| 创作页分镜（镜头行 + 参考卡） | [storyboard.md](./storyboard.md) | `storyboard` |
| 生成画布（加节点、选中节点的底栏） | [canvas.md](./canvas.md) | `canvas` · `canvas-node` |
| 参数面板和高级设置 | [params.md](./params.md) | `params` |
| 模型菜单和方式菜单 | [model-and-mode-menus.md](./model-and-mode-menus.md) | `model-menu` · `mode-menu` |
| 模型设置页 | [model-settings.md](./model-settings.md) | `model-settings` |
| Agent 面板（展开 / 收起 / 窄窗小球） | [agent-panel.md](./agent-panel.md) | `agent-panel` · `agent-ball` |
| 设计实验室 | [design-lab.md](./design-lab.md) | `design-lab` |

加一个功能：`verifyFeatures.mjs` 加一项（只调 `_shell.mjs` 等出口，缺出口补进 `_shell.mjs`）→ 这里加一份四节文件并登进上表 → 真跑一遍文件里写的每条命令再提交。
