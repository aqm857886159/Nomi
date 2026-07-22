# 浏览器素材捕捞可信化 + 3D 产物完整性（2026-07-22）

> 依据：`docs/audit/2026-07-22-browser-capture-and-3d-user-agent-study.md`（基线 origin/main@90e4ede6，动工时 origin/main 仍在同一提交，无并行改动）。
> 施工树：`/Users/aoqimin/Desktop/Nomi-capture3d-20260722`（独立 sibling worktree 钉 origin/main）。
> 三个连续提交：A 产物可信度 P0 → B 浏览器端到端闭环 → C 3D 交互重构（C 先出样张等拍板，不随本轮实现）。

## 已核实的根因（不是猜）

1. **浏览器下载链 `ERR_BLOCKED_BY_CLIENT`**：`browserViewMedia.ts:205-213` 在 `session.fetch` 里同时传 `referrer` 选项 + 手写 `Referer` 头。读了 Electron v31.7.7 `lib/browser/api/net-fetch.ts` 源码：`referrer` 选项被丢弃（只转发 `referrerPolicy`），headers 不过滤 forbidden header——手写的**跨源完整 URL Referer 直通 Chromium**，与默认 `strict-origin-when-cross-origin` 政策相抵触被 Chromium 拦杀。证据：同 URL 无 Referer 直测 200；YouTube/抖音真实报错 `net::ERR_BLOCKED_BY_CLIENT`（`.design-agent-evidence/browser-social-video/logs/report.json`）。
2. **候选不冻结**：`browserViewBridges.ts:698-701` `__nomiReadBrowserResourceCapture` 在保存时按 lastPoint 重新 `pickAt`——用户看到的高亮候选和真正保存的可以是两个东西（YouTube hover 换图实测）。
3. **首尾帧 PNG 污染**：`useScene3DFullscreenActions.ts:496-541` 挪 live 播放头后调 live `captureCamera`；`captureScene`（`scene3dMath.ts:457-516`）只隐藏带 `CAMERA_HELPER_FLAG`/GRID flag 的对象；`TransformControls`（`scene3dSceneView.tsx:324-333`）、`axesHelper`（`scene3dSceneContent.tsx:190`）、轨迹线/控制点（`TrajectoryRenderer`）都没有 flag → 烧进导出。MP4 走 `Scene3DTrajectoryCapture` 离屏（按构造无编辑器控件）所以干净。构图不一致：live 路径 1920 全分辨率 + live 场景状态 vs 离屏 720p cap + 确定性采样。
4. **MSE blob 误当可下载**：`browserViewMedia.ts:372-379` 对一切 `blob:` 走 `downloadURL`；MediaSource 的 objectURL 没有可下载字节 → B站「临时资源已失效」。
5. **注入桥 innerHTML**：`browserViewBridges.ts:140,187,344,383-393` → YouTube Trusted Types 下整个划词/提示词桥崩。
6. **错误一锅烩**：所有失败折叠成「下载失败，请重试」（`browserAssetPopoverUtils.ts:136-145` 兜底），真实原因（BLOCKED_BY_CLIENT 等）只进 console。
7. **contained 素材盒到不了画布**：`NomiBrowserAssetPopover.tsx:289-291` contained 模式直接 `canvasImportAvailable=false`（overlay 是独立窗口，querySelector 探不到父窗画布目标），但 IPC 管道本来就在（`overlayBridge.importToCanvas` → `browserViews.ts:472-475` → `GenerationCanvas.tsx:428-435`）——只缺可用性探测和入口按钮。

## 提交 A：产物可信度 P0

### A1 3D 首尾帧 = 与 MP4 同源离屏采样
- `Scene3DTrajectoryCapture` / `TrajectoryFrameStepper` 加 `sizeMode: 'reference-video' | 'still-frame'`（默认前者零回归）：still-frame 用 `aspectDimensions` 全分辨率，不套 `capCameraMoveDimensions`。
- `useScene3DMoveFrameExport` 重写（P1 删旧 live 路径）：选定相机重排到 `cameras[0]`（同 `takeRecording.ts:241-246` 口径）→ 挂离屏 `Scene3DTrajectoryCapture frameCount=2 sizeMode='still-frame'` → `frames[0]/frames[1]` 走原 `onScreenshot` 沉降为画布图片节点。时间点由 `cameraBindingTimes` 单源决定（`frameTimes(start,end,2)`=两端点=MP4 首尾帧同 t）。30s 看门狗失败 toast。
- 挂载点：`Scene3DFullscreen` 内条件渲染（导出请求态），不经 canvas meta 往返。

### A2 所有导出无 editor-only 元素（结构保证，不是特判）
- `CAMERA_HELPER_FLAG` 更名 `SCENE3D_EDITOR_ONLY_FLAG`（值不变，运行时 userData 不落盘）。
- 补 flag：TransformControls gizmo（挂载处 ref 回调 `getHelper?.() ?? controls` 整棵 traverse 打 flag，新 helper `tagEditorOnlySubtree`）、`axesHelper`、`TrajectoryRenderer` 整组（含控制点/加点按钮）。
- `captureScene` 的隐藏收集抽纯函数 `collectCaptureHiddenObjects(scene, hideGrid)` + 单测（flag 子树全命中）。视口截图保留网格（现有产品语义），gizmo/轴/轨迹点一律隐藏。

