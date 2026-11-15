# Agent 起草被拒时一次把错说全、说清是哪个镜头哪个方式（设计卡）

> 类别：修 bug（Agent 写错参数、反复重试；计划表 D2-8 的下一片）。走 `.agents/skills/root-cause-remediation/SKILL.md`。
> 方向复盘：`docs/engineering/direction-checks/2026-11-15-agent-turn-stop.md`（本卡做它的「换 B」；「换 A」——停改成请示卡——是另一条线，本卡不碰）。
> 不碰：回合止损（连败怎么数、何时清零、第 3 次那句「别再发」、被停时面板那一行、`requestAbort`）；任何界面、文案、布局；某一个模型的特例；代理。

## 症状 / 直接原因 / 类根因

- **症状**（11-15 真模型三题，DeepSeek V4 Flash，真 App）：创作者说「把文稿拆成 4 个竖屏 9:16 的视频镜头，先别生成」，Agent 连着被拒 3 次，每次照提示改对了，又露出下一个错；最后带着一个错结论（「Seedance 2.5 不收 9:16」）去问创作者，回答完这一轮被掐，画布上 0 个节点。
- **直接原因**（逐次见方向复盘 §1 的表）：
  1. P18 第 4 次：形状层只报 `staticFeatures` 放错层；准入层的问题（首帧方式下比例只有 adaptive）要等形状过了才看得到。
  2. P18 第 5 次：`aspectRatio` 两层说法相反——形状层列它为合法字段，准入层给出的那一行却是「aspectRatio: no such field here … Fields allowed here: duration, generate_audio, output_format, ratio, resolution」，正文还指去「set that one in parameters」，等于叫它写 `parameters.ratio`。
  3. P18 第 6 次：照做写 `parameters.ratio: 9:16` → 「合法取值只有 adaptive」。三次拒收都没说是**哪一个镜头、哪一个方式**；6 个镜头里只有两个首帧镜头有问题，文生的两个本来就收 9:16。准入层撞到第一个镜头就停，后面的镜头一个没看。
  4. P21 第 3 次：「首帧用这张图」写成 `storyboard.referenceUrl: ""`，拒收说「referenceUrl 必填」，指向了填网址；对的家是 `shots[].references`。
  5. P21 第 4 次：画布读回来的是结果编号（`asset-<节点>-<素材>`），`references` 要的是素材编号；读的那一步没给。
- **类根因**：拒收是「撞到第一处就抛」的形状——准入层 `admitDraftShots` 逐镜头 `for … throw`，只有第一个坏镜头说得出话；拒收正文由抛出点就地拼，抛出点不知道自己在第几个镜头、什么方式；同一个字段的「家」由两层各自描述，没有一处说了算。模型读到的永远是「最先撞到的那一处、脱离上下文的一句」，所以每改一处露一处，还会从脱离上下文的话里推出错结论。

## ★0 先查别人（成熟框架怎么把校验错回给模型）

| 出处 | 它怎么做 | 对我们哪个决定的影响 |
|---|---|---|
| Pydantic `ValidationError.errors()`（docs.pydantic.dev/latest/errors/errors/）；Pydantic AI 工具参数校验（pydantic.dev/docs/ai/tools-toolsets/tools-advanced/：参数校验失败时把「the validation details」作为 retried 结果回给模型） | 一次校验收集**全部**错误，每条带 `loc`（路径）、`msg`、`input`、`ctx`（期望值）；整份回给模型 | **改了**：准入层不再撞到第一个镜头就停，逐镜头判完、一次列全；每条带路径 + 合法值 |
| Ajv `allErrors` 选项（ajv.js.org/options.html#allerrors，默认 `false`：撞到第一处就停） | 默认只报第一处，性能好、但调用方只看得到一个错——已知的坑，文档建议需要完整反馈时开 `allErrors` | **确认了**：「只报第一处」是一个要显式关掉的默认，不是自然结果；我们准入层的 `for … throw` 正是这种默认 |
| Zod `safeParse` → `error.issues`（zod.dev/ERROR_HANDLING） | 不短路：同一层的所有 issue 一次给全，每条带 `path`、`code`、期望值 | **确认了**：形状 / 契约两层本来就一次列全（`toolInputIssues` 已收成一份清单），这次不改它们，只补「下一层还没查」这句话 |
| OpenHands `stuck_detector.py`（方向复盘 §5） | 校验错比对的是「同一批字段」，换个字段错算进展 | **确认了**：一次多列几条不改「认墙」的键（同一字段路径去重，同一调用仍只记 1 次） |
| Vercel AI SDK `repairToolCall`（方向复盘 §5） | 先按 schema 修一遍再回模型 | **没采用**（任务书明确先不做）：本卡只让第一次拒收说全、说准 |

