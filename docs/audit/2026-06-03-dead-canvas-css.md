# Audit：废弃旧画布（tc-canvas / React Flow）死 CSS 清理

> 触发：React Flow 迁移决策评审中，6 角色 agent 多次指出 `src/styles.css` 等处有
> "孤儿 `.react-flow__*` CSS——上一代画布残留，违反规则 1（加新必删旧）的并行残余"。
> 实际核查发现：远不止"8 个孤儿选择器"，而是**一整套废弃的旧 `tc-canvas` 画布
> 的完整 CSS 层**（节点/handle/group/性能/连线主题）。

## 背景事实（已核实）

- `reactflow` / `@xyflow` **不是依赖**（`package.json` 无）→ 没有任何运行时会产生
  `.react-flow__*` 类 → 所有 `.react-flow__*` CSS 可证明是死的。
- 旧画布类 `tc-canvas` / `tc-handle` / `tc-handle-layer` / `tc-group-node` /
  `tc-task-node` / `task-node-image` / `tc-ai-chat` 在**任何 TS/TSX 里 0 引用**。
- gating data 属性 `data-canvas-viewport-moving` / `data-heavy-selection` /
  `data-connecting-active` / `data-viewport-moving` / `data-dragging` 在**任何
  TS/TSX/HTML 里 0 设置**（核查命令见文末）。
- 当前真实画布是自研的 `generationCanvas`（类名前缀 `generation-canvas-v2__*`），
  与上面这套 `tc-*` 旧画布无任何共用类。

结论：这些 CSS 可证明不可达（依赖没装 + 类名/属性 0 引用），删除**不可能**改变任何
渲染结果——属于真正的"无悔删除"。

## 范围

### Tier 1（本次执行——自包含、铁死）
1. **`src/styles/performance.css` 整文件删除（179 行）**：每条规则都 gated 在
   `data-canvas-viewport-moving` / `data-heavy-selection` / `data-connecting-active`
   或 `.tc-canvas` / `.react-flow__*` / `.tc-handle` 上，全部 0 引用 → 整文件死。
   同步删 `src/styles/index.css:7` 的 `@import './performance.css'`。
2. **`src/styles/vendor-overrides.css` 外科切**：删 React Flow 段
   （`.react-flow__node-*` reset、background、minimap/controls 定位、pane focus、
   edge-path、handle 命中区，及 light theme 的 react-flow controls/minimap/selection/
   handle/edge 段、`[data-dragging] .react-flow__node`、`.tc-canvas[data-viewport-moving]`
   perf 段）。**保留** Mantine / webkit 滚动条 / `[data-compact]` 段（这些是活的）。
3. **死 marquee 框选**（`generationCanvas`，从未触发——`setSelectionBox` 只被传过
   `null`）：
   - `components/GenerationCanvas.tsx`：删 `selectionBox` state、`boxSelectRef`、
     `selectNodesInRect` 订阅、`setSelectionBox(null)` 调用、`<div>` 渲染块。
   - `store/generationCanvasStore.ts`：删 `selectNodesInRect` action（接口 + 实现）
     及仅其使用的 `GenerationCanvasSelectionRect` 类型（若无其它引用）。

### Tier 2（单独立项——不在本次）
- `src/styles.css`（8867 行）中散落的整套 `tc-*` 旧画布 CSS：~527 个选择器行提到
  旧画布类，含规则体估计 1500+ 行（`.tc-canvas*`、`.tc-handle*`、`.tc-group-node*`、
  `.tc-task-node*`、`.tc-ai-chat*`、`task-node-image*`、`.react-flow__*` 复合段、
  `.tc-handle--snap`、`.tc-spotlight*` 变量等）。
- 为什么单独做：在最大的 CSS 文件里删 1500+ 行，需逐类核验"确无活引用"+ 注意
  `.tc-handle` 这类可能与活类有部分前缀重叠，属于规则 4 级别的审计，不能当顺手小切。

