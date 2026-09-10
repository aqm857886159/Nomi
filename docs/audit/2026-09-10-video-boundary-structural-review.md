# electron/video 边界结构评审

状态：结构评审已完成；发现的深度准备阶段资源预留缺口已修复，定向回归通过。
日期：2026-09-10

## 触发与结论

同一七天窗口有三份涉及 `electron/video` 的合同：`2026-09-07-video-depth-node-outbound-and-ipc`、`2026-09-10-canvas-default-concurrency`、`2026-09-10-shot-table-async-write-ownership`。本次逐份阅读合同并检查实际代码，没有将合同数量直接解释成三个相同 bug，也没有仅登记文档来豁免门岗。

三者共同的结构主题是：**异步副作用必须先取得拥有该约束的边界许可，完成时仍只修改属于本次操作的资源。** 但它们不属于同一个应合并的执行器：出站/协议安全归网络和协议边界；供应商额度归供应商准入；画布写入归渲染层会话与撤销日志。把它们统一进一个 video manager 会把不同资源、信任方向和生命周期混在一起，没有证据支持这种架构重建。

发现一个真实的同类结构缺口：深度任务的“同项目独占”检查发生在首个 await 前，但资源登记发生在多个 await 之后，未覆盖 preparing 生命周期。已在原有主进程 owner 内修复，详见最后一节。

## 三份合同的实际 owner 对照

| 合同 | 真正不变量与最早 owner | 实现证据 | 判定 |
|---|---|---|---|
| 深度节点出站与 IPC | 模型下载不得绕过目的地策略；本地协议只服务清单资产；IPC 只接可信 sender | `electron/video/depthVideoModelCache.ts:89` 走 hardenedFetch，`:119` 校验 sha256；`electron/shared/canvas/videoDepthModels.ts:41` 钉不可变下载版本；`electron/protocol/localRuntimeAssets.ts:50` 与 `:74` 分别解析 runtime/model 白名单，`:64` 校验包内路径；`electron/video/depthVideoIpc.ts:32` 起各 handler 先验证 sender | 安全边界没有为 video 复制一套网络出口。合同是新增高风险边界的结构证明，不是一次已有漏洞修复。 |
| C71 并发额度 | 远端额度归供应商契约；CPU 提帧资源与 VLM 请求生命周期分别计量 | `electron/video/deconstructVideo.ts:236` 仅接受明确用户偏好，`:240` 分析仍通过 runTask；`:261` CPU 提帧按 availableParallelism 派生，`:268` 返回分析 promise 而不把模型等待占在 CPU worker 内；`electron/vendor/providerTrafficPolicy.ts:22` 起派生契约；`electron/vendor/vendorHttp.ts:122` 共享 HTTP 准入 | 删除了 video 自造的供应商并发默认；偏好只追加更低限制。未公布的 quota 不补数字。 |
| 分镜事实表异步写归属 | 完成回写必须属于原 canvas generation；事实进度不制造用户撤销；批次只分组自己创建的节点 | `src/workbench/generationCanvas/nodes/shotTable/factBridge.ts:13` writeTable 等待现有写边界、校验canWrite再读取；`:61` 绑定generation与project；`:80` 过滤requestId/projectId；`:103` 单镜重试也绑定generation；`src/workbench/creation/storyboard/exec/storyboardRowActions.ts:294` 绑定批次generation，`:311` 只筛新建节点 | 最早持久化写边界在渲染层，不在视频计算函数。只增加main里的projectId判断不足以替代generation约束。 |

## deconstructVideo 主线合并后的逐路径核对

`electron/video/videoIpc.ts:28` 注册 deconstruct，先校验 sender，再向这一个 sender 返回进度；`:33` 的事件携带 requestId/projectId。`electron/video/deconstructVideo.ts:195` 的 onPhase 回调仍保留，`:196`/`:234`/`:274` 发出三个阶段。这些阶段是运行事实，不改变请求所属项目；最终是否能写入仍由 factBridge 判断。

