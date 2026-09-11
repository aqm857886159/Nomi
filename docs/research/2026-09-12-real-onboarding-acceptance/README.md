# 真实验收：外部助手经 MCP 把模型接进 Nomi（2026-09-12）

不是桩、不是夹具。真的 Codex CLI、真的 DeepSeek 官方 key、真的 Nomi 窗口、真的手点键盘。

**被测树** `test/real-onboarding-acceptance-20260912`
= `origin/feat/mcp-onboarding-tool-face-20260911`（PR #754，接模型 4 个工具）
+ merge `d5024dada57205428f3d525629cce588a6280450`（`feat/model-onboarding-two-paths-20260911`，15 个未推的本地提交）
无冲突。`pnpm install --frozen-lockfile` + `pnpm build` 全绿。走查台见 [harness.md](harness.md)。
本报告只记录，**没有改任何产品代码**。

**一句话结论**：入参这一层修好了（62% → 100%，零服务器报错），但**没有一次真的接成**。
按产品自己给的指引原样跑，三次里零次靠自己走完：接入会话卡死在 `needs_spend_confirmation`（外部会话没有出口），
它前一档的「自动发现模型清单」又返回空、逼 agent 猜 id。人替它把正确 id 报出来后，模型确实进了目录——
可**创作助手的模型下拉仍然是「目录里没有可用的」**，首页还在劝你去连接模型。所以本次**没有真的出东西**。

---

## 1. 环境

| 项 | 值 |
|---|---|
| 司机 A | Codex CLI 0.153.4（真实账号，`codex exec --json`） |
| 司机 B | Claude Code CLI 2.1.263 —— **没跑成**：`You've hit your weekly limit · resets Sep 14 at 9am`。MCP 接线本身已验证（见 §5） |
| 供应商 | DeepSeek 官方 `https://api.deepseek.com`，key 来自 `~/.nomi-secrets.env` |
| 图片模型 | **没做成**：这台机器上只有 DEEPSEEK_API_KEY，APIMart / Kie 都没有 key，产品设计又要求 key 只能由用户在 Nomi 页面里填 —— 见 §6 |
| 隔离 | 每个司机一套隔离 profile（settings/projects/capability/user-data 都在 `/tmp/nomi-real-onboard/<司机>/`）。**`HOME` 没有换**——换了 macOS safeStorage 就存不了 key（见 harness.md「D4」），所以产品「一键接入」写的是用户真实的 `~/.codex/config.toml` 与 `~/.claude.json`：两份都已在动手前备份，跑完已原样还原（已核对）。跑司机时用的是这两份的**副本**（改指向被测树 + 补隔离目录 env），不是原件 |
| 花费 | Codex 侧 5 次 turn，约 50 万 input token（绝大部分是缓存命中）；DeepSeek 侧 0 次生成调用（见 §4），另有 1 次免费的 `GET /models` 核对 |

## 2. 数字（对照 2026-09-11 基线：58 次调用 / 入参一次写对 62% / 9 回合 1 成功 / 人工 9 次）

| | 基线 09-11 | 本次 Codex v1 | Codex v1b | Codex v2（换说法） | 人替它报 id 后 |
|---|---|---|---|---|---|
| `nomi_*` 调用数 | 58 | 2 | 7 | **0** | 2 |
| 入参一次写对（按真服务器 schema 判） | 36/58 = **62%** | 2/2 = **100%** | 7/7 = **100%** | — | 2/2 = **100%** |
| 服务器判错（isError） | — | 0 | 0 | — | 0 |
| 回合数 | 9 | 2 | 4 | 2 | 1 |
| 我替用户点的次数 | 9（5 引导 + 4 点确认，3 次白点） | 1 | **5**（贴 1 次 key + 点 1 次保存 + 3 次「继续」） | 1 | 1（把正确的模型 id 告诉它） |
| 走完了吗 | 1/9 | 否 | **否**（死在 `needs_spend_confirmation`） | 否（且谎报成功） | **是**，2 个模型进了画布模型框 |

