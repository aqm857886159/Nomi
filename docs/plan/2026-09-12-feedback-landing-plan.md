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

**几个反复出现的词**：**信封/回执** = 工具跑完之后返还给模型的那一包东西（成功与否、下一步该干嘛）；**介入槽** = Agent 面板里专门放确认卡、报价卡的那一格；**materialize（落画布）** = 把分镜方案的一行变成画布上的真节点；**派生** = 从真实状态算出来，而不是写死；**棘轮** = 只能往好里走的门岗基线（旧账可以慢慢还，新账一条都不许添）。

---

## 0.5 第 0 波 = 0.22 RC 切线（2026-09-12 用户拍板，优先于 §4 的波次）

**为什么先有这一节**：§3–§4 是「把六根问题修干净」的路线，按根因族排，最长的一批是 L。但用户这周要的是**发一版能用的 0.22**。所以在 B1–B15 之上另切一条线，叫**第 0 波**——它不按根因分，只按一条尺子筛：

> **一周内能进包，且不需要拍样张的，就进 RC；需要出样张等用户看的，一律不进。**
> 唯一的硬性例外：**性能修法必须进**（用户明说画布卡这条严重）。

「不需要拍样张」不是说不许改界面，而是说：改的是**已经拍过板的形态**（补一行状态、改一句文案、恢复迁移前设计），不是**新画一个面**。新面要走「Claude Design 出样张 → 用户点头」，那条链一周走不完。

### 0.5.1 第 0 波装什么

| 类别 | 具体内容 | 状态 |
|---|---|---|
| **今天已经开出来的 PR** | #754（接模型工具面收成 4 个工具）、#757（改参数重出卡）、#759（数门 + `check:door-map`）、#760（工具面单一 owner PR A）、#761（接模型验证 run 失败路径）、#762（本机 gates 按风险分档）| #757 / #761 ✅ 已合；#754 / #759 / #760 / #762 OPEN，走合并列车 |
| **在途、接着做完就进** | `feat/model-onboarding-two-paths-20260911`（P0-1 删 `needs_spend_confirmation` 已在做，**P0-2 自动发现返回空接在它后面**）| 远端只有 4 个 docs 文件，本地未同步 ⚠️ |
| | `fix/storyboard-plan-defaults-passthrough-20260912`（整片默认参数 → 镜头参数单一 resolver）| 未推送；**它同时是 B5 / B6a / B7 / B11 的前置**（见 §3） |
| | `feat/agent-tool-face-20-verbs-20260911`（PR B，20 动词）| 未推送；接在 #760 之后 |
| **第 0 波新建的四条分支** | `fix/sandbox-runtime-packaging-20260912` — 打包缺口：沙箱运行时二进制没进 `asarUnpack`，且运行时用 `import.meta.url` 自己算路径 → **Windows（在发的 `nsis`）/ Linux 与三平台 java agent** 的沙箱起不来；**macOS 不受影响**（见 §0.5.3）| 未建 |
| | `fix/model-availability-single-owner-20260912` — 模型可用性单一 owner（B5 的模型清单那半，能在一周内做完的部分）| 未建 |
| | `fix/rc-small-fix-cluster-20260912` — 小修合集：都是「形态已拍过板、只差一行」的那类 | 未建 |
| | `fix/spend-card-full-auto-and-loud-missing-card-20260912` — **B3 的两条矛盾**（`agentPanelV4.ts:61/:459` 文案 + `laneApprovalGate.ts:173` 降档）+ 卡该出没出时不许静默 | 未建 |
| **性能（硬性例外）** | 画布高频路径的修法，**等 `research/canvas-perf-at-scale-20260912` 出数字之后再动手**——先量 60 / 150 / 300 节点，再定预算，再修。不许先拍一个「≤16ms/帧」当目标（那正是 §9.1 第 5 项判 FAIL 的那条）| 研究未推送，数字未出 |

### 0.5.2 第 0 波**不**装什么（明着列，免得有人顺手塞进来）

**B1**（文稿真相源，L，要等 PR B）、**B3**（确认分级一张表；**只有上面那两条矛盾切出来进 RC**，整张表不进）、**B11**（Skill 回执 + 选择常驻）、**B15**（设置页精简，Q13 要样张）、**B14b**（3D 四步引导，要样张）、**时间轴重建**（H3，本来就在 §5 延后）。

理由是同一条尺子：它们要么是 L、要么要先出样张让用户看。**塞进来的后果不是 RC 晚两天，是 RC 发不出去**。

### 0.5.3 沙箱这件事的几个事实（先对齐，再谈修法）

上一轮对沙箱的判断有偏差，这里把实核到的几条摆出来，B12 与 D1 都按这几条改：

> 🔁 **2026-09-12 二次更正**：本节初版写的「运行时二进制没进 `asarUnpack`，所以 0.22 装机版根本没有沙箱」**按平台是假的**。`fix/sandbox-runtime-packaging-20260912` 的工人在**真打包产物**上实测（Electron 43.4.1 / macOS arm64）：把整个包塞进纯 asar、连解包副本都没有，`SandboxManager.initialize()` 仍然 `active:true`、`wrapWithSandbox` 正常返回——seatbelt 这条路只要系统自带的 `/usr/bin/sandbox-exec`，策略正文走 argv / 临时文件，**一次都不碰 `vendor/`**。出处：`docs/lessons/sandbox-runtime-not-unpacked-from-asar.md`。

1. **09-11 那次会话是在 dev 下跑的，沙箱当时是开着的。** 那些「越界」卡片是**设计如此**（沙箱在守边界，越界就该拦），不是 bug。
2. **用户装的 0.21.0 早于沙箱提交 `ec30e0150`**——所以**装机版里根本没有沙箱这个东西**。「装机版沙箱不工作」不是坏了，是还没有。
3. **mac 的 0.22 装机版是有沙箱的**——打包缺口打不到 seatbelt 这条路（见上面的二次更正）。所以「沙箱不在」不是 mac 用户的默认状态。
4. **打包缺口的真实影响面 = Windows（在发的 `nsis` 目标）、Linux、以及三平台的 java agent。** 机制不是「文件没解包」这么简单：运行时用 `import.meta.url` 定位 vendor 二进制，打包后这条路径指进 `app.asar`，而 Electron 打过补丁的 `existsSync` 对它回 `true`，于是运行时**停在第一个候选上不再往下找**，把归档里的路径 spawn 出去 → `ENOTDIR`。**光加 `asarUnpack` 不解决**（它不改任何人手里已经拿着的那个字符串），修法的另一半是**把解包后的路径显式交给运行时**（`laneSandboxVendorPaths`：`seccomp.applyPath` / `javaAgentJarPath` / `windows.srtWin.path`）。这是 `fix/sandbox-runtime-packaging-20260912` 的内容。
5. 附带一条：**`sandboxInactiveReason` 没有任何 UI 消费者**——主进程算出了「为什么没沙箱」，但这个值在界面上零处被读。这正是 B12「对人可见」那半的实锤。

### 0.5.4 节奏（用户拍板）

```
合并列车（#754 #759 #760 #762 + 在途三条）   1–2 天
        ↓
第 0 波四条分支 + 性能修法                     2–3 天
        ↓
打 mac 包
        ↓
真实任务走查（R16）：① MiniMax H3 做一条 1–2 分钟短片  ② Codex 当宿主接一个模型
        ↓
RC 发给核心用户
        ↓
两天后公开
```

走查那一格是**门不是仪式**：两条真实任务任一条走不通，就不打 RC，回去修（R16 / P3）。

---

## 1. 今天的拍板一览（2026-09-12，有约束力；与同伴文档冲突处以本表为准）

| # | 拍板 | 取代 / 作废的旧结论 |
|---|---|---|
| J1 | **钱的闸没有预算设置，也不加回来**。三档 = 每步问 / 自动改 / 全自动（现役键名 `step / safe-auto / project`，`src/i18n/locales/agentPanelV4.ts:57` ✔️）。⚠️ **同文件 `:61`（zh）与 `:459`（en）的「全自动」说明写的是「付费和不可逆的操作仍然每次问」——那是 J2 的反面，是权限档语义的第三份定义，B3 同 commit 改写** | 作废同伴 Q2「预算内自动」；作废 09-11 P1 ⑨「`project.spend = confirm`」（`docs/plan/2026-09-11-permission-p1-implementation.md` 范围表第 ⑨ 行）|
| J2 | **「全自动」= 花钱也直接生成，不弹报价卡**；报价卡只在「每步问 / 自动改」出现。切到全自动那张二次确认卡（P1 ⑨ 已做）就是全自动档的钱的闸 | — |
| J3 | Q3 维持：**可撤销的本地操作直接执行 + 可撤销**（三档都一样，沙箱状态不影响它）| — |
| J4 | **创作区文稿工具全部改读主进程真相源**；只有「光标处插入 / 替换选区」两个动作保留渲染层依赖（它们本来就需要光标/选区这种只有界面知道的东西）| 作废同伴 B1 方案 ①②（「lane 侧校验 + 一次自动 re-capture」是给坏门打补丁）|
| J5 | 3D 导演台：AI 搭场景维持「粗模只给站位和机位用」，加界面说明 + 下一步引导；**补回 V1 的四步新手引导到 V2**；帮助入口目前藏在视口齿轮里要提出来；其余问题**单独走查一轮列清单**（Q1）| — |
| J6 | Q4：分镜面板「交给 Agent」「锁定」**终局删**，过渡期先修反馈 | — |
| J7 | Q5–Q13 走同伴默认（Q5 定稿后收成一行摘要；Q6 表内点格子即播放；Q13 设置精简包同意→出样张后动工）| — |
| J8 | Q7b = 助手输出 hover 浮出的复制 icon 无反馈；Q8 = ① 镜头卡显示的不是完整提示词 ② 锚定卡生成时没进镜头引用槽 ③「添加参考」浮层设计整体离谱；Q9 = skill 感觉没用上（研究分支 `research/skill-trigger-mechanism-20260912` 已推送，结论：触发机制没坏，坏的是画幅直通（→B5）、加载不可观测、显式技能只管一句话（→B11））；Q11 = 「劈成两半」**根本没出现确认卡**；Q12 = 技能库技能卡左上角空黑胶囊角标 | 同伴 Q7/Q8/Q11/Q12 的「待指认」全部关闭 |
| J9 | P0-1（外部接入会话卡死 `needs_spend_confirmation`）：**删该状态**，正在 `feat/model-onboarding-two-paths-20260911` 做；P0-2（存 key 后自动发现返回空）批准，接在同一分支后面 | — |
| J10 | 接模型：**没有付费验证**；验证 = 免费自检 + 第一次真用；失败不下架，模型上挂原因 | 作废 MCP-P2「并发验证 / 部分晋升」里任何花上游额度的验证步 |
| J11 | 工具设计规则：一个工具 = 一种后果（状态 × 效果类别）；同格合并用 action，跨格必拆；**不留安全阀门**（禁 fallback / 静默转进 / 兜底），保险只能是「响」的检测器；先用脚本把同类全找出来再修（数门，`rule/door-map-root-cause-20260911`）| 作废同伴 A1 方案里的「可恢复错误自动重试一次」（那是静默转进）|
| J12 | 修法顺序：一次扫全再批量修（按根因族分批，只复扫一次）；派工默认 Codex，关键架构 Fable，其余 Opus；并行上限 6；用户可见改动先出样张（Claude Design 画布）再实现；按钮/图标五条规则；R16 真实任务闭环才算完成；Agent/工具改动要 R30 真实模型数字 | — |

---

## 2. 架构层六根（先立规矩，再分批关门）

「根」= 多条症状背后同一个结构性原因。每根：一句人话 / 证据 / 该立的规矩或门岗 / 由哪些批关掉。行号在 origin/main `499f3c943` 重核：✔️ 核过 · ⚠️ 未核（沿用同伴/编排者的号）。本分支随后合入 `a11dccf5b`（+39 commit，含 #757/#758/#761）：`git diff --stat 499f3c943..a11dccf5b` 对本文引用的 18 个文件为空，行号照旧有效。

### 根 1 · 工具看的是「哪个面板开着」，不是「项目数据」
- **人话**：Agent 读文稿，读的不是项目文件，而是「创作区面板此刻的快照通道」（surface port）。面板没打开就没有通道，读必失败。
- **证据**（普查：`grep -n surface_port_unavailable`）：`src/workbench/project/projectCanvasReadSurface.ts` **共 9 处**同型 `state ? 'surface_port_suspended' : 'surface_port_unavailable'`（`:237/309/388/405/419/438/461/480/491`）✔️——不是 3 处，B1 的数门 before 值按 9 算；`electron/agentLane/laneDesktopTools.ts:73` 读文稿的 documentId 取 `context().documentId ?? ''` → 没有活跃文稿就传空串，写入恒 `document_target_stale`（`:119` 同型）✔️。trace：`read_full_text` 前 4 次全失败，用户点开创作区后同一调用成功。对照：`nomi_canvas_read` 读 store 一次成功。文稿有两条路（surface port 工具 / bash 直接写文件）= 第二扇门同病。
- **规矩**：**读写项目数据的工具，真相源只能是主进程的项目数据**，渲染层只提供「光标/选区」这种界面才知道的输入（J4）。数门：`read_script/write_script` 的写门归一。
- **关门批**：B1；B6b（「交给 Agent」删除的前提）。

### 根 2 · 失败没有「可恢复语义」
- **人话**：报错只有一个码 + 一句写死的「下一步」。`surface_port_unavailable` 的 Next 让模型再读那扇坏门 → 10 次撞闸。MCP 验证 `certifying` 死锁同族（MCP-P0）。
- **证据**：错误包装成 decision 返还模型、无状态派生的下一步（`documentReadTransportAdapters.ts:45` 是写死的 `surface_port_unavailable`，`:12-20` 是错误码白名单，`:51` 是 `safeFailure` ✔️——同伴写的 `:50-51` ✖️，已改）；`fix/integration-run-failure-path-20260912` 已在治 MCP 那半（reaper + cancel）。
- **规矩**：返回信封的 `nextAction / unverified[]` **必须从真实状态派生**（面板没开 → nextAction=「请用户打开创作区」+ `unverified:[document]`），禁止静态文案；禁止「自动重试一次」这种静默转进（J11）。
- **关门批**：B2；MCP 那半依赖在途 `fix/integration-run-failure-path-20260912`。

