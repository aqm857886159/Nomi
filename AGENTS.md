<!-- 本文件由 scripts/gen-agents-md.mjs 从 CLAUDE.md 自动生成，请勿手改。 -->
<!-- 改纪律请改 CLAUDE.md，再跑 pnpm run gen:agents；check:agents-sync 在 gates 链里拦漂移。 -->
# Nomi — 工程纪律

> **怎么读这份文件（3 层）**：
> - **L0 每轮** = `scripts/claude-hooks/self-check.sh`（hook，每条消息自动注入「三闸 + 核心原则 + 近期坑」）——salience 层，本文件**不再复述它**。
> - **L1 always 加载** = 本文件：项目事实 + 命令 + **P1–P5** + **D1–D6** + 规则索引。**每次 session 读完再动手。** 保持精简（一屏左右）。
> - **L2 触发才查** = `docs/engineering-rules.md`（R1–R30 详解）；`docs/coding-standards.md`（编码规范）；`docs/lessons/INDEX.md`（踩过的坑，按 A/B/C/D/E/F 场景分，走查/CI/分支/平台/产品/编排前各查一眼）；`docs/ARCHITECTURE-NOW.md`（各子系统现在真正跑的是什么，带 file:line，读方案前先过）；`docs/GLOSSARY.md`（同一东西的多个叫法）。
>
> **维护纪律**：本文件是**策展的，不是 append 的**。新踩的坑进 `docs/lessons/`（一条一个文件，挂 `INDEX.md`）或 hook 的 `violations.log`，**不塞这里**；只有「反复出现 + 永远相关」的原则才提升进 L1。Hook 真相源是 `scripts/claude-hooks/`，`pnpm install` postinstall 自动装进 `.Codex/`；`check:claude-hooks` 验同步。**禁止手改 `AGENTS.md`**：改纪律只改本文件，再跑 `pnpm run gen:agents`；`check:agents-sync` 拦漂移。本文件已做过可机器化分诊，删减依据见 `docs/engineering/rule-enforcement-audit.md`。

## 项目概览

Nomi：本地优先 AI 视频创作工作台。
**技术栈**：Electron + React 18 + Tailwind 3 + Zustand + React Flow (`@xyflow/react`) + Vercel AI SDK。
**主要模块**：项目库 → 创作（文本）→ 生成画布（节点系统）→ 时间轴预览 → 导出 MP4。
**设计系统**：`Design.md` + `src/design/`，token-only，光/暗双模式（默认按本地时间「天黑自动暗」·手动切一次后记住·token 翻转），密度优先。
**主仓库**：`/Users/aoqimin/Desktop/Nomi/`。所有改动从最新 `origin/main` 创建独立任务分支/worktree，通过 PR 交付；禁止直接 push `main`。

## 常用命令

| 命令 | 用途 |
|---|---|
| `pnpm dev` | 开发模式启动（Vite + Electron） |
| `pnpm build` | Vite 构建 + electron tsc |
| `pnpm run test` | Vitest 单测 |
| `pnpm run test:system:focused` | 普通 PR 的 changed/sibling/related tests；仍须配合 contracts |
| `pnpm run test:system:full` | 测试基础设施或手动发布边界的显式全量本地验证 |
| `pnpm run delivery:preflight` | 任务开始前有界刷新远端基线并验证独立干净分支 |
| `pnpm run delivery:verify-merged -- --expected-sha <SHA>` | 在真实 merged-main 上记录 exact-SHA CI checks 收据，不本地重跑 |
| `pnpm run test:e2e` | Playwright smoke（零额度，CI-ready） |
| `pnpm run lint:ci` | Lint + max-warnings=98 棘轮（新增 1 个 warning 即红）|
| `pnpm run typecheck` | TypeScript 双向类型检查 |
| `pnpm run check:filesize` | 巨壳文件门岗 |
| `pnpm run check:tokens` | 设计 token 门岗（禁任意 px 字号/圆角、hex 色、默认色板；棘轮只减不增）|
| `pnpm run check:heavy-path` | 重活门岗（同步图像编码 / base64 进 store / 尺寸双真相源；棘轮只减不增）|
| `pnpm run check:vocabularies` | 单一语义 owner 门岗（AST 扫状态/阶段词表；新增、复制、成员/位置漂移、陈旧登记或 debt 增长都会红）|
| `pnpm run check:i18n` | 可见文字国际化门岗（禁止新增硬编码 UI 文案；遗留基线只减不增）|
| `pnpm run check:framework-boundary` | 框架边界门岗（框架已提供的能力不许再长一份自研版本；债只减不增、绑方案、到期即红）|
| `pnpm run check:audit` | 审计节奏提醒（≥25 commit 提示） |
| `npx skills experimental_install` | 从 `skills-lock.json` 还原 `.Codex/skills/`（换机/协作者用） |

