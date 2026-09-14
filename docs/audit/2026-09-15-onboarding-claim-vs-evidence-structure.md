# 结构评审：接模型这条路上，「结论」和「证据」之间没有一道边界

状态：单一评审者视角，不代表多位独立审批者。触发方式是门岗不是排期——
`check:symptom-cluster` 在 `docs/fixes/2026-09-15-onboarding-results-claim-what-they-cannot-know.root-cause.json`
落盘时报出两个模块在 7 天窗口里都已过第三份合同：**`electron/capabilityCore`**（2026-09-09→09-15，23 份）与
**`electron/integrationCertification`**（2026-09-11→09-15，6 份）。

23 份那个数字主要是一周大合并潮的体量（工具面重做 #754、付费确认面、lane 阶段），不是一个结构缺口能解释的。
本文只回答**这一份合同所在的那条结构**：

```
声明（declarations.ts 五槽 + 必填）
   → 派发（modelOnboarding/dispatch.ts 九个动作）
      → 会话服务（integrationCertification/integrationSession.ts）
         → 探测器（integrationCertification/httpModelDiscovery.ts）
      → 协议层（capabilityCore/mcpCredentialElicitation.ts：问不问用户拿 key）
   → 信封（modelOnboarding/envelope.ts：unverified / nextAction / blastRadius）
```

范围内文件：`electron/capabilityCore/modelOnboarding/{declarations,dispatch,envelope}.ts`、
`electron/capabilityCore/mcpCredentialElicitation.ts`、`electron/integrationCertification/{integrationSession,httpModelDiscovery}.ts`。

## 1. 这条结构上的合同是不是同一类

| 合同 | 它说的根因 | 动了哪一端 |
|---|---|---|
| `2026-09-11-mcp-onboarding-defects` | 发布出去的机器契约对自己不诚实：必填、错误码、阶段词表、句柄格式各藏一件调用方必须知道的事 | 契约层：把六处该说的说出来 |
| `2026-09-11-mcp-onboarding-tool-face` | 一个 241 字节的工具管 6 个动作，广播的必填是假的 | 声明层：收成 4 个工具、描述与运行时同一份 |
| `2026-09-12-integration-run-failure-path` | 验证 run 的失败路径会停在中间态，没有终态保证 | 会话服务层：终态三层保证 + 看门狗 |
| `2026-09-13-mcp-session-owner-validation` | 会话归属校验不在最早边界上 | 会话服务层 |
| `2026-09-15-onboarding-results-claim-what-they-cannot-know`（本轮） | 工具结果说了三句这个进程没有证据的话 | 协议层 + 派发层 |

**同一类，而且是同一句话的五次分期付款**：*调用方必须知道的每一件事，都要由知道它的那一层明说，且说的必须是它真的观察到的。*
前两份管「该说的没说」（必填、错误码、句柄），后三份管「说的不是真的」（停在中间态 = 关于进度的假话；
归属没校验 = 关于「你是谁」的假设；本轮三处 = 关于 Nomi 在不在、用户 key 在不在、供应商有没有端点的假话）。

## 2. 缺口在哪一层

**在派发层与协议层之间，不在会话服务层。** 判据是：这条路上每一句面向调用方的话，是从**声明**来的，还是从**副产物**反推的。

| 结论 | 从哪来 | 副产物 | 它同时对应的其它世界 |
|---|---|---|---|
| 「要不要问用户拿 key」 | ~~有没有铸出一次性填写页~~ → `isWaitingForKey(nextAction.kind)` | 票据 | ① 根本不需要问（key 已存）② 需要问但铸不出页 |
| 「Nomi 在不在运行」 | ~~填写页没打开~~ → 删掉这个结论，只说「页面没能打开」 | 打开失败 | ① GUI 在跑但拒了链接 ② 客户端不支持 URL 模式 ③ GUI 真没跑 |
| 「用户存没存 key」 | ~~探测器抛没抛~~ → 借 owner 那份 `credentialResolver` | 抛异常 | ① 我们没传解析器 ② 真的没存 ③ 存了但解不开 |
| 「这家有没有模型清单端点」 | ~~有没有 setupId~~ → `no_such_connection`（关于我们自己） | 缺 setupId | ① 我们没接 vendorKey 那条路 ② 真的没有端点 |

