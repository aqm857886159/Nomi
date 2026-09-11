# 静默分支普查 · 2026-09-11

> 📎 **交接/日志**（普查报告，不是方案）。
> 复跑：`node ./scripts/census-silent-branches.mjs`（汇总）｜`--json`（机器可读全量）｜`--top 30`（按用户可见后果排序）｜`--category d --layer UI`（筛）。
> 全量 JSON **不入库**：它是脚本的派生物，`--json` 随时逐字重出；把 450KB 的生成物钉进
> 仓里，只会让每次评审都去读一份没人手写过的东西（它也确实撞了 ponytail 的 diff 上限）。
> 需要冻结的那部分——900 个位置的 `file:line` + 类别——已经逐条落在 §7。
> §5 的门岗 `check:silent-branches` 是**设计，尚未实施**。

## 0. 为什么有这份普查

2026-09-11 这一天，付费卡链路上连撞三处同样的毛病：

| # | 位置 | 写法 | 用户看到的 |
|---|---|---|---|
| ① | `src/workbench/ai/v4/useAgentPanelSpendConfirm.ts:144` | `void run(target).catch(() => undefined)` | 点「确认」，圈转完，卡还在原地——不知道是没点到还是失败了 |
| ② | `electron/productionRun/productionActionIpc.ts:62` | `catch { return [] }` | 面板显示「没有要确认的东西」，真相是能力核读失败了 |
| ③ | `electron/capabilityCore/appIntegration.ts:508` | `catch (error) { logError(...) }` | 整条付费卡 lane 静默缺席，界面上连入口都不出现 |

三处的形状是同一个：**失败没有回到调用方，于是界面上什么都不会响**。

这是**一类病，不是三个 bug**。撞见一处修一处，等于每次都在还同一笔债的利息。
所以先用机器把同类在全仓数出来——先知道有多少、在哪、谁最要命——再决定修哪些、拦哪些。

本文只做普查和分诊，**不写修法代码**。

## 1. 怎么数的

`scripts/census-silent-branches.mjs`。用仓里已有的 `typescript` 编译器 API 走 AST，与
`check:vocabularies`（`scripts/check-vocabularies-scan.mjs`）同一套解析方式，**不引新依赖**。
扫 `src/` 与 `electron/` 全部 `.ts/.tsx/.mts/.cts`，排除 `*.test.*` / `*.spec.*` / `*.node-test.*`
与构建产物——走查脚本里吞错只会让走查自己不准，不会让用户看不到东西。

### 1.1 六个类别

| 类别 | 抓什么 |
|---|---|
| **a1** | 空 catch —— catch 块里一条语句都没有 |
| **a2** | catch 只 log 不回错 —— 写进日志，调用方拿到的仍是成功 |
| **b** | `.catch(() => 常量)` —— 把 rejection 换成 `undefined`/`null`/`[]`/`{}`/`false` |
| **c** | `void <promise>` 且无 `.catch` —— fire-and-forget，失败只剩 unhandledRejection |
| **d** | catch 里写空值 —— `return []`/`null`，**或** `setPending(undefined)`（失败伪装成「无数据」） |
| **e** | catch 不中断、直接落回成功路径（fallthrough） |
| **f** | 带 `fallback`/`兜底`/`默认为`/`best-effort` 注释的静默分支 |

a/e/f 会重叠（同一处 catch 可以既是 a1 又是 e）：**900 个不同位置、1032 条命中**，其中 120 处带多个标签。

### 1.2 「响了」的判据（为什么必须走 AST 而不是 grep）

判「这条 catch 有没有把失败传出去」必须走 AST。第一版用正则扫 catch 块文本，被
`logError('capability', 'resident-generation-adapter-install-failed', error)` 里那个字符串 `"failed"` 骗过去，
**当天三处证据之一（③）被自己的启发式判成「已经报错了」漏掉**。日志消息里的词不是控制流。

现在认三种「响了」：

1. `throw` / `Promise.reject` / `new Error`；
2. 调用名长成**报错形状**——`set|show|report|push|surface|notify|record|…` 接 `Error|Failure|Feedback|Toast|Notice|…`。
   用形状不用清单：清单会过期，形状跟着仓里的命名规范走（实测覆盖 `reportCanvasFeedback`、`setSaveError`、`recordModelFailure`、`showUndoToast` 等 30+ 个真实函数名）；
3. **把失败命名给了下游**——实参里出现失败态字面量，如 `setNodeStatus(id, 'recoverable', message)`、
   `transition({ lifecycle: 'undone' })`。这类调用把节点打成用户看得见的错误态，算响了。

### 1.3 层归属 =「这条失败会让用户看到什么」

| 层 | 用户看到什么 |
|---|---|
| **UI** | 界面停在旧状态或空状态——按钮转完圈回到原样，用户以为自己没点到，会重复点 |
| **IPC** | 渲染层收到一个「合法的空答案」，面板据此渲染「没有内容」，真相是主进程那边炸了 |
| **MAIN** | 主进程编排半装/半跑——功能整块静默缺席，界面上连入口都不出现，用户只会说「它没了」 |
| **CORE** | 纯数据/契约层把坏输入洗成好输出，错误顺着调用链向上消失，最终在很远的地方表现成别的 bug |

> **踩过的坑，写在这免得再犯**：层归属的正则第一版没从文件名开头锚定，于是
> `SpendConfirmDialog.tsx` 被判成「日志层」——`Dia`**`log`**`.tsx` 命中了 `log[A-Za-z]*\.tsx`——
> 付费确认弹窗里的静默分支被「日志兜底」这条豁免理由白白放过。
> **误判成豁免比漏报更坏**：漏报只是没数到，误判是普查亲手给真问题发了通行证。

### 1.4 自检：普查自己得站得住（R17「加规则先验它会红」）

| 对照组 | 位置 | 期望 | 结果 |
|---|---|---|---|
| 阳性 ① | `useAgentPanelSpendConfirm.ts:144` | 命中 | ✅ `b` |
| 阳性 ①的根 | `useAgentPanelSpendConfirm.ts:106` | 命中 | ✅ `d`（`setPending(undefined)`）|
| 阳性 ② | `productionActionIpc.ts:62` | 命中 | ✅ `d`（`[]`）|
| 阳性 ③ | `appIntegration.ts:508` | 命中 | ✅ `a2`+`e` |
| 阴性 | `components/batchPlanPreview.ts:40`（走 `reportCanvasFeedback`） | 排除 | ✅ |
| 阴性 | `runner/recoverTaskActions.ts:102`（走 `setNodeStatus(…,'recoverable',…)`） | 排除 | ✅ |
| 阴性 | `canvasReadSurfacePort.ts:165`（`assertTrustedSender` 守卫） | 归「设计如此」 | ✅ |
| 阴性 | `SpendConfirmDialog.tsx:63`（localStorage 探针） | 归「设计如此」 | ✅ |

「阳性①的根」那条是普查自己挖出来的，值得单说：**exemplar ① 的链条真正断在上游的
`catch { setPending(undefined) }`，不在下游那句 `.catch(() => undefined)`**。
只认 `return` 的第一版会把这类根因整片漏掉——UI 层本来就很少 `return`，它写 state。
**这就是「只修撞见的那处」和「把一类数出来」的差别**：撞见的是症状，普查顺手把根因也摆出来了。

## 2. 总表

扫描 **2328** 个文件，命中 **1127** 条；扣掉「设计如此」**95** 条（§4），
待分诊 **1032** 条，分布在 **900 个不同位置 / 415 个文件**（占被扫文件的 18%）。

### 2.1 类别 × 层

| 类别 | UI | IPC | MAIN | CORE | 合计 |
|---|--:|--:|--:|--:|--:|
| **a1** | 56 | 11 | 165 | 10 | **242** |
| **a2** | 1 | 0 | 29 | 0 | **30** |
| **b** | 69 | 11 | 68 | 13 | **161** |
| **c** | 129 | 15 | 33 | 15 | **192** |
| **d** | 58 | 7 | 151 | 12 | **228** |
| **e** | 29 | 6 | 101 | 6 | **142** |
| **f** | 3 | 1 | 30 | 3 | **37** |
| **合计** | 345 | 51 | 577 | 59 | **1032** |

**读法**：`MAIN` 那一列最厚，`a1`/`d` 最多。主进程编排层大量用「装配失败就跳过这一块」的写法——
这正是 exemplar ③ 的形状：**功能整块静默缺席，用户只会说「它没了」**，既不报错也没有入口可点，
连提 bug 的语言都给不出来。

`c`（`void promise`）在 UI 层最厚（129 条），但性质不一样：多数情况下上游那个 `refresh()`
自己已经把失败吞成空态了，`void` 只是没有再接一手。**`c` 常是症状，`d` 才是那条链的根因**——
`useAgentPanelSpendConfirm.ts` 就是活例：113/114/146 三条 `void refresh()` 都在名单上，
但真正让卡消失的是 106 行的 `catch { setPending(undefined) }`。**修 `c` 不会让任何东西响起来。**

### 2.2 领域 × 层（钱 / 生成 / 画布 优先）

| 领域 | UI | IPC | MAIN | CORE | 合计 |
|---|--:|--:|--:|--:|--:|
| 钱（付费确认/授权/收据/配额） | 13 | 3 | 17 | 0 | **33** |
| 生成任务（run/调度/供应商/模型） | 153 | 7 | 177 | 8 | **345** |
| 画布（节点/图/时间轴/分镜） | 38 | 6 | 40 | 0 | **84** |
| 项目（库/持久化/迁移） | 43 | 3 | 52 | 0 | **98** |
| Agent（会话/MCP/工具/技能） | 4 | 2 | 86 | 0 | **92** |
| 素材（媒体/上传/落盘） | 12 | 3 | 73 | 13 | **101** |
| 设置/偏好/i18n | 12 | 3 | 7 | 4 | **26** |
| 其它 | 70 | 24 | 125 | 34 | **253** |

钱只有 33 条——**但今天三处全落在这 33 条里**，而且三处都是用户当场看得见的。
密度不是危险度：生成任务那 300 多条里有大量是「取缩略图失败 → 不显示缩略图」这种可容忍的降级；
而钱这 33 条里，任何一条静默都直接变成「我点了确认，它没反应」或「它说没有要确认的」。
**所以 §3 的排序按钱 → 生成 → 画布，不按密度。**

### 2.3 命中最密的 10 个文件

| 文件 | 位置数 |
|---|--:|
| `electron/productionRun/productionRunService.ts` | 22 |
| `src/workbench/creation/storyboard/StoryboardPlanEditor.tsx` | 10 |
| `electron/surfacePortPreloadBridge.ts` | 10 |
| `electron/capabilityCore/appIntegration.ts` | 9 |
| `electron/productionRun/productionRunDriverOps.ts` | 9 |
| `electron/assets/localAssetFile.ts` | 9 |
| `electron/comfyuiProgressSocket.ts` | 9 |
| `electron/main.ts` | 9 |
| `src/ui/onboarding/OnboardingDrawer.tsx` | 9 |
| `electron/capabilityCore/appIntegrationRunObservation.ts` | 7 |

