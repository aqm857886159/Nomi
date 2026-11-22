# 设计卡：助手花钱时「问过人没有」只由主进程生成门一处定

状态：动手前写，2026-11-20 协调核准 ★2 / ★9；2026-11-21 实现后按实测更新（预期变化 7 行 → 9 行、旧收据门岗换成新扫描、改后门数，见文末「协调拍板」8–11）。修复（fix），不是新功能，没有新增交互；★7 写不适用。
类别：四类之「花钱」（谁能签出付费放行的收据）。9 格全填。
来历：地基第 11 组。只读普查找到 9 个判定边界，其中 2 条差异找不到理由：外部「没人答」按 300 秒的传输期限结束，应用内没有期限（U1）；外部确认成功以后结果一直缓存，用过的批准可以不再问人又领一次（U2）。收口方向沿用普查推荐的「扩现有主进程生成门」，不新建模块，不走「删掉客户端确认」那条路（那条要做产品取舍，见文末待协调）。
落位：格子 08-agent、08-mcp、09-agent、09-mcp（创作者旅程图原编号）。交接处只引用、不新造不升格：内置助手路径经过 `docs/engineering/seams.json` 已登记的 `agent-writes-params`；本卡要改的文件都不在任何已登记交接处的前缀里。界面口径按 `docs/design/nomi-design-system.md` §1.0（一个东西一个家；聊天只放指向和必要请示）——这一刀不增删界面元素。

## ★0 先查别人

- MCP 规范 2025-11-25 生命周期·超时（https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle ，本线亲自打开）· 每个请求都应该有期限，期限应能逐请求配置，并且无论如何都要有一个最大期限；到期由发起方发取消通知 · **确认了**：花钱确认那一次请求单独给期限（不改协议层的默认 300 秒，文稿 / 时间线 / 方案确认照旧）；**改了**：不写「无限等」，用 SDK 能接受的最大计时值作上限，实际由客户端取消、连接断开或答复结束。
- MCP 规范 2025-11-25 elicitation·安全（https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation ，本线亲自打开）· 服务端「必须把 elicitation 请求绑到客户端和用户身份」，「不得依赖客户端自报的身份」；accept / decline / cancel 三种答复由服务端各自处理 · **改了**：主进程签客户端收据时，身份取请求头里验过的那个，不再取参数里自报的 `authenticatedClient`；「答的是不是 accept 且 confirm 严格为 true」由主进程自己判，不再只看转述的人说「批了」。cancel 归「拒绝」这一处有意差异保留（已有测试钉住）。
- MCP SDK 的请求计时（`node_modules/@modelcontextprotocol/server/dist/src-Cqbh3MYc.mjs:6341`）· 每个请求必建计时器，时长按调用传入 · **确认了**：逐次传入的期限不用改协议层文件就能透传；计时值受 2^31−1 毫秒上限约束，所以「不设期限」落成这个上限。
- undici 官方文档 Client 选项（https://raw.githubusercontent.com/nodejs/undici/v6.19.8/docs/docs/api/Client.md ，仓库锁定的就是 6.19.8）与源码（`node_modules/undici/lib/dispatcher/client.js:236-237`、`client-h1.js:166-178`）· `headersTimeout` / `bodyTimeout` 默认各 300 秒，传 0 即不设计时器 · **改了**：外部转到「Nomi 兜底卡」的那一跳，今天真正先到点的不是我们自己的 360 秒，而是这个 300 秒；要让它和应用内同规则，这一个方法带自己的 `Agent({ headersTimeout: 0, bodyTimeout: 0 })`（仓库已有依赖、`hardenedFetch.ts` 已有同样用法，不新增依赖）。
- undici README「Undici vs. Fetch」与 `setGlobalDispatcher` 一节（https://github.com/nodejs/undici#readme ）· Node 自带 fetch 只用它内置的那版 undici；新版 undici 的处理器接口变了，靠旧接口兼容层才和自带 fetch 互通——这就是「npm undici 与内置版本不一致时传 dispatcher」的已知坑 · **确认了**：本线用回环探针实测（先装非回环拦截 + 金丝雀）：npm undici 6.19.8 的 Agent 交给自带 fetch，在 Node 22.22.0（内置 6.23.0）、Node 24.13.1（内置 7.18.2）、Nomi Helper 用的 Electron 43 / Node 24.18.1（内置 7.29.0）三处都生效：1 秒头部期限按时报 `UND_ERR_HEADERS_TIMEOUT`，0 则等满 2.5 秒拿到 200。启动器在打包版里固定跑在 Nomi Helper 上（`mcpConfig.ts:200-204`），不吃用户自己装的 Node。
- 本仓 `electron/capabilityCore/rendererBridge.ts:143-156`（2026-09-11 用户拍板）· 等人做决定的请求没有墙钟期限，只在收件的窗口没了时结束；藏在主进程的 60 秒兜底就是「卡还在、却已被替他答否」· **确认了**：U1 的统一方向是外部向应用内看齐，不是应用内加倒计时。
- 本仓 `electron/capabilityCore/appIntegrationAuthorities.ts:37-38` · 挑战的有效期是凭据新鲜度，过期只是这张凭据不能再用，门照样等人 · **确认了**：两边共同的结束规则 = 答复 / 取消 / 问人的那个面没了；过期以后答「是」也签不出收据（两边都由主进程签发时核有效期）。
- 出口：MCP 规范 2025-11-25 生命周期与超时（https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle ）· 卡住的请求由发起方发取消通知结束，用户可以取消或重新发起 · 确认了：外部等人的那一步改成只在答复、客户端取消工具调用、连接断开、Nomi 窗口关掉时结束；取消后迟到的点击不签任何收据，助手重新发起就是一张新卡。

## ★1 用户怎么用

当我在外部助手（或 Nomi 里的助手）让它花钱生成时，我想只在我真的点了「是」以后才花，点过一次的批准只管这一次，并且在项目连接有效期内，不管我是在客户端里点还是在 Nomi 里点，结局都一样。（2026-11-21 用户定「收窄承诺再合」：这次只承诺有效期内点才生成；「等多久回来点都能生成」另开一项，见已知坑 ③。）

