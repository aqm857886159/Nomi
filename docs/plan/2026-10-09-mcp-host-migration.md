# MCP 第 3 段：宿主配置同意后迁移到本机直连（设计卡）

线：I-mcp3　类别：[新界面]（花钱 / 长跑 / 可打断：不碰，付费确认语义与工具面不变）
依据：`docs/plan/2026-10-05-mcp-official-sdk.md` 分段计划第 3 行与「第 3、4 段界面」；画布 v5（用户 10-05 拍板）。第 4 段（状态框六种、调用记录、小圆点、总徽章）不在本卡。

## 合同（协调会话定）

1. 不点「改过去」，任何宿主配置字节不变；启动修复只做同传输（stdio→stdio）修复，**不 import 迁移模块**，永远不产出 HTTP 条目。
2. 按宿主写不同条目，只走 `mcpHostMigration.ts` 一个写入边界：Claude Code `type:http` + url + 身份头；Codex TOML `url` + `http_headers`；Cursor `url` + `headers`；Claude Desktop 写 `mcpHttpForwarder.js` 转发口；WorkBuddy 保持 stdio（官方没有 HTTP 写法，界面不出现它）。条目的地址和身份头由第 2 段的 `buildMcpHttpHostEntry` 生成，不另写一份。
3. 写之前重新读、校验；写盘走唯一的写盘门 `hostConfigWrite.atomicWrite`（锁里只读一次 → 从同一份字节算新内容 → 备份 → 临时文件 → 带核对的原子提交，见中途表）；迁移前原文单独备份为 `<配置>.nomi-backup-premigrate`，只存第一次，`installMcp` 的 `.nomi-backup` 不碰它；任何一步失败原文件字节不动，结果里如实带这个宿主的失败原因。`restorePreMigrationMcpConfig` 逐字节写回，同样原子写。**这一版界面上没有恢复入口（画布没有）**，缺口写在 PR 正文。
4. 旧 stdio 启动器（`mcpNodeLauncher`）本版不改行为：它能在 Nomi 没开时冷启隐藏实例（#1139 的 C′ 建在这条路上），转发口做不到。没迁移的用户照旧能用。**迁移后 Nomi 必须开着**（卡底常驻那行字就是这么说的），冷启能力只留在没迁移的路上，等删旧启动器那一版再定。
5. url 一律写稳定地址：服务端自己选端口的同一个函数 `resolveMcpHttpPort`（默认 47173 或显式覆盖）；显式 0（随机）或隔离实例（null）不是稳定地址，绝不写临时端口。迁移那一刻该地址上没有活着的 Nomi（端点文件不指向它，或写它的进程已死——端口被占、`mcp-http-unavailable` 都落在这里）→ 拒绝，reason `http-unavailable`，宿主保持 stdio。
6. 通用 snippet 不带身份：`genericMcpSnippet` 主动剥掉环境变量和请求头形式的 id / proof。

## 自写 vs 现成（先查别人）

| 查了 | 结论 |
|---|---|
| Claude Code 官方 MCP 文档 https://code.claude.com/docs/en/mcp | 远程条目 `type:"http"` + `url`（+ `headers`）；官方 CLI `claude mcp add --transport http`。不用 CLI 写：GUI 的 PATH / 登录态 / 宿主重启语义不稳（见 `docs/plan/2026-09-14-mcp-connection-truthfulness.md`）；但用 `claude mcp list` 做真握手验证 |
| Codex 官方 MCP 文档 https://learn.chatgpt.com/docs/extend/mcp?surface=cli | TOML `url` + `http_headers`；真握手用 `codex app-server` 的 `mcpServerStatus/list` |
| Cursor 官方文档 https://cursor.com/docs/mcp | `url` + `headers`，改后要重启 |
| WorkBuddy 官方文档 | 只有 stdio / UI 管理，找不到 HTTP 写法 → 先保持 stdio |
| MCP 官方本地服务器快速开始 https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-local-servers | Claude Desktop 只给 `command/args` → 转发口 |
| TOML 解析库 | 不引：只做 Nomi 自己那一块的块级替换（和既有 `codexInstall` 同一做法，已登记）；读回 HTTP 条目用同样的窄解析 |
| 握手验证 | 用官方 SDK `Client` + `StreamableHTTPClientTransport`（`mcpVerifyHttp.ts`），不手写 JSON-RPC |