第 10 名是**三选一的并列**：`projectLeaseStore.ts`、`screenshotHotkey.ts` 同为 7 处。
密度只用来指路（「这个文件整体该过一遍」），不用来定优先级——定优先级的是 §3 的用户可见后果。

## 3. 按用户可见后果排序的前 30 条

排序 = 领域权重（钱 100 / 生成 80 / 画布 70 …）+ 类别权重（完全无声 > 有日志）+ 层权重。
「该响的方式」只说**该往哪儿响**，不写修法代码。已确认「设计如此且理由成立」的不在此表，见 §4。

### 3.1 钱（付费确认 / 授权 / 收据）

| # | 位置 | 类 | 现在 | 用户看到的 | 该响的方式 |
|---|---|---|---|---|---|
| 1 | `src/workbench/ai/v4/useAgentPanelSpendConfirm.ts:106` | d | `catch { setPending(undefined) }` | 待确认的付费卡**凭空消失**，下一次轮询也不会把它带回来 | 区分「通道还没起来」（保持上一次的卡，不清空）与「读失败」（卡位保留 + 顶部一条失败提示）。现在两种情况共用同一条清空路径，**这是 exemplar ① 的真正根因** |
| 2 | `src/workbench/ai/v4/useAgentPanelSpendConfirm.ts:144` | b | `.catch(() => undefined)` | 点「确认」→ 圈转完 → 卡还在原地，不知道是没点到还是失败 | 确认结果必须回到调用方：成功关卡、失败在**卡上原地**显示失败态并保留重试（用户拍板过「确认与角标必须原地内联」） |
| 3 | `electron/productionRun/productionActionIpc.ts:62` | d | `catch { return [] }` | 面板显示「没有要确认的东西」，真相是能力核读失败 | 通道注释说的是「能力核还没起来 ≠ 错误」——那是对的，但它现在把**真实读失败**也一起吞了。分成两种返回：`not-ready`（面板保持静默）与 `failed`（面板顶部提示），别共用 `[]` |
| 4 | `electron/capabilityCore/appIntegration.ts:508` | a2+e | `catch { logError(...) }` 后继续 | 整条付费卡 lane 静默缺席，界面上连入口都不出现 | 装配失败必须 fail-loud：要么抛到启动路径让能力核起不来（这条 lane 是钱的必经之路），要么把「付费确认不可用」作为一等状态送到面板顶部。**只写日志 = 用户永远不知道** |
| 5 | `src/workbench/capability/useIntegrationConfirmationNotice.ts:30` | d | `catch { return }` | 有待确认的接入会话，但提示条**永远不出现** | 拉取失败要与「队列为空」分开；失败时保留上一次的提示条，不要静默撤掉 |
| 6 | `src/workbench/generationCanvas/spend/anchorCheckpointView.ts:135` | d | `catch { return null }` | 付费确认卡上**不显示缩略图**，用户在看不见素材的情况下批钱 | 缩略图建不出来时显示明确占位（「预览不可用」），不是什么都不画——钱的卡上「没图」和「加载中」必须可区分 |
| 7 | `src/workbench/generationCanvas/spend/anchorCheckpointView.ts:158` | d | 同上（`thumbnailFor`） | 同上 | 同 6；两处同一形状，一起改 |
| 8 | `src/workbench/ai/lane/laneReceiptUndo.ts:14` | d | `catch { return undefined }` | 收据解析失败 → **撤销按钮静默消失**，用户以为这步不能撤 | 解析失败应返回可区分的「收据损坏」而不是「没有可撤销项」；按钮该显示为禁用+原因，不是不存在 |
| 9 | `electron/capabilityCore/projectAgentProposalReceiptStore.ts:243` | d | `catch { ENOENT → null; 其它 → null }` | 收据文件**损坏**与**不存在**返回同一个 `null` | 代码已经把 ENOENT 单拎出来却返回同样的值——这行本身就在说它想区分。损坏应返回错误态，让上层报「授权记录损坏，请重新确认」，而不是当成从没授权过 |
| 10 | `electron/capabilityCore/appIntegration.ts:248` | d | `catch { return }` | 一镜完成了，结果**推不到画布**，占位节点永远停在生成中 | best-effort 推送失败要留痕到该镜的状态上（下次打开项目的补齐钩子据此重试），不是直接 return |
| 11 | `electron/capabilityCore/appIntegration.ts:272` | a2 | `catch { logWarn(...) }` | 同上：`production.attach-shot-result` 超时/失败后节点不回填 | 同 10；这两条是同一条链的前后半段 |
| 12 | `src/workbench/generationCanvas/runner/generationRunController.ts:617` | a1 | `catch { /* 失败已记在节点上 */ }` | 注释成立**当且仅当** `runGenerationNode` 真的落了节点错误 | 理由可能是对的，但**没有测试钉住它**。要么加一条断言（节点必然进 error 态），要么别吞。按 R21 的问法：这条不变量归哪层管、那层有没有测试 |
| 13 | `src/workbench/generationCanvas/runner/generationRunController.ts:656` | d | `catch { return }` + 同款注释 | 变体连发中途失败即停，理由同上 | 同 12 |

### 3.2 生成任务 / 模型接入

| # | 位置 | 类 | 现在 | 用户看到的 | 该响的方式 |
|---|---|---|---|---|---|
| 14 | `src/workbench/settings/AiModelsSection.tsx:94` | d | `catch { setProviders([]) }` | **设置里「我的模型」整片空了**——正是群反馈里反复出现的「我的模型没了」 | 读失败显示失败态 + 重试，绝不能渲染成「你没有配置过任何供应商」。空态与失败态在这一屏必须是两种画面 |
| 15 | `src/workbench/settings/AiModelsSection.tsx:88` | b | `.catch(() => undefined)` | 保存供应商设置失败**无声**，用户以为改好了 | 保存类动作失败必须回到发起处：行内失败提示 + 保留用户输入 |
| 16 | `src/workbench/skillLibrary/useWorkbenchSkills.ts:32` | d | `catch { setItems([]) }` | **技能库显示为空**，用户以为技能没装上 | 同 14：失败态 ≠ 空态 |
| 17 | `src/workbench/ai/v4/useAgentPanelV4Data.ts:143` | d | `catch { setSkills([]) }` | Agent 面板里技能 chip 全没了 | 同 14；与 16 是同一份数据的两个读点，**一起改否则只修一半** |
| 18 | `src/workbench/generationCanvas/nodes/decompose/useDecomposeLayers.ts:22` | b | `.catch(() => [])` | 供应商列表读失败 → 被当成「没接 Replicate」→ 弹出**错误的引导弹窗** | 读失败和「确实没接」是两件事；读失败该说「读不到模型列表」，别把用户导去配一个他其实已经配好的东西 |
| 19 | `src/workbench/generationCanvas/agent/shotVerifyStore.ts:190` | d | `catch { completeVerify(..., []); return [] }` | 看片自评崩了，界面显示**「没有发现偏差」** | 最危险的一种：把「没检查成」渲染成「检查通过了」。必须是第三种状态「本次未能校验」 |
| 20 | `src/workbench/generationCanvas/runner/localTaskControl.ts:95` | d | `catch { return false }` | ComfyUI 进度订阅没建立，节点进度条**永远不动** | 订阅失败要落到节点上（「进度不可用，任务可能仍在跑」），不是静默 false |
| 21 | `src/workbench/generationCanvas/adapters/persistNodeImage.ts:24` | d | `catch { return null }` | 落盘失败 → 调用方退回 base64 兜底 | 兜底本身是设计，但 **base64 进 store 正是 `check:heavy-path` 明令拦的那一族**（大图会把撤销日志/IPC/事件日志一起拖垮）。退化路径要么有明确上限，要么明着告诉用户「这张没能存进工程」 |
| 22 | `src/workbench/generationCanvas/adapters/persistNodeImage.ts:79` | d | `catch { return null }`（`dataUrlToFile`） | 同上链路的前半段 | 同 21 |
| 23 | `src/workbench/generationCanvas/agent/availableModels.ts:192` | d | `catch { return {} }` | 分镜图片默认模型解析失败 → 空档案 → Agent 拿着**空参数去建节点** | 解析失败要阻断建节点并说明，不是交一份空档案下去、让错误在更远的地方爆 |
| 24 | `src/workbench/generationCanvas/agent/availableModels.ts:219` | d | 同上（视频档） | 同上 | 同 23 |
| 25 | `src/workbench/generationCanvas/agent/projectMemoryClient.ts:28` | d | `catch { return [] }` | 项目记忆读失败 → Agent **以为这个项目没有记忆**，行为悄悄退化 | 记忆读失败要让 Agent 知道是「读不到」而不是「没有」——两者会导出完全不同的行为 |
| 26 | `src/ui/onboarding/LocalModelCard.tsx:78` | d | `catch { setHits([]) }` | 本地模型探测失败显示成「没探测到」 | 探测失败与「确实没有」要分开：一个该提示重试，一个该引导手填地址 |
| 27 | `src/ui/onboarding/AiAssistedOnboardingSection.tsx:70` | d | `catch { setInfo(null) }` | MCP 状态行整段不显示 | 读不到就显示「状态未知」，比整段消失强——用户至少知道有这么个东西 |

### 3.3 编排 / 持久化（用户说「它没了」的那一族）

| # | 位置 | 类 | 现在 | 用户看到的 | 该响的方式 |
|---|---|---|---|---|---|
| 28 | `electron/productionRun/productionRunService.ts`（22 处，最密） | a1/a2/c/d | 大量「命令冲突就跳过」与 `void` 派发 | 批量生成里个别镜头静默不前进，进度条卡住但没有失败 | 逐条过一遍：真正的幂等冲突（如 `:560` 并发已对账）可留，**其余要把失败记到该 job 的状态上**，让返工/续拍看得见 |
| 29 | `electron/productionRun/canvasLandingHost.ts:61`、`electron/capabilityCore/appIntegrationRunObservation.ts:87,123` | d | `catch { return false }` / `catch { return }` | run **读失败**被当成「没有这个 run」→ 落地与调度整段不发生：生成跑完了，画布上什么都没出现 | 三处都是 `repository.read` 失败与「run 不存在」共用同一条返回。读失败要与「确实没有」分开：前者该重试并留痕（补齐钩子据此再来一次），后者才是正常的跳过 |
| 30 | `electron/main.ts:367,368,372,668`（4 处 `b`） | b | 启动期 `.catch(() => undefined)` | 启动期的注册/迁移失败无声，表现为某功能这次启动就是不在 | 启动期失败要进一条可查询的「本次启动降级清单」，设置或诊断里能看到，而不是只活在日志里 |

> **不在前 30、但同类且值得顺手看的**：`electron/screenshot/screenshotHotkey.ts`（7 处）、
> `electron/video/depthVideoJob.ts`、`electron/assets/localAssetFile.ts`、
> `electron/comfyuiProgressSocket.ts`（各 9 处上下）。全量见 §7。

## 4. 设计如此、且理由成立的（95 条，不计入待修）

普查会**主动把这些摘出去**。判据严格：**理由必须是领域约束，不能是「反正也处理不了」**。

