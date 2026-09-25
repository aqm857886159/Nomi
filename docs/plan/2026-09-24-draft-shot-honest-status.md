# 草稿镜不说「排队中」（2026-09-24，09-25 并入 #869 / #870 后收窄）

> 状态：🚧 进行中 — 已拍板，实现与走查完成，待合入（下一版）。TODO：T-AG-23。
> 合入顺序（2026-09-26 协调会话定）：等 `productionShotOwnsGeneration` 的「已提交」分支改成直接看 job / Run 状态之后再合——
> 它现在借本方案改过的显示相位判画布归属；逐镜确认档（confirm_all）等镜头门的那一刻本方案不覆盖，一并排在那次改动里。
> 样张（已拍板）：[2026-09-24-draft-shot-honest-status-mockup.html](../design/2026-09-24-draft-shot-honest-status-mockup.html)
> 根因合同：[2026-09-24-draft-shot-dispatch-honesty.root-cause.json](../fixes/2026-09-24-draft-shot-dispatch-honesty.root-cause.json)

## 用户那一刻卡在哪

Windows 真模型走查（apimart DeepSeek V4 Pro，面板「自动改」档）：用户说「在画布上加一个图片节点，提示词写：…。先别生成。」
Agent 调 `look_at_canvas` → `list_models` → `draft_shots`，回「已建好…等你准备好随时说一声就生成」。
可节点立刻挂上 **「排队中 · 第 1/1」**，右上角任务按钮变蓝亮 **1**。说了「先别生成」的人读到的是：**已经在排队、要扣钱了**。

实查（真实应用 + 回环供应商，`tests/ux/agent-draft-not-queued.walk.mjs`）：那一刻 Run `draft`、计划 `draft`（`cardHidden`）、
**0 个 job、0 道门、账本 0、供应商 0 次请求**。报价卡弹出、等人点的那一刻也一样。**不是花钱 bug，是字说错了。**

## 根因

「一镜在哪一段」的判定（09-25 起住在 `electron/shared/productionShotPhase.ts`，#870 把它收成主进程落地投影与渲染层小标的唯一 owner）
不知道「用户点过头没有」：没有 job、或最新 job 还停在人工门前（`planned` / `authorization_required`），只要 Run 没停就落到「排队中」。
真相其实早就在：计划的 `submitted`，和调度器那句「authorization_required is still waiting for a human」。

## 做法（已拍板的四条，09-25 与已合入的两条线对齐后）

1. **节点什么都不挂**（本 PR）：`deriveProductionShotState` 在「还没点头」时返回 null——草稿、报价卡在等、job 退回人工门前（返工 / 续拍待授权）、
   没点头就取消、没勾进已提交这一批。判据两个：`jobAwaitsHuman`（`Record<ProductionJobStatus, boolean>` 穷举，新状态不表态编译即红）与
   没有 job 时「计划 `submitted` 且这一镜 `included`」才算在排队（直接写在 `deriveProductionShotState` 里）。调度器的「还在等人」改读同一张表。
2. **任务按钮 / 面板**：由 #869（09-25 拍板的任务面板样张）接手——`draft_shots` 建的草稿不进任务列表；报价卡在等人时归「等你处理」。
   本 PR 原先做的「草稿 N」分组与摘要字段 `dispatched` 在并入 #869 时删掉，不留第二套分组。
3. **报价卡在等人那一刻节点同草稿**：由第 1 条覆盖。
4. **点了之后的画法**：生成中 / 失败由 #870 写进节点自己的运行记录，走普通节点那一套（像素等待面 + 状态行 / 标准错误卡）；
   本 PR 原先的渲染层投影在并入 #870 时删掉。「已派出、还没轮到」的镜仍是批次小标「排队中 · 第 n/N」：2026-09-26 用户拍板保留小签（没在动 = 真没开始，「第 n/N」位次有用；当初要统一是因为「生成中」有两套画法，那一条已由 #870 解决）。
   顺带删掉 `GeneratingOverlay` 已无调用方的居中档（模糊 + 大 N）。

## 范围 / 不动项

- 动：`electron/shared/productionShotPhase.ts`、`electron/productionRun/batchScheduleDerivation.ts`、`GeneratingOverlay` 死档、走查与夹具（apimart 图片任务可停在 `processing`）。
- 不动：花钱链路一行没改；任务面板分组（#869）；落地投影与画法（#870）。
- 另开（TODO）：T-AG-25 一张图出完仍亮任务 1（Run 在等粗剪）；T-QA-33 `p4-s6` 走查在 main 上早已失效。T-AG-24（「生成全部」把在跑 / 排队的 Agent 镜算闲置）已由 #875 修，本 PR 的走查是它的真机证据。

## 回滚

单 PR，纯派生判定；回滚即 revert。

## 验收门

- 单测 `electron/shared/productionShotPhase.test.ts`：6 个没点头的 Run 状态 × 计划 draft/sealed、人工门前的 job（含返工 / 续拍待授权）、没点头就取消、单镜草稿、
  点过头后照旧排队、人工门表穷举、已派出范围。把本 PR 那两行改回 main 原样：22 条变红（变异核过）。
- 真机走查（Windows，零额度回环供应商）：`tests/ux/agent-draft-not-queued.walk.mjs` 草稿（zh + en：节点无状态、任务列表里没有它、按钮不亮、盘上 0 job、供应商 0 请求）
  → 报价卡在等（节点无状态；底栏不给「生成全部」、选中后生成钮按不下去）→ 确认后派出、供应商停在 processing（像素等待面 + 「生成中」）→ 出图落回同一节点。
- 真机走查 `tests/ux/agent-queued-shot-not-regenerable.walk.mjs`（#875 的证据）：两镜「全部」确认、夹具压住第一镜的受理，第二镜真的在排队（盘上 submitting + authorized）——
  挂「排队中 · 第 2/2」，框菜单「生成整框」与选中后的生成钮都按不下去，供应商始终只收到 1 次请求（zh + en）。

## 先查别人

- **仓库里已有「还在等人」的判据**：调度器 `electron/productionRun/batchScheduleDerivation.ts:189`（`shotInFlight`：authorization_required 是在等人，不是在跑）——收成一张表，调度器与画布同读。
- **仓库里已有「一镜在哪一段」的唯一 owner**：`electron/shared/productionShotPhase.ts:163`（`deriveProductionShotState`，#870）——规则加在它里面，不另立模块。
- **仓库里已有付费卡投影对草稿的判断**：`electron/productionRun/productionPendingSpend.ts:95`（`cardHidden` 的草稿不是「在等你点头」）；草稿由 `electron/agentLane/laneVerbTransport.ts:106` 建成 `cardHidden`。
- **job 在封印时就以 authorization_required 建出来**：`electron/productionRun/productionGenerationAuthorizationState.ts:188`——所以「有 job」不等于「派出去了」，判据必须看人工门。
- 依赖 / 生态 / 自媒体：不适用——这是本仓自己的状态语义，没有第三方库或外部格式参与。
- 结论：用已有（#870 的唯一 owner + 调度器判据），把缺的那条规则补进去。
