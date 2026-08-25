# P5 E1 采纳桥——产物进时间轴收敛为唯一受控通道

**日期**：2026-08-25 · **分支**：`claude/p5-e1-adoption-bridge` · **合同**：
`docs/superpowers/plans/2026-08-22-nomi-unified-editor-runtime.md` §5「P5：剪辑区 Adopt 窄接入」
+ `docs/superpowers/plans/2026-08-24-unified-agent-master-plan.md` §5.1「E1 采纳桥」
+ `docs/audit/2026-08-25-p4-acceptance-checklist.md` §5.3「时间轴连片」（范围裁定归本片）。

---

## 1. 为什么做这件事（底层逻辑 · D6①）

**真实摩擦不在按钮上，在按钮后面。** 用户现在点「加入时间轴」，片段就直接落轴了——看着挺好，
问题是这条路上**没有任何东西记得这次采纳是怎么发生的**：

- 同一个产物点两下 → 轴上多一份（末尾 startFrame 不同 → clip id 不同 → 去重失效）；
- 点的时候节点已经重出了 V2 → 落的还是你眼睛看到的那张缩略图对应的**旧那版**，没人告诉你；
- 批量拼片落 12 个镜头 → 撤销栈压了 12 层，用户要按 12 次 Cmd+Z 才回得去；
- 更根本的：**生成模块能绕过任何检查直接写轴**。今天是 5 个入口各写各的，明天加第 6 个，
  这几条不变量就得再抄一遍——抄漏一处就是一类 bug 的入口。

**所以 E1 不是加功能，是把已经存在的那两条路收进一个闸门。** 用户看到的形态一个字不改
（「加入时间轴」还是那个按钮，「一键拼成初稿」还是那行提示），改的是它背后走谁：
从「组件直接调 store 写轴」变成「组件提一份 Proposal → 闸门查四道 → 原子 apply → 回执带撤销」。

**核心取舍（D6②）**：形态不变 vs 语义收紧。我们**不**新增「采纳」按钮、不新增确认弹窗——
那会给用户凭空加一步（违反 D1，effect-first）。代价是：Proposal 这层对用户是**隐形的**，
它只在「重复点」「产物换版了」「轴动过了」这三种此前会静默出错的情况下才现身，
现身方式仍是既有词汇（toast），不是新面板。

---

## 2. 范围

### 2.1 做

| 项 | 内容 |
|---|---|
| 提案模型 | `AdoptProposal`：幂等键 `(runId, contractHash, artifactId, artifactVersion, baseRevision, destination)` |
| 提案登记处 | 进程内 registry：同键重复请求返**原** Proposal，不创建竞争提案 |
| 新鲜度判定 | `baseRevision` 变（轴动过）→ `stale`；`artifactVersion` 变（产物换版）→ `needs_attention` |
| 原子 apply | 整批一次 `setTimeline`，全成或全不成；失败走 compensation 回滚到 `baseTimeline` |
| 补偿失败 | 补不回去 → `needs_recovery`，**保留旧态**（不留半落的轴） |
| 一步 Undo | 整次采纳（1 个或 N 个 clip）= **1 层**撤销栈；回执 toast 带「撤销」 |
| 收敛 | 5 条直写路径全部改走闸门，旧直写代码删除 |
| 铁律门岗 | `check:adoption-bridge`——生成/画布模块直调 `addTimelineClipAtFrame` 即报红 |

### 2.2 不动（明确不做）

- **不改 UI 形态**：不加「采纳」按钮、不加确认弹窗、不改按钮文案与位置。
  合同要求「用户能看到、批准、撤销一个生成结果」——现有「点击 = 批准」已满足「批准」语义，
  再加一层确认是给用户加摩擦（D1）。若后续要显式提案面板，那是独立样张 + 拍板的切片。
- **不迁 Timeline owner**：时间轴仍是事实源（合同 §5 明写「必要时只做 projection/adapter，
  不启动全量 EditorDocument v2」）。
- **不动 `workbenchStore.ts`**：它正好 800 行（`check:filesize` 上限），一行都加不得。
  新增的 store 动作放独立模块，通过 `useWorkbenchStore.setState` 写入。
- **不动素材库→时间轴**（`addAssetToTimeline`）：素材库拖的是**用户自己的素材**，
  不是「生成产物」。铁律管的是「生成模块不能绕过 Proposal 落轴」，素材导入不在其内。
  （门岗白名单显式列出并注明理由，防后人误以为是漏网。）
- **不动 `electron/capabilityCore/*`、`electron/preload.ts`、`rendererBridge.ts`**（避让 MCP 加固 agent）。
- **不动 `generationCanvas/spend/*`、`anchorCheckpointView*`**（避让清债批 agent）。

---

## 3. 收敛映射表（旧写轴路径 → 新走法）

实扫结果：全仓写时间轴的生成入口共 **6 条**（`grep -rn addTimelineClipAtFrame src/`，排除测试）；素材库和轴内编辑另列为受控非生成路径。

