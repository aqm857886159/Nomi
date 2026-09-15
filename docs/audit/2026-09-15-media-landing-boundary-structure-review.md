# 结构评审：「本地文件 → 项目素材」这一层

日期：2026-09-15 · 触发：R21.2（同一层 7 天内第三份根因合同）
起因合同：`docs/fixes/2026-09-14-media-import-single-owner.root-cause.json`

## 评审范围

这份合同横跨的目录：`electron/assets`、`electron/shared`、`electron/capabilityCore`、`electron`（preload）、
`src/workbench`、`src/desktop`、`src/i18n`、`src`（`src/media`）、`scripts`、`tests/ux`。

**它横跨这么多目录本身就是结论的一部分**：一条「一份本地文件怎么变成项目素材」的路，
被切在十个目录里，而这条路上的三个判断（收什么类型 / 收多大 / 要不要转码）没有任何一段代码是它们的 owner。
下面只评这一层的结构，不复述那份合同的修法。

## 一、为什么两条落盘实现能并存这么久

`electron/assets/localFileImport.ts#importLocalFile`（全类型、魔数嗅探、视频可播放归一化）与
`electron/assets/localFileCopy.ts#copyLocalImageFile`（只收 image、不嗅探、不归一化）
在同一个目录里并存，而且**窄的那条守着最常用的入口**（Finder 粘贴 / 拖入素材库）。

三个结构性原因，都不是「谁偷懒」：

1. **两条路的入参形状不同，看起来就像两件事。** 一条收「字节 + 文件名」（渲染层上传），
   一条收「一串本地路径」（剪贴板 / 拖拽）。入参不同掩盖了后果相同——两边最终都写进
   `projectAssetStore`，都决定了这个素材以后能不能播。**后果相同才是同一件事，入参相同不是。**
2. **窄的那条是「先做出能跑的最小版」留下的。** 名字（`localFileCopy` / `copyLocalImageFile`）
   和那句 `assetKindFromContentType(ct) !== "image"` 都诚实地写着「我只做图片」。
   问题是这个限制**只活在实现里，没活在任何契约上**：IPC 通道叫 `nomi:assets:copy-files`（不带 image），
   preload 暴露成 `copyFiles`（不带 image），渲染层的 hook 叫 `importImagePathsToLibrary`——
   到用户那里就只剩一句「已跳过 1 个不支持的文件」。**一个限制如果只写在实现里，它就不会被复核。**
3. **没有任何一处会同时看到这两条路。** 没有共同的调用点、没有共同的类型、没有一份「入口清单」。
   要发现它们是同一件事，必须有人同时读 `assetsIpc.ts` 的两个 handler——而这两个 handler 隔了 30 行，
   偏偏一个写着 `copyLocalImageFiles`，一个写着 `importLocalFile`，看起来正好像是两件不同的事。

**判据沉淀**：同一目录下两个导出，如果**写的是同一个持久化目标**（这里是 `projectAssetStore` 的资产目录），
就该在同一个模块里，或者一个显式地调另一个。不能靠名字不同来区分——名字只说明谁写的时候在想什么。

## 二、六个散落常量说明什么结构缺陷

`GENERATION_CANVAS_IMAGE_IMPORT_MAX_BYTES`(30MB)、`GENERATION_CANVAS_VIDEO_IMPORT_MAX_BYTES`(600MB)、
`ASSET_LIBRARY_AUDIO_IMPORT_MAX_BYTES`(200MB)、`COMPOSER_ATTACHMENT_MAX_BYTES`(30MB)、
`PANORAMA_IMPORT_MAX_BYTES`(80MB)、`IMPORT_MAX_BYTES`(64MB，MCP)。

它们不是六次疏忽，是**同一个结构缺陷的六次显形**：

- **这六个数字回答的不是同一个问题，但它们长得一模一样。** 其中三个真正的约束是**磁盘装不装得下**
  （画布图/视频、素材库音频），另外三个是**下游硬约束**（附件要整份进模型上下文、全景要一次性上传成
  GPU 纹理、MCP 那个其实也是磁盘）。两类问题被写成同一种东西——一个裸数字——于是谁也分不清
  哪个能改、哪个不能改，只好都不动。
