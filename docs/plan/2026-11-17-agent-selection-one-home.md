# 设计卡：「我选中了什么」发给助手时只算一遍

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：11-17 r2 按用户选「换」续做；保留合并提交，一个实现提交。
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
已知坑：发送时冻结、渲染时实时读取，这个差别有意保留。另两处原先还岔着（草稿带回旧选区、芯片「· 已变更」），用户 11-17 拍板「以芯片为准」，同分支第二个提交已收，见「已收」一节。

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

- 概念：「助手这一轮的选区」（渲染层）。唯一主人：`src/workbench/ai/resident/residentContextSnapshot.ts` 的 `resolveResidentSelection`（输入原始选择与存在列表；输出：规范化成员 ID、目标、冻结快照、芯片成员含名字）。采集适配分两块：纯函数 `residentSelectionInput`（同在主人文件里，把两个 store 的状态按工作面收成输入，读原始选区字段的地方之一）；芯片用的订阅 hook `useResidentTimelineMembers`（在 `timelineAgentSurface.tsx` 里）（只订阅时间轴切片，读原始字段的地方之二）。
- 消费者（实际落地：主人文件 `residentContextSnapshot.ts` + `timelineAgentSurface.tsx`（订阅 hook）两个文件可读原始字段，别处 ESLint 红）：发送（`useAgentPanelV4Actions.ts`）取目标与快照；芯片（`ResidentComposerContext.tsx` 经 `timelineAgentSurface.tsx`）取成员、名字和绑定动作；都不读原始字段。
- 第一轮历史门数（`node scripts/door-map.mjs` 开工重数，与准备报告一致）：`buildResidentContextSnapshot` 写 1 扇、`collectTimelineSelections` 读 1 扇、`useTimelineSelectionChips` 1 扇、`captureSendContext` 1 扇、`mergeResidentContextHandles` 1 扇（均在 Actions 文件）。算「选区成员与名字」的处数：现在 3（发送 target、快照、芯片），做完 1。其余有意差异（导演镜头、@ 引用附加句柄、分镜引用、实时 look_at_canvas）不是选区，不并。这一刀做完后「这一轮带上了哪些选中」在渲染层只算一处；原先相关的两处岔口（草稿带回旧选区、「· 已变更」）已在第二个提交收掉，见「已收」一节。
- 删掉的家：`useAgentPanelV4Actions.ts` 里 `selectedNodeIds`/`selectedClipIds` 自取与原样塞 target（约 :48–84、:207–224 的取选区部分）；`timelineAgentSurface.tsx` 的 `collectTimelineSelections`（:76–84）与 `useTimelineSelectionChips` 里另找片段（:136–153）；`useAgentPanelV4Data.ts` 里 `label || text || id` 另算名字（:318–325）和裸读 `selectedTimelineClipIds`/`selectedTextClipId`（:226–232）。
- 「拖画布节点不让助手面板重渲染」：本环境无 DOM，量不了真实重渲染次数；测试盯结构（芯片 hook 与面板数据层都不订阅生成画布 store），写在 `residentSelection.test.ts`，如实标注。
- 同提交加守卫：新增概念登记 `agent.resident-selection`；ESLint 独立规则：`src/workbench/ai/**`（除主人与采集适配两个文件与测试）里读 `selectedNodeIds`/`selectedTimelineClipIds`/`selectedTextClipId`（点号、方括号、解构、选择器）报红。

## 原先还岔着的两处：已收（用户 11-17 拍板：芯片显示什么助手就收到什么，不一致的一律以芯片为准）

1. 停止或撤回排队后草稿带回，发送时旧快照和旧目标盖过本次选区（`electron/agentLane/laneHost.mts` `inputMessage`，合并 `{...本次, ...restoredIntent}`）。已收：恢复回来的草稿只带回模板（`systemPrompt`），目标、上下文快照、文稿、文稿前提、分镜镜头目标都取这一轮自己的（后几项互相绑着，分镜目标的文稿版本要和文稿前提对得上，不能新旧混取），这一轮发出去的就是此刻芯片显示的选区。看得见的后果：分镜面上取消排队、草稿带回后，原先点选的镜头不再随这条发出，要重新点选（草稿带回时不恢复镜头芯片；「带回时一并恢复镜头芯片」是下一刀的选项）。入口数：`restoredIntent` 的读入口 3 扇（`laneDesktopInput.ts` 解析、`laneHost.mts` 合并、`laneSingleShot.mts` 拒绝），真正合并的只有 `laneHost.mts` 一处，修在这里；老版本信封里留下的 `target` / `contextSnapshot` 照常解析、在合并处丢弃，不迁移。「重试 / 继续」是另一条路（`resolveLaneReplay` → `replayLaneInput`，信封里不许带 `restoredIntent`），按原输入重放、带原选区，保持原样，两条路各钉一条测试（`tests/agent-runtime/lane-replay-admission.test.mts`）。
2. 芯片上的「· 已变更」。已收：删掉文案键 `agentPanelV4.clipStale`、`timelineSelectionRevision` / `timelineClipRevision` / `useTimelineSelectionRevisions` / `useTimelineSelectionChips`（含按位置记起止帧的记忆）、`useAgentPanelV4Data.ts` 里的 `staleFor` 分支；芯片只剩名字，拖动片段后照常显示、照常发出。

