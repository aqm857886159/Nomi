# 关门：Agent 路径上「同一个效果有好几扇门」的收口方案

> 📋 方案待拍板 · 2026-09-11。
> 分支 `plan/close-agent-doors-20260911`。不改 `src/` / `electron/`，本轮只出方案 + 门表 + 根因合同草稿。
> 配套产物：门表 [`2026-09-11-close-agent-doors.doors.json`](./2026-09-11-close-agent-doors.doors.json)、根因合同草稿 `docs/fixes/2026-09-11-agent-generation-second-door.root-cause.draft.json`。
> 所有 `file:line` 对 `origin/main` af3652e1c 核实（本文档引用的每个文件在 e15939292..af3652e1c 之间都没有改动，已用 `git diff --name-only` 逐路径确认）。

---

## 一、这份文档在解决的真实摩擦（D1 / D6）

用户对 Agent 说「给我生成一张开场图」。

**现在可能发生两件不同的事，而用户分不出来**：

- **走对了门**：Agent 调 `nomi_generation_plan` → 画布上出现一个占位节点 → 面板弹出一张付费卡（写着模型、参数、多少钱）→ 用户点一下 → 真的生成。
- **走错了门**：Agent 调 `nomi_canvas_write` → 画布上出现一个**长得一模一样的空节点** → 没有卡、没有报价、永远不会生成。Agent 在对话里说「已经为你创建好了」——它没说谎，它确实建了一个节点。

两条路的产物在画布上肉眼无法区分。用户看到节点出现了、Agent 说做好了，于是等着图出来——图永远不会出来。他不会觉得「Agent 选错工具了」，他只会觉得**「Nomi 的 AI 是坏的」**。

**核心取舍点（要权衡的那一个东西）**：Agent 用「建画布节点」这个工具去做生成时，系统应该
**（甲）把它当成一次生成请求照常出卡**，还是 **（乙）不让它建、把它打回去让它换工具**？

- 甲 = 用户拿到他想要的效果和报价，代价是工具面上永远有两个名字指向同一件事，模型学不会哪个才是正门。
- 乙 = 工具面干净，模型被逼学会，代价是每撞一次门多一个回合，且外部 MCP 宿主会收到一次破坏性变更。

本文档**推荐甲**（并解释为什么调研之后从乙改成了甲），同时用描述改写 + 回执指路把「模型学不会」这一半补上。

---

## 先查别人（§2）

> R6 / R29 / R31。问的是：**别人的工具面上「同一个效果好几个工具」是怎么处理的，描述怎么写才让模型选对。**
> 标 **[官方]** 的是厂商文档/源码；标 **[社区]** 的是逆向或第三方整理，当佐证不当判据。

### 2.1 Claude Code：描述里逐条指路，而门本身留着 —— 且理由是「审批」

- **[官方]** 工具清单 https://code.claude.com/docs/en/tools-reference ——每个工具一行 `Permission Required: Yes/No`，**权限面是按工具身份排的**。
- **[社区，多版本可复核]** https://github.com/Piebald-AI/claude-code-system-prompts/tree/main/system-prompts 逐版本抽出出厂描述片段。`Bash` 的描述里逐条写死重定向：
  *"Read files: Use Read (NOT cat/head/tail)" · "Edit files: Use Edit (NOT sed/awk)" · "Content search: Use Grep (NOT grep or rg)" · "File search: Use Glob (NOT find or ls)" · "Write files: Use Write (NOT echo >/cat <<EOF)"*
  —— 而给出的**理由是给用户的，不是给模型的**：*"...they provide a better user experience and **make it easier to review tool calls and give permission**."*
  `Grep` 从另一侧再说一遍：*"ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` as a Bash command."*
  `Write` 用成本区分兄弟工具：*"Prefer the Edit tool for modifying existing files — it only sends the diff."*
- **[官方]** 但它**并没有把第二扇门封死**，而是让状态机认它：https://code.claude.com/docs/en/tools-reference ——*"Viewing a file with Bash satisfies the read-before-edit requirement when the command is `cat`, `nl`, ... on a single file with no pipes"*；以及 *"An `Edit(...)` allow rule also grants read access to the same path... A `Read(...)` deny rule also blocks the Edit and Write tools on the same path"*。**权限规则是按效果写的，故意跨越工具边界。**
- **[社区]** `MultiEdit` 已被删（官方 CHANGELOG 全文 6574 行零命中；用户侧证据 https://github.com/anthropics/claude-code/issues/8994 、https://github.com/anthropics/claude-code/issues/11125 、https://news.ycombinator.com/item?id=45473139 ）。活下来的 `Edit` 用 `replace_all: true` 一个布尔参数承担那唯一合法的差异。**「只差一个批量」的兄弟工具被删掉，不是合并。**
- **[官方]** 反向案例值得记住：CHANGELOG `2.1.117`（https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md ）——*"Native builds on macOS and Linux: the `Glob` and `Grep` tools are replaced by embedded `bfs` and `ugrep` available through the Bash tool — faster searches without a separate tool round-trip"*。**同一家公司在往返成本占主导时，选择删掉专用工具、把能力收回通用工具。** 两扇门的解法是「删一扇」，删哪一扇看成本，不看哪扇更「专用」。
- **[官方]** `NotebookEdit` 的形状：一个工具 + `edit_mode` 分支（`replace` / `insert` / `delete`），三个效果一个工具一行权限。

### 2.2 OpenAI Codex CLI：**归一，而不是禁止** —— 本方案最强的一条先例

- **[官方，源码]** 工具集：https://github.com/openai/codex/tree/main/codex-rs/core/src/tools/handlers （`apply_patch` / `exec_command`+`write_stdin` / `plan` / `view_image` / `request_permissions` / …）。
- **[官方，源码]** `apply_patch` **同时是工具、也是 shell 命令**，而它们在代码里被归一：`intercept_apply_patch(command, …)`（https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/apply_patch.rs#L499 ）截住 shell 里的 `apply_patch <<EOF`，走**同一个** `execute_verified_patch`、同一个 diff tracker，而且 `pre_tool_use_payload` / `post_tool_use_payload` **无论走哪扇门都报 `tool_name: apply_patch`**。
  → **第二扇门不是被堵死的，是被接回第一扇门的审批与审计身份上的。** 这正是本方案要抄的形状。
- **[官方]** Codex 的提示词方向与 Claude Code 相反：https://github.com/openai/codex/blob/main/codex-rs/core/gpt-5.2-codex_prompt.md ——*"prefer using `rg` or `rg --files` ... because `rg` is much faster"*（根本没有专用搜索工具），且**明确允许**重叠路径做批量改：*"Do not use apply_patch for changes that are auto-generated… or when scripting is more efficient (such as search and replacing a string across a codebase)."*
- **[官方，源码]** registry 层的去重只到**名字**：https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/registry.rs （`"tool {tool_name} already registered"`、`"skipping duplicate external tool that is already registered"`），另有 `ToolExposure::Hidden` 与命名空间层。**没有效果级去重。**

