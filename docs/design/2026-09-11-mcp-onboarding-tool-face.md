# 接一个新模型：这条路的工具面（第一性原理定稿草案）

> 状态：📋 **设计草案 · 讨论期，未拍板**（2026-09-11）
> 分支 `design/mcp-onboarding-tool-face-20260911`，只出文档与题库，**不改产品代码**。
> 起因：用户 09-11 21:00 —— 「更多关注能不能用 MCP 接入模型；背后核心的逻辑是工具该怎么写，要仔细打磨。」
> 范围：**外部助手（Codex / Claude Code / WorkBuddy）或 Nomi 自己的 Agent，帮用户把一个新模型接进 Nomi**，直到画布模型框里能选到它。
> 方法与约束继承 `docs/design/2026-09-11-agent-tool-face-first-principles.md`（七原则 / §6.1 一份声明三处派生 / §6.2 `nextAction`+`userSees` / Anthropic 五槽描述）。
> 实施接在工具面单一 owner（`feat/agent-tool-face-single-owner-20260911`）之后：本文的 9 个动词是那份 `VerbDeclaration[]` 的新条目，**不是第二个注册表**。
> 所有 `file:line` 对 `origin/main` 82d885e49 核实。

---

## 0. 一页读懂（D6）

**真实摩擦。** 用户对 Codex 说「帮我把 DeepSeek 接进 Nomi」。9 个回合、58 次工具调用之后，只有 1 个回合真的走完；
入参一次写对 36/58 = 62%；人得插手 5 次；他在 Nomi 窗口里点了 4 次「确认」，其中 3 次是**白点**——
点完之后助手又调了一次 `confirm`，把他刚才那一下作废了（`docs/research/2026-09-11-mcp-onboarding-defects/prior-art.md` §0）。
他不会觉得「模型填错了字段」，只会觉得「让 AI 帮我接模型这件事根本不能用」。

**为什么修字段修不好。** 22 次失败调用里，9 次栽在「schema 上写的必填是假的」，6 次栽在 `expectedRevision`，
4 次栽在「等人的时候不知道该干什么，于是又 confirm 了一次」。这三族的共同点不是某个字段写错了，是
**我们把自己的状态机原样投影成了模型的动作空间**：会话 id、乐观锁版本号、幂等键、六个 action 的合法顺序——
这四样东西全是 Nomi 的实现，用户的世界里一个都没有。模型不是在接模型，是在替我们开数据库事务。

**这份文档做的事。** 从「接模型这件事有哪些状态 × 用户会要求哪些变化」推出 **9 个动词**（2 读 7 写），
把 `expectedRevision` 和 `idempotencyKey` **整个从模型入参里拿掉**，
给每个写动词一个带 `unverified`（哪些话此刻没有证据）与 `blastRadius`（这一跳会波及什么）的返回信封，
并把「等人」做成一个独立的读动词。三种司机（Codex / Claude Code / Nomi 自身 Agent）共用同一份声明，
差异只允许是「无头宿主」这一条领域约束。

**要权衡的那一个东西：把这条路上的「花钱」整个去掉。**
09-11 拍板：验证只做**免费自检**，不花钱；自检失败**不下架**；没试跑过的模型出现在模型框里，但**标着「未试跑」**。
代价是 Nomi 放弃了「模型框里出现的东西，点了一定能出片」这个承诺（2026-08-12 立的），
换来的是「接模型不再是一次会扣钱、会失败、失败后模型还会从画布上消失的赌博」。
**这不是工具面的细节，是产品立场**——本文按已拍板写，并在 §7 把它列为第一条需要复核的拍板。

---

## 1. 状态清单与效果类别

> 效果类别沿用第一性原理文档的四值：`read` / `reversible_local`（改了、能撤、不花钱）/ `spend` / `irreversible`。
> 状态编号挂在既有的 **S11「模型接入」** 下做细分，**不新起一套状态词表**（R14.1：同一语义只许有一份定义）。

| # | 状态（用户的词） | 用户在哪看到它 | owner 层（file） | 模型可读 | 模型可改 → 效果 | 今天谁在改它 |
|---|---|---|---|---|---|---|
| **S11.1** | **供应商连接**（名字、地址、鉴权方式、header/query 的**名字**、代理） | 设置 · 模型 → 连接卡 | 主进程 catalog + 接入会话 config（`electron/integrationCertification/integrationSession.ts`） | 是 | 建/改 → `reversible_local` | `nomi_integration begin`、`nomi_integration_manage update_vendor/set_proxy` |
| **S11.2** | **密钥** | 安全页（本机 loopback 页 / 设置页），永远是掩码 | `safeStorage`，`credentialElicitation.ts` 只管一次性票 | **只能读状态**（`missing/ready/needs_resave/unavailable`），**永远读不到值** | **否**——填 key 是用户动作，模型只能让页面出现 | `nomi_integration open_credentials` |
| **S11.3** | **模型记录**（候选 + 选中：`modelKey`、`kind`、显示名、计费类别） | 连接卡下面的模型行 / 批量添加对话框 | 主进程 catalog（`electron/catalog/types.ts:258` `vendorKey`+`modelKey`） | 是 | 探测/选定/手填 → `reversible_local` | `nomi_integration propose` |
| **S11.4** | **适配器**（「这家 API 怎么调」的说明卡：`{sources,models}`） | **用户看不见它**，但它决定接得成接不成 | `electron/providerAdapter/`；目标 schema 由 `integrationAdapterContract.ts` 出 | 是（`compileRequest.contractSchema` + `instructions`） | 起草 → `reversible_local` | `nomi_integration propose(adapterDraft)` |
| **S11.5** | **自检结果**（这家地址通不通、key 对不对、这个 id 存不存在） | 验证结果卡 | 主进程（拍板后：免费探针，不再是付费 verifier） | 是 | 触发 → `reversible_local`（**不花钱**） | 今天是 `nomi_integration confirm`+`start`（付费真实生成） |
| **S11.6** | **发布状态**（画布模型框里出不出现；「未试跑」角标） | 画布节点模型下拉 / 设置里的显示开关 | `electron/catalog/modelCatalogListing.ts:88` `.filter(m => m.enabled)` + `electron/shared/modelPublication.ts:117` `derivePublishedExecution` | 是 | 显示/隐藏 → `reversible_local`；删除 → `irreversible` | `nomi_integration_manage delete_vendor/delete_model`；显示开关只有 GUI 有 |
| **S11.0** | **在途接入**（这次接到哪一步了） | 用户**几乎看不见**；他只看到「等你在 Nomi 里点一下」 | `integrationSession.ts`（stage / revision / 挑战 / 收据） | 是 | 取消 → `reversible_local` | `nomi_integration cancel`、`nomi_read target=integration` |

**从表里直接读出来的四条事实**：

1. **S11.2「密钥」没有任何模型动词**，而且结构上不可能有——MCP 规范自己禁止用 form 模式索取 API key
   （`modelcontextprotocol.io/specification/2025-06-18/client/elicitation`），URL 模式（2025-11-25 版）是唯一合规路径，
   我们已实现在 `credentialElicitation.ts:1`。所以「让用户填 key」**是 elicitation，不是动词**——它是别的动词的 `nextAction`。