**Push 前按风险面分层（R22）**：contracts 始终跑（一次跑完全部门岗再汇总，不再第一个红就停；`check:docs-index`/`check:doc-status`/`check:ledger` 只出 warning 不阻断，合入 main 后由 `docs-autosync` workflow 自动补齐回写）；unit 独立选 focused/full；Electron、真实旅程、React Flow 画布、性能和 macOS package 各按受影响路径独立触发，`main` push 也按真实 `before..after` 分类，不因事件名自动全量。删除/重命名、空 diff、测试/CI 分类器自身和手动发布边界 fail-closed 到全维度。连续小修先在本地收敛，再一次性验证和 push，不让每个微提交反复触发全套 CI。

**交付身份只走统一命令**：任务开始先跑 `delivery:preflight`；PR 合并后只在 Git fetch 得到的真实 merge SHA 上跑 `delivery:verify-merged`。任务 commit、PR head、merge commit 与 tree 分开报告；禁止用 REST compare 文件列表重建 Git tree/commit，禁止把 `same-tree-different-commit` 叫成代码不匹配。

**提交/推送前的 Ponytail 闸门（R25，R24 由 PR #223 保留）**：每次成功的 commit 或 push 前都必须由版本化 `pre-commit` / `pre-push` hook 调用只读、限时的 Ponytail Codex 适配器，对准确的 staged 或 outgoing ref diff 运行 `/ponytail-review`（Codex 中是 `@ponytail-review`）；pre-commit 先通过敏感数据扫描，扫描已阻止的提交不会继续调用模型。缺少 Codex/插件、超时、异常或无合法结果标记就 fail-closed。发现过度工程化时只记录阻断状态；逐条删除清单需另行运行 `@ponytail-review` 后处理。

## 五条核心原则

**P1 加新必删旧** — 引入新实现时同 commit 删旧实现，无并行版、无 fallback、无逃生口。CSS 同理：新样式只写组件 `className`，迁 Tailwind 即删旧 CSS；全局 CSS 只可减不可增。

**P2 修根因不修症状** — 任何 bug、回归、CI/平台失败、性能/安全问题或审计发现，动生产代码前必须执行 `.agents/skills/root-cause-remediation/SKILL.md`。详细流程住在该 skill；L1 判断闸：分清症状/直接原因/类根因，判断 `one_off`/`recurring`，实扫同类入口，修在最早共享边界。自检：「同类问题还能从另一个调用者、供应商、版本、平台或旧数据回来吗？」答不出"不能" = 没解决。

**P3 全绿 ≠ 完成** — CI 五门只证代码健康，证不了体验对不对。用户可见改动报完成前：① 和获批样张逐项并排对账；② 真体感走查（Playwright 截图人眼判断，不是 expect 断言）。缺一不算完成。**功能交付（尤其用户可见/体感）另过 R16：建几条「真实用户任务」端到端测试系统、带着真实任务跑通整个使用闭环、把过程中冒出的体验/设计/UI/UX/产品感/功能问题全修掉——才算真完成（2026-08-01 用户拍板：不留半成品）。**

**P4 通用第一** — 能力/组件/交互按「模型身份 / 通用场景」设计，与具体供应商/模型解耦。不为不同模型写两套 UI（那是并行版，违反 P1）。档案声明槽，通用系统负责填。

**P5 想清楚再动手** — UI 改动先读设计系统 `docs/design/nomi-design-system.md`（token/组件/规范）再画，再出可视样张（HTML mockup）+ 用户拍板；**改/扩现有 UI 先看它真实样子**（读完整外壳组件或真实截图，样张是真实布局+改动、不是脑补）；**接线前先看真实数据**（实验室组件必须由真实宿主数据驱动＝ShellStage 手法；基线绿≠可接线）；**加/挪控件先过 §1.5 控件层级规则**（L1 常驻/L2–L4·一功能一个家·先分组→去重→归位→最后才收纳）；架构改动先查 Context7 + 读顶尖开源代码 + 6 角色评审；多文件改动先写 `docs/plan` 文档。

## 动手前/报完成前/push 前的三闸

