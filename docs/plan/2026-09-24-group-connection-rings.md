# 编组的「+」拉环（展开框 + 折叠卡）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：进行中（2026-09-24）· 来源：v0.22 用户反馈 3「打组后左右两边也出现 + 号，符合直觉」
> 拍板（2026-09-24，AskUserQuestion）：选中编组才出「+」｜右出左进｜折叠编组卡也改成选中才出｜选中折叠卡按 Delete = 删编组和组内节点、可撤销

## 用户那一刻卡在哪

打完组，用户想把「这一组」交给下一步（比如三张参考图一起喂给视频节点）。卡片有「+」，编组框没有，只能一张张连。
折叠的编组卡其实有「+」，但 v0.22 迁到 React Flow 之后，那两颗是旧的按钮：按下去会亮，拖出去**不画线、不建边**（2026-09-24 真机探针：edges 仍为空）——和「视频拖不出线」同一类：入口画出来了，手势没人接。

## 做法

- **手势只有一套：React Flow 的连线手势。** 每个编组在画布内核里有一个「端口节点」：折叠编组复用已有的 proxy 节点（本来就用来承接聚合边），展开编组只在被选中时临时投影一个覆盖框体的端口节点。端口节点不可选、不可拖、自身不吃指针，只渲染左右两个源把手。
- **把手长相归原 owner：** `resolveGenerationFlowConnectionAffordance` 读端口的 `selected`——选中 = 与卡片同款磁吸「+」圈，未选中 = 不渲染。
- **连线语义复用现成 store 路径：** 起线时发现源是编组 → `startGroupConnection(groupId, side)`；落到卡上 → `completeNodeConnection` → `connectToNode` 已会把编组源转成 `connectToGroup`（右 = 组内每个成员连到目标，左 = 目标连到每个成员）。落到空白 → 右侧出新建菜单（可选种类 = 成员 `connectionCreateKindsForSource` 的并集），左侧取消。
- **「选中的编组」唯一 owner：** `model/selectedGroup.ts`——空框 / 折叠卡看 `selectedFrameId`，有成员的展开框看「选区恰好是它的全部成员」。
- **折叠卡能被选中：** 点折叠卡走现有的框选中态（`selectFrame`），清空节点选区；Delete 走现有 `deleteSelectedFrame`（删组带节点、一次撤销）。选中时卡边亮 accent，与选中空框同款。
- **删旧：** `CollapsedGroupCard` 里的两颗 `MagneticConnectionHandle` 删掉；`NodeConnectionHandles.tsx` 若再无引用一并删除。`meta.collapsedGroupProxy` 收成 `meta.groupPort`（折叠 / 展开同一个概念）。

## 不动项

- 编组的聚合边投影、`connectToGroup` 的物化规则、框的拖动与入组退组。
- 卡片自己的「+」规则（唯一主选中才出磁吸圈）。

## 验收

- 真机：选中展开框 → 左右出「+」且在最上层；从右「+」拖到视频卡 → 每个成员各一条边；从左「+」拖到一张图 → 图连到每个成员；拖到空白出菜单、建出的节点连上全部成员；未选中时不出圈；多选两张成员卡不出框的圈。
- 真机：折叠卡未选中无圈；点一下选中出圈、边框亮；从右「+」拖到卡上建边；Delete 删组与成员，⌘Z 一次恢复。
- 单测：`selectedGroup` 判据、端口把手档位、起线时编组源的分流。
- 回滚：单个 revert 这批提交即可，无数据迁移。

## 先查别人（R5）

2026-09-24 用 Context7 查 React Flow（@xyflow/react v12）官方文档：

- **把手只能挂在节点里**：官方 `Handle` 文档的写法是自定义节点里渲染 `<Handle type="source" position={Position.Right} />`，连线手势只从 Handle 起——https://reactflow.dev/api-reference/components/handle 。编组在我们这里不是节点，所以用「端口节点」承载把手，不另写指针拖拽（那是第二个连线手势引擎，违反 R1）。**一致。**
- **拖到空白处新建节点**：官方示例用 `onConnectStart` 记住起点、`onConnectEnd` 判断 `connectionState.isValid` 为假（落在画布平面）再建节点——https://reactflow.dev/examples/nodes/add-node-on-edge-drop 。我们编组起的线在空白处走同一个 `onConnectEnd` 分支出新建菜单。**一致**（多一步菜单，选种类，已有行为）。
- **官方的编组 = 一个 `type: 'group'` 节点 + 子节点 `parentId`**，边可以直接连到编组节点上（示例里 `{ source: '3', target: '4b' }`）——https://reactflow.dev/examples/grouping/sub-flows 。**有意不同**：我们的成员是自由摆放的独立卡、编组只是一个框（`groups[].nodeIds`），而生成运行器按「每张卡读自己的入边」取参考，一条连到编组的边它消费不了。所以编组起 / 落的线在 store 里物化成「每个成员一条」（`src/workbench/generationCanvas/store/canvasGraphActions.ts:109` 把编组待连态转给 `connectToGroup`，同文件 `:133` 的 `materializeGroupOutputLink` 与多选拖线共用）。偏差理由是领域约束（运行器读边的粒度），不是偏好。
- **仓内先例**：折叠编组的 proxy 节点（`src/workbench/generationCanvas/model/canvasCardStackModel.ts:81` 以编组 id 投影一个非真实节点承接聚合边），本次复用它当折叠编组的端口节点，而不是新造一种节点。
- **store 已有的编组起线**：`src/workbench/generationCanvas/store/canvasGraphActions.ts:98` `startGroupConnection`，此前只有旧按钮调用、在 React Flow 画布里没人收尾；本次改由 `onConnectStart` 调用。