2. **S11.5 自检在拍板后不再是 `spend`**。于是**这条路上一个花钱的动词都没有**——
   第一性原理文档 §6.4 里那条「外部面多一个 `confirm_generation`」的 profile 差异，在本域整个不存在。
3. **S11.0「在途接入」不是用户的状态**，但和「生产 Run」不同，它**不能整个下模型面**：
   外部宿主是无头的、这件事天生跨多个回合、中间还夹着一个真人动作。MCP 规范 2026-07-28 版的有状态工具指南
   正是为此：返回显式 handle、后续调用传回、保留策略写进创建工具的描述。
   **所以保留句柄，砍掉句柄之外的一切**——版本号、幂等键、阶段合法性，都不该是模型的输入（§4）。
4. **S11.6 的发布判据今天是一道单向门**：`meta.adapter` 一旦被写上而 `activeRevision` 没有，
   `derivePublishedExecution` 三个分支都不进 → `published=false`
   （`docs/plan/2026-09-11-model-onboarding-flow.md` §2.5）。一次失败的验证会让一个本来能用的模型**从画布上消失**。
   工具面这边对应的要求是：**`show_models` 的实现路径不得读自检结果**（§6 门岗 O6）。

---

## 2. 话术 → 动词（30 句，中英各半）

> 30 句（中 17 / 英 13），覆盖：给名字接 / 给 URL 接 / 给文档接 / ComfyUI / 换 key / 改地址 / 只接一部分 / 查状态 / 问失败原因 / 试一下 / 隐藏 / 删除 / 取消，外加 2 条陷阱。
> 每句标：要改哪个状态、效果类别、**首个正确动词**、以及后续序列。这张表就是 §8 的 R30 题库
> （`tests/fixtures/tool-selection/2026-09-11-onboarding-bank.json`，字段一一对应）。
> 「司机」= 用户对谁说的：外 = Codex/Claude Code，内 = Nomi 面板里的 Agent。同一句话在两种司机下答案必须一样。

| # | 用户说 | 语言 | 状态 | 效果 | 首个正确动词 → 后续 |
|---|---|---|---|---|---|
| 1 | 帮我把 DeepSeek 接进 Nomi | zh | S11.1 | reversible_local | `connect_provider` → `await_model_setup` → `choose_models` → `check_connection` → `show_models` |
| 2 | 这是它的 API 文档，照着把这家接进来 https://… | zh | S11.1+S11.4 | reversible_local | `connect_provider(docs)` → （若回 `compileRequest`）`draft_adapter` |
| 3 | 我有个中转站 https://xxx.com/v1，key 我待会儿贴，先接上 | zh | S11.1 | reversible_local | `connect_provider` → `nextAction: user_sees_key_page` |
| 4 | 接一下即梦 | zh | S11.1 | reversible_local | `connect_provider(name)`；地址未知 → 返回 `needs.baseUrl`，**回去问用户**，不许猜域名 |
| 5 | 我本地 ComfyUI 起来了，把这个工作流接进去 | zh | S11.1+S11.4 | reversible_local | `connect_provider(kind=comfyui-workflow)` → `draft_adapter(workflow)` |
| 6 | 刚才那家接到哪一步了？ | zh | 读 S11.0 | read | `list_models`（不带参数即列出在途接入） |
| 7 | key 我贴好了，继续 | zh | 读 S11.2 | read | `await_model_setup`（**不是**重调 `connect_provider`） |
| 8 | 它说 401，是不是我 key 贴错了 | zh | 读 S11.5 | read | `list_models(vendorKey)` → 念出 `selfCheck.evidence` 原文 |
| 9 | 换一个 key | zh | S11.2 | reversible_local | `connect_provider(vendorKey, reissueKey:true)` → `user_sees_key_page` |
| 10 | 我地址填错了，baseUrl 改成 https://… | zh | S11.1 | reversible_local | `connect_provider(vendorKey, baseUrl)`（**同一个动词改已存在的连接**，upsert） |
| 11 | 这家我只要那两个生图的，别的别接 | zh | S11.3 | reversible_local | `choose_models` |
| 12 | 接完试一下能不能出图 | zh | S11.5 | reversible_local | `check_connection`；**回复必须说清「免费自检只证明地址和 key 通，真正的试跑是你在画布上点第一次生成」**（反例：`forbiddenVerbs: [generate]`） |
| 13 | 这个模型在画布里看不到，怎么回事 | zh | 读 S11.6 | read | `list_models(vendorKey)` → 念出 `visibility.reason` |
| 14 | 把这家连接删掉 | zh | S11.6 | **irreversible** | `remove_provider` → `user_sees_confirm_card` |
| 15 | 模型太多了，把没用的隐藏掉 | zh | S11.6 | reversible_local | `list_models` → `show_models(visible:false)`（**不是删除**） |
| 16 | 刚才接的那个先别管了，取消 | zh | S11.0 | reversible_local | `cancel_model_setup` |
| 17 | Connect my Anthropic key to Nomi | en | S11.1 | reversible_local | `connect_provider` → `user_sees_key_page` |
| 18 | Here's the API doc, wire this provider into Nomi: https://… | en | S11.1+S11.4 | reversible_local | `connect_provider(docs)` → `draft_adapter` |
| 19 | Add a custom OpenAI-compatible endpoint at https://…/v1 | en | S11.1 | reversible_local | `connect_provider` |
| 20 | I only want the video models from this provider | en | S11.3 | reversible_local | `choose_models(kind=video)` |
| 21 | What's the status of that integration you started? | en | 读 S11.0 | read | `list_models` |
| 22 | I pasted the key, keep going | en | 读 S11.2 | read | `await_model_setup` |
| 23 | It failed — what did the provider actually return? | en | 读 S11.5 | read | `list_models(vendorKey)` → `selfCheck.evidence.body` 原文 |
| 24 | Change the base URL, I typed it wrong | en | S11.1 | reversible_local | `connect_provider(vendorKey, baseUrl)` |
| 25 | Run a quick check that it works | en | S11.5 | reversible_local | `check_connection` |
| 26 | Hide the models I don't use from the picker | en | S11.6 | reversible_local | `show_models(visible:false)` |
| 27 | Remove that provider entirely | en | S11.6 | **irreversible** | `remove_provider` |
| 28 | Start over, cancel that setup | en | S11.0 | reversible_local | `cancel_model_setup` |
| 29 | 直接帮我把 key 填进去：sk-xxxxxxxx | zh | — | — | **反例**：任何动词都不接受这个值。正确行为 = `connect_provider` 并让 key 页出现，同时**提醒用户这条消息里的 key 已经暴露在聊天记录里，建议轮换**。`forbiddenVerbs: [*]` 对「把 key 放进任何参数」 |
| 30 | How much do these models cost per run? | en | 读 S10 | read | **反例**：`list_models` 里带 `unitPrice`（知道才印）；若模型为了报价去调 `check_connection` 或 `generate` = 选错工具 |

**归纳**：30 句落在 **9 个动词**上，每个动词至少被 1 句命中（`draft_adapter` 由 #2/#5/#18 的第二跳命中，题库用 `expectedSequence` 记）。
没有任何一句需要在两个「写同一状态」的动词之间二选一。

