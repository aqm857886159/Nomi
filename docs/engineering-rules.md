# Nomi 工程纪律 — 详细规则（L2 · 触发才查）

> 这是 `CLAUDE.md` 的「按需查阅」层。`CLAUDE.md`（always 加载）= 精简核心：项目事实 + P1–P5 + D1–D5 + 规则索引 + 三闸。本文件存**触发某条规则后才查的细节**：R1–R21 详解、工作流框架、技能库映射、固化的工作纪律。
> 真相源仍单一：`CLAUDE.md` 的规则索引指明每条住哪；冲突一律以 `CLAUDE.md` 的 P1–P5 / D1–D5 为准。改触发清单同步 `.claude/hooks/self-check.sh`，规则细节只改本文件。

# 详细规则 R1–R21

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

先分类，别让计划成本大于改动本身：

- 单文件/单现有流程、低风险可逆的 bounded 改动：在对话里写清意图 + focused 验证，直接做；不建 plan、Round、任务图或 reviewer roster。
- 多 owner/多层、迁移/cutover、付费/安全/用户资产、多 session、既有方案漂移：先完整读取并执行 `.agents/skills/engineering-plan-delivery/SKILL.md`。
- 其余普通多文件/多步骤改动：至少在 `docs/plan/` 或 `docs/audit/` 写范围、不动项、回滚和验收门。

复杂交付只能有一份 tracked 活跃方案，冻结当前事实、合同、2-5 个有端到端出口的宏批次、验收证据、远端 checkpoint 和成本熔断；契约/测试/实现/删除是批内依赖，不自动变成独立 Round、评审、提交或推送。被忽略的 harness、旧 protocol 和本地 ledger 只能做历史证据，不能继续当任务真源。执行中发现阶段同名扩域、协调物增长快于行为、相同失败/评审循环两次或重复追 `main`，暂停量化并修订这同一份方案，不再新建平行流程。

写完用户能预读/反驳；每个宏批次执行完先回填证据、残余风险和下一步，与 scoped code 一起 commit 并推远端任务分支；生成的 SHA 写入 PR/交付报告或下一 checkpoint，不要求 commit 记录自身 hash。

## R5 查官方文档（Context7 强制）

凡涉及第三方框架/库（React Flow、AI SDK、Mantine、Electron、Tiptap、Vite…）的实现或改动，动手前必须先用 Context7 查官方文档。

1. `resolve-library-id` 拿库的 Context7 ID
2. `get-library-docs` 拉相关主题官方文档
3. 对照官方推荐 API/模式实现
4. 官方无此能力时才允许自定义，注释写明理由

**不查就写 = 工作错误**。若 Context7 工具未加载，退回 WebFetch 查对应官方站（等价）。

**核对时间点 · 只吃近期（2026-06-21 用户纠）**：搜资料 / 搜开源项目时**必须看发布/更新时间**——AI 半年换一轮，去年的「最新」今年可能已过时。默认加时间过滤（近 6–12 个月）、按时间排序、**每条结论标来源日期**；论断里写「最新/SOTA」前先确认它现在还是不是。别吃老本（连自己上一轮的调研也要意识到会过期，重大判断重查）。

**接入 / 修改任何模型 = 必查真实官方 API 文档，禁凭记忆瞎编（2026-06-30 用户再次要求固化 · 已挂 `model-doc-check.sh` hook）**：接入或修改**任何**模型（新模型、新变体、改参数、改端点、改鉴权），**动手前必须先拿到该模型 / 该 vendor 的真实官方 API 文档**——WebFetch 官方文档站 / vendor 文档门户（如 apimart `docs.apimart.ai`、kie `docs.kie.ai`、即梦官方、火山引擎、ModelScope）/ Context7。照文档**逐项对账**：① 端点路径 + HTTP 方法；② 鉴权方式（bearer / header 名 / OAuth / CLI 登录态）；③ 全部变体（fast/face/lite/quality…）；④ 全部生成模式（t2v/i2v/首尾帧/参考…）；⑤ 全部参数（名字、类型、合法枚举值、默认值、上下限）。**禁止凭记忆或凭印象瞎编**端点、参数名、枚举、模式组合——「记得大概是这样」「应该是这个字段」= 工作错误，必须实查文档原文。这条**每次都要控制住**，不是接一次就免检：每次碰模型接入文件（`electron/catalog/*Vendor.ts` / `*Images.ts` / `*Videos.ts` / `*Texts.ts` / `*Audios.ts` / `*Codec.ts` / `kie*.ts` 等）hook 都会顶提醒。流程固定：抓全官方文档 → 列 {变体×模式×参数} 全表 → 对账现有 catalog/archetype → 补齐/修正缺口 → 真实生成 E2E 验一条（见「固化的工作纪律」接入即验证 + [[model-onboarding-must-cover-full-api-doc]] 记忆）。用户原话：「都要去真实的查到官方文档才去接入，而不是自己去瞎编」。

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

