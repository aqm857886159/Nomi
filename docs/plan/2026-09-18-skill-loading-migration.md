# 技能加载迁到 pi 自带的那套——先捞经验，迁完逐条对照

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 2026-09-18 · 用户拍板：「一定要迁移，不能留我们那个废物。但是注意防止我们原本的那个地方可能有一些发现的问题，防止新架构复发，可以之后对照一下。」
> 规则面：P1（加新必删旧）、P2（根因）、R5②④（先查别人；框架已提供的不再自研）、R17（防线建在最早能拦住的那层）、R21（recurring 合同 + 门表）。
> 基线：`fix/skill-tool-binding-phase1-20260918`（`eede6f758`）。

## 0. 一句话

pi 已经出了整套技能加载（`loadSkills` / `loadSourcedSkills` / `formatSkillInvocation` / `SkillDiagnostic`），我们一个都没用，自己写了约 3000 行。自研那份在 6 月到 9 月踩出了 **59 条**经验（下表）。这份文档先把 59 条按原文捞出来，再按「pi 已覆盖 / 我们薄薄保留 / 确已过时」三档判，**每条 pi 已覆盖 / 薄薄保留的都要变成一条断言**——没变成断言的清单条目，等于没对照过（`docs/audit/2026-09-18-electron-unowned-state-structural-review.md` 的结论：958 个声明过的不变量因为没人核，等于不存在）。

## 先查别人（R27 模板四问，实施前的检索报告）

- **依赖里已有？** 有，整套。`node_modules/@earendil-works/pi-agent-core/dist/harness/skills.js:8`（`formatSkillInvocation(skill, additionalInstructions)`）、`:19`（`loadSkills`：递归、根目录下带 frontmatter 的 `.md`、ignore 文件、warning-only 诊断）、`:47`（`loadSourcedSkills`）、`dist/harness/skills.d.ts`（`SkillDiagnostic.code ∈ file_info_failed|list_failed|read_failed|parse_failed|invalid_metadata`）；`node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js:275`（`formatSkillsForPrompt`，已在用）、`dist/utils/frontmatter.js:1-24`（`parseFrontmatter`，剥 BOM）。**pi-agent-core 的加载器不剥 BOM**（`dist/harness/skills.js` 的 `parseFrontmatter` 无 `stripBom`）——这是 S14 要薄薄保留的唯一一处。
- **仓库里已有？** 有两份自研、零处 import pi 的加载器：`git grep -n "loadSkills\|loadSourcedSkills\|formatSkillInvocation" electron/` = 0 命中；自研在 `electron/skills/skillStore.ts:127-231`（`discoverSkillRecordsFromRoots`，只认 `root/<dir>/SKILL.md`）与 `electron/agentLane/laneInstalledSkills.mts:29-30`（`basename === 'SKILL.md'` 否则抛）；第三处手抄是 `electron/harness/context/agentContext.ts:175-179`（逐字抄 pi 的 `<skill>` 信封）。判官已经是 pi：`scripts/skills-format-lib.mjs:165-175`（F6 拿 pi-coding-agent 的 `loadSkillsFromDir` 判「别的宿主能不能读」）。
- **生态里已有？** 同一形状三家收敛：Agent Skills 规范 <https://agentskills.io/specification>（`metadata` 是留给客户端的扩展点）、Claude Code <https://code.claude.com/docs/en/skills>（folder + SKILL.md + frontmatter；loose `.md` 也认）、pi-coding-agent 自己的应用层加载 `node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js:308-345`（多根 collision winner=first、按 realpath 去重）与 <https://github.com/badlogic/pi-skills>（把别家目录加进 `skills` 根）。
- **TikHub 自媒体里怎么说？** 未查。理由：这是「框架已提供的 API 该不该自研」的判断（R5④），判据是依赖与生态源码，不是用户行为；用户侧的摩擦已由 2026-09-18 真机复现（`my-skill.md` 在别处能装、在 Nomi 报错）钉死。
- **结论：用已有。** 发现 / 解析 / 信封 / 诊断四样全部换成 pi 的函数；Nomi 只保留 pi 不管的投影与策略（§1「pi 不管的」一行），每一条在 §2 有出处与断言。

## 1. 先查别人：pi 到底给了什么（实读 `node_modules/@earendil-works/*@0.85.1`）

| pi 提供 | 在哪 | 行为 |
|---|---|---|
| `loadSkills(env, dirs, context)` | `pi-agent-core/dist/harness/skills.js` | 递归遍历；目录里有 `SKILL.md` 就当技能根、不再往下走；**根目录下直接的 `.md` 文件带 frontmatter 也算技能**；认 `.gitignore` / `.ignore` / `.fdignore`；跳 `.`/`node_modules`；`Skill = {name, description, content(已去 frontmatter), filePath, disableModelInvocation}` |
| `loadSourcedSkills(env, inputs, mapSkill, context)` | 同上 | 每个输入目录带一个 `source`（形状由应用定），逐条附在 skill 与 diagnostic 上 |
| `SkillDiagnostic` | 同上 | `type: "warning"`，`code ∈ file_info_failed / list_failed / read_failed / parse_failed / invalid_metadata`；**只 warning 不失败**——name 不匹配目录、超长、非 kebab 都只是 warning，技能照常加载；只有 description 缺失才不加载 |
| `formatSkillInvocation(skill, additionalInstructions?)` | 同上 | `<skill name= location=>\nReferences are relative to <dir>.\n\n{content}\n</skill>` + `\n\n{additionalInstructions}`——**第二个参数正是追加指令的口子** |
| `NodeExecutionEnv` | `pi-agent-core/harness/env/nodejs` | 本地磁盘的 `ExecutionEnv`，`laneFileSystem.mts` 已经在用 |
| `formatSkillsForPrompt(skills, 'read'\|'bash')` | `pi-coding-agent/dist/core/skills.js:275` | `<available_skills>` 段，已在用（`laneSkillIndex.mts`） |
| `parseFrontmatter` / `stripFrontmatter` | `pi-coding-agent/dist/utils/frontmatter.js` | pi 自己的 frontmatter 解析（`yaml` 包，**剥 BOM**）；`skillFrontmatter.test.ts` 拿它当对账基准。注意 **pi-agent-core 的 `loadSkills` 自带的 `parseFrontmatter` 不剥 BOM**（实读 `harness/skills.js`）：带 BOM 的文件不以 `---` 开头 → frontmatter 读成空 → description 缺失 → 技能被丢掉。两层之间的这道缝就是 S14 |

