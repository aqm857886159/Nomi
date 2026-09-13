# 接模型工具面重做 · 实施方案（4 工具形态）

> 状态：🚧 实施中（2026-09-11）
> 分支 `feat/mcp-onboarding-tool-face-20260911`，base `origin/main`。
> 设计正本：`design/mcp-onboarding-tool-face-20260911:docs/design/2026-09-11-mcp-onboarding-tool-face.md`（9 动词版）。
> 用户 09-11 22:10 拍板：**形态折算成 4 个工具**，其余（描述五槽 / 信封 / 幂等 / O1–O7 / SKILL.md 改写稿 / 题库）沿用设计稿。

---

## 0. 一页读懂（D6）

**真实摩擦。** 用户对 Codex 说「帮我把 DeepSeek 接进 Nomi」。9 个回合、58 次工具调用，只有 1 个回合走完；
入参一次写对 36/58 = 62%；人插手 10 次，其中在 Nomi 窗口点了 4 次确认、3 次是白点。
他不会觉得「模型填错了字段」，只会觉得「让 AI 帮我接模型根本不能用」。

**为什么修字段修不好。** 22 次失败里 9 次死在「schema 上写的必填是假的」、6 次死在 `expectedRevision`、
4 次死在「等人的时候手上只有写动词」。共同点是**我们把自己的状态机原样投影成了模型的动作空间**：
会话 id、乐观锁版本号、幂等键、6 个 action 的合法顺序——这四样全是 Nomi 的实现，用户世界里一个都没有。

**这一版做的事。** 把 11 个入口收成 **4 个工具**，把 `expectedRevision` / `idempotencyKey` **整个从模型入参里拿掉**，
给每个写动作一个带 `unverified`（哪些话此刻没有证据）和 `blastRadius`（这一跳波及什么）的返回信封，
把「等」做成独立工具。

**要权衡的那一个东西：合并的边界画在哪。**
Anthropic 官方建议「合并相关操作用 `action` 枚举」；先例库（达芬奇）说「枚举会让审批注解塌到整组」。
调和规则（09-11 拍板）：**一个工具 = 一种后果 = 动哪个状态 × 效果类别；同格合并用 `action`，跨格必拆。**
于是 6 个可撤销的设置步骤合成一个 `nomi_model_setup(action=…)`；读、等、不可逆删除各自单开。

---

## 先查别人（§1）

> 先例库正本：[docs/research/2026-09-11-agent-tool-face-prior-art/README.md](../research/2026-09-11-agent-tool-face-prior-art/README.md)
> （13 个产品 + 5 份设计指南 + 反例集，2026-09-11）。本分支把它随方案一起带上，
> 这样门岗和评审都能自己翻开每一条的出处，而不是只读到一句「查过了」。

