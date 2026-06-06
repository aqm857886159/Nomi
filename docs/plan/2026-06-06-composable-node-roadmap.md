# 梳理 + 路线图：生成节点重构成「档案声明 + 通用原语组装」

> 用户拍板（2026-06-06）：模型切换 / 模式切换 / 加素材 / 参数设置都是**通用**的，把原来那套 bespoke 实现
> 更新替换成新模式。这是个大项目，本文是 Rule 4 执行总纲 + Rule 9 架构 + Rule 14 审计性梳理。
> 依据：Explore 全景摸底（见 §3 证据）。配套：`2026-06-06-reference-at-and-sources.md`（素材原语细节）。

## 1. 一句话目标 + 核心洞察

**目标**：生成节点 = 一层薄壳，**档案声明「要什么」（modes/slots/params），通用原语负责「怎么渲染/怎么填」**。
模型 / 模式 / 素材 / 参数四块全是可复用原语，加新模型/新功能 = 声明、不重写 UI。

**核心洞察（Explore 证实）**：原语**雏形已存在**——`ModeBar / ReferenceSlots / SettingsPopover / archetypeMeta`
已经是纯展示 + 档案驱动。所以这不是从头造，**主要是把并行/重复/白名单的 bespoke 收编进来**（规则 1）：
- 文本节点的 `TEXT_GEN_MODES`（写死在 composer）= ModeBar 的并行版。
- frame 单槽菜单（NodeParameterControls 内联 104 行）+ 源视频单槽（30 行）+ ReferenceSlots 数组槽 = **三套几乎相同的加素材 UI**。
- 参考槽「flat 启发式 + catalog + 档案 + 视频兜底」四来源在 UI 里 dedupe = 该只剩档案一条。
- 模型切换写双轨 meta（`modelKey/modelAlias` + `imageModel/videoModel`）。
- panorama 上传 `<input>` 直挂在 1406 行巨壳 BaseGenerationNode。
- 一堆 `node.kind === 'asset'/'panorama'/'text'` 白名单分支，本该「有档案就组装」。

## 2. 目标架构：一切皆档案

```
模型身份  ──► resolveArchetype ──► 档案（curated 或 onboarding 自动派生）
                                     │ 声明：modes[] / slots[] / params[] / resultView?
                                     ▼
节点薄壳  ──► 通用原语组装：
   ├─ ModelPicker      （选模型，复用 useModelOptions；单轨 meta）
   ├─ ModeBar          （模式切换，吃 archetype.modes）
   ├─ AssetReference   （加素材：AssetTile + AssetPicker + AssetMention，吃 archetype.slots）
   └─ SettingsPopover  （参数，吃 archetype.params）
```

两条对偶的「通用第一」：
- **能力层**：档案按模型身份认、与供应商解耦（已做，C0-C4）。
- **交互层**：原语与功能/模型解耦，谁用谁声明槽（本路线图）。

**关键收口**：onboarding 自接的模型，落库时**顺手派生一份档案声明**（把现有 flat 启发式 `parameterControlModel`
跑一次产出 archetype，而非每次渲染时跑）。这样 **UI 端永远只有档案一条路**，`resolveRenderedControls` 的
「档案 vs flat」分叉消失。

## 3. 现状盘点（Explore 证据）

**可直接复用（保留/作地基）**
- `@cfg/useModelOptions.ts`：唯一模型数据源（含档案注入）。
- `@cfg/modelArchetypes/*`：档案声明本身 = 目标形态。
- `@v2/nodes/controls/{ModeBar,ReferenceSlots,SettingsPopover,archetypeMeta}`：**四个原语雏形**，已纯展示+档案驱动。
- `render/CardCommon.UploadFallback`、`assetUploadApi.importWorkbenchLocalAssetFile`、`adapters/assetImportAdapter`：素材最小件。

