# 编组交互与生产组件设计

这份设计把 LibTV 的可验证交互顺序与 Nomi 现有节点浮条的视觉语法合在一起。实现合同是生产 React 组件，不是手写 HTML mock：`CanvasGroupToolbar` 复用 `FloatingToolbarShell` 的 token、按钮和菜单原子，`GroupFrame` / `GroupFrameHeader` 负责组框和框外标题，React Flow 只负责节点手势投影。旧的 store 级 `selectNodesInRect` 已删除，选择只保留 React Flow 这一条运行时 owner，避免自定义框选与内核选择各维护一份状态。

## 先查别人

- 依赖里已有：React Flow 的节点选择、框选和拖动事件来自 [React Flow Adding Interactivity](https://reactflow.dev/learn/concepts/adding-interactivity)；生产宿主入口在 `src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlowViewport.tsx:30-70`。
- 仓库里已有：`NodeFloatingToolbar` 的 token 外壳、反向缩放和锁边界在 `src/workbench/generationCanvas/nodes/NodeFloatingToolbar.tsx:22-45`，`ToolbarActionMenu` 的菜单触发器在 `src/workbench/generationCanvas/nodes/ToolbarActionMenu.tsx:5-35`，本设计直接复用它们。
- 生态里已有：菜单键盘和无障碍命名遵循 [WAI-ARIA Menu Button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/)，不再创建第二套通用菜单。
- 用户参考：LibTV 的组内空白/节点拖动分流、默认中性灰和工具条动作顺序来自本会话提供的真实参考截图；未用无法复核的自媒体文章替代真实组件走查。

结论：通用能力接入 React Flow、WAI-ARIA 语义和 Nomi 现有 toolbar 原子；新增部分只表达编组和已选媒体总览图的领域语义。

## 交互地图

| 状态 | 用户动作 | 结果 | 反馈 |
|---|---|---|---|
| 未选中 | 点击组内空白 | 选中整组 | 组框边界、框外标题和工具条出现；组成员保持节点选中态 |
| 未选中 | 点击节点卡片 | 只选中节点 | 节点浮条出现；不会因为节点属于某组而自动拖动整组 |
| 组已选中 | 在组框空白处按住拖动 | 整组移动 | 所有成员和组框同位移，拖动中只做视觉草稿，松手一次性写回 |
| 组已选中 | 在节点卡片上按住拖动 | 只移动该节点 | 组框实时更新；跨入/离开组时显示加入/移出预览 |
| 组已选中 | 点击框外空白 | 清除组选择 | 工具条、边界强调和拉环一起消失 |
| 组已选中 | 点击框外标题 | 进入标题编辑 | 回车/失焦提交，Esc 取消；标题仍在框外，不遮节点内容 |
| 组已选中 | 点击 ⋯ | 打开上下文菜单 | 改名、说明、折叠、生成整组等动作集中在一个菜单 |
| 组已选中 | 拖动节点到另一组 | 预览归属变化 | 目标组强调，计数显示松手后的结果；松手才提交成员关系 |
| 组已选中 | 点击连接拉环 | 进入连线 | 组是连线落点/来源，待连状态下组框不再响应整组拖动 |
| 组已选中 | 点击工具条颜色 | 选择语义色 | 菜单使用 `menuitemradio`；默认中性灰，颜色只表达归属，不抢选中强调色 |
| 组已选中 | 点击工具条排列 | 选择网格/横向/纵向 | 复用现有排列模型，一次性更新成员位置 |
| 组已选中 | 点击整组生成/时间轴/解组/下载 | 调用现有动作 owner | 主动作有文字，次动作有 icon 和 title；不可用时保留位置并说明 disabled |

## 视觉合同

- 工具条沿用 `NodeFloatingToolbar`：`rounded-nomi`、`border-nomi-line`、`bg-nomi-paper`、`shadow-nomi-md`、`min-h-9`、16px Tabler icon、8px 密度；在画布缩放时反向缩放，屏幕尺寸恒定。
- 工具条顺序固定为：明确的 Stack 编组标题（组名和成员数）→ 颜色（图标+文字+下拉）→ 排列（图标+文字+下拉）→ 分隔线 → 主动作“生成整组” → 时间轴/解组 → 分隔线 → 下载。动作顺序与 LibTV 的颜色、排列、主动作、次动作、下载层级一致，同时保持 Nomi 节点浮条的文字可辨识性。
- 临时多选工具条不再把高频动作藏在无名图标里：总览图用多张卡片图标和短标签“总览图”，数量与完整后果放在 title/aria-label（“生成总览图（N 张）”）；保存流程用“存流程”，创建/解除编组用“编组/解组”，完整动作名同样保留在 title/aria-label。只有“清除选择”保留关闭图标，并提供 title/aria-label。
- 组标题在框外，使用 Stack 图标和组名；框内不再放重复的左上角胶囊。折叠和更多操作仍在标题区域，避免把节点内容当作工具栏背景。
- 默认组色为 LibTV 可见的中性灰；语义色通过 `groupColorStyle` 和设计 token 提供。选中时边框的 accent 只表示当前交互状态，不能与默认颜色混淆。
- 所有菜单走 `ToolbarActionMenu` / `WorkbenchMenu`，不用第二套下拉；生产截图必须来自真实画布、真实节点组件和真实资源路径。

## 状态与性能边界

拖动期间 React Flow 内核持有草稿位置，DOM 组框只做投影；durable store 在 settle 边界一次性写入。组框空白拖动和节点卡片拖动是两条互斥入口，不能再通过“所有选中节点”推断整组拖动。验收要求真实 Electron、真实图片和 1920×1080 视频资源，记录 frame gap、long task、childList 变更和成员身份保持；synthetic fixture 只能作为补充证据。

## 验收清单

1. 中文和英文都能通过标题、Stack 图标、颜色/排列文字区分“编组工具条”和节点工具条。
2. 默认中性灰在新建组、旧数据归一化、颜色菜单和真实截图中一致。
3. 组内空白拖动整组，节点卡片拖动单节点；两条路径分别有真实位置断言。
4. 框外标题、折叠、更多、拉环、工具条和空白清选在同一个真实窗口闭环通过。
5. 真实媒体拖动达到当前 60 节点预算：frame gap P95 ≤ 22ms、long task ≤ 3，且节点/边 identity 不因 pointer move 被重建。
