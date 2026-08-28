# `canvas.read` 单一能力脊梁实施计划

> 状态：🚧 进行中（Slice A / B1–B5 已完成，B6 全量验收中）
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` and `test-driven-development`. 每个实现任务必须先看到真实 RED，再做最小 GREEN，并依次经过独立规格审查、质量审查。

**Goal:** 用一个零额度、只读能力完成两段连续迁移：先让 Pi、MCP、界面只维护一份 `canvas.read` 合同、字段语义和安全投影；随后建立可信项目调用与 `SurfacePortBinding`，把三个入口切到同一个 main-only executor，并删除最后的旧执行 route。

**Why two implementation checkpoints but one PR:** 当前 Pi 在 renderer store 读画布，MCP 在 main 的 `ProjectGateway` 读画布，仓库尚无稳定的窗口/项目世代绑定。A 先统一可安全统一的合同并独立复审，B 再完成可信 invocation 与 port binding；两段都留在同一任务分支，只有 B 删除临时接缝、完整验收通过后才一次提交并开一个 PR。这样既不会提前冒充“统一执行器”，也不会把短命的 legacy debt 合进主线。

**Base:** `origin/main@a7a07cc4446f865fcbba528299ad9a73133ef6ea`

**Branch / worktree:** `codex/project-agent-host-phase1-20260827` / `/Users/aoqimin/Desktop/Nomi-project-agent-host-phase1-20260827`

---

## 用户会得到什么

A checkpoint 不改界面。用户看见的行为应保持不变，但三处入口不再各自决定“画布里哪些字段能给 Agent”：

- Pi 仍收到紧凑文本，不把整张 JSON 灌进上下文；
- MCP 收到结构化安全结果，不泄露 URL、raw provider 数据、taskId 或 provenance；
- 同一个节点版本只以显式 `result.id` 表示，不拿 URL 或文本冒充稳定身份；
- MCP 的结构化输出也从同一 safe projector 派生；现有“裸 `projectId`”权限边界被机器标成待 Slice B 删除的 legacy debt，不伪装成已经安全。

B checkpoint 完成后，A 项目发起的读取即使遇到切页、重载、同 ID 恢复或迟到回包，也不可能误读 B 项目；Pi、MCP、Nomi renderer 才真正经过同一个主进程执行器，随后整体只开一个 PR。

一句话：**先把“能力是什么、能看见什么”合一，再把“谁有权在什么项目执行”合一。**

## 两个实现 checkpoint 的诚实出口

### Slice A — `canvas.read canonical contract and projections`

可以宣称：

> `canvas.read` 的合同、字段语义、effect、aliases、Pi/MCP 展示投影和安全 projector 已单源。Pi 的 renderer 环境 adapter 与 main gateway adapter 仍是两个执行环境；MCP 仍沿用现有裸 `projectId` route，并被明确登记为 `legacy_unverified`，稳定 lease / Surface binding 尚未完成。

不可以宣称：

- Pi / MCP / renderer 已使用同一个 executor；
- `projectId` 已经是可信项目身份；
- ProjectAgentHost 已完成；
- 写入、审批、付费能力已经可以照搬。

### Slice B — `verified canvas.read invocation and surface binding`

只有同时完成以下事项后才可宣称执行器合一：

- 每次执行都从可信 transport 构造 `VerifiedCapabilityInvocation`；
- MCP 验 lease/scope，renderer 验 sender 与 `SurfacePortBinding`，本地 RPC 使用其已认证 caller policy；
- main-only executor 按冻结 binding 解析 port，不读“当前页面/当前项目”；
- Pi、MCP、CLI/internal RPC 全部切到该 executor；
- 旧 `canvas.read` switch、renderer read executor 和兼容 route 同提交删除。

---

## 全程不变量

1. shared 合同只依赖 Zod、同目录纯模块和更底层的 neutral canvas-domain leaf；不得 import Node、Electron、React、Zustand、DOM、i18n、gateway、repository、provider 或 pi SDK。
2. shared 只有 contract/schema/projector/formatter 所需的纯数据逻辑；特权 executor registry 只存在 main。
3. semantic input 严格为空对象；transport 的 lease、project hint、sender 信息不混进模型可填写的 input。
4. `effect: read` 只有绑定 read-only port 后才能投影成 MCP `readOnlyHint`；标签本身不是安全边界。
5. 只接受显式、非空、opaque `result.id`；没有 ID 的遗留结果不外放 identity，绝不回退 URL、asset、thumbnail 或 text。
6. canonical JSON 与 Pi 文本是两种 presentation：前者是安全结构结果，后者是由它派生的紧凑 formatter。不能把 JSON 直接 `JSON.stringify` 回灌模型历史。
7. ProductionRun、ProjectGateway、canvas document、Undo/proposal transaction 都保留现有 owner；本切片只引用，不复制。
8. A 的临时接缝不得提交到远端；最终 PR 必须由 B 同时删掉旧 owner、feature flag、并行 executor 与 fallback。

## shared 边界

目录与依赖方向：

- `electron/shared/canvas/`：main 与 renderer 共用的中立画布领域合同；`generationNodeStatus.ts` 唯一拥有节点状态成员、runtime schema 与派生类型。
- `electron/shared/agentCapabilities/`：能力合同与安全 projector；可以向下依赖 `electron/shared/canvas/`，renderer 可以分别依赖两者，但 neutral canvas leaf 不得反向依赖 agent capability。

允许：

- `zod`
- 同目录纯类型、常量、无副作用函数
- `agentCapabilities` 向下依赖 `shared/canvas` 的中立领域合同
- JSON 可序列化输入输出

禁止：

- `electron`、`node:*`、`fs/path/crypto`、`process`、`Buffer`
- React、Zustand、DOM、i18n
- `src/**`、`capabilityCore/**`、repository、gateway、provider、pi SDK
- `zod-to-json-schema`；转换留在 MCP adapter
- 聚合全目录的 runtime barrel

---

# Slice A：合同与字段投影

## Task A0：固定基线和真实入口 inventory

**Files:** none

1. 确认隔离树：

```bash
git branch --show-current
git status --short
git rev-parse HEAD
git rev-parse origin/main
```

2. 记录所有生产入口，不靠记忆列文件：

```bash
rg -n "read_canvas_state|nomi_read_canvas|canvas\.read|READ_ONLY_TOOLS|TOOL_META|readCanvas" \
  electron src scripts --glob '!**/*.test.*'
