# nomi_read 加「任务」目标：AI 能按任务号查异步任务

> 设计卡（长跑类，沾花钱边界，9 格全填）。承接 `docs/plan/2026-10-04-try-model-async-queued.md` 的后续项。
> 线 / 负责人：B 线 L-readtask。类别：[长跑]（只读，不花钱，不提交）。

## ★1 用户怎么用
- 当：用户让自己的 AI 试跑一个新接的异步模型，`nomi_try_model` 40 秒内等不到终态，返回 `still_processing` 加任务号。
- 我想：AI 自己去看结果，而不是叫我去供应商后台查。
- 步骤：① `nomi_try_model` 返回 `still_processing`（已收费）→ ② AI 照 `nextAction` 调 `nomi_read {target:"task", taskId}` → ③ 得到 排队 / 处理中 / 成功带产物 / 失败带供应商原话 / 不认识 → ④ 没好就隔一会儿再读一次；好了向用户汇报。
- 不做：不重新提交、不花钱、不在一次调用里循环等（一次调用只查一次，外部宿主工具超时约 60 秒）；Nomi 重启后不去「找回」任务（见 5）。
- 已知坑：Nomi 重启后进程内任务缓存与受理账本一起丢，这时任务号对 Nomi 就是「不认识」，不是失败。
- 真实任务：① 本机假异步供应商，试跑拿 still_processing，再读到排队 → 处理中 → 成功；② 同上读到失败带原话；③ 重启后读旧任务号。

## ★2 谁说了算
- 「异步任务的现状」唯一 owner：`electron/tasks/taskResultQuery.ts` 的 `fetchTaskResult`（画布 / 试跑 / 制作流程同一条）。新模块 `electron/capabilityCore/readTask.ts` 只翻译它的结果，没有提交入口（不导入、不调用 `runTask`，有测试钉住）。
- 缓存未命中的判别：`electron/tasks/taskAdmission.ts` 新增 `isTaskCacheMissRaw`，与 `classifyTaskCacheMiss` 同文件配对，没有第二份「认不认识」的判据。
- 碰到的概念：1 个（异步任务查询），不新增 owner。门表：`node scripts/door-map.mjs fetchTaskResult`。

## ★3 一致与复用
- 查询复用 `fetchTaskResult`；终态判据复用 `isTerminalTaskStatus`；脱敏复用 `redactAdapterSecrets` / `sanitizedAdapterJson`；备忘用现成的 `TtlLruCache`。没有第二份轮询（本目标不轮询，只查一次）。
- 自己写的：只有 `readTask.ts` 里把结果翻成「状态 + 下一步」的那层，和一小块终态备忘。必须自写的理由（领域约束）：`fetchTaskResult` 在终态会把任务从工作缓存清掉，没有备忘，AI 第二次问同一个已完成任务会被说成「Nomi 不再跟踪」，对已查到结果的任务那是假话。备忘只记刚查到的终态，不提交、不轮询。

## ★4 全状态（AI 看到什么，英文原文给 AI 读）

| 状态 | `state` | 说什么 |
|---|---|---|
| 排队 | `queued` | 仍在排队，提交时已收费，不是失败；稍后再读，别再调 `nomi_try_model` |
| 处理中 | `processing` | 同上 |
| 成功 | `succeeded` | 带 `assets`；再读结果一致 |
| 失败 | `failed` | 带供应商原话 `providerMessage` 与脱敏响应摘录；只有用户同意再花钱才重试 |
| 不认识 | `unknown_task` | 明说不认识；可能是任务号写错，或 Nomi 重启过（进程内任务表丢了）；别重提交，叫用户去供应商后台按任务号查 |
| 不再跟踪 | `not_tracked` | 同一进程里追踪被清掉（过期 / 被别处取走）；同上建议 |
| 查询失败 | `query_failed` | 这次没连上供应商（或宿主没给查询函数）；任务本身不受影响；稍后再读 |

缺 `taskId`：400「taskId is required for target=task」。无界面，不涉及 i18n（这是给 AI 的协议文本，同 `tryModel` 其他回复）。

## 5 中途表（读任务这一动作）

| 时刻 | 钱 | 看到什么 |
|---|---|---|
| 正常读 | 不花、不退 | 上表 |
| 连点 / 重复读 | 不花 | 每次一次供应商查询；终态结果一致 |
| 读的时候断网 | 不花 | `query_failed`，任务不受影响 |
| 读的时候供应商卡住 | 不花 | 20 秒预算处截断，`query_failed` |
| Nomi 重启后读 | 不花，之前的钱已花 | `unknown_task` 加重启说明与下一步 |
| 用户关窗 | 不花 | 读在主进程，不受影响 |

## 6 外部数据与失败
外部来源只有供应商的任务查询响应，状态词归一与未知动词容忍沿用 `taskResultQuery.ts` 现有逻辑，不改。失败原话原样（脱敏）交给 AI，不甩给用户的 key。

## 7 性能预算
一次读 = 一次供应商查询，上限 20 秒（`READ_TASK_QUERY_BUDGET_MS`），远低于宿主 60 秒。备忘上限 100 条 / 1 小时。

## 8 真实条件
本机 loopback 假异步供应商 + 真 `runTask` / `fetchTaskResult` / 真 dispatcher。Windows。真供应商 `unverified`（不花钱的原则）。

## ★9 验收与回滚
- 验收：`pnpm exec vitest run electron/capabilityCore/readTaskTarget.test.ts electron/capabilityCore/modelOnboarding/tryModelAsyncQueued.test.ts`；每条读用例断言供应商收到的提交数为 0。
- 对外 MCP 面（兼容性）：`nomi_read` 的 `target` 枚举加一个值 `task`、输入属性加一个可选 `taskId`，纯加法，不改已发布字段、不改 `required`、旧客户端不受影响；没有新工具。`tools/list` 字节只增了 `task` 一个枚举值、一条 `taskId` 说明，在 `check:mcp-payload` 预算内（若基线需要更新，按该门流程更新并写进 PR）。
- `nomi_try_model` 的 `still_processing.nextAction` 文案改为指向 `nomi_read target=task`。
- 回滚：revert 本任务提交；纯加法，无数据迁移。
- 独立验收：由协调会话另派验收线（合并前扫描若判四类，再补 `## 独立验收`）。
