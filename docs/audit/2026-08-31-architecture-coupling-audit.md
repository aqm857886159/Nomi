# Nomi 架构耦合 / 内聚审计（R14 周期审计 · 架构维度）

日期：2026-08-31
基线：`origin/main` @ `b02fd3db`（隔离树 `/Users/aoqimin/Desktop/Nomi-arch-audit-20260831`，落分支 `docs/architecture-audit-20260831`）
工具：`dependency-cruiser@18.2.0`（隔离安装于 `/tmp`，未写入仓库 `package.json`）+ 自写 `git log --name-only` 共变统计（临时脚本已删，未入库）
范围：`src/**` + `electron/**` + `workers/**`（生产码，剔除 `*.test.*` / `*.node-test.*` / `testSupport` / `dev` / `devlab`）；共 **1564 个生产模块**、约 **2430 个 TS 文件**。
针对用户痛点："改一点动一大堆、改一个事得找半天、东西很乱"——本报告只给数字 + `file:line`，不印象流。

---

## 结论先行（TL;DR）

痛点是真的，但根因**不是一团糊**，而是**两个具体的耦合病灶 + 一个反复出现的"一职能散多个家"模式**：

1. **"改一点动一大堆" 的头号来源 = 供应商/模型目录管线**：`electron/providerAdapter` ↔ `electron/catalog` ↔ `electron/integrationCertification` ↔ `electron/shared/modelPublication` 是一个 **15 文件、内部共变支持度 151** 的巨簇（远超第二名的 3-4 倍）；同时它是 **37 个"硬"循环依赖里的绝对主场**（`electron/runtime.ts` 一个人就在 18 个硬环里）。加一个模型/供应商 = 这一圈全动。
2. **"改一个事得找半天" 的头号来源 = `generationCanvas` UI 子树的循环缠绕**：536 个静态循环里 **499 个**穿过它（`generationNodeKinds.ts` / `nodes/registry.ts` / `BaseGenerationNode.tsx` / `generationCanvasTypes.ts` 四个文件各自出现在 ~470-497 个环里）。**好消息**：这 499 个里绝大多数经由**故意的懒加载 `import()` 边**（`registry.ts:53` 的 `loadBaseGenerationNode`），运行期不是硬环——但对"读代码、定位改动点"的认知负担是实打实的：任意一个节点文件都能牵出全子树。
3. **"东西很乱" 的头号来源 = 一职能散多个家**：模型档案散在 **3 个家**（`src/config/modelArchetypes` 57 文件 + `electron/shared/videoCapabilities` 32 文件 + `electron/catalog` 118 文件），其中 **`src/config/modelArchetypes` 有 29 个纯 re-export 壳**只为把 electron 定义的 video 档案暴露给渲染层；onboarding 散在 **4 个家**（120 文件）；定价散在 main + 渲染两侧。

**没那么糟的地方（避免过度反应）**：`electron/catalog` 内部内聚 73%、`electron/shared/videoCapabilities` 内聚 100%、`electron/productionRun` 75%——**领域模块本身组织得不差，坏在"边界画在了进程线两侧"和"同一职能有好几个门牌号"**。巨壳白名单仍只 4 个（存量健康），今天合入的 7 个 PR **代码零重叠**（只在 docs 登记文件上撞车）。

---

## 分析一：共变耦合（回答"改一点动一大堆"）

**方法**：`git log --no-merges -300 --name-only`（窗口 2026-08-24 → 08-31，近期最密的一段），剔除 `docs/` / `*-baseline.json` / lock / `AGENTS.md`（由 CLAUDE.md 生成）/ 快照 / 二进制；只取"2 ≤ 改动文件数 ≤ 60"的 commit（≥60 的 7 个 mass-refactor 剔除以免 pair 爆炸）；共 **198 个可用 commit**。文件对共变次数 ≥4 且方向 confidence 最小值 ≥30% 连边，取连通分量成簇。

**每 commit 改动文件分布**（全 300 个非 merge，含 docs）：中位数 4、p90 = 25、max = 124。

### Top 共变簇（成员 · 内部支持度 · 跨层数）

