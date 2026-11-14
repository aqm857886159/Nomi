---
type: direction-check
units: [production-pending-spend]
decision: approved
approved_on: 2026-10-10
approved_in: 协调会话转达用户「按推荐走方案 A」
---

# 花钱卡「确认」与「×」的仲裁器：类根因复盘 + 设计卡

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> **用户 2026-10-10 拍板：方案 A「换」**——按 operation 的统一仲裁器，所有写入口只能从它进；删掉 discard 绕过队列的特例和分散的 pending 再读 / settled 等待。这一刀是待办「付费卡改状态机」的第一刀。
> 触发：`node scripts/fix-churn.mjs electron/capabilityCore/appIntegrationSpendConfirm.ts` 命中（近 14 天 8 个 fix，这一刀第 9 个；同概念 11 个 fix，这一刀第 12 个）。
> 来源：走查 `agent-spend-stop-midway` 在 CI 上偶发红（`agent-runtime-walk-support` 等不到 generate 工具结果），诊断见协调会话 R-flake-spendstop。
> 特征测试（钉住现状，先于实现）：`electron/capabilityCore/agentPanelSpendConfirmDiscardRace.e2e.test.ts`。

## 0. 一句话根因

同一个 operation 的每一镜没有「一个能线性化的终态」：确认走队列，×（为了能打断）绕过队列，两边各自读账本、各自拼结局，于是它们交错时 UI、回执、供应商看到的是三份不同的事实。

## 1. 归类表：近 14 天的 fix → 症状 → 当时修在哪 → 为什么没根治

| 提交 | 症状 | 当时修在哪 | 为什么没根治 |
|---|---|---|---|
| `e48944727`（10-02） | × 点在「生成剩下」中途被吞 | `confirmRemainingShots` 两张之间看卡还在不在 | 只修批量路径；单张路径仍没有「看卡在不在」的检查点 |
| `3bd287fb2`（10-02） | × 回给卡的话说「没生成」，其实宿主还批了一镜 | × 与回执先等 `cardActionsSettled` 再读 outcome | 补了「读」，没管「写」：× 之后这一镜仍可被批下去 |
| `a15941a2f`（10-02） | 卡上改参数绕过合并规则 | 改走同一条 `resolvePlanPatch` | 与竞态无关，是同文件的并行规则（说明这个文件承载了太多职责） |
| `38db4a3d9`（10-05） | 「等你确认」与账本不一致（1.5 秒轮询 + 转接表） | 删轮询，卡状态只认 Run 账本 | 账本是事实，但动作之间的顺序仍没有 owner |
| `7a46a021f`（10-07）/ `f8c8500a8`（10-08） | 旧卡被新策略重新解释、卡消失 | presentation 绑 epoch；策略失败后恢复卡 | 卡的「身份」解决了，卡上动作的「先后」没解决 |
| `363c11a2f`（10-09） | 先发请求后落节点 | 单镜多镜共用唯一准入点（admit） | 多了一个 await 点，竞态窗口变宽，但窗口两端没有统一令牌 |
| `69e852151`（10-09） | 绑定后租约、开拍不说已发出、× 插得进批次 | `yieldToIncomingActions` 让出一拍给 × | 靠「让一拍」概率性让 × 先到，不是结构保证 |
| `30ecfda28`（10-09） | 批量一口气批完 × 停不住 | 一张一张交（等 `awaitShotHandover`） | 同上：每张之间多一个检查点，单张内部没有 |

汇总：8 个 fix 都是在某个 await 缝上补一个「再看一眼」或「再等一下」，没有一个让「× 之后不再交」成为结构保证。

## 2. 为什么这一类会一直出现

