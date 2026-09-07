# 生成策略解析器（Generation Strategy Resolver）— 研究与设计

> 日期：2026-09-06 · 状态：**P1 引擎已实现并验证**；**Step 1 `resolve` operation 已接线并全绿**；Step 2 GUI 审阅预览（切片 1–4 已完成并验证；切片 5 契约层绿 + L2 walk 脚本随 PR 真机跑；切片 6 分支/PR）· 范围：研究与方案文档 + 纯函数引擎 + resolve 接线 + GUI 审阅面板 + 落画布闸

## 0.1 实现进度（2026-09-06）

- 用户拍板：D1 = ① 程序化引擎 + Agent 工具；D2 首期 = 合并/拆条/时长分配（含其地基 M1 校验钳值）；D3 = 方案审阅并行预览 + 落画布前再校验。
- 已交付（未 commit，走仓库分支/PR 交付流程）：
  - `electron/shared/videoCapabilities/planResolver.ts`（新增，纯函数）：`resolveGenerationPlan`（单镜校验钳值/参数键白名单/模式回退 + 同场短拍合并建议 + 超限拆条建议 + 逐条中文 issue/理由）、`applyMergeProposal`（原位替换保镜序、锚取并集）、`applySplitProposal`。
  - `electron/shared/videoCapabilities/planResolver.test.ts`：11 用例覆盖钳值/未知键/模式回退/缺模型 fail-closed/同场短拍合并/跨场与无锚不合并/超限拆条/应用函数保序。`vitest run electron/shared/videoCapabilities` 19/19 通过。
  - barrel `index.ts` 增导出（无循环依赖；同目录 index.test.ts 8 例通过）。
  - 实测 Pi 工具注册机制并归档（附录 A）；摸清 `nomi_generation_plan` 的 operation→capability 映射与语义 dispatch 落点（附录 B）。
  - **Step 1 已落地（resolve operation 接线）**：`modelToolSurfaceManifest.ts` schema 加 `{operation:'resolve', shots, goals}`；`generationTransportAdapters.ts` 加内部名 `nomi_resolve_generation_plan` + capability `'resolve'` + operationId 豁免（与 context/create 同级）；`mcpGenerationTools.ts` 加 stateless `resolve` 分支（`createGenerationPlanningHandler` 内、context 之后，调 `resolveGenerationPlan`，不落 store/无 seal/无 gate）。新增 2 用例（adapter 路由 + handler stateless 钳值）→ `generationTransportAdapters/mcpGenerationTools/manifest/catalog/policy/registry/semanticFlow/nomiMcpGenerationPlanning/videoCapabilities` 相关套件全绿 + `tsc -p electron/tsconfig.json` 零错误。
  - **切片 2 已落地（GUI 窄 IPC resolve 通道，2026-09-07）**：详见附录 F——seam 把 resolve 提前为 lease-free advisory（其余 capability 仍强制 lease）；`appIntegration` 暴露已装配 seam；新 `generationResolveIpc.ts`（channel `nomi:generation:resolve-plan`，assertTrustedSender + committed-projectId 比对 + 信封）+ `electron/shared/videoCapabilities/planResolutionContracts.ts`；main.ts/preload/DesktopBridge 接线。新增 10 用例（含 GUI vs MCP 双端逐字段同源断言）→ 受影响套件 71 绿 + electron/pi tsc 零错误。
  - **切片 3+4 已落地（GUI 审阅面板 + 落画布闸，2026-09-07）**：详见附录 F——`storyboardStrategy.ts` 增 `classifyResolveStrategy`/`hasResolveBlockers`/`firstResolveBlockerMessage`/`applyMergeSuggestion`/`applySplitSuggestion`（闸判据与面板分类同一份语义）；新 `strategyGate.ts`（fetch + 执行闸，fail-open 边界注释化）+ `StoryboardPlanStrategyPanel.tsx`（表上方执行计划审阅条：必需合并/拆条/建议合并逐条「采纳/为什么」+ 阻断红条，采纳即 apply 到方案 → 自动重查）；`StoryboardPlanEditor.tsx` 挂载面板 + 单镜生成/整批/多选生成前置 resolve 闸（有阻断 toast 机器理由并中止）。i18n `storyboardEditor.strategy.*` zh/en。新增 10 用例（classify/gate×5 + strategyGate×5）→ storyboard/agent/i18n 55 文件 597 绿。
  - **切片 5 已落地（测试系统，2026-09-07）**：L1/L1' 契约全绿（上方累计）；L2 真机旅程脚本 `tests/ux/storyboard-strategy-resolve.walk.mjs`（seed 4 视频镜 → 打开编辑器 → 面板三态截图 → 采纳重查 → 阻断记录，附录 C 场景 1/2/3/4 人眼对账清单见文件头）——受限 shell 无法拉起 GUI（既有边界），脚本随 PR 上真机跑；L3 用户走查待 PR 后执行。
- 待办（按依赖排序）：② **Step 2 GUI 审阅预览**（样张已出且 **token 化**：`docs/design/mockups/2026-09-06-generation-strategy-review.html`，色板/圆角/阴影/字体镜像 `nomi-tokens.css`（src/theme/nomi-tokens.css，暗色切 `data-mantine-color-scheme="dark"`），语义色用 color-mix 派生同源做法；真实实现走 token/组件 className + i18n zh/en，守 R10/R15/check:tokens，不在 JSX 直写颜色/px）→ 落画布前 resolve 闸（D3）；③ **Step 3 完整测试系统 + 真实旅程**（附录 C：L2 旅程 E2E + L3 用户走查，R13/R16）；④ **Step 4 独立分支 + PR**（delivery:preflight → 分支/PR，禁直推 main）。P3 音频规则未选，保留可选。

