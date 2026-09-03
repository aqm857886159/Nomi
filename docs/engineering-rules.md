# Nomi 工程纪律 — 详细规则（L2 · 触发才查）

> 这是 `CLAUDE.md` 的「按需查阅」层。`CLAUDE.md`（always 加载）= 精简核心：项目事实 + P1–P5 + D1–D5 + 规则索引 + 三闸。本文件存**触发某条规则后才查的细节**：R1–R25 详解、工作流框架、技能库映射、固化的工作纪律。
> 真相源仍单一：`CLAUDE.md` 的规则索引指明每条住哪；冲突一律以 `CLAUDE.md` 的 P1–P5 / D1–D5 为准。改触发清单同步 `.claude/hooks/self-check.sh`，规则细节只改本文件。

# 详细规则 R1–R25

> `CLAUDE.md` 的规则索引触发某个编号后，到这里查它的细节。

## R1 加新必删旧（No Parallel Versions）

引入新组件/新流程替代旧的，必须同一 commit 删除被替代的旧代码。

- 不留"逃生口 / Collapse / 备选 fallback"——这些都是借口
- 死代码（grep 不到外部引用）立刻物理删除，不留"以防万一"
- 旧的有点价值 → 把价值合并进新代码，再删旧
- **CSS（R10 = R1 的 CSS 实例）**：新样式一律用 Tailwind utility 写在组件 `className` 上；不用 `@apply`；CSS 文件分工固定只可减不可增
  - `src/theme/nomi-tokens.css` — 设计 token
  - `src/styles/index.css` — 全局 reset/keyframes
  - `src/styles/vendor-overrides.css` — Mantine 等第三方 DOM 覆盖
  - `src/styles/globals.css` — 只准删，不准加组件样式

## R2 用户视角 + 极简

做 UI/文案/卡片设计前，先问：用户进来要看什么？每条信息有行动价值吗？没有 → 删。

**0 权重嫌疑犯**：节点功能描述文字 / 每次出现的 onboarding 文案 / 重复的分组标签 / 长 error stack 灌满卡片（应缩成 ⚠️ + tooltip）/ 双层 border / 永远 80px 的空信息区。

**好产品不靠解释**：优先让东西本身一眼说明该干嘛（图标/形态/位置），把文字降到最少。审视每条文案："删了它，用户还懂吗？"——懂 → 删。

**词汇 = 模型真名，别替用户翻译**：模式/能力标签用模型自己的叫法（vendor 原词，如「全能参考」）为主——用户已熟悉；自创意图词可能把能力说窄。

## R3 决策格式

涉及范围/取舍时，先给用户对比表，再让用户拍板：

```
| 方案 | 用户看到什么 | 代价 |
|---|---|---|
```

不要单方面"我建议 A"然后开干。样张或 plan 内部有两条「拍板」互相冲突 → 停下上报，不许自己挑一条实现。

## R4 执行前必写文档

涉及多文件/多步骤改动，先在 `docs/plan/` 或 `docs/audit/` 写执行文档：
- 范围
- 不动什么
- 回滚策略
- 验收门

写完用户能预读/反驳；执行完回填结果。

## R5 查官方文档（Context7 强制）

凡涉及第三方框架/库（React Flow、AI SDK、Mantine、Electron、Tiptap、Vite…）的实现或改动，动手前必须先用 Context7 查官方文档。

1. `resolve-library-id` 拿库的 Context7 ID
2. `get-library-docs` 拉相关主题官方文档
3. 对照官方推荐 API/模式实现
4. 官方无此能力时才允许自定义，注释写明理由

**不查就写 = 工作错误**。若 Context7 工具未加载，退回 WebFetch 查对应官方站（等价）。

**核对时间点 · 只吃近期（2026-06-21 用户纠）**：搜资料 / 搜开源项目时**必须看发布/更新时间**——AI 半年换一轮，去年的「最新」今年可能已过时。默认加时间过滤（近 6–12 个月）、按时间排序、**每条结论标来源日期**；论断里写「最新/SOTA」前先确认它现在还是不是。别吃老本（连自己上一轮的调研也要意识到会过期，重大判断重查）。

**接入 / 修改任何模型 = 必查真实官方 API 文档，禁凭记忆瞎编（2026-06-30 用户再次要求固化 · 已挂 `model-doc-check.sh` hook）**：接入或修改**任何**模型（新模型、新变体、改参数、改端点、改鉴权），**动手前必须先拿到该模型 / 该 vendor 的真实官方 API 文档**——WebFetch 官方文档站 / vendor 文档门户（如 apimart `docs.apimart.ai`、kie `docs.kie.ai`、即梦官方、火山引擎、ModelScope）/ Context7。照文档**逐项对账**：① 端点路径 + HTTP 方法；② 鉴权方式（bearer / header 名 / OAuth / CLI 登录态）；③ 全部变体（fast/face/lite/quality…）；④ 全部生成模式（t2v/i2v/首尾帧/参考…）；⑤ 全部参数（名字、类型、合法枚举值、默认值、上下限）。**禁止凭记忆或凭印象瞎编**端点、参数名、枚举、模式组合——「记得大概是这样」「应该是这个字段」= 工作错误，必须实查文档原文。这条**每次都要控制住**，不是接一次就免检：每次碰模型接入文件（`electron/catalog/*Vendor.ts` / `*Images.ts` / `*Videos.ts` / `*Texts.ts` / `*Audios.ts` / `*Codec.ts` / `kie*.ts` 等）hook 都会顶提醒。流程固定：抓全官方文档 → 列 {变体×模式×参数} 全表 → 对账现有 catalog/archetype → 补齐/修正缺口 → 真实生成 E2E 验一条（见「固化的工作纪律」接入即验证 + [[model-onboarding-must-cover-full-api-doc]] 记忆）。用户原话：「都要去真实的查到官方文档才去接入，而不是自己去瞎编」。

**实查对象必须是「现役」不是「本机」（2026-09-01 用户抓错后固化）**：判断第三方 CLI / SDK / 模型「支不支持某能力」时，**本机已装版本的 `-h` / 实际行为不算实查**——那是安装那天的旧事实。实翻车：拿本机 2026-06-18 的 dreamina CLI build 断言「CLI 给不了 seedance2.5 / 图片5pro」，被用户甩官方文档当场纠正——官方 v1.4.15（08-01）视频全线已支持 2.5、v1.4.16（08-14）已有 seedream 5.0 pro。正确姿势：先读**官方现役文档 / 更新日志**，或先把工具升到最新版再取证；写下「不支持 X」前自问「我看的是最新版吗」。另注意第三方 CLI 有自己的破坏性变更节奏（dreamina v1.4.14 起图片必填 `--resolution_type`、视频必填 `--video_resolution`）——接入停在旧面貌可能不止缺模型，是**发不出合法请求**。

**模型 wire 契约三段标准作业（2026-09-01 用户定稿 · 2026-09-02 封印粒度升级 · 已刻进 `model-doc-check.sh` hook）**：修任何模型问题、接任何新模型，花费结构固定为「文档给依据、零额度给覆盖、付费给封印」，三段齐了才叫修完：

- **一 · 文档给依据**：抓该 vendor/模型**真实官方现役文档**逐字段对账 {变体×模式×参数}，出处 URL+checkedAt+关键句落库。报错信息只是线索不是依据（栽过：按报错倒推出的值「能跑」，实为隔壁型号的枚举——探测能过≠用对了）。文档与实测冲突以实测为准并在代码注明日期与证据（fal 队列根路径、KIE 响应字段都是文档印错实测纠正的案例）。
- **二 · 零额度给覆盖**：测试大头零花费做全——合同测试锁非法组合 + **请求构造干跑逐字段比对文档**（本地假服务器不校验格式，干跑对账才抓得住漂移）+ 免费探针（鉴权/列表端点、非 200 校验类）。**全部模式无一漏过**，含参考图/首尾帧/参考视频模式。
- **三 · 付费给封印**：前两段全绿后，**每个模型**（不是族代表——族代表只是过程降险顺序，不是终态）一发最小参数真实生成。**封印发选覆盖面最大的模式：带参考输入的模式优先**（参考模式 wire 是纯文模式超集，一发管两头）。产物下载后亲眼**双验：提示词特征 + 参考特征**（喂特征强参考图如红色机器人，产物没出现该特征 = 参考没传到，HTTP 200 也不算通）。封印绑定 wire 契约版本，wire 变更/矩阵漂移才重封；多模式模型其余模式：wire 形态与已封模式差异大（另端点/另编码）才补发，仅多一字段且干跑+免费探针对账通过的记「结构已验」。台账列：模型 × 封印模式 × mapping 内容哈希 × 日期 × 产物路径 × 单笔花销（追加进当期验收矩阵文档）。余额不足 → 诚实记 ⛔ + 精确差额，不瞎重试。

**出处必须可追、接入必须一次接完（2026-08-12 用户要求固化 · 已挂门岗 `pnpm run check:archetype-sources`）**：
上面那条「必查官方文档逐项对账」**早就存在、还挂着 hook，仍然失效了**——2026-08-12 复核 Seedance 2.5 档案，
参考图/视频/音频上限写的是 9/3/3、比例默认 16:9，而 kie 与 apimart 官方文档都是 30/10/10、默认 adaptive：
**四个数没一个来自文档**，而文件头注释白纸黑字写着「契约逐项对账自 kie 官方文档」。

**根因不是「填错了」，是「声称对过」与「真的对过」之间没有任何验证手段。** 注释是自由文本，
写什么都行、没人能反证。所以这条规则的执行层必须是结构化数据 + 门岗，不能再是一句叮嘱：

- **G1 出处落库不落注释** —— 档案必须声明 `sources: [{ url, checkedAt, vendorKey, covers }]`
  （`ModelArchetype.sources`）。官方文档地址，不是第三方转述（转述会漏会错：Runware 转述里就没有
  apimart 那条「首尾帧模式 size 必须 adaptive」的硬约束）。地址簿索引见 `docs/integrations/provider-api-docs.md`。
