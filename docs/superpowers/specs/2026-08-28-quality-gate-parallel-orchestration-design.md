# Quality Gate 等覆盖并行化设计

日期：2026-08-28

## 决策

本轮只优化测试编排，不删除测试、不按改动路径跳过测试，也不复用旧提交的测试结果。现有合并前覆盖保持完整，把原来一个 Ubuntu job 内串行执行的静态合同、单元测试、Electron 构建与真实旅程拆成独立并行 job；Mac 打包继续独立执行。最终由一个仍名为 `Quality Gate` 的汇总 job fail closed 收口。

## 用户摩擦与根因

当前一次 PR Quality Gate 的墙钟时间约 8 分钟，其中仓库门禁、单元测试、Electron smoke 和真实用户旅程在同一 Ubuntu job 串行执行。它们验证的是不同故障面，彼此没有数据依赖，却因为编排方式被迫排队。

真正要减少的是等待，不是验证。直接删测试或按文件路径猜测“这次不用跑”虽然更快，但会把模型接入、Electron 运行时、跨进程合同和真实用户操作链路的缺陷放进主线，因此不采用。

## 方案比较

| 方案 | 用户看到 | 风险 | 决策 |
|---|---|---|---|
| 删除或抽样测试 | 很快，但偶发回归进入主线 | 覆盖下降，故障常在合并后出现 | 不采用 |
| 按改动路径跳过测试 | 小改动很快 | 依赖关系判断会漂移，跨层影响容易漏判 | 不采用 |
| 保持全覆盖、拆成并行 job | 等待时间缩短，失败位置更清楚 | 多个 runner 会重复安装依赖 | 采用 |
| 复用 `main` 相同树的旧结果 | 理论最快 | 缓存身份、环境与分支保护语义复杂 | 本轮不做 |

## 覆盖合同

合并前必须同时成功的验证面保持为：

1. `contracts`：全部 `check:*` 静态门、lint、双向 typecheck、测试类型门。
2. `unit`：完整 Vitest 与 agent runtime 测试。
3. `desktop-linux`：renderer/Electron build、Electron smoke、CI 真实用户旅程 J3/J5，并始终上传走查证据。
4. `mac-package`：Mac build、arm64 目录打包、packaged MCP smoke、codesign 验证。
5. `quality`：`if: always()` 汇总前四项；任一项 failed、cancelled 或 skipped 都失败。

`pnpm run gates` 的本地语义保持不变：静态合同 → 单元测试 → build → 写入 `.claude/.gates-ok`。拆分只发生在 GitHub Actions 的并行编排层。

## 单一真相源

- `gates:contracts` 持有静态合同、lint、typecheck 和 test-types 的唯一命令链。
- `gates` 只组合 `gates:contracts`、`test`、`build` 与成功印章，不再复制静态命令串。
- `tests/system/profiles.mjs` 声明 CI 的 `ci-contracts`、`ci-unit`、`ci-desktop` 三个可执行 profile；package scripts 和 workflow 只引用这些 profile。
- workflow 契约测试同时读取 workflow、profiles 与 package scripts，证明三条并行路径的 stage 并集与旧 Ubuntu 必需覆盖集合完全相同。

## 失败语义

- 不增加自动 retry；暂态基础设施问题仍如实失败。
- 不使用 `paths`、changed-files 或条件表达式跳过验证面。
- 汇总 job 使用 `always()`，但只在所有依赖结果均为 `success` 时通过。
- Linux 旅程失败仍上传截图和 `output.jsonl`，便于远程定位。
- PR 与 `main` 的触发、并发取消、VOCAB/ROOT_CAUSE 基线语义沿用 PR #209 的单次运行合同。

GitHub 官方说明：依赖 job 失败或跳过时，下游默认会被跳过；在汇总 job 上使用 `always()` 可保证它仍执行。`needs` 上下文暴露每个依赖的 `result`，因此汇总脚本显式要求四个结果都为 `success`，而不是把“汇总 job 被调度”误当成通过。索引语法用于含连字符的 job id。参考：[Using jobs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs)、[Contexts reference](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts)、[Expressions](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions)。

## 预期价值

根据近期同仓运行，Repository gates 约 294 秒、Electron smoke 约 29 秒、真实旅程约 158 秒、Mac Package 约 255 秒。拆开后总墙钟时间由这些时长相加，变为等待最慢 job；目标从约 8 分钟收敛到约 4–5 分钟，同时失败会直接落到 Contracts、Unit、Desktop Linux 或 Mac Package，不再翻一整段日志找原因。

## 验证

1. 先写合同测试，在旧 workflow 上准确 RED：缺少并行 job、profile 和 fail-closed 汇总。
2. 实现后 focused GREEN，并运行每个 profile。
3. 运行完整 `pnpm run gates`，证明本地覆盖未变。
4. 推送 PR 后核对真实 checks、job 时长和证据上传；所有 required checks 全绿才交付。