| 来源（可复核） | 结论 | 我们怎么用 |
|---|---|---|
| `docs/research/2026-09-11-agent-tool-face-prior-art/README.md:60` | 13 家工具数中位数 ≈ 29，**没有一家把全部能力一次性摆出来**（Playwright 71 个里默认只暴露 24） | 本轮 4 个工具全量暴露；「按任务阶段分组暴露」登记为下一步（§8 待拍板 2） |
| `docs/research/2026-09-11-agent-tool-face-prior-art/README.md:62` | MCP 的 `destructiveHint` 在四个官方 server 里**一次都没被用上**，各家都另建审批机制 | 不靠 annotation 表达后果：`effect` 是我们自己的四值，`blastRadius` 把「波及什么」写成数据 |
| `docs/research/2026-09-11-agent-tool-face-prior-art/davinci-resolve.md:242` · `:309` | 把操作收进 `action` 枚举，**审批注解的粒度会塌到整组**；枚举收敛只在「同组读写属性一致」时才免费。原文点名：绝不要把「预览报价」和「执行扣费」放进同一个枚举 | 这条直接变成合并规则：同格合并、跨格必拆。`nomi_remove_provider` 因此单开，`check:tool-face` C1/C2 把它钉成门岗 |
| `docs/research/2026-09-11-agent-tool-face-prior-art/github.md:25` · `:54` | GitHub 把 `create_issue` + `update_issue` 合成一个 `issue_write`，判据写进描述；`issue_write` 用 STOP 文案挡住模型替用户下结论 | `connect_provider` 同样「建与改是同一个动作」（给 vendorKey 就是改）；STOP 的结构版就是 `unverified[]` |
| `docs/research/2026-09-11-agent-tool-face-prior-art/figma.md:22` | `get_design_context` 在自己的描述里自述「我是这一组的默认入口，其它工具要么喂我、要么是我的兜底」 | `nomi_list_models` 描述第一句就自述主入口，其余三个的 `notWhen` 都指回它 |
| `docs/research/2026-09-11-agent-tool-face-prior-art/design-guides.md:7` · `:46` · `:96` | Anthropic 三份指南：描述五要素、合并相关操作、把工具描述当 prompt 来写 | 五槽描述（做什么 / 何时用 / 何时不用该用谁 / 参数从哪来 / 后果）由 `declarations.ts` 派生；第五槽不手写 |
| `docs/research/2026-09-11-agent-tool-face-prior-art/design-guides.md:209` | `idempotentHint` 是**给宿主看的提示**，不是让模型铸键的接口 | 幂等键由宿主按 `(setupId, action, canonicalJson(args) 的 SHA-256)` 派生；模型入参里没有 key 也没有版本号 |
| `docs/fixes/2026-09-11-mcp-onboarding-defects.root-cause.json:5` · `:6` | 我们自己的实测：58 次调用写对 36 次（62%）、9 回合只走完 1 个；六个面各藏了一个模型需要的事实，其中 (4) 是「schema 广告的必填是假的」 | 这是本方案要推翻的基线，也是阳性对照臂要复现的那个 60–65% |
| `docs/audit/2026-09-06-agent-tool-layer-audit.md:23` | 同一份审计早就点名：35 个工具**没有一个**带示例、必填字段没有一句说明 | `declarations.ts` 每个动作带 `inputExamples`，且每条都必须过自己的 schema（测试钉住） |

**结论：不自研第二套，照抄现役做法，只在一处偏离。** 合并用 `action` 枚举（GitHub / Anthropic），
读写分开（Figma / 13 家共识），主入口自述（Figma），描述当 prompt 写（Anthropic）——这些原样拿来。
**唯一的偏离**是合并边界：Anthropic 说「合并相关操作」，达芬奇实测说「枚举会塌审批注解」，
两条官方建议互相矛盾，没有现成答案，所以我们自己定了一条判据（状态 × 效果类别）并把它做成门岗。
偏离理由是领域约束而不是偏好：**Nomi 自己就是宿主**，审批卡是我们弹的，
所以「注解塌到整组」在别人那里是文档问题，在我们这里会变成用户每次只读也要点确认（达芬奇那条原文的原话）。

仍在另一条分支、尚未并入的两份（合并后本节改为直链）：
`design/mcp-onboarding-tool-face-20260911:docs/design/2026-09-11-mcp-onboarding-tool-face.md`（9 动词设计正本）
与同分支的 `docs/design/2026-09-11-agent-tool-face-first-principles.md` §6.1/§6.2（一份声明三处派生）。

---

## 2. 形态折算：9 动词 → 4 工具

| 工具 | 效果类别 | 动作 | 为什么在这一格 |
|---|---|---|---|
| `nomi_list_models` | `read` | —（无 action） | 读。S11 只有一个读门 |
| `nomi_await_setup` | `read`（阻塞） | — | 「查一眼」与「等到好」是两件事（先例库结论） |
| `nomi_model_setup` | `reversible_local` | `connect_provider` / `choose_models` / `draft_adapter` / `check_connection` / `show_models` / `cancel` | 同一格：都改「设置会话」、都可撤销、都不花钱。每步可单独重试 |
| `nomi_remove_provider` | `irreversible` | — | 唯一不可逆。锁（`ifUnchanged`）只在这里 |

