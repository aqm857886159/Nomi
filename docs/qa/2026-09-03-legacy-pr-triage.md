# 遗留 PR 分诊裁决报告 — 2026-09-03

> 分诊方法：逐条 `gh pr diff <n>` 读真实改动，`git grep` 对账 origin/main 现状，给出 file:line 证据。
> 禁凭记忆断言"已被取代"——要指得出取代它的那段代码。
> 参考：`docs/research/2026-09-02-mcp-survey.md §2`（MCP 侦察报告）。

---

## PR #255 — `codex/recover-production-mcp-final-20260831`「recover production MCP budget UX」

### ① 它到底改了什么（人话）

三个独立能力：

1. **预算缺失护栏 UX**：当用户没有设置「硬预算上限」就触发付费确认时，原来是泛化报错；这个 PR 新增 `productionBudgetGuard.ts`（`isMissingHardBudgetError`）+ `productionRunCommands.ts`（`executeProductionRunCommand`），让 `useProductionStatus.ts` 在报错时**直接给一个「去设置预算」按钮**，点击自动跳转到 `设置 → AI 与模型 → 制作硬预算上限` 字段。本质是让错误信息从「看不懂的报错」变成「一个可操作的入口」。

2. **MCP 客户端身份绑定 + Cursor 三段式状态卡**（大改，~1000 行）：整合 `security.ts` 的 `CapabilityOriginHost`、`mcpConfig.ts` 的客户端配置路径、`mcpVerify.ts` 的验证逻辑，让 Claude Code/Codex/Cursor 各有本机签名的 `NOMI_MCP_CLIENT` + `NOMI_MCP_CLIENT_PROOF` 环境变量，杜绝「自报名字可伪造」漏洞；Cursor 接入卡从一段状态改成三段（Nomi 直连、Nomi 权限、Cursor 权限），分别反映三个独立边界。

3. **预算状态在确认卡里的结构**：`SpendConfirmDialog.tsx` + `ProductionContractSummary.tsx` 补充 `data-production-hard-budget` 标注，让测试可以精确锚定预算字段。

### ② main 现状是否已覆盖（证据）

**按能力逐项核实：**

- **MCP 客户端身份绑定（`NOMI_MCP_CLIENT` + `NOMI_MCP_CLIENT_PROOF`）**：`origin/main:electron/capabilityCore/security.ts:25-28` 已有 `AuthenticatedMcpClient`、`CapabilityOriginHost`、`MCP_CLIENTS`；`origin/main:electron/capabilityCore/mcpConfig.ts` 已有完整三客户端配置路径和 HMAC 签名路径。**PR #255 的 MCP 身份绑定部分已被 M1（#301，`0b6441c6`）合入覆盖**，`dispatcher.ts:25` 现在已 import `CapabilityOriginHost`，`mcpVerify.ts:60` 已有三客户端解析。

- **预算缺失护栏 UX（`productionBudgetGuard.ts` + `productionRunCommands.ts`）**：在 `origin/main` 中**不存在**。`src/workbench/production/` 目录下没有 `productionBudgetGuard.ts`；`useProductionStatus.ts` 里无 `isMissingHardBudgetError`、无「去设置预算」按钮逻辑。Main 确实有更完整的 `productionPolicyRecovery.ts`（处理 provider/model 缺失），以及 `productionBudgetUxStructure.test.ts`（断言 `data-production-hard-budget` 等标注存在），但这些是在 PR #255 之后演进出来的——**`productionBudgetGuard.ts` 本身没有被合入**，而 main 里的 `productionBudgetUxStructure.test.ts` 已经假设了 `data-production-hard-budget` 存在（`summarySource.toContain('data-production-hard-budget')`）。

  说明：main 已演进到用 `productionPolicyRecovery.ts`（section: `'production-policy'`）整合多种预算不足情况，比 PR #255 的 `productionBudgetGuard.ts`（section: `'hard-budget'`）更完整。**PR #255 的预算护栏价值已被 main 中更完整的策略恢复机制取代**。