步骤：①助手要生成 → ②主进程生成门出一张挑战（这一次放行哪几镜、上限多少）→ ③在客户端弹确认，客户端问不了就落 Nomi 兜底卡 → ④人答复 → ⑤主进程判答复、签收据（只有主进程能签）→ ⑥收据带回 Run 边界验过、用掉 → ⑦生成开始。

不做：不改任何卡的样子和文字；不改应用内面板卡、画布 ↑ 的判定（它们已经走主进程生成门）；不改「要不要问人」的策略判定（已有共享主人）；不删客户端确认（产品取舍，见待协调）；不改收据存储格式。
已知坑：①老版本的启动器进程若在升级时还活着，它签客户端收据时不带「人答了什么」，新主进程会拒签，这一次会落到 Nomi 兜底卡再确认一次；②持有客户端凭证的本机进程若被攻破，仍能伪造「人答了是」——这是现有威胁模型，这次不升级，只把「判答复」从各出口收进主进程；③（2026-11-21 第二轮独立验收实测）助手连上 Nomi 时拿到的项目连接有效期约 5 分钟，**从连上算、不从卡片弹出算**，创作者看不到这个钟。有效期过后再点「生成」：主进程照样签出收据，但生成被连接期限挡下（`lease_expired`，供应商 0 次），卡片关掉、屏幕上没有提示，助手收到「项目连接已过期，请重新选择当前项目」。主分支同一时刻也不会生成（第 5 分钟助手已被告知无人答复；主分支真窗口未实测）。等人路上的几个钟（项目连接、10 分钟信封、5 分钟降档挑战）和过期卡片给创作者看什么，另开一项做完整，过期卡片是可见变化、先出图。

真实任务：
1. 外部助手要生成 3 镜，客户端弹了确认，我离开 6 分钟回来点「是」。今天：第 5 分钟助手已被告知「无人及时答复」，我回来点也没用。改后：确认还在、不再被时钟替答「否」，点「是」签出收据；项目连接还在有效期内就生成这 3 镜，已过期则见已知坑 ③（今天同样不生成）。
2. 外部助手的客户端不支持确认，落到 Nomi 兜底卡，我 5 分半钟后才点「生成」。今天：第 300 秒助手收到「连接中断、可能已执行」，我后来那一下点击只签出一张没人用的收据。改后：点下去签出收据，项目连接有效期内就生成、已过期见已知坑 ③；如果中途助手取消了这次调用，后来的点击不签任何收据。
3. 外部助手把一个制作降到「以后上限内不再逐镜问」，我又调回逐镜确认，几分钟内它再降一次。今天：第二次不问我就生效了（拿的是上一次的批准）。改后：第二次再问我一次。
4. 应用内面板卡、画布 ↑、「直接生成」档、返工确认：结局与今天逐项相同。

指标与量具：
- 能签付费收据的生产文件数：今天 3，目标 1 · 量具：`node scripts/door-map.mjs mintReceipt` + `approvalReceiptRuntime.test.ts` 生产对象运行时反例。
- 判「问过了没有」的位置：今天 6（客户端出口的裸同意分支、成功缓存、兜底卡签发、客户端签发、旧无 Run 路的策略签发、生成门本身），目标 1 · 量具：同上。
- 同一份已用掉的批准被第二次领出的次数：目标 0 · 量具：目标行 U2-1、U2-2、U2-4。
- 外部等人时在挑战过期前被时钟替答「否」的次数：目标 0 · 量具：新合同测试 U1 两行（假时钟）+ 一次真回环 301 秒实测。
- 外部确认在真实用户里多久超时一次：未验证：缺量具（遥测没有这一项，本次不新增采集）。

### ★1b 连带界面

- 外部助手收到的回执：所有字句沿用现有文案（生成门的拒绝 / 无人答复说明、「未开始：请在当前客户端确认这次生成，或在唯一的 Nomi 兜底卡中确认。」、降档的三句），不新增文案；变的只是哪种情况下出现哪句，共 9 个预期变化行，全在外部助手这一侧：D3、U1-1、U1-2、U1-3、U2-1、U2-2、U2-4、U2-3 客户端路、降档晚到（见 ★9）。Nomi 兜底卡、面板卡、画布这三个界面出口同一输入的说法和动作全部不变。
- Nomi 兜底卡、面板卡、画布：不变。
- 「AI 助手连接」卡的使用记账：不变（新增参数不进记账）。

### ★1c 老用户

- 收据文件（`approval-receipts.json`）格式不变；里面已有的挑战最多 10 分钟就过期，升级以后不会被重新用到。
- 成功缓存只在内存里，随连接结束，没有存量。
- 制作 Run 的存档不变：用已发 0.24.0 真实落下的两份旧数据（结果未知的画布镜、中途打断的画布镜）各重放一次，人在 Nomi 里批准仍走同一个主进程签发口。
- 老启动器什么时候会和新应用并存：启动器脚本在应用包里（`app.asar/dist-electron/capabilityCore/mcpNodeLauncher.js`，`mcpConfig.ts:200-208`），随应用一起更新，所以混版只在两种情况出现：①升级那一刻外部客户端已经起着的启动器进程（内存里还是旧代码），到客户端重启这个 MCP 服务为止；②外部客户端配置指向另一份旧安装（比如没删的旧 Nomi.app 路径）。这两种情况下签客户端收据被拒，落到现成的 Nomi 兜底卡确认一次，不新增文案；重启客户端或修好配置以后恢复。退回上一版：新旧主进程都认得旧参数，照常可用。

## ★2 谁说了算

唯一主人：`electron/capabilityCore/runOwnedGenerationGateAuthority.ts`（已有的主进程生成门）。新登记概念 `spend.approval-decision`：「这一次付费放行有没有一次够格的人的答复（或已有的策略决定）、签不签收据、这张批准还能不能领」只由它判；收据的密码学签验仍由 `approvalReceipt.ts` 做（它是签名工具，不做判定）。「要不要问人」仍归已有共享主人 `spendDecisionByPolicy`，「批准对哪几镜有效」仍由挑战绑定 + 本主人的 `assertReceiptMatchesAuthorization` 管，这次都不动。