### 2.3 Cursor：不解决重叠，把消歧全推给系统提示词

- **[社区]** 工具 JSON https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/blob/main/Cursor%20Prompts/Agent%20Tools%20v1.0.json ——13 个工具里有**两个编辑工具**（`edit_file` / `search_replace`）、**三个搜索工具**（语义 / 正则 / 模糊路径），外加一个 `reapply`：*"Calls a smarter model to apply the last edit… ONLY IF the diff is not what you expected"* —— **一个工具的唯一职责是从另一个工具的失败中恢复**。这是「重叠不收口」的终局形态，值得当反面教材。
- **[社区]** 消歧在提示词里：https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/blob/main/Cursor%20Prompts/Agent%20Prompt%202025-09-03.txt ——*"ALWAYS prefer using codebase_search over grep…"*，新版还把 shell 那扇门明确关掉：*"There is no apply_patch CLI available in terminal. Use the appropriate tool for editing the code instead."*
- **[官方]** https://cursor.com/docs/agent/tools 只按能力分类讲工具，对重叠与优先级只字不提。

### 2.4 Cline：硬合并 + **按「效果 × 范围」审批，不按工具名**

- **[官方]** https://docs.cline.bot/exploring-clines-tools/cline-tools-guide ——现役工具 `bash` / `editor` / `read_files` / `apply_patch` / `search` / `fetch_web` / `ask_question`；旧的 `read_file` / `write_to_file` / `replace_in_file` / `execute_command` / `list_files` 明说 **"have been consolidated into the current tool set"**。一个 `editor` 兼看与改（模式分支），一个 `read_files` 兼批量读。
- **[官方]** https://docs.cline.bot/features/plan-and-act ——Plan 模式是只读能力信封：*"Cline can read your codebase, run searches, and discuss strategy, but cannot modify any files or execute commands. This constraint is intentional."* **闸开在模式上，不开在工具上。**
- **[官方]** https://docs.cline.bot/features/auto-approve ——审批类别是 *Read project files / Read all files / Edit project files / Edit all files / Execute safe commands / Execute all commands / Use the browser / Use MCP servers*，且由模型给每条命令打 `requires_approval` 标记，而不是匹配固定白名单。**审批轴 =（效果 × 范围），与工具名无关。** ← 与 Nomi 09-10「审批默认档：只问花钱/撤不回」的拍板同形。

### 2.5 pi SDK（我们的 Agent 运行时底座）：**没有效果去重、没有冲突检测、没有命名空间**

- **[官方，源码]** 内建工具是一个闭集 `ToolName` union，`switch` 分发：`read, bash, powershell, edit, write, grep, find, ls` —— https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/index.ts 。未知名字 → `throw new Error("Unknown tool name: …")`。**只校验名字合不合法。**
- **[官方]** 自定义工具 `defineTool()` + `customTools`、扩展 `pi.registerTool()` —— https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md 。选择是一个扁平白名单（`tools: [...]` / `excludeTools` / `noTools`）。**自定义工具遮住内建工具既不报错也不告警。**
- **[官方，源码]** 注册内部：`extension.tools.set(tool.name, …)`（https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/loader.ts#L287-L299 ，唯一校验是「parameters 必须是 object schema」）；`getAllRegisteredTools()` 注释写着 *"first registration per name wins"`（https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/runner.ts#L500-L510 ）。
  **反差**：同一个文件里，**快捷键冲突**是检测并告警的（*"Extension shortcut conflict: '{key}' registered by both … Using …"*，runner.ts ~L563-580），**斜杠命令重名**是去重的。冲突机制在 pi 里存在，只是从没用到工具上。
- **[官方，源码]** pi 的 `bash` 描述零反重叠引导：*"Execute a ${shellName} command in the current working directory..."* —— https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/bash.ts#L43 。pi 同时给 `bash` 和 `grep`/`find`/`ls`/`read`，对该用哪个只字不提。
- → **结论（R29 四列表的「它提供」那一格）：pi 在这件事上什么都不提供。** 效果去重、审批归一、反重叠描述引导，全部得我们自己建；但**建的地方必须是我们自己的注册表**（`modelFacingToolRegistry.ts`），不是去改 pi。

### 2.6 Anthropic 官方 tool-use 最佳实践 **[官方]**

https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools ——"Best practices for tool definitions"，逐字：

- *"**Provide extremely detailed descriptions.** This is by far the most important factor in tool performance. Your descriptions should explain every detail about the tool, including: What the tool does · **When it should be used (and when it shouldn't)** · What each parameter means and how it affects the tool's behavior · Any important caveats or limitations... **Aim for at least 3–4 sentences for each tool description, more if the tool is complex.**"*
- *"**Prioritize descriptions**, but consider using `input_examples` for complex tools."*（描述 > 示例，明写）
- *"**Consolidate related operations into fewer tools.** Rather than creating a separate tool for every action (`create_pr`, `review_pr`, `merge_pr`), group them into a single tool with an `action` parameter. **Fewer, more capable tools reduce selection ambiguity**..."*
- *"**Use meaningful namespacing in tool names.** ... prefix names with the service (for example, `github_list_prs`)..."*

https://www.anthropic.com/engineering/writing-tools-for-agents （官方工程博客）：
- *"**When tools overlap in function or have a vague purpose, agents can get confused about which ones to use.**"* ← 本 bug 的官方一句话诊断
- *"More tools don't always lead to better outcomes. A common error we've observed is tools that merely wrap existing software functionality."*
- *"When writing tool descriptions and specs, think of how you would describe your tool to a new hire on your team."*

### 2.7 OpenAI function-calling 最佳实践 **[官方]**

https://developers.openai.com/api/docs/guides/function-calling ：
- *"Write clear and detailed function names, parameter descriptions, and instructions"*；*"use the system prompt to describe **when (and when not)** to use each function"*；*"**include examples and edge cases**, especially to rectify any recurring failures"*。
- 工程化四条：*"Make the functions predictable and intuitive"*；用 **enum / 结构化对象让非法状态无法表达**；**"pass the intern test"**（只看文档，一个新人能不能用对）；*"Don't make the model fill arguments you already know"*；**"combine functions that are always called in sequence"**。
- 数量：**"aim for fewer than 20 functions available at the start of a turn"**，并注明数量上去准确率下降，稀有函数应退到 tool search 后面。

### 2.8 「工具多了会不会选不准」「一个工具+枚举 vs N 个兄弟工具」

