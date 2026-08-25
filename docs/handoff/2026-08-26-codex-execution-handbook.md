# Nomi 完整执行方案与交接手册（2026-08-26）

> **给谁看**：接手 Nomi 推进的 Codex 或任何 AI。owner 额度紧张，这份文档要能**脱离对话独立执行到底**。
> **自足承诺**：本文不依赖你去读别的文档也能干活。引用的外部文档只是「更细的图纸」，主干判断全在这里。
> **读法**：Part 0 先读（它决定你会不会犯本仓最贵的错）→ Part 1 战略全景 → Part 2 现状 → Part 3 铁律 → Part 4 已拍板 → Part 5 工作队列 → Part 6 验证手册。

---

# Part 0. 最重要的一件事（先读这个）

**本仓最大的风险不是写错代码，是产出「看起来证明了什么、实际什么都没证明」的证据。**

代码写错了能查出来；证据造假查不出来，因为**绿灯让人停止怀疑**。2026-08-25→26 一夜连撞四次同族缺陷，四个根因都修了、都加了门岗，但**护栏只能拦已知形态**。真正要传下去的不是护栏，是这个反射：

> **看见绿灯，先问它到底证明了什么。**

四次实录（细节见 Part 4「陷阱」）：

| 表面 | 实际 |
|---|---|
| 「IPC 绑 sender/origin」已实现 | 173 个信道里只做了 1 个，漏掉的正是铸造扣费令牌那个 |
| 棘轮门岗有阳性对照、报红正确 | 门岗扫描范围**排除了**绕过代码所在的文件 |
| 走查断言「第二张卡不再出现」通过 | 断言瞄的是**新卡**自己的元素，从没检查过**旧卡** |
| 为回归某 bug 专门加的走查腿，gates 全绿 | 那条腿**从没执行到过**——选择器是死的 |

**第五次是我自己**：写完这份文档警告「管道吞退出码」之后，我随手写了 `... | tail -3; echo "exit=$?"`，屏幕上门岗**明明打印了 ❌**，退出码却是 `0`。**报错文字和退出码同时在眼前、彼此矛盾，我差点按退出码下结论。**

结论：**知道规则不管用，要养成手指上的习惯。** 机械判据——**只要 `echo $?` 前面有 `|`，这个退出码就是假的**，看见就是错，不需要判断。

---

# Part 1. 战略全景

## 1.1 北极星（一句话）

**内外一个控制面**：外部 agent（Claude Code / Codex，经 MCP）和 Nomi 内嵌统一 agent，驱动**同一批语义工具、同一个确认面、同一套技能库、同一组 Workflow Pack**。用户在哪个入口都能「把故事从文本推进到可编辑初稿、再到可撤销的成片，**不丢上下文、不重复扣费、不被模型差异欺骗**」。

## 1.2 分层总图与当前完成度

```
L6 Workflow Packs   「小说/剧本→一集」第一条              [待建：Pack 合同格式 + 模式选择器]
L5 交互层           Agent 主栏 · 对话词汇表 · 参数卡 · 级联重跑  [待建=B5，样张必须 owner 拍板]
L4 统一 Harness     单循环 · 事件溯源 · Thread/Turn/Item · 策略引擎 [🚧 B4-0 契约已交付，B4-1..5 待做]
L3 确认面           对话内确认 > elicitation > 置顶浮窗（三宿主一语义） [✅ 基本可用，B3 待收敛]
L2 语义工具面       12 语义工具 · 可编辑计划 · 封存 · 耐久 Run     [✅ 已交付]
L1 生产段           多镜 + 锚 + 一次确认 + 落画布 + 返工          [✅ P4 S1-S7 已完成并真金验收]
L0 底座             ProductionRun / 合同 / 预算 / outbox / 资产   [✅ 已交付，14/14 验证]
```

两个入口都骑在 L2-L4 上：**外部** = MCP transport；**内部** = 进程内直连同一工具实现。**禁止造第二套。**

## 1.3 四条轨道

- **Track A（价值主线）**：P4 生产段 → P5 采纳/剪辑。**agent 没有生产段就是空壳。**
- **Track B（harness 与统一化）**：B1a-d 清理 → B2/B3 → **B4 harness 核心** → **B5 交互层**。
- **Track C（外部体验）**：MCP Skill/Workflow 包装（Claude Code/Codex「一句话出片」）；新版 CC elicitation 真机探针。
- **Track D（地基加固）**：D1 安全生命周期 → D2 `sendSync` 异步化 → D3 瞬时态/领域态分离 → D4（可选）换内核。

**最核心（决定以后不用重写）**：P4 闭环 ✅、事件溯源日志、单一审批信道、策略引擎。**后三件全在 B4。**

