# ComfyUI 接入主链阻断：认证服务的运行时依赖从没接上

- **状态**：已实现，等合入（分支 `fix/comfyui-certification-wiring-20260911`）
- **触发**：2026-09-11 第一次对着本机真 ComfyUI 跑的接入矩阵（`docs/research/2026-09-11-comfyui-workflow-matrix-real.md` §BUG-1/2/3，那份报告在 worktree `Nomi-comfy-matrix`，PR #743）
- **根因合同**：[`docs/fixes/2026-09-11-comfyui-certification-wiring.root-cause.json`](../fixes/2026-09-11-comfyui-certification-wiring.root-cause.json)（schema v3，`recurring`）
- **真机证据**：[`docs/plan/2026-09-11-comfyui-cert-evidence/`](./2026-09-11-comfyui-cert-evidence/)

## 一句话

一个**必需**依赖被写成 `optional`，于是「能力挂上了」和「能力真能用」变成两回事：
注册处一个字不传照样构造成功，所有「有没有这个能力」的检查全过，只有用户真的点下「确认验证」
才在闭包第一行炸——而那一炸被上游的 catch 洗成一个中性状态码，界面什么都不说。
结果是 **ComfyUI 接入这条产品能力，在 main 上从来没有真正跑通过**。

## 现象（真机，复现率 3/3）

7 行工作流 **7/7 能被正确解析**、缺件报告精确到文件名，但 **0/7 能真的跑起来**：

1. 粘贴工作流 → 分析 → 命名 → 导入 → 弹「确认接入并开始验证」→ 点「确认验证」
   → 弹层关闭、直接跳回模型首页显示「还没有接入生成模型」，**全程零错误提示**
2. `model-catalog.json` 里搜不到刚导入的名字
3. ComfyUI 的 `/history` 自始至终只有人工直连那几条——**Nomi 一次 `/prompt` 都没发出去**
4. 盘上 `capability/integration-sessions.json`：`{"stage":"failed","blockingReason":{"code":"certification_unavailable"}}`
5. 连带：ComfyUI 实例在设置里永远「未启用」（卡片按设计要等一条工作流认证晋级才启用，
   而那条路被堵死 → 死循环）；画布两个模型选择器里零个 ComfyUI 条目

## 根因链（逐跳，行号按本分支 base `origin/main@0cea000d8`）

| # | 位置 | 发生了什么 |
|---|---|---|
| 1 | `electron/main.ts:410` | `registerIntegrationSessionIpc()` —— **没传 service**（当时是 `service?`） |
| 2 | `electron/integrationCertification/integrationSession.ts:1643` | `singleton ||= createRuntimeIntegrationSessionService()` —— **零参构造** |
| 3 | 同文件 `:236` | `const runTask = input.runTask` = `undefined`；`fetchTaskResult` / `mintSpendGrant` 同理 |
| 4 | 同文件 `:536` | 但 `certifyComfy` **照样被挂进** `new IntegrationSessionService({ certifyComfy })` |
| 5 | 同文件 `:1422` / `:1561` | 于是两处「有没有这个能力」的检查**全部通过** |
| 6 | 同文件 `:377`（闭包第一行） | `if (!runTask \|\| !fetchTaskResult \|\| !mintSpendGrant) throw new Error("comfy_certification_unavailable")` |
| 7 | 同文件 `:1580` 的 catch | 经 `safeCertificationFailureCode` 的 `/unavailable\|runner/` 分支洗成 `certification_unavailable` |
| 8 | `src/ui/onboarding/IntegrationConfirmationPanel.tsx:62` | `confirm()` 拿到返回的会话投影后**根本不看**，一律 `onDone()` —— 最后一米把已经查明的原因丢掉 |

### 第二跳：接上依赖之后才露出来的那条

把依赖接上、真机复跑，`/prompt` 真的发出去了（ComfyUI `/history` 里能看到 Nomi 发的那条），
**认证仍然失败**。补上脱敏日志才看见原因：