```

3. 跑当前 focused 基线并保存结果：

```bash
pnpm exec vitest run \
  electron/harness/tools/canvasDescriptors.test.ts \
  electron/ai/agentChatV2.facade.test.ts \
  electron/capabilityCore/canvasGraph.test.ts \
  electron/capabilityCore/core.test.ts \
  electron/capabilityCore/mcpArgValidation.test.ts \
  electron/capabilityCore/mcpToolResults.test.ts \
  electron/capabilityCore/rpcServer.test.ts \
  src/workbench/generationCanvas/agent/canvasPromptContext.test.ts \
  src/workbench/generationCanvas/agent/gate.test.ts \
  src/workbench/generationCanvas/agent/applyCanvasToolCall.test.ts \
  src/workbench/generationCanvas/agent/generationCanvasAgentClient.test.ts \
  src/workbench/generationCanvas/agent/runStoryboardPlanner.test.ts
```

## Task A1：用 RED 定义 pure contract 与 safe projector

**Create:**

- `electron/shared/canvas/generationNodeStatus.ts`
- `electron/shared/canvas/generationNodeStatus.test.ts`
- `electron/shared/agentCapabilities/capabilityContract.ts`
- `electron/shared/agentCapabilities/canvasRead.ts`
- `electron/shared/agentCapabilities/canvasRead.test.ts`
- `electron/shared/agentCapabilities/registry.ts`
- `electron/shared/agentCapabilities/registry.test.ts`

### RED

先写会因模块/export 不存在而失败的测试，覆盖：

1. canonical ID `canvas.read`、Pi alias `read_canvas_state`、MCP alias `nomi_read_canvas`、effect `read`、approval `none` 精确且全局唯一；运行中现状诚实标 `legacy_unverified`，不能提前写 `mcp_safe`。
2. semantic input 只接受 `{}`；`{projectId}`、`{leaseHandle}` 和任意额外字段都拒绝。
3. 输出只允许决策所需字段：
   - node：`id/kind/title/prompt/status/position/locked/shotIndex/hasResult/currentResultId/resultIds`
   - edge：`id/source/target/mode/order`
   - group：`id/name/nodeIds/collapsed`
   - `selectedNodeIds`
4. `currentResultId/resultIds` 只接收显式非空 `result.id`；缺 ID 即省略，不调用 `resultIdentity` 的 URL/text fallback。
5. 递归禁止结果对象的 key：`raw/url/thumbnailUrl/meta/provider/providerTaskId/taskId/provenance/runs`。
6. 只对 `currentResultId/resultIds` 禁止 URL-like value：`file://`、`http://`、`https://`、`nomi-local://`、`data:`；用户自己的 prompt/title 可以合法包含网址，不能被静默改写。
7. 坏节点被过滤后，edge source/target、group nodeIds、selection 只保留 surviving node IDs，去重且顺序稳定。
8. 坏 position/status/result/group 不导致整个画布伪装为空；合法字段按确定默认值归一。
9. projector 是纯函数，不读取 store/gateway/global current project。
10. registry 只登记 contract；不含 adapter、port、gateway 或 executor。
11. 节点状态成员不在 capability 内复制；renderer runtime schema、`GenerationNodeStatus` 与 `canvas.read` parser 全部从 neutral `shared/canvas` owner 派生。

