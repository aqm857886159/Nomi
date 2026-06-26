# 素材库上传放开音频/视频 + 修 macOS accept 灰掉坑

> 2026-06-25 · 用户报 bug：素材库「上传」文件框只接受图片，选视频/音频选不了（截图：mp4 被灰、格式锁死「图片文件」）。

## 根因

素材库上传走隐藏 `<input type="file">`，三层白名单 + 一个平台坑：

1. **accept 纯 MIME 通配**（`AssetLibraryPanel.tsx:232` `accept="image/*,video/*"`）。macOS/Chromium 对 `video/*` 常因 MIME 映射不到而把 `.mp4/.mov` 灰掉（[MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file) 推荐通配 + 显式扩展名一起列），音频更是没列。
2. **onChange 二次过滤**（`AssetLibraryPanel.tsx:160-163`）只放行 `image/`、`video/`。
3. **导入适配器**（`assetImportAdapter.ts:131` `importKindForFile`）对音频返回 null（注释「音频暂无可落节点」——已过时）。

**关键：音频落地链路早已通。** 上传 → `writeAsset`，`uniqueAssetPath` 用 `path.parse(fileName).ext` 保留原扩展名 → 落 `assets/imported/<date>/xxx.mp3`；workspace 索引（`workspaceFileIndex.ts:39-40`）认 `.mp3/.wav/.mov`→audio/video；`workspaceNodeToAssetRef` 经「项目文件」源进素材池。生成的 TTS 音频就是这么进音频 tab 的。音频**不需要画布节点**（无音频节点 archetype，`canvasNodeToAssetRef` 本就排除 audio）。

唯一卡点：前端上传把所有文件强塞「画布节点导入」（图/视频专用），音频进不来。

## 不是产品岔路

补全 UI 已承诺的能力（音频 tab 摆在那、生成音频已在库）。用户显式要「音频 视频」。无不可逆取舍、无架构岔路 → 按 P0 直接推到底，不停问。

## 改动范围（3 文件）

| 文件 | 改动 |
|---|---|
| `src/workbench/assets/AssetLibraryPanel.tsx` | ① accept 改「通配 + 显式扩展名」全列图/视频/音频；② onChange 分流：图/视频→画布节点导入，音频→项目文件导入；③ 音频上传后触发库刷新；④ 空态文案加「音频」 |
| `src/workbench/assets/useAssetPool.ts` | 透出 `refresh()`（转发 `useWorkspaceFiles.refresh`），音频经项目文件源进库需手动刷新 |
| `src/workbench/assets/importAudioToLibrary.ts`（新） | 音频 File[] → `importWorkbenchLocalAssetFile` 直接落项目文件（不建节点），带去重 + 大小上限 |

## 不动项

- 图/视频导入路径（`importLocalMediaFilesToGenerationCanvas`）不改——它们仍建画布节点、可拖到画布。
- 不新增音频画布节点 archetype（超范围，音频从项目文件源进库已满足）。
- `assetImportAdapter.importKindForFile` 仍只认图/视频（它服务画布节点导入，语义正确，不放音频进去）；只更新那条过时注释口径。

## 诚实缺口（D4 明标）

- 上传的音频进库后**暂不可拖到画布 / 时间轴**（库内音频本就不可拖，AssetGridCell 设计如此）。本次只解「上传进库」，库内音频→时间轴是另一能力，不在本次范围。

## 验收门

- 五门全过（filesize→tokens→lint→typecheck→test→build）。
- 真机走查：打开素材库，确认 input.accept 含音频/视频显式扩展名；程序化塞一个音频 File 验证路由到项目文件导入 + 库刷新出现在音频 tab。
- 单测：`importAudioToLibrary` 去重 + 大小过滤纯逻辑。
