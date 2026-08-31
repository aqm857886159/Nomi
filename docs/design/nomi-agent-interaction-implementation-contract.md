# Nomi 统一 Agent 交互：样张到代码的精准实现合同

> 日期：2026-08-30
> 阶段：样张已确认，本文是进入生产实现前的代码合同与对比验收方案。
> 范围：网页/桌面端；不包含移动端断点、触屏分支或生产提交/推送。

## 1. “精准实现”在本项目里的定义

精准不是把 HTML 的像素硬抄进 React，而是让同一个输入、状态和事件，在真实 Nomi 的布局约束下得到同一组可观察结果：

1. 生成与预览都保持“上方工作面 + 下方主时间线”；时间线横向占满 Host，不与右侧 Agent Dock 抢列宽。
2. 时间线高度由一个可验证的会话状态驱动。拖动或键盘调整时，时间线向上扩展，上方画布/播放器缩小；Dock 的底边始终贴着时间线上沿。
3. 创作、生成、预览和独立浏览器入口共享 Thread、任务、队列、授权和产物状态；就近引用对象不同，但发送时冻结同一份快照。
4. 每个看起来能操作的控件都有可观察结果、键盘路径和 ARIA 状态；做不到的动作必须明确降级为示意。
5. 画布/时间线等专业工作面是真相源，聊天只做任务索引和回执；Agent 不得通过切面重建或标题变化伪装成状态同步。

因此，验收不能只看“截图像不像”，还要同时对账 DOM 几何、状态迁移、键盘/ARIA 和真实数据的最坏宽度。

## 2. 真实代码对账：现有接口与缺口

| 样张区域/行为 | 真实代码锚点 | 当前事实 | 精准实现动作 |
|---|---|---|---|
| 生成区上方画布、下方时间线 | `src/workbench/generation/GenerationWorkspace.tsx:80-83,107-183` | 已有 grid 行 `minmax(0,1fr) + --workbench-timeline-height`，底部挂 `TimelinePanel`；默认 `timelinePanelCollapsed=true` | 保留现有 `TimelinePanel`，把行高改为共享的可调状态；决定是否把默认收起改为样张的默认展开 |
| 预览区上方播放器、下方时间线 | `src/workbench/preview/PreviewWorkspace.tsx:70-96` | 已有通栏时间线，使用独立 `--workbench-preview-timeline-height`，预览额外显示文字轨 | 改为同一套时间线布局接口；保留 `showTextTrack` 差异，不复制第二个时间线实现 |
| Agent Dock 340px 与时间线让位 | `src/workbench/generation/GenerationWorkspace.tsx:35-83`、`src/workbench/workbench-ai.css:37-61` | `assistantWidth` 默认 340，可拖到 300–600；浮动 Dock 已用 `bottom: var(--workbench-timeline-height)` 避开时间线 | Dock 宽度继续由 `assistantWidth` 驱动；底部偏移必须引用实时时间线高度，不能再写死 188/222/260 |
| 三个顶层工作区的切换 | `src/workbench/WorkbenchShell.tsx:132-165,239-262` | `WorkspaceSlot` keep-alive，工作区可保留挂载；但生成助手和创作助手分别来自不同 store，预览没有同一个 Agent Dock | 增加一个高层 Agent Host/会话适配器；工作区只提供就近 surface adapter，不得各自创建第二个 Thread |
| 统一 Thread/任务/授权/产物 | `src/workbench/workbenchStore.ts:83-195,250-352`、`src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx:152-170`、`src/workbench/creation/CreationAiPanel.tsx:94-110` | 创作态在 `useWorkbenchStore`，生成态在 `useGenerationCanvasStore`；两边 draft/messages/折叠态不在同一模型 | 将 Agent 会话、Turn 快照、任务/队列引用放到统一会话模块；surface-specific draft 只能作为适配层，不得成为身份真相源 |
| 时间线编辑/播放/回滚 | `src/workbench/timeline/TimelinePanel.tsx:70-210`、`src/workbench/workbenchStore.ts:451-750`、`src/workbench/preview/PreviewWorkspace.tsx:35-67` | Timeline 数据、播放头、撤销栈和播放推进已有单一 store；TimelinePanel 还处理键盘编辑 | 新增高度控制只改变布局 UI 状态，不进入 `timeline` 数据、撤销栈或持久化产物 |
| Token/控件/圆角 | `docs/design/nomi-design-system.md:216-218,338-357,397-423`、`src/design/workbenchActions.tsx:19-76`、`src/workbench/workbench.css:1-55` | token/Workbench primitives 已存在；工作区历史控件为 32px，样张本轮合同是常规控件 28px、控件圆角 6px | 生产实现必须通过现有 token/primitives 映射；不能在组件里新增裸 hex、裸圆角或第二套图标语言 |

### 2.1 已经能够直接复用的深模块

