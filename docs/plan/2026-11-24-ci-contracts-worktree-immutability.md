# CI Contracts 工作树与 HEAD 不变量

实现线 `q-ci-tree-impl`。纯 CI 修复，短档。

## 短版设计卡

### ★0 先查先例

- `scripts/check-hook-behavior.mjs:153`（修前）· push 行为矩阵用两个临时 Git 仓执行真实 hook · 确认登记表对照也在临时仓实跑。
- `scripts/daily-radar-session.mjs:203` · 当日成功标记复用雷达摘要 · 确认预填当日摘要后仍走真实 SessionStart；`scripts/eng-metrics.mjs:385` 同样优先读当日缓存。
- `tests/system/profiles.mjs:14` · Contracts 拆成 `--except` 与 `--only` 两个入口，共用 runner · 确认两条入口在步骤结束时用同一个判据。
- `scripts/nightly-walk-tree-guard.mjs:8` · 夜跑曾因一条走查写入未忽略的截图而连累后续走查 · 确认工作树变化须同样归到当步，且沿用 Git 忽略规则。Contracts 还要对账 HEAD，因此直接读 Git。
- `scripts/run-gates-contracts.mjs:194`（修前）· 链跑完后列出失败门岗 · 确认状态变化归责到单步并更新基线，修复点名脚本后可重跑同一分片。

### ★1 用法与量具

合后收据先检出目标 SHA，再安装该 SHA 的锁文件，执行每个合同门岗，在每步结束时复核仓库状态，最后汇总。以 run 45331233660 为回放目标，量具是 `check-hook-behavior.node-test.mjs`（真实 Git，前移比例从 1/1 到 0/1），`run-gates-contracts.node-test.mjs`（只读全通过，修改全拦截，后续步骤无误归责），以及本机 `time node scripts/check-hook-behavior.mjs`（目标 5 秒内，当次 CI 雷达约 111 秒）。关联界面仅门岗日志和失败汇总。项目与用户数据无迁移。

### ★2 归属

Git 提供 HEAD 与 porcelain；`runGateSuite` 独占逐步比较和归责，`checkSettingsGuards` 独占登记表行为探针的隔离，`followMainCheckout` 沿用 `delivery.main-checkout-follow` 的本地会话决策权。门表见同名根因合同，入口检索覆盖 `scripts`、`tests/system` 和工作流。runner 负责汇总，读取 Git 失败时传回错误，探针在退出时回收目录。

### ★3 三条路

1. 只在会话快进入口挡 CI。保留本地会话行为，但下一条可写门岗仍能悄悄改 CI 输入。
2. 隔离真实 hook、在快进入口挡自动化、Contracts 逐步核对 Git 状态。选此路，同时切断本次触发链，并为所有现有和新增门岗提供同一归责边界。
3. 删除登记表真实执行或移走 SessionStart。会失去已由 2026-09-07 缺脚本事故验证过的行为判据，或影响正常会话的主仓同步。

沿用 Git、共享临时目录助手、雷达缓存入口和现有 runner。在 base 的历史中，`e7386c4ac` 引入本机会话自动快进，`dc06cce68` 保留分片共用的 runner。

### ★4 状态

空链仍是配置错误。运行中显示当前门岗。干净通过时返回 0。快照变化时打印该门岗和前后 SHA 或 porcelain 变化，完成其余门岗后返回 1。advisory 的普通退出失败仍走原有汇总。中断保留已有日志，重跑即可。Git 快照读不出时报错退出，修复 Git 状态后重跑。

### ★9 验收与回滚

- 用真实临时主仓和本地 bare 远端回放 run 45331233660。让远端前移一个提交，保留实际登记命令和 hook，走 `checkHookBehavior(..., { only: ['settings-guard'] })`。修前应看到 HEAD 前移，修后应无问题、HEAD 保持基线、porcelain 为空。本机用本地远端代替 GitHub，雷达用当日缓存，未重跑托管 CI。
- 已登记的命令逐条实跑。缺脚本时按类型报错，正常载荷退出 0。旧的裸 bash 缺失控制应报红。人工本地 SessionStart 仍能快进，`CI=true`、`CI=1`、`GITHUB_ACTIONS=true` 都不得 fetch。
- 对 runner 注入干净快照、成功但移动 HEAD 的 advisory 步骤、成功但写文件的步骤。最后一类覆盖夜跑 run 40035294026 写入非忽略截图的同形回归。全放行会漏报后两例，全阻断会误伤第一例。变更仅归首次引入它的步骤。
- 顺序跑三个变更测试、实际 hook 门岗、任务列出的其余合同、根因合同和变更 lint。用 Contracts 工作流的两种选择参数核对共享入口。回滚用 `git revert` 本修复提交。
- 复查日 2026-12-24。以该回放和快照测试为量具，预期新增的仓库变更均归当步且正常步骤无误报。若同类逃逸出现，重开根因检查并扩大实际变更量具覆盖。
