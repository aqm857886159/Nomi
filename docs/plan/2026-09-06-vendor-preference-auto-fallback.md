# 供应商偏好与自动切换方案（S-01/S-02）

> 日期：2026-09-06 · 状态：📋 方案待拍板 · 独立轨：不进入主线实现
> 来源：`docs/plan/2026-09-05-gpt-discussion-consolidation.md` §1、现役代码盘点与 2026-09-06 Context7/官方文档检索。

## 1. 先说用户要解决的摩擦（D6）

用户已经接了两个能做同一件事的模型/中转站，却仍要在一个模型抽风、限流或余额耗尽时手工回设置页换模型。例如：他选好的文本大脑因 429 暂时不可用，Agent 直接报错；用户只想继续写分镜，却要重新找模型、确认 key、再发送一次。这个方案让用户先选“我想用哪种模型能力”，系统在同一能力范围内按明确顺序尝试可用供应商，并把实际切换告诉用户。

用户真正要权衡的一件事是：**可靠地完成任务，还是始终严格控制花哪一个供应商的钱**。推荐默认选择可预测的显式顺序、只对可重试故障自动切换；跨模型/跨能力或可能改变费用的切换必须先提示并允许关闭。

陌生概念说明：这里的“能力槽”是任务需要的稳定身份（例如“可调用 Agent 工具的文本大脑”），不是某一家供应商的名字；供应商只是填这个槽的执行通道。

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

## 4. R3 方案对比

| 方案 | 用户看到什么 | 代价 |
|---|---|---|
| A. 只记一个供应商（推荐度低） | 设置页选“优先用 KIE”，失败后停在错误页 | 实现最简单，但同名模型、能力差异和凭据状态会串台；没有自动完成 S-02。 |
| **B. 能力槽下的模型身份候选链 + 有界自动切换（推荐）** | 设置“文本大脑：Claude@KIE → Claude@自建中转”；发生 429 时提示“已切到下一候选”，可展开看原因、费用和重试次数 | 需要统一错误分类、候选链持久化、收据与真实旅程；跨模型 fallback 默认需用户开关。 |
| C. 全局智能路由/成本优化 | 用户只选“稳定/便宜/快速”，系统按实时数据任意换模型和供应商 | 透明度和账单可预测性差，需实时价格/延迟服务；超出 Nomi 护城河，拒绝本期。 |

## 5. 推荐设计（只写方案，不实现）

### 5.1 身份与偏好

持久化新增一个版本化的 `CapabilityPreference` 合同（建议放 `electron/ai/textBrainPreferenceContract.ts`，目标 <200 行）：

```ts
{
  schemaVersion: 1,
  bySlot: {
    assistant_text: {
      orderedModels: [
        { modelKey: "claude-sonnet-4", vendorKey: "kie" },
        { modelKey: "claude-sonnet-4", vendorKey: "my-relay" }
      ],
      allowModelFallback: false,
      maxAttempts: 2
    }
  }
}
```

- `assistant_text`、`image_understanding_text` 等是能力槽；槽定义来自共享 capability contract，不在 UI 或供应商代码里复制。
- `orderedModels` 是完整模型身份 `(modelKey, vendorKey)`；用户界面先显示模型/能力，再显示供应商来源。只填 `vendorKey` 的旧/非法记录归一化为缺席。
- 同一模型身份可有多个供应商候选；不同模型只有在 `allowModelFallback=true` 且目标档案证明同一能力槽兼容时才能进入链。
- 未设置仍沿用 `textBrainResolver` 当前稳定自动选择；迁移不写“默认的默认”。

### 5.2 运行时选择与切换

