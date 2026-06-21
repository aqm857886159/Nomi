# 3D 导演台轨迹系统方案

> 状态：实现中
> 日期：2026-06-04

## 需求

在 3D 导演台中支持可视化轨迹编辑，模型可绑定轨迹并随场景内部时间轴播放。

## 技术选型（已确认）

| 项        | 决策                                                     |
| --------- | -------------------------------------------------------- |
| 曲线类型  | `THREE.CatmullRomCurve3`（过每个控制点，直觉=拍摄轨道）  |
| 到终点后  | 停止                                                     |
| 编辑 UI   | 视口内直接拖拽控制点                                     |
| 绑定关系  | 一轨迹绑多模型（一对多）                                 |
| 时间驱动  | 3D 场景内部自定义时间轴，与外部 `TimelineState` 完全解耦 |
| 时间轴 UI | 视口底部横条，仅在"轨迹模式"激活时显示                   |

---

## 数据结构新增（scene3dTypes.ts）

```ts
type Scene3DTrajectoryPoint = {
    id: string;
    position: Scene3DVector3;
};

type Scene3DTrajectory = {
    id: string;
    name: string;
    points: Scene3DTrajectoryPoint[]; // ≥ 2 个
    tension: number; // CatmullRom tension，默认 0.5
    closed: boolean;
    color: string;
};

type Scene3DTrajectoryBoundObject = {
    objectId: string; // 只支持 Scene3DObject.id，MVP 不绑相机
    offsetRatio: number; // 相位差，值域 (-1, 1)：正=领先（t 更大），负=滞后（t 更小）；超出此范围 open 曲线端点汇聚语义失效，UI 层应拦截
};

type Scene3DTrajectoryBinding = {
    id: string;
    trajectoryId: string;
    objects: Scene3DTrajectoryBoundObject[]; // 一对多，每个对象独立 offsetRatio
    startTime: number; // 秒，在场景时间轴上开始
    endTime: number; // 秒，到达终点（区间长度 = 速度控制）
    direction: "forward" | "reverse";
};
```

`Scene3DState` 新增字段：

```ts
trajectories: Scene3DTrajectory[]
trajectoryBindings: Scene3DTrajectoryBinding[]
sceneTimeline: {
  totalDuration: number    // 持久化，默认值 10（秒），最小值 > 0（防止全 closed 场景第一帧立即触发停止）
  // playheadSeconds: 不持久化，存 zustand 非持久化切片
  // isPlaying: 不持久化，由挂载 useTrajectoryAnimation 的父组件以 useState 持有
}
```

---

## 运行时动画逻辑

每帧在 `useFrame((state, delta) => {...})` 执行（不用 AnimationMixer，用 `delta` 推进时间，帧率无关）：

```
// 自动播放时推进时钟（delta 单位：秒）
if (isPlayingRef.current) playheadRef.current += delta

// 从 playheadRef 读取当前播放头
playheadSeconds = playheadRef.current

// 每帧从 getState() 读取，不缓存闭包（防止增删 binding 时遍历旧列表）
对每个 binding（来自 getState().trajectoryBindings）：
  duration = endTime - startTime
  if duration ≤ 0: 跳过（防除零，UI 层应禁止 endTime ≤ startTime 配置；跳过时 visible 状态保持不变）
  // closed 曲线在 startTime 前不可见（需遍历所有 boundObjects 才能设 visible）
  if closed && playheadSeconds < startTime:
    对每个 boundObject: object.visible = false
    continue
  raw = (playheadSeconds - startTime) / duration
  open 曲线：  t_base = clamp(raw, 0, 1)
  closed 曲线：t_base = ((raw % 1.0) + 1.0) % 1.0   // 不 clamp，直接取模实现循环
  direction=reverse → t_base = 1 - t_base
  对每个 boundObject：
    // offsetRatio 语义：沿当前播放方向领先（正）/滞后（负）
    // reverse 已翻转 t_base，需取反 offsetRatio 使方向感一致
    effective_offset = direction=reverse ? -offsetRatio_i : offsetRatio_i
    open：  t_i = clamp(t_base + effective_offset, 0, 1)
    closed：t_i = ((t_base + effective_offset) % 1.0 + 1.0) % 1.0
    // 注：上式值域为 [0,1)，t_i 不会 >= 1.0，下行为保险防卫（实际不触发，可理解为文档意图说明）
    // 若 closed 且 t_i >= 1.0：t_i = 0.0（在浮点极端情况下保留此守卫）
    object.visible = true  // 复位：适用于所有曲线（closed < startTime 曾设 false，open 曲线从不 continue 也走到此行）；勿删除
    curve.getPointAt(t_i) → object.position
    // 防切线零向量（端点处可能返回零向量导致 lookAt NaN）
    tangent = curve.getTangentAt(t_i)
    若 tangent.lengthSq() >= 1e-10：object.lookAt(object.position.clone().add(tangent.normalize()))
    // 否则跳过 lookAt，复用上一帧姿态（注意：Three.js Vector3 不支持 + 运算符，必须用 .clone().add()）
```

