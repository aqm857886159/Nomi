# 风险分层测试与合并证据收据

日期：2026-08-30
状态：✅ 已交付

## 用户摩擦

当前 `fast/full` 只有两档。只要碰到 Electron、测试系统或 `main`，单元测试、桌面 smoke、真实旅程、完整画布、14 场景性能基准和 macOS 打包就一起启动。一次普通 PR 可能在 PR、合并后的 main push 和本地 merged receipt 上重复验收三遍；其中 `canvas-full` 又把功能验收和性能基准绑在一起。结果是等待时间主要花在与改动无关的故障面上，失败原因也很难从一个大包里定位。

本轮目标不是少测，而是让每类风险只支付对应测试成本，并让 PR、main push 和最终收据共享同一份可执行判断。

## 决策

建立 `scripts/validation-policy.mjs` 作为唯一风险策略，输出独立维度：

| 维度 | 取值 | 证明什么 |
|---|---|---|
| `unit` | `focused` / `full` | 关联行为或全仓逻辑没有回归 |
| `desktop` | boolean | Electron 构建与桌面 smoke 可运行 |
| `journeys` | boolean | CI-safe 真实用户旅程闭环 |
| `canvas` | `none` / `critical` / `full` | React Flow 画布功能合同 |
| `performance` | boolean | 画布性能预算与稳定性 |
| `package` | boolean | macOS 安装目录、运行时身份和签名 |
| `failClosed` | boolean | 无法安全缩小范围时启用保守兜底策略 |

验证基础设施本身（`.github/workflows/**`、质量门脚本、测试框架配置和走查/性能测试协议）使用一个受控的 fail-closed
变体：仍执行完整单元、桌面、journey 和功能画布验收，但不自动执行性能或 macOS 打包。性能与打包属于独立风险面，只有
实际修改 React Flow/媒体渲染或打包边界时才启用。基础设施重命名也使用这个变体；若同一 diff 混入真实产品或打包风险，
策略会继续逐维追加对应门禁，不会因先命中基础设施而提前返回。这样修改测试系统不会把 Linux runner 的帧调度抖动误报为
产品回退，同时测试系统的功能覆盖仍然保持 fail-closed。

具体规则：

- Contracts 永远执行。
- 文档和隔离 renderer/source 改动使用 focused unit。
- 任意 Electron 改动至少升级为 full unit + desktop，但不会自动触发 canvas、performance 或 package。
- 生成画布功能改动触发 canvas；React Flow 内核、viewport、节点媒体渲染与调度等性能敏感路径另外触发 performance。
- 打包配置、依赖锁、Electron 启动/preload/runtime path 和 release 边界触发 package。
- 产品文件删除/重命名、空 diff、无法解析的 diff 和手动 full 验证执行全维度 fail closed；分类器/工作流/测试系统自身改动执行上述功能型 fail-closed 变体。
- `main` push 使用 webhook 的真实 `before..after` 重新分类，不再仅因为事件是 push 就升级为全量。

## 编排

1. `Validation Scope` 从 Git diff 得到文件状态并调用共享 policy。
2. `Contracts` 始终运行；`Unit` 根据 `unit` 选择 focused/full。
3. Linux job 只在 desktop/journeys/canvas/performance 至少一项被选中时启动，一次 build 后按维度执行所需阶段，避免重复构建。
4. `Mac Package` 只在 package 被选中时启动；未选中时保留 GitHub 的 skipped check，`Quality Gate` 聚合器只要求被策略选中的 job 成功。
5. 画布 functional full 与 performance 是不同 stage；性能结果始终写 JSON 并上传，`pass:false` 必须以非零退出码阻止合并。
6. 合并后 `delivery:verify-merged` 继续只相信 Git fetch 得到的 exact merge SHA/tree，但不再本地第三次运行 `full-local`。它等待并记录该 SHA 上 `Quality Gate` 与 `Mac Package` 的成功/skipped/neutral check run，生成一次性证据收据。
7. 最终 `Quality Gate` 读取同一 workflow run 中已完成 job 的 GitHub annotations。未登记的 warning/failure、过期例外或 API 取证失败都会阻止合并，并始终上传 `ci-annotations.json`；Contracts 源码 lint warning 明确委托给 `lint:ci` 的 82 条棘轮管理，其余例外必须写明原因和到期日。

## 不动项

- 不修改 React Flow 产品代码、Agent/MCP/Skill Draft PR 或 MiniMax PR。
- 不删除安全、凭据、持久化、取消、恢复、媒体验真与真实入口测试。
- 不用 mock 绿灯替代需要真实外部资源的 live 证据。
- `full-local` 与 release profile 仍保留为显式全量/发布验证，但不再是每个 merged SHA 的固定第三遍。

## 验收

1. 分类策略覆盖 docs、普通 renderer、Electron、journey、canvas、performance、package、删除/重命名、空 diff、PR/main/manual 三类事件。
2. PR 与 main workflow 都消费同一组维度；分类器错误全维度 fail closed。
3. canvas full 不含性能 benchmark，performance profile 独立且失败返回非零。
4. exact merge SHA 的成功与 skipped required checks 可生成收据；missing、pending、failure、错误 SHA 都不能伪装完成。
5. 定向 Node/Vitest、根因合同、规则同步和完整高风险 CI 全绿后合并。
6. CI annotations 默认为零容忍；Node runtime 弃用等日志告警不能只靠人工发现或强制运行时垫片隐藏。现有 ESLint warning 上限从 98 收紧到真实值 82，委托不等于允许增长。

## 回滚

回滚 policy、workflow、profiles、性能 verdict 和 merged evidence receipt 的同一提交即可恢复旧编排。收据位于 Git common dir，不进入用户项目数据；回滚不需要迁移产品数据。
