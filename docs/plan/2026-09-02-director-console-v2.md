# 导演台 V2（完整的 3D 导演台）· 功能方案 + 交互规格 + 分期

> 日期：2026-09-02 · 状态：🚧 已实现于工作区，未提交；S0–S9 与切换门已执行，后续参考产品对齐见 [外壳对齐记录](2026-09-03-director-chrome-parity.md)。
> 输入：参考产品导演台的逐组件功能清单 + 函数级实现对照（本机资料，不入库）。
> 用户指令（2026-09-02）：「按这份清单新建一个 Nomi 导演台 V2，互不影响」「详细列功能方案跟交互，防止缺失」「完整复刻，再检查一下」。
> 方法：每一条规格都能追溯到清单里的一个控件/交互（§9 追溯矩阵）。初期独立建设；2026-09-03 获准切换后 V1 已删除，所需纯函数已入籍 director；现状见切换门与对齐记录，勿将下文初期方案当现状。

## 0. 决策记录（先把冲突摆桌上）

### 0.1 本次指令覆盖了哪些旧拍板（D3：不藏；用户可逐条否决）

| 旧拍板（来源） | 本方案怎么做 | 若你否决则改成 |
|---|---|---|
| 「不做第二套 3D 导演台 / 旧入口 fallback」（[07-26 研究方案](2026-07-26-3d-director-stage-research-design.md)）| 建独立节点类型 `director`（V2），V1 `scene3d` 原样保留；**§0.3 切换门**：V2 对等后同一 commit 删 V1 + 迁移旧节点数据，不长期双版本 | 改为在 V1 上分期扩展（工程量更大，且触碰已拍板的 V1 IA）|
| 「不重写现有编辑器主体，新能力=加轻入口」（[07-08](2026-07-08-director-stage-optimization.md)）| V2 是新写的壳与内核；V1 纯函数层复用 | 同上 |
| 「薄皮方向：不做 foot-IK / 物理 / 口型」（[06-30](2026-06-30-game-style-3d-character-control.md)）| **做 IK**（CCD 手脚头五链 + 极向量，参考产品有）；仍不做物理、口型 | 去掉 §5.4 IK，保留 FK 关节滑条 |
| 「不做默认完整时间轴，按旅程时机出现」（[07-20 UX](2026-07-20-scene3d-ux-overhaul.md)、[07-26](2026-07-26-3d-director-stage-research-design.md)）| 做完整多轨片段时间轴，**默认折叠为 6% 高度条**（参考产品也可折叠），有内容时自动展开——两边各取一半 | 默认展开 |
| 「不追上传 GLB 等商品化便利」（[07-08](2026-07-08-director-stage-optimization.md)）| 做本地模型导入（FBX/GLB）+ 资产库文件夹（清单 §3.2）| 去掉 §5.3.2 |
| 「AI 走语义词表，不直吐坐标」（[06-21](2026-06-21-staging-reference-tool.md)）| AI 搭场景（清单 §2.6）本质是 LLM 直吐几何坐标；作为**独立能力**做，不动 `create_staging_reference` 的词表路线 | 去掉 §5.8 |
| 「不引第三方时间轴库」「不做自定义快捷键」（[07-26](2026-07-26-scene3d-export-and-timeline-alignment.md)、[07-20 IA](2026-07-20-scene3d-ia-redesign.md)）| **遵守**：时间轴自研；快捷键固定默认值（参考产品的自定义在 app 级设置，不在导演台页面，清单外）| — |
| UE 人偶 + 20 姿势 + 5 体型 部件级移植（[08-03](2026-08-03-3d-director-desk-adoption-comparison.md)）| **遵守并吸收**：角色系统 rig 无关（骨骼名映射表），UE 人偶与 Mixamo 假人都能进 V2；体型预设走 UE 的 5 体型 + 8 个快捷体形缩放 | — |
| 「take 回放走离屏确定性逐帧渲染，不引 MediaRecorder」（[06-30](2026-06-30-game-style-3d-character-control.md)）| **遵守**：录像用 V1 的帧步进 → `framesToVideo`（ffmpeg），不用 MediaRecorder | — |
| 「时间轴 = 成片长度，自动派生」（[07-30](2026-07-30-scene3d-timeline-equals-film-length.md)）| **遵守**：内容终点单一真相 `contentEndSeconds`；录制/片段可延长，上限 60s| — |

### 0.2 取舍表（R3）

| 取舍点 | 选项 A | 选项 B | 选择与理由 |
|---|---|---|---|
| 泼溅渲染 | Spark `@sparkjsdev/spark` 2.1.0（three ≥0.180，.spz/.ply/.splat/.sog；World Labs 维护；官方 R3F 例子）| GaussianSplats3D / gsplat.js / drei `<Splat>` | **A**。GaussianSplats3D 已停更并公开推荐 Spark；gsplat.js 不是 three 生态；drei `<Splat>` 只吃 .splat。R5 已 Context7 + web 实查（2026-09-02）|
| IK | three 自带 `CCDIKSolver`（0.184 已含）| 自研 FABRIK | **A**。参考产品也是它；R20 不在护城河上用标准实现 |
| 时间轴 | 自研 DOM 时间轴（复用 Nomi `TimelineResizeHandle` 等）| Theatre.js | **A**。Theatre 是关键帧工作室、UI 塞不进设计系统；旧拍板也禁第三方时间轴库 |
| 录像出片 | 帧步进 → `framesToVideo`（V1 现成）| MediaRecorder 实时录屏（参考产品）| **A**。确定性、不掉帧、走已有 ffmpeg 通道 |
| 撤销 | 整树 JSON 快照 50 步（参考产品）| immer patches | **A**。对等且简单；快照对象 ≤ 数百 KB |
| 编辑器状态 | 每次打开创建一个 zustand store（编辑期真相），关闭/自动保存写回节点 data | 直接改节点 data | **A**。高频写（拖拽/播放）不进画布 store；节点 data 只在保存点写 |
| 主视口渲染循环 | 编辑器打开期间 `frameloop="always"` | demand + 手动 invalidate（V1）| **A**。全屏独占、动画/IK/泼溅显现都要连续帧；关闭即卸载 |
| 手机相机传输 | 本地 WS（先）+ WebRTC DataChannel（后）| 只 WS | 先 A 的 WS 部分；WebRTC 在 S8 末做 |
| AI 搭场景 | Nomi 现有模型调用 + zod 结构化输出（primitives JSON）| 走 agent 工具 | **A**。页面内直接出效果（D1 effect-first）；工具化另议 |

### 0.3 切换门（P1 的落点，需要你拍板才执行）

V2 通过 §7 全部验收 + R16 真实任务闭环后：① 同一 commit 删除 `nodes/scene3d/` 全部 UI/壳（保留被 V2 import 的纯函数层，并搬家到 V2 目录，搬家不留转发壳）；② `scene3d` 节点类型标记为只读迁移源，`normalizeScene3DState` → `migrateScene3DToDirector()` 一次性转成 V2 工程；③ AI 工具 `create_staging_reference / create_camera_move` 改产出 V2 节点。**在此之前 V1 一行不动。**

## 1. 目标 / 非目标 / 不动项 / 回滚 / 验收门（R4）

- **目标**：清单 §0–§8 的每个控件与交互在 Nomi 里都有对应实现（§9 矩阵 100% 覆盖），产物接入画布（Image / Video 节点），走 Nomi 设计系统与 i18n，六道门岗全绿。
- **非目标**：World 节点（Marble 生成世界，不在页面清单内；V2 泼溅来自本地上传 .spz/.ply 与连入节点的文件）；app 级快捷键自定义编辑器；工程加密落盘；多人协作；物理/口型。
- **不动项**：`nodes/scene3d/**` 任何文件；画布 React Flow 内核（R23）；AI 工具协议（本期不改，切换门时再改）；`electron/video/framesToVideo.ts` 契约。
- **回滚**：V2 是新增目录 + 新增节点类型 + 新增 electron 手机桥模块；回滚 = 反向删除，不影响 V1。
- **验收门**：每期 §7 验收表 + `pnpm run gates:contracts`（typecheck / lint / filesize / tokens / heavy-path / vocabularies / boundaries / i18n / controls）+ R13 截图走查 + R16 真实任务 J-D1…J-D6。

## 2. 架构

### 2.1 目录（新增，全部 ≤800 行/文件，每目录带 L2 `CLAUDE.md`，每文件带 L3 头）

