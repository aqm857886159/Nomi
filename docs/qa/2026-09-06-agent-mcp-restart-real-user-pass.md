# 收官 B · Agent 对话 / MCP 外部宿主 / 冷重启 的真实用户走查

> 状态：✅
> 日期：2026-09-06 · 基线 `origin/main@747adf599`（含 #504 A 段、#511 B 段、#512 MCP 密钥 elicitation、#515 不失忆）
> 目的（用户 2026-09-05 明令）：**防止用户拿到手不能用**。不是「门岗全绿」，是「一个真人照着做，走得通吗」。
> 证据：`docs/qa/evidence/2026-09-06-mcp-real-host/*.jsonl`（真宿主 JSON-RPC 逐帧），走查见 `tests/ux/`。

---

## 0. 一句话结论

三块里，**MCP 外部宿主这块在合并后的 main 上是走不通的**——不是配置问题、不是权限没开，是两道各自不可达的门叠在一条已经上架的工具链前面。Agent 对话与冷重启各有一个会让人当场卡住的缺陷，其中冷重启那个是**删完对话下次打开项目直接打不开**。全部已修并带回归。

真宿主的 elicitation URL 模式，**今天在这台机器上的两个客户端都到不了用户面前**——一个不支持，一个支持但自动拒。这条要拿证据说话，见 §2.3。

---

## 1. 走了什么、怎么走的

| 块 | 用什么走的 | 真实性 |
|---|---|---|
| MCP 外部宿主 | 真 `claude` CLI 2.1.261 / 真 `codex` CLI 0.153.4，经一个透明 stdio 代理把每一帧 JSON-RPC 落盘 | 真宿主 + 真 Nomi MCP server（打包 launcher 路径与 headless stdio 路径各走一遍） |
| Agent 对话 | Electron 真机 + loopback vendor（零额度） | 真渲染层 / 真 IPC / 真 Host / 真落盘，只有远端模型是回环 |
| 冷重启 | Host 快照真实 JSON 往返 + 真机杀进程重开 | — |

隔离：每次跑用独立 `NOMI_SETTINGS_DIR` / `NOMI_PROJECTS_DIR` / `NOMI_CAPABILITY_DIR` / userData。密钥全程用假值。

---

## 2. MCP 外部宿主

### 2.0 先修的是「为什么本机 nomi MCP 是 CONNECTION_CLOSED」

用户的 `~/.claude.json` 里 nomi 条目仍写着 `node /Users/aoqimin/Desktop/Nomi/scripts/nomi-mcp.mjs`。那个入口在 `aaaf2136d` 迁移时被同 commit 删净（P1 做对了），现在只剩一块迁移墓碑；宿主拿到的只有一句 `CONNECTION_CLOSED`，**里面一个字都没提 Nomi**。

自动迁移的代码其实一直在（`classifyMcpEntry` → `legacy-launcher` → `shouldAutoMigrate`），但它只作为**渲染「模型接入」面板的副作用**发生。也就是说：只有已经猜到「这事跟 Nomi 有关、该去开那个面板」的人才修得好——而看到 `CONNECTION_CLOSED` 的人没有任何理由这么猜。

**修**：能力核起来时就跑同一个修复（`electron/capabilityCore/appIntegration.ts` `startCapabilityCore`，调 `mcpConfig.repairStaleMcpConfigs`）。范围一点没放宽——只改 Nomi 自己写过的四种历史形状，先备份，`custom` 条目一律不碰。用户下次重启客户端就能用，不必先想到来开面板。

顺带堵了一个自己挖的坑：走查/E2E 起的是**真 GUI**，而 `~/.claude.json` 的路径来自 `os.homedir()`，**不在隔离目录里**。不挡住的话，每跑一次走查都会把开发者真实的客户端配置改成指向那次测试的二进制。`NOMI_E2E=1` 时直接不动（带断言）。

### 2.1 真宿主读项目、读时间轴 —— 通

Claude Code CLI 经打包 launcher 路径：`nomi_project_create` ✅ → `nomi_session_open` ✅ → `nomi_read` ✅ → `nomi_timeline_read` ✅ → `nomi_timeline_edit operation=preview` ✅（返回新 revision + `$.textClips[0] added` 的 diff）。

### 2.2 `nomi_timeline_edit` 的 apply 在 main 上**从来没有可能成功**

这是本轮最大的一条。工具在 `tools/list` 里公开、preview 能跑、diff 给得漂漂亮亮，然后：

```
✗ Project lease scope is insufficient
```

追下去是**两道各自不可达的门**叠在一起：

