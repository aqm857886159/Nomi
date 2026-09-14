# 导入中节点 = 进度驱动的 img-fx 渐显（2026-09-14）

> 状态：📋 实施方案 · 样张已拍板（用户 2026-09-14）
> 样张：`docs/design/mockups/2026-09-14-import-progress-reveal.svg`
> 诊断底本：主会话 2026-09-14「导入媒体时那根蓝色粗条是什么」只读诊断（带 file:line）
> 依赖：`fix/canvas-media-preview-lod-20260914`（PR #776 v2）先合——预览派生的唯一 owner 在那条分支

## 1. 要解决的真实摩擦

导入一个大文件时，画布上那张卡是**一块深灰底 + 中间一根不动的实心蓝条**，看不出在干什么、还要多久。
两个成因叠在一起：

1. **导入借了生成的状态**。`assetImportAdapter.ts` 建卡时把「正在拷文件」写成 `status:'queued'`——
   那是生成词表里的「排队等模型」。`generationFeedback.ts:31` 因此判定这节点在生成，
   整套生成过程反馈（含 img-fx 等待层与它的兜底块）原样套了上来。而导入根本没有预览帧可揭示，
   img-fx 拿到的是空图池，只剩底噪。
2. **兜底块本身画错了**。拿不到 WebGL（GPU 被关 / blocklist / 软件渲染）时，等待层退到
   `GenerationWaitingSurface.tsx:111` 的 `bg-nomi-accent-soft` 实心条，且 `top-1/2` 少了
   `-translate-y-1/2`，连中都不居。设计写的是「静态扫光」。这条**在生成路径上一样出现**，
   影响所有拿不到 WebGL 的用户。

## 2. 这么做的底层逻辑

**生成和导入的区别只有一条：有没有真进度。**
生成是不确定的等待 → 动画按时间跑（img-fx 现役行为，不动）。
导入知道自己搬了多少字节 → **马赛克长多少由字节说了算**。同一套视觉语言、同一个等待层组件，
不为导入另写一份 UI（P1/P4）。

拷贝**开始前**先从源文件派生一帧（图片缩 1024 / 视频抽首帧），拷到 100% 时格子正好长满，
而那张图就是这份素材将来挂在卡上的画布预览——所以覆盖层卸载时不会「换一张图」闪一下。

## 3. 范围

- 主进程：拷贝流上报字节；拷贝前先派生预览（接现成 owner，不新写派生逻辑）。
- 渲染层：导入节点不再套生成等待层；等待层新增「进度驱动」模式；无 GPU 兜底改成柔和扫光带。
- 两处纯 bug：导入状态不再伪装 `queued`；`inViewport` 接上真值。

### 不动项
- 生成路径的时间驱动揭示、1100ms 卸载闸、音频等高灰条、失败卡：逐字不动。
- 任务卡 / 时间轴：仍然只吃文本，不接动效（`docs/plan/2026-09-09-process-feedback-imgfx.md:13`）。
- **没有进度线**：底部那根 2px 条不做，无 GPU 兜底那格也不做——马赛克本身就是进度（用户 2026-09-14 拍板）。
- 导入的收什么类型 / 多大 / 要不要转码：归另一条 lane（`fix/media-import-single-owner-20260914`），本 PR 不碰。

## 4. 四列表（R29：img-fx 边界画在哪）

| 它提供 | 我们用了 | 我们另写了 | 我们拆散了 |
|---|---|---|---|
| `img-fx@0.5.1` 的 WebGL 马赛克 shader、preset、主题/调色板、`paused`、`onCycle`（`node_modules/img-fx/dist/index.d.ts:157`）| 全部经 props 用；导入模式下只用 shader 当底 | **进度→格子数的映射**（`ProgressRevealCanvas.tsx`）：库的 `triggerReveal` 只有时间驱动的揭示（`index.d.ts:183`），没有「显到百分之几」的入口 | 无 |

## 5. 验收门（每条先红）

1. 导入时不得出现生成遮罩：`assetImportNotGenerating.test.ts` —— 把状态改回 `queued` 即红（收据在 PR 正文）。
2. 渐显进度逐字等于字节比例：`assetImportProgressStore.test.ts` + `electron/assets/assetImportProgress.test.ts`。
3. 无 GPU 无实心条：设计实验室新增 `pf-import-progress` / `pf-import-reduced` 两格；真机 `--disable-gpu` 走查截图。
4. 真机走查（隔离 profile）：导入 4K PNG 与 ≤500MB 视频，200ms 连拍证明马赛克随进度增长、完成后无切换闪烁、无蓝条。
5. `check:tokens` / `check:heavy-path` / `check:framework-boundary` / `check:vocabularies` 不增。

## 6. 回滚

按提交逆序 revert 本任务文件即可；主进程那层没有 `onProgress` 的调用方（跨项目复制、生成结果落盘）
走的仍是原来的整块 `fs.copyFile`，回滚不影响它们。

## 先查别人

- 依赖里已有：`node_modules/img-fx/dist/index.d.ts:183` 的 `triggerReveal` / `:228` 的 `triggerRegenerate`
  都是**时间驱动**的揭示，`ImageGenerationProps` 全表（`index.d.ts:385` 起）没有任何「揭示到某个比例」的入口——
  所以进度→格子数这一层必须我们写，shader 与主题继续全用库的，不 fork、不自写 shader。
- 仓库里已有（预览派生）：`electron/assets/assetPreview.ts:79` 的 `createStoredAssetPreview` 已是
  「ffprobe 一次 → 按 pix_fmt 出 png/jpg → 视频抽首帧 poster」的唯一 owner（`fix/canvas-media-preview-lod-20260914`）。
  本方案只给它加一个「预览落到别处」的出口，不复制一份派生逻辑。
- 仓库里已有（视口可见性）：`src/workbench/generationCanvas/nodes/deferredNodeMediaQueue.ts:184`
  的 `observeDeferredNodeMediaVisibility` 已是画布媒体的可见性观察器；等待层的 `inViewport`
  复用它，不另写第二个 IntersectionObserver。
- 仓库里已有（等待层与它的门控）：`src/workbench/generationCanvas/nodes/GenerationWaitingSurface.tsx:91`
  的四道准入门 + 四个名额；导入模式复用同一个组件与同一套门控，不新建等待层。
- 仓库里已有（扫光配方）：`src/workbench/generationCanvas/styles/generationCanvas.css:112` 的
  `media-loading::before` 已是一条 token-only、无 WebGL 依赖的扫光渐变；无 GPU 兜底带直接沿用它的
  keyframe 与配方，不新造动效。
- 生态里：img-fx 官方文档 https://github.com/Jakubantalik/img-fx 与 demo https://image.jakubantalik.com
  ——2026-09-14 复核 0.5.1 的 README 与 d.ts，确认没有进度驱动揭示的公开接口；本轮是执行已批准的选型，不重新选型。