### A3 浏览器 referrer 语义 + 候选冻结
- 抽纯函数 `browserMediaFetchInit(requestedMediaType)`：`credentials:'include'`、`redirect:'follow'`、`referrerPolicy:'strict-origin-when-cross-origin'`、Accept 按媒体类型；**不写 Referer、不传 referrer**。`downloadURL`（blob 路）同样去掉 Referer。单测断言 init 里没有任何 referrer 形态的键。
- `__nomiReadBrowserResourceCapture` 只回冻结的 `state.current`，删掉保存时重 `pickAt`；jsdom 单测：安装脚本 → pointermove 命中 img → 改 img.src → 读取仍是冻结 URL。

### A 验收
- 单测：fetch init 无 Referer；候选冻结；`collectCaptureHiddenObjects`；still-frame 尺寸不 cap。
- 真机：同一运镜导出 MP4 + 首尾帧，抽 MP4 首尾与 PNG 并排人眼对账（构图一致、零 gizmo/轴/点）。

## 提交 B：浏览器端到端闭环（一次动作、分层兑现）

### B1 分型引擎（`electron/browser/media/`）
- 入口 `importBrowserMedia` 按源分型：
  - `data:` → 主进程直接解码（≤200MB、magic/MIME 校验）落盘，`normalizeBrowserMediaUrl` 放行 data:（命名层早已声明支持）。
  - `blob:` → 页面上下文探测（`fetch(blobUrl)` 3s：File/Blob 成功 → 保持现 `downloadURL` 路；TypeError → **MSE**）。
  - MSE 视频 → 不再假下载：页面上下文 `drawImage(video)` 取当前帧（taint 时退 `capturePage(元素矩形)`），落库为 `captureQuality:'frame'`。
  - `http(s)` → A3 修好的 session.fetch；失败按错误码分类，可视资源退元素截图 `captureQuality:'screenshot'`（吸收 bold-sinoussi Phase1 的 `locateMediaElementRect` + rAF settle + capturePage）。
- 不做任何站点域名特判。
- 质量标注单源：sidecar meta `captureQuality: 'original'|'screenshot'|'frame'`（缺省 original），素材卡副标题显示「原图 / 页面截图 / 视频当前帧」。

### B2 结构化错误（主进程 → 渲染层同一张表）
- 主进程抛 `[nomi-capture:<code>] 人话` 前缀错误，code ∈ {forbidden, not-found, html-not-media, too-large, timeout, blocked-by-client, mse-stream, network, session-gone, unknown}。
- `browserAssetImportErrorMessage` 改为解析 code → 文案 + 唯一下一步（如 forbidden → 「网站拒绝了下载（可能要登录）· 已改存页面截图/或建议截图」）；兜底「下载失败，请重试」只留给 unknown。

### B3 Trusted Types-safe 注入
- `browserViewBridges.ts` 四处 innerHTML 全改 createElement/textContent DOM 构造（页面脚本内建 `el(tag, style, children)` 小助手）。YouTube 上桥不再抛 TT 异常。

### B4 素材盒闭环
- 错误项不进 ready 素材网格：loading/error 卡渲染在独立「捕捞中/失败」条（弹层顶部），error 卡带 [重试]/[移除]，绝不混入 ready 列表与持久层（现状已不落盘，只是视觉混排）。
- contained「放到画布」：overlay 经 main 探测父窗画布目标存在性（owner.webContents.executeJavaScript 一跳），可用则展示「放到画布」，走既有 `overlayBridge.importToCanvas` 管道；overlay 自己给成功反馈。

### B 验收
- mock 单测：分型（data/普通 blob/MSE/http）、错误码映射、当前帧路径、质量标注落 sidecar。
- 真机：公开图片站 ≥8/10「候选→原图落库→magic 正确→放到画布」；B站/YouTube MSE 100% 分类正确并可存当前帧；通用「请重试」清零（unknown 之外）。

## 提交 C：3D 交互重构（本轮只出样张）

按审计 §6：任务 effect-first 三入口（构图图/人物动作/运镜参考）、主视图=当前产物（取景/预览/出片时所选相机占中央，左上常显 `工作视图·不会出片`/`相机1·输出画面` 可点切换）、单一全局状态句、录制条（倒计时+键盘归属）、模板成组折叠、产物完成卡闭环。**先读 `docs/design/nomi-design-system.md` + 截真实 UI，出可交互 HTML 样张，用户拍板后另一轮实现。**

## 不动项
- `originalUrl=null` 隐私收口、200MB 限额、magic 校验（`browserMediaValidation.ts`）原样保留。
- MP4 参考视频管线（`CameraMoveCaptureHost`/ffmpeg 参数）不动；`capCameraMoveDimensions` 仍只管视频。
- 视口截图保留网格的产品语义不动。
- 素材盒入口拓扑（顶栏/伴生并存）本轮不动（审计 P2，另立任务）。
- `yt-dlp/gallery-dl` 适配器、CDP 响应复用 ring：P2，不进本轮。

## 回滚
- A/B 各自独立 commit，git revert 即回滚；无数据迁移、无 schema 变更（sidecar 新键 `captureQuality` 缺省等价 original，旧数据零影响）。

## 并行风险
- `claude/bold-sinoussi-2a0c04`（capturePage Phase1，未合并）与 B 重叠：其可用件（元素定位/rAF settle/capturePage/质量标注意图）被 B 吸收，B 落 main 后该分支作废待删，避免并行版（P1）。
- push 前 `git fetch` 对账 origin/main，被人抢先则 rebase 后再 gates。
