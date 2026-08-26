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

### 2.3 说不清（Phase 2）

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

**风险与边界**：
- 弱模型可能不主动 `load_skill` → 保留「UI 显式指定 skillKey」作为**强制通道**（不是 fallback：它是用户明确选技能时的路径，语义不同）
- `whenToUse` 字段标准里是可选的，我们要在 Phase 2 补齐才好判

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