1. **`timeline:write` 这个 scope 没有任何代码路径会发放。** `deriveProjectSessionScopes`（`electron/capabilityCore/projectSessionAuthority.ts`）发 `canvas:write` / `document:write` / `timeline:read` / `export:read` / `asset:read`，注释写着「timeline/export writes still use their own approval paths」。但 scope 校验发生在**更早**——留空不是多加一道门，是把这个工具删了。
2. **`planConfirmed` 这个标志没有任何代码路径会为 timeline 置位。** `rpcServer.ts` 要求 apply/undo 必须带 `planConfirmed: true`，而协议层只在 `canvas.write / create_canvas_nodes` 那一支铸它。

净效果：**任何 MCP 客户端、任何时候，都只能预览时间轴改动，永远应用不了。**

这和 2026-09-03 那次「客户端确认面在生产里整条不可达」是同一族错误（`docs/lessons/claude-code-lacks-elicitation-capability.md` 里记着）。教训重复了一遍：**「对方支不支持」和「我方走不走得到」是两件事，只验一半会得出反的结论。**

**修**：
- `projectSessionAuthority.ts` 把 `timeline:write` 和另外两个可逆写面并列发放，注释改成事实。
- 新增 `electron/capabilityCore/mcpTimelineConfirmation.ts`：apply/undo 先向客户端 elicit 一次真人确认，accept 才铸 `planConfirmed: true`；拒绝/超时不落地并给可机读原因；**客户端根本没法问人时，不再回一句「需要 Host 批准」这种没人能满足的话**，而是明说「你的客户端问不了你，请回 Nomi 里应用」。
- 挂进 `mcpProtocol.ts` 时名字**先同步判掉再 await**——多一个 microtask 会改变其它工具的并发派发次序（`nomiMcpProductionRevision.test.ts` 当场红给我看了）。

**修完的真宿主证据**（`claude-code-launcher-after-fix.jsonl`）：`effectiveScope` 里出现 `timeline:write`，preview 通过，apply 时 Nomi 发出了 form 模式 `elicitation/create`，Claude Code 在 `-p` 非交互模式下回 `{"action":"cancel"}`，Nomi 据此不落地。

> ⚠️ 诚实边界（R19）：**「真人点同意 → 改动落地 → 收据」这一段没有在真宿主上验过**——`claude -p` 里没有真人可点，它一律回 cancel。accept 分支由 `mcpTimelineConfirmation.test.ts` 六条断言钉死（含「只有 accept 才铸 planConfirmed」）。要补真宿主那一段，得在交互式 `claude` 会话里手点一次。

### 2.3 elicitation URL 模式：两个真宿主，两种到不了用户面前的方式

`nomi_integration action=open_credentials` 走了一遍，两个客户端**都实测**：

| 客户端 | `initialize` 里原样声明的 capabilities | Nomi 的行为 | 用户实际得到 |
|---|---|---|---|
| Claude Code CLI 2.1.261 | `{"roots":{"listChanged":true},"elicitation":{}}` | **不支持 url 模式** → 按规范不发 URL | 手动路径文字 |
| Codex CLI 0.153.4 | `{"elicitation":{"form":{},"url":{}}}` | 发 `mode:"url"` + 真实一次性 loopback 链接 | **客户端直接回 `{"action":"decline"}`，链接没给任何人看过** |

两条结论：

- **空的 `elicitation: {}` = 只支持 form 模式**（规范 2025-11-25）。Claude Code 至今没声明 `url`。所以「MCP 密钥走 elicitation URL」这个 2026-09-05 的设计决定，**在 Claude Code 上根本不会触发**，永远走手动兜底。Nomi 这边的行为是对的（密钥绝不进 form、绝不进对话）。
- **Codex 声明了 url 却自动拒。** 这正是本机记忆里标着「未复验」的 openai/codex#11816。**本轮复验了：真的自动拒**，`codex exec` 下 100% 拒。所以「自报支持」离「好用」还差一整步——这条要连版本号一起记。

**修**（这是我方能修的那一半）：原来 `decline` 被当成错误抛出，文案是「安全页被取消或超时了」。**用户根本没见过那个页面**——被自家客户端拒掉，却收到一句怪他取消的红字错误，而且是 tool error，agent 拿它没有下一步。改成：不再报错，返回同一个会话投影 + `credentialEntry: { mode:'manual', reason:'not_opened' }`，文案只说已知的事实（「填写页没有在你的 AI 客户端里打开」）并给出回 Nomi 的路。

**修完的真宿主证据**：同一条 Codex 指令，修前工具 `failed` 且回「安全页被取消或超时」，修后工具 `completed` 且返回

```json
{"mode":"manual","reason":"not_opened","instructions":"The entry page did not open in your AI client (some clients refuse these links outright, or you may have cancelled it). The key never travels through this conversation — open Nomi → Settings → Models → \"Add an AI model\", save the key for \"供应商C\" there, then ask me to continue."}
```

### 2.4 顺手抓到的：唯一的逃生口指向一个不存在的按钮