- 写入口：5 扇 IPC 门（`productionActionIpc`：revise / discard / confirm / confirmRemaining / removeShot）+ 2 处读结局的门（`generationTransportAdapters.readPresentationOutcome`、lane 的 `laneSpendCardClose`）+ 装配（`appIntegration`），`door-map` 数出写入口 11 扇。
- 实现前：confirm / confirmRemaining / removeShot 进 `serializeCardAction` 队列；discard 刻意不进；revise 也不进、不登记令牌（main 上本来如此）。实现后：这 5 扇里 4 扇进同一个队（含 revise），discard 不排队但同步登记令牌。队列只能串行已入队的动作；discard 先 `withdraw` 再 `cardActionsSettled`——withdraw 与队里正在 await 的 authorize 之间没有原子性。
- 我们的铁律对号：**⑫ 点了 = 以为的**（点 × 看到停了，钱照花）。最小证据：特征测试落点 2 / 4 / 5。
- 现状实测（特征测试，loopback，真账本）：

| 落点 | 现状 |
|---|---|
| 1 × 紧跟确认到达（admit 前） | 一镜不发，对。确认回「no pending generation」 |
| 2 admit 后、封印开门前 | **× 之后这一镜照样封印、授权、交给供应商（submits=1）**，卡显示已停止。× 回的话是诚实的 sent=1，但违反「× 之后不再交」 |
| 3 封印后、授权前 | 对：封印过的门被 withdraw 一并撤掉，授权被拒，一镜不发。钉住，别改坏 |
| 4 派发之后（确认还没返回） | 已交出；× 回 `ok:false "no pending generation to discard"`，不是如实的 sent=1 |
| 5 确认落定后迟到的 × | 同 4：报错而不是如实 sent=1 |

- CI 上的「lane 收不到 closed 工具结果」本机一直没能复现（特征测试里 lane 的 closed 观察者四次都收到了）；我没有它的直接证据，只确认了窗口存在。仲裁器落地后会让 lane 读封存终态，从结构上堵这条；走查另用 locator + 等宿主事实，不再靠坐标连点。

## 3. 不改结构，接下来会冒出什么

| 预测 | 验证 |
|---|---|
| 再有人在 confirm 里加一个检查点，窗口变窄但不消失，第 9 个补丁 | 特征测试落点 2 在补丁后仍可换位置复现 |
| 新增花钱动作（比如重试）又忘记接队列 / 令牌 | `door-map` 写入口数增长；新门没有 `it` 覆盖四落点 |
| 关窗 / 断网 / 重启时仍有「已批的继续发」「正在发出与等你确认不一致」 | 中途表（下）里标「下一刀」的格子 |

## 4. 靶子独立性

- 走查是同一条线写的，且它的连点是放大器：它测出来的红是真问题，不是尺子错。同时走查本身要改（locator + 等宿主事实），否则它在修好之后仍会靠坐标连点偶发红。
- 特征测试断言的是「用户点 × 之后供应商不再收到」——这个靶子独立于实现（看 loopback 供应商收到的幂等键）。

## 5. P0：现成的有哪些

- **XState（v5）**：查了（Context7 `/statelyai/xstate`）。不接，理由只认领域约束：①它的 invoke 的 Promise 一旦启动，停掉 actor 只是丢弃结果，不会中止已经在 `await` 的账本写入——我们要的是「每一步 await 之前问一次同一个令牌」，状态机库不替代这件事；②持久事实在 Run 账本（事件溯源 reducer，09-26 决策 3），XState 快照是内存里第二份事实，违反「同一事实一份」；③仓库此前三次评估结论一致（`2026-09-15-integration-session-terminal-guarantee.md:143`、`2026-10-05-engine-convergence-cut1.md:176`、`2026-10-08-pending-spend-direction-check.md:47`）。**留给后面**：若 0.24 做卡的「界面态」（stopping / sending / confirm 的纯界面状态机），那里没有账本事实、可用 XState，那是下一刀，不在本刀。
- **`productionRunLock` / `projectLease`**：查了。它们是跨进程、落盘的互斥租约（fencing epoch），解决「谁拥有这个 Run」；这里要的是同进程内「同一 operation 的动作之间的取消令牌与终态」，不需要落盘，也不该占租约（租约被 confirm 已经拿着，discard 要的恰恰是不排队）。复用它们会让 × 去等租约，违背「× 立刻打断」。不接。
- **`serializeCardAction`**：已有队列就是被换掉的对象之一：新仲裁器内含队列，`spendCardActionQueue.ts` 同提交删除。
- 结论：自写一个很小的 per-operation 仲裁器（领域约束：按镜头花钱的取消 / 封存语义，登记 `self-written.json`）。