### 根 3 · 确认分级没有单一表
- **人话**：「问不问」由每个调用点自己决定，所以两头都拧：可撤销的问、50MB 下载不问、花钱卡静默排队、沙箱一挂整档自动放行消失。
- **证据**：`electron/shared/agentCapabilities/codingCommandPolicy.ts:366-371` `!sandboxActive` → 整档 `ask` ✔️；`src/workbench/generationCanvas/videoDepth/NodeDepthActionButton.tsx:7` 拍板注释「点了就跑」✔️；`src/workbench/generationCanvas/spend/spendConfirm.ts:120` **已经是 FIFO 队列、不再覆盖 resolve**（B4 那轮治过了）✔️——所以「静默排队」不是 store 的锅，是界面只投影队首（`useAgentPanelSpendConfirm.ts:89` `rows[0]`）；设置页另有一份三档 `guided/balanced/policy-auto`（`src/workbench/settings/AutomationPermissionsSection.tsx:188-190` ✔️）；`laneApprovalGate.ts:173` ✔️（⚠️→✔️，已核）：`resolved?.forceConfirmation && !reusableNativeGrant ? { mode: 'step', spend: 'confirm' } : policy` —— **单个调用点把整档摁成「每步问 + 每次确认花钱」，在全自动档直接推翻 J1/J2**，B3 ⑥ 删它。
- **规矩**：**一张表**：行 = effectClass（效果类别：可撤销本地 / 花钱 / 撤不回 / 只看模式 / 本地大下载 …），列 = 三档，格 = 自动 / 确认 / 禁止。所有调用点只查表。**沙箱退化只能把某一格「自动→确认」，不能改档、不能让整档消失**。J1/J2 直接填表。
- **关门批**：B3；B12（沙箱状态可见）依赖它。

### 根 4 · 同一语义多份定义
- **人话**：画幅有四个来源没先后（skill 封面比例 / 项目画幅 / `plan.aspectRatio` / 模型默认），显示侧兜底 9:16、请求侧不读；模型清单两份；权限档两份。
- **证据**：`src/workbench/generationCanvas/agent/storyboardPlan.ts:551-554` materialize（落画布：把方案的一行变成画布真节点）只抄 `shot.params`，整片画幅从未注入 ✔️；`src/workbench/creation/storyboard/StoryboardShotTable.tsx:188` 图片+视频模型清单硬拼成一份 ✔️；`shotRow/shotFrameGeometry.ts:20` 定义 `FALLBACK_RATIO`、`:40/69/70` 三处使用 ✔️（不是一处）；`storyboardPlanSchema.ts:74-87` **没有 `aspectRatio` 键**，zod 默认丢弃未知键 → 规划师写的整片画幅在解析那一刻就没了 ✔️；第二条落画布路径 `src/workbench/creation/storyboard/exec/storyboardProjection.ts:30,41-43` 同样只看 `shot.params` ✔️；权限两份见根 3。09-05 已拍「画幅项目级 + 行覆盖」。
  ⚠️ **画幅这一支正被在途分支 `fix/storyboard-plan-defaults-passthrough-20260912` 整体重做**（它把 `storyboardAspectScope.ts` 改名成 `storyboardShotScope.ts`，范围是**全部整片默认参数**不止画幅），本文不重做，见 §3 在途表与 B5。
- **规矩**：每个语义写明**单一 owner**（§7c 表），进 `check:vocabularies`；显示侧与请求侧读同一个函数，删兜底常量。
- **关门批**：B5（画幅、模型清单、设置页两块）；B3（权限档）。

### 根 5 · Skill 的触发没坏，坏的是「看不见」和「管不着」
- **人话**：Skill 没有「调用」这个动作，只是系统提示里一行名字+描述，模型自己决定去不去 `read` 正文——**这套做法和官方三家（Anthropic 平台 / Claude Code / pi）一模一样，不是缺陷**。真正的两个洞是：加载了也**看不见**（没有回执，问它「用了吗」谁也说不清），以及技能正文**管不着**生成参数（只能在正文里用中文劝模型去填）。
- **证据**：`electron/agentLane/laneSkillIndex.mts:14-24` 明写「不新造 `load_skill` 工具 · 自动触发就是 description」✔️（✖️ 原写 `:12-22`），`:125-132` 只渲染索引 ✔️；trace 里 `read /Users/aoqimin/Desktop/Nomi/skills/.../SKILL.md`——⚠️ **这条路径在 dev 下是正确行为、不是 bug**（`runtimePaths.ts:57-67` 把 `process.cwd()/skills` 排在安装目录前，dev 的 cwd 就是仓库根）。
- **普查（研究已穷举，不必重查）**：`SkillRecord.body` 全部 4 个消费者 = `electron/skills/skillIpc.ts:81`（投影给界面）✔️ / `electron/harness/context/agentContext.ts:86-107`（零生产调用者的死码）✔️ / `electron/promptLibrary/curatedPrompts.ts:6-13`（只对 effect 类技能）✔️ / lane 与单发的裸拼接 `laneDesktopRuntime.ts:100`、`:172` ✔️。**全仓没有任何一处把 SKILL.md 正文或 frontmatter 读进生成参数**——所以技能今天只能「劝」模型填工具参数，管不住画幅。
- **规矩**（研究结论 `docs/research/2026-09-12-skill-trigger-mechanism/prior-art.md` §3 G1/G2/G4/G5）：触发机制（description 驱动 + `read`）与三家标准一致，**不动**；要补的是 ① 加载回执（模型读了哪条技能，面板与转录留可见记录）② 显式选中的技能跨回合常驻（对齐 Claude Code 语义）③ 用现成带凭据的框 `agentContext.ts:85-107 buildSkillSystemPrompt`（零生产调用者的死码）替换两处裸拼正文——同一语义两份实现只留一份。技能声明结构化默认（G7 ③）延后。
- **关门批**：B11（研究已定稿）。⚠️ **但顺序很重要**：研究的第一结论是「用户感到的『技能没用上』，最直接的原因是整片默认画幅根本没送到生成那一步，跟选没选技能无关」——**那条归在途 `fix/storyboard-plan-defaults-passthrough-20260912`，必须先修**，否则 B11 做完用户仍然觉得技能没用上。

### 根 6 · 沙箱没网，且模型不知道
- **人话**：模型在沙箱里 `curl` 全 000 / exit 56，没人告诉它「这里没网」，它随后编了一张 DeepSeek 能力表。
- **证据**：`electron/agentLane/laneCodingSandbox.mts:110/122` 两种 inactive 原因 ✔️、`:114` 网络白名单 ✔️；`codingCommandPolicy.ts:380-382` 网络命令默认 ask ✔️。⚠️ 与同伴 B2「沙箱未生效」表面矛盾（没生效怎么会被沙箱断网？）——两种可能：沙箱活着但断网 / 沙箱死了但代理不通。**§0.5.3 已给出答案，不必再探**：09-11 那次是 dev 跑的、沙箱开着，卡片是设计如此；装机版则分平台看：用户手上的 **0.21 压根没有沙箱**（早于 `ec30e0150`）；**0.22 的 mac 包有沙箱**（打包缺口打不到 seatbelt），打包缺口影响的是 **Windows / Linux 与三平台 java agent**（§0.5.3 二次更正）。B12 第一步从「探针」改成「接线」：`sandboxInactiveReason` 目前**零 UI 消费者**，那就是「对人可见」那半的实锤。
- **规矩**：沙箱状态（启用与否 / 网络策略 / 原因）必须同时给用户（面板一行）和模型（工具结果里的结构化字段），不许让模型从 exit code 猜。
- **关门批**：B12。

### 附：UI 级的族（门岗材料，不是架构）
A4 反馈缺失 / A5 每帧全量重算 / A6 深底小字 / A7 optional 回调不接线 —— 分别由 B7 / B8 / B7 / B6a 关，各自附一条可机器验的门（§3 各卡「验收门」）。

**今天新增两个族**：
- **「工具回执说有卡，宿主没渲染卡」**（报价卡、「劈成两半」确认卡 Q11）：静默分支在 `src/workbench/ai/v4/useAgentPanelSpendConfirm.ts:82-106`（`catch → setPending(undefined)`、只取 `rows[0]`）✔️、`electron/productionRun/productionActionIpc.ts:57-64`（读通道 `return []`）✔️、`electron/capabilityCore/appIntegration.ts:502`（`installPendingSpendActions`）/ `:509`（装配失败只 `logError`）✔️（编排者写 `~512` ✖️）。→ B4。
- **「隔离实例改写用户全局宿主配置」**：`electron/capabilityCore/mcpConfig.ts:59` 任何实例都写 `~/.codex/config.toml` ✔️、`:194-204` `installedMacLauncher()` 指向 `/Applications/Nomi.app` ✔️ **但 `:225` 打包版走的是 `process.execPath`，`:226-227` 那条偏好只在 dev 生效**——所以「永远指向装机版」是 **dev-only** 的症状（✖️ 修正编排者「打包版也这样」的前提）、`:499-502` 的 `NOMI_E2E` 守卫只挡 `repairStaleMcpConfigs` 不挡安装 ✔️；`tests/ux/mcp-l2-journeys.e2e.mjs` 零处 backup/restore ✔️。→ B13。

---

## 3. 批次表（按根因族分批，不按功能面）

规模：S ≤ 1 天 / M 2–3 天 / L ≥ 1 周。执行者：Codex（默认）/ Opus / Fable（关键架构）。「不许加的阀门」= 这一批里明确禁止出现的写法。

### 在途工作（只依赖，不重做）

| 在途 | 状态（09-12 06:20 实核：`git ls-remote` + `gh pr view`，对 `origin/main` `a11dccf5b`）| 解锁 |
|---|---|---|
| **PR #758 模型框整理（显示/排序/默认/记住手选）** | ✅ **已合**（2026-09-11T21:13:22Z，已在 `origin/main` `63a0636dd`）| **不再是依赖**：B5 的 #49（记住上次选择）**现在就去复核**，若已覆盖则本文不动；B15 同文件冲突已解除 |
| PR #754 接模型工具面收成 4 个工具（`feat/mcp-onboarding-tool-face-20260911`）| OPEN | B13、P0-1 / P0-2 的落点 |
| PR #757 P1.1b 改参数重出卡（`feat/permission-p11b-reprice-writeback-20260911`）| ✅ **已合**（2026-09-11T21:24:21Z）| B3 / B4 / 排队项「报价卡右上角 ×」——**不再是依赖** |
| **PR #762** `tooling/gates-risk-tier-20260912`（本机 gates 按风险分档）| OPEN（分支已推 `4cf3604c`）| #1 / 簇 A；其结论要跟着落：**整合 main 必须放在 gates 锁里面** |
| PR #755 磁吸把手恢复（`fix/canvas-magnetic-handle-restore-20260912`）| OPEN | B8（同目录 `generationCanvas/components/`）|
| **PR #759** `rule/door-map-root-cause-20260911`（数门 + `check:door-map`）| OPEN，已推 22 文件（`scripts/door-map.mjs` **不在 main**）| **所有 recurring 合同**的 `doors` 字段；B1/B3/B4/B5 都要用它 |
| **PR #760** `feat/agent-tool-face-single-owner-20260911`（PR A）| OPEN，已推 111 文件 | B1 的前置 |
| **PR #761** `fix/integration-run-failure-path-20260912` | ✅ **已合**（2026-09-11T21:48:07Z）| B2 的 MCP 半边（**MCP-P0 ① / MCP-P1 ①②③**：reaper / cancel / 逐模型错误原文）已落地，B2 不重做——**不再是依赖** |
| `feat/agent-tool-face-20-verbs-20260911`（PR B，`read_script/write_script`）| **未推送**，worktree `/Users/aoqimin/Desktop/Nomi-tool-face-b` @ `788a0dd67` | B1（在这两个动词之上改真相源，不在旧 20 动词上改）|
| **`fix/storyboard-plan-defaults-passthrough-20260912`** ⚠️ **本文原先漏列** | **未推送**，worktree `/Users/aoqimin/Desktop/Nomi-plan-defaults`，工作区已改 20+ 文件；范围 = **整片默认参数 → 镜头参数的普查 + 单一 resolver，全部参数不止画幅**；已把 `storyboardAspectScope.ts` 改名成 `storyboardShotScope.ts`，并改 `storyboardPlanSchema.ts` / `storyboardProjection.ts` / `StoryboardShotTable.tsx` / `StoryboardBulkBar.tsx` / `StoryboardShotFrame.tsx` / `StoryboardPlanEditor.tsx` / `canvasWrite.ts` / `check-storyboard-owner.mjs` | **B5 ① 整条是它的活，B5 不重做**；B5 / B6a / B7 与它在 `creation/storyboard/` 与 `generationCanvas/agent/` 全面重叠 → **三批都等它合入** |
| **`research/canvas-perf-at-scale-20260912`** ⚠️ **本文原先漏列** | **未推送**，worktree `/Users/aoqimin/Desktop/Nomi-canvas-perf-scale`，在写 `tests/perf/` + 改 `canvas-performance-fixture.mjs`，**数字还没出** | **B8 的验收预算必须来自它**（60 / 150 / 300 节点实测 + 先查别人），B8 不得自定预算 |
| **`research/skill-trigger-mechanism-20260912`** | ✅ **已推送**（`41b91028`）——本文原先写「未推送」✖️。结论见 §2 根 5 | B11 的前置**已满足**，B11 从「待研究」升为可派 |
| `fix/param-panel-flat-options-20260911` | **未推送**，worktree `/Users/aoqimin/Desktop/Nomi-param-panel-flat` @ `a78dda0e0` | B6a 参数行样式；文件面未知 ⚠️ |
| `feat/model-onboarding-two-paths-20260911`（+P0-1 删 `needs_spend_confirmation` +P0-2 自动发现返回空）| 远端 `c6c98d797` 只有 4 个 docs 文件；本地 worktree 与远端**不同步**（本地 `2c976928d`）⚠️ | B13 全部；J9 / J10 的落点。**P0-1 / P0-2 是它的活，本文不重做** |
| `docs/agent-tool-face-research-20260911` | **未推送**，worktree `/Users/aoqimin/Desktop/Nomi-docs-0911` | B1 / B2 的「先查别人」引用（`check:prior-art` 要它）|
| `docs/real-onboarding-acceptance-20260912` | ✅ 已推（`8ca6682b`，19 文件）| B13 缺陷清单来源（P0-1…P2-9、P0-10）|
| **第 0 波四条 RC 分支**：`fix/sandbox-runtime-packaging-20260912` / `fix/model-availability-single-owner-20260912` / `fix/rc-small-fix-cluster-20260912` / `fix/spend-card-full-auto-and-loud-missing-card-20260912` | **四条全都还没建**（`git ls-remote` 逐条空）| 见 **§0.5**——它们走 0.22 RC 切线，不是 B1–B15 的一部分；B3 ⑥⑦ 由其中第四条接走 |
| 排队项：报价卡右上角 ×（#757 后）| 未开工 | 并入 B4 |
| 排队项：画布第三刀（画布工具 → 同一扇门、静默分支可见）| 未开工 | 与 B4 同族不同文件；B4 不碰画布工具 |
| 排队项：Goal 模式 | 未开工 | 不在本文 |

