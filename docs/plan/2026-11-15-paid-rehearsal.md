# 设计卡：付费走查的免费演练（同一份脚本、网络闸挡住供应商、没演练过的付费入口拒跑）

```
改动名：付费走查免费演练      线/负责人：I-paid-rehearsal      类别：[花钱]（只动测试脚手架，不进产物）
```

## ★0 先查别人

- [Stripe test mode](https://docs.stripe.com/test-mode) · 同一份集成代码，换一把 `sk_test_` 前缀的钥匙就进测试模式；测试钥匙在结构上动不了真钱，不靠写代码的人记得不点 · **确认了**「同一份脚本 + 一个开关」，并**改了**凭据决定：不要 Key 的那一档用一把明显的假钥匙走可见接入页，而不是在演练里装真钥匙。
- [Playwright · 中止请求](https://playwright.dev/docs/network#abort-requests) · 用 `route` 在出网那一层拦下请求，页面代码不改 · **确认了**「挡在网络闸」而不是让脚本少点一步：我们已有的走查网络闸（fetch / http(s) / 连接 / Chromium 四层 + 产品自带测试网闸）就是这层，演练只把供应商的源从放行名单里拿掉。
- [AWS EC2 · DryRun](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/CommonErrors.html) · `DryRun=true` 时请求照常检查权限，「本来会成功」回 `DryRunOperation`，权限不够回 `UnauthorizedOperation`——演练的结论本身是一个可判的回答，不是「没报错」 · **改了**判据：演练通过 = 「挡下的第一条请求就是这份脚本授权的供应商，且在收窄花钱面之后」，挡下别的源或之前失败都是红，没发请求也是红。
- [Terraform · Saved plan is stale](https://discuss.hashicorp.com/t/question-on-error-saved-plan-is-stale/52912) · `plan -out` 存一份计划，`apply` 只认那一份，状态变了就报「计划过期」要求重新 plan · **确认了**收据形状：收据 = 脚本内容指纹 + 构建戳；脚本或构建任何一个变了就拒，拒的那句话说「先带演练开关跑一遍」。
- 出口：[Terraform · stale plan](https://discuss.hashicorp.com/t/question-on-error-saved-plan-is-stale/52912) · 被拒后重跑一次 plan 就拿到新计划，没有人工豁免 · **确认了**我们的出口：真付费入口拒跑后，同一份脚本带 `NOMI_PAID_REHEARSAL=no-key` 跑一遍（零花费、几分钟）就落新收据；演练过不了的脚本本来花了钱也会白跑，拒它就是保护。

## ★1 用户怎么用

当协调（或任何人）要真付费跑一份 `*.paid.mjs` 时，我想先在同一份构建上免费把花钱前那段路走一遍，以便花钱那一刻不会因为「新镜头落在视口外、找不到生成钮」这类界面腐烂白跑。

1. `pnpm build`；2. `NOMI_PAID_REHEARSAL=no-key node tests/ux/<x>.paid.mjs`（不要 Key、不设 `NOMI_SPEND_OK`）；3. 脚本照常起隔离窗口、接入（假钥匙）、收窄花钱面、开项目、建节点、点生成；4. 第一条发往供应商的请求被网络闸挡下 → 演练判过，报告里记被挡请求的层 / 方法 / 主机 / 路径，落收据；5. `NOMI_SPEND_OK=1 node tests/ux/<x>.paid.mjs` → 付费入口核收据，对上才放行。
批量：`node tests/ux/_paidRehearsalBatch.mjs`（全部付费脚本各演练一遍，出清单）。

- 不做什么：不验供应商收到请求之后的行为（回什么、扣多少）；不修今天演练不过的脚本（只列清单）；不改网络闸本身；不改产品代码。
- 本机替身供应商（真窗实测后加，11-15）：产品存 key 之后用供应商的免费探测（APIMart = `GET /v1/balance`）确认 key 能用，网络被挡时诚实地记「待定」、预置模型不放出来——假钥匙演练第一次真跑就卡在接入页「选择要添加的模型」。所以「不要 Key」那档把 APIMart 的源经产品闸**已有的**测试改道（`NOMI_TEST_NETWORK_REDIRECTS`，另外 4 份走查已在用）指到本机替身：替身只答产品种子里声明的那条免费探测（从 `APIMART_VENDOR_SEED.credentialProbe` 派生，不手抄），别的请求一律记成账本里的被挡行（带方法、路径）回 503，**从不转发**，不读请求头和请求体。其余源仍由空名单的网络闸挡。
- 收窄之前挡下的授权供应商请求（存 key 后的探测等）照记不判、不让 App 停：真付费时它们本来就放行、不花钱；判据只认收窄之后的第一条。
- 带本地参考素材的脚本（`hostedUploads`）点生成后第一条请求是 App 的托管上传中转，不是供应商本身：中转在本脚本授权名单里，演练判过并在报告里写明是中转（archetype 真窗：`product-guard - nomi-asset-relay…/v1/assets`；把找生成钮那一步改坏后红在那一步，证明这条请求确在点生成之后）。
- 已知坑：Agent 驱动的脚本第一条供应商请求是 Agent 大脑的对话请求，演练只能证明走到「Agent 开口」这一步（报告里的路径会写明是哪条）；闸的 fetch 层不记方法，方法可能是空（替身那条一定有方法）；只授权非 APIMart 供应商的脚本走不了「不要 Key」那一档（env-key 路只认 APIMart）；有的付费脚本在收尾把证据摘要写进仓库里已跟踪的文件（如 archetype 写 `docs/evidence/…/report.json`），演练也会覆盖——批量命令跑完自动还原并点名，单跑要自己 `git checkout --` 那个文件。
- 真实任务：①`archetype-batch1-samples.paid.mjs`（可灵编辑 / Seedance / H3-Max 四发，11-15 真事挂在视口外）；②批量 44 份 `*.paid.mjs`；③反例：故意把找生成钮那一步改坏。
- 指标：主指标 = 付费脚本里演练能走到「第一条供应商请求」的比例（量具：`_paidRehearsalBatch.mjs` 的清单）；护栏 = 演练中真实到达供应商的请求数 = 0（量具：网络闸账本 `allowed-request` 行数 + 收据里供应商任务号 = 0，`_paidRun.mjs` 的演练判据）；质量 = 付费入口无收据放行次数 = 0（量具：`_paidRun.test.mjs` 的演练一组）。

### ★1b 连带界面
不适用：不加、不改任何界面元素；只多一行控制台输出 `[rehearsal] …` 和报告里的 `rehearsal` 一节。

### ★1c 老用户
不适用：只动测试脚手架（`tests/ux/`），不进构建产物（构建戳把 `tests/` 排除在源码身份之外），老用户升级拿到的东西一个字节不变。

## ★2 谁说了算

- 「这一场是不是演练 / 哪一档」：唯一判据 `paidRehearsalTier(env)`（`tests/ux/_paidRun.mjs`），`openPaidWalk` 是唯一消费者；脚本只读 `openPaidWalk` 返回值上的 `rehearsal`。
- 放行名单：仍是 `_paidNetwork.mjs#paidWalkAllowlist` 一处；演练时传给闸的是空名单，同一份算出来的名单只用来判「挡下的是不是授权供应商」。
- 主机匹配：`electron/shared/walkAllowlist.cjs#listsHost`（闸与诊断共用的那一份），不另写匹配。
- 构建身份：`scripts/package-build-stamp.mjs#verifyBuild` 返回的 `tree`（`assertPaidBuildReady` 用的同一个戳），收据不另造一套。
- 演练判据：`tests/ux/_paidNetwork.mjs#rehearsalVerdict`（读网络闸账本，纯函数）。
- 收据：`tests/ux/_paidRun.mjs` 读写，放 `.tmp/paid-rehearsal/receipts/`（`.gitignore` 已忽略 `.tmp/`）。
- 门表：`openPaidWalk(` 调用方 61 个文件（`git grep -l "openPaidWalk(" -- tests | grep -v _paidRun`）；不走它的两份在例外表里，不受影响（见已知限制）。

## ★3 一致与复用

- 以前定过：`vendorNetwork: false` =「零花费探测」（`_paidRun.mjs`）；三份脚本各写了 `NOMI_PAID_PROBE_DIALOG=1` 探测模式；两份 `*.rehearsal.walk.mjs` 用本机假供应商把整段旅程走完。现在都还算数。
- 三条路：沿原方向（每份脚本各加一个 PROBE 开关）——每份都要作者写，正是腐烂的来源，否；换做法（`openPaidWalk` 里一个通用开关 + 收据）——选这条；删掉（不演练，花钱时才知道）——就是今天的洞，否。
- 复用：网络闸、空名单路（`vendorNetwork:false`）、产品闸的测试改道（`NOMI_TEST_NETWORK_REDIRECTS`）、`connectApimartThroughVisibleUi`（假钥匙走可见接入页）、`verifyBuild`、`listsHost`。新增的只有判据、收据、本机替身和批量命令。
- 三份脚本的 `NOMI_PAID_PROBE_DIALOG=1` 探测模式：不删、不并。它们停在「确认框出现」，是比「第一条请求」更早的一个停点，和通用演练并存；以后要收成一个，另开一刀。
- 两份手抄演练脚本（`relay-video-onboarding-real.rehearsal.walk.mjs`、`tool-schema-real.rehearsal.walk.mjs`）：r2 复核后仍不删，逐个理由——①中转视频那份用本机中转夹具把创建 → 查询 → 落地整段走完，且登记在 `docs/fixes/2026-10-30-relay-capability-projection.root-cause.json` 的回归测试里；②工具参数那份用本机大脑回工具调用，验运行时 Zod 校验和写盘，是逃逸账本一条的证据。通用演练停在创建请求、拿不到回包，这两件做不到；两份都每晚在跑。
- r2 删掉的：`generation-lock-exit-real`、`shot-result-ownership-real` 两份付费脚本里「手递一张旧式演练收据 + git diff」的那套判断，改认通用收据；它们自带的转发代理改从 `openPaidWalk#vendorUpstream()` 拿上游（演练 = 本机替身，不转发），不再自己读放行名单、不再整个覆盖改道表。四段旅程本身的免费演练（`*.rehearsal.walk.mjs`）每晚照跑。

## r2（11-15 协调裁决 1、2）

- 上传中转也由本机替身回话：带本地素材的（`hostedUploads`）把中转的源也改道到一个替身，只答上传（回本机假地址 `…/rehearsal-asset/N`，回链字段取产品的中转声明），不转发；APIMart 自己的上传口同样由供应商替身答。演练于是越过中转，走到供应商那条请求。产品一行不改（闸本来就支持多条改道）。
- 走到哪一站：`点击之前 < 上传中转 < 供应商读请求 < 供应商创建请求`（`_paidNetwork.mjs#rehearsalStation`）。收据记站；真付费入口只认走到这份脚本终点的收据，缺省终点 = 创建请求，不发创建请求的在 `_paidRun.mjs#REHEARSAL_ENDPOINTS` 声明（今天 0 份）。替身记下请求的方法、路径、脱敏后的请求体（不记请求头，multipart 只记字节数）。
- 请求体判据演练时真的判：`readAllowedRequests()` 演练时返回替身记下的供应商请求（和真付费同一个形状）；声明了 `judgesBodyInRehearsal` 的脚本，替身记下创建请求后 App 不立刻关，让脚本读账本判完（兜底 20 秒）。目前只有 archetype 声明（它在 `judgeLedger` 之后加了两行：判据有问题就点名哪个键抛错，没问题就结束这一发）；没声明的照旧停在创建请求。
- 进夜间：夜间走查第 0 批加一步 `_paidRehearsalBatch.mjs --nightly`；缺参数 / 缺环境的记「跳过：要什么」（`_paidRehearsalList.mjs#REHEARSAL_SKIPS`），真坏了的进只减不增的「今天不过」名单（`KNOWN_RED`，每条一句原因）。名单外的不过 → 红；名单里的今天过了 → 也红；表格不用 `.tsv`（夜间汇总会把它当免费走查结果读）。

## ★4 全状态

| 状态 | 看到什么 |
|---|---|
| 演练通过 | `[rehearsal] 通过：走到了第一条供应商请求 <层> <方法> <主机><路径>`；`report.json` 的 `rehearsal.passed=true`；落收据；进程退出码 0 |
| 演练不过：之前失败 | `[rehearsal] 不过：脚本在向供应商发第一条请求之前就失败——<原错误>`；退出码 1；不落收据 |
| 演练不过：没走到收窄 | 「没走到收窄花钱面——<原错误>（之前挡下过 <收窄前被挡的请求>）」 |
| 演练不过：挡的是别的源 | 「挡下的是授权供应商之外的源 <主机>」 |
| 演练不过：没发请求 | 「脚本跑完也没有向供应商发出请求」 |
| 演练不过：没走到终点 | 「只走到了「upload-relay」，这份脚本的终点是「vendor-create」」 |
| 演练不过：请求体判据没过 | 「走到了「vendor-create」，但脚本自己的核对没过——请求体判据没过：<点名的键>」 |
| 付费入口收据只走到中转 | 起窗前拒：「演练只走到了「upload-relay」……花钱前那段路没走完」 |
| 两个开关同时开 | 起窗之前拒：「说不清要不要花钱」 |
| 付费入口无收据 / 脚本改过 / 构建变了 | 起窗之前拒，一分钱没花，说清「先带 NOMI_PAID_REHEARSAL=no-key 跑一遍」 |
| 能力不可用：只授权非 APIMart 的脚本跑「不要 Key」档 | 起窗之前拒，下一步：用 `NOMI_PAID_REHEARSAL=real-key`（要真 Key、出不了网）在本机跑 |
| 取消中（Ctrl-C） | 同今天：隔离副本留在临时目录，不落收据 |

## 5 中途表

| 状态 | 停（Ctrl-C） | 关窗 | 断网 | 重启 | 连跑两次 |
|---|---|---|---|---|---|
| 演练中 | 不落收据 · 不扣 · 报告可能缺 | 脚本那一步失败 → 判不过 · 不扣 | 无影响（演练本来就不出网）· 不扣 | 不落收据 · 不扣 | 第二次覆盖第一次的收据 · 不扣 |
| 付费入口核收据 | 起窗前，无副作用 | 不适用 | 不适用 | 不适用 | 每次都核，收据不会被付费跑消费掉 |

## 6 外部数据与失败

- 外部来源：被测 App 发往供应商的请求（演练时全被挡）、网络闸账本（`scripts/walkthrough-network-guard.cjs` 写）。账本格式以闸文件头注释为规范；偏差：fetch 层的 `blocked` 行不带 `method`，演练报告里方法记 `null`，判据不依赖方法。
- 失败时：账本读不到 guard-loaded → 现有判据当场红（不变）。

## 8 真实条件

- 真窗口（开发构建）跑 `archetype-batch1-samples.paid.mjs` 演练 + 反例；批量演练；`real-key` 档 `unverified`（要拷真实资料，留给协调）；Windows `unverified`；`--packaged` 形态 `unverified`（收据身份用安装包 `app.asar` 的大小 + 修改时间，单测钉）。

## ★9 验收与回滚

验收清单（实现线按它自验，验收线只核它）：

1. `archetype-batch1-samples.paid.mjs` 带 `NOMI_PAID_REHEARSAL=no-key` 真窗跑，报告里有被挡请求的层 / 方法 / 主机 / 路径，主机是 APIMart，退出码 0，收据落盘。
2. 故意把它找生成钮的那一步改坏 → 演练红在那一步（错误里点名那一步）；还原 → 绿。
3. 不带演练开关、不设 `NOMI_SPEND_OK` 跑 → 拒跑；设了 `NOMI_SPEND_OK=1` 但收据对不上的判据由单测钉（本线不设 `NOMI_SPEND_OK`）。
4. 全量批量演练出清单：脚本名、挂在哪一步、一句原因，耗时。
5. 单测（`tests/ux/_paidRun.test.mjs`、`tests/ux/_paidNetwork.test.mjs` 的演练一组）钉：没收据拒、脚本改过拒、构建变了拒、两个开关同时开拒、演练过后同一份脚本同一份构建放行、`vendorNetwork:false` 的探测不要收据。

反例（改坏 → 红，还原 → 绿，日志进报告）：

- R1 演练时把供应商的源放进放行名单 → 单测红。
- R2 演练开关和花钱开关同时开却放行 → 单测红。
- R3 没有收据时真付费入口放行 → 单测红。
- R4 脚本改了一个字符收据还认 → 单测红。
- R5 演练时被挡的是别的源却判通过 → 单测红。
- R6 只有收窄之前挡下的供应商请求、收窄之后没有，也判通过 → 单测红。
- R7 演练里收据出现供应商任务号仍判通过 → 单测红。
- R8 本机替身把没登记的请求也答成功（等于假装供应商收下了）→ 单测红。
- R9 中转替身把请求转发给它顶替的那个源 → 单测红（真源收到的请求数必须是 0）。
- R10 只走到上传中转的收据被真付费入口放行 → 单测红。
- R11 演练时读账本的口返回空（请求体判据读不到）→ 单测红。
- R12 没声明自己判请求体的脚本，演练时创建请求之后 App 没被立刻关 → 单测红。
- 真窗两次改坏（archetype A1）：生成钮那一步改坏 → 红在点击之前；判据值改成不可能的值 → 红在判据上、点名那个键；还原后都绿。

这一类还会从哪回来：脚本的本地辅助模块改了（`_generateReach.mjs` 等）——指纹覆盖脚本的本地 import 闭包；安装包形态——收据身份换成安装包 `app.asar`；别的凭据路（真实资料）——`real-key` 档同一套判据。

花钱走查：本线零花费，不设 `NOMI_SPEND_OK`；产物标记不适用（不改产品）；专用工作树 = 本线隔离工作树。
回滚：revert 本 PR 的提交；收据目录在 `.tmp/` 下，删不删都不影响。
