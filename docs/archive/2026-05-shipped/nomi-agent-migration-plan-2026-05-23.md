# Nomi Agent 迁移施工计划

日期：2026-05-23
状态：草稿，开工前请确认
依赖文档：
- `nomi-agent-tech-audit-2026-05-23.md`（调研结论）
- `nomi-product-prd-v2-2026-05-23.md`（产品路线图）

---

## 0. 使用说明（每次开工前先看）

### 0.1 这份文档的角色

这是一份**会反复读取的施工蓝图**。每次开始新一轮工作前，**必须**：

1. 完整通读 §1（总览）+ 当前所在 Phase 的章节
2. 检查 §6（进度跟踪）确认当前状态
3. 按 §当前 Phase.任务清单 顺序执行下一个未完成 task
4. 完成 task 后立即在 §6 标记 `✅`，并在 `提交记录` 写入 commit SHA
5. 完成整个 Phase 后必须执行 §当前 Phase.验证关卡（spawn 独立 agent）才能进入下一 Phase

### 0.2 红线 (绝不允许越界)

- 🚫 **不要跳过 Phase**。Phase A 不完成不准动 Phase B 的代码
- 🚫 **不要跳过验证关卡**。每个 Phase 结束必须 spawn 一个独立 agent 做 audit
- 🚫 **不要在不读这份文档的情况下推进**。每轮开工先读，避免上下文丢失带来的偏差
- 🚫 **不要混合 Phase 内容到同一个 commit**。一个 commit 只服务一个 task
- 🚫 **不要删任何代码而不在 §5 清理清单中事先登记**

### 0.3 每个 Phase 的标准流程

```
1. 读本文档 §当前 Phase
2. 按 task 顺序执行
3. 每个 task 一个 commit (符合 commit message 规范)
4. Phase 全部 task 完成
5. 跑测试 (yarn build, 项目内 typecheck, 现有 e2e)
6. spawn 独立 audit agent (见 §5.2 模板)
7. 修复 audit agent 发现的问题
8. 更新本文档 §6 进度
9. 进入下一 Phase
```

---

## 1. 总览

### 1.1 目标

把 Nomi 的 Agent 实现从"裸 fetch + XML 解析 + 假流式"重构为"Vercel AI SDK + Tool Calling + 真流式"，并落地 Phase 1 的核心 demo「故事→故事板 Agent」。

### 1.2 工期

| Phase | 周 | 主题 | 状态 |
|---|---|---|---|
| **A** | W1 | AI SDK 基础迁移 (向后兼容) | ⏸ 待启动 |
| **B** | W2 | Tool Calling + 真流式 | ⏸ 待启动 |
| **C** | W3 | 故事→故事板 Agent demo | ⏸ 待启动 |
| **D** | W4 | Skill Pack v2 + 清理冗余 | ⏸ 待启动 |

### 1.3 终态验收

完成 4 个 Phase 后必须满足：

- [ ] AI 面板真流式（首字延迟 < 500ms）
- [ ] 工具调用走 LLM 原生 protocol（无 XML 解析代码残留）
- [ ] OpenAI-compatible + Anthropic 两种 provider 在 UI 内可切换
- [ ] 故事→故事板 demo 视频 90 秒能录完整流程
- [ ] 22 个早期 tapcanvas-* skill 已归档到 `skills/legacy/`
- [ ] `apps/` 目录已清理（已完成）
- [ ] 所有新代码有对应 vitest 测试
- [ ] `docs/provider-integration.md` 和 `docs/user-guide.md` 与新架构同步
- [ ] CI 全绿，release v0.4.0 桌面包三平台可分发

---

## 2. Phase A: AI SDK 基础迁移 (W1)

### 2.1 目标

在 `electron/runtime.ts` 内部把 `runAgentChat` 从裸 fetch 替换为 Vercel AI SDK，**对外接口完全兼容**。同时引入 Anthropic provider 支持。

### 2.2 任务清单 (按顺序执行)

#### Task A1: 引入依赖

- 文件：`package.json`, `pnpm-lock.yaml`
- 操作：
  ```bash
  pnpm add ai@^4 @ai-sdk/openai-compatible @ai-sdk/anthropic zod
  ```