- `playheadSeconds < startTime`：
    - open forward → t=0（曲线起点），open reverse → t=1（曲线末端）；**物体可见，停驻在起始等待位置**（设计决策：进场前可见，用户可看到待机位置）
    - closed：`object.visible = false`，跳过（进入正常播放范围后先算位置再设 `visible=true`）
- `playheadSeconds > endTime`：open 曲线停在运动终点——`direction=forward` → `getPointAt(1)`（曲线末端），`direction=reverse` → `getPointAt(0)`（曲线起点）；closed 曲线 `visible=true`，继续循环（raw 取模）
- 停止条件：
    - 有 open binding：`playheadSeconds >= max(open binding 的 endTime)` 时 `isPlaying = false`
    - 全部为 closed binding：`playheadSeconds >= sceneTimeline.totalDuration` 时 `isPlaying = false`
    - **混合场景（open + closed 共存）**：以 `max(open endTimes)` 为停止阈值；停止时 closed 物体冻结在停止触发帧的当前循环位置（不是曲线终点，是 runtime 停止推进时的任意循环帧，位置不跳变）
    - **实现骨架**：`const openEndTimes = bindings.filter(b => !isClosed(b)).map(b => b.endTime); const stopAt = openEndTimes.length > 0 ? Math.max(...openEndTimes) : totalDuration;`——**禁止直接 `Math.max(...[])` 空数组**（返回 `-Infinity`，全 closed 场景第一帧即触发停止）
    - **停止时 `playheadRef.current` 保留当前值（不截断、不归零）**；下次播放从当前位置继续，归零须显式调用归零 handler
    - **停止竞态处理**：停止条件触发时，hook 内部立即同步设 `isPlayingRef.current = false`，再调用 `setIsPlaying(false)`，防止下一帧开头再多累加一个 delta
    - open 曲线 offsetRatio 较大时多物体会在端点汇聚（clamp 行为），属预期表现
- `reverse` 不影响停止判断，播放头始终向前，reverse 只翻转 t 值
- `endTime - startTime ≤ 0` 时跳过该 binding（防除零）

**状态更新约定**：`useFrame` 内用 `useRef` 维护内部时钟（`playheadRef.current`），**初始化时同步 zustand 当前值**（`useRef(getState().playheadSeconds ?? 0)`），勿硬编码 0，否则从序列化恢复时 UI 显示与动画不一致。自动播放时每 **2 帧**将 `playheadRef.current` 写回 zustand 的 `playheadSeconds` 非持久化切片（约 30ms @ 60fps），供 `TrajectoryTimeline` UI 订阅显示。不使用本地 `useState` 存储播放头——UI 统一订阅 zustand 切片。

- **2帧节流是有意的精度-性能权衡**：TrajectoryTimeline 拖拽手柄最多有 1 帧视觉滞后（~16ms），可接受；避免每帧触发 re-render。维护者不应将此滞后视为 bug。
- 每2帧 setState 会被 React 18 自动 batch（`createRoot` 对所有上下文含 rAF 均启用），不触发同步 re-render；TrajectoryTimeline 渲染应保持轻量（仅更新播放头位置，无重布局）。
- 停止时 playheadRef.current 不递增，写回值与上次相同，zustand 的 number 相同值比较（`Object.is`）不触发订阅，无冗余 re-render。

**isPlaying stale closure 处理**：用 `isPlayingRef` 跟踪最新值，在 state 变化时同步写 ref：

```ts
const isPlayingRef = useRef(isPlaying);
useEffect(() => {
    isPlayingRef.current = isPlaying;
}, [isPlaying]);
// useFrame 内读 isPlayingRef.current，不直接读 isPlaying
```

**trajectoryBindings stale closure**：`useFrame` 内的停止判断需读取 `trajectoryBindings`（求 max open endTime）。不得用闭包捕获，必须用 `getState().trajectoryBindings` 命令式读取，确保播放中增删 binding 时停止阈值实时更新。