四个问题 × 出口，今天谁答 → 改后谁答：

| 出口 | 要不要问 | 问过了没有 / 签不签 | 对哪几镜 | 用过作废 |
|---|---|---|---|---|
| 面板卡（内置助手） | 共享策略主人 | 主人（`mainProcessGateApproval`）→ 不变 | 挑战绑定 → 不变 | 收据出生即用掉 → 不变 |
| 画布 ↑ / 「直接生成」档 | 共享策略主人 | 主人 → 不变 | 同上 | 同上 |
| 返工确认 | 必问 | 主人 + 兜底卡签发函数 → 主人 | 同上 | 主人用掉 → 不变 |
| 外部客户端确认 | 必问（降档上限非正数不问） | 客户端出口判、主进程见名字就签、成功缓存、裸同意分支 → 主人判原始答复后签 | 同上 | 缓存永不释放、可再领 → 主人拒发已用掉的批准，缓存删 |
| 外部 Nomi 兜底卡 | 同上 | `appIntegrationAuthorities` 里自己判自己签 → 主人 | 同上 | 可再领 → 主人拒发 |
| 降档「以后上限内不再逐镜问」 | 同上 | 同外部两条 → 主人 | Run 边界绑定 → 不变 | 同一份批准几分钟内可再生效、Run 边界不看降档收据用没用过 → 每次降档一张新挑战，Run 边界拒用掉的降档收据 |
| 旧无 Run 路（生产已不可达） | 共享策略主人 | 派发器自己签 → 主人 | 同上 | 不变 |

第 9 组（重发）只消费、不盖章的只读接口（本卡在主人里实现，主人自己判「用没用掉」也走它）：
`readApprovalDecision(receipts: ApprovalReceiptAuthority, ref: { challengeToken: string } | { receiptToken: string }): { state: 'pending' | 'approved-unused' | 'used' | 'rejected' | 'expired' | 'unknown'; decidedBy?: 'human:gesture' | 'human:elicitation' | 'policy:full_auto'; receiptId?: string }`
——「这一笔有没有够格的答复、是谁答的（Nomi 里点的 / 客户端里答的 / 全自动策略）、还能不能用」只从这里读；`decidedBy` 是收据里已有、被签名覆盖的字段，不是新存的东西。本卡不碰 `productionRunIpc.ts`，不替第 9 组改。实现按此名、此入参落在 `runOwnedGenerationGateAuthority.ts`（合同测试 `approvalOneHomeOwner.test.ts`），提交前不改名。注意：今天主进程不写 `rejected`——人点「不」以后挑战仍是 `pending`（再来一次会再问），`rejected` 只为旧数据保留；伪造令牌、别的收据库签的、空令牌一律 `unknown`；只读，不盖章、不写库。

各出口改后只做投影：客户端出口只选确认面、发确认、把原始答复转给主人、把主人的结论翻成回执；兜底卡、面板卡只把人的点击交给主人；回环这一跳只转话。
门数（`node scripts/door-map.mjs <符号>`，不含测试）：`mintReceipt` 3 扇（`appIntegrationAuthorities.ts` 两处、`generationDispatcher.ts` 一处）→ 1 扇（主人）；`createClientElicitationAttestation`、`createMainProcessGestureAttestation` 1 扇（`appIntegrationAuthorities.ts`）→ 1 扇（主人）；`createPolicyDecisionAttestation` 1 扇（派发器）→ 1 扇（主人）；`issueDecisionReceipt` 1 → 1（主人，不变）；`createConfirmationBinding` 1 → 1；`confirmGenerationInNomi` 13 扇、`verifyClientGenerationGateInMain` 3 扇保留为接线名（只转话，不再签）。判定处 6 → 1。实现后重数，前后原始输出存证据目录。
改后实数（2026-11-21，同一批符号重跑 door-map，不含测试；门数含收据权威里的定义那一扇）：`mintReceipt` 3 → 2（调用方 `appIntegrationAuthorities.ts`、`generationDispatcher.ts` → 只剩主人）；`createClientElicitationAttestation`、`createMainProcessGestureAttestation` 2 → 2（调用方 `appIntegrationAuthorities.ts` → 主人）；`createPolicyDecisionAttestation` 2 → 2（调用方派发器 → 主人）；`issueDecisionReceipt` 2 → 2（主人，不变）；`confirmGenerationInNomi` 13 → 13、`verifyClientGenerationGateInMain` 3 → 3、`createConfirmationBinding` 1 → 1、`createLoopbackGenerationConfirmation` 3 → 3（接线不变）；主人的新接口 `createGenerationGateAnswers` 1 扇（`appIntegrationAuthorities.ts` 接线）、`approveGateByPolicy` 1 扇（派发器）、`readApprovalDecision` 1 扇（主人自用）；Run 边界核降档收据读收据库的 `readDecisionRecord`（同一概念登记过的只读口；Run 边界文件在渲染层的类型依赖图里，引主人会把能力层整张图拖进渲染层可达范围，`check:boundaries` 拦，2026-11-21 第一次 `gates:contracts` 抓到后改）。能签付费收据的生产文件 3 → 1。

删了什么 / 为什么能删 / 现有调用方怎么过：

