# F-A 生成派发、素材传输与失败归因

独立复盘线：codex-fa-audit（未参与此前 3 轮修补）

## 0. 根因

观测发生在哪一步决定它能证明什么。Range 请求被拒不能证明生成服务读取同一 URL 会失败。适配器已知的失败类别应穿过 IPC，任务终态也应随 Run 保存。重复执行由掌握付费派发证据的主进程决定。交接图见 generation.dispatched-attempt、asset.anonymous-upload-chain 与主进程提交账本。

## 1. 归类

| 现场 | 直接原因 | 证据 |
|---|---|---|
| 新鲜图片链接被要求上传 | 0.24.1 新增的 Range 试探把 403 记成死链，托管关闭时发不出去 | 回环服务对 Range 回 403、对普通 GET 回图片，六个入口修前都没交出去 |
| 有类别却读成 unknown | IPC 只识别顶层异常，Run 只为某一种参考图错误保留原话 | 同一个 quota 在包装后丢失，两台引擎落账后也丢失，模型不存在的上游码同样可复现 |
| 同一镜多次执行 | 渲染层读 timeout 等字面重新执行节点，主进程账本另按证据决定重发 | 单镜图片和视频都实测执行 3 次 |

## 2. 为什么复发

同一个错误有机器判定、展示文案、传输观察三种表示。拿文案恢复机器判定，换一个适配器外壳或多一次读盘就会变。一次提交意图只能执行一次。0.23 的画布没有同样的提交分类；27 次集中的历史记录也没有点击或 Run 身份。

## 3. 预测与量具

在回环服务器改变 Range 答复并关闭公共托管，可读原件仍要走到调用边界，过期且禁止上传仍停下；两扇任务 IPC、两个运行引擎读出的已分类原因相同。单、批媒体每镜应有一次执行，确认后的新意图可发。2026-11-30 按补丁版本复查雷达的本机占比、unknown 和单安装集中度，复发时按当前入口重开。

## 4. 尺子

独立复盘重放了真正的 VendorRequestError 和目录适配器外壳，核了三版的循环；本线在未改生产代码的同一基线上记下 Range、执行次数和分类反例。全部拦下会在六个可读原件用例失败，永远放行会在禁止托管的 404 用例失败。

## 5. 归属

这一整块：生成的派发证据与运行结局。
归谁：electron/productionRun/submissionOutbox.ts:368 与 electron/shared/generationFailure.ts:328 分别拥有安全重派和错误类别。素材可读性由 electron/assets/providerMediaFetch.ts:104 判定。
我们哪里绕开了它：src/workbench/generationCanvas/runner/generationRunController.ts:222 从文案重新执行；electron/tasks/taskIpcGuard.ts:8 与 electron/productionRun/productionGenerationSubmission.ts:497 未把原判定交给下游。

## 6. 取舍

逐条添加错误文案不能跨语言或外壳。给整台机器加重试上限会挡住其他镜和新的授权。独立复盘建议将付费媒体重派交回主进程，保留显式重试、文本暂态重试及免费查询。参考图优先沿用授权通道，过去别的链接的失败以及素材种类估算的寿命都不能独自拒绝本次可用输入。IPC 读取实际供应商失败，保留最外层确证的未派发或结果未知。

## 7. 决策

文件近 14 天修复数分别为 run controller 3、assetLocalization 2、generationTelemetry 2、taskApi 2、generationFailure 2。前三者的热点决定交协调，后两者没有必要为本次重写。安全重派与归因应在事实拥有者处完成。能减少的是可复现的重复和误拦，历史计数无法由本地测试改写。