**能等**：subagents、自定义 Builder、ACP 直接实现、第二条 Pack、P4.5 分镜图检查点。
**不做**：swarm、外部 runtime 当事实源、per-tool 弹窗、两套画布/两套 UI。

## 1.4 统一 Harness 设计要点（B4 的图纸）

1. **同步单循环**（OpenHands 异步总线是反面教材）：Electron 主进程/utility process；Vercel AI SDK 做多供应商抽象（BYO key）。
2. **事件溯源会话日志=唯一真相源**：追加式 JSONL 派生模型上下文 / UI 回放 / 断点续跑 / fork。
3. **Thread→Turn→Item 事件流**（对齐 Codex App Server 形状与 ACP）经 IPC 投影渲染层：每 Item 一个组件，`started→delta*→completed`。
4. **单一审批信道**：确认 = 事件流上的反向请求，turn 暂停等回答。**「agent 只许提案不许花钱」是策略引擎的 deny 规则（harness 强制，不是写在 prompt 里）。**
5. **策略引擎单点化**：deny→ask→allow + 三档闸门（Block / Notify / Auto）+ 会话级信任推广。
6. **模型能力分级**：档案声明档位——弱档收窄工具面、多走 playbook 轨道、诚实提示「此模型带不动全自动」；强档放开自由 loop；限流/失败自动 fallback。
7. **自动压缩** + compact_boundary + 可配保留指令（分镜决策 / 角色身份 / 已拍板项）。
8. **maxTurns + 预算硬顶**在 harness 层。
9. **SKILL.md 渐进披露**：导演/编剧技能库迁 SKILL.md，内外共用。
10. **v1 不做**：subagents、独立 plan 子系统、per-tool 弹窗、外部 orchestration runtime。

**复用边界**（已定，别重新论证）：已复用 = Vercel AI SDK（模型抽象/工具循环/流式）。pi 允许**源码级搬运**（MIT）但不引依赖——① 它官方无权限系统而权限恰是命门 ② 不认识我们的 vendor 体系 ③ 演化期破坏性变更 solo 扛不住。**Claude Agent SDK 一票否决**（仅 Anthropic 模型 + API key，与 BYO 冲突）。行业佐证：Cline / LibTV / TapNow 无一家装他人 harness，全是「底层 SDK 复用 + 薄壳自建」。

## 1.5 交互层规格（B5 的图纸，样张必须 owner 拍板）

### Agent 主栏（右栏恒在）

右栏从「聊天框」升级为**项目驾驶座**：对话流 + 状态帧（当前步骤/花费/进度）+ 上下文抽屉（本次用到的锚/素材/计划缩略）+ 模式（Pack）切换 + 可拉宽/全屏/收窄。
**边界：缩略可看、编辑不入栏**——结构性编辑跳各自的家（一功能一个家）；主栏只提供跳转与行内轻动作。项目库页加 agent 入口（「开个新片」一句话建项目）。

### 两根正交轴

- **模式强度**（Pack 合同第一字段）：重管线 | 对话主驾 | 单发直出
- **使用姿态**：纯对话（右栏全宽） | 对话领路（左舞台自动跟随，新手默认开） | 舞台为主（右栏收窄）

新手体验 = 「重管线 Pack × 对话领路」，**对话即向导**——不做独立向导 UI。

### 对话词汇表 v2（该用什么用什么，不全是卡片）

| 对话里发生什么 | 形态 |
|---|---|
| agent 思考/规划 | 折叠思考条（流式可展开）|
| 换模式/进入新阶段 | 分隔线标记 |
| 调工具干活 | 单行紧凑条「正在拆镜… ✓ 7 镜」|
| 长任务进行 | **原位更新进度条目 + 停止按钮**（留在对话流，不跳任务中心）|
| 任务前后态 | 排队中(第几位) / 等待中 / 已停止，显式态 |
| 向用户反问 | 问题 + 选项 chips，**≤3 问合并** |
| **要花钱** | **富卡片（唯一重卡）+ 对话暂停 + 明标价格与冻结项** |
| 产物出来 | 缩略卡 + **行内动作「改这条/重跑」** + 点开跳舞台 |
| 多候选 | 折叠成组并排挑、可指定生效版本 |
| **失败** | **失败条：哪一步败 + 人话原因 + 下一步动作**（重试/换模型/看日志）|
| agent 动了画布 | **写入回执**「已加 7 个节点 · 撤销」|
| 普通回复 | 纯文本 |

**命名纪律**：组件/状态名一律大白话自解释，**不造需要背的黑话**。每种形态 = 事件流一个 item 类型；外部客户端里同一事件长成 MCP 对应物，**一份语义两个投影**。