**pi 不管的（这些是我们要薄薄保留的理由）**：多根优先级（内置 vs 用户目录）、Nomi 扩展块 `metadata.nomi`、策展块 `metadata.nomi.library`、内容寻址（contentHash）、MCP 受众、Workbench 可选性、包导入/导出/删除、IPC、可信读根的软链纪律、「要不要 coding 工具」。

**约束（决定了架构）**：pi 是 ESM-only；主进程是 CommonJS，只能经 `electron/agentLane/laneNativeLoader.cts` 这座桥用动态 `import()` 摸到岛（`laneDesktopRuntime.ts:102`、`feedbackIpc.ts:63` 都是这么做的）。pi 的加载器是 **async** 的（走 `ExecutionEnv`）。所以：技能目录（catalog）的 owner 搬进岛（`electron/agentLane/laneSkillCatalog.mts`），CJS 侧 `readSkillRecords()` 变成 `Promise`，经桥取；唯一一条同步读技能目录的 IPC（`nomi:skill:list`）改成 `ipcMain.handle`（三条写通道仍是 `invokeSync`，09-03 合同的不变量 ③ 不动）。

## 2. 捞经验：59 条清单

列法：**不变量原文**（从合同 `invariants` / `shared_boundaries.responsibility` 逐字抄，不改写；从 commit / 注释来的标 `[commit]` / `[注释]`）· **出处** · **它当初防的是什么**（从 `symptom` / `class_root` 抄）· **三档判定** · **断言在哪**。

三档：**pi 已覆盖**（指出 pi 哪个函数/行为覆盖）｜**我们薄薄保留**（说明为什么 pi 不管）｜**确已过时**（必须给理由）。断言列写测试文件与用例名；`—` 表示确已过时不需断言。

### 2.1 发现与解析（skillStore / skillFrontmatter）

