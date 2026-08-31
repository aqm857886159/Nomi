# Nomi 视频生产流程审查与优化建议（2026-08-20）

审查基线：分支 `claude/keen-mirzakhani-d26c73`，最新提交 `c97a32a5`。当前共享工作树是另一条带冲突的 `task/replicate-model-contract-tests`，本报告只读审查分支内容，不把结论误当成当前工作树状态。

## 结论先说

Nomi 的大方向是对的：**先生成可复用资产，再用参考图生成关键帧/视频，最后审片和重试**。这比“一条大 prompt 直接出完整视频”可靠，也符合 ViMax、FilmWorld、EntityBench 这类近期方案的共同结论。

真正的问题不是缺少更多 prompt 字段，而是“分镜计划 → 画布节点 → 真实生成请求”之间存在信息漏斗：

1. W4 的 `checkShotLanguage`、`findPollutionWords`、`verifyFocusForVariation` 目前只有纯核和测试，生产路径没有调用。
2. `variationType`、`camIdx` 在 `StoryboardPlan` schema 中存在，但 `storyboardPlanToCreateNodesArgs` 没有把它们传到节点或生成请求，因而不能成为生成/审片路由键。
3. `ffDesc` / `lfDesc` 在直接 `nomi_generate` 路已能进入 `generateOnProject`，但 storyboard 转画布的普通 video node 不保存这两个字段；只有显式 `keyframe.enabled` 时，`ffDesc` 才会用于首帧节点 prompt。
4. 当前 storyboard 转换器明确不连 shot→shot 尾帧接力，镜头连续性主要依赖共享锚卡；这能保身份，但不能保证上一镜的“当前状态”传到下一镜。

因此我建议的核心路线是：**先修“字段不丢 + 状态可继承 + 校验真接线”，再扩模型能力。**

## 当前真实流程

```text
用户 brief / 剧本
  ↓
propose_storyboard_plan
  ├─ anchors: character / scene / prop / style
  └─ shots: prompt / duration / shotKind / ffDesc / lfDesc / variationType / camIdx
  ↓ 用户审阅
storyboardPlanToCreateNodesArgs
  ├─ 参考卡节点（角色/场景/道具）
  ├─ 镜头 image/video 节点
  └─ 参考边（锚 → 镜头；可选首帧图 → 视频）
  ↓
run_generation_batch
  ├─ 参考资产先生成
  └─ 镜头节点再生成
  ↓
generateOnProject
  ├─ 有可用参考时尝试 I2V 两跳：首帧图 → 视频
  ├─ 有模型尾帧槽且有 lfDesc 时生成尾帧图
  └─ 生成成功后可选 shotVerify：判分 → 定向重试 → 红标
  ↓
arrange_storyboard_to_timeline → 预览 / 导出
```

这条链有一个重要分叉：直接 MCP `nomi_generate` 已经能把 `firstFrameDesc` / `lastFrameDesc` 送进能力核；而 storyboard 批次路径经过 `storyboardPlanToCreateNodesArgs` 后，字段形状不完整，导致两条“看起来相同”的生产路径实际能力不同。

## 已经做对的地方

### 1. 资产先行的原则已经存在

`brand.promo` 明确要求：先生成产品 `prop` 参考图，再生成各镜关键帧和视频；参考卡通过 reference edge 绑定到每个产品镜。这是正确的依赖顺序，也是成熟 R2V 工作流的共同形态。

### 2. 身份与可变状态开始分层

角色锚已经有 `staticFeatures` / `dynamicFeatures`：前者是跨镜身份 DNA，后者是服装与状态。这个分层应继续保留，不要把所有描述重新揉回一个长 prompt。

### 3. I2V 两跳和首尾帧语义已经落地一部分

`generateOnProject` 会在模型目录确认“真的接受图片参考”后尝试先出静态首帧，再喂视频；`composeShotPrompt` 也修复了“无锚空镜导致 `ffDesc` 静默蒸发”的问题。这个修复证明了首尾帧字段不是文档装饰，而是应该被当作执行合同。

### 4. 生成后审片环已有可复用纯核

`shotVerifyCore` / `shotVerifyOrchestrate` 已把判分、偏差、重试、红标和超时降级拆开；生产路径和 MCP 路径共享判分纯核，方向正确。

## 关键断点与影响

