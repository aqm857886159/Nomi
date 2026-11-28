# 设计卡：分镜 · 画布 · 列表三处生成面同源收敛与防呆契约

```
改动名：三处生成面（分镜 · 画布 · 列表）同源舞台、唯一领域命令与编译期穷尽契约   线/负责人：impl-view-parity   类别：[花钱][新界面]
```

## ★0 先查别人

- `docs/plan/2026-10-29-view-parity.direction-check.md:1` · 复盘指出「画布与列表共用一份 store 数据，但节点正文与动作在列表里手写了第二套只读子集（`TextPreview` 4 行截断、48 根静态假波形 `AudioStrip`、裸调 `setNodeMainResult` 漏白板提交与尺寸回填），每加一种能力就漂移一次」 · **确认了**本次不修补列表私有预览组件，而是抽出与 React Flow 坐标解耦的唯一 `<NodeStageSurface host="canvas" | "list-detail">`，同提交删除 `GenerationListParts.tsx` 中的 `TextPreview` 与 `AudioStrip`。
- `src/workbench/generationCanvas/nodes/NodeFloatingToolbar.tsx:69` · 节点浮条外壳直接无条件调用 `@xyflow/react` 的 `useViewport()` 做反向缩放与舞台夹紧，导致脱离 `<ReactFlowProvider>` 的列表大详情一旦挂载真实节点工具条即抛错崩溃 · **改了**浮条与视频控件的宿主适配方式：引入 `NodeStageHostContext`（`'canvas' | 'list-detail'`），画布宿主保留 `useViewport()` 反向缩放与舞台夹紧，列表详情宿主走流式内联工具栏（`zoom = 1`），不复制工具栏按钮定义。
- `src/workbench/generationCanvas/store/canvasPickMode.ts:40` 与 `src/workbench/generationCanvas/nodes/NodeParameterControls.tsx:161` · `enterCanvasPickMode` 虽把视图切到 `'canvas'`，但列表卸载时生成框 `useEffect` 清理函数当场取消了刚发起的 `request`，且点选完成或取消后不记来源视图，用户在列表点 `↖` 立即失效或回不到原镜头详情 · **改了** `canvasPickMode` 状态机：从列表发起点选时记录 `returnToList: { inspectorKey }`，列表切画布的预期卸载不误杀当前点选，点选成功或 `Esc`/空白取消后自动切回列表并恢复原 `inspectorKey`。
- `src/workbench/creation/storyboard/shotRow/ShotComposerBar.tsx:87` 与 `electron/shared/videoCapabilities/resolveModelParams.ts:31` · 分镜行切模式直接写 `{ modeId, params: undefined }` 清空已选画幅/清晰度等参数，而画布与发送复查已在 `resolveModelParams` 维护按目标模式控件保留合法参数、裁剪越界值、丢弃未知键的唯一纯函数 · **改了**分镜镜头行与参考卡切模式逻辑：统一经 `buildStoryboardModeChangeParams` 调用 `resolveModelParams`，保留目标模式兼容参数并剔除不兼容参数。
- https://reactflow.dev/api-reference/hooks/use-viewport · React Flow 官方文档说明 `useViewport` 仅在 `<ReactFlowProvider>` 子树内可读视口变换，跨非画布视图复用节点内容组件时应将画布定位外壳与节点内容舞台分层 · **确认了** `BaseGenerationNode` 只留画布拖拽/缩放/连线外壳，正文、错误恢复卡、样片行与媒体工具栏下沉到无坐标依赖的 `NodeStageSurface`。
- 出口：`src/workbench/generationCanvas/nodes/NodeRecoverableReport.tsx:24` 与 `src/workbench/creation/storyboard/shotRow/StoryboardFrameActions.tsx:150` · 任务轮询超时进 `recoverable` 时主按钮走已有任务号「重新取回」（不重发扣费），同时提供明确释放占用的「重新生成」出口避免上游死任务卡死 · **确认了** `NodeFailureReport` / `NodeRecoverableReport` 在画布与列表大详情同源提供「重新取回」主动作与「重新生成」次动作出口，点选模式按 `Esc` 或点空白随时取消并原路返回列表详情。

## ★1 用户怎么用

