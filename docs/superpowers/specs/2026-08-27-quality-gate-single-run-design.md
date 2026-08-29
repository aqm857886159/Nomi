# Quality Gate 单一触发与稳定基线设计

日期：2026-08-27

## 问题

`quality-gate.yml` 同时监听 `push` 的 `feat/**`、`fix/**` 分支和 `pull_request`。当一个已开 PR 的分支更新时，同一提交会产生两套同名的 `Quality Gate` 与 `Mac Package`。

PR #205 暴露了第二层问题：GitHub 的“更新分支”使用 rebase 改写了分支历史，`push` 事件仍把改写前 SHA 放进 `github.event.before`。该 SHA 已不再被任何远端引用，即使 `actions/checkout` 使用完整历史也无法取得。语义词表门岗按设计 fail closed，于是正确的 PR 检查已经通过，重复的 push 检查仍以“历史基线不可用”阻止合并。

## 目标

1. 一个 PR 的同一 HEAD 只有一套合并前完整门禁。
2. PR 更新只验证最新 HEAD，过期中的 run 自动取消。
3. 语义词表门岗始终使用与事件生命周期相符、可取得的历史基线。
4. 合并前覆盖不减少；`main` 落地后仍做一次独立验证。
5. 用仓库内自动化契约锁住触发器、并发键和基线表达式，防止回归。
6. 当 GitHub 漏发 `pull_request` 检查事件或普通 Git push 暂时不可用时，可以对精确分支 HEAD 手动补跑同一套门禁，而不是制造空提交、复用旧 SHA 或管理员绕过。

## 方案比较

### A. 只加 concurrency，保留双触发

让 push 与 PR 事件共享一个并发组，后到的 run 取消先到的 run。它只能降低重复消耗，无法保证哪一类事件最后到达，也无法消除同一提交上的重复检查记录；若 push run 获胜，rebase 前 SHA 仍可能不可用。因此不采用。

### B. 保留分支 push，给旧 SHA 增加 fetch/retry/fallback

它把“已经没有远端引用的对象”当成网络获取问题，无法可靠修复。若退回 `origin/main`，又会把 push 门岗的比较语义悄悄改成另一套规则，仍然保留两份完整 CI。因此不采用。

### C. PR 单一门禁，main 落地复验（采用）

- `push` 只监听 `main`。
- `pull_request` 负责所有合并前验证。
- PR 使用 `github.event.pull_request.base.sha` 作为词表基线。
- `main` push 使用 `github.event.before`；受保护主线是快进/合并历史，该 SHA 仍为主线祖先。
- workflow 级 concurrency 对同一 PR 使用 PR 编号，对主线使用 `github.ref`，并取消过期 run。
- `workflow_dispatch` 只作为显式恢复入口；调用者必须选择精确 ref，词表基线默认使用 checkout 后可达的 `origin/main`，也可显式传入另一条可取得的基线 ref。

代价是尚未创建 PR 的远端 `feat/**`、`fix/**` 分支不再自动运行完整远端门禁；开发者仍可运行本地 `pnpm run gates`。创建 PR 后完整验证立即恢复。

## 事件流

```text
未开 PR 的功能分支 push
  └─ 不运行远端完整 Quality Gate

PR opened / synchronize / reopened
  ├─ 取消同一 PR 的过期 run
  └─ 对当前 PR HEAD 运行一套 Quality Gate + Mac Package

PR merged -> main push
  └─ 对落地主线运行一套 Quality Gate + Mac Package

自动事件漏发 / Git transport 暂时不可用
  └─ workflow_dispatch(ref=当前 PR HEAD, base_ref=origin/main)
      └─ 对同一 HEAD 补跑完整 Quality Gate + Mac Package
```

## 实现边界

修改范围：

1. `.github/workflows/quality-gate.yml`
   - 将 push 分支过滤收敛为 `main`。
   - 添加 workflow 级 concurrency。
   - 保留 PR base / push before 的事件分流，但不再让功能分支 push 消费 `before`。
   - 添加带 `base_ref` 输入的手动恢复入口；不改变正常 PR 与 main 事件语义。
2. `scripts/check-quality-gate-workflow.node-test.mjs`
   - 直接读取 workflow，验证触发器、并发组、取消策略和基线表达式。
3. `package.json`
   - 把该契约测试接入现有门岗链，使配置回归在本地与 CI 都会失败。

不修改分支保护规则，不降低必需检查，不改变 `pnpm run gates` 内容，不管理员绕过失败检查。

## 错误处理

- PR 基线缺失时继续 fail closed；不静默改用别的提交。
- `main` push 的 `before` 不可用时继续 fail closed，暴露受保护主线的异常历史改写。
- 手动恢复只接受调用者显式选择的 ref；`base_ref` 默认 `origin/main`，解析失败仍 fail closed。这里不用裸 `main`，因为 detached checkout 不保证创建同名本地分支。
- 新提交到达时只取消同一 PR 的过期 run，不影响其他 PR 或主线 run。

## 验证

### RED

在当前 workflow 上运行新契约测试，应准确失败：功能分支仍在 push 过滤中，且缺少并发控制。

### GREEN

1. 新契约测试通过。
2. `pnpm run check:gates-chain` 通过，证明新测试已进入完整门岗可达链。
3. `pnpm run gates` 与 `pnpm run build` 通过。
4. 推送修复 PR 后，观察当前 HEAD 只产生一套 PR `Quality Gate`/`Mac Package`；若更新该 PR，旧 run 被取消，最新 run 独立完成。

## 成功标准

- PR 页面不再出现同一 HEAD 的两组同名必需检查。
- rebase/更新分支不再因改写前 `push.before` 阻塞合并。
- 合并前完整测试、构建、Mac 打包、Electron smoke 与真实用户旅程保持不变。
- `main` 合并后仍运行完整复验。
