# 方向检查：过期预演也挡花钱——挡住原因的词表跨进程抄了五份（第四轮，2026-10-16）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 触发：`fix-churn` 命中 `electron/capabilityCore/appIntegration.ts`（14 天第 16 个）、`appIntegrationCanvasShot.ts`（第 3 个）、`electron/agentLane/laneExtendedDesktopPorts.ts`（第 3 个）、`runner/` 目录（第 16 个）、`NodeGenerationComposer.tsx`（第 6 个）、`capability/directorPreviewBlocksOp.ts`（第 3 个）。
> 协调 10-16 定（「钱只花在用户以为的东西上」）：用户不点「出成片」、直接在视频节点上点 ↑，挂着的预演如果在手改之后已过期，和「渲染中 / 失败」一样挡住，提示先重渲，并给一键重渲出口；判据与「能不能出片」读同一份。

### 0. 一句话根因

「花钱闸为什么挡这一镜」的原因词表没有主人：渲染端写成 `'rendering' | 'failed'`，主进程准入在 `appIntegration.ts` 里把回包**白名单过滤**成这两个值，Agent 回执与测试工具各抄一份类型。加一个新原因（过期）要同时改五处；漏掉主进程那一处，新原因会被静默过滤成「不挡」，钱照样花出去。

### 1. 归类表

| 处 | 直接原因 | 类 |
|---|---|---|
| `appIntegration.ts` 准入回包 | `reason === 'rendering' \|\| reason === 'failed' ? reason : null`：认不得的原因 = 放行 | 跨进程词表抄一份 + 未知值放行（fail-open） |
| `appIntegrationCanvasShot.ts` / `canvasShotTestUtils.ts` | 准入依赖与测试桩的类型各写一份字面量 | 词表抄一份 |
| `laneExtendedDesktopPorts.ts` | Agent 回执的原因类型又写一份，并按值分支出话术 | 词表抄一份 |
| `NodeGenerationComposer.tsx` / `generationRunController.ts` | 原因 → 文案的三元式各写一份（`rendering ? … : failed 文案`），新原因会落到「失败」的话术 | 原因 → 文案映射抄两份 |

### 2. 为什么会一直出现

预演闸的判据收在 `directorPreviewState`（渲染端），但「挡住的原因」是跨进程合同，跟预演状态词表 `DIRECTOR_PREVIEW_STATUSES` 一样应该住 `electron/shared/director/`，主进程与渲染端都从那里取。现在每个消费者自己写字面量，主进程那份还写成了「认不得 = 放行」。

铁律对照：⑫「点了 = 以为的」——用户点 ↑ 以为用的是他刚改好的预演。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 渲染端判出「过期」，主进程准入把它过滤成 null，单镜 Run 照常提交，钱花在旧预演上 | `electron/shared/director/directorPreviewStatus.test.ts`：回包 `stale` 必须解析成 `stale`；未知原因必须按挡处理 |
| 下一个原因（比如「预演素材丢了」）再漏一处 | 同上（未知原因 fail-closed）+ 词表门岗 |
| 节点上点 ↑ 被挡时提示成「预演失败」，用户去点不存在的重试 | composer / runner 共用 `directorPreviewSpendBlockMessageKey` |

### 4. 靶子独立性检查

不涉及评测分数。测试走真画布 store、真预演写回（`applyPreviewCaptured`）、真渲染端处理函数（`directorPreviewBlocksOp`）、真单镜 Run 准入（`appIntegrationCanvasShot`）。

### 5. P0

花钱闸是领域（按镜头的花钱语义），不是通用能力；不引新库。

### 6. 补 / 换 / 删

| 选项 | 做什么 | 推荐 |
|---|---|---|
| 补 | 五处各加一个 `'stale'` | 否：下一个原因照样漏，主进程仍是「认不得 = 放行」 |
| **换（收口）** | 原因词表 `DIRECTOR_PREVIEW_SPEND_BLOCK_REASONS` 进 `electron/shared/director/directorPreviewStatus.ts`（与预演状态同一个家），主进程用唯一的回包解析 `parseDirectorPreviewBlockReply`：**认不得的原因按挡处理**（fail-closed）；原因 → 文案只有 `directorPreviewSpendBlockMessageKey` 一处；过期判据只有 `directorPreviewIsStale` 一处（花钱闸与「出成片」都用它） | **是** |
| 删 | — | — |

### 7. 用户要权衡的核心

已由协调定。只有一点如实标出：旧预演（本改动之前渲染的）没有渲染源指纹，**没有证据就不判过期**——照原样放行、照原样挂；本改动之后渲染的预演都有指纹。
