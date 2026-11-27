# 方向检查：付费结果从 Run 账本找回丢结构与派生付费请求按原单去重（RW-recovery）

- 日期：2026-11-27
- 基线：`origin/main` @ `7b4c15329`（只读对照 `origin/feat/sd-sample-mode` #1702、`origin/feat/se-layer-split` #1703）
- 编写线：`gemini-rw-recovery`（独立线，未参与 #1702 / #1703 实现与前两轮修补）
- 触发：P1 触发 #4（#1702 样片模式、#1703 图层分离审查第 1 轮均不通过，已各改两轮，再补即第 3 轮）+ `node scripts/fix-churn.mjs` 命中文件热点（`electron/productionRun/productionGenerationSubmission.ts` 14 天第 4 次、`electron/capabilityCore/canvasShotResult.ts` 第 3 次、`electron/capabilityCore/appIntegrationCanvasShot.ts` 第 3 次）与概念热点（`canvas.shot-run` 14 天第 6 次、`production.generation-observation-lifecycle` 第 4 次、`production.submission-admission` 第 3 次）；两分支连带触碰自写登记 `send-cost-public-estimate`（30 天第 3 次）、`canvas-selection-composer-viewport`（30 天第 5 次）与 `gate-family`（`scripts/check-*.mjs` 族）
- 状态：待用户拍板（#1586 · RW-recovery）

**这一处的全图在哪**：半幅在 `docs/engineering/seams.json:59` 的 `result-to-project`（当前 `checked: false`、`map: "无"`，且前缀漏了 `electron/capabilityCore/canvasShotResult.ts`、`appIntegrationCanvasShot.ts`、`electron/productionRun/productionGenerationSubmission.ts`）；另一半「派生付费请求按上游原单身份去重」在**表外**（拍板后应补入 `seams.json` 并绘全图）。

---

### 0. 一句话根因

画布单镜 Run 账本在 #1638/#1642 迁移时**只接管了「单次点击的传输生命周期与裸媒体字节文件」，没有接管「这一单的业务派生身份（入口）与归一化终态语义结果（出口）」**——在线完成靠内存临时变量 `last` 侥幸带回完整 `TaskResult`，一旦走账本回放就退化成 `raw: {}` 的裸文件列表；派生付费动作则把「同一原单不重复扣钱」寄托在渲染层版本栈与单次点击号 `runRecordId` 上，主进程一结案或进待取回即失忆。

---

### 1. 归类表：bug → 直接原因 → 类

> 独立判断：**`(a)` 找回丢结构** 与 **`(b)` 派生请求漏去重** **不是同一个机械 bug，但也不是互不相干的两件事**——它们是同一次半截账本化改造在**出口（Egress：终态物化→投影）**与**入口（Ingress：提交准入→幂等键）**留下的**同层孪生结构缺口**。下表将症状、直接原因、类根因拆开，并纳入两轮审查全部 9 项问题与前序 #1617/#1635/#1638/#1642 脉络：

