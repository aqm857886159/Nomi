# 生成链路的「派生事实」各算各的：结构评审（症状簇触发，2026-09-26）

触发：`check:symptom-cluster` 在 `2026-09-26-generation-variant-single-owner` 这份合同落盘后报四个模块 7 天内合同过密——
`src/workbench`（63 份）、`electron/capabilityCore`（24 份）、`electron/shared`（20 份）、`electron/productionRun`（16 份）。
R21 要求第三份合同出现后先回答「这一层的结构有没有问题」，再继续修。

## 放在一起看（只看和「生成时用的是哪一个」有关的那一族）

| 合同 | 那一刻用户看到的是假的什么 | 各算一遍的那个派生事实 |
|---|---|---|
| `2026-09-24-draft-shot-dispatch-honesty` | 「先别生成」的草稿挂「排队中」 | 这一镜派没派出去 |
| `2026-09-25-canvas-generate-ignores-production-shot`（#875） | 排队中的镜，画布还能再发一次 | 这一镜现在归谁生成 |
| **`2026-09-26-generation-variant-single-owner`（本次）** | 卡上写 Fast，派出去是 standard（更贵） | 这一次生成跑哪个变体 |

三份修的对象不同，形状一样：**同一份输入（模型档案 + 节点 / 候选），渲染层与宿主各自推一遍「用哪一个」，推法不同**。
本次那个事实有九份副本：画布节点（`src/workbench/generationCanvas/nodes/controls/archetypeMeta.ts`）、Agent 落节点
（`src/workbench/generationCanvas/agent/plannedNodeMeta.ts`）、付费卡（`src/workbench/ai/v4/spendCardDraft.ts`）、宿主候选归一
（`electron/capabilityCore/mcpGenerationVideoResolve.ts` 三处）、准入（`electron/capabilityCore/modelAdmissionSchema.ts`）、
目录候选（`electron/shared/videoCapabilities/registry.ts`）、推荐与模式面（`electron/shared/videoCapabilities/recommendation.ts` 三处）、
参数特化（`electron/shared/modelArchetypes/index.ts`）。付费卡的输入经 `electron/productionRun/productionPendingSpend.ts` 投影。
渲染层那份早就写着正确规则（「绝不能用基础串反推变体」），宿主那份从 PR #124 起就反着推——两边没有一个共同的读口，
所以谁也不知道对方的规则是什么。

## 结构结论

问题不在任何一个模块内部，而在**两台生成发动机之间**：画布 runtime（引擎 A）与 capabilityCore / productionRun（引擎 B）
对同一次生成各自做「解析档案 → 选变体 / 模式 / 参数面 → 算出站 model」。每一步都有人在引擎 B 侧补一份，
而对等矩阵（`electron/parity/`）的引擎 B 驱动又跳过了宿主的候选归一，于是「宿主按哪个变体派」从来没进过矩阵——本次它一直是绿的。

## 本次做了什么（结构层面）

1. 把规则提成共享叶子模块 `electron/shared/modelArchetypes/variantResolution.ts`，九份副本全部改为委托、删掉旧实现；
   在 `docs/engineering/concept-owners.json` 登记「一次生成跑哪个变体」，owner = `resolveArchetypeVariant`。
2. 对等矩阵的引擎 B 驱动补上真实宿主的候选归一（`normalizeVideoCandidate` + `deriveUsableVideoModelCandidates`），
   并加一条 Seedance 默认变体用例——旧代码上 5 个宿主入口当场报 `body.model` 分裂，修后十个入口逐字节一致。
3. 新增类测试：真实内置目录里每一条带变体的视频行，画布显示 === 宿主派发、出站 model === 该变体 key。

## 建议（不在本 PR 实施）

1. **两台发动机合一**（协调交接 §3 第 3 块）：引擎 B 的「解析档案 → 选变体 / 模式 / 参数面」应当直接调用与画布相同的函数链，
   而不是各写一份再靠对等矩阵事后抓。本次只收了「变体」这一环；「模式」（`videoModeForPlan` vs `currentArchetypeMode`）与
   「参数面」是同一类，下一个出事的大概率在那里。
2. **矩阵驱动不许再绕过宿主步骤**：引擎 B 驱动每少走一步真实宿主流程，那一步的分裂就进不了矩阵。
   建议给驱动加一条自检：驱动调用的宿主函数清单与 `generationEntrances.ts` 登记的 dispatchSite 路径逐项对照。
3. **「第二个 owner」门岗**（协调交接 §3 发版后议题）：对 `concept-owners.json` 登记过的概念，AST 扫描同形写法
   （如 `variants.find(... defaultVariantId)`）出现在 owner 之外即红。
