# 「这个模型现在能不能用」收成一个 owner（2026-09-12）

状态：🚧 进行中 · 分支 `fix/model-availability-single-owner-20260912`

## 背后逻辑（一句话）

用户接完模型，最想知道的就一句话：**「到底能不能用了？」** 这句话在 Nomi 里曾经有四个人在回答，
而他们各自算各自的——于是 2026-09-12 的真实验收里，同一台机器、同一时刻、**重启之后**，
三个地方给了两个答案：

| 你看的地方 | 它说 |
|---|---|
| 设置 → 模型 | 「1 个连接 · 2 个模型」「**2 个可使用**」 |
| 项目库首页横幅 | 「创作助手**尚未连接模型**」 |
| 创作助手模型下拉 | 「**目录里没有可用的**」 |

证据：`git show origin/docs/real-onboarding-acceptance-20260912:docs/research/2026-09-12-real-onboarding-acceptance/README.md` §6（P0-10）。

不是刷新问题，也不是某一处写错了。是**每个读者都自己写了一份判据**：

- 设置页 `resolveModelHomeStatus` 只看 `enabled` + 能力投影，从不看发布资格、从不看钥匙；
- 首页横幅走主进程 `isExecutableTextModel`，要 `published` 还要「有一条 safeStorage 记录」；
- 助手下拉走渲染层 `filterUsableAssistantTextModels`，要 `published` 还要 `vendor.hasApiKey`；
- 画布/分镜走 `modelCatalogCache` 的第三份「能跑的家」；
- Agent 面板「图片默认 / 视频默认」两行最宽——只看 `model.enabled`。

五份判据，没有一份是全的。它们**必然**漂，而且漂出来的样子对用户来说就是「这软件在骗我」。

**真正要权衡的那一件事**：把「能不能用」判到多细，以及**哪些问题不是它**。
判得太粗（只看 enabled）就是今天这个局面；判得太细、把「这一家连上了没」也一起并进来，
接入抽屉就再也说不出「已连接，但模型还在认证」这句对用户有用的话。
本方案的线画在：**「这个模型现在能不能用」只有一份判据；「这一家连上了没」是另一个问题，允许单独判。**

## 判据（唯一那一份）

`electron/shared/modelAvailability.ts` 的 `deriveModelAvailability`：

```
可用 = 供应商在且启用 → 模型启用 → 目录发布资格成立 → 这家的钥匙此刻解得开
```

顺序是**用户该先修哪个**的顺序，不是代码顺手的顺序。不可用时返回一个封闭枚举的 `reason`
（`vendor_missing` / `vendor_disabled` / `model_disabled` / `model_unpublished` /
`credential_missing` / `credential_needs_resave` / `credential_locked`），每一档都对应一个用户当场做得了的动作。

- **角色不在这里**。「它是文本还是图片」「带不带得动工具调用」「是不是只给 prompt_refine」
  是压在可用性**之上**的过滤器，永远只对已可用的模型生效，不是第二份真相。
- **钥匙惰性取**：前面几档就否掉时不去开钥匙串；`authType === "none"` 的本地家（ComfyUI）恒不探。
- 主进程侧唯一接线在 `electron/catalog/catalogModelAvailability.ts`，每家只探一次钥匙，
  且同一份 memo 同时答「能不能用」和「钥匙什么态」——两份 memo 就是两次 safeStorage 往返。
- 结论随每行模型以 `availability` 过 IPC 下发（`listModelCatalogModels`），**渲染层不重算**。

## 普查：谁在回答这个问题

（下表由 `node scripts/check-model-availability.mjs --census` 生成，它同时是门岗的登记表。）

