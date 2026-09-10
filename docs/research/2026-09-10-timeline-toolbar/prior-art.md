# 时间轴工具条与面板折叠：先查别人（2026-09-10）

> 服务于 `docs/plan/2026-09-10-timeline-toolbar-row-collapse.md`。
> 要回答的问题只有两个：**剪辑器的时间轴工具条到底放在哪一层**，**面板的「收起」按惯例长什么样**。

## 1. 仓库里已有？

- **折叠原子已经有了，不用新造。** 属性面的头部折起钮就是 `WorkbenchIconButton` + `IconChevronDown`：
  `src/workbench/preview/inspector/PreviewInspector.tsx:80`。收起后的图标条是 `src/workbench/preview/PanelRail.tsx:9`。
  画布分组的折叠钮同样走 `WorkbenchIconButton`：`src/workbench/generationCanvas/components/GroupFrameHeader.tsx:203`。
  → 结论：时间轴的收起钮**复用** `WorkbenchIconButton + IconChevronDown`，不引第二种形态、不加文字按钮。
- **折叠状态的存法也已经有了。** 同一片区域的迷你画面窗把「收起」记在 localStorage：
  `src/workbench/timeline/TimelineMiniPreview.tsx:25`（`nomi.timelineMiniPreview.collapsed`）。
  → 结论：时间轴面板的收起状态按同一机制存 `nomi.timelinePanel.collapsed`，不新造存储、不塞进项目档案
  （它是跟人不跟项目的窗口习惯）。
- **onCollapse 这条线本来就通着，只是断在最后一米。** 生成画布早就传了
  `src/workbench/generation/GenerationWorkspace.tsx:137`，而 `src/workbench/timeline/TimelinePanel.tsx`
  把它接成下划线形参从不使用。→ 结论：这不是「新增能力」，是**接上一条已经铺好的线**。

## 2. 生态里已有？

- **OpenCut（MIT，09-05 合同 §借鉴表点名的近邻）把时间轴工具条做成参与布局的一行，不是浮层。**
  - `apps/web/src/timeline/components/timeline-toolbar.tsx:71-72`：`<ScrollArea>` 包一个
    `flex h-10 items-center justify-between border-b px-2 py-1` 的行 —— 固定行高、底边一条分隔线、
    **放不下就横向滚动**。
    <https://github.com/OpenCut-app/opencut-classic/blob/main/apps/web/src/timeline/components/timeline-toolbar.tsx>
  - `apps/web/src/timeline/components/index.tsx:439,445`：`<TimelineToolbar />` 与
    `<div className="relative flex flex-1 overflow-hidden">`（轨道区）是**兄弟节点**，工具条排在轨道区之上。
    <https://github.com/OpenCut-app/opencut-classic/blob/main/apps/web/src/timeline/components/index.tsx>
  - 直接照抄的是**结构**（独立行 + 横向滚动 + 兄弟关系），不抄图标（我们继续用 Tabler，09-05 合同 §2.7 已定稿）。
- **面板「拖到很小就收起 / 收起后靠一个入口叫回来」是 react-resizable-panels 的官方形态**
  （OpenCut 与本仓的剪辑面都在用它）：`collapsible` + `collapsedSize`，配 `onCollapse`/`onExpand` 两条边。
  <https://react-resizable-panels.vercel.app/examples/collapsible>
  → 我们生成画布这一侧不是它管的（是自研的 grid + 拖把手），但**语义照它**：收起 = 让出整块高度，
  留一个显式入口叫回来（现役的画布底部胶囊）。

## 3. 我们自己的定稿怎么说？

- `docs/design/2026-09-05-editing-panel-design-contract.md:87`（§2.7）已经把工具条**分簇与图标**钉死：
  「这一段」`IconScissors`/`IconCopy`/`IconTrash`｜「整片」`IconWand`/`IconArrowBackUp`/`IconArrowForwardUp`｜
  「视图」`IconMagnet`/`IconZoomOut`/`IconViewportWide`/`IconZoomIn`。
  → 本次**只动位置，不动分簇与图标**。合同没写工具条该浮还是该占行，这一格是本次补上的。

## 4. 自媒体来源（TikHub）

本次没用 TikHub。要判的是「工具条该不该占一行、折叠钮长什么样」——判据在同类开源剪辑器的**源码**
与我们自己 09-05 的定稿里，都能直接读到；自媒体那一层讲的是使用体验与选品，对这个具体形状给不出更强的证据。
（用户原话「右上角的功能栏和下面有遮挡」本身就是最一手的使用侧输入。）

## 5. 结论

用已有：折叠原子（`WorkbenchIconButton + IconChevronDown`）、折叠状态存法（localStorage，同迷你画面窗）、
工具条结构（OpenCut 的「独立行 + 横向滚动」）。
自研的只有一处：面板高度下限从「头部行 + 面板内边距」**派生**，替掉原来拍的 140 ——
因为那个数取决于我们自己的 token（`--workbench-control-size`）与密度档，别人没有可抄的常量。
