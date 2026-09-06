# UI shell small · P-01 / C-01

> 状态：✅ 已交付

## 范围
- P-01：在现役应用壳接入更新事件的极简弹层，展示版本号与 `NomiMarkdown` release notes；可用时提供「更新并重启」与「稍后」，下载中显示进度，失败显示重试；生成任务运行时不弹层，只保留角标提示。
- C-01：把生成画布的节点空态收敛到共享 `NodeEmptyState`，由节点类型提供 Tabler 图标、用途说明与下一步动作，保留必要上传/编辑动作。
  - **清单以左侧竖排工具栏为准（2026-09-06 用户拍板）**：用户点得出来的九种 —— 文本 / 图片 / 视频 / 剪辑 / 声音 / 3D 模型 / 画板 / 全景 / 3D 场景（真相源 `src/workbench/generationCanvas/components/canvasToolbarModel.ts` 的 `CANVAS_TOOLBAR_NODE_GROUPS`）。
  - 角色 / 场景 / 道具 **不进实验室清单**：它们没有工具栏入口，由 Agent、分镜流程与分类兜底产生。它们的生产空态文案（`nodeEmpty.character|scene|prop`）仍被 `CharacterCardNode` / `SceneCardNode` / `PropCardNode` 渲染，是活的，**不删**。「提示词 / 道具」这两个实验室状态则是凭空画的（registry 里根本没有 `prompt` kind），已删。
  - 图标不在实验室自造：走 `getGenerationNodeIcon(kind)`，与左侧栏那颗按钮同一个出口；键类型钉成 `Record<CanvasToolbarNodeKind, …>`，工具栏加按钮而实验室没跟上 = 编译错（R28）。
  - 补齐的两条生产文案：`nodeEmpty.clip`（由 `clipNode.empty` 迁入，同 commit 删旧键）与 `nodeEmpty.model3d`（新增）；`PendingGenerationPlaceholder` 增 `model3d` 分支——此前空的 3D 模型节点自称「图片节点」。
  - 已知落差（诚实标注）：剪辑节点的空态提示挤在 40px 高的轨道里，生产只渲染 description 那一行，不渲染标题；实验室按统一节奏连标题一起显示。
- 设计实验室先行：注册 P-01 四态与 C-01 九种工具栏节点状态，使用现役 React 组件截图，截图只落 `tests/ux/shots/design-lab-pending/`，不更新视觉基线。
- zh-CN 与 en 均补齐 i18n；更新判定函数单测覆盖任务运行中“角标而不弹层”。

## 不动项
- 不改 autoUpdater 主进程协议、发布流程、更新源或 macOS 手动下载策略。
- 不改生成任务调度、节点数据模型、画布交互内核、视觉基线或生产入口；不新增第二套弹窗/节点空态。
- 不开 PR、不合并、不推送主分支。

## 回滚
- 回滚本分支提交即可；生产入口未引用设计实验室，删除新增组件/注册项与 i18n 即恢复现状。

## 验收门
1. 设计实验室可打开 P-01 四态与每类 C-01 空态，pending 截图路径写入 `CODEX-REPORT.md`，由验收方人眼拍板。
2. `pnpm run test -- ...` 通过，含更新弹层判定函数测试。
3. `pnpm run check:i18n`、`pnpm run check:design-lab -- --structure-only`、`pnpm run gates` 全绿；不执行 `design-lab:update`。
4. 真实组件使用共享空态，旧节点自有空态代码在同一提交删除；生成任务运行中更新只显示角标。
5. 每个里程碑提交并推送到 `codex/ui-shell-version-dialog-node-empty-20260906`；最终报告 ≤15 行，记录 file:line、gates、push SHA 与截图路径。
