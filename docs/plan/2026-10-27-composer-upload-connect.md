# 生成框参考行「+」→「上传本地文件」，传完接到这张卡上（设计卡）

线 / 负责人：I-composer-upload-connect（Mac，Claude Opus）　类别：[其他]（纯 bug 修复：0.24 开发期回归，不改界面元素、文案、布局）

- 发现：走查线 I-composer-walk-b3（2026-10-27）报告第 5 节问题 1。新建图片节点（还是文字生图）→ 生成框参考行「+」→「上传本地文件」→ 选一张图：画布上多一张素材卡且被选中，生成框收起，0 条连线，方式还是文字生图。用户以为加了参考，其实没用上。
- 回归来源：10-09 的接线规则（176373268 / d1a7c2cff，设计卡 `docs/plan/2026-10-08-canvas-handles.md` ★5「素材选择器上传中关掉 → 走现有导入那条（文件已导入的留成素材卡，不连线）」）是给**左环素材选择器**定的，那个选择器挂在画布层，不随选中卸载。10-12 生成框参考行的「+」（`NodeInputReferenceEntry`，ed086ea3e）照抄了「完成时选择器还开着才接线」，但把「开着」写成了一个 ref，卸载时置 false；而生成框只在这张卡被单选时挂着（`BaseGenerationNode.tsx:198`）。导入建卡默认选中新卡（`canvasNodeActions.ts:120`，`assetImportAdapter.ts:427` 没传 `select`）→ 生成框卸载 → ref 被置 false → 完成时 `shouldConnect()` 读到 false（`NodeInputReferenceEntry.tsx:23/46`、`nodeInputActions.ts:158`）。
- 和 10-09 语义一致：★5 是「中途表」（用户停 / 关窗 / 断网…会怎样），说的是**用户**途中关掉选择器；本单只改「应用自己因为导入把选中切到新卡、生成框被动收起」这一种，它不是用户关掉。用户途中关掉 → 只留素材卡、不接线，保持不变。
- 拍板图：例外 pure-bugfix（只修行为，不增删元素、不改文案与布局）。

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我在一张图片节点的生成框里点参考行「+」→「上传本地文件」选一张图，我想这张图直接成为这张卡的参考（有连线、生成框参考行里看得到、生成方式按现有接线规则走），以便接着写提示词，不用再去画布上找卡手动连。步骤：①新建图片节点（文字生图）②生成框参考行点「+」③选择器里点「上传本地文件」④系统文件选择器选一张图 ⑤画布上出现素材卡、卡上显示导入进度（画布里此时生成框收起：导入建卡会选中新卡，这是拖入 / 导入钮要的现有行为，本单不改）⑥导入完成：素材卡连到这张卡，选中回到这张卡，生成框重新出现，参考行里有这张图、行尾「参考图 1 张」，方式按现有接线规则从文字生图升到参考图生图 ⑦Ctrl+Z 一次撤掉「导入 + 连线」。**不做**：不改 10-09「上传途中用户关掉选择器 → 只留素材卡、不接线」；不改导入默认选中新卡；不碰热点 `assetImportAdapter.ts` / `canvasNodeActions.ts`；不点生成、不花钱。**已知坑**：①画布里导入期间生成框会收起再出现（选中先到新卡，完成后才还回来）；②上传途中用户自己点了别的卡 → 照样接上，但不抢回选中；③画布宿主里选择器一建卡就随生成框收起，「用户途中关掉」只在建卡前那一小段做得到；列表视图的内嵌生成框（`GenerationListDetail.tsx:167`）不随画布选中卸载，整段上传期间都能关。**真实任务**：A 新建图片节点 + 真实 4K 帧（登记素材 `video-4k-hevc-10bit` 第 5 秒抽帧，按 `image-4k-png` 的下限 8 MiB 核）中文界面；B 同一流程英文界面；C 左环「给它加输入」→「从素材库添加…」→ 上传（同一个动作的另一个入口，`tests/ux/canvas-handle-menus.walk.mjs` 任务 09 / 10）。**指标**（目标 → 信号 → 指标，量具）：主 = 从「+」上传后接上的比例，目标 100%，量具 = 类测试 `tests/ux/composer-upload-connect.test.mjs`（宿主 × 用户动作矩阵）+ 真机中英各一遍；质量 = 接上之后选中回到这张卡的比例，目标 100%，同一量具；护栏 = 用户途中关掉选择器时误接线 = 0，量具 = 同一矩阵里的「关掉」格 + `nodeInputActions.upload.test.ts`。 | 走查线报告 `I-composer-walk-b3.md` 第 5 节问题 1；协调看过的截图 `04-probe-picker.png` / `05-probe-after-plus-upload.png` |
| ★2 谁说了算 | 「从选择器上传的文件当一张卡的输入」的结局（接不接、选中回哪）→ 唯一 owner = `quickActions/nodeInputActions.ts` 的 `addUploadedInput`；两个入口共用它：生成框参考行 `nodes/NodeInputReferenceEntry.tsx`、左环素材选择器 `reactFlow/GenerationCanvasReactFlowOverlays.tsx`。「用户取消了吗」→ 每个入口只在**用户关选择器的那几下**里置位：生成框 = 点外面 / Esc（`AnchoredPopover` 捕获阶段的 onClose，先于画布改选中）、再点「+」、点「画布点选」、点「浏览全部」、选了一项，全部走同一个关闭函数；左环 = 选择器会话被用户关掉（画布层状态，不随选中卸载）。承载入口的界面卸载**不进判断**。选中 → 画布 store 的 `selectedNodeIds`（会话层，不进撤销）：导入建卡写一次（选中新卡），`addUploadedInput` 只在「此刻选中还停在导入建的卡上」时还原成上传前的选中。同一份事实几份：取消标志每次上传 1 份；选中 1 份。靠「东西不见了」猜意图：改前是（生成框卸载 → 当成用户关掉）；改后没有。新登记概念 `canvas.node-input-upload`（owner `addUploadedInput`）。门表（`node scripts/door-map.mjs addUploadedInput importLocalFilesToGenerationCanvas`）6 扇写门：`canvasAddIntentActions.tsx` / `canvasStageDrop.ts` / `useCanvasMenuActions.ts` / `nodeInputActions.ts` 调导入（前三个是普通导入，选中新卡是对的），`NodeInputReferenceEntry.tsx` / `GenerationCanvasReactFlowOverlays.tsx` 调 `addUploadedInput`。 | `node scripts/door-map.mjs addUploadedInput importLocalFilesToGenerationCanvas` |
| ★3 一致与复用 | 同类做法：`addAssetInput`（从素材库选，`addAssetLibraryNode(..., select: false)`，`canvasStageDrop.ts:242`）选中不离开目标卡——上传这条改完后终态和它一致；声明槽上传 `nodes/controls/slotFileUploads.ts`（首尾帧 / 数组参考，完成就写，不看生成框还在不在）；剪辑卡上传（完成就写进剪辑，上传中拒关选择器）；左环选择器（会话在画布层）。复用：`addUploadedInput` / `connectUploadedInputs`（导入与接线同一个撤销事务）、store 的 `selectNodes`（会话层动作，自动滤掉已删的卡）、`AnchoredPopover` 的 onClose。没有新组件、新 store、新文案；没有第二份判断：`openRef` 和它的卸载置位同提交删掉。为什么不在导入时就 `select: false`（canvasStageDrop 的先例）：开关得穿过 `assetImportAdapter.ts`（热点：目录 + 概念都命中），本单按任务书只动两个干净文件；完成时还原选中能达到同样终态，「导入期间生成框不收起」列进残余风险交协调。 | `git grep -n "select: false" src/workbench/generationCanvas/components/canvasStageDrop.ts`；`node scripts/fix-churn.mjs <文件>` |
| ★4 全状态 | 空：参考行只有「画布点选」「+」。上传中：画布宿主——新卡被选中、生成框收起，卡上显示导入进度；列表宿主——选择器留着，显示「上传中…」。成功：连线在、选中回到这张卡、生成框参考行出现这张图、行尾「参考图 1 张」，方式按现有接线规则（图片节点文字生图 → 参考图生图）。失败（复制进项目失败）：卡留成错误卡可「重试导入」、不接线、选中留在错误卡上；导入照旧提示「1 个导入失败」。部分成功：不适用：一次只传一个文件。取消中（用户途中关掉选择器）：只留素材卡、不接线、不还原选中（导入的默认选中照旧）。过期（上传途中切项目）：导入整体取消，什么都不建、不接。能力不可用（目标当前模型不收这种参考）：沿用现有接线总闸与提示（「当前模型不收…」带「定位节点」），下一步 = 在生成框换一个收参考图的模型，或用「画布点选」接别的卡；素材卡留着。用户途中点了别的卡：照样接上，选中留在用户点的那张。目标卡途中被删：不接、不报错、选中不还原到已删的卡。文案：不新增、不改，i18n 不动。 | 类测试矩阵 + `nodeInputActions.upload.test.ts` + 真机截图 |
| ★9 验收与回滚 | 验收清单与反例见下节（动手前写全；实现线按它自验并附「反例 → 结果 → 证据」，验收线只核这份清单）。回滚：revert 本单的 `fix(canvas)` 提交（不改落盘形状，无迁移）。独立验收：不属四类，由协调定。 | 下节 |

