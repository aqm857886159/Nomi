# 设计卡：用户逐字给的提示词，Agent 照写，不扩写（逃逸账本 USER-20261107-agent-expands-verbatim-prompt）

改动名：Agent 对用户给出的提示词原文逐字落，只有用户让它写 / 润色 / 扩写时才扩写　线：I-style-verbatim　类别：[其他]（Agent 行为；模型可见文字；不碰界面元素，不花钱）

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [x] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [ ] 新增功能 / 性能

## 先查别人（★0，纯 bug 修复只答出口）

- 出口：不涉及：不新增、不扩大、不挪动任何挡人的保护（只改模型读到的几句话）。
- Anthropic「Writing effective tools for AI agents」(https://www.anthropic.com/engineering/writing-tools-for-agents) · 举的例子就是模型在搜索词里擅自加年份，靠改工具说明解决；主张用评测量说明改动的效果 · 确认了：根因在模型读到的说明（不在代码），要用真实评测量「逐字率」；决定：改说明，配用例表量尺。
- 本仓 `electron/harness/context/agentContext.ts:86` 的 `buildLanguageRule` · 已有「用户给的标题、名字、字幕、台词逐字保留，除非用户让改写或翻译」一句 · 确认了：规则的家是 Agent 身份层（所有面共用），沿它的写法；决定：提示词原文这一条放在身份层，不在每个工具各加一句。
- 本仓 `electron/shared/agentCapabilities/canvasWrite.ts:732` 的 `CANVAS_NODE_PROMPT_GUIDELINES`（修前）· 无条件写「按结构化骨架写，末尾加风格关键词」，起草改草稿共用 · 改了决定：这一段是「你自己写提示词时」的做法，加上适用条件，不是对所有提示词的无条件要求。

## ★1 用户怎么用

- 当创作者在生成画布上对 Agent 说「提示词写：一只橘猫坐在窗台上」或「改成：一只黑猫坐在窗台上」，我想要落在节点上的提示词就是我说的那句，以便框里看到的、发出去的都是我写的字，不用逐个删 Agent 偷加的氛围词和风格词。
- 步骤：说一句带原文的话 → Agent 调起草 / 改草稿 → 节点提示词 = 原文（逐字，含标点与语言）→ 创作者在框里看到原句。
- 不做什么 / 已知坑：不做代码层的「模型写的和用户说的比对」闸（模型可能把原文放进长句里，机器比对会误杀合理的整理）；不动创作区各模式的系统提示词（那是用户可编辑的，且本来就是「让它写」）；不动拆镜头技能里「按故事写镜头」的写法（那是用户让它写）；节点标题没跟着内容走是另一个问题（另案）。拿不准是原文还是想法时，规则让它按原文落、并问一句要不要扩写。
- 真实任务：①「提示词写：一只橘猫坐在窗台上」→「改成：一只黑猫坐在窗台上」（用户 11-07 原话）；②英文界面 `set the prompt to: a black cat on a windowsill`；③「帮我给这个镜头写一个更有电影感的提示词」——这一类仍要扩写。
- 指标（量具）：主指标——给原文的用例里，节点提示词与原文逐字相同的比例（逐字率）；质量指标——让它写 / 润色的用例里提示词比用户那句更长、带画面细节的比例（该扩写时扩写率），防止矫枉过正；护栏——工具参数被拒次数不增。量具：用例表 `tests/ux/agent-verbatim-prompt.cases.json` + 判据 `tests/ux/verbatim-prompt-judges.mjs`（离线阳性 / 阴性对照）+ 真模型走查 `tests/ux/agent-verbatim-prompt-real-model.walk.mjs`（真模型那一次由协调跑；修前基线：用户 11-07 一例落了扩写，其余未量，**未验证：缺修前基线，协调在修前提交上同条件跑一遍**）。
- 老用户（★1c）：不适用：只改模型每回合读到的文字，不碰存量数据；已落画布的节点不受影响。

## ★2 谁说了算

- 概念：「Agent 对提示词原文的处理规则」唯一 owner 是 `electron/harness/context/agentContext.ts` 的 `NOMI_AGENT_IDENTITY`（所有 Agent 面共用的身份层）；工具说明里的 `CANVAS_NODE_PROMPT_GUIDELINES` 只说「自己写时怎么写」，不重复这条规则。外部 MCP 客户端读不到身份层，所以工具说明里的那一段自带适用条件（「用户没给原文、由你来写时」）。证据：`node scripts/door-map.mjs CANVAS_NODE_PROMPT_GUIDELINES`、`NOMI_AGENT_IDENTITY`。
- 同一份事实存几份：规则 1 份（身份层）；适用条件在工具说明 / 生成技能里各一句，是同一个条件，不是第二份规则。

## ★3 一致与复用

- 以前定过：语言规则里已有「标题、名字、字幕、台词逐字保留」（还算数，沿用）；`CANVAS_NODE_PROMPT_GUIDELINES` 写「高质量提示词按骨架写」是为了让 Agent 自己写时有结构（还算数，只是加条件）。同族的另一条记录是「没要的写实风格被加进去」，同一族。
- 三条路：沿原方向修（在每个工具再加一句「别扩写」）——违背「规则只有一个家」，不选；换做法（身份层写一条规则 + 工具说明里把无条件要求改成有条件）——选；删掉骨架要求——Agent 自己写提示词时质量会掉，不选。
- 复用：不新增文件到产品代码；改 `NOMI_AGENT_IDENTITY` 一处、`CANVAS_NODE_PROMPT_GUIDELINES` 一处、`skills/workbench-generation/SKILL.md` 一处。证据：`git grep`、`pnpm run check:self-written`。
- 模型可见工具检查单（`docs/engineering/model-facing-tool-checklist.md`）：不改工具名、不改参数、不改顺序；只改 `promptGuidelines` 文字；跑 `check:model-schema`、`check:mcp-tool-refs`、`check:walkthrough-tool-args`。

## ★4 全状态

- 不新增界面状态，不新增文案（`check:i18n` 无变化）。用户给原文：落原文；用户让写：照旧扩写；说不清：按原文落并问一句；用户给的原文本身是空话（只有两个字）：照落，不替他补。

## ★9 验收与回滚

**验收清单（动手前写，实现线按它自验，验收线只核它）**

| # | 检查 | 命令 / 位置 |
|---|---|---|
| 1 | 身份层含「原文逐字」规则，且不与语言规则的「你写的提示词用简体中文」自相矛盾（原文是英文也逐字） | `pnpm exec vitest run electron/harness/context/verbatimPromptRule.test.ts` |
| 2 | 起草 / 改草稿的工具说明里，「骨架 + 风格词」带适用条件；MCP 客户端读到的版本同样带 | 同上 + `electron/capabilityCore/mcpTransportSchemaFromZod.test.ts` |
| 3 | 生成技能第 6 条同样带条件 | 同上 |
| 4 | 类检查：所有会告诉模型「加风格词 / 加氛围」的模型可见文字（工具说明、身份层、生成区规划技能）逐条登记，登记的必须带适用条件；新增一条没登记的就红 | 同上 |
| 5 | 判据有阳性 / 阴性对照：用户 11-07 那例必判为扩写；逐字落判为通过；该扩写的用例落一句原话判为没扩写 | `pnpm exec vitest run tests/ux/verbatim-prompt-judges.test.mjs` |
| 6 | 用例表 ≥12 句、中英各半、一半给原文一半让 Agent 写，且逐字抄进判据 | 同上 |
| 7 | 三道模型可见门岗 | `pnpm run check:model-schema && pnpm run check:mcp-tool-refs && pnpm run check:walkthrough-tool-args` |
| 8 | 变异：把身份层那条删掉，检查 1 红 | 实现线贴红的条数 |
| 9 | 真模型逐字率 / 该扩写时扩写率（协调跑一次，修前后同条件各一遍） | `node tests/ux/agent-verbatim-prompt-real-model.walk.mjs --label before` / `--label after` |

**反例（这一类会从哪回来）**

- 另一个入口：外部 MCP 客户端调 `draft_shots`（不经过身份层）→ 检查 2。
- 另一个工具：改草稿、写节点文字、导演台、分镜规划里的提示词 → 类检查登记表（检查 4）逐条过；分镜规划技能是「按故事写镜头」，登记为「用户让写」类。
- 另一种说法：「写：」「改成：」「提示词是」、引号里的整句、英文 `set the prompt to` → 用例表。
- 另一种语言：英文原文在中文界面不被翻译 → 用例表英文行。
- 矫枉过正：用户让写时只落一句原话 → 该扩写率。

**回滚**：revert 本 PR 的修复提交（只含文字）。

**真实场景复现**：用户 11-07 在 Windows 候选包里说「提示词写：一只橘猫坐在窗台上」再说「改成：一只黑猫坐在窗台上」，落下的是加了氛围和「写实摄影风格」的句子。我这边：把同样两句话交给真模型，读 lane 会话里起草 / 改草稿的参数，看提示词是不是原文。与用户那次的差别：他用的是真实候选包与他配置的文本模型，我这边的真模型那一次由协调跑；我只在离线证明说明里的无条件要求已经变成有条件，并留好量具。

**独立验收**：本卡不归花钱 / 长跑 / 可打断 / 新界面四类，不强制；仍建议另一条线核上表。

## 其余格

- 5 / 6 / 7 / 8：不适用：只改模型可见文字；真实条件（真模型、英文界面）留给协调那一次走查。
