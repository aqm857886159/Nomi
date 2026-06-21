# 自我改进 harness 闭环：AI 扮用户跑测试 → 量化诊断 → 修 → 重跑，让 Nomi 自循环变好

> 2026-06-21。起点：用户问「怎么给 Nomi 构建一个 loop，让系统逐步、自循环地变好」，要求看相关论文/项目。
>
> 三轮对话 + 调研推演 + 两次用户纠偏后收口的方向（本文 §0/§1）：
> - **机制不是"等真实用户改、我去捕捉"**，而是 **AI 扮演用户、自动跑测试、产出量化指标，让创始人"有数"**（用户原话）。更 solo 友好：**一个人今天就能跑，不用等任何真实用户**。
> - **核心架构铁律（用户拍板）**：**查问题的 agent ≠ 修复的 agent，二者独立，谁也不替谁说话**——根治"同一 agent 既生成又自评"的自偏退化（Reflexion/Self-Refine 在无外部信号时倒退的根因）。
> - **唯一没变的命门**：可靠的**验证器**。AI 当用户去**驱动系统、产客观指标**可信；AI 评**主观美感当唯一优化靶子**会被刷分——两者必须分层（§3.2）。
> - **solo 可达性（诚实）**：只做冻结模型那半（AI 跑测试 + 改 harness/默认值），**不碰权重 RL、不碰大规模环境合成训练**（要 GPU，大厂的）。

---

## 回填 · 执行结果（2026-06-21，分支 `feat/self-improving-loop`）

**用户已拍板（本轮）**：① 迁移到 Mastra —— 去做。② 人格/场景初始集 = **尽量覆盖每一类用户**（每类都能在 Nomi 用好）。③ 在**隔离 worktree** 干（避开并行分支脏树）。

**S1 已交付（隔离 worktree，离线零额度跑通）**：
- `evals/loop/personas.mjs` —— 8 类用户人格 × 场景（新手/短视频/叙事/品牌/二次元/专业精修/教育解说/音乐MV），每条带能力族 + 成功标准 + 真实摩擦；`NOMI_CAPABILITIES` 诚实标缺口（lipsync/beat_sync/music_gen 暂无）。
- `evals/loop/scorers.mjs` —— 5 个**客观打分器**（task-completion / error-free / retry-efficiency / capability-coverage / connection-validity），纯 JS `createScorer().generateScore()`，零 LLM、零网络。
- `evals/loop/runLoop.mjs` —— 离线 runner：8 人格 → mock target → 5 维指标表 + 总览均分 + 缺口诚实标。**实跑结果**：7/8 人格服务良好，音乐 MV 当场暴露缺口（completion 0 / coverage 0.60，缺 beat_sync+music_gen）。
- `evals/loop/_smoke.mjs` —— 最小离线证明（已验 `scorer.run()` 纯客观路径跑通）。
- ⚠️ **mock target 是占位**：按 `NOMI_CAPABILITIES` 推轨迹（"有能力即成功"，1.00 偏乐观）。真实质量要 S2 接 capability-core 才出。

**实查发现（R5，改架构）**：
- `@mastra/core@1.45.0`：`createScorer` / `runEvals` 确认真导出，**纯客观打分离线跑通**（不碰 `ai`/网络）。
- ⚠️ **peer 冲突**：Mastra 1.45 要 `ai@^6`，Nomi 在 `ai@4.3.19`。**客观路径不受影响**（不走 `ai`）；但 **Mastra Agent / LLM-judge scorer 会撞**。→ **架构决策（S2 前定）**：loop 子系统的 Mastra 依赖须**与产品运行时的 `ai@4` 隔离**（独立 workspace 包 / 自带 `ai@6`），别污染产品。这反而强化「loop 是独立子系统」的边界。
- `runEvals` 的 `target` 必须是 Mastra **Agent / Workflow**（非任意函数）→ S2 把「合成用户驱动」包成 Mastra Workflow/Agent。

