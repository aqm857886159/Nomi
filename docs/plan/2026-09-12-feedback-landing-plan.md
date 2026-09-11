# 2026-09-12 真实使用反馈 · 落地方案（分批 / 顺序 / 验收门 / 自检）

> 状态：📝 方案 · 分支 `plan/feedback-landing-20260912` · 只有文档，无产品代码
> 作者：Fable 5.1（编排会话派出）· 拍板依据：用户 2026-09-12 当面拍板（§1）

## 0. 怎么读

**本文 = 落地方案**：每条问题落在哪一批、先后顺序、谁做、什么门算过、方案自己有没有洞。
**同伴两份文档 = 清单与根因**，本文只引用编号，不复述内容：

| 文档 | 它管什么 | 本文怎么引用 |
|---|---|---|
| `docs/plan/2026-09-12-issue-triage-by-feature.md` | 58 条问题按功能面对账、Q1–Q13 待答 | `#1`–`#58`、`Q1`–`Q13`、族 `A1`–`A7` |
| `docs/plan/2026-09-12-user-review-root-cause.md` | 逐条根因 file:line + 方案 | `B1`…`J`（簇字母+序号） |
| `docs/plan/2026-09-11-mcp-integration-quality.md` | MCP 接模型验证链路 P0–P3 | `MCP-P0`…`MCP-P3` |
| `docs/research/2026-09-12-real-onboarding-acceptance/README.md`（分支 `docs/real-onboarding-acceptance-20260912`） | 真实验收 10 条缺陷 | `P0-1`…`P2-9`、`P0-10` |

⚠️ **上面前三份此刻还没提交**（在主仓工作区里，属于另一位作者的会话）。它们随那位作者的分支入库前，本文里的相对链接不会解析。本文不搬它们的内容，只用编号。

术语第一次出现时用括号解释；每批小卡固定三问：**真实摩擦 → 为什么这样修 → 用户会看到什么变化**（D6）。

---

## 1. 今天的拍板一览（2026-09-12，有约束力；与同伴文档冲突处以本表为准）

| # | 拍板 | 取代 / 作废的旧结论 |
|---|---|---|
| J1 | **钱的闸没有预算设置，也不加回来**。三档 = 每步问 / 自动改 / 全自动（现役键名 `step / safe-auto / project`，`src/i18n/locales/agentPanelV4.ts:57` ✔️） | 作废同伴 Q2「预算内自动」；作废 09-11 P1 ⑨「`project.spend = confirm`」（`docs/plan/2026-09-11-permission-p1-implementation.md` 范围表第 ⑨ 行）|
| J2 | **「全自动」= 花钱也直接生成，不弹报价卡**；报价卡只在「每步问 / 自动改」出现。切到全自动那张二次确认卡（P1 ⑨ 已做）就是全自动档的钱的闸 | — |
| J3 | Q3 维持：**可撤销的本地操作直接执行 + 可撤销**（三档都一样，沙箱状态不影响它）| — |
| J4 | **创作区文稿工具全部改读主进程真相源**；只有「光标处插入 / 替换选区」两个动作保留渲染层依赖（它们本来就需要光标/选区这种只有界面知道的东西）| 作废同伴 B1 方案 ①②（「lane 侧校验 + 一次自动 re-capture」是给坏门打补丁）|
| J5 | 3D 导演台：AI 搭场景维持「粗模只给站位和机位用」，加界面说明 + 下一步引导；**补回 V1 的四步新手引导到 V2**；帮助入口目前藏在视口齿轮里要提出来；其余问题**单独走查一轮列清单**（Q1）| — |
| J6 | Q4：分镜面板「交给 Agent」「锁定」**终局删**，过渡期先修反馈 | — |
| J7 | Q5–Q13 走同伴默认（Q5 定稿后收成一行摘要；Q6 表内点格子即播放；Q13 设置精简包同意→出样张后动工）| — |
| J8 | Q7b = 助手输出 hover 浮出的复制 icon 无反馈；Q8 = ① 镜头卡显示的不是完整提示词 ② 锚定卡生成时没进镜头引用槽 ③「添加参考」浮层设计整体离谱；Q9 = skill 感觉没用上（研究分支 `research/skill-trigger-mechanism-20260912` **未推送**，本文写「待研究结论」）；Q11 = 「劈成两半」**根本没出现确认卡**；Q12 = 技能库技能卡左上角空黑胶囊角标 | 同伴 Q7/Q8/Q11/Q12 的「待指认」全部关闭 |
| J9 | P0-1（外部接入会话卡死 `needs_spend_confirmation`）：**删该状态**，正在 `feat/model-onboarding-two-paths-20260911` 做；P0-2（存 key 后自动发现返回空）批准，接在同一分支后面 | — |
| J10 | 接模型：**没有付费验证**；验证 = 免费自检 + 第一次真用；失败不下架，模型上挂原因 | 作废 MCP-P2「并发验证 / 部分晋升」里任何花上游额度的验证步 |
| J11 | 工具设计规则：一个工具 = 一种后果（状态 × 效果类别）；同格合并用 action，跨格必拆；**不留安全阀门**（禁 fallback / 静默转进 / 兜底），保险只能是「响」的检测器；先用脚本把同类全找出来再修（数门，`rule/door-map-root-cause-20260911`）| 作废同伴 A1 方案里的「可恢复错误自动重试一次」（那是静默转进）|
| J12 | 修法顺序：一次扫全再批量修（按根因族分批，只复扫一次）；派工默认 Codex，关键架构 Fable，其余 Opus；并行上限 6；用户可见改动先出样张（Claude Design 画布）再实现；按钮/图标五条规则；R16 真实任务闭环才算完成；Agent/工具改动要 R30 真实模型数字 | — |

---

## 2. 架构层六根（先立规矩，再分批关门）

「根」= 多条症状背后同一个结构性原因。每根：一句人话 / 证据 / 该立的规矩或门岗 / 由哪些批关掉。行号在 origin/main `499f3c943` 重核：✔️ 核过 · ⚠️ 未核（沿用同伴/编排者的号）。

### 根 1 · 工具看的是「哪个面板开着」，不是「项目数据」
- **人话**：Agent 读文稿，读的不是项目文件，而是「创作区面板此刻的快照通道」（surface port）。面板没打开就没有通道，读必失败。
- **证据**：`src/workbench/project/projectCanvasReadSurface.ts:405/419/438` 三处同型 `throw SurfacePortWireError('surface_port_unavailable')` ✔️；`electron/agentLane/laneDesktopTools.ts:73` 读文稿的 documentId 取 `context().documentId ?? ''` → 没有活跃文稿就传空串，写入恒 `document_target_stale`（`:119` 同型）✔️。trace：`read_full_text` 前 4 次全失败，用户点开创作区后同一调用成功。对照：`nomi_canvas_read` 读 store 一次成功。文稿有两条路（surface port 工具 / bash 直接写文件）= 第二扇门同病。
- **规矩**：**读写项目数据的工具，真相源只能是主进程的项目数据**，渲染层只提供「光标/选区」这种界面才知道的输入（J4）。数门：`read_script/write_script` 的写门归一。
- **关门批**：B1；B6b（「交给 Agent」删除的前提）。