| # | 簇（代表成员） | 大小 | 内部支持度 | 层 | 判读 |
|---|---|---|---|---|---|
| **C1** | `providerAdapter/{service,types,store,serviceCatalog}.ts` + `catalog/catalogCommit.ts` + `shared/modelPublication.ts` + `integrationCertification/*` + `config/modelCatalogCache.ts` | **15** | **151** | electron/runtime + config | **头号病灶**。目录见 `electron/providerAdapter/`, `electron/catalog/`, `electron/integrationCertification/` |
| C2 | `i18n/locales/generationCommon.ts` + `generationCanvas/{spend/spendConfirm,nodes/BaseGenerationNode,store/canvasStoreTypes,nodes/NodeResultStack}` + `public/tailwind.generated.css` | 8 | 40 | root + i18n + UI + tests | 加节点=连带动 i18n 词典 + 生成的 CSS |
| C3 | `capabilityCore/appIntegration.ts` + `productionRun/{productionRunReducer,productionRunTypes,productionGenerationSubmission}.ts` + `capabilityCore/mcpGenerationTools.ts` | 5 | 28 | electron/runtime | production 提交链 |
| C4 | `ai/antigravityTask.ts` + `catalog/processOperation.ts` + `runtime.ts` | 5 | 24 | electron/runtime | 供应商 task ↔ catalog 处理 |
| C5 | `.github/workflows/quality-gate.yml` + `CLAUDE.md` + `package.json` + `check-quality-gate-workflow.node-test.mjs` | 4 | 24 | root + gates | 纪律/门岗三真相源同步（健康的共变）|
| C6 | `marketing/{en/,}index.html` + `scripts/marketing/content.mjs` + `tests/ux/marketing-home.static.mjs` | 4 | 24 | marketing + tests | 营销页三处必须齐动（可门岗化）|
| C7 | `generationCanvas/components/{CanvasBatchGenerateDock,CanvasSelectionToolbar,CanvasBulkModelSelect}.tsx` | 3 | 12 | UI | 批量选择工具条 |
| C8 | `export/mediaProbe.ts` + `providerAdapter/certificationMedia.ts` | 3 | 12 | electron/runtime | 媒体探测跨 export/providerAdapter |

**大部分 100%-confidence 的对是 `源文件 ↔ 它自己的 .test`（健康，非耦合）——上表已剔除这类。**

### 模块级共变（多少 commit 同时碰了两个模块）

| commit 数 | conf≥ | 模块对 | 判读 |
|---|---|---|---|
| 17 | 29% | `src/i18n/locales` × `src/workbench/generationCanvas` | **"加个画布功能就得改 i18n"** —— 每个用户可见字符串强制走 i18n（R15），画布是文案大户 |
| 12 | 20% | `scripts` × `src/workbench/generationCanvas` | 画布功能连带动门岗/走查脚本 |
| 11 | 19% | `public/tailwind.generated.css` × `src/workbench/generationCanvas` | **生成的 CSS 与画布同 commit**——`tailwind.generated.css` 是 build 产物被提交进库（churn 榜第 4，14 次），改 className 就重生成 |
| 8 | 14% | `src/workbench/capability` × `src/workbench/generationCanvas` | capability 应用 ↔ 画布 |
| 7 | 19% | `electron`(根) × `electron/catalog/catalogCommit.ts` | catalog 提交牵动 electron 根 |

**单文件 churn Top（近 300 commit 出现次数）**：`package.json`(31) · `i18n/locales/generationCommon.ts`(17) · `CLAUDE.md`(15) · `public/tailwind.generated.css`(14) · `.github/workflows/quality-gate.yml`(13) · `electron/runtime.ts`(12) · `electron/capabilityCore/appIntegration.ts`(11) · `electron/preload.ts`(10) · `electron/catalog/catalogStore.ts`(10) · `electron/providerAdapter/service.ts`(10)。

> **可落地信号**：`public/tailwind.generated.css`（build 产物）被当源码提交，导致每次 UI 改动多一个高 churn 文件、也多一处 merge 冲突面。见分析五附注。

---

## 分析二：Import 图

**工具选择理由**：`dependency-cruiser@18.2.0` —— 唯一一个"能出循环 + fan-in/out **且** 能把分层规则写成 `forbidden` 规则、导出机读 JSON"的现役工具，一把覆盖"分析"和后面要提的"门岗"。madge 只做循环/孤儿；`eslint-plugin-boundaries` 需要 eslint 运行时 + 每文件标 `elementType`，重。配置见本报告分析五。

### a) 循环依赖

