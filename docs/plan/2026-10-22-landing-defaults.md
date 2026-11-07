# 设计卡：Agent 定的参数落到画布节点上要原样留住（F-landing-defaults）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：落地线带变体（PR-a）+ 视频比例默认值收进一处（PR-b）   线：F-landing-defaults   类别：[花钱][其他]
```

背景：核查报告 R-d2-defaults（协调私有区）第一节 #1、#2。D2「聊天元素 = 画布节点、确认只按节点花钱」的前置：**Agent 定的 = 节点上的 = 实际发出的**。
复盘：`docs/audit/2026-10-22-landing-projection-direction-check.md`（两处落地文件已是 14 天内第 3 / 5 个 fix）。

### 功能分类
- [x] 花钱（变体决定发出型号与扣费档）
- [ ] 新界面 / 改交互（不改界面，只改节点 meta 的来源）
- [ ] 长跑 / 可打断
- [x] Agent 行为（Agent 落地的节点）
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [ ] 新增功能 / 性能

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当 Agent 起草了 Seedance 2.0 标准 / Mini、Veo 3.1 Quality / Lite，或比例写成 9:16 / 21:9 时，我想在画布节点上看到同样的变体和比例，在节点上点 ↑ 发出的也一样，以便「卡上说的、节点上看的、扣的」是同一份。步骤：①对 Agent 说「用 Seedance 2.0 标准版、竖屏」②卡片 / 节点落地 ③点开节点 ④节点上点 ↑。**不做**：参考图落节点（#3，等 #1269）、重绑定冲掉用户改动（#4，归 D2）、Agent 路参考类方式的缺省（#5，a/b 之后再报）。真实任务：Seedance 2.0 Mini 9:16 一镜；Veo 3.1 Lite 16:9 一镜；Kling 3.0 9:16 一镜。主指标：13 个 APIMart 模型 × 变体 / 比例格子里「节点显示 = 卡 = 节点路请求体」的比例（量具：`electron/parity/landingProjectionParity.test.ts`，基线 = 报告 #1/#2 的不一致格，目标 100%）；护栏：用户手建视频节点仍得 16:9（量具同上 + `NodeParameterControls` 挂载测试）。 | 报告 probe-variant.json / probe-render.json；新增 parity 测试 |
| ★1b 连带界面 | 节点生成框里的变体条（VariantBar）、比例 chip、批量估价读节点 meta——落地后显示所选变体 / 比例；付费卡、Agent 回执不变（它们本来就读候选）。没有新文案。 | 截图（zh/en 各一张，Agent 落地节点的变体条与比例 chip） |
| ★2 谁说了算 | 「候选 → 节点 meta」的投影只有一个 owner：主进程 `candidateWire`（候选→落地报文，按 `PlanCandidate` 的**每个键**显式归类）+ 渲染层 `plannedInputFromCandidate`（报文→`buildPlannedNodeMeta` 入参，首落与重绑定共用）；变体答案仍只问 `resolveArchetypeVariant`。视频比例默认值只有一个 owner：铺默认值的那一族（选模型 / 自动选模型 / 连线手势），**挂载 effect 删除**。同一份事实 1 份；不靠「打开节点」去猜意图。 | `node scripts/door-map.mjs buildPlannedNodeMeta / candidateWire / videoAspectDefaultPatch` |
| ★3 一致与复用 | 复用 `buildPlannedNodeMeta`（已认 `variantId`，只是落地线没喂它）、`resolveArchetypeVariant`、`preferredVideoAspect` / `videoAspectDefaultPatch`、parity 夹具 `generationParityTestUtils`；不新造变体判据、不新造比例判据。渲染层 `MaterializeShotCandidate` 改为从共享线类型派生，不再手抄第二份。 | `git grep MaterializeShotCandidate` |
| ★4 全状态 | 模型可用：节点 = 所选变体 / 比例。模型不可用（`buildPlannedNodeMeta` 回 undefined）：照旧只写 prompt + 候选戳，节点向用户明说缺口（现有 candidateModelUnavailable 提示），不猜别的模型或变体。候选变体非法：`canonicalArchetypeVariantId` 丢弃 → 默认变体，与宿主同一判据（宿主早已拒非法变体）。旧项目已落的节点：不迁移，打开不改（PR-b 之后连比例也不改）。 | 单测 |
| 5 中途表 | 只动「落地那一拍写进节点的值」，不加新的异步步骤、不改派发 / 扣费时序；停 / 关窗 / 断网 / 重启 / 连点的行为与现状相同（落地幂等章不变）。 | 不适用：无新状态 |
| 6 外部数据与失败 | 外部来源只有供应商请求体，用本机假上游抓（不花钱）。 | parity 夹具 |
| 8 真实条件 | Windows：是；真付费：`unverified`（任务书不花钱；请求体在本机假上游逐格核过）；英文界面截图：PR-a 交 zh/en 各一张。 | 截图路径 |
| 拍板图清单 | 不适用：不改界面布局，只改节点 meta 的来源 | — |
| ★9 验收与回滚 | 验收按下面「验收清单」逐条；回滚：revert 本 PR 的提交（落地线回到不带变体，行为回到现状，无数据迁移）。独立验收：花钱类，合并前另一条线核本卡清单。 | `## 独立验收` |