自己写的：宿主迁移名单 / 同意后写入 / 迁移前备份与恢复 / 稳定地址存活判断（`mcpHostMigration.ts`、`mcpHttpEndpoint.isMcpHttpLiveAt`）——是「Nomi 往别人家配置里写自己那一条」的领域，没有现成库管别家的配置文件。

## 设计卡（9 格，新界面类）

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我升级 Nomi 后打开设置里的「AI 助手连接」卡，看到一句「Nomi 换了更快的连接方式，要把 Claude Code、Codex、Cursor 改过去吗？」，我想一键同意（改前自动备份）或先不管，以便不用读配置就换到新连接。步骤：①打开卡 → ②看到问句（宿主名按真实检测到的旧条目列）→ ③点「改过去」→ ④看到「已改好 N 个，原配置的备份放在各自旁边，重启它们后生效」→ ⑤重启宿主。「以后再说」记到下一版再问。**不做**：不加恢复按钮（主进程有函数）；不改工具面；不迁 WorkBuddy。**已知坑**：迁移后 Nomi 必须开着；宿主正开着并改写同一文件时，提交前后都核对宿主有没有插写，插写就放回宿主那份并如实报；剩一个毫秒级、测不到的窗口（量级与收据见中途表和「剩余风险」）。真实任务：①本机已有 Claude Code + Codex 旧条目 → 同意 → `claude mcp list` 显示 Connected、`codex app-server` 拿到工具清单（真握手，已做）；②Nomi 没开着点同意 → 如实说新方式现在用不了、原连接照常；③配置文件是坏 JSON → 说哪个没改成、为什么、怎么办。主指标：同意后真握手成功率；护栏：不同意零字节变化 | 必红测试 `mcpHostMigration.test.ts`；真握手 `mcpHostMigration.realHost.test.ts` |
| ★2 谁说了算 | 「宿主里 Nomi 那一条的写法」仍归 `mcpConfig`（stdio）+ `mcpHostMigration`（HTTP / 转发口，只在同意后）；地址与身份头归 `mcpHttpEndpoint`（第 2 段）；写盘门唯一：`hostConfigWrite.atomicWrite`；「这一条归谁」的判定唯一：`mcpHostEntries.nomiEntryTransport`（写入门、分类、验证、迁移名单共用）；同意凭据归 `mcpHostMigration`（主进程发、一次性、只覆盖列出的宿主）。同一份事实存一份：宿主配置文件本身是真相，渲染层不缓存（只记「以后再说」的版本号，per-viewer 便利）。不靠「东西不见了」猜意图：同意是显式 IPC `nomi:capability:mcp-migrate` | `node scripts/door-map.mjs atomicWrite` |
| ★3 一致与复用 | 复用：`atomicWrite`（加备份后缀参数，没另写一套）、`buildMcpHttpHostEntry`、`ConnectAssistantCard` 既有布局与按钮样式、`FoldableModelCard`。新增一个纯展示组件 `McpMigrationPrompt`（设计实验室用同一个生产组件）。按钮「确认在右」与全站一致 | `check:self-written`、`check:prior-art` |
| ★4 全状态 | 询问 / 改好 / 部分没改成（逐个说哪个、为什么、下一步）/ 新连接方式用不了（「原来的连接照常可用」，三家合成一行）/ 点了以后再说之后不出现 / 加载中（读不到名单就不出现）/ 能力不可用：新方式用不了 = 稍后再试，原连接照常，一步可走；取消中、过期：不适用（同步写，一次点击内完成）。zh / en 全走 i18n，文案不出现 MCP / HTTP / 口令 / 预算 / 价格（`mcpMigrationCopy.test.ts` 守） | 截图：设计实验室 host-config 屏 02-migration 20 格 |
| 5 中途表 | 见下 | 必红测试 + 人工推演 |
| 6 外部数据与失败 | 外部：宿主配置文件（用户可能手改、Claude Code 自己会改写 `~/.claude.json`、坏 JSON）。偏差：官方没给 WorkBuddy 的 HTTP 写法；Claude Desktop 无 HTTP 写法。失败：读不了 → `config-unreadable`，备份失败 → `backup-failed`，换名失败 → `write-failed`，新连接方式没起 → `http-unavailable`，每个界面都说人话和下一步 | 官方文档链接见上 |
| 7 性能预算 | 同步写 ≤5 个小文件，毫秒级；名单读取是读 5 个配置文件，打开卡时一次。不进启动关键路径（启动只跑旧的 stdio 修复） | 人工 |
| 8 真实条件 | Windows 本机已跑：必红测试 17 条；真握手 Claude Code（`claude mcp list` Connected）、Codex（`mcpServerStatus/list` 出工具清单），全部临时 HOME / `CLAUDE_CONFIG_DIR` / `CODEX_HOME`。**unverified**：Cursor、Claude Desktop、WorkBuddy 真握手（无界面做不了）；宿主正开着并改写同一文件的真竞态；打包版（asar 里 `mcpHttpForwarder.js` 路径）；macOS | 本卡 + PR 正文 |
| ★9 验收与回滚 | 验收：另一条线跑 `mcpHostMigration.test.ts` + realHost 测试，设计实验室 host-config 屏截图对画布 v5 逐项核。回滚：revert 本 PR 的 feat 提交；已迁移用户配置：`restorePreMigrationMcpConfig`（本版无界面入口；缺口：已迁移的用户要回退只能手动用 `.nomi-backup-premigrate` 覆盖配置，或重新「连接」会写回 stdio 条目） | PR `## 独立验收` |

