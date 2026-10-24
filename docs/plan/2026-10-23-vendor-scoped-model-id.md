# 设计卡：型号名按供应商作用域解析，共享档案不覆盖供应商的型号名（F-landing-defaults PR-c）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：宿主归一与画布发出都保留（供应商, 该供应商目录里的 modelKey），共享档案只给参数   线：F-landing-defaults   类别：[花钱][其他]
```

背景：调研报告 R-runway-wan3（协调私有区）+ PR-a 特征测试发现的那 3 格。共享档案（Seedance 2 / Wan 3.0 / Veo 3.1 / Kling 3.0 / HappyHorse / MiniMax H3 / Nano Banana / Seedream / GPT Image 2……）里写着**某一家**供应商的型号名（`catalogModelKey`、`variants[].modelKey`、`modes[].modelEnum`），宿主归一和画布发出把它们当成所有供应商的型号名用：
- 宿主 `videoCandidateForPlan` 把候选 `modelId` 改写成档案的 `catalogModelKey`（Runway `wan3` → KIE `wan/3-0-video`），Agent 路本地报 Unknown model；
- `videoTransportModelIdForPlan` 取档案变体 / 方式的型号名（Runway `seedance2_fast` → `bytedance/seedance-2`，Runway `veo3.1` → `veo3.1-fast`）；APIMart `kling-v3` 的候选 `transportModelId` 也是 KIE 的 `kling-3.0/video`（今天被 APIMart 映射的固定型号盖住，潜伏）；
- 画布发出 `buildArchetypeInputParams` 无条件把变体 / 方式的型号名塞进 `request.params.model`（Runway 请求的 `extras.model` 带着 `wan/3-0-video`）；
- 变体条：Runway 的 `seedance2` 行显示 KIE 的标准 / Fast / Mini 三个变体，选了就发 KIE 的型号名。

用户 2026-10-23：**通用修复，不许针对某个型号或某家供应商打补丁。**

## 验收清单（实现前写）

入口（door-map，2026-10-23 @1c7e10d2c）：
- 宿主归一：`videoCandidateForPlan` 2 扇（`mcpGenerationTools`、`mcpGenerationVideoResolve`）、`videoTransportModelIdForPlan` 1 扇、`normalizeVideoCandidate` 5 扇（`mcpGenerationMultiShot`、`mcpGenerationPreview`、`mcpGenerationTools`、`mcpGenerationVideoResolve`、parity 夹具）、`normalizeAuthoredCandidate` 2 扇（`generationPlanPatch`、`mcpGenerationTools`）；
- 档案解析：`resolveArchetypeForModel` 24 扇读（画布、付费卡、分镜、准入、宿主计划补丁……）、视频候选表 `buildVideoModelCandidates`（`registry.profileFor`，另一个档案解析口）2 扇；
- 画布发出：`buildArchetypeInputParams` 的 `model` 注入（`archetypeMeta.ts`）。

| # | 入口 | 检查（反例 → 期望） | 量具 |
|---|---|---|---|
| c1 | 宿主归一（Agent 起草 / 补丁 / 多镜封印 / 预览 / 门禁全部经 `normalizeVideoCandidate`） | 任一内置供应商的任一视频目录行：归一后 `providerId` 不变、`modelId` 仍是**该供应商目录里**的一行（Runway `wan3` 不再变成 `wan/3-0-video`） | 类级矩阵测试 |
| c2 | 宿主发出型号 `transportModelId` | 只取该供应商作用域里的型号名；共享档案里别家的型号名一格都不出现 | 类级矩阵 + 假上游真请求体 |
| c3 | 画布发出 `request.params.model` | 同 c2：别家的型号名不进请求 | 假上游真请求体 |
| c4 | 变体条 / 方式条（`resolveArchetypeForModel` 全部读者） | 供应商不认档案型号名的行，不出别家的变体选项（Runway `seedance2` 不再显示 KIE 的三个变体） | 单测 |
| c5 | 型号名真正认档案的行（APIMart Seedance 2.0 / Veo 3.1 / Vidu Q3 / Hailuo 2.3 / Qwen、KIE Seedance 2 / Wan 3.0 / HappyHorse / 图片拆 id 的模型、Dreamina、火山） | 行为一字不变：变体、方式型号名、请求体与改前相同（`variantResolutionParity`、PR-a 的 `landingProjectionParity`、对等矩阵照旧全绿） | 现有 parity |
| c6 | Agent 路 Runway Wan 3 / Seedance 2 ×3 / Veo 3.1 ×2 | 编译不再报 Unknown model；请求体命中 Runway 目录自己的映射（`/v1/text_to_video`，`model: wan3`），不再落到通用路径 | 假上游真请求体 |
| c7 | 旧草稿 / 旧节点 | 存量候选里已经被改写成别家 key 的（`runway / wan/3-0-video`）：归一时按「该供应商目录里没有这一行」处理——见下面「要拍板」 | 单测 |
| c8 | 类级门岗（新加供应商 / 档案自动纳入） | 遍历「全部内置供应商 × 全部目录行 × 档案每个方式 × 每个变体」：候选 modelId、transportModelId、画布 `params.model`、两条路的请求体型号，任何一格出现**别家作用域**的型号名就红 | `electron/parity/vendorScopedModelId.matrix.test.ts` |
| c9 | 结构 | 代码里不出现任何供应商 / 型号名的特判分支；共享档案上的型号名只经一个「按供应商作用域解析」的函数被读 | 读码 + door-map 计数写进合同 |

## 要拍板（发协调）

见给协调的消息：A（供应商映射说了算）/ B（档案声明归属）/ C（型号名搬进供应商目录）。

## 拍板结果（协调 2026-10-23，用户此前交代「通用修复」）

- 方案 **A**：供应商映射说了算。目录层按每一行映射（与发送同一个 `selectTaskMapping` 选法）的请求体模板是否读 `request.params.model` 派生「型号名来源」（唯一计算处 `electron/catalog/modelNameSource.ts`）；`resolveArchetypeForModel` 与宿主视频候选表 `buildVideoModelCandidates` 共用 `scopeArchetypeModelNames`；不接受的行档案只给参数（变体轴、方式 `modelEnum`、`catalogModelKey` 全部去掉）。
- 存量草稿里已被改写成别家 key 的候选：拒绝、让 Agent 改选，不猜。
- 「参数准入」概念命中、文件本身不热、改法是换：协调代批，方向检查 `docs/audit/2026-10-23-vendor-scoped-model-id-direction-check.md`。

## 修前 / 修后

- 类级矩阵 `electron/parity/vendorScopedModelId.matrix.test.ts`：修前（base 解析口）559 格里 236 格红——22 行（Runway 13、APIMart 6、fal 2、MiniMax 1），含潜伏的 APIMart `kling-v3` / `gpt-image-2*` / `doubao-seedream-4.5` / `gemini-2.5-flash-image-preview`；修后 435 格全绿（不接受档案型号名的行没有变体轴，格子变少）。
- 现有 `variantResolutionParity`、对等矩阵、`modelSpecParity` 照旧全绿（接受档案型号名的行行为不变）。

## 后续（不在本次）

- **C：型号名整体搬进供应商目录**（这家这一行、这个变体、这个方式发什么），D2 之后再议；本次 A 是它的第一步（型号名的家已经是供应商映射）。
- 宿主视频候选表（`registry.profileFor`）与通用解析器 `resolveArchetypeForModel` 仍是两个解析口（已共用收窄函数），合并另立。
