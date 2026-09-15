# 远落后分支合并走 `gh pr update-branch`，不要在本地 push 追平 merge

> 📎 教训 · 首次记录 2026-09-01 · 状态：现行（结论不变，**理由 2026-09-15 换过一次**，见下）
> **触发场景**：要合的分支落后 `main` 几十到几百个 commit。

**结论**：远落后分支上车不要在本地 `git merge origin/main` 再 push。用 `gh pr update-branch <n>` 让**服务端**把 main 并进分支，CI 在 merge tree 上跑验证，全绿后 `gh pr merge <n> --merge`。**验证在本地、并线在服务端。**

**为什么会踩**：2026-09-01 的 A 列车之前已有三个班撞过同一堵墙。打捞类分支落后 main 45~944 commit，本地 merge 后 push 的 diff 高达 15–88MB。

根因是**量具与工具错配**：追平 merge 的 push 内容 99% 是 main 上已有的 commit，本地却要把整包当成「这次的改动」处理一遍——既慢又没有信息量，该由服务端在 merge tree 上回答的问题被搬到了本地。

当时这个错配是以 `spawnSync git ENOBUFS`（pre-push 评审顶爆体积上限）的形式炸出来的。**2026-09-15 起那个成因不存在了**：pre-push 改成只查一张收据、不再 diff（R25）。结论照旧成立，只是不会再有那条报错替你喊停——所以这条要靠自己记。

**怎么用**：

- 远落后分支上车流程：`gh pr update-branch <n>` → CI 在 merge tree 上验证 → 全绿 `gh pr merge <n> --merge`。
- 需要补小修（如文档索引）时：**先** update-branch 让 remote tip ≈ main，**再**只 push 那个小 commit。
- 本地五门照跑：本地 merge 后跑 `pnpm run gates` 验证，只是不把这个 merge push 上去。
- 本仓分支保护：required = Quality Gate + Mac Package（未碰打包路径时 skipping = 中性放行），`strict=true`，所以 BEHIND 状态必须先 update-branch。

**出处**：2026-09-01 A 列车实测（三次 ENOBUFS 失败 + 一次 update-branch 成功）；钩子修复 commit `24e7d609`（PR #223 线）。同族「量具错配」见 [性能预算在 macOS 校准却在 Linux CI 执行](canvas-perf-budget-calibrated-on-macos-fails-on-linux.md)。