| 读者 | 它回答的问题 | 现在读谁 |
|---|---|---|
| `electron/catalog/catalogStore.ts` | 目录投影：每行模型的 availability（渲染层全部读者的上游） | `createCatalogAvailability` |
| `electron/catalog/catalogHealth.ts` | 目录健康度里的「可执行模型」计数 | `createCatalogAvailability` |
| `electron/catalog/executableModel.ts` | 真要发请求时这条模型能不能执行 | `catalogModelAvailability` |
| `electron/catalog/modelCatalogListing.ts` | MCP list_models 对外的 usable / statusReason | `createCatalogAvailability` |
| `electron/ai/textBrainResolver.ts` | 首页横幅「创作助手连没连上模型」+ 选哪个文本大脑 | `createCatalogAvailability` |
| `electron/capabilityCore/generationDefaultModelResolver.ts` | Agent 建分镜时的图片/视频默认模型 | `createCatalogAvailability` |
| `electron/capabilityCore/moduleCatalogBootstrap.ts` | nomi_generation_plan 的语义能力注册表（钥匙那几档按层放行，见文件内注释） | `createCatalogAvailability` |
| `electron/capabilityCore/mcpStdioServer.ts` | MCP 视频模型清单 | `createCatalogAvailability` |
| `electron/capabilityCore/appIntegration.ts` | 应用内视频模型清单 | `createCatalogAvailability` |
| `electron/providerAdapter/serviceLanguageModels.ts` | 适配器可用的语言模型 | `createCatalogAvailability` |
| `src/config/modelCatalogCache.ts` | 渲染层第一道闸：画布/分镜所有选择器的选项 | `keepUsableModelRows(availability)` |
| `src/workbench/ai/assistantModelIdentity.ts` | 创作助手模型下拉（可用性 + 文本角色） | `model.availability` |
| `src/workbench/settings/defaultGenerationModelOptions.ts` | Agent 面板「图片默认 / 视频默认」两行 | `model.availability` |
| `src/workbench/generationCanvas/runner/usableVendorModel.ts` | 旧节点重解析时选哪条模型 | `model.availability` |
| `src/workbench/generationCanvas/runner/catalogTaskResolve.ts` | 节点执行前的目录重解析 | `model.availability` |
| `src/ui/onboarding/modelSettingsCatalogProjection.ts` | 设置页 chip 投影（把 availability 带进渲染层） | `row.availability` |
| `src/ui/onboarding/modelSettingsHomeState.ts` | 设置 → 模型 每行状态与「N 个可使用」 | `model.availability` |
| `src/ui/onboarding/OnboardingDrawer.tsx` | 接入抽屉「这家的模型已上线 / N 个」 | `model.availability` |
| `src/ui/onboarding/onboardingDrawerDerivations.ts` | 接入抽屉「这一类你已经覆盖了吗」 | `model.availability` |

**答的是另一个问题（「这家连上了没」，不是「这个模型能不能用」）：**

| 文件 | 为什么它可以自己判 |
|---|---|
| `electron/capabilityCore/generationProviderBootstrap.ts` | 供应商 readiness：区分「目录里有这个模型但还没填 key」与「没有这个模型」，前者要指路去填 key |
| `electron/catalog/catalogHealth.ts` | 健康度里的 enabledApiKeys 统计的是「钥匙」不是「模型」 |
| `src/ui/onboarding/onboardingDrawerConnections.ts` | 抽屉卡片分组「已连接 / 可添加」，问的是连接本身 |
| `src/workbench/settings/settingsAutomationView.ts` | 自动化设置里的连接状态灯（connected / disconnected） |
| `src/workbench/generationCanvas/nodes/decompose/useDecomposeLayers.ts` | 「元素拆解」要的是 Replicate 这家通不通，不经过任何模型行 |
| `src/workbench/generationCanvas/runner/assetUploadConsent.ts` | kie 在这里是**素材上传宿主**不是模型供应商，问的是能不能往它那儿传文件 |

## 防线

