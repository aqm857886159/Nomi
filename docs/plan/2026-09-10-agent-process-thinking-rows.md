# C77 · 过程思考行收敛

> ✅ 已实现并通过验证 · 待 PR 审阅 · 2026-09-10 · 用户任务书已确定交互方案

## 问题与裁决

展开一次过程却看到五条「思考过程」，用户误读为五份工具产物。思考是活状态：运行中由已有过程摘要承载；完成后所有思考正文合成工具前最多一个可展开项，正文顺序保留。无需新增控件或样式，按用户确定方案直接实施。

## 范围与根因

`collapseV4Flow` 已把 thinking 纳入 work stretch，但 grouped.push 后按原始位置 sort，使每段思考再次成为工具之间的平级行。共享投影缺少过程级思考基数约束，属于 recurring。实时 lane、历史 lane 和实验室都消费同一折叠层。仅修这一边界、必要回归/真机走查、过程相关基线与交付文档；不改工具执行或持久化。

## 先查别人

核实日期：2026-09-10。以下均实际读取原始来源，不以搜索摘要替代证据。Claude Code / Codex 是官方仓库；Cursor 是官方社区内产品方确认的具体交互问题，不能把 bug 当成设计规范。

1. **Claude Code：思考进度归入活状态，避免独立提示行。** 官方 [CHANGELOG v2.1.116](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21116) 原文：`Thinking spinner now shows progress inline ("still thinking", "thinking more", "almost done thinking"), replacing the separate hint row`。同页 v2.1.152：`Thinking summaries in the collapsed group now stay readable for at least 3 seconds, render as markdown, and cap at 10 lines (Ctrl+O shows the full thinking)`。结论：运行状态适合原位更新，正文可折叠保留。**并未据此断言 Claude Code 永远只保留一条思考历史。**
2. **Codex CLI：当前思考更新 shimmer，完成思考只进入展开 transcript。** 官方源码 [streaming.rs](https://github.com/openai/codex/blob/main/codex-rs/tui/src/chatwidget/streaming.rs#L273) 第 310 行明确 `Update the shimmer header to the extracted reasoning chunk header.`；第 318–333 行 `on_agent_reasoning_final` 调用 `new_reasoning_summary_block`。对应 [messages.rs](https://github.com/openai/codex/blob/main/codex-rs/tui/src/history_cell/messages.rs#L662) 注释：`Retain a completed reasoning block in the expanded transcript only. Activity headings belong to the live status row and must not accumulate in scrollback.`；第 359–369 行 `transcript_only` 时 `display_lines` 返回空，`transcript_lines` 才返回正文。结论：直接采用“活状态不积累为收据行”的原则。
3. **Cursor：思考为独立可折叠详情，用户主动展开应得到尊重。** 官方社区 [The thinking accordion auto collapse even manually expanded](https://forum.cursor.com/t/the-thinking-accordion-auto-collapse-even-manually-expanded/161661/2)，Cursor 回复者 Dean Rie 实际确认：`We can reproduce it. The thinking block collapses back to the folded state right when streaming for that block ends, even if you expanded it manually. That’s a bug on our side, not by design.` 后续 6 月、7 月、9 月回复反复确认。结论：完成态保留可查详情时应稳定，不随无关工具/流更新反复重建或强制关闭。**该证据不证明 Cursor 全程仅一条思考项；不照搬其多个思考 block 的可见布局，也不把其自动收起 bug 当规范。**

### 本任务采用

采用与 Codex CLI 活状态/历史分离一致的原则，按用户已确定的完成态方案保留一条合并详情：运行中仅过程摘要的 V4Shimmer 承担思考活状态，不额外投影思考行；完成后同一过程内全部思考段合并为最多一条“思考过程”，放在所有工具行之前，按原始顺序保留各段正文。工具和重试的顺序、数量与收据内容不变。Cursor 证据只用于约束详情展开的稳定性。


## 实施与验收

- 合并正文、不复制计时，不篡改每条收据的原始 index；用户气泡仍隔开不同过程。
- 单测先红：N=5/M=4、运行中、跨轮回放；再验证无正文和流式状态边界。
- 真实 Electron loopback 从编辑文稿和发送指令开始；保存分镜空 shots 真实失败，修正后经用户确认成功，核对原文；light/dark 改前改后截图，工具结果与正文落盘核对。零真实模型费用。
- 复用 feel repeated-rows；只更新因本次投影变化的过程截图并列全名。
- `python3 scripts/with-gates-lock.py -- pnpm run gates` 等锁拿到并运行；完成 hook 评审后 push/PR。

## 六角色复核

CTO：约束放共享投影，不改协议。设计：活状态原位更新、历史详情去重。PM：原任务单一摩擦，无功能扩张。前端：保留收据 index 和工具顺序。后端：不改 SDK/存储。用户：看到一次过程、需要时只展开一次思考正文。

## 回滚

通过 revert 本任务提交恢复旧投影；没有数据迁移。

## 已执行证据

- 单测四条先红见 `docs/evidence/2026-09-10-thinking-rows/unit-red.txt`；新增覆盖流式正文及无思考正文场景。
- 现有 `agentPanelV4Form.test.ts` 旧断言显式要求思考位于工具之间，与 C77 冲突；改为工具前且保留工具 index=1/3 校验、思考正文校验。这是用户确定行为的契约更新，不删断言/改容差。
- loopback 改前 5/5、改后 0/1（运行中/完成态思考项），4 次调用 1 次重试；正文五段可查。证据与截图：`docs/evidence/2026-09-10-thinking-rows/README.md`。
- repeated-rows 未命中交错行（非连续相邻同名）；保留通用规则，过程基数与排序由本次单测和真机断言强制。

## 视觉基线全名

定向执行四个过程用例，4 passed；其中 `b2c-process-running.png` 像素未变化。实际更新仅以下三张：

- `tests/ux/design-lab/__baselines__/agent-panel-v4/b2c-process-done.png`
- `tests/ux/design-lab/__baselines__/agent-panel-v4/b2c-process-failed.png`
- `tests/ux/design-lab/__baselines__/agent-panel-v4/v4-process-folded.png`

`agent-panel-v4` 整屏在主线现有 calibration 中待拍板，普通视觉运行跳过（首次定向普通运行 No tests found）；本次用户明确授权过程基线更新，使用 `NOMI_DESIGN_LAB_UPDATE=1` 加精确 grep 仅录上述过程用例，不解除其他格的待拍板登记。

## 最终验证

在 `c6fe8c608c3f`（含 #692）整合树上，`python3 scripts/with-gates-lock.py -- pnpm run gates` 完整退出 0 并盖戳：必过 contracts 通过，视觉 154 passed，Vitest 1302 passed / 1 skipped files、11919 passed / 2 skipped tests，Agent runtime 425/425，build 通过。历史 docs-index/doc-status 为仓库既定 advisory，未改基线。

走查回复对象补齐 `type: 'tool'` 与名称同层，使现役静态门岗识别为 lane 工具而非 MCP；未改变回复内容或检查规则。最终 loopback 复验通过。