## 0. 要解决的产品问题（用户原话 → 能力需求）

用户希望 Agent 拥有「人类做视频时的判断力」：拿到剧本后，不是机械地按分镜逐条文生视频，而是理解**每个模型有哪些模式、每个模式背后该怎么选、参数该怎么定**，并据此对分镜方案做结构调整。典型诉求：

| 用户诉求 | 翻译成能力 |
|---|---|
| 「直接文生视频，人脸/服装会乱变；该用参考图模式锁人」 | 跨镜出现同一角色 → 生成角色参考图、走 `character`/`image_ref` 模式；首尾帧承接场延续 |
| 「是否生成音频、分辨率、秒数该如何分配」 | 每任务：原生有声 vs 静默留后期；画质档→分辨率档位；时长按叙事合理分配 |
| 「5 个分镜，前两个合计 10s 不超单条上限 → 合并成一条整体生成最优」 | 计划级合并/拆条决策：短拍合并、超限拆分、单条上限内一次生成 |
| 「背后有哪些考量、谁跟谁合并、写分镜时该做哪些调整」 | 每项决策可解释（理由 + limitations），供用户逐项审阅——延续「方案免费可改、执行才花钱」的产品哲学 |

## 1. 现状：Nomi 已有的事实与决策基座（四层，均有 file:line 证据）

**L0 事实层（机器可读 · 已完备）**：`electron/shared/videoCapabilities/` 有 35 份来源背书的视频模型档案（`registry.ts:61-96` 登记；seedance2/2.5、minimax-H3/max、kling3、veo3.1、sora2、wan2.7/3.0、hailuo2.3、gemini-omni、runway、agnes…）。每档案 = `ModelArchetype`（`types.ts:117-133`）：`modes[]`（`id/intent/vendorTerm/hint`），`intent ∈ text|single|firstlast|character|edit`，`slots`（first_frame/last_frame/image_ref/video_ref/audio_ref/source_video，带 min/max/characterIndexed，`types.ts:31-50`），`params`（duration 的 min/max/枚举、resolution、aspect_ratio、generate_audio…，`types.ts:17-29`），外加 modelEnum/vendorTransportTaskKind/fixedParams。档案由 `pnpm radar:models`（确定性发现层）+ model-integration 契约接入持续维护——**「每个模型哪些模式、哪些参数、上限多少」这个知识库已经存在且单一真相**。

**L1 单镜模式推荐（已完备但只服务 headless/MCP）**：`recommendation.ts` 的 `recommendVideoGeneration`（`recommendation.ts:246`）：输入 refs+goals → 对每个候选模型×模式打分（文生 100、首+尾 140、角色图 130、时长不支持 -30…）→ 自动铺参数（时长取最近合法值、quality→分辨率档、generate_audio bool）。消费方是 `capabilityCore/mcpGenerationVideoResolve.ts`、`mcpGenerationTools.ts`、`appIntegration.ts`。**GUI 故事板规划链路未见接入同一引擎**——同一决策存在「headless 用引擎、GUI 靠 LLM 临场」的分裂风险。

**L2 叙事方法论（已完备但住在 skill 文字里）**：`skills/workbench-storyboard-planner/SKILL.md` 已含：演时换算法（台词 4 字/s+标点、动作 beat 1/2/3s、并行取 max，`:107-122`）、`<4s` 补到 4s 或与邻镜合并、超单条上限拆连续多镜+首尾帧承接（`:117-120`）、anchors（visual 锚→参考图锁脸锁衣，`:77-83`）、硬/软约束分类（`:124-127`）、运镜翻译可靠度表（`:139-154`）。`skills/director-sound/SKILL.md`：音频是**时间轴后期层**，视频 prompt 不含音频。`skills/workbench-fixation-planner/SKILL.md`：角色/场景定妆卡。这些方法论质量很高，**但全部是给 LLM 的散文指令**，不与 L0 的结构化事实挂钩执行。

**L3 执行层**：分镜结构 `PlanShot`（`src/workbench/generationCanvas/agent/storyboardPlan.ts:108-200`，含 durationSec/anchorIds/referenceBindings/modelKey/modeId/params/keyframe）+ Zod schema；落画布走 `plannedNodeMeta.ts`（显式 modeId 否则 archetype.defaultModeId + 铺默认参数）；请求由主进程 `taskParams.ts`/`runtime.ts runTask` 执行。

## 2. 差距清单（决定「建什么」）

- **G1 无计划级程序化决策器**：合并（两短拍合计 ≤ 上限并成一次生成）、拆条、时长分配、单任务装配，目前全靠 LLM 临场 + skill 文字，且 LLM 手里没有结构化的各模式时长/参数上限——正是「5 镜并 3 镜」这类**确定性判断**不该交给概率模型的地方。这类逻辑做成纯函数后完全可单测、可走 contracts。
- **G2 决策引擎双真相源风险**：recommendation.ts 只服务 headless/MCP，GUI 规划走「skill 散文 + LLM 选型 + 落画布默认兜底」。同一模式决策应该**只有一个引擎**，两端共用。
- **G3 幻觉防线是提示词级的**：skill 反复强调「取值必须来自清单、绝不编造、拿不准留空」（`:96`）——约束只存在于 LLM 提示里，没有结构级校验闸（例如把 duration 填 20s、或编造参数键，只有到请求组装/运行才暴露）。
- **G4 音频决策双轨未规则化**：部分模型原生有声（minimax-H3 立体声随片生成且**无 generate_audio 开关**，`minimaxH3.ts:20`；omni/gemini 等另有语音意图），多数靠时间轴后期（director-sound）。「这镜生成时带不带声 / 对白镜头口型是硬约束要侧脸+后期配音」没有规则化。
- **G5 方案→执行的「落画布前闸」缺失**：用户审阅方案后直接落画布，任何不合法/次优参数要等真正生成才反馈。