| 删掉 | 为什么能删 | 调用方怎么过 |
|---|---|---|
| 兜底卡签发函数体（判答复、签收据） | 搬进主人，同一段判定只留一处 | `appIntegrationAuthorities` 只接线；返工确认、rpcServer 拿到的仍是同名函数 |
| 客户端签发函数体（见名字就签） | 搬进主人，并改成验答复 + 验请求头身份 + 验未用掉 | rpcServer 把请求头验过的身份和原始答复交给主人 |
| 成功缓存（确认成功后永久保留、`release`、`isConfirmed`） | 生产从没接 `release`；主人改为拒发已用掉的批准后，缓存只剩「让同一张卡被重领」这一个作用 | 并发去重保留（同一挑战同时只弹一张卡），结束即摘 |
| 裸同意分支（没有客户端验证器时，挑战没要求客户端证明就算批准） | 生产三个挑战来源全都带 `clientAttestation: true`，三处装配全都接了验证器，这条分支在生产走不到 | 没有调用方；基线登记里那一条同提交删 |
| 两个布尔分支（客户端验证器 / Nomi 兜底只回一个 `true` 也算批准，没有收据） | 三处装配走的都是回环，回的都是带收据的对象，这两个分支在生产走不到；协调 2026-11-21 批删 | 不是对象就一律算没批准；4 处测试替身从 `true` 改成带收据的对象；协议层类型声明在热点 `mcpProtocol.ts`，不碰 |
| 派发器里的策略签发（旧无 Run 路） | 签发口收进主人 | 协调已批：改调主人的策略签发，行为与测试不变；整段删另记待办 |
| 旧门岗 `check:spend-receipt`（`scripts/check-spend-confirmation-receipt.mjs` + 基线 `scripts/spend-confirmation-receipt-baseline.json`） | 它只扫 `mcpGateConfirmation.ts` 一个文件里字面的 `confirmed: true`；上面两行删掉以后那个文件不再自己写结论，旧门岗无物可扫、必红 | 新扫描 `findApprovalDecisionBypass` 接手，范围从一个文件扩到 `src` / `electron` 全部生产文件；推送前经 `SCAN_GUARDS` 跑（触发面是旧门岗 3 个固定文件的超集），CI 经 `check:concept-owners` 跑；协调 2026-11-21 代批，复盘 `docs/engineering/direction-checks/2026-11-21-spend-receipt-gate-replaced.md` |

不碰（有理由）：面板卡交接（`appIntegrationSpendConfirm`）与画布交接（`canvasShotHandover`）——它们只把主进程自己看到的事实交给主人的 `mainProcessGateApproval`，已经是一个家，且和第 9 组撞文件；通用工具审批（agentLane 两处）——它管编辑 / 脚本 / 提问，不签花钱收据，是另一个概念；`spendDecisionByPolicy`——已有共享主人；`spendConfirmGrant`（拆解的批量令牌）——另一条付费链，不是助手生成；协议层与三处装配文件（`mcpProtocol.ts`、`mcpNodeLauncher.ts`、`mcpStdioServer.ts`、`mcpHttpServer.ts`）、`appIntegration.ts`、`check-concept-owners.mjs`、`check-spend-confirmation-receipt.mjs`——热点，全部绕开（信号与期限走回环一跳内部，见 ★3）。Run 边界的收据核对（`productionRunApprovalReceipt.ts`，非热点）只动降档那一处：降档收据只由客户端 / 兜底卡签出、从不「出生即用掉」，所以拒用掉的降档收据不挡任何现有路；付费门收据不加这条（画布那张收据出生即用掉，崩溃重试要拿回它），付费门的「只花一次」由门的状态保证：门一旦批过，再交同一张收据只走「重复决定」、不再放行任何东西。

### 要改的文件清单

| 文件 | 改什么 |
|---|---|
| `electron/capabilityCore/runOwnedGenerationGateAuthority.ts` | 新增主人的三个答复入口：兜底卡答复、客户端答复、策略签发；判「已用掉」；依赖注入（不引 electron） |
| `electron/capabilityCore/appIntegrationAuthorities.ts` | 删两段函数体，只剩接线 |
| `electron/capabilityCore/rpcServer.ts` | 兜底卡方法把请求取消信号交给主人；客户端方法改用请求头验过的身份、带原始答复 |
| `electron/capabilityCore/mcpLoopbackRpcCall.ts` | 转原始答复；取消信号透传；等人的方法不设传输期限 |
| `electron/capabilityCore/mcpGateConfirmation.ts` | 删裸同意分支；结论从主人的结果投影；花钱确认的等人期限 |
| `electron/capabilityCore/mcpConfirmationBinding.ts` | 删成功缓存，只留并发去重 |
| `electron/capabilityCore/mcpElicitation.ts` | 确认可逐次给期限；带回原始答复 |
| `electron/capabilityCore/approvalReceipt.ts` | 只加只读查询的一行包装 `readDecisionRecord`（判档在下一行的新文件），状态类型改为导出，存储不变 |
| `electron/capabilityCore/approvalReceiptDecision.ts`（新） | 只读判档（挑战是待答 / 已批未用 / 已用掉 / 拒 / 过期 / 不认识；收据用没用过）与两个类型，从收据库文件拆出——收据库原本 795 行，放进去超 800 行体积门岗；只 type-only 引收据库，不成环；文件名落在已有领域目录 `electron/capabilityCore/approvalReceipt*` 里（`check:self-written`） |
| `electron/capabilityCore/productionTrustGrantChallenge.ts` | 挑战键带上 Run 当前版本（每个 Run 事件都让版本加一，`productionRunRepository.ts:657`），再次降档拿新挑战 |
| `electron/productionRun/productionRunApprovalReceipt.ts` | `verifyTrustGrant` 拒已用掉的降档收据（付费门不动）；读手里收据库的 `readDecisionRecord`，不 import 主人（渲染层可达边界） |
| `scripts/vocabularies-baseline.json` | 登记新词表 `ApprovalDecisionRecord.state`（和挑战库内部状态不同层，写明理由） |
| `electron/capabilityCore/generationDispatcher.ts` | 策略签发改调主人 |
| `scripts/check-spend-confirmation-receipt.mjs`、`scripts/spend-confirmation-receipt-baseline.json` | 删（旧门岗与基线，见上表；协调 2026-11-21 代批） |
| `scripts/pre-push-gate-inputs.mjs`、`scripts/pre-push-contracts.mjs`、`scripts/pre-push-structure.node-test.mjs` | 摘掉旧门岗的推送前登记与结构测试行 |
| `docs/fixes/2026-09-03-client-confirm-needs-a-real-receipt.root-cause.json` | 根因合同改指新扫描；范围补上接线文件与 Run 边界文件、回归测试补上 `approvalOneHome.test.ts` |
| `docs/engineering/direction-checks/2026-11-21-spend-receipt-gate-replaced.md`（新） | 换门岗的方向检查（命中自写登记 `gate-family`） |
| `scripts/concept-owners-approval.mjs`（新）+ `scripts/concept-owners-approval.node-test.mjs`（新） | 新扫描 `findApprovalDecisionBypass` 放独立文件（`concept-owners-scan.mjs` 已 676 行，不往里加）；测试含五种绕法正反例与真源码零命中 |
| `package.json` | 只在现有 `check:concept-owners` 命令的 `node --test` 后面多列这一个测试文件，不新增命令；删 `check:spend-receipt` 命令及它在 `gates:contracts` 里的一项；该命令在 `gates:contracts` 里，CI 的 Contracts 作业每个 PR 必跑（`tests/system/profiles.mjs:14`） |
| `scripts/pre-push-scan-guards.mjs` | SCAN_GUARDS 登记新测试（根 `src`、`electron`，触发文件含新扫描文件） |
| `docs/engineering/concept-owners/spend.approval-decision.json` | 新概念登记（写口在主人与收据权威；五个签发方法按 reference 禁令登记，登记外文件一碰 `check:concept-owners` 就红） |
| 测试：新增 `electron/capabilityCore/approvalOneHome.test.ts`（目标行 + 对拍表，只走两边都存在的入口）与 `electron/capabilityCore/approvalOneHomeOwner.test.ts`（主人新入口的合同）；改 `mcpSpendConcurrency`、`mcpGenerationConfirmation`、`mcpSemanticGenerationConfirmation`、`mcpGateEnvelopeTamper`、`mcpHttpServer`、`unknownPriceGateProjection`（测试替身从 `true` 改成带收据的对象，或改走主人） | |

