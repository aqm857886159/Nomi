# 结构评审 · 节点「在忙」只有一套词表，读者侧已挂到第三个例外（2026-09-14）

> R21.2 触发。本轮合同 `docs/fixes/2026-09-14-import-borrows-generation-waiting-surface.root-cause.json`
> 把 `electron/assets`（连带 `electron`）、`src/workbench`、`src/desktop`、`src/i18n` 四个模块
> 推过了 7 天 ≥3 份合同的线。本文点名的就是这四个。
> 直接前作：`docs/audit/2026-09-13-canvas-media-preview-structure-review.md`（同一条导入/落盘链的上一刀）。

## 0. 先摘掉假信号

`src/workbench` 这窗口 93 份、`electron` 23 份、`src/i18n` 23 份——绝大部分来自 2026-09-08
那次 lane 切换的批量落盘，一天压进几十份，7 天窗口自然被撑满。门岗只会数，不区分
「一次迁移」和「同一处反复出事」，这是它该有的样子（R21.2：只判做没做）。

四个模块里，**只有两个是真的结构问题**：
- `src/workbench`（画布节点的「在忙」语义）——本文第 1-3 节，**是**，而且还剩两个活的实例。
- `electron/assets`（素材落盘链）——本文第 4 节，是前作那份评审的**同一个结构**在往下走，本轮没有新增分叉。
- `src/desktop`、`src/i18n`：本轮只各改了一处（bridge 加一个事件字段、加两对文案键）。
  跟随改动，不是独立的结构问题。本节只为完整记账，不假装它们也需要评审。

## 1. 这一簇真正的结构形状

画布节点表达「我在忙」只有**一套词表**：`GenerationNodeStatus`
（`electron/shared/canvas/generationNodeStatus.ts`，`idle | queued | running | success | error | recoverable`）。
它是**给生成用的**——`queued` 读作「排队等模型」，`running` 读作「模型在跑」。

但节点上会忙的事不止生成。今天至少五种：

| 在忙的事 | 谁写状态 | 写成什么 | 界面上谁画 |
|---|---|---|---|
| 生成 | `runner/` | `queued` / `running` | `NodeGeneratingOverlay` → `GenerationWaitingSurface` |
| 本地导入（拷文件） | `adapters/assetImportAdapter.ts` | ~~`queued`~~ → 本轮改成 `idle` + `meta.uploadStatus` | 本轮新增 `NodeImportingOverlay` |
| 视频深度派生（本地 ffmpeg） | `videoDepth/startVideoDepthDerivation.ts:89` | `running` | `NodeGeneratingOverlay.tsx:30` 的**早退例外** |
| 抠图 / 局部改图（本地算子） | `nodes/useNodeImageEditing.ts:302,435` | `running` | `BaseGenerationNode.tsx:637` 的**早退例外**（`localImageOpPending`） |
| 剪贴板 URL 下载 | `adapters/clipboardImagePaste.ts:408` | `running` | 没有例外——仍然穿着生成等待层 |

**结构缺陷一句话：语义只有一个写入口（生成词表），却有 N 个读者例外。**
每来一种新的「忙」，就在读者侧加一句早退——本轮这份合同加的是**第三句**
（视频深度、本地图像算子，现在是导入）。第三句是「结构不对」最便宜的证据，不是再加一句的理由。

### 为什么这个写法一定会出事

例外写在读者侧，等于**默认值是「按生成画」**。谁忘了加例外，谁就免费继承整套生成的表现：
状态药丸、取消钮、img-fx 等待层、以及等待层拿不到 WebGL 时的兜底块。
2026-09-14 用户看到的「深灰卡中间一根不动的蓝条」就是这么来的——导入既没有模型在跑，
也没有预览帧可揭示，却穿着生成的等待层，于是只剩兜底块那根条。
用户的判词是「这是什么」，不是「哪里慢」：**他看到的是一个自己不该出现的界面**。

## 2. 不变量该归哪层

**归写状态的那一层，不归读它的那一层。**

