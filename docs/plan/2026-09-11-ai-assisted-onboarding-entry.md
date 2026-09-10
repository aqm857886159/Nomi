# 「用 AI 帮我接入」：把接模型这件事交给用户已经在用的 AI 助手

> 2026-09-11 · 分支 `feat/ai-assisted-onboarding-entry-20260911` · 状态：✅ 已交付
> 设计定稿：[docs/design/2026-09-11-ai-assisted-onboarding-entry.md](../design/2026-09-11-ai-assisted-onboarding-entry.md)（用户 2026-09-11「按默认」拍板）

## 底层逻辑（这治的是哪个真实摩擦）

一个人想接新模型时，人在设置 →「模型」这一屏。这屏上给他的最后一条路是「自定义 API / 中转站」——
自己填 base URL、Key、模型 ID、再猜类型。而 Nomi 其实**早就能让他的 AI 助手替他干这件事**
（MCP 工具 `nomi_integration`，六个 action 走完全程），可是：

1. 那条路的入口住在**另一个 tab 的二级页**（自动化与权限 → AI 助手连接 → 管理连接），想接模型的人不会去那儿；
2. 就算他找到了，那张卡只说「让助手帮你建项目、出图」，**一个字没提「帮我接模型」**；
3. 最要命的是第三条：**他不知道该跟助手说什么**。这一半我们从来没做过。

所以 v1 只做两件事：**把入口放到人在的那一屏**，**补上「跟助手说什么」那一份文本**。
不造第二张接入卡——那是并行版（P1）。

## 范围

| | 改什么 | 不改什么 |
|---|---|---|
| A | `skills/nomi-add-model/SKILL.md`：一份标准 frontmatter 的技能包，正文逐条对着真实工具契约写 | 技能包格式（Agent Skills 标准）一个字不自造；`metadata.nomi` 不填 ⇒ 它不进 Nomi 自己的技能选择器 |
| B | 模型页顶部新增「用 AI 帮我接入」卡：宿主分段 → 主按钮「复制指引」→ 折叠内容预览 → 「或：手动接入 →」 | **不接 MCP**：一键接入/撤销仍由 `ConnectAssistantCard` 独占；新卡只给一行状态 + 一个跳转 |
| C | 进行中：把 `integrationContract` 的 12 个 stage 投影成 5 步显示，失败态如实报原始错误码 | 不新造状态机、不新加 IPC；用现役 `integrationHandoffList` / `integrationSessionGet` |
| D | 旧二级页（`ConnectAssistantCard`）加**一条**指向模型页那张卡的指路 | 旧页的一键接入、实连验证、复制配置一行不动 |

不动：`electron/` 全部（本轮零主进程改动）、`AutomationPermissionsSection.tsx`（内容基线已由 sha256 钉死）、
`OnboardingDrawer.tsx`（巨壳基线 806 行，本轮不碰）。

## 先查别人

完整报告：[docs/research/2026-09-11-ai-assisted-onboarding-entry/prior-art.md](../research/2026-09-11-ai-assisted-onboarding-entry/prior-art.md)。摘要（每条带出处）：

- **仓库里已有（卡本体）**：`src/ui/onboarding/ConnectAssistantCard.tsx:1` 已能干「把 Nomi 接进助手」，
  入口在 `src/workbench/settings/AutomationPermissionsSection.tsx:213`。**用已有**：那件事继续由它独占，新卡不复制它的任何按钮。
- **仓库里已有（契约）**：`electron/capabilityCore/mcpIntegrationTools.ts:11-15` 的六个 action、`:41` 的 `adapterDraft`、
  `:67` 的 `docs`。**用已有**：SKILL.md 正文逐条对着它写，不编流程。
- **仓库里已有（阶段词表）**：`electron/shared/integrationContract.ts:4` 的 12 个 stage。**用已有**：五步是它的投影。
- **依赖里已有**：pi 自带的 Agent Skills 加载器（`scripts/skills-format-lib.mjs:160` 已把它当第六条判据）。
  **用已有**：技能包直接进 `skills/`，由 `check:skills-format` 判「别的宿主读不读得出来」。