- **G2 一次接完，不做「先接个能跑的」** —— 接入 = 把该模型在该供应商下的**全部**能力对完：
  端点/鉴权、**每条参考通道的字段名与上限**、首尾帧怎么表达、标量参数枚举与默认、模式互斥、
  供应商级硬约束、轮询与状态词表、产物在响应里的确切路径、计费口径。清单见上述地址簿文件。
  **没查到的写「文档未写明」，不许填我们猜的**——猜的数字比缺失更坏，缺失会被发现，猜的会被当成真的。
- **G3 数字必须能追到出处** —— 改任何契约数字（上限/枚举/默认值）必须同步该条 `sources.checkedAt`。

门岗棘轮：存量 40 个未登记档案进白名单、**只减不增**，补一个删一行（补了却不删白名单也报错，防永久豁免）。
为什么不做「checkedAt 超期红灯」：文档不常变，超期红灯会变成噪音、被习惯性跳过——
**被习惯性忽略的门岗等于不存在**。复核由改动驱动，不由日历驱动。

**选型 / 引入新框架时实查最新现役框架（2026-06-21 用户要求 · 已挂 hook）**：每次出方案**可能引入新框架 / 新技术栈元素**（agent 框架、eval 框架、状态库、构建工具…）时，**动手前必须 Context7 + web 实查当前最核心、最现役的框架与技术栈**——不准凭记忆判断某框架的能力、新旧、是否已被取代。栽过（本会话）：凭记忆把 Mastra（现役 TS agent 框架）当「并行版」一刀切挡回，实查后改口它正好对口 eval/编排层。流程：① 列出方案要引入的框架/技术点 → ② 逐个 `resolve-library-id` + `query-docs` 拉最新文档（含版本/发布日期）→ ③ web 扫一眼有无更对路的现役框架 → ④ 给用户对比表（R3）。**已挂 PreToolUse hook（写 `docs/plan/*.md` 或动 `package.json` 时顶提醒）+ self-check.sh 闸① 每轮提醒**——别等想起来。

## R6 近邻开源优先，读真实代码

做任何项目方案前，先建立对标候选池，**按与 Nomi 的任务距离排序，不按名气、资料丰富度或单个控件的精致程度排序**：

1. **开源近邻优先**：目标用户、要完成的创作任务、处理的媒介、主要交互载体中至少三项相同。例如研究 Nomi 的 Agent 画布，先看开源 AI 创作画布、视觉编辑器和音视频工作台，不能先拿通用代码 Agent 代替。
2. **闭源直接竞品补产品上限**：当开源近邻没有覆盖某段完整体验，再读直接竞品的官方文档、真实界面或官方演示。它能证明产品选择，不能证明内部实现。
3. **跨领域类比只补原语**：Cursor、Cline、Claude Code 等只可补权限、引用、队列等仍未覆盖的交互原语，不能单独支撑 Nomi 整体创作流程的结论。

候选筛选先写清 `同用户任务 / 同媒介 / 同载体 / 开源可读` 四项，找不到近邻时记录实际检索过的方向并明确说没有，不得静默降级成通用案例。研究结论按来源标出：**它能证明什么、不能证明什么**；避免把开源 demo 当成熟产品，也避免把闭源界面猜成实现事实。

入选的开源项目必须读真实代码（不是只扫 README），产出：
- 它们怎么做的（具体到固定版本的文件/代码位置）
- 我们能直接借鉴什么
- 哪里不适用、为什么
- 该项目覆盖的是完整用户旅程，还是仅一个局部原语

参考池（非穷尽，按专题选，别拿这串当唯一清单——做某专题就去查那个专题真正的顶尖项目）：
- coding agent / 通用：Cline / OpenHands / Aider / Continue / Cherry Studio / LobeChat
- 画布向：tldraw / ComfyUI / xyflow
- **记忆/上下文专题**：Mem0 / Letta（MemGPT）/ Zep（Graphiti，双时间知识图谱）/ Anthropic memory tool / Cline Memory Bank / 学术（Generative Agents 反思·A-Mem·MIRIX）；创作域：SillyTavern lorebook / Novelcrafter Codex（结构化设定卡+三态挂载）/ Sudowrite·NovelAI story bible。完整调研见 `docs/plan/2026-06-20-memory-system-redesign.md`。

## R7 6 角色评审

**触发条件**：任何涉及架构/取舍/UX 的项目方案，在给用户拍板前。

并行审查 6 个角色：
1. **CTO** — 架构合理性、技术债、扩展性、与现有内核是否冲突
2. **设计师** — 视觉一致性、对齐 `Design.md`、密度优先
3. **产品经理** — 用户价值、范围是否过大、是否解决真痛点
4. **前端** — 可行性、状态管理、性能、组件复用
5. **后端** — runtime/数据/IPC/持久化影响
6. **真实用户** — 用起来顺不顺、爽不爽、看着舒不舒服

流程：研究开源（R6）→ 起草方案 → 6 角色并行审查 → 汇总修方案 → 对比表（R3）给用户拍板。

## R8 先出可视样张

**触发条件**：任何用户会看到的东西（界面/卡片/节点/面板/交互/文案排版）。

**铁律（实现前必须走完）**：
0. **先看这个 UI 真实当前长什么样（改/扩现有界面尤其必做）**：读**完整渲染外壳组件**（整个 `Base*`/`*Shell`，不是某个 body 片段），或看 `docs/design/app-screenshots-*` / `docs/ui-designs/` 真实截图。**样张 = 真实布局 + 你的改动**——是对现状的忠实 diff，不准从零散组件片段在脑子里拼整体排版。栽过（2026-06-27）：3D 节点样张连画三版都错位，根因=没看真实「生成节点」布局（**上工具条 / 中预览 / 下提示词 composer**）就脑补，连底部整个提示词区都漏掉——和「凭记忆讲框架」同一类错（拿部分当全貌、脑补代替观察）。
1. **先读完整设计系统 `docs/design/nomi-design-system.md`**（§2 token 全表 / §3 通用组件 / 规范）+ `src/design/` 现有组件——文档原话"做任何新设计前请先读完整版"；token-only（**禁非 token 的 px/hex/圆角**，如 `h-[34px]`/`text-[12.5px]`/`gap-2.5` 都违规，用 `h-8`/`text-[13px]`/`gap-2`），不凭空造组件。**样张/UI 里出现 Nomi 品牌就用真品牌**：字标用 `NomiWordmark`「No·m·i」（中间 m = accent 色 + Fraunces，§3.9）、标记用 `NomiLogoMark`、配色用设计 token——**别拿通用 logo / 羽毛 / 火花图标冒充 Nomi**（2026-06-20 用户纠：样张要带我们自己的 logo 和设计，不要泛用占位）
2. **出可体验样张，不只是静态图**：凡涉及交互（可拖/可点/可调/有状态切换的东西），样张必须做成**用户能亲手拖、点、调**的可交互 widget（首选 `mcp__visualize__show_widget`，把交互逻辑真写进去），让用户上手感受真实手感后再拍板——静态截图说不清"拖起来顺不顺"。纯静态排版（文案/卡片布局）才允许静态 mockup。**默认给可体验的，别等用户开口要。**
3. 设计师 Agent + 真实用户 Agent 审一遍（R7）
4. 用户本人确认后才进入实现
5. **实现后必须与获批样张逐项对账**：截图并排比，列出每一处差异；差异当场补齐或说明暂缓原因 → 样张是验收合同，不是参考图

**设计交付要配齐参考文档**：样张只是「理想态快照」，必须同时交付：① 设计系统 token/组件 ② Context7 库官方文档（R5）③ 数据/代码现状（先 Explore 摸底）④ 实现规范（精确 token + DOM 结构 + 状态 + 数据绑定）。缺参考 = 凭空设计 = 实现卡死/跑偏。

**出「用户路径图」，别让用户靠文字想象功能在哪（2026-06-20 用户纠）**：任何新功能/新对象（卡片/面板/能力），讲它「在用户旅程的哪一步出现、在界面哪几处露出、怎么被用到」时，**默认出一张可视路径图（show_widget / SVG）**——按真实产品布局（项目库→创作→生成画布→时间轴→导出）把触点钉在图上，**别用大段文字让用户在脑子里拼**（用户原话：「我还是不够理解…要去出整个路径图，而不是要我靠文字去想」）。路径图铁律：① 钉到真实界面位置（哪个面板/侧边栏/节点面），不抽象；② **每个触点标当前真实状态（通/半通/断）**，状态必须先 Explore 核实当前代码、不拿旧记忆当现状（栽过：拿 7 天前审计当现状被用户当场点破「可能已经改了呢」）；③ 诞生点 vs 消费点分清。**用户可见功能交付/答疑两个时机都适用：方案期画「将来长这样」，答疑期画「现在到哪了」。**

**设计落地 = 规范驱动 + computed style 核对**：改设计前先写/读实现规范；改完跑 `tests/ux/design-fidelity.e2e.mjs`（它把规范写成 computed-style/DOM 结构断言，能抓 twMerge 吞字号 / Mantine 吃样式等隐藏覆盖）；加自定义 Tailwind token 务必同步进 `cn()` 的 `extendTailwindMerge`。

## R9 模块化 + 防巨壳

写码前先想清楚：

- 这块逻辑该放哪一层？（UI / 状态 / 领域逻辑 / runtime / 持久化——别混一个文件）
- 关注点分离了吗？渲染归渲染、状态归 store、领域逻辑归领域层
- 新东西和现有内核的边界在哪？会不会引入第二份真相源（→ R1）

架构决策过：Context7 查官方推荐架构（R5）→ 读顶尖开源分层（R6）→ CTO+前端+后端三角讨论（R7 子集）→ 有取舍出对比表（R3）。

