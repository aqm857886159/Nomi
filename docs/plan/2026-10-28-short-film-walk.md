# 短片走查在 Mac 和夜跑上都量得到「运行中 / 停止 / 重开」（I-short-film-walk）

改动名：`agent-v4-short-film` 走查的两处过期前提 + `agent-spend-priced-card` 走查漏 await　　线：I-short-film-walk　　类别：[其他]（测试 / 走查；不碰 `src/`、`electron/`）

> 纯走查改动：按 `docs/engineering/design-card.md` 只填带 ★ 的 5 格（1、2、3、4、9）。不新增功能、不改界面，所以 ★0 / ★7 / 格 5–8 不适用，理由写在各格里。

## 根因（证据在前）

| | 症状 | 直接原因 | 类根因 |
|---|---|---|---|
| A　夜跑红（ubuntu，run 40478193665，main 0c87662bc，产物 `nightly-walks-2`） | 走查 262 行 `toHaveAttribute('placeholder', /排队/)` 收到 null | Agent 输入框 2026-10-12（ed086ea3e）起是 PromptEditor（TipTap）：`[data-v4-control="input"]` 是 contenteditable，没有 `placeholder` 属性；占位是 Placeholder 扩展挂在**空段落**上的 `data-placeholder`，再由 CSS `::before { content: attr(data-placeholder) }` 画出来（`src/workbench/assets/tiptapPlaceholderClasses.ts`）。同一天 dabcf69af 把「读字」迁到了统一出口，占位这一处漏了 | 走查按组件当年的形态（标签 / 属性）读产品状态，产品换形态它就悬空。「读输入框的字」有统一出口 + 门（`composer-input-read`），「读输入框的占位」没有；10-12 起这一句就悬空，而这条走查只在夜跑里跑，没人在 PR 里看见 |
| B　Mac 本机红 | 213 行 `最小窗下对话流只溢出 35px`（本线在 main b51835990 上实跑复现，42 秒退出码 1） | 前提的「量」靠 fixture 回稿撑高度：`RECAP_TEXT` 用 `\n` 连五行，markdown 里单个换行是软换行，五镜渲染成**一段**（失败截图可见），本意是逐镜一行；高度只刚好够（任务书：Linux 够 80，Mac 只有 35） | 防恒真式的前提，其「量」由内容决定，却没有余量、也没记录实测值，平台字体 / 窗口底板一差就掉 |
| C　`agent-spend-priced-card` 夜跑红 | 55 行 `Received: Promise {}` | `pricedRow` 里 `card.locator(...).count()` 放进数组没 `await`（d3be41f5d，10-25 引入），`row.actionCount` 是个 Promise | 同 A：只在夜跑里跑，改走查的提交没真跑；它红着，就挡住了「报价卡动作行只留取消和主按钮」这条花钱卡检查 |

## 怎么改（换，不补）

1. **262 行**：`agent-runtime-walk-support.mjs` 新增 `composerPlaceholder` / `expectComposerPlaceholder`（与 `composerText` / `expectComposerText` 同族，Agent 输入框占位的**唯一读出口**），读的是空段落 `::before` 算出来的字——用户眼睛看到的那句；文案取词典 `agentPanelV4.placeholderRunning`，不写字面量。同一提交删掉旧的 `toHaveAttribute('placeholder', /排队/)`，不留并行写法。
2. **213 行**：80px 阈值不动、前提不删、不按平台跳过，**靠内容**——`RECAP_TEXT` 改成一镜一段（`\n\n`，一份真要「打印贴墙」的清单本来就该这样）并把每镜写全；实测溢出写进 `walk.report.minWindowFlowOverflowPx`，余量从此看得见。
3. **priced-card**：补上 `await`（单独一个提交，方便回滚）。

## ★1 用户怎么用

当我（发版负责人 / 夜跑值班）要在 0.24 发版前确认「Agent 从零做一条 20 秒短片」能走完——写脚本 → 改文稿 → 去画布 → 运行中改主意点停止 → 关掉重开东西还在——我想让这条走查在 Mac 本机和 Linux 夜跑上都能从头跑到尾，以便「停止（关系到花钱）」「重开（关系到丢东西）」这两件事有真量具。

1. 走查在隔离资料目录里起真 Electron，供应商是 loopback 夹具，每次模型调用预先声明；
2. 写脚本、改文稿、去画布；
3. 发一条会被夹具挂住的指令 → 输入框占位变成排队提示，停止钮出现；
4. 点停止 → 回合退出运行态，流里留一句中性的「已停止」；收起后小球不报「出错」（**r2 改**：用户自己点的停止不是坏消息，见 `## r2`）；
5. 关掉整个 App 再开同一个项目 → 文稿、对话、收据原样在，重启不产生任何模型调用；
6. （**r2 加**）重开后再发一轮，这回服务商整条回错 → 面板上留一条错误带 → 收起面板 → 小球报「有一步没成」：收起不吞坏消息，有了真量具。

**不做什么**：不改产品（`src/`、`electron/` 不碰，反例③临时去掉再按字节还原）；不降 80px 阈值、不删前提、不按平台跳过；不扫别的走查里同类写法（夜跑分诊线 R-nightly-new-reds 在普查，测试欠账挪 0.25）；不新增英文段。**已知坑**：占位文字不是属性、是 CSS 伪元素；markdown 单个换行是软换行；`::before` 的 `content` 读出来带引号。

