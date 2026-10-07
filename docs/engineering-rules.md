# Nomi 工程纪律 — 详细规则（L2 · 触发才查）

> `CLAUDE.md`（常驻）只放原则和少数规则；本文件存**触发某条规则后才查的细节**。
> 规则正本是 [`engineering/rules.json`](engineering/rules.json)（可读视图 [`engineering/rules.md`](engineering/rules.md)）：每条规则的旧号写在 `aliases` 里，`pnpm run check:rule-aliases` 保证任何 `R<数字>` 引用都解析得到。改规则只改 `rules.json`，再 `node scripts/gen-rules-view.mjs`。
> 改触发清单同步 `scripts/claude-hooks/self-check.sh`（真相源；`.claude/` 下那份由 `pnpm install` 装）。
> 2026-10-02 瘦身：删了 R3 / R4 / R7 / R25 / 画新面块等被设计卡 [`engineering/design-card.md`](engineering/design-card.md) 与独立验收取代的内容；有真实教训的段落搬到 [`lessons/framework-and-external-contract-lessons.md`](lessons/framework-and-external-contract-lessons.md)，其余靠 git 历史找回。

## R1 加新必删旧（= P1 · 含旧 R10、R23）

引入新组件 / 新流程替代旧的，必须同一 commit 删除被替代的旧代码。

- 不留「逃生口 / Collapse / 备选 fallback」；死代码（grep 不到外部引用）立刻物理删除；旧的有价值就把价值合并进新代码再删旧。
- **CSS**：新样式一律用 Tailwind utility 写在组件 `className` 上；不用 `@apply`；CSS 文件分工固定、只可减不可增：`src/theme/nomi-tokens.css`（设计 token）、`src/styles/index.css`（App 唯一 CSS 入口）、`tailwind.config.ts` 的 `workbenchBasePlugin` addBase（全局 reset / keyframes / 第三方 DOM 覆盖的唯一真相源）。
- **生成画布单内核（旧 R23）**：生产生成画布只许 `@xyflow/react` 一个内核，`GenerationCanvas` 是稳定入口；禁止第二 renderer、engine flag、fallback 或并行实现。Zustand / domain / 项目快照是唯一真相源，React Flow state 只是可丢弃的渲染投影，写入必须回到现有 graph actions。迁移或升级 React Flow 时，逐项保留旧画布的节点真实尺寸、fit/focus/虚拟化几何、连接入口与端点贴边、hover/selection、resize 命中区、边样式与菜单、动画、右键/键盘/触控协议；删旧实现前证明新内核覆盖对应能力；产品要改的另走样张流程。证据：纯映射写 adapter 测试，入口唯一写结构门禁，用户能看到的进真实 Electron 旅程，用计算样式、DOM 几何和截图共同验证。
- 规则编号 R24 由 PR #223 的能力完整性合同保留；本仓不定义也不复制。

## R2 用户视角 + 极简（建议档）

做 UI / 文案 / 卡片前先问：用户进来要看什么？每条信息有行动价值吗？没有就删。0 权重嫌疑犯：节点功能描述文字、每次出现的 onboarding 文案、重复的分组标签、长 error stack 灌满卡片（缩成图标 + tooltip）、双层 border、永远 80px 的空信息区。好产品不靠解释，优先用图标 / 形态 / 位置说明；审视每条文案「删了它，用户还懂吗」。**词汇用模型真名**，不替用户翻译，自创意图词可能把能力说窄。

## R5 先查别人（= P0 的执行 · 含旧 R6 / R29 / R31；R5.2 / R5.5 为建议档）

动手前先看别人已经做好的：**凭记忆判断 = 没查；查完默认是接入**，自写才是要登记的例外。领域目录（`docs/engineering/self-written.json` 的 `domainRoots`）里写代码不需要手续；领域目录之外新增模块 = 自写一项通用能力，必须登记（查过哪些现成方案带出处、为什么不接入只认领域约束、何时重新评估）。

