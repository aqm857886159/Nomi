# 生成画布 React Flow 迁移 · 逐项等价审计（只读）

> 日期：2026-09-11 · 状态：📎 交接/日志 · 回填轨①：`fix/canvas-migration-backfill-gestures-20260911`
> 本文是 2026-09-11 只读审计的**逐字入库副本**（原稿 `~/Desktop/Nomi-migration-audit-20260911.md`）。
> 入库理由：审计结论是回填 PR 的裁决依据，躺在桌面上等于没有真相源。正文一字未改。
> 本轨（回填①）落的是 ③ 表的第 3 / 5 / 9 / 10 / 12 行；第 1 行（卡内滚轮）、
> 第 2 / 4 / 6 / 7 / 8 / 11 行由另外的轨处理，本轨不碰。

## 先查别人

> 本节按 R27 §16 / `check:prior-art` 补入。回填做的是「把框架已经提供的开关接回来」，
> 所以四问的答案全部落在**依赖里已有**这一格——这正是 R29 要的结论：别再自研一遍。

- **依赖里已有（滚轮语义）** `node_modules/@xyflow/react/dist/esm/types/component-props.d.ts:458` —— `@xyflow/react` 12.11.5 公开 `zoomOnScroll`(:458) / `panOnScroll`(:469) / `panOnScrollSpeed`(:475) / `panOnScrollMode`(:482) 四颗开关；运行时缺省逐字写在 `node_modules/@xyflow/react/dist/esm/index.js:3745`（`zoomOnScroll = true, panOnScroll = false, panOnScrollMode = Free, panOnScrollSpeed = 0.5`）。→ **用已有**：旧内核的 `resolveWheelIntent` 只需把档位映射成这两颗 prop，不必再自己接 wheel 事件。
- **依赖里已有（Shift+滚轮横向平移）** `node_modules/.pnpm/@xyflow+system@0.0.81/node_modules/@xyflow/system/dist/esm/index.js:2775` —— `createPanOnScrollHandler` 写着 `if (!isMacOs() && event.shiftKey …) { deltaX = event.deltaY }`，与 OLD `src/workbench/generationCanvas/components/useCanvasViewportGestures.ts:436` 的 `deltaX === 0 ? deltaY : deltaX` 是同一条判据（macOS 由浏览器换轴、非 macOS 由框架换轴）。→ **用已有**，不再写第二份。
- **依赖里已有（⌘/Ctrl 与捏合恒缩放）** `node_modules/.pnpm/@xyflow+system@0.0.81/node_modules/@xyflow/system/dist/esm/index.js:3001` —— `const isPanOnScroll = panOnScroll && !zoomActivationKeyPressed`，加上同文件 `:2762` 的 `if (event.ctrlKey && zoomOnPinch)`，保证「平移档下 ⌘+滚轮与捏合仍缩放」，正是 `src/utils/canvasGesturePreference.ts:25` 那张真值表的第二行。
- **依赖里已有（框选相交语义）** `node_modules/@xyflow/react/dist/esm/types/component-props.d.ts:295` —— `selectionMode` 默认 `'full'`（运行时缺省见 `node_modules/@xyflow/react/dist/esm/index.js:3745` 的 `selectionMode = SelectionMode.Full`）。→ **用已有**：一行 `SelectionMode.Partial` 回到 `docs/plan/2026-06-14-canvas-smoothness-ABC.md` §B2 拍板的「相交即选」，不复活旧 AABB 几何代码。
- **仓库里已有（设置项与帮助浮层）** `src/utils/canvasGesturePreference.ts:25` 与 `src/workbench/generationCanvas/components/canvasControlsHelpModel.ts:29` —— 偏好模块、设置芯片（`src/workbench/settings/CanvasGestureSection.tsx:39`）与帮助文案都还在，且文案本来就从档位 derive。→ 不新增任何文案，接回内核后说明书自动与实物一致。
- **仓库里已有（同一偏好的第二个消费者）** `src/ui/onboarding/workflowPage/WorkflowGraphCanvas.tsx:106` —— ComfyUI 工作流画布仍在用 `resolveWheelIntent`，而且 `tests/ux/_comfyWorkflowMacGestures.mjs:61` 的 `checkMainCanvas()` 早就断言过「同一设置也作用于主画布」。→ 这条走查就是本轨的现成红灯，不另造判据。
- **生态里已有** https://reactflow.dev/api-reference/react-flow —— 官方 API 文档逐条写明这四颗 prop 的语义与默认值；tldraw / Figma 同族产品同样把「滚轮=缩放 还是 双指=平移」做成用户偏好而不是定死，与 #832 的拍板一致。

