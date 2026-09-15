# 入口 × 媒体矩阵（真机走查，macOS arm64）

走查脚本：`tests/ux/media-import-matrix.walk.mjs`。全部是界面动作——文件选择器用 `setInputFiles`
（等价真人在 OS 对话框里选文件，Electron `webUtils.getPathForFile` 拿得到真实路径）、粘贴走主进程
`clipboard` 写 file-url + 真实 Cmd+V、拖入走真实 `DragEvent`。**不直接调 `assets.copyFiles` /
`assets.importFile` 这类 IPC**。每个入口一个全新实例 + 全新项目（素材落盘是内容寻址的，共用项目会让
后面几行永远看不到「新文件」）。

- BEFORE：`origin/main`（155f660ce）的独立 worktree，`pnpm build` 后跑。
- AFTER：本分支，同一份走查脚本、同一批素材。

素材：

| id | 文件 | 说明 |
|---|---|---|
| png-small | small.png | 1.0MB |
| png-4k | 4k-frame.png | 24.9MB，从用户视频抽的 3840×2160 帧 |
| webp | small.webp | 21KB |
| gif | small.gif | 151KB |
| mp4-small | small-h264.mp4 | 285KB，H.264 |
| mov-hevc-10s | hevc-10s.mov | 29MB，10-bit HEVC，10s |
| mov-hevc-huge | `9月12日(1).mov` | **用户真实素材**：1.38GB / 3840×2160 / 10-bit HEVC / 527s（只读） |
| mp3 | tone.mp3 | 40KB |
| wav | tone.wav | 441KB |

## BEFORE（origin/main）— 36 格里 14 格不合格

| 入口 \ 媒体 | png-small | png-4k | webp | gif | mp4 | HEVC 10s | **用户 1.38GB HEVC** | mp3 | wav |
|---|---|---|---|---|---|---|---|---|---|
| 素材库「上传」 | ok 118ms | ok 86ms | ok 87ms | ok 71ms | ok 292ms | ok **7211ms**（转码） | ✗「已跳过：1 个过大」11ms | ok 91ms | ok 75ms |
| 素材库 **粘贴** | ok 361ms | ok 350ms | ok 323ms | ok 273ms | ✗「不支持的文件」 | ✗「不支持的文件」 | ✗「不支持的文件」 | ✗「不支持的文件」 | ✗「不支持的文件」 |
| 素材库 **拖入** | ok 75ms | ok 67ms | ok 69ms | ok 67ms | ✗「不支持的文件」 | ✗「不支持的文件」 | ✗「不支持的文件」 | ✗「不支持的文件」 | ✗「不支持的文件」 |
| 画布「导入」 | ok 138ms | ok 85ms | ok 70ms | ok 175ms | ok 316ms | ok **14374ms**（转码） | ✗「1 个文件过大」13ms | ✗「1 个文件过大」 | ✗ **静默**（15s 内一个字都没有） |

用户报的就是中间两行：**粘贴 / 拖入素材库，视频和音频一律进不来**。
另外三处：① 1.38GB 被 600MB 常量拦下，文案里连数字都没有；② 本机 55–110ms 就能 `loadedmetadata`
的 10-bit HEVC 仍被整段转码；③ 画布拖一个 wav 进去，界面**一个字都不说**。

## AFTER（本分支）— 36 格全部合格

| 入口 \ 媒体 | png-small | png-4k | webp | gif | mp4 | HEVC 10s | **用户 1.38GB HEVC** | mp3 | wav |
|---|---|---|---|---|---|---|---|---|---|
| 素材库「上传」 | ok 150ms | ok 160ms | ok 106ms | ok 136ms | ok 96ms | ok **167ms** | ok **6327ms** · 1317MB 原样落盘 | ok 74ms | ok 70ms |
| 素材库 **粘贴** | ok 482ms | ok 364ms | ok 290ms | ok 305ms | ok 269ms | ok **286ms** | ok **10849ms** · 1317MB | ok 283ms | ok 267ms |
| 素材库 **拖入** | ok 73ms | ok 64ms | ok 65ms | ok 67ms | ok 75ms | ok **150ms** | ok **4236ms** · 1317MB | ok 67ms | ok 66ms |
| 画布「导入」 | ok 96ms | ok 105ms | ok 97ms | ok 176ms | ok 99ms | ok **225ms** | ok **6008ms** · 1317MB | ⛔ 有理由 15ms | ⛔ 有理由 9ms |

画布那两格的原文：

> 「tone.mp3」这里放不下——画布节点只有图/视频两种 archetype 落点；音频与 3D 在画布上没有节点可落（它们的家是素材库 → 时间轴 / 导演台）

这是**声明出来的收窄**（`MEDIA_IMPORT_SURFACES['generation-canvas'].narrowedBecause`），不是「不支持」。

## 三个可以直接读的数字

| | BEFORE | AFTER |
|---|---|---|
| 粘贴 / 拖入素材库能收的媒体种类 | 只有图片（4/9） | 全部 9/9 |
| 10s 10-bit HEVC 进素材库 | 7.2s（上传按钮）/ 14.4s（画布），整段转 H.264 | **0.15–0.29s**，原样落盘（本机能播，不转） |
| 用户 1.38GB / 527s 4K HEVC | 四个入口全部拒收 | 四个入口全部收下，**4.2–10.8s**，原样 1317MB 落盘 |

## 走查的检出力

脚本自己带四条失败路径（`check:walkthroughs` 要求 ≥2）：
F1 素材库面板没打开；F2 任何一格「什么都没落盘、也没给任何反馈」；F3 拒绝了却没给带数字/带理由的说法；
F4（`NOMI_MATRIX_EXPECT_UNIVERSAL=1`）某入口拒收了它声明收的 kind。
BEFORE 跑出 exit 1（14 格不合格），AFTER exit 0。

## 已知的度量限制（诚实标注）

面板反馈行会把**一模一样**的句子去重，所以 BEFORE 里连续几格都被同一句话拒绝时，脚本分不清
「这一格重新报了一次」还是「还是上一格那句」；这些格子标了「文案与上一格相同，面板去重」，
判据退回到「这一格什么都没落盘」——那已经足以支撑「被拒了」这个结论。
AFTER 全绿，不存在这种歧义。

截图：`docs/evidence/2026-09-14-media-import-single-owner/shots/before/` 与 `docs/evidence/2026-09-14-media-import-single-owner/shots/after/`（每个入口一张）。
`after/matrix-library-drop.png` 里能直接看到 `9月12日(1).mov`、`small-h264.mp4`、`hevc-10s.mov` 都在库里、
且没有「已跳过」横幅；`after/matrix-canvas-import.png` 里那条拒绝 toast 就是上面那句话。

一条顺带记下的既有行为（不是本 PR 引入，也没改）：音频落库成功，但**生成页侧栏**的素材库默认
`includeAudio=false`，所以列表里看不到 mp3/wav——剪辑页那个素材库（传 `includeAudio`）看得到。
矩阵按落盘判定，所以这两格是 ok。