```
src/workbench/generationCanvas/nodes/director/
  CLAUDE.md
  DirectorNode.tsx                 画布节点卡片（333×250 等价，"N 物体 · M 机位" + 入连摘要 + 打开按钮）
  DirectorEditor.tsx               全屏壳（portal + role=dialog + 五区域 + 可拖分栏），lazyWithChunkBoundary
  model/                           纯层（零 React/THREE，可单测）
    directorTypes.ts               V2 工程 schema（§3）
    directorStore.ts               zustand 编辑器 store 工厂 + 选择态 + 撤销栈
    directorProject.ts             默认工程、序列化、版本迁移、V1→V2 迁移（切换门前只做 V1 读取兼容测试）
    timeGrid.ts                    30fps 量化 ig()/jg、contentEndSeconds、ensureDuration
    clips.ts                       片段类型、重叠/放置求解（Wr/zr）、裁剪/分割/复制粘贴
    trajectoryEval.ts              路标插值、hold、Bh 三态求值、路标↔片段归属
    closeupRig.ts                  x8/VNA：锚点/方位/8 种运镜预设 → 相机位姿
    programCamera.ts               z8：时刻 t 的节目机位
    editLayer.ts                   vc：rest / keyframe / evaluated-readonly
    cameraLens.ts                  焦距 ↔ FOV（24mm 传感器高，复用/对齐 V1 scene3dMath fov↔mm）
    cameraPresets.ts               14 机位预设（相对主体）
    recordingSimplify.ts           a5A：采样 → 关键帧简化
    pathTools.ts                   rV/Q5A：弧长重采样、按弧长分配时间
    poseBlend.ts                   动作片段选择/淡入淡出权重、custom_pose 关键帧 slerp 权重（纯数学）
    lookAtSolve.ts                 视线权重/限幅/衰减（纯数学）
    ikChains.ts                    5 链 + 4 极向量配置（按 rig 骨骼映射）
    rigs.ts                        Mixamo / UE 骨骼名映射、体型缩放表（复用 ueSpike/bodyTypes）
    lights.ts                      灯光默认值、色温预设、快捷朝向
    hotkeys.ts                     默认键位表 + 作用域（viewport / timeline / global）
  scene/                           R3F 渲染与子系统
    DirectorCanvas.tsx             FencedCanvas + 场景根 + 渲染循环 + OutlinePass
    ViewCamera.tsx                 自由相机（Orbit + 键盘飞行）⇄ 机位 POV（FOV 补偿、状态保存恢复）
    entities/ CharacterEntity.tsx  ModelEntity.tsx  PrimitiveEntity.tsx  GroupEntity.tsx  SplatEntity.tsx  LightEntity.tsx  CameraEntity.tsx
    environment/ PanoramaSphere.tsx  SkyGround.tsx  SplatReveal.ts（Spark dyno 5 特效）
    character/ useCharacterAnimation.ts  useCharacterIK.ts  useCharacterLookAt.ts  SkeletonHandles.tsx
    TrajectoryVisuals.tsx          曲线/路标/画笔光标/临时线
    TransformGizmo.tsx             drei TransformControls + 编辑层写回 + 吸附
    useViewportPicking.ts          点选（对象/机位/灯/IK 把手）、锁定/隐藏过滤
    useCameraRigs.ts               follow / track_aim / 坐标注视
    LabelProjector.tsx             角色名标签投影
    creation/ useCharacterPlacement.ts  useBoxDraw.ts  usePathDraw.ts（画笔/逐点）
    recording/ useCameraMotionRecorder.ts
    capture/ directorCapture.ts    截图（裁画幅、烧标签）、帧步进录像（节目机位）
  panels/                          DOM UI（设计系统原语）
    TopBar.tsx  CreationBar.tsx  BottomBar.tsx  ModelDisplayModeSwitch.tsx  OrientationGizmo.tsx
    viewport/ AspectGuide.tsx  CameraPovHud.tsx  RecordingOverlay.tsx  PlacementHud.tsx  PipViewport.tsx
    side/ SceneObjectsTab.tsx  SceneLayerMenus.tsx  SelectionBar.tsx  AssetsTab.tsx  AssetTree.tsx
    inspector/ ContextInspector.tsx  CharacterInspector.tsx  PoseTab.tsx  SkeletonTab.tsx  PuppetFigure.tsx  JointSliders.tsx
               CameraInspector.tsx  LightInspector.tsx  PrimitiveInspector.tsx  SceneLayerInspector.tsx
               TrajectoryClipInspector.tsx  WaypointCard.tsx  BatchWaypointsCard.tsx  CloseupClipInspector.tsx
               ActionClipInspector.tsx  LookAtClipInspector.tsx  BoneKeyframeInspector.tsx
    fields/ SliderNumberField.tsx  ResetFieldHeader.tsx  ColorField.tsx  EditModeHint.tsx
    dialogs/ HelpDialog.tsx  SettingsDialog.tsx  MobileConnectDialog.tsx  ActionSelectModal.tsx  CanvasImagePickerDialog.tsx
    outputs/ OutputsPopover.tsx
    ai/ AiSceneBar.tsx
  timeline/
    DirectorTimeline.tsx  TimelineHeader.tsx  TimelineRuler.tsx  TimelinePlayhead.tsx  TrackList.tsx  TrackRow.tsx  ClipBar.tsx
    useTimelineViewport.ts（缩放/滚动/吸附）  useTimelineHotkeys.ts  timelineSnap.ts  timelineClipboard.ts
  ai/ sceneBuilder.ts（结构化输出 schema + 物化为几何分组）
  mobile/ useMobileCameraBridge.ts（渲染层：bridge 调用 + 32 字节包解析 + 写机位）
electron/director/
  mobileBridgeServer.ts            局域网 HTTP(S)+WS 服务、动态端口、设备状态、转发
  mobileBridgePage.ts              手机页面静态资源（陀螺仪/摇杆/焦距/录制按钮 → 32 字节 Float32）
  index.ts                         IPC 注册（走 bridge 契约，R26）
src/i18n/locales/director.ts       zh-CN / en
```

依赖方向：`panels/*`、`timeline/*`、`scene/*` → `model/*`；`model/*` 不 import React/THREE（`closeupRig` 等只用自己的向量数学，避免 three 依赖以便零环境单测；需要 three 的放 `scene/`）。V1 复用只从 `nodes/scene3d/` **导入**以下纯层（不复制、不改）：`scene3dMath.ts`（`captureScene`、`collectCaptureHiddenObjects`、`tagEditorOnlySubtree`、fov↔mm、`applySceneCameraPose`）、`cameraMoveVideo.ts`/`scene3dScreenshot.ts`（落盘桥）、`panoramaImport.ts`、`scene3dFitView.ts`、`scene3dSafeFrame.ts`（安全画幅求解，用于「生成并捕捉机位」）、`ueSpike/*`（UE rig/体型/姿势）、`scene3dConstants.ts` 的资产 URL 与旗标、`scene3dInput.ts`。切换门时这些文件搬进 V2 目录。

### 2.2 与画布的接线（节点注册侦察已回填，file:line 以 2026-09-02 树为准）

- **注册**：`nodes/registry.ts:61-276` 加 `director` 插件项（`quickAdd:false`、`agentCreatable:false`、`providesImageReference:true`、`catalogKind:'text'`、`defaultSize 480x320`、新增 `GenerationNodeIconKey` 成员 :18-32）；kind 联合/zod/加载归一化自动跟随（**未注册的 kind 在 `canvasSnapshotNormalizer.ts:52-56` 会被静默丢弃**，所以注册必须在任何工程持久化之前进 main）；`renderRegistry.tsx:48-63` 图标；electron 镜像表 `electron/capabilityCore/nodeKindDomain.ts:12-28/31-47/79-93`（有等价性测试兜底）；默认分类 `model/generationCanvasTypes.ts:34-48`（`'scene'`，与 scene3d 同）；i18n `src/i18n/locales/runtime.ts` 的 `runtime.nodeRegistry.director.{menu,title,placeholder}` zh/en。
- **隐藏到 S9**：不进 `components/canvasToolbarModel.ts:3-6` 分组 → 左栏/右键/连线末端菜单都不出现；开发入口 = 新增 devlab 页 `director-lab.html`（`src/devlab/directorLab.tsx`，仅 dev，可独立挂 `DirectorEditor` 迭代）+ 隐藏的 `?nomiDirectorV2=1` 工具栏开关。
- **节点体**：`nodes/BaseGenerationNode.tsx:537-540` 加 `kind==='director'` 分支渲染 `DirectorNode`（并复制 :230/:233/:661 的 composer/timeline-drag 退出）。
- **状态落点**：`node.meta.directorProject`（zod 透传 `meta`）；读取时 `normalizeDirectorProject()` 容错归一（对齐 `scene3dSerializer.normalizeScene3DState` 的做法，不做版本号迁移链）；写回走 `useGenerationCanvasStore.getState().updateNode(id, { meta })`（`store/canvasNodeActions.ts:110-130`，自动 700ms 防抖落盘）；编辑期每 2s 空闲写一次 + 关闭时 `persistActiveWorkbenchProjectNow()`。
- **打开/关闭**：`DirectorEditor` 走 `Scene3DFullscreen.tsx:497-520/798` 同款壳：portal 到 body、`FULLSCREEN_Z_INDEX`(3000)、`role=dialog`、壳上 `stopPropagation` 键鼠滚轮、body 滚动锁、捕获期 keydown；关闭确认用 `confirmDialog`。
- **产物回画布**：截图复用 `Scene3DEditor.handleScreenshot` 链（`persistScene3DScreenshot` → `addNode({kind:'image'})` → `updateNode` 结果 → `connectNodes(director, image, 'reference')`，`Scene3DEditor.tsx:251-318`）；录像：`persistCameraMoveVideo` 落 mp4 资产后**新建 Video 节点并把资产设为其结果**（S6 检查点：若 Video 节点不支持「导入本地 mp4 为结果」，退回 V1 的 `attachCameraMoveToTarget` 注入下游视频节点 `referenceVideoUrls`）。
- **连入**：本期 V1 不读入边；V2 读入边：Image（2:1 全景，走 `panoramaImport` 校验）与 Asset（.spz/.ply/.glb/.fbx）→ 资产树「连线引用」；需在 `agent/referenceEdgeCapability.ts` 的 `EDGE_MODE_SLOTS/validateReferenceEdge` 允许 `image/asset → director`（S5）。
- **AI 工具**：本期不加；切换门时 `create_staging_reference / create_camera_move` 改产出 `director` 节点（链路见侦察 §5：`canvasDescriptors.ts → agentToolCatalog.ts → canvasWrite.ts → applyCanvasToolCall.ts`）。
- **词表**：GLOSSARY 新增「导演台片段时间轴（DirectorTimeline，播放头以秒计）」一行，避开 EditPlan / 剪辑 / rough cut / 主时间轴（帧）。

## 3. 数据模型（`model/directorTypes.ts`，V2 schema；与参考产品工程 JSON v2 字段一一对应）

