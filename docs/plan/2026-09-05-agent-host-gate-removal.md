# 常驻 Agent 拆发布闸 · 默认开 · Beta 明说

> 日期：2026-09-05 ｜ 分支：`fix/agent-host-gate-default-on-20260905` ｜ 状态：🚧 待合入
> 根因合同：[`docs/fixes/2026-09-05-agent-host-parallel-gate.root-cause.json`](../fixes/2026-09-05-agent-host-parallel-gate.root-cause.json)

## 为什么做（底层逻辑）

项目常驻 Agent 一直藏在一个默认关的发布闸后面：`src/utils/agentHostPreference.ts` 的
`DEFAULT_AGENT_HOST_ENABLED = false`，`WorkbenchShell` 读它决定要不要把 `ProjectAgentResidentShell`
portal 出去。结果是**同一份代码跑出两个产品**——

- 用户装的那份：**根本没有 Agent**。整套 UI 不挂载，连折叠药丸都没有。
- 测试跑的那份：走查/夹具先 `localStorage.setItem('nomi.agentHost.enabled','true')` 再 reload，
  于是断言的是一棵**没有任何用户见过**的渲染树。

这就是 P1 说的并行版：两条路各修各的。测试发现的 bug 用户碰不到，用户碰到的 bug 测试摸不着；
而「等打磨完再开闸」永远等不到——**藏起来就等于把这块 UI 移出了唯一能把它修好的反馈回路**。

## 做什么

1. **删闸，不是翻默认值**。把 `DEFAULT` 改成 `true` 会留下一个「有时开有时关」的逃生口，
   同样是并行版。整个 `agentHostPreference` 模块、它的单测、设置页的 `AgentHostSection`
   开关和两条 i18n 词条一并删除。
2. **`WorkbenchShell` 无条件渲染**：`agentDockRefs` 恒给四个工作区，`agentDock` 直接取
   `agentDockTargets[agentSurface]`。
3. **未完成明着标（D4）**：常驻面板 header 标题旁加 `StatusBadge tone="info"` 的 `Beta` 徽标，
   hover 说明「多步编排与审批链可能出错，重要改动请先确认」。它是标签不是控件，
   不占 §1.5 的常驻控件预算，不新增控件位。文案走 i18n（zh-CN + en）。
4. **测试侧删「先开闸」步骤**：`agent-ui-conformance.walk.mjs`、
   `agent-ui-exception-states-runtime.walk.mjs`、`resident-composer-receipt-fix.e2e.mjs` 三处
   写 key + reload 的备场步骤删除——现在天然是开的，走查从此和用户的冷启动同一条路。

## 不动项

- `electron/projectAgentHost/` 下的 reducer / coordinator（另一刀在改）。
- `src/workbench/creation/storyboard/`（另一刀在改）。
- `.github/workflows/` 与 `scripts/check-*`（另一刀在改）。
- Agent 自身的编排、审批、结算语义：本刀只改「谁能看见它」，不改「它怎么干活」。
- 历史证据文档（`docs/qa/`、`docs/audit/`、`docs/research/` 里写着
  `agentHostEnabled=false` 的段落）保持原样——那是当时的事实快照，改了就成了篡改证据。
  只有活的登记表 `docs/engineering/active-lanes.md` 与活的矩阵 `tests/system/agent-m0-m5.json`
  的表述被更新。

## 回滚

单 commit，`git revert` 即可。回滚后常驻 Agent 重新对所有用户可见（因为闸已不存在），
若要真正退回「藏起来」的形态，必须连同结构测试里的三条存在性断言一起撤，
这正是它们存在的意义——revert 不能静默通过。

## 验收门

| 门 | 判据 |
|---|---|
| 类型 | `pnpm run typecheck` 绿 |
| 结构回归 | `ProjectAgentResidentShell.structure.test.ts` 新增 2 条：无条件挂载 + Beta 徽标在位 + 闸文件不存在 |
| 单测 | `pnpm run test:system:focused` 绿 |
| 走查（R13） | ≥3 条真实 Electron 走查绿，零额度；截图人眼确认「默认就有 Agent 面板」与「Beta 徽标在标题旁」 |
| 门岗 | `pnpm run gates` 全绿（含 `check:i18n`、`check:root-cause-contracts`） |
| 残余 | 全仓 grep `agentHostEnabled|agentHostPreference|nomi.agentHost` 在 `src/ electron/ tests/` 零命中 |