| # | 旧路径 | file:line | 用户可见形态 | 新走法 | 删除 |
|---|---|---|---|---|---|
| 1 | 节点「加入时间轴」点击贴尾 | `timeline/addNodeToTimelineEnd.ts:23` | 按钮不变 | `adoptGenerationNode({ placement: 'append' })` | 整个 `addNodeToTimelineEnd.ts` 的直写体（26 行）→ 改为薄壳转发 |
| 2 | 节点拖拽自选位置 | `generationCanvas/nodes/useNodeDragResize.ts:332` | 拖拽不变 | `adoptGenerationNode({ placement: { atFrame } })` | 直写 + 手搓 build/insert（9 行） |
| 3 | 「一键拼成初稿」/ AI 拼片 | `timeline/TimelinePanel.tsx:120` → `arrangeStoryboardToTimeline` | 提示行不变 | `adoptStoryboardBatch()`（内部仍用 `planStoryboardTimeline` 排序） | `sendStoryboardToTimeline.ts` 的 `placeUnitsSequentially` 逐个直写循环 |
| 4 | Agent 工具 `arrange_storyboard_to_timeline` | `agent/applyCanvasToolCall.ts:575` | 无 UI | 同 #3（共享同一闸门） | — |
| 5 | Capability apply handler | `capability/capabilityApplyHandler.ts:532` | 无 UI | 同 #3 | — |
| 6 | Agent `send_to_timeline` | `generationCanvas/agent/generationCanvasTools.ts:125` → `sendGenerationNodeToTimeline.ts` | 无 UI | `adoptGenerationNode({ placement })` | 删除 ports 直写适配器（106 行改为桥适配器） |
| — | 素材库→时间轴 | `timeline/addAssetToTimeline.ts:79,90` | 不变 | **不收敛**（非生成产物，见 §2.2） | — |
| — | 时间轴内拖放落位 | `timeline/TimelineTrack.tsx:144,157` | 不变 | **不收敛**（轴内编辑，非采纳） | — |

> #4/#5 与 #3 共用 `arrangeStoryboardToTimeline`，收敛 #3 即三处同时收敛——这正是
> 「修根因不修症状」（P2）：闸门装在**汇流点**，不是装在三个调用方各一份。

---

## 4. 设计

### 4.1 幂等键怎么落到本仓真实字段

合同给的是 `(runId, contractHash, artifactId, artifactVersion, baseRevision, destination)`。
本仓 canvas 侧的真实对应物（`generationCanvasTypes.ts` / `workbenchStore.ts` 实查）：

| 合同字段 | 本仓来源 | 缺省时 |
|---|---|---|
| `runId` | `node.result.provenance.agentRunId` / `node.progress.runId` | `'local'`（手动生成无 run） |
| `contractHash` | `node.result.provenance.modelKey + seed + params` 的稳定摘要 | 由 provenance 派生，无 provenance 用 `result.model` |
| `artifactId` | `node.result.id`（GenerationNodeResult.id） | 必有 |
| `artifactVersion` | `node.result.createdAt`（重出即变） | 必有 |
| `baseRevision` | **从 timeline 内容派生的稳定摘要**（见下） | 必有 |
| `destination` | `'timeline:<trackType>@<placement>'` | 必有 |

**`baseRevision` 为什么不用 `persistRevision`（实查后改口，记在这里防后人重蹈）**：
第一版方案打算直接用它，实扫 `workbenchStore.ts` 后发现**它不是时间轴的 revision，是整个文档的脏计数器**——
`addCategory:271`、`renameCategory:282`、`setStoryboardPlan:398`、`commitStoryboardPlan:409`
这些**跟时间轴毫无关系**的操作也在 bump 它。拿它当 `baseRevision`，用户改个分组名就会把
在途提案判成 `stale`——这是**假 stale**，比不检还糟（用户会觉得系统在无理由拒绝他）。

改用**从 timeline 内容派生**（derive 不 hardcode）：`timelineRevisionOf(timeline)` =
对「所有 clip 的 (id, trackType, startFrame, endFrame) + textClips + transitions」算稳定摘要。
好处是它**只随轴的实际内容变**，且天然对 undo/redo 正确（撤回到同一个轴 = 同一个 revision，
而计数器永远只增、撤回后仍判 stale——那也是假 stale）。

**幂等的具体语义**：同键 = 同一次采纳意图。第二次请求**不重新写轴**，返回第一次的 Proposal
（含它落的 clipIds）。用户体感：连点两下「加入时间轴」，轴上只多一份，第二次 toast 说「已在轴上」。

### 4.2 四道闸

```
request → ① 键归一 → registry 查同键
                        ├ 命中且 applied → 返回原 Proposal（幂等，不写轴）
                        └ 未命中 → ② 新鲜度
                                    ├ artifactVersion ≠ 登记版 → needs_attention
                                    ├ baseRevision ≠ 当前 persistRevision → stale
                                    └ ok → ③ 构建整批 clips（纯计算，不写）
                                            └ ④ 原子 apply（一次 setTimeline）
                                                ├ 成 → 回执（clipIds + undo）
                                                └ 败 → compensation 回 baseTimeline
                                                        ├ 成 → failed（旧态完好）
                                                        └ 败 → needs_recovery（保留旧态）
```