**R12 = R9 的量化门岗**：
- 单个非测试 `.ts`/`.tsx` 文件硬上限 800 行
- 现存巨壳列白名单并记录基线行数，棘轮只减不增
- 门岗命令：`pnpm run check:filesize`（已接入 CI）

## R10 → 见 R1（CSS 实例）

CSS 文件分工与「只可减不可增」规则详见 R1 最后一节。

## R11 自动 commit + push

完成一个有意义的、验证通过的改动就自己 commit + push，不用等用户催。

**开始闸**：在独立 sibling worktree 的任务分支先运行 `pnpm run delivery:preflight`。它只做一次有超时的非交互 fetch，并拒绝受保护分支、脏工作树和未包含最新远端基线的任务分支；失败后不自动重试、不用 REST API 重建 Git 对象。

**验证门槛**：按 R22 的共享 policy 选择受影响风险面。contracts 始终运行；unit 可 focused/full，Electron、journey、canvas、performance 与 package 各自独立触发。连续小修先在本地收敛，定向验证通过后只 push 一次，禁止每修一个微小点就触发一轮完整远端 CI。

**commit 规范**：
- 一个逻辑改动一个 commit
- Message：做了什么 + 为什么 + 验证结果，中文风格，结尾按 harness 要求挂 `Co-Authored-By:` 行
- 只 `git add` 本次改动文件，不用 `-A`

**例外（先问再 push）**：改动未验证 / 破坏性操作（删历史/force push/发版 tag）/ 用户说先别提交 / 混入多个不相关改动。

## R12 → 见 R9（量化门岗）

白名单巨壳基线与 check:filesize 详见 R9 最后一节。

## R13 穿透式体验走查

**定义**：Playwright `_electron` 驱动真实 app，按真实用户旅程逐步截图，以真实用户视角判断顺不顺、美不美——这是体验穿透，不是功能 pass/fail。

**触发条件（任一）**：
- 用户可见改动报完成前
- **把任何可运行/可看的东西交付给用户前（开实例「给你看」、发截图、发链接）——交付=报完成，同一道闸**
- 整条功能链路实现完成时
- 用户提出「用不顺 / 看不懂」反馈时
- 重构/重大改动后确认主链路未拆坏
- ≥25 commit 或发版前（配合 R14）

### 眼见链（2026-07-12 固化：走查有效性的四问，缺一环 = 没走查）

走查的本质是**证据链从改动一路连到我的眼睛**，四问逐环校验：

1. **截图存在吗** —— 跑了走查脚本、产出了截图文件；
2. **我 Read 过吗** —— 截图必须被亲眼 Read 消费。**产出验证物 ≠ 消费验证物**（栽过：shell3 截图躺在盘里没看，就把沙盒递给用户，用户当场抓到「和原来一样」）；
3. **它来自用户所见物吗** —— 同构建（非 stale chunk/僵尸实例）、同入口（生产构建非 dev）、**同平台分支**（mac `NomiAppBar` ≠ win32 windowbar ≠ 项目库页，平台/条件分叉的 UI 改哪面就必须验哪面，全仓 `isWindows` 类分叉先 grep 清点）；
4. **它拍得到改动区吗** —— 截图手段对改动区不是盲区（栽过：`BrowserWindow.capturePage` 拍不到子 view；打开态/弹层要逐个打开拍）。

历史同类事故（这条规则的由来，均为「链在最后一跳断裂」）：素材盒修在 win32 分支 mac 没生效+截图没看就交付（07-12）；样张凭脑补不基于真实 UI（v07，×3）；gates 全绿但生产构建无样式（dev≠prod）；走查跑在 stale chunk/僵尸实例上；capturePage 拍不到捕捞子 view。机械闸：Stop hook `completion-check.sh` 已升级为**查眼不查嘴**——改了 src/electron 又宣布完成/交付时，近窗口内必须有图片 Read 痕迹，否则 block。

### 走查三升级（2026-09-02 用户拳单复盘固化：QA 全绿他一上手仍抓一把问题的根因补丁）

用户亲测抓出的问题（反馈中心不在样张位置、假 key 假成功、EN 残留、截断、logo 不齐）没有一个是当时断言体系能拦的——三个结构缺口，走查从此必须带上：

1. **位置断言**：对照获批样张断言控件的**位置/归属**（在哪个 tab、哪个分组、什么层级），不只断言「存在」。存在性断言放过了「反馈中心跑出设置页」这类错位。
2. **双语对照真截图**：zh 与 en 两轨都跑、都出真截图、都亲眼 Read。regex 网（raw-key/EN-DOM 零 CJK）拦得住残留，拦不住**几何**——EN 串比中文长 1.5-2 倍，按中文定宽的容器只有眼睛能看出截断（栽过：库入口卡标题、时间轴轨道名、vendor 英文名，全是眼睛抓的）。
3. **真人乱输路径**：照用户真实使用方式砸——瞎写的 API key（必须诚实报错不许假成功）、空态、点关不掉的弹层、断供应商。走查只走 happy path = 用户第一次乱点就穿帮。

### 旅程构建铁律

**走查旅程必须是真实创作目标，每条要有「任务成功标准」。**

| 错误示范（功能探索）| 正确示范（创作目标）|
|---|---|
| 「查看生成配置面板」 | 「为商品图选好模型，准备生成」|
| 「探索 AI 面板」 | 「用 AI 把故事稿拆成镜头」|
| 「添加新节点」 | 「在画布上补加一个空镜头，填好提示词」|

构建格式：`我有 [输入]，我想得到 [输出]，成功标准是 [可验证的结果]`

### Nomi 5 条标准核心旅程（J1-J5）

| # | 旅程名称 | 输入 | 成功标准 |
|---|---|---|---|
| J1 | **产品宣传视频（主链路）** | 产品文案（可用示例项目）| 文案 → 拆镜头 → 画布节点排布 → 每个镜头选好模型配好参数 → 「可以生成了」|
| J2 | **故事 → 漫画短片（定妆链路）** | 漫画剧本 | 写剧本 → 拆镜头 → 定妆建角色/场景卡 → 角色卡有提示词 → 「可以批量生成了」|
| J3 | **新用户 30 秒上手** | 无（冷启动）| 首页点「30 秒体验」→ 自动创建项目 → 画布展开 → 能说出「这些格子是什么」→ 能点开一个节点看参数 |
| J4 | **参考图驱动生成** | 几张素材图 | 上传图片 → 图出现在素材库/画布 → 作为节点参考图挂好 → 「参数配好，可以生成了」|
| J5 | **修改旧节点并导出** | 已有项目（示例项目即可）| 打开项目 → 找到节点 → 修改 prompt → 知道怎么重新生成 → 进入导出面板 → 知道怎么导出 |

每条旅程走查时问：① 新用户不看文档能走通吗？卡在哪？ ② 每步美吗、顺吗？ ③ 每步到下一步的过渡自然吗？

**发布前必须全部过一遍。**

### 工具栈

- **`tests/ux/ui-driver.mjs` + `tests/ux/ui.mjs` — 常驻交互式驱动（交互探索/调 UI 首选，开一次·边看边点）**：
  后台起 `node tests/ux/ui-driver.mjs`（Bash `run_in_background:true`；**app 启动一次保持开着，不再每步 launch→close 闪屏**），
  就绪后逐步发命令 `node tests/ux/ui.mjs <action>`：
  `snap`（列当前所有可点元素：标签/文字/aria/中心坐标——**据此决定点哪，不靠提前盲猜选择器**）｜
  `shot [名]`（截图到 `tests/ux/shots/<名>.png`，再用 Read 看）｜`click "文字"`（也支持 `aria:` / `css:` / `text:` / `xy:x,y`）｜
  `fill <css> <值>`｜`eval <js>`｜`wait <ms>`｜`quit`（关 app+停驱动）。
  **循环 = snap/shot 看真实界面 → 判断 → click/fill 操作 → 再 shot 看结果**（感知→决策→行动→再感知）。
  Electron 专用（Nomi 要主进程+IPC，普通浏览器预览工具附不上去）。用完务必 `quit`，别留后台进程/窗口。
- `tests/ux/walkthrough.mjs` — 一次性探索式走查（逐步截图 + DOM dump）；**新工作优先用上面的常驻驱动**，盲脚本只在固定流程时用
- **僵尸 Electron 防线（2026-07-12 栽过：迭代 12 轮一次性 walk + close 挂死 → 桌面十几个僵尸）**：
  ① 探索/调试迭代必用常驻驱动（一个实例改一轮测一轮），一次性 walk 只跑最终验证的一两遍；
  ② 一次性 walk 的 finally 必须「`app.close()` 竞速 8s → 超时 SIGKILL `app.process()`」——外层 shell `timeout` 只杀 node、会孤儿整棵 Electron 树，不算兜底；
  ③ 迭代结束顺手 `pnpm run kill:zombies`（按本仓 node_modules 路径精确清，不碰正装/他仓）。
- `tests/ux/smoke.e2e.mjs`（`pnpm run test:e2e`）— 可断言冒烟，失败即非零退出，CI-ready

**「特别完整的用户测试」标准方法（定稿）**：不引入外部工具——**自主点击的「computer-use 智能体」就是 AI 本身**，驱动层用上面的常驻驱动。标准动作：① 清场（`osascript -e 'quit app "Nomi"'` 关已装 app 释放 single-instance 锁 + 杀残留 Electron/驱动）→ ② `pnpm build` 全新构建（防 stale-chunk 伪 bug）→ ③ 起常驻驱动 → ④ 逐旅程走 J1–J5（snap→判断→click/fill/setfile→shot+Read 人眼判断）→ ⑤ 逐个打开交互态看遮挡 → ⑥ Explore agent 挖根因到 file:line、分症状/根因/地基 → ⑦ 落 `docs/audit`（问题分级 + 局部/地基拆分）→ ⑧ `quit`。完整方法 + 外部工具调研：`docs/workflow/2026-06-10-autonomous-ui-test-method.md`。
**外部工具结论**：Midscene.js 等是最方便的外部自主探索器（支持 Electron CDP/desktop），但需 vision-model 额度（用户资源、要拍板）且不比现有 DOM 感知驱动更准——**常规续用现驱动**，无人值守批量爬再评估接入。

