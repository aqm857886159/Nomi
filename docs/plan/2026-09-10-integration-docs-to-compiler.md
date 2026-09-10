# 让接口文档真正到达编译器（A/B/C 三条卡点）

> 2026-09-10 · 分支 `fix/integration-docs-to-compiler-20260910` · 状态：已实施
> 用户诉求（原话意译）：**让 LLM 照着接口文档写配置、配置是独立文件、Codex 也能来适配。**

## 底层逻辑（这三条治的是同一个摩擦）

一个人想接一家新供应商（杂牌中转、自建网关、公司内网端点），他手上**已经有接口文档**。今天的路是：
他把文档递进来 → 我们**不看**，转身去猜 `docs.<他家域名>` 有没有公开文档站 → 猜不到就说「文档没抓到」；
就算抓到了，读文档写配置这一步借的是**他已经接好的文本模型**——而他正在接的就是第一个模型，
于是「想接模型，先接一个模型」。最后就算接成了，这份配置也没有一个说得清的文件形状能给第二个人用。

三条卡点是同一句话的三段：**用户/Agent 已经把知识递到手里了，我们的链路接不住。**

## 范围

| | 改什么 | 不改什么 |
|---|---|---|
| A | `docs` 从 session config 流到编译器，作为 `discoverProviderDocs` 的**显式首选源**（正文直接用；每行一个 URL 的列表走 `hardenedFetchText`） | 抓取硬化、HTML 正文解析、按域名猜文档站的兜底逻辑一行不改；**文本模型仍然不编译**（保持 2026-08-12 的裁决） |
| B | 没有可用文本模型时**不再抛 `AdapterNeedsAiError`**，改为把「待编译输入」（目标 schema + 撰写规则 + 锁死的身份）作为结构化产物停在 `needs_input`，由驱动 Agent 回填 `proposal.adapterDraft` | 校验、确认、花钱闸、真实认证一格不放宽：外部交件同样过 `validateProviderAdapterDraft`，同样走完整认证 |
| C | `desktop-local-v1` 导入/导出出一份**从 zod 派生**的 JSON Schema，登记进 `check:standard-formats`，官方样例当夹具、读取器测试必须读得过它 | **不做 UI**（导出/导入按钮的形态属于设计问题，另排）；条目内部形状仍以 `electron/catalog/types.ts` 为唯一真相 |

不动（另有工人在改）：`electron/catalog/seedBuiltins.ts`、`rendererCatalogMutation.ts`、`validateCandidateCredential.ts`、`directKeyCredential.ts`。

## 先查别人

完整报告：[docs/research/2026-09-10-integration-docs-to-compiler/prior-art.md](../research/2026-09-10-integration-docs-to-compiler/prior-art.md)。摘要（每条带出处）：

- **依赖里已有**：`zod-to-json-schema` 已在依赖中，仓库里已有两处成熟用法与 TS2589 规避写法——`electron/capabilityCore/mcpTransportSchemaFromZod.ts:15`、`electron/shared/agentCapabilities/modelVisibleJsonSchema.ts:22`。**用已有**：B 的目标 schema 与 C 的公开 schema 都从 zod 派生，不手抄第二份。
- **依赖里已有（抓取）**：`electron/providerAdapter/docsDiscovery.ts:155` 已经在用 `hardenedFetchText`（SSRF/私网/大小/超时都在里面）。**用已有**：用户交进来的文档 URL 走同一条抓取，不为「用户给的链接」另开一条更松的路。
- **仓库里已有（停下来要一格东西）**：`electron/integrationCertification/integrationSession.ts:98` 的 `unresolvedFields` + `needs_input` 是现役机制（凭据缺失、候选缺失都走它）。**用已有**：B 不新造状态机，只多带一份结构化交底。
- **仓库里已有（断链本体）**：`electron/capabilityCore/mcpIntegrationTools.ts:67` 一直收 `docs`（≤64KB），但它从未流向编译器。A 因此不是新功能，是接线。
- **生态里已有**：MCP elicitation 的「schema + 理由」形状（<https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation>）与结构化输出/约束解码的通行做法（<https://platform.openai.com/docs/guides/structured-outputs>）。**对齐形状、不用它的通道**（理由：elicitation 是「问人」，这里是「让驱动 Agent 自己读文档写 JSON」）。
- **生态里没有可对齐的**：OpenAI `GET /v1/models`（<https://platform.openai.com/docs/api-reference/models/list>）是只读清单，LiteLLM `model_list`（<https://docs.litellm.ai/docs/proxy/configs>）描述的是网关自身配置；两者都没有「create/query/result 三段 HTTP 声明 + response_mapping」这一格。**只能自定义**，但描述语言用标准 draft-07（<https://json-schema.org/draft-07/schema>）。

## 实现落点

- A：`electron/providerAdapter/providedDocs.ts`（新，来源裁决单点）；`service.ts` 的 `discover` 依赖签名多一格 `providedDocs`；`store.ts` 加一张**边表** `inputs`（文档不进 run DTO，避免每次列 run 抬着 64KB 走）。
- B：`electron/providerAdapter/agentCompileRequest.ts`（新，目标 schema + 交件→说明卡）；`electron/integrationCertification/integrationAdapterContract.ts`（新，propose 阶段「谁来编译」的裁决）；`serviceLanguageModels.ts` 抽出 `hasCompilerLanguageModel`（判据单点，propose 与真跑共用）；MCP `nomi_integration` 的 `proposal.adapterDraft`。
- C：`electron/catalog/catalogPackageFormat.ts`（新，zod 契约 + 导出侧包构造）；`docs/engineering/formats/desktop-local-v1.schema.json`（派生产物）；`tests/fixtures/standard-formats/model-catalog-package/desktop-local-v1.json`（官方样例夹具）；登记进 `docs/engineering/standard-formats.json`。

## 回滚

三条互不依赖，按 commit 主题分开：A（文档来源）/ B（外部编译）/ C（接入包格式）。回滚任一条不影响另外两条——
A 回滚后仍按域名猜文档站；B 回滚后恢复 `AdapterNeedsAiError`；C 回滚后导入退回无信封校验。

## 验收门

- 单测：`electron/providerAdapter/providedDocs.test.ts`（A 五条）、`service.test.ts` 三条（A 一条 + B 两条）、
  `integrationSession.test.ts` 五条（B）、`mcpIntegrationTools.test.ts` 一条（B 的传输层）、`catalogPackageFormat.test.ts` 六条（C）。
- 门岗：`pnpm run gates` 全绿，其中 `check:standard-formats` 必须认下 C 的登记、`check:filesize` 不许靠放宽白名单过。
- **不做 UI，所以不出样张、不走 R13 走查**；真实供应商闭环（拿真实文档让 Codex 编一份说明卡并认证）属于下一步，本轮不宣称已验。