出口：不涉及：本卡不新增、不扩大、不挪动任何挡人保护（拒收本来就在、判的条件不变，只是多说几条、说准位置）。

## ★1 用户怎么用

- 当我让 Agent「把文稿拆成 4 个竖屏 9:16 视频镜头，先别生成」，我想它第一次被拒后就知道**所有**要改的地方、在哪个镜头，以便第二次就写对，不来回改、不带着错结论来问我。
- 步骤：① 我说话 → ② Agent 读文稿、列模型（列表里每个模型每个方式能选的比例、时长范围就在那一行）→ ③ 起草 → ④ 被拒时一次读到全部坏镜头：「镜头 4 «镜2·柜台买包子»（首帧 first）这个方式没有比例可选，画幅跟首帧图走，去掉 aspectRatio；镜头 3、6（文生）照写可以」→ ⑤ 第二次写对 → ⑥ 草稿落画布。
- 不做什么：不改止损的计数和「停」；不做 `repairToolCall`；不为某个模型写特例；不改面板任何一行。
- 已知坑：形状层不过时准入层没法一起判（准入要读项目状态、异步，在执行阶段）；本卡在形状拒收里明说「下面这些还没查」，并靠模型列表摘要让模型第一次就少写错。这一类创作者最多会多看到一次拒收（形状一次 + 准入一次），不再是一层一次。
- 真实任务（原始轨迹，11-15 真 App）：P18（4 个竖屏镜头）、P21（首尾帧用两张图）、P06（fast + 无音频 + 4k）。
- 指标（目标 → 信号 → 指标；量具 = `tests/ux/agent-param-eval-real-model.walk.mjs` + `tests/ux/agent-param-eval-judge.mjs`，题集 `tests/ux/agent-param-eval.cases.json`）：
  - 主指标「写入一次过准入」= 一次过准入的写入调用 / 全部写入调用。11-09 主线基线 43.2%，目标 ≥ 60%。
  - 主指标「第二次以内写对」= 题内第一次写入被拒后、下一次同工具调用就过的比例（`agent-param-eval-judge.mjs` 的 `secondTryRate`，本卡新增；基线从 11-15 三题重判得出）。目标 ≥ 80%。
  - 质量指标：平均重试 11-09 基线 1.21，目标 ≤ 0.6。
  - 护栏：30 步全成功的长回合不受影响（`laneToolInputBoundary.test.ts`）；同一调用只记 1 次连败。
  - 免费夹具（本卡新增，`electron/capabilityCore/draftShotsAdmissionAll.test.ts`、`electron/agentLane/laneToolInputBoundary.test.ts`）：用三份轨迹里的真实错入参，断言新正文一次列出全部问题。真模型数字由协调跑（★9）。
- ★1b 连带界面：面板的拒收摘要行（`laneToolFailureSummary`）按 `problem` 或第一条 issue 说话——两样都保持和今天同一个值（第一条 issue 仍是第一个坏镜头的那一条，路径写法不变），所以那一行逐字不变；展开体按字段列，坏镜头多时多列几行（同一格式，上限 6 行，今天形状拒收已经这样）。对外 MCP 的错误投影同一份清单。
- ★1c 老用户：不适用：不碰存档、设置、界面；创作者能感到的只有 Agent 少错几次。

