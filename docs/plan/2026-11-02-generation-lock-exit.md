# 批量出图不卡死：出口、不误杀、不锁表、本机拒绝单独一类

协调会话写，2026-11-02。四类（花钱 + 长跑）。方向已由用户点头（用户 11-02：「按这个走」），这张卡是实现合同和验收合同。

## ★0 先查别人

1. Kubernetes client-go workqueue（v0.37.2 `util/workqueue/doc.go:17-27`）、controller-runtime（`pkg/reconcile/reconcile.go:102-126`）· 队列只存 key，同一 key 不并发处理，重复加入只处理一次，处理时读当前状态 · 影响 D1、D2：提交前只比这一镜自己；同一节点只排一次，单发开跑时把它从别的批次里拿掉。
2. LiteLLM Router（https://docs.litellm.ai/docs/routing）· 并发超限当场 429，不排队，在任何供应商调用之前抛出 · 影响 D2：并发 429 等于没被处理，不计入「连错几次就停」的刹车。
3. AWS Builders' Library「Making retries safe with idempotent APIs」（https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/ ，2026-11-02 实抓）· 超时或丢回复后客户端不知道结果，直接重试可能产生重复；要安全就得服务端接受调用方的唯一请求号 · 影响 D3：供应商不给这个保证，所以不自动重发，只给人核对后重发的出口，卡上明说可能重复扣费。
4. Temporal 文档（`design-patterns/delayed-retry`、`encyclopedia/detecting-activity-failures`）· 排队超时和执行超时分开，幂等由被调服务兑现 · 影响 D3：同上；本机拒绝和执行失败分开记（D4）。
5. InvokeAI（main@0e67338 `session_queue_common.py:216`、`session_processor_default.py:1278-1291`）· 队列每项一个状态，暂停是处理器的显式开关，和各项状态是两个对象 · 影响 D2：批次暂停不等于整张表不能动。

## ★1 用户怎么用

**场景一（提交没回执）。** 当一张图发出去、服务商没回话，卡片说「可能已被收下」。我想核对完就重新生成一次，不用猜该去哪点。
1. 卡片写「这一镜可能已被服务商收下，结果没法确认」。主按钮「在任务中心查看」，次按钮「我核对过了，重新生成」。
2. 点次按钮，卡里展开确认（文案不变，明说可能重复提交）。
3. 点继续，释放这一镜，真的再发一次，卡片进入生成中。这张确认条就是确认，单张不再弹付费卡（用户 2026-09-25：自己点的单个生成不弹窗，判据 `spendConfirmationRequirement`）。
4. 点取消，确认条收起，什么都没变：没放行、没发，卡片还是原来的错误。
5. 在任务中心点同一个按钮，结果一样：任务中心自己的确认框点继续后，放行、回到生成页、选中节点、真的再发一次。

**场景二（没核对就再点 ↑）。** 不算一次新的生成失败，还是同一张卡、同样两个按钮。

**场景三（批量撞并发）。** 8 张资产图、并发 6，中转回 429 `concurrency limit exceeded`。
1. 撞限的卡变红，主按钮「重试」，其它卡继续跑。批次不暂停，不弹刹车提示。
2. 其它卡还在跑时，点失败卡的重试，马上就发（单张不弹卡）。

**场景四（一键出资产和镜头）。** 分镜表点「整批生成」，一张确认卡里有 2 张资产卡和 3 个镜头。
1. 资产卡一张张出图，第二张不会因为第一张补了引用而失败。
2. 资产出完，3 个镜头接着发，提示词带上 @，参考框里有资产图。不用再点一次，也不看到 `Storyboard target changed`。

**场景五（批量跑着时改了一镜）。** 镜 3 还在排队，我发现错别字，改了。
1. 轮到镜 3 时不发。卡片写「这一镜的内容改过了，这次没发」，主按钮「重新生成」。
2. 其它镜照发。不暂停，不算生成失败。

**场景六（还在排队的卡被单独点了）。** 整批跑着，镜 5 还没轮到，我点了它的生成。
1. 立刻发，批次轮到时不再发。这一张总共只发一次。

**场景七（重试被在途锁拒）。** 上一单还没回来，卡片说「这个节点还在生成」，主按钮是查看任务，不再摆一个点了还会被拒的「重试」。

**场景八（三个生产页面，用户 11-02：「现在生产的3个页面 应该逻辑要一致且都要测试」）。** 同一批卡可能在分镜方案、画布、生成列表（画布 ↔ 列表切换）任何一页上被看到、被点。我在哪一页都看到同一句话，都走得出去，切到别的页状态也一样。
1. 在列表页看到一张失败的卡：写的是人话，不是 `Error invoking remote method…`。点开大详情，就是画布上那张错误卡，按钮一样。
2. 排队中的卡在列表页不写「未生成」，写排队中。
3. 分镜方案页的资产卡和镜头行结果不明时，不是没按钮（资产卡现状），也不是点了还会被拒的「重试」（镜头行现状），是和画布一样的出口。

