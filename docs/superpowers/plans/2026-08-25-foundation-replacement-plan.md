# Foundation Replacement and Isolation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏 Nomi 业务语义、旧项目快照、Agent 操作、额度确认、ProductionRun 和导出的前提下，识别并逐步替换真正属于通用基础设施的部分。

**Architecture:** 采用 adapter-first 的绞杀者路线。先隔离瞬时状态、领域状态和基础 runtime，再用 contract replay、性能采样和真实用户任务逐模块放行。任何替换只发生在独立分支/隔离 worktree，通过闸门后再合入。

**Tech Stack:** Electron、React、Zustand、Vitest、Playwright、R3F/Three、Leafer、Tiptap、TanStack Virtual、MCP official SDK spike、Zod、ffmpeg。

---

## 工作约束

- 生产迁移开始前，所有实现工作都在独立 sibling worktree 进行；不在用户当前脏树上切分支、reset 或提交。
- 本计划先交付审计和设计；没有用户确认前不替换生产依赖、不改项目快照格式、不删除现有运行路径。
- 新实现必须先接入 Nomi 无关的 adapter contract，禁止把第三方类型扩散到 domain store。
- 不保留长期双实现。shadow/feature flag 仅用于验证，验收后同一提交删除旧路径或收敛成单一 adapter。

## Phase 0：固定基线和观测能力

**目的：** 先证明后续变化是替换造成的，而不是基线漂移或测试不完整。

- [ ] 在独立分支记录 `origin/main` commit、Node/pnpm 版本、平台和依赖 lockfile。
- [ ] 固定四类 fixture：旧画布快照、旧时间轴快照、MCP recorded frames、ProductionRun event/revision 数据。
- [ ] 给真实任务增加稳定的成功信号：快照 hash、节点/边数量、playhead、导出文件、MCP tool result、outbox 状态，而不是只看 DOM 存在。
- [ ] 为 canvas/timeline 增加 PerformanceObserver 或 Playwright trace 采样，记录 frame interval、long task、渲染次数和关键动作耗时。
- [ ] 基线命令：

```bash
pnpm run check:filesize
pnpm run check:tokens
pnpm run check:i18n
pnpm run lint:ci
pnpm run typecheck
pnpm run test -- --reporter=dot
pnpm run build
```

**Exit gate：** 基线全绿，fixture 可重放，真实任务能被同一入口重复执行。
**Rollback：** 只删除新增观测，不触碰业务代码和数据。

## Phase 1：建立边界，不替换实现

**目的：** 解决当前动态 import 不能形成隔离的问题。

- [ ] 为画布定义 `CanvasRuntimeAdapter`：输入 pointer intent、viewport command、node render projection；输出 transform、selection、gesture completion。
- [ ] 为时间轴定义 `TimelinePlaybackAdapter`：把 playhead clock、scrub、trim、selection 与 `TimelineState` 的持久化编辑命令分开。
- [ ] 为 MCP 定义 `McpTransportAdapter`：协议 frame 与 Nomi capability invocation 分离。
- [ ] 为 IPC 定义 channel contract 文件夹，按 channel 给出 request/result/error schema。
- [ ] 盘点 `generationCanvasStore.ts`、`workbenchProjectSession.ts`、`generationRunController.ts` 的静态 import，先把跨层 import 收敛到 adapter，不通过 lazy import 掩盖耦合。

**Tests：** adapter contract unit tests、旧 fixture replay、import-boundary invariant test。
**Exit gate：** domain 层不直接依赖候选第三方 runtime；旧实现通过新 adapter 后行为不变。
**Rollback：** adapter 只转发到旧实现，删除 adapter 即恢复原调用链。

## Phase 2：先处理时间轴的高频状态问题

**目的：** 用低风险模块验证“瞬时状态/持久化状态分离”方法，为画布迁移建立模板。

- [ ] 将播放中的 playhead 保存在 playback clock/ref 或独立 transient store；播放帧不再每次复制完整 `TimelineState`。
- [ ] 只有用户 scrub、trim、split、停止播放或需要保存时，才生成领域编辑命令并进入 undo/persistence。
- [ ] 把 `TimelinePreview`、`TimelinePanel` 和非时间轴面板改为最小 selector，避免无关 timeline 字段变化触发整面板重渲染。
- [ ] 加入 60Hz/120Hz 连续播放测试，覆盖暂停、快速拖拽、blur、pointercancel、切换项目和撤销恢复。
- [ ] 使用真实时间轴任务验证：画布镜头一键拼片 → 手动重排 → trim/split → 播放/拖动播放头 → 保存 → 重新打开 → 导出。