- **[论文]** RAG-MCP，arXiv:2505.03275 https://arxiv.org/abs/2505.03275 ——*"LLMs struggle to effectively utilize a growing number of external tools… due to prompt bloat and selection complexity"*；只检索相关工具描述可 *"cut prompt tokens (e.g., by over 50%) and **more than triples tool selection accuracy (43.13% vs 13.62% baseline)**"*。**「工具多 → 选不准」有实证。**
- **[社区]** 实践综述把拐点放在 10–15 个，并报告中段工具的位置偏见：https://tianpan.co/blog/2026-04-19-over-tooled-agent-problem 、https://machinelearningmastery.com/the-complete-guide-to-tool-selection-in-ai-agents/ 。
- **[社区，反方]** 「一个工具 + action 枚举」**不是已决的胜局**：多动作工具让模型 *"must first figure out which mode to invoke before it can solve the actual task"*；单一职责工具名字更明确、错误更干净、可观测性更好——除非 *"the action space itself is part of the underlying abstraction"*（shell / 文件系统 / 浏览器 / 日历这一族）：https://machinelearningmastery.com/ai-agent-tool-design-what-works-and-what-doesnt/
- **[诚实缺口]** **没找到任何隔离「枚举 vs 兄弟工具」的受控 A/B。** 可引的数字全是关于**目录规模**的，不是关于**形状**的。本方案因此**不**主张「合并成一个工具」，只主张「同一个效果只有一个处理器」。

### 2.9 从别人那里能直接抄的三条

1. **归一，别只是禁止**（Codex `intercept_apply_patch`；Claude Code 的「Bash `cat` 也算读过」「`Edit(...)` allow 蕴含 read」）——**审批、钩子、审计要按效果对齐**，第二扇门应当继承第一扇门的闸，而不是绕开它。
2. **非留两扇门不可时，把理由写进描述，而且理由要是给用户的**——Claude Code 的 *"make it easier to review tool calls and give permission"* 就是一个权限模型需要的那句话。
3. **只差一个模式的兄弟工具合成一个 + 模式参数；只差一个批量的兄弟工具直接删**（NotebookEdit 的 `edit_mode`、Cline 的 `editor`/`read_files` 合并、MultiEdit 的删除）。并保留退路：Anthropic 自己 2.1.117 那一手说明，往返成本占主导时，正确答案可能是**删掉专用工具、留下通用的那个**。

---

## 三、现状：模型面前到底有几扇门（已核实）

完整门表见 [`2026-09-11-close-agent-doors.doors.json`](./2026-09-11-close-agent-doors.doors.json)。摘要：

| 状态 | 模型可达的写入口 | 其中「会出付费卡」的 |
|---|---|---|
| 画布节点写入 | **5** | — |
| 建 Run / 付费草稿 | **3** | **1** |
| 建生成类节点 | **4** | **1** |

唯一会出卡的那条路，从头到尾：

```
nomi_generation_plan (create)
  → generationTransportAdapters.ts:201   origin { host: "nomi" }
  → appIntegration.ts:165                onPlanChanged → landDraftOnCanvas（草稿建即落画布）
  → productionPendingSpend.ts:71         run.origin.host === "nomi" 才投影
  → useAgentPanelSpendConfirm.ts:99      面板 1.5s 轮询 → 卡出现
```

`origin.host` 这一个字符串就是「会不会出卡」的全部判据。而同一个 Agent 还能调 `start_production_run`，它在 `productionRunTransportAdapters.ts:113` 打的是 `origin { host: "embedded-agent" }` —— **结构上永远出不了卡**。

另外三扇能把生成类节点放上画布、且永不出卡的门：

1. `nomi_canvas_write` / `create_canvas_nodes`（`canvasModelTools.ts:149` → `laneCanvasTools.ts:33` → `capabilityApplyHandler.ts:408` → `executeCanvasWriteTarget`）
2. `nomi_storyboard_write` / `propose_storyboard_plan`（`canvasModelTools.ts:157` → `applyCanvasToolCall.ts:286`，一次落一整排）
3. `materialize_production_storyboard`（`productionRunDescriptors.ts:91` → `productionRunArtifactOperations.ts:200` → `capabilityApplyHandler.ts:625`）

**描述还在往错的方向推。** `extendedModelTools.ts:53`，唯一正确的那个工具，自己的描述里写着：

> `This host cannot preview or start paid generation.`

而 `canvasModelTools.ts:150`，错的那个，写着：

> `Create, connect, retitle or tidy generation-canvas nodes in one reversible batch.`

模型读到「生成一张图」→ 一个工具说「我建不了付费生成」，另一个说「我建 generation-canvas 节点」。**它选第二个是完全理性的。** 这不是模型笨，是工具面在说反话——正是 Anthropic 那句 *"When tools overlap in function or have a vague purpose, agents can get confused about which ones to use."*

---

## 四、三个不变量（本次要建立的）

| # | 不变量 | 归属层 | 现在有没有 |
|---|---|---|---|
| **I-1** | 「建一个生成类节点」这个**效果**只有**一个处理器**；任何模型可见工具想产生它，都必须经那一个处理器，因而继承它的付费闸与收据身份 | `electron/shared/agentCapabilities/modelFacingToolRegistry.ts:40` `collectSpecs`（装配期）+ `src/workbench/generationCanvas/agent/applyCanvasToolCall.ts:326`（运行期） | ✗ 无 |
| **I-2** | **生成类节点**（`executionKind` 非空的 kind）落到画布上时，必然伴随一份 durable 生成计划；不存在「没有计划的生成类节点」 | `applyCanvasToolCall.ts:326` `create_canvas_nodes` | ✗ 无 |
| **I-3** | 每一次**模型可达**的画布写入都经过同一个 admission → 事务 → 收据边界 | `src/workbench/generationCanvas/agent/canvasWriteTarget.ts:245` `executeCanvasWriteTarget` | 半 —— `capabilityApplyHandler.ts:625` 与 `:419` 绕过它 |

**「生成类」不手写名单。** 仓库里已经有一份机器可读的声明：`src/workbench/generationCanvas/nodes/registry.ts:43` 的 `executionKind`。它现在就在回答这个问题（`registry.ts:277` 的注释原话：「无 `executionKind`（不会生成）」）。闸从它 derive，不另立词表（R14.1）。

---

## 五、方案

### (a) 生成类节点只留一扇门

#### 三个方案

