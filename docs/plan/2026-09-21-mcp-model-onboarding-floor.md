# 接模型的底线形状（MCP 面 · F1–F6）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 2026-09-21 · lane `lane/salvage-mcp-onboarding-20260921` · 规格正本：scratchpad `design-model-onboarding-floor.md`（§3 删除清单 / §4 密钥 / §7 三个生产者 / §11 F1–F6 / §12 验收数字）与 `mcp-onboarding-higgsfield.md`（K1–K10 真机轨迹）
> 衡量标准只有一个（用户 09-21 拍板）：**接入成功率**。证明不了它提高成功率、且删掉不丢安全的步骤一律真删，不留旧流程并行、不留 fallback。

## 1. 背后逻辑（为什么改这条路，不是改文案）

写代码的人每次都能把一家供应商接进 Nomi，靠的是四件很朴素的事：**眼前有 schema、手里有例子、改一个文件、跑一下看真话**。
今天 MCP 这条路把这四件全挡住了——schema 要等用户贴完 key 才投影、例子一份不给、提交要先有 `setupId` 且会话得在对的阶段、试跑被 env flag 关着。2026-09-21 真机实测：**14 次调用 / 6 次被拒 / 0 次真生成 / 0 个模型登记成**，四个目标模型一个都没走到「声明」那一步。

表达力不是瓶颈（已实跑证明：手写的 Higgsfield Seedance 2.5 卡过真实 `validateProviderAdapterDraft` 为 PASS，组装出的请求与官方文档逐字段吻合）。**卡死的是「怎么把这份配置交给 Nomi」那条路**：每一代重写都在换「谁来写 / 写什么」，从没换过「怎么交」。

## 2. 目标形状（三步，AI 侧）

```
① nomi_read target=onboarding_kit   无前置：schema + 撰写规范 + 2–3 份最像的内置档案样例
② nomi_model_setup submit_declaration  整份卡一次提交：无 setupId、无 key 也行；服务端校验 + 免费自检 + 登记
③ nomi_model_setup try_model        真跑一次：走手动画布同一个 runTask，不经 Run 付费门；供应商响应脱敏后原样回传
```
密钥另有一步、**任何时候都能做**，两个入口并存（用户 09-21 拍板）：Nomi 窗口录入（默认引导）与 `set_key`（用户的 AI 直填）。同一份存储、同一扇 `applyApiKeyUpsert` 门、同一套 origin 绑定。

## 3. 范围（本 lane 动哪些文件）

| 区 | 文件 | 做什么 |
|---|---|---|
| 工具面 | `electron/capabilityCore/mcpToolCatalog.ts` | 新 read target `onboarding_kit` |
| 工具面 | `electron/shared/agentCapabilities/modelOnboarding.ts`、`verbs/onboardingVerbs.ts` | 新 action `set_key` / `try_model`；`submit_declaration` 的 `setupId` 改可选；K9 示例 URL 换掉 |
| 执行层 | `electron/capabilityCore/modelOnboarding/*` | kit 生成器、无前置整份提交、set_key、try_model、K1/K3/K4 文案与分类 |
| 登记门 | `electron/catalog/declaredProviderRegistration.ts`（新） | 声明卡 → vendor/model/mapping，走 `mutateCatalog` 同一扇事务门 |
| 错误面 | `electron/capabilityCore/mcpToolErrorResults.ts` | `ERROR_HINT` 补 `feature_disabled` / `capability_input_invalid`（K5/K6） |
| 门岗 | `scripts/check-credential-origin.ts` | 按新规则显式登记：`apiKey` 只许出现在 `set_key` 这一个动作上且必须走那扇门；声明卡里的 `provider` 块只在「该连接还没有绑定」时可用 |
| 文档/界面 | `docs/integrate-with-your-agent.md`、`src/ui/onboarding/ConnectAssistantCard.tsx` + i18n | 新三步成为主线；卡片加「复制给你的 AI」按钮（zh/en） |

## 4. 不动项（边界，碰到就停下上报）

