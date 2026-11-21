# 外部助手的生成装配：4 份收成 1 份（设计卡）

```
改动名：生成装配只有一个入口      线/负责人：retro-root-causes      类别：[花钱]（碰生成门和授权的接线；不改花钱语义）
```

基线：`origin/main` = 24b1ad04d（2026-11-21）。本卡只读代码、没改生产代码、没起窗口。行号都是这一版的。

**一句话**：两个宿主和两份测试辅助各手写一遍「生成这一套」的接线，#1584 只把其中一格（模型表）换成了活的；这一刀把接线收成一个工厂，宿主只交「我和别的宿主真不一样的那几样」，模型表、就绪、价格、候选、默认模型全由工厂在每次调用入口取同一版，宿主手里拿不到可以另存一份的原料。

**用户要权衡的只有一处**：见 ★3「交卡挂内置连接」那一行——保留这条路（推荐）还是整条删掉。其余都是代码结构，照做后报。

---

## 全家清单（工具出的，命令在后面）

### 手写装配 4 处

`node scripts/door-map.mjs createGenerationPlanningHandler`：写入口 4 扇、读入口 1 扇。

| # | 在哪 | 是谁 | 和活目录、钉一版的关系 |
|---|---|---|---|
| 1 | `electron/capabilityCore/appIntegration.ts:337`（接线 :336–:470，约 135 行） | 应用内宿主 | :200 自己 `createLiveGenerationRuntime`，:338 递 `registry`；就绪走 `readBootstrap`（钉得住）；**价格 :213–:214、候选 :350、默认模型 :352 各自直接读盘上的目录，钉不住** |
| 2 | `electron/capabilityCore/mcpStdioServer.ts:287`（接线 :286–:434，约 150 行） | 独立进程宿主 | :272 自己 `createLiveGenerationRuntime`，:288 递 `registry`；价格 :283–:284、候选 :290、默认模型 :291 同样直接读盘 |
| 3 | `electron/capabilityCore/externalAgentGateTestUtils.ts:108` | 测试辅助（#1584 加的） | :107 自己起运行时，手抄 4 项接线 |
| 4 | `electron/capabilityCore/agentPanelSpendConfirmTestUtils.ts:327`（:123 另有一处类型引用） | 测试辅助（花钱确认） | 递的是静态表或 `options.registry`，没有钉一版；另手抄授权、落画布、交接 |

另有 65 处测试直接拿模型表调 `createGenerationPlanningHandler`（`mcpGenerationTools.test.ts` 40 处最多；数法见下面第二条命令，去掉上面 4 处、定义本身、和 `generationHostsWireAssetIdentity.test.ts` 里两行不是调用的字符串）。它们测的是规划逻辑本身，不是宿主接线，不算手写装配，但决定了「钉一版改必填」要怎么改（见 ★2）。

### 调用方表

调用方：下面每个要改或删的函数，全部生产调用处（`node scripts/door-map.mjs <符号>`，不含 `.test.`）。

| 函数 | 生产调用处 | 这一刀之后 |
|---|---|---|
| `createGenerationPlanningHandler` | appIntegration:337、mcpStdioServer:287、两份测试辅助 | 生产只剩工厂 1 处；测试辅助改调工厂 |
| `createLiveGenerationRuntime` | appIntegration:200、mcpStdioServer:272、externalAgentGateTestUtils:107、:132 | 只剩工厂 1 处 |
| `createGenerationProviderBootstrap` | appIntegration:201、mcpStdioServer:273、liveGenerationRuntime:59 | 只剩 liveGenerationRuntime（假供应商地址覆盖做成工厂的一个参数） |
| `createCatalogModelPricingResolver` / `createCatalogShotPriceResolver` | appIntegration:213–:214、mcpStdioServer:283–:284、catalogPricingResolver:52 | 宿主两处删；工厂从这次调用钉住的目录算 |
| `deriveUsableVideoModelCandidates` | appIntegration:350、mcpStdioServer:290 | 宿主两处删；同上 |
| `readGenerationDefaultModelResolver` | appIntegration:352、mcpStdioServer:291、agentLane/laneDesktopModelDefaults:13 | 宿主两处删；agentLane 那处不在这一刀 |
| `createProductionGenerationOperationStore` | appIntegration:188、mcpStdioServer:285、agentPanelSpendConfirmTestUtils:307 | 进工厂 |
| `createGenerationReferenceScopeGuard` | appIntegration:372、mcpStdioServer:312、agentPanelSpendConfirmTestUtils:337 | 进工厂（授权主体两边逐字相同） |
| `prepareProductionGenerationAuthorizationWithReferences` | appIntegration:384、mcpStdioServer:324、agentPanelSpendConfirmTestUtils:350 | 进工厂 |
| `createProductionGenerationSubmission` | appIntegration:245、appIntegrationRunObservation:36/:48/:155、mcpStdioServer:349、:411 | 开拍和对账用的进工厂；RunObservation 那三处不在这一刀 |
| `createMultiShotBatchScheduler` | appIntegration:294、:436、mcpStdioServer:380 | 开拍用的进工厂；:294（重踢）留在应用内宿主 |
| `startSingleShotProduction` | appIntegration:452、mcpStdioServer:398 | 进工厂 |
| `createRunOwnedGenerationGateAuthority` | appIntegration:489、mcpStdioServer:442 | 进工厂（收的规划只认工厂发的那一个） |
| **收「规划」的四个位置**（保证落在这里，见 ★2） | ① 门的权威 `createRunOwnedGenerationGateAuthority`：生产 2 处（上一行），测试 10 处分在 5 个文件；② 派发上下文的 `generationPlanning`（本机 RPC 服务 `rpcServer.ts:390`、独立进程直连）：生产 2 处（appIntegration:655、mcpStdioServer:453），**测试往里递桩 14 行、分在 7 个文件**（`nomiMcpGenerationPlanning` 4、`mcpGenerationDispatcher` 2、`mcpSemanticGenerationConfirmation` 2、`mcpGateEnvelopeTamper` 2、`mcpCanvasWriteHeadlessFallback` 2、`approvalPolicyAcrossEntrances` 1、`projectSessionDispatch` 1）；③ `installGuiResolveNarrowIpc`：只有 appIntegration:488；④ `installResidentGenerationAdapter`：只有 appIntegration:500 | 四处都只认工厂发的；测试的桩经测试专用的发放口（见 ★2） |
| 两个宿主的可注入口 `authorities.generationPlanning ??` | appIntegration:336、mcpStdioServer:286 | **删**。宿主入口只有两个调用方：`electron/main.ts:179`（`startCapabilityCore`）、`electron/main.ts:130`（`startMcpStdioServer()` 不带参数），都不传它；`createMcpStdioDirectInvoker`（mcpStdioServer:159，收同一个选项类型）生产只有 :218 一处调用，测试 `mcpStdioDocumentReceipt.test.ts` 4 处调用都不传它 |

