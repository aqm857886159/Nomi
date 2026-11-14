# Agent 对话：错误说实话 + 回答跟界面语言（设计卡 + 方向检查）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

线：L-agenterr　类别：[其他]（用户可见文案变化，不碰花钱 / 长跑 / 可打断 / 新界面）
状态：已实现未推送。不动花钱语义，界面不谈钱。

## 设计卡（★5 格）

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当 Agent 对话里服务商断了一次连接，我想看到一句真话（连不上服务商，可以重试），并且 Agent 自己重试成功后红卡自己退场；英文界面下我用英文说话，回答就是英文。真实任务：①DeepSeek 断线一次后 Agent 自动重试成功（红卡变灰行「出错后已自动重试」）；②断线且重试耗尽（仍是红卡，写「连不上服务商」）；③英文界面英文提问，回答全程英文。不做：不改重试策略、不改花钱确认。已知坑：转录里的 error 不等于这一回合失败（pi 重试时会把错误从状态删掉、留在转录里）。 | `electron/shared/agentLane/laneProjection.test.ts`、`src/workbench/ai/lane/laneCommandFailure.test.ts`；截图见 PR |
| ★2 谁说了算 | 「这条错误是瞬时的」唯一 owner 是 pi（`isRetryableAssistantError`），Nomi 只做映射；「后来好了」由 `laneProjection` 从转录位置算（唯一出处）；日志只在渲染层 effect 里按条目记一次；语言规则唯一定义是主进程 `buildLanguageRule()`。碰 3 个概念：agent 对话错误、错误分类（生成域共用）、系统提示语言规则。 | `node scripts/door-map.mjs classifyGenerationError`：6 扇写入口（laneCommandFailure 两处、taskApi、NodeErrorReport、useNodeModelAutoSelect、generationFeedback、taskCenterEntries），只新增 4 个兜底词，几扇门一起受益 |
| ★3 一致与复用 | 复用 pi 现成的可重试表，不再抄第二张；复用现成的网络类文案（「连不上服务商」+「重试」）；复用 `buildLanguageRule()`，首尾各放一次沿用老 `composeAgentSystemPrompt` 的做法后删掉它。 | 见下「先查别人」 |
| ★4 全状态 | 失败：红卡，网络类写「连不上服务商」+ 重试提示；已化解：一行灰字「出错后已自动重试 / Hit an error and retried automatically」；重试进行中（流式）：同样按已化解处理，不闪红；用户自己停止（aborted）：不算化解；认不出：仍是通用句，日志记一次。zh、en 两套文案；不写任何金额或免费断言。 | `check:i18n`；截图（zh、en） |
| ★9 验收与回滚 | 验收：上面两份单测 + 变异（去掉 `recovered` 判断、把日志挪回投影必红）；回滚：`git revert` 两个提交，互不依赖。 | PR 正文 |

## 先查别人

| 能力 | 现成的 | 结论 |
|---|---|---|
| 判一条服务商错误是不是瞬时（断线 / 超时 / 限流 / 5xx） | pi-ai `isRetryableAssistantError`（`utils/retry.js`，已导出）。Nomi 的 `detectLegacyErrorKind` 嗅探表是抄它的第二张，还抄漏了 `connection error`、`timed out`。 | 接入：主进程把它喂给投影，渲染层只映射。嗅探表只补 4 个兜底词，不再是 Agent 这一路的主判据。 |
| 错误去重 / 退场 | pi 重试事件（错误留在转录、不在状态里） | 用转录位置判 `recovered`，不另起状态。 |
| 回答语言 | 没有现成库；`buildLanguageRule()` 是我们自己的领域文案 | 沿用唯一定义，首尾各放一次。 |

出处（可复核）：
- pi-ai 0.85 的可重试判据：`node_modules/@earendil-works/pi-ai/dist/utils/retry.js:20`（`RETRYABLE_PROVIDER_ERROR_PATTERN`）、`:167`（`isRetryableAssistantError`，已导出）。
- pi 自动重试把错误留在转录、从状态删掉：`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:2286`（`_prepareRetry`）、`:793`（触发点）。
- Nomi 抄的第二张表：`src/workbench/observability/classifyError.ts:210`（`detectLegacyErrorKind`）——本 PR 降为兜底。
- 回答语言的唯一定义：`electron/harness/context/agentContext.ts:80`（`buildLanguageRule`）。
- openai 客户端断线原文：`node_modules/openai/core/error.js:80`（`APIConnectionError` 默认消息 `Connection error.`）。

## 方向检查（RW，类根因复盘）

