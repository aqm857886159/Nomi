# 方向检查：画布左右拉环 / 拉环菜单 / 空节点「试试」（2026-10-08）

> 触发：`node scripts/fix-churn.mjs` 命中 `src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlowNodes.tsx`（14 天第 5 个 fix）与 `src/workbench/generationCanvas/nodes/render/CardCommon.tsx`（第 4 个）。
> 设计卡：`docs/plan/2026-10-08-canvas-handles.md`；根因合同：`docs/fixes/2026-10-08-canvas-node-input-owner.root-cause.json`。用户 10-08 晚在 Design 画布上三条都选了推荐项。

## 0. 一句话根因

「这一类节点收不收输入、有没有能给下游引用的产出」**没有主人**：拉环（外壳统一挂两侧）、左「+」菜单（拿源的判据判目标）、连线总闸（目标没有模型档案就一律放行）、剪辑卡（自己读上游边）各自猜一遍，于是同一张卡在四处说法不一。

## 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 左「+」拖到空白处，视频卡把图片 / 文字灰掉（bug ②） | `useGenerationCanvasReactFlowMenus.ts` 的 `createVerdictsForStart` 不看起线的一侧，永远以本卡为**源**算，而新建节点落成本卡的**上游** | 「收不收输入」没有主人，菜单借了「能不能输出」的判据 |
| 文本卡左「+」能连出 图片 → 文本 的无意义边 | `validateReferenceEdge`：目标没有模型档案 → 一律放行 | 同上：总闸只问「目标模型吃不吃」，没问「目标这一类收不收」 |
| 点一下「+」什么都不出（bug ①） | 把手没有 onClick、`connectOnClick={false}`、xyflow 要移动 >1px 才算起线；注释却写「点 + 圈与拖线同一个菜单」 | 入口只建了「拖」这一条，「点」只在注释里 |
| 上传素材 / 文本卡选中后两侧都有「+」 | 09-21 拍板「所有种类都有」，外壳不分种类挂两侧 | 拉环是否存在不是从「这一侧用得上」派生的 |
| 近 14 天 `GenerationCanvasReactFlowNodes.tsx` 的 4 个 fix（拖动重渲、多选缩放把手、门岗收尾……）、`CardCommon.tsx` 的 3 个 | 性能 / 抠图 / 门岗，与本类无关 | 不同类：文件是热点，是因为外壳承担了太多种类的分支 |

## 2. 为什么这一类会一直出现

节点种类表（`nodes/registry.ts` 的插件定义）只登记了「生成什么」（`executionKind`）和「能不能当图参考」（`providesImageReference`），**没有登记连线的两端**。于是每个要回答「这一侧能不能连」的地方都只能就地推断：菜单借源判据、总闸以「没档案 = 放行」兜底、剪辑卡靠自己读边、拉环干脆不问。新增一个入口（例如 @ 引用画布节点、空节点的「试试」）就会再推断一次。

铁律对应：⑫ 点了 = 以为的——左「+」上写着「图片」却是灰的、点「+」没反应、文本卡能连出参考线，都是「看见的入口和实际结果不一致」。证据：本 PR 的拉环种类表测试 + 左菜单判据测试 + 真窗口走查 `tests/ux/canvas-handle-menus.walk.mjs`。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 自动引用线（@ → 画布节点）会第三次推断「哪些节点能被引用进来」 | `git grep -n "validateReferenceEdge\|connectionCreateVerdicts" src` 的调用者数只增不减 |
| 新加一种节点（例如 3D 产物进导演台）时，它的拉环、菜单、总闸三处要各改一遍，漏一处就是又一个「看见能连、连上没用」 | 本 PR 后：在 `registry.ts` 加一种节点不写 `connects` 直接编译错（类型必填） |
| 剪辑卡这种「不靠模型档案、自己读上游」的节点被总闸当成「没档案 = 什么都收」，连进来的文本 / 声音静默无效 | `validateReferenceEdge(text, clip)` 本 PR 前返回 ok |

