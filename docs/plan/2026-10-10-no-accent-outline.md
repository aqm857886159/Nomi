# 去掉强调色描边：普查 + 样张（2026-10-10，样张线 D-outline）

> 状态：样张已做、**未拍板、生产零改动**。拍板后再按第 5 节落地。
> 用户原话（10-10）：「蓝色描边不需要 我们现在很多地方出现这种东西 都删掉吧」「你也可以想想 是不是不需要」「我觉得是有点突兀 不好看 有点出戏」。

## 0. 三问（开工先答）

1. **这处近 14 天修过几次？** `node scripts/fix-churn.mjs` 对 `src/devlab/designLab` 命中了几个目录级热点（lab 里历史 fix 很多），但本刀只**新增**一屏 + 登记 + 给一个 lab 夹具加了一个可选参数，**未触碰生产文件**，不算第 3 个 fix。登记文件 `labStates.mjs` / `calibration.json` 未命中热点。
2. **独有领域吗？** 不是。描边颜色是通用 UI 样式，落地走的是现有 Tailwind token 与 className，不需要自写新组件，也不引入新库。
3. **补 / 换 / 删？** 本刀选「**补**」：只在设计实验室加样张屏（新文件 + 登记），不换生产。理由：生产改动要等用户拍板样张，拍板前换掉就是替用户做了决定。落地阶段会是「换」（同一提交删旧 className）。

## 1. 设计卡（★ 1、2、3、4、9）

- **★1 用户怎么用**：创作者在画布上点选、框选、在素材库选素材、在左栏切换、Tab 键盘操作、看 Agent 面板提示卡时，画面外圈的蓝线跟画面抢注意力。做完后：单选不框（工具条 + 生成框 + 拉环已经说明选中）；多选、选素材、当前项各有不靠蓝框的提示；键盘焦点仍看得见。**不做**：不改生产行为（本刀），不删任何功能。**真实任务**：① 在画布点选一张图片节点；② 框选三个节点；③ 在素材库选两个素材。已知坑：很多蓝色是 hover / focus 形态，静态截图看不到，要靠交互取证。
- **★1b 连带界面**：Agent 回执、提醒卡、反馈卡（`V4ConsentCard`、`FeedbackReportCard`）的蓝边，文字不变，边线改灰。
- **★2 谁说了算**：视觉 token 归 `src/design/` 与 `tailwind.config.ts`；组件 owner 不变；本刀无状态。
- **★3 一致与复用**：普查显示 241 处里约 235 处是**散写在各组件的 className 字符串**，共享件只有 `src/design/`（`actions.tsx`、`NomiSelect.tsx`、`identity.tsx`）与 `src/ui/switch.tsx`，合计约 6 处。所以改共享件覆盖面很小，主体工作是逐处替换。
- **★4 全状态**：样张覆盖 8 格 × 亮/暗 = 16 个状态格，每格「现在 / 改后」成对。空 / 加载 / 失败 / 取消不适用（纯视觉）。
- **★9 验收与回滚**：验收由另一条线按样张逐格对账（真截图亲眼 Read）；回滚：revert 样张提交（本刀零生产改动）。

## 2. 普查：生产代码里的强调色描边

统计口径：`src/**/*.{ts,tsx,css}`，排除测试与 `devlab`。命中 `(border|outline|ring|shadow|divide)-…nomi-accent`、`…workbench-accent`、`var(--nomi-accent|workbench-accent)` 用在 border / outline / box-shadow / ring 上的行；另加 `ring-nomi-info-edge` 两处（info 族色相 250，同属蓝）。

**合计 241 处**（类名 216 行 + CSS / 行内变量 23 行 + info 族 2 行）。协调会话初数 241 / 137 文件，口径一致；文件数按本次统计约 135。