触发：`classifyError.ts` 近 14 天已有 11 个 fix（9-30 一天在嗅探表上补了三次），本次是第 12 个。

### 0. 一句话根因
同一个事实（「这条错误是瞬时的、可重试」）在 Nomi 有第二张自己抄的关键词表，而它是抄 pi 的、抄漏了，每次真实失败露出一个新漏词就补一行。

### 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 857ca3453 认不出的失败如实说认不出 | 嗅探表没认出来，落进编造文案 | 嗅探表覆盖不全 |
| cb2cced31 端口 59401 被读成 401 | 关键词误命中 | 嗅探表误判 |
| e0c027bb7 / 60b726f8a 按上游码与话归类 | 判据分散在多处 | 判据多出处 |
| 本次 `Connection error.` 落 unknown | 表里缺 `connection error` / `timed out` | 嗅探表覆盖不全 |
| 本次红卡不退场 / 日志 28 次 | 投影里没有「后来好了」；日志副作用藏在 useMemo 里 | 投影不纯、转录位置信息没用 |

### 2. 为什么这一类会一直出现
判「瞬时 / 可重试」的权威在 pi（它真正在重试），Nomi 却拿事后的字符串再猜一遍；两边永远对不齐，漏一个词就是一次用户可见的事故。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 下一个新服务商 / 新 SDK 的断线原话（如 `ECONNABORTED`、`stream closed`）又落进「认不出」 | 把 pi 表里有、Nomi 表里没有的词逐个喂 `providerFailureText`，看是否落 unknown |
| 流式快照每帧重算，任何再往投影里塞的 `log*` 都会再次刷屏 | `grep` 在 `useMemo` / 投影里调 `log*` 的位置（见 PR） |

### 4. 靶子独立性检查
尺子不是同一条线写的：判瞬时用的是 pi 自带的表；测试用 pi 的真函数喂投影，不是我们手写的断言表。

### 5. P0：这些是我们独有的吗？现成方案有哪些
不是独有。pi 已有可重试判定；Nomi 只保留「映射到本地化文案」这一层（领域约束：文案、i18n）。

### 6. 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 补 | 嗅探表再加几个词 | 小 | 下次还漏 | 只作兜底（生成域几扇门也受益），不当主判据 |
| 接入现成方案 | 投影带 pi 判的 `transient`，渲染层映射网络类 | 中，改契约两个可选字段 | 低 | 推荐（本 PR） |
| 重写 | 整个分类器换结构化码 | 大，生成域 6 扇门都要动 | 中 | 不做，生成域有结构化 category 在走 |
| 删 | 删嗅探表 | — | 老项目持久化的 node.error 没法归类 | 不做 |

### 7. 用户要权衡的核心
Agent 这一路的「可重试」交给 pi 判，生成域继续用自己的结构化分类，两边是否长期并存。

## 语言（提交 2）

lane 系统提示是 `[语言规则, 身份, 项目记忆]`，语言规则只在最前面一次，后面跟大段中文上下文，英文界面会被带偏成中文。老 `composeAgentSystemPrompt`（首尾各放一次，注释写明是被用户抓过中英混答）没有调用方，lane 换代时把这条教训丢了。做法：lane 最终系统提示首尾各放一次同一份 `buildLanguageRule()`，删掉死代码 `composeAgentSystemPrompt`。

## 截图（零额度，设计实验室，不起真 App）

屏 `agent-panel-v4` 新增两格（真投影：pi 转录 → `projectLaneSnapshot` → `laneViewModel`，不是手写红卡）。`agent-panel-v4` 在 `calibration.json` 里本来就是「基线待拍板」屏，所以这两格**没有录基线**，等用户看过再随整屏一起录；没动任何已有基线。

| 状态格 | 含义 | zh | en |
|---|---|---|---|
| `v4-panel-error-recovered` | 断线后自动重试成功：红卡退场，一行灰字 | `tests/ux/shots/agent-error-honesty/v4-panel-error-recovered.zh.png` | `…/v4-panel-error-recovered.en.png` |
| `v4-panel-error-network` | 断线且没接上：红卡归网络类 | `…/v4-panel-error-network.zh.png` | `…/v4-panel-error-network.en.png` |

已知差异：红卡文案是「连不上服务商：Connection error.」（en 为 "Cannot reach the provider: Connection error."，拼接符走 `agentPanelV4.errorWithDetail`，zh 全角、en 半角加空格）——分类器的 reason 加服务商原话；原话在中文界面里仍是英文，这是现有行为（服务商原话照旧露出），本 PR 没改。面板红条只显示 reason，不显示分类器的 hint（「请检查网络和代理，再重试」）。实验室里「是不是瞬时」用替身（浏览器不能 import pi 运行时），生产由 `laneHost.mts` 传 pi 的 `isRetryableAssistantError`。

