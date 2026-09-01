# 画布拖动性能 · 评测体系 v2 + 优化路线（调研稿 · 未拍板）

> 2026-09-01 · 背景：8-27 React Flow 单内核迁移后用户体感「拖动节点明显变卡」，但现有 perf 基准全绿。
> 本文 = 三腿 Opus 调研（考古 / 现状实测 / 官方+近邻）的综合。详细证据临时存放 `/tmp/canvas-perf-research/leg-{a,b,c}*.md`（机器重启即失，关键结论已内联本文）。
> 状态：🚧 进行中 —— B 案与 eval v2 范围均已拍板（2026-09-01）。S1+S2（量具三腿 + 基线）已交付；S3（画布外订阅细粒度化）/ S4（B 案内核改造）在途；S5 同尺复测收官。

## 一、事实基座

### 1. 评测体系已经存在且活着（R20：别重造）

上次「整个的优化」= 两件事的合体，别混：
- **画布 perf benchmark**（2026-08-09 诞生，本轮主角）：`tests/ux/canvas-performance-benchmark.e2e.mjs`，14 场景含 `node-drag-image/video`（60 步 mousemove × 16ms 直线拖动），指标 frameGapP95/maxFrameGap/longTask/CDP LayoutCount/ScriptDuration/媒体激活/堆增量 + 硬失败（锚点漂移>1.5px、节点 DOM 身份丢失）。软预算 `PERFORMANCE_BUDGETS`（frameGapP95≤33ms 等，`:1047`），#264 平台校准 non-darwin ×1.6（`:1041`）。已随迁移更新选择器（commit `42beea3a`），**不是孤儿**。配套：`test:canvas-perf` / `test:canvas-perf:compare` / `scripts/canvas-performance-verdict.mjs` / `NOMI_PERF_USER_DATA` 隔离。
- **Lane A/B/C/D（2026-06-14，`evals/`）**：生成/旅程质量评测（rubric judge / τ-bench / VBench），**与拖动卡顿无关**，本轮不碰。

CI 接线：`quality-gate.yml:145-147` → `canvas-real-suite.mjs:31`（M 档 / runs=1 / Linux xvfb），触发条件 `validation-policy.mjs:61-78`——**只有改到 reactFlow/ 或指定媒体文件才跑**。⇒ 无关改动引入的画布回归，main 上从来没人量。

迁移时的承诺与数字：PR216 合并门 = medium benchmark 无硬失败；committed `canvas-pr216-acceptance.json`（darwin）node-drag-image 16.6ms / video 18ms。**但迁移 plan 自认没有同尺度的迁移前基线**——「迁移前 vs 后」没有可比数字。

### 2. 为什么基准全绿、手上却卡（测量窗口盲区）

本机实测（Apple M5 · 生产构建 · S=48 节点 · 全 PASS）：

| 场景 | frameGapP95 | scriptDur(累计) | LayoutCount | 说明 |
|---|---|---|---|---|
| blank-pan（对照） | 10.8ms | 88ms | **3** | 只走 viewport transform，不碰 store |
| node-drag-image | 16.3ms | 473ms（5.4×） | **144**（48×） | 每 mousemove ≈2.4 次强制布局 |
| node-drag-video | 18.8ms | 664ms（7.5×） | **214**（71×） | 每 mousemove ≈3.6 次强制布局 |

单 tick JS ≈7.9–11ms，已逼近 16.6ms 帧预算——**这是最强机器 + 生产构建的乐观下界**。用户实际在 `pnpm dev`：StrictMode（`src/main.tsx:43`）让所有重渲染 ×2 → 单帧超预算 → 体感卡。基准恰好测不到的四个盲区：① 画布外组件重渲染（probe 只盯 stage/edges/labels）；② dev/StrictMode 模式；③ 多选拖动与真人变速手势；④ 弱机器（无 CPU throttle 档）。

### 3. 嫌疑榜（leg-b 实测 + file:line）

