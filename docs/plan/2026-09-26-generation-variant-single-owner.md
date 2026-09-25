# 「这一镜跑哪个变体」收成一个 owner（2026-09-26，v0.22.1 发版阻断）

> 状态：🚧 进行中 — 协调会话派工（N3），用户原话「这是钱的问题，必须修好」。
> 根因合同：[2026-09-26-generation-variant-single-owner.root-cause.json](../fixes/2026-09-26-generation-variant-single-owner.root-cause.json)

## 用户那一刻卡在哪

真付费走查（PR #883 的 T4 / T5）：Agent 付费卡写着 Seedance 2.0「Fast」，宿主派发时却是
`transportModelId: doubao-seedance-2.0`、`variantId: standard`——**卡上一个价，扣的是更贵的另一个**。
走查在付费前拦下，没花钱。

## 根因

「这一次生成跑哪个变体」有两个 owner，答案相反：

- **渲染层 / 付费卡**（`archetypeMeta.currentArchetypeVariant`）：存过的 variantId → 默认变体 → 第一个；从不看模型名。
  付费卡那张生成框（`spendCardDraft.projectSpendNode`）不带 variantId，于是落到默认 fast。
- **宿主派发**（`mcpGenerationVideoResolve.videoCandidateForPlan` / `candidatesForCurrentVideoModel`、`registry.variantFor`）：
  拿目录模型名反推变体。目录行 `doubao-seedance-2.0` 恰好就是 standard 变体的 key（`seedanceApimart.ts`），所以永远推成 standard，
  provider 再用 `transportModelId` 盖掉 body 的 model（`apimartGenerationProvider.ts`）。
- 渲染层早就写着宿主违反的那条规则：`archetypeMeta.normalizeArchetypeVariantMeta`「**绝不能用基础串反推变体**」。

同一件事另有几份各算各的副本：`specializeArchetypeForVariant`（未知 id 不回落默认）、`recommendation.canonicalVideoVariantId`（大小写不敏感，渲染层敏感）、
`effectiveVideoModes`（不认别名）、`recommendation` 推荐结果、`videoTransportModelIdForPlan`、`modelAdmissionSchema`、`plannedNodeMeta.canonicalVariantId`
（且不指定变体时按未特化档案铺参数——节点实际跑默认变体，参数面却是标准版的）。

## 做法

1. **唯一 owner**：`electron/shared/modelArchetypes/variantResolution.ts`（经 `modelArchetypes/index.ts` 导出，挨着 `specializeArchetypeForVariant`）。
   单开一个只依赖类型的叶子模块，是因为 `modelArchetypes/index.ts` 在加载时就要读视频档案桶，
   而视频侧（`registry.ts` / `recommendation.ts`）也要调它——放进 index 会成环。
   - `canonicalArchetypeVariantId(archetype, id)`：精确 id 或声明的历史别名（大小写不敏感）→ 声明的 id；认不出 → 空串。
   - `archetypeBaseModelKey(archetype)`：`catalogModelKey` → 默认变体的 key。
   - `resolveArchetypeVariant(archetype, { variantId, modelId })`：显式请求的变体 → 模型名是某个变体的**专属** key 且不是基础 key → 默认变体 → 第一个。
2. 宿主、渲染层、付费卡全部委托给它；副本全部删掉（P1）：
   `mcpGenerationVideoResolve`（三处）、`registry.variantFor`、`recommendation`（`canonicalVideoVariantId` 删除、`effectiveVideoModes`、推荐结果）、
   `modelAdmissionSchema`、`specializeArchetypeForVariant`、`archetypeMeta`（`canonicalVariantIdOf` / `defaultVariantIdOf` / `currentArchetypeVariant` /
   `applyArchetypeVariantSwitch` / `normalizeArchetypeVariantMeta` / `ensureArchetypeNodeMeta`）、`plannedNodeMeta`。
3. **付费卡读同一份输入**：`PendingSpendShot` 带上候选的 `variantId`，`projectSpendNode` 写进节点 meta——卡与宿主拿同一组 `{variantId, modelId}` 问同一个函数。
4. 概念登记：`concept-owners.json` 新增「一次生成跑哪个变体」，owner = `resolveArchetypeVariant`。

**行为变化（写进 PR）**：外部 MCP 客户端不传 variantId、模型名写基础名时，从 standard 变成 fast（更便宜、也是对外宣称的默认）。
写变体专属名（如 `doubao-seedance-2.0-fast` / `-mini`）的照旧按那个变体。

## 范围 / 不动项

- **不动模型可见的工具 schema**（`draft_shots` 不加 `variantId`）——纯宿主侧，不触发 R13.3。
- 不动付费卡上「切变体」的交互（今天切了会被静默丢弃）——记 TODO 交协调会话。
- 不动价格与花钱闸。

## 回滚

单 PR，revert 即回；无存量数据迁移（变体每次读时派生，节点 meta 里存的 variantId 语义不变）。

## 验收门

- 类测试 `electron/parity/variantResolutionParity.test.ts`：真实内置目录里**每一条**带变体的视频行，画布显示 === 宿主派发、出站 model === 该变体 key；
  付费卡生成框在指定 / 不指定变体时都 === 宿主。**改前红**（`apimart/doubao-seedance-2.0：宿主 standard ≠ 画布 fast`；`kie/bytedance/seedance-2` 指定 fast 时卡显示 standard）。
- owner 单测覆盖全部带变体的档案（视频 + 图片）；翻转 `videoCapabilities/index.test.ts` 那条把 bug 钉成正确答案的断言。
- 对等矩阵 `parityCases` 加 `apimart / doubao-seedance-2.0 / text_to_video`，十个入口逐字段比出站报文。
- 真付费（上限 ¥3，Seedance fast 480p 4s，只在资料拷贝上）：用 #883 的 T4 / T5 真跑——卡上的变体 === 实际派发的变体、视频落回节点、排队中两个入口都发不出第二次。

## 先查别人

- **仓库里已有正确的规则**：`src/workbench/generationCanvas/nodes/controls/archetypeMeta.ts:463`（基础 key = `catalogModelKey` → 默认变体 key）与 `:466`「绝不能用基础串反推变体」——owner 照它写，不另立规则。
- **仓库里已有变体特化的共享位置**：`electron/shared/modelArchetypes/index.ts:240`（`specializeArchetypeForVariant`，渲染读取点与构造层共用）——owner 挨着它、它改为委托。
- **宿主反推的来源**：`electron/capabilityCore/mcpGenerationVideoResolve.ts:146`、`electron/shared/videoCapabilities/registry.ts:229`（`fb1fad28b`，PR #124 起）。
- **出站 model 被 transportModelId 覆盖**：`electron/capabilityCore/apimartGenerationProvider.ts:301`。
- 依赖 / 生态：不适用——变体是本仓档案自己的语义，没有第三方库或外部格式参与。
- 结论：用已有规则（渲染层那条），把它提成共享 owner，宿主与副本全部改读它。