| # | 不变量原文 | 出处 | 当初防的 | 判定 | 断言 |
|---|---|---|---|---|---|
| S1 | "Discover only direct Skill packages (`root/<dir>/SKILL.md`). Pi's generic loader also accepts loose markdown files and recursively discovers nested roots; that is useful for a generic coding agent but is not Nomi's package contract." [注释] | `skillStore.ts:122-127`（commit `620a74204` 起） | 把发现规则收在一处，各 transport 不各自走盘 | **确已过时**：正是用户撞到的那条——`my-skill.md` 在 pi / Claude Code 能加载、在 Nomi 报错。「不是 Nomi 的包契约」这个理由在 2026-09-07 R31 对齐标准之后已经站不住：判「别的宿主能不能读」的尺子是别的宿主的解析器（S13），那把尺子读得到的技能我们没理由读不到。**但「各 transport 走同一份发现」这一半保留**：仍然只有一个 `discoverSkillRecords`，各 transport 都吃它的 `SkillRecord[]` | `skill-catalog-migration.test.mts › S1 根目录下的 my-skill.md 是技能`；`S1b 三个 transport 同一份发现` |
| S2 | "name and description are read from the frontmatter alone. No code path may reintroduce a second source for either, so the precedence expression that hid the drift cannot be rewritten." | `2026-09-07-skill-manifest-two-owners` | brand-promo 在 Nomi 里一句自我介绍、在别的宿主里另一句 | **pi 已覆盖**：`loadSkillFromFile` 只从 frontmatter 取 `name` / `description`，name 缺时回落目录名（与我们 `frontmatterString(front,"name") \|\| entry.name` 同一规则） | `S2 name/description 只来自 frontmatter，缺 name 回落目录名` |
| S3 | "Every skills/<dir>/SKILL.md frontmatter parses with a real YAML parser, carries a non-empty description of at most 1024 characters, and carries a name that is at most 64 characters, matches ^[a-z0-9]+(-[a-z0-9]+)*$, and equals its directory name." | 同上 | `director-art-design` 的未加引号 `carrier: visual` 我们四条正则读得好好的，pi / Claude Code / Codex 直接丢掉 | **pi 已覆盖**（且更准）：`validateName` / `validateDescription` 就是这几条，违反只发 `invalid_metadata` warning；仓内 88 个内置技能过 `check:skills-format` F6 时本来就是拿 pi 的加载器判的 | `S3 内置 88 个技能经 pi 加载零 diagnostics` |
| S4 | "A metadata.nomi block that exists but fails validation yields manifest=null with an error, which … turns into an empty capability list — a broken manifest grants zero tools, never the full host set." | 同上 | 写坏的扩展块不能变成放开全部工具 | **我们薄薄保留**：pi 不认识 `metadata.nomi`（Agent Skills 规范把 `metadata` 留给客户端），只有我们能校验它 | `S4 坏的 metadata.nomi → manifest=null + manifestError` |
| S5 | "No frontmatter key outside the Agent Skills closed set {name, description, license, compatibility, metadata, allowed-tools} plus the deliberate exception disable-model-invocation. Nomi-specific declarations live under metadata.nomi and nowhere else." | 同上 | 顶层键闭集，多一个别的宿主就报错 | **我们薄薄保留**（门岗层）：这是对**我们自己仓库**的约束，由 `check:skills-format` 守；加载器对外部技能的未知键（ChatCut 的 `user-invocable`）**必须原样放行**（S31）。pi 的加载器不查闭集，与我们的开放原则一致 | 由 `check:skills-format` 已守；`S31` 断言外部未知键放行 |
| S6 | "pi's own loader, run over skills/, returns exactly as many skills as there are SKILL.md files and emits zero diagnostics — the judge of 'can another host read this' is that host's parser, not a rule we wrote." | 同上 | 我们比别人宽松的那一侧永远看不见问题 | **pi 已覆盖**（结构上）：加载器就是 pi 的，「我们能读 ≠ 别人能读」这个缝隙不存在了 | `S3`（同一条断言） |
| S7 | "A Skill package has exactly one manifest: the YAML frontmatter of its SKILL.md. No skill.json may exist anywhere under skills/, in any subdirectory." | 同上 | 两份清单漂移 | **我们薄薄保留**：`skillManifestMigration.ts` 只在用户目录把存量 `skill.json` 折进 frontmatter（standard-formats 登记的债，due 2026-12-07）。pi 不知道那个旧文件 | `skillManifestMigration.test.ts`（已有，改喂岛上目录）；`skill-catalog-migration.test.mts › S7`（用户根迁、内置根一字不动、`legacy_manifest` 诊断带路径） |
| S8 | "Own the one and only parse of a Skill's declarations, at the same strictness as every other Agent Skills host. Both the loader and the package importer call it, so a header that another host would reject cannot be read as valid here." | 同上 `shared_boundaries` | 宽松一侧盲 | **我们薄薄保留 + 钉在 pi 上**：pi 的 `loadSkills` 不把解析好的 frontmatter 对象交出来（只给 name/description/disable），而我们要读 `metadata.nomi` / `library` / `tools:`，且 CJS 侧的导入校验（`validateSkillPackage`，同步 IPC）摸不到 pi。所以本地 `parseSkillFrontmatter` 留下，但**必须与 pi 的 `parseFrontmatter` 逐文件对账**（原来只对账 stripper） | `skillFrontmatter.test.ts › 88 份真 SKILL.md 的 frontmatter 值与 pi parseFrontmatter 深等`（实跑 88/88 深等；唯一刻意差异：没闭合的 `---` 我们报错、pi 当正文——导入侧要一句人话拒收） |
| S9 | [commit `7dcc5a240`] 损坏包（正文含 NUL 等 C0 控制字符）不许「占坑遮蔽」同目录名下一个合法包；记 warning 且不加 seenDirs | `skillStore.ts:181-193` | `{origin:'builtin',description:'Broken'}` 挡掉了 `{origin:'user',description:'Valid'}` | **我们薄薄保留**：pi 的 YAML 解析把 NUL 正文当合法（它不看正文），不会跳过；多根优先级本来就是 Nomi 的事（S10） | `skill-catalog-migration.test.mts › S9`；`skillStore.test.ts › does not let an invalid higher-priority package shadow`（改喂岛上的 `discoverSkillRecords`，断言逐字不变） |
| S10 | [commit `9aec0d384`] 用户目录并入 `getSkillsRoots` 末尾——内置同名优先、外来包无法覆盖内置；[注释] `seenDirs` 用 NFC 小写目录名去重 | `runtimePaths.ts:57-67`、`skillStore.ts:156` | 外来包冒充内置 | **我们薄薄保留**：pi `loadSourcedSkills` 对多个根不做去重（`pi-coding-agent` 自己的 `loadSkills(options)` 做「先到先得 + collision 诊断」，那是它的应用层，不是 `loadSourcedSkills`）。按 pi-coding-agent 同一规则实现：先出现的根赢，输家记一条 `shadowed` 诊断 | `S10 内置遮蔽同名用户技能，输家有诊断`（含大小写/NFC 同名视为同一个）；`S10b` 同一根里 `foo/SKILL.md` 与 `foo.md` 撞句柄先到先得，且 `writeSkillImport` 的冲突避让认得单文件技能的 stem |
| S11 | [注释] `getSkillDiscoveryRoots` 在无 Electron 的 Node 进程（零额度 agent-runtime 套件、MCP node 宿主）里退回 `NOMI_SKILLS_DIR` / cwd / `NOMI_APP_PATH` / resourcesPath 同一批有序根 | `skillStore.ts:55-91` | 「同一批根、同一套优先级」在每个进程一致 | **我们薄薄保留**：根在哪是宿主的事 | `S11 无 Electron 进程 getSkillDiscoveryRoots 仍给出有序根` |
| S12 | [注释] 正文为空的 SKILL.md 跳过 | `skillStore.ts:179-180` | 空包占坑 | **pi 已覆盖**：description 缺失/空 → 不加载；正文空但 frontmatter 全 → pi 加载（content 空串）。取 pi 语义：description 才是准入条件 | `S12 无 description 不加载、正文空但 frontmatter 全照常加载` |
| S13 | [commit `7a072f12d`] "Frontmatter now parses through js-yaml at the same strictness as everyone else" / `JSON_SCHEMA` 不认 YAML 标签、不做日期强转 | `skillFrontmatter.ts:11-17` | 宽松侧盲 | **我们薄薄保留**（同 S8） | 同 S8 |
| S14 | [注释] BOM / CRLF 归一后再判 `---` | `skillFrontmatter.ts:25` | Windows 写的技能读不出 | **我们薄薄保留（env 一层）**：CRLF pi 已归一；BOM pi-agent-core 的加载器**不剥**（pi-coding-agent 自己的加载器剥），实跑证实带 BOM 的 SKILL.md 会因「description 缺失」被丢掉。处置不是再写一份加载器：`BomTolerantExecutionEnv extends NodeExecutionEnv` 只在 `readTextFile` 剥一次 BOM，遍历 / ignore / 解析 / 诊断全部仍是 pi 的（`laneSkillCatalog.mts`） | `skill-catalog-migration.test.mts › S14`（BOM+CRLF 文件加载、content 归一、零诊断）；`skillFrontmatter.test.ts` 边界样本含 BOM |
| S15 | [注释] 策展块（`metadata.nomi.library`）校验失败 → frontmatter 记 error，不当合法包 | `skillFrontmatter.ts:37-41`、`2026-09-08-curated-media-boundary`："Curated intake has one license and applicability schema shared by discovery and imports." | 随应用再分发的内容必须有可再分发许可 | **我们薄薄保留**：pi 不知道策展 | `skillCuration.test.ts`（已有，改喂新加载器） |

### 2.2 记录投影与受众（skillStore 的策略层）