### 确认三宿主（一个语义、内容组件只写一份）

| 场景 | 确认长在哪 |
|---|---|
| 用户在 Nomi 用内部 agent | 对话流里的确认消息（富卡内嵌，对话暂停；**不弹中央窗**）|
| 外部客户端支持 elicitation | 客户端内嵌表单 |
| 外部客户端不支持且用户不在 Nomi | 置顶小浮窗（唯一「召唤注意力」场景）+ 系统通知 |

### 组件来源策略

**词汇表全抄、组件拷入重皮、协议对齐形状**：组件从 **Vercel AI Elements** 按需拷入仓库并用 Nomi token 重画皮（过 `check:tokens`，**不引运行时依赖**）；assistant-ui 作 HITL 参考；AG-UI/ACP 只对齐事件形状。

### 「自由挡不降级」铁律

**任何自动化都是在画布自由模式之上加的快路，不是替换。** 用户在任何一步都能退出到单镜/单节点手动操作，做完还能回到自动，账本连续。**哪天某个自动化要求「必须整批、不能插手」，即设计错误。**

每条刚性必须有逃生口，否则不许上：

| v1 刚性 | 逃生口 |
|---|---|
| 一批内单 provider | 该镜移出批次单独生成；下一批可换家 |
| 无自动首尾帧续接 | 画布手动抽帧 → 当下一镜首帧参考 |
| 同项目同时一个批次 | 画布单镜生成不排队，随时插 |
| 锚检查点停一拍 | 可配「超时自动放行」|
| 确认卡只读 | 「返回修改」一步回计划编辑 |

## 1.6 Workflow Pack（L6）

**Pack = 受约束声明。** 合同字段（定稿）：强度档、目标输入、可用工具与 module IDs、步骤/分支、capability、每步 `propose|paid|project_write`、确认点位置与**闸门冻结项**（确认框 + 花费预估 + **明说过闸后不可再改什么**）、失败/重启下一步、产物投影位置、版本迁移。

**Skill 只描述方法不拥有权限；Pack 描述组合；Run 执行。**

**一套画布原则**：Nomi 一套画布 + **模式档案声明可用节点/工具集**。（小云雀两套画布是反面教材。）
**混合素材一等公民**：时间轴是汇合点——上传素材、AI 镜头、裁剪、字幕、音乐同轨；**AI 服务于剪辑**。
**资产 = 唯一真相源，分镜只引用**：画布节点不复制资产内容。

第一条 Pack =「小说/剧本→一集」（重管线档）：编剧段（创作区+拆镜）→ 生产段（=P4）→ 采纳段（=P5/E1）→ 剪辑段（E2）→ 导出。

## 1.7 AI 剪辑三步

**核心对象：剪辑计划（EditPlan）** = 一组类型化时间轴操作（排列/字幕/音乐/转场/裁切），每条带影响范围；对话里渲染为**剪辑计划卡**（动几条/改哪里/可撤销）→ 批准 → **一个事务 Apply → 一步 Undo**。防重复/防过期用 Proposal 幂等键（`runId+contractHash+artifactId+artifactVersion+baseRevision+destination`，轴变了提案自动 stale）。**agent 不直接落轴。**

- **E1 采纳桥** ✅ 已完成（#176）：单产物批准进轴、一步撤销；批量版=「整批按分镜顺序排进时间轴」。零 AI 含量，纯管道，是后面一切的唯一入口。
- **E2 结构化粗剪**（Pack v1 剪辑段）：**不烧钱的聪明——结构派生而非 AI 猜**。按计划排列 + 时长对齐、对白→字幕轨、音乐垫底、转场应用、实拍素材混排。**配音/TTS 已拍板进 E2 剪辑段**（不进 P4）。
- **E3 理解式剪辑**（最后做）：审片给节奏建议、「开头收紧到 15 秒」意图剪辑、口播清理。**贵**（VLM/转写按量）且依赖 E2 操作词汇表成熟。

**边界**：不做通用 NLE 竞品（剪映在那，不拼也不该拼）；只做「AI 服务于交付这一部片」的操作集。

---

# Part 2. 确切现状（2026-08-26 03:30）

## 2.1 main

**最新**：`e0477f91`（走查取证框架整修 #178）

已合入的近期成果：

| PR | 内容 |
|---|---|
| #174 | Track D1：MCP 生命周期 + 付费确认绑定 + tools/call schema 校验 + IPC sender 绑定 + `check:ipc-sender-binding` 棘轮（未设防信道 173→10）|
| #176 | P5 E1 采纳桥 + `check:adoption-bridge` 棘轮 |
| #177 | F3 拆镜入口进选中浮条 + F16b 花钱/托管确认合并成一张卡（旧卡**已删**，consent 成为编译期义务）|
| #178 | 走查取证框架整修（四根因）+ `check:gates-chain` 元门岗 + 断言密度棘轮 |

