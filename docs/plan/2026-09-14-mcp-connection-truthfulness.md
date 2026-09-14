# MCP 连接状态必须说真话（2026-09-14）

> 状态：✅ 已交付（PR `fix/mcp-connection-truthfulness-20260914`）。
> 起因：设置页逐控件审计 §⑤「链接 AI 助手 / MCP——真连还是假连」+ 必修 B1 / B4 / B5；用户拍板 §⑥ 第 6 条（可信发起方并进客户端卡）。
> 根因合同：[`../fixes/2026-09-14-mcp-connection-truthfulness.root-cause.json`](../fixes/2026-09-14-mcp-connection-truthfulness.root-cause.json)（recurring，带门表）。

## 背后逻辑（一句话）

「已接入 · 绿灯」这四个字此前有五种说谎方式；修法不是逐条打补丁，而是把**名单、写盘、读回校验**各收成一个 owner：名单只在注册表、写盘只经一扇门、状态只信读回来的东西。

## 先查别人

- **依赖里已有？** 没有：各家客户端的 MCP 配置只是普通文件，`node_modules` 里没有「写 ~/.claude.json」的库；Claude Code 官方 CLI `claude mcp add`（<https://code.claude.com/docs/en/mcp>）与 Codex `codex mcp add`（<https://learn.chatgpt.com/docs/extend/mcp?surface=cli>）是各自的写入口，但 Electron GUI 拿不到 shell PATH，见「规范对照」偏差理由。
- **仓库里已有？** 有，且就是病根：写盘门 `electron/capabilityCore/mcpConfig.ts:259`（`atomicWrite`，修前无守卫）、读路径写盘 `electron/capabilityCore/mcpConfig.ts:438`（`clientInfo` 内的自动迁移）、名单副本 `electron/capabilityCore/security.ts:35` / `src/ui/onboarding/assistantActivationState.ts:1` / `src/workbench/settings/settingsAutomationView.ts:42` / `src/workbench/production/productionRunView.ts:103` / `electron/integrationCertification/handoffQueue.ts:105`；自定义 profile 注册表 `electron/capabilityCore/mcpProfiles.ts:19` 与检测回流 `electron/capabilityCore/mcpDetectedClients.ts:37` 已存在，本 PR 复用不重造。
- **生态里已有？** 各家官方文档给的都是文件路径 + `mcpServers` 形状（Claude Desktop <https://modelcontextprotocol.io/quickstart/user>、Cursor <https://cursor.com/docs/context/mcp>、WorkBuddy 官方 MCP 指南）；跨客户端统一标准不存在（MCP 规范讨论 #681 / #1223 未采纳）；pi 官方 <https://pi.dev/docs/latest/usage> 明写无内置 MCP，`pi-mcp-adapter`（<https://github.com/nicobailon/pi-mcp-adapter>）是第三方读取 `~/.config/mcp/mcp.json`。
- **TikHub 自媒体里怎么说？** 本次没用 TikHub：这是纯 bug 修复（读路径写盘、状态不读回、名单漂移），判据来自官方文档与本仓门表，不是产品方向问题。
- **结论**：用已有（复用 profile 注册表 / 检测回流 / 各家官方文件形状），自研只在「名单 owner + 写盘门守卫 + 读回校验」三处，理由是这三件事在依赖与生态里都不存在（它们是 Nomi 自己的状态）。

## 范围