能力边界：渲染层交互 + 感知判断（~90%）用 Playwright 完全覆盖；原生 OS 边界（系统文件对话框/Finder 拖拽）可经 `electronApp.evaluate` stub `dialog.*` 走通。

### UI 有「打开/交互态」的额外要求

任何有打开态的 UI（弹层/面板/菜单/下拉/picker/modal），交付前必须：
1. 真机逐个打开每一个交互态截图，以真实用户视角看「能不能看全 / 会不会被挡」
2. 几何实测：`getBoundingClientRect` 对照祖先 overflow 容器 + 视口，确认不被裁、不溢出、不重叠（含节点在画布边缘等极端位置）；弹层默认放不裁剪层（BodyPortal / 外层锚，仿 `SettingsPopover`），带向上翻转 + 视口 clamp
3. 把上述结果落成可复跑回归断言（`tests/ux/design-fidelity.e2e.mjs`）

## R14 周期性多维审计

**触发条件（任一）**：距上次 `docs/audit/` 审计文档 ≥25 个 main commit（`pnpm run check:audit` 提醒）/ 发布新 minor 版本前 / 巨壳逼近上限 / lint warning 基线明显上涨。

**执行**：
1. 多维 subagent 深审真实代码（R7 6 角色 + 技术栈/架构/测试/产品多维度）
2. Playwright 走查（R13）
3. 做 R14.1「同一语义有几份定义」横扫
4. 落 `docs/audit/<date>-*.md`：现状 + 分级问题（带 file:line）+ 立即/中期/长期路线
5. 清掉 P0，方案级取舍留用户拍板（R3）；关键论断亲自实跑核实

### R14.1 固定维度：同一语义有几份定义

**为什么单列**：重复实现通常不是因为开发者明知第一套还硬造第二套，而是写新代码时根本没有检索到第一套。这是检索失败，单靠 P1「加新必删旧」拦不住。任何 PR 只要新增或修改下表中的合同，动手前就先用 `rg` 横扫两端/多入口的现有 owner，评审时把复用点或确需独立的理由写清楚；周期审计再全仓复盘一次。

**机器能守的部分**：`pnpm run check:vocabularies` 已进入 `gates`。它用 TypeScript AST 扫 `src/`、`electron/` 的 TS/TSX/MTS/CTS，识别字符串 union、`z.enum([...])`、`as const` 数组和 `Set([...])`。每套词表按稳定的「文件 + 声明路径」登记 owner；第二个完全相同 owner、新增词表、成员漂移、owner 移位、陈旧 baseline、空/TODO reason 或 debt 超上限都会红。baseline 两桶：

- `registered`：确实是独立领域合同，reason 必须说明为什么不能复用。
- `debt`：已知重复/待收敛 owner；`debtCap` 只减不增，等量换一个 owner 也不算减少。
- `converged`：收敛 provenance；每条记录用 `retiredOwners` 明列已退役 owner、用 `survivingOwner` 明列 surviving owner。门岗会对 live scan 验证前者全部消失、后者仍存在且有 substantive `registered` entry，并对 reference baseline 验证每个 retired owner 确实在册且成员集与 surviving owner 一致；只有这样的记录能解释历史 `historical-debt-promoted`，不能绕过 `debtCap` 或 `historical-cap-not-tight`。

`--update-baseline` 只生成带 `TODO` 的待解释条目，写完仍然红；它是检索助手，不是自动放行按钮。

**机器查不到、每次计划/评审与周期审计必须人工横扫的七维**：

| 维度 | 必问的问题 | 典型风险 |
|---|---|---|
| 工具面 | 同一个操作，内嵌 Agent / MCP / 其它入口各叫什么、是否走同一 executor？ | `nomi_add_nodes` 与 `create_canvas_nodes` 同事两名 |
| 可见性/过滤口径 | 同一批能力，多个消费方是否各写了一套过滤？ | list 过滤了，read 仍能绕过 |
| 标识符 | 同一个对象只有一个主键吗？ | `directoryName` 与 `skillKey` 撞运气匹配 |
| 格式契约 | 是否自造了生态已有的信封/协议？ | 私有 manifest 与标准 `SKILL.md` 并存 |
| 字段取值来源 | 同一个展示/业务字段是否只有一条取值链？ | store 算对了，IPC 又从另一来源重算 |
| 确认/权限面 | 「要不要放行」是否只有一个真相源？ | MCP policy 与内部 gate 各判一遍 |
| 规则的路径覆盖 | 规则的每条对偶路径都落到了吗？ | 只挡展示层，不挡真实数据入口 |

#### R14.1.a 最难查的一族：只做了一半，而做完的半边看起来很完整

审查任何规则、字段或能力时都必须再问一句：

> 它的对偶路径是什么？那条路径上也使用同一个 owner 吗？

- 加了「列」的过滤 → 「读」是否复用同一判定？
- 加了「写」的校验 → 「改/删」是否复用同一判定？
- 加了「导入」的合同 → 「导出」是否同构？
- 加了内部工具 → 外部 MCP 是否投影同一能力定义与 executor？

这类缺口不一定有第二份代码，静态词表门岗无法发现；所以不能因为 `check:vocabularies` 绿，就跳过七维 owner 审计和对偶路径走查。

## R15 可见文字国际化

**范围**：所有用户能看到或辅助技术能读到的产品文字，包括正文、按钮、菜单项、标签、占位符、`title`、`aria-label`、toast、确认框、空态、加载态与错误态。

**铁律**：

1. 新增或修改可见文字必须放入 `src/i18n/resources.ts`，组件使用 `useTranslation()`，非 React/类组件使用共享 `i18n.t()`；禁止在产品代码里新增硬编码中文或英文 UI 文案。
2. 默认语言固定为 `zh-CN`，当前仅支持 `zh-CN` 与 `en`；不根据操作系统语言自动切换。用户选择持久化，并同步 `document.documentElement.lang`。
3. 两种语言必须在同一个改动中补齐，同名 key 保持结构一致；插值使用命名参数，不拼接可翻译句子。
4. 不翻译用户内容、模型原始输出、AI/系统提示词、协议字段、事件名、模型/供应商官方名称、文件路径和日志诊断信息。
5. `pnpm run check:i18n` 是零遗留门岗：扫描 JSX、常见可见对象字段和 Electron 原生界面，发现用户可见字面量即失败。协议、提示词和稳定元数据只能使用脚本内带原因的窄豁免，不允许用基线接受国际化债务。
6. **键引用解析门岗** `check:i18n-key-refs`（`scripts/check-i18n-key-refs.ts`，已挂进 `check:i18n` 链）：静态提取 `src/` 全部翻译引用（`t('...')` / `i18n.t('...')` / `'i18n:...'` chunk 标签字面量），逐个对照 `resources.ts` 的**真实合并键树**验证可解析；解析不到 = 红，输出 file:line。补的是 parity/可见硬零/tsc **三道都漏**的洞——组件引用了一个**两边词典都没有**的键时，i18next 会把 key 字符串本身渲染到界面（`sidebar.workflows` 长得像英文、中文界面里一眼看不出），而 parity 查的是 zh↔en 对称、两边同缺恰是平衡，tsc 对未知点分键回落 `string` 不报错。模板拼接的**动态键**走脚本内 `DYNAMIC_KEY_PREFIXES` 显式前缀注册表（每条写明「为什么动态 + 枚举来源」；`concat` 形态枚举后缀逐个验叶子），裸动态键/失效注册 = 红。运行时另有 `tests/ux/_assert.mjs` 的 `expectNoRawI18nKeysInDom`（raw-key 网，zh+en 都跑）从界面这头兜底。

**验收**：涉及界面文案的改动必须在 `zh-CN` 与 `en` 各走查一次，并验证刷新后语言保持。全 App 双语真机扫查见 `tests/ux/i18n-sweep.walk.mjs`（逐面 raw-key + EN-DOM CJK 断言，截图存 `tests/ux/shots/i18n-sweep/{zh-CN,en}/`）。

---

## R16 真实用户任务测试系统 = 完成的一部分

> 2026-08-01 用户拍板固化。**R16 是 P3「全绿≠完成」的量化门**：功能类交付，光有单测/五门绿、甚至跑一次 R13 走查，都不算真完成——必须建起「真实用户任务」的端到端测试系统、带真实任务把整个使用闭环跑通、把过程中冒出的问题全修掉，才算完毕、不留半成品。

**为什么**：五门只证代码健康；一次性走查只证「这一条路当时能走」。**一个功能真正好不好用、闭不闭环、体感对不对，只有拿真实任务从头走到尾才暴露**——多数体验/设计/UI/UX/产品感/功能问题不在单测里，在「用户真的想干成一件事」的完整流程里。所以交付的一部分，是把这套「真实任务测试」建成可复跑的系统，并跑到干净。

**怎么做（做一件功能，收尾必走）**：