**真实任务**：①本走查本身（真 Electron + 隔离资料 + loopback 夹具，零花费），Mac 连跑 2 遍；②同批的 `agent-spend-priced-card` 走查（中英两段）；③夜跑 ubuntu（合并后由协调看 `nightly-walks` 产物，本机没有 Linux，记 `unverified`）。真付费不在本单。

**指标（目标 → 信号 → 指标，量具都点名）**

| 目标 | 信号 | 指标 / 基线 → 目标 | 量具 |
|---|---|---|---|
| 短片走查在 Mac 上量得到运行中 / 停止 / 重开 | 退出码、最后一步名字、总秒数 | 连跑 2 遍退出码 0；基线 main 上 0/1（213 行 35px） | `node tests/ux/agent-v4-short-film.walk.mjs`（report.json 的 `result`） |
| 运行中那句断言证的是「用户看到的」 | 产品去掉那句 → 走查红 | 反例③ 真红，按字节还原后回绿 | 同一走查 |
| 前提有余量，不是刚好够 | 实测对话流溢出 px | ≥ 160px（阈值 80 的 2 倍）；基线 Mac 35px | report.json 的 `minWindowFlowOverflowPx` |
| 不新增「测试抄文案」 | copy-literals 基线 | `agent-v4-short-film` 1 → 1，`agent-spend-priced-card` 0 → 0 | `pnpm run check:test-copy-literals` |
| 花钱卡检查重新量得到 | priced-card 走查中英退出码 | 红 → 0，`actionCount` 为 2 | `node tests/ux/agent-spend-priced-card.walk.mjs` |
| Linux 夜跑保持绿 | 夜跑结果 | 未验证：缺量具（本机无 Linux），合并后看夜跑 | `nightly-walks` 产物 |

## ★1b 连带界面

不适用：不改任何界面、回执、通知、错误卡的文字；走查只读现有文案（词典 `agentPanelV4.placeholderRunning`）。

## ★2 谁说了算

- 「Agent 输入框此刻画给人看的占位」：产品侧 owner = `AgentPanelV4Composer`（选哪一句）+ `PromptEditor` / Placeholder 扩展（怎么挂）+ i18n 词典（说什么）；走查只读不写。
- 读它的走查入口（`git grep` 数过）：Agent 输入框的占位只有 `agent-v4-short-film` 这一处在读；`archetype-modebar.e2e.mjs:181` 读的是生成节点的描述框（另一个组件，已按 TipTap 的 `data-placeholder` 写）；其余读 `placeholder` 属性的走查读的都是普通 `<input>`（如 `library-layout.walk.mjs:177`），正当。新 helper 成为 Agent 输入框占位的唯一读出口。
- 同一份事实存几份：1（词典）。没有靠「东西不见了」去猜意图。碰 1 个概念（走查如何读输入框占位），没有新增 owner。

## ★3 一致与复用

- 复用：`uiText`（`tests/ux/full-walk/invariants.mjs`）按键取文案；helper 与 `composerText` / `expectComposerText` 同文件同风格；读伪元素用浏览器标准的 `getComputedStyle(el, '::before')`，不自写任何东西（P0：这不是我们独有的）。
- 第二份定义：无。旧的 `toHaveAttribute('placeholder', …)` 同提交删掉。
- `check:test-copy-literals`：断言里不抄词典文案；`STARTER_FIRST`（基线里那 1 处）不动。

## ★4 全状态（走查读到什么）

- 运行中、框空：读到词典里那句排队提示。
- 空闲、框空：读到另一句（`agentPanelV4.placeholder`），不会被当成排队提示。
- 框里有字：占位不画，读到 `null`。
- 样式丢了（属性在、`::before` 画不出）：`content` 是 `none`，读到 `null`——只读属性会在这种坏法下仍然绿，这是选伪元素的理由。
- 取消中 / 停止后：composer 退出运行态（走查原有断言）。
- 能力不可用：不适用（不涉及要模型或外部资源才做得了的动作；供应商是 loopback 夹具）。
- 文案：走 i18n 词典，zh-CN 一段；英文词典同键存在（`Keep typing — it will be queued…`），本走查原本只有中文一段，本单不新增英文段（记 `unverified`）。

## ★9 验收与回滚

**验收**：另一条线 / 协调用下面这张清单核；实现线按它自验并在 PR 正文附「反例 → 结果 → 证据」表。验收线只核这份清单（新发现记后续，除非属于本 PR 引入的丢数据 / 花错钱 / 崩溃 / 安全）。