## 验收清单（实现前写）

### PR-a：落地线带上变体

入口（`door-map` 数出）。主进程只有一个投影口 `candidateWire`（door-map：1 扇），所有 Run 落地都经 `buildMaterializeShotsPayload` → `production.materialize-shots` → 渲染层 `materializeShots`，在渲染层分成「新建」「重绑定」两扇；另有两扇不经落地报文但也写 `buildPlannedNodeMeta`。

| # | 入口 | 检查（反例 → 期望） | 量具 |
|---|---|---|---|
| a1 | 首次落地：确认即落 / 派发前落地（`landCanvasForRunOrThrow` → `candidateNodeArgs` → `create_canvas_nodes` → `applyCanvasToolCall` → `buildPlannedNodeMeta`） | 候选 Seedance 2.0 `variantId: standard` / `mini`、Veo 3.1 `quality` / `lite` → 新建节点 `meta.archetype.variantId` = 同值；节点 `currentArchetypeVariant` = 同值 | parity 测试（真函数串） |
| a2 | 同上，节点路请求体 | 上面的节点过真 `buildCatalogTaskRequest` + 真 `runTask`（本机假上游）→ body.model = `seedance-2.0` / `seedance-2.0-mini` / `veo3.1-quality` / `veo3.1-lite`，且 = 宿主路（真编译 + 真 provider）同一镜的 body.model | parity 测试（假上游抓真请求体） |
| a3 | 草稿投影 / 追加镜头（`generation.plan` extend 后新增的镜走同一个新建扇） | 追加的镜带变体落地 = a1；已落的旧镜 revision 没变 → 一个字不动 | 单测（materializeShots 两轮） |
| a4 | 重绑定（`rebindLandedShots`，候选 revision 变新） | 节点原是 fast，候选改成 `mini` revision+1 → 节点 variantId = mini；候选从 mini 改回不写变体（宿主补 fast）→ 节点 = fast | 单测 |
| a5 | 外部 Agent 落地（MCP `draft_shots` → 宿主 → `landBeforeDispatch`，隐藏主窗口打开项目） | 与 a1 同一报文、同一函数：报文里 `candidate.variantId` 存在 | 单测（`buildMaterializeShotsPayload` 输出含 variantId） |
| a6 | 单镜计划（`plan.candidate`，没有 shots[]） | 投影成一镜时同样带 variantId | 单测 |
| a7 | 打开项目对账 / Run 跟随（`existingOnly`） | 只动已有节点，不重绑定候选——带了变体也不改节点（护栏：不冲掉用户在节点上切过的变体） | 单测 |
| a8 | Agent 直写 `canvas.write create_canvas_nodes`（`applyCanvasToolCall` 直接读 `node.variantId`） | 现状已带；回归：variantId 写什么节点就是什么 | 现有 `canvasWriteTarget` 测试 + parity |
| a9 | 分镜投影 / 分镜底栏（`storyboardProjection` / `storyboardComposerModel` 调 `buildPlannedNodeMeta`） | not-affected：分镜行没有变体轴（StoryboardPlan 不存 variantId）；只核「换模型时不残留旧变体」现状不变 | 读码 + 现有测试 |
| a10 | 不越线 | 落地报文**不含** `transportModelId` / 密钥 / URL（逐字段归类表编译期强制）；发出型号由节点变体在节点路自己推 | 类型测试 + 单测 |
| a11 | 类级（全部内置目录，不只 APIMart） | 真实内置目录里每一条「带 ≥2 个变体」的行 × 每个变体：候选 → 报文 → 节点 meta 的变体 = 候选变体（Seedance 各家、Veo、Wan 3.0 prime、Hailuo、Vidu、Dreamina / Qwen 图片……新接一个带变体的模型自动覆盖） | parity 测试 |
| a12 | 结构 | 给 `PlanCandidate` 加一个新键而不在 `candidateWire` 归类表里归类 → `typecheck` 红；给 `PlannedNodeModelInput` 加新键而 `plannedInputFromCandidate` 没处理 → `typecheck` 红 | 类型级测试（`// @ts-expect-error` 夹具） |