## 2.2 在飞的阶段分支（都没开 PR，攒批中）

| 分支 | worktree | 内容 |
|---|---|---|
| `claude/stage-p5-e2` | `~/Desktop/nomi-stage-e2` | E2 盘点、B4 调研/讲解/实施计划、**B4-0 契约**、**D2 已完成** |
| `claude/stage-design-sync` | `~/Desktop/nomi-stage-dsync` | 设计系统组件库（40 组件 / 39 自作预览）+ 本手册 |

**接手第一件事**：进每个 worktree 跑 `git branch --show-current && git log --oneline origin/main..HEAD && git status`，确认没有未提交的半成品。**有就接着做，别推倒重来。**

## 2.3 已完成的验收

**P4 多镜连续性生产段**：验收门 §5.1-§5.5 全 ✅，含 **APIMart 真金付费验收**（真视频 submit→轮询→completed→materialize 全程落盘）。

## 2.4 worktree 纪律

这台机器有 **100+ worktree**。动 git 第一步永远 `git branch --show-current`。**绝不在共享主仓 `~/Desktop/Nomi` 里 checkout/切分支**——几乎每个分支都被别处占用。用分支自己的 worktree。新建 worktree 放仓库目录**同级**（非嵌套），从最新 `origin/main` 创建，且**必须 `pnpm install --prefer-offline`**（worktree 没有 node_modules）。

---

# Part 3. 铁律

## 3.1 交付纪律（owner 2026-08-26 明确要求）

- **默认不开 PR。** 活干完 commit 到阶段分支，继续下一件。**攒到大阶段边界才开一个 PR。**
  - 理由是**墙钟**：Quality Gate 一轮 6–25 分钟、要 up-to-date 得 update-branch 再等一轮、多 PR 并行要排合并列车、`package.json` 的 `gates` 链几乎必冲突。小 PR 的边际收益远小于这份固定开销。
  - 「大阶段」= 一个能对 owner 讲清价值的完整块。**不是**单个切片 / 单个 bug / 单个门岗。
  - 文档、小修、门岗、测试修复 → **一律搭车，永不单开**。
