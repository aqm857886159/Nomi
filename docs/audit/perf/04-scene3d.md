# Scene3D / 运镜轨迹 — three.js / r3f 性能审计（04）

> 范围：`src/workbench/generationCanvas/nodes/scene3d/`（3D 导演台全屏编辑器 + 运镜轨迹）。只读审计，未改源码。
> 审计日期：2026-06-22。逐条落到 `file:line`。

## 顶部结论（3D 卡顿/耗电的根因）

1. **主全屏编辑器 Canvas 是 `frameloop="always"`（默认值，未声明）** —— `Scene3DFullscreen.tsx:671` 的 `<Canvas>` 没有 `frameloop` prop，r3f 默认每帧无条件重绘整个 3D 场景，即使场景完全静止、用户没动鼠标。这是「风扇狂转/笔记本烫/续航差」的**第一根因**。对照组：小相机预览 Canvas（`scene3dCameraPreview.tsx:188`）**正确**用了 `frameloop="demand"`——所以这是主编辑器漏配，不是不会配。

2. **拖轨迹点时每个 move tick 重建曲线 + TubeGeometry** —— 拖点 → `onUpdatePoint` 改 trajectory state（`TrajectoryPointControls.tsx:222`）→ React 重渲染 `TrajectoryLineView`，其中 `trajectoryLinePoints`（`trajectoryUtils.ts:86`，新建 `CatmullRomCurve3`+`getPoints(SEGMENTS)`）和 `TrajectoryHitTube` 的 `createTrajectoryTubeGeometry`（`trajectoryUtils.ts:101`，`new THREE.TubeGeometry`，分段 64–512）都 memo 在**整个 trajectory 对象**上，每次拖动都失效重算。这是「拖轨迹卡顿」的**第二根因**。

3. **运镜回放 useFrame 每帧重建曲线 + 大量 Vector3 克隆** —— `useTrajectoryAnimation.ts:42` 的 useFrame 对每条 active binding 调 `buildTrajectoryCurve`（`:59`，每帧 new CatmullRomCurve3 + updateArcLengths），并对每个绑定对象做 `curve.getPointAt`/`getTangentAt`/`object.position.clone()`/`tangent.normalize()`（`:89-99`）。多对象 + 多绑定时每帧 GC 压力陡增，叠加根因 1（always）即使没回放也持续。

**两点明确确认：**
- ① **frameloop：主编辑器是 `always`（漏配，应为 demand）**；只有小相机预览是 `demand`。
- ② **常驻离屏 GPU 渲染：没有常驻在跑。** `StagingCaptureHost` / `CameraMoveCaptureHost`（`GenerationCanvas.tsx:491-492` 常驻挂载）在没有待处理 meta 标志时**都 `return null`**（`StagingCaptureHost.tsx:102`、`CameraMoveCaptureHost.tsx:183`），不创建 Canvas、不占 GPU。只有 AI 工具触发出图/运镜小片那几秒才短暂拉起一个隐藏 Canvas，完成即卸载。memory 里「挂节点里永不触发」说的是它们的**触发机制**（抽成常驻 Host 以避开画布剔除），不是「常驻渲染」。captureScene 的 WebGLRenderTarget 也正确 `dispose()`（`scene3dMath.ts:417`）。

---

## 发现表

| 发现 | file:line | 机制 | 症状 | 严重度 | 修复方向 | 实测验证法 |
|---|---|---|---|---|---|---|
| 主编辑器 Canvas frameloop 未声明=always | `Scene3DFullscreen.tsx:671` | r3f 默认每帧重绘，场景静止也满帧 GPU | 进 3D 后风扇狂转/烫/耗电，静止不动也是 | **P0** | 改 `frameloop="demand"`，并在 OrbitControls/拖拽/回放/输入处 `invalidate()`；回放期临时切回 always 或用 `useFrame`+invalidate 驱动 | 进 3D 静止 30s，看 GPU 占用/帧率（Stats）应趋近 0；对照改前满帧 |
| 回放 useFrame 每帧重建曲线 | `useTrajectoryAnimation.ts:59` `buildTrajectoryCurve` | 每帧 per-binding `new CatmullRomCurve3`+`updateArcLengths` | 回放/多对象绑定时掉帧、GC 抖动 | **P0** | 把 curve 缓存进 runtime store（按 trajectory 版本号失效），useFrame 只读不建 | 绑 5+ 对象回放，Performance 录制看每帧 GC 与 curve 构造调用数 |
| 拖点重建 line+TubeGeometry | `trajectoryUtils.ts:86,101` + `TrajectoryRenderer.tsx:194-198` | memo key=整个 trajectory，拖动每 16ms 失效→new TubeGeometry(64–512 seg)+getPoints | 拖轨迹点/整条拖动时卡、掉帧 | **P1** | memo key 细化到 points/closed/tension/curveControls 的稳定签名；拖动期降采样 tube 段数或拖动时只更新 Line 不重建 Tube（hit-tube 拖完再建） | 拖一条 8 点轨迹，Performance 看每 move 是否进 TubeGeometry 构造 |
| 每个角色标签各挂一个 useFrame 做 billboard | `scene3dObjects.tsx:334` (`MannequinRoleLabel`) | 每标签每帧 `quaternion.copy(camera)`；人群标签 = N 个 useFrame | 人多/人群时 useFrame 数量线性涨，叠加 always 放大 | **P1** | 用 drei `<Billboard>` 或单一 useFrame 批量对齐；或非朝向相机时跳过；切 demand 后此项随之大幅缓解 | 放 mannequinCrowd(20+)，看 useFrame 注册数与每帧耗时 |
| useFrame 里临时 new THREE.Euler | `scene3dViewControllers.tsx`（fly 控制器 lerp 路径附近 `:104` 等）+ `useTrajectoryAnimation.ts:99` `.clone()` | 自由飞/回放期每帧分配 Euler/Vector3 | 飞行/回放期 GC 毛刺 | **P2** | 提到 ref 复用（fly 控制器主路径已用 ref 池，个别分支漏；回放 `lookAt` 目标点用复用临时向量） | 自由飞 10s，Performance 看 minor GC 频率 |
| 离屏捕获 Canvas 也是 always | `Scene3DAutoCapture.tsx:79`、`Scene3DTrajectoryCapture.tsx:163` | 捕获期隐藏 Canvas 满帧渲染直到第 8 帧/采完才卸载 | 出图/运镜小片那几秒额外 GPU；多次连发叠加 | **P2** | 捕获 Canvas 用 `frameloop="always"` 是合理的（要稳定帧触发），但可在 fire 后立即卸载/限帧；当前 autocapture 第 8 帧 fire 后到卸载前仍满帧 | 触发 create_staging_reference，看隐藏 Canvas 存活时长与 GPU 尖峰 |
| TransformControls 常驻（drei）多实例 | `scene3dSceneView.tsx:4`、`TrajectoryPointControls.tsx:2` | 选中对象/点挂 TransformControls，自身有内部 useFrame/事件 | 多选/多点编辑时叠加帧成本 | **P3** | 仅给当前选中项渲染 TransformControls（看代码已是按 selected 条件，确认无泄漏即可） | 选/取消选多个对象，看 TransformControls 实例数与 helper 残留 |

