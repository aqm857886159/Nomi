# Workbench Skill picker 修复

## 目标

让合法的 `workbench.storyboard.planner` 从 canonical Skill catalog 经真实
`nomi:skill:list` IPC 进入 Agent Skill 菜单，并且点击后的 `{ key, name }`
继续走现有 `creationActiveSkill` → `runWorkbenchAgent({ skillKey })` 链路。

## 根因与边界

- 根因：renderer-facing Skill 列表把“内置 playbook（有 stages）”误当成全部可选内置 Skill，漏掉合法的单阶段 storyboard planner。
- 共享边界：`electron/skills/skillStore.ts` 负责可选性策略；`electron/skills/skillIpc.ts` 负责把该策略投影成 renderer DTO。
- 保留：用户 Skill 仍可见；已有多阶段内置 playbook 仍可见；MCP audience 仍与 Workbench picker 独立。
- 不动：PR #454 的 storyboard 规划/画布样张、Agent runner、生成 provider 与既有审批链。

## 实施

1. 红测覆盖 happy、单阶段合法 Skill、内部 routing Skill、缺失/坏 manifest、用户 Skill、错误 audience 与 provider 缺失时仍可选择。
2. 在 Skill manifest 增加显式 `selectableInWorkbench` 声明；storyboard planner 标记该声明。
3. 删除 IPC 内重复的 stages-only 过滤，改用 `isSkillSelectableInWorkbench` 共享策略。
4. 通过真实 Electron loopback journey：从 Agent 菜单看到并点击 Skill，检查 chip 与发送请求的 `skillKey`，再走公开项目读回/冷启动边界。

## 验收

- `pnpm exec vitest run electron/skills/skillIpc.test.ts electron/skills/skillStore.test.ts electron/skills/skillManifestSchema.test.ts`
- `pnpm run check:root-cause-contracts`
- 受影响的 focused/unit/contracts、typecheck、build 与真实 Electron loopback journey。
- live provider canary 只有在 UI journey 绿后才尝试；无凭据时记录 blocked，不伪造成功。

## 回滚

回滚本分支提交即可；无用户数据迁移。新 manifest 字段为可选字段，旧 Skill 包继续按原有用户/多阶段规则处理。
