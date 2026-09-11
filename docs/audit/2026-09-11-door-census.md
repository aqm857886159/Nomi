# 门普查：七个核心状态，各有几扇门

> 状态：✅ 已交付 · 2026-09-11 · 单次机器普查 + 逐门人工判守卫
> 工具：`node scripts/door-map.mjs <符号或文件>`（规则见 [R21.3 数门](../engineering-rules.md)，方案见 [`plan/2026-09-11-door-map-rule.md`](../plan/2026-09-11-door-map-rule.md)）

数门脚本上线的第一件事不是等下一份根因合同来用它，而是**先把仓里已有的门数一遍**。
理由很直接：R21.3 立规的依据是「一天里三簇 bug 同一个形状」——那是三个样本。
如果这个形状只出现在那三处，规则就不值一条 L1；如果它到处都是，那三簇只是我们碰巧撞见的三处。
本文回答的就是这一问。

**结论先说**：七个状态里有**五个**是同一个形状——*一个装了完整守卫的规范入口，外加若干把可变 state
或裸文件句柄直接交出去的旁路*。只有技能写入侧和创作文稿做到了「全部写门共用同一个守卫实现体」，
而这两个恰恰是**把守卫写在被调方内部、而不是写在调用点上**的那两个。这不是巧合，是可复制的做法（R28）。

## 总表

| 状态 | 写入口 | 读入口 | 带守卫 | 无守卫 | 形状 |
|---|---:|---:|---:|---:|---|
| ① 画布节点（Agent 写路径） | 8 | 0 | 3 | **5** | 规范门 + 5 条直调旁路 |
| ② 付费草稿 / 收据 | 7 | 13 | 6 | **1** | 命令门全绿，IPC 注册签名留了个回退口 |
| ③ 技能记录（写侧） | 3 | 15 | 3 | 0 | ✅ 守卫住在被调方里 |
| ④ 时间轴 mutator（内核） | 2 | 0 | 2 | 0 | ⚠️ 但同一状态另有 ~26 扇绕开内核的门 |
| ⑤ 创作文稿 `document.write` | 2 | 0 | 2 | 0 | ✅ 但同一 API 对象上并排摆着 3 个无守卫旧方法 |
| ⑥ 模型目录 / 供应商 key | 17 / 11 | 0 / 34 | 14 / 11 | **4** | `mutateCatalog` 把可变 state 交给回调，开了 4 扇直改门 |
| ⑦ 项目 revision | 3 | 21 | 3 | **1** | legacy 分支整条不参与这套计数 |

「带守卫」= 打开该行、确认该调用点确实经过该状态的不变量执行体（校验 / 授权 / 事务 / schema）。
「无守卫」= 打开该行、确认它绕过了。判不出的一律标 **未判定**，不算进任一栏——本文宁可留白，不肯编。

---

## ① 画布节点

```
node scripts/door-map.mjs applyCanvasToolCall executeCanvasWriteTarget
```
**写 8 · 读 0。**

查的守卫是画布写的三层链：`assertCanvasWriteAdmissionMatches`（入场证据与前置条件逐字比对）
→ `applyProposalBatch`（提议事务 + `assertTurnCanWrite` 回合闸 + `pushUndoSnapshot`）
→ `createProposalReceiptCoordinator`（可撤销收据）。三样都在 `canvasWriteTarget.ts:245` 的
`executeCanvasWriteTarget` 里装配。选它当守卫的理由：`applyCanvasToolCall` 自己只有一条**可选**的
`canWrite` 回合闸，入场证据、事务、收据一样都没有——绕开 `executeCanvasWriteTarget` 直调它，就是绕开整条链。

**带守卫（3）**：`canonicalCanvasPlanPatch.ts:60`、`NomiStudioApp.tsx:271`、`proposalTxn.ts:256`（这扇就是守卫内部）。

**无守卫（5）**：
- `src/workbench/creation/storyboard/exec/storyboardRowActions.ts:97` — 分镜行落地，只有一行手写 `if (!gesture.canWrite())` 预检
- `src/workbench/capability/multiShotCanvasLanding.ts:230` — 批量镜头落画布，只有 `withCanvasGestureContext`，靠 `materializationOperationId` 幂等章自保
- `src/workbench/capability/capabilityApplyHandler.ts:620` — `production.materialize-storyboard`（MCP 与应用内共用），画布侧零守卫
- `src/workbench/onboarding/journeyTourStore.ts:99` — 引导演示落画布
- `src/workbench/onboarding/journeyTourStore.ts:132` — 同上，且整段套在 `try{}catch{}` 里静默吞错

