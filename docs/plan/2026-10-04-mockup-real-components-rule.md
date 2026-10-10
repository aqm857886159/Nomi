# 设计卡：样张必须由真组件搭建

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：把样张用真组件搭升为 R8/P5 与门岗硬规则  线/负责人：docs/mockup-from-real-components  类别：[其他]

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当创作者要拍板一处用户可见界面时，我想看到真实组件在真实宿主数据下的实验室屏，以便拍板后生产代码不再靠手工翻译；本变更不新增产品界面，已知坑是存量 HTML 样张必须保留为只减不增的历史基线。 | 任务书 `/Users/aoqimin/Desktop/Nomi-3dbox-plans/briefs/brief-rules-lab-mockup.md`；四次教训链接 |
| ★2 谁说了算 | 样张合同判据唯一归 `scripts/check-mockup-contracts.mjs`；实验室屏注册归 `src/devlab/designLab/labScreens.ts`；规则文字归 `CLAUDE.md`、`docs/engineering-rules.md` 与 `scripts/claude-hooks/self-check.sh`；生产组件仍归各自生产目录。 | `node scripts/door-map.mjs scripts/check-mockup-contracts.mjs`（实现后复核） |
| ★3 一致与复用 | 复用现有 `labScreens.ts` / `ShellStage` / `tests/ux/design-lab/labStates.mjs` 登记链，只给门岗增加静态判据；不另造第二份实验室注册表，不改 3D-BOX 外壳 lane。 | `rg -n "LAB_SCREENS|ShellStage" src/devlab tests/ux/design-lab`; `check:design-lab` |
| ★4 全状态 | 不适用：本变更不改产品界面或产品状态；门岗新增的合同状态只允许 `match`、`difference`、`deferred`，差异必须有原因，推迟必须有目标阶段。 | `scripts/check-mockup-contracts.mjs` |
| ★9 验收与回滚 | 先用违规夹具证明新契约缺 labScreen / 真组件 / 完整对账会红，再删夹具；跑门岗、hook、agents 同步、规则别名和相关脚本测试。回滚为 revert 本分支提交。 | `pnpm run check:mockup-contracts`; `pnpm run check:claude-hooks`; `pnpm run gen:agents`; `pnpm run check:agents-sync`; `pnpm run check:rule-aliases` |