**APIMart 13 模型 × 变体格子（a2 的展开）**：Seedance 2.0 × {standard, fast, mini, 不写}、Veo 3.1 × {quality, fast, lite, 不写}，每格：节点 variantId = 候选 variantId；节点路 body.model = 宿主路 body.model。其余 11 个模型没有变体：每个模型「不写变体」一格，节点 meta 不出现变体分叉、两路 body.model 相同。

### PR-b：视频比例默认值收进一处

| # | 入口 | 检查（反例 → 期望） | 量具 |
|---|---|---|---|
| b1 | 挂载（删 `NodeParameterControls` 里的比例 effect） | Agent 落地的 Kling 9:16、Veo 9:16、Seedance 2.5 21:9 节点挂上 `NodeGenerationComposer` → meta 一个字不变（今天变 16:9） | 真组件挂载测试（仓库 react-reconciler 渲染器） |
| b2 | 挂载 | Agent 没写比例、落地是档案默认（Seedance 2.5 文生 adaptive 等）→ 打开节点不改（见下「要拍板 Q1」） | 同上 |
| b3 | 新建节点自动选模型（`useNodeModelAutoSelect`） | 用户在画布手建视频节点、没连输入 → 16:9；从竖图拖出新视频节点（建节点时已有输入边）→ 9:16 | 挂载测试 |
| b4 | 选模型（`buildNodeModelChangePatch`） | 现状保持：换模型按「首选 16:9、输入全竖 9:16」重铺 | 现有测试 |
| b5 | 连线手势（见「要拍板 Q2」） | 推荐方案下：用户把竖图连进一个没显式选过比例的视频节点 → 9:16；节点比例是用户选的或 Agent 写的 → 不动 | store 单测 |
| b6 | 显式标记 | Agent / 分镜写了合法比例 → 落地时记成「显式选过」（沿用 `aspect_ratio_user_set`），连线不再改它 | 单测 |
| b7 | 旧项目 | 打开存量节点（比例不是 16:9、没标记）→ 不改（今天会被改） | 挂载测试 |
| b8 | 13 模型比例格子 | 9 个视频模型 × {Agent 写 9:16 / 21:9 / 不写}：节点显示 = 节点路请求体比例（Kling i2v、Veo 参考 / 首尾帧「比例由图决定、不发」照旧不发，报告 #7 不在本次） | parity 测试（假上游） |
| b9 | 结构 | 全仓 `videoAspectDefaultPatch` / `preferredVideoAspect` 的调用只在铺默认值那一族（door-map 计数写进合同）；组件挂载 effect 里不再有写比例的路 | door-map + 合同 |

### 拍板结果（用户 2026-10-22「按推荐」）

- 复盘按「换」；Q1 = 档案默认；Q2 = A（连线那一刻算，只改没被明确选过比例的视频节点；Agent / 分镜写过的合法比例落地时记为明确选过；断线、删上游不回头改）。

### 当时的拍板题（原文留档）

