# Asset publication identity

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

## 先查别人

- [独立反方报告及已读官方依据](../research/2026-09-17-pr802/prior-art.md)：保留已有项目存储，身份与 UI 落点分离。
- [既有项目 identity owner](../../electron/workspace/workspaceProjectIdentity.ts)：复用 immutableProjectUuid/projectGeneration，不新增身份格式。
- [既有 manifest 同步事务](../../electron/workspace/workspaceManifest.ts)：沿用当前读校验入口，让 publication 前的身份检查与同步发布之间没有应用事件循环等待。

本次是内部持久化不变量修复；未用 TikHub，未将社区推测当成文件系统竞态证据。

## 实施与验收

Remote 同类入口补查：clipboard 的下载路径同样跨 await。`importRemoteAsset` 在下载前捕获同一 AssetWriteContext，data/http/generated/upload 均把 context 交给既有 writeAsset；显式后台导入保持原项目，交互 IPC 同步捕获可信 session。三条真实磁盘反例证明旧实现会在下载期间身份替换/撤销后继续发布，补修后零发布。远程 IPC 复用统一结果 DTO，所有 renderer 消费者统一 unwrap。

Approved PR 802 follow-up, base 22b046e7b. Prior art: [independent review](../research/2026-09-17-pr802/prior-art.md). Owner review found that importer checks precede asynchronous deduplication/native copying; publication resolves the project directory again.

Capture a full project identity and canonical root before asynchronous storage work. Every upload entry captures this context, including direct byte/native callers. Carry it through publication, reuse, and metadata updates. Validate the same root and manifest identity synchronously at the final write boundary; never redirect to a newly resolved root. An optional main-only interaction assertion tightens this mandatory storage invariant and is supplied by the trusted window session at IPC integration. Explicit background project IO survives UI navigation; uncommitted interactive IO is revoked on project replacement.

Remove the importer-only identity check and dynamic target lookup from upload publication. Preserve synchronous generated writes. Deduplicate filesystem publication, not caller authorization: each caller checks its own context before returning a reused result. Metadata cache updates use a checked synchronous atomic rename so cancellation cannot land between check and publication.

Red tests pause actual filesystem lookup, replace identity/root or cancel, then resume and assert zero publication/metadata change; cover byte/native/dedup reuse. Verify all five artifact formats plus unknown-format and disk-capacity rejection through real import IO. Existing dedup and asset-store tests remain required. No migration or deletion of user assets; revert this scoped commit to roll back. External filesystem writers are outside the Electron event-loop transaction; snapshot validation does not claim an OS-wide filesystem lock.

Cross-pool review follow-up: validate identity through the existing read-only manifest snapshot instead of acquiring an exclusive mutation lock on every assertion. An identity snapshot that cannot be validated still rejects; no Busy retry or identity bypass. Keep assertion before publication and reuse, while DTO construction after publication is pure. Bind non-upload placement to context.root whenever a context exists. Hash-cache metadata is an optional optimization: its IO failure must not reject valid bytes or reuse; stale identity/cancellation assertions remain outside that best-effort write. Red regressions hold a real manifest lock during lookup, deny the optional metadata rename, and revoke interaction authority in the publication notification. Native and byte cancellation both remain covered.
