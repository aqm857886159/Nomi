# Git 交付身份与单次主线验收

日期：2026-08-29
状态：✅ Git 身份与有界 fetch 仍生效；其中本地 `full-local` 收据已由 [2026-08-30-risk-scoped-validation-evidence.md](2026-08-30-risk-scoped-validation-evidence.md) 的 exact-SHA CI evidence 收据取代

## 用户价值

一次改动从最新主线开始，经任务分支、PR、合并到 `main`，最终只在真实合并提交上验收一次。网络异常必须在开始阶段有界失败；任务提交、PR head、merge commit 和 tree 必须各自按正确语义判断，不能再把提交身份差异误报成代码内容不一致，也不能用 GitHub API 手工重建 Git 对象。

## 已复现机制

1. 本机 Git HTTPS 曾无输出挂起，而 GitHub REST API 同时可用；临场切换通道后没有统一的超时和阶段证据。
2. Git commit 对象包含 tree、parent、author、committer、时间、签名和完整 message。代码 tree 相同不代表 commit SHA 相同；PR head 与 GitHub 创建的 merge commit 更不应相同。
3. 临时物化脚本用 compare API 的 `files` 数组重建目标 tree。官方接口对整个 comparison 最多返回 300 个 changed files，本次跨基线变化超过该范围，最终得到本地 tree `ae291dba`，而远端真实 tree 是 `68e37262`。
4. 完整系统验收可以被同一 merged SHA 重复触发，缺少可复用的成功收据；重复执行增加时间和环境争用，却不增加代码证据。

## 共享边界

新增 `scripts/git-delivery.mjs` 作为唯一交付状态命令：

- `preflight`：在编码开始前只执行一次有超时的 `git fetch`；禁用交互式凭据提示；拒绝受保护分支、脏工作树和未包含最新远端基线的任务分支。
- `verify-merged`：再次有界刷新远端主线；要求 `HEAD`、`origin/main` 与显式 expected merge SHA 三者完全一致；从本地 Git 对象库读取 tree，不从 REST compare 文件列表重建对象。
- 身份报告分别输出 commit SHA、tree SHA 和阶段关系。tree 相同但 commit 不同只报告 `same-tree-different-commit`，不称为内容不匹配。
- `verify-merged` 在通过身份门后调用现有 `full-local` profile。per-SHA 原子运行锁阻止多个 worktree 并发启动；成功或失败收据写入 Git common dir，同一 merged SHA 再次调用时复用成功结果或保留失败结果，不自动重跑。

## 规则收敛

- 不新增规则编号；把命令挂进现有 R11、R19、R22。
- R11 只保留“如何开始和提交”，R19 只保留“什么状态能称已解决”，R22 只保留“何时运行哪档测试”。
- `CLAUDE.md` 仍是规则真相源，`AGENTS.md` 由生成器同步；详细 Git 身份语义只住在本计划与脚本帮助中。
- `check:git-delivery` 加入 contracts 链，确保统一命令、禁止对象合成和阶段不变量不会静默消失。

## 测试策略

聚焦 Node 测试覆盖：

1. 受保护分支与落后远端基线 fail closed。
2. fetch 超时只执行一次并终止子进程，不重试。
3. same commit、same tree/different commit、different tree 三种身份不会混淆。
4. merged 验证拒绝 PR head 或陈旧 main，只接受 exact merged SHA。
5. 同一 SHA 的成功收据直接复用；失败收据不被自动重跑覆盖；并发调用只有一个取得原子运行锁。
6. 脚本源不含 GitHub compare API、`hash-object -t commit` 或 `commit-tree` 等对象合成路径。

本地先跑上述聚焦测试、根因合同、规则同步和 diff 检查；PR CI 负责高风险完整验证。PR 合并后，使用真实 `origin/main` merge SHA 调用 `verify-merged` 一次，现有 `full-local` 会覆盖完整系统门禁、canvas acceptance 与 CI-safe J3/J5。

### merged-main 首次调用发现

PR #227 合并后的真实调用在进入 fetch 和测试前失败：pnpm 把命令行分隔符 `--` 原样传给脚本，而解析器误把它当成未知 delivery 参数。该次没有启动 `full-local`、没有写收据，因此不构成重复完整测试。修复落在共享 `parseCli` 边界，并以文档中的完整 argv 形状补回归测试；pnpm 与直接 Node 调用现在解析成同一组选项。

## 不动项

- 不修改 ReactFlow 产品交互；PR #221 已恢复的连接点、连线与画布行为保持不变。
- 不复制或改写已合入的 Linux synthetic safeStorage 实现；只依赖其现有合同和 main CI 证据。
- 不承诺消除 ISP、代理、GitHub 或系统网络故障；本次保证故障提前出现、有界结束且不会诱发错误的对象重建流程。
- 不升级产品版本。改动只影响内部交付与测试编排，`0.21.0` 保持不变，后续版本由正式发布批次决定。

## 回滚

删除 `scripts/git-delivery.mjs`、其 Node 测试和 package scripts，并恢复 R11/R19/R22 文案即可回滚。收据只位于 Git common dir，不进入项目数据或 Git 历史；回滚不影响 Nomi 用户项目、凭据或画布状态。
