本文由实现线 `k1-draft-receipt-truth` 整理；独立调研与三条路对比见任务 K 设计卡（`#1586` `#issuecomment-7079120584` & `#issuecomment-7079294948` 协调按 P1 例外代批：本刀范围是换与删——同提交删掉 `mcpGenerationVideoResolve.ts` 里「显式吃图方式缺必需输入也照收」的旧放行假设与 `referenceInputSlots.ts` 里只认 `['character', 'reference']` 的 `PAIRED_ROLES` 残缺过滤，全链路不新增任何按供应商/按模型的特例分支）。

# 方向检查：起草准入与回执真状态收口 + 首尾帧落槽修复（2026-11-22）

触发（`scripts/fix-churn.mjs` 实测）：
- 文件级：`electron/capabilityCore/mcpGenerationVideoResolve.ts` 近 14 天已有 2 个 fix（`6dc0982d0`、`4ee3ca180`），本刀为第 3 个；其余修改的 `generationDraftAdmission.ts`、`generationPlanPatch.ts`、`draftCanvasLanding.ts`、`laneExtendedTools.ts`、`referenceInputSlots.ts` 单文件均 0 次 fix。
- 目录级：`electron/agentLane/` 近 14 天已有 7 个 fix、`electron/shared/modelArchetypes/` 近 14 天已有 4 个 fix。
- 概念级：「参数准入」「这次按哪种方式发（方式按当前输入现算）」「画布付费生成（一镜一个单镜 Run）」。

**这一处的全图在哪**：`docs/plan/2026-11-12-mode-from-inputs.md`、`docs/plan/2026-11-14-mode-input-check.md`、`docs/plan/2026-11-17-model-name-one-home.md`；本次全量 `door-map` 见 PR 正文与 `docs/fixes/2026-11-22-draft-receipt-truth.root-cause.json`；交接处表外。

### 0. 一句话根因

起草写入口把「显式声明了吃图方式却未喂饱必填参考槽」和「档案默认补上的生效参数（如 `generate_audio: true`）」同时隐身放行，且画布素材库直传落槽只认 `character / reference` 而静默丢弃首尾帧，导致 Agent 拿到成功回执后向创作者报出与画布真状态相反的完成声明。

### 1. 归类表：近 14 天命中提交 → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| `6dc0982d0` 方式决定任务种类 | 按 taskKind 反拒显式 modeId | 方式与任务桶映射（与本次缺参考放行不同） |
| `4ee3ca180` 参数值进门统一类型 | 各读点各自做 Number/String 转换 | 参数值内部类型（与本次槽位准入无关） |
| `0702165cf` 模型名与方式各收一个家 | 写下「缺必需输入照收，与画布同一状态」假设 | **同类根因**：未核多模视频 0 输入在画布退化成 `t2v` |
| `#1447` 评测 P21（首尾帧 0 图草稿落空并报喜） | `mcpGenerationVideoResolve.ts` 未对显式 `modeId` 跑 `validateModeConstraints`；且 `placeReferenceInputs` 只认 `PAIRED_ROLES` 丢首尾帧 | **本次修复类**：起草准入与画布落槽和唯一 owner 脱节 |
| `#1447` 评测 P06（说无音频却默认有声） | `draft_shots` 回执只吐原始 JSON，不回显 `effectiveModeParams` 补上的默认 `generate_audio: true` | **本次修复类**：回执不从真状态主人派生 |
| `d17abc78f` / `2b428cee1` / `992823086` / `67be4fc91`（`agentLane/`） | 选区芯片、回合上限、无默认模型指路 | `agentLane/` 目录内其它独立问题，非同类 |

### 2. 为什么这一类会一直出现

把「未提供 / 走默认」压扁成「已满足」，且在起草准入、工具回执、画布落槽三处各留了一个未接唯一 owner 的旁路：
1. 起草准入接了参数值 schema，却跳过 `validateModeConstraints`，错误假设「空参考显式 `firstlast` 在画布上会置灰」——实际 `modeForInputs` 对 0 输入的多模视频会退化成 `t2v`；
2. `draft_shots` 工具回执只把近千字内部 `operation` 裸 JSON 塞给模型，不调 `effectiveModeParams` + `modeForInputs` 置顶暴露实际生效值；
3. `placeReferenceInputs` 自己手写 `PAIRED_ROLES = ['character', 'reference']` 而不读 `EDGE_MODE_SLOTS`，导致两张素材库无 role 图片落首尾帧时 100% 静默丢成 `[]`。

#### 三条体验铁律

| 铁律 | 对应回答 | 最小证据 |
|---|---|---|
| ⑩ 说的=摆的 | **直接命中**：Agent 显式说 `modeId: "firstlast"` 就必须真喂饱首帧必填槽、真落进首尾帧两格；回执必须把画布上实际生效的方式、参考与默认参数（如 `generate_audio: true`）照实摆在第 1 行。 | `draftTimeParameterAdmission.test.ts`、`laneExtendedTools.test.ts`、`referenceInputSlots.test.ts` 确定性断言。 |

### 3. 不改结构的话，接下来会冒出什么（可验证预测）

