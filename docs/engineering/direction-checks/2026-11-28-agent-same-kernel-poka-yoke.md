# 方向检查：Agent 起草参数同核化、多镜原子修订与按声明开启严格采样（2026-11-28）

**这一处的全图在哪**：表外（覆盖 `electron/shared/agentCapabilities/` → `electron/capabilityCore/mcpGenerationVideoResolve.ts` → `electron/shared/modelArchetypes/` 与 `electron/agentLane/{laneTools,laneModelProvider}.mts` 的 Agent 起草准入及工具调用边界）。

### 0. 一句话根因

Agent 起草工具曾与画布节点参数推导核分裂成两套规则，把宿主可由档案自推或确定性吸附的参数约束写成事后拒收分支，同时对第三方 `openai-compatible` 中转站未显式收口 `supportsStrictMode` 默认值。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 真实轨迹 101 次工具拒收（比例 / 模式 / 时长 / 单镜锁） | `writeVerbs.ts`、`semanticGenerationCandidate.ts`、`generationAuthoredDuration.ts` 另写拒收分支考模型，未走画布 `resolveAspectRatioGeometryChoice` 与档案模式推导 | 双轨参数解析分裂 |
| `modeId: "edit"` / `"omni"` 无模型名时误路由或丢顶层 `taskKind` | `taskKindForModeId` 曾先查仅含视频模型的 `transportTaskKindForModeId`，`withDraftShotsDefaults` 无条件剥离顶层 `taskKind` | 模式归属表片面截胡 |
| 文稿分镜批量改镜后镜失败留半截脏写 | `patchStoryboardAuthoring` 逐镜循环调单镜落盘，未在渲染层方案正本做整批全量预检与单次提交 | 多镜事务非原子 |
| 第三方 `openai-compatible` 中转站被强发 `strict: true` | `pi-ai@0.85.1` 对 `openai-completions` 默认 `supportsStrictMode = true`，且未过滤严格语法编译器拒绝的值级界限关键字 | 协议能力未按显式声明门控 |

### 2. 为什么这一类会一直出现

模型面（`agentCapabilities`）、宿主准入（`capabilityCore`）与模型连接装配（`laneModelProvider`）此前按单点报错逐次打补丁，而不是让所有写入口共享唯一领域核（全目录档案扫描 + 像素几何映射 + 单镜近界吸附 + 整批原子写回）并按 `model.meta` 显式声明开启严格采样。

#### 三条体验铁律

| 铁律 | 类根因要回答的问题 | 最小证据 |
|---|---|---|
| ⑩ 说的=摆的 | Agent 起草的语义比例、模式与近界吸附时长是否在草稿、画布节点、报价卡三站逐项一致并附诚实回执？ | `tests/experience-laws/intentShownEqualsDrafted.test.mjs`（21/21）与 `electron/agentLane/agentSameKernelPokaYoke.test.ts`（11/11） |
| ⑪ 能选到 | 首轮默认模型规格（比例 / 时长 / 清晰度 / 参考槽）是否直接从同一份 `availableModels` 档案投影且不超预算？ | `electron/agentLane/laneModelContext.ts:106` + 4 独立默认模型 `≤ 350 tokens` 断言 |
| ⑫ 点了=以为的 | 本次不改任何前端可点 UI 组件（不适用）。 | 仅后端 / Agent 契约与分镜存储纯函数改动 |

### 3. 不改结构的话，接下来会冒出什么（2–3 个可验证预测）

| 预测 | 怎么验证（命令或步骤） |
|---|---|
| 新增图像/视频重名 `modeId` 时，未传 `model` 的调用再次把图像任务静默派给高价视频默认模型 | `npx vitest run electron/agentLane/agentSameKernelPokaYoke.test.ts` 中 `taskKind: "image_edit" + modeId: "edit"` 用例 |
| 用户接入任意 OneAPI / NewAPI / DeepSeek 等 `openai-compatible` 中转站跑 Agent 时，因 `strict: true` + `exclusiveMinimum` 直接报 HTTP 400 | `npx vitest run electron/agentLane/modelRequestParity.test.ts` 与 `agentSameKernelPokaYoke.test.ts` 中中转站线上请求断言 |
| 一次批量修订多个文稿分镜镜头遇到错写 `shotId` 时，前序镜头已被落盘并污染 undo 栈 | `npx vitest run src/workbench/creation/storyboard/agentStoryboardDesign.test.ts` 批量原子回滚用例 |

