# Agent lane · 阶段 3 前置探针实跑记录（P1 / P2 / P3 / P5 / P6）

> 状态：✅ 已完成（探针进仓库当阳性对照；本文只记实跑结果与裁决，不改产品代码——P6 的一处投影修正除外，见 §6）
> 对应：[`docs/plan/2026-09-07-agent-rebuild-stage3-5-deep-plan.md`](../plan/2026-09-07-agent-rebuild-stage3-5-deep-plan.md) §4.3「最可能逼我们再返工的五处 + 便宜探针」。P4（花费行）不在本轮。
> 基线：`origin/main@4f55e2a36`（#591 已合）。pi 锁定 `0.85.1`，file:line 相对 `node_modules/@earendil-works/`。

日期：2026-09-07 · 性质：探针 + 裁决（零额度为主；P5 ③ 花了真实模型 8 次请求，见 §4）
服务对象：阶段 3（闸与三行）开工前的两条岔路——3a「审批停在钩子里等」与 3c「看门狗归一」——以及阶段 4 迁移、阶段 2 扁平 schema 的返工判断。

## 0. 一句话结论

| 探针 | 结果 | 一句话裁决 |
|---|---|---|
| **P1 ①** 等待期状态 | 🟡 绿但**词表不同** | pi 快照**从不**产出 `"running"`；等待期 `operation.status === "open"`、`runningTools` 空、`queues` 里能看到 `write`/`steer`、零模型请求在飞。**不翻方案 B**，方案 §1.2 / §4.3 把 `running` 改成 `open`，「在等你」由宿主投影（同 §1.2 已写的 `LaneProjection.pending`） |
| **P1 ②** abort 穿透 | ✅ | `lane.abort()` 打断钩子里的 race；resolve 那一臂得到 pi 自己的 `abortedOutcome`（"Tool execution was cancelled before completion."）；`AbortResult.steer` 带回未消费的插话。**reject 那一臂不能用**：异常被 `hooks.js:121-125` 洗成 `block.reason`，模型看到的是 `signal.reason.message`（"Abort requested"）。宿主 gate 必须 **resolve-on-abort** |
| **P1 ③** 崩溃恢复 | 🔴 **与方案 §1.5 相反** | 真崩溃（子进程 SIGKILL）后 `resume()` **不合成 interruptedOutcome**：停在预检里的调用还在 `planned`（intent 没发布），`runSequential` 走 `startToolInvocation`（`drive/tools.js:376-386`）→ `before_tool` **再问一次**，钩子放行就真的跑了。恢复文案改：不是「重启前等你确认的动作没有执行」，而是**重启后这张确认卡会再弹一次**（或宿主在 resume 前把它 block 掉） |
| **P1 ⊕** 钩子抛异常 | ✅ 阳性对照 | `hooks.js:113-118`：抛 = block，工具没跑，`error.message` 逐字进 tool result、逐字到下一次请求 |
| **P2** 旧对话回填 | ✅ | 生产写入路径落的真实 v1 文件（6 条：model_change / thinking_level_change / user / assistant(toolCall) / toolResult / assistant）逐条 `appendMessage`/`appendCustomEntry` → close → 重开：**段数与顺序 = 源**；再跑一轮，供应商收到的历史里 `tool` 消息紧跟带 `tool_calls` 的 assistant。**pi 不校验成对**（阳性对照：toolResult 排在 toolCall 前照单全收）——成对与否是迁移脚本自己的责任 |
| **P3 ①** 无看门狗 | 🔴（预期中的红） | 首字节永不返回 → 5 s 后回合仍挂着、`projection().running === true`、只有用户按停能结束。G3c 的「今天会红」坐实 |
| **P3 ②** 超时归一 | 🟢 **方案 §1.6 的预测被推翻** | `observeNativeStream` 挂到 provider 上后：超时**不是** `aborted`。它自己以 `NativeStreamTimeout` 拒绝 `result()`，harness 记成 `stopReason:"error"` + 含 "timeout" 的文本，`isRetryableAssistantError` 认它 → `retry_scheduled` 触发、第二次请求成功、无 fault。3c **不需要**在 provider 适配器里另做归一 |
| **P5 ①** 扁平 schema 大小 | 🔴 | pi 字符启发式 ≈ **1 892** tokens；DeepSeek V4 Flash 真实 tokenizer（带/不带该工具的 prompt_tokens 之差）= **2 170** tokens。方案写的 ≤ 1 200 **红** |
| **P5 ②** 畸形参数 | ✅ | 三条二次序列化畸形（整包 / `anchors`+`shots` / `select`+`patch`）经 `prepareArguments` → ajv → 契约 parse 全过、落到正确 operation；摘掉容忍钩子的对照臂全红 |
| **P5 ③** 真实首调 | ✅ **3/3** | DeepSeek V4 Flash × 3 任务（建表 / 改行 / 排时间轴）：每次先 `nomi_canvas_read`，第二调 `nomi_storyboard_write` 且 `operation` 全对。**「根级扁平化后模型选错分支」这条返工风险今天没有出现** |
| **P6** 实验室夹具 | 🟡 2 格接上、1 格接不上 | `input-streaming` 接上真投影**逐像素相等**；`output-denied` 接上后红 → 投影错（行尾印了理由 + 多了展开体），**修投影不动基线**后逐像素相等；`output-available` 的「3 段 · 9.0s」摘要与「0.4s」用时今天的投影**给不出**，那一格保持手写，缺口钉进结构测试 |

