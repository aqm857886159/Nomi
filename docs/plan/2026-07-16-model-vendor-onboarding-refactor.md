# 模型/厂商接入体系改造方案（分析 + 分期计划）

> 状态：**分析稿，未动代码**。用户 2026-07-16 决定：只出分析、节奏自定；用户侧接入 UX 排后续独立轮次。
> 方法：workflow 12-agent 深挖（6 路体系剖析 + 2 路开源对标 Vercel AI SDK/LiteLLM/OpenRouter/Cline + 3 方案 + 综合）→ 关键断言逐条人工核实（见「证据」）。
> 分支：`feature/model-config`。

---

## 1. 问题（用户原话）

> 「现在厂商接入太复杂了，有什么比较好的改造方案吗，然后接入的模型又太多太杂。」

拆成两件事：**① 厂商接入太复杂**（开发者侧：加一家要改很多处）、**② 模型太多太杂**（同一模型多入口、列表臃肿、去重不稳）。

---

## 2. 根因：runtime 已数据化，病在「三套互不相认的 authoring 面 + 一个 god-file + 赌 label 去重」

**Nomi 的运行时是对的**——`runtime/requestPipeline/vendorHttp` 全靠数据（`HttpOperation`/`Mapping`/`ParamMap`）分派，全仓 grep 不到 `if (vendorKey==='xxx')` 硬分支（P4 已兑现）。**复杂不在运行时**，不需要「把代码变数据」——runtime 已经是数据驱动。

真正的病在上游的 authoring 层：

| authoring 面 | 职责 | 加一家/一个模型的动作 |
|---|---|---|
| `electron/catalog/*`（51 非测试文件 / 7500 行） | 每家手写 `HttpOperation` 配方 + `*_VENDOR_SEED` + `*_MODELS` | 建 ~10 个文件；OpenAI 兼容的 `/v1/images/generations` 每家重抄 |
| `src/config/modelArchetypes/*`（38 文件 / 2300 行） | 每个模型族的 UI 控件默认 + canonical 参数，靠裸字符串 `archetypeId` 关联 | 再建一份 + 登记进 `index.ts` 巨长数组 + 重跑 `archetypeWireDefaults.generated.ts`（609 行 codegen 镜像）否则门岗红 |
| `electron/ai/modelProfiles.ts` | chat 模型的温度/max_tokens/extraBody quirk（第三处） | 又一处 |
| ↓ 全在 `electron/catalog/seedBuiltins.ts` god-file 里 import 拼装 | 内置厂商注册总枢纽（fan-in） | **6-7 处彼此有先后依赖的散点编辑，漏一处静默不生效** |

**"太杂"的机制**：每家厂商各 seed 一份 catalog 行，去重只能靠**赌 `labelZh` 字符串精确匹配**（`modelIdentity.ts` 定义了 priority-1 键 `canonicalModelId`，却**没有任何 seed 填它**）→ label 稍漂就不合并、撞了又错误合并；设置面板按 `vendorKey` 平铺 → 同一个模型出现 4-5 次。

---

## 3. 证据（关键断言均人工核实，file:line）

| # | 断言 | 证据 | 核实 |
|---|---|---|---|
| E1 | runtime 无厂商硬分支，配方是数据 | `electron/catalog/types.ts`（`Vendor`/`Model`/`Mapping`/`HttpOperation`）+ `agnesImages.ts` 的 `imageCreateOp` 工厂即 `{{...}}` 模板 | ✅ 读过 |
| E2 | 同一模型多入口（"太杂"核心） | **Seedream** seed 于 `apimartImages`/`kieSeedream`/`runninghubImages`/`volcengineImages` = **4 入口**；**Seedance** 于 apimart/kie/dreamina/runninghub/volcengine = **5 入口** | ✅ grep |
| E3 | `seedBuiltins.ts:261` 是 **10-typeof 手写联合**，加一家要塞一个 typeof | `function seedVendor(vendors, seed: typeof KIE_VENDOR_SEED \| typeof APIMART_VENDOR_SEED \| ...（10 项）)` | ✅ 读过 |
| E4 | **anthropic profile 漏挂 bug** | `buildAiSdkModel.ts:111-118` anthropic 分支创建 provider **没挂** `fetch: buildProfiledFetch(modelId)`，而 openai-responses(:128)/openai-compatible 都挂了 → `modelProfiles`（含刚修的 max_tokens 逻辑）对 Claude 系模型静默失效 | ✅ 读过 |
| E5 | **`canonicalModelId` 全仓无 seed 填** | grep 只命中 `modelIdentity.ts`（定义+消费）、其 test、一份 plan 文档；`electron/catalog/*` 零填充 → priority-1 去重键形同虚设 | ✅ grep |
| E6 | `catalogStore.ts` 的 `BUILTIN_VENDOR_KEYS` 已与真实内置集脱节（缺 agnes/dreamina/replicate/comfyui-local），靠「迁移早于 seed」时序侥幸避雷 | 对照 `seedBuiltins.ts` 实际 seed 10 家 | ⚠️ workflow 断言，待 Phase A 落地时复核 |