```bash
pnpm exec vitest run \
  electron/shared/agentCapabilities/canvasRead.test.ts \
  electron/shared/agentCapabilities/registry.test.ts
```

### GREEN

- `CapabilityContract` 只表达 ID/version、aliases、input/output schema、effect、approval、required port kind 和 projection metadata。
- `GENERATION_NODE_STATUSES`、runtime schema、派生类型与 parser 由 neutral canvas-domain leaf 单源；renderer 保留原导出名但不再拥有成员。
- `projectCanvasRead(source: unknown): CanvasReadResult` 是字段语义唯一 owner。
- 不在 shared 创建 `executeCanvasRead`；当前尚无可信 invocation/Surface binding。
- 不提前设计未来几十项能力的 class hierarchy 或 service locator。

验证：

```bash
pnpm exec vitest run electron/shared/agentCapabilities
pnpm exec eslint --max-warnings=0 electron/shared/agentCapabilities
pnpm exec tsc -p electron/tsconfig.json --noEmit
pnpm exec tsc -p tsconfig.app.json --noEmit
```

## Task A2：迁 Pi descriptor、紧凑 formatter 与 renderer 环境 adapter

**Modify / create as proved by inventory:**

- `electron/harness/tools/canvasDescriptors.ts`
- `electron/harness/tools/canvasDescriptors.test.ts`
- `electron/harness/agentChatPolicy.ts`
- `electron/ai/agentChatV2.facade.test.ts`
- `src/workbench/generationCanvas/agent/canvasPromptContext.ts`
- `src/workbench/generationCanvas/agent/canvasPromptContext.test.ts`
- `src/workbench/generationCanvas/agent/gate.ts`
- `src/workbench/generationCanvas/agent/gate.test.ts`
- `src/workbench/generationCanvas/agent/canvasReadCapabilityAdapter.ts`
- `src/workbench/generationCanvas/agent/canvasReadCapabilityAdapter.test.ts`
- `src/workbench/generationCanvas/agent/applyCanvasToolCall.ts`
- `src/workbench/generationCanvas/agent/applyCanvasToolCall.test.ts`
- `src/workbench/generationCanvas/agent/generationCanvasAgentClient.ts`
- `src/workbench/generationCanvas/agent/generationCanvasAgentClient.test.ts`
- `src/workbench/generationCanvas/agent/runStoryboardPlanner.ts`
- `src/workbench/generationCanvas/agent/runStoryboardPlanner.test.ts`
- `src/workbench/generationCanvas/components/toolCallSummary.ts`（若 inventory 证明仍在真实 UI 使用）

### RED