| | **方案 1 · 归一到同一个效果处理器**（Codex `intercept_apply_patch` 模式）**【推荐】** | 方案 2 · schema 收窄，不让它建 | 方案 3 · 只改描述 |
|---|---|---|---|
| **做什么** | `nomi_canvas_write` 的 schema **不动**（外部 MCP 无破坏性变更）。`applyCanvasToolCall.ts:326` 收到 `executionKind` 非空的 kind 时**不建裸节点**，而是把这次调用**路由进 `generation.plan` 能力**——同一个 origin、同一张卡、同一份收据身份。模型身份不是宿主编的：`plannedNodeSchema`（`canvasWrite.ts:31-63`）本来就带 `modelKey` / `vendor` / `modeId` / `variantId` / `params`，逐字段映进 candidate，缺的才回落默认。回执明说：「这被当作一次生成草稿处理了，报价卡已经给用户；下次直接用 `nomi_generation_plan`。」 | `create_canvas_nodes` 的 `kind` 枚举从 `executionKind` derive，只留非生成类（今天=`agent-artifact`）。模型看不到生成类 kind 这个选项；残余调用返回重定向回执 | `canvasModelTools.ts:150` 与 `extendedModelTools.ts:53` 两条描述对调语气，其余不动 |
| **用户看到** | 无论 Agent 选哪个工具，**结果都一样**：占位节点 + 带报价的卡 + 点一下出图。Agent 那句「我已经建好了」从此为真 | Agent 说「稍等，我换个方式」→ 多一个回合（~2s）→ 然后同样的卡。撞门时用户看到一次短暂的自我纠正 | 大多数时候对；**选错时仍然静默**——空节点 + 「已完成」，和今天一模一样 |
| **代价** | 工具面上仍有两个名字指向同一件事，**选对工具率不会靠结构变成 100%**，只能靠描述往上推；Agent 本想搭一排空占位时会多出一张卡（可用卡上的 × 一键丢弃，`useAgentPanelSpendConfirm.ts:185` 已实现「取消计划 + 删节点」） | 一次工具面破坏性变更（外部 MCP 宿主硬写过生成类 kind 的会收到回执而非静默成功）；回合数 +0~1；**外部宿主的旧调用从「静默失败」变成「显式失败」——是修复，但仍是变更** | 违反 P2：改的是症状。#547 已证描述层恳求三次三次都没挡住（`storyboardLauncher.ts:40/:80`） |
| **回滚** | 删掉路由分支（一处 `if`），行为退回今天；无数据迁移（已建的草稿 Run 是正常 Run） | `kind` 改回 `canvasNodeKindSchema` 全集（一行）+ 同 commit 删重定向分支（P1） | 描述改回去（一行） |
| **能不能被机器守住** | **能**：装配期声明 + 运行期断言「生成类节点必带 durable 计划」，fail-closed | 能 | 不能 |
| **有没有先例** | **有，且最强**：Codex `intercept_apply_patch`（同一处理器、同一审批与钩子身份）；Claude Code 的「Bash `cat` 也算读过」「`Edit` allow 蕴含 read」；Cline 的「审批按效果 × 范围，不按工具名」 | 有：Claude Code 删 `MultiEdit`、Cursor *"There is no apply_patch CLI available in terminal"* | —— |

#### 推荐方案 1，以及为什么中途改了主意

调研之前的直觉是方案 2（封死第二扇门）。看完三家的做法之后改成方案 1，理由是：

- **D1（从用户摩擦出发，effect-first）**：用户要的是图。方案 1 让他无论 Agent 走哪条路都拿到图和报价；方案 2 让他等一次模型自我纠正，而那次纠正**有概率失败**（模型可能改去调第三个工具）。effect-first 说「直接出效果」优于「让他多等一轮」。
- **P1（无并行版）**：这一条一度让我倾向方案 2，但**它要求的是「一个实现」，不是「一个名字」**。方案 1 之后，产生生成类节点的代码路径只剩一条（`generation.plan`），`nomi_canvas_write` 变成它的一个入口而不是第二份实现——这正是 Codex 对 `apply_patch` 做的事。
- **钱的闸（09-10 拍板：每次提交看报价确认）**：方案 1 把**所有**通往生成的路都接到同一张报价卡上，钱的闸从「一个工具守着」变成「一个效果守着」。这比方案 2 更强——方案 2 只是让某扇门进不来，而**进不来的门不等于没有门**（今天的 `materialize_production_storyboard` 就是第三扇）。
- **R28（防线建在最早能拦住的那层）**：方案 1 的防线在**效果处理器**，它拦得住今天已知的三扇门**和明天新加的第四扇**；方案 2 的防线在某个工具的 schema 上，新工具要重新想一遍。
- **D4（诚实交付）**：回执明说「我把它当成生成草稿处理了」，不藏。

**方案 1 的那半个缺口要明写**：它治好了**后果**（用户永远拿得到图和报价），但没治好**成因**（模型仍然在两个名字之间猜）。所以 (b) 的描述改写不是可选项，是方案 1 的另一半——**结构保底，描述提率**，两者的数字分别由验收门 2 和门 3 量。

**其余两扇门同一条闸**：`nomi_storyboard_write` / `propose_storyboard_plan` 与 `materialize_production_storyboard` 落节点都必须经 `applyCanvasToolCall.ts:326`，I-2 对所有调用者一视同仁。它们落的是**分镜草稿**（本来就该配合 `nomi_generation_plan` 出卡），正确形态是由已有的 `landCanvasBestEffort` 链接管出卡，而不是自己建裸节点。

### (b) 描述改写原文

按 Anthropic「说清干什么 / **什么时候用、什么时候不要用** / 每个参数什么意思 / 关键限制，至少 3–4 句」与 OpenAI「把反复出现的失败写进描述、用系统提示词说清何时不要用」写。英文是模型实际读到的那份；中文是 i18n 与评审对照。

#### B-1 · `nomi_generation_plan`（`electron/shared/agentCapabilities/extendedModelTools.ts:53`）

> **现在**：`Read generation context (summary by default; taskKind narrows it; scope: full explicitly requests details), create or revise a draft. This host cannot preview or start paid generation. Minimal create: {…}`

> **改成（EN）**：
> `Create or revise a generation draft. THIS IS THE ONLY TOOL THAT GENERATES IMAGES, VIDEO, AUDIO OR 3D MODELS. Use it whenever the user asks to generate, make, draw, render, re-render or restyle any media — including a single image. It places the shot on the canvas and shows the user a priced confirmation card; the user approves in Nomi and Nomi runs it. Operations: context (read the available models, modes and parameters — call this first; taskKind narrows it, scope: full returns full details), create (start a new draft), patch (revise a draft that already exists). Do NOT use nomi_canvas_write to make media: that tool only arranges canvas objects and a node it creates will stay empty forever. This tool never spends money by itself — approval always happens in Nomi's own UI. Minimal create: {…}`