**重复量化**（workflow）：per-vendor 脚手架（`CREATE_HEADERS` 常量、本地重声明的 `{modelKey,labelZh,archetypeId,mappings}` type、`imageModel/videoModel` 工厂、mapping-builder）约 **300+ 行同构**，真信息量只占 30-50%。

---

## 4. 三套候选方案对比

| 方案 | 核心 | 用户/开发者看到 | 代价 | 裁决 |
|---|---|---|---|---|
| **① Descriptor 终局** | 一张 model descriptor 表 + 一撮 transport 模板，塌掉 per-vendor 文件 | 加一家=填 1 行；同模型只出 1 次；截断预算读真实 limits | 最大：跨 rootDir 共享硬骨头、609 行 codegen 要迁、一次性大重构对 solo 危险 | 终局对（onboarding 5 分），但别一次性做 |
| **② Compat 主干 + Adapter** | 绝大多数中转本是 OpenAI 兼容 → 兼容主干做厚，特殊才落 adapter | 同上去重；两条接入路径合一 | 抽兼容工厂易抹平真 quirk（agnes int、volcengine watermark、各家 response 路径）；捆用户侧 UI 大改 | 传输层洞见最对——采其形状 |
| **③ 分期务实** | 低垂果实 → 统一 descriptor → 收敛 transport，每期可独立交付/回滚 | 前期几乎无可见变化，内部减负 | 最低：风险最大的传输层放最后 | 节奏最贴 solo——采其骨架 |

各方案自评分（onboarding简化 / 去重 / 低迁移成本 / solo契合，满分5）：①=5/4/2/4　②=5/4/3/4　③=3/4/4/4。

---

## 5. 推荐路线：③ 的节奏 + ① 的靶子 + ② 的传输层形状

**为什么融合而非选一套**（底层逻辑，贴四条真实约束）：

1. **solo + god-file 高争用** → `seedBuiltins` 常被 20+ worktree 并行 clobber，爆炸半径必须最小、每期能独立 push/回滚。方案①的一次性 6 阶段大重构对 solo 太重（其自评 lowMigrationCost=2）。→ 采**③的步子**。
2. **③自己的终局太保守**（止步「注册表数组」，没到「填一行 descriptor」）。→ 拿**①的 descriptor 当靶**，用③的节奏走过去。
3. **传输层是最大风险区**。方案②点破关键结构事实：多数中转本就是 OpenAI 兼容、Nomi 早有 `newapiTransport` 这条通用主干（用户自接中转零改代码）→ **不必抽象 5-8 个 transport 模板**（有变新巨壳的风险），而是把 compat 主干做厚、只让即梦 CLI / 火山语音三头 / runninghub workflow 这类**真不兼容**的落 adapter。→ 采**②的传输层形状**。
4. **护城河纪律**：`archetype` 是生成模型（视频/图/3D/TTS）的能力描述，AI SDK/LiteLLM/OpenRouter 的 **chat schema 覆盖不到**，绝不为对齐 registry 而弱化它。广度是敌人（D2）：descriptor 只沉淀真接的几十个模型，中转长尾继续走 onboarding 动态发现，不进策展表。

---

## 6. 分期计划（每期独立可交付 / 可回滚 / 过五门）

### Phase A — 低垂果实（零/低风险，立刻减负；不碰 runtime/UI）
- **A-1 修 anthropic profile bug**：`buildAiSdkModel.ts:111-118` 补 `fetch: buildProfiledFetch(modelId)`。**关系到上一个 PR**：max_tokens 截断修复对 Claude 系模型此前静默失效。加 anthropic-kind 单测。
- **A-2** `BUILTIN_VENDOR_KEYS` 改从 seed 集派生（治 E6 脱节）。
- **A-3** 删 `OnboardingWizard` 死 state `inputMode` + 恒真分支；修 `VendorOnboardCard` 注释/实现矛盾。
- **A-4** 抽共享 `CREATE_HEADERS` + canonical `CuratedModel/CuratedMapping` type 进 `types.ts`，删 ~9 份本地重声明 type + ~10 份重复常量（同 commit 删旧，P1）。
- **A-5** 给 ~11 个跨供应商逻辑模型的 curated seed 填 `meta.canonicalModelId`（**版本级**，如 `seedream-4.5`/`seedance-2.0`，非家族级），硬化去重不再赌 label。
- **验收**：五门全过 + `modelIdentity.test` 逐条断言 + `catalogMigrateV4/V5.test` 不误伤自建中转 + e2e smoke；anthropic profile body 不破坏官方 Messages API。