| # | 症状 | 根因（file:line，修前） | 修法 |
|---|---|---|---|
| B1 | 只打开「设置 → 自动化与权限」就改写 `~/.codex/config.toml`、`~/.claude.json`、`~/.cursor/mcp.json`、`~/.config/mcp/mcp.json`、`~/.workbuddy/mcp.json`（本机 5 个文件全指向死掉的 `/tmp/nomi-real-agent-20260913c`） | `mcpConfig.ts:438-441` `clientInfo()` 名字像读实为写；E2E 守卫只装在包装层 `repairStaleMcpConfigs()` `:500`，`readMcpInfo()` 绕过它 | 读路径零写盘：`clientInfo` 只读；修复只从 `repairStaleMcpConfigs` / `installMcp` 显式到达，且全部经唯一写盘门 `atomicWrite`；**隔离实例守卫下沉到那扇门**（R28）：`NOMI_E2E=1` 或 `NOMI_SETTINGS_DIR ≠ userData` 的实例，不许写真实用户主目录（`os.userInfo().homedir`，不是可被走查换掉的 `HOME`）下的宿主配置；HOME 已换成临时目录的走查照常可写 |
| 假绿 | `NOMI_SETTINGS_DIR` 写进配置后从不读回校验，指向已删除 profile 照样 `current` → 绿 | `sameLauncher` 只比 command+args（`:571-574`）；`classifyMcpEntry` 不看 profile | `sameLauncher` = command + args + **读回的 `NOMI_SETTINGS_DIR` 等于本实例设置根且目录存在**；不等 → `launcher-stale`（启动修复会指回来）；`verifyMcp` 在 spawn 前按同一判据判死（`not-installed` + `stale`）；UI 对已知过时形状不 spawn，直接按形状说「配置需要更新 → 升级接入」 |
| pi 假项 | `isMcpClientAppInstalled` 是 stub（`mcpDetectedClients.ts:78-85`），没装 pi 也会 `mkdir -p ~/.config/mcp` | 没有安装检测；`atomicWrite` 无守卫地 mkdir | 检测从注册表 `installMarkers` 派生（只 stat 官方目录，不 spawn 不建目录）；未检测到的不进一键列表；`installMcp` 对未检测到的客户端拒写（`client-not-installed`）；**pi 从名单删除**（官方 usage 明写 "intentionally does not include built-in MCP"，那一项写的是第三方 pi-mcp-adapter 才读的文件）；用 adapter 的人走「其他客户端 · 复制通用配置」 |
| B4 | 「复制配置」发出已签名的 Claude Code 身份（`ConnectAssistantCard.tsx:423-433`） | 复制的是当前选中客户端的 `client.snippet`（含 `NOMI_MCP_CLIENT` + HMAC） | 卡尾常驻「其他客户端 · 复制通用配置」：`genericMcpSnippet(info.server)`（无身份，能力核判 `external`）；模型页「用 AI 帮我接入 → 其它」复制的是**同一个函数**（`src/ui/onboarding/mcpGenericSnippet.ts` 唯一 owner，`aiAssistedOnboardingContent.ts` 里那份删除）；检测到的客户端在未接入态另有「复制 {{client}} 配置」（身份 = 它自己） |
| B5 | 客户端名单 5 份硬编码 + 2 份漏抄（`handoffQueue.ts:105` / `integrationSessionRecord.ts:84` 少 pi、workbuddy → WorkBuddy 的 handoff 永远 "Invalid handoff owner"） | 没有 owner；`SettingsHostKey` 放宽成 `string` 后编译器不再拦 | **`electron/shared/mcpClientRegistry.ts` 唯一 owner**：label / format / 配置路径（按平台）/ 安装痕迹 / 默认信任 / 宿主自身审批 / 规范链接；`security.ts` 转出口、`mcpConfig` / `mcpDetectedClients` / `automationPolicyContract`（默认 trustedHosts）/ `assistantActivationState` / `productionRunView` / `ProductionRunTaskCard`（发起方标签）/ `mcpProtocol`（自报名猜测）全部 derive；合入分支 `fix/mcp-handoff-builtin-clients-20260911`（a13cf82a6）的两处；门岗 `electron/shared/mcpClientRegistry.test.ts`：src/electron 里再出现 ≥3 个内置 key 的数组即红（`check:vocabularies` 只扫状态/阶段词表，扫不到客户端名单，故在此钉） |
| R31 | Claude Code 整文件重写有清空风险；Claude Desktop 缺失 | `readJsonConfig` 吞解析错误回 `{}`（`:271-277`） | 文件存在但不是合法 JSON 对象 → **拒写**（`config-unreadable`），不再当空文件整份重写；新增 `claude-desktop`（官方 `claude_desktop_config.json`）；`resolveClient` 不认识的 key 不再回落成 `claude` |
| §⑥-6 | 「可信发起方」独立成栏，与连接页两处管同一件事 | `AutomationPermissionsSection.tsx:246-268` + `settingsAutomationView.ts:42` HOSTS | 栏删除；开关并进每张客户端卡（`data-assistant-trust-row`）；`toggleHost` 仍是唯一写入口，经 `onTrustChange` 下传 |

## 不动项

- 各家配置文件的**形状**（`mcpServers.nomi` / `[mcp_servers.nomi]`）、合并语义、备份、原子写；Codex 三个显式超时/审批键。
- 自定义 profile 注册表（`listCustomMcpProfiles` 等 IPC）与检测回流：仍在，仍无 UI（CustomMcpClientCard 等 R8 样张拍板，本 PR 不改产品形态）。
- 「用 AI 帮我接入」卡的三段（WorkBuddy / Codex / Claude Code / 其它）与顺序（设计定稿 §Main）。
- 词表 `McpConfigState` / `McpVerifyReason` 的**成员集**：本 PR 只把它们收敛到中立契约层 `electron/shared/mcpConnectionContract.ts`（四条 debt 退役、cap 67→63）；`check:vocabularies` 要求收敛记录的成员与被退役的 debt 逐字相同，所以「profile 指错」归入既有的 `launcher-stale`（launcher = 能启动**这一个** Nomi 的条目：command + args + profile），不新增成员。