1. descriptor 的 name/description/input schema 由 contract Pi projection 派生；删本地 literal 后仍相同。
2. gate 的 read effect 来自 contract；删 `TOOL_META.read_canvas_state` 后仍自动允许。
3. formatter 只接 `CanvasReadResult`，输出紧凑文本；用大画布 fixture 钉最大字符/Token 级别，不允许直接 JSON stringify。
4. 初始 prompt context 先走 safe projector，再走 formatter；不维护第二份字段白名单。
5. active A 发起、执行前切到 B 时 adapter 明确 `canvas_target_stale`，不得返回 B；但测试名称与交付说明必须标为 legacy projectId guard，不能冒充 generation-safe binding。
6. production/captured snapshot 路径只读发送时快照，不读后来 active store。
7. 模型 args 中的 `projectId/leaseHandle` 被 strict input 拒绝，不能改 transport target。
8. `applyCanvasToolCall` 不再拥有 read 字段投影；read 分支移动到专用环境 adapter。
9. creation/production storyboard 特判共享 projector/formatter，canonical result 相同，presentation 可以不同。
10. `toolCallSummary` 若保留，只从 alias/contract 派生 label；若已死，直接删除分支和测试。

### GREEN 边界

- renderer adapter 仍是暂时的环境执行接缝，只负责“从已捕获的 projectId/snapshot 取 source”；字段过滤、identity、effect、schema 都不得留在 adapter。
- 不新增 main IPC，不修改 renderer bridge，不宣称同 ID reopen/generation bump 已解决。
- Pi `projectId/canvasProjectId` 缺失时，涉及 canvas capability 的请求必须 fail closed 或不暴露该工具；具体选择由现有 facade policy 的 RED 测试锁定，不能让空 ID 穿过 guard。

```bash
pnpm exec vitest run \
  electron/harness/tools/canvasDescriptors.test.ts \
  electron/ai/agentChatV2.facade.test.ts \
  src/workbench/generationCanvas/agent/canvasPromptContext.test.ts \
  src/workbench/generationCanvas/agent/gate.test.ts \
  src/workbench/generationCanvas/agent/canvasReadCapabilityAdapter.test.ts \
  src/workbench/generationCanvas/agent/applyCanvasToolCall.test.ts \
  src/workbench/generationCanvas/agent/generationCanvasAgentClient.test.ts \
  src/workbench/generationCanvas/agent/runStoryboardPlanner.test.ts
```

## Task A3：迁 MCP schema / annotation / result projection，保留一处显式 legacy authority debt

**Create / modify as proved by inventory:**

- `electron/capabilityCore/mcpCapabilityProjection.ts`
- `electron/capabilityCore/mcpCapabilityProjection.test.ts`
- `electron/capabilityCore/mcpToolCatalog.ts`
- `electron/capabilityCore/mcpProtocol.ts`
- `electron/capabilityCore/mcpArgValidation.test.ts`
- `electron/capabilityCore/mcpToolResults.ts`
- `electron/capabilityCore/mcpToolResults.test.ts`
- `electron/capabilityCore/dispatcher.ts`
- `electron/capabilityCore/core.ts`
- `electron/capabilityCore/canvasGraph.ts`
- `electron/capabilityCore/canvasGraph.test.ts`
- `electron/capabilityCore/canvasReadGatewayAdapter.ts`
- `electron/capabilityCore/canvasReadGatewayAdapter.test.ts`
- `scripts/nomi.mjs` 的现有兼容测试

### 为什么 Slice A 不接现有 lease

当前 `nomi_session_open` 仍属于 generation dispatcher，受 generation rollout flag 控制；它的 bootstrap scope 不含 `canvas:read`，headless stdio 也没有完整 authority / selection resolver 装配。当前 `requireProjectLease` 只核 projectId + scope，没有把调用连接、principal 和此刻的 UUID/generation/root 一起重验。把 `nomi_read_canvas` 直接挂上去只会制造“看起来有 lease”的假安全。

因此 Slice A 保持现有 transport 兼容，但必须把它命名并登记为 `legacy_unverified`。通用 session/lease 与可信 target 在 Slice B 一次切完整。

### RED