三闸由 `self-check.sh` hook 每轮自动注入，本文件不复述。核心触发：**P5（动手前）**、**P3+R13+R16（报完成前）**、**R11+R22（push 前）**。贯穿：根因不症状(P2)、加新删旧无并行版(P1)、随输入 derive 不 hardcode、分层≤800 行(R9)。细节查 `docs/engineering-rules.md`。

## 每日雷达（每 session 第一条消息自动 · 两条）

**② 供应商模型雷达**：同一时机跑 `pnpm run radar:models`（apimart / kie 有没有上新生图/生视频/音频模型）。确定性脚本，不烧额度；`新增 > 0` 时才起 `nomi-model-radar` 技能做分诊。脚本报错 = 明说「今天没查成」，**不许**说成「没有新模型」。用户点头要接某个 → **先出接入方案**（契约摘要+档案设计+分档理由），点头后才写码。快照要等用户看过再 `-- --update-baseline`。

**① 论文雷达**：收到第一条消息时，比对 `currentDate` 与 `docs/research/` 里最新 `<date>-radar.md` 的日期——今天还没有 → 静默跑 `nomi-research-radar` 技能（额度默认授权），出 `docs/research/<今天>-radar.md`，回答时带出当天最该动的 1-2 件事；今天已有 → 跳过。筛选维度见技能内部（最新·火不火·有没有用·成熟度），低于 bar 的筛掉。

## 规则索引（R# 详解在 `docs/engineering-rules.md`）

