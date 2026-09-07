# 内置技能库扩充方案：从 shuohao-skills 及同类项目学什么、怎么进 Nomi（2026-09-07）

> 状态：📋 方案（只出文档，不写产品代码，实施等用户拍板）。
> 起因：用户给了 [`eternityspring/shuohao-skills`](https://github.com/eternityspring/shuohao-skills)，要求「看看这种 skill 对我们有没有帮助，顺便找类似的好项目，内置进我们的 skill 库，注意触发机制」。
> 基线：`origin/main@4f55e2a36`，全文 file:line 在 worktree `/Users/aoqimin/Desktop/Nomi-skill-library-research` 上实核。
> 前置阅读：[#580 技能格式收敛](2026-09-07-skill-format-convergence.md)（**已合入 main**——`skill.json` 已删，`check:skills-format` 已在 `gates:contracts` 里跑，实测 `node scripts/check-skills-format.mjs` 今天是绿的：「33 个技能全部合规，pi 加载器 33/33、零 diagnostics」）、[#582 导入闭环](2026-09-07-skill-import-real-use.md)、[阶段 3-5 深案 §3.4](2026-09-07-agent-rebuild-stage3-5-deep-plan.md#34-技能skillmd-frontmatter-唯一格式在-lane-里的注入路径与自动触发)（技能注入与自动触发的既定设计）。
> 先例：[阿泽导演技能集成](2026-08-01-azer-director-skills-integration.md)——Nomi **做过一次同类的事**：把外部开源方法论（`feicaiclub/forge`，作者本人已授权）重写成 23 个 Nomi 原生技能，「剥净 EP/S 双 agent 编排」。本方案的落地方式与它同构，差异在 §4 交代。

---

## 0. 一句话（D6）

`shuohao-skills` 和它的同类（`zenstory-ai/drama-skills` 最像）卖的不是「文字方法论」，是「**方法论 + 一套用 Bash 跑 Node/Python 脚本做的确定性质量门**」（爽点间隔、单句字数、同框人数、镜头时长……全是脚本算出来的，不是模型自己判的）。这正是它们的核心卖点，SKILL.md 里逐条写着「N 道质量门全部由脚本确定性检查，不靠模型自觉」。

**但 Nomi 的 Agent 今天没有 Bash/脚本执行工具**——这不是漏做，是设计：`electron/skills/skillPackage.ts:29-31` 的注释写得很明白：「v1 只吃知识层：`scripts/` 是可执行代码，进来就要配安全扫描 + 沙箱（**Nomi 是创作工具不是 coding agent**，技能价值在方法论）」。所以这两个仓库没法整包搬进来直接跑——那套质量门在 Nomi 里是死代码。

**你要权衡的核心东西**：要不要为了拿到「脚本自动查错」这个卖点，去开一个新的执行能力口子（给 Agent 一把沙箱化的脚本执行权）？这是一个新的攻击面、要过 R28（安全关键依赖不许「optional+欠账登记」）的硬门槛，本方案不建议现在开。**推荐的做法是只拿「方法论」这一半**——把两个仓库里模型能直接照做、不需要跑代码就能生效的经验（MiniMax H3 提示词写法、短剧节奏的数字基准、连续性检查清单、审查与修改分轮的纪律）**改写进 Nomi 自己的 SKILL.md**，跟阿泽那次做法一样。质量门那一半（脚本强制检查）留成一张后续独立方案的单，不在本批里做。

---

## 先查别人

模板四问，答满四条，每条带出处（URL 或 file:line）：

- **依赖里已有？** 不适用——本方案不新增任何 npm/pip 依赖或运行时能力，纯技能内容（`skills/` 下的 Markdown），没有依赖面要查。
- **仓库里已有？** 有，而且覆盖面很大：`skills/writer-novel-digester/SKILL.md:1-3`（原著拆解，分层读取）、`skills/drama-short/SKILL.md`（短剧全流程 stages 编排）、`skills/workbench-storyboard-planner/SKILL.md`（分镜规划师）、`skills/director-shot-translation/SKILL.md:1-3`（模型无关的运镜翻译）、`skills/director-consistency/SKILL.md:1-3`（五维一致性）、`skills/writer-review/SKILL.md:1-3`（导演视角审剧本）、`skills/writer-adaptation/SKILL.md:1-3`（改编策略五步）——§2.5 逐条对照后发现两个候选仓库 90% 的内容 Nomi 已有等价或更强的实现（画布原生 anchor 节点 vs 静态 JSON 文件）。
- **生态里已有？** 有，`gh search repos`（`stars:">=300"`）交叉验证找到 8 个候选，详见下方 §1 候选表：[`eternityspring/shuohao-skills`](https://github.com/eternityspring/shuohao-skills)（Apache-2.0，3097★）、[`zenstory-ai/drama-skills`](https://github.com/zenstory-ai/drama-skills)（MIT，1654★）、[`calesthio/OpenMontage`](https://github.com/calesthio/OpenMontage)（AGPL-3.0，56493★，license 排除）、[`HKUDS/ViMax`](https://github.com/HKUDS/ViMax)（MIT，12286★，非技能格式，Nomi 已在用它的方法论——`src/workbench/generationCanvas/agent/storyboardPromptCompiler.ts:32-33`）、[`Vincentwei1021/video-shotcraft`](https://github.com/Vincentwei1021/video-shotcraft)（Apache-2.0，7669★，域不对）。官方规范逐条对照见 [`platform.claude.com/.../agent-skills/best-practices`](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)（2026-09-07 实抓，§4.1 表）。
- **TikHub 自媒体里怎么说？** 192 条实抓（`docs/research/2026-09-07-builtin-skill-library/tikhub/kw1-shortdrama-skill/tikhub-search.md` 等 4 份），多条独立证实 `shuohao-skills` 是「AI 短剧剧本工作流」的主力选择——[X 帖「最近好多朋友问我 AI 短剧剧本的工作流用什么？统一回复：shuohao-skills……14 道质量门脚本自动检查」](https://x.com/servasyy_ai/status/2095764117433061460)，印证了 §0 的判断：卖点是脚本，不是文字。
- **结论**：不整体照搬（自研/沿用现有实现），只摘录改写两处真空白/补丁进现有技能库（§3）——理由见 §2.5 的重叠分析与 §0 的架构不兼容判断。

## 1. 候选表

用 TikHub（48+48+48+48=192 条实抓，见 `docs/research/2026-09-07-builtin-skill-library/tikhub/`）+ `gh search repos`（`stars:">=300"`、近 60 天有提交）交叉找到的候选。**每个都实读了 SKILL.md 原文**（不采信 TikHub 帖子的二手转述，只用它来发现线索）。

| # | 仓库 | 许可证 | ★ | 最近提交 | 技能数 | 格式 | 判定 |
|---|---|---|---|---|---|---|---|
| 1 | [`eternityspring/shuohao-skills`](https://github.com/eternityspring/shuohao-skills) | Apache-2.0 | 3097 | 2026-08-26 | 5（novel-outline/characters/art/script/storyboard） | **非官方**：`version`/`allowed-tools`/`triggers` 顶层键+`metadata.{license,requires,runtimes}`，`description` 用 YAML 块标量（未超 1024 字符上限，实测 280-564 字） | **§3 方法论抽取** |
| 2 | [`zenstory-ai/drama-skills`](https://github.com/zenstory-ai/drama-skills) | MIT | 1654 | **今天**（2026-09-07，PR #107） | 9（router+develop+novel-analyze+assets+write+storyboard+image/video-prompts+review） | **接近官方**：仅 `name`/`description`/`license` 三个顶层键，`license` 是唯一超纲字段；`description` 全部第三人称、trigger 短语齐全，实测 120-230 字符，比官方例句更紧凑 | **§3 方法论抽取**（首选） |
| 3 | [`calesthio/OpenMontage`](https://github.com/calesthio/OpenMontage) | **AGPL-3.0** | 56493 | 2026-09-06 | 700+ skill/production-knowledge 文件、100+ 工具、12 条产线 | 未深读——license 已经排除 | **不采用**：AGPL-3.0 的强传染性对闭源分发的 Electron 应用不友好，法务风险 > 收益；TikHub 上被吹得最响（「34000+星」「52个工具、500+ skills」的帖子指的就是它），星数今天已到 5.6 万，热度归热度，license 是硬闸 |
| 4 | [`HKUDS/ViMax`](https://github.com/HKUDS/ViMax) | MIT | 12286 | 2026-07-29 | 不是 Agent Skills 格式——是一整套独立运行的 agentic 视频生成框架（Director/Screenwriter/Producer/Generator 全家桶） | 不适用 | **不是候选，是已用过的方法论源**：Nomi 自己的 `storyboardPromptCompiler.ts:32-45` 早就在按 ViMax 的 static/dynamic 身份分层法写定妆卡 prompt（"对齐 ViMax：身份只看 static"），本轮不重复调研 |
| 5 | [`Vincentwei1021/video-shotcraft`](https://github.com/Vincentwei1021/video-shotcraft) | Apache-2.0 | 7669 | 2026-09-05 | 1（含 152 张镜头配方卡+209 条运镜预览） | Claude Code Plugin 格式（`.claude-plugin/plugin.json`） | **不采用，域不对**：整套围绕 Remotion（React 渲染引擎）产出产品宣传片的 motion graphics，不是 AI 图生视频/文生视频——Nomi 走的是喂参考图给 Seedance/可灵/H3 这类生成模型，不是拼 React 组件渲染 |
| 6 | [`VoltAgent/awesome-agent-skills`](https://github.com/VoltAgent/awesome-agent-skills) | MIT | 33874 | 今天 | 1000+（索引） | 索引仓库，本身不是技能 | **不是候选，是发现渠道**：本轮候选 1/2/5 都是靠 `gh search repos` 独立找到、逐个验证的，没有依赖这份索引的判断力 |
| 7 | [`SlavaSexton/ComfyUI-Agent-Kit`](https://github.com/SlavaSexton/ComfyUI-Agent-Kit) | Apache-2.0 | 94 | 2026-09-03 | 1（含 Seedance/Krea/MiniMax H3 独立子技能） | 未读 | **不达标（<300★），仅footnote**：本机确有真 ComfyUI（`~/ComfyUI`），未来若做 ComfyUI 工作流技能可回头看，本轮不展开 |
| 8 | [`Coconah/AI-Short-Drama-Agent-Skill`](https://github.com/Coconah/AI-Short-Drama-Agent-Skill) | 无 | 14 | 2026-03-12 | 1 | 未读 | **不达标（<300★），仅footnote** |

**排除的理由需要诚实标注（P1）**：#3 是热度最高但 license 不过；#4/#6 根本不是同一形状（框架 / 索引，不是技能包）；#5 是同名词不同域（storyboard 词面重合，实际是网页动效）。真正命中「novel → 短剧全链路 skill 包，Claude Code/Codex 可跑」这个用户原话形状的，只有 #1、#2 两个。

---

## 2. 逐个技能拆开看（R29 精神）——以 #1 shuohao-skills 为主，#2 drama-skills 对照

### 2.1 五个 skill 各自的输入/输出/脚本

| skill | 输入 | 输出 | 脚本做什么 | 质量门数 |
|---|---|---|---|---|
| `novel-outline` | 小说全文 + 目标参数 | outline.json（改编说明/人物表/爽点表/分集梗概/资产清单） | `seed`（预填）+ `validate`（脚本硬查）+ `render`（出报告） | 14（角色分档上限、主场景上限随集数动态、爽点间隔≤3集……） |
| `novel-characters` | outline.json（可选） | cast.json + 角色设定图 | 同构，出图走 `codex $imagegen` | 未列（README 未写具体数） |
| `novel-art` | outline.json（可选） | art.json + 场景/道具设定图 | 同构 | 11 |
| `novel-script` | outline.json | script.json（场次+节拍+台词） | 同构，`--art` 联动对光照状态 | 10（时长±15%、单句≤35字、钩子前3拍兑现……） |
| `novel-storyboard` | script.json（**硬前提**）+ 上述三个（可选） | storyboard.json + 分镜图 + **H3 提示词** | 同构，`export` 出投产包 | 17（含可选第 17 道 `shot-recipe`） |

`drama-skills`（#2）是 9 个 skill 的「creator-first」路由结构：`short-drama`（路由+dashboard）→ `short-drama-novel-analyze`（只读原著分析）→ `short-drama-develop`（改编契约）→ `short-drama-write`/`short-drama-assets`/`short-drama-storyboard`（三线并行迭代）→ `short-drama-image-prompts`/`short-drama-video-prompts`（提示词）→ `short-drama-produce`（**用户明确确认后才执行**的生产）→ `short-drama-review`（**独立**审查，明确「审查与修改是两个工作单元，不代替 owner 改来源」）。

**两者的关键差异**：#1 是「一条流水线、五步走到底」；#2 是「路由+专职分工、审查角色独立且不许自己审自己改」——#2 这条纪律比 #1 更细。

### 2.2 MiniMax H3 提示词写法（#1 novel-storyboard/references/h3-prompt.md，51 行）——**这是本轮唯一确认的真空白**

Nomi 已经真实接入 MiniMax H3（`electron/catalog/apimartVideos.ts:190`「`modelKey: "MiniMax-H3"`」，走 APIMart），用户自己拍板的真实环境验收剧本就是「MiniMax H3 1–2 分钟短片」（`docs/lessons/real-env-acceptance-minimax-h3-20260906.md`）。但搜遍 `skills/` `docs/` `src/` `electron/`（关键词 `integrated_multimodal_description`、`H3` 提示词结构）——**Nomi 自己的技能库里没有这份写法**。`director-shot-translation` 是模型无关的通用运镜翻译手册（`skills/director-shot-translation/SKILL.md:1-3`：「翻译成一段能写进 Nomi 视频 shot `prompt` 字段的文字，让 Seedance / 可灵在应用内生成时不跑偏」），没有 H3 专属的 I2VA 多图对齐结构。

h3-prompt.md 讲的是官方 MiniMax-H3 提示词指南的**内化版**（作者原话：「方法论学自 MiniMax-H3 官方提示词指南，内化成本 skill 自带文档」），核心结构：

```
参考图对齐指令（Picture k 对齐目标视频第几秒）
integrated_multimodal_description: [Shot 1]...[Shot 2]...（每镜一行，切点时刻由分镜秒数推导）
overall_soundscape: 环境声/动作声（英文 1-4 句）
non_diegetic_music: 配器与速度（英文 1-3 句，没有写 N/A）
```

带台词逐字进 `<d>[Chinese] …</d>` 块、说话人 `(S1)` 编号、画外音固定句式——这些都是**纯文字方法论**，模型读了就能照做，不需要脚本。这一段是本方案唯一值得**原样**（改写后）内置的技术细节。

### 2.3 短剧节奏的数字基准（两仓库质量门判据的交集）

两边独立收敛到的经验数字（脚本强查的判据，抽出数字本身，不抽脚本）：

| 数字基准 | 来源 | Nomi 现状 |
|---|---|---|
| 单镜头 ≤15 秒（AI 视频单段生成上限） | #1 novel-storyboard | `workbench-storyboard-planner` 无此上限的显式提醒 |
| 分镜切点 2–5 秒/切 | #1 | 无 |
| 每集时长 ±15% 目标区间 | #1 novel-script | 无 |
| 单句台词 ≤35 字 | #1 | 无 |
| 钩子悬念前 3 拍内兑现 | #1 | `drama-short` 有「悬念钩子」提法但无量化拍数 |
| 爽点间隔 ≤3 集 | #1 novel-outline | 无（Nomi 目前无「集」概念的强产品化，短剧多为单集/短片） |
| 同框 ≤3 人（超了要拆解说明） | #1/#2 | `director-consistency` 讲五维一致性，未讲同框人数上限 |
| 画外音固定句式（唇形完全闭合） | #1 | 无 |

这些数字是**经验阈值**，不是脚本才能表达的东西——按官方 best-practices 的「medium freedom：带参数的模式」，写成 SKILL.md 正文里的启发式表格，模型自己应用，跟 Nomi 现有技能的写法（如 `director-shot-translation` 的「运镜翻译表」）是同一种文体，零架构改动。

### 2.4 独立审查纪律（#2 short-drama-review）

Nomi 已有 `writer-review`（导演视角审剧本，六维度）。#2 多一条纪律：「**优先由未参与当前版本创作的 reviewer 执行**……**审查与修改是两个工作单元**：本技能只定位问题、影响和必须达到的修订结果，**不在同一轮替 owner 改来源**」。`writer-review` 目前没有这条「审完别立刻自己改」的纪律——这条本身也是纯方法论，可以直接补进去。

### 2.5 与 Nomi 现有技能的重叠面（避免 P1 违规——先看有没有，再决定要不要加）

| shuohao/drama 技能 | Nomi 已有 | 重叠程度 |
|---|---|---|
| novel-outline / short-drama-develop | `writer-structure`（Truby 22步）+ `drama-short` 的 stages 编排 | 高——Nomi 已有结构方法论 + 实际落地流水线（`stages: script→...`，见 `skills/drama-short/SKILL.md`） |
| novel-characters / short-drama-assets | `director-consistency`（角色锚点）+ Nomi 的 anchor 节点体系（`PlanAnchorKind = 'character'\|'scene'\|'prop'\|'style'`，`storyboardPlan.ts:22`） | 高——Nomi 的资产管理是**画布原生**的（锚生成参考图、`anchorIds` 引用），比两仓库的「Markdown 文件登记」更强 |
| novel-art | 同上 | 高 |
| novel-script | `writer-dialogue`（Mamet）+ `writer-screenwriter` | 中——Nomi 缺的是「按语速折算时长」这类量化方法，见 §2.3 |
| novel-storyboard（结构部分） | `workbench-storyboard-planner` + `storyboardPlan.ts`/`storyboardPromptCompiler.ts` | 高——Nomi 分镜表本身就是画布节点的表格投影（`docs/lessons/shot-table-is-a-projection-of-canvas-nodes.md`），比两仓库的静态 JSON 更强（可编辑、可重生成、连真实模型） |
| novel-storyboard（**H3 提示词写法**） | **无** | **零重叠——§2.2 是真空白** |
| short-drama-novel-analyze（长篇价值快评） | `writer-novel-digester`（分层读取、偷技法） + `writer-adaptation`（改编策略五步：原著解析→戏剧点提炼→结构映射→人物迁移→改编策略） | 高——两个 Nomi 技能合起来已覆盖「怎么拆」+「值不值得拆、怎么改」 |
| short-drama-review 的「审查独立」纪律 | `writer-review`（缺这条纪律） | 中——§2.4 |

**结论**：两个仓库 90% 的内容 Nomi 已经有等价物甚至更强的实现（画布原生 vs 文件登记）。真正的增量只有两块：**H3 提示词写法**（零重叠）和**数字基准/审查纪律**（现有技能的经验值补丁）。这决定了 §3 的推荐范围很窄，不是整包搬。

---

## 3. 推荐内置的第一批（≤5，全部是「改写进 Nomi 自己的 SKILL.md」，不是复制粘贴仓库文件）

| # | 动作 | 落点 | 来源 | 为什么是它 |
|---|---|---|---|---|
| 1 | **新建**技能 `director-prompt-h3` | `skills/director-prompt-h3/SKILL.md`（新目录） | 改写自 #1 `references/h3-prompt.md`（Apache-2.0，需保留来源出处注释） | §2.2 的零重叠真空白；Nomi 已实装 H3 模型，用户亲定的真实验收剧本就用它——这是唯一「不加就是明摆着的产品缺口」的一项 |
| 2 | **增强** `workbench-storyboard-planner` | 补一节「§ 分镜时长与切点的经验基准」 | §2.3 数字基准（15 秒上限、2-5 秒/切） | 分镜规划师目前没有显式的单镜时长上限提醒，两仓库独立收敛到的数字有交叉验证的可信度 |
| 3 | **增强** `writer-structure` 或 `writer-screenwriter` | 补「单句台词字数/时长折算」的量化提法 | §2.3 数字基准（≤35字、±15%） | Nomi 的时长折算目前是代码侧算的（`DEFAULT_IMAGE_SECONDS` 等），但**剧本阶段**（生成节点前）没有台词量化基准给模型参考 |
| 4 | **增强** `director-consistency` | 补「同框人数上限」检查项到五维表 | §2.3（同框≤3人） | 现有五维（角色/场景/道具/风格/…）没有「同一画面容纳多少人」这一条，是两仓库共同验证过的实操坑 |
| 5 | **增强** `writer-review` | 补「审查与修改分轮」的纪律段 | §2.4 | 零架构成本，纯方法论纪律，防止「自己审自己当场改」这个真实存在的质量漏洞 |

**没有推荐新建 skill 来整体照搬 novel-outline/characters/art/script 五步或 drama-skills 九个 skill**：§2.5 已经证明 Nomi 现有的画布原生资产系统比它们的静态 JSON 文件登记更强，整体搬入是把强实现换成弱实现，违反 P1（不能加新的、更差的并行版）。

**许可证与署名**：#1 Apache-2.0、#2 MIT（本批未直接引用 #2，但若后续要引用需同样处理），两者的再分发条款都要求保留版权/许可声明；新建的 `director-prompt-h3` SKILL.md 顶部需带一行来源注释（模式同 `2026-08-01-azer-director-skills-integration.md` 对阿泽技能的处理——虽然阿泽那次额外取得了作者本人授权，本批是许可证已经允许的范围内改写，不强制要求，但署名是干净的工程习惯，且对齐 Apache-2.0 的 NOTICE 精神）。

---

## 4. 触发机制方案（用户特别点名）

### 4.1 三条对照：官方规范 / shuohao 怎么做 / 我们怎么做

| 环节 | 官方规范（`platform.claude.com/.../agent-skills/best-practices`，2026-09-07 实抓） | shuohao/drama 怎么做 | Nomi 怎么做（现状+本方案增量） | 偏差理由 |
|---|---|---|---|---|
| **发现** | 启动时只预载全部技能的 `name`+`description` 进系统提示词；正文按需读 | 同官方（标准 Agent Skills 加载器） | `formatNomiSkillIndex`（`agentChatV2.ts:147`）拼 `<available_skills>` 索引 + `load_skill` 工具按需读正文（阶段3-5 §3.4 已定） | 一致 |
| **自动触发** | **就是 description**：模型读索引自己判断要不要调用，官方明说「没有宿主侧分类器」 | 同官方——两仓库都靠 `description` 里写满触发短语（如 drama-skills 的「用户提出'导入小说做短剧'……时使用」） | 同上，`load_skill` 显式工具（阶段3-5 §3.4：「pi 靠 `read` 工具、文档自陈'models don't always do this'；Nomi 不给模型 `read`，技能正文也不一定在盘上」） | 一致（机制相同，Nomi 用专用工具代替通用 `read`，理由已在 §3.4 写死） |
| **显式引用** | `/skill-name`（Claude Code 的 slash 命令形式） | 同（`$novel-storyboard`、`$short-drama-storyboard` 这类 `$` 前缀） | composer 的 `/skill` chip（`agent-session.js:983-1007` 引用的 pi 语义），把正文作为用户消息内联送进 | 一致（前缀符号不同，机制同构） |
| **索引常驻 vs 正文按需的 token 预算** | 官方未给具体数字，只说「metadata 预载、正文按需」 | 未量化 | **本方案量化**：实测 Nomi 现有 33 个技能 `description` 均长 111 字符，索引总字符 3695，≈2300 token（仅 description，不含 XML 包装）；新增 1 个 + 增强 4 个（增强不改 description，只改正文）＝索引增量 ≈1 条 description（~110 字符，~70 token），**索引总量增幅 <3%**，正文（`director-prompt-h3` 预估 ≤150 行、其余 4 处增强各 ≤30 行）只在被 `load_skill`/chip 引用时才进上下文，不占常驻预算 | 有数字支撑的偏差为零——本批增量对常驻索引几乎无感 |
| **与 Nomi 已有能力冲突时谁优先** | 官方给的是通用原则（description 要具体、避免与其他技能撞触发词） | 不适用（各仓库内部无跨包冲突设计） | 本方案的 5 条里 4 条是「增强现有技能」不新增 description，天然不产生新的触发竞争；唯一新增的 `director-prompt-h3` 的 description 要与 `director-shot-translation`（已有的通用运镜翻译）明确分工：写「**H3 模型专属**的 I2VA 多图对齐提示词结构」，`director-shot-translation` 描述里补一句「运镜/焦点翻译；模型专属的固定结构（如 H3）见 `director-prompt-h3`」互相导流，避免模型选错 | 新增字段需要显式互斥描述，本方案在 §5 的实施清单里写死这一条 |
| **误触发怎么让用户一眼看见并关掉** | 官方给 `disable-model-invocation` 字段（Nomi 已实现为顶层键，`skillStore.ts:103-107`） | 无此机制（两仓库都是纯 CLI，没有「运行时关闭」概念） | 沿用 Nomi 现有机制不变；本方案不新增关闭 UI（P5：小改动不用等样张，但也不该借机夹带新控件） | 一致，不做变更 |
| **内置与用户导入同一套加载路径** | 规范本身不区分「内置」与「用户」技能——都是磁盘上的 `SKILL.md` 目录 | 同（`./scripts/install.sh` 把仓库技能软链进 `~/.claude/skills/`，加载器视角完全相同） | Nomi 已经是同一套：`getSkillsRoots()`（内置只读目录 + 用户可写目录）→ `discoverSkillRecordsFromRoots`（`skillStore.ts:143-220`）统一发现，`findSkillRecord`/`findExactSkillRecord` 不区分来源；本批 5 项全部落在内置只读目录，加载路径不需要新代码 | 一致，零新增路径（P1 满足：不产生第二套加载机制） |

### 4.2 与「误触发」相关的一条具体设计

`director-prompt-h3` 的 `description` 必须显式排除「用户在问其他模型（Seedance/可灵）怎么写提示词」的场景，否则会跟 `director-shot-translation` 抢触发。参考官方「Avoid vague descriptions」的写法，拟稿（本方案给草稿，不是最终定稿，实施时按 R8 出样张一并过用户拍板）：

> `description: MiniMax H3 视频模型专属的 I2VA 多图对齐提示词写法——参考图对齐指令、逐镜 integrated_multimodal_description、overall_soundscape、non_diegetic_music 四段式结构。Nomi 给 H3 模型的镜头写 prompt 字段时用；其他模型（Seedance/可灵）的运镜翻译见 director-shot-translation。`

---

## 5. 内置形态：随包分发 vs 首次一键拉取

| 维度 | 随包分发（vendor 进 `skills/`，随 Electron 打包） | 首次一键拉取（app 首启/技能库面板按钮联网拉） |
|---|---|---|
| 许可证 | Apache-2.0/MIT 允许直接打包分发，只要保留 NOTICE/署名 | 同样允许，但「拉取」意味着运行时联网访问 GitHub，多一层可用性依赖 |
| 更新 | 需要 Nomi 发版才能更新技能内容（技能本身是文本，更新成本等同于改一个 md 文件，走正常 PR） | 可以独立于 app 版本更新，但 Nomi 今天**没有任何「检查技能更新」的基础设施**（不像 `radar:models` 那样有确定性脚本） |
| 离线可用 | ✅ 打包即用，符合 CLAUDE.md「本地优先」 | ❌ 首次启动需联网，且用户本来就可能在隔离环境工作（`docs/lessons/walkthrough-default-profile-is-isolated.md` 印证 Nomi 场景常有离线/隔离需求） |
| 体积 | 本批 5 项：1 个新目录（预估 ≤10KB 纯文本）+ 4 处增强（各 ≤2KB 追加），总增量 <20KB——`du -sh` 实测两个源仓库整个 `skills/` 目录也只有 1.8MB/2.3MB（含截图 assets），纯文本部分更小 | 不适用（本批不需要） |
| 工程量 | 零新增基础设施——直接进现有 `skills/` 目录，走现有 `getSkillsRoots()` 发现路径 | 需要新建：拉取 UI、版本对账、失败降级、签名校验（防止拉到篡改内容——技能正文会进系统提示词，等同注入风险） |

**判定：本批用随包分发。** 体积和工程量两个维度是压倒性的——20KB 文本不值得为它建一整套联网更新基础设施，尤其考虑到本批内容本来就是「改写摘要」而非「原样打包」，没有「跟随上游仓库持续同步」的诉求（上游改了脚本判据，我们摘的是数字，不需要跟着改）。**一键拉取留成后续独立方案的单**——如果将来要支持用户「一键拉某个 GitHub 技能仓库」这种通用能力（不只是 Nomi 自己精选的几条），那是 #582 导入闭环的自然延伸（连 URL 输入代替本地文件选择器），跟本方案的「精选内置 5 条」是两件事，不要混在一个 PR 里（P1：不要在做 A 的时候顺手夹带 B 的新基础设施）。

---

## 6. 转换：非官方格式的仓库怎么转

### 6.1 shuohao-skills（#1）frontmatter → Nomi 格式的字段映射

| shuohao 字段 | Nomi 处置 | 依据 |
|---|---|---|
| `name` | 保留（已等于目录名，符合 `NAME_PATTERN`/`name === dirName` 要求，`skills-format-lib.mjs:44,104`） | F3 |
| `version` | 移入 `metadata.nomi.version`（Nomi 的 `NOMI_EXTRA_TOP_LEVEL_FIELDS` 只放行 `disable-model-invocation`，其余私货一律进 `metadata.nomi`，`skills-format-lib.mjs:35-39`） | F4 |
| `description` | 保留但**重写**——原文是给 Claude Code/codex 通用受众看的多段说明（280-564 字符），Nomi 版要按 §4.2 的「与现有技能互斥」重写、且聚焦本方案只摘的那一部分内容（不是整个 skill 的全部功能） | §4.2 |
| `allowed-tools` | **丢弃**——阶段3-5 §3.4 已实核「`allowed-tools` 在 pi 0.85.1 里是文档有代码不读」，且 Nomi 本批只摘方法论段落，不搬带 `Bash`/`Task` 的执行层 | 阶段3-5 §3.4 |
| `triggers` | **丢弃**——非官方字段，官方触发机制就是 `description` 本身，不需要额外的关键词数组（`check:skills-format` 的 F4 白名单本来就没有这个键） | F4 |
| `metadata.license/requires/runtimes` | **丢弃**——`requires.bins:[node]`/`optional:[codex]` 描述的是 shuohao 自己的脚本运行环境，Nomi 摘的内容不带脚本，这些字段无意义 | §0（脚本层不搬） |
| `scripts/`、`references/`（除 h3-prompt.md 的方法论内容）、`examples/`、`assets/` | **不搬**——`scripts/` 是 `SKILL_EXECUTABLE_DIRS` 显式拒收的可执行区（`skillPackage.ts:35`）；`examples/` 里的《渡口》样例是配脚本用的测试夹具，本批不需要 | `isExecutableSkillPath` |

### 6.2 转换器：不写脚本化转换器

阶段3-5 §3.4 与 #580 §6.2 已经为「用户在自己电脑上导入一个带 `skill.json` 或非官方 frontmatter 的技能包」设计了运行时一次性迁移器（`skillStore.ts` 扫描时自动转换+保留 `.bak`）。**本方案不是那种场景**——不是用户随手拖一个 shuohao 技能进来，是 Nomi 工程侧精选 5 条内容、人工改写进自己的 SKILL.md。**不需要写自动化转换脚本**，因为：

1. 转换对象只有 1 个新文件 + 4 处小追加，规模不构成「值得写脚本摊销成本」的门槛（R20 的「通用问题」第一问答案是否——这不是通用问题，是一次性内容迁移）；
2. 内容要经过实质改写（重写 description 做互斥、摘录而非整篇搬运、补署名注释），机器转换器做不了这些判断，写出来的转换器只会处理不需要判断的部分（字段改名），价值有限；
3. 如果未来批次变多（比如真要支持「一键拉取任意 GitHub 技能仓库」，见 §5 的后续单），到那时候再评估是否需要转换器——那时候的转换器要处理的是「用户拉来的任意仓库」，跟本批「工程师精选改写」是不同的自动化程度需求，不该现在为了假设的未来场景先写。

### 6.3 selftest 保不保

**不保留**。shuohao/drama 的 `selftest.mjs`/`selftest.py` 测的是它们自己脚本的确定性逻辑（254/N 项断言）——本方案没有搬脚本，自然没有脚本可测。新建的 `director-prompt-h3`、增强的 4 处，验收方式是 §7 的真实用户任务走查（人眼/VLM 判断提示词是否符合 H3 结构），不是脚本断言。

---

## 7. 验收门

### 7.1 真实用户任务走查剧本（R16/R13，实施阶段建为 `tests/ux/builtin-skill-h3-storyboard.walk.mjs`，本文档不建文件，只给剧本）

1. 准备一段 300-500 字的短篇小说片段（复用 `writer-novel-digester`/`drama-short` 现有走查素材，不新造）。
2. 在创作区触发 Agent，走 `drama-short` → `workbench-storyboard-planner` 出分镜方案，确认落画布，绑定视频节点的模型选 **MiniMax H3**。
3. 断言点：
   - `director-prompt-h3` 是否在合适时机被 `load_skill` 调用（模型自己判断，不是硬编码触发）——这是 R30「工具写对率」的具体化：**第一次调用**是不是调对了技能（而不是调了 `director-shot-translation` 又发现不对再改调）。
   - 生成的视频节点 `prompt` 字段是否含 H3 结构的四段（对齐指令/`integrated_multimodal_description`/`overall_soundscape`/`non_diegetic_music`）——正则或 VLM 判断，不需要新脚本，复用现有 prompt 走查断言模式。
   - `director-shot-translation` 与 `director-prompt-h3` 没有被同时误触发（互斥描述生效的证据）。
4. 情绪日志（`docs/lessons/experiential-qa-emotion-log.md` 方法论）：这条 H3 提示词模型第一次是不是真的写对了结构，而不是「看起来像但漏了某段」。

### 7.2 R30 数字口径

- **工具写对率**：`load_skill` 调用里第一次点名 `director-prompt-h3`（而非先调错再改）的比例，目标 ≥90%（对齐阶段3-5 §4.2 「真实 `canvas.write` ≥90%」的同档要求）。
- **回合成功率**：H3 视频节点最终生成的 `prompt` 字段通过 §7.1 第 3 点的结构断言，目标与阶段2 基线同档（不单独降标准）。
- 本文档只定义验收口径，实测数字在实施 PR 里补（R30：设计实验室基线只证外观、走查截图只证界面，两者都不得单独判「接好了」）。

---

## 8. 与主线的关系

本方案落在阶段3-5 §3.4（技能索引/自动触发机制已定型）**之后**——本批 5 项是往已经设计好的加载路径里加内容，不改机制本身，因此**不依赖**阶段3/4/5 切换完成，可以独立于 Agent 运行时重做主线随时排期，不占用「不抢主线」的并行上限（`docs/lessons/parallelism-cap-six.md`）。**不新增待删旧路**——本方案不涉及"碰不碰待删旧路"（不改 `agentContext.ts` 的 `buildSkillSystemPrompt` 等阶段3-5 正在处理的双语义问题）。

---

## 9. 六角色评审（R7）

| 角色 | 判断 | 提的条件 |
|---|---|---|
| **CTO** | 通过。方向对：拿方法论不拿执行层，避免给 Agent 开 Bash 口子这种大改动；转换器不写（§6.2）也对，规模不到摊销门槛。 | `director-prompt-h3` 与 `director-shot-translation` 的互斥描述必须先过 §4.2 的用户拍板，不能工程师自己定稿——这是两个技能会不会打架的关键，属于「产品方向」不是「实现细节」。 |
| **设计** | 通过。技能库面板不新增任何控件，5 项全部走既有卡片展示；`director-prompt-h3` 的卡片 label/description 展示效果建议出个小样张（哪怕不是"大 UI 改动"级别，涉及模型触发准确率的文案值得看一眼）。 | 无阻塞条件，走 R8 的最小样张即可。 |
| **PM** | 通过，但范围要管住。用户看到的收益是「H3 短片的提示词质量变好、几个经验数字帮着不踩坑」，别在文案里暗示"内置了 shuohao 的全部能力"——90% 的内容我们已经有更强的实现（§2.5），过度宣传会让用户失望地去找"爽点表""质量门"这些没搬的东西。 | 文案禁止提及"质量门""脚本检查"这类没有落地的能力承诺。 |
| **前端** | 通过。零渲染层改动——`ActiveSkillChip`/技能库面板代码不用碰，5 项都是纯 `SKILL.md` 内容变更。 | 无条件。 |
| **后端** | 通过。`skillStore.ts`/`skillPackage.ts` 零改动，`check:skills-format` 门岗直接吃新内容（`name===dirName`、顶层键白名单）。 | 新建 `director-prompt-h3` 目录时跑一次 `node scripts/check-skills-format.mjs` 确认过 F1-F4/F6，不能假设"文本改动不会红"。 |
| **真实用户** | 通过。「Nomi 现在知道怎么给 H3 写提示词了」是能感知的——前提是真的按 §7.1 走查验证过，不是"看起来该会了"。 | 走查必须用真实 H3 模型跑一次（付费验收，`docs/lessons/paid-smoke-apimart-only.md`：走 APIMart），不能只看静态 prompt 文本像不像。 |

---

## 10. 不做项（明说）

- **不给 Agent 开脚本/Bash 执行工具**——两仓库的「N 道质量门脚本强查」这个卖点本方案明确放弃，理由见 §0/§6.3。如果未来要做，那是一个独立的、需要单独安全评审的方案（R28），不混进本次。
- **不整体搬 novel-outline/characters/art/script 五步或 drama-skills 九个 skill**——§2.5 证明 Nomi 现有实现更强，整体搬入是 P1 违规（新增一份更差的并行版）。
- **不建一键拉取任意 GitHub 技能仓库的能力**——§5 已分析，工程量不匹配本批 20KB 的内容规模，留成独立后续单。
- **不写自动化转换脚本**——§6.2，规模不到门槛，且需要的是人工判断（重写 description、摘录取舍），机器做不了。
- **不追更上游仓库**——本批是「摘录改写」不是「vendor 同步」，shuohao/drama 仓库后续怎么改，跟 Nomi 无关（不像框架依赖那样需要持续对齐）。

## 11. 回滚

5 项改动互相独立、每项一个 commit：
- `director-prompt-h3` 回滚 = 删目录（新目录，无其他文件依赖它，`check:skills-format` 会因为少一个技能而"降级"但不会红）。
- 4 处增强回滚 = 各自 revert 对应 SKILL.md 的那一次 diff（都是在现有文件里加一节，不改现有结构）。

## 12. 验收门（R4 格式收尾）

- `pnpm run gates` 全绿（含 `check:skills-format`、`check:i18n`——5 项全中文技能内容，不触发 i18n 门岗因为技能正文不是 UI 硬编码文案）。
- §7.1 走查剧本跑通，§7.2 数字达标。
- 六角色评审的"CTO 条件"（互斥描述过用户拍板）在实施 PR 里体现为一次 R8 最小样张确认。