| 条数 | 理由 | 位置 |
|---|---|---|
| 64 | 浏览器存储访问在隐私窗口/禁用站点数据时会直接 throw，按约定必须 try/catch 且以「没有存过」继续。 | `src/design/confirmDialog.tsx:55`、`src/desktop/activeProject.ts:24`、`src/devlab/directorLab.tsx:27,35`、`src/i18n/index.ts:21,86`、`src/theme/colorScheme.ts:45,74`、`src/ui/community/feedbackOutbox.ts:19`、`src/ui/onboarding/AiAssistedOnboardingSection.tsx:141`、`src/utils/canvasGesturePreference.ts:57`、`src/workbench/NomiStudioApp.tsx:312`、`src/workbench/ai/assistantModelPref.ts:17,28`、`src/workbench/assets/assetSurfaceMigration.ts:286,307`、`src/workbench/generationCanvas/agent/shotVerifyStore.ts:30`、`src/workbench/generationCanvas/components/canvasProductionScope.ts:54`、`src/workbench/generationCanvas/nodes/director/DirectorEditor.tsx:76,169`、`src/workbench/generationCanvas/nodes/director/agent/CameraMoveCaptureHost.tsx:48,116`、`src/workbench/generationCanvas/nodes/director/panels/EditorSplit.tsx:41`、`src/workbench/generationCanvas/nodes/director/panels/side/SidePanels.tsx:43,51,59`、`src/workbench/generationCanvas/nodes/director/panels/viewport/PipViewport.tsx:48`、`src/workbench/generationCanvas/nodes/director/scene/E2EBridge.tsx:52`、`src/workbench/generationCanvas/nodes/director/scene/viewSettings.ts:70`、`src/workbench/generationCanvas/nodes/director/useAiSceneBuilder.ts:34`、`src/workbench/generationCanvas/nodes/director/useMobileCamera.ts:99`、`src/workbench/generationCanvas/runner/modelHealthMemory.ts:31,43`、`src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx:63`、`src/workbench/library/libraryDiscovery.ts:71,81`、`src/workbench/library/workflowLibrary.ts:32`、`src/workbench/onboarding/onboardingState.ts:36,57,69,77,86,94,135`、`src/workbench/preview/editingPanelLayoutSlice.ts:74,109`、`src/workbench/production/ProductionCanvasLandingHost.tsx:55`、`src/workbench/project/projectStorage.ts:15,24,62`、`src/workbench/taskCenter/TaskCenterButton.tsx:107`、`src/workbench/timeline/TimelineMiniPreview.tsx:31`、`src/workbench/timeline/timelinePanelPrefs.ts:22,31` |
| 20 | 日志/遥测自身的兜底：写日志失败再抛会把主流程一起拖倒，属于可观测性降级而非功能失败。 | `electron/crashLog.ts:115`、`electron/diagnostics/diagnosticsBundle.ts:53,70`、`electron/logging/logFiles.ts:36,70,120,130,162,177`、`electron/logging/logger.ts:148,199`、`electron/telemetry/telemetryOutbox.ts:63`、`src/workbench/settings/TelemetrySection.tsx:23,26,69` |
| 11 | 信任边界守卫：来路不明的 IPC 消息就是要**无声丢弃**——回一条错误等于告诉攻击方通道存在。安全上静默才是正解。 | `electron/capabilityCore/canvasReadSurfacePort.ts:135,165,173,181,189,197,205,213,221,229,237` |

另外四类在名单上但**逐条读过、理由成立**，保留只是因为机器判不了，不该当成待修：

- `electron/capabilityCore/gateway.ts:154 / 163`（`confirmSpend` / `confirmPlan`）——渲染层超时/不可用时
  返回「未确认」。**钱上 fail-closed 是正解**：宁可让用户重点一次，不可以把超时当成同意。
- `electron/spendGrant.ts:133`——`previous.catch(() => undefined)` 是确认锁链，故意让前一个等待者的失败
  不传染给下一个。换成传播反而制造串联故障。
- `electron/capabilityCore/mcpDocumentWriteReceipt.ts:63`、`electron/integrationCertification/integrationSession.ts:644`
  ——catch 之后**紧接着 `throw error` 或走进一个会抛的校验**，原始失败没丢。
- `electron/vendor/vendorOutboundGuard.ts:99`——URL 解析不出来返回 `null`（不拦），注释已写明：
  那是调用方拼错了地址，交给 fetch 自己报 `Invalid URL`，比在这里假装成一次安全拒绝诚实。

**没进这一档的常见借口**（这些不算理由）：「best-effort」「不阻塞主流程」「反正下次轮询还会拉」。
前两个描述的是**代价**不是**理由**；第三个在轮询本身也失败时就不成立了——exemplar ② 正是这么来的。

## 5. 门岗设计：`check:silent-branches`（本次不实施）

### 5.1 形状

与 `check:heavy-path` / `check:tokens` / `check:i18n` 同款**棘轮**：

- 基线冻结在 `scripts/silent-branches-baseline.json`，**存身份不存裸数字**（与 `check:boundaries` 同理由：
  裸数字放过「修一条旧的、同 commit 新增一条」的蒙混，身份差集才拦得住）。
- 身份 = `文件路径 + 类别 + 所在函数名`。**不含行号**——行号会随无关编辑漂移，
  一个天天假红的门岗等于没门岗（`check:heavy-path` 的注释里已经写过这条教训）。
- 新增不在基线里的 → 红牌当场拦；基线里已消失的 → 红牌要求同步删那行（否则成永久豁免）。
- `--update-baseline` 只在真降或初始化时用。

### 5.2 先验它会红（R17 硬要求）

门岗上线前必须证明它拦得住**今天这三处**。检测器这一半今天已经证完——三处都在名单上，
现在就能复跑（这是门岗「会红」的必要条件：检测不到就永远拦不住）：

```
node ./scripts/census-silent-branches.mjs --json --file useAgentPanelSpendConfirm   # ① 106 d / 144 b
node ./scripts/census-silent-branches.mjs --json --file productionActionIpc         # ② 62  d
node ./scripts/census-silent-branches.mjs --json --file appIntegration.ts           # ③ 508 a2+e
```

剩下一半在门岗实施时补：把三处从基线里摘掉再跑，必须红；加回去，必须绿。
**规则清单以脚本里的 `RULES` 为准，别在文档里数条数。**

### 5.3 只拦增量，且分档

1032 条存量一次修完不现实，也不该。建议分档：

| 档 | 范围 | 力度 |
|---|---|---|
| **硬拦** | `domain=money` 的任何新增（现 33 条） | 零增长。钱上没有 best-effort |
| **硬拦** | 新增 `a2`（只 log 不回错） | 零增长。这条最容易写、最难发现，且日志在桌面端基本没人看 |
| **棘轮** | `d` 在 UI/IPC 层（失败伪装成无数据） | 只减不增 |
| **棘轮** | `a1`/`b`/`e` 全层 | 只减不增 |
| **不拦** | `c`（`void promise`） | 交给 lint（§6），门岗不重复一份 |
| **不拦** | `f` | `f` 是注释启发式，当索引用，不当判据 |

### 5.4 逃生口本身要计数（从 Go / Rust 学来的那一条）

无论给什么显式豁免形式（`void`、`// eslint-disable`、一个 `ignoreError()` 辅助函数），
**它自己必须被计数并进同一条棘轮**，否则它就是新的万能绕过。
Go 的 `errcheck -blank` 默认关、typescript-eslint 的 `ignoreVoid` 默认开——
两个生态各自把同一个错误犯了一遍（见 §6.4）。

### 5.5 更早的那一层（R28）

门岗是第三道。真正该先做的两件：

1. **打开类型感知 lint**（§6.1）——`c` 那 192 处交给 `no-floating-promises`，门岗不必管；
2. **让契约层把失败表达成类型**——`listPendingSpendConfirmations` 返回
   `readonly PendingSpendConfirm[]` 时，`[]` 是合法值，**编译器帮不上忙**；
   返回 `{ ok: true; items } | { ok: false; reason }` 之后，
   `catch { return [] }` 这个写法在类型上就不成立了。
   **能让编译器拦的别留给门岗，能让门岗拦的别留给人。**

## 6. 先查别人

### 6.1 能今天就接进 lint 的

