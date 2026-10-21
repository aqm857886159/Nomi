# 词汇门岗发布分支基准选择设计卡

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：让历史词汇债务棘轮选择与当前分支拓扑一致
负责人：Codex
类别：[其他]

| 格 | 结论 | 证据 |
|---|---|---|
| 1 用户怎么用 | 发布分支执行 `check:vocabularies` 时，仍逐个比较可用历史快照；main 后续收敛的债务不能作为额外快照加入旧分支。 | `node --test scripts/check-vocabularies.node-test.mjs scripts/check-vocabularies-history.node-test.mjs` 的真实 Git 分叉夹具 |
| 2 谁说了算 | `resolveReferenceBaselines` 负责收集历史快照；唯一的分支条件是 `origin/main` 只有在祖先关系成立时才加入。 | `node scripts/door-map.mjs resolveReferenceBaselines --roots=scripts --include-tests` |
| 3 一致与复用 | 复用现有 `git merge-base`、`git merge-base --is-ancestor` 与 `HEAD^1`，不引入新 Git 库或第二套基线格式。 | `scripts/check-vocabularies.mjs` |
| 4 全状态 | dirty baseline 时保留 HEAD、HEAD^1、merge-base 等历史快照；HEAD 已包含 origin/main 时额外加入 origin/main；无可读快照时 fail closed；明确 `VOCAB_BASE_REF`/文件仍优先。 | 历史快照测试、分叉测试与现有 seed 测试 |
| 9 验收与回滚 | 先跑词汇测试与门岗，再跑 root-cause contract；回滚为恢复旧选择逻辑的单提交。 | 本报告中的命令原始退出码 |

### 功能分类
- [ ] 新界面 / 交互交付
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [x] 数据格式 / CI 门岗行为

本次不涉及用户界面、外部服务、依赖升级或迁移；改动只收紧 `origin/main` 的加入条件，保留历史快照逐个比较。
