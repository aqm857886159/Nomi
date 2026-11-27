有条件通过：第 2 轮盲验确认快照与事件游标同批配对、点选时间轴片段零写盘及后台预览回填留内存均已严密落地，定向回归与真实桌面走查 122/122 原档零改写通过（Windows 与真付费按派活约定未验证）。

## 验收元数据

- 验收线：v-fs1-r2
- 验收 HEAD：968e0db7b4bc7a9a23d04b7d33c942ef7646d2af
- 对应 PR：#1713（分支 `codex/F-S-1-no-readonly-write`，父提交 `f02cd1ccc`）
- 盲验方式：独立阅读 `git show 968e0db7b4bc7a9a23d04b7d33c942ef7646d2af`、`git diff origin/main..968e0db7b4bc7a9a23d04b7d33c942ef7646d2af`、相关源码上下文，并亲手实跑定向单测、门岗脚本与真实桌面走查（未读取任何实现线自报草稿）

## 第 2 轮三项必改核对

| 编号 | 核对项 | 结论 | 独立源码与测试证据 |
|---|---|---|---|
| ① | 画布快照与 `generationCanvasLastSeq` 按同一项目、同一批次配对保存；关项后落地运行结局不被旧 `canvas.snapshot.restored` 覆盖；初始 `seq = 0` 崩溃尾部可重放 | **通过** | `src/workbench/generationCanvas/events/canvasEventEmitter.ts:45-106` 将缓冲收敛为带 `projectId` 与 `receipt` 的 `AppendBatch`，并按项目串行化 `appends` 队列；`captureCanvasEventCursor(projectId)` 捕获当下前缀长度 `end`，落盘时按需 `flushNow()` 并按 `last - (batch.events.length - end)` 还原该快照对应的精确游标，追加失败安全回退至 `previous`。<br>`src/workbench/project/workbenchProjectSession.ts:212-214,299-319` 在 `saveIfReady` 捕获 `{ projectId, payload, cursor }`，并在 `onAfterCanvasGesture` 中校验 `projectId`、`canPersist()` 及 `nodes/edges/groups` 引用一致（对应 `generationCanvasStore.ts:211-220` 的 `readDocumentSnapshot()` 原引用）后才刷新 `ownedSave.cursor`，杜绝后续瞬态 `persist: false` 写入推进前一张快照游标。<br>`src/workbench/project/projectPersistenceService.test.ts:149-271` 已补齐 4 条直接回归：关项后通过 `applyCanvasNodePatch` 落地运行结局重开不被旧 `canvas.snapshot.restored` 覆盖；无初始游标（`seq = 0`）保存首编后崩溃仅重放日志中第二笔编辑且后续可正常撤销；同批次尾部 `persist: false` 留在快照游标之后并重放；`events.append` 失败仍按已确认游标落盘清单。 |
| ② | 时间轴 `TimelineClip.tsx` / `workbenchStore.ts` 单击片段或原位松手不推进 `persistRevision`、不写盘；桌面走查补齐真实点选片段且维持 122/122 原档哈希不变 | **通过** | `src/workbench/timeline/TimelineClip.tsx:168-233` 仅在真实拖动位移 `> 3px` 时设置 `didDragRef.current = true` 并调用 `captureTimelineUndo()`，未拖动前直接返回；`onCommit` 仅在 `captured` 存在时调用 `commitTimelineClipDrag(origins, captured)`。<br>`src/workbench/timeline/timelineClipWritesSlice.ts:40-48` 比对最终 `startFrame` 与 `origins`，有净位移才 `persistRevision + 1`，回原位则 `cancelGesture(token)` 且不推进修订号、不留撤销记录。<br>`src/workbench/timeline/timelineEdit.ts:103-114,329-344,468-486` 与 `src/workbench/workbenchStore.ts:434-456` 确保原位/夹紧到原位的 `moveClipToLegalFrame`、`applyClipStartFrames`、`resizeClipEdge` 均返回原引用，不推进 `persistRevision`。<br>`src/workbench/timeline/timelineGesture.test.ts:116-133` 与 `src/workbench/project/projectPersistenceService.test.ts:273-290` 覆盖零净位移与点选/寻帧零保存；`tests/ux/project-readonly-open.walk.mjs:68-73` 已在 `browse()` 预览阶段真实点击时间轴片段并校验 `data-selected="true"`。 |
| ③ | `resultMediaBackfillBridge` 后台补预览在干净只读会话中仅留内存、不写盘、不在项目目录新增 sidecar，待首次真编辑随整份项目落盘 | **通过** | `electron/assets/localFileImport.ts:479` 将 `ensureLocalAssetPreview` 以 `{ ...options, readOnly: true }` 委派给 `attachStoredAssetPreview`。<br>`electron/assets/assetPreview.ts:192-224,272-279` 在 `readOnly` 模式下通过 `readMemoryPreview` 在隔离临时目录派生并缓存至 32MB `LRUCache`，返回带 `?canvas-preview` 查询串的内存预览 URL（或 `source`/`missing`），不在项目目录写回 sidecar 或缩略图文件；`electron/protocol/localProtocol.ts:191-221` 识别 `?canvas-preview` 直接从 `readMemoryPreview` 响应字节，且 `preview.local.response` 经 `electron/events/eventLogRepository.ts:226-235` 分流至应用诊断日志而不打开项目事件写者。<br>`src/workbench/generationCanvas/resultMediaBackfillBridge.ts:69,119,217,298` 将本地预览回填改为 `persist: false`（`{ history: false, emit: false, persist: false }`）并按单次打开作用域维护 `previewAttempts`（远端防过期本地化仍维持 `persist: true`）。<br>`electron/assets/canvasPreviewContract.test.ts:162-177`、`src/workbench/generationCanvas/resultMediaBackfillBridge.test.ts:140-177` 与 `src/workbench/project/projectPersistenceService.test.ts:292-328` 实证：原目录零新增文件/sidecar、只读会话零落盘、首次真实编辑一并持久化已补预览事实。 |

