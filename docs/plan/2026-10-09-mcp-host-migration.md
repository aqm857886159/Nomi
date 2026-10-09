# MCP 第 3 段：宿主配置同意后迁移到本机直连（设计卡）

线：I-mcp3　类别：[新界面]（花钱 / 长跑 / 可打断：不碰，付费确认语义与工具面不变）
依据：`docs/plan/2026-10-05-mcp-official-sdk.md` 分段计划第 3 行与「第 3、4 段界面」；画布 v5（用户 10-05 拍板）。第 4 段（状态框六种、调用记录、小圆点、总徽章）不在本卡。

## 合同（协调会话定）

1. 不点「改过去」，任何宿主配置字节不变；启动修复只做同传输（stdio→stdio）修复，**不 import 迁移模块**，永远不产出 HTTP 条目。
2. 按宿主写不同条目，只走 `mcpHostMigration.ts` 一个写入边界：Claude Code `type:http` + url + 身份头；Codex TOML `url` + `http_headers`；Cursor `url` + `headers`；Claude Desktop 写 `mcpHttpForwarder.js` 转发口；WorkBuddy 保持 stdio（官方没有 HTTP 写法，界面不出现它）。条目的地址和身份头由第 2 段的 `buildMcpHttpHostEntry` 生成，不另写一份。
3. 写之前重新读、校验；写盘走 `mcpConfig.atomicWrite`（备份 → 临时文件 → 原子换名，换名失败清临时文件）；迁移前原文单独备份为 `<配置>.nomi-backup-premigrate`，只存第一次，`installMcp` 的 `.nomi-backup` 不碰它；任何一步失败原文件字节不动，结果里如实带这个宿主的失败原因。`restorePreMigrationMcpConfig` 逐字节写回，同样原子写。**这一版界面上没有恢复入口（画布没有）**，缺口写在 PR 正文。
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
| ★1 用户怎么用 | 当我升级 Nomi 后打开设置里的「AI 助手连接」卡，看到一句「Nomi 换了更快的连接方式，要把 Claude Code、Codex、Cursor 改过去吗？」，我想一键同意（改前自动备份）或先不管，以便不用读配置就换到新连接。步骤：①打开卡 → ②看到问句（宿主名按真实检测到的旧条目列）→ ③点「改过去」→ ④看到「已改好 N 个，原配置的备份放在各自旁边，重启它们后生效」→ ⑤重启宿主。「以后再说」记到下一版再问。**不做**：不加恢复按钮（主进程有函数）；不改工具面；不迁 WorkBuddy。**已知坑**：迁移后 Nomi 必须开着；宿主正开着并改写同一文件时我们是读—改—原子换名，窗口很小但不为零（见中途表）。真实任务：①本机已有 Claude Code + Codex 旧条目 → 同意 → `claude mcp list` 显示 Connected、`codex app-server` 拿到工具清单（真握手，已做）；②Nomi 没开着点同意 → 如实说新方式现在用不了、原连接照常；③配置文件是坏 JSON → 说哪个没改成、为什么、怎么办。主指标：同意后真握手成功率；护栏：不同意零字节变化 | 必红测试 `mcpHostMigration.test.ts`；真握手 `mcpHostMigration.realHost.test.ts` |
| ★2 谁说了算 | 「宿主里 Nomi 那一条的写法」仍归 `mcpConfig`（stdio）+ `mcpHostMigration`（HTTP / 转发口，只在同意后）；地址与身份头归 `mcpHttpEndpoint`（第 2 段）；写盘门唯一：`mcpConfig.atomicWrite`。同一份事实存一份：宿主配置文件本身是真相，渲染层不缓存（只记「以后再说」的版本号，per-viewer 便利）。不靠「东西不见了」猜意图：同意是显式 IPC `nomi:capability:mcp-migrate` | `node scripts/door-map.mjs atomicWrite` |
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
| 备份中 | 原文件未动；备份先写带拥有者的 `.part`，再排他链接成备份，断电只会留下 `.part`、不会留下半份「备份」 · 不扣 | 每个目标文件一把租约锁（复用 `productionRun/productionRunLock`）：后到的抢不到锁就如实失败（`write-failed`），不交叉写；备份用排他创建，已存在就不写 · 不扣 | 备份读到的是当时内容 · 不扣 | 不适用 |
| 写临时文件 / 换名 | 临时文件名带 pid + 随机后缀（`.nomi-tmp.<pid>.<随机>`），崩溃只留自己的、下次不会被别人当成自己的；原文件完整（换名是原子的）· 不扣 | 持锁的写完才轮到下一个；谁都不会换走或删掉别人的临时文件 | 换名前再读一遍原文件，与第一次读到的 sha256 比；不一致就放弃，原文件不动，如实报「宿主刚改过这个文件，请重试」（`host-changed`）。**残余风险**：比对完成到换名之间仍有极小一段窗口（微秒级），宿主恰好在这一刻写入会被盖掉；缓解：迁移前原文已单独备份（`.nomi-backup-premigrate`），换名失败 / 比对失败都不动原文件 | 不适用 |
| 迁移完成 | — | 第二个实例列名单为空（条目已是新形状，分类为 migrated-*） | 宿主重启后读新条目 | Nomi 没开：宿主显示连不上（卡底一行字已写明「用之前先打开 Nomi」）；端口被占：下次迁移前就被 `http-unavailable` 拦下；迁移后才被占：宿主连不上，「修复」只会按同一种传输重写、不会降回 stdio；想回旧方式只有恢复函数（本版界面无入口，缺口） |
| 迁移前就不可用 | 不适用 | 不适用 | 不适用 | 拒绝迁移，宿主保持 stdio，原连接照常 |

### 对照画布 v5（界面验收）

画布链接当前读取失败（network error），逐项依据 `docs/plan/2026-10-05-mcp-official-sdk.md`「第 3、4 段界面」的文字描述：①迁移提示在卡顶部 ✓；②问句内容与「改之前会先备份；不改也照样能用到下个版本」✓；③按钮靠右、「以后再说」左、「改过去」右 ✓；④「已改好 N 个，原配置的备份放在各自旁边，重启它们后生效」✓；⑤卡底常驻浅色小字、不加底框 ✓；⑥文案 i18n zh/en、不出现 MCP/HTTP/口令/预算/价格 ✓。像素级对账：**unverified**（画布读不到）。
