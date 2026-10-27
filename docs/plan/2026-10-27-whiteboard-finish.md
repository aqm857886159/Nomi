# 设计卡：画板收尾——画过的看得见、尺寸不乱跳、失败说真话

改动名：老画板卡片显示画过的内容；画框尺寸的同步收进一个 hook，提交前重读真值；走查量取前先等元素就绪；出图失败的提示说真话
线/负责人：Mac Claude 实现线 I-whiteboard-finish-r2 / `fix/whiteboard-finish`（第 1 轮停在本卡，第 2 轮按拍板实现；基于 origin/main 99fad22d4）
类别：[新界面]（路径推出：改 `src/**/*.tsx`、画布目录；实际是纯 bug 修复，不新增元素、不改布局；9 格全填）

方向检查：`docs/engineering/direction-checks/2026-10-27-whiteboard-finish.md`（用户 10-27 拍板「换」）
根因合同：`docs/fixes/2026-10-27-whiteboard-finish.root-cause.json`

**状态：✅ 已拍板，进实现。** 用户 10-27「五件都按推荐办」定了 Q1；协调 10-26 定了 Q2–Q6（见下）。实现提交带 `Direction-Check:` trailer。

## 0. 在现在的代码上核实（origin/main 26fbc87d3，2026-10-27；第 2 轮并上 99fad22d4 后这几个文件没变）

派工书的行号是 10-24 对账时的，逐件重核如下。原始证据来自 10-24 的独立验收报告（协调状态目录 `reports/V-whiteboard.md`，下称 V 报告）。V 报告验收的提交是 2de50bba7，它和现在的 main 在 `WhiteboardCardBody.tsx`、`InlineWhiteboard.tsx`、`WhiteboardDrawingTool.tsx`、`render/CardCommon.tsx`、`render/NodeCardBody.tsx` 和走查文件上逐字相同（`git diff 2de50bba7 HEAD -- <这些文件>` 为空），所以它的真机截图就是现在代码的 before。中英 `S3a-legacy-on-open.png` 里，老画板和空画板一样只有一个毛笔圆钮；中英 `S5-failure-feedback.png` 里，编辑器开着、红线还在，提示是旧句子。

| 件 | 派工书写的 | 现在的代码 | 结论 |
|---|---|---|---|
| 1 老画板看着像没画 | 卡片只有结果图时才显示内容，否则画启动器；`whiteboardHasVisibleContent` 只在「完成」里读 | `WhiteboardCardBody.tsx:40-55` 只在 `canvasImageSourceOf(node.result)` 有值时走图片分支，否则 `:57-73` 画启动器。`whiteboardHasVisibleContent` 全仓只有 `InlineWhiteboard.tsx:205` 一个读者 | 对得上。用户 10-22 拍板原话（`InlineWhiteboard.board.json` O40）是「有内容显示缩略图……没内容才显示启动器」；10-22 设计卡里「入口 2：老画板打开项目仍显示启动器」比拍板原话窄。本卡按拍板原话，取代那一行；「不落盘、不自动改写」保留 |
| 2 尺寸被写成中间值 | `WhiteboardDrawingTool.tsx` 约 :555-583 的 ResizeObserver，同尺寸早退不撤 250ms 计时器 | 这段是 `:552-584`。早退三处：`:566` 量不到、`:571` 差不到 1 个屏幕像素、`:573` 换算取整后相等。后两处既不撤 `commitTimer`，也不清 live 尺寸，`:576-579` 在 250ms 后把观察那一刻的尺寸写进文档 | 对得上，范围比派工书宽：V 报告 sizerace 探针零间隔连敲尺寸框，18 次里 2 次停在中间值（敲 640 停在 64、敲 1000 停在 100）。撤销、比例、尺寸框三扇门都不知道有一个待提交在排队 |
| 3 走查不等就量 | `whiteboard-refactor.walk.mjs` 约 :92 的 `boundingBox()` 没等稳定 | 就在 `:92`。V 报告 en 首轮在这里拿到 null。同一文件还有 7 处裸量取 | 对得上；失败形状多一种（null） |
| 4 失败文案是旧说法 | `snapshotSaveFailed`，`InlineWhiteboard.tsx` 约 :158、:253 在用 | `:158` 在出图事务里（画板「完成」、图片入口「完成」、图片入口相机「保存为主图」三扇门）；`:253` 在画板入口相机「截图并创建图片节点」里 | `:158` 对得上；`:253` 那条路确实是截图，另给一句（Q3）。失败时内容还在：`handleClose` 的 catch 只报错，不关编辑器、不写节点；V 报告 S5 真机核过 |