## 4. 靶子独立性检查

- 尺子：拉环种类表的期望值直接抄自用户 10-08 的拍板原文（素材 / 文本没有左环、剪辑没有右环），不是从实现反推。
- 走查 `canvas-magnetic-handle` / `canvas-handles-alt-drag` 是另一条线写的，断言的是「图片卡两侧都有」，本 PR 不改图片卡，它们应保持绿；`canvas-s5-walkthrough` 现有红灯与本类无关（根因见报告：右「+」落在 Agent 面板下）。
- 没有「修对了反而掉分」的先例。

## 5. P0：这些是我们独有的吗？现成方案有哪些

- 「这一类节点收什么、产出什么」是 Nomi 画布的领域词表（`docs/engineering/self-written.json` 的画布 / 节点系统领域），React Flow 只提供 `isConnectableStart/End`、`isValidConnection` 这类**机制**，不提供「图片卡收不收视频」这种语义。用 xyflow 自带的 `isValidConnection` 承载判据看过了：它只在拖线命中把手时调用，管不到「点 + 出菜单」「空白处松手新建」「@ 引用」「Agent 连线」这些不经过把手的入口，所以判据仍须是我们自己的一份纯函数，xyflow 只是其中一个消费者。
- 点选模式（「在画布上点选」）：xyflow 没有「临时把节点变成可点候选」的能力；它是一个状态 + 一层外观，自写，登记为画布领域。
- 菜单、浮层、素材选择器：全部复用现成原语（`WorkbenchMenu`、`AssetPicker` / `AssetPickerPopover`），不新写。

## 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | xyflow `isValidConnection`（@xyflow/react 12.11.5，`HandleComponent` 的 isValidConnection 参数） | 只覆盖拖线命中把手这一扇门 | 其余五扇门仍各自推断 | 否（领域约束见 §5） |
| 补 | 在种类定义上加 `connects: { input, output }` 一个字段，拉环 / 左菜单 / 总闸 / 「试试」全读它；左判据单列一个「以本卡为目标」的函数，和右判据同文件同文案 | 一次改动碰 6 个读者 | 低：旧边照常加载、只拦新建 | **推荐** |
| 重写（限一个模块） | 重写连线子系统 | 大 | 高 | 否：结构问题只缺一个字段，不缺一个模块 |
| 删 | 删掉左「+」 | 小 | 用户拍板要保留并强化 | 否 |

选「补」而不是「换」：缺的是一个事实的主人，现有判据（`connectionCreateVerdictsForSource` / `validateReferenceEdge`）本身是对的，只是没有读它；同一提交删掉旧的推断点（`createVerdictsForStart` 的单侧判断、`validateReferenceEdge` 的「没档案就放行」对不收输入的种类、样张里的 `RECEIVES_WITHOUT_ARCHETYPE` 名单、`BaseGenerationNode.showFlowConnectionHandle` 死代码）。

## 7. 用户要权衡的核心

已拍板（10-08）：拉环只在用得上的一侧出现，代价是 09-21「所有种类都有」那条不再成立——老项目里已经连进素材 / 文本卡的旧线照常显示、能断开，但不能再新建同类线。

## 特征测试清单（动结构前先锁住）

- `src/workbench/generationCanvas/reactFlow/generationCanvasReactFlowVisualContract.test.ts`（现状：所有种类两侧都有，本 PR 按拍板改写成种类表）
- `src/workbench/generationCanvas/store/canvasConnectRegression.test.ts`（S5 图 → 视频连线，保持）
- `src/workbench/generationCanvas/store/canvasBatchGestures.test.ts`（多选连线一步撤销，保持）
- `src/workbench/generationCanvas/quickActions/deriveFromNode.noMoneyDoor.test.ts`（快捷动作目录不碰花钱入口；「试试」放进同一目录，被它覆盖）

## 追加（评审复审 B2，2026-10-09）：自写登记 canvas-undo-journal-write-boundary