| 提交 / 审查项 | 症状（创作者遭遇） | 直接原因（代码事实） | 类根因 |
|---|---|---|---|
| **#1702 [P1]** `generationRunController.ts:488-494` | 已受理待取回的高清单点「出高清」无提示再扣一单；切回已出高清的样片确认后带 `forceRerun` 再发 POST | 仅渲染层用 `finalsMadeFrom(node, draftTaskId)` 读已落盘版本栈提示，且 `catalogTaskActions.ts:391` 在节点已有结果时无条件设 `forceRerun: true`；主进程 `appIntegrationCanvasShot.ts:762` 只按每次点击新造的 `runRecordId` 去重，原单进 `jobAwaitsRetrieval` 后 `blockingReason` 返 `null`（`canvasShotResult.ts:51`）并清掉 `openCanvasRuns` | **类 B（入口缺业务幂等键）**：派生付费请求按「点击号」而非「`(vendorKey, draftTaskId, 目标规格)`」在主进程立账 |
| **#1702 [P1]** `sampleFacts.ts:51-56` / `canvasShotResult.ts:25-35` | 关窗/重启找回后，480p 样片丢「出高清」按钮，1080p 高清丢样片派生归属，节点丢实扣回执 | `canvasTransportProvider.ts:124-135` 物化只抽媒体 URL/宽高进 `ProductionArtifact[]`，`resultFromArtifacts` 回放拼出 `{ assets, raw: {} }`，丢弃 `provenance`（含 `cost`、`modeId`、`draftTaskId`） | **类 A（出口有损压扁 + 双轨返回）**：账本物化把结构化 `TaskResult` 压扁成裸文件列表，在线靠内存 `last` 掩盖 |
| **#1703 [P1]** `appIntegrationCanvasShot.ts:564-579` / `landTaskResults.ts` | 关窗后台落完或点「重新取回」后，已付费拆图落成 N 张孤立透明碎图版本，落不成可编辑画板 | `pollRun` 命中 `readyArtifacts` 时调 `resultFromArtifacts` 返 `raw: {}`、无 `layers`；`landTaskResults` 见不到 `layers` 就按普通多图逐张塞进 `node.history` | **类 A（出口有损压扁 + 双轨返回）**：与 #1702 找回丢 `provenance` 同源，且破坏性更强（污染版本栈） |
| **#1703 [P2]** `localizeTaskAsset.ts:108-117` / `storedAssetFile.ts:78-80` | 某层下载失败后轮询/手动取回重跑，已成功的层反复写出 `-2.png`、`-3.png` 灌进素材库 | 引擎 A `localizeTaskAssets` 调 `importRemoteAsset` → `uniqueAssetPath` 每次碰撞递增文件名，未像引擎 B `generationOutputMaterializer.ts:188` 那样传 `(providerTaskId, outputIndex)` 走确定性幂等落盘 | **类 A 的落盘半边分叉**：两套落盘器并存，画布单镜侧缺按「任务号+输出槽位」的幂等发布 |
| **#1702 [P2]** `sampleFacts.ts:74` / `catalogTaskResultParse.ts:154` | 文生样片出完后，高清按钮与确认卡永远算不出 1080p 约价 | `normalizeCatalogTaskResults`（`catalogTaskResultParse.ts:154`）把 `result.taskKind` 覆写成产物媒体类 `'video'`，`sampleFacts` 拿它去调 `vendorPriceRequest.ts:50-53` 被拒（只认 `text_to_video` 等请求类） | **类 A 的渲染层同构退化**：结果归一化用「产物媒体类型」覆盖了「冻结请求种类」 |
| **#1702 [P2]** `retryFailedRows.ts:74-77` | 任务中心混合「全部重试」弹汇总确认期间若另一入口改了节点模型/时长，确认后按篡改后的高价参数扣费 | 汇总卡自己调 `confirmGenerationSpend`，通过后带 `skipSpendConfirmation: true` 调 `confirmAndRunPlan`，绕过了其内部确认前的 `captureApprovedGenerationInputs` 快照捕获 | **类 B 同族（确认快照与派发脱节）**：汇总入口在人拍板之后才采样待派发输入 |
| **#1703 [P2]** `useNodePricePreview.ts:55-65` | 8 层秒改 100 层立即点发送，300ms 内按钮仍拿 8 层旧价标成 `≤` 上限并配「100 层」文案 | `PRICE_HOLD_MS = 300` 在新请求参数已变时仍保留上一轮 `held` 报价，未清掉失效的 `upper-bound` 语义 | **相邻独立漏口（约价投影滞后）**：命中 `send-cost-public-estimate`，旧报价与新参数错配展示 |
| **#1703 [P2]** `runtime.ts:288-299` / `customCallDispatch.ts:197-204` | 给拆图模式挂自定义脚本后，浮条仍放行拆图，实跑跳过契约校验且回执无 `layers`，扣钱落不成画板 | UI 看内置 mapping 判可拆，`runtime.ts` 却优先短路进 `runCustomCallTask`，后者只回 `assets: string[]` | **类 A 同构（执行分支输出失配）**：能力准入看内置契约，实际派发走有损旁路 |
| **#1703 [P2]** `whiteboard-perf.probe.mjs` | 百层性能探针在图层未解码前提前停表，且少 1 层（100 vs 101 行）仍判绿 | 画板初始 `ready` 即启用导入键，停表条件没等首帧图层可操作，行数断言写了 `>= 100` 而非 `101` | **尺子失真（§4 靶子问题）**：探针测的是挂载壳而非创作者真实可用时刻 |
| 前序 **#1617 / #1635 / #1638 / #1642** | 余额不足连撞上游、未知态自动补发、受理后崩溃丢单 | 已封住「同一次点击 `runRecordId` 的网络重发与受理即落回执」，但 #1642 找回终点止步于 `resultFromArtifacts` 裸文件，未封住「跨点击派生单」与「终态语义回执」 | **本轮的前置半程**：修好了「一次点击交一单 + 字节文件能找回」，把结构语义与派生关系留在了半路 |

---

### 2. 为什么这一类会一直出现

#### 2.1 两个同层结构根：出口双轨有损（Root A）与入口点击号孤岛（Root B）

