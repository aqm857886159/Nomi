# 技能是怎么被触发和用上的：官方标准 vs Nomi 现状

> 基线：`origin/main` @ `a40886b63`（2026-09-12）。纯调研，不改生产代码。
> 触发事由：用户选了技能，但产出的提示词与画幅（画幅）和技能里写的对不上，判断「技能没用上」。
> 已有证据：2026-09-11 一条 pi lane 真实转录（DeepSeek v4 flash）——模型"用技能"的方式
> 只有一种：对 `/Users/aoqimin/Desktop/Nomi/skills/<name>/SKILL.md` 调 `read`（而且是在用户追问两次之后），
> 分镜那轮读了 `workbench-storyboard-planner`、`director-cinematography`、`director-consistency`；
> 被问「你用技能了吗」时它答"用了"，用户判定产出不符。

---

## 1. 官方 Agent Skills 标准（R5/R31：实抓文档）

### 1.1 格式与触发（agentskills.io，Anthropic 开源出去的开放标准）

来源：<https://agentskills.io/>、<https://agentskills.io/specification>

一个技能 = 一个目录 + 一个 `SKILL.md`（YAML frontmatter + Markdown 正文），可选 `scripts/`、`references/`、`assets/`。

**frontmatter 是一个闭集**（规范正文列出的全部字段）：

| 字段 | 必填 | 约束 |
|---|---|---|
| `name` | 是 | ≤64 字符；小写字母/数字/连字符；不得以 `-` 开头结尾；不得连续 `--`；**必须与父目录名一致** |
| `description` | 是 | ≤1024 字符；要同时写清「做什么」和「什么时候用」 |
| `license` | 否 | 许可名或捆绑许可文件名 |
| `compatibility` | 否 | ≤500 字符；环境要求 |
| `metadata` | 否 | 任意 key-value 映射，供各家客户端放自己的扩展 |
| `allowed-tools` | 否 | 空格分隔的预批准工具串（规范明标 Experimental） |

**触发 = description 驱动的模型自主决定**，分三级渐进披露（规范原文的三段式）：

1. **Discovery（启动时）**：只加载每个技能的 `name` + `description`，约 100 token/条。
2. **Activation（任务匹配 description 时）**：模型把完整 `SKILL.md` 正文读进上下文（建议 <5000 token）。
3. **Execution（按需）**：`scripts/` / `references/` / `assets/` 里的文件只在被引用时才读。

Anthropic 平台文档（<https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview>）把这一条说得更死：
`description` 是"你的请求拿来匹配的那个东西"，决定技能触不触发；技能被触发后，
**Claude 用 bash 从文件系统读 SKILL.md**——没有什么"宿主侧分类器"，也没有一个专门的加载函数。
平台侧 `name` 还额外禁用保留词 anthropic / claude，禁 XML 标签。

### 1.2 Claude Code 的实现（<https://code.claude.com/docs/en/skills>）

Claude Code 在标准之上加了**两条调用路径**和一批自己的 frontmatter 扩展：

- **模型调用**：description（以及 Claude Code 扩展的 `when_to_use`）驱动，由**一个真的工具 `Skill`** 执行，
  因此可以写权限规则 `Skill(commit)` / `Skill(deploy *)`。`disable-model-invocation: true` 关掉这条路。
- **用户调用**：`/skill-name` 斜杠命令，出现在 `/` 菜单里；`user-invocable: false` 关掉这条路。

关键一条与我们直接相关：**用户显式选择并不会"立刻把正文塞进这一轮"**，而是
「选中 → 走同一个加载动作 → 正文进上下文后**跨回合常驻**」；后续回合若渲染内容相同，
Claude Code 只补一行短提示而不重复整段；内容变了才重新整段追加。

Claude Code 的扩展字段（全部可选）：`when_to_use`、`disable-model-invocation`、`user-invocable`、
`allowed-tools`、`disallowed-tools`、`model`、`effort`、`context: fork`、`agent`、`background`、
`arguments`、`argument-hint`、`paths`、`shell`、`hooks`、`metadata`、`license`、`compatibility`。

### 1.3 pi 的实现（我们 lane 用的那一家）

包：`@earendil-works/pi-coding-agent@0.85.1`。SDK 文档 <https://pi.dev/docs/latest/sdk>，
skills 说明 <https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md>。

