# 2026-09-11 · 外部 AI 经 MCP 接模型：实测实锤的六条产品缺陷

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：已实施（分支 `fix/mcp-onboarding-defects-20260911`，叠在 `fix/integration-docs-to-compiler-20260910` 上）

## 背景：一次真实测量，不是猜

2026-09-10 用真实 Codex CLI 0.153.4 挂 Nomi MCP 接 DeepSeek，跑了 9 个 agent 回合、58 次 `nomi_*` 调用。
测出来的数字是：**入参一次写对率 62%（36/58）、9 个回合里只有 1 个完全成功**，而那 1 个还是把每步入参
写死喂给模型之后才跑通的。22 次失败调用里 9 次是「schema 的 required 撒谎」、6 次是「revision 语义分不清」。
基线报告：`exp/mcp-onboard-deepseek-20260910` 分支的 `docs/research/2026-09-10-mcp-onboard-experiment/baseline.md`
（本轮摘要另存 [docs/research/2026-09-11-mcp-onboarding-defects/prior-art.md](../research/2026-09-11-mcp-onboarding-defects/prior-art.md)）。

一句话说清这次要解决的真实摩擦：**我们的接入面是照着「调用方是一段代码」设计的，
但真正的调用方是一个模型**——它不会逐字复述 1271 个字符，不会从一句英文里读出四种含义，
也不会知道 schema 上写着可选的字段其实必填。**它做错的每一件事，都是我们的接口教它做的。**

用户要权衡的核心：这不是「再加几个工具」，而是**把已经存在的接入面从「代码可用」修到「模型可用」**——
六处改动全部落在既有边界上（词表、错误码、TTL、句柄、schema、会话查找），不新增任何一条并行路径。

## 先查别人

- **仓库里已有（决定性 · 短句柄该长什么样）** `electron/capabilityCore/approvalReceipt.ts:521` `resolveReceiptToken(receiptId)` —— 签名 token 留在主进程、只把不透明短 id 交给模型，这套「id ↔ token 服务端映射」在收据这条链上已经跑了很久。项目选择句柄现在把整个 1271 字符签名 blob 丢给模型逐字复述（`electron/capabilityCore/projectLease.ts:247` 的 `issueSelectionHandle` 返回 `encode(handle)`），是同一个问题的未修版本。**结论：用已有的姿势，不发明第二种。**
- **仓库里已有（错误码表）** `electron/capabilityCore/mcpToolErrorResults.ts:7` 的 `ERROR_HINT` + `POLICY_CODES` 已经是「码 → 中英人话 + 恢复动作」的登记表，`lease_invalid` 一族走的就是它。`Integration session revision is stale` 这句裸英文 Error 从来没进过这张表，于是一个宿主一次会话收到三种语言、两种结构的错误。**结论：把接入面的错误并进这张既有表，不另起一张。**
- **生态里已有（规范 · 错误怎么报）** MCP 规范把错误分成协议错误（JSON-RPC `-32602`）与工具执行错误（结果里 `isError: true` + 文本内容）两类：<https://modelcontextprotocol.io/specification/2025-06-18/server/tools> §Error Handling。我们已经走 `isError` 分支（`electron/capabilityCore/mcpProtocol.ts:592`），本次只补「码要能分得开」，不改传输形状。
- **生态里已有（规范 · 条件必填怎么写），但这次不能用** 同一页 §Data Types 规定 `inputSchema` 就是标准 JSON Schema，条件必填的标准写法是 `allOf` + `if/then`（<https://json-schema.org/draft/2020-12/json-schema-core#name-if>）。**第一版就是这么写的，然后被仓库自己的 `check:model-schema` 门岗打回**（`scripts/check-model-schema.ts`）：Anthropic 适配器会静默丢掉根上的 allOf、Google 的 OpenAPI 3.0.3 路径不认 const——模型会看到一个**没有 schema 的工具**。那正是本次要根除的同一族缺陷（广播出去的东西模型没真收到），所以最终选扁平 schema + 描述里说真话 + 运行时一次说全。规范上的「标准写法」不等于「到得了模型」，这一条值得记住。
- **生态里已有（规范 · 凭据交接）** URL 模式 elicitation 是规范 2025-11-25 为「不能进模型上下文的敏感值」定的路（我们已按它实现，见 `electron/integrationCertification/credentialElicitation.ts:1`）；2025-06-18 版还没有 URL 模式：<https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation>。**结论：宿主不支持时降级到人工填 key 是对的，保留；只把降级提示改成「你等着」而不是让 agent 反复 confirm。**
- **同类产品的接入流程** GitHub Apps 的 device flow 把「人去授权」和「程序拿凭证」拆成两段各自计时：user code 有效期 15 分钟，而拿到 token 后的轮询另有节奏（<https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow>）。对上我们第 2 条：**挑战有效期（人要多久发现并点）和收据有效期（agent 点完后多久能花掉）是两拨人的时间，不能是同一段**。
- **TikHub 自媒体** —— 本轮**没查成**（未起调研 agent），如实记录，不假装查过。本题判据来自一次真实测量 + 规范 + 仓库现状，不受影响。