**对 3a / 3c 方向的最终建议**：
- **3a 继续 A**（停在 `before_tool` 里等）。三条修正：① 状态词用 `open` 不用 `running`；② gate 必须 `Promise.race([决定, resolveOnAbort(hookContext.abortSignal)])`，被打断时 **resolve `undefined`**，不要 reject；③ 崩溃恢复不是「写失败卡」——`resume()` 会**重新问一次** `before_tool`，宿主要么让卡再弹一次（用户看到「重启前等你确认的动作，现在再确认一次」），要么在 resume 前自己 block（"重启前没确认，已取消"）。方案 §1.5 那一行「`interruptedOutcome`」只对**已发布 intent、跑到一半**的调用成立，对停在预检里的不成立。
- **3c 只做「挂上」这一件事**：把 `observeNativeStream` 挂进 `createNomiProvider()`，超时自然落成可重试的 `error`；不要再写归一层（写了就是 R28 说的第二份）。
- **阶段 2 扁平 schema 不回炉**：P5 ③ 三次真实首调全中，返工的触发条件（选错分支）没出现；token 超预算是真的（2 170 vs 1 200），但它是**上下文成本**问题不是**正确率**问题，放进阶段 3 的三行（上下文那一行会把它显形）再决定要不要瘦身。
- **阶段 4 迁移的第一档可行**：逐条回填顺序可靠；迁移脚本自己负责成对与压缩条目改写（pi 不替你查）。

## 1. 复跑方法

```
pnpm run test:agent-runtime          # P1 / P2 / P3 / P5①② 全在里面（216/216）
pnpm exec tsc -p tests/agent-runtime/tsconfig.json
pnpm exec electron .tmp/agent-runtime-tests/tests/agent-runtime/stage3-probe-p5-real.electron.mjs   # P5③，走 app 设置读 key
npx vitest run src/devlab/designLab/v4/laneDrivenFixtures.test.ts src/workbench/ai/lane         # P6 结构半
NOMI_DESIGN_LAB_UPDATE=1 npx playwright test -c tests/ux/design-lab/playwright.config.mjs --update-snapshots=none \
  --grep "v4-tool-(input-streaming|output-available|output-denied)"                              # P6 像素半（不写基线）
```

| 文件 | 探针 |
|---|---|
| `tests/agent-runtime/stage3ProbeHarness.mts` | 裸 lane 夹具（同 `laneHost.mts` 的装配，只把 `lane`/`harness` 交出来；不是第二个宿主） |
| `tests/agent-runtime/stage3-probe-p1-approval-wait.test.mts` + `stage3-probe-crash-child.mts` | P1 ①②③⊕（③ 用子进程 SIGKILL 做真崩溃） |
| `tests/agent-runtime/stage3-probe-p2-legacy-import.test.mts` | P2 ①② |
| `tests/agent-runtime/stage3-probe-p3-watchdog.test.mts` | P3 ①② |
| `tests/agent-runtime/stage3-probe-p5-storyboard-schema.test.mts` | P5 ①② |
| `tests/agent-runtime/stage3-probe-p5-real.electron.mts` | P5 ③（Electron 进程；key 不打印不落盘） |
| `src/devlab/designLab/v4/laneDrivenFixtures.ts` + `.test.ts`、`states/01-vocabulary.tsx` | P6 |

