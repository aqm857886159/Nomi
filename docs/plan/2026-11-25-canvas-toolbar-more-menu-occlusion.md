# 选中节点后，从加节点条继续创建空间节点

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

### ★0 先查别人

- `src/workbench/generationCanvas/components/CanvasViewOptionsPopover.tsx:54` · 左下缩放簇把展开内容挂到设计系统浮层 · 确认底部加节点条同样只裁切常驻部分。
- `src/workbench/generationCanvas/components/CanvasNavigationStack.tsx:134` · 原按钮维护展开状态，浮层收到同一个锚点 · 确认再次按按钮只切换一次。
- `tests/ux/_shell.mjs:332` · 从窗口找菜单，再在菜单内点目标种类 · 确认 Portal 保留菜单和节点选择器就能沿用夜跑入口。
- 出口：`src/design/AnchoredPopover.tsx:218` · 外点、Escape、焦点归还由同一层处理 · 确认创建者可以直接取消并继续操作画布。

- ★1 创作者保留当前选中节点，打开仍可见的 + 后一次点击添加 3D 模型。量具为选中数、工具条 clip-path、四项中心的 elementFromPoint、点击前后画布节点数和菜单数量。旧项目继续使用原有节点与菜单偏好。
- ★2 原来扩大 clip-path 会改变生成框的点击优先级，删除 + 会失去空间项入口。采用现有 AnchoredPopover，删除内联定位和文档监听。空态起步行也用本行按钮作锚点。
- ★3 CanvasMoreAddMenu 持有菜单结构，AnchoredPopover 负责实际定位与关闭交互，节点创建仍走 canvasAddIntentActions 和画布 store。
- ★4 不改持久化、供应商请求和菜单偏好。两处统一向上展开、末端对齐、间距 12px。空态原先向右展开是为避开下方的拖入提示（f221127b7），向上时仍须实际量两者交集为零。
- ★9 前置验收：生成框与 dock 重叠，+ 按钮中心仍可点。中亮、英暗及 1100×690 中文窄窗各取菜单图；四项中心均命中，点 3D 只新增一个节点并收起。再次点 +、外点、Escape 均可关闭。空态更多可添加白板。反例：旧内联版尽管有完整 DOM 矩形仍点击穿透；删除菜单或吞掉选择无法通过新增断言。夜跑在隔离资料中完成视频及 3D 模型选择器走查。

### 系统改进

最早可在实现时复用展开面。原有 canvasChromeOcclusion 测几何，canvasToolbarModel 测菜单清单，两个量具都没有在相交时点击真实展开面。历史对照是 2026-09-06 时间轴转场选择器只露一行；正常对照是缩放簇的视图选项。两个创建入口统一交给已有 Portal。预测每种尺寸四项命中数从 0/4 恢复到 4/4，且创建一次。2026-12-02 复查 runninghub-onboarding 夜跑，若相同菜单有穿透或节点未落地，重开此修复。
