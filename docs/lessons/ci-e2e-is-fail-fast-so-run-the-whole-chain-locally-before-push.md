# CI 的 E2E 链是串行 fail-fast，本地 gates 一条都不含——不先在本地跑完整条链，每轮 CI 只学到一件事

> 📎 教训 · 首次记录 2026-09-17 · 状态：🟡 待固化（候选：把 CI E2E 七步做成一个本地脚本 `test:e2e:ci-chain`，并让派工模板把它列为 push 前硬步骤）
> **触发场景**：一条分支 CI 连红两轮以上，每轮红的却是**不同**的走查；或者你准备 push 一条碰了用户可见面 / MCP / Agent 面的集成分支。

**结论**：`quality-gate.yml` 的 `E2E Walkthroughs (Linux)` job 是 **7 步串行、第一步红整个 job 退出**（`test:feel:browser → test:e2e → test:journeys → test:mcp-journey → test:mcp-elicitation → test:real-user-journeys:ci → test:canvas:critical`），而本地 `pnpm run gates`（含 full 档）**一步都不跑它们**。于是「本地 gates 五次全绿」和「CI 会绿」之间没有任何关系：CI 变成了第一次跑走查的地方，而且每 40 分钟只暴露排在最前面的那一个红。另加一条同一天撞的：`check:prior-art` / `check:door-map` 只读 push 事件 payload 里的 PR 正文，正文编辑晚于 push 哪怕 19 秒都算旧正文。

## 症状

2026-09-17，集成分支 `integration/release-20260917`（PR #804，九块、22 个 commit、src+electron 改动一万行）：

| 轮 | 触发 | E2E 死在第几步 | 同轮其它红 |
|---|---|---|---|
| 1 | 13:02 push | 第 2 步 `test:e2e`（冒烟）：反馈首次询问卡一行 11px，体感棘轮红 | prior-art / door-map：正文没引方案与合同 |
| 2 | 13:58 push | 第 4 步 `test:mcp-journey`（MCP L2 C7）：`Integration session owner mismatch`——#786 重做把「就地发现模型」的 owner 写死成 nomi，交接来的会话必然对不上（真 bug） | prior-art / door-map **又红**：正文 05:59:14 UTC 编辑，push 是 05:58:55 UTC，晚 19 秒 |
| 3 | 14:19 push | 第 4 步 `test:mcp-journey` 又红，但**换了一句**：`中转站没有可用的 /models 接口…`——上一轮修对了 owner，这一轮暴露出更深的一层：发现失败被当成「存 key 失败」抛回调用方（真 bug，用户连 key 存没存都不知道） | — |
| 4 | 15:43 push（先在本地按 CI 同序跑完 7 条，全绿再推） | **全过**（10m58s，7 步都真跑了） | Contracts 也过：正文先定稿、`--pr` 双预演绿了才 push |

每一轮红的都是真实、独立、能修的小问题；问题不在代码，在**发现的顺序被 CI 的 fail-fast 串行化了**。agent 期间本地跑了 5 次 gates 全绿——那 5 次根本没碰过这 7 条走查。

第 4 轮是反证：同一条分支，先在本地把 7 条按同序跑完（9 分钟、全绿）再 push，CI 一次就过。
「本地 9 分钟」对「CI 三轮 × 40 分钟」——这条教训的价值就是这个比值。

**顺带钉一条判据**（`assert-you-are-in-the-situation-you-claim`）：第 3 轮红、而本地同一条走查 PASS，
第一反应该是「我是不是不在我以为的现场」——这次查出来的答案是**代码不同**：第 3 轮的 head 是
`9f4963be1`，而非致命化那笔修复在 `2c92582e0`（第 4 轮才进）。先对齐 head，再谈平台差异。

## 为什么会这样

1. **`gates` 的分档只管 unit / contracts / build**（`scripts/validation-policy.mjs`），Electron 走查按「受影响路径」交给 CI 各 job 独立触发。这个设计是对的（走查慢、占全机锁），但它隐含一个前提：**push 前有人在本地跑过会被触发的那几条**。集成分支碰的面太多，「会被触发的」等于全部，而任务书里没有这一步。
2. **fail-fast 是 CI 省钱的正确选择**，但它把「一次看到全部红」变成了「一轮看到一个红」。本地不 fail-fast（一条一条跑、红了继续跑后面的）才能一次把全部红收齐。
3. **正文门岗读 payload 不读 API** 是设计如此（rerun 不重读，见 `scripts/check-prior-art.mjs:88` / `check-door-map.mjs:67`），且两个脚本都提供 `--pr` 本地预演——问题只是没人在 push 前跑。交接文档里明明写着这条坑，派工任务书没把它写成步骤，agent 照样踩。

## 怎么用

- **push 前（尤其集成分支 / 碰用户可见面 / MCP / Agent 面）**：按 CI 同样顺序把 7 条走查在本地全跑一遍，**红了继续跑后面的**，把全部红一次收齐再修，再 push 一次。mac 上不用 xvfb，直接 `pnpm run <script>`；跑 Electron 前 `pgrep -fl Electron` 确认没别的实例，一次一个。
- **正文门岗**：正文定稿 → `node scripts/check-prior-art.mjs --pr && node scripts/check-door-map.mjs --pr` 本地绿 → 再 push；push 之后不许再编辑正文（要改就得再 push 一个 commit）。
- **派工任务书**：以上两条写成 push 前的硬步骤，不写「跑 gates 后 push」这种会被字面执行的话。
- **判断 CI 连红是不是「没找到核心问题」**：先看每轮红的是不是同一条。同一条反复红 = 没修到根因；每轮不同条 = 发现被串行化了，去补本地整链，别再一轮一轮喂 CI。
