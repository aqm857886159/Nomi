# 打包版 MCP 接入修复：app 自身二进制以 stdio 模式跑 MCP server

> 2026-06-24。修「在 Nomi 点『一键接入 AI 编程助手』后，Claude Code / Codex 在 Mac arm64 上连不上」
> （MCP 握手 `connection closed: initialize response` / `MCP error -32000: Connection closed`）。

## 根因（实证，file:line）

`electron/capabilityCore/mcpConfig.ts:36-39` `mcpServerEntry()` 写入各客户端的启动命令是：

```ts
const script = path.join(app.getAppPath(), 'scripts', 'nomi-mcp.mjs')
return { command: 'node', args: [script] }
```

打包版 `app.getAppPath()` = `.../Nomi.app/Contents/Resources/app.asar`。两处叠加硬伤（代码注释自标「后续切片」）：

1. **脚本不在包里**：`package.json` `build.files` 白名单只含 `dist/** dist-electron/** public/** build/icon.*`，**不含 `scripts/**`** → `app.asar` 里没有 `nomi-mcp.mjs`。`node` 启动不存在的模块即刻退出 → 客户端 stdio transport 在 `initialize` 响应前读到 EOF → 报「Connection closed」。
2. **传输层打包即抛**：即使脚本在，`scripts/lib/nomiClient.mjs:87` 的 `callViaHost` 在打包版 `require('electron')` 抛「找不到 electron 可执行文件（…后续切片）」；且 `command:'node'` 依赖用户 PATH 有 node（多数人没有）。

dev 下 `app.getAppPath()` = repo 根，脚本存在、有 node → 能用，所以只在打包版炸。

## 已经能用的部分（无需动）

- RPC server + `instance.json` 广告在打包版 GUI 启动时**无条件**起（仅受单实例锁门控，非 dev flag）——`appIntegration.ts:31-46` / `main.ts:481`。即 **A 模式（GUI 开着走 RPC + 实时确认卡）打包版本就成立**。
- headless host（`host.ts`）已编进 `dist-electron`、已在 asar 里、用 app 自带 Electron 跑——证明能力核能纯 headless 在进程内跑（`dispatch` + `createDiskGateway`），无需渲染窗口。
- 付费铁律三态网关（`gateway.ts`）完好：渲染层卡（A）/ env `NOMI_LOOP_SPEND_OK`（B headless）/ 混合。enforcement 在 `runtime.ts` 硬闸（`assertAndConsumeSpendGrant`），模型设不了 env → 信任边界不破。

**结论**：只差「启动入口」这一层。把入口从「node + asar 里的脚本」换成「app 自身二进制 + stdio 模式」即根治。

## 方案（唯一正解）

让 Nomi 用**自己的可执行文件**以一个 env 门控的「MCP stdio 模式」启动，进程内跑 MCP server：

- `command = process.execPath`（打包版即 `/Applications/Nomi.app/Contents/MacOS/Nomi`；dev 即 node_modules 的 electron）
- `args = app.isPackaged ? [] : [app.getAppPath()]`（dev 需指明 app 路径让 electron 找到 main）
- `env = { NOMI_MCP_STDIO: '1' }`

main 进程早期识别 `NOMI_MCP_STDIO`：**不抢单实例锁、不开窗、不起 IPC/CSP**，只 `app.whenReady` 后跑 stdio JSON-RPC server。

传输（进程内，复刻 `nomiClient.invoke` 的 A/B 自适应，但不 spawn 子进程）：
- `readLiveInstance()` 活（GUI 开着）→ 转发给 GUI 的 RPC（`127.0.0.1:port` + 广告里的 token）。**写经 GUI 的网关**（避免第二写者撞正在编辑的工程）、生成弹 GUI 实时确认卡。
- 没开 → 进程内 `dispatch(method, params, { runTask, fetchTaskResult, makeGateway })`，磁盘网关（本进程是唯一写者，安全）。付费生成经 MCP elicitation 让真人在 Claude 侧确认 → 确认后用「铸令牌网关」放行本次（不碰全局 env）。

## 改动清单

| 文件 | 改动 |
|---|---|
| `electron/capabilityCore/mcpProtocol.ts` **新** | 纯协议层：9 个 `nomi_*` 工具表 + JSON-RPC 2.0 handler（initialize/tools.list/tools.call/ping）+ 付费 elicitation。传输注入（`{ send, invoke, isAppOpen }`），不绑 electron → 可裸 node 单测（保住 elicitation 握手测试）。从 `scripts/nomi-mcp.mjs` 平移。 |
| `electron/capabilityCore/mcpStdioServer.ts` **新** | electron 接线：stdin/stdout transport + 进程内 invoke（RPC 转发 / 进程内 dispatch）+ `console.*` 重定向到 stderr（防污染 JSON-RPC stdout）+ stdin EOF 即退出 + `app.dock.hide()`。 |
| `electron/capabilityCore/mcpConfig.ts` | `mcpServerEntry()` 改 app 二进制 + `NOMI_MCP_STDIO`；`server` 类型加 `env?`；JSON/TOML 写入器输出 `env`。 |
| `electron/main.ts` | 顶部 `isMcpStdio` 分支：跳过单实例锁块、跳过 GUI whenReady（已由 `hasSingleInstanceLock=false` 自动跳）、加 stdio whenReady。 |
| `scripts/nomi-mcp.mjs` **删** | 被 bundled server 取代（P1 不留并行版）。CLI `scripts/nomi.mjs` 保留（不同运行时，dev 工具）。 |
| `electron/capabilityCore/mcpConfig.test.ts` | 断言新 shape（command=execPath、env.NOMI_MCP_STDIO）。 |
| `electron/capabilityCore/nomiMcpElicitation.test.ts` | 改打纯协议层 `mcpProtocol.ts`（注入假 invoke），不再 spawn 脚本。 |

不动 `package.json`（`dist-electron/**` 已在白名单，新 TS 自动编入）。

## 风险

- **stdout 污染**：Electron/Chromium 日志若进 stdout 会毁 JSON-RPC 帧。Chromium 日志走 stderr；再把我们自己的 `console.*` 在 stdio 模式重定向到 stderr，stdout 只出 JSON-RPC。
- **单实例锁**：stdio 进程绝不能 `requestSingleInstanceLock`（否则 GUI 在跑时它会判定为第二实例 `app.quit()`）。分支在锁之前。
- **dev 路径**：dev 配置指向 dev electron + repo 根，需 `dist-electron` 已构建才可用；dev MCP 接入是边角，打包版才是用户实际命中的。

## 验收（P3：全绿≠完成）

1. 五门全过。
2. **真打包**：`electron-builder` 出 arm64 dmg → 装 `/Applications`。
3. **真握手**：`echo '{...initialize...}' | NOMI_MCP_STDIO=1 /Applications/Nomi.app/Contents/MacOS/Nomi` → 收到合法 `initialize` 响应 + `tools/list` 列出 9 工具（证明握手不再 close）。
4. **真客户端**：写配置 → `claude mcp list` / 实际 `claude` 连 nomi 成功；Codex 同验。
5. GUI 开着时经 MCP 读项目/读画布实时反映；付费生成弹确认卡。