本轮在 `events/canvasWriteBoundary.ts` 只加了**一行**：新 store 动作 `connectDerivedOutput` 在「动作 → 撤销层」表里登记为 `edit`（该表要求每个 store 动作都登记，少一个编译就红）。没有改撤销日志、提交口或写边界本身。

为什么现在不换现成方案：这个登记条目 `canvas-undo-journal-write-boundary`（under-review，reviewBy 2026-11-06）的评估方向是「撤销栈改成 Immer 反向补丁」，结论还没出；本轮的改动与它的评估无关（只是新动作按现有规则登记一行）。哪天换：该评估出结论时一并处理——届时「动作 → 层」表随撤销栈一起重写，本轮这一行不会成为迁移负担（它只表达「这个动作是用户可撤销的编辑」）。

## 第 3 轮：派生出处改原子动作（评审 B2，2026-10-09）

**类根因**：派生关系原来用「先建节点、再凭节点 meta 里一个可写的身份字段（derivedFrom）去连边」两步表达。中间那个身份字段，任何写路径——Agent 建节点、复制粘贴（structuredClone 带走）、导入、外部整图合并——都造得出来、拷得走；而 `connectDerivedOutput` 又是公开的 store 动作。第 1 轮是调用方自报布尔值（provenance），第 2 轮换成数据字段，都是在同一个错误形状上补：身份信息放在一个能被别人写的地方。按 P1 第 3 轮停补、改类根因。

**结构修法（删 > 结构）**：建派生节点 + 连出处边做成**一个原子 store 动作** `addDerivedOutput({ sourceNodeId, kind, node })`——动作里按规则表（`model/derivedOutput.ts`）核源种类和新节点种类，建节点，连边。目标一定是刚建出来的新节点，天然没有别的来源；**不持久化任何身份字段，也没有公开的「给已有节点补出处边」的动作**。删掉了 `meta.derivedFrom`、`connectDerivedOutput`、`isDerivedOutputOf`。5 个产出方（全景截图、导演台产物、白板截图、剪辑导出、事实表）都改用它；复用已有节点的两处（同一段剪辑重复导出、已存在的事实表）沿用旧节点，不替用户重连（它的边要么还在，要么是用户自己断开的）。事实表的允许源从 `any` 收窄成「结果是视频的 video / asset 卡」。

**旧项目**：已有的出处边是快照里的普通边，按普通边加载 / 显示 / 断开；这条规则只管新建。

**「边进入画布文档」的入口清单**（`node scripts/door-map.mjs` 数的）：
| 入口 | 门数 | 现在谁拦 |
|---|---|---|
| `store.connectNodes`（Agent / @ 引用 / 自动引用 / 3D 站位等） | 12 写 + 3 读 | `validateReferenceEdge` 总闸（无参数槽也先校验），没有任何绕过开关 |
| `store.addDerivedOutput`（5 个产出方） | 5 写 + 3 读 | 规则表：源种类 + 新节点种类 + 事实表的视频源 |
| `store.connectToNode`（拖线 / 菜单 / 点选 / 上传后接线） | 4 写 | `resolveCanvasReferenceConnection` |
| 编组连线（materializeGroupLink / OutputLink） | 经 connectToNode | 同一套能力校验 |
| 事件重放、meta → 边迁移（model 层 graphOps 纯算子） | 不是 store 入口 | 不校验：重放的是已落库的历史 |
| `restoreSnapshot`（装载 / 撤销 / 重做） | 2 写 | 不校验：老项目的旧边必须能加载 |
| 粘贴 / 复制（pasteNodes） | 3 写 + 3 读 | 只复制已有结构，不凭空造出处身份（现在也没有身份字段可带） |
| `applyExternalGraph`（外部整图合并，`externalCanvasWrite.ts:59-66`） | 1 写 | **不校验类型，只查端点存在**——main 上就有，不是本 PR 引入；要补得在 electron 共享层拿到节点种类定义，不是小改，列为遗留，另开卡 |