## 2. P1 · 审批停在 `before_tool` 里等

### 2.1 ① 等待期（`stage3-probe-p1-approval-wait.test.mts:71-89`）

| 方案 §4.3 写的 | 实跑 |
|---|---|
| `operation.status === "running"` | **`"open"`**。0.85.1 的快照与 `inspectExecution` 只在 `open` / `aborting` 之间取值（`harness/runtime/lane.js:1444`、`:864`；归约器 `reducer.js:22` 起手就是 `open`）。`OperationStatus` 类型里的 `"running"` 在快照上从未出现 |
| `runningTools` 为空 | ✅ 空——停在预检里的调用 `execute` 还没开始，pi 眼里它不存在 |
| `queues` 里 `kind:"write"` 可见 | ✅ 等待期 `appendCustomEntry` 被排进 inbox 成 `write`，**不会**写在 toolCall 与 toolResult 之间（`lane.js:1490-1545`）；`steer` 同样可见 |
| 无模型请求在飞 | ✅ loopback 计数恒 1 |

**顺带实核的一条坑**：等待期排进 inbox 的宿主记录在 **abort 之后仍不落盘**（abort 不是一个边界），要等下一次 idle 时的 append 或下一轮才被一起冲出去、且排在前面。宿主若在钩子里写「你取消了」的记录再 abort，那条记录会悬在 `queues` 里——写记录要放在 abort **之后**的 idle 路径上。

### 2.2 ② abort 穿透（`:91-114`）

两臂只差被打断时是 resolve 还是 reject：

| 臂 | 模型看到的 tool result |
|---|---|
| resolve-on-abort | `"Tool execution was cancelled before completion."`（pi 自己的 `abortedOutcome`，`drive/tools.js:96-101`）|
| reject-on-abort | `"Abort requested"`——`hooks.js:121-125` 把异常洗成 `block.reason`，那是 `signal.reason.message`，一个用户从没说过的内部串 |

`AbortResult.steer` 带回 `[{role:'user', content:[{type:'text', text:'不对，横屏'}]}]`——输入框能拿回没送出去的话。run 结果 `ok`，不 fault，不多花请求。

### 2.3 ③ 真崩溃后的 `resume()`（`:148-197`）

方法：子进程用生产路径 `openLane` 打开会话、gate 永不回答、把 sessionId 打到 stdout；父进程 `SIGKILL` 它，再用正常重开路径打开同一条会话（同进程里假崩溃会撞 `laneSession.mts` 的单持有者名单，等于测一条生产走不到的路）。

| 方案 §1.5 预测 | 实跑 |
|---|---|
| 「工具只有 `replay:"safe"` 才重跑，我们全部 `never` → `interruptedOutcome`」 | 那条规则只管**已发布 intent** 的调用（`recoverToolInvocation`）。停在预检里的调用状态还是 `planned`，`runSequential` 对它走 `startToolInvocation`（`drive/tools.js:376-386`）——**`before_tool` 再被问一次**，放行就真跑（文稿真的被写入），不写任何 interrupted/cancelled 结果，回合继续、只多一次模型请求 |

裁决：**恢复文案改**（见 §0）。并且这是件好事——它让「重启后再确认一次」成为免费的默认行为，比合成一张失败卡更接近用户想要的。

### 2.4 ⊕ 阳性对照

钩子 `throw new Error(reason)` → 工具没到领域端口、tool result `{text: reason, isError: true}`、下一次请求正文含 reason。G-13 在结构上已满足。

## 3. P3 · 看门狗与超时归一