```ts
type Vec3 = { x: number; y: number; z: number }           // 米 / 度
type DirectorProject = {
  version: 2
  activeSceneId: string
  scenes: DirectorScene[]                                  // 图层
  exportRatio: '16:9'|'9:16'|'4:3'|'3:4'|'1:1'|'3:2'|'2:3'|'21:9'|'free'
  exportResolution: '1080'|'1440'|'4k'
  outputs: { screenshots: OutputImage[]; videos: OutputVideo[] }   // 只存资产句柄（nomi-local://），禁 base64（check:heavy-path）
}
type DirectorScene = {
  id: string; name: string; visible: boolean
  sceneConfig: { scale: number; position: Vec3; rotation: Vec3; skyColor: string; gridSnapEnabled: boolean; gridVisible: boolean
                 gridHeight: number; groundOpacity: number; showSkeleton: boolean; showCharacterLabels: boolean
                 showRuleOfThirds: boolean; modelDisplayMode: 'solid'|'translucent'|'clay' }
  panoramaConfig: { url: string; radius: number; rotationY: number }
  objects: DirectorObject[]; cameras: DirectorCamera[]; lights: DirectorLight[]
  timelineTrackOrder: string[]; timelineTrackPins: string[]; timelineTrackFolds: string[]
}
type DirectorObject = {
  id: string; name: string
  type: 'character'|'model'|'group'|'splat'|'cube'|'sphere'|'plane'|'cylinder'|'cone'|'torus'|'tetrahedron'|'icosahedron'
  position: Vec3; rotation: Vec3; scale: Vec3; parentId?: string
  color?: string; roughness?: number; metalness?: number; opacity?: number; wireframe?: boolean; flatShading?: boolean
  visible: boolean; locked: boolean; isAuxiliary?: boolean
  modelPath?: string; modelScale?: number; isSystemModel?: boolean; rig?: 'mixamo'|'ue4'
  posePreset?: string; boneRotations?: Record<string, Vec3>; hipsOffset?: Vec3; bodyType?: string
  motionTrajectory?: Waypoint[]; trajectoryClips?: TrajectoryClip[]; inTimeline?: boolean
  actionClips?: ActionClip[]; actionTrackEnabled?: boolean
  lookAtClips?: LookAtClip[]; lookAtTrackEnabled?: boolean
}
type DirectorCamera = {
  id: string; name: string; position: Vec3; yaw: number; pitch: number; roll: number
  fov: number; focalLengthMm: number                      // fov 唯一真相，focalLengthMm 派生缓存（对齐 07-03 拍板）
  lookAtType?: 'none'|'object'|'coordinates'; lookAtObjectId?: string; lookAtCoords?: Vec3
  rigType?: 'none'|'follow'|'track_aim'; showRayHelper?: boolean
  motionTrajectory?: Waypoint[]; trajectoryClips?: TrajectoryClip[]; closeupClips?: CloseupClip[]; inTimeline?: boolean
}
type DirectorLight = { id; name; type:'directional'|'point'|'spot'; color; intensity; position: Vec3; yaw; pitch; enabled; visible; locked
                       castShadow; spotAngle?; spotPenumbra?; distance; decay }
type Waypoint = { id; x; y; z; yaw; pitch; roll; time; frameIndex; clipId?: string; progress?: number }
type TrajectoryClip = { id; startTime; endTime; startFrame; endFrame }
type ActionClip = { id; name; clipType: 'action'|'custom_pose'; actionPose?: string; startTime; endTime; startFrame; endFrame
                    keyframes?: BoneKeyframe[] }
type BoneKeyframe = { id; time; frame; boneRotations: Record<string, Vec3>; hipsOffset?: Vec3 }
type LookAtClip = { id; name; targetType: 'camera'|'object'|'custom'|'none'; targetId; enablePitch; targetHeightOffset
                    targetBodyPart: 'eye'|'face'|'chest'|'body'|'pelvis'|'foot'|'custom'; startTime; endTime; startFrame; endFrame
                    blendInDuration; blendOutDuration; weight; clampingAngle }
type CloseupClip = { id; entityId; targetObjectId; startTime; endTime; startFrame; endFrame
                     anchor: 'eye'|'face'|'chest'|'body'|'pelvis'|'foot'|'custom'; customAnchor?: Vec3
                     facingMode: 'look_at_target'|'follow_subject_yaw'|'world_locked'|'manual'
                     azimuth: 'front'|'front_left'|'front_right'|'left'|'right'|'back'|'custom'; customAzimuthDeg?: number
                     horizontalAngle; pitchAngle; distance; height
                     motionPreset: 'static'|'orbit'|'half_arc'|'push_in'|'pull_out'|'crane'|'truck'|'spiral' }
```

时间常量：`FPS=30`、`MAX_DURATION=60`、`SNAP_EPS=1/60`（半帧）；`ig(t)` 量化到帧格；`contentEndSeconds(scene)` = 所有片段 endTime 最大值（单一真相，对齐 07-30 拍板）。

编辑器瞬态（store，不进工程）：选择态（对象/机位/灯/路标(单/多)/片段+类型/骨骼键/IK 目标）、`activeCameraId: 'free'|id`、`previewCameraId`、`transformMode`、`timelineEditContext {currentTime, autoKey, totalDuration, isPlaying}`、撤销/重做栈、`evaluatedPoses`（求值缓存）、面板显隐、`isTimelineDragging`。

## 4. 页面规格与交互（逐区域；ID = 区域字母 + 序号；每条对应清单条目）

### 4.0 打开 / 布局 / 退出（O）

- **O1 打开**：节点卡「导演台」按钮 → 全屏壳；加载工程（无则默认「场景 1」：天空 `--nomi-*` 深色 token 对应值、100×100 网格、地面透明度 0.2、自由相机 (0,1.7,10) 看原点）；把连入的 Image(全景) / Asset(.spz/.ply) 注入资产树「连线引用」。
- **O2 布局**：左右可拖分栏（主区默认 72%，右栏 28%，右栏 18–42%）；主区上下分栏（视口 80% / 时间轴 20%，时间轴可折叠到 6% 只留头部条）；右栏上下分栏（场景对象·资产库 / 属性检查器）。分栏位置持久到 `localStorage`（Nomi 化）。分栏手柄键盘可调（复用 `TimelineResizeHandle` 模式）。
- **O3 退出**：右上「退出导演台」→ `confirmDialog`「是否确认退出？数据会自动保存」→ 写回节点 → 关闭；Esc 在无浮层/无模式时等价于退出确认（参考产品：Esc 只取消工具；Nomi 化：先取消模式/选择，连按两次才弹退出，防误退）。
- **O4 焦点作用域**：指针悬浮区域决定快捷键作用域（视口 / 时间轴 / 面板输入框不拦截），与 07-26「交互按模式拆分」一致；HUD 显示当前作用域提示（帮助对话框「区域感知 · 焦点自动切换」）。
- **O5 Escape 归属**：走 `overlayLayers` 契约（对话框 > 弹层 > 模式 > 选择 > 退出）。

### 4.1 顶部工具条（T）

| ID | 控件 | 交互 |
|---|---|---|
| T1 | 选择（Esc）| 取消工具/模式/选择，按 O5 顺序 |
| T2 | 移动 / 旋转 / 缩放（1/2/3）| 切 `transformMode`；gizmo 挂在选中对象/机位/灯；吸附开时 0.5m / 15° / 0.1 |
| T3 | 手绘画线（4）| 需选中角色或机位，否则 toast「请先选中一个角色或机位」；进入后 Orbit 禁用、光标十字、地面画笔光标跟随；按住拖画，松开生成路标（§4.2 P3）|
| T4 | 逐点绘制（5）| 同前置；每次点击落一个路标，预览线从上一路标到光标 |
| T5 | 重置当前视角（0）| 自由相机归位（POV 下重置该机位到静止位姿）|
| T6 | 退出导演台 | O3 |
| T7 | 视口信息条 | 当前作用域 / 当前模式提示（Nomi 化：把「隐藏手势必须有可见说明」落实）|

### 4.2 3D 视口（V）

**V1 导航**：左键拖旋转、右键拖平移、滚轮缩放（OrbitControls；灵敏度/阻尼来自设置 §4.8）；WASD 前后左右、E/Q 升降、方向键转视角、Shift ×2 加速；视图立方 X/Y/Z 面点击对齐视角，录制中禁用并 toast；F 聚焦选中实体（包围盒适配，复用 `scene3dFitView`）。

**V2 点选**：左键点击（位移 ≤5px 才算点击）射线拾取 → 选中对象/机位/灯/IK 把手；锁定或隐藏（含父级）不可拾取；点空白取消选择；选中描边（OutlinePass 半分辨率）+ 机位模型自发光；右键在放置/画框模式中 = 取消。

**V3 变换写回（编辑层）**：拖 gizmo 时 Orbit 禁用；`editLayer.resolve(entity, ctx)`：`rest`（无片段或播放头不在片段内）→ 改静止位姿；`keyframe`（播放头在路标上或有选中路标）→ 改路标；`evaluated-readonly`（片段内但不在路标上）→ 不写回，检查器显示「编辑模式：只读（先插关键帧）」；`autoKey` 开时在 `readonly` 处自动 `prepareClipForKeyframeInsert` 再写入。滚轮/拖动期间撤销快照合并（200ms 防抖）。

**V4 创建栏（视口底部中）**：
- V4a 角色 ▸ 女人 / 男人 → 放置模式：地面光环幽灵体跟随光标；点击落点，按住拖拽设朝向（HUD 实时角度），右键/Esc 取消；创建后选中 + 切移动工具 + 名字「角色N」。资产：女人 = X Bot（现有 `assets/x-bot.glb`），男人 = UE 人偶（已拍板）或用户自备 Y Bot（§8 资源）。
- V4b 机位 ▸ 14 预设（当前视角 / 正面中景 / 正面特写 / 正面全景 / 侧面跟拍 / 侧面近景 / 背面中景 / 俯拍全景 / 40度俯拍 / 低角度仰拍 / 低角度广角 / 过肩镜头 / 过肩镜头右 / 鸟瞰）：以**当前选中主体**为原点（HUD「相对主体：X」），无主体按世界原点；数值表来自清单 §2.2/拆解 §3，`cameraPresets.ts`。
- V4c 灯光 ▸ 主光 / 点光 / 聚光（默认位置与朝向见 `lights.ts`）。
- V4d 创建方块：拖底面（宽×深实时显示，Shift 锁正方形）→ 松开进入拉高（Shift 锁正方体）→ 左键确认，右键/Esc 取消。

**V5 底部工具条**（分五簇，§1.5 计簇）：① 历史：撤销/重做；② 场景：导入 720 全景（文件选择 → 校验 2:1 软警告，复用 `panoramaImport`）、群众矩阵（需选中角色；行 1–10、列 1–10、间距 0.5–5m → 「群众组」）、骨骼与 IK 把手开关；③ 画幅：8 比例 + 3 分辨率 + 三分线开关（弹层）；④ AI 搭场景开关；⑤ 产物：截图（Cmd+Shift+P）、产出物管理弹层（角标计数；图片/视频页；预览、发送到画布、删除）。

**V6 叠加层**：角色名标签（可关）；画幅引导框（POV + 非 free 画幅时显示，框外压暗，三分线）；FOV 补偿使框内即成片；显示模式开关（实体 / 半透 / 白模，可折叠，含「偏好设置」入口）；POV HUD（机位视角标识、退出机位、录制运镜/完成录制、连接手机）；录制中横幅；放置/画框 HUD；模式提示条。

**V7 画中画节目小窗**：独立小 renderer（同一场景图）渲染目标机位；播放中跟节目机位（无 → 「无信号」黑）；机位下拉切换；「进入视角 / 退出机位」；FOV 读数；拖标题移动、拖角缩放 280–520px、折叠/展开；宽高比随导出画幅；特写期间禁止进入、录制中禁止切换（toast 文案见清单）。

**V8 AI 搭场景浮条**：见 §5.8；输入框 Enter 提交、Shift+Enter 换行、支持粘贴图片；参考图 ≤3（本地上传 / 从画布选）；目标：当前打组 / 新建图层；状态与耗时；取消。

