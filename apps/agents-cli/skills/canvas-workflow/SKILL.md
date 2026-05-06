---
name: canvas-workflow
description: 操作生成画布：读取当前状态，创建、连接、运行节点，处理生成失败。
---

# Canvas Workflow

## 用途
在生成画布上完成节点的创建、连接与运行操作。

## 工具
`canvas_read`, `canvas_create_nodes`, `canvas_connect_nodes`, `canvas_run_node`

## 流程

1. **读取画布状态**：每次操作前先调用 `canvas_read`，了解已有节点位置与 ID，避免冲突。

2. **规划布局**：按网格排列新节点，列间距 300px，行间距 300px。起始坐标从现有节点右侧或下方空白区开始。

3. **命名节点**：使用语义化名称，格式 `{用途}-{序号}`，例如 `hero-shot-1-image`、`hero-shot-1-video`。

4. **选择节点类型**：
   - `image`：需要静态图像输出时使用。
   - `video`：需要动态视频输出，或以图像为输入驱动动画时使用。

5. **连接节点**：调用 `canvas_connect_nodes`，明确指定 `sourceId`、`sourcePort`、`targetId`、`targetPort`。

6. **运行节点**：调用 `canvas_run_node` 触发生成。可并行触发无依赖关系的节点。

7. **处理失败**：节点生成失败时重试一次。重试仍失败则记录节点 ID 与错误信息，向用户汇报，不再自动重试。

## 注意事项

- 操作前必须读取画布，禁止盲目写入。
- 有依赖关系的节点（如 image→video）必须等上游完成后再运行下游。
- 节点 ID 由平台分配，不要自行伪造。
