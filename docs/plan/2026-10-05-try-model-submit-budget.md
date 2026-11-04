# 试跑「提交那一步」的预算（设计卡 + 方向检查）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 线：L-submitbudget。类别：[花钱][长跑][可打断]。承接 #987（等待阶段 40 秒上限）。公开仓：不写金额与供应商商业内容。

```
改动名：试跑提交与等待共用 40 秒预算；到点按出站证据说「可重试」或「结果未知，不要重试」
```

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我让自己的 AI 试跑一个刚接进来的模型，我希望这一次工具调用在宿主超时（约 60 秒）之前一定有明确回话，并且不会因为 AI 重试而被扣两次钱。步骤：AI 调 `nomi_try_model` → 用户在 Nomi 窗口确认 → 提交 → 等结果 → 回话。不做：不中止已发出的请求、不替供应商判成败。已知坑：供应商卡住时我们不知道它收没收下，只能说「未知」。真实任务：①供应商提交接口 60 秒不回（本机假供应商）②建连失败（端口无人监听）③提交秒回 queued 后一直 in_progress。 | `electron/capabilityCore/modelOnboarding/tryModelSubmitBudget.test.ts` |
| ★2 谁说了算 | 「试跑预算」归 `tryModel.ts` 唯一一处（`TRY_MODEL_WAIT_BUDGET_MS`，提交与等待共用）；「请求有没有写出去」只由 `electron/outboundDispatchEvidence.ts` 判，不另写；任务号缓存归 `electron/tasks/taskCache.ts`（`runTask` 内 `admitTask` 写）。碰 3 个概念，新增 0 个 owner。 | `node scripts/door-map.mjs outboundRequestWasNeverWritten` |
| ★3 一致与复用 | 复用 `outboundRequestWasNeverWritten` / `isTransportLevelFailure`（付费提交 `productionGenerationSubmission.ts` 同一判据）；复用 `Promise.race`+预算计时器写法（`pollTaskToTerminal` 同款）。无第二份判据。自写部分只有「预算赛跑」这一小段，属领域约束（一次 MCP 调用的墙钟）。 | `git grep outboundRequestWasNeverWritten` |
| ★4 全状态 | 成功（出图）/ 失败（供应商明确回错）/ 仍在处理 `still_processing`（已提交，等不到终态）/ **新** `submission_unknown`（提交到点还没回、或连接层断在发出之后：可能已提交，不要重试）/ 可重试失败（证明没写出去，`provider_failed` 且明说可以重试）/ 未确认（`needs_input`）。取消中：不适用（工具调用无取消入口，宿主断开见中途表）。文案是给 AI 看的英文 `nextAction`，不是用户界面。 | 测试断言 `code` 与 `nextAction` 字样 |
| 5 中途表 | 见下表 | 假时钟测试 |
| 6 外部数据与失败 | 外部来源：供应商 HTTP 提交接口。偏差：供应商可能收下却不回。失败时 AI 看到：未知则「别重试，去供应商后台查或等任务号后 `nomi_read target=task`」；证明没发出去则「可重试」。不甩锅给用户的 key。 | 本机假供应商 |
| 7 性能预算 | 不适用：预算本身即性能约束，墙钟上限 40 秒由假时钟断言。 | 测试 |
| 8 真实条件 | Windows 本机 loopback 假供应商走真 `runtime.runTask`；真供应商、真 App、真窗口确认：`unverified`（任务书禁起真 App、禁花钱）。 | 测试输出 |
| ★9 验收与回滚 | 验收：另一条线跑 `pnpm exec vitest run electron/capabilityCore/modelOnboarding/tryModelSubmitBudget.test.ts`，修前（回滚 `tryModel.ts`）必红。回滚：revert 本分支的实现提交，行为回到 #987（提交无上限）。独立验收报告：待协调会话指定验收线。 | PR `## 独立验收` |

## 中途表（提交还在路上时）

| 情形 | 工具调用回话 | 钱 | 这次试跑 / 任务号 |
|---|---|---|---|
| A 提交卡住超过预算，宿主还没断（40 秒到点） | `submission_unknown`：可能已提交，不要重试 | 可能已扣，未知 | 后台那次 POST 照跑；回来若有任务号，`runTask` 已写进任务缓存（`nomi_read` 可查） |
| B 宿主在预算前就断开（它的超时比我们短） | 没人收回话；`runTask` 不被中止，继续跑 | 同 A：可能已扣 | 同 A，任务号照样进缓存；AI 重试前应先去后台查 |
| C Nomi 在提交途中被关掉 | 无回话 | 取决于请求是否已写出；Nomi 重启后缓存是内存的，任务号丢，只能去供应商后台查 | 无本地记录（残余风险，见下） |
| D POST 最后成功（晚于预算） | 已回过 `submission_unknown` | 扣了一次 | 任务号进缓存；非终态任务由 `taskCache` 保留 1 小时可查 |
| E POST 最后失败（晚于预算） | 已回过 `submission_unknown` | 失败有两种：证明没写出去则没扣；否则未知 | 没任务号；日志里留一行，不再通知（回话已发出） |
| F 提交在预算内以连接层错误失败 | 证明没写出去 → `provider_failed`（可重试）；证明不了（`ECONNRESET`、`socket hang up` 等） → `submission_unknown` | 前者没扣；后者未知 | 无 |
| G 提交在预算内秒回 queued，等待阶段耗尽剩余预算 | `still_processing`（已有，等待用的是**剩余**预算而不是新的 40 秒） | 已扣 | 任务号在回话与缓存里 |

## 方向检查（`tryModel.ts` 近 14 天第 4 个 fix，目录第 10 个；`vendorHttp.ts` 第 6 个，只加一个 cause 字段）

0. 一句话根因：试跑是「一次 MCP 工具调用」，它的墙钟预算要由一个 owner 管整条调用（提交+等待），之前只管了后半段，补丁一块块往后半段加。
1. 归类：#987 等待阶段无上限 → 同类（预算不覆盖整条调用）；本次提交阶段无上限 → 同类；早先 queued 被当失败 → 另一类（状态判定）。
2. 为什么冒：预算是在发现一个超时症状时只围住那一段，而不是定义「这次调用的总预算」。本次把预算起点放到调用入口、提交与等待共用，之后任何新阶段都吃同一份剩余预算。
3. 预测：若再有第三阶段（例如确认卡等待）也会无限等 → 它已被本次共用预算覆盖（确认等待发生在 `runTask` 内）。验证：测试里让 `runTask` 永不返回。
4. 靶子独立性：本次测试用真 `runtime.runTask` + 本机假供应商 + 假时钟，不是 mock 的 `runTask`。
5. P0：「别重复扣费」靠的是出站证据判据，已是现成模块，不自写。
6. 补 / 重写 / 删：选补（改动在一个函数内、不加分支树）；重写与删没有收益，因为试跑与 Run 路径不同源是既有设计决定。
7. 用户要权衡：「到点说未知」会让少数慢供应商的用户多一步手动查，换来绝不重复扣费。已默认选后者。

## 一处连带修复

`vendorHttp.ts` 构造 `VendorRequestError` 时丢了原始 fetch 错误（没有 `cause`），于是出站证据判据在自定义档案路径上永远答「不知道」。这一刀只给建连失败那一支补上 `cause`。

## 残余风险

- Nomi 在提交途中被关闭时任务号只在内存缓存，无法找回（需要持久化任务账，属另一议题）。
- 提交预算内未回而后台最终成功的任务，若是终态成功，不进 `taskCache`（它只存在途任务），只能去供应商后台查。