兜底文案原来写「Nomi → 设置 → 模型 → **添加连接**」。全仓搜下来，**「添加连接」/「Add connection」在 UI 里根本不存在**——真实按钮是 `modelSetup.addModel`「添加一个 AI 模型」/「Add an AI model」。用户照着找会找不到。这就是 `docs/lessons/vendor-manage-is-a-discoverability-problem.md` 那一族。已改成真实标签，并在文件里写明「这两个 label 改名时这段文案必须跟着走」。

### 2.5 报告但**没有**修的（不在本轮职责边界内）

- **`nomi_export_job` 报 `project_scope_required: an active project is required`**，即使 lease 里有 `export:read`。根因：`src/workbench/timeline/agent/exportToolCall.ts:73` 和 `src/workbench/timeline/agent/timelineCapabilityTarget.ts:221,318` 读的是 `getDesktopActiveProjectId()`（GUI 当前打开的项目），**不是刚刚为某个项目签发的 lease 的 projectId**。也就是说外部宿主只能改「人正好在 Nomi 里打开着的那个项目」，它自己建的项目改不了；没开项目时就是这句没有下一步的错误码。
  **为什么没修**：`src/workbench/timeline/**` 由另一个收官 agent 同期在改，双改必冲突。已按 file:line 交出。
- **MCP 结果文案跟随 OS 语言，不跟随用户在 Nomi 里选的语言。** `mcpNodeLauncher.ts:176 resolveLauncherLocale()` 读 `Intl.DateTimeFormat().resolvedOptions().locale`；GUI 侧 `getDesktopLocale()` 会被渲染层的 `nomi:i18n:set-locale` 更新成用户的选择，但 bare-Node launcher 是**另一个进程**，永远学不到。本机 OS 是 `en-US`，所以中文界面的用户从 MCP 工具收到的是英文。不是「不能用」，是「不对味」，单开。
- **`nomi_canvas_maintenance` / `nomi_document_read` / `nomi_document_edit` / `nomi_timeline_read` / `nomi_timeline_edit` / `nomi_export_job` / `nomi_media_query` / `nomi_layout_read` / `nomi_layout_write` 在 `tools/list` 里 `title` 为空**（其余工具都有人话标题）。宿主的工具选择界面上这几个只有裸名字。`mcp-l1-handshake.e2e.mjs` 已把它们从 title 断言里排除并注明「A 线统一补」。
- **`Integration session revision is stale` 不带当前 revision**，agent 拿不到自纠所需的信息，实测让 Codex 白撞一次。
- **`check:controls` 有一块盲区，本轮暴露了。** 那道门岗的职责正是「点了没反应的控件」，但它只认**客户端守卫短路**这一种形状（`onClick={() => { if (x) doThing(x) }}`）。§3.2 那个删除按钮是另一种：把命令发出去、被**边界**拒绝、拒绝被 `void` 丢掉。全仓有 49 处同形状的 `void` handler、只有 1 处带 `catch`——直接做成硬零不可能，做成 48 条无理由的棘轮就是噪音（那道门岗自己的头注写着「会瞎叫的门岗不如没有」）。**先量再定规则**，单开。

---

## 3. 冷重启：删过对话的项目下次打不开

### 3.1 快照读不回来（P0，无声）

`electron/projectAgentHost/projectAgentState.ts` 的 `recentAppliedCommands` 保留最近 64 条 patch。这些 patch 是**已经发生过的事实**，里面理所当然会点名用户后来删掉的线程、它的 turn 和 item。但 `assertProjectAgentHostState` 拿**当前**的实体集合去校验它们（`assertPatchChange(change, binding, threadIds, turnIds, …)`），等于用现在的状态去要求过去。

后果一条链：删掉任何有历史的线程 → 下次冷启 `snapshotProjectAgentHostState` 抛 `invalid_state` → `readValidEnvelope` 对**快照和备份都**返回 null → `projectAgentRepository` 抛 `ProjectAgentRepositoryIntegrityError`。**这个项目的 Agent 历史打不开了**，直到之后 64 条命令把那条 patch 挤出窗口为止。

会在线上而不在开发机上炸，是因为**当场完全看不出来**：写入走的是 trusted 快路径，只校验新 delta，不重扫历史。要重启才现形。**main 上没有任何测试覆盖它。**

**修**：新增 `electron/projectAgentHost/projectAgentPatchReferences.ts`，把「一条 patch 该拿什么实体集合去校验」显式化成两种：live delta 用产生它的那个状态（全部引用必须解析得到），history ledger 用 `HISTORICAL_PATCH_REFERENCES`——**形状、id、枚举、时间戳、binding 一条不少地照验，只放掉跨实体存在性**。

