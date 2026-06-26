# 视频生成超时不丢 · 任务找回（三态 + 无状态重查）

> 2026-06-25 · 用户拍板「自动接着拉、无感找回 + 手动入口兜底」+ 样张已确认（紫方块占位，落地用 NomiLoadingMark 品牌 logo）。

## 1. 真实摩擦（为什么做）

异步视频生成走「提交任务 → 轮询状态」。轮询到上限（视频 5 分钟）就 `throw('模型任务轮询超时')`，节点直接打成 `error`，和「API key 错 / 内容被拦 / 真失败」挤在同一个红色错误桶里。但上游（即梦 / Seedance / apimart / kie）任务往往**仍在跑、甚至已经出片了** —— 用户只能离开 App 去上游后台手动下载导入。这正是 Nomi 要消灭的「跳出去操作」摩擦。

## 2. 根因（两层，P2）

1. **renderer 层**：超时直接 `throw` 进 error 桶丢弃（[catalogTaskActions.ts:177](../../src/workbench/generationCanvas/runner/catalogTaskActions.ts) → [generationRunController.ts:168](../../src/workbench/generationCanvas/runner/generationRunController.ts)）。**没有「超时≠失败」的状态**，也没有「再拉一次」的入口。
2. **主进程层**：续查所需上下文（mapping.query / model / providerMeta / request）只活在内存 `taskCache`（[runtime.ts:157](../../electron/runtime.ts)，TTL 1 小时、上限 200、**重启即空**）。缓存 miss 后 `fetchTaskResult` 只返回 `task_tracking_lost` 文案，**不真去重查**。

**关键事实（让治本变干净）**：续查只需 `{vendor, modelKey, taskKind, taskId, prompt}` 五个字段——
- `taskId` 已持久化在 `node.runs[0].taskId`（[canvasRunActions.ts:51](../../src/workbench/generationCanvas/store/canvasRunActions.ts) 写入，`mergeRunRecord` 转态保留，[generationCanvasSchema.ts:55](../../src/workbench/generationCanvas/model/generationCanvasSchema.ts) 落盘）；
- `vendor / modelKey` 在 `node.meta`，`taskKind` 可由 `resolveTaskKind(node)` derive，`prompt` 是 `node.prompt`；
- renderer→main 的 DTO `FetchWorkbenchTaskResultRequestDto`（[taskApi.ts:66](../../src/workbench/api/taskApi.ts)）正好就携带这五个字段。

所以「重启后还能拉」**不需要把整个内存缓存搬上磁盘**——只要让 `fetchTaskResult` 在缓存 miss 时用这五字段**无状态重建** query 上下文。`mapping`/`model` 都是 `findExecutableModel(vendor,modelKey,kind)` + `findTaskMapping(vendor,kind,modelKey)` 的纯函数产物；`providerMeta` 用 `{task_id: taskId, query_id: taskId}` 兜底（kie/apimart/dreamina 的 query op 模板就是 `{{providerMeta.task_id}}`）。

## 3. 设计（三态，用户拍板）

| 阶段 | 节点状态 | 表现 | 谁触发 |
|---|---|---|---|
| ≤5 分钟正常等待 | `running` | 现状：NomiLoadingMark 转圈 + 顶部「生成中」徽标 | 现有轮询 |
| 超 5 分钟仍在跑（**自动找回**） | `running`（不变） | 同上，徽标文案改「仍在生成 · 已超常规时长」，后台**静默续拉到 ~20 分钟**，出片自己回节点 | 软超时后延长轮询 |
| 续拉窗口耗尽 / 重启 App 后（**手动兜底**） | `recoverable`（新增） | 非红色面板：「任务可能已在上游完成」+「重新拉取结果」按钮（IconRefresh，中性/accent，非 danger） | 硬超时 throw 可恢复错误 / 重启检测 |

**核心取舍（用户已拍）**：自动续拉总时长上限 = **20 分钟**（5 分钟常规 + 15 分钟延长）。超 20 分钟才落 `recoverable` 手动态。

「重新拉取」是 query 不是 generate，**不铸付费令牌、不弹确认**（runTask 才扣费，fetchTaskResult 是查询）。

## 4. 改动清单（按层）

### Layer 1 · renderer 轮询与状态机
- **新增节点/run 状态 `recoverable`**：
  - `generationCanvasTypes.ts`：`GenerationNodeStatus` 加 `'recoverable'`；`GenerationNodeRunStatus` 同步（转态会写 run.status）。
  - `generationCanvasSchema.ts`：`generationNodeStatusSchema` + `generationNodeRunStatusSchema` 加 `'recoverable'`（向后兼容：旧文件无此值；不向下降级）。
  - `nodeSizing.ts` `STATUS_LABEL`：不需要徽标文案（recoverable 走专用面板，showStatusBadge 不含它）。
