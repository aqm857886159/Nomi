# 并行会话各跑各的 gates 会把机器压进 swap，测试因超载而超时、伪装成代码问题

> 📎 教训 · 首次记录 2026-09-03 · 状态：✅ 已固化（由 `scripts/vitest-fair-share.mjs` 接管）
> **触发场景**：本地 `pnpm run gates` 反复红在**同一条耗时用例**（超时而非断言失败），而你改的东西跟它八竿子打不着；或 `uptime` 的 load 远大于核数。

**结论**：判「这条红灯是不是我的锅」之前，先看两个数——`uptime` 的 load 和 `top -l 1 | grep "CPU usage"` 里的 `sys%`。load 远超核数、或 `sys%` 超过 ~15%，说明机器在忙于调度和换页而不是跑测试，**超时类失败一律先按超载处理**，别去查被测代码。确认办法：把那个文件单独 `npx vitest run <file>` 再跑一次。

**为什么会踩**：vitest 按**本机核数**决定 worker 数，这个默认对「独占」是对的，对「并行」是灾难——几个会话各跑各的 `pnpm run gates`，**彼此看不见**，每个都以为自己独占整台机器。

2026-09-03 实测（10 核 macOS）：

| 指标 | 5 个 gates 并发时 |
|---|---|
| load average（15 分） | **105**（≈10 倍超载） |
| node 进程 / 内存 | 62 个 / 4.7 GB |
| CPU 分配 | `70% user, 29% sys, 0.5% idle`（健康时 sys < 10%） |
| 内存 | 23G 吃满、压缩器扛 8.7G、swapout 累计 1.8 亿次 |

`sys` 那 29–37% 等于 **3 个核在做进程切换和换页，不在跑测试**。

真实代价不是「慢」，是**结论不可信**：`electron/projectAgentHost/` 里那条 `keeps a 1,000-command same-entity snapshot bounded…` 空闲时就要跑满 ~31s（预算 30s，本来就没余量），超载下必然超时。我因此连红三轮，每轮都在查一个跟改动（Tailwind token 映射）毫无关系的东西——`electron/projectAgentHost/` 对 `src/` 和 tailwind 是**零 import**，改动根本够不到它。

**怎么用**：
- **已自动接管**：`pnpm run test` 走 `scripts/vitest-fair-share.mjs`。它把自己登记到跨 worktree 共享的注册表，数一下还活着的同类，按 `floor(核数/并发数)` 传 `--maxWorkers`。**独占时不传任何 flag**，vitest 默认原样保留（CI 单跑与本地独占零行为变化）。
- **残留限制（知道就行，不是 bug）**：已经在跑的那个不会被打断，仍按它启动时的宽度跑；**让路的是后来者**。同批启动（400ms 沉淀窗口内）的能互相看见并均分。
- **判红灯前的两个数**：`uptime` 的 load、`top -l 1 -n 0 | grep "CPU usage"` 的 `sys%`。这两个数不正常时，超时类红灯不作数。
- 与 [[flaky-test-check-other-worktrees-first]] 的分工：那条讲「先查别的 worktree 有没有在跑」，本条讲**为什么**会互相拖垮、以及现在由谁自动兜住。反复超时（≥2 次）仍要按 [[repeated-timeout-means-check-the-assertion]] 转去怀疑断言本身。