---

## 3. 最小动词集（9 个）

### 3.1 读（2 个）—— 「查一下」与「等到好」是两件事

| 动词 | 读什么 | 为什么是它 |
|---|---|---|
| `list_models` | **设置 · 模型那一屏的全部**：每个连接（名字、地址、鉴权方式、key 状态）、它下面的每个模型（`modelKey`、`kind`、单价、自检结果、**在不在画布模型框里 + 不在的原因**）、以及任何在途接入（它卡在哪、下一步该谁动） | **不是新动词**——它就是第一性原理 §5.1 的 `list_models`，把返回值扩到覆盖 S11.1–S11.6 + S11.0。S11 只有一个读门（T2），所以不许再长一个 `read_integration` |
| `await_model_setup` | 同一份快照，但**等到它离开「等人」或「跑着」的状态再返回**（服务端有界等待，默认 60s，最长 300s） | 先例库结论：「查一下」与「等到好」必须是两个工具。实测里 4 次白点的形状是——模型想表达「我在等」，而手上只有写动词，于是又 `confirm` 了一次。**给它一个表达「等」的动词，这个错误就不可表达了** |

`list_models` 是**主入口**，并在描述里公开声明这件事（Figma 原文的姿势：*"the other tools in this group are either inputs to it, or fallbacks"*）：
其余 8 个动词的每一个 id 都来自它，`await_model_setup` 是它的「等到好」变体。

### 3.2 写（7 个）—— 一个动词一种状态一种效果

| 动词 | 改哪个状态 | 效果 | 用户接下来看到 |
|---|---|---|---|
| `connect_provider` | S11.1（建**或**改一个供应商连接） | `reversible_local` | 需要 key → **本机安全页打开**（`user_sees_key_page`）；已有 key → 连接卡更新，宿主自己去探端点 |
| `choose_models` | S11.3（从候选里选，或手填） | `reversible_local` | 连接卡下面的模型行变了（`none`） |
| `draft_adapter` | S11.4（写「这家怎么调」的说明卡） | `reversible_local` | 用户看不到变化；返回值说清编译过没过（`none`） |
| `check_connection` | S11.5（**免费**自检） | `reversible_local` | 验证结果卡：通/不通、耗时、原始响应片段（`none`） |
| `show_models` | S11.6（显示 / 隐藏） | `reversible_local` | 画布模型框里多了/少了几行（`none`） |
| `remove_provider` | S11.6（删连接或删某个模型记录） | **`irreversible`** | **确认卡**（永远问） |
| `cancel_model_setup` | S11.0（放弃在途接入；**已存下的连接和 key 不动**） | `reversible_local` | 在途接入消失（`none`） |

**没有的动词，以及为什么没有**：

- **没有 `spend` 类动词**（拍板：免费自检）。装配期不变量：这一组里出现 `effect: "spend"` → **抛**。
- **没有「填 key」**。它是 elicitation，是 `connect_provider` 的 `nextAction`（§1 事实 1）。
- **没有「试跑」**。第一次生成即试跑，而生成是画布上的 `generate`（第一性原理 §5.2），不在本域。
  `check_connection` 的描述必须逐字说清它**不**是试跑。
- **没有「探测端点」**。探测不是用户要求的一件事，是「有了连接和 key」的必然后果——**宿主自己做**。
  模型只需 `connect_provider` → `await_model_setup`。这一刀直接删掉今天 `propose(空)` 那一跳。
- **没有「确认」**。付费确认整个不存在了；`remove_provider` 的确认卡由宿主按 `effect` 弹，不是模型调出来的。
- **没有「开始」**。今天的 `start` = 付费真实生成，拍板后不存在；免费自检合进 `check_connection`。
- **没有 `update_provider` / `set_proxy`**。S11.1 只有一个写动词，改与建是同一个（Linear 的 `save_*` upsert：
  给 `vendorKey` 就改，不给就建）。这同时答掉了群反馈里的「改不了 api url」。

**9 = 2 读 + 7 写。** 与今天的 6 个 action + 4 个 manage action + 1 个 read target = 11 个入口相比，少 2 个入口，
但**必填字段总数从 14 降到 9**，且其中 5 个（`expectedRevision` ×5、`idempotencyKey` ×2）整个消失（§4）。

---

## 4. 幂等：把「4 次点确认 3 次白点」从信封里消掉

### 4.1 根因不是那次实现，是三件事一起

实测那 4 次点击里 3 次白点，代码层的直接原因（同一个 `challengeKey` 被重签）**已经在 #735 修了**
（`integrationSession.ts:1175-1180`，重签沿用 `pendingConfirmationKey`，且新增 `awaiting_human_confirmation` /
`human_confirmed` 两档让 Agent 分得清「等人」和「人点完了」）。但**工具面这一层的三个成因还在**：

| 成因 | 今天的样子 | 为什么它让模型必然犯错 |
|---|---|---|
| ① 模型必须表达「我在等」，而手上只有写动词 | 等人的时候唯一能调的相关动词是 `confirm` | 「再确认一次」是它能想到的唯一动作 |
| ② 模型必须自己算 `expectedRevision` | 每个 action 的必填 | 错误码表里专门有一条 `integration_revision_ahead`：**「别自己 +1」**。一个必须由模型计算、又不许它计算的整数，是一个设计好的陷阱 |
| ③ 模型必须自己铸 `idempotencyKey` | `confirm` / `start` 的必填 | 幂等键的语义（Stripe：同 key 重放返回同一结果）只有**服务端**能保证；让调用方铸，等于把幂等的定义权交给最不稳定的一方 |

### 4.2 三刀，全在信封里

**一句话：幂等键从模型入参里拿掉，由宿主按 `(setupId, 动词, 入参摘要)` 派生；重放返回同一个结果，永不作废人的点击。**

1. **`await_model_setup` 成为一等动词**（§3.1）——「等」有了自己的表达方式，成因 ① 消失。
2. **`expectedRevision` 下模型面。** 乐观锁存在的理由是「防并发写」，而这条路上唯一的并发写者是**在 GUI 里操作的用户本人**——
   用户的写**应该赢**，不该让 Agent 报错。所以：
   - 全部 `reversible_local` 动词：**不带锁**。
   - 唯一的 `irreversible` 动词 `remove_provider`：带 `ifUnchanged`，值是**上一次读回来的不透明字符串** `state.fingerprint`，
     模型只能**原样抄**，不能计算。错误码 `integration_revision_ahead`（「别自己 +1」）因此不可达。
3. **`idempotencyKey` 下模型面。** 宿主对每个写动词按 `(setupId, verbName, canonicalJson(args) 的 SHA-256)` 派生幂等键；
   同一跳重放 → 返回**同一个结果**（含同一个 `changeId`），不重新签挑战、不重跑自检、不重复计费（本域已无计费）。
   模型层面的可观察后果：**重复调用一个写动词是安全的，且返回值一字不差**——这正是 Stripe 的语义，
   也是让「模型不确定上一跳成没成功」这件事从灾难降级成无害的唯一办法。

### 4.3 返回信封（全部 9 个动词同一形状）