### 根 2 · 失败没有「可恢复语义」
- **人话**：报错只有一个码 + 一句写死的「下一步」。`surface_port_unavailable` 的 Next 让模型再读那扇坏门 → 10 次撞闸。MCP 验证 `certifying` 死锁同族（MCP-P0）。
- **证据**：错误包装成 decision 返还模型、无状态派生的下一步（同伴 B1「`documentReadTransportAdapters.ts:50-51`」⚠️）；`fix/integration-run-failure-path-20260912` 已在治 MCP 那半（reaper + cancel）。
- **规矩**：返回信封的 `nextAction / unverified[]` **必须从真实状态派生**（面板没开 → nextAction=「请用户打开创作区」+ `unverified:[document]`），禁止静态文案；禁止「自动重试一次」这种静默转进（J11）。
- **关门批**：B2；MCP 那半依赖在途 `fix/integration-run-failure-path-20260912`。

### 根 3 · 确认分级没有单一表
- **人话**：「问不问」由每个调用点自己决定，所以两头都拧：可撤销的问、50MB 下载不问、花钱卡静默排队、沙箱一挂整档自动放行消失。
- **证据**：`electron/shared/agentCapabilities/codingCommandPolicy.ts:366-371` `!sandboxActive` → 整档 `ask` ✔️；`src/workbench/generationCanvas/videoDepth/NodeDepthActionButton.tsx:7` 拍板注释「点了就跑」✔️；`src/workbench/generationCanvas/spend/spendConfirm.ts:116-134` 单槽 + FIFO 排队 ✔️；设置页另有一份三档 `guided/balanced/policy-auto`（`src/workbench/settings/AutomationPermissionsSection.tsx:188-190` ✔️）；`laneApprovalGate.ts:173` 强制降 step ⚠️。
- **规矩**：**一张表**：行 = effectClass（效果类别：可撤销本地 / 花钱 / 撤不回 / 只看模式 / 本地大下载 …），列 = 三档，格 = 自动 / 确认 / 禁止。所有调用点只查表。**沙箱退化只能把某一格「自动→确认」，不能改档、不能让整档消失**。J1/J2 直接填表。
- **关门批**：B3；B12（沙箱状态可见）依赖它。

### 根 4 · 同一语义多份定义
- **人话**：画幅有四个来源没先后（skill 封面比例 / 项目画幅 / `plan.aspectRatio` / 模型默认），显示侧兜底 9:16、请求侧不读；模型清单两份；权限档两份。
- **证据**：`src/workbench/generationCanvas/agent/storyboardPlan.ts:551-554` materialize 只抄 `shot.params`，整片画幅从未注入 ✔️；`src/workbench/creation/storyboard/StoryboardShotTable.tsx:188` 图片+视频模型清单硬拼 ✔️；`shotFrameGeometry.ts:19-20` 兜底 9:16 ⚠️；权限两份见根 3。09-05 已拍「画幅项目级 + 行覆盖」。
- **规矩**：每个语义写明**单一 owner**（§7c 表），进 `check:vocabularies`；显示侧与请求侧读同一个函数，删兜底常量。
- **关门批**：B5（画幅、模型清单、设置页两块）；B3（权限档）。

### 根 5 · Skill 只是「让模型读一个 md」
- **人话**：Skill 没有「调用」这个动作，只是系统提示里一行名字+描述，模型自己决定去不去 `read` 正文；没有输出契约、没有「用了」回执。
- **证据**：`electron/agentLane/laneSkillIndex.mts:12-22` 明写「不新造 `load_skill` 工具 · 自动触发就是 description」✔️，`:125-131` 只渲染索引 ✔️；trace 里 `read /Users/aoqimin/Desktop/Nomi/skills/.../SKILL.md`（开发仓路径）。
- **规矩**：skill 正文 = 结构化提示词包，一处挂载 + 显式 load + 回执。**等研究分支结论**，本文只占位。
- **关门批**：B11（待研究）。

### 根 6 · 沙箱没网，且模型不知道
- **人话**：模型在沙箱里 `curl` 全 000 / exit 56，没人告诉它「这里没网」，它随后编了一张 DeepSeek 能力表。
- **证据**：`electron/agentLane/laneCodingSandbox.mts:110/122` 两种 inactive 原因 ✔️、`:114` 网络白名单 ✔️；`codingCommandPolicy.ts:380-382` 网络命令默认 ask ✔️。⚠️ 与同伴 B2「沙箱未生效」表面矛盾（没生效怎么会被沙箱断网？）——两种可能：沙箱活着但断网 / 沙箱死了但代理不通。**需真机探针定一**，B12 第一步。
- **规矩**：沙箱状态（启用与否 / 网络策略 / 原因）必须同时给用户（面板一行）和模型（工具结果里的结构化字段），不许让模型从 exit code 猜。
- **关门批**：B12。

### 附：UI 级的族（门岗材料，不是架构）
A4 反馈缺失 / A5 每帧全量重算 / A6 深底小字 / A7 optional 回调不接线 —— 分别由 B7 / B8 / B7 / B6a 关，各自附一条可机器验的门（§3 各卡「验收门」）。

**今天新增两个族**：
- **「工具回执说有卡，宿主没渲染卡」**（报价卡、「劈成两半」确认卡 Q11）：静默分支在 `src/workbench/ai/v4/useAgentPanelSpendConfirm.ts:82-106`（`catch → setPending(undefined)`、只取 `rows[0]`）✔️、`electron/productionRun/productionActionIpc.ts:57-64`（读通道 `return []`）✔️、`electron/capabilityCore/appIntegration.ts:~512`（`installPendingSpendActions` 装配失败只 `logError`）✔️。→ B4。
- **「隔离实例改写用户全局宿主配置」**：`electron/capabilityCore/mcpConfig.ts:59` 任何实例都写 `~/.codex/config.toml` ✔️、`:196/:224` 优先指向 `/Applications/Nomi.app` ✔️、`:499-502` 的 `NOMI_E2E` 守卫只挡 `repairStaleMcpConfigs` 不挡安装 ✔️；`tests/ux/mcp-l2-journeys.e2e.mjs` 零处 backup/restore ✔️。→ B13。

---

## 3. 批次表（按根因族分批，不按功能面）

规模：S ≤ 1 天 / M 2–3 天 / L ≥ 1 周。执行者：Codex（默认）/ Opus / Fable（关键架构）。「不许加的阀门」= 这一批里明确禁止出现的写法。

### 在途工作（只依赖，不重做）