## 已定的事

- **Q1（用户 10-27 拍板）换。** 「画框 → 文档尺寸」的同步抽成一个小 hook `useWhiteboardFrameSize`（新文件）。防抖用已在依赖里的 Mantine 8.3.18 `useDebouncedCallback`（带 `cancel`），替掉手写 `setTimeout`。提交的那一刻重读画框和文档，只写画框此刻的尺寸。撤销、比例、尺寸框、打开四扇门一次收进这个 hook，不在两处早退各补一刀。实现提交带 `Direction-Check: docs/engineering/direction-checks/2026-10-27-whiteboard-finish.md`。
- **Q2（协调）改概念登记。** `canvas.whiteboard-scene` 的说明改成「交互实例只归 LeaferCanvas；离屏只读预览实例归 renderWhiteboardStatePreview，一次性、不带 editor、导出完即销毁，二者共用 renderWhiteboardScene」，`renderWhiteboardStatePreview` 进它的写接口；`canvas.whiteboard-document` 的读者加上新文件 `whiteboardStatePreview.ts`，写接口加上 `useWhiteboardFrameSize`（画框尺寸变成文档尺寸只经它）。
- **Q3（协调）画板相机截图失败** 用新键 `screenshotSaveFailed`：zh「截图没能存下来，请再点一次截图，画板里的内容还在」/ en「Couldn't save the screenshot. Take it again. Your board is unchanged.」。旧键 `screenshotFailed` 在白板段只服务截图这一处（`:286`、`:317` 截图路径的兜底、`captureViewport`），同提交删掉。
- **Q4（协调）出图失败** 三扇门共用一句不点名按钮的话，键 `drawingSaveFailed`：zh「画好的图没能存下来，请再试一次，画板里的内容还在」/ en「Couldn't save the drawing. Please try again. Your board is unchanged.」。不加特例分支。旧键 `snapshotSaveFailed` 同提交删掉。「完成」那条事务没有自带消息时的兜底 `saveFailed`「画板保存失败」和这句是同一件事的两种说法，一并换成 `drawingSaveFailed` 并删掉，不留同义键。相机钮的兜底按它走的是哪个事务取句子：图片入口（保存为主图）是出图事务 → `drawingSaveFailed`，画板入口（截图）→ `screenshotSaveFailed`。
- **Q5（协调）拍板图。** `docs/design/boards/` 的板清单里没有这几句失败文案（已核 `InlineWhiteboard.board.json`），`## 拍板图` 用 `pure-bugfix`，写明只改了报错文案。
- **Q6（协调）同一类的其它门不进本单**：轻量卡、Agent 指向元素、生成列表、下游参考芯片对老画板仍是空的，记 0.25，写进残余风险。

## ★0 先查别人（纯 bug 修复不要求；路径推出新功能，仍列三条）

