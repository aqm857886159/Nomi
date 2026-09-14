# 读路径不许写盘：一个「像读实为写」的函数把本机 5 个 MCP 客户端配置指向了死掉的 /tmp profile

- 日期：2026-09-14　状态：✅ 已修（PR `fix/mcp-connection-truthfulness-20260914`）
- 场景：D（排查与平台故障）/ A（走查）

## 结论
1. **读状态的函数不许有写盘副作用**，守卫要装在唯一的写盘门上，不是某个包装层——`readMcpInfo → clientInfo` 绕过了 `repairStaleMcpConfigs` 的 `NOMI_E2E` 守卫，只是打开设置页就把真实 `~/.claude.json` / `~/.codex/config.toml` / `~/.cursor/mcp.json` / `~/.workbuddy/mcp.json` / `~/.config/mcp/mcp.json` 全改成指向那次隔离实例的临时目录。修复期间另一个并行会话的走查在 11:28:39 又改写了一次——同类问题就是这样从别的调用者回来的。
2. **写下去的值必须读回校验**：`NOMI_SETTINGS_DIR` 写进配置后没人再看，指向已删除 profile 的配置照样绿灯，助手连上的是空白 Nomi。
3. **隔离实例的判据用 `os.userInfo().homedir`（passwd 那份）判「真实主目录」**，别用 `HOME`——走查会把 `HOME` 换成临时目录，那种写是无害的，也必须放行。
4. 一份名单被 N 处手抄就迟早漏一处（`workbuddy` 漏抄 → `Invalid handoff owner`）；owner 只能有一个，而且要有会响的检测器（`electron/shared/mcpClientRegistry.test.ts` 扫全仓）。

## 怎么避
- 动宿主配置前先 `node scripts/door-map.mjs atomicWrite`，读门里出现写符号就是病根。
- 跑任何隔离实例前备份本机 5 个客户端配置、跑后 md5 比对（`scratchpad/mcp-truth/probe-real-home.mjs` 是现成探针）。
- 本机这 5 个文件现在仍指向 `/tmp/nomi-real-agent-20260913c`（审计前的值）：装了本 PR 的正式 Nomi 启动时会自动修回（launcher-stale → 备份 → 重写）。
