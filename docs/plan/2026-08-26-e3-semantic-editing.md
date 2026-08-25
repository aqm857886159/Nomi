# E3 理解式剪辑分期实施计划（2026-08-26）

> 状态：实施合同；本轮只写计划，不写产品实现。
>
> E3 放在 E2 之后不是“以后再说”的附注，而是两个硬约束的结果：**贵**（VLM/转写按量计费）+ **依赖 E2 操作词汇表成熟**。规模估算后面永远附一句铁律：**超过上限必须停下复盘，不得靠继续加代码掩盖范围漂移**。

## 0. 目标、边界与代码事实

E3 只处理需要“看懂内容”的请求：审片给节奏建议、“开头收紧到 15 秒”的意图剪辑、口播/访谈清理（后者远期）。E2 是零模型调用的结构派生：排列、显式 trim/split、字幕/音乐/已声明的转场 metadata、实拍混排；E3 才能引入视觉理解或转写。两者必须共享同一 `EditPlan → Proposal → 一次 Apply → 一步 Undo` 通道，禁止另起“AI 剪辑结果”状态源。

E2 已查明的操作边界：`src/workbench/timeline/timelineEdit.ts:311-366,409-458` 有 split/trim，`timelineEdit.ts:93-169` 有移动/吸附；ripple/roll 不存在，`timelineEdit.ts:230-263` 也不会推动后续片段。字幕是 `TimelineState.textClips`（`timelineTypes.ts:48-78`），音频是独立 `audioTrack`（`timelineTypes.ts:81-90`）；`renderManifest.ts:23-27,133-143,162-194` 当前仍 `audioCodec:'none'`、`audioMode:'mute'`，不能把“预览听到”写成“导出带 BGM”。E3 不能把不存在的 ripple/roll/视觉转场放进类型、计划卡或提示词。

### 现有 `shotVerify` 能力到哪

- `electron/capabilityCore/shotVerifyOrchestrate.ts:1-18,54-109,230-320` 已有纯编排：抽帧 → VLM/多模态 judge → 解析三轴判决 → 最多 2 次定向重生；总时限默认 60 秒，失败/超时返回 skipped，不阻断已完成生成。
- `src/workbench/generationCanvas/agent/shotVerifyJudge.ts:1-48` 已接真实 deps：视频用 `getDesktopBridge().video.extractFrame` 抽首帧，judge 通过 `runSingleShotAgent` 的 `mode:'chat'`/图片 attachment 调文本模型；没有多模态能力时由解析失败优雅降级。它是镜级生成后校验，不是时间轴语义编辑器。
- 接入 E3 还缺：按 EditPlan 的“片段/时间窗”抽样、批量成本估算与上限、结果到 `EditPlan` 的证据映射、转写/说话人/停顿结构、人工确认卡文案和宿主投影。计划只列这些缺口，不能假装现成。

### E3 与 E2 的边界不变量

| E2（结构） | E3（理解） |
|---|---|
| 读 timeline/storyboard metadata，零模型调用，确定性派生 | 读取画面/音频/字幕上下文，调用 VLM/转写，输出建议或候选 EditPlan |
| 操作集受现有 timeline API 限制 | 不得扩大操作集；理解只决定现有 trim/split/reorder/text/audio 操作的参数 |
| 计划可直接复算 | 结果必须带 evidence/window/model/cost；模型失败时不写轴 |
| 同一 Proposal/Apply/Undo | **唯一通道**：E3 不得新增 store、第二个事务、第二个撤销按钮 |

## 1. 分期总览

| 期次 | 性质 | 目标 | 规模估算 | 独立回滚点 |
|---|---|---|---:|---|
| E3-0 | 词汇/成本契约 | 锁 E3 意图、证据、预算预估、冻结项和降级语义 | 新增约 180–280 行文档/fixture；代码 0 | 删除本期契约/样例 |
| E3-1 | 低成本筛选 | 先用已有结构/廉价信号缩小候选窗口，决定何时值得调 VLM/转写 | 新增约 320–520 行；删除约 40–80 行重复筛选 | 关闭筛选 adapter，回到 E2 计划 |
| E3-2 | shotVerify 语义接线 | 把镜级审片结果映射为带证据的建议 EditPlan；不自动付费、不直接落轴 | 新增约 420–680 行；删除约 80–140 行旁路 judge 接线 | 停用 E3 judge adapter，既有 shotVerify 仍可审片 |
| E3-3 | 意图剪辑 | 实现“开头收紧到 15 秒”等受限意图，仍只生成 Proposal | 新增约 450–750 行；删除约 100–180 行重复时间计算 | 关闭意图入口，保留 E2 手动/结构计划 |
| E3-4 | 口播/访谈清理（远期） | 在转写/说话人/停顿证据成熟后做可撤清理 | 新增约 500–800 行；删除约 100–160 行临时解析 | 删除远期 adapter，不迁移既有轴 |
| E3-5 | 体验与成本验收 | 真实任务、花费预知、失败/超时/撤销、三宿主一致投影 | 新增约 260–440 行测试/证据；删除 0 | 关闭 E3 feature exposure，历史 Proposal 只读 |