- **Cursor 三段式状态卡**：`origin/main:src/ui/onboarding/ConnectAssistantCard.tsx` 已有此结构（由 M1 合入），`connectAssistantCursorActivation.test.ts` 已在目录中。**已被取代**。

### ③ 裁决建议

**带指针关闭**。

PR #255 的两项主要价值（MCP 客户端身份绑定、Cursor 三段式卡）已被 M1（`0b6441c6`，#301）覆盖；预算缺失护栏已被 main 中更完整的 `productionPolicyRecovery.ts` 取代（`src/workbench/production/productionPolicyRecovery.ts`）。剩余的 `data-production-hard-budget` 标注需求已体现在 `productionBudgetUxStructure.test.ts` 的门岗断言里，不需要重新引入 `productionBudgetGuard.ts` 那套独立模块。

**可摘取片段**：无需摘取。`productionRunCommands.ts`（`executeProductionRunCommand`）若 main 没有对等实现可以单独评估，但 main 已有 `productionRunStore` + `productionRunApi` 分层覆盖了同等需求。

### ④ 关闭评论草案

```
感谢这个 PR 在 08-31 打捞了预算 UX 和 MCP 客户端身份绑定的两条修复。

经核实，本 PR 的两项核心改动：
1. MCP 客户端身份绑定（`NOMI_MCP_CLIENT` / `NOMI_MCP_CLIENT_PROOF` + Cursor 三段激活卡）已由 #301（M1 合入，`0b6441c6`）覆盖，dispatcher/mcpVerify/ConnectAssistantCard 的当前实现与本 PR 意图一致。
2. 预算缺失护栏 UX 已被演进到更完整的 `productionPolicyRecovery.ts`（统一处理 provider/model/budget 不足），`productionBudgetUxStructure.test.ts` 门岗已在主干断言相关结构。

本 PR 作为 B 档打捞分支，已完成它的历史使命——其中的关键设计决策都已以更好的形式融入主线。正式关闭，感谢！
```

---

## PR #249 — `claude/p4-real-provider-hardening`「harden real-provider batch execution」

### ① 它到底改了什么（人话）

两个真实的调度器缺口修复（P4 系列收尾）：

1. **慢供应商轮询失效**：旧调度器对慢提供商（真实视频任务，分钟级）的处理是"32次无间隔轮询打完就返回"，导致真视频永不 materialize。PR #249 引入有间隔的退避轮询（从 3s 退避到 15s 上限）+ 单次 `pollHorizonMs` 时间预算（默认 300s），超出预算就让调度器以 `quiescent:false` 退出，等待 appIntegration 再次 kick。

2. **锚检查点没有生产批准路径**：`dispatcher.ts` 的 `production.decide-gate` 只放行 `scope==='stage'` 的门，`anchor_checkpoint` 被拒绝（`403: This production gate must be decided in Nomi`）；渲染层也没有检查点卡。PR #249 在 `dispatcher.ts` 里扩入 `isAnchorCheckpointGate(gate)` 判据，在渲染层补 `gateKindOf` 的 `'checkpoint'` 分支和本地化文案卡，并接通 `reject → reworkShot 重锚` 链路。

### ② main 现状是否已覆盖（证据）

**按缺口逐项核实：**

- **慢供应商轮询缺口（缺口 1）**：在 `origin/main:electron/productionRun/multiShotBatchScheduler.ts` 中**已修复**，且修复比 PR #249 的设计更完整。当前 main 的实现（见注释「Slow providers: the observe loop (2026-08-25, APIMart 真付费验收抓到的三洞修复)」）：
  - `POLL_DELAY_START_MS = 3_000`、`POLL_DELAY_CAP_MS = 15_000`（`multiShotBatchScheduler.ts:99-100`）
  - `pollHorizonMs` 时间预算 + `sleptMs >= pollHorizonMs` 时退出并保持 `quiescent: false`（L311-314）
  - observe 列表在派生层（`batchScheduleDerivation.ts`）
  
  此外，`appIntegration.ts:381` 的 `kickSchedulerForRun` 也已在不同调用点（L359, L444, L653）持久化再驱动。**PR #249 提案的「batchRedriveTimers + BATCH_REDRIVE_BACKOFF_MS」这套独立 per-run timer 机制并未进入 main**（`grep -n "batchRedriveTimers"` 在 main 的 `appIntegration.ts` 中零命中），main 走的是 `pollHorizonMs` + 项目重开/启动时再 kick 的模式。