## 规范对照（R31：规范链接 / 我们的偏差 / 偏差理由）

| 客户端 | 规范 | 我们写什么 | 偏差 | 理由 |
|---|---|---|---|---|
| Claude Code | <https://code.claude.com/docs/en/mcp>：user scope = `~/.claude.json` 顶层 `mcpServers`；官方推荐 `claude mcp add --scope user … -- <cmd>`，文档称「无需手改这些文件」但未禁止 | `~/.claude.json` 顶层 `mcpServers.nomi`，合并写 | 不走 `claude` CLI，直接合并写文件 | 领域约束：Electron GUI 进程在 macOS 上拿不到用户 shell 的 PATH，`claude` 对 GUI 大多不可见，走 CLI = 一键接入在这些机器上静默失败。代价：与 Claude Code 自身写入之间有极小 lost-update 窗口（写前重读 + tmp→rename，窗口 = 一次 rename）；**解析失败即拒写**，不再可能清空文件 |
| Claude Desktop | <https://modelcontextprotocol.io/quickstart/user>：macOS `~/Library/Application Support/Claude/claude_desktop_config.json`，Windows `%APPDATA%\Claude\claude_desktop_config.json`，键 `mcpServers` | 同上路径，`mcpServers.nomi` | 无 | — |
| Codex CLI | <https://learn.chatgpt.com/docs/extend/mcp?surface=cli>（`developers.openai.com/codex/mcp` 308 到此）：`~/.codex/config.toml` `[mcp_servers.<name>]` command/args/env；`startup_timeout_sec` 默认 10、`tool_timeout_sec` 默认 60、`default_tools_approval_mode` ∈ auto/prompt/writes/approve；CLI `codex mcp add <name> --env K=V -- <cmd>` | `[mcp_servers.nomi]` + 三个显式键 | 块级文本合并、不走 CLI | 同上 PATH 约束；块级合并只换我们自己的表（登记表 `codex-mcp-config-toml` 已有） |
| Cursor | <https://cursor.com/docs/context/mcp>：`~/.cursor/mcp.json`，键 `mcpServers` | 同 | 无 | — |
| WorkBuddy | 官方 MCP 指南：`~/.workbuddy/mcp.json`，键 `mcpServers` | 同 | 无 | — |
| pi | <https://pi.dev/docs/latest/usage>："intentionally does not include built-in MCP"；`pi-mcp-adapter`（第三方）读 `~/.config/mcp/mcp.json` 等 | **不写** | 从一键名单删除 | 没有官方 MCP 就没有官方格式；`~/.config/mcp/mcp.json` 不是任何一方客户端的标准（登记表 `mcp-servers-config` 的「通用」措辞已改正） |

## 验收门

- 失败测试先复现（`electron/capabilityCore/mcpConfig.test.ts`）：读路径两次读取字节不变；`NOMI_E2E=1` / `NOMI_SETTINGS_DIR≠userData` 下 repair / install / uninstall 三条路对真实主目录全部拒写；HOME 已换临时目录时照常可写；profile 指错 → `launcher-stale` 且启动修复指回；坏 JSON 拒写；未知 key 不回落 claude；未检测到的客户端不写、不建目录；`claude-desktop` 走官方路径。
- `electron/capabilityCore/mcpVerify.test.ts`：profile 指错 → `not-installed` + `stale`，不 spawn。
- `electron/shared/mcpClientRegistry.test.ts`：单一 owner 扫描。
- 真机走查 `tests/ux/mcp-connection-truthfulness.walk.mjs`（隔离 HOME）：开设置页两次字节不变 / WorkBuddy 未检测到不出现且目录不被建 / 通用配置无身份 / 开关翻 trustedHosts / 死 profile 显示需更新并一键修回 / 撤销后别人的字段原样。
- 真实主目录只读证据：隔离实例（HOME 真、settings 临时）开两次设置页，本机 5 个文件 md5 前后一致（scratchpad/mcp-truth/report.md）。

## 回滚

单 PR，无数据迁移；旧配置（含指向死 profile 的）由启动修复自动指回，revert 后回到「读路径写盘」的老行为。