1. **Root A（出口双轨有损）**：
   - 在线路径：`appIntegrationCanvasShot.ts:597,623` 轮询完成时先跑 `materialize` 写账本，再执行 `return last ?? (artifact ? resultFromArtifacts(...) : ...)`。因为进程没死时内存变量 `last` 拿着 `runtime.ts` 刚产出的完整 `TaskResult`（含 `provenance`、`layers`、`durationSeconds`、转写 `raw`、缩略图），**在线走查永远走 `last`，掩盖了账本回放残血的事实**。
   - 账本回放路径：`canvasTransportProvider.ts:124-135` 只把 `{ outputId, kind, remoteUrl, width, height }` 喂给 `productionGenerationSubmission.ts:527-548` 生成裸 `ProductionArtifact`；尽管 `productionRunRuntimeEnvelope.ts:28-34` 的 `jobs/<jobId>/runtime.json` 已经落了 `lastPoll.raw`，`canvasShotResult.ts:19-36` 的 `resultFromArtifacts` 却根本不读信封，只拿 `run.artifacts` 硬拼 `{ assets: [{ type, url, width, height }], raw: {} }`。只要跨过关窗、重启、或首次合板失败点「重新取回」，`last` 不在内存，所有非裸文件的语义结构瞬间归零。
2. **Root B（入口点击号孤岛）**：
   - 主进程其实已有跨重启业务意图幂等设施 `createSubmissionIntent`（`electron/productionRun/submissionIntent.ts:75`，按 `scope: string[]` 算 `intent-${sha256}` 锁住唯一 `runId`），但全仓只有试模型 `tryModel.ts:124` 一处在用！
   - 画布提交口 `appIntegrationCanvasShot.ts:762` 只认渲染层每次点击现生成的 `runRecordId`，`assertNodeIdle`（`:258-272`）只拦内存 `openCanvasRuns` 里的在途单；一旦任务进 `jobAwaitsRetrieval`（已扣钱受理、仅取回失败），`canvasShotResult.ts:51` 的 `blockingReason` 返 `null`，`settle`（`:311`）立即把它移出 `openCanvasRuns`。渲染层既看不到在途锁、版本栈里又还没落出高清结果，再点「出高清」连二次确认都不弹就直发第二笔全价 POST。

#### 2.2 `door-map.mjs` 实测入口盘点

在基线 `7b4c15329` 实跑下列命令：

```bash
node scripts/door-map.mjs resultFromArtifacts
node scripts/door-map.mjs electron/capabilityCore/canvasShotResult.ts
node scripts/door-map.mjs pollCanvasShotRun submitCanvasShotRun normalizeCatalogTaskResults recoverNodeResult landObservedCanvasRun
node scripts/door-map.mjs electron/productionRun/multiShotCanvasLanding.ts
node scripts/door-map.mjs confirmAndRunNode confirmAndRunPlan deriveFromNode retryProductionRetrievalForNode createSubmissionIntent
```

- **Run 账本重建结果的两条总管道（共覆盖 9 个渲染层调用门）**：
  1. **画布单镜管道**：`resultFromArtifacts` 共 **1 扇文件门、3 处调用点**，全在 `electron/capabilityCore/appIntegrationCanvasShot.ts`（`:542` `replay` 同点击号重放、`:579` `pollRun` 关窗观察者先落完早返、`:623` `pollRun` 物化后 `last` 缺失兜底）；上游由渲染层 3 条链路汇入：`catalogTaskActions.ts:439`（在线轮询）、`recoverTaskActions.ts:119` `recoverNodeResult`（`NodeErrorReport.tsx:385`、`StoryboardPlanEditor.tsx:440,461`、`TaskCenterPanel.tsx:172` 的「重新取回」）、`recoverTaskActions.ts:198` `landObservedCanvasRun`（`capabilityApplyHandler.ts:281` 响应后台 `canvas.run-settled` 铃声）。
  2. **多镜 / Agent 批次管道**：`electron/productionRun/multiShotCanvasLanding.ts:248-313`（`door-map` 命中 **18 扇门、29 处**）的 `buildMaterializeShotsPayload` 从 `run.artifacts` 重建 `MaterializeShotResultWire`，经 `canvasLandingHost.ts:125,185,235` 推给 `src/workbench/capability/multiShotCanvasLanding.ts:311` `attachShotResult`。
- **付费提交与派生请求入口盘点**：
  - 渲染层付费派发门：`confirmAndRunNode`（**8 扇写门**：画布发送、错误卡重试、任务中心重试、分镜表行动作、画框动作、生产状态条、样片出高清 `generationRunController.ts:513`）+ `confirmAndRunPlan`（**5 扇写门**：批量预览、编组生成、任务中心全部重试、分镜批量）。
  - 从既有结果派生的动作：① 画布 `deriveFromNode`（`useQuickActionHost.ts:74`，仅免费新建待编辑下游节点，不直接发单）；② 多镜单格重做 `reworkProductionShot`（`appIntegrationProductionActions.ts:95`，同 Run 追加 attempt，已有 `previous_attempt_unsettled` 互斥闸）；③ **存量按上游任务号派生的付费模型**：`MiniMax-H3-Regeneration`（`electron/catalog/apimartVideos.ts:75-82,343-347`，手填 `source_task_id` 发视频重生成）——与 #1702 的 `draft_task_id` 完全同构，今天主进程同样**零原单幂等去重**；④ 主进程 `createSubmissionIntent`（`submissionIntent.ts:75`）仅 `tryModel.ts:124` 1 处接入。