| 触发面 | 做什么 | 执行点 |
|---|---|---|
| 用第三方库 / 框架 / 模型的 API（R5.1） | Context7（或官方站）实查，照官方语义写 | `model-doc-check.sh` hook |
| 做方案（R5.2，建议） | 读同用户任务 / 同媒介 / 同载体的近邻开源真实代码，给 `file:line`；找不到近邻要写明检索过哪些方向 | `check:prior-art`（只对新增通用能力） |
| 要写一段通用能力（旧 R20） | build-vs-buy 三问：通用吗？别人怎么做（实查，不凭记忆）？在不在护城河上（在就自研到底，不在就用标准实现或行为对齐标准）？ | `check:self-written` |
| 接框架 / SDK / 运行时（R5.4） | 四列表 + 参考实现逐层对照 + 逐字段裁决 | `check:framework-boundary`、`check:framework-surface` |
| 外部也读写的格式 / 协议 / 契约（旧 R31，建议） | 先找规范或事实标准，写「规范链接 / 我们的偏差 / 偏差理由」；扩展只放标准留的扩展点，不另起平行文件；**偏好不是理由** | 无（原 `check:standard-formats` 零红已删） |

判据速查：护城河（账本、预算 / 收据 / 幂等、锚一致性、Proposal 撤销、能力核权限）自研到底；标准协议 / 边界（MCP JSON-RPC、Electron IPC 合同、schema 校验、请求生命周期）用标准或对齐标准；通用交互内核先把瞬时状态和领域状态分开再谈换；已用成熟库（R3F、Tiptap、Leafer、TanStack Virtual）别迁移，修用法。

### R5.1 查官方文档（建议档）

- 碰第三方库：`resolve-library-id` → `query-docs`，照官方推荐实现，官方没有才自定义并注释理由。Context7 没加载就退回官方站。
- **只吃近期**：搜资料 / 开源项目必须看发布 / 更新时间，默认近 6–12 个月，每条结论标来源日期，写「最新 / SOTA」前先确认它现在还是。
- **实查对象是「现役」不是「本机」**：本机已装版本的 `-h` / 行为不算实查（栽过：拿旧版 CLI 断言「不支持某模型」，官方新版早已支持）。
- **接入或修改任何模型，动手前先拿真实官方 API 文档**（hook 每次碰模型接入文件都提醒）：逐项对账端点与方法、鉴权、全部变体、全部生成模式、全部参数（名字 / 类型 / 枚举 / 默认 / 上下限），禁止凭记忆填；没查到的写「文档未写明」，不许填猜的数字。
- **三段标准作业**：① 文档给依据（出处 URL + 日期落库；报错信息只是线索）；② 零额度给覆盖（合同测试 + 请求构造干跑逐字段比对 + 免费探针，全部模式无一漏过）；③ 付费给封印（每模型一发最小参数真实生成，带参考输入的模式优先，产物亲眼双验：提示词特征 + 参考特征；余额不足诚实记 unverified）。验收类测试默认走回环假供应商，需要真实生成时显式声明额度（每模型 1 次、最低档、事后如实报花了多少）。
- 选型 / 引入新框架时，实查当前现役框架与技术栈，不凭记忆判断新旧或是否被取代，再给用户对比表。

### R5.4 接框架：四列表 + 参考实现逐层对照 + 逐字段裁决

**触发**：引入 / 接入 / 升级任何框架 SDK 运行时，**或用它一个此前没用过的层**。动手前在 `docs/research/` 或 `docs/plan/` 出三份交付物，每格带 `file:line` 或文档 URL：

1. **四列表**：它提供 / 我们用了 / 我们另写了 / 我们拆散了。派工 brief 必须附这张表。结论翻译成 `docs/engineering/framework-boundaries.json` 的规则，跑 `pnpm run check:framework-boundary`；存量按债登记（绑收敛方案和到期日，到期不清零就红）。
2. **参考实现逐层对照**（`docs/research/<日期>-<框架>-reference-implementation-conformance.md`，模板 `docs/research/TEMPLATE-reference-conformance.md`）：框架自带的参考实现按九层（工具 / 转录渲染 / 会话 / 上下文 / 模型与花费 / 控制流 / 扩展 API / 观测与测试 / 安全）逐层摆在我们旁边，每层判「一致 / 有意不同（理由须是领域约束）/ 没想到」；全是「一致」说明抄了，全是「有意不同」说明没看。「没想到」清单是实施阶段的前置门。
3. **framework-surface 逐字段裁决**：框架公开的每个字段都有一条裁决：`derived` / `constant`（值 + 领域约束理由）/ `unused` / `upstream-default` / `debt`（到期日 + owner）。字段由机器从 `.d.ts` 抽，`check:framework-surface` 校验；抽到 0 个字段也红。门岗和抽取器框架无关。

教训（接 pi SDK 只接了最底层 loop、逐工具可选字段被一刀切硬写）见 [`lessons/framework-and-external-contract-lessons.md`](lessons/framework-and-external-contract-lessons.md)。