| # | 检查项 | 怎么验 | 通过标准 |
|---|---|---|---|
| 1 | 短片走查在 Mac 上从头到尾退出码 0，连跑 2 遍 | `python3 …/with-gates-lock.py -- node tests/ux/agent-v4-short-film.walk.mjs`，每遍记最后一步的名字和总秒数 | 两遍都 0；最后一步是 `12-cold-restart` |
| 2 | 262 那一步断言的是产品真实显示的排队提示 | 走查截图 `09-running`：亲眼 Read | 截图里看得见那句话；断言读的是空段落 `::before` 的 content，文案取自词典键 `agentPanelV4.placeholderRunning` |
| 3 | 反例①：断言改回 `toHaveAttribute('placeholder', …)` | 临时改回、跑走查 | 真红在运行中提示那一步（收到 null，与夜跑同形）；按字节还原后回绿 |
| 4 | 反例②：前提阈值临时改成 1000px | 临时改、跑走查 | 前提那道检查真抛，信息里带实测 px；按字节还原后回绿 |
| 5 | 反例③：产品代码临时去掉运行中的排队提示 | 临时改 `AgentPanelV4Composer.tsx`、重建、跑走查 | 走查在运行中提示那一步真红；按字节还原 + 重建后回绿，`git diff` 为空 |
| 6 | 前提靠内容，没有平台分支，阈值没降 | 读 diff | `80` 仍在、前提仍在、无 `process.platform` 分支；`minWindowFlowOverflowPx` ≥ 160 |
| 7 | 停止三态与「停下后不再发请求」 | 读走查报告 | `textRequests` = 声明过的请求数、`unexpected` 为空（夹具对没声明的请求回 400 并在收尾时 `assertClean` 报红）；重启前后请求计数相等（走查原有断言） |
| 8 | 重开：文稿 / 对话 / 收据都还在 | 走查原有断言全过 | 退出码 0；画布面本任务没有节点，只验画布面的对话与同一条 lane（见下「没覆盖」） |
| 9 | `agent-spend-priced-card` 补 await 后中英都过 | 经锁跑一遍 | 退出码 0；`actionCount` 为 2；若红在产品断言：停，截图交回 |
| 10 | 不新增测试抄文案；静态门全绿 | `pnpm run check:test-copy-literals`、`check:walkthroughs`、`pnpm run gates` | 基线 `agent-v4-short-film` 仍 1、`agent-spend-priced-card` 仍 0 |
| 11 | 推送前快检 + PR 正文判据 | `NOMI_PR_BODY_FILE=.tmp-pr-body.md node scripts/pre-push-contracts.mjs` | 红的项先改；贴最后几行 |
| 12 | 无残留进程、无多余产物 | `procs-in.sh <工作树>`，只停自己起的（按 PID） | 无残留；构建产物与走查截图只留报告要用的 |

**这一类会从哪些入口、形状、边界、版本回来**

- 别的走查再按 textarea 的形态读 Agent 输入框：`toHaveValue` / `inputValue` 已有门（`composer-input-read`）；用 `placeholder` 属性读 Agent 输入框这一种写法本仓 `git grep` 只有本条一处，本单换掉后为 0。把 `placeholder` 读也加进 `composer-input-read` 门是结构性预防，但改的是 `scripts/`，超出「只改这条走查」，写进报告交协调拍板。
- 产品再换输入框形态：helper 读「画出来的字」，不依赖标签名 / 属性，只依赖「空编辑器 + `::before`」这一层（Placeholder 扩展 + `tiptapPlaceholderClasses.ts`）；那层变了，反例③同形红，不会假绿。
- 别的平台 / 字体 / 窗口底板：内容更长则余量更大；阈值不动，报错带实测 px，余量记进报告，下次是「看得见在变小」而不是「某天突然红」。
- 同类前提（对话流溢出才有信号）：`git grep` 里只有这一处「溢出小于阈值就拒测」的前提。
- 漏 `await`：本线对 `tests/`、`evals/` 扫了数组里 `await x, y.count()` 这一形状和 `expect(y.count())`，全仓只有 priced-card 这 1 处（扫法写进报告）；别的形状不在本单。
- 夜跑独占：走查只在夜跑里跑，是红两周才被看见的原因；这不在本单范围，R-nightly-new-reds 在查。

**没覆盖（如实）**：Linux 夜跑（本机无 Linux，`unverified`）；英文界面段（本走查没有，`unverified`）；画布节点重开后还在（本任务夹具只读画布、没建节点，走查只验画布面的对话与同一条 lane）；真付费。

**回滚**：纯走查改动，`git revert` 对应提交即可（设计卡一个提交、短片走查两个提交、priced-card 一个提交）。

## 实现中补记（2026-10-28；只记实测与新发现，上面动手前定的清单与反例一字未改）

**实测（Mac，main b51835990 + 本分支）**

| 验收项 | 结果 |
|---|---|
| 2 占位那一步 | 走查截图 `09-running`：输入框里画着排队提示，右下是停止钮，流里是「正在想…」 |
| 3 反例① 断言改回 `toHaveAttribute('placeholder', …)` | 读到 `null`，红在运行中提示那一步（与夜跑同形）；按字节还原（`git diff` 为空、`cmp` 相等） |
| 4 反例② 阈值改 1000 | 前提真抛「最小窗下对话流只溢出 207px」；按字节还原 |
| 5 反例③ 产品去掉运行中的排队提示 + 重建 | 红在同一步：`Expected` 排队提示、`Received` 空闲那句；按字节还原（sha256 相等、`git diff` 为空）后重建 |
| 6 前提靠内容 | `minWindowFlowOverflowPx` = 207（改前 35）；80 没动、没有平台分支 |
| 7 停下后不再发请求 | `textRequests` = 7 = 声明数，`unexpected` 为空，`assertClean()` 过 |
| ★4 样式丢了 | 单测（`agent-runtime-walk-support.test.mjs`）：空编辑器读到字、框里有字读到 `null`、`content` 为 `none`（规则写了 none）或 `normal`（规则缺失）都读到 `null` |
| 9 priced-card 补 await | `actionCount` 那条（`actions` = 2）现在量得到并通过；走查随后往前走到下一条，见下 |

**动手后才露出来的（卡上没有）**