- 发现层是 `ResourceLoader`；`DefaultResourceLoader` 从 `~/.pi/agent/extensions/`、`.pi/extensions/`
  和 settings 声明的来源扫盘，并缓存已加载资源。调用方可用 `skillsOverride` 直接塞一份自己的技能表
  （Nomi 走的就是这条：技能不在 pi 的发现根上）。
- 索引渲染是导出的 `formatSkillsForPrompt(skills, fileReadTool)`，
  实现见 `dist/core/skills.js:279-298`。它**过滤掉 `disableModelInvocation`**，然后吐出：

  ```
  The following skills provide specialized instructions for specific tasks.
  Use the read tool to load a skill's file when the task matches its description.
  When a skill file references a relative path, resolve it against the skill directory ...

  <available_skills>
    <skill>
      <name>…</name>
      <description>…</description>
      <location>/abs/path/SKILL.md</location>
    </skill>
  </available_skills>
  ```

- **pi 不提供 `load_skill` 工具**。加载动作就是普通的 `read`（或 `bash`，由 `fileReadTool` 选词）。
  这与 Anthropic 平台文档的「用 bash 读 SKILL.md」同构，与 Claude Code 的 `Skill` 工具不同——
  Claude Code 是这三家里**唯一**把"加载技能"做成一个有名字、有权限规则、在 UI 上看得见的动作的。

---

## 2. Nomi 这一侧真实在做什么（file:line，`origin/main` @ `a40886b63`）

### 2.1 索引渲染：与标准同构

- `electron/agentLane/laneInstalledSkills.mts:103-127` —— `LaneSkillIndexSource`：
  每个**回合**边界刷新一次技能库，回合内不变；索引里只有 `name` / `description` / `filePath` / 两个布尔，
  **正文不在索引里**（契约定义 `electron/shared/agentLane/laneContracts.ts:612-621`）。
- `electron/agentLane/laneSkillIndex.mts:125-132` —— `renderLaneSkillSection()` 直接调 pi 的
  `formatSkillsForPrompt(…, 'read')`。文件开头注释（`:1-31`）明写：**不新造 `load_skill` 工具**，
  理由是常驻工具要占 `LANE_TOOL_BUDGET`，而 pi 给的答案就是"用 `read` 去读 `<location>`"。
- `electron/agentLane/laneHost.mts:209-237` —— `<available_skills>` 段拼进系统提示词，
  每回合整体重新求值一次（`systemPromptForRun`）。
- `electron/agentLane/laneCodingPaths.mts:50-104` —— `read` 被允许越出项目目录去读技能包根，
  而且**可信根与索引同源**（`laneNativeDesktop.mts:38`），所以"看得见 = 读得到"是结构事实，不是巧合。

结论：**触发机制本身没坏，而且与三家标准同构**——description 驱动、模型自己决定去 `read` 哪一条。
转录里模型对 `SKILL.md` 调 `read`，正是这套机制正常工作时该有的样子。

### 2.2 索引里有哪些技能：48 / 88

- `electron/agentLane/laneDesktopRuntime.ts:149` —— 喂给 lane 的是
  `readSkillRecords().filter(isSkillSelectableInWorkbench)`。
- `electron/skills/skillStore.ts:269-274` —— builtin 技能要 `metadata.nomi.selectable-in-workbench: true`
  或带 `stages` 才算数；user 导入的一律算数。
- 实测（YAML 解析 `skills/*/SKILL.md`）：88 个内置技能里 **48 个进索引**，40 个不进
  （全是 `effect-*` 这批效果预设）。`director-cinematography` / `director-consistency` /
  `workbench-storyboard-planner` 都在这 48 个里，所以转录里那三次 `read` 路径是合法的、读得到。
- 同一个谓词也决定了技能选择器里能看到什么（`electron/skills/skillIpc.ts:70-74`）。

### 2.3 用户显式选择：这一条消息的一次性拼接

- 渲染层：`src/workbench/ai/v4/useAgentPanelV4Actions.ts:161` 把 `skillKey` 随这条消息发出；
  `:173` 发送成功后立刻 `setCreationActiveSkill(null)`——注释写明这是刻意的：
  技能是"随这条消息发出去的引用"，不是常驻开关。
