# 词汇门岗发布分支基准选择设计卡

改动名：让历史词汇债务棘轮选择与当前分支拓扑一致
负责人：Codex
类别：[其他]

| 格 | 结论 | 证据 |
|---|---|---|
| 1 用户怎么用 | 发布分支执行 `check:vocabularies` 时，只应与该分支可解释的历史快照比较；main 后续收敛的债务不能让旧分支凭空变红。 | `node --test scripts/check-vocabularies.node-test.mjs` 的真实 Git 分叉夹具 |
| 2 谁说了算 | `resolveReferenceBaselines` 是唯一的历史参照选择 owner；门岗调用者消费它返回的单一参照。 | `node scripts/door-map.mjs resolveReferenceBaselines --roots=scripts --include-tests` |
| 3 一致与复用 | 复用现有 `git merge-base`、`git merge-base --is-ancestor` 与 `HEAD^1`，不引入新 Git 库或第二套基线格式。 | `scripts/check-vocabularies.mjs` |
| 4 全状态 | 有共同历史时选 merge-base；HEAD 已包含 origin/main 时选 origin/main；无可读快照时 fail closed；明确 `VOCAB_BASE_REF`/文件仍优先。 | 三个 Git 场景测试与现有 seed 测试 |
| 9 验收与回滚 | 先跑词汇测试与门岗，再跑 root-cause contract；回滚为恢复旧选择逻辑的单提交。 | 本报告中的命令原始退出码 |

### 功能分类
- [ ] 新界面 / 交互交付
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [x] 数据格式 / CI 门岗行为

本次不涉及用户界面、外部服务、依赖升级或迁移；改动只收紧历史参照的选择边界。