---

## 复用/正确做法（已做对的，别误改）

- 人群 ≥ `CROWD_DETAILED_MODEL_LIMIT` 走 **InstancedMesh**（`scene3dObjects.tsx:237`），matrix/color 在 `useLayoutEffect` 里一次性写、`needsUpdate`，没在 useFrame 里逐帧 setMatrixAt —— 这是对的。
- InstancedMeshBatch 的 Matrix4/Vector3/Quaternion/Color 都 `useMemo` 复用（`scene3dObjects.tsx:205-209`），未在循环里 new。
- `CameraStateRecorder`（`CameraStateRecorder.tsx:26`）做了**每帧脏判断**，相机静止时零分配零回调——好。但它仍是 useFrame，frameloop=always 下每帧仍跑（虽轻量）；切 demand 后才真正省。
- captureScene 正确 `renderTarget.dispose()` + 恢复 previousRenderTarget（`scene3dMath.ts:413-417`）。
- 小相机预览 Canvas `frameloop="demand"` + dpr 上限 1.5（`scene3dCameraPreview.tsx:187-188`）——主编辑器应抄这套。
- TrajectoryTimeline 是纯 DOM/HTML（不在 `<Canvas>` 内，`TrajectoryTimeline.tsx`），拖时间轴**不会**重挂载 3D 场景——点 6 的反模式不存在。
- TrajectoryHitTube 的 geometry 在卸载时 `dispose()`（`TrajectoryRenderer.tsx:200-202`）——无泄漏，但每次拖动重建（见发现表 P1）。

---

## 建议真机实测项（额度默认授权，直接跑）

1. **静止耗电基准**：进 3D 全屏，放一个有 mannequin 的场景，**完全不操作 30s**，开 r3f `<Stats>` 或浏览器 Performance，记 GPU 占用与帧率。改 `frameloop="demand"` 前后对照——预期静止从满帧（~60fps 持续绘制）降到接近 0 draw。这一项最能验根因 1。
2. **拖轨迹卡顿**：建一条 8–10 点轨迹，开 Performance 录制，连续拖一个控制点 3s，看 timeline 里是否每个 pointermove 都进 `TubeGeometry` 构造 + `getPoints`，统计每帧耗时与 long task。
3. **回放掉帧**：绑 5+ 对象到一条轨迹回放，录 Performance，看 `buildTrajectoryCurve` 每帧调用数 + minor GC 频率（验根因 3）。
4. **人群标签**：放一个 20+ 的 mannequinCrowd，数活跃 useFrame 回调数（root 来自 MannequinRoleLabel billboard），看每帧 CPU。
5. **离屏捕获尖峰**：连续触发 2–3 次 create_staging_reference / 运镜小片，监控隐藏 Canvas 的存活时长与 GPU 尖峰，确认 fire 后及时卸载、无叠加常驻。
6. **进/退 3D 内存**：反复进退全屏编辑器 10 次，看 `gl.info.memory`（geometries/textures）是否单调增长（Mannequin GLTF `cloneSkeleton` + tube geometry 的 dispose 完整性）。

> 优先级落地顺序建议：根因 1（frameloop demand，一行改 + invalidate 接线，收益最大）→ 根因 3（回放 curve 缓存）→ P1（拖点 geometry memo 细化 / 拖动期 Line-only）。
