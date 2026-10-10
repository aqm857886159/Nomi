# 方向检查：迁移确认凭据被「读状态」顶掉、失败路径在宿主目录留 .nomi-prev 残留（#1142，V-1142b 第 2 项）

触发：`node scripts/fix-churn.mjs electron/capabilityCore/mcpHostMigration.ts` 命中——文件 14 天内已有 2 个 fix，这一刀是第 3 个；自写登记 `mcp-protocol`（to-replace）30 天内第 33 个 fix。按 `docs/engineering/direction-check-template.md` 写，**拍板前不动实现**，只钉了两条特征测试（见文末）。

## 0. 一句话根因

迁移的「同意」被做成了一份**全局可变状态**（主进程里只有一个槽位的凭据），而且由一个**名字叫读的函数**去写它：界面每刷新一次读状态，就把「再试一次」要用的那张凭据顶掉。凭据绑在「最近一次读状态」上，而不是绑在「这一次迁移尝试」上。另一条：提交协议先挂链接再换名，换名一直失败时每次重试都新挂一个链接，链接和目标共用只读属性，Electron 里删不掉。

## 1. 归类表：三个 fix → 直接原因 → 类

| 提交 | 修了什么 | 直接原因 | 类 |
|---|---|---|---|
| `b95b6da6e` 评审 1 轮 | 同传输修复、每文件锁与换名前比对、验证只连稳定地址、迁移后条目自有分类 | 写入面没有单一 owner（见 `2026-10-09-mcp-host-migration-review-direction-check.md`） | 写入边界缺不变量 |
| `809053bfa` 评审 2 轮 | 锁续租、提交协议（挂链接 + 事后核对）、转发口出站判据、所有权唯一判定；**新增一次性确认凭据** | 复审指出「IPC 只靠可信渲染层、没有一次性 nonce」，按「成本小就做」加了凭据 | 同上；凭据是这一轮**新引入**的状态 |
| 本次（待修）V-1142b | 「再试一次」被拒：`migration consent is missing…`；只读失败后 Cursor 目录留 6 个 `mcp.json.nomi-prev.*` | ① `readMcpMigrationState()` 调 `issueConsent()` 覆盖唯一槽位，界面 `onChanged` 后 `useEffect([readMigration, info])` 会再读一次；② `commit` 每次共享冲突重试都 `linkSync(target, prev)`，换名 EPERM 后 `rmSync(prev)` 在 Electron 43 里因只读属性失败，1+5 次重试留 6 个 | ①读路径带写入 + 凭据作用域错；②失败路径的临时件不是「建一次、必收走」 |

## 2. 为什么这一类会一直出现

- **凭据**：同意本身没有可被主进程验证的「点击」——渲染层能读状态拿凭据，就能用凭据迁移，所以这张凭据从来证明不了「用户点了」，它能做的只有「把迁移绑到列出的宿主集合」。而这件事主进程本来就在做：`migrateOne` 对每个宿主在锁里重核「装了、是 Nomi 自己写的旧 stdio 条目、能迁移」，不满足一律 `not-migratable`；已迁移的再迁移是幂等成功。于是凭据只增加了一份状态和一条失败路径（就是这次的 bug），没有增加保护。这是「为了回应评审而加机制」，不是从不变量出发。
- **为什么 `check:read-path-writes` 没拦住**：它的写盘门表只有 `atomicWrite` 与 `writeConnectorPrefs`（`scripts/check-read-path-writes.mjs` 的 `WRITE_DOORS`），只管「名字叫 read 的函数改用户的磁盘状态」；`readMcpMigrationState → issueConsent` 改的是**模块内存状态**，不在它的视野里。这是门岗刻意收窄的范围（见该文件头注释），不是漏写。
- **残留**：提交协议在 `809053bfa` 引入「先挂链接再换名」，但「挂上的链接一定收走」只靠 `rmQuiet`（尽力而为、吞错）；重试循环把挂链接放在每次尝试里，没有「同一次提交只挂一个」的结构保证；崩溃残渣清扫 `sweepDeadLeftovers` 只清**已死进程**的，活着的 Nomi 自己留下的永远不清。系统 Node 22 的 `unlink` 会无视只读属性，所以单测从来复现不了；Electron 43 不会。
- 铁律：⑫「点了 = 以为的」——用户点「再试一次」以为会重试，实际被拒且报的是原始 IPC 错误。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 任何触发卡片重读状态的动作（切语言、切主题、别处触发的 `info` 刷新）都会让「再试一次」失效 | `mcpHostMigration.test.ts`「特征（待修）：迁移 → 界面刷新读一次状态 → 再试一次」（现为 `it.fails`） |
| 两个窗口 / 将来的第二个入口同时读状态，互相顶掉对方的凭据 | 同上，换成两次 `readMcpMigrationState()` 后用第一张 |
| 宿主配置被杀毒或宿主自己长时间占住时，每次修复 / 迁移都在宿主目录多留最多 6 个链接，越积越多 | `hostConfigWrite.test.ts`「特征（待修）：失败路径不在宿主目录里留下 .nomi-prev 残留」（现为 `it.fails`，复刻出 6 个，与 `D:/v1142b-tmp/diag-*/home/.cursor/` 实测一致） |