1. **第 9 步重开（走查写法，已改）**：冷重启后 `expandResidentPanel` 一次性采样「面板可见吗」，采在面板挂上之前就去等一颗永远不会出现的小球，15 秒后红，而面板其实已按落盘的展开形态起来（文稿、对话、收据都在）。改成先等「面板或小球」其中一个出现再交给它。共用的 `ensureAgentPanelOpen`（44 份走查在用）有同一个一次性采样，本单只在这条走查里绕开，helper 不动——改它要 44 份各跑一遍。
2. **第 8 步停止后收起的小球（产品语义，已停，未改）**：走查要 `failed` / 「有一步没成」，产品给的是「刚做完 → 空闲」。产品 09-14（866a63656）起把用户自己点的停止画成中性的「已停止」（`agentPanelV4Blocks.test.ts` 钉着），没有错误带；小球的 `failed` 只认面板错误带或流末尾的 error（`ProjectAgentResidentShell.tsx:355`）。这条断言在新小球上从没真绿过（10-08 外壳重设计计划自己写着「本机没跑」「未通」）。所以验收项 1 / 8 要分开读：已提交的走查在第 8 步红，等协调判；把第 8 步改成「小球 `done` 或 `idle`」的临时变体（补丁已备，未入库）连跑 2 遍通过，最后一步 `12-cold-restart`（重开：文稿、对话、收据都在，重启不产生任何模型调用）。**→ r2 已判：产品是对的，走查过期，改成中性断言（见 `## r2`）。**
3. **priced-card 补 await 之后的下一条（已停，未改）**：`主按钮一行放得下` 用 `高度 < 24` 判，按钮现在是 28px 高（中英单张 / 两张实测都是 28px，与同一行的取消钮等高），文字一行、没有折行；24 是按钮还是 22px 时写的。红在「产品断言」上，按任务书停，补丁（与取消钮等高判）已备并在临时变体里中英两段都过。**→ r2 已判：产品没问题，不用「与取消钮等高」，改数文字的行盒（见 `## r2`）。**
4. **Mac 抢前台守卫（环境）**：`_launchApp.mjs` 的 `startMacForegroundGuard` 在走查 App 启动时恰好是最前应用时，把进程退出码改成 1，哪怕报告写的是 `passed`。本机有的遍数会触发、有的不触发（与本改动无关）；本卡里的「退出码」一律同时看 `report.json` 的 `result` 和日志里有没有 `[quiet-walk] 走查抢了前台`。

## r2（2026-10-28，协调判定后的第 2 轮）

> r1 停下的两件事协调都判了，并批了两条结构性预防。本节是 r2 的设计卡增量：**动手前写全**，★9 的清单与反例都在这一节，实现线按它自验，验收线只核它。r1 里与本节冲突的句子已在原处改正（标「r2 改」）。类别仍是 [其他]（测试 / 走查 / 门岗）；`src/`、`electron/` 不碰，反例的临时改动除外，当场按字节还原。

### 协调 10-28 的判定与依据（照做）

| # | 判定 | 依据 |
|---|---|---|
| 1 | 第 8 步：**走查过期，产品是对的**。用户点停止后收起，小球不报「出错」 | ①`ProjectAgentResidentShell.tsx:344-355`（用户 09-06 改）写明：小球的失败只看「最后一件事是不是坏的」＝面板错误带 `actions.error`，或流末尾那条未化解的 error（`lastFlowFailed`，:79）。②用户自己点停止留下的是 09-14（866a63656）定的**中性**回执「已停止」（词典 `agentPanelV4.stoppedNotice`，`AgentPanelV4Message.tsx:183-184`，`agentPanelV4Blocks.test.ts:123` 钉着），没有错误带、流末尾不是 error。③所以停止后收起，小球走 `done`（`V4_DOCK_DONE_HOLD_MS` = 2.4 秒）→ `idle`；报「出错」是假警报。④这条断言 09-06 写、10-08 外壳重设计时只改了锚点，在新小球上从没真绿过（`docs/plan/2026-10-08-shell-redesign.md:157,170` 自己写着「本机没跑」「未通」） |
| 2 | 「收起不吞坏消息」要补**真量具** | 第 8 步原本想量它却从没跑到过；全仓只有 `resolveDockStatus` 的纯函数单测（`agentPanelV4DockStatus.test.ts`）。本单补一轮**真失败**：夹具让一轮整条回错 → 收起 → 小球 `failed` |
| 3 | 报价卡「主按钮一行放得下」：走查的绝对数过期，产品没问题 | 主按钮现在是 `h-7`（28px，`src/design/actions.tsx` 的 `WORKBENCH_BUTTON_SIZE.sm`），`<24` 是它还是 22px 时写的。不用 r1 备的「与取消钮等高」（它依赖动作行是 `items-center`，换了对齐方式就恒真），改数主按钮**文字的行盒数** |
| 4 | 两条结构性预防，批准 | ①`composer-input-read` 加拦「按 `placeholder` 属性读 Agent 输入框」，判定放 `scripts/lib/composerInputReads.mjs` 并补单测；②`ensureAgentPanelOpen` 的一次性 `isVisible()` 采样竞态，改在共用函数里，先等「面板或小球」其中一个出现再判，同提交删掉短片走查里的局部绕法 |

### 根因（r2 新增三行）

