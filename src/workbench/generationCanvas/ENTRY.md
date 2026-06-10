# 生成画布 — 代码入口图

> 112 文件的画布子系统「我要改 X 去哪」地图。搜符号前先看这张表定位子目录，少 fan-out。

> 历史注记：本目录曾名 `generationCanvasV2`——那是旧 `apps/web` monorepo 布局「publish clean workspace」(commit `27ab140`) 带来的残留后缀，树里从无 V1。2026-06-11 已重命名为 `generationCanvas`（无后缀）。

## 子目录职责

| 子目录 | 文件 | 管什么 | 关键入口 |
|---|---|---|---|
| **components/** | 10 | 画布外壳与渲染层（React Flow 容器、边层、工具栏、助手面板） | `GenerationCanvas.tsx`（主壳 992 行）· `CanvasEdgeLayer.tsx` · `CanvasAssistantPanel.tsx` · `AgentPlanCard.tsx`（计划清单卡）|
| **nodes/** | 42 | 节点渲染与节点内交互（最大子目录）| `BaseGenerationNode.tsx`（节点基座 952 行）· `NodeParameterControls.tsx` · `NodeGenerationComposer.tsx` · `Scene3DEditor.tsx` · `aspectRatio.ts`（比例） |
| **runner/** | 15 | 执行层：能不能跑、怎么发、错误分类、结果解析 | `generationNodeExecutor.ts` · `generationRunController.ts` · `catalogTask*.ts` · `classifyGenerationError.ts` · `usableVendorModel.ts` |
| **model/** | 13 | 领域模型：图结构、类型、schema、节点元数据 | `generationCanvasTypes.ts` · `generationCanvasSchema.ts` · `graphOps.ts` · `nodeMetaFields.ts` · `generationNodeKinds.ts` |
| **agent/** | 12 | 画布 agent：工具定义、应用工具调用、建节点、推时间轴 | `generationCanvasTools.ts` · `applyCanvasToolCall.ts` · `generationCanvasAgentClient.ts` · `availableModels.ts` · `plannedNodeMeta.ts` |
| **store/** | 8 | Zustand 状态 + 历史/快照/守卫 | `generationCanvasStore.ts`（871 行）· `canvasHistory.ts` · `canvasSnapshotNormalizer.ts` · `canvasGuards.ts` |
| **adapters/** | 5 | 外部数据接入（素材导入、模型选项、节点图片持久化）| `assetImportAdapter.ts` · `modelOptionsAdapter.ts` · `persistNodeImage.ts` |
| **fixation/** | 4 | 定妆（角色/场景卡）节点构造 + 提示词模板 | `buildFixationNode.ts` · `fixationPromptTemplates.ts` |
| **hooks/** | 1 | 节点关系 hook | `useNodeRelationships.ts` |
| **services/** | 1 | 供应商设置 | `providerSettings.ts` |
| **styles/** | 1 | 画布 CSS | `generationCanvas.css` |

## 按「我要改 X」定位

| 我要改… | 去 |
|---|---|
| 画布整体布局 / 缩放 / 自动 fit | `components/GenerationCanvas.tsx` · `components/useAutoFitOnLoad.ts` · `components/generationCanvasGeometry.ts` |
| 节点卡片长相 / 节点内参数控件 | `nodes/BaseGenerationNode.tsx` · `nodes/NodeParameterControls.tsx` · `nodes/InlineParameterBar.tsx` |
| 比例 / 变形 | `nodes/aspectRatio.ts` |
| 连线 / 拖入参考 | `nodes/completeNodeConnection.ts` · `components/CanvasEdgeLayer.tsx` · `model/nodeAssetDrop.ts` |
| 生成怎么发出去 / 错误处理 | `runner/generationNodeExecutor.ts` · `runner/generationRunController.ts` · `runner/classifyGenerationError.ts` |
| agent 建节点 / 计划清单卡 | `agent/applyCanvasToolCall.ts` · `agent/plannedNodeMeta.ts` · `components/AgentPlanCard.tsx` |
| 状态/撤销重做/存盘快照 | `store/generationCanvasStore.ts` · `store/canvasHistory.ts` · `store/canvasSnapshotNormalizer.ts` |
| 节点数据结构 / schema | `model/generationCanvasTypes.ts` · `model/generationCanvasSchema.ts` |
| 定妆卡 | `fixation/buildFixationNode.ts` |
| 推到时间轴 | `agent/sendGenerationNodeToTimeline.ts` · `agent/sendStoryboardToTimeline.ts` |

## 相关方案文档

画布/节点的设计与执行计划见 [`docs/plan/INDEX.md`](../../../docs/plan/INDEX.md) §「生成画布 / 节点系统」。