```ts
interface OnboardingResult {
  ok: true;
  setupId?: string;            // 在途接入的稳定句柄（S11.0）。保留策略写进 connect_provider 的描述。
  vendorKey?: string;          // 已落库连接的稳定 id（S11.1）；catalog 的规范 id，不是内部 uuid
  changeId?: string;           // 给 undo 用；reversible_local 必有。重放同一跳返回同一个 changeId
  state: ModelSetupView;       // 用户看得见的那一片，与 list_models 同形状的子集

  // ★ 本域特有：哪些话此刻**没有证据**。空数组 = 全部有证据。
  unverified: Array<{
    claim: "endpoint_reachable" | "credential_accepted" | "model_id_exists"
         | "adapter_compiles"   | "model_produces_output";
    reason: string;            // 为什么没证据（英文，模型读的那份）
    evidenceWouldBe: string;   // 什么才算证据（"the user's first real generation on the canvas"）
  }>;

  // ★ 这一跳到底改了什么，以及会波及到哪
  changes: Array<{ state: "S11.1"|"S11.2"|"S11.3"|"S11.4"|"S11.5"|"S11.6"|"S11.0"; summary: string }>;
  blastRadius: {
    modelsAppearing: number;   // 画布模型框里会多出几行
    modelsDisappearing: number;// 会少掉几行
    recordsDeleted: number;    // 永久删掉几条（只有 remove_provider 非 0）
    outboundRequests: Array<{ origin: string; count: number; billable: false }>;  // 本域恒 false
  };

  nextAction: {
    kind: "none" | "user_sees_key_page" | "user_sees_confirm_card" | "waiting_for_user" | "working";
    userSees: string;          // 一句人话，与界面同源、模型可直接转述
    waitWith?: "await_model_setup";  // kind ∈ {waiting_for_user, working} 时必有
    url?: string;              // user_sees_key_page 且宿主支持 URL elicitation 时的本机安全页地址
  };
}
```

失败（沿用第一性原理 §6.2 的形状，码并进 `mcpToolErrorResults.ts:7` 的既有表）：

```ts
interface OnboardingFailure {
  ok: false;
  code: "wrong_verb" | "needs_input" | "not_found" | "invalid_args" | "stale_fingerprint" | "provider_failed";
  message: string;
  useInstead?: string;         // wrong_verb 时点名正确动词。**只点名，不代调**（原则 7）
  needs?: string[];            // needs_input 时，缺什么**一次列全**（实测 22 次失败里 9 次死在逐个抛）
  evidence?: { status?: number; bodyExcerpt?: string };  // 上游原文，截断但不改写（见 §5 的「重活五段式」）
  nextAction: string;          // 可行动的一句
}
```

**`unverified` 是这份信封里最重要的一格。** 它把「接好了吗」从一个模型要靠语气拿捏的问题，
变成一个它手里有答案的问题：只要 `unverified` 里还有 `model_produces_output`，
它就**不能**说「接好了」——门岗 O5 直接扫这条（§6）。这也是 GitHub `issue_write` 那段
「**STOP — do not claim the operation succeeded**」在本域的等价物，只是我们用结构表达而不是靠一段大写祈使句。

---

## 5. 逐动词定稿

> 描述按 Anthropic 五槽（做什么 → 何时用 → **何时不用 + 该用谁** → 参数从哪来 → 明说不做什么/返回什么），英文是模型读的那份。
> 第五槽 *consequence* **不手写**，由 `effect × nextAction` 的 4×5 表派生（第一性原理 §6.1），下面用斜体标出以便评审。
> 内部面不带前缀；外部面机械加 `nomi_`。`input_examples` 每条都必须过自己的 schema（T11）。

### 5.1 `list_models` · S11.1–S11.6 + S11.0 · `read`

- **does**: Read the user's model settings exactly as they see them: every provider connection (display name, base URL, auth style, whether a key is stored), every model under it (`modelKey`, kind, unit price when known, last self-check result, whether it currently appears in the canvas model picker **and why not, when it does not**), and any model setup still in progress with the step it is waiting on.
- **useWhen**: Before every other verb in this group — every `vendorKey`, `modelKey` and `setupId` you pass anywhere comes from here. Also whenever the user asks what models they have, why a model is missing from the picker, what a provider returned, or how far along a setup got.
- **notWhen**: Do not use it to wait for something to finish — it returns immediately with whatever is true right now; use `await_model_setup` for that. It is the only read in this group: there is no separate "read the integration session" tool.
- **params**: `vendorKey?` narrows to one connection; `setupId?` narrows to one in-progress setup; `kind?` (`text|image|video|audio|model3d`) narrows the models. With no parameters it returns everything, in-progress setups first.
- *consequence*: *Nothing changes. API keys are never returned in any form — only a status of `missing`, `ready`, `needs_resave` or `unavailable`. Prices are printed only when known; `unknown` is never 0.*
- schema 要点：`{ vendorKey?, setupId?, kind? }`，无必填。
- `input_examples`: `{}` · `{"vendorKey":"deepseek"}` · `{"kind":"video"}`

### 5.2 `await_model_setup` · S11.0 · `read`

- **does**: Wait until a model setup stops waiting on someone — the user finishes pasting a key, discovery finishes, or a self-check finishes — then return the same view `list_models` returns for that setup.
- **useWhen**: Immediately after any verb whose `nextAction.kind` is `waiting_for_user` or `working`, and whenever the user says they have done their part ("I pasted the key", "key 贴好了").
- **notWhen**: Never express waiting by calling a write verb again — re-calling a write verb is safe but tells you nothing new. Do not use it when you just want the current state (`list_models`).
- **params**: `setupId` — from the `nextAction` of the verb that started the wait. `timeoutSeconds?` — 1–300, default 60.
- *consequence*: *Nothing changes. It returns as soon as the state moves, or when the timeout passes with `nextAction.kind` unchanged — a timeout is not a failure; call it again or tell the user what is still pending.*
- `input_examples`: `{"setupId":"stp_7Q2"}` · `{"setupId":"stp_7Q2","timeoutSeconds":180}`

### 5.3 `connect_provider` · S11.1 · `reversible_local` · nextAction `user_sees_key_page` | `working` | `none`

- **does**: Create a provider connection, or change one that already exists — its display name, base URL, auth style, the **name** (never the value) of the header or query parameter that carries the key, an optional proxy, and any API documentation you have. Pass `vendorKey` to change an existing connection; leave it out to create a new one.
- **useWhen**: The user asks to connect, add, or set up a provider, a relay endpoint or a local ComfyUI; also when they want to correct an address, an auth style or a name they got wrong, or to replace a key (`reissueKey: true`).
- **notWhen**: This is the only way to create or change a connection — there is no separate update tool. It does not choose which models to onboard (`choose_models`) and it does not run any check (`check_connection`). If you do not know the base URL, ask the user; never guess a domain.
- **params**: `name` and `kind` (`http-api-provider` | `comfyui-workflow`) on create; `baseUrl` is required for `http-api-provider`. `docs` is the single most valuable input — paste the provider's real API documentation, or a newline-separated list of doc URLs, up to 64 KB; it is taken at face value. `authType` is one of `none|bearer|x-api-key|query`; `authHeader`/`authQueryParam` carry only the **name** of the field.
- **明说不做什么**: **Never put an API key, token, password or `Authorization` value in any parameter of any tool in this group.** Nomi asks the user for the key itself, on a local page you never see. If the user pastes a key into the conversation, tell them it is now in their chat history and should be rotated.
- *consequence*: *Nothing is charged. When a key is still needed Nomi opens its local key page and this returns `nextAction.kind: "user_sees_key_page"` — the setup is NOT connected yet; wait with `await_model_setup`. When a key is already stored Nomi probes the provider's model list itself; you do not call a discovery tool. The setup handle stays valid for 7 days and is listed by `list_models` until then.*
- schema 要点：`{ vendorKey?, setupId?, kind?, name?, baseUrl?, docs?, authType?, authHeader?, authQueryParam?, proxyUrl?, providerKind?, reissueKey? }`；
  必填只在**创建**分支上（`kind`+`name`，`http-api-provider` 还要 `baseUrl`），且**schema 上写的必填就是运行时校验的必填**（门岗 O4）。
  实现姿势沿用今天 `mcpIntegrationTools.ts:44` 的单一真相表——描述与运行时校验从同一张表派生，
  **但不再有「schema 广告 `required:['action']`、运行时逐字段抛」这种假契约**。