| # | 不变量原文 | 出处 | 当初防的 | 判定 | 断言 |
|---|---|---|---|---|---|
| S16 | "对外暴露是安全边界：isCraftSkill 只对 origin==='builtin'（随安装包分发）的技能可能返回 true；用户导入的技能一律不对外暴露，与目录名（含 director-/writer- 前缀、含白名单 model-integration）无关。" | `2026-09-01-skill-import-standard-formats` | 导入放开后暴露跟着放开 | **我们薄薄保留**：受众是 Nomi 的 MCP 策略（`isSkillVisibleTo` / `isSkillVisibleToMcp`），pi 无此概念 | `skillStore.test.ts › MCP complete skill content`（public 不见 user 技能，已有） |
| S17 | "「读」与「列」用同一把尺子：readSkillContent 与 listSkillSummaries 都过 isCraftSkill，外部 MCP 客户端不能靠报目录名绕过「看不见」去「拿全文」" | 同上 | 列不见却读得到 | **我们薄薄保留** | 同上（`readSkillContentForMcp('public')` 为 null，已有） |
| S18 | "卡片描述回落到 skillStore 已算好的 manifest∥frontmatter 单一真相源，没有 skill.json 的标准技能不再显示「暂无说明」" | 同上；`skillIpc.ts:85-88` | 标准技能卡片「暂无说明」 | **pi 已覆盖 + 我们投影**：description 由 pi 从 frontmatter 读；DTO 只投影它 | `skillIpc.test.ts › projects a loose root .md Skill`；`skill-catalog-migration.test.mts › S1`（DTO 段） |
| S19 | "Imported Skills cannot publish themselves through package metadata." [注释] `audience: root.origin === "user" ? "internal" : manifest.audience` | `skillStore.ts:211-212` | 用户包自己声明 `audience: mcp` 就对外 | **我们薄薄保留** | `S19 用户目录技能声明 audience: mcp 仍是 internal` |
| S20 | "A built-in Skill enters the Workbench picker only when its validated manifest explicitly declares selectableInWorkbench or it is an existing multi-stage playbook; internal routing Skills remain hidden." + "User Skills remain visible even when their optional manifest is missing or invalid, while their manifestError remains observable in the DTO." | `2026-09-04-workbench-skill-picker` | 分镜规划技能在菜单里不见 | **我们薄薄保留**：`isSkillSelectableInWorkbench` 纯函数不动 | `skillStore.test.ts`、`skillIpc.test.ts`（已有） |
| S21 | "Every exposed file belongs to the authorized package and current content hash." / "Authorize package and verify its file-map hash before returning any file." | `2026-09-10-b6-mcp-skill-content` | 外部宿主读到改过的包 | **我们薄薄保留**：内容寻址是 Nomi 的 MCP 契约；pi 不做 hash。`contentHash` 仍由 `computeSkillContentHash(readSkillPackageFiles)` 算，**根 `.md` 技能的包 = 那一个文件** | `skillStore.test.ts › MCP complete skill content`（已有）+ `S21 根 .md 技能的 contentHash 只含它自己` |
| S22 | "签名客户端下，resources/list 暴露的 nomi-skill:// 资源集合，必须与仓内 skills/ 下带 SKILL.md 的目录集合完全相等——期望值从目录 derive，不是手抄的数量下限。" | `2026-09-02-unwired-stale-skill-resource-test` | 手抄下限永远不红 | **pi 已覆盖 + 我们投影**：集合由 pi 发现 derive | `skillCuration.test.ts › 88 records`（已有，改喂新加载器） |
| S23 | [注释] `findSkillRecord`：exact → 前缀 `name.` → 归一化 name/dirName；`normalizeSkillLookupKey` 把 `.` 归成 `-`（持久化数据里的旧点号 key 仍解析得到） | `skillStore.ts:93-101, 225-243`；`builtinSkills.test.ts:131-160` | 改名后旧 key 静默失效 | **我们薄薄保留**：查找是 Nomi 的 key 语义 | `builtinSkills.test.ts`（已有，改喂新加载器） |
| S24 | "Exact identity lookup shared by every read transport. Deliberately does not use findSkillRecord's internal prefix fallback" [注释] | `skillStore.ts:285-295` | 相近前缀的资源被混淆 | **我们薄薄保留** | 已有（MCP content 测试） |
| S25 | "Only a validated built-in preview declaration may resolve to bytes within its real skill directory." | `2026-09-08-curated-media-boundary` | 打包后 preview 解析到 `dist/skills` 外 | **我们薄薄保留**：`resolveSkillPreview` 不动（改为吃 async 目录） | `skillCuration.test.ts`（已有） |
| S26 | "Each declared media identity is projected through the existing guarded skill-preview protocol." / "Full prompt text and curation survive renderer normalization." | `2026-09-09-skill-library-media-projection` | 卡片没封面、描述被截 | **我们薄薄保留**：DTO 投影 | `skillIpc.test.ts`（已有） |
| S27 | "SKILL.md remains the body owner; the library receives a projection, never a second content file." [注释] `getCuratedPrompts` 自己用正则剥 frontmatter | `curatedPrompts.ts:5, 15` | 第二份正文文件 | **pi 已覆盖**（剥 frontmatter）：`Skill.content` 就是去 frontmatter 的正文；`curatedPrompts` 那条正则是仓里**第三份** stripper，删 | `skillCuration.test.ts › discovers 48 Skills and projects 40 effects`（40 条 prompt 无一以 `---` 开头；替换 `content` 后投影跟着变） |

### 2.3 IPC 与写盘