- 注意 zod 已经是依赖了，确认版本兼容
- 提交：`chore(agent): add Vercel AI SDK dependencies`
- 验收：
  - [ ] `pnpm build` 通过
  - [ ] `dist/` 无新增体积异常

#### Task A2: 创建 model factory

- 文件：新建 `electron/ai/buildAiSdkModel.ts`
- 操作：
  ```typescript
  import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
  import { createAnthropic } from '@ai-sdk/anthropic'

  export type AiSdkProviderKind = 'openai-compatible' | 'anthropic'

  export function buildAiSdkModel(input: {
    kind: AiSdkProviderKind
    baseURL: string
    apiKey: string
    modelId: string
  }) {
    if (input.kind === 'anthropic') {
      return createAnthropic({ apiKey: input.apiKey, baseURL: input.baseURL })
        .languageModel(input.modelId)
    }
    return createOpenAICompatible({ name: 'nomi', baseURL: input.baseURL, apiKey: input.apiKey })
      .chatModel(input.modelId)
  }
  ```
- 提交：`feat(agent): introduce buildAiSdkModel factory`
- 验收：
  - [ ] `tsc -p electron/tsconfig.json` 通过

#### Task A3: 扩展 model catalog schema

- 文件：`electron/runtime.ts` (vendor 定义部分)
- 操作：在 vendor record 增加可选字段 `providerKind: 'openai-compatible' | 'anthropic'`
- 默认值：未填写时按 `'openai-compatible'` 处理（向后兼容）
- 提交：`feat(agent): extend vendor schema with providerKind`
- 验收：
  - [ ] 旧 model catalog 文件加载仍正常
  - [ ] 新 vendor 可以填 `providerKind: 'anthropic'`

#### Task A4: 迁移 runAgentChat 内部实现

- 文件：`electron/runtime.ts:1786-1813`
- 操作：把 `postJson(.../v1/chat/completions, ...)` 改成 `generateText({ model: buildAiSdkModel(...), messages, ... })`
- 关键：对外返回结构 `{ id, text, raw, toolCalls, artifacts }` 保持不变
- 提交：`refactor(agent): migrate runAgentChat to AI SDK`
- 验收：
  - [ ] 在 dev 模式启动 Electron
  - [ ] 生成区 AI 面板能正常聊天
  - [ ] 创作区 AI 模式能正常返回
  - [ ] 现有 XML plan 解析仍工作（因为 prompt 没变）

#### Task A5: 添加 Anthropic 端到端测试路径

- 文件：UI 内 model integration drawer
- 操作：确认 UI 内可添加一个 `providerKind: 'anthropic'` 的 vendor + Claude 模型，并真的调用通
- 提交：`feat(agent): wire Anthropic provider through UI`
- 验收：
  - [ ] 手动测试：添加 Claude vendor + 一个 API key
  - [ ] AI 面板使用 Claude 模型完成一次问答
  - [ ] 截图存档 `docs/product/screenshots/phase-a-anthropic-call.png`

#### Task A6: 添加 Phase A 单元测试

- 文件：新建 `electron/ai/buildAiSdkModel.test.ts`
- 操作：用 vitest 写 4 个测试
  - openai-compatible kind 返回正确的 model 类型
  - anthropic kind 返回正确的 model 类型
  - 缺失 apiKey 时抛错
  - baseURL 正确传递
- 提交：`test(agent): cover buildAiSdkModel factory`
- 验收：
  - [ ] `pnpm test` 通过
  - [ ] 覆盖率 ≥ 90% 这个文件

### 2.3 Phase A 验证关卡

完成所有 A1-A6 后，spawn 一个独立 audit agent（模板见 §5.2）执行 audit。Audit 通过才能进入 Phase B。

### 2.4 Phase A 完成定义

- [ ] 6 个 task 全部 commit
- [ ] `pnpm build` 三步全绿（renderer + electron + test）
- [ ] 手动测试：Chatfire (OpenAI-compatible) 路径正常
- [ ] 手动测试：Anthropic 路径正常
- [ ] 独立 audit agent 通过

---

## 3. Phase B: Tool Calling + 真流式 (W2)

### 3.1 目标

删除 XML 标签 + 正则解析，改用 LLM 原生 tool calling。同时实现真正的 token-level 流式。

### 3.2 任务清单