## 3. 方案设计

### 3.1 定位与名字

一个**确定性、纯函数、契约化**的引擎：`generation-strategy-resolver`（暂定名），把「分镜方案（逻辑镜头）→ 生成执行计划（任务集）」这一步做成机器可算、可解释、可测试。对 LLM 暴露为 agent 工具（如 `resolve_generation_plan`）；对 GUI 在落画布前调用。**人机分工**：LLM 懂叙事（拆镜、prompt、锚的建立与复用、演时估算给出每拍语义时长）；引擎懂模型（合法参数、模式意图、上限、合并/拆条、模型统一、音频归属）。LLM 不再需要背诵模型参数，也就不存在编造键。

### 3.2 输入 / 输出契约（草案）

输入：
- `shots[]`：逻辑镜头（宽松接受 PlanShot 或 LLM 初稿：语义时长、锚引用、prompt、关键帧 flag、语气动作描述）
- `candidates`：真实 catalog 解析出的可用视频模型（`buildVideoModelCandidates` 产物，keyStatus=ok 的才进）
- `goals`：画幅/质量(draft|balanced|final)/是否允许跨镜合并/音频偏好/风格统一要求

输出 `executionPlan`：
- `tasks[]`：每条生成任务 `{ covers: 覆盖哪些逻辑镜头或镜段, modelKey, modeId, params(时长/分辨率/比例/…), bindings(参考图/首帧/尾帧/参考音→锚), 原生音频策略, reasons[] }`
- `audit[]`：每条合并/拆条/模式/参数决策的机器理由（用户逐项可校）
- `issues[]`：无法自动满足的清单（如：目标时长全片超预算、某锚缺参考图）

### 3.3 核心算法模块

- **M1 能力解析与校验（治 G3）**：真实档案 → 每候选的 `effectiveVideoModes`；校验并**钳值** duration/resolution 到合法集合；任何 modelKey/modeId/参数键不在档案内一律拒绝——结构级杜绝编造。产出每镜的「可行域」（哪些模型×模式能承载这镜的素材与语义时长）。
- **M2 任务化：合并/拆条/时长分配（治 G1，用户举例的核心）**：相邻且同锚组（同场景/同角色）、语义时长合计 ≤ 所选模式单条上限、prompt 可拼为连续动作 → **合并为一次生成**（减少抽卡次数、保证动作/光线连续）；合计 < 模式下限 → 补时长或并入邻镜；单镜超上限 → 按「开口前/说话中/说话后」就近拆连续多任务、同锚复用 + 首尾帧承接。判据全部来自档案数值，非 LLM 记忆。
- **M3 模式与一致性决策（跨镜，治 G1/G2）**：复用 `recommendation.ts` 单镜打分内核，外层加**跨镜上下文**：同角色跨镜 → 锁定参考图（character intent / image_ref、characterIndexed 多角色映射）；场内状态延续（血/湿/衣破）或拆条承接 → firstlast；单条覆盖多拍 → 中间切点用首尾帧衔接。同一批镜头默认收敛到同一 family 模型（除非剧情/素材强制换）。
- **M4 参数与音频决策（治 G4）**：duration 由 M2 给出；resolution 由 goals.quality 映射 + 档案枚举；比例统一。音频：档案声明**原生有声/带 generate_audio 开关/无声**三态 → 「这镜生成时带声 or 静默留后期」；对白镜头按 director-sound 硬约束（口型不同步→侧脸/画外 + 后期配音）打后期标注，不写进 video prompt。
- **M5 可解释审计（对齐产品哲学）**：每条任务带 `reasons[]`（中文，如「镜 1+2 合计 9s ≤ H3 参考模式 15s 上限，同场景同角色，合并为一次生成」「有角色参考图，锁定身份用 character 模式」）+ `issues[]`。渲染沿用 plan card 的审阅交互：免费可改、确认才执行。

### 3.4 与现有引擎的关系（治 G2）

- **不新建第二份事实**：全部读 `videoCapabilities` archetypes（同一真相源）。
- **不绕过推荐内核**：M3 内部复用 `recommendVideoGeneration`（或提取其打分/参数填充为共享函数），两端（GUI/MCP）同引擎 → 消灭双真相源。
- **落点**：新模块放 `electron/shared/videoCapabilities/`（与 recommendation.ts 同层，纯函数可跨 renderer/headless 复用），agent tool 注册走 `agentToolCatalog` + `capabilityCore`，与现有 `mcpGenerationVideoResolve` 并列。

### 3.5 接入点与触发时机（三选，见决策表）

- **A. 方案审阅时并行呈现**：`propose_storyboard_plan` 后立即跑 resolver，把「执行计划预览（含合并/参数理由）」和分镜方案一起给用户看——用户一次性批准结构+参数。
- **B. 落画布前静默闸**：用户确认方案后、系统落画布前跑 resolver，输出修正 diff 供确认或自动应用。
- **C. 两段都要**：规划时给预览，落画布前再校验一次（A 作为体验，B 作为兜底闸）。

## 4. 决策对比表（R3）