1. **建测试系统，不是跑一次**：为这次功能设计**几条**（≥2-3 条，覆盖主路径 + 边界/降级）「真实用户任务」场景——是**创作目标**（如「给一段剧本，出一份能播的初稿」「把某镜套上迪金斯打光重生成」「外部 Claude/WorkBuddy 驱动 Nomi 出初稿」），不是功能探索（点点看每个按钮）。参照 R13 的旅程构建铁律与 J1-J5。把这些场景**固化成可复跑的脚本/清单**（存进 `evals/` 或 e2e），不是一次性手点。
2. **带真实任务跑通闭环**：用 R13 走查法（Playwright + 眼见链截图，真机/真构建/真入口）把每条场景**从起点走到用户真正拿到结果**——闭环 = 用户那件事真办成了（真出了初稿、真改对了那一镜），不是「中间某步没报错」。
3. **过程中主动挑问题**：跑的时候戴产品/设计/用户三顶帽子，专门找——**体验问题**（卡顿/多余步骤/看不懂）、**设计问题**（信息层级/入口）、**UI 问题**（越界/错位/暗色不可读）、**UX 问题**（流程绕/反直觉/无反馈）、**产品感问题**（这功能到底解不解决摩擦、值不值得存在）、**功能问题**（做错/漏做/边界崩）。
4. **全修掉，不挑拣**：发现的问题**全部**按 P2 根因修完（不是记 backlog 甩给用户）；只有「关键决策」类（产品方向/不可逆取舍）才按决策自治停下问。修完**重跑**测试系统直到闭环干净。
5. **才算完成**：以上跑到干净，才能报「真完成」。半成品、留尾、「还剩 N 项」都不算。

**与其它规则的关系**：R16 用 R13 的走查方法 + P3 的样张对账，但把标准拔高成「**多条真实任务测试系统 + 闭环 + 修全发现的问题**」；与 R14（周期审计）区别 = R14 是攒够 commit/发版前的定期体检，R16 是**每个功能交付自带**的完成门。

**适用范围**：功能类交付（尤其用户可见 / 体感功能）必走；纯内部重构 / 文案 / 脚本类改动按 P3 常规走查即可，不强求建多条任务测试系统。

## 工作流框架（阶段 × agent 编排）

> 核心三原则：① 独立工作并行、共享文件顺序；② 评审/验证用对抗式多视角（让 agent 挑毛病）；③ UI 收尾必过真实用户体验 agent。范围按事情大小缩放：小改省略中间阶段，项目级大改全走。

| 阶段 | 防的根因 | 用什么 | 过门标志 |
|---|---|---|---|
| 0 调研 | 凭记忆手搓 | Context7（R5）+ 顶尖开源代码（R6）+ Explore agent 摸现状 | 现状盘点（带 file:line）|
| 1 设计/方案 | 想清楚再动手 | 实现规范（HTML 长相 + 精确 token/结构/状态/数据）；架构拉 CTO+前端+后端（R9）| 实现规范文档（R4）|
| 2 方案评审 | 带病开工 | 6 角色评审（R7）+ 对抗评审（专开 agent 挑毛病）；有取舍出对比表（R3）| 评审回填 + 必改项 |
| 3 实现 | 加新不删旧 / 喂巨壳 | 主 loop 顺序实现；互不碰同一文件的独立项 → 多 agent worktree 并行 | 代码 + 单测 |
| 4 逐元素核对 | twMerge/Mantine 隐藏覆盖 | `tests/ux/design-fidelity.e2e.mjs`（computed-style/DOM 结构断言）| 门全绿 |
| 5 交互态视觉收尾 | 遮挡/溢出/重叠（逐元素绿也抓不到）| 真实用户体验 agent + Playwright 逐个打开每个交互态 + 截图 + 几何实测 | 遮挡/溢出回归断言绿 |
| 6 代码评审 | 正确性/复用/效率 | `/code-review` 或评审 agent + 对抗验证（多 agent 各挑一角度）| 评审通过 |
| 7 迭代 | 全绿 ≠ 完成 | 发现问题回到对应阶段 | 全门绿 + 样张/体验对账过 |

**UI 可见改动的最后一道永远是「真实用户体验 agent 视觉走查」（R13 固化）。**

---

## 技能库（Skills）— 规则的可执行版本

> 已装一批 Claude Skill。它们**不是新规矩**，是上面 P1–P5 / R1–R14 / 工作流阶段的**可调用执行体**：规则讲「该这么做」，skill 把这套步骤直接跑出来。触发对应规则时就 `Skill` 调用对应技能，别另起炉灶（违 P1）。
>
> **冲突时**：本文件 CLAUDE.md = 最高真相源。skill 与本文件冲突一律**以本文件为准**（如 skill 默认 Next.js 写法、或它的 review 分级和 R7 六角色不一致，都按本项目走）。skill 是工具，纪律是宪法。`using-superpowers` 是元技能（提倡每条消息先查 skill）——本项目已用 CLAUDE.md 做编排，**按需调用即可，不强制每条触发**。

**安装事实**：项目级装在 `.claude/skills/`（PromptScript 类，仅支持项目级，以完整 agent 权限运行）。技能目录已 gitignore，**唯一 committed 真相源 = `skills-lock.json`**；换机 / 协作者用 `npx skills experimental_install` 一键还原。

### 触发 → 技能映射（在既有规则触发时调用，不替代规则）

| 什么时候 | 调用技能 | 对应规则 / 阶段 |
|---|---|---|
| 任何创作 / 加功能 / 改行为，**动手前** | `brainstorming` | P5「想清楚再动手」/ 阶段 1 |
| 有 spec、要落多步任务，**写码前** | `writing-plans` | R4「执行前写文档」→ 落 `docs/plan` |
| 拿着写好的 plan 执行（带检查点） | `executing-plans` | 阶段 3 实现 |
| 一会话内并行干多个互不依赖的子任务 | `subagent-driven-development` / `dispatching-parallel-agents` | 阶段 3「独立项并行」 |
| 写任何功能 / 修 bug，**写实现前** | `test-driven-development` | 单测先行 / Push 前必过 test |
| 撞 bug / 测试挂 / 行为怪，**提方案前** | `systematic-debugging` | P2「修根因不修症状」 |
| 写 React 组件 / 取数 / 性能优化时 | `vercel-react-best-practices` | **仅 React**（本项目非 Next.js，取其 React 性能那部分）|
| 完成任务 / 合并前要审代码 | `requesting-code-review` + `code-review-expert` | R7 / 阶段 6；与内置 `/code-review` 并用，这俩重 SOLID/安全的 P0–P3 分级 |
| 收到 review 意见、**动手改前** | `receiving-code-review` | 不盲改，先技术核实 |
| 要宣布「做完 / 修好 / 通过」前 | `verification-before-completion` | P3「全绿≠完成」/ R11 验证门槛 |
| 开新分支要隔离工作区 | `using-git-worktrees` | worktree 放仓库**同级**（见「工作目录」）|
| 实现完成、决定怎么并入 main | `finishing-a-development-branch` | R11 commit/push |
| 自己造 / 改 skill 时 | `writing-skills` / `skill-creator` | — |

---

## 固化的工作纪律

以下是从实际踩坑中提炼的、不属于任何单一规则的独立纪律。

**接入即验证 + 真实生成 E2E 回路**：一个模型/生成链路不算「接入成功」，直到一次真实 E2E 生成跑通。验证链路：定义真实任务 → 真机驱动 + 主进程埋点（Playwright 渲染层抓不到 vendor HTTP，它在 Electron 主进程发）→ 分层暴露所有问题（UI/交互/配置/传输/渲染）→ 逐个挖根因 → 分级修 → 补可观测 + 锁回归断言。缺 archetype 的模型先补 archetype 再配 mapping，别手配（手配必漂）。参考：`docs/workflow/2026-06-06-real-generation-e2e-loop.md`。

**词汇 = 模型真名，别替用户翻译**：模式/能力标签用模型自己的叫法（vendor 原词）为主。自创意图词可能把能力说窄（「全能参考」写成「角色参考」会让人以为只能放角色）。

## R17 重活门岗（用户体感「卡死」的一族）

**门岗**：`pnpm run check:heavy-path`（`scripts/check-heavy-path.mjs` + `scripts/heavy-path-baseline.json`），每条规则各自棘轮，只减不增。已进 `gates` 链。（规则条数别写死在文档里——以脚本里的 `RULES` 为准。）

**它抓什么、为什么这些是一族**（2026-08-20「九宫格切图卡死半小时」挖到底的产物）：

| 规则 | 写法 | 后果 |
|---|---|---|
| `sync-image-encode` | `canvas.toDataURL()` | 同步 PNG 编码，编码期间整个界面冻住。9 张 4K 切片 = 701ms 纯阻塞。改用 `convertToBlob()`/`toBlob()`（异步、编码不占主线程）|
| `base64-into-store` | `updateNode({ result: { url: dataUrl } })` | base64 进 store → 每次写入被 `emitCanvasGesture` 整段 JSON 深拷贝、压进撤销日志、IPC 发去事件日志、随每次保存全量序列化。改用 `persistNodeImageBlob()` 落盘换 `nomi-local://`，store 只存门牌号、只写一次 |
| `duplicate-node-size-bounds` | 在 `nodeSizing` 外重新声明 `MIN/MAX_NODE_WIDTH/HEIGHT` | 布局算一套尺寸、渲染算另一套 → 必然错位（切图九张按 129px 步距摆、卡片各渲染 240 宽，互相压掉 110px）。尺寸只有一个真相源：常量从 `nodeSizing` 导入，「卡片实际渲染多大」问 `resolveNodeVisualSize()` |
| `node-stream-into-response` | `new Response(createReadStream(...))` / `Readable.toWeb(...)` | 把 Node 流交给 undici / Node 适配器管生命周期。小文件、不 seek 时完全正常；大视频一拖进度条就从 microtask 抛出 `ERR_INVALID_STATE`，call site 的 try/catch 一律接不住。改用 `createOwnedFileStream()`（`electron/protocol/fileResponseStream.ts`）自己拥有流 |
| `unguarded-fsync` | 在 `electron/durability.ts` 之外直接 `fs.fsyncSync(fd)` | 绕过全仓唯一的落盘屏障 → 那条写路径在测试里关不掉，productionRun 的 flake 长回来一角（屏障关掉前该子集 98.7s、最重的几个文件贴着 5000ms `testTimeout`）。而**本地单跑照样全绿**，只有 CI 磁盘队列深的那一刻才红。文件 fd 用 `fsyncIfDurable(fd)` |

