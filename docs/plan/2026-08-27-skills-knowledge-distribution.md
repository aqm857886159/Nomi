# Skills 知识分发系统 —— 对齐标准 · 渐进披露接给内部

> **状态**：Phase 0 已交付（导入格式对齐，PR 待开）；Phase 1-3 待执行。
> **缘起**：用户群反馈「正常用 hermes 或 workbuddy 都是导入一个 zip 包就行，包里有 skill.md 就行了 / 现在都导入技能都必须是 json 格式」。挖下去发现这不是一个导入 bug，是**整条知识分发链**都只认我们自造的那套。
> **上位方案**：`docs/superpowers/plans/2026-08-24-unified-agent-master-plan.md` §2.9「SKILL.md 渐进披露」。本文把那一行展开成可执行的。

## 0. 一句话

**我们的 SKILL.md 本来就是标准格式，但外面进不来、里面用不到。**

- 进不来：导入只认自造的 `.nomiskill.json` 信封（Phase 0 已修）
- 用不到：31 本技能里绝大多数**永远不会被调用**，因为内嵌 agent 发现不了它们

## 1. 实测数据（2026-08-27）

| 项 | 数 | 出处 |
|---|---|---|
| 内置技能 | **31** 本 | `skills/*/SKILL.md` |
| 带 `skill.json` manifest 的 | **7** 本 | 其余 24 本只有 frontmatter |
| SKILL.md 体量 | 中位 3,696 / 最大 8,774 字符 | 全文注入 system prompt |
| 内嵌 agent 每轮固定开销 | ≈ 19,860 字符 ≈ **9,000 tokens** | 身份 545 + 画布专长 2,181 + 工具 13,438 + skill 全文 3,696 |
| 历史预算 | 24,000 tokens | `AGENT_HISTORY_TOKEN_BUDGET` |

**关键：固定开销不参与任何预算。** `capAgentHistory` 只砍历史，那 9,000 tokens 一分省不下来。用户 BYO 一个小模型进来就被压死，而我们连察觉都不会察觉。

## 2. 三个病灶

### 2.1 进不来（Phase 0，已修）

根因三层，一层比一层硬（`electron/skills/skillPackage.ts`）：

1. 只吃 `{version, exportedAt, dirName, files}` 自造信封 → 别人的技能一律进不来
2. `files` 值必须是字符串 → 二进制带不进来
3. `isSafeSkillFileName` 的 `name !== path.basename(name)` = **完全不允许子目录**，且只准 `.md/.json/.txt` → Agent Skills 规范的 `scripts/` `references/` `assets/` 一个都进不来

而我们自己的 `SKILL.md` 本来就是标准格式：

```yaml
---
name: director.cinematography
description: 镜头语言与摄影技法方法论——…
---
```

`name` + `description` 正是 [Agent Skills 规范](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)的两个必填字段，一字不差。**文件是对的，只是被自造信封包住了。**

按 **R20**：技能打包不是 Nomi 独有问题、不在护城河上、且碰用户信任（导入别人的东西）→ **对齐标准，不自造**。

### 2.2 用不到（Phase 1，本文核心）

内嵌 agent 拿 skill 的方式（`electron/ai/agentChatV2.ts:81`）：

```
readRequestedSkill(payload) → findSkillRecord → 整本 skill.body 塞进 system prompt
```

两个后果：

- **必须由 UI 显式指定 skillKey** —— agent 自己发现不了、中途也换不了。用户说「按大友克洋的风格拆镜」，agent 拿不到 `director-style-otomo-wright` 那本，因为 UI 没挂
- **全文注入** —— 用不到也付上下文

**讽刺的是：渐进披露我们已经做了，但只给了外部。** `electron/capabilityCore/mcpProtocol.ts:657` 的注释原文：

> `skills.list` 只返元数据（name+描述，不含正文）；`skills.read` 才载正文——**客户端只为用到的技能付上下文**。

外部 agent（Claude Code / Codex 经 MCP）能挑着用我们 31 本技能；我们自己的 agent 只能被动吃 UI 塞的那一本。

**所以 Phase 1 不是新建，是接线。**

### 2.3 三处内外不一致（2026-08-27 追加 · 用户追问「我们这边调用的 Skill 和那边加载的，一致吗」）

**先说好消息**：两边都走 `readSkillRecords()` 读同一个磁盘目录，`findSkillRecord` 共用。**技能内容确实只有一份。**

坏消息有三处：

#### ① 可见范围三套口径，同样 31 本技能

| 谁 | 过滤规则 | 位置 | 能看到 |
|---|---|---|---|
| MCP（外部 agent） | `isCraftSkill` = `director-` / `writer-` **目录名前缀** | `skillStore.ts:149` | **23 本** |
| 技能库面板（用户浏览） | `origin==='user' \|\| manifest.stages.length>0` | `skillIpc.ts:35` | 用户导入的 ∪ 带 stages 的内置 |
| 内嵌 agent | `findSkillRecord` —— **无任何过滤** | `agentChatV2.ts:81` | **全部 31 本** |