1. tools/list 的 name/description/`{projectId}` transport schema/readOnlyHint 来自 contract + MCP adapter；删除手写 catalog object 与 `READ_ONLY_TOOLS` 项后保持 wire compatibility。
2. JSON Schema converter 使用 installed 版本支持的 no-ref/no-`$schema` 方式；产物必须再过现有 unsupported-keyword scanner。
3. ingress 先 parse transport `{projectId}`，再把 semantic input 固定为 `{}`；projectId 不进入 canonical input。
4. `mcpToolResults` 的真实 structuredContent/text 只来自 safe result；结果 identity 不含 URL/provider/task 数据。
5. disk gateway 与 renderer gateway 对同一 source 得到字节等价 canonical result。
6. 删除 `canvasGraph.readCanvas` 和 `core.readProjectCanvas` 后，旧 dispatcher route 只剩一个具名 `legacyUnverifiedCanvasReadRoute`，内部调用 `canvasReadGatewayAdapter` + canonical projector。
7. MCP alias 与 `scripts/nomi.mjs canvas read` 的 wire 行为保持；测试名称和文档必须明确它们尚未 lease-protected。
8. 任意代码把 exposure 改成 `mcp_safe` 时 owner gate 先红；只有 Slice B 的 authority 测试齐全后才允许变更。

### GREEN

- `mcpCapabilityProjection` 只负责 transport/schema/annotation/result presentation；不拥有业务 projector。
- `canvasReadGatewayAdapter` 是合法环境 port adapter，只负责 `gateway.readDoc()`，字段选择全部交给 shared projector。
- `legacyUnverifiedCanvasReadRoute` 是 Slice A 唯一 legacy authority route；MCP 和 direct RPC 暂时共用它，不新增第二 route。
- `canvasGraph.readCanvas`、`core.readProjectCanvas`、MCP 手写 catalog object 与 `READ_ONLY_TOOLS` read 项同提交删除。
- 本任务不改 ProjectLease，不声称 `mcp_safe`，不增加测试专用 lease bypass。

验证：

```bash
pnpm exec vitest run \
  electron/capabilityCore/mcpCapabilityProjection.test.ts \
  electron/capabilityCore/mcpArgValidation.test.ts \
  electron/capabilityCore/mcpToolResults.test.ts \
  electron/capabilityCore/canvasReadGatewayAdapter.test.ts \
  electron/capabilityCore/canvasGraph.test.ts \
  electron/capabilityCore/core.test.ts \
  electron/capabilityCore/rpcServer.test.ts \
  electron/capabilityCore/nomiMcpApps.test.ts
```

`pnpm run test:mcp` 仍跑现有零额度兼容 journey，但它只证明 schema/result 行为没有退化；不得把它报告为 lease/authority 验收。

## Task A4：strict capability owner gate

**Create / modify:**

- `scripts/check-capability-owners.mjs`
- `scripts/check-capability-owners.node-test.mjs`
- `scripts/capability-owners-baseline.json`（必建）
- `package.json`

### RED fixtures

至少先观察这些假绿：

- 第二个 canonical ID/schema/effect owner；
- Pi/MCP alias collision，包括计算属性和 Map；
- 第二个 safe projector 或字段白名单 wrapper；
- 第二个 tool-name business switch；
- 已迁 alias 重新出现在 Pi descriptor literal、MCP catalog literal、`READ_ONLY_TOOLS`、`TOOL_META`；
- 未登记 owner、缺失 owner path、伪装 wrapper；
- shared 模块 import Node/Electron/React/Zustand/capabilityCore/src；
- read contract 绑定 write/paid port；
- tests/docs 合法提及不误报。

### GREEN 规则

- 复用 `check-vocabularies` 的 TypeScript AST 与历史 ratchet 方法，不做易绕过的纯 `rg` count。
- 扫描生产 TS/TSX/MTS/CTS；排除 test/docs/build。
- 对 Slice A 已迁的 contract/schema/effect/aliases/projector 使用 strict zero legacy。
- baseline 必须精确登记 `{file, symbol, role, deleteIn}`。Slice A 诚实登记两个环境执行接缝（renderer adapter、main gateway/route）和一个 authority/exposure debt（`legacy_unverified`），全部 `deleteIn: Slice B`；不能改名、搬路径、增量或用“数量不变”替换。
- gate 自身有 mutation-style Node tests；`check:gates-chain` 只证明可达，不代替 gate 行为测试。