出清单的命令（都能重跑）：

```
node scripts/door-map.mjs createGenerationPlanningHandler      # 换符号名逐个跑上表每一行
grep -rn "createGenerationPlanningHandler(" electron src tests --include='*.ts' --include='*.tsx' --include='*.mjs'
grep -rn "pinForCall" electron src --include='*.ts'
grep -rn "readCatalog()" electron/capabilityCore/appIntegration.ts electron/capabilityCore/mcpStdioServer.ts
grep -rn "startCapabilityCore(\|startMcpStdioServer(\|createMcpStdioDirectInvoker(" electron --include='*.ts'
grep -rn "generationPlanning[:,]" electron src --include='*.ts' --include='*.tsx' | grep "\.test\."      # 测试往消费位置递桩的行
```

### 两个宿主真不一样的地方

「判定」一列决定它是工厂的必填参数（真差异）、直接进工厂（相同），还是要先单独证明（疑似漏接）。

| 项 | 应用内 | 独立进程 | 判定 | 依据 |
|---|---|---|---|---|
| 模型表、就绪、价格、候选、默认模型、素材身份、分镜参考地址、分镜规划、视频推荐 | 有 | 有，写法逐字相同 | 相同 → 进工厂，宿主不再出现 | 两处源码对读 |
| 授权主体（核项目版本、读 Run、参考范围、封信封） | 有 | 有，主体相同 | 相同 → 进工厂 | :360–:395 对 :306–:336 |
| 封信封前等自家落画布落完（`settleCanvasLanding`） | 有 | 没有 | 真差异：独立进程没有渲染层、没有东西可等 → 落画布端口的一个方法 | :363；独立进程 :362 注释写明没有渲染层 |
| 落画布 | `createCanvasLandingHost` | `refuseLandingWithoutRenderer`（拒、不派，10-09 用户拍板） | 真差异 → 必填端口「落画布」，两种实现 | :218 起；:362–:364 |
| 向渲染层请示（`requestRendererDecision` / `requestRenderer`） | 有 | 没有 | 真差异 → 必填端口，独立进程明写「没有」 | :340–:341 |
| 多镜调度怎么驱动 | `driveScheduler`（可重启的踢法）+ 开拍前自己转 submitted | `startSemanticMultiShotBatch` 包了一层，做同样的转换 | **不知道是不是同一行为**：两边写法不同、目的相同。实现第一步对读后定：相同就进工厂，不同就做成端口 | :409–:444 对 :366–:395 |
| 单镜开拍后盯结果（`observeSingleShotRun`） | 有 | 没有 | 真差异（独立进程靠对账）→ 端口的一个可空方法，必须明写 | :455 |
| 重发前列出「结果未知」的镜头（`unknownShotsOf`） | 有（:459） | **没有** | **疑似漏接，没复现**。`mcpGenerationTools.ts:702` 没拿到就当成空清单。两边手里都有同一个 Run 仓库，没有理由不一样。它一旦统一就是独立进程上的行为改动，要有自己的修前红，不许混在「纯删除」里（见 ★9 第 6 条） | 两处源码 |
| 操作存储的「计划变了就落草稿」「先试一镜」 | 有 | 没有 | 真差异（都要渲染层）→ 落画布端口 | :188–:197 |

---

## ★0 先查别人

2026-11-21 实读，读到哪写到哪。