**store 层另记一笔**：规范 mutator `addNode` 有 40 扇门、`updateNode` 有 156 扇，但它们的不变量
（categoryId 总闸、同分类 AABB 避让、`pushUndoSnapshot`、`emitCanvasGesture`、`bumpPersistRevision`）
写在被调方内部，所以是**构造性带守卫**——本轮按被调方结构判，没有逐一打开那 196 个调用点，如实说明。
真正的绕过不在这些门里，而在 5 个**不经 `addNode` 直接赋值 `state.nodes`** 的同层 action：
`canvasNodeActions.ts:269/488/535`、`canvasGraphActions.ts:712`、`generationCanvasStore.ts:157`。
其中 `restoreGraph`、加载/撤销/归一属于「不该再跑一遍出生规则」的合法路径；
**`canvasNodeActions.ts:535` 与 `generationCanvasStore.ts:157` 未判定**——它们建的是新节点却不经 `addNode`，
是否自带 categoryId 与避让要逐行核对工厂调用，本轮没展开。

## ② 付费草稿 / 收据

```
node scripts/door-map.mjs electron/productionRun/productionRunApprovalReceipt.ts
node scripts/door-map.mjs --write=createProductionRunRepository
```
**写 7 · 读 13。**

守卫是 `createGateApprovalOwner`（`productionRunApprovalReceipt.ts:122`）：付费门（`isSpendGate`）批准只认两种人证——
主进程收据权威验过的 receipt（HMAC + TTL + 一次性），或 `productionRunIpc` 在 `assertTrustedSender` 之后自己盖的
`humanGesture` 章。它**fail-closed 装配**：拿不到权威时持有的仍是这份 owner（`productionRunService.ts:120`），
不是 `undefined`，所以命令路径上不存在「验不了就跳过」的分支。第二条守卫是 `assertCurrentProjectRevision`。

**带守卫（6）**：`productionTrustGrantChallenge.ts:46`、`runOwnedGenerationGateAuthority.ts:74/134/173/210`、
`productionRunApprovalReceipt.ts:57`、`productionRunService.ts:120`。
> 方法论备注：这 6 扇**本身就是守卫在被调用**，不是被守卫的写入——脚本的启发式把
> `assertCurrentProjectRevision`（名字不匹配 reader 前缀）记成了写门。宁可多数一扇的取向在这里体现为一次误报，
> 而误报是人扫一眼就能划掉的；漏数才是看不见的那种。

**无守卫（1）**：
- `electron/productionRun/productionRunIpc.ts:224` — `registerProductionRunIpc` 接受
  `ProductionRunRepository | ProductionRunService`，传 repository 时走 `repository!.execute(...)`，**完全不经 `gateApproval`**，
  而同文件 `:171` 还会给 `gate.decide` 盖上 `humanGesture: true`。

这一扇是**结构上可达、当前装配下不可达**：`electron/main.ts:621` 无参调用，默认取 `getProductionRunService()`，
走 `:221` 的 `service.command`。也就是说今天没人走，但**明天一个 `registerProductionRunIpc(repo)` 就能把付费闸整条摘掉**。
这正是门表要让人看见的那种东西——它在任何单点 review 里都长得像一个无害的可选参数。

## ③ 技能记录（写侧）

```
node scripts/door-map.mjs --read=readSkillRecords,discoverSkillRecordsFromRoots
node scripts/door-map.mjs --write=importSkillPackageToUserDir,deleteUserSkill
```
**写 3 · 读 15 · 无守卫 0。**

三条落盘不变量全部装在 `skillPackage.ts` 的两个写盘函数**内部**：
① `validateSkillPackage(normalizeSkillImportInput(...))` 归一 + 校验；
② 路径收容（`deleteUserSkill` 解析后必须严格落在 `userRoot` 内、必须存在 `SKILL.md`，内置只读目录天然禁删）；
③ `broadcastSkillLibraryChanged()` 失效信号。外层另有 IPC 的 `assertTrustedSender`。

**带守卫（3）**：`skillIpc.ts:33`、`skillIpc.ts:119`、`skillWriteTransportAdapters.ts:139`
（最后一扇还**重读目录核对 `contentHash`**，对不上抛 `capability_execution_failed`，不允许乐观回「已保存」）。

**这是 ① 该学的形状**：守卫住在被调方里，于是「有几扇门」和「不变量在不在」解耦了——
门再多也不会漏，因为门本身没有绕过去的余地。

**与 [`2026-09-11-skill-fact-projections-structure.md`](2026-09-11-skill-fact-projections-structure.md) 对账，3 处不符（均为文档侧）**：
1. 文档列 7 个消费者，脚本数出 **8 个一手读入口**——多出 `electron/harness/skillIndex.ts:24`。
2. lane 行文档记 `laneInstalledSkills.mts`，但该文件只**接收** `readonly SkillRecord[]` 参数；真正的读门在 `laneDesktopRuntime.ts:149`。文档记的是投影 owner，不是门。
3. MCP 行文档记 `mcpSkillResources.ts`，该文件**根本不读 `SkillRecord`**；真实读门是 `skillStore.ts:325` 与 `:368`。

