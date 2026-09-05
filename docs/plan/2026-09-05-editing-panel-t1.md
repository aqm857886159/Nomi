# T1 剪辑面板系统 · 属性面板 · transport

> 状态：🚧 进行中 · 日期：2026-09-05 · 合同 [`docs/design/2026-09-05-editing-panel-design-contract.md`](../design/2026-09-05-editing-panel-design-contract.md) §2.1 §2.2 §2.3 §2.8

## 范围

- 用 `react-resizable-panels@^4.12` 把预览面改成合同 §2.1 的五块布局 C′：左「镜头 / 素材」300 · 中预览 · 属性 240 · 最右 Nomi 390 · 底时间轴 260，时间轴只铺左三块。
- 尺寸与可见性住 `workbenchStore.editingPanelLayout`（同时是 Agent `layout.read/write` 的契约与随项目落盘的那份），拆成 `editingPanelLayoutSlice` 守巨壳门。
- transport（§2.2）收成纯播放控件，贴预览列底部；「整片画幅」「这一段显示/缩放」进属性面板，「导出 MP4」与「布局」菜单迁到应用顶栏右上。
- 属性面板（§2.3）四态：整片 / 视频片段 / 图片片段（无声音组）/ 字幕；片段音频经 `timelineKernel` 的 `clip-audio` 校验并进撤销栈。
- 顺手修 #508 合入后暴露的轨道头截断：`--workbench-timeline-label-width` 112 → 132。

## 不在范围

- 转场选择器（§2.4）与右键菜单（§2.5）：归 T2；属性面板的入 / 出两行先留事件口。
- 字幕「样式」（字幕 ↔ 标题卡）切换：改它要新增一条内核写操作，与转场选择器同批。
- 生成工作区的时间轴抽屉（`TimelineResizeHandle`）：合同 §⑥ 明确「先在剪辑面落，创作 / 生成页后续共用」，本轮不动。
- 资源库 tab 内容（合同：本轮留位不画内容）。

## 回滚

单独 revert 本分支即可。布局状态是增量字段，缺省回落 `EDITING_PANEL_DEFAULTS`；片段音频写入先过内核校验才落盘。

## 验收门

- 走查 `tests/ux/editing-panel-system.walk.mjs`（R13/R16，零额度）25 条断言全绿，截图在 `tests/ux/shots/editing-panel-system/`：
  五块面板默认几何 · transport 贴列底并紧挨时间轴 · 导出/布局在顶栏且不在 Nomi 面板头 ·
  左栏 tab 不截断且收起钮贴底 · 轨道名不截断 · 属性面板四态与组序 · 收起成 32px 图标条 ·
  预设「结果全屏」与「恢复默认」可逆 · 窄窗不破合同下限。
- `pnpm run gates` 全绿（含 `check:tokens` / `check:dangling-tokens` / `check:i18n` / `check:filesize` / `check:walkthroughs` / `check:controls`）。