---


OLD = `8f9365aeb` (2026-08-27，迁移提交 `74346baca` 的父)　NEW = `origin/main` @ `af3652e1c` (2026-09-11)
迁移计划书 `docs/plan/2026-08-27-react-flow-canvas-complete-migration.md` 承诺「user-visible behavior stable」「no parallel renderer remains」。本文逐项核对这两条。

## ① 一句话结论

**内核确实只剩一个（R23 的「单内核」达标），但「逐项保留」没做到：46 项交互里 25 项一致，6 项有理由地改了，3 项新增，6 项变了却没有任何拍板/文档，6 项直接丢了——其中「滚轮语义设置」「卡内滚轮」「媒体预览时收起画布 chrome」「`canvasZoom` 冻结成 1」四条至今仍在线上，且旧手势内核整岛（7 个文件）还躺在仓库里被单测覆盖着。**

| 判定 | 数 |
|---|---|
| 一致 | 25 |
| 变了（有意，有据） | 6 |
| 变了（无人拍板） | 6 |
| 丢了 | 6 |
| 新增（OLD 无） | 3 |
| 没查清 | 3 |

## ② 逐项对照表

「已报」列：✅=已在 `docs/fixes`/`docs/lessons`/commit 里出现过；空=本审计首次记录。

### 视口 / 手势

| 交互 | OLD | NEW | 判定 | 用户看到的差别 | 已报 |
|---|---|---|---|---|---|
| 空白左键拖=平移 | `components/useCanvasViewportGestures.ts:7`（拍板 `docs/plan/2026-08-08-canvas-drag-pan-and-quiet-render.md`） | `reactFlow/GenerationCanvasReactFlowViewport.tsx:185` `panOnDrag={[0,1]}` | 一致 | — | |
| 空格/中键/右键拖=平移（压在节点上也生效） | `useCanvasViewportGestures.ts:8` | `reactFlow/useGenerationCanvasReactFlowPointer.ts:86-102` | 一致 | — | |
| 右键拖超阈值吞掉右键菜单 | `useCanvasViewportGestures.ts:411-418` | `useGenerationCanvasReactFlowPointer.ts:181-184` | 一致 | — | |
| **滚轮语义可配（缩放/平移二选一）** | `useCanvasViewportGestures.ts:433` `resolveWheelIntent(gestureScheme,…)`；拍板 `docs/plan/2026-08-03-canvas-gesture-scheme-setting.md` | 无。RF 未设 `panOnScroll`，滚轮恒缩放。`utils/canvasGesturePreference.ts` 只剩 `ui/onboarding/workflowPage/WorkflowGraphCanvas.tsx:106` 在用 | **丢了** | 设置页（`workbench/settings/SettingsDialog.tsx:363`）里那个「画布手势」开关对生成画布完全失效；画布帮助浮层 `components/canvasControlsHelpModel.ts:29,45-53` 还在告诉用户「滚轮=平移、⌘+滚轮=缩放」——说明书与实物不符 | |
| Shift+滚轮=横向平移（平移档） | `useCanvasViewportGestures.ts:436-438` | 无 | 丢了 | 触控板党的横向平移没了（随上一条） | |
| **卡内可滚区放行原生滚动** | `useCanvasViewportGestures.ts:425-431` 通用 `findScrollableAncestor`（一处覆盖所有入口；根因见 `docs/plan/2026-08-13-prompt-wheel-containment.md`） | 改成逐个组件贴 `nowheel`。实测卡内 28 处 `overflow-auto` 只有 1 处有（`nodes/shotTable/ShotTableGrid.tsx:22`） | **丢了** | 在提示词编辑器、结果堆、参数条、生成记录、错误报告、产物正文里滚轮 → 整个画布缩放，内容不动 | |
| 滚轮缩放锚光标 | `useCanvasViewportGestures.ts:443-445` | RF 默认锚光标 | 一致 | — | |
| 缩放上下限 0.2 / 3 | `useCanvasViewportGestures.ts:443` | `GenerationCanvasReactFlowViewport.tsx:175-176` | 一致 | 迁移当时漏传，RF 用了自己的 .5/2 默认，09-10 才修回 | ✅ `docs/fixes/2026-09-10-canvas-zoom-kernel-range.root-cause.json` |
| 双击空白 | OLD 无此手势 | `GenerationCanvasReactFlowViewport.tsx` 未设 `zoomOnDoubleClick` → RF 默认 true | **变了（无人拍板）** | 双击空白会突然放大一档 | |
| 平移光标 grabbing | `styles/generationCanvas.css:19` + `useCanvasViewportGestures.ts:302` 写 `data-panning` | 只写 `data-space-pan`（`useGenerationCanvasReactFlowPointer.ts:191`）；`data-panning` 无人写 | 变了（无人拍板） | 中键/右键拖平移时光标不变成「抓紧」手 | |