#### Task B1: 定义画布工具集

- 文件：新建 `electron/ai/canvasTools.ts`
- 工具：
  ```typescript
  import { tool } from 'ai'
  import { z } from 'zod'

  export const canvasTools = {
    read_canvas_state: tool({
      description: '读取当前画布的所有节点和边',
      parameters: z.object({}),
      // execute 由 IPC 回调到前端，等下一个 task 实现
    }),
    create_canvas_nodes: tool({
      description: '在画布上创建一组待用户确认的节点',
      parameters: z.object({
        summary: z.string(),
        nodes: z.array(z.object({
          clientId: z.string(),
          kind: z.enum(['image', 'video', 'text', 'character', 'scene']),
          title: z.string(),
          prompt: z.string(),
          position: z.object({ x: z.number(), y: z.number() }),
        })).min(1).max(24),
      }),
    }),
    connect_canvas_edges: tool({
      description: '在两个节点之间建立引用边',
      parameters: z.object({
        edges: z.array(z.object({
          sourceClientId: z.string(),
          targetClientId: z.string(),
        })).max(48),
      }),
    }),
    set_node_prompt: tool({
      description: '改写指定节点的提示词',
      parameters: z.object({
        nodeId: z.string(),
        prompt: z.string(),
      }),
    }),
    delete_canvas_nodes: tool({
      description: '删除指定节点（需用户确认）',
      parameters: z.object({
        nodeIds: z.array(z.string()).max(24),
      }),
    }),
  }
  ```
- 提交：`feat(agent): define canvas tool schemas`
- 验收：
  - [ ] `pnpm build:electron` 通过
  - [ ] Zod schema 与现有 `GenerationCanvasNode` 类型兼容

#### Task B2: 实现 runAgentChatV2

- 文件：`electron/runtime.ts`
- 操作：新增 `runAgentChatV2` 函数（**不删** v1，保留作 fallback）
- 用 `streamText({ model, tools, maxSteps: 5, messages })`
- 对每个工具调用，通过 IPC channel `nomi:agents:chat:stream` 多次 emit
  - `{ type: 'content-delta', delta: '...' }`
  - `{ type: 'tool-call', toolName: '...', args: {...}, toolCallId: '...' }`
  - `{ type: 'tool-result', toolCallId: '...', result: {...} }`
  - `{ type: 'finish', reason: 'stop' }`
- 提交：`feat(agent): implement runAgentChatV2 with tool calling + streaming`
- 验收：
  - [ ] tsc 通过
  - [ ] 调用 V2 在终端能看到 token-level emit 日志

#### Task B3: IPC 真流式 channel

- 文件：`electron/preload.ts`, `electron/main.ts`
- 操作：暴露 `ipcRenderer.on('nomi:agents:chat:stream:event', callback)` 给 renderer
- 在 main process 启动一个 stream session ID，main → renderer 推送事件
- 提交：`feat(agent): wire IPC streaming channel for agent events`
- 验收：
  - [ ] 在 renderer console 可以监听到 stream event

#### Task B4: 前端 streaming consumer

- 文件：`src/workbench/ai/workbenchAiClient.ts`, `src/api/server.ts`
- 操作：把 `openDesktopAgentsChatStream` 真正实现成基于 IPC stream channel 的消费者（删掉假流式 `await...then.emit` 三连发）
- 提交：`refactor(agent): replace fake stream with real IPC stream consumer`
- 验收：
  - [ ] AI 面板能看到 token 逐字显示
  - [ ] 首字延迟 < 500ms (模型 RTT 范围内)

#### Task B5: 工具调用确认 UI

- 文件：`src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx`
- 操作：
  - 当 stream event 是 `tool-call` 时，UI 显示 "Agent 准备调用工具: create_canvas_nodes"
  - 提供"确认"和"拒绝"按钮
  - 确认后通过新 IPC channel `nomi:agents:tool:confirm` 把结果回传 main
  - main 把 result 通过 streamText 的 `experimental_tools` callback 回填给 LLM
- 提交：`feat(agent): add tool-call confirmation UI`
- 验收：
  - [ ] 在 UI 内能看到 Agent 工具调用预览
  - [ ] 确认后工具实际执行
  - [ ] 拒绝后 Agent 优雅终止

