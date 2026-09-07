# PR #576「pi 一键接入」零额度真机验收（2026-09-07）

> 状态：📎 交接/日志 —— **只验收不改码，一行产品代码未动。**
> 日期：2026-09-07 · 被验对象：`origin/main@92c94b37a`（含 [#576](https://github.com/aqm857886159/Nomi/pull/576)）
> 实测环境：`@earendil-works/pi-coding-agent@0.85.1`（与 `package.json` 锁的版本一致）· `pi-mcp-adapter@2.32.1` · Node v24 · darwin 25.5.0
> 隔离：全程 `HOME=/private/tmp/pi-verify-home`、全局前缀 `/private/tmp/pi-verify-prefix`，**没碰用户真实 `~/.config` / `~/.pi` / 真实项目库**；一次付费额度都没花。
> 上游背景：#576 落点与格式当时只有 **README 实读**做依据，没有装过 pi。本篇把那条从「按文档推测」升级成「实跑证据」。

---

## 0. 一句话先答

**#576 的落点是对的——`~/.config/mcp/mcp.json` 就是 pi-mcp-adapter 自己代码里的第 1 优先级读取路径，Nomi 写进去的条目被 pi 原样读到、连上、列出 33 个 `nomi_*` 工具，与卡片声称的数字逐个对上。无需修复。**

---

## 1. 装成没有

| 项 | 结果 |
|---|---|
| `npm install -g --prefix … @earendil-works/pi-coding-agent@0.85.1` | ✅ 165 包，20s，无告警 |
| `pi install npm:pi-mcp-adapter` | ✅ 装成 2.32.1，**没有 peer 冲突**——README 声明的 peer `@earendil-works/pi-ai: ^0.84.1` 与实装的 0.85.1 **没有把安装卡住**，不需要 `--force`，不需要退版本 |

装完 `~/.pi/agent/settings.json` = `{"packages":["npm:pi-mcp-adapter"]}`。

## 2. 路径一致吗——用适配器自己的代码问，不是读 README

README 会骗人（教训：`kie-file-upload-real-contract` 里官方文档三处是假的），所以这里不引用 README 的表格，而是直接 import 适配器 `dist/config.js` 让它自报：

```
getSharedConfigPath('global') = <HOME>/.config/mcp/mcp.json
--- discovery paths（按优先级）---
  exists=true   user-global standard MCP        <HOME>/.config/mcp/mcp.json      ← #576 的落点
  exists=false  user-global .agents MCP         <HOME>/.agents/mcp.json
  exists=false  user-global .agents nested MCP  <HOME>/.agents/mcp/mcp.json
  exists=false  Pi global override              <HOME>/.pi/agent/mcp.json        ← #576 特意不碰
  exists=false  project standard MCP            <CWD>/.mcp.json
  exists=false  project Pi override             <CWD>/.pi/mcp.json
loadMcpConfig() servers = [ 'nomi' ]
```

**结论：一致。** `mcpConfig.ts:69` 的 `pi` 档写的就是 `shared-global` 那一格，而且是六层里最先被扫到的一层。#576 代码注释里「不写 `~/.pi/agent/mcp.json`，那是 adapter 的 override 层」的判断也被证实——那一格在适配器眼里叫 *Pi global override*，与共享层分属两类。

## 3. Nomi 真写一次 + pi 真读到

`tests/ux/mcp-pi-client-profile.walk.mjs` 在**本地开发构建**上跑：`MCP PI PROFILE WALK PASS`。写出的条目（`HOME` 指临时目录）：

```json
{ "mcpServers": { "nomi": {
  "command": "/Applications/Nomi.app/Contents/Frameworks/Nomi Helper.app/Contents/MacOS/Nomi Helper",
  "args": ["/Applications/Nomi.app/Contents/Resources/app.asar/dist-electron/capabilityCore/mcpNodeLauncher.js"],
  "env": { "ELECTRON_RUN_AS_NODE": "1", "NOMI_MCP_STDIO": "1",
           "NOMI_MCP_CONFIG_VERSION": "3", "NOMI_MCP_CONFIG_KIND": "packaged",
           "NOMI_MCP_CLIENT": "pi", "NOMI_MCP_CLIENT_PROOF": "…" } } } }
```

⚠️ **一条容易误判的观察**：跑的是开发构建，写出来的却是 **packaged** 条目、指向 `/Applications/Nomi.app`。这不是 bug——`mcpConfig.ts` 的 `launcherEntry()` 在非打包态会先试 `installedMacLauncher()`，这台机器装了 Nomi 0.21.0 就命中了它。想验「指向仓库 `dist-electron/` 的那条 development 分支」，必须在**没装 Nomi.app** 的机器上跑，否则量到的永远是 packaged 那支。

把这份文件与配套 capability token 原样搬进 pi 的临时 `HOME` 后，适配器的 `loadMcpConfig()` 读到的 `mcpServers.nomi` 与 Nomi 写的**逐字段相同**。

## 4. 起得来吗 + 工具数对得上吗

**① 直连握手**（按 pi 会用的方式 spawn 同一条命令行）：

```
initialize OK: {"name":"nomi-capability-core","version":"0.1.0"}  caps=[tools, resources, prompts]
TOOL COUNT = 33      nomi_ 前缀 = 33
```

**② 经 pi 本体**（`pi` 交互态 → `/mcp` 面板；模型 key 故意给假的，模型调用 400 失败、零花费，但 MCP 这条链与模型无关）：适配器自己的元数据缓存 `~/.pi/agent/mcp-cache.json` 写出

```
servers: ['nomi']   nomi: tools=33
```

**33 = 33 = 卡片上的 33**，三处独立来源对上。33 个工具全名见 会话 scratchpad `mcp-pi-client/pi-mcp-list.txt`（含三处来源的完整终端输出）。

> 备注：适配器默认**懒连**（不调工具就不连），所以 `pi -p` 一次性模式跑完即退、缓存不会填。要让它在启动期就连上，测试侧给条目加了 `"directTools": true`——**这是验收 harness 的临时开关，不是 Nomi 写出的字段**，产品条目里没有它。

## 5. 没做成 / 未覆盖的

- **没验 development 那支落点**（原因见 §3 的 ⚠️）——需要一台没装 `/Applications/Nomi.app` 的机器。
- **跨平台落点：已实测排除，不是风险。** 一度怀疑「适配器若认 `XDG_CONFIG_HOME`，我们硬拼 `os.homedir()/.config/mcp` 就会落空」，实测证伪：适配器 `dist/config.js:12` 是模块加载期的常量 `join(homedir(), ".config", "mcp", "mcp.json")`，**完全不读 `XDG_CONFIG_HOME`**——设了该变量后解析结果一字不变。两边都以 `homedir()` 起头，**落点按构造在所有平台恒等**（Windows 上同为 `C:\Users\<u>\.config\mcp\mcp.json`），不需要额外探针。
- **没在真 Windows / Linux 上跑过整条链**（上一条只证明了路径推导恒等，没证明 Nomi 的 launcher 在那两个平台起得来）。
- **没跑任何付费生成**：只做到 `tools/list`，没调用任何 `nomi_*` 工具。

## 6. 清理

`/private/tmp/pi-verify-*` 与临时 worktree 已删；用户真实 `~/.config/mcp/mcp.json` 全程不存在（已核）。
