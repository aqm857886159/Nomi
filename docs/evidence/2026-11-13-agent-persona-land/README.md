# Agent 形象并 main 后的真窗证据（2026-11-13，L-land-agent-persona）

分支 `feat/agent-persona-land`（并上 origin/main a11ff65d6 之后）的打包构建，隔离资料目录，真 Electron 窗口，没起真 Agent（小球状态由 E2E 桥写进角标投影，和 shell-redesign 走查同一种写法）。截图都亲眼看过。

| 目录 / 文件 | 是什么 |
|---|---|
| `crops/land-<状态>-<语言>-light-<宽>.png` | 小球裁图：idle / running / needs-confirm / done / failed / unread / unread-max（未读 99999）/ hover（悬停抬眼）/ dragging（按住拖动中）/ reduced-running（减弱动效下的在跑）；zh / en × 1280×800 / 1100×720（最小窗口） |
| `window/` | 整窗：等你确认、未读、面板打开（最窄窗口 + 英文时小球收起，输入框和发送键在最上层、焦点在输入框） |
| `edges/` | 四角四边各拖一次后的小球位置（1100×720，中英） |
| `dark/` | 暗色下 shell-redesign 的形象段裁图（中英，含焦点描边、跟随、减弱动效） |
| `boundary.json` | 四角四边、未读极大、拖完弹不弹面板、面板打开时的几何与命中，4 组（zh/en × 1280/1100） |
| `idle-10s.json` | 鼠标不动空闲 10 秒：rAF 请求、长动画帧、长任务、运行中的动画（全 0） |
| `perf-eye-follow-1.json`、`-2.json` | 性能场景 `agent-ball-eye-follow` 只量不写基线的两次原始结果 |

身份行（`NomiIdentityRow`）在生产里没有挂载点，真窗看不到；它的样子见 `docs/evidence/2026-11-07-agent-persona/identity-row/`（组件级截图）。

main 上同样几张旧形象截图放在协调目录 `/Users/aoqimin/Nomi-coord/tmp/L-land-agent-persona/before/`，并排图同目录 `sbs-*.png`（不进仓库）。
