# 阶段 4 · 第 6 步回滚演练

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：已完成代码树与合成归档的非提交回滚演练（不生成大体积revert提交对）。

本次只使用当前任务 worktree 和临时合成项目；未接触真实项目数据、主 checkout 或其他 worktree；未调用付费模型，未合并 PR。

## Git 身份与范围

- 任务提交：`b92ae880e03125a00c6e64c094db22ea700d4d0b`。
- 从 GitHub `refs/pull/646/merge` fetch 到的真实合并模拟提交：`a40afc823aefab555c1c3449d319bd689d08964d`。
- 第一父提交（真实 main）：`be6d4d84816bd6340185ca134346d7f4516abfdd`；第二父提交恰为上述任务提交。
- 合并模拟树 = 任务树：`6342500a49b56d9cd9fb64067ca808d9023b8a57`。
- `git revert --no-commit -m 1 a40afc823aefab555c1c3449d319bd689d08964d` 成功。
- 回退后 `git write-tree` = 第一父树：`6e66904049162d12d5871fe9d9ba03a8eacd6646`，逐字节一致，不是 REST compare 重建的树。

完整回退 binary patch 为 4,110,963 bytes，评审带上下文 diff 约4.45MB；用户本棒要求单笔提交≤120KB。因此本次是**不提交的完整代码树演练**，随后只提交本文档；没有声称生成已提交的 revert/revert-revert 对，没有绕过任何 hook，也没有抬评审上限。

## 实跑步骤

1. 确认任务分支 clean（仅两个不提交的交接文件），fetch上述合并模拟ref，验证两父及树。
2. 在同一worktree创建本地 `rehearsal/stage4-switch-rollback-20260908`，执行上面的完整revert，保存binary patch并核验回退树。
3. `git revert --quit` 仅退出sequencer，保留回退内容；切到内容相同的真实第一父提交，确认index/worktree均零差异，再运行 `pnpm run gates`。这样收据归真实main身份，历史棘轮不会把一次演练冒充新的债务增加。
4. 测试前把本worktree的dist、dist-electron、agent-runtime/agent-system编译产物移到临时保留目录；从回退版本源码重编，避免已删源码的产物混入测试。
5. 在回退树上反向应用已保存的完整patch（`git apply --reverse --index`），核验恢复树等于合并模拟树，再切回任务分支。原lane构建产物原样放回；回退构建产物单独保留。

本次未改写任何分支历史；本地演练ref和reflog保留。正式生产回滚应在独立回滚PR中提交，对实际merge执行 `git revert -m 1 <merge>`；不得把本次模拟SHA当成未来生产merge SHA。

## 数据恢复：临时项目实测

合成AI SDK源：1项目/1文件/1会话/2items/2parts。先经生产迁移器归档和public append，再按下面步骤恢复。结果：source和archive SHA-256都匹配manifest；不同现存字节被拒、未覆盖；重复恢复幂等；新lane会话另存；0模型请求。

1. 关闭App，保留原archive，捕获项目和userData根目录身份并持迁移锁；核验manifest完整binding。
2. 对每个hash非null来源按固定映射找到archive，复算hash。原路径不存在才用不覆盖写入；已存在且hash相同视为已恢复；不同hash停止，不覆盖。host snapshot/backup/ledger恢复到原userData partition，不能全拷进项目目录。
3. 把新 `agent-sessions/`、`agent-workspace.json`、`lane-legacy-migration.json` 移到独立保留目录，避免旧版本继续工作后重开新版本时沿用陈旧completed标记；新通路新增对话保留，不与旧会话强行拼接。
4. G5领域收据保持原位。旧cutover的既有归档不动。若旧版本恢复后继续产生新对话，重新切换必须基于恢复后的活跃来源重新迁移，不能直接把保留目录覆盖回去。

三种格式的迁移事务在第3步已由临时夹具验证；本次数据回滚实跑AI SDK一源，不把它说成已恢复真实项目或所有真实格式。

## 先查别人

- Git官方行为：本机 `git revert` 的 `--no-commit` / `--quit` 与 `git apply --reverse --index`；规范 https://git-scm.com/docs/git-revert 和 https://git-scm.com/docs/git-apply 。
- 现有迁移owner：electron/agentLane/laneLegacyMigration.mts:20 保存hash、binding、来源和目标；electron/agentLane/laneLegacyFiles.ts:132 提供跨await锁，本次复用。
- 已批准承接方案：docs/plan/2026-09-08-agent-lane-legacy-removal.md:1、docs/plan/2026-09-08-agent-lane-legacy-migration.md:1；用Git原生命令和原字节归档，不造另一个回滚状态机。

## 结果

回退真实main完整 `pnpm run gates` PASS：75 contracts，72 passed / 0 blocking / 3 advisory；Vitest11972 passed / 2 skipped；agent-runtime306/306；build PASS。日志 `/tmp/nomi-switch-rollback-main-gates.log`。

反向应用patch后，write-tree精确回到 `6342500a49b56d9cd9fb64067ca808d9023b8a57`；切回任务分支后index/worktree零差异。原lane构建产物已恢复，回退产物留本worktree临时目录。Git报告 `/tmp/nomi-switch-rollback-git-report.json`；数据报告 `/tmp/nomi-switch-archive-rollback-report.json`。没有创建、推送或合并实际回滚PR。

恢复任务分支后，包含本文档的最终完整 `pnpm run gates` 再次通过（`/tmp/nomi-switch-final-gates.log`，退出码0）：75 contracts无阻断；Vitest11565/2 skipped，agent-runtime368/368；L1 19/19、76/76，R30工具/回合/审批均8/8。删旧后真实Electron迁移1次本地请求、完整对话25次本地请求均通过，关键截图亲看。冻结图片未改。
