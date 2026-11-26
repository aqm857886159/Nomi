# U-2 付费提交受理后的恢复

基线 `0ccc7f47d`。对候选生产文件运行 `node scripts/fix-churn.mjs --files`，其中 `electron/runtime.ts` 和 `electron/productionRun/productionGenerationSubmission.ts` 两个文件各自已有两次 fix。交接处表中“上游受理 → Run 凭据”在表外。“结果落项目”是它的下游。

## 0. 根因

执行器把上游受理、响应变换、取回资产合成一个异步调用，Run 据此调用的返回判断是否受理。中间任一步停下，就可能把一笔已有结果的提交报成下落不明。

## 1. 归类

| 入口 | 基线证据 | 故障 |
|---|---|---|
| 目录生成 | `productionGenerationSubmission.ts` 的 afterDispatch 写信封，随后异常处理可把信封改回 submitted_unknown。outbox 随后才向 job 记号 | 故障点在“拿到了号”和“能找回”之间 |
| 画布、ComfyUI | `runtime.ts` 的 buildProfileTaskResult 先变换，再取媒体，返回后外层才收到任务号；ComfyUI 的编号由操作声明把 prompt_id 映射到 task_id | 下载失败或结束进程可丢失受理凭据 |
| 自定义脚本 | `customCallRunner.ts` 的 HTTP 桥可先交还 JSON 让脚本继续发请求；`customCallDispatch.ts` 等整段脚本返回，又等本地化完成 | 在脚本内部轮询时终止，外层连它已经拿到任务号都看不到 |
| 重启取回 | `canvasTransportProvider.ts` 缓存按上游号放在进程内；`taskResultQuery.ts` 的 rebuildCachedTaskFromPayload 重新找目录和 mapping | 服务地址改动或同号任务可让一次已付款取回指向另一条任务 |

`NF-1104-0001` 在指定基线、当前本地 origin/main 的 docs 和 tests 以及这些路径的可达 Git 历史中无记录。故障形状可以验证，外部工单的原话、状态与结案仍缺原始凭据。

## 2. 为什么反复出现

提交意图回答谁授权了这笔钱。上游回执回答该找哪笔任务或哪份媒体。项目资产回答用户最后拿到了什么。原测试把遗失回执和已收到回执后的故障写成同一结局，从验收环节就漏掉了它们的区别。对应铁律 ⑫，点击取回后应当落下原件；点击重新生成才产生下一笔。

## 3. 可验证预测

1. 供应商给号后、第一次查询前停止，重建服务。当前的故障注入可得到一次提交和一个 unknown job，创作者拿不到产物。
2. 同步图像给出 URL 后令下载失败；重启时清空进程缓存。若盘上只有请求和人工重试选项，就无法只凭首次响应取图。
3. 提交后切换同一连接的地址，让新旧地址都接受同一个短任务号。只检查“查询成功”会误判，必须断言收到请求的原始地址及产物内容。

## 4. 尺子

基线实际跑过 `pnpm exec vitest run --maxWorkers=2 electron/productionRun/productionGenerationSubmission.test.ts -t 'turns a lost provider receipt|fresh submission .* polls with the durable model identity|keeps an unknown provider submission'`，三例通过。其中两例在 afterProviderAcceptance 抛错后要求 unknown。它们使正确保留回执的实现反而掉分。拆分“套接字写出后无答复”和“已答复但下游被中断”，以落到项目的资产、服务端收到的 POST 和查询对象为尺子。用户给定的故障矩阵独立于本次实现。

## 5. 归属

这一整块：一笔授权提交从付费意图到可恢复的上游回执，以及这份回执如何落成项目资产。

归谁：electron/productionRun/submissionOutbox.ts:130 管一笔提交的状态，electron/productionRun/productionRunRuntimeEnvelope.ts:106 持有该 job 的耐久执行凭据。

我们哪里绕开了它：electron/capabilityCore/canvasTransportProvider.ts:122 在运行时完成后才收到结果，electron/productionRun/productionGenerationSubmission.ts:419 再写盘。启动与恢复跨过这两个调用之间的窗口。模型试跑的 submissionIntent 还读取旧的 rawReceipt.result，应保留读兼容。

## 6. 三条路

| 方向 | 创作者结果与代价 | 决定 |
|---|---|---|
| 在 IPC 返回后补写缓存 | 正常返回时能读回；在脚本、下载或 IPC 中断时仍丢 | 舍弃 |
| 沿用 Run 的 outbox 和 job 信封，把写入前移到协议确认提交的地方 | 保存原始受理内容、当时选定的目标和取回所需信息；恢复只消费这份凭据。无响应只能告诉人结果未知。脚本要显式区分生成、上传和查询，普通 HTTP 200 本身无法证明生成已受理 | 推荐，用户的 U-2 ②–⑥ 已指定此方向 |
| 只删自动重投 | 保住“不会自己再扣”，仍拿不回已产生的图。旧任务若没有任何可重放证据只能如实显示 | 保留已完成的 U-2 ①，仍须恢复上游结果 |

## 7. 取舍

机器可以凭同一份任务号或媒体收据替创作者取回原件。彻底没拿到证据时，另一笔可能收费的生成需要创作者再次明确选择。

## 特征测试

`electron/productionRun/productionGenerationSubmission.test.ts` 钉住上述基线。验收需同时证明幂等的恢复有实际产物、人工新意图能提交、凭据缺失时自动提交数为零。仅断言没有重复 POST 会让“所有提交一律拦截”的实现也通过。

实现复查还发现，画布的 paidNodeLedger 曾把真实的 comfyui-local 与文本一起分流。单镜、批量、分镜和 Agent 交接现在共同读取 generationNodeLedger，本机额度仍由零费用判据决定。spendConfirm.test.ts、handOverPrecheck.test.ts 和 paidSubmissionRecovery.integration.test.ts 分别检查入口、交接与取回。
