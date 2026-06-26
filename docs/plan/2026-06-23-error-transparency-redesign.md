# 对话错误透传重设计（CR-B1 · 方案 A 错误卡）

日期：2026-06-23 ｜ 状态：已拍板（用户选方案 A 错误卡），实现中
来源：`docs/audit/2026-06-23-agent-conversation-render-audit.md` CR-B1（这一面最伤信任的项）

## 背景 / 根因

两个 agent（创作助手 / 生成助手）对话里的错误透传三处坏：
1. **不像错误**：错误气泡走普通 `AssistantMessageView`，仅靠开头「（错误）」三字区分（生成侧连这个判定都因前缀不匹配失效，已在 f31213f 改读 status 修了识别）——无红色语气，还带「复制」。
2. **创作侧双显**：一次 catch 同时 `setError`（底部红 banner [grid-area:error]）+ 写进气泡 → 同错误上下两遍、文案不同源。
3. **甩机器话**：两侧裸贴 `error.message`（`fetch failed`/`401`），绕过已有的 `narrate` 人话词表（生成域 `classifyGenerationError` 已治理 10 类 reason+hint，对话域漏网）。

## 目标（用户拍板的方案 A）

对话里的错误 = **一张红色错误卡**（复用 `NoTextModelRecoveryCard` 同款版式）：人话 reason + hint（接 narrate）+ 按错误类型给一键动作（去模型接入 / 重试）+ 原始报错收进可展开「技术详情」。创作侧删底部红 banner，错误只在对话内一处。

## 设计

**错误卡 `AssistantErrorCard`（新，`src/workbench/ai/`，共享给两个 agent）**
- 版式镜像 `NoTextModelRecoveryCard`：`NomiIdentityRow` + 红调卡（`border-workbench-danger` 软底 `bg-workbench-danger-soft`）。
- 内容：`IconAlertTriangle`（`text-workbench-danger`）+ 标题=`report.reason` + 正文=`report.hint`（均出自 `classifyGenerationError`）。
- 动作行（flex-wrap + shrink-0，几何安全网）：
  - `重试`（`onRetry` 提供时显）= 重发上一条用户消息。
  - `去模型接入`（始终显）= dispatch `nomi-open-model-catalog`（与恢复卡同事件）。
  - `技术详情 ›`（`report.raw` 与 hint 不同才显）= 折叠展开原始报错（开发者/排障用）。
- 无「复制」（错误不该被当回复复制——`isError` 既有语义延续）。

**分类复用（单一真相源，P1/P2）**
- 现成 `classifyGenerationError(message): { reason, hint, raw, providerMessage? }`（structured VendorRequestError + legacy 正则）就是错误文案唯一来源。
- 抽到 `src/workbench/observability/classifyError.ts`（narrate 旁的人话叶子层），避免把 515 行 `generationRunController` 拖进对话 bundle；`generationRunController` 改 re-export 保持 `NodeErrorReport`/test 现有 import 不破。
- 它 import 现有 `runner/vendorErrorIpc.ts` 的 2 个纯解析（43 行叶子，不动）。

## 改动文件

| 文件 | 改动 |
|---|---|
| `src/workbench/observability/classifyError.ts` | 新建：移入 `classifyGenerationError`+`GenerationErrorReport`+4 helper（`detectLegacyErrorKind`/`STRUCTURED_KINDS`/`pickProviderMessage`/`extractReadableErrorLine`）|
| `src/workbench/generationCanvas/runner/generationRunController.ts` | 删本体，改 `export { classifyGenerationError, type GenerationErrorReport } from '../../observability/classifyError'` |
| `src/workbench/ai/AssistantErrorCard.tsx` | 新建错误卡 |
| `src/workbench/generationCanvas/components/AssistantTimeline.tsx` | `status==='error'` 时渲 `AssistantErrorCard`（替代 `AssistantMessageView isError`）；接 `onRetry` prop |
| `src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx` | 传 `onRetry`（重发上一条用户消息=找最后 role:'user' 调 `submitAgentMessage`）|
| `src/workbench/creation/CreationAiPanel.tsx` | 渲染分支加 `status==='error' && !恢复卡` → `AssistantErrorCard`；**删底部 [grid-area:error] red banner + 对应 setError 显示**；传 onRetry |

## 不动项

- 共享发言渲染 `AssistantMessageView` 正常路径不动（只在 error 分支前分流）。
- 「缺大脑恢复卡」`NoTextModelRecoveryCard` 优先级高于通用错误卡（缺大脑是特化引导，保留其分支在前）。
- `vendorErrorIpc.ts` 不动（仅被 classifyError import）。
- 生成节点的 `NodeErrorReport`（节点上的错误 UI）不动——它已用 classifyGenerationError，re-export 保证不破。
- token 行（CR-B2）、折叠条（CR-B3）不在本切片。

## 实现切片

1. 抽 `classifyError.ts` + generationRunController re-export → gates 绿（证明搬移无回归，含既有 classifyGenerationError.test）。
2. 写 `AssistantErrorCard` + 生成侧 AssistantTimeline 接入 + CanvasAssistantPanel onRetry。
3. 创作侧 CreationAiPanel 接入 + 删红 banner。
4. gates + 真机走查（触发一次真错误看卡）。

## 回滚

纯前端、无持久化/schema 变更。逐切片 commit，任一切片回滚不影响其它。错误卡只改「错误怎么显示」，不改错误是否发生。

## 验收门

- 五门全过。
- 真机：构造一次 agent 错误（如断网/坏 key），两个 agent 都显红色错误卡、人话 reason+hint、动作按钮单行不竖排、原始报错在「技术详情」里、创作侧无底部红条重复。
- 既有 `classifyGenerationError.test` + `NodeErrorReport` 不破。
