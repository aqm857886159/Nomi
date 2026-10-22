# 交接：PR 盘点线 → 现任协调会话（2026-10-22）

📎 交接单。用户 2026-10-22 原话：「协调给他吧」。本线（会话「PR 审查与项目定位策略」）从此不再合并、不再派新线，只把在途的东西交到这里。

## 一、已经落地（有合并收据）

| PR | 内容 | 合并提交 | 收据 |
|---|---|---|---|
| #1254 | concept-owners 清 86 处红灯、改回挡合并 | 5a6d1c9d6 | 该提交 Quality Gate 红：#1255 的非法 lifecycle 被新门扫出。由 #1261 修复，内容随 6389dff0a 落地 |
| #1261 | 修 main 红灯：`agent.canvas-read-shot-table` 的 lifecycle 改为 `projection` | 6389dff0a | ✅ |
| #1256 | 派生节点落点按渲染占位避让（补登记 3 处边界；perf 中位 79.1 / p95 96.3 / 预算 100） | 439460001 | ✅（首跑 Canvas Acceptance 偶发「Execution context was destroyed」，同一棵树在 PR 上过，重跑转绿） |
| #1196 | 大画布诊断文档与证据 | 9adca4202 | ✅ |

已关闭（都留了理由）：#1219（与 09-25「程序不移动视口」冲突）、#1179（6.3 万行原始证据不入库）、#887（166 篇横幅）。#1140 已留言请外部作者 rebase，两周无回应可关。

## 二、在途，需要协调接手

| 项 | 状态 | 卡在哪 | 推荐 |
|---|---|---|---|
| #1263 多选发给 Agent 时静默截断（`projectAgentContextSnapshot`） | CI 全绿，merge-preflight 干净 | 真模型数字 `unverified`：本机唯一的 `DEEPSEEK_API_KEY` 返回 402 余额不足；量具 `docs/evidence/2026-10-21-agent-selection-truncation/probe.mts` 已备 | 用户决定充值 / 换 key / 接受 unverified 后再合 |
| #1283 look_at_canvas「当前选中」行截断（分支 `fix/look-at-canvas-selection-truncation`） | 门岗全过（full 档，041bb577b），23 个新测试本线复跑通过，merge-preflight 干净 | 同样缺真模型数字；碰 P1 热点（`verbs/` 14 天第 3 个 fix + 自写登记 `gate-family`），复盘 `docs/engineering/direction-check/2026-10-22-model-facing-projection-accounting.md` 第 6、7 节提了两问 | 两问都推荐不改：翻页用无状态偏移，不上游标；暂不抽共享的「有账有界列表」原语，等第三处出现再抽。改了模型可见工具 `look_at_canvas`（新增可选参数 `selectedFrom`），model-face 基线只有这一处变化 |
| #1284 选中即主语设计文档（分支 `docs/select-to-iterate-design-20261021`） | 设计卡 + AnnotateToAgent 清单 + 画布 5 格源码，门岗全过（84dd9d629） | ① merge-preflight 唯一红项：AnnotateToAgent 是新板，要协调确认：`node scripts/coord-approve.mjs --pr 1284 --board AnnotateToAgent`（用户已拍板，原话在设计卡 §1b 与清单 approval）；② 预览图待补：仓库里没有 0.24 预览截图脚本，画布运行时也不在仓库 | 协调确认后合；合入后由界面线在设计实验室用生产组件拼整屏 |
| #1252 拆解表第一批 | 补齐提交 2fda8a539 已推 | 缺独立验收报告；Design Lab 2 格像素差要对照拍板稿确认后重录 | 派验收线。本地另有 `fix/deconstruct-transcribe-leg`（转写腿 2 个提交），等 #1252 合后单开 PR |
| #1195 / #1258 自动化数据 PR | 必需的 Quality Gate / Mac Package 从未触发（GITHUB_TOKEN 推送不触发 CI） | 本线「关闭再重开」被权限拦 | 用户在 GitHub 上关闭再重开一次即可 |
| #1207 自建中转模型名 | 未处理 | 删 1 条冷启动基线，rebase 解 2 个文件冲突 | 机械修补，可交 Codex |
| #1105 画布基准进度 | 未处理 | CI 结果停在 10-08 | rebase 重跑 |

## 三、选中即主语：已定与待定

已定（用户 2026-10-21 / 10-22，原话见 `docs/plan/2026-10-21-select-to-iterate.md` §1b）：
- 选中即进输入框，发送即确认；
- 多选各出一个新版本，「用这些做新的」才建节点；
- 新版本照旧自动变主图，放弃 = 回到上一版；
- 请求批准时，改已有节点就在原节点上出「第 N 版 · 待生成」；
- 一次最多改 12 个，超了明示；
- 第一版不含音频、只改圈内、视频时间段；
- 设计按「分离 + 接入」：只画 Δ1–Δ5，已有组件原样用。

待协调定：**版本排期**。0.24 README 第 33 行已把第 3 块「标注」排到 0.25（用户 10-21 定），所以跟线程有关的 Q-1、Q-3、Δ6 随之进 0.25。推荐 **Δ1（选区 chip）、Δ4（超限提示）留在 0.24**，它们只接现有输入框；**Δ2、Δ3、Δ5 跟着 D2 走**，D2 还没开工。

代码缺口（实现线要做，见设计卡 B 段）：
- Agent 按 nodeId 改的工具。现在只认 operationId + shotId，手工建的节点改不了。
- 选区 chip 接上 `projectAgentContextSnapshot` 的截断事实。
- 结果版本冻结。
- Agent 侧的设主图 / 回退。

## 四、本线留下的本地状态

- 本地分支整理：27 个已合或已被取代的分支已删，bundle 备份在 `/Users/aoqimin/Desktop/Nomi-branch-backups/2026-10-21/`（`branch-shas.txt` 记了每个分支的 SHA），3 篇竞品雷达另存为 md。剩下还有 19 个带独有代码的旧分支，其中唯一明确值得救的是 `repair/pr807-0919`（CER 参照语料与算法）。
- `Nomi-dragfix` 有一组没提交的读图模型偏好改动（`visionPreference`），所有分支上都没有，待决定迁走还是丢弃。
- `.codex/worktrees/d603` 有一份没提交的探索稿 `docs/design-explorations/canvas-edit-mode.html`（画布 → 剪辑模式），没有对应 PR。
- 本机 Codex：0.155.1 已经没有 `codex mcp-server` 子命令，这就是 MCP 连接失败的原因；`codex exec` 要加 `< /dev/null`；`~/.codex/config.toml` 里的默认模型 `gpt-6.1-sol` 对 ChatGPT 账号返回 400。
- 违规账 v13（主仓 `.claude/violations.log`）：提方案前没读 `docs/design/proposals` 里已拍板的设计。
