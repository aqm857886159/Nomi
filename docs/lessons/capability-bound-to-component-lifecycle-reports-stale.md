# 能力绑在组件挂载生命周期上，「不存在」就会被说成「过期」

> 📎 教训 · 首次记录 2026-09-17 · 状态：✅ 已固化（`check:capability-lifecycle`，硬零）
> **触发场景**：某个 Agent/MCP 工具「时好时坏」，同一句话在两台机器/两条会话上结果相反；错误码是 `surface_port_stale` / `*_stale` 一族，而模型照建议重试永远撞同一句；或者你正准备在某个 `.tsx` 的 `useEffect` 里 `setXxxTools(api)` 把一份能力「发布」出去。

**结论**：一项 `renderer_required` 能力的 owner 必须是**已经拥有那份数据的会话层**（项目会话 store / 主进程），视图组件只能在挂载时做**增强覆盖**、卸载时退回基线；读方永远拿到一个端口，类型上写不出 `!tools`。`stale` 只能表示「目标身份换了」（切项目/切文档/前提过期）；「这个面现在做不了这件事」是 `capability_unsupported`——两句建议完全不同，前者「重读再试」，后者「换一个支持的做法」。熔断计数随下一条用户消息清零：用户动作是回合边界。

**为什么会踩**：`document.read` / `document.write` 的端口此前只由创作页 `WorkbenchEditor.tsx:208` 的 `useEffect` 发布到 `workbenchStore.creationDocumentTools`（默认 `null`）。真人默认冷启动落画布（`workbenchStore.ts:248` 初值 `generation`、切项目复位 `generation`），创作页从未挂载 → 字段恒 `null` → `NomiStudioApp.tsx:227` 的 `if (!tools || activeDocumentId !== documentId) throw 'surface_port_stale'` 把「从未注册」折进「陈旧」→ `surfacePortFailureAdvice` 兜底给模型的建议是 "Read the current surface again … before retrying" → 必然重试 → `laneHost` 连挂 3 次熔断，且熔断只认工具结果，用户照 Agent 的话去点开文稿页也救不回来（真机 `B03/B04/B05`）。而**一旦点过一次创作页它就常驻**（`WorkbenchShell.tsx` 的 `mountedWorkspaceModes` 只增不减），于是同一条会话像 flake：唯一变量是「这一程点没点过创作页」。普查 24 个契约，绑组件的只有这 2 项；但它们有 4 条消费路径（lane 读 / lane 写 / 外部 MCP / 应用内 apply）、3 个错误码（`surface_port_stale` / `document_target_stale` / `surface_port_unavailable`）、6 条真人路径共用这一个根。

**怎么用**：
- 加/改一份能力前先问：**它的数据住哪一层**？住 store/主进程的，端口就从那层派生（`src/workbench/project/documentSessionPort.ts` 是样板：`generateText` 用编辑器同一套 schema 从 `workbenchDocuments` 算正文，whole-document 写直接改 store，`overrideDocumentSessionPort()` 给编辑器覆盖）。
- 判 `stale` 之前先分清「没注册」和「换了目标」：前者是 `capability_unsupported`（或根本不该发生），后者才配「重读再试」。
- 复现「时好时坏」时先记录**这一程有没有打开过哪些视图**——那是常驻视图带来的隐藏变量。
- 门岗 `pnpm run check:capability-lifecycle` 会拦「执行路径读只由 `.tsx` useEffect 发布的 store 字段」；红了别去加 fallback，把 owner 上移。
- 同族另一轴：[长寿命对象不许揣短寿命名词当身份证](holder-must-not-keep-a-shorter-lived-noun.md)（#802 把**身份**绑到项目会话；本条把**能力**绑到项目会话）。

**出处**：批次 2 · J 块（integration/batch2-20260917）；根因合同 `docs/fixes/2026-09-17-document-capability-owner-project-session.root-cause.json`；真机复现与普查报告在派工现场 `~/Desktop/nomi-scratch-0917/batch2/`（`surface-port-stale-repro.md` / `capability-lifecycle-census.md`）。
