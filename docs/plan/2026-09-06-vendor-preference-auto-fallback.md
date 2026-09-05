# 供应商偏好与自动切换方案（S-01/S-02）

> 日期：2026-09-06 · 状态：🚧 实施中 · 第一阶段先行
> 来源：`docs/plan/2026-09-05-gpt-discussion-consolidation.md` §1、现役代码盘点与 2026-09-06 Context7/官方文档检索。

## 1. 先说用户要解决的摩擦（D6）

点开模型框，会看到一大堆模型；其中很多其实是同一个模型，只是后面标了不同供应商。有人希望把某一家供应商放前面，没配置的放后面。第一阶段先把选择框排序、去重做好：同一个模型折成一行，供应商作为行尾 chip；选行默认用偏好的那家，临时点另一家 chip 就只对这次使用。未配置的供应商沉到底部并明确提示去接入。

自动切换可以减少 429/暂时不可用造成的中断，但它涉及花费和用户控制，放到第二阶段。

## 2. 现状与边界证据

- `electron/ai/textBrainResolver.ts:33-36` 已有 `TextModelPreference { modelKey?, vendorKey? }`；`selectTextModelCandidates` 在 `:115-167` 先按精确 `(vendorKey, modelKey)`，否则按模型能力与稳定排序；`chooseTextModel` 在 `:170-205` 负责凭据解密和失败。
- 同文件 `:108-113` 明确防止用户选定供应商后静默换同名模型；`:217-220` 的 `resolveTextBrainKeys` 是无密钥的只读探测。
- `electron/settings/generationModelDefaultsContract.ts:7-13` 已钉死双段身份、缺席即自动选择、设置层不检查目录存亡；`:29-37` 的 `GenerationModelDefault`/`byTaskKind` 可作为持久化形状参考。
- `src/config/modelOptionMappers.ts:37-70` 说明同名 `modelKey` 在不同供应商下不唯一；`src/config/modelArchetypes/index.test.ts:10-35` 钉死档案解析供应商无关，`vendorKey` 只作特化。
- 因此本轨不新增“供应商卡片偏好”第二套语义，也不把 `vendorKey` 从模型身份中抹掉；偏好主键是能力槽下的模型身份，供应商是该身份的候选填槽者。

## 3. R20 build-vs-buy 闸

### 三问一：这是通用问题吗？

是。跨多个 API 端点按顺序尝试、区分可重试/不可重试错误、限制回退深度、记录最终命中者，是任何多供应商客户端都会遇到的可靠性问题；它不是 Nomi 的创作护城河。Nomi 的差异在“哪个创作能力槽适合当前任务”和可审计的用户控制，而不是再造一个通用路由器。

### 三问二：同类产品怎么做？（Context7 + web 实查）