| # | 不变量原文 | 出处 | 当初防的 | 判定 | 断言 |
|---|---|---|---|---|---|
| S28 | "preload 暴露的所有 nomi:skill:* invokeSync 通道在主进程的 registerSkillIpc 里都有对应 registerSyncIpc 注册——check:skill-ipc-coverage 硬零保证。" | `2026-09-03-skill-ipc-missing-handlers` | 三条写通道没注册，UI 静默 | **我们薄薄保留 + 扩**：门岗改成「每条通道两侧协议一致」：`invokeSync ↔ registerSyncIpc`、`ipcRenderer.invoke ↔ ipcMain.handle`，缺一侧或两侧不同协议都红 | `check-skill-ipc-coverage`（改）；`scripts/check-skill-ipc-coverage.node-test.mjs` 六条阳性对照（09-03 事故原形、正反两向协议混用、扫空即红、注释不算数） |
| S29 | "preload skill 对象里不存在用 ipcRenderer.invoke 暴露的 nomi:skill:* 通道——check:skill-ipc-coverage Guard 2 保证。" | 同上 | `res.ok` 对一个 Promise 恒 truthy | **确已过时（这一条的字面）**：pi 的加载器是 async 的，`nomi:skill:list` 必须走 `ipcMain.handle`。它防的那个 bug（协议混用）由 S28 的新判据继续防——不再是「一律 sync」，而是「同一条通道两侧同一种协议」，比原来更准（原来只拦 invoke，不拦「handle 了但 preload 用 sendSync」） | `S28` |
| S30 | "skill 写操作（import/export/delete）全部走 invokeSync（同步），渲染层拿到 {ok, ...} 对象而非 Promise，res.ok 检查有意义。" | 同上 | 同上 | **我们薄薄保留（两条）+ 一条改判**：import / delete 不碰目录，仍 `invokeSync`，渲染层照旧拿 `{ok,…}`；**export 要按句柄在目录里找包**（不再自己走一遍根——两份发现逻辑迟早对同一目录给出不同答案），目录是 async 的，所以它与 list 一起走 `ipcMain.handle`。它防的那个 bug（一侧 Promise 一侧同步值）由 S28 的逐通道判据继续防 | `check-skill-ipc-coverage`（import/delete 两侧 sync、list/export 两侧 async）；`SkillLibraryPanel` 删除前 `await exportPackage` 抓快照 |
| S31 | "An externally authored skill is never rejected for naming a tool this host lacks or for describing a tool wrongly; it is accepted verbatim and corrected at prompt-assembly time." + [commit `db40dfe2f`] 外部技能零拦截 | `2026-09-18-skill-restates-registry-facts` | 拒收是把我们的问题推给用户 | **pi 已覆盖**（加载层）：`SkillDiagnostic` 只 warning 不失败——ChatCut 的 `name: video-gen` ≠ 目录 `chatcut-video-gen`、未知键 `user-invocable`，pi 记 warning 照常加载 | `S31 真实 ChatCut 技能装得进来、有 warning、不报错` |
| S32 | "共享磁盘状态的变更信号发自写盘那一层，不发自某一个调用入口——入口会长出第四个，而漏掉的那一个不会报错" | `2026-09-11-lane-live-skills-snapshot` | Agent 写的技能对渲染层静默 | **我们薄薄保留**：`skillLibraryBroadcast` 不动 | `skillLibraryBroadcast.test.ts`（已有） |
| S33 | [注释] `neededProviders` 在主进程从「真正落盘的那条记录」派生 | `skillIpc.ts:21-27` | 渲染层从工具入参读 = 第二个 owner | **我们薄薄保留（owner 不变、来源改为包本身）**：导入 IPC 仍同步，不能等 async 目录；从刚校验过的包的 SKILL.md frontmatter 派生（同一个 `readSkillManifest` owner）——包就是落盘的那份 | `skill-catalog-migration.test.mts › S33`（`readSkillManifest` → `deriveSkillNeeds`，从包本身派生） |
| S34 | [注释] "The adapter deliberately talks only to the validated package importer and then re-reads the catalog, so an optimistic 'saved' response can never be emitted when the library did not change." | `skillWriteTransportAdapters.ts:130-133` | 乐观回执 | **我们薄薄保留**：重读改成 `await readRecords()` | `skillWriteTransportAdapters.test.ts`（已有，依赖注入改 async） |
| S35 | "Every deviation from the standard carries a reason." / readers 登记 | `2026-09-07-standard-format-not-aligned`、`standard-formats.json › agent-skill` | 自造格式 | **我们薄薄保留**：登记表 readers 加 `laneSkillCatalog.mts`，删不再解析 SKILL.md 的文件 | `check:standard-formats`（门岗） |

### 2.4 lane 索引、可信读根、回合刷新（laneInstalledSkills / laneSkillIndex / laneCodingPaths）

| # | 不变量原文 | 出处 | 当初防的 | 判定 | 断言 |
|---|---|---|---|---|---|
| S36 | [注释] `Installed Skill records require an absolute SKILL.md path.`（否则抛） | `laneInstalledSkills.mts:29-30` | 相对路径进 coding 工具的 operations 插槽 | **一半确已过时、一半 pi 已覆盖**：`basename === 'SKILL.md'` 那一半是本次要消灭的能力缺口（S1）；「绝对路径」那一半 pi 已覆盖——`NodeExecutionEnv.listDir` 出的 `FileInfo.path` 是绝对路径 | `S36 索引里每条 filePath 都是绝对路径`；`S1` |
| S37 | "扫描与校验之间被删掉的技能不是安全事件：它只是不在这一刻的索引里，不许让整条 lane 之后的每个回合都失败" | `2026-09-11-lane-live-skills-snapshot` | 一条 ENOENT 炸整条 lane | **pi 已覆盖**：`read_failed` / `file_info_failed` 只是 warning，加载继续 | `S37 扫描中途删掉的技能只出 warning，其余照常` |
| S38 | "Installed Skill package roots and SKILL.md must not be symbolic links." [注释] + "可信读根的集合是活的，但每个根只 canonicalize 一次…根本身是软链的一律拒，判越界的那一层不依赖上游记得校验" | `laneInstalledSkills.mts:42-44`；`2026-09-11` | 软链根 = 任意可读区 | **我们薄薄保留**：pi 的 `resolveKind` 会**跟着软链走**并把软链目录当技能加载——与我们的可信读根模型相反。目录层 lstat 拒软链根/软链 SKILL.md（记诊断、不加载）；`laneCodingPaths` 那道第二层不动 | `S38 软链的技能目录不进目录、有诊断`；`lane-live-skill-index.test.mts`（已有，第二层） |
| S39 | "Installed Skill path escaped its package." [注释]（realpath(file) 的父目录必须等于 realpath(root)） | `laneInstalledSkills.mts:45-47` | 包内 SKILL.md 是指向包外的软链 | **我们薄薄保留**（同 S38 一并判） | 同 S38（软链 SKILL.md 样本） |
| S40 | "技能索引与 read 允许越出项目的可信根必须来自同一个 owner 的同一次刷新——「模型看得见」与「模型读得到」不许分叉" | `2026-09-11` | 提示词里有、read 却越界 | **我们薄薄保留**：`LaneSkillIndexSource` 留（回合边界策略是 Nomi 的），`entries` / `trustedSkillRoots` / `promptSection` 仍同一次 `refresh()` 产出；根 `.md` 技能的可信根 = 它所在的技能根目录 | `lane-live-skill-index.test.mts`（已有）+ `S40 根 .md 技能看得见就读得到` |
| S41 | "一条 lane 的系统提示词在每个回合边界整体重新求值一次，回合内不变" / "跨多个回合活着的宿主，其装配参数里「会变的事实」必须以来源（函数 / 索引源）传入，不能传快照" | `2026-09-11` | 刚导入的技能要重开项目 | **我们薄薄保留**：`skills` 来源改成 `() => Promise<SkillRecord[]>`（目录本身 async） | `laneDesktopStructure.test.ts`（结构，字面改成 `async () => (await readSkillRecords())…`）+ `lane-live-skill-index`（已有）+ `agentContext.test.ts › resolves the requested skill against a freshly read catalog every time` |
| S42 | "「这条技能要不要 coding 工具」判在准入那一刻，判之前索引必须已经刷到当前回合" + [注释] 两条来源任一即真（盘上 `scripts/bin/hooks` 或 frontmatter `tools:`） | `2026-09-11`；`laneSkillIndex.mts:68-94` | 「模型说要跑 selftest 然后说没工具」 | **我们薄薄保留**：coding 解锁是 Nomi 的工具预算策略；`requiresCodingTools` 在目录层算一次（子目录名 + frontmatter），索引是纯投影 | `lane-skill-index.test.mts`（已有）+ `S42 带 scripts/ 的技能记录 requiresCodingTools=true` |
| S43 | [commit `936e9389d`] 解锁只看**被引用的**技能，不看整个索引 | `laneSkillIndex.mts:133-148` | coding 组永远亮 = 20% 前缀 | **我们薄薄保留** | `lane-skill-index.test.mts`（已有） |
| S44 | [commit `936e9389d`] 进系统提示词的只有 name/description/location；叫模型用 `read`；**不新造 `load_skill` 工具**；`disable-model-invocation` 不进索引；空索引不留空白段 | `laneSkillIndex.mts` 头注释；`lane-skill-index.test.mts` | 每轮为 30KB 技能付费；bash 审批；prompt cache 抖 | **pi 已覆盖**（`formatSkillsForPrompt`，已在用） | `lane-skill-index.test.mts`（已有 8 条） |
| S45 | [注释] "baseDir / sourceInfo 是 pi 的必填项…这里按技能目录如实填，不填 {} 强转。理由是下一个人可能会把这批 Skill 交给 pi 的别的函数（loadSkills 那族真的读 sourceInfo.scope），那时一个撒过谎的字段不会报错" | `laneSkillIndex.mts:96-103` | 撒谎的字段把技能归到错的优先级 | **pi 已覆盖**（这条预言应验了）：`baseDir` = `dirname(filePath)`；`sourceInfo.source` 现在从 `loadSourcedSkills` 的 `source` 来（`builtin` / `user`），不再是常量 `'nomi-skill-library'` | `S45 toPiSkills 的 sourceInfo.source 等于发现来源` |
| S46 | [commit `936e9389d`] 渲染不许手拼 `<available_skills>`（`check:framework-boundary` 的 `own-available-skills-xml`） | `framework-boundaries.json:522` | 转义漏一个 & | **pi 已覆盖** | 门岗（已有） |
| S47 | [commit `936e9389d`] `LaneSkillIndexEntry` 住中立契约层，不住岛上——type-only import 也算「看见」，CJS 工程不许看见岛 | `laneContracts.ts:651`；`agent-runtime-wiring.test.mjs:81` | 岛地漏进 CJS 工程 | **我们薄薄保留**：`SkillRecord` 类型留在 `skillStore.ts`（CJS），岛只 `import type` 它；CJS 侧经 `laneNativeLoader.cts` 桥拿 `readSkillRecords` | `agent-runtime-wiring.test.mjs`（已有） |
| S48 | "Read paths remain inside the project or a trusted installed package after normalization and realpath resolution." / "Unlocking tools never grants permission to execute them." | `2026-09-08-agent-lane-native-tools` | 软链绕过词法包含 | **我们薄薄保留**：`laneCodingPaths` 不动 | `lane-native-paths.test.mts`（已有） |
| S49 | [注释] 指纹含 `contentHash`，记录集没变连 pi 的渲染都不重跑；第一个技能半路进来时才 import 渲染器 | `laneInstalledSkills.mts:92-112` | 每回合付一次 ESM 解析 | **我们薄薄保留** | `lane-live-skill-index.test.mts`（已有） |