```bash
pnpm run check:capability-owners
pnpm run check:gates-chain
```

## Task A5：文档、独立双审与本地 checkpoint

A checkpoint 只更新：

- 本计划；
- ProjectAgentHost 设计；
- `docs/plan/INDEX.md`；
- `electron/harness/README.md` 的当前 owner 说明。

不要在能力切片里重写五份历史计划；过期历史清理由单独 docs-only 切片处理。

### 独立规格审查

必须确认：

- semantic input 与 legacy transport projectId 没混；
- Pi 紧凑文本不膨胀；
- MCP 输出/annotation 已单源，但测试和文档没有把现有裸 projectId route 冒充 lease-protected；
- canonical JSON 不泄露 URL/raw/provider/task；
- Slice A 的两个环境执行接缝与一个 authority/exposure debt 都诚实可见；
- 没有把 A→B 的 projectId guard 冒充 Surface binding。

### 独立质量审查

必须确认：

- shared leaf 无环境副作用；
- registry 不是 service locator；
- JSON Schema converter 与现有 validator 兼容；
- owner gate 有真正阳性/阴性 fixture；
- 所有新文件 ≤800 行。

### 完整验证

```bash
pnpm run check:capability-owners
pnpm run check:vocabularies
pnpm run check:gates-chain
pnpm run check:filesize
pnpm run check:test-types
pnpm run check:tokens
pnpm run check:i18n
pnpm run lint:ci
pnpm run typecheck
pnpm run build
pnpm run test
pnpm run test:mcp # 只作为 Slice A wire/result 兼容证据，不是 authority 证据
pnpm exec prettier --check \
  docs/superpowers/specs/2026-08-27-project-agent-host-design.md \
  docs/superpowers/plans/2026-08-27-canvas-read-capability-spine.md
git diff --check
```

本 checkpoint 不 commit、不 push、不开 PR；保留验证证据并直接进入 Slice B，避免把短命 legacy debt 送上主线。

---

# Slice B：Verified invocation 与 SurfacePortBinding

Slice A 双审通过后立即执行，不把 legacy route 留成长期架构。

## Task B1：把 generation 专用 session 抽成通用 project-session authority

**必须触及的真实装配面：**

- `electron/capabilityCore/projectLease.ts`
- `electron/capabilityCore/generationDispatcher.ts`
- `electron/capabilityCore/mcpGenerationTools.ts`
- `electron/capabilityCore/currentProjectResolver.ts`
- `electron/capabilityCore/appIntegration.ts`
- `electron/capabilityCore/rpcServer.ts`
- `electron/capabilityCore/mcpNodeLauncher.ts`
- `electron/capabilityCore/mcpStdioServer.ts`
- `electron/capabilityCore/host.ts`
- `electron/main.ts`

实现要求：

1. `nomi_session_open` 从 generation rollout policy 抽成通用 project-session route；generation flag 关闭时仍可打开只读项目会话。
2. `canvas:read` scope 从 canonical contract 派生，客户端不能自报 scopeSet。
3. 新建 `ProjectSelectionPolicy/Resolver`，输入只能是已认证 caller、connection nonce 和 project hint。GUI 的 `current_project` 由 main 当前 binding 授权；headless 新建项目由同一 connection 的 `nomi_create_project` 返回 server-signed、connection-bound `projectSelectionHandle`；既有非当前项目只能用 Host/用户签发的 selection handle 或显式 server allowlist。项目存在本身绝不等于该连接有权选择。
4. 每条 MCP stdio 连接由 transport 生成随机 connection nonce；loopback RPC 与 direct stdio 传递同一语义。nonce、principal、caller 都不能来自 tool arguments。
5. `nomi_read_canvas` wire 在本任务才改成 `{leaseHandle: required, projectId?: hint}`。
6. gateway 前验证签名、expiry、revocation、store registration、`canvas:read` scope、project hint、connection nonce、`leasePrincipal === mcp:<authenticated client>`，以及当前 UUID/generation/canonical root。
7. 不在每次普通 read 比较当前 manifestDigest；它含 revision/updatedAt，正常保存不能错杀活 lease。manifest digest 只作选择/签发审计。
8. GUI 与 headless 使用同一个 authority factory；selection handle 同时绑定 principal、session/connection nonce 与项目身份。禁止测试直接注入现成 lease 冒充 production wiring。
9. legacy workspace manifest 缺 UUID/generation 时先做一次原子、幂等身份补齐；并发只生成一份且重启稳定。无法补齐返回 `project_identity_unavailable`，绝不能每次 bind 临时随机生成。