> **改成（ZH）**：
> `建立或修改一份生成草稿。这是唯一能生成图片、视频、音频与 3D 的工具。用户说「生成 / 画 / 做一张 / 出个片 / 重画 / 换个风格」时一律用它，哪怕只要一张图。它会把这一镜放到画布上并给用户一张带报价的确认卡，用户在 Nomi 里点头后才执行。三个动作：context（先读可用模型、模式与参数；taskKind 收窄范围，scope: full 出细节）、create（新建草稿）、patch（改已有草稿）。不要用 nomi_canvas_write 做媒体：那个工具只整理画布对象，它建出来的节点会一直是空的。本工具自己不花钱，花钱一律在 Nomi 界面里由用户点头。`

三处关键变化：
1. **删掉劝退句** `This host cannot preview or start paid generation`。它字面为真（这个 host 确实不直接起付费生成），但模型读到的是「这条路走不通」。换成同样为真而且指路的 `approval always happens in Nomi's own UI`。
2. **加一条负向指引**（`Do NOT use nomi_canvas_write to make media`）——OpenAI 明写 *"include examples and edge cases, especially to rectify any recurring failures"*，Claude Code 的 `Bash` 描述就是逐条这么写的。
3. **把「一张图也算」写死**——真机里模型对单图最容易降级去建节点。

#### B-2 · `nomi_canvas_write`（`electron/shared/agentCapabilities/canvasModelTools.ts:150`）

> **现在**：`Create, connect, retitle or tidy generation-canvas nodes in one reversible batch. The operation selects which fields apply; unrelated fields are rejected.`

> **改成（EN）**：
> `Arrange the canvas: connect, retitle, reposition, group or tidy nodes that already exist, and create non-generating objects such as artifacts you hand-author yourself (SVG, HTML, Markdown, tables). This tool does NOT generate media and does not spend credit. If you ask it for an image, video, audio or 3D node, Nomi will route that request to nomi_generation_plan and show the user a priced card instead — so call nomi_generation_plan directly for media; it is clearer for the user and costs one fewer round trip. Call nomi_canvas_read first: node ids, shot numbers and model keys all come from there, and inventing an id is the most common way a canvas edit fails. The operation selects which fields apply; unrelated fields are rejected.`

> **改成（ZH）**：
> `整理画布：把已经存在的节点连线、改名、挪位、编组、收拾，以及创建不会生成的对象（你自己手写的 SVG / HTML / Markdown / 表格这类产物）。本工具不生成媒体、不花钱。如果你向它要图片、视频、音频或 3D 节点，Nomi 会把这次请求转给 nomi_generation_plan 并给用户一张带报价的卡——所以做媒体请直接调 nomi_generation_plan，对用户更清楚，也少一次往返。先调 nomi_canvas_read：节点 id、镜号、模型 key 都来自那里，编一个 id 是画布编辑失败最常见的原因。operation 决定哪些字段生效，无关字段会被拒。`

注意第三句的写法：**它如实说出了方案 1 的行为**（会被路由），同时给出「直接用那个更好」的理由，而且理由是给用户的（*more clear for the user*）——抄的是 Claude Code 那句 *"make it easier to review tool calls and give permission"* 的形状（先查别人 §2.9 第 2 条）。

#### B-3 · `materialize_production_storyboard`（`electron/shared/agentCapabilities/productionRunDescriptors.ts:93`）

> **现在**：`Attach an approved storyboard version to the real generation canvas, preserving run/artifact provenance. Supply its exact expectedVersion; this writes the canvas and does not generate paid media.`

> **改成（EN）**：
> `Attach an ALREADY-APPROVED storyboard artifact from an existing production run onto the canvas, preserving run and artifact provenance. It requires a runId, an artifactId and that artifact's exact expectedVersion — it cannot invent a storyboard and it cannot create shots that are not already in an approved artifact. This is a bookkeeping step inside a production run, not a way to make media: it does not generate, does not spend credit and shows the user no price. If the user asked you to generate or draw something, use nomi_generation_plan instead.`

> **改成（ZH）**：
> `把某个生产 Run 里**已获批准**的分镜产物挂到画布上，保留 Run 与产物出处。必须给 runId、artifactId 和该产物确切的 expectedVersion——它造不出分镜，也建不出已批准产物里没有的镜头。这是生产流程里的一步记账，不是做媒体的办法：不生成、不花钱、不给用户看报价。用户要你生成或画点什么，请改用 nomi_generation_plan。`

#### B-4 · `nomi_storyboard_write`（`canvasModelTools.ts:158`）

保留现有中文描述，开头加一句：
`Plans shots; it does not generate them. After the plan is saved, use nomi_generation_plan to turn shots into priced drafts.`
/ `只排镜头，不生成镜头。方案存好之后用 nomi_generation_plan 把镜头变成带报价的草稿。`

#### B-5 · `start_production_run`（`productionRunDescriptors.ts`）

加一句说明它建的是**可评审的 brief 草稿**、不是生成任务，并按 (c) 改 origin。

> 全部五条都在 `check:model-schema` 的 `MIN_DESCRIPTION_CHARS = 120`（`scripts/check-model-schema.ts:56`）之上且带示例，不会触发 `thin-description` / `missing-example`。
>
> **顺带量一个数**：OpenAI 建议 *"fewer than 20 functions available at the start of a turn"*。实施时用 `MODEL_FACING_TOOL_SPECS` 实测 internal profile 的工具数写进 PR；若已超 20，不在本轮处理，但要记进 backlog（RAG-MCP 的数字说明这会直接压低选对率）。

### (c) `start_production_run` 的 origin 改成 `nomi`

`electron/capabilityCore/productionRunTransportAdapters.ts:113`：

```ts
origin: { host: "embedded-agent" },                          // 现在
origin: { host: "nomi", actorId: "project-agent-host" },     // 改成，与 generationTransportAdapters.ts:201 同一份
```

**为什么**：`productionPendingSpend.ts:71` 用 `run.origin.host === "nomi"` 判断「这个 Run 的待确认要不要在面板上出卡」。`"embedded-agent"` 是**同一个 Agent 的另一个自称**——同一个人两个名字，其中一个名字下的花钱请求用户永远看不见。

**会发生什么**：`start_production_run` 建的 brief 草稿本身不含 `generationPlan`，`productionPendingSpend.ts:72-74` 会直接 `return undefined`——**改 origin 本身不会立刻多出任何一张卡**。它改的是：当这条 Run 后续真的产生生成计划时，卡**能**出得来。这是把一个结构性盲区堵上，不是新增一次打扰。

**不动项**：`origin.host` 的其它取值（外部 MCP 宿主的 `external-mcp` 等）一个不动——它们代表的是**真的不在 Nomi 面板前**的调用者，那里不出卡是对的。