| 在途 | 状态（09-12 fetch） | 解锁 | 
|---|---|---|
| PR #754 接模型工具面收成 4 个工具 | open | B13、P0-1/P0-2 的落点 |
| PR #757 P1.1b 改参数重出卡 | open | B3（报价卡三档语义）、B4（报价卡渲染门）、排队项「报价卡右上角 ×」 |
| PR #758 模型框整理（显示/排序/默认/记住手选）| open | B5 的 #49（记住上次选择）可能已被它覆盖，合入后复核 |
| `fix/param-panel-flat-options-20260911` | **未推送** | B6a 参数行样式；文件面未知 ⚠️ |
| `rule/door-map-root-cause-20260911`（数门 + `check:door-map`）| 已推，22 文件 | **所有 recurring 合同**的 `doors` 字段；B1/B3/B4/B5 都要用 `scripts/door-map.mjs` |
| `feat/agent-tool-face-single-owner-20260911`（PR A）→ `feat/agent-tool-face-20-verbs-20260911`（PR B，`read_script/write_script`）| A 已推 111 文件；B **未推送** | B1（在 `read_script/write_script` 之上改真相源，不在旧 20 动词上改）|
| `feat/model-onboarding-two-paths-20260911`（+P0-1 +P0-2）| 远端只有 4 个 docs 文件；验收报告称 15 个本地提交未推 ⚠️ | B13 全部；J9/J10 的落点 |
| `fix/integration-run-failure-path-20260912` | 已推（docs 4 文件）| B2 的 MCP 半边（reaper / cancel），B2 不重做 |
| `tooling/gates-risk-tier-20260912` | **未推送** | #1 门岗分档；本文不再列为批 |
| `docs/agent-tool-face-research-20260911` | **未推送** | B1/B2 的「先查别人」引用 |
| `docs/real-onboarding-acceptance-20260912` | 已推 | B13 缺陷清单来源 |
| `research/skill-trigger-mechanism-20260912` | **未推送** | B11 前置 |
| 排队项：报价卡右上角 ×（#757 后）| 未开工 | 并入 B4 |
| 排队项：画布第三刀（画布工具 → 同一扇门、静默分支可见）| 未开工 | 与 B4 同族不同文件；B4 不碰画布工具 |
| 排队项：Goal 模式 | 未开工 | 不在本文 |

### B1 · 文稿真相源（根 1）
| 项 | 内容 |
|---|---|
| 条目 | #2 #3 B1 B5 |
| 真实摩擦 | 用户说「随便给我写」，Agent 读不到文稿、绕道直接写文件、写又要确认，循环。 |
| 根因 owner 层 | 主进程 · 文档 store（`electron/capabilityCore/document*`）|
| 改法（只删/收敛）| ① `read_script / write_script`（PR B 的两个动词）改读写主进程文档 store，删 surface port 依赖；② 仅「光标处插入 / 替换选区」两个 action 保留渲染层输入，面板没开时回 `nextAction=open_creation_panel`（不是错误码裸奔）；③ **删第二扇门**：沙箱路径策略把项目文稿文件设为 bash 不可写（响的拒绝，带 `use write_script` 提示），不靠系统提示词劝。**不许加**：lane 侧「自动 re-capture 重试」、bash 写文稿的兜底路径。 |
| 样张 | 不需要（无 UI 变化）|
| 验收门 | R16：创作区**没打开**时说「把第二段改成 X」→ 文稿真的变了；R30：loopback 夹具 + DeepSeek 小样 ≥20 句，`read_script` 工具写对率、回合成功率写进 PR；trace 断言：`surface_port_unavailable` 在 `read_script/write_script` 路径 = 0；数门：文稿写门 before N → after 1（+2 个光标 action）写进合同 `doors` |
| 依赖 | PR B 合入；`rule/door-map` 合入 |
| 规模 / 执行者 | L / **Fable** |
| 主要文件 | `electron/agentLane/laneDesktopTools.ts`、`laneDocumentTools.ts`、`electron/capabilityCore/documentReadTransportAdapters.ts`、`documentWriteTransportAdapters.ts`、`src/workbench/project/projectCanvasReadSurface.ts`、`src/workbench/NomiStudioApp.tsx`、`electron/agentLane/laneCodingPaths.mts` |

### B2 · 失败回执可恢复（根 2，Agent 面）
| 项 | 内容 |
|---|---|
| 条目 | #2（撞闸 10 次那半）、A1 族 Agent 侧；MCP 半边归在途 failure-path |
| 真实摩擦 | 报错是内部术语，「下一步」是死文案，模型只能反复撞。 |
| 根因 owner 层 | 主进程 · 工具返回信封（`electron/capabilityCore/mcpToolErrorResults.ts` / `capabilityExecutorRegistry.ts`）|
| 改法 | 信封加 `nextAction`（枚举，从状态派生）+ `unverified[]`（这次没验到的对象）；删所有静态 Next 文案；错误出模型前必须过说人话层（已有 `mcpToolErrorResults`）。**不许加**：自动重试、把错误吞成空结果。 |
| 样张 | 不需要 |
| 验收门 | 门岗：`check:error-surface`（已有）扩一条「返回信封含 nextAction 且非常量」；R30：同一 20 句在「面板未开」环境下回合成功率 ≥ B1 前 +50%；trace 断言：同一错误码连续出现 ≤ 2 次 |
| 依赖 | B1（先有正确的门再谈回执）；`fix/integration-run-failure-path` 合入（避免两份 reaper）|
| 规模 / 执行者 | M / Opus |
| 主要文件 | `electron/capabilityCore/mcpToolErrorResults.ts`、`capabilityExecutorRegistry.ts`、`electron/agentLane/laneDesktopTools.ts`（与 B1 同文件 → 串行）|

### B3 · 确认分级一张表（根 3）
| 项 | 内容 |
|---|---|
| 条目 | #4 #5 #14 #15 #33 #45（确认半）#52 #53、J1 J2 J3、A3 族 |
| 真实摩擦 | 全自动下还一直弹卡；可撤销的问、下载不问；点「仍要生成」像没反应。 |
| 根因 owner 层 | 主进程 · 权限策略表（现役 `PERMISSION_POLICIES` 在渲染层 `src/workbench/ai/v4/agentPanelV4Types.ts:303` ✔️，本批搬到主进程成为唯一 owner）|
| 改法 | ① 一张表：effectClass × 三档 → 自动/确认/禁止；**全自动列：花钱=自动（J2）、可撤销本地=自动、撤不回=确认、只看模式=禁止写、本地大下载=自动+进度+可取消**；每步问列全部=确认；自动改列：花钱=确认、其余同全自动。② 删设置页「默认制作模式」三档（#52），`settings.mode` 单一 owner = 面板三档；「支付与风险边界」（#53）里凡是预算数字的项**删**（J1），剩下的收进表的「花钱」行说明 ⚠️ 具体字段待实施时核。③ 沙箱退化：只把「沙箱内命令」那一格 自动→确认，附一行原因 + 会话级「不再问」（同伴 B2 ③），不再降整档为 step。④ 深度模型首次下载（#33）按表 = 自动 + 进度条 + 可取消（每步问档除外），删「点了就跑」的特例注释——它不再是特例，是表的一格。⑤ 卡的排队可见（#15）：按钮徽标「排队 #2」，卡上队列计数。**不许加**：任何调用点自己判断问不问；「沙箱不可用则全部问」的整档开关。 |
| 样张 | 三档说明文案改动小，不等拍板；卡上的队列计数走设计实验室基线 |
| 验收门 | 数门：`scripts/door-map.mjs` 扫 `forceConfirmation` / `decision:` 的全部调用点 → 合同 doors，after = 1（查表函数）；R30：全自动档 20 句真实任务 → 报价卡 0 张、可撤销命令卡 0 张；每步问档 → 每个花钱/撤不回动作恰 1 张；走查：沙箱不可用机器上全自动档跑 `ls`/写项目文件 → 只出 1 行原因 + 可记住；单测：表的每格有用例 |
| 依赖 | PR #757 合入（卡的重出逻辑）；P0-1 删状态在 two-paths 分支（B3 不碰 `integrationSession`）|
| 规模 / 执行者 | L / **Fable** |
| 主要文件 | `electron/shared/agentCapabilities/codingCommandPolicy.ts`、`electron/agentLane/laneApprovalGate.ts`、`laneNativeApproval.ts`、`src/workbench/ai/v4/agentPanelV4Types.ts:303-306`（现役 `PERMISSION_POLICIES`，三档 spend 全 `confirm` → 表要搬到主进程、`project.spend` 改自动）、`src/workbench/settings/AutomationPermissionsSection.tsx`、`electron/settings/automationPolicySettings.ts`、`src/workbench/generationCanvas/videoDepth/NodeDepthActionButton.tsx`、`electron/video/depthVideoModelCache.ts`、`src/workbench/generationCanvas/spend/spendConfirm.ts`（与 B4 同文件 → 串行）|

