# 编组画布方向检查（2026-10-06）

> 范围：编组交互、选择归属、工具条和总览图动作。该复盘对应本次提交的 `Direction-Check` trailer；结构性结论随 PR 交用户与 PR #1014 协调线复核。

## 先查别人

- 依赖里已有：React Flow 的选择与拖动边界见 [React Flow Adding Interactivity](https://reactflow.dev/learn/concepts/adding-interactivity)；画布接入点是 `src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlowViewport.tsx:30-70`。
- 仓库里已有：节点浮条 token/缩放外壳在 `src/workbench/generationCanvas/nodes/NodeFloatingToolbar.tsx:22-45`，菜单原子在 `src/workbench/generationCanvas/nodes/ToolbarActionMenu.tsx:5-35`；这次采用接入而不是重写。
- 生态里已有：菜单交互采用 [WAI-ARIA Menu Button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/)；这类通用交互不登记为领域自写。
- 用户参考：交互依据是用户提供的同类画布真实截图；没有把不可复核的自媒体内容当作验收证据。

结论：只登记 Nomi 独有的编组拖动语义和已选媒体总览图动作，通用行为继续由现有库和组件承载。

### 0. 一句话根因

画布的交互状态曾分散在 React Flow、画布 store 和工具条订阅中，导致同一用户意图被多个 owner 重复解释，表现为拖动重建、选择框分叉、工具条状态漂移和视觉补丁反复出现。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 编组框、拉环、空白点击 | 空白面与节点面没有稳定的事件边界 | 交互 owner 分裂 |
| 拖动 60 节点卡顿 | 拖动期间整层边和投影反复清空、重建 | 高频渲染边界错误 |
| 位置/选中 owner | store 动作和 React Flow 选择状态并存 | 状态双写 |
| 工具条、默认颜色、按钮间距 | 工具条未完全复用节点浮层原子与 token | 设计系统逃逸 |
| Frame/Group 命名 | 新旧文案和 aria 语义未共用一套动作定义 | 表示层漂移 |
| 选中后的“拼联系表”难以理解 | 动作名称把实现术语暴露给用户，节点类型/参数已在节点内 | 用户意图与动作表示不一致 |

### 2. 为什么这一类会一直出现

根因不是某个 if 漏掉，而是“画布状态、交互命中、视觉表示”没有在共享边界收敛：React Flow 已经拥有拖动与框选模型，store 又保留同类入口；工具条再订阅完整 store，导致高频 viewport 变化传播到不需要它的动作层。本次把 React Flow 作为选择与拖动唯一 owner，删除 store 的框选入口；工具条只接收调用方已经得到的 `canvasZoom`，避免重复订阅；组内空白和节点卡片在 DOM 边界上明确分流。

| 铁律 | 本次结论 | 最小证据 |
|---|---|---|
| ⑩ 说的=摆的 | 生成总览图只汇总已选节点的真实输出，不再引导重新选图片/视频模型 | `tests/ux/contact-sheet.walk.mjs` 实际 4 个素材节点、自然尺寸 1024×664、`nomi-local://` |
| ⑪ 能选到 | 编组、解组、存流程、总览图动作都同时有可见短标签、完整 title 和 aria-label | `check:controls`、i18n parity、真实 Electron walk |
| ⑫ 点了=以为的 | 空白组内拖动移动整组，节点卡片拖动只移动该节点；按钮顺序：常用在前、解组最右并用分隔线隔开 | `tests/ux/grouping-optimization.walk.mjs` 真实媒体走查及截图 |

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 任何新工具条订阅完整画布 store 都会在拖动时放大渲染次数 | `rg "useWorkbenchStore|useCanvasStore" src/workbench/generationCanvas/components`，并用 60 节点拖动记录 React commit 与 childList 变化 |
| 保留第二套框选入口会再次出现选中状态漂移 | 对 React Flow 框选、点击空白、撤销/重做跑同一组状态断言；只允许 React Flow 事件改变选择 |
| 只改可见文案而不改动作定义会出现中英文/tooltip/快捷键不一致 | `pnpm run check:i18n` 加 `check:controls`，并逐项核对 `aria-label` 与点击结果 |

### 4. 靶子独立性检查

- 交互走查和生产组件由实现线完成；PR #1014 协调线负责独立验收，当前没有把实现线结果冒充独立验收。
- 设计实验室保留 `canvas-grouping` 为待用户拍板的真实组件样张，没有把手写 HTML 当成生产通过证据。
- 全量门中已有 11 张其他设计实验室 baseline、3 个其他 walkthrough baseline 漂移和 concept-owner 历史告警；它们不被本次编组验收吞掉，也没有为绿灯修改。

### 5. P0：这些是我们独有的吗？现成方案有哪些

节点拖动、框选、菜单键盘行为和工具条原子是通用能力，继续使用 React Flow 与现有 `NodeFloatingToolbar` / `ToolbarActionMenu` / `ToolbarButton`。领域自写仅限“已选媒体节点生成总览图”“编组内空白拖整组、节点拖单节点”的 Nomi 语义，已登记为 `canvas-group-toolbar-actions`（`docs/engineering/self-written.json`）；当现有节点动作模型覆盖该语义后应删除登记。

### 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | React Flow 继续作为选择、框选、拖动 owner；复用 Nomi toolbar 原子 | 需要迁移旧 store 调用 | 低，边界可测 | **推荐** |
| 补 | 在 store 上继续加同步和节流 | 短期改动小 | 双写和高频订阅继续存在 | 不选 |
| 重写（限一个模块） | 重写整个画布事件层 | 高回归和视觉成本 | 破坏已有节点能力 | 不选 |
| 删 | 删除重复 store 框选入口、重复组内标题胶囊和误导性动作名 | 需更新旧测试 | 若遗漏调用点会编译失败，正好可被门禁发现 | 已执行 |

### 7. 用户要权衡的核心

用 React Flow 的单一 owner 换取稳定的拖动性能和可预测交互，同时保留一轮真实媒体走查与 PR #1014 独立验收作为合入前门槛。

### 特征测试清单

- `tests/ux/grouping-optimization.walk.mjs`：真实 1080p 媒体、组内空白拖整组、节点卡片拖单节点、工具条菜单和 aria。
- `tests/ux/contact-sheet.walk.mjs`：真实素材生成总览图、自然尺寸、`nomi-local://` 输出和截图。
- `src/workbench/generationCanvas/store/generationCanvasStore.test.ts`：删除重复框选入口后的 store contract。
- `pnpm run check:controls`、`check:i18n`、`check:tokens`、`check:icons`、`check:framework-boundary`、`check:heavy-path`：设计系统与边界门。
- 未钉住：全量设计实验室和 walkthrough 的历史 baseline 漂移，列为合入前独立处理项，不伪装成编组通过。

### 5. 2026-10-06 用户拍板后的收敛（L-group 接手本 PR）

| 拍板 | 做了什么 | 不留的并行版 |
|---|---|---|
| 批量生成只走组：「本来这些节点模型已经选择好了，只要编组弄好，他直接生成全部就好了」 | 删画布底部批量栏（按类型统一换模型 + 「并发」+「生成全部」）、框选浮条上的「生成选中 N 个」及其模型下拉 / 并发下拉、⌘Enter「生成所选」；「生成整组」逐个节点用**节点自己已选好的模型和参数**，不弹模型选择、不改模型，并发交给调度器默认值（用户不再选） | `CanvasBatchGenerateDock`、`CanvasProductionControls`、`CanvasBulkModelSelect`、`useCanvasProductionActions`、`useCanvasBatchDockVisibility`、`canvasBatchModelLabel` 整条删；旧 `nomi.canvas.batch-concurrency` 偏好不再读写 |
| 组色方案 B | 默认中性灰；可选色只上边框和标题前小圆点，不做底色填充；老项目旧 `NodeGroup.color` 不上色，只认新字段 `colorToken`（读盘归一化 + 单测「旧项目打开组仍是灰」） | 旧 `groupColorStyle` 行内样式（底色 `color-mix` 把七色都算成粉红的 bug 随之消失）、`LEGACY_COLOR_ALIASES` 十六进制映射 |
| UI 统一规范 | 决定栏主动作最右、取消在左；动作条常用在前、删除类最右并用分隔线隔开；「✓」只表状态不当动作图标；同类控件全仓一个组件 | 框选浮条的「清除选择」改用与组工具条同一个 `ToolbarIconButton`（原来是另一个 `WorkbenchIconButton`，同条里高度 28/32 不齐）；`ToolbarButton` 去掉只给总览图用的 `dataContactSheet` 属性 |

类根因：这批问题的共同形状是「同一个用户意图有两个入口、各自推导一份」——批量生成既在底栏又在浮条又在组上；可生成集合在工具条可用态（按选中节点）和点击派发（按组成员）各算一遍。收敛后只剩 `groupEligibleNodeIds` 一份，工具条可用态与派发共用。
