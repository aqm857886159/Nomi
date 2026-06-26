# 2026-06-26 把「给定意图→自己做对」做成通用自纠闭环（研究 + 设计 + 决策）

> 用户问（复述）：把这次手工修姿势的过程**通用化**——提炼通用计算逻辑/通用件，**灌给 agent 让它给一个东西就能自己做好**；要**反馈闭环**(截图发现问题→自己改)、**最少成本得到最好结果**。研究怎么做。

## 0. 一句话结论（底层逻辑 D6①）

**这不是从零造，是把一条「可靠且几乎免费的视觉验证器」插进 Nomi 已有的自改进闭环。**
- Nomi 早有自改进闭环 `evals/loop/`（诊断 agent≠修复 agent、可靠验证器是命门、改进则固化/退步则回滚）——见 `docs/plan/2026-06-21-self-improving-harness-loop.md`。它只缺**视觉域的可靠验证器**（视觉「好不好」最难自动判，正是闭环乘法里最容易变 0 的那一项）。
- 这次姿势工作正好产出了那个验证器：**确定性结构检查**（蒙皮几何落地 + 像素结构：地面/网格/投影）几乎零成本，能确定性地抓悬空/陷地/断渲染；VLM 只兜「像不像那个姿势」的主观残差。
- **最省钱的形态（2026 业界共识 = 分层验证，见 §2）**：免费确定性检查先跑、且只在它过了才花 VLM；只在失败时才纠；设迭代预算。

## 1. 你要的「通用逻辑」已经提炼出来了（核心资产）

| 通用件 | 形态 | 状态 |
|---|---|---|
| 蒙皮几何落地（任何姿势鞋底/膝盖精确贴地，不靠手调高度）| `scene3dMath.lowestMannequinLocalY` | ✅ 已上线（本周） |
| 多视角诊断出图（hero+5 环绕，接触投影判落地，偏轴避遮挡假阳性）| `stagingShots.tsx` + walk | ✅ 已上线 |
| 免费确定性视觉验证器（落地/地面/网格/投影 像素断言）| walk 结构断言 | ✅ 已上线 |
| 姿势计算 cheat-sheet（脚轴向±、腿/髋/臂角、相机可读性、审查相机指引）| skill `nomi-pose-staging-calibration` | ✅ 本次落地 |
| 自纠闭环骨架（诊断→修→重跑→eval-diff→固化/回滚）| `evals/loop/loop.ts` | ✅ 已存在（单 lane） |

**「灌给 agent」的最便宜形态**=把方法论+cheat-sheet 沉淀成 **skill**（本次已建 `nomi-pose-staging-calibration`）。任何后续 session 给一个新姿势意图，load 这条 skill 就照「免费验证器先行→probe→VLM 兜底→诊断≠修→重跑收敛」的流程 1-3 轮做对，不重新踩坑。零运行时成本、可逆、加法。

## 2. 研究：最少成本怎么来（分层验证，2026 共识）

业界一致做法是**最便宜的先、贵的留到最后且只在前面过了才跑**：
- Tier 1 确定性检查（≈0 成本，跑 100%）：schema/格式/几何/像素结构。我们的落地+地面+投影结构断言属此层。
- Tier 2 工具/oracle 验证：有 ground-truth 时直接用代码判，**跳过 LLM**。我们的蒙皮最低点 Y、像素采样属此层。
- Tier 3 LLM/VLM judge（最贵，保留）：只判没有便宜 oracle 的主观自然语言/美感问题（「像不像求婚跪姿」「朝向对不对」）。且 **VLM judge 在复杂任务错误率 >50%、专家一致性仅 64–68%**——是信号不是真理，必须校准(P/R≥80%)、且永不当唯一优化靶子。
- 选择性触发：只在失败时才纠；任何纠错循环必须有 token/时间/迭代**预算**，否则变成成本黑洞或死循环。

这与 Nomi 闭环既有铁律完全一致（诊断≠修复防自偏 = 生成-验证分离；裁决靠重跑差不靠 agent 自评）。来源见文末。

## 3. 三种交付形态（决策表 · R3）

| 形态 | 是什么 | 成本 | 用户/agent 看到 | 何时值得 |
|---|---|---|---|---|
| **F1 校准 skill**（✅本次已做）| 方法论+cheat-sheet+harness 命令沉淀成 skill | 一次写，运行时 0 | 后续任何 session「给个新姿势」load 即会做 | 立刻；最便宜、最durable |
| **F2 姿势-站位 lane 插进自改进闭环**（**推荐下一步**）| 复用 `STAGING_TEST_CASES`(数据集)+结构指标(免费验证器)+`vlmJudge`(贵,gated) → 诊断(轴向/落地)→修(改预设增量)→重渲→eval-diff 固化/回滚 | 本地渲染+结构=免费；VLM 仅残差、按需 | 自动跑全姿势库出「哪个姿势退化了/新姿势达没达标」，截图→发现→改→重跑全自动 | 想要真正自主的截图-自纠循环 |
| **F3 运行时自纠**（产品侧，**暂缓**）| Nomi 生成 agent 出站位图后自渲染自检再给用户 | 每次用户操作 +VLM+延迟（真花钱）| 用户永不看到坏姿势 | 仅对 `customBlocking` 自由造型有用；12 个预设已校准好，不值 |