### 中途表

| 时刻 | 写到一半关机 / 断电 | 两个 Nomi 实例同时迁移 | 宿主正开着并改写同一文件 | 迁移后端口被占 / Nomi 没开 |
|---|---|---|---|---|
| 读与算新内容 | 只读，原文件未动 · 不扣 | 每个目标文件一把租约锁（`productionRun/productionRunLock`，排他创建 + nonce 所有权 + 续租）；抢不到锁等 3 秒后如实失败（`write-failed`），不交叉写 | 锁里**只读一次**原文件进内存，「这一条归谁、写什么」和后面的写都看这同一份字节 · 不扣 | 不适用 |
| 备份中 | 备份从内存那份原文写成带拥有者的 `.part`，再换名（可覆盖的）或排他链接（迁移前那份）；断电只留 `.part`，下次写时按 pid 判死清掉 · 不扣 | 同上，锁在手 | 备份内容就是 Nomi 据以修改的那一版，不会混进复制途中宿主的写入（不再 copyFile）；这次最终没写成 → 这次建的迁移前备份撤掉，不留也不锁定一份错的首份备份 · 不扣 | 不适用 |
| 写临时文件 / 提交 | 临时文件、被换下来的链接都带 `<pid>.<随机>`，崩溃残渣下次写时按 pid 判死清掉（`.nomi-conflict.*` 是数据，永不清）；原文件完整（换名原子）· 不扣 | 每一步之间续租；**提交前最后一次核锁**：租约不是自己的、或剩余不足 5 秒 → 在换名之前放弃（`HostConfigLockLostError` → `write-failed`），原文件不动。即使锁失效，提交协议本身也会发现另一个写入者（见右格），两道独立防线 | 提交 = 最后一次比对 → 给原文件挂硬链接（留住被换下来的那一份）→ 原子换名 → 读被换下来的那份：不是读到的那版 = 宿主在比对后、换名前原地写过 → 把宿主那份放回去（先存一份 `.nomi-conflict`，放回成功再删）、报 `host-changed`；再读回一次：不是我们写的 = 宿主换名后立刻又写 → 不动它、报 `host-changed`（Nomi 的内容落过盘，迁移前备份保留；重试遇到已是 Nomi 的直连条目直接报成功）。**剩余测不到的窗口**：宿主用「写临时文件再换名」整份替换，且它的换名恰好落在我们挂链接与换名这两个相邻系统调用之间——测量收据 `docs/evidence/2026-10-10-host-config-commit-window/receipt.json`（win32 10.0.26200 / Node v22.15.0 / NTFS，300 次、80KB，生产写盘门的测量缝）：p50 1.02ms、p95 2.94ms、p99 7.78ms、最大 24.89ms；按「宿主活跃时平均每 5 秒整份重写一次（泊松到达）」的假设，P = 1 − e^(−窗口/间隔)：单次迁移按 p50 约 0.02%、按 p95 约 0.06%、按最大值约 0.50%。撞上时丢的是宿主那一次整份替换（详见下文「剩余风险」）。普通文件系统没有对外部写者的 compare-and-swap，这是不改流程能做到的最小窗口；协调会话 2026-10-10 接受此窗口，不改流程（不加「宿主运行时不迁移」之类限制） | 不适用 |
| 迁移完成 | — | 第二个实例列名单为空（条目已是新形状，分类为 migrated-*）；第二个实例重放同一张确认凭据被拒（凭据一次性、只在发出它的主进程里有效） | 宿主重启后读新条目 | Nomi 没开：宿主显示连不上（卡底一行字已写明「用之前先打开 Nomi」）；转发口每个请求前都核「端口 = 稳定端口、端点文件记的正是它、写它的 Nomi 进程活着」，对不上就不带身份发任何请求，直接回「请先打开 Nomi」；端口被占：下次迁移前就被 `http-unavailable` 拦下；迁移后才被占：宿主连不上，「修复」只会按同一种传输重写、不会降回 stdio；想回旧方式只有恢复函数（本版界面无入口，缺口） |
| 迁移前就不可用 | 不适用 | 不适用 | 不适用 | 拒绝迁移，宿主保持 stdio，原连接照常 |