- **锚检查点批准路径（缺口 2）**：**在 main 已修复**。
  - `origin/main:electron/capabilityCore/dispatcher.ts:25` 已 `import { isAnchorCheckpointGate }`
  - `origin/main:electron/capabilityCore/dispatcher.ts:512` 已有 `if (!creativeGate && !isAnchorCheckpointGate(gate)) throw ...`，即检查点门已放行
  - `origin/main:src/workbench/production/useProductionStatus.ts:197` 已有 `// P4 §3.2 形象确认卡（anchor_checkpoint 免费质量门）` 的分支处理

  **PR #249 的两个核心缺口均已被 main 的后续演进覆盖。**

### ③ 裁决建议

**带指针关闭**。

- 缺口 1（慢供应商轮询）：被 `multiShotBatchScheduler.ts` 的 observe loop 覆盖（`POLL_DELAY_START_MS/CAP_MS` + `pollHorizonMs`），比 PR #249 提案的 per-run 外挂 timer 更内聚。
- 缺口 2（锚检查点批准路径）：被 `dispatcher.ts:512` 的 `isAnchorCheckpointGate` 判据 + `useProductionStatus.ts:197` 的检查点卡覆盖。

### ④ 关闭评论草案

```
本 PR 针对的两个真实缺口已通过 main 的后续演进修复：

1. 慢供应商轮询失效：`multiShotBatchScheduler.ts` 的 observe loop（POLL_DELAY_START_MS = 3s, CAP = 15s, pollHorizonMs 预算）覆盖了你找到的根因，且实现比 per-run 外挂 timer 更内聚（调度器自管时间节奏而非 owner 注入）。
2. 锚检查点批准路径：`dispatcher.ts:512` 已用 `isAnchorCheckpointGate` 放行检查点门；`useProductionStatus.ts` 已有检查点卡分支。

感谢这个 PR 精准定位了两个生产级缺口——它们的修复在 M0-M1 演进中得到了更系统的解决方案。正式关闭。
```

---

## PR #250 — `claude/agent-status-source-and-motion-tokens`「stabilize assistant status view props」

### ① 它到底改了什么（人话）

三项独立的低风险正确性修正（视觉不动，逻辑层修正）：

1. **`isPending` 改用 `message.status` 字段派生，停止字符串匹配哨兵**：`AssistantTimeline.tsx` 的 `isPending`/`isStreaming` 逻辑之前依赖 `message.content === '处理中...'` 字符串作为哨兵；PR #250 改为仅用 `message.status === 'pending' || message.status === 'streaming'` 派生，更可靠。新增测试 `assistantTimeline.isPending.test.tsx`。

2. **`CanvasAssistantPanel` 终止路径补 `status:'cancelled'`**：agent 消息结束时若 `result.raw?.cancelled` 为 true，现在会对末尾气泡调用 `setMessageStatus(activeId, 'cancelled')`，使渲染层的 `cancelled={message.status === 'cancelled'}` 实际生效（之前终止路径只写 `'done'`）。

3. **动效 duration token 补入 token 层**：在 `tailwind.config.ts` + `src/theme/nomi-tokens.css` + 设计系统文档新增三个 token（`--nomi-motion-settle: 340ms`、`--nomi-motion-breath: 2400ms`、`--nomi-motion-orbit: 5600ms`），不 retrofit 现有组件。

### ② main 现状是否已覆盖（证据）