- Excalidraw `exportToCanvas` / `exportToBlob`（`@excalidraw/excalidraw` 的导出工具，https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export ，2026-10-27 查）· 拿场景元素和 appState 现画出一个 canvas（示例里不挂进页面），`exportToBlob` 再经 `canvas.toBlob` 出图；要图的时候从场景现画，不另存一份 · **确认了**第 1 件「按 state 现画、不落盘」。
- `@leafer-in/export` 2.1.7（`node_modules/@leafer-in/export/dist/export.esm.js:210-238`）· `export()` 进一个全局串行队列（`parallel: false`），先等 `waitViewCompleted` 和全局 `Resource.isComplete`；`screenshot: true` 取 leafer 自己的画布范围 · **改了**预览的排法：一次只交一张，用户按「完成」最多排在一张预览后面；**确认了**离屏实例和「完成」走同一个导出，结果一致。
- Mantine 8.3.18 `useDebouncedCallback`（`node_modules/@mantine/hooks/esm/use-debounced-callback/use-debounced-callback.mjs`）· 回调存 ref、返回带 `cancel` / `flush` 的函数、卸载时撤掉 · **确认了**用它替掉手写计时器；**改了**提交回调的写法：回调不带参数，自己重读真值，不把观察时的尺寸闭包带进去。
- React Flow 12 受控节点（`@xyflow/react` 的 `nodes` → 内部 store 在 effect 里同步）· 节点尺寸经两段更新才落到 DOM，画框比文档晚一帧以上 · **改了**门的设计：门把「我请求的画框尺寸」登记为等待中，画框路过或落到这些尺寸都不算用户拖框。

## ★1 用户怎么用

- 当我打开以前画过的项目（0.23.0 或 10-22 之前画的画板，只按过「完成」），我想在画布上一眼认出每块画板画了什么，以便不用逐个点开，也不会以为白画了。
- 当我在画板里拖框、点比例、在尺寸框里改尺寸或撤销，我想画板停在我最后定的那个尺寸，以便「完成」导出的就是我看到的范围。
- 当出图没存下来，我想知道是图没存下、我的画还在、再试一次就行。

步骤：
1. 打开一个有老画板的项目。
2. 老画板卡片上显示画过的内容，和出过图的画板长得一样；空画板仍是启动器。
3. 点它（先选中再点，规矩不变）打开，笔画、文字、图片都在。
4. 拖框、点比例、改尺寸或撤销，停手后工具条读数和盘上尺寸都是最后定的值。
5. 按「完成」。万一失败：编辑器留着，提示说真话，按钮能再点；再按一次就成功。
6. 卡片显示新出的图（10-22 的行为不变）。

不做什么：不给老画板自动补写结果，不落盘；打开画板和按「完成」的既有行为都不变；不改绘制、导出、素材面板、版本历史和节点外壳；不新增元素和卡片状态；现画的预览只给眼睛看，不当节点结果，所以要连到下游当参考仍要先按一次「完成」（和改前一样）。

已知坑：
- 现画预览和「完成」的导出共用 Leafer 的全局导出队列，预览自己排成一次一张。
- 预览和「完成」导出一样画背景层的 `#fbfbfa`；背景层被隐藏时，空白处透出卡片底色（和编辑器里看到的一样）。
- 画布开了 `onlyRenderVisibleElements`，视口外的卡片不挂载、不现画；挂上了也要在视口里（IntersectionObserver）才开始现画。

真实任务（素材用仓库的真镜头 640×360，夹具在测试和探针里自己造，不拷用户项目）：
1. 0.23.0 形态的老画板（只有 state：红色画笔一笔 + 一段文字 + 一张导入照片，没有 result）：打开项目后卡片显示内容；打开它，不改直接按「完成」，正好出 1 版。
2. 画框往外拖再拖回原尺寸；尺寸框零间隔连敲（V 报告 sizerace 手法）。
3. 临时夹具项目的 assets 目录改成不可写后按「完成」、按相机（V 报告 S5 手法），看两句提示；恢复权限再按一次，正好 1 版。