### 选择

| 交互 | OLD | NEW | 判定 | 用户看到的差别 | 已报 |
|---|---|---|---|---|---|
| Shift+左键拖=框选 | `components/useMarqueeSelection.ts:1-4` | `GenerationCanvasReactFlowViewport.tsx:188` `selectionKeyCode="Shift"` | 一致 | — | |
| 框选恒追加 | `useMarqueeSelection.ts:107` `additive=true` | `:189` `multiSelectionKeyCode="Shift"` + `GenerationCanvasReactFlow.tsx:490-493` | 一致 | — | |
| **框选命中=相交即选** | `store/canvasNodeActions.ts:293-298`（AABB 相交）；拍板 `docs/plan/2026-06-14-canvas-smoothness-ABC.md` §B2 | 未设 `selectionMode` → RF 默认 `Full`＝**必须整张卡落进框内** | **变了（无人拍板）** | 框只扫过卡的一半 → 那张卡不会被选上；走查已被改写去迁就新语义而不是守住旧的（`tests/ux/canvas-drag-pan-gestures.walk.mjs:156-157` 白纸黑字写着「React Flow 只选完全落在框内的节点」） | |
| 点空白清空选区 | `components/GenerationCanvas.tsx:516-519` | `GenerationCanvasReactFlow.tsx:583-585` | 一致 | — | |
| **多选包围盒（16px 留白虚框 · 框内空白可拖整批）** | `components/GenerationCanvas.tsx:633-644` + `:78` | 不渲染。CSS `styles/generationCanvas.css:46` 与 handler `components/useCanvasSelectionDrag.ts:234` 双双成死码 | **丢了** | 多选后没有那圈包围虚框，也不能从选区空白处抓起整批搬（只能抓某一张卡） | |
| 多选浮条位置 | `GenerationCanvas.tsx:699-716`（bounds 上沿 −58px） | `reactFlow/selectionToolbarPlacement.ts` + `:250-269`（恒屏幕尺寸、避开底部停靠、对齐所属框上沿） | 变了（有意） | 比旧版更不容易被时间轴压住 | ✅ `fbdcb09cb` |
| 框选罩子上右键 | OLD 无此 DOM 层 | 修复后归节点菜单 | 变了（有意） | 迁移后曾把右键当「点空白」清空选区 | ✅ `docs/fixes/2026-09-06-canvas-selection-overlay-context-menu.root-cause.json` |
| 框选贴边自动平移 | OLD 无 | RF `Pane.autoPan()` 40px 边带 | 变了（无人拍板，RF 自带） | 框选拖到离边 40px 内画布会自己跑；选中几张卡变成与帧率相关 | ✅ `docs/fixes/2026-09-05-canvas-perf-marquee-autopan.root-cause.json` |

### 连线 / 边