- **用户故事**：当创作者在「创作分镜」「生成画布」「生成列表（含大详情）」三处之间来回推进同一批镜头、配音、转写和文本卡片时，我想在列表里直接新建节点或导入素材、在列表大详情里像画布一样编辑文本选区改写、试听真实音频并复制/导出 SRT 字幕、执行裁切/宫格/去背景/抽帧/加时间轴/定稿跳过批量、点 `↖` 去画布点选参考图后自动回到当前详情、在分镜切模式时不丢兼容参数，以便不用因为列表残缺或参数被清空而在三处之间反复返工或误点重生成多花钱。
- **操作流（6 步）**：
  1. 在生成页切到「列表」（空项目或已有镜头项目），直接通过列表顶栏或空态的同源新建/导入入口添加图片/视频/声音/文字节点或导入本地文件；
  2. 点开任意文本节点进入列表大详情，直接在富文本正文中编辑并划选句子，在下方加工框点「改写」精确替换选区而非退化为整段续写；
  3. 点开声音/转写节点进入列表大详情，直接点击真实 `<audio>` 播放/拖动进度条，或一键复制转写文本、导出字幕 SRT；
  4. 点开图片/视频节点进入列表大详情，在同一条 600px 中轴线上查看画面、使用内联媒体工具栏（加时间轴、复制变体、裁切/宫格/抠图、视频抽帧/修剪、定妆/定稿）与版本切换（自动提交白板并回填真实宽高）；
  5. 在列表大详情生成框点 `↖`（从画布点选参考），界面自动暂切到可见画布完成点选（或按 `Esc` 取消），随即自动切回列表原镜头大详情；
  6. 在创作页分镜表切换镜头或参考卡的生成方式（如 `i2i → t2i`、`i2v → t2v`），兼容参数（如清晰度、比例）自动保留，已定稿镜清楚显示「定稿 · 不进批量」而不与已退役的画布编辑锁混淆。
- **不做什么 + 已知坑**：不恢复 2026-11-17 已按用户拍板删除并由 ESLint `node-lock-removed` 封禁的 `node.locked` 编辑锁；不把 3D 导演台、剪辑时间轴条、拆解表等强空间工具塞进列表小盒子，而是经 `NODE_SURFACE_CONTRACTS` 编译期穷尽声明 `canvas-only` 并在列表大详情给出清晰「去画布」指路；不在列表网格卡片上为每张卡挂载重型 ProseMirror 编辑器（网格卡保持轻量摘要，点进大详情才挂单实例真实舞台）。
- **真实任务**：
  1. 空项目切到生成列表 → 直接新建文字卡并写入三行分镜梗概、划选第二行执行预设检查，再新建声音卡与图片卡并在列表大详情操作工具栏；
  2. 多版本图片/视频镜头在列表大详情切换上下版本 → 验证真实尺寸元数据回填，点击 `↖` 去画布点选角色参考卡后自动返回列表大详情且参考槽已连上；
  3. 含超时可找回（`recoverable`）节点与分镜多模式镜头的项目 → 在列表大详情验证「重新取回」与「重新生成」双出口，在分镜行切换模式验证兼容参数保留。
- **指标与量具（Goals-Signals-Metrics）**：
  - **主指标**：节点视图能力同源覆盖率 → `GENERATION_NODE_KINDS` 接入 `NODE_SURFACE_CONTRACTS` 且列表零手写残缺预览副本的比例 → 基线 0%（列表手写 `TextPreview` / `AudioStrip` 两套残缺副本、切主图 2 扇门）→ 目标 100%（`17/17` kind 穷尽受控、`setNodeMainResult` 写门 `2 → 1`）；量具：`src/workbench/generation/list/threeSurfacesParity.goal.test.tsx` + `node scripts/door-map.mjs setNodeMainResult`。
  - **质量指标**：列表大详情舞台同轴对齐误差与跨视图往返成功率 → 大详情预览容器、内联工具条、版本条、样片行、生成框中线 `centerX` 偏差 `0px`（`<= 2px`），列表 `↖` 画布点选往返恢复率 100%；量具：`src/workbench/generation/list/threeSurfacesParity.goal.test.tsx` + `tests/ux/ui.mjs` 1440×900 实窗几何与截图核验。
  - **护栏指标**：画布 ↔ 列表视图切换延迟不退化 → 120 节点规模下切换中位数 `<= 100ms`、p95 `<= 150ms`；量具：`pnpm run perf:scenarios -- --id workbench-switch-canvas-list`。

### ★1b 连带界面

