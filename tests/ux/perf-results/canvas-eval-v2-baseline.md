<!-- eval v2 画布拖动性能基线摘要（S1+S2 战役）。三条腿：prod（darwin 构建）/
dev（Vite dev bundle + StrictMode）/ throttle（prod 构建 + CDP CPU 4x 节流，模拟
中位机器）。每条腿的 JSON 自带 leg 元数据。本摘要的复现命令是 S5 验收锚——一字不改。 -->

# 画布拖动性能 · eval v2 基线（darwin）

## 复现命令（S5 验收锚 · 一字不改）

主仓库/本 worktree 根目录执行。dist 需先 `pnpm build`（prod / throttle 腿加载
构建产物；dev 腿加载 Vite dev server，不依赖 dist）。

```bash
# 腿① prod（darwin 构建 · 主基线 · runs=5）
node tests/ux/canvas-performance-benchmark.e2e.mjs eval-v2-baseline-prod-darwin \
  --scale S \
  --scenario blank-pan,node-drag-image,node-drag-video,multi-node-drag,drag-at-low-zoom,drag-over-dense-edges \
  --runs 5 --warmup 1

# 腿② dev（dev bundle + StrictMode · runs=3）
node tests/ux/canvas-performance-benchmark.e2e.mjs eval-v2-baseline-dev \
  --dev-server \
  --scale S \
  --scenario blank-pan,node-drag-image,node-drag-video,multi-node-drag,drag-at-low-zoom,drag-over-dense-edges \
  --runs 3 --warmup 1

# 腿③ throttle（prod 构建 + CDP CPU 4x · runs=3）
node tests/ux/canvas-performance-benchmark.e2e.mjs eval-v2-baseline-throttle-4x \
  --throttle 4 \
  --scale S \
  --scenario blank-pan,node-drag-image,node-drag-video,multi-node-drag,drag-at-low-zoom,drag-over-dense-edges \
  --runs 3 --warmup 1
```

结果 JSON 落 `tests/ux/perf-results/canvas-<label>.json`，各自带 `leg` 元数据
（`{devServer, cpuThrottleRate, kind}`）自证测量配置。

## 各腿产物

- 腿① prod：`canvas-eval-v2-baseline-prod-darwin.json`（kind=`prod`）
- 腿② dev：`canvas-eval-v2-baseline-dev.json`（kind=`dev-strictmode`）
- 腿③ throttle：`canvas-eval-v2-baseline-throttle-4x.json`（kind=`throttle-4x`）

## 数据（待填 · 基线跑完自动补）

所有数值为各腿样本运行的中位数（warmup 已排除）。`layoutPerMove` =
CDP LayoutCount ÷ 实际 pointer-move 数，是调研认定的最敏感指纹（拖动 vs 纯 pan）。
`edgeMut` = 拖动窗口内画布边 DOM mutation 数。

### 腿① prod（darwin 构建 · runs=5 · kind=prod）

| 场景 | fps | frameGapP95 | maxGap | layout/move | script(ms) | moves | edgeMut |
|---|---|---|---|---|---|---|---|
| blank-pan（对照） | 120.2 | 10.2ms | 13.7ms | **0.05** | 97 | 60 | 18 |
| node-drag-image | 119.7 | 16.5ms | 20.1ms | **2.40** | 500 | 60 | 602 |
| node-drag-video | 107.5 | 22.2ms | 52.2ms | **3.80** | 872 | 60 | 733 |
| multi-node-drag* | 106.2 | 18.4ms | 63.8ms | 4.41 | 440 | 22 | 1393 |
| drag-at-low-zoom* | 113.0 | 18.5ms | 39.2ms | 5.95 | 481 | 22 | 520 |
| drag-over-dense-edges* | 104.4 | 23.4ms | 48.1ms | 4.32 | 407 | 22 | 277 |

关键比值（同机 drag/pan）：node-drag-image **script 5.14× · layout 48×** vs blank-pan。

### 腿② dev（dev bundle + StrictMode · runs=3 · kind=dev-strictmode）

dev 腿是「用户在 `pnpm dev` 下真实体感」腿：StrictMode 双渲染 + 未 minify + immer
dev freeze。frameGap 全面变差，node-drag-video maxGap 冲到 **101ms**（prod 52ms）。

| 场景 | fps | frameGapP95 | maxGap | layout/move | script(ms) | 画布外重渲染 |
|---|---|---|---|---|---|---|
| blank-pan（对照） | 120.0 | 11.8ms | 22.2ms | 0.03 | 375 | 192 |
| node-drag-image | 86.1 | 34.6ms | 51.3ms | **2.52** | 2049 | **584** |
| node-drag-video | 83.1 | 35.5ms | **101ms** | 3.87 | 2149 | **669** |
| multi-node-drag* | 99.8 | 22.0ms | 47.1ms | 4.36 | 605 | 321 |
| drag-at-low-zoom* | 108.9 | 20.9ms | 37.4ms | 6.41 | 802 | 429 |
| drag-over-dense-edges* | 97.9 | 26.0ms | 88.7ms | 4.32 | 619 | 259 |