**阳性对照**（`docs/lessons/walkthrough-assertions-need-a-real-signal.md` 的要求）：把 history 那处临时改回 live 引用集，新增的测试立刻红——
`AssertionError: expected [Function] to not throw an error but 'ProjectAgentStateError: invalid_state' was thrown`。改回来即绿。回归测试 `projectAgentReducer.test.ts` → 「keeps the snapshot readable after deleting a thread the history still names」，走的是 JSON 往返 + 全量校验，也就是冷启动真正走的那条路。

### 3.2 删「当前这条对话」什么都不会发生（P0，无声）

线程菜单给**每一行**都画了垃圾桶，包括高亮的当前那行——所以那正是人最会去点的一行。点下去：Host 以 `thread_read_only` 拒绝（`projectAgentThreadReduction.ts:97`；下面 42 行那段把 `activeThreadId` 置 null 的代码因此是死代码），而调用点是 `onClick={() => void removeProjectAgentThread(...)}`——`void` 把这次拒绝变成一个 unhandled rejection。**面板上什么都不会出现，永远。**

`createProjectAgentThread` / `activateProjectAgentThread` 也是同样的 `void`，同样看不到任何失败。

**修**（D1，从用户那一刻的意图出发）：点当前对话的垃圾桶，意思就是「删掉这条对话」，那就照办——先把光标挪走（挪到剩下最近更新的那条；这是唯一一条时新开一条空的），再删。Host 的不变量一点没动（永远不留悬空的 `activeThreadId`，正在跑的线程仍然拒删）。同时把三个线程命令接上面板本来就有的错误条（`friendlyError` + `role="alert"`），不再默默吞掉。

---

## 4. Agent 对话真实使用

一个人（林秋，做美食短片）带一个真任务，在**同一条对话**里跨创作 → 生成 → 剪辑三个面走完。零额度（loopback vendor
只换掉远端模型，渲染层 / IPC / Host / 落盘全是真的）。固化在 `tests/ux/agent-real-user-conversation.walk.mjs`，
13 张截图。运行时证明的：

- **三轮对话、第三轮引用第一轮的工具结果** —— 断言打在出站 HTTP body 上：第 3 轮仍然带着第 1 轮的
  `tool_calls` 条目**和**它的 `role:"tool"` 结果，不是把结论复述成散文。
- **审批三档，全部由真实 Host 提案驱动**：
  - `irreversible`（删画面）：出卡、`data-agent-effect-class="irreversible"`、**只有**「这次」、带边界行；
    「本会话」「总是」用同一张卡上刚证过的探针 `expectAbsent` 掉。批准后线上 `"applied":true` 且磁盘节点 3→2。
  - `reversible_local`（时间轴计划）：出卡、三档俱全、摘要里是真实字幕文案；批准后字幕落进
    `payload.timeline.textClips`。
  - **safe-auto 写入不出卡**：同一选择器、同一面板、上一步刚证过它会出现，这一步 800ms `expectAbsent`，
    而写入真的落地（节点 2→3）——不是恒真的空断言。
- **排队 → 插队 → 立即中断**：hold 住一轮，再发两条，插队后队列变成 `[QD, QB, QC]`，**Host 快照顺序**与
  **实际出站到达顺序**两条独立证据一致；中断后已完成的回复与已落盘的 3 个节点都还在。
- **「模式」弹层只剩工作模式**：恰好一个 `role=radiogroup`（提问 / 编辑选中 / 自主），
  `approval-mode-*` 与 `spend-policy-*` 均证明不存在。
- **能在 loopback 下真触发的异常态**：超长用户气泡折叠、@ 选择器空态、>3 条排队折行、`stopped` 状态、
  工具失败态。
- **确认了三个「设计做了但接不上」**：`ResidentSpendCard` / `ResidentCandidatesCard` / `ResidentQuestionCard`
  在整条旅程里出现次数为 0，与代码侧「零调用点」的静态发现一致。`ResidentPlanCard` 只会以 `loading` 出现。
  这三件（件 11 价格算不出 / 件 6 多候选 / 件 8 长反问）在跑着的应用里**不可达**——已如实记录，未在本轮接线。
- **真跑不出来的**：产物加载中 / 失败卡、计划卡的非 loading 态，需要真实 production-run / artifact Host item，
  纯文本 vendor 造不出来。**明说，而不是把断言弱化成恒真。**

---

## 5. 情绪摩擦日志

「舒服吗」，不是「元素在不在」。下表来自带真实任务走完整旅程后逐屏记录，**本轮已修的标 ✅**。