| 断点 | 证据 | 用户后果 | 优先级 |
|---|---|---|---|
| W4 镜头语言校验未接线 | `electron/capabilityCore/shotLanguage.ts` 的导出只被 `shotLanguage.test.ts` 引用 | 污染词、运动描述中的角色名、variation 路由都不会在生成前或重写后出现 | P0 |
| 计划字段在转换器丢失 | `StoryboardPlan` 有 `variationType/camIdx/ffDesc/lfDesc`；`storyboardPlanToCreateNodesArgs` 的 `PlanCreatedNode` 没这些字段 | 计划里写了首帧/尾帧，真正批次生成仍可能只拿到一段运动 prompt | P0 |
| 没有 shot→shot 状态接力 | 转换器注释明确“不连 shot→shot 链” | 角色身份可能稳定，但上一镜的姿态、道具状态、空间方位会重新猜 | P0 |
| 优化器只注入规则，不回读校验结果 | `NodePromptOptimizer` 的 `buildOptimizePrompt` 只拼 `pollutionRule` | 优化后的 prompt 仍可能带污染词，系统没有“改写后再验一次” | P1 |
| 审片轴没有使用 variation 路由 | `verifyFocusForVariation` 未被调用 | large 镜和 small 镜用同一套注意力顺序，审片成本和误报都更高 | P1 |
| 资产质量与状态的门不在同一份合同里 | 参考卡有冻结门；镜头计划却没有强制记录“本镜引用的资产版本/状态 checkpoint” | 用户确认过角色脸，但换装/受伤/道具损坏等状态仍可能跨镜漂移 | P1 |

## 成熟方案给出的共同答案