- 主进程：`electron/agentLane/laneDesktopRuntime.ts:170-173` ——
  `composer = { ...next, systemPrompt: [next.systemPrompt, skill?.body].filter(Boolean).join('\n\n') }`。
  **把 `skill.body` 原样拼在这一轮的 composer systemPrompt 后面，没有任何框住它的话**。
- 这段 composer systemPrompt 在 `electron/agentLane/laneHost.mts:373` 与身份层、模型索引一起下发。
- 下一条消息没挂技能时 `skillKey` 为空，正文随之消失——**所以是一轮有效，不跨回合常驻**。

对照 Claude Code：那边是"加载一次、跨回合常驻、内容没变只补一行"。我们是"这一轮拼一次、下一轮就没了"。

单发请求（分镜规划师走的那条）是同一个形状：`src/workbench/ai/agentLoopMode.ts:28-50`
（`runSingleShotAgent`）把 `skillKey` 塞进 context → `electron/agentLane/laneDesktopRuntime.ts:94-101`
`systemPrompt: [buildLanguageRule(), NOMI_AGENT_IDENTITY, context.systemPrompt, skill?.body]` ——
同样是**裸正文**。

值得单独记一笔：仓库里**有**一份框好的实现——`electron/harness/context/agentContext.ts:85-107`
的 `buildSkillSystemPrompt`，它会写"以下内容是本次回复必须参考的领域方法论和输出约束"，
并附 `skillKey` / `skillName` / `skillFile` 三行凭据，还会在技能找不到时明确告诉模型
"不要声称已经加载不存在的 skill"。实测 `grep`：`buildSkillSystemPrompt` 与
`composeAgentSystemPrompt` **零生产调用者**（只有同文件内的注释自引用）。
也就是说，唯一会让模型"知道自己加载了哪个技能、并被禁止假装加载"的那段话，今天一个字都发不出去。

### 2.4 `<location>` 为什么是开发仓路径

`electron/runtimePaths.ts:57-67`：

```
const candidates = [
  process.env.NOMI_SKILLS_DIR,
  path.join(process.cwd(), "skills"),      // ← dev 下 cwd = 仓库根
  path.join(app.getAppPath(), "skills"),
  path.join(__dirname, "../skills"),
  path.join(process.resourcesPath || "", "skills"),
  getUserSkillsRoot(),
];
```

`process.cwd()/skills` 排在安装目录之前。开发模式下 cwd 就是仓库根，
于是 `<location>` 写的是 `/Users/aoqimin/Desktop/Nomi/skills/...`——**转录里那条路径与"这是一次 dev 运行"完全自洽，
它本身不是打包版的 bug**。

打包版的情况（`package.json` 的 `build.files` 含 `skills/**`，无 `asarUnpack`，asar 默认开）：
技能落在 `…/Contents/Resources/app.asar/skills/`，`app.getAppPath()` 那一条命中，路径改写成 asar 内路径。
两点仍需真机验证（本轮未做，不当结论）：① `laneInstalledSkills.mts:45-47` 与
`laneCodingPaths.mts:52-56` 对 asar 内路径调 `realpath`/`lstat` 是否与 Electron 的 asar 补丁完全咬合；
② `process.cwd()` 在打包版里由启动方式决定（Finder 启动是 `/`），
**若用户从一个恰好含 `skills/` 的目录启动 Nomi，那个目录会成为可信技能根**——这一条是真的口子，
与本次"技能没用上"无关，但值得单独修。

### 2.5 技能正文能不能管到画幅？——不能，只能"劝"

先把 `SkillRecord.body` 的**全部**消费者点清（实测穷举）：

1. `electron/skills/skillIpc.ts:81` —— 投影给渲染层做展示。
2. `electron/harness/context/agentContext.ts:86-107` —— `buildSkillSystemPrompt`（**零生产调用者**，见 §2.3）。
3. `electron/promptLibrary/curatedPrompts.ts:6-13` —— 只对 `metadata.nomi.library.kind === "effect"`
   的内置技能生效：去掉 frontmatter 的正文变成一条提示词库条目；应用它只建一个带 `kind` + `prompt`
   的节点，**不带模型、不带 params**（`src/workbench/promptLibrary/PromptLibraryPanel.tsx:177-183`）。
4. lane / 单发的裸拼接（`laneDesktopRuntime.ts:100`、`:172`）。

