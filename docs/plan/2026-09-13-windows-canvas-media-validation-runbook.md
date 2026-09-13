# Windows 画布媒体性能实机验收 Runbook

## 目的

验证 Windows Electron 在真实 4K/10-bit HEVC 与高分辨率图片项目中的打开、按需加载和拖拽边界。Windows 收据必须来自真实设备，不能用 macOS 或 Wine 替代。

## 设备矩阵

至少记录三种配置：

| 配置 | 系统条件 | 目的 |
|---|---|---|
| W-NVIDIA | Windows 11、NVIDIA 独显、最新驱动、硬件加速开 | 主流创作机硬解路径 |
| W-IGPU | Windows 11、Intel/AMD 核显、硬件加速开 | 普通办公机路径 |
| W-SW | Windows 11、无 HEVC Extension 或硬件加速关 | 失败/代理回退路径 |

每台机器记录 Windows 版本、Electron 版本、GPU、驱动、HEVC Extension 是否安装、硬件加速状态和屏幕刷新率。

## 素材与命令

使用同一组真实素材：4 张高分辨率图片和 `9月12日(1).mov`（3840×2160、10-bit HEVC、30fps、527 秒）。将素材放入 Windows 本地目录后运行：

```powershell
$env:NOMI_CANVAS_PERF_REAL_ASSET_DIR = "C:\NomiPerf\real-assets"
$env:NOMI_CANVAS_PERF_CANVAS_ONLY = "1"
pnpm exec node tests/ux/canvas-performance-benchmark.e2e.mjs windows-real-media-s --scale S --scenario node-drag-video --runs 3 --warmup 1
pnpm exec node tests/ux/canvas-performance-benchmark.e2e.mjs windows-real-media-m --scale M --scenario node-drag-video --runs 3 --warmup 1
pnpm exec node tests/ux/canvas-performance-benchmark.e2e.mjs windows-real-media-l --scale L --scenario node-drag-video --runs 3 --warmup 1
pnpm exec node tests/ux/canvas-performance-benchmark.e2e.mjs windows-real-media-xl --scale XL --scenario node-drag-video --runs 3 --warmup 1
```

另跑 `cold-open`、`video-hover`、`media-error` 和 `drag-at-low-zoom`。每个场景保留 JSON 收据和一张真实 Electron 截图。

## 必填收据

- 首次画布时间、媒体稳定时间。
- `maxLoadingImages`、`maxLoadingVideos`、`maxActiveVideos`。
- 帧间隔 P95/P99、长任务数量与最大时长、首次反馈。
- HEVC `loadedmetadata`/`canplay`/error code；是否走 poster 或代理。
- GPU 加速状态、renderer heap、视频节点数。
- 单媒体错误后项目是否仍可打开、重试是否局部生效。

## 判定

- 所有规模先进入可交互画布；单个媒体失败不得阻塞项目。
- 视频按用户意图激活，`maxActiveVideos <= 1`。
- 普通/低缩放拖拽 P95 帧间隔目标 ≤16.7ms；任何持续性 100ms+ 长任务都失败。
- 任何 Windows 配置未跑完，都只标记为 `UNVERIFIED`，不能借用 macOS 收据。

## 先查别人

- 依赖里已有：Electron/Chromium 原生 `<img>`、`<video>` 的 `preload`, `poster`, `currentSrc` 和 Playwright Electron 旅程能力；本仓库 `tests/ux/canvas-performance-benchmark.e2e.mjs:935-1000` 已复用这些接口，不另造媒体播放器。
- 仓库里已有：`src/workbench/generationCanvas/nodes/DeferredNodeMedia.tsx` 负责媒体队列，`NodeVideoPlaybackGuard.tsx` 负责视频意图激活，`NodeMediaPreviewDialog.tsx` 负责原图预览；runbook 只验证这些共享边界。
- 生态里已有：Electron 官方文档说明 Chromium 媒体能力随平台编解码器和硬件加速变化；Windows 实机必须记录 GPU、驱动和 HEVC Extension，不能用 Wine 代替。参考：https://www.electronjs.org/docs/latest/api/video-overlay
- 结论：用已有媒体元素、队列和 Electron 运行时；自研部分只保留项目需要的按需激活、失败隔离和收据字段，不新增跨平台播放器。
- 生态里已有：MDN `HTMLImageElement.loading` 规定图片可延迟加载，不能把所有原图立即拉取。参考：https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/loading
- 生态里已有：MDN `HTMLMediaElement.preload` 说明 `metadata` 只请求元数据，适合画布首屏。参考：https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/preload

## 当前 macOS 基线收据

这些收据来自真实 Electron 运行，不是合成媒体或单次 FPS 样本：

- `tests/ux/perf-results/canvas-real-hevc-S-lowzoom.json`、`M`、`L`、`XL`：真实 3840×2160、10-bit HEVC 视频，低缩放拖拽，每档 2 次样本。
- `tests/ux/perf-results/canvas-real-hevc-S-normal.json`、`M`、`L`、`XL`：同一视频，普通拖拽，每档 2 次样本。
- `tests/ux/perf-results/canvas-real-4k-sml.json`、`canvas-real-4k-xl.json`：真实 3840×2160 PNG（约 9.3–12.0MB/张），S/M/L/XL 低缩放，每档 2 次样本。
- `tests/ux/perf-results/canvas-real-4k-drag.json`：同一批 4K PNG，S/M/L/XL 普通拖拽，每档 2 次样本。
- `tests/ux/perf-results/canvas-real-4k-xl-reveal.json`：XL 视口媒体展开，验证按需加载范围。

macOS 结果只能作为 macOS 基线。Windows 收据必须在 W-NVIDIA、W-IGPU 或 W-SW 的真实设备上重新生成，不能复制这些 JSON 或改写 `platform` 字段冒充跨平台结果。
