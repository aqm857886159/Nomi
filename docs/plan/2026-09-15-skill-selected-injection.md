# 用户亲手点的那条技能，为什么比模型自己找到的那条弱

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 2026-09-15 · 分支 `feat/agent-skill-real-run-principles-20260915` · 基线 `feat/agent-tool-face-20-verbs-v2-20260914`（PR #797）
> 证据目录 [`docs/evidence/2026-09-15-skill-real-run/`](../evidence/2026-09-15-skill-real-run/prompts.md)

## 用户的摩擦（D1，从他说的话起头）

- 2026-09-10：「skill 不能用」「用了一个电影分镜 skill，但他和我生成出来的东西提示词一看就不对，而且比例不对」。
- 2026-09-14 拍板：「skill 能用」= 选了 skill 后**回复里看得出被用、画幅/提示词跟着变**。

## 机制：同一件事有两条路，用户点的那条弱

Nomi 里「模型用上一条技能」有两条完全不同的路：

| | 模型自己发现 | **用户在 composer 里点** |
|---|---|---|
| 入口 | 系统提示词里的 `<available_skills>` 索引（pi 的 `formatSkillsForPrompt`） | composer 的技能 chip → `skillKey` → `configure` |
| 正文怎么到模型 | 模型自己调 `read_skill`，拿到一个工具结果 | 主进程把 `skill.body` 拼在面板提示词后面 |
| 有没有交代 | 有：工具本身写着 "Read one installed skill's body **so you can follow its method**" | **没有。一个字都没有** |
| 正文含不含 frontmatter | 含（`read_skill` 返回原文——那一侧是对的，外部读者按 Agent Skills 标准期待完整 SKILL.md） | 含（而这一侧是错的：提示词不该吃清单） |

改动前的那一行（`electron/agentLane/laneDesktopRuntime.ts`，singleShot 与 configure **各写了一遍**）：

```ts
systemPrompt: [next.systemPrompt, skill?.body].filter(Boolean).join('\n\n')
```

于是模型看到的是：一段画布工具说明，然后突然一块 `license: Apache-2.0` / `source:` / `preview:`，
再然后一份标题叫「电影分镜」的 markdown。没有任何东西告诉它这是用户**为这一轮点的**、
它规定的参数要落进工具入参、用户要在回复里看得出它被用了。

实测这两条路的差距：题库里 3 句对照（同一句话不挂技能）全都自主读到了**正好对的**那条技能并照做；
而 12 句挂了技能的里有 4 句回复看不出技能被用过。**用户亲手点的那一下，效果不如他什么都不点。**

## 要权衡的那一个东西（D6 ②）

「不注入正文、让模型自己去 `read`」也是一条路，而且是 Anthropic / pi 的标准答案——
索引已经这么做了。但那条路管的是**模型自己发现**；用户**亲手点了**一条技能是另一件事，
让它再自己决定要不要去读，等于把一次明确的用户意图降级成一个建议。

所以两条并存、分工写死：**索引管发现，注入管「用户点了的那一条」**。
代价是后者每一轮都付一次正文的 token——这正是为什么 frontmatter 必须剥掉。

## 数门（R21.3）

`node scripts/door-map.mjs resolveRequestedSkill` → 3 扇读入口：

| 门 | 位置 | 处置 |
|---|---|---|
| singleShot | `electron/agentLane/laneDesktopRuntime.ts:94` | 改为调 owner |
| configure（活着的那条主路） | `electron/agentLane/laneDesktopRuntime.ts:173` | 改为调 owner |
| `buildSkillSystemPrompt` | `electron/harness/context/agentContext.ts:87` | **零生产调用者**。它带着交代文案，而活着的那两扇没有——一份带交代的实现躺在旁边、生产跑的是没交代的那份，正是 P1 的并行版。已删，换成 `buildSelectedSkillPrompt` 这一个 owner |

## 先查别人（R27）

### 池子 ① 框架原生（pi 0.85.1）

- **`stripFrontmatter`**（`node_modules/@earendil-works/pi-coding-agent/dist/utils/frontmatter.js:27`，
  从 `dist/index.d.ts:31` 导出）。pi 自己展开一条**用户显式点的技能**时就是
  `stripFrontmatter(content).trim()`（`dist/core/agent-session.js:994`）。
  **结论：剥 frontmatter 不是 Nomi 的发明，是上游行为，我们此前没走它那条路。**
- **`_expandSkillCommand` 的信封**（`dist/core/agent-session.js:995`）：

  ```
  <skill name="<name>" location="<filePath>">
  References are relative to <baseDir>.

  <stripFrontmatter(body)>
  </skill>
  ```

  **结论：照抄（R31 — 别人已经定了形状就别再造一个）。** 顺带把「技能目录里的相对路径指哪」
  说清楚了，我们自己那版没有。
- **`parseSkillBlock`**（`dist/core/agent-session.js:45`）+ `SkillInvocationMessageComponent`：
  pi 把这个信封放进**用户消息**，并在 TUI 里折叠渲染。
  **结论：有意不同，理由是领域约束** —— Nomi 的面板逐字渲染用户气泡，把 2KB 技能正文放进去，
  用户自己那条消息就变成一大坨；我们没有对应的折叠渲染器（chip 只是它的一半）。
  记为候选后续：等面板能折叠渲染技能块，再把信封从 system 段搬到 user 段，与 pi 完全对齐。