## ★3 一致与复用

- 以前定过：等人决定没有墙钟期限（2026-09-11）；外部客户端不该被逼回 Nomi 点确认（2026-09-10）；裸同意分支是 2026-09-03 的兼容口，当时没接验证器（现在三处都接了）；收据只在主进程铸（同一份收据权威，同一把密钥）；全自动档由宿主按策略决门（2026-09-21）。都还算数，本卡全部沿用。
- 三条路：沿原方向修（各出口各补一刀：给缓存接 `release`、给客户端签发加一个判断）——判定仍散在 6 处，下一个出口照样会漏；换做法（收进主进程现有生成门，选这条）；删掉客户端确认（统一走 Nomi 卡，少一条信任路，但删了已承诺的能力，交产品取舍）。
- 复用：现有收据权威、现有挑战绑定、现有回执文案、现有并发去重、现有概念扫描与它的推送前守卫。热点文件一个不碰：取消信号用协议层已有的请求信号键挂在参数上透传，期限按方法名在回环一跳内部决定。
- 不新增 ESLint 规则：同一条「谁能签」只留一个守卫；扫描能覆盖成员访问、字符串键、解构、`Reflect.get`、赋值与展开覆盖，ESLint 的受限属性规则盖不全这几种。

## ★4 全状态（界面逐态不变；下面是外部回执）

- 等待中：客户端弹确认 / Nomi 兜底卡在屏幕上，助手的这次调用挂着；不再在 300 秒时被替答「否」。
- 成功：签出收据；项目连接有效期内生成开始、回执同今天，已过期回「项目连接已过期，请重新选择当前项目」（已知坑 ③）。
- 拒绝（decline、cancel、accept 但 confirm 不为 true）：现有「用户拒绝」终态说明，不再催确认。
- 没人答（协议出错、连接断开）：现有「无人及时答复」终态说明（原因码不变）。
- 取消中：客户端取消工具调用 → 等待结束；Nomi 卡若还在屏幕上，之后点它不签收据。
- 过期：挑战过期后答「是」→ 主进程签不出收据，回执同今天（报错，不说批准了）。降档挑战按收据权威默认 5 分钟过期（本卡不改）：人第 300 秒以后才在客户端点「是」，今天是第 300 秒先回「确认超时、没有人答复」，改后是主进程报「挑战已过期」（和今天 Nomi 兜底卡晚点时同一句报错）——两种结局都不生效、不签收据、不花钱（预期变化第 9 行）。
- 拒绝不落库：人点「不」以后挑战仍是等人（今天主进程不写「拒绝」档），助手再来一次会再问一次。
- 已用掉的批准再拿来确认：不再问人、不签（生产里挑战来源不会再交出用掉的挑战，这是主人自己的底线），回现有「未开始：请在当前客户端确认这次生成，或在唯一的 Nomi 兜底卡中确认。」；降档回现有「未生效：你没有批准…」。
- 能力不可用（客户端问不了且 Nomi 没开）：现有「未开始 / 未生效：没能向你征求确认」，下一步：打开 Nomi 后让助手重试。

## 5 中途表

| 状态 | 停止 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 客户端在问 | 等待结束 · 不扣 · 回执说取消 | 不影响客户端 · 不扣 · 等答复 | 本机回环，不涉及外网 · 不扣 | 连接断开即结束 · 不扣 · 助手重发是新卡 | 同一挑战只弹一张（并发去重保留）· 不扣 |
| Nomi 兜底卡在屏幕上 | 等待结束，之后点卡不签 · 不扣 · 回执说取消 | 卡没了即结束 · 不扣 · 回执说没被确认 | 同上 | 同上 | 卡回一次答复后关闭 · 只签一次 |
| 已签未用 | 收据过期即作废 · 不扣 | 同 | 同 | 收据在文件里，按原有期限 | 再确认同一挑战：再问一次人（客户端路今天靠缓存不问，见 U2-3），答是拿回同一张未用的收据 · 只扣一次；降档若中间 Run 版本前进，再确认是新挑战、新签一张，旧的没人用、到期作废 |
| 已用掉 | 不涉及 | 不涉及 | 不涉及 | 不涉及 | 再确认：不签 · 不扣 |