| 决策 | 选项 | 用户看到 | 代价/风险 |
|---|---|---|---|
| D1 工具形态 | **① 程序化引擎 + agent tool（推荐）** | 方案里出现可解释的执行计划与合并建议，参数不再错 | 实现量中等；纯函数可单测，符合仓库「确定性决策机器化」文化 |
| | ② 只做「落画布前校验+修正闸」 | 参数不合法时被拦住/自动修正 | 实现最小，但「合并/结构调整」这类主动优化仍靠 LLM |
| | ③ 只加强 skill 散文 | 提示词更详细 | 仍靠 LLM 背诵参数，与档案双源漂移，违背单一语义 owner 门岗；**不推荐** |
| D2 首期范围 | ① 校验闸 P0 起步 | 立刻告别编造参数/超上限 | 价值在「不犯错」，还没有「更聪明」 |
| | ② 合并/拆条决策器（对应举例） | 5 镜短拍自动并 3 条、超限自动拆 | 核心价值点；依赖 M1 校验先落地 |
| | ③ 一致性/模式强化（参考图锁人） | 跨镜换脸换衣问题系统性减少 | 部分能力 recommendation.ts 已有，主要是接进 GUI |
| | ④ 音频规则化 | 原生有声/留后期判断自动给 | 依赖档案补「原生有声三态」元数据 |
| D3 接入时机 | A 方案审阅并行预览 / B 落画布前静默闸 / C 都要 | — | C 最稳；A 体验最好；B 是最小兜底 |

## 5. 分阶段落地与验收门

- **P0 校验闸（最小）**：`resolveShotParams` 纯函数——对方案每镜钳合法时长/参数、校验 modelKey/modeId 存在、模式与素材槽位匹配；落画布前接入。验收：单测覆盖档案数值边界；`check:*` 全绿；契约测试含「编造参数键/超上限/模式槽不匹配」三例 fail-closed。
- **P1 合并/拆条决策器**：M2 实现。验收：用真实档案数值写「两短拍并入一条 ≤ 上限」「一拍超上限拆两镜且同锚+首尾帧」契约用例；例化用户举例（5 镜→3 条）。
- **P2 计划级策略 tool**：M3 跨镜一致性 + 模型收敛 + M5 审计；注册 agent tool，GUI planner skill 改为「叙事职责 + 调引擎」，去除「背诵参数」段落。验收：真实剧本跑通 J 系列旅程（R13/R16），方案+执行计划并排审阅走查。
- **P3 音频规则（可选）**：档案补原生有声三态 → M4。验收：对白镜/环境镜的带声建议符合 director-sound 知识，且不往 video prompt 塞音频词。

**不动项（本方案明确不改）**：`videoCapabilities` 档案结构本身（继续由 radar/certification 维护）；推荐引擎现有打分语义；PlanShot/画布数据结构；时间轴后期音频管线。**回滚**：新模块纯新增，接入点均可开关，不动既有生成路径。

## 6. 开放问题（待用户拍板）

1. D1 形态、D2 首期范围、D3 接入时机（见 §4 决策表）。
2. 「合并」的触发边界：只在用户无显式要求时**建议式**合并（plan 里标注「已合并镜1+2，可拆开」）还是要更强的默认？——默认建议式，用户可一键展开。
3. 全片时长/预算目标是否需要纳入 goals（如「总时长 ≤ 60s / 额度优先」），决定 P1 是否加总量约束。

## 附录 A：Pi 工具注册机制（2026-09-06 实测，file:line 证据）

Nomi 接的是 `@earendil-works/pi-coding-agent` 运行时（`electron/harness/runtime/pi/`）。工具注册不是"加一个函数"那么单一，而是**一条五层链**：契约 → 模型表面 → 投影/策略 → 工具桥 → 会话/回合。SDK 只认 `{name,label,description,parameters(JSON Schema),executionMode,execute}`，Nomi 在其外加了自己的契约、审批与副作用语义。

**① pi SDK 契约**（`runtime/pi/tools.mts:1-3` 引用 `pi-ai / pi-agent-core / pi-coding-agent`）：模型可调的工具 = `ToolDefinition`（`parameters` 是 **JSON Schema**，`execute(toolCallId, args, signal)`），会话创建时以 `tools: string[]`（允许名单）+ `customTools: ToolDefinition[]` 注入（`session.mts:38`）。Nomi 把**除白名单外的工具全关**（`noTools: 'all'`），且 `toolExecution='sequential'`（`session.mts:37,45`）。

**② Nomi 工具桥 `createHostTools`**（`tools.mts:35-80`）：把 `HostToolDefinition{name, description, Zod schema, execute}` 转成 pi 的 ToolDefinition：
- 名字必须匹配 `/^[a-zA-Z_][a-zA-Z0-9_-]*$/` 且不重复，违规**直接抛、整档工具发不出去**（fail-closed，`tools.mts:39-41`；`layout.ts:7` 注释强调这条）；
- `zodToJsonSchema` 生成 JSON Schema：`$refStrategy:'none'`、`removeAdditional:'strict'`，并对 `ZodEffects/preprocess` 特殊处理避免 pi 拒绝合法输入（`tools.mts:43-50`）；
- **双端校验**：`beforeToolCall` 里用 Nomi 的 Zod `parseAsync` 校验 pi 传来的原始参数，转换结果按 `toolCallId` 暂存（`tools.mts:74-77`）；`execute` 只取暂存参数 → `awaitHost(tool.execute(...))`，即执行只等 Host 结果（`tools.mts:57-62`）；`clearPending` 在 `agent_end` 清空（`session.mts:52-54`）。

**③ 会话装配**（`session.mts:25-50`）：`createHostTools(options.tools)` → `customTools`，`createAgentSession({ tools: 名单, customTools, noTools:'all', ... })`；`beforeToolCall` 把 SDK 原有钩子和工具桥串联。SDK 持有循环，Nomi 持有全部输入与工具效果。