- **静态循环：536 个**（去重后 canonical distinct）。**但必须分层看**：
  - **499 个**至少含一条 **动态 `import()` 边**（懒加载/代码分割，运行期非硬环，属"认知耦合"不属"加载顺序炸弹"）。主犯是 `nodes/registry.ts:53` 的 `loadBaseGenerationNode = () => import('./BaseGenerationNode')`——registry 把所有节点类型都 lazy-map 到 `BaseGenerationNode`，于是 `model → registry → (lazy) BaseGenerationNode → model` 成环，且任意 node 文件都被卷进来。
  - **37 个是"完全静态"硬环**（真·加载顺序风险），**几乎全在 electron/**：

  | 硬环区域 | 数量 |
  |---|---|
  | `electron/catalog` + `electron/runtime.ts` | 8 |
  | `electron/catalog`（自环） | 4 |
  | `electron/ai` + `catalog` + `integrationCertification` + `providerAdapter` + `runtime.ts`（五模块巨环） | 3 |
  | `electron/capabilityCore` | 3 |
  | `electron/integrationCertification` + `providerAdapter` | 2 |
  | `src/ui`（onboarding 卡片） | 4 |

  **硬环参与最多的文件**：`electron/runtime.ts`(18) · `electron/catalog/customCallMode.ts`(9) · `electron/catalog/catalogStore.ts`(8) · `catalog/comfyuiCandidateLifecycle.ts`(5) · `integrationCertification/types.ts`(5) · `providerAdapter/verifier.ts`(5)。

- **最恶性的 3 个环（按成员数）**——全在 `generationCanvas`（含 lazy 边，但成员规模最大、最缠）：
  1. `workbenchProjectSession.ts → shotVerifyStore.ts → generationCanvasStore.ts → canvasEventEmitter.ts → canvasUndoJournal.ts → canvasEventReducer.ts → generationCanvasTypes.ts → generationNodeKinds.ts → nodes/registry.ts → BaseGenerationNode.tsx → NodeGenerationComposer.tsx → assets/PromptEditor.tsx → AssetMentionNode.tsx → AssetMentionChip.tsx → AssetTile.tsx → AssetVideoCover.tsx → media/useFilmstrip.ts`（**17 成员**，跨 canvas/assets/media）
  2. `nodes/controls/archetypeMeta.ts → model/parameterReferenceSlots.ts → …/registry.ts → BaseGenerationNode.tsx → timeline/addNodeToTimelineEnd.ts → adoption/adoptGenerationNode.ts → adoption/adoptionStorePorts.ts → workbenchStore.ts → generationCanvasStore.ts → events/… → store/canvasStoreTypes.ts → agent/referenceEdgeCapability.ts`（**16 成员**，画布 ↔ 时间轴 ↔ adoption ↔ 顶层 store 缠在一起）
  3. 最危险的**纯静态五模块环**（37 硬环之一）：`electron/ai/vendorLanguageModel.ts → catalog/… → integrationCertification/types.ts → providerAdapter/verifier.ts → runtime.ts → …`——供应商语言模型、目录、认证、适配器、runtime 互相直引，改一处要防五处编译顺序。

### b) fan-in / fan-out 热点 Top 10

| fan-in（被 N 个本地模块引用 = 改它的爆炸半径） | | fan-out（引 N 个本地模块 = 编排枢纽） | |
|---|---|---|---|
| `src/utils/cn.ts` | **218** | `electron/main.ts` | 71 |
| `generationCanvas/model/generationCanvasTypes.ts` | 170 | `src/config/modelArchetypes/index.ts` | 57 |
| `electron/catalog/types.ts` | **127** | `generationCanvas/nodes/BaseGenerationNode.tsx` | 55 |
| `src/design/index.ts` | 126 | `generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx` | 46 |
| `src/desktop/bridge.ts` | 108 | `src/workbench/NomiStudioApp.tsx` | 43 |
| `generationCanvas/store/generationCanvasStore.ts` | 100 | `src/ui/onboarding/OnboardingDrawer.tsx` | 42 |
| `src/i18n/index.ts` | 98 | `electron/runtime.ts` | 40 |
| `generationCanvas/nodes/scene3d/scene3dTypes.ts` | 63 | `electron/catalog/seedBuiltins.ts` | 36 |
| `src/ui/toast.tsx` | 62 | `generationCanvas/nodes/NodeGenerationComposer.tsx` | 35 |
| `src/workbench/workbenchStore.ts` | 57 | `electron/catalog/catalogStore.ts` | 21(in=37) |

**判读**：高 fan-in 里 `cn.ts`(27 行叶子工具)、`design/index.ts`(47 行 barrel)、`i18n/index.ts`、`scene3dTypes.ts`、`toast.tsx` 都是**健康的叶子/barrel/类型**（无环风险，纯被依赖）。**真正的耦合枢纽是三个 fan-in 高且深陷环的文件**：`generationCanvasTypes.ts`(170, 在 470 环)、`electron/catalog/types.ts`(127, 522 行, 在硬环)、`generationCanvasStore.ts`(100, 在 165 环)。`modelArchetypes/index.ts`（fan-out 57、56 条 import 的 barrel）是"加模型必改这一处"的单点。

### c) 分层违规（R9 宣言 → 真实目录映射 + 违规计数）

**宣言 → 真实目录映射**（本审计采用）：

| R9 宣言层 | 真实目录 |
|---|---|
| UI | `src/ui/`, `src/workbench/`, `src/desktop/`（bridge 类型）, `src/theme/` |
| 状态 | `src/workbench/**/store/`, `*Store.ts`, `src/workbench/workbenchStore.ts` |
| 领域/配置 | `src/config/`, `src/api/`, `src/media/`, `src/lib/`, `src/utils/` |
| 设计系统 | `src/design/`, `src/styles/` |
| runtime（主进程）| `electron/**` |
| 持久化 | `electron/projects/`, `electron/settings/`, `electron/workspace/`, `electron/memory/` |
| 跨进程契约 | 当前**散落**在 `electron/shared/`, `electron/*/…Contract.ts`, `electron/*/…Types.ts`（无中立层，是问题本身）|

**用 dependency-cruiser 三条 `forbidden` 规则实测（生产码，去测试）：**

| 违规方向 | 数量 | 判读 |
|---|---|---|
| `electron/` → `src/`（runtime 反向 import 渲染层）| **0** | ✅ 干净。主进程从不反向依赖渲染层 |
| `src/` → `scripts/`（UI 捅门岗）| **0** | ✅ 干净 |
| **`src/` → `electron/`（渲染层直捅主进程）** | **131** | ⚠️ **最严重方向**。见下拆解 |

**131 条 `src → electron` 拆解**（去重后 113 条实际 import 语句）：
- **62 条是纯 `import type`**（编译期擦除，运行期零耦合）——但暴露一个真问题：**跨进程契约/类型没有中立的家**，渲染层被迫伸进 `electron/` 拿类型（`productionRunTypes`、`agentChatContracts`、`*Contract.ts`）。
- **51 条是 value import**（真·运行期耦合，把主进程常量/函数打进渲染 bundle）——**这些是门岗该先拦的**。

**按目录对聚合（Top）**：

| 数量 | from → to | 性质 |
|---|---|---|
| **30** | `src/config/modelArchetypes` → `electron/shared/videoCapabilities` | **value**（29 个 re-export 壳，见分析四）|
| 9 | `src/ui/onboarding` → `electron/shared/antigravity.ts` | 混合（`ANTIGRAVITY_VENDOR_KEY` value + `AntigravityTestRequest` type）|
| 8 | `src/workbench/production` → `electron/productionRun/productionRunTypes.ts` | 纯 type |
| 7 | `src/ui/onboarding` → `electron/catalog/types.ts` | type |
| 4 | `src/workbench/ai` → `electron/harness/agentChatContracts.ts` | 契约（应进中立层）|
| 4 | `src/workbench/settings` → `electron/settings/automationPolicyContract.ts` | 契约 |
| 4 | `src/workbench/generationCanvas` → `electron/catalog/parameterReferenceContract.ts` | 契约 |

**根因**：Nomi 没有一个 renderer/main **都能合法 import 的中立契约层**。于是"跨进程共享的类型/常量"要么塞进 `electron/shared/`（渲染层就得反向伸手），要么在 `src/config` 做 re-export 壳。**建中立层是分析五门岗的前置**。

---

## 分析三：模块健康

### a) 低内聚目录（内部 import / (内部+外部)，≥4 文件、≥8 边）

**越低 = 文件们各自往外抓、不抱团 = "散":**

| 内聚 | 文件 | 内/外/入边 | 目录 | 判读 |
|---|---|---|---|---|
| **10%** | 6 | 2/18/32 | `generationCanvas/nodes/controls` | 控件散抓全画布 |
| 11% | 5 | 3/24/22 | `generationCanvas/adapters` | 适配层几乎全外引 |
| 11% | 6 | 1/8/11 | `src/ui/app-shell` | 外壳散 |
| 12% | 6 | 2/15/10 | `src/workbench/library` | 项目库散 |
| 14% | 4 | 3/19/111 | `src/i18n` | 被 111 处引（i18n 天然高入边，可接受）|
| 15% | 12 | 12/70/80 | `src/workbench`（根散文件）| 顶层散文件 |
| 15% | 11 | 8/45/4 | `generationCanvas/creation/storyboard` → 实为 `src/workbench/creation/storyboard` | 分镜逻辑外抓 |
| 18% | 14 | 18/82/2 | `generationCanvas/reactFlow` | reactFlow 胶水层，外引 82 |
| 20% | 16 | 17/70/6 | `src/workbench/preview` | 预览散 |
| 24% | 16 | 17/55/3 | `src/workbench/settings` | 设置散抓 |

**对照——高内聚（组织得好的）**：`electron/shared/videoCapabilities` **100%**(32 文件) · `electron/export` 88% · `generationCanvas/nodes/scene3d` 79%(78 文件) · `electron/productionRun` 75%(48) · `electron/catalog` **73%**(118) · `generationCanvas/model` 68%(268 入边)。

> **关键判读**：**低内聚集中在 `generationCanvas` 的 UI 胶水子目录**（controls/adapters/reactFlow/components 都 <26%），而**领域/runtime 模块内聚度高**。这与"UI 缠绕、领域清晰但分家"的整体结论一致。`generationCanvas/nodes`（81 文件，25%）、`generationCanvas/components`（72 文件，26%）是最大的两个低内聚 UI 桶。

### b) 垃圾抽屉（lib/utils/helpers）

**反直觉的好消息**：`src/lib`(2 文件/229 行) 和 `src/utils`(10 文件/442 行) **都很小、没成垃圾抽屉**。`src/utils/cn.ts` 虽被 218 处引，但是 27 行纯叶子工具，健康。

**真正的"大桶"不在 utils，在领域目录**：`generationCanvas`(429 文件/**75,968 行**) · `electron/catalog`(118/18,614) · `src/config`(67/4,122) · `electron/shared`(42/3,921)。`generationCanvas` 一个子树占了渲染层的绝对多数体量。

### c) 巨壳白名单（`scripts/check-file-sizes.mjs` ALLOWLIST）近一月趋势

**升了**：2026-08-01 **2 个条目 / 1282 行** → 现在 **4 个条目 / 3758 行**。

| 文件 | Aug 1 | 现在 | 变化 |
|---|---|---|---|
| `electron/runtime.ts` | 543 | 530 | ↓ 缩了 |
| `generationCanvas/nodes/BaseGenerationNode.tsx` | 739 | 713 | ↓ 缩了 |
| `electron/integrationCertification/integrationSession.ts` | — | **1696** | ➕ **新入白名单（当前最大巨壳，超硬上限 800 一倍多）** |
| `src/ui/onboarding/OnboardingDrawer.tsx` | — | 819 | ➕ 新入白名单 |

**判读**：per-file 棘轮**被遵守**（老的两个都在缩），但**这个月放进来两个新巨壳**，其中 `integrationSession.ts` 1696 行是全仓最大的单文件违规——它正是 C1 供应商目录簇的一员。net 是白名单在长大。

### d) 今天 7 个 PR 的合并潮热点

对 #242 / #194 / #202 / #244 / #245 取真 delta（merge-base 二父 diff，#226 / #239 无 merge commit，squash 或未合），共 **105 个 distinct 文件**。**被 2+ PR 同碰的文件**：

| 次数 | 文件 |
|---|---|
| 3 | `docs/plan/INDEX.md` |
| 3 | `docs/DELIVERY-LEDGER.md` |
| 2 | `docs/superpowers/plans/INDEX.md` |

**代码文件零重叠。** ✅ 这一波 PR 分工干净，唯一的争用面是 **docs 登记文件**（每个带方案文档的 PR 都得改 INDEX/LEDGER）——是轻微的登记摩擦，不是代码 merge 风暴。

---

## 分析四：归属混乱实例（一职能散多个家）

| 职能 | 散落的家（file:line 级） | 有原则 or 历史堆积 | 证据 |
|---|---|---|---|
| **模型档案 / 目录**（已知嫌疑，证实）| ① `src/config/modelArchetypes/`（57 文件，其中 **29 个是纯 re-export 壳**，如 `kling.ts:1` = `export { KLING_3_ARCHETYPE } from "../../../electron/shared/videoCapabilities/kling"`）② `electron/shared/videoCapabilities/`（32 文件，video 档案的**真定义**）③ `electron/catalog/`（118 文件，目录存储/生命周期）| **半原则 + 历史堆积**。划线可辨（**video→electron、image/3D→src/config**，因 production run 在主进程要读 video 档案）；`check-archetype-sources.mjs:22-27` 注释明说"两处共用一个 provenance 门岗，防换 owner 藏未核验模型"——**门岗承认了分家、用规则糊住，而非统一门牌**。**29 个 re-export 壳是纯疤痕组织**：video 档案搬去 electron 后，为了不改 `src/config` 的 import site，留了 29 个转发文件。这直接产生分析二里 30 条 `src→electron` value 违规。|
| **Onboarding** | ① `src/ui/onboarding/`（**102 文件**）② `src/workbench/onboarding/`（12）③ `electron/onboarding/`（1）④ `electron/ai/onboarding/`（5）| **历史堆积**。4 个家、120 文件、跨进程线。`src/ui/onboarding` 里既有卡片 UI 又有 `useAntigravitySettings.ts` / `antigravityCardModel.ts` 这类**供应商专属逻辑**（应属 config/领域），且直捅 `electron/shared/antigravity.ts`（9 条违规）。分成 UI/workbench 两个渲染家无清晰边界。|
| **定价 / 成本** | ① `electron/productionRun/catalogPricingResolver.ts` + `shotPricing.ts`（主进程算价）② `src/workbench/generationCanvas/spend/`（`productionContractView.ts`, `SpendConfirmDialog.tsx`, `MultiShotContractSummary.tsx`——渲染层又算一遍展示价）③ `electron/capabilityCore/approvalReceipt.ts` | **历史堆积 + 潜在双真相源**。价从 main 的 resolver 出，但渲染层 `spend/` 自己也 derive 展示口径——碰钱的双计算是 P2/R20 该警惕的（"中转页上限≠模型上限"类漂移的温床）。|
| **供应商适配 / 认证** | `electron/providerAdapter/`（service/store/types/verifier/serviceCatalog…）+ `electron/integrationCertification/`（providerAdapterCoordinator/operationLedger/integrationSession）+ `electron/ai/`（vendorLanguageModel/vendorModelConnection/antigravityTask）| **有原则但过度耦合**。三个模块本身职责分明（适配 / 认证 / AI 调用），但**互相直引成 C1 巨簇 + 硬环**——是"边界对、连线太多"，非"没家"。修法是解耦（引入契约/事件），非合并。|
| **画布节点渲染分发** | `nodes/registry.ts`（lazy map）+ `nodes/BaseGenerationNode.tsx`（`renderKind` 分发，713 行巨壳）+ `nodes/render/`（11 文件，26% 内聚）+ `nodes/controls/`（6 文件，10% 内聚）| **历史堆积**。"一个节点怎么渲染"这件事散在 registry（路由）、BaseGenerationNode（巨型分发）、render/、controls/ 四处，是 499 个软环的策源地。|

---

## 分析五：规则提案（防复发 · 要长牙）

### a) `check:boundaries` 棘轮门岗设计

**工具**：`dependency-cruiser@18.2.0`（同分析二，一把兼分析+门岗）。**新增依赖**：`dependency-cruiser` 进 `devDependencies`。

**规则集**（`.dependency-cruiser.cjs`，`forbidden` 数组）：

```js
// 每条规则 = 一个方向的禁令；违规清单存 baseline，只减不增（与 filesize/tokens/i18n/heavy-path 同款棘轮）
module.exports = {
  forbidden: [
    // R-B1 渲染层不得直捅主进程（当前 131 存量，先冻结）
    { name: 'src-no-import-electron', severity: 'error',
      from: { path: '^src/' },
      to:   { path: '^electron/', pathNot: '^electron/shared/contracts/' } }, // 预留中立契约层豁免
    // R-B2 主进程不得反向 import 渲染层（当前 0，硬零）
    { name: 'electron-no-import-src', severity: 'error',
      from: { path: '^electron/' }, to: { path: '^src/' } },
    // R-B3 UI 不得捅门岗脚本（当前 0，硬零）
    { name: 'src-no-import-scripts', severity: 'error',
      from: { path: '^src/' }, to: { path: '^scripts/' } },
    // R-B4 禁新增"完全静态"循环（当前 37 硬环，进 baseline 冻结；动态 import 边不算）
    { name: 'no-new-static-circular', severity: 'error',
      from: {}, to: { circular: true, viaOnly: { dependencyTypes: ['import','require','export'] } } }, // 排除 dynamic-import
  ],
  options: { doNotFollow:{path:'node_modules'}, tsConfig:{fileName:'tsconfig.base.json'},
    tsPreCompilationDeps:true, exclude:{path:'(node_modules|\\.test\\.|/testSupport/|/dev/|/devlab/)'} },
}
```

**baseline 机制**（照搬 `check-file-sizes.mjs` / `archetype-sources-baseline.json` 的成熟范式，**存具体身份不存裸数字**——裸数字会放过"修一条旧的、新增一条"蒙混）：
- `scripts/boundaries-baseline.json`：`{ "src-no-import-electron": ["src/config/modelArchetypes/kling.ts -> electron/shared/videoCapabilities/kling", ...131 条], "static-circular": [...37 个环的 canonical key] }`。
- `scripts/check-boundaries.mjs`：跑 depcruise → 拿违规 → 与 baseline 差集；**新增违规当场红**，修掉一条要**同步删 baseline 一行**（缩得比 baseline 少则提示下调，同 filesize 门岗第 86 行的话术）。

**预估存量违规数（门岗上线即冻结的 baseline）**：
- `src-no-import-electron`：**131**（62 type-only + 51 value）
- `electron-no-import-src`：**0**（硬零，无需 baseline）
- `src-no-import-scripts`：**0**
- `no-new-static-circular`：**37**（软的 499 个 lazy 环**不进**，避免门岗永红被无视——这是 R17 注释里"被忽略的门岗等于不存在"的教训）

**进 gates 链的位置**：放在 `check:heavy-path` 与 `lint:ci` 之间（都是结构性静态门岗，depcruise 跑全图约需十几秒，与 typecheck 同量级；排在 build/test 前，快速失败）。package.json `gates:contracts` 链里加 `check:boundaries`；`check-gates-chain.mjs` 会自动要求它可达（无需豁免）。

**加规则的纪律（R17 铁律）**：上线前**必须先验它会红**——故意加一条 `src/foo.ts → electron/bar.ts` 的新 import，确认门岗报红、且不在 baseline 里；再验修掉一条 baseline 违规后门岗要求同步删行。

### b) 模块归属地图（"一功能一个家"代码版）

**放哪**：新建 `docs/architecture/module-ownership-map.md`（`docs/architecture/` 目前无此文件；用 `docs/README.md` 现有的 `audit/` 同级链接机制挂上——README 是策展文件，本审计不代改，交付时由 owner 一行链接）。**不放 CLAUDE.md**（那是 L1，地图属 L2 触发才查）。

**结构**（每职能一行，指定唯一 canonical 家 + 允许的卫星）：

```md
| 职能 | Canonical 家（唯一真源） | 允许的卫星 | 禁止 |
|---|---|---|---|
| 模型档案定义 | electron/shared/videoCapabilities（video）+ src/config/modelArchetypes（image/3D）| —— | 新增 re-export 壳（现存 29 个进清零清单）|
| 跨进程契约/类型 | electron/shared/contracts/（**待建中立层**）| —— | src 直捅 electron/*/…Contract.ts |
| 目录存储/生命周期 | electron/catalog | —— | 渲染层直引 catalog（走 bridge）|
| 定价/成本 | electron/productionRun/catalogPricingResolver（唯一算价）| src spend/ 只做展示格式化 | 渲染层重新 derive 价格数值 |
| Onboarding UI | src/ui/onboarding | —— | 供应商专属逻辑混进 UI（挪 config）|
| 供应商适配 | electron/providerAdapter | —— | 与 catalog/certification 直环 |
```

配一张 **依赖方向图**（允许的层间箭头：`UI → bridge → electron`；`UI → design/i18n/utils`；`electron → contracts`；**禁** `UI → electron 直连`、`electron → UI`）。

### c) CLAUDE.md / L2 规则改动（只给 diff 提案，不直接改）

CLAUDE.md 是策展文件，以下**仅提案**，等 owner 拍板。核心只加一条 always 层原则（其余进 L2 `engineering-rules.md`）：

**提案 1 — CLAUDE.md 规则索引新增 R21（一行入 L1 表）**：
```diff
 | R20 | 造轮子前先过 build-vs-buy 闸 | … |
