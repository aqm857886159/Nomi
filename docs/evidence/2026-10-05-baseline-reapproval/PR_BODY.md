# PR1014 卡18 · 机械证据子 PR

## 范围

基于 `origin/main` 提交 `180224684`，重新截取卡面指定的 31 个 Design Lab 状态：process-feedback 14、storyboard 8、settings 4、depth-action 2、director-3dbox 2、canvas-frame 1。左侧为仓库现有基线，右侧为现行真实走查截图。

## 机械证据

- 索引：[README.md](README.md)
- 逐格左右对比：[comparisons/](comparisons/)
- 原始走查日志：[logs/](logs/)
- 逐格提交 / 尺寸 / diff 记录：[records.json](records.json)
- 31/31 PNG 生成，所有走查进程退出码为 0。

## 设计卡逐格

| 格 | 事实 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 审核者逐格查看左基线与右现行截图，确认状态是否仍与批准样张一致。 | [README.md](README.md) 各屏表格 |
| ★2 谁说了算 | 本子 PR 只记录机械截图与差异；不替产品代码、基线或校准文件作决定。 | [source.txt](source.txt)、[logs/](logs/) |
| ★3 一致与复用 | 复用仓库现有 `tests/ux/design-lab/walkScreen.mjs`、现有基线目录和现有状态注册表。 | [logs/](logs/) |
| ★4 全状态 | 本卡面计数 31 格逐一列出 state id；每格均有左/右原图和对比图。 | [README.md](README.md) |
| ★9 验收与回滚 | 本子 PR 可整体删除以回滚；没有更新基线、校准、断言或产品代码。 | `git diff --check`（见协调会话收据） |

## 已知边界

- director-3dbox 日志保留 Vite 字体 allow-list 警告；截图仍已写出，尺寸和路径见 `records.json`。
- “可见变化”列只报机械像素变化比例，不把差异归因成设计结论。
- 本环境无法直接创建 / 推送 GitHub PR；请协调会话在其 Git worktree 中提交本目录后创建子 PR，并在 PR1014 评论回报 `卡18 交货：#子PR`。
