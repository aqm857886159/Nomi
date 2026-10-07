# 方向检查：画布落地链（L-landingreview，类根因复盘）

> 读的是 origin/main `4e55c1ad3`（只读 worktree `D:/Nomi-rules-direction`），外加在途分支 #1072 `fix/external-write-keeps-landed`、#1073 `fix/deleted-node-keeps-arriving-outcome`、#1074 `fix/agent-receipts-from-landing`，以及协调会话转来的 V-1072 验收发现。只读，没改代码。

触发：`node scripts/fix-churn.mjs src/workbench/capability/multiShotCanvasLanding.ts`：这个文件 14 天内 8 个 fix（下一刀是第 9 个），`src/workbench/capability/` 目录 15 个，概念「制作镜头的节点还在不在画布上」11 个。`electron/productionRun/canvasLandingHost.ts`：14 天内 4 个。落地链 13 个核心文件合计：30 天 52 个 fix 提交，14 天 31 个。

## 0. 一句话根因

一个节点上的「生成事实」（结果、版本、运行记录、文本定稿）同时有两类、六路以上的写手。**第一类**：好几扇「整张图 / 整个节点写回」的门，按「放回某一刻的样子」来写，没有一处规定「事实层归谁管」（甲类）。**第二类**：制作流程的镜头在主进程 Run 账本和画布节点各存一份，两边靠尽力而为的异步投影来回同步，反方向还要从「节点没了」这个状态变化去猜用户意图（乙类）。每补一扇门、每多一个时机，就多一个能出错的边缘。

## 1. 归类表

类的定义：
- **甲 整写盖事实**：整图或整节点的写回（撤销重放、外部整张写、补偿放回、装载收敛）把之后落地的事实盖掉。
- **乙 双份真相同步**：Run 账本（主进程，花钱的权威）和画布节点（渲染层）两份状态，在投影时机、幂等号、意图推断、先判后写这些环节对不上。
- **丙 结局到了，容器不在**：节点被删、项目没开、窗口还没认下项目时，结局没地方落。
- **丁 投影丢字段**：从账本或候选手抄到节点时漏了字段。
- **己 顺带碰到**：修的是别的概念（视角、取回、版本号、停因……），只是改到了这些文件。

