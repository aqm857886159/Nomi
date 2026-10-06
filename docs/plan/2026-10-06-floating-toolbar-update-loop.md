# 节点浮条无限更新把整块画布带崩（React #185）· 设计卡 + 方向检查

改动名：浮条测量一步到位 + 画布浮层缩放只认 React Flow　　线/负责人：L-crash　　类别：[其他]（bug 修复；路径规则会推出「新界面 / 画布」两类，见下）

根因合同：[`docs/fixes/2026-10-06-floating-toolbar-update-loop.root-cause.json`](../fixes/2026-10-06-floating-toolbar-update-loop.root-cause.json)

## 设计卡（★ 5 格）

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我打开一个项目、看到画面摆好就点一张图，我想看到那张图的浮条（多机位九宫格 / 抠图 / 改图 / 宫格…）以便马上动手——而不是整块画布变成「React Flow 画布 加载失败」、只能重载窗口。真实任务：① 单张图片项目打开即选（摆全貌放大到 2.1 倍）；② 同一个 App 里回项目库再打开、再选（修前每次必崩）；③ 中英两轨各一次。不做：不改浮条长相、按钮、位置规则（仍是上下左右夹在可见画布里、太窄折行）；不改「记住的视角」何时写入。主指标：崩溃率（修前同帧模式 15/30，修后 0/30）；护栏：浮条像素不变（实验室 33/35 张与 main 逐像素一致，余 2 张是 main 基线截到懒加载骨架）。 | `node tests/ux/canvas-toolbar-open-select.walk.mjs --instant --rounds 30` |
| ★2 谁说了算 | 「画布缩放」唯一真相 = React Flow 的 transform（`reactFlow/canvasViewportScale.ts` 的 `useCanvasLiveZoom`，09-11 迁移审计定的）；`workbenchStore.categoryViewports` 是「记住的视角」，owner 是 workbenchStore，本职读者是画布视口同步 / 打开时摆全貌 / 新节点落点。浮条位置的唯一 owner = `floatingToolbarClamp.ts` 的 `nextFloatingToolbarPlacement`。碰两个概念：画布缩放、浮条位置。 | `node scripts/door-map.mjs categoryViewports`（10 → 8）、`useCanvasLiveZoom`（2 → 4）、`FloatingToolbarShell`（6 个渲染点同一外壳） |
| ★3 一致与复用 | 缩放复用现成的 `useCanvasLiveZoom`（ClipNode、边标签已在用），不新写订阅；错误边界用 React 自带的类组件边界、写进浮条外壳（六条浮条一个家），不另起通用组件；实验室给样张喂缩放用 `@xyflow/react` 的 `ReactFlowProvider` + `useStoreApi`，不仿造 store。 | `git grep useCanvasLiveZoom`；`git grep FloatingToolbarBoundary` |
| ★4 全状态 | 未选中：无浮条。选中：浮条在节点上方、整条在可见画布里（贴边就挪、太窄折行）。打开项目摆全貌那一刻选中：同上（修前：整块画布崩）。浮条内部渲染出错：只这一条浮条消失、写渲染层崩溃日志，画布与节点照常；取消选中再选中即重试。拖动中：浮条隐身（不变）。没有新文案（i18n 不动）。 | 截图 `tests/ux/shots/canvas-toolbar-open-select/open-select-toolbar-{zh-CN,en}.png`；`--inject-toolbar-error` 3/3 画布存活、浮条降级 |
| ★9 验收与回滚 | 验收：另一条线跑 `pnpm run build` 后 `node tests/ux/canvas-toolbar-open-select.walk.mjs --instant --rounds 30`（必须 0/30、退出码 0）、缺省模式 30 轮、`--inject-toolbar-error --rounds 3`；`npx vitest run src/workbench/generationCanvas/nodes/floatingToolbarClamp.test.ts`（把 `floatingToolbarShift` 里的 `k` 改回 1 必红）。逃逸账本：`CRASH-20261006-toolbar-update-loop`，类检查 = 净缩放 × 贴边矩阵。回滚：revert 本 PR 的提交（无数据迁移）。 | `## 独立验收`（留给验收线） |

### 功能分类
- [x] 新界面 / 改交互（路径规则推出：改了 `src/**/*.tsx`、新增 `src/devlab/designLab/labCanvasViewport.tsx`；实际是 bug 修复、界面像素不变，没有新样张可拍板）
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [x] 大数据量 / 画布 / 长列表（路径规则推出：改了 `src/workbench/generationCanvas/`；浮条只在单选时挂一条，缩放时多一次测量）
- [ ] 生成效果
- [ ] 数据格式

## 方向检查（RW：`NodeFloatingToolbar.tsx` 14 天内第 6 个 fix 提交）

### 0. 一句话根因

浮条是一个「量屏幕 → 改位置 → 再量」的反馈环，却拿一个没量过、还会滞后的缩放（store 里记住的视角）做换算；两边一不一致，环就从收敛变成发散。缺的是两层：缩放只有一个来源，测量一步算出不动点。

