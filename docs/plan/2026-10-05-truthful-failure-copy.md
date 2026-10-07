# 说真话小修：失败说明与事实对齐（设计卡 ★5 格）

1. 用户怎么用：节点上「可找回」、分镜表悬停说明、任务面板对同一镜说同一句话；MCP 请求送达后对方断开，提示先 `nomi_read` 再决定是否重试。
2. UX 思路：取回失败的镜（供应商已出片）不再借用「等待超时，上游可能出了片」。超时的镜保持原文案。
3. owner：`unretrieved` 判定只有 `electron/shared/productionShotPhase.ts` 的 `jobAwaitsRetrieval`；节点/分镜表读 `recoverableCopy.ts`，它按最新运行记录是否制作投影（`isProductionRunRecord`）选键，键取任务面板同一对。MCP 「是否送达」判据复用 `outboundDispatchEvidence`。
4. 失败：拿不出「没写出去」的证据就按「可能已执行」说（偏向不重复执行）。
9. 验收：`recoverableCopy.test.ts`（键与渲染，zh/en）、`mcpLoopbackRpcCall.test.ts`（断开 vs 拒连）。

`explicit-retry` 命令号一项：调查后未改，见交货报告（该路径无生产调用方，且另有已提交意图闸）。

## #986 遗留风险（`explicit-retry:<jobId>`）的结论
`resume(definitelyNotSubmitted)` 没有生产调用方（只有测试在调）；第二次重试回「需要对账」是已提交意图闸的设计答案（第一次重试提交的 provider.submit 意图取消不了），不是被吞；强行换号会撞上非法状态转换 `needs_attention -> submit_intent_persisted`。删除这条死路径归收敛第 3–4 步（`docs/plan/2026-10-05-engine-convergence-cut1.md`），这次不删。
不写进 #986 合同本身：根因合同门禁把任何被改动的合同当作新合同，要求其 removed_legacy_paths / regression_tests 等全部出现在同一 diff 里。
