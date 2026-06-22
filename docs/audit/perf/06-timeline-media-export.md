# 时间轴预览 / 媒体加载 / 导出 性能审计

> 范围：`src/workbench/preview/*`、`src/workbench/timeline/*`、`src/workbench/export/*`、`electron/export/*`、`electron/video/*`。
> 方法：只读源码追真相源 + 机制推演。本文未做真机量测，末尾给「真机实测项」。
> 日期：2026-06-22

---

## 顶部结论（卡顿根因）

**这一段整体是「曾经被优化过、骨架正确」的代码** —— 播放推进用了 rAF（不是 setInterval），clip 拖动 commit:false 不落盘，`TimelineClip`/`TimelineTrack` 都 `React.memo` 且只细粒度订阅 `scale/fps/本片是否选中`，playhead 竖线和 clip 定位都走 `transform`（不是 layout 属性），导出走主进程 ffmpeg filtergraph 子进程（不阻塞 UI）。这些是对的，且代码里有注释解释为什么。

真正残留的卡顿来自三处，按影响排序：

1. **播放时每帧重渲整个 `<TimelinePreview>`（791 行的大组件，未 memo）。** rAF 每帧 `setTimelinePlayhead` 无条件替换 `state.timeline` 引用 → `PreviewWorkspace` 订阅了整条 `timeline`，每帧重渲 → 把 `timeline`+`playheadFrame` 透传给**没有 `React.memo`** 的 `TimelinePreview`，于是每帧跑一遍它的全部 render（重算 framing、`computeTimelineDuration`、`resolveActiveTextClipsAtFrame`、`.toFixed`、重建 200+ 个 className 字符串、遍历文字 clip）。这是播放掉帧的主因。下方时间轴侧（track/clip）反而是被保护好的，预览侧没有。

2. **时间轴每个 video clip 各挂一个真 `<video preload="metadata">` 当缩略图，无虚拟化、无尺寸约束。** clip 一多（10~30+），同时挂这么多 video 元素去拉 metadata/解码首帧，内存与解码线程压力大，滚动/首次进预览会卡。image clip 走了 `NomiImage(loading=lazy)`，但 lazy 对「横向 overflow 容器里 absolute 定位的离屏 clip」基本不触发延迟（浏览器按视口判定，absolute+横向滚动常被判定为「在文档流可见区」而全部加载）。

3. **WebM 降级导出路径在主线程串行 seek+drawImage 录制，会卡 UI。** 主路径（filtergraph，子进程）很好；但当资产无法本地解析时降级到 `exportTimelineToWebm`，它在 renderer 主线程上逐帧 `seekVideoToTime`（await seeked）→ `drawImage` → `setTimeout(msPerFrame)`，整个录制期主线程被这条链占住，且按 `msPerFrame` 真实墙钟节奏走（导出 10s 片至少花 10s+），期间预览/交互卡顿。

---

## 发现表