外部 agent **永远看不到**这 8 本：`brand-promo` `drama-short` `creation-edit` `skill-author` `workbench-creation` `workbench-fixation-planner` `workbench-generation` `workbench-storyboard-planner`。

其中 `brand-promo`（品牌宣传片）和 `drama-short`（短剧）**正是 master plan 里 Workflow Pack 的第一条** —— 外部 agent 调不到。

**且 `isCraftSkill` 用目录名前缀判可见性是隐式规则**：用户导入一本叫 `director-xxx` 的技能，会**自动对外暴露给 Claude Code**，用户不知情。这是安全边界靠命名约定，不可接受。

#### ② 加载机制两套

| | MCP（外部） | 内嵌 agent |
|---|---|---|
| 发现 | `skills.list` 只返元数据 | **无** —— 必须 UI 指定 `skillKey` |
| 载入 | `skills.read` 按需载正文 | 整本 `skill.body` 塞 system prompt |
| 谁决定 | 客户端自己挑 | UI 塞哪本吃哪本，agent 无权 |

#### ③ 标识符不统一

- MCP prompts 用 `directoryName` 当 name（`mcpProtocol.ts:747`）
- 内嵌用 `skillKey`（如 `workbench.generation.canvas-planner`）
- 而 `readSkillContent` 写的是 `findSkillRecord(key, key)` —— **同一个值传两个参数**

最后这行是信号：**这一层自己已经分不清该用哪个标识符**，干脆两个都传同一个值撞运气。今天能跑，明天加一本同名技能就炸。

#### 根治方向：可见性由技能自己声明，不由调用方各写一套

现在是三个消费方各自 hardcode 规则。正确做法是在 frontmatter / `skill.json` 里声明，**三边读同一个字段**：

```yaml
---
name: director.cinematography
description: 镜头语言与摄影技法方法论…
whenToUse: 拆镜头或写视频 shot 的 prompt 时
audience: [internal, external]     # 谁能看见
stages: [storyboard, build]        # 哪个阶段可见（见 §2.4）
---
```

好处：加一本新技能只在它自己身上声明一次；`brand-promo` 想对外暴露改一个字段即可，不用改 `isCraftSkill`；用户导入的技能**不会因为目录名前缀就意外对外暴露**。

### 2.4 分阶段可见（2026-08-27 用户提出）

> 用户原话：「不是可以分阶段，不同阶段加载不同的 Skill…如果这个 Skill 太多，我们要思考一种方案，就是阶段性的，比如说有一部分能看到，有一部分看不到。」

这正是 Claude Code frontmatter 里 `paths:` 字段的同构物 —— 它按**文件路径**条件激活（写前端代码时部署 Skill 不冒出来），我们按**创作阶段**。

**先纠正我们自己的一个问题：阶段词表已经有两套，我在设计文档里还造了第三套。**

| 词表 | 值 | 位置 | 处置 |
|---|---|---|---|
| 工作区阶段（用户在哪个 tab） | `creation \| generation \| preview` | `src/design/identity.tsx:30` | 保留（它是 UI 位置，不是工序） |
| **Playbook 阶段（干到哪一步）** | `script \| storyboard \| build \| generate \| assemble` | `skills/brand-promo/skill.json` | ✅ **定为单一真相源** |
| 工序图示（等待指示器） | 读本 / 拆镜 / 出图 / 出视频 / 上轨 | `docs/design/nomi-agent-interaction.md` §5 | ⛔ **我造的第四套，改为对齐上一行** |

对应关系（几乎一一对应，所以对齐是自然的，不是硬凑）：

| Playbook 阶段 | 工序图示 | 该阶段典型技能 |
|---|---|---|
| `script` | 一页纸逐行扫 | `writer-*`（编剧方法论） |
| `storyboard` | 格子依次落位 | `director-shot-translation` `director-consistency` |
| `build` | 取景框对焦 | `director-cinematography` `director-art-design` |
| `generate` | 场记板打板 | `director-action` `director-style-*` |
| `assemble` | 轨道走带 | 剪辑类（待建） |

**设计主张**：

1. **Level 1 元数据永远全量**（31 本 × ~80 字 ≈ 2,500 字符），因为「有哪些技能」本身是廉价的
2. **阶段只影响排序与默认可见，不做硬隐藏** —— 当前阶段的技能排在前面并进 Level 1；其余折叠但**可搜、可 @**
3. 理由（D1 用户摩擦）：硬隐藏会造成「我记得有个技能，怎么找不到了」。**用户找得到 > 列表干净。**