本轮把不变量钉在 `adapters/assetImportAdapter.ts`（导入中/成功/失败三态的唯一写入点，
初次导入与「重试导入」共用），测试是 `adapters/assetImportNotGenerating.test.ts`：
建卡那一刻状态不是 `queued`/`running`，且 `generationFeedback` 判定它没有生成在跑。
把它钉在 overlay 那层只能挡住今天这一个读者——这正是前两次例外留下的坑。

对应地，读者侧只保留**一处**判断（`NodeGeneratingOverlay.tsx:34`，见到
`meta.uploadStatus === 'uploading'` 就把这张卡交给 `NodeImportingOverlay`），
而不是在每个消费者里各写一次。

## 3. 还活着的同类实例（本轮未修，登记）

1. **剪贴板 URL 下载**（`clipboardImagePaste.ts:408`）写 `status:'running'`，今天仍然穿着生成等待层。
   它至少在跑网络请求，`running` 不算撒谎，所以本轮**不动**——但它和导入是同一形状：
   一件非生成的忙借了生成的词表。
2. **视频深度 / 本地图像算子**的两句早退还在原地。本轮没有去合并它们：把三种忙统一成
   「节点有一个 `busy: { kind, ... }`，等待层按 kind 派生形态」是一次真正的语义改造，
   要动 5 个写入口和 3 个读者，且 `status` 是 R14.1 管的词表（`check:vocabularies`），
   改它要先过门岗登记。那是一份独立的合同，不是顺手。
3. **兜底块此前也没有 owner**：`GenerationWaitingSurface` 的实心色条同时服务生成与导入两条路径，
   画错一次两边一起错；而它依赖的样式表此前挂在 `GenerationCanvas.tsx` 上，
   等待层被画布以外的宿主挂载（设计实验室）时根本不加载——实验室那格看起来「没有带子」，
   于是这块兜底从来没被真正看见过。本轮把样式收进组件自己的
   `nodes/generationWaitingSurface.css`，属于同一个结构问题的另一面：**谁用谁带**。

### 建议的下一刀（不在本合同里）

出一份合同把「节点在忙」从 `status` 里分出来：
`status` 只管生成生命周期，非生成的忙由各自的 meta 字段（`uploadStatus` 已经是一个先例）表达，
等待层按显式传入的形态渲染，读者侧不再有任何早退例外。
先决条件是 `check:vocabularies` 的词表登记更新 + 上面三个活实例各自的归属裁决。

## 4. `electron/assets`：与前作是同一个结构，未新增分叉

前作（`2026-09-13-canvas-media-preview-structure-review.md`）定的口径是
**「源 / 预览」的决定权收进落盘边界 `electron/assets/assetPreview.ts`，其余层只消费**。

本轮完全按这个口径走，没有第二个 owner：
- 只给 `createStoredAssetPreview` 加了一个「预览落到别处」的出口（`previewOwnerPath`），
  用于「拷贝开始前先出一帧」；落点在项目内暂存目录，**绝不写用户自己的目录**。
- 落盘后由 `attachStoredAssetPreview` 用 rename **认领**过去，不重派生第二次，
  也不新增「这次要不要缩略」的局部条件。
- 字节进度是这条链上的新状态，天生只有一个写入口（主进程 `copyFileWithProgress`）
  和一个读入口（导入等待层），走既有的 `nomi:assets:localization-started` 通道加字段，
  不新开第二条。

**同时兑现了前作登记的一条越界根因**：前作量到「HEVC 整段转码十几分钟且无进度反馈」。
本轮没有解决转码本身（那是前作登记的独立合同），但把这一段的**诚实度**补上了：
比例为 0 就说「检查中」，不说「0%」——0% 在几十秒里一动不动读起来像卡死，
而那一刻真实发生的是读文件头 / ffprobe / 归一化。**没有用假曲线去填那段等待。**

## 5. 遗留（明说，不假装闭环）

- 拷贝不是导入的长杆：本机 SSD 上 545 MB 的拷贝 ~0.3s，前面却有 ~19s 探测/归一化；
  HEVC 源还要整段转码。要让进度覆盖整段等待，得把 ffmpeg 的 `-progress` 接进来——
  与前作登记的「转码策略」是同一份待开合同。
- 第 3 节的三个活实例各自待裁。
