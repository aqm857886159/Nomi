# 设计卡：「我选中了什么」发给助手时只算一遍

状态：动手前写的，等协调确认后再改代码。一个提交，以删为主。
类别：其他（改助手上下文的选区采集；芯片显示成员会变，但样子、位置、文案不动）。修复，不是新功能，不新增界面元素；★7 不适用（见 ★7 一句）。
来历：同一份选择在三处各算：发送目标、冻结快照、聊天框里的芯片。三处对不上：预览里只选文字时芯片亮着、助手却收不到；选区里有重复或不存在的项时三处数出来不同；素材名是空白时一处回落成 ID、一处显示空白芯片。

## 先查别人

- React 文档「选 State 结构 · 避免重复」（https://react.dev/learn/choosing-the-state-structure ，亲眼打开）· 只存 selectedId，被选对象在渲染时从列表里查，不在两处各存一份 · **确认了**：选区只留原始 ID 一份，成员与名字由一处从它推出，三个消费者都拿推出来的结果。
- Redux「用 selector 派生数据」（https://redux.js.org/usage/deriving-data-selectors ，亲眼打开）· 状态保持最小，派生值由 selector 统一算，不在各处重算 · **确认了**：新增一个「选区解析」函数当唯一 selector；渲染时实时投影、发送时同步取一次冻结。
- 本仓同类做法：`src/workbench/ai/resident/residentContextSnapshot.ts:61-167`（已有的规范化：滤不存在、去重、保序、标题回落 ID）· 现成好用，但只被发送一处调用，目标和芯片没用它 · **确认了**：不新建模块，扩它。
- 发给模型的投影 `electron/shared/agentContextSnapshot.ts:331-409`（已有唯一主人，6000 字符预算与省略账）· 只消费冻结快照 · **确认了**：不动它；文字选区进快照后自动走它的预算与省略账。
- 出口：不涉及：不新增、不扩大、不挪动任何挡人的保护；文字选区放不下时由已有的省略账明说。

## ★1 用户怎么用

当我在某个工作面选了东西、对助手说话时，我想让助手收到的就是我看到选中的那几个（芯片、发送、助手那一轮三处一致），以便它改对地方。

步骤：① 在工作面里选东西（文稿、画布节点、时间轴片段或文字片段）→ ② 看聊天框芯片 → ③ 发送 → ④ 助手这一轮收到的快照与芯片同一批；放不下时它被告知「省略了几个」。

不做：不改芯片的样子、位置、文案；不给画布 / 创作 / 分镜面新增选区芯片（协调 11-17 同意：今天只有预览面有芯片，其余面「今天没有芯片，保持」，新增要用户看图定）；不动发给模型的投影、6000 字符预算、read_selection；不改持久数据、IPC。
已知坑：发送时冻结、渲染时实时读取，这个差别有意保留。另有两处还岔着、等用户定，见下面「还岔着、等用户定」，这一刀不改它们的行为。

真实模型的数字（选了文字 / 选了片段后助手有没有按选区做事）：未验证：真实模型核对由协调统一做；evals/ 里现有题目没有一道用到助手选区（`git grep` 选区快照字段与 contextSnapshot 在 evals/ 无命中，仅有 journeys 里点选画布节点的界面步骤）。

真实任务与量具（量具均为本线新增的同输入对拍测试 `residentSelection.test.ts` + 真窗口走查 `verify-nomi.mjs`）：
1. 创作面：选文稿某段，发送。目标 = 文稿，快照 = 1 条文稿句柄，芯片 0（今天就没有，保持）。
2. 生成画布：选 3 个节点，发送。目标 nodeIds = 3 个、快照 3 条同序、与选择顺序一致。
3. 预览面：只选一段文字（没选素材）。修前：芯片 1 枚、目标 clipIds 空、快照 0 条（助手收不到）；修后：芯片 1 枚、目标含该文字片段、快照 1 条。
4. 分镜面：目标 = 文稿，快照只含文稿，不带画布 / 时间轴选区。
指标：「同一选择下 目标成员 = 快照成员 = 芯片成员」的不一致数 0；量具同上对拍测试，四个工作面各一例。护栏：生产里读原始选区字段的文件数 = 2（选区主人 + 采集适配），量具 ESLint 规则 + `door-map`。