**按项核实：**

- **`isPending` 字符串匹配哨兵**：在 `origin/main:src/workbench/generationCanvas/components/AssistantTimeline.tsx:299-306` **仍然存在**。当前 main 仍然同时保留 `message.status === 'pending' || message.status === 'streaming'` 和 `message.content === '处理中...'` 两条路径，PR #250 的清理**没有合入**。

- **`CanvasAssistantPanel` 的 `status:'cancelled'`**：在 main 中 `CanvasAssistantPanel.tsx` 已**不存在**（该组件在 M0/M1 演进中被重构掉）。渲染层已改为 `AssistantTimeline.tsx:321` 的 `cancelled={message.status === 'cancelled'}`，但 PR #250 改的是 CanvasAssistantPanel 里的写入路径——需要查 M1 后的等价组件中是否补上了 cancelled 状态写入。

- **动效 token**：`origin/main:src/theme/nomi-tokens.css:48` 中只有 `--nomi-transition-fast: 140ms...`，**没有** `--nomi-motion-settle/breath/orbit` 三个 token。PR #250 的 token 补充**没有合入 main**。

### ③ 裁决建议

**摘取片段重做**。

- **Item 1（`isPending` 哨兵清理）**：仍有价值。main 里字符串匹配哨兵真实存在（`AssistantTimeline.tsx:303,306`），是 P2 根因修复（字符串哨兵 = 症状层）。但前提：要先确认 M1 后 `CanvasAssistantPanel` 的等价组件（承担 agent 消息写入的那个）是否已将 `status:'pending'` 写正确。**可以从 PR #250 摘出 Item 1 的逻辑，对照 M1 后的实际组件重做**。

- **Item 2（`cancelled` 状态写入）**：需先确认 `CanvasAssistantPanel` 的 M1 后继任组件名（从当前 `src/workbench/generationCanvas/` 里找），然后检查它的终止路径是否有同等的 `status:'cancelled'` 写入。若没有，摘出 Item 2 的逻辑重做。

- **Item 3（动效 token）**：仍有价值，main 里确实缺失这三个 token，且设计系统文档（`docs/design/nomi-design-system.md`）里已经有文字说明但 token 层没有对应定义。该 agent UI 重做（设计定稿 `docs/design/2026-09-02-agent-ui-v3-walkthrough.md`）可能会用到 `--nomi-motion-orbit` 等。可以直接合入。

**注意**：agent UI 整体重做已拍板（`docs/design/2026-09-02-agent-ui-v3-walkthrough.md`），但 PR #250 的三项都是**底层 props 正确性 + token 层**，与 UI 长相无关，不冲突，不属于"被重做覆盖"的情形。

---

## PR #298 — `feat/generic-mcp-client-profiles`「generalize MCP client identity」（外部贡献者 @wanvfx）

### ① 它到底改了什么（人话）

把 Nomi 的 MCP 客户端身份从硬编码 `'claude' | 'codex' | 'cursor'` 三值联合类型，泛化成「校验后的字符串 + 可注册 profile」机制，让任意支持 MCP stdio 的 AI 工具可以作为一等客户端接入。

核心设计：
- `security.ts`：`AuthenticatedMcpClient` 从 3 值联合改为 `string`（过 `/^[a-z0-9][a-z0-9-]{0,63}$/` 校验），新增 `isValidMcpClientKey()` / `isBuiltinMcpClient()`
- `mcpConfig.ts`：内置三客户端变「种子」，新增 `listCustomMcpProfiles()` / `registerCustomMcpProfile()` / `removeCustomMcpProfile()` + profile 持久化到 `mcp-client-profiles.json`
- `mcpDetectedClients.ts`（新文件）：`recordDetectedMcpClient()` — 当未知工具首次连接时，`mcpProtocol.ts` 的 `initialize` 处理器检测到 `clientHost === 'external'` + rawName 非空，调 `onClientDetected(rawName)` 回调，最终落到这里记录
- `automationPolicyContract.ts`：`TRUSTED_HOSTS` 从硬编码四值集合改为「任意合法格式 key 均可进」（`MCP_HOST_KEY.test(item)`），`DEFAULT_AUTOMATION_POLICY_SETTINGS.trustedHosts` 恢复历史默认（不含 cursor）
- `mcpProfiles.ts`（新文件）：三条 profile IPC 通道（list/register/remove）改为 `ipcMain.handle`（async），`watchFile` 监听 profile 文件变化广播 `nomi:mcp:profiles-changed`
- `src/ui/onboarding/CustomMcpClientCard.tsx`（新文件）：自定义客户端接入 UI 卡片
- `AutomationPermissionsSection.tsx`：接入新 UI 卡片