| 交互 | OLD | NEW | 判定 | 用户看到的差别 | 已报 |
|---|---|---|---|---|---|
| 磁吸带 112×min(168, h+28) | `nodes/NodeConnectionHandles.tsx:51-61` | `reactFlow/generationCanvasReactFlow.css:150-171`（逐字同尺寸） | 一致 | 迁移当天丢过，08-29 PR #221 补回 | ✅ |
| 磁吸带的门 | `nodes/BaseGenerationNode.tsx:269,298-300`：`selected && 图像类 && 非起线源` | `reactFlow/generationCanvasReactFlowVisualContract.ts:12-15` 用 `primarySelection`，而 `reactFlow/generationCanvasReactFlowAdapter.ts:96` 定义 `primarySelection = selected && 选中数===1` | **变了（无人拍板）** | 多选了几张图片卡时，旧版每张都有磁吸带，新版全退回小圆点 | |
| 28px 圆点 handle 常驻 | `BaseGenerationNode.tsx:323-330`（w-7 h-7, z-7） | `generationCanvasReactFlow.css:111-117`（28×28, z-8） | 一致 | — | |
| 旧 in-node handle 的下场 | — | `generationCanvasReactFlow.css:89-93` 用 `display:none` 藏掉，`nodes/NodeConnectionHandles.tsx` 整文件仍被 4 处 import | 变了（无人拍板） | 用户无感，但这是「新旧两份并存靠 CSS 挡住」（P1） | |
| 起线预览线 | `components/CanvasEdgeLayer.tsx:143-161` | `reactFlow/CanvasBatchConnectionLine.tsx` | 变了（有意） | 多选时预览线上多一个 ×N 批量计数 | ✅ `125e2b90e` |
| 落空→「建图片/视频」菜单 | `GenerationCanvas.tsx:357-380` | `reactFlow/useGenerationCanvasReactFlowMenus.ts:232-260` | 一致 | — | |
| 两端侧别按相对位置翻转 | `CanvasEdgeLayer.tsx:78-82` | `generationCanvasReactFlowAdapter.ts:40-50` | 一致 | — | |
| 拖到卡片正文完成连线 | `nodes/completeNodeConnection.ts` | `reactFlow/canvasConnectionDropTarget.ts` | 一致 | 迁移后曾整个失效（edges 恒 0），09-03 修 | ✅ `docs/fixes/2026-09-03-canvas-connect-regression.root-cause.json` |
| 边命中区 30px | `styles/generationCanvas.css:252-258` | `reactFlow/GenerationCanvasReactFlowNodes.tsx:297`（`interactionWidth={30}`）**外加** `:301-326` 又画了一条 30px hit path | 一致（但有两层，重复） | — | |
| 边类型胶囊只在「选中节点的边」显示 | `CanvasEdgeLayer.tsx:41-43,167-169` | `GenerationCanvasReactFlowNodes.tsx:283` | 一致 | — | |
| **胶囊反缩放保持恒定屏幕字号** | `CanvasEdgeLayer.tsx:63,176` `scale(1/zoom)` | `EdgeLabelRenderer` + `generationCanvasReactFlow.css:237` 固定 `font-size:12px`，随视口一起缩放 | **变了（无人拍板）** | 缩到 30% 时边标签小到看不清；放到 300% 时大得离谱 | |
| 胶囊落点 | `CanvasEdgeLayer.tsx:171` = 用户点下去的那一点 | 恒贝塞尔中点（`GenerationCanvasReactFlowNodes.tsx:269,333`） | 变了（无人拍板，轻） | 点长边的一端，菜单弹在边的中间 | |
| 边模式菜单 / 剪刀断开 | `CanvasEdgeLayer.tsx:198-218` | `GenerationCanvasReactFlowNodes.tsx:353-395` | 一致 | — | |
| Del 删选中边 | OLD 无 | `GenerationCanvasReactFlow.tsx:506-510` + `components/useCanvasShortcuts.ts` | 新增 | — | |
| 边改模式/断开的 undo 粒度 | OLD 一步 | 迁移后变成 0 步或 2 步，09-07/09-08 修回 | 变了（有意，已修） | — | ✅ `docs/fixes/2026-09-08-canvas-undo-barrier-sweep.root-cause.json` |

### 节点

