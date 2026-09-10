# 先查别人 · 外部 AI 经 MCP 接模型的六条缺陷

日期：2026-09-11 · 服务于 [docs/plan/2026-09-11-mcp-onboarding-defects.md](../../plan/2026-09-11-mcp-onboarding-defects.md)

## 0. 一次真实测量（本题的起点，不是别人做过什么，而是我们做过什么）

`exp/mcp-onboard-deepseek-20260910` 分支的 `docs/research/2026-09-10-mcp-onboard-experiment/baseline.md`：
真实 Codex CLI 0.153.4 + 真实 DeepSeek key，9 个 agent 回合 / 58 次 `nomi_*` 调用 /
入参一次写对 36/58 = 62% / 9 回合里 1 回合完全成功 / 人工引导 5 次 / 窗口点确认 4 次（3 次白点）。

## 1. 依赖里已有？

- `node_modules/@modelcontextprotocol/sdk` 只提供协议传输与 schema 承载，**不提供**「多步接入会话的乐观锁/人证/枚举」这类领域能力。本题六条全在领域层，依赖里没有可直接用的东西。
- JSON Schema 校验器（`ajv` 一类）：仓库对外 schema 由 `mcpToolCatalog.ts` 手写字面量，本次不引新校验器；R30 夹具里用最小自写校验器只校 `required`/`enum`/`type`，避免为一条断言增加运行时依赖。

## 2. 仓库里已有？

| 已有的 | 位置 | 本题怎么用 |
|---|---|---|
| 不透明短 id ↔ 签名 token 的服务端映射 | `electron/capabilityCore/approvalReceipt.ts:521`（`resolveReceiptToken`）、`:330`（`resolveChallengeToken`） | 缺陷 3 照抄这个姿势，不发明第二种句柄机制 |
| 错误码 → 中英人话 + 恢复动作登记表 | `electron/capabilityCore/mcpToolErrorResults.ts:7` `ERROR_HINT`、`:57` `POLICY_CODES` | 缺陷 5 的六个新码并进这张表 |
| 生命周期词表单一 owner + 机器门岗 | `electron/shared/integrationContract.ts:4`、`scripts/check-vocabularies.mjs` | 缺陷 1 的两个新档进同一个 tuple，门岗会拦第二份定义 |
| 全局背景提示（带下一步动作） | `src/ui/notificationPolicy.ts:22` `notify({level:'background'})`，现役用法 `src/workbench/capability/mcpHostSurfaceOps.ts:19` | 缺陷 1 的 GUI 可见提示复用它，不新造角标系统 |
| 接入 handoff 的持久队列与订阅 | `electron/integrationCertification/handoffQueue.ts:11`、`electron/preload.ts:531` | 同上：提示的数据源已经在跑，只是以前只有设置页在听 |

## 3. 生态里已有？

- **MCP 规范 · 工具错误**：<https://modelcontextprotocol.io/specification/2025-06-18/server/tools> §Error Handling —— 协议错误走 JSON-RPC `error`（示例码 `-32602`），工具执行错误走结果里的 `isError: true`。我们已在 `electron/capabilityCore/mcpProtocol.ts:592` 走 `isError` 分支，本次不改形状，只让码分得开。
- **MCP 规范 · inputSchema**：同页 §Data Types，`inputSchema` 就是 JSON Schema，条件必填的标准写法是 `allOf` + `if/then`（<https://json-schema.org/draft/2020-12/json-schema-core#name-if>）。**实施时被仓库自己的门岗推翻**：`scripts/check-model-schema.ts` 证明 Anthropic 适配器会丢掉根 allOf、Google 的 OpenAPI 3.0.3 路径不认 const，模型会看到一个没有 schema 的工具——那正是本题要根除的同一族。结论改成：schema 保持扁平，必填清单写进 `action` 的描述（每家适配器都原样透传），并由工具层一次说全。
- **MCP 规范 · elicitation**：<https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation> —— 2025-06-18 版只有 form 模式，没有 URL 模式；URL 模式是 2025-11-25 才有的（我们按它实现在 `electron/integrationCertification/credentialElicitation.ts:1`）。宿主不支持时降级到人工填 key **符合规范意图**（规范明说服务端不得用 elicitation 索取敏感信息），保留。
- **同类产品的两段计时**：GitHub device flow 把「人去授权」（user code，15 分钟）与「程序换 token」分成两段独立节奏：<https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow>。这正是缺陷 2 的解法形状。
- **同类产品的幂等**：Stripe 的 idempotency key 语义是「同一个 key 重放返回同一个结果」，而不是「重放作废上一次」：<https://docs.stripe.com/api/idempotent_requests>。我们的 `confirm` 现在是后者，所以 agent 每回合再确认一次就把人的点击洗掉了。

## 4. TikHub 自媒体里怎么说？

本轮**没查成**（未起调研 agent）。如实记录，不假装查过；本题判据来自一次真实测量 + 官方规范 + 仓库现状。

## 5. 结论

**全部用已有的。** 六条改动没有一条需要新机制：短句柄抄收据链、错误码进既有表、新 stage 进既有 tuple、
GUI 提示用既有 `notify`、两段 TTL 抄 device flow 的形状。新增的只有「把真话写进模型真能收到的那一份契约」
这件事本身——而「模型真能收到哪一份」这个问题，答案来自仓库自己的 `check:model-schema` 门岗，
不是来自规范文本。