| 出处 | 它怎么做 | 对哪个决定的影响 |
|---|---|---|
| Seemann《Composition Root》https://blog.ploeh.dk/2011/07/28/CompositionRoot/ | 装配放在离入口最近的地方，每个进程一处；应用代码只收依赖、不自己组。评论里作者谈到十来个宿主共用组件时说重复登记是坏味道，但他**宁可接受一些重复，也不主张共享登记代码** | **有意不同**：我们把领域这一段做成共享工厂。理由是领域约束——这一段决定花不花钱、认不认识模型，两个入口答案不一样用户就走不到确认（11-16 那次、9-22 漏接素材身份那次）；Seemann 说的重复是登记代码长得像，不是两处给出不同答案。**确认了**另一半：两个进程入口各留自己的装配根，只交真差异，不合成一个进程 |
| VS Code `src/vs/code/electron-main/main.ts`（raw.githubusercontent.com/microsoft/vscode/main/…） | `createServices()` 一处建好全部服务，`startup()` 调它之后才 `createInstance(CodeApplication)`；消费者收依赖。只读了这一个文件，没读消费方 | **确认了**「一处建好、消费者只收」；没有改任何决定 |
| Mastra `packages/server/src/server/mcp/route.ts`（raw.githubusercontent.com/mastra-ai/mastra/main/…） | 每个请求在 handler 里现算工具清单（`buildBuiltinMCPTools`），不留启动快照；只有 Apps 包按进程缓存一次。没读它调用的 `./catalogue` | **确认了**「每次调用入口取一版」这个粒度 |
| King《Parse, don't validate》https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/ | 检查完把结果丢掉的校验，删掉也不报类型错，所以脆；改成返回更窄的类型，后面的代码拿不到非法值，证明推到入口去做 | **改了**「没钉住的调用怎么做不出来」：不做成「调用时查一下有没有钉」，而是规划逻辑只收「这次调用的目录」这个值，没有它函数签名就满足不了（★2） |
| Node.js `AsyncLocalStorage` 文档 https://nodejs.org/api/async_context.html | `run(store, cb)` 里和它起的异步操作看得到 store，外面 `getStore()` 是 `undefined`；标 Stable；**文档写明上下文会丢**（回调式接口、自定义 thenable 要另外处理） | **改了**钉一版的做法：现在 `liveGenerationRuntime.ts:83–:91` 靠它传「这次调用的那一版」，丢了就**不出声地改读现在的目录**（:90、:91 的 `??`）。这正是「没钉住的调用」的口子 → 改成显式传值，把它删掉 |
| Vitest 文档 `docs/config/index.md`、`docs/guide/migration/jest.md`（2026-11-21 经 context7 读 `/vitest-dev/vitest`） | 运行器只给环境变量：`process.env.VITEST`、没设时把 `NODE_ENV` 设成 `test`、`VITEST_POOL_ID` / `VITEST_WORKER_ID`。环境变量谁都能设，文档没有给「这段代码确实在测试里跑」的别的凭据；`setupFiles` 是运行器在每个测试文件前加载的文件 | **不拿环境变量当边界**。测试发放口只在测试 setup 文件里注册（`vitest.config.ts` 的 `setupFiles`，生产构建不含这个文件）；没注册时一调就抛错 |
| 仓库里的旧案 `electron/capabilityCore/generationHostsWireAssetIdentity.test.ts:1–:17`、`scripts/check-transport-assembly.mjs:1–:22` | 9-22 一个宿主漏接素材身份解析器、9-03 打包态漏接确认通道，两次都是「两处手工各组一遍」；两次的补法都是加一份扫源码写法的检查 | **改了**预防的层级：这两份检查是按写法守的，只算提示（#1581 定的口径）；这一刀让漏接在类型上写不出来，并删掉其中只为两份装配存在的那一份 |

没引的：MCP TypeScript SDK 的 README 没有回答「每个请求一个 server、两种传输共用登记函数」；Kubernetes 的 Server-Side Apply 页这次只读到导航，没读到正文。方向检查 `docs/engineering/direction-checks/2026-11-16-external-agent-host.md` §5 引的 SDK v2.4.0 文档是另一条线 11-16 读的，我没重读，不作为本卡依据。

出口：这一刀不新增用户可见出口；模型表这份事实的出口是起草、预览、过门、读模型清单四处，对拍见 ★9。

---

## ★1 用户怎么用

当我让外部助手（或 Nomi 里的 Agent）接一个新模型、接着正式生成时，我想不重启就走到确认卡，而且预览上的价格、门认的模型、确认卡上的模型是同一回事，以便不用猜哪一步在骗我。

步骤（和 #1584 的用户路径相同，这一刀不改它）：助手交卡 → 读模型 → 起草 → 预览 → 过门 → Nomi 弹确认卡 → 我点确认或忽略。

**不做什么**：不改确认卡、不改谁来批、不改收据；不改外部助手连 Nomi 的方式；不把独立进程宿主退成薄转发（方向检查第 3 段，用户 11-16 说等老连接的兼容证据再定）；不改确认走哪个协议（第 2 段，用户说先出对比图再定）。

**已知坑**：两边「多镜调度怎么驱动」写法不同，是否同一行为还不知道；`unknownShotsOf` 在独立进程上疑似漏接，没复现。

真实任务（3 条，都用现成走查，不是新造夹具）：

1. 两个宿主先起来再交卡，不重启走到确认卡——`tests/ux/mcp-declared-model-gate.e2e.mjs`（今天 17 条全过）。
2. 四份 0.24.0 旧资料冷启动后，内置模型、旧卡模型、新接模型都走到确认卡——同一份走查加 `NOMI_WALK_OLD_USER_FIXTURE=<目录名>`（今天 17 / 22 / 22 / 19 条全过）。
3. 一次调用中途目录变了（交卡、改价），这次调用里的模型表、就绪、**价格、候选、默认模型**都还是入口那一版——`electron/capabilityCore/liveGenerationRuntime.test.ts` 现有的「调用中途换目录」用例加价格、候选、默认模型三项断言。

指标（目标 → 信号 → 指标，每个点名量具）：

| | 指标 | 基线 → 目标 | 量具 |
|---|---|---|---|
| 主 | 手写生成装配的份数 | 4 → 1 | `node scripts/door-map.mjs createGenerationPlanningHandler` 的写入口数（含测试辅助） |
| 主 | 一次生成调用里绕开钉住那一版、直接读盘上目录的读点 | 今天 8 行（应用内 :213、:214、:350、:352；独立进程 :283、:284、:290、:291）→ 0。应用内 :209 也直接读盘，但它是提交时给画布那台传输列连接名，不在一次生成调用里，这一刀不动 | `grep -n "readCatalog()\|deriveUsableVideoModelCandidates\|readGenerationDefaultModelResolver" electron/capabilityCore/appIntegration.ts electron/capabilityCore/mcpStdioServer.ts` 落在生成接线里的行数 |
| 质量 | 同一次调用里，模型表和价格读到不同版本的次数 | 今天：未验证（预测 > 0，见 ★9 第 5 条）→ 0 | 真实任务 3 的断言 |
| 护栏 | 走到确认卡的走查断言通过数 | 97 / 97（17 + 17 + 22 + 22 + 19）不降 | 真实任务 1、2 |
| 护栏 | 目录没变时门问一次目录的耗时 | ≤ 5ms（今天约 0.55ms）不升档 | 性能场景 `gate-live-catalog-40-shots` 的 `perGateCatalogReadMs` |
| 护栏 | 外部助手看到的工具面、协议帧 | 0 差异 | `electron/capabilityCore/mcpWireContract.test.ts` |

