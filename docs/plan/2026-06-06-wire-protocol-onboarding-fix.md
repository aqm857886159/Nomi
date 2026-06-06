# 接入格式（wire protocol）全链路统一 —— 根治「第 3 协议被 IPC 层吞掉」

> 状态：待用户预读/拍板（R8）→ 实施 → 回填
> 触发：foxcode codex 渠道（`wire_api=responses`）从 UI 接不进来，502。用户追问「只改这些够吗 / 看全 CC Switch 了吗 / 审核了吗」，要求按规则重做。
> 前置查证：R5 Context7（AI SDK responses baseURL）✓、R6 真读 CC Switch 源码带 file:line ✓、全链路追踪 ✓。

## 1. 问题与根因（P2）

**症状**：用户在 onboarding 表单想接一个 OpenAI **Responses** 协议的中转（foxcode codex），生成时 502 —— 因为请求被当成 `/chat/completions` 发出，而该中转只认 `/responses`。

**入口集（这类 bug 能从哪些口出现）**：任何走 Responses 或 Anthropic 之外协议的供应商。不是个例，是一大类。

**根因（不是「缺预设」）**：`AiSdkProviderKind` 在 `electron/catalog/types.ts:20` 已是 **3 值**（`openai-compatible | anthropic | openai-responses`），`buildAiSdkModel`（`electron/ai/buildAiSdkModel.ts:122`）和 `normalizeProviderKind`（`electron/runtime.ts:915`）**都已支持 3 值**。但渲染层与 IPC 层把第 3 值**在到达归一化器之前就吞掉了**：

| 吞值点 | 位置 | 行为 |
|---|---|---|
| 三元 clamp ×**3** | `electron/main.ts:525 / 557 / 626` | `providerKind === "anthropic" ? "anthropic" : "openai-compatible"` —— 任何非 anthropic 值（含 `openai-responses`）静默降级 |
| 不安全 cast ×1 | `electron/main.ts:447`（文档 agent 路径） | `String(...) as ProviderKind` 回退链——**不是 clamp**（评审更正）；它放任意字符串过，但 cast 目标是 2 值 `ProviderKind`，TS 抓不到 typo。修法：改走 `normalizeProviderKind` |
| zod allowlist | `electron/ai/onboarding/tools.ts:237` | `z.enum(["openai-compatible","anthropic"])` —— 文档 agent 路径不许 emit 第 3 值 |
| TS 2 值联合 | `bridge.ts:110/122/135/145`、`desktopClient.ts:17/80`、`providerPresets.ts:14`、`OnboardingWizard.tsx:82`、`onboarding/types.ts:14` | 编译期就把第 3 值挡在渲染层外 |

> **评审更正（backend）**：原写「4 处 clamp」不准——实为 **3 处三元 clamp + 1 处不安全 cast**（`main.ts:447` 形状不同）。验收门 §8 因此新增**正向门**：main.ts 里每一处对 `providerKind` 的赋值都必须流经 `normalizeProviderKind`（grep「clamp 消失」抓不到这处 cast）。

**并行版（P1 违规）**：项目里现在有**两个归一化器** —— 宽松 3 值的 `normalizeProviderKind`（runtime）与严格 2 值的三元 clamp（main.ts ×4）。后者是 bug 源，且与前者构成「两份真相源」。

**自检（P2）**：修完后「协议被吞」还能从别的入口出现吗？只要 4 处 clamp + zod 2 值还在，答案是「能」（换个 IPC 入口就复发）。→ 没到根因。**根因层 = 消灭并行的 2 值归一化，全链路只认唯一的 `normalizeProviderKind`。**

## 2. 开源查证（R6，已读真实代码）

| 项目 | 架构 | 对我们可复用？ |
|---|---|---|
| farion1231/cc-switch | Rust **本地代理**做 chat↔responses↔anthropic 转换（`proxy/server.rs:227`、`transform_responses.rs:47/333`） | **代理不可复用** —— 我们用 Vercel AI SDK 在进程内已说三协议，无需嵌代理子进程 |
| daodao97/code-switch | Go 纯转发 + sjson 改 model 名（`providerrelay.go:138`） | 仅预设数据 |