## 2. 成本是核心设计约束

E3 每次可能花 VLM/转写额度，必须在调用前进入既有确认漏斗；“审片建议”也不能因为看起来只是分析就静默调用。每个候选计划卡必须给出：预估调用数、每次输入类型/时长、单价来源或“无法报价”的诚实标记、总价上限、超上限行为、以及**过闸后不可再改什么**（素材/时间窗、模型/供应商、音视频版本、baseRevision、目标项目、最大调用次数）。确认后这些值进入 Proposal/contract hash；修改任一冻结项只能回到编辑并生成新 Proposal。

默认成本阶梯（实现前需用真实 catalog/pricing 事实替换，不可凭记忆填价格）：

1. **零成本**：读 E2 EditPlan、timeline metadata、已有字幕/对白字段、clip 可见区间，先判断是否能确定回答。
2. **低成本筛选**：若存在已缓存缩略/音频峰值/转写片段，只在候选时间窗取样；无证据则明确“未筛选”，不可把“跳过”冒充“没有问题”。
3. **VLM/转写**：只对筛选后的窗口调用；用固定 `maxWindows`、`maxDurationSec`、`maxCalls`，逐次记 evidence 与费用。批量任务全部完成或达到上限后才汇总，不允许无限重试。
4. **失败/超时**：单窗失败返回 skipped/partial，并保留已成功窗口；超过总 deadline 立即给用户“未完成理解、未改时间轴”的可行动下一步。只有获得真实低分/明确证据才允许生成建议，不因网络错误触发自动重剪。

“用户怎么预知花费”是验收项而不是文案润色：计划卡必须显示“将看哪几段/调几次/估算上限/过闸后冻结什么”；宿主不支持富卡时，MCP structured result 与模型引导必须包含同样字段；无价格数据时显示“价格未知，禁止自动执行”，不能让模型替用户猜。

## 3. 执行卡

### E3-0 词汇与成本契约期

- **目标**：固定三类意图（审片建议、开头收紧、口播清理）、evidence schema（window、sourceRevision、frame/audio refs、modelRef、attempt、cost）、`SemanticEditRequest` 与 E2 `EditPlan` 的输入输出、skip/partial/fail 语义。
- **涉及文件**：新增 `docs/plan/` fixture；只读 `docs/plan/2026-08-26-p5-e2-structured-rough-cut.md:62-108,135-183`、`electron/capabilityCore/shotVerifyOrchestrate.ts:54-109,230-320`、`src/workbench/generationCanvas/agent/shotVerifyJudge.ts:1-48`、`src/workbench/adoption/adoptionTypes.ts:12-26`。
- **验收门**：每一意图都列允许的现有 timeline operation 与明确禁止项；每个 paid request 有 estimate/freeze/rollback；fixture 证明模型失败、价格未知、超时都返回“不改轴”；证明 E3 只接受当前 `baseRevision`。
- **回滚方式**：删除契约与 fixture，不改变 E2/shotVerify。

### E3-1 低成本筛选期

- **目标**：建立结构/缓存优先的候选窗口派生器；先读 E2 的 clip/text/audio 事实，再决定是否需 VLM/转写，避免整条视频逐帧送模型。
- **涉及文件**：建议新增 `src/workbench/semanticEdit/{windowSelector,costEstimator}.ts` 与测试；读取 `src/workbench/timeline/{timelineTypes,timelineEdit,timelineMath}.ts`、现有 asset probe/preview API；价格只能接已有 catalog/pricing resolver，不能在 E3 新写供应商价格表。
- **验收门**：输入无模型调用即可得到零成本结果时，调用数为 0；窗口总时长/数量/预算上限硬封顶；同一 `baseRevision + requestHash` 复算稳定；缺缓存时输出“需要理解”而不是静默全片扫描；测试不使用私有墙钟 `waitFor`/`Date.now()` 截止轮询（R18）。
- **回滚方式**：停用 selector/cost adapter；E2 继续提供手动/结构计划，旧 timeline 不变。