## 6. 方案对比

| 选项 | 做什么 | 要改多少 / 删什么 | 用户看到的变化 | 风险 | 推荐 |
|---|---|---|---|---|---|
| A 换（用户已拍板） | 新增 `electron/capabilityCore/spendOperationArbiter.ts`：每 operation 一份 {取消令牌, 每镜封存终态, 队列}。5 扇 IPC 写入口全经它（revise / confirm / confirmRemaining / removeShot 进同一个队，discard 不排队但同步登记令牌）；discard 同步登记令牌（保留立即打断）再 withdraw；confirm 在 admit 前、lease 后、封印前、授权前各问一次令牌；封存后 UI / 回执 / lane 只读这份终态 | 新增约 150–200 行；`appIntegrationSpendConfirm.ts` 改约 100 行（删 discard 不排队分支、`cardActionsSettled` 调用、批量里的 pending 再读与 `yieldToIncomingActions`）；`generationTransportAdapters` 改读终态约 10 行（lane 走 `readPresentationOutcome` → `sealedOutcome`，`laneSpendCardClose` 没有改）；删 `spendCardActionQueue.ts`（38 行）；渲染层 hook 约 30 行显示「正在停止」。**生产净增约 300 行** | 确认中点 ×：卡显示「正在停止」直到终态回来，而不是先假装已停；× 之后的未交镜一定不发；派发后迟到的 × 如实说「已发出 N 张」，不再报错 | 令牌检查点漏一处则窗口仍在 → 用四落点并发测试 + 必红变异兜住；改了批量路径的时序 → 同类走查回归 | **推荐** |
| B 补 | 在 confirm 里再加令牌检查 | 约 40 行，不删任何特例 | 无 | 第 9 个补丁；写入口仍分散，下个新动作又漏 | 否 |
| C 接 XState 做付费卡状态机 | 引入 xstate，把卡的状态与动作建成 machine | 新依赖 + 约 400 行 + 接线；仍要自写「await 前问令牌」 | 无直接变化 | 内存第二份事实；与账本对账又是新的竞态 | 否（见 §5） |

规模估计（A）：生产代码约 300 行净增，低于 600 行阈值；用户流程只多一个「正在停止」的现有状态文案，不新增界面元素，不需要新样张。

### 与待办「付费卡改状态机」四项的关系

| 项 | 本刀 | 说明 |
|---|---|---|
| 正在发出 与 等你确认 不一致 | 收 | 两者都读仲裁器封存终态 |
| 关窗后已批的继续发 | 先核实，能收则收 | 已交供应商的不能撤是不变式；未交出的在关窗时是否带令牌，要在实现里确认；收不掉就列下一刀 |
| 批到一半断网 / 重试点不动 | 不收（下一刀） | 这两项在派发之后的供应商一侧（`awaitShotHandover` 超时 / 重试语义），不是确认与 × 的仲裁；本刀未调查，不承诺 |
| 卡的界面态状态机（XState 试点） | 不收（下一刀） | 见 §5 |

## 7. 用户要权衡的核心

「× 之后就一定不再花钱」和「× 要立刻有反应」会打架：本方案让 × 立刻登记令牌（立即打断），但卡上显示「正在停止」要等仲裁器回终态（通常毫秒级，供应商受理中的那一镜除外，那一镜已交出，只如实说已发出）。

## 落地结果与一处解释（实现后补）

