# 技能怎样才能不绑死宿主的工具名

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 2026-09-18 · 调研 + 方案 · 不含生产代码
> 触发：用户问「外部装进来的 skill 不知道我们的工具名，能不能设计一种通用的东西让 skill 调用该调用的东西？要不然这些 skill 给到 coding agent 他们怎么搞得。」
> 规则面：R5⑤（对外也读写的契约，先找规范再谈偏差）、P2（修根因）、R17（防线建在最早能拦住的那层）

## 0. 一句话结论

**业界没有 (b) 那种「语义能力名 → 工具」的标准间接层，而且 MCP 社区刚刚明确否掉了它**；主流做法是 **(a) 技能只描述要做成什么，不提工具名**。
但 **Nomi 已经把 (b) 建好了**（`electron/shared/agentCapabilities/` 能力注册表 + 四 surface 别名 + `requested-capabilities`），
**只是没有一个技能用它**（0/88）——全都绕过间接层，直接把 `pi` surface 的工具名抄进 frontmatter 和正文。
所以我们的动作不是「造一个间接层」，是**把已有的间接层接上，并让门岗拦住不接的那种写法**。

---

## 0.5 目标是**双向**的（2026-09-18 用户拍板：「不，我们必须可以开放。」）

这条规则有两个理由，只写「防复发」是把目的说成了副产品：

**① 进来**——任何来源的技能装进 Nomi 都能跑，**包括本来是给别的宿主写的**。
一个 ChatCut 技能说「调 `submit_video`」，那工具 Nomi 没有。正确行为不是拒收、不是报错，
而是运行时告诉模型「你实际拥有的是这些」，让它把那一步映射到 Nomi 的生视频动词上。
**这是可用性，不是容错。** 外部技能**零拦截**：拒收就是把我们的问题推给用户（D1）。

**② 出去**——我们自己的 88 个技能拿到别的宿主也能跑。
**正文里焊死工具名与工具性质，技能就只能在 Nomi 里用。** 这一条反过来约束我们自己，
也是「别在正文写工具名与工具性质」这条规则的**主要目的**；防 09-18 复发只是它顺带做到的事。
对应 09-07 开放战略：评估任何功能先问「更能被接、更能接别人吗」。

### 0.5.1 ChatCut 的两层做法：规则对，执行方式是关门

本机 61 个 ChatCut 技能实读（这一层我第一版调研没覆盖）：

| | 他们怎么做 | 我们取不取 |
|---|---|---|
| **产品技能**（`chatcut-video-gen` 等） | **直呼工具名 + 完整调用示例**。做得到是因为技能与 MCP 服务器同一个团队、同一次发版——工具改名时两边一起改 | ❌ 取不了。我们要让技能能被别人装、也能装别人的，那个前提不成立 |
| **用户工作流技能** | 由 `chatcut-skill-creator` 代写，且 `user-invocable: false`——**用户不能自己造** | ❌ 取不了，这是垄断 |
| 那份生成器里的**规则** | 「不应该是一份**冻结的工具调用配方**」「避免记录底层工具参数……以及**会随 ChatCut 演进而变化的实现细节**」「用正常的剪辑语言，**宁可写「先剪最强的钩子」也不要写内部命令名**」「给现行工具**留出演进空间**」 | ✅ **全取**。这正是 §1.2 那条不变量，只是他们用「不让用户自己写」来保证它，我们用门岗 |

**一句话**：他们靠关门保证技能不焊工具名；我们靠门岗保证同一件事，然后把门开着。

---

## 先查别人（R27 模板四问；§2 是展开版，这里是可复核的索引）

- **依赖里已有？** 没有间接层。pi 的 `Skill` 类型无 tools/capabilities 字段（`node_modules/@earendil-works/pi-coding-agent/dist/core/skills.d.ts:3-16`），`allowed-tools` 在整个 dist 里 grep = 0；工具层 `ToolDefinition` 只有 `name/label/description`（`dist/core/extensions/types.d.ts:344-372`）；唯一宿主适配是 `formatSkillsForPrompt(skills, "read"|"bash")` 的二选一。
- **仓库里已有？** 间接层已经建好：注册表 `electron/shared/agentCapabilities/registry.ts`（`resolveCapabilityAlias`，模型面名字 → 契约 → effect），`renderLanePromptSections` 从它派生 `Available tools` / `Tool usage`（`electron/agentLane/lanePromptSections.ts:73-86`），后果句只有一份 `verbConsequence(effect, nextAction)`（`electron/shared/agentCapabilities/verbDeclaration.ts:140`）；缺的只是技能没接上（§4.2）。
- **生态里已有？** 规范正本 <https://agentskills.io/specification>（6 个键，一个字不提工具解析；`metadata` 留给客户端）；MCP 规范 <https://modelcontextprotocol.io/specification/2026-07-28/server/prompts#data-types>（Prompt 无引用工具的字段）与 Skills 扩展 <https://modelcontextprotocol.io/extensions/skills/overview>（SEP-2640，走 Resources，不含工具引用；含工具引用的 SEP-2076 已关）；逐宿主实查见 §2.6 表（pi / Codex parser.rs / Cursor / Cline / Claude Code / LangChain / A2A 等，每行带 URL 或 file:line）。
- **TikHub 自媒体里怎么说？** 未查 TikHub；社区同类痛点有正式记录：<https://github.com/fworks-tech/agenthood/issues/552>（"No way to check if required tools are available before activation"），第三方只有转译器 <https://github.com/jduncan-rva/skill-porter>，业界正解是「自然语言间接」<https://codex.danielvaughan.com/2026/05/05/agent-skills-open-standard-portable-skills-codex-cli-cross-agent/>。
- **结论：用已有（注册表）+ 不自造字段。** (a) 技能正文只写要做成的事，(b) 宿主从注册表派生工具事实（§3.1）；提交期门岗 `check:skill-tool-binding` 只管我们自己的技能，外部技能运行时由权威节纠正。

