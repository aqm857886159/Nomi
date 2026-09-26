# RC 必须在 release 分支上触发，不能只把分支名填进 `ref` 输入

> 📎 教训 · 首次记录 2026-09-26 · 状态：🚧 未固化（门岗见 TODO T-RL-13）
> **触发场景**：手动触发 `Desktop Release Candidate`（`gh workflow run desktop-rc.yml …` 或 Actions 页面的「Run workflow」），以及之后运行 `Desktop Release` 晋级。

**结论**：触发 RC 时，「用哪个分支上的 workflow」必须就是 release 分支：命令行写 `gh workflow run desktop-rc.yml --ref release/<版本> -f ref=release/<版本> -f version=<版本>`，页面上「Use workflow from」选 release 分支。只填 `-f ref=release/<版本>` 而漏掉 `--ref`，RC 会照样构建、照样全绿，验收也照样能做完，但最后一步 `Desktop Release` 会在「Validate RC manifest」报 `RC commit mismatch`，拒绝发布。

**为什么会踩**：两个「ref」说的不是一件事。
- `--ref` 决定这次 run 用哪个提交上的 workflow 文件，run 记录的 `head_sha` 就是这个提交。
- `-f ref=` 只是 RC workflow 的输入，决定 checkout 并构建哪个提交；清单里记下的 `sha` 是它。

漏掉 `--ref`，workflow 就从默认分支 main 起跑：`head_sha` 是 main 的提交，清单 `sha` 是 release 分支的提交。发布工作流要求两者相等，否则就可能拿一个 workflow 的签名去发另一份产物，所以它拦下是对的，**不能改成放行**。

2026-09-26 v0.22.1：RC `36235580649` 就是这么触发的，已经完成 Windows 验收、真实付费矩阵和用户的 Mac 验收，发布却在最后一步被拦，只能从同一提交重打一次 RC（`36248506177`），再对新安装包做一轮复验。

雪上加霜的一步：`#896` 合并时，仓库的 `delete_branch_on_merge` 自动删掉了 `release/0.22.1`，重触发前得先把分支原样推回同一个提交。

**怎么用**：
- 触发 RC 前先确认 release 分支在远端存在。合并 release→main 的 PR **之前**就要把 RC 打好、验完；晋级要再打 RC 的话，先把分支推回原提交。
- 触发后立刻核对：`gh run list --workflow desktop-rc.yml --limit 1 --json headBranch,headSha` 里的 `headBranch` 必须是 release 分支，`headSha` 必须等于要发布的提交。不对就马上取消重来，别等构建和验收都做完才在发布那一步发现。
- 真正的防线应该放在最早那一层（R17）：RC workflow 的 validate 第一步就比 `github.sha` 与解析出来的 `inputs.ref`，不等就直接红。这道门岗记在 TODO T-RL-13。

**同一次晋级的第二个坑**：RC 对上之后，`Desktop Release` 又卡在「Create immutable tag」：CI 的 `pnpm install` 顺带装上了开发者 pre-push 钩子，工作流推标签时要 Ponytail 收据被拦（TODO T-RL-14）。修好之前，在本机先把同名标签打到 RC 提交上推上去再重跑发布：工作流对「标签已存在且指向 RC_SHA」会直接复用。

**出处**：Desktop Release run `36248271714`（`RC commit mismatch: a5fd5e4d1…`）；检查逻辑在 `.github/workflows/desktop-release.yml` 的「Validate RC manifest」（`scripts/release-contract.mjs validate-manifest --sha "$RC_HEAD_SHA"`）。