**不做什么：** 不做按连接限流、自动排队、读 Retry-After（下一版第一件）；不改「结果不明不自动重发」的规则；不修没有任务号的 submitting 僵尸（要写盘失败才出现）；不改页面布局；不新画卡片（列表大详情放的就是画布那张错误卡）；分镜页的失败面只修「重试 / 出口 / 查看任务」三种，「换个模型」「去模型接入」这类动作这一刀不搬进窄格子，那里的原因和悬停说明照旧。

**已知坑：** 连续 3 次真失败（不是撞并发）还是会暂停，这时「整批生成」「放到画布」两个按钮要等任务面板里继续或取消，每张卡自己的按钮不受影响。撞并发本身还会报错，要用户自己重试。

### ★1b 连带界面

节点错误卡；分镜表的行和资产卡按钮；生成列表的小卡、大详情、左窄列；任务中心那一笔（来源不再写「外部客户端」，写画布）；刹车提示（撞并发不再弹）；批量汇总里的「重试失败的 N 个」（不再被旧快照拒）；Agent 回执读同一份 kind，核对 `src/workbench/ai/v4/spendCardFailure.ts`、`src/workbench/ai/lane/laneCommandFailure.ts:208,210`、`src/workbench/observability/narrate.ts:218` 这几处按 `kind === 'unknown'` 判的地方；遥测和雷达（新 errorType）；模型健康（本机拒绝不再记成模型失败）。

### ★1c 老用户

Run、节点、队列、方案的格式都不变。0.24.0 留在盘上的 `submission_unknown` 画布 Run，升级后卡片上就能走出口。0.24.0 留下的节点错误文本是字符串，重新分类后按新 kind 走。没有迁移，没有并行旧路径。旧版本上来的事件 errorType 还是 unknown，雷达两边都认。用 v0.24.0 代码真实产生的 Run 快照跑一遍出口（按 `tests/fixtures/old-user-data/README.md` 的办法，不手写形状）。

## ★2 谁说了算

- 这张卡这一刻能不能发：主进程 `assertNodeIdle`（`electron/capabilityCore/appIntegrationCanvasShot.ts`）和 Run 账本。
- 这个节点被哪一笔结果不明的 Run 占着：同一个主进程、同一份读法（`openCanvasRuns` + `blockingReason`）。锁和出口读同一份，锁得住就放得开。渲染层不从 `run.id` 推。
- 同一节点只发一次：`runGenerationNode`（唯一提交咽喉）开跑时把它从别的批次的排队里拿掉。
- 已批准的节点输入变没变：`assertApprovedInputs`。
- 方案这一镜变没变：新的分镜动作守卫（D1），编辑器和 Agent 共用，取代现在的两份比对。
- 这条失败算不算刹车：`generationRunController.ts` 里一个函数按 kind 判，只此一处。
- 这条错误是哪一类：`classifyError.ts`；动作表：`narrate.ts`；遥测只读 kind。
- 失败了下一步是什么：一个纯函数（D5），画布错误卡、列表、分镜三处都读它，不各判一遍。
- 这个节点在不在排队：`generationQueueStore`。批量入口的「在忙」（`isGenerationNodeBusy`）和列表卡的显示都读它。
- 证据：`node scripts/door-map.mjs assertAuthorCurrent`、`door-map.mjs nodeIdOfJob`、`door-map.mjs releaseUnknownSubmission`、`door-map.mjs autoReferencePlan`、`door-map.mjs NodeErrorReport`、`door-map.mjs storyboardFailureCopy`，结果写进 PR。

## ★3 一致与复用

- 「我核对过了」的确认条和按钮：`NodeErrorReport.tsx` 现成的，制作 Run 的镜已在用，不新画。
- 释放：`releaseUnknownSubmission` / `job.reconcile`（`user_checked_abandon`，主进程盖真人手势章），不新开命令。
- 新查询走现有层次：`appIntegrationCanvasShot.ts` → `canvasShotRunApi.ts` → `appIntegration.ts` → `taskIpcHandlers.ts`（`assertTrustedSender`，同 `canvas-release`）→ `preload/runtimeBridge.ts` → `desktop/bridge.ts` → `api/taskApi.ts`。`canvasRunIdFor` 不动，渲染层不碰它。
- 补引用：`autoReferencePlan` 是唯一 owner，编辑器 effect 和批量阶段切换调同一个函数。
- 取消排队：`cancelEntry` 现成（收回出价、批次 worker 闸二 `isEntryCancelled` 会跳过）。
- 文案：`shotClaimed.needsReconcile`、`submissionUnknown`、`nodeInFlight`、`releaseRegenerate` 复用；新 kind 补一条缺省词条，内容变了补一条（zh/en）。
- 发起生成本来就是一个口：画布 ↑ 和列表大详情 ↑ 都是 `startGenerationFromComposer`；画布分组和列表分区头都是 `runGroupGenerate`；分镜整批和单卡最后都到 `runGenerationNode`。所以 D1、D2、D4 三页自动一致。不一致的只有「失败之后看到什么、能点什么」，D5 只修这一处。
- 列表大详情的错误卡和可找回卡：就是 `NodeErrorReport`、`NodeRecoverableReport`，从 `BaseGenerationNode.tsx:298-324` 抽出来两边放同一个，不复制。
- 分镜窄格子的确认：`AnchoredPopover`（设计系统现成的）里放同一段文案和同一条 `DecisionBar`。