### 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| `b17df53c7` 程序不再主动平移 / 缩放画布 | 视口改由用户与「摆全貌」驱动，store 只在手势结束写 | 引入滞后窗口（不是 bug，是设计） |
| `716480007` 浮条留在可见画布里 | 浮条贴边被舞台裁掉 | 新增测量环（左右夹） |
| `a20b46efc` 竖直夹 + 舞台缩放重量 | 浮条钻进顶栏、窗口变化不重量 | 测量环扩到两轴 + ResizeObserver |
| `649402b46` 浮条收成一行 | 按钮太多折行 | 改宽度（与本类无关） |
| `bc45ad4b3` React 19 类型 | 类型基线 | 与本类无关 |
| 本次 #185 | 测量环用 store 缩放换算，store 1 / 屏幕 2.1 时发散 | 测量环没有收敛不变量 + 缩放两个来源 |

### 2. 为什么这一类会一直出现

测量环是一点点长出来的（先左右、再上下、再限宽），每次都假定「已施加的位移 = 屏幕像素」，这个假定只在「反向缩放用的 zoom = DOM 上的 zoom」时成立，而 09-25 起 store 的 zoom 有意滞后。没有任何一层声明「测量必须一步到位」，也没有一层禁止浮层读记忆视角，所以每加一个方向，环就多一条发散路径。铁律 ⑩ ⑪ ⑫：不适用——这是渲染层的几何不变量，不是意图 / 参数 / 点击预期的对账；类检查落在矩阵测试（净缩放 × 贴边位置）。

### 3. 不改结构的话会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 修前：同一 App 里再次打开项目、摆全貌同一帧选中图片节点，每次必崩 | 修前构建 `--instant --rounds 30` = 15/30（偶数轮全崩） |
| 修前：缩放手势中途浮条因生成进度重渲，缩放比 ≥ 约 1.9 时同样崩 | 类级测试：净缩放 2 / 2.1 / 3 / 10 / 15 旧算法抛「Maximum update depth exceeded」 |
| 修前：节点弹入动画（scale 0.82→1）期间浮条要多次提交才停 | 类级测试：净缩放 0.82 旧算法超过三次提交 |

### 4. 靶子独立性检查

尺子是真机生产构建里 React 自己的 #185（不是我们写的判据）+ 一个只模拟「屏幕位移 = 位移 × 净缩放」这一件事的假 DOM；修对了不可能掉分。

### 5. P0：现成方案

React Flow 官方 `NodeToolbar`（`@xyflow/react`）能放节点浮层，但它挂在 portal 里、隐藏即卸载，会丢掉拖动时靠 visibility 保住的按钮忙态；而且它不做「夹在可见画布里」（生成浮框那边已按同一理由没用它，见 `NodeGenerationComposer.tsx` 注释）。Floating UI（`@floating-ui/react`，仓库现在没装）的 `shift` 中间件能做「夹在边界里」，是将来值得评估的接入对象；但这次的病根不在夹取算法，而在「拿哪个缩放换算」和「测量环有没有收敛不变量」——换库也得先回答这两件事。所以这次不引新依赖：缩放来源接入现成的 React Flow transform，错误隔离用 React 自带的错误边界，夹取那十几行几何就地改成一步到位；「浮条夹取改接 Floating UI」作为独立评估项留给后续（不在本 PR）。

### 6. 对比与推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 换成 `NodeToolbar` / Floating UI | 重写六条浮条的挂载；`NodeToolbar` 丢拖动不卸载 | 换库不解决缩放来源与收敛问题；新依赖要过供应链门 | 否（本次）；Floating UI 夹取留作后续评估 |
| 补 | 测量函数改成量净缩放、一步到位；浮条与生成浮框改订 React Flow 缩放；浮条外包错误边界 | 3 个生产文件 + 实验室 4 个格子 | 低：像素不变（实验室逐像素对比） | **是** |
| 重写（限一个模块） | 浮条整体改成视口外的屏幕空间层（像多选浮条那样） | 大；浮条要跟随节点平移缩放 | 拖动 / 缩放跟手要重做 | 否 |
| 删 | 去掉夹取 | 贴边时「重拍这镜」等入口被裁掉 | 回到 716480007 之前的问题 | 否 |

### 7. 用户要权衡的核心

不用权衡：选「补」不改任何长相和交互，只让浮条不再把画布带崩；三个只拿缩放判 0.4 档位的节点浮层（标签 / 生成中 / 导入中）暂留在记忆视角上，档位晚一个手势、不会崩，要统一另开一刀。

## 特征测试清单

- `src/workbench/generationCanvas/nodes/floatingToolbarClamp.test.ts`：原 6 条现状（净缩放 1）保留，新增报告现场 + 净缩放 11 档 × 贴边 5 种的收敛矩阵；把 `k` 改回 1 → 现场用例抛「Maximum update depth exceeded」、矩阵大面积红（已做过变异）。
- `src/workbench/generationCanvas/nodes/NodeFloatingToolbar.test.ts`：锁的结构（不变），新增「浮条 / 生成浮框只读 `useCanvasLiveZoom`、不读 `categoryViewports`」源码检查。
- `tests/ux/canvas-toolbar-open-select.walk.mjs`：生产构建真机循环（缺省 / `--instant` / `--inject-toolbar-error` / `--trace`）。