**④ 单回合执行桥**（`run.mts:100-121`）：每个工具的 `execute` 被覆写为：emit `tool-call` → **`hooks.awaitToolConfirmation(call, signal)`** → 宿主在这里做审批并**真正执行** → 返回 `decision.result`；拒绝/取消/错误映射为 `denied/error`；结果包装成 `{content:[{type:'text',text:...}], details}`。即 **pi 模型永远看不到 Nomi 执行器的副作用，只看到"是否批准 + 结果文本"**。

**⑤ Host 侧（模型可见名单与执行权）**，三层单一真相：
- **模型表面** `harness/tools/modelToolSurfaceManifest.ts`：语义描述符 `{name: 'nomi_*', intent, capabilityRefs[], inputSchema(Zod，常用 discriminatedUnion("operation")), outputSchema, sideEffect(none|proposal|external), execution, risk(read|project_write|paid_external), disclosure, availability{phases[], requiredScopes[]}}`；末尾有重复名/宿主专用泄漏守卫（`:250-255`）。现有 generation 组 = `nomi_generation_plan`（`operation: context|create|patch|preview`，`:83-88`）+ `nomi_generation_status`。
- **投影唯一入口** `harness/tools/agentToolCatalog.ts`：把 manifest 的语义描述符投影成 `{name, description(=intent), parameters(=inputSchema)}`（`:23-29,36-43`），提供 `agentToolProjection.{canvasRead,canvasCore,canvasAll,...}` 与 `runtimeToolsForCatalog`（`:54-76`）。数组顺序稳定 = prompt/KV-cache 契约（`:33-34`）。
- **能力契约** `shared/agentCapabilities/`：每能力一个文件（如 `canvasWrite.ts`、`generation.ts`）导出 `CapabilityContract`（`capabilityContract.ts`）：`id / version / aliases{pi,mcp,ui} / additionalAliases / input|outputSchema / effect(read|reversible_write|destructive|paid) / effectClass(reversible_local|spend|irreversible——审批权威) / operationEffectClasses? / requiresPlanReview? / execution{port,availability} / exposure / requiredScope / targetKind / projections`。`registry.ts` 的 `REGISTERED_CONTRACTS` 登记全部契约，`CAPABILITY_ALIAS_ENTRIES` 由 aliases 派生 → `resolveCapabilityAlias(toolName)`、`resolveCapabilityEffectClass(toolName,args)`（operation 级细分）都是从这里解析——**工具名与 operation 只是投影，契约才是权威**。

**路由与执行**：`agentChatPolicy.ts` 按 capability/toolProfile/意图正则把工具投影成每轮可见的小集合（canvas-agent → generationAll；storyboard profile 只 `nomi_canvas_read`+`nomi_canvas_plan`，`:88-95,199-243`），每个 call 再经 `agentToolIsInScope` 校验（`:246-256`），Skill 只能收缩、不能放大工具集（`restrictToolsToSkillCapabilities`）。执行器：`capabilityCore/capabilityExecutorRegistry.ts` 按 `capability.id` 分发到各 port（document/canvas/timeline/export/asset，`:470-530`；未登记即 `capability_unsupported`）；generation 域在契约层**只登记不执行**（`generation.ts:7-11` 注释），执行在 main-process Host adapter（capabilityCore `mcpGeneration*` + projectAgentHost coordinator），`projectAgentExecutionPolicy.ts` 用 `resolveCapabilityAlias`/`resolveCapabilityEffectClass` 做审批判定。

### 对我们的含义：策略工具该注册在哪

`planResolver` 是**纯计算、无副作用、建议式**（产出 merge/split/issues，不落盘不花钱）——它不应另起炉灶，而应**扩展现有的 `generation.plan` 能力面**（`nomi_generation_plan`），新增一个 operation（如 `optimize`/`resolve`），复用其 scope `generation:plan`、effectClass `reversible_local`、投影与审批语义（P1：不给同域再建第二份面）。落点清单：
1. `modelToolSurfaceManifest.ts`：`generationPlanInputSchema` 的 discriminatedUnion 加 `{operation:'resolve', shots:[…PlanShot 子集…], goals?}`（字段直接映射 planResolver 输入契约；防编造由 Zod strict 兜底）；
2. `capabilityCore` generation Host adapter（`nomi_generation_plan` 的现有执行模块）里加该 operation 分支 → 调 `resolveGenerationPlan`（pure）+ `buildVideoModelCandidates`（当前项目可用模型）；
3. 采纳/落画布仍走现有 `nomi_canvas_plan` / plan preview 通道，不新增写路径；
4. 配套：manifest/registry/契约测试、executor operation 测试、policy 意图正则（若需 storyboard 语境也放行）、GUI 审阅预览样张（P5/R8）。
若未来要"独立新能力"（例如给 MCP/其它表面用），再照全套模板加：新 contract 文件 + registry 行 + alias + manifest 描述符 + executor 接线 + 测试——但当前需求不必要。

## 附录 B：`resolve` operation 接线落点（2026-09-06 实测，精确到 file:line）

`nomi_generation_plan` 的 operation 只是投影，adapter 把它翻成内部工具名 + capability，再交给 run-owned planning 接缝（`deps.planning`）：