指标（目标 → 信号 → 指标；量具逐个点名）：
- 主指标：有可见内容、没有结果的画板，打开项目后显示内容的比例。基线 0/1（V 报告 S3a，2026-10-24），目标 1/1。量具：`WhiteboardCardBody.test.tsx` 老画板格 + 本线真机探针截图（中英）。
- 质量指标：尺寸停在中间值的比例。基线 2/18（V 报告 sizerace），目标 0。量具：`useWhiteboardFrameSize.test.tsx` 的往返格和四扇门格（确定性，先在旧代码上红）+ 真机来回拖截图；sizerace 探针重跑 18 次**未验证：缺量具**（探针在协调状态目录，不进仓库，能跑就补）。
- 质量指标：出图 / 截图失败时的提示等于 `drawingSaveFailed` / `screenshotSaveFailed` 键的值（中英）。基线：说「截图」的旧句子。量具：`whiteboardProjectContext.test.ts` 失败路径格、`whiteboardFailureCopy.test.ts`、`check:i18n`、S5 手法真机截图。
- 护栏：现画不写盘（老画板节点打开前后每个值都相同；实现后真机核出：打开项目时应用本来就会重存一次 `project.json`，没动过的节点也只差键序，所以按值比、不按字节比，2026-10-27）；空画板仍是启动器；有结果的画板不现画；编辑中不现画。量具：卡片单测（`updateNode` / 落盘 0 次）+ 真机探针读 `project.json` 比对。
- 护栏：走查第一步不再因元素没就绪拿到 null。量具：走查中英各真跑一遍，记首轮结果；连跑统计**未验证：缺量具**。
- 性能：见 ★7。

### ★1b 连带界面

- 画布轻量档（`LightweightGenerationNode`）、Agent 指向元素（`nodePointerFace`）、生成列表、下游参考芯片都按 `node.result` 取图，对老画板仍是空的。本单不改（Q6，记 0.25）。
- 失败提示只出现在编辑器工具条下方的内联反馈里（`WhiteboardEditingToolbar` 的 `feedback`），不进通知中心，也没有 Agent 回执。

## ★2 谁说了算

- **画板节点在画布上的样子**：唯一 owner 是 `WhiteboardCardBody`。规则换成一条：有可见内容就显示画板的图（有结果用结果图，没结果用按 state 现画的预览），没有可见内容才显示启动器。「有没有可见内容」只有一个定义 `whiteboardHasVisibleContent`，卡片和「完成」读同一个函数，所以卡片显示启动器等价于「完成」只存 state。
- **state → 图**：新文件 `whiteboardStatePreview.ts`。
  - `renderWhiteboardStatePreview(state)`：一次性离屏 Leafer（leafer-ui 的 `Leafer`，不给 view，不带 editor），挂一个 rootGroup，用 `renderWhiteboardScene`（编辑器用的同一个场景渲染器）画，`export('png', { blob, screenshot, pixelRatio })` 导出，长边不超过画布预览上限 `CANVAS_PREVIEW_LONG_EDGE_PX`（1024），`finally` 里销毁。`renderWhiteboardScene` 的 context 类型去掉它从不读的 `app`，离屏实例不必冒充 App。
  - `useWhiteboardStatePreview(state, start)`：模块级缓存，键是 `whiteboardRasterStateKey`；一次只渲染一张；挂着的卡片持有它用的那张，没人持有的最多留 8 张，多出来的撤掉 blob 地址；失败记 `logRendererWarn('whiteboard-state-preview-failed')`，卡片回到启动器。不写 store，不落盘。
  - 卡片只在 `!node.result && whiteboardHasVisibleContent(state)` 时要预览，并且卡片在视口里（`useDeferredNodeMediaVisibility`）才开始现画。
  - 编辑中不现画是结构保证的：画板会话开着时 `BaseGenerationNode.tsx:332` 根本不挂卡片正文。
  - 碰到的概念：`canvas.whiteboard-scene`（多一个离屏实例，改登记，Q2）、`canvas.whiteboard-document`（加一个读者）、`canvas.whiteboard-session`（卡片仍只调 `openWhiteboard`，不变）。