**动词名 → action 值**：`connect_provider`/`choose_models`/`draft_adapter`/`check_connection`/`show_models` 原样；
`cancel_model_setup` → `cancel`；`list_models`/`await_model_setup`/`remove_provider` 升格为工具名。

**没有的东西**：`spend` 动词（免费自检）、「填 key」动词（是 `nextAction`）、「试跑」动词（模型页上的按钮，用户自己点，显示价格）、
「探测端点」动词（宿主自己做）、「确认」动词（宿主按 `effect` 弹）。

---

## 3. 范围

### 3.1 新增

| 文件 | 内容 |
|---|---|
| `electron/capabilityCore/modelOnboarding/declarations.ts` | **单一声明**：4 个工具 × 6 个 action 的 `effect` / schema 字段 / 五槽描述 / `input_examples` / `nextAction` 可能值。描述、schema、运行时必填三处从这里派生 |
| `electron/capabilityCore/modelOnboarding/envelope.ts` | `OnboardingResult` / `OnboardingFailure` 类型 + 构造器 + `unverified` 推导 + `blastRadius` |
| `electron/capabilityCore/modelOnboarding/idempotency.ts` | `(setupId, action, canonicalJson(args) SHA-256)` → 幂等键；重放返回同一结果（含同一 `changeId`） |
| `electron/capabilityCore/modelOnboarding/tools.ts` | 4 个 MCP 工具定义（从 declarations 派生） |
| `electron/capabilityCore/modelOnboarding/dispatch.ts` | `modelSetup.*` 路由；宿主在这一层读当前 `revision` 自己填，模型面上没有锁 |
| `scripts/check-tool-face.mjs` | O1–O7 + 「同格多工具」「跨格合并」两条 |
| `tests/fixtures/tool-selection/2026-09-11-onboarding-bank.json` | 30 句 + 9 回合回放，`expected*` 按 4 工具形态改写 |
| `electron/capabilityCore/modelOnboardingLoopback.test.ts` | 零额度 loopback：30 句选工具 + 9 回合逐跳回放 + **阳性对照臂**（冻结的旧 6-action schema 夹具） |
| `tests/fixtures/tool-selection/2026-09-11-legacy-6action-face.json` | 阳性对照用的**冻结快照**（不是并行实现：只有 schema，没有运行时） |
| `docs/design/mockups/2026-09-11-not-yet-tried-badge.html` | 「未试跑」角标样张 |
| `docs/fixes/2026-09-11-mcp-onboarding-tool-face.root-cause.json` | schema-v3，`recurring` |

### 3.2 修改

- `electron/capabilityCore/mcpToolCatalog.ts`：`MCP_INTEGRATION_TOOL` + `MCP_INTEGRATION_MANAGEMENT_TOOL` → 4 个新工具；`nomi_read` 去掉 `target=integration`
- `electron/capabilityCore/dispatcher.ts`：`integration.*` / `integration.manage.*` → `modelSetup.*`
- `agent-skills/nomi-add-model/SKILL.md`：按设计稿 §6.4 改写稿逐字写
- `electron/capabilityCore/mcpProtocol.ts`：破坏性变更发 `notifications/tools/list_changed`
- 受影响 e2e / 单测：`mcpSurfaceCollapse` `mcpOnboardingDefects` `mcpRpcError` `mcpCredentialElicitation` + `tests/ux/*` 7 支
- `scripts/model-schema-baseline.json`、`package.json`（新 script）、`scripts/gates-chain`

### 3.3 删除（P1 加新必删旧）