### 4.3 右栏上半：场景对象 / 资产库（S）

- **S1 场景对象**：图层列表（新建/复制/重命名(双击或菜单)/删除/显示隐藏整层/激活图层；右键菜单）；实体树按图层（角色/物体/组/机位/灯）：行内 显示、锁定、删除、「辅助」标记，组可折叠；双击组 = 重命名；右键组：重命名/解散组；右键实体：复制到场景层 / 新建场景并复制 / 移动到场景层；列表内**拖选范围**（参考产品选择栏监听 mousemove，Nomi 化再加 Shift/Ctrl 点选）；多选浮条：已选 N · 打组 / 解散组 / 显示·隐藏 / 锁定·解锁 / 删除 / 取消；搜索框（Esc 清空）；空态提示。
- **S2 资产库**：目录树：连线引用（连入全景 / 泼溅文件）、用户上传（导入本地模型 FBX/GLB → 自动判 Mixamo 角色 vs 普通模型；文件夹 CRUD；拖拽移动；删除连文件）、Marble 场景（内置示例 .spz 若有许可，否则该目录改名「泼溅场景」放用户文件）、预设模型（女人/男人）、基础灯光、基础几何体（含辅助球）；双击 = 加入场景；搜索；「导入场景」= 载入资产库里保存的场景 JSON（AI 搭场景自动存入）。
- **S3 资产落盘**：模型文件进项目资产目录（走现有资产桥），路径存 `modelPath`。

### 4.4 右栏下半：属性检查器（I）

通用：每字段头带「重置」；数字字段支持滑条 + 输入 + **滚轮微调**（step）；颜色字段 = Nomi 色板 + 自定义 + 清除；顶部「编辑模式：静止/关键帧/只读」提示（V3）。

| ID | 选中类型 | 字段/操作 |
|---|---|---|
| I1 | 角色·基础 | 名称；颜色预设 8 项 + 自定义；位置/朝向(水平·俯仰·横滚)/缩放 |
| I2 | 角色·姿态 | 内置姿态列表（T-Pose + 动作库静态帧，GIF/首帧预览）；快捷体形 8 项（缩放表）+ UE 5 体型（若 rig=ue4）|
| I3 | 角色·骨骼 | 2D 人偶：IK 靶点（头/胸/重心/双手/双脚/肘向/膝向）与 FK 关节可点选，L/R 侧切换，W 平移求解 / E 旋转；已选把手：拖 3D 轴实时 IK，「复位此肢体」；已选关节：3 轴语义滑条（30 组标签表）+「0°复位」+「重置此关节」；全部复位 / 双脚吸附地面 / 左右镜像 |
| I4 | 机位 | 名称；焦段预设 8 档 + 焦距 12–300mm 滑条 + 垂直 FOV 读数；位置/朝向；射线与视锥开关；rig（无/跟随/只转朝向）+ 目标 |
| I5 | 灯光 | 名称；启用/视口可见/锁定；颜色 + 色温预设 7 项；强度；聚光锥角/柔化；有效距离；位置；照射朝向 + 4 快捷朝向 |
| I6 | 几何体/模型 | 名称；材质颜色/粗糙度/金属度/透明度/线框/平面着色；辅助物体开关；变换 |
| I7 | 路径片段 | 所属实体；开始/结束/时长（秒+帧）；裁前/裁后到播放头；删除（含关键帧）|
| I8 | 路标 / 批量路标 | 单：帧、位置、水平/俯仰/横滚、看向（自由/对象）、删除；批量：范围、批量看向/逐帧对准、统一俯仰横滚（归 0）、批量删除 |
| I9 | 特写片段 | 机位、目标、时长；锚点(7)+自定义 XYZ；朝向模式(4)；方位(7)；水平角/俯仰角/距离/高度；运镜预设(8)；裁剪；转为路径片段；删除 |
| I10 | 动作片段 | 类型、动作名、时长、裁剪、删除；副轨禁用提示「一键启用」|
| I11 | 视线片段 | 目标（不注视/摄像机/物体）；部位(5)；启用上下注视；高度偏移；缓入/缓出；限幅角；强度；裁剪；删除 |
| I12 | 骨骼关键帧 | 删除（数值在骨骼页改）|
| I13 | 场景图层 | 天空色；角色标签开关；网格显示/高度；地面透明度；网格吸附；全局缩放/平移；全景半径/旋转/清除 |

### 4.5 时间轴（L）

- **L1 头部**：播放/暂停（Space）、停止、帧读数「F 当前 / 内容末秒」、自动帧、吸附、倍速 0.25–2×、放大/缩小（Ctrl+滚轮）/适应、录制 MP4（进度）、插入关键帧（I）、折叠/展开。
- **L2 轨道**：「+ 添加轨道」（未入轴实体列表）；拖序（= 节目机位优先级）；钉住；折叠；删除实体；副轨：空间轨迹（蓝）/ 动作（绿，可旁路）/ 骨骼帧（琥珀）/ 视线（靛，可旁路）/ 特写（玫红，机位）；每副轨 上一/下一关键帧、清空。
- **L3 片段操作**：右键/加号菜单：在前方插入 / 追加 新路径片段；添加动作(内置→弹窗) / 骨骼姿态 / 视线片段；创建特写片段（角色轨 = 新机位+特写；相机轨 = 追加特写）；在播放头处切割；片段条拖两端调时；路标点拖动改时间 / 点击调参；Shift 点选批量路标；骨骼帧拖动；复制/粘贴规则（特写只贴相机轨、视线/动作只贴人物轨、无空间拒绝，粘贴贴播放头，Cmd+D 紧贴续接）；左右剪切 Q/W；分割 Cmd+B；删除 Backspace。
- **L4 吸附**：片段边缘 / 关键帧 / 播放头，吸附线可视；容差按缩放换算。
- **L5 播放**：`requestAnimationFrame` 推进，倍速，到内容末自动停（循环开关 Nomi 化默认关）；播放中拖播放头 = 暂停并 seek。
- **L6 动作选择弹窗**：搜索、筛选（循环动作/单帧姿态）、实时 3D 预览（独立小 renderer，重置视角）、双击直接添加、确认按钮。
- **L7 快捷键**：见清单 §5.4，全部固定默认值；帮助对话框实时显示。

### 4.6 相机、录制、手机（C）

- **C1 进出 POV**：PiP「进入视角」/ 机位行 / 双击机位模型（Nomi 化补充）；进入时保存自由相机状态，退出恢复；POV 下 Orbit 目标 = 机位前方 5m，鼠标/键盘直接改机位位姿（走 V3 编辑层）。
- **C2 录制运镜（R）**：前置：在具体机位；特写片段内禁止；采样阈值 Δ位 0.02m / Δ角 0.5° / Δt 1 帧，含 fov；临时线实时画；时间轴自动 `ensureDuration(t+2)`；停止：`recordingSimplify`（Δyaw>6°∨Δpitch>4°∨Δd>0.6m 且 ≥0.25s，或 0.5s 强制）→ 路标 + 片段；<0.3s 且 <0.05m 丢弃；toast「按空格回放」。
- **C3 Shift+A 从当前视角生成新机位**（自由视角固化）；**角色轨「创建特写片段」**（正面特写预设相对角色 + 4s 特写）；**相机轨「创建特写片段」**。
- **C4 手机虚拟相机**：§5.7；HUD 入口 + 对话框（二维码、复制链接、设备与延迟、断开、三步指南）。
- **C5 节目机位**：`programCamera.at(t)` 按轨道顺序取有片段覆盖 t 的第一台；PiP 与录像使用；无 → 黑场。

### 4.7 产物（P）

- **P1 截图**：藏辅助体/把手/网格（复用 `collectCaptureHiddenObjects` 旗标机制）→ 渲染 → POV+非 free 时按引导框裁到导出像素 → 烧角色标签 → PNG（`toBlob`，禁同步 `toDataURL`）→ 落盘为项目资产 → `outputs.screenshots[]`（名「{机位名}·{焦距}mm-截图N」/「自由漫游·全景-截图N」）→ toast；「发送到画布」= 新 Image 节点 + 连回。
- **P2 录制 MP4**：前置检查（有动画片段；有机位片段）；帧步进（`FPS` 30，总帧 = 内容末×30，≤1800）：每帧 `updateTimelinePlayback(k/FPS)` → 节目机位 → 离屏相机 → `captureScene`（导出分辨率取偶）→ 烧标签 → 帧 → `framesToVideo`（ffmpeg，复用 V1 桥）→ 资产 → `outputs.videos[]`（「预演录制-xxxx」）；黑场帧 = 纯黑；进度显示在头部；可取消。「导入画布」= Video 节点「动画预演」。

### 4.8 偏好与帮助（H）

- **H1 设置对话框**：漫游速度、方向键转速、左键旋转灵敏度、右键平移灵敏度、惯性阻尼（各「恢复默认」）；视口主题：深邃黑 / 中性灰（Blender 风格，红绿轴）即时生效；帮助入口。持久到 `localStorage`。
- **H2 帮助对话框**：四栏键位表（视口工具 / 视口操作 / 时间轴 / 漫游），键位来自 `hotkeys.ts` 单一来源。

## 5. 子系统设计（关键机制，避免实现时走样）

### 5.1 渲染与循环
FencedCanvas（`frameloop="always"`，编辑器卸载即停）；主 `useFrame`：① 播放推进 → `updateTimelinePlayback(t)`；② 键盘飞行；③ rig；④ IK/视线/动画 mixer；⑤ 泼溅显现 tick；⑥ 标签投影。选中描边：three `EffectComposer + OutlinePass`（半分辨率），无选中时直接 `gl.render`。上下文丢失：复用 `attachWebGLContextRecovery`。

### 5.2 时间轴求值（纯层）
`updateTimelinePlayback(t)`：对象 → `trajectoryEval.evaluate(entity, t)`（sample/hold/rest）+ 角色动画 + 视线；机位 → 特写片段优先（`closeupRig.solve`，目标用角色当前求值位姿 + yaw；`referenceRotationY` 取片段起点的目标朝向用于 orbit/half_arc/spiral）→ 否则路径片段 → 否则静止；写 `evaluatedPoses`；录制中的机位跳过。