### 2.5 选中技能进提示词（agentContext）

| # | 不变量原文 | 出处 | 当初防的 | 判定 | 断言 |
|---|---|---|---|---|---|
| S50 | "进提示词的技能文本只含方法正文，不含 SKILL.md 的 YAML frontmatter" | `2026-09-15-selected-skill-injection` | 82% 注入预算花在元数据上 | **pi 已覆盖**：`Skill.content` 已去 frontmatter；`formatSkillInvocation` 拿的就是它。本地 `skillMarkdownWithoutFrontmatter` 与它的 88 文件 pin 测试删（P1，它存在的唯一理由是 owner 层摸不到 pi） | `S50 选中技能提示词不含 frontmatter（拿盘上真技能）` |
| S51 | "用户为某一轮选中的技能，其正文进提示词时必须带一段交代：这是本轮作业规范、参数要落进工具入参、回复里要看得出被用过" | 同上 | 用户点的技能效果不如不点 | **我们薄薄保留**：交代四句是 Nomi 的；放在 `formatSkillInvocation` 产出之前 | `S51 交代四句在 <skill> 之前`（含 `skill-import-real-use.walk.mjs` 钉的那句 `本轮用户在输入框里挂了一条技能`） |
| S52 | "这两条只由一个函数保证；任何注入点都不得自己拼技能正文" | 同上 | 三扇门各拼一次 | **我们薄薄保留（owner 搬家）**：唯一注入点从 `agentContext.ts` 搬到岛上 `laneSkillPrompt.mts`（因为它要调 pi 的 `formatSkillInvocation`，而 `agentContext.ts` 被 `FORBIDDEN_OWNER_IMPORT` 钉死不许摸 pi）；两个调用点仍只调它 | `S52 门表：拼技能正文的只有一处`（`node scripts/door-map.mjs renderSelectedSkillPrompt`） |
| S53 | [commit `6312949b8`] 信封逐字照 pi 的 `_expandSkillCommand`：`<skill name= location=>` + `References are relative to …` | `agentContext.ts:175-179` | 自造形状 | **pi 已覆盖**：直接用 `formatSkillInvocation`，那三行不再手拼 | `S53 信封逐字等于 formatSkillInvocation(skill)` |
| S54 | "The authoritative tool section is injected after the skill body, and refers to the tool sections by name rather than by direction, so it stays correct if assembly order changes" + [基线] `SKILL_TOOL_AUTHORITY_PLACEMENT` 三臂一行可切 | `2026-09-18`；`agentContext.ts:141-142` | 位置是 A/B 的参数 | **pi 已覆盖（after_body 那一臂）+ 我们薄薄保留（开关）**：`after_body` = `formatSkillInvocation(skill, authority)` 的 `additionalInstructions`；`before_body` = 权威节 + `formatSkillInvocation(skill)`；`omitted` = `formatSkillInvocation(skill)`。常量搬到中立层 `electron/shared/agentLane/skillPromptPlacement.ts`，仍一行可切 | `S54 三臂可达且 after_body 走 additionalInstructions` |
| S55 | "语气是给一份能力清单，不是「你这份技能写错了」" [注释] + `foreignSkillPortability.test.ts` 三条 | `agentContext.ts:150-156` | 外部技能报错而不是映射 | **我们薄薄保留** | `S55 真实 ChatCut 技能的提示词：正文原样、权威节在后、语气是清单`（从 vitest 搬到 agent-runtime） |
| S56 | `FORBIDDEN_OWNER_IMPORT`：`agentContext.ts` 不许 import 任何 `@earendil-works/pi-*` | `agentContext.test.ts:16` | owner 层绑 SDK | **我们薄薄保留**：`agentContext.ts` 只剩身份/语言/合成，继续不摸 pi | `agentContext.test.ts`（已有） |
| S57 | "A successful skill.read ledger event carries only name/version/hash references in persisted state; the next outbound turn re-reads the canonical Skill body and verifies the hash before injection." / "failed hash lookup never presents a loaded Skill body" | `2026-09-02-m3-prompt-pipe-skill-truth` | 陈旧快照当成已加载 | **我们薄薄保留**：`skillReadTransportAdapters` 的 hash 校验不动（`readRecords` 改 async） | `skillReadTransportAdapters.test.ts`（已有） |
| S58 | "Skill content, web-fetched text, external MCP text, and non-cleared project assets are tainted and have untrusted trust." | `2026-09-03-m4-provenance-taint` | 外来正文当成可信 | **不在本层**（provenance 在 promptPipe，本次不碰）；记录以免漏 | — （不属加载层，无改动） |
| S59 | "A declared-but-not-loaded skill is an execution error rather than a fake evidence record" [注释] | `skillExecutionEvidence.ts:37-40` | 用户看到「用了方法论」其实没加载 | **我们薄薄保留**：证据是 Nomi 的产物契约（`loadPlaybookStageEvidence` 改 async） | `skillExecutionEvidence.test.ts`（已有） |

