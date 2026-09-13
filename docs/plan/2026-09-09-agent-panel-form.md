# Agent 面板形态 · B2c 方案索引

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：已实施，PR #683 待评审；本次补齐可复核的方案引用。

## 范围与原因
用户阅读回答时，过程明细应收敛，四个工作面的面板宽度与外框应一致。实施依据为 #678 批准的 `docs/design/2026-09-09-agent-process-state-and-panel-frame.md`；具体 owner、回滚和验收见 [B2c 实施计划](2026-09-09-b2c-panel-form.md)。本文件整理已有调研，不宣称新增调研或改变已批准语义。

## 先查别人
- [Beautiful UI Thinking State](https://www.beautifului.dev/#thinking-state)：单个可展开入口承载过程步骤，采用交互思路，内容继续由现役 V4FlowRow 渲染。
- [Beautiful UI Loading State](https://www.beautifului.dev/#loading-state)：当前动词与时间感同排；采用 shimmer 形态，生产状态与耗时从宿主投影派生。
- [Beautiful UI Task Rows](https://www.beautifului.dev/#task-rows)：运行、完成、失败有清楚反馈；终态收敛，失败复用 V4ErrorBar。
- [Beautiful UI Tool Chips](https://www.beautifului.dev/#tool-chips)：紧凑工具展示；没有另做 chip，沿用 V4ToolReceipt。
- [Claude Code](https://code.claude.com/docs/en/interactive-mode)：作为交互式 Agent 的比较入口。已有样张文档没有逐项实查记录，因此不把它作为本轮新增实现或行为等价的依据。

### R29 四列表（整理自已批准样张来源表）
| 它提供 | 我们用了 | 我们另写了 | 我们拆散了 |
|---|---|---|---|
| Beautiful UI Thinking State（上方链接） | 可展开过程入口的思路 | 现役 Process 两态组合与 V4FlowRow | 无；未复制上游源码 |
| Beautiful UI Loading State（上方链接） | 动词、秒数与 shimmer 形态 | 宿主状态投影，减少动态效果适配 | 无 |
| Beautiful UI Task Rows（上方链接） | 活状态与终态收敛思路 | 现役 V4ErrorBar 组合 | 无 |
| Beautiful UI Tool Chips（上方链接） | 不新增 chip | 复用 V4ToolReceipt | 无 |

只参考视觉形态，没有引入框架、SDK、新协议或其新层，没有新增 framework-surface 字段。面板宽度沿用 editingPanelLayout 单一 owner，品牌复用 NomiBrand。

## 不动项 / 回滚 / 验收
不改 B2a 行为和冻结区；本次仅补文档引用，不变更生产代码。回滚本文件及 PR 引用即可。`node scripts/check-prior-art.mjs --pr` 核对方案及 PR；完整 gates exit 0 后推送，正常提交/推送 hooks。B2c 真机与批准样张对账见 `docs/plan/b2c-form-evidence/`。