| 方案 | 真正值得借的部分 | 不应照搬的部分 |
|---|---|---|
| [ViMax](https://arxiv.org/abs/2606.07649) / [源码](https://github.com/HKUDS/ViMax) | Story→Scene→Character bank→Shot brief→`ff/lf/motion`→参考选择→首帧→I2V→拼接；字段和阶段可审计 | 不要把完整 Python agent 结构搬进 Nomi；只抄数据合同和依赖波次 |
| [FilmWorld](https://arxiv.org/abs/2607.19038) | 世界实体状态、视觉锚定、跨镜状态传播、Diagnostic→Corrective→Select 闭环 | 论文级系统尚无可直接集成代码；先落成 Nomi 的轻量状态 checkpoint |
| [EntityBench](https://arxiv.org/abs/2605.15199) | 持久化实体记忆；先过 entity fidelity gate，再统计跨镜一致性 | 不必第一天做 50 镜 benchmark；先做 6 镜短剧的角色/场景/道具复现间隔集 |
| [SCMAPR](https://github.com/HiThink-Research/SCMAPR) | 场景路由→策略→改写→原子语义校验→条件修复 | 不要让多 agent 变成多份 prompt 真相源；Nomi 只保留一份纯核和一份最终执行 prompt |
| [Seedance 2.0 官方说明](https://seed.bytedance.com/en/blog/official-launch-of-seedance-2-0) | 多模态参考、按图位分工、15 秒多镜/音画联合、编辑与延续 | 参考数量增加不等于自动连续；资产职责仍须由 Nomi 的锚库和状态合同管理 |
| [Seedance 2.5 官方说明](https://seed.bytedance.com/en/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5) | 30 秒单次生成、扩展、多图/视频/音频参考、时间戳级编辑 | 不要因为模型能“一次吃很多参考”就跳过分镜和资产冻结 |
| [Veo 官方文档](https://ai.google.dev/gemini-api/docs/veo) | 参考图作为首场景、首尾帧插值；提示词明确镜头、主体、动作、环境、风格 | 供应商字段不同，必须通过模型目录映射，不把 `first_frame` 等键硬编码到通用层 |

## 推荐的目标流程

### 0. Brief intake：先确认“要拍什么”和“必须锁什么”

系统只问会改变生成结果的缺口：画幅、时长、风格、角色、场景、关键道具、是否需要对白/音频。把用户原话保留为 story intent，不让后续 prompt 改写覆盖它。

### 1. Asset plan：先判定哪些东西值得持久化

按“跨两镜以上复现”或“用户明确要锁定”触发资产生成：

- 角色：主定妆 + 三视图 / 关键状态变体。
- 场景：同地点的 establishing / 中景 / 细节视图。
- 道具：正面、侧面、细节；若带状态，拆成版本。
- 风格：文本锚即可，不要为了能连边而生成无行动价值的风格图。

每个资产生成后先做“资产门”：身份、构图、品牌/商标、画幅、无意外角色。未通过就修资产，不要把错误扩散到六个镜头。

### 2. Bible freeze：冻结实体和状态

把每镜引用写成：

```text
entityId + assetVersion + stateId + allowedChanges
```

例如“C01 / costume-night-v2 / tired-but-uninjured / 允许表情和姿态变化，不允许发型、脸型、工牌变化”。

### 3. Storyboard：每镜拆成“静态起点 + 可见动作 + 静态终点”

每镜至少要有：

- `shotIntent`：这镜在叙事上完成什么；
- `ffDesc`：静态首帧，不能写运动；
- `motionDesc`：谁先动、动作作用到谁、可见结果；
- `lfDesc`：静态落点；
- `cameraPlan`：景别、机位、运镜、焦段感；
- `variationType`：large / medium / small；
- `camIdx`：可复用机位；
- `continuityIn/Out`：上一镜继承什么、下一镜交接什么；
- `negativeConstraints`：品牌、文字、肢体、空间和风格禁项。

### 4. Compile：把计划编译成不可丢字段的执行图

不要让 `StoryboardPlan` 直接“变成几个节点就结束”。应有一个编译层做三件事：

1. 校验每镜引用的 entity/state/asset 是否存在；
2. 把全部字段写入节点元数据或生成参数；
3. 生成依赖边：锚资产 → 首帧 → 视频 → 下一镜状态 checkpoint。

编译后做一次“计划—执行对账”：计划里的每个 shot、anchor、ff/lf、variation、camera 是否在执行图里都能找到对应字段。任何字段缺失就返回计划错误，不静默降级。

### 5. Generate：按波次，而不是按镜头盲跑

推荐波次：

1. 锚资产（角色/场景/道具）；
2. 所有镜头首帧/尾帧候选；
3. 视频 I2V；
4. 仅对失败轴重试，不重生成整片。

首帧/尾帧的职责要写进参考图槽位：角色锚锁身份，场景锚锁空间，上一镜尾帧锁当前状态，文本 prompt 只负责镜头独有的动作和结果。

### 6. QA：先静态，再视频；先实体，再叙事

静态首帧先过：实体身份、场景/构图、prompt 对齐、禁项。视频再过：动作链、物理合理性、身份保持、镜间连续、音画同步。

判分结果必须能回到修复动作：

- identity 低：保留构图和光线，只替换/加强角色参考；
- composition 低：保留角色和动作，只修机位/空间描述；
- continuity 低：把上一镜尾帧或状态 checkpoint 注入下一镜；
- pollution 命中：只改命中的动作短语，不重写整段故事。

### 7. Assemble：把排片当成质量阶段，不是最后的机械动作

先做 contact sheet / cut 预览，检查尾帧→首帧的跳变、动作节奏、音画落点，再导出。广告 playbook 的“钩子—卖点—场景—CTA”可作为品牌宣传片默认蓝图，但不应成为短剧和普通视频的通用叙事模板。

## Prompt 写法：应该怎样分工

### 图片 prompt：写“这张图必须长什么样”

参考图已经锁身份时，不要重复一大段人物外貌；应明确“图 1 负责角色外观、图 2 负责场景构图/光线”。最终图片 prompt 仍要包含：时间/天气、空间层次、主体位置关系、关键道具、景别/机位、光线、禁止项。复杂场景宁可具体，不要为了短而丢掉人数、左右关系和遮挡关系。

### 视频 prompt：写“怎么动、动完是什么结果”

视频模型更像运动补完器，不是能忠实执行整部剧本的导演。最终 prompt 必须直接写入：

```text
导演意图 → 谁先动 → 动作作用到谁 → 可见结果 → 镜头怎么动 → 物理约束 → 禁止漂移
```

静态身份、场景拓扑和道具位置优先放参考图/首尾帧；不要把所有职责再压回一段文字。

### W4 污染词规则：做成“改写前后都要过”的静态门

- 抽象概念（意识、记忆、命运）改成可见物理表现；
- 视线词（望向、凝视）改成身体朝向 + 具体目标物；
- 事件名（驾驶、战斗、做饭）改成姿态 + 接触物；
- 运动描述里不要用角色专名，用已锁定的外观特征；
- 商业地点/商品显式写“无真实品牌标识、无文字商标”。

优化器不应只得到一段泛化铁律。它应该收到命中列表和修复建议，改完后再次调用同一 `checkShotLanguage`；若仍命中，给用户看红标而不是假装优化完成。

## 我建议的实施顺序

### P0：先修信息守恒，不扩模型

1. 将 `ffDesc/lfDesc/variationType/camIdx/continuity` 纳入画布节点的可追溯元数据；
2. 编译后加计划—执行对账测试；
3. 让 batch 生成真实消费 `ffDesc/lfDesc`，并把上一镜尾帧作为下一镜首帧候选；
4. 在规划后、优化器改写后各调用一次 `checkShotLanguage`。

### P1：把路由和状态接上

1. `variationType` 决定生成策略和审片关注顺序；
2. `camIdx` 复用同机位参考和构图，不重复生成同一机位的基础资产；
3. 资产引用携带 `assetVersion/stateId`，QA 以实体 fidelity gate 为前置；
4. 将失败原因映射成最小修复 prompt，限制定向重试次数。

### P2：再做评测和供应商优化

1. 建 6 镜短剧回归集：首镜空镜、角色正面/侧面、换装、道具状态、场景切换、长间隔角色重现；
2. 同时记录镜内质量、prompt 遵从、身份、背景、动作/物理、连续性、音画同步；
3. 用 VBench-2.0 / VABench / MSVBench 的维度做供应商和 prompt 版本对比，不把单一 VLM 总分当唯一真相。

## 最终判断

Nomi 现在不需要再造一个更大的 prompt 模板，也不需要先追“一个请求塞 30 张参考图”的模型能力。最值钱的优化是把已有方向变成真正的生产合同：

> **资产是持久状态，分镜是可编译计划，参考图是执行输入，视频 prompt 只写运动，审片结果驱动定向修复。**

这会直接消灭当前最贵的失败类型：资产生成了但未被引用、计划写了首尾帧但批次路径没收到、校验器测过但生产没跑、判分看不到上游丢失的信息。