| # | 规则 | 一句话 |
|---|---|---|
| R1 | 加新必删旧 | 新替旧必同 commit 删旧；CSS 只可减不可增（R10 = R1 的 CSS 实例）|
| R2 | 用户视角 + 极简 | 每条信息问「有行动价值吗」，没有删；好产品不靠文字解释 |
| R3 | 决策对比表 | 涉及取舍先给用户对比表（方案/用户看到/代价），不单方面开干 |
| R4 | 执行前写文档 | 多文件/多步改动先写 `docs/plan`：范围/不动项/回滚/验收门 |
| R5 | 查官方文档 | 碰第三方库必先 Context7；选型/引入新框架先 Context7+web 查当前最现役框架；接入/改任何模型前必先抓真实官方 API 文档逐项对账；不查就写 = 工作错误 |
| R6 | 近邻开源优先 | 做方案先读与 Nomi 同用户任务+同创作媒介+同交互载体的开源近邻；给出 file:line |
| R7 | 6 角色评审 | 项目方案定稿前：CTO / 设计 / PM / 前端 / 后端 / 真实用户各审一遍 |
| R8 | 先出样张 | 用户可见改动先出 mockup + 用户拍板；实现后必须与样张逐项对账 |
| R9 | 模块化 + 防巨壳 | 写码前想清楚分层；单文件 ≤800 行；白名单巨壳只减不增（R12 = R9 的量化门岗）|
| R10 | → R1 CSS | `src/styles/` 只可减不可增；新样式只写组件 className |
| R11 | 自动 commit/push | 按 R22 选定的验证档通过即自己 commit + push；小修本地收敛后一次推送 |
| R12 | → R9 巨壳 | `check:filesize` 门岗；白名单基线只降不升 |
| R13 | 体验走查 | Playwright 走真实用户旅程 J1-J5（创作目标，不是功能探索）；截图人眼判断 |
| R14 | 周期审计 | ≥25 commit 或发版前：多维 subagent 审计 + 走查 + `docs/audit` 文档；固定含 R14.1「同一语义有几份定义」七维横扫与对偶路径检查，机器门岗只覆盖词表 owner；**R14.2 固定再加三条：依赖框架四列表重跑 + 核心链路真实模型量数字 + 重造清单反向扫** |
| R15 | 可见文字国际化 | 所有用户可见文字必须走 i18n；默认 `zh-CN`，当前仅支持 `zh-CN` / `en`；门禁基线只减不增 |
| R16 | 真实任务测试系统=完成的一部分 | 功能交付（尤其用户可见/体感）必建几条「真实用户任务」端到端测试、带真实任务跑通使用闭环（用 R13 走查法）、把过程中冒出的体验/设计/UI/UX/产品感/功能问题**全修掉**——才算真完成，不留半成品（R16 = P3 完成标准的量化门）|
| R17 | 重活门岗（本地看不出、线上/CI 才炸的一族） | 这族写法做成棘轮：`check:heavy-path`，基线只减不增；**加规则必须先验它会红**（规则清单以脚本 `RULES` 为准，别在文档里数条数）|
| R18 | 测试等待门岗 | 测试禁私有墙钟 waitFor / `Date.now()` 截止轮询（单跑绿、并行翻红一族）：`check:test-waits` 硬零；等编排链用 `waitForProduction` |
| R19 | 解决状态必须可交付 | 侧分支只能称"已实现"；验证通过且提交已进入远端目标分支后才能称"已解决" |
| R20 | 造轮子前先过 build-vs-buy 闸 | 写任何**通用能力**前三问：① 通用问题？② 同类产品怎么做（Context7+web 实查）？③ 在护城河上？不在护城河上又碰钱碰信任的 → 用标准实现；在护城河上的 → 自研到底 |
| R21 | 修复必须走根因流程；可复发/高风险交 v3 合同 | 所有纠正性改动强制走 `root-cause-remediation`；`recurring` 或高风险生产路径提交 schema-v3 `docs/fixes/*.root-cause.json`；`check:root-cause-contracts` 核验；**合同必答「这条不变量归哪层管、那层有没有测试」（`invariant_owner_layer`），同一层 7 天内第三份合同先出结构评审（`check:symptom-cluster`）** |
| R22 | 验证分层与测试预算 | contracts 常跑；unit/desktop/journey/canvas/performance/package 按真实风险独立触发；不删安全/持久化/认证边界覆盖 |
| R23 | React Flow 生成画布单内核与迁移等价 | 生产画布只允许 React Flow 一个交互/变换内核，Zustand 是业务与持久化真相源；迁移必须逐项保留既有几何、交互、视觉和反馈，并用 adapter/结构测试 + 真实 Electron 走查证明 |
| R25 | 提交/推送前 Ponytail 评审 | pre-commit/pre-push 自动调用只读、限时 `/ponytail-review` 适配器；失败或缺少结果 fail-closed |
| R26 | 分层边界不许反向/循环 | 渲染层禁直捅主进程（走 bridge/中立契约层）、主进程禁反向 import 渲染层、禁新增完全静态循环；`check:boundaries` 棘轮（基线只减不增），加规则先验会红（R17）|
| R27 | 多智能体编排手册 | 派工/收货/接力机器化纪律：谁的方案谁实施·验收必跨池、任务书发行权独占+开工三行头、收货三查（behind 数/两点回滚/套件失败 delta=0）、等待用 sleep 轮询+哨兵法（禁 --watch/Monitor/交卷）；**实施派工前先派反方出「先查别人」报告、任务书必须引用它（`check:prior-art`）**。详见 L2 `docs/engineering/agent-orchestration-playbook.md` |
| R28 | 防线建在最早能拦住的那层 | 能让编译器拦的别留给门岗，能让门岗拦的别留给人；安全关键依赖不许「optional + 欠账登记」——登记是备忘录不是防线 |
| R29 | 接框架先出四列表 | 引入/接入任何框架、SDK、运行时**或其新层**前，先在 `docs/research`/`docs/plan` 出「它提供 / 我们用了 / 我们另写了 / 我们拆散了」四列表（每格 file:line 或文档 URL），派工 brief 附表当硬约束；结论进 `check:framework-boundary` 登记表才算研究完成。R20 管「通用能力该不该自研」，R29 管「已选框架的边界画在哪」|
| R30 | Agent 行为验收靠真实模型数字 | 任何 Agent/工具/契约改动，验收门必须含**工具写对率 + 回合成功率**：零额度 loopback 夹具进 CI，小额真实模型定期跑、数字写进 PR；设计实验室基线只证外观、走查截图只证界面，两者都不得单独判「接好了」|

## 决策自治

**P0 默认自主推进到底，不留遗留（2026-06-23 用户要求）。** 遇到问题就自己去解决，完整推进、一杆到底——发现的问题就**全部整完**，不要扫出一堆然后停下来等用户一项项点头。体检/审计扫出的 backlog、自己挖到的 bug、连带的同类隐患，默认**全部自主做完**（A 卫生清理直接做；B/C 类有合理默认的，按「用户决策逻辑 D1-D6」选他会选的那版做掉再报）。**只在「关键决策」才停**：产品方向 / 不可逆取舍 / 架构岔路（多个分歧巨大的合理解）/ 需要用户独有资源 / 样张需求自相矛盾——这些按下面「才问用户」走。完整 > 快：宁可这一轮做满，不要交半成品。每项做完仍守三闸（根因 P2 / 五门 R11 / 真机走查 R13）。

