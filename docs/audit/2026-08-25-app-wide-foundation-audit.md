# Nomi 全项目基础设施审计

日期：2026-08-25
基线：`origin/main`，隔离树分支 `codex/framework-audit-20260825`
范围：画布、时间轴/预览、MCP/Agent、Electron IPC、3D、媒体管线、本地协议、生产运行控制面、持久化、编辑器组件、虚拟列表和测试基础设施。

## 结论先行

项目里确实存在与画布相似的通用基础设施风险，但不是“所有模块都应该换框架”。本次审计得到三类不同问题：

1. **通用交互内核自研过深**：生成画布，以及一部分时间轴/预览交互。这类问题最接近本次画布问题，应该先做适配边界，再验证是否引入成熟内核。
2. **标准协议或系统边界手写过多**：MCP JSON-RPC 和 Electron IPC 合同。这类问题不是换 UI 框架，而是把标准传输、校验和异步边界交给成熟实现或统一契约。
3. **已经使用成熟库，但业务高频路径仍有风险**：3D、富文本、白板、资产虚拟列表、媒体 filmstrip。这些不应迁移；应修正渲染模式、缓存、资源释放和状态订阅。

因此，当前不建议全面替换。建议采用一条“适配器/绞杀者”路线：先固定 Nomi 业务模型和快照协议，再替换一个基础层，逐项跑等价性和真实用户任务；任何一项不满足闸门就回滚，不影响主线。

## 基线证据

隔离树创建于：

`/Users/aoqimin/Desktop/Nomi-framework-audit-20260825`

分支：`codex/framework-audit-20260825`，基于当时刷新后的 `origin/main`。

已执行：

- `pnpm run typecheck`：通过。
- `pnpm run test -- --reporter=dot`：`735 passed | 1 skipped` 测试文件，`6484 passed | 1 skipped` 测试。
- `pnpm run build`：通过；Vite 与 Electron TypeScript 均通过。

构建同时暴露出替换前必须处理的模块边界问题：`generationCanvasStore.ts`、`workbenchProjectSession.ts`、`generationRunController.ts` 虽然有动态 import，但仍被多处静态 import，当前动态加载并没有形成真正隔离的运行时边界。

## 逐模块审计

| 模块 | 当前判断 | 风险 | 建议 | 优先级 |
|---|---|---|---|---|
| 生成画布 | Nomi 节点、边、分组、Agent 写入、撤销和持久化是业务核心；viewport/gesture/渲染调度是通用内核 | 高 | 保留语义层，先抽 `CanvasRuntimeAdapter`；再单独验证 viewport/gesture 内核 | P0 |
| 时间轴/预览 | 与画布最相似的第二处：播放头按帧写回整个 timeline 对象，TimelinePanel 订阅整个 timeline | 高 | 先拆 playback clock 与持久化 timeline；再做成熟时间轴库隔离 spike | P1 |
| MCP | 手写 newline-delimited JSON-RPC/MCP 协议；取消、版本协商、schema、请求生命周期和 authority binding 仍有缺口 | 很高 | 先补 request/cancel/schema/security matrix，再用官方 SDK 做 transport/protocol compatibility spike；Nomi 的确认、额度、widget、能力核保留在 adapter | P0/P1 |
| Electron IPC/Browser bridge | 多个项目、目录、模型 catalog 和 skill API 通过 `sendSync`；大量 bridge payload 为 `unknown`；网页 sentinel 输入缺少完整约束 | 高 | 读路径先异步化；建立 channel + zod 合同；绑定 sender/frame/origin；逐通道迁移 | P1 |
| 3D | 已使用 R3F/Drei/Three，并有 `FencedCanvas`、demand/always 模式和上下文恢复 | 中 | 不换引擎；检查 fullscreen/capture 模式、useFrame 高频分配、曲线/几何缓存和 dispose | P2 |
| 媒体/本地协议 | filmstrip 有共享 cache/队列；`nomi-local` 有范围读取、路径校验和测试；ffmpeg 有取消/进度/原子输出 | 中 | 保留领域实现；补 abort、缓存淘汰、超大文件和错误状态验证 | P2 |
| 白板/富文本/资产虚拟列表 | 已接入 Leafer、Tiptap、TanStack Virtual | 低 | 不迁移；只审查 adapter、生命周期和业务数据边界 | P3 |
| ProductionRun/持久化 | revision、幂等、outbox、预算账本、快照和 replay 是产品控制面，不是通用编辑器能力 | 中 | 保留；只做 schema/事务/恢复测试，禁止被新框架反向改写 | P1 保护项 |
| 测试基础设施 | 单测覆盖广，但 UX/系统脚本分散，存在固定等待和不同入口 | 中 | 统一 fixtures、状态等待和能力矩阵，分波次迁移 | P1 |