### Phase B — 注册表化 seed（塌 god-file，descriptor 雏形）
- 引入共享 `VendorSeed` interface，删 `seedBuiltins.ts:261` 的 10-typeof 联合。
- `applyBuiltinSeeds` 的 30+ 行散点 `seedVendor/reconcile` 换成 `BUILTIN_VENDORS` 数组 + 单循环（**保留 prune→repair→reconcile 时序**）。
- 两套 Shape（A 嵌套 mappings / B 扁平导出）合并成一套。
- descriptor 补字段：`mode` 枚举 + `aliases[]` + **真实 `maxOutputTokens`**（治拆镜头 max_tokens 靠猜的根因）。
- **验收**：`seedBuiltins.test` 幂等 + **每条现有 op 的 create/query 序列化 golden 快照逐字节一致**；**必须开独立 sibling worktree 钉 `origin/main` 落地**（防高争用 clobber/force-push，CLAUDE.md 并行纪律）。

### Phase C — 传输层收敛（方案②精华，风险区）
- `newapiTransport` 提升为共享 compat transport；OpenAI 兼容家（agnes/apimart/modelscope/volcengine-image）改吃它 + 只声明差异（端点/response 路径/字段名），删重复脚手架与 mapping-builder。
- 非兼容家（dreamina CLI / volcengine-speech 三头 NDJSON / runninghub workflow）落 `electron/catalog/adapters/` 注册表，由 `protocol` 字段驱动分派。
- **验收**：每家一次真生成 e2e（评测额度默认授权）+ golden 快照；quirk（agnes int、volcengine `watermark:false`、各家 response 路径）逐条对现有文件搬且对齐官方文档（R5）；同 commit 删旧 codec（P1）。

### Phase D — 可选/最后：合并 archetype + 文本路 middleware（碰热路径 + 护城河）
- 把 archetype `modes/params` 并入 descriptor 的共享数据边界，删 609 行 codegen 镜像 + 门 + 裸字符串 `archetypeId` 指针。
- AI SDK v4 `wrapLanguageModel + LanguageModelV1Middleware(transformParams)` 统一 body 加工，anthropic 也挂上（收编 A-1 的手写补丁）。
- **验收**：**AI SDK v4 API 名先实测确认**（锁 `ai ^4.3.19`，别照 v5/v6 文档抄，R5）；descriptor 落双方可 import 的纯数据 shared 边界否则 rootDir 问题换地方复现；同 commit 删旧 fetch 补丁 + kind-switch，无并行版。

### Phase E — 独立轮次：用户侧接入 UX 重设计（用户已决定排后）
- 合并厂商卡 + BaseURL 向导两条互斥路径成统一入口；`knownVendors` 与 `providerPresets` 合一（去 volcengine 重复）；未接入卡默认展开露 key 框；设置面板按 descriptor 视觉去重（同模型只呈现一次、收集 providers[]）。
- **验收**：**先出 HTML 样张 + 用户拍板（R8/D6）**，全绿≠完成；实现后逐项对账 + Playwright 真机走查（R13）；存量 `model-catalog.json` 兼容不破。

---

## 7. 待拍板的岔路（在各期边界决定，不阻塞 Phase A）

1. **Descriptor 载体**：TS-as-data（保留编译期 discriminated-union 校验，rootDir 共享靠纯数据 shared 边界）**vs** 纯 JSON（更贴 LiteLLM，但丢类型校验、只能 Zod+测试兜）。→ 倾向 **TS-as-data**（solo 少了类型安全网代价更高）。【Phase B 前定】
2. **Phase D 做多深**：媒体路 descriptor 到位即止（文本路 `modelProfiles` 维持现状）**vs** 也把文本路 middleware 化 + archetype 合并。后者动 AI SDK v4 热路径 + 触碰护城河能力表。→ 倾向**媒体路优先，Phase D 视前三期稳定度再定**。
3. **limits/max_tokens 数据化范围**：逐个对齐所有模型官方文档 **vs** 只填真接的几十个、其余留空走通用回退。→ 倾向**后者**（广度是敌人 D2；否则「猜 max_tokens」变「猜 limits」）。
4. **archetype 与 descriptor 关系**：能力形状并进同一张 descriptor（终局最干净但单条变胖）**vs** archetype 保持独立、descriptor 只加 `canonicalModelId` 桥接（更保守、去重根因已治）。→ 决定 Phase D 是否要做。