| | 症状 | 直接原因 | 类根因 |
|---|---|---|---|
| D　第 8 步 | 走查要 `failed`，产品给 `done` → `idle` | 走查把「用户点停止」当成了坏消息；产品 09-14 起把它画成中性回执 | 走查的期望抄的是产品改版前的语义，且在新小球上从没真绿过——没有任何机器核对「期望还是不是产品的意图」。更深一层：「收起不吞坏消息」这条本意一直拿「停止」当失败的**替身**来量，替身一过期，真东西就没人量了 → 补**真失败** |
| E　priced-card | `row.oneLine` 收到 false | `<24` 拿「按钮盒子的高度」当「文字有没有折行」的代理。按钮高度由 `h-7` 写死，折行时也不变，按钮还自带 `whitespace-nowrap`（`actions.tsx:305`）——这个量本来就量不到折行 | 用一个会随版式变的代理去量，代替直接量要证的事（文字几行）。r1 备的「与取消钮等高」是同一类代理（依赖 `items-center`）→ 直接数文字的行盒 |
| F　`ensureAgentPanelOpen` | 冷重启后 15 秒红，面板其实已展开 | 一次性 `isVisible()` 采在外壳挂上面板之前，把「还没挂」当成「是小球」，去等一颗永远不会出现的小球 | 共用定位出口把「形态还没落定」和「是小球」混为一谈。入口（`node scripts/door-map.mjs ensureAgentPanelOpen --roots=tests,evals --include-tests`）：直接调用 16 扇，`expandResidentPanel` 27 扇再经它回到同一个函数——各走查没法各自处理，r1 只在短片走查里绕开，别的走查仍会撞上 |

### 怎么改（换，不补）

1. **第 8 步**：停止后收起，小球 `data-agent-dock-status` / `data-agent-ball` 是 `done` 或 `idle`（`/^(done|idle)$/`：刚停下那 2.4 秒是 `done`，随后落回 `idle`，两个都是中性），不是 `failed`。旧的 `failed` / 「有一步没成」断言同提交删掉；注释写明判定依据（上表 1）。
2. **真失败场景**（新的第 10 步，放在冷重启之后）：再发一轮，夹具让这一轮整条回错。先断言面板上出现错误带（**阳性对照**：失败真的发生了；composer 退出运行态），再收起：小球 `data-agent-dock-status=failed`、`data-agent-ball=failed`、aria-label 含词典 `agentPanelV4.dockFailed`（文案取词典，不写字面量）。**小球没报失败 = 产品在说假话：停，带截图和日志交回协调**（协调判拦不拦发版）。
3. **priced-card「主按钮一行放得下」**：`pricedRow` 数主按钮文字的**行盒数**，`=== 1` 才算一行；`oneLine`（高度判据）同提交删掉。数法：按钮下每个文本节点用 `Range.getClientRects()` 取矩形，按**竖向中点**归行，不按 `top` 去重——按钮里的 `⏎` 是 `text-micro`，字号比主文字小，同一行里它的 `top` 也和主文字差几个像素。纯函数 `countLineBoxes(rects)` 与页面侧取矩形的 `textLineBoxes(locator)` 住 `tests/ux/_assert.mjs`（与 `expectAbsent` 等断言同层），纯函数带单测。四组实测（中文单张 / 两张、英文单张 / 两张）的宽、高、行盒数、动作数记进 `report.json` 的 `pricedRows`。断言范围不变：两张的中英两段（原来就只断言这两处）。
4. **`composer-input-read` 加拦按 `placeholder` 读 Agent 输入框**：判定在 `scripts/lib/composerInputReads.mjs`。认：输入框定位器（`COMPOSER_INPUT` / `data-v4-control="input"`，或经变量，或 `COMPOSER` 块内）上的 `toHaveAttribute('placeholder', …)`、`getAttribute('placeholder')`、DOM 属性 `.placeholder`、属性选择器 `[placeholder…]`、`getByPlaceholder(`；方法链换行写的也认（把以 `.` 起头的续行并回上一行）。出口提示指向 `composerPlaceholder` / `expectComposerPlaceholder`。基线 `composer-input-read` 仍是 0（全仓现状 0 处，规则只拦将来）。单测补在 `scripts/check-walkthroughs.node-test.mjs`。
5. **`ensureAgentPanelOpen` 先等「面板或小球」其中一个出现再判**（`tests/ux/_shell.mjs`）。这是**只多等不少判**的改法：面板已在 / 小球已在，一样走原路；只有「还没挂上」这一种原本会红的情形变绿；两个都不出现，原来红、现在还是红（报错信息更准）。同提交删掉短片走查冷重启那段的局部绕法（`expect(win.locator(`${CREATION_PANEL}, ${COLLAPSED_DOCK}`).first()…).toBeVisible(…)`）。真浏览器合同测试 `tests/ux/_shell.test.mjs`：面板晚一会儿才挂上（从没有小球）→ 不点任何东西就返回；只有小球 → 点它。

### 真失败场景：放在哪、回什么错（理由）

- **放在短片走查冷重启之后（第 10 步），不另起一份小走查**：①只多一轮请求，不再多起一个 Electron（另起一份要多 20 多秒启动，还要登记进夜跑清单、多一份文件要维护）；②它就是这个故事的下一步——用户重开项目、再让 Agent 改一下、服务商这回整条回错、他收起面板去看画布，小球必须把这件事接住；③顺带量到「冷重启恢复出来的会话还能再跑一轮并如实报错」，另起的走查量不到；④放在最后，不改第 9 步重启前后的请求计数与 lane 对账。代价：这条走查只在夜跑里跑（与 r1 同）；它红在最后一步时前面全绿，定位更容易。
- **回一条不会被重试的整条回错（HTTP 400，夹具 `http-error`，与 `pb09` 同形），不回 500**：lane 对 500 会重试 3 次（`electron/agentLane/laneHost.mts:76` 的 `LANE_RETRY_POLICY`：`maxRetries` 3、基础 1 秒），一轮变 4 次请求、多等约 7 秒，走查还会绑死在重试次数上（改成 2 次就红）；这个场景要证的是「最后一件事是坏的 → 收起后小球报出」，和重试无关。重试本身由 lane 的单测管。
- 请求计数：7 次变 8 次，仍逐次声明（`expectText`），`unexpected` 必须为空。

