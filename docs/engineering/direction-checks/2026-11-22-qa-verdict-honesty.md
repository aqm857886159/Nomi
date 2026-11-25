# 方向检查：审片结论从「吞错伪装全部过检」换成诚实三态（passed / flagged / unverified）

## 1. 触发与协调代批口径

本次改动命中目录级 14 天热点（`src/workbench/capability/` 3 次、`src/workbench/generationCanvas/agent/` 6 次、`electron/productionRun/` 8 次），但**本次要改的单个生产文件本身均未命中热点**：
- `src/workbench/generationCanvas/agent/shotVerifyRunner.ts`：14 天 0 次 fix
- `src/workbench/generationCanvas/agent/shotVerifyJudge.ts`：14 天 0 次 fix
- `src/workbench/generationCanvas/agent/shotVerifyStore.ts`：14 天 0 次 fix
- `src/workbench/capability/capabilityApplyHandler.ts`：14 天 1 次 fix
- `electron/productionRun/productionQaVerdict.ts`：14 天 1 次 fix
- `electron/productionRun/productionRunDriverOps.ts`：14 天 1 次 fix

本次改法是**换与删（P1 同提交删旧，不新增特例分支）**：删除「视觉模型不可用 / 抽帧失败 / 看图抛错 / 非 JSON → 静默返回 `[]` → 下游 `flagged.length === 0` 映射成 `passed: true` → 报『审片完成：N 镜全部过检』」的旧路径，直接替换为结构化的三态审片结果（`passed | flagged | unverified`）。

协调会话已在 `#1586`（`#issuecomment-7079294948`）按 P1 例外代批。

## 2. 旧设计为什么错（类根因）

违反根因四原则第 2 条「状态照实说」：**把「没审成 / 无法校验（未知）」压扁成了「审过且无偏差（通过）」**。

串联的三处漏洞：
1. `src/workbench/generationCanvas/agent/shotVerifyRunner.ts`：`!deps.visionAvailable()` 返回 `[]`，单镜 `extractFrame` / `judge` / `parseShotVerifyVerdict` 抛错直接 `continue` 跳过，下游拿到的空列表无法区分「真审过 0 偏差」与「根本没审成」。
2. `src/workbench/generationCanvas/agent/shotVerifyJudge.ts`：硬编码 `visionAvailable: () => true`，连明确声明不支持视觉输入（`modelImageInputSupport(model) === 'unsupported'`）或未配置文本模型的情况也直接放进静默吞错分支。
3. `src/workbench/capability/capabilityApplyHandler.ts` + `electron/productionRun/productionQaVerdict.ts` + `src/workbench/ai/resident/useShotVerifyFeedback.tsx` / `ReconcileDeviationCard.tsx`：
   - 生产制作链路把 `flagged.length === 0` 无条件映射为 `passed: true`，最终写入 `审片完成：N 镜全部过检` 与逐镜 `审片通过`；
   - 画布 Agent 面板侧在全部未校验时完全静默、部分未校验时仍宣称「其它镜都正常」。

## 3. 新方案（唯一主人 + 删旧换新）

1. **视觉能力真判定复用唯一主人 `modelImageInputSupport`**：`electron/ai/textBrainResolver.ts`（`resolveTextBrainStatus`）随已解析模型返回 `imageInput: modelImageInputSupport(model)`，`shotVerifyJudge.ts` 删掉硬编码 `() => true`，按真实 `textBrain` 状态与 `imageInput !== 'unsupported'` 判定；未声明（`unknown`）的本地/中转模型照常尝试调用，由真实结果决定成功或 `unverified`。
2. **审片执行层输出显式三态报告**：`verifyGeneratedShots` 返回 `ShotVerifyReport`（`{ deviations, shotOutcomes, unverified }`），每镜必落 `passed | flagged | unverified`（带精确原因 `vision_unavailable | missing_frame_source | frame_extract_failed | judge_failed | invalid_verdict_json`），不再用空数组掩盖失败。
3. **生产制作与画布 UI 同步消费三态、经 i18n 诚实展示**：
   - `verifyShotsForProduction` 直接映射三态 `QaShotVerdict`（删除 `passed: flagged.length === 0`）；
   - `buildQaStageOutcome` 仅在全部镜头为 `passed` 时输出「审片完成：N 镜全部过检」（反例 D 守恒），有 `unverified` 时照实输出「审片未完成 / 审片部分完成」及原因，且 `buildQaRetryPlans` 绝不为 `unverified` 镜头安排花钱重滚；
   - `ReconcileDeviationCard` 与 `ProductionDetails` 经 `generationCommon` i18n 中英双语诚实展示未校验镜头与原因，绝不冒充「全部过检」或「其它镜都正常」。

## 4. 复查计划

- 复查日：`2026-12-22`
- 量具：`shotVerifyRunner.test.ts`、`shotVerifyStore.test.ts`、`capabilityApplyHandler.qaVerdict.test.ts`、`productionQaVerify.test.ts`、`useShotVerifyFeedback.test.ts`、`ProductionRunTaskCard.test.ts` 及中英真窗口截图。
- 协调代批（2026-11-22，`#1586` `#issuecomment-7079294948`）：仅因目录热点命中，改法为删旧换新，事后报用户。