RED 矩阵：generation flag off、GUI current project、同连接刚创建项目、显式 selection handle、其他连接创建的项目、allowlist 外项目、旧 connection selection、无 lease、篡改、过期、撤销、缺 scope、错 project hint、错 principal、错 connection、UUID/generation/root 变化、只有 revision/updatedAt 变化。

真实零额度 journey 必须先 build 当前 HEAD，再走完整产品链：`nomi_create_project` → server-signed selection handle → `nomi_session_open` → `leaseHandle` → `nomi_read_canvas`。不能继续以裸 projectId 或 fixture 内部 authority 代替。

## Task B2：写可信调用合同 RED

定义最小、不可变的调用形状：

```ts
type VerifiedCapabilityInvocation<I, T> = {
  invocationId: string
  capability: { id: string; version: number }
  binding: {
    projectId: string
    immutableProjectUuid: string
    projectGeneration: number
  }
  target: T
  input: I
  caller: VerifiedCaller
  policyRevision: number
  actionHash: string
}
```

测试必须证明：

- request body 自报的 UUID/generation/caller/policy 全部被忽略或拒绝；
- MCP 只能从 verified lease 构造；
- Nomi renderer 只能从可信 sender 与 main-issued binding 构造；
- local RPC 只能从已验证 bearer transport policy 构造，并由 main 解析完整 binding；
- 同 ID reopen、generation bump、项目复制、revocation 全部拒绝。

MCP lease 主要防模型参数串项目、陈旧绑定和跨连接重放；它不能防已经偷到本机 capability bearer 的进程。若未来威胁模型要覆盖本地 token 攻击者，必须删除裸 CLI authority，不能把 lease 宣传成万能隔离。

## Task B3：主进程签发并验证 SurfacePortBinding

最小字段：

```ts
type SurfacePortBinding = {
  version: 1
  bindingId: string
  binding: ProjectBinding
  webContentsId: number
  processId: number
  frameRoutingId: number
  origin: string
  surfaceInstanceId: string
  portRevision: number
  nonce: string
}
```

实现要求：

- 使用独立的只读 Surface 通道，不把项目身份生命周期继续塞进同时承载写入/付费确认的 `capability.onApply`。
- main 从 workspace manifest/current project resolver 取得 UUID/generation；renderer 不能自报权威值。
- 项目水合在第一次 `await readLocalProjectAsync(...)` 前就同步 suspend/rotate 旧 binding，并让 main 的 open-project route 一并失效；不能等读盘后才清 renderer save target。
- 注册/回复同时校验 webContents、frame、origin、surfaceInstance、nonce、project generation。
- port resolver 只按冻结 invocation 选择；不读全局 current page。
- 页面切换可改变下一 turn 的可见能力，但不能扩大已排队 turn。
- port 不可用时返回 typed `renderer_required`；binding 过期返回 `project_binding_stale`；禁止偷偷退盘或读别的窗口。
- hydration 从 read 开始到 snapshot restore、event-tail replay、最后一次 ownership abandon、active publish 全部完成前都不能签发可执行 binding；renderer active ID 为空必须 fail closed，不能绕过 mismatch guard。
- 推荐生命周期 API 为 `surface.suspend → surface.commitCanvasRead → surface.release`：suspend ACK 前 main 已清 binding/openProjectId；水合失败保持 suspended；回项目库同时 release main route；普通自动保存/订阅重绑不旋转 binding。

RED 矩阵：A→B、同 ID reload、project generation bump、window reload/process replace、frame navigation、旧 reply、双窗口、hydration pending/failure、project library release。

## Task B4：main-only executor registry 与三个 transport adapter

