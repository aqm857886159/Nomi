# 远落后分支合并走 `gh pr update-branch`，不要在本地 push 追平 merge

> 📎 教训 · 首次记录 2026-09-01 · 状态：现行
> **触发场景**：要合的分支落后 `main` 几十到几百个 commit；或 push 时看到 `spawnSync git ENOBUFS` / pre-push 评审因 diff 过大失败。

**结论**：远落后分支上车不要在本地 `git merge origin/main` 再 push。用 `gh pr update-branch <n>` 让**服务端**把 main 并进分支，CI 在 merge tree 上跑验证，全绿后 `gh pr merge <n> --merge`。**验证在本地、并线在服务端。**

**为什么会踩**：2026-09-01 的 A 列车之前已有三个班撞过同一堵墙。打捞类分支落后 main 45~944 commit，本地 merge 后 push 的 diff 高达 15–88MB，远超 R25 ponytail pre-push 评审的 1.5MB 上限（`execFileSync` 的默认 buffer 也一并炸），于是 `spawnSync git ENOBUFS` 直接挡住 push。

根因是**量具与工具错配**：追平 merge 的 push 内容 99% 是 main 上已有的 commit，本地钩子却按 outgoing ref diff 要整包评审一遍。

**怎么用**：

- 远落后分支上车流程：`gh pr update-branch <n>` → CI 在 merge tree 上验证 → 全绿 `gh pr merge <n> --merge`。
- 需要补小修（如文档索引）时：**先** update-branch 让 remote tip ≈ main，**再**只 push 那个小 commit（几个文件，ponytail 安全）。
- 本地五门照跑：本地 merge 后跑 `pnpm run gates` 验证，只是不把这个 merge push 上去。
- 本仓分支保护：required = Quality Gate + Mac Package（未碰打包路径时 skipping = 中性放行），`strict=true`，所以 BEHIND 状态必须先 update-branch。
- ponytail 钩子 ENOBUFS 的根因修（maxBuffer 提到 512MB）在 commit `24e7d609`，随 #223 线入 main 后此坑消失大半；但对超大 diff，update-branch 流程仍是首选。

**出处**：2026-09-01 A 列车实测（三次 ENOBUFS 失败 + 一次 update-branch 成功）；钩子修复 commit `24e7d609`（PR #223 线）。同族「量具错配」见 [性能预算在 macOS 校准却在 Linux CI 执行](canvas-perf-budget-calibrated-on-macos-fails-on-linux.md)。