### E3-2 shotVerify 语义接线期

- **目标**：复用现有 `shotVerifyCore`/`shotVerifyOrchestrate` 的判决与硬 deadline，把镜级身份/构图/连贯建议变成**建议 EditPlan**，而非直接重生或直接写轴。
- **涉及文件**：接线只围绕 `electron/capabilityCore/shotVerifyOrchestrate.ts:1-18,120-320`、`src/workbench/generationCanvas/agent/shotVerifyJudge.ts:1-48`；新增 `src/workbench/semanticEdit/shotVerifyEvidenceAdapter.ts`、`electron/capabilityCore/semanticEditCostGate.ts`、测试。不得复制第二份 judge/parser，也不得把生成 retry 当时间轴 trim。
- **验收门**：首帧/窗口抽取失败、judge 超时、非多模态模型、单窗低分分别落为 skipped/partial/flagged；最多重试/总 deadline 不超过既有 shotVerify 语义；建议仅包含 E2 已存在的 trim/split/reorder/text/audio 操作；写轴前一定生成 Proposal，计划卡显示 evidence 与费用；同一 Proposal 重放不重复调用或扣费。
- **回滚方式**：撤掉 E3 adapter，保留既有 shotVerify 生成后红标/定向重试；绝不回滚已完成生成、receipt 或 Run。

### E3-3 受限意图剪辑期

- **目标**：先实现窄意图“开头收紧到 N 秒”（默认示例 15 秒），把自然语言编译成受影响窗口和可验证 trim/split；不能承诺 ripple/roll/内容理解之外的“自动补缝”。
- **涉及文件**：新增 `src/workbench/semanticEdit/intentCompiler.ts`、`editPlanEvidence.ts`、测试；复用 `src/workbench/adoption/{adoptionProposalKey,adoptionApply,adoptionReceipt}.ts` 和 E2 `EditPlan` 入口；读取 `src/workbench/timeline/timelineEdit.ts:311-458`。
- **验收门**：只改用户授权窗口/轨道；目标时长不可达、素材缺失、轴 revision 变化均 fail-closed/stale；计划卡列明删/裁哪几段、保留哪几段、预计花费（零模型时显示 0）、冻结项与一步 Undo；真实走查覆盖“返回修改”“撤销后手动拖剪再重提”。
- **回滚方式**：关闭意图编译入口；不清理用户手动编辑、不重写 timeline revision。

### E3-4 口播/访谈清理期（远期）

- **目标**：在转写、说话人、停顿/重复词证据可复现且成本可预知后，支持删除口头禅/长停顿/明显重句；默认只提案，不自动发布。
- **涉及文件**：候选目录 `electron/semanticEdit/transcript/`、`src/workbench/semanticEdit/dialogueCleanup*`；必须先复核现有音频轨/导出事实（`renderManifest.ts:23-27,133-143,162-194`）和 TTS 已拍板进 E2 的边界。若没有可读 transcript/导出音频能力，本期停在契约，不造假能力。
- **验收门**：转写每段带时间窗/置信度/模型/费用；说话人不确定、重叠音、音乐覆盖时标记需人工；只生成现有 split/trim/text 操作，导出链能证明音频语义，否则不进入可交付；真实任务至少一条含“拒绝/修改/撤销”。
- **回滚方式**：删除 transcript/cleanup adapter；现有音频与 E2 结构计划原样可读。

### E3-5 体验与成本验收期

- **目标**：证明 E3 在内部 Nomi、支持 elicitation 的外部客户端、不支持且用户不在 Nomi 的 fallback 三宿主里是一份语义两个投影；成本、失败、重启、撤销都可见。
- **涉及文件**：新增/维护 `tests/ux/semantic-editing.e2e.mjs`、`electron/semanticEdit/*.test.ts`、`docs/audit/` 证据；不新增第二确认卡或第二 Undo 通道。
- **验收门**：J1（审片建议→确认→Apply→Undo）、J2（15 秒意图→stale→返回修改）、J3（VLM 超时/价格未知→不改轴）；每宿主亲跑并保存退出码/截图/日志。`pnpm run check:walkthroughs` 只静态扫描，不能作为走查证据；gates 绿也不能替代人眼读取截图。
- **回滚方式**：关闭 E3 暴露，历史 Proposal/evidence 只读；E2 继续是唯一快路。