### 对照画布 v5（界面验收）

画布链接当前读取失败（network error），逐项依据 `docs/plan/2026-10-05-mcp-official-sdk.md`「第 3、4 段界面」的文字描述：①迁移提示在卡顶部 ✓；②问句内容与「改之前会先备份；不改也照样能用到下个版本」✓；③按钮靠右、「以后再说」左、「改过去」右 ✓；④「已改好 N 个，原配置的备份放在各自旁边，重启它们后生效」✓；⑤卡底常驻浅色小字、不加底框 ✓；⑥文案 i18n zh/en、不出现 MCP/HTTP/口令/预算/价格 ✓。像素级对账：**unverified**（画布读不到）。

## 复审第 2 轮（4876ac990）四条阻断的修法（2026-10-09 夜，I-mcp3）

| 阻断 | 类根因 | 修在哪 | 必红测试 |
|---|---|---|---|
| 1 租约过期两个 Nomi 同写 | 锁当成「拿到就一直是我的」，写期间不续、换名前不核 | `hostConfigWrite.withHostConfigLock` 给出 fence：每步之间续租，提交前核 nonce 所有权与剩余租期，锁丢了在换名之前失败 | `hostConfigWrite.test.ts`「阻断 1」：两个 tsx 子进程、租约 1.5 秒，A 卡在提交前、B 回收锁写入，A 报锁丢失、文件是 B 的 |
| 2 比对到换名的 TOCTOU、备份复制中混入 | 「比对」和「提交」是两步，提交后不核被换下来的是什么；备份从磁盘复制而不是从据以修改的那份字节写 | `atomicWrite(target, edit)` 读—改—写一体、只读一次；提交协议挂链接 + 事后核对 + 放回；备份从内存写；没写成就撤这次建的首份备份 | `hostConfigWrite.test.ts` 阻断 2 四条 + 备份两条；`mcpHostMigration.test.ts`「复审阻断 2」恢复热写、提交后宿主再写 |
| 3 转发口把 proof 发给任意本机端口 | 转发口只核「是不是回环」，不核「是不是此刻活着的那个 Nomi」 | `mcpHttpEndpoint.liveForwarderUrl` + `forwarderFetch`：每个出站请求都核稳定端口、端点文件、进程存活，核过才加身份头；删掉 `resolveForwarderUrl` / `isLoopbackMcpUrl` | `mcpHttpForwarder.test.ts`：真转发口进程，地址改成别的端口 / Nomi 进程已死时计数服务器零请求，阳性对照有请求 |
| 4 混合 / 伪造条目让修复改传输 | 「有 url 就是已迁移」——拿形状当所有权 | `mcpHostEntries.nomiEntryTransport` 唯一判定（混合、地址不稳、身份不是这个宿主的一律 unowned），写入门 `rewriteNomiEntry` 在锁里按它决定，unowned 拒绝（`entry-not-owned`）；`configuredMcpEntry` / 分类 / 验证 / 迁移名单都走它 | `mcpHostMigration.test.ts`「复审阻断 4」七条 |