| 预测 | 怎么验证（命令或步骤） |
|---|---|
| 任何带 `slot.min >= 1` 的新视频/图像模式（如新上线的 `i2i`、`ref2v`、`firstlast`）被 Agent 漏传 `references` 时，都会照样落成空壳草稿并在多模模型上退化成文生视频花冤枉钱 | `pnpm exec vitest run electron/capabilityCore/draftTimeParameterAdmission.test.ts` |
| 任何声明了布尔默认值（如 `generate_audio: true`）的新模型，用户要求反向取值而模型漏传该键时，都会因回执隐藏默认值而向用户谎报已完成 | `pnpm exec vitest run electron/agentLane/laneExtendedTools.test.ts` |
| 任何从素材库直接传入 2 张无 role 图片的首尾帧起草，落到画布都会丢成 `referenceImageUrls: []` | `pnpm exec vitest run src/workbench/generationCanvas/model/referenceInputSlots.test.ts` |

### 4. 靶子独立性检查

- 评测题库与裁判 `tests/ux/agent-param-eval.cases.json` + `tests/ux/agent-param-eval-judge.mjs` 是独立早于本刀建好的 `#1447` 参数评测集（P21/P06），不是本实现线自造的靶子。
- 没有「修对了反而掉分」的先例；反例 A（普通文生）、反例 B（同批 `anchorIds`）、反例 C（画布手建空卡）、场景 4（未显式写 `modeId` 的纯图生空卡）均写死在回归测试中防过度拦截。

### 5. 这一整块归谁（P0）

这一整块：起草准入的必填参考槽判定、草稿实际生效状态回执、与画布上传参考落槽。
归谁：我们唯一的主人——必填槽约束归 `electron/shared/videoCapabilities/crossFieldConstraints.ts:93`（`validateModeConstraints`）、输入落槽与有效方式归 `electron/shared/modelArchetypes/modeForInputs.ts:170`（`modeForInputs` / `slotCountsForMode`）、生效参数与默认值归 `electron/shared/modelArchetypes/modeParams.ts:70`（`effectiveModeParams`）、边/用途到槽偏好归 `electron/shared/canvas/edgeAdmission.ts:86`（`EDGE_MODE_SLOTS`）；工具回执结构原则参照 MCP Tools `structuredContent`（https://modelcontextprotocol.io/specification/2025-06-18/server/tools）与 Anthropic Tool Design（https://www.anthropic.com/engineering/writing-tools-for-agents）。
我们哪里绕开了它：`electron/capabilityCore/mcpGenerationVideoResolve.ts:181` 放行显式 `modeId` 时绕开了 `validateModeConstraints`；`electron/agentLane/laneExtendedTools.ts:226` 拼 `draft_shots` 回执时绕开了 `effectiveModeParams` 与 `modeForInputs`；`src/workbench/generationCanvas/model/referenceInputSlots.ts:31` 手写 `PAIRED_ROLES` 绕开了 `EDGE_MODE_SLOTS`。

### 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 代价 | 选了以后同一类还会不会出现、从哪出现 | 风险 | 推荐 |
|---|---|---|---|---|---|
| 沿原方向修 | 在系统提示词里加文字叮嘱模型「别忘了查 `look_at_media` 和写 `generate_audio: false`」 | 每次新模型/新参数都要堆提示词 | 会，换一个模型或长上下文照样漏图和漏看默认值 | 高（文字叮嘱不可靠） | 否 |
| 换一种做法 | 全部收口到唯一 owner：写入口调 `validateModeConstraints` 拒收缺必填槽的显式 `modeId`；回执首行调 `effectiveModeParams` + `modeForInputs` 暴露真状态；落槽删 `PAIRED_ROLES` 改读 `EDGE_MODE_SLOTS` | 需同时覆盖多镜 create、单镜 create、extend、plan 改草稿并保护反例 A–C 与场景 4 | 不会从起草准入/回执/落槽出现；剩余创作者侧聊天 UI 指针由第 2 刀（K-2）收口 | 低（反例与全量单测兜底） | **选** |
| 删掉 | 删掉 `draft_shots` 的 `modeId` 字段让模型一律不写方式 | 创作者显式要求首尾帧、全能参考、改图时模型无法表达意图 | 不适用 | 高（破坏正常创作表达） | 否 |

### 7. 用户要权衡的核心

Agent 显式声明吃图方式却没喂参考素材时，是照收空壳落画布（且多模模型会静默退化成文生视频），还是在起草当场拒收并指路 `look_at_media` 把图找齐再落（协调已拍板选后者）。

## 特征测试清单（动结构前先锁住）

- `src/workbench/generationCanvas/model/referenceInputSlots.test.ts`（修前红：P21 首尾帧 2 张无 role 素材库图落成 `referenceImageUrls: []`；修后绿：`first_frame` + `last_frame` 两格齐备）
- `electron/capabilityCore/draftTimeParameterAdmission.test.ts`（修前红：P21 显式 `firstlast` 0 图、音频类型错配、图像 `i2i` 0 图、场景 6 清空参考、纯文本锚点均返回 `ok: true`；修后绿：全部以 `mode_input_missing` 当场拒收且反例 A/B 与场景 4/5 全绿）
- `electron/agentLane/laneExtendedTools.test.ts`（修前红：P06 回执无 `Landed draft summary`、隐藏默认 `generate_audio: true`；修后绿：首行暴露真状态与 `NEEDS_INPUT` 缺口）
- `electron/capabilityCore/generationPlanPatch.test.ts` & `electron/capabilityCore/modelNameModeParity.test.ts`（五入口一致与改草稿规则回归锁）