frontmatter 同样是惰性的：manifest schema（`electron/skills/skillManifestSchema.ts:106-116`）只认
`version/label/author/audience/selectableInWorkbench/requestedCapabilities/tools/requiredProviders/stages`；
`skillStageModelPrefSchema`（`:51-58`）是 `.strict()` 且**刻意**拒收 `archetypeId` / `params`，
注释（`:45-50`）写明了这是有意的；`family` 标着 `@deprecated … 无运行时模型家族选择作用`。
历史上也确实试过：`src/workbench/generationCanvas/agent/storyboardProfiles.ts:5-12` 原话记着
`skills/workbench-storyboard-planner/skill.json` 里曾有一个同名 `storyboardProfile` 块，
**"但它从来没有被读过"**。

所以：**全仓没有任何一处把 `SKILL.md` 的正文或 frontmatter 读进生成参数。**

画幅的真相源是分镜方案，不是技能：

- `src/workbench/generationCanvas/agent/storyboardAspectScope.ts` 是**画幅作用域的唯一 owner**：
  `planDefaultAspect(plan) = plan.aspectRatio ?? commonShotAspect(plan)`（`:37-39`），
  行级覆盖读 `shot.params.aspect_ratio`（`:24-28`），生效值 `effectiveShotAspect`（`:48-50`）。
  **两者都空时返回 `''`，注释原话是"还没定，按模型默认走"。**
- `src/workbench/generationCanvas/agent/storyboardPlan.ts:217` 定义 `StoryboardPlan.aspectRatio`
  （2026-09-05 用户拍板的"整片默认画幅"）；落画布时
  `:551-555` 把 `shot.params` 原样铺进节点 `params`，`duration` 另算。
- `src/workbench/generationCanvas/agent/storyboardPromptCompiler.ts` 是纯函数层：
  只读 plan 的锚/镜头结构编译出文字，**不碰任何落画布参数**（文件头注释 `:5-11` 自己写明）。
- 模型能写画幅的**唯一**入口是工具参数：`electron/shared/agentCapabilities/canvasWrite.ts:229`
  的 `edit_storyboard_shots.patch.aspectRatio`，以及建节点时的 `params`（`:65`）。
  可用取值由模型档案声明（如 `electron/shared/videoCapabilities/sora2.ts:15`
  `aspect_ratio` 默认 `16:9`；`minimaxH3Max.ts:12` 同）。

唯一的连接是"提示词层的劝说"：`skills/workbench-storyboard-planner/SKILL.md:133` 明写
让模型"按该模型列出的参数名填 `params`（如 `aspect_ratio` 画幅、`resolution` 清晰度）"；
`skills/brand-promo/SKILL.md:141` 写"画幅：竖屏 9:16 还是横屏 16:9，默认问，不默认横屏"。
这两句只有在模型**真的读了正文、并且真的去填了那个工具参数**时才生效；
它没填，画幅就静默落回模型档案默认（多数是 `16:9`），界面上没有任何东西提示"技能那句话被忽略了"。

**所以，直白回答**：今天 Nomi 的技能**管不了画幅**，只能**建议模型去管**。要让技能真的管住画幅，
它得插在分镜方案这一层——技能声明一个结构化的默认（画幅/时长/片种），在建 plan 时写进
`StoryboardPlan.aspectRatio`（走 `storyboardAspectScope.setPlanDefaultAspect`，
它已经是这一语义的唯一 owner），而不是靠正文里一句中文劝模型填参数；
技能库这边对应的落点是 `metadata.nomi` 扩展块（标准允许的唯一扩展点，见 §3 R31 一栏），
项目级画幅设置则是另一条更上游的路。**本文不给实施方案，只指出插口在哪一层。**

### 2.6 ⚠️ 顺带挖到一个真 bug：整片默认画幅**根本到不了画布**

这一条不是"技能的问题"，但它很可能才是用户"画幅对不上"最直接的原因。三段扣在一起：

1. **`plan.aspectRatio` 只有 UI 在读。** `planDefaultAspect` / `effectiveShotAspect`
   （`storyboardAspectScope.ts:37-50`）的全部非测试消费者是分镜表界面：
   `StoryboardShotTable.tsx:249,336`、`StoryboardBulkBar.tsx:55`、`StoryboardPlanEditor.tsx:502`。