## 4. 靶子独立性

缺陷由独立验收线 V-1142b 在真 App（Electron）里发现，并用三组 IPC 诊断对照（重读 → 重试失败；不重读 → 重试成功）定位，不是实现线自己写的尺子。残留由验收线在临时目录实测（`D:/v1142b-tmp/diag-NUCJIi/home/.cursor/` 下 6 个），本线用系统 Node 复现不出来，所以特征测试显式复刻 Electron 的那两步（换名 EPERM + 删链接失败）。

## 5. P0：是不是我们独有的、现成方案

- 「确认这一次是用户点的」：现成方案是主进程原生确认框 `dialog.showMessageBox`（Electron，https://www.electronjs.org/docs/latest/api/dialog#dialogshowmessageboxwindow-options）——确认发生在主进程，渲染层伪造不了。但它把画布 v5 拍板的卡内两按钮换成系统弹窗，是界面改动，不在本轮。
- 凭据 / 迁移名单 / 提交协议都在自写登记 `mcp-protocol`（状态 to-replace）里；为什么现在换不了：各宿主没有「第三方注册 MCP 服务器」的官方 API，只能改它们的文件（见 `docs/engineering/self-written.json` 的 `mcp-protocol` 条目）；哪天换：同条目 `revisitWhen`。

## 6. 方案对比 + 推荐

| 选项 | 做什么 | 规模 | 对用户的影响 | 风险 | 推荐 |
|---|---|---|---|---|---|
| **删（B）** | 删掉确认凭据整套（`issueConsent` / `redeemConsent` / `consent` 字段 / `retryConsent`）；`mcp-migrate` 只收宿主名单，主进程照旧逐个重核资格；「再试一次」= 对失败的宿主再迁移一次；读状态回到纯读 | 主进程 −40 行，桥类型、preload、卡片各删几行，设计实验室假桥同步；测试删 2 条凭据用例、特征测试转正 | 「再试一次」在任何刷新后都能用；不再出现英文原始错误 | 失去「名单绑定到当时列出的宿主」——但主进程本来就在锁里逐个重核资格，多塞的宿主只会得到 `not-migratable`，凭据挡不住的（渲染层被攻破）它本来也挡不住 | **推荐** |
| A（协调会话提的） | 读状态纯读；凭据在点「改过去」/「再试一次」那一刻按这次的宿主集合铸、一次性；失败宿主的重试凭据随结果返回，存进按凭据为键的表（不再单槽） | 主进程改 ~30 行（单槽换表、铸点前移），界面首次迁移不再带凭据，重试带结果里的那张 | 同 B | 首次迁移的凭据在同一个 IPC 里铸、同一个 IPC 里兑现，等于没有；只剩重试那张有意义，而它绑定的「失败宿主集合」主进程同样会重核——保留了一份状态，换来的保护与 B 相同 | 次选 |
| 补（C） | 读状态别覆盖已有未过期凭据（单槽改多槽），其余不动 | 最小，~10 行 | 同 B | 读路径仍带写入，这一类会换个入口回来（§3 第二条预测） | 否 |
| 接入现成（D） | 改用主进程原生确认框做同意，删掉卡内「改过去」按钮的同意语义 | 中，界面改动要重出样张、重拍板 | 多一个系统弹窗 | 违背已拍板界面 | 否（除非用户要求点击在结构上可验证） |