**Exit gate：** timeline 快照和导出结果等价；播放期间没有每帧持久化；真实任务闭环通过。
**Rollback：** 保留旧 `setTimelinePlayhead` adapter，失败时只切回 clock adapter，不迁移数据。

## Phase 3：时间轴成熟框架隔离验证

**目的：** 只验证成熟时间轴库能否承接通用交互，不把 demo 当成迁移结论。

- [ ] 在独立 spike package/route 中接入候选库，不改生产 `TimelinePanel`。
- [ ] 用 Phase 0 的真实 clip fixture 和同一套 `TimelinePlaybackAdapter` 驱动候选库。
- [ ] 对齐 ruler、zoom、scrub、selection、trim、split、multi-select、keyboard、undo、persist、export。
- [ ] 录制旧实现和候选实现的 interaction trace，比较最终领域命令和快照，而不是比较内部组件树。
- [ ] 测量长任务、帧间隔、DOM 数量和大时间轴的内存占用。

**Exit gate：** 候选库在真实任务和异常输入上明显更稳，且没有 Nomi 语义泄漏。否则停止替换，只保留 Phase 2 的状态修复。
**Rollback：** spike 不进入生产依赖，删除 spike worktree 即回滚。

## Phase 4：MCP 官方 SDK compatibility spike

**目的：** 验证标准协议交给成熟实现后，Nomi 的确认和能力语义是否仍然完整。

- [ ] 把现有 `createMcpProtocol` 的 transport 和 capability invocation 先包成 `McpCapabilityAdapter`。
- [ ] 在引入任何 SDK 前，按项目 R5 先核对 Context7、官方 MCP 文档和当前 lockfile；记录协议版本、stdio transport、elicitation、progress、resources/prompts 的实际支持范围。
- [ ] 在隔离 spike 中使用官方 MCP SDK 的 stdio/JSON-RPC transport/server primitives；不要把 SDK request 类型放入 `mcpToolCatalog` 或 core domain。
- [ ] 先在旧 adapter 上补齐 request registry 和 `requestId → AbortController` 映射；处理 `notifications/cancelled`、stdio EOF、timeout 和断连，证明 fake provider 收到 abort 且不会继续触发付费副作用。
- [ ] 建立兼容矩阵：initialize/version negotiation、tools/list、只读 tools/call、写入 tools/call、elicitation、progress、resources/list/read、prompts、ping、malformed frame、unknown tool、disconnect、cancel 和 timeout。
- [ ] 验证版本不是任意回显：支持版本交集、未知版本错误、缺失/非法 `jsonrpc`、非法 envelope 和超长 stdio 行都要有确定响应。
- [ ] 让工具 catalog 的 JSON Schema 与实际 Zod/运行时 validator 同源；覆盖 required、类型、未知字段、数组代替对象和非法 JSON。
- [ ] 特别验证 `nomi_add_nodes` 的创意确认、`nomi_generate` 的额度确认、会话级 trust、App open/headless 路由和 widget metadata。
- [ ] 把 spend confirmation 绑定到一次性 request/challenge、已认证 client 和 operation id；增加并发首次付费请求、重复确认、伪造 `spendConfirmed` 的授权测试。
- [ ] 绑定 renderer apply reply 的 sender/frame/origin；增加跨 renderer、BrowserView 和 stale reply 的伪造测试。
- [ ] 用 recorded frames 做旧/新 adapter replay；写入类操作只使用 fake capability，不允许双写项目或扣额度。

**Exit gate：** 协议矩阵和 Nomi 业务矩阵均通过。
**Rollback：** 生产仍使用旧协议 adapter；SDK spike 依赖不进主应用，除非闸门通过。

## Phase 5：Electron IPC 异步化和契约化

**目的：** 消除 renderer 主线程同步阻塞和 `unknown` 边界，而不是替换 Electron。