- **①**（`stage3-probe-p3-watchdog.test.mts:39-51`）：首字节永不返回的 loopback 下，生产 `openLane` 的回合 5 000 ms 后仍 pending，`requests.length === 1`，`projection().running === true`；`execute({kind:'abort'})` 是唯一出口。这条断言**只可能因为看门狗存在而翻红**——3c 落地时它就是 R17 要的先红后绿。
- **②**（`:53-85`）：把 `createNomiProvider` 的产物包进 `observeNativeStream`（`firstResponseMs = idleMs = 300`）后：回合 1.3 s 结束；事件序列 `retry_scheduled` → `retry_end`，无 `fault`；`retry_scheduled.errorMessage` 匹配 `/timeout/i`；两条助手消息的 `stopReason` 里**没有** `aborted`；第二次请求拿到排队的回复，最终文本 "Recovered."。
  方案 §1.6「`fail()` 走 `controller.abort(error)` → 极可能落成 `aborted`」的推断错在：`controller.abort` 关的是**上游**流，harness 拿到的是 `observeNativeStream` 自己 `rejectFault(NativeStreamTimeout)` 那条拒绝，走的是 error 分支。

## 4. P5 · 扁平版 `nomi_storyboard_write`

### 4.1 ① 大小

| 量法 | 数 |
|---|---|
| 字符 | schema 6 415 + description 1 149 |
| pi `estimateTokens`（字符启发式） | schema 1 604 + description 288 = **1 892** |
| DeepSeek V4 Flash 真实 tokenizer（prompt_tokens 带该工具 5 894 − 不带 3 724） | **2 170** |
| 四个画布工具合计（pi 估计） | read 154 · canvas_write 1 439 · storyboard_write 1 892 · shot_reference_write 1 164 |

方案预算 ≤ 1 200 **红**。测试把「今天 > 1 200 且 < 2 200」钉住：它长大或有人把预算当成已达成时红。

### 4.2 ② 畸形参数

| 畸形 | 容忍臂 | 对照臂（无 `prepareArguments`） |
|---|---|---|
| A · 整包参数是 JSON 字符串 | ✅ 首调非错、领域端口收到数组 | ❌ 拒收、端口零到达 |
| B · `anchors` / `shots` 是 JSON 字符串 | ✅ | ❌ |
| B′ · `select` / `patch` 是 JSON 字符串 | ✅ 落到 `patch_shots`，`select`/`patch` 为对象 | ❌ |

### 4.3 ③ 真实模型（key 走 app 设置的读取路径）

环境：Electron 进程 `app.setName('nomi')` + `userData=~/Library/Application Support/nomi`，`decryptApiKeyRecord`（safeStorage）解出 `apimart` 凭据；`apimart/deepseek-v4-flash`，`temperature 0`，系统提示词经 `composeLaneSystemPrompt`（与生产同一份两段）。每任务在第一次 `nomi_storyboard_write` 处 `block + terminate`，不花第二轮。

| 任务 | 调用序列 | 首次分镜写入的 `operation` | 命中 | 首请求 prompt_tokens |
|---|---|---|---|---|
| 把故事拆成 3 镜图片分镜 | `nomi_canvas_read` → `nomi_storyboard_write` | `propose_storyboard_plan`（1 锚点 3 镜，字段全对） | ✅ | 5 945 |
| 第 2、3 镜改成 4 s 视频 | `nomi_canvas_read` → `nomi_storyboard_write` | `patch_shots`，`select:{kind:'indexes',indexes:[2,3]}`，`patch:{shotKind:'video',durationSec:4}` | ✅ | 6 004 |
| 分镜按顺序排到时间轴 | `nomi_canvas_read` → `nomi_storyboard_write` | `arrange_storyboard_to_timeline`，`nodeIds` 三个真实 id | ✅ | 5 906 |

**3/3**。花费：8 次请求（2 次量 token + 3 × 2），合计 prompt ≈ 4.8 万 token、completion 几百 token，DeepSeek V4 Flash 档 ≈ ¥0.05。每次「先读画布」是 guideline 第一条要求的行为，不是选错工具。

**坑一条（写进复跑方法）**：Electron 的 ESM 入口里 `ready` 要等入口模块求值完才发，顶层 `await app.whenReady()` 会互相等——第一版探针挂了 240 s 一字不出。用 `app.whenReady().then(main)`。

