# Agent 系统梳理 + 4 个问题处理

> 触发：用户报告"两个 Agent 有基本问题"——①创作 AI 强制套技能人格，没有通用问答；②创作模式出现了不该有的左侧栏；③创作区做图/视频节点提示词没复制过去；④生成区 Agent 回复有时出现在上方。要求：整张梳理、用户+技术视角找致命 bug，能修的直接修，需决策的列方案。

## 1. 两个 Agent 的全貌

| | 创作 AI（CreationAiPanel） | 生成 AI（CanvasAssistantPanel） |
|---|---|---|
| 位置 | 创作模式右栏（文稿助手） | 生成模式右栏（画布助手） |
| 模式 | `CREATION_AI_MODES`：故事/剧本/素材/分镜/提示词/审校（6 个**强制人格**技能） | `agent` / `chat`(问答) / `refine`(润色)，本地 useState |
| 调用 | `sendWorkbenchAiMessage`，`skillKey=workbench.creation.<mode>` | `sendGenerationCanvasAgentMessage` → electron agent |
| 产出 | 文档 action（insert/replace/append），用户点"应用"写入 tiptap | 工具调用卡（create/connect/set_prompt/delete），用户确认后改画布 |
| 特殊路径 | 含"拆镜头/分镜/拆分"→ 切到生成模式 + 派发 storyboard 事件 | 监听 storyboard 事件 → 跑故事板规划师技能 |

创作区"做节点"的 4 条路径（都流经 `addNode`）：
1. 选区浮窗 `SelectionGeneratePopover` →「生成图片/视频」→ `createNodeFromSelection`
2. `documentTools.generateAssetNode/generateStoryboardNode`（AI 可调）
3. 拆镜头 → 生成区故事板 Agent → `create_canvas_nodes` 工具
4. AgentPlanCard 确认（可改 prompt）

## 2. 四个问题的根因

### Issue 1 — 创作 AI 没有通用问答（确诊，可修）
`CREATION_AI_MODES` 6 个模式**全是强制人格**（"你是XXX助手…"），`getCreationAiMode` 默认落 `story`，`buildCreationAiPrompt` 永远注入人格 + documentTools 协议。用户想"通用问答"时无路可走。

### Issue 2 — 创作模式出现左侧栏（确诊，可修）
`WorkbenchShell.tsx:104` 把 `ProjectExplorerSidebar` 渲染在三模式 `hidden` 容器**之外**，所以创作/生成/预览都挂着它。创作是纯文稿写作，不该有项目资源树。

### Issue 3 — 图/视频节点提示词没复制（**静态代码层全部正确，需复现**）
逐条追完 4 条创建路径 + `addNode` → `createGenerationNode`（`prompt: input.prompt || ''`）+ composer（`value={node.prompt}`）+ AgentPlanCard（`editedPrompts` 初始化自 `node.prompt`）：**每一处都把 prompt 透传/显示**。静态分析无法复现"没复制"。最可能是：故事板规划师**模型本身没把 prompt 写进节点**（prompt 工程问题，非代码 bug），或某类 kind（shot/text）composer 不显示 prompt 输入框（line 105 只对 image/video-like 渲染）。→ 列为决策/复现项，不盲改。

### Issue 4 — 生成 Agent 回复有时在上方（确诊，可修）
`CanvasAssistantPanel.tsx:380` 滚动区里，`pendingToolCalls`（计划卡/待确认列表）渲染在 `messages.map` **之前**，且**无自动滚到底**。长对话时工具卡顶在最上，新回复沉到下方看不见 → "回复在上面"。

### 顺带发现 — `delete_canvas_nodes` 死能力
系统提示词告诉 Agent 可删节点，但 renderer 两处实现都直接 `throw / ok:false`（未实现）。Agent 会尝试、必然失败。违反规则1（声明了不存在的能力）。→ 决策项：实现 or 从工具/提示词移除。

## 3. 本轮直接修（用户授权"能修的自己修"）

- **Issue 2**：`WorkbenchShell` 创作模式不渲染 sidebar；`ProjectExplorerSidebar` 删掉只服务 creation 的 `preferredTab` 死分支 + 未用的 `workspaceMode` prop（规则1）。
- **Issue 4**：待确认工具卡移到对话**下方**；加底部锚点 + `messages/pendingToolCalls` 变化时 `scrollIntoView` 自动滚到底。
- **Issue 1**：新增 `general`「通用问答」模式（无人格、无 documentTools 协议、纯 Q&A），设为**第一个=默认**；`buildCreationAiPrompt` 对 `chatOnly` 模式走精简提示词。保留原 6 个技能（用户可主动切）。

## 4. 不动什么
- 生成 Agent 工具执行、确认流、故事板派发链路。
- 创作 AI 6 个技能模式的人格内容（只新增 general，不删）。
- 选区/文档工具/addNode/composer 的 prompt 透传逻辑（已确认正确）。
- 预览模式的 sidebar 暂不动（列入决策）。

## 5. 决策项（交用户拍板，规则3）
1. Issue 3：请确认是哪条路径"没复制"——选区浮窗？还是拆镜头出来的节点？以便定位是模型行为还是 UI。
2. `delete_canvas_nodes`：实现真实删除 vs 从 Agent 能力移除。
3. 预览模式是否也隐藏左侧栏（保持一致 vs 保留）。
4. 是否裁剪创作 AI 的 6 个技能模式（有了通用问答后，story/script/… 是否过多）。

## 6. 回滚
每个 Issue 独立 commit，失败 `git -C <worktree> reset` 回上一节点。

## 7. 验收门
1. 创作模式无左侧栏；生成模式左侧栏照旧。
2. 创作 AI 默认"通用问答"，可纯聊天不被强制套人格；切到技能模式行为照旧。
3. 生成 Agent 工具卡显示在对话下方，新消息自动滚到底。
4. `pnpm exec tsc -p electron/tsconfig.json` 0 错；`pnpm build` 过；`pnpm test` 全绿。