| # | 发现 | file:line | 机制 | 症状 | 严重度 | 修复方向 | 实测验证法 |
|---|---|---|---|---|---|---|---|
| 1 | `TimelinePreview` 未 `React.memo`，play 时每帧整体重渲 | `src/workbench/preview/TimelinePreview.tsx:51`（组件无 memo）；驱动在 `PreviewWorkspace.tsx:61` `setTimelinePlayhead(nextFrame)` 每帧调；store `workbenchStore.ts:649-650` + `timelineEdit.ts:476-481` 无条件 `{...timeline}` | rAF→`setTimelinePlayhead`→整条 `timeline` 换引用→`PreviewWorkspace`（订阅整条 timeline，`PreviewWorkspace.tsx:17`）每帧重渲→透传给未 memo 的 `TimelinePreview`，跑全部 render | 播放掉帧（尤其有文字 clip / 大画幅 / 低端机时明显） | 把 `<video>` 真实播放与 React 状态解耦：播放时让 `<video>` 自己跑（已经 `video.play()`），playhead 推进改为「只更新一根 playhead 竖线 + 时间数字」的轻订阅，不要每帧换整条 timeline 引用。或：`setTimelinePlayhead` 里 `if (frame === timeline.playheadFrame) return timeline`（省掉同帧空转），并给 `TimelinePreview` 拆出一个 memo 的「舞台」子组件，只让时间数字那一行订阅 playhead | DevTools Profiler 录一次播放，看每帧 commit 是否含 `TimelinePreview`；或在 render 顶部打 `performance.now()` 计数，播放 3 秒看 render 次数（预期应 ≈ playhead 数字更新次数，不应是整组件） |
| 2 | 时间轴 video 缩略图 = 每 clip 一个真 `<video>`，无虚拟化 | `src/workbench/timeline/TimelineClip.tsx:212-227`（`<video preload="metadata">`） | 每个 video clip 渲染一个独立 `<video>` 元素拉 metadata + 解首帧；轨道里所有 clip 一次性全渲（`TimelineTrack.tsx:175`，无窗口化） | clip 多时进预览/滚动卡、内存涨；解码线程争用 | ①缩略图改「抽一帧 PNG 缓存」而非常驻 `<video>`（已有 `electron/video/extractVideoFrame.ts` 基建，抽首帧落 `nomi-local://` 当 poster，用 `<img>` 显示）②或对轨道做横向虚拟化（只渲可视区 clip）③至少给 `<video>` 加 `poster` 占位避免解码即显 | 放 20~30 个 video clip，开 Chrome Task Manager 看 GPU/内存；Performance 录滚动看 `Decode Image`/video 解码占用；对比改 poster 后 |
| 3 | WebM 降级导出在主线程串行录制，按真实墙钟走 | `src/workbench/export/timelineWebmExport.ts:268-320`（tick 链 `seekVideoToTime`→`drawImage`→`setTimeout(msPerFrame)`）；入口 `exportApi.ts:93-105` | 仅在 `backend !== 'filtergraph'`（资产无法本地解析）时触发；主线程逐帧 seek+绘+录，录制时长≈视频时长，期间主线程繁忙 | 导出卡 UI（仅降级路径；主路径不卡） | ①确保「主路径覆盖率」最大化（绝大多数资产可本地解析→走 filtergraph 子进程，已是默认）②降级录制挪到 `OffscreenCanvas`+worker，或明确提示「降级中、界面可能卡顿」③`requestAnimationFrame` 替 `setTimeout` 减少节流抖动 | 构造一个 URL 无法本地解析的远端视频 clip 触发降级，导出时观察主线程卡顿；对比本地资产走 filtergraph 时 UI 流畅度 |
| 4 | 播放时 `<video>` 同步副作用每帧重跑（同帧 currentTime 校正） | `src/workbench/preview/TimelinePreview.tsx:117-125` | effect deps 含 `playheadFrame`，每帧变 → effect 每帧执行；虽有 `if (playing) return` 守卫（播放中不校正），但**暂停态下** scrub/步进每次都进；播放态下 effect 仍每帧被建立/清理 | 暂停 scrub 略卡；播放时 effect 反复 setup/teardown 的小开销 | 把「跟随 playhead 校正 currentTime」收进一个 ref 节流（仅暂停态且 |Δ|>阈值 时赋值），deps 去掉每帧变的 playheadFrame，改读 ref | Profiler 看播放时该 effect 的 setup/cleanup 频率；暂停拖 scrub 看 currentTime 赋值次数 |
| 5 | `computeTimelineDuration` / `resolveActiveTextClipsAtFrame` 在 `TimelinePreview` render 期每帧重算，未 memo | `TimelinePreview.tsx:105`（`computeTimelineDuration(timeline)`）、`:374`（`resolveActiveTextClipsAtFrame`）、`togglePlayback:318` 再算一次 | 因发现#1 每帧重渲 → 这些遍历 tracks/textClips 的函数每帧重跑（O(clips)） | 叠加在#1 上放大每帧成本 | 跟随#1 修好后大部分消失；额外可 `useMemo`（duration deps=[tracks,textClips]，已在 `PreviewWorkspace.tsx:26` 算过一份可下传复用，避免重复计算） | 修#1 后 Profiler 对比该组件 self-time |
| 6 | 标尺 tick `buildTimelineRulerTicks` 上限 360、`rulerEndFrame` 随 playhead 走 | `TimelinePanel.tsx:45-68`、`:118-129` | `rulerEndFrame` deps 含 `timeline.playheadFrame` → 播放时 playhead 推进可能让 `rulerEndFrame` 变 → `rulerTicks` useMemo 失效重算（最多 360 个 tick 重建 DOM） | 播放接近时间轴末尾时标尺可能周期性重算 | `rulerEndFrame` 对 playhead 做「按 trailing 量化」（如每 60 帧才扩一次），别每帧都可能变；或播放时冻结 ruler 长度 | 播放到接近末尾，Profiler 看 `TimelinePanel` 是否周期 commit 标尺 |
| 7 | clip 拖动 / trim 每次 pointermove 走 store set（commit:false）→ 该轨 clip 子树按需重渲 | `TimelineClip.tsx:151-191`（drag move）、`:72-99`（resize move） | 已用 `moveTimelineClip(..., {commit:false})` 不落盘（好），但每次 move 仍 `set` 换 timeline 引用 → memo 后只重渲「真正变了的 clip」（immer 引用稳定）。属可接受，非 layout thrash（用 transform/left px，未读 getBoundingClientRect 在循环里）—— 唯一隐患是 resize 气泡里 `flatMap(...).find(...)` 每次 move 全表扫 (`:91-92`) | 拖动大量 clip 时轻微 | 低优：resize 气泡的 live clip 查找可缓存 track 引用，免每 move flatMap 全表 | Profiler 录一次 trim，看 self-time 是否随 clip 总数上升 |
| 8 | 预览 `<img>`/`<video>` 用 `will-change-transform` 常驻 | `TimelinePreview.tsx:441`、`:450` | `will-change` 长期挂着会让浏览器一直为该层留合成层/显存，不是「拖动时才提升」 | 静止时也占合成资源（轻） | 改为仅拖动取景时临时加 `will-change`，松手移除 | 检查 layer 数量（DevTools Layers 面板） |