**残留硬链接在失败路径上怎么清干净（与 A / B 无关，两种都要做）**：
1. 换名前先看目标可不可写（`fs.accessSync(target, W_OK)`；Windows 上只读属性在这里就会被看见）：不可写直接报写入失败，**不挂链接**——只读这一类从源头不产生链接，并且可以给出「这个文件是只读的」的人话原因（新增失败原因与 zh/en 文案）。
2. 同一次提交只挂一个链接：挂链接移出共享冲突的重试循环，重试只重试换名本身，不再每次新挂一个。
3. 收走失败时不吞掉：删链接失败就把它记下来，在本次锁内、本次提交结束前再试一次；仍失败的留给下一次清扫。
4. 清扫改为「锁内清掉这个目标所有的 `.nomi-prev.*`」，不再只清已死进程的：持锁时不可能有别的写入者在用它（`.nomi-prev` 只在一次提交内有意义），活着的 Nomi 自己留下的也一并清掉；`.nomi-conflict.*` 是数据，照旧不碰。
5. 必红测试：现有特征测试转正（6 个 → 0 个），再加「只读目标 → 报只读、零链接」一条。

## 7. 用户要权衡的核心

**确认凭据保护不了它想保护的东西（渲染层自己就能领凭据），却让「再试一次」在界面一刷新就失效——删掉它（B），同意的语义完全靠「主进程逐个重核宿主资格 + 只有可信主窗口能调」承担；如果你要的是「这一下点击在结构上可证明」，那得换成主进程确认框（D），会改已拍板的界面。**

## 特征测试清单（动结构前先锁住）

- `electron/capabilityCore/mcpHostMigration.test.ts`「特征（待修）：迁移 → 界面刷新读一次状态 → 再试一次」——`it.fails`，现在确实报 `migration consent is missing…`；修好后改回 `it`。
- `electron/capabilityCore/hostConfigWrite.test.ts`「特征（待修）：失败路径不在宿主目录里留下 .nomi-prev 残留」——`it.fails`，现在确实留 6 个（`config.json.nomi-prev.<pid>.<随机>` × 6）；修好后改回 `it`。
- 两条都已临时去掉 `.fails` 跑过一次，确认失败原因正是上面两条，而不是别的错误。

## 拍板与实施（2026-10-10）

用户拍板**方案 B（删）**。同一提交做完：

- **删凭据**：主进程的铸造 / 兑现 / TTL / 单槽位、`McpMigrationConsentError`、`migrateMcpHostsWithConsent`、`McpMigrationOutcome` 全删；`readMcpMigrationState()` 纯读；迁移 IPC 收宿主名单数组；preload、桥类型、`ConnectAssistantCard` 的重试凭据状态、设计实验室假桥同步删掉，没有留开关。
- **「同意」靠什么**：①只有登记的主窗口主帧能调迁移 IPC（`assertTrustedSender`，`check:ipc-sender-binding` 守）；②主进程在锁里逐个重核资格（`migratedContent`：装了、是 Nomi 自己写的旧 stdio 条目、能迁移；不满足 `not-migratable`，已迁移幂等成功）；③**唯一入口结构测试** `electron/capabilityCore/mcpMigrationEntry.test.ts`：渲染端只有询问卡的 `handleMigrate` / `handleRetryMigration` 调迁移桥；迁移通道字面量只在 preload 与注册处；主进程只有迁移 IPC 处理器调 `migrateMcpHostsToHttp`，`mcpHostMigration` 只被 `mcpProfiles` import（修复 / 启动修复 / 撤销所在的 `mcpConfig`、`appIntegration` 不 import）。变异：在「修复」按钮里调迁移桥、在 `mcpConfig` 里 import 迁移模块 → 各自红。
- **残留**：`hostConfigWrite.atomicWrite` 换名前先查可写（只读 → `HostConfigWriteRefused('config-read-only')`，迁移报 `read-only`，zh/en 文案进词表，不挂链接）；同一次提交只挂一个链接（链接还指着目标就沿用，只重试换名；目标被整份替换才先收走旧的再挂）；收链接失败在本次锁内再试一次；锁内清扫清掉这个目标所有的 `.nomi-prev.*`，`.nomi-conflict.*` 不碰。
- **两条特征测试转正**：`mcpHostMigration.test.ts`「迁移 → 界面刷新读一次状态 → 再试一次」（原 `it.fails` → `it`，并断言读状态不改任何字节）；`hostConfigWrite.test.ts` 残留那条改成三条：只读零链接；复刻 Electron「换名一直 EPERM + 链接删不掉」时同一次提交只挂 1 个（原先 6 个）、下一次写时锁内清扫清掉；短暂共享冲突全程 1 个、结束为 0。原「删不掉也要求 0 个」的断言在运行时拒绝删除时物理上做不到，按修法改成「只 1 个 + 下次清掉」。