2. **落画布那一层不读它。** `storyboardPlan.ts:551-555` 的 `params` 只铺
   `{ ...(shot.params || {}), ...(duration) }`——**没有任何地方把 `plan.aspectRatio` 合进去**；
   `src/workbench/creation/storyboard/exec/storyboardProjection.ts:30,41-43` 同样只看 `shot.params`。
3. **而"继承整片默认"的行是被主动清空的。** `setPlanDefaultAspect`（`storyboardAspectScope.ts:74-86`）
   把"旧值 = 当时默认"的行 `withShotAspect(shot, null)` 清掉；
   `setShotAspectOverride`（`:89-97`）更狠：用户在某一行选了一个**恰好等于整片默认**的画幅，
   `normalized` 直接算成 `null`，那一行的 `aspect_ratio` 被删掉。

合起来：**一行只要"继承整片默认"（也就是 95% 的行），它落到画布上就带不着 `aspect_ratio`，
于是回落到模型档案的默认值**（例如 `src/config/modelArchetypes/gptImage2.ts:16` 的 `"auto"`、
`electron/shared/videoCapabilities/sora2.ts:15` 的 `16:9`）。
用户在批量条上把整片画幅设成 9:16、界面上每一格也画成竖的，出片仍可能是 16:9 或 auto。
现有测试只覆盖逐镜 `params.aspect_ratio` 那条路（`storyboardPlan.test.ts:378,412`），所以门岗看不见。

**同一族的第二处**：`storyboardPlanSchema`（`storyboardPlanSchema.ts:74-87`）**没有 `aspectRatio` 键**，
而 `parseStoryboardPlan` 用的是默认 zod（未知键静默丢弃）。
所以就算规划师模型在方案顶层写了整片画幅，它在解析那一刻就消失了——
规划师能设画幅的唯一途径只剩逐镜 `params`（`:57` 的 `z.record(z.unknown())`）。

（本轮只做定位，不给实施方案。）

### 2.7 观测面：模型自己加载技能时，界面上一个字都没有

- 用户挂技能发的那条消息，转录里有 `skillKey`，面板画成一枚 chip
  （`electron/shared/agentLane/laneProjection.ts:231-237`、
  `src/workbench/ai/lane/laneViewModel.ts:334-336`；契约注释
  `electron/shared/agentLane/laneContracts.ts:40-46` 原话：选完之后对话里一个字都看不到它，用户只能猜）。
- **模型自己去 `read` 一个 `SKILL.md` 时，不产生任何技能 chip、任何凭据、任何事件**——
  转录里只有一次普通的 `read` 工具调用，参数是一条长路径。
  全仓没有 "skill loaded / skill activated" 之类的 host-note 或 receipt。
- 结果就是用户问"你用技能了吗"时，**模型只能凭自己的印象回答，而界面无法为它作证或打脸**。

### 2.8 两处小账（顺手记下，与本次现象无关）

- `electron/agentLane/laneSkillIndex.mts:88-97` 的解锁条件②读的是**顶层** frontmatter 键 `tools:`，
  但 88 个内置技能的顶层键只有 `name` / `description` / `license` / `metadata` / `disable-model-invocation`，
  `tools` 一律写在 `metadata.nomi.tools` 里，而且**没有任何内置技能带 `scripts/`/`bin/`/`hooks/` 目录**。
  → 这条解锁分支今天恒假。更要紧的是，顶层 `tools:` 本身**违反规范的闭集**
  （见 `docs/engineering/standard-formats.json:95` 我们自己写的那条裁决：官方参考校验器
  `skills-ref` 多一个顶层键就报 error），所以它也不该被写出来。
- `disableModelInvocation` 的技能仍然进 `entries` 与 `trustedSkillRoots`，只是 pi 渲染时过滤掉。
  行为与标准一致（不可被模型触发，仍可被显式送），只是命名上容易误读。

---

## 3. 差距表

