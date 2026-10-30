# 试跑未知提交的方向复盘

状态：原暂停点已获用户裁定；下文 0—7 保留实现前判断，批准范围与实现结果见末尾。

## 0. 一句话根因

试跑把每次工具调用都当成新的付费意图，耐久提交边界看不到两个调用其实在核对同一笔未结订单。

## 1. 归类表

| 问题 | 直接原因 | 类 |
|---|---|---|
| 超时后 Agent 重调会再下一单 | 每调用 mint node/grant，没有读旧意图 | 付费意图身份活不过调用 |
| queued/提交超时曾误导再次试跑 | 等待预算与文字解释曾覆盖不足，已有测试仅断言单次调用 POST=1 | 同一类故障的跨调用不变量没有进入验收 |
| 制作侧同步落地失败曾变成 unknown | 供应商答复与落地结果混同，近期已有两次修复 | 受理事实、取回状态、允许动作要由共享 owner 决定 |

`fix-churn.mjs tryModel.ts` 退出 1：目录近 14 天 3 个 fix、只涉及 1 个源码文件，本次第 4 个；tryModel.ts 自身未命中文件阈值。候选复用的 submissionOutbox.ts 文件近 14 天 2 个 fix，本次第 3 个。不能因为候选文件热就断言必须修改它；当前没有修改任何产品文件。

## 2. 为什么一直出现

单次 spendGrant 的一次机会不等于跨调用的一次意图。nextAction 告诫模型不要重试，但执行器仍接收全新身份。已有测试数的是一次调用内的 POST，没有在 unknown 后真的再调一次。

⑫点了=以为的：核对未知原单应只观察，实际却可能变成第二次创建；这是主归属。⑩冻结参数必须保持原单不被换参偷换，⑪本次不改模型参数可选项。逃逸账保持 candidate，结账必须挂共享耐久认领代码及跨调用/宿主/重启矩阵，不以文案改动结账。

## 3. 可验证预测

| 预测 | 验证 |
|---|---|
| unknown 后同参再调收到两次 POST | tryModelSubmitBudget.test.ts 的“结果未知后”同参用例，已红 |
| 改 prompt/params 也不会归回原单 | 同文件换参用例，已红 |
| 换宿主/重启不会靠内存 Map 恢复原单 | 尚未实现跨进程测试；源码没有持久试跑身份，不把该推断算实测 |

## 4. 靶子独立性

本实现线写测试，尚无独立验收。oracle 是环回服务器收到的 POST 数，不依赖工具自报“没重试”；保留真实 runTask、spendGate 和 HTTP，仅隔离系统存储与本地供应商。两项均实测 expected 1 / received 2。未发现修对而评测掉分证据；不能把当前红测改成 expected 2 来通过门岗。

## 5. P0：复用与领域边界

通用持久执行不应再为试跑自写一套。先查已有 createRunOwnedGenerationSubmission + Run repository/lock/intentLog；该 wrapper 的 door-map 只有自身类型读取门，测试以外无生产调用，不能称它已覆盖试跑。上游通用幂等合同见设计卡 ★0；本地需负责创作者“核对原单”与“明确新单”的领域身份。此轮不引入执行框架，也不宣布完成通用执行迁移。

## 6. 方案比较

| 选项 | 做什么 | 代价与风险 | 推荐 |
|---|---|---|---|
| 接入现成设施 | 试跑认领原意图，接现有 Run submission；沿用上游明确声明的幂等合同 | 需设计试跑如何绑定 Run/job/approval 和预算、恢复投影，不是直接把一个调用名换掉 | 推荐方向，待协调复核实现范围 |
| 补 | 在 tryModel 增加临时 Map、按 vendor/model 或 prompt hash 拦截 | 跨宿主/重启丢锁，或把有意新生成永久合并；新增试跑分支不符合当前窄例外 | 不选 |
| 重写一个模块 | 抽出跨试跑/制作的通用认领服务，替换旧身份路径 | 可能需动已有文件热点，必须另批方向；不得顺手重写执行框架 | 若现有设施确实不能复用再评估 |
| 删 | 暂时关闭付费试跑 | 能阻断该入口重复下单，但会失去接入真实验证能力，属于产品取舍 | 不自行决定 |

## 7. 用户要权衡的核心

要的是“核对同一单绝不再创建”，这要求把工具调用绑定到原意图；只替换一段文字或增加进程内拦截都达不到。协调的预先代批只限换/删且无新增分支；当前方案仍缺认领和动作状态决策，不能自行认定已经满足该例外。按任务要求在产品实现前交回，不申请泛化权限。

## 特征测试与根因合同草案