### 5.3 编辑层与自动帧
`editLayer.resolve`：`activeWaypointId` → keyframe；特写覆盖 → readonly；无片段且无路标 → rest；路标在 ±半帧内 → keyframe；否则 readonly。写入：`writeSpatialTransform(entity, patch, ctx)` 返回 `{layer, applied, keyframeId, trajectoryUpdated}`；`autoKey` 时 readonly 先 `prepareClipForKeyframeInsert`（扩容/新建片段，冲突则拒绝并 toast）。

### 5.4 角色：动画 / 姿态 / IK / 视线
- 动画：动作库 = T-Pose + 9 个 Mixamo FBX（`src/assets/director/pose`，`model/actionLibrary.ts`；2026-09-03 用户指出手写姿态与参考产品对不上后改成这样）；每个 FBX 自带骨架 + 各自 `AnimationMixer`（`scene/character/poseClipLibrary.ts` 单例），采样出快照后按「相对源 bind 的增量」套到角色 bind 上（`poseSnapshot.ts`，骨盆经坐标系换算，x-bot.glb 与 FBX 骨盆父系差 −90°）；`poseBlend.resolve(clips, t)` 给出 `{clipA, clipB, weight}`：片段头 0.25s 淡入、间隙 ≤0.5s 两端混合、尾 0.25s 淡出到姿态预设；`custom_pose` 关键帧 slerp + hipsOffset lerp；应用顺序：bind pose 复位 → 采样/混合 → boneRotations 偏移 → IK → 视线 → skeleton.update。
- rig 映射：`rigs.ts` 提供 `boneName(rig, semantic)`；Mixamo `mixamorig*`，UE `UE4_MANNEQUIN_BONE_MAP`。
- IK：`CCDIKSolver`（SkinnedMesh + 骨索引），链配置来自 `ikChains.ts`（手 25 迭代 max 0.8 / 脚 30 迭代 0.7 / 头 15 迭代 0.5；极向量 0.35m）；把手 = 可拾取小球（`isIKHandle` userData），拖动走 TransformControls；`ikModeEnabled` 关时 FK。
- 视线：`lookAtSolve.weights(clip, t)` → 头 yaw 限幅、pitch ±60° smoothstep、颈/脊分配（0.15/0.3）。
- 体型：缩放表（8 快捷体形）+ UE 5 体型（rig=ue4）。

### 5.5 环境
- 全景球：等距柱状贴图球 r=500，1.8s 淡入；来源：底部栏导入 / 连线引用；复用 `panoramaImport` 校验。
- 泼溅：`extend({ SparkRenderer, SplatMesh })`（fiber 8 目录式）；`<sparkRenderer args={[{renderer: gl}]}>` 挂场景根一次；`<splatMesh args={[{url}]}>` 作为对象挂在 `globalSceneContainer` 下随图层变换；显现特效：移植 5 段 GLSL dyno（Magic/Spread/Unroll/Twister/Rain），默认随机 Magic/Spread，×2 倍速，黑幕过渡；Vite 需确认 Spark 的 WASM `new URL(import.meta.url)` 在 Electron renderer 下可解析（S5 首个验证点）。
- 主题：默认 / Blender 灰；网格 `Xx` 等价（100×100，红绿轴可选）。

### 5.6 出片
截图与录像共用 `directorCapture.ts`：`renderFrame(t, cameraId|program, size)` → `captureScene`（V1，隐藏旗标对象）→ 标签合成（OffscreenCanvas）→ Blob；录像用 V1 的帧数组 → `framesToVideo` 桥（若桥只收 dataURL，则在 electron 侧新增接收 PNG Blob/ArrayBuffer 的入口，同一 handler 复用 ffmpeg 参数构造器）。

### 5.7 手机虚拟相机
Electron：`mobileBridgeServer.ts` 起 HTTP 静态页 + WS（`ws` 依赖已在仓库？S8 首个检查点；无则加 `ws`）；动态端口；HTTPS 自签名证书（iOS 陀螺仪要求安全上下文；Android Chrome 亦要求）→ 首次生成证书存 userData；页面：横屏、摇杆（位移 x/z）、升降条、陀螺仪 Δpitch/Δyaw/Δroll、焦距滑块、复位横滚、开始/停止录制；32 字节 Float32 包；桌面端：bridge `director.mobile.start/stop/status` + 事件 `packet/deviceStatus/recordAction`；写入激活机位（速度 2m/s、1.5m/s 持久）。二维码：`qrcode`（MIT）渲染到 canvas。WebRTC DataChannel 为 S8 末可选。

### 5.8 AI 搭场景
`ai/sceneBuilder.ts`：zod schema `{sceneName, groups[{name, elements[{type, position[3], rotation[3], scale[3], color, roughness, metalness, opacity, wireframe, flatShading}]}], sceneConfig{skyColor, groundOpacity}}`；调用 Nomi 现有文本/多模态模型通道（结构化输出），参考图 ≤3 转 base64 仅用于请求（不进 store）；物化：`qS` 等价（弧度/角度启发式）、分组「建筑组/结构分区/AI场景总成」，目标当前打组或新建图层；结果自动存资产库「导入场景」；可取消（AbortController）。

## 6. 设计系统与门岗落地要点

- 只用 token（`nomi-*`/`workbench-*`），参考产品的 `bg-zinc-900/90` 等一律映射到 `--nomi-paper`/`--nomi-ink-*`/`--workbench-backdrop`；字号 `text-micro/caption/body-sm`；圆角 `rounded-nomi*`；图标 Tabler（新增图标同步 `src/vendor/tablerIcons.ts`）。
- L1 预算：顶栏 1 簇（工具）+ 出口；底部栏 5 簇（§4.2 V5）；时间轴头部 3 簇（传输 / 编辑辅助 / 产出）——C3 分组命名，不用 `w-px` 分隔线。
- C1 契约：不可用控件 `disabled` + 包裹 `title` 解释（如「时间线上暂无动画片段，无法录制视频」）。
- i18n：`src/i18n/locales/director.ts`（zh-CN/en），toast/tooltip/placeholder/对话框全走 `t()`；动态键注册 `DYNAMIC_KEY_PREFIXES`。
- 词表：新增 `layer: 'rest'|'keyframe'|'evaluated-readonly'`、`clipType`、`motionPreset`、`facingMode` 等在 `scripts/vocabularies-baseline.json` 登记 owner（`model/*`）。
- 边界：渲染层只经 `getDesktopBridge()`；electron 侧新模块不 import `src/`。
- 重活：截图/帧走 `toBlob/convertToBlob`；产物只存句柄。

## 7. 分期与验收（每期一个 PR，V2 节点在 S0–S8 期间对用户隐藏：节点面板不列出，仅开发入口/URL 参数可开）