### ★1b 连带界面（芯片成员变化，样子不变）

| 变化 | 修前 | 修后 | 真实可达性（已查 `workbenchStore.ts`） |
|---|---|---|---|
| D1 只选文字 | 芯片 1 枚，助手收不到，也没说省略 | 芯片 1 枚（同），助手收到这段文字（放不下由省略账明说） | 可达：点字幕 / 标题卡就是 `selectedTextClipId`，会清空媒体选区 |
| D2 重复 / 不存在的项 | 芯片可能重复显示，目标原样带上 | 去重、滤掉不存在的，保持选择顺序 | 重复：不可达（`setTimelineSelection` 去重、追加选择先查 `includes`）；不存在：存储在删除 / 撤销 / 重做 / 重开时已清理（`workbenchStore.ts:474,491,504,596`，画布 `canvasDocumentCommit.ts:177`），个别置选择（`:432,628`）未核存在性，可能短暂不一致，不为够不着的输入另加代码，只靠统一解析自然覆盖 |
| D3 空白素材名 | 芯片是一个空白名字 | 回落成片段 ID（同快照） | 素材名从素材名或文件名来，纯空白未发现产生路径，不确定；统一解析后自然回落，不加专门分支 |

交回时 D1 给修前 / 修后真截图各一张（D2、D3 走不到真实窗口则用对拍测试代证并写明未能在真窗口复现）。

### ★1b' 媒体片段名为空、有正文时的芯片名（核过，不可达）

旧芯片名是 `label || text || id`，新的对媒体片段只看 `label`、再回落 id。核：时间轴媒体片段（类型只有 image / video / audio，`src/workbench/timeline/timelineTypes.ts:5`）的 `label` 只在生成节点落轨时写入，`src/workbench/generationCanvas/model/buildClipFromGenerationNode.ts:97` 为 `title || prompt || node.id`，不会为空；`text?` 字段（`timelineTypes.ts:42`）在时间轴内核与落轨路径里没有任何写入（`git grep` frameCount 的构造点只有 `buildClipFromGenerationNode.ts` 与内核的 spread 复制），没有重命名操作。文字叠加片段是另一种（`TimelineTextClip`），名字取 `text`，回落 id，行为与旧一致。结论：创作者造不出「label 为空、text 有值」的媒体片段，不补代码。

### ★1c 老用户

不改存储。旧会话恢复 / 重试带的旧快照 `AgentContextSnapshot` 版本 1 形状不变（句柄只多一种来源：文字片段仍用既有 `timelineClip` 种类，不新增字段）；老版本读新快照照常。不适用迁移。

## ★2 谁说了算

- 概念：「助手这一轮的选区」（渲染层）。唯一主人：`src/workbench/ai/resident/residentContextSnapshot.ts` 的 `resolveResidentSelection`（输入原始选择与存在列表；输出：规范化成员 ID、目标、冻结快照、芯片成员含名字）。采集适配分两块：纯函数 `residentSelectionInput`（同在主人文件里，把两个 store 的状态按工作面收成输入，读原始选区字段的地方之一）；芯片用的订阅 hook `useResidentSelectionMembers.ts`（只订阅时间轴切片，读原始字段的地方之二）。
- 消费者（实际落地：主人文件 `residentContextSnapshot.ts` + 订阅 hook `useResidentSelectionMembers.ts` 两个文件可读原始字段，别处 ESLint 红）：发送（`useAgentPanelV4Actions.ts`）取目标与快照；芯片（`useAgentPanelV4Data.ts` 经 `timelineAgentSurface.tsx`）取成员与名字；都不读原始字段。
- 门数（`node scripts/door-map.mjs` 开工重数，与准备报告一致）：`buildResidentContextSnapshot` 写 1 扇、`collectTimelineSelections` 读 1 扇、`useTimelineSelectionChips` 1 扇、`captureSendContext` 1 扇、`mergeResidentContextHandles` 1 扇（均在 Actions 文件）。算「选区成员与名字」的处数：现在 3（发送 target、快照、芯片），做完 1。其余有意差异（导演镜头、@ 引用附加句柄、分镜引用、实时 look_at_canvas）不是选区，不并。这一刀做完后「这一轮带上了哪些选中」在渲染层只算一处；但还有两处和它相关的岔口没收，见下节，不得写成「做完只剩 1 处」。
- 删掉的家：`useAgentPanelV4Actions.ts` 里 `selectedNodeIds`/`selectedClipIds` 自取与原样塞 target（约 :48–84、:207–224 的取选区部分）；`timelineAgentSurface.tsx` 的 `collectTimelineSelections`（:76–84）与 `useTimelineSelectionChips` 里另找片段（:136–153）；`useAgentPanelV4Data.ts` 里 `label || text || id` 另算名字（:318–325）和裸读 `selectedTimelineClipIds`/`selectedTextClipId`（:226–232）。
- 「拖画布节点不让助手面板重渲染」：本环境无 DOM，量不了真实重渲染次数；测试盯结构（芯片 hook 与面板数据层都不订阅生成画布 store），写在 `residentSelection.test.ts`，如实标注。
- 同提交加守卫：新增概念登记 `agent.resident-selection`；ESLint 独立规则：`src/workbench/ai/**`（除主人与采集适配两个文件与测试）里读 `selectedNodeIds`/`selectedTimelineClipIds`/`selectedTextClipId`（点号、方括号、解构、选择器）报红。