| # | 标准怎么说 | Nomi 怎么做 | 用户感受到什么 | 定性 |
|---|---|---|---|---|
| G1 | Claude Code 有一个**具名的 `Skill` 工具**执行加载，动作在 UI 与权限规则里都可见；平台文档也把"读 SKILL.md"当成一个可追溯的步骤 | **没有加载动作，也没有收据**。模型加载技能 = 一次普通 `read`；无 chip、无凭据、无事件（`laneProjection.ts:231-237` 只为用户挂的 `skillKey` 画 chip） | 「你用技能了吗」**在产品里不可回答**：模型说用了，界面既不能证实也不能证伪。这正是这次投诉的第一因 | **能力缺口**（标准没强制要有 `Skill` 工具，pi 也没有；但"加载可观测"是 Claude Code 已经证明可行的那条路） |
| G2 | Claude Code：显式选择后正文**跨回合常驻**，后续回合只补一行短提示 | 显式选择 = **只拼这一条消息**（`useAgentPanelV4Actions.ts:173` 发完即清、`laneDesktopRuntime.ts:170-173` 只写本轮 composer） | 用户以为"我已经把这条对话切到这个技能了"，实际第二句话起技能就没了。多轮分镜里尤其致命——正文在第 1 轮，落画布在第 3 轮 | **规范偏离（R31，对齐 Claude Code 的语义）**。产品上是刻意选的（注释引 2026-09-10 用户反馈"挂着不摘让人以为以后每条都得用"），但"不常驻"与"发完即清"是两件事，现在合成了一件 |
| G3 | 索引只给 name+description，正文按需读——**三家一致** | 同构，用的就是 pi 的 `formatSkillsForPrompt`（`laneSkillIndex.mts:125-132`） | 无 | **一致**（这一格没坏，别去动它） |
| G4 | 正文加载要么由框架执行（Claude Code 的 `Skill`），要么由模型 `read`（pi / 平台） | 模型 `read`。转录显示**用户追问两次之后**模型才去 read | 用户说一句话，模型不去读技能就直接开写；读不读全凭 description 匹配和模型自觉，弱模型（DeepSeek v4 flash）更容易跳过 | **能力缺口**：description 驱动是标准，但"用户已经显式点了这个技能"这件事没有被翻译成"必须加载" |
| G5 | 显式拼进提示词的技能正文应当被框住（说明它是什么、从哪来） | lane 与单发都拼**裸正文**（`laneDesktopRuntime.ts:100`、`:172`）。带框的那份 `buildSkillSystemPrompt`（`agentContext.ts:85-107`，有 skillKey/skillName/skillFile 三行凭据，以及"不要声称已经加载不存在的 skill"那句）**零生产调用者** | 模型分不清哪段是身份、哪段是技能、哪段是用户话；也没有 skillFile 可引用。**而且那句"不许假装加载"恰恰发不出去**——转录里模型答"用了"，与此直接相关 | **能力缺口**（同一语义两份实现，能用的那份是死码——R14.1 那一类） |
| G6 | 技能 = 指令 + 可选脚本/资源；`allowed-tools` 是规范里的实验字段 | 顶层 `tools:` 分支恒假；无内置技能带 `scripts/`；扩展一律走 `metadata.nomi`（符合规范扩展点） | 无直接感受 | **死分支 + 潜在规范偏离**（若真写顶层 `tools:`，官方校验器会拒；见 §2.8） |
| G7 | 规范不管生成参数——技能只能通过指令影响产物 | 同上，但**Nomi 的画幅有独立真相源**（`storyboardAspectScope.ts`），空值静默落回模型档案默认 | **技能写了"竖屏 9:16"，出来还是 16:9，而且没有任何提示说明这句话没被采纳。** 这是投诉的第二因，也是更本质的那个 | **能力缺口**（不是规范问题：任何一家的技能都管不到宿主的参数默认。要管就得我们自己开一个声明式插口） |
| G8 | （与标准无关，落画布这一层的自有 bug） | **整片默认画幅到不了画布**：`plan.aspectRatio` 只有分镜表 UI 在读，`storyboardPlan.ts:551-555` 不合并它，而"继承默认"的行还被 `storyboardAspectScope.ts:74-97` 主动清掉 `aspect_ratio` | 在批量条上设了 9:16、表里每格也画成竖的，**出片仍按模型档案默认走**（`auto` / `16:9`）。这多半才是"画幅对不上"的直接原因，且与选没选技能无关 | **真 bug**（§2.6）。附带：`storyboardPlanSchema` 无 `aspectRatio` 键，规划师写的整片画幅在 `parseStoryboardPlan` 处被静默丢弃 |
| G9 | `<location>` 是给模型读的绝对路径 | `runtimePaths.ts:60` 把 `process.cwd()/skills` 排在安装目录之前 | dev 下路径是开发仓（与转录一致，无害）；**打包版若从含 `skills/` 的目录启动，那个目录会变成可信技能根** | **独立安全口子**（与本次现象无关，建议单独修） |