## 4. 不动项清单（具体保护路径）

- `electron/productionRun/productionRunRepository.ts`、`productionRunIntentLog.ts`、`productionRunService.ts`、`multiShotBatchScheduler.ts`：Run ledger、预算/receipt/幂等、WAL、恢复和调度不被 E3 分析结果反向改写。
- `electron/productionRun/anchorCheckpoint.ts` 与 `src/workbench/generationCanvas/agent/{proposalTxn,applyCanvasToolCall,proposalUndo}.ts`：锚一致性、Proposal/Apply/Undo 是保护项；E3 只能提出 Proposal。
- `electron/capabilityCore/{generationDispatcher,security,mcpVerify,approvalReceipt,mcpGateConfirmation}.ts`：能力核权限、来源绑定、确认/receipt 仍是唯一 paid 闸门。
- `src/workbench/timeline/timelineTypes.ts`、`timelineEdit.ts`、`timelineTextEdit.ts`、`workbenchStore.ts`：不新增 ripple/roll/视觉转场，不把 audio 预览冒充导出能力；所有写轴复用 E2/E1 adapter。
- 两条事件日志不物理合并；E3 evidence 只能旁路引用 `runId/proposalId/txnId`；`Thread/Turn/Item` 不引入 SDK 类型；`package.json` 保持 `ai@4`。
- 自由挡不降级：任何理解式自动化均可返回画布手动编辑，不能锁死整轴或禁止单镜逃生。

## 5. 验收与回滚纪律

每期开始记录分支、`origin/main`、diff stat、预估调用次数/额度；零额度自动化先跑，真实 VLM/转写按已确认的费用上限执行。门岗命令固定为：

```bash
pnpm run gates > /tmp/gates-e3-semantic.log 2>&1; echo exit=$?
```

不得用 `| tail` 或将 test/build 接在管道后取退出码。`check:walkthroughs` 是静态检查；涉及 UI/成本的期次必须亲跑 Electron/Playwright，读同构建截图并记录真实退出码。失败/超时证据必须证明“未写轴、未扣第二笔钱”，不能只看界面 toast。

## 6. 风险、未知与待 owner 拍板

1. 价格目录是否覆盖 VLM/转写、能否按窗口准确报价，目前没有 E3 专属事实；在价格未知时默认禁止自动执行，**待 owner 拍板**是否允许仅显示区间估算。
2. `shotVerify` 当前是“生成后镜级判分/定向重生”，不是时间轴审片；按片段窗口抽样、证据粒度和批量并发尚未有现成实现，必须在 E3-2 实查并补测试，不能把现有 runner 名称当成已接通。
3. “开头收紧到 15 秒”在多轨/字幕/音乐与素材不可裁时的产品语义（删镜、trim、留黑、人工选择）存在多个合理解，**用户可见计划卡与默认策略需样张/owner 拍板**；本计划默认 fail-closed，不替用户选不可逆方案。
4. 口播/访谈清理依赖转写、说话人和音频导出链；当前 manifest 明确 mute，是否先补音频导出再做清理是架构岔路，**待 owner 拍板**。
5. E3 是否允许对低分镜头自动触发 shotVerify 的重生，与“理解式剪辑只提案”的边界可能冲突；默认沿用现有 runner 的生成后增益语义，时间轴编辑永远不自动重生，**待 owner 拍板**是否开放组合。
6. 总成本/总时限与“多窗口更准”的取舍尚无真实任务数据；先以固定上限、低成本筛选、超限停机为默认，禁止靠提高 maxCalls 掩盖不准。

## 7. 阶段完成判定

E3 只有在 EditPlan/Proposal/Apply/Undo 共用证据、成本在确认前可预知、失败/超时 fail-closed、至少一条真实用户任务三宿主亲跑且截图人眼通过、每期可独立回滚时，才能称“已完成”。仅 gates 绿、单测通过或看到一张“建议卡”都不算理解式剪辑交付。
