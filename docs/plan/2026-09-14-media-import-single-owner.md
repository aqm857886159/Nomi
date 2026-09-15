# 媒体导入单一 owner（2026-09-14）

- 状态：🚧 已实施，待评审合入
- 分支：`fix/media-import-single-owner-20260914`
- 用户原话（09-14）：「粘贴/拖入素材库只收图片、视频一律不支持——这地方要通用支持，不能只支持一部分。以及拖入画布。」

## 一句话

「一份本地文件怎么变成项目素材」现在有 **两条各自独立的落盘路** 和 **五份各自 hardcode 的准入判断**；
窄的那条正好守着用户最常用的入口（Finder 粘贴 / 拖入素材库），所以视频一律进不来。
本 PR 把「收什么媒体 / 收多大 / 要不要转码」收成一份声明，所有入口派生，同 commit 删掉各入口自己那份。

## 先查别人

完整报告：[docs/research/2026-09-14-media-import-single-owner/prior-art.md](../research/2026-09-14-media-import-single-owner/prior-art.md)（四问逐格，含查法与没查的那一格）。三条结论：

- **不新造媒体类型表**——仓库里已经有一张自称「唯一真相源」的表：`electron/assets/mediaTypes.ts:20`（`MEDIA_TYPES`），配套的魔数嗅探在 `electron/assets/mediaTypes.ts:151`、`accept` 生成器在 `electron/assets/mediaTypes.ts:224`。**但它在 `origin/main` 上只有一个生产消费者**（`origin/main:src/workbench/assets/AssetLibraryPanel.tsx:65`）——单源建到了「格式事实」这层，没建到「产品决定」那层（收不收、收多大），于是后者被每个入口各写一遍。本次只补它缺的那一层。
- **不引磁盘空间依赖**——`ls node_modules | grep -iE 'disk|statfs'` 无命中，Electron 也不暴露磁盘 API（`grep getSystemDiskInfo node_modules/electron/electron.d.ts` 无命中）；Node 自带 `statfsSync`（`node_modules/@types/node/fs.d.ts:1216`），`bavail * bsize` 就是答案，跨平台零依赖（R20：不在护城河上的通用能力用标准实现）。
- **不按平台猜 codec**——「浏览器能不能解这个 codec」是可以直接问的：`MediaSource.isTypeSupported` / `canPlayType` / `VideoDecoder.isConfigSupported`，社区做 HEVC 判定就是这么做的（<https://github.com/StaZhu/enable-chromium-hevc-hardware-decoding>）。同一次检索也查到反面证据：`isTypeSupported` 在无硬解时也可能返回 true，要判硬件加速得用 `navigator.mediaCapabilities.decodingInfo()`（<https://deepwiki.com/StaZhu/enable-chromium-hevc-hardware-decoding/5.2-troubleshooting>）——**不影响本次判据**，我们要答的是「播不播得了」（播不了才转码），不是「快不快」。
- **落盘路与转码判定都不新写**——`origin/main:electron/assets/localFileImport.ts:72` 与 `origin/main:electron/assets/videoImportNormalize.ts:27` 已在服役，本次是把第二条落盘实现**合并进**前者、把后者里的常量白名单换成「问本机」。

结构评审（同层 7 天内第三份合同触发，R21.2）：[docs/audit/2026-09-15-media-landing-boundary-structure-review.md](../audit/2026-09-15-media-landing-boundary-structure-review.md)。

## 类根因（不是「忘了加 video」）

### 根因 1：两扇落盘门，窄的那扇守着主入口（P1 并行版）

| 门 | 实现 | 收什么 | 有魔数嗅探吗 | 过视频归一化吗 | 谁在用 |
|---|---|---|---|---|---|
| A | `electron/assets/localFileImport.ts#importLocalFile` | 全类型 | 有（`resolveContentType`） | 有 | 上传按钮、画布导入、节点上传槽 |
| B | `electron/assets/localFileCopy.ts#copyLocalImageFile` | **只有 image**（`assetKindFromContentType(ct) !== "image"` → throw） | 无 | 无 | **Finder 粘贴到素材库、Finder 拖入素材库** |

门 B 是门 A 的窄化复制品。它自己判类型（第 15 行一句 `!== "image"`），自己不嗅探，自己不归一化。
用户看到的「已跳过 1 个不支持的文件」就是它。

### 根因 2：大小上限是散落的 hardcode 常量，与磁盘现实无关

| 常量 | 值 | 位置 | 谁受它管 |
|---|---|---|---|
| `GENERATION_CANVAS_IMAGE_IMPORT_MAX_BYTES` | 30MB | `src/workbench/generationCanvas/adapters/assetImportAdapter.ts:15` | 画布 **和素材库上传按钮** |
| `GENERATION_CANVAS_VIDEO_IMPORT_MAX_BYTES` | 600MB | 同上 :17 | 同上 |
| `ASSET_LIBRARY_AUDIO_IMPORT_MAX_BYTES` | 200MB | `src/workbench/assets/importAudioToLibrary.ts:12` | 素材库音频 |
| `COMPOSER_ATTACHMENT_MAX_BYTES` | 30MB | `src/workbench/ai/composer/composerAttachmentTypes.ts:27` | Agent 附件 |
| `PANORAMA_IMPORT_MAX_BYTES` | 80MB | `src/workbench/generationCanvas/nodes/director/panels/panoramaImport.ts:8` | 全景图导入 |