**S2 已交付（离线零额度，真 Nomi 领域逻辑）**：
- `driver.ts` —— 用 `capabilityCore/canvasGraph` **真纯函数**(`addNodes`/`connectNodes`)按场景建图,产出真实客观信号(连边/skip/语义边正确性);真 vendor 生成 stub(额度门后)。从 S1 mock 升级为真领域逻辑。
- `diagnose.ts`（查 agent）+ `fix.ts`（修 agent）—— **独立单向**(查只诊断、修只提改、修不自评),规则版零 LLM;`llmAgents.ts` = LLM 升级版(直连 fetch 绕开 ai@6,**需 `NOMI_LOOP_LLM_*` key,缺则自动回退规则版**)。
- `loop.ts` —— 闭环:查→修→重跑→eval-diff 客观裁决→涨固化/跌回滚。**实跑验证**:语义边正确性 0.500→1.000 固化、注入坏 patch 1.000→0.500 自动回滚;带硬断言(失败退出码非零)。镜像真 Nomi bug 类(边模式语义,见 connection-reference/T8);顺带实查暴露 `image_ref` 无专用边模式→归 `composition_ref`。
- `driver.test.ts` —— vitest 5 测(已加进 `vitest.config.ts` include,进 test 门),纯逻辑零 Mastra。

**S3 已接（结构 + 三重门,未启用）**：`semiObjective.mjs` —— 独立批评 agent(VLM)查画面元素/一致性,直连 fetch。⚠️ **三重门**:① 额度(真生成才有图)② VLM key(`NOMI_LOOP_VLM_*`)③ 人工校准 P/R≥80%。缺则跳过、不假装判主观;**永不当唯一优化靶子**。

**S4 已交付**：`report.ts` —— dev-facing 仪表盘(非产品 UI,不走 R8):真 driver 跑 8 人格 → 6 维客观指标表(控制台 + 落 `report.md`)+ 缺口诚实标(音乐 MV 缺 beat_sync/music_gen)。

**依赖卫生**：`@mastra/core` 放 **devDependencies**(评测/dev 工具,不随产品发布)→ `ai@6` peer 仅 dev 警告,产品 runtime 不受影响,合并 main 干净。

**LLM 查/修已在用户模型上跑通(2026-06-21,不再是门控)**：`llmViaApp.mjs` 复用 Nomi app **已配置的文本模型**(自动挑 enabled,免用户手填 key)——照 `r1-upload-verify.mjs` 自解密范式:启真app→主进程 safeStorage 解密→主进程内 fetch(明文key不出主进程)。`NOMI_LOOP_USE_APP_LLM=1 tsx loop.ts` 实跑(modelscope/Qwen3-Next-80B):**查诊断对 + 修产正确 patch(含 image_ref→composition_ref)→ 0.500→1.000 固化、坏patch回滚 exit 0**。⚠️约束:启真app须 Nomi 关着(单实例锁)。默认路径仍走规则版(快、不启app)。调试教训:查须被告知可用杠杆才在行动空间内诊断、修须被告知语义映射方向。

**半客观 VLM 层已在用户视觉模型上跑通(2026-06-21,提交 3b28334)**：`appBridge.mjs`(收敛 `llmViaApp`,P1)统一复用 app 已配的文本/视觉模型——`chatVision` 走 `moonshot-v1-128k-vision-preview` 实跑:Q"有文字吗"→`{pass:true,1}`、"有动物吗"→`{pass:false,0}` 全对。坑(已修):视觉模型不抓外部URL要 base64、不支持 `response_format`、Node 抓图过不了代理 → **全挪主进程抓图转 base64**(主进程有代理/session)。`semiObjective.mjs` 复用之、稳健解析 JSON。