#### 2.3 `origin/main` 存量找回路径全面体检（除 #1702 / #1703 外今天谁已在丢结构）

| 能力 / 结果类型 | `origin/main` 找回现状 | 证据（具体 `file:line`）与原因 |
|---|---|---|
| **节点溯源与实扣回执**（`provenance` / `provenance.cost` 实扣积分 / `vendorRequestId` / `seed` / 参数） | **已在丢（单镜 + 多镜双丢）** | 在线由 `runtime.ts:250` → `provenance.ts:137-139` 写入实扣 `cost`；单镜找回 `canvasShotResult.ts:25-35` 返无 `provenance` 对象，`catalogTaskResultParse.ts:176` 返 `undefined`；多镜 `multiShotCanvasLanding.ts:39,298-305` 连 `provenance` 字段都没有。找回后 `ProvenancePanel.tsx:81-90` 显示「未记录溯源」，实扣账、耗时统计（`generationTiming.ts:12`）与配方采纳键一并丢失 |
| **3D 模型生成**（`model3d` / `.glb`） | **已坏（物化即抛异常卡死 + 多镜过滤丢弃）** | 3D 节点走 `run` 账本（`spendConfirm.ts:74-76`），`canvasTransportProvider.ts:131` 与 `productionGenerationMaterialization.ts:119` 产出 `kind: "model3d"`；但 `productionGenerationSubmission.ts:482` 硬编码 `["image", "video", "audio"].includes(artifact.kind)` **漏了 `"model3d"`**，`:548` 传空数组进 `:483` `artifacts[0]!.artifactId` 当场抛 `TypeError` 进 `needs_attention`；多镜 `multiShotCanvasLanding.ts:277` 也只放行 `image`/`video` |
| **音频转写与字幕时间戳**（`AudioStripNode` `transcribe`：`raw.text` + `raw.segments` SRT） | **已坏（账本必判取回失败，重启全丢）** | `audio` 节点走 `run` 账本（`spendConfirm.ts:74`），`audioTaskRunner.ts:224-228` 返 `assets: [], raw: { text, segments }`；`productionGenerationSubmission.ts:524` 见 `outputs.length === 0` 必标 `output_retrieval_failed`，在线仅靠 `appIntegrationCanvasShot.ts:623` 内存 `last` 侥幸成片；关窗/重启后 `raw: {}` 抹光转写正文与 `AudioStripNode.tsx:50-65` 生成 SRT 必需的 `segments` |
| **视频与配音时长**（`durationSeconds`） | **已在丢** | `localizeTaskAsset.ts:77,97` 调 ffprobe 算出 `durationSeconds`，但 `ProductionArtifact`（`productionRunTypes.ts:471-504`）、`canvasShotRunApi.ts:112-147`、`canvasShotResult.ts:25-35` 均不存不返；找回视频的 `result.durationSeconds` 为 `undefined`（音频仅在挂载 `<audio>` 触发 `AudioStripNode.tsx:269` `onLoadedMetadata` 时懒补） |
| **缩略图 / 视频首帧海报与素材身份**（`thumbnailUrl`、`previewState`、`assetId`、`providerUrl`） | **单镜找回已在丢**（多镜保住缩略图） | 单镜 `canvasShotRunApi.ts:119,139-146` 丢弃 `imported.id`、`thumbnailRelativePath`、`previewState`，`canvasShotResult.ts:29-33` 只回 `{ type, url, width, height }`，逼画布回退读原片或异步重探（`canvasMediaPreview.ts:9-10`），下游引用因丢 `providerUrl` 被迫重传；反观多镜 `multiShotCanvasLanding.ts:293-305` 已保留 `thumbnailUrl` 与 `previewState` |
| **多张输出**（如一单 4 图） | **媒体文件数与顺序未丢**；每张的 `provenance` / 缩略图仍丢 | #1109 修齐了 `canvasTransportProvider.ts:128-134` 按序产出、`productionGenerationSubmission.ts:529` 按 `outputIndex` 落盘及 `recoverTaskActions.ts:174-177` 逐张入栈；但因只保裸文件列表，#1703 的 N 张图层在丢掉并行 `layers[]` 后被误当普通多图逐张灌入版本栈 |
| **同步配音 TTS**（`runTextToSpeech` / `runDoubaoUnidirectionalTts`） | **音频文件未丢**；溯源与 `assetId` 仍丢 | #1642 在 `paidSubmissionReceipt.ts:125-136` + `acceptedTaskResult.ts:22-46` 给同步音频补了字节级回执检查点，崩溃可重落盘并经 `ProductionArtifact(kind: "audio")` 找回本地 URL；但重放仍走 `resultFromArtifacts`，丢 `provenance` 与 `assetId` |
| **Agent 起草的批量** | **批次交接状态未丢**；单镜结构同上丢失 | D2 交接路径（`canvasShotHandover.ts`）把每镜 `accepted`/`unknown`/`not_sent` 落盘，批次进度不丢，但单镜恢复走 `appIntegrationCanvasShot` 同受 Root A 影响；多镜调度路径（`multiShotCanvasLanding.ts`）保住多图与缩略图，同样丢 `provenance`（含实扣）与 `durationSeconds` |