### B4 · 卡说有、宿主必须画（新族）
| 项 | 内容 |
|---|---|
| 条目 | #14 #15（反馈半）#45（Q11「没出现确认卡」）、排队项「报价卡右上角 ×」 |
| 真实摩擦 | Agent 说「请确认」，界面上什么都没有。 |
| 根因 owner 层 | 渲染 · 介入槽投影（`useAgentPanelSpendConfirm.ts`）+ 主进程装配（`appIntegration.ts`）|
| 改法 | ① `productionActionIpc.ts:57-64` 读通道不再 `return []`，回 `{state:'not_ready'|'wrong_project'|'ok', rows}`；② `useAgentPanelSpendConfirm.ts:82-106` 删 `catch → undefined`，not_ready 渲染成介入槽的一行状态（「确认通道未就绪」），`rows[0]` 改为队列投影；③ `appIntegration.ts:~512` 装配失败 → 面板可见错误态，不只 log；④ 「劈成两半」这类时间轴确认卡：工具回执里的 `card` 种类必须在渲染注册表里有 owner；⑤ 报价卡 ×（= 丢弃）。**不许加**：任何 `catch {}` 吞成空；第二条渲染分支。 |
| 样张 | × 与状态行走设计实验室基线；不等拍板 |
| 验收门 | 门岗新增 `check:card-owner`：脚本枚举工具回执可返回的 card kind（从 `.d.ts`/枚举抽）vs 面板渲染注册表，缺一即红；走查（真人式操作）：每步问档说「把这段视频劈成两半」→ 1s 内介入槽出卡（`expectPresent`，不是 expectAbsent）；R30 loopback 回合成功率 |
| 依赖 | PR #757 合入 |
| 规模 / 执行者 | M / Opus |
| 主要文件 | `src/workbench/ai/v4/useAgentPanelSpendConfirm.ts`、`AgentPanelV4Panel.tsx`、`electron/productionRun/productionActionIpc.ts`、`electron/capabilityCore/appIntegration.ts`、`electron/agentLane/laneTimelineTools.ts`、`scripts/check-card-owner.mjs` |

### B5 · 画幅 / 模型清单 单 owner（根 4）
| 项 | 内容 |
|---|---|
| 条目 | #18 #19 #20 #21 #22 #38（比例半）#49 #50 P0-10、D1–D4、D6（双节点说明）|
| 真实摩擦 | 面板竖屏、生成横屏；换画幅全换；图片模型能套到视频镜；文本模型接进来了创作助手却选不到。 |
| 根因 owner 层 | 渲染 · 分镜方案（画幅）/ 主进程 · 模型目录（清单）|
| 改法 | ① 画幅 owner = `effectiveShotAspect(plan, shot)`（项目画幅 + 行覆盖，09-05 拍板）；`storyboardPlan.ts:551` materialize 写进 params；**删** `FALLBACK_RATIO 9:16` 与「选默认值即清除覆盖」隐式行为；批量条改显式「应用到全部」，单镜画幅常驻镜卡；H3 首帧镜显示「跟随参考图比例」禁用态；首帧双节点合一个视觉容器。② 模型清单 owner = 目录按 kind 派生：`StoryboardShotTable.tsx:188` 删硬拼，改用与 `CanvasBulkModelSelect` 同一派生；创作助手文本模型下拉同源（P0-10）。③ 设置页 #50 删「允许的供应商/模型」（owner = 接入确认 approvedModelAccess）；#49「记住上次」以 #758 合入后复核，若已覆盖则本批不动。**不许加**：显示侧兜底常量；第二份 kind 过滤。 |
| 样张 | 画幅控件重排 = 用户可见 → Claude Design 画布出样张（小改，不阻塞 ①②）|
| 验收门 | `check:vocabularies` 词表加 `aspect` owner（登记 + 复制即红）；真生成走查（额度默认授权）：选 9:16 → 出图为 9:16（读文件真实尺寸）；单测：图片模型套视频镜被拒；R16：接一个只有文本的供应商 → 创作助手能选到它 |
| 依赖 | PR #758 合入（设置页那半）；②③ 与 B13 P0-10 共 owner，B13 不重做 |
| 规模 / 执行者 | M / Codex |
| 主要文件 | `src/workbench/generationCanvas/agent/storyboardPlan.ts`、`src/workbench/creation/storyboard/{StoryboardShotTable,StoryboardBulkBar,ShotComposerBar}.tsx`、`shotRow/shotFrameGeometry.ts`、`storyboardAspectScope.ts`、`src/workbench/ai/v4/agentPanelV4ModelRows.ts`、`src/workbench/settings/AiModelsSection.tsx` |

### B6a · 分镜面板接线 + 反馈（A4 / A7）
| 项 | 内容 |
|---|---|
| 条目 | #9 #10 #11 #12 #13 #23 #24 #25（过渡修反馈）#26 #27 #28 Q7b Q8①②③ C1–C5 D5 |
| 真实摩擦 | 8 镜头卡收不起、取消不了、滚不动；「生成中」看不清；对钩点不掉；锚卡没出图镜头就静默无参考。 |
| 根因 owner 层 | 渲染 · 面板宿主接线 + 分镜编辑器 |
| 改法 | ① **R28：`onCollapsePlan / onPlanToggle` 从 optional 改 required**（编译器拦，不用 dev warn）；计划卡加取消钮、滚动容器；② #10/Q8① 镜头卡显示完整提示词（信息设计）；③ Q8② 锚卡未出图 → `generationReferenceResolver` 的 `if (!sourceUrl) continue` 删，改为镜头卡显示「缺参考」并阻断生成（响），「跨镜头一致」镜 `image_ref` min=1；④ Q8③「添加参考」浮层整体重做（先样张）；⑤ #24 锁定：删按钮，批量重跑**默认排除已生成镜头**、要包含的显式勾选（规则，不是问）；#25 交给 Agent：过渡=点击展开面板+预填；#23 无场时隐藏；#26 编号=定位、勾=纳入，加 title；#12 丢弃方案同步清画布派生节点，修 `designs[0]` 复活；#13 busy/disabled；Q7b 复制反馈。**不许加**：optional 回调 + dev warn；参考缺失时静默跳过。 |
| 样张 | 需要：8 镜头卡布局、镜头卡信息层级、「添加参考」浮层三张（Claude Design）；#13/#23/#26 小改不等 |
| 验收门 | 走查（真人式）：8 镜头卡收起/取消/滚动/勾选各一断言；锚卡失败场景 → 镜头卡出「缺参考」；`check:controls` 扩「有 onClick 的控件必有 busy 或即时终态」（A4 门）；设计实验室基线 |
| 依赖 | 无（与 B5 同目录 `src/workbench/creation/storyboard/` → **不能同时派**）|
| 规模 / 执行者 | L / Opus |
| 主要文件 | `src/workbench/ai/v4/AgentPanelV4Cards.tsx`、`src/workbench/ai/ProjectAgentResidentShell.tsx`、`src/workbench/creation/storyboard/*`、`electron/capabilityCore/generationReferenceResolver.ts`、`src/workbench/generationCanvas/reference/{AssetPickerPopover,ShotReferenceSlotPopover}.tsx` |

