# 设计流程怎么用（nomi-design-flow 技能指南）

> 日期：2026-09-03 · 指向：`.claude/skills/nomi-design-flow/SKILL.md`（技能详细执行步骤）

## 一句话

说出「帮我设计…」「出个样张」「改这个界面」「改下这个布局」「这个 UI 怎么样」「加个面板」等，技能自动触发，走**五步可执行流水线**，不用手动记每步该做什么。

## 触发词（hook 自动检测）

`设计 / 样张 / 界面 / UI / mockup / 改这个面 / 重做 / 加个面板 / 布局 / 改界面 / 出个样` 等。
hook 命中时会顶出一行「设计流程提示」，确保 AI 不跳步。

## 五步摘要

| 步骤 | 做什么 | 防什么事故 |
|---|---|---|
| ① 先看真实样子 | 读完整外壳组件或真机截图 | 改现有 UI 脑补错位（栽过 3 次） |
| ② 查设计系统 + 复用 | Beautiful UI / AI Elements 整件复用，四步流水线 | 手搓重复，半年后不一致 |
| ③ 出样张 | HTML + 真实 token + `data-*` 挂点 + 五种异常态 | 拍板后实现跑偏，无机器信号发现 |
| ④ 交付走读 | 逐屏逐件：这是什么 / 为什么 / 什么时候碰 | 用户拍不了板（统计表看不到决策理由） |
| ⑤ 拍板后产契约 | `pnpm run check:mockup-contracts` 产 `.auto.mjs` + 手写 `.intent.mjs` | 实现漂移（骨架段跑到框外了，36 门全绿也发现不了） |

## 依赖关系

步骤⑤依赖 PR #395（`feat/design-conformance-unified-20260903`）提供的工具链：
- `scripts/inject-mockup-tokens.mjs`
- `scripts/extract-design-spec.mjs`
- `scripts/check-mockup-contracts.mjs`
- `tests/ux/_contract.mjs`（统一断言器）

**#395 合入 main 前**：步骤①–④照常可用；步骤⑤跑 `check:mockup-contracts` 须切换至 #395 分支。

## 常见问题

**Q：步骤③的 `data-*` 挂点命名规范是什么？**
`data-[功能域]-[元素名]`，如 `data-agent-header`、`data-storyboard-plan-card`。

**Q：异常态漏画了会怎样？**
`check:mockup-contracts` 不会直接报异常态缺失（它检查几何/containment/order），但步骤⑤的 intent 层可以写「P0 缺口必须画」的断言。先查 `docs/design/agent-ui-state-coverage-gaps.md` 的 P0 列表。

**Q：设计系统 token 改了，需要重新产契约吗？**
如果只是语义（加新 token），不需要；如果是值变了（如 `spacing-4` 从 16px → 14px），需要重跑 `extract-design-spec.mjs` 更新 `.auto.mjs` 基线。

**Q：「逐件走读」格式有没有范本？**
有。参照 `docs/design/2026-09-02-agent-ui-v3-walkthrough.md`——那是经用户拍板认可的交付格式。
