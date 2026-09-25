# 提示条正文保底可读

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：共享布局已实现、完整 gates 通过；B4 名称补丁待接入。用户任务书已指定布局约束与交付方式。

## 范围与根因

长动作在 flex 行中不可收缩且没有宽度预算，正文可缩至零；这是 recurring 输入类缺陷。共享 ToastMessage 负责动作 ≤40%、单行省略并保留 title，通知根宽度至少 min(20rem, viewport 可用宽度)，正文可断长单词。保留按钮点击、关闭、时长和 C50 自动切换行为。

## 先查别人

- `src/ui/toast.tsx:42`：所有通用提示、撤销、批量重试共享 ToastMessage，不另建 toast 系统。
- `src/NomiAppProviders.tsx:23`：真实容器 344px，Mantine 自带关闭和通知生命周期，沿用原实现。
- `src/config/modelCatalogCache.ts:158`：供应商显示名来自目录 vendor.name → ModelOption.vendorName，不另写映射。
- `src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts:267`：给出的调用只有 showInfoToast，当前基线未发现“切到”动作生产者，生产者位于 B4 尚未提交的 Nomi-money-guard 分支，不重建 C50 行为。

## 扫描与验收

TS AST 全仓扫描 flex 父行、min-w-0 flex-1 正文与无上限 shrink-0 兄弟；详表另附。区分固定尺寸图标、纵向容器、单行截断与无界动态标签。任务中心、审批头独立检查。未运行的窄容器场景不标为通过。

真实 buildToastNotification + Mantine Notification + 生产主题/CSS 在 Chromium 中以 360/344/320 宽验证 40 字正文、30 字动作及英文长串，按字符 Range 聚合行数；每行 ≤2 字且 ≥5 行必须失败，截图先红后绿。保持现有动作回调测试，补 title 可访问测试。完整 gates exit 0 后 commit/push/PR。

## 不动项与回滚

不改冻结区、C50 状态写回或供应商选择策略，不引入依赖。回滚本任务提交即可，无持久化迁移。