## R8 先出可视样张

**触发**：任何用户会看到的东西。**碰花钱 / 长跑 / 可打断 / 新界面先写设计卡**（[`engineering/design-card.md`](engineering/design-card.md)）；纯样张流程如下：

0. **先看这个 UI 真实当前长什么样**（改 / 扩现有界面必做）：读完整渲染外壳组件，或看 `docs/design/app-screenshots-*` 真实截图。样张 = 真实布局 + 你的改动，不准从零散片段在脑子里拼整体。
1. 先读 `docs/design/nomi-design-system.md` 与 `src/design/` 现有组件；token-only（禁非 token 的 px / hex / 圆角）；Nomi 品牌用真品牌（`NomiWordmark` / `NomiLogoMark`）。
2. 拍板样张必须是设计实验室里由生产组件 + 真实宿主数据（ShellStage 手法）搭出的屏；新组件还没有时，先在生产目录写组件本体，实验室只给数据，不在 devlab 另画 JSX。手写 HTML / 交互 widget 只允许标 `exploration` 做布局 A/B 等方向探索，不能进入验收合同。
3. 用户确认后才实现；确认后的生产代码就是那张实验室屏，不再另起一套复刻实现。
4. 实现后做**整张对账表**：样张每个区域各占一行，状态只能是「一致」「差异 + 原因」或「推迟到某阶段」，不许只挑几条；实验室屏的 `data-mockup-region` 每个都必须有对应行。截图并排比，每处差异当场补齐或说明暂缓原因。样张是验收合同，不是参考图。
5. 任何新功能 / 新对象，讲它在用户旅程哪一步出现、在界面哪几处露出、怎么被用到时，出一张可视路径图，别让用户靠文字拼。
6. 设计落地 = 规范驱动 + computed style 核对：改完跑 `tests/ux/design-fidelity.e2e.mjs`；加自定义 Tailwind token 同步进 `cn()` 的 `extendTailwindMerge`。新验收合同必须登记 `labScreen`（屏、状态、宿主、生产组件、`data-mockup-region` 对账表），并跑 `pnpm run check:mockup-contracts`。

## R9 模块化 + 防巨壳（含旧 R12）

写码前先想清楚分层：这块逻辑该放哪一层（UI / 状态 / 领域 / runtime / 持久化）、新东西和现有内核的边界、会不会引入第二份真相源（→ R1）。单个非测试 `.ts` / `.tsx` 文件硬上限 800 行，存量巨壳列白名单并记录基线行数、棘轮只减不增；门岗 `pnpm run check:filesize`。

## R11 交付与状态（含旧 R19）

**推送**：完成一个有意义、验证通过的改动就自己 commit + push，不等用户催。开始前在独立 sibling worktree 的任务分支跑 `pnpm run delivery:preflight`（一次有超时的非交互 fetch，拒绝受保护分支、脏工作树和未含最新远端基线的分支）。验证档位按 R22；连续小修先本地收敛，定向验证通过后只推一次。一个逻辑改动一个 commit，message 写做了什么 + 为什么 + 验证结果。例外先问：改动未验证、破坏性操作（删历史 / force push / 发版 tag）、用户说先别提交、混入多个不相关改动。

**状态词只有四档**（把侧分支里的实现状态误报成「用户拿得到的解决状态」是这条的起因）：

1. **已实现、未推送**：只在本地。必须给工作树、分支、提交。
2. **已推送、待合入**：远端侧分支有提交，目标分支没有。必须给分支 / PR。
3. **已合入、待验证**：目标分支包含提交，但目标分支门禁或真实用户任务未通过。只能称「已合入」。
4. **已解决**：修复在用户指定的远端目标分支，且该分支上必需门禁与真实用户任务都通过。

**机械证据**：报「已解决」前拿到 merge commit SHA，在该提交上跑 `pnpm run delivery:verify-merged -- --expected-sha <sha>`（要求 HEAD、远端目标分支、expected SHA 完全一致，记录 commit / tree 两种身份）。身份检查失败就降级状态；禁止用 REST compare、commit message 重放或低层 Git 对象合成伪造远端身份；未推送提交不得被引用为团队现状；删分支前逐提交审计；完成报告同时给目标分支、远端 commit、验证结果；用户要求验收后再合入的，只能报「待验收修复」。

## R13 完成标准（= P3 · 含旧 R16 / R30 / R32）

P3「全绿不等于完成」的量化门。三档触发：