仍留着的（不在这一刀）：画布节点 / 文稿光标没有芯片，是已知缺口，新增要用户看图定；`ProjectAgentReference.contextHandle` 的类型字段已在本分支先前提交删除；旧草稿残留键无人读取，原样加载，不做存盘迁移。

创作者看得见的变化三条：① 选中字幕发送，助手真的收到这句字幕；② 停止后改选再发，发的是新选的；③ 芯片不再出现「· 已变更」。老用户：没有存储迁移，旧会话、旧草稿原样可用。

- r2 的完整门表：用同一组状态/类型/组合点符号数修前与修后，见 `docs/fixes/2026-11-17-agent-chip-remove.root-cause.json` 的 doors/door_reduction；完整 target/contextSnapshot 配对在 `captureResidentSendContext`，当前可移除引用在 `useResidentComposerContext`，发送端/外壳只消费结果。

## ★3 一致与复用

- 保住的结果：Shift 选两段视频，点一颗 × 只取消该段选中，剩余 DOM 芯片和新发送逐项一致；单字幕同理；不删除素材、不改变视频/字幕互斥规则。
- 三条路：沿原方向修（保留外壳按 kind 猜动作，新增引用仍可能漏接，不选）；换（在主人旁组合当前引用，必填身份和动作，外壳只摆，发送拿完整 target/snapshot，用户 2026-11-17 选此项）；删（只删选区 ×，损失就地取消能力，不选）。
- 不改存盘格式；历史 V4Chip 只读，旧快照只留历史/重放；当前可移除引用必须有 id/onRemove。取消媒体/字幕分别原子幂等，只改对应字段；绑定原项目订阅与原会话，旧按钮不写新会话。
- 11-17 续跑更正：视频与字幕不能同时选中是既有行为，本刀不造混选；测试分两段视频（含同名）与单字幕。函数级构造跨字段状态仅验证移除动作不误清另一份，不冒充真实交互。

- 同提交删的死代码（方向复盘建议，协调要求）：`residentReferences.ts` 里 `buildResidentReference`、`buildResidentAssetReference`、`residentReferenceFromContextHandle`、`contextHandleForResidentReference`、`residentReferencePromptValue`、类型 `ResidentReferenceContext` 与只服务它们的私有函数；整个 `residentReferenceDisplay.ts` 与它的测试；`agentResident.referenceRole*` 六个只被它用的文案键（中英各 6 行）。删前逐个核零调用：`node scripts/door-map.mjs <符号>` 与 `git grep -w`，生产代码 0 处，只剩各自的测试与历史文档。留下的是 `buildStoryboardReference`、`isStoryboardReference`、`storyboardShotIdsForTarget`（有生产调用方）。`ProjectAgentReference.contextHandle` 类型字段已在本分支先前提交删除（旧草稿残留键无人读取、照常加载）；本轮不改存盘格式。
- 复用与删旧（协调 11-17 裁定）：`buildResidentContextSnapshot` 不留薄包装，调用方迁到 `resolveResidentSelection(...).snapshot`，同提交删旧函数。它不是对外合同：`git grep` 只在渲染层发送一处、四个测试 / 走查 / 证据脚本里被点名，主进程、外部助手、存盘格式都没有点名它（存盘与 IPC 里的是 `AgentContextSnapshot` 数据形状，没变）。规范化沿用原函数的逻辑，只多了对输入 ID 的 trim 与文字片段。
- D1–D3 裁定：D1 选了文字就要进目标与快照（文字片段句柄用既有 `timelineClip` 种类，`subtitle: 'text'`，标题取文字内容回落 ID），放不下由既有省略账明说；D2 三处都「滤不存在、去重、保持选择顺序」；D3 名字空白一律回落到 ID，芯片不许出现空白名。保留：当前域限制（只收当前面的选区，文稿始终带）、发送冻结 vs 渲染实时、6000 字符压缩与省略账、导演 / @ 引用等附加句柄。
- `check:self-written`：不新增自写能力（扩已有登记的选区快照模块）。

## ★4 全状态

- 空：没选 → 快照仅带文稿，目标 clipIds / nodeIds 空，芯片 0。
- 加载：不适用，同步计算。
- 成功：见 ★1 四条。
- 失败：选择里有不存在的项 → 滤掉，不报错。
- 取消中：发送在第一个 await 之前冻结，之后改选不影响这一轮。
- 过期：不显示「已变更」，芯片只显示名字，发送时冻结；旧项目/会话的按钮不写新主人同 ID 的选区。
- 能力不可用：不适用。
- 最大值：选 40 个节点 / 片段，目标 40，快照走已有预算与省略账（已有测试）。最长文字：片段文字标题由快照投影截到 160。