- **错误卡与可找回面板（画布节点 & 列表大详情）**：复用同一份 `NodeFailureReport` / `NodeRecoverableReport`，`recoverable` 态主按钮显示既有 `generationCommon.production.runAction.retry-retrieval`（「重新取回」/ `Retrieve again`），次动作提供 `generationCommon.observability.action.releaseRegenerate.main`（「重新生成」/ `Regenerate`），文案零「免费 / 不扣费」字样（守 `check:i18n`）。
- **版本切换撤销提示**：`switchNodeMainVersion` 在画布版本宫格与列表大详情切换版本时共用同一套白板落盘与尺寸回填，版本宫格保留既有可撤销后台提示文案。
- **分镜行与画布/列表 `meta.frozen` 状态标签**：视觉锚统一称「定妆 / 已定妆」（放行下游镜头），已生成普通镜头统一说明「定稿（不进批量、不被重跑）」/「已定稿 · 不进批量」（`storyboardEditor.frame.unfreeze` 保持「解锁」兼容既有交互），彻底与已删除的节点编辑锁解耦。
- **画布点选顶栏**：从列表点 `↖` 暂切画布期间沿用画布顶部既有 `CanvasPickModeLayer` 提示条（「选择要引用的节点 · Esc」），点选或取消后自动切回列表原详情，不新增额外弹窗。

### ★1c 老用户

- **存量项目与老数据兼容**：本次不新增、不修改持久化 schema 字段；存量项目的文本节点（`contentJson` / `result.text`）、音频与转写节点（`result.type === 'audio' | 'text'`）、多版本历史（`resultHistory`）、分镜 `meta.frozen` 与 `shot.params` 打开即在同源舞台与分镜行直接生效；退回上一版应用仍可无损打开全部项目文件。证据：`src/workbench/generation/list/threeSurfacesParity.goal.test.tsx`。

## ★2 谁说了算

- **概念归属与唯一 owner**：
  1. `generation.list-view`（列表投影）：唯一 owner 仍是 `src/workbench/generation/list/generationListModel.ts#deriveGenerationList`，节点在列表中的角色归类改读 `src/workbench/generationCanvas/nodes/nodeSurfaceContract.ts#NODE_SURFACE_CONTRACTS` 编译期穷尽表，删除 `generationListModel.ts` 与 `resolveRenderKind.ts` 各自手抄的 kind 集合。
  2. `canvas.node-versions`（切换主版本）：底层状态变更归 `nodeResultLifecycle.ts#setNodeMainResultPatch`，带副作用的 UI 领域命令（白板 `finishWhiteboard` 提交 + 素材侧车真实像素 `findCanvasResultMediaDimensions` 回填 + `setNodeMainResult`）唯一收口到 `src/workbench/generationCanvas/nodes/versionCards/switchNodeMainVersion.ts#switchNodeMainVersion`。`node scripts/door-map.mjs setNodeMainResult` 写门从 **2 扇（`GenerationListDetail.tsx`、`NodeVersionCardsHost.tsx`）减为 1 扇（`switchNodeMainVersion.ts`）**——使用结果的那一步只经唯一领域命令写入。
  3. 画布点选跨视图往返（`useCanvasPickModeStore`）：唯一 owner 为 `src/workbench/generationCanvas/store/canvasPickMode.ts`（`request` 与 `returnToList` 均声明为 `project` 寿命，`releaseProject` 同步清空）；不靠「组件卸载 = 用户取消」猜测意图，列表切画布造成的预期卸载不取消点选，只有显式 `pickCanvasNode`、`cancelCanvasPickMode` 或项目切换才结束点选。
  4. 分镜模式切换参数解析：复用 `electron/shared/videoCapabilities/resolveModelParams.ts#resolveModelParams` 唯一参数策略核，由 `storyboardComposerModel.ts#buildStoryboardModeChangeParams` 适配给 `ShotComposerBar`、`StoryboardShotRow` 与 `StoryboardAnchorRow`。

## ★3 一致与复用

- **历史约定核查**：
  - `docs/plan/2026-10-08-generation-list-view.md` 定下「列表与画布同一份 store 数据、列表网格不套重编辑器、改东西在大详情里」——仍然算数，本次网格卡片继续保持轻量只读，只在单实例大详情挂载同源 `<NodeStageSurface host="list-detail">`。
  - `2026-11-17` 用户拍板撤除画布节点编辑锁（`eslint.config.mjs` `node-lock-removed`）并保留 `meta.frozen` 管批量范围——仍然算数，本次严守该边界，绝不重引 `node.locked`，而是把 `meta.frozen`（锚卡定妆 / 镜头定稿跳过批量）接进共享工具条并理清分镜文案。