没有使用遥测能直接量「外部助手交卡后走到确认」的比例：未验证：缺量具（遥测没有 Agent 回合这一项）。

### ★1b 连带界面

没有新增文字。这一刀之后可能变的只有一处：独立进程上「重发」时列不列「结果未知」的镜头（如果证实是漏接并统一）。那一句的中英文回执沿用应用内已有的，不新写。

### ★1c 老用户

| 他手上的东西 | 升级后 |
|---|---|
| 已装的外部助手配置（Claude、Codex 等里的 Nomi 条目，本机直连和旧的独立进程两种） | 不动。两个入口、端口、握手、工具名和参数都不变；配置文件这一刀一个字节不写 |
| 0.24.x 的模型目录（含被卡改写过的内置连接、整家删过的记录） | 不动。盘上格式不变、不迁移；#1584 的启动对账原样保留 |
| 进行中的 Run、已批的收据 | 不动。操作存储、授权、收据的实现不改，只是换了由谁把它们接起来 |
| 退回上一版 | 打得开：没有新增盘上字段 |

验证用真实旧版本数据：`tests/fixtures/old-user-data/builtin-connection/` 四份（0.24.0 的代码落的）。它们的密钥是生成器用假加密写的，真窗口解不开——「升级后不用重填密钥」这一条本卡同样验不到，照 #1584 的写法标未验证。

---

## ★2 谁说了算

| 概念 | 唯一主人 | 这个 1 靠什么保持（#1581 的三种里哪一种） |
|---|---|---|
| 生成这一套怎么接起来（新概念，登记进 `docs/engineering/concept-owners/`） | 新文件 `electron/capabilityCore/generationDomain.ts` 的 `createGenerationDomain(ports)` | **使用结果那一步只认主人给的**，分三层，各拦什么照实写在表下面 |
| 这次调用读哪一版目录（现有概念 `generation.live-catalog-view`） | `electron/capabilityCore/liveGenerationRuntime.ts` | **别处拿不到原料**：工厂没有「模型表」「目录」这类参数，宿主没有地方递；规划逻辑只收「这次调用的目录」这个值，由工厂在每次调用入口取一次、显式传进去。量具：类型检查 + ★9 第 2、3 条 |
| 价格、可用视频模型候选、默认模型在生成调用里的取值 | 同上（同一版目录算出来的） | **各出口在依赖方看到的那一步一致**：真实任务 3 的断言，把模型表、就绪、价格、候选、默认模型放在同一次调用里比 |
| 落画布、向渲染层请示、盯结果 | 各宿主（真差异） | 工厂的必填端口；没有就明写没有，不许省略 |

**「只认工厂发的」分三层，每层拦什么**：

1. **类型**：四个消费位置收的「规划」是带记号的类型，记号只有工厂模块里造得出来。手写一份 `createGenerationPlanningHandler(...)` 的返回值放不进去——拦的是**不小心**再写一份（9-22、9-03、11-16 三次都是不小心，不是有意绕）。写 `as` 强转能骗过这一层。
2. **运行时**：工厂把自己发出去的每一个记进模块私有的名单（`WeakSet`，不留强引用，规划没人用了就能回收）；门的权威和派发入口在装上的那一刻核一遍「这个在不在名单里」，不在就抛错。强转骗得过类型，骗不过这一步——宿主一启动就崩，两个宿主的走查在握手那一步红。
3. **测试怎么过**：今天有 14 行测试往派发上下文递桩、10 处测试自己建门的权威（见调用方表），它们测的是派发和门，不是装配，是正当的。给它们一个测试专用的发放口（放在 `*.testkit.ts` 里），它把桩记进同一份名单；**发放的能力只在测试 setup 文件里注册**（`vitest.config.ts` 的 `setupFiles` 里加一个文件，它调工厂模块的注册口把「可以发测试桩」打开；生产构建不含这个文件），没注册时一调就抛错。不核环境变量——Vitest 文档里运行器给的只有环境变量，谁都能设（见 ★0）。生产代码引它：ESLint 的限制导入会红（这一条只算提示），真跑起来没人注册过，也过不了。

所以 R1「新写一份手写装配」红在哪要分开说：直接写 → 类型检查红；强转 → 启动抛错、走查红；特意去引测试发放口 → 启动抛错（lint 也红，只算提示）。**没有一层是只靠数调用处的。**

**花钱确认那份测试辅助怎么递模型表**：`agentPanelSpendConfirmTestUtils.ts:327` 今天往里递静态模型表、假价格、假供应商；工厂没有这些参数。两种做法：

- 推荐：和 `externalAgentGateTestUtils.ts` 同一种——把资料目录指到临时目录、写一份真目录文件，让工厂照常从盘上读（假供应商走现成的「假供应商地址覆盖」）。这样这份辅助测到的就是真装配。**代价没估**：它的用例里有多少依赖「价格是随手给的一个数」，没数。实现第一步先迁一个用例试。
- 迁不动的话：**不许悄悄留一个「目录从参数来」的口子**（那正是这一刀要删的东西）。停下报协调，目标从 4 → 1 改成 4 → 2，并写明剩下那份为什么不算宿主装配，由协调定。