## R6 读顶尖开源代码

做任何项目方案前，先去 GitHub 找 1~N 个顶尖开源项目读真实代码（不是扫 README），产出：
- 它们怎么做的（具体到文件/代码位置）
- 我们能直接借鉴什么
- 哪里不适用、为什么

参考池（非穷尽，按专题选，别拿这串当唯一清单——做某专题就去查那个专题真正的顶尖项目）：
- coding agent / 通用：Cline / OpenHands / Aider / Continue / Cherry Studio / LobeChat
- 画布向：tldraw / ComfyUI / xyflow
- **记忆/上下文专题**：Mem0 / Letta（MemGPT）/ Zep（Graphiti，双时间知识图谱）/ Anthropic memory tool / Cline Memory Bank / 学术（Generative Agents 反思·A-Mem·MIRIX）；创作域：SillyTavern lorebook / Novelcrafter Codex（结构化设定卡+三态挂载）/ Sudowrite·NovelAI story bible。完整调研见 `docs/plan/2026-06-20-memory-system-redesign.md`。

## R7 风险匹配的独立评审

**触发条件**：任何涉及架构/取舍/UX 的项目方案，在给用户拍板前。

默认只派一个独立 reviewer，分开审三轴，不能互相抵消：

1. **Spec**：冻结目标、范围、非目标和验收是否完整一致。
2. **Standards**：是否符合本仓规则、结构质量和既有模式。
3. **Owner / Authority**：状态、身份、审批、任务生命周期、Undo、账本和副作用是否只有一个 owner。

reviewer 只让当前冻结合同内的 P0/P1 阻断；P2、既有债和无关发现进 backlog，不得反向扩张当前交付。只有真实风险需要独立领域判断时才加 reviewer，例如 UI 按 R8 加设计师 + 真实用户视角，付费/安全边界加对应专家；不为填固定席位重复审同一份方案。主 Agent 汇总结论并反向审一次；只复审改过的风险条款，两个 review/fix cycle 仍不收敛就重构合同或宏批次，不继续堆轮次。

流程：研究开源（R6）→ 起草单一方案（R4）→ 一次风险匹配独立审查 → 主 Agent 汇总修方案 → 有取舍用对比表（R3）给用户拍板。

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

架构决策过：Context7 查官方推荐架构（R5）→ 读顶尖开源分层（R6）→ 按 R7 做一次 Spec / Standards / Owner-Authority 独立审查，确有不同领域风险才加 reviewer → 有取舍出对比表（R3）。

**R12 = R9 的量化门岗**：
- 单个非测试 `.ts`/`.tsx` 文件硬上限 800 行
- 现存巨壳列白名单并记录基线行数，棘轮只减不增
- 门岗命令：`pnpm run check:filesize`（已接入 CI）

## R10 → 见 R1（CSS 实例）

CSS 文件分工与「只可减不可增」规则详见 R1 最后一节。

## R11 自动 commit + push

完成一个有意义的、验证通过的改动就自己 commit + push，不用等用户催。

