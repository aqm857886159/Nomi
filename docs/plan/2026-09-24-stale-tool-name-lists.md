# 改名漏网的两处回归：时间轴计划卡 + 技能 chip 印 key

> 状态：进行中（2026-09-24）· 来源：复活 Agent 走查时红在产品侧的两步（`tests/ux/agent-real-user-conversation.walk.mjs` 计划卡那一步、`tests/ux/agent-transcript-merge.walk.mjs` 技能 chip 那一步）
> 根因合同：[stale-tool-name-lists](../fixes/2026-09-24-stale-tool-name-lists.root-cause.json) · [skill-display-name-owner](../fixes/2026-09-24-skill-display-name-owner.root-cause.json)

## 用户那一刻卡在哪

1. **时间轴计划卡**：Agent 提议「片头加一条字幕」，卡上本该逐条写人话（「字幕 · 汤先到，人后到」）、时间轴上画出待定色带、只给「仅这一次」。实际是一张通用「可撤销」卡，看不到要改什么，还多一颗「不再问 →」——按下去，这一会话之后的时间轴改动就不再先给他看。
2. **技能名**：composer 上挂的是「分镜规划」，发出去气泡和「已载入技能：」都变成 `workbench-storyboard-planner`，他没法确认挂的就是刚才那个。

## 为什么会这样（机制）

- 计划卡：面板认「这是时间轴计划」靠一张手抄名单 `['propose_edit_plan','apply_edit_plan','nomi_timeline_edit']`。2026-09-14 改名（afe85411d8，不留别名）把动词改成 `edit_timeline`，名单没跟上；而「是不是计划卡」又取决于清单行投影出没出来，行一空，卡就降成通用卡、给出抬档钮。主进程在「自动改」档下确实接受这次会话授权，所以不是只长歪了样子，是真放宽了。
- 技能名：8e89e19ce 让气泡改印主进程快照里的 `name`。那是 SKILL.md 的标识（和 key 同值），不是显示名；store 里还各存了一份名字（三处写法不同）。这个 bug 以前修过一次，因为「第二份名字」还在，又回来了。

## 范围

- 认工具一律问动词声明：`modelFacingToolRegistry.modelToolShowsReviewCard`（新）；`isTimelinePlanTool` / 计划卡判定 / 提示词里「读模型目录」的动词名都从声明派生。
- 技能名只从 key 派生：`skillLabelForKey`（新）；store / 恢复草稿不再存名字；`/` 菜单改用 `skillDisplayTitle`。
- 同类扫描出的死名单（按退役工具名写、已无生产调用方）整段删除。
- 两条走查登记进 `REAL_USER_TEST_MANIFEST`，`JOURNEY_PATTERNS` 点名它们守的路径。

## 不动项

- 执行绑定（`laneVerbTransport` 等按现役动词名分派）——今天是对的，改名时会大声坏；记在合同 residual_risks。
- 主进程对计划卡的会话授权（`grantable`）——渲染层与主进程两份判据有冲突，属于产品拍板，单开任务。
- 失败措辞查表用了非动词名（`'canvas write'`）——另一个消费者、要真实模型数字，单开任务。

## 先查别人

- 依赖里已有：pi 自己认内置工具，是在**工具定义的同一处**导出类型守卫（`isBashToolResult` 等），扩展方拿来用，不自己抄名字——`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.js:21`。结论：识别函数放在工具的 owner 那里（我们的注册表），消费方只调用。
- 仓库里已有：`src/workbench/ai/resident/residentToolDisplay.ts:49` 的 `toolIdentity` 先经 `resolveModelToolCapabilityId`（`electron/shared/agentCapabilities/modelFacingToolRegistry.ts:58`）按契约 id 认工具，改名后 20 个动词都照样认得；`electron/shared/agentLane/laneFailureFromDecision.ts:24` 的 `SUBMISSION_FACETS` 从 `VERB_DECLARATIONS` 现取。计划卡沿用同一做法，不另起。
- 仓库里已有：技能名 owner 早就有 `src/workbench/skillLibrary/skillDisplay.ts:11`（`skillDisplayTitle`），头注释记着同一个症状第一次被修的经过。这次补的是「只存 key」，让第二份名字无处可放。
- 生态里已有：Agent Skills 规范规定 `name` 只能是小写字母数字和连字符、且必须等于目录名——它是标识，不是显示名：https://agentskills.io/specification 。所以快照里的 `name` 天生不能上屏。
- 生态里已有：MCP 规范把一个工具拆成三件事——`name` 是唯一标识、`title` 给人看、`annotations` 描述它的行为：https://modelcontextprotocol.io/specification/2025-06-18/server/tools 。行为跟着声明走，对应我们「按声明的 nextAction 认审阅卡」；标识与显示名分开，对应「技能快照的 name 不上屏」。
- 自媒体：这是内部识别规则，不涉及用户侧做法，不适用。
- 结论：不自研新机制，沿用仓库里已经在用的「问注册表」和「问技能库」两个 owner，把漏掉的消费方接回去，删掉死名单。

## 验收

- 单测：`timelineAgentSurface.test.ts`（每个声明的审阅卡动词都认、别的都不认）、`agentPanelV4Intervention.test.ts`（行没投影出来仍是计划卡、无抬档）、`laneViewModel.test.ts`（真实快照形状下印显示名）、`laneModelContext.test.ts`（提示词里每个工具名都真能调）。修复前 5+1 条红，修复后全绿。
- 走查：两条走查本机真机跑绿；zh / en 各一组计划卡与 chip 截图。
- CI：两条走查进 journeys 维度（`validation-policy.node-test.mjs` 断言它们守的路径会选中 journeys）。

## 回滚

单 PR，`git revert` 即可。无数据迁移：转录里本来就是 `edit_timeline` 调用与 `skillSnapshot { name, contentHash }`，回滚后只是显示退回旧样子。