- **三条路选择**：选**换一种做法（抽唯一无坐标同源舞台 + 收归唯一领域命令 + 编译期穷尽表，同提交删掉列表手写预览与裸写旁路）**，拒绝在 `GenerationListDetail` 里继续手抄第二套音频播放器、第二套富文本编辑器或第二个锁字段。
- **复用的现成组件与函数**：直接复用 `TextDocumentNode`（`useNomiRichTextEditor` + `landSelectionRewrite`）、`AudioStripNode`、`NodeCardBody`、`NodeFailureReport` / `NodeRecoverableReport`、`ImageQuickActionsToolbarHost`、`NodeResultDownloadButton` / `NodeVideoFrameToolbar`、`NodeSampleRow`、`NodeLayerSplitStatus`、`useCanvasAddIntentAction` / `canvasResidentAddIntents`、`resolveModelParams`。证据：`pnpm run check:self-written`。

## ★4 全状态

- **空态**：列表无节点时显示直接新建（图片/视频/声音/文字/剪辑/更多空间节点）与导入本地文件入口及「返回画布」；空文本节点在大详情显示可点击的正文编辑区与「试试」预设；空音频节点在大详情支持点击上传音频或由下方生成框配音生成。
- **加载 / 生成中**：列表网格卡显示队列或生成进度；大详情同源挂载 `NodeGeneratingOverlay` / `TextDocumentNode` 运行页脚（带停止按钮）；高清出片途中由 `NodeSampleRow` 显示「高清生成中」且样片照常可看可播。
- **成功态**：文本可编辑且选区同步 `meta.textGenSelection`；音频可播可拖进度、转写可复制与生成 SRT；图片/视频显示同源内联操作条（上时间轴、复制变体、裁切/宫格/抠图、视频抽帧/修剪、定妆/定稿、全屏、下载、生成记录）与版本切换。
- **失败态**：画布与列表大详情同源铺满 `NodeErrorReport`（人话原因、上游原话、重试/换模型/复制详情/技术详情/收起遮罩看旧片）。
- **部分成功 / 可找回态（recoverable）**：同源显示中性纸底 `NodeRecoverableReport`，主按钮「重新取回」续查已有任务，次按钮「重新生成」走释放重跑确认，底部可「收起」查看旧结果。
- **取消中**：生成中点停止按钮走 `requestTaskCancel`，文本加工页脚与生成等待层即时反馈取消状态；画布点选按 `Esc` 或点空白立即退出并回到列表原详情。
- **过期 / 切项目**：`switchNodeMainVersion` 在异步读尺寸前后均校验 `isProjectExecutionContextCurrent`，切项目后绝不往新项目串写；`canvasPickModeStoreLifetime.releaseProject` 切项目即清空 `request` 与 `returnToList`。
- **能力不可用**：图片快捷动作（如高清/扩图/图层分离）遇到当前目录缺对应能力模型时，沿用 `ImageQuickActionsToolbarHost` 的 `quickActionGuides` 给出缺口说明与一步直达「去添加 / 换同能力模型」引导，不只灰掉；`canvas-only` 节点在列表大详情明确展示「去画布」按钮一步直达该节点。
- **防撑破与双语**：列表大详情右栏统一收束在 `600px`（`NODE_COMPOSER_WIDTH`）同轴容器内，窄窗 `< 760px` 自动收起左 288px 窄轨，超长提示词/转写文本/上游报错均走内部独立滚动或 `line-clamp` 截断；全部新增文案中英双语齐全且不含计费承诺词。证据：`pnpm run check:i18n`。

## 5 中途表