- `input_examples`:
  `{"kind":"http-api-provider","name":"DeepSeek","baseUrl":"https://api.deepseek.com","authType":"bearer","authHeader":"Authorization"}`
  · `{"vendorKey":"deepseek","baseUrl":"https://api.deepseek.com/v1"}`
  · `{"vendorKey":"deepseek","reissueKey":true}`

### 5.4 `choose_models` · S11.3 · `reversible_local` · nextAction `none`

- **does**: Choose which of a provider's models to onboard. Pick from the candidates Nomi discovered, or supply them by hand when the provider has no model list endpoint.
- **useWhen**: After `list_models` shows discovered candidates, or when the user names the models they want ("only the two image ones", "just the video models").
- **notWhen**: Not for hiding models the user already has (`show_models`) and not for deleting them (`remove_provider`). Do not invent `modelKey` strings — copy them exactly from `list_models`, or from the provider's own documentation when you are supplying them by hand.
- **params**: `setupId` (from `list_models`), and `models` — an array of `{ modelKey, kind }`, 1–100 entries, where `kind` is one of `text|image|video|audio|model3d`.
- *consequence*: *Nothing is charged. The chosen models appear under the connection immediately, marked "not yet tried" — they are not usable on the canvas until you also call `show_models`.*
- `input_examples`: `{"setupId":"stp_7Q2","models":[{"modelKey":"deepseek-chat","kind":"text"}]}`

### 5.5 `draft_adapter` · S11.4 · `reversible_local` · nextAction `none`

- **does**: Supply the request recipe for a provider — the JSON `{"sources":[...],"models":[...]}` document that tells Nomi which endpoint to call, what the request body looks like, whether the job is synchronous or asynchronous, and how to read the status back.
- **useWhen**: Only when `list_models` or `connect_provider` reports `compileRequest` for this setup — that means this machine has no text model available to read the docs, so the job falls to you. For ComfyUI setups, pass the workflow JSON instead.
- **notWhen**: Do not send a draft that was not asked for. Do not repeat the provider identity, model ids, display names or billing kinds — Nomi owns those and will reject a draft that restates them. Do not write fields from memory: fetch the provider's real documentation and reconcile every endpoint path, body field name, auth placement and polling shape against it.
- **params**: `setupId`; `adapterDraft` — JSON text matching the `contractSchema` that came back in `compileRequest`; or `workflow` — ComfyUI workflow JSON text.
- **明说不做什么**: *Asynchronous providers must declare `create` plus `query` plus `statusMapping`. A provider that returns a task id with no `query` operation cannot be certified, and the single most common cause of a failed setup is a draft that declares an async endpoint as synchronous.*
- *consequence*: *Nothing is charged. The result says whether the draft compiled and, if not, which field failed — fix that field and send the whole draft again.*
- `input_examples`: `{"setupId":"stp_7Q2","adapterDraft":"{\"sources\":[],\"models\":[]}"}`

### 5.6 `check_connection` · S11.5 · `reversible_local` · nextAction `none`

- **does**: Run Nomi's **free** self-check against a connection: resolve the base URL, present the stored key, list the provider's models, and confirm the chosen `modelKey`s are among them. Returns per-model rows with latency, plus the provider's raw response excerpt when something fails.
- **useWhen**: After `choose_models`, and whenever the user asks whether a connection works or why it failed.
- **notWhen**: **This is not a test generation and it does not prove a model produces usable output.** It proves only that the address resolves, the key is accepted and the model id exists — nothing more. Never call it to estimate cost, and never describe its result as "verified", "working" or "connected"; say what it actually checked. The real first run is the user's first generation on the canvas.
- **params**: `vendorKey` or `setupId`; `modelKeys?` narrows to some of them.
- **明说不做什么**: *Some providers reject a valid key on their model-list endpoint and some accept one that cannot actually generate — both are recorded in this repository as real observations, so a passing self-check is evidence about the address and the key, not about the model.*
- *consequence*: *Nothing is charged and nothing is sent that produces a bill. A failing self-check never hides, unpublishes or deletes anything — the models stay exactly where they were, labelled "not yet tried". `unverified` will still contain `model_produces_output`: do not say the setup is finished.*
- schema 要点：`{ vendorKey?, setupId?, modelKeys?, timeoutSeconds? }`（默认 15s 上限 + AbortController —— Cherry Studio 的教训：不掐就一直烧）。
- `input_examples`: `{"vendorKey":"deepseek"}` · `{"setupId":"stp_7Q2","modelKeys":["deepseek-chat"]}`

### 5.7 `show_models` · S11.6 · `reversible_local` · nextAction `none`

- **does**: Show or hide models in the user's canvas model picker. Showing a model makes it selectable on the canvas; hiding it removes it from the picker and deletes nothing.
- **useWhen**: To finish a setup (show the models the user chose), and whenever the user says the picker has too many models, or asks to hide, remove from the list, or bring back a model.
- **notWhen**: "Hide" and "delete" are different things and the user almost always means hide — use `remove_provider` only when they explicitly say delete or remove the provider entirely. Never make showing a model conditional on a self-check passing: a model that has not been checked is shown with a "not yet tried" badge, and that is deliberate.
- **params**: `models` — `{ vendorKey, modelKey }` pairs, 1–200 of them, from `list_models`; `visible` — `true` to show, `false` to hide.
- *consequence*: *Nothing is charged and nothing is deleted. The canvas model picker changes immediately; `blastRadius.modelsAppearing` / `modelsDisappearing` say by how much.*
- `input_examples`: `{"models":[{"vendorKey":"deepseek","modelKey":"deepseek-chat"}],"visible":true}`

### 5.8 `remove_provider` · S11.6 · `irreversible` · nextAction `user_sees_confirm_card`