#### 三条体验铁律

| 铁律 | 本案核对结论 | 最小证据 |
|---|---|---|
| ⑩ 说的=摆的 | 主根不在此层；仅 #1702 `retryFailedRows.ts:74-77`（确认卡拍板与派发快照错位）及 #1703 `useNodePricePreview.ts:55`（旧上限配新层数）碰「确认卡所见 ≠ 实发参数」边缘 | 确认快照与实发请求逐字段恒等断言 |
| ⑪ 能选到 | 主根不在此层；仅 #1703 `runtime.ts:288` 自定义脚本未实现拆图回执却在 UI 显示可拆碰能力准入一致性 | 入口可拆判定与主进程执行器契约同源校验 |
| **⑫ 点了=以为的** | **本案核心命中**：① 点「重新取回」或关窗重开，创作者预期拿到已付钱的样片入口/图层画板/实扣回执，实际拿到被剥壳的普通视频或 N 张碎图；② 待取回高清点「出高清」预期取回原单，实际暗扣第二份钱 | `tests/ux/full-walk/catalog.mjs` 重启/重取回前后节点结果结构等价断言 + 同一原单派生 POST 计数 `=== 1` |

---

### 3. 不改结构的话，接下来会冒出什么（2–3 个可验证预测）

| 预测 | 怎么验证（命令或步骤） |
|---|---|
| **预测 1（存量已爆）**：画布 3D 节点生成成功跑进 `productionGenerationSubmission.ts:482` 时，因 `readyArtifacts` 漏 `"model3d"` 在 `:483` 抛异常卡进 `needs_attention`，关窗后点「重新取回」永远拿不回已扣费的 `.glb` | 单测喂 `kind: "model3d"` 给 `createProductionGenerationSubmission.materialize` 并断言 `run.status` 与 `pollRun` 返回：`npx vitest run electron/productionRun/`（当前必在 `:483` 崩进 `output_retrieval_failed`） |
| **预测 2（存量裸奔）**：`MiniMax-H3-Regeneration` 填同一 `source_task_id` 在原单进入 `jobAwaitsRetrieval` 或切节点再填同一任务号发送时，主进程不拦、直接向供应商发第 2 次扣费 POST | 检索 `git grep -n "source_task_id" electron/`：除 `apimartVideos.ts:76,343` 拼请求体外，主进程准入层零引用 |
| **预测 3（下个迭代必犯）**：0.26 只要给视频/音频节点加任何随单返回的结构化字段（如带时间轴的词级字幕轨、镜头运动元数据、多音轨分轨描述），在线联调全绿，一旦关窗由后台观察者落完再打开，该字段 100% 被 `resultFromArtifacts` 抹成 `raw: {}` | 检查 `electron/capabilityCore/canvasShotResult.ts:19-36` 签名——入参只有 `artifacts: readonly ProductionArtifact[]`，结构上不可能透传任何非媒体路径字段 |

---

### 4. 靶子独立性检查

- **走查靶子盲区（在线内存捷径掩盖落盘残血）**：现有桌面走查与大部分集成测试都在同一进程生命周期内等 `pollCanvasShotRun` 返回，命中 `appIntegrationCanvasShot.ts:623` 的内存 `last`，从未强制走 `resultFromArtifacts`——靶子测的是内存直通车，不是账本真相。
- **#1703 百层性能探针失真**：`scripts/perf/whiteboard-perf.probe.mjs` 由同一实现线编写，停表条件只看画板壳挂载（初始态即 `ready`）且行数断言写成 `>= 100`（底图+99 层+背景应为 `101` 行），导致图层未解码、少 1 层也能绿灯。必须先修探针靶子，再谈达标。
- **没有「修对了反而掉分」的先例**，但 #1642 曾出现过单测只打 `afterProviderAcceptance` 钩子而漏测 `checkpoint` 真落盘点的教训（见 `2026-11-24-u2-paid-submission-recovery.md` §4）。本轮验收靶子必须模拟**杀进程/重建 runtime 实例后再 `pollRun` / `recoverNodeResult`**。

---

### 5. 这一整块归谁（P0）

