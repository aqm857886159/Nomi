# Nomi API

Local API for Nomi workspace orchestration, model provider integration, and asset/task persistence.

## Run

```bash
cp .env.example .env
pnpm prisma:generate
pnpm dev
```

## Main responsibilities

- Auth and user scoping
- Project and asset persistence
- Provider integration
- Task execution and polling
- Public and workbench chat endpoints

## AI 对话架构（当前）

`apps/hono-api` 负责 HTTP 协议、鉴权、硬约束注入、trace/diagnostics 与结果持久化，不承担语义路由、固定工作流编排或 prompt specialist 方法论。

当前 Node 入口是 `src/main.ts`：加载本地环境变量，按需启动 agents bridge，创建 Hono app 和 Node worker env，然后通过原生 Node HTTP server 承载 Hono。API 不再经过 NestJS 或 Express 空壳。

Agents Bridge 的公开边界集中在 `src/modules/agents-bridge/index.ts`。API 路由和服务只从这个模块引用 bridge 能力，包括：

- `isAgentsBridgeEnabled`
- `runAgentsBridgeChatTask`
- `handlePublicAgentsChatRoute`
- `registerPublicAgentsToolBridgeRoutes`

Agents Bridge 的请求/响应契约来自共享 workspace 包 `@nomi/agents-bridge-contract`，避免 `hono-api` 与 `agents-cli` 继续通过相对路径或复制类型通信。

`/public/chat` 与 workbench 相关对话链路应保持同一原则：API 汇集真实上下文和可验证约束，调用 agents / agents-cli 做语义判断与任务执行，最后依据真实 trace、tool calls、节点状态和资产 URL 形成交付证据。不得在 `hono-api` 新增关键词、正则、固定 route 或 case-specific completion patch 来替代 agents 的语义决策。

## Notes

- Keep secrets in local env files.
- Keep provider failures explicit.
- Avoid silent fallback behavior.
