# 外部评审：M1–M5 Agent Host 迁移（Codex，2026-09-03）

> 📎 交接/日志 · 状态：📎 已收录 · 评审方：Codex CLI 0.151.0（给了仓库读权限，要求它核实每条陈述而非照单全收）
> 送审提示词全文：本文末尾「附：送审提示词」。早前一版提示词描述的是 M1 阶段状态（分支 `codex/agent-m1-host-lifecycle-r2`、三处门岗红），已过期，本次送审前按当前事实重写。
>
> **为什么留档**：它推翻了编排者当时对外宣称的一条结论，并指出了当天新建的一道门岗的结构缺陷。这两条比"通过"本身有价值。

## 编排者摘要（读这段就够，全文在下）

**最终裁决**：架构方向通过但要求收缩职责；主进程 Authority 保留；Host 全量状态设计需简化；**客户端确认链判为 P0，未解决不能发布**；**「main 已 50/50 毕业」证据不足，不能这样宣称**。

**它纠正的两处事实**（编排者已复核，均成立）：

1. **「50/50 毕业」站不住**。`87bc55c9` 确在 `origin/main` 祖先链上，但 `origin/main` 的毕业清单第 3-18 行**仍写着打包态 `15/50`**；改成 50/50 的那份在分支 `m5/packaged-graduation-c-20260903@7b67877a`，**未合入 main**。而且那次 50/50 测于 #429（误判）与 #436（回滚）之前，对当前 main 已不作数。→ 接受「87bc 上曾有 50/50」，不接受「当前 main 有可复核的毕业证据」。
2. **图里是八个节点不是七个**（用户目标、Task、Context、Loop、Proposal、Policy、Domain、Observation）；排除「用户目标」才是七个系统层。另有 `promptPipe.ts` 自己的七个 prompt section，两个「七层」容易混淆。

**它对当天新建门岗的批评**（成立）：`check-transport-assembly.mjs` **可以在存在安全关键欠账时通过**——`verifyClientGenerationConfirmation` 未接，登记进欠账名单即放绿。结构性修法不是记账，而是**把安全关键依赖改成必填的 `ApprovalAuthority` 对象、禁止 optional callback**；能力确实不存在时返回显式 `unsupported`，不能靠 `undefined` 表达。

**它对「保哪个收益」的判断**：与编排者同选「审批预算集中到主进程」，但**纠正了理由**——根本原因不是「这次 bug 能集中修」，而是**预算与批准本身必须是单一权威不变量**（客户端不能自报已批准 / 模型不能决定实际花费 / renderer 重载不能制造第二次授权 / challenge 必须绑定模型·参数·项目版本·最大费用 / provider 启动前必须验主进程签发的 receipt / 重试不能重复扣预算）。

---

## 评审全文

tokens used
251,496
结论：这次迁移的方向正确，但当前不能称为“毕业”。应保留主进程 Authority，收缩 Host 的职责，并立即把真实客户端确认链和打包态装配统一起来。

更准确地说：

- 抽象方向：合理。
- 当前物理实现：偏重。
- 当前质量结论：不成立。
- 当前发布判断：应阻断真实用户，先做受控内测。

## 先纠正两处事实

1. 严格数图里的节点是八个：用户目标、Task、Context、Loop、Proposal、Policy、Domain、Observation。只有把“用户目标”排除，才是七个系统层。另有 `promptPipe.ts` 自己的七个 prompt section，这两个“七层”容易混淆。

2. 我核对的 `origin/main` 并不能证明打包态 50/50：

   - `87bc55c9` 已经在 `origin/main` 的祖先链上。
   - 但 `origin/main:docs/qa/2026-09-03-m5-graduation-checklist.md:3-18` 仍写着 `agentHostEnabled=false`、打包态 `15/50`，并明确标注 M1 Host 恢复和 M3 真实 Host 未覆盖。
   - “复核后 50/50”的文档在分支 `m5/packaged-graduation-c-20260903` 的 `7b67877a`，并未合入当前 `origin/main`。
   - 当前 `check-transport-assembly.mjs` 虽然退出成功，但明确报告 `verifyClientGenerationConfirmation` 仍是 1 条登记欠账。

所以我接受“87bc 上曾有 50/50 复核”的说法，但不接受“当前 main 已有可复核的 50/50 主线毕业证据”。

## ① 七层抽象是否过度工程

判断：概念正确，物理拆分过重。

这不是普通聊天机器人。Nomi 同时有：

- 可付费的生成动作；
- 多界面操作；
- 项目版本和人工编辑冲突；
- 异步供应商任务；
- 重启后继续；
- 外部 MCP 客户端；
- 需要可解释的批准和收据。

因此“模型不能直接碰内部状态机，必须提出意图，由可信宿主绑定当前项目事实、预算、版本和领域动作”是正确的。这个边界不是理论洁癖，而是付费写操作的基本安全模型。