### 4. 靶子独立性检查

- `tests/experience-laws/intentShownEqualsDrafted.test.mjs`、`electron/agentLane/laneToolInputBoundary.test.ts` 与 `electron/agentLane/modelRequestParity.test.ts` 均为既有独立门岗尺子。
- 其中单镜近界时长吸附与成片级超长秒数（`> 2x` 单镜上限如 `99s`）边界对齐后，既有 25 条错写边界与问题码测试无需削弱全部通过。

### 5. 这一整块归谁（P0）

这一整块：Agent 生成起草的参数同核推导、分镜多镜批量原子事务与严格语法约束采样门控
归谁：模式与参数推导归本仓唯一档案主人 `electron/shared/generationShotKind.ts:92`、`electron/shared/aspectRatioValue.ts:116`、`electron/capabilityCore/mcpGenerationVideoResolve.ts:352`；严格采样归已安装的 `@earendil-works/pi-ai@0.85.1`（`node_modules/@earendil-works/pi-ai/dist/api/constrained-sampling.d.ts:1`）与声明装配点 `electron/agentLane/laneModelProvider.mts:223`
我们哪里绕开了它：此前 `electron/shared/generationShotKind.ts:116` 先查仅含视频档案的子表绕开了全量图/视档案、`electron/shared/agentCapabilities/verbs/writeVerbs.ts:218` 硬拦单镜改稿、`electron/capabilityCore/generationDocumentPlan.ts:238` 逐镜非原子落盘、以及 `electron/agentLane/laneModelProvider.mts:235` 让 `openai-compatible` 沿用上游按网址猜测的 `supportsStrictMode = true`

### 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 代价 | 选了以后同一类还会不会出现、从哪出现 | 风险 | 推荐 |
|---|---|---|---|---|---|
| 沿原方向修 | 继续在提示词和单点 `if` 里补特例分支与模型名黑名单 | 低（几十行） | 会；每加一个新模型、新中转站或新重名 `modeId` 都会再漏 | 规则越叠越碎、继续误拒或误扣费 | 否 |
| 换一种做法 | 统一收归全目录档案推导 + 像素几何同核映射 + 近界时长吸附回执 + 画布/文稿双路全批校验单次原子写回，并在 `laneTools.mts` / `laneModelProvider.mts` 接入 `@earendil-works/pi-ai@0.85.1`（`node_modules/@earendil-works/pi-ai/dist/api/constrained-sampling.d.ts:1`）仅对显式声明 strict 的连接与纯严格子集工具启用严格采样，同提交删掉单镜锁与冗余 `carrier` 字段 | 中（本 PR 一次落成） | 不会；模式、比例、事务原子性与 strict 门控均在唯一入口按结构不变量守住 | 低（`modelRequestParity` 82 行全对拍锁定） | **推荐** |
| 删掉 | 最小可删单位已并入推荐项：直接删掉 `writeVerbs.ts` 的 `revise one shot per call` 单镜锁与模型面冗余 `storyboard.carrier` 等 10 个内部膨胀字段（宿主自动补视觉锚 `carrier = 'visual'`，老数据直读兼容） | 低 | 被删掉的单镜死锁与冗余字段错写永久消失 | 无 | **已并入执行** |

### 7. 用户要权衡的核心

已按用户拍板执行「换同核 + 删冗余拒收锁」：让 Agent 与画布共用同一套确定性参数核，单镜近界微调给透明回执、真错误全批原子拒收不脏写、第三方中转站默认零 `strict: true` 400 风险。

## 特征测试清单（动结构前先锁住）

- `electron/agentLane/agentSameKernelPokaYoke.test.ts`（覆盖同核比例/模式/时长吸附、顶层 `image_edit` + `edit` 防误路由、文稿批量原子 IPC、4 默认模型 `≤ 350 tokens`、说明书路径锁、第三方中转站零 `strict: true` 与显式声明开启严格采样）
- `src/workbench/creation/storyboard/agentStoryboardDesign.test.ts`（钉死批量改镜含坏 `shotId` 时 `setStoryboardPlan` 零调用、零脏写，全合法时单次落盘）
- `electron/agentLane/modelRequestParity.test.ts`、`electron/agentLane/laneToolInputBoundary.test.ts`、`tests/experience-laws/intentShownEqualsDrafted.test.mjs`