### ② main 现状：MCP 侦察报告的三条返工要求完成了几条

**三条返工要求（来自 `docs/research/2026-09-02-mcp-survey.md §2`）：**

| 要求 | 状态 | 证据 |
|------|------|------|
| **① rebase 过 M1 main**（`0b6441c6` 重写 dispatcher/mcpProtocol/mcpStdioServer）| **未完成** | PR #298 创建于 2026-09-01 10:38，M1（#301）合入主干时间需确认；`generationTransportAdapters.test.ts` 的 diff 中补了 `canonicalRootDigest: "test-digest"` 字段（这是 M1 引入的），说明作者曾做过局部对齐，但 PR 的 mergeable 状态在侦察时为 UNKNOWN，实际 rebase 覆盖面需在 PR 上验证 |
| **② 3 条 sync IPC 改 async**（逆「读路径异步化」方向）| **已完成** | `electron/capabilityCore/mcpProfiles.ts` 中三条通道均为 `ipcMain.handle`（async）；preload.ts 中对应的 `listCustomMcpProfiles` / `registerCustomMcpProfile` / `removeCustomMcpProfile` 均走 `ipcRenderer.invoke`（非 `sendSync`）。PR #298 自己在 diff 注释中明确写了「三条 profile 通道都改 async（ipcMain.handle，renderer 走 invoke 而非 sendSync）」 |
| **③ 长尾客户端档案的产品位需过设计系统 §1.5 控件预算** | **部分完成（方向符合，但未出样张）** | PR #298 在 plan 文档（`2026-09-01-generic-mcp-client-profiles.md §2.4`）提供了 UI 草案（「自定义 MCP 客户端」卡片），并实现了 `CustomMcpClientCard.tsx`；但未出可评审的 HTML mockup 样张，也未明确标注该控件在 §1.5 层级预算里的位置。作者 plan 里提到了备选方案「curated 三家 + copy-config（不加 UI 卡片）」 |

**三条返工总结：① 未完成，② 已完成，③ 部分完成。**

### ③ 与 M2 工具面语义化、M3 会话链的冲突检查

- **M2 工具面**：M2 删除了 `nomi_generate`（`0b6441c6`），重组 42 个工具为语义化接口。PR #298 没有改工具定义（它改的是工具调用者的身份识别），两者**不冲突**，但需在 rebase 后确认 `mcpStdioServer.ts` 的 `onClientDetected` 注入点是否仍在同一位置。

- **M3 会话链**：M3 引入了分层 agent 提示词编译（`feat(m3): compile layered agent prompts`，`63cbfa26`）。PR #298 与会话链**不直接冲突**（改的是 transport 层身份识别，不涉及 prompt 编译），但 `automationPolicyContract.ts` 的 `trustedHosts` 变化需要确认 M3 的 Host 账本（M1/M2 引入）是否也有对应的 trusted host 校验逻辑需要同步泛化。

### ④ 裁决建议

**改造后合（需完成剩余返工项）**。

方向完全正确（P4 通用第一 + P1 三值联合类型删除），HMAC 安全机制保持不变，质量信号好（plan 文档 + 测试 + 走查脚本）。