## 还岔着、等用户定（这一刀不改行为）

1. 拖动后芯片标「· 已变更」，但发送照常带上它新的位置。芯片在说「请重选」，发出去的却没受影响。方向复盘的看法：芯片指的是实时选中、发送时才冻结，这条提示没有保护对象，可以删；删了芯片少一个后缀，看得见，交用户定。
2. 停止或撤回排队后草稿带回，发送时 `electron/agentLane/laneHost.mts:569` 的 `{...本次, ...restoredIntent}` 让旧快照和旧目标盖过本次选区：芯片显示当前选中，发出去的是旧的。这是「恢复草稿」，不是「重试」，两条路各自独立；之前写成「重试保留旧意图、有意」不对。复盘推荐发送时用当前选中，另一种做法是保留旧意图并让芯片显示旧选中。两种都会改今天的结果，交用户选。

## ★3 一致与复用

- 以前定过：一个东西一个家、聊天只放指向元素（`docs/design/nomi-design-system.md` §1.0，仍算数）；发给模型的投影已有唯一主人（`agent.context-snapshot-projection`，仍算数）；read_selection 暂缓（保留暂缓）。
- 三条路：沿原方向修（在三处各补 D1–D3，已是第三次分叉修补，不选）；换做法（抽到 `electron/shared` 跨层，生产只一个渲染层调用，增加 DTO，不选）；**删掉第二、三处的自算，三处吃同一份结果（选）**。
- 同提交删的死代码（方向复盘建议，协调要求）：`residentReferences.ts` 里 `buildResidentReference`、`buildResidentAssetReference`、`residentReferenceFromContextHandle`、`contextHandleForResidentReference`、`residentReferencePromptValue`、类型 `ResidentReferenceContext` 与只服务它们的私有函数；整个 `residentReferenceDisplay.ts` 与它的测试；`agentResident.referenceRole*` 六个只被它用的文案键（中英各 6 行）。删前逐个核零调用：`node scripts/door-map.mjs <符号>` 与 `git grep -w`，生产代码 0 处，只剩各自的测试与历史文档。留下的是 `buildStoryboardReference`、`isStoryboardReference`、`storyboardShotIdsForTarget`（有生产调用方）。`ProjectAgentReference.contextHandle` 字段（`workbenchStore.ts:90`）现在没有读写者，但属于共享类型，这一刀不动，记为下一刀。
- 复用与删旧（协调 11-17 裁定）：`buildResidentContextSnapshot` 不留薄包装，调用方迁到 `resolveResidentSelection(...).snapshot`，同提交删旧函数。它不是对外合同：`git grep` 只在渲染层发送一处、四个测试 / 走查 / 证据脚本里被点名，主进程、外部助手、存盘格式都没有点名它（存盘与 IPC 里的是 `AgentContextSnapshot` 数据形状，没变）。规范化沿用原函数的逻辑，只多了对输入 ID 的 trim 与文字片段。
- D1–D3 裁定：D1 选了文字就要进目标与快照（文字片段句柄用既有 `timelineClip` 种类，`subtitle: 'text'`，标题取文字内容回落 ID），放不下由既有省略账明说；D2 三处都「滤不存在、去重、保持选择顺序」；D3 名字空白一律回落到 ID，芯片不许出现空白名。保留：当前域限制（只收当前面的选区，文稿始终带）、发送冻结 vs 渲染实时、6000 字符压缩与省略账、导演 / @ 引用等附加句柄。
- `check:self-written`：不新增自写能力（扩已有登记的选区快照模块）。