**风险与前置核实**：实施前 `git grep -n 'embedded-agent'` 全仓，在 PR 里逐处给裁决（不受影响 / 需同改）。这是 R29 framework-surface 那套「逐字段裁决」的同一手法，别凭印象说「应该没别处用」。

### (d) 画布只留门 A 的最小切法

**目标**：`executeCanvasWriteTarget`（`canvasWriteTarget.ts:245`）成为**模型可达**画布写入的唯一 admission/事务/收据边界（I-3）。

| 现在 | 改成 |
|---|---|
| `capabilityApplyHandler.ts:625` `case 'production.materialize-storyboard'` 直调 `applyCanvasToolCall('create_canvas_nodes', args)`——无 admission、无提议事务、无收据 | 折进门 A：构造 `canvasWriteSemanticInputSchema` 认的 `create_canvas_nodes` 输入 → `buildCanvasWriteAdmissionForOperation`（`canvasWriteEvidence.ts`；`canonicalCanvasPlanPatch.ts:59` 已是这个用法的现成范例）→ `executeCanvasWriteTarget`。`materializationOperationId` 作为 `metadata` 随节点走，幂等章的 owner 不变（仍是 `applyCanvasToolCall` 的 `create_canvas_nodes` 分支） |
| `capabilityApplyHandler.ts:419` `case 'canvas.apply' → applyExternalGraph`——整图替换，连节点级闸都绕过 | **删**。先 `git grep -n "'canvas.apply'"` 核实调用者；确认只被走查/夹具用后同 commit 删（P1）。若仍有生产调用者，改成经门 A 逐节点 admission |
| `multiShotCanvasLanding.ts:230` `inLandingTxn(applyCanvasToolCall(...))` | **本轮不动**。它是宿主侧落地（`reachableBy: host`），有自己的撤销事务与双重幂等章，且**不接受模型输入**——它不是「模型的第二扇门」。列进门表并加注说明豁免理由，留给后续统一 |
| `storyboardRowActions.ts:97`、`journeyTourStore.ts:99/:132` | **不动**。用户手势路径，不在本次范围。门岗白名单必须显式放行它们，否则会误伤 |

#### 关于 `runStoryboardPlanner`——核实后结论是：**它不是一扇门，不用动**

任务书里写它要「改走 lane 工具或删」。核实后：`runStoryboardPlanner.ts:31-56` 只做一件事——让模型输出一份 JSON IR 并 `parseStoryboardPlan`。它给模型的提示词第一行就是「只输出 JSON 对象，不调用工具，不写入画布」（`runStoryboardPlanner.ts:39`），整个函数没有任何 store 写入。真正落节点的是它下游的 `production.materialize-storyboard`，也就是上表第一行。

**把不是 bug 的东西当 bug 改，是 D3 明令禁止的（「叫某东西是 bug 前，先搞懂现有设计为什么这么写」）。** 这一条写在这里，是为了让实施工人不要照着任务书去改它。

#### I-1 的机器化落点（两层，都 fail-closed）

**第一层 · 装配期声明。** 给 `ModelFacingToolEffects`（`electron/shared/agentCapabilities/modelFacingTools.ts:52`，现有三个字段 `mutates` / `billable` / `reversal`）加一个必填字段：

```ts
/**
 * 这个工具会把哪些领域状态**造出来**，以及由谁处理。
 * 同一个 state 可以有多个入口（工具面上的便利），但 owner 必须只有一个——
 * 不同 owner 的同名 state = 第二份实现，装配期当场抛（Codex intercept_apply_patch 的形状）。
 */
readonly creates: readonly { state: CreatableState; owner: string }[];
```

在 `modelFacingToolRegistry.ts:50-65` 的装配循环里加第三条断言（那里已有两条同形状的：`:59` 只读不许声明可撤、`:62` 花钱必须改状态）：同一个 `state` 出现在两个 spec 上而 `owner` 不同 → 当场 `throw`。**为什么在这里**：这是模型可见工具的唯一注册表，装配期抛错 = App 起不来 = 不可能被绕过（R28）。

同时给 `scripts/check-model-schema.ts` 加一条 `duplicate-effect` 规则进棘轮基线。**这条规则要补的正是现有 `identical-input-schema` 规则的盲区**：它（`check-model-schema.ts:270-285`）判的是「schema 形状相同 + 仍留着多值判别枚举」，而本次这一族是**schema 完全不同、效果相同**——所以它看不见，这就是这个 bug 一直没被门岗抓到的原因。**加规则先验它会红**（R17）：拿今天的 `nomi_canvas_write` + `nomi_generation_plan` 跑一次必须红，改完才绿。

**第二层 · 运行期断言（I-2 的执行体）。** `applyCanvasToolCall.ts:326` 的 `create_canvas_nodes` 分支：一个 `executionKind` 非空的节点要落地，必须携带一份 durable 生成计划的绑定（`materializationOperationId` 或等价的 run 绑定）；没有 → 走方案 1 的路由分支（转成生成草稿），而不是建裸节点。这是**最后一道**，它拦得住今天三扇门和明天的第四扇。

### (e) 三处静默改成看得见

| # | 现在 | 改成 | i18n key |
|---|---|---|---|
| ① | `useAgentPanelSpendConfirm.ts:144` `void run(target).catch(() => undefined)`——确认/丢弃失败被吞，卡原地不动，用户再点一次还是没反应 | `catch` 里存错误 → **卡上原地**一行红字 + 「重试」。错误**不清空** `pending`（卡要留着让他重试） | `agentPanelV4.spendCard.confirmFailed` / `.discardFailed` / `.retry` |
| ② | `productionActionIpc.ts:62-64` 读 `listPendingSpendConfirmations` 抛异常 → 返回 `[]`，「读失败」和「没有待确认」完全同形 | 返回可区分的结果。**保留现有意图**（`:52-54` 的注释是对的：能力核还没起来时不该把面板打成错误态）——所以要区分「还没起来」（静默，仍空）与「起来了但读失败」（上报） | 无（主进程侧，文案在渲染层） |
| ②′ | `useAgentPanelSpendConfirm.ts:106-109` 渲染半同样吞 | 连续 3 次（≈4.5s）读失败 → 面板顶部一条「读取失败」态条 + 重试；单次失败仍静默（切项目的正常抖动） | `agentPanelV4.spendCard.pendingUnavailable` |
| ③ | `appIntegration.ts:508-509` 生成适配器 / 付费卡编排装配失败只 `logError`——**付费卡从此永远不出现**，而 App 看起来完全正常 | 面板顶部一条**持久**提示：「付费确认暂不可用，Agent 的生成请求无法送达（重启 Nomi 可恢复）」。这是三处里最重的：它静默时整条钱路是断的，而没有任何一个界面元素会变 | `agentPanelV4.spendCard.approvalUnavailable` |

