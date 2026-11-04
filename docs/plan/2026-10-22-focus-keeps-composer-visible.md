# 对焦节点时把生成框一起框进可见区（设计卡）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

线 / 负责人：nomi-worker（F-produce-focus） 类别：[其他]（纯 bug 修复，交互修复，不属四类）

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我点「出成片」回画布 / 点侧栏定位某个节点，我想直接点到它下面的生成钮，以便不用先平移画布。不做：不改选中规则、不改谁能发对焦事件、不新增视口移动者。已知坑：生成框高度是内容驱动的，对焦按「最坏高度」预留（图片 / 视频 400 / 460 屏幕像素，文本 160）。真实任务：3D 镜头节点在 1280×933、Agent 停靠 / 浮窗两种形态下对焦（10-22 协调跑付费样本时两次点不到生成）。指标：对焦后缩放 ≤100%、↑ 中心在舞台内、elementFromPoint(↑) 是按钮自己；量具 = `tests/ux/canvas-focus-composer-visible.walk.mjs` + `focusViewportRecovery.test.ts`。 | 走查输出 `FOCUS_COMPOSER` 三行；截图 `tests/ux/shots/canvas-focus-composer-visible/` |
| ★2 谁说了算 | 概念「画布对焦视口」唯一 owner = `reactFlow/focusViewportRecovery.ts` 的 `resolveCanvasFocusViewport`（取代 `resolveCanvasFocusZoom`）；生成框占地唯一 owner = `nodes/composerCanvasPlacement.ts`（`composerFocusFootprint`；卡片自己的 maxHeight 仍在 NodeGenerationComposer.tsx，那个文件是 14 天热点这次不动，两边数由 composerCanvasPlacement.test.ts 对账，热点解除后并成一份）；浮层矩形唯一 owner = `generation/workspaceBottomDocks.ts`（`collectCanvasOverlayRects`）。发对焦事件的入口 10 处（9 处在 `canvasViewportMovers.structure.test.ts` 名单 + `deepLinkFocus.ts` 经 `useProjectNotificationTarget`），监听器 1 处。 | `node scripts/door-map.mjs FOCUS_GENERATION_NODE_EVENT` |
| ★3 一致与复用 | 可见区复用 `workspaceBottomDocks` 的停靠区测量 + `[data-agent-float]`；生成框几何复用 `composerCanvasPlacement`；不自写新的视口动画（仍走 `animateViewportTo`）。无第二份定义：旧 `resolveCanvasFocusZoom` 同提交删除。 | `git grep resolveCanvasFocusZoom` 应为空 |
| ★4 全状态 | 节点没有生成框的 kind（whiteboard 等）：只居中、缩放封顶 100%；选中=false 的入口（分镜表）也按有生成框预留（节点略偏上，可接受）；节点过大缩到下限 20% 仍装不下时，生成框那一端贴可见区底边（↑ 可见优先）；浮层把可见区切到很小时取剩余最大矩形；对焦同一节点第二次（门铃）也会生效。 | 单元测试 6 条 + 走查 |
| ★9 验收与回滚 | 验收：协调代审（不属四类）；走查 + 单元测试。回滚：revert 本提交。 | `node tests/ux/canvas-focus-composer-visible.walk.mjs`；`npx vitest run src/workbench/generationCanvas/reactFlow/focusViewportRecovery.test.ts` |

拍板图：例外 pure-bugfix。理由：只改视口落点算式，不改任何界面元素、文案、层级。