## 不动什么
- `generationCanvas` 的活样式（`generationCanvas.css`、`generation-canvas-v2__*`）。
- `vendor-overrides.css` 的 Mantine / 滚动条 / compact 段。
- 任何运行时逻辑、持久化 schema、runner。

## 回滚策略
- 纯删除，无新增。`git checkout -- <file>` 即可逐文件回滚。
- Tier 1 全部为可证明不可达的 CSS + 从未触发的死代码，回归面 = 0。

## 验收门
- `pnpm build`（vite + electron tsc）绿。
- `npx vitest run` 绿（尤其 `generationCanvasStore.test.ts`、`generationCanvasSchema.test.ts`）。
- 删后再 grep `react-flow` / 上述 gating 属性：Tier 1 涉及文件应 0 残留。

## 执行结果（Tier 1，2026-06-03 回填）
- ✅ 删 `src/styles/performance.css`（179 行）+ 去 `index.css` 的 import。
- ✅ `vendor-overrides.css` 重写为只剩活段（Mantine/滚动条/compact），删尽 React Flow 规则；
  412 行 → 约 215 行。
- ✅ `GenerationCanvas.tsx`：删 `selectionBox` state / `boxSelectRef` /
  `selectNodesInRect` 订阅 / `setSelectionBox(null)` / `<div>` 渲染块。
- ✅ `generationCanvasStore.ts`：删 `selectNodesInRect` action + 连带死的
  `nodeIntersectsRect` helper + `GenerationCanvasSelectionRect` import。
- ✅ `generationCanvasTypes.ts`：删 `GenerationCanvasSelectionRect` 类型。
- ✅ 验收门：`pnpm build` 绿（vite + electron tsc）；`npx vitest run` 绿（48 文件 / 415 测试）。
- ✅ 残留核查：`selectNodesInRect|selectionBox|boxSelectRef|nodeIntersectsRect|
  GenerationCanvasSelectionRect|performance.css` 在 src 内 0 残留。

## 执行结果（Tier 2，2026-06-03 回填）

**方法**：写了一个**括号感知**的 CSS 解析器（`/tmp/css_clean.py`，非正则盲删），把
`styles.css` 解析成顶层规则 + 下钻 `@media`/`@supports`，对每条规则按选择器前缀判定
"旧画布死 / 活"，并**统计活规则消费了哪些 `--tc-*` token**——确保不误删活代码仍用的变量。

**判定面（每个前缀都 grep 核验 0 活引用）**：

| 选择器族 | styles.css 选择器行 | DOM 引用（tsx/ts/html） | 判定 |
|---|---|---|---|
| `.react-flow__*` | 6 | 0（RF 非依赖） | 死，删 |
| `.tc-canvas*` | 72 | 0 | 死，删 |
| `.tc-task-node*` / `task-node-image*` | 73 | 0 | 死，删 |
| `.tc-handle*`（含 `--snap`/`--wide`/`-layer`） | 67 | 0 | 死，删 |
| `.tc-group-node*` | 3 | 0 | 死，删 |
| `.tc-connection-line` | 1 | 0 | 死，删 |
| `.tc-ai-chat*`（旧 AI 聊天） | 359 | 0（仅 motionPresets.ts 一处**注释**提名） | 死，删 |
| `.tc-storyboard-editor*`（旧分镜编辑器） | 168 | 0（活分镜全在 generationCanvas） | 死，删 |
| `.tc-local-pipeline-modal*` | 80 | 0 | 死，删 |
| `.tc-pm*`（旧项目管理面板） | 52 | 0 | 死，删 |
| `.tc-spotlight*`（规则体，非变量） | — | 0 | 死，删 |

**混合选择器列表审计**（防误杀）：解析器找出 6 条死规则的选择器列表里"混着别的类"——
逐一核验那些类（`.control-chips-menu-dropdown` / `.control-chips-menu-item` /
`.top-toolbar*`）**也都 0 DOM 引用**（旧 task-node 工具条 / 控制条菜单残留），故整条删除，
无需保选择器外科手术。无 MIXED `@media`（6 个含死规则的 `@media` 全是 ALL-DEAD，整壳删）。