- [ ] 在 `electron/ipc/contracts/` 为 project、model catalog、skill、asset transport 定义 Zod request/result/error schema。
- [ ] 先迁移项目 `list/read`：preload 使用 `ipcRenderer.invoke`，renderer 统一 await/loading/error；保持返回数据和错误分类不变。
- [ ] 再迁移 catalog/skill 的只读 list/describe，最后迁移写入、导入导出和密钥操作。
- [ ] 为每个 channel 增加 main handler 输入校验、超时、取消和异常序列化测试。
- [ ] 检查 bridge 类型和 runtime schema 是否同源，禁止新增无 schema 的 `payload: unknown`。
- [ ] 为 Browser bridge 的 console sentinel 增加严格 payload schema、长度上限、owner/view/origin 绑定和一次性 gesture token；伪造网页消息只能被拒绝或标记为不可信，不能直接进入导入/执行路径。

**Exit gate：** 启动、项目库、模型目录、skill 管理真实任务通过；同步 IPC 只剩明确的初始化/窗口控制例外，并有理由和测试。
**Rollback：** 每一组 channel 独立 adapter；失败时只回滚该组，不回滚其它已通过的异步 channel。

## Phase 6：3D、媒体和本地协议只做风险收敛

**目的：** 避免误把已经成熟的库和 Nomi 领域实现整体迁移。

- [ ] 审核 `Scene3DFullscreen` 和 camera preview 的 `always/demand` 模式，确认 always 只存在于播放/录制/捕获确实需要的阶段。
- [ ] 检查 `useFrame` 中的对象分配、CatmullRom 曲线、TubeGeometry、纹理和 renderer 资源；建立 dispose 和 context-loss recovery 测试。
- [ ] 保留 R3F/Drei/Three、Leafer、Tiptap 和 TanStack Virtual；只修 adapter、selector、cache eviction、abort 和生命周期。
- [ ] 为 filmstrip 增加重复请求、项目切换、取消、失败后重试和缓存淘汰测试。
- [ ] 为 `nomi-local` 增加大文件范围读取、suffix range、无效 range、路径穿越、请求中断和重复关闭测试。
- [ ] 保留 ffmpeg planner/manifest，验证取消、进度、临时文件清理和原子输出。

**Exit gate：** GPU idle、capture、媒体播放、范围读取和导出任务通过；无引擎替换。
**Rollback：** 每个修复都是局部实现或配置回退，不引入并行 renderer。

## Phase 7：统一真实任务测试系统

**目的：** 让“替换没有问题”有用户层证据。

- [ ] 建立 Playwright fixtures：项目、画布节点、时间轴素材、MCP fake client、媒体 fixture、ProductionRun fixture。
- [ ] 固定等待改成状态/事件等待；禁止用 sleep 证明生成、保存、导出或 IPC 完成。
- [ ] 每个候选替换至少有 normal、boundary、failure、recovery 四类用例。
- [ ] 真实任务至少覆盖：
  - 画布：导入素材 → 平移/缩放 → 框选/拖动/连线/分组 → 撤销 → 保存重开 → Agent 写入。
  - 时间轴：一键拼片 → 重排 → trim/split → scrub/play → 保存 → 导出。
  - MCP：initialize → 读工具 → 写入确认 → 额度确认 → progress → reconnect。
  - 媒体/3D：filmstrip → 播放修复 → 范围读取 → 轨迹/捕获 → 导出。
- [ ] 截图和 trace 必须来自同一构建、同一入口、同一平台分支；完成前人工检查关键画面。

**Exit gate：** 真实任务通过，失败可以定位到 contract、interaction、performance、recovery 或 product journey 中的一类。

## Phase 8：集成、删除旧实现和交付

- [ ] 只合入通过闸门的模块，逐模块删除临时开关和旧并行实现。
- [ ] 重新检查第三方依赖是否只在 infra/adapter 层，更新依赖锁文件和架构文档。
- [ ] 跑完整门禁：

```bash
pnpm run check:filesize
pnpm run check:tokens
pnpm run check:i18n
pnpm run lint:ci
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run test:system:ci
pnpm run check:walkthroughs
```

- [ ] 检查旧快照、Agent 写入、撤销/恢复、ProductionRun、媒体资源和导出产物没有隐式格式变化。
- [ ] 交付时报告：隔离树/分支、改动模块、每个闸门结果、已知限制、回滚方式、是否进入 PR；不把 spike 通过写成生产替换完成。

## 最终决策规则

- 只要第三方方案在基础 demo 上更顺，但不能无损承接 Nomi fixture，就不替换。
- 只要高频状态仍写入领域对象，就先修状态边界，不进入框架迁移。
- 只要标准协议/IPC 的错误、取消或恢复行为没有矩阵证据，就不切生产。
- 只有当真实用户任务、性能、恢复和回滚四道闸门同时通过，才允许进入正式迁移 PR。