| 交互 | OLD | NEW | 判定 | 用户看到的差别 | 已报 |
|---|---|---|---|---|---|
| 节点拖动（含多选整批） | `nodes/useNodeDragResize.ts` | RF `onNodeDrag*` + `reactFlow/canvasDragDraft.ts` / `canvasDragWriteback.ts` | 一致 | — | |
| Alt 拖=复制 | OLD 无 | `GenerationCanvasReactFlow.tsx:520-521` | 新增 | — | |
| 节点缩放 | 自绘 `__resize-zone` + `useNodeDragResize.ts:374-390` | RF `NodeResizer`（`GenerationCanvasReactFlowNodes.tsx:177-213`），旧区被 CSS 藏掉 | 变了（有意） | 手柄 16px、四角四边，与旧版基本同形 | |
| 拖节点到时间轴 | `useNodeDragResize.ts:321-360` | `reactFlow/canvasDragWriteback.ts:48-65` | 一致 | 「还没生成就别拖」的提示从节点内联反馈改回 toast | |
| **`canvasZoom` 存储同步** | `components/useCanvasTransformStoreSync.ts` 每帧写 `setCanvasTransform` | **无人写**：`setCanvasTransform` / `setCanvasZoom`（`store/generationCanvasStore.ts:59-60`）在全仓零调用，`state.canvasZoom` 永远是 1。读的人还在：`nodes/ClipNode.tsx:69` → `nodes/ClipNodeTimeline.tsx:195-196,258,475`；`nodes/useNodeDragResize.ts:206,291` | **丢了** | 剪辑节点内嵌时间轴：**任何非 100% 缩放下拖动/裁切片段的位移都算错**（50% 缩放时只走一半），把手命中宽也不再随缩放补偿 | |
| 轻量节点 / LOD | `components/canvasNodeLevelOfDetail.ts` + `GenerationCanvas.tsx:674` | `GenerationCanvasReactFlowNodes.tsx:135-146,222-254` | 一致 | — | |
| 视口虚拟化 | `components/useCanvasViewport.ts` | `GenerationCanvasReactFlowViewport.tsx:191` `onlyRenderVisibleElements` | 一致 | — | |
| 深链聚焦节点 + 1.4s 闪烁 | `GenerationCanvas.tsx:247-291` | `reactFlow/useGenerationCanvasReactFlowEffects.ts` + `reactFlow/focusViewportRecovery.ts` | 一致 | 09-10 另补「聚焦时抬到可读缩放」 | ✅ `8246dd6ca` |
| 选中节点 z 抬升 | `BaseGenerationNode.tsx:278` `z-[5]` | `generationCanvasReactFlow.css:27-29` + `elevateNodesOnSelect={false}` | 一致 | — | |
| 新建节点自动露出视口 | OLD 无 | `components/useCreatedNodeVisibilityPan.ts` | 新增 | — | ✅ `2c503e54d` |

### 菜单 / 组 / 其它

| 交互 | OLD | NEW | 判定 | 用户看到的差别 | 已报 |
|---|---|---|---|---|---|
| 空白右键=加节点；节点右键=节点菜单；已在多选里则保留多选 | `GenerationCanvas.tsx:188-191,741-759` | `useGenerationCanvasReactFlowMenus.ts:129-132` + `reactFlow/GenerationCanvasReactFlowOverlays.tsx` | 一致 | — | |
| 节点菜单条目 copy/cut/paste/group/delete | `components/NodeContextMenu.tsx:25` | 同文件 `:38` | 一致 | — | |
| 全套快捷键（Esc/Del/⌘A/C/X/V/G/⌘Z/缩放） | `components/useCanvasShortcuts.ts` | 同文件（+ `deleteActiveEdge`） | 一致 | — | |
| 组框渲染 / 组拖动 / 组连线 | `components/GroupFrame.tsx` + `GenerationCanvas.tsx:646-651` | `components/CanvasGroupProjectionLayer.tsx`（挂在 `ViewportPortal` 内） | 变了（有意） | 升级成 Frame 工具（F 画框、拖进拖出、折叠卡堆） | ✅ `docs/plan/2026-09-06-canvas-frame-tool.md` |
| **媒体预览打开时收起画布 chrome** | `styles/generationCanvas.css:24-31` + `nodes/NodeMediaPreviewDialog.tsx:30-42`（工具条/导航栈/多选浮条/composer/节点浮条/时间轴把手一起 `visibility:hidden`） | CSS 与 setter **双双删除**，删它的提交是 `903d992f6`「fix(agent-panel): restore folding…」——与媒体预览毫无关系 | **丢了** | 打开图片/视频灯箱时，左侧工具条、右下导航栈、节点浮条仍浮在画面上 | |
| composer 让位平移 | `components/useComposerVisibilityPan.ts` | 迁移当天漏接（`0dee38744` 补回）→ 09-09 `527a96df0` 改成「浮框上下翻转 + 视口内 clamp」并删除 | 变了（有意） | 打字时画布不再自己滑动，改成浮框翻到节点上方 | ✅ |
| 小地图 / 导航栈 / 适应视图 / 重置 / 整理 | `components/CanvasNavigationStack.tsx` | 同组件 | 一致 | 「适应视图」改成框住「节点 ∪ 框」 | ✅ `model/canvasFitBounds.ts` 内有裁决 |
| 舞台拖放（文件/素材库/浏览器资产） | `GenerationCanvas.tsx:611-625` | `GenerationCanvasReactFlow.tsx:608-626` | 一致 | — | |

