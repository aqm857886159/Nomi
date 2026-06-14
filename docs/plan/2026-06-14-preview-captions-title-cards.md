# 预览区字幕 / 标题卡（独立叠加轨 + 烧进导出）

> 日期：2026-06-14　状态：实现中　单一真相源：本文件
> 触发：用户要"字幕和标题卡"，明确"在预览的那个地方做，不在生成画布"，且"预览和导出都要、烧进成品"。

## 1. 范围

| 做 | 不做（本切片） |
|---|---|
| 字幕（caption，下三分之一）| 转场（用户明确砍掉）|
| 标题卡（title，居中大字）| 逐字卡拉OK高亮（后续）|
| 在**预览标签**的时间轴加独立「文字轨」| 在**生成画布**底部那条时间轴加文字轨（用户明确不要）|
| 预览实时显示 + 编辑 | 富文本 / 多行自动排版 / 动画入场 |
| 烧进导出 MP4（含音频不丢）| 字幕样式预设库（先给 1 套默认）|

## 2. 不动什么

- 不碰生成画布（GenerationCanvas）任何文件。
- 不碰转场/音频/现有 image/video 轨的渲染与导出逻辑。
- 不引入新前端渲染引擎、不绑字体、不动 `TimelineClip`（image/video/audio）既有字段。

## 3. 架构决策（关键）

### 3.1 数据模型：文字 = 独立层，不挂生成节点
调研共识（designcombo `ICaption` / etro text layer）：字幕是**独立 item**，不是 clip 属性，也不绑 sourceNodeId。

```ts
// timelineTypes.ts 新增
export type TimelineTextStyle = 'caption' | 'title'
export type TimelineTextClip = {
  id: string
  text: string
  style: TimelineTextStyle
  startFrame: number
  endFrame: number
}
// TimelineState 新增独立字段（不塞进 tracks[]，因为它没有 sourceNodeId/url 心智）
textClips: TimelineTextClip[]
```

`TimelineState` 升 version 仍保持向后兼容：旧工程读出来 `textClips` 缺省为 `[]`（迁移在反序列化处补默认）。

### 3.2 渲染：单一布局规范模块，三处消费
新建 `src/workbench/timeline/textLayout.ts`——**唯一**计算「给定画布宽高 + style → 文字框几何 + 字号（相对单位）」。三处都 import 它，杜绝漂移：

1. **预览显示**：`TimelinePreview` 里 DOM 叠加层（`<div>`，便于中文 IME 编辑、清晰）。
2. **导出（主路 filtergraph）**：渲染进程按 `textLayout` 把每条 active 文字画到**透明 PNG**（离屏 canvas，导出分辨率）→ 经 IPC 落临时文件 → 主进程 filtergraph 用 `overlay=...:enable='between(t,start,end)'` 叠到 `[vout]` 链尾。**字幕像素 = canvas 绘制 = 与预览同源**。
3. **导出（回退 WebM）**：`drawTimelineFrame` 调用同一 `drawText`（复活现有死代码 `drawSubtitle`，改为吃 `textLayout`）。

> 为什么不用 FFmpeg `drawtext`：要绑 CJK 字体（10MB+）或依赖系统字体（不可移植）+ 转义地狱，且与预览是两套渲染器（漂移）。PNG overlay 用 Chromium 字体、单渲染器、不绑字体。

### 3.3 文字轨只在预览侧出现
`TimelinePanel` 同时被「生成画布底部」和「预览标签」复用。加 prop `showTextTrack?: boolean`，**仅** `PreviewWorkspace` 传 `true`。生成画布那侧不传 → 不渲染文字轨。

## 4. 切片与验收门

| 切片 | 内容 | 验收（真机/测试）|
|---|---|---|
| **S1 数据+预览显示** | 类型/store actions（add/update/remove/move text clip）+ 迁移默认 + `textLayout` + 预览 DOM 叠加层 | 真机：playhead 走到字幕区间，预览出现字幕/标题卡 |
| **S2 文字轨 UI** | 预览面板第三条「文字轨」+ 文字 clip 渲染/选中/拖动/删除 + 「+字幕」「+标题卡」入口 + 点击编辑文本 | 真机：能加、能改字、能拖时间、能删；生成画布底部**无**此轨 |
| **S3 导出烧进** | renderManifest 带 textClips 几何；渲染进程出 PNG；IPC；filtergraph overlay；WebM 回退 drawText | 真实导出 E2E：导出的 MP4 含字幕，且音频不丢；主进程埋点确认走 filtergraph |
| **S4 收尾** | 保真断言（design-fidelity）+ 几何遮挡检查 + 五门 | `tests/ux/design-fidelity` 绿；五门全过 |

## 5. token / 设计（R8）
- 字幕底卡：`--nomi-paper` 半透明 + `--nomi-line-soft` 描边，圆角 `--nomi-radius-md`，文字 `--nomi-ink`。
- 标题卡：居中，字号大（画布宽 ~6%），可选无底卡。
- 文字轨标签「文字轨」与现有「图片轨/媒体轨」同款；clip 用 `--nomi-accent` 弱色区分于媒体 clip。
- 全程 token-only，禁裸 px/hex；编辑态弹层走不裁剪锚（仿 SettingsPopover）。
- 先出 HTML mockup → 设计/用户 agent 审 → 落地后与 mockup 逐项对账。

## 6. 回滚
每切片独立 commit；S3 风险最高（主进程+IPC+ffmpeg），单独 commit，失败可只回退 S3 保留 S1/S2 预览能力。

## 6.5 执行结果（2026-06-14 回填）

- **S1/S2 预览侧**：真机走查通过——预览加标题卡+字幕、输入中文、显示在画面上；底部「文字轨」出现并带 clip；切「生成」画布底部时间轴**无**文字轨（截图 cap-04 确认）。
- **S3 导出**：真实导出 E2E 通过——预览加标题卡+字幕 → 导出 → 落盘 `exports/nomi-export-*.mp4`（1920×1080 h264 2.9s），ffmpeg 抽帧确认**文字烧进成品**。filtergraph PNG-overlay 链由单测锁定（`ffmpegFiltergraph.test.ts` 新增 2 例）；本次 E2E 走的是 WebM 回退路（纯文字无媒体），与 filtergraph 路共用同一 `drawTextBox`。
- **单测**：`timelineTextEdit.test.ts`（9 例：增改移裁删 + 迁移 + 区间筛 + 时长）全过；filtergraph overlay 2 例全过。
- **门**：check:filesize ✓ / lint:ci ✓(85<98) / build ✓。typecheck 与 test 当前红，**但仅因并行「conversation-history」会话的未提交破损 WIP**（`ConversationHistoryList.tsx` 引用未导出的 `ConvArea`；`aiConversationBuckets.test.ts` 2 例因其 store 改动失败）——与本功能无关，本功能文件零类型错。
- **提交阻塞**：`workbenchStore.ts` 同时含本功能改动与并行会话改动，且工作树被并行 WIP 弄红 → 无法干净提交，待协调。

## 7. 风险
- PNG IPC 体积：每条字幕一张导出分辨率 PNG（透明、稀疏），数量 = 文字 clip 数，可控；按 active 区间只生成实际用到的。
- filtergraph overlay 顺序：文字必须叠在所有视觉 clip **之后**（最上层）→ 接 `[vout]` 之后再 overlay。
- 字号跨「DOM 预览 ↔ canvas PNG」一致性：靠 `textLayout` 相对单位 + 同一 font-family 栈；S4 保真断言锁死。