### B1 · 文稿真相源（根 1）
| 项 | 内容 |
|---|---|
| 条目 | #2 #3 B1 B5 |
| 真实摩擦 | 用户说「随便给我写」，Agent 读不到文稿、绕道直接写文件、写又要确认，循环。 |
| **用户会看到** | 创作区**关着**也能让 Agent 改文稿；再也不会出现「它说改了，文稿没变」。 |
| **普查方法** | `grep -n surface_port_unavailable src/workbench/project/projectCanvasReadSurface.ts` → 9 处；`scripts/door-map.mjs`（PR #759）扫「能写文稿的门」→ 记 before/after 进合同 `doors` |
| 根因 owner 层 | 主进程 · 文档 store（`electron/capabilityCore/document*`）|
| 改法（只删/收敛）| ① `read_script / write_script`（PR B 的两个动词）改读写主进程文档 store，删 surface port 依赖；② 仅「光标处插入 / 替换选区」两个 action 保留渲染层输入，面板没开时回 `nextAction=open_creation_panel`（不是错误码裸奔）；③ **删第二扇门**：沙箱路径策略把项目文稿文件设为 bash 不可写（响的拒绝，带 `use write_script` 提示），不靠系统提示词劝。**不许加**：lane 侧「自动 re-capture 重试」、bash 写文稿的兜底路径。 |
| 样张 | 不需要（无 UI 变化）|
| 验收门 | R16：创作区**没打开**时说「把第二段改成 X」→ 文稿真的变了；R30：loopback 夹具 + DeepSeek 小样 ≥20 句，`read_script` 工具写对率、回合成功率写进 PR；trace 断言：`surface_port_unavailable` 在 `read_script/write_script` 路径 = 0；数门：文稿写门 before N → after 1（+2 个光标 action）写进合同 `doors` |
| 依赖 | PR B 合入；`rule/door-map` 合入 |
| 规模 / 执行者 | L / **Fable** |
| 主要文件 | `electron/agentLane/laneDesktopTools.ts`、`laneDocumentTools.ts`、`electron/capabilityCore/documentReadTransportAdapters.ts`、`documentWriteTransportAdapters.ts`、`src/workbench/project/projectCanvasReadSurface.ts`、`src/workbench/NomiStudioApp.tsx`、`electron/agentLane/laneCodingPaths.mts` |
| 依赖（补）| **PR #760 合入** 是 PR B 的前置；PR B 本身未推送，派工前先确认它推了 |

### B2 · 失败回执可恢复（根 2，Agent 面）
| 项 | 内容 |
|---|---|
| 条目 | #2（撞闸 10 次那半）、A1 族 Agent 侧；MCP 半边归在途 failure-path |
| 真实摩擦 | 报错是内部术语，「下一步」是死文案，模型只能反复撞。 |
| **用户会看到** | Agent 撞到问题时说的是人话（「请先打开创作区」），而不是反复重试同一个失败动作把回合烧完。 |
| **普查方法** | `grep -rn "nextAction\|next_action" electron/capabilityCore/` 列出全部返回信封构造点，逐个判「这条 next 是常量还是从状态算的」，常量清零 |
| 根因 owner 层 | 主进程 · 工具返回信封（`electron/capabilityCore/mcpToolErrorResults.ts` / `capabilityExecutorRegistry.ts`）|
| 改法 | 信封加 `nextAction`（枚举，从状态派生）+ `unverified[]`（这次没验到的对象）；删所有静态 Next 文案；错误出模型前必须过说人话层（已有 `mcpToolErrorResults`）。**不许加**：自动重试、把错误吞成空结果。 |
| 样张 | 不需要 |
| 验收门 | 门岗：`check:error-surface`（已有）扩一条「返回信封含 nextAction 且非常量」；R30：同一 20 句在「面板未开」环境下回合成功率 ≥ B1 前 +50%；trace 断言：**同一错误码连续出现 > 1 次即红**（第二次必须带不同的 `nextAction`）——写「≤2 次」会被读成默许一次静默重试，那正是 J11 禁的 |
| 依赖 | B1（先有正确的门再谈回执）；**PR #761** 合入（避免两份 reaper）|
| 条目（补）| **MCP-P0 ①②③、MCP-P1 ①②③ 归 PR #761，本批不重做**；本批只做 Agent 侧信封 |
| 规模 / 执行者 | M / Opus |
| 主要文件 | `electron/capabilityCore/mcpToolErrorResults.ts`、`capabilityExecutorRegistry.ts`、`electron/agentLane/laneDesktopTools.ts`（与 B1 同文件 → 串行）|

### B3 · 确认分级一张表（根 3）
| 项 | 内容 |
|---|---|
| 条目 | #4 #5 #14（档位半）#15（档位半）#33 #45（确认半）#52 #53、**Q3**、J1 J2 J3、A3 族、**G1**（深度提取不问就下 50MB = 改法 ④）|
| 真实摩擦 | 全自动下还一直弹卡；可撤销的问、下载不问；点「仍要生成」像没反应。 |
| **用户会看到** | 切到「全自动」之后**真的不再弹任何卡**（包括付费）；切档时那一张二次确认卡就是唯一的闸。「每步问」档里每个花钱/撤不回的动作恰好一张卡，排第几号看得见。 |
| **普查方法** | `scripts/door-map.mjs`（PR #759）扫全仓 `forceConfirmation` / `decision:` / `spend:` 调用点 → before N / after 1（查表函数）写进 recurring 合同 |
| 根因 owner 层 | 主进程 · 权限策略表（现役 `PERMISSION_POLICIES` 在渲染层 `src/workbench/ai/v4/agentPanelV4Types.ts:303` ✔️，本批搬到主进程成为唯一 owner）|
| 改法 | ① 一张表：effectClass × 三档 → 自动/确认/禁止；**全自动列：花钱=自动（J2）、可撤销本地=自动、撤不回=确认、只看模式=禁止写、本地大下载=自动+进度+可取消**；每步问列全部=确认；自动改列：花钱=确认、其余同全自动。② 删设置页「默认制作模式」三档（#52），`settings.mode` 单一 owner = 面板三档；「支付与风险边界」（#53）里凡是预算数字的项**删**（J1），剩下的收进表的「花钱」行说明 ⚠️ 具体字段待实施时核。③ 沙箱退化：只把「沙箱内命令」那一格 自动→确认，附一行原因 + 会话级「不再问」（同伴 B2 ③），不再降整档为 step。④ 深度模型首次下载（#33）按表 = 自动 + 进度条 + 可取消（每步问档除外），删「点了就跑」的特例注释——它不再是特例，是表的一格。⑤ 卡的排队可见（#15）：按钮徽标「排队 #2」，卡上队列计数。⑥ **删 `laneApprovalGate.ts:173` 的降档**：`forceConfirmation` 只能把表里**那一格** 自动→确认，不能把整档摁成 `{ mode:'step', spend:'confirm' }`（那是在全自动档推翻 J1/J2 的那一行）。⑦ **改写 `src/i18n/locales/agentPanelV4.ts:61`（zh）与 `:459`（en）的「全自动」说明**——现在写的「付费和不可逆的操作仍然每次问」是 J2 的反面，是权限档语义的第三份定义。**不许加**：任何调用点自己判断问不问；「沙箱不可用则全部问」的整档开关；「N 秒后自动确认」；「状态未知时按 X 处理」的默认值。 |
| 样张 | 三档说明文案改动小，不等拍板；卡上的队列计数走设计实验室基线 |
| 验收门 | 数门：`scripts/door-map.mjs` 扫 `forceConfirmation` / `decision:` 的全部调用点 → 合同 doors，after = 1（查表函数）；R30：全自动档 20 句真实任务 → 报价卡 0 张、可撤销命令卡 0 张；每步问档 → 每个花钱/撤不回动作恰 1 张；走查：沙箱不可用机器上全自动档跑 `ls`/写项目文件 → 只出 1 行原因 + 可记住；单测：表的每格有用例 |
| 依赖 | PR #757 **已合**（卡的重出逻辑已在 main），不再是依赖；P0-1 删状态在 two-paths 分支（B3 不碰 `integrationSession`）|
| ⚠️ **⑥⑦ 已切出去做**（§0.5）| 这两条矛盾**不等本批**——它们是 0.22 RC 的切线内容，**正在 `fix/spend-card-full-auto-and-loud-missing-card-20260912` 上修**（连同「卡该出没出时不许静默」）。本批只做剩下的 ①–⑤ 那张表；⑥⑦ 合入后本批**不重做、只复核**。理由：一张写反了的界面说明 + 一行把整档摁回去的降档，是用户这周就会撞到的东西，压在 L 规模的 B3 后面等不起。 |
| 规模 / 执行者 | L / **Fable** |
| 主要文件 | `electron/shared/agentCapabilities/codingCommandPolicy.ts`、`electron/agentLane/laneApprovalGate.ts`、`laneNativeApproval.ts`、`src/workbench/ai/v4/agentPanelV4Types.ts:303-306`（现役 `PERMISSION_POLICIES`，三档 spend 全 `confirm` → 表要搬到主进程、`project.spend` 改自动）、`src/workbench/settings/AutomationPermissionsSection.tsx`、`electron/settings/automationPolicySettings.ts`、`src/workbench/generationCanvas/videoDepth/NodeDepthActionButton.tsx`、`electron/video/depthVideoModelCache.ts`、`src/workbench/generationCanvas/spend/spendConfirm.ts`（与 B4 同文件 → 串行）|

### B4 · 卡说有、宿主必须画（新族）
| 项 | 内容 |
|---|---|
| 条目 | #14 #15（反馈半）#45（Q11「没出现确认卡」）、排队项「报价卡右上角 ×」 |
| 真实摩擦 | Agent 说「请确认」，界面上什么都没有。 |
| **用户会看到** | 只要 Agent 说要确认，介入槽里**一定**出现一张卡；通道没就绪时也明写一行「确认通道未就绪」，不再是一片空白。 |
| **普查方法** | 新门岗 `check:card-owner` 从枚举/`.d.ts` 抽出工具回执可返回的全部 card kind，比对面板渲染注册表；同时 `grep -rn "catch" src/workbench/ai/v4/ electron/productionRun/` 列出吞异常的分支 |
| 根因 owner 层 | 渲染 · 介入槽投影（`useAgentPanelSpendConfirm.ts`）+ 主进程装配（`appIntegration.ts`）|
| 改法 | ① `productionActionIpc.ts:57-64` 读通道不再 `return []`，回 `{state:'not_ready'|'wrong_project'|'ok', rows}`；② `useAgentPanelSpendConfirm.ts:82-106` 删 `catch → undefined`（`:102/104`），not_ready 渲染成介入槽的一行状态（「确认通道未就绪」）；`:89` 的 `rows[0]` 改为队列投影——**注意 store 侧 `spendConfirm.ts:120` 早就是 FIFO 队列了，缺的只是界面投影，别再去改 store**；③ `appIntegration.ts:~512` 装配失败 → 面板可见错误态，不只 log；④ 「劈成两半」这类时间轴确认卡：工具回执里的 `card` 种类必须在渲染注册表里有 owner；⑤ 报价卡 ×（= 丢弃）。**不许加**：任何 `catch {}` 吞成空；第二条渲染分支。 |
| 样张 | × 与状态行走设计实验室基线；不等拍板 |
| 验收门 | 门岗新增 `check:card-owner`：脚本枚举工具回执可返回的 card kind（从 `.d.ts`/枚举抽）vs 面板渲染注册表，缺一即红；走查（真人式操作）：每步问档说「把这段视频劈成两半」→ 1s 内介入槽出卡（`expectPresent`，不是 expectAbsent）；R30 loopback 回合成功率 |
| 依赖 | PR #757 **已合**，不再是依赖 |
| 条目（补）| **C6**（复制 icon 静默吞，与 B7 的 #7 同族：B7 做 UI 反馈，本批做「回执说有、宿主没画」的门）|
| 规模 / 执行者 | M / Opus |
| 主要文件 | `src/workbench/ai/v4/useAgentPanelSpendConfirm.ts`、`AgentPanelV4Panel.tsx`、`electron/productionRun/productionActionIpc.ts`、`electron/capabilityCore/appIntegration.ts`、`electron/agentLane/laneTimelineTools.ts`、`scripts/check-card-owner.mjs` |

