# Nomi 全链路性能（卡顿）专项 — 总方案

> 2026-06-22。范围：从用户第一眼见到软件 → 到最终出片的**全 journey 卡顿**。
> 方法：6 路并行静态审计（`docs/audit/perf/01..06`）+ 真机探针实测（`tests/ux/ui-driver.mjs` 的 `__nomiProbe`）。
> 本文是**单一真相源**；6 份分段审计是细节附录。

## 0. 一句话根因（贯穿全链路的同一把刀）

> **几乎所有卡顿是同一个病：高频瞬态值（时间轴 playhead、画布 viewport、3D 动画帧、流式 token）被写进 React 渲染路径，去驱动一个没 memo 的大组件每帧整体重渲染——而它们本该走 transform / ref / demand 这种「绕开 React」的瞬态通道。**

这不是 6 个孤立 bug，是**一类** bug，在 4 个互不相关模块里以同一形态复发。修在这个根因层 = 整类不再复发（P2）。

**反直觉的好消息**：地基大部分对了——节点已 `React.memo`+自定义比较器、节点拖拽已走 rAF+ref、画布缩放已拆 store、时间轴**编辑**侧已全 memo、3D 用了 InstancedMesh、图片已 lazy+async decode、**没有「裸订阅整个 store」的系统性烂摊子**（293+453 个订阅点，裸订阅=0）。是少数几个精准漏点，不是烂架构。

## 1. P0 清单（按"修复 ROI × 置信度"排序）

| # | 模块 | 根因 | file:line | 修法 | 工作量 | 实测确认 |
|---|---|---|---|---|---|---|
| **A** | 3D 运镜 | 主全屏编辑器 Canvas `frameloop` 默认 `always`，静止也每帧重绘 GPU（风扇狂转/烫/续航） | [Scene3DFullscreen.tsx:671](../../src/workbench/generationCanvas/nodes/scene3d/Scene3DFullscreen.tsx) | 加 `frameloop="demand"` + 交互处 `invalidate()`。**旁边小相机预览已正确用 demand**（`scene3dCameraPreview.tsx:188`）= 一行漏配 | **极小（1 行+接线）** | 待测 GPU 占用 |
| **B** | 时间轴播放 | playhead 每帧 `{...timeline}` 换整对象 identity，订阅整 timeline 的 `TimelinePreview`(791行,**无memo**)每帧整体重渲 | [timelineEdit.ts:476](../../src/workbench/timeline/timelineEdit.ts) + [PreviewWorkspace.tsx:17](../../src/workbench/preview/PreviewWorkspace.tsx) | playhead 拆独立 store/字段（学画布视口下放），`setTimelinePlayhead` 不再 spread 整 timeline；播放头走 transform | 小-中 | 待测（fixture：需排片到时间轴的项目）|
| **C** | AI 流式 | 流式那条每帧把累积全文喂 `react-markdown` 重 parse（**无 memo**）+ `AssistantMessageView` 整列表无 memo 全量重渲 → 回复越长越卡（二次方累积） | [NomiMarkdown.tsx:67](../../src/workbench/common/NomiMarkdown.tsx) + [AssistantMessageView.tsx:58](../../src/workbench/ai/AssistantMessageView.tsx) | 两个一起 `React.memo`（缺一打穿）；长对话上 `@tanstack/react-virtual`（已装未用）；流式中 markdown 节流/分块 | 中 | 待测（发长回复测后段 FPS）|
| **D** | 生成画布 | pan/zoom 走 `useState` → 每帧整 744 行 `GenerationCanvas` god-component 重渲，连带重算虚拟化裁剪 + 重渲未 memo 的边层/minimap | [useCanvasViewport.ts:26](../../src/workbench/generationCanvas/components/useCanvasViewport.ts) + [CanvasEdgeLayer.tsx:35](../../src/workbench/generationCanvas/components/CanvasEdgeLayer.tsx)（无 memo）+ minimap | viewport 改 **transform 直写 DOM**（xyflow/tldraw 标准），React 只在 pointerup 同步终值；`CanvasEdgeLayer`/`CanvasMinimap` 加 memo；边裁剪阈值（现 >50 节点才生效）放宽到密集连线 | 中-大 | **已实测：1 节点平移 = 120fps 不卡 → 确认是规模问题**；待测重项目（多节点+多边）|
| **E** | 冷启动 | 窗口创建被串行 `await` 挡在系统代理探测 + 105KB catalog 同步解析 + capabilityCore 启动之后才 show（窗口不依赖这三件） | [main.ts:444](../../electron/main.ts) → `applySystemProxy`/`ensureBuiltinModelSeeds`/`startCapabilityCore` | 窗口先建先 show，proxy/capabilityCore 并行化、只 gate 各自下游消费点；catalog 读加缓存（现每个 IPC 重解析 105KB） | 中 | 待测（直连 vs 慢代理两环境量"点开→窗口可见"ms）|

## 2. 真机实测结果（已得 / 待补）

**已确认（本轮实测）：**

工具已就绪并可复现：
- 重 fixture 生成器 `tests/ux/fixtures/gen-perf-fixture.mjs`（以真实 48 节点项目为种子放大）→ 标准 fixture「ZZ 性能基准 fixture」= **96 节点 / 156 边 / 20 clip**，快照 `tests/ux/fixtures/perf-heavy.project.json`。
- before/after harness `tests/ux/perf.e2e.mjs <label>` → 三场景探针，结果落 `tests/ux/perf-results/<label>.json`。

**baseline 真机数字（96 节点 fixture，2026-06-22）：**

