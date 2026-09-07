# 技能格式收敛方案：`skill.json` 退场，frontmatter 成为唯一 owner（2026-09-07）

> 状态：🚧 进行中 —— 方案 + 实施同 PR 交付（用户 2026-09-07 已拍板方向）。
> 基线：`origin/main@35d444a7b`。全文 `file:line` 均在 worktree `/Users/aoqimin/Desktop/Nomi-skill-format` 上实核。
> 起因：[pi 包生态调研 §4.2](../research/2026-09-07-pi-package-ecosystem.md) 实核出「Nomi 是唯一多一份文件的人」，用户当天拍板：**技能格式收敛成唯一 owner（P1 加新删旧 / P4 通用第一）；skills-only pi 包先不发**。
> 上游：[Agent 运行时重做方案](2026-09-07-agent-runtime-rebuild.md) 阶段 5「内外同源 + 目录新鲜度」。本方案是它的前置——目录格式不统一，同源无从谈起。

---

## 0. 一句话

Nomi 的技能包现在有**两份清单**：`SKILL.md` 的 YAML frontmatter，和另一份 `skill.json`。pi / Claude Code / Codex 三家已经收敛到**只有 frontmatter**。这份方案把 `skill.json` 删掉，把它承载的东西按「还活着 / 已经死了」分开处理——活的搬进 frontmatter 的 `metadata.nomi.*`，死的直接删——并加一道门岗保证它不会长回来。

---

## 1. 为什么要做（D6：先讲清楚真实摩擦，再讲机制）

### 1.1 用户那一刻卡在哪

用户在 Claude Code 里攒了一目录技能，想在 Nomi 里用；或者反过来，想把 Nomi 的导演/编剧技能拖到 Codex 里用。今天这两个方向都得**重打一个包**——因为 Nomi 多要一份 `skill.json`，而别人不给。

反过来也真实：我们自己的 33 个内置技能，今天在 pi 眼里是这样的（实测，见 §2.4）——**32 个能读，1 个整包读不出来，31 条格式警告**。也就是说：如果哪天有人把 Nomi 的技能目录挂进他的 pi/Claude Code，他会发现少了一个技能，而且看不出为什么。

### 1.2 两份清单已经在打架（不是理论风险，是现状）

以 `skills/brand-promo/` 为例，同一个技能的「描述」有两份、内容不同：

| 来源 | 值 |
|---|---|
| `skills/brand-promo/SKILL.md` frontmatter | 「品牌宣传片 playbook。把产品文案/卖点做成一条『3 秒钩子 → 卖点 → …』」 |
| `skills/brand-promo/skill.json:5` | 「做产品/品牌宣传片。当用户要把产品文案、卖点或品牌介绍做成一条短宣传视频…」 |

加载器的取值规则是「清单胜出、缺了才退回 frontmatter」（`electron/skills/skillStore.ts:203`、`:206`、`:213`）。所以模型看到的是 `skill.json` 那份，pi/Claude Code 看到的是 frontmatter 那份。**同一个技能，在两个宿主里对模型自我介绍的话是不一样的。** 这正是 #546 那条「同一语义两份定义」的复发形状。

### 1.3 你要权衡的那个核心东西

**代价是：`skill.json` 里那些 Nomi 独有的结构化字段（阶段编排、参考槽片种模板、能力申报）要换个地方住，而 frontmatter 会因此变长。** 收益是格式只剩一份、跨宿主可拖拽、机器能校验。

这份方案的真正判断不是「搬不搬」，而是**「哪些字段值得搬、哪些该趁这次删掉」**——因为实核下来，`skill.json` 415 行里有相当一部分是**已经没有生产调用者的登记表**（§4）。P1 说加新必删旧；D4 说砍一切不挣命的。搬一份死代码进新格式，是把债换个地方欠。

---

## 2. 现状实核（file:line，全部在 `origin/main@35d444a7b` 上核过）

### 2.1 格式真相源：两处，且有优先级

| 位置 | 行数 | 干什么 |
|---|---|---|
| `electron/skills/skillManifestSchema.ts` | 142 | `skill.json` 的权威 zod schema（`skillManifestSchema` 在 `:91-127`；`parseSkillManifest` 在 `:136-142`） |
| `electron/skills/skillStore.ts:89-111` | 23 | frontmatter 的**手写正则**解析器：只认单行 `name` / `description` / `disable-model-invocation` / `audience` 四个键 |
| `electron/skills/skillStore.ts:123-134` | 12 | `readSkillManifest()`：读 `files["skill.json"]` → `JSON.parse` → `parseSkillManifest` |
| `electron/skills/skillStore.ts:200-216` | 17 | 组装 `SkillRecord`：`manifest?.name || parseSkillName(body)`、`manifest?.description || parseSkillDescription(body)`、`manifest?.audience ?? parseSkillAudience(body)` ——**清单优先，frontmatter 兜底** |

### 2.2 所有读写 `skill.json` 的地方（生产代码）