## ★4 全状态

| 状态 | 用户看到 |
|---|---|
| 结果不明 | 现有卡片；主「在任务中心查看」，次「我核对过了，重新生成」 |
| 结果不明时又点 ↑ | 同一张卡，同样两个按钮 |
| 确认条展开 | 现有文案，「继续」「取消」 |
| 释放中 | 按钮禁用 |
| 释放失败 | 现有 `releaseFailed` 提示，卡还在，可再点 |
| 确认条点了取消 | 什么都没变：没放行、没发，卡片还是原错误，↑ 还是被拒 |
| 放行后碰上首次托管告知卡（会弹的那种）点了取消 | 卡片回到原错误；已放行，↑ 能发 |
| 还在生成被拒 | 「这个节点还在生成」，查看任务 |
| 撞并发 | 卡片红，重试；批次继续 |
| 整批期间点失败卡重试 | 立刻发（单张不弹卡）；只发这一张 |
| 排队中的卡被单独点 | 立刻发（单张不弹卡）；批次不再发 |
| 整批确认后、镜头还没进队列（资产在跑）时，这一镜被单独点了（分镜行、画布 ↑、列表 ↑、组头都算） | 立刻发（单张不弹卡）；批次第二阶段不再发这一镜，其余镜照发。单点的结果不被顶掉 |
| 批量跑着时改了排队中的一镜 | 这一镜不发，一句人话，主按钮重新生成；其它照发 |
| 批量确认卡开着时别的镜被补引用 | 什么都不发生，确认后正常发 |
| 批量确认卡开着时这一镜本身变了 | 不发，一句人话（zh/en），可再点，不露 `Storyboard target changed` |
| 整批确认后、资产还在跑时用户改了这批某一镜的模型 / 清晰度等花钱口径 | 资产完成后弹正常的批量确认卡，单子和报价是当前的；取消不发，资产留着；确认才发 |
| 列表小卡失败 | 红底 + 分类后的原因，没有按钮，点开大详情 |
| 列表大详情失败 / 可找回 | 和画布同一张卡、同样按钮 |
| 列表卡排队中 | 写排队中，不写「未生成」；左窄列同样 |
| 分镜资产卡 / 镜头行：能重试 | 「重试」；重试结束（包括被拒、又失败）按钮回到可点 |
| 分镜资产卡 / 镜头行：结果不明 | 「我核对过了，重新生成」+「查看任务」；点前者在弹层里确认，文案同画布 |
| 分镜资产卡 / 镜头行：本机拒绝 | 没有「重试」；「查看任务」；内容改过和升级前同意过这两条是重新生成 |
| 空 / 加载 / 能力不可用 | 不变 |

## 5 中途表

| 时刻 | 停 | 关窗 / 重启 | 断网 | 连点 |
|---|---|---|---|---|
| 结果不明，还没点出口 | 不变 | Run 在盘上，重启后同一张卡、同样按钮 | 不影响，本地操作 | 只展开一次 |
| 释放中 | 不可停 | 没写完 = 还锁着，再点；写完 = 已放开 | 不影响 | `releaseBusy` 挡 |
| 批量确认卡开着 | 取消 = 不发 | 不发 | 确认后走正常报错 | 只一张 |
| 撞并发后重试失败卡 | 现有停 | 现有恢复 | 现有分类 | 按行去重 |
| 排队的卡被单独点 | 现有停 | 队列是内存态，重启后都没了；出价按现有规则收回 | 现有分类 | 按行去重，总共只发一次 |
| 资产阶段结束、镜头阶段开始前 | 现有停 | 单点过的镜已经落节点、发过；批次第二阶段发之前逐镜核对，确认之后别处发过的不再发 | 不影响 | 整批按钮仍互斥，行上动作不互斥 |

## 6 外部数据与失败

中转说法不固定：刹车只看分类结果 `quota`，不再匹配一句新的原话。`input` / `server` / `network` 照旧计入刹车。`quota` 里有余额不足：这类被拒不花钱，不踩刹车也不多扣。

## ★7 性能

新增操作：列表每张卡多读一次队列（批量跑着时队列一直在变）。最坏规模：列表约 190 张卡，队列 20 个条目连续结算。预算：沿用「操作到可见反馈 ≤100ms」；队列变一次不重渲染无关的卡。场景 id 和基线见报告。

## 8 真实条件

- Mac 中英真窗走查（假服务商）：要过。
- Windows：随 0.24.0 → 0.24.1 真机升级一起跑，PR 里写「未验证」。
- 亮色主题：拍一张。
- 真实场景复现（用户 11-02：「修好之后 要用真实场景复现一次」）：见 ★9 的「真实场景复现」。协调跑一次，实现线不跑付费。

## 拍板图

不适用，`pure-bugfix`：复用现有确认条、按钮和错误卡，不画新元素。次按钮原本只有制作 Run 的镜有，这次画布节点也有；错误卡原本只有画布有，这次列表大详情也有；分镜窄格子放同样的字。协调看三页中英截图。

## ★9 验收与回滚

### 实现范围

**D1 不误杀（换：整份方案比对 → 只比这一镜）。**