> **两者互补，都不能单独当真相源。** 默认参数式的 `readSkillRecords()` 让读门落在 `skillStore.ts` 自己身上，
> 二跳消费者（如 `mcpProtocol`）在脚本输出里是隐形的——文档的人工清单在这点上比脚本完整，
> 脚本在一手入口上比文档完整。这条限制已经写进 `door-map.mjs` 头部（只数直接调用点，隔一跳要再数一跳）。

## ④ 时间轴 mutator

```
node scripts/door-map.mjs applyTimelineOperation
```
**内核入口写 2 · 读 0 · 两扇都带守卫。**

守卫 = `applyTimelineOperations` 内部的 `validateTimeline` + `normalizeKernelTimeline` + `expectedRevision` 乐观锁，
调用点必须检 `result.ok` 才提交。`timelineClipWritesSlice.ts:51` 与 `workbenchStore.ts:532` 都做到了。

**⚠️ 但这不是全貌——本状态是本次普查里旁路量级最大的一个。**
`timeline` 的真相源是 `useWorkbenchStore` 的 `timeline` 字段，它有 **~28 处直接赋值**
（`workbenchStore.ts:389/401/419/433/446/473/490/519/554/567/582/598/613/622/633/646/659/695/717/726/739/749/768/780`、
`timelineClipWritesSlice.ts:41`、`adoptionStorePorts.ts:46`），**其中只有 2 处进内核**。
其余走的是另一套归一器 `normalizeTimeline`（`timelineMath.ts:143`）——它**不调用** `validateTimeline`、
不产 revision、不做乐观锁。

即：时间轴有**两份并行的归一真相源**，其中一份没有校验。这是 P1（无并行版）意义上的债，不只是门多。

## ⑤ 创作文稿 `document.write`

```
node scripts/door-map.mjs applyDocumentWrite
```
**写 2 · 读 0 · 两扇都带守卫。**

守卫 = 目标文档 id 相等 + `assertDocumentWritePreconditions(expected, current)` 的 revision/contentHash 前置条件
+ `resolveDocumentWriteRange` 锚点解析。
`capabilityApplyHandler.ts:395`（用 `tools.readState()` 现读 preconditions）与
`NomiStudioApp.tsx:244`（额外先做 `activeDocumentId` 比对 + `signal.aborted` + `assertCurrent()`）都过。

**同层旁路（记录，不计入无守卫门）**：同一个 `toolsApi` 还导出
`insertAtCursor` / `replaceSelection` / `appendToEnd`（`WorkbenchEditor.tsx:204-206`），
它们直通 `tools.*`、**不过** `assertDocumentWritePreconditions`。目前没有生产 Agent 路径调用它们
（脚本只找到定义处），所以不算门；但它们是「下一个人误用即绕闸」的敞口。
（`TextDocumentNode.tsx:88` 的 `replaceSelection` 是画布文本节点自己的编辑器实例，不是本状态。）

## ⑥ 模型目录 / 供应商 key

```
node scripts/door-map.mjs mutateCatalog
node scripts/door-map.mjs --write=upsertApiKey,upsertModelCatalogVendorApiKey,clearModelCatalogVendorApiKey --read=decryptApiKeyRecord,apiKeyDecryptStatus
```
**模型目录 写 17 · 读 0；供应商 key 写 11 · 读 34。**

- 目录守卫 = `applyVendorUpsert:374` / `applyModelUpsert:535` / `applyMappingUpsert:640` 里的
  `guardAntigravityVendorWrite` / `guardAntigravityModelWrite` / `guardAntigravityMappingWrite`
  （antigravity 供应商只在通过连接证明时才可写），叠加 `writeCatalog:246` 的「磁盘版本高于应用版本即拒写」。
  走 `tx.upsert*` 的门自动带守卫；直接改 `state` / `current` 的门绕过。
- Key 守卫 = `applyApiKeyUpsert:447` 的「非空 + `findNonHeaderSafeChar` 非法字符拦截 + `makeApiKeyRecordFromPlain` 加密」。

**带守卫**：目录 14/17（`antigravityCatalog.ts:131`、`catalogCommit.ts:374`、`comfyuiWorkflowImportStore.ts:266`、
`customCallDraft.ts:56/102`、`modelRetype.ts:75`、`integrationSession.ts:394/1015`、`serviceCatalog.ts:135/212/334/466/469`）；
key 11/11（10 扇经 `applyApiKeyUpsert`；`clearModelCatalogVendorApiKey` 的 2 处写空串 `enc:"plain"`，
不经加密/字符校验，属**按构造安全**——无明文可泄——记为带守卫但留一笔）。