## 六条缺陷与修法

| # | 实测症状 | 类根因（缺的不变量） | 修在哪 |
|---|---|---|---|
| 1 | 花钱确认死循环：GUI 无提示、agent 分不清「等人点」和「人点完了」、再 confirm 会作废上一次点击 | 生命周期词表把「等人」和「人已批」压成同一个 `needs_spend_confirmation`；`confirm` 在已有未消费挑战时不是幂等 | `electron/shared/integrationContract.ts` 加 `awaiting_human_confirmation` / `human_confirmed` 两档（单一 owner）；`requestConfirmation` 在这两档下**幂等返回当前挑战**，不再重签；渲染层全局提示复用 `notify(level:'background')` |
| 2 | 5 分钟窗口从 agent 调 confirm 起算，收据 `expiresAt` 直接继承挑战 | 一段 TTL 同时承担「人要多久发现」和「agent 多久花掉」两件事 | `approvalReceipt.ts` 的 `mintReceipt` 给收据独立 TTL，从**铸造时刻**（＝人点下去那一刻）起算；数值复用既有 `defaultTtlMs`，不新增魔法数 |
| 3 | 项目句柄要模型逐字复述 1271 字符（相似度 0.692 死锁） | 把「服务端签名的不可读 blob」当成「模型要背下来的入参」 | `projectLease.ts` 维持签名 token 在主进程，对外只发 `handleId`；`projectSessionAuthority.open` 只收短 id（无并行的长 token 入口） |
| 4 | schema `required: ['action']` 撒谎，三个回合各撞一次，22 次失败里 9 次是它 | 广告出去的必填集与实现的必填集是两份真相 | `mcpIntegrationTools.ts` 建 `INTEGRATION_REQUIRED_BY_ACTION` 单一表，对外的 `action` 描述与运行时的一次性缺字段聚合校验**都从它派生**；schema 保持扁平（条件 schema 会被适配器丢掉，见「先查别人」） |
| 5 | 一句 `revision is stale` 表示四件事 | 会话写入前置条件没有错误码词表 | `integrationContract.ts` 定 `INTEGRATION_ERROR_CODES` + `IntegrationRequestError`；并进 `mcpToolErrorResults` 的既有中英表，带 `currentRevision` |
| 6 | 会话不可枚举；`begin` 传 sessionId 仍新建；同 baseUrl 新会话报 `credentialStatus: missing` | 没有「回到上一次接入」的读路径；`begin` 只会造不会认 | `nomi_read target=integration` 不带 sessionId 时列出本 owner 的会话；`begin` 命中 sessionId / 同 kind+baseUrl 的未完成会话时复用；已存 key 的 baseUrl 直接进 `draft` |

## 不动项

- 不改 `electron/productionRun/**`（另两条分支在改）。
- 不改付费两相结构（confirm → start 仍是两跳，收据仍单次消费、仍由可信 UI 铸造）。
- 不改 URL 模式 elicitation 的凭据路径；key 仍不进模型上下文、不进 MCP 参数。
- 不新增 MCP 工具、不新增 IPC 通道。

## 回滚

回滚本班提交即可。落盘会话文件 schema 版本不变：老会话的 `needs_spend_confirmation` 仍是合法 stage，
读出来照旧；新两档只有本版本写入。收据 TTL 变长不影响已签发收据的校验路径（仍验签名+注册+未消费）。

## 验收门

1. `pnpm run gates` 全绿（含 `check:mcp-payload` 棘轮、`check:model-schema` 棘轮、`check:vocabularies` 词表 owner、`check:filesize` 巨壳棘轮、`check:root-cause-contracts`、`check:standard-formats`）。
   为守住 `check:filesize`，本班把 `integrationSession.ts` 里三块与状态机无关的纯逻辑拆出去：
   提案入库前校验 → `integrationProposalValidation.ts`，落盘记录深校验与失败原因码 →
   `integrationSessionRecord.ts`，花费确认的对外投影 → `integrationSpendGate.ts`。
2. 六条各自的单测（见 `docs/fixes/2026-09-11-mcp-onboarding-defects.root-cause.json` 的 `regression_tests`）。
3. R30 零额度 loopback 夹具 `electron/capabilityCore/mcpOnboardingLoopback.test.ts`：按实验 Run 9 的 15 步顺序驱动真实 dispatcher，断言
   **入参一次写对率 ≥ 90%（按对外 schema 校验，不是按实现）** 与 **回合成功**（终态 `completed`）。
