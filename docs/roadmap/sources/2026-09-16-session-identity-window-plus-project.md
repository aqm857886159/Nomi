# 2026-09-16 · Agent 会话身份证 = 窗口 + 项目（上下文，不只是结论）

> 📎 原料 · 2026-09-16 · 对应待办 [T-AG-16](../TODO.md)
> 这是 #802 列车上连续修「画面口冻死」时攒下来的现场，不是方案正文。
> **派工前先读完这一份。** 只抄最后「窗口+项目」四个字开写，就会再补一刀 freeze 点。
> 方案细节进独立 PR 的 `docs/plan/`，不要把下面整段抄进 TODO 表。

---

## 0. 先把结论放在这，但不要只带着走

**用户拍板（2026-09-16）**：会话身份证必须改成 **窗口 + 项目**。画面口 / surface epoch 不是身份证，只在动手那一瞬间从当前帧解析。#802 只许把 execute 现问口补上再合；结构另开一刀，挂 T-AG-16。

下面才是为什么会拍成这样、中间踩过什么、哪些绿是假的。没有这些，下一刀还会修成「再 recapture 一次」。

---

## 1. 这件事是从哪条用户任务里冒出来的

用户要的不是修一把钥匙。用户要的是：把 integration PR **#802**（`integration/release-20260915`）合进 `main`。进度 = `main` 上的 commit。合完再关列车里那些个人 PR（#765 #781 #788 #792 #794 #796 #797 #800；#787 只留预览半刀），那些分支不要删。

列车里一路 CI 红。和这条结构债直接相关的，是 Linux E2E **`resident-composer-receipt-fix`**：

- 走查在**创作面**跟常驻 Agent 说话，文稿写成功，receipt revision 已经是 2
- 再 `openCanvas` 切到生成面
- `make_artifact` 失败
- 画布 `generationCanvas.nodes.length` 一直是 0
- 工具回执：`surface_port_unavailable`
- `Next: Read the current surface again and use its current identifiers and revision before retrying.`
- 断言在 `tests/ux/resident-composer-receipt-fix.e2e.mjs:168`：期望 `isError: false`，得到 `true`

用户体感：对话还在，Agent 却突然「碰不到画布」。不是没接模型，不是额度，是同一条常驻线程跨面之后，手里那把画面口已经作废。

同期 Quality Gate（HEAD `ecdb531fc` 一带）：Contracts / Unit / Canvas Acceptance / Mac Package 绿；**E2E Walkthroughs (Linux) 红**。6/7 旅程过，挂的就是这一条 resident-composer。

---

## 2. 同一把冻口，冻点滑了三次（这是上下文的主干）

设计里有一个短命东西：`CapturedCanvasReadPort`。它绑的是 **这一帧 renderer 的 surface epoch**。tab 一切、URL step 一变、owner 帧一换，旧 token 就变成 `surface_port_stale` / `surface_port_unavailable`。

常驻 Agent 的 lane 却是长命的：一个窗口里对着同一个项目说话，创作 → 分镜 → 生成 → 预览都是同一场对话。

把短命口揣进长命 lane，就是这次的类根因。每一次「修好」都只是把冻的时刻往后挪。

| 次序 | 冻在哪 | 当时以为修好了什么 | 真实结果 |
|---|---|---|---|
| 第 1 刀 | `openWorkspace`：打开项目那一次 IPC 抓口，冻进 `canvasWrite` adapter | 切 tab 不再用打开项目时的口 | Linux 仍红。发送时 prepare 其实已经能现抓，失败发生在更后面 |
| 第 2 刀 | `liveShared()`：每次 prepare / 读都用 `currentEvent()` 现抓 | 打开时不再冻；合同写「MCP 本来就每调用重抓」当对照 | Linux **还是**红。prepare 过了，execute 仍失败 |
| 第 3 刀（#802 允许做的最后一刀用法补丁） | execute 仍握着 prepare 纪念品：`liveAdapters` Map，以及生产路径 `resolveCanvasWritePort(target.capturedPort)` 用的是 prepare 铸进 invocation 的 token | — | 回执形态是 `resultOf(decision)`：`nextAction` 那句「再读一次当前画面」证明 **prepare 成功、execute 返回 `{ok:false, code:surface_port_unavailable}`** |