**保留的 `--tc-*` token（活代码仍消费——本次不动，规则警示项）**：
解析器报告活规则消费这些 token，其 `:root` 定义块**全部保留**：
`--tc-color-surface-inline`(活用 7 + vendor-overrides.css:33)、`--tc-color-surface-inline-weak`(7)、
`--tc-color-surface-raised`(3)、`--tc-color-app-bg`(2)、`--tc-ai-chat-reserved-width`(2，
活布局留位变量，非死类)、`--tc-color-app-bg-strong`/`--tc-color-surface`/`--tc-color-text-primary`(各 1)。
- `--tc-control-chips-model-max-width`：活规则 `.control-chips-menu--model` 用它，但**原文件从无定义**
  （`var(..., 220px)` 带 fallback，删前删后行为一致 = 恒 220px），无回归。
- 注：`--tc-radius-*`/`--tc-space-*`/`--tc-font-size-*`/`--tc-snap-*`/`--tc-gen-overlay-*`/
  `--tc-spotlight-*`/`--tc-ai-chat-surface-*` 等 token 删除后已无活内部消费者（仅外部
  `workbench.css`/`workbench-ai.css`/`animations.css` 中**同样作用于死 `.tc-ai-chat`/
  `.tc-task-node` 选择器**的死规则引用）。这些是**共享 token 词表**而非画布组件 CSS，且涉及
  跨文件外部引用——**留作独立清理**，不在"旧画布死 CSS"本次范围（避免规则警示的误删）。

**`.tc-panel-card`**：核验为**活**（`src/design/surfaces.tsx:34` + `vendor-overrides.css`），
且**不在 styles.css**（在保留的 vendor-overrides.css 段），未受影响。

**删除量**：`styles.css` **8867 → 4797 行**（`git diff --numstat`：+332 / −4402，净 −4070）；
648 条死规则 + 6 个 ALL-DEAD `@media` 壳，合并为 10 个连续删除区间（旧画布 CSS 实际是聚簇的，
非完全散落）。

**验收门**：
- ✅ `pnpm build` 绿（vite ~5s + electron tsc，锚定 impl 工作树绝对路径执行）。
- ✅ `npx vitest run` 绿（48 文件 / 415 测试，与 Tier 1 基线一致）。
- ✅ 括号平衡校验 `{` − `}` = 0；clean 文件 0 条死类选择器残留。
- ✅ 残留核查：`tc-canvas|tc-task-node|tc-handle|tc-group-node|tc-connection-line|
  tc-ai-chat|tc-storyboard-editor|tc-local-pipeline-modal|tc-pm[_-]|tc-spotlight|
  react-flow__|task-node-image` 在 styles.css 中仅剩 `--tc-ai-chat-reserved-width`
  **活 token**（变量名子串命中，非死类）。

**回滚**：纯删除，`git checkout -- src/styles.css` 即可。

**后续（独立任务，本次不做）**：
1. `workbench-ai.css`(757 行) / `animations.css` 里作用于死 `.tc-ai-chat*` / `.tc-task-node*`
   选择器的死规则 + `workbench.css:45` 的 `--tc-spotlight-grid-color` 死定义。
2. styles.css `:root` 里删除后已无活消费者的孤儿 `--tc-*` token（需先确认外部文件无引用）。

---

**Tier 2 历史背景**（散落 styles.css 的 `tc-*` 旧画布生态）——原始范围说明保留如下：

## 核查命令（可复现）
```
rg -n "reactflow|xyflow" package.json                      # 无 → RF 非依赖
rg -l "tc-canvas|tc-handle|tc-task-node|tc-group-node" src -g '*.tsx'   # 无 → 类名死
rg -n "data-canvas-viewport-moving|data-heavy-selection|data-connecting-active" src electron index.html | grep -v '\.css:'   # 无 → 属性死
```