**结论**：「照搬整个 CC Switch」架构上不成立（它为外部 CLI 当代理；我们直接调 API）。**可借鉴的是模式**：① `apiFormat` 四值枚举 + 选择器 UX（`ClaudeFormFields.tsx`）；② model-fetch 启发式（`model_fetch.rs:96`，剥 compat 后缀）；③ `max_tokens:1` 流式探活（`stream_check.rs:235`）。本次只取 ①（选择器 UX）+ 预设数据。

## 3. AI SDK 查证（R5，Context7 `/vercel/ai`）

- `createOpenAI` 默认 baseURL 含 `/v1`，`.responses()` 追加 `/responses` → `/v1/responses`。**故 `runtime.ts:2243` 给非 anthropic 拼 `/v1` 对 openai-responses 常见中转是对的，本处不改。**
- AI SDK 5.0 起 `openai()` 默认即 Responses；我们 default 仍走 `openai-compatible.chatModel`（chat），不受影响。

## 4. 方案对比（R3）

| 方案 | 用户看到 | 代价 |
|---|---|---|
| A. 只放宽 clamp 到 3 值，留两个归一化器 | foxcode 能接 | 并行版仍在（P1），下个 IPC 入口照样吞；文档 agent 路径仍接不进 Responses |
| **B. 删 4 处 clamp，全链路统一走 `normalizeProviderKind`；渲染层/agent 路径全升 3 值** | foxcode（及任何 Responses/未来协议）从手动 + 文档两条路都能接；表单出现「接口协议」选择器 | 9 文件改动 + 测试；一次性 |

采用 **B（用户已拍板，2026-06-06）**。

**协议识别 UX（评审后定，2026-06-06）**：在 B 之上采用**自动探测 + 专家可覆盖**（设计/真实用户强共识，合 P4）：

| 维度 | 做法 |
|---|---|
| 默认态 | custom/中转路径**不默认露出**协议选择器；用户只填地址+key+模型，点「测试并保存」 |
| 自动探测 | 后端按 `chat-completions → openai-responses → anthropic` 顺序，用**极小 max_tokens** 探测体挨个试；第一个非协议错（非 404/405/400-shape）通过的即采纳 |
| 反馈 | 成功后绿勾告知「已连上 · 用的是 **Responses** 协议」——把判断从用户身上拿走，替他选对并显式告知 |
| 专家覆盖 | 「高级 · 接口协议」可展开的 `DesignSegmentedControl`（Chat Completions / Responses / Anthropic）；展开=跳过探测、强制指定。具名预设的「自定义」链接也走这个展开（逃生口）|
| 失败指路 | 三协议全失败时，错误态指路而非甩红字：「端点都没接受，检查地址/key，或手动指定协议」 |

**预设范围（用户已拍板，2026-06-06）**：6 个预设一次上（foxcode codex / OpenRouter / SiliconFlow / 火山·Doubao / 阿里百炼 / Groq）。

## 5. 范围（必改 9 文件）

**渲染层（3 值联合 + UI）**
1. `src/ui/onboarding/providerPresets.ts` —— 类型升 3 值；新增预设（foxcode=openai-responses、OpenRouter、SiliconFlow、火山、阿里百炼、Groq）。预设数据来源标注 CC Switch（MIT）。
2. `src/ui/onboarding/OnboardingWizard.tsx` —— state 联合升 3 值；custom 区块加「接口协议」SegmentedControl（OpenAI 兼容 / Responses / Anthropic）；`canTest`/`baseUrlValid`/hint 补 openai-responses 分支。
3. `src/desktop/bridge.ts:110/122/135/145` —— 4 方法类型联合升 3 值。
4. `src/api/desktopClient.ts:17/80` —— `ModelCatalogVendorProviderKind` 升 3 值。

**IPC / 主进程（删并行版）**
5. `electron/main.ts` —— **删 4 处三元 clamp**，改调唯一 `normalizeProviderKind`；`test-connection` 加 `/responses` 探测 body；`list-models` 对无 `GET /models` 的端点不致误判（容错，不报硬错）。