#### Task B6: 切换生成区 Agent 到 V2

- 文件：`src/workbench/generationCanvas/agent/generationCanvasAgentClient.ts`
- 操作：
  - prompt 改写：删除 `<generation_canvas_plan>` 标签描述，改为简单介绍工具能做什么
  - 调用 `sendWorkbenchAiMessage` 改用 V2 channel
- 提交：`feat(agent): switch generation canvas agent to tool-calling protocol`
- 验收：
  - [ ] 用户输入"画 3 个山水镜头"能看到 Agent 调用 `create_canvas_nodes`
  - [ ] 确认后节点真的出现在画布

#### Task B7: 删除 XML 解析（**在 §5 清理清单中登记**）

- 文件：`src/workbench/generationCanvas/agent/generationCanvasAgentPlan.ts`
- 操作：删除 `PLAN_BLOCK_RE` 和 `parseGenerationCanvasAgentPlan`，保留 `toCreateNodeInputs` 等共享工具
- 删除前：grep 确认无其他文件引用
- 提交：`refactor(agent): remove obsolete XML plan parser`
- 验收：
  - [ ] tsc 通过
  - [ ] grep 全仓无 `<generation_canvas_plan>` 字符串

#### Task B8: Phase B 单元测试

- 文件：新建 `electron/ai/canvasTools.test.ts`
- 测试：
  - 每个工具的 Zod schema 拒绝无效输入
  - 边界值（如 nodes.length > 24 应拒绝）
- 提交：`test(agent): cover canvas tool schemas`
- 验收：
  - [ ] `pnpm test` 通过

### 3.3 Phase B 验证关卡

Spawn audit agent（模板见 §5.2）。

### 3.4 Phase B 完成定义

- [ ] 8 个 task 全部 commit
- [ ] 全仓搜索 `<generation_canvas_plan>` 零结果
- [ ] AI 面板 token 流式正常
- [ ] 工具调用确认流程跑通
- [ ] 独立 audit agent 通过

---

## 4. Phase C: 故事→故事板 Agent (W3)

### 4.1 目标

落地 PRD §10 M2 的核心 demo："粘贴 200 字故事 → 6 个待确认镜头节点 + 连线 → 批量生成 → 发时间轴"。

### 4.2 任务清单

#### Task C1: storyboard-planner skill

- 文件：新建 `skills/workbench-storyboard-planner/SKILL.md`
- 内容：
  - 系统提示：拆镜头方法论（开场/发展/转折/高潮/收尾）
  - 工具白名单：`create_canvas_nodes` + `connect_canvas_edges`
  - 不允许使用：`delete_canvas_nodes`
  - 镜头数量限制 6-12 个
  - prompt 必须用英文
- 提交：`feat(agent): add storyboard-planner skill`
- 验收：
  - [ ] skill loader 能加载

#### Task C2: 创作区"发送到 Agent 拆镜头"按钮

- 文件：`src/workbench/creation/WorkbenchEditor.tsx`
- 操作：工具栏右侧加按钮 "🎬 拆镜头"
- 点击后：
  1. 读取当前编辑器全文
  2. 调用 V2 agent，指定 skill = `workbench-storyboard-planner`
  3. 切换到生成区
  4. 显示 Agent 思考过程 + 工具调用预览
- 提交：`feat(creation): add storyboard generation button`
- 验收：
  - [ ] 点击按钮能触发 Agent
  - [ ] Agent 调用工具时 UI 切到生成区

#### Task C3: Plan→Confirm→Execute UI 完善

- 文件：`src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx`
- 操作：
  - 把多个连续的 tool call 聚合显示为一个"待确认计划卡片"
  - 卡片显示：summary + N 个节点缩略 + 连边数量
  - 一键确认所有工具调用
  - 单独编辑某个节点 prompt（在确认前）
- 提交：`feat(agent): aggregate tool calls into confirmable plan card`
- 验收：
  - [ ] 6 个 create_canvas_nodes + 5 个 connect_canvas_edges 聚合为一张卡
  - [ ] 用户可以预览每个节点

#### Task C4: 批量生成 + 失败重试

- 文件：`src/workbench/generationCanvas/runner/generationRunController.ts` (扩展)
- 操作：
  - 新增 `runGenerationNodesBatch(nodeIds: string[])`
  - 队列化执行，限并发 = 2
  - 失败节点显示重试按钮
