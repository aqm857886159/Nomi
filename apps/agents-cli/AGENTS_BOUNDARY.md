# agents-cli Boundary

## What agents-cli owns

- **Agent loop execution**: runs the multi-turn LLM conversation, tool dispatch, and completion gating
- **LLM client** (`src/llm/client.ts`): direct HTTP calls to any OpenAI-compatible endpoint (chat/completions or /responses API); no Anthropic/OpenAI SDK dependency — uses raw `fetch` with a provider-agnostic `AgentConfig`
- **HTTP server** (`src/server/http-server.ts`): exposes `POST /chat` (streaming SSE or JSON), `/health`, `/skills`, `/collab/status`
- **Session persistence**: Redis (primary, TTL-based) with file-store fallback under `.agents/memory/users/<userId>/sessions/`
- **Completion gating**: deterministic checks for planning checklists, team-tool failures, chapter asset repair — can retry the agent loop before returning

## What agents-cli delegates to hono-api

- **Authentication / user identity**: `userId` is trusted from the request body or `x-agents-user-id` header — agents-cli does not issue or verify tokens
- **Asset resolution**: `assetInputs`, `referenceImageSlots`, `canvasCapabilityManifest` are passed in by the caller (hono-api bridge); agents-cli injects them into the system prompt but does not fetch them
- **Remote/MCP tool endpoints**: `remoteToolConfig` and `mcpToolConfig` are forwarded as-is into `toolContextMeta`
- **Canvas/flow writes**: delegated to canvas tools registered by the caller; agents-cli has no direct DB or canvas access

## Why agents-cli has its own LLM client

The client is provider-agnostic by design: it speaks the OpenAI chat-completions and /responses wire formats and is configured via `AgentConfig.apiBaseUrl` + `apiKey`. This lets the CLI target any compatible gateway (OpenAI, Azure, local proxy) without pulling in a vendor SDK. hono-api may use a different SDK or model routing layer independently.

## Bridge protocol

hono-api calls `POST /chat` with an `AgentsChatRequest` body:

| Field | Purpose |
|---|---|
| `prompt` | user turn |
| `systemPrompt` | upstream system context injected after agents-cli's own system block |
| `sessionId` + `userId` | session scoping for Redis/file history |
| `canvasCapabilityManifest` | canvas tool registry injected into system prompt |
| `assetInputs` / `referenceImageSlots` | resolved asset references |
| `remoteTools` / `mcpTools` + configs | tool definitions forwarded to the agent runner |
| `diagnosticContext` | planning/completion gate hints (e.g. `planningRequired`, `chapterAssetRepairRequired`) |
| `stream: true` | switches response to SSE (`text/event-stream`) |

Response is `AgentsChatResponse` (JSON) or an SSE stream of typed events (`thread.started`, `tool`, `content`, `result`, `done`).