- **绝不 merge 别人的 PR，绝不 push main，绝不 `--admin`，绝不 force-push。**
- commit message 末尾必须有：`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 长命分支**定期把 `origin/main` 合进来**，别等到最后。`gates` 链冲突**必须按并集解**（漏掉一个 check **不报错**，门岗静默消失；现有 `check:gates-chain` 会拦，但仍要留心）。

## 3.2 五条核心原则

- **P1 加新必删旧**：引入新实现时**同 commit 删旧实现**。无并行版、无 fallback、无逃生口。CSS 同理（新样式只写组件 className，全局 CSS 只可减不可增）。
  - 实例：`runGenerationNode(node, options = {})` 那个 `= {}` 默认值就是逃生口。删掉后「谁问过用户」变成编译期义务。
- **P2 修根因 + 通用性判定**：修完必问「这个病只在这个功能上，还是别的功能也可能有」。是通用的就：① **全仓实扫**同类入口给 file:line（**扫，不猜**）② 能 grep 的做成**棘轮门岗**（`scripts/check-*.mjs` + baseline，只减不增）③ 存量进基线、新增当场报红。
- **P3 全绿 ≠ 完成**：CI 只证代码健康，证不了体验对不对。用户可见改动报完成前：① 和获批样张逐项并排对账 ② 真体感走查（截图**人眼判断**）。
- **P4 通用第一**：能力/组件按「模型身份 / 通用场景」设计，与具体供应商解耦。**不为不同模型写两套 UI。**
- **P5 想清楚再动手**：UI 改动**先读设计系统再画**，出可视样张 + owner 拍板；架构改动先查官方文档 + 读顶尖开源 + 6 角色评审；多文件改动先写 `docs/plan` 文档。

## 3.3 规则速查

| # | 规则 |
|---|---|
| R1 | 加新必删旧（CSS 只可减不可增）|
| R2 | 用户视角 + 极简：每条信息问「有行动价值吗」，没有就删 |
| R3 | 涉及取舍先给 owner 对比表，不单方面开干 |
| R4 | 多文件/多步改动先写 `docs/plan`：范围/不动项/回滚/验收门 |
| R5 | 碰第三方库必先查官方文档；**选型/引入新框架先查当前现役方案**，不凭记忆判断新旧；**接入任何模型前必先抓到该模型真实官方 API 文档逐项对账** |
| R6 | 做方案前先读真实开源代码，给 file:line |
| R7 | 项目方案定稿前 6 角色评审（CTO/设计/PM/前端/后端/真实用户）|
| R8 | 用户可见改动先出 mockup + owner 拍板；实现后与样张逐项对账 |
| R9 | 模块化 + 单文件 ≤800 行 |
| R11 | 验证通过即自己 commit；五门全过才能 commit |
| R13 | Playwright 走真实用户旅程，截图**人眼判断** |
| R14 | ≥25 commit 或发版前做多维审计 |
| R15 | 所有用户可见文字走 i18n（默认 `zh-CN`）|
| R16 | 功能交付必建「真实用户任务」端到端测试、跑通闭环、**把过程中冒出的问题全修掉**才算真完成 |
| R17 | 加门岗**必须先验证它会红**且**点名正确的文件** |
| R18 | 测试禁私有墙钟 waitFor / `Date.now()` 截止轮询 |
| R19 | 侧分支只能称「已实现」；**提交进入远端目标分支后才能称「已解决」** |
| R20 | 造轮子前先过 build-vs-buy 闸 |

## 3.4 决策自治

**默认自主推进到底，不留遗留。** 发现的问题**全部整完**，不要扫出一堆停下等 owner 一项项点头。

**自己定**（做完一句话说明）：实现细节、命名、模块拆法、测试策略、bug 修复顺序。
**评测/测试/验证类的额度花费默认授权**——直接花、别问、事后报花销。

**才问 owner**（合并成一轮，给推荐项）：
1. 产品方向 / 不可逆取舍
2. 架构岔路（影响大、多个分歧巨大的合理解）
3. **用户可见改动的样张拍板（最常见）**
4. 需要 owner 独有资源（API key、真实素材、`/login`）
5. **样张或需求自相矛盾——停下上报，不许自己挑一条实现**

## 3.5 owner 的决策逻辑（替他权衡时按这套想）

- **D1 从用户真实摩擦出发，不从实现出发**。effect-first：直接出效果 > 让他看表单/配置/说明。任何让用户多读、多配、多学我们格式的东西，默认砍。
- **D2 从结构和约束推，不从功能列推**。「solo」「广度是敌人」是过滤器不是借口；投机的大盘先砍或延后。
- **D3 第一性，追到底层「为什么」**。任何提议/改动/「这是问题」必须讲清三件：① 为什么这么做（底层逻辑+现状根据）② 会发生什么（机制后果）③ 用户体验是什么。**叫某东西是 bug 前，先搞懂现有设计为什么这么写。**
- **D4 狠的极简 + 诚实交付**。缺口/限制**明着标**，不藏不糊弄。
- **D5 逻辑清楚就快决**。他要「敢分析、敢反驳、敢下判断」的伙伴，不是附和者。
- **D6 表达纪律**：每个方案让 owner 一眼看懂两件事——①**背后逻辑**（大白话+具体例子，不堆术语）②**他要权衡的那个核心东西**。**自造名词和标准术语都要解释**；从他看得见的东西起头 + 用一个承重比喻（比喻失效处要明说）。自检：他读完能不能复述「为什么」和「我在纠结什么」。

---

# Part 4. 陷阱（本仓踩过、别处学不到）

## 4.1 假绿家族（四根因已修，判断力必须传下去）

| 陷阱 | 怎么骗人 | 现有护栏 |
|---|---|---|
| `expectAbsent` 首次采样即过 | Playwright `toHaveCount(0)` 期望 0、当前也 0 → **第一次采样就通过**，timeout 一秒没用上 | 已修：先降到 0，再 `holdAbsent` 持续盯 800ms |
| 截图在动画未落地时拍 | 主题翻转要写 **4 个属性**且等 ~140ms；弹窗退场仍在画；toast 滑入被视口切掉。**同码同命令两次跑出不同证据** | `screenshotSettled()`。**失败路径故意不用它**——失败图要「当场什么样」|
| 门岗从 gates 链静默消失 | 解冲突「取了一边」就少一节，**不报错**，只是不再执行 | `check:gates-chain` 元门岗 |
| 走查几乎没断言还报绿 | 修复前 `model-onboarding.walk.mjs` 78 行**只有 1 条失败路径**，拍出 4 张逐字节相同的图仍 exit 0 | 断言密度棘轮（≥2 条失败路径）|

## 4.2 高频坑清单

- **`check:walkthroughs` 是静态检查，从不执行走查。** 「gates 绿」**不能**当作走查跑过的证据。（后果：main 上曾躺着 2 条红走查不知多久没人发现。）
- **管道会吞掉退出码。** 见 Part 0。后台任务通知里的 exit code **同样会骗人**（实测见过通知报 `exit code 0` 而日志尾是 `ELIFECYCLE ... exit code 1`）。**以日志为准。**
- **旧截图不会自动清。** 判定法：`ls -lT tests/ux/shots/<name>/` 的 mtime 对比 `git log -1 --format=%ci`。**截图早于修复 = 证明的是修复前的状态。** 跑前 `rm -f`，跑后确认时间戳更新。
- **半透明幽灵在缩略图里看不见。** 720px 看着干净，裁剪放大 4× 才发现幽灵按钮叠在卡上：`im.crop(box).resize((w*4,h*4), Image.LANCZOS)`。
- **死选择器同时造假红和假绿。** 读源码猜选择器必错——**先打运行时探针** dump 真实 DOM 属性再写断言。
  - `.filter({hasText:'名字'})` 匹配**文本内容**，而名字在 `aria-label` 上 → 永远匹配不到。
  - `.first()` 抓到尺寸为 0 的隐藏重复实例 → 点击超时 → 末尾 `.catch(()=>{})` 把超时吞了。**用 `:visible` 收窄，别留吞异常的 catch。**
- **并行测试伪造 flake。** 判红前先 `uptime` / `pgrep -fl vitest`，串行重跑确认。已知既有 flake：`electron/workspace/workspaceRegistry.concurrency.test.ts` 高负载偶发失败、隔离跑能过——**别去「修」它**。
- **走查里别用 `win.reload()`**：原地刷新后活动项目会话为空，面板静默空掉，**像极了真 bug**。用冷启动（close + relaunch 同 `userDataDir`）。
- **计数型基线指不出真凶。** 棘轮基线存**身份列表**（哪些文件/哪些 channel），不要只存总数——否则报红点名无辜文件，下一个人要么白查半天，要么把数字调大。
- **确认弹窗是单例 Modal**（`src/design/confirmDialog.tsx`）：关闭时属性瞬间消失（断言立刻绿）但退场动画还在画，且按钮文案回落成默认「取消/确认」。截图里飘着「取消/确认」而真卡是「取消/**生成**」，就是它。
- **付费验收只用 APIMart**（owner 没有即梦账号）。

---

# Part 5. 已拍板的决定（**不许重新论证**）

1. **B4 四件套自建**，不买全栈 agent runtime。AI SDK 能白拿的只有模型抽象 / 工具 schema / 流式多步 / abort-retry-repair，**保持 `ai@4`**。
2. **两条事件日志各走各的**，用 `runId / causeId / txnId / proposalId` 显式关联，**不物理合并**。
   - 量化理由：通用日志 `fs.appendFileSync` **不 fsync**；ProductionRun 走 `writeSync + fsyncIfDurable`（`electron/durability.ts` 是全仓唯一决定要不要真 fsync 的地方）。合并会强迫二选一：**要么高频对话事件都 fsync 拖慢交互，要么账本失去掉电保证。**
3. **AI SDK 7 只做隔离只读 spike**，通过后再议升级。spike **不得写入** ProductionRun / 预算 / canvas。
   - 反直觉点：SDK 7 新增的 durable execution 和 tool approvals 听起来正是我们要的，但**恰恰最不该买**——ProductionRun 账本和确认漏斗已经是护城河且是保护项。买它 = 用外部框架替换护城河。真正有价值的是它的 HarnessAgent adapter（属 Track C）。
4. **Thread/Turn/Item 用 Nomi 自有 union**，对外做 adapter。**禁止 SDK 类型反向侵入业务模型。**
5. **保护项永不被反向改写**：ProductionRun 账本、预算/收据/幂等、锚一致性、Proposal/撤销、能力核权限。
6. **Track D 四批顺序**：D1 ✅ → D2 ✅ → D3 → D4（可选）。
7. **E2 不得使用不存在的能力**：`ripple` / `roll` / **视觉转场**都不存在（`timeline.transitions` 有数据但播放器和导出器根本不读；`audioCodec:none/audioMode:mute` 所以「有音乐的粗剪」导不出来）。**不存在的能力不得出现在类型或卡文案中。**
8. **配音/TTS 进第一条 Pack 的剪辑段（E2），不进 P4。**
9. **B1c systemPrompt 合成器新增「项目偏好记忆层」**（色调/字幕风格等用户自由偏好持久化）。
10. **B5 交互层维持全部样张先行、owner 亲眼拍板后实现。**

---

# Part 6. 完整工作队列（从现在到完成）

> 每项给：**目标 / 前置 / 做法 / 验收 / 回滚 / 边界**。按顺序做；被阻塞就跳下一项，别空转。

## 6.0 收尾：design-sync 封存【最优先，只差一步】

- **目标**：把设计系统组件库跑到可用，然后**封存**——它不在关键路径上。
- **前置**：`~/Desktop/nomi-stage-dsync`，分支 `claude/stage-design-sync`。
- **做法**：读 `.design-sync/NOTES.md`，按顺序跑（**三条分开、各看退出码、别 `&&` 串、别 `| tail`**）：
  ```bash
  node .design-sync/support/build-css.mjs
  node .ds-sync/package-build.mjs --config design-sync.config.json \
    --node-modules ./node_modules --entry .design-sync/support/ds-entry.mjs --out ./ds-bundle
  echo build_exit=$?
  node .ds-sync/package-validate.mjs ./ds-bundle
  echo validate_exit=$?
  ```
- **验收**：`.render-check.json` 的 `bad` 为 0；**亲眼读 `ds-bundle/_screenshots/contact-sheet-*.png`**（读前确认 mtime 晚于最后一次 build）；剩余 12 个未评级组件出图后评级。
- **回滚**：`ds-bundle/` 是 gitignored 生成物，删掉重跑。
- **边界**：**上传 claude.ai/design 不做**（需 owner 跑 `/login`）。跑完 commit、封存，**不要再优化**。

## 6.1 B4-1：前置清理（§3 内部各自为战的收敛）

- **目标**：补齐 B1a/B1b/B1c/B1d，收敛 B2 工具注册与 B3 确认入口，**同 commit 删除旧 caller 配置层**。
- **前置**：B4-0 契约已交付（`electron/harness/domain/`，674 行，零引用零生产影响）。
- **各件说明**：B1a 会话键工厂（低险）｜B1b 清会话一致化（低）｜B1c systemPrompt 合成器（中，前缀缓存 byte 稳定，**含项目偏好记忆层**）｜B1d 单次 vs 多轮显式声明（中）｜B2 工具动态注册表（高）｜B3 确认规范化三档（高）。
- **统一形态**：agentLoop 外套「面板注册表」——面板只声明 `{sessionKeyContext, skillKey, tools, systemPromptLayer}`。
- **重要提醒**：`origin/main` 上 B1a/B1b/B1d 已有实现，但**审计表仍记录旧 caller**。**不要把「残余调用点已清零」当成事实**——开工先用 `rg` + typecheck 找完整入口集。
- **规模**：新增 250–450 行 / 删除 220–420 行。**超上限必须停下复盘，不得靠继续加代码掩盖范围漂移。**
- **验收**：每个被删旧路径都有对应新路径的测试；`gates` exit=0；涉 UI 的亲跑走查。
- **回滚**：保留旧 key 字节快照 + 一次性回滚分支。

## 6.2 B4-2：双日志接线期

- **目标**：让现有 Agent trace、Proposal/事务、MCP challenge、ProductionRun gate 产生**同一组关联键**；建立**只读** correlation index。
- **规模**：新增 300–500 行 / 删除 40–100 行旁路手写关联。
- **待拍板项**：correlation record 的物理落点（旁路 sidecar vs 扩展 Run metadata）。**默认走旁路 sidecar，不碰受保护 schema。要改必须 owner 拍板。**
- **验收**：跨两条日志的对账**要有断言证明**，不是「应该对」。
- **回滚**：回退 adapter/bridge，日志原文件和 Run 文件不动。

## 6.3 B4-3：策略与单一审批期

- **目标**：实现 deny→ask→allow、三档闸门（Block/Notify/Auto）和单一 `ApprovalDecision`，由 IPC/MCP **各自投影**。
- **规模**：新增 350–600 行 / 删除 180–320 行重复确认/模式判断。
- **关键**：`ApprovalDecision` 要被两个宿主渲染，**契约必须防止两边漂移**——这正是 F16b 那张重复托管卡的病根，不许在新架构里复发。
- **待拍板**：是否允许 session-level trust 默认扩散。**默认保持现有 trust scope，扩大范围要标为待拍板。**
- **回滚**：关闭新 adapter，旧入口恢复；**不得回滚账本已有记录**。

## 6.4 B4-4：事件流/恢复期

- **目标**：由两条日志和 correlation index 派生 Thread/Turn/Item；验证 stop/restart/retry/receipt 对账。
- **规模**：新增 450–750 行 / 删除 100–180 行重复 projection。
- **回滚**：停用投影消费者，保留日志，UI 回到现有 trace/Run projection。

## 6.5 B4-5：AI SDK 7 隔离 spike

- **目标**：在临时 fixture 验证 SDK 7 映射、Electron bundling、abort/stream 兼容性。
- **边界**：**只读**，不得触及 Run / 预算 / canvas。spike 失败直接删目录。
- **禁止**：在 spike 前宣称「可升级」或「比 ai@4 更好」。

## 6.6 E2 结构化粗剪【被样张阻塞】

- **状态**：盘点与设计已完成。
- **阻塞**：会产生**剪辑计划卡**（用户可见），按 R8 必须先出样张、owner 亲自拍板。**没拍板前不要实现这张卡。**
- **可以先做**：「必须先补」那一档的缺口——① 分镜 `durationSec` → 时间轴 builder 的映射（当前 builder 不读 `params.duration`）② 音频进入最终导出链（renderer manifest 当前 `audioCodec:none`）。这些不涉及新 UI。
- **绝对不能做**：把 `ripple`/`roll`/视觉转场写进类型或卡文案。

## 6.7 D3：瞬时态与领域态分离

- **目标**：画布 viewport/手势、时间轴播放头写回整个 timeline——**同一个病的两个部位**。
- **意义**：**改完之后「换不换成熟内核」才从必答题变成选择题。**
- **性质**：大切片，单独排一个大阶段。

## 6.8 B5 交互层【大 UI，样张必须 owner 亲眼拍板】

按 Part 1.5 的完整规格做。**全部样张先行**。画样张前**先看真实 UI**（读完整外壳组件或真实截图），或用 design-sync 产出的组件库照着拼。

## 6.9 Track C：外部体验

MCP Skill/Workflow 包装（Claude Code/Codex「一句话出片」引导）；新版 CC elicitation 真机探针（CC CLI ≥2.1.76 已支持，验完回写记忆）。

## 6.10 债务清单

- S7b：`driveGeneration` 收编（删 ~120 行）
- 复用徽标投影补齐
- `check:i18n` 里 `localComfyui` / `localCodexImage` 疑似未引用键（本轮未处理）

---

# Part 7. 验证手册

## 7.1 门禁（push 前必过）

```bash
pnpm run gates > /tmp/gates.log 2>&1; echo exit=$?
```
**必须这样写。** 别 `&&` 串，别 `| tail`。exit 必须 0。链上现有 23 个 check（`check:gates-chain` 保证没有一个被静默删掉）。

常用单项：`check:filesize`（巨壳）｜`check:tokens`（设计 token）｜`check:i18n`｜`check:heavy-path`（重活）｜`check:test-waits`（R18 硬零）｜`check:ipc-sender-binding`｜`check:adoption-bridge`｜`check:gates-chain`｜`check:walkthroughs`。

## 7.2 走查（gates **不会**帮你跑）

```bash
rm -f tests/ux/shots/<name>/*.png
node tests/ux/<name>.walk.mjs > /tmp/walk.log 2>&1; echo exit=$?
ls -lT tests/ux/shots/<name>/
```
截图**要自己亲眼看**。怀疑有幽灵就裁剪放大 4×。

## 7.3 加门岗的红绿证明（R17，缺一不可）

```bash
node scripts/check-<name>.mjs > /tmp/g1.log 2>&1; echo "clean_exit=$?"      # 期望 0
# 注入一处违规
node scripts/check-<name>.mjs > /tmp/g2.log 2>&1; echo "violation_exit=$?"  # 期望 1，且**点名正确文件**
# 撤销
node scripts/check-<name>.mjs > /tmp/g3.log 2>&1; echo "restored_exit=$?"   # 期望 0
git status --porcelain | wc -l                                              # 期望 0
```
**把字面输出写进报告。** 只报「加了门岗且 gates 绿」不算数。

## 7.4 判断测试红灯真假

```bash
uptime                                    # load 高说明并行放大
pgrep -fl vitest                          # 别的 worktree 在跑吗
npx vitest run <path> --reporter=dot      # 串行重跑确认
```

## 7.5 常用命令

| 命令 | 用途 |
|---|---|
| `pnpm dev` | 开发模式（Vite + Electron）|
| `pnpm build` | Vite 构建 + electron tsc |
| `pnpm run test` | Vitest 单测 |
| `pnpm run typecheck` | 双向类型检查 |
| `pnpm run gates` | 全门 |

---

# Part 8. 报告格式

owner 额度紧张，**报告 ≤20 行**，必须包含：

- 做了什么（带 file:line）
- **字面退出码**（gates / 走查 / 门岗红绿），不是「通过了」
- 你**亲眼**看到了什么（截图描述），不是「应该没问题」
- 什么没做完 / 什么不确定——**诚实交付，缺口明着标**
- 有没有需要 owner 拍板的岔路

**不要把整份文档或整段代码粘回去。**

---

# Part 9. 一句话交接

**代码写错了能查出来，证据造假查不出来。**
Part 0 存在的全部理由，就是让下一个人不必再花一整夜去发现「绿灯可以什么都不证明」。