| 状态 | 用户点停止 / Esc | 关窗 | 断网 | 重启应用 | 连点 |
|---|---|---|---|---|---|
| 列表大详情编辑文本 / 选区改写中 | 点页脚「停止」调 `requestTaskCancel` 停当前任务 · 已发请求按上游实际计费，未发不扣 · 页脚恢复可编辑并保留原文 | 实时 `writeNodeBody` 与失焦持久化保住已写正文 · 未发起生成不扣 · 重开项目见最新已存正文 | 改写请求失败落 `NodeErrorReport` · 未成功送达不扣 · 错误卡给重试与详情 | 未落地挂起任务按既有任务恢复链核对 · 不重复自动重发 · 节点状态如实回显 | 运行中预设与发送钮 `disabled` 拦截二次提交 · 不多扣 · 单条运行记录 |
| 可找回态（`recoverable`）点「重新取回」或「重新生成」 | 收起面板只撤遮罩不丢任务号 · 取回查询不产生新生成扣费 · 节点仍保留运行记录 | 主进程任务记录落盘 · 不因关窗重发扣费 · 重开仍在可找回态 | 取回失败在面板内展示最新上游/网络错误 · 查询不扣新生成费 · 可稍后再点「重新取回」 | 凭持久化 `runs[0].taskId` 重建查询 · 不扣新生成费 · 点「重新取回」继续拉回 | `pending` 态锁住「重新取回」按钮，「重新生成」经 `confirmAndRunNode(resend:true)` 单飞门拦截 · 不重复扣费 · 任务中心单笔记录 |
| 列表大详情切换主版本（`switchNodeMainVersion`） | 白板落盘未完成前取消则中止切换 · 本地操作无扣费 · 原主图不变 | 切换为单事务 store patch · 无扣费 · 已落盘则保留新主图，未落盘保旧主图 | 纯本地状态与本机素材侧车读取，断网无影响 · 无扣费 · 正常切版本并可 `⌘Z` 撤销 | 版本历史与 `versionNo` 持久在项目快照 · 无扣费 · 重开保持当前主版本 | 异步重算尺寸期间按最新 store 节点幂等写入 · 无扣费 · 主版本最终一致 |
| 列表点 `↖` 去画布点选参考 | 按 `Esc` 或点画布空白立即取消并自动切回列表原详情 · 无扣费 · 原参考不变 | `returnToList` 属会话内存态，关窗不写脏边 · 无扣费 · 重开回到干净默认态 | 纯本地画布连线交互，断网无影响 · 无扣费 · 连线实时生效 | 重启后项目连线按已落盘快照恢复 · 无扣费 · 画布与列表引用一致 | 新一次 `enterCanvasPickMode` 先覆盖旧请求并保留列表返回锚点 · 无扣费 · 仅最后一次点选生效 |

## 6 外部数据与失败

- **供应商异步任务状态与错误报文（HTTP / Relay）**：规范见各供应商任务查询接口及 `electron/shared/generationFailure.ts` 分类契约；偏差是第三方中转可能返回超长无空格 JSON 或 503 渠道暂不可用；失败时在画布与列表大详情同源经 `NodeErrorReport` / `NodeRecoverableReport` 展示结构化人话原因 + `break-words` 原始上游消息 + 复制详情，未知失败绝不甩锅给用户 API Key。
- **本地导入图片/视频/音频文件与尺寸元数据**：规范见 HTML Media / File API 与主进程 `assets.list` 侧车记录；偏差是历史素材或外链可能缺失宽高侧车或遇到浏览器不支持的编码（如部分 HEVC）；缺失侧车时 `switchNodeMainVersion` 捕获异常记日志并照常完成主版本切换（绝不卡死切版），视频解码异常由共享舞台内的 `NodeVideoPlaybackGuard` 走既有自动转码自愈或给出人话提示。
- **模型目录与模式参数 schema（`ModelOption` / `ModelArchetype`）**：规范见 `electron/shared/modelArchetypes/`；偏差是老分镜行或 Agent 草稿可能带有旧模式遗留参数；`buildStoryboardModeChangeParams` 经 `resolveModelParams` 过滤未知键、夹紧数值范围、回退非法枚举，绝不把非法参数透传到下游请求。

## ★7 性能

- **① 新增 / 变更的用户操作**：列表视图顶栏/空态新建节点与导入、打开列表大详情挂载 `<NodeStageSurface host="list-detail">`、大详情内切换主版本、从列表点 `↖` 切画布点选并自动切回列表、分镜底栏切换生成模式。
- **② 最坏规模**：单项目 120+ 个画布节点（含多版本图片/视频、长文本节点、音频转写节点）在画布与列表之间来回切换及点开大详情。
- **③ 性能预算**：画布 ↔ 列表视图切换可见反馈中位数 `<= 100ms`（p95 `<= 150ms`，场景门限 `<= 600ms`）；列表网格保持 `@tanstack/react-virtual` 虚拟化且零卡片级富文本实例，仅大详情单节点挂载 `NodeStageSurface`。
- **④ 覆盖性能场景与基线**：`workbench-switch-canvas-list`（`tests/perf/scenarios/workbench-switch-canvas-list.json`），提交前实跑 `pnpm run perf:scenarios -- --id workbench-switch-canvas-list` 记录中位数与 p95 写入 PR `## 验收证据`。