## 亲手实跑命令与结果

| 命令 | 退出码 | 实测结果 |
|---|---|---|
| `VITEST_MAX_WORKERS=2 pnpm exec vitest run src/workbench/project/projectPersistenceService.test.ts src/workbench/project/projectPersistenceService.autosaveRename.test.ts src/workbench/project/workbenchProjectSession.hydration.test.ts src/workbench/project/workbenchProjectSession.persistence.test.ts src/workbench/project/workbenchProjectSession.saveReceipt.test.ts src/workbench/timeline/timelineGesture.test.ts src/workbench/generationCanvas/resultMediaBackfillBridge.test.ts src/workbench/generationCanvas/store/canvasPatchHistory.characterization.test.ts src/workbench/assets/deleteAssetResult.realStore.test.ts src/workbench/assets/deleteAssetResult.test.ts electron/assets/canvasPreviewContract.test.ts electron/events/eventLogRepository.test.ts` | 0 | **12 个测试文件、132 / 132 用例全部通过**（含 `projectPersistenceService.test.ts` 14/14、`timelineGesture.test.ts` 14/14、`resultMediaBackfillBridge.test.ts` 14/14、`canvasPreviewContract.test.ts` 6/6、`eventLogRepository.test.ts` 13/13、`canvasPatchHistory.characterization.test.ts` 23/23、`deleteAssetResult.realStore.test.ts` 21/21 等） |
| `node ./scripts/check-root-cause-contracts.mjs && node ./scripts/check-concept-owners.mjs` | 0 | **2 项全绿**：根因合同门禁通过（4 个高风险生产文件均有合同与变化中的回归测试）；概念 owner 门岗通过（435 个概念，converged 431 / pending 4，第二写口 0 新增，未登记共享边界 31 冻结在基线） |
| `node tests/ux/project-readonly-open.walk.mjs` | 0 | **真实 Electron 桌面三轮走查通过**：`first`（zh-CN 浏览 A/C/B 含点选时间轴片段，`GET /v1/tasks/s-walk-video-8`、0 POST）校验 `H0 files unchanged: 122 new filmstrips: 3`；`reopen`（en 重开 B 含点选时间轴片段，0 POST）校验 `H0 files unchanged: 122 new filmstrips: 3`；`edit`（en 对 A 执行按钮放大、快捷键 Fit、Ctrl+滚轮三次手动缩放，逐次 `revision +1` 与工具栏百分比一致）通过 |

## 条件与未验证范围

- **Windows 平台**：本次验收在 macOS 桌面环境完成，Windows 文件锁与路径行为标为 `unverified`（按派活约定）。
- **真实付费生成样本**：本次仅使用本地 mock 供应商校验未结任务免费 `GET` 状态轮询与 0 `POST`，未触发真实付费生成，标为 `unverified`（按派活约定）。