- **画布尺寸**：文档的 `canvasDimensions` 归 `WhiteboardDrawingTool` 的文档历史（`setState` → `storeDocument`）。「画框尺寸什么时候变成文档尺寸」改由 `useWhiteboardFrameSize` 一处说了算：
  - 它独占 live 尺寸、待提交（Mantine `useDebouncedCallback`，250ms）、画框比例、等待中的画框尺寸；
  - 一个判断函数 `readFrameAgainstDocument(画框, 比例, 文档)` 给三种结论：量不到 / 一样 / 不一样（换算后的尺寸）。观察和提交共用它；
  - 提交回调不带参数：触发那一刻重读画框和文档，「不一样」才写画框此刻的尺寸，然后清 live；
  - 比例、尺寸框、撤销 / 重做三扇门改调 `settle(尺寸)`：撤掉待提交、清 live、把「画框现在的尺寸」和「请求的画框尺寸」记进等待中，再请宿主调画框。三扇门不再直接调 `onBoardDimensionsChange`；
  - 打开：第一次量得到的画框定比例，并和文档尺寸一起记进等待中；宿主的打开适配（`InlineWhiteboard.tsx:81-86`，不改）之后落地，不写文档；
  - 观察规则：量不到 → 不动（排着的提交到点会重读）；落在等待中的尺寸上 → 不算拖框（落在最新请求的尺寸上 → 清空等待中）；否则「一样」→ 撤掉待提交、清 live；否则「不一样」→ live 跟上、重排提交；
  - 不再用 rAF 延后读，回调里直接读。
- **失败文案**：键归 `generationCommon.ts` 的 `#whiteboard` 段。调用点：出图事务 `saveImageWhiteboardSnapshot` 与「完成」兜底 → `drawingSaveFailed`；截图建节点 → `screenshotSaveFailed`；相机钮兜底按事务取句。
- 同一份事实存了几份：老画板的图，落盘 0 份，内存缓存 1 份（派生，丢了可以重画）；尺寸，文档 1 份，加 live 1 份（只用于拖框过渡显示，提交、门或回到原尺寸后清空）。
- 不靠猜意图：是否现画只看 `node.result` 和 `whiteboardHasVisibleContent`；「不算拖框」只看画框是否落在门自己登记过的尺寸上。

## ★3 一致与复用

- 卡片外观：复用现有「有结果」分支，`CardActivationButton` + `DeferredNodeImage`。品牌类型 `CanvasImageSource` 经 `canvasImageSourceOf({ type: 'image', url, previewState: 'source' })` 拿到：预览长边已有界，就是「源本身已有界」（bounded-source），不用改 `canvasImageSource.ts`。现画过程中显示 `DeferredNodeMediaPlaceholder`（结果图排队时同一块静态底）。没有新样式、新元素或全局 CSS。
- 渲染：复用 `renderWhiteboardScene` 和 `restoreSceneTransforms`。否决「另写一个 SVG 渲染器」：那是第二份渲染器，橡皮蒙版、翻转、组合变换都要重写一遍。
- 缓存键用 `whiteboardRasterStateKey`（「完成」判断「没改动」用的同一个键）；有没有内容用 `whiteboardHasVisibleContent`。缓存形状照 `src/media/useFilmstrip.ts` 的模块级 Map + 订阅 + `useSyncExternalStore`；不用 zustand（会多一个要声明项目生命周期的 store）。
- 尺寸同步：Mantine `useDebouncedCallback`（同一个包的 `useStateHistory` 已在这个文件里用）。
- 文案：沿用 `generationCommon.whiteboard` 命名空间。测试按键取值（`check:test-copy-literals` 不许抄字面）。
- 走查：复用 `_assert.mjs` 的 `waitForVisualQuiescence` 和 Playwright 的 `toBeVisible()`，不新写等待器。
- 性能量具：现有 `tests/ux/whiteboard-perf.probe.mjs` 加一个 scene，不自写剖析器。
- 第二份定义：没有。

## ★4 全状态

画板卡片（老画板 = 没有结果、有可见内容）：

