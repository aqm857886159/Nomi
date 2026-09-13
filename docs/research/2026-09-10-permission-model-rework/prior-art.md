# 2026-09-10 权限模型重做 · 先查别人报告

> 方案：`docs/plan/2026-09-10-permission-model-rework.md`。
> 本报告按模板四问复核「别人做过没有」，结论抄进方案「## 先查别人」节。
> 本任务只补 CI 缺的调研节，不改方案其它内容（后续另行修订）。

## ① 依赖里已有？

- 本仓 embed 的 Agent 运行时是 `@earendil-works/pi-agent-core@0.85.1`（`package.json`）。实查 `node_modules/@earendil-works/pi-agent-core/dist/` 全部 7 个 `.d.ts` 声明文件（`index.d.ts`/`agent.d.ts`/`agent-loop.d.ts`/`node.d.ts`/`stream-fn.d.ts`/`proxy.d.ts`/`types.d.ts`），`grep -lni permission` **零命中**。
- 具体看 loop 入口：`node_modules/@earendil-works/pi-agent-core/dist/agent-loop.d.ts:12-21`（`agentLoop`/`runAgentLoop` 签名只接 `AgentContext`/`AgentLoopConfig`/`streamFn`/`signal`，没有权限回调参数）；`node_modules/@earendil-works/pi-agent-core/dist/types.d.ts:122`（`AgentLoopConfig` 接口起始行，字段是 `model`/`convertToLlm`/上下文裁剪钩子，没有 permission/approval 字段）。
- 结论：**pi-agent-core 库本身不提供 permission 扩展点**。方案 §一 提到的「pi-permission-system」（用户给）是 pi 生态里更上层的**宿主/CLI 扩展**（对标 Claude Code/Cursor 那类产品层，不是 agent-loop 库本身自带的能力），装不进我们 embed 的这个包版本。这不是我们漏接了依赖自带的东西——判据层必须在自己的宿主边界（`laneHost`/`capabilityApprovalPolicy.ts`）自建，方案 §4.1-4.3 的方向是对的。

## ② 仓库里已有？

- **单发付费收据链**（诚实门已是 HMAC+TTL+一次性）：`electron/capabilityCore/approvalReceipt.ts:8-9`（`HUMAN_APPROVAL_ALGORITHM = "HMAC-SHA256"`）、`:239-241`（`expiresAt()` TTL 校验，非法 TTL 直接 throw）、`:543`（`record.consumedAt` 一次性消费判据，重放返回 `replayed:true` 而非重新放行）。
- **判据 owner 已单点化**：`electron/shared/agentCapabilities/capabilityApprovalPolicy.ts:105-108`（`capabilityIsHardGated`——花钱 `spend`/不可逆 `irreversible`/未知效果类三源统一到「任何档位都要当次点头」）与 `:144-154`（`capabilityMayReuseSafeApproval`——档位 × effectClass 的复用判据，本方案 §4.1 要升级的正是这张表，不是另起一张）。
- **确认 UI 已单一收口**：`src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx:12-18`（组件顶部注释明写「三种来源共用这一个对话框（不另造并行卡，P1）」，覆盖用户直发 / agent 受理 / MCP 外部助手）+ `src/workbench/generationCanvas/spend/MultiShotContractSummary.tsx:8-14`（批量确认卡的可滚动内容区，固定 footer 由 SpendConfirmDialog 渲染，「动作固定、内容滚动」）。
- 结论：不缺组件、不缺判据 owner，缺的是判据矩阵升级（花钱轴从「零消费者」变真输入，方案 §4.1）和介入槽单轨化（方案 §4.3）。这两处改动都发生在既有 owner 文件内部加字段/加分支，不是新开一条并行链——符合 P1。

## ③ 生态里已有？

- **Claude Code**：官方安全文档，权限模式（Manual 默认逐动作问 / Auto 走分类器 / bypass 仅隔离环境）与 deny→ask→allow 规则表：https://docs.claude.com/en/docs/claude-code/security （2026-09-10 查）；落盘位置与规则语法：https://docs.claude.com/en/docs/claude-code/settings （2026-09-10 查）。
- **Codex CLI**：官方文档确认 `sandbox_mode`（read-only/workspace-write/danger-full-access）与 `approval_policy`（on-request/untrusted/never/granular）是**两个独立配置轴**：https://developers.openai.com/codex/agent-approvals-security （2026-09-10 查）；沙箱技术细节：https://developers.openai.com/codex/concepts/sandboxing （2026-09-10 查）。
- **Cursor CLI**：Auto-review Run Mode 官方文档，三级流水线「allowlist 命中即放行 → 可沙箱的进沙箱 → 其余交分类器裁决/问用户」：https://cursor.com/docs/agent/security/run-modes （2026-09-10 查）。
- **Cline**：Auto Approve 官方文档，按动作类别（读文件/改文件/跑命令/用浏览器/MCP）逐项授权，YOLO Mode 才是全放行：https://docs.cline.bot/features/auto-approve （2026-09-10 查）。
- 结论：四家现役产品的权限模型有共同结构——①规则由宿主执行不靠模型自觉；②危险/花钱类有独立于档位的硬地板；③自主/全放行是显式 opt-in，不是某个默认档位的隐含行为。方案 §4.1 的「动作×档位矩阵」与 Claude Code 规则表/Cursor 三级流水线同构，§4.2 自主开关对齐 Cline YOLO/Claude Code bypass 的「独立 opt-in」共识，危险类硬地板对齐 Codex 双轴里 approval_policy 也越不过 sandbox 边界的不变量。生态里没有第四种可抄的模型，方案现有设计已经是收敛后的交集，不是自己拍脑袋想的。

## ④ TikHub 自媒体里怎么说？

**未检索。** 同日期研究目录 `docs/research/2026-09-10-ux-feedback-fixes/tikhub/tikhub-search.md` 是唯一现成的 TikHub 检索产物，但它的关键词是「openai compatible api key 验证 401 models」——服务的是 B2 apimart direct-key 接入调研，与本方案的 agent 权限/审批模型主题不相关。抽查其抖音/小红书/B站/X 共 80 条结果，无一条涉及 agent 权限档位、审批流或「自主运行」相关讨论。本方案没有另跑权限主题的 TikHub 检索，如实标注未检索，不把不相关的检索结果包装成「查过了」。

## 结论

- 方案 §4.1（判据矩阵升级）、§4.3（确认卡单轨化+可调整）都是在仓库已有的单点 owner（`capabilityApprovalPolicy.ts`/`approvalReceipt.ts`/`SpendConfirmDialog.tsx`）上加字段、加分支，没有新开并行实现，符合 P1。
- 方案 §4.2（自主运行开关）是仓库新概念，但结构对齐 Cline YOLO 与 Claude Code bypass 两家生态先例（独立 opt-in、默认关、危险类硬地板不受影响），不是自造新模型。
- pi-agent-core 库本身不提供权限扩展点（`node_modules/@earendil-works/pi-agent-core/dist/*.d.ts` 全量 grep 零命中 `permission`），判据层必须在我们自己的宿主边界自建——这解释了为什么方案没有「直接接 pi-permission-system」这个选项。
- TikHub 侧本方案主题如实标注未检索，不借用不相关的旧检索结果凑数。