**真生成 → 半客观 整条链已打通(2026-06-21,提交 d15db0d)**：经 Nomi 真 `runTask` 出图(**不重写轮询,P1**),为此修了 headless 真生成的**三个真缺口**(此前「E2E 未跑」):
- `core.ts` **付费逃生口**:env `NOMI_LOOP_SPEND_OK=1` 才铸 spend grant 过付费守卫。⚠️**红队不变量不动**——默认不开则 AI/程序化路径仍铸不了令牌、被硬拦;开了=评测脚本本进程显式授权,等价 GUI 点确认。
- `host.ts` 补 `applySystemProxy`(headless host 此前无代理 → 代理后机器 vendor fetch 全失败)。
- `core.ts` 图像异步轮询 120s→240s(gpt-image-2 异步实测 120–240s 才出图)。
- **实证**:apimart/gpt-image-2 `status:succeeded` 出真图 → moonshot 视觉 VLM 判定全对(蛋糕✓蜡烛✓无车✓)。**每层都在用户自己的模型上跑通**。

**仍卡的(诚实标 · D4)**：① **人工校准** = VLM judge 正式采信前须几条人工标注验 P/R≥80%(`CALIBRATION_THRESHOLD`);② **主观美感** = 创始人抽查,不自动化;③ **loop driver 接真生成** = 现 `driver.ts` 用 canvasGraph 纯领域层(离线);把每场景的真生成+VLM 编进 driver 是工程接线(每跑全人格真生成烧额度,按需开)。**迁移收尾**:删旧 `scripts/eval-run/score/diff.mjs`。

---

## 0. 一句话战略定位（为什么、底层逻辑、用户体验）

**底层逻辑（D6 ①）**：一个系统只能变得和它对「好」的定义一样好。自循环变好 = `可靠验证器 × (生成 + 择优 + 记忆)`，**乘法**——验证器假则全盘 0。难点在「验证器从哪来」：真实用户信号要等用户、量小；自评会自偏。**解法 = AI 扮多种用户人格 × 多场景驱动 Nomi，产出机器可判定的量化指标当验证器；查/修两个独立 agent 防自偏。**

**会发生什么（D6 ②）**：一台离线测试泵——合成用户跑创作旅程 → 独立「诊断 agent」从执行轨迹算出量化指标 + 定位弱点 → 独立「修复 agent」提改进（harness 提示词 / 默认参数 / 工具）→ 重跑，数字动。创始人看一块**仪表盘**就知道「管线对不对、效率高不高、哪类场景常崩」=**有数**。

**用户体验（两类人）**：
- **创始人（主）**：打开一块量化仪表盘，知道每次改动让哪些指标涨了/跌了；改 harness 不再凭感觉，有数。
- **终端用户（受益）**：他照常创作，但拿到的默认值/提示词/拆镜头，是被 AI-用户测试反复打磨过的版本——更少踩坑。

**solo 战略对齐（D2）**：护城河 = **你的测试场景集 + 你的"好"的定义**，编码你的品味与你用户的真实失败分布，通用 benchmark 永远供不上。且是 2026 前沿里**唯一不需要 GPU、你够得着的那根杠杆**。

---

## 1. 调研真相源（2026 前沿，带链接）