| 触发 | 必做 |
|---|---|
| 用户可见改动 / 把任何可看的东西交给用户 | 和获批样张逐项对账 + 眼见链四问 + 位置断言 + zh/en 双语真截图 + 真人乱输路径（R13.1） |
| 功能交付（尤其用户可见 / 体感） | 设计卡 ★1 的 2–3 条真实用户任务跑通闭环，冒出的问题全修掉，重跑到干净 |
| Agent / 工具定义 / 工具契约 / 系统提示词 / 模型档案改动 | 工具写对率 + 回合成功率两个数字写进 PR 正文（R13.1 后半） |

**四件真实**（缺一件，这条测试不成立；起因：第一次拿用户真实素材跑，导入和 S 规模进画布当场炸，而合成夹具的画布基准跑了几十轮从没红）：

| # | 必备件 | 什么不算 | 判据 |
|---|---|---|---|
| ① | 真实应用 | 组件夹具 / 设计实验室 / dev server 一页 / vitest mount 的树 | 走查报告有构建戳且与被验证 commit 对得上 |
| ② | 真实页面输入 | 往 store 灌状态、E2E 桥、夹具 JSON、`page.evaluate` 改状态、直接写快照绕过导入 | 输入只有 `mouse` / `keyboard` / `locator.click\|fill\|hover\|dragTo`；`evaluate` 只许出现在标注的准备阶段 |
| ③ | 真实工具轨迹 | 手写合法参数喂单测 | 真模型跑出的调用序列 → 写对率 + 回合成功率 |
| ④ | 真实素材 | `testsrc2` 色块、1px 占位图、2 秒 crf-35 的 720p | 登记在 `tests/ux/real-media-fixtures.json`，路径走 `NOMI_REAL_MEDIA_DIR`，门岗 `check:real-media-fixture` |

缺素材时红不是跳；CI 素材未就位期间登记为 `docs/engineering/real-media-debt.json` 里带到期日（≤30 天）的债。没有真实资源（供应商 key、ComfyUI、外部宿主、跨版本升级）记 `unverified`，不许 mock 绿灯顶替。单元测试与设计实验室基线不声称证明「能用」，规则拦的是拿它们当验收结论。执行版：[`engineering/acceptance-walkthrough-doctrine.md`](engineering/acceptance-walkthrough-doctrine.md)。

### R13.1 穿透式体验走查与 Agent 数字（建议档 · 含旧 R13.3 / R30）

**走查**：Playwright `_electron` 驱动真实 app，按真实用户旅程逐步截图，以真实用户视角判断顺不顺、美不美。触发：用户可见改动报完成前、把任何可运行 / 可看的东西交给用户前（交付 = 报完成）、整条功能链实现完成、用户反馈用不顺、重构后确认主链路、≥25 commit 或发版前。

**眼见链四问，缺一环 = 没走查**：① 截图存在吗；② 我 Read 过吗（产出 ≠ 消费，Stop hook `completion-check.sh` 查眼不查嘴）；③ 它来自用户所见物吗（同构建、生产构建非 dev、同平台分支）；④ 它拍得到改动区吗（`capturePage` 拍不到子 view；打开态 / 弹层逐个打开拍）。

**走查三升级**：位置断言（对照样张断言控件的位置 / 归属，不只断言存在）；zh/en 两轨真截图都亲眼 Read（英文串比中文长 1.5–2 倍，只有眼睛看得出截断）；真人乱输路径（瞎写的 API key 必须诚实报错、空态、关不掉的弹层、断供应商）。有打开态的 UI 交付前逐个打开截图，几何实测（`getBoundingClientRect` 对照祖先 overflow 与视口），落成可复跑断言。

**旅程是创作目标不是功能探索**，格式「我有 [输入]，我想得到 [输出]，成功标准是 [可验证结果]」。标准旅程 J1 产品宣传视频、J2 故事到漫画短片、J3 新用户 30 秒上手、J4 参考图驱动生成、J5 修改旧节点并导出；发布前全过一遍。

**工具栈**：`tests/ux/ui-driver.mjs` + `tests/ux/ui.mjs`（常驻交互式驱动，探索与调 UI 首选，用完 `quit`）；`tests/ux/walkthrough.mjs`（一次性走查）；`tests/ux/smoke.e2e.mjs`（`pnpm run test:e2e`）。一次性走查的 finally 必须 `app.close()` 竞速 8s 后 SIGKILL，迭代结束 `pnpm run kill:zombies`。

