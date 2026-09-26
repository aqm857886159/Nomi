# 时间轴：工具条改独立头部行 + 面板内恢复折叠钮（2026-09-10）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：已实施（分支 `fix/timeline-toolbar-row-collapse-20260910`）
> 根因合同：`docs/fixes/2026-09-10-timeline-toolbar-overlay.root-cause.json`
> 先查别人报告：`docs/research/2026-09-10-timeline-toolbar/prior-art.md`

## 1. 起因（用户原话）

2026-09-10 真机反馈：**「时间轴无法向下缩；右上角的功能栏和下面有遮挡。」**

用户拍板的范围：**只做「工具条不再盖内容 + 面板能缩到只剩头部」，不重排、不动剪辑内容**
（剪辑面整体以后按同类剪辑软件重做）。符合设计系统就直接修，不出样张。

## 2. 底层逻辑（为什么会这样，不是「顺手改个样式」）

面板里的**常驻控件**（不跟随指针、没有 dismiss 语义、一直都在）被写成了**浮层**：

- `src/workbench/timeline/TimelinePanel.tsx` 的工具条是 `absolute top-[10px] right-4 z-[8]`，
  而面板的行模板只有一行 `grid-rows-[minmax(0,1fr)]`（轨道区）。**没有人给工具条留过位置**，
  它只是叠在标尺/首轨上面，用一层毛玻璃底把被压住的内容糊掉。
- 由此派生出第二个症状：面板高度下限只能拍成 140px —— 里面硬含着「工具条 + 至少露一条轨道」的高度，
  否则浮层会把整个面板糊死。用户把拖把手拖到底，也退不出画布空间。
- 第三处：`onCollapse` 这条线从 `GenerationWorkspace.tsx:137` 一路传到 TimelinePanel，
  却被接成下划线形参从不使用 —— 面板里**一个收起入口都没有**，只能去画布底部找把手。

**类根因**：面板里的常驻控件必须占一行真实布局，由容器的行模板给它留位。缺这条不变量，
控件与内容共用同一段高度：宽高一变就互相遮挡，而且高度下限被迫按「控件 + 内容」拍数。

## 3. 会发生什么（改完的机制）

1. 面板行模板改成 `grid-rows-[auto_minmax(0,1fr)]`：第一行给工具条，第二行给轨道区。
   工具条不再绝对定位，也不再需要毛玻璃底（没有东西要糊了）。
2. 工具条一行放不下时**横向滚动**（`overflow-x:auto` + `flex-wrap:nowrap` + 每簇 `flex-shrink:0`），
   簇内不换行、不压扁。形状照 OpenCut 的同名组件（见先查别人 §2）。
3. 高度下限不再是拍的数，而是从同一个头部行**派生**：
   `TIMELINE_PANEL_MIN = 面板上下内边距(12+16) + 工具条行(8 + 组高 + 8) = 86`。
   拖到底时轨道区拿 0 高，面板就只剩头部行。
4. 面板行尾出现收起钮（现役折叠原子 `WorkbenchIconButton + IconChevronDown`，icon + tooltip，无文字）。
   收起 = 整块让路，画布底部胶囊照旧负责叫回来；收起状态记在 `nomi.timelinePanel.collapsed`
   （同迷你画面窗的存法）。

## 4. 用户体验是什么

- 打开时间轴：标尺与第一条轨完整可见，不再被工具条压住半行。
- 想要画布：往下拖到底 → 只剩一条工具条（86px，原来 140px 退不掉）；再点行尾的 ⌄ → 整块让路。
- 叫回来：底部胶囊一点，**回到收起前那个高度**，不用重新拖。

## 5. 范围与不动项

**动**：`TimelinePanel.tsx`（行模板 / 工具条容器 / 收起钮 / 轨道容器的底部 padding）、
`workbenchStore.ts`（收起状态落盘 + 改从新模块取界）、新增 `timelinePanelBounds.ts`（下限派生；
从 store 抽出来是因为那份已 782 行、贴着 800 行巨壳门岗 R9/R12，纯换算不该继续堆在里面）、
新增 `timelinePanelPrefs.ts`、两条 i18n 文案。

