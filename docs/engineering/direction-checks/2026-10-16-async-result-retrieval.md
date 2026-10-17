# 方向检查：异步生成「结果取回」层反复修补（#1213 扩大）

> 触发：`node scripts/fix-churn.mjs` 对本次要碰的文件几乎全部命中——`electron/tasks/`（目录 14 天第 6 刀）、`electron/runtime.ts`（第 5 刀）、`electron/productionRun/productionGenerationSubmission.ts`（第 8 刀）、`electron/capabilityCore/apimartGenerationProvider.ts`（第 8 刀）、`electron/capabilityCore/generationRuntimeAdapter.ts`（第 3 刀）、`src/workbench/generationCanvas/runner/`（目录第 16 刀）、`electron/shared/nomiErrorCodes.ts`（第 3 刀）。来源：逃逸账本 `USER-20261016-video-result-not-retrieved`；设计卡 `docs/plan/2026-10-16-async-result-retrieval.md`；根因合同 `docs/fixes/2026-10-16-relay-video-result-retrieval.root-cause.json`。结账挂的类检查：`electron/catalog/videoQueryContractMatrix.test.ts`（矩阵 + 普查）。

## 0. 一句话根因

「上游这次成没成、结果在哪、没取到卡在哪一步」没有一个 owner：状态词表四份、结果读法三套、失败只剩一句话——每次只修撞上的那一份，另外几份照旧漏。

## 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 08-11 未登记动词永远转圈 | 引擎 A 词表漏 failure/rejected | 词表多份、各漏不同的词 |
| 08-25 APIMart videos[].url 是数组，真视频落不下来 | 引擎 B 产物抽取不看 mapping、自己猜路径 | 结果读法多套 |
| 09-11 query-only 完成无产物落空成功 | 完成无产物守卫只挂在 result 二跳 | 结果读法多套 |
| 09-28 取回失败只说「超时」 | 失败没有阶段 | 失败看不见 |
| #975 已生成未取回卡死 | 引擎 B 取回失败无去处 | 失败看不见 / 判失败 |
| #1213（本次） | 原生通道静默切换 + 通用查询合同按自写 mock + 可找回丢原因 | 三类叠加 |

## 2. 为什么这一类会一直出现

两台引擎（画布 / 单镜 Run 走的 runtime，制作 Run / Agent 走的目录执行器）各自长出了一份「读上游」的代码；渲染层又在拿到结果后再判一次。每份都是在某次事故里就地补的，补完只覆盖那一家、那一种形状。没有任何测试按「目录里每一条视频查询映射」去跑同一组断言，所以新形状、新词、新通道进来，只有付了钱的用户才发现。

铁律 ⑫（点了 = 以为的）：用户点「重新取回」以为会拿回来——要么拿回，要么说清卡在哪。证据：`outboundBlockedRecoverable.test.ts` 的结果取回族用例、`NodeRecoverableReport.test.tsx`、走查 `tests/ux/recoverable-reason.walk.mjs`。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 新接一家视频通道，状态词在一台引擎认、另一台不认 | `git grep -n "PROVIDER_STATUS_CLASSES\|knownStatuses"`（本次已删）；矩阵测试对每条映射跑「认不出不判失败」 |
| 新查询形状进来，结果地址取不到、静默空成功或判失败 | `videoQueryContractMatrix.test.ts` 普查：没登记夹具的形状直接红 |
| 取回失败在面板上没有原因 | `nodeRunOutcome.test.ts` recoverable 保留原因；阶段码测试 |

## 4. 靶子独立性检查

- 夹具来自官方源码 / 文档 / 仓库里的真机录制，不是本线自编；`falLoopback.integration.test.ts` 本次暴露了一个**靶子错**（视频任务回的是一张 PNG，旧读法把任意地址当产物才绿），已先修靶子。
- 真付费验收由协调另派线跑（设计卡格 8）。

## 5. P0：这些是我们独有的吗

按镜头的花钱语义（已付费、免费取回、绝不重新提交）是领域；HTTP / JSON 解析用现成的。没有现成库能告诉我们「哪家把结果地址放在哪」——只能按各家合同 + 真实返回夹具。

## 6. 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 无对应库 | — | — | — |
| 补（逐家修） | 继续在撞上的那份上补 | 小 | 高：下一家照旧漏 | ❌ |
| 收口（本次） | 词表一份（`shared/taskStatus`）、读法一份（`tasks/taskResultReading.readTaskResponse`，两台引擎都调）、失败带阶段码（`retrieval-*`）、上游说成了不判失败、矩阵 + 普查门岗 | 中：碰 7 个热点文件 | 中：行为变化集中在「说成了没地址 / 认不出状态」不再判失败（改为可找回） | ✅ |
| 重写（两台引擎合一） | 画布路也走目录执行器 | 大 | 高 | 以后 |

## 7. 用户要权衡的核心

「上游说成了却拿不到」从此不再是红叉、而是一直可找回——用户少一次「白付钱」的误判，代价是这类节点可能停在可找回态，需要用户去重新取回或到服务商后台核对。

## 特征测试清单

- `electron/catalog/videoQueryContractMatrix.test.ts`（108 条内置视频映射 + 中转两种 × 成功 / 进行中 / 认不出状态）
- `electron/tasks/taskResultReading.test.ts`、`electron/tasks/relayQueryFallback.test.ts`、`electron/tasks/queryOpEmptySuccess.test.ts`、`electron/tasks/unrecognizedTaskStatusQuery.test.ts`
- `src/workbench/generationCanvas/runner/outboundBlockedRecoverable.test.ts`（结果取回族）
- `src/workbench/generationCanvas/runner/retrievalRestartOnDisk.test.ts`（五种取回异常：真落盘 → 新进程读回 → 加载归一 → 只查不交）
- `electron/capabilityCore/apimartGenerationProvider.test.ts`「引擎 B 取产物：合同字段回显的参考图不当产物」（V-1213 复验复现）
- 既有：`apimartGenerationProvider.test.ts`、`falLoopback.integration.test.ts`、`falFaultMatrix.test.ts`、`runwayLoopback.integration.test.ts` 按新语义更新

## 8. V-1213 复验那一刀（同一程序内，不另开复盘）

- **症状**：引擎 B 把合同字段（query 的 `video_url`）回显的参考图当产物，落盘成一张 PNG。
- **直接原因**：读取层有两道筛（回显、类型），合同路只用了回显那道；引擎 B 又从来不提供回显集合（提交记忆只存模型 / 任务种类，取产物入参没有上下文）；产物种类按扩展名定。
- **类根因**：「合同」被当成了豁免——同一个读取函数里，两条路走的不是同一套准入。上一轮写「回显连合同字段也排除」时只在引擎 A 的入参上成立，引擎 B 根本没有那个入参。
- **补法（结构）**：合同与通用规则共用一个 `admissible`（回显 + 类型，唯一例外是要音频时收视频容器）；适配器 `materialize` 的 `context` 必填，生产调用方不带上下文就过不了类型检查。
- **没拦住的地方**：下载落盘那一步只核「字节是不是它自称的那种媒体」，不知道任务要什么。引擎 A 重启后无状态重建拿不到请求里的参考地址，一个**没有扩展名**的回显参考图在那里仍可能被当产物。把任务期望类型带进 `generatedAssetStaging` 要碰素材写入概念，另开一刀（已报协调）。