- `TimelinePanel` 是时间线行为的深模块：选片、播放头、分割、复制、撤销/重做、文字轨和生成回填都已经在同一接口后面。高度拖动不应进入它的 clip 编辑逻辑。
- `useWorkbenchStore.timeline` 是跨生成/预览的时间线真相源；新增的是布局状态，不是新的 timeline 数据结构。
- `assistantWidth` 的 setter 已有 300–600px clamp；样张的 340px 只应作为默认几何和验收值。
- `WorkspaceSlot` 已提供 keep-alive 语义，但 keep-alive 不是统一 Agent 身份。统一身份必须放在更高的会话 seam，而不是依靠两个面板互相同步标题。

### 2.2 当前不能冒充“已精准实现”的地方

- 真实生产预览面目前直接渲染 `PreviewWorkspace`，没有样张中的统一 Agent Dock。
- 创作与生成助手分别持有消息、草稿和折叠态；它们不是一个可跨面切换的 Thread 模型。
- 真实时间线高度目前是两个 CSS 变量（生成约 188px、预览约 222px），还没有样张要求的共享可调高度和分隔条。
- 样张里的 `data-snapshot`、浏览器选区和跨面定位仍是演示状态，不能算真实 Thread/Turn/授权/产物 ID。

## 3. 几何合同（实现必须由这些不变量推出）

设 Host 内容区尺寸为 `W × H`，Agent Dock 宽度为 `D`，时间线高度为 `T`：

```text
T = clamp(timelinePanelHeight, 140, 300)
upperHeight = H - T
dock:     right = 0, top = 0, bottom = T, width = D
timeline: left = 0, right = 0, bottom = 0, height = T
workface: left = 0, right = D (Dock 展开时), top = 0, bottom = T
```

必须满足：

- 生成与预览的 `timeline.getBoundingClientRect().width` 等于 Host 内容宽度（允许 1px 浮点误差）。
- Dock 展开时，`dock.bottom === timeline.top`；Dock 收起时，上方工作面恢复全宽，时间线宽度不变。
- 时间线高度变化只改变 `T` 和上方工作面高度；不得改变播放头、clip 起止帧、撤销栈、任务状态或产物落点。
- 生成↔预览切换时使用同一 `timelinePanelHeight`，因为两面编辑的是同一条主时间线；离开这两个工作区或新建 Host 是否重置，按下节状态合同处理。
- `min-height: 0` 必须落在 Host、工作面、Dock、TimelinePanel 的滚动链上，避免长 Thread/长技能名把行撑破。

## 4. 状态合同与事件接口

### 4.1 状态归属

建议在 `useWorkbenchStore` 增加布局状态（会话级 UI 态，不进入 `timeline` 和时间线撤销栈）：

```ts
type TimelinePanelLayoutState = {
  heightPx: number       // 默认 206；只允许 140–300
  collapsed: boolean     // 与现有 timelinePanelCollapsed 合并，不保留两份
}

setTimelinePanelHeight: (heightPx: number) => void
resetTimelinePanelHeight: () => void
setTimelinePanelCollapsed: (collapsed: boolean) => void
```

不变量：

- setter 内部 `Math.round + clamp`，调用方不能绕过 clamp 写 CSS。
- `heightPx` 不 bump `persistRevision`，不进入项目文件，不进入 Agent Turn 快照；它是布局习惯，不是作品数据。
- 生成和预览都订阅同一 selector；不可各自 useState 一份高度。
- 同一 Host 内生成↔预览保留高度；刷新、新建 Host 或离开生成/预览后是否 reset 必须由一个明确的 Host 生命周期处理，不能由某个 tab 的 mount/unmount 偶然决定。

### 4.2 分隔条接口

新增一个窄而深的 `TimelineResizeHandle` module（建议放 `src/workbench/timeline/`），它只负责布局输入：

```ts
type TimelineResizeHandleProps = {
  value: number
  min: number
  max: number
  onChange: (next: number) => void
  onCommit?: () => void
}
```

行为：

- DOM：`role="separator" aria-orientation="horizontal" aria-valuemin aria-valuemax aria-valuenow tabindex="0"`。
- Pointer：按下记录 `startY/startHeight`，使用 pointer capture；`next = startHeight + (startY - clientY)`；pointerup 一次 commit。
- Keyboard：ArrowUp/Down 以 16px 步进，Home=min，End=max；每次更新可见 status 回执。
- 双击回到默认 206px；焦点环必须可见，不能只依赖 hover。
- `prefers-reduced-motion` 下取消高度过渡，保留即时几何变化和 status 文案。

### 4.3 Agent Host seam

样张的 Dock 不能继续只作为 `generationAi` prop 传给 `GenerationWorkspace`。生产实现需要一个高层 seam（名称可调整，但接口职责不可减）：

```ts
type AgentHostContext = {
  projectId: string | null
  threadId: string
  surface: 'creation' | 'generation' | 'preview' | 'browser'
  taskId?: string
  queueIds: string[]
  authorization: AuthorizationState
  artifacts: ArtifactSummary[]
}

type AgentHostProps = {
  context: AgentHostContext
  onSurfaceRequest: (request: SurfaceRequest) => void
  surfaceAdapter: SurfaceAdapter
}
```