| 状态 | 用户看到什么 |
|---|---|
| 空画板（没有结果，没有可见内容；只有橡皮、只有空白文字也算空） | 启动器「打开画板」（不变） |
| 有结果图 | 结果图（不变，不现画） |
| 老画板，还没进视口 / 现画中 | 和结果图排队时同一块静态底，能点开（同一个 `handleOpen`） |
| 老画板，现画好了 | 现画的图，样子和有结果时一样，点开规矩不变（先选中再点） |
| 老画板，现画失败（Leafer 加载失败或导出报错） | 回到启动器（今天的样子），点开内容都在；记渲染层日志，不弹错，这不是用户的动作失败 |
| 老画板，素材图文件丢了 | 照 Leafer 现状画，缺的那块空着，和「完成」导出一致 |
| 编辑中（会话开着） | 卡片正文不挂载，不现画。关闭后：出了图就显示结果图；空画板显示启动器；没出图的按最新草稿现画 |
| 只读 | 现画的图照样显示，点开无效（同现状） |
| 轻量档（大画布缩得很远） | 不渲染卡片正文，不现画；轻量卡对老画板仍是空的（Q6） |
| 取消中 / 过期 / 能力不可用 | 不适用：现画不调模型、不联网，Leafer 是本地库，没有要等的外部能力 |

尺寸：拖框时工具条读数跟着 live 尺寸走；停手 250ms 后重读，把画框此刻的尺寸提交为文档尺寸；回到原尺寸时撤掉待提交、清 live。比例、尺寸框、撤销写进来的尺寸，不会被旧的待提交盖回去；画框在适配途中路过的尺寸不显示、不提交。

失败提示（中英，键值见「已定的事」Q3 / Q4）：

| 怎么走到 | 提示 |
|---|---|
| 画板「完成」、图片入口「完成」、图片入口相机「保存为主图」：落盘拿不到地址，或失败没有自带消息 | `drawingSaveFailed`。编辑器留着，按钮退出忙态，能再点 |
| 画板入口相机「截图并创建图片节点」：落盘拿不到地址、截图节点建不出来，或失败没有自带消息 | `screenshotSaveFailed` |

文案不提钱、不提计费。

## 5 中途表

| 状态 \ 打断 | 停（点别处 / 按 Esc） | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 现画中 | 不受影响：现画不随选中变化；卡片卸载后渲染照完、进缓存，没人持有就按上限淘汰 · 不花钱 · 无回执 | 渲染层退出，内存缓存丢掉，盘上不变 · 不花钱 | 不受影响：不联网 · 不花钱 | 重开项目再现画一次，盘上不变 · 不花钱 | 点卡片打开画板：卡片正文卸载，现画结果进缓存，关闭后直接用 · 不花钱 |
| 拖框待提交（250ms 内） | 点别处 = 关闭画板走「完成」：`getState` 本来就带 live 尺寸，导出按看到的尺寸；卸载撤掉计时器（和改前一样）· 不花钱 | 同上：没「完成」就关窗，最后一次拖框不进文档（和改前一样） | 不受影响 | 同关窗 | 连点比例 / 连敲尺寸框：每次都经 `settle` 撤掉待提交，停在最后一次 |
| 出图中 | 「完成」忙态期间不收第二下（不变） | 同改前：保存事务中断，盘上没有半个版本 | 落盘是本机写，不联网 | 同关窗 | 忙态挡住连点（不变） |

## 6 外部数据与失败

- 外部来源：只有项目里的素材图文件（`nomi-local://` 地址）和老项目存的 `meta.whiteboardState`。旧数据缺字段由 `readWhiteboardState` 补齐（规范：本仓 `whiteboardState.ts`）。图丢了 Leafer 照常画、缺那块；state 结构坏了 `readWhiteboardState` 返回空，卡片按空画板显示启动器。没有供应商 API，不涉及 key。

## ★7 性能

