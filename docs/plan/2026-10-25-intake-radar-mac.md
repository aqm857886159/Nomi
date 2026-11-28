# 反馈雷达 Mac 凭据收口（2026-10-25）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 任务书：`/Users/aoqimin/Nomi-coord/Nomi-service/coord-handoff/briefs/20261023-mac/I-intake-mac.md`。
> 根因合同：[`2026-10-25-intake-radar-mac-credentials.root-cause.json`](../fixes/2026-10-25-intake-radar-mac-credentials.root-cause.json)。

## 用户那一刻卡在哪

SessionStart 的用户反馈雷达在这台 Mac 上一直失败，用户只能看到“今天没查成”，不知道是找不到配置、登录过期，还是 `npx` 超时。旧实现自己猜 Wrangler 配置路径并直接读 TOML：Mac 的实际路径漏掉，过期 access token 也不会刷新；没有本机安装时还要冷启动 `npx wrangler whoami`。

## ★0 先查别人

| 出处 | 它怎么做 | 对哪个决定的影响 |
|---|---|---|
| [Cloudflare Wrangler general commands](https://developers.cloudflare.com/workers/wrangler/commands/general/)（2026-10-25） | `wrangler auth token --json` 输出 token 类型；OAuth 登录态过期时自动刷新；没有认证方式时命令报错。 | 采用官方命令作为 token 唯一入口，删掉本地 TOML 解析与手写路径。 |
| [Cloudflare Wrangler auth/keyring 文档](https://developers.cloudflare.com/workers/wrangler/commands/general/)（2026-10-25） | 默认凭据在全局 Wrangler 配置目录，`--use-keyring` 可转到 macOS Keychain、Linux libsecret、Windows Credential Manager；`whoami` 只展示文本状态。 | 不再读取 `default.toml`/`default.enc`，Mac Keychain 和三平台后端交给 Wrangler；账号 ID 继续解析 `whoami` 文本。 |
| [`global-wrangler-config-path.ts`](https://github.com/cloudflare/workers-sdk/blob/main/packages/workers-utils/src/global-wrangler-config-path.ts) 与 [`xdg-app-paths.ts`](https://github.com/cloudflare/workers-sdk/blob/main/packages/workers-utils/src/xdg-app-paths.ts)（2026-10-25） | Wrangler 的源码先用存在的旧 `~/.wrangler`，否则走 XDG：macOS `~/Library/Preferences/.wrangler`，Linux `~/.config/.wrangler`，Windows `%APPDATA%/xdg.config/.wrangler`；`XDG_CONFIG_HOME` 可覆盖。 | 证明旧路径解析必须完整复刻才不会漏平台，但官方 token 命令能直接承接这套规则，因此不复制它。 |

结论：Wrangler 已提供非交互 token 命令且会刷新 OAuth；采用它，不保留猜测路径。`whoami` 没有文档化的 `--json`，仅保留账号 ID 的无机密文本解析。

## ★1 用户怎么用

SessionStart → intake 脚本调用 `npx wrangler auth token --json` 取当前 bearer token（内存），再用 `NOMI_CF_ACCOUNT_ID` 或 `npx wrangler whoami` 取账号 ID。登录过期 / 未登录时，错误直接写“wrangler 登录已过期（或没登录）——跑 `npx wrangler login` 后重试”；命令超时直接写超时原因与下一步。token、refresh token、账号 ID 永远不进日志、报错、快照或报告。

不新增界面、不改变雷达缓存和增量语义、不跑真实反馈数据。

## ★2 谁说了算

概念 `intake-radar.credentials` 的唯一 owner 是 `scripts/lib/intake-radar/cloudflare.mjs#authTokenFromWrangler`：它只执行官方命令、解析 `{type, token}`、在失败时生成不含机密的可行动错误。`resolveCredentials` 只编排 token 与账号 ID；`whoamiAccountId` 仍是账号 ID 的唯一解析口。

门表：实现后用 `node scripts/door-map.mjs --roots=scripts resolveCredentials authTokenFromWrangler parseWranglerAuthToken whoamiAccountId parseAccountIdFromWhoami` 生成，合同粘贴修后门表。

## ★3 一致与复用

复用 Wrangler 自己的认证生命周期、刷新、Keychain/XDG/旧目录优先级和环境变量优先级；本仓只保留账号 ID 的文本解析和 REST bearer header。删除 `wranglerConfigCandidates`、`parseOAuthTokenFromToml`、`readWranglerOAuthToken` 及 `WRANGLER_HOME` 覆盖，不留并行 fallback。

## ★4 全状态

| 状态 | 结果 |
|---|---|
| OAuth 有效 / 可刷新 | 取到内存 token，继续拉取。 |
| OAuth 过期或未登录 | 明说登录已过期（或没登录）及 `npx wrangler login`。 |
| 只有 API token | 官方 JSON 的 `token` 直接使用。 |
| 只有 API key/email | 没有 bearer token，按无可用 token 失败，不打印 key/email。 |
| `npx wrangler auth token --json` 超时 / 启动失败 | 明说命令与超时 / 启动原因，提示检查环境并重试；不回退读文件。 |
| `whoami` 账号解析失败 | 明说登录状态或 `NOMI_CF_ACCOUNT_ID` 下一步；不打印账号值。 |
| SessionStart 注入 | 现有 hook 继续附带脚本 stderr/stdout 尾巴；因此用户能看到上述原因，不改缓存成功语义。 |

## ★9 验收与反例（动手前写全）

验收：

1. `cloudflare.node-test.mjs` 覆盖官方命令在 macOS / Linux / Windows 三个命名格、有效 JSON、过期 / 未登录错误、超时错误、错误文案不含 token / refresh token / 账号 ID；旧 TOML 路径解析函数不再存在。
2. `node scripts/daily-radar-session.node-test.mjs` 的失败尾巴保留并能呈现脚本错误；逐项核对“过期 / 未登录”“命令超时”“账号解析失败”三类下一步。
3. 变异副本：删掉 Mac 命名格 → 对应测试红；把登录错误改回“拿不到登录态” → 对应测试红；把 timeout 文案改回裸退出码 → 对应测试红。
4. `pnpm run test:intake-radar`、每日会话测试、改动文件 eslint、根因合同、逃逸账本、概念主人检查和正文 precheck 全绿。

反例：

- 把官方命令换回读取 `~/Library/Preferences/.wrangler/config/default.toml`，Mac 有效路径格必须红。
- 去掉 `npx wrangler login` 或把过期 / 未登录合成旧的“拿不到登录态”，错误契约必须红。
- 将 fake token / refresh token / fake account ID 拼进错误或 SessionStart 尾巴，机密泄露断言必须红。
- `auth token --json` 超时后回退 TOML，结构与行为测试必须红。

### 功能分类

- [ ] 花钱
- [ ] 新界面 / 改交互
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [ ] 新增功能 / 性能

回滚：revert 本次合并提交即可；没有新增持久数据，旧缓存文件不受影响。真雷达端到端与真实反馈数据留给协调会话按停点执行，本线不碰。