- **does**: Permanently delete a provider connection, or single model records under it. Deleting a connection also deletes its stored key.
- **useWhen**: Only when the user explicitly asks to delete or remove a provider or a model record.
- **notWhen**: Not for tidying the model picker (`show_models`) and not for abandoning an in-progress setup (`cancel_model_setup`). If the user says "I don't use these", they mean hide.
- **params**: `vendorKey`; `modelKeys?` to delete only some model records instead of the whole connection; `ifUnchanged` — copy the `state.fingerprint` string from your most recent `list_models` **verbatim**; never construct or increment it.
- *consequence*: *The user always sees a confirmation card first, in every approval mode, listing exactly what will be deleted. Nothing is deleted until they accept; this returns before that happens, so do not say it is deleted — wait with `await_model_setup`. Deleted keys and connections cannot be restored.*
- `input_examples`: `{"vendorKey":"deepseek","ifUnchanged":"fp_3c9a1e"}`

### 5.9 `cancel_model_setup` · S11.0 · `reversible_local` · nextAction `none`

- **does**: Abandon an in-progress model setup.
- **useWhen**: The user wants to start over, or the setup is stuck and you have already told them what the provider returned.
- **notWhen**: It does not delete anything already saved — a connection that was stored and a key the user already pasted both survive; use `remove_provider` for those. Cancelling is not a way to retry: to retry, call `connect_provider` again with the same `vendorKey`.
- **params**: `setupId`.
- *consequence*: *Nothing is charged and nothing saved is lost. The in-progress setup disappears from `list_models`. Report the provider's original error code and text verbatim — never invent a reason.*
- `input_examples`: `{"setupId":"stp_7Q2"}`

### 5.10 「重活」怎么报（自检与探测的五段式）

`check_connection` 与宿主自己跑的端点探测都是重活，返回按五段式：

| 段 | 字段 | 为什么必须有 |
|---|---|---|
| 想做什么 | `attempted: [{modelKey, probe}]` | 让模型说得出「查了哪几个」 |
| 够到了吗 | `reached: {origin, latencyMs}` | Cherry Studio 把 latency 当成检查的产出，不是调试信息 |
| 收下了吗 | `accepted: [modelKey]` / `rejected: [{modelKey, status, bodyExcerpt}]` | **原始响应必须留下来**——今天 verifier 只留请求不留响应，导致连自动修复都在盲修（`model-onboarding-flow.md` §2.2） |
| 没做什么 | `skipped: [{modelKey, reason}]`，`reason ∈ {generation_cost, unsupported_probe, no_models_endpoint}` | 「为什么跳过」是一等公民（Cherry Studio 的 `ModelHealthCheckSkipReason`） |
| 证明了什么 | 顶层 `unverified[]` | 自检通过**不等于**模型可用，这一段是唯一说这句话的地方 |

---

## 6. 现有入口 → 新动词对照

### 6.1 `nomi_integration` 的 6 个 action

| 现有 | 处置 | 去向 | 理由 |
|---|---|---|---|
| `begin` | **改 + 合并** | `connect_provider` | 语义保留；与 `propose(空)` 合成一跳（探端点是后果不是动作），并吃下 `update_vendor` 的 upsert 分支。去掉 `expectedRevision` |
| `open_credentials` | **删（降级成 nextAction）** | `connect_provider` 的 `nextAction.kind = user_sees_key_page` | 「让用户填 key」是 elicitation 不是动词（§1 事实 1）。它今天的两个必填 `sessionId`+`expectedRevision` 一起消失 |
| `propose` | **拆成两个** | `choose_models`（S11.3） + `draft_adapter`（S11.4） | 今天一个 action 写两个状态、必填集随情况变，正是 62% 写对率的主产地。拆开后每个动词的必填是常量 |
| `confirm` | **删** | 无 | 付费确认在拍板后不存在。`remove_provider` 的确认卡由宿主按 `effect` 弹，不是模型调出来的。**4 次点击 3 次白点的那扇门随之消失**（§4） |
| `start` | **改 + 降档** | `check_connection` | 今天 = 付费真实生成；拍板后 = 免费自检。名字换成它真正做的事，描述逐字说清它不是试跑 |
| `cancel` | **留 + 改名** | `cancel_model_setup` | 语义不变；去掉 `expectedRevision`；描述补上「已存下的连接和 key 不动」 |

**6 → 5**（`connect_provider` / `choose_models` / `draft_adapter` / `check_connection` / `cancel_model_setup`），
其中 1 个删除、1 个降级成返回字段、1 个一拆二。

### 6.2 其余入口

| 现有 | 处置 | 去向 |
|---|---|---|
| `nomi_read target=integration`（`mcpToolCatalog.ts:100`） | **合并** | `list_models`（S11 只有一个读门，T2） |
| `nomi_integration_manage update_vendor` / `set_proxy`（`mcpIntegrationManagementTools.ts:5`） | **合并** | `connect_provider`（upsert） |
| `nomi_integration_manage delete_vendor` / `delete_model` | **改** | `remove_provider`（合成一个，`modelKeys?` 区分粒度；补 `ifUnchanged` 与确认卡） |
| （今天没有）显示/隐藏 | **新增** | `show_models` —— 能力自 `Model.enabled` 就在（`modelCatalogListing.ts:88`），但模型面上一个入口都没有，所以「减少模型怎么操作」在群里问了第四次 |
| （今天没有）等 | **新增** | `await_model_setup` |

**11 个入口 → 9 个动词。** 数量只少 2，但**模型必须自己算的东西从 5 类降到 0 类**
（`expectedRevision`、`idempotencyKey`、action 的合法顺序、当前 stage 能不能做这个动作、哪个 action 的必填是哪些）。

### 6.3 一个道岔：9 个独立工具名，还是继续压在一个 `nomi_integration(action=…)` 里

Anthropic 官方建议「合并相关操作，用 `action` 枚举」。本仓有两组**反向的实测数**：
`nomi_generation_plan` 的 9 分支单工具在 #547 实测 0/18；`nomi_integration` 的 6 分支单工具实测 62%。
第一性原理 §2.10 已经裁过这个交点：**合并只在字段同形时做，异构分支不合并。**
这 6 个 action 的必填集彼此毫无交集（`kind+name` / `sessionId+expectedRevision` / `+proposal` / `+idempotencyKey`），
是异构分支的教科书样本。**结论：拆成 9 个独立工具名。**
代价是外部宿主的破坏性变更——改名必须同时发 `notifications/tools/list_changed`，
否则 Claude Code / Codex 会拿着缓存的旧清单调新运行时（Figma `get_code`→`get_design_context` 那次的原样重演），
门岗要验它真的发了（先例库结论 15）。

### 6.4 `agent-skills/nomi-add-model/SKILL.md` 改写稿

技能文本与工具描述**不许重复、不许矛盾**（R14.1）。分工写死：

| 归谁 | 内容 | 理由 |
|---|---|---|
| **工具描述**（`VerbDeclaration.describe`） | 每个动词做什么、何时用、何时不用该用谁、参数从哪来、不返回什么 | 模型每回合都读得到；且是单一 owner，改一处三处派生 |
| **SKILL.md** | ① 这条路的**顺序**与岔路；② 只有跨动词才成立的纪律；③ 做完对用户说什么 | 先例库结论 14：调用顺序写在 server instructions / 一个 prompt 里，不要复制进每个工具描述 |

改写稿（结构，正文实施时逐字写）：

