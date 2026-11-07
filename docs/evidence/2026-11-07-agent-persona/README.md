# Agent 形象落地：走查证据（2026-11-07）

除最后两张外，所有图都来自打包构建上跑的 `tests/ux/shell-redesign.walk.mjs`。构建和 `feat/agent-persona` 的 2e05c9f14 内容一致：构建印章核过，源码一变走查就拒跑。窗口 1280 宽，mac 上 2 倍像素。

## crops/：小球裁图，44 张

命名规则：`persona-<状态>-<zh|en>-<light|dark>-1280.png`。每种状态都有 zh/en × 光/暗 四张。

- 状态有 11 种：idle、running、confirm、done、failed、unread、running-unread、follow、hover、focus、reduced-running。
- follow：眼睛跟着鼠标走。
- reduced-running：系统开了「减弱动效」时的运行态。弧线是静止的，形变直接切换，没有过渡。
- 由 `tests/ux/_agentPersonaWalk.mjs` 第 ①–④ 段拍下。

## sheets/：和样张逐行对照

- 命名规则：`sheet-<zh|en>-<light|dark>-<0|1|2>.png`。
- 每行左边是实拍裁图，按最近邻放大 4 倍；右边是 10-27 拍板样张 `AgentPersona` 的对应行。
- 对照关系：idle→row-00、running→row-01、confirm→row-02、done→row-03、failed→row-04、unread→row-05、follow→row-08、hover→row-09、reduced-running→row-01。
- running-unread 和 focus 在样张里没有单独的行，右边留白。
- `focus-zoom.png`：键盘聚焦时只有身体上一道焦点环，透明点击框上没有第二道。

## identity-row/：聊天里的身份行

- `identity-live.png`：组件单独渲染（没装界面文案，字标显示成 `brand.wordStart` 这类键名，不是界面上的样子）。`NomiIdentityRow` 现在没有挂载点，用户看不到这一行，所以没有真界面截图；只证头像几何与静止，字标以单测为准。
- `row-light.png`、`row-dark.png`：光暗两种模式。
- `big-light.png`、`big-dark.png`：放大看头像。

## chrome/：外壳里的小球

- `chrome-ball-running/failed/pending/unread-zh-light-1280.png`：外壳里的四种状态。pending 时是「等你确认 N」胶囊，这是原有行为，没改。
- `check-float-compact-zh-light-1280.png`：窄浮窗。
- `form-switch-ball-pending-zh-light.png`、`form-switch-ball-after-reply-zh-light.png`：「停靠 → 小球 → 浮窗 → 停靠」切了一圈以后，小球在待确认和已回复两种状态下的样子。来自 `tests/ux/agent-form-switch-state.walk.mjs`，同一个构建，窗口 1440 宽。

## perf-agent-ball-eye-follow.json：眼睛跟随性能

- 命令：`pnpm run perf:scenarios -- --measure-only --id agent-ball-eye-follow --out …`。Mac M5 上 1 次预热加 5 次，只量、不写基线。
- 量的时候：画布 192 个节点，Agent 在流式输出，面板收成小球，鼠标在小球 160px 以内扫 120 步。
- 帧间隔 p95：中位数 10.9ms，p95 10.9ms，预算 33ms。长任务 0。
- 结构硬断言 5 个样本全过：跟着看的那一段小球重渲染 0 次；回合跑完、落回空闲后 2 秒里，整页动画帧请求 0 次；小球上除眨眼外动画 0 条。有一条不是 0，量具就会非 0 退出。
- 场景还是待测：按 `docs/engineering/perf-scenarios.md`，基线只能由协调会话或验收线写。
