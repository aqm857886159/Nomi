# 编组优化：验收与实施卡

> 对照私有待办 `Nomi-service/roadmap/TODO.md`：编组框、拉环、空白点击、60 节点拖组性能、位置/选中单一 owner、编组工具条、Frame/Group 命名统一。
> 本卡先定义验收，再改生产代码。整组生成继续复用现有批量确认路径，不新增生成发动机。

## 设计卡

```text
改动名：画布编组交互、性能与工具条收敛
线/负责人：codex/create-composition-optimization
类别：[长跑][新界面][其他]
```

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当创作者在画布整理一组镜头时，我想让组框持续可见、拉环稳定可用、拖动跟手，并用带文字的工具条完成排列、整组生成、进时间轴、解组和下载，以便不用猜图标或反复试错。真实任务覆盖：4 张节点建组后点空白；60 张节点拖组；选中组后依次打开工具条动作。已知坑：框丢失、拉环只在单击后出现、拖组卡顿、批量栏重复。 | `tests/ux/canvas-frame.walk.mjs`、`tests/ux/canvas-perf/dragScenarios.mjs`、`tests/ux/group-ports.walk.mjs` |
| ★2 谁说了算 | 组的成员、位置、选中与端口投影由画布 store + React Flow 投影共同组成；本次把用户可见组状态收敛到 `useGenerationCanvasStore` 的组/节点状态，React Flow 只负责投影和手势。 | `node scripts/door-map.mjs moveGroupNodes`；`node scripts/door-map.mjs selectNodes` |
| ★3 一致与复用 | 复用现有 `GroupFrame`、`GroupFrameHeader`、`FrameContextMenu`、`useCanvasSelectionDrag`、`projectGroupConnectionPorts` 和批量生成确认路径；不新建第二套组移动、连线或生成入口。 | `git grep -n "GroupFrame\|moveGroupNodes\|confirmAndRunPlan\|projectGroupConnectionPorts" src tests` |
| ★4 全状态 | 空组：虚线、0 个成员；加载/拖动：组框不消失，计数和位置实时更新；成功：组框与成员保持同一位置，工具条动作立即反映；失败：动作不静默吞掉并保留组；部分成功：批量动作沿用现有反馈；取消中：不改变组成员；过期/重载：从持久化组状态恢复。zh/en 文案全部走 i18n。 | `tests/ux/canvas-frame.walk.mjs`、`pnpm run check:i18n` |
| 5 中途表 | 组拖动中止：恢复原位置；关闭窗口：已落盘的组状态恢复，未提交帧不写入；断网：只影响生成/下载动作，组结构不丢；重启：组和成员关系从项目恢复；连点：动作幂等，不能重复建组或重复移动。 | `tests/ux/canvas-frame.walk.mjs`、`src/workbench/generationCanvas/store/generationCanvasStore.test.ts` |
| 6 外部数据与失败 | 外部只涉及 React Flow 的测量与 pointer 事件。量不到成员真实矩形时，编组判定不猜尺寸；性能探针缺失时只记录 `unverified`，不伪造通过。 | `src/workbench/generationCanvas/components/useCanvasFrameMembership.ts`、`tests/ux/canvas-performance-benchmark.e2e.mjs` |
| 7 性能预算 | 60 节点拖组场景记录帧间隔和长任务数；当前量具的 M 档使用 48 张真实图片 + 48 个真实 1080p 视频资产，规模门槛为 frameGap P95 ≤ 22ms、longTask P95 ≤ 80ms、长任务数 ≤ 3。不得因组位置/选中写回导致整张画布重渲染。 | `pnpm run test:canvas:performance`、`tests/ux/canvas-perf/dragScenarios.mjs` |
| 8 真实条件 | macOS Electron 真实窗口、中文、1920×1200 视口覆盖、60 节点组、真实项目存储；编组专项使用仓库登记的真实 1920×1080 H.264 视频和真实 1920px PNG，走查确认视频 `videoWidth=1920`、`videoHeight=1080`；性能量具额外记录当前节点是否仍处于海报态。Windows、干净安装和真供应商生成在本批记为 `unverified`，不以 mock 代替。 | `tests/ux/grouping-real-media.walk.mjs`；截图目录 `tests/ux/shots/grouping-real-media/`；`tests/ux/perf-results/canvas-grouping-real-1080p.json` |
| ★9 验收与回滚 | 实现线完成后复跑新增编组走查、现有 `canvas-frame`/`group-ports` 和性能场景，逐项对照本卡；回滚为 revert 当前任务分支上的改动。 | 走查日志、截图和性能 JSON；本轮由任务分支提交并开 PR，PR #1014 协调线负责独立验收 |

## 先行测试矩阵

| TODO | 修复前应证明 | 修复后必须证明 |
|---|---|---|
| 编组框、拉环、空白点击 | 组框空白点击后 DOM/边框/端口是否仍在；左右组端口是否稳定存在 | 点击空白不让组框消失；端口节点和两侧拉环在组保持选中期间持续可见，拖线可落到组框 |
| 60 节点拖组性能 | 60 节点拖组的 P95/max frame gap、长任务数 | 同一 fixture 同一预算下通过，且组框与成员位移一致 |
| 位置/选中单一 owner | 拖动期间 store 写入次数和投影重渲染次数 | 位置/选中只有一个生产写口；性能探针不再记录全画布级联重渲染 |
| 编组工具条 | 当前组头只有图标/菜单，批量栏重复，排列/下载入口缺失 | 选中组出现带文字工具条；排列、整组生成、时间轴、解组、下载可达；统一模型/并发栏不再重复出现 |
| Frame/Group 命名统一 | UI 文案和类型命名仍为 Frame/NodeGroup 双轨 | 用户可见文案统一为“组”；内部迁移另有明确边界，不做隐式双写 |