三条共用同一条判断：**「没有东西要确认」和「我读不到 / 我装不上」必须长得不一样。** 现在三处都让后者伪装成前者，而后者意味着用户按下的每一次「生成」都会消失。

文案全部走 `src/i18n/locales/agentPanelV4.ts`，`zh-CN` + `en` 两份同时加（R15；`check:i18n` 的 key parity 会拦单边）。形态上只加错误态，**不改面板布局**——UI 打磨排在关门之后。

---

## 六、范围 / 不动项 / 回滚

### 范围（本次要改的文件）

- `electron/shared/agentCapabilities/modelFacingTools.ts` —— `effects.creates` 字段
- `electron/shared/agentCapabilities/modelFacingToolRegistry.ts` —— I-1 装配期断言
- `electron/shared/agentCapabilities/canvasModelTools.ts` —— 描述 B-2 / B-4 + `creates` 声明
- `electron/shared/agentCapabilities/extendedModelTools.ts` —— 描述 B-1 + `creates` 声明
- `electron/shared/agentCapabilities/productionRunDescriptors.ts` —— 描述 B-3 / B-5
- `electron/shared/agentCapabilities/productionModelTools.ts` —— `creates` 声明
- `electron/capabilityCore/productionRunTransportAdapters.ts` —— (c) origin
- `src/workbench/generationCanvas/agent/applyCanvasToolCall.ts` —— I-2 运行期断言 + 方案 1 路由分支 + 回执
- `src/workbench/capability/capabilityApplyHandler.ts` —— (d) 两处折并/删除
- `src/workbench/ai/v4/useAgentPanelSpendConfirm.ts` + 付费卡组件 —— (e) ① / ②′
- `electron/productionRun/productionActionIpc.ts` —— (e) ②
- `electron/capabilityCore/appIntegration.ts` —— (e) ③
- `src/i18n/locales/agentPanelV4.ts` —— 新 key（zh-CN + en）
- `scripts/check-model-schema.ts` + `scripts/model-schema-baseline.json` —— `duplicate-effect` 规则
- 测试：`tests/agent-runtime/lane-tool-accuracy.test.mts`（扩臂）、新增门表结构测试、`evals/` 下真实模型脚本
- `docs/fixes/2026-09-11-agent-generation-second-door.root-cause.json`（由草稿改名而来，见下）

### 不动项（写死，实施工人不许扩）

- `productionPendingSpend.ts` 的投影逻辑与定价来源 —— **报价的唯一产地不动**
- `executeCanvasWriteTarget` 内部的 admission / proposalTxn / 收据机制 —— 只改「谁进得来」，不改「进来之后怎么办」
- `multiShotCanvasLanding.ts` —— 宿主侧落地，本轮豁免（理由见 (d)）
- `storyboardRowActions.ts` / `journeyTourStore.ts` —— 用户手势路径
- `origin.host` 的 `external-mcp` 等其它取值
- 画布节点的视觉与 React Flow 内核（R23）
- Agent 面板的布局 —— 本轮只加错误态
- pi SDK —— 不改上游，不给它提 PR（先查别人 §2.5 的结论是「我们自己建」，落点在我们的注册表）

### 回滚

- (a)(b)(c)(d)(e) 各自独立成 commit，可单独 revert
- 最危险的一项是 (a) 的路由分支：回滚 = 删掉那个 `if`，行为退回今天。**无数据迁移**——路由产生的是正常的生成 Run，回滚后它们照常工作
- (c) 回滚 = 一行。旧 Run 的 `origin` 已落盘、不重写，所以回滚也不需要迁移
- (e) 全是新增错误态，回滚 = 删分支 + 删 i18n key

---

## 七、验收门

### 门 1 · 结构（零额度，进 CI，每条都要先验会红 / R17）

1. **装配期断言**：造一个第二个声明 `creates: [{ state: 'generation-node', owner: 'canvas.write' }]` 的 spec → App 装配当场抛。
2. **`check:model-schema` 的 `duplicate-effect`**：用**改之前**的工具表跑 → 必须红；改之后 → 绿。
3. **I-2 运行期断言**：`applyCanvasToolCall('create_canvas_nodes', …)` 传入 `kind: 'image'` 且**不带**计划绑定 → 必须走路由分支，**不得**产生裸节点。
4. **词表对账**：`canvasWrite.ts` 的生成类判据与 `nodes/registry.ts:43` 的 `executionKind` 逐 kind 相等（防两份词表漂移，R14.1）。
5. **门表不回归**：断言「模型可见工具里能产生 `generation-node` 的 owner 数量 === 1」。
6. **三处静默**：各一条测试断言「失败路径产出一个可区分的结果」，而不是与空态同形。

### 门 2 · R30 的两个数（零额度 loopback，进 CI）

扩 `tests/agent-runtime/lane-tool-accuracy.test.mts` —— 它已经是这两个数的现役量具，而且已经带阳性对照臂（`withoutTolerance`）。加两条：

- **`route` 臂**：首调 = `nomi_canvas_write` 建一个 `kind: "image"` 的节点（今天会静默成功）。断言 ①返回的是**路由回执**不是普通建节点收据；②回执文本**逐字包含** `nomi_generation_plan`；③本回合**产生了一份 pending 计划**；④**回合成功率 = 100%**（撞门必须是一次指路，不是一次死局）。
- **`route-control` 对照臂**：同样的首调，但摘掉路由分支（退回今天的行为）。这一臂必须**产不出计划**。没有对照，「100%」和「断言是死的」长得一模一样（`repeated-timeout-means-check-the-assertion` 的教训）。

> **诚实声明（写进 PR，不许省）**：loopback 夹具的工具选择是脚本写死的，所以它**量不了模型的选对工具率**——它量的是「撞门之后系统会不会把用户送到正确结果」。选对工具率只能从真实模型拿（门 3）。把夹具的数字叫成选对率，就是 `assert-you-are-in-the-situation-you-claim` 那一族的假绿。

### 门 3 · 选对工具率（真实模型，DeepSeek 便宜档，跑一次，数字进 PR）

≥20 句用户会真的说出口的话（`agent-testing-means-varied-prompts`：按用户说法铺，不是按界面面排 case），每句跑一次，量**第一次工具调用打在哪扇门**。

**图（6）**
1. 给我生成一张开场图
2. 画一个赛博朋克风格的女主角定妆照
3. 帮我做张封面，横的，要有山
4. 这个镜头缺张图，补一下
5. 用刚才那个角色再出三张不同角度的
6. 把第 2 镜的图重新画一版，换成黄昏