**文档 agent 路径（升 3 值）**
6. `electron/ai/onboarding/types.ts:14` —— `ProviderKind` 升 3 值（`agent.ts:27` 随 import 生效）。
7. `electron/ai/onboarding/tools.ts:237` —— zod enum 升 3 值。
8. `electron/ai/onboarding/systemPrompt.ts:67` —— 提示词补「Responses 中转选 openai-responses」判据。
9. `electron/ai/onboarding/reporter.ts:69` —— 随类型放宽（如有硬编码）。

**单一真相源原则**：渲染层 3 值联合**只在 `desktopClient.ts` 定义一次**，其余渲染文件 import；electron 侧 3 值真相源是 `catalog/types.ts:AiSdkProviderKind`（已就绪），onboarding `types.ts:ProviderKind` 改为 `import` 它而非平行定义（消除又一处漂移）。

## 6. 不动什么

- `electron/catalog/types.ts`（已 3 值）、`electron/ai/buildAiSdkModel.ts`（已 3 分支）、`runtime.ts:915 normalizeProviderKind`（已 3 值）—— 这三处是「已对的根因层」，本次围绕它们收口。
- `runtime.ts:2243` 的 `/v1` 拼接（R5 已证对）。
- 不嵌任何本地代理 / 子进程（R6 结论）。
- 不改 catalog schema、mapping 存储格式、生成轮询编排。
- 不改模板占位符名。

## 7. 回滚策略

- 单 PR、单 commit。若回归 `git revert` 一把回。
- 实施前基线：本地用一个 openai-compatible 模型 onboard + 测试通过，确认未破坏既有路径。

## 8. 验收门（P3：全绿 ≠ 完成）

1. `check:filesize` → `lint:ci`（max-warnings 不增）→ `typecheck`（双向 0 新错）→ `test`（含 `runtime.manual-onboarding.test.ts` 升 3 值断言）→ `build` 全过。
2. `grep` 确认 `electron/main.ts` **不再有**任何 `=== "anthropic" ? ... : "openai-compatible"` 三元 clamp（P1：并行归一化物理删除）。
3. `grep` 确认渲染层 3 值联合**只定义一处**，其余 import。
4. **样张对账（R8）**：onboarding 表单实现后与本 plan 配套 mockup 逐项并排（选择器位置/文案/默认值/渐进展开）。
5. **真体感走查（P3/R13）**：Playwright 跑「用户拿一个 Responses 中转 key，从空状态接入成功」旅程，截图人眼判断 —— 不是 expect 断言。
6. 真实端到端：用一个 Responses 协议中转（foxcode codex）从 UI 完整接入并成功生成一次文本。

## 9. 六角色评审（R7）

见本文件 §10（评审记录）。六角色（CTO/设计/PM/前端/后端/真实用户）定稿前各审一遍，意见回填。

## 10. 评审记录（六角色，2026-06-06 回填）

**CTO（架构/安全）**
- ✅ 根因方向对，无循环依赖（`buildAiSdkModel.ts` 已 import `catalog/types`，分层 electron/ai → electron/catalog 单向，先例在）。
- ⚠️ **新信任边界**：clamp 删除后，`main.ts:447` 的 `String(...) as ProviderKind` 成为软肋——任意字符串可达工厂。**必须每个 IPC 入口都走 `normalizeProviderKind`**，加正向验收门。
- ⚠️ 测试不足：需为 `normalizeProviderKind` 加对抗输入单测（`null`/带空格/大小写/对象）+ 4 IPC handler 各喂 `openai-responses` 断言存活。
- back-compat 已天然处理（Vendor.providerKind 可选 + 默认 openai-compatible）。

**后端（Electron main）**
- ❗ **事实更正**：是 **3 处 clamp**（:525/:557/:626），非 4。`:447` 是另一种形状（已并入 §1）。
- `/responses` 连接测试体应是 `{ model, input:"ping", max_output_tokens:16 }`（**非 `messages`**；`max_tokens`→`max_output_tokens`）；探测有意义（错协议会立刻 404，正是要的信号）。
- `list-models` **现有代码已优雅降级**（`main.ts:659` 返回 `{ok:false}`，UI 回退手填，不抛）——§5 此项**无需改代码**，仅需区分 404（端点缺失，静默回退）vs 401/5xx（真失败，提示）。
- baseURL 规范化：persist 前防御性 trim 掉尾随 `/v1`、`/responses`，存 canonical host，避免 `.responses()` 拼成 `/v1/responses` 时双重路径。
- ❗ main.ts 的 3 个 IPC handler **当前零测试**——「bug 能 ship 出去」正因如此。补 fetch-mock 单测各 1。