| 类别 | 处数 | 代表文件（3 个） | 改后规则（协调会话 1–5） |
|---|---:|---|---|
| single-select 单选 | 15 | `workbench/generationCanvas/components/GroupFrame.tsx`、`nodes/director/DirectorNode.tsx`、`components/LightweightGenerationNode.tsx` | **不加框**，去掉。工具条 / 生成框 / 拉环 / 分组工具条已说明选中 |
| multi-select 多选 | 3 | `nodes/director/timeline/TrackLanes.tsx`（范围拖选）、`components/ScreenshotCropOverlay.tsx`（裁切框）、`ui/browser/popover/BrowserAssetPopoverView.tsx`（框选矩形） | **深色细线**（亮 ink / 暗 paper，只在多选时出现） |
| picked-tile 选中素材 | 8 | `workbench/assets/AssetLibraryPanelParts.tsx`、`workbench/assets/AssetTile.tsx`、`ui/browser/popover/BrowserAssetPopoverParts.tsx` | **右上角勾角标**，图不框 |
| current-item 当前项 | 34 | `design/NomiSelect.tsx`、`workbench/sidebar/CategoryItem.tsx`、`ui/onboarding/workflowPage/WorkflowSidebar.tsx`、`workbench/settings/SettingsDialog.tsx` | **很淡的底色**，不描边 |
| keyboard-focus 键盘焦点 | 30 | `ui/app-shell/shell/ShellRail.tsx`、`workbench/generationCanvas/components/CanvasToolbar.tsx`、`workbench/library/ProjectLibraryPage.tsx` | **保留，改深色**（ink），鼠标操作看不到 |
| decor / hover / 输入框聚焦 | 123 | `workbench/ai/v4/AgentPanelV4Consent.tsx`、`promptLibrary/UserPromptCard.tsx`、`ui/onboarding/ComfyuiWorkflowImportPanel.tsx`、`library/ProjectLibraryPage.tsx:280,293`（info 族） | **普通灰线**；输入框聚焦线条加深一档 |
| keep-accent 保留 | 12 | `ui/app-shell/shell/AgentBallFace.tsx`（运行环、转圈）、`nodes/BaseGenerationNode.tsx:401`（剪贴板导入进度）、`reactFlow/generationCanvasReactFlow.css:216,217,222`（连接握把与连线）、`timeline/TimelinePanel.tsx:561`（播放头把手）、`design/actions.tsx:198`（主按钮底色）、`library/WorkflowLibraryContent.tsx:150`（主按钮） | **保留**：主动作底色、链接、进度 / 连接握把这类「正在发生」的反馈 |
| 拿不准 | 16 | 见下表 | 逐个定，见下 |

**拿不准的 16 处**（样张里没有替它们定，等用户看）：

- `workbench/creation/storyboard/StoryboardShotTable.tsx:455`：分镜插入位，hover 才出现的圆点。
- `workbench/generationCanvas/components/CanvasMinimap.tsx:155`：小地图视口框（导航用，不是选中）。
- `workbench/generationCanvas/nodes/ClipNodeTimeline.tsx:373`：片段按类型的色边（颜色编码，不是选中）。
- `workbench/generationCanvas/nodes/director/panels/fields/FieldPrimitives.tsx:151`：色板当前值的外圈。
- `workbench/generationCanvas/nodes/shotTable/ShotTableGrid.tsx:44`：单元格绑定标签的边。
- `workbench/generationCanvas/reactFlow/GenerationCanvasReactFlowNodes.tsx:234`：「可拾取」目标高亮（选参考图时）。
- `workbench/onboarding/OnboardingSpotlight.tsx:141`：引导聚光框（框住一个控件，是有意的引导）。
- `workbench/timeline/agent/TimelinePlanPreviewLayer.tsx:31,32`：AI 计划预览的新增 / 修改色带。
- `workbench/timeline/TimelinePanel.tsx:550`：播放头阴影，**硬编码 `rgba(0,122,255,…)`，不是 token**，要顺手收掉。
- `workbench/timeline/TimelineTrack.tsx:263,270,342`：片段 / 轨道选中的内阴影与边。
- `workbench/timeline/TimelineClip.tsx:284`：片段**常驻**的 22% 色边（非选中态，但每个片段都有）。
- `workbench/timeline/TimelineTransitionMarker.tsx:88`：转场标记边。
- `workbench/generationCanvas/nodes/controls/ParameterControlBody.tsx:271`：滑块拇指色边。

**两处不在普查里、但已经合规的**：画布自己的多选框 `.react-flow__selection` 与 `.react-flow__nodesselection-rect` 已经是 ink 中性色（`generationCanvasReactFlow.css:38–50`），即「多选深色细线」在画布上已经存在。

## 3. 样张

- 屏：`no-accent-outline`（「去掉强调色描边（样张）」）。注册：`src/devlab/designLab/noAccentOutline/`（`noAccentOutlineLabKit.tsx`、`states/01-cells.tsx`）、`labScreens.ts`、`tests/ux/design-lab/labStates.mjs`、`calibration.json` 的 `pendingApprovalScreens`（最小插入，未重排）。
- 「改后」：同一个生产组件外套 `.nao-after`，注入的覆盖样式只作用于该子树（`NAO_AFTER_CSS`）。生产组件一行不动。覆盖样式是**样张近似**，不是落地实现。
- 夹具改动：`canvasGrouping/canvasGroupingLabKit.tsx` 的 `CanvasGroupingStage` 新增可选参数 `initialGrouped`（默认 `false`，老调用不变），用于「选中分组」格从已编组态开场。
- 取景：8 格各「现在 / 改后」× 亮 / 暗，共 32 个状态；截图在 `docs/evidence/2026-10-10-no-accent-outline/`。