补：外部走本机 HTTP 时，宿主若不发 DELETE 就丢掉连接，等人的那次调用一直挂到这条会话被关（宿主发 DELETE、Nomi 服务停）或被挤掉（同时最多 32 条会话，超出关最久没动静的那条，`mcpHttpServer.ts`）；挂着期间不签、不扣，之后点 Nomi 卡也不签。stdio 断开即结束。

## 6 外部数据与失败

- 客户端的 elicitation 答复（规范链接见 ★0）：只认 accept 且 `confirm === true`；其余一律不批准。偏差：cancel 当作拒绝（有意，测试钉住）。
- 客户端身份：只认请求头里验过的那个，参数里自报的身份不再作数。
- 本机回环连接的默认超时（undici 300 秒）：等人的那个方法单独设为不超时，其余方法照旧。失败时外部助手看到的仍是现有回执，不说「你的 key 有问题」。

## ★7 性能

不适用：没有新增用户操作；主进程每次签客户端 / 兜底卡收据多读一次已在内存里的收据文件状态。

## 8 真实条件

- 真窗口：`verify-nomi` 共享驱动起 Nomi（`--vendor fake-apimart`，带网络守卫），走 Nomi 兜底卡、面板卡、画布 ↑ 各一遍，截图中英各一套，自己逐张看。
- 外部真宿主（真 Codex / Claude 客户端长时间不答）：unverified，本机只用回环假客户端走协议。
- Windows、最小窗口、真付费：unverified / 不涉及（不改界面，不花钱）。

## 拍板图清单

不适用：不改任何界面元素、布局、文案。

## ★9 验收与回滚

验收线（另一条线）只核下面这张清单；实现线按它自验，附「反例 → 结果 → 证据」表。命令：`pnpm exec vitest run electron/capabilityCore/approvalOneHome.test.ts electron/capabilityCore/approvalOneHomeOwner.test.ts` 及改动的测试、`pnpm run check:concept-owners`（含新扫描测试）、`pnpm run gates:contracts`。

测试怎么放：目标行和对拍表放在 `approvalOneHome.test.ts`，只走主分支和本提交都存在的入口（rpcServer 的两个回环方法、`createDefaultAuthorities`、客户端确认工厂、降档拦截、Run 服务的 `set_trust`），所以在主分支上红必须是断言失败，不能是缺符号；主人新入口的合同单独放 `approvalOneHomeOwner.test.ts`，不参与「主分支上红」的判据。某个入口签名非改不可时，两边各写一层同名适配，适配层差异存进证据目录。

判据（两个没做成的版本都要红，靠每条目标行都有正反两半）：
- 「什么都不做」= 当前主分支：每条目标行的反半边红（该拒的放了、该等的结束了）。
- 「全部拦下」= 主人所有签发口一律不签（兜底卡答复、客户端答复、策略签发、`mainProcessGateApproval` 都回未批准或抛错）：每条目标行的正半边红（人答了是，那一镜照样发不出），正常面各行也红。
两个版本的改动各存一份差异文件和一份测试日志。

目标行（每行「反半边 / 正半边」，写在同一个测试里）：
- D3 只带挑战和客户端名字、没有人的答复就来要收据：不签 / 同一挑战带上 accept + confirm=true：签。今天反半边红。
- U1-1（= D7）客户端在问，第 301 秒有人点是：签出收据（不再被时钟替答否）/ 第 301 秒点否：不签、回拒绝说明。今天第 300 秒已结束，正半边红。生成要在项目连接有效期内才开始：本行单测的连接是桩、不经过期限；真窗口 240 秒点生成 → 供应商 1 次，301 秒点生成 → `lease_expired`、供应商 0 次，是已知坑 ③ 的边界，不算本行不过（2026-11-21 用户定「收窄承诺再合」）。
- U1-2 落 Nomi 兜底卡，第 361 秒（越过 360 秒传输期限）点生成：签出收据 / 第 361 秒点忽略：不签。今天正半边红。单测用假时钟；另在本机跑一次真回环 301 秒实测，证 undici 的 300 秒也不再截断（日志进证据目录，不进 CI）。
- U1-3 等待中客户端取消工具调用，之后点 Nomi 卡：不签 / 不取消、点生成：签。今天反半边红（签出孤儿收据）。
- U2-1（= D10）挑战已批、收据已被用掉，再拿它来确认：不问人（Nomi 卡弹 0 次）、不签 / 同一个 Run 下一次的新挑战：照常问、答是就签。今天反半边红（问了以后领出旧收据；客户端路连问都不问）。说明：生产里三个挑战来源都不会再交出用掉的挑战（生成门要求门仍在等、降档键带 Run 版本、返工每次是新门），三个来源各有一行测试钉住「每次新挑战」；这一行守的是主人自己。「客户端先问了人、到主进程才被拒」因此在生产走不到。
- U2-2 降档 → 调回 → 几分钟内再降档：第二次问人一次 / 答是：新收据生效；答否：不生效。今天反半边红（第二次不问就生效）。
- U2-4 已用掉的降档收据再交给 `set_trust`（调回之后再降）：拒，回现有「未生效」说明 / 新签的降档收据：生效。今天反半边红。
- D11 没有客户端验证器、挑战不要求客户端证明：不再算批准；验证器只回一个 `true`（没有收据）：不再算批准 / 有验证器且人答是：主进程签出收据，批准。生产走不到。
- U2-3 客户端路（2026-11-21 从不变行挪来）已批未用的挑战再确认：再问一次人，主进程交回同一张收据，不多签 / 今天靠缓存不问人就放行。应用内那一半仍是不变行。
- 降档晚到（预期变化第 9 行，2026-11-21 协调定）：人第 301 秒才在客户端点「是」→ 主进程报「挑战已过期」，不签、不生效（今天第 300 秒回「确认超时」，反半边红）/ 5 分钟内（第 200 秒）点「是」→ 签出降档收据（全部拦下时正半边红）。两种结局都不生效、不花钱；不改降档挑战的有效期，另记待办「降档挑战有效期是否跟随等人不设期限」。