## 8 真实条件

- [x] macOS 隔离静默实窗（`1440×900`，`tests/ux/ui.mjs` 后台静默窗口，零抢前台焦点）
- [x] 中文界面（`zh-CN`，亮色 + 暗色双轨真截图亲眼核验）
- [x] 英文界面（`en`，亮色 + 暗色双轨真截图亲眼核验）
- [x] 真实规模与多节点种类（覆盖列表网格+新建入口、可编辑文本大详情、真音频播放+转写大详情、图片/视频内联工具栏+600px 同轴大详情）
- [x] 键盘交互（列表详情 `Esc` 返回、画布点选 `Esc` 取消自动回列表原详情、文本编辑器按键隔离不误触画布删除）
- [ ] Windows：`unverified`（当前工作机为 macOS，交跨平台门岗与 CI 验证）
- [ ] 最小窗口 / 干净安装 / 真付费：`unverified`（本轮在免费本地夹具与隔离实窗完成全链路验证，不擅自触发真实外部扣费请求）

## 拍板图清单

- 沿用既有列表与详情板 `docs/design/boards/2026-10-08/List.board.json` 与 `docs/design/boards/2026-10-08/ListDetail.board.json`（清单元素未删减，大详情补齐与画布同源的舞台内容、内联动作条与 600px 同轴排版，实窗 `zh-CN`/`en` × `light`/`dark` 截图交用户看图拍板后合并）。证据：`pnpm run check:board-parity`。

## ★9 验收与回滚

- **真实场景复现（R13）**：
  - **用户的流程**：用户在创作分镜、生成画布、生成列表三处切换制作时，发现列表模式不能直接新建/导入，点进列表大详情后文本卡只能看 4 行死文字且选区改写失效、声音卡是 48 根假竖条不能播也不能看转写字幕、图片/视频没有画布那排后处理与上时间轴工具条、点 `↖` 从画布选参考当场失效回不来、切版本漏回填尺寸、分镜行切模式把刚调好的参数全清空。
  - **我走的**：先用 `door-map` 盘点 `setNodeMainResult`（2 扇写门）与 `enterCanvasPickMode`（3 扇写门），编写必红回归单测 `src/workbench/generation/list/threeSurfacesParity.goal.test.tsx` 复现上述全部断层，完成同源实现后重跑单测与门岗，并用静默实窗截取 1440×900 `zh-CN`/`en` × `light`/`dark` 四组真图逐张目检。
  - **差别**：与用户本机操作使用完全一致的生产组件树与 store 状态机；媒体素材使用本机确定性 SVG/WAV/MP4 测试资产，不发真实外网付费 API。
  - **修前**：`GenerationListParts.tsx` 存在只读 `TextPreview`（`line-clamp-4`）与 48 根静态竖条 `AudioStrip`；`GenerationListDetail` 无内联工具栏、裸调 `setNodeMainResult`（2 扇门）；列表切画布点选被卸载清理当场取消且不回跳列表；`ShotComposerBar` 切模式写 `params: undefined` 清空兼容参数。
  - **修后**：`TextPreview` 与假 `AudioStrip` 已彻底删除；`<NodeStageSurface host="canvas" | "list-detail">` 同源驱动画布与列表大详情（可编辑富文本+选区改写、真 `<audio>`+转写复制/SRT、`NodeRecoverableReport` 双出口、内联工具栏+上时间轴+`meta.frozen` 定妆/定稿、600px 同中轴对齐）；`switchNodeMainVersion` 收束为唯一切主图入口（写门 `2 → 1`）；列表 `↖` 点选自动往返；分镜切模式经 `resolveModelParams` 保留兼容参数；`NODE_SURFACE_CONTRACTS` 编译期穷尽锁住全部 `17` 种节点。
- **动手前正反例验收清单（实现线自验 & 独立验收线核对）**：