### 腿③ throttle（prod 构建 + CDP CPU 4x · runs=3 · kind=throttle-4x）

throttle 腿是「中位用户机器」腿（prod 构建 + CDP CPU 4×）。拖动全场景 frameGapP95
冲到 49-65ms（预算 33ms）、maxGap 最高 207ms，而 blank-pan 仍 119fps/15ms——
「弱机拖动卡、平移不卡」在此腿可稳定复现。

| 场景 | fps | frameGapP95 | maxGap | layout/move | script(ms) | moves | edgeMut |
|---|---|---|---|---|---|---|---|
| blank-pan（对照） | 119 | 15ms | 25ms | 0.05 | 425 | 60 | 18 |
| node-drag-image | 63.2 | **49.3ms** | 142.2ms | 2.22 | 2625 | 60 | 601 |
| node-drag-video | 62.8 | **55.5ms** | 158ms | 3.90 | 3259 | 60 | 732 |
| multi-node-drag* | 61.9 | 52.2ms | 129.1ms | 4.18 | 1566 | 22 | 1391 |
| drag-at-low-zoom* | 73.8 | 53.7ms | 127.7ms | 5.86 | 1850 | 22 | 516 |
| drag-over-dense-edges* | 62.0 | **64.8ms** | 207.5ms | 4.82 | 1777 | 22 | 276 |

\* = eval v2 新增场景，本轮 **advisory-only 不 gate**（预算未跨平台校准，先观测；
见 `dragScenarios.mjs` 头注 + #264 教训）。前 3 个场景保留既有预算并 gate。

### 三腿对比亮点（frameGapP95 / layout-per-move · node-drag-image）

| 腿 | frameGapP95 | layout/move | 画布外重渲染 |
|---|---|---|---|
| prod | 16.5ms | 2.40 | （探针在 prod 跳过：display name 被 minify）|
| dev | 34.6ms | 2.52 | 584 |
| throttle | 49.3ms | 2.22 | （prod 构建，探针跳过）|

## U4 阳性对照（防探针假绿）

画布外重渲染探针（`offCanvasRenderProbe.mjs`）只在 dev 腿有意义（component
display name 未被 minify）。阳性对照要求拖动中读到 **>0** 的画布外重渲染；读到 0
或「很干净」= 探针坏了，不是「代码没问题」。

**本轮观测（dev 腿 · 拖动窗口内画布外组件 render 次数中位数）——全部 >0，探针为真：**

| 场景 | 画布外重渲染总数 | React commits | 拆解（主要贡献者）|
|---|---|---|---|
| blank-pan（对照） | 192 | 65 | TaskCenterButton + OnboardingChecklist |
| node-drag-image | **584** | 280 | TaskCenterButton 189×·OnboardingChecklist 160×·TaskCenterPanel 96× |
| node-drag-video | **669** | 322 | 同上量级 |
| multi-node-drag | 321 | 126 | 同上 |
| drag-at-low-zoom | 429 | 186 | 同上 |
| drag-over-dense-edges | 259 | 124 | 同上 |

**结论**：拖动一个画布节点，会连带把**画布外**的任务中心按钮/面板、新手清单
重渲染数百次（node-drag-video 达 669 次）——这就是「基准绿、用户仍卡」的体感来源。
探针读到清晰大信号，非假绿。

**同机 drag/pan 指纹（阳性对照的比值口径，node-drag-image）**：
- script 比值 dev **5.46×** / prod 5.14×（目标 ≈5-7× ✓）
- layout/move dev **2.52** / prod 2.40（目标 ≈2.4-3.6 ✓）

对照 blank-pan 的 layout/move ≈0.03-0.05：拖动路径每个 pointer-move 强制 ~2.5 次
布局，纯 pan 几乎为 0 —— 这个比值（而非任何绝对 ms 预算）是修复要撬动的目标。

## S3+S4 交付后基线（2026-09-02 · merged main a056b4ed）

> S3（#341 细粒度订阅）+ S4（#346 拖动几何下放 RF 内核）全部合并到 main，
> S5 终验在 merged main 的 worktree nomi-s5-final 重采（runs=5/3 各腿）。
> 产物文件：`canvas-final-postfix-{prod,dev,throttle,L,select}.json`。

### 腿① prod（darwin 构建 · runs=5）— S3+S4 after

| 场景 | fps | frameGapP95 | maxGap（advisory） | script(ms) | moves |
|---|---|---|---|---|---|
| blank-pan（对照） | 120.4 | 10.8ms | 13.5ms | 119 | 60 |
| node-drag-image | 118.7 | **10.3ms** ↓37% | 30.6ms | 149 | 60 |
| node-drag-video | 114.5 | **10.5ms** ↓53% | 94.1ms | 265 | 60 |
| multi-node-drag* | 117.1 | 13ms | 44.4ms | 215 | 22 |
| drag-at-low-zoom* | 119.1 | 10.1ms | 24.4ms | 245 | 22 |
| drag-over-dense-edges* | 106.9 | 12.8ms | 71.2ms | 214 | 22 |

