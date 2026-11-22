# Agent 面板

常驻 Nomi 助手：三种形态——停靠右栏 / 浮窗 / 收成右下小球。

## Sub-features

- 面板头部形态三选一（小球 / 浮窗 / 停靠）、历史、模型选择、Skill、批准方式、输入框。
- 首次会出「帮 Nomi 变好」匿名分享卡。
- 默认形态：生成页是小球，创作 / 分镜是停靠；窄窗（700 宽）下分镜页默认就是小球，点出来是浮窗。

## How to get to it (user POV)

项目里点顶栏最右那颗 Nomi 入口展开（再点一下收起）；面板头部三选一的第一颗「收起」也能收。

## Driving it with ui.mjs

```bash
node tests/ux/ui.mjs goto agent-panel            # 展开（没项目就新建一个）
node tests/ux/ui.mjs goto agent-collapsed        # 先展开再收起（入口回到顶栏、没按下）
node tests/ux/ui.mjs up --size 700x720           # 窄窗：再 goto agent-panel 看浮窗
node tests/ux/ui.mjs shot agent
```

## Gotchas

- 收起时面板仍挂在 DOM 里（hidden 容器），判「展开了」看可见；顶栏入口一直在，判收着看 `[data-shell-nomi-entry][aria-pressed="false"]`；`doctor` 的 `where` 按可见报 `agent:panel` / `agent:collapsed`。
- 700×720 下浮窗会盖住画布上的生成框大半；要点画布先 `goto agent-collapsed`。
- 不要在输入框里发消息：会走模型。