+| R21 | 分层边界不许反向/循环 | 渲染层禁直捅主进程（走 bridge/中立契约层）、主进程禁反向 import 渲染层、禁新增完全静态循环；`check:boundaries` 棘轮（baseline 只减不增），加规则先验会红。详见 L2 |
```

**提案 2 — CLAUDE.md P1 补一句（加新必删旧 · 疤痕组织）**：
```diff
-**P1 加新必删旧** — 引入新实现时同 commit 删旧实现，无并行版、无 fallback、无逃生口。
+**P1 加新必删旧** — 引入新实现时同 commit 删旧实现，无并行版、无 fallback、无逃生口。**搬家不留转发壳**：把 X 从 A 挪到 B 时，同 commit 改所有 import site，不留 re-export 壳当垫片（现存 29 个 `src/config/modelArchetypes` 壳即反例）。
```

**提案 3 — `docs/engineering-rules.md` 新增 R21 详解**（L2，含：宣言→目录映射表、`check:boundaries` 用法、中立契约层 `electron/shared/contracts/` 的建立指引、37 硬环与 131 越界的清零路线）。

---

## 分析六：重组路线分期（按 收益/风险 排）

**总原则**：第一期纯加门岗+地图（零搬迁、零风险、当场止血）；搬迁类**必须等在途大线合入**——`generationCanvas/agent`、`electron/capabilityCore`、`electron/productionRun`、`src/workbench/ai` 被 **#223 Agent 宿主**重度触碰（该分支 delta：`capabilityCore` 160 文件、新 `projectAgentHost` 61、`productionRun` 41、`workbench/ai` 38、`generationCanvas/agent` 36）；`electron/catalog`、`src/config/modelArchetypes`、`electron/shared/videoCapabilities`、`electron/providerAdapter` 被 **#241 供应商扩充**重度触碰（该分支 delta：`catalog` 44、`modelArchetypes` 14、`providerAdapter` 8、`videoCapabilities` 7）。**在这些区搬文件 = 冲突地狱。**

### 第一期（立即做 · 零搬迁零风险 · 纯止血）
- 上线 `check:boundaries` 门岗，baseline 冻结 131 越界 + 37 硬环（**只锁不搬**，从此不再恶化）。
- 落地"模块归属地图" `docs/architecture/module-ownership-map.md`（写清 canonical 家，新代码有据可依）。
- **附带小修（不碰冻结区）**：把 `public/tailwind.generated.css` 从 git 追踪移除 → 改为 build 产物 `.gitignore`（消掉 churn 榜第 4 + 一处 merge 冲突面 + C2 里的假共变）。
- 收益：高（止住恶化、给新代码定规矩）；风险：极低。

### 第二期（#241 合入后 · 拆"目录三家" + 建中立契约层）
- **前置**：等 #241 供应商扩充合入（否则撞 catalog/archetypes/videoCapabilities）。
- 建 `electron/shared/contracts/`（renderer+main 都可 import 的中立层），把 62 条 type-only 越界的目标类型迁进去 → 消掉大半 `src→electron`。
- **清零 29 个 re-export 壳**：统一 video 档案的 canonical 家，改 import site（配 P1 提案 2），删壳 → 消掉 30 条 value 越界。
- 收益：高（直击"改一个模型动一圈" + "目录三家"）；风险：中（需 #241 落地 + 全量走查供应商接入闭环 R16）。

### 第三期（#223 合入后 · 解 electron 硬环 + C1 巨簇解耦）
- **前置**：等 #223 Agent 宿主合入（否则撞 capabilityCore/productionRun/workbench-ai/canvas-agent）。
- 拆 `integrationSession.ts`（1696 行）+ 打断 `providerAdapter ↔ catalog ↔ integrationCertification` 的 37 硬环（引契约/事件反转依赖，`electron/runtime.ts` 从 18 个硬环里退出）。
- 收益：高（消真·加载顺序风险 + C1 头号病灶）；风险：中高（改主进程核心链，须逐项等价性 + 真机走查）。

### 第四期（长线 · generationCanvas 软环瘦身）
- 拆 `BaseGenerationNode.tsx`（713 行分发巨壳）+ 收敛 `nodes/{controls,render,adapters}` 低内聚子目录 + 打断 499 个软环里最缠的 model↔nodes 回边。
- 收益：中（认知负担/"找半天"，非运行期风险）；风险：中（画布是体感重区，须 J1-J5 走查）；**体量最大（429 文件/76k 行），最后做，可切片渐进。**

---

## 附：方法与可复现

- 共变：`git log --no-merges -300 --name-only`，过滤 + pair 支持度 + 连通分量（临时脚本已删，逻辑见分析一）。
- Import 图：`depcruise --config … --output-type json 'src/**/*.{ts,tsx}' 'electron/**/*.ts' 'workers/**/*.ts'`（`tsPreCompilationDeps:true` 含 type-only 边；dynamic 边单独标记以分软硬环）。1564 模块，667 违规（536 circular + 131 src→electron）。
- 内聚：按目录聚合内部/外部边，比值 = internal/(internal+outgoing)。
- 巨壳趋势：`git show <Aug1>:scripts/check-file-sizes.mjs` 对比 ALLOWLIST。
- 冻结区：`git diff --name-only main...<#223分支>` 与 `<#241分支>` 目录直方图。