## ★9 验收清单（动手前写全）

| # | 检查 | 量具 / 命令 | 期望 |
|---|---|---|---|
| 1 | 画布宿主（生成框只在这张卡单选时挂着），用户不碰：导入建卡 → 新卡被选中 → 生成框卸载 → 上传完成 ⇒ 1 条边（素材卡 → 这张卡）、选中 = [这张卡]、参考行重新挂上且有这张图 | `tests/ux/composer-upload-connect.test.mjs` 矩阵格 canvas × 不碰 | 绿；**修前红** |
| 2 | 同上，Ctrl+Z 一次 ⇒ 素材卡和边都没了 | 同一格 | 绿 |
| 3 | 列表宿主（不随选中卸载），用户在建卡之后、完成之前按 Esc 关选择器 ⇒ 素材卡在、0 条边 | 矩阵格 inline × 关掉 | 绿（修前也绿：语义保留） |
| 4 | 画布宿主，用户在建卡之前按 Esc 关选择器 ⇒ 素材卡在、0 条边 | 矩阵格 canvas × 建卡前关掉 | 绿 |
| 5 | 上传途中用户自己选了别的卡 ⇒ 照样接上、选中留在用户选的卡 | 矩阵格 canvas × 改选中；单测同一格 | 绿 |
| 6 | 上传失败 ⇒ 不接线、选中不还原 | `nodeInputActions.upload.test.ts` | 绿 |
| 7 | 单测不再写死 `shouldConnect`：走真实导入链（建卡默认选中新卡，只桩掉落盘那一下）+ 上传途中才翻转的取消信号 | `nodeInputActions.upload.test.ts` | 绿 |
| 8 | 左环选择器上传（同一动作的另一个入口）照旧接上、一步撤销；途中关掉照旧不接 | 单测（同一个 `addUploadedInput`）；能跑就跑 `canvas-handle-menus.walk.mjs` 任务 09 / 10 | 绿 / 跑不了如实记 |
| 9 | 真机：新建图片节点 →「+」→「上传本地文件」→ 真实 4K 帧，中英各一张上传完成后的截图：连线在、生成框里有参考、方式是参考图生图 | `pnpm run build` 后临时探针（不进仓库，不新建走查）；截图亲眼 Read | 看到 |
| 10 | 门岗与登记：根因合同 / 概念主人 / 逃逸账本 / typecheck / eslint / `git diff --check` / `pnpm run gates` | 各命令退出码 | 0 |