1. **类型**：`ModelCatalogModelDto.availability` 必填，渲染层拿不到「没有答案」的行。
2. **门岗** `check:model-availability`（入 `gates:contracts`）：
   普查表里每个读者都必须还在消费 owner 的结论；全仓 AST 扫「凭据词 && 启用/发布词」形状的
   布尔表达式，新增的必须登记为「另一个问题」并写明理由。规则自测见
   `scripts/check-model-availability.node-test.mjs`（阳性对照 + 合法近邻各一组）。
3. **类级回归** `src/workbench/ai/modelAvailabilityAgreement.test.ts`：
   一份目录喂给三条**现役**读取链（首页横幅 / 助手下拉 / 设置页计数 / 画布闸），断言它们**对得上**。
4. **矩阵单测** `electron/shared/modelAvailability.test.ts`：认证 × 钥匙 × 启停 × 角色的笛卡尔积。
5. **端到端走查** `tests/ux/model-availability-agreement.walk.mjs`：真 Electron、真设置页，
   「没钥匙 → MCP 又接进来一行没走完认证的 → 真人在设置卡里粘 key → 冷重启 → 断开」
   五个状态走一圈，三处每一步都必须一起翻（41 条判据）。
   钥匙**由真人路径粘进去**（设置 → 更多已适配平台 → 魔搭社区 → 保存验证），不是往 bridge 里灌：
   渲染层的写入是配置不是发布（`rendererCatalogMutation.ts` 三个 sanitize 一律按下 `enabled`），
   自己捏的供应商从第一步起就是 `vendor_disabled`，那样「没钥匙 ⇒ 0 个可用」是**对的答案配错的理由**。
   可证伪性已验：把 `resolveModelHomeStatus` 改回不看 `availability`（修复前的形状）后，
   「填了钥匙」那一步当场红（设置页 11 / 目录 10）。

## 先查别人

- **真实验收报告**（本方案的事实来源）：`origin/docs/real-onboarding-acceptance-20260912`
  的 `docs/research/2026-09-12-real-onboarding-acceptance/README.md` §6 P0-10，
  含三处 dump 行号与截图名；归属写的是 `feat/model-onboarding-two-paths-20260911` ×
  `feat/mcp-onboarding-tool-face-20260911`（2026-09-12 查）。
- **仓库里已有（用它）**：发布资格的唯一 owner `electron/shared/modelPublication.ts:119`
  `derivePublishedExecution`（认证域 / legacy mapping / 恢复前代三条路都在里面）。
  本方案**不重写**它，只是把它和「钥匙」「启停」组合进一个判据——重写它就是第二份发布资格。
- **仓库里已有（用它）**：钥匙三态的中立契约单一 owner
  `electron/shared/contracts/apiKeyStatus.ts:13` `API_KEY_DECRYPT_STATUSES`。
  第一版的 `ModelCredentialStatus` 是它的复制品，被 `check:vocabularies` 当场抓到并删掉了。
- **仓库里已有（用它）**：渲染层那道硬闸 `src/config/modelCatalogCache.ts` —— 2026-09-06 用户拍板
  「没接入的供应商，它的模型不显示」，闸只有一道、开在 catalog 派生层
  （`docs/fixes/2026-09-06-vendor-preference-picker.root-cause.json` 的 generality_proof）。
  本方案保留这道闸的**位置**，只把它的**判据**换成主进程算好的 `availability`。
- **仓库里已有（教训）**：`docs/plan/2026-06-08-vendor-switch-archetype-migration.md:25`
  写着 `vendorIsUsable(v) = enabled && (authType==='none' || hasApiKey)` ——
  同一条不变量的第三份写法，2026-06-08 那次「拔了 key 仍发请求」就是它的副本漂开。本轮已删除。
- **仓库里已有（划界）**：写入边界 `electron/catalog/credentialPublication.ts:16`
  `depublishVendorForDisabledCredential` 保证「凭据停用 ⇒ vendor 停用」。
  因此可用性判据不必再单独判 `apiKey.enabled`——但 `apiKeyDecryptStatus` 仍然 fail-closed 地判它
  （`electron/catalog/secrets.ts` 的 `credentialRecordCounts`），登记是备忘录，防线要真响（R28）。
