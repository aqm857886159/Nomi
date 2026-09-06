# Agent 面板 v4 · 打包版真实使用抓到的一批问题（2026-09-06 晚）

状态：✅ 走查通过（`tests/ux/agent-v4-retry-storm.walk.mjs`，loopback 零额度，`paidCalls: 0`）

## 0. 现场

用户在**打包版**（main 含 #538 v4 接线 + #542 空态）的创作面分镜表 v6 里，
让 Agent（对话模型 DeepSeek）「从原稿重拆 10 镜」。右侧面板出现：

- **6 条**连续的「创建或修改镜头卡 · 只建卡·不生成 · ⚠ <1s」——一个字的原因都没有；
- 中间夹着模型的自言自语：「我看到参数需要是数组而不是字符串…」「我把 JSON 字符串化两次了…」
  「看起来工具调用有问题，让我尝试另一种方法」；
- 最后模型**放弃工具**，改成直接改文档。

用户原话：「这堆工具没什么重要的东西……不可能有这么多都放在那里……看的时候得点入」。

一句话说清这次的病：**面板在复述工具描述，而不是转述这一次调用真的发生了什么**；
而模型之所以连试六次，是因为参数契约既没告诉它数组长什么样，也不肯收它那种写法，
回执还是一堆读不懂的分支诉求。

## 1. 逐条根因与落点

| # | 症状 | 根因 | 落点 |
|---|---|---|---|
| A | 展开收据，输入/输出都写「将内容写入当前文稿」 | 两栏读的都是 `readableToolPreview` / `readableToolSummary` 的**兜底描述**；`response.toolCalls[].args/result/error` 在写侧被整包丢掉；而且收据正文缓存的 scope 用了发送前捕获的快照，第一次发送时线程还没建好 → scope 空串 → **整个会话一条都没落盘** | `residentToolProjection.ts`（新增 `input`/`output` + 入参脱敏）、`residentToolDisplay.ts`、`useAgentPanelV4Actions.ts`、`agentPanelV4Projection.ts` |
| B | 6 条同名收据平铺、失败无原因 | 收据层没有「同一件事失败了 N 次」这个概念；失败行的摘要仍印「打算做什么」（在一次没写成的调用上是假的） | `agentPanelV4Collapse.ts`（新）、`AgentPanelV4Receipt.tsx` |
| C | 模型的过程自述与最终回答一样宽、一样黑 | 宿主把**一个回合的全部助手正文合并成一条** item，且它建得早，整段排在收据前面 | `agentPanelV4Projection.ts`（按调用偏移量切）+ `agentPanelV4Collapse.ts`（折过程行）——**真机上这一档走不到，见 §3** |
| D | 建卡工具拒了模型 6 次 | `nodes`/`edges`/`anchors`/`shots` 是裸数组；pi 的 TypeBox 跑在 Nomi 的 Zod 之前，字符串在契约看到它之前就被挡掉，回执是 9 个联合分支的 8 行矛盾诉求 | `electron/shared/agentCapabilities/jsonArgTolerance.ts`（新，单一 owner）+ 根因合同 |
| E | 模型弹层 17 行「对话」平铺、没有下拉 | 容器把整个文本模型目录摊成一行一个模型 | `agentPanelV4ModelRows.ts`（新）、`ProjectAgentResidentShell.tsx`、`AgentPanelV4Composer.tsx` |
| F | Skill 弹层行首白块 | 那是「hover 换预览视频」预留的位置，功能没做、DTO 里也没有封面字段 | `AgentPanelV4Composer.tsx` |
| G | 上下文环空圈「—」 | 用户真实目录里 **21 个对话模型的 `meta.contextWindow` 一个都没有** | `modelContextWindowCatalog.ts`（新，一手文档表）、`AgentPanelV4Context.tsx` |
| H | 「此模型不吃参考」 | 主语错了：判据本来就是 `mode.slots.length === 0` | `shotReferenceCells.ts`、`ShotReferenceZone.tsx` |

## 2. 真机证据

跑法：`node tests/ux/agent-v4-retry-storm.walk.mjs`（loopback，零额度）
截图：`.tmp/pi-v4-retry-storm-development-<ts>/*.png`（4 张）

