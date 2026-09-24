# 草稿镜不说「排队中」+ Agent 镜走普通节点画法（2026-09-24）

> 状态：🚧 进行中 — 已拍板，实现与走查完成，待合入。TODO：T-AG-23。
> 样张（已拍板）：[2026-09-24-draft-shot-honest-status-mockup.html](../design/2026-09-24-draft-shot-honest-status-mockup.html)
> 根因合同：[2026-09-24-draft-shot-dispatch-honesty.root-cause.json](../fixes/2026-09-24-draft-shot-dispatch-honesty.root-cause.json)

## 用户那一刻卡在哪

Windows 真模型走查（apimart DeepSeek V4 Pro，面板「自动改」档）：用户说「在画布上加一个图片节点，提示词写：…。先别生成。」
Agent 调 `look_at_canvas` → `list_models` → `draft_shots`，回「已建好…等你准备好随时说一声就生成」。
可节点立刻挂上 **「排队中 · 第 1/1」**，右上角任务按钮变蓝亮 **1**。说了「先别生成」的人读到的是：**已经在排队、要扣钱了**。

实查（真实应用 + 回环供应商，`tests/ux/agent-draft-not-queued.walk.mjs`）：那一刻 Run `draft`、计划 `draft`（`cardHidden`）、
**0 个 job、0 道门、账本 0、供应商 0 次请求**。报价卡弹出、等人点的那一刻也一样（0 job、0 请求），节点照样写「排队中」。
**不是花钱 bug，是字说错了。**

同一次走查还查出第二件事（用户指出「生成中那个 N 跟现在的设计不一致」）：Agent 派出去的镜「生成中」走的是
`ProductionShotPlaceholder` 里 8-25 写的一层旧遮罩（模糊 + 大 N 转圈）。9-08 普通节点换成像素网格等待面
（`GenerationWaitingSurface`，e7ec75745）时这一层没跟上。同一个 App 里两副「生成中」、两副「排队中」、两张失败卡。

## 根因

「这一笔用户点过头、交给执行了没有」这个概念**没有 owner**。每个界面拿一个代理量猜：

| 读口 | 拿什么猜 | 猜错在哪 |
|---|---|---|
| 画布占位 `deriveShotPlaceholderState` | 「没有 job」= 还没轮到 → 排队中 | 草稿 / 报价卡在等 / 勾掉的镜 / job 停在人工门前 全被说成排队中；没点过头就取消的草稿显示「已停」还给一颗续拍钮 |
| 任务中心 `buildProductionRunTaskRows` | 「没终止」= 在跑 | 草稿点亮任务按钮；草稿一直不生成，这个 1 就一直亮 |
| 调度器 `batchScheduleDerivation.shotInFlight` | `authorization_required` = 还在等人 | 判据是对的，但只有它自己知道 |

真相其实早就在：计划的 `submitted`，和调度器那句「authorization_required is still waiting for a human」。

第二件事的根因同形：「一个节点在执行中长什么样」有两个 owner——普通节点读本地 `node.status`，Agent 镜读 Run 的 job 另画一层。

## 做法（已拍板）

1. **唯一判据** `electron/shared/contracts/productionDispatch.ts`：`jobAwaitsHuman` / `isCurrentRequestDispatched` / `isNodeInDispatchedScope`。
   中立契约层，主进程（Run 摘要、调度器）和渲染层（画布节点、任务中心）都读它。调度器的 `authorization_required` 判断改成读它。
2. **节点**：`deriveShotPlaceholderState` 用户没点头（草稿 / 报价卡在等 / job 停在人工门前 / 这镜没勾进这一批 / 没点头就取消）→ `null`，什么都不挂。
   删掉「有 run 但节点没绑镜 → 兜底排队」和「第 n/N」位次。