## 5. P2 · 旧对话回填

- 源：`createAgentContextService.run` 真跑一轮（loopback `read_shot` + 收尾文本）落的 `agent-thread-context-v1.json`；`importSnapshot` 读回 6 条 pi-coding-agent 条目。
- 回填：`message` → `lane.appendMessage`；其余（`model_change` / `thinking_level_change`）→ `appendCustomEntry('nomi.legacy.<type>')`。close → 重开 → `watch.snapshot.transcript` 与源逐条同形同序（6/6）。
- 再跑一轮：供应商请求里 `assistant(tool_calls:[legacy-read])` 的下一条是 `tool(tool_call_id:legacy-read)`，正文含旧结果。
- 阳性对照：把 toolResult 排在 toolCall 前面 `appendMessage`，pi **照单全收**（`lane.js:1487-1512` 只拒 `stopReason:"pending"` 的助手消息）。
- 没测的：压缩条目改写成用户消息后模型上下文是否连贯（§2.1 第二档）、[#8939](https://github.com/earendil-works/pi/issues/8939) 无 header 行的错误路径。留给迁移脚本本身的测试。

## 6. P6 · 设计实验室夹具接真投影

方法：手写的不再是 `ToolReceipt`，而是 pi 转录里的 entry（`LaneSnapshot`），经 `projectLaneSnapshot`（主进程）→ `laneViewModel`（渲染层）两层真投影得到收据，渲进同一格；用 `NOMI_DESIGN_LAB_UPDATE=1` 解开 v4 屏的「待拍板」跳过、`--update-snapshots=none` 禁写基线，与已拍板的 PNG 逐像素比。

| 格 | 第一次 | 处置 | 第二次 |
|---|---|---|---|
| `v4-tool-input-streaming` | ✅ 逐像素相等 | 保持接线 | ✅ |
| `v4-tool-output-denied` | 🔴 478 px：行尾印了拒绝理由、多了 `›` 展开体 | **投影错**：`laneViewModel.ts` 对被拒的调用只标 `output-denied`，不再把理由写进 `trailing`/`output`（拍板的格子行尾是「已拒绝」，理由住在用户填它的介入槽里）。单独 commit | ✅ 逐像素相等 |
| `v4-tool-output-available` | 🔴 摘要「3 段 · 9.0s」与用时「0.4s」缺失，行尾退成状态词 | **不是投影错，是投影缺两个数据源**：摘要要按能力渲染，用时要 `LanePart` 带调用/结果时间戳过桥。今天做不出来 → 恢复手写夹具，缺口钉进 `laneDrivenFixtures.test.ts` | ✅（手写） |
| 空态 | — | 空快照 → `items=[]`、`running=false`、`max`/`cost` 缺席（结构测试）；像素半要等 lane 驱动的 shell（阶段 4），`v4-empty-*` 三格今天走的是旧宿主 store | ✅（结构） |
| 审批等待中（approval-requested / 介入槽） | — | **无法由 `LaneSnapshot` 驱动**（P1 ①：停在预检里的调用在快照里不可见）。数据源 = 阶段 3 的 `LaneProjection.pending` | — |

基线 PNG 一张未动（`git status tests/ux/design-lab/__baselines__` 为空）。

阶段 3 三行落地前要补的两个投影数据源（从 P6 的红里读出来）：① `tool-result` 段带 `elapsedMs`（转录时间戳差）；② 每能力一个「一句话摘要」渲染点（喂 `details`），否则收据行永远只能画状态词。

## 7. 遗留（明标）

- P4（花费行 / `Model.tokenPricing`）本轮未做。
- P2 只验了消息 + 两条设置类条目；`compaction` / `custom_message`（PDF）改写后的模型连贯性未验。
- P5 ③ 只跑了一个模型（DeepSeek V4 Flash）× 3 任务 × 1 次；不是统计，是「返工触发条件今天没出现」。
- P6 的 `v4-tool-output-available` 与空态、审批等待三格仍是手写/旧 store 驱动，原因如 §6 表。
- `pnpm run delivery:preflight` 在脏工作区上跳过（前两位工人留下 4 个未提交改动）；分支已与 `origin/main` 对齐（0 behind）。