**入参写对率从 62% 涨到 100%**——4 个工具的 schema 与描述这一层是有效的，一次都没写错、服务器一条错都没返。
**但完成率没有跟着涨**：问题整体从「参数写不对」搬到了「流程走不通」。

## 3. 缺陷清单

### P0-1 接入会话停在 `needs_spend_confirmation`，外部助手**永远**出不来
- 现象：`choose_models` 之后 stage 变成 `needs_spend_confirmation`，此后 `check_connection`、`await_setup`、
  `list_models` 全部原地踏步；GUI 一张确认卡也没弹（`pendingChallengeId: null`）。Agent 连问三回合「卡在哪」，
  只能如实说「没有可执行的确认句柄」。
- 根据：
  - `electron/integrationCertification/integrationSession.ts:1336` 把 stage 设成 `needs_spend_confirmation`
  - `electron/shared/integrationContract.ts:12` 注释写「该由驱动 Agent 调 confirm 了」
  - 但 `electron/capabilityCore/modelOnboarding/declarations.ts` 的 action 枚举只有
    `connect_provider / choose_models / draft_adapter / check_connection / show_models / cancel`——**没有 confirm**
  - 唯一的出口 `integrationSession.ts:1294 startConfirmedFromTrustedUi` 第一行就是
    `if (session.ownerClientId !== "nomi") throw`，而外部会话的 owner 是 `codex`
  - `IntegrationSessionService.start()` 在 `electron/` 里只有 `mcpOnboardingDefects.test.ts:90/104` 调用，**没有生产调用方**
  - `electron/capabilityCore/modelOnboarding/dispatch.ts:268` 的 `waiting` 集合也不含这一档，所以 `nomi_await_setup` 立刻返回
- 复现：本报告 §4 的 v1b 全程；证据 `/tmp/ro-run-codex-v1b/events.jsonl`（已随报告归档）
- 归属分支：`feat/mcp-onboarding-tool-face-20260911`（删 confirm 的是它）× 旧 session 机（保留该档）

### P0-2 key 存好之后，Nomi 自己的「发现模型清单」返回空，逼着 agent 猜模型 id
- 技能与工具描述都承诺：「When a key is stored Nomi probes the model list itself, so there is no discovery action to call.」
- 实测：贴完 key 后 `nomi_await_setup` 返回 `stage: draft`、`candidates: []`。Agent 没有候选可抄，
  只能用记忆里的 `deepseek-chat`——而 DeepSeek 官方今天的清单是 `deepseek-flash` / `deepseek-v4-pro`
  （我用同一把 key 直接 `GET https://api.deepseek.com/models` → HTTP 200，两个 id，见 §4）。于是自检必然失败。
- 直接原因之一：`dispatch.ts:268` `const waiting = new Set(['needs_credential','discovering','certifying','committing'])`
  —— **不含 `draft`**，所以 await 在发现开始之前就返回了。
- 归属分支：`feat/mcp-onboarding-tool-face-20260911`

### P1-3 工具说「已加入画布模型选择器」，开着的设置页仍写「0 个模型」，重启才对
- `show_models` 返回成功、agent 照实转述；同一时刻 GUI 的模型页仍是「1 个连接 · 0 个模型 / 0 个可使用」
  （截图 `codex-fix-99-final.png`）。关掉 app 再开，同一页变成「DeepSeek 官方 API · 2 个模型」
  （截图 `codex-final-01-models-after-restart.png`）。
- 也就是说外部助手改了模型清单，正开着的设置页不会跟着变。
- 归属分支：`feat/model-onboarding-two-paths-20260911`（模型页）

### P1-4 设计稿里的「{{host}} 正在接入 {{name}}」进度卡，真实接入全程一次没出现
- `src/i18n/locales/onboardingProviders.ts:552` 起整段 `assistedOnboarding.progress`（建立会话 / 你贴 Key /
  找模型挑模型 / 试跑一次验证 / 出现在已接入里）在设计里是这条路的 GUI 反馈。