**没钉住的调用怎么做不出来**：今天是「调用入口用 `AsyncLocalStorage` 存一版，读的时候去取，取不到就读现在的」（`liveGenerationRuntime.ts:83–:91`）。取不到不报错，所以「没钉」是写得出来的，Node 文档也写明上下文会丢。改成：

- 工厂每次调用入口 `const call = runtime.openCall()`，得到这次调用的目录（模型表 + 就绪 + 目录状态）；
- 规划逻辑的入口签名收这个值；价格、候选、默认模型从它算；调用里起的后台活（调度、落地）不收它，要读就调 `runtime.current()`，名字和类型都不同；
- 删掉 `AsyncLocalStorage`、`pinForCall`、`GenerationCatalogRegistry` 类型里那个可选项，和 `readBootstrap` 里「钉住的没有就读现在的」那个 `??`。

65 处拿静态表的测试怎么办：静态表本来就只有一版。给一个 `fixedCatalogCall(registry)`（把一张静态表包成「这次调用的目录」），测试改一行。它是生产代码能调到的函数——**这一点类型拦不住**，所以保证不落在这里，落在上一行：宿主根本不调规划逻辑，只调工厂，而工厂没有目录参数。

**不知道的**：调用里再进一次工具（现在是「沿用外层那一版」，`liveGenerationRuntime.ts:95`）有没有真实路径在用——没数。显式传值之后嵌套调用要么把值带下去、要么重新取一版，实现第一步用 `grep -rn "generationPlanning(" electron/capabilityCore` 数清再定。

碰到的概念：新增 1（生成装配）；改 1（`generation.live-catalog-view` 的主人符号和说明）；`catalog.declared-provider-registration` 只在第 3 刀碰。

到点以后归谁：工厂只管「一次工具调用」的生命周期；调用结束后的调度、观察、对账仍归 Run 服务，这一刀不动它们的主人。

---

## ★3 一致与复用

**以前定过什么**：

- 用户 2026-11-16（方向检查 §7）：选「换一种做法」，只批第 1 段——领域装配收成一处、两个宿主共用同一套。还算数，本卡就是它。
- 用户 2026-11-21：#1584 先合，紧接着删重复装配；地基里靠扫描守着的那几组，拿旧副本的那类收原料。本卡是模型表那一串的第一刀。
- 用户 2026-10-09：没有渲染层时落不了画布就拒、不派。还算数，做成端口的一种实现。
- #1581（用户 11-21 采纳）：「只有一处」只认三种保证，按写法的检查只算提示。本卡每一行都按它标了。

**三条路**：

| 路 | 做什么 | 同一类还会不会出现、从哪出现 | 判断 |
|---|---|---|---|
| 沿原方向修 | 只把 `pinForCall` 改必填，两处宿主接线留着，再加一份扫源码的检查 | 会。带假钉的静态表照样递得进宿主；下一个只接一个宿主的依赖照样出现（9-22、9-03、11-16 已经三次） | 不选 |
| 换一种做法（本卡） | 一个工厂 + 宿主只交真差异 + 调用的目录显式传值 | 手写装配这一类写不出来。剩下的口子：有人给工厂加一个可选端口而只有一个宿主接——所以端口一律必填 | **选** |
| 删掉 | 删独立进程宿主的整套生成能力，只留应用内一处 | 这一类彻底没有。但旧的独立进程连接在 Nomi 没开时就不能生成了 | 不在这一刀：用户 11-16 说等老连接的兼容证据再单独定。本卡的工厂不妨碍它——到时删掉的是一个只有几十行的宿主端口实现 |

**交卡写路径的特例能不能去掉**（`electron/catalog/declaredProviderRegistration.ts`：`if (builtinSeed) { …核对… }` 两段和 `if (!builtinSeed) tx.upsertVendor(…)`）：

| 路 | 做什么 | 代价 |
|---|---|---|
| 沿原方向 | 留着这三处 `if` | 下一种「归代码管的连接」（比如另一家内置）要再补分支 |
| 换（推荐，第 3 刀；和「不写按供应商的分支」同向：交卡路径不再认识「内置」这个词） | 「这条连接的地址、认证、素材上传方式归谁」变成连接自己的一项事实，由连接的主人回答（内置 = 归种子，卡只能核对；自接 = 归卡）。交卡路径只问「这一格我能不能写」，不再认识「内置」这个词 | 分支不会消失，是从交卡路径里挪进一张「这条连接归谁」的表；启动对账 `restoreBuiltinOwnedFields` 读同一张表，两处判据变一处 |
| 删 | 不许往内置连接上挂卡；要加模型就另建一条连接 | **已定：留**（协调按用户以前定过的两条定，不再问用户）：下一版核心是只维护 APIMart 这一家内置、把它的模型接多接深，APIMart 的模型仍走通用的接入卡那条路、不写按供应商的分支；中转模型由 AI 交卡接入，不走手填。11-16 用户走的正是「在内置 APIMart 上让助手接一个新模型」。去掉交卡路径里的内置特例放第 3 刀，这一刀不碰 |

**地基第 2、3、4 组和装配是不是同一个主人**（能不能一刀收）：