③ 和 ④ 分开是原子性的关键：**先全部算完再一次性写**。旧路径是「算一个写一个」，
第 7 个算失败时前 6 个已经在轴上了——那就是「半落的轴」。

### 4.3 一步 Undo 怎么做到

现状：`addTimelineClipAtFrame` 每次都 `pushTimelineUndo`，N 个 clip = N 层栈。
新法：apply 走**一次** `setTimeline` + **一次** `pushTimelineUndo(baseTimeline)`。
用户按一次 Cmd+Z，整批 12 个镜头一起消失——这与 P4 S5「编组一步撤销」的既定手感一致
（见 `docs/audit/2026-08-25-p4-acceptance-checklist.md` §5.3）。

回执 toast 走既有 `showUndoToast`（`src/utils/showUndoToast.ts`，全仓已有 3 处在用），
点「撤销」= 调 `undoTimeline()`。不新造 toast 变体。

### 4.4 铁律门岗（P2 通用性判定 → 棘轮）

`scripts/check-adoption-bridge.mjs`：扫 `src/workbench/generationCanvas/**` 与
`src/workbench/timeline/addNodeToTimelineEnd.ts`，命中 `addTimelineClipAtFrame(` 即报红，
除非文件在白名单基线里。基线**只减不增**。

**加规则必须先验它会红**（R17）：写完规则先故意在 `useNodeDragResize.ts` 插一行直写，
跑门岗确认报红，再撤掉。证据记在本文档 §7。

---

## 5. 文件清单

**新增**
- `src/workbench/adoption/adoptionProposalKey.ts` — 幂等键归一（纯函数）
- `src/workbench/adoption/adoptionProposalRegistry.ts` — 提案登记 + 幂等命中
- `src/workbench/adoption/adoptionApply.ts` — 原子 apply / compensation / needs_recovery（纯函数，端口注入）
- `src/workbench/adoption/adoptionTypes.ts` — `AdoptProposal` / 结果判别联合
- `src/workbench/adoption/adoptGenerationNode.ts` — 单产物入口（#1 #2）
- `src/workbench/adoption/adoptStoryboardBatch.ts` — 批量入口（#3 #4 #5）
- `scripts/check-adoption-bridge.mjs` + baseline
- 单测 6 个（键/registry、原子 apply、补偿、批量/单产物） + 走查 1 个

**改**
- `timeline/addNodeToTimelineEnd.ts`（直写体 → 转发）
- `generationCanvas/nodes/useNodeDragResize.ts`（直写 → 闸门）
- `generationCanvas/agent/sendStoryboardToTimeline.ts`（`placeUnitsSequentially` 逐个写 → 整批算+一次写）
- `src/i18n/locales/timelineEditor.ts`（3 条新文案，**仅此一个 locale 文件**，避让清债 agent）
- `package.json`（门岗脚本）

**每个文件 ≤800 行**（R9）；新增模块最大预计 ~180 行。

---

## 6. 验收门

| 门 | 判据 |
|---|---|
| E2E / 单测 | 单产物采纳 · 批量按分镜顺序 · 幂等返原提案 · stale（轴变）· needs_attention（产物换版）· apply 中断补偿 · needs_recovery · 一步 Undo 复原 |
| 走查 | `tests/ux/adoption-bridge.walk.mjs`：真 UI 走「产物 → 加入时间轴 → 预览有段 → Undo 复原」；`proveProbe` + `expectAbsent` 阳性对照；光/暗截图**亲读** |
| 铁律 | `check:adoption-bridge` 先验会红，再全绿 |
| 五门 | filesize / tokens / i18n / heavy-path / test-waits / walkthroughs / lint:ci / typecheck / test / build 全链**真退出码**（不接管道） |

## 7. 回滚

单 PR、单分支。回滚 = revert 该 PR：5 条路径回到直写，门岗随之移除。
无数据迁移、无持久化格式变更（Proposal registry 是**进程内**的，不落盘）。

## 7.1 门岗证据

`node scripts/check-adoption-bridge.mjs` 已先在移除旧 `send_to_timeline` 直写后运行，当前输出
`✅ adoption bridge 铁律通过：生成模块无 addTimelineClipAtFrame 直写`；该命令已接入 `pnpm run gates`。

## 8. 风险

| 风险 | 处置 |
|---|---|
| 假 stale（轴没动却判 stale）| 已在 §4.1 处置：`baseRevision` 从**轴内容**派生，不用文档级 `persistRevision`（实查发现后者被改分组名/存方案 bump）|
| Proposal registry 内存泄漏 | 上限 200 条 LRU，进程内不落盘 |
| 批量整批一次写 → 大批量卡顿 | 整批算完一次 set 比 N 次 set **更快**（N 次 = N 次渲染）；不引入同步图像编码（`check:heavy-path` 在门） |