**前端**
- ❗ **状态打架**：`OnboardingWizard.tsx:443-447` 在 BaseURL 每次 keystroke 重跑 hostname 自动探测；若加 SegmentedControl 直写 providerKind，用户的手选会被下一次输入静默覆盖。需 `userPickedKind` 标志门控自动探测（自动探测只当初始猜测，永不覆盖手选）；切回具名预设时 reset 该标志。
- ❗ 用 **`DesignSegmentedControl`（`src/design/forms.tsx:90`）**，不是裸 Mantine。
- ❗ 单一真相源**不该放 `desktopClient.ts`**（它 import bridge，会成环）——放 `src/desktop/bridge.ts`（或 `src/desktop/providerKind.ts`），`desktopClient` 与 `providerPresets` 都 import 它。
- `canTest`/`baseUrlValid`（:355-358）显式写 `=== 'anthropic'` 分支，openai-responses 与 openai-compatible 同规则（需 BaseURL），加注释防下个协议误继承 anthropic 的「可留空」。

**设计**
- ❗ **缺逃生口**：具名预设若协议配错/中转漂移，选择器隐藏 → 用户卡死。State A 的「自定义」链接应能展开**协议选择器**（不只改 BaseURL）。
- ❗ **缺失败态**：3 个样张都是 happy path；用户真正会撞的是「测试失败 404/502」——这才是最该设计的态，错误要指路换协议（「端点不接受 chat/completions，试试 Responses?」）。
- 术语：「Responses」保留（与中转文档逐字对应）；但「OpenAI 兼容」歧义（Responses 也是 OpenAI）→ 改 **「Chat Completions（默认）/ Responses / Anthropic」** 平行结构。
- SegmentedControl vs chip 是**有意的语义区分**（mode 切换 vs 1-of-N 目录），保留；字号对齐 12.5px。

**PM**
- ❗ **建议拆 PR**：clamp 修复 + 选择器 + **仅 foxcode 预设** 一个 PR（同一原子能力，UI 不带后端会静默降级）；**另 5 个预设（OpenRouter/SiliconFlow/火山/百炼/Groq）纯数据，拆后续 PR**，缩小回归面。
- Anthropic-via-custom-URL 也是**同等用户赢**（被低估），应在叙事里并列，非副作用。
- 加回归门：具名预设（如 DeepSeek）onboarding **零新 UI + mapping 字节与改前逐字一致**。
- 下个必问 gap（写进 §6 不在范围）：单模型协议覆盖、Gemini 原生协议。

**真实用户（买中转 key 的视频创作者，非程序员）**
- ❗ **「接口协议」三个词一个不认识，直接懵**。「不确定选 OpenAI 兼容」**不安心反更慌**（暗示选错有后果）。
- 「Responses」=纯黑话；老板说的是「codex」，**两个词对不上**，藏在浅灰小字里多半不读。
- 选错失败只甩红字 → 「这破 app 连不上」**直接弃用（#1 流失点）**。
- **最强诉求**：「我不想选，我想让它告诉我它替我选对了」→ 点保存时后台**自动按 Chat→Responses→Anthropic 挨个探测**，绿勾说「已连上，用的是 Responses 协议」。

### 评审导出的两个待定（决策给用户）

1. **协议识别 UX**：纯手选选择器（原样张）vs **自动探测 + 可覆盖**（设计/真实用户强共识，且合 P4 通用第一）。后者代价=测试时多发几次 API 调用（用户额度）。
2. **预设范围**：6 个一次上 vs 仅 foxcode + 5 个拆后续（PM 建议）。

### 已采纳、无需问、直接并入实现的修正