| # | 嫌疑 | 机制 | 证据 |
|---|---|---|---|
| 1 | **画布外组件订阅整棵 `state.nodes`**（最重） | immer 每 tick 换数组引用 → 8 个画布外组件每 mousemove 全部重渲染 + 重建 Map（分类树/素材池/任务中心视觉毫无变化却全程陪跑；`CategoryTree` 根本不读 position） | `CategoryTree.tsx:42/:120`、`useAssetPool.ts:45/:50`、`TaskCenterButton.tsx:33/:88`、`TimelinePreview.tsx:87`、`PreviewSourcePanel.tsx:57`、`TaskCenterPanel.tsx:46`、`OnboardingChecklist.tsx:57` |
| 2 | **拖动 tick 无 rAF 合帧** | 每个原生 mousemove = 同步 `moveNode` 写 store + 一次完整 React commit + 投影链（filter→collapsed→edges→projection）全跑 | `GenerationCanvasReactFlow.tsx:447-449`、`:140-200`、`canvasNodeActions.ts:179-186` |
| 3 | **layout thrash** | 投影重算+画布外重渲+RF 读尺寸同 tick 读写 DOM 交替 → 144–214 次强制布局/次拖动 | 实测 CDP LayoutCount（上表） |
| 4 | `nodes.filter(category)` 每 tick 造新数组 | 第一道放大闸，下游投影/minimap/选择边界全部重算 | `GenerationCanvasReactFlow.tsx:140-143` |
| 5 | 自定义 CanvasMinimap 每 tick 重画全部 rect | O(n)/tick | `Overlays.tsx:124`→`CanvasMinimap.tsx:133` |
| 6 | dev StrictMode ×2（放大器，非缺陷） | 上述全部成本翻倍，正是用户手感来源 | `main.tsx:43` |

**干净的部分（别白修）**：持久化/事件/撤销都正确推迟到拖动结束（`persist:false`/`emit:false`/`captureHistory` 仅 dragStart）；base64 不进 store（媒体先落盘换 `nomi-local://`）；`nodeTypes` 模块级；`BaseGenerationNode` 已 memo + adapter 引用等价复用；`onlyRenderVisibleElements` 已开；`data-dragging` 刻意走 DOM 不进 React。**拖动路径骨架是好的，重量全压在「一次 mousemove = 一次全量 commit + 画布外连坐」上。**

### 4. 外部印证（leg-c，@xyflow/react 12.11.5 现役）

- 官方对同类 issue（#4983）的根因判定就是「每 tick 重建 nodes 数组/对象绕过 memo」；#4975：hover/selection 走 CSS 别写 store；上游仍有 open 的快速拖动冻结 issue #4391（数百节点、复现难，若我们踩到按惯例带 Nomi 品牌上游报）。
- 近邻 chaiNNer（Electron+RF+重媒体节点）：**RF 自持拖动几何（useNodesState 内核态）与业务 store 分离**，per-node 细粒度订阅（`nodeState.ts`）+ 三层 memo。这正对我们的嫌疑 #1/#2。
- 测量：同机 drag/pan 比值比绝对预算稳（#264 学费：绝对阈值 platform-fragile）；React `<Profiler>` 数重渲染做一次性根因证明；CDP Tracing 备用。

## 二、eval v2 设计（扩展现有 benchmark，不重造）

**载体**：全部长在 `tests/ux/canvas-performance-benchmark.e2e.mjs` 现有 harness 上（rAF 采样器、CDP 计数、硬失败、隔离、compare、verdict 全复用）。

**新增场景**（S 档跑——M=96 会踩 lightweight LOD 阈值 80 遮蔽全内容节点成本，`canvasNodeLevelOfDetail.ts:3`）：
1. `multi-node-drag`（拖 N=8 选中节点，成本按 N 放大的斜率）
2. `drag-at-low-zoom`（lightweight 模式下拖）
3. `drag-over-dense-edges`（高边密度区拖）
4. 变速拖动路径（加速-甩尾-停顿，替代匀速直线的「太干净」）