**Agent 数字**：任何 Agent / 工具定义 / 工具契约 / 系统提示词 / 模型档案改动，PR 正文写两个数：**工具写对率**（模型产出的参数通过运行时校验并成功执行的比例，零额度回放夹具逐工具计数，落点 `tests/agent-tools/<toolName>.case.json`）与**回合成功率**（真实用户任务从提问到可用产物无需人接手的比例，小额真实模型定期跑）。**红线：外观绿不等于接好了**——设计实验室基线只证长相，走查截图只证界面在，都不证明按下去会发生事。采集方法见 doctrine §二.2、§二.6。

## R14 周期审计（建议档 · 含旧 R14.1 / R14.2）

满 25 个 main commit 或发版前：多维 subagent 深审真实代码 + 走查（R13.1）+ 同一语义有几份定义横扫，落 `docs/audit/<date>-*.md`（现状 + 分级问题带 `file:line` + 路线），清 P0。自写登记复查：`self-written.json` 里 `to-replace` / `under-review` / `revisitBy` 到期 / 「框架后来已经提供了」的项逐条列进替换计划（`pnpm run audit:self-written`）。

**同一语义有几份定义**：重复实现通常是写新代码时没检索到第一套，P1 拦不住。新增或修改下列合同前先 `rg` 横扫现有 owner，把复用点或独立理由写清。机器守一部分：`pnpm run check:vocabularies`（TS AST 扫字符串 union / `z.enum` / `as const` / `Set`，按「文件 + 声明路径」登记 owner；第二份相同 owner、新增词表、成员漂移、陈旧基线、空 reason、debt 超上限都红；基线 `registered` / `debt` / `converged` 三桶，`debtCap` 只减不增）。机器查不到、必须人工横扫的七维：工具面（同一操作各入口叫什么、走不走同一 executor）、可见性 / 过滤口径、标识符（一个对象一个主键）、格式契约（是否自造生态已有的信封）、字段取值来源（一条取值链）、确认 / 权限面（放行只有一个真相源）、规则的路径覆盖。**最难查的一族是只做了一半**：加了「列」的过滤，「读」是否复用同一判定？加了「写」的校验，「改 / 删」呢？加了「导入」，「导出」是否同构？加了内部工具，外部 MCP 是否投影同一能力定义？

每次审计固定加三条：依赖框架四列表重跑（对账 `framework-boundaries.json` 债条目）；核心链路用真实模型量工具写对率与回合成功率；重造清单反向扫（新增文件名与导出符号命中框架能力词的，逐个问「框架里是不是已经有了」）。

## R15 可见文字国际化

所有用户能看到或辅助技术能读到的产品文字（正文、按钮、菜单、标签、占位符、`title`、`aria-label`、toast、确认框、空 / 加载 / 错误态）：

1. 放进 `src/i18n/resources.ts`，组件用 `useTranslation()`，非 React 用共享 `i18n.t()`；禁止新增硬编码中文或英文 UI 文案。
2. 默认 `zh-CN`，仅支持 `zh-CN` 与 `en`，不按系统语言切换；用户选择持久化并同步 `document.documentElement.lang`。
3. 两种语言同一个改动内补齐，同名 key 结构一致；插值用命名参数，不拼接可翻译句子。
4. 不翻译用户内容、模型原始输出、AI / 系统提示词、协议字段、事件名、官方名称、路径与日志诊断。
5. `pnpm run check:i18n` 是零遗留门岗（JSX、常见可见对象字段、Electron 原生界面）；协议 / 提示词 / 稳定元数据只用脚本内带原因的窄豁免，不允许用基线接受国际化债务。`check:i18n-key-refs` 静态提取 `src/` 全部翻译引用，对照 `resources.ts` 真实合并键树，解析不到就红。
6. 验收：`zh-CN` 与 `en` 各走查一次并验证刷新后语言保持；全 App 双语扫查见 `tests/ux/i18n-sweep.walk.mjs`。

## R17 防线建在最早能拦住的那层（含旧 R18 / R26 / R28 · 棘轮门岗族）

**规则**：能让类型系统拦的别留给门岗，能让门岗拦的别留给人肉 review。**安全关键依赖不许写成 optional 成员再配欠账登记**——登记只是备忘录，不阻止下一个人合法地漏传；能力确实可能不存在时用显式 `unsupported` 返回值，不用 `undefined`。自检：写下 `foo?:` 或往基线加一条时问「漏了它会怎样」，答案是「运行时静默降级」且碰钱 / 权限 / 数据完整性，就不该可选。（起因：打包态确认门恒拒——可选成员漏传是合法 TypeScript，开发态 43/43 全绿、打包态 15/43。）