| 组 | 原料是什么、今天从哪拿 | 和装配的关系 | 结论 |
|---|---|---|---|
| 生成调用里的价格、候选、默认模型（之前没单独立组） | 两个宿主接线里直接读盘上的目录（8 行，见全家清单） | **同一个主人**：都是「这次调用读哪一版目录」 | 第 1 刀一起收 |
| 第 2 组「有哪些模型可用的清单」 | 主进程：`electron/capabilityCore/modelSpecRead.ts:24、:42、:82` 三处 `agentModelEntriesFromCatalog(readCatalog())`，直接读盘；渲染层：`buildAgentModelEntries` 4 个文件 5 处，读渲染层自己的目录缓存。（我 11-21 早些的报告写的是 6 个和 2 个文件，这里是 door-map 的调用处；差在哪没逐个对，可能是数法不同，也可能中间合了东西） | 主进程那一半**是同一份原料的另一扇门**：助手先读清单、再起草，清单读盘上现在的、起草读钉住的，两句话可能对不上。渲染层那一半不是同一个主人（另一个信任域，拿的是主进程下发的目录） | 主进程那一半第 2 刀收（清单改从工厂的目录读）；渲染层那一半不收原料，补出口对拍（清单和主进程的逐行比），单独一刀 |
| 第 3 组「模型名与发送方式」 | `resolveModelForTask` 生产 2 个文件 4 处：`semanticGenerationCandidate.ts` 3 处的行来自 `registry.snapshot()`（经装配，钉得住）；`electron/shared/agentCapabilities/verbs/draftShotsProjection.ts:169` 的行是调用方传进来的——**谁传、从哪来没查** | 经装配那 3 处第 1 刀后自动读同一版；另一处不知道 | 第 1 刀不动它的判据。四格表里它的「绕过处」（依赖注入取推荐首项）是按验收报告记的，我没开代码核，第 2 刀开工前先核那一处的原料来源 |
| 第 4 组「接入时调用方式谁写」 | `validateProviderAdapterDraft` 生产 3 处：`modelOnboarding/submitDeclaration.ts:174`、`providerAdapter/agentCompileRequest.ts:64`、`providerAdapter/serviceCompilation.ts:130`。原料是卡，不是目录 | **不是同一个主人**：它是写入那一刻对卡的判定，和「生成调用读哪一版目录」没有共同原料 | 不进第 1、2 刀。和交卡写路径的特例是同一条路上的事，放第 3 刀一起看；它的绕过处（`Set.add` 连写）同样只按验收报告记着，没核 |

**拆成几刀、先后**：

1. **装配 4 → 1 + 调用内的价格、候选、默认模型**（本卡的实现合同）。
2. 主进程的模型清单读口（`modelSpecRead.ts`、`core.ts:157`）改从同一份目录读；开工前先核第 3 组那一处原料来源。依赖第 1 刀的工厂。
3. 交卡写路径：连接归谁做成一项事实；第 4 组的收件口一起看。和第 1、2 刀不碰同一批文件，可以和第 2 刀并行。
4. 渲染层的模型清单和主进程对拍。最后做，因为要等第 2 刀定下主进程的清单长什么样。

第 2–4 刀各自动手前另写卡；本卡 ★9 只管第 1 刀。

**复用**：工厂里用的全是现成的函数（上面调用方表里的每一个），不新写领域逻辑；新写的只有工厂本身、端口类型、`fixedCatalogCall`。

---

## ★4 全状态

用户可见状态不变，逐个写这一刀会不会碰到它：

| 状态 | 用户看到什么 | 这一刀 |
|---|---|---|
| 空（没有可用模型） | 起草被拒，点名怎么接 | 不变 |
| 加载（门在算） | 外部助手等回话 | 不变；耗时护栏见 ★1 |
| 成功 | Nomi 弹确认卡 | 不变 |
| 失败（不认识的模型、这家没接好、这家被你删了） | 回话点名字段和下一步 | 不变；文字来源同一处 |
| 部分成功（多镜里有的没落到画布） | 逐镜说明哪几镜没发 | 不变；如果两边调度驱动证实不同，保持各自现状 |
| 取消中 | 点忽略后门如实收尾 | 不变 |
| 过期（确认时目录或项目已变） | 「此确认已失效」 | 不变；授权主体原样搬进工厂 |
| 能力不可用（独立进程没有渲染层） | 「需要在 Nomi 里打开项目后再继续」 | 不变；端口的一种实现 |

## 5 中途表

不适用：这一刀不新增任何状态，也不改停、关窗、断网、重启、连点时的行为——操作存储、授权、调度、落画布的实现原样搬进工厂，谁在什么状态下被打断会怎样，仍由它们各自现有的测试守。和打断沾边的只有一格，单独盯：**调用进行中目录变了**——这次调用继续用入口那一版，下一次调用用新版，调用里起的后台活读现在的（真实任务 3）；门停在确认之前，不扣钱。

## 6 外部数据与失败

外部来源只有两样，都不改：外部助手发来的工具调用（契约 `mcpWireContract.test.ts`）、盘上的模型目录（0.24.x 的形状见 ★1c）。未知失败不归咎用户的密钥——这一句的出处不动。

## 8 真实条件

| 条件 | 计划 |
|---|---|
| 真窗口、两个宿主 | 跑（真实任务 1） |
| 0.24.0 旧资料冷启动 | 跑四份（真实任务 2）；「不重填密钥」未验证：旧资料是假加密 |
| 打包态（裸 Node 启动器那条路） | **必须跑，不许只写「未验证」**（协调 11-21 定）。9-03、8-18 两次事故都是开发态全绿、打包态才坏。已查：`mcpNodeLauncher.ts` 的加载闭包里没有 `mcpStdioServer`、没有生成规划，`mcpLauncherClosure.test.ts` 静态守「启动器闭包里没有 electron 的值导入」——工厂文件不在裸 Node 那条路上。仍然跑一次真的：`pnpm run dist:mac:dir`（打包后起包里的启动器走 `tests/ux/packaged-mcp-smoke.e2e.mjs`）。本机跑不了就停下报协调 |
| 英文界面 | 不新增文字；如果统一了 `unknownShotsOf`，那一句走英文走一遍 |
| Windows | unverified |
| 真付费 | 不跑：门停在确认之前；合并后由协调并进它那一次核对 |

拍板图清单：不适用——不改任何界面。