## ★2 谁说了算

- 「起草镜头被准入层拒收的正文」唯一 owner：`admitDraftShots`（`electron/capabilityCore/mcpGenerationTools.ts`）逐镜头收集，聚合成一个 `ContractCompilationError`（多条 rejection）；镜头定位（第几个、标题、方式 id + 方式名）在这里加，因为只有这里知道。抛出点（`semanticAspectRatio.ts` / `generationAuthoredDuration.ts` / `executionContract.ts`）不知道镜头，不加。
- 字段 → 清单：`issuesFromParameterRejection`（`toolInputIssues.ts`）唯一；镜头定位是 issue 的模型专用字段（和 `received` / `note` 同档，不进公开信封），面板与遥测读的公开清单和模型读的是同一份（同序、同条数、同路径）。
- 正文构造器：`toolArgumentsRejected` / `renderLaneToolFailure`（`laneToolContract.ts`）唯一；形状拒收末尾的「下一层还没查」由这里加，参数缺省时逐字同今天。
- 比例的家：`draft_shots.shots[].aspectRatio`（语义键，`semanticAspectRatio.ts` 是全仓唯一翻译处）。准入层不再把模型指去 `parameters.<比例键>`，只在像素尺寸档那一种真没有比例语义的情况点名真实键。时长的家：`durationSec`（`generationAuthoredDuration.ts`）。
- 模型列表摘要：`modelSpecRow`（`modelSpecProjection.ts`）唯一，应用内与对外 MCP 两面同一个投影。
- 画布读的素材编号：`projectNode`（`canvasRead.ts`）唯一投影，`canvasReadCompact.ts` 唯一渲染。
- 门表：`node scripts/door-map.mjs createLaneToolInputBoundary`（1 处创建：`laneHost.mts`）；`git grep -ln toolArgumentsRejected -- electron src`（3 个文件：边界、执行层、定义处）；`admitDraftShots` 2 个调用点（首建、补镜头），同一个函数。

## ★3 一致与复用

- 以前定过：11-07「入参失败收进一个边界、一份清单、一个格式器」（`laneToolInputBoundary.mts` 头注释，算数）；10-05「比例只有一个家：aspectRatio」（`semanticAspectRatio.ts`，算数——本卡把准入层里违反它的那句话删掉）；11-08「每条起草拒收带闭合原因」（`generationProblem.ts`，算数，聚合后 `problem` 取第一个坏镜头的那个，面板行不变）；11-09「墙按码 + 字段路径认」（`laneRepeatedFailure.mts`，算数，不动）。
- 三条路：沿原方向修（逐个改那几句话）——只修文字，下一个镜头的问题照样要再撞一次才露；**换一种做法（选）**：准入层逐镜头判完再一起抛，定位在唯一知道镜头的那一处加；删掉——删不了，拒收本身是对的。
- 复用：`ContractCompilationError`、`issuesFromParameterRejection`、`renderToolInputIssue`、`laneFailureFromDecision`，都只扩不另起；不新增概念、不新增自写登记。

## ★4 全状态

- 不改界面。模型侧：全部镜头都过 → 和今天一样；一个镜头坏 → 正文和今天同一个首行，多一行镜头定位；多个镜头坏 → 一次全列，说清哪几个镜头没问题；形状不过 → 和今天一样列形状问题，末尾一句「模型 / 方式的准入还没查，改完形状它可能再报」；参考素材不在库里 → 照旧，镜头定位加上；比例 / 时长在这个方式下不收 → 说「这个方式没有比例可选，画幅跟输入图走」，不再说「no such field」也不再指去 parameters。能力不可用 / 取消中 / 过期：不适用（无界面变化）。