| 编号 | 检查项 / 反例（含旁路回归入口） | 期望结果 | 验证方式 |
|---|---|---|---|
| C1 | 列表大详情打开 `text` 节点 | 渲染真实可编辑 `TextDocumentNode`（含 ProseMirror 编辑区与格式条宿主），选区变化同步写 `meta.textGenSelection`，绝不出现 `line-clamp-4` 只读 `<p>` | `threeSurfacesParity.goal.test.tsx` + 实窗截图 `02-list-detail-editable-text` |
| C2 | 列表大详情打开 `audio`（配音态 & 转写态） | 配音态渲染真实 `<audio>` + 播放/暂停 + 进度滑块；转写态渲染转写全文 + 复制 + 生成字幕（SRT）；仓库中 `GenerationListParts.tsx` 不再存在 48 根假竖条 `AudioStrip` | `threeSurfacesParity.goal.test.tsx` + 实窗截图 `03-list-detail-audio-transcript` |
| C3 | 列表大详情打开 `recoverable` 与 `error` 节点（反例：脱离 `<ReactFlowProvider>`） | 不抛 React Flow context 错；`recoverable` 同时提供「重新取回」（主）与「重新生成」（次，走 `resend: true`）且文案不含违禁计费承诺词 | `threeSurfacesParity.goal.test.tsx` + `generationFailureSurfaces.test.tsx` |
| C4 | 列表大详情打开已生成图片/视频节点（反例：脱离 `<ReactFlowProvider>` 渲染 `FloatingToolbarShell` / `NodeVideoClipPanel` / `NodeVideoControls`） | 正常渲染内联动作条（含 `add-to-timeline`、复制变体、裁切/宫格/抠图或视频抽帧/修剪、`meta.frozen` 定妆/定稿），且预览框、工具条、版本行、样片行、生成框共用 `600px` 中轴线 | `threeSurfacesParity.goal.test.tsx` + 实窗截图 `04-list-detail-media-toolbar-coaxial` |
| C5 | 列表空态与有卡片网格态新建/导入 | 两种状态下均可直接新建节点或触发导入文件，无需先切回画布 | `threeSurfacesParity.goal.test.tsx` + 实窗截图 `01-list-grid-with-create` |
| C6 | 反例旁路：从列表大详情切换主版本 vs 画布版本宫格切换主版本 | 两处均经唯一 `switchNodeMainVersion` 先 `finishWhiteboard` 再按侧车回填真实宽高最后写 `setNodeMainResult`；`door-map setNodeMainResult` 生产写门严格为 `1` | `threeSurfacesParity.goal.test.tsx` + `node scripts/door-map.mjs setNodeMainResult` |
| C7 | 反例旁路：在列表大详情点 `↖` 进入 `enterCanvasPickMode`，触发列表组件卸载，随后点选节点或按 `Esc` 取消 | 列表卸载不取消点选；画布完成点选或按 `Esc` 取消后，`useGenerationViewStore` 自动恢复 `{ view: 'list', inspectorKey }` | `threeSurfacesParity.goal.test.tsx` |
| C8 | 反例旁路：分镜 `ShotComposerBar` / `StoryboardAnchorRow` 切换模式时已有兼容参数 + 旧模式专属非法参数 | 经 `resolveModelParams` 保留兼容参数（如 `quality` / `aspect_ratio` / `resolution`）、丢弃未知参数、修正非法枚举，不再粗暴写 `params: undefined` 清空一切 | `threeSurfacesParity.goal.test.tsx` + `ShotComposerBar.imageMode.test.ts` |
| C9 | 反例旁路：新增或遗漏 `GenerationNodeKind` 视图分支 | `NODE_SURFACE_CONTRACTS satisfies Record<GenerationNodeKind, NodeSurfaceContract>` 编译期全覆盖 `GENERATION_NODE_KINDS`；`canvas-only` 种类在列表详情显式给出「去画布」指路而非空白或残缺框 | `threeSurfacesParity.goal.test.tsx` + `pnpm run typecheck` |

- **回滚方案**：本分支提交独立成章、未改持久化格式，如需回滚可直接 `git revert <merge-sha>`，存量项目数据 100% 兼容无损。

### 功能分类
- [x] 新界面 / 改交互
- [x] 花钱
- [x] 大数据量 / 画布 / 长列表
- [x] 新增功能 / 性能