**`unguarded-fsync` 的判据是「有没有过闸」，不是「在哪个文件」**（所以基线是 0，不是「现存 2 处」）：

- 正道 `fsyncIfDurable(fd)` 本就匹配不到；
- 合法例外只有一种形态——**只为 fsync 而开的目录 fd**（`productionRunIntentLog.ts` / `productionRunLock.ts` 各一处）。它连 `openSync` 都要省掉，没法用 `fsyncIfDurable` 表达，于是在开 fd 之前先 `if (!isDurable()) return`；门岗按「本顶层声明里有没有这道闸」认它，屏障一样被尊重。
- **为什么不把那 2 处收进基线**：基线在本仓的语义是「待清零的存量债」。那 2 处是永远正确的写法，收进去等于把正确代码标成永远清不掉的债；更要命的是留了个洞——删掉一处合法的、同时新增一处违规的，计数不变、门岗照样绿。按闸判则两种情况都当场报红，且将来新写的合规目录 fsync 不用抬基线（抬基线正是棘轮被磨平的方式）。

**为什么必须是门岗而不是文档**：这些写法**当场看不出毛病**——小图上跑得飞快，大图才冻死；本地磁盘闲，CI 忙起来才超时。而写代码的人手里多半是小图、跑的多半是本地。靠自觉记不住，只能靠机器每次拦。`electron/durability.ts` 里那句「除本模块外不要直接调 `fs.fsyncSync`」当了一阵子纯注释、没有任何东西执行它，本规则就是来给它上闸的。

**基线里还留着的（存量，只减不增）**：`sync-image-encode = 5`。其中 `electron/browser/media/browserMediaVisualCapture.ts` 那处跑在注入页面的脚本里，返回值必须可 JSON 序列化，base64 是被迫的——它是这条规则的合法例外，清零时最后处理。

**配套的运行时/主进程护栏**（grep 抓不到的那半）：
- `electron/events/eventLogRepository.ts` 的 `MAX_FIELD_BYTES = 256KB`：超限字符串在脱敏/哈希/落 sidecar **之前**就换成体积标记。事件日志是旁路观察，绝不许因为一个大字段把主进程拖死。
- 走查断言：`tests/ux/image-grid-split-freeze.walk.mjs` 量主线程最长阻塞、零 `toDataURL`、零 `data:` URL。

**加新规则的姿势**（P2 通用性判定的落地路径）：修完一个 bug → 判断是不是通用 → 全仓实扫拿 file:line → 能 grep 的加进本门岗的 `RULES`（写清 label + hint，hint 必须给出替代写法）→ `node scripts/check-heavy-path.mjs --update-baseline` 把存量收进基线 → 存量后续慢慢清零。**先问一句「存量是债还是本来就对」**：是债才进基线；本来就对的写法应该在 `scan()` 里判成合规（例：`unguarded-fsync` 认 `isDurable()` 闸），否则等于把正确代码标成永远清不掉的债，还会被「删一处合法的 + 加一处违规的」凑出假绿。

**加规则前必须验一次它会红**（2026-08-25）：临时在 `electron/` 塞一处违规写法 → 跑门岗确认报红且 file:line 点得对 → 删掉。**只验过绿的门岗不算门岗**——绿有可能是正则根本没匹配上。对有「合法例外」的规则还要补一发反向控制：把真实合法处的豁免条件（如那道 `isDurable()` 闸）临时去掉，确认它当场变红——这才证明扫描器真的走到了那几行，而不是碰巧漏过。

**`stripComments()` 必须逐行等高**：抹注释不许改变总行数，否则报出来的 `file:line` 点开是别的地方。两个坑都踩过并已修（2026-08-25）：① 块注释整段删会把后面的行整体上移；② 行注释正则写 `^\s*//` 时 `\s` **含换行**，「空行 + `//` 注释」会被吞掉一行。修之前全仓 2015 个被扫文件里 **1053 个行号是错的，最差的一个偏 995 行**。
**加新规则的姿势**（P2 通用性判定的落地路径）：修完一个 bug → 判断是不是通用 → 全仓实扫拿 file:line → 能 grep 的加进本门岗的 `RULES`（写清 label + hint，hint 必须给出替代写法）→ `node scripts/check-heavy-path.mjs --update-baseline` 把存量收进基线 → 存量后续慢慢清零。
## R18 测试等待门岗（并行才炸的私有墙钟等待）
**门岗**：`pnpm run check:test-waits`（`scripts/check-test-waits.mjs`，硬零无基线）。已进 `gates` 链。
**它抓什么**：测试文件里的私有 `waitFor` 定义与 `Date.now()` 截止时间轮询。起因（2026-08-25）：electron/productionRun 十一个测试文件各自复制/手写墙钟等待（硬闹钟 500ms~5s），赛跑「每条命令 3 次真 fsync」的 ProductionRunService 编排链——单跑永远绿，vitest 并行满载时 fsync 排队放大 → 干净 main 上 5 跑 4 挂。flake 的两条腿分两处修：**耗时腿**在 `electron/durability.ts`（单测 ephemeral 不 fsync，测试 20× 提速，PR #139）；**赛跑腿**在本门岗——就算测试再快，复制粘贴的私有闹钟也是下一次事故的年轮，机器拦住不许再长。
**正确姿势**：等 detached driver（`void driveGeneration(...)` 这类）一律用 `productionRunTestHelpers.waitForProduction`（全仓唯一等待实现，统一预算、超时信息带 `check.toString()` 直接定位卡在哪步）。不许在测试里再写 `function waitFor` 或 `Date.now()` 截止轮询——第 11 个复制品（`productionStoryboardBinding` 的匿名内联循环，连名字都不叫 waitFor）就是靠本门岗的模式扫描抓出来的。来龙去脉：`docs/plan/2026-08-25-production-run-test-flake-fsync.md`（耗时腿）+ `docs/plan/2026-08-25-fix-flaky-production-run-tests.md`（赛跑腿与门岗）。

## R19 解决状态必须可交付

> 2026-08-15 用户要求固化。根因不是“忘了合分支”，而是把侧分支里的实现状态误报成了用户拿得到的解决状态。以后状态名称与 Git 证据绑定，不靠口头判断。
>
> **原为 R17，2026-08-25 改号为 R19**：本条当初只写进了 `AGENTS.md` 一侧的规则索引，`CLAUDE.md` 那侧从未见过它，于是 08-20 加「重活门岗」时把 R17 号又占了一次，本文件一度出现两个 `## R17`。因本条全仓零引用、而「重活门岗」被代码注释与 4 篇计划文档引用，故改本条。旧文中提到的「R17 解决状态」即此条。

**状态词只有以下四种，禁止混用**：

1. **已实现、未推送**：改动只在本地工作区或本地提交。必须给出工作树、分支和提交；不能称为“已解决”。
2. **已推送、待合入**：远端侧分支能找到提交，但目标分支不包含它。必须给出远端分支/PR；不能称为“已解决”。
3. **已合入、待验证**：目标分支已包含提交，但目标分支门禁或真实用户任务尚未通过。只能称“已合入”。
4. **已解决**：修复提交已进入用户指定的远端目标分支，并且该目标分支上的必需门禁与真实用户任务都通过。

**机械证据（报“已解决”前必做）**：拿到 GitHub 返回的 merge commit SHA 后，在 Git fetch 得到的该提交工作树运行：

```bash
pnpm run delivery:verify-merged -- --expected-sha <merge-commit-sha>
```

- 命令要求 `HEAD`、远端目标分支与 expected SHA 完全一致，并记录 commit/tree 两种身份；PR head 与 merge commit 不相等是正常阶段变化，tree 相同但 commit 不同也不能误报成代码不一致。
- 身份检查失败：状态必须降级为“已推送、待合入”或“已合入、待验证”，当轮继续收口，不能把尾巴留给用户。
- 禁止用 REST compare 文件列表、commit message 重放或低层 Git 对象合成来伪造远端 commit/tree；远端对象只从有界 Git fetch 获取。
- 未推送提交不允许被引用为团队现状；需要保留就先推到明确命名的远端分支。
- 删除分支前先逐提交审计；目标分支未包含的有效提交必须先合入或明确归档，不能靠删分支消失。
- 完成报告必须同时给出目标分支、远端 commit、验证结果；不再只给一个侧分支 hash 让用户自行判断。
- 若用户明确要求验收后再合入，只能报告“待验收修复”，直到用户批准并实际合入；不能提前写“已解决”。

## R20 造轮子前先过 build-vs-buy 闸

**触发**：你正准备写一段「通用能力」的代码——协议处理、状态/渲染调度、手势、虚拟列表、校验框架、任务队列、编辑器内核等等（不是 Nomi 业务语义）。

**三问（缺一不许动手）**
1. **这是不是通用问题？** 别人也会遇到 = 通用。只有 Nomi 会遇到（分镜锚一致性、生成预算账本）= 业务。
2. **同类产品/成熟方案怎么做的？** Context7 查官方文档 + web 查现役方案 + 读顶尖开源真实代码（R5/R6）。**禁止凭记忆判断「有没有成熟方案」「哪个更现役」**。
3. **自研它在不在护城河上？** 在 = 自研到底；不在 = 用标准实现，或至少**行为对齐标准语义**（将来才可能平滑换过去）。

**判据速查**

| 类型 | 例子 | 处置 |
|---|---|---|
| 护城河（自研到底） | ProductionRun 账本、预算/收据/幂等、锚一致性、Proposal 撤销、能力核权限 | 没有现成品，且是差异化本身 |
| 标准协议/边界（用标准或对齐标准） | MCP JSON-RPC、Electron IPC 合同、schema 校验、请求生命周期 | 自研不产生差异化，**出事代价极大** |
| 通用交互内核（先隔离再评估） | 画布 viewport/手势、时间轴播放时钟 | 先把瞬时状态与领域状态分离，再谈换不换 |
| 已用成熟库（别迁移，修用法） | R3F/Three、Tiptap、Leafer、TanStack Virtual | 查渲染模式、缓存、dispose、订阅粒度 |