成熟系统也大致收敛到同一个结构，但没有全部采用 Nomi 这种七层的命名方式：

| 系统 | 实际做法 | 对 Nomi 的启示 |
|---|---|---|
| Claude Code | 官方文档明确有持久 session、resume、permission mode，以及可配置的 permission prompt tool；内部实现细节不是公开源码 | 有“会话 + 权限宿主”，但没有证据表明它拆成 Nomi 这样的多层桌面架构。[官方 CLI 文档](https://docs.anthropic.com/en/docs/claude-code/cli-usage)、[权限文档](https://docs.anthropic.com/en/docs/claude-code/iam) |
| Codex app-server | server 持有 thread/turn，支持 `thread/resume`，并通过 server→client JSON-RPC 请求审批 | 这是最接近 Nomi 的先例：宿主拥有会话和审批，客户端只是展示与响应。[Codex app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) |
| OpenHands | Agent 产生 Action，Runtime 执行并回传 Observation；EventStream 是 append-only 中心事件流，AgentController 驱动状态和循环 | 直接验证了“意图→执行→观察”的结构，但它把这看成事件/控制器/运行时，不一定需要 Nomi 这么多独立层。[OpenHands 架构](https://github.com/AI-App/All-Hands-AI.OpenHands/blob/main/openhands/README.md)、[Events](https://docs.openhands.dev/sdk/arch/events) |
| LangGraph | checkpointer 保存 graph state，`thread_id` 作为恢复游标，`interrupt()` 支持暂停和人工批准 | 证明“可恢复 + 人在环”可以由一个运行时提供，不要求额外的 Electron Host 进程。[Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)、[HITL](https://docs.langchain.com/oss/python/langchain/human-in-the-loop) |

Nomi 的抽象合理之处在于它把“创作领域动作”和“模型推理”分开。过度之处在于：已经把这个正确边界扩展成了一个很大的会话平台。

代码证据：

- `electron/main.ts:438-533` 在首个窗口前安装进程级 Host。
- `projectAgentHost.ts:41-96` 提供持久状态派发和按分区串行化。
- `projectAgentRepository.ts:472-547` 实现 snapshot、backup、ledger、checksum、fsync、CAS。
- `projectAgentExecutionCoordinator.ts:296-356` 已经成为 1800 多行的中心协调器，并持有大量 capability adapter map。
- `promptPipe.ts:207-277` 的上下文编译、预算截断、来源可信度和污染标记是有价值的。
- `projectAgentProjectionStore.ts:125-149` 说明 renderer 对执行状态确实是投影，不再是权威源。

我的判断是：七层应该作为逻辑边界存在，但不应都成为独立的运行时基础设施。对单人项目，建议收敛成四个核心边界：

1. Durable Operation / ProductionRun；
2. Agent Loop + Context Adapter；
3. Main-process Authority；
4. Domain Executor + Renderer Projection。

## ② 主进程 Host 是否划算

判断：主进程 Authority 划算；主进程拥有全部 Agent 会话状态，未必划算。

你指出的两个缺陷确实说明了多进程装配面正在制造一类问题，但根因不是 IPC 延迟，而是：

- `McpTransport` 把安全关键能力声明成 optional；
- 开发态和打包态各自手写 transport object literal；
- 裸 Node launcher 和 Electron GUI 是两个真实运行变体；
- 允许“缺少回调但类型仍然合法”；
- 检查器把 `verifyClientGenerationConfirmation` 作为登记欠账后仍视为通过。

`mcpProtocol.ts:63-80` 是问题的直接证据。  
`mcpGateConfirmation.ts:100-140` 又明确规定：客户端点了同意，不等于取得主进程收据。  
当前代码中：

- `appIntegrationAuthorities.ts:50-94` 已接上 Nomi GUI 兜底确认并铸造收据；
- `mcpNodeLauncher.ts:422-446` 也已接上 GUI 兜底确认；
- 但两条生产装配没有接上 `verifyClientGenerationConfirmation`，所以客户端 attestation 无法转成主进程收据。

因此，缺陷②的准确描述是：

> 客户端确认帧能到，但客户端同意不能完成主进程收据签发。

这反而说明“批准权集中在主进程”是对的。否则客户端同意、应用内确认、预算预留、生成启动之间会出现多个不可证明的权威源。

但当前实现确实把集中式 Authority 和大规模 Host 状态机绑得太紧了。

更轻的做法是：

- 主进程只持有 `Task/Operation/ProductionRun`、预算预留、challenge、receipt、provider job、result ref、nextAction；
- Agent 对话可以由 pi/客户端维护；
- 重启时根据 Operation 和领域事实重新编译上下文，让模型继续工作；
- 只有需要“精确恢复同一个模型轨迹”时，才持久化完整 Agent transcript；
- 把所有 transport 统一通过一个 `createMcpTransport()` 工厂装配；
- 安全关键依赖改为必填的 `ApprovalAuthority` 对象，禁止 optional callback；
- 如果某客户端能力确实不存在，返回显式的 `unsupported`，不能靠 `undefined` 表达。

这样可以保留“可恢复任务”和“预算托管”，但不需要 Host 复制全部聊天状态。

## ③ 三个收益保哪个

我的选择和你的选择一致：保“审批预算集中到 Host”，但理由需要修正。

最根本的理由不是“这次 bug 能集中修”，而是预算和批准本身必须是单一权威不变量：

- 客户端不能自报已批准；
- 模型不能决定实际花费；
- renderer 重载不能制造第二次授权；
- challenge 必须绑定模型、参数、项目版本和最大费用；
- provider 启动前必须验证主进程签发的 receipt；
- 重试不能重复扣预算。

这些都天然属于主进程 Authority。

另外两个收益可以更便宜地拿到：

- “模型只提意图”：用 typed capability/action schema + Domain Authority 即可，不要求 Host 持有完整会话。
- “重启后可继续”：用持久 Operation、状态游标、provider job ID、receipt 和 result ref 即可。恢复时重新编译上下文，语义上继续任务，而不是精确重放模型内部每个 token。

只有当产品要求“模型从中断的那一轮精确恢复”时，完整 Host 会话持久化才值得保留。对 Nomi 当前阶段，这不是最有价值的第一优先级。

所以应保留：

> Main-process Approval Authority + durable Operation。

不必坚持：

> Main-process Host 既是预算中心，又是完整聊天数据库，又是所有执行状态的唯一容器。

## ④ 最该先做什么

判断：质量投入的配比确实错了，但不是门岗本身太重，而是把静态正确误当成产品完成。

当前证据已经很明确：

- Host 默认关闭；
- M3 真实 Host 旅程未覆盖；
- M4 污染标记到 spend 的真实路径未覆盖；
- `check-transport-assembly` 可以在存在安全关键欠账时通过；
- 两个打包/客户端缺陷都只在真人走查中暴露。

因此现在不应继续增加更多静态合同，也不应直接广泛开闸。

正确顺序是：

1. 先补齐 `verifyClientGenerationConfirmation`，并让开发态、打包态、客户端确认、Nomi 兜底共用同一个 `ApprovalAuthority`。
2. 把 transport 从 optional object 改成单一工厂/必填依赖，删除“登记欠账也算绿”的通路。
3. 开启 `agentHostEnabled` 的内部/受控版本，跑真实任务矩阵：主进程重启、renderer reload、应用开/关、客户端确认、Nomi 兜底、重复点击、预算超限、供应商失败、项目版本冲突。
4. 通过后再给极少数真实用户试用，收集真实失败和恢复证据。
5. 暂停继续扩展内部门岗；下一轮投入应明显偏向真实 Electron 旅程和真实客户端，而不是更多静态规则。

最终裁决：

- 架构方向：通过，但要求收缩职责。
- 主进程 Authority：保留。
- 当前 Host 全量状态设计：需要后续简化。
- 当前客户端确认链：P0，未解决前不能发布。
- 当前“main 已 50/50 毕业”：仓库证据不足，不能这样宣称。
- 下一步：先修安全关键确认链，再做受控真人内测；不是继续无期限补门岗，也不是直接广泛开闸。



---

## 附：送审提示词

你是一位资深软件架构评审者。请评审一次**已经落地完成**的架构迁移，给出判断。请用中文回答。不要客气话，我要判断和依据。

你可以读这个仓库的代码来核实我下面的任何陈述——**请核实，别照单全收**。若发现我说错了，直接指出。

## 被评审的东西

Nomi：本地优先 AI 视频创作桌面应用（Electron + React + Zustand + Vercel AI SDK，单人开发）。它有一个 Agent，用户可以说「把这个剧本拆成分镜，然后把前三个镜头生成出来」，Agent 调工具去操作画布、时间轴、生成任务。

重构的根因判定（项目内部原文）：

> Nomi 当前真正缺的不是「再加几个工具」，甚至也不只是「把工具延迟加载」。根因是 Agent 的产品对象还没有被稳定地定义为：围绕一个创作目标，持续读取项目事实、形成可编辑计划、请求必要确认、执行一次可验证的领域动作、观察结果、处理失败并在重启后继续的工作执行器。
>
> 如果 Agent 只是「LLM + 50 个工具」，模型就会被迫选择 Nomi 内部的函数名、状态机步骤和 UI 动作；如果 Agent 只是「聊天 + prompt」，安全、可恢复、付费和版本冲突就会回到隐式约定。

落地的七层：

```
用户目标
 → Nomi Task / Operation（耐久身份）
 → Context Compiler（只取当前需要的事实）
 → Agent Loop（推理、计划、工具批次）
 → Typed Proposal / Action（模型只提出意图）
 → Host Policy（绑定、版本、预算、审批、幂等）
 → Domain Authority（文稿 / 画布 / 时间轴 / ProductionRun）
 → Observation / Receipt
 → Agent 继续、结束、重试或等待用户
```

做法：把 Agent 的会话状态、队列、审批、工具结果的所有权从渲染层搬进 Electron 主进程的一个 Host，渲染层退化成只读投影。分 M1–M5 五个里程碑。

## 当前真实状态（2026-09-03，与早前一版评审稿不同，请以此为准）

- **M1–M5 全部落地并合入 main**。可核实的实物：`electron/projectAgentHost/`、`electron/harness/context/promptPipe.ts`、`docs/qa/2026-09-03-m5-graduation-checklist.md`。
- **五门全绿**。早前评审稿提到的三处红灯（约 24 个 `electron/productionRun/` 高风险文件缺根因合同、语义词表 16 条未登记、i18n 脆弱匹配门）**现在全绿**，可自行跑 `node scripts/check-root-cause-contracts.mjs` 等核实。
- **打包态毕业考通过**：打包应用与开发态跑同一条 MCP L2 全链旅程，**各 50/50 断言通过**，parity 成立（基线 `87bc55c9`）。
- **`agentHostEnabled` 仍为 false**。这一整套东西**至今没有被任何真实用户碰过**。

## 今天（2026-09-03）的两个实证，请把它们当作证据纳入判断

两个真实缺陷，**都不是被门岗发现的，是被真机走查发现的**：

1. **打包态确认门恒拒**：`McpTransport` 用可选成员分发能力，而它有两个生产装配点各自手写对象字面量。打包态那个漏传了 `confirmGenerationInNomi`——漏传是合法 TypeScript，编译期无信号。净效果：外部 AI 请求生成时 Nomi 回「需要人工批准」，但**没有任何确认卡弹出来**。开发态 43/43 全绿，打包态只过 15/43。
2. **客户端确认面整条不可达**：设计是三层（客户端能问→弹在调用方；问不了+应用开着→应用内兜底卡；都不行→如实拒绝）。但两个签发点无条件要求一种**没有任何实现能提供**的凭证，同时验证该凭证的回调在两个生产装配点都没接。净效果：**每次花钱确认都被赶回应用，应用没开就直接拒绝**——哪怕用户已经在客户端里点过同意。这个状态存在了数月，全套单测绿着，因为所有相关单测都给 transport 传了生产不存在的 mock。

补充：修复①的过程中曾误判——把签发点那面旗当作「多余约束」删掉，结果做出**更差**的行为（用户点完同意后生成直接报错，比多点一次更糟），已回滚。

## 我要你回答

**① 这个七层抽象对吗？** 对一个单人维护的本地桌面创作工具，是恰当抽象还是过度工程？请对照你了解的成熟 Agent 系统（Claude Code、Codex、OpenHands、LangGraph 等）**的实际做法**判断，不要照着「理论上应该分层」判断。涉及别的系统时说明依据（读过源码 / 官方文档 / 推测），不确定就标不确定。

**② 主进程 Host 拥有会话状态，划算吗？** 换来「重启可继续」与「模型只提意图、Host 管审批预算」，代价是跨进程 IPC、投影同步、自维护状态机 + 命令账本。**请特别评估**：上面那两个实证是否说明「多进程装配面」本身正在制造一类编译期无信号、只在打包态显形的缺陷；如果是，这笔交换还划算吗？有没有更轻的做法拿到同样的「可恢复 + 可托付预算」？

**③ 三个收益里最该保哪个？**「重启后可继续」／「模型只提意图不碰内部状态机」／「审批预算集中到 Host」。其余两个能不能更便宜地拿到？

（我自己的判断是保「审批预算集中到 Host」，理由是上述缺陷②之所以有一个可辩护的解法，正因为批准权与收据签发是集中的；若散在渲染层，原理上只能一处处打补丁。**请反驳或支持这个判断，别附和。**）

**④ 最该先做什么？** 现在全绿、打包态 parity 成立，但功能关着、没见过真实用户。**两个真实缺陷都是真机走查发现的，不是门岗发现的**——这是否说明当前的质量投入配比错了（门岗过重、真人验证过轻）？下一步该是开闸见用户，还是继续补内部保障？

## 回答要求

- 先给判断，再给依据。别铺垫。
- 别复述我写过的内容。
- 若认为信息不足以下判断，明确说缺什么，别硬答。
- 对我上面任何一条陈述有疑问，去读代码核实后再说。