---

## ★9 验收与回滚

### 删除清单（和新增同一个提交，不留并行版、不留退路）

| 删什么 | 在哪 |
|---|---|
| 应用内宿主的生成接线 | `appIntegration.ts:200–:214`（运行时、价格）、:336–:470（规划接线） |
| 独立进程宿主的生成接线 | `mcpStdioServer.ts:271–:285`、:286–:434 |
| 两个宿主的可注入口 `authorities.generationPlanning` | `appIntegration.ts:154`（类型）、:336；`mcpStdioServer.ts:286` 及其选项类型 |
| 测试辅助里的手抄接线 | `externalAgentGateTestUtils.ts` 的 `hostWiredPlanning`；`agentPanelSpendConfirmTestUtils.ts:307–:360` 里的接线部分（改成给工厂递测试用的端口） |
| 钉一版的旧机制 | `liveGenerationRuntime.ts` 的 `AsyncLocalStorage`、`pinForCall`、`GenerationCatalogRegistry` 的可选项、`readBootstrap` 的 `??`；`mcpGenerationTools.ts:718–:719` 的「有就钉」 |
| 只为两份装配存在的按写法检查 | `generationHostsWireAssetIdentity.test.ts`（整份：它扫两个宿主的源码看有没有递素材身份；之后宿主不递这一项）；`liveGenerationRuntime.test.ts:150–:156`（查宿主源码里有没有那一行） |
| 说「只有两处装配」的文字 | `eslint.config.mjs:987–:998` 的注释和提示语里点名 appIntegration / mcpStdioServer 的部分 |

**留着的**：`scripts/check-transport-assembly.mjs`——它管的是传输接口（`McpHost`）的可选成员在三个传输装配点接没接，和领域装配不是同一个接口。它的登记表里有没有点到生成接线，我没逐行读，实现线核一遍：点到了就同提交改。

### 验收清单（实现线按它自验，验收线只核它）

1. `node scripts/door-map.mjs createGenerationPlanningHandler` 写入口 = 1（工厂）；`createLiveGenerationRuntime` 写入口 = 1。*（提示级：数调用处。真正的保证是第 2–4 条。）*
2. 类型反例文件（新增，随类型检查跑）里三条 `@ts-expect-error` 都成立：①把手写的 `createGenerationPlanningHandler(...)` 返回值交给门的权威 / 本机 RPC 服务；②给工厂递一个模型表或目录；③不带「这次调用的目录」调规划逻辑的入口。另加运行时用例两条：把没经工厂的规划强转后交给门的权威，装上那一刻抛错；测试发放口在没有测试运行器标记时抛错。
3. 两个宿主文件里不再出现 `createLiveGenerationRuntime`、`readCatalog()`、`deriveUsableVideoModelCandidates`、`readGenerationDefaultModelResolver`、`createCatalog*PricingResolver`（★1 第二个主指标 = 0；应用内 :209 那一行除外）。*（提示级。）*
4. 真实任务 1、2：两个宿主 17 条、四份旧资料 17 / 22 / 22 / 19 条，全过，截图实现线自己看过。
5. 真实任务 3：一次调用中途换目录，这次调用里的模型表、就绪、价格、候选、默认模型全是入口那一版；下一次调用全是新版。
6. `unknownShotsOf`：先在今天的主分支上写一条测试证明独立进程重发时不列「结果未知」的镜头（**修前红**）；红了才统一，不红就说明我判断错了、保持现状并在 PR 里写明。
7. 两边多镜调度的驱动：对读后给结论（相同 → 进工厂；不同 → 端口），结论写进 PR。
8. `mcpWireContract.test.ts`、`externalAgentGateReachConfirm.test.ts`、`builtinWholeDeletionReconnect.test.ts`、`mcpGenerationTools.test.ts`、花钱确认那一组测试全绿；测试辅助不再手抄接线（第 1 条的数里包含它们）。
9. 性能场景 `gate-live-catalog-40-shots`：`perGateCatalogReadMs` ≤ 5ms，和基线同档。
10. 打包态冒烟过（`pnpm run dist:mac:dir`）。本机跑不了就停下报协调，不许跳过。
11. 概念登记同提交更新，`pnpm run check:concept-owners` 绿。
12. 独立验收（花钱类，另一条线）：先跑下面两种「没做成的版本」，都红才往下核。

### 两种没做成的版本都必须红

- **什么都不做**（今天的主分支）：第 1 条红（写入口 4）；第 2 条红（三条 `@ts-expect-error` 在今天都**不**报错，所以类型检查反过来报「多余的 expect-error」）；第 3 条红（8 行，另加 :209 那一行不计）；第 5 条**预测**红（价格今天每次现读盘，调用中途改价会读到新价）——这一条没跑过，是预测，实现第一步先在主分支上跑出来。
- **全部拦下**（工厂一律回「没就绪」，或一律拒绝起草）：第 4 条红——走查停在「起草成功」或「走到确认卡」；第 8 条里用户路径那一条红。

### 反例（改坏 → 红，还原 → 绿，日志进报告）

| # | 改坏什么 | 该红的 |
|---|---|---|
| R1 | **新写一份手写装配**：第三个文件里调 `createGenerationPlanningHandler(...)`，把结果交给门的权威或派发上下文。做三遍：直接写；加 `as` 强转；引测试发放口 | 直接写 → 类型检查（第 2 条 ①）；强转 → 启动抛错，真实任务 1 在握手红；引测试发放口 → 启动抛错（lint 也红，只算提示） |
| R2 | 给工厂加一个可选的「模型表」参数，一个宿主递启动时拍的 | 类型反例 ②；真实任务 1 在「预览认得刚交卡的模型」红 |
| R3 | 规划逻辑里绕开传进来的目录、直接读盘 | 真实任务 3（第 5 条） |
| R4 | 工厂里把价格改回每次现读盘 | 第 5 条的价格断言 |
| R5 | 独立进程的落画布端口换成应用内那种（假装有渲染层） | 现有「没有渲染层就拒、不派」的测试 |
| R6 | 删掉一个宿主的某个必填端口 | 类型检查 |
| R7 | 旧案回放（9-22）：让一个宿主拿不到素材身份解析 | **写不出来**——这一项不再由宿主递；回放方式是在工厂里删掉它，`draft_shots` 带参考图的现有测试红 |