## 不在本批

- 不改分镜组（分镜组），不新增“转分镜组”。
- 不改生成发动机、付费确认协议或供应商路径；整组生成继续走现有 `confirmAndRunPlan`。
- 不把“存为流程”伪装成已完成；本批只保留明确入口规划，功能另立任务。

## 证据边界

`grouping-optimization.walk.mjs` 和 `group-ports.walk.mjs` 是真实 Electron 交互走查；60 节点性能量具使用真实资产夹具，当前结果显示视频节点仍以海报态渲染，因此只能证明真实图片负载下的拖组性能，不能宣称已经证明视频解码期间的拖组预算。真实图片尺寸、视频 1920×1080 解码和工具条路径由 `grouping-real-media.walk.mjs` 单独证明，不能把三类证据互相替代。

## 2026-10-05 实测回执（当前分支）

以下结果来自当前工作树；本卡记录的是提交前的证据，交付以任务分支 PR 和协调线复核为准。编组专属 `canvas-frame` 基线已在当前生产组件样张上更新并复跑通过；最终交付仍以 PR 和协调线复核为准。

| TODO | 当前证据 | 状态 |
|---|---|---|
| 编组框、拉环、空白点击 | 真实 Electron 走查覆盖：组内空白点击选中整组且两侧磁吸拉环=2；空白画布清掉工具条和拉环；再次点组框可恢复；组端口真手势落组后 0→4 条边，组框从虚线恢复实线。设计实验室 `canvas-frame` 8 格（含注册表、空框、有内容、拖入、拖出、折叠、菜单、镜头标签）全部通过。 | 已实现待提交 |
| 60 节点拖组性能 | 真实资产夹具 `mediaProfile=real-assets`：1920×1080 H.264 视频 + 1920px 图片，M 档实际选中 60、拖动 250 次；本次单次收据 `frameGapP95=10.1ms`、`maxFrameGap=39.4ms`、长任务数 0，边层 childList 314 发生在一次 settle 提交，96/96 边身份保持。单节点 I60 为 60 moves / childList 4 / P95 10.3ms，多选为 22 moves / childList 44 / P95 11.2ms；真实解码视频为 60 moves / childList 12 / P95 10.4ms，longTasks 均为 0。视频解码证据使用单独真实媒体场景，Windows、干净安装和供应商生成仍为 unverified。 | 已实现待提交 |
| 位置/选中单一 owner | React Flow 使用 `defaultNodes={flowNodes}` 加现有 `CanvasNodeProjectionSync`；position tick 只进入 React Flow kernel draft，删除逐帧 durable store 写入，节点最终位置在共享 settle 边界一次性写回，组拖动使用 DOM shell 预览后一次性 `moveGroupNodes`；选中组由单一 resolver 产出。单节点、多选和真实媒体样本没有 pointer-tick 级全画布级联重渲染，结构测试、相关单测、生产构建通过。 | 已实现待提交 |
| 编组工具条 | 真实 Electron 工具条可见并覆盖排列、生成整组、进时间轴、解组、下载、清选；新建和旧数据组默认归一为语义 `ocean` 海蓝，颜色菜单使用海蓝/青绿/琥珀/珊瑚/紫罗兰/玫瑰 token。设计实验室 `canvas-frame` 8 格通过。 | 已实现待提交 |
| Frame/Group 命名统一 | 编组用户文案已逐项改为“组/Group”，包括工具、空态、改名、说明、菜单、删除提示、工具条和连接提示；`Frame` 只保留在内部组件/模型标识（`GroupFrame`、`frameBounds`），不再作为用户可见名称。中英文走查均记录工具条文本。 | 已实现待提交 |

### 证据文件

- [编组工具条截图](/Users/aoqimin/.codex/worktrees/7e00/Nomi/tests/ux/shots/grouping-optimization/01-group-toolbar.png)
- [真实 1080p 媒体工具条截图](/Users/aoqimin/.codex/worktrees/7e00/Nomi/tests/ux/shots/grouping-real-media/01-real-media-group-toolbar.png)
- [真实媒体排列截图](/Users/aoqimin/.codex/worktrees/7e00/Nomi/tests/ux/shots/grouping-real-media/02-real-media-arranged.png)
- [组端口落点截图](/Users/aoqimin/.codex/worktrees/7e00/Nomi/tests/ux/shots/group-ports/04-group-drop-target.png)
- [真实性能 JSON](/Users/aoqimin/.codex/worktrees/7e00/Nomi/tests/ux/perf-results/canvas-grouping-real-1080p.json)

### 门岗结果

- `pnpm run build`：通过。
- 相关 Vitest：10 个文件、146 项通过；`selection-drag-lifecycle` 真实 Electron 合同 21/21 通过。
- `pnpm run check:test-waits`：通过，0 新增等待债。
- 设计实验室结构检查：23 屏/337 状态通过；编组专属 `canvas-frame` 视觉 8 格更新后复跑全绿。全量视觉仍有 `process-feedback`、`settings`、`storyboard` 等与编组无关的既有基线差异，本批不改它们。
- `pnpm run gates`：未宣称全绿；编组相关合同、token、结构门通过；全量门禁需在最新 origin/main 合并并提交后重跑，未把局部通过冒充全量绿。
- `pnpm run typecheck`：app、electron、electron-pi 和测试类型门全部通过；本批补齐了 `canvasDragWriteback.test.ts` 的旧 `moveNode` 测试夹具。
