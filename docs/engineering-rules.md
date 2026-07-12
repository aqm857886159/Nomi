# Nomi 工程纪律 — 详细规则（L2 · 触发才查）

> 这是 `CLAUDE.md` 的「按需查阅」层。`CLAUDE.md`（always 加载）= 精简核心：项目事实 + P1–P5 + D1–D5 + 规则索引 + 三闸。本文件存**触发某条规则后才查的细节**：R1–R14 详解、工作流框架、技能库映射、固化的工作纪律。
> 真相源仍单一：`CLAUDE.md` 的规则索引指明每条住哪；冲突一律以 `CLAUDE.md` 的 P1–P5 / D1–D5 为准。改触发清单同步 `.claude/hooks/self-check.sh`，规则细节只改本文件。

# 详细规则 R1–R14

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

**验证门槛**：`pnpm build` 绿 + `npx vitest run` 不回归（重大改动按速览「Push 前必须全过」走五门）。

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
1. 多维 subagent 深审真实代码（R7 6 角色 + 技术栈/架构/测试/产品多维度）
2. Playwright 走查（R13）
3. 落 `docs/audit/<date>-*.md`：现状 + 分级问题（带 file:line）+ 立即/中期/长期路线
4. 清掉 P0，方案级取舍留用户拍板（R3）；关键论断亲自实跑核实

---

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