| 文件 | 行 | 做什么 | 处置 |
|---|---|---|---|
| `electron/skills/skillManifestSchema.ts` | 全 142 行 | `skill.json` schema | 改写成 frontmatter `metadata.nomi` 的 schema（同一文件，换 owner） |
| `electron/skills/skillStore.ts` | `:123-134`、`:201` | 读 `skill.json` | 删；换成 YAML frontmatter 解析 |
| `electron/skills/skillStore.ts` | `:89-111` | 手写正则 frontmatter | 删；换成真 YAML 解析（§5.3） |
| `electron/skills/skillPackage.ts` | `:27`（`SKILL_TEXT_EXT` 含 `json`）、`:143-154`（导入时校验 `skill.json`） | 导入包校验 | `:143-154` 删；`:27` 保留（`references/*.json` 仍是合法知识层文件） |
| `electron/capabilityCore/skillWriteTransportAdapters.ts` | `:157-161` | `author_skill` 落盘时写 `"skill.json": stableJson(args.manifest)` | 删；只写 `SKILL.md` |
| `electron/harness/tools/documentDescriptors.ts` | `:6-31`（`authorSkillManifest` 30 行）、`:72-76` | 模型可见的 `author_skill` 参数里带一整份 manifest schema | 删这 30 行；`author_skill` 只收 `dirName` + `skillMarkdown` |
| `electron/shared/agentCapabilities/skillWrite.ts` | `:11`、`:22` | wire schema 的 `manifest: z.record(z.unknown())` | 删该字段（`exposure: "internal_only"`，不是 MCP 对外契约，`:54`） |
| `src/workbench/creation/creationToolCalls.ts` | `:24` | 渲染层把 `manifest` 序列化成 `skill.json` 落包 | 删 |
| `electron/skills/skillIpc.ts` | `:44-58` | 面板 payload：`deriveSkillNeeds(manifest)`、`label`、`author`、`stageLabels`、`isPlaybook`、`manifestError` | 改成从 `metadata.nomi` 取（语义不变） |
| `electron/harness/runtime/pi/nomiSkillResources.mts` | `:85-94`、`:147` | pi 侧只用 `name` / `description` / `contentHash` | 不动（`contentHash` 覆盖整个文件映射，天然跟着变） |
| `electron/skills/skillExecutionEvidence.ts` | `:31`（`manifest.version`）、`:19`/`:37`/`:51`（`stages[].id` → `skillRefs`） | 生产运行产物证据 | 不动语义，改成从 `metadata.nomi` 取 |
| `electron/harness/skillIndex.ts` | `:25-26`、`:46`、`:51` | 模型可见目录行（`name` + `description`） | 不动（两个字段都升到 frontmatter 顶层） |
| `electron/harness/context/agentContext.ts` | `:91-92` | 系统提示词里的 `skillKey` / `skillName` | 不动（§6.1 说明 key 归一为什么不破） |

### 2.3 用户技能目录（迁移入口）

- 用户技能根：`getUserSkillsRoot()`（`electron/runtimePaths.ts`），即 `<userData>/skills/`；发现规则见 `electron/skills/skillStore.ts:51-87`（`getSkillDiscoveryRoots`）与 `:143-220`（`discoverSkillRecordsFromRoots`，**只认 `<root>/<dir>/SKILL.md`，不递归**）。
- 用户技能只能从两条路进来：① 面板导入（`src/workbench/skillLibrary/parseSkillImport.ts`，135 行，吃裸 `SKILL.md` / zip / `.nomiskill.json` 信封）② `author_skill` 工具写入（`skillWriteTransportAdapters.ts`）。**两条路今天都可能落下 `skill.json`。**
- 删除只允许发生在用户目录（`skillPackage.ts:246-261`），内置目录只读。

### 2.4 pi 现在读我们的技能目录，结果长这样（实测，非推测）

用 pi 自带的加载器（`node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js:35` `loadSkillsFromDir`）直接扫仓库 `skills/`：

```
skills loaded: 32        # 目录里有 33 个 SKILL.md
diagnostics:   31
  ! warning  Nested mappings are not allowed in compact mappings at line 2, column 14
             skills/director-art-design/SKILL.md          ← 整包读不出来
  ! warning  name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)
             × 30 个                                        ← 我们的 name 带点号
```

两条都是真 bug，而且**只有在别人的解析器下才显形**：

