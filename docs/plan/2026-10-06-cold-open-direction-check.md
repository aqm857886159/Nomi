# 方向检查：进项目卡顿（L-perf，2026-10-06）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

触发：`node scripts/fix-churn.mjs` 命中——`src/workbench/NomiStudioApp.tsx`（14 天 4 个 fix）、`electron/workspace/`（7 个）、`electron/agentLane/laneDesktopRuntime.ts`（3 个）、`GenerationCanvasReactFlowViewport.tsx`（3 个）、`GenerationCanvasReactFlowNodes.tsx`（3 个），以及自写登记 **lane-legacy-migration**（待替换 / 实为待删，30 天 3 个 fix）。

### 0. 一句话根因

「打开项目」这条读路径没有「只读」契约：它经过的每个 owner（项目身份、Agent 旧对话迁移、轨迹派生视图）都在读的时候顺手拿写锁、写盘、fsync；同时整个 Agent 运行时（约 1500 个 ESM 文件）被同步装进主进程、放在打开的关键路径上，主进程这几秒什么 IPC 都不接。

### 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 卡 17：打开 I300 冷开 13.8 s | 首次启动开场动画盖住项目库，跑器点卡被挡约 11 s | 量具缺陷（不是产品慢） |
| 卡 17：主进程打开时 readJsonFile / fsync 热点 | `ensureWorkspaceProjectIdentity` 每次打开问两遍身份，每遍都走加锁写事务（4 次 fsync） | 读路径写盘 |
| 同上 | `migrateLaneLegacy` 每次打开建 / 删一把锁文件（2 次 fsync），哪怕从来没有旧对话 | 读路径写盘 |
| 同上 | `writeLaneTrace` 每次打开整份重写轨迹文件 | 读路径写盘 |
| 用户 #1：进项目、建新项目卡 | 打开项目要等 Agent lane 打开；本进程第一次打开时同步装载 Agent 运行时模块图（打包版约 1.4 s 主线程阻塞） | 关键路径上的同步模块装载（**架构岔路，未改，见报告**） |
| 卡 17：全选 320 张拖动 249 个长任务 | 自定义节点外壳没 memo，被拖的每张卡每帧整张重渲（每帧几百次 t()） | 拖动热路径重渲 |

热点文件里此前的 fix（React 19 类型、锁占用文案、松手丢失、编组把手）和这次不是同一概念；这次的改动全是「读时不写 / 拖时不渲」，不在它们的修补链上。

### 2. 为什么这一类会一直出现

每个 owner 只看自己：「补身份要加锁」「迁移要加锁」「派生视图要刷新」各自都对，但没有人对「打开项目整体是读」负责，所以每加一个在打开时被问到的 owner，就多一组写盘。铁律 ⑩ ⑪ ⑫ 不适用（不涉及意图抽取 / 档案清单 / 可点目标）。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 下一个在打开时被调用的 owner 又会带一组 fsync | `node tests/ux/project-open-stages.e2e.mjs <label> --assert-read-only`（打开稳定态项目 fsync 必须为 0） |
| 进程中途被杀留下的迁移锁会让下次打开失败（pid 被复用时判成「忙」） | 已用无锁终态检查绕开：从没旧对话 / 已迁完的项目根本不碰锁 |
| Agent 运行时依赖再长，首次打开再慢 | 跑器的 `main:lane-legacy-migration` 阶段（首次装载算在它里面） |

### 4. 靶子独立性检查

尺子是新写的跑器 + 产品打点，和修复同一条线写的。为此：①写盘数由主进程 fs 层探针直接数（不经产品代码自报）；②前后对比在同一台机、同一夹具、同一跑器上跑；③卡 17 的旧尺子（canvas-performance-benchmark）自己有缺陷（开场动画），已修并在 PR 写明。

### 5. P0：这些是我们独有的吗

- 计时：接入 W3C User Timing / Node perf_hooks，不自写计时器。
- 节点 memo：照 React Flow 官方性能指南（https://reactflow.dev/learn/advanced-use/performance）。
- **lane-legacy-migration**（自写登记，to-replace）：这次只在它前面加一层「终态无锁检查」，不改迁移本身。现在换不了：它是一次性迁移代码，没有现成替代（pi 没有旧转录导入接口，见登记 alternativesChecked）；它的出路是「旧版本用户升完后整体删除」，届时这层检查随之删除。

### 6. 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | User Timing / React.memo（已接） | 无 | 无 | ✓ |
| 补 | 在三个 owner 的入口加「已落定就无锁直答」 | 小 | 低：不确定一律回原路径 | ✓（本 PR） |
| 重写（限一个模块） | 把打开流程改成单一只读快照 + 后台补写 | 大 | 碰花钱安全顺序 | 否 |
| 删 | lane-legacy-migration 整体删除 | 中 | 旧版用户丢对话 | 等迁移窗口结束 |

### 7. 用户要权衡的核心

打开项目时 Agent 面板必须先就位（花钱安全），所以 Agent 运行时的装载速度就是打开速度——要么让它装得快（打包成单文件），要么让画布先出来、Agent 后到（改花钱安全顺序）。

## 特征测试清单

- `electron/workspace/workspaceProjectIdentity.test.ts`（原 14 条 + 新 2 条：落定身份无锁无写；未落定照走加锁路径）
- `tests/agent-runtime/lane-legacy-migration.test.mts`（原 10 条 + 新 1 条：终态无锁无写、未迁完仍加锁）
- `tests/agent-runtime/lane-trace.test.mts`（新 1 条：内容没变不重写）
- `src/workbench/generationCanvas/reactFlow/generationFlowNodeMemo.test.ts`（新：只忽略坐标、外壳不读坐标）
