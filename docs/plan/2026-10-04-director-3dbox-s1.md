# 3D-BOX S1：导演计划到可播放工程

## Why

S1 把语言理解和空间求解拆开：规划器只产生导演意图（关系、动作、景别和机位运动），确定性编译器负责所有坐标、轨迹和机位。这样相同计划会得到相同工程，运镜与取景可以用第一棒测量模块复核，场景外观只保持足够的灰模相似度。

## 范围

- 新增零 three 的导演计划 v2 zod schema、纯函数布局/走位/机位求解器和闭环测量报告。
- 新增模板扩展适配（courtyard、product_stage）和 AI dressing 规整物化适配。
- 新增一次调用、一次重试的 LLM 规划器适配器，并把 S1 接到本分支专有的 `evals/director` 入口。
- 新增 schema、求解器、确定性和错误计划测试，并提供三道手写 oracle 计划。

## 不动项

不改导演台 UI、store、stage_shot 声明、离屏出图器、agent 工具面、词表和第一棒测量阈值。`evals/director` 只存在于本 3D-BOX 分支，因此本轮接入 `s1` 与 `s1-oracle-plan`；切换 PR 再把它接到产品入口。

## 设计卡

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 评测或第三棒把自然语言交给规划器，得到计划后调用 `compileDirectorPlan`，得到可播放 `DirectorProject`、actorMap、anchors、issues。 | 新增 `plan/`、`compiler/`、`evals/director/s1Adapter.ts` |
| ★2 谁说了算 | 计划 schema 与编译器属于本棒；景别↔距离只消费第一棒 `distanceForShotSize`；动作和运镜词表继续由既有 owner 提供。 | `concept-owners-director-s1.json` |
| ★3 一致与复用 | 模板复用 `legacySceneBuilders` 的 street/room 语义，新增模板只在适配层；dressing 复用 `normalizeAiScene`；工程形状复用 `createDefaultProject`。 | 编译器导入现有模块 |
| ★4 全状态 | schema 失败、布局冲突、测量问题均结构化返回；不会返回半成品工程。LLM 调用次数、重试和解析错误由 adapter 返回。 | `compileDirectorPlan`、`planDirector` |
| ★9 验收与回滚 | 新增测试先跑，随后 typecheck；回滚只需删除本棒新增文件。现有入口不变。 | 本文验收节 |

## 先查别人