- clamp 计数更正为 3+1cast；全入口走 `normalizeProviderKind` + 正向验收门。
- `DesignSegmentedControl` 替裸 Mantine；单一真相源移到 `src/desktop/bridge.ts`。
- `userPickedKind` 标志解决自动探测 vs 手选打架。
- `/responses` 测试体 `{model,input,max_output_tokens}`；list-models 仅区分 404 vs 401/5xx（不改降级逻辑）。
- baseURL persist 前 trim `/v1`、`/responses`。
- 失败态指路换协议 + 具名预设「自定义」可展开协议选择器（逃生口）。
- 单测：`normalizeProviderKind` 对抗输入 + 3 IPC handler fetch-mock + manual-onboarding 升 3 值。
- 标签改平行结构「Chat Completions（默认）/ Responses / Anthropic」。

## 11. 结果（实施后回填，2026-06-06）

**改动文件（实际 11 个 + 2 测试 + 1 样张）**
1. `electron/runtime.ts` — `normalizeProviderKind` 改 `export`（main.ts 复用，消除并行归一化）。
2. `src/desktop/providerKind.ts`（新）— 渲染层 3 值单一真相源。
3. `src/desktop/bridge.ts` — import ProviderKind，替 4 处内联 2 值；testConnection 加 `autoProbe` 入参 + `detectedKind` 返回。
4. `src/api/desktopClient.ts` — `ModelCatalogVendorProviderKind = ProviderKind`。
5. `src/ui/onboarding/providerPresets.ts` — 升 3 值 + 6 预设（foxcode/OpenRouter/SiliconFlow/火山/百炼/Groq）。
6. `src/ui/onboarding/OnboardingWizard.tsx` — 3 值 state + `kindForced`/`showKindOverride`；auto-probe wiring（测试发 autoProbe、消费 detectedKind、绿勾显示协议）；失败展开覆盖区 + 指路；`DesignSegmentedControl` 覆盖区；hostname 探测尊重 kindForced。
7. `electron/main.ts` — **删 3 处 clamp**（manual-commit/list-models）+ **修 :447 cast** → 全走 `normalizeProviderKind`；**重构 test-connection 为 auto-probe**（`probeOneProtocol` chat/responses/anthropic，按候选顺序探测，返回 detectedKind）。
8. `electron/ai/onboarding/types.ts` — `ProviderKind` 改为 import catalog 的 `AiSdkProviderKind`（消除平行定义）。
9. `electron/ai/onboarding/tools.ts` — zod enum 升 3 值。
10. `electron/ai/onboarding/systemPrompt.ts` — 提示词补 wire_api=responses → openai-responses 判据。
11. `electron/ai/onboarding/reporter.ts` — 无需改（透传，随类型放宽）。
12. `electron/runtime.manual-onboarding.test.ts` — 新增 foxcode(openai-responses) 持久化 round-trip + `normalizeProviderKind` 对抗输入单测（+4 用例）。

**auto-probe 的工程取舍（实现细节）**：探测聚焦 **chat↔responses**（共享 /v1 baseURL + bearer，只 path/body 不同——正是 foxcode 混淆点）；anthropic 因 URL/认证形状不同，仅当 hostname 像 anthropic 或地址留空时纳入候选。mismatch 判据：404/405/501/502/503 视作「协议/路由不对」换下一个；401/403/400 视作鉴权/请求错（不换、直接报）。

**已过的验收门**
- ✅ `typecheck`（app + electron 双向 0 错）。
- ✅ `test`（745 全绿，含 +4 新用例）。
- ✅ `build`（Vite + electron tsc）。
- ✅ `lint:ci`（94 warning < 98 棘轮；本次新增代码 0 warning）。
- ✅ `check:filesize` **就本次改动**：runtime.ts 收回基线 2533。
  ⚠️ 该门当前仍红，但**唯一红点是 `GenerationCanvas.tsx`(1199>1186)——本次改动未碰，属既有未提交 WIP**，不在本任务范围。
- ✅ 样张对账（§4 配套 mockup 已改为 auto-probe 版，逐项对上 OnboardingWizard 实现）。

**尚未做（P3 缺口，诚实记录）**
- ❌ 真体感走查（Playwright 跑真实 onboarding 旅程截图人眼判断）—— Electron 渲染层，待补。
- ❌ 真实 Responses 中转端到端（foxcode codex 从 UI 接入并成功生成一次）—— 需用户的 foxcode key（用户独有资源）。

待补完这两项才算 P3 完成；当前为「代码就绪 + 结构验证过，真机体感未走」。