## 1. 先把事故看准：它不是"硬写工具名"，是"技能正文复述了注册表已经拥有的事实"

### 1.1 两次事故 + 一次今天才发现的

| # | 现象 | 证据 |
|---|---|---|
| 1 | 2026-09-18 真机：5 轮真模型 4 轮不调工具 | `skills/workbench-storyboard-planner/SKILL.md:203` 说「**绝不调用写画布/生成类工具**」，`:199/:200/:204` 说要调 `draft_shots`。而 `draft_shots` 正是 `generation.plan` 能力、`effect: "reversible_write"`（`electron/shared/agentCapabilities/generation.ts:87-99`）——**`:203` 字面上禁止了 `:204`**。`:203` 那句是 2026-06-13 commit `44304dd42` 为当时只读的 `propose_storyboard_plan` 写的 |
| 2 | 改工具名时忘了改技能，8 个技能 128 处指向已删的名字 | 历史事故 |
| 3 | **（今天新发现，未修）** `creation_write` / `creation_read` 写在两个技能的 frontmatter 里，**全仓源码零处实现** | `skills/workbench-creation/SKILL.md`、`skills/creation-edit/SKILL.md`；`grep -r creation_write src electron` = 0 命中。同时 `propose_storyboard_plan`（旧）与 `draft_shots`（新）两代工具名**在 88 个技能里并存** |

### 1.2 根因分层（P2）

- **症状**：模型不调工具。
- **直接原因**：两代指令叠在一份 SKILL.md 里，模型服从了过期那条。
- **类根因**：**技能正文里复述了一份「能力注册表已经拥有」的事实，而复述件不会随注册表更新。**

复述的事实有两类，工具名只是其中一类：

| 注册表已经拥有的事实 | 住在哪 | 技能正文里的复述件 | 会怎样过期 |
|---|---|---|---|
| 工具叫什么名字 | `capabilityContract.aliases.pi` | 正文里的 `` `draft_shots` `` | 改名 → 事故 #2、#3 |
| 这个工具是读还是写 | `contract.effect` / `effectClass` | 「绝不调用写画布/生成类工具」 | 工具从只读变可写 → **事故 #1** |
| 要不要用户确认 | `requiresPlanReview` / `operationPlanReview` | 「由用户确认后系统处理」 | 审批策略变了 → 未来事故 |
| 花不花钱 | `effect: "paid"` / `paidBoundary.ts` | 正文里的钱话术 | 定价边界变了 → 未来事故 |

**事故 #1 不是工具名过期，是「读/写分类」这份复述过期了。**
只把工具名抽象掉、不动其余三行，事故 #1 会原样复发。这是本调研最重要的一条，下面的方案按这个来设计。

---

## 2. 调研：规范怎么说（R5⑤，先找规范）

### 2.1 Agent Skills 开放规范 — 只有 6 个键，且**一个字都不提工具解析**

规范正本：<https://agentskills.io/specification>（跨厂商标准，非 Anthropic 独有；agentpatterns.ai 2026-08-16 复核标为 "established"，列了 Claude Code / GitHub Copilot / Google Genkit Go / Cursor / Gemini CLI 的实现）

| 字段 | 必填 | 规范原文语义 |
|---|---|---|
| `name` | 是 | ≤64 字符，小写 kebab，必须等于目录名 |
| `description` | 是 | ≤1024 字符，说清做什么 + 何时用 |
| `license` | 否 | |
| `compatibility` | 否 | ≤500 字符，环境要求 |
| `metadata` | 否 | **"a map from string keys to string values"**，供客户端存规范之外的属性 |
| `allowed-tools` | 否 | **"A space-separated string of tools that are pre-approved to run. Experimental."** |

**四条关键读数**：

1. **`allowed-tools` 是「权限预批」，不是依赖声明，也不是限制。** Claude Code 文档说得更死（<https://code.claude.com/docs/en/skills>）：
   > "It does not restrict which tools are available: every tool remains callable, and your permission settings still govern tools that are not listed."
   而且它**不可靠**：规范自己标 Experimental，"support for this field may vary between agent implementations"。
2. **规范对"技能正文该不该直呼工具名"只字未提**，对"引用的工具不存在时怎么办"也只字未提。**这是规范的空白，不是我们没读到。**
3. **`metadata` 是规范自己指定的扩展点**——"Clients can use this to store additional properties not defined by the Agent Skills spec"。我们把 `metadata.nomi` 放这里是**对的**，R5⑤ 合规（判断依据已写在 `electron/skills/skillManifestSchema.ts:16-25`，是 2026-09-07 `skill.json` 自造格式收敛时做对的那次）。
4. **但 `metadata` 只许 string→string。** 见 §2.2。

### 2.2 ⚠️ 我们的 `metadata.nomi` 在规范参考实现里会被**静默压成字符串**

官方参考库 `agentskills/agentskills` 的 `skills-ref`：

- `skills-ref/src/skills_ref/models.py:26` — `metadata: dict[str, str]`
- `skills-ref/src/skills_ref/parser.py:53` — `strictyaml.load(...)`（StrictYAML 无 schema 时一切皆字符串）
- `skills-ref/src/skills_ref/parser.py:61-62` —
  ```python
  if "metadata" in metadata and isinstance(metadata["metadata"], dict):
      metadata["metadata"] = {str(k): str(v) for k, v in metadata["metadata"].items()}
  ```

**它不报错，它把嵌套值 `str()` 掉。** 我们的 `metadata.nomi` 是个深嵌套 map（`version` / `tools[]` / `required-providers[]` / `library{}` / `stages[]`），
经过任何一个用参考实现读包的第三方宿主之后，会变成 `{"nomi": "{'version': '1.0.0', 'tools': [...], ...}"}` ——**一个 Python repr 字符串**。