统计（实施后回写）：**pi 已覆盖 16 条**（S2 S3 S6 S12 S18 S22 S27 S31 S36½ S37 S44 S45 S46 S50 S53 S54½；S14 实跑证伪后改判）· **我们薄薄保留 40 条**（含 S14、S30 的两条、S54 的开关）· **确已过时 3 条**（S1 的前半、S29、S36 的前半）· **不在本层 1 条**（S58）。

**断言账本**：59 条里 **55 条有会红的断言**（`skill-catalog-migration.test.mts` 24 条按 S 编号 + 既有 vitest / agent-runtime 套件改喂岛上目录 + 三个门岗：S5 `check:skills-format`、S35 `check:standard-formats`、S46 `check:framework-boundary`）；**4 条没有断言，各有理由**：S58 不在本层（provenance 住 promptPipe，本次一行没碰）；S1 前半 / S29 / S36 前半是「确已过时」——过时项的对偶就是 S1 / S28 / S36 的新断言，没有第二条要写。

### 2.6 没进合同、从 commit / 教训里补的

| # | 经验 | 出处 | 判定 |
|---|---|---|---|
| L1 | 「自造 `skill.json`：标准就摆在那儿，只是没人在动手前去看一眼」——判据：**除了我们的代码，还有没有第二个程序会读写它** | `docs/lessons/self-invented-skill-json-while-the-standard-existed.md` | 本次迁移就是同一条教训的第三次落地：读技能的第二个程序（pi / Claude Code）已经有加载器了，我们不该再有一份 |
| L2 | 「hook 指向的技能可以根本不存在」——文档写了不等于执行体在 | `docs/lessons/hook-pointed-at-a-skill-that-never-existed.md` | 与加载层无关；记录以免漏 |
| L3 | `harness/skillIndex.ts`（`formatNomiSkillIndex`）零生产调用者，是 pi `formatSkillsForPrompt` 的并行版 | 本次数门 | 删（P1） |
| L4 | `framework-boundaries.json › resources` 那一格登记为 debt（due 2026-09-21）：「Nomi 的技能系统目前走自己那条路」 | `framework-boundaries.json:213-218` | 本次还清，改判 `derived` |
| L5 | `check:skills-format` F6 已经在拿 pi-coding-agent 的 `loadSkillsFromDir` 当「别的宿主能不能读」的判官 | `scripts/skills-format-lib.mjs:165-175` | 加载器换成 pi 后，判官与被判的是同一把尺子——这条门岗从「对账」退成「回归」，保留 |

## 3. 架构（迁完长什么样）

```
electron/agentLane/laneSkillCatalog.mts      NEW · 岛 · 技能目录唯一 owner
  discoverSkillRecords(roots)  → pi loadSourcedSkills(BomTolerantExecutionEnv ⊂ NodeExecutionEnv, roots)
                                  mapSkill = Nomi 投影：origin/audience、metadata.nomi、curation、
                                  contentHash、requiresCodingTools、软链拒、控制字符拒、多根去重
  readSkillRecords()           → discoverSkillRecords(getSkillDiscoveryRoots())
  createLaneSkillIndexSource() ← 原 laneInstalledSkills.mts（回合边界策略，瘦身成纯投影）
  toPiSkills / renderLaneSkillSection / laneSkillRequiresCodingTools / laneSkillUnlockReason
                               ← 原 laneSkillIndex.mts
electron/agentLane/laneSkillPrompt.mts       NEW · 岛 · 选中技能 → 提示词（pi formatSkillInvocation）
electron/shared/agentLane/skillPromptPlacement.ts  NEW · 中立层 · SKILL_TOOL_AUTHORITY_PLACEMENT + 权威节正文
electron/agentLane/laneNativeLoader.cts      桥加两个出口：readSkillRecords / renderSelectedSkillPrompt
electron/skills/skillStore.ts                只剩 SkillRecord 类型 + 根 + 策略（受众/可选性/查找/内容寻址）；
                                             readSkillRecords() 经桥、async
删：laneInstalledSkills.mts、laneSkillIndex.mts、harness/skillIndex.ts(+test)、skillFrontmatter.ts 的 stripper、
    skillStore.ts 的目录遍历、agentContext.ts 的 buildSelectedSkillPrompt、curatedPrompts 的正则 stripper、
    foreignSkillPortability.test.ts + __fixtures__ 摘录（断言进 S31/S55，夹具换成逐字拷自 ~/.claude/skills 的完整 ChatCut 技能）
门岗：check:framework-boundary 新增 forbidden `private-skill-directory-walk`（两份旧遍历器的名字回不到岛上；变异验红）
      check:skill-ipc-coverage 改判「每条通道两侧同一种协议」+ node-test
      framework-surface `AgentHarnessOptions.resources`：debt（due 09-21）→ unused（技能走 loadSourcedSkills / formatSkillsForPrompt / formatSkillInvocation 三个 pi 函数，不走 pi-coding-agent 的 Resources 装配面）
```