- **Q1 Agent 没写比例时，落地节点用什么？** 推荐 **档案默认**（= 卡上显示 = Agent 路实际发出，今天三处一致，只有挂载 effect 把节点改成 16:9）。另一选项「落地也套 16:9」会让 Seedance 2.5 文生 / Wan 3.0 文生 / MiniMax H3 参考这几格变成节点 16:9 ≠ 卡 / Agent 路 adaptive，直到 D2 删掉卡那份为止。
- **Q2 删掉挂载 effect 后，「已连输入全竖才 9:16」在连线时还算不算？** 今天这个 effect 同时管三件事：挂载、换模型、输入边变化。推荐 **A：连线手势那一刻算**（放在 `writeCanvasEdge` 里，与连线自动切模式 `autoPromoteTargetModeForEdge` 同一处，只改「没显式选过比例」的视频节点）；断线 / 删上游不再回改。B：只在选模型 / 新建时算，之后连线一律不改（最简，但「先建视频节点再拖竖图进来」不再自动变 9:16，是 07-17 规则的主场景）。C：连线、断线、删上游都算（完全保留今天的行为，但门多：单连、组连线物化、断线、删节点、粘贴，`canvasGraphActions.ts` 已是 14 天第 7 个 fix）。

## 修前基线（特征测试 `electron/parity/landingProjectionParity.test.ts`，2026-10-22，@203886f10）

共 85 格：52 格今天对得上，33 格今天对不上（`it.fails` 标出，本机假上游，零花费）。
- 类级（全部内置供应商、每个带变体的视频行 × 每个变体，52 格）：27 格对不上。其中 24 格是「显式选了非默认变体 → 落地节点回到默认变体」（APIMart Seedance 2.0 / Veo 3.1 / Vidu Q3 / Hailuo 2.3，KIE Seedance 2 / Wan 3.0，火山 Seedance 2.0，Dreamina Seedance 2.0，Runway Seedance 2 ×3 行 / Veo 3.1 ×2 行 / Wan 3）；另 3 格是 Runway wan3 的**另一类**：宿主归一把候选 modelId 换成档案 `catalogModelKey`（KIE 那一行的 `wan/3-0-video`），落地节点认不出模型（不在本 PR 范围，已报协调）。
- APIMart 请求体（21 格）：6 格节点路 body.model ≠ 宿主路——Seedance 2.0 standard / mini、Veo 3.1 quality / lite、Vidu Q3 mix、Hailuo 2.3 fast。
- APIMart 比例（11 格，Agent 写 9:16）：落地节点 = 节点路 = 宿主路，全部对得上——比例那一处的元凶只在挂载 effect（PR-b 用真组件挂载测试钉）。

## 后续（不在本次）

- **D2**：节点成为唯一数据源时，落地改走同一个「铺默认值」owner，统一到 07-17「视频首选 16:9」（今天 Q1 选档案默认，是为了节点 = 卡 = Agent 路三处一致）。
- **PR-c（另排，协调已派）**：宿主归一把供应商自己的型号名换成共享档案的 `catalogModelKey` / 变体 key（`mcpGenerationVideoResolve.ts` 的 `videoCandidateForPlan` / `videoTransportModelIdForPlan` / `normalizeVideoCandidate`）——Runway wan3 / Seedance 2 三行 / Veo 3.1 两行；本 PR 的特征测试里 Runway wan3 那 3 格仍以 `it.fails` 标着。
- 报告 #3 参考图落节点（等 #1269）、#4 重绑定冲掉用户改动（归 D2）、#5 Agent 路参考类方式的发出缺省（a、b 之后报协调再定）。

## PR-a 修后（本 PR）

特征测试 85 格：82 格对得上，剩 Runway wan3 那 3 格（PR-c 那一类）仍是 `it.fails`。渲染层真 `materializeShots` 两扇门：`src/workbench/capability/landingCarriesVariant.test.ts` 6 格。
结构门实测：给 `PlanCandidate` 加一个键 → electron tsc 在 `CANDIDATE_LANDING_FIELDS` 报 TS2741；给线类型加一个字段 → app tsc 在 `LANDED_CANDIDATE_FIELDS` 报 TS2741（验完已还原）。