- ①新增的用户操作：打开含老画板的项目（每块老画板卡片进视口后离屏现画一次，按键缓存，一次一张）。拖框、比例、尺寸框、撤销没有新操作，只改了提交时机。
- ②最坏规模：派工书定的 20 块老画板同时在视口里，每块 1280×720，2 张导入照片（仓库真镜头抽帧，6 张不同帧轮着用）+ 12 笔画 + 1 段文字，20 块各不相同（不吃缓存）。
- ③预算（提议）：主指标「20 张卡片挂上 → 20 张预览全部解码上屏」≤1000ms（默认「打开到能操作 ≤1s」用在本单新加的这一段；之前的冷打开另有场景 `project-open-100-nodes` 和它的欠账）；同一段里 >50ms 的长任务按默认 0 个，只打印。另记「双击项目卡 → 预览全部上屏」和这一段里最长的那个长任务（原始结果 `projectOpenToPreviewsMs` / `longestTaskMs`），写进报告。
- ④场景 `whiteboard-legacy-previews-open`（`tests/ux/whiteboard-perf.probe.mjs --scene legacy-previews --repo-media`），按派工书由本线跑出基线（`--noisy`），原始结果随 PR 提交。

## 8 真实条件

- 中文 / 英文：真机探针中英各截（老画板卡片 before / after、来回拖后的尺寸、两句失败提示），本线亲眼看。
- 走查：`whiteboard-refactor.walk.mjs` 中英各真跑一遍。
- Windows、最小窗口、干净安装：`unverified`（本线在 Mac 上跑）。真付费：不适用，不调供应商。真规模：性能场景 20 块老画板。

## 拍板图清单

不适用：pure-bugfix。不新增元素、不改布局；老画板卡片用的是「有结果」分支的同一个样子；只改了报错文案，`docs/design/boards/` 的板清单里没有这几句（Q5）。

## ★9 验收与回滚

验收清单（实现线自验、验收线只核这份；标「先红」的先在旧代码上跑红）：

- **A 第 1 件（`WhiteboardCardBody.test.tsx`）**
  - A1（先红）：`kind=whiteboard`、没有 result、`meta.whiteboardState` 里有一笔 brush：渲染 `whiteboard-open-preview`，里面的图来自现画，不渲染 `whiteboard-empty-action`。
  - A2：默认空 state、只有橡皮、只有空白文字都是启动器；有 result 时显示结果图；这几种现画都是 0 次。
  - A3：按 `whiteboardRasterStateKey` 缓存：同键两张卡只渲染 1 次；只改图层名 / 选中图层不重画；改笔画会重画；同一时刻最多一张在渲染。
  - A4：现画失败回到启动器，记一次日志。
  - A5：现画全程 `updateNode` / 落盘 0 次；离屏 Leafer 导出后销毁；预览长边 ≤1024；不在视口时不开始。
  - A6 真机（本线探针，不进仓库；派工书只许走查加等待）：0.23.0 形态老画板打开项目后卡片里有图、没有启动器；打开前后这个节点在 `project.json` 里每个值都相同（键序不算：旧卡片和没动过的空画板节点打开后也只差键序，真机核过）；打开它不改按「完成」正好 1 版；中英 before / after 截图。
- **B 第 2 件（`useWhiteboardFrameSize.test.tsx`，渲染真的 `WhiteboardDrawingTool`）**
  - B1（先红）往返：画框 S0 → S1 → S0（都被观察到），300ms 后文档是 S0，live 为空，没有新版本。
  - B1'（重读格）往返：画框回到 S0 但观察还没到，提交先到点：不写文档。
  - B2：判断函数：差不到 1 屏幕像素算一样；取整相等算一样；宽或高 <1、NaN 算量不到。
  - B3（先红）每扇门一格「提交的是真值，不是中间值」：比例、尺寸框、撤销——拖框 S1 排着提交，100ms 后过门，画框适配 300ms 后才落地：文档是门写的值，过门后没显示过别的尺寸，只多 1 个版本。
  - B3'：尺寸框连敲（64 再 640），两次适配依次落地：停在 640，没显示过 64。
  - B4（先红）打开：节点 4:3、文档 16:9，打开适配晚于 250ms 落地：文档仍是 1280×720，没有新版本。
  - B5 真机：画框往外拖再拖回，工具条读数和盘上 `canvasDimensions` 都是原尺寸（中英截图）。