留下的每个文件为什么不能被 pi 取代：

| 文件 | 为什么留 |
|---|---|
| `skillStore.ts` | `SkillRecord`（Nomi 投影类型，CJS 两侧都要看见）、`getSkillDiscoveryRoots`（根在哪是宿主的事）、受众 / Workbench 可选性 / 查找 key 归一 / MCP 内容寻址——全是 pi 没有的策略 |
| `skillFrontmatter.ts` | pi 不交出解析好的 frontmatter 对象；`metadata.nomi` / 策展 / `tools:` 要读它；CJS 侧同步导入校验摸不到 pi。**钉在 pi 的 `parseFrontmatter` 上**（S8） |
| `skillPackage.ts` | 包导入/导出/删除/内容 hash——pi 不管技能怎么进出用户目录 |
| `skillManifestSchema.ts` / `skillCapability.ts` | `metadata.nomi` 的 zod 校验与能力派生 |
| `skillManifestMigration.ts` | 存量 `skill.json` 一次性迁移（standard-formats 登记的债，due 2026-12-07） |
| `skillIpc.ts` / `skillLibraryBroadcast.ts` / `skillPreview.ts` | IPC、变更广播、封面协议——渲染层投影 |
| `skillExecutionEvidence.ts` | 制作 Run 的产物证据契约 |
| `laneCodingPaths.mts` | 可信读根的第二道闸（不依赖上游记得校验） |

## 4. 不动项 / 回滚 / 验收门

- **不动**：`skills/` 88 个技能一字不改；MCP 协议层（`mcpProtocol.ts`）；渲染层技能库 UI（只改 `listWorkbenchSkills` 成 Promise 的两个 hook）；`laneCodingPaths.mts`；`check:skills-format`。
- **回滚**：单一分支单一提交序列，`git revert` 整段；没有持久化数据格式变化（用户目录里的技能文件不被改写）。
- **验收门**：`pnpm run gates` 全过；`tests/agent-runtime/skill-catalog-migration.test.mts` 覆盖 §2 每条 pi 已覆盖 / 薄薄保留（能力回归两条：`my-skill.md` 与真实 ChatCut 技能）；根因合同 `docs/fixes/2026-09-18-skill-loader-diverges-from-ecosystem.root-cause.json`（recurring，门表由 `node scripts/door-map.mjs` 出）。

## 5. 实施后对账（2026-09-18 晚，恢复被掐断的现场之后）

**那 47 个 WIP 文件**：留 44（原样或小修）、重做 3、丢 0。重做的三处都是 WIP 里能跑但不该留的形状：
① `laneSkillCatalog.mts` 里两处**字面控制字符**（`fingerprint` 的 NUL / U+0001 分隔符、损坏包正则的 C0 区间）——`check:nul-bytes` 会红、`grep` 会静默跳过这个文件（教训 `grep-silently-skips-files-with-nul-bytes`），改成转义；
② `laneDesktopRuntime.ts` 桥函数夹在 import 块中间，挪到 import 之后；
③ WIP 没动的 13 个 vitest 套件（skillStore / skillIpc / skillCuration / builtinSkills / skillFrontmatter / agentContext / localProtocol / officialAgentSkillFixture / skillManifestMigration / builtinPacks / skillDispatcher / laneDesktopStructure / foreignSkillPortability）全部改吃岛上的 `discoverSkillRecords`（vitest 能经 `.mjs` 说明符解析 `.mts`，`canvasReadCapturedSnapshotFlow.test.ts` 已是先例）。
WIP 之外补的：BOM env（S14 实跑证伪「pi 已覆盖」）、`writeSkillImport` 认单文件 stem（S10b）、两条脚本改吃岛（`check-agent-tool-face-usecases.ts` / `agent-tool-face-real-model.mjs`——`readSkillRecords()` 的 CJS 桥要编译产物，源码上跑的门岗吃不到）、`builtinPacks.test.ts` 的 mock 工厂不许 import 岛（岛 import 被 mock 的 skillStore → 模块图互等，实跑挂了 18 分钟）。

**两条能力回归**：
- `my-skill.md`（S1，两条）：迁移前 `discoverSkillRecordsFromRoots` 看不见它、`createLaneInstalledSkills` 对它抛 `Installed Skill records require an absolute SKILL.md path.`；迁移后进目录（句柄 `my-skill`、包根 = 所在技能根）、进 `<available_skills>`、lane 的 `read` 真的读到、`renderSelectedSkillPrompt` 出 pi 信封、MCP 内容寻址与导出都成立。
- 真实 ChatCut 技能（S31 / S55，夹具 `tests/fixtures/skills/chatcut-video-gen/` 与 `~/.claude/skills/chatcut-video-gen` `diff -rq` 零差异）：`name: video-gen` ≠ 目录、未知键 `user-invocable`，pi 只发一条 `invalid_metadata` warning，技能照常加载、`references/` 一并进包；提示词里它点名的 `submit_video` / `track_progress` / `browse_assets` 原样在、权威节在正文之后、语气是能力清单。

**根因合同**：`docs/fixes/2026-09-18-skill-loader-diverges-from-ecosystem.root-cause.json`（recurring，30 扇门由 `node scripts/door-map.mjs readSkillRecords discoverSkillRecords renderSelectedSkillPrompt` 出 + 定义门）。顺手回填了两份同批合同：`skill-restates-registry-facts` 的门表指着已删的 `buildSelectedSkillPrompt`、回归测试指着已删的 `foreignSkillPortability.test.ts`；`shot-envelope-fields…` 的 `scope_paths` 是整目录（`electron/agentLane/` 等），把本次无关改动都算成它的「门没数全」，收窄到它门表里的文件。`check:symptom-cluster` 对 `electron/harness` 报本周第三份合同，结构评审按指示引用既有的 `docs/audit/2026-09-18-electron-unowned-state-structural-review.md`（补记 §8 点名本层，正本是本文档）。

**已知边界（不是债）**：单文件技能的可信读根是它所在的技能根（lane 的 `read` 因而能读同根下的兄弟文件，软链逃逸仍被 canonical 校验拒）；pi 会递归进没有 SKILL.md 的子目录（`root/a/b/SKILL.md` 句柄 `b`），删除只认顶层两种形态——导入不会产出嵌套形态。