**棘轮门岗族的共同规矩**（新加任何棘轮门岗照办）：

1. 基线只减不增，存身份不存裸数字（裸数字放过「删一处旧的、同 commit 加一处新的」）。
2. 加规则必须先验它会红：临时塞一处违规 → 跑门岗确认报红且 `file:line` 对 → 删掉。有「合法例外」的规则再补一发反向控制。只验过绿的门岗不算门岗。
3. 先问存量是债还是本来就对：是债才进基线，本来就对的在扫描器里判合规。
4. 门岗红了先读它红在哪条判据，别改预算或抬基线挤 PR。
5. 被忽略的门岗等于不存在：误报多的门岗要改判据或自动修，别让人习惯性跳过。

**成员**：重活 `check:heavy-path` ｜测试等待 `check:test-waits`（硬零）｜分层边界 `check:boundaries` ｜`check:tokens` ｜`check:vocabularies` ｜`check:i18n`（硬零）｜`check:framework-boundary` / `check:framework-surface` ｜`check:real-media-fixture` ｜`check:concept-owners`（警告档）。

**重活门岗（旧 R17.1，用户体感「卡死」的一族）** `scripts/check-heavy-path.mjs` + `scripts/heavy-path-baseline.json`，每条规则各自棘轮：`sync-image-encode`（`toDataURL()` 同步编码冻界面，改用 `convertToBlob()` / `toBlob()`）；`base64-into-store`（base64 进 store 被深拷贝 / 撤销日志 / IPC / 每次保存全量序列化，改用 `persistNodeImageBlob()` 落盘换 `nomi-local://`）；`duplicate-node-size-bounds`（在 `nodeSizing` 外重声明尺寸常量，布局与渲染错位，尺寸只有一个真相源）；`node-stream-into-response`（Node 流交给 undici，大视频拖进度条抛 `ERR_INVALID_STATE`，改用 `createOwnedFileStream()`）；`unguarded-fsync`（`electron/durability.ts` 之外直接 `fs.fsyncSync`，CI 磁盘队列深时才红，文件 fd 用 `fsyncIfDurable(fd)`；判据是「有没有过闸」不是「在哪个文件」，基线为 0）。`stripComments()` 必须逐行等高，否则 `file:line` 点开是别处。加新规则：修完 bug → 判断通用 → 全仓实扫 → 加进 `RULES`（hint 必须给替代写法）→ `--update-baseline`。

**测试等待门岗（旧 R17.2）** `check:test-waits`（硬零）：测试里的私有 `waitFor` 定义与 `Date.now()` 截止轮询判红，直接写死 ≥5000ms 同判；等 detached driver 一律用 `productionRunTestHelpers.waitForProduction`（全仓唯一等待实现）；站点等待按调用指纹登记存量，只减不增。

**分层边界门岗（旧 R17.3）** `check:boundaries`（`dependency-cruiser`，规则 `.dependency-cruiser.mjs`，基线 `scripts/boundaries-baseline.json`）：`src/` → `electron/` 存量冻结只减不增（走 `src/desktop/bridge.ts` 或 `electron/shared/contracts/`）；`electron/` → `src/` 与 `src/` → `scripts/` 硬零；新增完全静态循环（非 dynamic-import、非 type-only）判红，存量冻结。归属地图 `docs/architecture/module-ownership-map.md`。

## RW 方向检查（旧 R21.2「重写判据」升级，试用到 2026-10-15）

**触发**（任一即停止派修补）：① 同一文件或同一概念目录，14 天内第 3 个 fix 提交；② 出现 revert 一个 fix 的提交；③ 修复因评测分数下降被回滚；④ 同一条线派第 3 轮及以上修补（交接单 / 任务书里的「第 N 轮」同样算）；⑤ 要加第三个特例分支。①② 由 `node scripts/fix-churn.mjs` 计算（目录只认「概念大小」：fix 碰过的不同源码文件 ≤6 个，忙碌大目录不整体算，否则回测里几乎每个 fix 都命中）；③④⑤ 靠人工和任务书检查。

**动作**：先写特征测试钉住现状，再做「类根因复盘」一页（模板 [`direction-check-template.md`](engineering/direction-check-template.md)：归类表、为什么一直冒、不改结构的 2–3 个可验证预测、靶子独立性检查、P0 现成方案、补 / 重写 / 删对比 + 推荐、用户要权衡的核心），结构性结论交用户拍板。选重写时范围限一个模块，同一次提交删掉旧的（P1）。根因合同可带 `rewrite_decision: { decision, characterization_test }`，写了就必须成立。