### B6b · 删「交给 Agent」（J6 终局）
| 项 | 内容 |
|---|---|
| 条目 | #25 终局 |
| 改法 | B1 合入后，Agent 能直接读分镜 + 「选中即上下文」⚠️（是否已在 main 待核）→ 删按钮、删 i18n、删走查里的旧锚点（`dead-selector` 教训：grep 全部用法）|
| 验收门 | R16：选中 3 个镜头对 Agent 说「把这三镜改成夜景」→ 不点任何按钮就改对 |
| 依赖 | B1 |
| 规模 / 执行者 | S / Codex |

### B7 · UI 卫生批（A6 深底小字 / A4 反馈 / 角标）
| 项 | 内容 |
|---|---|
| 条目 | #7 #13（文字半）#28（标签半）#31 #40 #46 #47 #48 Q12 #57 E2 E4 I4 |
| 真实摩擦 | 灰字看不清、「已保存到项目」常驻废话、角标截断、封面坏图、复制没反馈、技能列表一行一个。 |
| 改法 | 对比度提级（token 门内）；「已保存」降一次性；角标短文案 + tooltip，弹框 Portal；封面失效 → **可见的「封面失效」占位态**（这是状态不是兜底）+ 抽帧；复制成功打勾（复用 `MobileConnectDialog` copied 态）；技能列表两列网格；Q12 空黑胶囊：定位组件后删空角标。**不许加**：第二套 copied 态；40% 灰用于信息文字。 |
| 样张 | 小 UI 不等拍板（教训「样张拍板只卡大 UI」）；技能列表网格出一张 |
| 验收门 | `check:feel` 对比度断言（叠/裁/拦/出视口/对比度库）覆盖这几处；走查截图人眼；设计实验室基线 |
| 依赖 | 无 |
| 规模 / 执行者 | M / Codex |
| 主要文件 | `src/workbench/creation/storyboard/{StoryboardShotFrame,StoryboardAnchorRow}.tsx`、`src/workbench/generationCanvas/nodes/{ProvenancePanel,artifactNodeSlots}.tsx`、`src/workbench/assets/AssetVideoCover.tsx`、`src/workbench/library/ProjectLibraryPage.tsx`、技能库卡片组件 |

### B8 · 高频路径每帧全量重算（A5）
| 项 | 内容 |
|---|---|
| 条目 | #6 #32 #36 #37 B4 C8 H1 H2 |
| 真实摩擦 | 过程文字卡顿；60 张图拖动极卡；缩放条拖动卡。 |
| 改法 | 流式 delta rAF 合帧 + `V4FlowRow` memo + 稳定 key + 尾消息增量 markdown；多选拖动容器级 transform、松手写回；缩放条拖动无动画 `setViewport` + 自绘 thumb；GroupFrame 补 resize 把手（#37，功能缺失）。**不许加**：第二条渲染路径（如「大列表模式」开关）。 |
| 样张 | 缩放条 thumb / 拉环走设计实验室 |
| 验收门 | 性能数字（darwin 校准、平台感知预算）：60 节点拖动 ≤ 16ms/帧、流式 1000 token 渲染次数 ≤ 60；R23：迁移前行为对照（磁吸/框选不回退）；走查截图 |
| 依赖 | PR #755 磁吸把手合入（同目录）|
| 规模 / 执行者 | M / Opus |
| 主要文件 | `src/workbench/ai/v4/{useAgentPanelV4Data,AgentPanelV4Panel}.tsx`、`NomiMarkdown.tsx`、`src/workbench/generationCanvas/reactFlow/{useCanvasSelectionDrag,CanvasNavigationStack,GenerationCanvasReactFlow,GroupFrame}.tsx` |

### B9 · 拖放静默过滤 + 时间轴 + 深度任务可见（A1 用户面 / A4）
| 项 | 内容 |
|---|---|
| 条目 | #34 #35 #39 #42 #43 #44 E1 F1 F2 F3 G2 G3 G4 |
| 真实摩擦 | 素材拖不进画布/预览页，零提示；时间轴收不回；深度下载卡住、画面变黑。 |
| 改法 | `canvasStageDrop.ts` 的 `if (!allowedItems.length) return` 删，改为响的提示（「素材属于其他项目」）；「项目素材」tab 要么画布也认、要么视觉禁用拖拽（二选一，默认：画布也认）；预览页 drop 区纳入；时间轴容器**合成一个带 collapse 的组件**（P1 加新删旧，两页共用）；#44 先真机复现列清单，重构走样张；深度：进度条 + 停滞检测（30s 无字节即报错可重试）+ 可取消 + 节点「下载中/推理中」状态；#35 复现后修。**不许加**：静默 return；第二个时间轴容器。 |
| 样张 | 时间轴「两轨 + 拖动预览」重构必出样张（拍板点见 §6）；其余不等 |
| 验收门 | 走查：拖素材到画布/预览页各一断言（成功 + 跨项目提示）；深度下载模拟停滞 → 30s 内出错提示；预览页时间轴收起持久化 |
| 依赖 | 无 |
| 规模 / 执行者 | M / Codex |
| 主要文件 | `src/workbench/generationCanvas/reactFlow/canvasStageDrop.ts`、`src/workbench/assets/*`、`src/workbench/preview/PreviewWorkspace.tsx`、`src/workbench/generation/GenerationWorkspace.tsx`、时间轴 panel 组件、`electron/video/{depthVideoModelCache,depthVideoJob}.ts` |

### B10 · 拆解失败可见 + 失败持久化 + 一键反馈（A1 用户面 / J）
| 项 | 内容 |
|---|---|
| 条目 | #41 #56 E3 J |
| 真实摩擦 | 拆解全失败满屏「没读出」、秒数 0.0333；失败了没法一键把日志发过来。 |
| 改法 | 秒数格式化 + 最小镜头时长合并伪切点；全失败 → 顶部一条失败原因（从主进程结构化日志来），删每格「没读出」兜底文案；生成失败原因随任务行落盘；任务中心失败行 + Agent 报错处「一键反馈」= 预填摘要 + 诊断包引用。**不许加**：每格 fallback 文案。 |
| 样张 | 一键反馈按钮位置走按钮五条规则，小改不等 |
| 验收门 | 单测：min-shot 合并；走查：注入抽帧失败 → 顶部原因 + 反馈按钮预填；重开项目仍见失败原因 |
| 依赖 | 无 |
| 规模 / 执行者 | M / Codex |
| 主要文件 | `electron/*/deconstructVideo.ts`、`src/workbench/shotTable/ShotTableGrid.tsx`、`shotTimeline.ts`、`src/workbench/tasks/TaskCenterPanel.tsx`、`feedbackDiagnostics.ts`、`diagnosticsBundle.ts` |