事实：整份方案比对是 2026-09-20 加的，防「内容改了还按旧的花钱」。2026-10-05 加了自动引用，系统自己写方案也会触发它，这才是误杀的来源。这道比对在编辑器（`StoryboardPlanEditor.tsx:369-383`）和 Agent（`storyboardPresent.ts:48,54-57`）各有一份，用在三个地方：确认前、落节点前、运行路径每次尝试（`generationRunController.ts:317`）。保护本身要留：用户改了这一镜，这一镜不能按旧内容花钱。只把范围缩准。

1. 在 `src/workbench/creation/storyboard/exec/` 建一个小 owner（分镜动作守卫），编辑器和 Agent 共用，两份旧比对同提交删掉。它知道这次动作的目标（哪些参考卡、哪些镜头）。
2. 确认前和落节点前（`assertCurrent`）：比「方案全局字段 + 全部参考卡 + 目标镜头」，别的镜头改了不算。项目身份检查不变。
3. 运行路径：`assertAuthorCurrent` 带上节点号（形状和 `assertApprovedInputs(graph, executingNodeId)` 一样），只比这个节点对应的那一行（映射走 `storyboardNodeBinding.ts`，首帧节点算它的镜头，找不到行的节点直接过）。变了只这一张失败，其余继续，错误归 D4。
4. 阶段切换：`runStoryboardBatch` 的参考卡阶段结束后（`storyboardRowActions.ts:533` 之后），以及 `storyboardPresent.ts:67-73` 的参考卡循环结束后，按顺序做：用 `autoReferencePlan` 把刚出的图补进方案并写回 → 重读方案 → 重新取比对基线 → 按 shotId 用 `deriveStoryboardRowRuntimes` 重算要跑的行（模式可能被切过，不能拿旧行）→ `ctx.plan` 换新。镜头被删了就跳过。这一步要自己显式调，不能靠编辑器 effect：`await` 续上的时机和 React 提交谁先谁后不确定，而且 Agent 路径编辑器可能没挂。effect 之后再跑是空操作（幂等，要测）。把编辑器 effect（`StoryboardPlanEditor.tsx:249-255`）里凑 ready / settled 的逻辑抽成一个函数，两边共用。
5. 自动引用不碰排队中的：方案侧 `settled`（`StoryboardPlanEditor.tsx:253`）算上队列里未结算的行；画布侧 `planCanvasAutoReference`（`canvasAutoReference.ts:68`）现在的 `status === 'queued'` 看不到队列（队列不写 `node.status`，见 `generationQueueStore.ts` 文件头），改成查队列未结算条目。
6. 「重试失败的 N 个」（`batchPlanPreview.ts:336-338`）不再带旧基线，改成 `{ concurrency, initiator: 'user' }`。
7. 类型同步（`generationRunController.ts:98-99`、`:115`），透传点 `:505`、`:595`、`:635`、`batchPlanPreview.ts:251,267,292`。确认前的 `:577`、`:632`、`batchPlanPreview.ts:216` 留着，用第 2 条的窄比对。
8. **已批准输入也只比这一个节点（协调 11-02 裁决）：** `captureApprovedGenerationInputs`（`runProjectDelivery.ts:150`）现在把整批节点算成一个 token，删改一张会挡住别的卡。改成按 `executingNodeId` 只比这一个节点自己的 token。prompt、引用、模型、参数、模式、变体、对白、入边、解析后的引用这些保护一项都不动；别的节点变了只有影响到这个节点的解析结果才拦。A6 必须还过，A9、E8 必须变绿。
9. 现有测试里钉了旧语义的（`confirmedProjectContinuation.test.ts`、`runProjectDelivery.background.test.ts`、`storyboardPresent.test.ts`、`storyboardBatchLanding.test.ts`、`batchPlanPreview.test.ts`）：改成新语义，逐条在报告里写为什么改、保护还在哪。不许只为变绿删断言。

**D2 不锁表。**
- 刹车：`generationRunController.ts:428` 那条 `markSettled` 的 `countsTowardBrake` 由一个函数按 `classifyGenerationError(raw).kind` 判，`quota`、`local-refusal` 不计。
- 分镜表：`runAction` 的 `busy` 只给整表动作（整批、放到画布），整表动作之间照旧互斥。单卡动作（`generateAnchorCard`、`regenerateAnchorCard`、`regenerateShotRow`、`rerunShotRowWithFreshRefs` 和单镜生成）按行去重。行上按钮的 `disabled` 跟着改。
- **防重复扣费，放在咽喉：** `runGenerationNode` 里 `markRunning` 之前（`generationRunController.ts:282-284`），这个节点在别的批次里还是 `queued` 的条目，用 `cancelEntry` 取消。覆盖画布 ↑、单卡、Agent、批次重叠，不在各调用方各写一遍。主进程 `assertNodeIdle` 明确放过「批量卡上同意了、还没轮到的那一镜」（`appIntegrationCanvasShot.ts:301,309`），所以这一道不做就会重复扣费。