**播放头拖拽 → ref 同步**：拖拽 handler 同时写 zustand 非持久化切片 **和** `playheadRef.current`，确保下一帧从正确位置继续递增，不产生跳变。

**归零**：归零 handler 必须同时执行 `playheadRef.current = 0` 和 `useStore.setState({ playheadSeconds: 0 })`，仅写 zustand 不够（useFrame 以 ref 为时钟源）。

---

## 编辑 UI

### 视口内控制点

- 控制点渲染为小球（`<Sphere r=0.15>`），仅"轨迹编辑模式"下显示
- 拖拽用 R3F 原生 pointer events（`onPointerDown/Move/Up`）。**XZ 平面投影**：不能直接用 `event.point`（命中控制点球面，Y≠0），需对 `y=0` 的不可见水平面做 raycaster 投影——在 `onPointerMove` 中用 `raycaster.ray.intersectPlane(xzPlane, targetVec)` 得到 XZ 坐标，其中 `xzPlane = new THREE.Plane(new THREE.Vector3(0,1,0), 0)`。
  **`event.point` 须立即 `.clone()` 或解构 `{x, z}`**（节流延迟后直接读可能拿到旧值）
  **不使用 `@use-gesture/react`**（DOM 手势层与 R3F pointer 系统冲突）
  `@use-gesture/react` 仅用于 Canvas 外的 DOM 元素（如时间轴播放头）
- **Pointer capture**：`onPointerDown` 调用 `event.nativeEvent.target.setPointerCapture(event.nativeEvent.pointerId)`，
  `onPointerUp` 调用 `event.nativeEvent.target.releasePointerCapture(event.nativeEvent.pointerId)`，
  防止鼠标快速移动离开 mesh 时丢失 pointermove 事件
- Y 轴不可拖拽，在属性面板输入数值修改
- 进入轨迹编辑模式时禁用 `TransformControls`，退出时恢复

### 新增控制点（面板追加 + 双击插入）

- 侧边面板"新建轨迹"按钮 → 生成带 2 个默认控制点的轨迹
- 侧边面板"追加点"按钮 → 在轨迹末尾追加一个点
- 双击轨迹线 → 在点击最近处插入新控制点
  **命中检测**：`<Line>`（drei）无 mesh 无法被 raycaster 命中，需加一条不可见的
  `TubeGeometry` mesh（`visible={false}`，半径 `0.12` 世界单位，`tubularSegments = Math.min(Math.max(64, points.length * 8), 512)`）作为命中区，响应 `onDoubleClick`。
  **插入 t 值计算**：用 `curve.getSpacedPoints(200)` 做弧长均匀采样（返回 **201** 个点，索引 0~200），找离 `event.point` 最近的采样点索引 `i`（clamp i to 0~199，避免 closed 曲线 `getUtoTmapping(1.0)` 边界问题），先调用 `curve.updateArcLengths()` 确保弧长缓存已初始化，再通过 `curve.getUtoTmapping(i / 200)` 得到曲线参数 t。**插入位置反推**：将 t 与相邻控制点对应的参数区间比较——`closed=false` 时 N 个控制点共 N-1 段，第 k 段参数范围约为 `[k/(N-1), (k+1)/(N-1)]`（k=0..N-2）；`closed=true` 时 N 段，第 k 段范围约为 `[k/N, (k+1)/N]`；找到 t 所在段 k，将新控制点插入 `points[k+1]`。TubeGeometry 内部用等 t（非弧长均匀）采样，与弧长均匀采样在高曲率区域有额外坐标偏差，视觉定位已足够（非精确解，接受此误差）。
  **事件冒泡**：控制点 Sphere 的 `onDoubleClick` 里调用 `event.stopPropagation()`，
  避免控制点区域的双击穿透到管 mesh 触发插入逻辑。
  **TubeGeometry 重建策略**：控制点拖拽时（`onPointerMove` 节流 16ms）重建曲线并更新 geometry。顺序：**先** `mesh.geometry = newGeometry`，**再** `geometryRef.current?.dispose()`，**最后** `geometryRef.current = newGeometry`——先换再 dispose，消除节流延迟期间 useFrame 访问已 dispose geometry 的窗口期；不在 useFrame 每帧重建。
  **弧长缓存**：每次控制点变更（插入/删除/拖拽）后必须调用 `curve.updateArcLengths()`，
  否则 `getPointAt`/`getTangentAt` 的弧长参数化结果错误（物体位置和朝向偏移）。