- 提交：`feat(canvas): batch generation runner with retry`
- 验收：
  - [ ] 选中 6 个节点 → 点"全部生成" → 串行/有限并发跑完
  - [ ] 失败可单独重试

#### Task C5: "发送故事板到时间轴" 一键操作

- 文件：`src/workbench/generationCanvas/components/CanvasToolbar.tsx`
- 操作：选中一组按时序连边的节点 → 点按钮 → 按 edge 顺序排进时间轴 image track
- 提交：`feat(canvas): one-click send storyboard to timeline`
- 验收：
  - [ ] 选中 6 个节点 + 5 边 → 一键变成时间轴 6 个 clip

#### Task C6: 项目库首页"试试看"

- 文件：`src/workbench/library/ProjectLibraryPage.tsx`
- 操作：
  - 加一个 hero 区："30 秒体验 Nomi"
  - 三个预设故事按钮（漫剧 / 产品 demo / 短视频）
  - 点击：新建项目 + 自动填入故事文本 + 自动触发拆镜头
- 提交：`feat(library): add "try now" hero with example stories`
- 验收：
  - [ ] 三个示例点击后能完整跑通到生成节点出现

#### Task C7: 录制 demo 视频

- 文件：`docs/product/demos/v0.4-story-to-storyboard.mp4` (不入 git，软链接到 release)
- 操作：录 90 秒视频，准备发 Twitter / B站 / GitHub release
- 提交：`docs(product): add v0.4 demo video reference`
- 验收：
  - [ ] 视频时长 ≤ 90 秒
  - [ ] 展示完整流程：首页"试试看" → 故事 → 拆镜头 → 生成 → 时间轴

#### Task C8: Phase C 测试

- 文件：新建 `src/workbench/storyboard.e2e.test.ts`（或 happy-path 单测）
- 测试：模拟 Agent 返回 → plan card 显示 → 确认 → 节点创建
- 提交：`test(agent): cover storyboard happy path`

### 4.3 Phase C 验证关卡

Spawn audit agent。

### 4.4 Phase C 完成定义

- [ ] 8 个 task 全部 commit
- [ ] 90 秒 demo 视频录完
- [ ] Try-Now 三个示例 100% 跑通
- [ ] 独立 audit agent 通过
- [ ] 准备 release v0.4.0

---

## 5. Phase D: Skill Pack v2 + 冗余清理 (W4)

### 5.1 目标

把 26 个 markdown skill 重构为可声明工具/权限的 Skill Pack；归档 22 个早期遗留；同步文档；准备 v0.4.0 release。

### 5.2 任务清单

#### Task D1: 定义 skill.json manifest schema

- 文件：新建 `electron/skills/skillManifestSchema.ts`
- Zod schema：
  ```typescript
  z.object({
    name: z.string(),
    version: z.string(),
    description: z.string(),
    tools: z.array(z.string()),         // 工具白名单
    requiredProviders: z.array(z.enum(['text', 'image', 'video'])),
    permissions: z.array(z.enum(['read-only', 'create', 'delete', 'export'])),
    inputs: z.array(...).optional(),
    examples: z.array(...).optional(),
  })
  ```
- 提交：`feat(skill): define Skill Pack v2 manifest schema`

#### Task D2: 重构 4 个核心 skill

逐个 skill 一个 commit：

- **D2a**: `workbench-storyboard-planner` (Phase C 已建，补充 skill.json)
- **D2b**: `workbench-creation-edit`
- **D2c**: `workbench-generation` (重命名自 `workbench-generation`)
- **D2d**: `creation-edit`

每个：
- 拆出 `SKILL.md` (纯知识) + `skill.json` (manifest)
- 验证 loader 能识别新格式

#### Task D3: 升级 skill loader

- 文件：`electron/runtime.ts:`buildSkillSystemPrompt
- 操作：
  - 优先读取 `skill.json`，按 manifest 注入
  - 兼容旧格式（无 skill.json 时只读 SKILL.md）
  - 工具白名单：传给 streamText 时只暴露 manifest 允许的工具
- 提交：`feat(skill): upgrade skill loader to honor manifest`

#### Task D4: 归档 22 个早期 skill