### B5 · 模型清单单 owner（根 4；画幅那一半已被在途分支接走）
| 项 | 内容 |
|---|---|
| ⚠️ **范围已缩** | **画幅（#18 #19 #20 #21 #22 #38 比例半、D1–D4、D6、P0-10 的画幅面）整条归在途 `fix/storyboard-plan-defaults-passthrough-20260912`**，它做的是「整片默认参数 → 镜头参数」的普查 + 单一 resolver，**范围是全部参数不止画幅**，并已把 `storyboardAspectScope.ts` 改名 `storyboardShotScope.ts`。本批**不重做、不碰那些文件**，只等它合入后复核。 |
| 条目（剩余）| #49 #50 P0-10（模型清单面）、**I1**（AI 策略页两项）|
| 真实摩擦 | 图片模型能套到视频镜；文本模型接进来了，创作助手却选不到；设置页还有第二份「允许的供应商/模型」。 |
| **用户会看到** | 每个镜头的模型下拉里只剩**这一镜真能用**的模型；接了一家只有文本模型的供应商，创作助手下拉里立刻能选到它；设置页不再有第二处管「允许哪些模型」。 |
| 根因 owner 层 | 主进程 · 模型目录 |
| **普查方法** | `grep -rn "imageModelOptions\|videoModelOptions\|modelOptions" src/` 列出全部拼清单的地方；`check:vocabularies` 词表登记 `model-list` owner（新增一份即红）|
| 改法 | ① 模型清单 owner = 目录按 kind 派生：`StoryboardShotTable.tsx:188` 的 `selectableModelOptions`（把 image+video 两份 Map 合并）删掉，改用与 `src/workbench/generationCanvas/components/CanvasBulkModelSelect.tsx` 同一派生；创作助手文本模型下拉同源（P0-10）。② 设置页 #50 删「允许的供应商/模型」（owner = 接入确认 `approvedModelAccess`）。③ #49「记住上次选择」——**PR #758 已合进 main**，先读 `origin/main` 复核，已覆盖则本项直接销账、不写码。**不许加**：第二份 kind 过滤；显示侧兜底常量。 |
| 样张 | 不需要（画幅控件重排随在途分支走）|
| 验收门 | `check:vocabularies` 加 `model-list` owner（登记 + 复制即红）；单测：图片模型套视频镜被拒；R16：接一个只有文本的供应商 → 创作助手能选到它 |
| 依赖 | **`fix/storyboard-plan-defaults-passthrough` 合入**（否则同目录打架）；#758 已合，不再是依赖 |
| 规模 / 执行者 | **S**（原 M，画幅剥离后）/ Codex |
| 主要文件 | `src/workbench/creation/storyboard/StoryboardShotTable.tsx`、`src/workbench/generationCanvas/components/CanvasBulkModelSelect.tsx`、`src/workbench/ai/v4/agentPanelV4ModelRows.ts`、`src/workbench/settings/AiModelsSection.tsx` |

### B6a · 分镜面板接线 + 反馈（A4 / A7）
| 项 | 内容 |
|---|---|
| 条目 | #9 #10 #11 #12 #13（busy 半）**#16** **#17** #23 #24 #25（过渡修反馈）#26 #27 #28（浮层半）**#29** Q7b Q8①②③ **Q4** **Q5** **Q6** C1–C5 **C9** D5 |
| 真实摩擦 | 8 镜头卡收不起、取消不了、滚不动；「生成中」看不清；对钩点不掉；锚卡没出图镜头就静默无参考；一排能力槽 icon 看不懂；表里是关键帧不是视频、点了不播。 |
| **用户会看到** | 计划卡能收起、能取消、能滚；镜头卡上写的是完整提示词；锚卡没出图时那一镜明写「缺参考」并且**不让它先跑**；能力槽那排 icon 收成一行看得懂的摘要；表格里点一下就播。 |
| **普查方法** | `grep -rn "?:" src/workbench/ai/v4/AgentPanelV4Cards.tsx` 列出全部 optional 回调 → 一次性改 required（编译器报几个就是几个）；`grep -n continue src/workbench/generationCanvas/runner/generationReferenceResolver.ts` 共 8 处，**本批只删 `:172` 的 `if (!sourceUrl) continue`**，其余 7 处（`:167/168/176/186/190/195/199`）是合法分支，逐条在 PR 里写明为什么留 |
| 根因 owner 层 | 渲染 · 面板宿主接线 + 分镜编辑器 |
| 改法 | ① **R28：`onCollapsePlan / onPlanToggle` 从 optional 改 required**（编译器拦，不用 dev warn）；计划卡加取消钮、滚动容器；② #10/Q8① 镜头卡显示完整提示词（信息设计）；③ Q8②/#17 锚卡未出图 → `src/workbench/generationCanvas/runner/generationReferenceResolver.ts:172` 的 `if (!sourceUrl) continue` 删，改为镜头卡显示「缺参考」并阻断生成（响），「跨镜头一致」镜 `image_ref` min=1；④ Q8③「添加参考」浮层整体重做（先样张）；⑤ #24 锁定：删按钮，批量重跑**默认排除已生成镜头**、要包含的显式勾选（规则，不是问）；#25 交给 Agent：过渡=点击展开面板+预填；#23 无场时隐藏；#26 编号=定位、勾=纳入，加 title；#12 丢弃方案同步清画布派生节点，修 `designs[0]` 复活；#13 busy/disabled；Q7b 复制反馈；⑥ **#16/Q5 能力槽 chips 收成一行看得懂的摘要**（J7 默认）；⑦ **#29/Q6 分镜表格子内点击即播放**（J7 默认）。**不许加**：optional 回调 + dev warn；参考缺失时静默跳过。 |
| 样张 | 需要：8 镜头卡布局、镜头卡信息层级、「添加参考」浮层三张（Claude Design）；#13/#23/#26 小改不等 |
| 验收门 | 走查（真人式）：8 镜头卡收起/取消/滚动/勾选各一断言；锚卡失败场景 → 镜头卡出「缺参考」；`check:controls` 扩「有 onClick 的控件必有 busy 或即时终态」（A4 门）；设计实验室基线 |
| 依赖 | **`fix/storyboard-plan-defaults-passthrough` 合入**——它正在改 `StoryboardShotTable.tsx` / `StoryboardBulkBar.tsx` / `StoryboardShotFrame.tsx` / `StoryboardPlanEditor.tsx`，同时派必撞；与 B5 / B7 同目录 → 三批串行 |
| 规模 / 执行者 | L / Opus |
| 主要文件 | `src/workbench/ai/v4/AgentPanelV4Cards.tsx`、`src/workbench/ai/ProjectAgentResidentShell.tsx`、`src/workbench/creation/storyboard/*`、**`src/workbench/generationCanvas/runner/generationReferenceResolver.ts`**（✖️ 原写 `electron/capabilityCore/`）、**`src/workbench/assets/AssetPickerPopover.tsx`**、**`src/workbench/creation/storyboard/shotRow/ShotReferenceSlotPopover.tsx`**（✖️ 原写 `generationCanvas/reference/`）|

### B6b · 删「交给 Agent」（J6 终局）
| 项 | 内容 |
|---|---|
| 条目 | #25 终局、#24 锁定终局 |
| 真实摩擦 | 「交给 Agent」「锁定」两颗按钮，用户不知道点了会发生什么，也不知道不点行不行。 |
| **用户会看到** | 这两颗按钮不见了。选中几个镜头直接对 Agent 说话就行；批量重跑默认跳过已生成的镜头，要包含就自己勾。 |
| **普查方法** | `grep -rn "agentHandoff\|onToggleLock\|toggleLock\|storyboard.lock" src/ electron/ tests/ i18n` —— 按钮、i18n 词条、走查锚点三处一起清（`dead-selector` 教训：找到一处失效锚点就 grep 全部用法）|
| 改法 | B1 合入后，Agent 能直接读分镜 + 「选中即上下文」⚠️（是否已在 main 待核）→ 删按钮、删 i18n、删走查里的旧锚点（`dead-selector` 教训：grep 全部用法）|
| 验收门 | R16：选中 3 个镜头对 Agent 说「把这三镜改成夜景」→ 不点任何按钮就改对；`check:i18n` 死词条基线下降；走查里旧锚点零引用 |
| 依赖 | B1 |
| 规模 / 执行者 | S / Codex |

### B7 · UI 卫生批（A6 深底小字 / A4 反馈 / 角标）
| 项 | 内容 |
|---|---|
| 条目 | #7 #13（文字半）#28（标签半）**#30** #31 #40 #46 #47 #48 Q12 #57 **A6** E2 E4 I4、**C7**（前半 #30 画布图片透明边 / 后半 #31 「已保存到项目」常驻）|
| 真实摩擦 | 灰字看不清、「已保存到项目」常驻废话、角标截断、封面坏图、复制没反馈、技能列表一行一个、画布图片上下留一圈透明边。 |
| **用户会看到** | 小字读得清；「已保存」闪一下就走；角标不再被截断；封面坏了明写「封面失效」并给一颗「重新抽帧」；复制按一下就打勾；技能列表两列铺开；画布上的图片贴合真实比例、没有黑边。 |
| **普查方法** | `check:feel` 的对比度断言库全量扫一遍（不是只扫这几处），把所有低于阈值的信息文字列出来一次改完；`grep -rn "ink-40\|opacity-40" src/workbench/` 数出全部 40% 灰用于信息文字的位置 |
| 改法 | 对比度提级（token 门内）；「已保存」降一次性；角标短文案 + tooltip，弹框 Portal；封面失效 → **可见的「封面失效」占位态 + 一颗「重新抽帧」按钮**（状态 + 用户发起的动作；**不自动替换成抽帧图**——那就是静默兜底，J11 禁）；#30 画布图片盒按真实比例算、删 `object-contain` 留白；复制成功打勾（复用 `MobileConnectDialog` copied 态）；技能列表两列网格；Q12 空黑胶囊：定位组件后删空角标。**不许加**：第二套 copied 态；40% 灰用于信息文字。 |
| 样张 | 小 UI 不等拍板（教训「样张拍板只卡大 UI」）；技能列表网格出一张 |
| 验收门 | `check:feel` 对比度断言（叠/裁/拦/出视口/对比度库）覆盖这几处；走查截图人眼；设计实验室基线 |
| 依赖 | **storyboard 那两个文件等 `fix/storyboard-plan-defaults-passthrough` 与 B6a**（它俩都在改 `StoryboardShotFrame.tsx`）；其余文件无依赖，可先做 |
| 规模 / 执行者 | M / Codex |
| 主要文件 | `src/workbench/creation/storyboard/shotRow/StoryboardShotFrame.tsx`、`src/workbench/generationCanvas/nodes/ProvenancePanel.tsx`、**`src/workbench/generationCanvas/nodes/artifact/artifactNodeSlots.tsx`**、`src/workbench/assets/AssetVideoCover.tsx`、`src/workbench/library/ProjectLibraryPage.tsx`、**`src/workbench/creation/storyboard/anchorZone/StoryboardAnchorRow.tsx`**（✖️ 原写在 `storyboard/` 一级）、技能库卡片组件 |

### B8 · 高频路径每帧全量重算（A5）⬆️ **提级：用户明说这条严重，且上一轮画布性能战役从没量过「多选编组拖动」**
| 项 | 内容 |
|---|---|
| 条目 | #6 #32 #36 #37 **A5** B4 C8 H1 H2 |
| 真实摩擦 | 过程文字卡顿；60 张图拖动极卡；缩放条拖动卡。**上一轮战役只量了单节点拖动，多选编组拖动一次都没量过**——这正是用户最常做、也最卡的那个动作。 |
| **用户会看到** | 选中几十张图一起拖，图跟着手走不再一顿一顿；Agent 打字时面板不掉帧；缩放条拖起来跟手。 |
| **普查方法** | `research/canvas-perf-at-scale-20260912` 的量法（60 / 150 / 300 节点 × 单选拖 / 多选编组拖 / 框选 / 缩放），**先量再改**，改完用同一套量法复量 |
| 改法 | 流式 delta rAF 合帧 + `V4FlowRow` memo + 稳定 key + 尾消息增量 markdown；多选拖动容器级 transform、松手写回；缩放条拖动无动画 `setViewport` + 自绘 thumb；GroupFrame 补 resize 把手（#37，功能缺失）。**不许加**：第二条渲染路径（如「大列表模式」开关）。 |
| 样张 | 缩放条 thumb / 拉环走设计实验室 |
| 验收门 | 性能数字（darwin 校准、平台感知预算）：**预算由 `research/canvas-perf-at-scale-20260912` 实测后给出，本批不得自己定数字**（「≤16ms/帧」这类拍脑袋常量按 09-10 拍板属症状修法）；流式 1000 token 渲染次数 ≤ 60；R23：迁移前行为对照（磁吸/框选不回退）；走查截图 |
| 依赖 | PR #755 磁吸把手合入（同目录 `generationCanvas/components/`）；**`research/canvas-perf-at-scale-20260912` 出数字**（没有数字不许开工，否则验收门是空的）|
| 规模 / 执行者 | M / Opus |
| 主要文件 | **`src/workbench/ai/v4/useAgentPanelV4Data.ts`**（✖️ 原写 `.tsx`）、`src/workbench/ai/v4/AgentPanelV4Panel.tsx`、**`src/workbench/common/NomiMarkdown.tsx`**、**`src/workbench/generationCanvas/components/{useCanvasSelectionDrag,CanvasNavigationStack,GroupFrame}.tsx`**（✖️ 原写 `reactFlow/`，三个文件都在 `components/`）、`src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx` |

### B9 · 拖放静默过滤 + 时间轴 + 深度任务可见（A1 用户面 / A4）
| 项 | 内容 |
|---|---|
| 条目 | #34 #35 #39 #42 #43 #44 E1 F1 F2 F3 G2 G3 G4、**H3**（两轨 + 拖动预览的诉求，本批只记账、重构随 #44 延后）|
| 真实摩擦 | 素材拖不进画布/预览页，零提示；时间轴收不回；深度下载卡住、画面变黑。 |
| **用户会看到** | 拖素材进去要么成功、要么明写「这份素材属于其他项目」；时间轴能收起来并且下次打开还记得；深度提取有进度条、卡住 30 秒会自己报错并且能取消。 |
| **普查方法** | `grep -nE '^\s+return\s*$' src/workbench/generationCanvas/components/canvasStageDrop.ts` → **5 处裸 return**（`:212 :215 :253 :287 :366`）+ `:300` 的 `if (!allowedItems.length) return`；逐个判「这一条静默合不合理」。⚠️ **注意 `:297/:340` 已经在提示「部分被跳过」了**，所以「零提示」只对「全部被拒」那一条成立，别把已经有提示的那两条也改了 |
| 改法 | `src/workbench/generationCanvas/components/canvasStageDrop.ts:300` 的 `if (!allowedItems.length) return` 删，改为响的提示（「素材属于其他项目」）；「项目素材」tab 要么画布也认、要么视觉禁用拖拽（二选一，默认：画布也认）；预览页 drop 区纳入；时间轴容器**合成一个带 collapse 的组件**（P1 加新删旧，两页共用）；#44 先真机复现列清单，重构走样张；深度：进度条 + 停滞检测（30s 无字节即报错可重试）+ 可取消 + 节点「下载中/推理中」状态；#35 复现后修。**不许加**：静默 return；第二个时间轴容器。 |
| 样张 | 时间轴「两轨 + 拖动预览」重构必出样张（拍板点见 §6）；其余不等 |
| 验收门 | 走查：拖素材到画布/预览页各一断言（成功 + 跨项目提示）；深度下载模拟停滞 → 30s 内出错提示；预览页时间轴收起持久化 |
| 依赖 | 无 |
| 规模 / 执行者 | M / Codex |
| 主要文件 | **`src/workbench/generationCanvas/components/canvasStageDrop.ts`**（✖️ 原写 `reactFlow/`）、`src/workbench/assets/*`、`src/workbench/preview/PreviewWorkspace.tsx`、`src/workbench/generation/GenerationWorkspace.tsx`、时间轴 panel 组件、`electron/video/{depthVideoModelCache,depthVideoJob}.ts` |

