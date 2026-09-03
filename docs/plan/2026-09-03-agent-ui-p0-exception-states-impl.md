# Agent UI P0 异常态实现边界

## 目标

在 PR #445 的右侧 Agent 新壳内补齐 P0 异常态的真实展示边界：长文本/列表折叠、错误/加载/空态卡片，以及选择器与回执挂点。所有展示数据都由现有 Agent snapshot、工具投影、项目素材池或明确的组件 props 提供；不在 Agent 面板复制画布、生产任务或素材的真相源。

## 范围

- 复用现有 `ProjectAgentResidentShell`、`ResidentUiPrimitives`、`GenerationProposalEditor` 和 `useAllProjectAssets`。
- 折叠阈值：文本 3 行、工具摘要 20 步、排队 3 条、候选 3 版、偏差 5 处；卡内列表最大高度 220px。
- 统一 `--workbench-danger` 边框、人话原因、扣费事实与可用动作；加载按钮只禁用不隐藏；空素材选择器提供上传入口。
- 所有异常卡使用 §0 约定的 `data-agent-*` 挂点与状态属性，并补充组件级结构测试。

## 不动项

- 不修改 conformance 断言口径，不为未驱达状态渲染空壳，不改 Host contracts 或 domain owner。
- 不恢复渐变遮罩，不增加常驻文字按钮，不使用 `节点`、`原位`、`id` 作为用户可见文案。

## 固定结果卡处置

`ProjectAgentArtifactRef` 目前只有 run/artifact/version/hash，没有镜头行与勾选集合；本轮不猜造 `data-agent-pinned-card` 的内容。待结果区 owner 提供可复用投影后再接入，避免 Agent 面板形成第二份固定结果真相源。

## 验收

- 先行 conformance 基线：`52 / 20 / 0`（本 worktree 实跑结果）。
- 组件结构测试、`pnpm run typecheck`、`pnpm run build`、真实 Electron conformance 与截图走查。
