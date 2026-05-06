---
name: storyboard-gen
description: 给定脚本/故事文本，自动拆分镜头，在画布上创建图像+视频节点，运行生成，并将结果添加到时间轴。
---

# Storyboard Gen

## 用途
将脚本或故事文本一键转换为画布节点并输出到时间轴。

## 工具
`creation_read`, `canvas_create_nodes`, `canvas_connect_nodes`, `canvas_run_node`, `timeline_add_clip`

## 流程

1. **读取文本**：若用户未提供文本，调用 `creation_read` 获取当前创作区内容。

2. **拆分镜头**：分析文本节奏与场景切换，将其拆分为 N 个镜头（短文 ≤1200字取 6-8 个，中文取 8-12 个，长文取 12-16 个）。

3. **创建图像节点**：对每个镜头调用 `canvas_create_nodes`，节点类型 `image`，按网格布局放置（列间距 300px，行间距 300px），节点名称格式 `shot-{N}-image`。

4. **连接图像→视频节点**：为每个镜头调用 `canvas_create_nodes` 创建 `video` 节点，再调用 `canvas_connect_nodes` 将对应 image 节点输出连接到 video 节点输入。

5. **并行触发图像生成**：对所有 image 节点并行调用 `canvas_run_node`，无需等待单个完成。

6. **等待图像完成后触发视频生成**：确认所有 image 节点生成成功后，对所有 video 节点调用 `canvas_run_node`。

7. **添加到时间轴**：按镜头顺序依次调用 `timeline_add_clip`，`startFrame` = 上一个 clip 的 `endFrame`，首个 clip 从第 0 帧开始。

8. **汇报**：输出镜头数量、成功/失败节点数、时间轴总帧数。

## 注意事项

- 图像节点生成失败时重试一次；仍失败则跳过该镜头并在汇报中标注。
- 视频节点依赖对应图像节点的输出，不可在图像未完成前触发。
- 节点命名需唯一，避免与画布已有节点冲突（先调用 canvas 读取接口检查）。
- 时间轴帧率默认 30fps；3 秒镜头 = 90 帧。