1. **模型表面 schema**（`harness/tools/modelToolSurfaceManifest.ts:83-88`）：`generationPlanInputSchema` 的 discriminatedUnion 加 `{ operation: 'resolve', shots: PlanShotInput[]（zod strict：id/durationSec/sceneAnchorId?/anchorIds?/modelKey?/modeId?/params?/beatNote?）, goals?: { allowAdvisoryMerge?: boolean } }`——字段映射 planResolver 的 `PlanShotInput`/`GenerationResolutionInput`，未知键由 `.strict()` fail-closed。
2. **Adapter 翻译**（`capabilityCore/generationTransportAdapters.ts`）：
   - `parsedArgs`（`:71-88`）：`nomi_generation_plan` 走 `generationPlanInputSchema`（加了 resolve 后自动覆盖）；`canonicalGenerationCall`（`:90-104`）给 `operation==='resolve'` 加分支 → 内部工具名 `nomi_resolve_generation_plan`；
   - `INTERNAL_GENERATION_TOOL_NAMES`（`:40-50`）加入该名字；`tryExecute` 里 capability 解析（`:278-292`）加 `? 'resolve'`；
   - **operationId 规则**（`:293-295`：非 context/create 一律要 operationId）必须把 `resolve` 也豁免——resolve 是**无状态计算**，不落 durable operation store；
   - `GATE_TOOL`/`START_TOOL` 等旁路不受影响。
3. **语义 dispatch**（`capabilityCore/mcpGenerationTools.ts:418-660`，capability 分支按 `context/create/plan/preview/gate_request/gate_decide/start/cancel/reconcile/read/events/steer` 排）新增 `resolve` 分支：纯计算路径——用 `resolveGenerationPlan`（pure）计算，候选集/默认模型取法与 `context`/`preview` 分支同源（模块顶部注入的 deps，见 `mcpGenerationTools.ts:234-235` 的 `recommendVideoGeneration` 依赖注入先例），返回 `{ suggestions: { shots[…钳值后], mergeProposals[], splitProposals[], issues[] }, summary }`，不写 operation store、不触发生成、无 gate。实现时以 context/preview 分支为模板、保持与两者返回形状一致的 host-facing 结构。
4. **采纳/落画布不新增写路径**：merge/split 的采纳仍走现有 `nomi_canvas_plan` / plan preview 通道（apply 函数在 GUI/planner 侧用）。
5. **配套测试与守卫**：manifest duplicate-name guard（`modelToolSurfaceManifest.ts:250-255` 自动覆盖）、`agentToolCatalog.test.ts` / `modelToolSurfaceManifest.test.ts` 若按名计数需同步、`generationTransportAdapters.test.ts` 的 parse/canonical 用例、planning 分支测试（`nomiMcpGenerationPlanning.test.ts` 类）。改动涉及守卫密集的契约面，**作为独立改动落地并跑 generation 相关套件**，不与其他改动混提。

**范围提醒（P1）**：`resolve` 复用一个已存在的语义工具面（nomi_generation_plan），不新增 contract/alias/effectClass/scope——避免给同一域再造第二套面。若评审认为 stateless resolve 放进 run-owned planning 接缝过重，备选是把它做成只读 adapter 侧直通（不进 `deps.planning`），需与 resident Host 的接线评审确认，二选一不并存。

## 附录 C：完整测试系统 + 用户走查收口（R13/R16 · 用户 2026-09-06 明确要求）

收口标准不是"单测绿"，而是**真体感走查 + 真实用户任务跑通、冒出的问题全修完**（P3/R16：不留半成品）。三层测试系统 + 一层人工走查：

| 层 | 内容 | 产物（落点） | 判定 |
|---|---|---|---|
| L1 单测/契约 | planResolver 行为（钳值/合并/拆条/审计） | `planResolver.test.ts`（11 例，已绿）+ barrel | 全绿 |
| L1' 接线/契约 | resolve 路由、operationId 豁免、manifest schema、handler stateless | adapter/handler/manifest/catalog/policy/registry 套件（已绿 72 例） | 全绿 |
| L2 真实旅程 E2E | Playwright 走**真实用户任务**（非功能探索）：剧本 → storyboard planner 提案 → resolve 执行计划预览 → 逐项采纳合并/展开 → 落画布前 resolve 闸 →（mock 生成·零额度）→ 时间轴 | `tests/ux/` 仿现有命名（参照 `tests/ux/agent-vertical-spine-m0-m5.red.e2e.mjs`）；跑 `pnpm run test:e2e` | 每步**截图落 `outputs/` 人眼判断**（R13：不是 expect 断言）；expect 只守结构性红线 |
| L3 用户走查 | 真体感：一段真实剧本 + 你（或我扮演用户）跑通闭环 | 走查记录 + 截图对账清单（逐项 vs 样张/预期）；体验/UX/设计问题修复单 | 所有冒出的问题**修完**才算完成 |
| 门岗 | 交付前全跑 | contracts（R22）+ lint + typecheck + check:* 族 | 全绿 |

**L2 场景清单（真实任务，含 resolve 特有断言目标）**：
1. 长对白一拍超单条上限 → planner 收到 resolve 的拆条建议并采纳（生成 2 条连续 + 首尾帧承接）；
2. 相邻同场短拍 → resolve 建议合并，用户采纳 → 画布上并成一个节点、时长=和；不采纳则保持两镜；
3. 低于下限的碎镜 → 自动并入邻镜（用户可见说明），不再出现"生成即截断/被钳到 4s"；
4. 幻觉防线：LLM 塞一个编造参数键/超上限时长 → resolve 拦下并给出可读 issue（fail-closed），不落请求。

**L3 走查对账清单锚点**：① 与获批样张逐项并排；② 文案与参数均为机器算出的中文理由；③ 采纳/展开交互无卡顿；④ 落画布后再编辑不丢 resolve 状态；⑤ 全流程零额度（不真调 provider）。