**视频（5）**
7. 把这张图做成 5 秒的视频
8. 生成一段海浪的空镜
9. 第 3 镜给我出个动态版本
10. 用首尾帧做一个转场视频
11. 这段太短了，重新生成一个 10 秒的

**分镜 / 编排（5）**
12. 帮我排一版 30 秒的产品短片分镜
13. 把这个故事拆成 8 个镜头
14. 分镜第 4 行的提示词改一下，主角换成老人
15. 把这些镜头按顺序排到时间轴上
16. 给第 5 镜加一个推镜头

**改图 / 参考（4）**
17. 把这张图里的背景换成雪山
18. 以这张为参考，风格保持一致再来一张
19. 这两个节点连一下，让第二个参考第一个
20. 把这几个节点编成一组，改名叫「开场」

**混淆项（4，故意长得像生成但不是）**
21. 画布上那几个节点太乱了，整理一下
22. 给我写一个 SVG 的 logo 放画布上
23. 把第 3 镜改名叫「雨夜」
24. 删掉最后两个空节点

**判据**
- 第 1–18 句：第一次工具调用是 `nomi_generation_plan` —— 目标 **≥90%**
- 第 19–24 句：第一次工具调用是 `nomi_canvas_write` / `delete_canvas_nodes`（反向不能被过度收敛打伤）—— 目标 **100%**
- 回合成功率（整轮是否走到「用户能点卡 / 能看到结果」）—— 目标 **≥90%**
- **必须同时报改前基线。** 只有「改后 92%」而没有「改前多少」的数字不构成证据（`no-magic-number-fixes-verify-with-real-runs`）。

### 门 4 · 真人走查（R13 / P3；必须像真人一样点 / `tests-must-drive-ui-like-a-human`）

一个窗口、界面动作、模型从下拉里选，**不灌状态、不走桥、不用夹具输入**：

1. Agent 面板输入「给我生成一张开场图」→ 截图：卡出现、带报价、画布上有占位节点。
2. 点确认 → 截图：真的开始生成、任务卡在动。
3. 输入「画布整理一下」→ 截图：**没有**卡出现，节点被整理。
4. 造一次装配失败（(e)③）→ 截图：面板顶部有持久提示，不是一片正常。
5. 杀掉能力核后点确认（(e)①）→ 截图：卡上原地报错 + 重试，不是静默不动。

截图人眼判断（不是 `expect` 断言），逐张与 (e) 的形态描述对账。

### 门 5 · 常规

`typecheck` / `lint:ci` / `check:i18n` / `check:vocabularies` / `check:model-schema` / `check:root-cause-contracts` / `check:prior-art` / `test:system:focused`。

---

## 八、实施顺序（每步独立可回滚，每步跑一次门 1）

1. **(e) 三处静默** —— 与工具面完全解耦，先做先受益，也是后面几步调试时的眼睛
2. **(c) origin** —— 一行、无行为变化（先跑完 `git grep 'embedded-agent'` 的逐处裁决）
3. **I-1 `effects.creates` + 装配断言 + `duplicate-effect` 规则** —— **先验它对今天的工具表会红**
4. **(b) 五条描述改写** —— 门岗已在，改完立即跑门 3 测**改前/改后**两组基线
5. **(a) I-2 运行期断言 + 路由分支 + 回执 + i18n** —— 主刀
6. **(d) 门 A 折并与 `canvas.apply` 删除** —— 结构清理放最后，前面几步的测试会保护它
7. 门 3（真实模型）+ 门 4（真人走查）→ 数字与截图进 PR

---

## 九、已知缺口（诚实标注 / D4 / R19）

- **loopback 量不了选对率**（见门 2 声明）。真正的选对率每次改描述都要重跑门 3，它不在 CI 里，靠纪律。
- **方案 1 不治成因，只治后果**。模型仍然可能选错工具名；结构保证用户拿到正确结果，但工具面上的歧义还在。要真正消除，下一轮的选项是「删掉 `nomi_canvas_write` 的 create 能力，只留 arrange」——那是 Claude Code 删 `MultiEdit` 的那一手，等门 3 的数字说话再决定，**本轮不做**。
- **`multiShotCanvasLanding.ts:230` 本轮不折并**，画布写入仍有一处宿主侧旁路。它不接模型输入，风险低于模型可达的那几扇，但 **I-3 在这一轮没有完全成立**——根因合同里如实记为 residual risk，不写成「已解决」（R19）。
- **`text` kind 的归属需要一次确认**：`registry.ts:83` 给 `text` 也声明了 `executionKind: 'text'`，按 I-2 它会被划进生成类，于是「Agent 建一个空文本节点当便签」会被路由成一份文本生成草稿。实施前必须确认这是不是合理用法。若是，**正确做法不是在 kind 闸里手写 `if (kind !== 'text')` 例外**（那是第二份词表），而是让「会不会花钱」从 `executionKind` 之外单独声明一档（例如 registry 上加 `billable`），闸从新那一档 derive。
- **外部 MCP 宿主的可见变化**：方案 1 之下外部宿主用 `nomi_canvas_write` 建生成类节点会得到一份路由回执与一张卡，而不是一个静默的空节点。这是**修复**不是回归（它们本来也建不出图），但要在 PR 正文和 release note 里明说。
- **工具总数可能已超 OpenAI 建议的 20**（见 B-5 下的注）。若实测超了，它会持续压低门 3 的天花板，但本轮不处理。

---

## 十、待拍板的一个问题

**只有一条需要用户拍**（其余按 P0 自主推进）：

> **(a) 走方案 1（归一，Agent 用错工具也照常出卡出图）还是方案 2（封死，逼模型换工具）？**
>
> 推荐方案 1。差别对用户的体感是：方案 1 = 「不管 AI 怎么绕，你都拿到图和报价」；方案 2 = 「工具面更干净，但 AI 偶尔会当着你的面纠正一次自己」。

根因合同草稿（`docs/fixes/2026-09-11-agent-generation-second-door.root-cause.draft.json`）按方案 1 写；若拍板改方案 2，合同的 `prevention.strategy` 与 `invariants` 需同改。

> **实施工人注意**：合同现在叫 `.root-cause.draft.json`（不以 `.root-cause.json` 结尾），因此 `check:root-cause-contracts` 不会收它。这是有意的——该门岗要求 `regression_tests` 的每个文件都**存在且在本次 diff 中被改过**（`scripts/root-cause-contracts.mjs:440-447`），一个 docs-only 分支满足不了，强行用正式名字只会让门岗红。**实施时把它改名成 `2026-09-11-agent-generation-second-door.root-cause.json`，与代码和测试放进同一个 commit**，那一刻门岗才验得过。