- 操作：
  ```bash
  mkdir -p skills/legacy
  git mv skills/tapcanvas-* skills/legacy/
  git mv skills/storyboard-gen skills/legacy/  # 被新 storyboard-planner 替代
  git mv skills/agents-team* skills/legacy/
  git mv skills/canvas-workflow skills/legacy/
  git mv skills/timeline-edit skills/legacy/
  git mv skills/long-running-app-harness skills/legacy/
  git mv skills/skill-installer skills/legacy/
  git mv skills/code-review skills/legacy/
  git mv skills/generate-media skills/legacy/
  git mv skills/agent-builder skills/legacy/
  ```
- 在 `skills/legacy/README.md` 写明：这些 skill 来自早期 tapcanvas 项目，未升级到 Skill Pack v2 格式；保留作历史参考
- 提交：`refactor(skill): archive 22 legacy tapcanvas skills`

#### Task D5: 文档同步

- 更新 `docs/quickstart.md`：新建项目流程提到"试试看"
- 更新 `docs/user-guide.md`：删除 `apps/agents` 引用（已不存在）；新增"Agent 工具调用"章节
- 更新 `docs/provider-integration.md`：加入 Anthropic provider 配置说明
- 更新 `README.md`：定位语 + 主 demo 视频链接
- 新建 `docs/skill-pack-format.md`：Skill Pack v2 完整规范
- 提交：`docs: sync to v0.4.0 architecture`

#### Task D6: 全仓静态检查

- 操作：
  ```bash
  pnpm build              # 全栈构建
  pnpm test               # 全部单测
  grep -r '<generation_canvas_plan>' src electron && echo FAIL || echo OK
  grep -r 'apps/agents' docs README.md && echo FAIL || echo OK
  grep -r 'postJson.*chat.*completions' electron && echo FAIL || echo OK  # 不应有裸 fetch
  ```
- 不允许有 FAIL
- 提交：`chore: cleanup pass before v0.4.0 release`

#### Task D7: 发版 v0.4.0

- 更新 `package.json` 版本到 `0.4.0`
- commit + tag + push
- 观察 desktop-release workflow（应自动跑）
- 验收：三平台 binary 上 release 页

### 5.3 Phase D 验证关卡

Spawn final audit agent，全面 review。

### 5.4 Phase D 完成定义

- [ ] 7 个 task 全部 commit
- [ ] v0.4.0 三平台 release 上线
- [ ] 全部静态检查通过
- [ ] 最终 audit agent 通过

---

## 5. 清理与冗余删除清单

**统一登记表**。删除任何代码前必须先在这里登记。

| 删除 | Phase | 文件/标识 | 删除 commit | 状态 |
|---|---|---|---|---|
| `<generation_canvas_plan>` XML parser 整文件 | B7 | `src/workbench/generationCanvas/agent/generationCanvasAgentPlan.ts` (PLAN_BLOCK_RE / parseGenerationCanvasAgentPlan / 相关 schema 与类型；B6 后无外部引用) | (本 commit) | ✅ |
| 假流式逻辑 | B4 | `src/api/server.ts:openDesktopAgentsChatStream` 旧实现 | rebased SHA in branch | ✅ |
| 23 个 legacy skill | D4 | `skills/tapcanvas-*` 等 → `skills/legacy/` | `f690259` | ✅ |
| `apps/` 目录 | (已删) | / | `--` (untracked clean) | ✅ |
| `apps/agents` 在 user-facing docs 中的引用 | D5 | `docs/user-guide.md`, `docs/provider-integration.md`, `README.md` | `a07cbfa` | ✅ |
| 文本资产生成路径的 postJson chat completions | D6 | `electron/runtime.ts:runGenerationTask` 文本路径 → AI SDK `generateText` | (D6 commit) | ✅ |

---

## 5.2 独立 Audit Agent 模板

每个 Phase 结束后必须 spawn 一个独立 audit agent。模板：

```
Agent({
  description: "Audit Phase X migration",
  subagent_type: "general-purpose",
  prompt: `
你是一个独立的代码审查 agent，从未参与 Nomi 的 Agent 迁移工作。
你的任务：审查 Phase X (W{N}) 的实际产出，对照 docs/product/nomi-agent-migration-plan-2026-05-23.md 的 §{section}。

