# 迁移等价要对用户行为，不是对上一版代码

2026-09-08 · 画布磁吸连线把手。

用户期望：不用先选中，鼠标进入卡片左右外侧热区就出现加号；拖进目标热区，线吸到侧边。
React Flow 迁移保留了旧 `selected && useMagneticConnectionHandles`，又在 visual contract 测试中断言未选中为 dot。这使实现和测试一起保护了用户不要的门槛。text/video 沿用 dot 是同一根因的第二个入口。

迁移验收先写真实任务：空白取消选择 → 不碰卡片正文 → 左外侧 60px hover → 加号出现 → 拖到另一侧热区 → 预览吸附 → 松手成边。选中态、kind、左右侧、批量入口都要套同一规则。截图必须连同指针/选择前提核实，单纯断言 DOM 有 Handle 不证明用户能发现它。

目标热区交给 RF 原生 Handle 命中，框架状态同时驱动高亮、预览终点和提交，不另写 pendingTarget 真相。9月3日正文落点合同解决的是另一段旅程，不能当成外侧 hover 已恢复的证据。

参考：`docs/plan/2026-09-08-canvas-magnetic-handle.md`、`docs/fixes/2026-09-08-canvas-magnetic-handle.root-cause.json`。
