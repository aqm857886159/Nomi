# 结构评审：`electron/integrationCertification` 与 `electron/providerAdapter`（2026-09-15）

状态：✅ 已交付

> 触发：`check:symptom-cluster` 报「同一模块 7 天内 ≥3 份根因合同」——
> `integrationCertification` 5 份（09-11 起）、`providerAdapter` 6 份（09-09 起）。
> 按 R21.2，第三份合同是「这一层结构不对」最便宜的证据，不是再修一次的理由。
>
> 本文只回答一个问题：**这一簇合同指向的是结构病还是共处？如果是结构病，
> 上一份评审（`2026-09-12-integration-layer-structural-review.md`）给出的处方有没有生效？**

## 一、先看上一份评审自己写下的预测

2026-09-12 那份评审的第 3 条，原文：

> 这一层目前有三处「发布」而只有一处有对账——能力挂载（已有构造期断言）、
> 工具契约（已有单一声明处 + `check:tool-face`）、run 状态（本轮新增终态保证）。
> **第四处是会话阶段（`syncHttpCertification`），它目前靠「每次 get 时顺带同步」，
> 没有独立的一致性断言。若 7 天内再出第四份合同且落在会话阶段，
> 应当先给它一条对账不变量，而不是再修一次。**

三天后，第四份合同来了，而且**正落在会话阶段**
（`docs/fixes/2026-09-15-integration-session-terminal-guarantee.root-cause.json`）。

这是本次评审最重要的一条结论：**上一份评审识别的元规律是对的，它甚至预测对了下一次会从哪儿破**。
所以本次不需要重新诊断这一层的病，只需要核一件事——这次的修法，是不是那份评审开的处方
（「给它一条对账不变量」），还是又一次「再修一次」。

## 二、核处方：这次改的是不变量的归属，不是又一个补丁

| 上一份评审开的处方 | 本轮实际做的 | 判定 |
|---|---|---|
| 给会话阶段一条**独立的**一致性/终态不变量，不再靠「每次 get 时顺带同步」 | 新增 `integrationSessionTerminal.ts` 作为「会话不许停在中间态、cancel 在任何非终态都可达」的唯一持有者；会话阶段第一次有了自己的 deadline 与看门狗，不再只从子 run 推导 | ✅ 照方抓药 |
| 不要「再修一次」（不要只把抛异常的那行改掉） | 抛异常那行确实改了，但它只是四件对偶之一：deadline 落盘 + 看门狗 + 永不抛的出口 + 终态封口。缺任何一件另外三件都退化（合同 `prevention.strategy` 写明） | ✅ 不是点状修 |
| 归属要明确、那层要有测试 | `invariant_owner_layer` = `integrationSessionTerminal.ts`，测试 `integrationSessionTerminal.test.ts`（8 条，修前 7/7 红）+ `integrationSessionRunView.test.ts` | ✅ |

## 三、这一层的元规律，第二次确认（并收窄）

09-12 那份把元规律写成：「这一层大量在**发布状态**，却没有机制保证发布出去的状态与实际状态一致。」

本轮给它加一条更可操作的收窄：**「发布」不一致的最常见来源，是一层把自己状态的不变量
外包给了另一层。** 会话层拥有 `session.stage`、把它落盘、把它投影给用户和驱动 Agent，
却把「不许停在中间态」这条不变量整份外包给子 run。外包一定有边界
（这里是「子 run 存在且还在盘上」），而边界之外就是死锁——ComfyUI 那条免费自检
压根不创建 run，所以它从第一天起就在边界之外。

于是这一层的先验从「谁保证它和真相一致」升级成两问：

1. 这份状态的 **owner 是谁**（谁写它、谁落盘、谁投影它）？
2. 它的不变量是 owner 自己实现的，还是**借**别人的？借的话，借来的保证边界在哪，
   边界之外那些状态谁兜？

## 四、四处「发布」的对账现状（更新上一份的表）

| # | 发布的是什么 | 对账机制 | 状态 |
|---|---|---|---|
| 1 | 能力挂载 | 构造期必填契约 + 装配收口（`installIntegrationSessionRuntime` 没装过就抛，不零参兜底） | ✅ 09-11 |
| 2 | 工具契约（面向模型） | 单一声明处 + `check:tool-face` | ✅ 09-11 |
| 3 | run 状态 | `terminalGuarantee.ts`：终态写三层保证 + 看门狗 + 构造期派生断言 | ✅ 09-12 |
| 4 | **会话阶段** | `integrationSessionTerminal.ts`：deadline + 看门狗（**复用** #3 那只）+ 永不抛的出口 + 终态封口 + 派生断言 | ✅ 本轮 |

