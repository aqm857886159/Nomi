# Nomi Agent 技术栈调研与重构建议

日期：2026-05-23
作者：技术架构组

> 配合阅读 `nomi-product-prd-v2-2026-05-23.md`。本文档回答：当前 Agent 实现现状如何？技术选型在 2026 年是否合理？为支撑 PRD 描述的 Phase 1/2 目标该如何重构？

---

## 0. 执行摘要 (TL;DR)

**结论：当前 Agent 实现是"能工作但不可持续"的 v0.5 级别原型。立即升级到 Vercel AI SDK 是支撑 PRD 三阶段路线图的硬前置。**

| 维度 | 当前 | 业界 2026 标准 | Nomi 应该走的路 |
|---|---|---|---|
| LLM SDK | 无（裸 fetch） | Vercel AI SDK / Anthropic SDK / OpenAI SDK | **Vercel AI SDK** |
| 结构化输出 | XML 标签包裹 JSON + 正则解析 | Zod schema + 原生 tool calling | **Tool calling + generateObject** |
| 流式输出 | 假流式（一次性返回） | 原生 token stream + 工具事件 stream | **streamText + onToolCall** |
| Agent 循环 | 单次调用 | 多步循环（`maxSteps`）+ 工具执行 | **多步 Agent loop** |
| 工具系统 | 不存在（仅 markdown 提示词注入） | Zod schema + 类型化工具 + MCP | **Tool catalog + MCP** |
| 记忆 | 无 | 会话历史 + 项目级 RAG | **会话内存 + 项目证据库** |
| Provider 兼容 | 仅 OpenAI-compatible | 全家桶（OpenAI/Anthropic/Gemini/Ollama） | **Provider-agnostic** |

**核心结论**：在做 Phase 1 的 Story→Storyboard Agent 之前，必须先用 **2-3 周** 完成 AI SDK 迁移。否则会继续往一个根本性错误的架构上堆代码（XML 解析 + 单次调用 + 假流式），未来重构成本翻倍。

---

## 1. 当前实现现状

### 1.1 文件结构与调用链