第 2 刀还叠了一层掩盖：`liveShared` 那次 commit 给走查加了「等最后一次工具 `<details data-status="output-error">`」的 240 秒等待。那个 error 藏在 v4 折叠 process 里，测试空耗 240s。后来用测试-only commit `ecdb531fc` 拆掉这段等待，产品失败才重新露出来。**拆等待不是修根因。**

用户原话口径（会话拍板，不是微信备忘）：

- 「上次修复的是症状不是结构」
- 「那你得记一下 我们之后得改这个结构」
- 「我觉得是不是你必须把结构都修好才能合并 否则一直会出问题」
- 「可以」——同意 #802 先做 execute 现问口，结构作为 **合入后立刻做的下一 PR**
- 「一定要把问题记录下来……我们不是有个 todolist 吗」
- 「要记录上下文 而不只是结论」

拍板后的分工：

- **#802 里**：execute 再抓口，删掉 `liveAdapters` 纪念品；生产 `resolveCanvasWritePort` 等写口不要用 invocation 里冻住的 `capturedPort`。只审这一刀 diff，**不许再开 35 块、几小时的全量 Ponytail**。
- **#802 里不许做**：会话身份证改写。工厂类型仍收冻住的 `capturedPort` 时，编译器拦不住下次再冻。
- **T-AG-16**：结构刀。合入后立刻开独立 PR。

---

## 3. 哪些「已经绿了」是假对照（下一刀最容易再踩）

这些绿 **不能** 证明 renderer 上的常驻 Agent 能往画布上写：

1. **MCP 画布写绿**  
   调度走主进程 `addProjectNodes`（`electron/capabilityCore/dispatcher.ts` 的 `canvas.write` / `create_canvas_nodes`），**根本不经** renderer surface-port IPC。合同里曾把「同 job production-mcp / mcp-l2 绿」写成 not-affected 证据，这是假对照。MCP 每调用重抓只证明 **MCP 自己那条路**，证明不了内部 lane 的 execute。

2. **lane 单测绿**  
   `electron/agentLane/laneDesktopTools.test.ts` 里 `resolveCanvasWritePort: async () => canvasPort`，`createCanvasWritePort: () => canvasPort`。execute 根本不打真 IPC。后来补了「execute 之后 capture 次数必须再涨」，也只证明 lane 层又问了一次 registry，**不证明**生产 executor 没用纪念品 token。

3. **prepare 成功**  
   失败回执带 `resultOf` 的 `nextAction`，不是 prepare throw / `tool_execution_failed`。只盯 prepare 会以为 liveShared 已经够了。

4. **文稿写成功**  
   同一条走查里创作面 `write_script` 已经 committed revision 2。文稿写口当时还能用，**不能**推断生成面画布写口还能用。跨面之后才死的是画布 execute。

5. **根因合同填完、system prompt 写了「修根因」**  
   合同强制的是表格形状（有 `class_root` 字段、有门表），不强制「你揣着的那个名词寿命配不配」。所以会出现：合同说已经 liveShared，CI 仍红，冻点已经滑到 execute。用户问过为什么系统提示词和根因合同拦不住这类事——答案在教训 [`holder-must-not-keep-a-shorter-lived-noun.md`](../../lessons/holder-must-not-keep-a-shorter-lived-noun.md)，不要再往某一份合同里加一个字段当通用规则。

真对照只有一条：Linux 真实 Electron 的 `resident-composer-receipt-fix`，创作面说话 → 切生成面 → `make_artifact` → 画布上真有节点。

---

## 4. 用户体验：现在 vs 结构改完之后

**现在（即使用法补丁补上 execute 现问）**

