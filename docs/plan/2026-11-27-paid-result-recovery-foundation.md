# PR0 · 找回付费画布单镜

协作看板 #1586，拍板 D-1127-recovery-foundation。实现线 Codex。范围和验收以 [#1708 的方向复盘](../engineering/direction-checks/2026-11-27-paid-result-recovery-direction-check.md) 及本次派活单为准。

## ★0 先查别人

- electron/productionRun/productionRunRuntimeEnvelope.ts:207 的物化租约会复核观察版本。把完整终态写在它的原子完成步骤，先于 job 就绪。
- electron/productionRun/submissionIntent.ts:75 已有按业务 scope 定位的磁盘认领和短租约。复用它指向实际画布 Run，避免再造一套派发账。
- electron/capabilityCore/canvasResendDecision.ts:53 的决定号绑定窗口、项目、节点和本次点击。继续走已有确认卡。
- electron/audioTaskRunner.ts:228 的转写成功返回空媒体和字幕正文。按实际任务合同验收转写，让空媒体生成继续进入待取回。

出口：electron/capabilityCore/canvasResendDecision.ts:86 · 完成单通过现有确认卡再发，取消保留原结果 · 把确认号绑定到触发询问的那笔已完成订单。

## 设计卡


★1 创作者提交样片、关窗、重启、点重新取回，再从样片出高清。用完整对象相等、Run/job 状态与模拟上游 POST 数验收。旧项目缺快照仍回放媒体。节点、错误卡、任务中心和通知沿用原入口。

★2 画布 Run 的 job 信封保存本地化终态，主进程观察者在窗口退出后接手。submissionIntent 仅按供应商和源任务号认领派生请求。原单在途或待取回时，换分辨率也附着原单。原单成功后，换规格须经已有重发确认。

★3 按字段补回会随结果扩展漏项，删除找回会丢已付费的产物。按拍板保存整个对象，重放和在线共读，旧回执按原逻辑处理。

★4 受理后跟踪原单，取回失败继续免费查。未知保留核对路径，明确未发出或拒单可再发，成功后另发需真人确认。

5 停止或关窗交给观察者，重启按 Run 找回。断网保留原任务号，连点附着原单，明确确认的新单另计一次。

6 上游由现有传输返回归一化 TaskResult。本地媒体有文件收据才成功，转写有合法文本才成功，缺产物留在待取回。

★7 无新增交互。按派生 scope 和点击号定位文件，回放单笔 job，无项目历史全表扫描。

8 真文件系统、Run 服务与重建宿主使用模拟供应商。未验证：真付费、真实桌面重启、Windows 及双语界面，本单限主进程免费演练。

★9 在线、后台收完和重启 poll/replay 的完整结果相等，POST 一次。3D 与纯转写均 completed。两种源参数三态覆盖附着（含待取回）、确认后第二单、拒绝或未发出后直接新单，检查新点击号可轮询。老单仅媒体。撤掉实现后首提交用例须全红，回滚单位为实现提交。

第 2 轮验收以真实目录模型装配后的 POST 计数为准。MiniMax-H3-Regeneration 的两次点击只差 resolution，捕获的请求只含模型与源任务号，共发一次。自定义转写脚本的正文和 choices 回执须同时保存在 settledResult，重建宿主后 poll 和 replay 均与在线相等。落账期间注入崩溃，窗口应从磁盘读到完整结果，观察者补齐 completed。

## 明确不做

- 同一连接键下修改服务地址或更换账号且源任务号恰好撞号。
- 认领落盘后、派发提交意向落盘前的毫秒级崩溃窗口。
- 两张不同节点同时附着同一源任务后删除原节点。
- 物化阶段 artifact.add 落盘后、终态快照写完前的毫秒级崩溃路径分叉。

## 调用方表

基线 b24bf1d72，door-map 扫描 src 和 electron 共 3214 个非测试文件。命令为 `node scripts/door-map.mjs --read=resultFromArtifacts,canvasResult materialize submitCanvasShot submitCanvasShotRun pollCanvasShotRun`，共 23 扇门、29 处。符号按文件及读写去重。

| 符号 | 基线门 / 处 | 本次门 / 处 | 调用方与用途 |
| --- | --- | --- | --- |
| resultFromArtifacts | 1 / 3 | 1 / 1 | appIntegrationCanvasShot 原有 replay、已有产物早返、在线物化后三处；现仅 canvasShotResult 的旧媒体读取使用 |
| canvasResult | 2 / 3 | 4 / 7 | canvasShotResult 在物化中断后读取已落盘的轮询结果；appIntegrationCanvasShot 读取受理及轮询，canvasTransportProvider 读取同步终态；物化器识别整份画布结果（计数含类型引用） |
| materialize | 16 / 18 | 16 / 17 | 账本调用方为 appIntegrationCanvasShot、generationDomain、multiShotBatchScheduler、singleShotGenerationObserver。下游为 productionGenerationSubmission、generationRuntimeAdapter、canvasShotRunApi。其余同名为 generationOutputMaterializer、comfyuiCandidateLifecycle、localTaskJobs、useNodeMentionSource、batchPlanPreview、generationRunController 的暴露、局部回调或引用 |
| submitCanvasShotRun / submitCanvasShot | 各 1 / 1 | 各 1 / 1 | catalogTaskActions → taskApi → taskIpcHandlers → canvasShotRunApi → createCanvasShotRuns.submit |
| pollCanvasShotRun | 2 / 3 | 2 / 3 | catalogTaskActions 在线；recoverTaskActions 手动重新取回、后台 run-settled 落节点 |

实现后同一命令扫描 3215 个文件，共 25 扇门、30 处。Run 沿用 envelopeRefFor 的 `jobs/<jobId>/runtime-envelope.json`。物化顺序为先提交信封，再发布 job ready。派生认领在同一短租约内写入已批准的 job 和它的 Run 号，释放后才向上游提交。新点击号持久指向被附着的 Run，重新打开项目仍可按本次点击号查询。