- `CapabilityExecutorRegistry` 只在 main，按 effect 注入最小 `CanvasReadPort`。
- `canvas.read` executor 只接受 `VerifiedCapabilityInvocation`，canonical input/output 均 Zod parse。
- MCP adapter：lease → verified caller/binding → executor。
- Pi adapter：用户提交后、第一次模型目录或其他异步 `await` 前捕获 main-issued opaque Surface binding → tool call → executor → compact formatter；Phase 1 先用现役 requestId/toolCallId，不伪造尚未存在的 ProjectAgentHost thread/item 身份。
- local RPC/CLI adapter：bearer 已认证后形成 `VerifiedCaller{kind:'internal'}`，由服务端解析 ProjectBinding 再进同一 executor；若无法形成可信 caller，删除该命令而非保留宽松 bypass。有效 MCP caller 缺 lease 必须拒绝，不能落到 CLI 分支。
- resolver 可以在执行前根据 verified invocation 选择 renderer port 或 headless disk read port；renderer binding 已失效后不得在运行中偷偷降级到 disk。
- 所有 async 回包重新验证 invocation/binding 后才投影结果。

统一错误码至少包含：`project_identity_unavailable`、`project_binding_stale`、`surface_port_suspended`、`surface_port_unavailable`、`surface_port_stale`、`surface_owner_mismatch`、`capability_input_invalid`、`capability_output_invalid`、`capability_timeout`、`capability_cancelled`；MCP lease 继续复用现有 lease error code，不另造同义词。

## Task B5：原子 cutover 与删除旧 route

同一提交完成：

- Pi renderer read executor 删除；
- `applyCanvasToolCall`/storyboard 中 read 环境分支删除；
- `dispatcher case 'canvas.read'` legacy route 删除或变成只构造 verified invocation 的薄 adapter；
- `core.readProjectCanvas` 不再是第二 executor；
- CLI/internal RPC 改用 verified adapter，或明确删除不安全入口；
- owner baseline 中 Slice A 的两个环境执行接缝与一个 authority/exposure debt 全部归零。

不得保留 feature flag、旧 renderer fallback 或“出错时走老路”。允许 resolver 在执行前选择已验证的 headless disk read port；禁止 renderer binding 失效后再降级。

## Task B6：验收与 PR

结构旅程：

- Pi、MCP、local RPC 对同 fixture 得到同一 invocation target hash 和 canonical result；
- MCP scope/UUID/generation/revocation 伪造全拒；
- 两条 MCP 连接不能互相重放 lease；只有 revision/updatedAt 变化时 lease 仍有效；
- legacy manifest 身份只补齐一次且重启稳定；同 ID 删除重建、generation/root 变化使旧 lease/binding 失效；
- renderer A→B、同 ID reopen、窗口重建/process replace、hydration failure、回项目库、旧 reply 全拒；
- 注入第二 executor/alias/schema，owner gate 红；
- read executor 尝试取得 write/paid port，类型或 gate 红。

用户旅程：

- 创作页发起读取，切生成/预览后仍读取发起时的同一项目；
- A 项目读取中切 B，B 不出现气泡/结果污染；
- 重启窗口后旧 turn 不能借新窗口继续；
- MCP session lease 过期后提示重新打开项目会话，而不是返回空画布；
- Pi 紧凑上下文与 MCP 结构结果语义一致。

通过 focused、完整 gates、零额度真实 MCP journey、dev/package Electron 走查后，按独立规格→质量复核提交这一条完整垂直切片的唯一 PR。

---

## 与总计划的关系

- Slice A/B 都属于 ProjectAgentHost Phase 1，只证明单个能力脊梁，不建立聊天 Host。
- Slice B 通过后，才可以按同一模板迁下一项 read；写入能力还必须接 proposal/Undo/preconditions，不能机械复制 read executor。
- 付费能力必须直接引用 ProductionRun 与 human receipt authority，不经过 Host 造第二审批或任务账本。
- UI 保持旧外壳直到 Phase 2B 的 Host 原子 cutover；Phase 6 只改常驻位置与视觉，不再发明状态语义。

## 当前决策

方向已经由用户确认，不再等待新的产品选择。A 已完成合同/投影收口；现在补 owner gate 后立即进入 B。只有 B 能说明所有旧 owner 在同一最终提交哪里被删掉时，整条切片才进入唯一 PR。