### ★1 增量（r2）

**真实任务**：①短片走查本身（真 Electron + 隔离资料 + loopback 夹具，零花费），最终树连跑 2 遍；②`agent-spend-priced-card` 走查（中英两段）；③`ensureAgentPanelOpen` 改动后，CI E2E 分片里的 ≥3 份走查各跑一遍（从 `spend-walks` 的阻断子集里挑）；④夜跑 ubuntu（合并后由协调看 `nightly-walks` 产物，本机没有 Linux，记 `unverified`）。真付费不在本单。

| 目标 | 信号 | 指标 / 基线 → 目标 | 量具 |
|---|---|---|---|
| 收起不吞坏消息有真量具 | 真失败一轮后收起，小球 `failed` | 基线：全仓 0 条走查在真机上量过它（只有纯函数单测）→ 1 条；反例①真红 | 短片走查第 10 步 |
| 停止不报警 | 停止后收起，小球 `done` / `idle` | 基线：走查要 `failed`（过期，第 8 步红）→ 中性断言通过 | 短片走查第 8 步 |
| 报价卡不折行有真量具 | 主按钮文字行盒数 | 基线：红（高度 28 ≥ 24）→ 四组都 = 1；反例②真红 | priced-card 走查的 `pricedRows` |
| 走查不再按 `placeholder` 属性读 Agent 输入框 | `check:walkthroughs` 命中数 | 0 → 0；反例③真红 | `node scripts/check-walkthroughs.mjs` |
| 展开面板不再有采样竞态 | 冷重启后展开面板 | 基线：红（15 秒）→ 绿；反例④真红 | 短片走查第 9 步 + `tests/ux/_shell.test.mjs` |
| 夜跑 ubuntu 保持绿 | 夜跑结果 | 未验证：缺量具（本机无 Linux），合并后看夜跑 | `nightly-walks` 产物 |

**★1b 连带界面**：不适用——不改任何界面、回执、通知、错误卡的文字；走查只读现有词典（`agentPanelV4.dockFailed`、`agentPanelV4.placeholderRunning`）。

### ★2 / ★3 / ★4（r2 增量）

- **★2 谁说了算**：小球的「失败」= `resolveDockStatus`（`agentPanelV4DockStatus.ts`）的 `failed` 事实，由 `ProjectAgentResidentShell.tsx:355` 取（面板错误带或流末尾未化解的 error）；用户点停止 = 中性回执，不是失败。走查只读 `data-agent-dock-status` / `data-agent-ball` / aria-label，不写、不猜。「Agent 面板此刻是展开还是小球」的定位出口 = `_shell.mjs` 的 `ensureAgentPanelOpen`（走查不许各自采样）。同一份事实存几份：1。
- **★3 一致与复用**：行盒数用浏览器标准的 `Range.getClientRects()`，归行是几行的纯函数，不自写测量器（P0：这不是我们独有的）；重试策略、`http-error` 夹具、`ERROR_BAR`、`uiText`、`escapeForRegExp` 都是现成的；`pb09` 已有「服务商整条回错 → 面板错误带」的同形夹具用法。第二份定义：无（旧的 `oneLine` 与局部绕法同提交删）。
- **★4 全状态**：运行中 / 停止后收起 → 中性（`done` → `idle`）；失败 → 面板错误带，composer 退出运行态；失败后收起 → 小球 `failed`（右上一粒 danger 点，aria-label 含「有一步没成」）；取消中：不适用（不新增可取消动作）；能力不可用：不适用（loopback 夹具，不涉及要模型或外部资源才做得了的动作）；文案走词典；英文：词典 `agentPanelV4.dockFailed` 英文段存在（`One step failed`），本走查只有中文一段，**英文段本单不新增（`unverified`）**。

### ★9 验收与回滚（r2）

**验收**：另一条线 / 协调用下面这张清单核；实现线按它自验并在 PR 正文附「反例 → 结果 → 证据」表。验收线只核这份清单（新发现记后续，除非属于本 PR 引入的丢数据 / 花错钱 / 崩溃 / 安全）。