- 删除控制点：points < 2 时禁用删除按钮（不允许少于 2 点）

### 轨迹线

- `<Line>` (drei)，`points = curve.getPoints(N)`（N 值自定，推荐 64）；closed 曲线去掉 `getPoints(N)` 返回数组的最后一个点（该点与首点重合），再传 `closed` prop——**不能同时保留重复末点 + 传 `closed` prop**，否则末段被画两遍。两种曲线可用相同 N。**`closed` 变更时 points 数组和 `closed` prop 均需重新计算**（派生自 `trajectory.closed`，不可缓存静态值）。
- `depthTest={false}`，`renderOrder={1}`，颜色来自 `trajectory.color`

### 底部时间轴横条（按需显示）

- 触发显示：激活任意轨迹 / 进入轨迹编辑模式
- 触发隐藏：退出轨迹模式、关闭按钮
- 内容：总时长标尺、可拖动播放头、各 binding 的彩色区间条（类 Blender NLA）
- 播放头拖拽换算：`playheadSeconds = clamp((pointerX - containerLeft) / containerWidth, 0, 1) * totalDuration`（`pointerX - containerLeft` 为距容器左边缘的绝对 px 偏移，需用 `containerRef.getBoundingClientRect()` 获取 `containerLeft` 和 `containerWidth`；clamp 防止拖出边界超出 `[0, totalDuration]`），拖拽 handler 同时写 `playheadRef.current` 和 zustand `playheadSeconds`
- 播放 / 暂停 / 归零按钮

### 侧边属性面板

- 轨迹列表（新建 / 删除 / 重命名）
- 选中轨迹：tension、color、closed
- binding 列表：绑定对象、startTime / endTime / direction / offsetRatio

---

## 实现分层（不动什么）

### 新增文件（轨迹模块，不塞进 Scene3DFullscreen.tsx）

| 文件                                           | 职责                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `scene3d/trajectory/trajectoryUtils.ts`        | CatmullRomCurve3 构建（含 `Scene3DVector3[] → THREE.Vector3[]` 转换）、getPointAt/getTangentAt 计算工具；`buildCurve` 函数需 guard `points.length < 2` 时返回 null（否则 `getPointAt` 返回 NaN，物体静默消失）；**所有下游消费者（TrajectoryRenderer、useTrajectoryAnimation、双击命中检测）拿到 null curve 时必须跳过该 binding/不渲染对应 Line 与 TubeGeometry**；`tubularSegments = Math.min(Math.max(64, points.length * 8), 512)`（加上限防止超长轨迹顶点爆炸） |
| `scene3d/trajectory/TrajectoryRenderer.tsx`    | `<Line>` + 控制点小球静态渲染                                                                           |
| `scene3d/trajectory/useTrajectoryAnimation.ts` | useFrame 动画逻辑 hook                                                                                  |
| `scene3d/trajectory/TrajectoryTimeline.tsx`    | 底部时间轴横条 UI                                                                                       |

**状态传入方式**：

- `playheadRef`（`useRef<number>`）在 `useTrajectoryAnimation` 内维护帧级时钟，**不在 useFrame 内调用 React setState**（避免每帧 re-render）；`playheadRef` 作为 hook 返回值之一，由父组件持有并以 prop 传给 `TrajectoryTimeline`（让拖拽 handler 能直接写 ref）
- 自动播放时每 2 帧将 `playheadRef.current` 写回 zustand `playheadSeconds` 切片（约 30ms @ 60fps）
- `isPlaying`（`useState`）本地 React state，由挂载 `useTrajectoryAnimation` 的父组件持有；`useTrajectoryAnimation` 接收 `isPlaying` 和 `setIsPlaying` 作为参数（hook 不自建 state）。停止条件触发时，hook 内部调用传入的 `setIsPlaying(false)`。
- 播放头拖拽 handler 同时写 zustand `playheadSeconds` 切片 **和** `playheadRef.current`
- `totalDuration` 来自持久化的 `sceneTimeline.totalDuration`
- **TrajectoryTimeline 数据流**：Canvas 外 DOM 组件，组件内部拆分为两类订阅：
    - 区间条/颜色（低频变化）：`useStore(s => s.trajectoryBindings, shallow)` + `useStore(s => s.trajectories, shallow)`，不随播放头变化重渲
    - 播放头 DOM 元素（高频）：单独订阅 `playheadSeconds`，用 `subscribeWithSelector` 或节流（接受每2帧一次 re-render，约30Hz）；**不在包含区间条的父组件裸订阅 `playheadSeconds`**（会导致整个时间轴组件随播放头每2帧全量重渲）