`AgentHost` 负责身份、Thread/Turn、队列、授权、快照和 Dock 的显示/收起；`SurfaceAdapter` 只负责把“当前画布对象 / 文本选区 / 预览帧 / 时间线区间 / 网页选区”转换为引用和定位请求。不得让 adapter 复制消息列表或改变产物真相源。

## 5. 样张到生产组件的落点顺序

1. **状态 seam**：在 `useWorkbenchStore` 增加高度 clamp、reset 和测试；合并现有 `timelinePanelCollapsed` 的唯一写入口。
2. **布局深模块**：抽出生成/预览共用的 Host timeline row + Dock bottom offset；删除两面各自的硬编码行高并保留 `showTextTrack` 这种内容差异。
3. **分隔条**：挂在两个工作区同一语义位置，不能为生成和预览造两份互不相同的拖动逻辑。
4. **Dock 适配**：让 Dock 的 `bottom/max-height` 引用实时高度；上方消息区 `min-height:0`，长 Thread 使用内部滚动。
5. **统一 Agent Host**：把创作/生成现有面板的消息、draft、附件和 session 逐步接到统一 Thread/Turn 模型；预览和浏览器只接入 surface adapter。
6. **引用与快照**：发送前将文字、附件、五类引用、技能、提示词、工作方式/授权、模型覆盖、surface 和目标组成不可变 Turn snapshot；回显只读展示 snapshot。
7. **视觉对账**：只使用 `--nomi-*`/`--workbench-*` token、Workbench actions 和现有 Tabler 图标；任何新 CSS 同时删除被替代的旧规则。

## 6. 精准对比验收（同一入口、同一构建、同一视口）

### 6.1 几何断言

在桌面 1280×720 视口、同一项目和同一 Host 数据下，分别从刷新状态进入生成、预览：

- `timeline.width === host.width ± 1px`，不出现水平滚动。
- `dock.width === 340px ± 1px`（拖宽测试另测 clamp）。
- `dock.bottom === timeline.top ± 1px`。
- `upper.bottom === timeline.top ± 1px`。
- 默认 `aria-valuenow === 206`；ArrowUp 三次为 254；End 为 300；Home 为 140；双击回 206。
- 生成→预览后 `aria-valuenow` 与时间线 top 不变；刷新后按 Host reset 合同回到 206。

### 6.2 行为断言

- 等待一个 event loop 后，分隔条和所有 Dock 菜单的焦点落到预期元素；Escape 返回原触发器。
- Dock 收起/恢复只改变 Dock 和上方工作面的可用宽度，不改变时间线宽度、播放头和 Thread。
- 生成画布引用、预览帧引用、时间线区间引用、创作段落引用、网页选区引用都能在发送回显中看到冻结 snapshot。
- 技能 token、提示词 token 删除后回到默认；空输入、仅引用、附件输入的发送/禁用状态与样张一致。
- 切换 Thread 后 surface、context、reply、任务和产物定位一起变化，不能只改标题。
- 真实长文案（长 Thread、长技能名、长模型覆盖 0–5）下 Dock 内部滚动，不挤压或遮住时间线。

### 6.3 截图对比

每次生产实现都必须从与样张相同的入口截取四张图：

```text
06-generation-default.png
07-generation-timeline-expanded.png
04-preview-default.png
05-preview-timeline-expanded.png
```

对比顺序：

1. 先看 Host 外框、上/下分区和 Dock 底边是否一致。
2. 再看时间线宽度、分隔条位置、播放器/画布让位是否一致。
3. 最后看字体、token、控件高度、圆角和焦点态。

截图对比只接受同一构建、同一字体、同一资源和同一视口；开发服务器未启动、手工拼 DOM 或不同数据源的截图不能作为精准实现证据。若引入像素 diff 工具，阈值必须记录在测试中，不能凭肉眼改到“差不多”。

## 7. 当前可实现性结论

- **布局可实现：**真实生成/预览代码已经具备底部 TimelinePanel、`minmax(0,1fr)` 行和 340px Assistant 宽度基础；新增共享高度和 Dock bottom offset 是局部可验证改动。
- **统一 Agent 尚未实现：**当前生成/创作助手的消息与草稿分属不同 store，预览没有同一个 Dock；必须先落 Agent Host seam，不能只复制样张 HTML。
- **视觉精度可验：**样张已经保存生成/预览默认与扩展四张对照图；生产实现后应在同一桌面入口重跑第 6 节，几何断言和目视截图两者都通过才算精准。
- **本轮不做的事：**不在本合同中伪造真实 Thread/Turn/授权 ID，不把样张 `data-snapshot` 当持久化实现，不提交、不推送、不更新 PR。

## 8. 进入生产实现前的单一拍板点

样张当前假设“时间线默认展开、默认 206px”。真实 store 当前默认 `timelinePanelCollapsed=true`。两者若要精准一致，生产实现必须明确选择：

- 采用样张：默认展开并以 206px 起步；或
- 保留真实默认收起：同步修改样张和截图合同。

这个选择会直接改变刷新状态截图和用户第一眼看到的工作面，不能在实现时静默带过。