- **没有「事实」可依，就只能拍。** 「磁盘还剩多少」在改之前**全仓没有任何一处问过**
  （`grep statfs` 零命中）。事实拿不到的时候，人只能拍一个自认为安全的数。
  **一个没有事实来源的判断，必然分裂成 N 份**——因为每个人拍的时候心里的场景不一样
  （画布作者想的是 4K 图，音频作者想的是配乐）。
- **最坏的一次串味是「转手」**：素材库「上传」按钮把图/视频转手给**画布的** adapter，
  于是画布的 600MB 成了素材库的上限。两个面因为共用了一段实现，就共用了对方的产品决定，
  而这件事在任何一处代码里都看不出来。
- **拒绝文案只说计数不说数字**（「已跳过：1 个过大」），是上面这条的直接后果：
  常量在另一个模块里，报文案的地方拿不到它，只能报个计数。
  **文案的信息量，等于这一层实际持有的事实量。**

**判据沉淀**：一个上限如果不能说出它从哪个事实派生（磁盘余量 / 供应商契约 / GPU 限制），
它就不该以裸常量的形式存在；确有下游硬约束的，必须和理由写在一起
（本次做成 `hardCapBytes` + `hardCapBecause`，缺理由单测会红）。

## 三、不变量归 `electron/shared/contracts/mediaImportPolicy.ts` 之后，还有哪些同类实例活着

收口只覆盖了「落盘准入」这条主干。**下面这些是同一类结构，还活着**，已登记进
`check:media-import-owner` 三条棘轮（只减不增），但**棘轮是记账不是防线**，这里逐条说清代价：

1. **「认不出就兜底成 `image`」一族（最该先收）** ——
   `src/workbench/assets/AssetReference.tsx:62`、
   `src/workbench/creation/storyboard/shotRow/ShotReferenceZone.tsx:65`、
   `src/workbench/generationCanvas/nodes/clipNodeUpload.ts:43`。
   它们把「判不出类型」当成「是图片」。后果不是拒收而是**送错通道**：一段视频被当图片走图片上传，
   在供应商侧炸成 413 或静默失败。这正是 `electron/assets/mediaTypes.ts:107` 那段注释写下来要防的事，
   而它自己没能覆盖这几处。**这一族比本次修的那个更危险**，因为它不报错。
2. **16 处手写 `accept` 字面量** —— `src/workbench/assets/AssetPicker.tsx:29` 的 `ACCEPT_ATTR`、
   各节点卡的 `accept="image/*"`、导演台的自建扩展名串等。
   现在权威闸已在主进程统一，所以它们**不再决定能不能进来**，只决定 OS 文件对话框里哪些文件是灰的。
   代价从「收不进来」降级成「选不着」——仍然是用户摩擦，但不再是数据正确性问题。
3. **浏览器捕捞那条链自带第二份魔数表** ——
   `electron/browser/media/browserMediaValidation.ts` 里有一份与 `mediaTypes.contentTypeFromMagicBytes`
   平行的嗅探实现，外加 200MB / 16MB 两个上限。它走的是 HTTP 流式落盘（`moveAssetFile`），
   上限兼作**网络读取预算**，与本地文件导入不是同一条链，所以本次没有硬并进来。
   但「同一个问题两份魔数表」是确凿的重造，应当单独收一次。
4. **视频转码仍然是一次同步等待** —— 本次只消掉了**不必要**的转码（本机能播就不转），
   真需要转的那些仍然没有进度、不能取消。这是体验欠账，不是正确性欠账。

## 四、给这一层的三条约束（下次改之前先过）

1. **写进项目资产目录的入口只能有一个。** 新增一条「从 X 拿到文件 → 变成项目素材」的路时，
   先问它能不能调 `importLocalFile`；不能，要写清为什么（目前只有浏览器捕捞的流式落盘有这个资格）。