`generationProviderBootstrap.ts`、`apimartGenerationProvider.ts`、`executionContract.ts`、`moduleCatalogBootstrap.ts`、Run 路径付费门与 `productionRun/**` —— 那是主进程 lane 的「两台发动机合并」（F7 / provider 统一 / single-shot flag 归它）。
`integrationSession` 的**会话底座本身**不拆：它仍然是设置页那条「应用内 LLM 编译」路的驱动器（生产者①），本 lane 只把 MCP 这条路（生产者②）从它的顺序耦合上摘下来，共用的是**校验 / 自检 / 登记门 / 试跑**四件，不是共用一台状态机。

## 5. 删除清单（P1：真删，不留并行）

| # | 删什么 | 为什么删得掉 |
|---|---|---|
| S1 | 「schema 只在 `credentialStatus=ready` 后才投影」 | `adapterContractJsonSchema()` 是进程常量、带缓存、零用户数据；F1 直接给 |
| S2 | `submit_declaration` 必须带 `setupId` 且会话得在对的阶段 | 整份覆盖 + `ifUnchanged` 指纹替代幂等；句柄与阶段是两个要 AI 猜的隐藏状态 |
| S3 | 「提交前必须先有 key」 | 整张卡的校验（zod / 同源 / 模板根 / async-without-query）一个字节的 key 都不需要 |
| S4 | 新建连接必须先给 `suggestedBaseUrl` 才给下一步 | 卡里本来就有 `provider.baseUrl`，同一件事说两遍 |
| S5 | 已存连接上一律拒绝地址建议 + 写死「already holds a key」 | 分支只判 `vendorKey && suggestedBaseUrl`，**不判有没有 key**（K1：那条连接根本没有 key）。**有绑定仍须用户确认——那半边是安全，保留** |
| S6 | 工具描述里的 Higgsfield 示例 URL（`docs.higgsfield.ai/api-reference` 404、`platform.higgsfield.ai` 405） | 真实品牌 + 错地址 = AI 照抄 → 用户一按保存就把 key 绑到错 origin（K9，有安全后果） |
| S7 | 收据写死「Opened Nomi's credential page」而同一封里说 Nomi 没在运行 | 由 `credentialUiOpened` 决定措辞（K3） |
| S8 | `nextAction` 指向不存在的动词 `open_credentials`、把顺序错误标成 `code:"schema"` | K4；枚举外的动词名不得出现在面向 AI 的文本里 |
| S11 | `ERROR_HINT` 缺 `feature_disabled` / `capability_input_invalid` | 补（K5/K6） |

**保留不动**（与成功率无关，但删掉 = 安全塌）：免费自检；origin 绑定 + 出站守卫；validator 的同源 / 模板根白名单 / 可执行字段黑名单；`ifUnchanged` 指纹。

## 6. 密钥：两个入口，同一扇门（§4）

两条不变量，各配一条**会红**的测试：

| 不变量 | 守在哪 | 新增的会红测试 |
|---|---|---|
| ① 已存 key 要发往新域名，必须用户在 Nomi 里确认 | `catalog/credentialBinding.ts` 的 `deriveCredentialBinding / judgeCredentialDestination / assertNoCredentialBindingRewrite`；写门快照 `catalogStore.ts:353-354`；发送端 `vendor/vendorOutboundGuard.ts:126` | AI 经 `set_key` 填完 key 后，再用一张改了 `provider.baseUrl` 的卡提交 → 被拒；出站也被 `judgeCredentialDestination` 拒 |
| ② Nomi 永不回显已存 key | 会话投影解构丢弃；`publicVendor()`；`redactAdapterSecrets` / `sanitizedAdapterJson`；`redactRequestSecrets` | 种一把哨兵 key，跑完整条接入 + 一次失败的试跑，断言哨兵串**不出现**在任何工具返回、错误信息、`nextAction` 与试跑回传的供应商原文里 |

`set_key` 入参**只加 key 本身**：地址与「key 怎么放」六个字段仍一律不上 schema（`check:credential-origin` 规则 2 不放宽）。AI 直填后模型设置页该连接卡留一行可见来源提示。

## 先查别人（R5·R5.5 对齐）

> 2026-09-21 合并 ①：标题原先写成「## 7. 先查别人」，`check:prior-art` 认的是 `^##\s*先查别人`，
> 于是这一节**在机器眼里等于不存在**。内容一个字没改，只把编号从标题里挪走。

已复用 `~/Desktop/nomi-scratch-0917/batch3/onboarding-prior-art/report-full.md`（九家）与本轮媒体生成向补查（规格正本 §8），三条结论直接落进设计：