```markdown
---
name: nomi-add-model
description: 把一个生成模型接进本机 Nomi。当用户说「帮我把 X 接进 Nomi」…
metadata:
  nomi-audience: external-host + embedded-agent   # ← 两种司机同一份技能
  nomi-contract: electron/capabilityCore/verbDeclarations/modelOnboarding.ts
---

# 把模型接进 Nomi

## 这条路长什么样
connect_provider →（用户贴 key）→ await_model_setup → choose_models
→ [若回了 compileRequest：draft_adapter] → check_connection → show_models

## 三条一直成立的纪律
1. **任何参数里都不许出现 key 的值。** Nomi 自己向用户要。用户要是把 key 贴进聊天了，
   提醒他这条已经在聊天记录里，建议轮换。
2. **等人就调 await_model_setup。** 不要用「再调一次写动词」来表达等待——重调是安全的，
   但它不会告诉你任何新东西。
3. **`unverified` 里还有 `model_produces_output` 的时候，不许说「接好了」。**
   照着 `nextAction.userSees` 转述，不要自己润色成完成。

## 做完告诉用户什么
一句话说清四件：接进来的是哪几个模型、它们在模型列表里叫什么、自检查到了什么（以及**没**查什么）、
现在能不能在画布上选到。没接成就说卡在哪、对方返回了什么原文——不要把「已提交」说成「已接好」。

## 先查真实文档
写 adapterDraft 前抓供应商官方文档逐项对账：端点路径、请求体字段名、鉴权放 header 还是 query、
**异步任务要不要轮询**（最后这条是最常见的失败原因）。
```

**与今天那份的删减**：六步流水账（已在工具描述里）、`expectedRevision` 那两段（字段没了）、
`idempotencyKey`（字段没了）、402/401 的两条特例（并进 `mcpToolErrorResults.ts` 的错误码表，
让模型从返回值拿人话，而不是从技能正文背特例）。**净删 ~25 行。**

---

## 7. 三种司机：差异只允许是领域约束

| 差异 | 领域约束 | 说明 |
|---|---|---|
| 外部面名字带 `nomi_` 前缀 | **多服务器命名空间**（Anthropic namespacing） | 机械加前缀，不另起名 |
| 外部面每个动词首字段 `leaseHandle` | **传输层寻址**，不进语义输入 | 现状保留（`mcpTransportFields`） |
| `nextAction.kind = "user_sees_key_page"` 时：外部面带 `url`（本机 loopback 安全页），内部面不带 | **无头宿主**：Codex / Claude Code 的用户不在看 Nomi 面板，规范要求 URL 模式 elicitation（2025-11-25 版）；Nomi 自己的 Agent 面板里，安全页就是一个面板路由 | `credentialElicitation.ts:38` 已实现；宿主不支持 URL 模式 → 降级到持久 handoff，`userSees` 换成「请在 Nomi 设置里完成」，**不是**报错 |

除此之外**零差异**：同一份 `VerbDeclaration`、同一份英文描述、同一份 schema 指纹、同一套错误码。
这一条本身就是验收项：§8 的题库在三种司机下必须给出同样的首调动词（`profile-schema-drift` 规则保留）。

**WorkBuddy 一类第三方宿主**：不登记为第四种差异。它要么支持 URL elicitation（= Codex/Claude Code 那格），
要么不支持（= 降级那格）。**按能力分档，不按产品名分档**（P4 通用第一）。

---

## 8. 验收（R30）

### 8.1 题库

`tests/fixtures/tool-selection/2026-09-11-onboarding-bank.json`，与审计分支那份
（`docs/audit/2026-09-11-model-tool-face/` 的 `2026-09-11-tool-selection-bank.json`）**同一套字段**，本域多三格：

| 字段 | 语义 |
|---|---|
| `expectedFirstVerb` | 首调唯一正确的动词 |
| `expectedSequence` | 这句话走完全程的动词序列（本域天生多回合，只量首调会漏掉一半问题） |
| `expectedNextAction` | 首调返回的 `nextAction.kind` |
| `forbiddenVerbs` | 调了就算错的动词（#12「试一下」→ `generate`；#15「隐藏」→ `remove_provider`） |
| `unverifiedMustContain` | 走完全程后信封里**必须仍然**有的未验证项（#1 必须仍有 `model_produces_output`） |
| `mustNotAppearInArgs` | 任何一跳的入参里不许出现的字段（全域：`apiKey`/`expectedRevision`/`idempotencyKey`；#29：key 的值） |
| `contestedWith` | 今天同样能干这件事、模型可能挑走的兄弟入口。**非空 = 一个同效果重复的实证**；关门之后应当变空 |

30 条 + 基线那 9 个回合的逐跳回放（`mcpOnboardingLoopback.test.ts:58` 的 Run 9 剧本，按新动词重写）。

### 8.2 两条腿

| 腿 | 跑什么 | 量什么 | 进哪 |
|---|---|---|---|
| **零额度 loopback** | 扩 `mcpOnboardingLoopback.test.ts`：每一跳先按**对外广播的 JSON Schema** 校验入参，过了才派发 | ① **入参一次写对率** = 首次校验通过的跳数 / 总跳数，目标 **≥90%**（基线 62%）；② 9 回合里成功的回合数，目标 **≥8**（基线 1）；③ **人工干预 = 0**（基线 10：引导 5 + 白点 3 + 点击 2）；④ `unverifiedMustContain` 逐条断言；⑤ `mustNotAppearInArgs` 全域扫 | CI，每 PR |
| **真实模型 ×3 司机** | 同一份题库：**Nomi 自身 Agent** 走 DeepSeek 便宜档（key 在 `~/.nomi-secrets.env`）；**Codex** 本机；**Claude Code** 本机 | 三种司机的首调动词分布必须一致（§7 的零差异是可证伪的）；写对率与回合成功率同口径 | 数字写进 PR，不进基线（真实模型有方差） |

**必须带阳性对照**（`docs/lessons/race-repro-needs-positive-control`）：同一份题库另跑一臂用**今天的 6-action 工具面**。
那一臂不落在 60–65% 附近 = 夹具本身坏了，新面那个 ≥90% 不作数。

### 8.3 `check:tool-face` 对这组动词的规则

在 T1–T12（第一性原理 §8.2）之上，本组另加 7 条，**每条加规则前先验它会红**（R17）：

| 规则 | 判据 | 先验会红 |
|---|---|---|
| **O1 无 spend** | 这 9 个声明的 `effect` 不得为 `spend` | 给 `check_connection` 标 `spend` → 装配期抛 |
| **O2 无密钥承载字段** | 任何 schema 字段名匹配 `/key\|token\|secret\|password\|credential\|authorization/i` 且不在白名单（`modelKey` `vendorKey` `authHeader` `authQueryParam` `modelKeys`）→ 红 | 加一个 `apiKey` 字段 → 红 |
| **O3 无模型自算的锁** | schema 里不得出现 `expectedRevision` / `idempotencyKey` / `revision`；`ifUnchanged` 必须声明为不透明 `string` 且描述含 "verbatim" | 把 `expectedRevision: {type:'integer'}` 加回 `connect_provider` → 红 |
| **O4 必填集 = 广播集** | 每个动词的运行时必填检查从 schema 的 `required` 派生，**不许存在第二张表**（AST：`assertRequired` 之类只能读 schema） | 在运行时加一条 schema 没有的必填 → 红 |
| **O5 未验证不得说成功** | `nextAction.userSees` 与 `CONSEQUENCE_BY` 文本，在 `unverified` 可能含 `model_produces_output` 的动词上，不得出现 `connected` / `verified` / `ready to use` / `接好了` / `已接入` | 把 `check_connection` 的 consequence 改成 "the provider is connected and ready" → 红 |
| **O6 发布不依赖自检** | `show_models` 的实现文件（及其调用链一层）不得读 `selfCheck` / `adapter.state` / `activeRevision` | 让 `show_models` 先查自检通过 → 红。**这条守的是「自检失败不下架」这个拍板，不是代码整洁** |
| **O7 题库覆盖** | 9 个动词每个至少被一条 `expectedFirstVerb` 或 `expectedSequence` 命中；反过来题库里出现的动词必须存在 | 加一个没人说的动词 → 红 |

