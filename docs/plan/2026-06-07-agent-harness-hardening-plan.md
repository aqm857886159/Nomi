# 执行计划：Agent Harness 硬化（Tier 1 + Tier 2 全做）

> 依据：对 Nomi agent harness 的 R6 审计（带 file:line，见下「现状证据」）。
> 与 `2026-06-07-assistant-consolidation-plan.md`（面板合并）并行推进——本文负责「围绕模型的工程脚手架」，那份负责「面板形态」。两者在工具执行层 / 面板层有交叠，按下方统一序列推进。
> 范围决策：用户拍板 **Tier 1 + Tier 2 全做**。

## 0. 原则与不动项

- **保留供应商抽象层**：`buildAiSdkModel.ts` + `modelProfiles.ts` 是这套 harness 最干净的部分（符合 P4），所有改动**不得**破坏「加新供应商 = 加一条 modelProfiles 数据」的性质。
- **P4 通用第一**：prompt caching 等供应商相关能力必须**按 provider 条件启用**，不写死、不为单一供应商分叉。
- **P1 加新必删旧**：如 maxSteps 魔法数、重复的 snapshot 注入，改完即删旧。
- 每项独立 commit、可回滚；每项过五门（filesize→lint:ci→typecheck→test→build）；涉及 UI 的过 Playwright 走查（R13）。

## 1. 八项清单（现状证据 + 改法 + 归属阶段）

| # | 项 | 现状证据（file:line） | 改法 | 阶段 |
|---|---|---|---|---|
| 1 | maxSteps 可配 | 写死 `maxSteps: 5` `electron/runtime.ts:2518`；onboarding 用 14 且可配 `onboarding/agent.ts:107` | 改为参数，按 skill 传入；规划类（storyboard/fixation）调高（如 24） | H0（前置） |
| 2 | repairToolCall | 用户面无；onboarding 有 `onboarding/agent.ts:113-141` | 把 `experimental_repairToolCall` 端口进 `runAgentChatV2` | H0（前置） |
| 3 | Stop 钮 + 真 abort | cancel 只设标志 `electron/main.ts:394-404`，拿不到 `runtime.ts:2511` 的 AbortController；面板无 Stop 钮 | 把 abortController 暴露到 session；cancel 调 `abort()`；两面板加 Stop 钮 | H1（并面板） |
| 4 | 去冗余快照注入 | 每轮整张快照塞进 user message `generationCanvasAgentClient.ts:76-84` + 30 条历史各带一份 | 仅当前轮带快照；历史轮快照剥离 | H1（并 1a/1b） |
| 5 | chat 重试/退避 | 无；`buildAiSdkModel.ts:67-78` 只打日志；生成路径已有 `generationRunController.ts:35` | 抄生成路径的 408/409/425/429/5xx + 退避到 chat 路径 | H2 |
| 6 | token 预算/压缩 | 只按条数封顶 30 `runtime.ts:2450,2469`，不按 token | 加 token 估算 + 预算截断 + 旧轮压缩（summarize） | H2 |
| 7 | prompt caching（按 provider） | agent 路径零命中（无 `cacheControl/providerOptions`） | Anthropic 等支持的 provider 上给 system+skill 块打 ephemeral 标记；**provider 不支持则跳过** | H2 |
| 8 | usage → 成本计数 | `agentStreamConsumer.ts:60` 拿到 usage，`desktopClient.ts:324` 丢弃 | 把 usage 透传到 renderer，接 session 级 token 计数器 + 最简成本 UI | H2 |

补充（审计 honorable mentions，随手带）：
- read 工具自动确认路径无 try/catch，异常会挂死循环（`CanvasAssistantPanel.tsx:243-247`）→ H1 补 try/catch + 失败回喂模型。
- 工具危险性靠硬编码名单判断 → 改为 schema 上的 `dangerous` 标志 → H1（和确认 UX 一起）。

## 2. 统一实施序列（harness ⊕ 合并）

> 顺序按「前置 → 碰同一片代码的合并一起做 → 独立硬化 → 最大可见改动最后」。

- **H0 前置（小、单文件 `runtime.ts`，拆镜头工具的硬前提）**：#1 maxSteps 可配 + #2 repairToolCall。验收：storyboard skill 可跑 >5 轮不被截断；弱模型坏 JSON 能自修。
- **C-1a 抽共享工具执行层**（合并计划阶段 1a）。
- **H1 + C-1b/1c**（碰同一片代码，合并做）：#3 Stop+abort、#4 去冗余快照、read 工具 try/catch、`dangerous` 标志；同时拆 window 事件桥、定妆消歧义。
- **H2 独立硬化**：#5 重试 → #8 usage 计数（便宜先做）→ #6 token 预算/压缩 → #7 prompt caching（按 provider）。
- **C-2 合并面板 + 空间行为**（最大可见改动，最后；R8 样张已拍板）。

## 3. 回滚与验收门
- 每个 # 独立 commit，单独可 revert。
- H2 的 #6/#7 风险较高（动上下文构造 / provider 行为）：改前在 `LAB_DEBUG_REQUESTS=1` 下对比请求体；#7 必须在「支持/不支持缓存」两类 provider 各验一遍不回归。
- 成本类（#5/#6/#7）验收看 usage 计数器（#8 先落地，给后面三项当量尺）。

## 4. 进度
- [ ] H0：#1 maxSteps 可配、#2 repairToolCall
- [ ] C-1a：抽执行层
- [ ] H1+C-1b/1c：Stop+abort、去冗余快照、try/catch、dangerous 标志、拆桥、定妆消歧义
- [ ] H2：#5 重试 → #8 usage 计数 → #6 token 预算 → #7 caching
- [ ] C-2：合并面板 + 空间行为