**要替换 / 收编（bespoke、重复、白名单）**
- `NodeGenerationComposer` L18-140 `TEXT_GEN_MODES` → 文本档案 + ModeBar。
- `NodeParameterControls` L286-622 frame 单槽菜单 + 源视频单槽 → 并进 AssetReference。
- `NodeParameterControls` L347-360 四来源 dedupe → 只剩档案。
- `NodeParameterControls` L150-213 + L417-468 模型切换/双轨 meta → ModelPicker 原语 + 单轨。
- `parameterControlModel` flat 启发式 → 迁到「onboarding→档案」桥，UI 不再吃。
- `BaseGenerationNode` L1028/L1213 panorama 上传 + L730/L749/L824 白名单 → panorama 档案 + 「有档案就组装」。
- `modelOptionsAdapter` ~10 个未消费 API → 删（死代码）。

**不属于本次（留意，别误伤）**
- `NodeImageEditToolbar`/`useNodeImageEditing`（结果裁剪/旋转）= 结果操作，非素材输入。
- `Scene3DEditor`/`scene3d/*` = 3D 自成体系（模型/参数原语仍适用，素材不归一）。

## 4. 分阶段路线图（每阶段独立可发，CI 五门绿 + 用户可见走 Rule 8/13）

- **P0 通用素材原语**（新建，本来就要做）：`src/workbench/assets/` 的 AssetTile / AssetPicker（画布+项目素材[搜索+最近+全部]+上传+拖入）/ assetPool / AssetMention（@，先查 Tiptap）。生成参考作第一个消费方。
- **P1 参考槽归一**：frame 单槽 + 源视频 + 数组槽 三套 → 一套 AssetReference（吃档案 slots，支持单/数组/边连）。删 NodeParameterControls 内联 104 行 + 源视频 30 行；panorama 上传也并进来。**净删大量重复**。
- **P2 模型切换原语**：抽 `ModelPicker` + `applyModelSelection(meta, option)` 纯函数；双轨 meta（imageModel/videoModel）收单轨（modelKey/modelAlias），runtime 读取处同步。删 modelOptionsAdapter 死 API。
- **P3 文本节点档案化**：text 建 archetype（modes=[续写/改写/重写]，slots=[选中文本]，params=文本模型参数）；删 composer 里的 TEXT_GEN_MODES bespoke，文本节点改用 ModeBar + SettingsPopover。
- **P4 onboarding→档案桥**：自接模型落库时派生 archetype（flat 解析跑一次）；`resolveRenderedControls` 删「档案 vs flat」分叉，UI 单源。flat 启发式代码迁桥里。**最难，onboarding 模型必须零回归**。
- **P5 节点壳收编**：BaseGenerationNode 白名单分支 → 「有档案就组装 composer」；panorama 档案化；巨壳净减（Rule 12 棘轮）。

依赖：P0→P1（参考归一靠素材原语）；P2/P3 相对独立可并行；P4 是收口前置（P5 的「有档案就组装」依赖 P4 让所有模型都有档案）。

## 5. 风险 / 回滚 / 验收门

- **回滚**：每阶段「先加新原语旁路 → 验证 → 切换 → 删旧」；旧路保留到新路走查通过才删（规则 1 的「不敢删就别 ship」反过来：敢删因为有走查 + 测试兜底）。
- **最高风险 P4**：onboarding 自接模型量大、形态杂。桥要对现有 catalog meta 全形态兼容（含 legacy sizes/ratios/durs 兜底）；上线前用真实 onboarding fixture 跑回归。
- **Rule 12**：这轮重构应让 NodeParameterControls（649）+ BaseGenerationNode（1406 巨壳）**净减**——收编重复 = 还债，基线只减不增。
- **验收门**：每阶段 CI 五门（filesize/lint/typecheck/vitest/build）+ 用户可见改动 Rule 8 样张对账 + Rule 13 零额度走查（真渲染样张并排比）；自跑设计师+用户 agent 评审（已成默认纪律）。
- **真实生成**（花额度）仍 KIE_API_KEY 门控、先问用户。
