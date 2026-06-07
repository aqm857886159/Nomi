# P1 设计 — 异步任务底座（存盘 + 主进程后台轮询 + 重启续跑）

> 上位：`docs/plan/2026-06-07-model-onboarding-final-plan.md`（R7 定稿，P1 = 独立期）。
> 决策已拍：P0 收口，开 P1。
> 本文是**设计稿**，待决策表签字 + R7 评审后才动产品码（R3/R4）。
> 依据：2026-06-07 两份研究（当前任务生命周期摸底 + OSS 先例调研）。

## 一句话目标

让"已提交到中转站、还在云端生成"的图片/视频任务，**不再因为切页面 / 关窗 / 重启 app 而丢失**——任务落盘、主进程后台轮询、重启自动续跑、出结果回填到对应节点。

## 为什么要做（现状的根问题）

- 轮询是 renderer 的 `while` 循环（`catalogTaskActions.ts:418-447`），挂在组件调用栈上，**切页/关窗即丢**。
- 任务缓存是纯内存 `TtlLruCache`（`tasks/taskCache.ts`），**进程死亡全蒸发**。
- 重启后断点已确认：`fetchTaskResult`（`runtime.ts:2120-2133`）`taskCache.get` miss → 返回 `failed` + "Local task is not in the pending cache." → 节点被改成 error，**kie 云端其实可能早已生成完，结果被白白丢弃**。

## 关键先例（R6，带出处）

- **InvokeAI** `session_queue_sqlite.py`：better-sqlite3 自写队列；启动时 `_set_in_progress_to_canceled()` 收口。**但它是本地推理**（进程被杀任务就没了）——**我们必须改成"重启重新挂回轮询"，因为任务在云端还活着**。这是抄它时唯一要改的点。
- **Lobe Chat** `asyncTasks(inferenceId) ↔ generations(asyncTaskId, projectId, nodeId)` 双表绑定 + 打开项目时 reconcile。我们已经在 extras 带了 `nodeId`/`projectId`（`catalogTaskActions.ts:356`/`taskApi.ts:91`），落盘即可。
- **ComfyUI** Issue #11540 的坑：**"完成事件 ≠ 结果就绪"**。终态判据必须是"能查到 resultUrls"，不能只信一次完成信号。
- **kie 硬约束**：桌面无公网 → webhook 用不了 → 只能轮询；产物仅 **14 天有效** → 完成即落本地（`localizeTaskAsset` 已实现，复用）。

## 架构（提议）

```
[renderer] 点生成 ──run──▶ [main] runTask
                                 │ 提交 createTask 拿 upstream taskId
                                 ▼
                          [TaskStore 落盘]  ← 单一真相源（替代内存 cache）
                                 ▲                │
            重启 startup 扫 pending│                │ 注册到
                                 │                ▼
                          [TaskPoller 主进程后台轮询]
                                 │ 终态：落本地资产 + 写 result 进 store
                                 ▼
                       ──tasks:event──▶ [renderer 订阅] addNodeResult
                          (兜底：打开项目时 reconcile 回填 + 重挂轮询)
```

五个新件 / 改件：

1. **TaskStore**（新 `electron/tasks/taskStore.ts`）：持久化任务记录，单一真相源。记录形如
   `{ taskId, projectId, nodeId, runId, vendor, mapping, model, request, providerMeta, wantedKind, status, createdAt, updatedAt, result?, error?, expireAt? }`。
2. **TaskPoller**（新 `electron/tasks/taskPoller.ts`）：主进程后台轮询调度（仿 `ExportJobManager`）。启动加载 pending → 自适应间隔轮询 → 终态落资产 + 写 store + 发事件。
3. **事件通道** `nomi:tasks:event`（main→renderer，仿 `nomi:exports:event`）：`{ projectId, nodeId, taskId, result | status | error }`。
4. **renderer 订阅 + reconcile**：订到事件且当前项目匹配 → `addNodeResult`；打开项目时 reconcile（回填已完成未消费的、重挂在跑的）。
5. **删除 renderer while 循环**（R1 加新必删旧）：`waitForCatalogTaskResult` 退役，renderer 改"发起即订阅"，不再自己轮询。

## 决策表（请逐项拍 / R7 复核）

### D1 — 任务存哪