- 症状：unknown 后跨调用重复创建。直接原因：每调用新 node/grant。类根因：出站前没有持久的付费意图身份约束。复发分类：recurring。
- 已变更测试：`electron/capabilityCore/modelOnboarding/tryModelSubmitBudget.test.ts`，两项失败；使用 `-t 结果未知后` 独立运行。
- 数门：tryModel 1 写/0 读；dispatchModelOnboarding 1 写/0 读；createSubmissionOutbox 2 写/1 读。保留各自脚本输出，不按重叠符号相加。
- 待实现的不变量：提交中/未知/已受理/取回中，同意图返回同一 intent/attempt；参数与卡变动不释放；安全重试预算持久有界；Agent 与用户 allowedActions 同源。
- 待选共享边界：Run-owned submission 前的持久认领；未实施，故不把拟议路径登记为已经 enforced，也不创建会虚报结构预防的机器合同。实现前必须补 schema-v3 `docs/fixes/*.root-cause.json` 并跑 checker。
- 依赖：not-applicable，无第三方升级。旧自动新身份路径尚未删除，必须在实现提交同批删除。
- 剩余风险：当前缺陷仍在；跨进程、卡改版、晚到回执、按钮同源、付费演练和真付费均未验证。删锁反例尚未执行；当前缺锁红测只是基线。

## 裁定

用户 2026-10-30 17:3x「按推荐做」（协调转达）。批准试跑接正式生成已有的持久提交记录：先认领原单，未结原单重调只读；仅明确的新单授权可另开。实现提交同时删除每次调用自动开身份的旧路径，不留两套。批准范围包含热点 `electron/productionRun/submissionOutbox.ts`，不必因此再停。不采用进程内 Map、prompt 哈希拦截，也不关闭付费试跑。仅本地提交，不推送；付费脚本准备但不执行。

工具描述同批只替换旧的“每调一次生成”说法，说明重复调用返回原单及 newAttemptOf 的真人确认。onboardingVerbs.ts 仅目录命中、文件未命中；纯文案替换、不增分支，按已授权的窄例外执行。

2026-10-31：第 1 次独立验收不通过（记录坏了或缺了之后，显式新单也到不了真人确认，连接和模型被锁死）。协调问「#1387 这个锁死问题，修完再合吗？」，用户原话：「修完再合」。

这一轮的类根因：安全封闭只想到挡自动重发，没给人工留出口。试跑身份是「连接 + 模型」算出的固定路径，记录一坏，这条路径就永远读不了。代码上是 `tryModel` 和共享认领都在任何异常处理之前先读旧单，事件缺失时又给了 `request_new_attempt`，调用却只回旧 unknown，catch 把失败盖住。

预测（不修的话）：

| 预测 | 怎么验证 |
|---|---|
| 写到一半崩溃（事件尾部截断、认领后没写完）之后，这个连接和模型再也试不了，新单也开不出来 | 清单矩阵的坏记录格和崩溃窗口格；修前显式新单抛错或只回旧单 |
| 以后改记录格式，旧记录全部读不出来，所有接过模型的用户一起被锁死 | 矩阵的「旧形状」格（缺 `schemaVersion`）；修前抛 `invalid runtime envelope` |
| 事件丢了但 approvals 还在，新单撞 `Approval id conflict` | 矩阵的 approvals 留存格；验收探针已碰到过 |

这一轮的范围：判定放在意图层，`productionRunRuntimeEnvelope.ts`、`productionRunRepository.ts` 不改；`tryModel.ts`、`submissionIntent.ts` 和对应概念的命中按协调裁定放行，其它文件级热点（`taskSpend.ts`、`capabilityApplyHandler.ts`）不碰，确认卡那句话走 `spendCardByIntent` 表和现有的 `confirmSpendAndMintGrant`。结账挂的类检查仍是 `electron/capabilityCore/modelOnboarding/tryModelIntent.matrix.test.ts`（清单 `tests/fixtures/try-model-intent-matrix.json`）。


## 裁定后的落地

用现有 Run/job/envelope/outbox 替换每调用自动新 node 身份。短租约在任何 await 和授权前完成认领；同一连接/模型的未结单跨调用、宿主和重启只观察。显式新单沿现有真人钱闸，不重写视频协议。

失败证据直接复用制作侧 observeSubmissionHandoffs，覆盖整次执行；删除临时的最后错误推断和 RendererUnavailable 文本匹配。供应商已受理后的下载失败不释放认领。门数和完整状态矩阵登记在 schema-v3 根因合同及设计卡，逃逸账保持 candidate，独立验收由协调另派。


本次实现分批本地提交导致 tryModel.ts 与新 submissionIntent.ts 也命中修复次数；这些命中均来自同一获批任务内的实现与验证，方向仍是用户批准的共享持久认领。最后一批以共享 observeSubmissionHandoffs 替换临时错误判断，删除旧推断，不另建状态 owner、供应商特例或第二套执行设施。每次提交前保留 staged fix-churn 输出，产品提交统一引用本裁定。
