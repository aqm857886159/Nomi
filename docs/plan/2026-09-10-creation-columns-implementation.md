# C76 三栏外框实施

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：实施中；#689 已合并，用户 03:05 批准，03:10/04:32 限定仅外框。

## 先查别人
沿用 [已批方案](2026-09-10-creation-columns.md) 与 [规格](../design/2026-09-10-creation-workspace-columns.md)。既有 WorkbenchShell 是三栏和 resident portal 的共同 React 宿主；在这里提供外框上下文，只传递创作外框是否启用，不增加 store、业务状态或第三方能力。React 原生 Context 穿透现有 portal，现役组件继续拥有内部布局。

- `src/workbench/WorkbenchShell.tsx:360`：现役三栏宿主与 resident portal 共属 Shell，直接用已有挂载关系。
- `src/devlab/designLab/v4/agentPanelV4LabHost.tsx:88`：真实宿主投影入口，沿用同一 lane/store。
- `docs/design/nomi-design-system.md:155`：控件归位规则，只改外框，不调整内部功能簇。
- `docs/design/2026-09-10-creation-workspace-columns.md:46`：已批规格与现役 token，不引入新样式系统。

## 范围与删除
共享 WorkspacePanelFrame 的 frame/header 类规格；Shell 统管创作态 p-4/gap-4；CreationWorkspace 删重复 padding 和 Agent 32px gutter；Sidebar、Editor、Agent 替换外框。分镜/生成/预览保留既有外框。实验室删除临时 selector 覆盖，直接展示现役组件。

## 根因
症状：三栏不像一个工作区。直接原因：左单右边框、中独有阴影、44/40/48px 标题带。类根因：共同工作区外框缺少唯一 owner，属于 recurring。扫描三个 frame 及 AssistantPane/其它工作区消费者；原始证据见 implementation/before-*.json。共享边界与回归见配套 v3 合同。

## 验收与回滚
仅外框，栏内 JSX/顺序/布局保持现状；几何 diff 将工具栏下移2px、Agent 顶部下移4px、左列表窄1px标为成因=外框（04:32 已批准）。真实 Electron 明暗截图、所有可见控件几何对比；一窗口新建项目→两段文字→拆分镜→Agent 一句话。只更新 creation-columns 三屏基线，列全名。contracts/gates 通过后 scoped commit、正常 hooks push、PR；回滚为 revert 本任务提交，不修改持久化数据。