- 落地：新增 `electron/capabilityCore/spendOperationArbiter.ts`（由旧队列文件 `git mv` 而来，旧文件不再存在）：队 + × 的取消令牌（`registerCancel` 同步登记）+ 封存终态读口（`sealedOutcome`）。`discardPendingSpend` 不再绕过它；`confirmOneShot` 在开头、落画布后、拿租约后、开门前、开门后（× 在开门中途到：撤掉那道刚封上的门）、授权前问同一枚令牌；批量循环每张前问它；Agent 回执与 × 的回话都从 `sealedOutcome` 读。生产代码净增约 130 行，远低于 600 行阈值；渲染层没改。
- **「交」的分界 = 授权落账**（任务书里「授权后、派发前」那一落点，这里与任务书不同，需要协调会话知情）：门批下来、账本里这一镜就是「正在生成」，之后派发是承诺。账本里没有「批了但不发」这个状态，硬撤只会让卡、回执、账本说不到一起。所以 × 在授权落账之前到：这一镜一定不发（落点 2、3）；在之后到：如实回 `ok + 已发出 N`，不报错、不撤（落点 4、5）。要做到「授权后也能不发」得新增账本状态与界面文案，属于改用户流程，本刀不做。
- 一个行为变化：10-02（X2 / X4）当时的裁决是「× 落在核对之后、开门之前，这一镜照样批下」，现在改成不批。`agentPanelSpendRemaining` 里两条按旧裁决写的用例同提交改成新裁决；`agentPanelSpendBatches` S08 与 `agentPanelSpendConfirm` 里「× 来晚了」两处由报错改成如实终态。
- 不改的：`yieldToIncomingActions`（批量两张之间让一拍）保留——它不是仲裁，是让 × 这条 IPC 在事件循环里有机会先被处理，令牌要先登记得上才有东西可问。
- 「正在停止」：渲染层原本就有这个状态（批量的 `stopping`）；单张确认中点 ×，现有逻辑在 × 回话时推「发出了 N 张」一句。没新增界面状态，没改渲染层。
- 走查：新增 `agent-spend-confirm-then-close.walk.mjs`（locator、不采样坐标，中英各一遍；本机屏外连跑 5 次全绿）；`agent-spend-stop-midway` 的单张轮改成 locator + 等宿主事实再 ×，共用读数抽到 `tests/ux/_spendStopRounds.mjs`。`agent-spend-per-shot` / `generate-remaining` 的等待边界核对过：都是点完等宿主事实（标题 / 供应商请求 / 卡关）再点下一步，不需要改。

## 设计卡（9 格）

```
改动名：花钱卡确认与×的 per-operation 仲裁器      线/负责人：I-spendarbiter      类别：[花钱][可打断]
```

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我在付费卡上点「生成这张」又立刻点 ×，我想要「× 之后没发出的就别发」，以便不被多收一镜。步骤：①出卡 ②点生成 ③立刻点 × ④卡显示「正在停止」⑤得到终态「已发出 N / 未发 M」。不做：不改 × 的语义（仍是收回这次出价，节点和草稿留着）；已交供应商的不撤。已知坑：供应商受理中的一镜只能如实报已发出。真实任务：①单张确认中立刻关 ②「生成剩下 N 张」中途关 ③Agent 回合在等卡关闭时用户点 × | 特征测试 + 新增走查「确认中立刻关闭」 |
| ★1b 连带界面 | Agent 回执：读封存终态（已发出 / 未发 / 已关闭）；卡与画布小标：同一份终态；通知无新增。文案走词表，只新增「正在停止」一句（中英） | 走查截图 zh / en |
| ★2 谁说了算 | 概念：花钱卡动作终态 → 唯一 owner 为主进程仲裁器（取消令牌与封存终态），事实源仍是 Run 账本，仲裁器只是同进程内的协调者，不落盘；消费者：卡、回执、lane 只读 | `door-map` 写入口 11 扇逐个核对 |
| ★3 一致与复用 | 复用：`serializeCardAction` 的队列语义并入仲裁器（旧文件同提交删）、`decideGenerationSpend`、Run 账本、`awaitShotHandover`。不复用租约 / XState（§5）。自写登记 `self-written.json` | `pnpm run check:self-written` |
| ★4 全状态 | 空：无卡；加载：确认中（按钮忙）；成功：已发出；失败：没发出、可重试；部分成功：批量「已发出 k / 未发 N-k」；**取消中**：卡显示「正在停止」直到终态；过期：报价旧则拒绝并说原因；能力不可用：无窗口时 fail-closed | 单测 + 走查 |
| 5 中途表 | 见下 | 并发测试 / 走查 |
| 6 外部数据与失败 | 外部来源只有供应商（loopback 验证）；未知失败仍落「去核对」，不说「没发」（保留 `generation_execution_failed` 语义） | 现有 e2e |
| 7 性能预算 | 仲裁器是内存 Map + Promise，无 I/O；不适用阈值 | 人工 |
| 8 真实条件 | Windows 本机屏外走查中英各一遍、连跑 5 次；真付费：由协调会话合并前做最小量验收，`unverified` 直到那时 | 截图路径见 PR |
| ★9 验收与回滚 | 验收线 V-spendarbiter（与实现线 I-spendarbiter 不同）；命令：特征测试 + 仲裁器单测 + 必红变异 + 三条 spend 走查；回滚：单个提交可整体 revert（旧队列文件同提交恢复） | PR 正文 `## 独立验收` |