### 1.1 两根支柱与本方案的取舍
- **支柱一 · harness 自我改进（冻结模型，solo 可达）**：[Meta-Harness](https://arxiv.org/abs/2603.28052)（外循环 agent 改 harness 代码，模型冻结；原文「这套工作流 2026 年初才可行」；已有 [Claude Code 插件 harness-evolver](https://github.com/raphaelchristi/harness-evolver)）、[Hyperagents](https://hyperagents.agency/)（agent 与改进器共进化；**关键发现**：自改进会独立收敛出「持久记忆/性能追踪/多阶段验证/重试」——给了手工施工图）、[SIA](https://arxiv.org/abs/2605.27276)（双杠杆，**待核**，权重杠杆要 GPU）。
- **支柱二 · 环境合成（要 GPU/RL，本方案只借模式不训练）**：[EnvScaler](https://arxiv.org/abs/2601.05808) / [Agent World Model](https://arxiv.org/abs/2602.10090) / [Agent-World](https://arxiv.org/abs/2604.18292)。**Agent-World 的循环正是本方案骨架**：评估策略 →**独立诊断 agent 从执行轨迹找弱点**→ 定向补 → 重复。我们把它的「RL 更新权重」换成「修复 agent 改 harness/默认值」。
- 全景：[自进化 agent 综述](https://arxiv.org/abs/2507.21046) · [Awesome-Self-Evolving-Agents](https://github.com/XMUDeepLIT/Awesome-Self-Evolving-Agents)。

### 1.2 一张表：哪些抄、哪些不碰
| 2026 工作 | 借什么 | 不碰什么 |
|---|---|---|
| Agent-World 循环 | **诊断 agent 独立于策略**的回路结构 | RL 训练部分 |
| Hyperagents | 收敛组件清单当施工图 + **查/修分离**思想 | 让"改进器"自动改自己（先手工） |
| Meta-Harness | 「读轨迹诊断 → 改 harness」的纯函数边界（后期可接） | 现在不上自动进化 |
| SIA 权重杠杆 / 环境合成 RL | — | **明确不碰（要 GPU）** |

---

## 2. 现状勘查（带 file:line；骨头已长一半）

Nomi 已有正式 harness 框架 `H = (E, T, C, S, L, V) + Subagents + MCP`（`docs/plan/2026-06-11-nomi-harness-master-plan.md` §0）。本闭环复用其全部地基。

### 2.1 评测体系 = 本方案的雏形 ✅
- `scripts/eval-run.mjs`：**隔离 Electron 实例跑真 agent** 做 storyboard 任务 → 画布终态落证 → `output.jsonl`（断点续跑）。= 「AI 跑测试」的雏形，**已在无头跑真实 agent**。
- `scripts/eval-score.mjs`（免费段，可反复重评断言）+ `scripts/eval-diff.mjs`（回归门：pass@k 翻转 / 均分跌即非零退出）。
- `scripts/eval-judge-calibrate.mjs`：**LLM-judge 必须 P/R≥80% 才采信**——这正是半客观层要用的校准门（§3.2）。
- [eval-expansion-v2-plan](docs/plan/2026-06-14-eval-system-expansion.md)：四条 lane 已对标 τ-bench/WebArena/VBench/G-Eval。
- 成本实账（eval-system-master-plan §0）：单 trial 26–50s / 1.6–2.8万 token；全量 15 case ≈$30–80/月。**→ 一扩量就烧额度，§3.3 必须分层省钱。**

**含义**：本方案不是新造，是把「我手动跑几个 case」**扩成「AI 扮多人格 × 多场景自动跑 + 查/修分离 + 量化仪表盘」**（P1：扩现有，不立并行版）。

### 2.2 查/修当前是同一个 agent ⚠️（要拆）
- `gate.ts:15` deny `reason` 注释「人话，回喂 LLM 可自我修正」——当前是**单 agent 当轮自纠**（同一 agent 既犯错又自评），正是要被「查 agent ≠ 修 agent」取代的点。
- `agent.gate.denied{reason}` / `proposal.rejected` / `vendor.call.completed{error}`（master-plan §1.1）= 诊断 agent 的现成轨迹素材。

### 2.3 Hyperagents 收敛清单 vs 现状
| 收敛组件 | 现状 | 缺口 |
|---|---|---|
| 持久记忆 | `electron/memory/projectMemory.ts`（S9）部分有 | 不含测试发现的教训 |
| 多阶段验证 | V 层技术自检 `review.technical.completed` | 无「场景级量化指标」聚合 |
| 性能追踪 | **无** | 没有「改动让指标涨跌多少」的度量 |
| 重试逻辑 | `gate.ts` 单 agent 自纠 | 未拆成独立查/修 |

---

## 3. 目标架构：一台「测试泵」+ 查/修分离 + 分层指标

在 master-plan「一条日志两台泵」上加**第三台泵**（离线、可控频率、查/修分离）：

```
   合成用户人格库 × 场景库（你策展的"好"的定义）
              │  AI 扮用户驱动 Nomi 跑完整创作旅程（隔离实例，复用 eval-run）
              ▼
   执行轨迹 + 终态（落 EventLog / output.jsonl）
              │
              ▼  ★诊断 agent（只查问题，不改任何东西）
   量化指标(三层 §3.2) + 弱点定位(哪类场景/哪个默认值/哪步常崩)
              │
              ▼  ★修复 agent（独立，只提改，看不到"自己出的题"）
   改进 patch：harness 提示词 / 默认参数 / 工具 schema / 失败案例入 eval 集
              │
              ▼  重跑同场景 → eval-diff 比对 → 数字动了没 → 仪表盘
   （涨：固化为新基线；跌/平：回滚 patch）
```

### 3.1 架构铁律（不变量）
1. **查 agent ≠ 修 agent，独立且单向**：诊断 agent 只产「问题 + 指标」，修复 agent 只读问题产 patch，**修复 agent 不参与评判自己的 patch**——它的 patch 由「重跑 + eval-diff」客观裁决，不自评。根治自偏（用户拍板）。
2. **验证器是机器可判定的指标，不是 AI 主观打分**（命门铁律）。
3. **patch 的裁决权在「重跑后的客观指标差」**，不在任何 agent 的嘴。涨才留，跌/平回滚（沿用 `eval-diff` 回归门语义）。
4. **可解释 + 可纠正 + 可回滚**（harness 灵魂「可控的透明」）：每个 patch 带「针对哪个指标、改了什么、重跑前后差」，一键回滚。

### 3.2 指标分三层（哪些 AI 能信）
| 层 | 例子 | AI 当用户/裁判可靠吗 | 处理 |
|---|---|---|---|
| **客观**（脊梁） | 任务完成、报错率、重试次数、archetype 覆盖率、连线校验通过率、参考图可达、成本、延迟 | ✅ 机器可判定 | 直接当验证器，**无校准需求** |
| **半客观** | 生成图是否含要求元素、跨镜头角色一致性、prompt 遵守度（VLM/VBench 式） | ⚠️ 中等，**独立批评 agent + 校准** | 过 `eval-judge-calibrate`（P/R≥80%）才采信，当**带误差条**的辅助指标 |
| **主观** | 美不美、故事动不动人、品味 | ❌ AI 不可信（刷分） | **留给创始人抽查锚定，永不当优化靶子** |

> 半客观层之所以敢放进来：**独立批评 agent（治自偏）+ 校准门（治代理漂移）** 正是让带噪裁判可用的标准配方。

### 3.3 成本分层（不烧爆额度）
- **零额度可测**（绝大多数）：agent 逻辑、连线校验、参数构造正确性、覆盖率、报错处理——**mock 掉生成端**跑（复用「mock new-api E2E」那套），不调真 vendor。
- **花真额度**（一小撮）：只有需要看像素的半客观指标（角色一致性/画面元素）才真生成，且低频、抽样。
- 频率可控：默认手动触发 / 攒够改动触发（接 `check-eval-cadence`），不无人值守烧钱。

---

## 4. 切片排期（每片：范围 / 不动项 / 回滚 / 验收门）

> 原则：先把**测试泵 + 查/修分离 + 客观层指标**跑通（S1-S2）→ 再加半客观校准（S3）→ 再补性能追踪/自动固化（S4）。**先手工触发、确定性裁决，不上自动进化。**

### S1 · 合成用户 × 场景，零额度跑 + 客观指标
- **范围**：`evals/personas/` + 扩 `evals/datasets/`（多人格 × 多创作场景）；扩 `eval-run.mjs` 支持 mock 生成端跑（零额度）；新增客观指标采集器（完成/报错/重试/覆盖/连线校验，纯函数读轨迹）。
- **不动项**：不改生成核 `runTask`；不动 archetype 权威定义；真额度路径保持原样。
- **回滚**：纯新增 + mock 开关，删即回退。
- **验收**：一条命令跑出「N 人格 × M 场景」的客观指标表，零额度；人眼核指标对。

### S2 · 查/修分离闭环（架构铁律落地）
- **范围**：`evals/agents/diagnose.ts`（诊断 agent：读轨迹 → 量化 + 弱点，**只查**）+ `evals/agents/fix.ts`（修复 agent：读问题 → 提 harness/默认值 patch，**只修**）；patch 应用后**自动重跑 + eval-diff 裁决**，涨留跌回滚。
- **不动项**：两 agent 单向隔离（修复看不到自己被评的过程）；裁决权只在客观指标差，不在 agent 自评。
- **回滚**：patch 全可回滚（带前后指标差）；闭环可 flag 关。
- **验收**：跑一个已知弱点场景 → 诊断 agent 定位 → 修复 agent 出 patch → 重跑指标真涨且 eval-diff 通过；故意塞个坏 patch，验证「跌则自动回滚」。

### S3 · 半客观层（独立批评 agent + 校准）
- **范围**：加 VLM/VBench 式检查（画面元素/角色一致性/prompt 遵守）作为**独立批评 agent**；过 `eval-judge-calibrate`（P/R≥80%）才采信；真额度抽样跑。
- **不动项**：不把半客观分当唯一优化靶子；不引入未校准的主观评分。
- **回滚**：半客观指标独立开关，不影响客观脊梁。
- **验收**：校准报告 P/R≥80%；半客观指标带误差条进仪表盘；创始人抽查与 AI 判断一致性可见。

### S4 · 性能追踪仪表盘 + 自动固化
- **范围**：补 §2.3 那个「无」——每个 harness/默认值版本的指标趋势（采用率/报错率/覆盖率随 patch 的变化）；涨的 patch 自动固化为新基线，失败案例自动入 eval 候选集（人工 promote）。
- **不动项**：不自动 promote 到正式 eval 集（人工确认，防污染基线）。
- **验收**：仪表盘显示指标随版本的趋势线；一条 patch 从「提出→重跑涨→固化」全程可见可回滚。

---

## 5. 明确不做（诚实标注 · D4）

- ❌ **权重 RL / LoRA / 训练任何模型**（SIA 权重杠杆、环境合成 RL）——要 GPU，大厂的。
- ❌ **同一个 agent 既出题又自评**——架构铁律，查/修必须独立（用户拍板）。
- ❌ **AI 主观美感分当优化靶子**——命门铁律，会被刷分；主观层只创始人抽查。
- ❌ **自动进化（Meta-Harness 自动改 harness 代码）现在不上**——只预留纯函数边界（修复 agent 的输入=问题、输出=patch，将来换自动实现是换实现不是改架构）。
- ❌ **无人值守烧额度**——成本分层 + 频率可控；绝大多数指标 mock 零额度。
- ⚠️ **天花板**：本闭环让你对「管线对不对、效率高不高、哪类场景常崩」**有数**，并打磨编排/默认值/可靠性；但**改善不了第三方生成模型的像素画质**，也**替代不了你对主观美感的最终判断**。预期钉这里。

---

## 6. 待用户拍板（多数已在对话中定，剩余）

1. **S1 人格 × 场景的初始集**：先覆盖哪几类创作场景 / 用户人格？（建议：从你自己 dogfooding 最常走的 3-5 条旅程起，= 你的"好"的定义最干净的来源。）
2. **触发节奏**：测试泵手动触发，还是攒够改动自动触发（接 `check-eval-cadence`）？（建议：先手动，跑顺了再自动。）

> 拍板后按 R4：S1 起每片五门全过（`pnpm run gates`）；S2/S4 涉及 UI（仪表盘）配 R8 样张 + R13 走查再报完成。