## 关键证据与含义

### 1. 画布问题确实有同类，但边界比“换组件”更大

- `src/workbench/preview/PreviewWorkspace.tsx:18-28` 将播放状态、时间轴和播放时钟连在一起。
- `src/workbench/workbenchStore.ts:695-697` 每次播放头移动都通过 `setTimelinePlayhead` 写回 `timeline`。
- `src/workbench/timeline/timelineEdit.ts:493-498` 为了更新一个整数，复制整个 `TimelineState`。
- `src/workbench/timeline/TimelinePanel.tsx:88-147` 直接订阅完整 timeline，并用它计算 primary clip、尺子和布局。

这和画布的共同根因是：**高频瞬时状态与需要持久化、撤销、业务计算的领域状态共用一个对象和订阅路径**。第一步应该是隔离状态和渲染，而不是马上换时间轴框架。

### 2. MCP 是真正的“标准基础设施自研”候选

`electron/capabilityCore/mcpProtocol.ts:1-6` 明确记录了手写 JSON-RPC/MCP 的决定；`112` 的 `RpcMessage` 是宽松结构；`330-680` 手动处理 initialize、tools/list、tools/call、resources、prompts 和 ping；`685-697` 手动路由服务端请求响应。

这里的替换价值高于替换白板或富文本，但风险也高：MCP 只是传输和协议层，额度确认、创意 gate、会话信任、widget、Nomi 能力核和 headless 策略都不是 SDK 能替代的。必须把 SDK 限定在协议适配器内，禁止让 SDK 类型反向成为 Nomi 业务模型。

进一步的只读审查发现，MCP 不能只按“换不换 SDK”判断，还要先治理协议边界：

- `mcpProtocol.ts:330-333` 对没有 `id` 的消息直接返回，`mcpProtocol.ts:685-697` 也没有把 `notifications/cancelled` 绑定到正在执行的操作；客户端取消或 stdio 超时后，服务端生成可能仍在后台继续。
- `mcpProtocol.ts:335-356` 会回显客户端传入的协议版本，没有明确的支持版本交集和 unsupported-version 路径。
- `mcpProtocol.ts:382-406` 把 `params.arguments` 直接 cast 成记录后调用 `tool.build`；工具目录里展示的 JSON Schema 不是统一的运行时校验边界。非法 JSON、缺失字段、未知字段和类型错误可能被吞掉或转成默认值。
- `mcpStdioServer.ts:294-315` 没有行长度上限，非法行处理、断连和 in-flight operation 取消也不完整。
- 付费确认、会话 trust、并发请求和 request registry 之间缺少明确的 challenge/request 绑定；两个首次付费请求可能同时进入确认路径。
- `rendererBridge.ts:51-62` 与 `preload.ts:602-620` 的 apply reply 主要按 id 路由，没有充分绑定 sender/frame/origin；这属于边界校验缺口，不应靠 UI 假设弥补。

这些问题的共同根因是：**标准 transport、请求生命周期、权限确认和 Nomi capability invocation 共处在一个手写协议处理器里**。因此正确顺序是先把 request registry、取消、schema 和 authority binding 列为 compatibility gate，再决定 SDK 是否接管 wire runtime；不能直接替换文件后再补测试。

### 3. IPC 有“系统边界不够严格”的通用风险

`electron/preload.ts:14-20` 封装了 `sendSync`；`119-129` 的项目列表/创建/读取/保存/删除使用同步 IPC；模型 catalog、skill 等区域在 `528-598` 仍有大量同步调用。另有大量 `payload: unknown` 的 bridge 方法。

这里的真实风险是 renderer 被主进程读写阻塞，以及边界缺少集中校验；不是 Electron 这个框架需要替换。迁移顺序必须是：只读 list/read → 非关键写入 → 关键写入/导入导出，并为每个 channel 保留错误、取消和旧快照兼容行为。

同一类边界问题还出现在 Browser bridge：`browserViews`/`browserViewBridges` 通过 console sentinel 接收网页消息。当前有 owner-window 检查，但页面仍可能伪造 URL、标题、prompt 或拖拽状态；应该把它当成不可信输入做严格 schema、大小限制、来源和一次性 gesture 绑定，而不是把网页 console 当作可信内部事件。

