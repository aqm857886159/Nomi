# Agent lane：装配时刻的快照 vs 每回合的现值

状态：已评审；本轮只落一条修复（回复语言铁律改为每回合求值），另一条同类缺口（技能索引）**只登记不顺手修**，见下方「待派」。

范围为 `electron/agentLane`。这是对 2026-09-07 至 09-11 合同簇的结构续审，承接 09-08 切换评审
（`docs/audit/2026-09-08-agent-lane-cutover-structure.md`）、09-09 动态输入评审
（`docs/audit/2026-09-09-agent-lane-input-context-structure.md`）与 09-10 准入次序评审
（`docs/audit/2026-09-10-agent-lane-admission-order.md`）。以下为单一评审者的视角，不代表多位独立审批者。

## 合同簇说明：这一份和前 35 份不是同一类

窗口里 36 份合同（其中 4 份 `change_kind: structural`，属 09-06 重做那条主线；其余 32 份 corrective/recurring）。
逐条读 `class_root` 后，前 35 份可归到 09-10 评审已经点名的那条主线上——**owner 与次序**：
输入捕获/入队/模型选择、窗口与资源生命周期、旧数据迁移、工具身份与权限、写入回执与候选展示，
共同信号是「隔离测试覆盖单个 owner，却漏掉 owner 之间的次序或事实传递」。

本轮新增的第 36 份（`docs/fixes/2026-09-11-pr720-walkthrough-reds.root-cause.json`）**不属于那一类**，
所以不能算「同一个结构缺口第 36 次复发」，但它暴露的是这一层的**第二条**结构线，此前三次评审都没点名：

> **一条 lane 会跨很多回合活着，而它的装配参数里混着两种寿命完全不同的东西——
> 「开 lane 那一刻的事实」和「每一刻都可能变的事实」。类型上它们长得一模一样。**

真机现象：用户在设置里把界面语言切成 English 后，同一个项目里连开新对话，助手仍整段中文，只有冷启动才生效。
机制：`laneDesktopRuntime.ts:139` 把 `buildLanguageRule()` 求值一次、以字符串传进
`openDesktopLaneWorkspace`；`laneHost.mts` 的 `transform_context` 每回合都重拼系统提示词，
但复用的是那个闭包常量。**每回合重拼的钩子已经在了，喂给它的却是一张快照。**

## Owner 与寿命裁决（`OpenLaneOptions` 逐字段）

| 字段 | 寿命 | 现状 | 裁决 |
|---|---|---|---|
| `projectDir` / `laneName` / `sessionId` | 装配期常量 | 字符串 | 正确：换项目 = 换 lane |
| `model` | 会变，但**有显式换档路径** | 字符串结构 + `configureModel()` | 正确：变更走 `owner.configure`，不是靠重读 |
| `approval.policy` | 每次工具调用都可能变 | `policy?(): …`（函数） | 正确，已是函数 |
| `tasks` | 每秒都在变 | `LaneTaskFactsResolver`（函数） | 正确，已是函数，注释里已写明「给函数，不给快照」 |
| `systemPrompt` | **跟界面语言/项目记忆走，会变** | ~~`string`~~ → `string \| (() => string)` | **本轮修复**：`laneHost` 每回合调 `composeSystemPrompt()` 重新求值 |
| `native.skills` | **用户随时可以导入/删技能** | `readSkillRecords()` 的快照（`laneDesktopRuntime.ts:138`），`laneHost.mts:202` 只在开 lane 时渲染一次 | **同类缺口，尚未修**（见「待派」） |
| `tools` / `toolLifecycle` | 装配期常量（工具集由代码拥有） | 数组 / 对象 | 正确 |
| `watchdog` / `limits` | 装配期常量 | 数字 | 正确 |

结论：这一层**已经知道**「会变的给函数」这条规则——`tasks` 的注释把它写得很清楚——
但这条规则只住在注释里，没有任何东西在下一个字段被加进来时逼人回答「它是哪一种寿命」。
`systemPrompt` 和 `native.skills` 就是这么漏过去的：两者都在 `transform_context`
（每回合跑）与 `composeLaneSystemPrompt`（每回合拼）的下游，却都是装配期取的值。

## 裁决

1. **owner 不动。** 缺口不是「谁该拥有这段提示词」，而是「这个值该在什么时候求」。修在
   `laneHost.mts` 的 `composeSystemPrompt()` 上——它是唯一知道「这条 lane 每回合的系统提示词长什么样」的地方，
   同时也是 `transform_context` 的现成调用点，不新增层、不新增缓存、不新增刷新 IPC。
2. **禁止的替代修法**（都会把「什么时候求值」的问题换成别的问题）：加一条「语言变了就重开 lane」的
   IPC、在渲染层每回合把语言塞进 `composer.systemPrompt`、或者给 lane 加一个 `refresh()` 逃生口。
3. **不改变的行为**：正在跑的那一个回合不会中途改口，历史消息不翻译。回合是最小的原子单位。

## 待派（本轮不顺手修，避免把评审做成又一次逐件修补）

- **技能索引同属快照类**：`native.skills` 在开 workspace 时 `readSkillRecords()` 取一次，
  `laneHost.mts:202-205` 据此渲染 `skillSection` 并拼进系统提示词。用户中途导入一个技能包后，
  这条已经开着的 lane 看不见它——现象与语言那条一模一样（要重开项目才生效）。
  修法与本轮同形（改成可求值的来源，在 `composeSystemPrompt()` 里重新渲染），但
  `renderLaneSkillSection` 是 `await` 的，要先决定「每回合 await 一次 ESM 渲染」是否可接受，
  或者把渲染结果按技能集指纹缓存。**须单独派工 + 单独合同**，不塞进本轮。
- **让这条规则可拦人**：`OpenLaneOptions` 每加一个字段，都该被逼着回答「装配期常量 / 每回合求值 /
  有显式变更路径」三选一。现成的位置是 R29 的 framework-surface 逐字段裁决表
  （`docs/engineering/framework-boundaries.json` + `pnpm run check:framework-surface`）——
  它今天只登记框架公开的字段，把我们自己这层 port 的字段也纳进去，加字段即红。
  在它落地之前，本次只留下 `laneDesktopStructure.test.ts` 里那条结构断言（改回快照当场红），
  那是单点棘轮，**不是**这条规则的 owner。

## 结构证据与限制

- 真机走查（`tests/ux/pr720-prompt-language.walk.mjs`）证的仍是 `buildLanguageRule` 两个分支各自写对了：
  中文界面提示词 233 字/最长英文串 0，English 界面回复英文（最长英文串 29）而提示词仍中文 208 字。
  **「中途切换也生效」这一条本轮没有端到端走查**——它需要一条「开 lane → 切语言 → 同 lane 再发一轮」的
  脚本，成本是两轮真实模型调用。当前证据只到结构层（`laneDesktopStructure.test.ts`：port 允许函数、
  `transform_context` 调 `composeSystemPrompt()`、桌面运行时传的是函数，三条都做过变异验证会红）。
  这是本次评审明确承认的证据缺口，不是「已验证」。
- 36 份合同中 4 份是 09-06 重做主线的 `structural` 合同，不能拿它们充当「这一层老在坏」的证据；
  同样也不能用「刚重做完所以正常」解释另外 32 份——那 32 份的共同信号已由 09-10 评审裁决过。
- 本轮未触碰 owner 划分、审批次序、迁移与回执，任何这些方向的改动仍须回到对应的既有评审。
