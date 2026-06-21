# Scene3DFullscreen 巨壳拆分（#10b · 独立分支）

> 来源：2026-06-21 CTO 审计 #10b。Scene3DFullscreen.tsx **3822 行 / 35+ 组件**，是仅存的两个巨壳之一、
> 白名单「锁住不降」——与 R12「逐步清空白名单」直接冲突。本分支把它拆到主壳 < 800、移出白名单。
> 分支 `refactor/scene3d-split`，基于 cto-audit HEAD（含 #6 的 recorder 改动，避免 Scene3D 冲突）。

## 原则

- **纯机械抽取**：移动组件/函数到新文件，逻辑逐字不变（P1 不造并行版、不留旧实现）。
- **每个新文件 ≤ 800**：render 类太大需再分。
- **增量可验证**：每个增量 typecheck + test 绿才提交；末尾真机走查 3D 编辑器（R13，单测兜不住 3D 渲染）。
- 主壳 `Scene3DFullscreen`（约 700 行）留在原文件，import 各子模块。

## 分层（按依赖自底向上）

| 新文件 | 内容 | 约行 |
|---|---|---|
| `scene3dObjectGeometry.ts` | 纯几何/标签/布点 helper（mannequinFootRingRadius/crowd*/object*/nextAvailableObjectPosition/mannequinPoseControlValue/cameraPreviewViewportStyle/cameraAimSpherical 等）| ~200 |
| `scene3dMannequin.tsx` | 人偶/人群/脚环/标签渲染（Procedural/Mannequin/Crowd/InstancedMeshBatch/FootRings/MannequinRoleLabel/LightObject/Scene3DMeshGeometry）| ~600 |
| `scene3dSceneView.tsx` | 场景视图（SceneObjectView/CameraHelperView/CameraFrustumLines/CameraTargetFeedback/SceneContent）| ~750 |
| `scene3dCameraPreview.tsx` | 取景预览（CameraPreview/Scene/PreviewObjectView/CameraPreviewPose）| ~300 |
| `scene3dViewControllers.tsx` | 控制器（Scene3DControls/InitialCameraPose/FocusController/CaptureBinder/CameraViewEditController）| ~600 |
| `scene3dToolbar.tsx` | 工具栏（PanelButton/SceneAddButton/CanvasPanelRestoreButton/SceneAddToolbar）| ~360 |
| `scene3dInspector.tsx` | 检查器（VectorInputs/ColorField/SceneObjectList/MannequinPosePanel/PropertyPanel）| ~640 |
| `Scene3DFullscreen.tsx`（壳）| 主组件 + import 上述 | ~700 |

## 增量顺序（每步验证）

1. 纯 helper → scene3dObjectGeometry.ts
2. toolbar → scene3dToolbar.tsx
3. inspector → scene3dInspector.tsx
4. mannequin 渲染 → scene3dMannequin.tsx
5. sceneView → scene3dSceneView.tsx
6. cameraPreview + viewControllers → 各文件
7. 壳收尾：确认 < 800，移出 check-file-sizes 白名单

## 不动项

- 逻辑/行为零改动（纯移动）。任何「顺手优化」都不做（避免把重构和改动混在一起，回归难定位）。
- scene3dConstants / scene3dTypes / scene3dSerializer / scene3dMath / CameraStateRecorder 已是独立文件，不动。

## 验收

- 每增量：`tsc` 双项目 + scene3d 单测绿。
- 末尾：五门全过 + **真机走查 3D 编辑器**（开 3D 节点 → 加物体/人偶/人群 → 取景编辑相机 → 预览 → 截图人眼判断渲染正确）。
- 白名单移除 Scene3DFullscreen 条目（巨壳债清一个）。

## 交付状态（已完成）

**3822 行最大巨壳 → 771 行壳 + 7 子模块，全部 < 800，已移出白名单**（巨壳白名单 3→2）：
Scene3DFullscreen(壳 771) + inspector(685)/sceneView(630)/objects(601)/viewControllers(465)/toolbar(362)/cameraPreview(235)/sceneContent(193)。
共享纯符号下沉：mannequinRoleLabel/cameraAimSpherical→scene3dMath、CaptureApi→scene3dTypes。逻辑逐字未改（纯机械抽取）。五门全过。

**真机走查（R13）已做 + 抓到并修复一个真 bug**：
- Playwright `_electron` 启动构建产物 → 加 3D 场景节点 → 打开全屏编辑器，人眼判断：红色人偶（GLTF）站网格地面、场景节点列表 + 属性面板 + 添加工具栏 + 人偶标签全部正确渲染，与拆分前**像素级一致**；0 CSP 违规 / 0 页面错误 / 0 控制台错误。
- **走查抓到 #7 CSP 真 bug**：prod `script-src 'self'` 拦了 3D 编辑器的 `WebAssembly.instantiate`（Three.js GLTF/meshopt 解码）+ blob worker，人偶模型加载失败（CompileError）。已在 cto-audit 分支修订 CSP（加 `'wasm-unsafe-eval'`+`blob:`），本分支 rebase 取得。之前非 3D 走查没开编辑器故漏掉——正是 R13 兜住单测兜不住的一类。