- **C 第 3 件**：走查所有量取改走一个本地 helper（等可见 → `waitForVisualQuiescence` → 量，量不到就红）；标题拖完断言节点 position 真的变了。中英各真跑一遍。
- **D 第 4 件**
  - D1（先红，`whiteboardProjectContext.test.ts`）：画板「完成」落盘返回空：提示是 `drawingSaveFailed`；`onClose` 没被调；没有带 result 的 `updateNode`。
  - D2：图片入口相机「保存为主图」落盘返回空 → `drawingSaveFailed`；画板入口相机落盘返回空 → `screenshotSaveFailed`。
  - D3（`whiteboardFailureCopy.test.ts`）：zh / en 都有两个新键；两边都没有 `snapshotSaveFailed`、`screenshotFailed`、`saveFailed`；`drawingSaveFailed` 不点名按钮（不含同语言的「完成」「保存为主图」）；`pnpm run check:i18n` 绿。
  - D4 真机：S5 手法在临时夹具项目上触发，中英各截两句失败提示，亲眼看。
- **E 通用**：改到的 vitest（经锁）、ESLint、`node scripts/typecheck.mjs`（经锁）、`pnpm run check:i18n`、`node scripts/check-concept-owners.mjs`、`git diff --check`、推送前快检，每条记退出码；性能场景见 ★7。

反例（实现后至少真做三条，做完还原，记「反例 → 结果 → 证据」）：

| 反例 | 必须红的 |
|---|---|
| R1 hook 提交时不重读真值，写观察那一刻的尺寸 | B1' |
| R2 拿掉派生预览，卡片回到只认 result | A1 |
| R3 比例门绕开 hook，直接调 `onBoardDimensionsChange` | B3 比例格 |
| R4 尺寸框门、撤销门同样绕开 | B3 对应格 |
| R5 打开时不把第一次量到的画框记进等待中 | B4 |
| R6 现画里加一次 `updateNode` | A5 |

同一类还会从哪些入口、形状、边界、版本回来：

- 第 1 件：老数据形状。只有 state 的画板本单收；有结果、但还有没按「完成」的草稿的画板，卡片显示旧结果图（残余）。其它呈现门（轻量卡、Agent 指向元素、生成列表、下游参考）记 0.25（Q6）。
- 第 2 件：画框尺寸变化的全部来源：拖框（NodeResizer）、尺寸框、比例按钮、撤销 / 重做、打开时的适配、画布缩放（缩放不改画框的 CSS 尺寸，不触发 ResizeObserver）。前五个都进了 hook；「拖框」信号仍靠 ResizeObserver 推断，接 `NodeResizer.onResizeEnd` 要改节点外壳，另立（复盘第 6 节）。
- 第 3 件：本走查的裸量取本单收；仓库里其它走查的裸 `boundingBox()` 不在本单（残余，可以做成门岗，另立）。
- 第 4 件：出图事务三扇门 + 截图事务一扇门，四处都走键值；兜底句按事务取。

回滚：revert 实现提交即可。现画预览不落盘、不改数据格式，revert 后老画板回到启动器；文案键 revert 后旧键回来。本卡、复盘和根因合同是单独的文档提交。

## 功能分类

- [x] 新界面 / 改交互（路径推出：改了 `src/**/*.tsx`；不新增元素，拍板图用例外 `pure-bugfix`，只改了报错文案）
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [x] 大数据量 / 画布 / 长列表（路径推出：`src/workbench/generationCanvas/`；老画板多的项目打开时的现画成本见 ★7）
- [ ] 生成效果
- [ ] 数据格式（现画不落盘，不改格式）
- [x] 新增功能 / 性能（路径推出；`perf-scenario` 证据见 ★7）