四行的形状完全一样：**判据是一个副产物，副产物对应两到三个互不相干的世界，代码挑最坏的那个当结论说出去。**
对人类用户，一句错话让他困惑一次；对 Agent，它是硬事实——2026-09-15 的真实闭环里，外部 Agent 读到
「Nomi 没在运行」之后三个回合都在劝用户去开 Nomi、去重贴 key，任务就此停住
（证据 `docs/evidence/2026-09-15-mcp-onboarding-real-host/`）。

信封层其实已经有正确形状的先例：`unverified` 里那条 `model_produces_output` 是「我没证据」的显式表达，
自检通过也消不掉（门岗 O5 守着）。缺的不是机制，是**把这个机制用到 nextAction 与错误文案上**——
那两处至今是自由散文。

## 3. 这一轮修了什么、没修什么

修（本合同）：三处判据从副产物搬到声明；`isWaitingForKey` / `NAMED` 提成具名边界；
凭据解析器与认证服务变成 owner 的公开读口（堵掉「私有拿不到就自己造一个 undefined」）。

**没修，且这次真实闭环新挖出来的**（各自独立，不塞进本合同）：

1. **`draft_adapter` 的 adapterDraft 形状对不上。** 声明说 `{"sources":[...],"models":[...]}`
   （`declarations.ts` draft_adapter 的 params 槽），校验器要的是 `candidates` / `selections`
   （`integrationProposalValidation.ts` 的 `proposal.candidates must contain 1 to 100 items`）。
   真实闭环里 Agent 连试四次都被同一句拒绝，无法自纠——这是 O4 那条「描述与运行时必须同一份」
   在**嵌套 JSON 文本**里的漏网：O4 只覆盖 schema 字段，不覆盖「字段里那段 JSON 的形状」。
2. **`choose_models` 收下的 kind 被丢掉。** 真实闭环里显式传 `kind: image` / `kind: video`
   的两个模型，落到 catalog 里都是 `kind: "text"`。字段是必填、模型写对了、值被无声丢弃。
3. **单次生成对外宿主默认关。** `mcpGenerationPolicy.ts:9` 的 `NOMI_MCP_GENERATION_SINGLE_SHOT_V1`
   默认为空 → `:169` 回 `feature_disabled`。装机版不设这个 env，所以今天**外部 MCP 宿主出不了片**。
   Agent 把 `feature_disabled` 读成了「Nomi 没在运行」——同一族的第五次显形：一个不带主语的错误码。
4. **T-MO-10「验证扣积分」仍然成立**（本轮只核实）：App 内 测试连接 按钮走
   `electron/ai/onboarding/onboardingIpc.ts:50/53/56` 三条裸 POST（`/v1/messages`、`/responses`、
   `/chat/completions`，autoProbe 下一次点击最多三条），自定义调用的测试运行
   `electron/catalog/customCallIpc.ts:37-42` 是一次真的 text_to_image / text_to_video，
   ComfyUI 自检在 `integrationSession.ts:412` 自铸 `mintSpendGrant`——三处都不过报价卡，
   与 2026-09-09 拍板的「每次提交看报价确认」冲突。这是钱的闸的改动，不该在验收 lane 里顺手改。

## 4. 建议的下一刀（按能拦住的层排，不按工作量）

1. **把「结论的主语」变成类型问题。** `nextAction.userSees` 与错误 `bodyExcerpt` 目前是自由字符串。
   让它们只能由一张「我们观察到了什么」的判别联合派生（沿用 `envelope.ts` 的 `UnverifiedClaim` 形状），
   主语不是 Nomi 自己的句子在编译期就写不出来。这一刀能同时拦住上面 1–3 和本轮那三处。
2. **O4 覆盖到嵌套 JSON。** `draft_adapter` 的 `contractSchema` 已经在 compileRequest 里发给模型了，
   把它变成**同一份 schema 的两个出口**（声明的 params 文案与校验器的入参），别让散文描述自己写一遍。
3. **T-MO-10 单独一条 lane**：三处自检/测试按钮统一走 `taskSpend` 的报价分支；ComfyUI 那条的
   「自检不花钱」文案在 hosted Comfy 上是假的，要么改文案要么改行为，不能两个都留。

## 5. 这份评审拦不住什么

它只看这一条结构上的判据来源。真正把「主语不对的句子」挡住的防线还不存在——本轮只是把四处
改对了，新写一个动作照样可以再编一句。第 4 节第 1 刀才是那道防线，目前只是建议，没有门岗。