**node-drag-image before→after**（prod）：frameGapP95 16.5ms → 10.3ms（↓37%）；script 500ms → 149ms（↓70%）。

### 腿① prod — drag/pan script 比值

| 腿 | before（pre-S3） | after（post-S4） | 目标 |
|---|---|---|---|
| prod node-drag-image/blank-pan | **5.14×** | **1.25×** | ≤2× |

拖动/平移 script 比值从 5.14× 降至 1.25×，S4 拖动几何下放到 RF 内核后画布外事件链近乎消除。

### 腿② dev（dev bundle + StrictMode · runs=3）— S3+S4 after

| 场景 | fps | frameGapP95 | maxGap（advisory） |
|---|---|---|---|
| blank-pan | 120.3 | 9.7ms | 15ms |
| node-drag-image | 60.3 | **18.2ms** ↓47% | 41.1ms |
| node-drag-video | 59.4 | **18.5ms** ↓48% | 66.1ms |
| multi-node-drag* | 113.3 | 14.6ms | 50.7ms |
| drag-at-low-zoom* | 111.5 | 14.0ms | 54.5ms |
| drag-over-dense-edges* | 110.8 | 15.8ms | 36.3ms |

dev 腿 node-drag-image before→after：frameGapP95 34.6ms → 18.2ms（↓47%）。

### 腿③ throttle（prod + CDP CPU 4x · runs=3）— S3+S4 after

| 场景 | fps | frameGapP95 | maxGap（advisory） |
|---|---|---|---|
| blank-pan | 119.6 | 13.6ms | 19.9ms |
| node-drag-image | 112.9 | **12.9ms** ↓74% | 56.1ms |
| node-drag-video | 102.4 | **16.9ms** ↓70% | 97.5ms |
| multi-node-drag* | 76 | 31.1ms | 89.1ms |
| drag-at-low-zoom* | 98 | 23.5ms | 60.9ms |
| drag-over-dense-edges* | 94 | 22ms | 76.2ms |

throttle 腿 node-drag-image before→after：frameGapP95 49.3ms → 12.9ms（↓74%）。

### L 档（192 节点）— 拖动成本与节点量解耦

S4 后在 192 节点（L 档）重采：frameGapP95 与 S 档（48 节点）几乎同数，证明
**拖动成本已与节点规模解耦**（S4 把几何运算下放给 RF 内核，不再随节点数 O(n) 扩张）。

| 场景 | fps（L） | frameGapP95（L） | fps（S） | frameGapP95（S） |
|---|---|---|---|---|
| node-drag-image | 119.6 | **10.3ms** | 118.7 | 10.3ms |
| node-drag-video | 117.8 | **10.5ms** | 114.5 | 10.5ms |
| multi-node-drag* | 119.0 | 10.9ms | 117.1 | 13ms |

L 与 S 数字几乎重叠 → 节点量不再是拖动帧时的驱动因素。

### click-select 现状与 S6 目标

| 场景 | fps | frameGapP95 | 状态 |
|---|---|---|---|
| click-select | 102.4 | **32.8ms** | ⚠️ 贴 33ms 上限，Codex 班 S6 正在治 |

click-select 32.8ms 贴线。S6 目标：≤20ms。Codex 班分支 `perf/canvas-click-select-20260903` 进行中。

### 复现命令（S5 终验锚 · 一字不改）

```bash
# 腿① prod（S3+S4 after · darwin · runs=5）
pnpm build && node tests/ux/canvas-performance-benchmark.e2e.mjs final-postfix-prod \
  --scale S \
  --scenario blank-pan,node-drag-image,node-drag-video,multi-node-drag,drag-at-low-zoom,drag-over-dense-edges \
  --runs 5 --warmup 1

# 腿② dev（runs=3）
node tests/ux/canvas-performance-benchmark.e2e.mjs final-postfix-dev \
  --dev-server \
  --scale S \
  --scenario blank-pan,node-drag-image,node-drag-video,multi-node-drag,drag-at-low-zoom,drag-over-dense-edges \
  --runs 3 --warmup 1

# 腿③ throttle（prod + CPU 4x · runs=3）
node tests/ux/canvas-performance-benchmark.e2e.mjs final-postfix-throttle \
  --throttle 4 \
  --scale S \
  --scenario blank-pan,node-drag-image,node-drag-video,multi-node-drag,drag-at-low-zoom,drag-over-dense-edges \
  --runs 3 --warmup 1

# L 档（192 节点 · 解耦验证 · runs=3）
node tests/ux/canvas-performance-benchmark.e2e.mjs final-postfix-L \
  --scale L \
  --scenario node-drag-image,node-drag-video,multi-node-drag \
  --runs 3 --warmup 1

# click-select 基线
node tests/ux/canvas-performance-benchmark.e2e.mjs final-postfix-select \
  --scale S \
  --scenario click-select \
  --runs 5 --warmup 1
```
