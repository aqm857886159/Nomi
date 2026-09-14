# 媒体导入单一 owner — 交付报告（2026-09-14）

分支 `fix/media-import-single-owner-20260914` · worktree `/Users/aoqimin/Desktop/Nomi-media-import` · 7 个 commit，工作树干净。
PR 素材已写到 lane 目录（`title.txt` / `body.md` / `ready`），**未跑五门全量、未 push、未开 PR**（按协调者改的流程交给零额度脚本）。

## 用户报的是什么

> 「粘贴/拖入素材库只收图片、视频一律不支持——这地方要通用支持，不能只支持一部分。以及拖入画布。」

## 根因（不是「忘了加 video」）

**「一份本地文件怎么变成项目素材」有两条独立实现，窄的那条正好守着最常用的入口。**
`importLocalFile` 全类型、嗅探字节、做视频归一化；`copyLocalImageFile` 一句
`assetKindFromContentType(ct) !== "image"` 直接 throw，不嗅探、不归一化——而 Finder 粘贴/拖入素材库走的是后者。

再叠两层：
- 上限是**六个散落常量**（画布 30MB/600MB、音频 200MB、附件 30MB、全景 80MB、MCP 64MB），与磁盘余量无关；
  素材库「上传」把图/视频转手给**画布的** adapter，于是画布的 600MB 成了素材库的上限，文案还只说「1 个过大」。
- 转码按「最差平台」猜：`PLAYABLE_VIDEO_CODECS` 刻意排除 HEVC，于是本机 55–110ms 就能播的片子也要整段转。

## 怎么修

唯一 owner `electron/shared/contracts/mediaImportPolicy.ts`：①`MEDIA_IMPORT_SURFACES` 逐面声明收哪些 kind，
比素材库窄的必须写领域理由；②上限从项目盘剩余空间派生（`statfs`；量不到就不设限），磁盘之外的硬上限只许存在于
确有下游约束的面且必须附理由；③转不转码问本机（`MediaSource.isTypeSupported` 探测结果）。
权威闸在主进程落盘前，渲染层调**同一个**函数做预检。

同 commit 删旧：`copyLocalImageFile` 的图片 only 实现、六个常量里与磁盘有关的三个、`importAssetGuard` 的自建扩展名
清单与第二份 ext→MIME 表、`PLAYABLE_VIDEO_CODECS`、`classifyUploadFiles` 的 mime 链、`filterCanvasImportableLocalFiles`。

走查里又量出两条同类，一并修：**文件名丢了扩展名导致转码判定一律投降**（落盘前用 `canonicalAssetFileName` 补回），
**画布把「收什么」判了两遍、第二遍筛空就什么都不做**（选中一个 mp3 界面 15s 静默）。

## 矩阵（4 入口 × 9 种媒体，全部界面动作，每个入口独立实例+独立项目）

BEFORE = `origin/main`(155f660ce) 独立 worktree 构建后跑同一份脚本。

| | BEFORE | AFTER |
|---|---|---|
| 不合格格数 | **14 / 36** | **0 / 36** |
| 粘贴 / 拖入素材库能收的媒体 | 只有图片 4/9 | **9/9** |
| 10s 10-bit HEVC 进素材库 | 7.2s（上传）/ 14.4s（画布），整段转 H.264 | **0.15–0.29s** 原样落盘 |
| 用户 1.38GB · 3840×2160 · 10-bit HEVC · 527s | 四个入口**全部拒收** | 四个入口**全部收下**，4.2–10.8s，原样 1317MB 落盘 |
| 画布拖 wav | 15s 一个字都没有 | 9ms 给出「这里放不下——画布节点只有图/视频两种落点，音频的家是素材库 → 时间轴」 |

细表与原始数据：`matrix.md` / `matrix-before.json` / `matrix-after.json`；截图 `shots/before/`、`shots/after/`。

## 门岗

`pnpm run check:media-import-owner`（已进 `gates:contracts`），三条棘轮只减不增：手写 accept 媒体字面量 8、
媒体 `*_MAX_BYTES` 常量 3、兜底成 `image` 的 kind 自判 22。**先验过它会红**：对改之前的代码报 33 处。

## 验证

typecheck 0 error；lint 0 error / 73 warning（棘轮 98）；vitest 3745 passed；
本地逐条跑过 12 个 check:* 全绿；Ponytail 七个 commit 全部走仓内 Claude 壳真评审通过（无 defer）。
跑隔离实例前后对 5 份 MCP 配置做过 diff：`.claude.json` 只有 Claude Code 自己的 feature-flag 缓存变动，
`mcpServers` 与各 project 的 `mcpServers` 全部一致，无需还原。

## 欠账（已登记进棘轮，不会再长）

- 转码的进度条与可取消、「先落原片后台派生可播版」不在本 PR（只消掉了不必要的等待）。
- 三条棘轮里剩的 8/3/22 处是**欠账登记不是防线**。最该先收的是「认不出就兜底成 image」那一族
  （`AssetReference.tsx:62`、`ShotReferenceZone.tsx:65`、`clipNodeUpload.ts:43`）——它会把视频送进图片通道。
- 浏览器捕捞那条链（自带第二份魔数表 + 200MB/16MB 两个上限）是 HTTP 流式落盘，上限兼作网络读取预算，另开。
- 本机 codec 探测到达前的窗口期按保守白名单走，仍会对 HEVC 转码一次。
- 音频落库成功但生成页侧栏素材库默认不列音频（`includeAudio=false`，既有行为，未改）。

## 接触面

不碰 #776 的媒体**预览**管线（无共同文件）。与 `feat/import-progress-reveal-20260914` 共用
`assetImportAdapter.ts`：本 PR 改 14–21 / 29–40 / 163–195 / 298–316 / 368，**没有动** `status` 字段与
进度上报（`status: 'queued'` 在 280 / 347 原样保留）。谁先合都行。
