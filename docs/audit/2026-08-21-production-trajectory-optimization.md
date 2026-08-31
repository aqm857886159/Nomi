# 2026-08-21 Production Run 轨迹审查与吞吐优化

## 结论

本轮最主要的慢，不是 MCP 通信，也不是用户审批，而是生成驱动器过去把所有 provider job 串行提交：6 个 Seedance 镜头，每个通常等待 1–3 分钟，最坏就是 6–18 分钟，再叠加参考图、QA、粗剪和导出。

现在改成“依赖感知的有界并发”：用户可以选择 1、2、3、4 或 6；默认仍为 1。并发只作用于互不依赖的任务，首个样片仍单任务，带 `previousShotId` 的镜头仍按上一镜 adopted 后再提交。这样速度是可调的，但连续性和预算边界不会被速度设置破坏。

## 一条真实轨迹中，哪里花时间

| 阶段 | 原来的摩擦 | 本轮处理 | 用户现在看到的变化 |
|---|---|---|---|
| 方向/剧本/分镜 | provider 文本模型 503 时只在 Nomi 日志里重试，Agent 只能一直等 | 失败写成 durable `needs_attention`，带可重试原因；外部 Agent 可直接 propose/review | 不再“看起来还在等”，会明确告诉用户下一步 |
| 资产与镜头生成 | 所有 job 串行 | 有界并发 wave；依赖未满足的镜头自动排队 | 选 2–3 后独立任务同时跑，连续镜头仍按顺序 |
| 审批 | Agent 和 Nomi 两边重复确认 | 正常流程统一 MCP elicitation；Nomi DOM 只保留显式接管 | 用户留在 Claude/Codex/WorkBuddy，不必来回切换 |
| provider 轮询 | 网络抖动可能丢掉 providerTaskId，误判成不存在 | recoverable envelope 保留 taskId；`nomi_reconcile_job` 在 Agent 内确认并重试轮询 | 找到原任务就继续跟踪，不重复提交 |
| MCP 读取状态 | 每次 `get_run` 都可能触发恢复扫描，把正在 submitting 的任务误标未知 | in-flight guard；活跃 driver 不被恢复逻辑打断 | 高频观察不会改变任务状态 |
| arrange→export | 导出读取旧的 Zustand timeline，真实媒体为空或时长错 | arrange 后写 durable timeline artifact，export 只读该 artifact | 生产 Run 与导出使用同一份时间轴 |
| 转场/边界 | metadata 有转场但像素仍是硬切；短视频流造成白帧 | 兼容 FFmpeg 4.4 的 alpha overlay、fps 对齐、tpad、整数帧窗口 | 转场进入真实像素；边界不再靠 metadata 假装通过 |

## 并发策略为什么不是“越大越快”

并发是 provider 的同时在途请求数，不是把一个连续镜头拆开乱跑。调度器先做三层判断：

1. 参考卡必须先 adopted；
2. 有 `previousShotId` 的镜头必须等待上一镜 adopted；
3. 每一波先持久化 submit intent，再发请求，结果逐个回写。

因此，6 个镜头如果全都引用上一镜，`maxConcurrentJobs=6` 也不会强行并发；这不是没生效，而是为了不让尾帧/状态断掉。真正能提速的是角色卡、场景卡、互不依赖的镜头。

推荐档位：

- `1`：最稳，适合第一次生成、provider 不稳定或预算紧张；
- `2–3`：默认推荐，通常能明显降低等待，同时不容易撞供应商限流；
- `4–6`：只适合已确认 provider 稳定、预算充足的批量试错。

用户可在 Nomi「设置 → 自动化 → 同时提交的生成任务」调整，也可在外部 Agent 调用：

```text
nomi_control_run({ action: "set_concurrency", maxConcurrentJobs: 3 })
```

它只影响尚未提交的下一波，不会撤回、复制或强行改变已经在 provider 中运行的任务。

## 还保留的安全闸

- 首个样片仍是一任务一确认，避免一上来同时烧完整预算；
- `confirm_all` 仍按镜头确认，`budget_only` 才会跳过创意/样片确认，但预算闸仍在；
- provider 网络失败不会自动重提；必须通过带原 `providerTaskId` 的 reconcile 决策；
- 粗剪和导出合并为一次 Agent 内的最终确认，不在 Nomi 再重复点一次；
- 所有 artifact、job、节点、抽帧、音频与根因迭代仍写入项目，外部 Agent 关闭后可在 Nomi 项目中恢复。

## 下一轮应继续观察的指标

不要只看“总耗时”。每次真实 Run 记录：

- `provider_submit_to_adopt_ms`：每个模型实际等待时间；
- `wave_width` / `effective_concurrency`：设置的并发与实际生效并发；
- `dependency_block_ms`：因上一镜/参考卡等待的时间；
- `provider_retry_count` 与 `providerTaskId` 保留率；
- `approval_wait_ms`：用户审阅耗时，和系统耗时分开；
- `timeline_duration/video_duration/audio_duration/subtitle_duration`；
- 所有切点的边界帧亮度、白帧计数、音频 silence ratio；
- 失败镜头的 retry lineage，确保重试是定向的而不是整片重生。

## 仍未宣称完成的质量项

技术合同通过（类型检查、构建、定向测试、真实 MCP 审阅与真实 provider 任务均有证据），不等于故事质量自动通过。真实成片还必须人工看 contact sheet 和边界帧：角色/场景连续性、结尾是否回扣开头、字幕是否遮挡主体、转场是否真的可辨认、声音是否只是环境声而不是空轨。只有这些证据都满足，才把 Run 标成“质量通过”。