### B10 · 拆解失败可见 + 失败持久化 + 一键反馈（A1 用户面 / J）
| 项 | 内容 |
|---|---|
| 条目 | #41 #56 E3 J、**Q10**（拆解全失败时导出一次诊断包）|
| 真实摩擦 | 拆解全失败满屏「没读出」、秒数 0.0333；失败了没法一键把日志发过来。 |
| **用户会看到** | 拆解失败时顶部一条说清为什么失败（不是每格一句「没读出」）；旁边一颗「反馈」按钮，点一下摘要和诊断包都填好了；重开项目还看得到那条失败原因。 |
| **普查方法** | `grep -rn "没读出\|readFail\|extractFail" src/ electron/ i18n/` 列出全部每格兜底文案，一次清空；`grep -rn "0\.0333\|1/30\|frameStep" electron/video/` 找出秒数从哪来 |
| 改法 | 秒数格式化 + 伪切点合并——**合并阈值必须从抽帧步长/帧率派生**（`electron/video/shotTimeline.ts` 里那条），**不许写死一个「最小镜头时长」常量**（09-10 拍板：改常量 + 假跑证明 = 症状修法）；全失败 → 顶部一条失败原因（从主进程结构化日志来），删每格「没读出」兜底文案；生成失败原因随任务行落盘；任务中心失败行 + Agent 报错处「一键反馈」= 预填摘要 + 诊断包引用。**不许加**：每格 fallback 文案。 |
| 样张 | 一键反馈按钮位置走按钮五条规则，小改不等 |
| 验收门 | 单测：合并阈值随帧率变化（12fps / 30fps 两组，阈值必须跟着变——写死常量这条会红）；走查：注入抽帧失败 → 顶部原因 + 反馈按钮预填 + 诊断包引用（Q10）；重开项目仍见失败原因 |
| 依赖 | 无 |
| 规模 / 执行者 | M / Codex |
| 主要文件 | `electron/video/deconstructVideo.ts`、**`src/workbench/generationCanvas/nodes/shotTable/ShotTableGrid.tsx`**（✖️ 原写 `src/workbench/shotTable/`）、`electron/video/shotTimeline.ts`、**`src/workbench/taskCenter/TaskCenterPanel.tsx`**（✖️ 原写 `src/workbench/tasks/`）、**`src/ui/community/feedbackDiagnostics.ts`**、**`electron/diagnostics/diagnosticsBundle.ts`** |

### B11 · Skill：加载回执 + 选择常驻（根 5；研究已定稿）
| 项 | 内容 |
|---|---|
| 条目 | #8 #38（提示词半）Q9 B3 P2-8 P2-9 |
| 真实摩擦 | 用户选了技能，产出跟技能里写的对不上；问「你用技能了吗」，模型说用了，界面既不能证实也不能证伪。 |
| **用户会看到** | 技能被加载时对话里留下一条看得见的记录（哪个技能、哪个文件）；选中的技能整轮对话都在，不是发一句就掉，而且有地方摘掉它。 |
| ⚠️ **排序（研究给的，必须照此）** | **① 画幅直通先修 —— 归在途 `fix/storyboard-plan-defaults-passthrough-20260912`，不归本批。** 研究的第一结论是：用户感到的「技能没用上」，最直接的原因是整片默认画幅根本没送到生成那一步，**跟选没选技能无关**。这条不先修，本批做完用户照样觉得技能没用上。② 本批主体 = 回执 + 常驻（G1/G2/G5）。③ 技能声明结构化默认（G7 ③）已在 §5 延后。 |
| **普查方法** | 研究已穷举 `SkillRecord.body` 的 4 个消费者（`skillIpc.ts:81` / `agentContext.ts:86-107` / `curatedPrompts.ts:6-13` / 裸拼接 `laneDesktopRuntime.ts:100`、`:172`）——照这张表收敛，不重查 |
| 改法（研究已收）| 触发机制不动（G3）；① 加载回执：模型 `read` 到技能正文 → 转录与面板出「已加载 <skill>」记录（G1）；② 显式选中跨回合常驻，用户可摘（G2）；③ 显式挂载改用 `agentContext.ts:85-107 buildSkillSystemPrompt` 带凭据的框，**删** `laneDesktopRuntime.ts:100/:172` 与 `useAgentPanelV4Actions.ts:173` 两处裸拼（G5，同一语义只留一份）；④ G9 `runtimePaths.ts:60` 打包版技能根不再优先 `process.cwd()/skills`（安全小修，可单独 PR）。⑤ **删恒假的死分支**：`laneSkillIndex.mts:86-93` 的解锁条件读的是**顶层** frontmatter 键 `tools:`，但 88 个内置技能一律写在 `metadata.nomi.tools` 里、且没有一个带 `scripts/` —— 这条分支今天恒假；更要紧的是顶层 `tools:` **违反规范闭集**（`docs/engineering/standard-formats.json:95` 我们自己的裁决：官方参考校验器多一个顶层键就报 error）→ 删，改读 `metadata.nomi.tools`。**不许加**：第三条注入路径；G7 ③「技能声明结构化默认」延后。 |
| 验收门 | R30：20 句显式挂技能 → 回执率 100%、回合成功率写进 PR；走查：第 3 轮仍能看到技能常驻 chip；源码棘轮：`buildSkillSystemPrompt` 生产调用者 ≥1、裸拼 = 0 |
| 依赖 | **`fix/storyboard-plan-defaults-passthrough` 先合**（否则做完用户仍觉得没用上）；B1（工具面稳定后再动挂载）|
| 规模 / 执行者 | **M**（原 L；研究定稿后范围收窄）/ **Fable** |
| 主要文件 | `electron/agentLane/{laneSkillIndex,laneDesktopRuntime}.mts`、**`electron/harness/context/agentContext.ts`**（那个带凭据的框住在这里）、`lanePromptSections.ts`、`src/workbench/ai/v4/useAgentPanelV4Actions.ts`、`electron/runtimePaths.ts`（G9）、`electron/skills/*` |

### B12 · 沙箱状态对人对模型都可见（根 6）
| 项 | 内容 |
|---|---|
| 条目 | #4（原因半）B2 ①④、根 6 |
| 真实摩擦 | 模型在沙箱里 `curl` 全失败（exit 56），没人告诉它「这里没网」，于是它自己编了一张模型能力表当真话讲。 |
| ⚠️ **前提已更正（§0.5.3）** | ① 09-11 那次会话在 **dev** 下跑、沙箱**是开着的**，卡片显示「越界」是**设计如此**不是 bug；② 用户装的 **0.21.0 早于沙箱提交 `ec30e0150`**，装机版里**根本没有沙箱**；③ 打包缺口（2026-09-12 二次更正）= **Windows / Linux 与三平台 java agent** 的运行时二进制既没进 `asarUnpack`、拿到的路径也仍指进 `app.asar`（**mac 不受影响**，seatbelt 只要 `/usr/bin/sandbox-exec`），归第 0 波的 `fix/sandbox-runtime-packaging-20260912`，**本批不重做**；④ `sandboxInactiveReason` **零 UI 消费者**——主进程已经算出「为什么没沙箱」，界面一处都没读，这就是本批「对人可见」那半的实锤。 |
| **用户会看到** | 面板上一行明写沙箱开没开、能不能联网、为什么；模型也不再拿编的内容当结论。 |
| **普查方法** | `grep -rn sandboxInactiveReason src/ electron/` → **写入侧有、读取侧零**（先证明这条缺口，再补）；`grep -n inactive electron/agentLane/laneCodingSandbox.mts` → `:110`（平台不支持）`:122`（初始化失败）两种原因、`:131-134` 的 `inactive()` 构造器——两条原因都要能到界面和模型；`grep -rn "exit 56\|exitCode" electron/agentLane/laneCodingTools.mts` 找出全部让模型从 exit code 猜的地方 |
| 改法 | 第一步探针（S）：在用户机器上跑 `openLaneSandbox`，定一「inactive 原因」vs「活着但断网」；第二步：工具结果结构化字段 `sandbox:{active, network, reason}`，面板一行状态；网络被拒时命令结果明写「沙箱无网」而不是 exit 56。**不许加**：沙箱失败时自动改走无沙箱路径。 |
| 验收门 | 走查：断网沙箱里跑 `curl` → 模型收到 `network_denied`，不再编能力表（R30 小样 5 句）；面板状态行截图 |
| 依赖 | B3（同文件 `codingCommandPolicy.ts` / `laneCodingSandbox.mts`）；**`fix/sandbox-runtime-packaging-20260912`**（mac 装机版上这批可以直接验；**Windows / Linux 装机版**在打包缺口修好前没有可显示的「沙箱开着」状态可验）|
| 规模 / 执行者 | S+M / Opus |
| 主要文件 | `electron/agentLane/{laneCodingSandbox,laneCodingTools}.mts`、`codingCommandPolicy.ts` |

### B13 · 接模型：两条路之后的余项（J9 J10 + 新族「隔离实例改写宿主配置」）
| 项 | 内容 |
|---|---|
| 条目 | P1-3 P1-4 P1-5 P1-6 P1-7 P0-10（与 B5 共 owner）、MCP-P3 ①、**MCP-P3 ②**（两条 lessons 落盘：宿主白名单单一真相源、失败路径不许兜底）、`mcpConfig.ts` 越权写。**P0-1 / P0-2 归在途 two-paths 分支，本批不重做** |
| 真实摩擦 | 接完设置页不刷新；进度卡从没出现；选了 Codex 落到 Claude 面板；**开发模式下**配置指向装机版 Nomi 且每次启动被改回去；`codex exec` 一步走不了。 |
| **用户会看到** | 接完模型设置页立刻出现它；接的过程有进度卡；选哪个助手就落到哪个助手；**Nomi 不再在启动时偷改你的 `~/.codex/config.toml`**，只有你点「一键接入」才写。 |
| **普查方法** | `grep -n "configPath\|installMcp\|repairStaleMcpConfigs" electron/capabilityCore/mcpConfig.ts` 列出全部写用户配置的入口（`:499` repair、`:633` install），逐个确认「只在用户点了才写」；e2e 前后 `diff ~/.codex/config.toml` |
| 改法 | P1-3 completed 事件主动推目录刷新；P1-4 进度卡接线（文案已在 `onboardingProviders.ts:552` 起）；P1-5 `onOpenAssistantConnections` 带宿主；**P1-6 ⚠️ 修正前提**：`mcpConfig.ts:225` 打包版本来就走 `process.execPath`，`:226-227` 的 `installedMacLauncher()` 偏好**只在 dev 生效**——所以要删的是 `:226-227` 那两行（dev 也用 `process.execPath` + `app.getAppPath()`，即现有的 `:228`），**不能把整个 `launcherEntry()` 改成「只从 `process.execPath` 派生」**，那样 dev 的 MCP 会直接起不来（少了 `app.getAppPath()` 参数）；**另删启动时重写客户端配置，只在用户点「一键接入」时写**；P1-7 删 `default_tools_approval_mode="writes"`（审批由 Nomi 自己的三档表管，不双份）；e2e 加 backup/restore 断言（改了用户 `~/.codex/config.toml` 即红）。**不许加**：第二个 launcher 解析策略。 |
| 样张 | 进度卡已有设计稿，不再出 |
| 验收门 | 真实验收复跑（同 README 的 harness，Codex + DeepSeek 官方）：回合成功 ≥ 2/3，人工干预 ≤ 2 次（贴 key + 点保存）。⚠️ **这不违反 J10**：J10 禁的是**产品内**拿用户额度做接入验证；研发侧验收花的是我们自己的额度，按 P0「评测/测试/验证类花费默认授权」；`check:mcp-*` 现有门；e2e 前后 diff 用户配置 = 0 |
| 依赖 | PR #754 + `feat/model-onboarding-two-paths` 合入 |
| 规模 / 执行者 | M / Opus |
| 主要文件 | `electron/capabilityCore/mcpConfig.ts`、`electron/capabilityCore/modelOnboarding/*`、`src/ui/onboarding/AiAssistedOnboardingCard.tsx`、**`src/ui/onboarding/ModelSettingsWorkspacePages.tsx`**（✖️ 原写 `src/workbench/settings/ModelSettings*`）、**`src/i18n/locales/onboardingProviders.ts:552`**（进度卡文案在这里，是 i18n 文件不是 `modelOnboarding/` 下的）、`tests/ux/mcp-l2-journeys.e2e.mjs` |

### B14a · 3D 导演台走查清单（J5，R13）
| 项 | 内容 |
|---|---|
| 条目 | #58 Q1 |
| 真实摩擦 | 3D 导演台问题多但没人系统走过一遍，只有零散抱怨。 |
| **用户会看到** | 本批用户看不到变化（只读走查，产出一张清单给他勾）。 |
| 改法 | 只出清单不修：按 J1–J5 真实任务（摆场景→摆角色→摆相机→运镜→出参考）走一遍，每步截图 + 情绪摩擦日志；产出 `docs/audit/2026-09-12-director-walkthrough.md` 给用户勾。 |
| 依赖 | 无 · S / Opus · 只读 |

