# 超时被放弃的用例还在后台跑完，把任务和半初始化模块留给下一个用例

> 📎 教训 · 首次记录 2026-10-10 · 状态：✅ 已固化（ESLint `no-restricted-syntax`（测试文件，`eslint.config.mjs` 的 `shortenedTimeoutSelectors`） + 共享 setup `tests/setup/inflightWork.ts`）
> **触发场景**：一个测试文件里第一个用例超时，后面一串用例报「已有任务在进行」「xxx is not a function」这类和自己无关的错；单跑全绿、推送前钩子 / 满载机器上稳定红。

**结论**：vitest 用例超时只是「不再等它」，用例体里的异步工作照样跑完。它在后台建出来的任务留在**模块级单例**里，下一个用例就被拖红；它没 import 完的重模块，下一个用例 `await import` 拿到的是**还在求值的半成品**（导出还没挂上 → `is not a function`）。所以：①重模块在文件顶部静态导入（收集阶段导入，不计入任何用例的超时）；②用例 / 钩子不许设比全局更短的超时；③持有后台任务的模块级单例登记一个收尾探针，共享 setup 每个用例后核它。

**为什么会踩**：
- `electron/export/exportJobIpc.test.ts` 第一个用例写着 `}, 15_000)`——当年全局超时是 5 秒，它是「放宽」；全局改成 30 秒后，它反而成了**收紧**。负载下（40 个空转进程）`await import("../runtime")` 冷导入要几十秒，第一个用例 15 秒超时；它随后在后台建出导出任务 `planning`，留在 `electron/export/exportJobs.ts` 的单例 `exportJobManager` 里；后面 9 个用例在同一个项目上建任务全被 `Cannot create export job while active export job … is planning` 拒绝。推送前钩子（几十道门并行）里另一种表现：超时落在导入途中，后续用例拿到半成品模块，报 `createProject is not a function`。
- 同样的「比全局更短的超时」全仓还有 26 处（14 个文件），其中 `runtime.apimartH3Preflight` / `runtime.fallback-path` / `runtime.imageEditGuards` 也是 `vi.resetModules()` 后每个用例冷导入 runtime 再配 15 秒——同一个坑。

**怎么用**：
- 用例里 `await import(重模块)` 只在需要 `vi.resetModules()` 换新实例时用；否则顶部静态导入。
- 不要给用例 / 钩子传比 `vitest.config.ts` 的 `testTimeout` / `hookTimeout` 更短的超时（ESLint 测试文件规则拦，硬零）。
- 新增「持有后台任务 / 会拒绝并发」的模块级单例：用 `electron/inflightProbe.ts` 的 `registerInflightProbe(name, { count, settle })` 登记；`tests/setup/inflightWork.ts` 会在每个用例后核它，残留就收尾并让**泄漏的那个**用例红。
- 还没登记、同形状的模块级在飞表（2026-10-10 扫描，`git grep` 模块级 `new Map<…Promise/AbortController/Job…>`）：`electron/tasks/comfyCandidateTest.ts`（`inFlight` / `controllers`）、`electron/catalog/codexCli.ts`（`liveJobs`）、`electron/capabilityCore/spendCardActionQueue.ts` 与 `electron/projects/projectCanvasWrite.ts`（按键串行的 promise 队列）、`electron/workspace/workspaceManifestTransaction.ts`（`stagedTransactionTails`）、`electron/assets/uploadContentStore.ts`（`pendingUploads`）、`electron/video/extractVideoFrame.ts`（`filmstripInflight`）、`electron/comfyui/capabilityStore.ts` / `electron/comfyuiObjectInfo.ts`（`inFlight`）、`electron/telemetry/intakeQueue.ts`（`flushing`）、`electron/spendGrant.ts`（`confirmationLocks`）。它们目前没有「拒绝并发」的语义（多是去重缓存或串行队列），泄漏的后果是串行队列被一个挂住的 promise 堵住；哪个先出现跨用例红，就按上面的方式登记探针。

**出处**：负载复现（`exportJobIpc.test.ts` 在 40 个空转进程下 10 红 / 7 绿 → 加 setup 后 2 红且报出泄漏 → 静态导入后 17/17 绿）；分支 `fix/export-job-ipc-test-leak`。