1. **Replicate / fal.ai** 每个模型自带机读 `openapi_schema`，**异步语义由平台统一定义**，调用方不声明轮询。→ 证实我们不把卡做成 OpenAPI；轮询/取产物仍由我们的 `delivery/query/statusMapping/response_mapping` 表达。
2. **Coze 插件导入**：导入后进 Debug 页**真跑一次，跑通才能 Done**。→ 这正是我们缺的第四样东西，F3 `try_model` 就是它。
3. **没有一家做「AI 直接写供应商适配器」**（九家零先例）。→ 没有先例可抄，成功率只能靠「例子 + 校验 + 真实报错」三件顶上去，不靠提示词更长。

**仓库里已有？**（2026-09-21 合并 ① 补：上面三条讲的是外面九家，门岗要的「我们自己有没有」当时没写出处，补齐）

- 声明卡的**校验器**早就在，且只有一份：`electron/providerAdapter/validator.ts:408` `validateProviderAdapterDraft`。
  本刀三个生产者（设置页编译、agent 编译请求、MCP 交卡）共用它，没有再造第二个校验面。
- 声明卡的**类型**也早就在：`electron/providerAdapter/types.ts:52` `adapterDraft?: ProviderAdapterDraft`。
  六次重写换的一直是「谁写/写什么」，从没动过「这份卡长什么样」——所以这一刀不发明格式，只改「怎么交」。
- 卡上的**样例**由真实校验器验过，不是手抄的示意：`electron/capabilityCore/modelOnboarding/kitExamples.ts:37`
  起两份（同步 / 异步轮询），`kit.test.ts` 第一条断言就是「样例过得了真实校验器」——样例随 schema 漂就当场红。

**R5.5 规范/偏差登记**（进 `docs/engineering/standard-formats.json`）：

| 格式 | 规范链接 | 我们的偏差 | 偏差理由 |
|---|---|---|---|
| `nomi-provider-declaration-card`（`onboarding_kit` 发出去、`submit_declaration` 收回来的那份） | 形状语言用 JSON Schema draft-07（https://json-schema.org/draft-07/schema），从 zod 单一真相 `adapterSuppliedContractSchema` 派生；同族外部格式：OpenAPI 3.1（https://spec.openapis.org/oas/v3.1.0） | 不是 OpenAPI：卡多出 `delivery / query / statusMapping / response_mapping / assetIngestion / selfCheck` 六格，且 `provider` 块受「有绑定就不许改」约束 | **领域约束**：OpenAPI 描述得了一次同步请求/响应，描述不了「提交→轮询→取产物」这条异步链与终态语义（fal / Replicate / Dify / Coze 四家的异步语义全是平台自己定义的，没有一家让配置去描述轮询）。扩展只放在我们自己的卡上，不往 OpenAPI 的扩展点里塞私货 |

## 8. 验收门（零额度）

同一份外部宿主脚本 `scratchpad/mcp-onboarding/host.mjs`，对 **loopback 假供应商**复跑「接入一个 Higgsfield 形状的模型」：

| 指标 | 今天 | 目标 |
|---|---|---|
| tools/call 次数 | 14 | ≤ 5 |
| 被拒次数 | 6 | ≤ 1，且必须是**卡内容**类（带 path + 合法值 + 出处 URL）；出现 `credential_origin_mismatch` / `feature_disabled` / `capability_input_invalid` 即判失败 |
| 走到试跑成功 | 否（0） | 是（1 次） |

门岗：`typecheck`、`lint:ci`、`check:tool-face`、`check:standard-formats`、`check:i18n`、`check:credential-origin`、`check:root-cause-contracts`、`check:door-map`、`check:vocabularies`，相关 vitest 与 `mcp-*` e2e。**不跑全量 gates**（全机有锁，另两条 lane 在跑）。

## 9. 回滚

一条 lane 分支、按里程碑本地 commit。每个里程碑自成一刀：
`git revert` 单个 commit 即回到上一步；工具面与登记门分在不同 commit，界面/文档在最后一刀，回滚界面不影响协议面。
最坏情况整条 lane 丢弃 = 回到 `eecc947fb`，main 上的 MCP 接入路径一个字没变。
