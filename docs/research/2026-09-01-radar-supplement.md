# Nomi 论文雷达 · 2026-09-01

## 今日结论

**本轮真正的增量在「agent 编排」方向，不在视频生成方向——正好撞上用户的 phase-7 底座复审（PR #272 在评审）。** 视频侧这轮几乎全是前轮已列或窗口外的噪音（MSVBench/MuSS/Co-Director/VQQA 都在册 10-17 次；见底部筛除表），唯一的视频真增量是 IAMFlow（🟡，有码但吃开源底模）。

**这轮头条是三篇「拿 Nomi 的架构当考卷」的 agent 编排 benchmark**——它们把「主 agent 当指挥、派专职子 agent、并行异步收活」这套（= Nomi 的 decompose-stitch 编排层）单独拎出来量化，而且**都是近两月、其中两篇有官方代码、测了 Fable-5/GPT-5.5 这代模型**。这不是「视频画质」论文，是**直接给 phase-7 底座复审当外部证据**的工程 benchmark。三篇 grep 全仓 `docs/research/*` 均 **0 前轮记录**（真新增，非误判）。

分诊：**🟢 0 · 🟡 4 · 🔵 1**。没有一篇是「这周直接接进 Nomi 产品」的能力（编排 benchmark 是评测/诊断工具，IAMFlow 吃 Wan2.1 底模穿不过黑盒 provider），所以头条不占 🟢。

**本轮最该动的两件事**（都服务 phase-7，不加产品入口、不接依赖）：

1. **拿 ClawArena + OrchBench 的失败模式当 phase-7 底座复审的对照清单**（PR #272 直接用）。两篇独立量化了三个和 Nomi 编排层同构的坑——① **主 agent 把多模态回合坍缩成纯文本捷径、不肯派给视觉/音频专职子 agent**（ClawArena 头号失败模式，几乎就是在说 Nomi 的「LLM 直接编剧本 vs 真正下发拆镜/生图子任务」）；② **staged update 后旧信念不复查**（stale belief）；③ **并行度的收益随协调失败累积而递减，保住关键信息比堆 agent 数更重要**（OrchBench 主结论）。落点见 🟡 第 1-2 条：对着 Nomi 的编排链（`workbenchStore.ts` storyboard 编排 / `dependencyWaves.ts` 生成波次 / `storyboardPlan.ts`）逐条自查「这三个坑我们中了没」。**这比再补一条评测更贴 phase-7 当下的活。**
2. **把 IAMFlow 的「显式实体 ID + VLM 异步校验」机制读进跨镜身份的设计账**（🟡 第 3 条）。它是 08-31 已列条目的**实证升级**：确认有官方码（31 star）、training-free、但吃 Wan2.1 底模。机制（LLM 抽实体→全局 ID、VLM 异步从渲染帧校验、**显式实体追踪替代隐式相似度匹配**）正是 Nomi reference-relay 缺的那层——但**别接代码**（底模不同、穿不过 provider），只借设计。

## 🟢 可落地

**本轮 0 篇。** 理由：三篇 agent 编排 benchmark 是评测/诊断工具不是能力（接进来是 eval，不是产品功能）；IAMFlow 虽有码但绑 Wan2.1-T2V 开源底模，Nomi 走黑盒 provider 接不了它的推理路径。把任何一篇写成「本周可接产品」都会造第二套半成品（违反 P1）。

## 🟡 架构教训

### ClawArena-Team — 把「主 agent 当指挥派子 agent」单拎出来测，失败模式几乎逐条命中 Nomi（**本轮真新增 · 有码 · phase-7 直接相关**）