3. **画法收成一套**：`projectShotExecution` 把 Agent 镜的执行态投影到节点上（只在读的那一刻换一副面孔，不写回 `node.status`），
   `useGenerationFeedback`（等待面 / 状态行 / 时间轴）与节点错误卡都经它：生成中 / 排队中 = 像素等待面 + 状态行；失败 = 标准错误卡，重试走返工。
   `ProductionShotPlaceholder` 只剩 Agent 批次独有的「已停」。删掉旧的居中遮罩（`GeneratingOverlay` 的 center 档，最后一个调用方就是这里）、
   「排队中 · 第 n/N」小签、内联简化红卡，以及它们的 i18n 键。
4. **任务中心**：`ProductionRunSummary.dispatched`（主进程按唯一判据算）；`status === 'draft' && !dispatched` → 新分组 `draft`，
   面板里单独一组「草稿 N / Drafts N」，不进「进行中」、不点亮任务按钮。打开着的完整 Run 并进列表时同一个判据当场判。
   分组先后表只留一份（`TASK_CENTER_GROUP_ORDER`）。

## 范围 / 不动项

- 动：上面四处 + 走查夹具（apimart 任务可停在 `processing`，才拍得到「已派出、还在跑」）+ 两条旧走查的断言跟新画法走。
- 不动：花钱链路（草稿、出卡、封印、派发一行没改——实查本来就没花钱）；其它在等人的 Run 状态（方向 / 剧本 / 分镜 / 合同 / ready）的任务分组；
  「已停」的长相与续拍。
- 另开（TODO）：T-AG-24 批量「生成全部」仍把在跑的 Agent 镜算闲置；T-AG-25 一张图出完仍亮任务 1（Run 在等粗剪）；T-QA-33 `p4-s6` 走查在 main 上早已失效。

## 回滚

单 PR，纯前端判定 + 摘要多一个布尔字段；回滚即 revert。摘要字段是新增的，老渲染层读不到也不会坏（旧行为）。

## 验收门

- 单测：`productionDispatch.test.ts`（每一个 job 状态、计划三态、重新出价、单镜/多镜范围）；
  `shotPlaceholderState.test.ts`（每一个没点头的 Run 状态 × 计划 draft/sealed、人工门前的 job、逐镜确认档、勾掉的镜、没点头就取消）；
  `productionRunTaskCenter.test.ts`（草稿分组、完整 Run 并入）。改回旧行为 25 条变红（变异核过）。
- 真机走查（Windows，零额度回环供应商）：`tests/ux/agent-draft-not-queued.walk.mjs` 草稿 → 报价卡在等 → 派出在跑 → 出图，zh + en；
  `tests/ux/p4-s5-canvas-landing.e2e.mjs` 四态同屏（失败 / 生成中 / 排队中 / 已停）。
- Windows 上 Agent 走查依赖尚未合入的 lane 修复（`claude/windows-sync-hardening`：Windows 上点发送没反应），本地验证时临时套用、未进本 PR。

## 先查别人

- **仓库里已有「还在等人」的判据**：调度器 `electron/productionRun/batchScheduleDerivation.ts:189`（`shotInFlight`：authorization_required 是在等人，不是在跑）——收成唯一 owner，不另写一份。
- **仓库里已有付费卡投影对草稿的判断**：`electron/productionRun/productionPendingSpend.ts:95`（`cardHidden` 的草稿不是「在等你点头」）；草稿由 `electron/agentLane/laneVerbTransport.ts:106` / `:110` 建成 `cardHidden`。
- **仓库里已有普通节点的等待面与错误卡**：`src/workbench/generationCanvas/nodes/GenerationWaitingSurface.tsx:51`、`src/workbench/generationCanvas/nodes/NodeErrorReport.tsx:40`——直接复用，不给 Agent 镜再画一版。
- **job 在封印时就以 authorization_required 建出来**：`electron/productionRun/productionGenerationAuthorizationState.ts:188`——所以「有 job」不等于「派出去了」，判据必须看人工门。
- 依赖 / 生态 / 自媒体：不适用——这是本仓自己的状态语义（计划与 job 的生命周期），没有第三方库或外部格式参与。
- 结论：用已有（调度器判据 + 普通节点画法），收成一份，不自研新的状态或新的画法。
