# 真实视频到导出与重启恢复走查计划

> 状态：🚧 进行中

## 目标

在已经通过的 `agent-runtime-production.walk.mjs` 五阶段之后，补一条独立的真实 Electron 旅程：

1. 通过真实画布/模型映射请求生成一个可播放的视频片段；
2. 将生成片段放入时间轴，确认预览 `<video>` 的媒体时长和播放进度来自该片段；
3. 通过真实导出入口生成 MP4，并用 `ffprobe` 检查视频流、时长和文件字节；
4. 关闭并重新打开同一个隔离项目，确认视频资产、时间轴、导出状态以及 revision/receipt 仍从持久化项目恢复。

这条覆盖使用本地 loopback provider 作为受控传输边界，但 provider 返回真实 MP4 字节和真实文件 URL；它不能被标记为付费厂商 live 证明，也不能用占位 URL、假视频或修改 runner 断言代替产品行为。

## 已有证据与缺口

- `tests/ux/agent-runtime-production.walk.mjs` 已证明 canonical planner、审批、真实图片生成、judge 偏差卡、方向选择和剧本 artifact 的五阶段链路，当前 run `run-a14d3202-c79d-47aa-b029-6324c5b3f421` 通过，`paidCalls=0`。
- `tests/ux/canvas-batch-production.walk.mjs` 已有真实模型目录和视频模型 mapping，但 loopback server 目前只实现图片接口；视频节点只覆盖模型选择，尚未覆盖视频响应落盘、播放或导出。
- `tests/ux/video-ops.walk.mjs` 能导入真实 MP4、校验 `<video>` 时长并拖到时间轴，但不覆盖生成产物、导出或冷重启。
- `tests/ux/audio-timeline.walk.mjs` 已证明时间轴预览和 ffmpeg 导出入口能产生带 AAC 的 MP4，不过输入是导入音频，不能证明生成视频片段进入同一闭环。

## 独立覆盖设计

新增 `tests/ux/agent-runtime-video-export.walk.mjs`，不改变五阶段 runner 的断言或语义。走查保存：

- provider wire request（模型、prompt、参考/比例参数）及 loopback paid-call 计数；
- 返回 MP4 的字节数、`ffprobe` 视频流、时长和 `nomi-local` 项目资产路径；
- 生成节点、时间轴 clip、预览播放截图；
- 导出 MP4 的字节数、`ffprobe` 视频流和输出路径；
- 项目 `revision`、生成 receipt/任务状态、cold restart 前后同一 projectId 的读取结果；
- 每个阶段的 screenshot 和 JSON report。

测试只把 loopback provider 当作可重复的 HTTP 传输夹具，明确报告 `evidenceState=loopback`、`paidCalls=0`，不把它冒充外部供应商 live 认证。若真实产品边界不能承接视频 response、项目资产或时间轴恢复，修最早共享边界并补回归测试；不在 runner 中注入状态或放宽断言。

## 验收门

- 计划覆盖的四段均有真实 UI 交互与可检查产物；没有只靠截图或 DOM 计数的假通过。
- 生成和导出的 MP4 均能由 `ffprobe` 读到视频流、正时长和非零字节；预览 `<video>` 的 `currentTime` 在播放后推进。
- 关闭/重启后从项目存储读回同一个视频资产、时间轴 clip 和 receipt/revision；若任一项丢失，报告真实持久化边界并先修复再报完成。
- `pnpm run typecheck`、相关 focused tests、`pnpm run build` 和独立 walk 全部通过；旧 runner 的严格断言保持不变。
