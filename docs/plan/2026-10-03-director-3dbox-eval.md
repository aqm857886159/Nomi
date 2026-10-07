# 3D-BOX 评测底座（第一棒）

## Why

3D 导演台要从“一句话 → 场景 + 走位 + 多镜头预演”继续演进。第一棒先固定一套离线、确定性的测量和题库，让现状正则路线、后续结构化计划求解器和 agent 循环可以在同一把尺上比较。用户已明确运镜/轨迹比场景外观更重要，因此总分把运镜与取景合并为 40%，走位/动作 25%，镜头结构 15%，场景 10%，整体 10%。L5 视觉模型本棒只留接口并按缺省处理，不伪装成已运行。

## 范围

- 新增 `nodes/director/model/` 下零 three 依赖的帧采样、投影、景别、运镜、连续性测量模块。
- 新增 `evals/director/` 的 Director Card schema、28 张离线题卡、分层打分器、oracle / PR #960 raw / ideal 适配器和 CLI。
- 新增 Vitest 单测，覆盖已知正确轨迹和故意错误轨迹。
- 三道标尺题与三种方案的汇总结果在本文件“基线”节维护。

## 不动项

不修改导演台现有生产行为；不碰 agent lane、工具注册表、skill、UI；不改 PR #960 检出或主仓；不调用模型、不花额度；不新增或复制 `stagingVocab.StagingShot`、`cameraMoveVocab.CameraMove` 词表。

## 设计卡

改动名：Director 3D-BOX 离线评测底座　线/负责人：feat/director-3dbox-eval　类别：[其他]

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当导演想比较一句话到可播放预演的方案时，我想运行同一题库和打分器，以便先看运镜/取景与走位的可复现差距；真实任务是三道标尺题、T1 词汇单测、T2/T3 多镜题；本棒不做多轮编辑和视觉模型。 | `evals/director/run.ts`；离线合成工程，不宣称真实媒体覆盖 |
| ★2 谁说了算 | 预演测量由 `nodes/director/model/directorEvalMeasurement.ts` 唯一拥有；Director Card schema 由 `evals/director/cardSchema.ts` 唯一拥有；DirectorProject 只读消费现有 `directorTypes.ts` / `directorProject.ts`。 | `docs/engineering/concept-owners.json`；新增模块无生产写入口 |
| ★3 一致与复用 | 复用 `trajectoryEval.ts`、`programCamera.ts`、`evaluatedSceneObject.ts`、`stagingVocab.ts`、`cameraMoveVocab.ts`；测量层只补识别与投影，不定义第二套运动词表。 | `git grep`；`check:vocabularies` |
| ★4 全状态 | 离线 CLI：加载中=读取卡；成功=写 `scores.json`/`report.md`；失败=逐卡记录人话原因；部分成功=报告保留卡级失败；取消/过期=不适用（无长跑或外部任务）。 | CLI 输出路径；`check:i18n` 不涉及 UI |
| ★9 验收与回滚 | A/B/C 各自提交；运行 schema/measurement/scorer tests、`pnpm run review:branch`、`pnpm run gates`；回滚按提交 revert，不触生产行为。独立验收线：待另一条线按本卡运行同样命令并复核报告。 | 命令与提交收据 |

## 概念占用表（R33）

| 概念 | 唯一 owner | 允许消费者 |
|---|---|---|
| 预演测量（机位/物体采样、投影取景、运镜识别、连续性检查） | 新建 `src/workbench/generationCanvas/nodes/director/model/directorEvalMeasurement.ts` | `evals/director`（现在）；导演台 agent 自检工具（以后） |
| 测量用景别刻度（远景…大特写） | 测量模块内常量 `EVAL_SHOT_SIZES`，与 `stagingVocab.StagingShot` 显式映射 | 同上 |
| 运镜类型 | `cameraMoveVocab.CameraMove`；测量只增识别，不新增词 | 同上 |
| 导演卡（评测标准答案） schema | `evals/director/cardSchema.ts` | 评测 runner |
| DirectorProject | 现有 `directorTypes.ts` / `directorProject.ts`，只读消费 | 评测适配器、测量模块 |