`deconstructVideo.ts:261` 在完整切镜边界里按原 shot.index 过滤 shotIndexes，未重新编号。`factBridge.ts:112` 单镜重试传 row.order，`:115` 之后检查 generation/project；后续合并只替换匹配 rowId 的行并保留测得时长、原 keyframe 和其他行。C71 的并行重构没有把“只重试一镜”变回全镜 VLM 请求。

单镜重试仍会重新检测切镜和启动整段音轨转写（`deconstructVideo.ts:215`、`:225` 在 shotIndexes 过滤之前）。这是当前算法事实，不把它当作已测量的速度收益，也不能用 VLM 单镜过滤声称全流水线仅做一镜工作。本审查未发现这会破坏行身份不变量；是否复用已有测量/转写属于另一个需真实延迟与费用证据的优化，不在本报告中替换实现。

## 已有测试边界与本次验证限制

合同已登记的防线分别是 depth pipeline/model/client/batch 测试、providerTraffic policy/scheduler/runtime/fetch/vendorHttp 测试、factBridge 与 storyboardBatchLanding 测试。这些测试的 owner 与上表责任层相符，不能拿一个层的绿灯代替另一个层的正确性。

最初为只读结构审查；发现缺口后按授权补上最小生产修复与回归。未运行构建、真实下载或深度生成。C71 的实际付费视频、导出、冷恢复证据归其交付记录；它们不替代新增的深度 prepare 竞态回归。

## 必要动作：深度准备阶段缺少原子预留

`electron/video/depthVideoJob.ts:153` 遍历 sessions 阻止同 project 的第二个任务，但 `:164` 已开始 await resolveVideoLocalPath；之后还有 ffprobe、权重下载（`:195`）和抽帧（`:218`）。直到 `:252` 才 sessions.set。两个并发 prepare 在同项目 sessions 尚空时都能越过检查，随后各自启动重活，违背文件头“同一项目同时只允许一个深度任务”的明确设计。`depthVideoIpc.ts:32` 只验证可信 sender，不能把可信调用等同于串行调用。

以上行号对应修复前审查位置。这是代码路径可证的竞态，不是本轮真实跑出两条进程的测量结论。最早 owner 是现有 prepareVideoDepthJob，修复应在第一次 await 前原子预留项目，并在准备失败时释放，准备成功时无缝交给既有 session；finish/cancel 继续由原会话 owner 清理。不要新增独立全局调度器，也不要拿供应商 quota scheduler 管本地 GPU 资源。

最低回归：同项目第二次 prepare 在第一次异步解析/下载未完成时确定拒绝；第一次准备失败后可再次 prepare；不同项目仍按已有设计处理。以下是本次实际实施与验证，不用文档登记替代修复。


## 修复与红绿证据

`electron/video/depthVideoJob.ts` 的既有 prepare owner 现在在首次 await 前登记 `preparingProjects`；同项目第二次调用立即返回既有 `already-running`。实际准备成功后先安装既有 session，再在 finally 移除预留；准备任一步骤失败也执行 finally。该集合只覆盖原来 sessions 无法表达的 preparing 阶段，不新增任务调度、数字限额或并行任务系统。不同项目仍按原设计互不阻挡。

新增 `electron/video/depthVideoJob.test.ts` 直接调用生产 prepare，用待决 source promise 保持第一次请求正在准备：修复前同项目用例明确失败（期望只进入一次 source resolver，实际两次）；独立项目与失败重试两条对照用例通过。修复后执行 `pnpm exec vitest run electron/video/depthVideoJob.test.ts electron/video/depthVideoPipeline.test.ts`，2 文件 11 测试全部通过。

回归只证明准备预留、失败释放、项目隔离与现有 pipeline 行为，不声称重新做过 GPU/下载/打包走查。完整深度会话运行与 before-quit 清理由既有实现承担，本次未改该生命周期。