| # | 用户看到什么 | 摩擦 | 严重度 | 处置 |
|---|---|---|---|---|
| 1 | `K_T2_DONE：前 5 秒放招牌灯，中间 20 秒给你说的那` —— 句子就这么断了 | **读不到 Nomi 的回答**。实测一条 46 字的回复被裁掉 138px，没有展开链、没有任何提示 | P0 | ✅ 已修 · §5.1 |
| 2 | 删画面的确认卡上写着「执行确认 / 查看细节 / 范围：仅这次操作 / 查看细节 / ✓ 这次」 | **要你批准一次不可逆删除，却一个字都没说删什么**。没有名字、没有数量、没有「删除」二字；「查看细节」还印了两遍 | P0 | ✅ 已修 · §5.2 |
| 3 | 面板说「三个镜头节点已经摆好了。」 | **工具其实失败了，界面报的是成功**。Host item 是 `status:"failed"`，画布是空的，对话流里没有失败卡、没有写入失败行、什么都没有 | P0 | ✅ 已修 · §5.3 |
| 4 | 队列里 4 条时，状态文字在面板边缘被切掉，⋮ 和 ✕ 看不见 | **排队的任务没法取消、编辑、暂停或调序**。实测 8/8 个按钮落在面板右边界之外 | P0 | ✅ 已修 · §5.4 |
| 5 | 打 `@` 弹出「画布对象 · 镜头 03 · 雨夜巷口 / 文本选区 · 第三章第 4 段 / 预览帧 · 00:08 / 时间线区间 · 00:06–00:14」 | **把编造的数据当成实时状态展示**——画布是空的、文档没有章节、时间轴是空的。用户会去引用一个不存在的「选区」 | P1 | ✅ 已修 · §5.5 |
| 6 | 「工具调用 · N」这一块永远待在用户自己第一条消息**上面** | 读起来像「Nomi 在我开口之前就动手了」；四次工具调用被压成一行，和三个面的工作全都脱开 | P1 | 未修（要重排对话流的渲染顺序，超出本轮边界） |
| 7 | 中断后：问题按发送顺序排、回答按执行顺序排，堆成两坨 | **分不清哪个答案对应哪个问题** | P1 | 未修（同上，属对话流排序） |
| 8 | 忙碌时发送键变红=停止，排队只能靠回车 | 「把这条排上」没有可见入口 | P1 | 未修（介入槽已有 排队/插队/中断 三键，属可发现性微调） |
| 9 | Nomi 摆完节点后，节点编辑器浮在镜头 1 上 / 被视口底边裁掉；节点和工具栏、Agent 面板互相压 | 刚说完「摆三个镜头」，画布就是一团乱 | P1 | 未修（画布节点布局，属另一条线） |
| 10 | 「还有 · 约 35 字」 | 这个数字是假的：实际藏了约 340 字（算的是 `text.length - 360`，而裁剪是 `line-clamp-3`，两者根本不是一回事） | P2 | ✅ 已修 · §5.6 |
| 11 | 批准后 toast 盖住面板标题；对话流滚回上一条，答案在折叠线以下 | 成功了却像「刚才是不是没生效」 | P2 | 未修 |
| 12 | 「还能聊 ~39 轮」倒计时；全新空项目上就挂着「分镜方案 ⚠」；删除回执上写「共 0 镜 · 已选 0」；两行一模一样的「已批准 / 已完成」 | 没来由的预算焦虑、没来由的警告、没有意义的计数、看不出批的是什么的回执 | P2 | 未修 |
| 13 | 确认卡三档「这次 / 本会话 / 总是」，可逆卡上**「本会话」是深色主按钮**，不可逆卡上「这次」只是描边 | 同一个位置、不同的含义；视觉上的默认选项恰恰是**更宽**的那一档 | P2 | 未修（属样张层取舍，建议随下一轮 UI 走查一起定） |
| — | 时间轴计划卡说「在 0:00.00 加字幕「汤先到，人后到」」，时间轴画出待定条，批准后字幕落到文字轨 + 预览 +「已按计划应用到时间轴 · 撤销」 | **这条路是真的好** —— 也正因为它好，才证明删除卡的空白是缺陷而不是设计 | — | 保持 |

### 5.1 回复被硬裁成一行（P0）

`ResidentFoldableText` 对**没超过折叠阈值**的内容加了 `h-5 overflow-hidden` + `whitespace-nowrap`，
于是一行到 360 字之间的所有回复都被裁在面板宽度处，**没有展开链、没有渐变、没有任何提示**，只有一个原生
`title` tooltip。壳里还重复了一遍同样的钳制。

根因是**把样张量出来的派生值当成了规格**：`agent-ui-spec.generated.json` 里 `data-agent-reply` 的 `h:19`
是那张样张里**那一句示例文案**的高度，不是「所有回复都必须一行高」。已删掉 `singleLine` 这个属性本身
（唯一使用者就是这个 bug）与两处钳制；超长仍走 `line-clamp-3` + 展开链，一字未改。

### 5.2 不可逆删除的确认卡什么都不说（P0）