---

## 已经做对、不用动的（避免误改）

- **播放推进用 rAF + fractional-frame 累加器**（`PreviewWorkspace.tsx:38-67`），不是 setInterval，墙钟对齐 —— 正确，注释也写明了为什么。
- **`TimelineClip` / `TimelineTrack` 都 `React.memo` 且细粒度订阅**（`TimelineClip.tsx:16-19`、`TimelineTrack.tsx:23-24`、末尾 memo 注释）—— 时间轴侧每帧只重渲 playhead 竖线，这块是范本。
- **clip 拖动/trim/取景 commit:false 不 bump persistRevision**（`workbenchStore.ts:453-454` 等）—— 拖动不触发落盘，正确。
- **持久化落盘 debounce + 订阅 persistRevision**（`workbenchProjectSession.ts:198-205`），且 `setTimelinePlayhead` 不 bump persistRevision —— 播放推进**不会**触发自动保存，这条容易踩但他们避开了。
- **导出主路径 = 主进程 ffmpeg filtergraph 子进程**（`exportApi.ts:85-91` + `electron/export/ffmpegRunner.ts:349`），异步 spawn、有 stderr 进度解析、有 AbortSignal 取消、原子落盘（partial→rename）—— 不阻塞 UI、不逐帧 IPC 往返，正确。导出抽帧（`extractVideoFrame.ts`）也走子进程 + 会话内缓存。
- **playhead 竖线 / clip / ruler tick 全用 `transform: translateX`**（`TimelinePanel.tsx:374/410`、`TimelineClip.tsx` style）而非 left/top 触发 layout —— 正确。

---

## 建议真机实测项（按价值排序）

1. **播放掉帧定位（最高优）**：在预览区放 1 段视频 + 2 条文字 clip，Chrome DevTools Performance 录制「点播放→放 5 秒」。看：①每帧 commit 是否包含 `TimelinePreview`（含则证实发现#1）②帧率是否稳定 60/逼近素材帧率 ③Long Task。期望修#1 后每帧 commit 只剩「时间数字 + playhead 竖线」。
2. **多 clip 缩略图压力**：拖 20~30 个 video clip 入轨，开 Chrome Task Manager 看 GPU 进程内存与「Video Decode」；Performance 录横向滚动时间轴。验证发现#2。
3. **导出是否卡 UI（两条路分别测）**：①本地资产（走 filtergraph）导出 10s 片，导出期间尝试拖 clip / 切 tab，应基本流畅；②构造远端不可本地解析的视频触发 WebM 降级，重复操作，对比卡顿。验证发现#3 与「主路径不卡」结论。
4. **暂停 scrub 手感**：暂停态快速来回拖 playhead，看 `<video>` currentTime 校正是否跟手、有无卡顿（发现#4）。
5. **低端机 / 节流**：若有，在 4x CPU throttle 下重跑 1，掉帧会被放大、更易暴露#1/#5。

---

## 一句话给用户

时间轴**编辑侧**（拖 clip/trim/缩放）已经被优化得不错（memo + transform + 不落盘），**真正的卡在播放预览侧**：每帧把整条 timeline 换引用、连带重渲 791 行的 `TimelinePreview`（它没 memo），再加上每个视频 clip 各挂一个真 `<video>` 当缩略图。导出本身不卡 UI（主进程 ffmpeg 子进程），只有「资产无法本地解析」的降级路径会在主线程录制时卡。