- **objectId → Object3D 映射**（Chunk D 实现前必须落地）：维护一个全局 `Map<objectId, React.RefObject<THREE.Object3D>>`，存入专用 zustand 切片（非持久化）。**初始化**：store 初始化时 `new Map()` 一次，此后只允许 `.set()` / `.delete()` mutate，**禁止 `setState({ objectRefMap: new Map(...) })` 重建实例**（重建后命令式读取拿到旧引用，静默失效）。注册/注销时**直接 mutate**，不走 `setState`；**禁止任何 React 组件通过 `useStore` 订阅此 Map**，只允许命令式 `getState().objectRefMap.get(id)` 读取（在 useFrame 里）。**注册时机**：每个 Scene3DObject mesh 组件在 `useEffect` 挂载时注册、卸载时注销。若 `getState().objectRefMap.get(id)` 返回 `undefined`（对象未挂载/尚未注册），useFrame 本帧静默跳过该 binding，等下帧再读。

### 改动范围

| 层                       | 改动                                                                |
| ------------------------ | ------------------------------------------------------------------- |
| `scene3dTypes.ts`        | 新增类型（含 `sceneTimeline` 只持久化 `totalDuration`）             |
| `scene3dSerializer.ts`   | 兼容新字段（空数组/默认值），`isPlaying`/`playheadSeconds` 不序列化；旧存档无 `sceneTimeline` 时补默认值 `{ totalDuration: 10 }`，`totalDuration` 为 0 或缺失时强制修正为 10（防止全 closed 场景第一帧触发停止） |
| `Scene3DFullscreen.tsx`  | 挂载上述新模块，传入必要 props；不在此文件写轨迹逻辑                |
| `timelineTypes.ts`       | **不动**                                                            |
| 外部播放层 / 截图 / 导出 | **不动**                                                            |

---

## 实现顺序（分 Chunk）

1. **Chunk A**：类型定义 + 序列化兼容
2. **Chunk B**：静态轨迹渲染（`TrajectoryRenderer`：Line + 控制点小球，无交互）
3. **Chunk C**：底部时间轴横条 UI（`TrajectoryTimeline`：UI 骨架 + 区间条 + 播放/暂停/归零按钮；**拖拽写 `playheadRef.current` 的部分需 Chunk D 交付 `playheadRef` 后才能串联，Chunk C 阶段先 mock ref 或留占位**）
4. **Chunk D**：`useTrajectoryAnimation` 路径跟随动画（依赖 Chunk C 建立的 zustand `playheadSeconds` 非持久化切片；**hook 返回 `playheadRef`，父组件持有后传给 Chunk C 的 `TrajectoryTimeline`，完成拖拽联动**）
5. **Chunk E**：控制点视口拖拽编辑 + 双击插入
6. **Chunk F**：侧边属性面板（轨迹列表 + binding 配置 + Y 轴输入）

---

## 低优先级决策（已定）

- `CatmullRomCurve3(points, closed, 'catmullrom', tension)` 映射；**tension 和 closed 变更时必须重新 `new CatmullRomCurve3(...)` 并调用 `updateArcLengths()`**（这两个参数是构造参数，不可 mutate，禁止用 `instance.tension = ...` 赋值）；`trajectoryUtils.ts` 的 buildCurve 函数每次接受完整参数返回新实例，不做字段 mutate
- `direction: 'reverse'` 实现：`t_base = 1 - t_base`（不翻转 points 数组）
- 全局单一时钟：所有 binding 共用同一个 `playheadSeconds`
- MVP 不支持相机绑定轨迹（Scene3DCamera 不在 objectIds 范围内）
- **同一 objectId 不允许出现在多个 binding 中**（UI 层拦截；若出现，后执行的 binding 会覆盖先执行的 position/lookAt/visible，行为未定义）
- **binding 移除时**，必须对其所有 boundObjects 执行 `object.visible = true` 复位，**不重置 position**（保留最后帧值，勿加 `position.set(0,0,0)`）。**执行位置**：在 zustand 的 `removeBinding` action 中，命令式访问 `getState().objectRefMap` 对每个 boundObjectId 取 ref，用 `if (ref?.current) ref.current.visible = true` 设置（加 null 守卫，防止对象已卸载时报错）；不要依赖 useFrame 下一帧检测（会有 1 帧闪烁风险）。**调用限制**：`removeBinding` 只允许在事件 handler 或 `useEffect` 中调用，**禁止在 render 阶段调用**。**架构说明**：zustand action 中直接操作 `ref.current.visible` 是有意的命令式 escape hatch；`ref.current` 指向已挂载的 Three.js Object3D，主线程同步执行时序安全，维护者知悉此设计。若 `objectRefMap.get(id)` 返回 `undefined`，则接受"下次挂载时 visible 默认 true"的降级行为；若对象恰好在卸载过程中（`useEffect` cleanup 尚未清空 ref），操作其 `visible` 对已移除的对象无实际效果，同样接受（对象卸载后不再出现在场景中，visible 状态无意义）。
- open 曲线在 t=0 和 t=1 边界附近，不同 offsetRatio 的对象编队间距会被 clamp 压缩至零（已知设计取舍，属预期表现）；**（仅 open 曲线）** direction=reverse 时 `< startTime` 停驻在曲线 t=1 处（几何末端，也是 reverse 运动的起始等待位置），属有意行为（closed reverse < startTime 仍走 visible=false 隐藏逻辑，不停驻）