**不动**：
- 工具条的**三簇分组与图标**（09-05 合同 §2.7 定稿，只动位置）。
- 轨道 / 片段 / 属性面板的任何逻辑。
- 剪辑面（density=full）那一格的高度下限（`EDITING_PANEL_BOUNDS.timeline.min=140`，
  由 react-resizable-panels 管，留给剪辑面整体重做）。
- 不新增全局 CSS（token-only，无任意 px；下限是 TS 常量不是样式值）。

## 6. 回滚

单 commit 可整块 revert：改动集中在 TimelinePanel 的行模板与工具条容器、`TIMELINE_PANEL_MIN` 的定义、
一个新增的偏好模块。没有数据迁移，没有 schema 变化，revert 后收起偏好键只是变成无人读取的残留。

## 7. 验收门

- 单测 `src/workbench/timeline/timelinePanelLayout.test.ts`：行模板留了行、工具条容器不再 absolute、
  三簇与图标原样、行尾收起钮、下限 = 86 且 < 140、收起偏好读写闭环。
- 走查 `tests/ux/timeline-toolbar-row.walk.mjs`（真实 Electron，零额度）：
  ① 展开后工具条矩形与标尺 / 首轨**不相交**（带阳性对照：相交判据必须先判得出自己和自己相交）；
  ② 拖把手到底 → `aria-valuenow=86`、工具条整条在面板内、轨道区排在它之下；
  ③ 行尾收起钮 → 整块让路 → 底部胶囊叫回来 → 高度仍是 86；
  ④ 把 Nomi 面板拖到上限挤窄剪辑面时间轴 → 仍是一行、不遮挡、用户可达的最窄配置下本来就放得下；
  ⑤ 横向滚动这层安全网用仪器压到 320px 验证（用户拖不到那么窄：主窗 `minWidth=1100`，
     `electron/main.ts:283`），证明放不下时是「滚」而不是「换行 / 裁掉」。
- `pnpm run gates` 全绿。

## 先查别人

完整报告：[docs/research/2026-09-10-timeline-toolbar/prior-art.md](../research/2026-09-10-timeline-toolbar/prior-art.md)

- **仓库里已有折叠原子**：`src/workbench/preview/inspector/PreviewInspector.tsx:80`
  （`WorkbenchIconButton` + `IconChevronDown`），收起态图标条 `src/workbench/preview/PanelRail.tsx:9`，
  画布分组同款 `src/workbench/generationCanvas/components/GroupFrameHeader.tsx:203`。→ 复用，不新造。
- **仓库里已有折叠状态的存法**：`src/workbench/timeline/TimelineMiniPreview.tsx:25`
  把同一片区域的「收起」记在 localStorage。→ 照抄机制，键名换成 `nomi.timelinePanel.collapsed`。
- **仓库里这条线本来就通**：`src/workbench/generation/GenerationWorkspace.tsx:137` 早已传 `onCollapse`，
  只是 TimelinePanel 从不使用。→ 本次是接线，不是加能力。
- **生态：OpenCut（MIT）把时间轴工具条做成可横向滚动的独立行**，不是浮层 ——
  <https://github.com/OpenCut-app/opencut-classic/blob/main/apps/web/src/timeline/components/timeline-toolbar.tsx>
  （`:71-72` `ScrollArea` + `flex h-10 items-center border-b`），并与轨道区是兄弟节点 ——
  <https://github.com/OpenCut-app/opencut-classic/blob/main/apps/web/src/timeline/components/index.tsx>（`:439,445`）。
- **生态：面板折叠的通行语义**（`collapsible` + `collapsedSize` + `onCollapse`/`onExpand`）——
  <https://react-resizable-panels.vercel.app/examples/collapsible>；本仓剪辑面已在用同一个库。
- **我们自己的定稿**：`docs/design/2026-09-05-editing-panel-design-contract.md:87`（§2.7）钉死三簇与图标，
  本次只动位置。