> 执行顺序：Step 2 真实 UI 完成后先跑 L2（截图自审）→ 交 L3 用户走查 → 问题修完 → Step 4 分支 + PR。

## 附录 D：Step 2 呈现形态决策（2026-09-06 用户拍板）
- 用户「你的推荐」→ 采用**表格为默认**：`docs/design/mockups/2026-09-06-generation-strategy-review-table.html`（token 化）为 Step 2 真实 UI 的呈现基准。原则：表格 = 分镜 + 生成计划一屏；策略作为列与行内 badge（# | 拍/内容 | 时长(原→建议) | 模型·模式 | 机器处置[采纳/为什么]）；<8 镜等需要叙事感的场景可回退卡片版（保留 review.html 作对照）。
- 采纳/拆条等仍建议式：用户逐行采纳 → 回写 PlanShot（applyMergeProposal/applySplitProposal 在 renderer 侧用）；落画布前再跑一次 resolve 作闸（fail-closed）。

## 附录 E：Step 2 GUI 接入设计（2026-09-06 实测，file:line）
- 呈现：方案在创作区全宽 `StoryboardPlanEditor`（storyboard 模式，非 resident 卡）；planner 产出经 `applyCanvasToolCall('propose_storyboard_plan')`（applyCanvasToolCall.ts:282-317）→ `parseStoryboardPlan`（storyboardPlanSchema.ts:102-104）→ `setStoryboardPlan`（workbenchDocumentSlice.ts:240-296）。「确认落画布」v5 已删；实际执行=行「生成」`generateShotRow` / footer `runStoryboardBatch`（storyboardRowActions.ts:195/323）→ `materializeShotRow`(:157-189) → `create_canvas_nodes`（renderer 直写 store）。
- resolve 接线（三选一已定 (a) 窄 IPC + (b) 局部闸，不选 (b-L）：
  - **A 段（审阅建议）**：新增主进程窄 IPC（仿 `nomi:generation:*`），handler 调 appIntegration 已实例化的 planning seam `generationPlanning({capability:'resolve', params, lease})`（resolve 无副作用、operationId 已豁免，generationTransportAdapters.ts:283-304），返回与 agent/MCP 完全同源的 resolvedShots/mergeProposals/splitProposals/planIssues。StoryboardPlanEditor 加载/方案变化时请求一次。
  - **B 段（落画布闸）**：renderer 直写路径不走主进程 canvasWrite → 闸必须加在 `materializeShotRow`/`generateShotRow`/`runStoryboardBatch` 执行点（storyboardRowActions.ts:157/195/323）：执行前对 resolve 的 planIssues 做 fail-closed（有 error 级 issue 即拦并提示）。
  - 候选集同源：主进程 seam 用 registry 候选（deps.videoModelCandidates）；renderer 不自构候选（避免双源）。
- 采纳/回写：renderer 侧编辑机制 = `storyboardPlanEdits.ts`（不可变函数）+ `setStoryboardPlan`（StoryboardPlanEditor.tsx:365-466 多处 onChange）。逐行采纳 = 适配 `PlanShot→PlanShotInput`（id=shotId??'shot-'+i、sceneAnchorId=sceneId）→ `applyMergeProposal/applySplitProposal`（planResolver.ts:348-389）→ 映射回 PlanShot（保留 prompt/referenceBindings/keyframe）→ `setStoryboardPlan`。
- i18n：新文案加 `src/i18n/locales/storyboardEditor.ts`（zh/en 成对，namespace `storyboardEditor.*`，沿用 planCard/action 前缀风格；death-key 门岗约束）。
- 不做 (b-L)：planner LLM 回合内多调 resolve（吃回合往返 + runStoryboardPlanner.ts:74 onToolCall 白名单仅 propose_storyboard_plan）。

## 附录 F：实现进度（切片制，2026-09-06 起）
- 切片 1 ✅（已绿）：`src/workbench/generationCanvas/agent/storyboardStrategy.ts`（纯函数渲染/采纳适配：storyboardPlanToPlanShotInputs 只投影视频镜头、id 稳定；mergeStoryboardShots 采纳合并=位序保持/时长求和/锚并集/prompt 顺序拼接/绑定按 url 去重/renumber；splitStoryboardShot 采纳拆条=同锚绑定模型、时长分段、id 分化）+ `storyboardStrategy.test.ts` 5 用例绿。type-only import，不拉 i18n/store/React。
- 切片 2 ✅（窄 IPC resolve 通道，2026-09-07 完成，未 commit）：
  - **seam**（`mcpGenerationTools.ts`）：resolve 逻辑提为 `resolvePlanAdvisory(params)` 并在 lease 闸前提前返回 → **resolve 无 lease 可跑（GUI 窄 IPC 也是无 lease 进来）**；context/create/preview/gate_*/start… 仍强制 `A verified project lease is required`（TS 窄化：先 resolve 早退、其余统一收闸）。导出 `GenerationPlanningHandler` 可调用面类型（松散返回 unknown|Promise，兼容 authorities 注入的 DispatchContext 版）。新增用例「resolve is lease-free + 其余 capability 仍 fail-closed」。
  - **seam 暴露**（`appIntegration.ts`）：模块级 `installedGenerationPlanning` holder + `getInstalledGenerationPlanning()` 导出；`startCapabilityCore` 内 handler 构建完（`})` 后）赋值、`stopCapabilityCore` 清空。
  - **契约**（新 `electron/shared/videoCapabilities/planResolutionContracts.ts`）：`GenerationResolvePlanRequest{projectId, shots, goals?}` / `GenerationResolvePlanValue{resolvedShots, mergeProposals, splitProposals, planIssues}` / `GenerationResolvePlanEnvelope{ok,value|error{code,message}}` / `GenerationResolveErrorCode`（input_invalid / project_binding_stale / core_unavailable / invalid_result / failed）。barrel 增导出。
  - **窄 IPC**（新 `electron/capabilityCore/generationResolveIpc.ts`）：channel `nomi:generation:resolve-plan`；纯核心 `resolveGenerationPlanForProject`（顶层形状校验 fail-closed → committed projectId 比对（无打开项目/串项目都 stale）→ seam 未装配 unavailable → 调 `seam({capability:'resolve', params})`（无 lease）→ 结构 sanity 防御）可单测；`registerGenerationResolveIpc` 收口 assertTrustedSender + 信封（ok=false 带稳定 code，绝不裸抛异常到渲染层）。
  - **接线**：`main.ts` registerIpc 注册（lazy getter：`capabilityCoreModule?.getInstalledGenerationPlanning()` + `canvasReadSurfaceRuntime.getCommittedProjectSelection()?.projectId`）；`preload.ts` 加 `generationStrategy.resolvePlan`；`src/desktop/bridge.ts` `DesktopBridge.generationStrategy?`（可选，旧 preload 无此口兜住 undefined）。
  - **测试**：`generationResolveIpc.test.ts` 10 用例（happy 路径 / **GUI 无 lease 与直接 seam 带 lease 逐字段同源断言** / 形状非法 fail-closed×7 / stale×2 / unavailable / seam 深错透传 code / 形状退化 invalid_result / 信封映射×3）。验证：受影响套件 71 passed；`tsc electron + pi` 零错误；app tsc 仅剩他人未完成的 `videoDepthWorker.ts`（onnxruntime-web 未装）3 错，非本切片文件。
- 切片 3 ✅（GUI 执行计划审阅条，2026-09-07 完成，未 commit）：
  - **纯语义（storyboardStrategy.ts）**：`classifyResolveStrategy(value)→{mergeSuggestions(advisory), requiredMerges(must), splits, blockers(无采纳钮的致命问题)}`、`hasResolveBlockers`、`firstResolveBlockerMessage`、`applyMergeSuggestion`/`applySplitSuggestion`（merge/split 采纳包装）。闸与面板共用同一分类——不出现「面板说可以、闸说不行」。
  - **拉取 + 闸（新 strategyGate.ts）**：`storyboardResolveRequest`（无视频镜=null）、`fetchStoryboardResolve`（client 注入可测；无 client/无 projectId/通道错 → null）、`resolveGeneratableGate`（有阻断返回首条机器理由；envelope 错/fail-open 放行，边界注释化：生成合法性另有 main 契约钳值兜底，本闸是建议级拦截不是安全边界）。
  - **UI（新 StoryboardPlanStrategyPanel.tsx）**：Editor 表上方、随滚动；只按「引擎投影 key」重查（打字改 prompt 不触发 IPC）；三态（loading/unavailable/error）+ ready 建议条：必需=警示徽「必需」、效率合并=「建议」徽、拆条=「拆条」徽，每条「采纳/为什么(折叠 reason)」；阻断=红色无钮行。采纳 → apply 到方案 → 重查 → 建议消失（无双份已采纳态）。data-* 锚点齐（root/state/panel/adopt/why/blocker）。
  - **接入（StoryboardPlanEditor.tsx）**：滚动区顶部挂面板；新增 `guardMaterialize`（单镜生成 onGenerateRow / footer 整批 onRunBatch / 多选 onRunSelected 前置 resolve 闸）；regenerate/variants/锚卡生成不闸（不新增 PlanShot）。i18n `storyboardEditor.strategy.*` zh/en（satisfies 互校验）。
  - 测试：classify/gate/apply 5 用例（advisory 不阻断 / required+split 阻断 / underflow 覆盖去重 / standalone blocker / 首条理由）+ strategyGate 5 用例（投影过滤 / fetch null 分支 / gate blocker 与放行 / envelope 错放行 / image-only 放行）→ storyboard+agent+i18n 55 文件 597 绿。
- 切片 4 ✅ = 切片 3 内的 `guardMaterialize`（D3 B 段落画布前闸，随 3 一起验收）。
- 切片 5 ✅（契约层；L2/L3 留真机，2026-09-07）：L1/L1' 契约全绿（planResolver 19 + resolve 接线 72 + 切片2 10 + 切片3/4 10 + storyboard 目录回归 597）。L2 walk `tests/ux/storyboard-strategy-resolve.walk.mjs`：seed 4 条视频镜（40s 长镜 + 6/4/2s 短拍碎镜）→ 打开编辑器 → 面板三态截图 + ready 时采纳首条并截图重查 + 阻断文本记录 → 截图落 `tests/ux/shots/storyboard-strategy-resolve/` 人眼判断（R13：expect 只守结构性红线，建议数字因机 catalog 档位而异不强断言）。受限 shell 拉不起 GUI（既有边界），walk 随 PR 在真机跑；L3 用户走查（真实剧本闭环 + 对账清单）在 PR 后执行——附录 C 判定不变：问题修完才算完成。
- 切片 6：gates（vitest 相关目录 + electron/app tsc + lint + check:i18n 评估）→ delivery:preflight → 独立分支（worktree sibling，只带任务文件，避开工作区混入的 videoDepth/agent-artifact/DOCAUDIT 等他人改动）→ PR。INDEX.md 因含他人 depth 登记行未 commit 无法干净携带，登记随后续 main 收敛由 docs-autosync/人工补。

> 所有改动未 commit（main 本地工作区）——切片 1–5 已完成并本地验证；交付统一走切片 6 独立分支 + PR。