### B14b · 3D 导演台四步引导 + AI 搭场景说明（J5）
| 项 | 内容 |
|---|---|
| 条目 | #58 Q1 J5（B14a 清单里归到这一批的那些）——**原卡缺「条目」行，已补** |
| 真实摩擦 | 第一次进导演台不知道从哪下手；AI 搭出来的场景是粗模，用户以为它坏了；帮助入口藏在齿轮里。 |
| **用户会看到** | 第一次进导演台有四步引导带着走；AI 搭完场景明写「粗模只用于站位与机位」并给下一步按钮；视口右上角一个 `?` 一点就到帮助。 |
| **普查方法** | `git show d3f68057c^:src/i18n/locales/scene3dJourney.ts` 取回 V1 全部四步文案，逐条判「V2 界面还对不对」，不重写 |
| 改法 | ⚠️ 修正编排者前提：`src/i18n/locales/scene3dJourney.ts` **不在 main**（`d3f68057c` 随 V1 一起删了），文案从 `git show d3f68057c^:src/i18n/locales/scene3dJourney.ts` 取回、按 V2 界面改写；引导挂在 `DirectorEditor.tsx` 首次进入；AI 搭场景结果卡加一行「粗模只用于站位与机位」+ 下一步按钮（去摆相机 / 出参考）；帮助入口从 `SettingsDialog`/视口齿轮提到视口右上 `?`（公认图形，§1.5 L2）。**不许加**：第二套引导框架。 |
| 样张 | 需要（四步引导 + 说明卡，Claude Design）|
| 验收门 | 走查：首次进导演台出第 1 步；AI 搭场景后出说明与下一步；帮助入口 1 次点击可达 |
| 依赖 | B14a 清单（合并同批修）· M / Opus |
| 主要文件 | `src/workbench/generationCanvas/nodes/director/{DirectorEditor.tsx,panels/dialogs/*,agent/*}`、`src/i18n/locales/director*.ts` |

### B15 · 设置页精简（Q13 默认同意）
| 项 | 内容 |
|---|---|
| 条目 | #51 #54 #55 **Q13** I2 I3（#49 #50 + **I1** → B5；#52 #53 → B3）|
| 真实摩擦 | 设置页太长太满，一屏塞不下，用不到的东西一直占地方。 |
| **用户会看到** | 设置页短一半：就绪模型收成一行、诊断收进「更多操作」、没装的助手不再列出来。 |
| **普查方法** | `grep -n BUILTIN_MCP_CLIENTS electron/capabilityCore/{mcpConfig,mcpDetectedClients,security}.ts` → 三处消费，确认显示侧只从 `appInstalled` 派生 |
| 改法 | 就绪模型折叠一行 + 开关，诊断进「更多操作」；未检测到的 MCP 宿主灰置/折叠（`BUILTIN_MCP_CLIENTS` 按 `appInstalled` 派生显示）；「可信发起方」移入 MCP 子页。**不许加**：第二份宿主目录。 |
| 样张 | 必出（Claude Design，三页）|
| 验收门 | 设计实验室基线；走查：未装 cursor 的机器上不显示「可接入 cursor」 |
| 依赖 | 样张拍板；B3、B5 合入（同文件）· M / Codex。**#758 已合，不再是依赖** |
| 主要文件 | **`src/ui/onboarding/{ModelSettingsWorkspacePages,ConnectAssistantCard}.tsx`**（✖️ 原写 `src/workbench/settings/`，那两个文件不在那里）、`src/workbench/settings/AutomationPermissionsSection.tsx` |

---

## 4. 顺序、依赖图、并行分组、文件重叠

### 4.1 依赖 DAG（文字版）
```
在途 PR #760(A) ─► PR B(未推) ─► B1 ─► B2      （#761 已合，B2 的 MCP 半边已落地）
                                  └─► B6b
       B3 ─► B12                      （#757 已合，B3/B4 不再等它）
       B4
       plan-defaults(未推) ─► B5 ─► B15 ◄─ B3
       plan-defaults(未推) ─► B6a ─► B7(storyboard 那两个文件)
       plan-defaults(未推) ─► B11 ◄─ B1   （技能收据要在画幅修好之后才让用户有感）
       PR #754 + two-paths ─► B13   （P0-10 与 B5 共 owner：B5 先）
       PR #755 + canvas-perf-at-scale(未推，要数字) ─► B8
       PR #759 door-map ─► B1/B3/B4/B5 的合同 doors
无依赖: B7(非 storyboard 部分), B9, B10, B14a ─► B14b
```
⚠️ **三条未推送的在途分支是本方案最大的单点**：`plan-defaults`（挡住 B5/B6a/B7/B11）、`PR B`（挡住 B1→B2→B6b）、`canvas-perf-at-scale`（挡住 B8 的验收门）。它们不推，W1 之后基本派不出去。

### 4.2 并行分组（≤6 路，按「可派时刻」）

> ⚠️ **本表是「把六根修干净」的路线；发 0.22 RC 以 §0.5「第 0 波」为准**（那一节明写优先于本表）。两者不冲突：§0.5 按「一周内能进包且不需要样张」筛，本表按根因族排，§0.5 挑走的那几条做完后回到本表继续。
| 波 | 同时派（≤6）| 触发条件 |
|---|---|---|
| W0 现在 | B9（Codex）· B10（Codex）· B7-A（Codex，**只做非 storyboard 的那部分**）· B14a（Opus）· B12 探针（Opus，只读）· B5-复核（Codex，**只读**：#49 是否已被 #758 覆盖）| 无。⚠️ **B6a 从 W0 移出**——它与未推送的 `plan-defaults` 文件全面重叠 |
| W1 | B3（Fable）· B4（Opus）· B13（Opus）· B14b（Opus）· B6a（Opus）· B8（Opus）| #757 **已合** → B3/B4 可即派；#754 + two-paths 合入（B13）；**`plan-defaults` 合入**（B6a）；**#755 合入 + canvas-perf 数字出来**（B8）|
| W2 | B1（Fable）· B12 修（Opus）· B5（Codex）· B7-B（Codex，storyboard 两文件）| PR B 推送并合入（B1）；B3 完成（B12）；`plan-defaults` + B6a 完成（B5 / B7-B）；样张拍板 |
| W3 | B2（Opus）· B6b（Codex）· B11（Fable）· B15（Codex）| B1 合入（#761 **已合**）；`plan-defaults` 合入（B11 的前提）；B3 + B5 合入（B15）|

### 4.3 文件重叠矩阵（同一行打 ● 的批不能同时派）
> ⚠️ 上一版这张表的目录名有多处错（把 `generationCanvas/components/` 写成 `reactFlow/`、把 `src/ui/onboarding/` 写成 `src/workbench/settings/`），结论因此建立在错前提上。下表按 `origin/main` `63a0636dd` 的真实路径重画，并加了在途 `plan-defaults` 一列。

| 目录 / 文件 | plan-defaults(在途) | B1 | B2 | B3 | B4 | B5 | B6a | B7 | B8 | B9 | B10 | B12 | B13 | B15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `electron/agentLane/laneDesktopTools.ts` | | ● | ● | | | | | | | | | | | |
| `electron/agentLane/{codingCommandPolicy,laneCodingSandbox}` | | | | ● | | | | | | | | ● | | |
| `electron/agentLane/laneApprovalGate.ts` | | | | ● | | | | | | | | | | |
| `electron/capabilityCore/appIntegration.ts` | | | | | ● | | | | | | | | | |
| `src/workbench/generationCanvas/spend/spendConfirm.ts` | | | | ● | ● | | | | | | | | | |
| `src/workbench/creation/storyboard/**` | ● | | | | | ● | ● | ● | | | | | | |
| `src/workbench/generationCanvas/agent/storyboard*` | ● | | | | | ● | | | | | | | | |
| `src/workbench/ai/v4/*` | | | | ● | ● | ● | ● | | ● | | | | | |
| `src/workbench/settings/*` | | | | ● | | ● | | | | | | | | ● |
| `src/ui/onboarding/*` | | | | | | | | | | | | | ● | ● |
| **`src/workbench/generationCanvas/components/*`** | | | | | | | | | ● | ● | | | | |
| `src/workbench/generationCanvas/nodes/*` | | | | | | | | ● | | | ● | | | |
| `electron/capabilityCore/mcpConfig.ts` / `modelOnboarding/*` | | | | | | | | | | | | | ● | |
| `electron/video/*` | | | | ● | | | | | | ● | ● | | | |

处置：
- **`plan-defaults` 合入之前，B5 / B6a / B7-B / B11 一个都不能派**（它正在改 `StoryboardShotTable` / `StoryboardBulkBar` / `StoryboardShotFrame` / `StoryboardPlanEditor` / `storyboardPlanSchema` / `storyboardProjection`，并把 `storyboardAspectScope.ts` 改名）。
- B3 ↔ B4 串行（B3 先，卡语义定了再改渲染，同碰 `spendConfirm.ts`）。
- B6a ↔ B5 ↔ B7-B 三批同碰 `creation/storyboard/**` → **串行 B6a → B5 → B7-B**；上一版写「B7 与 B6a 同执行者顺序做」却又把两批放进同一波 W0，自相矛盾，已修（B7 拆成 A/B 两段）。
- **B8 ↔ B9 都碰 `generationCanvas/components/`**（B8：`GroupFrame` / `useCanvasSelectionDrag` / `CanvasNavigationStack`；B9：`canvasStageDrop`）→ 文件不同，可并行，但同波必须约定谁都不碰对方那几个文件；**上一版说它们"都碰 reactFlow"是错的**（那四个文件没有一个在 `reactFlow/`）。
- B7 ↔ B10 都碰 `generationCanvas/nodes/`（B7：`ProvenancePanel` / `artifact/artifactNodeSlots`；B10：`shotTable/ShotTableGrid`）→ 文件不同，可并行。
- B3 ↔ B9 ↔ B10 都碰 `electron/video/` → `depthVideoModelCache.ts` 是 B3（确认入口）与 B9（进度/取消）共用 → **B9 先合再派 B3 那一格**；B10 只碰 `deconstructVideo.ts` / `shotTimeline.ts`，不冲突。
- B13 ↔ B15 都碰 `src/ui/onboarding/` → 串行（B13 先）。

---

### 先查别人（R27 · 属 §4）

本文不引入新能力，只把问题落到批次；「先查别人」在这里 = **每批复用仓库里已有的哪一件**，禁止执行体再长一份。实施批开工前各自补自己的四问报告（`docs/research/<日期>-<主题>/prior-art.md`），这里只列已核实存在的复用件：

| 批 | 仓库里已有（file:line，origin/main `499f3c943`）| 用法 |
|---|---|---|
| B1/B3/B4/B5 数门 | `rule/door-map-root-cause-20260911` 的 `scripts/door-map.mjs`（分支内；方案 [docs/plan/2026-09-11-door-map-rule.md](2026-09-11-door-map-rule.md) 随该分支入库）| 合同 `doors` 字段由它生成，不手数 |
| B2 说人话层 | `electron/capabilityCore/mcpToolErrorResults.ts:125` `buildToolErrorOutcome` | 只加 `nextAction/unverified[]` 字段，不另写错误包装 |
| B2 门岗 | `scripts/check-error-surface.mjs` | 扩一条「信封含非常量 nextAction」，不新建门岗 |
| B3 三档表 | `src/workbench/ai/v4/agentPanelV4Types.ts:303-306` `PERMISSION_POLICIES`；先查别人已在 [2026-09-10-permission-model-rework.md](2026-09-10-permission-model-rework.md) §先查别人 与 [2026-09-11-permission-p1-implementation.md](2026-09-11-permission-p1-implementation.md) §先查别人（Claude Code / Codex / Cursor / Cline / MCP 规范六家）| 表搬主进程、按 effectClass 扩行，行业对照不重查 |
| B3 沙箱分档 | `electron/shared/agentCapabilities/codingCommandPolicy.ts:6-31` 头注（引用 Anthropic sandbox-runtime 与 OpenAI approvals 文档 URL）| 「沙箱退化只收紧」的理由已写在那里 |
| B4 卡队列 | `src/workbench/generationCanvas/spend/spendConfirm.ts:120` FIFO 队列 ✔️ | 只把队列**投影到界面**（`useAgentPanelSpendConfirm.ts:89` 的 `rows[0]`），不再写第二个队列 |
| B5 词表门岗 | `scripts/check-vocabularies.mjs` | **`model-list`** 登记为新 owner，复制即红（`aspect` 那条归在途 `plan-defaults`，不在本文）|
| B5 模型清单 | `src/workbench/generationCanvas/components/CanvasBulkModelSelect.tsx:43` `useGenerationModelOptionsState(group.representativeKind, …)` ✔️ | `StoryboardShotTable.tsx:188` 改用同一派生 |
| B6a/B7 反馈态 | `src/workbench/generationCanvas/nodes/director/panels/dialogs/MobileConnectDialog.tsx:38/116` copied 态 | 复制反馈复用，不新写 |
| B7 对比度门 | `scripts/check-feel.mjs` | 深底小字进断言库 |
| B6a 控件门 | `scripts/check-control-contract.mjs`（`check:controls`）| A4「必有 busy/终态」加到它上面 |
| B13 e2e 隔离 | `electron/capabilityCore/mcpConfig.ts:502` 已有 `NOMI_E2E` 守卫（只挡 `:499 repairStaleMcpConfigs`，不挡 `:633 installMcp`）✔️ | 把守卫从「修复」扩到「安装」，不另起隔离机制 |
| B13 接模型 | [docs/research/2026-09-10-vendor-key-publish-class/prior-art.md](../research/2026-09-10-vendor-key-publish-class/prior-art.md) | 「可用判据」的近邻已查，不重查 |
| **B11 技能机制** | **`docs/research/2026-09-12-skill-trigger-mechanism/prior-art.md`（分支 `research/skill-trigger-mechanism-20260912` 已推）**——已实抓 agentskills.io 规范、Anthropic 平台文档、Claude Code 文档、本机 `@earendil-works/pi-coding-agent@0.85.1` 源码，并给出 G1–G9 差距表 | B11 的四问报告**已完成**，实施批直接引用，不重查 |
| **B8 画布性能** | **`research/canvas-perf-at-scale-20260912`（未推送，在做）** | B8 的预算与「先查别人」都等它；B8 不得自带数字开工 |
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
| 技能声明结构化默认（研究 G7 ③）| 延后到 B5 + B11 落地后 | 最贵，且画幅直通修好后大半诉求消失 |
| `nomi-add-model` 技能「每轮 ≤3 模型」操作手册（MCP-P3 ③）| 不做 | 那是给死锁擦屁股的说明书，failure-path 治根后不需要 |
| **D2 时间轴 IA（两轨 + 拖动预览 / H3）** | **从 §6 移到这里** | 它不是岔路，是「还没到能决定的时候」——没有复现清单也没有样张，摆在待拍板表里给不了用户任何可选项。B9 出清单 + 样张后**再回到 §6** 成为真岔路 |
| **打包版可信技能根口子**（`runtimePaths.ts:57-67`：从含 `skills/` 的目录启动 Nomi，那个目录就成了可信技能根）| **单开一条安全小批（S）**，不并进 B11 | 技能研究顺手挖到的独立安全口子，与「技能没用上」无关；R28：这类应当由**路径解析层**拦，不靠 B11 的挂载改动顺带 |
| **#1 / 簇 A 门岗按风险分档** | 归在途 **PR #762** `tooling/gates-risk-tier-20260912`，本文不列为批 | 已在做；它带出的一条结论要跟着落：**整合 main 必须放在 gates 锁里面** |
| **A2「同一语义两份真相源」族 ID** | 已被 §2 根 4 整体重写吸收，原 ID 不再单独出现 | 记账一行，避免对账时当成漏项 |