| 现役同类 | 观察到的做法 | 对 Nomi 的借鉴 |
|---|---|---|
| OpenRouter | provider `order` 设明确顺序，`allow_fallbacks` 控制是否继续；模型 `models` 数组按优先级回退，并区分 provider 层与 model 层。[官方 provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)、[model fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks)；Context7 `/openrouterteam/docs` 同样给出 `order`/`allow_fallbacks`。 | 把“顺序”和“是否允许回退”做成显式策略；不把跨模型切换伪装成同一模型的供应商切换。 |
| LiteLLM Router | Router 提供 retry/fallback、`allowed_fails`、`cooldown_time`、`max_fallbacks`，并按异常类型决定是否重试；Context7 `/berriai/litellm` 的 Router 文档展示了尝试集合与深度上限；[官方首页](https://docs.litellm.ai/) 明确 Router 的多部署回退。 | 需要有限尝试次数、冷却/熔断与错误分类，避免一次请求无限重试或循环回到同一目标。 |
| Portkey AI Gateway | 用嵌套 `fallback`/`loadbalance` targets，并可按 429/5xx 配置 retry；Context7 `/portkey-ai/gateway` 的配置示例展示 fallback 与 load balance 分层；[Gateway 文档仓库](https://github.com/Portkey-AI/gateway)。 | 将“候选顺序”和“负载均衡”分开。本期只做用户可理解的顺序回退，不引入随机负载均衡。 |

### 三问三：这是护城河吗？

通用回退不是护城河，且错误的自动切换会碰到用户信任和花费。结论：**买/借鉴标准路由语义，Nomi 自研最薄的能力槽适配、费用/权限闸和可解释收据**。不引入 OpenRouter/LiteLLM/Portkey 运行时作为 Nomi 的隐式第二执行器；它们只作契约和测试参考，保持 Pi runtime 与现有 catalog 为唯一执行权威。

## 4. 分阶段范围（R3）

### 阶段一：选择框排序与去重（本次）

| 用户看到什么 | 代价 |
|---|---|
| 同一 `modelKey`/canonical 身份只显示一行；行尾显示供应商 chip，偏好供应商排第一并高亮；未配置供应商沉到「未配置」分组。设置 → 模型里可调整已配置供应商顺序。 | 需要统一所有模型入口的 view-model、偏好持久化和真实旅程覆盖。 |

### 阶段二：有界自动切换（后续）

| 用户看到什么 | 代价 |
|---|---|
| 429、超时等可重试错误按明确顺序尝试下一家，并显示切换原因；跨模型或可能改变费用时先确认。 | 需要错误分类、尝试上限、收据和花费/权限闸；本阶段不改变运行时回退语义。 |

## 5. 阶段二设计留档（后续，不在本次实现）

保留原方案中的能力槽候选链、可重试错误分类、`maxAttempts`、receipt 与跨模型确认设计，作为后续输入；本阶段只实现选择框的排序、去重、未配置分组和设置持久化。

## 6. 范围与不动项

**本轨范围（阶段一）**：偏好合同、读写 IPC、所有模型选择入口共用的排序/去重 view-model、未配置分组与设置页排序控件、i18n、实验室截图登记和真实 Electron 旅程。

**不动项**：不改供应商 HTTP mapping、模型档案能力事实、Pi runtime 权威、生成任务默认模型 `byTaskKind` 的语义；不接第三方网关运行时；本次不做自动重试、错误分类、跨能力降级、Host receipt 或自动切换。

## 7. 分层与文件拆分（R9，单文件 ≤800 行）

| 层 | 计划文件（实施时） | 责任 |
|---|---|---|
| 合同 | `electron/settings/vendorPreferenceContract.ts` + test | schema、归一化、供应商顺序 |
| 持久化/IPC | `electron/settings/vendorPreferenceSettings.ts`、`electron/settings/vendorPreferenceIpc.ts`、bridge 类型 | 原子读写、trusted sender、版本化 |
| 选择器 | `src/config/modelIdentity.ts` + `src/workbench/common/useDedupedModelSelect.ts` | 统一身份去重、排序、供应商 chip 和未配置分组 |
| 设置 | `src/ui/onboarding/VendorPreferenceOrderControl.tsx` | 只列已配置供应商，上下移后写入现有设置边界 |
| 旅程/实验室 | `tests/ux/vendor-preference-order.walk.mjs`、`tests/ux/shots/vendor-order/` | 真实 UI 路径、mock 响应、四种截图状态 |

## 8. 回滚

回滚只删除供应商偏好合同、IPC、UI 接线和选择器扩展；未知设置文件按“忽略并保留”处理，不删除用户原有模型目录、密钥或生成默认值。阶段二的自动切换合同仍只保留在方案文档，不会被本次回滚路径触碰。

## 9. 验收门

- **合同**：未知供应商、重复键、过长键归一化；schema 版本固定为 1。
- **选择**：同一 canonical 身份只一行；偏好供应商排首并高亮；未配置供应商沉底、灰显、点击打开模型接入；同名模型跨供应商不串台。
- **持久化**：设置写入后重启仍保持顺序；只列已配置供应商，移除/禁用后稳定回到剩余顺序。
- **真实旅程**：配两家同模型 → 设置偏好 → 任一模型入口看顺序 → 点另一家 chip 生成一次；四种实验室状态截图登记。
- **静态门**：`pnpm run check:docs-index`、`pnpm run check:doc-status`、`pnpm run check:filesize`、`pnpm run check:boundaries`、`pnpm run typecheck` 与 `pnpm run gates` 全绿（实施 PR 另按 R22 触发 unit/journey）。

## 10. 六角色预审记录（R7）

| 角色 | 关键审查结论 |
|---|---|
| CTO | 不引入第二执行器；有限重试和单一 resolver 足够。 |
| 设计 | 默认显示“能力/模型”，供应商是来源细节；切换必须可见。 |
| PM | 先解决 429/暂时不可用的完成率，不承诺跨模型等价。 |
| 前端 | 复用现有模型设置家和 i18n，不在 composer 再造一套管理页。 |
| 后端 | 统一 retryable 分类、attempt 上限和 main-owned receipt。 |
| 真实用户 | “我选的模型没死，任务继续了”是收益；“不知不觉花了另一家钱”是不可接受风险。 |

## 11. 研究记录

- Context7：`/openrouterteam/docs`（provider `order`、`allow_fallbacks`、model array）；`/berriai/litellm`（Router retry/fallback、cooldown、`max_fallbacks`）；`/portkey-ai/gateway`（nested fallback/loadbalance、按状态码 retry）。
- 官方网页：OpenRouter provider selection/model fallbacks（见 §3 链接）；LiteLLM [Getting Started](https://docs.litellm.ai/)；Portkey [Gateway repository](https://github.com/Portkey-AI/gateway)。检索日期均为 2026-09-06。