（观感与问题见第 4 节。）

## 4. 样张观感（截图亲眼看过之后填）

逐格看过截图（亮、暗总览 `zh-light.png` / `zh-dark.png` + 32 张单格图在 `raw/`）：

- **01 单选图片节点**：现在就没有强调色描边（工具条 / 生成框 / 拉环清楚）。改后不变。仅「没有可用图像模型 去配置」胶囊带蓝边蓝字，属于提醒 / 链接，未动（见第 5 节第 5 条）。
- **02 框选三个节点**：现在也没有蓝框，只有「编组」按钮蓝字（主动作，保留）。改后不变。画布的多选框本身已是 ink 中性色。
- **03 选中分组**：现在整框蓝实线（`GroupFrame` 选中时换 `border-nomi-accent`）。改后还原成空闲态的中性线，选中只靠工具条。**这是唯一一格蓝框被真正去掉的分组选中**。
- **04 素材库选中两个素材**：现在选中素材有蓝环 + 蓝勾。改后蓝环去掉，勾角标保留（颜色未定，见第 5 节）。
- **05 左栏当前项**：现在没有描边，只有灰底 + 蓝字蓝图标。改后不变。蓝字要不要改是待定点。
- **06 Agent 输入框聚焦**：现在蓝边 + 蓝外发光。改后外发光去掉，边线加深成灰（ink-40）。
- **07 键盘焦点落在按钮**：现在是淡蓝焦点环（来自全局 token `--nomi-focus`，普查正则抓不到，已补）。改后焦点环变深色。**暗色下改后焦点环仍偏弱**，需要在落地时调暗色 token。
- **08 Agent 面板提示卡**：现在蓝边。改后灰边，其余不变。

**观感问题**：暗色总览里「改后」的键盘焦点环对比偏低；总览页右侧、底部有一条亮底缝（截图取景尺寸与卡片不完全贴合，不影响判断）。

## 5. 落地方案建议（不实现）

1. **先改共享件与 token，覆盖面有限**：`src/design/actions.tsx`、`NomiSelect.tsx`、`identity.tsx`、`src/ui/switch.tsx` 与 `src/utils/cn.ts`（twMerge 的 outline 组注册）。约 6 处。
2. **再逐类替换散写的 className**（约 235 处）。能机械做的：D 类（`hover:border-nomi-accent`、`focus:border-nomi-accent` → `…-nomi-ink-20` / `-ink-40`）、F 类（`focus-visible:outline-nomi-accent` → `…-nomi-ink`）。需要人看的：S / M / P / C 共约 70 处（要改的是「形态」不是颜色）。拿不准的 16 处逐个拍。
3. **门岗**：`check:tokens` 里加一条棘轮：禁止新增 `(border|ring|outline|divide)-(nomi-)?(accent|info)` 与 `var(--nomi-accent)` 用在描边上；存量记在一个 JSON 里，只减不增。这条与 P1 「全局 CSS 只减不增」同一个思路。
4. **基线重录**：`tests/ux/design-lab/__baselines__/` 共 332 张图、22 屏（`agent-panel-v4` 115 张最多）。哪几屏会动要在改完后跑视觉比对才知道；保守估计 `agent-panel-v4`、`storyboard`、`storyboard-batch`、`node-composer-bar`、`canvas-frame` 会动。基线在 darwin 录（Windows 录出来的图和 CI 对不上），要在 mac 上跑 `pnpm run design-lab:update -- --screen <屏>` 并删登记。
5. **未决的产品问题**：提示胶囊「没有可用图像模型 去配置」是 accent-soft 底 + 蓝字 + 蓝边，它是「链接」还是「提醒」？当前样张把蓝边改灰，蓝字与浅蓝底保留。要用户定。

## 6. 没做到的

- **en 总览**未出：实验室没有全局语言开关（`canvasHandles` 的英文是 `locale` 参数，别的格是 zh）。
- **16 处拿不准**没有替用户定，样张里按「保留」或「不动」处理，见第 2 节。
- **「改后」是覆盖样式近似**，不是落地实现。尤其 C 类「淡底色」在样张里只是边改灰，没有做到「去掉描边 + 淡底」；S 类「不加框」在样张里只有在源码上确认没有强调色框的格才成立。
- **基线未录**（darwin 才能录）。
- 没有跑整段 gates（按任务书只跑相关检查）。