## ★9 验收与回滚

### 真实场景复现

- 用户那次怎么走的：用户原话 11-07「经常出现什么参数不对 重试等问题」、11-09「要把这个地方根源解决」；具体现场是 11-15 真 App 三题的轨迹（每行一次工具调用和拒收原文）。
- 我怎么走：把轨迹里 5 次被拒的**真实入参**原样做成夹具，喂进同一个准入函数 / 入参边界，读新正文。和用户那次差在：不跑真模型、不起 App（任务书不许）；所以「改后第几次写对」是**按夹具推的**，真模型数字由协调用 ★9 末尾的命令跑。
- 修前看到什么算复现成功：P18 第 4 次入参（6 镜头，其中 2 个首帧 + `aspectRatio`）喂准入，只报一个镜头、且正文里有「set that one in parameters」；P21 第 3 次只说 referenceUrl 必填。
- 修后看到什么算好了：同一份入参一次列出两个首帧镜头、各带镜头号 / 标题 / 方式，说清文生镜头没问题，不出现「parameters」指路；P21 第 3 次的拒收点名 `references`；画布读给出素材编号。

### 验收清单与反例（动手前写全；改坏 → 红、还原 → 绿）

1. 准入层只回第一个坏镜头 → `draftShotsAdmissionAll.test.ts` 红。
2. 正文不带镜头号 / 标题 / 方式 → 同上红。
3. 比例在「没有比例可选」的方式下又被说成「no such field here」或被指去 `parameters.<键>`（同一个字段再出现两个家）→ `semanticAspectRatio` 测试红。
4. 面板信封的清单和模型正文的清单不是同一份（条数 / 顺序 / 路径）→ `draftShotsAdmissionAll.test.ts` 与 `laneToolInputBoundary.test.ts` 红。
5. 一次列多条导致连败多记（一次调用记了不止 1）或认墙的键变了（同一字段多镜头）→ `laneToolInputBoundary.test.ts` 红。
6. 30 步全成功的长回合被影响 → 既有 `laneToolInputBoundary.test.ts`「30 步」那条红。
7. 形状拒收没说「下一层还没查」→ `laneToolContract` 测试红；参数缺省时正文和今天逐字不同 → 红。
8. 面板摘要行变样（第一条 issue 的路径 / `problem` 和今天不同）→ `laneToolFailureText` 既有测试 + 新断言红；中英两个走查截图逐张看。
9. 模型列表摘要不带比例 / 时长，或正文长过今天 1.5 倍 → `modelSpecProjection` 测试红。
10. 判据：P06 在没有音频参数的模型上判红；P18「镜头数=4」实际 0 判过；「重试≤N」「首个动作」决定整题过不过 → `agent-param-eval-judge.test.mjs` 红。
- 这一类会从哪回来：新加的准入检查（新抛出点不带镜头）——定位在聚合处加，抛出点不用管；补镜头入口——同一个 `admitDraftShots`；单镜起草——一镜，定位就是它自己；对外 MCP——同一份清单与正文。
- 自验命令：`pnpm exec vitest run electron/agentLane electron/shared/agentLane electron/capabilityCore/draftShotsAdmissionAll.test.ts`、`tests/agent-runtime` 全部、`pnpm test`、`pnpm run gates:contracts`、`pnpm run typecheck`、`pnpm run build`、`pnpm run check:self-written`、`node tests/ux/agent-param-eval-real-model.walk.mjs --dry-run`、`node tests/ux/agent-tool-failure-boundary.walk.mjs` 与 `node tests/ux/agent-generation-problem.walk.mjs` 中英各一遍。
- 真模型（协调跑，花大脑模型文字费）：见报告「协调跑真模型的命令」。
- 回滚：revert 本 PR 的提交（判据一个提交、产品一个提交，可分别 revert）。独立验收：另一条线按本清单核。