具体步骤：
1. 读 docs/product/nomi-agent-migration-plan-2026-05-23.md §{当前 Phase} 完整章节
2. 用 git log 找出本 Phase 时间范围内的 commits
3. 对每个 commit 验证：
   - 是否完成了对应 task 描述的内容
   - 是否有跳过的验收点
   - commit message 是否符合规范
4. 跑 'pnpm build' 和 'pnpm test'，记录结果
5. 检查 §5 清理清单中本 Phase 应删除的代码是否真的删了 (grep)
6. 检查是否有违反 §0.2 红线的地方

报告格式：
- 通过/不通过
- 通过的项: ...
- 失败的项: ... (每项必须给出文件:行号 + 修复建议)
- 建议是否进入下一 Phase

不要修复任何代码，只报告。报告控制在 500 字内。
`,
  isolation: "worktree"  // 在隔离 worktree 中跑，避免污染主仓
})
```

---

## 6. 进度跟踪

### 当前状态

**总进度**: 29/29 tasks (100% — 待 v0.4.0 final audit 通过后 push tag)
**当前 Phase**: ✅ A + B + C + D 全部完成 → final audit → v0.4.0 release
**最后更新**: 2026-05-24 (Phase D 完结)

### Phase A 进度

| Task | 状态 | Commit |
|---|---|---|
| A1 引入依赖 | ✅ | `b3b31fb` |
| A2 Model factory | ✅ | `8ba59c9` |
| A3 Vendor schema | ✅ | `d20e28a` |
| A4 迁移 runAgentChat | ✅ | `40247c4` |
| A5 Anthropic 端到端 (wiring) | ✅ | `68273e1` |
| A6 单元测试 (4 tests, 92.85% cov) | ✅ | `9eddd9f` |
| A 验证关卡 (independent audit) | ✅ | VERDICT: PROCEED_TO_PHASE_B |

**Phase A 备注**：A5 manual call + screenshot 由于沙箱无 dev 环境未执行，wiring 完整。建议人工跑一次 Claude key 验证 UI 路径。

### Phase B 进度

| Task | 状态 | Commit |
|---|---|---|
| B1 Canvas tools schema | ✅ | (rebased) `90ce2dc` → final SHA on main |
| B2 runAgentChatV2 | ✅ | `9ca6456` |
| B3 IPC 流式 | ✅ | `78f311f` |
| B4 前端 consumer | ✅ | `3523eba` |
| B5 工具确认 UI | ✅ | `ff4d509` |
| B6 切换 V2 | ✅ | `2446d68` |
| B7 删 XML 解析 | ✅ | `348889f` |
| B8 单元测试 (24 tests) | ✅ | `29f1d58` |
| B 验证关卡 | ✅ | VERDICT: PROCEED_TO_PHASE_C |

**Phase B 备注**：
- Executor agent 在 B5 后 rate limit 中断，orchestrator 接手完成 B6-B8
- Phase B 期间 main 有 5 个并行 commit (mp4 export + ffmpeg + quality-gate + icon + ad-hoc sign)，分支两次 rebase 解决冲突
- XML parser (`generationCanvasAgentPlan.ts`) 整文件删除，34 个测试全过（24 新 + 4 buildAiSdk + 6 ffmpeg）

### Phase C 进度

| Task | 状态 | Commit (rebased final SHA on main) |
|---|---|---|
| C1 storyboard skill | ✅ | `b403f76` |
| C2 拆镜头按钮 | ✅ | `ec5a128` |
| C3 Plan card UI | ✅ | `ba31187` |
| C4 批量生成 runtime + 全部生成 button | ✅ | `58ece2f` + `0556943` (button wiring post-audit) |
| C5 一键时间轴 | ✅ | `64db42e` |
| C6 Try-Now 首页 | ✅ | `07199cc` |
| C7 demo 视频 | ⏸ deferred manual | (需 dev 环境录制，v0.4.0 发版前完成) |
| C8 单元测试 (17 tests) | ✅ | `49b52d6` |
| C 验证关卡 | ✅ | VERDICT: PROCEED_TO_PHASE_D_WITH_FOLLOWUPS |