- 用户不用「换钥匙」。他们不知道有钥匙。
- 他们只看见：同一条对话，刚才还能改剧本，切到生成让它摆镜头就失败。
- 失败文案叫他们「再读一次当前画面再试」。人去点重试，有时过有时不过，取决于那一次 execute 是不是又握着过期口。
- 换项目：现有 hydrate 会关旧 lane、开新 workspace。这条本来就对，不要在结构刀里重做一遍「换项目要换会话」。
- 同项目切创作/生成/预览：用户认为还是刚才那场对话。今天的实现却把「某一眼画面」当成了会话的一部分，所以切 tab ≈ 对话的手断了。

**结构改完之后（T-AG-16 的用户可见变化）**

- 对话跟的是 **这个窗口 + 这个项目**。切 tab 还是这场对话，Agent 接着刚才的剧本/镜头说话。
- 动手（读画布、写节点、改文稿、动时间轴）的那一下，才去问「现在屏幕上的那一帧是谁」。问完就扔，不揣进会话。
- 换项目：旧对话关，新对话开。这是换身份证，用户也接受「这是另一个项目」。
- 不再出现「对话还在、画面口过期」这种只有开发才懂的失败。用户不需要知道 epoch、token、recapture。

**不要做成的 UX**

- 不要让用户「切换工作区时换一把钥匙」。
- 不要在切 tab 时重启对话、清空上下文。
- 不要因为切到生成面就当作换了会话。

---

## 5. 结构刀要动什么、不要动什么（给下一份 plan 的边界，不是现在就写码）

要动：

- 会话身份 = `windowId + projectId`（或现有等价物：窗口 + `ProjectBinding`），寿命 = 这场对话。
- `CapturedCanvasReadPort` / surface epoch 只出现在 **这一次 action 的参数**里，用完即弃。
- 长寿命对象的构造函数、字段、Map（lane、session、adapter 工厂、transport）**类型上不许收** `CapturedCanvasReadPort`。这是为了让编译器拦住下一刀 freeze，而不是再靠提示词「记得现抓」。
- 工厂如果今天还接受冻住的 `capturedPort`，那是结构债，不是 #802 的范围。

不要动（除非独立拍板）：

- 不要重做 MCP 的 `create_canvas_nodes` 主进程写路，去「对齐」lane 的 renderer 口。两条路后果不同，硬并会把假对照做成真耦合。
- 不要在 #802 里改 session 身份。
- 不要靠再加一层 `liveShared` / `withLive` / 第三个 Map 当结构完成。
- 不要把 #782 拆解选模型、#768 RC、MCP trusted-hosts 等列车外的事并进这一刀。

同类已经用「读时再算 / 当函数」修过、同一条不变量：

- `videoModelCandidates`：装配时快照 → 读时再算
- 技能 / 记忆：当值冻住 → 当函数
- 内部 lane 画面口：#802 只走到「动手时现问」的用法层

---

## 6. 相关坐标（现场，会过期）

- PR：https://github.com/aqm857886159/Nomi/pull/802
- 分支：`integration/release-20260915`（worktree `/Users/aoqimin/Desktop/Nomi-integration`）
- 合入前最后一次用法补丁会改：`electron/agentLane/laneDesktopTools.ts`（`withLive` / 删 `liveAdapters`）、`electron/capabilityCore/canvasReadExecutionRuntime.ts`（写口 `liveCapturedWritePort`）、合同 `docs/fixes/2026-09-15-lane-canvas-write-live-port.root-cause.json`
- 合同即使改完，也仍然只覆盖「内部 lane 不要冻口」这一层用法。**T-AG-16 才是会话身份。**
- 走查：`tests/ux/resident-composer-receipt-fix.e2e.mjs`
- 教训：[`holder-must-not-keep-a-shorter-lived-noun.md`](../../lessons/holder-must-not-keep-a-shorter-lived-noun.md)

这些 SHA / 文件行号会随 #802 继续动。以合入后的 `main` 为准，不要把本段当 file:line 合同。
