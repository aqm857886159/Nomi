# `nomi_get_run` 的结果要读 `structuredContent.nomiRunData`

> 📎 教训 · 首次记录 2026-08-25 · 状态：现行
> **触发场景**：headless 脚本 / 走查解析 MCP 工具结果时 `jobs` 恒空、轮询恒 `accepted=0`、最后超时 FAIL；或对 tool result 的 `content` 文本做 `JSON.parse` 得到 `null`。

**结论**：`nomi_get_run` / `nomi_get_artifact` / `nomi_start_playbook` / `nomi_subscribe_run` 的 tool result，**完整安全投影在 `structuredContent.nomiRunData`**（`mcpProtocol.buildToolResultPayload`，`electron/capabilityCore/mcpProtocol.ts` ~L160-172）。`content` 里的 text 是双语**人话转述**，不是 JSON（`JSON.parse` 恒 null）。`structuredContent` 顶层形状是 `{ nomiOutcome, nomiRun(widget 框架), nomiRunData(完整投影) }`。

脚本里这样取：

```js
const run = got.structured?.nomiRunData || got.json?.run || got.json;
```

**为什么会踩**：2026-08-25 一个付费验收脚本读的是 `got.json || got.structured` → `jobs` 恒空 → 轮询恒 `accepted=0` → 3 分钟假超时 FAIL，真金白银发出去的 run 被误判成失败（真相在 `run.json` 里：两个 job 已 accepted 且正被调度器活跃轮询）。这个假红烧掉了一轮真额度才定位——因为「读到了一个对象、只是里面没有 jobs」和「真的没有 jobs」在脚本里长得一模一样。

**怎么用**：

- 判断「调度器还活着吗」看 `jobs[].lastPollAt` 是否在走。
- 拿 `artifact.projectRelativePath` 拼项目根就能定位落地文件去 ffprobe；按 `j.metadata.shotId` 就能认领某一镜的 job——不必再 walk 猜文件名或按 status 数数。注意是**嵌套** `metadata.shotId`，**没有**扁平 `job.shotId`。

**2026-08-25 补（PR #164）：投影字段本身也曾缺两格，现已补上。** 当时把「读不到镜头 / 产物路径」整个记成了读法问题——只对一半：`jobs=0` 是读法坑，但 `job.metadata.shotId` 与 `artifact.projectRelativePath` 是真的没被投影出来。现在两格都发（`safeShotId` / `safeProjectRelativePath` 按值校验后外发，非法值省略）。

**出处**：2026-08-25 付费验收脚本假红；PR #164 补投影字段。相关：[走查断言必须有真信号](walkthrough-assertions-need-a-real-signal.md)、[断言前先证明你在你以为的现场](assert-you-are-in-the-situation-you-claim.md)。