```
ERROR onboarding comfy-candidate-no-output status=failed assets=0
  providerError=供应商没有返回任务编号，无法安全查询结果；已按失败处理。
```

`electron/runtime.ts` 的 `buildProfileTaskResult` 把「上游到底给没给任务编号」**算了两遍**：

| | 谁算的 | 看哪里 | 对本机 ComfyUI 的答案 |
|---|---|---|---|
| 一份 | `taskId`（进 `result.id`） | `response_mapping.task_id` → ComfyUI 的 `prompt_id` | **有** |
| 另一份 | `providerMeta.task_id` | `provider_meta_mapping` + `extractTaskId` 认得的 `id`/`taskId`/`task_id`/`jobId`… | **没有** |

而 `runTask` 里那道「上游没返回任务编号就按失败处理」的闸问的是**后一份**。
ComfyUI 把编号叫 `prompt_id`，只走 `response_mapping` 这一条路，于是那道闸对它恒答「没有」——
`result.id` 明明已经拿到了编号，整条认证照样必失败。

修法同族：**让它只有一个答案**。先 derive 出 `providerTaskId`，回填进 `providerMeta.task_id`/`query_id`，
最后才叠上本地兜底 `taskIdFallback` 得到 `taskId`——本地兜底刻意**不**回填，那道闸要拦的正是
「拿伪造编号去轮询」。`electron/comfyuiLocal.integration.test.ts`（真 HTTP 端到端）把这条钉死，
同时删掉了该用例里由调用方手工补 `providerMeta` 的那两行（调用方补一遍正是「两份答案」的另一种表达）。

**补充实锤**：`installRuntimeIntegrationSessionService` 与 `DispatchContext.integrationSessions`
在生产里**从来没有任何调用点**（已 grep 核实）。所以第 2 步的零参兜底不是「某条路径漏了」，
而是**唯一**的构造路径——GUI、外部 Agent 走 MCP、stdio，全都拿到同一个残废实例。

这正是 **R28** 点名的那一族（安全/关键依赖不许「optional + 欠账登记」），
与 #722「付费门缺人证时放行」同源：都是**一个必需前提被表达成可选**，一个 fail-open、一个 fail-silent。

## 修法：把前提搬回构造期，让编译器拦

1. **`ComfyCertificationRuntime`**（`electron/integrationCertification/types.ts`）——
   把三样运行时能力表达成**必填**契约；`createRuntimeIntegrationSessionService` 的入参改成
   `ComfyCertificationRuntime & {…可选…}`，缺一样**编译不过**。
2. **删双重态**——闭包第一行那行 undefined 重判同 commit 删除；`Dependencies` 上三个纯死的透传字段
   （类体从不读）一并删除，不留第二份「依赖在哪声明」的说法。
3. **取用口不再兜底造实例**——`getIntegrationSessionService()` 没装过就抛
   `integration_session_service_not_installed`。这只可能是启动顺序坏了，不可能是某个用户动作坏了。
4. **装配收成唯一一处**——新模块 `integrationSessionRuntimeInstall.ts`：
   `integrationSessionRuntimeDependencies()` 接真实 `runTask`（`electron/runtime.ts`）、
   `fetchTaskResult`（经 runtime re-export 的 `electron/tasks/taskResultQuery.ts`）、
   `mintSpendGrant`（`electron/spendGrant.ts`，适配成工厂要的形状）；
   `installIntegrationSessionRuntime()` 在启动期装成进程内唯一实例。
5. **三个主进程入口都装**——GUI（`main.ts` 的 `registerIpc`）、打包 MCP stdio server
   （`mcpStdioServer.ts`）、一次性 CLI host（`host.ts`）。
   这一条是写修复时**自己先踩到的**：只装 GUI 那一处，等于把 stdio 与 CLI host 两个进程的
   整条接入链从「残废」换成「硬抛」——由 `integrationSessionRuntimeInstall.test.ts` 的结构断言守着。