| 提交 / bug | 症状 | 直接原因 | 类 |
|---|---|---|---|
| 8057e4a47 (09-10) | 草稿改了，节点上的模型和参数没跟上 | 候选身份和 revision 没有落到节点上 | 丁 |
| 5c2f23cdd (09-10) | 草稿建好了，画布上没有 | 新增「草稿即投影」这第 ① 个落地时机 | 乙 |
| dee25ff80 (09-11) | 付费确认报「此确认已失效」 | 落地是发出去就不管的，它推高的 revision 作废了收据 | 乙 |
| 1ecf693b6 / 01ef49f79 / 4976903b0 (09-09~10) | 分镜写入准入、锚点消费 | 写入准入时身份没绑上 | 丁 |
| d65571cdb (09-18) | Agent 分镜表和节点不一致 | 分镜表是第二本账；改成从落地节点推出来 | 乙 |
| c25f6c4bc (09-18) | 模型拟的镜头标题没到画布 | 五处逐字段重建都漏了它 | 丁 |
| 632677d15 (09-21) | 同名模型走错了中转 | modelKey 没和 vendor 成对写 | 丁 |
| 42595c341 (09-19) | 来源和摆放位置丢了 | 投影没带上 | 丁 |
| 5aa7d6e4d (09-22) | 点 × 之后节点又冒出来 | 投影和「删节点上报 detach」两路抢跑 | 乙 |
| 5d341dc63 (09-22) | × 的语义改了（用户拍板） | 产品规则变化 | 乙 |
| c188e56bb (09-25) | 视频早出好了，节点还在转 | 「生成中」有两个 owner（渲染层轮询一份、投影一份） | 乙 |
| 896f236ff (09-26) | 重开窗口后，在跑的镜头变成空白 | 装载收敛把投影写的「生成中」当成幽灵收掉了；「在不在跑」有两个写手 | 甲＋乙 |
| 4d11380e1 (09-28) | 媒体尺寸丢了 | 回填没带尺寸 | 丁 |
| 85a0e369b / 477d54845 / 876494f62 / fe224d79f / f267df710 (09-28) | 同一镜可能被画布和 Run 各派一次（双扣） | 「这一镜归谁派」散在几处判断里，顺序也错 | 乙 |
| 18c7ac300 / ab78d10b3 (09-28) | 延迟删素材和撤销对不上 | 事实层动作没声明它在撤销里归谁 | 甲 |
| 0d7ff3095 (09-29) | 删了节点，那一镜照样派发扣费 | detach 上报的命令号格式非法，被拒以后 `catch {}` 吞掉 | 乙 |
| 66773945e (09-29) | 批次永远收不了尾 | detached 的 job 被算成「在跑」 | 乙 |
| a67becd6e (10-03) | 切项目回来，结果再也落不到节点上 | 卸载项目时 store 清空，被**推断**成「用户删了全部节点」 | 乙 |
| 270e48f04 (10-03) | detached 纠正不回来 | 纠正型绑定和旧命令号一字不差，被幂等重放吞掉 | 乙 |
| 923d19b97 (10-03) | 打开项目时的对账从来没落成 | 落地请求比「窗口认下项目」先到 | 丙 |
| 2b7a16abb (10-03) | 打开老项目，3 个节点变成 6 个 | 对账走了整份落地，新建了节点 | 乙 |
| ea6045055 (10-04) | 同一镜第二次认领 / 删除被吞（双扣路径 6） | 命令号不带「第几次」 | 乙 |
| 1e5628bb6 (10-06) | 本机就失败的尝试，重试被认领拦住 | 「钱离没离开本机」靠猜 | 乙 |
| 2d5f987ea (10-05) | 面板「撤销这批」抹掉了导演台的手调 | 补偿把节点 meta 整份放回 | 甲 |
| e2b9daa97 (#1065, 10-07) | Ctrl+Z 把刚出的付费图也撤没了 | 撤销是前缀重放，把撤销点之后的落地一起丢掉 | 甲 |
| 0e41296c8 (#1065, 10-07) | 撤销「建节点」时连付费结果一起拿走 | 同上（协调会话定 B） | 甲 |
| 6f4bce242 (#1072 在途) | 外部 MCP 写回盖掉读图之后落地的结果 | 读整张、算整张、写整张 | 甲 |
| 782317953 (#1073 在途) | 生成中删节点再撤销，节点永远在转 | 结局到的时候节点不在，被直接丢掉 | 丙 |
| fb3ee6a35 (#1074 在途) | 同一个 Run 出了两张分镜表 | 「已有表」判在 await 之前，先判后写 | 乙 |
| 225dfd4a9 (#1074 在途) | Agent 回执和画布事实对不上 | 回执另写了一句写死的话 | 乙 |
| **V-1072 验收发现（未修）** | Agent 提案「撤销这批」可能盖掉提案之后落地的结果 | `proposalUndo.ts:449` 的 `restore-snapshot` 补偿直接调 `applyExternalGraph(op.snapshot)` 整图放回；不经过 `mergeExternalCanvasWrite`；`applyExternalGraph` 在 #1072 上只把运行态取活的，不保 result / history / contentJson（main 上连运行态都不保，会被装载收敛改写）；冲突检查 `findCanvasChange` 只看提案自己碰过的对象 | 甲 |
| 8cd6e8a01 (09-17) | 后台结局落进了当前项目 | 运行重读「当前项目」 | 丙 |
| 己类：b17df53c7, c38fbcd4e, ffe77daa1（视角）；154222ad4, d2cae6c11（取回）；058f6fa03（版本号）；0e2a29b98（停因）；48b879b3f, 436982196, b65ce1c74, a7c30a1a8, 513833bc2（审计收尾）；6ae1ccd18, 5a7336cc4, 6b2496303（分组和通知 UI）；59dd536bd, 03753fd27, 2308a7930, 49c50ceb0, 22b046e7b, f8ed89b8d, 824edd1f0, 80435ec2c, 49e99aa95, 90564f23a, 46ba26d27, a0bb47779, ee60d6619, d97875b76, cdb5e127f, 7db8bc626 | — | — | 己 |

合计（不含己类）：**乙 约 21 个，甲 9 个（含 1 个未修），丁 9 个，丙 3 个**。最大的一类是乙，不是 10-07 集中冒出来的甲。`multiShotCanvasLanding.ts` 的 14 天 churn 基本都是乙。

## 2. 为什么一直冒

**数清楚：同一个节点的事实层，此刻有这些写手。**

| 写手 | 写法 | 有没有保护事实层 |
|---|---|---|
| 运行器 `deliverRunOutcome` → store 的 `addNodeResult` / `setNodeStatus` / `appendNodeRun` / `landNodeContent` / `setNodeProgress`（door-map：6 个动作，21 扇写门，分布在 10 个文件） | 按字段写 | 它本身就是事实 |
| 制作投影 `materializeShots` → `attachShotResult` / `applyShotGeneration`（主进程四个时机：草稿、确认、打开对账、跟随） | 按字段写，靠启发式判断「最新那条运行记录是谁的」 | 同上；和用户自己跑的那次靠规则让路 |
| Cmd+Z / Cmd+Y：前缀重放 + `reapplyLandedOutcomes` 叠回 | 整图 | #1065 补上了 |
| 外部 MCP：`canvas.apply` → `applyExternalGraph`；盘上 `writeDiskSnapshot` | 整图 | #1072 补上了（在途） |
| Agent 提案补偿：`restore-snapshot` → `applyExternalGraph`；`restore-graph` → `restoreGraph`；`restore-node-fields` → `updateNode(meta)`；分镜删除撤销 `storyboardDeleteUndo` → `restoreGraph` | 整图 / 整节点 | **没有**。restore-snapshot 是 V-1072 发现的那扇门；restoreGraph 按删除那一刻的样子放回节点，节点不在期间到达的结局会丢（和 #1073 同类，#1073 只接了 Cmd+Z 这条路） |
| 装载 `restoreSnapshot` 加收敛 `convergeStuckMidFlightNode` | 整图 | 只对装载成立；会话中途误用就会改写运行态 |
| 盘上投递（渲染进程读改写）和 headless MCP 盘写（主进程读改写） | 整份项目文件 | 两个进程之间没有共享锁（#1072 自己记的遗留 ①） |

**甲为什么会一直冒**：节点是一个对象，里面混着编辑层（位置、提示词、参数、连线）和事实层（结果、版本、运行记录）。每一扇整写的门都要自己记得「事实层取此刻的」。现在是一门一补：#1065 补了撤销，#1072 补了外部写，#1073 补了删后到达，V-1072 又找出一扇提案补偿。保护规则散在 `reapplyLandedOutcomes`、`mergeExternalCanvasWrite`、`holdRunOutcome` 三处。字段清单 `landedNodeFields.ts`（#1072）是手抄的；`canvasWriteBoundary.ts` 的动作表只分「是不是文档写」，不分「写的是哪一层」。

有一个现成的线索没用上：日志事件本来就带 `source: 'user' | 'agent' | 'runtime'`（`canvasEventEmitter.ts:13`）。「只撤用户自己的改动」需要的信息早就在了，但撤销的机制是前缀重放，按状态整段回退，用不上这个来源标记，只能事后把事实一条条叠回去。

**乙为什么会一直冒**：一镜的「节点在不在、跑到哪了、结果是什么」在主进程 Run 和画布节点各有一份。
- 正向：4 个落地时机，加每个 Run 一条队列、投影指纹去重、existingOnly、候选 revision 重绑定。
- 反向：落地后 `plan.bind-shot-nodes`；`watchDeletedProductionNodes` 从 store 前后两拍的差里**推断**「用户删了节点」，再发 detach。

这是两份副本的双向同步，没有一份写清楚的合并规则。每个时序边缘（卸载、切项目、窗口没认下、命令号重放、先判后写、× 之后抢跑）都冒过一次。推断意图这一条最危险：卸载被推断成删除（a67becd6e），撤销也会被推断成删除（见预测 1）。

**铁律**：⑫ 点了=以为的。用户按 Ctrl+Z、删除、「撤销这批」，以为撤的是自己的编辑，结果撤掉了付费事实，或者让 Run 停止派发。⑩ ⑪ 不适用。

## 3. 不改结构的话，接下来会冒什么

| 预测 | 怎么验证 |
|---|---|
| ① **乙**：制作流程整批落地 → Ctrl+Z（按 B，有结果的镜留下，其余节点撤掉）→ Ctrl+Y。没出片的镜节点回来了，但撤销那一下已经被 `watchDeletedProductionNodes` 当成删节点上报 detach。重做不会 reattach：reattach 只发生在落地（跟随要等 Run 变化、指纹变化）或打开项目对账时。所以重开项目之前，这些镜在 Run 里一直是 detached，节点停在当时的状态。 | 新写特征测试：materialize 4 镜（1 镜有结果）→ `undo()` → 断言 detach 上报了 3 个节点 → `redo()` → 断言发出了 reattach 绑定（预计红）。照 `electron/productionRun/canvasLandingReattach.test.ts` 走真仓库。重开之后会不会恢复派发：unverified |
| ② **甲（V-1072 那扇门）**：Agent 提案用 `restore-snapshot` 补偿时，提案之后落在**提案没碰过的节点**上的结果，会被整图放回盖掉。冲突检查只看提案自己的 objectIds，拦不住。main 上运行态还会被装载收敛改成空闲 / 可找回。 | store 测试：提案建节点 A（prepare 出 restore-snapshot）→ 节点 B `addNodeResult` → `runProposalUndoByChangeId` → 断言 B.result 和 history 都在（预计红）。UI 路径 `runProposalUndo` 同样测一遍 |
| ③ **甲 / 丙**：后台项目的盘上投递（渲染进程）和 headless MCP 盘写（主进程）读改写交错，后写的一方把先写的整份覆盖。结果被盖还是外部改动被盖，取决于先后。 | 两个写手交错的仓库层测试：A 读、B 读、A 写、B 写，断言两边的改动都在 |

## 4. 靶子独立性

- #1065、#1072、#1073 是**同一条线**（L-undo）写的，矩阵测试也是它自己写的（`undoKeepsLandedResults.test.ts` 43 条、`externalCanvasWriteKeepsLanded.test.ts` 26 条、`externalCanvasWrite.test.ts` 9 条、`deletedNodeArrivingOutcome.test.ts` 18 条）。断言的确实是用户看得见的东西（主图、版本列表、参数），变异也各自变红。但三份设计卡的独立验收都写着「待验收线出」，真 App 也都是 unverified。V-1072 是第一份独立验收，一上来就找到一扇漏掉的门：自写矩阵只覆盖了自己想到的门。
- `tests/ux/p4-s5-canvas-landing.e2e.mjs` 的整批撤销断言被 #1065 改成了「只剩 shot-1」。规则是协调会话定的，不算错改，但这是实现线自己改了验收靶子。
- `tests/ux/p4-s5-canvas-reconcile.e2e.mjs:98` 是 `check(true, …)` 恒真断言，旁边的注释（「reconcile 时不把 detached 的 shot 放进载荷」）已经和现行设计相反：detached 现在是按 existingOnly 照样投影的（concept-owners「制作镜头的节点还在不在画布上」）。**这个靶子先修**。
- 没有一条测试跨两个系统：撤销 × 制作 detach × 重做、提案撤销 × 落地、外部写 × 制作跟随，都是空白。每条线都在自己那一格里验。
- 没有评测分数参与，也没有「修对了反而掉分」的先例。

## 5. P0：哪些是我们独有的

**通用的（默认接入）：**

| 能力 | 现成方案和出处 | 能不能直接用 |
|---|---|---|
| 只撤用户自己的改动，系统 / 远端改动不撤 | Yjs `UndoManager({ trackedOrigins })`（docs.yjs.dev / github.com/yjs/docs `api/undo-manager.md`）；tldraw `editor.run(fn, { history: 'ignore' })`，记录有 `document / session / presence` 三种 scope（github.com/tldraw/tldraw `apps/docs/content/sdk-features/store.mdx`）；Immer `produceWithPatches` 的反向补丁：服务端改的字段不会被撤回（github.com/immerjs/immer `website/docs/patches.mdx` 的 wizard 例子） | Immer `^11.1.8` 已经是依赖，画布 store 也已经用 `zustand/middleware/immer`（`generationCanvasStore.ts:3`）。Yjs 和 tldraw 要换掉整个画布文档模型 |
| 撤销只记一部分状态 | zundo `partialize`（github.com/charkour/zundo README） | 要求事实层是独立的顶层切片；现在的节点形状下用不上 |
| 外部写三方合并 | RFC 7386 Merge Patch（#1072 已判不适合：数组整体替换）；Automerge / Yjs | 按 id 的小合并函数是合理自写 |
| 副本对账 | 水平触发的对账循环（Kubernetes controller 模式：每次比「应然 vs 实然」，不靠边沿事件） | 是思路，没有库可装 |

**我们独有的（只能自己写）：**
- 哪些字段是**付费事实**（按镜头花钱语义）；
- 撤销「建节点」时，节点因为装着付费结果要留下（协调会话定 B）。这一条 Yjs / tldraw 的按来源撤销表达不了：它们撤销「插入」就会删掉整个容器，连同之后放进去的内容。这是不整体接入的**领域理由**；
- detach = 这一镜不再花钱；
- 镜头认领：画布和 Run 谁来派发。

**登记要纠正**：`docs/engineering/self-written.json` 把 `src/workbench/generationCanvas/events/`（「画布事件、撤销日志与写边界」）整个列成了领域目录。但撤销日志和写边界是通用能力，应该挖出来单独登记成 `under-review`，绑定本复盘。

## 6. 对比表和推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入 A：整体换 Yjs / tldraw store | 画布文档换成 CRDT 或记录库，撤销用 trackedOrigins / history:'ignore' | store、持久化、事件日志、React Flow 绑定都要换；读节点结果的 src 文件粗数 100+；项目文件格式迁移（0.23 已发版）；4–6 周 | 高；而且规则 B 照样要自己写 | 否。领域理由：规则 B 表达不了；其余是成本 |
| 接入 B：Cmd+Z 改成 Immer 反向补丁 | 只记录 source=user/agent 事务的反向补丁，runtime 落地不进撤销栈。字段级的甲类在构造上消失 | 撤销日志、发射器、store 包装，约 8–12 个文件，1 周。`findCanvasChange`、提案事务、盘上事件日志都依赖现有日志，要一并改 | 中 | 部分采纳。它只解决 Cmd+Z 这一扇门，「节点不在」、外部写、提案补偿照旧，所以不单独做；放进重写 ① 第二步，等边界收好以后再评估 |
| 补（照现在这样一门一补） | 先补 restore-snapshot，再补 restoreGraph、分镜删除撤销、两进程盘写…… | 每次小 | 门数没减；V-1072 已经证明自写矩阵漏门；churn 还会涨 | 否 |
| **重写 ①（限一个模块：画布写边界 = 事实层守门）** | ① 事实字段只有一份声明（沿用 #1072 的 `landedNodeFields.ts`）。② 所有整图 / 整节点写手（撤销 / 重做、`applyExternalGraph`、`restoreGraph`、提案 `restore-snapshot` / `restore-node-fields`、分镜删除撤销、会话中途的装载）都经过**同一个**提交口：编辑层取传进来的，事实层取活 store。③ 「节点不在时到达的结局」放在 store 里按 nodeId 暂存（不放撤销日志），任何一扇门把节点带回来时自动叠上。#1073 的做法从此通用到所有门。④ `canvasWriteBoundary.ts` 的动作表本来就 `satisfies Record<ActionName, …>`，从「是不是文档写」扩成「编辑 / 事实 / 整图」三类，新动作不归类就编译不过；非 runtime 来源写事实字段直接失败。⑤ 盘上投递和 `writeDiskSnapshot` 用同一个合并函数。**同一提交删掉**：`reapplyLandedOutcomes` 的专门叠回、#1072 里 `applyExternalGraph` 只取运行态的特例、#1073 的撤销日志暂存 | 约 12–18 个文件，4–6 天，含特征测试；**数据格式不变、不用迁移** | 中。剩下的漏洞是「有人绕过 store 直接改节点」，靠动作表编译检查和 door-map 门岗拦 | **是** |
| **删 ①（和重写 ① 同一个 PR）** | 删掉提案的 `restore-snapshot` 整图补偿（提案已有按对象的 `delete-nodes` / `restore-graph` / `restore-prompt` 补偿可以替代；`prepareCompensation` 走整图的那条路改成按对象） | 1–2 个文件加测试 | 低 | **是** |
| **删 ②（乙类，单独一个 PR）** | 删掉 `watchDeletedProductionNodes` 的「从 store 差推断删除」。改成删除类手势（右键删 / 删选中 / 剪切 / 外部写删）**显式**发 detach；撤销或重做这些手势时显式发反向的 reattach；卸载、装载、撤销「建节点」都不发 | 约 5–8 个文件，2–3 天 | 中：要把删除手势数全（door-map `deleteNode deleteSelectedNodes cutSelectedNodes applyExternalGraph`） | **是**，预测 ① 的根治 |
| 重写 ②（大：把事实层搬出节点对象） | runs / result / history / status / progress / 生成定稿移到独立的 `nodeFacts[nodeId]`，不进撤销、不进外部整图写 | 读者 100+ 文件；项目文件格式迁移，还要兼容已发版；2–3 周 | 高 | 先不做。触发条件：重写 ① 合入后，甲 / 丙类再冒一个 |

**推荐**：重写 ① 加删 ① 合成一个 PR，删 ② 单独一个 PR。动手前先钉下面的特征测试，再修好 reconcile 那条恒真断言。#1072、#1073、#1074 可以照常合入，它们是重写 ① 的半成品，统一边界那一刀会在同一提交里把它们各自的机制收掉。重写 ① 合入之前，这 13 个文件**不再派修补**。

**V-1072 那扇门怎么收进去**：提案撤销不再直接调 `applyExternalGraph(snapshot)`。走法是：
1. 能按对象补偿的，改成按对象补偿（删 ①）；
2. 剩下必须整节点放回的 `restore-node-fields`，走统一提交口，事实层取活 store；
3. 冲突检查继续只管编辑层，事实层的冲突交给统一提交口，不再靠拒绝撤销来兜。

## 7. 用户要权衡的核心

**现在花 4–6 天，把散在几处的「付费结果别被盖掉」收成画布写边界上的一条规则，加上把「删节点」从推断改成显式。数据格式不动，这一类会大幅收敛，但不是结构上不可能再出。还是花 2–3 周、迁移项目文件格式，把付费结果彻底搬出节点，让这一类从结构上消失？** 推荐前者，后者留作再冒一次时的升级条件。

## 特征测试清单（动结构前先钉住）

已有，照旧要绿：
- `src/workbench/generationCanvas/store/undoKeepsLandedResults.test.ts`（#1065，43 条）
- `src/workbench/capability/externalCanvasWriteKeepsLanded.test.ts`、`electron/shared/canvas/externalCanvasWrite.test.ts`（#1072，35 条）
- `src/workbench/generationCanvas/store/deletedNodeArrivingOutcome.test.ts`（#1073，18 条）
- `src/workbench/capability/multiShotCanvasLanding.test.ts`（含 #1074 的重叠落地）
- `electron/productionRun/canvasLandingReattach.test.ts`、`src/workbench/production/watchDeletedProductionNodes.test.ts`、`electron/productionRun/doubleChargeMap.e2e.test.ts`
- `tests/ux/p4-s5-canvas-landing.e2e.mjs`

要新写（多数预计改前红，先当成「钉现状 + 标红期望」提交）：
1. 预测 ①：制作整批落地 → 撤销 → 重做 → 断言 reattach。
2. 预测 ②：提案 restore-snapshot × 未碰节点落地 → 断言结果还在（V-1072）。
3. `restoreGraph`（提案 restore-graph、分镜删除撤销）：删除期间到达的结局，放回后叠上。
4. 预测 ③：两进程盘写交错。
5. 修掉 `p4-s5-canvas-reconcile.e2e.mjs:98` 的 `check(true, …)`，改成断言 detached 镜按 existingOnly 投影、节点不复活。

还没钉的原因：本线只读，不写代码。逃逸账本建议先给预测 ② 记一条 `candidate`，挂铁律 ⑫，由协调会话决定是否转正。

放行：用户 2026-10-07 拍板方案 A（协调会话转达）