**验证门槛**：按 `criterion -> command/inspection -> code/input/environment fingerprint -> result` 记录证据。普通改动跑能证明本次 claim 的最小充分测试/检查；复杂交付批内跑 direct evidence，宏批次出口只跑一次 affected tests/typecheck/gates。全仓五门、完整 test/build/package 和真实旅程只在固定最终候选上跑一次，除非仓库策略明确要求更早运行。相同命令 + 失败签名且相关指纹未变化最多两次，第三次原样重跑禁止，先判 contract/lifecycle/implementation/environment/test defect。修复后只重跑被改动失效的证据。

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
1. 多维 subagent 深审真实代码（按 R7 为真实风险分配技术栈/架构/测试/产品视角，不固定凑席位）
2. Playwright 走查（R13）
3. 做 R14.1「同一语义有几份定义」横扫
4. 落 `docs/audit/<date>-*.md`：现状 + 分级问题（带 file:line）+ 立即/中期/长期路线
5. 清掉 P0，方案级取舍留用户拍板（R3）；关键论断亲自实跑核实

### R14.1 固定维度：同一语义有几份定义

**为什么单列**：重复实现通常不是因为开发者明知第一套还硬造第二套，而是写新代码时根本没有检索到第一套。这是检索失败，单靠 P1「加新必删旧」拦不住。任何 PR 只要新增或修改下表中的合同，动手前就先用 `rg` 横扫两端/多入口的现有 owner，评审时把复用点或确需独立的理由写清楚；周期审计再全仓复盘一次。

**机器能守的部分**：`pnpm run check:vocabularies` 已进入 `gates`。它用 TypeScript AST 扫 `src/`、`electron/` 的 TS/TSX/MTS/CTS，识别字符串 union、`z.enum([...])`、`as const` 数组和 `Set([...])`。每套词表按稳定的「文件 + 声明路径」登记 owner；第二个完全相同 owner、新增词表、成员漂移、owner 移位、陈旧 baseline、空/TODO reason 或 debt 超上限都会红。baseline 两桶：

- `registered`：确实是独立领域合同，reason 必须说明为什么不能复用。
- `debt`：已知重复/待收敛 owner；`debtCap` 只减不增，等量换一个 owner 也不算减少。

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

**验收**：涉及界面文案的改动必须在 `zh-CN` 与 `en` 各走查一次，并验证刷新后语言保持。

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

> 核心三原则：① 独立工作并行、共享 owner/文件顺序且每条 ownership lane 只有一个 production writer；② 评审/验证按冻结风险和证据指纹，不按微步骤重复 ceremony；③ UI 收尾必过真实用户体验 agent。范围按事情大小缩放：bounded 小改不建方案，复杂交付用 `engineering-plan-delivery` Skill 收敛宏批次。

| 阶段 | 防的根因 | 用什么 | 过门标志 |
|---|---|---|---|
| 0 调研 | 凭记忆手搓 | Context7（R5）+ 顶尖开源代码（R6）+ Explore agent 摸现状 | 现状盘点（带 file:line）|
| 1 设计/方案 | 想清楚再动手 | 复杂交付用 `engineering-plan-delivery` 冻结单一合同/宏批次；UI 另有精确 token/结构/状态/数据规范 | tracked 方案（R4）|
| 2 方案评审 | 带病开工 / reviewer 扩域 | 一次 Spec / Standards / Owner-Authority 独立审查（R7）；当前合同 P0/P1 才阻断 | 主 Agent 汇总修订 + 必改项 |
| 3 实现 | 加新不删旧 / 微切片膨胀 | 按宏批次和 owner 顺序实现；只并行互不共享 owner/文件/运行态的工作 | 端到端批次 + focused evidence |
| 4 逐元素核对 | twMerge/Mantine 隐藏覆盖 | `tests/ux/design-fidelity.e2e.mjs`（computed-style/DOM 结构断言）| 门全绿 |
| 5 交互态视觉收尾 | 遮挡/溢出/重叠（逐元素绿也抓不到）| 真实用户体验 agent + Playwright 逐个打开每个交互态 + 截图 + 几何实测 | 遮挡/溢出回归断言绿 |
| 6 代码评审 | 正确性/复用/效率 | 每宏批次一次 bounded diff review；只复审 fix diff，最终候选一次全分支 review | 当前合同 P0/P1 清零或有明确裁决 |
| 7 迭代 | 全绿 ≠ 完成 | 发现问题回到对应阶段 | 全门绿 + 样张/体验对账过 |