这一整块：已付费生成任务的终态语义回执持久化与找回投影，以及从既有任务派生的二次付费提交幂等准入
归谁：终态观测与落地生命周期归 electron/productionRun/productionRunRuntimeEnvelope.ts:82（createProductionRunRuntimeEnvelope）与 electron/productionRun/productionGenerationSubmission.ts:473（materialize）；跨重启按业务身份的付费认领与重发准入归 electron/productionRun/submissionIntent.ts:75（createSubmissionIntent）与 electron/capabilityCore/canvasResendDecision.ts:73（createCanvasShotResend）
我们哪里绕开了它：找回侧 electron/capabilityCore/canvasShotRunApi.ts:112 与 electron/capabilityCore/canvasShotResult.ts:19 丢弃信封终态语义回执、只从裸文件列表拼回 raw:{}（electron/productionRun/multiShotCanvasLanding.ts:277 与 electron/productionRun/productionGenerationSubmission.ts:482 同样漏投影溯源与 3D/转写）；派生提交侧 #1702 在 src/workbench/generationCanvas/runner/generationRunController.ts:488 只查渲染层版本栈 finalsMadeFrom 并带 forceRerun:true 发新单，未在主进程按 (vendorKey, draftTaskId) 走持久认领去重

- **有没有现成第三方库可接？为什么自写？**
  核对 `docs/engineering/self-written.json`：`electron/productionRun/`（`:13-16`）与 `electron/capabilityCore/canvas*`（`:18-20`）属 Nomi 独有领域根（「按镜头的花钱语义、单镜耐久账本与 `nomi-local://` 项目资产落盘」）。通用持久化工作流框架（Temporal、Restate、DBOS）均需外部常驻服务或通用重放运行时，无法直接管理离线 Electron 桌面的项目级 `project.json` 与确定性本地媒体仓。因此领域约束成立，**问题不在「没接外部库」，而在「我们自己已经写了 `productionRunRuntimeEnvelope` 和 `submissionIntent` 两个唯一主人，画布适配层却绕开它们另搞了一套残血拼装与渲染层去重」**。
- **连带命中的自写登记核对（`check-direction-trailer` 硬门要求）**：
  1. `send-cost-public-estimate`（状态 `justified`，30 天第 3 次触碰，路径含 `vendorPriceRequest.ts` / `useNodePricePreview.ts`）：之所以现在换不了现成库，是因为「按 Nomi 模型档案将层数/时长/清晰度投射到供应商目录价并标精确/上限档」无通用包理解 APIMart/自托管 wire 契约；复查/收敛节点：与连接管理定价探针合流为单一模型定价投影模块时一并收口，本次只修 `upper-bound` 参数变更即时清旧价与按冻结请求 `kind` 询价，不扩新层。
  2. `canvas-selection-composer-viewport`（状态 `justified`，30 天第 5 次触碰，#1702 因样片节点外挂行高度微调波及）：之所以现在换不了 `@xyflow/react` 内置 `getNodesBounds`，是因为 React Flow 12 不感知反向缩放的 `ComposerAnchor` 与节点外挂操作条几何尺寸；复查节点：升级支持屏幕空间外挂锚点包围盒的画布底座时替换，本轮严禁在此登记内加新特例分支。
  3. `gate-family`（状态 `under-review`，`reviewBy: 2026-11-30`，#1703 同步性能与样张登记脚本波及 `scripts/check-*.mjs`）：通用规则已迁 ESLint / dependency-cruiser，剩余仓库登记表核对脚本在 2026-11-30 门岗账本拍板收编前暂未整批替换；按 P1「门岗计数只减不增」，本轮结构防线一律落进 `tsc` 类型穷举与 `electron/parity/` Vitest 契约单测，**严禁在 `gate-family` 下新增 `scripts/check-*.mjs` 脚本**。

---