### 结构性（不是单条交互，但违反迁移计划自己写的不变量）

| 项 | 事实 | 判定 |
|---|---|---|
| **旧手势内核整岛仍在仓库** | `components/useCanvasPointerInteractions.ts`（零 import）、`useCanvasViewportGestures.ts`、`useMarqueeSelection.ts`、`useDragToConnect.ts`（零 import）、`useCanvasViewport.ts`、`useCollapsedCanvasViewport.ts`（零 import）、`canvasScroll.ts` 互相 import 成孤岛，生产代码零引用；却还配着 `useCanvasViewport.test.ts` / `useCanvasViewportGestures.strictMode.test.ts` / `canvasScroll.test.ts` 在 CI 里跑绿 | 违反计划「no parallel renderer remains」（P1）。真正的坏处不是占空间，是**这些绿灯让人以为滚轮偏好/卡内滚轮/相交框选还活着** |
| 单内核 | `components/GenerationCanvas.tsx` 已是 20 行的 lazy 壳，只指向 `reactFlow/GenerationCanvasReactFlow.tsx`；`NomiStudioApp.tsx:92` 是唯一挂载点 | 一致（R23 单内核达标） |

## ③ 「无人拍板」与「丢了」按用户影响排序

| # | 项 | 影响 | 建议动作 |
|---|---|---|---|
| 1 | **卡内滚轮被画布吞掉** | 每天都撞：提示词框、结果堆、参数条、错误报告里滚轮就是缩放画布。旧版有过一次根因修复（`docs/plan/2026-08-13-prompt-wheel-containment.md`），现在退回逐处补丁 | **恢复旧行为的根因版**：在 RF 宿主 `onWheelCapture` 里复用 `components/canvasScroll.ts` 的 `findScrollableAncestor`，命中就 `stopPropagation`——一处覆盖所有入口，而不是给 27 个 DOM 挨个贴 `nowheel` |
| 2 | **`canvasZoom` 冻结成 1** | 剪辑节点内嵌时间轴在任何非 100% 缩放下拖/裁都算错位移，是真 bug 不是观感 | **恢复**：要么让 RF 的 `onMove` 写回 `setCanvasTransform`，要么把 `ClipNode`/`ClipNodeTimeline` 改读 `useReactFlow().getViewport().zoom`；并删掉 store 里已无人写的 `canvasZoom/canvasOffset` 两个字段（选一个真相源，别留两个） |
| 3 | **滚轮语义设置整条失效 + 帮助浮层说假话** | 设置页还摆着「画布手势：缩放/平移」开关，选了没用；帮助浮层照着这个开关生成文案 | **恢复**：RF 支持 `panOnScroll` / `zoomOnScroll`，按 `useCanvasGestureScheme()` 声明式地传进 `<ReactFlow>` 即可。若决定不做，则必须同批删掉设置项与帮助文案（P1：不留说明书对不上实物的入口） |
| 4 | **媒体预览时画布 chrome 不再收起** | 看大图时工具条/导航栈/节点浮条压在画面上 | **恢复**：`NodeMediaPreviewDialog` 重新写 `data-media-preview-open`，CSS 规则按新类名（`.generation-canvas-react-flow` 下的工具条/导航栈/浮条）重写 |
| 5 | **框选从「相交即选」变成「必须整张落进框」** | 用户习惯扫一下就选上；现在得把框拉得比卡还大。且走查已被改写去迁就，等于把偏差固化进验收 | **需拍板**：`selectionMode={SelectionMode.Partial}` 一行就能回到旧语义。若保留新语义，请在 `docs/plan` 里补一条裁决，并把走查注释从「RF 只选完全落在框内的」改成「我们选择完全包含，理由是 X」 |
| 6 | **多选包围盒消失** | 多选后没有视觉边界，也不能从选区空白处抓起整批 | **需样张**：RF 自带 `.react-flow__nodesselection-rect`（CSS 已在 `generationCanvasReactFlow.css:37-46` 调过色），但它只在「用框选产生的选区」出现、Shift 点选出来的不出现，且拖它的语义与旧版不同。先出样张定「什么时候出框、框内空白能不能拖」 |
| 7 | **边标签随缩放变大变小** | 缩到 30% 看不清边是什么类型 | **恢复旧行为**：给 `.generation-canvas-react-flow__edge-label` 加 `transform: scale(calc(1 / var(--rf-zoom)))`，或用 `useViewport()` 的 zoom 反缩放（选择浮条已有同款做法可复用：`reactFlow/selectionToolbarPlacement.ts`） |
| 8 | **磁吸带只在「只选中一张」时出现** | 多选几张图片卡时磁吸带集体退成小圆点 | **保留新并补拍板**：多选时不显磁吸带其实更干净，但要写进 `generationCanvasReactFlowVisualContract.ts` 的注释与 `docs/plan`，别让它只是 `primarySelection` 这个名字的副作用 |
| 9 | **双击空白会缩放** | 误触放大 | **恢复旧行为**：`zoomOnDoubleClick={false}`（旧画布没有这个手势）；或拍板保留并写进帮助浮层 |
| 10 | 中键/右键平移时光标不变 grabbing | 轻微 | 恢复：平移开始时写 `data-panning` |
| 11 | 边菜单弹在中点而非点击处 | 轻微；长边上点一端、菜单跑到中间 | 保留新并补一行注释即可 |
| 12 | 旧手势内核死岛 + 它的绿灯单测 | 不影响用户，但会持续误导评审与后来的人 | **删旧**（P1）：7 个文件连同它们的单测一起删；若第 1/3 条决定复用 `canvasScroll.ts`，则只留它 |

