# 尾巴批交付计划（2026-09-01）

日期：2026-09-01 · 状态：🚧 三件已在分支 `chore/tail-batch-20260901`（PR #309）实现，待合入

## 范围

1. 从 `check:i18n` 的 electron 收缩基线清除至少 60 处用户可见的 throw/dialog 中文文案，统一走 `electron/i18n.ts` 的 `desktopT`。
2. 让 `scripts/install-git-hooks.cjs` 生成的 `pre-push` 在当前 worktree 缺少 Ponytail 脚本时安全退出。
3. 新增手动 `check:handoff` 工具：输入分支名，报告相对 `origin/main` 的 behind、两点/三点删除量及回滚嫌疑；`--with-tests` 额外运行并统计全套件失败数。

## 不动项

- 不触碰 `m1/*`、`arch/phase2*`、`docs/agent-ui-redesign*` 分支。
- 不触碰 `modelArchetypes`、`projectAgentHost` 目录。
- `check:handoff` 不加入 gates 链，只作为人工收货工具。
- 不更新模型雷达快照；本轮雷达输出只保留在本地检查，不纳入交付。

## 验收与回滚

- 三件分别一个 commit；每个 commit 前跑其 changed/sibling focused tests。
- 最终跑 `typecheck`、相关 `check:*`、focused tests，并确认 i18n 基线只减不增。
- 回滚按 commit 逆序逐个 revert；不改写远端历史，不直接推送默认分支。
