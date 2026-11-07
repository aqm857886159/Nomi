# RC ref guard first

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

1. **User and outcome**: A release operator dispatches the RC workflow for a branch or commit and needs validation and packaging to run against that exact source.
2. **Single owner**: The validate job owns source identity; the shared `verify-workflow-ref.mjs` boundary compares the checked-out `inputs.ref` commit with `github.sha` before any install or test step.
3. **Reuse**: The workflow delegates comparison and diagnostics to one script; the existing release workflow consumes the resulting SHA output and needs no second comparison.
4. **State**: Matching identity proceeds; a mismatch fails closed with trigger ref, intended ref, and both SHAs.
5. **Acceptance**: Node tests cover matching and mismatching inputs; the workflow contract test proves the guard is first after checkout.

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [x] 数据格式 / CI contract
