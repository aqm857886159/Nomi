> 模板（2026-10-08 起用）：抄进任务书时替换尖括号与本次具体内容；路径用任务行给的。

# V-spendsize：#1113 独立验收（花钱类，合并前必须）

你是独立验收线，**不是**实现线（实现线 F-spendwalks）。先完整读公共规矩 docs/engineering/codex/rules.md。worktree：<验收 worktree>（detached，在 origin/fix/spend-walks-main 上），先 `git fetch && git checkout --detach origin/fix/spend-walks-main`、`pnpm install`、`pnpm run build`。只读验收：不提交、不改被验代码（变异校验要先备份单文件、跑完按备份还原并核 SHA，绝不 git checkout 目录）。

## 被验的东西
PR #1113：付费卡把影响报价的像素尺寸放在底栏单独一颗 chip（之前被收进齿轮看不到）；清晰度 chip 与像素尺寸同属 `parameterControlRole` 归类问题，按 catalog 矩阵归类；agent-spend-stop-midway 走查竞态修复（旧通知被首个 DOM 匹配误读、读取早于宿主终态）。读 PR 正文（`gh pr view 1113`）与设计卡，逐格对照。

## 要验
1. 用户视角：图像模型、视频模型各至少一个（含有多个尺寸 / 清晰度会改报价的），付费卡底栏能直接看到并改尺寸 / 清晰度，改了报价跟着变；中英两轨真截图（无界面隔离资料目录、零花费 fixture），自己 Read 过。
2. 和同类界面一致：底栏 chip 与画布节点底栏的同款控件是同一个组件 / 同样交互（UI 必须统一）。
3. 变异：把归类改回旧行为（例如 parameterControlRole 对尺寸返回 null），catalog 矩阵与 agent-spend-card 走查必红；还原后绿。
4. 三条付费走查真跑：agent-spend-card、agent-spend-confirm-executes、agent-spend-stop-midway（zh / en），paidCalls 必须为 0；stop-midway 的张数断言是否真对上宿主终态（读走查代码判断它没有被放宽成「不检查」）。
5. 钱的边界：确认前不发请求；关掉 / 去掉的那张不生成；改尺寸后发出的请求参数与卡上显示一致（读请求记录或 fixture 收到的参数）。
6. 回归：PR 改到的文件所在目录 vitest 全跑。

7. CI 同款门岗（10-08 加：#1113 的验收只跑了改动目录 vitest，漏了跨目录的可达性测试与 test-types）：按公共规矩「交付前必跑 CI 同款门岗」跑 Contracts 段、typecheck、check:test-types、完整 Unit（不只改动目录），贴退出码；红的在干净 origin/main 上对照。

## 交付
报告写 任务行指定的报告路径：结论（通过 / 不通过）、逐项证据（命令、数字、截图路径）、发现的问题。最后一条消息给结论。只杀自己启动的 PID；Vite / Electron 用完即停。