- 实测 v1b 全程 30 张截图 + 全文时间线里，`正在接入` / `试跑一次验证` / `已接进来` 出现 **0 次**。
  用户在 Nomi 这边看到的只有：突然弹出一张填 Key 的表，填完就没下文了。
- 归属分支：`feat/model-onboarding-two-paths-20260911`

### P1-5 卡上选了 Codex，「去接入」把你带到一个默认停在 Claude Code 的面板
- `src/ui/onboarding/AiAssistedOnboardingCard.tsx:159` 的 `onOpenAssistantConnections` 只切 tab，不带宿主。
- 截图：`codex-p2-01-host-selected.png`（卡上 Codex 高亮）→ `codex-p3-01-mcp-connections.png`（面板写「一键接入 Claude Code」）。
  用户得在第二个地方再选一次 Codex，选错就把 Nomi 接进了另一个助手。
- 归属分支：`feat/mcp-onboarding-tool-face-20260911`（这张卡是它加的）

### P1-6 一键写出的配置永远指向 `/Applications/Nomi.app`，且每次启动都会把手改过的配置改回去
- `electron/capabilityCore/mcpConfig.ts:225-229 launcherEntry()`：只要这台机器装过 Nomi.app，
  **开发构建**写出的 MCP 配置也指向装机版的 helper 与 app.asar。
- 而且 app 每次启动都重写客户端配置里的 `nomi` 块（本次亲测：手工改成被测树的路径，重启 app 后被改回装机版）。
- 后果：用户装了正式版又跑测试版/另一棵树时，外部助手实际连的是**另一个** Nomi；调试时你改的配置会被静默覆盖。
- 归属分支：`feat/mcp-onboarding-tool-face-20260911`（既有行为，本次首次在真实链路上撞到）

### P1-7 产品写进 Codex 配置的 `default_tools_approval_mode = "writes"`，让非交互 Codex 一步也走不了
- 一键接入写的块里带这一行。用 `codex exec`（任何自动化、任何 CI、任何「让它自己跑」）时，
  第一个写工具就被拒：`MCP tool call requires approval, but approval policy is never`，agent 当场停住。
- 交互式 Codex 里它不是错，但意味着**每个写动作一次人工点头**——直接计进「人工干预次数」。
- 归属分支：`feat/mcp-onboarding-tool-face-20260911`

### P2-8 换个说法就完全脱轨：agent 绕过工具，直接手改 Nomi 的 `model-catalog.json`，然后报告「已接好」
- 提示词换成大白话「在 Nomi 里加个模型：DeepSeek，用官方 API。」（不带技能原文）：
  **两回合，0 次 `nomi_*` 调用**。Codex 去读写磁盘上的 `settings/model-catalog.json`，
  最后宣布「DeepSeek Provider 已加入 Codex 与 Claude 两套 Nomi 配置……两份 JSON 均已解析验证通过」。
- 落盘结果：一个版本号不对的 catalog（下次启动被隔离成 `model-catalog.future-v14.json`）。
- 也就是说：工具描述本身**不足以把一个泛泛的请求吸进这条路**；没有技能原文时，最可能的结局是
  「自信地改坏文件」。
- 归属：工具面 + 技能包的联合问题。

### P2-9 产品指引让助手「把 SKILL.md 存进技能目录」，Codex 照做后自己把自己搞晕
- 指引原文：「如果你的助手有技能目录，把下面那份 SKILL.md 存进去」。Codex 真的把它写进了工作目录，
  随后 Codex 报 `Skill descriptions were shortened to fit the skills context budget`，
  接着连说三回合「当前会话只暴露了 `nomi_list_models`，没有 `nomi_model_setup`」——**而这是假的**：
  我另起一次探针强制它调 `nomi_await_setup`，调通了（`/tmp/ro-toolview.jsonl`）。
- 同一条提示词跑三次，一次这样脱轨、两次正常。这条不稳定性直接解释了基线里的「9 回合 1 成功」。

## 4. 一次完整的真实旅程（v1b，逐步截图）

