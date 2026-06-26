# 模型选择弹窗治本：模型身份去重 + 供应商解析 + 中转导入闸

> 来源：2026-06-23 UX 体检 B7（用户点名「弹窗一大堆模型」）。用户拍板：① 去重后**自动选最优供应商+可点开切**；② 中转**只导认得的+其余折叠**；③ 本轮范围=模型弹窗+A 类清理。
> 根因（已查实，见 `docs/audit/2026-06-23-app-wide-redundancy-audit.md`）：不是模型多，是 (1) 同一模型被每个供应商各列一份、系统按字符串名去重认不出是同一个；(2) 接中转默认「一次拉全」；(3) 代码里有 archetype 身份但没接到弹窗。

## 核心设计：模型身份（canonical model id）

**去重键 = 版本级 canonical model id，不是 archetype（家族级）。** 反例：火山一家有 Seedream 5.0/4.5/4.0 三个版本同属 archetype `seedream`——按 archetype 去重会错误合并版本。

- **派生规则**：curated 模型的 `canonicalModelId` 默认 = 规范化 `labelZh`（火山「Seedream 4.5」与 apimart「Seedream 4.5」→ 同 id `seedream-4.5` → 合并；火山「Seedream 5.0」只此一家 → 独立）。规范化=去空格/大小写/全半角统一。
- **显式覆盖**：极少数同模型不同 labelZh 的，在 curated 定义加显式 `canonicalModelId` 字段兜底（`labelZh` 不可靠时的唯一真相）。先跑一遍现有 curated，列出 labelZh 冲突项，只给冲突项打显式 id（最小标注）。
- **认不出的中转模型**（无 curated 定义、无 archetype 匹配）：`canonicalModelId = 自身 modelKey`（不合并，独立显示）——它们本就是互不相同的未知模型。

**数据结构**：去重后一个「模型条目」= `{ canonicalModelId, label, kind, providers: Array<{vendorKey, modelKey, modelAlias}>, recognized: boolean }`。`providers` 收集所有能调它的供应商。

## 分层改动

### 1. 领域层 · 去重聚合（新，单一真相）
- 新 `src/config/modelIdentity.ts`：`deriveCanonicalModelId(item)` + `dedupeModelOptions(options): DedupedModel[]`，按 canonicalModelId 聚合 `providers[]`。
- 改 `modelOptionMappers.ts`：保留逐行 ModelOption（生成层仍需 vendor+modelKey），新增聚合视图供弹窗用。
- 去重发生在领域层，弹窗只消费聚合结果（分层：UI 不算身份）。

### 2. 供应商解析 · 自动选最优 + 可锁（生成路径）
- 新 `resolveBestProvider(dedupedModel, { lockedVendorKey? })`：优先级**官方厂商 > 中转**（vendor 有 `kind: 'official'|'relay'` 或从 known/preset 派生），同级取已验证可用/首接入；用户锁定则用锁定家。
- 生成时：节点存的是 `canonicalModelId`（+ 可选 `lockedVendorKey`）→ 解析成 (vendorKey, modelKey) 喂现有 `findExecutableModel`。**失败自动换下一家**（failover，复用现有错误透传）。
- 兼容：现有节点存的是 (vendorKey, modelKey) → 加载时映射到 canonicalModelId（迁移函数，幂等）。

### 3. 中转导入闸 · 只导认得的 + 其余折叠（onboarding）
- 改 `OnboardingWizard.tsx:183-185`「一次拉全默认全选」：拉到的模型按「能否匹配 canonical 身份/archetype」分两组——**认得的默认勾选**进主列表，**认不出的默认不勾**、收进「其他模型（N）」折叠区，可展开手动勾。
- 不丢任何模型（用户仍可全选），只是默认不再灌全量。

### 4. 弹窗 UI · 去重列表 + N家可用 + 点开切（共享组件，P1）
- 新共享 `ModelPicker`（去重后的轻量组织）：
  - 列表按 canonicalModelId 去重，每条标「N 家可用」（>1 家时）。
  - 选中=选 canonicalModelId（背后 resolveBestProvider）；条目可展开看/切供应商（锁定）。
  - 去重后列表已短一截，再叠：最近用置顶 + 按能力分节（复用 `ModelChipGroups` 分组）+ 顶部搜索（条目多时显示）。认不出的中转模型沉「其他」分节。
- **统一三处选模型心智（P1，消除并行版）**：画布节点 `InlineParameterBar`、分镜镜卡 `StoryboardShotCard`、AI 助手 `AssistantModelPicker` 全部换用共享 `ModelPicker`；「默认模型」空值项与智能排序统一到组件里（之前三套不一致）。

### 5. A 类清理批（与本轮一起，低风险）
- A8：删 `GenerationCanvas.tsx:499-566` 不可达「生成渠道」死面板 + 误导文案（无人 dispatch `nomi-open-generation-settings`，已查实）。
- A9：删 `ProjectLibraryStandaloneRoute.tsx`+`ProjectLibraryRoute.tsx` 死对（含 2 处违规 `window.confirm`）+ 收窄 `ProjectLibraryPage` 的 `templateId` 半残签名。
- A10：删 `tryNowExamples.ts`、`projectTabsStore.ts`、`WorkbenchAiHeaderActions.onModelIntegration` dead prop。
- A11：删 `OnboardingWizard` `inputMode` 恒真死分支 + 残留注释。
- A12：统一文字术语（菜单「标题/字幕」↔ 空态指引「字幕/标题卡」对齐到同一套叫法）。

## 不动项（本轮 non-goal）
- 不做顶栏 4 按钮减负（B 类，下轮）；不动 3D/站位/运镜（D 类）；不改 overlay 外壳（已判定语境定制非冗余）；不引第三方供应商路由库（自研够用，OpenRouter 仅借鉴心智）。

## 排期（切片）
- S1 领域层：`modelIdentity.ts` 去重 + canonical id 派生 + 单测（labelZh 冲突清单先跑出来）。
- S2 供应商解析 + 生成路径接入 + 节点存 canonicalModelId 迁移 + 单测。
- S3 共享 `ModelPicker` 组件 + 三处接入（P1 统一）。
- S4 中转导入闸（onboarding 分组默认勾）。
- S5 A 类清理批（A8-A12，可与 S1-S4 并行穿插）。

## 回滚
- 节点迁移幂等、可逆（canonicalModelId ↔ (vendor,modelKey) 双向）；去重纯派生，不改底层 catalog 存储；A 类是删死码，零行为影响。

## 验收门
- 五门全过（`pnpm run gates`）。
- 真机走查（R13）：① 接 2 个都有 Seedream 的供应商 → 弹窗 Seedream 只出现一次、标「2 家可用」、能点开切；② 接一个中转 → 认得的进主列表、杂牌进「其他」折叠默认不勾；③ 三处（节点/镜卡/助手）选模型 UI 一致；④ 选去重模型能真生成出图（自动选最优家 + 锁定家都验）。截图人眼判断。
- 不变量：同 canonicalModelId 全 App 唯一呈现；生成永远解析到一个真实 (vendor, modelKey)。