| 选项 | 怎么做 | 好处 | 代价 |
|---|---|---|---|
| **A 按任务一个 JSON 文件**（推荐） | `<userData>/tasks/<taskId>.json`，复用 `writeJsonFileAtomic`，找 pending = 扫目录 | 零 native 依赖、复用现成原子写、贴"本地优先"、任务量几~几十条扫描足够快 | 无索引查询（本规模无所谓）；并发写不同文件天然隔离 |
| B better-sqlite3 | 一张 tasks 表 + 复合索引 | OSS 默认（InvokeAI）；结构化查询强 | **native 依赖、要 @electron/rebuild**、打包复杂度↑；对几十条任务是杀鸡牛刀 |
| C 单个 JSON 文件 | `tasks/queue.json` 全量 | 最简单 | 每次改状态全文件重写 + 自己加锁；任务一多就拖 |

**倾向 A**：本规模下 SQLite 的索引/事务优势收不回它的 native 依赖成本。

### D2 — 重启时"进行中"任务怎么办

| 选项 | 行为 | 评价 |
|---|---|---|
| **A 重新挂回轮询**（推荐） | 启动扫 in_progress，逐个 `recordInfo` 确认：success→回填 / processing→续轮 / expired→failed | **对云端任务正确**——进程死了任务还活着 |
| B 一律 cancel | 抄 InvokeAI 原样 | **错**：那是本地推理场景；用我们这会把还在跑的云端任务误杀 |

### D3 — 结果怎么送回 UI 节点

| 选项 | 做法 | 评价 |
|---|---|---|
| **A 双通道**（推荐） | 实时 IPC 事件 + 打开项目时 reconcile 兜底 | robust：项目关着也不丢，下次打开回填 |
| B 仅事件 | 只靠 IPC push | 项目当时没开就丢 |
| C 仅 reconcile | 只在打开项目时回填 | 没有实时更新，体验差 |

### D4 — 旧的 renderer 轮询循环

| 选项 | 评价 |
|---|---|
| **A 删掉，renderer 改"发起即订阅"**（推荐） | R1 加新必删旧；单一轮询源在主进程 |
| B 留作 fallback | 违反 P1，两套轮询会打架 |

### D5 — P1 覆盖哪些任务

| 选项 | 评价 |
|---|---|
| **A 所有异步任务（图+视频）统一走 store+poller**（推荐） | P4 通用第一；图片的 kie 异步路径同样受益；同步快路径（文本/直返图）不变 |
| B 只视频 | 图片 kie 异步仍会丢；留两套语义 |

### D6 — 是否引入"任务中心" UI

| 选项 | 评价 |
|---|---|
| **A 本期不做 UI，只做底座 + 节点回填**（推荐） | P1 是基础设施期；可见的"全部任务"面板留后续，按 R8 出样张再做 |
| B 顺带做任务中心面板 | 范围膨胀、需 R8 样张、拖慢底座 |

## 内部分期（降低风险，每期可独立验收）

- **P1.1 落盘（低风险）**：TaskStore 落盘 + runTask/fetchTaskResult 改读写 store（行为不变，仍 renderer 轮询）。验收：杀进程重启后 `fetchTaskResult` 不再报 "not in pending cache"，能从盘上还原继续查。
- **P1.2 主进程轮询 + 事件 + 重启续跑**：TaskPoller + `tasks:event` + 启动扫 pending 重挂。验收：关窗/重启后视频仍能后台出片、回填节点。
- **P1.3 reconcile + 删旧**：打开项目 reconcile + 删 `waitForCatalogTaskResult`（R1）。验收：切项目再回来，结果在；renderer 不再有轮询循环。

## 不动项（P1 不碰）

- 描述符化重构（P2）、新增模型（kie 主路之外）、任务中心 UI（D6=A）、音频。
- 同步快路径（文本 chat、直返图）保持现状，不进 store/poller。

## 风险与红线（CTO 视角，待 R7 加固）

