# 外部 AI 经 Nomi MCP 接一个新模型：基线实测

日期：2026-09-10 → 09-11 · 基线 commit `174e3a418`（= origin/main）· 分支 `exp/mcp-onboard-deepseek-20260910`

问题：**外部 AI 宿主能不能靠 Nomi 的 MCP 工具，把一个全新的模型接到能用？**
结论：**能，但要人拽着走**——9 个 agent 回合、58 次 nomi 工具调用、62% 一次写对、5 次人工引导、
4 次窗口点确认（其中 3 次白点）。最后一次是我把每步入参写死喂给它才跑通。不改生产代码，未碰用户真实资料库。

> 口径严格区分 **产品缺陷 / 宿主不支持 / 我操作错**。

## 1. 实验装置

| 项 | 值 |
|---|---|
| 宿主 | Codex CLI `0.153.4`（`codex exec --json`），模型 `gpt-6-astra`（otokapi 中转，本轮可用） |
| 被测 | 本分支 `pnpm build` 产物，MCP 入口 = 产品真实入口 `dist-electron/capabilityCore/mcpNodeLauncher.js` |
| Nomi 实例 | 隔离 profile 的真实 GUI（非 headless），`NOMI_*_DIR` 全在 `/tmp/nomi-mcp-exp` |
| 宿主配置 | 临时 `CODEX_HOME`（`auth.json` symlink），**未改用户 `~/.codex/config.toml`** |
| 任务提示词 | 编排者指定原文 + `api-docs.deepseek.com` 正文（3.7KB） |

**阳性对照**（先证明失败不是 key 的锅）：`GET /models` 200，返回 `deepseek-flash`、`deepseek-v4-pro`；
`POST /chat/completions` 说「你好」有回答。提示词里的 `deepseek-chat` **已经不存在**——正好考验发现步骤能不能纠型号。
DeepSeek 不在内置 18 个 vendor 里，这是一次真正的新接入。

## 2. 断点与根因（按发现顺序）

### ① 1271 字符的不透明句柄过不了模型这一关（Run 2）

`nomi_session_open` 要求把 `nomi_project_create` 签发的 1271 字符 `projectSelectionHandle` 原样回传。
逐字符比对：**回传 1192 字符、第 514 字符起就分歧、相似度 0.692**——不是截断，是模型凭记忆重写。
两次尝试回传同一个错值，重试永远出不来；而错误码 `lease_invalid` 的处置建议是「重新选择项目」，
只会再签一个新句柄让它再抄错一次。**死锁。** 三个 e2e 全部用 JS 变量直传句柄（完美复制），
从没把真实模型放进这个回路——正是 R30 点名的盲区。（绕开：接模型本来就不需要项目。）

### ② schema 的 `required` 在撒谎（Run 3 / 5 / 7，三个独立回合各撞一次）

`nomi_integration` 广告 `required: ['action']`，但 `integrationSession.ts` 逐字段顺序抛错：
`begin` 真实必填 `kind` / `name` / `baseUrl`，`open_credentials` 必填 `expectedRevision`，
`confirm` 必填 `idempotencyKey`。模型严格照 schema 调，于是每个字段烧掉一次完整往返（30–120s/次）。
**22 次失败调用里 9 次是这一类。** 模型没做错任何事。

### ③ 同一句 `revision is stale` 表示四件不同的事（Run 3–7）

`integrationSession.ts:951` 把「你没传这个字段」「你传的值过期了」「并发写冲突」抛成同一句英文裸 Error。
「stale」把 agent 教向「那我别传了」——恰好最错。Run 4 里它靠**猜 +1** 才蒙对。
同一条链上 `lease_invalid` 走中英双语 `mcpToolErrorResults` 表，`Invalid name` 是英文裸 Error，
`这次确认已失效` 又是中文——一个宿主一次会话收到三种语言、两种结构的错误。

### ④ 凭据交接：这一段做对了（Run 3–4）

Codex 0.153.4 **不支持 URL-mode elicitation**（宿主不支持，非产品缺陷），产品按设计降级到「人工在 Nomi 里填」。
key 没进模型上下文、没进 MCP 参数，agent 明确停下来交给人。Nomi 的填写页**已预填**来源名与接入地址
（`OnboardingWizard.tsx:138-165` 按 sessionId 回读），只剩 Key 一个空框。这是想要的行为。
> 方法论坑：`document.body.innerText` 不含 `<input>` 的 value，第一次差点写成「没预填」。

### ⑤ 选型那一跳：返回的形状 ≠ 接受的形状（Run 4 / 5，两次独立撞）

发现步返回的 candidate 带 `label/modes/evidence/classification/detail/estimatedCalls`，
而 `propose` 只接受 `{modelKey, kind}` 且 `additionalProperties:false`；并且**只传 selections 会被拒**，
必须连整页 candidates 一起重发。schema 其实写对了，坑在**读回来的东西不能原样送回去**。
好在这条错误带了可执行的 repair hint，两次都在第二次自纠成功。

### ⑥ 花钱确认这一关：**结构性死循环**（Run 6 / 7，本次实验最贵的发现）

链路是：agent `confirm` → Nomi 签发 5 分钟挑战 → **人**在 Nomi 窗口点「确认并开始验证」→ agent `start`。三个问题叠在一起：

1. **人被通知不到。** 队列里躺着一条 `verification` handoff，但 GUI 什么都不显示——
   确认面板只在 `SettingsDialog → 模型 → OnboardingDrawer` 里渲染。用户不主动开设置就永远看不见。
