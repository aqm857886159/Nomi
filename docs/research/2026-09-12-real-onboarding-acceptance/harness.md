# 验收台（本次真实走查用的脚本与环境）

被测树：`test/real-onboarding-acceptance-20260912`
= `origin/feat/mcp-onboarding-tool-face-20260911`（PR #754）
+ merge `d5024dada57205428f3d525629cce588a6280450`（`feat/model-onboarding-two-paths-20260911`，15 个本地提交，未推）

构建：`pnpm install --frozen-lockfile` + `pnpm build`（dist-electron + dist）。

隔离：每个司机一套 profile（settings / projects / capability / user-data）。

**D4 —— `HOME` 不能换**：第一版走查把 `HOME` 也指到隔离目录，结果贴 key 时 Nomi 报
`System secure storage is unavailable; the API credential was not saved.`（截图 `codex-v1-key-after-1.png`）——
macOS 的 safeStorage 要用 `$HOME/Library/Keychains` 下的登录钥匙串。所以最终版**保留真实 HOME**：
产品「一键接入」写进用户真实的 `~/.codex/config.toml` 与 `~/.claude.json`，动手前已备份、跑完已还原；
真正喂给司机的是这两份的**副本**（`ro-patch.mjs` 改成指向被测树的 launcher，并补上
`NOMI_CAPABILITY_DIR` / `NOMI_PROJECTS_DIR` / `NOMI_SETTINGS_DIR` 三条隔离 env）。

- codex：`/tmp/nomi-real-onboard/codex/{home,settings,projects,capability,user-data,agent-cwd}`
- claude：`/tmp/nomi-real-onboard/claude/...`

脚本（留在 `/tmp`，不进产品树）：

| 文件 | 作用 |
|---|---|
| `/tmp/ro-lib.mjs` | 用仓里 `tests/ux/_launchApp.mjs` 起隔离实例、截图、导出 DOM |
| `/tmp/ro-phase2.mjs` | 模型页选宿主 → 点「复制指引」→ 读剪贴板 → 点「去接入」 |
| `/tmp/ro-phase4.mjs` | MCP 面板里点「一键接入 <宿主>」，核对写出的配置 |
| `/tmp/ro-patch.mjs` | 把一键写出的配置改指向**被测树**的 launcher，并补隔离目录 env（见缺陷 D2/D3） |
| `/tmp/ro-run.mjs` | 多回合真实旅程：起 app → 起 codex → 每 3s 服务一次界面（该我点的我点） |
| `/tmp/ro-run-claude.mjs` | 同上，司机换成 Claude Code CLI |
| `/tmp/ro-score.mjs` | 用**真服务器返回的 inputSchema**（`tools/list` 抓下来的）逐调用判入参对错 |

Key 纪律：`~/.nomi-secrets.env` 只 `source` 进跑脚本的 shell，脚本从 `process.env.DEEPSEEK_API_KEY`
直接 `fill()` 进 Nomi 设置页的密码框。Key 的值没有出现在任何提示词、配置、日志、截图或本报告里。