**当 31 本涨到 100 本时**才需要真正的分层裁剪。那时的规则应当是：Level 1 只放「当前阶段 + 用户置顶 + 最近用过」，其余走搜索。**现在 31 本不需要，别过早优化。**

### 2.5 用户 @ 调用（2026-08-27 用户提出）

> 「你可以看一下怎么，比如说用户艾特，Nata 可以被调用。」

我们 composer 里**已经有 `@` 机制**（`tests/ux/at-mention-edge.walk.mjs` 在测它）。技能应当接进同一个 `@`，不另造入口（一功能一个家）。

三个形态（设计文档里要补的第 18–20 种）：

| # | 形态 | 说明 |
|---|---|---|
| 18 | **composer 上的技能 chip** | 用户 `@` 选中后挂在输入框上方：`按 编剧·Kasdan 方法论`，随时可摘。**必须持续可见**——不然用户不知道输出为什么变了 |
| 19 | **agent 自主载入 → 对话流一行** | 「载入了 镜头语言与摄影技法」，可展开看它是什么。属「工具条」层，单行 |
| 20 | **常驻技能标记** | 面板顶部（与上下文用量同一行）显示当前生效的技能。技能约束的是**后面所有输出**，不能只在载入那一刻闪一下 |

**待拍板的取舍**：用户选了技能 A，agent 中途判断该用 B —— 允许覆盖吗？

倾向 **不允许覆盖、允许追加**：用户选的 A 恒在，agent 可额外 `load_skill(B)` 并在对话流里明写「另外载入了 B」。理由 D4 诚实：用户的选择不该被悄悄改掉。

### 2.6 说不清（Phase 2）

`electron/skills/skillIpc.ts` 此前 `description: r.manifest?.description ?? null` —— 只读 `skill.json`，导致**没有 manifest 的技能卡片一律显示「暂无说明」**，哪怕 frontmatter 里写着标准 description。31 本只有 7 本带 manifest，用户从生态导入的标准技能全中招。

已在 Phase 0 顺手修掉（真机走查抓出的）。但根子还在：**24 本技能没有 manifest，渐进披露缺元数据基础**。

## 3. 分期

### Phase 0 — 导入对齐标准 ✅ 已交付

| 改动 | 位置 |
|---|---|
| `isSafeSkillFileName` → `isSafeSkillFilePath`（加新删旧，P1）：允许 `references/` `assets/` 子目录，深度 ≤4，扩展名白名单，仍禁 `..`/绝对路径/盘符/`\0` | `skillPackage.ts` |
| `isExecutableSkillPath` 单独识别 `scripts/` `bin/` `hooks/`，报「只吃知识层」而非笼统「不安全的文件名」 | 同上 |
| `readSkillDirFiles` 递归、`writeSkillImport` 建子目录 + resolve 三保险 | 同上 |
| `normalizeSkillImportInput`：主进程盖版本戳（版本号单一真相源，渲染层不复制） | 同上 |
| 新增解析前端：裸 `SKILL.md` / zip / 旧信封 → `{dirName, files}`。zip 剥掉 GitHub 多包的外层文件夹，二进制**如实报数跳过**不静默丢 | `src/workbench/skillLibrary/parseSkillImport.ts` |
| `accept` 从 `.json` 放开到 `.md/.markdown/.zip/.json/.nomiskill` | `SkillLibraryPanel.tsx` |
| description 改取 `r.description`（manifest ∥ frontmatter） | `skillIpc.ts` |

**验证**：单测 37 条（含跨进程接缝）+ 阳性对照（断开接缝 3 红、退回禁子目录 4 红、还原全绿）+ 真机走查 `tests/ux/skill-import-formats.walk.mjs` + 截图人眼核对。

**已知未验**：win32 的系统文件对话框过滤器（用户截图里那一幕）—— mac 上验不了，需 Windows 侧补一次。

### Phase 1 — 渐进披露接给内嵌 agent（本文重点 · 建议下一个做）

**做什么**：把已经为外部做好的 `skills.list` / `skills.read` 接成内嵌 agent 的工具。

```
系统 prompt 只放 31 本的 (name, description, whenToUse)   ← Level 1
   ≈ 31 × 80 字 ≈ 2,500 字符，比现在挂一本还便宜
agent 判断该用哪本 → 调 load_skill(name)                 ← Level 2
   只有用到的那本进上下文
skill 目录下的 references/ 按需读                          ← Level 3（Phase 3）
```

**为什么这条优先**：一次解三个问题 —— ① 31 本从「基本用不到」变成「全部可发现」；② system prompt 立刻瘦一本技能的量；③ 给工具描述瘦身提供同一套机制（见 `2026-08-27-unified-tool-surface.md` §4）。而且它是**纯增量**，不动 `agentLoop` 核心路径。