### 4. 3D 不属于“自研引擎”问题

项目已经使用 `@react-three/fiber`、`@react-three/drei` 和 `three`。`Scene3DFullscreen.tsx:578-586` 使用 `FencedCanvas`，且根据播放、录制和预览模式选择 `always` 或 `demand`；`scene3dCameraPreview.tsx:209-220` 有 demand 模式，但 `364-375` 的另一条捕获路径使用 always。

这类代码要做的是模式审计和 GPU/CPU profiling：确认 always 是否只在录制期间必要，轨迹曲线/TubeGeometry 是否重复创建，capture 后是否释放纹理、几何体和 renderer 资源。直接换 3D 框架会丢掉 Nomi 的姿势、轨迹、相机、录制和导出语义，收益不成立。

### 5. 已经用成熟库的区域不应重复迁移

- 白板通过 `WhiteboardLeaferCanvas.tsx` 和本地类型/操作层接入 Leafer。
- 富文本节点通过 `TextDocumentNode.tsx:16-20` 接入 Tiptap。
- 资产库通过 `AssetLibraryPanel.tsx:246-251` 使用 TanStack Virtual。
- filmstrip 已有共享 cache、监听和并发队列；本地媒体协议已经覆盖范围请求和路径安全。

这些区域的重点是验证 adapter 是否稳定、状态是否可恢复、异常是否可见，而不是继续寻找新的替代框架。

## 风险分级

### P0：先建边界，否则不能替换

- 画布 viewport/gesture 与 Nomi graph semantics 纠缠。
- 时间轴 playhead 与持久化 timeline 纠缠。
- 核心 store/session/controller 被多处静态 import，动态 import 不是隔离边界。
- MCP transport、取消、权限确认和 capability invocation 纠缠；在 request registry 和 authority binding 建好前不能切 SDK。

### P1：适合做替换验证

- MCP 协议层：官方 SDK compatibility spike。
- IPC：异步化和 schema contract 迁移。
- 测试基础设施：统一真实任务入口，保证迁移可观察。

### P2：以修复和 profiling 为主

- 3D render loop、曲线/几何体缓存、资源释放。
- filmstrip/cache/本地协议的大文件、取消和重试。

### 保护项：禁止被“通用化”吞掉

- 节点模型、边/分组语义、Agent 操作、额度/确认、ProductionRun、快照/replay、ffmpeg export manifest。

## 统一替换闸门

任何一个新基础实现必须同时满足：

1. **数据等价**：旧项目快照可读，保存后 schema、节点 ID、边、分组、时间轴和生产运行记录不发生无意变化。
2. **行为等价**：平移、缩放、框选、拖动、连线、分组、撤销；或对应模块的读写、确认、进度、取消、恢复行为逐项一致。
3. **性能目标**：交互任务在目标机器上维持 60Hz；120Hz 设备不能因主线程长任务或整树重渲染明显降级。时间轴播放不能每帧触发不相关面板更新。
4. **异常完整**：pointer cancel/blur/右键/中键、IPC 超时、断开、半写入、媒体范围错误、WebGL context loss 都有确定结果。
5. **业务不泄漏**：第三方库只出现在 adapter/infra 层；节点、Agent、额度、ProductionRun 不直接依赖第三方类型。
6. **可回滚**：新旧实现可在测试和开发环境切换；回滚不需要转换用户快照。
7. **真实任务通过**：至少跑一条从创建项目到持久化/导出的真实用户闭环，不只看单测和 demo。

## 不能作为替换依据的证据

- 只看 demo 顺滑。
- 只看单次 benchmark 或正负 delta 抵消测试。
- 只看单元测试全绿。
- 只看构建体积变化。
- 只把第三方类型换进业务层。
- 只用新框架重写一条 happy path，却没有旧快照、Agent 写入、撤销、错误和恢复测试。

## 建议顺序

1. 先做状态/模块边界和观测：画布 viewport、时间轴 playhead、MCP adapter、IPC contract。
2. 先修时间轴瞬时状态和 IPC 同步阻塞，这两项改动小、收益可测，能为画布迁移提供验证方法。
3. 并行做 MCP SDK compatibility spike，但不直接切生产。
4. 3D/媒体只做 profiling 和生命周期修复。
5. 最后基于同一套真实任务闸门决定画布 viewport 是否引入成熟内核；不满足就继续保留现有实现并缩小自研范围。