`residentToolDisplay.ts` 靠**工具名的子串**判断一次调用在做什么。但 MCP 面收敛之后名字是通用的
（`nomi_canvas_maintenance` / `nomi_canvas_edit`），语义搬进了 `args.operation`。于是真正的
`delete_canvas_nodes` 一个分支都匹配不上，掉进 `toolInspectDetails` 这个通用兜底——用户被要求批准一次
不可逆写入，而卡上没有任何关于它删什么的信息。

修在**最早的共享边界**：新增 `toolIdentity(name, args)`，四个识别函数一起改吃「名字 + operation」。
顺带挖出一个一直存在的排序错误：`canvas_nodes` 是 `delete_canvas_nodes` 的子串，所以写入分支会吞掉删除，
`readableToolPreview` 里的删除分支对 pi 侧别名**本来就是死代码**。拆出 `isCanvasDeleteToolName` 作为单一
owner，并把它排在写入之前。

### 5.3 失败的工具被渲染成成功（P0）

Host 老老实实记了 `status:"failed"`，但只有 `kind:"failure"` 的 item 会渲染成卡片；`kind:"tool"` 的
item 在对话流里直接 `return null`，失败信息只活在折叠起来的工具块里，而那个块的表头只写「工具调用 · N」、
`data-state` 只有 `running` / `done` 两种。净效果：**界面宣称做完了一件根本没做的事。**

`ResidentToolChips` 现在在有失败步骤时把 `data-state` 置为 `failed`，并在折叠表头上直接挂一枚危险色徽标
（`data-agent-tool-failed`，「N 步没成功」）——不展开也看得见。

### 5.4 排队项的控件被挤出面板（P0）

队列容器是 grid，行是 flex。grid item 的 `min-width` 默认 `auto`，行的固有宽度于是把整行撑出面板，
`shrink-0` 的状态与按钮被推到可视区之外——**排队的任务因此无法取消 / 编辑 / 暂停 / 调序**。
给容器和每一行补 `min-w-0`，标签回到 truncate，控件回到面板内。

### 5.5 @ 选择器把编造的数据当实时状态展示（P1）

四条参考项的副标题是从样张里抄来的示例串（「镜头 03 · 雨夜巷口」「第三章第 4 段」「当前帧 · 00:08」
「00:06–00:14」）。在一个全新的空项目上，用户看到的是**看起来像真实选区的假数据**。四个 key 已删，
改成从真实选择 derive：画布看 `selectedNodeIds`、文档看 `activeDocumentId`、预览 / 时间轴看
`selectedClipIds`，各自有「已选 N」与「没有选中」两种说法。

### 5.6 复走时又冒出来的三件（同族，一并修掉）

复走（`docs/lessons/experiential-qa-emotion-log.md` 第 4 步）不只是确认前面五条修好了，它自己又暴露三件：

1. **确认卡仍然不说「删」。** §5.2 只修好了摘要（从「查看细节」变成「1 个对象」），但卡的**标题**是写死的
   `agentResident.approvalMode`「执行确认」。于是用户读到的是「执行确认 · 1 个对象」——数量到位了，**动词没有**。
   改成：审批卡的标题就是这次要批的那件事（`readableToolName(t, toolName, args)`），删除卡现在写「删除镜头卡」。
2. **只读工具也在掉进通用兜底，而且补完之后发现补法本身就是那个 bug。** `readableToolPreview` 根本没有
   「读」这一支，`nomi_document_read` 的效果行写的是「查看细节」——和一个认不出来的工具一模一样。
   第一版是继续往那个 substring 阶梯上加分支；加完一量才看清真正的规模：**66 个 surface alias 里有 25 个
   落进通用「工具」**，其中包括 `apply_edit_plan` / `insert_at_cursor` / `create_camera_move` 这些 pi 侧
   真正会被 agent 调到的名字。也就是说，刚刚把审批卡标题改成「这次要批的那件事」的那一步，对这 25 个
   反而会更差（从「执行确认」变成「工具」）。

   **所以改法换了根**：不再从名字猜，而是**先问拥有这个工具的注册表它是什么**——
   `toolIdentity` 现在把 `resolveCapabilityAlias(name)?.contract.id` 放在最前面，
   pi 的 `apply_edit_plan`、MCP 的 `nomi_timeline_edit` 与 capability id `timeline.write` 从此归一到同一个串。
   `isReadOnlyToolName` 同理直接信 contract id（`propose_edit_plan` 属于 `timeline.read`，字面里那个 "edit"
   骗不了它——任何词法匹配都会在这里判错）。结果：**22 个能力 + 66 个别名，通用兜底为 0**。
   由 `CAPABILITY_CONTRACTS` 与 `CAPABILITY_ALIAS_ENTRIES` 双双派生的类级测试钉住——新注册一个能力、
   或改任何一个 surface 的别名，测试就红，不用等有人在界面上看见。