- **证据**：[arXiv:2606.31174](https://arxiv.org/abs/2606.31174)（v2）· 2026-07-02 · UNC-Chapel Hill / UC Berkeley / UC Santa Cruz · 官方码 [aiming-lab/ClawArena](https://github.com/aiming-lab/ClawArena)。测了 **12 个模型**含 Claude Fable-5 / GPT-5.5 / GPT-5.4 / Gemini 3.1-Pro / Sonnet-4-6 等（这代模型，不是老本）。
- **怎么测**：**固定子 agent 池、只换主 agent**，隔离出「管理能力」本身，量三个耦合要求——按模态/能力路由任务、按最小权限授权、编排并发/异步收活。（这套隔离法本身也值得 Nomi eval 借鉴：变量只留编排器。）
- **对 phase-7 的三条硬教训**：
  1. **主 agent 会把多模态回合坍缩成纯文本捷径，不肯下发给视觉/音频专职子 agent**——这几乎就是在描述 Nomi 的风险：LLM 图省事「自己脑补分镜/直接写描述」而非真正把「拆镜→生首帧→生视频」当子任务下发。复审 `storyboardPlan.ts` / `workbenchStore.ts` 编排时，显式查「有没有这种坍缩」。
  2. **staged update 后旧信念不复查**（stale belief persists）——Nomi 多轮编排里上游节点变了、下游有没有拿旧结论继续跑？对照 `dependencyWaves.ts` 的波次失效逻辑自查。
  3. **权限过授**：workspace-permission precision 全模型 **不到 50%**，子 agent 平均拿到约 2× 于所需的文件访问。呼应 R20 / 08-25 地基审计的「IPC 缺来源绑定、子能力过授」——phase-7 若碰权限边界，这是现成的外部佐证。
- **另一条值钱观察**：**成本-质量解耦**——API 成本跨度 >100×，性能跨度 <4×；数个中价模型压过旗舰，最便宜的开源权重就在 Pareto 前沿。**编排器选型别默认「越贵越好」**，这对 Nomi 的 agent 模型分档（P4 通用/分档）是直接输入。
- **限制**：是 benchmark 不是能力；结论基于其任务分布，接进 Nomi eval 前需读其任务定义确认可迁移。

### OrchBench — 不执行 worker 就给编排「计划」打分（**本轮真新增 · phase-7 直接相关 · 码未释出**）

- **证据**：[arXiv:2607.25656](https://arxiv.org/abs/2607.25656)（v1）· 2026-07-28 · 用 **Claude Code executions** 做验证（未点名具体版本）。**未见官方码仓**。
- **怎么测**：给一张 DAG（任务依赖）+ 每 agent 上下文上限 + agent 预算，planner 分配子任务并指定跨 agent 信息传递；**确定性模拟器不跑真 worker，直接对「这份编排计划」产出可解释指标**（result quality / makespan / token cost）。评的是**计划本身**：任务分派、依赖调度、信息传递、上下文压缩。
- **两条主结论（都砸在 Nomi 编排层的设计取舍上）**：
  1. **保住任务关键信息 > 单纯加 agent 数**——直接呼应 08-30/08-31 那条「差异化压在规划/镜间，不是堆广度」，这轮从「视频侧」延伸到「编排侧」同一结论。
  2. **并行的收益随协调失败累积而递减**——Nomi 的 `dependencyWaves.ts` 生成波次是并行的，这条提醒「波次越宽不一定越好，协调失败会吃掉并行收益」。
- **对 phase-7 的用法**：它的**评估维度骨架**（任务分派/依赖调度/信息传递/上下文压缩四轴 + makespan/token-cost 指标）可当 Nomi 编排层的**内部诊断清单**——不必接它的码（未释出），借这四轴对 `dependencyWaves.ts` / `storyboardPlan.ts` 做一次「编排计划体检」。
- **限制**：无码；「计划离线打分」是简化模型，真实 worker 行为方差它不覆盖，只作规划层诊断、不作放行条件（守 P3）。

### PerspectiveGap — 主 agent 给子 agent 写的 prompt 是否尊重其角色/信息需求（**本轮真新增 · phase-7 相关 · 码待核实**）

- **证据**：[arXiv:2606.08878](https://arxiv.org/abs/2606.08878)（v2）· 2026-07-14。**未在 PDF 正文见官方码链接**（待核实，暂不宣称可跑）。
- **核心问题**：编排 agent 给专职子 agent 下指令时，会不会「一视同仁发通用指令」而忽略子 agent 的独特视角/能力/信息需求。发现的倾向：coordinator 常忽略 role-specific context。
- **影响 Nomi 哪个决策**：Nomi 派子任务（拆镜师、生图、生视频、验收）时，**下发给每类子 agent 的 prompt 是否按角色定制、还是甩通用模板**。phase-7 复审子 agent 契约时，把「每个子 agent 拿到的 context 是不是它角色需要的、有没有多喂/少喂」列进检查项。
- **限制**：码待核实；三篇里成熟度最低，作「设计提醒」不作工具。

### IAMFlow — 训练无关的显式实体 ID + VLM 异步校验（**08-31 已列 · 本轮升级为「有码实查、绑 Wan2.1 底模」**）

- **证据**：[arXiv:2605.18733](https://arxiv.org/abs/2605.18733) · 2026-05-18 · 官方码 [Eddie0521/IAMFlow](https://github.com/Eddie0521/IAMFlow)（**31 star**，20 commits，有 `scripts/run_iamflow.sh` 推理脚本 + 配套 NarraStream-Bench）。**本轮实证 diff**：确认 training-free、有可跑码、但**底模是 Wan2.1-T2V-1.3B**（开源权重，非黑盒 provider）。
- **机制**：LLM 从每条 prompt 抽实体+视觉属性、分配全局唯一 ID；VLM **异步**从已渲染帧校验/refine 属性——**用显式实体追踪替代隐式相似度匹配**（这正是 GroundShot/EntityBench 同族的思路，但 IAMFlow 有能跑的码）。
- **落到哪 / 差在哪**（路径已核实）：这层「显式实体 ID + 渲染后 VLM 回校」正是 Nomi reference-relay 缺的——现在 Nomi 的中继是**结构依赖驱动**（`referenceSlots.ts` / `generationReferenceResolver.ts` / `relayFrameResolver.ts`），没有「给实体发全局 ID + 生成后用 VLM 核对身份漂没漂」这一环。可借的设计：在 `shotVerifyOrchestrate.ts` 后加一道「实体身份异步回校」而非只校首帧对不对。
- **限制**：底模绑 Wan2.1，**不接代码**（穿不过 Nomi 的黑盒 provider 层，P4）；只借「显式 ID + 异步 VLM 回校」的机制形状。

## 🔵 对标基准

### MSVBench — 多镜生成的人类级评测（94.4% Spearman）（**窗口边缘 2602 · 无码 · 仅记不接**）

- **证据**：[arXiv:2602.23969](https://arxiv.org/abs/2602.23969)（v1）· **2026-02**（HIT-Shenzhen / 阿里国际）· **未见官方码**。
- **为什么只记不接**：① **2602 在近-6-月硬线（2026-03-01）之外**，按铁律本该筛掉；② 无官方码，接不进 eval。**但它值得留一句**：LMM（语义/叙事连贯）+ 领域专家模型（DOVER/RAFT/人脸追踪，低层保真）的**混合评测架构**做到 94.4% ρ / 83.6% τ 对齐人类，远超 VBench(58.5% ρ)——这个「LMM 判叙事 + 专家判画质」的分工，是 Nomi eval 体系若要自建多镜打分器的**架构参照**（区别于 EntityBench 偏实体一致、KathaTrace 偏语义轨迹）。
- **接法（若下轮它释出码或有 3+ 月内后作）**：借其「双层混合」形状，别引其 Feb 的数据集。**本轮不动，仅登记**。

## 八方向检索结果

| 方向 | 本轮结论 | 备注 |
|---|---|---|
| 1. 跨镜身份一致 | IAMFlow（🟡·08-31 已列，本轮升级有码实查） | 有码但绑 Wan2.1 开源底模，只借机制；GroundShot/EntityBench 仍是同族参照 |
| 2. Agent 拆镜/导演编排 | **ClawArena + OrchBench + PerspectiveGap（🟡·本轮真新增头条）** | 三篇独立把「主 agent 派子 agent」当卷子，直接服务 phase-7 底座复审；ClawArena/OrchBench 是这轮全仓真增量 |
| 3. 运镜/机位 | 无合格新增 | h-control(2605)/CamProbe(2605.14815)/CineLOG(2512) 命中但穿不过黑盒 provider 或窗口外；方向对、成熟度不够，留观察 |
| 4. 多镜叙事/转场 | 无合格新增 | MSVBench(2602·🔵仅记)/MuSS(2604)/MSAVBench 命中但前轮已列或窗口边缘；KathaTrace/UnityShots 前轮已详列 |
| 5. 质量/评测 | MSVBench 登记（🔵·窗口边缘） | VQQA(2603)/Video-Inspector(CVPR26) 命中但前轮已列或与既有 agentic-eval 方向重复 |
| 6. Prompt 优化 | 无合格新增 | 命中多为前轮 RAPO/VISTA 族重复，无近 6 月更成熟新实现 |
| 7. 音频/唇形/TTS | 无合格新增 | EditYourself(2601)/UniTalking(CVPR26)/TurboTalk 窗口外或需重训联合 AV；lipsync gap 仍是已标缺口 |
| 8. 编辑/抽帧/relay | 无合格新增 | V2V-Bench(2606)/MSEditor(2608) 面向「编辑已有视频」或需监督训练，穿不过黑盒 provider |

## 本轮筛掉的噪音（不进正文）

- **前轮已重复列（写「新」前 grep 已确认在册）**：MSVBench(17 次)、MuSS(15)、Co-Director(10)、VQQA(5)、DirectorBench/KathaTrace/EntityBench/GroundShot/UnityShots（08-20~08-31 连续在册）。
- **窗口外（<2026-03-01 硬线）**：ShotDirector [2512.10286](https://arxiv.org/abs/2512.10286)、CineLOG [2512.12209](https://arxiv.org/abs/2512.12209)、EditYourself [2601.22127](https://arxiv.org/abs/2601.22127)、DiffusionCinema [2601.17412](https://arxiv.org/abs/2601.17412)、The-Script-is-All-You-Need [2601.17737](https://arxiv.org/abs/2601.17737)。MSVBench(2602) 严格说也在线外，因「混合评测架构」有参照价值，破例登记 🔵 但不接。
- **穿不过黑盒 provider / 需重训底模**：h-control(2605)、CamProbe(2605.14815)、IAMFlow 的代码路径（绑 Wan2.1）、各 lipsync 联合 AV 重训方案。
- **agent 方向命中但降权**：AORCHESTRA(2602·窗口外)、Recursive-Agent-Harnesses(2606.13643·偏理论无直接 Nomi 落点)、Uno-Orchestra/ProgRouter（偏通用路由，不如 ClawArena/OrchBench 贴 Nomi 的「多模态子任务下发」）。
- 未把任何「只有二手摘要 / 没查到代码 / 无法确认日期」的结果标为 SOTA 或已验证能力。

## 上轮 vs 本轮 diff

- **真新增（全仓 grep 0 前轮记录）**：ClawArena-Team [2606.31174]、OrchBench [2607.25656]、PerspectiveGap [2606.08878]——**agent 编排方向首次成簇进榜**，且正对 phase-7 底座复审窗口。这是本轮和过去几轮（都聚焦视频生成/评测）最大的方向转移。
- **对已有条目的实证 diff**：IAMFlow [2605.18733]（08-31 已列）从「有官方仓」升级为「有码实查（31 star / run 脚本）+ 绑 Wan2.1 底模」，落点收紧为「借机制、不接码」。
- **延续未变**：08-30/08-31 的「保关键信息/压规划质量 > 堆 provider/agent 数」——本轮被 OrchBench（"preserving task-critical info > adding agents"）从编排侧再次独立量化，从「视频侧结论」升级为「视频+编排双侧同向」。
- **方法学收获**：ClawArena 的「固定子 agent 池、只换编排器」隔离法，和 OrchBench 的「不跑 worker 只评计划」——两种给 agent 编排做**可控评测**的姿势，可反哺 Nomi eval 体系设计（区别于 evals/ 现有的生成质量 lane）。