**D3 出口。**
- `nodeIdOfJob` 读 `run.origin?.nodeId`（任务中心放行后真的走 `confirmAndRunNode`）。
- 事实（实现线第一次开工时查出，已有红灯）：`run-started` 在主进程准入之前就把新运行记录写进节点（`generationRunController.ts:292,309`），再点 ↑ 被拒后 `runs[0].id` 指向一个不存在的 Run。所以不能从 `run.id` 推出要放行哪一笔。运行历史不改，那条被拒的记录留着。
- 主进程加一个只读查询：`canvasUnknownRuns({ projectId, nodeId })` 返回 `[{ runId, jobId }]`，读法和 `assertNodeIdle` 一样：`openCanvasRuns(projectRoot, nodeId)` 逐个读 Run，`blockingReason` 是 `needs_reconcile` 的算（job 取 `submission_unknown` 或 `reconciling` 的那个）。0.24.0 留下的也在这个索引里，否则它当初也锁不住。
- 节点错误卡：制作 Run 的镜照旧（`productionMetaOf` 给 runId）。画布节点不用预先知道 Run：`release-regenerate`（`NodeErrorReport.tsx:256`）有 nodeId 就可用；点「继续」时问主进程，把列表里每一笔走 `releaseUnknownSubmission`，然后 `confirmAndRunNode`。主进程说这个节点没有占用（已经放开了），也照样走 `confirmAndRunNode`，不留死路。放行失败走现有 `releaseFailed`。
- 不改 `productionShotIdForNode`：画布路径不再经过它。
- `classifyError` 的 `needs_reconcile`（`:745-757`）：`primary: 'reconcile', secondary: 'release-regenerate'`，和 `submission-unknown` 同一组。
- 放行后错误卡换成生成中。要不要弹卡只由 `spendConfirmationRequirement` 判，这里不多弹也不绕开：单张不弹，首次托管告知照弹，告知卡点取消回原错误，↑ 能发。`releaseUnknownSubmission.ts` 和 `useProductionStatus.ts` 里「走付费确认卡」的旧注释改成实话。
- 任务中心把画布 Run 的来源写对。

**D4 本机拒绝单独一类。**
- `GenerationErrorKind` 加 `local-refusal`。`classifyError` 里 `node_generation_in_flight`（`:713`）、`canvas_consent_predates_upgrade`（`:724`）、`director_preview_blocked`（`:735`）、`production_shot_claimed`（`:745`）改成这个 kind，替掉原来的 `unknown`，不加新分支。再认 `generation_input_changed`、`storyboard_content_conflict`、`Storyboard target changed`：文案「这一镜的内容改过了，这次没发」（zh/en）。主进程的其它本机拒绝码列在报告里，分类器已认识的一并改。
- `narrate.ts` 动作表：缺省 `{ primary: 'view-task', secondary: null }`，`VENDOR_SIDE_BY_KIND` false。在途被拒主按钮不再是重试。`canvas_consent_predates_upgrade` 和内容变了这两条能重新生成。
- `generationRunController.ts:422` 的 `recordNodeModelFailure`：`local-refusal` 不记，模型没挂。
- 遥测自动带上；`scripts/` 里雷达版本健康的失败率不计 `local-refusal`（只认这个完整字符串），「疑似本地拒绝」把它算进去，测试覆盖。

**D5 三个页面同一套（换：各判各的 → 一个判据、一张卡）。**

事实（协调 11-02 读代码核对，实现时再核一遍）：
- 列表小卡和大详情失败时直接显示 `node.error` 原文（`GenerationListParts.tsx:110`），用户会看到 `Error invoking remote method…`。
- `NodeErrorReport`、`NodeRecoverableReport` 只有 `BaseGenerationNode.tsx:299,316` 在放，列表大详情没有。在列表页结果不明的卡：↑ 被拒，没有出口；可找回的卡：没有免费取回的按钮。
- 列表卡不看队列：`isDraftNode`（`GenerationListCard.tsx:136`）只看 `node.status`，队列不写它，排队中的卡写「未生成」，左窄列同样（`GenerationListDetail.tsx:65`）。画布和分镜行用 `NodeGenerationStatus` 是看得到的。
- 分镜镜头行：`StoryboardFrameActions.tsx:98` 只要失败就摆「重试」，不读 `canRetry`。资产卡（`StoryboardAnchorRow.tsx:374`）读，但读出来不能重试就什么按钮都没有，是死路。
- 分镜镜头行的 `retrying`（`StoryboardFrameActions.tsx:86,103`）只会变 true，从不复位：重试被拒或又失败后，只要这一行没被卸载，按钮一直写「生成中」且点不了。`ShotBusyStates.test.ts:37` 钉的是源码字面量，保护不到这个。
- 「下一步」判了两遍：`NodeErrorReport` 算 `withoutTask` 和主次动作，`storyboardFailureCopy` 算 `canRetry`，两边不读同一个结果。
- `isGenerationNodeBusy`（`canvasProductionScope.ts:41`）看不到队列，画布分组和列表分区头的「生成全部」会把排队中的卡默认勾上、算进价钱（咽喉有 D2 兜底，不会多扣，但卡上写错了）。