不变行（对拍：主分支和本提交同一输入同一结论、同一回执文字）：
- D1 「直接生成」档、Run 在计划内无刹车：内置照旧由策略代答签发；外部照旧问人。
- D2 要问人、Nomi 没开、客户端能问：回执同今天，不说已开始。
- D4 普通生成不给「本会话以后都允许」；降档上限非正数不弹。
- D5 按路分开钉：客户端 cancel 与 decline → 拒绝；应用内面板卡点忽略 → 拒绝；外部走 Nomi 兜底卡点忽略 → 回执是今天那句「请在当前客户端确认……」（回环把「忽略」丢了，见待协调 5②，本卡不改，对拍钉住现状）。
- D6 accept 但 confirm=false：拒绝，不落 Nomi 再问。
- D8 停止信号在等答时到：客户端路抛取消、通用路回 cancelled，都不产批准。
- D9 全部未知价：照样弹，说事后才知道，不印 0。
- D12 elicitation 遇到对端内部错误：归「无人及时答复」，原因码不变。
- U2-3 应用内：已批未用的收据（连接断了没花掉）再确认：照旧再弹卡，拿回同一张，不多签。
- 正常面：面板卡批一次、画布 ↑、画布 ↑ 重试拿回同一张收据、「直接生成」档、返工确认、第一次降档、文稿 / 时间线 / 方案确认仍 300 秒。
- 老数据：0.24.0 两份真实旧 Run（结果未知的画布镜、中途打断的画布镜）各重放一次，人在 Nomi 批准仍成功。
- 界面出口（Nomi 兜底卡、面板卡、画布）同一输入的说法和动作：全部相同；有一处不同就停。

反例（R2 替换签发形状扫描）：生产 runtime 拿到的 reader 不含五个签发方法；把独立验收的拆字符串签发 probe 放到主人之外的生产文件，运行时调用失败；同一 reader 经主人答是仍签发成功。把 helper `confirmed: yes()` probe 放入生产文件，伪 token 在真实 Run 决门前拒绝，供应商 0 次。签发扫描删除；结论扫描保留已有八种反例，只防误导性的回执，不再给它加绕法形状，不再称它是防花钱的边界。

回滚：revert 这一个提交。存储格式没变，回滚不需要迁移。
独立验收：待派（四类必须另一条线）。

## 协调拍板（2026-11-20）与遗留

1. **IPC 形状**：批 (b)——客户端签收据的回环方法加「原始答复」参数，身份改取请求头里验过的那个，主人判未用掉。没选 (a)「开问」方法（要碰三处装配热点，防不住更多）、(c) 不改 IPC（主进程仍不判答复）。
2. **U1**：批 U1-a——外部向应用内看齐，不设空闲期限，依据 `rendererBridge.ts:143-156`（2026-09-11）。没选 U1-b（应用内加期限，违反拍板）、U1-c（外部等到挑战过期，仍是两套规则）。
3. **旧无 Run 路的策略签发**：批改调主人，行为与测试不变；整段删由协调另记待办（先核 2026-09-21 那条决定还算不算数）。
4. **扫描接线**：不进热点 `check-concept-owners.mjs`，也不往 `concept-owners-scan.mjs` 加大段；新扫描放 `scripts/concept-owners-approval.mjs`，测试挂进现有 `check:concept-owners` 命令（CI 每个 PR 必跑），并登记 SCAN_GUARDS。
5. **发现但不在本卡做**：①（已收进本卡的部分）Run 边界核收据原来不看「是否已用掉」。降档收据本卡就拒（它从不出生即用掉，不挡任何现有路，存储不变）；付费门收据不加这条，因为画布那张出生即用掉、崩溃重试要拿回它，付费门的「只花一次」靠门的状态（批过的门再交同一张收据只算重复决定）。要让付费门收据也在 Run 边界按「用没用过」核，得先给收据记「被哪条命令用掉」，是存储格式变化，不在本卡。②外部走 Nomi 兜底卡时，回环这一跳把「用户点了忽略」丢了，助手收到的是「请确认」而不是「已拒绝」；改它会改回执，按停点不在本卡改。③外部走本机 HTTP 转发时，长于 300 秒的等待会不会被转发器自己的流超时截断，unverified。④客户端取消工具调用以后，Nomi 兜底卡仍留在屏幕上，点它卡片关掉、什么也不签（和今天看起来一样，只是今天会签出一张没人用的收据）；要让卡随取消自动收起是界面变化，不在本卡。
6. **不走的路 C**（删客户端确认、外部统一 Nomi 卡）：少一条信任路，但删了已承诺的「在客户端点一次」，是产品取舍，交用户。
7. **和第 9 组的先后**：协调定本卡先合；第 9 组（重发）之后基于本卡做，只调 ★2 写明的只读接口，不自己盖章。卡末 5 条遗留由协调记进待办。

实现中（2026-11-21）协调再定：

8. **U2-3 客户端路挪进预期变化**：删掉成功缓存以后，同一张已批未用的挑战再确认会再问一次人，主进程交回同一张收据（不多签）；降档路中间若有 Run 事件让版本前进，再确认就是新挑战、新签一张。
9. **两个布尔分支一起删**：`mcpGateConfirmation.ts` 里客户端验证器 / Nomi 兜底只回 `true` 也算批准的两个分支（生产走不到），不是对象就一律算没批准；4 处测试替身改成带收据的对象。
10. **预期变化第 9 行（降档晚到）**：见 ★4「过期」与 ★9；不改降档挑战有效期，待办「降档挑战有效期是否跟随等人不设期限」由协调记。
11. **旧门岗换新扫描（代批 A）**：删两个布尔分支以后旧门岗 `check:spend-receipt` 无物可扫、必红；同一提交删它和基线，由新扫描接手。条件：推送前不变松（`SCAN_GUARDS` 的触发面是旧门岗 3 个固定文件的超集，选择器探针证据在证据目录）、两条写回反例必须红、方向检查文档 `docs/engineering/direction-checks/2026-11-21-spend-receipt-gate-replaced.md`、根因合同改指新扫描、提交带 `Direction-Check:` trailer。协调代批，事后报用户。


## R2 动手前修订（2026-11-21）

