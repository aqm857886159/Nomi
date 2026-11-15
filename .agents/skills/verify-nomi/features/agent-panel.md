# Agent 面板

常驻 Nomi 助手：三种形态——停靠右栏 / 浮窗 / 收成右下小球。

## Sub-features

- 面板头部形态三选一（小球 / 浮窗 / 停靠）、历史、模型选择、Skill、批准方式、输入框。
- 首次会出「帮 Nomi 变好」匿名分享卡。
- 默认形态：生成页是小球，创作 / 分镜是停靠；窄窗（700 宽）下分镜页默认就是小球，点出来是浮窗。

## How to get to it (user POV)

项目里点右下小球展开；面板头部点「小球」那颗收起。

## Driving it with ui.mjs

```bash
node tests/ux/ui.mjs goto agent-panel            # 展开（没项目就新建一个）
node tests/ux/ui.mjs goto agent-ball             # 先展开再收成小球
node tests/ux/ui.mjs up --size 700x720           # 窄窗：再 goto agent-panel 看浮窗
node tests/ux/ui.mjs shot agent
```

## Gotchas

- 小球形态下面板仍挂在 DOM 里（hidden 容器），判「展开了」看可见；`doctor` 的 `where` 已经按可见报 `agent:panel` / `agent:ball`。
- 700×720 下浮窗会盖住画布上的生成框大半；要点画布先 `goto agent-ball`。
- 不要在输入框里发消息：会走模型。