## ④ 没查清的三处（以及为什么）

1. **分层不变量「组框 z0 < 连线 z2 < 节点 z3」是否仍成立。** OLD 在 `GenerationCanvas.tsx:645` 写死了这条注释并据此排 DOM 顺序；NEW 把组框放进 `ViewportPortal`（`GenerationCanvasReactFlowViewport.tsx:233-249`），它在 DOM 里排在 `.react-flow__nodes`（z-index 2）之后，而边层用的是 RF 自己的 z-index。静态读代码判不了「组框会不会盖住边的命中区」——需要真机在一个「边从组框上方穿过」的画布上点一下那条边。
2. **`zoomOnDoubleClick` / `selectionMode` 的 RF 实际默认值。** 本审计的判定基于「代码里没传这两个 prop」+ React Flow 文档默认（`zoomOnDoubleClick: true`、`selectionMode: Full`）。该 worktree 没有 `node_modules`，无法从 `@xyflow/react` 的 `.d.ts` 逐字核对版本默认，也没有真机双击验证。
3. **卡内滚轮 28 处里哪几处真的在 RF 的缩放面内。** 我按「组件文件在 `nodes/` 下」计数，但其中若干（白板弹层、导演台全屏、部分 popover）可能被 portal 到 `.react-flow` 之外，不受影响。需要真机逐个滚一下才能给出准确的受害清单；结论「机制从通用识别退化成逐处贴标」不受此影响。

---

审计范围：`src/workbench/generationCanvas/` 全量 + `src/styles/`；不含 Agent 面板、3D 导演台、时间轴自身。只读，未改任何代码。