**执行点（谁执行都绕不过）**：git commit-msg `scripts/check-direction-trailer.mjs`（fix 提交碰热点必须带 `Direction-Check: <复盘文档路径>`，文档须在 `docs/` 下、存在、不是空壳；按内容判，没有环境变量开关；revert 与 merge 不拦）；派工前 `fix-churn.mjs`；CI contracts 里只警告的 `Direction check` 步骤（兜 `--no-verify`）；Claude 编辑提醒 `edit-time-reminder`（调同一个计数器，只提醒）；`self-check` 在用户消息出现「第 N 轮 / 再修 / 又坏了 / 还是不对」时注入提示块。起因与限制见编排手册 §20。

## P2 修复走根因流程（旧 R21 / R21.1 / R21.3）

**触发**：所有 bug、回归、CI / 平台失败、flaky、性能 / 安全问题和评审发现，不按目录或改动大小豁免。方法只住在 `.agents/skills/root-cause-remediation/SKILL.md`。可复发 / 高风险 / 逃逸 bug 在改代码前提交 schema-v3 `docs/fixes/*.root-cause.json`；`pnpm run check:root-cause-contracts` **只对 schema 不合法阻断，其余降为警告**，合同强制由合并前扫描（`scripts/merge-preflight.mjs`）查修的是逃逸 bug 的情形；「第二次修同一类问题」目前**暂未检查**，靠协调会话人工。v3 新增 `recurrence_check_on`（默认合并日 + 30 天）与 `detected_by`（user / post-release / walkthrough / ci / review）：新合同属 recurring、高风险或逃逸 bug（`detected_by` 为 user 或 post-release）时两项必填，老合同按日期前缀豁免。

**第三个问题（`invariant_owner_layer`，2026-09-07 起）**：这条不变量从此归哪层管、那一层有没有测试？填 `layer`（确实没人管填 `none`）、`tests`、`structural_ticket`（`none` 或无测试时必填且必须存在）。填 `none` 是诚实答案，代价是一份结构工单。

**先数门（`doors`，2026-09-11 起）**：不变量碰到的那份状态一共有几扇入口？连着三簇 bug 都是「不变量只在一扇门上实现，另一个入口绕过去」。合同带 `doors` 与 `door_reduction { before, after, why_not }`；**门表用脚本生成不手写**：`node scripts/door-map.mjs <符号或文件>`（TS compiler API，约 1 秒）。门的身份 = 文件 + 符号，不含行号；合同检查自己调 door-map 核对（path 存在、符号对得上、`after` 等于 `doors.length`、`before ≥ 2` 而没减时 `why_not` 必填、改动里属 `scope_paths` 的生产文件 ⊆ 门表）。允许不减、不允许无声地不减；只数直接调用点不做传递闭包。派工侧：复发类修复先派数门工人，任务书引用门表（编排手册）。

## R22 验证分层与测试预算

目标不是少测，而是把反馈成本花在真正可能受影响的地方：小改动尽快反馈，高风险绝不降级。

| 风险面 | 触发 | 验证 |
|---|---|---|
| contracts | 所有 PR 与 main push | 静态合同、lint、typecheck、结构门岗 |
| unit | 普通隔离改动 focused；Electron、模型执行、画布、基础设施 full | changed / sibling / related 或全量 Vitest |
| desktop | Electron 与桌面运行边界 | 一次 build + Electron smoke |
| journeys | Agent、模型执行、真实工作流边界 | CI-safe J3/J5 真实用户旅程 |
| canvas | 生成画布 critical；React Flow 内核 full | 功能画布验收，不含性能 benchmark |
| performance | React Flow viewport、节点媒体渲染 / 调度、性能基准自身 | 独立性能预算，`pass:false` 必须非零退出 |
| package | 依赖 / 构建配置、Electron main / preload identity、release 边界 | macOS build、目录打包、codesign |

权威实现是 `scripts/validation-policy.mjs`（**认不出的路径默认跑全量**）；`scripts/select-quality-gate-profile.mjs` 只从 Git diff / 事件取输入，CI workflow 与本机 `pnpm run gates` 只消费输出。**必须保留的测试**：凭据不出主进程、SSRF / 重定向 / 私网边界、认证与发布状态机、幂等 / 并发 / 取消、崩溃恢复与升级持久化、迁移与 unknown reconcile、媒体验真、真实入口 round-trip、安装包身份与签名。可 focused 的是同目录 sibling test 与 import graph 的 related tests；可简化的是重复 fixture / helper，先证行为覆盖等价再合并，不用删测试换速度。没有真实资源记 `unverified`。一个逻辑批次完成后跑一次定向验证再统一推送，只有测试基础设施自身、删除 / 重命名、无法分类或手动 release 才跑显式全维度。

