# 设计卡：急停 / 取消之后，Run 一定停稳，已付费的在飞活一定有人盯到收尾

```
改动名：run-pausing-settles      线/负责人：L-runpause      类别：[花钱][长跑][可打断]
```

## 先说结论（复现）

旧记录说的两件事，在最新 main 上**都不复现**，#934（2026-09-30 合入）已经修掉：

1. 多镜批次急停后永远「暂停中」：`pausing → paused` 那一步已经挂在仓库唯一写入口上（`productionRunLifecycle.settleRunLifecycle`），旧驱动、多镜调度器、观察器、重开项目谁让最后一件活收尾都一样；「继续」也认 pausing。本卡的矩阵测试（驱动 × 收尾方式）逐格是绿的。
2. 画布「重做 / 继续剩余」失败的兜底句「操作没成功，稍后再试」和主进程英文原话：已换成按结构化失败码逐个翻的人话目录（`productionShotActions.SHOT_ACTION_FAILURE_COPY`，穷举，无兜底句）。

复验时在同一族里新抓到两处**还在**的洞，本卡修的是它们：

- **暂停中点「取消制作」失败**：任务卡在「暂停中」只给「取消制作」这一个按钮，状态机却不认 `pausing → cancelled`；点了只回「操作失败: …Illegal run transition pausing -> cancelled」。
- **停稳之后，已交给供应商的那几件没人盯到收尾**：「过一会儿再踢」（多镜）、「再问一次」（单镜）、重开项目、启动恢复（`resumeUnfinishedRuns`，独立验收 V-1078 补抓的第四扇门）四个入口按 Run 状态挑——已暂停 / 已取消一律不管（#934 只给「暂停中」开了口子）。于是：取消后比一趟观察窗还慢的那一镜、已暂停的批次里点「重新取回」的那一镜，钱花了、片出了，没人去取，节点一直转圈。

