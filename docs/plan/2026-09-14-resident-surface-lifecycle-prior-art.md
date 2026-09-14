# 常驻生成面「装没装」单 owner —— 先查别人（PR #785）

> 状态：✅ 已交付

本份是 PR #785（`fix/resident-generation-adapter-install-20260914`）的 R27「先查别人」报告：
在自己写第三份「常驻生成面装配状态」之前，先把仓库 / 依赖 / 生态里已有的做法查一遍，
结论决定**复用现有的「相（phase）判别联合」写法，只减真相份数、不新造机制**。

## 先查别人

- 仓库里已有（同族已修过两次，都只修了一端）：`docs/fixes/2026-09-12-announced-card-never-rendered.root-cause.json:1` 在读侧把 `null` 改成「抛」（对「装配抛了」对，对「按配置关掉」错）；`docs/fixes/2026-09-13-spend-surface-unavailable-error-boundary.root-cause.json:1` 在渲染层加吞错 guard（对「关掉」对，对「装配抛了」错）。两端都不是 owner —— 这正是本次判 `recurring` 的依据，也说明**不该再加第三个 guard**。
- 仓库里已有（可直接照抄的「相」写法）：`electron/shared/canvas/videoDepthRun.ts:34` 的 `VideoDepthPhase` 是常量数组派生词表 + `Extract` 取子集（刻意不写第二份词表）；`src/ui/onboarding/assistantActivationState.ts:16` 的 `AssistantVerifyPhase` 用 `'checking' | 'ok' | 'broken'` 把「还没查」和「查坏了」分成两相。本次 `ResidentSurfacePhase`（`disabled / starting / ready / install-failed / stopped`）与 `electron/shared/contracts/residentSurfaceLifecycle.ts:1` 的词表就是照这两处的形状写的，没有引入新模式。
- 依赖里有没有现成的？没有，判定为**领域约束**：Electron 只给进程级生命周期事件（`node_modules/electron/electron.d.ts:671` 的 `app.on('ready')`），它回答的是「app 起没起」，回答不了「**本会话里**这两条常驻面按配置该不该装、装到哪一步、没装是哪种没装」；`NOMI_DISABLE_CAPABILITY_CORE=1` 这种「刻意不装」的相在任何框架的生命周期里都不存在。所以只能在装配层自己写一份，但只许一份。
- 生态里怎么做：服务/依赖注入容器的通行做法就是把「未注册 / 正在解析 / 就绪 / 解析失败」做成互斥状态而不是 nullable 句柄，例如 .NET DI 的 `ServiceLifetime` + `IServiceProvider` 契约（https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection ）。结论一致：**判别联合替 nullable**，不为每个消费者各留一个 `undefined`。
- TikHub 自媒体来源：本次没用 TikHub —— 这是仓内装配层的不变量归属问题，不是用户怎么用产品的问题，自媒体里不会有这条线索的一手信息。

结论：**用已有形状、自研一份 owner**。复用仓内既有的「常量派生词表 + 判别联合」写法（上面两处 file:line），
把 `main.ts` / `appIntegrationSpendConfirm.ts` 里三份互不知情的 nullable 影子收成
`electron/capabilityCore/residentSurfaceLifecycle.ts` 一个 owner；同 commit 删旧（P1）。
不新增框架、不新增第三个 guard、不碰 harness、不改供应商与 MCP 外部契约。

## 范围与不动项

- 动：`residentSurfaceLifecycle.ts`（新 owner）+ 词表契约、`main.ts` 的能力核起停、`appIntegrationSpendConfirm` 读通道、lane 的 `generation_surface_unavailable` 文案、渲染层 `useAgentPanelSpendConfirm`。
- 不动：`tests/ux/canvas-performance-benchmark.e2e.mjs`（harness 不改，红是真红）、`laneVerbTransport` / `generationTransportAdapters`（#777 v2）、画布媒体管线（#776）。

## 验收门

见 PR #785 正文「验证」一节与 `docs/fixes/2026-09-14-resident-generation-adapter-install.root-cause.json`（schema v3，16 扇门）、结构评审 `docs/audit/2026-09-14-resident-surface-lifecycle-structure.md`。