**无守卫（4）**：
- `electron/ai/onboarding/vendorHealth.ts:140` — `delete state.apiKeysByVendor[vendorKey].verificationPending` 直改 state（同一 `mutateCatalog` 里另一段走 `tx.upsertModel`，是混合门）
- `electron/catalog/directKeyCredential.ts:100` — `vendor.enabled = true; vendor.updatedAt = …` 直改 vendor 对象，**完全绕过** `guardAntigravityVendorWrite`
- `electron/catalog/validateCandidateCredential.ts:84` — `delete current.apiKeysByVendor[vendorKey].verificationPending`
- `electron/catalog/validateCandidateCredential.ts:89` — `record.enabled = true`，把凭据从未验证转正发布，绕过 `applyApiKeyUpsert` 的 `depublishVendorForDisabledCredential` 对偶逻辑

**这四扇的语义最危险**：改的正是「发布 / 启用」这类安全判断。根因不在这四处，在
**`mutateCatalog` 把可变 `state` 交给回调**这一设计——它让「直改」和「走 tx」在调用点看起来一样合法。

## ⑦ 项目 revision

```
node scripts/door-map.mjs assertCurrentProjectRevision
node scripts/door-map.mjs --write=saveWorkspaceProject,createWorkspaceProject --read=readWorkspaceProject,currentProjectRevision
```
**写 3 · 读 21。**

起点 `assertCurrentProjectRevision` 是**读侧校验**；计数器真正的写者是 `saveWorkspaceProject`
（`workspaceRepository.ts:343`，`revision: existing.revision + 1`），出生值 0 由 `createWorkspaceProject:234` 写。
解析器唯一真相源是 `currentProjectRevision`（`approvalReceiptRuntime.ts:44`）。

守卫 = `withWorkspaceManifestStagedMutation` 的暂存原子事务 + 单调 `existing.revision + 1`
+ `writeWorkspaceSyncBaseline` 的 contentHash 基线。

**带守卫（3）**：`projects/repository.ts:199`、`:212`（出生 `revision: 0`，且「revision===0 ⟺ 零编辑」被 GC 依赖）、`:243`。

**无守卫（1）**：
- `electron/projects/repository.ts:250-252` — `saveProject` 的 legacy 分支直接
  `writeJsonFileAtomic(path.join(projectDir, PROJECT_FILE), record)` 落盘，**不 bump revision、不写 sync baseline、不走 staged 事务**。

诚实标注**后果方向**：这一扇是 fail-**closed** 而非 fail-open——legacy 项目 `readWorkspaceProject` 返回 null
→ `currentProjectRevision` 为 `undefined` → `assertCurrentProjectRevision` 抛 `ReceiptScopeError`。
所以它表现为「legacy 项目上所有受收据保护的操作恒被拒」，不是绕闸。**但它仍是同一状态的第二扇写门**，
而且是那种「用户只会说功能坏了、没人会想到是门的问题」的形状。

---

## 这次普查本身说明了什么

1. **形状是普遍的，不是那三簇特有的。** 七个状态里五个有旁路，合计 **11 扇无守卫写门 + 2 扇未判定**。
   立 R21.3 的依据从「三个样本」变成「七个状态里五个」。
2. **做对的两个有共同做法：守卫写在被调方内部。** ③ 技能与 ⑤ 创作文稿都是这样，于是门数多少都不漏。
   反过来，④ ⑥ 的病因也同一个：把可变 state（`mutateCatalog` 的回调、`workbenchStore` 的 `timeline` 字段）
   交出去，调用点看不出「这样写合不合法」。这是 R28「防线建在最早能拦住的那层」的一个具体判据：
   **能让被调方拦的，别留给调用点。**
3. **脚本不是真相源，是让人能看见的仪器。** ② 的 6 扇「写门」其实是守卫本身在被调用（启发式误报），
   ③ 的二跳消费者脚本看不见。两处都靠人打开文件才判得出。门表的价值不在数字准，
   **在于它把「我扫过了」变成一张别人能逐行复核的清单**。
4. **本文不修任何一扇门。** 11 扇无守卫门各自值不值得修、修在哪一层，是各自的根因合同要答的问题
   （按 R21.3，那些合同必须带 `doors` 与 `door_reduction`）。普查只负责把门摆到桌面上。

**复现**：本文每个数字都来自上面列出的命令，`node scripts/door-map.mjs` 约 1–2 秒出结果。
**行号基线 = `e3d326380`（本分支合入 `origin/main` 之后）**——本文所有 `file:line` 在该提交上逐条核对过一遍；
行号会随代码变动，复现时以当次输出为准，门的**数量与判定**才是本文的结论。