| 规则 | 拦什么 | 现状 | 关键坑 |
|---|---|---|---|
| [`@typescript-eslint/no-floating-promises`](https://typescript-eslint.io/rules/no-floating-promises/) | 没接手的 promise | **未启用**（需 `parserOptions.projectService` + `recommended-type-checked`；本仓现在用普通 `recommended`，没有类型感知） | **`ignoreVoid` 默认 `true`**——默认配置下 `void p` 恰好是官方认可的消音方式，本仓 192 处 `c` 一条都不会报。必须显式设 `ignoreVoid: false` |
| [`@typescript-eslint/no-misused-promises`](https://typescript-eslint.io/rules/no-misused-promises/) | async 回调塞进 `void` 位（经典 `onClick={async …}`） | 未启用，同上 | `checksVoidReturn` 默认开，接上类型感知即生效 |
| [`no-useless-catch`](https://eslint.org/docs/latest/rules/no-useless-catch) | `catch (e) { throw e }` | ✅ 已在 `eslint:recommended` | 只管裸 rethrow，与本普查无交集 |
| [`no-empty`](https://eslint.org/docs/latest/rules/no-empty) | 语法上空的块 | ✅ 已启用（warn） | 见 §6.2 |

### 6.2 一个必须写下来的发现：`no-empty` 对本仓结构性失明

本仓 `no-empty` 现在报 **0 条**，而普查数到 **242 处空 catch**。不是配置错了——
ESLint 文档白纸黑字：*"This rule ignores block statements which contain a comment"*，
`allowEmptyCatch`（默认 `false`）只管**不含注释**的空 catch。

而本仓 242 处空 catch **每一处都写了解释性注释**。于是：

> **团队越是认真写「为什么可以忽略」，`no-empty` 就越安静。**
> 它量的是**语法上的空**，而注释恰好是官方认可的「我是故意的」标记——
> 和我们想抓的东西正好相反。

这也说明为什么这一档只能自研：注释是**意图**，不是**行为**。写了理由的 catch 和没写的，
运行起来一模一样；理由还会过期（`gateway.ts` 的理由今天成立，明天改了确认链路就不一定）。

### 6.3 确认没有现成规则能拦的那一档

查遍主流生态，**没有任何规则检查「catch 处理器有没有真的把失败送出去」**：

- [`eslint-plugin-promise`](https://github.com/eslint-community/eslint-plugin-promise) 的 `catch-or-return`
  只检查 `.catch()` **存不存在**，不看处理器内容——`.catch(() => null)` 完美通过；
- [`@typescript-eslint/only-throw-error`](https://typescript-eslint.io/rules/only-throw-error/)、
  [`prefer-promise-reject-errors`](https://eslint.org/docs/latest/rules/prefer-promise-reject-errors)
  管的是**抛什么**，不管吞不吞；
- `no-empty-function` 能抓 `.catch(() => {})`，但不在 `recommended`，且函数体里加个注释同样放行。

**整个生态检查的都是结构**（有没有处理器？块是不是空的？抛的是不是 Error？），
**没有一个检查语义**（这个处理器让任何人看见了吗）。这就是自研 AST 门岗不可避免的理由。

### 6.4 值得抄的模型（抄思路，不是抄工具）

| 来源 | 机制 | 对我们的意义 |
|---|---|---|
| Rust [`#[must_use]` / `unused_must_use`](https://doc.rust-lang.org/reference/attributes/diagnostics.html#the-must_use-attribute)，[`Result` 自带 `#[must_use]`](https://doc.rust-lang.org/std/result/enum.Result.html) | 默认 warn，返回值不用就报 | TS 没有等价物，**抄不了工具、抄得了模型**：把失败编进返回类型（§5.5 第 2 条）就是 TS 版的 `Result` |
| Rust [`clippy::let_underscore_must_use`](https://rust-lang.github.io/rust-clippy/master/index.html#let_underscore_must_use) | 补 `let _ =` 这个洞 | 但它在 `restriction` 组、**默认关**——逃生口连 Rust 都没默认堵上 |
| Go [`errcheck`](https://github.com/kisielk/errcheck)（[golangci-lint 默认开](https://golangci-lint.run/docs/linters/)） | 返回的 error 必须被用或显式丢弃 | **`-blank` 默认关**，于是 `_ = f()` 是默认放行的万能绕过 |
| Swift [错误处理](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/errorhandling/) / [`@discardableResult`](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/attributes/#discardableResult) | 抛错调用**必须**写 `try`/`try?`/`try!`；返回值默认 must-use，在**定义处**显式 opt-out | 「吞掉」在源码里必须肉眼可见——这正是我们要的，`try?` 是**看得见的**吞 |
| Java [checked exceptions](https://docs.oracle.com/javase/specs/jls/se21/html/jls-11.html) | 编译器强制 catch 或 declare | 反面教材：`catch (Exception e) {}` 照样编译。**强制承认 ≠ 强制处理**——正是我们这 242 处 |
| [Kotlin 明确不做 checked exceptions](https://kotlinlang.org/docs/exceptions.html#checked-exceptions) | 官方理由就是空 catch 的退化 | 语法层强制会被形式化绕过，所以判据必须落在**行为**（有没有送到 sink）上 |
| [Sentry：捕获了不重抛，Sentry 就看不见](https://docs.sentry.io/platforms/javascript/guides/nextjs/capturing-errors/) | 每条 catch 都要到达一个可观测 sink | 我们的 sink 比它多一个、也更硬：**不止日志，要到用户眼前**。桌面端没人看日志 |

### 6.5 结论：分工

| 子类 | 最早能拦住的那层 | 判定 |
|---|---|---|
| `c` 没接手的 promise（192 处） | `no-floating-promises` + `ignoreVoid:false` | ✅ **交 lint**，门岗不重复 |
| 语法空且**无注释**的 catch | `no-empty`（已开） | ✅ 已覆盖，且正因如此报 0 |
| 裸 rethrow | `no-useless-catch`（已开） | ✅ 已覆盖 |
| `a1` 带注释的空 catch（242 处） | — 无现成规则 — | ❌ **自研门岗** |
| `a2` 只 log 不回错 | — 无 — | ❌ **自研门岗** |
| `b` `.catch(() => 常量)` | — 无 — | ❌ **自研门岗** |
| `d` catch 写空值（含 `setX(undefined)`） | — 无 — | ❌ **自研门岗** |
| `e` fallthrough | — 无 — | ❌ **自研门岗** |

**lint 能拿走的份额：192 / 900 ≈ 21%**，而且拿走的恰好是危害最轻的那一类
（`c` 多数只是 `d` 的下游）。**79% 必须自研**，理由在 §6.3：生态检查结构，我们要检查语义。

门岗的判据一句话：**一条 catch / rejection 处理器必须到达至少一个 sink——重抛、报错调用、
或用户看得见的失败态。注释不是 sink，日志在桌面端也基本不是。**

## 7. 逐条清单（按文件，900 个位置 / 415 个文件）

格式：`行号` + 类别字母（多字母 = 同一处命中多个类别）。全量字段见
`node ./scripts/census-silent-branches.mjs --json`（含所在函数、领域、评分、代码片段）；
筛选用 `--json --file <路径片段>`。JSON 里每条只存自己的事实：类别说明与层后果在顶层
`categories` / `layerConsequence` 两张表里按 `category` / `layer` 查，不逐条重复存。

| 文件 | 层 | 领域 | 位置数 | 位置`类别` |
|---|---|---|--:|---|
| `electron/productionRun/productionRunService.ts` | MAIN | generation | 22 | 160`c` 161`c` 211`d` 292`c` 318`c` 325`c` 340`c` 434`c` 437`c` 443`c` 453`a2` 461`c` 471`a2` 482`c` 492`a2` 498`c` 529`a2` 560`a1` 566`a1` 569`a1` 573`c` 586`a2` |
| `electron/capabilityCore/appIntegration.ts` | MAIN | generation/agent | 9 | 162`a1e` 248`d` 272`a2` 508`a2e` 515`c` 569`a2e` 576`a2` 639`a1f` 647`a2` |
| `electron/main.ts` | MAIN | other | 9 | 340`a2` 367`b` 368`b` 372`b` 640`a1ef` 660`a2e` 663`c` 668`b` 708`a2` |
| `electron/screenshot/screenshotHotkey.ts` | MAIN | canvas | 7 | 57`a1ef` 88`a1e` 102`b` 106`e` 124`d` 133`a1f` 143`b` |
| `electron/assets/localAssetFile.ts` | MAIN | project/asset | 9 | 24`d` 31`d` 52`d` 72`d` 102`a1` 108`a1e` 120`d` 178`e` 188`b` |
| `electron/comfyuiProgressSocket.ts` | MAIN | other | 9 | 109`d` 151`a1` 156`d` 251`a1` 280`f` 299`a1` 306`a1e` 407`b` 414`b` |
| `electron/surfacePortPreloadBridge.ts` | IPC | canvas/asset/other | 10 | 287`c` 316`c` 348`c` 382`c` 413`c` 445`c` 474`c` 504`c` 534`c` 563`c` |
| `electron/video/depthVideoJob.ts` | MAIN | generation | 5 | 131`a1e` 136`a1e` 141`a1e` 267`a1e` 272`a1e` |
| `src/workbench/creation/storyboard/StoryboardPlanEditor.tsx` | UI | generation/canvas | 10 | 303`c` 309`c` 314`c` 351`c` 364`c` 372`c` 376`c` 380`c` 381`c` 384`c` |
| `electron/catalog/codexCli.ts` | MAIN | generation/other | 6 | 69`d` 150`a1f` 159`d` 181`a1` 400`a1f` 415`a1f` |
| `electron/productionRun/productionRunDriverOps.ts` | MAIN | generation | 9 | 106`d` 279`a2` 345`a1` 407`a2` 564`d` 568`a1` 640`a2` 682`a1` 760`a1` |
| `src/ui/onboarding/OnboardingDrawer.tsx` | UI | other | 9 | 120`a1` 127`c` 149`c` 151`c` 152`c` 580`c` 594`c` 735`c` 770`c` |
| `electron/capabilityCore/mcpNodeLauncher.ts` | MAIN | canvas | 5 | 77`a1` 142`d` 184`a1ef` 279`a1` 370`a1f` |
| `electron/capabilityCore/projectLeaseStore.ts` | MAIN | project | 7 | 125`d` 160`a1` 236`a1e` 318`a1` 350`a1` 507`a1` 520`a1` |
| `electron/integrationCertification/integrationSession.ts` | MAIN | money/agent | 6 | 630`d` 644`a1e` 1097`e` 1146`a1e` 1172`a1` 1579`e` |
| `electron/productionRun/artifactProjection.ts` | MAIN | generation | 4 | 51`a1e` 59`a1ef` 62`a1e` 141`d` |
| `electron/agentLane/laneStreamObserver.mts` | MAIN | agent | 4 | 54`b` 67`a1bf` 74`a1e` 104`c` |
| `electron/assets/projectAssetStore.ts` | MAIN | project | 6 | 57`d` 70`a1` 200`a1` 236`a1e` 605`b` 675`d` |
| `electron/capabilityCore/appIntegrationRunObservation.ts` | MAIN | generation/canvas | 7 | 65`a2` 72`a2` 79`a2` 87`d` 113`b` 123`d` 172`b` |
| `electron/capabilityCore/lockfile.ts` | MAIN | agent | 4 | 42`a1f` 75`d` 81`d` 86`a1ef` |
| `electron/capabilityCore/security.ts` | MAIN | agent | 4 | 103`a1f` 107`a1e` 116`d` 131`a1e` |
| `src/workbench/generationCanvas/adapters/clipboardImagePaste.ts` | UI | generation | 5 | 249`a1e` 460`e` 496`a1e` 507`a1` 533`a1` |
| `electron/agentLane/laneHost.mts` | MAIN | agent | 6 | 164`b` 319`c` 479`b` 499`b` 599`b` 611`b` |
| `electron/browser/media/browserViewMedia.ts` | MAIN | asset | 6 | 36`b` 66`d` 104`d` 345`d` 460`b` 481`a1` |
| `electron/events/eventLogRepository.ts` | MAIN | project | 4 | 204`a2e` 240`d` 256`a1f` 276`d` |
| `electron/hardenedFetch.ts` | MAIN | other | 3 | 278`a1e` 325`a1e` 332`a1e` |
| `electron/productionRun/productionRunLock.ts` | MAIN | generation | 4 | 56`a1` 152`a1e` 161`a1e` 201`a1` |
| `electron/providerAdapter/certificationCleanup.ts` | MAIN | generation | 6 | 43`b` 50`b` 57`b` 59`b` 117`b` 134`b` |
| `electron/systemProxy.ts` | MAIN | generation/other | 6 | 83`d` 110`c` 367`b` 375`b` 378`b` 380`a1` |
| `electron/workspace/workspaceRegistry.ts` | MAIN | other | 4 | 43`f` 51`a1ef` 65`a1` 226`a1` |
| `electron/assets/localFileImport.ts` | MAIN | asset | 3 | 63`a2e` 128`d` 160`a1e` |
| `electron/browser/core/browserViews.ts` | MAIN | canvas/other | 5 | 224`c` 225`e` 289`c` 334`b` 496`d` |
| `electron/browser/media/browserMediaVisualCapture.ts` | MAIN | canvas/asset | 4 | 44`d` 78`d` 119`a1e` 170`d` |
| `electron/capabilityCore/host.ts` | MAIN | agent | 4 | 41`a1` 54`d` 121`a1e` 128`e` |
| `electron/capabilityCore/mcpConfig.ts` | MAIN | agent | 5 | 121`d` 279`d` 358`d` 461`a1` 512`a1` |
| `electron/capabilityCore/mcpDetectedClients.ts` | MAIN | agent | 3 | 53`a1e` 71`a1f` 81`d` |
| `electron/capabilityCore/mcpStdioServer.ts` | MAIN | generation/agent | 3 | 282`a1e` 292`a1e` 416`b` |
| `electron/catalog/processOperation.ts` | MAIN | other | 3 | 157`a1` 175`a1f` 178`a1f` |
| `electron/comfyuiGraphConvert.ts` | MAIN | canvas | 5 | 49`a1` 95`b` 109`b` 114`d` 193`d` |
| `electron/export/exportJobs.ts` | MAIN | generation | 4 | 108`d` 147`a1` 200`d` 383`a1f` |
| `electron/productionRun/productionRunE2eFixture.ts` | MAIN | generation | 4 | 20`d` 104`d` 166`d` 459`a1e` |
| `electron/vendor/boundedResponse.ts` | MAIN | generation | 3 | 25`a1e` 30`b` 43`a1e` |
| `electron/workspace/workspaceManifestTransaction.ts` | MAIN | other | 5 | 181`c` 185`e` 193`e` 212`e` 220`e` |
| `src/ui/app-shell/useUpdater.ts` | CORE | other | 5 | 95`b` 112`b` 117`b` 121`b` 125`b` |
| `src/ui/ErrorBoundary.tsx` | UI | generation/other | 3 | 15`a1e` 40`a1e` 49`b` |
| `src/ui/onboarding/CustomCallEditor.tsx` | UI | other | 5 | 83`d` 164`d` 440`c` 631`c` 675`c` |
| `src/ui/onboarding/workflowPage/ComfyuiWorkflowSettingsPage.tsx` | UI | settings | 5 | 98`b` 104`b` 185`d` 407`c` 454`c` |
| `src/workbench/ai/v4/useAgentPanelSpendConfirm.ts` | UI | money | 5 | 106`d` 113`c` 114`c` 144`b` 146`c` |
| `src/workbench/generationCanvas/nodes/PanoramaViewer.tsx` | UI | generation | 4 | 144`d` 158`c` 264`a1` 290`a1e` |
| `src/workbench/generationCanvas/runner/generationRunController.ts` | UI | money/generation | 5 | 360`b` 364`b` 617`a1` 656`d` 705`a1` |
| `src/workbench/NomiStudioApp.tsx` | UI | project/other | 5 | 126`d` 371`b` 586`c` 614`b` 640`d` |
| `src/workbench/onboarding/SplashIntro.tsx` | UI | other | 3 | 86`a1e` 102`e` 108`a1e` |
| `src/workbench/settings/AiModelsSection.tsx` | UI | generation | 5 | 88`b` 94`d` 106`c` 109`c` 320`c` |
| `src/workbench/taskCenter/TaskCenterButton.tsx` | UI | other | 5 | 61`a1` 76`a1` 83`c` 85`c` 208`c` |
| `electron/ai/onboarding/modelListSafety.ts` | MAIN | generation | 2 | 53`a1e` 57`a1e` |
| `electron/capabilityCore/core.ts` | MAIN | project | 3 | 255`e` 680`a1e` 743`a1` |
| `electron/catalog/dreaminaCodec.ts` | MAIN | asset/other | 3 | 66`a1e` 78`a1` 285`d` |
| `electron/catalog/dreaminaLoginIpc.ts` | IPC | other | 3 | 23`b` 67`b` 86`a1e` |
| `electron/director/mobileBridgeServer.ts` | IPC | other | 2 | 75`a1e` 93`a1e` |
| `electron/providerAdapter/tests/serviceReservationRaceFixture.ts` | MAIN | generation | 3 | 219`e` 263`a1e` 277`e` |
| `electron/proxyIpc.ts` | IPC | other | 4 | 29`b` 32`b` 43`b` 46`b` |
| `electron/proxyProbe.ts` | MAIN | other | 2 | 26`a1` 61`a1ef` |
| `electron/video/depthVideoModelCache.ts` | MAIN | generation | 3 | 47`d` 137`a1` 143`a1e` |
| `electron/video/extractVideoFrame.ts` | MAIN | asset | 4 | 69`a1` 156`a1` 234`a1` 321`a1` |
| `electron/workspace/legacyProjectMigration.ts` | MAIN | project | 4 | 33`d` 45`d` 93`d` 193`d` |
| `electron/workspace/workspaceManifestLock.ts` | MAIN | other | 4 | 153`d` 164`d` 175`d` 415`a1` |
| `src/ui/browser/dialog/useBrowserDialogActions.ts` | CORE | other | 4 | 313`c` 338`c` 382`c` 440`c` |
| `src/ui/chunkBoundary.tsx` | UI | generation/other | 2 | 28`a1e` 121`a1e` |
| `src/ui/onboarding/ComfyuiWorkflowImportPanel.tsx` | UI | canvas/other | 4 | 67`d` 132`b` 138`b` 150`b` |
| `src/ui/onboarding/OnboardingWizard.tsx` | UI | other | 4 | 161`b` 395`c` 497`a1` 646`c` |
| `src/ui/onboarding/useProviderAdapterTasks.ts` | CORE | generation | 4 | 28`b` 34`c` 36`c` 43`b` |
| `src/utils/showUndoToast.ts` | CORE | other | 3 | 49`a1` 56`d` 79`a1f` |
| `src/workbench/ai/composer/useComposerAttachments.ts` | UI | other | 4 | 73`a1` 125`c` 132`a1` 142`a1` |
| `src/workbench/ai/ProjectAgentResidentShell.tsx` | UI | project | 4 | 175`c` 263`c` 483`c` 487`c` |
| `src/workbench/generationCanvas/nodes/ClipNode.tsx` | UI | generation | 4 | 364`b` 600`c` 615`c` 626`c` |
| `src/workbench/generationCanvas/nodes/director/panels/side/AssetsTab.tsx` | UI | generation | 4 | 252`e` 256`b` 305`a1` 408`c` |
| `src/workbench/generationCanvas/nodes/director/useMobileCamera.ts` | UI | generation | 4 | 151`b` 161`b` 235`c` 243`b` |
| `src/workbench/generationCanvas/nodes/render/AudioStripNode.tsx` | UI | generation | 4 | 136`c` 155`b` 173`b` 189`b` |
| `src/workbench/project/workbenchProjectSession.ts` | UI | canvas/project | 3 | 61`ef` 294`c` 301`c` |
| `electron/ai/buildAiSdkModel.ts` | MAIN | generation | 2 | 80`a1` 98`a1e` |
| `electron/ai/onboarding/onboardingIpc.ts` | IPC | other | 3 | 63`b` 70`b` 152`d` |
| `electron/ai/streamTextTask.ts` | MAIN | asset/other | 3 | 59`a1` 166`b` 167`b` |
| `electron/assets/downloadAsset.ts` | MAIN | asset | 3 | 15`d` 68`d` 102`b` |
| `electron/browser/core/browserViewBridges.ts` | IPC | asset/other | 3 | 91`a1` 561`a1` 765`a1` |
| `electron/browser/core/browserViewUtils.ts` | MAIN | other | 2 | 86`b` 90`a1e` |
| `electron/capabilityCore/apimartGenerationProvider.ts` | MAIN | generation | 2 | 133`d` 442`a1e` |
| `electron/capabilityCore/canvasReadSurfacePort.ts` | MAIN | canvas | 2 | 146`c` 275`a1e` |
| `electron/capabilityCore/mcpProtocol.ts` | MAIN | agent | 3 | 593`e` 674`e` 691`e` |
| `electron/capabilityCore/projectAgentProposalReceiptStore.ts` | MAIN | money | 3 | 195`d` 203`d` 243`d` |
| `electron/catalog/comfyuiWorkflowImport.ts` | MAIN | generation | 2 | 613`a1e` 631`a1` |
| `electron/catalog/secrets.ts` | MAIN | other | 3 | 54`e` 102`d` 149`d` |
| `electron/connectors/tikhubRoute.ts` | MAIN | other | 2 | 95`a1e` 99`d` |
| `electron/export/mediaProbe.ts` | MAIN | asset | 3 | 173`d` 174`c` 405`d` |
| `electron/jsonFile.ts` | MAIN | asset | 3 | 60`a1` 76`e` 81`e` |
| `electron/localRuntime/localAiExternalProbe.ts` | MAIN | other | 3 | 82`d` 176`a1` 308`d` |
| `electron/networkOutboundPolicy.ts` | MAIN | other | 3 | 168`a1` 222`d` 339`d` |
| `electron/productionRun/canvasLandingHost.ts` | MAIN | generation | 3 | 52`c` 61`d` 91`c` |
| `electron/protocol/localProtocol.ts` | MAIN | project/asset | 3 | 32`d` 67`d` 161`d` |
| `electron/protocol/localRuntimeAssets.ts` | MAIN | generation/asset | 3 | 59`d` 67`d` 81`d` |
| `electron/providerAdapter/certificationMedia.ts` | MAIN | generation | 3 | 295`d` 457`b` 590`e` |
| `electron/proxySettings.ts` | MAIN | settings | 1 | 58`a1ef` |
| `electron/settings/attentionSoundSettings.ts` | MAIN | settings | 2 | 10`d` 26`a1e` |
| `electron/settings/localePreference.ts` | MAIN | project | 2 | 26`d` 40`a1e` |
| `electron/settings/projectLocationIpc.ts` | IPC | project | 2 | 58`a1f` 65`a1` |
| `electron/skills/skillStore.ts` | MAIN | project | 3 | 65`e` 79`e` 318`d` |
| `electron/tasks/assetUrlExtract.ts` | MAIN | asset | 1 | 18`a1ef` |
| `electron/vendor/vendorBaseFallback.ts` | MAIN | generation | 3 | 72`d` 99`a2` 157`d` |
| `electron/vendor/vendorHttp.ts` | MAIN | generation | 3 | 178`b` 216`b` 280`b` |
| `electron/vendor/vendorOutboundGuard.ts` | MAIN | money/generation | 3 | 45`d` 99`d` 114`d` |
| `electron/workspace/workspaceSync.ts` | MAIN | other | 3 | 27`d` 57`d` 86`d` |
| `src/media/useVideoPlaybackHeal.ts` | CORE | asset | 2 | 64`c` 88`a1e` |
| `src/ui/browser/browserUrl.ts` | CORE | other | 1 | 31`a1ef` |
| `src/ui/browser/dialog/browserUrl.ts` | CORE | other | 1 | 31`a1ef` |
| `src/ui/browser/popover/NomiBrowserAssetPopover.tsx` | UI | asset | 3 | 259`b` 268`c` 283`b` |
| `src/ui/community/feedbackOutbox.ts` | CORE | other | 2 | 43`d` 53`a1e` |
| `src/ui/community/FeedbackShareContent.tsx` | UI | other | 3 | 107`b` 154`a1` 168`a1` |
| `src/ui/onboarding/NetworkSection.tsx` | UI | other | 3 | 62`c` 100`b` 215`c` |
| `src/ui/onboarding/workflowPage/useWorkflowCatalog.ts` | CORE | other | 3 | 124`d` 194`b` 201`b` |
| `src/workbench/ai/v4/useAgentPanelV4Data.ts` | UI | generation/agent | 3 | 92`b` 143`d` 257`b` |
| `src/workbench/assets/assetLibraryDrag.ts` | UI | project | 2 | 58`a1e` 83`d` |
| `src/workbench/assets/useAssetFolders.ts` | UI | asset | 3 | 65`b` 78`b` 163`c` |
| `src/workbench/capability/useIntegrationConfirmationNotice.ts` | UI | money | 3 | 30`d` 54`c` 55`c` |
| `src/workbench/generationCanvas/agent/availableModels.ts` | UI | generation | 3 | 170`e` 192`d` 219`d` |
| `src/workbench/generationCanvas/components/viewportAnimationSettlement.ts` | UI | generation | 2 | 12`a1` 59`ef` |
| `src/workbench/generationCanvas/nodes/director/DirectorNode.tsx` | UI | generation | 3 | 139`b` 200`c` 229`c` |
| `src/workbench/generationCanvas/nodes/director/useAiSceneBuilder.ts` | UI | generation | 3 | 81`e` 82`b` 116`b` |
| `src/workbench/generationCanvas/nodes/NodePromptOptimizer.tsx` | UI | generation | 3 | 156`c` 182`c` 186`c` |
| `src/workbench/generationCanvas/nodes/NodeResultStack.tsx` | UI | generation | 3 | 50`d` 91`b` 350`c` |
| `src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts` | UI | generation | 3 | 84`c` 87`a1` 100`c` |
| `src/workbench/generationCanvas/runner/localTaskControl.ts` | UI | generation | 3 | 76`b` 95`d` 101`b` |
| `src/workbench/library/ProjectLibraryPage.tsx` | UI | project | 3 | 186`d` 199`c` 657`c` |
| `src/workbench/onboarding/journeyTourStore.ts` | UI | project | 2 | 133`a1e` 153`c` |
| `src/workbench/preview/TimelinePreview.tsx` | UI | canvas | 3 | 180`a1` 275`b` 343`a1` |
| `src/workbench/production/ProductionCanvasLandingHost.tsx` | UI | generation | 3 | 92`d` 136`c` 147`a1` |
| `src/workbench/project/useProjectNotificationTarget.ts` | UI | project | 3 | 50`d` 59`c` 64`c` |
| `src/workbench/settings/ProjectLocationSection.tsx` | UI | project | 3 | 113`c` 122`c` 132`c` |
| `src/workbench/settings/ScreenshotHotkeySection.tsx` | UI | canvas | 3 | 30`b` 38`b` 106`b` |
| `src/workbench/timeline/agent/timelineCapabilityTarget.ts` | UI | canvas | 2 | 57`d` 305`a1e` |
| `electron/agentLane/laneDesktopTasks.ts` | MAIN | agent/project | 2 | 27`a1` 48`d` |
| `electron/agentLane/laneIpc.ts` | IPC | agent | 2 | 47`b` 85`c` |
| `electron/agentLane/laneLegacyFiles.ts` | MAIN | project | 1 | 136`a1e` |
| `electron/agentLane/laneTraceRecorder.mts` | MAIN | agent | 2 | 28`b` 80`b` |
| `electron/ai/aiSdkVendorError.ts` | MAIN | generation | 1 | 55`a1e` |
| `electron/ai/antigravityProcess.ts` | MAIN | other | 2 | 87`a1` 300`c` |
| `electron/ai/onboarding/modelListProbe.ts` | MAIN | generation | 2 | 44`e` 258`b` |
| `electron/ai/vendorModelConnection.ts` | MAIN | generation | 1 | 13`a1e` |
| `electron/assets/assetEvents.ts` | MAIN | asset | 2 | 14`b` 25`b` |
| `electron/browser/captureNaming.ts` | MAIN | asset | 1 | 26`a1f` |
| `electron/browser/media/browserPromptScreenshotSelection.ts` | MAIN | canvas | 1 | 21`a1e` |
| `electron/browser/overlay/browserViewOverlay.ts` | MAIN | asset | 2 | 140`d` 387`c` |
| `electron/capabilityCore/apimartGenerationProjection.ts` | MAIN | generation | 2 | 80`d` 90`d` |
| `electron/capabilityCore/gateway.ts` | MAIN | money | 2 | 154`d` 163`d` |
| `electron/capabilityCore/generationOutputMaterializer.ts` | MAIN | generation | 1 | 46`a1e` |
| `electron/capabilityCore/mcpDocumentWriteReceipt.ts` | MAIN | money | 1 | 63`a1e` |
| `electron/capabilityCore/mcpProfiles.ts` | MAIN | agent | 2 | 42`b` 54`a1` |
| `electron/capabilityCore/mcpVerify.ts` | MAIN | agent | 1 | 115`a1e` |
| `electron/capabilityCore/rpcServer.ts` | MAIN | agent | 2 | 143`c` 409`b` |
| `electron/capabilityCore/shotVerifyOrchestrate.ts` | MAIN | canvas | 2 | 147`d` 156`d` |
| `electron/catalog/assetLocalization.ts` | MAIN | asset | 2 | 82`d` 658`d` |
| `electron/catalog/customCallSandbox.ts` | MAIN | other | 1 | 326`a1e` |
| `electron/catalog/dreaminaCli.ts` | MAIN | other | 1 | 125`a1e` |
| `electron/catalog/imageEditProbe.ts` | MAIN | asset | 2 | 71`b` 73`d` |
| `electron/catalog/nativeEndpointProbe.ts` | MAIN | other | 2 | 55`b` 57`d` |
| `electron/catalog/relayNativeWireUpgrade.ts` | MAIN | generation | 2 | 64`b` 115`b` |
| `electron/export/ensureExecutable.ts` | MAIN | other | 1 | 25`a1f` |
| `electron/integrationCertification/httpConnector.ts` | MAIN | generation | 1 | 161`a1e` |
| `electron/integrationCertification/integrationSessionIpc.ts` | IPC | money | 1 | 72`a1e` |
| `electron/integrationCertification/operationLedger.ts` | MAIN | other | 2 | 400`a1` 792`a1` |
| `electron/integrationCertification/promotionJournal.ts` | MAIN | other | 2 | 161`a1` 437`a1` |
| `electron/integrationCertification/providerAdapterCoordinator.ts` | MAIN | generation | 2 | 388`d` 658`a1` |
| `electron/preload.ts` | IPC | settings/other | 2 | 40`d` 764`c` |
| `electron/productionRun/artifactPreviewHttpServer.ts` | MAIN | generation | 2 | 81`e` 104`c` |
| `electron/productionRun/multiShotBatchScheduler.ts` | MAIN | generation | 2 | 142`a2` 182`a2` |
| `electron/productionRun/multiShotCanvasLanding.ts` | MAIN | generation | 2 | 161`a1` 225`d` |
| `electron/productionRun/productionGenerationOperationStore.ts` | MAIN | generation | 1 | 61`a1f` |
| `electron/productionRun/productionRunArtifactOperations.ts` | MAIN | generation | 1 | 105`a1f` |
| `electron/productionRun/productionRunDesktopLifecycle.ts` | MAIN | generation | 2 | 53`a2` 71`a1` |
| `electron/productionRun/productionRunEventTap.ts` | MAIN | generation | 1 | 17`a1e` |
| `electron/productionRun/productionRunRepository.ts` | MAIN | generation | 2 | 147`d` 534`a1` |
| `electron/providerAdapter/docsDiscovery.ts` | MAIN | generation | 2 | 122`a1` 214`b` |
| `electron/review/reviewTrace.ts` | MAIN | generation | 2 | 18`c` 40`a2` |
| `electron/settings/assetRelaySettings.ts` | MAIN | asset | 2 | 37`d` 46`d` |
| `electron/settings/attentionSoundIpc.ts` | IPC | settings | 2 | 53`b` 57`e` |
| `electron/shared/customCapabilityContract.ts` | MAIN | agent | 2 | 391`d` 401`d` |
| `electron/skills/skillLibraryBroadcast.ts` | MAIN | project | 2 | 33`d` 48`a1` |
| `electron/workspace/workspaceFileIndex.ts` | MAIN | asset | 2 | 94`d` 122`d` |
| `electron/workspace/workspaceRepository.ts` | MAIN | project | 2 | 59`d` 218`d` |
| `src/i18n/index.ts` | CORE | settings | 2 | 49`d` 69`c` |
| `src/lib/removeBackground.ts` | CORE | asset/other | 2 | 113`d` 124`d` |
| `src/media/videoPlaybackDiagnostics.ts` | CORE | asset | 2 | 13`b` 25`a1` |
| `src/ui/browser/popover/browserAssetPopoverUtils.ts` | CORE | asset | 2 | 271`d` 302`a1` |
| `src/ui/browser/popover/useBrowserAssetActions.ts` | CORE | asset | 2 | 118`c` 182`c` |
| `src/ui/onboarding/AiAssistedOnboardingSection.tsx` | UI | other | 2 | 70`d` 98`b` |
| `src/ui/onboarding/antigravityConnection.ts` | CORE | other | 2 | 85`d` 94`b` |
| `src/ui/onboarding/ConnectAssistantCard.tsx` | UI | other | 2 | 173`c` 180`c` |
| `src/ui/onboarding/DreaminaMemberCard.tsx` | UI | other | 2 | 74`c` 94`c` |
| `src/ui/onboarding/ExistingConnectionModelPicker.tsx` | UI | generation | 1 | 50`a1e` |
| `src/ui/onboarding/modelDiscovery.ts` | CORE | generation | 2 | 58`e` 72`a1` |
| `src/ui/onboarding/useAntigravitySettings.ts` | CORE | settings | 2 | 25`c` 29`c` |
| `src/ui/onboarding/useCustomCallTestRun.ts` | CORE | other | 2 | 46`c` 52`c` |
| `src/ui/onboarding/useOnboardingDrawerCatalog.ts` | CORE | other | 1 | 84`de` |
| `src/workbench/adoption/adoptionApply.ts` | UI | other | 2 | 134`d` 151`d` |
| `src/workbench/ai/NoTextModelRecoveryCard.tsx` | UI | generation | 2 | 36`d` 48`c` |
| `src/workbench/ai/resident/useShotVerifyFeedback.tsx` | UI | canvas | 2 | 24`d` 40`c` |
| `src/workbench/assets/assetLibraryLocalImport.ts` | UI | project | 2 | 25`e` 117`c` |
| `src/workbench/assets/AssetLibraryPanel.tsx` | UI | project | 2 | 332`c` 422`c` |
| `src/workbench/assets/FindReferencePanel.tsx` | UI | asset | 2 | 198`c` 232`c` |
| `src/workbench/assets/pasteShareLinkImport.ts` | UI | asset | 1 | 64`a1e` |
| `src/workbench/creation/useSystemPromptOverrides.ts` | UI | canvas/other | 2 | 17`c` 31`c` |
| `src/workbench/explorer/workspaceFileDrag.ts` | UI | asset | 1 | 31`a1e` |
| `src/workbench/generationCanvas/adapters/persistNodeImage.ts` | UI | generation | 2 | 24`d` 79`d` |
| `src/workbench/generationCanvas/components/canvasStageDrop.ts` | UI | generation | 2 | 171`d` 403`b` |
| `src/workbench/generationCanvas/components/MemoryFold.tsx` | UI | generation | 2 | 32`c` 57`b` |
| `src/workbench/generationCanvas/components/useCanvasFrameActions.ts` | UI | generation | 2 | 109`c` 114`c` |
| `src/workbench/generationCanvas/nodes/director/agent/CameraMoveCaptureHost.tsx` | UI | generation | 2 | 150`c` 155`f` |
| `src/workbench/generationCanvas/nodes/director/panels/ai/AiSceneBar.tsx` | UI | generation | 2 | 50`b` 58`c` |
| `src/workbench/generationCanvas/nodes/director/panels/dialogs/MobileConnectDialog.tsx` | UI | generation | 2 | 81`c` 170`c` |
| `src/workbench/generationCanvas/nodes/director/panels/usePanoramaImport.tsx` | UI | generation | 2 | 51`c` 57`d` |
| `src/workbench/generationCanvas/nodes/NodeErrorReport.tsx` | UI | generation | 2 | 145`d` 177`a1` |
| `src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx` | UI | generation | 2 | 287`b` 449`b` |
| `src/workbench/generationCanvas/nodes/ProductionShotPlaceholder.tsx` | UI | generation | 2 | 42`c` 47`c` |
| `src/workbench/generationCanvas/nodes/ProvenancePanel.tsx` | UI | generation | 2 | 35`c` 36`a1` |
| `src/workbench/generationCanvas/nodes/shotTable/factBridge.ts` | IPC | generation | 2 | 81`c` 91`e` |
| `src/workbench/generationCanvas/nodes/useNodePanoramaHandlers.ts` | UI | generation | 2 | 34`c` 57`b` |
| `src/workbench/generationCanvas/nodes/useNodeVideoHoverPreview.ts` | UI | generation | 1 | 54`a1e` |
| `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardDrawingTool.tsx` | UI | generation | 2 | 420`c` 714`c` |
| `src/workbench/generationCanvas/reactFlow/useGenerationCanvasReactFlowPointer.ts` | UI | generation | 2 | 99`a1` 174`a1` |
| `src/workbench/generationCanvas/spend/anchorCheckpointView.ts` | UI | money | 2 | 135`d` 158`d` |
| `src/workbench/generationCanvas/videoDepth/videoDepthClient.ts` | UI | generation | 2 | 128`a1` 185`a1` |
| `src/workbench/library/workflowLibrary.ts` | UI | project | 2 | 74`d` 85`a1` |
| `src/workbench/preview/usePreviewBgmPlayback.ts` | UI | other | 2 | 51`b` 57`a1` |
| `src/workbench/production/useActiveProductionRun.ts` | UI | generation | 2 | 22`c` 23`c` |
| `src/workbench/project/projectMediaMigration.ts` | UI | project | 2 | 76`d` 90`d` |
| `src/workbench/project/projectRepository.ts` | UI | project | 1 | 110`a1e` |
| `src/workbench/settings/AttentionSoundSection.tsx` | UI | settings | 2 | 31`b` 41`b` |
| `src/workbench/settings/SettingsDialog.tsx` | UI | settings | 2 | 159`b` 239`b` |
| `src/workbench/settings/TikhubConnectorCard.tsx` | UI | settings | 2 | 37`b` 153`b` |
| `src/workbench/skillLibrary/useWorkbenchSkills.ts` | UI | project | 1 | 32`de` |
| `src/workbench/taskCenter/TaskCenterPanel.tsx` | UI | generation/other | 2 | 163`c` 203`c` |
| `electron/agentLane/laneCodingSandbox.mts` | MAIN | agent | 1 | 127`b` |
| `electron/agentLane/laneCodingTools.mts` | MAIN | agent | 1 | 263`b` |
| `electron/agentLane/laneDesktopRuntime.ts` | MAIN | project | 1 | 38`d` |
| `electron/agentLane/laneHistory.mts` | MAIN | agent | 1 | 20`b` |
| `electron/agentLane/laneProviderGuard.mts` | MAIN | generation | 1 | 144`c` |
| `electron/agentLane/laneWorkspace.mts` | MAIN | agent | 1 | 96`b` |
| `electron/ai/antigravityConnection.ts` | MAIN | project | 1 | 121`a1` |
| `electron/ai/antigravityEvidenceStore.ts` | MAIN | project | 1 | 19`d` |
| `electron/ai/antigravityIpc.ts` | IPC | other | 1 | 22`b` |
| `electron/appWindowRegistry.ts` | MAIN | other | 1 | 54`d` |
| `electron/assets/assetsIpc.ts` | IPC | asset | 1 | 19`a1` |
| `electron/assets/autoSaveAsset.ts` | MAIN | project | 1 | 36`d` |
| `electron/assets/clipboardFilePaths.ts` | MAIN | asset | 1 | 26`d` |
| `electron/assets/downloadPrefs.ts` | MAIN | asset | 1 | 26`a1` |
| `electron/assets/localizedAsset.ts` | MAIN | asset | 1 | 36`d` |
| `electron/assets/videoImportNormalize.ts` | MAIN | asset | 1 | 92`e` |
| `electron/audioTaskRunner.ts` | MAIN | asset | 1 | 226`d` |
| `electron/browser/chrome/browserViewChromeMenu.ts` | MAIN | other | 1 | 219`c` |
| `electron/browser/core/browserViewSession.ts` | MAIN | agent | 1 | 37`b` |
| `electron/browser/media/browserMediaValidation.ts` | MAIN | asset | 1 | 146`b` |
| `electron/capabilityCore/appIntegrationAuthorities.ts` | MAIN | money | 1 | 53`a2` |
| `electron/capabilityCore/canvasReadSurfaceIpc.ts` | IPC | canvas | 1 | 59`d` |
| `electron/capabilityCore/dispatcher.ts` | MAIN | generation | 1 | 744`e` |
| `electron/capabilityCore/generationProviderBootstrap.ts` | MAIN | generation | 1 | 76`d` |
| `electron/capabilityCore/hostConfigRepairNotice.ts` | MAIN | agent | 1 | 19`a1` |
| `electron/capabilityCore/mcpAppWidget.ts` | MAIN | agent | 1 | 36`d` |
| `electron/capabilityCore/mcpPreviewImage.ts` | MAIN | agent | 1 | 111`d` |
| `electron/capabilityCore/mcpResultEnrichLive.ts` | MAIN | agent | 1 | 18`d` |
| `electron/capabilityCore/projectAgentDocumentReceipt.ts` | MAIN | money | 1 | 81`a1` |
| `electron/capabilityCore/rendererBridge.ts` | IPC | generation | 1 | 58`d` |
| `electron/capabilityCore/shotVerifyCore.ts` | MAIN | canvas | 1 | 215`a1` |
| `electron/capabilityCore/skillReadTransportAdapters.ts` | MAIN | agent | 1 | 38`d` |
| `electron/catalog/assetValueScheme.ts` | MAIN | asset | 1 | 116`d` |
| `electron/catalog/builtinVendorSeeds.ts` | MAIN | generation | 1 | 200`d` |
| `electron/catalog/catalogCommit.ts` | MAIN | generation | 1 | 404`d` |
| `electron/catalog/comfyuiCandidateLifecycle.ts` | MAIN | other | 1 | 190`a1` |
| `electron/comfyui/capabilityStore.ts` | MAIN | project | 1 | 33`b` |
| `electron/comfyuiObjectInfo.ts` | MAIN | other | 1 | 63`d` |
| `electron/comfyuiTemplates.ts` | MAIN | other | 1 | 89`d` |
| `electron/desktopNotification.ts` | MAIN | other | 1 | 17`b` |
| `electron/director/mobileBridgeIpc.ts` | IPC | other | 1 | 60`c` |
| `electron/experience/experienceExtractor.ts` | MAIN | other | 1 | 107`d` |
| `electron/experience/experienceRepository.ts` | MAIN | project | 1 | 49`a1` |
| `electron/export/exportJobManager.ts` | MAIN | generation | 1 | 184`e` |
| `electron/export/exportJobStore.ts` | MAIN | generation | 1 | 40`e` |
| `electron/export/ffmpegRunner.ts` | MAIN | other | 1 | 192`d` |
| `electron/files/extractText.ts` | MAIN | asset | 1 | 50`d` |
| `electron/harness/skillIndex.ts` | MAIN | agent | 1 | 28`d` |
| `electron/i18n.ts` | MAIN | settings | 1 | 396`a1` |
| `electron/image/decomposeLayers.ts` | MAIN | asset | 1 | 105`f` |
| `electron/integrationCertification/certificationPersistence.ts` | MAIN | project | 1 | 35`a1` |
| `electron/integrationCertification/comfyuiConnector.ts` | MAIN | generation | 1 | 170`a1` |
| `electron/integrationCertification/credentialElicitationServer.ts` | MAIN | other | 1 | 24`b` |
| `electron/integrationCertification/integrationAdapterContract.ts` | MAIN | other | 1 | 32`d` |
| `electron/jsonUtils.ts` | MAIN | other | 1 | 47`d` |
| `electron/localRuntime/localTextEndpoints.ts` | MAIN | other | 1 | 114`d` |
| `electron/mainWindowPresence.ts` | MAIN | other | 1 | 23`b` |
| `electron/networkErrorDetails.ts` | MAIN | other | 1 | 30`a1` |
| `electron/onboarding/demoAssetSeed.ts` | MAIN | asset | 1 | 103`a2` |
| `electron/productionRun/batchSchedulerKick.ts` | MAIN | generation | 1 | 32`a2` |
| `electron/productionRun/productionActionIpc.ts` | IPC | money | 1 | 62`d` |
| `electron/productionRun/productionNotificationsDesktop.ts` | MAIN | generation | 1 | 30`a1` |
| `electron/productionRun/productionRunIntentLog.ts` | MAIN | generation | 1 | 163`e` |
| `electron/productionRun/productionRunProjections.ts` | MAIN | generation | 1 | 141`a1` |
| `electron/productionRun/productionRunReducer.ts` | MAIN | generation | 1 | 142`d` |
| `electron/promptLibrary/promptLibraryStore.ts` | MAIN | project | 1 | 53`a1` |
| `electron/protocol/fileResponseStream.ts` | MAIN | asset | 1 | 44`a1` |
| `electron/providerAdapter/builtinOpenAiCompatibleDraft.ts` | MAIN | generation | 1 | 149`d` |
| `electron/providerAdapter/ipc.ts` | IPC | generation | 1 | 103`c` |
| `electron/providerAdapter/providedDocs.ts` | MAIN | generation | 1 | 98`b` |
| `electron/providerAdapter/service.ts` | MAIN | generation | 1 | 269`c` |
| `electron/providerAdapter/store.ts` | MAIN | generation | 1 | 316`a1` |
| `electron/providerAdapter/verifier.ts` | MAIN | generation | 1 | 170`d` |
| `electron/review/technicalCheck.ts` | MAIN | other | 1 | 88`e` |
| `electron/runtimePaths.ts` | MAIN | other | 1 | 84`d` |
| `electron/shared/projectAgentProposalReceipt.ts` | MAIN | money | 1 | 256`d` |
| `electron/skills/skillPreview.ts` | MAIN | agent | 1 | 26`d` |
| `electron/socksDispatcher.ts` | MAIN | generation | 1 | 28`d` |
| `electron/spendGrant.ts` | MAIN | money | 1 | 133`b` |
| `electron/tasks/requestTransforms.ts` | MAIN | other | 1 | 39`b` |
| `electron/tasks/taskResultCertification.ts` | MAIN | other | 1 | 12`d` |
| `electron/tasks/taskResultQuery.ts` | MAIN | other | 1 | 129`d` |
| `electron/testSupport/canCreateSymlink.ts` | MAIN | other | 1 | 18`d` |
| `electron/video/depthVideoPipeline.ts` | MAIN | asset | 1 | 107`d` |
| `electron/video/detectShotCuts.ts` | MAIN | canvas | 1 | 159`a1` |
| `electron/video/extractAudioTrack.ts` | MAIN | asset | 1 | 129`a1` |
| `electron/video/framesToVideo.ts` | MAIN | asset | 1 | 102`a1` |
| `electron/workspace/workspaceManifest.ts` | MAIN | other | 1 | 474`d` |
| `src/devlab/designLab/nodeComposerBar/nodeComposerBarLabKit.tsx` | UI | canvas | 1 | 167`c` |
| `src/media/nomiLocalAssetUrl.ts` | CORE | asset | 1 | 43`d` |
| `src/media/videoPlaybackTelemetry.ts` | CORE | asset | 1 | 43`b` |
| `src/media/videoPlaybackUrl.ts` | CORE | asset | 1 | 5`d` |
| `src/ui/browser/popover/useBrowserAssetLibraryModel.ts` | CORE | generation | 1 | 82`c` |
| `src/ui/browser/prompt/browserPromptExtraction.ts` | CORE | other | 1 | 169`d` |
| `src/ui/browser/window/useResizableFloatingWindow.ts` | CORE | other | 1 | 81`a1` |
| `src/ui/onboarding/AiAssistedOnboardingCard.tsx` | UI | other | 1 | 81`c` |
| `src/ui/onboarding/ComfyuiPresetSection.tsx` | UI | other | 1 | 46`d` |
| `src/ui/onboarding/LocalModelCard.tsx` | UI | generation | 1 | 78`d` |
| `src/ui/onboarding/ModelPickerScreen.tsx` | UI | generation | 1 | 180`a1` |
| `src/ui/onboarding/workflowPage/runTestGeneration.ts` | CORE | generation | 1 | 88`b` |
| `src/ui/toast.tsx` | UI | other | 1 | 122`a1` |
| `src/workbench/ai/assistantModelIdentity.ts` | UI | generation | 1 | 83`d` |
| `src/workbench/ai/lane/laneReceiptUndo.ts` | UI | money | 1 | 14`d` |
| `src/workbench/ai/resident/residentToolDisplay.ts` | UI | agent | 1 | 490`d` |
| `src/workbench/ai/resident/residentToolText.ts` | UI | agent | 1 | 44`d` |
| `src/workbench/api/taskApi.ts` | UI | other | 1 | 125`c` |
| `src/workbench/assets/assetSurfaceMigration.ts` | UI | project | 1 | 100`d` |
| `src/workbench/assets/deleteAssetResult.ts` | UI | project | 1 | 21`b` |
| `src/workbench/assets/useAllProjectAssets.ts` | UI | project | 1 | 143`e` |
| `src/workbench/capability/multiShotCanvasLanding.ts` | UI | canvas | 1 | 302`b` |
| `src/workbench/common/useVendorPreference.ts` | UI | generation | 1 | 14`c` |
| `src/workbench/creation/storyboard/shotRow/ShotReferenceZone.tsx` | UI | canvas | 1 | 306`c` |
| `src/workbench/creation/storyboard/StoryboardShotTable.tsx` | UI | canvas | 1 | 408`c` |
| `src/workbench/creation/storyboard/strategyGate.ts` | UI | canvas | 1 | 50`d` |
| `src/workbench/creation/storyboard/useStoryboardStrategy.ts` | UI | canvas | 1 | 51`c` |
| `src/workbench/explorer/ProjectExplorerSidebar.tsx` | UI | project | 1 | 215`a1` |
| `src/workbench/export/exportApi.ts` | UI | canvas | 1 | 141`a2` |
| `src/workbench/generationCanvas/adapters/assetImportAdapter.ts` | UI | generation | 1 | 214`e` |
| `src/workbench/generationCanvas/adapters/useNodeImageUpload.ts` | UI | generation | 1 | 32`c` |
| `src/workbench/generationCanvas/agent/projectMemoryClient.ts` | UI | generation | 1 | 28`d` |
| `src/workbench/generationCanvas/agent/runDirectionPlanner.ts` | UI | generation | 1 | 110`a1` |
| `src/workbench/generationCanvas/agent/shotVerify.ts` | UI | generation | 1 | 176`a1` |
| `src/workbench/generationCanvas/agent/shotVerifyStore.ts` | UI | generation | 1 | 190`d` |
| `src/workbench/generationCanvas/components/batchPlanPreview.ts` | UI | generation | 1 | 226`c` |
| `src/workbench/generationCanvas/components/CanvasMinimap.tsx` | UI | generation | 1 | 114`a1` |
| `src/workbench/generationCanvas/components/CanvasToolbar.tsx` | UI | generation | 1 | 283`b` |
| `src/workbench/generationCanvas/components/screenshotCropGeometry.ts` | UI | generation | 1 | 56`b` |
| `src/workbench/generationCanvas/components/useCanvasProductionActions.ts` | UI | generation | 1 | 50`c` |
| `src/workbench/generationCanvas/components/useCanvasScreenshotCapture.tsx` | UI | generation | 1 | 35`b` |
| `src/workbench/generationCanvas/components/useCanvasViewportGestures.ts` | UI | generation | 1 | 313`a1` |
| `src/workbench/generationCanvas/components/useMarqueeSelection.ts` | UI | generation | 1 | 71`a1` |
| `src/workbench/generationCanvas/events/canvasEventEmitter.ts` | UI | generation | 1 | 76`b` |
| `src/workbench/generationCanvas/events/canvasWriteBoundary.ts` | UI | generation | 1 | 68`c` |
| `src/workbench/generationCanvas/nodes/buildContactSheetNode.ts` | UI | generation | 1 | 64`e` |
| `src/workbench/generationCanvas/nodes/controls/useChannelCreateBody.ts` | IPC | generation | 1 | 52`d` |
| `src/workbench/generationCanvas/nodes/decompose/useDecomposeLayers.ts` | UI | generation | 1 | 22`b` |
| `src/workbench/generationCanvas/nodes/DeferredNodeMedia.tsx` | UI | generation | 1 | 142`a1` |
| `src/workbench/generationCanvas/nodes/director/agent/DirectorHeadlessCapture.tsx` | UI | generation | 1 | 118`c` |
| `src/workbench/generationCanvas/nodes/director/model/aiScene.ts` | UI | generation | 1 | 166`d` |
| `src/workbench/generationCanvas/nodes/director/panels/dialogs/ActionPreview.tsx` | UI | generation | 1 | 46`c` |
| `src/workbench/generationCanvas/nodes/director/scene/character/poseClipLibrary.ts` | UI | generation | 1 | 110`c` |
| `src/workbench/generationCanvas/nodes/director/scene/character/useCharacterRig.ts` | UI | generation | 1 | 158`c` |
| `src/workbench/generationCanvas/nodes/director/useMobilePreview.ts` | UI | generation | 1 | 24`b` |
| `src/workbench/generationCanvas/nodes/NodeImageEditToolbar.tsx` | UI | generation | 1 | 86`c` |
| `src/workbench/generationCanvas/nodes/NodeParameterControls.tsx` | UI | generation | 1 | 748`c` |
| `src/workbench/generationCanvas/nodes/shotTable/ShotTableNode.tsx` | UI | generation | 1 | 92`c` |
| `src/workbench/generationCanvas/nodes/useNodeDragResize.ts` | UI | generation | 1 | 341`c` |
| `src/workbench/generationCanvas/nodes/useProductionNodeRetry.ts` | UI | generation | 1 | 15`c` |
| `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardModal.tsx` | UI | generation | 1 | 212`c` |
| `src/workbench/generationCanvas/plugins/canvasWorkflowTemplates.ts` | UI | generation | 1 | 84`d` |
| `src/workbench/generationCanvas/reactFlow/canvasDragWriteback.ts` | UI | generation | 1 | 56`c` |
| `src/workbench/generationCanvas/resultUrlRelocalizeBridge.ts` | IPC | generation | 1 | 45`a1` |
| `src/workbench/generationCanvas/runner/modelHealthMemory.ts` | UI | generation | 1 | 63`d` |
| `src/workbench/generationCanvas/runner/recoverTaskActions.ts` | UI | generation | 1 | 118`b` |
| `src/workbench/generationCanvas/runner/vendorErrorIpc.ts` | IPC | generation | 1 | 28`d` |
| `src/workbench/generationCanvas/store/canvasMenuPreferenceStore.ts` | UI | generation | 1 | 26`b` |
| `src/workbench/generationCanvas/videoDepth/startVideoDepthDerivation.ts` | UI | generation | 1 | 155`c` |
| `src/workbench/generationCanvas/videoDepth/videoDepthPreviewFrame.ts` | UI | generation | 1 | 77`d` |
| `src/workbench/library/localProjectStore.ts` | UI | project | 1 | 114`b` |
| `src/workbench/observability/classifyError.ts` | UI | other | 1 | 78`d` |
| `src/workbench/observability/opaqueFailure.ts` | UI | other | 1 | 32`d` |
| `src/workbench/onboarding/demoProject.ts` | UI | canvas | 1 | 154`d` |
| `src/workbench/project/projectHydrationRecovery.ts` | UI | project | 1 | 32`b` |
| `src/workbench/project/useProjectWindowLifecycle.ts` | UI | project | 1 | 15`c` |
| `src/workbench/promptLibrary/PromptPreviewOverlay.tsx` | UI | project | 1 | 92`b` |
| `src/workbench/settings/SystemPromptSection.tsx` | UI | settings | 1 | 118`c` |
| `src/workbench/skillLibrary/parseSkillImport.ts` | UI | project | 1 | 80`d` |
| `src/workbench/taskCenter/taskCenterSettings.ts` | UI | generation | 1 | 11`b` |
| `src/workbench/timeline/addAssetToTimeline.ts` | UI | canvas | 1 | 94`d` |
| `src/workbench/timeline/agent/mediaToolCall.ts` | UI | canvas | 1 | 310`b` |
| `src/workbench/timeline/agent/phase4CapabilityTargets.ts` | UI | canvas | 1 | 117`b` |
| `src/workbench/timeline/timelineDragPayload.ts` | UI | canvas | 1 | 21`d` |
| `src/workbench/timeline/TimelinePanel.tsx` | UI | canvas | 1 | 342`c` |
| `src/workbench/timeline/TimelineResizeHandle.tsx` | UI | canvas | 1 | 37`a1` |
| `src/workbench/useWorkspaceEvents.ts` | UI | other | 1 | 28`a1` |
| `src/workbench/windowUrlParam.ts` | UI | other | 1 | 17`d` |