---

## 验收门

**Chunk A**

- [ ] `pnpm build` 无 TS 错误

**Chunk B**

- [ ] 新建轨迹，打 ≥3 个控制点，视口显示曲线和控制点小球
- [ ] 2 个控制点时曲线正确（CatmullRomCurve3 最小值）
- [ ] `closed=true` 时曲线视觉闭合（无末段缺口），切换 closed 后实时更新

**Chunk C（时间轴 UI）**

- [ ] 底部时间轴横条在轨迹模式下显示，其他时候隐藏
- [ ] 可拖动播放头，值同步到 playheadSeconds（拖拽后继续播放时无跳变——需 Chunk D 实现后联合验收）
- [ ] 各 binding 区间条颜色与轨迹 color 一致
- [ ] 播放 / 暂停 / 归零按钮正常工作

**Chunk D（动画）**

- [ ] 拖动播放头，绑定模型沿轨迹移动，朝向跟随切线
- [ ] `direction: 'reverse'` 时模型从终点走向起点
- [ ] 一条轨迹绑定 2 个模型，各自 offsetRatio 不同，位置正确
- [ ] 多条轨迹同步播放，各自 startTime/endTime 生效
- [ ] 到 endTime 后模型停在终点，`isPlaying` 自动变 false
- [ ] 暂停后继续播放，模型位置连续无跳变
- [ ] 播放中新增 open binding（endTime 远超当前停止阈值），自动停止时机延后到新 endTime（验证停止阈值实时更新）
- [ ] 播放中删除原最长 endTime 的 open binding，剩余 binding 的 max endTime 即刻成为新停止阈值
- [ ] 全部为 closed binding 时，播放至 totalDuration 后 `isPlaying` 自动变 false
- [ ] `endTime = startTime` 边界不崩溃
- [ ] closed 曲线：offsetRatio=0.9 的物体在 t_base=0.15 时位置连续（跨越取模边界无跳变）
- [ ] closed 曲线：playheadSeconds < startTime 时 visible=false；到达 startTime 后 visible=true 且位置正确（无闪帧）
- [ ] 播放中移除含 closed 且 playheadSeconds < startTime 的 binding，boundObject 立即变为可见（visible=true 复位）
- [ ] reverse+closed：物体从曲线末端出发，循环方向与 forward 相反

**Chunk E（拖拽编辑）**

- [ ] 拖拽控制点（XZ 平面），曲线实时更新
- [ ] 双击轨迹线，在最近处插入新控制点
- [ ] 面板"追加点"按钮，末尾追加控制点
- [ ] 删除控制点：points = 2 时禁用删除

**Chunk F（属性面板）**

- [ ] 轨迹列表显示所有轨迹，可新建 / 删除 / 重命名
- [ ] 选中轨迹后可修改 tension、color、closed
- [ ] binding 配置：绑定对象、startTime / endTime / direction / offsetRatio
- [ ] 控制点 Y 值可在面板输入修改
- [ ] 解绑对象（从 `binding.objects` 移除）后模型位置保持最后帧值，不跳变（runtime 停止更新即可）
- [ ] 移除含 closed 轨迹的 binding 后，其 boundObjects 在视口中可见（visible 已复位为 true）
- [ ] 移除含 closed 且当前 playheadSeconds < startTime 的 binding 后，模型变为可见（visible=true 复位），位置为上一帧计算值（非跳变到原点）