2. **准入判断不许出现在调用点。** 收什么、收多大一律走
   `electron/shared/contracts/mediaImportPolicy.ts` 的 `admitMediaImport`；
   比素材库窄的面必须在 `MEDIA_IMPORT_SURFACES` 里写领域理由，硬上限必须附 `hardCapBecause`。
3. **「拒绝」必须携带数字或领域理由。** 只给计数的文案（「N 个过大」「N 个不支持」）视为缺陷——
   它等于告诉用户「我不告诉你」。渲染统一走 `src/workbench/assets/mediaImportMessage.ts`。

## 五、出站那一半：`electron/catalog` 也持有一份 kind 判定（2026-09-15 补）

触发合同：`docs/fixes/2026-09-15-media-kind-single-judgment.root-cause.json`（R21.2：本层 7 天内第 N 份）。

上面四节评的是**入站**（本地文件 → 项目素材）。同一条媒体路的**出站**那一半住在 `electron/catalog`，
而这次发现它持有第三份「contentType → kind」判定：`assetLocalization.ts` 里一个与 `mediaTypes` 里
**同名却语义相反**的 `mediaKindFromContentType`——表那份认不出返回 `null`，它认不出一律返回 `'image'`。
后者正是 2026-08-20 那次 HTTP 413 的根因形状（视频被当图片塞进 base64 通道），
`electron/assets/mediaTypes.ts` 的注释从那时起就一直在警告它，但警告不是防线（R28）。

已做的（随那份合同）：判断收口到 `electron/assets/mediaTypes.ts#mediaKindFromContentType`；
catalog 那份改名 `assetUploadChannelKind` 并改为**在 owner 结果上收窄**（video/audio 原样、其余走
上传通道的 image 默认）。逐值核对行为不变，回归测试 `electron/assets/localAssetFile.contentType.test.ts` 原样通过。
改名本身是结构动作：同名反义的两个函数并存时，下一个读者选错一个不会有任何报错。

**这一层给出的信号（记录，不在本批处置）**：`electron/catalog` 在 2026-09-09～09-15 的 7 天里
累计收到 12 份根因合同。逐份看题目，它们并不是同一个 bug 的复发，而是**四类互不相干的责任挤在一个目录里**：
供应商凭据与发布判据（`credential-validate-before-save` / `vendor-key-publish-class` / `apimart-direct-key-publish`）、
花钱与配额（`quote-bound-spend`）、素材出站与投递形状（`media-delivery-shape-is-a-contract` /
`audio-reference-slot-gate` / 本次这份）、以及能力目录本身（`model-availability-single-owner` /
`comfyui-combo-format-drift`）。目录里 5 个文件已经贴着 800 行上限
（`catalogStore.ts` 795、`assetLocalization.ts` 774、`taskParams.ts` 748、`runwayOfficial.ts` 720、
`comfyuiWorkflowImport.ts` 705）——同一个信号的另一种表现。

**这份补节不做那件事**：把 `electron/catalog` 按上述四类责任拆开是结构裁决，要先定「能力目录、素材出站、
凭据发布三者各自的 owner 边界画在哪」，不是一条发版集成分支该顺手做的事（那会让这一批的回滚单位变得不可控）。
这里只把信号和判据记在案，留给下一轮该层的专门评审。**下次改 `electron/catalog` 的人先读这一节。**

## 验收

- 机器侧：`scripts/check-media-import-owner.mjs` 三条棘轮（8 / 2 / 21，只减不增），已进 `gates:contracts`；
  （2026-09-15 集成批次按这棵树的实测值下调：兜底成 image 的 kind 自判 22 → 21、媒体 MAX_BYTES 常量 3 → 2；见下面第五节。）
  先验过它会红（对改之前的代码报 33 处）。
- 行为侧：`tests/ux/media-import-matrix.walk.mjs` 的入口 × 媒体矩阵，
  BEFORE（`origin/main`）14/36 不合格 → AFTER 0/36；
  数据在 `docs/evidence/2026-09-14-media-import-single-owner/matrix.md`。
- 类型侧：`electron/shared/contracts/mediaImportPolicy.test.ts` 断言「比素材库窄必须写领域理由」
  且理由不许是「还没做 / 暂不支持 / TODO」。