## ★7 性能

不适用：没有新增用户操作。芯片切片订阅范围不变（只订阅时间轴切片，不订阅画布 nodes，避免面板在拖动时重渲染）；解析为 O(n)。

## ★9 验收与回滚

预测（来自方向复盘第 3 节，复查日 2026-12-01）：
1. 给 clip 补一个外壳分支后，新增一种引用还会出现“显示支持、动作漏接”；同名片段可能无法区分。量具：同名双片段、单字幕、失效旧按钮交互夹具；核 stable ID、剩余选中和最后新输入快照。失败标准：任何有 × 无动作、按 label 找对象、又给外壳加业务分支。
2. 主人纯函数全绿，显示适配仍能改字/加后缀。量具：重做 X1、X3 实际显示与请求比较；改坏红、还原绿。失败标准：大写或任意新后缀仍全绿，不能只换禁词。
3. 草稿主人已修，发送端仍能重新借旧快照。量具：带旧 contextSnapshot 的旧形状草稿 A + 当前 B，经真实 send 到最终新输入；新发送 B，retry/continue A。失败标准：X2 仍全绿或重放被误改。

验收合同（实现前写全）：
4. 类型夹具缺 id、缺 onRemove 分别 tsc 红；合法当前引用、只读历史为绿。
5. 生产 Composer + 真 store + 真实 Actions/假传输：两视频（含同名）及单字幕，DOM 的 ID/顺序/原始标题与最后新输入 timelineClip 子集逐项相同；点击 × 后同一断言，源片段仍存在，保留项仍选中。
6. 取消动作重复调用不会重选，不清另一子型；旧项目/会话按钮不影响新项目/会话同 ID 选区；五种本地内容在助手未连接时仍可移除，组件卸载后的旧按钮不写新选区。
7. 带旧 contextSnapshot 的草稿 A，改选 B 新发送只含 B；继续/重试保留原轮（lane replay admission）；导演焦点标签 onClear 与旧浮条 storyboardLaunchMessage 唯一动作表仍绿。
8. 真窗口 zh-CN/en、light、隔离资料、本机回环：两视频 × 后再发；同名双视频只删其一再发；单字幕 × 后再发；点空白清空再发。读芯片、时间轴、最后新输入 ID/顺序/原始标题/startMs；每张截图亲眼打开看。
9. 现有四工作面选择、文字/空白/不存在/去重、40节点预算保持既有定向测试绿；不把文稿 source、导演焦点或 @引用总数等同芯片数。
10. 两板只补注记（label/change/status 不动），设计实验室相对同机主分支逐格无意外变化；相关 data-* 走查全部运行。

故意改坏反例表（日志入协调证据目录）：
- X1：在新显示边界把标题转大写 → DOM/发送对拍红 → 还原绿。
- X2：最终新输入优先旧 contextSnapshot → 带旧快照草稿对拍红 → 还原绿。
- X3：在新显示边界拼任意新后缀 → DOM/发送对拍红 → 还原绿。
- × 回到空路（不做取消） → 目标组件测试和真窗口目标断言均红 → 还原绿；PR 头 3ba25d8dd 原样也红。
- 全部拦下：选区芯片不画 × 或发送全丢选区 → 同两条目标测试红 → 还原绿。
- 外壳加回按 kind 通用分派 → 接口类型/接线约束红 → 还原绿。
- 既有 A/B 原始选区旁路、C 摘掉字幕、D 去掉去重/存活过滤、E 空白标题、F 重建旧筛选、H 旧恢复盖当前、I 旧后缀等仍按上一轮反例量具核验；正例合法主人/订阅适配不误伤。

真实场景差异：使用隔离示例时间轴与回环假模型，不用用户项目、不连真供应商、不花钱。没有真实旧会话冷启/真实模型任务证明则明确未验证。
执行结果：目标组件 14 例、中英真窗口四场景及原有五场景、X1/X2/X3、空路/不画 × 两种失败版本及还原、类型与旧案反例均已留收据；另用未连接时五种 × 先红、修后绿，以及去掉卸载保护后旧按钮误写红、还原绿，验证保护不依赖助手可用性。相关 data-* 读者 8 条已全跑，其中 reference-entry、editing-real-user-pass、agent-timeline-ops、node-prompt-presets 在固定版与原头 3ba25d8dd 同一停点失败，记 partial，其余 4 条通过；未改这些产品区域或走查来消红。
回滚：git revert 本次实现提交；数据格式不变。到 2026-12-01 任一预测失败重开方向检查。

同批合并适配（一次性）：主分支新增的 projectLivenessContent.census.test.ts 仍把先前已删 contextHandle 的 projectAgentReferences 列作地址类型；移除过期的类型见证键，运行时字段归类与扫描不变；该测试和 check:test-types 核验。
