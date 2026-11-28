# Contracts 检出状态方向检查

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

自写登记 `gate-family` 命中。独立复盘线对 `origin/main` 只读核对。交接处登记表外，全图是 `.github/workflows/quality-gate.yml:159` 检出并安装 → `scripts/run-gates-contracts.mjs:154` 逐门执行 → `scripts/check-hook-behavior.mjs:322` 运行登记表 → `.claude/settings.json:83` 执行 SessionStart。行号以修前基线为准。

## 0. 类根因

验证探针把被测检出交给了真实会话命令，门岗执行器又只消费退出码。一个成功退出的门岗可以改掉整条链后续步骤的输入。

## 1. 归类

| 事件 | 直接原因 | 类 |
|---|---|---|
| run 45331233660 | SessionStart 先 fetch 再快进，HEAD 从 af64c5688 到 0250ecc5e，已装依赖里缺新提交引入的 p-retry。每日雷达还启动了约 111 秒的外部检查。 | 探针把会话副作用带入被测检出 |
| run 40035294026 | 夜间走查写入未忽略的截图，后续 23 条走查因构建输入身份漂移被拒。见 `scripts/nightly-walk-tree-guard.mjs:8`。 | 单步写入使后续步骤失效 |

## 2. 为什么会复发

无害的输入不能约束被调用脚本的行为。旧测试只复制 hook shell 脚本，缺少完整 SessionStart 入口。旧 runner 的成功分支只读子进程退出码，没复核 Git 状态。体验铁律 ⑩⑪⑫ 不适用，此处是工程验证链。

## 3. 可验证预测

- 真实临时主仓的远端前移后，settings 轴正常载荷仍退出 0，受测 SHA 与 porcelain 保持基线。三种 CI 标志都禁止 follow 发起 fetch，真实本地会话仍能追上远端。
- 成功步骤只改 SHA、只改 porcelain 两种情况都能被点名阻断，包含 advisory 步骤。下一只读步骤继续，并以实测状态为基线。
- 只读步骤与写入 Git 忽略目录的步骤通过，正常 advisory 退出失败仍只提示。分别用 runner 测试和真实 Git CLI 冒烟复核。

## 4. 靶子独立性

回放的 SHA 和 porcelain 由实际 Git 仓库提供，独立于 runner 和 hook 退出码。实现线在修改生产代码前保留了 base 到 ahead 的回归测试红灯。现有缺脚本、正常载荷和本地快进测试提供反向对照。未找到修对后评测掉分的证据。

## 5. 整块归属

这一整块：`gate-family` 的 Contracts 逐门验证、输入身份和失败归因。

归谁：Git 标准命令提供 SHA 和 porcelain（本机 Git 2.50.1）。`package.json:101` 声明门序，`scripts/run-gates-contracts.mjs:148` 执行并归责。会话快进判决归 `docs/engineering/concept-owners/delivery.main-checkout-follow.json:11`。

我们哪里绕开了它：`scripts/check-hook-behavior.mjs:322` 将真检出作为 hook 执行目录，`scripts/run-gates-contracts.mjs:158` 只取子进程退出码。

`docs/engineering/self-written.json:1591` 已核对 ESLint boundaries、dependency-cruiser 和 Knip。它们静态分析代码或依赖，无法替代真实命令执行后的 Git 状态检验。Git 负责通用能力，本次直接使用。门岗族的保留、合并、降级与删除仍按账本在 2026-11-30 复审，替换日期取决于逐项结论。

## 6. 三条路

| 路径 | 效果与代价 |
|---|---|
| ① 只补快进入口 | 拦住此次 CI fetch，其他登记 hook 或门岗的写入仍会漏过。 |
| ② 复用 Git 并调整执行边界（用户选定） | 隔离真实 hook、关闭自动化快进、每门结束核对 Git。快照轮询有固定成本，归因共享同一个入口。复用夜跑的逐步归因做法，Contracts 无需构建戳或自动还原。 |
| ③ 删在场对照或 SessionStart 登记 | 可消除事故触发点，代价是失去正常载荷回归判据或日常主仓自动同步。 |

## 7. 权衡

保留实跑和正常会话同步。门岗越界时以 Git 证据点名具体步骤。快照覆盖步骤前后可见状态，步骤内恢复或保持同一脏文件状态的内容变化超出本次判据。

特征测试见 `scripts/check-hook-behavior.node-test.mjs`、`scripts/main-checkout-follow.node-test.mjs`、`scripts/run-gates-contracts.node-test.mjs` 和夜跑的 `scripts/nightly-walk-tree-guard.node-test.mjs`。