2. **agent 分不清「等人点」和「人点完了」。** `stage` 两种情况都是 `needs_spend_confirmation`；
   真正的信号 `pendingReceiptId` 藏在投影里、名字不说人话。两个独立回合看着它却都选择了**再 confirm 一次**——
   而再 confirm 会作废刚才那次点击、签发新挑战、要求人**再点一次**。这就是循环。
3. **5 分钟窗口从 agent 点 confirm 那一刻开始算，收据 `expiresAt` 直接继承挑战的**
   （`approvalReceipt.ts:408`）。我第三次点确认后 agent 的下一跳 `start` 拿到 `receipt_expired`——
   人点得不够快？不是，是**「agent 回合 60–120s × 人要自己发现并翻到设置页」根本塞不进 5 分钟**。

**三条合起来 = 这一关正常人走不通。** 我最后是靠一个每 3 秒自动点确认的脚本（模拟「用户就坐在窗口前盯着」）
+ 把每步入参写死喂给 agent，才在一个回合里把 confirm → start 串上。

### ⑦ 上下文一丢就没法接着做（Run 5 / 7）

`nomi_read target=integration` 不带 sessionId 直接报 `Invalid sessionId`——**没有任何列会话的接口**。
更糟的是 `begin` 传了已有 sessionId 也照样**新建一个会话**（Run 7 建出 `integration-fbc56697…`），
而且新会话对同一个 baseUrl 报 `credentialStatus: missing`，会让用户把已经存过的 key 再填一遍。
Run 5/7 的 agent 都是靠 **shell 去盘上 grep** 找回 sessionId 的（本实验的日志刚好在 cwd —— 这是本次装置的污染，
但它同时说明：MCP 面上真的没有第二条路）。

### ⑧ 时间戳只给绝对 UTC（Run 5 收尾）

`confirm` 返回 `expiresAt: 2026-09-10T16:40:36Z`，其实还有 5 分钟。agent 拿自己「今天是 09-11」的认知一比，
判成**已过期**并停下。归类：**模型读错 + 产品可改进**——只给绝对 UTC、不给 `expiresInSeconds` 或 server now，
等于让 LLM 做它最不擅长的时间比较。

## 3. 数字

| 指标 | 值 |
|---|---|
| agent 回合数 | 9（Run 1 是我传错 `-s read-only` 造成的宿主拦截，不计入下列口径） |
| nomi 工具调用总次数 | **58**（Run 2–9） |
| 入参一次写对率 | **36/58 = 62%**；失败 22 次里 9 次是「schema required 撒谎」、6 次是 revision 语义 |
| 回合成败 | 9 回合里 **1 回合完全成功**（Run 9，15/15，104s，且是我把每步入参写死之后） |
| 断点 | ①项目句柄 ②begin 必填 ③revision 歧义 ④选型形状 ⑤**花钱确认循环（最深）** ⑥会话不可枚举 |
| 人工介入 | **引导 5 次** + 窗口点确认 4 次（3 次白点）+ 贴 key 1 次（按设计） |
| 端到端墙钟 | 约 2600s 的 agent 时间（不含我操作） |

## 4. 跑通了

Run 9：`confirm(ds-final-1)` → 读到新 `pendingReceiptId` → `start`（不传 receipt）→ `stage=certifying`
→ 轮询到 `completed`（revision 19）→ `nomi_read target=models` 里出现
`api-deepseek-com · deepseek-flash（Deepseek Flash, text）✓ 可用`。
认证跑的是**真实生产请求**：`operations.json` 里 `{modelKey: deepseek-flash, taskKind: chat}` `settledResult.ok=true`。

我随后以用户身份在真实 GUI 里走完最后一步：项目库首页的「创作助手尚未连接模型」横幅消失、顶部出现「模型」入口；
打开项目 → Agent 面板下拉里选 **Deepseek Flash** → 打「你好」→ 模型答了（见 `proof-hello.png`）。
**闭环成立。** 注意：说「你好」这一步**没有 MCP 路径**，只能人在界面里做。

## 5. 该改什么（按值不值得排）

1. **花钱确认这一关重做**（⑥）：挑战有效期从「人点下去」开始算，或收据独立 TTL；
   `stage` 增加 `ready_to_start`（人已批准）这一档；`confirm` 在已有未消费收据时**幂等返回**而不是作废重签；
   handoff 排队时给用户一个看得见的提示（窗口/托盘/角标），别指望他自己翻设置页。
2. **让 schema 说真话**（②）：`begin`/`open_credentials`/`confirm` 的真实必填进 `required`，
   或者一次把缺的字段全列出来，别逐个抛。
3. **拆开 `revision is stale`**（③）：missing_field / stale_revision / conflict 三个错误码，
   每个带 `recoveryActions`（「重读会话」vs「补这个字段」），并统一走双语错误表。
4. **给会话一条回家的路**（⑦）：`nomi_read target=integration` 不带 id 时列出未完成会话；
   `begin` 命中同一 baseUrl 的未完成会话时复用而不是新建；已存 key 的 vendor 不该报 `missing`。
5. **时间给相对量**（⑧）：`expiresInSeconds` + `serverTime`。
6. **测试口径**（R30）：现有 e2e 用 JS 变量直传句柄/入参，把①②⑤⑥全测没了。
   这类「必须由模型逐字复述/自己推断」的环节，得有真实模型在回路里的 loopback 夹具。