1. `textBrainResolver` 保留单一入口；新增候选解析器只把偏好合同转换为现有 `{ vendor, model }` 候选，不在 renderer 另造选择器。
2. 每次尝试绑定 `slot`, `(vendorKey, modelKey)`, `attempt`, `reason`；API key 仍只在 main 解密，绝不进入偏好或 UI 收据。
3. 只对 `429/rate_limit`、超时、网络断开、502/503/504 等明确 `retryable` 错误自动继续；401/403、参数不兼容、内容拒绝、用户取消立即停下并给可行动错误。
4. `maxAttempts` 默认 2、上限 3；同一请求不重复目标；不做后台冷却状态的第二份长期真相，若需要熔断只在本次请求上下文内计数。
5. 切换到不同模型身份前，若该槽可能改变价格、上下文或输出格式，先返回可见的“需要确认”状态；没有确认时不发第二次付费请求。
6. 成功结果的 Host receipt 记录 `selected` 与 `attempts`（脱敏），失败收据列出尝试过的候选和分类；现有 approval/spend 闸保持在请求前。

### 5.3 UI 与用户控制

- 在现有模型设置家中增加“文本大脑/能力槽”排序，不新增供应商专属页面；一功能一个家。
- composer 只显示当前槽与“已自动切换”状态，展开后看候选顺序、失败原因和“固定此模型/关闭自动切换”。
- 文案走 i18n（R15）；不显示 API key、完整 URL 或供应商内部错误原文。

## 6. 范围与不动项

**本轨范围**：偏好合同、读写 IPC、text resolver 候选链、可重试错误分类、Host receipt、模型设置页排序与恢复、迁移与真实 Electron 旅程。

**不动项**：不改供应商 HTTP mapping、模型档案能力事实、Pi runtime 权威、生成任务默认模型 `byTaskKind` 的语义；不接第三方网关运行时；不做实时价格/延迟路由、跨能力降级、自动重试用户已取消的请求。

## 7. 分层与文件拆分（R9，单文件 ≤800 行）

| 层 | 计划文件（实施时） | 责任 |
|---|---|---|
| 合同 | `electron/ai/textBrainPreferenceContract.ts` + test | schema、归一化、候选身份与槽枚举 |
| 持久化/IPC | `electron/settings/textBrainPreferenceSettings.ts`、`electron/settings/textBrainPreferenceIpc.ts`、bridge 类型 | 原子读写、trusted sender、迁移 |
| 选择器 | `electron/ai/textBrainResolver.ts`（保持 <800 行）+ `textBrainFallbackPolicy.ts` | 复用现有 catalog、错误分类、有限尝试 |
| Host/事件 | `electron/projectAgentHost/*` 对应 receipt reducer/test | 记录切换原因，不把凭据或 prompt 写入事件 |
| 渲染 | `src/ui/onboarding/*` 与 composer 现有模型选择组件 | 排序、状态提示、i18n；不复制 resolver |
| 旅程 | `tests/ux/text-brain-fallback.walk.mjs` | 真实故障矩阵、持久化/重启、截图证据 |

## 8. 回滚

回滚只删除该合同、IPC、UI 接线与 fallback policy，恢复 `textBrainResolver` 现有 `TextModelPreference` 调用；未知设置文件按“忽略并保留”处理，不删除用户原有模型目录、密钥或生成默认值。若已写入 receipt，新版本继续按只读旧事件兼容读取；不做数据重写。

## 9. 验收门

- **合同**：未知槽、半条身份、重复目标、`maxAttempts>3` 均归一化；同名模型在不同供应商下不串台。
- **选择**：首选成功零回退；429/超时/5xx 按顺序最多 3 次；401/参数错/取消零回退；同目标不重复。
- **安全/花费**：每个自动切换前都经过 main-owned credential 与 spend/approval 闸；renderer 伪造 vendor/model 不改变执行身份。
- **持久化**：设置写入后重启仍保持顺序；删除/禁用候选后明确回到自动选择并提示。
- **真实旅程**：Playwright/Electron 造两个同能力候选，首个返回 429，第二个成功；截图证明用户看见切换原因、最终模型和收据；再跑断网、401、取消三条负例。
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
