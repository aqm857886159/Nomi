# 一条 lane 的「现在」：把装配期快照换成每回合求值

日期：2026-09-11 ｜ 分支：`fix/lane-live-skills-snapshot-20260911` ｜ 承接评审：[docs/audit/2026-09-11-agent-lane-live-vs-snapshot.md](../audit/2026-09-11-agent-lane-live-vs-snapshot.md)

## 用户那一刻卡在哪（D1）

用户在 Agent 面板旁边的技能库里导入一个技能包，回到输入框——技能选择器里它在，**但 Agent 不知道它存在**。
发一句「用刚导入的那个分镜技能」，模型回「我没有这个技能」。要关掉项目再打开，它才出现。

同一个窗口里两步之内发生的事，产品却要求用户重启一次对话——这不是「功能缺失」，是「我明明刚加进去了」。

## 要权衡的那一个东西（D6 ②）

**一条 lane 会跨很多回合活着，它的装配参数里混着两种寿命完全不同的东西**：
「开 lane 那一刻的事实」（项目目录、工具集）和「每一刻都可能变的事实」（界面语言、技能库、项目记忆）。
两者在类型上长得一模一样——都是一个字符串或一个数组——所以谁也拦不住第二种被写成第一种。

真正要权衡的不是「要不要刷新」，而是**「现在」的刷新粒度是每次模型请求还是每个回合**。
本方案选**每个回合一次**：回合是用户能感知的最小原子（他按一次发送），回合内改口反而是 bug
（评审裁决 ③：「正在跑的那一个回合不会中途改口」）。代价是一次回合内的技能库全量重扫（实测 ~25ms），
收益是任何「会变的事实」不必各自发明一条刷新路径。

## 先查别人

1. **依赖里已有？pi 自己也是快照** — `node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js:206`
   `getSkills()` 只返回 `load()` 时读进实例字段的那份缓存；`dist/core/agent-session.js:755` 又把它一次性烘进
   `_baseSystemPromptOptions`。上游给的唯一出路是显式 `reload()`（同文件 `:263`）——**没有「每回合重读」的机制可借**，
   刷新时机只能由宿主决定。渲染那一段仍只用 pi 的 `formatSkillsForPrompt`（`dist/core/skills.d.ts:44`），不自己拼 XML。
2. **仓库里已有？同一份 port 已为另外三个字段解决过** — `electron/agentLane/laneRuntimePort.ts:137`
   `systemPrompt` 2026-09-11 刚放宽成 `string | (() => string)`；`approval.policy`（`:110`）与 `tasks`（`:171`）
   本来就是函数，注释里把「给函数不给快照」写得很清楚。渲染层的变更广播范式也早有两份：
   `src/workbench/skillLibrary/skillLibraryChanged.ts:15` 与 `electron/catalog/validateCandidateCredential.ts:92`。
   **本方案不发明新机制，只把已有的两条纪律铺满。** R29 登记见 `docs/engineering/framework-boundaries.json:513`。
3. **生态里已有？三家都是启动一次** — Claude Code 的技能索引在会话启动时装载、改了要重开会话（https://code.claude.com/docs/en/skills.md ）；
   Agent Skills 标准只规定「启动预载 name+description、正文按需读」，对发现时机与热加载不作规定（https://github.com/agentskills/agentskills ）；
   Codex 的 AGENTS.md 同样启动一次，热加载至今是 open issue（https://github.com/openai/codex/issues/8547 ）。
4. **唯一给出标准解法的是 MCP** — 能力集变化由服务端发 `notifications/tools/list_changed` / `notifications/resources/list_changed`，客户端重查：https://modelcontextprotocol.io/specification/2025-06-18/server/tools
   我们这一层没有「服务端」可发通知（技能库就在同一个进程里），所以取它的等价物：**在每个回合边界重查一次**。
5. **为什么我们要和 Claude Code 不一样？领域约束，不是口味** — 那三家的技能都在编辑器/终端**外面**改文件，「改完重开」符合当时的心智；
   Nomi 的导入入口就在 Agent 面板旁边（`src/workbench/skillLibrary/SkillLibraryPanel.tsx:182`），
   用户是在同一个窗口、两步之内加的技能，重开项目对他等于「刚才那一步没生效」。
   这条差异只影响刷新时机，不影响格式——索引仍是 Agent Skills 标准的 `<available_skills>`、仍由 pi 渲染（R31 无偏差）。