---

## 8.5 目标形态：能力优先的统一模型注册表（用户 2026-07-16 细化）

用户提出的目标交互，本质是 descriptor 终局 + Phase E 的**具体化**。关键发现：**这套逻辑 Nomi 已实现约 80%，散在四处未串成一条线**——要做的是「统一 + 硬化」，不是新造组件。

**现存机器（已核实）**：

| 目标环节 | 现状 | 文件 |
|---|---|---|
| 连接厂商→显示所有可用模型 | 中转 `/v1/models` 拉取 + `guessModelKind` 按 id 猜 image/video/audio/text | `electron/catalog/modelKindHeuristic.ts` |
| 用户配置显示/隐藏 | 每模型勾选启用/停用 + 搜索 + 批量 | `src/ui/onboarding/modelEnableEditing.ts` |
| 显示的模型进对应节点切换列表 | 图/视频节点切换器读「该 kind 下 enabled 平铺列表」 | `InlineParameterBar.tsx:56` |
| 切模型换配置参数 | archetype 驱动，已实现（`control.options`/`variantChoices`） | 同上 |
| 互不干扰 | 每模型自带 archetype 参数 → 天然独立 | 同上 |

**真正的缺口（只有三个）**：
1. **去重不可靠**——`canonicalModelId` 未填，「N 家」合并靠赌 label（= Phase A-5）。
2. **curated 与 relay 未统一**——`ModelEnableEditor` 偏中转；目标是任何厂商（内置策展 + 中转）都进同一个「按 kind 的启停主列表」，同一份数据喂「设置显示/隐藏」与「节点切换器」。
3. **陌生拉取模型没有精细参数**（唯一真难点，见下取舍）。

**唯一真取舍**：中转拉取的任意模型，**能力参数不在协议里**（`/v1/models` 只给 id，不给「吃 size/比例」）。
- **认得的模型**（有 archetype）→ 精细参数面板。
- **陌生拉取模型** → `guessModelKind` 猜类别 + **通用面板**（prompt + 基础项），给不出精细参数。

| 路线 | 用户看到 | 代价 | 裁决 |
|---|---|---|---|
| **X 全显示 + 分层参数** | 认得的给精细面板、认不出的给通用面板，都能先用 | 陌生模型参数弱，可手动补 | **推荐**——贴「互不干扰」+ D1「少配」 |
| Y 只显示认得的 + 手动加 | 参数都精细 | 不是「全显示」 | 备选 |

**逐条确认用户三点**：① 图片转 URL 逻辑不变（`assetLocalization`/`AssetIngestion` 正交，不碰）；② 该交互架构上已存在，做「统一 + 硬化」；③ 对话默认 OpenAI 协议（已是默认 `providerKind`，chat 无需 per-model 参数，最简单）。

→ **对分期计划的影响**：目标形态锁定为「路线 X 的能力优先统一注册表」。Phase A-5（填 `canonicalModelId`）是它的可靠去重地基；Phase B 的 descriptor 加 `mode/kind` 字段承载能力分类；「统一启停主列表 + 陌生模型通用面板」落在 Phase E（用户可见，需样张拍板）。

---

## 8. 不做项（诚实边界）

- **不重写 runtime**——它已数据化、是对的（P4 已兑现），本改造只塌 authoring 层。
- **不追 provider 广度**——不学 LiteLLM 全量 JSON / Cline 几十家 provider；descriptor 只沉淀真接的几十个，长尾走 onboarding 动态发现。
- **不为对齐 registry 弱化 archetype**——那是生成能力护城河，chat schema 覆盖不到。
- **本轮不碰用户侧接入 UX**（Phase E，用户已决定独立轮次）。

---

## 9. 已落地（本分支 `feature/model-config`）

- **卡头快捷删除厂商**（commit `a65ff4e8`，非分期项，用户 2026-07-16 顺手需求）：「已接入」自定义厂商卡加卡头删除图标（`FoldableModelCard.headerAction` 槽 + `vendorDeleteAction.confirmAndDeleteVendor` 共享函数，与 `CustomVendorManage` 删除按钮单一来源）。真机走查 7 项断言通过。
