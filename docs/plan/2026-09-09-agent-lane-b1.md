# B1 lane 契约批修

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：B1 已按六簇提交；B1-finish 授权在原 feat/agent-lane-stage4-switch-20260908 分支合并 main，再过完整门岗并推送既有 PR #646。

| 簇 | 根因 | 所有层 / 验证 |
|---|---|---|
| C19 | 增量菜单被说成全集 | native assembly 三段结果；loopback 切组后调用常驻 |
| C26 | 示例不展示完整 candidate，校验失败无合法形状 | descriptor 示例 + pi 失败结果出口；真人首次参数重放 |
| C27 | 审批决定未投影给模型 | capabilityApprovalPolicy 派生 prompt + 实际 auto-granted 回执 |
| C28 | 菜单未限定宿主实现能力 | generation schema 工厂按 preview 能力裁剪；外部 schema 保留 |
| C29 | 默认全文与单行截断相乘归零 | lane context 摘要/显式 scope + 公共保头出口；246KB |
| C42 | 宿主 prompt 入口不处理运行态，steer 不唤醒审批 | laneHost 默认 steer，等待期拒绝当前卡后立即继续；因果夹具 |
| C43 | 收据正文混入机器标识 | canvas receipt 正文摘要/details 原样；不改数据层 |
| C45 | 文稿金额被提升成授权 | desktop provider context 不注入全局预算；保留原稿、费用仅引用报价 |
| C47 | 回答提示无任务长度约束 | 系统提示只读/收尾≤3行，不复述清单；真实样本观察 |

## 先查别人

- 依赖已有：`node_modules/@earendil-works/pi-agent-core/dist/harness/runtime/drive/boundary.js:29` 原生 steer/followUp；沿用队列。
- 仓库已有：`electron/shared/agentCapabilities/capabilityApprovalPolicy.ts:171` 审批纯函数；不手写第二套判据。
- 官方近邻：Claude Code 在工具边界接收运行消息，见 https://code.claude.com/docs/en/interactive-mode#queue-messages-while-claude-works 。完整五产品九条表见 [上下文契约方案](2026-09-09-agent-lane-context-contracts.md)。

本次修正既有 pi 装配，不加框架。已读安装源码 pi-agent-core/dist/harness/execution/tools.js:19-36（prepareArguments→AJV），runtime/drive/tools.js:284（after_tool），hooks.js:207（结果覆盖）。沿用已有 steer/followUp 与 gate.answer，不自造队列。参考 upstream https://github.com/earendil-works/pi；JSON Schema https://json-schema.org/draft/2020-12/json-schema-validation（enum/additionalProperties）。使用标准 enum 裁剪、标准 tool content/details，领域摘要为文本内容，无新外部文件格式。C26 首次实参来源保留在 evidence/c26-first-call.json；完整转录与 ledger 只读。

同类扫描：laneTools 的所有领域输出、native request 输出、extended generation/context/status 输出、canvas receipt；composerIntent 与 laneHost 两种消息入口；desktop input 的 singleShot/workspace 两种宿主路径。现有 create 已接受 prompt，但仍拒绝顶层 candidateId/revision；不收紧既有合法调用。

范围：仅上述契约与宿主输入投影及夹具。不改 storyboard schema、分镜/画布数据层、UI 布局和视觉、打包流程（C42 加 Alt+Enter 次级手势）。回滚：revert 本批提交，不迁移历史会话。验收：每簇红绿日志，C0 3/3，真实 DeepSeek 三回合≤¥1，完整 with-gates-lock gates exit 0，正常 hook commit/push；SWITCH-LAST 与 scratchpad 报收据。

2026-09-09 新任务书修订依据：以 `2026-09-09-agent-lane-context-contracts.md` 五产品九条表为准；C45 删除预算注入，C42 普通运行消息默认 steer。