**Phase 1 的完整范围（2026-08-27 扩充）** —— 这四件事是**同一次改动**，都在动技能的发现层，分开做要改两遍：

| # | 事 | 对应 |
|---|---|---|
| 1a | `skills.list` / `skills.read` 接成内嵌 agent 的工具（`load_skill`） | §2.3 ② 加载机制两套 |
| 1b | **可见性由技能自己声明**（`audience` 字段），三个消费方读同一个字段，删掉 `isCraftSkill` 的前缀判定（P1 加新删旧） | §2.3 ① 三套口径 |
| 1c | **标识符收口**：定 `directoryName` 为唯一外部标识、`name` 为显示名，删掉 `findSkillRecord(key, key)` 那种撞运气写法 | §2.3 ③ |
| 1d | **阶段字段**（`stages`）影响排序与默认可见 | §2.4 |

**为什么这条优先**：一次解三个问题 —— ① 31 本从「基本用不到」变成「全部可发现」；② system prompt 立刻瘦一本技能的量；③ 给工具描述瘦身提供同一套机制（见 `2026-08-27-unified-tool-surface.md` §4）。而且它是**纯增量**，不动 `agentLoop` 核心路径。

**风险与边界**：
- 弱模型可能不主动 `load_skill` → 保留「UI 显式指定 skillKey」作为**强制通道**（不是 fallback：它是用户明确选技能时的路径，语义不同）
- `whenToUse` 字段标准里是可选的，我们要在 Phase 2 补齐才好判
- **1b 是行为变更不是纯增量**：`audience` 默认值定错会让某些技能突然对外可见/不可见。默认应为 `[internal]`（**收紧**），逐本显式开 `external`，并写一条测试断言「当前 23 本 craft 技能迁移后仍对外可见」——否则这次改动本身会造成回归

**明确不抄的（frontmatter 行为控制那一套）**：Claude Code 的 `allowed-tools` / `disable-model-invocation` / `context: fork` / `model:` / `hooks:` 很强，但它们依赖**策略引擎**和 **subagent 隔离**，我们两样都还没有（master plan 里是 B3/B4，且 v1 明确不做 subagents）。现在抄字段名等于写一堆读不懂的声明。**等策略引擎落地再接，届时字段名直接沿用它的**（同一语义不另造词表——这正是本文在治的病）。

### Phase 2 — 补齐 manifest 元数据

24 本技能补 `skill.json`（或在 frontmatter 里补 `whenToUse`）。**只补元数据，不动正文**。

顺带定一条纪律：**新增技能必须带 name + description + whenToUse**，做成门岗（`check:skills-manifest`，baseline 只减不增）。按 R17：加规则前先验它会红。

### Phase 3 — Level 3 引用文件

`references/` 已经能导入了（Phase 0），但 `skillStore` 还不读它。给 agent 一个按需读的通道。**等 Phase 1 跑顺再做**，否则是过早优化。

## 4. 明确不做（附理由）

| 别家有的 | 我们不做的理由 |
|---|---|
| `scripts/` 可执行脚本 | 收了就要配安全扫描 + 沙箱。Nomi 是创作工具不是 coding agent，31 本技能价值 99% 在方法论。**明确拒绝并说明原因** > 假装支持然后崩 |
| 安装配方（brew/npm/go/uv） | 我们不该要求用户装 ffmpeg |
| 跨设备节点能力探测 | 远期，且我们不是分布式 CLI agent |
| 安全扫描器 | 只有决定支持 `scripts/` 才需要——见上，不做 |

**已有但没用满的**：`requiredProviders`（text/image/video）+ `getAvailableSkillProviders()` 是资格检查的同构物，但现在**只用来 UI 灰显**，没用在「不满足就不给 agent 看见」。Phase 1 顺手接上。

## 5. 验收门

- [ ] Phase 1：system prompt 里不再出现任何 skill 全文；agent 能在一轮对话里自己 `load_skill` 并用上方法论（真机走查为证）
- [ ] 固定开销从 ≈9,000 tokens 降到 ≈7,000 以下（含 31 本元数据）
- [ ] 用户显式选技能的路径不回归
- [ ] Phase 2：`check:skills-manifest` 门岗上线且验证过会红
- [ ] 每步照旧三闸：样张（若涉 UI）/ 五门 / 真机走查

## 6. 待办与未决

| # | 事 | 状态 |
|---|---|---|
| 1 | win32 文件对话框过滤器未验 | 需 Windows 侧补 |
| 2 | `whenToUse` 是标准可选字段，我们要不要强制 | 建议强制（Phase 2 一并定） |
| 3 | 用户提到「用 Python 做接入」 | **语义未明**，若指跑技能脚本，则 §4「不做 scripts/」需重议 |