| 图 | 证的是什么 |
|---|---|
| 01 | 三次同名调用折成**一行**「创建或修改镜头卡 ×3 · nodes：期… · ⚠ 全部失败」；上面一行是那次成功的「读取画布」 |
| 02 | 回答仍然读得到——切不开正文时**宁可整段原样，也不把唯一那条回答折没** |
| 03 | 展开「读取画布」：输入 `{}`（这次真的发过去的入参）、输出「画布当前为空。」——两栏不再是同一句话 |
| 04 | 展开一条失败收据：输入是真实入参 JSON（含被二次序列化的 `nodes`），输出是真实校验回执 |

`tests/ux/agent-v4-short-film.walk.mjs`（既有那条）同轮复跑通过。

## 3. 诚实交代：**没能**在真机上验到的

- **C 的过程行**。折叠逻辑有单测（`agentPanelV4Collapse.test.ts`）与实验室格（`v4-process-folded`），
  但真机上看不到它，卡在宿主：
  ① 宿主把一个回合的助手正文合并成一条，切点只能靠 `assistantTextAnchor`；
  ② 那个锚只在**要审批**的那条路上算，「自动改」下的安全改动是 silent 放行的；
  ③ 参数非法的调用在拿到审批之前就被执行边界拒掉，所以换成「每步问」也拿不到锚。
  要真机看到过程行，得先让宿主在 silent 路上也给出锚——本轮范围之外。
  折叠层对此有明确退让，走查断言的就是那条退让。
- **D 的「模型一次写对」**。证据是契约级单测（十镜 payload 的两种写法解出同一个值）
  与发布层单测（pi 的 TypeBox 在 zod 之前就收得下），**没有**跑一次真实 DeepSeek 调用。
- ~~**E 的第四行「音频默认」**~~ → 2026-09-07 用户拍板：**删掉这一行**。仓库里没有 audio
  的默认模型概念（`GENERATION_DEFAULT_TASK_KINDS` 只有图/视频的 taskKind，也没有 audio
  生成节点或解析器），一行永远空着的槽是在承诺一个不存在的能力。弹层现在是三行
  「对话 / 图片默认 / 视频默认」；等音频生成能力落地了再加回来。
- **用户那个真实项目的 `.nomi` 记录**没找到：`~/Documents/Nomi Projects/` 最新的是 09-04，
  `recent-workspaces.json` 里也没有 09/06 16:39 那个项目。所以本轮的错误形状是从契约与运行时
  倒推 + 走查复现的，不是从他那次的落盘记录读出来的。

## 4. 顺带发现（记下，本轮不扩范围）

- **收据正文缓存从来没生效过**。scope 取的是发送前捕获的快照，而一条对话的第一次发送
  发生在线程建好之前 → scope 空串 → `cacheProjection` 直接 return。界面上看不出来，
  因为旧版两栏读的是按入参重算的描述。已在 A 里一并修掉。
- **回合失败时收据正文一个字都不落**。落盘那段代码在 `throw` 之后。
  已改成运行时把回执挂在 error 上带出来（`agentResponse`）。
- **同一回合的收据顺序是随机的**。宿主给整回合的 item 盖同一个 `receivedAt`，
  投影层的第二排序键是随机 uuid，于是「读、写、写、写」会排成「写、读、写、写」。
  已改成按数组原序（= 真实插入序）。
- **参数在到达边界前被拒时，`args` 会丢**。pi 的 `tool_execution_end` 兜底记录里
  `args: undefined`，所以那一路的收据「输入」栏是空的。本轮没动运行时。
- **Host adapter 的 Zod issue 被吞成一个裸 code**。`canvasWriteTransportAdapters.ts` 把
  `ZodError` 收成 `capability_input_invalid`，`projectAgentExecutionCoordinatorTypes.ts`
  又把 `message` 设成 code 本身——那一路的回执模型读不懂。本轮只修了 pi 那一侧。
- **`atRefDisabledTitle` 写着「此模型不吃参考」，而它挂在「契约未知」那一格上**——
  两件事共用一句话。已改。