- **`catalogTaskActions.ts` `waitForCatalogTaskResult`**：
  - 视频 kind：`softTimeoutMs`=300000（5min，仅切换文案）、`hardTimeoutMs`=1200000（20min，真停）。非视频维持 120000。
  - 过 soft 之后每 tick 进度文案改 `narrateProgress('still-generating', …)`（新增阶段），状态仍 `running`。
  - 过 hard → `throw new RecoverableTimeoutError({ taskId, vendor, taskKind, modelKey })`（新类型，携带重查所需字段）。
- **`generationRunController.ts` `runGenerationNode` catch**：`error instanceof RecoverableTimeoutError` → `setNodeStatus(id, 'recoverable', message)`，仍 `throw`（调用方知道没出结果）。其余维持 `'error'`。
  - `isRetryableGenerationError`：可恢复超时**不**进网络重试（它不是网络抖动）。

### Layer 2 · 主进程无状态重查（治本核心）
- **`runtime.ts` `fetchTaskResult`**：`taskCache.get` miss 后，若 payload 带 `vendor+modelKey+taskKind+taskId` → 重建：
  - `wantedKind = billingKindForTaskKind(taskKind)`；`findExecutableModel(vendor, modelKey, wantedKind)` → vendor/model/apiKey；`findTaskMapping(vendor, taskKind, modelKey)` → mapping。
  - 有 `mapping.query` + model → providerMeta `{task_id:taskId, query_id:taskId}`、request `{kind:taskKind, prompt, extras:{modelKey}}`，走与缓存命中**同一段** `executeProfileOperation(query)` + `buildProfileTaskResult`。终态成功则归一返回；仍非终态 `admitTask` 重新入缓存（续后续轮询）。
  - 重建失败（无 mapping / model 找不到）→ 回落现有 `classifyTaskCacheMiss`（诚实报 tracking_lost）。
  - 抽出公共「跑 query 段」复用，避免与缓存命中分支重复（R9）。
- **dreamina（process transport）风险**：query op 走 `processOperation`，需验 `executeProfileOperation` 在重建路径也能路由到 process transport（设备码登录态在 CLI 侧，应不依赖内存缓存）。落地时实测；不通则该 vendor 仅走内存缓存命中路径（诚实降级，文案标明）。

### Layer 3 · UI 与找回动作
- **`BaseGenerationNode.tsx`**：`status === 'recoverable'` → 渲染新 `NodeRecoverableReport`（参照 `NodeErrorReport` 结构，但**非红色**：中性/info 底，IconClockPause + 「任务可能已在上游完成」+ 人话 + 「重新拉取结果」WorkbenchButton(IconRefresh) + 次级「标记为失败」）。`isGenerating` / `showStatusBadge` 不含 recoverable（无 spinner、无徽标）。
- **新 action `recoverNodeResult(nodeId)`**（生成域）：从节点重建 `{taskId, vendor, taskKind, prompt, modelKey}` → `fetchWorkbenchTaskResultByVendor` 轮询到终态（复用 `waitForCatalogTaskResult` 的等待，传 initialResult=查询首响应）→ 成功 `addNodeResult`，失败落 `error`。拉取中 UI 显示 NomiLoadingMark。

### Layer 4 · 重启检测
- **`normalizeStoreSnapshot`**（画布载入归一）：持久化节点 `status ∈ {running, queued}` 且 `runs[0].taskId` 存在 → 收敛为 `recoverable`（无 live 轮询循环了，给手动入口）。无 taskId 的 queued → `idle`（从没真启动）。

## 5. 不动项
- 不改付费闸 / 不为 recoverable 铸令牌（query 免费）。
- 不做「项目载入即自动批量重查」（避免每次开项目的隐性网络风暴）——重启场景按拍板走手动按钮。
- 不改时间轴 / 导出 / 其它 vendor 接入。
- 不持久化整个 taskCache（无状态重建已覆盖重启）。

## 6. 回滚
单点回滚：Layer 1 的 throw 改回 `Error('模型任务轮询超时')`、Layer 2 的 miss 分支回落原 `classifyTaskCacheMiss`、UI 删 recoverable 分支即恢复旧行为。`recoverable` 是新增枚举值，旧文件不受影响。

## 7. 验收门
- 五门全过（filesize→tokens→lint→typecheck→test→build）。
- 新单测：① 无状态重查（缓存 miss + 五字段 → 真发 query → 终态）；② recoverable 分流（RecoverableTimeoutError → status recoverable 非 error）；③ 重启收敛（running+taskId snapshot → recoverable）。
- R13 真机走查：模拟超时（缩短 hardTimeout / 注入 fetch）→ 看到「仍在生成·已超常规时长」→ 落 recoverable → 点「重新拉取结果」→ 出片回节点。截图人眼判断（非红色、logo 是品牌 mark）。

## 8. 风险
- 加 `recoverable` 到 status 联合 → 排查所有 `switch(status)` 穷尽断言，逐一处理（impl 时 grep）。
- 批量 `runGenerationNodesByPlan`：recoverable 仍被 catch 当 throw 落 failures[]，会把下游标「上游本批失败」。罕见（下游 video 通常不与未完成 video 同批），本轮接受；如真出现，后续把下游也标 blocked/recoverable。