**新增指标**：
1. **每 mousemove 摊销**：`scriptDur/moves`、`LayoutCount/moves`（advisory 起步，目标 ≤1.2 layout/move）——LayoutCount 是本轮最灵敏指纹（144–214 vs 3）
2. **同机 drag/pan 比值门**：`scriptDrag/scriptPan`、`layoutDrag/layoutPan` 设上界；比值跨平台稳，避开 #264 绝对阈值陷阱
3. **画布外重渲染计数**：dev 腿注入 `<Profiler>`（prod bundle 剥 Profiler，恰好 dev 腿本来就要建），断言「拖动期间 CategoryTree/素材池/任务中心 render 次数 = 0」——直接抓嫌疑 #1
4. `action_latency_p95`（pointerdown→首帧视觉反馈 ≤50ms）——08-09 plan 承诺过但从未实现

**新增跑法**：
- **dev/StrictMode 腿**（advisory）：量 dev/prod 比值，捕捉用户真实体感的 ×2
- **CPU throttle 腿**：CDP `Emulation.setCPUThrottlingRate(4)` 模拟中位用户机器
- **darwin 金标准基线**：修复前先在本机采全档基线存档（当前 S 档数字已在上表），修复后同机同尺复测

**打分策略**：绝对预算沿用现值+平台校准不动；新指标一律 advisory 一轮、有数据后再硬化（#264 教训）。
**真机走查（R13/R16）**：修复前后各录一段真实拖动（dev 模式、真项目规模），人眼判断跟不跟手——绿灯≠手感（P3）。

## 三、修复路线（fork 待拍板）

**共同底座（无争议，先做）**：修嫌疑 #1——8 处画布外订阅细粒度化（`useShallow` + 不含 position 的派生 selector；关心「有哪些节点/在哪个分类」的消费者不该被高频 position 广播打醒）。顺带 #4（filter 引用稳定）、#5（minimap 拖动中冻结/降频）。

**Fork：嫌疑 #2 的两条修路**

| | A. rAF 合帧写 store（保守） | B. 拖动几何下放 RF 内核，松手才写回（推荐） |
|---|---|---|
| 做法 | `moveNode` 进 rAF 队列，一帧最多 commit 一次 | 拖动中位置只活在 RF/draft 层（chaiNNer 模式），`onNodeDragStop` 一次写回 Zustand；选择框/组框/minimap 拖动中读 draft 层 |
| 用户看到 | 拖动变顺（dev 尤其），改动小 1–2 天 | 拖动逼近纯平移的顺滑（5–7× script 差距结构性抹平） |
| 代价/风险 | 投影链仍每帧全跑；弱机/大图/多选仍可能超帧预算；治标 | 改 controlled-flow 契约，回归面大（拖动=核心交互）；靠 eval v2 基线兜底 |
| 语义 | 无变化 | **正是 R23 的彻底执行**：「React Flow 是交互/变换内核，Zustand 是业务与持久化真相源」——高频瞬态几何本就不该逐 tick 进业务 store（拖动中本来就不落盘、不发事件、Agent 读到旧位置，语义早已如此） |

推荐 **B**（P2 修根因；A 的 rAF 代码在 B 落地时必须删=白做一遍，P1）。若 B 实施中撞硬契约问题再降级 A。

## 四、执行顺序（拍板后）

S1 eval v2 场景+指标落地 → S2 采基线（prod / dev / 4× throttle 三腿 + 真机录屏）→ S3 修 #1+#4+#5（共同底座）→ S4 修 #2（按拍板的 A/B）→ S5 同尺复测 + 真机走查对账 → S6 新指标 advisory 转硬门评估 + CI 触发策略复议（main 是否 nightly 跑 darwin 基线）。

## 五、不动项 / 回滚

- 不动：持久化/撤销/事件语义（已正确）；手势语义（08-03/08-07 拍板件）；lightweight LOD 阈值 80（要动单独议）；`evals/` Lane A-D。
- 回滚：S3/S4 各自独立 PR，可单独 revert；eval v2 纯增量（advisory 起步）不影响现门岗。
- 卫生欠账（顺手项，不阻塞）：`tests/ux/perf.e2e.mjs`（6 月老 harness）与空目录 `tests/perf/` 与现 benchmark 并存易误导，S6 时清。

## 复现命令

```bash
pnpm build
node tests/ux/canvas-performance-benchmark.e2e.mjs <label> --scale S \
  --scenario node-drag-image,node-drag-video,blank-pan --runs 5 --warmup 1
```
