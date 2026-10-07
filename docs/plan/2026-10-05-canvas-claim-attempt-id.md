# 画布认领 / 删节点命令号带上「第几次」（发动机收敛第 0 步）· 设计卡

> 状态：🚧 进行中（2026-10-05，分支 `fix/canvas-claim-attempt-id`，本地提交，待协调会话安排独立验收）
> 复盘与来历：[`2026-10-05-engine-convergence-cut1.md`](2026-10-05-engine-convergence-cut1.md) §3 路径 6、§5.3 第 0 步。根因合同：[`../fixes/2026-10-05-canvas-claim-attempt-id.root-cause.json`](../fixes/2026-10-05-canvas-claim-attempt-id.root-cause.json)。

```
改动名：画布认领 / 删节点命令号带 episode   线/负责人：fix/canvas-claim-attempt-id（Opus 实现线）   类别：[花钱]
```

**一句话根因**：仓库按命令号判断「这件事做过没有」，同号的第二条命令不执行、原样返回第一次的结果；画布认领的号只看 Run + 镜头、删节点的号只看 Run + 节点集合，同一镜 / 同一节点在返工之后的**第二次**认领或删除被当成第一次的重放吞掉，制作照派新的那次尝试——同一镜付两次钱，或者钱花在一个已删的节点上。

**改了什么**（修在唯一的造号处 `electron/shared/productionRunCommandId.ts`，同一个模块里还住着主进程 IPC 的标识校验）：
- 认领号 `canvasShotClaimCommandId(runId, shotId, attempt)`：同一次尝试的重试仍只记一次，下一次尝试必是新号。
- 删节点号 `detachShotNodesCommandId(runId, nodeIds, observedRevision)`：同一次上报重发不变；撤销删除、重新绑上之后再删，Run 在中间前进过，是新号。
- 「这一镜现在是第几次」只有一个回答者 `currentShotAttempt`（`electron/shared/productionShotJobs.ts`）：reducer 记认领、判定口比认领、造认领号三处读同一个值，删掉了两处各自的 `latestJobForShot(...)?.attempt ?? 1`。

## 9 格

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我在画布上接手一个制作镜头、或删掉 / 撤销 / 再删它的占位节点，而中间又让制作返工过它，我想点「继续」时制作**不会**再为这一镜花钱。步骤：①批次停下 ②画布生成 shot-2 ③制作返工 shot-2 并批准 ④画布再生成 shot-2（或：删节点 → 撤销 → 返工 → 再删）⑤点「继续」→ 供应商不再收到 shot-2。**不做**：不改画布付费路线本身（收敛第 1 步起才做）、不改判定口规则、不改界面。**已知坑**：真 App 复现未做（夹具复现）。真实任务：(a) Agent 起草 3 镜，第 2 镜画布手动重拍两轮；(b) 删错占位节点后 Ctrl+Z 撤回，再整理画布时删掉它 | `electron/productionRun/canvasShotClaimAttempt.test.ts`；(a)(b) 真 App `unverified` |
| ★2 谁说了算 | 命令号 → `production.command-id`（`productionRunCommandId.ts`，新增写口 `canvasShotClaimCommandId`）；「第几次」→ `production.shot-jobs`（新增写口 `currentShotAttempt`）；「这一镜归谁」仍只有 `decideShotClaim`。碰 3 个概念，都已登记 | `node scripts/door-map.mjs canvasShotClaimCommandId detachShotNodesCommandId currentShotAttempt claimCanvasProductionShot reportDetachedShotNodes` → 写 7 扇；合同 `doors` |
| ★3 一致与复用 | 复用 #966 已有的做法（纠正型绑定号带 revision）和删节点号已有的摘要写法；没有新判据、新状态。自写：两行造号 + 一个取值函数 | `git grep -n "reattach-"` |
| ★4 全状态 | 没有新界面、新文案。用户可见的变化只有「不再多扣一次」：第二次接手后节点照常是画布生成的结果；再删的节点不再有制作出片 | 不适用：无文案改动 |
| 5 中途表 | 见下表 | 单测 + 端到端（真实仓库 / 调度器 / 提交出口） |
| 6 外部数据与失败 | 不碰外部数据：命令号只在本机 Run 账本里用。旧 Run 里的旧号（`shot.claim:<run>:<shot>`、旧摘要）不会和新号撞——仓库只拿新命令的号去比 | 合同 `migration` |
| 7 性能预算 | 每次认领 / 删节点多算一次 SHA-256（几十字节输入），可忽略 | 不适用：无热路径新增 |
| 8 真实条件 | 单测与端到端在 Windows 跑过；真 App、英文界面、真付费均 `unverified`（本线不发起真实付费） | 测试输出见交货报告 |
| ★9 验收与回滚 | 验收（另一条线）：①撤回本提交的生产改动只留测试，`canvasShotClaimAttempt.test.ts` 的 reported case / 2nd-3rd claim / detach 三条必红；②恢复后全绿；③真 App 夹具 + 网络闸走一遍路径 6（零花费），供应商侧 shot-2 只收到画布那几笔。回滚：revert 这一个提交，无数据迁移 | 独立验收报告待补 |

## 格 5 · 中途表（画布认领进行中）

认领是主进程里一次同步写（`runtime.runTask` 里、发供应商之前），所以「进行中」只有三个可被打断的点。

| 处境 | 关窗 | 重启 / 崩溃 | 断网 | 连点 |
|---|---|---|---|---|
| 判定口说「归制作」（在途 / 待对账 / 等确认 / 排队） | 什么都没写、没发；**钱**：不扣；**镜头**：仍归制作 | 同左 | 同左（判定不走网络） | 每次都被拒，同一句「这一镜归制作流程」 |
| 认领已落盘、还没发供应商 | 主进程照常发出去；**钱**：画布这一笔照扣一次；**镜头**：归画布，制作那次尝试已标 `detached`（canvas_claimed），「继续」不派 | 进程没了、请求没发；**钱**：不扣；**镜头**：归画布（认领记录在），节点重开后是空闲，可以再点 ↑——这次判定口说「画布认领过了」，不再写，直接发 | 认领是本机写，照常落盘；发供应商时连不上 = 确定没写出去，节点写失败；**钱**：不扣；**镜头**：归画布 | 第二下被同节点在途闸拒（`node_generation_in_flight`）；即便到了认领这一步，同一次尝试的号相同、判定口也说已认领，不写第二条 |
| 已发出、在等结果 | 主进程收结果，节点重开后落图；**钱**：扣一次；制作不派 | 走画布原有的「可找回 / 结果未知」路径（本步不改） | 同左 | 同上 |
| 第二次接手（返工之后） | 同「认领已落盘」，但认领记在新的那次尝试上（本次修的点）；「继续」不派新尝试 | 同上 | 同上 | 同上 |

删节点上报（另一扇同类门）：上报是渲染层发的一条命令，关窗 / 重启时没发出去，就由打开项目时的落地对账按「节点在不在」纠正（#966）；发出去了，同一次上报重发用同一个号，只记一次。