**不该拦的真实样本**：65 处拿静态表测规划逻辑的测试，改一行（包成 `fixedCatalogCall`）后照常跑、照常绿；`electron/parity/` 下直接用 `createCatalogModuleRegistry` 做对拍的测试不受影响。

### 回滚

整个 PR revert。盘上没有新字段，用户配置没写过，revert 之后就是今天的主分支。

### 功能分类

- [x] 花钱
- [x] 生成效果（路径会推出这一类；不改出图出片的内容）
- [ ] 新界面 / 改交互
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 数据格式
- [ ] 新增功能 / 性能

---

## 风险和不知道的

1. **打包态**：已查，工厂不在裸 Node 启动器的加载闭包里（见上面功能分类那一行）；9-03、8-18 都栽在这里，所以冒烟仍然必跑。
2. **两边多镜调度驱动**是不是同一行为：不知道，只对读了写法。
3. **`unknownShotsOf` 是不是漏接**：疑似，没复现。
4. **嵌套工具调用**有没有真实路径：没数。
5. **第 3、4 组的绕过处**：只按验收报告记着，没开代码核；第 2、3 刀开工前要核。
6. **第 5 条「今天价格和模型表会读到不同版本」**是预测，没在主分支上跑出来；它决定「价格收进来」算修了一个真问题，还是只是顺手统一。用户看得见的后果（确认卡上的钱和预览不一致）没验。
7. **`check-transport-assembly.mjs` 的登记表**有没有点到生成接线：没逐行读。
8. **工作量**：两个宿主各删约 140 行、新文件预计 200–250 行、65 处测试各改一行。`appIntegration.ts` 今天 706 行，过了 650 的黄牌线，这一刀之后会降下来；没算过新文件会不会顶到线。
9. **花钱确认那份测试辅助迁不迁得动**：没估。迁不动就不是 4 → 1。
10. **测试发放口**：已查 Vitest 文档，运行器给的只有环境变量，靠不住；定为「只在测试 setup 文件里注册」（见 ★0）。剩下的风险：有人在生产代码里手调注册口——注册口和发放口同在 `*.testkit.ts`，受同一条限制导入管，只算提示。
11. **这张卡没让「给工厂加一个可选端口」写不出来**——只能靠「端口一律必填」这条约定和评审。这是剩下的口子，照实写在这里。

## 实现时查到、和上面写的不一样的地方（2026-11-21）

上面的正文是动手前写的。实现中查到下面几处，以这里为准。

1. **用到规划的位置是五个，不是四个**。多出来的是模型那一侧的传输（`createPiGenerationTransportAdapter`）：常驻生成面在它上面，但花钱确认那份测试辅助绕过常驻生成面直接搭它。五个位置都加了类型记号和按名单核。
2. **往名单里记的能力只发一次**。名单和核对放在 `generationPlanningIssue.ts`（没有依赖，谁引都不成环）；工厂模块在加载时把「往名单里记」拿走，别的模块再要就抛错。这比「记的函数是工厂模块私有的」多一层：就算有人想自己发，进程一起来就红。
3. **`*.testkit.ts` 会被编进主进程产物**（主进程构建只排除 `*.test.ts`）。所以「生产构建不含」只对测试 setup 文件成立；测试辅助文件在产物里，但没有人打开过发放口，调了就抛错。
4. **第 5 条（调用中途改价）在主分支上是红的**，但要分开说：只改价时，授权按后来那一版记（19，入口是 7），回话和授权信封在生产里是一致的（都按后来那版），不是「一张卡上两个价」；中途删模型时才是真分裂——模型表（入口那一版）说还在，价格（后来那一版）说没了。让出执行权的地方有两处（等画布落地、解析参考素材），都在「准备授权」里。
5. **第 6 条换了说法**。应用关着时独立进程那个宿主自己发不出去（没有画布可落，拒发），所以「它漏接了结果未知的镜」不会让它再发一次。真实处境是：应用开着时发出去、结果未知 → 创作者关掉应用 → 助手再读，这时回话的是独立进程，读到的是「还在等」而不是「别再发，请用户去后台核对」。
6. **两个宿主的行为差异这一刀原样保留，做成必填端口**，不统一：多镜批次怎么推（应用内会定时重踢；独立进程推一趟，状态不对时抛带码的错）、核对之后怎么收尾（独立进程当场把单镜记成完成 / 要人处理；应用内不在这里记）。是不是该统一没有查清。
7. **规划逻辑里有一样跨调用要记的状态**（同一请求先后两次起草，补在同一份方案上）。每次调用重新绑一遍依赖时它会丢，已单独提到外面；`planningForCall` 的注释写明里面不许放跨调用的状态。
8. **花钱确认那份测试辅助这一刀没迁进工厂**（4 → 2，等协调定）。它要的静态模型表、随手给的价格、假的工程根，工厂都不收；不给工厂加「从参数来」的口子就得把它整个搬到真盘夹具上。这一刀把它围在测试里：它的规划只能经测试发放口进到那五个位置。
9. **可用视频候选以前在装配那一刻就被展开求值了一次**（起草准入那里把整个依赖对象展开，访问器当场求值），之后一直用那一份。现在每次调用重新绑，读的是这次调用的那一版。