---

## 6. 待拍板（只留真岔路；能用默认的已写默认，不问）

| # | 岔路 | 默认（不回复即按此）| 为什么是岔路 |
|---|---|---|---|
| D1 | 沙箱不可用的机器上，**全自动档**的 bash 命令怎么办 | **A′（见下）** | 见下方「D1 拆细」 |

**D1 拆细（反方审查建议：原来的问法粒度太粗，一刀切在「全部 bash 命令」上，所以两个选项都不好）**

⚠️ **前提（§0.5.3，2026-09-12 二次更正）**：「沙箱不可用的机器」既不是边角、也不是全部。**用户手上的 0.21.0 早于沙箱提交 `ec30e0150`，那个版本里根本没有沙箱**；而 0.22 **在 mac 上是有沙箱的**（打包缺口打不到 seatbelt，实测见 §0.5.3）。真正没有沙箱的是：**打包修复落地前的 Windows（在发的 `nsis`）/ Linux 装机版**，以及**任何平台上 `initialize()` 失败的机器**。所以 D1 的适用面比初版写的小——它不是「0.22 每个装机版的默认状态」，但仍是一条必须有答案的降级路径，**下面的建议不变**。

原问法把所有 bash 命令当成一坨在问，于是 A（全问）显得太烦、B（全放）显得太险。把它按 effectClass 拆开之后，绝大部分流量根本不是岔路：

| 命令类别 | 沙箱在时 | 沙箱不在时 · 选项 A（全问）| 沙箱不在时 · **建议 A′** | 沙箱不在时 · 选项 B（全放）|
|---|---|---|---|---|
| **纯只读**（`ls` `cat` `head` `rg` `git status` `git diff` …）| 自动 | 问 | **自动**——它们「可撤销」不是因为沙箱兜着，而是因为**它们根本不写东西**，这个判据沙箱在不在都成立 | 自动 |
| **写项目目录内** | 自动 | 问 | **问一次 + 会话级按命令模式记住**（现役 `codingCommandPolicy.ts:360` 的 `sessionAllowedPatterns` 已经支持）| 自动 |
| **越界 / 联网 / 高权限** | 问 | 问 | 问 | 问 |

**§0.5.3 的事实把这道题的范围划清楚了**：用户装的 0.21.0 **根本没有沙箱**（早于沙箱提交 `ec30e0150`）；0.22 的 **mac 包有沙箱**，**Windows / Linux 包在 `fix/sandbox-runtime-packaging-20260912` 落地前没有**，另加任何平台上初始化失败的机器。也就是说「沙箱不可用」不是罕见边角（它覆盖一整批平台），也不是所有人的默认状态——它决定的是**这部分用户**的体验；分量变了，但这道题仍然必须有答案。

**建议 A′ 的理由（推荐，但请用户拍）**：
- 用户的原则是「**可撤销就做、花钱才问**」。关键在于「可撤销」得**是真的**，不是我们声称的。
- 沙箱不在时，我们判断一条命令「只碰项目目录」靠的是 `codingCommandPolicy.ts:386+` 对命令字符串做静态路径提取——而 shell 里 `$(…)`、变量、管道、`cd` 都能绕过静态解析。**沙箱在时，这条边界是操作系统在守；沙箱不在时，它只是一次字符串猜测。** 把猜测当保证放行，正是 J11 说的「静默安全阀门」。
- 但「只读命令」不一样：它的可撤销性**不依赖任何边界**——不写就没得撤。所以它该进表里一个**新的 effectClass「只读命令」**，三档全自动，沙箱状态完全不影响（这正好也是 J3「沙箱状态不影响可撤销本地操作」的字面意思）。
- 代价与收益：A′ 把 #4 的体验从「每条命令都问」降到「只有写操作问、且每类问一次」，同时不为写操作编一个我们证明不了的保证。纯 A 太烦，纯 B 拿静态解析冒充沙箱。
- **不决定，交用户拍**：若用户认为「项目目录内有 git 兜底、写也直接放行」可以接受，那就是 B，本文照改——那是产品风险偏好，不是工程判断。

**一句话版的建议 A′**：**按效果类别把 bash 拆开**——**只读命令在全自动档直接跑，沙箱在不在都一样**（它不写东西，可撤销性不靠任何边界）；**写项目目录内的命令，在没有沙箱时问一次 + 记住**（因为「只碰项目目录」此刻只是对命令字符串的一次静态解析，不是操作系统的保证）；**越界写 / 外传数据永远问**。

已按默认处理、不问：深度模型首次下载 = 自动 + 进度 + 可取消（免费且可撤销，按表）；锁定 → 批量重跑默认排除已生成镜头；「项目素材」tab 拖到画布也认；Q5（能力槽收成一行摘要）/ Q6（表内点格子即播放）/ Q13 走同伴默认——**这三条现在有落点了：Q5/Q6 → B6a ⑥⑦，Q13 → B15**（上一版它们只写在这句话里，没有任何一批承接）。

D2（时间轴 IA / H3）已移到 §5，理由见那里。

---

## 7. 自检（真做过的，不是口号）

> ⚠️ **2026-09-12 反方审查后修订**：下表原来 7 行全 ✅，实测有 5 行站不住。逐条改判见 §9，本表只留修订后的结论。

| 项 | 结果 | 依据 |
|---|---|---|
| a) 每条拍板有落点且无矛盾 | ⚠️ **改判**：J2 与 `agentPanelV4.ts:61/:459` 的界面文案、与 `laneApprovalGate.ts:173` 的降档**直接矛盾**，原表没发现。已进 B3 ⑥⑦ | J1/J2 → B3 表「花钱」行三格（问/问/自动）+ 报价卡只在前两档 = B4 的渲染门在全自动列为空；J3 → B3「可撤销本地」行三档全自动；沙箱退化 → 只改「沙箱内命令」一格（B3 ③，D1 默认 A）；深度下载 → 「本地大下载」行（每步问=确认，其余=自动+进度）。三者落在同一张表的不同行，**互不覆盖**。J4→B1；J5→B14a/b；J6→B6a/B6b；J7→B5/B6a/B15；J8→B6a/B7/B4/B11；J9/J10→在途 two-paths + B13；J11→每卡「不许加」行 + B3/B4 数门；J12→§4 分组 ≤6、执行者列、样张列、R16/R30 列 |
| b) 无并行版 / fallback / 静默转进 | ✅ | 每卡「不许加」明列；B1 删 bash 写文稿门、B4 删 `catch→undefined` 与 `return []`、B5 删 9:16 兜底与硬拼清单、B6a 删 `continue` 静默跳参考、B9 删静默 `return`、B10 删每格兜底文案、B13 删 `/Applications` 优先与启动重写、B3 删设置页第二份三档。唯一「新增」的门岗 `check:card-owner` 是响的检测器 |
| c) 「同一语义多份定义」各有单一 owner | ✅ | 画幅 = `effectiveShotAspect`（B5）；模型清单 = 目录按 kind 派生（B5，含创作助手文本下拉 P0-10）；权限档 = 面板三档表（B3，删 `settings.mode`）；允许的供应商/模型 = approvedModelAccess（B5 删设置页那份）；文稿 = 主进程文档 store（B1）；MCP 宿主目录 = `BUILTIN_MCP_CLIENTS` × appInstalled（B15）；launcher = `process.execPath`（B13）|
| d) 每批验收门可机器或走查验证 | ⚠️ **改判**：B8 的「60 节点 ≤16ms/帧」是拍脑袋常量、B10 的「最小镜头时长」是魔数、B2 的「≤2 次」读成默许一次重试。三条已改 | 每卡有 门岗/单测/走查断言 三选一以上；涉 Agent 的 B1/B2/B3/B4/B11/B12 有 R30 数字；用户可见的 B5/B6a/B7/B8/B9/B14b/B15 有走查截图或实验室基线 |
| e) 与在途分支的文件重叠已标 | ⚠️ **改判**：未推送的在途不是 3 条是 **5 条**——漏掉 `fix/storyboard-plan-defaults-passthrough`（它正在改 B5/B6a/B7 列的那批文件）与 `research/canvas-perf-at-scale`（B8 的验收预算靠它）。已补进 §3 与 §4.3 | §3 在途表 + §4.3 矩阵；未推送的 3 条分支（PR-B / param-panel / agent-tool-face-research）文件面未知已标 ⚠️ |
| f) file:line 在 origin/main 重核 | ⚠️ **改判**：反方在 `origin/main` `63a0636dd` 复核 40+ 处，**18 处 ✔️、18 处 ✖️**（多为目录写错：`reactFlow/` 应为 `components/`、`src/workbench/settings/` 应为 `src/ui/onboarding/` 等），已全部改掉，逐条见 §9 | ✔️：`projectCanvasReadSurface.ts:405/419/438`、`laneDesktopTools.ts:73/119`、`codingCommandPolicy.ts:366-371/380-382`、`storyboardPlan.ts:551-554`、`StoryboardShotTable.tsx:188`、`useAgentPanelSpendConfirm.ts:82-106`（编排者写 ~144，实为 82-106）、`productionActionIpc.ts:57-64`、`appIntegration.ts:~512`、`spendConfirm.ts:116-134`、`mcpConfig.ts:59/196/224/499-502`、`mcp-l2-journeys.e2e.mjs` 无 restore、`laneSkillIndex.mts:12-22/125-131`、`laneCodingSandbox.mts:110/114/122`、`NodeDepthActionButton.tsx:7`、`depthVideoModelCache.ts:43/162`、`AutomationPermissionsSection.tsx:188-190`、`agentPanelV4.ts:57`、`DirectorEditor.tsx:163` + `HelpDialog.tsx`、`package.json:93`。⚠️：`shotFrameGeometry.ts:19-20`、`storyboardAspectScope.ts:37-39`、`laneApprovalGate.ts:173`、`laneNativeApproval.ts:25-41`、`documentReadTransportAdapters.ts:50-51`（沿用同伴）。**修正一条前提**：`scene3dJourney.ts` 不在 main（`d3f68057c` 删），B14b 从历史取回 |
| g) 无「之后再说」的空批 | ⚠️ **改判**：B11 写「待研究」，但研究分支当时**已经推送并定稿**；B14b 没有「条目」行；全部 15 张卡都缺 §0 自己承诺的「用户会看到什么变化」那一行。已补 | B11 研究已收、改法与验收门齐；B14a 是产出清单的只读批；无一批内容为空 |

---

## 8. 回滚

每批独立成 PR、独立 revert；依赖被回退时：

| 批 | 回滚方式 | 依赖被回退时 |
|---|---|---|
| B1 | revert；文稿工具回到 surface port | B2 的 nextAction 派生失去「文档 store」状态源 → B2 一起 revert；B6b 的删除按钮要一起 revert（否则 Agent 没法指镜头）|
| B2 | revert 信封字段；说人话层保留 | 无下游 |
| B3 | revert 表；设置页三档随之回来（同 commit 删的）| B12 的状态行仍可独立存在；B4 的队列投影不依赖表 |
| B4 | revert 渲染分支；`return []` 回来 | 无下游；B3 不依赖它 |
| B5 | revert；模型清单硬拼回来（画幅那半不在本批，不受影响）| B15 的设置页折叠不依赖 #49/#50 那半 |
| B6a/B6b | 各自 revert | B6b 回退 = 按钮回来，B1 不受影响 |
| B7/B8/B9/B10 | 各自 revert，互不依赖 | — |
| B11 | revert 挂载与回执；`buildSkillSystemPrompt` 死码随之回来（**回退时要一起 revert，否则又变成两份实现**）| — |
| B12 | revert 状态字段 | — |
| B13 | revert；启动重写回来（**回退后要提醒用户配置又会被改**）| two-paths 回退 → B13 整体 revert |
| B14b/B15 | revert UI；样张留档 | — |

无数据迁移：唯一新落盘的是 B10 的失败原因随任务行（向后兼容字段）。

---

## 9. 反方审查记录（2026-09-12 · Claude Fable 5.1）

基线：`origin/main` `63a0636dd`（**不是**正文原写的 `499f3c943`——期间 PR #758 已合）；收尾时 main 已到 `a11dccf5b`（+#757 +#761），实核那 19 个被引用文件在 `499f3c943..a11dccf5b` 区间 **diff 为空**，行号仍有效。分支状态用 `git ls-remote` + `gh pr view` 实核，不靠记忆。

> 📌 **审查期间作者的会话仍在写这份文档**，并已把本节的多条结论吸收进新增的 §0.5（第 0 波）——包括 B3 那两条矛盾、B8 不许自定预算、`plan-defaults` 是 B5/B6a/B7/B11 的前置。下表保留**审查当时**的判定，不因作者随后修好而改判为 PASS；已被 §0.5 接手的条目在说明里标出。

### 9.1 逐项判定