**UI 可见改动的最后一道永远是「真实用户体验 agent 视觉走查」（R13 固化）。**

---

## 技能库（Skills）— 规则的可执行版本

> 已装一批 Claude Skill。它们**不是新规矩**，是上面 P1–P5 / R1–R14 / 工作流阶段的**可调用执行体**：规则讲「该这么做」，skill 把这套步骤直接跑出来。触发对应规则时就 `Skill` 调用对应技能，别另起炉灶（违 P1）。
>
> **冲突时**：本文件 CLAUDE.md = 最高真相源。skill 与本文件冲突一律**以本文件为准**（如 skill 默认 Next.js 写法、逐微任务 review/full-suite，或它的分级和 R7 不一致，都按本项目走）。skill 是工具，纪律是宪法。`using-superpowers` 是元技能（提倡每条消息先查 skill）——本项目已用 CLAUDE.md 做编排，**按需调用即可，不强制每条触发**。

**安装事实**：外部 PromptScript 类技能装在 `.claude/skills/`，该目录已 gitignore，**唯一 committed 真相源 = `skills-lock.json`**；换机 / 协作者用 `npx skills experimental_install` 一键还原。Nomi 自己固化的 Agent 工作流 Skill 住 tracked `.agents/skills/`，直接随仓库版本化；不要复制进被忽略目录形成第二真源。

### 触发 → 技能映射（在既有规则触发时调用，不替代规则）

| 什么时候 | 调用技能 | 对应规则 / 阶段 |
|---|---|---|
| 写/审/修/恢复复杂方案、迁移或长任务；Round/测试/review/main 同步开始膨胀时 | `.agents/skills/engineering-plan-delivery/SKILL.md` | R4 / R7 / R11；单一真源、宏批次、成本熔断 |
| 任何创作 / 加功能 / 改行为，**动手前** | `brainstorming` | P5「想清楚再动手」/ 阶段 1 |
| 有 spec、要落多步任务，**写码前** | `writing-plans`（只作起草参考） | 产物仍必须过 R4 的仓库 Skill；禁 2-5 分钟 step 变 review/commit 单元 |
| 拿着写好的 plan 执行（带检查点） | `executing-plans` | 阶段 3 实现 |
| 一会话内并行干互不共享 owner/文件/运行态的工作 | `subagent-driven-development` / `dispatching-parallel-agents` | 阶段 3；禁每个微任务 fresh worker + duplicate reviewer |
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

**机械证据（报“已解决”前必做）**：

```bash
git fetch origin
git merge-base --is-ancestor <fix-commit> origin/<target-branch>
git status --short --branch
```

- 第一条祖先检查失败：状态必须降级为“已推送、待合入”，当轮继续完成合入，不能把尾巴留给用户。
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

## R21 可复发/高风险修复必须交根因合同

**触发**：任何缺陷/回归先做复发性判定；判为 `recurring`，或涉及 provider、媒体、工作流绑定、任务派发、runtime、资产边界等高风险生产路径时，必须交根因合同。

1. 先读 `.agents/skills/root-cause-remediation/SKILL.md`，按症状 → 直接原因 → 类根因 → 入口集 → `one_off`/`recurring` 推进；“只出现一次”不是 `one_off` 的证据。
2. `one_off` 必须给出全仓同类扫描和仓库无法结构性预防的证据；否则一律按 `recurring`。
3. `recurring` 和所有高风险修复在生产代码前新建或更新 `docs/fixes/*.root-cause.json`；外部行为必须带核验日期的官方文档/源码，纯内部问题必须写 `internal_only_reason`。
4. 报告的精确案例与类边界都要有先红后绿的测试；`recurring` 还必须提交变化中的结构防护产物，不能只补测试、重试、跳过或人工步骤。
5. 修在最早可统一约束的边界，不能因报错来自某模型/供应商就默认加专用分支。
6. `pnpm run check:root-cause-contracts` 是权威门禁；任何主动提交的合同都会校验，高风险路径则强制必须有合同。本地 Agent hook 只做提前提醒，缺失也不能绕过 CI。

根因合同字段与完整方法只在技能和 schema 检查器维护，本节不复制，避免规则再次分叉。
