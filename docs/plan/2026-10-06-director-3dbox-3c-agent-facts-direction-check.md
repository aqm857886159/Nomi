# 方向检查：3D-BOX 3c 真实测试 ④ 第五轮（C5 / C6 / ⑩）

> 触发：`node scripts/fix-churn.mjs` 命中——`laneExtendedTools.ts`（第 4 个 fix）、`laneCanvasTools.ts` / `applyDirectorWrite.ts` / `AgentPanelV4Receipt.tsx`（第 3 个）、`AgentPanelV4Panel.tsx` / `agentPanelV4Types.ts` / `verbs/writeVerbs.ts`（第 5 个）、`ProjectAgentResidentShell.tsx`（第 7 个）、概念「Agent 面板流条目的身份」（第 10 个）。
> 来源：协调会话 10-06 真实测试 ④（apimart / deepseek-v3.2，分支合 main 于 4e5073223）C1–C4、C8 过，C5、C6、C7 红；另有一条「说的≠摆的」（⑩）。

## 0. 一句话根因

用户该知道的「这一笔到底做了什么」——是撤销还是一份编辑计划、覆盖了哪些手调、实测景别是多少——宿主手里有确定的事实，却没有确定性地送到审批、面板和模型那里：审批按模型原参数猜分支，面板按契约名猜名字，回执写死一句话，覆盖手调和实测景别交给模型去复述。

## 1. 归类表

| bug | 直接原因 | 类 |
|---|---|---|
| C6/C7：说「撤销」弹出「调整时间线」确认卡，撤销没发生 | `undo` 与 `edit_timeline` 同属 `timeline.write`，契约整体 `requiresPlanReview`；闸用模型原参数解 operation，`undo` 的参数里没有 operation | 事实（动词 = 撤销）只在动词名上，闸看不到 |
| C6：那一行叫「调整时间线」 | `residentToolDisplay` 按契约 id 认名字 | 同上，面板也在猜 |
| C6：撤销回执写「时间线回去了」 | `nextActionFor('undo')` 写死一句 | 回执不从事实（changeId 前缀）派生 |
| C5：覆盖了镜头 2 的手调，回复一句没提 | `reorderedOverrides` 只在 details 里，收据正文没有；只靠 prompt 指导模型复述 | 用户必须知道的事交给模型讲 |
| ⑩：工具实测镜 3 近景，模型说「特写（实测）」 | 实测 cut 行没写「实测」也没写计划要求，下面紧跟完整计划 JSON（size=特写），模型把要求当实测 | 同上，事实的呈现有歧义 |

同类旧账：`c4cbf9664` / `070085a36`（changeId 要对模型可见）、`edit_timeline` 回执曾写死「有一张卡在等你」那次、`0d6e97790`（计划卡和技能名改从唯一 owner 派生）。热点文件里其余 fix（面板流式性能、ask_user、付费卡）按提交说明不是这一类。

## 2. 为什么一直冒

一契约多动词时，动词身份只在工具名上；审批、展示、回执三处各自用自己手上的东西（原参数、契约名、静态表）重新推断，于是各错各的。另一半是把「用户必须知道」的事实当成模型的叙述素材。对应铁律 ⑩（说的=摆的）与 ⑫（点了=以为的：说「撤销」就是撤销，不该是一张「调整时间线」卡）。

## 3. 不改结构会冒出什么（预测）

| 预测 | 怎么验证 |
|---|---|
| 再给 `timeline.write` 加一个动词（或任何一契约多动词），闸照样按整体判，展示照样叫「调整时间线」 | `electron/agentLane/laneApprovalGate.undo.test.ts`：去掉闸里 `toSemanticInput` 即红（已验，两条超时红） |
| 别的补丁类工具（以后的分镜表补丁）同样只在 details 里列被覆盖的东西，模型照样不提 | 真实测试换模型重跑 C5：判据只看面板上的宿主提示，不看回复 |
| 其它把「计划值」和「实测值」放在一屏里的回执，模型照样混 | 收据测试 `laneDirectorStageShot.test.ts` 钉住「measured … ; plan asked …」并排的写法 |

## 4. 靶子独立性

靶子是协调会话写的真实测试判据（C1–C8）和人工读回复（⑩），不是实现线写的。C5 的判据这轮改成「面板上宿主那句话在不在」，模型复述只记录不判——这一改由协调会话的要求定（「界面上一定出现」），不是实现线降靶。

## 5. P0

都是领域内的事：审批判据、面板投影、按镜头的手调覆盖。没有现成库可接；修法只用了已有的唯一恢复点（`toSemanticInput`）、已有的收据授权 host-note、已有的计划 meta。

## 6. 选项

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 补（在共享边界） | 闸改判 `toSemanticInput` 的结果；`timeline.write` 只给编辑计划复审（认不出 operation 仍整体复审）；面板 / 回执按 changeId 前缀说撤的是哪一面；覆盖手调由宿主按提议 id 记在计划 meta、面板确定性出一句；收据实测与要求并排 | 模型面基线两处 `aliasBoundInput` 元数据变化（模型实际看到的名字、描述、参数逐字没变） | 低：撤销本来就可撤，step 档照旧先问 | 是 |
| 拆契约（`undo` 独立成 `change.undo`） | 撤销不再挂在 timeline.write 下 | 改 MCP 手写传输、注册表、基线、对外工具面 | 中：对外面变化，要另走评审 | 否（现在不值；记为后续） |
| 删 | — | — | — | 不适用 |

## 7. 用户要权衡的核心

无新的产品取舍：撤销在默认档下不再问（与 `undo` 描述里早就写着的「除逐步确认档外直接生效」一致），覆盖提示是宿主说的、不是模型说的。

## 特征测试清单

- `electron/agentLane/laneApprovalGate.undo.test.ts`（undo 不复审、edit_timeline 仍复审）
- `electron/shared/agentCapabilities/registry.test.ts`（canvas.write 按 operation 复审不变；timeline.write 无 operation 仍整体复审）
- `electron/agentLane/laneExtendedTools.test.ts`（撤销回执按 changeId 前缀）
- `src/workbench/ai/resident/residentToolDisplay.test.ts`（撤销叫「撤销改动」）
- `electron/agentLane/laneDirectorStageShot.test.ts`（实测与要求并排、列出被覆盖的手调）
- `src/workbench/generationCanvas/nodes/director/agent/applyDirectorWrite.overrides.test.ts`、`src/workbench/ai/v4/useDirectorPatchNotices.test.ts`、`src/workbench/ai/v4/agentPanelV4Blocks.test.ts`（记一笔 → 面板出一句 → 撤销后消失；收起的过程行也露在外面）