素材库的「上传」按钮把图/视频转手给**画布的** adapter，于是画布的 600MB 上限变成了素材库的上限——
用户在素材库看到「已跳过：1 个过大」，而那句话里连个数字都没有。

### 根因 3：转码策略按「最差平台」猜，不按本机事实

`videoImportNormalize.ts` 的 `PLAYABLE_VIDEO_CODECS` 是一份 hardcode 白名单，HEVC 被**刻意排除**，
理由写在注释里：「macOS 部分硬解、Windows 默认不行——按最差平台归一」。
代价：本机 Electron 对用户那段 10-bit HEVC `loadedmetadata` 只要 55–110ms（#776 走查实测），
我们却把 527s / 1.38GB 整段转成 H.264，0.75× 实时 ≈ 十几分钟，全程无进度、不可取消。

「这台机器能不能播这个 codec」是**可以直接问的事实**（`MediaSource.isTypeSupported`），不是要猜的常量。

## 怎么修

### 新增唯一 owner：`electron/shared/contracts/mediaImportPolicy.ts`（纯模块，src/ 与 electron/ 同源 import）

1. **收什么** — `MEDIA_IMPORT_SURFACES`：每个入口一条记录，声明它能落哪些 `MediaKind`，
   比素材库窄的必须写 `narrowedBecause`（领域理由，不许是「还没做」）。
   扩展名/mime/kind 继续由既有真相源 `electron/assets/mediaTypes.ts` 提供，本模块只管「哪个面收哪些 kind」。
2. **收多大** — `admitMediaImport(surface, file, capacity)`：
   上限从**项目盘剩余空间**派生（落盘一份 + 可能的转码产物 + 预留），不是常量；
   只有确有下游硬约束的面才允许额外 `hardCapBytes` + `hardCapBecause`（Agent 附件=模型上下文、全景=WebGL 纹理）。
   拒绝文案必带数字：文件多大、还剩多少。
3. **要不要转码** — `videoNeedsPlayabilityTranscode` 改为接受本机 codec 支持集，
   由渲染层启动时用 `MediaSource.isTypeSupported` 探一次真本机能力送进主进程；探不到才回落到保守白名单。

### 走查中又量出来的两条同类（本 PR 一并修）

4. **文件名丢了扩展名 → 转码判定直接投降**。画布导入把「节点标签」（去掉扩展名的文件名）当 `fileName`
   传到落盘层，而 `videoNeedsPlayabilityTranscode` 第一步就看容器扩展名——名字里没有 `.mov`，它只能判
   `container:unknown` 一律转码，本机能不能原生播就白探了。实测同一段 10s HEVC：粘贴进来 0.17s 原样落盘，
   走文件选择器却要 7–14s 转码。修法：落盘前用既有的 `canonicalAssetFileName(fileName, contentType)`
   把真实扩展名补回来，再做转码判定。
5. **画布把「收什么」判了两遍，第二遍筛空就什么都不做**。`CanvasToolbar` 的 file input 先用
   `filterCanvasImportableLocalFiles` 筛一遍，`if (files.length)` 才往下走——选中一个 mp3，界面一个字都没有
   （走查实测 15s 静默）。修法：删掉这道预筛（它是 `admitMediaImport` 的第二份），让唯一那条导入路去判并报出理由。

### 同 commit 删除（P1）

- 删 `electron/assets/localFileCopy.ts` 整个文件，`nomi:assets:copy-files` 改走 `importLocalFile(..., { allowSourcePath: true })`。
- 删上表五个常量中与磁盘有关的三个（画布图/视频、素材库音频），其余两个改为 owner 里的 `hardCapBytes` 登记项。
- 删 `AssetLibraryPanel.classifyUploadFiles` 自己那套 `mime.startsWith` 链，改派生自 owner。
- 删 `videoImportNormalize.PLAYABLE_VIDEO_CODECS` 这份「猜」出来的常量白名单。
- 删 `canvasStageDrop.filterCanvasImportableLocalFiles`（画布自己那份「收什么」的预筛）。

### 门岗（R17：加规则先验它会红）

`scripts/check-media-import-owner.mjs`：AST 扫 src/ 与 electron/，任何 `accept=` 字面量、
媒体相关的 `*_MAX_BYTES` 常量、或 `startsWith('image/'|'video/'|'audio/')` 形式的 kind 判断，
若不是从 `mediaTypes.ts` / `mediaImportPolicy.ts` 派生，就红。基线只减不增。

## 不动项

- `assetPreview.ts` 等媒体**预览**管线（#776 重做分支的面），本 PR 不碰。
- 转码的**进度条与可取消**、「先落原片后台派生可播版」：拆到第二个 PR（本 PR 只做「不必要就不转」）。
- 技能包导入 `parseSkillImport.MAX_BYTES`（不是媒体）。

## 验收门

- 入口 × 媒体矩阵（`tests/ux/media-import-matrix.walk.mjs`）before/after 两版，每格必须成功或给出**带数字**的明确原因。
- `pnpm run gates`。
- R21 v3 合同（`recurring`，`doors` 机器生成）。

## 回滚

单 commit revert；owner 模块是新增文件，删除后各入口回到自带判断（但那正是本 PR 要消灭的状态，回滚只用于紧急止血）。