截图：关键 10 张已随报告提交在 [`shots/`](shots/)；全部 68 张在被测树的
`tests/ux/shots/real-onboarding/`（该目录被 `.gitignore:68` 忽略，不进版本库）。

| 步 | 发生了什么 | 截图 |
|---|---|---|
| 0 | 项目库 →「连接模型」→ 模型页 | `p1-00-library.png` `p1-01-model-settings-home.png` |
| 1 | 「用 AI 帮我接入」卡上选 Codex →「复制指引」（真剪贴板，原文见 [product-guidance-codex.md](product-guidance-codex.md)） | `codex-p2-01-host-selected.png` `codex-p2-02-copied.png` |
| 2 | 「去接入」→ 落到自动化页，面板默认 Claude Code（P1-5）→ 手动切到 Codex → 一键接入 | `codex-p2-03-automation-page.png` `codex-p3-01-mcp-connections.png` `codex-p4-01-host-tab.png` `codex-p4-02-after-install.png` |
| 3 | 把指引原样粘进 Codex（占位符换成「DeepSeek 官方 API 的 deepseek-chat」），Codex 调 `nomi_list_models` → `connect_provider` | — |
| 4 | Nomi 自己弹出「添加一个 AI 模型」页，来源名与 BaseURL 已填好，Key 框空着。**我在这一页里填 key**（值没进过 Codex、没进过任何文件） | `codex-v1b-key-before-1.png` `codex-v1b-key-after-1.png` |
| 5 | 回 Codex 说「key 我贴好了」→ `await_setup`（`draft`/候选空，P0-2）→ `choose_models(deepseek-chat)` → `check_connection` → **`needs_spend_confirmation` 死档**（P0-1） | `codex-v1b-99-final.png` |
| 6 | 我用同一把 key 直接问 DeepSeek 官方：`GET /models` → 200，`deepseek-flash`/`deepseek-v4-pro`。把正确 id 告诉 Codex | — |
| 7 | Codex 一回合 `choose_models` + `show_models` → **2 个模型进了画布模型框**，但开着的设置页仍写 0（P1-3）；重启后正确 | `codex-fix-99-final.png` `codex-final-01-models-after-restart.png` |

工具调用序列（脱敏，v1b 全量在 `/tmp/ro-score-codex-v1b.json`）：

```
nomi_list_models {}                                                    ok
nomi_model_setup {action:connect_provider, kind:http-api-provider,
                  name:"DeepSeek 官方 API", baseUrl:"https://api.deepseek.com",
                  authType:bearer, authHeader:Authorization, docs:…}    ok → user_sees_key_page
nomi_await_setup {setupId:…, timeoutSeconds:60}                        ok → stage draft, candidates []
nomi_model_setup {action:choose_models, setupId:…,
                  models:[{modelKey:"deepseek-chat", kind:"text"}]}     ok → stage needs_spend_confirmation
nomi_await_setup {setupId:…, timeoutSeconds:30}                        ok → 立刻返回，档位不变
nomi_model_setup {action:check_connection, vendorKey:"api-deepseek-com",
                  modelKeys:["deepseek-chat"], timeoutSeconds:15}       ok → "did not confirm these model ids"
nomi_list_models {setupId:…}                                           ok → 还是 needs_spend_confirmation
── 人工介入：把官方真实模型 id 报给它 ──
nomi_model_setup {action:choose_models, models:[deepseek-flash, deepseek-v4-pro]}  ok
nomi_model_setup {action:show_models, vendorKey:…, modelKeys:[…], visible:true}    ok → 进画布模型框
```

一个 key 的值都没有出现在任何一条参数里——**这条纪律，三次跑下来，agent 一次都没违反**。

## 5. Claude Code 那一侧

同样走完了产品路径：模型页选 Claude Code → 复制指引 → 去接入 → 一键接入 Claude Code，
配置正确写进 `.claude.json` 的 `mcpServers.nomi`。
拿这份配置直连被测树的 MCP server：`initialize` 成功、`tools/list` 27 个工具、
`nomi_list_models / nomi_await_setup / nomi_model_setup / nomi_remove_provider` 四个都在。