- [Holodeck](https://arxiv.org/abs/2312.09067)：借鉴 LLM 只产空间关系、约束求解器处理硬边界的分层；本棒把关系转成确定性候选点并报告冲突。
- [SceneCraft](https://arxiv.org/abs/2306.12622)：借鉴文本场景先得到可编辑结构、再做几何/视觉复核；本棒把 `dressing` 与模板分离，复核走第一棒测量。
- [ChatCam](https://arxiv.org/abs/2409.17331)：借鉴主体锚点和相机轨迹分离；本棒每个 cut 独立机位，景别距离由第一棒反解。
- [E.T.](https://arxiv.org/abs/2407.01516)：借鉴按时间采样后识别运动类型；本棒把采样作为编译后闭环而非生成依据。
- [Toric space](https://www.cs.cmu.edu/~junyanz/projects/toric/toric.pdf)：借鉴按取景约束反解机位；本棒只保留纯数学的角度、距离和高度求解。

## 验收与回滚

计划 schema 正反例、每类求解器已知答案、错误计划会红、同计划深相等和三道 oracle 计划测试通过；`pnpm run typecheck` 通过。评测入口已在本分支接通，三轮全题库结果见下方；产品入口仍留给切换 PR。

## 执行收据（2026-10-04）

- 新增单测 10 个全部通过（schema 3、编译器 5、adapter 2）；三道 S1 oracle 计划均能产出相机与轨迹，确定性深相等通过。编译器不会产出半成品；courtyard oracle 的语义动作按要求记录为 `missing_asset`。
- `pnpm run typecheck` 通过；单独 ESLint 79 warnings 与 origin/main 棘轮持平，无新增 warning；`check:concept-owners`、`check:vocabularies` 通过。
- 规划器只从进程环境读取 `NOMI_LOOP_LLM_KEY`，没有把 key 写入文件、日志或 commit。DeepSeek 官方当前模型名为 `deepseek-flash`（V4.1 Flash）。

## 评测收据（2026-10-04）

第二轮完整收据见 [`evals/director/S1-ROUND2-REPORT.md`](../../evals/director/S1-ROUND2-REPORT.md)。本轮修正了动作尺子和 oracle 构造器：语义动作缺资产时所有方案按 `missing_asset` 得 0，oracle 从 `0.977486` 变为 `0.973611`；s0-pr960-raw 从 `0.192124` 变为 `0.247266`。28 张手写计划的 `s1-oracle-plan` 从首轮 `0.411175` 提升到 `0.954608`，最低卡 `0.863424`，全部达到 0.85。

三轮 s1 全题库分数为 `0.230661 / 0.215438 / 0.229358`，均值 `0.225152`，总体方差 `0.000047`；三轮 84 张最终格式全部合格。由于运行收据未提供价格字段，LLM 花费记为 `unverified`，不做臆算。第二轮仍未运行 L5 视觉模型，也未完成产品入口接入。

三轮全题库均为 28 张；每轮 28 次规划请求，失败时再请求一次。总计 84 次首请求、76 次重试、572,910 tokens（输入 196,137、输出 376,773），平均单题 20.35 秒。按 DeepSeek Flash 未命中缓存的空闲时段价格估算约 **$0.255**；按高峰价上界约 **$0.511**。本次只在进程环境使用 `DEEPSEEK_API_KEY`。

| 方案 | Run 1 | Run 2 | Run 3 | 均值 ± 方差 |
|---|---:|---:|---:|---:|
| S1 全题库 | 0.099 | 0.126 | 0.103 | **0.109 ± 0.000137** |
| oracle | 0.977 | — | — | **0.977** |
| s0-pr960-raw | 0.192 | — | — | **0.192** |

S1 分层均值（Run1 / Run2 / Run3；均值 ± 方差）：L0 `0.393 / 0.464 / 0.357`，`0.405 ± 0.001984`；L1 `0.379 / 0.439 / 0.384`，`0.400 ± 0.000745`；L2 `0.050 / 0.014 / 0.050`，`0.038 ± 0.000283`；L3 `0.000 / 0.000 / 0.009`，`0.003 ± 0.000018`；L4 `0.143 / 0.179 / 0.179`，`0.167 ± 0.000283`。分档总分：benchmark `0.184 / 0.190 / 0.371`（`0.248 ± 0.007540`），T1 `0.097 / 0.139 / 0.087`（`0.108 ± 0.000520`），T2 `0.133 / 0.143 / 0.077`（`0.118 ± 0.000858`），T3 三轮均 `0.000`。

S1-oracle-plan 三张手写计划：`courtyard-standoff 0.000`、`perfume-orbit 0.630`、`police-chase 0.604`，均值 `0.411`。因此主要差距在编译器的镜头接续、主体取景和运动识别；规划器额外造成 41/84 次最终 adapter_error。动作语义 `hide_object_behind_back` 在 oracle 计划中按要求留下 `missing_asset`，没有伪造动作片段；这会让相关 L3 卡继续失分，待编排者修复统一尺子后再复测。

三轮综合最差五张：`t1-01-push`、`t1-03-pan`、`t1-04-tilt`、`t1-15-whip` 均为规划器理解/严格 schema 失败（非法 template/environment、动作 verb 或 camera move，重试后仍失败）；`t3-cafe` 为编译器未处理好小物体与机位碰撞（`camera enters cup of coffee`），其计划可解析但 L0 被测量门打为 0。`t2-kitchen`、`t2-train`、`t2-rooftop` 同属规划器 schema 失败的并列零分样本。