1. `skills/director-art-design/SKILL.md:2` 的 description 里有一段 `` `carrier: visual` ``。真 YAML 解析器看到未加引号标量里的 `: ` 就报错、整个技能不加载；我们自己的正则解析器（`skillStore.ts:89-93`）只按行抓，什么都没发觉。**这个技能今天在 pi / Claude Code / Codex 里是不存在的。**
2. 30 个技能的 `name` 写成 `director.art-design` / `workbench.storyboard.planner` 这种点号分段。Agent Skills 规范要求 `name` 只含小写字母、数字、连字符，且**必须与父目录同名**（[规范原文](https://agentskills.io/specification)）。pi 只警告不拒绝，参考校验器 `skills-ref` 会直接报错。

> 复现命令写进了门岗（§7），不需要手工重跑。

---

## 先查别人（本方案的第 3 节）

> 模板四问：依赖里已有？仓库里已有？生态里已有？自媒体怎么说？

- **依赖里已有**：pi 自带完整的 Agent Skills 加载器与 frontmatter 解析器，我们没在用。`node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js:208-264`（`loadSkillFromFile`：解析 frontmatter → 校验 `name`/`description` → 产出 `{name, description, filePath, baseDir, disableModelInvocation}`）；`dist/utils/frontmatter.js:18-25`（`parseFrontmatter`，直接用 `yaml` 包 `parse`，不是正则）；`dist/core/skills.js:113-122` 的发现规则（目录里有 `SKILL.md` 就当技能根、不再递归）。**它只认 frontmatter 的三个字段（`name` / `description` / `disable-model-invocation`），未知字段一律忽略**（`docs/skills.md:185`「Unknown frontmatter fields are ignored」）——这是我们把独有字段挂进去而不打扰别人的结构依据。
- **规范一手出处**：[Agent Skills 规范 · Frontmatter 字段表](https://agentskills.io/specification) —— 必填 `name`（≤64 字符，仅小写 a-z / 0-9 / 连字符，不得首尾连字符、不得连续连字符，**必须与父目录同名**）、`description`（≤1024 字符）；可选 `license` / `compatibility`（≤500）/ `metadata`（*"Arbitrary key-value mapping for additional metadata"*，官方建议 *"making your key names reasonably unique to avoid accidental conflicts"*）/ `allowed-tools`（实验中）。
- **参考实现（决定「扩展键能不能塞」的那条判据）**：官方参考校验器 [`skills-ref`](https://github.com/agentskills/agentskills/tree/main/skills-ref) —— `src/skills_ref/validator.py:104-115` 的 `_validate_metadata_fields` 对**顶层键**做闭集校验（`ALLOWED_FIELDS = {name, description, license, allowed-tools, metadata, compatibility}`，多一个顶层键就是 error）；而 `validate_metadata`（`:118-147`）**完全不校验 `metadata` 的内部结构**——只有 `models.py:27` 的类型标注写着 `dict[str, str]`，运行时不强制。结论：**扩展只能走 `metadata`，不能走新顶层键**；`metadata` 内部嵌套在参考校验器下是通过的。
- **Claude Code**：[官方 skills 文档](https://code.claude.com/docs/en/skills) —— 只用 `SKILL.md`，**没有第二份清单文件**；`metadata` 是「free-form key-value data for custom tooling，Claude Code ignores its contents」；未知顶层键被接受并忽略（但对外分发打包时按规范闭集报错）。
- **Codex**：[Build skills](https://learn.chatgpt.com/docs/build-skills) —— 明写 *"build on the open agent skills standard"*，`SKILL.md` 必填 `name` / `description`，**无 `skill.json`**；UI/策略元数据走 `agents/openai.yaml`（另一份可选文件，不是清单）。
- **仓库里已有**：`js-yaml@4.1.1` 已在 `package.json` 的 devDependencies（`scripts/release-contract.mjs:7` 等 4 处在用）。本方案把它提到 dependencies，不引新库、不手写 YAML 解析（R20：解析器是通用能力，不在护城河上）。
- **自媒体怎么说（TikHub 实检，2026-09-07，关键词「Agent Skills SKILL.md 技能格式」，抖音/小红书/B站/X 各 8 条）**：社区教程里对格式的表述高度一致——「[核心就一个文件：SKILL.md，frontmatter 必填两个字段 name（小写+连字符，限 64 字符）/ description（限 1024 字符）](https://www.douyin.com/video/7680378376628047131)」（抖音 @AI训练，2026-09-01）；[另一条同题教程](https://www.douyin.com/video/7674851329126732651)（抖音 @程序员R哥，2026-08-17）同样只讲 SKILL.md 单文件结构。**没有任何一条提到第二份清单文件。** 原始检索产物：`/tmp/tikhub-skillfmt/tikhub-search.md`（32 条，不入库）。
- **结论：用已有格式，删自研的第二份。** 我们唯一需要自己造的是「Nomi 独有字段住在 `metadata.nomi.*` 下」这条命名约定，以及校验它的门岗。
- **一条 R29 边界要说清楚：为什么不直接 import pi 的 `parseFrontmatter`。** 它确实存在（`dist/utils/frontmatter.js:18-25`），但 ① 包的 `exports` 没有暴露这个子路径（`import ".../dist/core/skills.js"` 会被 Node 以 `ERR_PACKAGE_PATH_NOT_EXPORTED` 拒掉，只有绕过 exports 写死物理路径才拿得到）；② 它本身就是 `yaml` 包 `parse` 的 20 行包装。**把主进程的技能加载路径挂在一个未导出的内部文件上，是给自己埋一颗随 pi 小版本升级而炸的雷**（0.85.0 上游误发布内部实验代码已经炸过一次）。所以解析器用仓库里已有的 `js-yaml`，而**判分**用 pi 的加载器（门岗 F6 里写死物理路径是可接受的：门岗炸了只是 CI 红，不是用户的技能加载不出来）。

---

## 4. 逐字段对照表

> 判据分三档：**搬**（有生产消费者，进 `metadata.nomi.*`）｜**升**（有对应的规范字段，升到 frontmatter 顶层）｜**删**（无生产消费者，P1/D4 就地删掉）。

| `skill.json` 字段 | 现在谁在读（file:line） | 规范里有没有对应 | 处置 |
|---|---|---|---|
| `name` | `skillStore.ts:203`（清单优先）；查找归一在 `:113-121` | ✅ `name`（但必须 kebab + 与目录同名） | **升**。改写成目录名（§6.1 说明为什么不破坏既有 `skillKey`） |
| `description` | `skillStore.ts:206`、`skillIpc.ts:53` | ✅ `description` | **升**。frontmatter 那份是唯一真相源，`skill.json` 那份丢弃 |
| `version` | `electron/skills/skillExecutionEvidence.ts:31`（`skill?.manifest?.version ?? "declared"`）→ `electron/productionRun/productionRunDriverOps.ts:315`、`:382`，进真实生产运行的**产物证据**。⚠️ 它**不是** `productionRun.playbook.version` 的来源——那个来自 MCP 调用方，默认字面量 `'1.0.0'`（`electron/capabilityCore/dispatcher.ts:324`、`productionRunTransportAdapters.ts:110`） | ❌ | **搬** → `metadata.nomi.version` |
| `label` | `skillIpc.ts:48` → `src/workbench/skillLibrary/SkillCard.tsx:33`、`:100`、`:116`；`libraryAdapters.ts:31`；`useAgentPanelV4Data.ts:244`（chip 标签） | ❌ | **搬** → `metadata.nomi.label` |
| `author` | `skillIpc.ts:54` → DTO → **IPC 之后没有任何组件渲染它**（`src/` 全量 grep 零命中） | ❌ | **搬** → `metadata.nomi.author`（规范自己的示例就是 `metadata.author`）。DTO 那条死字段不在本 PR 范围，见 §11 |
| `audience` | `skillStore.ts:213`、`isSkillVisibleTo` `:246-249`、`isSkillVisibleToMcp` `:261-263` | ❌ | **搬** → `metadata.nomi.audience`。注意今天它**同时**是 frontmatter 顶层键（`skillStore.ts:109-111`）——那是个非规范顶层键，一并收进 `metadata` |
| `selectableInWorkbench` | `skillStore.ts:270-275` | ❌ | **搬** → `metadata.nomi.selectable-in-workbench` |
| `requestedCapabilities` | `agentChatV2.ts:55-58` → `agentChatPolicy.ts:101-103`、`:190-218` → `skillCapability.ts:76-105` | ❌ | **搬** → `metadata.nomi.requested-capabilities`。**这是唯一参与运行时授权的字段**（只能收窄 Host 能力天花板），fail-closed 语义（解析失败 ⇒ 空数组 ⇒ 零工具）必须逐字保留 |
| `tools` | `skillCapability.ts:28`、`:31`（`deriveSkillNeeds` 折进 `needs.tools`）→ `skillIpc.ts:44`，**但 `:57` 只留 `needs.providers`，`tools` 与 `families` 当场丢弃**；`reportSkillCapability` 的 `missingTools`（`skillCapability.ts:66`）只有自己的单测调用 | ❌ | **搬** → `metadata.nomi.tools`。它对授权与 UI 都不生效（真实授权只看 `requested-capabilities`），保留的唯一理由是 `builtinSkills.test.ts:83-105` 用它做「阶段工具 ⊆ 顶层工具」的一致性断言，而那条断言在 playbook 复活时有价值。**不趁这次删**——删它属于 playbook 产品线的取舍（§11） |
| `requiredProviders` | `skillCapability.ts:27` → `skillIpc.ts:44`、`:57` → `src/workbench/api/skillApi.ts:80-86`、`src/workbench/skillLibrary/SkillCard.tsx:25`、`:58-73`（✓/⚠ 模态芯片）、`libraryAdapters.ts:35` | ❌ | **搬** → `metadata.nomi.required-providers`（真实 UI） |
| `permissions` | **无生产读取点**。`SkillPermission` 类型在全仓从未被 import；只有 schema（`skillManifestSchema.ts:30-36`、`:111`）、`documentDescriptors.ts:29` 的模型输出形状、以及 11 个测试文件的夹具 | ❌ | **删**。`skillManifestSchema.ts:110-111` 自陈「never grants runtime capabilities」——它是一张登记表，还在逼每个 agent 生成的技能都填一遍 |
| `inputs` | 无生产读取点；`SkillInput` 从未被 import；连 `author_skill` 的模型 schema 都没有它。9 个内置里 4 个写了 | ❌ | **移进正文**。这是**作者手写的人话内容**，不是机器字段——规范推荐的正文分区里本来就有「Examples of inputs and outputs」。搬进 `SKILL.md` 的 `## 输入` 段，一个字不丢 |
| `examples` | 无生产读取点；`SkillExample` 从未被 import；9 个内置里 8 个写了（**最多人写的死字段**） | ❌ | **移进正文**（同上，`## 示例` 段） |
| `stages` | `skillIpc.ts:55-56`（`stageLabels` / `isPlaybook`）、`skillStore.ts:274`（`stages.length` ⇒ 进 Workbench 选择器）、`skillCapability.ts:30-36`；UI 在 `SkillCard.tsx:34`、`:36`（playbook 徽标 + 阶段数）、`libraryAdapters.ts:29`、`:36-37`（分类筛选） | ❌ | **整体搬** → `metadata.nomi.stages`（子字段结构不动） |
| └ `stages[].id` + `stages[].skillRefs` | `skillExecutionEvidence.ts:19`、`:37`、`:51` → `productionRun/productionRunDriverOps.ts:315`、`:382`：**真实生产运行的剧本/分镜产物证据里带的就是它** | ❌ | 随 `stages` 搬。这是 `stages` 里**唯一真跑在生产路径上**的两个子字段 |
| └ `stages[].modelPrefs.kind` | `skillCapability.ts:32-35` → 模态芯片 | ❌ | 随 `stages` 搬 |
| └ `stages[].goal` / `tools` / `dependsOn` / `pause` / `modelPrefs.family` | `goal` 被传到 UI 但只渲染 `.length`（`SkillCard.tsx:36`）；`dependsOn` / `pause` 只有 `playbookOrchestrator.ts` 读，而**编排器整体没有生产调用者**（`runPlaybook` 这个名字只存在于两条 schema 注释里，`PlaybookRun` / `extractMarkdownSection` 零非测试调用者） | ❌ | 随 `stages` 搬，**不在本 PR 拆**（见 §11） |
| `storyboardProfile` | **无人读**。它在 `skills/workbench-storyboard-planner/skill.json:18-37`，但不在 zod schema 里；`skillManifestSchema` 不是 `.strict()`，`parseSkillManifest`（`:139`）**静默把它剥掉**，从未进入 `SkillRecord`。真正在用的片种表是渲染层手维护的另一份：`src/workbench/generationCanvas/agent/storyboardProfiles.ts:4-18`，而且**两份已经漂了**（清单里是中文字面量 `"景别·运镜"`，TS 里是 i18n key `'storyboardEditor.promptSkeleton.segment.shotSize'`） | ❌ | **删**。同时把 `storyboardProfiles.ts:3` 与 `storyboardPlan.ts:220-221` 那两条「值来自 skill.json」的注释改成实情——它们是「同一语义两份定义」里最坏的那种：一份是死的，注释却说它是活的 |

**一句话读法**：415 行 `skill.json` 里，`permissions` 与 `storyboardProfile` 是纯登记表（删）；`inputs` / `examples` 是作者手写的人话（进正文）；其余按结构搬进 `metadata.nomi.*`。

**另外三处 manifest 定义（本 PR 一并收）**：模型看到的 `author_skill` 参数是**第三份** manifest 形状（`documentDescriptors.ts:20-32`），它漏掉了 `audience` / `selectableInWorkbench` / `requestedCapabilities` / `inputs` / `examples` / `skillRefs`——所以 agent 写出来的技能永远声明不了这些。收敛后它整份消失（模型直接写 `SKILL.md`），三份变一份。MCP 侧不受影响：`author_skill` / `load_skill` 都是 `exposure: "internal_only"`（`skillWrite.ts:54`、`skillRead.ts:50`），被 `mcpCapabilityProjection.ts:111` 挡在 MCP 面外；跨 MCP 的只有 `skills.list` / `skills.read`（`dispatcher.ts:403-416`），载荷是 `SkillSummary`（`skillStore.ts:277-284`），**没有任何 manifest 结构出进程**。

### 4.1 独有字段为什么放 `metadata.nomi.*` 而不是别处

三家的做法完全一致，而且是**唯一一条不会打扰别人的路**：

- 顶层加新键：`skills-ref` 直接报 error（`validator.py:108-113`），Claude Code 对外分发打包也报 error。❌
- 塞进正文段落：结构化数据（`stages` 的 DAG、`requested-capabilities` 的授权收窄）落进 markdown 正文就没法机器校验了，而 `requested-capabilities` 是安全边界（R28：能让门岗拦的别留给人）。❌
- `metadata` 子树：规范定义为「arbitrary key-value mapping」，官方建议用足够独特的键名避免冲突；pi 忽略它、Claude Code 明说忽略其内容、参考校验器不校验其内部。✅

**诚实标注的一处偏离**：规范正文把 `metadata` 描述成 *"a map from string keys to string values"*，而我们要在 `metadata.nomi` 下放嵌套结构（`stages` 是对象数组）。判据是：官方参考校验器 `skills-ref` 对 `metadata` 内部**不做任何校验**（`validator.py:118-147` 全文没碰它），pi 与 Claude Code 都只把它当不透明数据。所以这是「规范文字比参考实现更严」的一处，我们选参考实现的行为，并在 §7 门岗里自证——把我们的 33 个技能喂给 pi 的加载器，必须 **33/33 加载、0 条 diagnostics**。

### 4.2 `disable-model-invocation` 的处置

它今天已经是 frontmatter 顶层键（`skillStore.ts:103-107` 读，`nomiSkillResources.mts` 透给 pi）。它**不在** Agent Skills 的 `ALLOWED_FIELDS` 闭集里，但 pi（`dist/core/skills.js:262`）与 Claude Code 都原生支持。**保持顶层不动**——挪进 `metadata` 反而会让那两家读不到它。这是有意偏离，写进门岗豁免名单并注明理由。

---

## 5. 目标格式

### 5.1 一个薄技能（33 个里的 24 个长这样）

```markdown
---
name: writer-dialogue
description: 对白专家（David Mamet 方法论）——台词创作 / 潜台词设计 / 角色声音区分。…
---

# 对白专家
…
```

顶层零 Nomi 私货。这类技能在 pi / Claude Code / Codex 里**开箱即用**。

### 5.2 一个厚技能（playbook，9 个里最厚的 `brand-promo`）

```markdown
---
name: brand-promo
description: 做产品/品牌宣传片。当用户要把产品文案、卖点或品牌介绍做成一条短宣传视频…时用我。
metadata:
  nomi:
    version: "1.0.0"
    label: 品牌宣传片
    author: "@nomi"
    tools: [read_full_text, read_selection, read_canvas_state, …]
    required-providers: [text, image, video]
    stages:
      - id: script
        goal: 先生成一份可审阅的编号剧本…
        tools: [read_full_text, read_selection]
        skill-refs: [writer-screenwriter, writer-structure, …]
        pause: true
        model-prefs: [{ kind: text }]
      - …
---

# 品牌宣传片 playbook
…
```

别的宿主看到的是 `name` + `description` + 一坨它们会忽略的 `metadata`；Nomi 看到全部。

### 5.3 解析器换成真 YAML

`skillStore.ts:89-111` 那 4 个手写正则删掉，换成 `js-yaml` 的 `load`（安全 schema，不解析函数标签）。**这不是顺手改**——§2.4 的第一条 bug（`director-art-design` 在别家整包读不出）正是「我们的解析器比别人宽松」造成的：宽松的那一侧看不见问题，严格的那一侧默默丢技能。换成同一档严格度之后，写坏的 frontmatter 在**我们自己的 CI 里**就红（§7），而不是等用户在别的宿主里发现少了个技能。

`js-yaml` 从 devDependencies 提到 dependencies（Electron 主进程是 tsc 产物、运行时按 node_modules 解析，electron-builder 打包生产依赖）。

---

## 6. 迁移

### 6.1 内置 33 个技能：同 PR 全部改写

- 9 个有 `skill.json` 的：字段按 §4 表搬进 frontmatter `metadata.nomi`，然后 `git rm skill.json`（9 个文件，415 行）。
- 33 个的 `name` 全部改成**目录名**（规范要求 name == 父目录名）。
- `skills/director-art-design/SKILL.md:2` 的 description 加引号修好。

**为什么改 `name` 不会打断既有 `skillKey`**：查找走 `findSkillRecord`（`skillStore.ts:226-244`）与 `findExactSkillRecord`（`:290-296`），两者都用 `normalizeSkillLookupKey`（`:113-121`）——**它把 `.` 归一成 `-`**。所以 `'workbench.storyboard.planner'` → `workbench-storyboard-planner` = 目录名，照样命中。历史持久化数据（`productionRun` 的 `playbook.name`、投影里的 `skillVersions[].id`）不需要迁移。

两个**归一后仍对不上**的 key 必须同 commit 改（否则静默失效）：

| 旧 key | 归一后 | 目录 | 改哪里 |
|---|---|---|---|
| `workbench.creation.skill-author` | `workbench-creation-skill-author` | `skill-author` | `src/workbench/skillLibrary/SkillLibraryPanel.tsx:30` |
| `workbench.generation.canvas-planner` | `workbench-generation-canvas-planner` | `workbench-generation` | `src/workbench/generationCanvas/agent/generationCanvasAgentClient.ts:203`、`src/workbench/ai/v4/useAgentPanelV4Actions.ts:173`，以及 4 个 e2e 脚本 |

> 处置：把 `skills/workbench-generation/` 目录改名为 `skills/workbench-generation-canvas-planner/`（保住旧 key），`skill-author` 反过来改常量为 `skill-author`（它只有一个调用点）。两条都在同一个 commit 里，配一条断言「每个 `skillKey` 常量都能在技能目录里找到对应记录」。

### 6.2 用户目录里的存量 `skill.json`：加载时一次性迁移

- **触发点**：`discoverSkillRecordsFromRoots`（`skillStore.ts:143-220`）扫到 `origin === "user"` 且目录下同时有 `SKILL.md` 与 `skill.json` 时。
- **动作**：读 `skill.json` → 按 §4 表映射进 frontmatter `metadata.nomi` → 原子重写 `SKILL.md` → 把原 `skill.json` 改名为 `skill.json.migrated-<ts>.bak`（**不删**）→ 记一条 diagnostic。
- **不可逆性明说**：备份文件留在原目录，用户打开目录就看得见发生过什么；主进程记一条诊断。**不加新 UI**——一条一次性面板提示是新的可见控件，按 P5/R8 得先出样张拍板，不该夹在格式收敛里顺手加；盘上那个 `.bak` 已经是用户可查的痕迹。内置目录只读，永远不走这条路。
- **只迁一次**：迁完目录里没有 `skill.json` 了，下次扫描自然跳过。
- **测试只在临时 HOME 下跑**（`NOMI_SETTINGS_DIR` / `NOMI_ELECTRON_USER_DATA_DIR` 指向 tmpdir），**不碰用户真实技能目录**。

### 6.3 导入路径

`parseSkillImport.ts` 与 `skillPackage.ts` 的导入校验里，`skill.json` 从「可选清单」变成「过期文件」：导入时按 §6.2 同一套映射就地转换后落盘，不把它写进用户目录。

---

## 7. 门岗 `check:skills-format`（R17：加规则必须先验它会红）

一个脚本 `scripts/check-skills-format.mjs`，**硬零，不做棘轮**（棘轮只管总数，管不住「删一个合法的、加一个非法的」）：

| 规则 | 判据 | 阳性对照（改回旧状态必须红） |
|---|---|---|
| **F1 仓库里不许有 `skill.json`** | `skills/**/skill.json` 命中即红 | 恢复任意一个 `skill.json` |
| **F2 frontmatter 必须是合法 YAML** | 每个 `skills/*/SKILL.md` 用 `js-yaml` 解析成功 | 恢复 `director-art-design` 那条未加引号的 description |
| **F3 必填字段齐全且合规** | `name` 存在、≤64、`^[a-z0-9]+(-[a-z0-9]+)*$`、**等于目录名**；`description` 存在、非空、≤1024 | 把任一 `name` 改回 `director.art-design` |
| **F4 顶层键在白名单内** | 白名单 = 规范闭集 ∪ `{disable-model-invocation}`（理由写在脚本注释里，§4.2） | 把 `audience` 写回顶层 |
| **F5 `metadata.nomi` 通过 Nomi schema** | 用 `skillManifestSchema` 的新形状校验 | 把 `modelPrefs` 里写回 `archetypeId`（`.strict()` 会拒） |
| **F6 pi 的加载器 33/33、0 diagnostics** | 直接 import `@earendil-works/pi-coding-agent` 的 `loadSkillsFromDir` 扫 `skills/`，断言 `skills.length === SKILL.md 数量` 且 `diagnostics.length === 0` | 当前 main 状态（32/33、31 warnings）就是它的阳性对照 |

F6 是这道门岗的灵魂：它不是我们自己写的判据，是**让别人的解析器给我们判分**。`check:framework-boundary` 管「pi 已有的能力不许再写一份」，这一条管「pi 能不能读我们的东西」。

脚本进 `gates:contracts` 列表；判据本体住 `scripts/skills-format-lib.mjs`（门岗自己的测试要能喂假仓库，只跑真目录就只测得到今天的存量）；`scripts/check-skills-format.node-test.mjs` 给每条规则一对阴阳样本（R17）。

**R17 阳性对照（在 `origin/main@35d444a7b` 的技能目录上实跑，收据）**：

```
$ node scripts/check-skills-format.mjs   # exit 1
✖ 技能格式门岗：33 个技能里有 102 处不合规
   F1 × 9   还有 skill.json
   F2 × 1   skills/director-art-design frontmatter 不是合法 YAML
   F3 × 60  name 点号分段 / 与目录名不一致（30 个技能各 2 条）
   F6 × 32  pi 加载器：1 个整包没加载出来 + 31 条 diagnostics
```

也就是说：**这道门岗在写它的那一刻就是红的，红的原因正是这份方案要修的东西。** 收敛完成后它必须归零。

---

## 8. 验收门

| # | 门 | 判据 | 怎么证 |
|---|---|---|---|
| **A1** | 现有走查基线不变 | `tests/ux/skill-import-formats.walk.mjs` 三条导入形状（裸 `SKILL.md` / zip / `.nomiskill.json`）全绿，卡片描述仍取自 frontmatter | 跑走查 |
| **A2** | 技能引用 chip 行为不变 | 面板 payload 的 `label` / `description` / `stageLabels` / `isPlaybook` / `needs` 逐字段与改前一致 | `skillIpc` 单测按改前快照断言 |
| **A3** | `requestedCapabilities` 的 fail-closed 不松 | 坏 `metadata.nomi` ⇒ `manifestError` ⇒ 工具集为空（`agentChatV2.ts:55-58` 语义） | 单测：喂一份写坏的 frontmatter，断言零工具 |
| **A4** | pi 能直接读我们的 `SKILL.md` | ① 门岗 F6（33/33、0 diagnostics）② 把内置技能目录软链进临时 `~/.pi/agent/skills` 跑一次 pi 的**宿主侧**发现 | **两条都已实跑**，见 §8.1 |
| **A5** | 用户目录迁移只发生一次且可回看 | 临时 HOME 下：造一个带 `skill.json` 的用户技能 → 加载 → 断言 `SKILL.md` 含 `metadata.nomi`、`skill.json` 变成 `.bak`、第二次加载无动作 | 单测 |
| **A6** | 五门 | `pnpm run gates` 全绿（含新门岗） | CI |
| **A7** | i18n 不新增硬编码 | 本轮不新增任何用户可见文案（迁移无 UI，见 §6.2） | `check:i18n` |

---

### 8.1 A4 实跑收据（2026-09-07）

把 `skills/brand-promo` 与 `skills/director-art-design`（**收敛前 pi 整包读不出来的那一个**）软链进一个临时 `~/.pi/agent/skills`，调 pi 的宿主侧发现 `loadSkills({cwd, agentDir, skillPaths:[], includeDefaults:true})`：

```
pi discovered: brand-promo, director-art-design
diagnostics: 0 []
--- 模型会看到的 ---
<available_skills>
  <skill>
    <name>brand-promo</name>
    <description>做产品/品牌宣传片。当用户要把产品文案、卖点或品牌介绍做成一条短宣传视频…时用我。</description>
    …
  <skill>
    <name>director-art-design</name>
    <description>服化道——…Nomi 为角色/场景等视觉 anchor（`carrier: visual`）生成参考图…时参考。</description>
```

两件事同时得到证实：① 那条曾经让整个技能消失的 `` `carrier: visual` `` 现在原样进了模型上下文；② 模型在 pi 里听到的自我介绍，与它在 Nomi 里听到的**是同一句**。
pi 的 CLI 本身跑一个真实回合需要 API key（`No API key found for the selected model.`），所以验的是发现与提示词装配这一段——那正是「别人读不读得动我们」的全部。

---

## 9. 六角色评审（R7）

| 角色 | 判断 | 提的条件 |
|---|---|---|
| **CTO** | 通过。这是把「两份定义」压回一份，方向与 #546 的类根因一致；引入 `js-yaml` 到运行时是买而不是造，符合 R20。 | 唯一新增运行时依赖必须是已在仓库、有 4 个既有调用点的那个，不许顺手换成别的 YAML 库。 |
| **设计** | 通过，但有一条。frontmatter 变长会让厚技能的 `SKILL.md` 头部占半屏——这是给机器看的区域，用户在面板里看到的仍是 `label` + `description`，不受影响。 | 面板的迁移提示只出一次、一行、可关；不做弹窗。 |
| **PM** | 通过。用户可感知的收益就一句：「Claude Code / Codex 的技能目录，拖进来就能用；我们的技能拖出去也能用。」 | 缺口要明标：`metadata.nomi` 里的东西别人读不到，别在文案里暗示「完全通用」。 |
| **前端** | 通过。渲染层唯一改动是 `creationToolCalls.ts:24` 不再拼 `skill.json`，以及两个 `skillKey` 常量。 | 两个常量改动必须配断言，否则又是一次「静默失效、CI 全绿」。 |
| **后端** | 有条件通过。`requestedCapabilities` 是授权收窄字段，从 JSON 换到 YAML 意味着解析失败面变了（YAML 的失败模式比 JSON 多）。 | A3 必须是硬断言：任何解析失败一律 fail-closed 到空工具集，不许「部分解析成功就放行」。 |
| **真实用户** | 通过。「我从 GitHub 下了个技能包，拖进 Nomi，它认了」——这一句就是全部价值。 | 迁移必须不可见地发生，且原文件留着；不能让用户面对「你的技能格式过期了，请手动更新」。 |

---

## 10. 分阶段（每步一个 commit）

1. **方案**（本文档）+ 门岗骨架与它的 node-test（此时门岗对当前 main 是**红**的，作为 R17 阳性对照留痕，脚本先不进 `gates:contracts`）。
2. **加载器换真 YAML**：`skillStore.ts` 的 frontmatter 解析换 `js-yaml`，读取顺序改成「frontmatter 唯一」；`skill.json` 读取路径同 commit 删除。
3. **改写 33 个内置技能**：frontmatter 全量补齐，`inputs` / `examples` 转成正文 `## 输入` / `## 示例` 段，`git rm` 9 个 `skill.json`，两处 `skillKey` 常量与目录改名，修 `director-art-design`。
4. **删旧 + 门岗上线**：`documentDescriptors.ts` 的 30 行 manifest schema、`skillWrite.ts` 的 `manifest` 字段、`creationToolCalls.ts:24`、`skillWriteTransportAdapters.ts:157-161`；`permissions` / `inputs` / `examples` / `storyboardProfile` 从 schema 删除、两条说谎注释改正；`check:skills-format` 进 `gates:contracts`。
5. **用户目录迁移 + 测试**：§6.2 的一次性迁移、备份、提示文案（i18n），A5 单测在临时 HOME 下跑。
6. **文档同步**：`docs/skill-pack-format.md` 改写、`docs/integrate-with-your-agent{,-en}.md:106-115`、`docs/user-guide.md:131`。

## 11. 不做项（明说）

- **不删 `playbookOrchestrator.ts` 与 `stages` 的死子字段**：编排器 164 行、零生产调用者（`runPlaybook` 这个名字只活在两条注释里），`dependsOn` / `pause` / `modelPrefs.family` / `tools` 因此也没有运行时。但删它们属于「playbook 这条产品线要不要留」的产品取舍，不该混进格式收敛——本 PR 只搬字段，把这条留成一张单。
- **不删 `skillIpc` 的 `author` DTO 字段与 `reportSkillCapability`**：两者都是 IPC 之后没有消费者的存量死码，与格式无关；同上，留单。
- **不发 skills-only pi 包**：用户 2026-09-07 明确「先不发」。
- **不改导入的安全边界**：`scripts/` `bin/` `hooks/` 仍然拒收（`skillPackage.ts:27-47`），比 pi 严，这是有意的。
- **不动 `contentHash` 语义**：它覆盖整个文件映射，删掉 `skill.json` 会让所有内置技能的 hash 变化——这是正确行为（包内容确实变了），不需要迁移，因为 hash 只用于「读之前确认没变过」的乐观校验（`skillStore.ts:336-338`）。