6. **TikHub 自媒体侧**：本条未查。它的用处是「真实用户怎么解决这件事」，而这是一个进程内部的求值时机问题，
   用户侧看不到实现，查了也只会拿回「重启一下」。结论不依赖这一条。
7. **结论：用已有 + 自研一条时机规则** — 用已有的是 pi 的渲染（`dist/core/skills.d.ts:44`）、本仓 port 的
   「给函数不给快照」纪律、以及已有的变更广播范式；自研的只有「每回合求值一次」这条规则本身，因为上游三家都没有它。

## 范围

### 改（三处同一个根因）

| # | 字段 | 现状 | 改成 |
|---|---|---|---|
| A | `native.skills`（技能索引 + 可信读根） | `readSkillRecords()` 在开 workspace 时取一次数组 | port 收 `readonly SkillRecord[] \| (() => readonly SkillRecord[])`；新增 `LaneSkillIndexSource` 作为**唯一 owner**，提示词段与 `read` 的可信根都从它取当前值 |
| B | 系统提示词的求值粒度 | `transform_context` 每**请求**重拼 | 每**回合**（`runId` 变才重算），回合内不变——让评审裁决 ③ 真正成立 |
| C | 项目记忆 `memory` | 开 workspace 时算一次，闭包常量 | 移进 `systemPrompt` 闭包，随 B 的粒度每回合重读 |

### 也改（同族的第二半：AI 写完的技能，用户的选择器也看不见）

| # | 字段 | 现状 | 改成 |
|---|---|---|---|
| D | 渲染层技能列表 | 只有渲染层自己的导入/删除会派发 `nomi-skill-library-changed`；`author_skill` 在主进程写盘，无人通知 | 广播搬到**落盘那一层**（`importSkillPackageToUserDir` / `deleteUserSkill`），经 IPC 到渲染层派发同一个事件；渲染层原来那两处派发同 commit 删除（P1，不留两套） |

### 不动

- owner 划分、审批次序、迁移、回执——评审已裁决不在本轮。
- 工具集（装配期常量，工具由代码拥有）、`projectDir` / `settingsRoot` / watchdog / limits（装配期常量）。
- 模型与供应商 key：已有显式变更路径（每次发送前 `laneIpc` 都调 `configure`，改了就 `configureModel` 重开 lane）。
- 历史消息不重写、正在跑的回合不改口。

## 不做的替代修法（以及为什么）

- **给 lane 加 `refreshSkills()` 逃生口**：把「什么时候求值」换成「谁记得调用」，下一个会变的字段还要再加一条。
- **导入后自动重开 lane**：用户会丢掉正在写的上下文，而他只是加了个技能。
- **每次模型请求都重扫技能库**：一个回合最多 24 次请求，等于把 25ms 乘 24，且违反「回合内不改口」。
- **把技能列表塞进 `composer.systemPrompt` 由渲染层每回合带上来**：技能索引的 owner 是主进程的技能库，
  让渲染层携带等于多一个可能撒谎的来源。

## 验收门

1. 单测：`tests/agent-runtime/lane-live-skill-index.test.mts`（索引源：变了重算 / 没变复用同一份 / 空→非空才起渲染器 / 被删的技能只是不在索引里；可信根跟着索引源走**且已认下的根不许被重新解析**）、
   `electron/agentLane/laneDesktopStructure.test.ts` 与 `electron/skills/skillLibraryBroadcast.test.ts`（结构棘轮，全部做变异验证）。
   既有的 `tests/agent-runtime/lane-native-paths.test.mts`「装配之后被换成软链」必须保持绿——
   「根的集合活」与「已认下的根不许重新解析」两条同时成立，见合同的 invariants。
2. 真机走查：`tests/ux/lane-live-skills.walk.mjs`——会话中导入技能 → 不重开 → 选择器能选到 → 发送后 lane 里看得到技能 chip。
3. `pnpm run gates` 全绿。

## 回滚

四处改动互不依赖，可逐个 revert：A/B/C 在 `electron/agentLane/`，D 在 `electron/skills/` + `electron/preload.ts` + 渲染层订阅点。
port 仍接受数组形式（影子夹具与单发路径在用），所以 A 的回滚不会让调用方编译不过。