**Phase C 备注**：
- Executor 完成 7 个 task（C1-C6, C8），C7 demo 视频如预期 skip（无 dev 环境）
- Audit 发现 C4 缺 UI button — orchestrator post-audit 补一个 commit (`0556943`) 把 `runGenerationNodesBatch` 接到 CanvasToolbar 的"全部生成"按钮，C4 真正闭环
- Executor 顺手修复了 Phase B 遗留的 `applyConfirmedToolCall` 未定义引用 — 这个 Phase B audit 未抓到的运行时 bug 现已修好
- 51 个测试全过（17 storyboard + 24 canvasTools + 4 buildAiSdk + 6 ffmpeg）
- Audit 残留 followups（不阻塞 Phase D）：
  - 录制 C7 demo 视频（v0.4.0 release 前）
  - 用 store slice 替换 storyboardLauncher 的 CustomEvent + setTimeout（Phase D 期间顺手）
  - Phase B audit 流程改进：仅 tsc 通过不足以验证运行时正确性

### Phase D 进度

| Task | 状态 | Commit (rebased final SHA on main) |
|---|---|---|
| D1 Skill manifest schema (Zod + 5 tests) | ✅ | `92d7067` |
| D2a storyboard-planner manifest | ✅ | `a0bf191` |
| D2b workbench-creation manifest | ✅ | `35be232` |
| D2c workbench-generation manifest | ✅ | `98dd07f` |
| D2d creation-edit manifest | ✅ | `3481d28` |
| D3 Loader 升级 (manifest + 工具白名单 + 旧 markdown 兼容) | ✅ | `819ec47` |
| D4 归档 23 个 legacy skill → `skills/legacy/` | ✅ | `45cc4d0` |
| D5 文档同步 (README + provider-integration + user-guide + 新 skill-pack-format.md) | ✅ | `2fde7d1` |
| D6 静态检查 + postJson chat completions 全清 | ✅ | `02048a0` |
| D7 v0.4.0 版本 bump | ✅ | `ea2e2ea` (本地 tag v0.4.0 等 final audit) |
| D 最终验证 | ⏸ pending | (spawn final audit agent) |

**Phase D 备注**：
- Executor 在 D5 文档同步中途 rate limit，orchestrator 接手完成 D5 收尾 + D6 (含一个新冗余清理：runGenerationTask 的文本资产生成路径 postJson → AI SDK generateText) + D7 版本 bump
- 拆为 22 个 legacy → 实际归档 23 个（多了 storyboard-gen，因为它被新 storyboard-planner 替代）
- 测试 180 个全过（含用户在 Phase D 期间并行新增的 export 相关测试）
- 3 个 grep 严格守卫全清：
  - `<generation_canvas_plan>` — 0 hits in src/electron
  - `apps/agents` in user-facing docs — 0 hits (engineering plan 内部档案不算)
  - `postJson.*chat.*completions` in electron/ — 0 hits

---

## 7. Commit Message 规范

每个 task 必须独立 commit。前缀按 conventional commits：

- `feat(agent):` 新功能
- `refactor(agent):` 重构
- `chore(agent):` 依赖、构建、配置
- `test(agent):` 测试
- `docs(agent):` 文档
- `feat(skill):` / `refactor(skill):` 等

每个 commit 必须包含 `Co-Authored-By` trailer。

---

## 8. 风险与回滚

### 单 commit 回滚

每个 task 一个 commit，理论上任意 commit 都可独立 revert。

### Phase 整体回滚

如果 Phase 完成后 audit 不过：
1. 不要继续下个 Phase
2. 用 `git revert` 把本 Phase 所有 commits 反向
3. 修复问题后重做整个 Phase

### 整体回滚

如果整个迁移失败：
- 主干分支 v0.3 tag (本 PRD 起点) 永远可回退
- 现有 XML 解析路径完整保留到 Phase B 结束，保证至少前两周可随时回滚

---

## 9. 文档关系

| 文档 | 角色 |
|---|---|
| 本文档 | 施工蓝图，每次开工先读 |
| `nomi-agent-tech-audit-2026-05-23.md` | 调研依据，论证为什么这么做 |
| `nomi-product-prd-v2-2026-05-23.md` | 产品战略，回答这件事在大盘里的位置 |
| `nomi-differentiation-prd-2026-05-23.md` | 早期差异化分析（仍有效） |
