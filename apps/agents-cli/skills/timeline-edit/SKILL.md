---
name: timeline-edit
description: 编辑时间轴：添加、重排、裁剪片段，维护帧序连续性。
---

# Timeline Edit

## 用途
对时间轴进行片段的添加、重排与裁剪操作。

## 工具
`timeline_read`, `timeline_add_clip`, `timeline_move_clip`, `timeline_trim_clip`

## 流程

1. **读取时间轴**：先调用 `timeline_read`，获取所有现有片段的 `id`、`startFrame`、`endFrame`。

2. **计算帧位置**：帧率默认 30fps。时长换算：`帧数 = 秒数 × 30`（例：3s = 90帧）。

3. **顺序添加片段**：调用 `timeline_add_clip` 时，`startFrame` = 上一个片段的 `endFrame`。首个片段从第 0 帧开始。

4. **处理间隙**：若两个片段之间存在空隙（gap），保留空隙或用静帧填充，取决于用户意图；不要自动移动其他片段。

5. **重排片段**：调用 `timeline_move_clip`，指定目标 `startFrame`；移动后检查是否与其他片段重叠，若重叠则提示用户。

6. **裁剪片段**：调用 `timeline_trim_clip`，指定新的 `startFrame` 或 `endFrame`，不影响其他片段位置。

## 注意事项

- 每次操作前必须读取时间轴，禁止凭记忆假设当前状态。
- 帧数必须为整数，秒数换算后向下取整。
- 不要在未经用户确认的情况下删除或覆盖已有片段。