### 中途表（状态 × 五种打断）

格式：看到什么 · 花费 · 回执。

| 状态 \ 打断 | 点 × | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 卡待确认 | 卡关，未发 · 不扣 · 「已关闭，未发」 | 卡留着（presentation 持久）· 不扣 | 无影响 | 卡仍在或被启动清扫收回 · 不扣 | 第二下原样成功，不重复 |
| 确认中（admit / 租约 / 封印前） | 令牌登记，卡「正在停止」，这一镜不发 · 不扣 · 终态未发 | 令牌随窗口丢失风险：本刀核实，不承诺 | 租约 / 落点失败则未发 · 不扣 | 进程死，启动清扫收回 · 不扣 | 第二下读到令牌或已决，不重复批 |
| 已封印、授权前 | 令牌登记 + 撤门（现状已对），不发 · 额度解冻 | 同上 | 授权失败，不发 | 清扫撤门 | 同上 |
| 派发中（授权与开跑一步） | 已交则如实「已发出 1」，不报错 | 已交的继续（不可撤） | 供应商侧：下一刀 | 以账本为准（`submission_unknown` 去核对） | 一镜一个 gate，不双扣 |
| 批量中第 k/N | 停在当前这张之后，其余未发，如实 k / N-k | 下一刀列出 | 下一刀 | 以账本为准 | 同单张 |
| 已关闭 / 已决 | 迟到的 × 如实返回终态，不报错 | — | — | — | 幂等 |

## 特征测试清单

- 已钉住：`agentPanelSpendConfirmDiscardRace.e2e.test.ts`——最初的特征提交（`test(spend)`）里落点 1、3 当时行为正确（`it`），落点 2、4、5 是已知失败（`it.fails`）；仲裁器落地后五个落点全是正常 `it`，必红变异（令牌检查恒为否）使落点 2 与 `agentPanelSpendRemaining` 两条用例变红。
- 没钉住：CI 上「lane 收不到 closed 结果」本机未复现（原因见 §2），不伪造断言。

## 补：改参数（revise）也进仲裁器（协调会话 2026-10-10 裁定）

复核（V-spendarbiter）指出 `revisePendingSpend` 没走仲裁器，和 §2 / §6「5 扇 IPC 门全经它」对不上。已接入：revise 放进 `serializeCardAction`，和确认 / 去掉 / 生成剩下同一个队。效果：确认进行中来的改参数排在确认后面，确认发的是改之前那一版，改读不到可改的出价（只有一个终态）；改参数进行中来的确认排在后面，用旧报价被拒、一镜不发，用改后的报价再确认发的是改后那一版，报价不会半新半旧。revise 不登记取消令牌（它只动候选、永远不提交，没有「交出去」这回事）。测试：`agentPanelSpendConfirmDiscardRace.e2e.test.ts` 新增两条交错用例；`agentPanelSpendBatches` S08 里 revise 两条改为新终态；去掉队列包装的变异使两处变红。