**但模型这一侧跑不了**：`claude -p` 第一句就是 `You've hit your weekly limit · resets Sep 14 at 9am`。
所以本次**没有** Claude Code 的入参写对率/回合数/干预次数，两个司机的横向对比这次缺一半。
不拿接线成功当司机跑通。

## 6. 接完之后：模型到底能不能用？——三个地方给了两个答案（P0-10）

这是本次最刺眼的一条，因为它正好落在「接好了没有」这个问题上。

同一时刻、同一个隔离实例、重启之后（所以不是刷新问题）：

| 你看的地方 | 它说 | 证据 |
|---|---|---|
| 设置 → 模型 | 「1 个连接 · 2 个模型」「2 个可使用」 | `/tmp/ro-text-final-models.txt:26,40,44`，截图 `codex-final-01-models-after-restart.png` |
| 项目库首页横幅 | 「创作助手尚未连接模型」 | 同一份 dump 第 9 行 |
| 项目里创作助手的模型下拉 ·「对话」 | **「目录里没有可用的」** | 截图 `codex-gen-02-model-picker.png` |

也就是说：外部助手按流程接进来的两个文本模型，在设置页被算作「可使用」，
但**创作助手一个都选不到**，首页还继续劝你「去连接模型」。

- 下拉那句来自 `src/i18n/locales/agentPanelV4.ts:132 modelNone`，
  由 `src/workbench/ai/v4/agentPanelV4ModelRows.ts:91` 在 `chatModelChoices(...)` 为空时渲染；
  它吃的是 `data.models`（助手的文本模型清单），而 `show_models` 写的是画布生成模型那张表。
- 工具描述对 `show_models` 的承诺是「in the canvas model picker」——严格说它没撒谎；
  但对用户而言，接的是一个**只有文本能力**的供应商，于是它在画布（图/视频）里也没有位置，
  最后哪儿都用不上。**外部助手接一个文本模型，走完全程，产品里没有任何一处能用它。**
- 归属：`feat/model-onboarding-two-paths-20260911`（模型页计数）× `feat/mcp-onboarding-tool-face-20260911`（show_models 语义）

## 7. 图片模型这件事，本次没做成

任务要求「真的出一张图」，优先 APIMart 最便宜的图片模型。做不到，原因如实写在这里：

- `~/.nomi-secrets.env` 里只有 `DEEPSEEK_API_KEY`，没有 APIMart / Kie 的 key；
- 产品设计（也是这次要验的东西本身）规定 key 只能由用户在 Nomi 自己的页面里填，
  我不能从别处取一把 key，也不该把用户真实 profile 里加密存着的 key 掏出来；
- 所以这次只能用**文本模型**（DeepSeek 官方）走这条路，结果见 §6。
- 要补图片这条腿，只要在 `~/.nomi-secrets.env` 里加一把 APIMart key 即可，脚本不用改。

所以本次**没有真的出一张图，也没有真的出一段文字**：文本模型接进来了、在设置页显示可用，
但创作助手选不到它（§6），画布又不收文本模型。**「真出东西」这一步，本次是 NO。**

## 8. 「说明书 vs 题库」在真实司机上是什么样

`nomi_list_models` 的描述写着：**Use it when: Before every other call here**（`declarations.ts:133`）。
题库 `tests/fixtures/tool-selection/2026-09-11-onboarding-bank.json` 的 `connect-by-name-zh`
（「帮我把 DeepSeek 接进 Nomi」）期望的第一跳是 `nomi_model_setup:connect_provider`。

真实 Codex 三次跑，**三次都先调 `nomi_list_models`**——听说明书的，被题库判错。

这不只是记分牌不准：真实序列里第一跳的 `list_models` 什么也没带来（新机器上没有连接可读），
纯属白跑一跳。二选一——要么描述改成「只有需要句柄时才先读」，要么题库改成接受这一跳；
现在这样，两份真相源在打架，而机器只认题库那份。

