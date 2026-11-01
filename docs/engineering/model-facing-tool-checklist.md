# 模型可见工具必读

适用于新增、改名、改参数、改说明、改错误文案的模型可见动词（`electron/shared/agentCapabilities/` 的 `VERB_DECLARATIONS`）。先读本文和链接，再写设计卡；结论单独提交后才动实现。这里只放结论，不复制教训正文。

## 我们踩过的坑

- [技能、提示词里的旧祈使句会活过工具改名](../lessons/stale-directives-outlive-tool-renames.md)：改名要连技能和提示词一起搜、一起改。
- [拒绝文案也要给 Agent 下一步](../lessons/refusal-text-must-also-tell-the-agent-a-path.md)：错误必须告诉模型下一步能调什么，不能只解释为什么拒绝。
- [能力不归组件生命周期](../lessons/capability-bound-to-component-lifecycle-reports-stale.md)：数据主人是会话层；“没有”和“过期”要分开报。
- [走查参数没有编译器保护](../lessons/walkthrough-tool-args-are-a-compiler-blind-spot.md)：手写参数要过 `check:walkthrough-tool-args`，不能只靠 TypeScript。
- [Agent 测试要由用户话驱动](../lessons/agent-tests-must-be-prompt-driven-and-human-path.md)：至少准备 20 句用户真会说的话，并走真实人类路径。
- [参考实现要逐层对照](../lessons/reference-implementation-not-dissected-is-not-research.md)：逐字段写一致、有意不同及理由、没想到，不能只贴一个链接。

## 通用标准

模型可见工具 schema 只按通用标准写（JSON Schema 2020-12 + OpenAI function calling 官方支持范围），不给单个供应商另开规则（用户 10-29）。Zod 是唯一真相源，标准外约束在共享推导层转为标准写法与 description，运行时仍按原契约校验。

## 注册表约束

- 唯一注册表是 [`VERB_DECLARATIONS`](../../electron/shared/agentCapabilities/verbDeclarations.ts)；内部 Agent 与 MCP 的差异只能来自 `profiles` + `profileReason`（[`ARCHITECTURE-NOW.md`](../ARCHITECTURE-NOW.md) 的“内部 Agent vs MCP”、[`modelFacingToolRegistry.ts`](../../electron/shared/agentCapabilities/modelFacingToolRegistry.ts) 头注释）。
- `VERB_DECLARATIONS` 的顺序是 prompt / KV-cache 合同；新动词追加到末尾，不能按实现细节重新排序。
- 改完跑三道门岗：`check:model-schema`、`check:mcp-tool-refs`、`check:walkthrough-tool-args`。

## 外部调研（设计卡必须引用原文）

- [MCP 分页规范](https://modelcontextprotocol.io/specification/latest/server/utilities/pagination)：使用不透明 cursor / `nextCursor`，缺失 `nextCursor` 才表示结束；无效 cursor 要给可识别错误。
- [Anthropic：Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents)：工具应面向高价值工作流、返回高信号上下文，并用真实、多轮评测检查工具选择、参数错误、工具错误和回合成功。
- [pi 参考实现逐层对照](../research/2026-10-01-pi-coding-agent-reference-conformance/report.md)：工具定义、schema、执行与结果分层；顺序稳定以保护 prompt/KV cache；Nomi 的差异必须逐字段写领域理由。

顺序固定为：先调研，把结论写进设计卡并单独提交；再动代码。设计卡按 R5、P5 ★0、R5.5 写偏差表。验收使用 R13.3 的真实模型数字：工具写对率 + 回合成功率。
