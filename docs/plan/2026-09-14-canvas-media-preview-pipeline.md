# 画布媒体：落盘边界派生预览 / poster，画布交互前不付原图全价

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：已实现 · 分支 `fix/canvas-media-preview-lod-20260914`（取代 PR #776；机制来自本地分支 `ba753cfa5`，按评审 `review-776.md` §六补齐重做）
> 根因合同：`docs/fixes/2026-09-13-canvas-media-preview-lifecycle.root-cause.json`
> 结构评审：`docs/audit/2026-09-13-canvas-media-preview-structure-review.md`
> 同 PR 带的 S5（LOD 判据换屏上尺寸）：`docs/plan/2026-09-12-canvas-lod-screen-size.md`

## 用户报的是什么

> 「一个 AI 拿着视频和图片导入不了画布」；S 规模（24 图 + 24 视频节点）20 秒内进不了画布，三个动作全卡在打开项目阶段。

## 先查别人

- 仓库里已有 ffprobe 封装：`electron/export/mediaProbe.ts:426`（`probeMediaMetadata`）和限时子进程 `electron/export/mediaProbe.ts:119`（`runBoundedProcess`）——本次只加 `pix_fmt` 一个字段，预览的 ffmpeg 调用复用 `runBoundedProcess`，不再裸 `spawn`。
- 仓库里已有抽帧：`electron/video/extractVideoFrame.ts:108`（`extractVideoFrameToAsset`）把帧**落成素材**（`writeAsset`，进素材库、可被引用），而 poster 是源文件的派生物、不能进素材库，所以只复用它的 ffmpeg 参数形状，不复用它的落盘。
- 仓库里已有「缩略图优先」槽位：`src/design/media.tsx:19`（`NomiImage.thumbnailSrc`）、`src/workbench/generationCanvas/components/canvasNodeLevelOfDetail.ts`（`resolveLightweightNodePreview` 已优先 `thumbnailUrl`）、`electron/capabilityCore/generationOutputMaterializer.ts:88`（已读 `data.thumbnailRelativePath`，只是从没有人写它）。结论：预览生成没有现成 owner，新增 `electron/assets/assetPreview.ts`；渲染侧只接线。
- 框架：Chromium `<video preload="metadata">` + `poster`（<https://html.spec.whatwg.org/multipage/media.html#attr-media-preload>）；React Flow 只做视口剔除 `onlyRenderVisibleElements`（<https://reactflow.dev/learn/advanced-use/performance>），屏上尺寸 LOD 由我们判（R29 四列表见 LOD 计划）。
- 同类产品：tldraw 按屏上尺寸换渲染精度（`steppedScreenScale`，<https://tldraw.dev/sdk-features/performance>）；Figma/Photoshop 类工具一律用 mipmap/代理画布、原图只在导出/编辑时解码。
- 之前那一版为什么不算：PR #776 的树上 `electron/assets/localizeTaskAsset.ts:38` 仍 `thumbnailUrl = url`、`src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:570` 仍 `src={node.result.url}`、`:552` 仍 `preload="auto"` 无 poster；唯一的生产逻辑是恒为 true 的 `shouldApplyLoadedImageDimensions`。

## 机制（前 → 后，file:line 以本分支为准）

| 位置 | 之前 | 之后 |
|---|---|---|
| `electron/assets/assetPreview.ts`（新） | 无 | `attachStoredAssetPreview`：ffprobe 一次 → 图片长边 >1024 出 `.preview.png`（源 pix_fmt 带 alpha）或 `.preview.jpg`；视频出首帧 poster；`width/height/durationSeconds` 写回 sidecar 并挂在记录上；永不抛 |
| `electron/assets/projectAssetStore.ts` `importRemoteAsset` / `copyAssetFile` | 直接返回落盘记录 | 各自**一扇门**调 attach（远端/data:/项目内引用；原生路径：选择器、Finder 粘贴拖入、MCP `import_asset`、跨项目复制） |
| `electron/assets/localFileImport.ts` `importLocalFile` | 直接返回 | 一扇门调 attach |
| `electron/assets/localizeTaskAsset.ts` | `thumbnailUrl: type === "image" ? url : null` | `thumbnailUrl: data.thumbnailUrl \|\| (image ? url : null)`，并转发 `width/height/durationSeconds` |
| `src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx` | 图片 `src={result.url}`；视频 `preload="auto"` 无 poster | 图片 `src={thumbnailUrl \|\| url}`；视频 `poster` + `deferUntilInteraction` + `preload="metadata"` + `onPosterLoad`；尺寸优先 `result.width/height` |
| `src/workbench/generationCanvas/nodes/NodeVideoPlaybackGuard.tsx` | 挂载即建 `<video>` | 有 poster 先经 `DeferredNodeImage` 画封面，进入/聚焦/点击后才建 `<video>` |
| `resultUrlRelocalizeBridge.ts` / `assetImportAdapter.ts` / `canvasStageDrop.ts`（素材库拖入） | 只带 url | 带边界给的 `thumbnailUrl/width/height` |
| `useAllProjectAssets.ts#assetRefFromDesktopAsset` | 无 `thumbUrl` | 从 sidecar `thumbnailRelativePath` 取 `thumbUrl`，素材库格子也挂预览 |
| `projectAssetStore.ts#listProjectAssets` | — | 过滤 `.preview.` 文件，不冒充素材 |
| `src/workbench/generationCanvas/model/*` | — | `GenerationNodeResult.width/height`（可选）；schema 同步 |
| LOD（S5） | `nodeCount > 80 && zoom < 0.55` | `cardWidth * zoom < min(cardWidth, 240)` + 选区 >50 二级闸；轻量档不挂缩放手柄/连线把手（拉线时立刻挂回） |

透明 PNG 裁决：**按源 pix_fmt 派生**，`rgba/bgra/argb/abgr/ya*/yuva*/gbrap*/pal8` → PNG 预览，否则 JPEG；不 hardcode 一种（`assetPreview.test.ts` 用真 ffprobe 断言预览的 pix_fmt 仍带 alpha）。

## 不动项

- 原图仍是 `result.url`：编辑（裁剪/抠图/切图）、导出、全屏预览对话框都读它。
- 时间轴 `ClipNodePreview` 的单个节目监视器仍 `preload="auto"`（一个面一个 video，本来就要播）。
- production-run / MCP 物化产物链（`generationOutputMaterializer` → `multiShotCanvasLanding`）：语义不同，另开合同。
- 存量节点不回填（迁移单列）。

## 验收门

- 单测：`electron/assets/assetPreview.test.ts`、`resultUrlRelocalizeBridge.test.ts`、`canvasNodeLevelOfDetail.test.ts`。
- 真机 journey：`tests/ux/canvas-image-preview-and-rename.e2e.mjs`（inline=预览、modal=原图、aria-modal、角色卡预览入口、改名持久化）。
- 真实素材走查（R13，macOS arm64）：用户素材 `9月12日(1).mov`（3840×2160 / 10-bit HEVC / 527s / 1.38GB）与从它抽的 4K PNG（22–26MB）。数字见 PR 正文与 `docs/audit/...structure-review.md` 的越界根因一节。

## 回滚

单 PR revert 即可：预览文件是派生物（`.preview.*` + sidecar 三个字段），旧版本读到 `thumbnailUrl` 指向 `.preview.*` 也只是「缩略图更小」，不影响源。