3. **折叠链上的字数是假的。** `estimatedExtra` 算的是 `text.length - 360`，而真正的裁剪是 `line-clamp-3`——
   一条约 395 字的消息显示三行，却告诉你「还有约 35 字」。**我们并不知道被裁掉多少**，所以别报那个数：
   改成报一个无论裁多少都成立的数——「全文约 N 字」。同时把 `title` 悬浮兜底只加回**真的被折叠**的那些回复
   （§5.1 顺手把它一起删了，短回复不需要，超长回复需要）。

### 5.7 复走的实测数字

| 项 | 修前 | 修后 |
|---|---|---|
| 回复裁剪 | `[{46 字, 裁掉 138px}, {33 字, 裁掉 6px}]` | `[]`（横竖两个方向都为 0；并钉住某条回复实际占 2 行，防「本来就没内容」的空断言） |
| 删除卡上的「查看细节」 | 2 次 | 1 次；摘要变成「1 个对象」；标题变成「删除镜头卡」 |
| 失败的工具步 | 界面无任何痕迹 | `[data-agent-tool-line][data-state="failed"]` + 折叠表头上的危险色徽标「1 步没成功」 |
| @ 选择器 | 4 条编造的示例串 | 4 条编造串全部消失，4 条 derive 出来的文案全部正确 |
| 排队按钮落在面板外 | 8 / 8 | **0 / 8**（同时断言按钮数仍是 8，防「按钮消失了也算通过」） |

### 5.8 冷重启这一段（幕七–幕九，第三轮补上）

真进程死亡（`stopApp()` 断言 `exitCode`/`signalCode` 非空）、同一份 `tempRoot` / `settingsDir` 重开、
从项目库卡片的「继续创作」重新进项目——**全程没有 `win.reload()`**
（`docs/lessons/walkthrough-no-win-reload.md`：原地刷新后活动项目恒 null，面板静默空掉，长得和真 bug 一模一样）。
三个不同的 PID 有记录，两次冷启的模型请求数都断言为 0。

重启后仍在：整条对话（按文案逐条断言）、线程仍可在菜单里选中并把对话调回来、时间轴上的字幕
「汤先到，人后到」（磁盘 payload 与 UI 各断一次）、画布 3 个节点（UI 与磁盘 id 一致）。

**然后是本轮修的那个缺陷**——它只在跨重启时才现形：新建第二条对话 → 删掉**装着全部 turn 的旧线程** →
再删掉**自己正待着的这条**（修前这个按钮是永久静默的）→ 第二次冷启动 → 面板正常打开、菜单里是幸存的那条、
**并且一轮新对话能完整往返**。要是 Host 抛了 `ProjectAgentRepositoryIntegrityError`，这些一件都发生不了。

**阳性对照**（防「它能打开是因为本来就没事」）：走查扫持久化快照的 `recentAppliedCommands`（满 64 条），
断言其中**仍然点名着已删除线程**的条目数 **> 0**。实测 `deletedThreadsStillNamedInHistory` 两条。
也就是说，修复所针对的那个危险状态每次跑都被真实复现出来，而 Host 照样打得开。

---

### 5.9 复走第三轮：截图看见了 DOM 断言看不见的两件事

断言绿了不等于人看得见。第三轮把截图和 DOM 分开看，又抓到两件——**都不是断言能替代人眼的例子**：

1. **理由是修出来了，但它落在折叠里。** 卡在静息状态只显示四行（「删除镜头卡」「1 个对象」「范围：仅这次操作」
   和一条灰条「查看细节」），理由要点开才看得到。更糟的是 `InterventionSlot` 的那条 `<summary>` **没有展开箭头**
   （`ResidentApprovalCard` 的有），看上去就是一条不可点的灰条——用户点它的概率很低。
   断言过了，是因为断言读的是 DOM 里的隐藏文字。**已修**：模型给的理由现在直接接在卡面的摘要行上
   （「1 个对象 · 这个镜头用不上」），并给那条 `<summary>` 补上了和另一张卡一致的展开箭头。
2. **理由那一行被标成「生成设置」。** 这个 label 是从生成路径继承下来的，**删除卡上根本没有任何东西在生成**。
   已按工具类型分开：真生成走「生成设置」，其余走「这次的设置」。

---

## 6. 还没修完的那一件（诚实交代）

**删除确认卡仍然不说删的是哪一个。** 标题修好了（「删除镜头卡」），数量在（「1 个对象」），
模型自己给的理由也接到了卡面上（「这个镜头用不上」）——但画布上摆着三张镜头卡、其中一张的标题
就叫「多余的一个」时，卡上只说「1 个对象」，**从头到尾没说是哪一张**，展开「查看细节」也只是把数量再讲一遍。