**自己定**（做完一句话说明）：实现细节、命名、模块拆法、测试策略、bug 修复顺序。**评测/测试/验证类的额度花费默认授权**（跑真生成 / 真模型 / VLM / E2E 等）——直接花、不问，事后报花了多少即可。

**才问用户**（AskUserQuestion，合并成一轮，给推荐项）：产品方向/不可逆取舍 / 架构岔路（影响大、多个合理解）/ 需要用户独有资源（API key、真实素材；**额度仅产品级/大额/不可逆花费才问**）。

**遇到样张/需求自相矛盾**：停下上报，不许自己挑一条实现。

## 用户决策逻辑（替他做决策时按这套想 —— 2026-06-20 从真实对话反推）

> 用户做决策有一套稳定的底层逻辑。替他权衡时**按这套排序去想**，别只堆功能/选项。拿不准仍给对比表让他拍（R3），但默认解要长成他会选的样子。

**D1 从用户真实摩擦出发，不从实现出发（outside-in）。** 先问「用户那一刻卡在哪、累不累、要不要学/读/配置」，再想怎么做。**effect-first：直接出效果（如「试跑一次」）> 让他看表单/配置/一堆说明**。任何让用户多读、多配、多学我们格式的东西，默认砍（他原话：「让用户照我们格式手写=离谱」「让他看一大堆=累麻了」）。

**D2 从结构和约束推，不从功能列推（strategy before features）。** 先定位「这东西在价值链/护城河的哪个位置」「我一个人、资源少扛不扛得动」，再谈做什么。**约束就是战略**——「solo」「广度是敌人」是过滤器不是借口；投机的大盘（市场/编辑器/规模战）先砍或延后，招牌只给真差异化、结构上对手抄不动的能力。

**D3 第一性，追到底层「为什么」。** 不接受表面答案，会反复问「为什么 / 更长远」。给方案要给**底层逻辑 + 取舍**，不要罗列；论断要有据（不确定就实查/实跑/读注释与拍板记录，别 bluff）。**任何提议 / 改动 / 「这是问题」必须讲清三件：① 为什么这么做（底层逻辑+现状根据）② 会发生什么（机制后果）③ 用户体验是什么。** 叫某东西是 bug 前，先搞懂现有设计为什么这么写。

**D4 狠的极简 + 诚实交付。** 砍一切不挣命的；缺口/限制**明着标**（如「⚠️ 唇形同步 Nomi 暂无，这段跳过」），不藏不糊弄。

**D5 逻辑清楚就快决、决得干脆。** 他要的是「敢分析、敢反驳、敢下判断」的伙伴，不是附和者；先把球接住给出你的真判断（「你怎么看」就是要你的判断不是复述），他再用一两刀裁。

用法：任何产品/设计/取舍 → 先过 **D1（用户摩擦）+ D2（结构约束）** 定方向，再用 D4 极简裁、诚实交付，全程 D3 第一性、D5 给真判断。

**D6 出方案的表达纪律（2026-06-21 用户要求）。** 每个方案必须让用户**一眼看懂两件事**：①**背后逻辑**——这么做是为了解决「哪个真实摩擦」，用大白话 + 具体例子讲，不堆术语、不罗列功能；出现陌生概念先解释「这是干嘛的、为什么要它」再谈做不做。②**他要权衡的那个核心东西**——一句话点破真正的取舍点，不是甩一堆选项让他自己拼。自检：他读完能不能复述「为什么」和「我在纠结什么」——不能 = 没讲清，重写。

## 工作目录

主仓库：`/Users/aoqimin/Desktop/Nomi/`。操作文件用绝对路径；新建 worktree 放仓库目录**同级**（非嵌套），分支从最新 `origin/main` 创建。

**并行纪律（这台机器常有 20+ worktree）**：① 在独立 sibling worktree 的干净任务分支运行 `pnpm run delivery:preflight` 后再动手，**新 worktree 先 `pnpm install` 装齐提交钩子再 commit/push**；② 不在共享主仓里切分支、commit 或解决任务冲突；③ push 前在任务分支整合最新 `origin/main`，按 R22 验证后只 push 任务分支并创建 PR；④ 不 force-push `main`，不向已存在的远端分支 force-push 重建内容；⑤ **评审/对账/打捞任何分支先算 merge-base**——两点视图里的大片删除多半是「main 前进了」的落后假象；⑥ e2e/测试 hook 放低争用子系统文件。桌面预览、RC 与正式晋级见 `docs/release-process.md`。

---