要做的：
1. 一个判据：抽一个纯函数（放 `src/workbench/observability/`），输入错误文本和这次运行记录，输出 `{ kind, reason, hint, primary, secondary, canRetry }`，把 `withoutTask` 也算在里面。`NodeErrorReport`、`storyboardFailureCopy`、列表小卡都读它。两处旧判断同提交删掉。
2. 一张卡：`BaseGenerationNode.tsx:298-324` 抽成一个组件（含重试走哪条：`productionRetry ?? localStepRedoOf ?? confirmAndRunNode`，这段也别留两份），`BaseGenerationNode` 和列表大详情放同一个。大详情放在预览框里（`DetailPreview`，够大）；「换个模型」现在靠 `closest('[data-node-id]')` 找模型芯片，大详情里也要找得到，要测。
3. 一个放行动作：D3 的放行 + `confirmAndRunNode` 收成一个函数，连同确认中、释放中、释放失败三个状态，`NodeErrorReport` 和分镜共用。
4. 分镜失败面：资产卡和镜头行用同一个小组件，读第 1 条的结果。`canRetry` → 「重试」；有放行 → 「我核对过了，重新生成」，点开 `AnchoredPopover` 确认；`reconcile` / `view-task` → 「查看任务」，和错误卡同一个去处。失败面上按钮不许一个都没有。窄格子里中英都不能溢出，截图看。行上要知道是哪个节点失败（`deriveShotRowExec` 现在只给 `errorMessage`，首帧节点也可能是失败的那个，比照 `recoverableNode` 给出来）。
5. `retrying` 换成 D2 的按行去重状态，不再有一份只会变 true 的本地状态；`ShotBusyStates.test.ts` 那条改成行为测试。
6. 列表小卡：失败写第 1 条的 `reason`，不再写原文。排队中不算草稿，写排队中（文案取现有的），左窄列同样。列表卡订阅队列用布尔选择器，别的条目变了这张卡不重渲染（性能，用户拍板过的维度，报告写一句）。
7. `isGenerationNodeBusy` 看队列未结算条目，一处改，三页的批量入口都受益。
8. 列全仓把 `node.error`、`errorMessage` 显示给用户的地方，逐处写走没走第 1 条（报告里一张表），这就是回答「同类问题还能从另一个页面回来吗」。

### 验收清单（实现线自验，验收线只核它）

入口：画布单张、框选多张、分镜单卡、分镜整批、任务中心放行、Agent 交接（`storyboardPresent`）、**列表分区头「生成全部」、列表大详情 ↑**。用假服务商数 POST 次数，测试只走生产入口。

| # | 场景 | 必须 |
|---|---|---|
| A1 | 8 张、并发 6，4 个 429 同时回来 | 批次不暂停、Promise 结束、无刹车提示、其余 4 张都发了 |
| A2 | 连续 3 次 `server` 失败 | 刹车照旧踩下（保护没丢） |
| A3 | 连续 3 次本机拒绝 | 不踩刹车；模型健康不记失败 |
| A4 | 分镜整批，编辑器真挂着：2 张资产卡 + 3 个镜头，提示词写了资产名 | 卡只弹一次；资产先、镜头后，5 张全发；镜头发出去的提示词带 @、参考有资产图；全程无方案变了的报错 |
| A5 | 同上走 Agent，编辑器挂着和没挂各一次 | 同样不误杀；镜头用补过引用的新方案 |
| A6 | 提交前节点的提示词 / 参考真的被改了 | `assertApprovedInputs` 仍然拦，不发 |
| A7 | 批次排队中资产落地：方案侧和画布侧各一例 | 排队的镜不被自动引用改，不报 `generation_input_changed` |
| A8 | 批量失败后点「重试失败的 N 个」（方案已被补过引用） | 能走到付费确认 |
| A9 | 批量跑着时用户改了排队中镜 3 的文字 | 只有镜 3 不发，卡片说人话、主按钮重新生成；其余照发；不计刹车（保护还在） |
| A10 | 付费确认开着时另一张资产落地：只补了别的镜 / 补了这一镜 | 前者确认后正常发；后者不发、一句人话、再点能发 |
| A11 | 整批确认后、资产还在跑时：①把选中的镜 2 切到别的模型或清晰度 ②只改镜 2 的提示词 ③什么都不改，两张资产反序完成 ④只改没勾选的镜 | ①资产完成后弹正常批量确认卡，单子和报价是当前的；取消 POST 不增、资产留着；确认才发，请求里是新模型。②③④ 不多弹，全程一张卡；②发最新提示词。只剩一张且用户自己点的照旧不弹（用户 09-25）。一处都不多扣 |
| B1 | 整批跑着，点已失败卡的重试 | 不弹卡，POST +1，其它卡不受影响 |
| B2 | 批次暂停，点已失败卡的重试 | 能发；恢复批次后 POST 不多一次 |
| B3 | 卡排在批次里没轮到时单独点，分别走分镜单卡和画布 ↑ | 立刻发，批次不再发，这个节点 POST 恰好 1，批次那份出价收回 |
| B6 | 整批确认后、资产还在跑时单独发某一镜：入口 × 分镜单点、失败行重试、画布 ↑、列表 ↑、组头；那一发的结局 × 完成、在飞、失败、可找回、完成后又锁定 | 批次第二阶段不再发这一镜，这个节点 POST 恰好 1，结果不被顶掉，锁定还在；其余镜照发。选中已生成的镜重跑、确认过的，第二阶段照发（不许吞掉） |
| B7 | Agent 改过一镜（方案里带 undefined 字段）后点这一镜生成；方案从磁盘读回和内存比 | 正常发，不报错不假冲突；真的改过才拦 |
| B4 | 同一张卡连点两次单卡动作 | 只发一次 |
| B5 | 整批跑着再点整批 / 放到画布 | 还是挡（整表动作互斥不变） |
| C1 | 503 无拒单证据 → 结果不明 | 卡片两个按钮；↑ 被拒不增加 POST |
| C2 | 卡片点「我核对过了」→ 继续；分别走没再点 ↑ 和再点 ↑ 被拒之后两条路 | POST 恰好 +1，出图，错误卡消失；被拒那条运行记录还在历史里 |
| C3 | 同上，确认条点取消 | POST 不变；没放行；回原错误；再点 ↑ 还是被拒；再点「我核对过了」还能走 |
| C4 | 任务中心走同一条路 | 确认框点继续后回到生成页、选中节点；POST +1 |
| C5 | 制作 Run 的镜 | 行为不变（回归） |
| C6 | 重启后再走 C2 | 通 |
| C7 | v0.24.0 产生的结果不明 Run | 升级后 C2 走通 |
| D1 | 全部本机拒绝码 | kind 都是 `local-refusal`，遥测 errorType 一致 |
| D2 | 在途被拒 | 主按钮是查看任务（可找回时是找回），不是重试 |
| D3 | 雷达：混入 `local-refusal` 的事件 | 版本健康失败率不计；`unknown` 仍按原规则 |