即我们**扩展点选对了，值的形状选错了**。这条影响的是契约的**出站**半边（我们把技能包发给别的 agent），今天没人撞到只是因为还没人这么用（`audience: mcp` 的技能目前 0 个）。
**未证实的部分**：我是读参考实现的源码得出的，没有实跑（本机磁盘 4.5G，没装 `strictyaml` 实测）。结论强度：代码路径无歧义，但**建议实施前实跑一次确认**。

### 2.3 MCP 规范：**没有间接层，而且刚刚明确否掉了带工具引用的那版提案**

当前 spec 版本 `2026-07-28`（另有 draft）。

1. **三原语**：Resources（app-controlled 数据）、Prompts（user-controlled 模板）、Tools（模型调的函数）。**Prompts 不是可移植技能包的官方位置**——`Prompt` 数据类型只有 `name/title/description/icons/arguments`，**没有任何引用工具的字段**，只能把工具名写进 message 文本里，即硬写。（<https://modelcontextprotocol.io/specification/2026-07-28/server/prompts#data-types>）
2. **Capability negotiation 是粗粒度的**：`2026-07-28` 起取消 initialize 握手改为每请求带版本；capabilities 是 `{tools:{}, prompts:{listChanged}, resources:{}, extensions:{...}}` —— **server 级功能开关 + 扩展 ID，不存在按单个语义能力名协商**。
3. **零别名机制**。draft `schema.ts` 实测计数：`alias` 0、`namespac` 0、`well-known` 0、`skill` 0。`ToolAnnotations` 只有 `title/readOnlyHint/destructiveHint/idempotentHint`（UI/安全提示）；`_meta` 是自由键值、无解析语义。最接近的 [SEP-1626 LFID](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1626)（语义代号→内部 ID）已 **dormant/关闭**；[SEP-986](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/986) 只定名字字符集（≤64、允许 `/` `.` 做命名空间），**不定语义**。
4. **社区在讨论，但明确不在范围内**。[Skills over MCP 工作组](https://modelcontextprotocol.io/community/working-groups/skills-over-mcp) 2026-02 成立、04-16 转正式。[04-21 纪要 #2628](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/2628) 争的是「工具 schema 该不该等技能激活才暴露」（tool bloat），**完全没讨论工具名绑定 / 语义能力名 / 跨宿主可移植**。按 `skill+required+tools+dependencies` 搜该仓 open issue：**0 条**。
5. **官方 Skills 集成 5 天前刚合，而且是「刻意不碰工具引用」的那版**：
   - [SEP-2640 Skills Extension](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2640) **2026-09-13 merged** → <https://modelcontextprotocol.io/extensions/skills/overview>。走 Resources 复用：`skill://` URI + `skills/list` + `skills/get` + `resources/read`，带 SHA-256 manifest 校验。
   - **被它取代的 [SEP-2076](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2076)——把 skill 做成一等原语、定义里明确含 "references to tools, prompts, and resources"——已 CLOSED。**

> **这条是整份调研的分水岭**：标准组织**看过**"技能引用工具"这个问题，**选择了不标准化它**。留下的那版只解决「技能怎么传输和校验」，对「技能怎么引用工具」一个字不提，只在安全节提了一句 `allowed-tools` 需用户逐技能批准。
> 所以 (b) 不是"还没人做"，是**标准层刚刚判定它不该由标准层做**。我们要么自己做（只在自己宿主内有效），要么不做。

### 2.4 社区：痛点真实存在，方案只有「转译」和「自然语言间接」

- **痛点有人正式提过**：[agenthood #552](https://github.com/fworks-tech/agenthood/issues/552)（open，标 P1 Cross-Client Compatibility）原文 —— "Skills may require specific tools… No way to check if required tools are available before activation"。**和我们事故 #3 是同一个洞。**
- 中文社区（TikHub 可用，两轮小红书搜索 38 条命中）："同一个 Skill 换个 AI，有时能跑，有时连名字都识别不到"；"MCP 工具和 Skill 各管各的：工具(JSON-RPC)和 Skill(SKILL.md)分属两套生态"。
- **第三方方案只有双向转译，不是间接层**：[skill-porter](https://github.com/jduncan-rva/skill-porter)（191★，Claude Code ↔ Gemini CLI 互转）；[Skilldex 论文 2604.16911](https://arxiv.org/html/2604.16911v1) 是包管理 + 格式评分，实读后确认**不碰工具名抽象**。
- **业界给的正解是「自然语言间接」**：[Codex 跨 agent 技能指南](https://codex.danielvaughan.com/2026/05/05/agent-skills-open-standard-portable-skills-codex-cli-cross-agent/) —— 写「run the test suite」而不是写死某个 agent 的命令。**这就是 (a)。**

### 2.5 ⚠️ 极性陷阱：跨宿主时 `allowed-tools` 的语义会**反转**

- Claude Code：`allowed-tools` 是**白名单 / 权限预批**。
- Gemini CLI：用 `excludeTools`，是**黑名单**。

**即使工具名全对得上，原样搬过去安全含义整个反转**（"只准用这些" 变成 "只禁这些"）。
推论：任何间接层**不能只做名字映射，必须带「极性 / 权限模型」这一维**。我们的 `CapabilityContract` 恰好已经有这一维（`effect` / `effectClass` / `requiresPlanReview`），这是运气也是验证。

---

### 2.6 逐个宿主实查：`allowed-tools` 是一个**没人解析、没人校验、现实中没人写**的字段

**本机一手普查（256 个真实安装的技能）**：`~/.claude/skills` 61 个、`~/.codex/skills` 82 个、`~/.agents/skills` 113 个 —— **`allowed-tools` 出现 0 次**。规范里唯一的工具字段，现实中无人使用。正文直呼宿主工具名的只有 5/113（4%），且都只是散文提一嘴。

| 宿主 | 技能怎么声明工具 | 档 | 证据 |
|---|---|---|---|
| **pi** `@earendil-works/pi-coding-agent@0.85.1`（本机 `node_modules` 核过） | `Skill` 类型**没有任何 tools/capabilities 字段**（`dist/core/skills.d.ts:9-16`）；`SkillFrontmatter` 只解析 3 个键 + `[key:string]: unknown`。**`allowed-tools` 在整个 dist 里 grep = 0** —— pi 文档列了这个字段却**根本不解析它** | (a) | `node_modules/@earendil-works/pi-coding-agent/dist/core/skills.d.ts:3-16`；<https://pi.dev/docs/latest/skills> |
| pi 的工具层 | `ToolDefinition` 只有 `name`/`label`/`description`，**无 capability/alias 字段**（`dist/core/extensions/types.d.ts:344-372`）；`defineTool` 只是类型透传。`AgentSession._toolRegistry` 是私有 name→tool 表。唯一的宿主适配是 `formatSkillsForPrompt(skills, fileReadTool?: "read"｜"bash")` —— **二选一的硬编码降级，不是别名层** | — | 同上 `:386`、`agent-session.d.ts:238` |
| pi 的移植做法 | **技能自带实现**：把别家目录加进 settings（`"skills": ["~/.claude/skills","~/.codex/skills"]`），技能本身自带 CLI/脚本用 bash 调自己的 `./search.js`，**不调宿主工具** | (a)+自带脚本 | <https://github.com/badlogic/pi-skills> |
| Codex CLI 0.154.0 | Rust parser 只反序列化 `name`/`description`/`metadata.short-description`，**`allowed-tools` 静默丢弃** | (a) | [parser.rs](https://github.com/openai/codex/blob/main/codex-rs/skills/src/parser.rs) |
| Codex `AGENTS.md` | 纯散文，无工具词表、无校验 | (a) | <https://agents.md> |
| Cursor rules (MDC) / Cursor skills ≥2.4 | frontmatter 仅 `description`/`globs`/`alwaysApply`（rules）；skills **不支持 `allowed-tools`**，带了也被忽略 | (a) | [rules](https://cursor.com/docs/context/rules) · [skills](https://cursor.com/docs/skills) |
| Windsurf workflows / Aider conventions / OpenHands skills | 无工具 schema | (a) | [windsurf](https://docs.devin.ai/desktop/cascade/workflows) · [aider](https://aider.chat/docs/usage/conventions.html) · [openhands](https://docs.openhands.dev/overview/skills/creating) |
| **Cline workflows** | 散文里**直呼内部工具名**（`read_file` 等），无声明字段、无校验 | **(c) 无校验版** | [docs.cline.bot](https://docs.cline.bot/core-workflows/using-commands) |
| Claude Code | 字面工具名 + 权限匹配，文档明说是**预批准不是限制** | (c) 上限 | <https://code.claude.com/docs/en/skills> |
| LangChain 1.x / CrewAI / Semantic Kernel→MAF / Vercel AI SDK / smolagents / OpenAI Agents SDK | 一律 assembly 期绑**字面对象/名字**；SK planner 已删除 | (c)+(a) | [langchain](https://docs.langchain.com/oss/python/langchain/tools) · [crewai](https://docs.crewai.com/en/concepts/tools) · [MAF](https://learn.microsoft.com/en-us/agent-framework/migration-guide/from-semantic-kernel/) |
| AutoGen `Workbench` / Google ADK `BaseToolset` / Letta registry | 换**工具来源**（provider 级），名字仍是字面量 | (d) | [workbench](https://microsoft.github.io/autogen/stable//user-guide/core-user-guide/components/workbench.html) · [ADK](https://google.github.io/adk-docs/tools-custom/) |
| **A2A v1.0 `AgentCard.skills` / AGNTCY OASF** | **有真的语义能力名**（`AgentSkill.id`、`nlp.summarization.abstractive` 点分类目），但在 **agent 粒度**，用于发现/路由，**从不解析到工具**——交给对方的仍是散文，工具由对方自己挑 | (b) 但只到 agent 发现层 | [a2a](https://a2a-protocol.org/latest/specification/) · [OASF](https://docs.agntcy.org/oasf/open-agentic-schema-framework/) |

**三条读数**：

1. **连 (c) 都算抬举——没有任何一家做校验。** Codex 静默丢弃、Cursor 压根不实现、pi 不解析、`skills-ref` 把它当不透明字符串。**技能声明一个不存在的工具，在所有测试过的宿主上一律静默失败：无 warning、无 error、无 fallback。**（= 我们事故 #3 的形态，是全行业默认形态）
2. **现实中的降级机制是技能作者写的一句人话。** 例：`~/.agents/skills/chatcut-widget-forms/SKILL.md` 写「If `show_widget` is genuinely unavailable, ask concisely in ordinary chat.」——**这就是今天可移植性的全部实现。**
3. **生态在主动后退，不是还没走到。** smolagents 删掉了唯一能用的能力名解析（`load_tool("image-question-answering")` → 默认实现），v1.26.0 起只收 Hub repo id；MCP 两次拒绝分类学（[SEP-1300 groups/tags 被 closed/rejected](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1300)、SEP-2076 被取代）。
4. **`allowed-tools` 表达力不够，连"我需要一个能跑 shell 的东西"都说不了。** 它是权限预批准，不是需求声明；**所有被调研的格式里没有任何字段能表达需求。**

---

## 3. (a)/(b)/(c)/(d) 对比表

| | (a) 只描述要做成什么，不提工具 | (b) 声明语义能力名，宿主解析 | (c) 直写工具名 + 装配期校验/改名映射 | (d) 双向转译（把包翻译成目标宿主的方言） |
|---|---|---|---|---|
| **谁在用（证据）** | **主流**。Agent Skills 规范默认姿势（正文无工具字段）；[Codex 跨 agent 指南](https://codex.danielvaughan.com/2026/05/05/agent-skills-open-standard-portable-skills-codex-cli-cross-agent/) 明确推荐；Microsoft Agent Framework 的 Agent Skills（<https://learn.microsoft.com/en-us/agent-framework/agents/skills>，2026-09-16）除 `allowed-tools` 外无任何绑定 | **产品侧零先例**（两路独立调研互证）：查遍 9 个 coding agent、开放规范及其参考校验器、11 个框架协议，**没有任何一家**允许技能写 `web.search` 而由宿主解析到自家工具。MCP 的 SEP-2076（含工具引用）被 CLOSED、SEP-1626 LFID dormant、SEP-1300 被 rejected。唯一存在的语义能力名（A2A skill id、OASF）都停在 **agent 发现层**。模型侧有对等物（LangChain `init_chat_model("provider:model")`、Vercel provider registry），**工具侧没人建**。最接近的是 NimbleBrain Synapse "portable-app contract"（PR #50，2026-09，`hostSupports()` + `HostCapabilityError`）——**一个组织的内部约定，且管的是 host-app 桥不是 skill→tool**。**Nomi 自己已建（见 §4）** | 事实上的现状：`allowed-tools`（Experimental、各家支持不一、极性还会反转）。**没有任何宿主在装配期校验它** | [skill-porter](https://github.com/jduncan-rva/skill-porter)（191★） |
| **用户看到什么** | 技能"就是能用"，跨宿主无感；但模型选错工具时没人拦 | 技能声明缺了什么，宿主能**在激活前**列出「缺这几项能力，去接一下」 | 装得进来、跑起来才炸，报错还是"模型不调工具"这种查不出的形态 | 装之前要先跑一次转换，多一步 |
| **代价落在谁身上** | **落在技能作者**：得把意图写清楚，不能靠工具名偷懒。模型选错的风险落在宿主工具描述质量上 | **落在宿主**：得维护注册表、别名表、解析器、门岗。**外部技能作者还得学我们的能力名**——这是 D1 违规面（让用户学我们的格式） | **落在所有人**：作者以为写了就有用，宿主不校验，用户承担静默失败 | 落在转译器维护者，且每加一个宿主是 N² |
| **防得住事故 #1（读/写分类过期）吗** | **防不住**——正文照样能写"绝不调用写工具"这种自然语言分类 | **防得住**——分类由 `contract.effect` 派生注入，注册表是唯一真相源 | 防不住 | 防不住 |
| **防得住事故 #2/#3（名字过期/悬空）吗** | **防得住**（压根不提名字） | **防得住**（`skillRequestedCapabilitySchema` 已经会拒未知 id） | 只有加了门岗才防得住 | 防不住 |

### 3.1 推荐：**(a) 为对外契约，(b) 为对内派生 —— 两者不是二选一，是分工**

**理由（按 D2 结构约束推，不按功能列推）：**

1. **对外必须是 (a)，因为标准层刚判定 (b) 不归标准管（§2.3.5）。** 我们要是让外部技能作者写 `nomi` 的能力名，就是在自造一个只有 Nomi 认的方言——和 2026-09-07 `skill.json` 那次前科同构，且踩 D1（让用户学我们的格式）。**外部装进来的技能包，正文不提任何工具名，也不提我们的能力名。**
2. **对内必须是 (b)，因为 (a) 防不住事故 #1。** 用户这次真正被坑的是"读/写分类"这份复述，不是名字。(a) 把名字问题解决了，分类问题原样留着。而 (b) 的价值恰恰在**把那四行事实从散文变成派生**。
3. **接法是「(b) 派生出 (a)」**：技能在 `metadata.nomi.requested-capabilities` 里声明**能力 id**（机器读，可选，外部包不写就不写）；装配时宿主用注册表**渲染**出一段工具说明（名字 + 读/写 + 要不要确认 + 花不花钱）注入上下文；**技能正文一律只写意图**。
   - 外部技能不声明 → 退化成纯 (a)，照样能跑，宿主用自己的工具描述兜。**没有 (b) 就跑不了的技能，我们不做。**
   - 内部技能声明了 → 多拿一层门岗保护和"缺能力"提示。
4. **不选 (c)**：`allowed-tools` 实验性 + 极性反转（§2.5），把它当依赖声明用是把宝押在一个各家语义不一致的字段上。
5. **不选 (d)**：N² 成本，且防不住任何一次我们的事故。

---

## 4. 我们离它有多远：**间接层已经建好了，只是技能没接上**

### 4.1 已有的（好消息，比预期近得多）

| 东西 | 位置 | 状态 |
|---|---|---|
| 能力注册表（33 个契约） | `electron/shared/agentCapabilities/registry.ts:37-62` | ✅ 已有 |
| 契约形状：id + version + **四 surface 别名** + 读写分类 + 审批要求 | `electron/shared/agentCapabilities/capabilityContract.ts:14-56` | ✅ 已有，且**恰好带了 §2.5 要求的极性维度** |
| 具体例子：`canvas.write` → `pi: arrange_canvas` / `mcp: nomi_canvas_edit` / `ui: nomi_canvas_plan` | `electron/shared/agentCapabilities/canvasWrite.ts:605-617` | ✅ 已有 |
| 别名 → 契约解析器 | `registry.ts` `resolveCapabilityAlias()` / `capabilityContractById()` | ✅ 已有 |
| 技能可以声明能力 id，**且会拒绝未知 id** | `electron/skills/skillManifestSchema.ts:40-43, 131-133` | ✅ 已有 |
| 「运行时授权只从 requested-capabilities 派生」这条已经是白纸黑字 | `electron/skills/skillManifestSchema.ts:134` | ✅ 已有 |
| 「缺能力 ≠ 报错，产出一张缺什么清单给 UI」 | `electron/skills/skillCapability.ts:1-6` | ✅ 设计已定 |

### 4.2 缺的（这就是全部工作量）

| # | 缺什么 | 证据 |
|---|---|---|
| G1 | **0/88 技能用 `requested-capabilities`**；88/88 带自由文本 `tools` 键（9 个有条目、79 个是空的 `tools: []`）。而 `docs/skill-pack-format.md:70,96` 把 `tools` 标成**必填**、`:84` 又自认它「**不授权任何东西**」——格式**强制**了危险字段，把安全字段设成可选 | `grep -l "requested-capabilities" skills/*/SKILL.md` = 0；`docs/skill-pack-format.md:70,84,96` |
| G2 | **`tools` 字段压根不校验**：`z.array(z.string().min(1))`，注释已自认"**无运行时工具授权作用**" | `electron/skills/skillManifestSchema.ts:135` + `:69-70`（`@deprecated`） |
| G3 | **技能→工具方向没有门岗**。注意：宿主侧**已有** `no-orphan-alias`（`scripts/check-tool-face.ts:46`，hard 档，「契约的 pi 别名必须是已声明动词名」）——但它守的是「契约↔动词」，**管不到「技能↔工具」**。`check-skills-format.mjs` 则只校验顶层 frontmatter 键集合 | `scripts/check-tool-face.ts:40-50`；`scripts/skills-format-lib.mjs:26-38` |
| G4 | **外部技能导入零校验**：`validateSkillPackage` 只查版本/目录名/文件路径/SKILL.md 存在/身份，**不查工具或能力** | `electron/skills/skillPackage.ts:133-159` |
| G5 | **正文复述读/写分类、审批、花钱**——没有任何机制让它跟注册表一致 | `skills/workbench-storyboard-planner/SKILL.md:203`（事故 #1 本体） |
| G6 | **`metadata.nomi` 嵌套结构违反规范的 string→string**（§2.2） | `skills-ref` `models.py:26`、`parser.py:61-62` |

**一句话**：`requested-capabilities` 这条正路已经修好了，**没有一辆车开上去**；同时旁边那条 `tools` 土路没设卡，88 辆车全在上面跑。

---

## 5. 「规范链接 / 我们的偏差 / 偏差理由」（R5⑤ 三列表）

| # | 规范链接 | 我们的偏差 | 偏差理由（只许领域约束） |
|---|---|---|---|
| 1 | [spec `metadata`](https://agentskills.io/specification)：客户端自定义属性扩展点 | 用 `metadata.nomi.*` 放 Nomi 独有字段 | ✅ **无偏差**——这正是规范指定的扩展点，顶层键是闭集。判据已在 `skillManifestSchema.ts:16-25` |
| 2 | [spec `metadata`](https://agentskills.io/specification)：**"a map from string keys to string values"**；参考实现 `parser.py:61-62` 静默 `str()` 化 | 我们的 `metadata.nomi` 是**深嵌套 map + 数组** | ❌ **真偏差，需处置**。领域约束（技能需要声明结构化的能力清单/阶段）真实存在，但规范的答复是"用 bundled reference 文件，别塞 frontmatter"。**建议：`metadata.nomi` 收敛成扁平 string 值（如 `nomi-capabilities: "canvas.write generation.plan"`），结构化部分挪进技能目录内的 reference 文件。**见 §6 P2 |
| 3 | [spec `allowed-tools`](https://agentskills.io/specification#allowed-tools-field)：空格分隔、pre-approved、Experimental | 我们**不用**它承载依赖，另用 `requested-capabilities` | ✅ **有偏差但站得住**：规范自己标 Experimental + 各家语义不一（§2.5 极性反转），把依赖声明押在它上面不安全。我们的字段挂在合法扩展点、外部宿主原样忽略、不影响可移植性 |
| 4 | [MCP Skills Extension SEP-2640](https://modelcontextprotocol.io/extensions/skills/overview)（2026-09-13 merged）：`skill://` + `skills/list` + `skills/get` + SHA-256 | 我们自己的技能分发/校验（`skillPackage.ts` 内容哈希） | ⚠️ **待裁决**：5 天前才合入的标准，我们的方案与之**同构但不同名**。R5⑤ 要求对齐官方标准——**建议单开一轮，评估把技能分发切到 `skill://` 扩展上**。本份不做结论 |
| 6 | [spec](https://agentskills.io/specification) 顶层键是**闭集**（参考校验器 `validator.py:104-115` 多一个键即 error） | 我们额外允许顶层 `disable-model-invocation`（40/88 技能在用） | ✅ **有偏差且理由已落纸**（`scripts/skills-format-lib.mjs:17-21`）：pi（`dist/core/skills.js:262`）与 Claude Code 都原生支持它，挪走反而让那两家读不到。**但注意**：agentpatterns.ai 正是拿这个字段举例说「skill 依赖这类扩展会*静默*失去可移植性——文件照样加载，行为被忽略，没有任何报错」。理由成立，风险需登记 |
| 5 | 规范对「技能怎么引用工具」**无规定**（SEP-2076 含工具引用的那版被 CLOSED） | 我们做 `requested-capabilities` 能力 id + 宿主解析 | ✅ **合法的空白填充，但必须是可选的**：规范没有扩展点可挂 → 只能挂 `metadata`；**外部技能不写它也必须能跑**，否则就是自造必填方言（前科：`skill.json`） |

---

## 6. 迁移代价与顺序

**原则**：先止血（拦住新的），再统一（改存量），最后才谈标准对齐。每一阶段都能独立交付、独立回滚。

### P1（第一阶段，建议只做这个）— 止血：把注册表变成唯一真相源，加门岗

只做三件，**不动 88 个技能的正文**：

1. **修事故 #1 本体**：删 `skills/workbench-storyboard-planner/SKILL.md:203`。它已经和 `:199/:200/:204` 直接矛盾，且它描述的是 `propose_storyboard_plan` 时代的事实。（P1 加新必删旧——2026-06-13 加 `draft_shots` 时就该删的那一行）
2. **修事故 #3**：`creation_write` / `creation_read` 两个悬空名，要么实现要么从两个 SKILL.md 摘掉。
3. **加门岗 `check:skill-tool-binding`**（R17：能让门岗拦的别留给人），三条判据，棘轮基线只减不增：
   - **(i) 悬空名**：技能 frontmatter / 正文里出现的每个工具名，必须能被 `resolveCapabilityAlias()` 解析到。解析不到 = 红。**这一条直接拦住事故 #2 和 #3。**
   - **(ii) 读/写分类不许在正文里写散文**：正文里出现「绝不调用写…类工具 / 只读 / 不落画布 / 由用户确认」这一族措辞时，要求它与该技能 `requested-capabilities` 的 `contract.effect` 一致；不一致 = 红。**这一条直接拦住事故 #1。**
   - **(iii) 加规则先验它会红**（R17）：门岗写完先在 `SKILL.md:203` 的原始状态上跑一次，**必须红**；不红说明判据没接住。
   - **形状照抄已有的 F6「让别人判」**：`scripts/skills-format-lib.mjs` 的 F6 判据不是自己写解析器，而是**直接调 pi 自带的加载器扫一遍 `skills/`，要求一个不少、零 diagnostics**——2026-09-07 就是这条抓到「我们的正则解析器比别人宽松，所以看不见问题」。新门岗的悬空名判据应同样**用注册表自己的 `resolveCapabilityAlias()` 判，不另写一份名单**（R14.1：同一语义一个 owner）。
4. **`validateSkillPackage` 补一条导入期检查**（`skillPackage.ts:133`）：外部技能包引用了我们没有的能力 → **不拒收**，产出一张「缺这几项」清单交给 UI（这是 `skillCapability.ts:1-6` 已定的设计：缺能力 ≠ 报错）。**这条正面回答用户的原问题。**

> P1 不需要任何技能作者改写法，也不需要外部技能作者学任何东西。**它把"静默失败"变成"装配期红"，代价全落在我们身上，一个都不落在用户身上（D1）。**

### P2（第二阶段）— 接上间接层 + 修规范偏差

5. 88 个技能 `metadata.nomi.tools` → `requested-capabilities`（能力 id），`tools` 字段正式退役（它已经 `@deprecated` 且无运行时作用，是纯删除）。
6. 装配时由注册表**渲染**工具说明注入上下文（名字 + 读/写 + 审批 + 花钱），技能正文**只留意图**。这一步做完，§1.2 表里那四行复述全部变成派生。
7. 处置 §5 偏差 #2：`metadata.nomi` 扁平化成 string 值，结构化部分挪进技能目录内 reference 文件。**先实跑一次 `skills-ref` 确认 §2.2 的读数**再动手。

### P3（第三阶段，需另开一轮）— 标准对齐

8. 评估 MCP Skills Extension（SEP-2640，5 天前 merged）：把技能分发切到 `skill://` + `skills/list` + `skills/get`。**R5⑤ 要求对齐官方标准，但这份标准太新，需要单独一轮调研 + 拍板，不要挂在本方案上。**

### 明确不做

- ❌ **不要求外部技能声明我们的能力名。** 不写照样跑。
- ❌ **不做 (d) 双向转译。** N² 成本，防不住任何一次我们的事故。
- ❌ **不把依赖声明押在 `allowed-tools` 上。** Experimental + 极性反转。

---

## 7. 用户和我都没想到的那一条

**用户的洞察是对的，但比他想的还要深一层：技能正文里"硬写"的从来不只是工具名。**

用户问的是「skill 不知道我们的工具名」。但把事故 #1 拆开看——它**不是**名字对不上（`draft_shots` 名字完全正确、工具也存在），
而是**技能用散文复述了「这个工具是读还是写」这份分类，而分类变了**。

所以：
- 如果只做用户设想的「工具名 → 语义能力名」映射，**事故 #1 会原样复发**——把 `draft_shots` 换成 `generation.plan`，`:203` 那句"绝不调用写画布/生成类工具"照样在那儿，照样和它矛盾。
- 真正的不变量是：**凡是能力注册表已经拥有的事实，技能正文一律不许复述，只许由宿主派生注入。** 工具名只是四类事实里的一类（另三类：读/写分类、审批要求、花钱边界）。

**第二条：我们已经有这个间接层了，而且可能是全场唯一一个真做到工具粒度的。**
（`canvas.write` → pi `arrange_canvas` / MCP `nomi_canvas_edit` / UI `nomi_canvas_plan`；`asset.read` → pi `look_at_media` / MCP `nomi_media_query`，`assetRead.ts:203`）
连 §2.5 那个跨宿主极性维度都恰好带上了。**但技能层没接上去，所以 0/88 用它，今天还躺着两个悬空工具名没人发现。**
这印证了 `docs/lessons/research-must-become-enforceable-constraints.md`：**调研结论不变成能拦人的约束，就等于没做。**
本方案 P1 的重心因此不是「设计间接层」（已有），而是**给它装门岗**。

**第三条：用户那句「要不然这些 skill 给到 coding agent 他们怎么搞得」——答案是「他们也没搞定，他们靠人话」。**
本机 256 个真实安装的技能里，规范唯一的工具字段 `allowed-tools` **出现 0 次**；pi 文档列了这个字段却根本不解析它；Codex 的 Rust parser 静默丢弃它。
全行业今天的降级机制就是技能作者在正文里写一句人话——例：「If `show_widget` is genuinely unavailable, ask concisely in ordinary chat.」
**所以用户的直觉「这个应该是可以的吧」，在"别人已经做好了"这个意义上是错的（没人做），在"这件事该做"这个意义上是对的（而且我们已经做了一半）。**
诚实交付（D4）：我们不能说「照抄业界」，只能说「业界没有，我们自己有半套，把它接完」。

---

## 7.5 第一阶段实施后补记（2026-09-18）

### 7.5.1 最硬的那条证据：漂移**早就发生了，而且连漏都没漏——是压根没人去查**

写门岗时它扫出 6 处手查漏掉的复述。其中两条不是「将来会过期」，是**当时就已经是假的**：

> `skills/brand-promo/SKILL.md` 与 `skills/drama-short/SKILL.md`：「用 `draft_shots` 一次产出整份分镜方案……**不碰画布**、不花额度。」
>
> 而 `draft_shots` 这个动词自己的描述是：**"Create or update draft shots on the canvas."**（`electron/shared/agentCapabilities/verbs/writeVerbs.ts:112`）

两句话直接矛盾，而且**矛盾已经存在了一段时间，没有任何人或机器发现**。

这比「手查覆盖率只有 2/3」更硬一档，两者不是一回事：

| | 说明 | 意味着什么 |
|---|---|---|
| 手查漏掉 6 处中的 4 处 | 人去查了，查漏了 | 人的**召回率**不够 → 需要机器补 |
| 「不碰画布」躺着为假 | **没有任何流程要求任何人去查这件事** | 不是召回率问题，是**这条边上一个检查点都没有** → 文档形态的规则在这里等于零 |

第二种情况写多少遍「不要在正文复述工具性质」都不会被发现，因为**没有人会去读那份规则再回头逐条核技能**。
这就是 `docs/lessons/research-must-become-enforceable-constraints.md` 那条教训的最纯形态：
**规则不变成会红的门岗，它的执行次数是 0，不是「偶尔漏」。**

### 7.5.2 权威节的位置是**暂定**，不是结论

`SKILL_TOOL_AUTHORITY_PLACEMENT`（`electron/harness/context/agentContext.ts`）当前取 `after_body`，
理由是 recency——2026-09-18 事故正是正文压过了真相。**但这是假设，不是数据。**

另有一路三臂 A/B 在真模型上量它：臂 0 `omitted`（阳性对照，量「没有它会坏成什么样」）、
臂 A `before_body`、臂 B `after_body`。另带一个维度：**同一回合连调 8 次以上时模型是否还听它**
（回合上限 24 次请求，系统提示词全程不变，但工具结果一条条堆进消息列表，
**第 1 次听话不代表第 12 次还听话**——这一维我原方案没想到）。

实现上位置是**一个参数**而不是写死顺序，三个臂都从那一个常量可达，数据回来改一行即可切换；
`agentContext.test.ts` 有一条测试钉住「三臂可达且彼此只差这一节」。

### 7.5.3 欠账登记（R17：登记是带到期日的承诺，不是防线）

| 欠账 | `check:skill-tool-binding` 的效果断言只认**中文**措辞（`EFFECT_CLAIM_PATTERNS`）。英文或中文的别种说法写在我们自己的技能里，门岗看不见。 |
|---|---|
| **到期日** | **2026-12-18**（三个月）。到期未做 = 门岗判据降级为不完整，必须在当期 PR 里处置，不许再顺延。 |
| **到期前用什么替代** | 运行时权威节（`SKILL_TOOL_AUTHORITY_SECTION`）。它**不依赖任何措辞识别**——不管技能用什么语言、什么说法描述工具，它都一律作废那些说法。所以这条欠账的风险面只是「我们自己仓库里一句英文复述能提交进来」，**不是「模型会被它骗到」**：那一层由运行时兜住，且外部技能本来就走这条路。 |
| **到期时怎么验它真能认英文** | 按已有的阳性对照机制加三条：把现有三条阳性对照（`check-skill-tool-binding.node-test.mjs`）的事故文本**逐句译成英文**再断言必红；然后做一次变异——把 `skills/` 里任一条复述改写成英文提交，门岗必须 `exit=1`。**不验红不算数**，与这次 M1–M3 同一把尺子。 |
| **为什么不现在就做** | 今天 88 个技能全是中文，英文判据一条真实样本都没有——没有样本的判据没法验它会不会红，那就是 R17 明令不许的「加了规则但没验过它会红」。到期日的意义是：**英文技能一旦出现，这条就必须落地，而不是等谁想起来。** |

---

## 8. 未证实 / 需复核

- §2.2 的 `metadata` 静默 `str()` 化：**读源码得出，未实跑**（本机磁盘 4.5G，未装 `strictyaml`）。代码路径无歧义，但 P2 动手前应实跑确认。
- §5 偏差 #4（MCP Skills Extension 对齐）：标准 2026-09-13 才 merged，**本份不做结论**，需单开一轮。
- §2.6 的 pi / Codex / Cursor 等逐个现状由第二路调研独立完成（读 `node_modules` 内 `.d.ts` 一手核实 + 官方文档），与本份第一路调研**互证无冲突**。
- §2.6 「本机 256 个技能 `allowed-tools` 出现 0 次」是一次 frontmatter 字段普查，**范围仅限本机已装技能**，不代表全生态分布。
- `docs/skill-pack-format.md` 需随 P1/P2 同步改（它现在把 `tools` 写成必填），本份未改它。