`electron/capabilityCore/mcpIntegrationTools.ts`、`mcpIntegrationManagementTools.ts`、
`mcpIntegrationTools.test.ts`、`mcpIntegrationManagementTools.test.ts`、`mcpOnboardingLoopback.test.ts`（被新 loopback 取代）。
**无并行版**：旧 6-action 面只以 `tests/fixtures/.../legacy-6action-face.json` 这份**只有 schema 的冻结快照**存在，
它只被阳性对照臂读，不接任何运行时——这是量尺，不是逃生口。

---

## 4. 不动项

- 付费缝：MAC / fail-closed / 收据落账（`approvalReceipt.ts`、`integrationSpendGate.ts` 的收据部分）一行不碰
- 凭据：`credentialElicitation.ts` 的 URL 模式票据、安全页、`saveCredential` 路径不动；key 永不进任何工具参数
- `IntegrationSessionService` 的持久化格式与 `confirmFromTrustedUi`（可信 UI 路径）不动
- `models.list` / 画布模型框的既有投影不动（只多一个「未试跑」角标字段）
- 生成侧工具（`nomi_generation_*`）、画布/时间轴/文稿语义面不碰

---

## 5. 回滚

单 commit，`git revert` 即可。新旧不共存（旧工具名同 commit 删除），所以不存在「回滚一半」的中间态。
外部宿主侧：回滚后需再发一次 `notifications/tools/list_changed`，发布说明写清两次改名。

---

## 6. 验收门

| 门 | 判据 |
|---|---|
| `check:tool-face` O1–O7 + 2 | 每条**先验它会红**（R17），红的截图/输出进 PR |
| 零额度 loopback | 入参一次写对率 ≥90%（基线 62%）、9 回合 ≥8 成（基线 1）、人工干预 0（基线 10）、`unverifiedMustContain` 逐条、`mustNotAppearInArgs` 全域扫 |
| **阳性对照臂** | 同一份题库跑冻结的旧 6-action schema，必须落在 **60–65%**。不落 = 量尺坏了，新面的 ≥90% 不作数 |
| 真实模型 ×3 司机 | Codex 本机 CLI / Claude Code 本机 CLI / Nomi 自身 Agent 走 DeepSeek 便宜档；三者首调分布一致；数字进 PR 不进基线 |
| 真机走查 | 「Codex 说帮我把 X 接进 Nomi → 设置页弹出填 key → 模型框出现标未试跑 → 点试跑显示价格」，截图人眼判断 |
| `pnpm run gates` | 全绿 |

---

## 7. 与在途分支的接口

| 分支 | 关系 | 处置 |
|---|---|---|
| `feat/agent-tool-face-single-owner-20260911`（Fable） | 把三个注册表收成一份 `VerbDeclaration[]` | 45 分钟内未推 → 从 `origin/main` 切，`declarations.ts` 就是那份声明在本域的形状，留 TODO 指向合并时的迁移 |
| `feat/model-onboarding-two-paths-20260911` | 删付费验证 / 自动适配 / 单向门 | **push 前已 fetch 核对（c6c98d797）：目前是 docs-only**（plan + 两份类根因合同），还没有免费自检函数可以对。所以 `check_connection` 复用主进程既有的 `discoverHttpCandidates` 探针（不发任何生成请求），它落地后换成它的函数即可，语义已经一致 |

**与那条分支的不变量是同一条，从两侧写**：它的 `2026-09-11-self-check-must-never-demote` 合同写「失败或未完成的检查绝不减少一个模型已发布的模式」「检查不发生成请求，所以失败不会花用户的钱」；
本方案的门岗 O1（无 spend）与 O6（`show_models` 的实现路径不得读 `selfCheck`）是同一条不变量的**机器判据**。
两边合并时不需要调和，只需要让 O6 的扫描范围跟着它的发布判据一起走。

## 8. 待拍板（每条带默认）

1. 「未试跑」角标文案与两态成色 —— **默认：先出样张，截图进 PR 给主会话看，接线在拍板后**
2. 对外 MCP 面 15 → 13 个工具（4 换 2，净 +2）—— **默认：本轮全量暴露**，按任务阶段分组暴露登记为实施选项
