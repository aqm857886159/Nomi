# 视频拆解全部失败：根因诊断（2026-09-12）

## 现象

用户看到每个镜头每格“没读出”，并出现 `0.0333333s`。代码路径是 `deconstructVideo`：本地切点→抽帧→多模态任务→JSON 解析；失败镜头被标 `visionFailed`，UI 用 `shotTable.unread`。

## 静默吞错门

|位置|吞的是什么|用户看到|
|---|---|---|
|`deconstructVideo.ts:156`|音轨/ffmpeg/下载异常|对白为空，画面仍继续|
|`deconstructVideo.ts:185`|转写或供应商异常|对白为空|
|`deconstructVideo.ts:134-140`|raw 非 `choices[0].message.content`|画面整格“没读出”|
|`deconstructVideo.ts:237-243`（诊断日志已加）|任一帧抽取异常|该镜全空、“没读出”|
|`deconstructVideo.ts:260-262`（诊断日志已加）|VLM 请求/解析异常|该镜全空、“没读出”|
|`detectShotCuts.ts:159`、`extractVideoFrame.ts:69,156,234,321`|临时文件清理异常|用户无感，非根因|
|`depthVideo*`|深度视频支线异常|本功能无关|

## 复现与证据

依赖已安装（含提交钩子）。用现有 UX 启动方式：`pnpm run build && APIMART_API_KEY=… node tests/ux/deconstruction-panel.walk.mjs`；测试会隔离 Electron profile、导入 fixture、点击“拆解”。本次先跑零成本 ffmpeg：

```text
fixture: tests/ux/fixtures/real-shot-640x360.mp4
ffprobe: duration=5.000000, r_frame_rate=30/1
select(scene>0.1): code=0, stdout 无切点（No filtered frames）
```

因此该 fixture 会形成一个 0–5s 镜头；抽帧输入有效，未见 ffmpeg 异常。未执行 APIMart 真模型调用（避免在未能提供隔离 key 注入时盲烧额度）。

## 三候选判定

- **A 抽帧抛错：未坐实。** ffmpeg/ffprobe 对真实 fixture 成功，且 `extractVideoFrameToAsset` 会把具体 stderr 放进异常；用户机仍需 `[deconstruct:frame-failed]` 日志区分打包版 ffmpeg 路径、素材反解或解码失败。
- **B 返回体解析不到：最可疑、与“全部镜头全空”最匹配。** `textFromTaskResult` 只接受 OpenAI choices 形状；APIMart/模型适配器若返回 SDK `content`、字符串或空 choices，全部镜头静默变空。
- **C 截断：可能但证据不足。** 注释明确 `maxTokens=4000` 为思考模型保留；若 `finishReason=length`，当前解析可能拿到空正文。需记录 finish reason 与 raw 结构确认。

本次尝试按用户指定注入 APIMart key，并将 `real-shot-640x360.mp4` 作为 walk 脚本 fixture（临时替换其固定 fixture，运行后已恢复）。真实模型调用未能开始：走查在点击拆解前的面板基线探针失败（`data-deconstruct-panel=<nodeId>` 计数为 0），因此没有产生 raw/choices/finishReason 或 `[deconstruct:model-failed]` 日志，也没有发生 APIMart 计费。该失败属于测试宿主/选择器与当前构建不一致，不能用来支持 B 或 C。故 B、C 均**未坐实，无法排除**；现有静态证据仍只允许保留“B 最可疑、C 次之”的暂定排序。

## 秒数 0.0333333

视频 30 fps，帧间隔 `1 / 30 = 0.0333333s`。`detectShotCuts` 的 `select(scene>0.1)` 可产生首帧/近首帧切点；`shotTimeline.buildShotBoundaries` 仅过滤 `s > 0.01`，所以 1 帧伪切点被放行，形成极短镜头。阈值应由抽帧步长与帧率派生：`minShot = max(frameStepSeconds, 1 / fps)`，切点须满足 `s >= minShot` 且与前一切点间隔至少 `minShot`；不得写死常量。

## 建议

- **P1，一行级修法：** 两个画面 catch 保留失败镜头但上报结构化原因；`textFromTaskResult` 失败时记录 raw keys、provider/model、finishReason；UI 顶部显示失败原因与可重试入口。
- **P2，B10 卡：** 统一 APIMart 响应适配契约（覆盖 choices/content/finishReason），并补打包版 ffmpeg 路径与模型图片能力诊断；按 fps/抽帧步长派生切点阈值。

下次复现必须导出：`[deconstruct:frame-failed]`、`[deconstruct:model-failed]` 完整脱敏消息；vendor/modelKey；raw 顶层 keys、choices 类型/长度；finishReason；resolveFfmpegPath 返回路径及文件存在/可执行状态。禁止记录 API key、图片 base64 或完整提示词。