### B11 · Skill = 结构化提示词包 + 显式 load + 回执（根 5）
| 项 | 内容 |
|---|---|
| 条目 | #8 #38（提示词半）Q9 B3 P2-8 P2-9 |
| 状态 | **待研究结论**（`research/skill-trigger-mechanism-20260912` 未推送）。占位只写边界：一处挂载（删「Skill 按钮拼正文」与「索引 read」两条路中的一条）、显式 load 动作、回执（`skillsUsed[]` 进转录）、读的是安装目录不是开发仓路径。**不许加**：第三条注入路径。 |
| 验收门 | R30：20 句 → skill 回执率 + 回合成功率；trace 断言：无开发仓路径 read |
| 依赖 | 研究分支结论；B1（工具面稳定后再动挂载）|
| 规模 / 执行者 | L / **Fable** |
| 主要文件 | `electron/agentLane/{laneSkillIndex,laneDesktopRuntime}.mts`、`lanePromptSections.ts`、`src/workbench/ai/v4/useAgentPanelV4Actions.ts`、`electron/skills/*` |

### B12 · 沙箱状态对人对模型都可见（根 6）
| 项 | 内容 |
|---|---|
| 条目 | #4（原因半）B2 ①④、根 6 |
| 改法 | 第一步探针（S）：在用户机器上跑 `openLaneSandbox`，定一「inactive 原因」vs「活着但断网」；第二步：工具结果结构化字段 `sandbox:{active, network, reason}`，面板一行状态；网络被拒时命令结果明写「沙箱无网」而不是 exit 56。**不许加**：沙箱失败时自动改走无沙箱路径。 |
| 验收门 | 走查：断网沙箱里跑 `curl` → 模型收到 `network_denied`，不再编能力表（R30 小样 5 句）；面板状态行截图 |
| 依赖 | B3（同文件 `codingCommandPolicy.ts` / `laneCodingSandbox.mts`）|
| 规模 / 执行者 | S+M / Opus |
| 主要文件 | `electron/agentLane/{laneCodingSandbox,laneCodingTools}.mts`、`codingCommandPolicy.ts` |

### B13 · 接模型：两条路之后的余项（J9 J10 + 新族「隔离实例改写宿主配置」）
| 项 | 内容 |
|---|---|
| 条目 | P1-3 P1-4 P1-5 P1-6 P1-7 P0-10（与 B5 共 owner）、MCP-P3 ①、`mcpConfig.ts` 越权写 |
| 真实摩擦 | 接完设置页不刷新；进度卡从没出现；选了 Codex 落到 Claude 面板；配置永远指向装机版且每次启动改回去；`codex exec` 一步走不了。 |
| 改法 | P1-3 completed 事件主动推目录刷新；P1-4 进度卡接线（文案已在 `onboardingProviders.ts:552` 起）；P1-5 `onOpenAssistantConnections` 带宿主；**P1-6 删 `/Applications/Nomi.app` 优先，launcher 只从 `process.execPath` 派生；删启动时重写客户端配置，只在用户点「一键接入」时写**；P1-7 删 `default_tools_approval_mode="writes"`（审批由 Nomi 自己的三档表管，不双份）；e2e 加 backup/restore 断言（改了用户 `~/.codex/config.toml` 即红）。**不许加**：第二个 launcher 解析策略。 |
| 样张 | 进度卡已有设计稿，不再出 |
| 验收门 | 真实验收复跑（同 README 的 harness，Codex + DeepSeek 官方）：回合成功 ≥ 2/3，人工干预 ≤ 2 次（贴 key + 点保存）；`check:mcp-*` 现有门；e2e 前后 diff 用户配置 = 0 |
| 依赖 | PR #754 + `feat/model-onboarding-two-paths` 合入 |
| 规模 / 执行者 | M / Opus |
| 主要文件 | `electron/capabilityCore/mcpConfig.ts`、`electron/capabilityCore/modelOnboarding/*`、`src/ui/onboarding/AiAssistedOnboardingCard.tsx`、`src/workbench/settings/ModelSettings*`、`tests/ux/mcp-l2-journeys.e2e.mjs` |

### B14a · 3D 导演台走查清单（J5，R13）
| 项 | 内容 |
|---|---|
| 条目 | #58 Q1 |
| 改法 | 只出清单不修：按 J1–J5 真实任务（摆场景→摆角色→摆相机→运镜→出参考）走一遍，每步截图 + 情绪摩擦日志；产出 `docs/audit/2026-09-12-director-walkthrough.md` 给用户勾。 |
| 依赖 | 无 · S / Opus · 只读 |

### B14b · 3D 导演台四步引导 + AI 搭场景说明（J5）
| 项 | 内容 |
|---|---|
| 改法 | ⚠️ 修正编排者前提：`src/i18n/locales/scene3dJourney.ts` **不在 main**（`d3f68057c` 随 V1 一起删了），文案从 `git show d3f68057c^:src/i18n/locales/scene3dJourney.ts` 取回、按 V2 界面改写；引导挂在 `DirectorEditor.tsx` 首次进入；AI 搭场景结果卡加一行「粗模只用于站位与机位」+ 下一步按钮（去摆相机 / 出参考）；帮助入口从 `SettingsDialog`/视口齿轮提到视口右上 `?`（公认图形，§1.5 L2）。**不许加**：第二套引导框架。 |
| 样张 | 需要（四步引导 + 说明卡，Claude Design）|
| 验收门 | 走查：首次进导演台出第 1 步；AI 搭场景后出说明与下一步；帮助入口 1 次点击可达 |
| 依赖 | B14a 清单（合并同批修）· M / Opus |
| 主要文件 | `src/workbench/generationCanvas/nodes/director/{DirectorEditor.tsx,panels/dialogs/*,agent/*}`、`src/i18n/locales/director*.ts` |

### B15 · 设置页精简（Q13 默认同意）
| 项 | 内容 |
|---|---|
| 条目 | #51 #54 #55 I2 I3（#49 #50 → B5；#52 #53 → B3）|
| 改法 | 就绪模型折叠一行 + 开关，诊断进「更多操作」；未检测到的 MCP 宿主灰置/折叠（`BUILTIN_MCP_CLIENTS` 按 `appInstalled` 派生显示）；「可信发起方」移入 MCP 子页。**不许加**：第二份宿主目录。 |
| 样张 | 必出（Claude Design，三页）|
| 验收门 | 设计实验室基线；走查：未装 cursor 的机器上不显示「可接入 cursor」 |
| 依赖 | 样张拍板；PR #758、B3、B5 合入（同文件）· M / Codex |
| 主要文件 | `src/workbench/settings/{ModelSettingsWorkspacePages,AutomationPermissionsSection,ConnectAssistantCard}.tsx` |

---

## 4. 顺序、依赖图、并行分组、文件重叠

### 4.1 依赖 DAG（文字版）
```
在途: PR-A ─► PR-B ─► B1 ─► B2
                        └─► B6b
      #757 ─► B3 ─► B12
      #757 ─► B4
      #758 ─► B5 ─► B15
      #758 ─► B15 ◄─ B3
      #754 + two-paths ─► B13 (P0-10 与 B5 共 owner: B5 先)
      failure-path ─► B2
      research/skill ─► B11 ◄─ B1
      #755 ─► B8
      door-map ─► B1, B3, B4, B5 的合同
无依赖: B6a, B7, B9, B10, B14a ─► B14b
```