**已交的学费**（2026-08-25 全应用地基审计 PR #171）：手写 MCP 协议缺 `notifications/cancelled` 与在飞操作的绑定（客户端断开后付费生成仍在后台跑）、tools/call 参数直接 cast 无运行时校验、协议版本原样回显无交集协商、IPC apply reply 只按 id 路由不绑 sender/origin。这些**都不是业务复杂度，是标准语义没补齐**——正是这条闸要拦住的东西。

**与既有规则的关系**：R5 管「用第三方库时先查官方文档」，R6 管「做方案前先读顶尖开源」，**R20 管更早的一步：先判断该不该自己写**。P2 的「通用性判定」是修 bug 侧的同一思维（这类还会从别的入口出现吗），R20 是造东西侧。

## R21 修复必须走根因流程；可复发/高风险交 v3 合同

**触发**：所有 bug、回归、CI/平台失败、flaky、性能/安全问题和 review/audit 发现，不按目录或改动大小豁免。

统一方法只住在 `.agents/skills/root-cause-remediation/SKILL.md`。`recurring` 或高风险生产路径在改代码前必须提交 schema-v3 `docs/fixes/*.root-cause.json`；`pnpm run check:root-cause-contracts` 会交叉核验真实共享边界、至少两个同类入口、变化中的结构预防与类级测试、旧路径处置和依赖生命周期。schema v1/v2 是内容哈希锁定的历史记录，修改时必须迁移到 v3，禁止新增旧 schema。

本地 Agent hook 只负责提前提醒，可能不存在；已提交的 `CLAUDE.md`、生成的 `AGENTS.md`、skill 和 CI 才是跨 Agent 的执行链。合同字段和完整步骤不在本节重复，避免规则再次膨胀和分叉。

**派工/自验清单必须显式点名本闸（2026-09-01 教训）**：凡改动触及 electron/ 高风险 pattern（`*ipc.ts` / `*store.ts` / `runtime.ts` / catalog 核心 / validator 等），任务 brief 与自验清单必须写明「跑 `pnpm run check:root-cause-contracts`、改动作者自写契约」——不点名就会漏：曾有 4 个返工 PR 因 brief 验证档只列 typecheck/lint/focused，集体被本闸拦下返场补契约（同批次里自写了契约的 2 个 PR 一次过闸）。

## R22 验证分层与测试预算

> 2026-08-29 用户拍板建立测试预算；2026-08-30 从 `fast/full` 两档升级为独立风险面。目标不是少测，而是把反馈成本花在真正可能受影响的地方：小改动尽快反馈，高风险绝不降级，也不把无关性能或打包成本强加给每个 PR。

### 风险面

| 风险面 | 触发 | 验证 |
|---|---|---|
| contracts | 所有 PR 与 `main` push | 静态合同、lint、typecheck 和结构门岗 |
| unit | 普通隔离改动用 `focused`；Electron、模型执行、画布和基础设施用 `full` | changed/sibling/related 或全量 Vitest/agent runtime |
| desktop | Electron 与桌面运行边界 | 一次 build + Electron smoke |
| journeys | Agent、模型执行和真实工作流边界 | CI-safe J3/J5 真实用户旅程 |
| canvas | 生成画布为 `critical`；React Flow 内核/验收基础设施为 `full` | 功能画布验收，不含性能 benchmark |
| performance | React Flow viewport、节点媒体渲染/调度和性能基准自身 | 独立性能预算；JSON 永久留证，`pass:false` 必须非零退出 |
| package | 依赖/构建配置、Electron main/preload/runtime identity 与 release 边界 | macOS build、目录打包和 codesign |

权威实现是 `scripts/validation-policy.mjs`；`scripts/select-quality-gate-profile.mjs` 只负责从 Git diff/事件取输入，`.github/workflows/quality-gate.yml` 和 `tests/system/profiles.mjs` 只消费输出。PR 和 `main` push 都按真实 Git changed entries 分类；`main` 不因事件名自动 full。删除/重命名、空或不可解析 diff、分类器/工作流/测试系统自身和手动发布验证必须 fail-closed 到所有风险面。`Quality Gate` 仍是唯一聚合门，只允许策略未选择的 optional job 为 skipped。

### 测试取舍

1. **必须保留**：凭据不出主进程、SSRF/重定向/私网边界、认证与发布状态机、幂等/并发/取消、崩溃恢复与升级持久化、迁移与 unknown reconcile、媒体验真、真实入口 round-trip、安装包身份和签名。这些测试即使慢或相似，也不能按数量删除。
2. **可以 focused**：普通源文件的同目录 sibling test；没有 sibling 时由 Vitest import graph 找 related tests；直接改动的 Vitest/Node test。docs-only 没有可执行 target 时仍必须通过 contracts。
3. **可以简化**：重复的 fixture、临时目录、启动器和断言 helper；过大的测试文件应按行为域拆分。先证明行为覆盖等价，再合并装配代码，不用“删测试”换速度。
4. **不能假装自动化**：真实供应商 key、真实 ComfyUI、外部宿主和跨版本升级没有资源时必须记为 unverified，不能用 mock 绿灯替代 live 证据。

### 执行节奏

一个逻辑批次先完成实现、审计、规则和测试，再跑一次定向验证；全部本地问题收敛后按共享 policy 统一 push。只有测试基础设施自身、删除/重命名、无法分类或手动 release 才跑显式全维度；小阻塞不得打断主流程反复重启全套测试。

**分支定性先算 merge-base（2026-09-01 一日三撞的「落后假象」固化）**：评审、对账或打捞任何分支前，先 `git merge-base origin/main <branch>`；真实 authored delta = `MB..branch`。直接对 main tip 的两点视图里出现的大片删除或陌生文件，**第一假设是「main 在分支落后期间前进了」**，不是分支真要删它们；GitHub 页面的 +/- 数字与 behind 红字同理不可直接采信（实例：某评估把三点视图 +1416 当真实贡献，两点实测是 272 文件混合物；另一分支两点视图「删 14.6 万行」实为落后 1500+ commit 的反转幻影）。远落后分支的并线一律 `gh pr update-branch` 服务端做——本地 merge 后 push 的追平 diff 会撞 R25 的评审上限（15-88MB 实测）。

最终交付不再本地跑第三遍：在真实 merged-main SHA 上运行 `pnpm run delivery:verify-merged -- --expected-sha <SHA>`。命令仍用有界 Git fetch 证明 `HEAD`、远端主线和 expected SHA/tree 身份，然后等待该 exact SHA 的 `Quality Gate` 与 `Mac Package` check run。GitHub required-check 语义中的 success/skipped/neutral 可写入 Git common dir 的 per-SHA `ci-evidence.json`；missing、pending、failure 或错误 SHA 都不能生成成功收据。同一 SHA 再调用直接复用收据，不启动 repository tests。

## R23 React Flow 生成画布单内核与迁移等价

**边界**：生产生成画布只允许 `@xyflow/react` 一个交互、选择、平移缩放、连接、缩放节点和边渲染内核。`GenerationCanvas` 是稳定入口；禁止第二 renderer、engine flag、fallback 或并行实现。onboarding 的静态只读工作流图不属于生产生成画布 renderer。

**状态所有权**：Zustand/domain/project snapshot 是业务与持久化唯一真相源；React Flow state 只是一层可丢弃的渲染投影。节点、边、选择和连接写入必须回到现有 graph actions，不能把 React Flow 内部 store 变成第二份业务状态。

**迁移等价清单**：换内核不是重新设计。迁移或升级 React Flow 时，逐项盘点并保留旧画布的节点真实尺寸、fit/focus/虚拟化几何、连接入口与端点贴边、磁吸/hover/selection affordance、resize 命中区与可见反馈、边颜色/粗细/标签/菜单、出现与聚焦动画、拖动期间浮层、右键/键盘/触控协议；删除旧实现前必须证明新内核覆盖对应能力。产品明确要求改变的项目另走 R8，不得借迁移顺手改掉。

**证据**：纯映射与状态复用写 adapter/contract 测试；旧内核不存在、入口唯一和写边界写结构门禁；用户能看到或操作的项目进入现有真实 Electron 旅程，用计算样式、SVG/DOM 几何和截图共同验证。不得以“React Flow 默认如此”替代 Nomi 的产品合同，也不得只查元素存在而不验证用户实际看见和点到的状态。

> 规则编号说明：R24 由 PR #223 的能力完整性合同保留；本分支不定义或复制 R24，避免与 Agent/Project Agent Host 规则形成第二套旁路。

## R25 提交/推送前 Ponytail 评审

**触发**：任何 `git commit` 或 `git push`，包括文档、配置和脚本的小改动。目标是让过度工程化评审发生在变更离开工作树前，而不是把它误当成正确性、安全或 CI 评审的替代品。

### 合规流程