### 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 代价（改多大 / 谁来改 / 老数据怎么过） | 选了以后同一类还会不会出现、从哪出现 | 风险 | 推荐 |
|---|---|---|---|---|---|
| **沿原方向修** | #1702 在 `canvasShotResult` / `sampleFacts` 特判拼回样片 `provenance`、在 `appIntegrationCanvasShot` 单独加一张 `draft_task_id` 去重表；#1703 在 `resultFromArtifacts` 特判塞回 `layers`、在 `localizeTaskAsset` 特判缓存层文件 | **创作者看到**：样片与拆图眼下能找回，但普通视频/图片找回仍丢实扣积分与时长、3D/转写找回仍坏、`MiniMax-H3-Regeneration` 仍可重复扣费。<br>**改多大 / 谁改**：两条线各改 5–6 个文件（约半天），且同时改 `canvasShotResult.ts` / `appIntegrationCanvasShot.ts` 必撞合并冲突。<br>**老用户与老数据**：升级前在途单无特判字段，找回退化为普通媒体 | **必再出现**：下个带结构结果（词级字幕、多轨音频）或下个派生动作（续写、重生成）100% 再漏一次；且两 PR 第 3 轮各自往热点文件叠第 3 个特例分支，直接违背 P1 | 两分支合并互相覆盖回执拼装逻辑，高概率在冲突消解时二次引入回归 | 不推荐 |
| **换一种做法（收口到既有唯一主人）** | **先由独立底座线交 1 个薄底座 PR0（约 180–240 行），两 PR rebase 其上薄收尾**：<br>① **出口收一（补齐 Root A）**：在 `ProductionRunRuntimeEnvelope` 落盘**本地化完成后的耐久终态语义快照 `settledResult`**（含对齐 `artifacts[]` 的本地资产、完整 `provenance` 含实扣 `cost`、`layers`、转写 `raw`、`durationSeconds`、`thumbnailUrl`/`previewState`）；补齐 `productionGenerationSubmission.ts:482` 的 `"model3d"` 与无媒体转写结案分支；`localizeTaskAsset` 传入 `(taskId, index)` 复用 `writeGeneratedDeterministicAsset` 幂等写盘。**删掉 `appIntegrationCanvasShot.ts:623` 内存 `last` 捷径**，在线与找回统一只读 `readSettledCanvasResult`。<br>② **入口收一（补齐 Root B）**：模式契约声明 `derivedFromTaskParam`（覆盖 `draft_task_id` 与存量 `source_task_id`），主进程准入口复用 `submissionIntent` 按 `(vendorKey, parentTaskId, targetSpec)` 持久立账——原单 `in_flight`/`jobAwaitsRetrieval` 直接复用免费取回，原单已成功则走既有 `decideResend` 显式重发决定号，仅 `not_dispatched`/`provider_rejected` 直接放行新单。<br>③ **两 PR 薄收尾**：#1702 接底座 + 按冻结请求 `kind` 约价 + `retryFailedRows` 确认前冻结快照；#1703 接底座 + 参数变清 `upper-bound` 旧价 + 拦无拆图契约的 `customCall` + 修百层探针停表条件 | **创作者看到**：无论在线等完、关窗后台收完、重启找回还是点「重新取回」，样片、高清归属、图层画板、节点实扣积分、视频时长、3D、转写字幕全部一致保留；待取回高清点按钮自动免费取回原单，绝不暗扣第二笔。<br>**改多大 / 谁改**：底座线 1 个 PR0（聚焦 `electron/productionRun/` + `canvasShot*` + `localizeTaskAsset.ts`），随后 #1702、#1703 各删掉手拼回放补丁、只修各自 P2，零跨分支冲突。<br>**老用户与升级前在途/待取回旧账本怎么过**：① 已落进 `project.json` 的历史节点不读 Run 账本，零影响；② **升级前仍在途（`polling`）的旧单**：升级后首次轮询完成自动走新 `materialize` 写出完整 `settledResult`；③ **升级前观察者已落完 `artifacts[]` 但尚待投递/待取回的旧单**（盘上有 `run.json` + `runtime.json` 但无 `settledResult`）：`readSettledCanvasResult` 自动从 #1642 已落盘的 `runtime.json`（`lastPoll.raw` / `acceptance.rawAcceptance`）+ `run.contract.parameters.request` 回填冻结参数与实扣回执再配 `artifacts[]` 兜底，零迁移脚本、不丢单；④ 升级前旧样片首次点出高清仍由渲染层 `finalsMadeFrom` 弹确认，升级后首单起入主进程幂等账 | **同一类不再从账本回放与派生提交冒出**（由下方两道结构性防线锁死）；仅多镜 `multiShotCanvasLanding` 的 `provenance` 透传可按同一快照契约顺手对齐或单列小单 | PR0 需先合入，#1702/#1703 晚半天合入，但省掉第 3 轮盲补与冲突返工 | **推荐** |
| **删掉（最小可删单位）** | 不全删功能，只砍跨生命周期与二次派生的最小复杂度：① #1702 砍掉节点内「按 `draft_task_id` 二次出高清（`sample-final`）」或禁止关窗前未落完的样片升级高清，只保留独立 480p 低价试片；② #1703 砍掉关窗后台合板（关窗未落完只保原图进素材库，不落画板） | **创作者看到**：480p 试对动作后拿不到同构 1080p 成片（样片模式失去核心闭环）；跑几十秒的百层拆图一旦切窗/重启就退化成满屏碎图层。<br>**改多大 / 谁改**：两 PR 各删 80–150 行（2 小时）。<br>**老用户与老数据**：两功能均为 0.25 未发版新能力，无存量老数据负担 | 样片与拆图不再触发该洞，但 `origin/main` 存量的实扣回执丢失、时长丢失、3D/转写找回损坏、`MiniMax-H3-Regeneration` 重复扣费**原封不动留着** | 直接违背 0.25 必带拍板（`D-1126-sdse-libtv`），且创作者核心价值受损 | 不推荐 |

