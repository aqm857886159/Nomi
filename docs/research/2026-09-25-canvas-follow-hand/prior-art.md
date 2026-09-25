# 「先查别人」调研报告：画布跟手（2026-09-25）

> 对应方案：[`docs/plan/2026-09-25-canvas-follow-hand.md`](../../plan/2026-09-25-canvas-follow-hand.md)。分支 `claude/canvas-follow-hand`。
> 行号都钉在具体 commit 上：tldraw `e8e194c`、xyflow `3d35b57`、ComfyUI `a4eebec`、Immich `e598e10`、Chromium `a5a60aa`、d3-drag `3c44c76`、Mantine `7171242`、tiptap `8ce15c2`。

## 要回答的问题

一块画布上同时摆 30 多个 1080p 视频、还要悬停 / 拖动 / 打字都跟手——这件事在依赖里、仓库里、生态里有没有现成做法？

## ① 依赖里已有？

- **React Flow 的订阅粒度原语：有，没用上。** `useStore(selector)` 只在切片变化时重渲（[useStore.ts L17-32](https://github.com/xyflow/xyflow/blob/3d35b57317576b0916c0bfeaaedd573aaacc2839/packages/react/src/hooks/useStore.ts#L17-L32)）；`useViewport` 视口任何变化都重渲（[useViewport.ts L13-45](https://github.com/xyflow/xyflow/blob/3d35b57317576b0916c0bfeaaedd573aaacc2839/packages/react/src/hooks/useViewport.ts#L13-L45)）；官方 [contextual-zoom 示例](https://reactflow.dev/examples/interaction/contextual-zoom) 在节点里写 `useStore(s => s.transform[2] >= 0.9)` 这种越界布尔。节点外壳改用越界布尔即照此。
- **Mantine Slider 的松手回调：有。** `onChangeEnd` 只在松手 / 方向键改完触发一次（[Slider.tsx L75-294](https://github.com/mantinedev/mantine/blob/717124296bd80131b36eefbb73f32c5ec5c7871d/packages/@mantine/core/src/components/Slider/Slider/Slider.tsx#L75-L294)）。
- **tiptap 的选项比较：** `useEditor` 按引用比较 extensions 每一项和其它非回调选项，变了就 `setOptions` + `view.updateState`（本机 `@tiptap/react@3.23.5` dist `compareOptions`）。所以选项要引用稳定。
- **React 18 的 `useDeferredValue`**：让重的子树延后到可打断的低优先级渲染（[react.dev](https://react.dev/reference/react/useDeferredValue)）。提示词面板延后挂载即照此。

## ② 仓库里已有？

- **封面派生**：`electron/assets/assetPreview.ts` 早已为每个落盘视频抽首帧，注释写明「画布首屏只挂 `<img>`，交互后才创建 `<video>`」；画布那半（`3a72f0ce7`）09-15 被连带撤回。直接复活，不另造。
- **按需自愈的 IPC 形状**：`ensurePlayableAsset`（`nomi:assets:ensure-playable`）——老节点补封面的 `ensureLocalAssetPreview` 照它的形状加在旁边。
- **打开项目后的结果补全**：`resultUrlRelocalizeBridge` 已有「幂等、静默失败、写回前核对 url」的纪律——补封面并进同一个 owner（改名 `resultMediaBackfillBridge`）。
- **只订缩放**：`reactFlow/canvasViewportScale.ts` 已写好 `selectFlowZoom` / `useCanvasLiveZoom`。

## ③ 生态里已有？

- **大量视频缩略图：Immich 的做法最对口。** 平时 `<img>`，悬停才挂 `<video muted autoplay>`，离开时 `pause → removeAttribute('src') → load()` 再卸载（[Thumbnail.svelte L113-264](https://github.com/immich-app/immich/blob/e598e108966814fe8f70f81cd2a47c66dd5e7c71/web/src/lib/components/assets/thumbnail/Thumbnail.svelte#L113-L264)、[VideoThumbnail.svelte L37-91](https://github.com/immich-app/immich/blob/e598e108966814fe8f70f81cd2a47c66dd5e7c71/web/src/lib/components/assets/thumbnail/VideoThumbnail.svelte#L37-L91)）。**采用。**
- **反方：tldraw / ComfyUI 一直挂着 `<video>`。** tldraw 默认 autoplay、无 poster（[VideoShapeUtil.tsx L51-59](https://github.com/tldraw/tldraw/blob/e8e194c3a55af60d1f6da86ce842de38784d07e1/packages/tldraw/src/lib/shapes/video/VideoShapeUtil.tsx#L51-L59)）；ComfyUI 挂 `preload="metadata"`（[VideoPreview.vue L45-60](https://github.com/Comfy-Org/ComfyUI_frontend/blob/a4eebec82919cf2a27ae84f81555d3575d2f7ca1/src/renderer/extensions/vueNodes/VideoPreview.vue#L45-L60)）。**有意不同，理由是领域约束**：Electron 默认自动播放策略是 `no-user-gesture-required`，Chromium 不会暂停屏外的静音自动播放（[autoplay_policy.cc#145](https://chromium.googlesource.com/chromium/src/+/a5a60aa3253ade09e0e89f738101521d08dd9beb/third_party/blink/renderer/core/html/media/autoplay_policy.cc)）；空闲播放器 15 秒后或超过 8 个才回收（[renderer_web_media_player_delegate.cc#43](https://chromium.googlesource.com/chromium/src/+/a5a60aa3253ade09e0e89f738101521d08dd9beb/content/renderer/media/renderer_web_media_player_delegate.cc)）；`preload="auto"` 每个钉住约 10 秒码率（[multi_buffer_data_source.cc#738](https://chromium.googlesource.com/chromium/src/+/a5a60aa3253ade09e0e89f738101521d08dd9beb/third_party/blink/renderer/platform/media/multi_buffer_data_source.cc)）。30 个视频同时缓冲靠不住浏览器兜底。
- **高频输入**：xyflow 官方示例与 tldraw 每个按键都写全局状态也不卡（[TextNode.tsx L7-26](https://github.com/xyflow/xyflow/blob/3d35b57317576b0916c0bfeaaedd573aaacc2839/examples/react/src/examples/UseNodesData/TextNode.tsx#L7-L26)、[useEditablePlainText.ts L76-88](https://github.com/tldraw/tldraw/blob/e8e194c3a55af60d1f6da86ce842de38784d07e1/packages/tldraw/src/lib/shapes/shared/useEditablePlainText.ts#L76-L88)）——因为订阅窄。**结论：「写得频繁」不是病，「订阅太宽」才是。** 方案里的「提示词本地草稿」因此撤销，改为收窄订阅（避开撤销合并、Agent 改写、付费确认读旧值三个坑）。
- **拖动结束**：d3-drag 只在 window 捕获阶段的 `mouseup` 结束手势（[drag.js L50-79](https://github.com/d3/d3-drag/blob/3c44c76502ded73e8bae85abf969b049c0ff5fc5/src/drag.js#L50-L79)），XYDrag 没有松手丢失时的中止（[XYDrag.ts L401-409](https://github.com/xyflow/xyflow/blob/3d35b57317576b0916c0bfeaaedd573aaacc2839/packages/system/src/xydrag/XYDrag.ts#L401-L409)）。「原生控件吞 mouseup」的假设在 Chromium 源码里找不到依据，已推翻。

## ④ 真实用户那边？

- 用户原话与拍板见方案「用户报的是什么」「拍板记录」。@ 的语义用户直接给了：「用 @ 的时候应该是参考图模式」，与 0.21 的行为一致（`673e6c5f4` 连带改乱）。
- 实测（Windows，32 个 15 秒 1080p 视频）见方案「改前实测」；Mac 上的悬停延迟归因于统一内存压力，仍待 Mac 实机证实。