四处都有 owner 了。**这一层的「发布无对账」结构病到本轮为止是关闭的**——
不是因为不会再出 bug，而是因为四处发布点各自有了一个会响的持有者，
下一个同族问题会在它自己的层里显形，而不是变成一次「谁也不负责」的死锁。

值得单独记一笔的是：本轮**没有**为会话层新造看门狗，而是把 run 层那只 `TerminalReaper`
结构化后共用（只换一把 `isTerminal` 尺子）。这一点是这一族修复第一次做到「第二层复用第一层的
判据」而不是「第二层照抄第一层的形状」——照抄就是并行版（P1），同一条判据两份实现，
日后只会改到其中一份。

## 五、`providerAdapter` 那 6 份：仍然是共处，不是结构证据

| 日期 | 合同 | 与本轮的共同不变量 |
|---|---|---|
| 09-09 | `credential-validate-before-save` | 无（存取时序） |
| 09-11 | `media-delivery-shape-is-a-contract` | 无（出站形状） |
| 09-11 | `self-check-must-never-demote` | 无（目录发布判据） |
| 09-12 | `integration-run-failure-path` | **有**：同一条「不许停在中间态」，本轮是它的另一层 |
| 09-12 | `spend-gate-outlived-the-spend` | 无（已删功能的残留） |
| 09-15 | 本轮 | — |

6 份里只有 1 份（09-12）与本轮共享不变量，而那一份正是本轮的直接前情，两者是**同一条不变量的
两层**，本轮的 `scope_paths` 把 `providerAdapter` 写进来也只是因为要复用它的 `TerminalReaper`
与单一化它的 `batchTimeoutMs`。其余 4 份彼此无共同不变量。

结论与 09-12 一致：`providerAdapter` 被点名是**统计上的共处**（它是一个宽目录，
承载凭据、媒体、目录发布、状态机四类职责），不构成结构证据，不为它单独立项。

但登记一条可机器化的观察，供 R14 周期审计取用：`electron/providerAdapter/` 目前有
30 个生产源文件（含测试 64 个）、四类互不相干的职责，是这份合同簇里唯一每次都被点名却每次都判「共处」的目录。
若 R14 那轮确认它确实承载了四类职责，按目录拆分（credential / media / catalog / runState）
会让 `check:symptom-cluster` 的信号从噪音变回信号——**这是目录划分问题，不是不变量问题**，
所以不在任何一份根因合同的范围内，必须由审计单独立项。

## 六、结论

1. **本轮不停工**：上一份评审已经诊断过这一层的结构病并开了处方，本轮正是照方抓药
   （把会话阶段的不变量从「借」改成「自己拥有」），不是「再修一次」。
2. **这一层的「发布无对账」结构病到本轮关闭**：四处发布点各有一个会响的 owner。
3. **下一次的先验**（比上一份更可操作）：`integrationCertification` 里任何新的持久化状态，
   先回答「owner 是谁 / 不变量是自己实现的还是借的 / 借来的保证边界之外谁兜」。
   答不出第三问就是下一份合同。
4. **`providerAdapter` 的目录划分**登记给 R14 周期审计，不进根因合同。
5. 若 7 天内再出第五份 `integrationCertification` 合同，先看它落在第四节那张表的哪一行：
   落在已有 owner 的行 = 那个 owner 的实现不够，修它；落在表外 = 又发现了第五处「发布」，
   先给它一个 owner 再修。

## 七、复核线索

- 本轮合同：`docs/fixes/2026-09-15-integration-session-terminal-guarantee.root-cause.json`
- 本轮方案（含门表、先查别人三池子、T-MO-07 接续路径）：
  `docs/plan/2026-09-15-integration-session-terminal-guarantee.md`
- 上一份结构评审（本文核的就是它的处方）：
  `docs/audit/2026-09-12-integration-layer-structural-review.md`
- 前情：run 层那一版 `docs/plan/2026-09-12-integration-run-failure-path.md`、
  真机轨迹 `docs/plan/2026-09-11-mcp-integration-quality.md`