剩余返工项：
1. **Rebase 到最新 origin/main**（M1 `0b6441c6` 之后），解决与 `dispatcher.ts` / `mcpProtocol.ts` / `mcpStdioServer.ts` 的实际冲突
2. **设计系统对账**：`CustomMcpClientCard.tsx` 出 HTML mockup 样张，用户拍板 + 与设计系统 §1.5 控件预算对账（或采用备选的「curated 三家 + copy-config 不加 UI 卡片」方案）
3. **M3 `trustedHosts` 对账**：确认 Host 账本侧是否需要同步泛化（grep `trustedHosts` 在 M3 引入的文件里）

### ④ 得体的关闭评论草案（若用户决定关闭后在新 PR 中收）

若裁决变为「关闭 + 摘取核心逻辑重做」，可用以下评论：

```
@wanvfx 非常感谢这个 PR！你找到了一个真实的架构问题（三值联合 hardcode 限制了生态扩展性），
方案方向完全正确，HMAC 安全模型保持不变、内置三客户端变种子的设计也贴合我们的 P1 纪律。

这个 PR 创建在 M1 重构（#301，`0b6441c6`）前后，`mcpProtocol.ts` / `mcpStdioServer.ts` / 
`dispatcher.ts` 三个文件都被 M1 重写过，直接合并会有实质冲突。

我们计划把本 PR 的核心设计（`security.ts` 类型泛化 + `mcpConfig.ts` profile 注册表 + 
`automationPolicyContract.ts` 的 TRUSTED_HOSTS 泛化）在 rebase 到最新 main 后以新 PR 的形式
收入。你的 `mcpProfiles.ts`（async IPC 通道 + watchFile 机制）和 `mcpDetectedClients.ts`（自动
检测记录）将被完整保留。

如果你有时间和意愿，欢迎在最新 main 上 rebase 并重新提 PR——我们会优先审；如果你更希望由我们
来完成 rebase 和收入，同样欢迎，我们会在 commit message 里保留 co-author 署名：
`Co-Authored-By: Zoyayayayaya <wanvfx@users.noreply.github.com>`

感谢你的贡献，这是一个非常高质量的外部 PR！
```

---

## 分诊汇总表

| PR | 标题 | 裁决 | 一句话理由 |
|---|---|---|---|
| **#255** | recover production MCP budget UX | **带指针关闭** | MCP 身份绑定被 M1（#301）覆盖；预算护栏被 `productionPolicyRecovery.ts` 取代；`data-production-hard-budget` 标注已在 `productionBudgetUxStructure.test.ts` 门岗断言 |
| **#249** | harden real-provider batch execution | **带指针关闭** | 慢供应商轮询缺口被 `multiShotBatchScheduler.ts` 的 observe loop 覆盖（`multiShotBatchScheduler.ts:99-100,311-317`）；锚检查点批准路径被 `dispatcher.ts:512` + `useProductionStatus.ts:197` 覆盖 |
| **#250** | stabilize assistant status view props | **摘取片段重做** | `isPending` 哨兵清理（main `AssistantTimeline.tsx:303,306` 仍有字符串匹配）+ 动效 token（main `nomi-tokens.css` 无 settle/breath/orbit）仍有价值，但需对照 M1 后的实际组件重做；UI 重做不影响这些底层修正 |
| **#298** | generalize MCP client identity（外部 @wanvfx）| **改造后合** | 三条返工：① rebase 未完成、② async IPC 已完成、③ 样张未出；方向完全正确（P4 通用第一），HMAC 不变，质量好，不能晾着贡献者 |

## #298 三条返工完成情况

| 要求 | 状态 |
|------|------|
| ① rebase 过 M1（`0b6441c6`） | **未完成**（mergeable=UNKNOWN） |
| ② 3 条 sync IPC → async | **已完成**（`mcpProfiles.ts` 全用 `ipcMain.handle`） |
| ③ 长尾客户端产品位过设计系统 §1.5 | **部分完成**（有实现无样张；备选方案存在） |