| 期 | 内容 | 验收（R13 截图 + 单测 + 门岗）|
|---|---|---|
| S0 底座 | 节点类型/数据 schema/store/撤销/全屏壳五区域/分栏/i18n/L2·L3 文档；`timeGrid/clips/editLayer/closeupRig/programCamera/recordingSimplify/pathTools/cameraLens/cameraPresets` 纯层 + 单测 | 打开/关闭/写回；纯层单测覆盖参考数值案例（如 push_in 距离 ×0.5、spiral 升 0.8）。**2026-09-02 状态：纯层 14 模块 + store（实体/片段 action）58 单测全绿；`director` 节点已注册（隐藏）、卡片 + 全屏壳 + 分栏 + i18n 落地；typecheck / i18n / filesize / tokens / boundaries / vocabularies / controls 门岗全绿；dev 入口 `director-lab.html`。未做：样张拍板前不接视口内容。** |
| S1 视口 | 场景/网格/天空/自由相机+飞行/创建栏四类/点选/描边/gizmo+编辑层/大纲/检查器 I1·I4·I5·I6·I13/群众/分组/图层/主题/显示模式 | J-D1「搭一个三人对话场景」走查截图。**2026-09-02 状态：已落地并走查通过**——devlab 里放置 3 角色（拖拽定朝向）→ 机位预设（相对选中主体 / 无主体则世界原点）→ 平行光 → 画方块（拖底面拉高 Shift 锁正）→ 点选 + gizmo + 描边 → 检查器（镜头 8 档 / 焦距 / FOV 读数 / 变换 / 材质）→ 大纲重命名（双击、聚焦即全选）→ 群众矩阵 2×3 → 撤销/重做 → 实体/半透/白模 → Esc 归属链（清选 → 退出确认）。走查修掉的根因：① store `commitProject` 原地改写后引用不变、视口与大纲不重渲染 → 改 immer 草稿写入（唯一写入口，产物冻结）；② `NomiSegmented` 在 flex/绝对定位父级里 auto-fit 只排一列 → 设计系统加 `fit="content"`；③ 创建模式确认点击的 pointerup 被拾取当空点击清选 → 拾取只认自己接到的 down+up 一对；④ 机位预设浮层 14 项在矮视口顶出被顶栏盖住 → 浮层封顶 + 内滚；⑤ 检查器标签列 56px 截断 → 72px；⑥ 白模不影响角色 → 角色换石膏材质（参考产品 objectSystem 三模式覆盖角色）。**未做 / 留到后期**：白模角色的边缘线（参考产品陶土+描边，几何体已有、蒙皮网格未做）；灯具模型只在视口外（4,7,4）未截图确认；节点卡片进画布的真实 Electron 走查（节点仍隐藏，待 S9 前统一做）。门岗：typecheck / eslint / vitest 55 / i18n / filesize / tokens / heavy-path / boundaries / vocabularies（登记 BoxDrawStep、CameraVisualState 两词表）/ controls / lint:ci 全绿。 |
| S2 时间轴 | 片段模型/轨道 UI/播放头标尺缩放吸附/路径片段+路标（画笔/逐点/拖动/autoKey）/求值播放/裁切分割复制粘贴/hold | J-D2「让角色 A 走到 B 身边」。**2026-09-02 状态：已落地并走查通过**——选中角色3 → 顶栏「画线」(4) → 在地面拖画 → 自动生成路径片段（按弧长重采样、1.4m/s 定时长）+ 路标 → Space 播放角色走到角色1身边并停在内容末（F41 / 1.4s）→ 点视口路标 = 选中 + 播放头跳过去 + 路标卡 + gizmo 挂关键帧层 → 泳道拖片段（路标同移、吸附线）→ Ctrl+Z → Q 左剪切到播放头（片段外路标一起裁）→ 右键菜单三层（片段 / 副轨 / 轨道）→ 折叠只留头部。落地件：`model/{timelineTracks,timelineSnap,timelineClipboard,storeTimelineActions}` + 3 组单测（63 全绿）、`timeline/` 12 文件（头部三簇 / 轨道列拖序钉住折叠旁路 / 标尺 / 泳道拖拽 / 播放头 / 右键菜单 / 命令层 / 快捷键 / 缩放几何）、`scene/{TrajectoryVisuals,creation/usePathDraw}`、检查器 I7/I8 三卡。走查修掉的根因：① 蒙皮网格（量化几何 + 骨骼矩阵）对 three 射线测试不可靠 → 角色改用拾取图层上的不渲染胶囊代理，蒙皮网格退出候选；② 视口把创建/画路径模式也标成 escape 浮层 → 全局快捷键（Space 等）在模式里被整体屏蔽 → 去掉标记（模式的 Esc 由视口自己在捕获期处理）；③ 时间轴折得矮时右键菜单被容器裁 → 改 body 传送门 + fixed 定位。**Nomi 化决定**：画笔路径时长 = 弧长 / 1.4m/s（1–20s），逐点模式每点 +1s；右键菜单加「在此处新建路径片段」；Backspace / Cmd+D 没选片段时落回删实体 / 克隆实体。**未做 / 留到后期**：动作片段弹窗（S4）、创建特写片段入口（S3，菜单项已占位 disabled）、路标「看向」字段与批量看向（S3 视线目标一起）、图层全局变换非单位阵时画路径的反变换（S5）、Ctrl+滚轮缩放与轨道拖序只走了代码路径未截图。门岗：typecheck / eslint / vitest 63 / i18n（登记 timeline.family、timeline.menu 前缀）/ filesize / tokens / heavy-path / boundaries / vocabularies / controls / lint:ci（82，未增）全绿。 |
| S3 相机 | POV/PiP/画幅框+FOV 补偿/14 预设/特写片段 8 运镜+检查器/节目机位/录制运镜+简化/Shift+A/轨道创建特写 | J-D3「三机位切换的一段对话」。**2026-09-02 状态：已落地并走查通过**——画中画「进入视角」→ POV（HUD 机位名·焦距·写入层、画幅引导框 + 三分线、FOV 补偿、Orbit 目标前方 5m、拖拽/WASD 按编辑层写回、只读层弹回）→ R 录制运镜（红点计时横幅、播放头自动推进、PiP LIVE 节目流、无覆盖黑场「无信号」）→ R 完成（4 关键帧片段 + toast「按空格回放」）→ Space 回放 POV 沿录制路径运动 → Shift+A 自由视角固化新机位 → 角色轨右键「创建特写片段」= 正面特写预设新机位 + 4s 特写（PiP 切到它、特写卡 I9 全字段）→ Space 播放特写机位跟着角色当前位姿走、节目机位按轨道顺序切。落地件：`model/storeCameraActions`（进出 POV 受 canEnterCameraPOV 门 / Shift+A / 角色轨·机位轨创建特写 / 录制起停放弃 / 特写烘焙成路径）、`cameraLens.povVerticalFov + exportAspectRatio`（+ 单测）、`scene/{ViewCamera POV 模式, PipRenderer + pipCamera, useTimelinePlayback 特写/rig/看向求值}`、`useCameraMotionRecorder + CameraRecorderContext`、`panels/viewport/{AspectGuide, CameraPovHud, PipViewport}`、`inspector/CloseupClipInspector` + CameraInspector rig 段 + 进出视角按钮、底部栏画幅簇、时间轴机位轨双击进 POV、视口双击机位模型进 POV。走查修掉的根因：① PiP 外壳整块 `bg-nomi-paper` 把画布盖住 → 外壳透明只给标题/页脚上底色；② POV 里 Shift+A 会在眼前再造一台机位（模型糊满屏）→ 只允许自由视角固化，POV 里 toast 拦。**Nomi 化决定**：画中画不另起渲染器，主画布 scissor/viewport 内嵌渲染（同一上下文、同一场景图，editor-only 与辅助物体不画）；Esc 归属链加两级：录制中 = 放弃录制、POV 中 = 退回自由视角；录制中 Space = 完成录制。**未做 / 留到后期**：视图立方录制中禁用 + toast；PiP「无信号」黑场只盖 DOM 不清画布（黑底 DOM 足够）；手机虚拟相机按钮占位 disabled（S8）；rig 的「跟随」只保持相对静止偏移、不做平滑。门岗：typecheck / eslint / vitest 66 / i18n（登记 camera.rig / camera.lookAt / closeup.* 前缀）/ filesize / tokens / boundaries / controls / heavy-path / vocabularies 全绿。 |
| S4 角色 | 动作库+弹窗预览/动作片段混合/自定义姿态关键帧/2D 人偶+FK 滑条/IK 五链+极向量/视线片段/体型/颜色 | J-D4「跪下—起身—回头看镜头」。**2026-09-02 状态：已落地并走查通过**（Playwright 真机走查 + E2E 取证桥量化）——骨骼页开「骨骼编辑」→ 角色身上出 IK 把手（头/胸/骨盆/双手/双脚 + 肘膝极向量），按住把手直接拖 = CCD 求解右手抬起并烘焙进 boneRotations（人偶图点把手 → 已选把手卡「复位此肢体」）→ 动作轨右键「添加动作片段」→ 动作库弹窗（3 循环 + 10 静态姿态，搜索/分类/双击加）加「姿态·蹲下」「姿态·站立」→ Space 播放：1.7s 静止走姿、5.1s 蹲下、7.6s 站立、片段间 0.5s 交叉淡入淡出 → 动作轨「添加骨骼姿态片段」+ 骨骼帧轨「在此处插入骨骼关键帧」（无姿态片段时 toast 提示先加）→ 选关键帧后拖把手写进该帧而非静止姿态（量化：关键帧 RightArm 变、rest 不变）→ 两帧之间播放头扫过手的屏幕位置单调插值 → 视线轨「添加视线片段」→ 目标 摄像机/机位 2 → 5s 头朝向 yaw −150° = 目标方位 −149°（1s 时 = 身体 −72°）→ 姿态页「瘦高」体形 scale (0.85,1.08,0.85)、「叉腰」写 4 根骨 → 骨骼页「左 → 右镜像」右臂 = 左臂 (y,z 取反)、「全部复位」清空、「双脚吸附地面」写 hipsOffset 且 Ctrl+Z 可撤。走查修掉的根因：① 假人 3.2m 高——X Bot hips 骨自带 1.809 倍 scale，V1 归一化只量几何盒 → 改按骨骼竖向范围量身高（`characterRig.measureSkeletonExtent`），首帧按蒙皮最低点自动贴地，不再调 V1 贴地函数（它首帧前按失效 boneMatrices 算最低点把角色抬高 0.39m）；② 视线不转头——`solveHeadAim` 相对转角用了 0–360 的 wrapDeg，目标在左侧时 −82° 被算成 278° 权重归零 → 新增 `vec3.signedDeg`（±180）+ 单测；③ 1s 处加片段被甩到轨道末尾——放置/重叠按全家族片段算，0–1.4s 的路径片段顶走了动作片段 → 放置与拖拽/裁剪只跟同副轨争位置，塞不下就缩到空档（`clips.fitClipAt` + 单测）；④ 动作片段条透明——`timeline/clipTone.ts` 是 .ts，Tailwind content 只扫 .tsx → content 加 `src/**/*.ts`；⑤ IK gizmo 画到别处——drei TransformControls 的可视部分挂在角色根下被二次变换 → createPortal 到场景根；⑥ 双脚吸附没写入——处理器登记在 ViewportApi 上，而 ViewportApi 由 ViewCamera 的 effect 晚一拍填上 → 登记移到 sceneRefs 对象表；⑦ 蒙皮网格射线拾取不可靠 → 角色用拾取图层上的不渲染胶囊代理；⑧ 看错 12 个角色的同名骨 → 取证桥按实体 id 限定子树。**Nomi 化决定**：把手按住即沿相机正对平面直接拖（不用先选再找 gizmo），已选中的把手才交给 gizmo 做轴向精调；动作片段叠加在静止姿态偏移之上（与参考产品一致：姿态页写 boneRotations、动作层在其下）；`shadows="percentage"`（three r184 已弃用 PCFSoft，每帧刷警告）。**2026-09-03 追加**：9 个 Mixamo FBX 动作已入库（`src/assets/director/pose`），动作库 / 姿态预设与参考产品逐条对应，套骨改成相对 bind 增量 + 骨盆跨系换算（见切换门文档 §8）。**未做 / 留到后期**：FK 滑条走查只看了渲染未逐轴量；姿态关键帧四元数 slerp 只量了手位置单调。门岗：typecheck / eslint / vitest（model 76 + 新增 fitClipAt 4 / signedDeg 2）/ i18n / filesize / tokens / boundaries / controls / heavy-path / vocabularies（结果见 S4 收口时的门岗记录）。 |
| S5 环境 | 全景球/Spark 泼溅+显现/连线引用/资产库上传与文件夹/导入场景 | J-D5「站在泼溅山谷里推轨有视差」。**2026-09-02 状态：已落地并走查通过**（Playwright 真机 + E2E 取证桥）——底部栏「导入 720 全景」选 2:1 图 → 校验 / 80MB 上限 / 非 2:1 软警告 → 先 object URL 上球预览、资产桥落盘换托管 url（devlab 无桌面运行时退回 data URL 并提示临时）→ 球体 1.8s 淡入、天空盖黑幕、图层检查器出「全景半径 / 旋转 / 清除」→ 资产库上传 40k 高斯的合成 PLY（山谷）→ 「泼溅场景」目录出条目 → 双击入场 → Spark SplatMesh 加载 → 随机 Magic|Spread 显现（×2 倍速，量到 3s 粒子散开、12s 归位）→ 自由相机 W 推轨：前景角色变大、山谷坡面位移小 = 视差成立 → 上传 x-bot.glb → 「用户上传」条目 kind=model → 双击入场 → ModelEntity 检测 mixamorig 骨骼自动升格 character（rig mixamo、isSystemModel false）→ 上传场景 JSON → 「导入场景」= 新图层（remapSceneIds 换 id）并激活 → 新建文件夹 / 行内重命名 / 移动到… / 删除文件夹（子项回上级）全部落工程并可撤销；连线引用目录（画布全景 / 资产节点）在 devlab 只验空态文案，节点侧接线走 DirectorNode → LinkedAssetsContext。走查修掉的根因：① 全景球 FrontSide + x 负缩放被 three 的翻面判定剔成一片黑 → 双面材质 + 关剔除；② 走查脚本点错同名按钮不是产品 bug（浮层不被列表裁切，已截图确认）。**Nomi 化决定**：资产库只存句柄（hosted url），文件夹树扁平 parentId；删文件夹不连坐删条目；上传的 Mixamo 角色与内置假人走同一条 CharacterEntity 管线（builtin:* → V1 X Bot，否则 modelPath，GLB/GLTF/FBX 各自 loader）；泼溅 / 用户模型检查器只留名称 + 变换；显现期间黑幕计数住 store 瞬态；Spark 只挂一个 SparkRenderer 在场景根。**未做 / 留到后期**：拖拽移动条目（用「移动到…」菜单替代）；Marble 内置示例场景（许可不明，目录改名「泼溅场景」放用户文件）；泼溅显现效果的显式选择（默认随机 Magic|Spread）；泼溅 / 模型在 Electron 真机的托管 url 加载（devlab 只能走 blob / data URL，重开后 blob 失效会 toast「加载失败」属预期）；Spark 与画中画 / 截图管线的关系留 S6 验证。新依赖：@sparkjsdev/spark 2.1.0（three ≥0.180，WASM 内联）。门岗：typecheck / eslint / vitest（model 83 + assetKinds 2 + splatReveal 5）/ i18n（登记 assets.kind 前缀）/ filesize / tokens / heavy-path / boundaries / vocabularies / controls。 |
| S6 产物 | 截图（裁/标签/落盘/发送画布）/MP4 帧步进+节目机位/产出物弹层 | 与参考产品同场景出片逐帧对照（黑场/切机位时刻）。**2026-09-02 状态：已落地并走查通过**（Playwright 真机）——Ctrl/⌘+Shift+P 截图：当前视角（POV 用该机位、否则视口相机）按导出画幅 / 分辨率（16:9·1080p → 1920×1080）离屏渲染、烧角色名牌、命名「机位·mm-截图N」/「自由漫游·全景-截图N」→ V1 资产桥落盘 → outputs.screenshots → toast；devlab 无桌面运行时退回本会话 blob URL 并明说未落盘（产物只存句柄，禁 base64 进工程）→ 时间轴头部「产出 N」弹层列缩略图 / 名称 / 机位，发送到画布（没接画布禁用并说明）/ 删除 → 「录制 MP4」：前置检查（无片段 / 无机位轨 → 明说原因）→ 逐帧 seek + 等两帧让求值与骨骼管线到位 → 节目机位按轨道顺序、无覆盖 = 黑场帧（相机不看任何图层 + 黑底）→ 头部按钮变「录制中 k / N 帧」可点取消（播放头恢复、toast 已取消）→ 帧 dataURL[] → V1 帧转视频桥 → outputs.videos；devlab 无桥 → toast「采到 N 帧但无法编码」。量到：13.1s 内容 393 帧、4.0s 内容 120 帧；1080p 每帧从 0.33s 优化到 0.18s（120 帧 21.6s）。「发送到画布」：DirectorNode 落成 Image / Video 节点（result.url = 资产句柄、meta.source='director'）放在节点右侧并连 reference 边。走查修掉的根因：① 每帧 0.33s——V1 captureScene 每帧新建渲染目标 + 同步 toDataURL，再烧标签还得解码重编 → V2 自己的 FrameRenderer（渲染目标 / 读回缓冲 / 画布按尺寸缓存，标签直接画在同一画布，toBlob 一次异步编码，dataURL 走 FileReader），隐藏集仍复用 V1 collectCaptureHiddenObjects；② V2 editor-only 对象同时打 V1 旗标，出片一律不进成片；③ 英文 locale 的 output 键一度插错块（reason 里）→ 修回 timeline 块，i18n 键对齐门岗绿。**Nomi 化决定**：像素在 scene/capture（R3F 侧登记进对象表，ViewportApi.captureFrame 转发），流程 / 命名 / 落盘 / 提示在 DOM 侧 useDirectorOutputs，产物动作经 OutputsContext 一份实例给头部按钮 / 弹层 / 快捷键共用；录制进度是 store 瞬态（不入工程不进撤销栈）；帧转视频仍走 V1 dataURL 契约（electron 侧 Blob 入口留到有真机压测数据再动）。**未做 / 留到后期**：参考产品逐帧对照（切机位 / 黑场时刻）要在 Electron 真机上跑 ffmpeg 桥后做；POV + 非 free 画幅按引导框裁切（现按导出画幅直接以机位 FOV 渲染，等价于引导框内的画面）；录制期间视口仍在实时渲染（可加「录制中」遮罩降负载）；4K 逐帧未压测。门岗：typecheck / eslint / vitest（model 89：exportSize 4）/ i18n（新增 timeline 产出键 + videoMeta）/ filesize / tokens / heavy-path（V2 零 toDataURL）/ boundaries / vocabularies / controls。 |
| S7 AI | 搭场景（结构化输出→几何）+ 画布图片选择器 | 固定 fixture 复现同一布局。**2026-09-03 状态：已落地并走查通过**（Playwright 真机 + 固定夹具）——底部栏 AI 簇「AI 搭场景」开关 → 浮条（描述框 Enter 提交 / Shift+Enter 换行 / 粘贴图片，参考图 ≤3：本地上传 / 从画布选，落点 当前图层 / 新图层，开始搭建 / 取消，状态行 + 秒表 + 流式字数）→ 描述「雨夜街角的咖啡馆…」→ 夹具「街角咖啡馆」（3 组 12 件）落成 总成组「街角咖啡馆」› 建筑组 / 街道设施 / 露天座位 › 12 几何体，天空色 #1f2937、地面透明度 0.35 写进图层，总成组被选中可整体移动；新图层落点 → 新建「新图层测试」并激活，3 组直接挂图层根（15 件）；两次都自动另存资产库「AI·{名}」场景条目（可再导入）；取消 → 不落场景、状态「已取消生成」（底层通道慢半拍也先给反馈）。真实通道：getTextBrain + runWorkbenchTextTaskStream（kind prompt_refine，提示词只回 JSON：米制 y 向上、地面 y=0、position 中心 / scale 尺寸 / rotation 度、2–6 组 ≤40 件），容错解析（剥 Markdown 围栏抓第一段 JSON + zod）、类型名 → 八种几何体（多出的映射最近似）、旋转弧度启发式（全部 |r| ≤ 2π 当弧度）；无文本大脑 → 明说去设置里配置。**Nomi 化决定**：纯层 model/aiScene（契约 / 解析 / 规整 / 提示词 / 夹具）+ storeAiSceneActions（物化一次撤销）+ useAiSceneBuilder（编排）+ panels/ai/AiSceneBar（UI）四层分开；画布图片经 CanvasImagesContext 注入（全画布 Image 节点，与连线引用区分）；参考图随请求 extras.referenceImages 传（当前文本通道未消费图片，提示词里注明张数——留给多模态通道接入时零改动）。**未做 / 留到后期**：真实 LLM 输出质量未压测（需桌面运行时 + 文本大脑）；参考图真正进模型要文本通道支持多模态；AI 场景与 agent「AI 来导」的合流（拆解 §7：把 block-out 当 create_staging_reference 的一个输出模式）留 S9 后评估。门岗：typecheck / eslint / vitest（model 97：aiScene 6 + materialize 2）/ i18n（新增 director.ai 块）/ filesize / tokens / heavy-path / boundaries / vocabularies / controls。 |
| S8 手机 | LAN 服务+页面+二维码+WS 包+写机位+远程录制；WebRTC 可选 | 用真机走查（用户资源）；模拟客户端单测。**2026-09-03 状态：接线已落地**——主进程 `electron/director/mobileBridgeIpc` 注册 `nomi:director:mobile:start/stop/status` + 事件推送（`assertTrustedSender`），证书缓存在 userData；preload / `DesktopBridge.director.mobile`；渲染层 `useMobileCamera` 收包写激活机位（未录制走 store，录制中 `ViewportApi.applyViewPose`，速度 2m/s·1.5m/s 持久 localStorage），远程 start/stop 调同一套运镜录制器；POV HUD「连接手机」接上；`MobileConnectDialog` 二维码（主进程 qrcode SVG，渲染层不 import 该 CJS 包）+ 复制链接 + 设备/延迟 + 三步证书指南 + 速度滑条 + 断开。**2026-09-03 走查通过（两段拼成全链路）**：① 手机侧——node 里起真桥（HTTP 模式 127.0.0.1:5188）+ Playwright 扮手机（844×390）打开页面：`已连接` → 摇杆前推 0.6s（量到 23 包 moveZ 0.83、30Hz）→ 升降 +0.6（7 包）→ 焦距 85（1 包后归零 = 「≤0 不改」协议）→ 复位横滚（1 包）→ 开始 / 停止录制（record start/stop 事件）→ 陀螺仪按钮走 requestPermission 异步后变「陀螺仪已开」→ ping/pong 延迟 0–23ms → 刷新页面出 disconnected + 新 connected；无令牌 / 错令牌握手被拒（单测）。② 桌面侧——devlab 注入假 `nomiDesktop.director.mobile`（同契约）：PiP「进入视角」→ HUD「连接手机」→ 对话框（三步指南 / 二维码 / 两个地址 chip / 复制 / 速度滑条）→ 设备 hello + pong → 「iPhone · Safari · 12 ms」、HUD 变「已连接 · 12 ms」→ 15 包前推 = 机位沿 yaw 270 走 0.99m（3.5→2.51）、dYaw +30 → 300、焦距 85 → fov 16.07 / HUD 85mm → 远程 record start：红点横幅 + 播放头推进，录制中 30 包 dYaw 2 进 applyViewPose → 停止后片段关键帧 yaw 270→330 单调 → 断开 → 重新开启 → Ctrl+Z 撤回看向清除。走查修掉的根因：① 机位设了「看向坐标」/ rig 时静止层 yaw 被求值层盖掉，手机转了机位纹丝不动 → 手机一转头就 `updateCamera({lookAtType:'none', lookAtObjectId, rigType:'none'})` + saveState + toast 一次；② 积分基准取静止层 → 在关键帧层上每包从静止值起算转不动 → 基准改为视口相机当前位姿（`getViewPose`，POV 下它跟随求值 / 关键帧 / 录制），fov 比较同源；③ 断开后对话框只剩两行「还没有手机连上」没有回头路 → 关闭态只留一句状态 + 「重新开启」，链接 / 复制 / 设备列表随服务隐藏（删掉无人用的 mobileNotRunning / mobileLater 键）；④ 设备名是 UA 原串 → 页面报「品类 · 浏览器」（iPhone · Safari）；⑤ 页面 `apple-mobile-web-app-capable` 已废弃警告 + favicon 404 → 补标准 meta + `data:` icon。**Nomi 化决定**：手机接管的是用户当下看到的画面（从求值位姿起算，不是从静止值），连续不跳；接管即关看向 / rig（可撤销）而不是两者打架。模拟客户端单测 2 + 包数学 7 全绿。门岗：typecheck（app + electron）/ eslint / vitest 106 / i18n（键对齐 5876）/ filesize / tokens / heavy-path / boundaries / vocabularies（登记 MobileBridgeEvent.state connected/disconnected）/ controls / lint:ci（82 warning，未增）全绿。**未做 / 留到真机**：WebRTC DataChannel（方案 S8 末可选）；真机扫码 + 自签名证书信任 + 陀螺仪授权（用户资源）；Electron 真机上的二维码 / 延迟 / 远程录制走查（IPC 层只过了 typecheck）。 |
| S9 收口 | 帮助/设置/快捷键/空态与提示/性能（≥45fps 三角色+泼溅）/R16 六条旅程/切换门方案文档 | 全门岗绿 + 你拍板切换门。**2026-09-03 状态：已落地并走查通过，切换门待你拍板**——① **H1 设置**：视口右下齿轮 → 漫游速度 / 方向键转速（内部 rad/s、显示 °/s）/ 旋转灵敏度 / 平移灵敏度 / 惯性阻尼各带恢复默认 + 分区重置，视口主题「深邃黑 / 中性灰」即时生效（红绿轴 + 灰网格），偏好只存本机 `localStorage nomi:director:preferences`（越界读回夹到范围），重载仍在；② **H2 帮助**：设置里「操作说明与快捷键」→ 四栏键位表（视口工具 / 视口操作 / 时间轴与轨道 / 视口漫游），键位从 `model/hotkeys` 实时 formatHotkey，鼠标手势与 WASD 固定 kbd；③ **空态**：全新工程三处（大纲「暂无实体」/ 时间轴「还没有轨道…」/ 画中画「还没有机位」）+ 产出 / 资产库 / 副轨 / 剪贴板既有空态；时间轴空态首版挂在按总时长铺宽的泳道容器里被推出视野 → 挂到滚动容器左上；删掉 S1/S2/S3/S4 四条过期占位文案与两条无人用的键；④ **性能**（Intel Iris Xe 核显、SwiftShader 未用、1036×449、dpr 1）：纯几何 47 fps、4 万高斯泼溅单独 36、3 角色 + 泼溅 36 / +描边 34 / +IK 33、15 角色 + 泼溅 32、15 角色无泼溅播放 33；泼溅是大头、描边只吃 2 fps → 不启用「描边改自发光」降级；**RTX 级 ≥45 未实测**（本机没有独显）；⑤ **R16 六条旅程** `tests/ux/director-j1…j6-*.walk.mjs`（统一启动器 `tests/ux/_directorLab.mjs`：复用在跑的 devlab 或自起 Vite，chromium headless，每次全新工程，E2E 取证桥量数值）：J-D1 三人场景（空态 → 三角色贴地 1.9m 一行 → 正面中景机位在主角前 2.9m → 主光 → 拖底面拉高出方块 → 大纲双击改名 → Ctrl+Z）/ J-D2 走到 B 身边（画线 6 路标 3.5s → 播放后 x −2.7 → 1.55，静止位不变）/ J-D3 三机位（POV HUD 29mm + 画幅框 → R 录 11 关键帧 → 退出 → 主角轨「创建特写片段」= 第四机位 + 4s 特写 → 播放画中画 LIVE）/ J-D4 跪下起身回头（动作库搜索双击「姿态·单膝跪」「姿态·站立」0–3–5s → 视线片段目标=摄像机 → 片尾头朝机位 cos 0.88 → IK 拖右手把手写进 RightForeArm/RightArm）/ J-D5 泼溅山谷（上传 1.5 万高斯 PLY → toast「临时」→ 双击入场 Spark 网格挂树 → 角色入谷 → D 横移近处 37px 远处 9px = 视差）/ J-D6 出片（Ctrl+Shift+P → 「自由漫游·全景-截图1」只存句柄 + 「未落盘」明说 → 产出弹层、发送到画布禁用并说明 → 无片段录 MP4 明说 → 进机位录运镜 → 录 MP4 逐帧 114 帧 → 「无法编码 MP4（开发入口）」诚实降级、videos 仍空）；九张截图人眼核过。走查修掉的根因 / 坑：本机 Playwright 没装 Chromium → `playwright install chromium`（启动器有系统 Chrome 兜底）；两个 Vite 实例共用 `.tmp/vite` 依赖缓存互相触发重预打包 → 启动器优先复用在跑的 devlab（按正文含 devlab 入口脚本判定，HEAD 对 Vite 永远 200）；全新 Vite + headless 首屏实测 317s → 自起路径上限 8 分钟；子串匹配「视线片段」撞上「删除视线片段」；时间轴 / 大纲行都是 `div.group` → 定位限定到 testid；手机桥单测的私有 waitFor 改成事件收件箱（R18）。⑥ **切换门方案** [2026-09-03-director-cutover-gate.md](2026-09-03-director-cutover-gate.md)：切 vs 养一期的取舍、切前必补 G1–G5、同一 PR 删旧步骤，待你拍板。门岗：typecheck（app + electron）/ eslint / vitest 108（director 106 + electron/director 2）/ lint:ci（82 warning 未增）/ i18n（5936 键对齐）/ filesize / tokens / heavy-path / boundaries / controls / walkthroughs / test-waits / docs-index 全绿；**check:vocabularies 红**——原因是 origin/main 14:27 合入 #395 删了一条历史词表债（AssistantTimeline StepTone），我们这份基线还是旧 main 的，门岗把 78>77 判成回归；不是本分支的改动，整合 origin/main 后自然消失。**未做 / 留到切换门**：Electron 真机走查（资产落盘 / ffmpeg / 发送到画布连边 / 手机扫码）；RTX 级性能实测；V1 独有能力盘点（G4）。 |
| S10 切换门 | 按 [2026-09-03-director-cutover-gate.md](2026-09-03-director-cutover-gate.md) §7 C1–C8：V1 纯函数入籍、`migration/` 迁移器、`agent/` AI 来导 + 离屏出片器 + 两个常驻 Host、registry 上架、删 `nodes/scene3d/**` 与全部 V1 devlab / 走查 / i18n、文档、Electron 真机走查 | 用户 2026-09-03 拍板「切」。**2026-09-03 状态：C1–C8 全部完成（细节、门岗与测试清单见切换门文档 §8 / §8.1）；V1 `nodes/scene3d` 已从工作区删除，全部未提交。** |