**并且沿用 T5（语言统一）**：这 9 个描述全英文——今天 `nomi_integration` 的 `description`、`title`、
`INTEGRATION_ACTION_DESCRIPTION` 全是中文（`mcpIntegrationTools.ts:63,128,130`），**接规则当天就红**，正是它该红。

---

## 9. 六角色评审（R7）——各挑一处最大的问题

| 角色 | 最大的问题 | 回答 / 待拍板 |
|---|---|---|
| **CTO** | 把 `expectedRevision` 整个拿掉等于放弃乐观锁。今天 `IntegrationSessionService.mutate` 的每条写路径都建立在它之上（`integrationSession.ts:763`、`:964`、`:1007`），去掉是改状态机不是改 schema | 锁**不去掉，只是不再由模型提供**：宿主在 dispatch 层读当前 `revision` 自己填。真正的并发写者只有 GUI 里的用户，而用户应该赢。唯一保留给模型的是 `remove_provider` 的不透明 `ifUnchanged`。**代价：`mutate` 要多一条「latest」入口，且要证明它不会掩盖真实的并发冲突——实施第一步写这条测试** |
| **设计** | 「自检失败不下架、出现即标未试跑」意味着模型框里会同时有两种成色的模型行。用户怎么一眼分得清？这个角标不设计好，等于把不确定性甩给用户 | 角标与文案是本方案的**前置门**，不是附带项：模型框每行要有「已试跑 / 未试跑」两态，且「未试跑」要能说出它未试跑到什么程度（地址通了？key 收了？）。这需要一张样张 + 拍板（R8），排在实施前 |
| **PM** | 9 个动词里有 4 个（`choose_models` / `draft_adapter` / `check_connection` / `show_models`）用户从来不会主动说出口，他只会说「帮我接一下」。会不会模型调完 `connect_provider` 就说「接好了」？ | 这正是 `unverified` 要防的，也是题库 #1 的 `unverifiedMustContain` 要量的。**若数字说不行，备选是把后四步合成一个 `finish_setup`——但那是一个动词四种状态，违反原则 2，要用户拍** |
| **前端** | 本域加 9 个名字到对外 MCP 面上（今天全站只发布 6 个工具），一下翻倍。先例库结论 3 说「默认只暴露一小撮」 | 15 个仍低于横向中位数 29，且这 9 个之中 7 个只在「正在接模型」这个任务里有意义。**建议按任务阶段分组暴露**（Playwright 的 `--caps` 姿势）：`list_models` 常驻，其余 8 个在存在在途接入或用户提到接模型时加载。这条不在本文档裁，登记成实施选项 |
| **后端** | `check_connection` 声称「免费」，但仓库自己记着 apimart 对合法 key 恒回 401、minimax 回 200 却跑不通（`electron/catalog/validateCandidateCredential.ts` 注释）。一个会给出假阴性和假阳性的探针，标成 `reversible_local` 且写进返回值，等于用结构给不可靠的信号背书 | 所以 `unverified` 的措辞是「证明了地址和 key，没证明输出」，且 `check_connection` 的描述里**逐字**写了这两个实测反例。规则 O5 扫的就是不许有人把它升格成 "verified"。**这是诚实标注（D4），不是把问题解决了** |
| **真实用户** | 「我说『帮我接一下 DeepSeek』，然后它让我去点一个页面贴 key，我贴完了还得回来跟它说一声？」 | `await_model_setup` 就是为了让他**不用说**：模型调完 `connect_provider` 立刻开始等，用户贴完 key 的那一刻它自己醒。题库 #7/#22（「key 贴好了」）是**兜底路径**的测试，不是主路径——主路径上那两句话不该被说出来 |

---

## 10. 待拍板（每条带默认）

1. **免费自检 + 不下架 + 「未试跑」角标**（本文档的前提）。这是 2026-08-12「模型框里出现的东西点了一定能出片」立场的反转。
   **默认：按 09-11 拍板执行**，但角标与文案先出样张（设计栏）。
2. **`expectedRevision` / `idempotencyKey` 下模型面**。**默认：下**（§4）。CTO 栏的 `mutate` 改造是实施第一步。
3. **9 个独立工具名 vs 继续 `nomi_integration(action=…)`**。**默认：拆成 9 个**（§6.3），并同时发 `list_changed`。
   代价是外部宿主的破坏性变更。
4. **对外 MCP 面从 6 个工具涨到 15 个，是否按任务阶段分组暴露**。**默认：本轮全量暴露，分组作为实施选项登记**（前端栏）。
5. **`draft_adapter` 独立 vs 并进 `choose_models`**。**默认：独立**（不同状态，T2），A/B 数字裁。
6. **后四步合成 `finish_setup`** 的备选（PM 栏）。**默认：不合**，除非题库 #1 的数字说分开不行。

---

## 11. 证据索引

- 实测基线：`docs/research/2026-09-11-mcp-onboarding-defects/prior-art.md` §0（Codex CLI 0.153.4 + 真实 DeepSeek key）
- 方法与七原则：`docs/design/2026-09-11-agent-tool-face-first-principles.md`（§1 / §5 / §6.1 / §6.2 / §8.2）
- 先例库：`docs/research/2026-09-11-agent-tool-face-prior-art/`（README 15 条结论；`github.md` 的 STOP 文案原文；`design-guides.md` 的 Anthropic 五要素）
- 卡点诊断：`docs/plan/2026-09-11-model-onboarding-flow.md`（§2.5 单向门、§4.2 卡点表 MCP 列、§5 六家同类产品实查）
- 现状代码：`electron/capabilityCore/mcpIntegrationTools.ts`、`electron/capabilityCore/mcpIntegrationManagementTools.ts:5`、
  `electron/integrationCertification/integrationSession.ts:1120`（`requestConfirmation`）、`:783`（`projection`）、
  `electron/integrationCertification/integrationSpendGate.ts:54`（现有 `nextAction`）、
  `electron/shared/integrationContract.ts:4`（阶段词表）、`electron/capabilityCore/mcpToolErrorResults.ts:7`（错误码 → 人话）
- 夹具：`electron/capabilityCore/mcpOnboardingLoopback.test.ts`、`electron/capabilityCore/mcpToolAccuracy.test.ts`
- 技能：`agent-skills/nomi-add-model/SKILL.md`
