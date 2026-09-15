# Agent 思考原文溢出共享消息行

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：已实现，完整 gates / 推送待验证。范围：#646 当前任务分支，零付费隔离 Electron。

用户摩擦：长思考透过用户气泡、工具收据与正文，导致整段不可读。
直接证据：laneViewModel 把 part.text 写入 thinking.meta；V4Thinking 把 meta 放进 h-7 的 inline-flex 行，flex 居中使多行文本向上下溢出。类根因：思考正文与单行状态元数据没有分开的数据/布局边界。归类 recurring，所有供应商、历史恢复、四个宿主面均可进入。

修法：在共享 V4 thinking 契约区分正文与状态；原文只进默认关闭的详情体，展开后正常文档流撑高；状态行保持 shimmer 和实际观测秒数。所有消息保持自然高度，检查流式增长与手动滚动。
不动：模型协议、付费、真实项目库、其他 worktree、PR draft/合并状态；不新增依赖。
现有依据：docs/design/2026-09-06-agent-panel-v4.md 第7条；AgentPanelV4Panel.tsx/V4FlowRow、laneViewModel.ts 是所有宿主共同边界。原生 details 已用于 V4ToolReceipt，无新框架。

验收：真实 Electron 1440 宽长思考→两个只读工具→中文正文，先保存红截图；消息可见内容 rect 零相交（人为造重叠证明探针会红）；流式/完成/展开/收起均验证；投影与 SSR 回归；设计实验室对应态先看图再录基线；完整 pnpm run gates，正常 hook commit/push #646。
回滚：单笔 revert 本次修复；无持久化格式变更。


## 根因与验收证据（2026-09-09）

- 根因位置：`src/workbench/ai/lane/laneViewModel.ts:264` 的 body-as-meta 接线与 `src/workbench/ai/v4/AgentPanelV4Message.tsx:206` 的固定高思考行。现已换成独立 text/streaming 与原生 details；正文仅在展开后参与文档流。标签完成后变为“思考过程”；只显示本次挂载实际观测的秒数，不伪造历史耗时。shimmer 只在当前思考段运行，尊重 reduced-motion。
- 先红：投影测试 live/restored 两种输入 2 条失败、26 条原有通过（`/tmp/nomi-thinking-unit-red.log`）；真实 Electron 长思考期间 1 对相交，生成中和完成各 9 对相交。原先红旅程第二工具用了不可用的外部 MCP 名称，收据为失败；修正为已公开的 read_timeline 后，最终两条读取均成功。失败收据与成功收据共用同一几何边界，此差别不改变重叠机制。
- 红图：`.tmp/pi-thinking-overlap-development-1788895117952/02-generating.png`、`03-complete.png`，已人眼看过，复现用户气泡后透英文、两个竖排“正在想”、中文正文压英文。
- 定向：投影/SSR/loopback SSE 99 条全绿；原生 reasoning-only hold 先发 reasoning_content，原生 SDK、IPC、持久化、渲染均真实运行。
- 几何：`tests/ux/agent-thinking-overlap.walk.mjs` 同时量行框和可见文本 Range rect（只量固定行框会漏掉本次 bug），早期/生成中/完成/展开/收起/冷恢复全零相交；人为 translateY 造出 1 对相交，证明探针会红。1440 宽真 Electron，3 次 loopback、0 付费，两个工具返回成功。
- 真实用户闭环：`agent-real-user-conversation.walk.mjs` 25 请求、0 unexpected、0 付费，文稿→画布→时间轴→排队/停止→冷重启/删对话完整通过，日志 `/tmp/nomi-thinking-full-walk.log`。
- 设计实验室：现有 `v4-assistant-thinking` + 新增 native LanePart→ShellStage 的 `v4-wired-thinking-streaming` / `v4-wired-thinking-complete`，主会话已看过两张新图，再以标准 Playwright 录入两张新基线；不改容差、不重录其他图。
- 回归并未改变 Agent 工具/模型契约，所以真实付费模型数字不适用；仅合成远端响应，生产工具实际执行成功率 2/2、回合成功率 1/1。
- 每日雷达附记：模型索引 APIMart 新增 Gemini Omni 1.1 Flash，kie 无新增，apimart-llm 因凭据不可用今天没查成；结果另存 `/tmp/nomi-thinking-model-radar-latest.json`，未更新快照/不夹带到修复。nomi-research-radar 与 nomi-model-radar 技能在本树及已列技能根均未找到，论文雷达未执行，不宣称今天已查全。

- 已查看最终绿图：`.tmp/pi-thinking-overlap-development-1788895519907/01-reasoning-before-tools.png`、`02-generating.png`、`03-complete.png`（另有 `04-cold-restored.png`）。生成中只有正文光标，完成后光标消失；思考正文默认不可见，收据与正文顺序正确。

- 后续完整类型验证发现 i18next 泛型返回推导为 never，直接 `.repeat(30)` 无法编译；在夹具边界先用模板字符串明确文本类型，再重复。仅这一处调用直接访问返回值方法，同目录其他调用都是字符串参数；无运行时或截图变化。2026-09-09 `pnpm run typecheck` 通过。

## 先查别人

- 仓库已有披露控件：`src/workbench/ai/v4/AgentPanelV4Message.tsx:205` 的 V4Thinking 使用原生 details；同文件工具收据也采用自然文档流，不引入折叠库。
- 已有展示合同：`src/workbench/ai/v4/agentPanelV4Types.ts:1` 与 `src/workbench/ai/lane/laneViewModel.ts:264` 分别拥有展示字段和 native part 投影，正文不应借 meta 的固定高行布局。
- 已有验证宿主：`src/devlab/designLab/v4/states/04-wired.tsx:116` 把真实 LanePart 喂进 ShellStage；`tests/ux/agent-thinking-overlap.walk.mjs:1` 已有真实 Electron 长思考与相交探针。
- 结论：复用已有投影、披露控件与真实宿主，不引入新框架；后续类型修正仅把 i18next 返回显式转成字符串，运行时值不变。