信息是有的（args 里有 `nodeIds`，渲染层手里有画布节点），本轮**没有做**，原因写清楚：
① `interventionRecord` 就是真实的 tool `args`，会流进批准路径当可编辑参数，往里塞展示用字段有把假字段
注进真实调用的风险；② 壳文件已经贴着 800 行硬顶（799），这个改动必须落在别处。
两条都是设计约束不是借口，已按 file:line 交出单开。

卡现在静息状态长这样（复走实测，`<details>` 关着时可见）：

```
删除镜头卡
1 个对象 · 这个镜头用不上
范围: 仅这次操作
›  查看细节
[ ✓ 这次 ]   [拒绝理由（可选）]  ✕ 拒绝
```

**理由接到卡面上是这张卡从「确认框」变成「可判断的东西」的那一步**——不用点开就答齐了「做什么 / 多少 /
为什么 / 我这个「是」管多远」。但它现在是**可行动的，不是可核对的**：「这个镜头用不上」是一句关于
**你看不见的那个对象**的断言，你没法拿它跟被断言的东西对一下，所以按下「这次」是**信任，不是判断**。

眼下之所以还撑得住，是因为用户四秒前刚打过「把第三个多余的镜头删除」，目标还在他脑子里——
**卡是靠那句指令的记忆在撑，不是靠自己的内容**。而这个面板的设计恰恰会把两者拆开（对话会排队、会插队，
一张删除卡完全可能在造成它的那句指令之后两轮才浮出来），并且**一放大就崩**：「3 个对象 · 这些镜头用不上」
是没法回答的。所以结论是：**即时指令场景下不是阻断项；一旦请求含糊、成批或延迟，它就是阻断项。**
按这个定位单开，不当已关闭。

顺带两条同一张卡上的观察，都记下来不自己拍板：

- **展开抽屉现在是空的。** 点开「查看细节」只有「作用对象：1 个镜头卡」和「这次的设置：理由：…」，
  两条都已经在卡面上了。抽屉花一次点击、回报为零——**镜头名字正该放在这里**，在上面那件修好之前，
  这个箭头是在请人进一间空屋子。
- **全 App 唯一的不可逆卡，穿的是和可逆卡一样的衣服**：同样的 accent 边框、同样的 ⏸ 图标，
  「这次」是描边按钮，而**整张卡上唯一有颜色的词是「拒绝」**。卡读起来比它实际要做的事平静。
  这属于样张层的取舍（R8：用户可见改动先出样张、由用户拍板），**本轮不自己改**，交给用户判断。

---

## 6.5 设计实验室的三张基线为什么动了（PR 前后对比）

合并最新 main 后带进来了 #516 的设计实验室视觉基线。本轮改动动了三张，**每一张都是预期内的**，
逐张交代（`pnpm run design-lab:update` 已更新，`check:design-lab` 全绿，其余 42 张一像素未动）：

| 基线 | 前 | 后 | 为什么 |
|---|---|---|---|
| `live-07-fold-midlength`「现役 · 中长文本（262 字，够不着折叠阈值）」 | **一行，被截断** | 262 字全文，正常换行 | **这张基线拍下来的就是那个 bug 本身**——状态名自己写着「够不着折叠阈值」，而基线里的它被裁成了一行。见 §5.1 |
| `live-01-intervention-approval`「现役 · 介入槽（批准）」 | 「看看细节」是一条灰条 | 「看看细节」前多了一枚 `›` 展开箭头 | 见 §5.9：那条 `<summary>` 原本没有箭头，看上去不可点 |
| `form-17-question`「形态 17 · 反问卡」 | 问句带 `h-5` 钳制 | 问句按自然行高排 | §5.1 删掉 `ResidentFoldableText` 的短文本钳制的连带效果；文字内容一字未变 |

> 三张里最该看的是第一张：**一张被批准过的视觉基线，把一个 P0 缺陷固定成了「正确的样子」**。
> 视觉基线证的是「没变」，证不了「本来就对」——这也正是它需要配一次真实用户走查的原因（P3）。

---

## 7. 复走与门岗

- `pnpm run typecheck` ✅
- `electron/capabilityCore` + `electron/projectAgentHost` 全量单测 ✅（1403 passed）
- `src/workbench/ai` 单测 ✅（含由 `CAPABILITY_CONTRACTS` / `CAPABILITY_ALIAS_ENTRIES` 派生的类级标签测试）
- `pnpm run gates` ✅
- 走查 `tests/ux/agent-real-user-conversation.walk.mjs` 连续两次全绿；`check:walkthroughs` 六项棘轮零新增。
- 真宿主复走：Claude Code 与 Codex 各重跑一遍，修后行为见 §2.2 / §2.3 引用的 trace。