## 4. 推荐路径 + F2 具体设计

**推荐：F1 现在(已做) → F2 下一步(需你拍板范围) → F3 暂缓。**

F2 的集成缝（来自对 `evals/loop/` 的实查；现闭环是**单 lane 硬编码**，无 lane 注册表）：
1. **数据集**：直接复用 `src/devlab/stagingTestCases.ts` 的 `STAGING_TEST_CASES`（已是单源，和 `stagingPoses.test.ts` 共用），代替 `personas.mjs`。`check`/`expect` 字段就是现成的 `vlmJudge` 提问。
2. **driver**：`driveStagingScenario` —— 要么解析 walk 的 `_stagingshot/_summary.json`（结构指标已在），要么离线直调 `buildStagingScene`+`scene3dMath` 出图（像现 `driver.ts` 直调 `canvasGraph`）。产出 `StagingTrajectory{ structPass, floorOk, shadowOk, vlmAnatomy?, ... }`。
3. **scorers**：新 `createScorer`——结构通过率(免费) + VLM 解剖/朝向判(`chatVision`，gated)。放进 `OBJECTIVE_SCORERS`/`SEMI_OBJECTIVE_SCORERS`，`runAll` 自动拾取。
4. **LearnedDefaults**：加可学字段（如 per-pose 脚踝/膝增量、站位间距默认），`cloneDefaults` 同步。
5. **闭环参数化**（真正要改的）：`metrics.ts` 把硬编码 import、`loop.ts` 把硬编码 `TARGET` 和 round-2 坏 patch 抽成 `Lane{ id, runAll, target, makeBadPatch }`，`loop.ts` 迭代多 lane。`round`/`Proposer` 本就 lane 无关，只需 `runAll`/`avgOf` 按 lane 传入。**加法重构，不动现有 canvas-graph lane。**
6. **复用模型**：VLM 走 `appBridge.chatVision`（复用 app 已配视觉模型，safeStorage 主进程解密范式），无需用户手填 key。

成本画像：跑一遍全姿势库——本地渲染 0、结构断言 0，仅「结构没过/要判主观」的少数例花 VLM（几分钱级），1-3 轮收敛。

## 5. 顺带发现（实查）

- `evals/loop/report.ts:7` import 了**不存在**的 `semiObjectiveEnabled`（`semiObjective.mjs` 没这个导出）→ `report.ts` 一跑就 import 抛错。已存在的潜伏 bug，做 F2 时顺手修，或单独切片。

## 6. 验收门（F2 真做时）

五门绿 + 闭环自测：注入一个坏姿势增量 → 结构/ VLM 分跌 → 自动回滚（exit 非 0 即证机制活，照搬现 `loop.ts` round-2 对抗控制）。

## 7. 执行（用户拍板 F2+F3+bugfix · 2026-06-26）

**关键设计约束（实查得出）**：假人**落地是自动的(蒙皮最低点)、结构断言是 harness 不变量**——都改不动于姿势角度。
所以**唯一可靠的姿势「形状」信号是 VLM(贵/gated)**。这正坐实分层：免费的落地/结构当**常驻预滤+回归探测**，VLM 当**gated 形状裁判**。最省钱 = 免费层永远先跑、VLM 只判残差且只在 fix 模式+配了视觉模型时花。

落地件：
- **F2-a 姿势覆盖层**(`stagingShots` 读 `?ov=<base64>` 增量叠加预设；walk 透传 `OVERRIDES` 文件)——fix agent 改姿势的可回滚载体，不碰 `scene3dConstants` 源(P1，调好再人工固化)。
- **F2-b 探测 lane**(`evals/loop/poseLane.mjs`)：driver = 跑 walk → 解析 `_summary.json`(逐例结构 pass + 落地) → rows；scorer `staging-structural-pass`(免费) + `staging-anatomy`(VLM gated，复用 `appBridge.chatVision`)。
- **F2-c 闭环+自测**(`evals/loop/poseLoop.mjs`)：复用 `loop.ts` 的 `round()` 裁决范式(诊断≠修、重跑差裁决、涨固化/跌回滚)。自测用确定性 mock 指标证「注坏→探测到→回滚」机制(免 VLM/app 可验)；真形状 fix 走 VLM-gated(配视觉模型时 exercise)。
- **F3 运行时自检**(生产 staging 路径)：出参考图后用**免费**蒙福最低点自检每个角色是否落地，未落地则保守纠正/标记——**零 per-user API 成本**(几何自检不花钱)，治自由造型/多角色边角。

验收：五门绿；poseLoop 自测退出码 0(机制成立)；F3 真机走查(R13)出图角色落地。

## 来源
- [Tiered agent evaluation / LLM-as-judge](https://medium.com/@vinodkrane/chapter-8-agent-evaluation-for-llms-how-to-test-tools-trajectories-and-llm-as-judge-788f6f3e0d52)
- [LangChain: calibrate LLM-as-judge, rules first](https://www.langchain.com/resources/llm-as-a-judge)
- [Online self-correction loop（选择性触发+预算）](https://www.emergentmind.com/topics/online-self-correction-loop)
- [ReVeal: self-evolving via reliable self-verification](https://arxiv.org/pdf/2506.11442)
- [CoVerRL: generator-verifier 共演化(破共识陷阱=诊断≠修复)](https://arxiv.org/pdf/2603.17775)