- ★0：本仓收据工厂的闭包保护密钥、Run 的 `verifyReceipt` 保护花钱边界、原验收两个动态绕法证明语法扫描不能证明能力隔离；分别确认闭包持有签发、保留签验与核销、删除签发形状扫描。出口：不新增用户阻挡，正常答复仍由主人签发，不改变取消/重试路径。
- ★1：目标按任务书：生产持有者动态拿不到签发方法；正常答是仍签；伪造 confirmed 花不出钱。量具：生产装配返回对象的运行时反例、真实 Run 仓库+假供应商计数、九行逐字外部回执与 D1/D2/D4/D9 对拍。
- ★2：工厂分出不含签发的 `reader`，五个签发方法只交给主人模块的私有 WeakMap；完整工厂对象仅供原测试装配，兼容旧测试。生产 runtime 只返回 reader；不改热点持有者文件，共享 `ApprovalReceiptAuthority` 类型统一收窄。
- ★3：沿原方向补扫描不能覆盖动态取成员；改为签发闭包隔离；删除签发扫描，保留结论扫描仅防回执误导，不宣称它防花钱。
- ★4：不改交互、文字、存储或签名；同一读写函数共享锁和库，读面无回到完整对象的属性。私有表未登记则主人拒签，既不偷花也不伪称批准。
- 5/6：范围为工厂→生产装配→主人→已有签验/核销→Run→提交；持有者只靠共享类型收窄，不改热点文件和测试装配。收据字段与错误处理保留。
- ★7：无新功能/依赖，无新增 I/O，WeakMap 查询为常数时间。
- 8：不起窗口、不花钱；UI 按任务书交独立验收，本轮只隔离目录+本机回环+假供应商。
- ★9：先跑能力反例红，再实现；什么都不做使用基线产品代码与本轮测试，全部拦下改主人签发出口，均保存 patch/log。九行正反断言真实回复文本；D1/D2/D4/D9 同输入逐字对拍。原「只有反半边红」不成立：U1 的正半边在旧版到时被替答否，U2-2 正半边旧版拿缓存不重问，同样应红。主人只读结论新增入口旧版不存在，不让缺符号 TypeError 冒充目标红；其可迁移的问答测试经旧有 createDefaultAuthorities 入口验证。
- 预测/复查：本轮生产 reader 五个签发键全部不存在；动态取签发失败，主人答是成功；裸 confirmed+伪 token 的 Run 不批准、供应商 0 次；下一轮独立验收复查，不满足即重开。


### R2 兼容边界与反事实口径

生产装配在 `approvalReceiptRuntime.ts` 把完整工厂的签发面单向绑定到主人的私有表，并只交出 reader；工厂不反向 import 主人（避免扩大前端类型编译依赖）。原测试装配仍传完整对象，主人接受这一显式完整输入；生产 reader 没有回到完整对象的 `reader` 属性。不是生产失败后的第二条路，签发函数仍是原来的同一组。
五条 `readApprovalDecision` 合同验证新增的只读状态投影，旧版既没有该出口也没有等价的只读状态出口，因此从「什么都不做」目标集中排除并单列；两条能迁移的问答合同已改从旧版也有的 `createDefaultAuthorities` 进入，取消后晚到、客户端严格答复与用掉重发都以断言失败呈现，不再以缺符号 TypeError 或等待超时充数。
D1/D2/D4/D9 的同输入中英回执和请求正文分别固化；生成成功的 JSON 回执仅归一化随机挑战/收据 ID 和令牌，其余逐字断言。生成/降档工具投影均调用生产的 reply/assemble 实现，供应商启动另由真实 Run + 假供应商测试守住。

**这一层保证到哪（协调 2026-11-21 定，同日用户定「收窄承诺再合」后改写）**：按「谁够得着」分两栏——①外部助手 / 渲染层：经任何入口都花不出钱。运行时隔离保证生产持有者拿到的收据库对象里没有签发，无论怎么拼方法名、怎么包一层 helper 都签不出收据；字面 `confirmed:true` 加假令牌不批、别的 Run 的真收据被拒、伪造的 `confirmed` 过不了 Run 和提交边界的签验。②同一主进程里的代码：不在保证内，不逐个点名。另调工厂 `createApprovalReceiptAuthority` 拿共享签名钥匙另造一份、直接调主人导出并自编输入、改写读面，都要先合并一段新的主进程代码才碰得到，按「主进程代码可信」处理；使用处照样只认签过名的收据。第二轮曾为另造工厂加过一条按名字找的概念登记绊线，换个别名导入就不报，第三轮按用户决定删掉，不再按绕法补形状。


### R2 自验收据（2026-11-21）

固定主分支快照 `76518c7271d97136d7caa2998d8ea49b7eb16ec8` 的全部差异生产文件替入本工作树，与本轮测试运行：20 红 / 23 绿 / 5 条新增只读合同排除；20 条全是断言失败，无缺符号 TypeError、无等待超时。D1/D2/D4/D9 四项对拍均绿（两轨逐字快照），不是把未跑算不变。U1-1、U1-2 正反均红；U2-2 正反均红；其余红的具体项见 `noop-r2.json`。两条已迁移的旧入口合同都因业务断言红。
「全部拦下」在主人统一 `issuerFor` 处拿掉签发：24 红 / 24 绿，九行正半边、返工、面板/画布/策略与生产装配正常确认均红；否决/无人答和只读夹具可继续绿。反例脚本强制替换必须改变字节，避免签名变动造成空替换冒充反事实。
两个独立验收原始 probe 分别临时放入 `mcpGateConfirmation.ts`：拆字符串签发在生产 reader 上抛 TypeError（不存在方法），正常主人签发仍绿；helper 恒真+伪 token 在真实 Run 中不批准，提交边界拒绝，供应商 0 次。两项 1/1 通过，全部临时文件逐字还原。源码扫描剩 18/18（结论与不误报），不增加新的 helper 恒真形状。
证据根目录 `/Users/aoqimin/Nomi-coord/tmp/L-home-approval-r2/`；最终计数以报告及最后定向测试日志为准。窗口、真实 301 秒签发生成、真客户端与真付费仍未验，交下一轮独立验收。
