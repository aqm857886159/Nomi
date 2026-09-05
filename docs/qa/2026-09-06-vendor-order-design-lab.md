# 供应商偏好 · 第一阶段实验室登记

实验室页面：`tests/ux/design-lab/vendor-order.html`。

四个选择框状态与设置排序控件已登记：有偏好、无偏好、有未配置分组、全部未配置空态。
真实 Electron 走查的截图目录固定为 `tests/ux/shots/vendor-order/`（该目录由 `.gitignore` 忽略）。

预期截图：

- `01-picker-preferred.png`
- `02-picker-no-preference.png`
- `03-picker-unconfigured-group.png`
- `04-picker-all-unconfigured-empty.png`
- `05-settings-vendor-order.png`

实现对账：模型入口复用 `useDedupedModelSelect`；批量入口复用 `BulkModelPicker` 的同一排序函数；设置控件写入版本化原子 JSON。

入口盘点（2026-09-06 实扫）：`src/workbench/generationCanvas/nodes/InlineParameterBar.tsx:227,564`（生成节点）；`src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx:136,269`（分镜行）；`src/workbench/generationCanvas/components/CanvasBulkModelSelect.tsx:52` 与 `src/workbench/creation/storyboard/StoryboardBulkBar.tsx:125`（批量）；`src/workbench/ai/AssistantModelPicker.tsx:90,148`（Agent composer）；`src/workbench/common/useDedupedModelSelect.ts:255`（唯一有状态 view-model）；`src/workbench/common/BulkModelPicker.tsx:64`（唯一批量 view-model）；`src/config/modelOptionMappers.ts:39`（catalog DTO → option 身份入口）。
