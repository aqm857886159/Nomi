# 结构评审：`electron/agentLane` 与 `electron/skills` 的合同簇说明了什么

> 2026-09-15 · 触发者 `check:symptom-cluster`（R21.2：同一模块 7 天内第三份根因合同 = 先做结构评审）
> 被评审的簇：`electron/agentLane` 13 份（2026-09-09 → 09-15）、`electron/skills` 4 份（同期）
> 本轮的第 N 份合同：[`docs/fixes/2026-09-15-selected-skill-injection.root-cause.json`](../fixes/2026-09-15-selected-skill-injection.root-cause.json)

## 为什么门岗会响，以及它这次响得对不对

R21.2 的假设是：同一层一周内第三份合同，说明**这一层的结构不对**，而不是这一层运气不好。
先验一下这个假设在这个簇上成不成立——把 13 份的 `class_root` 摆在一起看。

| 合同 | 它说缺的那条不变量归谁 |
|---|---|
| `agent-lane-b1-contracts` | 宿主投影没有从既有 owner **派生**模型可见的能力/授权/结果 |
| `agent-lane-context-budget` | lane 装配里「稳定元数据 / 增量任务上下文 / 成本留存 / 读文件授权」四条边界没分开 |
| `agent-lane-models-block` | 每个用户回合必须把目录能力上下文**带过**运行时输入边界 |
| `agent-lane-switch-prefix` | 工具可见性与执行授权被耦合；稳定指引没有稳定的共享 owner |
| `lane-surface-authority` | 审批不得把破坏性动作扩出已消费的 composer 面；schema 住哪不能替代执行期检查 |
| `agent-trace-rebuild-boundary` | 可重建视图必须把隐私决定带在它的权威来源里 |
| `b1c-coding-authority-before-approval` | 前置执行授权判得太晚（判在审批之后的操作里） |
| `agent-error-surface` | 没有边界持有「主进程产生的字符串永不成为用户可见文案」 |
| `agent-generation-second-door` | 模型可见工具面上没有任何一层对「效果」做声明或去重 |
| `lane-live-skills-snapshot` | 装配参数里混着两种寿命（开 lane 那一刻的事实 / 每一刻都可能变的事实），类型系统里两者没区别 |
| `pr720-walkthrough-reds` | 持续成立的判定取了一个只在某一瞬间成立的参照系 |
| `resident-generation-adapter-install` | 「装没装」这份状态没有 owner，有三份 nullable 影子 |
| **`selected-skill-injection`（本轮）** | 「一份外部知识包进提示词」没有 owner；拼装散在调用点上，交代与剥清单两条不变量可以各自缺席 |

## 结论：**这个簇是真的，而且有一个共同形状**

13 份里有 **9 份**（b1-contracts / switch-prefix / models-block / lane-surface-authority /
agent-trace-rebuild-boundary / agent-error-surface / agent-generation-second-door /
lane-live-skills-snapshot / resident-generation-adapter-install / 本轮）说的是同一件事的不同实例：

> **一份要在多个调用点保持一致的事实，没有一个持有它的地方；于是每个调用点各自记得一次，
> 而「忘了」不报错——它只让下游少一条保证。**

`lane-live-skills-snapshot` 的合同自己把这句话写得最清楚：「这一层其实已经知道规则
（注释把『给函数不给快照』写得很清楚），但规则只住在注释里」。本轮完全同构：
带交代文案的实现**就摆在仓库里**（`agentContext.ts:87` 的 `buildSkillSystemPrompt`），
只是零生产调用者——「看起来有」与「跑的时候没有」并存了很久。

另外 3 份（context-budget / b1c-coding-authority / pr720-walkthrough-reds）是不同的病
（边界切得不对 / 时序判得太晚 / 参照系选错），不属于这个形状。

`electron/skills` 那 4 份同理：`skill-library-media-projection`（投影）/ `b6-mcp-skill-content`（内容面）/
`lane-live-skills-snapshot`（寿命）/ 本轮（注入），四份都围着「同一份技能记录被四个读者各自解释一次」。

## 这个结构问题的真正原因不在这一层，而在它的生长方式

`electron/agentLane` 是 2026-09-06 拍板「不修补、重做接 pi 的那层」之后**一个月内长出来**的，
而且是多条 lane 并行长（`docs/plan/2026-09-07-agent-runtime-rebuild.md`）。
并行施工时每个人只看得见自己那条路，于是「这条事实归谁」这种跨路问题**只能在第二个人
碰到同一份事实时才暴露**——那正是合同簇的形状：不是同一个 bug 修了 13 次，
是 13 份事实各自被发现「原来没有家」。

**所以这一族不会靠一次大重构收掉**。能收掉它的是两件已经在做的事：

1. **数门（R21.3）** —— `scripts/door-map.mjs` 把「这份事实有几个入口」变成一条命令。
   本轮它当场报出第三扇（那个零调用者的并行版），而人肉 grep 找不到「有实现但没人调」这种东西。
2. **owner 层必答（`invariant_owner_layer`）** —— 逼每份合同说出「这条不变量从此归谁」。
   13 份里有 9 份的答案是「本次新建了一个 owner」，这正是这一族被逐个收口的过程。

## 给下一份合同的三条前置检查（本轮已照做）

1. **先数门再动生产代码**：`node scripts/door-map.mjs <符号>`。门 ≥2 而没减，必须在
   `door_reduction.why_not` 里写清每扇为什么必须各自存在——本轮 2 扇（singleShot / configure）
   保留，理由是两种运行形态的 systemPrompt 结构不同，合并要先把 singleShot 并进 lane 生命周期。
2. **查「有实现但零调用者」**：`rg '<新 owner 的同类名字>' src electron scripts tests`，
   看是否只有测试引用。本轮正是这么发现 `buildSkillSystemPrompt` 的；
   顺手查到 `composeAgentSystemPrompt` 同为零调用者（本轮未动，已记账在 PR 正文）。
3. **改动前先让新断言红一次**（R17）：本轮四组断言（3 条单测 + 88 条对账 + 2 条门岗规则 + 1 条走查）
   全部做过变异验证。没验过会红的断言，在这一族里等于没加——
   `vacuous-probe-passes-forever` 那条教训就是从这一层出来的。

## 不在本轮解决、但这份评审点名的两件事

- **`electron/agentLane` 缺一份「这一层持有哪些事实」的清单**。今天要知道「某份事实归谁」只能
  逐个读合同。建议：把 13 份合同的 `invariant_owner_layer` 汇成一张表放进
  `docs/ARCHITECTURE-NOW.md` 的 agent lane 段，新合同追加一行。
  这件事本身不该由一条修复 PR 顺手做（它会变成第 14 份合同的附属品），单独排。
- **零调用者的实现没有门岗**。`buildSkillSystemPrompt`（本轮删）与 `composeAgentSystemPrompt`
  （仍在）都是「有实现、有测试、零生产调用者」。这一族在 `electron/agentLane` 至少出现过两次
  （另一次见 `lanePromptSections.ts` 顶部注释：`composeLaneSystemPrompt` 此前零生产调用者，
  通道②③写满了一个字都到不了模型）。**三次同一形状 = 该有个门岗了**，但它要能区分
  「公共 API 故意留给外部」和「内部辅助函数没人调」，判据没想清楚之前不落。记在这里。