## 8. 风险与需要用户的资源

- **资产许可**：参考产品的 FBX/GLB/SPZ 不能搬。女人 = 现有 X Bot；男人 = UE 人偶（已拍板）或你从 Mixamo 下载 Y Bot 放入 `assets/`；9 个动作 FBX 需从 Mixamo 下载（清单：Standing Idle / Kneeling Down / Kneeling / Standing Up / Standard Walk / Running / Male Sitting Pose ×2 / Kneeling Idle），我提供转 GLB 与入库脚本；示例泼溅场景需自备 .spz/.ply。
- **Spark 在 Electron/Vite 下的 WASM 加载**：S5 第一天验证；失败则回退 drei `<Splat>`（仅 .splat）并转换 .spz。
- **性能**：OutlinePass + 泼溅 + IK 三角色目标 ≥45fps（RTX 级）；不达标降级：描边改自发光。
- **手机陀螺仪权限**：iOS 需 HTTPS + 用户手势授权；自签名证书要在手机上点信任——对话框指南写清。
- **R3F 8 与 Spark**：官方示例基于 fiber 9 `extend` 返回组件；fiber 8 用目录式 `extend`，JSX 标签 `sparkRenderer/splatMesh` 需声明 JSX 类型。

## 9. 追溯矩阵（清单 → 规格）— 「再检查」结果