- **没用到的**：`loadSkills` / `DefaultResourceLoader` 的技能发现（我们的技能不都在 pi 的发现根上，
  `laneSkillIndex.mts` 已有裁决）。

**为什么不直接 import pi 的 `stripFrontmatter`**：正文注入的 owner 在
`electron/harness/context/agentContext.ts`，那一层刻意不许依赖任何 `@earendil-works/pi-*`
（`agentContext.test.ts` 的 `FORBIDDEN_OWNER_IMPORT` 把这条钉成断言：它跑在主进程 CJS 侧，pi 是 ESM-only）。
本地等价物 `skillMarkdownWithoutFrontmatter` 用**一条对账测试**钉住不漂：
`electron/skills/skillFrontmatter.test.ts` 拿盘上 88 份真 SKILL.md 逐个比两个实现的输出
（88 条 + 5 个边界形状 + 1 条阳性对照）。pi 升级改了判据，或有人来改我们这份，当场红。

### 池子 ② 生态 npm

- Anthropic Agent Skills 最佳实践（`<available_skills>` 只预载 name + description，正文按需读）——
  `laneSkillIndex.mts` 的注释已经对照过，本次不动那一半。
- 没有引入任何新依赖：需要的两件事（剥 frontmatter、信封形状）pi 都有，照它做。

### 池子 ③ 我们自己

- **`research/skill-trigger-mechanism-20260912` 远端分支（41b9102）** —— T-AG-07 的调研结论，
  **独立地得出了同一个根因**，必须先读再动手：
  - 「触发机制本身与标准一致（description 驱动 + `read` 正文），没坏」；
  - `prior-art.md` §2.3 逐字点出 `laneDesktopRuntime.ts:170-173` 的
    「**把 `skill.body` 原样拼在这一轮的 composer systemPrompt 后面，没有任何框住它的话**」，
    并单独记了一笔「仓库里**有**一份框好的实现（`agentContext.ts:85-107` 的 `buildSkillSystemPrompt`）
    ……零生产调用者」；
  - 它还指出一个与技能无关的真 bug：整片默认画幅到不了画布（§2.6）——
    **本次核实已在基线上修掉了**（`storyboardShotScope.ts:20-40` 的 v6 resolver + `FILM_DEFAULTS`
    登记表 + `check:storyboard-owner`）。用户那句「比例不对」是两件事叠的，那一半归它，
    这一半（技能规定的画幅劝不进入参）归本次。
  - 它记录的一条产品差异：Claude Code 是「加载一次、跨回合常驻」，Nomi 是「一轮有效」
    （`useAgentPanelV4Actions.ts:173` 发送成功即摘，注释写明刻意）。本次**不动**这条。

- `electron/harness/context/agentContext.ts:87` 的 `buildSkillSystemPrompt`（零调用者的交代文案）——
  本次删掉，内容并进新 owner。
- `tests/ux/skill-import-real-use.walk.mjs`：已经验「正文到没到模型」，本次补「交代在不在、清单没进来」。
- `tests/system/agent-tool-face-real-model.mjs`：已有的 R30 真实模型腿，本次改成**题库可换**并接上
  真实技能库与生产身份层，不另写第二个脚本。
- `tests/system/agent-tool-face-usecases.json` + `scripts/check-agent-tool-face-usecases.ts`：
  已有的用例清单门岗，本次把 22 句题库登进去并加「skillKey 必须真装着且可选中」。

## 改了什么

1. `electron/skills/skillFrontmatter.ts`：新增 `skillMarkdownWithoutFrontmatter`（与 pi 对账）。
2. `electron/harness/context/agentContext.ts`：`buildSkillSystemPrompt` → `buildSelectedSkillPrompt`
   （唯一 owner：交代四句 + pi 信封 + 去 frontmatter 的正文）；`NOMI_AGENT_IDENTITY` 末尾加三句出片原则。
3. `electron/agentLane/laneDesktopRuntime.ts`：两扇门都改调 owner。
4. `tests/system/agent-tool-face-real-model.mjs`：题库可换 + 真实技能索引 + 生产身份 + 空项目夹具世界
   + 技能可见证据与做事原则两组判据 + `raw` 基线臂。
5. 门岗与回放：`skillFrontmatter.test.ts`（88 份真技能对账）、`agentContext.test.ts` 三条、
   `skill-import-real-use.walk.mjs` 三条、`check-agent-tool-face-usecases.ts` 两条新规则。

## 不动项

- `read_skill` / MCP `resources/read` 仍返回**原文含 frontmatter**：外部读者按 Agent Skills 标准
  期待一份完整的 SKILL.md（R31），在那里裁掉才是错的。
- `<available_skills>` 索引那条路一个字不改。
- 不改 Agent 面板 UI；不做技能触发机制重设计。
- 「一次只能选一个技能」（T-AG-05）不在本次放开，理由见 `docs/evidence/2026-09-15-skill-real-run/README.md`。

## 验收门

- 真实模型腿前后数字（同一份题库、两条臂）：选了技能那 11 句 `skillVisible` 7/11 → 9/11，三轮一致。
- D05（唯一真的建出镜头的「直接出片」句）：建锚 ✗→✓、连参考边 ✗→✓，三轮一致。
- 零额度：`electron/skills/skillFrontmatter.test.ts`、`electron/harness/context/agentContext.test.ts`、
  `check:agent-tool-face-usecases` 全绿，且四组新断言都验过在改动前会红。
- 真机：`tests/ux/skill-import-real-use.walk.mjs` 绿，截图在证据目录 `shots/`。