6. **失败要浮出来**——`integrationConfirmationOutcome.ts`（纯函数）：主进程说 `stage:"failed"`
   就留在原地并把 `blockingReason.code` 念出来（`modelSetup.integrationFailedWithReason`），
   其余才 `onDone()`。另外在 `start()` 的 catch 里补一条 `logError`：原始错误以前被彻底丢掉，
   真机上「明明 `/prompt` 成功了却报失败」时盘上和界面上都没有任何线索可查。

## 先查别人

1. **仓库里已有？** —— 同族处置在 `#722`：付费门缺人证时改成**拒绝**而不是放行
   （`electron/productionRun/runCommand.ts`，merge commit `3f3346ffb`；本分支 base 的第 2 条 commit）。
   结论：同一族（必需前提被表达成可选），处置方向已由仓库自己定死 = fail-closed，本条照抄该方向，
   区别只是那条 fail-open、这条 fail-silent。
2. **仓库里已有？** —— 做对了的对照样本：`electron/productionRun/productionRunService.ts:82` 起，
   `approvalReceiptAuthority` 缺席时**构造出一个 fail-closed 的 owner**，而不是留 undefined 等调用期炸。
   结论：本仓已有「必需依赖要在构造期给出确定行为」的先例，不需要发明新模式。
3. **规矩已有？** —— `docs/engineering-rules.md` R28「防线建在最早能拦住的那层：能让编译器拦的别留给门岗，
   安全关键依赖不许『optional + 欠账登记』」。结论：本条的修法（必填参数 = 编译期拦）就是 R28 的字面执行。
4. **生态里已有？** —— 「必需依赖在构造期校验」是 DI 容器（NestJS 的 provider 解析、InversifyJS 的
   `@injectable` 绑定校验）的既有标准做法，见 https://docs.nestjs.com/fundamentals/custom-providers
   （构造期解析不到 provider 就在应用启动时抛 `UnknownDependenciesException`，不推迟到请求期）。
   结论：**不引入** DI 容器——那属于引入新框架层，按 R29 要先出四列表 + 参考实现逐层对照 + 字段级裁决，
   代价远大于本条修复；而 TypeScript 的必填参数在本例里能提供同等强度的保证且零运行时开销。
   借的是它的**不变量**（构造期而非调用期），不是它的实现。
5. **真机事实已有？** —— `docs/research/2026-09-11-comfyui-workflow-matrix-real.md` §BUG-1/2/3
   已经逐跳核实过这条链，并存下了可复跑的探针脚本与 7 行工作流夹具。
   结论：不重跑矩阵，只复核行号（main 已前进）并复用它的探针写法与 SD1.5 夹具。

## 验收（R13/R16，本机真 ComfyUI）

脚本：`scripts/comfyui-certification-acceptance.mjs`（住 `scripts/` 不住 `tests/ux/`：它要一台真的
ComfyUI，CI 上没有；同目录的 `comfyui-real-server-verify.mjs` 是同一类，沿用既有约定）。
像真人一样只走界面，五条断言任一红就整趟红：

| | 断言 | 2026-09-11 15:47 实跑 |
|---|---|---|
| A / A2 | 会话不再 `certification_unavailable`，且走到 `completed` | ✅ `stage=completed reason=null` |
| B / B2 | catalog 里 ComfyUI vendor `enabled`，这条工作流 `enabled` | ✅ `comfy-workflow-mtwnis1a enabled=true` |
| B3 | 打开的是**拥有这条工作流**的那条连接（不是随便哪条 ComfyUI） | ✅ |
| B4 / B5 | 实例详情里不再写「未启用」，连接标着「已验证」 | ✅ 「已验证」「1 / 1 个模型已启用」 |
| C | ComfyUI 的 `/history` 里出现 Nomi 发的那条 `/prompt` | ✅ 新增 `26178be8…` |
| D | 画布节点的模型选择器里选得到这条 ComfyUI 工作流 | ✅ |
| E | 点生成后真出来一张图（产物落盘） | ✅ `assets/generated/2026-09-11/image-1789112819055.png` |
| E2 | ComfyUI 侧收到的正向提示词就是用户写的那句 | ✅ `a red apple on a wooden table` |