| # | 检查项 | 怎么验 | 通过标准 |
|---|---|---|---|
| r1 | 短片走查在**最终树**上连跑 2 遍 | `python3 …/with-gates-lock.py -- node tests/ux/agent-v4-short-film.walk.mjs`，连 2 遍；每遍记最后一步的名字、秒数、report.json 的 `textRequests`、`unexpected` | 两遍 `result: passed`、退出码 0；最后一步是新增的真失败那步；`textRequests` = 8（声明数）、`unexpected` 为空、`paidCalls` 0。若唯一的红是 quiet-walk 守卫（日志有 `[quiet-walk] 走查抢了前台` 而 report 是 `passed`），照实记录，不算本单的红 |
| r2 | 第 8 步（停止后收起）是中性断言 | 读 diff + 走查日志 / 截图 `11-collapsed-stopped` | 小球 `done` 或 `idle`，不是 `failed`；旧的 `failed` / 「有一步没成」断言在第 8 步段已删（同提交），注释写了判定依据 |
| r3 | 真失败场景：截图亲眼 Read | 第 10 步的两张截图（面板错误带、收起后的小球） | 看得见错误带；看得见小球右上一粒 danger 点；断言读到 `failed` / `failed` / aria-label 含词典 `dockFailed`。**小球没报失败：停，带截图和日志交回** |
| r4 | 报价卡走查中英两段都过 | `python3 …/with-gates-lock.py -- node tests/ux/agent-spend-priced-card.walk.mjs` | `result: passed`；`pricedRows` 四组（zh 单张 / 两张、en 单张 / 两张），每组 `lineBoxes` = 1、`actions` = 2；红在产品断言上：停，截图交回 |
| r5 | `ensureAgentPanelOpen` 改完后，再挑 ≥3 份用到它、且在 CI E2E 分片里的走查各跑一遍 | 从 `node scripts/validation-policy.mjs --print-spend-walks blocking`（`spend-walks` 单元）里挑，含一份走 `form: 'dock'` 分支的（`core-smoke-spend-confirm`）；列出名字和结果；其余交推送后的 CI | 都 `passed`。有原来能过现在红的：先查是不是这次改动引起的，是就**停**，交回 |
| r6 | 反例①：产品把失败从小球上去掉 | 临时把 `ProjectAgentResidentShell.tsx:355` 的 `failed` 取法改成 `false` → `pnpm run build` → 跑短片走查 | 红在第 10 步「小球 `failed`」那条断言（`Expected: "failed"`，收到 `done` / `idle`）；第 8 步仍绿（停止不是失败）；按字节还原（sha256 相等、`git diff` 为空）+ 重建后回绿 |
| r7 | 反例②：报价卡主按钮文字被逼成两行 | 临时给主按钮收窄最大宽度（按钮自带 `whitespace-nowrap`，光收窄字只会溢出、不会折，所以同时临时解开它）→ `pnpm run build` → 跑 priced-card 走查 | 红在「主按钮一行放得下」：行盒数 ≥ 2；按字节还原 + 重建后回绿 |
| r8 | 反例③：走查里写回 `toHaveAttribute('placeholder', …)` | 临时写回 → `node scripts/check-walkthroughs.mjs` | `composer-input-read` 命中 → 退出码 1，信息指向 `expectComposerPlaceholder`；按字节还原后退出码 0 |
| r9 | 反例④：`ensureAgentPanelOpen` 改回一次性采样 | 临时把 `_shell.mjs` 的该函数改回老写法（局部绕法已删）→ 跑短片走查；并跑 `_shell.test.mjs` | 走查红在第 9 步冷重启后展开（点不到 Agent 小球，约 15 秒）；能稳定复现就记次数，复现不了写清楚；`_shell.test.mjs` 的「面板晚挂」用例同时红；按字节还原后回绿 |
| r10 | 新规则、新 helper 的单测 | `node --test scripts/check-walkthroughs.node-test.mjs`；`pnpm exec vitest run tests/ux/_assert.test.mjs tests/ux/_shell.test.mjs` | 全过；新增用例对「无规则 / 老实现」是红的（先红后绿的证据写进报告） |
| r11 | 不新增测试抄文案；静态门全绿；`gates` 过 | `pnpm run check:test-copy-literals`、`check:walkthroughs`、`check:test-waits`；`pnpm run gates`（自己拿锁，不套） | 基线 `agent-v4-short-film` 仍 1、`agent-spend-priced-card` 仍 0、`composer-input-read` 仍 0；`gates` 退出码 0 |
| r12 | 推送前快检 | `cp <正文> .tmp-pr-body.md && NOMI_PR_BODY_FILE=.tmp-pr-body.md python3 …/with-gates-lock.py -- node scripts/pre-push-contracts.mjs` | 全 ✅，最后几行贴进报告；`.tmp-pr-body.md` 不提交 |
| r13 | 无残留进程、无多余产物 | `bash /Users/aoqimin/Nomi-coord/procs-in.sh <工作树>` | 只停自己起的（按 PID）；无残留；`dist` / `dist-electron` / 截图只留报告要用的；被跟踪文件 `git status` 干净 |

**这一类会从哪些入口、形状、边界、版本回来（r2）**

- **别的走查再按 `placeholder` 读 Agent 输入框**：新规则拦直接读 / 经变量读 / 方法链换行 / 属性选择器 / DOM 属性 / `getByPlaceholder`，单测逐形状钉住；全仓现状 0 处。**没覆盖的门（如实）**：读 `data-placeholder`——它是活的读法（Placeholder 扩展挂的属性），Agent 输入框上全仓 0 处（唯一一处读 `data-placeholder` 的是 `archetype-modebar.e2e.mjs:181` 的生成节点描述框，是另一个组件）；不在批准范围，要不要也收进同一条规则交协调。
- **别的共用外壳函数的同形采样**：同一文件里 `collapseAgentPanel`（`_shell.mjs`，18 扇门）有同一个形状——一次性 `isVisible()` 判「是不是已经是小球」。**本单不改**：让它也等「面板或小球」，会把「页面上根本没有 Agent」这个原本无声通过的情形变红，不再是「只多等不少判」，需要另给批准并把 18 扇门各验一遍。`leaveProjectIfOpen`（判「在不在项目里」）、`openSettings` / `closeSettings`（弹窗开关）也是一次性采样，但语义是「在就做、不在就跳过」，不是「形态还没落定」，不动。
- **用盒子尺寸的绝对数当「不折行」**：`git grep` 数过 `tests/` 里 `height <` / `oneLine` 这一形状，全仓只有 priced-card 这一处；本单换成行盒数后为 0。
- **「收起不吞坏消息」的别的失败来源**：小球的 `failed` 有两个来源——面板错误带（`actions.error`）与流末尾未化解的 error。本场景走哪一个，实测后写进报告；另一个来源只有 `resolveDockStatus` 纯函数单测在管，本单不扩（不新增场景）。
- **产品再换小球 / 面板的形态**：断言读 `data-agent-dock-status` / `data-agent-ball` 与词典文案，不依赖标签或类名；那层变了，反例①同形红，不会假绿。
- **夜跑独占**：走查只在夜跑里跑，是红两周才被看见的原因；不在本单范围，`R-nightly-new-reds` 在查。

