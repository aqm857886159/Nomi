# 设计卡：模型可见工具必读清单与派工拦截

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：模型可见工具必读清单与派工拦截　线/负责人：I-tool-checklist　类别：工程纪律 / 文档 / 派工门岗

## ★0 先查别人

- [MCP 分页规范](https://modelcontextprotocol.io/specification/latest/server/utilities/pagination) · 使用不透明 cursor、`nextCursor` 和明确的无效 cursor 错误；实现约束要落在共享工具合同与错误下一步，而不是在每个调用者猜页码 · **确认了**清单要把协议边界、状态与可行动失败写成一页结论。
- [Anthropic: Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents) · 用少量面向高价值工作流的工具，返回高信号上下文，必要时分页/过滤/截断，错误直接给可执行的参数改法，并用真实任务的多轮评测看工具写对率、错误与回合成功 · **改了**验收要求：任务书必须带真实用户句子和 R13.3 的工具写对率 / 回合成功率，不把 schema 绿灯当成模型可用。
- [pi 参考实现逐层对照](../research/2026-10-01-pi-coding-agent-reference-conformance/report.md#参考实现逐层对照) · pi 把工具定义、参数 schema、执行与结果拆成清楚的层，顺序保持稳定以服务 prompt/KV cache；Nomi 的差异要逐字段写理由，不能靠第二张清单补洞 · **确认了**注册表只保留 `VERB_DECLARATIONS`，新动词追加到末尾，内部 / MCP 差异只由声明的 profile 投影表达。
- [Nomi 现有注册表头注释](../..//electron/shared/agentCapabilities/modelFacingToolRegistry.ts) · `VERB_DECLARATIONS` 是唯一真相，`profiles` + `profileReason` 是入口差异的唯一来源，顺序是 prompt/KV-cache 合同 · **确认了**派工检查应在任务书阶段提醒这张清单，而不是再造 PR 侧存在性门岗。

## ★1 用户怎么用

当协调会话要新增、改名、改参数、改说明或改错误文案的模型可见动词时，先读本清单，把外部原文和参考实现结论写入设计卡，再单独提交设计卡，之后才改代码；主指标是任务书漏带清单的比例降为 0，量具是 `node scripts/check-dispatch-brief.mjs <任务书>`；质量指标是工具写对率与回合成功率，量具是 R13.3 评测集 / 真实任务句子；护栏是不扩大 PR 侧门岗、不改产品代码、不碰真实用户资料。已知坑：任务书只写“工具栏/工具条”不应触发；清单只给结论和链接，不复制教训正文。

## ★1b 连带界面

派工检查的提示必须明确下一步：引用 `docs/engineering/model-facing-tool-checklist.md`；报告保留两份真任务书的红/绿输出。无产品界面改动。

## ★2 谁说了算

任务书文本的“是否模型可见工具改动”由 `scripts/check-dispatch-brief.mjs` 负责判定；模型可见工具定义 owner 是 `VERB_DECLARATIONS`，内部 Agent 与 MCP 的投影 owner 是 `modelFacingToolRegistry.ts`。没有第二份工具注册表；没有状态猜测或用户意图旁路。

## ★3 一致与复用

复用现有四项派工检查、规则表生成器和三道既有门岗（`check:model-schema`、`check:mcp-tool-refs`、`check:walkthrough-tool-args`），只新增清单引用条件和 node:test 覆盖；不引入依赖、不复制教训正文。

## ★4 全状态

通过：提示范围、不碰、停点、补换和模型工具清单均齐全；失败：列出缺少清单引用并告诉协调会话补引用；能力不可用：不适用，本次只改文档与派工检查。中英文产品文案不涉及。

## ★9 验收与回滚

实现线自验：四个新增判定用例（工具类无引用红、引用过、非工具类过、工具栏误伤过），两份真实任务书输出按任务书记录；运行 `node --test scripts/check-dispatch-brief.node-test.mjs`、`node scripts/gen-rules-view.mjs`、`node scripts/check-rule-aliases.mjs`、`node scripts/check-test-copy-literals.mjs` 及改动文件 lint。回滚：revert 本分支提交；无数据迁移、无产品运行时影响。反例覆盖：中文/英文工具类说法、`VERB_DECLARATIONS`/`verbDeclarations`/`modelFacingTool`/tool schema、只写工具栏/工具条、工具类缺清单链接。

### 功能分类

- [x] 工程纪律 / 文档
- [ ] 新界面 / 改交互
- [ ] 新增功能 / 性能