## 9 格

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我在一批镜头生成途中点了暂停（或取消），我想要：在跑的那一镜收尾后卡片停稳在「已暂停」，「继续剩余」能接着派剩下的；改主意要取消也能取消；已经花了钱的那一镜出片后照样落进项目。步骤：确认付费卡 → 批次开拍 → 第 1 镜交给供应商时点暂停 → 等它收尾 → 卡片「已暂停」→ 点继续剩余 / 取消。**不做**：不撤回已交给供应商的任务（撤不回，钱已花出）；不改「暂停 / 取消」的入口和文案；不动付费确认卡。**已知坑**：慢供应商一镜要几分钟，一趟驱动的观察窗（默认 300 秒）等不完，要靠定时重踢接着问。真实任务：①三镜视频批次，第 1 镜在飞时急停 → 继续剩余；②同一批次暂停中改主意取消；③已暂停批次里某镜「可找回」→ 点重新取回。主指标：急停后落到「已暂停」的比例 = 100%；护栏：每镜只交一次（不重复扣费）。 | `electron/productionRun/productionRunPauseSettles.e2e.test.ts`；真付费复验步骤见 PR 正文 |
| ★2 谁说了算 | 「这个 Run 现在要不要有人驱动」归生命周期 owner：`productionRunLifecycle.runWantsDriver` / `hasWorkToWatch`（概念 `production.run-driver-wanted`，新登记）。消费者只有四处：多镜重踢（`appIntegrationRunObservation.kickSchedulerForRun`）、单镜再问一次（同文件 `singleShotStillInFlight`）、重开项目（`appIntegration` 的打开项目对账）、启动恢复（`productionRunService.resumeUnfinishedRuns`）。`runWantsDriver` 看「交给了供应商、还没结论」（`isStillAtProvider`，含没拿到任务号的「提交中」）；`hasWorkToWatch` 看其中拿着任务号、真能去问的。`pausing → paused` 仍归 `settleRunLifecycle`（未改）。Run 状态迁移表归 `productionRunState.RUN_TRANSITIONS`。碰 2 个概念。 | `node scripts/door-map.mjs runWantsDriver` / `hasWorkToWatch` / `kickSchedulerForRun` / `singleShotStillInFlight` |
| ★3 一致与复用 | 复用现成判据 `isProductionJobInFlight`（「交给了供应商、拿着任务号还能去问」），不新造；四个入口各自手抄的状态清单删掉，改问同一个函数。`running → cancelled` 早就允许、语义是「已交的跑完、不再交新的」，`pausing → cancelled` 沿用同一语义。没有自写通用能力。 | `git grep "\['completed', 'cancelled'" electron/capabilityCore` 为空 |
| ★4 全状态 | 暂停中：卡片「正在安全暂停」+「取消制作」（现在点得动）；已暂停：「继续」+「取消制作」；已取消：卡片进「已结束」，在飞那一镜出片后照样落到节点上；已暂停里重新取回：那一镜从「可找回」→ 生成中 → 完成，Run 仍是已暂停（取回 ≠ 继续）；失败（供应商判失败 / 取消 / 超时）：那一镜「失败」，Run 仍落到已暂停。能力不可用：不适用（本改动不新增要模型或外部资源的动作）。文案未改，未新增词条。 | `src/workbench/production/productionRunView.test.ts`（卡上每个按钮都是状态机认的一步） |
| 5 中途表 | 见下表 | 矩阵测试 |
| 6 外部数据与失败 | 外部来源只有供应商的任务查询结果：成功 / 失败 / 取消 / 超时 / 长时间无结论。前四种都是终态，那一镜落成完成或失败，Run 落到已暂停；长时间无结论 = 如实停在「暂停中」（钱已花出、活还在跑），定时重踢接着问。未知状态由提交出口按失败收（`classifyProviderStatus`，未改）。 | `productionGenerationSubmission.ts` 的状态分类（未改） |
| 7 性能预算 | 重踢只对「停稳了且手上还有在飞活」的 Run 多跑一趟只查不交的驱动；每 15 秒一次、手上没在飞活即停。重开项目多遍历的只有「已取消且还有在飞活」的 Run（通常 0 个）。 | 不阻断，人工 |
| 8 真实条件 | Windows：单测与回环 e2e 跑过；真付费：`unverified`（由协调会话按 PR 正文步骤亲自跑）；英文界面 / 最小窗口：不适用（无界面改动）。 | 本卡「验收」 |
| ★9 验收与回滚 | 验收：另一条线对着本卡逐格核；跑 `npx vitest run electron/productionRun/productionRunPauseSettles.e2e.test.ts electron/productionRun/productionRunLifecycle.test.ts electron/capabilityCore/appIntegrationRunObservation.test.ts src/workbench/production/productionRunView.test.ts`；协调会话真付费复验「急停 → 画布接手 → 继续剩余」与「暂停中取消 → 在飞那一镜出片落进项目」。回滚：revert 本 PR 的实现提交（状态机多一条边 + 三个入口改问同一个判据，无数据迁移，旧版本读新数据无影响）。独立验收报告：待补。 | PR 正文 `## 独立验收` |

### 中途表（暂停 / 取消之后，每种打断）

| 状态 | 用户再点暂停 / 取消 | 关窗 | 断网 | 重启 Nomi | 连点 |
|---|---|---|---|---|---|
| 暂停中（一镜在飞） | 暂停：原样返回；取消：落到已取消，在飞那一镜照样盯到收尾 · 已交的那一笔照常计费，不多交 · 回执：Run 事件日志 | 主进程照样盯；窗口回来卡片已是最新状态 · 同左 | 查询失败当作暂时没结论，下一轮再问；不判失败 · 不多交 | 重开项目：仍是暂停中，重踢接着问，收尾后落到已暂停 · 不多交 | 同一修订号只认一次，旧修订号被拒后按最新重发 |
| 已暂停（无在飞） | 继续：派剩下的；取消：已取消 · 不扣新费，直到继续 | 无影响 | 无影响 | 无影响（重开不驱动） | 同上 |
| 已暂停（点了重新取回） | 只取不交 · 不扣费 | 主进程照样取 | 下一轮再取 | 重开项目重踢接着取 | 同上 |
| 已取消（一镜在飞） | 无可点 | 主进程照样盯，出片落进项目 | 下一轮再问 | 重开项目接着问；关时停在「提交中」的如实标成结果待核对（以前两处都直接跳过） | — |

## 自己写了什么、为什么必须

只改了领域状态机的一条边和「这个 Run 要不要有人驱动」的判据——制作 Run 的生命周期是 Nomi 独有的领域（按镜头的花钱语义），没有现成库可接；判据复用已有的 `isProductionJobInFlight`。