```
┌─────────────────────────────────────────────────────────────────────┐
│  src/workbench/generationCanvas/agent/                            │
│    ├─ generationCanvasAgentClient.ts   (建 prompt + 调 AI)          │
│    └─ generationCanvasAgentPlan.ts     (Zod schema + 正则解析)      │
│                          │                                          │
│                          ▼                                          │
│  src/workbench/ai/workbenchAiClient.ts  (payload 包装)              │
│                          │                                          │
│                          ▼                                          │
│  src/api/server.ts                                                  │
│    ├─ agentsChat()              ──────── desktop.agents.chat()     │
│    └─ openDesktopAgentsChatStream() ──── 假流式（包一层）           │
│                          │                                          │
│                          ▼ IPC: nomi:agents:chat                    │
│  electron/runtime.ts:1786 runAgentChat()                            │
│    ├─ chooseTextModel()         (选第一个 enabled 的文本模型)       │
│    ├─ buildSkillSystemPrompt()  (拼接 markdown skill 内容)          │
│    └─ postJson() to /v1/chat/completions  (裸 fetch)                │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 核心问题清单

#### 问题 1：用 XML 标签 + 正则解析代替原生 tool calling

**当前做法**（`generationCanvasAgentClient.ts:44`）：

```typescript
'返回格式（Agent/润色模式）：',
'<generation_canvas_plan>{"action":"create_generation_canvas_nodes",...}</generation_canvas_plan>',
```

然后用正则解析（`generationCanvasAgentPlan.ts:53`）：

```typescript
const PLAN_BLOCK_RE = /<generation_canvas_plan>([\s\S]*?)<\/generation_canvas_plan>/i
```

**问题**：
- LLM 可能忘记标签、忘记 JSON 转义、漏写右括号
- 没有 schema 级别的约束（LLM 不知道字段长什么样）
- 现代 OpenAI 兼容 API（包括 Chatfire）全部支持 `tools` 参数 + `response_format: json_schema`，我们没用
- Anthropic 的 `tool_use` block 更优雅，我们也没用
- 解析失败时 fallback 不友好

**应该的做法**：
```typescript
const tools = {
  create_canvas_nodes: tool({
    description: '在画布上创建一组待确认节点',
    parameters: z.object({
      summary: z.string(),
      nodes: z.array(z.object({...})),
      edges: z.array(...),
    }),
    execute: async (input) => { /* 由前端应用 */ },
  }),
}
const result = await generateText({ model, tools, prompt: ... })
// result.toolCalls 自动是类型安全的对象
```

#### 问题 2：流式是假的

**当前做法**（`api/server.ts:226`）：

```typescript
void desktop.agents.chat(payload).then((rawResponse) => {
  // 等完整响应后一次性发 content + result + done
  handlers.onEvent({ event: 'content', data: { delta: response.text, text: response.text } })
  handlers.onEvent({ event: 'result', data: { response } })
  handlers.onEvent({ event: 'done', ... })
})
```

**问题**：
- 用户在生成长 plan 时干等 5-30 秒，看不到任何反馈
- 真正的 token-by-token 流式会让用户立刻看到 Agent 在"思考"
- 现代 LLM API 的首 token 延迟通常 < 500ms，但我们把这个优势完全浪费了
- 在 Electron 环境完全可以实现真流式（SSE 或 IPC 多次 emit）

#### 问题 3：单次调用，无 Agent 循环

**当前**：`runAgentChat` 就是单次 chat completion。Agent 想做什么必须一次说完。

**问题**：
- 不能"先看看现在画布上有什么 → 再决定加什么"
- 不能"先生成 prompt → 检查模型是否支持 → 调整 → 再调用"
- 不能"发现某个节点生成失败 → 自动重试或换模型"
- 这些都是 Agent 应该能做的，现在做不了

**应该的做法**：
```typescript
const result = await generateText({
  model,
  tools,
  maxSteps: 5,  // 关键：允许多步
  prompt: userMessage,
})
// LLM 可以：调用 read_canvas → 思考 → 调用 create_nodes → 调用 connect_edges → 结束
```

#### 问题 4：无会话记忆

**当前**：每次 `sendGenerationCanvasAgentMessage` 都是一次独立调用，没有 history。

**问题**：
- 用户说"刚才那个第 3 个节点改成黄昏色调" → Agent 不知道"刚才"是什么
- 用户说"按上次那种风格" → Agent 不知道"上次"在哪
- AI 面板的对话历史 UI 已经存在，但每次提交都是从零开始

#### 问题 5：Skill 系统是"伪 Skill"

**当前**：26 个 `skills/*/SKILL.md` 文件 → `findSkillRecord` 按 key 匹配 → 整个 markdown 内容作为 system prompt 注入。

**问题**：
- 没有工具定义，只有文字提示
- 没有 schema 约束输出格式
- 没有权限边界（哪些 skill 能调哪些工具）
- 没有依赖声明（这个 skill 需要哪些 provider）
- 26 个 skill 中大部分是早期项目（tapcanvas-*）的遗留，只有 4-5 个真正用于当前 workbench
- 远未达到 PRD §4.2 描述的"Skill Pack"生态目标

#### 问题 6：Provider 锁定在 OpenAI-compatible

**当前**：`runAgentChat` 写死 `/v1/chat/completions`。

**问题**：
- 加 Anthropic：需要重写整个调用逻辑（Anthropic 用 `/v1/messages`，请求格式差异大）
- 加 Gemini：同上
- 加本地 Ollama：虽然有 OpenAI 兼容层，但 native Ollama API 性能更好
- 用户绕过我们，自己接 Claude / Gemini 都无法使用

**应该的做法**：用 AI SDK 的 provider 抽象：

```typescript
import { openai } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'
import { google } from '@ai-sdk/google'
import { ollama } from 'ollama-ai-provider'

const model = providerKey === 'anthropic' 
  ? anthropic('claude-sonnet-4-5')
  : openai('gpt-4o')
// 同一份代码，自动适配
```

#### 问题 7：无 MCP 支持

**MCP (Model Context Protocol)** 是 Anthropic 推出、现已成为业界标准的工具协议。Claude Desktop、Cursor、Continue、Cline 全部支持 MCP。

**问题**：
- 用户没法把自己的 MCP server（如 Notion、本地文件、浏览器自动化）接入 Nomi
- Nomi 也没法把自己暴露成 MCP server 给其他工具用（PRD §7 提到的"本地 HTTP/MCP/CLI"接口）
- 错过了一个**开源 + 桌面**产品最容易拥抱的标准

---

## 2. 业界 2026 现状参考

### 2.1 主流 TS Agent 框架对比

| 框架 | 心智 | 流式 | Tool calling | 多 step | MCP | Electron 友好 | 心智成本 |
|---|---|---|---|---|---|---|---|
| **Vercel AI SDK** | 通用 LLM 抽象 | ★★★★★ | ★★★★★ (Zod) | ★★★★ (maxSteps) | ★★★ (集成中) | ★★★★★ | 低 |
| **Mastra** | 全栈 agent 框架 | ★★★★ | ★★★★ | ★★★★★ (workflow) | ★★★★ | ★★★★ | 中高 |
| **Claude Agent SDK** | Claude 专用 | ★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★ | 中 |
| **OpenAI Agents SDK** | OpenAI 专用 | ★★★★ | ★★★★★ | ★★★★ | ★★ | ★★★ | 中 |
| **LangChain.js** | 重量级，python 移植 | ★★★ | ★★★★ | ★★★★ | ★★ | ★★ | 高 |
| **LangGraph.js** | 状态机风格 | ★★★ | ★★★★ | ★★★★★ | ★★ | ★★ | 高 |

### 2.2 业界趋势

1. **Tool calling 成为标准**：所有主流模型（GPT、Claude、Gemini、Llama 3+、Qwen 2+）原生支持 function calling
2. **MCP 快速普及**：从 Anthropic 内部协议，到 Cursor/Continue/Cline 全采纳，2026 年底前会是默认设定
3. **结构化输出标准化**：JSON Schema 或 Zod schema 作为约束，无需 prompt 工程哄它输出 JSON
4. **流式 + 工具事件混合**：不只是 token stream，工具调用、思考过程都可流式
5. **Provider-agnostic 是基础设施**：用户自带 key，可在不同模型间切换
6. **多 Agent 协作**：单一 Agent → Supervisor/Worker 模式 → 群体 Agent（如 OpenAI Swarm、Mastra Agents Network）

### 2.3 桌面/本地优先 AI 产品的标杆

值得参考的同类产品技术栈：

| 产品 | 框架 | 模式 |
|---|---|---|
| **Claude Desktop** | Anthropic SDK + MCP | 工具调用 + MCP server 加载 |
| **Cursor** | OpenAI SDK + 自研 RPC | Provider 切换 + 真流式 + 工具调用 |
| **Continue (VS Code)** | 自研但符合标准 | Provider 抽象 + MCP + 多 step |
| **Cline (VS Code)** | OpenAI SDK + 自研 | Plan/Act 双模式 + 工具调用 |
| **Krea Web** | OpenAI/Replicate SDK | 流式 + 工具调用（部分） |
| **Bolt.diy (开源)** | Vercel AI SDK | Multi-provider + 流式 + 工具 |

**关键观察**：所有这些产品都已经在用现代的 SDK + tool calling + MCP。Nomi 用裸 fetch + XML 解析，技术债务正在拉大。

---

## 3. 推荐技术栈

### 3.1 核心选型：Vercel AI SDK

**为什么是它而不是 Mastra**：

| 维度 | Vercel AI SDK | Mastra |
|---|---|---|
| 心智模型 | 通用 LLM 抽象，按需组合 | 框架性强，规定 workflow/memory 范式 |
| 学习成本 | 1 天上手 | 1 周吃透 |
| 与现有代码契合度 | 高（保留现有 zustand store） | 中（Mastra 自己有状态层） |
| 灵活性 | 极高 | 中 |
| 社区/文档 | 极强（Vercel 自家产品） | 强（新兴） |
| 风险 | 低 | 中（创业产品，未来不确定） |

**结论**：Vercel AI SDK 是 Nomi 这种"已有产品框架、需要 LLM 能力"场景的最优解。Mastra 适合从零开始的 agent-first 产品。

**为什么也不直接用 Claude Agent SDK / OpenAI Agents SDK**：
- 都锁单一 provider
- Nomi 必须 provider-agnostic（用户自带任何 key）
- 用 AI SDK 包装即可获得这两者的能力 + 多 provider 支持

### 3.2 推荐技术清单

```jsonc
{
  "dependencies": {
    "ai": "^4.x",                      // 核心 AI SDK
    "@ai-sdk/openai": "^1.x",          // OpenAI provider
    "@ai-sdk/anthropic": "^1.x",       // Anthropic provider
    "@ai-sdk/google": "^1.x",          // Google provider
    "@ai-sdk/openai-compatible": "^1.x", // Chatfire 等兼容方
    "ollama-ai-provider": "^1.x",      // 本地 Ollama
    "@modelcontextprotocol/sdk": "^1.x" // MCP 客户端
  }
}
```

**总体新增依赖体积**：约 200KB（gzip），可忽略。

### 3.3 Skill 系统重构（Phase 2）

将当前 26 个 markdown skills 重构为 **Skill Pack** 格式（呼应 PRD §4.2）：

```
skills/
  workbench-storyboard-planner/
    skill.json          # 元数据：name, version, deps, permissions
    SKILL.md            # 知识/方法论
    tools.ts            # 工具定义（Zod schema + 实现）
    examples/           # 示例输入/输出
    README.md           # 用户文档
```

每个 Skill Pack 声明：
- 它能用哪些工具（`canvas.*`, `timeline.*`, `mcp.notion.*` 等）
- 它需要哪些 provider 能力（text / image / video）
- 它的权限边界（read-only / can-modify / can-delete / can-export）

### 3.4 MCP 集成（Phase 3）

两个方向：

**方向 A：Nomi 作为 MCP 客户端**
- 用户可以在设置里添加 MCP server URL
- Agent 自动获得这些 server 暴露的工具
- 例：连接 Notion MCP → Agent 可以从 Notion 拉剧本

**方向 B：Nomi 作为 MCP 服务器**
- Nomi 把项目操作（创建节点、查询资产、触发生成）暴露为 MCP 工具
- Cursor、Claude Desktop、其他 Agent 可以通过 MCP 控制 Nomi
- 呼应 PRD §7.6 的"本地自动化接口"

---

## 4. 迁移计划

### 4.1 总体阶段

```
Phase A (1 周): AI SDK 基础迁移         ─── 必须做，硬前置
Phase B (1 周): Tool Calling + 流式       ─── 必须做，硬前置
Phase C (1 周): Story→Storyboard Agent    ─── PRD Phase 1 主目标
Phase D (1 周): Skill Pack v2 重构        ─── PRD §4.2 落地
Phase E (后续): MCP 集成                  ─── 配合 PRD Phase 3
```

**Phase A + B + C 三周**正好覆盖 PRD 第 1-3 月的关键里程碑。

### 4.2 Phase A：AI SDK 基础迁移（Week 1）

**目标**：把 `runAgentChat` 从裸 fetch 替换为 AI SDK，**保留对外行为完全兼容**。

任务清单：

- [ ] 引入 `ai`, `@ai-sdk/openai-compatible`, `@ai-sdk/anthropic` 依赖
- [ ] 在 `electron/runtime.ts` 新增 `buildAiSdkModel(vendor, model, apiKey)` 工厂函数
  - vendor.authType === 'openai-compatible' → `createOpenAICompatible({ baseURL, apiKey }).chatModel(model)`
  - vendor.authType === 'anthropic' → `createAnthropic({ apiKey }).languageModel(model)`
  - 留 Gemini / Ollama 后续扩展
- [ ] 替换 `runAgentChat` 内的 `postJson(...)` 为 `generateText({ model, messages, ... })`
- [ ] 验证对 Chatfire 现有调用兼容
- [ ] 模型目录 schema 扩展：vendor 增加 `kind: 'openai-compatible' | 'anthropic' | 'google' | 'ollama'`

**验收**：现有生成区 AI 面板不变，调用从底层走 AI SDK；可在 model catalog 添加 Anthropic key 并工作。

### 4.3 Phase B：Tool Calling + 真流式（Week 2）

**目标**：删掉 XML 标签 + 正则解析，改用原生 tool calling。

任务清单：

- [ ] 在 `electron/runtime.ts` 实现 `runAgentChatV2`：用 `streamText({ model, tools, maxSteps })`
- [ ] 工具集首发 5 个：
  ```typescript
  canvas.read_state        // 读画布快照
  canvas.create_nodes      // 创建节点（替代 plan）
  canvas.connect           // 连边
  canvas.set_node_prompt   // 改 prompt
  canvas.delete_nodes      // 删节点（需确认）
  ```
- [ ] IPC 改为真流式：`agents:chat:stream:event` 分多次 emit
- [ ] 前端 `workbenchAiClient` 消费 token-level stream + tool-call event
- [ ] AI 面板 UI 显示"Agent 正在调用工具：xxx"
- [ ] 删除 `generationCanvasAgentPlan.ts` 的 XML 解析逻辑
- [ ] 用户确认流程：tool call 进入待确认 queue，用户 confirm 后执行

**验收**：
- AI 面板 token 流式显示（无 5 秒空等）
- Agent 可以多步：先 `read_state` 看画布 → 再 `create_nodes` 创建
- 工具调用走 LLM 原生 protocol，不需要 prompt 哄它

### 4.4 Phase C：Story→Storyboard Agent（Week 3）

**目标**：完成 PRD §10 M2 的"故事→故事板"核心 demo。

任务清单：

- [ ] 新建 `storyboard-planner` skill：
  - 系统提示：拆镜头、设定景别、生成 prompt
  - 限定使用工具：`canvas.read_state`、`canvas.create_nodes`、`canvas.connect`
- [ ] 创作区编辑器添加"发送到 Agent 拆镜头"按钮
- [ ] Agent 接收 200-500 字故事 → 生成 6-12 个待确认 image 节点 + 连线
- [ ] 用户确认后批量生成（接现有 `runGenerationNode`）
- [ ] 失败可重试，成功可一键发时间轴
- [ ] 新建项目首页加"试试看"按钮 + 3 个示例故事

**验收**：录制 90 秒 demo 视频，作为 v0.4 release 主物料。

### 4.5 Phase D：Skill Pack v2（Week 4）

**目标**：把 markdown skill 升级为可声明工具/权限的 Skill Pack。

任务清单：

- [ ] 定义 Skill Pack manifest schema（`skill.json`）
- [ ] 重构 4 个核心 skill 到新格式：
  - `workbench-storyboard-planner`（Phase C 产物）
  - `workbench-creation-edit`
  - `workbench-generation-canvas-planner`
  - `tapcanvas-storyboard-expert`
- [ ] 删除 22 个早期 tapcanvas-* 遗留 skill（或归档到 `skills/legacy/`）
- [ ] `electron/runtime.ts` 升级 skill loader：读取 manifest + 工具白名单
- [ ] 文档：`docs/skill-pack-format.md`

### 4.6 Phase E：MCP 集成（后续，配合 Phase 3）

留给 PRD Phase 3 时间窗口。届时需要做的：

- [ ] 集成 `@modelcontextprotocol/sdk` 客户端
- [ ] 设置面板加 "MCP Servers" 配置
- [ ] Nomi 本身暴露为 MCP server：`nomi://canvas/`, `nomi://project/`
- [ ] 写 1-2 个示例 MCP server（如 Nomi-Notion bridge）

---

## 5. 风险与对策

### 风险 1：迁移期间影响现有用户体验

**对策**：
- Phase A 完全向后兼容（仅改底层调用方式）
- Phase B 之前保留 XML 解析作为 fallback
- 每个 Phase 独立可发布

### 风险 2：AI SDK 与 Chatfire 兼容性

**对策**：
- Chatfire 是 OpenAI-compatible → 用 `@ai-sdk/openai-compatible` 必然兼容
- Phase A 第一步先在本地测试一次 Chatfire 调用确认

### 风险 3：工具调用模型支持差异

**对策**：
- 主流 GPT-4 family / Claude 3+ / Gemini 1.5+ 全部支持 tool calling
- 对于不支持的本地小模型，AI SDK 自动 fallback 到 prompt-based JSON 模式
- 在模型目录 UI 加标记"支持 Tool Calling: ✓/✗"

### 风险 4：MCP 协议演化太快

**对策**：
- Phase E 才考虑 MCP，到时协议已稳定（预计 2026 年底已成熟）
- 即使协议变化，AI SDK 会跟进，我们改的代码量小

---

## 6. 决策点

需要确认的方向：

1. **是否同意 AI SDK 优先于 Story→Storyboard**？
   - 同意：Phase A → B → C 顺序，总耗时 3 周
   - 不同意：先做 Story→Storyboard 在现有架构上，未来再迁移（**不推荐**，技术债务翻倍）

2. **AI SDK vs Mastra**？
   - 建议 AI SDK（理由见 §3.1）
   - 如果未来发现 workflow 编排需求强烈，Phase D 之后再叠 Mastra 不冲突

3. **是否要在 Phase A 同时把 Anthropic provider 接上**？
   - 建议是。多 provider 是 Nomi 差异化的核心承诺，越早起步越好
   - 工作量增量：~半天

4. **Skill Pack 重构是否在 Phase D 一次完成**？
   - 建议是。一次切干净，避免新旧两套并存

---

## 7. 与 PRD 的关系

| PRD 章节 | 本文档对应 |
|---|---|
| §4.3 Agent Runtime Layer | §3、§4 完整 |
| §4.2 开源扩展 / Skill Pack | §3.3、§4.5 |
| §6 12-month 路线图 Phase 1/2 | §4.2-4.4 是 Phase 1 的真实拆解 |
| §7 Provider Pack | §3.2 多 provider + §4.2 |
| §7.6 本地自动化接口 / MCP | §3.4、§4.6 |

**关键论断**：PRD 描述的 v0.4 Agent 执行链、v0.6 sketch-to-image、v0.7 Recipe，全部依赖一个能稳定 tool-call 的 Agent 基础设施。当前的 XML + 正则方案做不到。

---

## 8. 立即可做的下一个 commit

如果同意上面的方向，第一个 commit 应该是：

> `feat(agent): introduce Vercel AI SDK as LLM abstraction layer`

内容：
- 添加 `ai`, `@ai-sdk/openai-compatible`, `@ai-sdk/anthropic` 依赖
- 在 `electron/runtime.ts` 实现 `buildAiSdkModel` 工厂
- `runAgentChat` 内部走 AI SDK 的 `generateText`，但保留对外接口完全兼容
- 添加 unit test 覆盖：OpenAI-compatible 路径 + Anthropic 路径

这个 commit 单独可发布、可回滚、不破坏任何现有功能，是整个迁移最稳的起点。
