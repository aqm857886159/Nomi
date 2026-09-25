# 项目会话身份与动作通道

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：已实现、本地验证通过，交主代理集成验证；父任务 2026-09-17 用户批准完整修复并合入。基线 ea821891039e6a40ffe2f6c8b63798875fac33a5（802 集成及 A 错误协议）。独立 clone Nomi-pr802-session / fix/pr802-project-session-20260917；只交本地提交给主代理。

## 不变量与最小范围

长期身份由 main 签发，绑定可信窗口 owner、完整 ProjectBinding 和 root digest。每次动作才抓当前 transport；lane、七个 adapter 工厂、十个 invocation 工厂和九类 renderer execution target 不得持有 CapturedCanvasReadPort。CanvasWritePort 也不许作为长期 factory 输入冻结。

registry 私有 WeakMap 持有 ProjectSurfaceSession；稳定 sessionId 作为 renderer authorityRef。open/resolve/assert owner/capture/revoke 都由 registry 或可信 IPC 边界拥有，不接受 renderer 自报 windowId。会话在显式 close、项目 A 切 B、reload/crash/destroy 时永久撤销；A→B→A 不复活旧审批。单纯页面切换保持身份。reload 后开新 session 恢复历史，旧动作仍拒绝。

生产 API：surfaceCapture.openProjectSession(event,binding)、assertProjectSession(event,session)；registry.resolveProjectSession(session) 同步返回稳定 binding/sessionId/root/signal；captureProjectSessionPort(session) 返回一次 action capture。assets publication 可在副作用前后同步校验原 session。

删旧：lastEvent/currentEvent、lane liveShared/withLive 包装、global liveCapturedWritePort/liveRendererWriteEvidence、sameEvidence 对 renderer 放宽特例；删除同 pathname 推断 same-document 的导航例外。真正 same-document 只依据 Electron isSameDocument。底层请求仍保留 epoch/精确 binding 回包校验。

显式 CapturedCanvasReadSnapshotPort 保持固定字节/一次消费语义。MCP project target 保留 live-or-disk read 和原主进程写路径。继续拒绝第二个活动窗口，不新增多窗口产品能力。

## 先查别人和对抗

- 继承 [PR 802 一手依据与反方报告](../research/2026-09-17-pr802/prior-art.md)，不重复创建新的全局项目选择权。
- [Electron 官方 did-start-navigation](https://www.electronjs.org/docs/latest/api/web-contents#event-did-start-navigation) 的 isSameDocument 是文档替换信号；同 URL reload 不是 same-document。
- [既有 owner registry](../../electron/capabilityCore/canvasReadSurfaceRegistry.ts) 已拥有可信 WebContents/frame 认证，不另造 authority。
- [generation lease owner](../../electron/capabilityCore/residentGenerationAdapterFactory.ts) 与 [ProductionRun 提交边界](../../electron/capabilityCore/mcpSemanticBatchStart.ts) 拥有后台任务，lane close 不应取消已提交 Run。

六角色复核：架构要求寿命按 session/action 分开；后端要求永久撤销和窗口边界；前端要求切页不重开；PM 要求切项目停交互、后台任务留原项目；设计要求无需让用户理解 token；真实用户要求切页、审批、重启完整旅程。独立只读 session_census 数门和对抗已先行，交付由主代理独立验收。

## 门表与验收

实施前机器数门：CapturedCanvasReadPort 47 个读引用；captureCommittedCanvasReadPort 9 个调用（lane runtime 四处、lane tools、execution runtime、port resolver、IPC、renderer factories 各一处）。合同在实现后重新生成当前门表。

红测试先覆盖新 registry 的同项目更新、A→B→A、错误 owner/伪造身份、撤销和协议工厂类型。绿测试覆盖全部读写类型、prepare 后切页成功、revision/actionHash 不弱化、prepare/审批时切项目拒绝、同 URL reload/crash/destroy、跨窗不重定向。保持快照和 MCP 回归。lane close 取消审批，但已提交生成继续。

typecheck、相关单测、根因合同和门岗由本任务跑；真实 Electron/Linux/macOS 旅程、整体 contracts/构建/交付由主代理集成 A+B 后执行。

本地证据：新 session 最小四例先全红后全绿；dispatch 后 revoke 的取消反例先红后绿；reload/crash/destroy listener 清理三例先红后绿。最终 21 个相关套件 189 通过、1 个原有 C9 skip。36 个 session 测试覆盖十个 factory 的生产 executor→真实 surface IPC 请求构造与回包验证（只替换 Electron 总线）、同项目 transport 更新、跨项目/跨窗不复活、审批 hash不放宽、异步身份读取期间换项目、发出请求后撤销。真实 lane pending审批关闭无文件写入、已提交 ProductionRun 的 scheduler 在旧项目继续。typecheck、check:test-types、根因合同、门表、先查别人、main-console、filesize、transport-assembly 通过。

追加最早边界：session action capture 携带撤销信号；surfacePort 将其与原请求取消信号合并，close 当刻发送既有 cancellation IPC，不等待最终回包才发现身份已撤销。未改背景 ProductionRun 或显式 snapshot 信号。

## 回滚和预算

无持久化迁移或用户文件删除。逻辑单元 scoped commit，可 revert；不引入旧 API fallback。预计 ≤50 文件/1800 行，若关联测试和静态合同迁移超预算向主代理说明，不缩减隔离覆盖。
