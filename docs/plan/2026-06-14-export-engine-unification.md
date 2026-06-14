# P0-5 导出引擎统一（所见即所得）执行文档

> 分支 `fix/export-engine`。对应审计 `docs/audit/2026-06-14-ultra-deep-mechanism-audit.md` 的 P0-5，
> 修复计划 `docs/plan/2026-06-14-ultra-audit-remediation.md` 相6。架构决策（ffmpeg 为主）已由用户拍板。

## 根因（两条）

1. **取景不进 TimelineState**：预览的 `fitMode`/`mediaScale`/`mediaOffset` 是 `TimelinePreview` 组件局部
   `useState`（[TimelinePreview.tsx:114-116](src/workbench/preview/TimelinePreview.tsx)），从不写进 `TimelineState`
   → 导出两条后端都拿不到 → 预览调好的构图永不进成片。
2. **三套引擎视觉算法各不相同**：
   - 预览（DOM/CSS）：`object-fit` contain/cover + transform scale/translate，背景 `--nomi-paper`（纯白 oklch(1 0 0)）。
   - WebM canvas：写死 cover 裁满（`drawCoverImage` `Math.max`），背景 `#f4f3ef`。
   - filtergraph：写死 `force_original_aspect_ratio=decrease + pad color=black` letterbox，背景黑。
   走哪条后端取决于「资产能否本地解析」→ 同项目今天黑边明天裁满，不可预测。

## 目标

**预览什么样，导出就什么样。** 取景成为 `TimelineState` 的一等数据（per-clip），三处渲染用同一套
取景公式（contain/cover 基准 fit × 缩放 × 平移，白底），导出统一走 ffmpeg filtergraph 主路径，
WebM-canvas 仅在「资产无法本地解析」时降级；删掉「总是先录 WebM 再可能丢弃」的并行版。

## 取景数据模型（单一公式，三处实现）

`ClipFraming = { fit: 'contain'|'cover', scale: number, offsetX: number, offsetY: number }`
- `offsetX/offsetY` = **帧宽/高的归一化分数**（不是像素！预览 stage 尺寸 ≠ 导出分辨率，钉死像素会跨分辨率漂移）。
- 公式：源 `sw×sh` 进帧 `W×H`：`factor = (fit==contain? min(W/sw,H/sh) : max(W/sw,H/sh)) * scale`；
  缩放后 `w=sw*factor, h=sh*factor`；位置 `x=(W-w)/2 + offsetX*W, y=(H-h)/2 + offsetY*H`；超出帧自动裁切。
- 三处实现，数学等价（已用真 ffmpeg 验证几何一致）：
  - **预览**：CSS `object-fit` + `transform: translate(px) scale()`（px = frac × stageSize，读写时换算）。
  - **WebM canvas**：`computeFramedRect()` 数值计算 + `drawImage`。
  - **filtergraph**：ffmpeg 运行期表达式 `scale=w='F*iw':h='F*ih'` + `overlay=x='(main_w-overlay_w)/2+ox*main_w':y=...`，白底 `color=white`。

## 改动清单（TDD）

| # | 文件 | 改动 | 测试 |
|---|---|---|---|
| 1 | `timeline/clipFraming.ts`（新） | `ClipFraming` 类型 + `DEFAULT_CLIP_FRAMING` + `resolveClipFraming` + `computeFramedRect` + `clampFramingScale` | `clipFraming.test.ts`（新）：公式纯逻辑 |
| 2 | `timeline/timelineTypes.ts` | `TimelineClip.framing?: ClipFraming` | — |
| 3 | `timeline/timelineClipEdit.ts`（新） | `setClipFraming(timeline, clipId, patch)` 纯函数 | `timelineClipEdit.test.ts`（新） |
| 4 | `workbenchStore.ts`（最小） | mutator `setTimelineClipFraming(clipId, patch, {commit})` 委托 #3 | — |
| 5 | `preview/TimelinePreview.tsx` | 取景控件读写 active media clip 的 framing（px↔frac 换算，拖动 transient + 落定 commit）；删局部 useState | — |
| 6 | `export/exportTypes.ts` | `RendererRenderClip.transform?: {...}` | — |
| 7 | `export/renderManifest.ts` | `buildClip` 把非默认 framing 写进 `transform` | `renderManifest.test.ts`：携带 framing |
| 8 | `export/timelineWebmExport.ts` | `drawCoverImage`→`drawFramedMedia`（用 #1 公式 + clip.framing）；默认背景白 | — |
| 9 | `electron/export/ffmpegFiltergraph.ts` | `buildVisualGraph`：白底 + 参数化 scale/overlay（读 clip.transform，默认 contain），删 decrease+pad black；format 收口到链尾一次 | `ffmpegFiltergraph.test.ts`：改断言为新图 |
| 10 | `electron/export/exportJobs.ts` | `startExportJob` 前置决定 backend（filtergraph 计划 build 成功→stash，否则 webm）；返回 `{jobId, backend}`；`finishExportTempInput` 用 stash 计划，无则转码 webm | `exportJobs`/ipc 相关测试更新 |
| 11 | `export/exportApi.ts` | startJob 拿 backend：filtergraph→不录 WebM 直接 finish；webm→录+上传+finish | `exportApi.test.ts`：两分支 |
| 12 | `src/desktop/bridge.ts` + `electron/preload.ts` | startJob 返回类型加 `backend`（薄改） | — |