| # | 检查项 | 判定 | FAIL 数 | 说明 |
|---|---|---|---|---|
| 1 | 拍板一致性 | **FAIL** | 6 | 见 9.2 |
| 2 | 在途重叠 | **FAIL** | 2 | ⚠️ 审查进行中作者自行修掉了 3 条（skill 研究已推、#757/#758/#761 已合、补了 PR 号与 #762）。**剩 2 条仍缺，且都是硬依赖**：`fix/storyboard-plan-defaults-passthrough-20260912`（挡 B5/B6a/B7/B11）与 `research/canvas-perf-at-scale-20260912`（挡 B8 的验收门）——两条**此刻仍未推送**，见 §3 |
| 3 | 一族不一点（普查方法）| **FAIL** | 8 | B6a/B7/B9/B10/B12/B13/B14b/B15 八张卡没有普查方法。另有 4 处点修伪装成族：根 1「三处」实为 9 处、B9 的裸 return 实为 6 处、B6a 的 `continue` 同文件 8 处、`FALLBACK_RATIO` 一处定义三处使用。全部已补普查命令 |
| 4 | file:line 有效性 | **FAIL** | 18 ✖️ / 18 ✔️ | 见 9.3 |
| 5 | 验收门可验 | **FAIL** | 3 | B8 凭空预算、B10 魔数阈值、B2「≤2 次」。已改 |
| 6 | 并行计划 | **FAIL** | 5 | 路数合规（各波 ≤6），但重叠矩阵的目录名错、B6a/B7 同波与「串行」自相矛盾、漏 `nodes/` 与 `plan-defaults` 两条重叠、W1 触发条件含已满足的 #758。§4 已整体重画 |
| 7 | 两个岔路 | **FAIL** | 1 | D1 是真岔路但粒度太粗（已拆细并给建议）；**D2 不是岔路**，是延后，已移 §5 |
| 8 | 说人话（D6）| **FAIL** | 2 | §0 承诺的「用户会看到什么变化」**15 张卡一张都没有**；materialize / 信封 / 介入槽 / 派生 / 棘轮 五个词首次出现未解释。已补 |
| 9 | 缺漏 | **FAIL** | 9 真空洞 | 见 9.4 |
| 10 | 第 0 波 / RC 切线 | **新增** | — | 原文只有「按根因族分批」一条线，没有「这周发 0.22」那条线。按用户 09-12 拍板补 **§0.5**：切线尺子、装什么 / 不装什么、沙箱事实、节奏图 |
| 11 | 在途表自洽 | **FAIL** | 2 | 同一条 PR 在表里出现两次且状态打架（#757 一行写「已合」一行写 OPEN；`gates-risk-tier` 一行是 PR #762「已推」一行写「未推送」）。已去重，并按 `gh pr view` 实核逐行改写 |
| — | 双批认领 | **PASS** | 0 | 10 组双批（#2 #4 #13 #14 #15 #25 #28 #38 #45 P0-10）全部显式切了「半 / 阶段 / 共 owner」，无冲突。这一格做得好 |

### 9.2 拍板一致性的 6 条 FAIL（都已修进正文）

1. **`src/i18n/locales/agentPanelV4.ts:61`（zh）/ `:459`（en）**：「全自动」的界面说明写着「付费和不可逆的操作仍然每次问」——**这是 J2 的字面反面**，而且是权限档语义的第三份定义（另两份：`agentPanelV4Types.ts:303-306` 与设置页 `AutomationPermissionsSection.tsx:188-190`）。→ B3 ⑦。
2. **`laneApprovalGate.ts:173`**：`resolved?.forceConfirmation && !reusableNativeGrant ? { mode:'step', spend:'confirm' } : policy` —— 一个调用点就能把整档摁回「每步问 + 每次确认花钱」，在全自动档直接推翻 J1/J2。原文在证据里标了 ⚠️ 却没写进任何改法。→ B3 ⑥。
3. **B7「封面失效 → 占位态 + 抽帧」**：自动用抽帧替换坏封面 = 静默兜底，J11 禁。→ 改成「占位态 + 一颗用户点的『重新抽帧』」。
4. **B2 验收门「同一错误码连续出现 ≤ 2 次」**：读起来像默许一次自动重试。→ 改成「> 1 次即红，第二次必须带不同的 `nextAction`」。
5. **B10「最小镜头时长合并伪切点」**：魔数修法（09-10 用户退回 PR #690 就是这条）。→ 阈值从帧率派生，验收门用 12fps / 30fps 两组证明它跟着变。
6. **J10 vs B13 验收门**看着打架（「没有付费验证」却要跑真 DeepSeek）。→ 正文加了一行区分：J10 禁的是**产品内**花用户额度的接入验证；研发侧验收花我们自己的额度，按 P0 默认授权。

### 9.3 file:line 复核（`origin/main` `63a0636dd`）

**✖️ 改掉的 18 处**：`appIntegration.ts:~512`→`:502/:509`；`documentReadTransportAdapters.ts:50-51`→`:45`(静态码)`/:12-20`(白名单)`/:51`；`laneSkillIndex.mts:12-22`→`:14-24`；`mcpConfig.ts:196/224 优先指向 /Applications` → **只在 dev**（`:225` 打包版走 `process.execPath`，`:226-227` 才是那条偏好）；`shotFrameGeometry.ts:19-20`→`:20` 定义 + `:40/69/70` 使用；`storyboardAspectScope.ts` 不在 `creation/storyboard/` 而在 `generationCanvas/agent/`（且在途分支已改名 `storyboardShotScope.ts`）；`canvasStageDrop.ts` 在 `generationCanvas/components/` 不在 `reactFlow/`；`generationReferenceResolver.ts` 在 `src/workbench/generationCanvas/runner/` 不在 `electron/capabilityCore/`；`TaskCenterPanel.tsx` 在 `src/workbench/taskCenter/`；`ShotTableGrid.tsx` 在 `generationCanvas/nodes/shotTable/`；`useAgentPanelV4Data` 是 `.ts` 不是 `.tsx`；`GroupFrame` / `useCanvasSelectionDrag` / `CanvasNavigationStack` 三个都在 `components/` 不在 `reactFlow/`；`ShotComposerBar.tsx` 在 `shotRow/`；`ShotReferenceSlotPopover.tsx` 在 `creation/storyboard/shotRow/`、`AssetPickerPopover.tsx` 在 `src/workbench/assets/`（都不在 `generationCanvas/reference/`）；`ModelSettingsWorkspacePages` / `ConnectAssistantCard` 在 `src/ui/onboarding/`；`feedbackDiagnostics.ts` 在 `src/ui/community/`、`diagnosticsBundle.ts` 在 `electron/diagnostics/`；`onboardingProviders.ts` 是 `src/i18n/locales/` 下的文案文件；`package.json:93` 当证据（那是 `gates` 脚本，证不了它要证的事）→ 删。

**✔️ 复核仍成立的 18 处**：`projectCanvasReadSurface.ts:405/419/438`（但只是 9 处中的 3 处）、`laneDesktopTools.ts:73/119`、`agentPanelV4.ts:57`、`agentPanelV4Types.ts:303-306`、`codingCommandPolicy.ts:366/377/6-31`、`AutomationPermissionsSection.tsx:188-190`、`storyboardPlan.ts:551-554`、`StoryboardShotTable.tsx:188`、`useAgentPanelSpendConfirm.ts:82-106`、`productionActionIpc.ts:57-64`、`mcpConfig.ts:59/502`、`laneCodingSandbox.mts:110/114/122`、`depthVideoModelCache.ts:43/162`、`DirectorEditor.tsx:163`、`mcpToolErrorResults.ts:125`、`CanvasBulkModelSelect.tsx:43`、`MobileConnectDialog.tsx:38/116`、`onboardingProviders.ts:552`。另：`scene3dJourney.ts` 确不在 main、`d3f68057c^` 取得回 ✔️；`buildSkillSystemPrompt` 确为**零生产调用者** ✔️。

**两处从 ⚠️ 升为 ✔️**：`laneApprovalGate.ts:173`、`laneNativeApproval.ts`（实际块在 `:23-44`）。

**一处行号对但说法错**：`spendConfirm.ts:116-134` 写「单槽 + FIFO 排队」——自相矛盾，且 `:120` 早已是 FIFO 队列（B4 那轮治过），缺的只是界面投影 `rows[0]`。

### 9.4 缺漏对账（对同伴 58 条 + 验收 10 条 + Q/A/簇/MCP）

**9 条真空洞**（有 ID、有内容、正文零承接，已各自安排落点）：#16 / Q5（能力槽 chips → B6a ⑥）、#29 / Q6（表内播放 → B6a ⑦）、#30 / C7 前半（画布图片透明边 → B7）、#17（跨镜头一致不像 → B6a）、Q10（拆解失败导诊断包 → B10）、A2（族 ID 被根 4 吸收 → §5 记账）、MCP-P1（reaper/cancel/per-model 错误原文 → B2 的依赖 PR #761）、MCP-P3 ②（两条 lessons → B13）、H3（两轨+拖动预览 → B9 记账 + §5 延后）。

**只靠 §1/§3 承接、未条目化，已补进对应卡的「条目」行**：#1+簇 A（→ §5 归 `gates-risk-tier`）、Q3 / Q4 / Q13、A4 / A5 / A6、C6、C9、G1、I1、MCP-P0、P0-1 / P0-2。

**结构缺陷**：B14b 是唯一没有「条目」行的卡（已补）。

### 9.5 我没解决、需要用户拍的

1. **D1**（见 §6 拆细表）——建议 A′，但「项目目录内写操作放不放」是产品风险偏好，不是工程能定的。
2. **三条未推送的在途分支挡住半张表**：`plan-defaults`（挡 B5/B6a/B7-B/B11）、`PR B`（挡 B1/B2/B6b）、`canvas-perf-at-scale`（挡 B8 的验收门）。它们不推，W1 之后基本派不出去——这是排期风险，不是文档能修的。
3. **B3 ②「支付与风险边界」里具体删哪些字段**原文写「待实施时核」，我没核（那一页的字段清单要开着 app 看）——保留 ⚠️。
4. **`fix/param-panel-flat-options-20260911` 文件面仍未知**（未推送且我不能进那个 worktree 翻工作区），B6a 的重叠风险保留 ⚠️。

---

### 9.6 复盘补录（2026-09-12 06:20，反方审查第二程）

第一程的审查结论完整保留，本程在它之上做了三件事：

**① 分支 / PR 状态按 `gh pr view` 逐条实核（不是记忆，也不是第一程 05:20 的快照）**

| PR | 实核结果 |
|---|---|
| #754 `feat/mcp-onboarding-tool-face-20260911` | OPEN |
| #755 `fix/canvas-magnetic-handle-restore-20260912` | OPEN |
| #757 `feat/permission-p11b-reprice-writeback-20260911` | ✅ MERGED 2026-09-11T21:24:21Z |
| #758 `feat/model-box-tidy-20260911-p` | ✅ MERGED 2026-09-11T21:13:22Z |
| #759 `rule/door-map-root-cause-20260911` | OPEN |
| #760 `feat/agent-tool-face-single-owner-20260911` | OPEN |
| #761 `fix/integration-run-failure-path-20260912` | ✅ MERGED 2026-09-11T21:48:07Z |
| #762 `tooling/gates-risk-tier-20260912` | OPEN（分支**已推** `4cf3604c`——第一程写「未推送」✖️，已改）|

`git ls-remote` 复核的分支：`research/skill-trigger-mechanism-20260912` ✅ 已推（`41b91028`）；`feat/model-onboarding-two-paths-20260911` ✅ 已推（`c6c98d797`，只有 docs）；**`fix/storyboard-plan-defaults-passthrough-20260912` 与 `research/canvas-perf-at-scale-20260912` 此刻仍不在远端**——§3 与 §4 里「等它合入」的三批（B5 / B6a / B7）与 B8 的验收门，依赖的都是还没推的东西，这是排期上的真风险，写在这里不藏。第 0 波那四条 RC 分支**一条都还没建**。

**② 在途表去重**：同一条 PR 在表里出现两次、状态互相打架（#757 与 `gates-risk-tier` 各一对）。一张写着「实核」的表自己对不上，后面所有依赖判断都不可信，所以先去重再谈内容。

**③ 沙箱前提更正**，三条已折进 §0.5.3、B12 与 §6 的 D1：09-11 那次会话跑在 dev 且沙箱**是开着的**（「越界」卡片是设计如此）；用户装的 0.21.0 **早于沙箱提交 `ec30e0150`**，那个版本**根本没有沙箱**；打包缺口经 09-12 二次更正后 = **Windows / Linux 与三平台 java agent**（mac 的 seatbelt 从纯 asar 里也起得来，实测见 §0.5.3），所以 D1 覆盖的是「0.21 全体 + 打包修复前的 Windows/Linux + 任何平台初始化失败的机器」，**不是**初版我写的「0.22 每个装机版的默认状态」——这一句是我据 §0.5.3 初版下的，随其二次更正一并作废；`sandboxInactiveReason` **零 UI 消费者**。适用面变小，**但不改变建议 A′ 本身**。

> 🔁 **2026-09-12 二次更正（上一段第三句已作废）**：「打包缺口 = 运行时二进制没进 `asarUnpack`，所以装机版根本没有沙箱」**按平台是假的**。打包产物实测：**mac 从纯 asar 里起沙箱仍 `active:true`**（seatbelt 只要 `/usr/bin/sandbox-exec`，不碰 `vendor/`）；缺口打到的是 **Windows / Linux 与三平台 java agent**，且 `asarUnpack` 只是修法的一半——运行时用 `import.meta.url` 拿到的路径仍指进 `app.asar`，另一半是把解包路径显式交给它（`laneSandboxVendorPaths`）。因此 §6 D1 的**分量论证已改写**，**建议 A′ 本身仍不变**。出处：`docs/lessons/sandbox-runtime-not-unpacked-from-asar.md`。

**D1 的建议一句话**：按效果类别拆 bash——只读命令在全自动档直接跑（沙箱在不在都一样，它不写东西）；写项目目录内的命令在没有沙箱时问一次 + 记住（因为「只碰项目目录」此刻只是一次字符串解析，不是操作系统的保证）；越界写 / 外传永远问。**这条不替用户决定，仍在 §6 等拍。**