## 后续

「副作用藏在 `useMemo` / 投影里」的全仓检查（只列不改）。方法：用 TypeScript 语法树扫 `src/`（不含 `devlab`、测试）里所有 `useMemo(...)` 回调体，找 `log*` / `logRenderer*` / `console.*` 调用；再按文件名找像投影、文案、分类、格式化的纯函数文件里的日志调用。

- 直接写在 `useMemo` 回调体里的日志：**0 处**。本 PR 之前唯一一处是间接的——`useMemo` → `laneViewModel` → `providerFailureText` → `classifiedFailureText` 里的 `logRendererError`，已修。
- 同一文件里既有 `useMemo` 又有日志调用的 7 个文件，逐个看过，日志都在事件处理 / `catch` / 回调里，不在渲染期：`src/workbench/ai/v4/useAgentPanelSpendConfirm.ts`（`failed` 回调、`.catch`）、`src/workbench/assets/AssetLibraryPanel.tsx`、`src/workbench/generationCanvas/nodes/NodeResultStack.tsx`（删除失败的 `catch`）、`src/workbench/NomiStudioApp.tsx`（项目恢复 / 保存 / 删除的 `catch`）、`src/workbench/taskCenter/TaskCenterPanel.tsx`（动作失败的 `catch`）、`src/workbench/generationCanvas/nodes/model3d/Model3DViewer.tsx`（`componentDidCatch`）、`src/ui/chunkBoundary.tsx`（`componentDidCatch`）。
- 调用 `laneFailureText`（带日志的那一条）的位置：`residentShellDisplay.friendlyError`（`catch` 里调）、`NomiStudioApp.tsx:362`（`catch` 里调）。都是一次性事件，没有重算风险。
- 值得下一轮复核的一处：`src/workbench/generationCanvas/reactFlow/useReactFlowViewportAnimation.ts:62` 的 `healViewport` 在被调用时 `logRendererError('canvas-viewport-non-finite', …)`。它是 `useCallback`，被谁调、多频繁没有追到底；如果由每帧视口变化回调触发，同一个坏视口会重复记。**待核，不在本 PR 改。**
- 这次的做法可以做成门岗：「纯投影 / 文案函数不许 import `rendererLog`」的 import 边界规则（`check:boundaries`），只列，不在本 PR 做。

## 未验证

- 语言规则首尾各放一次：`tests/agent-runtime/lane-language-rule.test.mts` 走真 lane 和真 HTTP 夹具，但系统提示是测试里照桌面运行时的拼法手拼的；生产里两处传参（`electron/agentLane/laneDesktopRuntime.ts` 单发路径的 `systemPromptClosing: buildLanguageRule()` 与 lane 路径的 `systemPromptClosing: buildLanguageRule,`）只由 `laneDesktopStructure.test.ts` 的源码结构断言钉着。`openWorkspace` / 单发处理是一个依赖 Electron 会话与 IPC 的大闭包，没有可单独调用的「组装函数」，本 PR 不为此拆它。真 App 英文界面端到端未跑（`unverified`）。
- 「terminated」兜底词：共享嗅探表里只认整串等于 `terminated`（undici 断线原话）；Agent 这一路的主判据是 pi 的可重试表，不依赖它。

## 自写登记 gate-family（本 PR 只删一行死条目）

登记条目 id：`gate-family`（`scripts/check-*` 门岗族，状态 under-review）。本 PR 对它的唯一改动是删掉 `scripts/check-i18n-visible-text.mjs` 豁免名单里指向**已删除文件**（`electron/ai/composeAgentSystemPrompt.ts`）的一行死条目，没有新增判据、没有补规则。

- 为什么现在换不了现成方案：这道门检的是「用户可见文本里不许有硬编码中文」，判据靠本仓自己的豁免名单和棘轮基线（electron 侧 78 处只减不增），现成的 i18n lint（如 eslint-plugin-i18next）没有「按文件逐条豁免 + 棘轮」这层，迁移要同时重录基线，不是顺手能做的，不在本 PR 范围。
- 哪天换：由登记条目 `gate-family` 的评估结论定（under-review，协调会话负责）；本 PR 不推进也不阻塞它。
- 方向上本 PR 没有往这张表里加东西，反而减了一行。