1. 版本化 `pre-commit` / `pre-push` hook 自动调用 `scripts/ponytail-review-hook.mjs`。Codex 适配器以 `--ask-for-approval never --ignore-rules --sandbox read-only` 启动只读、临时会话，并触发 `@ponytail-review`（宿主 slash 名是 `/ponytail-review`）。
2. `pre-commit` 只把 `git diff --cached` 交给评审；`pre-push` 解析 Git 传入的四列 ref-update，逐个评审实际 outgoing range。新建远端 ref 没有旧 SHA 时，以远端 HEAD 的 merge-base 为基线，拒绝退化成整仓 diff；无法确定基线就 fail closed。不会把无关的未暂存改动或其他分支混进上下文。
3. 评审只看过度工程化（delete/stdlib/native/yagni/shrink）。有发现时 hook 只报告状态和字节数摘要，不替用户判断功能正确性；需要逐条意见时另行运行 `@ponytail-review`。没有合法结果、Codex 缺失、插件未启用、异常或超时都 fail closed，必须处理环境后重试。
4. 运行器固定为只读、临时、限时调用，报告写入系统临时目录，不进项目和 Git index；评审结束后立即删除唯一临时目录，清理失败也 fail closed。hook/返回值只保留状态、diff hash 和 report/stdout/stderr 字节数，绝不把报告正文或进程输出复制到终端、CI 日志或错误对象。报告读取上限为 256 KB；`pre-commit` 先执行既有敏感数据扫描，避免把明显凭据送入模型；`pre-push` 只审 outgoing diff。**二进制文件内容不进评审 diff**（`collectReviewDiff` 去掉 `--binary`，Git 自然降级为一行 `Binary files … differ`），改附一段 `BINARY: <added/modified/deleted> <path> (<size>)` 摘要——图片字节对精简代码评审是 100% 噪音，base85 blob 曾反复顶爆上限；摘要保留「仓库变肥」信号供评审当 lean 发现提出。单次送审 diff 上限为 1.5 MB（**自此只约束文本 diff + 二进制摘要**）、push ref-update 上限为 32 条，超限直接 fail closed。
5. 只接受 `--output-last-message` 报告的严格、报告-only 合同：适配器形式要求唯一一条 `net: -N lines possible.` 后紧跟唯一最终行 `PONYTAIL_REVIEW: PASS|FINDINGS`；同时兼容 Ponytail 原生的精确 clean 行 `Lean already. Ship.` 和以 `net: -N lines possible.` 收尾的 findings 报告。stdout/stderr、prompt 回显、重复 marker 和不完整报告一律不算通过。

### 推送形态与 diff 上限的实操后果（2026-09-01 实测源码后固化）

上面第 2/4 条的机制决定了三条铁律，违反任何一条都会在 push 时 fail closed：

- **已存在的远端分支禁止 force-push 重建内容**：pre-push 对已有 ref 的评审 diff = `remoteSha..localSha` 两端点树差——把远古分支重置成「fresh main + 新内容」再强推，diff 会包含 main 全部演化、必超 1.5 MB 上限。**重建一律走全新分支**（新 ref 按与远端默认分支的 merge-base 算基线，diff = 真实 delta），旧 PR 关闭换新（带指针）。（2026-09-01 补：二进制内容已不计入评审 diff（一行摘要代替），本条自此只约束**文本 diff**；对**大文本演化**——重建含万行代码/文档的远古分支——force-push 重建仍会顶爆上限，照旧禁止走新分支。）
- **大删除拆批分推**：瘦身/清理类改动把删除拆成多个 commit **分多次 push**，单次评审 diff 控制在 ~1 MB 内（实测 178 文件 2.4 万行的瘦身拆 3 批全过）。（2026-09-01 补：二进制内容已不计入评审 diff（一行摘要代替），本条自此只约束**文本 diff**；**样张/截图类提交不再需要拆批/降采样**——PNG 字节不再进 diff，一行 `BINARY:` 摘要代替。）
- **新 worktree 先 `pnpm install` 再 commit/push**：hook 由 `postinstall`（`scripts/install-git-hooks.cjs`）安装——先推后装 = 推送完全未过本地评审与敏感数据闸（实翻车：18 批删除 push 全部裸奔，靠 CI 补拦）。

### 为什么不把它做成收据或第二套 Agent

`/ponytail-review` 是宿主 Agent skill，不是可移植的 shell 可执行文件；因此仓库只保留一个版本化 Codex 适配器，不再另设“手工 ACK 收据”旁路，也不接入 Nomi 的 Agent/Canvas 能力链。hook 内不执行修改、测试、commit 或 push，避免递归和工作树污染。

`--no-verify`、GitHub 网页/API 和未安装 hook 的环境仍可绕过本地 Git hook；若要对所有入口强制，需在 CI/分支保护中复用同一只读评审合同。不得把本地 hook 通过写成“代码正确”或“已经合入”。

### 环境与并行 worktree

- `scripts/install-git-hooks.cjs` 由 `postinstall` 调用，保留既有 `commit-msg` 和敏感数据扫描顺序，并新增 `pre-push`。普通 worktree 使用 configured hooks 路径；linked worktree 只有在 Git `extensions.worktreeConfig=true` 时才写入专属目录，无法隔离则跳过并警告，避免一个分支改坏并行 worktree。
- `PONYTAIL_REVIEW_CODEX_BIN` 可在本机明确指定 Codex 可执行文件；`PONYTAIL_REVIEW_REPORT_DIR` 仅用于调试报告目录。缺失配置不会放行。

**验证**：`scripts/ponytail-review-hook.node-test.mjs` 覆盖 hook 生成顺序、staged/outgoing diff 范围、结果分类、Codex 失败/超时、真实 fake-runner 调用和 linked-worktree 隔离；改动本规则或 hook 时必须运行该测试与 contracts gate。

## R26 分层边界不许反向/循环

**问题**（2026-08-31 架构耦合审计，`docs/audit/2026-08-31-architecture-coupling-audit.md`）：用户痛点「改一点动一大堆、改一个事得找半天、东西很乱」的结构根因之一，是**边界画在了进程线两侧**——渲染层（`src/`）被迫直捅主进程（`electron/`）拿类型/常量（存量 136 处，其中 81 条 value import 把主进程码打进渲染 bundle），加上供应商目录管线里 6 个完全静态循环（真·加载顺序风险）。这类越界**当场能编译**，靠自觉记不住，只能靠机器每次拦（P2 通用性判定）。

**规则**：

| 违规方向 | 处置 |
|---|---|
| `src/` → `electron/`（渲染层直捅主进程 value/type import） | 存量 136 进 baseline 冻结、只减不增；走 `src/desktop/bridge.ts`（IPC）或中立契约层 `electron/shared/contracts/`（待建） |
| `electron/` → `src/`（主进程反向 import 渲染层） | 硬零，无 baseline |
| `src/` → `scripts/`（UI 捅门岗脚本） | 硬零，无 baseline |
| 新增**完全静态**循环（每条环边都非 `dynamic-import`、非 `type-only`） | 存量 6 个静态硬环进 baseline 冻结、只减不增 |

**软/硬环之分**（R17 教训：被忽略的门岗等于不存在）：全仓约 495 个 distinct 循环，绝大多数经由**故意的懒加载 `import()`** 边（`generationCanvas/nodes/registry.ts` 把节点类型 lazy-map 到 `BaseGenerationNode`），运行期不是硬环，属「认知耦合」不属「加载顺序炸弹」。把这些也拦会让门岗永红被无视，故规则用 `viaOnly.dependencyTypesNot: ['dynamic-import','type-only']` 只认静态硬环。

**门岗**：`check:boundaries`（`scripts/check-boundaries.mjs`）。工具 = `dependency-cruiser@18.2.0`（唯一一个「出循环 + fan-in/out 且能把分层规则写成 `forbidden`、导出机读 JSON」的现役工具，一把兼审计+门岗）。规则住 `.dependency-cruiser.mjs`（`forbidden` 数组），存量身份冻结在 `scripts/boundaries-baseline.json`（**存身份不存裸数字**：裸数字放过「修一条旧的、同 commit 加一条」蒙混）。位置在 `check:heavy-path` 与 `lint:ci` 之间。加规则前**必须先验它会红**（造一个新越界 import 确认报红、且不在 baseline 里；再验修掉一条 baseline 违规后要求同步删行）。

**中立契约层 `electron/shared/contracts/`**（第二期建）：让 renderer 和 main 都能合法 import 的中立层，把 55 条 type-only 越界的目标类型迁进去 → 消掉大半 `src→electron`。规则里已对该路径预留豁免（`pathNot: '^electron/shared/contracts/'`）。

**清零路线**（分期，搬迁类须等在途大线合入，见审计分析六）：第一期纯加门岗+地图（零搬迁，本次）；第二期（#241 后）建中立契约层 + 清 29 个 re-export 壳（配 P1）；第三期（#223 后）解 `providerAdapter ↔ catalog ↔ integrationCertification` 硬环。

**归属地图**：`docs/architecture/module-ownership-map.md`（一功能一个家 + 依赖方向铁律）。

## R28 防线建在最早能拦住的那层

**触发**：给某个能力/依赖设计「可选成员」时；或想用「基线 / 欠账名单 / 白名单」放行一处已知缺口时。

**规则**：防线要建在**最早能拦住它的那一层**。能让类型系统拦的，别留给门岗；能让门岗拦的，别留给人肉 review。**安全关键依赖尤其不许写成 optional 成员再配一条欠账登记**——登记只是备忘录，它不阻止下一个人合法地漏传。能力确实可能不存在时，用**显式的 `unsupported` 返回值**表达，不要用 `undefined` 表达。

**依据（2026-09-03 同日两起）**：

- 打包态确认门恒拒：`McpTransport` 把 `confirmGenerationInNomi` 做成可选成员，两个生产装配点各自手写对象字面量，打包态那个漏传。漏传是合法 TypeScript，编译期与 lint 均无信号，只在打包后显形——开发态 43/43 全绿，打包态 15/43。
- 客户端确认面整条不可达：同一接口的 `verifyClientGenerationConfirmation` 在两个生产装配点都没接，配合签发点无条件要求凭证，使「确认弹在调用方」这条主路径在生产中恒不可达数月，而全套单测绿着。
- 当日新建的 `scripts/check-transport-assembly.mjs` 采用「欠账登记即放绿」，被外部评审指出**可在安全关键欠账存在时通过**（见 `docs/audit/2026-09-03-codex-agent-host-review.md`）。结构性修法不是记账，是把依赖改成必填。

**自检**：写下 `foo?:` 或往基线里加一条时问——**漏了它会怎样？** 若答案是「运行时静默降级」且该能力碰钱/碰权限/碰数据完整性，就不该是可选的。