### 4.2 并行分组（≤6 路，按「可派时刻」）
| 波 | 同时派（≤6）| 触发条件 |
|---|---|---|
| W0 现在 | B7（Codex）· B9（Codex）· B10（Codex）· B6a（Opus）· B14a（Opus）· B12 探针（Opus，只读）| 无 |
| W1 | B3（Fable）· B4（Opus）· B5（Codex）· B8（Opus）· B14b（Opus）· B13（Opus）| #757 / #758 / #755 / #754+two-paths 合入；B6a 完成后才派 B5（同目录）|
| W2 | B1（Fable）· B12 修（Opus）· B15（Codex）| PR-B 合入；B3 完成；样张拍板 |
| W3 | B2（Opus）· B6b（Codex）· B11（Fable）| B1 合入；failure-path 合入；研究分支推送 |

### 4.3 文件重叠矩阵（同一行打 ● 的批不能同时派）
| 目录 / 文件 | B1 | B2 | B3 | B4 | B5 | B6a | B7 | B8 | B9 | B12 | B13 | B15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `electron/agentLane/laneDesktopTools.ts` | ● | ● | | | | | | | | | | |
| `electron/agentLane/{codingCommandPolicy,laneCodingSandbox}` | | | ● | | | | | | | ● | | |
| `electron/capabilityCore/appIntegration.ts` | | | | ● | | | | | | | | |
| `src/workbench/generationCanvas/spend/spendConfirm.ts` | | | ● | ● | | | | | | | | |
| `src/workbench/creation/storyboard/*` | | | | | ● | ● | ● | | | | | |
| `src/workbench/ai/v4/*` | | | | ● | ● | ● | | ● | | | | |
| `src/workbench/settings/*` | | | ● | | ● | | | | | | ● | ● |
| `src/workbench/generationCanvas/reactFlow/*` | | | | | | | | ● | ● | | | |
| `electron/capabilityCore/mcpConfig.ts` / `modelOnboarding/*` | | | | | | | | | | | ● | |
| `electron/video/*` | | | ● | | | | | | ● | | | |

处置：B3↔B4 串行（B3 先，卡语义定了再改渲染）；B5↔B6a 串行（B6a 先）；B7 只碰 storyboard 里两个文件，与 B6a 同执行者顺序做；B8↔B9 都碰 reactFlow → B9 只动 `canvasStageDrop.ts`，B8 不碰它，可并行；B3↔B9 都碰 `electron/video` → B3 只动下载确认入口、B9 动进度/取消，同文件 `depthVideoModelCache.ts` → **B9 先合再派 B3 那一格**。

---

## 先查别人（R27）

本文不引入新能力，只把问题落到批次；「先查别人」在这里 = **每批复用仓库里已有的哪一件**，禁止执行体再长一份。实施批开工前各自补自己的四问报告（`docs/research/<日期>-<主题>/prior-art.md`），这里只列已核实存在的复用件：

| 批 | 仓库里已有（file:line，origin/main `499f3c943`）| 用法 |
|---|---|---|
| B1/B3/B4/B5 数门 | `rule/door-map-root-cause-20260911` 的 `scripts/door-map.mjs`（分支内；方案 [docs/plan/2026-09-11-door-map-rule.md](2026-09-11-door-map-rule.md) 随该分支入库）| 合同 `doors` 字段由它生成，不手数 |
| B2 说人话层 | `electron/capabilityCore/mcpToolErrorResults.ts:125` `buildToolErrorOutcome` | 只加 `nextAction/unverified[]` 字段，不另写错误包装 |
| B2 门岗 | `scripts/check-error-surface.mjs` | 扩一条「信封含非常量 nextAction」，不新建门岗 |
| B3 三档表 | `src/workbench/ai/v4/agentPanelV4Types.ts:303-306` `PERMISSION_POLICIES`；先查别人已在 [2026-09-10-permission-model-rework.md](2026-09-10-permission-model-rework.md) §先查别人 与 [2026-09-11-permission-p1-implementation.md](2026-09-11-permission-p1-implementation.md) §先查别人（Claude Code / Codex / Cursor / Cline / MCP 规范六家）| 表搬主进程、按 effectClass 扩行，行业对照不重查 |
| B3 沙箱分档 | `electron/shared/agentCapabilities/codingCommandPolicy.ts:6-31` 头注（引用 Anthropic sandbox-runtime 与 OpenAI approvals 文档 URL）| 「沙箱退化只收紧」的理由已写在那里 |
| B4 卡队列 | `src/workbench/generationCanvas/spend/spendConfirm.ts:116-134` FIFO 队列 | 只把队列**投影到界面**，不再写第二个队列 |
| B5 词表门岗 | `scripts/check-vocabularies.mjs` | `aspect` 登记为新 owner，复制即红 |
| B5 模型清单 | `CanvasBulkModelSelect.tsx` 按 kind 过滤（同伴 D4 引 `:43`）| `StoryboardShotTable.tsx:188` 改用同一派生 |
| B6a/B7 反馈态 | `src/workbench/generationCanvas/nodes/director/panels/dialogs/MobileConnectDialog.tsx:38/116` copied 态 | 复制反馈复用，不新写 |
| B7 对比度门 | `scripts/check-feel.mjs` | 深底小字进断言库 |
| B6a 控件门 | `scripts/check-control-contract.mjs`（`check:controls`）| A4「必有 busy/终态」加到它上面 |
| B13 e2e 隔离 | `electron/capabilityCore/mcpConfig.ts:499-502` 已有 `NOMI_E2E` 守卫 | 把守卫从「修复」扩到「安装」，不另起隔离机制 |
| B13 接模型 | [docs/research/2026-09-10-vendor-key-publish-class/prior-art.md](../research/2026-09-10-vendor-key-publish-class/prior-art.md) | 「可用判据」的近邻已查，不重查 |
| 派工纪律 | [docs/engineering/agent-orchestration-playbook.md](../engineering/agent-orchestration-playbook.md) §16 | 任务书必须引用本文 + 对应批的 prior-art |

生态里已有 / 自媒体：本文不选型，不查；各实施批的 prior-art 自己答（B8 的多选拖动 transform 是 React Flow 社区常规做法，B8 开工时给 URL）。

---

## 5. 不做 / 延后（R2）

| 项 | 处置 | 理由 |
|---|---|---|
| Q2「预算内自动」/ 任何预算设置 | 不做 | J1 |
| 同伴 B1 ②「自动 re-capture 重试一次」、A1「可恢复错误自动重试」 | 不做 | 静默转进（J11）；B1 改真相源后不需要 |
| 同伴 B2 ②「沙箱不可用时 reversible_local 命令仍放行」 | 不做（改为 B3 ③ 只收紧那一格）| 「沙箱退化只收紧不改档」；bash 命令的可撤销性沙箱不可用时无法证明 |
| 同伴 A7「dev 模式 warn」 | 不做（改 required）| R28：能让编译器拦的别留给门岗 |
| MCP-P2 并发验证 / 大批拆批 | 延后 | J10 验证不花钱后，批次压力消失；先看 two-paths 落地数字 |
| #44 时间轴重构（两轨 + 拖动预览）| 延后到复现清单 + 样张 | 未定位单点，先复现（B9 只做收起把手）|
| #37 编组框 resize 拉环 | 留在 B8 但排最后 | 功能缺失非回归；与 Frame 工具方向一致 |
| Goal 模式、画布第三刀 | 不在本文 | 在途排队项 |
| 3D 导演台其余问题 | 延后到 B14a 清单 | J5 |
| `nomi-add-model` 技能「每轮 ≤3 模型」操作手册 | 不做 | 那是给死锁擦屁股的说明书，failure-path 治根后不需要 |

