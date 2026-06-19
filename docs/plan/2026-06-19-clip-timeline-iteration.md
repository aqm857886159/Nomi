# 剪辑区 + 时间轴体验迭代（2026-06-19）

> 来源：`docs/audit/2026-06-19-clip-timeline-walkthrough.md` 真机走查。P0（文字 clip 撞 id）已修推送 5e537e7。
> 本文做用户拍板后的体验迭代。样张：聊天内 `nomi_clip_timeline_redesign` 交互原型（用户已试 + 拍板）。

## 用户拍板
- **分割触发 = 剪刀模式**（点工具栏 ✂ 进入；悬停出切点线、点即在剪刀处分割；再点 ✂ / Esc 退出；平时点 clip 仍是选中）。
- 其余全部按原型做。

## 范围（改这些）
1. **#7 轨道改名** `媒体轨`→`视频轨`（`timelineTypes.ts` 一处；保留 audio 仍落此轨，更新注释）。
2. **#3 剪刀模式分割**：
   - store 加 `timelineSplitMode` + `setTimelineSplitMode`。
   - `TimelinePanel` 控制区：✂ 改成**常驻切换按钮**（高亮态=已进入剪刀模式）；删掉选中工具组里的 ✂（避免两条分割路径·P1）；保留 `S` 键（选中片段在 playhead 处切）作为快捷。Esc 退出剪刀模式。
   - `TimelineClip`：剪刀模式下 ① 光标 col-resize ② 悬停按光标位置画橙色虚线切点线 + ✂ 图标 ③ 点击在光标帧处 `splitTimelineClip`（不再选中/移 playhead）④ 禁用拖动。
   - `TimelineTrack` 空白：剪刀模式下点空白不移 playhead。
3. **#2 撤销**：
   - store 加 `timelineUndoStack: TimelineState[]`（封顶 30）+ `captureTimelineUndo()` + `undoTimeline()` + 派生可撤销布尔。
   - 离散操作（split/duplicate/nudge/removeSelected/add/文字增改删/move-text/resize-text）：变更生效才把旧 timeline 压栈。
   - 拖拽（move/resize 媒体 + 文字）：在组件手势**首次真正移动**时压一次（避免空点也压、避免每帧压）。
   - `TimelinePanel`：⌘Z/Ctrl+Z 调 `undoTimeline`；控制区出现「撤销 ⌘Z」pill（仅栈非空时）。
4. **#6 工具栏换行**：`TimelinePreview` 控制条 `inline-flex`→`flex flex-wrap justify-center`，子项保持 `shrink-0`（满了换行而非把「导出 MP4」挤出/截断）。
5. **#9 缩略图常驻标签**：`TimelineClip` 标签从「无缩略图才显」改成**始终显**（半透底，压在缩略图上）。
6. **#8 底部呼吸**：`TimelinePanel` section 底 padding 增一档（full/compact 各 +）。

## 不动什么
- 时间轴数据结构 / 帧数学 / 吸附 / 导出管线 / 拖拽落位算法。
- 生成画布节点系统、创作区。
- 文字 clip id 机制（已在 5e537e7 修）。

## 回滚
- 纯前端改动，全在 6 个文件：`timelineTypes.ts` / `workbenchStore.ts` / `TimelinePanel.tsx` / `TimelineClip.tsx` / `TimelineTextTrack.tsx` / `TimelinePreview.tsx`。`git revert` 单 commit 即回滚。

## 验收门
- 五门全过（filesize/tokens/lint/typecheck/test/build）。
- 新增单测：undo 压栈/弹栈、splitMode 下 split 在光标帧。
- 真机走查：剪刀模式切片 + ⌘Z 撤销 + 窄窗工具栏换行不截断 + 视频轨改名 + 缩略图见标签（截图人眼对账原型）。