**没覆盖（如实）**：Linux 夜跑（本机无 Linux，`unverified`）；英文界面段（短片走查只有中文，`unverified`）；画布节点重开后还在（夹具只读画布、没建节点）；真付费；`collapseAgentPanel` 等同形采样（见上）；`ensureAgentPanelOpen` 的 40 多份调用方里除 ≥3 份实跑外，其余交推送后的 CI。

**回滚**：纯走查 / 门岗改动，`git revert` 对应提交即可（设计卡、第 8 步、真失败场景、priced-card、`composer-input-read`、`ensureAgentPanelOpen` 各自一个提交）。

### r2 实现中补记（2026-10-28；只记实测与新发现，上面动手前定的清单与反例一字未改）

**实测（Mac，本分支最终树，经门岗锁、隔离资料、loopback 夹具，零花费）**

| 验收项 | 结果 |
|---|---|
| r1 短片走查最终树连跑 2 遍 | 两遍 `result: passed`、退出码 0，34 秒 / 33 秒；最后一步 `14-collapsed-failed`；`textRequests` = 8、`unexpected` = []、`paidCalls` = 0；日志里没有 `[quiet-walk] 走查抢了前台` |
| r2 / r3 第 8 步中性、第 10 步真失败 | 第 8 步收起后小球素着（截图 `11-collapsed-stopped`，右上没有 danger 点）；第 10 步：面板上先出现错误带（`13-failed-turn-panel`），收起后小球 `failed` / `failed`，aria-label 实测 `打开 Nomi（⌘J） · 有一步没成`，右上一粒 danger 点（`14-collapsed-failed`） |
| r4 报价卡走查中英两段 | `passed`、退出码 0；`pricedRows` 四组 `lineBoxes` 都 = 1、`actions` = 2：中文单张 80px / 两张 91.7px、英文单张 94.5px / 两张 150.3px 宽，高度都是 28px，取消钮也是 28px |
| r5 `ensureAgentPanelOpen` 改完后 CI 分片里的走查 | `agent-spend-priced-card`、`core-smoke-spend-confirm`（走 `form: 'dock'` 分支、`timeout: stationTimeout()`）、`agent-spend-card`、`agent-spend-stop-midway`：四份都 `passed` / 退出码 0（前三份报告里 `unexpected` 为空；`core-smoke` 那份没有 JSON 报告，以日志「通过」行和退出码为准） |
| r6 反例① 产品把失败从小球上去掉 | 红在第 10 步：`Expected: "failed"`，8 次收到 `done`、6 次收到 `idle`；第 8 步仍绿；按字节还原（sha256 相等）+ 重建后回绿 |
| r7 反例② 报价卡主按钮被逼成多行 | 红在行盒断言：`Expected: 1  Received: 5`（中文两张）；按字节还原 + 重建后回绿 |
| r8 反例③ 走查里写回 `toHaveAttribute('placeholder', …)` | `check:walkthroughs` 退出码 1：`composer-input-read` 基线 0 → 现在 1，指向写回的那一行和 `expectComposerPlaceholder`；按字节还原后退出码 0 |
| r9 反例④ `ensureAgentPanelOpen` 改回一次性采样 | 短片走查两遍都红在第 9 步冷重启后展开：`点不到「展开常驻 Agent 面板（点 Agent 小球）」：等满 15000ms 它都没可见`（2 / 2 稳定复现）；`_shell.test.mjs` 老实现 2 红 3 绿、新实现 5 绿；还原后回绿 |

**动手后才露出来的（卡上没有）**

1. **反例②实测里主按钮的高度在文字折成 5 行时仍是 28px，和取消钮一样高**：r1 备的「与取消钮等高」在这种坏法下仍然是绿的——高度类的代理量不到折行，改数行盒是对的，不是多此一举。
2. **回 400 的那一轮只发了 1 次请求**（`textRequests` 7 → 8），没有重试；回 500 会被 lane 重试 3 次，这一点只依据 `LANE_RETRY_POLICY` 的配置，没有实测。
3. **小球 `failed` 的来源**：面板上被断言到的是流末尾那条 error（`[data-v4-block="errorbar"]`）；面板级错误带（`actions.error`）是否同时有值，本走查没有单独断言（小球的 `failed` 取两者之一，`||`）——两个来源分家时，只有 `resolveDockStatus` 的纯函数单测在管，本单不扩。
4. **`composer-input-read` 把方法链续行并回上一行之后，全仓仍是 0 处命中**：旧的 `toHaveValue` / `inputValue` 判定一并受益，没有新增存量。
5. **门岗自己的一个坑**：新写的 `_shell.test.mjs` 第一版带了一条「面板一直没有小球」的 `locator(...).count()` 等于 0 断言，被 `check:walkthroughs` 的 `absence-without-baseline` 拦下；改成只断言「面板可见、没点任何东西」（该用例本来就靠「页面里根本没有小球，点就会抛」证明没点）。