---

## 6. 待拍板（只留真岔路；能用默认的已写默认，不问）

| # | 岔路 | 默认（不回复即按此）| 为什么是岔路 |
|---|---|---|---|
| D1 | 沙箱不可用的机器上，**全自动档**的 bash 命令：A) 确认 + 会话级记住（收紧一格）B) 直接放行（信任项目目录内可用 git 撤销）| **A** | J3 说可撤销直接执行，但 bash 命令的可撤销性沙箱不可用时无法由机器证明；A 守「只收紧」原则，代价是 #4 的体验在那台机器上只能减到「每类命令问一次」 |
| D2 | 时间轴 #44 的信息架构（两轨 + 拖动预览，其余收纳）| 等 B9 复现清单 + 样张再拍 | 用户可见的结构性改动，R8 |

已按默认处理、不问：深度模型首次下载 = 自动 + 进度 + 可取消（免费且可撤销，按表）；锁定 → 批量重跑默认排除已生成镜头；「项目素材」tab 拖到画布也认；Q5/Q6/Q13 走同伴默认。

---

## 7. 自检（真做过的，不是口号）

| 项 | 结果 | 依据 |
|---|---|---|
| a) 每条拍板有落点且无矛盾 | ✅ | J1/J2 → B3 表「花钱」行三格（问/问/自动）+ 报价卡只在前两档 = B4 的渲染门在全自动列为空；J3 → B3「可撤销本地」行三档全自动；沙箱退化 → 只改「沙箱内命令」一格（B3 ③，D1 默认 A）；深度下载 → 「本地大下载」行（每步问=确认，其余=自动+进度）。三者落在同一张表的不同行，**互不覆盖**。J4→B1；J5→B14a/b；J6→B6a/B6b；J7→B5/B6a/B15；J8→B6a/B7/B4/B11；J9/J10→在途 two-paths + B13；J11→每卡「不许加」行 + B3/B4 数门；J12→§4 分组 ≤6、执行者列、样张列、R16/R30 列 |
| b) 无并行版 / fallback / 静默转进 | ✅ | 每卡「不许加」明列；B1 删 bash 写文稿门、B4 删 `catch→undefined` 与 `return []`、B5 删 9:16 兜底与硬拼清单、B6a 删 `continue` 静默跳参考、B9 删静默 `return`、B10 删每格兜底文案、B13 删 `/Applications` 优先与启动重写、B3 删设置页第二份三档。唯一「新增」的门岗 `check:card-owner` 是响的检测器 |
| c) 「同一语义多份定义」各有单一 owner | ✅ | 画幅 = `effectiveShotAspect`（B5）；模型清单 = 目录按 kind 派生（B5，含创作助手文本下拉 P0-10）；权限档 = 面板三档表（B3，删 `settings.mode`）；允许的供应商/模型 = approvedModelAccess（B5 删设置页那份）；文稿 = 主进程文档 store（B1）；MCP 宿主目录 = `BUILTIN_MCP_CLIENTS` × appInstalled（B15）；launcher = `process.execPath`（B13）|
| d) 每批验收门可机器或走查验证 | ✅ | 每卡有 门岗/单测/走查断言 三选一以上；涉 Agent 的 B1/B2/B3/B4/B11/B12 有 R30 数字；用户可见的 B5/B6a/B7/B8/B9/B14b/B15 有走查截图或实验室基线 |
| e) 与在途分支的文件重叠已标 | ✅ | §3 在途表 + §4.3 矩阵；未推送的 4 条分支（PR-B / param-panel / gates-risk-tier / skill 研究）文件面未知已标 ⚠️ |
| f) file:line 在 origin/main 重核 | ✅ 21 处 ✔️ / ⚠️ 5 处 | ✔️：`projectCanvasReadSurface.ts:405/419/438`、`laneDesktopTools.ts:73/119`、`codingCommandPolicy.ts:366-371/380-382`、`storyboardPlan.ts:551-554`、`StoryboardShotTable.tsx:188`、`useAgentPanelSpendConfirm.ts:82-106`（编排者写 ~144，实为 82-106）、`productionActionIpc.ts:57-64`、`appIntegration.ts:~512`、`spendConfirm.ts:116-134`、`mcpConfig.ts:59/196/224/499-502`、`mcp-l2-journeys.e2e.mjs` 无 restore、`laneSkillIndex.mts:12-22/125-131`、`laneCodingSandbox.mts:110/114/122`、`NodeDepthActionButton.tsx:7`、`depthVideoModelCache.ts:43/162`、`AutomationPermissionsSection.tsx:188-190`、`agentPanelV4.ts:57`、`DirectorEditor.tsx:163` + `HelpDialog.tsx`、`package.json:93`。⚠️：`shotFrameGeometry.ts:19-20`、`storyboardAspectScope.ts:37-39`、`laneApprovalGate.ts:173`、`laneNativeApproval.ts:25-41`、`documentReadTransportAdapters.ts:50-51`（沿用同伴）。**修正一条前提**：`scene3dJourney.ts` 不在 main（`d3f68057c` 删），B14b 从历史取回 |
| g) 无「之后再说」的空批 | ✅ | B11 是「待研究结论」但写明边界、验收门与触发条件；B14a 是产出清单的只读批；无一批内容为空 |

---

## 8. 回滚

每批独立成 PR、独立 revert；依赖被回退时：

| 批 | 回滚方式 | 依赖被回退时 |
|---|---|---|
| B1 | revert；文稿工具回到 surface port | B2 的 nextAction 派生失去「文档 store」状态源 → B2 一起 revert；B6b 的删除按钮要一起 revert（否则 Agent 没法指镜头）|
| B2 | revert 信封字段；说人话层保留 | 无下游 |
| B3 | revert 表；设置页三档随之回来（同 commit 删的）| B12 的状态行仍可独立存在；B4 的队列投影不依赖表 |
| B4 | revert 渲染分支；`return []` 回来 | 无下游；B3 不依赖它 |
| B5 | revert；9:16 兜底回来 | B15 的设置页折叠不依赖 #49/#50 那半 |
| B6a/B6b | 各自 revert | B6b 回退 = 按钮回来，B1 不受影响 |
| B7/B8/B9/B10 | 各自 revert，互不依赖 | — |
| B11 | revert 挂载；索引路径回来 | — |
| B12 | revert 状态字段 | — |
| B13 | revert；启动重写回来（**回退后要提醒用户配置又会被改**）| two-paths 回退 → B13 整体 revert |
| B14b/B15 | revert UI；样张留档 | — |

无数据迁移：唯一新落盘的是 B10 的失败原因随任务行（向后兼容字段）。