## ★4 全状态

- 空：没选 → 快照仅带文稿，目标 clipIds / nodeIds 空，芯片 0。
- 加载：不适用，同步计算。
- 成功：见 ★1 四条。
- 失败：选择里有不存在的项 → 滤掉，不报错。
- 取消中：发送在第一个 await 之前冻结，之后改选不影响这一轮。
- 过期：芯片按位置报「已变更」（不变，但见「还岔着」第 1 条）。
- 能力不可用：不适用。
- 最大值：选 40 个节点 / 片段，目标 40，快照走已有预算与省略账（已有测试）。最长文字：片段文字标题由快照投影截到 160。

## ★7 性能

不适用：没有新增用户操作。芯片切片订阅范围不变（只订阅时间轴切片，不订阅画布 nodes，避免面板在拖动时重渲染）；解析为 O(n)。

## ★9 验收与回滚

验收清单（实现线按它自验，验收线只核它）：
1. `residentSelection.test.ts` 对拍：creation / generation / preview / storyboard 四个工作面，同一份 store 选择，目标成员 = 快照成员 = 芯片成员（preview 面）；其余面芯片 0。
2. D1：只选文字：目标含文字片段、快照含它、芯片含它；文字与媒体同选顺序：媒体在前文字在后。
3. D2：选择 `[a, a, ghost]`：三处都是 `[a]`；`' a '` 带空白也规整。
4. D3：素材名 `'   '`：快照标题与芯片名都是 ID。
5. 40 个节点已有「全省略并给总数」的测试仍绿；`residentContextSnapshot.test.ts`、`timelineAgentSurface.test.ts`、`useAgentPanelV4Actions.test.ts` 绿。
6. 真窗口（隔离资料目录）：四个工作面各「选中 → 看芯片 → 发送」；D1 修前 / 修后截图；zh / en 各看一眼。
7. `check:design-lab` 只看「只在分支上红」的格，预期只有芯片成员涉及的格。
8. 老会话：旧快照（只有媒体句柄）的恢复 / 重试照常读（既有测试 + 一条用旧形状快照的用例）。

故意改坏必须报红（实现线交「反例 → 改坏后哪条检查红 → 还原后绿 → 日志」表）：
- A. 发送端自己读 `workbench.selectedTimelineClipIds` 并塞 target → ESLint 红。
- B. 芯片端裸读 `selectedTextClipId` 另找片段（含改名、别名、解构、方括号）→ ESLint 红。
- C. 主人里把文字选区从目标 / 快照摘掉 → D1 对拍红。
- D. 主人去掉去重 / 存活过滤 → D2 红。
- E. 芯片名改回 `label || text || id` → D3 红。
- F. 第二处用另一个名字重写筛选（不读上述三个字段名，如自己 `.filter` 时间轴片段）→ 选区概念登记的定义禁令红；任意别名逃逸能否彻底封住不知道，这一条限同名字段与同名定义，不声称全封。
- G. 正例必须绿：主人与采集适配读原始字段、普通消费者只用结果。

这一类还会从哪里回来：新增一个工作面或一种可选中对象（如音频波形选区）时在消费者里另算一遍；由「读原始选区字段只准两个文件」的规则和对拍测试守。

真实场景复现：创作者在预览里只选一段字幕后给助手发话。修前：芯片亮着，助手那一轮快照 0 条；修后：快照 1 条。和创作者那次的差别：用测试夹具与隔离资料目录里的示例时间轴，不用用户真实项目。

回滚：`git revert` 该提交；不改数据格式。
独立验收：另一条线按本格清单验，报告链接放 PR 正文。