**三页矩阵：下面每一行在分镜方案、画布、列表三页各走一遍，一页不过就是这一行不过。**

| # | 情况 | 分镜方案走哪 | 画布走哪 | 列表走哪 | 必须 |
|---|---|---|---|---|---|
| E1 | 批量发 | 整批生成 | 框选 / 分组「生成全部」 | 分区头「生成全部」 | 确认卡一张；每张 POST 恰好 1 |
| E2 | 撞并发 429 | 资产卡、镜头行 | 节点错误卡 | 小卡、大详情 | 同一句人话，页面上找不到 `Error invoking remote method`；其它卡继续；没有东西被锁 |
| E3 | 重试失败卡 | 行上重试 | 错误卡重试 | 大详情错误卡重试 | 不弹卡，POST +1 → 出图；重试被拒或又失败后按钮回到可点，不一直转 |
| E4 | 排队中的卡 | 行状态、行上生成 | 节点状态、↑ | 小卡、左窄列、大详情 ↑ | 写排队中，不写「未生成」；单独点 → 立刻发、批次不再发、POST 恰好 1；再点批量入口不默认勾它、不算价钱 |
| E5 | 在途被拒 | 行、资产卡 | 错误卡 | 大详情 | 没有「重试」，有查看任务 |
| E6 | 结果不明 | 行、资产卡 | 错误卡 | 大详情 | 我核对过了 → 确认条继续 → POST +1 → 出图；确认条取消什么都没变；文字三页一样 |
| E7 | 可找回 | 行、资产卡 | 可找回卡 | 大详情 | 都有免费取回；POST 不增加 |
| E8 | 排队中改了内容 | 改镜头文字 | 改节点提示词 | 大详情改提示词 | 只这张不发，同一句人话，别的照发 |
| E9 | 切页面 | ↔ | ↔ | ↔ | 同一节点三页同一状态；在一页走完出口，另外两页跟着变，不用重启 |
| E10 | 关掉重开 | 看 + 走出口 | 看 + 走出口 | 看 + 走出口 | 三页同一状态，E6 通，用真实 Run 文件 |

再加一个表驱动测试：每种 `GenerationErrorKind` × 五个失败面（画布错误卡、列表大详情、列表小卡、分镜镜头行、分镜资产卡）：原因同一句；能不能重试同一个答案；除列表小卡外按钮不为零。

### 反例（改坏必红，逐条贴红色结果）

- 运行路径改回比整份方案 → A4 红。
- 去掉阶段切换的显式补引用和重读 → A4 红（镜头不带 @，或报方案变了）。
- 运行路径整个不比（把保护删光） → A9 红。
- `quota` 计入刹车 → A1 红。
- `runGenerationNode` 不取消别的批次的排队条目 → B3 红。
- `nodeIdOfJob` 不读 `origin` → C4 红。
- `release-regenerate` 只看 `productionMetaOf` → C2 红。
- 放行目标改回从 `run.id` 推 → C2 第二条路红。
- `local-refusal` 动作改回重试 → D2 红。
- 列表大详情不放错误卡 → E3、E6 列表那一页红。
- 列表小卡写回 `node.error` → E2 列表那一页红。
- 列表卡不看队列 → E4 列表那一页红。
- `isGenerationNodeBusy` 不看队列 → E4 批量入口红。
- 镜头行不读 `canRetry` → E5 分镜那一页红。
- 资产卡不能重试时不给按钮 → E6 分镜那一页红。
- `retrying` 只变 true → E3 分镜那一页红。