| 清单条目 | 规格 ID | 备注（再检查新增/修正）|
|---|---|---|
| §0 打开/布局/退出 | O1–O5 | 新增：分栏位置持久、Esc 双击退出（Nomi 化）|
| §1 顶部工具条 8 项 | T1–T7 | 新增 T7 模式提示条（落实「隐藏手势必须有可见说明」）|
| §2.1 导航 + 视图立方 + F | V1 | — |
| §2.2 创建栏 4 类 | V4a–d | 男人模型资源见 §8 |
| §2.3 底部栏 9 项 | V5 | 分 5 簇 |
| §2.4 叠加层 | V6 | — |
| §2.5 画中画 | V7 | — |
| §2.6 AI 浮条 | V8 + 5.8 | 新增：粘贴图片、Enter/Shift+Enter |
| §3.1 场景对象 | S1 | 新增：双击=重命名（核实）、列表拖选范围（核实）|
| §3.2 资产库 | S2–S3 | 「Marble 场景」改「泼溅场景」；导入场景=载入库内 JSON |
| §4.1–4.9 检查器 | I1–I13 | 新增：每字段重置、数字字段滚轮微调、编辑模式提示 |
| §5.1 头部 | L1 | — |
| §5.2 轨道 | L2–L4 | 新增：折叠轨道（store 有 fold）、Shift 批量选路标 |
| §5.3 动作弹窗 | L6 | — |
| §5.4 快捷键 | L7 + hotkeys.ts | 键位表已核对默认值（含 Cmd+G/Cmd+Shift+G 硬编码）|
| §6 机位/录制/手机 | C1–C5 | 新增：双击机位进 POV（Nomi 化）|
| §7 产物 | P1–P2 | 录像改帧步进（决策）|
| §8 偏好/帮助 | H1–H2 | — |
| 清单外·视口点选细节 | V2 | 点击位移 ≤5px、锁定/隐藏不可拾取（核实）|
| 清单外·store 能力 | S1/L2 | `moveLightToScene`、`toggleTimelineTrackFold`、`bulkToggle*` 均有 UI 入口对应 |

未收录（有意）：参考产品全局快捷键自定义编辑器（app 级）、World 节点、`dummyLabelNumbering`（store 有字段但页面无入口，参考产品自己也没接 UI）。

## 10. 下一步

1. 你看这份方案 + §0.1 覆盖表，逐条否或放行。
2. 我出 V2 整屏样张（HTML，Nomi token，五区域 + 关键弹层），你拍板（R8）。
3. 样张之前先做 S0 的纯层与 store（不可见），带单测。
