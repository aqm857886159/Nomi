# 画布媒体预览结构评审（electron / electron/assets / tests/ux 三层）

> 触发：`check:symptom-cluster` —— 7 天内 `electron`、`electron/assets`、`tests/ux` 三层各收到第三份根因合同。
> 本次合同：`docs/fixes/2026-09-13-canvas-media-preview-lifecycle.root-cause.json`（交付分支 `fix/canvas-media-preview-lod-20260914`，取代 PR #776）。

## 一句话结论

这一族问题（4K 原图/4K HEVC 在画布上被逐节点全价解码）反复出现，不是因为哪个消费者写错了，而是**没有一层拥有「源 / 预览」这条区分**：资产落盘边界只存一份文件，于是本地化、导入、补救本地化、画布渲染各自「决定画哪个 URL」，最后都只能画唯一存在的那份——原图。修法是把决定权收进落盘边界（`electron/assets/assetPreview.ts`），其余层只消费。**此后不再在任何消费者里新增「这次要不要缩略」的局部条件**。

## 三层各自的边界与职责（评审后口径）

| 层 | 边界 | 职责 | 不许做的事 |
|---|---|---|---|
| `electron/assets` | `assetPreview.ts#attachStoredAssetPreview`（唯一 owner） | 文件落盘后跑一次 ffprobe；图片长边 >1024 → 按 pix_fmt 派生 `.preview.png`（带 alpha）/ `.preview.jpg`；视频 → 首帧 poster；源尺寸/时长写回 sidecar 并挂在记录 `data` 上 | 替换源文件；抛错阻断导入；按扩展名/供应商/平台分支 |
| `electron`（运行时/本地化） | `localizeTaskAsset`、`importRemoteAsset`、`importLocalFile`、`copyAssetFile` | 三扇存储门各自**只调一次** attach；`localizeTaskAsset` 把 `thumbnailUrl/width/height/durationSeconds` 原样转给渲染层 | 自己再决定 `thumbnailUrl = url`（旧写法已删） |
| `src/workbench`（画布） | `BaseGenerationNode` → `DeferredNodeImage` / `NodeVideoPlaybackGuard` | 只挂 `result.thumbnailUrl`；视频有 poster 时交互前不建 `<video>`，建了也 `preload="metadata"`；尺寸优先用边界探测的 `result.width/height` | 用预览的 naturalWidth 冒充源尺寸；为某种节点另写一套挂法 |
| `tests/ux` | `canvas-image-preview-and-rename.e2e.mjs`、`canvas-performance-benchmark.e2e.mjs` + 真实素材夹具 | 证明真实任务：内联 = 预览、对话框 = 原图、poster 交互前不挂 video；规模/真实素材收据 | 承载任何生产策略（阈值、格式判断都不许住在测试里） |

## 不变量归属与测试

- 源/预览分离、alpha 保真、小图不复制、视频 poster、sidecar 幂等 → `electron/assets/assetPreview.test.ts`（真 ffmpeg/ffprobe，不 mock 探测）。
- 补救本地化的写回 → `src/workbench/generationCanvas/resultUrlRelocalizeBridge.test.ts`。
- 渲染契约（inline 预览 / 对话框原图 / aria-modal） → `tests/ux/canvas-image-preview-and-rename.e2e.mjs`（Electron 真机）。
- LOD 判据（屏上尺寸、固定宽度卡不在 zoom ≥ 1 降档） → `src/workbench/generationCanvas/components/canvasNodeLevelOfDetail.test.ts`。

## 结构上仍然分叉的地方（登记，不在本次合同里修）

1. **production-run / MCP 物化产物**（`electron/capabilityCore/generationOutputMaterializer.ts` → `multiShotCanvasLanding.ts`）：那条链把 `thumbnailRelativePath` 当作签名预览的**源路径并直接用作节点 url**，所以不能简单接上 attach；需要单独一份合同把「预览 = 缩略 / url = 源」的语义先理顺。
2. **存量节点**：修复前落盘的图片节点 `thumbnailUrl === url`，不会自动回填预览；需要一条「项目打开时按 sidecar 懒回填」的迁移。
3. **项目文件树拖入画布**（`canvasStageDrop.ts` workspace-file 分支）：`WorkspaceFileNode` 不带 sidecar，落到画布的引用节点没有预览；素材库拖入分支已带（`AssetLibraryDragPayload.thumbUrl`）。

## 越界根因（本次走查量到、不属于媒体预览管线）

用真实素材（3840×2160、10-bit HEVC、30fps、527s、1.38GB `.mov`）走查时，它**根本进不了 Nomi**：

- `src/workbench/generationCanvas/adapters/assetImportAdapter.ts` `GENERATION_CANVAS_VIDEO_IMPORT_MAX_BYTES = 600MB` → 素材库「上传」直接「已跳过：1 个过大」。
- `electron/assets/localFileCopy.ts#readImageSource` 只收图片 → Finder 粘贴/拖入素材库「已跳过 1 个不支持的文件」。
- 即使放开上限，原生导入路径 `videoImportNormalize.ts#transcodeFileToPlayableMp4IfNeeded` 会把 HEVC 整段转成 H.264（本机实测 10s 片段 13.3s 墙钟 ≈ 0.75× 实时，crf 18 更慢）→ 527s 的片子要十几分钟且无进度反馈。而本机 Electron 对这段 10-bit HEVC 的 `loadedmetadata` 只要 ~60–110ms（走查 hover 数据），转码前提本身值得重新审。

这三条要另开合同（导入上限 / 视频粘贴 / 转码策略），本 PR 不顺手修。