**分支定性先算 merge-base**：评审、对账或打捞任何分支前先 `git merge-base origin/main <branch>`，真实 authored delta = `MB..branch`；两点视图里的大片删除第一假设是「main 在分支落后期间前进了」。最终交付在真实 merged-main SHA 上跑 `pnpm run delivery:verify-merged`，等待该 exact SHA 的 `Quality Gate` 与 `Mac Package` check run，不本地跑第三遍。

## R27 多智能体编排

任务书带开工三行头与概念占用；收货三查；一个概念一个 PR、按阶段攒（提交不压缩）；协调会话运作（状态落盘、工人不建卡不直接问用户、CI 绿 + 扫描干净才合、最多 3 个等收据）。正文：[`engineering/agent-orchestration-playbook.md`](engineering/agent-orchestration-playbook.md)。

**省 token（2026-10-04）**：派活前先数轮次，同一处第 3 轮就停改派复盘；协调会话不读大文件全文（先看大小和标题，按段读；读子 agent 结论不读过程）；子 agent 同时最多 3 个、默认 Sonnet、不再派子 agent；任务书写清范围 / 不碰清单 / 停点（`scripts/check-dispatch-brief.mjs`）；确定性的活用脚本；长输出落文件；卡住 3 次就停下报告。详见编排手册 §20。

## R33 概念的 owner 先于目录（含 R33.2 – R33.5）

派工切的是概念不是文件夹：并行 lane 按目录派工时，同一概念在合并前就各自长出第二份实现，两条 lane 改的文件一个都不重叠，`git merge` 看不见，而两份都有测试都绿。

- **谁说了算在动手前回答**：设计卡 ★2 格写概念 → 唯一 owner（`concept-owners/` 的 id）→ 允许的消费者；owner 落到文件 + 符号，owner 未定标 `pending` 并写清由哪份任务书收口。
- **同一时段同一概念只归一条 lane**（R33.2）：编排者维护全局占用表；跨概念改动只能由持有者做或等它合并；目录不冲突不是理由。
- **验收多一问**（R33.3）：这一刀有没有让任何概念多出第二个 owner（第二份状态 / 规则 / 判据，或渲染层替主进程做决定的补偿逻辑）？有就打回，测试绿不作放行理由。
- **概念登记表** `docs/engineering/concept-owners/`（R33.4；一个概念一个文件 `<subject>.json`，顶层字段在 `_meta.json`，只经 `scripts/concept-registry-lib.mjs` 的 `loadConceptRegistry` 读）与 `check:concept-owners`（**警告档**，判据 `scripts/concept-owners-lib.mjs`）：只登记碰到的概念，当场登记；同一概念出现第二个写口即违规；`pending` 条目必须写 `migration_strategy`；owner 只写真实存在的文件。字段：`name` / `subject` / `lifecycle` / `authority_kind` / `trust_domain` / `fact_kind` / `migration_status` / `owner` / `write_api` / `forbidden_derivations` / `allowed_consumers` / `identity_fields`（身份比对必填）/ `parity_test` / `since` / `notes`。门岗只抓形状：同一件事换名字再写一份它看不见，那一半归对拍测试、真实旅程和收货那一问。
- **对等矩阵**（R33.5）：多入口（Agent 面板 / 画布 / 外部 MCP / 批量）共享同一概念时，要有一条会红的判据证明同源——同一输入 → 各入口出站报文逐字节相同；新入口必须登记。

## SECRET 敏感数据

禁 `--no-verify`、禁 `git add -f`；提交前敏感数据扫描不得绕过（`secret-guard.sh`、`commit-bypass-check.sh`、`check:secrets`）。

## 固化的工作纪律

**接入即验证**：一个模型 / 生成链路不算接入成功，直到一次真实 E2E 生成跑通：真机驱动 + 主进程埋点（Playwright 渲染层抓不到 vendor HTTP，它在 Electron 主进程发）→ 分层暴露问题 → 逐个挖根因 → 补可观测 + 锁回归断言。缺 archetype 的模型先补 archetype 再配 mapping，别手配。
