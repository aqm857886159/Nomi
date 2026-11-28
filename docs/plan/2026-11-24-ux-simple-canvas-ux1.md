# UX-simple · 从创作选句到首帧视频

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

依据协调裁定 7126279479、7126560423。分类为 recurring。选句、拉环和手动选择都可能使创作者失去下一步操作。

| 设计格 | 决策与验收 |
| --- | --- |
| ★0 依据 | React Flow 的 getNodesBounds 包含虚拟化节点，作为整体取景输入。focusViewportRecovery 已从真实遮挡计算空地并区分屏幕像素与画布单位。nodeInputActions 的 createConnectedNode 已将拉环建卡和接线归为一次可撤销写入。以上三处分别决定取景边界、坐标系和免费入口。 |
| ★1 创作者任务 | 空库建项目、写句选句、点生成图片、确认出图、点生成视频、确认出视频、贴尾并导出。另在窄窗选择靠边的旧卡，检查生成框和发送钮。按阶段报告的路径 A 对账，驱动点击目标 ≤10、判断目标 ≤5，键入与选区单列。 |
| ★1b / ★1c | 卡面等待随真实上游结果刷新。原有标题可改名，保留分镜号。旧项目沿用存档比例和视口，连接手势尊重手选标记，无文件迁移。 |
| ★2 主人 | 舞台负责取景与动画，ComposerAnchor 负责贴卡布局，画布图提供上游结果，比例默认由 videoAspectSeed 产生。见下方实扫门表。 |
| ★3 取舍 | 采用 09-25 固定锚点与 11-24 单选平移裁定。移动输入框会破坏空间关系，删除自动适应会把找回节点的操作留给创作者。首进容纳节点与生成框，选择仅修正越界。 |
| ★4 状态 | 空画布无取景。源存在且无结果才显示等待，源有结果可继续。生成中、取消中和失败沿用任务回执；无模型由既有发送入口引导连接。多个上游独立判定。 |
| ★5 中途 | 关闭或断网仍可保留免费派生。再点产生另一张卡，每次可一步撤销。切选、拖动打断平移，重开由分类视口处理。真实提交继续归已有任务生命周期。 |
| ★6 外部数据 | 图中缺失来源不能断言正在等待。画幅只取当前模型提供的选项，无法等价匹配时走原有默认。 |
| ★7 性能 | 单选只在选中身份变化时测量。拖动中跳过。用 canvas-drag-20-nodes（150 张图、75 条边）测五次，预算 33 ms。 |
| ★8 真实条件 | macOS 隔离 Electron，fake-apimart。中文、英文与两种主题，另验 1100×690。供应商画质、Windows 与真实账户扣费未验证。 |
| ★9 验收与回滚 | 修前修后对照选句后的发送钮；左、右、下越界分别移回，完整可见、多选、拖动均不动。工具条首项免费接 first_frame，验证撤销、上游已出图/缺图、方图/竖图/自动/手选、默认与自定义标题。预览贴尾并读回输出 MP4。回滚该提交即可。 |

### 功能分类

- [x] 新界面 / 改交互
- [x] 大数据量 / 画布 / 长列表
- [x] 新增功能 / 性能

### Door map

基线运行 `node scripts/door-map.mjs useAutoFitOnLoad createConnectedNode videoAspectSeedPatch ShotPreviewOverlays ImageQuickActionsToolbar useHasFrameSourceEdge`，3197 个源文件，7 写 4 读。

- read `src/devlab/designLab/nodeQuickActions/nodeQuickActionsLabKit.tsx` · `ImageQuickActionsToolbar`
- read `src/devlab/nodeTimelineInteraction.tsx` · `ImageQuickActionsToolbar`
- read `src/workbench/generation/list/CanvasListLinks.tsx` · `ShotPreviewOverlays`
- read `src/workbench/generationCanvas/quickActions/ImageQuickActionsToolbarHost.tsx` · `ImageQuickActionsToolbar`
- write `src/workbench/generationCanvas/components/useCanvasMenuActions.ts` · `createConnectedNode`
- write `src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx` · `useHasFrameSourceEdge`
- write `src/workbench/generationCanvas/nodes/buildNodeModelChangePatch.ts` · `videoAspectSeedPatch`
- write `src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts` · `videoAspectSeedPatch`
- write `src/workbench/generationCanvas/nodes/videoAspectSeed.ts` · `videoAspectSeedPatch`
- write `src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx` · `useAutoFitOnLoad`
- write `src/workbench/generationCanvas/store/canvasConnectDerivations.ts` · `videoAspectSeedPatch`

### 派生尺寸与状态收尾

首次模型选择可能晚于建卡和连边。真窗第一次试跑时，首帧使新视频从横卡增长为方卡，原取景落在旧尺寸上。新卡等待模型首轮定形再取景。只有新派生且越界时，允许按可用高度向下适配缩放；再次单选已有节点只平移。编辑框始终保持原锚点与屏幕宽度。

### 系统改进

最早能拦住这类问题的是画布验收。已有 `new-node-composer-in-view.walk.mjs` 覆盖舞台内新建，漏掉了跨工作区选句和已经连入首帧的卡。取景现在同时读取图、固定屏幕占地和可用舞台。定向几何测试分别覆盖两节点联合边界、三侧越界与新卡定形；多选和拖动作为反例。2026-12-08 复查同一路径，若需要手动缩放或发送钮再次出界，即重开。

### 11-24 交叉评审复验

窄窗与停靠后的标签顶缘至少比舞台顶缘低 6 px，发送钮和生成框底缘均在底部停靠条之上。派生时容纳自然位置的工具条，普通单选保持缩放并优先露出生成框。手动手势早于第二帧或模型就绪时取消排队取景。用有历史结果、满槽溢出和无结果占槽三张图对账；首帧生成、换主版本及解码尺寸到达都只更新机器比例。跨语言保留可编辑标题，生成中与本地编辑忙态不能启动图片快捷派生。

## PR #1668 CI 复修设计卡

- ★1 用户从工具条或粘贴建卡时保留当前视口。右环与图片工具条的已连线派生卡要露出生成框，点击已有卡越界时只平移一次。真窗走查读建卡前后的视口矩阵，单测读动画调用和缩放值。切换模型时，比例测试读最终参数。有记忆的项目继续从持久化视角判断首进取景。
- ★2 React Flow 管缩放范围，首进沿用 `useAutoFitOnLoad`，视口移动准入由画布选中边界判定，首帧比例由 `videoAspectSeedPatch` 写入。模型等待仍在视口 hook 的既有时限内处理。门表由 `scripts/door-map.mjs` 生成，概念由 `check-concept-owners` 核对。
- ★3 按 2026-09-25 拍板保留独立建卡的视口，用已有的选中通知和动画入口识别派生。逐按钮补条件会漏粘贴，删除单选取景会让已有卡的操作面出界。沿用 R-d2-defaults #1 和模型已支持的比例选项。
- ★4 空画布建卡仍选中，卡片不在可见区时可从边缘提示过去。多选、拖动和手动导航仍取消排队取景，模型等待超时仍可定位已连线的卡。未知或无匹配的首帧尺寸交给模型支持的自动选项。
- ★9 验收以 `canvas-drag-pan-gestures` 的中文与英文真窗、定向 Vitest 和指定门岗为准。反例覆盖第二张图片、独立视频、仅有出边的新卡、连线晚于新卡选中的情况、新派生卡、点击已有卡三侧越界、未知与不匹配的首帧、手选比例、首进封顶与显式完整缩放范围。全拦掉会使派生与已有单选的正向用例失败。回滚复修提交即可。