截图与产物：`docs/plan/2026-09-11-comfyui-cert-evidence/`（`after-01` … `after-13`）。
其中 `after-06-instance-enabled.png` 是连接详情、`after-12-generated.png` 是画布上的成图、
`after-13-asset-on-disk.png` 是落盘的那张 512×512 原图。

### 走查本身踩到的三个假信号（都已改成真信号）

写这趟验收时，脚本先后给过三个**看起来像产品结论**的假信号，记在这里免得下一个人重踩：

1. **点错了模型选择器** —— `button:has-text("自动选")` 命中的是右侧 Agent 面板的模型钮，
   于是报「picker 里没有这条工作流」，而界面上明明有。现在按「和『生成素材』(↑) 同一行、
   最左那个按钮」找节点参数条上的模型片，与当前选中哪个模型无关。
2. **提示词填进了聊天框** —— 节点的提示词框是 `contenteditable` div（「描述这一帧的画面...」是画上去的
   占位，不是 `placeholder` 属性），`locator('textarea').first()` 命中的是右侧 Agent 面板那个真
   `textarea`。而**空提示词照样出图**（SD1.5 对空串也画），所以不回读就永远发现不了：
   第一趟「验收通过」的那张图，ComfyUI 侧收到的正向提示词其实是空串。现在填完必回读，
   并到 ComfyUI 侧核对正向提示词（断言 E2）。
3. **在没有卡片的页面上断言「卡片上没有『未启用』」** —— 点「关闭」时连整个设置一起关掉了，
   于是那条断言在项目库首页上恒真。现在必须真的打开拥有这条工作流的那条连接的详情再断言
   （`expectAbsent` 的老坑：先证明你在你以为的现场）。

### 顺带看见、但不在本条范围内的

- 节点提示词框**逐字敲会丢字**：`pressSequentially` 无论 35ms 还是 150ms 延迟，最后都只剩一两个
  字母（走查改用 `fill()` 绕开）。这是那个受控 `contenteditable` 自己的毛病，与认证链无关，单独登记。
- 认证晋级会新建一条 **candidate vendor**（`comfyui-local--candidate-…`）并启用它，原来那条
  `comfyui-local` 仍 `enabled:false`，于是模型页同时列出两条「本地 ComfyUI」、两条都写「1 个待设置」。
  功能上不影响（工作流挂在启用的那条上、画布选得到、能出图），但这是可见的重复项，单独登记。

## 不动的东西

- 矩阵报告里的 **BUG-4**（新式 `["COMBO",{options}]` 缺件漏报，已有人在修 N1）、
  **BUG-5**（`LoadAudio` 槽被标成「图片」）、**BUG-7**（本机也说「消耗上游额度」）、
  **BUG-8**（只能粘贴 JSON，没有文件上传）、**BUG-9**（有视频输入却写「文生」）、
  **BUG-10**（导入面板挤在 760×560 里）—— 各自独立，不在本条范围，已在报告里登记。
- 同类站点横扫的其余结果（`getConnectionCertificationService` 的 `runCandidate?`、
  `appIntegrationSpendConfirm` 被 swallowing try 兜住的 `unavailable`）登记进根因合同的
  `same_class_entry_points`，**本条只修 ComfyUI 认证这一处**。

## 回滚

单个 commit，`git revert` 即可。回滚后行为退回「ComfyUI 接入必炸且静默」——
即 main 当前的状态，不会比现在更差。