为什么不接 proper-lockfile / 平台文件锁：见 `docs/engineering/self-written.json` 的 `mcp-protocol` 条目 `alternativesChecked`。

## 剩余风险：挂链接到换名之间的窗口（大白话，2026-10-10）

**什么时序下会发生**：Nomi 提交时连着做两件事——先给宿主配置文件挂一个硬链接（留住「被换下来的那一份」好事后核对），紧接着把新内容换名上去。如果宿主（例如正开着的 Claude Code）恰好用「先写临时文件、再换名覆盖」的方式整份重写同一个配置，而且它的换名**正好落在 Nomi 这两步之间**，Nomi 的硬链接拿到的还是旧文件，事后核对看不出宿主插过一脚，Nomi 的换名就把宿主刚写的那一版覆盖掉了。宿主在这两步之外的任何时刻写（原地写、整份替换、在我们换名之后写），都会被发现：放回宿主那份并报「宿主刚改过，请再试一次」，或者不动宿主的新内容并如实报。

**发生了用户看到什么、丢的是什么**：Nomi 这边显示「已改好」，宿主配置里是 Nomi 写的新条目加上宿主**上一版**的其余内容；丢的是宿主那一次整份替换带来的改动（比如它刚记下的一条设置或会话信息）。宿主内存里还有这份状态，它下次写配置时通常会再写一遍；迁移前原文另有 `.nomi-backup-premigrate`。不会出现半个文件、坏 JSON 或别的服务器条目丢失。

**有多大**：测量收据 `docs/evidence/2026-10-10-host-config-commit-window/receipt.json`（win32 10.0.26200 / Node v22.15.0 / NTFS，300 次、80KB）：窗口 p50 1.02ms、p95 2.94ms、p99 7.78ms、最大 24.89ms。按「宿主活跃时平均每 5 秒整份重写一次（泊松到达）」的假设，P = 1 − e^(−窗口/间隔)：单次迁移按 p50 约 0.02%、按 p95 约 0.06%、按最大值约 0.50%。每个用户一生只迁移一次（之后的修复同样走这扇门，但只在用户点「修复」时）。

**为什么接受**：Node 没有跨平台的「原子交换换名」（Linux renameat2 RENAME_EXCHANGE / macOS renamex_np 都不是 Node 公开 API，Windows 没有对应），宿主也不配合 Nomi 的锁，普通文件系统上对外部写者做不到 compare-and-swap；要归零只能改用户流程（例如宿主开着时不迁移），协调会话 2026-10-10 裁定不改流程、接受这个窗口。

**怎么复跑**：`pnpm run measure:host-config-commit-window -- --out <新收据.json>`（默认 N=300、80KB、宿主每 5 秒写一次的假设；`--n` / `--size-kb` / `--host-interval-s` 可改）。脚本直接调生产 `hostConfigWrite.atomicWrite`，计时取自它的测量缝 `onCommitWindow`（「挂链接」调用开始 → 「换名」调用返回），不复刻任何一步；收据不含本机路径、主机名、用户名。防烂测试 `scripts/measure-host-config-commit-window.test.mjs` 用 N=3 真跑一遍。
