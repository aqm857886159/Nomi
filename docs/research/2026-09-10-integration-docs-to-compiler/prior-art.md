# 先查别人：接口文档 → 编译器 / 外部编译 / 接入包格式

> 2026-09-10。对应方案 [docs/plan/2026-09-10-integration-docs-to-compiler.md](../../plan/2026-09-10-integration-docs-to-compiler.md)。
> 三条卡点：① `nomi_integration begin` 收的 `docs` 从不流向编译器；② 没有文本模型就 `AdapterNeedsAiError`（鸡生蛋）；
> ③ `desktop-local-v1` 接入包没有对外说得清的形状。下面按四问逐条查，**结论先行：三条都用已有的东西，不新造机制**。

## ① 依赖里已有？

- **`zod-to-json-schema` 已在依赖里，且仓库里已有两处成熟用法**：`electron/capabilityCore/mcpTransportSchemaFromZod.ts:15`
  与 `electron/shared/agentCapabilities/modelVisibleJsonSchema.ts:17`（含 `zodToJsonSchema` 会把 tsc 顶到 TS2589 的
  已知规避写法，`modelVisibleJsonSchema.ts:22`）。
  **结论：用已有。** 交给驱动 Agent 的说明卡目标 schema 和 `desktop-local-v1` 的公开 JSON Schema 都从 zod 派生，
  不手抄第二份（`electron/providerAdapter/agentCompileRequest.ts` / `electron/catalog/catalogPackageFormat.ts`）。
- **抓取已有硬化实现**：`electron/hardenedFetch.ts` 的 `hardenedFetchText`（SSRF / 私网 / 大小 / 超时全在里面），
  `electron/providerAdapter/docsDiscovery.ts:155` 已在用它。**结论：用已有**，用户交进来的文档 URL 走同一条抓取，
  不为「用户给的链接」另写一条更松的抓取路径。

## ② 仓库里已有？

- **`docs` 字段本来就在，只是断在半路**：`electron/capabilityCore/mcpIntegrationTools.ts:67` 收 `docs`（≤64KB），
  落进 session config，但编译器只吃 `docsDiscovery.ts` 按 `docs.<注册域>` 猜出来的页面——**用户把文档递到手里，
  我们还在门口猜**。所以 A 不是加功能，是把已存在的输入接到已存在的消费者上。
- **「停下来问驱动方要一格东西」也已经有形状**：`integrationSession.ts:98` 的 `unresolvedFields` + `needs_input` 阶段
  就是现役机制（凭据缺失、候选缺失都走它）。**结论：用已有。** B 不新造一个「pending compile」状态机，
  复用 `needs_input` + `unresolvedFields`，只多带一份结构化交底（`compileRequest`）。
- **身份锁定的纪律已有**：内置编译器的 `PROVIDER_ADAPTER_SYSTEM_PROMPT` 与 `validateProviderAdapterDraft`
  （`electron/providerAdapter/validator.ts`）已经规定了「provider / modelKey / kind 由 Nomi 填，模型只写 modes」。
  **结论：用已有。** 外部交件走同一份提示词与同一个校验器，不为外部另立一份宽松规则。

## ③ 生态里已有？

- **MCP 的 elicitation**（<https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation>）：
  服务端向宿主要一格结构化输入的标准做法，形状是「schema + 理由」。**我们对齐它的形状（结构化交底而不是抛错），
  但不用它的通道**——理由是领域约束：elicitation 是「问人」，这里要的是「让驱动 Agent 自己去读文档写 JSON」，
  而且桌面宿主端 elicitation 支持不齐（见 memory 的实测记录）。所以交底走 propose 的返回值，是同一个思路的工具化版本。
- **结构化输出 / 约束解码**（<https://platform.openai.com/docs/guides/structured-outputs>）：
  生态的通行做法就是「把 JSON Schema 交给模型，让它按 schema 产出」。**结论：照抄这个形状**——
  `compileRequest.contractSchema` 就是给驱动 Agent 做约束解码用的，不自造一套 DSL 或模板填空。
- **接入配置的既有格式对不上**：OpenAI `GET /v1/models`
  （<https://platform.openai.com/docs/api-reference/models/list>）只是只读模型清单，没有鉴权方式、任务映射、
  请求/响应字段映射；LiteLLM 的 `model_list` YAML（<https://docs.litellm.ai/docs/proxy/configs>）描述的是
  「LiteLLM 这个网关怎么代理」而不是「一台桌面机上某个模型怎么调」。**结论：没有可对齐的标准，只能自定义**，
  但描述形状的语言用标准 draft-07（<https://json-schema.org/draft-07/schema>）并从 zod 派生（R31 的准许路径）。

## ④ TikHub 自媒体里怎么说？

本轮**没查**。理由如实写：这三条卡点是 Nomi 内部链路（MCP 会话 → 编译器 → 认证）的接线问题，自媒体侧能提供的是
「接中转站难不难用」这类需求侧信号，而需求侧信号已由 09-08 的群反馈对账给出（接模型/自建中转适配是最大主题）。
不拿「没查」冒充「查过没有」。

## 结论

| 卡点 | 用已有 / 自研 | 理由 |
|---|---|---|
| A 文档流向编译器 | 用已有（hardenedFetchText + docsDiscovery 的解析函数） | 只补一处来源裁决 `resolveProviderDocs`，抓取与解析都不新写 |
| B 外部编译 | 用已有（`needs_input` + `unresolvedFields` + 同一份提示词/校验器）+ 生态形状（schema 交给模型） | 不新造状态机、不放宽校验 |
| C 接入包格式 | 自定义形状 + 标准语言（draft-07，从 zod 派生） | 生态里没有描述「桌面机上某供应商某模型怎么调」的既有格式 |