## 反例（至少真做两条，做完逐字节还原）

| 反例 | 怎么做 | 期望 |
|---|---|---|
| CE1 把修法拿掉 | `NodeInputReferenceEntry.tsx` 恢复「`openRef` + 卸载置 false」的读法 | 清单第 1 条红（0 条边） |
| CE2 把「用户关掉选择器」的取消信号拿掉 | 关闭函数不再给进行中的上传置位 | 清单第 3、4 条红（接上了） |
| CE3 把选中还原拿掉 | `addUploadedInput` 不还原选中 | 清单第 1 条（选中）与单测第 1 格红 |

## 这一类还会从哪回来

1. 另一个宿主：任何「随选中挂载」的生成框宿主——矩阵按宿主列（画布 / 列表内嵌），新宿主加一行。
2. 另一个导入入口顺手改选中：`addUploadedInput` 只还原导入自己造成的那次切换（选中还停在它建的卡上才还原），不看是哪个宿主。
3. 另一个「选择器上传当输入」入口拿界面状态当取消：`addUploadedInput` 的合同写明 `shouldConnect` 只许反映用户显式关闭；现有另一个入口（左环）核过只在用户关掉时变。
4. 旧数据：不涉及（不改落盘形状）。

### 功能分类
- [x] 新界面 / 改交互（路径推出：改了 `src/**/*.tsx`；实际是纯行为修复，拍板图例外 pure-bugfix）
- [x] 大数据量 / 画布 / 长列表（路径推出：画布目录）
- [x] 新增功能 / 性能（路径推出；不新增交互、不碰渲染与规模路径，性能证据写「不适用」并说理由）