## 先查别人

- [E.T. the Exceptional Trajectories (arXiv)](https://arxiv.org/abs/2407.01516)：论文明确从相机与角色随时间的 3D 坐标构造均匀轨迹并做 motion tagging，且用 CLaTr 做文本-轨迹度量与分类 precision/recall/F1；本方案借鉴“先采样再识别”的分层指标，保留可解释的幅度、方向、速度误差而不依赖模型。
- [ChatCam (arXiv)](https://arxiv.org/abs/2409.17331)：CineGPT 生成文本条件相机轨迹，Anchor Determinator 负责精确放置；本方案借鉴“主体锚点 + 相对轨迹”的测量接口，使 orbit/push/follow 都相对主体求值。
- [Director3D (arXiv)](https://arxiv.org/abs/2406.17601)：把文本到相机轨迹与 3D 场景拆成 Cinematographer/Decorator/Detailer；本方案借鉴把镜头轨迹作为独立可测边界，并将场景分数降权。
- [Holodeck (arXiv)](https://arxiv.org/abs/2312.09067)：LLM 产出空间关系，约束求解器处理硬边界与软关系；本方案借鉴卡中 `relations` 与连续性/穿模硬失败分开，给未来 S1 求解器保留结构化输入。

## 基线

本轮基线由同一工作区重新生成：`pnpm run eval:director -- --scheme oracle`、`NOMI_EVAL_PR960_ROOT=/Users/aoqimin/Desktop/Nomi-eval-pr960 pnpm run eval:director -- --scheme s0-pr960-raw`，以及同一环境下 `--scheme s0-pr960-ideal --cards benchmark`。`NOMI_EVAL_PR960_ROOT` 只在命令环境中提供，源码不包含本机绝对路径。L5 仍为 `unverified`，未把视觉模型结果混入总分。

| 方案 | 卡数 | 总分均值 | L0 | L1 镜头结构 | L2 运镜+取景 | L3 走位/动作 | L4 场景 |
|---|---:|---:|---:|---:|---:|---:|---:|
| oracle | 28 | **0.977** | 1.000 | 0.998 | 0.962 | 1.000 | 1.000 |
| s0-pr960-raw | 28 | 0.192 | 1.000 | 0.677 | 0.052 | 0.000 | 0.036 |
| s0-pr960-ideal | 3 | 0.200 | 1.000 | 0.361 | 0.127 | 0.125 | 0.278 |

分层总分均值（按卡 tier）：oracle：benchmark `0.967`、T1 `0.981`、T2 `0.955`、T3 `1.000`；s0-pr960-raw：benchmark `0.061`、T1 `0.292`、T2 `0.090`、T3 `0.019`；s0-pr960-ideal 仅 benchmark 三张，`0.200`。oracle 最低五张仍全部达标：`t1-03-pan 0.881`、`t1-15-whip 0.881`（摇镜主体在画面边缘的取景损失）、`t2-rooftop 0.912`（俯拍镜头的关键点取景）、`t1-08-crane 0.932`（升镜过程中的景别边界）、`police-chase 0.946`（第二镜 pan 与车辆轨迹的耦合）。这些是构造器按卡生成的真实残差，没有调阈值或权重。

### 三道标尺题

| 卡 | oracle | s0-pr960-raw | s0-pr960-ideal |
|---|---:|---:|---:|
| courtyard-standoff | **0.956** | 0.042 | 0.229 |
| perfume-orbit | **0.999** | 0.087 | 0.315 |
| police-chase | **0.946** | 0.056 | 0.056 |

### 本轮测量口径

- 人物使用 `FIGURE_SHOT_LADDER`：远景 `<0.33`、全景 `0.33–1.15`、中景 `1.15–2.3`、中近景 `2.3–3.6`、近景 `3.6–6`、特写 `6–12`、大特写 `≥12`。它表达画框截到人物身体哪里，所以中景/特写允许人物包围盒越过画框。
- 物体和锚点部位（例如 `woman.hand`、`bottle.cap`）使用 `OBJECT_SHOT_LADDER`；锚点通过 `sampleDirectorProject(..., { anchors })` 取中心和尺寸，评分按锚点投影而不是把整个人误当成手部。
- `inFrame` 只要求关键点可见：人物取头部，物体/锚点取中心；`contained` 仍表示整副包围盒在框内，只用于诊断，不把它当成中景/特写的可见性门槛。
- `distanceForShotSize` / `heightRatioForShotSize` 是景别梯子的反解，oracle 每镜先由卡景别、主体高度、FOV 和人物/物体梯子求距离，再生成轨迹。
- 卡没有约束的层记 `null`，不进入总分；L0 连续性失败总分归零。

旧基线作废：旧 oracle 把“人物在画面里占高的比例 `0.28–0.48`”当中景，并要求整副包围盒在画框内；电影口径的中景通常截到腰，人物高度可以超过画框，因此旧构造器把中景、特写全部摆得过远且把关键主体判出画。测量尺已在前一提交纠正，不能继续沿用旧机位自洽的分数；本轮 oracle 依据新尺重摆，三张标尺题和全题库均重新生成。

变异体仍保留并通过：方向反转、主体出画、少一镜、动作不发生、无名演员、半环绕等测试均使对应层下降至少 `0.2`；没有通过改测量阈值或权重来恢复分数。

## 回滚

新增文件按 A/B/C 提交；若测量或评测发现回归，逐提交 `git revert <sha>` 即可。生产目录没有现有调用方，回滚不会改变导演台运行行为。

## 验收门

1. schema 能拒绝缺少 id/prompt 的卡，并接受三道标尺题。
2. 测量单测证明 360° 环绕、慢推、出画、切镜瞬移、越轴、入地/穿模均可被识别；错误夹具必须红。
3. oracle 三题分数高于 0.85；变异体对应层下降；raw/ideal 报告保留真实失败原因。
4. `pnpm run review:branch`、`pnpm run gates` 结果如实记录；`evals/runs` 产物不入 git。

## 下一棒

T4 多轮编辑题、L5 视觉模型整体分、S1 结构化计划+布局/机位求解器、S2 agent 自检循环，以及真实媒体/Windows/打包运行证据留给后续棒次。

## 待办处置（本轮）

1. **已改**：`evals/director/adapters.ts` 删除 chase/perfume/courtyard 特例，按卡逐镜生成机位、景别反解距离、角度、运镜轨迹、blocking 和动作；锚点通过测量层透传。三道标尺题与其余 25 张共用同一构造器。
2. **已验收**：oracle 28 张每张 `≥0.85`，均值 `0.977`；未改测量阈值、层权重或 L0 规则。
3. **已改**：T1 通用复制 aliases 清空；`cardIntegrity.test.ts` 增加 T1 alias 必须出现在 prompt 或等于 actor id 的检查。
4. **已验收**：方向反转、出画、少一镜、动作不发生、无名演员、半环绕等变异体保留并通过，降幅门槛 `≥0.2`。
5. **已完成**：本节已更新三方案基线、分层与分档均值、标尺题、最低五张、旧口径为何错、两条景别梯子、关键点可见、未约束不计分、L0 归零和 `NOMI_EVAL_PR960_ROOT` 运行方式。
6. **已验证**：`vitest`、`typecheck`、`check:test-types` 已通过；`pnpm run gates` 共 96 道门通过 95 道，唯一阻断是 `check:design-lab` 的 32 张视觉差异。差异集中在本分支未改动的 UI/设计基线路径，未修改基线；远端 PR checks 与 push 收据在交工链最后一段记录。仓库当前没有 `review:branch` script（执行结果为 `ERR_PNPM_NO_SCRIPT`）。

## L5 盲测终审（第 1.5 棒）

L5 评审把导演卡的 prompt 与节目机位逐帧渲染结果分开处理：`director-render.html` 只在 devlab 中挂载现有 three/CaptureBinder 像素链，按 `programCameraIdAt` 选择镜头；`evals/director/judge/run.ts` 把预注册、匿名联系图、Codex 盲评、成对比较、诱饵、测量交叉核与重复方差写入 `evals/runs/director-judge-<时间>/`。评审工作目录由每次调用新建的临时目录提供，只有随机命名的帧图；预期卡先落盘并以 SHA-256 冻结，评审 JSON 强制要求时间码证据。

评审模型固定为 `gpt-6-astra`、`model_reasoning_effort=high`、`service_tier="priority"`。首轮结果必须在报告首行声明诱饵检出率；低于 90% 时批次作废。测量交叉核只统计评审明确给出的可测结论；大方差题标为不稳定。`calibrate.html` 提供 12 段随机预演的 1–5 分校准页；用户未导出校准 JSON 前，报告始终标记「未校准」，不作方案优劣结论。真实媒体、视频模型 B 档与额度证据留给第三棒。

本分支的首轮实跑收据、联系图和未完成项以 `evals/runs/director-judge-*/report.md` 为准；任何 Codex 不可用、渲染失败或 priority 未广告的调用都保留为 `unverified`/`blocked`，不填补为通过。

### 首轮实跑收据（2026-10-03）

运行目录：`evals/runs/director-judge-20261003184155/`；命令覆盖三道标尺题、六张 T1/T2、`oracle` 与 `s0-pr960-raw`，重复 3 次。预注册的 `police-chase` 因模型返回非法时间戳而阻断，故没有伪造该题视频或分数；本次报告仍完整保留阻断记录。正常评审记录为 54 条，诱饵 5 条，优先级 fast 收据 49/54。

这批次按规则作废：诱饵检出率 4/5（80%），低于 90%；测量交叉核仅 2/57（3.5%），不能支持方案优劣结论。可见的重复均值也只作为发现问题用（例如 `courtyard-standoff` 两方案均值 1.00，`perfume-orbit` oracle 1.33 / raw 2.00）；校准页没有用户导出分数，状态仍为「未校准」。首次实现还发现成对比较左右标签映射和预注册时间戳的根因，已在后续提交修正，原始作废报告不回写。

编排者可直接目视读取三张已生成的 oracle 联系图：

- `evals/runs/director-judge-20261003184155/media/courtyard-standoff_oracle-contact.png`
- `evals/runs/director-judge-20261003184155/media/perfume-orbit_oracle-contact.png`
- `evals/runs/director-judge-20261003184155/media/t1-01-push_oracle-contact.png`

灰模画面已确认有可读几何体与机位变化；`police-chase` 联系图缺失是预注册阻断的真实结果。校准页现在会复制到每个 run 目录的 `calibrate.html`，与 `calibration-manifest.json` 和媒体相邻，便于离线打分。

本轮 Codex 调用可由原始记录反推为 70 次：9 次预注册、53 次单片评审、8 次成对盲比；额度/Token 收据未由 `codex exec` 暴露，因此成本记为 `unverified`，没有估算一个假数字。`service_tier="priority"` 的单片评审记录有 49/54 fast 收据，其余按报告保留为非 fast 或 blocked。

交工门岗：本分支 `pnpm run gates` 为 96 门 95 通过，唯一阻断是本分支派生端口上的 `ERR_UNSAFE_PORT` warmup；同一时刻干净 `origin/main` 的 `check:design-lab` 则实际跑完 188 用例并有 40 张既有基线 diff。两边失败形态与名单不相同，未盖 `stamp-gates-ok`、未 push、未创建 draft PR；这不是把例外条件扩大解释。