### 真窗走查

新增 `tests/ux/generation-lock-exit.walk.mjs`，假服务商，隔离资料目录，中英都跑：
- C2 全程（截：结果不明的卡、确认条、生成中、出图）。
- A1 + B1（截：撞限的卡、其它卡在跑、点重试后这张进入生成中）。
- A4（真编辑器挂着；截：确认卡、资产出图、镜头行带 @、全部出图）。
- E2、E4、E6 三页各截一张（分镜资产卡、分镜镜头行、画布节点、列表小卡、列表大详情、列表左窄列），同一节点切页面前后各一张（E9）。
- 亮色各拍一张结果不明的卡。

### 真实场景复现

走的是用户报的那条路（把剧本给 Agent 生成分镜 → 点生成资产图 → 中转报并发上限 → 卡住 → 回来还卡 → 重启），用户 11-02 又说清了范围：「1.在我们的分镜方案那里创建批量的东西 然后批量生产 2.在画布那里 然后观察是不是会被锁定什么的」「现在生产的3个页面 应该逻辑要一致且都要测试」。走查过了不算这一条过。

新增 `tests/ux/generation-lock-exit-real.paid.mjs`（按 `tests/ux/_paidRun.mjs` 的写法，`buildMarkers` 带修复里的字面量）和同一脚本的免费演练 `tests/ux/generation-lock-exit-real.rehearsal.walk.mjs`（假服务商，写法参照 `tests/ux/run-retrieval-recovery-real.rehearsal.walk.mjs`）。

共同条件：真应用，隔离副本。中转的上限：真实 Key 所在的中转不一定撞得到，所以在 Nomi 和中转之间放一个本机限流代理：同时只放 2 个，超出的回和用户报错同样的 429 `concurrency limit exceeded; too many simultaneous requests`，其余原样转发到真实图片模型。**只有「上限」和下面「掐回复」这两处是模拟的**，报告里明写。把真实连接指到本机代理这一步怎么做，实现线定（隔离副本里改目录地址或测试专用入口都行，不许进生产路径）；做不到就写清卡在哪，这一条停下，其余继续。全程每秒探一次窗口响应（`webContents.executeJavaScript` 或页面心跳），记下最长无响应时长；用户说的「卡」可能是整个窗口冻结，这一项至今没复现，这里专门量；超过 2 秒写进报告，附当时在做什么。

**第一段 · 分镜方案（批量创建，批量生产）。**
1. 一段短剧本交给 Agent，用真文本模型出分镜方案，2 张资产卡 + 3 个镜头，镜头也用图片模型，不用视频。
2. 分镜表点「整批生成」，确认一次。撞限的卡变红，表没锁；点重试 → 真出图。资产出完镜头接着发，提示词带 @。
3. 代理对其中一张：真转发、真扣费，把回复掐掉，变成结果不明。在这一页走出口：我核对过了 → 继续 → 真发 → 出图。
3b. 放着不动（用户原话：「然后我就去忙去了，回来一看还是卡的」）：什么都不点，等过这条路上最长的相关定时器。实现线读代码列出有哪些（任务轮询、退避、Run 观察者、队列恢复等），写进报告，等最长的那个，最多 10 分钟。回来逐张核：没有新冒出来的错、没有假的生成中、按钮都能点。

**第二段 · 画布（看会不会被锁）。**
4. 切到画布，第一段的每张卡逐张核：状态和分镜方案一致，没有哪张被锁住。框选这些卡点生成，批量确认卡弹出来、它们都在单子上，点取消，不花钱。
5. 代理上限调成 1。框选 2 张重新生成，第二张撞限，点重试。掐掉其中一张的回复 → 再点 ↑ 被拒（代理数到的请求不增加）→ 这一页走出口 → 真发 → 出图。

**第三段 · 生成列表。**
6. 切到列表，同一批卡状态一致，没有原始报错。代理上限还是 1，分区头「生成全部」勾 2 张，第二张撞限；大详情里点重试。
7. 掐掉其中一张的回复，大详情看到和画布同样的错误卡。这一张先不处理，留给第四段。

**第四段 · 关掉重开。**
8. 关掉重开，三页各看一遍，状态一致。回到分镜方案再切一次页面，都不锁。
9. 第 7 步留下的那张，在列表大详情走出口 → 继续 → 真发 → 出图。

代理上限每段可调，第一段 2，第二、三段 1，这样不多花图也撞得到。要交的证据：免费演练定稿后**在修复前的代码上跑红**（`git worktree` 取 PR 的 merge-base，或把生产文件按字节还原后跑，红的是用户报的那几条），修复后跑绿，两份日志都留。真付费入口协调跑一次，先跑一张看真实单价，产物和收据（供应商任务号）协调贴进 PR，图片 14 张以内（第一段 6、第二段 3、第三段 3、第四段 1，留 1 张余量）。

### 回滚

整 PR 回退，无数据迁移，Run、节点、方案的格式没变。

### 证据

`git diff --stat` 对正文；上面六个 door-map 输出；D5 第 8 条那张表；反例输出；走查截图路径（协调亲眼看）；`pnpm run build` 退出码。