| 场景 | fps | longTask | maxFrameGap | 解读 |
|---|---|---|---|---|
| 画布平移 | 98.9 | 1 (63ms) | 90ms | ⚠️ **坐实 P0-D 规模卡顿**：1 节点 120fps/0/35ms → 96 节点 99fps/1 长任务/90ms 卡顿帧。改前对照基线。 |
| 画布缩放 | 117.8 | 0 | 42ms | 基本顺。 |
| 时间轴播放 | 120.2 | 0 | 11ms | ❗ **反预测：满帧不卡**。但 11ms=完美 120Hz=rAF 空转 → **播放很可能没真起播**（fixture 视频 clip 引用种子 nomi-local 资产，本实例未加载）。**此条 baseline 无效**，证不了 B 不严重。 |

**校正结论**：静态审计把 P0-B（时间轴 playhead）列头号，但真测被打问号；P0-D（画布）被真数据坐实但"中等"（99fps，单次 90ms 卡顿，96 节点）。→ **修复优先级以真数据为准**：先 D（已证）；B 需先做**能真加载播放的视频 fixture** 再量，确认严重度后再决定是否修。

**附带挖出真 bug**：项目「elicit走查」记录损坏开不了——`本地项目记录损坏：payload 缺少必要字段`（`projectPersistenceService` hydrateProject 抛错）。非性能问题，另行修。

**待补（被并行会话 `pkill -9 Electron` 腰斩，且缺重 fixture）：**
1. 重画布平移/缩放 FPS（需 ~50+ 节点 + ~100 边的项目）。
2. 时间轴播放 10s 的每帧 commit 数 / 掉帧（需排片到时间轴的项目）。
3. 流式 2000 字回复后段 FPS / 输入延迟。
4. 冷启动"点开→首个可交互帧"ms（直连 vs 慢代理）。
5. 3D 全屏静止态 GPU 占用（demand 前后对照）。

**实测协议（每个 P0 修复前后都跑，用 `__nomiProbe.startFps/readFps` 的 longTasks/maxFrameGap 当客观脊梁）：**
建一个**标准重 fixture 项目**（~50 节点 + ~100 边 + 时间轴排满 ~20 clip），固化进 `tests/ux/fixtures/`，所有 before/after 在同一 fixture 上量，数字可比、可回归。

## 3. 推荐执行顺序

1. **先摘三个"小改动最大收益"的 P0：A（3D demand，1 行）、C（流式两 memo）、B（playhead 拆 store）。** 都低风险、收益立竿见影。
2. **建标准重 fixture**，补齐 §2 的 5 项 before/after 实测数字。
3. **再啃 D（画布 viewport 走 transform）**——收益最大但改动最大（动 god-component 渲染数据流），需先有 fixture 兜底回归。
4. **E（冷启动并行化）**单独一条线，主进程改动，配直连/慢代理两环境实测。
5. 各 P1/P2（边层 foreignObject、轨迹 TubeGeometry 重建、scrollIntoView layout thrash、时间轴多 video 解码）随手收。

## 3.5 执行进度

### A｜3D frameloop=demand —— 已实现，**live 3D 走查待过**（未 push）
真做下来 **A 不是审计说的「1 行」**：主编辑器 Canvas 有 4+ 个 useFrame（相机飞行/相机记录/人偶 billboard/轨迹回放），naive demand 会冻住连续动画。深挖后确认**唯一需要持续帧的连续动画 = 键盘 WASD 飞行（useFrame 速度积分）+ 轨迹回放/编辑**；其余（billboard/记录器/相机 draft）都是「相机一动才有活」的脏检测，相机一动就出帧、出帧就更新，demand 下不冻。

实现（2 文件，已 typecheck+build 绿）：
- `Scene3DFullscreen.tsx`：Canvas `frameloop={trajectory.isPlaying || trajectory.timelineOpen || keyboardNavActive ? 'always' : 'demand'}`；`keyboardNavActive` 经现成的 `startKeyboardNavigation/stop` 回调置位。
- `scene3dViewControllers.tsx`：free-look 鼠标转视(pointermove)、滚轮 dolly、聚焦(FocusController effect) 三处直接 mutate camera → 各加 `invalidate()`。OrbitControls/TransformControls(drei) 与物体编辑(React state) 在 demand 下自带 invalidate/自动渲一帧，无需接线。

**待过的真验收门（必须在真机 3D 编辑器里，非 3D 走查会漏）**：① 进 3D 编辑器场景正常渲染；② WASD 飞行 / 鼠标转视 / 滚轮 / Orbit 编辑模式 / 双击聚焦 / 轨迹 scrub+回放 / gizmo 变换 —— 逐项确认**不冻视口**；③ 静止悬停时 r3f 真停渲（GPU/风扇下来）。**环境堵点**：实测期有游离 Electron + 并行会话抢 userData 锁，需干净窗口才能验。

### C / D —— 待开始（A 验收通过后按序）

## 4. 不动项（审计已证实做对，别误改）

节点 `React.memo`+比较器、节点拖拽 rAF+ref、画布缩放已拆 store、时间轴编辑侧全 memo+transform、3D InstancedMesh/矩阵 useMemo/小相机 demand、`StagingCaptureHost`/`CameraMoveCaptureHost` 无待处理时 `return null` 不占 GPU（**确认没有常驻离屏渲染**）、图片 lazy+async decode、导出主路径走主进程 ffmpeg 子进程（异步/有进度/不阻塞 UI）。

## 附录：分段审计原文
`docs/audit/perf/01-cold-start.md` · `02-state-rerenders.md` · `03-canvas.md` · `04-scene3d.md` · `05-creation-streaming.md` · `06-timeline-media-export.md`