## 不动什么

- 时间轴时间数学、文字 clip 变换、吸附、分组（与取景无关）。
- 字幕折行「CSS vs greedy」不一致（审计 #6，P2）——本轮不收口，留后续（注：filtergraph 文字走 renderer 渲的 PNG，
  与预览 DOM 折行仍可能不同；记入后续 backlog）。
- 持久化 schema：framing 跟随 timeline 落盘若被 normalize 吃掉，记后续（不破坏，仅当次会话内 WYSIWYG）。

## 回滚

单分支多 commit；任一 commit 可 `git revert`。filtergraph 改动有 `ffmpegFiltergraph.test.ts` 锁；
backend 决策改动有 `exportApi.test.ts`/`exportJobs` 测试锁。

## 验收门

1. 五门：`check:filesize && lint:ci && typecheck && test && build` 全绿。
2. **真 ffmpeg 真实导出**（P0 保真，测试绿≠完成）：拿一个有素材的项目，预览里调 contain/cover/缩放/平移，
   导出 MP4，肉眼对比「预览构图 == 成片构图」（取景、缩放、背景白、字幕位置一致）。
3. 验证「资产无法本地解析」时仍能经 WebM 降级导出，且降级输出也用同一套取景白底。

## 执行结果（2026-06-14）

**已完成全部 6 个切片**（TDD，逐项绿）：
1. `clipFraming.ts` 取景公式 + 测试（9）。
2. `TimelineClip.framing` 字段 + `setClipFraming`（timelineEdit）+ 测试（5）+ store mutator + normalize 落盘（切项目不蒸发）。
3. `TimelinePreview` 取景控件读写 store framing（px↔frac，拖动 transient + 落定 commit）；抽 `previewMediaFraming.ts` 守 800 行门岗。
4. manifest 携带 framing（`RendererRenderClip.transform`，仅非默认）+ 测试；WebM canvas `drawFramedMedia` 同公式 + 白底。
5. filtergraph 参数化取景（白底 + `scale=w='F*iw'` + `overlay` 居中偏移，删 `decrease+pad black`，format 收口链尾）+ 测试改写。
6. 删 WebM 并行版：`startExportJob` 前置决定 backend（filtergraph 计划编译成功→主路径，否则 webm 降级）；renderer 按 backend 决定是否录 WebM；`finishExportTempInput` 用 stash 计划。

**五门**：check:filesize ✓ / lint:ci ✓（0 error）/ typecheck ✓ / test ✓（1286）/ build ✓。

**真 ffmpeg 真实导出**：用真实 `compileFfmpegFiltergraph` 编译器 + 真 ffmpeg 渲染 1000×800 源进 1920×1080：
- contain 默认 → 居中 + 左右白边；cover → 铺满裁上下；contain scale1.4/offset(0.18,-0.12) → 放大 + 右移上移。
  三者几何与预览 CSS（object-fit + transform）逐项一致，背景白，输出 yuv420p 合法 mp4。✅

**仍欠（建议补）**：live-app R13 走查——真机拖动预览取景 → 导出 → 肉眼对比成片（引擎与接线已分别证实，此为端到端 UX 终验）。
字幕折行「CSS vs greedy」不一致（审计 #6，P2）未收口，记后续 backlog。
