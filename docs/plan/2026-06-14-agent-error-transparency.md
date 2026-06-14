# 创作助手报错透明化 + 弱模型引导（2026-06-14）

## 背景 / 根因（已实证复现）

用户反馈：创作助手里 **GPT-5.5** 和 **Moonshot（moonshot-v1-128k-vision-preview）** 都「没有返回东西」。
真机日志 + 直连/AI SDK 双复现，确认是**两个不同根因**：

### 根因 1 — GPT-5.5：上游业务错误被吞
真实返回：
```
[vendor-http] 400 ← https://dm-fox.rjj.cc/codex/v1/chat/completions (model=gpt-5.5)
   :: 官方算力限制，请等待一段时间后再进行使用，如有问题可联系管理员
```
中转商额度耗尽（外部问题）。**但** `agentStreamConsumer.ts:88` 把 streamText 的 `error` chunk 直接取 `.message`（= HTTP 状态文本 `Bad Request`），丢掉了 `APICallError.responseBody` 里的人话「官方算力限制…」。用户只看到 `（错误）Bad Request`，毫无指引。

### 根因 2 — Moonshot：被工具 loop 截断成空响应
直连实测：模型/key/请求全正常，带不带工具都能吐完整故事（finish=stop，517 tok）。
AI SDK 真路径复现，完整还原「空响应」：
- 第 1 步：调 `read_full_text`（finish=tool-calls）→ 自动回填空文档
- 第 2 步：把整篇故事塞进 `append_to_end` 的 JSON 参数流式输出，**finish=`length`** —— 撞上 `modelProfiles.ts` 给 moonshot-v1 设的 `max_tokens:4096`，**工具参数 JSON 中途截断** → 无有效 tool-call、无 text → 空。

这正是 profile 自己注明的 quirk：moonshot-v1「truncates tool-call argument JSON mid-stream」/ `agentSuitability:"poor"`。`chooseTextModel`（agentChatV2.ts:148）本已对 vision/preview 降权，但**用户显式选模型会绕过该保护**。

## 用户拍板（2026-06-14）

> 不在意「弱模型是否偷偷降级为纯聊天」——本地自用。**核心诉求 = 透明 + 引导**：
> 出问题时把「为什么」说清楚，并引导用户用更合适的模型。GPT-5.5 错误：透出上游人话。

→ 决定：**不偷偷改行为，而是把失败说人话 + 引导换模型。**

## 范围

1. **错误透传（通用，所有 vendor）**：新增 `describeAgentError(error)`，对 `APICallError` 解析 `responseBody` 抽人话（试 JSON 的 `error.message`/`message`/`msg`/`error` 字段，回退原文片段），前缀 HTTP 状态。接到所有 agent 错误出口：
   - `agentStreamConsumer.ts` error-chunk（:87）+ catch（:95）
   - `agentLoop.ts` streamText `onError`（:82）
2. **空响应说人话 + 引导（根因 2）**：`runAgentChatV2` 消费完流后，若 `finishReason==='length' && finalText===''`（截断签名），抛出带指引的错误（说明：达到长度上限/弱模型工具参数被截断；建议换通用对话模型如 GPT-4o/Claude/Gemini）。带上该模型 `getModelProfile().agentNote`。
   - 仅针对 `length`+空 这一明确失败签名 —— 不动 canvas agent「纯工具成功轮（tool-calls+空 text）」的正常语义。

## 不动什么

- 不删/不改 `chooseTextModel` 的降权逻辑、不强制改模型。
- 不动 canvas agent 正常的「只调工具、无文本」成功轮。
- 不提高 max_tokens（治标，且会掩盖 profile 已知的工具 JSON 不可靠 → 用户要的是透明不是遮掩）。
- 不改任何 UI 布局/卡片（纯错误文案，走既有 error 气泡通道）。

## 回滚

单 commit，回滚即 `git revert`。新增 `agentError.ts` 物理删除即可。

## 验收门

- TDD：`agentError.test.ts` 覆盖 APICallError(有 responseBody JSON / 纯文本 / 无 body) + 普通 Error + 非 Error。
- 五门全过：check:filesize / lint:ci / typecheck / test / build。
- 真机复现核对：① gpt-5.5 触发 → 气泡显示「官方算力限制…」而非「Bad Request」；② moonshot 触发 → 气泡显示截断原因 + 换模型引导，而非「空响应：AI 没有返回文本」。