格式层面（R31）没有分叉：`docs/engineering/standard-formats.json:62-95` 已经把 `agent-skill` 登记为
对齐 `SKILL.md` 标准的格式，扩展只走 `metadata`，门岗 `check:skills-format` 把内置技能交给 pi 自己的加载器判分（登记表里记的是当时的 33/33）。
**这次的问题全在行为层，不在格式层。**

---

## 4. 给用户的十行结论

1. 触发机制**没坏**：Nomi 走的就是三家（Anthropic 平台 / Claude Code / pi）同一条路——系统提示词里只放技能的名字和描述，模型自己判断该用哪条、再去把正文读进来。转录里那几次 `read`，正是它正常工作的样子，不是敷衍。
2. 但「画幅对不上」这件事，**大概率根本不是技能的锅**。挖到一个真 bug：整片默认画幅存在方案里，只有分镜表界面在读它；**落画布那一层从来不读**，而"跟随整片默认"的镜头还会被主动清掉画幅参数。于是你在批量条上设了竖屏、表里每格也画成竖的，出片仍按模型自己的默认走（`auto` / `16:9`）。
3. 换句话说：那些画幅**从没被送到生成那一步**。这跟你选没选技能无关，选了也一样。
4. 技能这边的第二条：**技能正文管不了画幅，只能"劝"**。全仓没有任何一处把 SKILL.md 的文字或 frontmatter 读进生成参数——技能只能在正文里写一句中文，让模型自己去填那个工具参数。模型没填，就静默落回模型默认，界面上没有任何提示说"技能那句话被忽略了"。
5. 技能这边的第三条：**你挂的技能只管一句话**。发出去那一瞬它就被摘掉了，正文只拼进那一条消息；第二句话起技能就不在了。多轮分镜里技能在第 1 轮、落画布在第 3 轮，正好错过。（对照 Claude Code：那边选中之后正文是跨回合常驻的。）
6. 技能这边的第四条：**"用没用上"今天在产品里不可观测**。模型自己加载技能时，界面不留任何痕迹——没有标记、没有凭据、没有事件。更讽刺的是，仓库里早写好了一段会告诉模型"不许假装加载技能"的提示词，实测**零生产调用者**，一个字都发不出去。所以你问"你用技能了吗"，模型只能凭印象答，界面既不能证实也不能证伪。
7. 所以你的感受是准的，但拆开是三件事叠在一起：**画幅压根没送出去（bug）+ 技能本来也管不到画幅（设计）+ 用没用上看不见（缺观测）**。触发机制是唯一没问题的那一格。
8. 候选修法，按"先止血再治本"排：**①修画幅直通**——让整片默认画幅真的合进落画布参数，并给它补一条端到端测试（最便宜、最直接，且与技能无关）；**②加载收据 + 技能常驻**——模型读了哪条技能就在面板和转录里留一条可见记录，显式选中的技能跨回合常驻并用现成那段带凭据的框（对齐 Claude Code 语义，让"用没用上"变成可对账的事实）；**③技能声明结构化默认**——让技能在 `metadata.nomi` 里声明画幅/时长/片种这类可机器读的默认，建方案时直接写进整片默认，而不是靠正文劝模型。
9. 性价比：① 是当场能验证的 bug 修复，先做；② 解决"看不见"和"只管一轮"，中等成本，但它把后续所有关于技能的争论变成可对账的；③ 才真正让技能"管得住"画幅，要动分镜方案这一层，最贵，建议等 ① ② 落地后再谈。
10. 另外两笔与本次无关的账：转录里那条开发仓路径是 dev 运行的正常表现、不是打包 bug；但打包版若从一个恰好含 `skills/` 的目录启动，那个目录会被当成可信技能根——这是个该单独修的小口子。

---

## 引用来源

- Agent Skills 开放标准：<https://agentskills.io/>、<https://agentskills.io/specification>
- Anthropic 平台文档：<https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview>
- Claude Code：<https://code.claude.com/docs/en/skills>
- pi SDK：<https://pi.dev/docs/latest/sdk>；skills 文档
  <https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md>；
  实现读自本机 `@earendil-works/pi-coding-agent@0.85.1` 的 `dist/core/skills.js:279-298`