#### 推荐路径的结构性预防（让同类问题以后「写不出来 / 一写就编译红或首跑即爆」）

1. **单出口消灭「在线绿、找回丢」**：在 `appIntegrationCanvasShot.ts:597,623` **彻底删掉内存 `last` 旁路**，`pollRun` 结案返回与重启 `replay`/`recoverNodeResult` 强制调同一个纯函数 `readSettledCanvasResult(run, job, envelope)`。今后任何新功能漏写耐久字段，**开发者本地第一次正常生成就会当场缺字段**，根本等不到关窗重启审查才暴露。
2. **`TaskResult` 耐久字段编译期穷举**：仿照 `multiShotCanvasLanding.ts:205` 的 `CANDIDATE_LANDING_FIELDS`，在 `productionRunRuntimeEnvelope` 定义 `TASK_RESULT_DURABLE_FIELDS: { readonly [K in keyof Required<TaskResult>]: 'persisted' | StaysEphemeral<Reason> }`。未来任何人给 `TaskResult` 加字段（如 `subtitles`、`cameraTrack`），不在耐久表显式处置，**`tsc` 直接编译报错**。
3. **派生原单幂等声明化 + Parity 门岗**：在目录映射模式类型上把上游任务引用参数收敛为声明字段 `derivedFromTaskParam`，主进程 `appIntegrationCanvasShot.submit` 统一提取并过 `submissionIntent` 持久锁，调用侧无需手写去重，也无法靠新 `runRecordId` 或 `forceRerun: true` 绕过；同时在 `electron/parity/` 加契约扫描测试：凡内置 mapping `create.body` 含 `*_task_id` 占位却未声明 `derivedFromTaskParam`（或放行未经契约声明的 `customCall` 结构化回执），门岗直接红灯。

---

### 7. 用户要权衡的核心

是多花半天先合入一个「Run 账本完整终态语义快照 + 主进程派生单幂等准入」薄底座 PR0 让 #1702/#1703 无冲突收口（顺手把存量实扣回执、时长、3D/转写在找回上的断层和 `source_task_id` 重复扣费一并封死），还是让两个 PR 各自在适配层硬打第 3 轮特判补丁抢时间合入、接受两分支互撞冲突且下次加任何结构化结果或派生动作必再漏扣钱？

---

## 特征测试清单（动结构前先锁住）

- **已在 `origin/main` 钉住的特征测试**：
  - `electron/capabilityCore/__tests__/appIntegrationCanvasShot.test.ts`（已锁同 `runRecordId` 幂等重放、未知态 `canvas_submission_unknown` 拦截、`decideResend` 一次性重发令牌）
  - `electron/capabilityCore/__tests__/paidSubmissionZeroRecharge.test.ts`（#1642 已锁受理即落 `PaidSubmissionReceipt`、重启后单镜媒体文件与同步 TTS 零重扣找回）
  - `electron/productionRun/__tests__/submissionIntent.test.ts`（已锁 `createSubmissionIntent` 跨重启按业务 `scope` 认领唯一 `runId`）
  - `src/workbench/generationCanvas/runner/__tests__/recoverTaskActions.test.ts`（已锁多图按序恢复入栈）
- **动 PR0 结构前必须先补齐的 4 条红灯转绿灯特征测试**（当前未钉住原因：旧测试只断言了媒体 URL 数量，未断言 `provenance`/`layers`/`durationSeconds`/`model3d` 及跨点击派生原单幂等）：
  1. **跨重启完整语义找回测试**：模拟进程重建后调 `pollRun` / `replay`，断言 `provenance`（含 `cost` 实扣与冻结参数）、`durationSeconds`、结构化扩展（`layers` / 转写 `raw.segments`）及 `kind: "model3d"` 完整返回，且与在线首次完成返回结构 `deepEqual`、上游 `POST === 1`。
  2. **升级前旧账本兼容找回测试**：构造仅有 `run.json`（`artifacts[]`）+ `jobs/<jobId>/runtime.json`（无新 `settledResult` 字段）的在途与已落盘旧快照，断言升级后读取不崩并从 `runtime.json` + 冻结请求回填基础 `provenance`。
  3. **主进程派生单三态幂等测试**：同一 `(vendorKey, parentTaskId, targetSpec)` 换新 `runRecordId`（且带 `forceRerun: true`）在原单 `in_flight`、`jobAwaitsRetrieval`、`ready`、`provider_rejected` 四态下提交，断言前两态直接附着原单（`POST === 1`）、`ready` 态无 `resendDecisionId` 必返 `ask`、仅 `provider_rejected` 放行新单。
  4. **确定性多资产落盘重试测试**：模拟第 3 张图层首次下载失败、第二次取回成功，断言第 1–2 张复用同一确定性路径，素材库不产生 `-2.png` 副本。