- **R1 触碰全量生成热路径**：这是所有图/视频生成的必经之路，改炸 = 全产品不能生成。→ 内部分期 + 每期独立验收 + P1.1 行为不变先验证落盘。
- **R2 节点找不回**：projectId 必须非空才落盘（现状 `getDesktopActiveProjectId()` 切换瞬间可能空——`runtime.ts:2026` 风险点）。→ 落盘前强校验 projectId/nodeId，缺则拒绝进 store（退回同步语义或报错）。
- **R3 孤儿/过期**：节点已删 / taskId 过期（kie 14 天）→ reconcile 丢弃 + 定期清理终态（抄 InvokeAI prune）。
- **R4 重复回填**：事件 + reconcile 双通道可能回填两次 → 以 `runId`/`resultId` 幂等（`addNodeResult` 找不到 node 已 return，需再加"已消费"判定）。
- **R5 轮询风暴**：多任务并发 + 1.5s 间隔可能撞 kie 限流（20 req/10s）→ 全局并发上限 + 自适应退避（图 2-3s / 视频 5-10s）。

## 验收门（P3）

1. 真体感：发起视频 → **关掉 app** → 重开 → 节点自动出片（需真 key，与 S1 enum 真测合并）。
2. 切项目再回来，进行中/已完成任务都正确呈现。
3. 杀进程重启不再出现 "not in the pending cache"。
4. CI 五门全过。

## R7 六角色评审定稿（2026-06-07）

**全员 GO-with-changes，无 NO-GO。** 决策表 D1=A / D2=A / D3=A / D4=A / D6=A 六角一致通过。以下是评审带来的修订与新增。

### 决策表更新

- **D5 修正**：原描述自相矛盾。定为 **异步路径进 store；同步快路径（文本 chat、直返图）显式不进 store**（CTO）。是否进一步**收窄到只视频**（图片留 P2 描述符化顺带）——PM 主张收窄使验收更尖锐，列为**待你拍的岔路**（见下）。
- **D7 新增（设计师+PM+真实用户三方强烈要求）= A 做最小可见集**：底座期若零可见改动，用户感知为零，且会因看不到"在跑"而误点重生成 → 双倍扣费 + 孤儿任务。最小可见集（成本 <0.5 周）：
  1. 节点 chip 增 `后台生成`（可离开）/ `恢复中`（重启核对中）/ `已过期`（warning 弱色，**非 danger 红、不写进 node.error**）状态。
  2. 占位文案分级（"在后台继续生成 · 关掉也安全" / "正在重新确认任务状态…"）。
  3. reconcile 到完成任务时一条极简 toast（"你不在时有 N 个视频跑完了"）；同项目用"刚到货"描边动效，**不弹系统通知**。
  4. 失败节点给"重试查询"按钮（用已有 taskId 再查一次，非重新生成）。
  - 需 R8 出样张 S1–S7（设计师已列）；需新增 1 个 token `--workbench-warning`（设计稿登记）。

### CTO 红线（不满足不开工）

- **L1 单一轮询源**：P1.2 上线即删 `waitForCatalogTaskResult`，不留 fallback；`nomi:tasks:result` 必须改纯读快照（无 upstream 调用副作用）或改名 `tasks:snapshot` 强制迁移——**最担心点：两个进程轮询同一 upstream taskId → kie 限流灾难，单测/手测照不出**。
- **L2 projectId/nodeId 强校验**：缺则拒绝进 store（`runtime.ts:2026` 现在只 trim 不校验）。
- **L3 幂等回填三层去重**：node 存在 + node 当前 result.taskId≠本任务 + store record 未 consumed。
- **L4 单任务 JSON `raw` 上限 256KB**（截断保留标记）。
- **L5 全局并发 ≤8 + 令牌桶 18/10s + 自适应退避（图 2s→8s / 视频 5s→30s）+ 429 全局冷却**。
- **L6 Reaper**：终态保留 24h 后删；`createdAt+14d` 过期判 failed；hydrate 后跑一次 + 每 6h。
- **L7 写盘失败不阻断主流程**：降级为"本次仍可完成但无续跑"，不让磁盘满/权限错卡死全产品生成。
- **L8 hydrate 必须在 IPC 注册之前**：`taskStore.hydrate()` → `taskPoller.start()` → `ipcMain.handle`。
- **加 P1.1.5 双跑对账期**：主进程 poller 影子运行（只写 store 不被 UI 消费），与 renderer 实拿结果哈希对账连续 ~50 次一致再翻 flag。env 兜底开关 `NOMI_TASK_STORE_DISABLE=1`。
- **砍**：`expireAt` 字段（靠 createdAt+14d 算）、TaskPoller 的 strategy pattern（P1 只有 kie，if/switch 即可）、providerMeta 只白名单持久化 `{query_id,task_id,attemptCount,lastPolledAt}`（防 signed URL 落盘）。

