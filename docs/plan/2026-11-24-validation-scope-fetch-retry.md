# Validation Scope 检出瞬断修复

- ★1 目标。Quality Gate 要按事件指定的两端提交分配验证车道。工作流子进程测试量出准确 SHA、真实 Git rename diff、profile 输出、尝试次数、退出码和注解标记。空基线与全零基线继续按各自原有的全量策略执行，无应用数据迁移。
- ★2 归属。Git 提供提交和比较，`jobs.scope` 负责空工作区的检出和最终失败。检出后由 `select-quality-gate-profile.mjs` 读取范围并写输出。`door-map.mjs resolveProfileFromEnvironment writeGithubOutput --roots=scripts` 数到同一文件里的读、写各一扇。已检出的脚本继续由 `transientRetry.mjs` 统一管理重试，工作流测试对照冷启动的 Git 错误判定及默认次数。
- ★3 取舍。#1158 已把脚本网络瞬断收进共享边界。空工作区无法导入该模块。沿用 checkout action 会保留全历史和其中间输出，删除检出则失去分类脚本与比较数据。选内联启动步骤，用 Git 一次抓取最多两个深度为 1 的提交，直接执行实际步骤作为验收。
- ★4 状态。没有基线时只取头提交，交给既有全量策略。取数中仅报尝试进度，恢复后检出并分类。耗尽、权限拒绝、无效提交或有效范围读取失败均退出非零。作业取消与超时由 Actions 终止。
- ★9 验收。重放 #1586 的失败文本，验证首次断线后恢复且无错误标记，全部断线用足三次，403 与无效 ref 只尝试一次，凭据无泄漏。用真实仓库的非 ASCII 重命名、空基线和全零基线检查分类输出。对错误注解和耗尽后假成功分别做反向变异。原事件证据为 Quality Gate 45264322182 的作业 138007074731。重放使用本机子进程注入断线并转真实本地 Git，托管运行未验证。回滚用本提交的 revert。

## 先查别人

- [dorny/paths-filter](https://github.com/dorny/paths-filter) · 在 Actions 里以 PR 文件 API 或 Git 差异做模式匹配 · Nomi 本机 gates 和合后收据也要执行同一份付费走查及画布分档，保留共用分类器。
- [Nx affected](https://nx.dev/docs/features/ci-features/affected) · 从 Git 差异及项目依赖图找受影响任务 · 画布验收依赖 Nomi 的概念归属并有 critical/full 两档，继续用现有概念判据。
- [Git diff](https://git-scm.com/docs/git-diff) · 直接比较给定的两端并提供名称、改动类型和改名判定 · 由 Git 提供分类输入，检出最多取两个浅提交。