- **依赖里没有**：本仓零第三方目录/能力注册表依赖，`@xyflow/react` 只渲染节点，
  没有「这个能力现在可不可用」的现成语义（`node_modules/@xyflow/system` 的 `NodeBase.data` 是纯应用数据）。
  故判据必须自研，但只许有一份。
- **生态里已有（照做）**：把「能不能用」做成**带原因的封闭枚举**而不是布尔，
  是 Kubernetes Conditions（`type/status/reason`，https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/ 之外的
  API 约定 https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md#typical-status-properties ，2026-09-12 查）
  的通行结构：一个布尔逼着每个读者自己去猜「那我该让用户干什么」，而那正是五份判据长出来的起点。
- **TikHub 自媒体一格本轮没查成**：这是纯内部一致性问题，没有可引用的创作者一手经验，不假装查过。

## 与 `feat/model-onboarding-two-paths-20260911` 的重叠

那条分支（`/Users/aoqimin/Desktop/Nomi-onboarding-impl`，95 文件 / +2475 −2929）在重做认证自检与接入两条路。
文件级重叠与本方案的处置：

| 文件 | 那边在做什么 | 本方案的处置 |
|---|---|---|
| `electron/shared/modelPublication.ts` | 改发布资格的派生（+57） | **不碰**。本方案只调用 `derivePublishedExecution`，它改它的，判据组合不变 |
| `electron/catalog/modelCatalogListing.test.ts` | 自检结果投影 | 本方案改的是 `usable` / `statusReason` 与钥匙记忆化，合并时以那边的 listing 形状为准再挂回 `availability` |
| `src/ui/onboarding/ModelSettingsHome.tsx` | 页面结构（+37） | 本方案只改页头那句「N 个可使用」的口径（改为与每行 `summary.ready` 同源），冲突面是一行 |
| `src/ui/onboarding/ModelChipGroups.tsx` / `OnboardingDrawer.tsx` | 小改 | 本方案只加 `availability` 字段与两处读它，按那边的版本重挂 |
| `electron/catalog/executableModel.test.ts` | 自检 | 本方案改的是执行前判据，合并时以那边的夹具为准 |
| `scripts/vocabularies-baseline.json` | 词表基线 | 两边都动；合并后重跑 `check:vocabularies` 取并集 |

**没有重叠**的核心面：`electron/shared/modelAvailability.ts`、`electron/catalog/catalogModelAvailability.ts`、
`src/ui/onboarding/modelSettingsHomeState.ts`（设置页计数的真正 owner）、`src/config/modelCatalogCache.ts`、
`src/workbench/ai/assistantModelIdentity.ts`、`src/workbench/settings/defaultGenerationModelOptions.ts`。

## 不动的东西

- 发布资格怎么算（`modelPublication.ts`）——那是另一条不变量，另有 owner。
- 「这一家连上了没」的那几处判断（接入抽屉分组、自动适配、自动化设置状态灯、
  素材上传宿主、元素拆解的 Replicate 探测）——它们答的是另一个问题，已在门岗里逐条登记理由。
- `nomi_generation_plan` 的语义能力注册表**刻意放行钥匙那几档**：那一层答的是「目录声明了什么能力」，
  「此刻跑不跑得动」由上一层 `generationProviderBootstrap` 的 readiness 答，
  它必须能区分「有这个模型但还没填 key」和「根本没有这个模型」。

## 验收门

- `pnpm run gates`（contracts + unit + build）全绿，含新门岗 `check:model-availability`。
- `node tests/ux/model-availability-agreement.walk.mjs` 通过（需要先 `pnpm run build`）。
- 根因合同 `docs/fixes/2026-09-12-model-availability-single-owner.root-cause.json`（schema-v3，recurring）。