### 前端必改（否则破坏批量生成）

- **D4 不是 fire-and-forget**：`waitForCatalogTaskResult` 重写为"向主进程注册 pending（runId+taskId）→ 返回由事件 resolve 的 Promise"，使 `runGenerationNode` 那行 `await executor(...)` 一字不动，`runGenerationNodesBatch` 的并发上限/successes-failures 汇总/retry for 循环/storyboard"全部生成"**全部零变更**。直接 fire-and-forget 会把"全部生成"变成"全部排队"撞限流、汇总失真。
- **事件 payload 必须带 runId**（不只 taskId）：`addNodeResult` 加 runId gate，否则"同节点没等结果就重新生成 → 旧任务结果回填到新 run"是真 bug。
- 应用级单订阅（`NomiStudioApp.tsx:128` 附近），不做节点级；reconcile 在 `restoreWorkbenchProjectPayload` 之后触发；事件 listener 用 `getDesktopActiveProjectId()` 校验项目匹配再 dispatch。
- 重启后 spinner 必须"重新有主"（reconcile 推 running 进度续上 pendingMap），不靠 renderer 自己重发 runTask（防重复提交）。

### 后端落地要点

- **P1.1 用 dual-write 影子模式**：先并行写 store + 在 `fetchTaskResult` cache-miss 分支加"读 store 兜底"，**直接修掉 "not in pending cache" 崩盘根因且对 renderer 透明、近零风险**。
- 抽 `pollTaskOnce(record): PollResult` 纯函数（不依赖内存 cache），保留 fallback 非映射分支（`runtime.ts:2179`）。
- **三个坑**：① `localizeTaskAsset` 后台写 project.json 与 renderer save 的跨进程竞争 → per-projectId 写队列；② `findExecutableModel` 在模型被删时抛错 → poller 必须 catch 标 failed（`expireReason:'model-removed'`）；③ `taskCache.set` 两处（`runtime.ts:2044`+`2090`）改造都要动。
- **绝不落明文 apiKey**：只存 vendorKey 字符串，轮询时重新派生（现状 `runtime.ts:2136` 已如此），落盘前加 `assert(!('apiKey' in record))`。
- 工作量：**9–12.5 人日**（约 2.5–3 周一人全职），非原估 5–8 周。

### 验收门补强

- P1 验收门 #1（关 app 重开自动出片）**需真 key**，与 P0 的 S1 enum 真测合并。
- 回归三用例：①storyboard 5 个视频"全部生成"验并发≤2+汇总弹窗；②同节点连续重跑验旧事件不污染新 run；③重启 spinner 重新有主 + 项目切换事件不串项目。

### 两个评审推翻/挑战的判断 → 必须你拍（见文末决策）

1. **verify-first 顺序**（PM 强烈）：我们把 enum 真测按"零额度"延后了，但 P1 是在"视频真能出片"这个**尚未验证**的假设上盖 3 周底座。若 enum/响应解析其实是错的（ComfyUI #11540 那类坑），P1 会续到一条本就跑不通的管子上、返工放大。PM 建议**动 P1 代码前先花 2–3 小时做一次 kie 视频真 key 冒烟**（一次成功+一次失败，看清响应体）。这与你之前"零额度"的决定冲突，需你重新拍。
2. **优先级是否真是 P1**（真实用户强烈）：扮演的真实创作者把"关 app 不丢"排在**并发生成（一次发 6 个）、失败说人话+重试、prompt 复用**之后——这三个是"每天痛"，关 app 不丢是"低频底裤"。即"能并发 6 个视频"比"能关软件"更值得现在做。这挑战了 P1 是不是下一步的最优选。

## 待办：动代码前

- [ ] 用户拍：verify-first 顺序（先冒烟 vs 直接开 P1）。
- [ ] 用户拍：优先级（坚持 P1 vs 转并发生成/每日痛）。
- [ ] 用户拍：D5 是否收窄到只视频。
- [ ] D1 已定 A（文件 JSON，零 native 依赖），无需 Context7。
