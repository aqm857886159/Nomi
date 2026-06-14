# AI 助手输出一致性优化（实现计划）

> 已拍板（2026-06-15）：样张 `docs/design/reviews/2026-06-15-ai-assistant-output.html`。
> 用户反馈根因：两个助手「发言」两套设计（创作=气泡 / 画布=小点时间轴 + 纯文本露馅 markdown），不一致、不舒服。
> 目标：两个助手的「助手发言」长得**完全一致**（同一共享组件，守 P1 删两份重复渲染）。

## 设计（locked）

- **助手发言（两面板同款）**：左对齐、**无气泡填充**；一行身份 = Nomi 字形（18px accent 方块「N」）+「Nomi」名（`text-[11px]`/micro，`text-nomi-ink-60`）；正文走 **NomiMarkdown** 真渲染、`text-body`(14)；流式 = 统一三点动画；**极简状态标**（仅非终态显示：进行中 = `⏳ 进行中`/loading mark；已停止 = `已停止`）；done 不加噪。reply action + turnStats caption 保留。
- **用户消息（两面板同款）**：右对齐 `bg-nomi-ink-05` 气泡，`rounded-nomi` + `rounded-br-[4px]`，`text-bodySm`(13)。
- **画布去掉小点时间轴轨**（`TimelineStep` 的状态点 + 连接线）：提议卡 / 已应用对账卡 / 有出入卡**保留**，但不再裹在导轨里，按上下顺序接在该轮发言下；卡自带的「等你确认 / ✓已应用 / ⚠有出入」badge 即「执行进度」可见性来源（不再靠导轨点）。
- **保留**画布的「吐字顺序」编排：用户问 → 动作卡（liveSteps）→ AI 总结发言（trailing assistant 排在 liveSteps 之后）。

## 范围（文件）

1. **新建 `src/workbench/ai/AssistantMessageView.tsx`**（共享，纯展示）：导出 `AssistantMessageView`（身份行 + markdown 正文 + 状态标 + reply + turnStats）和 `UserMessageBubble`（右气泡）。两面板各自把自己的 state 映射成它的 props（创作走 `message.status`；画布把 `content === '处理中...'` 映射成 `streaming`）。
2. **`CreationAiPanel.tsx`**：消息 map（478-528）改用共享组件；保留 pending/streaming/cancelled/error 语义（映射成 props）；写确认卡（531-568）不动。
3. **`AssistantTimeline.tsx`**：删 `TimelineStep`/`StepHeader` 导轨；assistant/user 改用共享组件；liveSteps（plan/committed/deviation/remaining）改为普通竖排块（卡 `flat` 保留，外层去导轨、用卡自身边或轻分隔）；保留 headMessages/trailingAssistant 排序逻辑；空状态不动。
4. **`workbench-ai.css`**：删创作助手气泡相关段（`.workbench-creation-ai__message`/`--assistant` 的气泡填充/13.5px）；用户气泡若仍用 CSS 则保留并对齐到共享组件。token-only（杀 13.5px → bodySm/body）。
5. **NomiMarkdown**：经共享组件天然接入画布（画布此前无 markdown）。compact 模式沿用。

## 不动

- composer 输入区、附件 rail、提议/对账卡**内部**样式、空会话建议、stale 分隔线、MemoryFold、AssistantToolsFold、模型预检/流式逻辑、turn 控制器。
- 不引入第三方（自研，NomiMarkdown 已是 react-markdown）。

## 数据映射（两面板 state → 共享 props）

| 共享 prop | 创作来源 | 画布来源 |
|---|---|---|
| `streaming` | `status==='streaming'`/`'pending'` | `content==='处理中...'` |
| `pendingLabel` | pending 时的 `content` | —（画布无）|
| `cancelled` | `status==='cancelled'` | —（画布无第三态，传 false）|
| `isError` | `content.startsWith('（错误）')` | 同 |
| `statusMark` | 由上述派生（进行中/已停止）| 同 |

## 回滚

共享组件是新增；两面板迁移点清晰，回退即恢复各自内联 JSX + 旧 CSS。提议卡/对账卡不动，回退不影响动作链路。

## 验收门

1. 五门全过（filesize/lint≤98/typecheck/test/build）。
2. **与样张逐项对账**：身份行、左对齐无填充、markdown 渲染、用户右气泡、状态标、去导轨——逐条并排核对。
3. `tests/ux/design-fidelity.e2e.mjs` 加断言：两面板助手消息 DOM 结构一致（同 `data-` 标记 / 同 markdown 容器 / 无 timeline 导轨点）。
4. **R13 真机走查**（环境净了做）：两助手发言并排看是否一致；画布 markdown 不再露馅；提议卡仍能确认/对账；流式动画一致；边缘无遮挡。
5. P1 核对：删干净两份旧渲染，无并行版残留。