- **生态里已有（格式）**：Agent Skills 规范 <https://agentskills.io/specification>（`name`/`description` 必填，`metadata` 是扩展点）；
  Claude Code 装 MCP server 的 stdio 形状 <https://code.claude.com/docs/en/mcp>；
  Codex 的 `codex mcp add` 与 `~/.codex/config.toml` <https://learn.chatgpt.com/docs/extend/mcp?surface=cli>。**全部对齐，零自定义格式**（R31）。
- **没查成**：TikHub 自媒体侧（本 worktree 无 key）。明说没查成，不算「查过且没有」。

## 实现落点

- A：`skills/nomi-add-model/SKILL.md`。
- B：`src/ui/onboarding/aiAssistedOnboardingContent.ts`（三段内容 + 剪贴板拼装，纯函数）、
  `AiAssistedOnboardingCard.tsx`（**零桥**，实验室能用真实 props 陈列）、
  `AiAssistedOnboardingSection.tsx`（桥/订阅/轮询/首次描边）、
  `ModelSettingsHome.tsx`（搜索框正下方那一节 + 「手动接入」滚到既有的「自定义 API」行并描一次边）。
- C：`assistedProgressProjection.ts`（stage → 五步，纯函数）、`AssistedIntegrationProgress.tsx`（只读渲染）。
- D：`ConnectAssistantCard.tsx` 的已接入分支加一条 `data-assistant-add-model-pointer`。
- 共用 owner：`assistantActivationState.ts` 新增 `ASSISTANT_CLIENT_LABEL` / `ASSISTANT_CLIENT_ORDER`，
  两张卡同念一份（此前宿主显示名只在 ConnectAssistantCard 里有一份局部常量）。
- `src/rawText.d.ts`：`?raw` 的类型声明——SKILL.md 保持唯一真相源，卡里预览的和复制出去的是同一个字节流。

## 实施阶段发现的「没想到」（板上没有）

1. **Codex 官方文档没有 Agent Skills**（<https://learn.chatgpt.com/docs/extend/mcp?surface=cli>）。
   板上的任务提示词假设「宿主一定装得下技能」。已改成：「有技能目录就存进去，没有就直接照它做」——
   SKILL.md 原文本身就是可执行说明书，任何宿主都成立。
2. **能一键接入的宿主不是三家而是五家**（`ConnectAssistantCard` 的 `CLIENT_ORDER` 含 Cursor / Pi）。
   板上「那三家由 Nomi 一键写入」的前提有出入。保留四分段的形态不变，
   在「其它」那段加一行**从真实客户端表 derive** 的指路（"Nomi 也能替 Cursor / Pi 一键写好配置"），不手列宿主名。
3. **「重试 / 取消这次接入」在渲染层没有合法路径**：cancel 是 MCP 侧的 action，渲染层桥上没有它。
   画上去就是一颗按不动的按钮（违反控件契约 C1，`check:controls` 抓的正是这族）。
   改成一句真话：「Key 已经保存了，回到助手里让它重试即可」。见设计定稿的删除清单。

## 回滚

四条互不依赖，按 commit 主题分开：A（技能包）/ B（入口卡）/ C（进度投影）/ D（旧页指路）。
回滚 B 即回到今天的样子（模型页无此入口）；A 独立可留，因为它对任何宿主都直接可用。

## 验收门

- 单测：`aiAssistedOnboardingContent.test.ts`（6 条，含「剪贴板永远不带 key」「MCP 片段只给其它」）、
  `assistedProgressProjection.test.ts`（5 条，含「12 个 stage 一个不漏」）、
  `assistedOnboardingOwnership.test.ts`（6 条结构门：新卡不许长出第二颗一键接入、卡必须零桥、旧页只留一条指路）。
- 门岗：`pnpm run gates` 全绿；其中 `check:skills-format` 必须认下新技能包、`check:design-lab` 的
  `settings` 屏四张新基线一一对应、`check:i18n` 零新增硬编码。
- UI 交付：设计实验室 `settings` 屏新增四格（默认 / 未连上 / 进行中 / 失败），light + dark 各看一遍。
- R13 走查：`tests/ux/assisted-onboarding-entry.walk.mjs` —— 打开模型设置 → 卡在顶部 → 选 Codex →
  复制 → 剪贴板含任务提示词与 SKILL.md 正文且不含 key → 按钮变「已复制」。
