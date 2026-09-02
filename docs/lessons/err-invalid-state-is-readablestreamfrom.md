# `ERR_INVALID_STATE` 其实是 `ReadableStream.from`，不是 undici 的锅

> 📎 教训 · 首次记录 2026-08-24 · 状态：现行
> **触发场景**：崩溃栈里出现 `TypeError [ERR_INVALID_STATE]: Invalid state: ReadableStream is already closed`，且中间有一帧 `node:internal/deps/undici/undici:NNNN`（本例 `1465:28`）；或者有人提议「升 Electron / 升 Node 就能修」「只能加 uncaughtException 过滤器挡掉」。

**结论**：这条错误**不是** undici 的响应流拆除竞态，**升级修不掉**。根因是我们自己把 Node 流 / 异步可迭代当 body 塞进了 `new Response()` 或 `fetch(url, { body })`。修法是自己构造 `ReadableStream`，用一个同步置位的 `closed` 闸让 close 与 cancel 不可能互相竞争。

崩溃栈长这样（2026-08-24 Windows 用户回报，PR #125 曾想用 `uncaughtException` 过滤器挡掉）：

```
TypeError [ERR_INVALID_STATE]: Invalid state: ReadableStream is already closed
    at ReadableByteStreamController.close (node:internal/webstreams/readablestream:…)
    at node:internal/deps/undici/undici:1465:28      ← 这一帧是关键
    at node:internal/process/task_queues:…
```

**为什么会踩**：表象（undici 内部帧 + call site 捕不到）极容易被归成「上游 bug，只能等修 / 只能挡」，于是写出一个永久逃生口。实证结论四条：

1. `undici:1465` 那一帧是 **`ReadableStreamFrom`** 里的 `queueMicrotask(() => { controller.close() })`，**无任何保护**。
2. undici 里到达它的上游**只有一个**：`extractBody` 中 `typeof object[Symbol.asyncIterator] === "function"` 那个分支——也就是应用自己把 Node 流 / 异步可迭代当 body 传了进去。**不是**网络响应体那条（那条从 undici v6.0.0 起就有 `readableStreamClose()` 吞 "already closed"，是安全的）。
3. `cancel()` 只有 `return iterator.return()`，**不置任何关闭标记**，所以「in-flight 的 pull 解析出 done → 延迟 close 打在已关闭的 controller 上」是结构性竞态。抛点在 microtask 里，**call site 的 try/catch 一律接不住**，直接进 `uncaughtException`。
4. **升级无效**：逐版本读源码确认全无保护——6.19.8（Electron 31）、7.29.0（Electron 42/43）、8.10.0、`main` 全一样。在 Node 24.13.1 上稳定复现过。

**怎么用**：

- 见到这条栈，先 grep 全仓 `new Response(` 里收 Node 流的地方。本仓的两处在 `electron/protocol/localProtocol.ts` 的 `streamRange()` 与整文件分支。
- 修法：`cancel()` 里先 `closed = true` 再 destroy 底层流。验证基线：200 次 cancel-mid-flight 零抛，整文件读与区间读的字节数都对得上。
- **别顺手一起改** `new FormData()` 用内存 `Blob` 的路径——那走的是另一分支，不受影响。

**出处**：2026-08-24 Windows 用户崩溃回报；PR #125（被否的挡法）；计划文档 `docs/plan/2026-08-24-local-protocol-stream-ownership.md`。相关：[断言前先证明你在你以为的现场](assert-you-are-in-the-situation-you-claim.md)。
