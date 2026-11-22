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
| Agent 面板（展开 / 收起进顶栏入口 / 窄窗浮窗） | [agent-panel.md](./agent-panel.md) | `agent-panel` · `agent-collapsed` |
| 设计实验室 | [design-lab.md](./design-lab.md) | `design-lab` |

加一个功能：`verifyFeatures.mjs` 加一项（只调 `_shell.mjs` 等出口，缺出口补进 `_shell.mjs`）→ 这里加一份四节文件并登进上表 → 真跑一遍文件里写的每条命令再提交。

需要在画布或分镜真正点生成时，先用假 APIMart 起隔离窗口（不能带真实或已有资料）：已接好的加密假 key 和本机服务随驱动创建，`--vendor-pending` 指定每个任务先回几次处理中；`up` / `doctor` 第一行标明回环端口，`down` / `quit` 一起收尾。不带参数时各地图原有的“没有钥匙”限制仍成立。目标走查 `tests/ux/ui-fake-vendor.walk.mjs` 覆盖画布图片、视频、分镜图片及退出端口；无需真实资源，按现有 `.walk.mjs` 清单自动进入夜跑。媒体是固定的小尺寸 PNG / 1 秒 MP4，不提供文本模型响应。

```bash
node tests/ux/ui.mjs up --vendor fake-apimart --vendor-pending 1
```
