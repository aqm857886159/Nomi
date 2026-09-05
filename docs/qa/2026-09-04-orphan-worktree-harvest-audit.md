# 孤儿 worktree / 分支接管审计 — 2026-09-04

> 范围：只收口仓库状态文档，不删除 worktree、分支、引用或文件，不修改产品代码，不运行长耗时扫描或测试。
> 基线：`origin/main = 45912ae`。
> 结论：当前现场只能进入“保护、认领、复核”阶段；本报告不是删除授权，也不把孤儿候选等同于可回收对象。

## 核实现场

| 项目 | 已核实事实 | 处置判断 |
|---|---|---|
| 仓库总量 | 92 个 worktree、209 个 local branch、16 个 detached、2 个 prunable、17 个 open PR | 先冻结并建立可回放清单；不凭数量直接清理 |
| `feat/storyboard-row-select-unify` | dirty；36 个 unique commits、76 个 files；无 PR；依赖 #454 | 高风险未交接成果；原地保护，先确认 owner 和 #454 关系，不 reset/clean/delete |
| `codex/agent-ui-functional-conformance-20260904` | 2 个 unique commits、24 个 files；无 PR；远端 tracking gone | 本地成果先保全，再决定是否由现有维护者认领并开最小 PR；不得因 tracking gone 删除 |
| TikHub / video deconstruction | #435 open；独立设计分支 2 个 commits、11 个 files | 按 open PR 和独立设计成果保留；先确认 #435 的依赖/归属，再拆分或关闭重复路线 |
| 已吸收或历史残留 | Agent v3.1、P0 exception、conformance piece1、3D dispatch、MCP receipt/client-confirm、S5/S6 mainline commits 已被当前主线吸收，或仅剩历史/dirty artifacts | 只把“已吸收”作为重基线线索，不直接删除本地路径；dirty artifacts 继续保护 |

## 安全接管顺序

接管的目标是让每一份成果都有明确 owner、保存位置和下一动作，而不是先把目录变少。按以下顺序执行：

1. **冻结现场并登记 owner。** 以 `origin/main=45912ae` 作为共同基线，记录 worktree 绝对路径、当前 branch/HEAD、dirty 状态、detached/prunable 标记、关联 PR 和最后已知 owner。冻结期间不 reset、clean、remove、prune 或覆盖任何候选。

2. **先接管 dirty 成果。** 对 `feat/storyboard-row-select-unify` 保留完整工作树、36 个 unique commits 和 76 个 files；先由 owner 说明哪些是未提交工作、哪些依赖 #454，再建立可恢复的分支/补丁保存点。不得用 `origin/main` 覆盖，也不得把“无 PR”解释为“无价值”。

3. **保全 tracking gone 成果。** 对 `codex/agent-ui-functional-conformance-20260904` 先保留本地 branch 和 2 个 unique commits/24 个 files；确认远端分支确实不可用后，由 owner 选择重新推送到任务分支、摘取到小 PR，或明确归档。重新建立 tracking 之前不得删除本地 ref 或 worktree。

4. **处理 open PR 与独立设计支线。** #435 保持 open；TikHub/video deconstruction 的独立设计分支 2 个 commits/11 个 files 单独登记，先对账 #435 的实际范围、依赖和 owner，再决定合并、摘取或保留。不得把设计分支的存在当作重复垃圾，也不得绕过 PR 直接推送 `main`。

5. **再做主线吸收对账。** 对 Agent v3.1、P0 exception、conformance piece1、3D dispatch、MCP receipt/client-confirm、S5/S6 mainline 等历史线，逐项用 commit ancestry 和 patch/文件级证据确认“已吸收”还是“只剩 dirty artifact”。已吸收的 commit 不需要重新打捞；只剩 dirty artifact 的路径仍按 dirty 规则保护。

6. **最后才评估可回收项。** 只有同时满足“明确 owner 已确认无保留需求、工作树 clean、不是 active/current 路径、成果已进入主线或已安全保存、连续复核结果一致”时，才可提出精确删除/清理计划。该审计不执行这一步。

## 重复检查门槛

每一个候选都要经过同一套检查，不能以一次瞬时状态作删除依据：

1. **初检：** 登记 ref、HEAD、worktree 路径、dirty/untracked、detached/prunable、PR/远端 tracking 和 owner。
2. **等待 owner 确认后复检：** 对照初检逐项复核；只要路径、HEAD、dirty 状态、关联 PR 或 owner 有变化，就回到接管阶段，不进入回收评估。
3. **动作前终检：** 在任何 remove/prune/branch delete 前再次确认 clean、非活动、已保存、已吸收/已交付，并确认操作目标是精确路径和精确 ref。
4. **动作后复检：** 若未来获准执行清理，重新核对 worktree/branch/PR 计数和剩余 dirty/prunable 清单，确认没有误删、悬空 ref 或被覆盖成果。

重复检查的意义是区分“暂时没有看到活动”和“可以安全回收”。未能完成 owner、活动状态或保存点确认时，结论必须是 `protected / unknown`，不是 `safe to delete`。

## dirty / prunable 禁删规则

- **dirty worktree 禁删。** tracked 或 untracked 任一有改动，都必须原地保护；禁止 `git reset --hard`、`git clean`、`git worktree remove --force`、覆盖文件或删除对应 branch。
- **prunable worktree 禁删。** `prunable` 只说明 worktree 注册与路径可能失配，不证明目录内容、外部会话或恢复需求不存在；本轮只登记、隔离并等待 owner/路径确认，禁止 `git worktree prune` 或删除目录。
- **detached 不等于垃圾。** detached worktree 可能承载未登记成果；只有在内容、owner、活动状态和恢复路径均被确认后，才能进入独立回收评估。
- **tracking gone 不等于可删。** 远端 tracking 消失只改变同步状态，不改变本地 unique commits 的保全义务。
- **历史已吸收不覆盖 dirty 保护。** 即使对应 commit 已在 `origin/main`，本地仍有 dirty artifact 时，也不能用“主线已有”作为删除理由。

## 下一动作

1. 由维护者在不改产品代码的前提下，按上述顺序给 `feat/storyboard-row-select-unify` 和 `codex/agent-ui-functional-conformance-20260904` 指定 owner 与保存点。
2. 对 #435 及 TikHub/video deconstruction 独立设计分支做范围/依赖/归属对账；在 owner 决策前保持 open PR 和设计分支不动。
3. 对 Agent v3.1、P0 exception、conformance piece1、3D dispatch、MCP receipt/client-confirm、S5/S6 做主线 ancestry/patch 对账，输出“已吸收 / 仍需摘取 / 仅剩 dirty artifact”三类结果。
4. 仅在上述事项完成、连续复核一致后，另行提交精确的回收清单；本报告不触发任何删除或 prune。

## 收据

```text
baseline: origin/main = 45912ae
worktrees: 92
local_branches: 209
detached: 16
prunable: 2
open_prs: 17
product_code_changed: no
long_running_scan_or_test: no
deletion_or_prune_executed: no
```
