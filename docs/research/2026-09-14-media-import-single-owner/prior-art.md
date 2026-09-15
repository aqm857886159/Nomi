# 先查别人：媒体导入准入（2026-09-14）

对应方案 `docs/plan/2026-09-14-media-import-single-owner.md`，合同 `docs/fixes/2026-09-14-media-import-single-owner.root-cause.json`。

本报告只写**实际查过的**东西。没查的那一格明写「没查」和为什么，不拿别的内容凑数。

要解决的三个具体问题：① 「哪个入口收哪些媒体」该由谁说了算；② 「收多大」的上限从哪来；
③ 「这段视频要不要转码」怎么判。三问分别过四道检索。

---

## ① 依赖里已有吗

| 问题 | 查法 | 结果 |
|---|---|---|
| 有没有现成的「磁盘还剩多少」包 | `ls node_modules \| grep -iE 'disk\|statfs\|diskusage\|check-disk'` | **没有**。生态里有 `check-disk-space` / `diskusage` 这类包，但本仓没装，而且 Node 自带的就够。 |
| Node 自己有吗 | `node_modules/@types/node/fs.d.ts:1216` `statfsSync(path, options?): StatsFs` | **有**。`bavail * bsize` 就是可用字节，跨平台，零依赖 —— 所以**不引第三方包**（R20：不在护城河上的通用能力用标准实现，而这里标准实现就在运行时里）。 |
| Electron 自己有吗 | `grep -rn "getSystemDiskInfo\|freeSpace\|diskSpace" node_modules/electron/electron.d.ts` | **没有**。Electron 不暴露磁盘余量 API，只能走 Node 的 `statfs`。 |
| 有没有现成的「这是什么媒体类型」包 | `ls node_modules \| grep -iE '^mime\|file-type\|^media-typer\|^magic'` | **没有装**。生态里 `file-type` 是这件事的事实标准（魔数嗅探），但本仓已经自己有一份且更贴合（见下一节），不为省几十行换掉一个已经在服役、已带测试的模块。 |

## ② 仓库里已有吗

**这一格是本次最重要的发现：三件事里有两件半，仓库里早就有了，缺的只是「谁说了算」这一层。**

| 已有的东西 | file:line | 本次怎么用 |
|---|---|---|
| 「扩展名 ↔ contentType ↔ kind」唯一真相源 | `electron/assets/mediaTypes.ts:20`（`MEDIA_TYPES`，注释写着「唯一真相源。新增格式只改这里」） | **直接复用，一行没改**。新 owner 只回答「哪个面收哪些 kind」，格式事实继续问它。 |
| 魔数嗅探（字节 > 文件名） | `electron/assets/mediaTypes.ts:151` `contentTypeFromMagicBytes` / `:213` `resolveContentType` | 复用。`file-type` 那类包要解决的问题，这里已经解决过，而且带 ISO-BMFF brand 判别等本仓踩过的坑。 |
| `<input accept>` 的生成器 | `electron/assets/mediaTypes.ts:224` `acceptAttrForKinds` | 复用，并在它上面加一层 `acceptAttrForSurface(面)`。 |
| 全类型落盘路（含嗅探 + 视频归一化） | `origin/main:electron/assets/localFileImport.ts:72` `importLocalFile` | **本次把第二条落盘路合并进它**，不新写第三条。 |
| 转码判定 | `origin/main:electron/assets/videoImportNormalize.ts:27` `videoNeedsPlayabilityTranscode` | 复用函数与调用点，只把它里面那份 hardcode codec 白名单换成「问本机」。 |

**为什么已有单源却还是出了这个 bug** —— 这才是值得记下来的一条：
`acceptAttrForKinds` 在 `origin/main` 上**只有一个生产消费者**
（`origin/main:src/workbench/assets/AssetLibraryPanel.tsx:65`，另一处是它自己的测试
`origin/main:electron/assets/mediaTypes.test.ts:92`）。
一张自称「唯一真相源」的表，全仓只有一个人用 —— 说明单源建到了「格式事实」这一层，
却没有建到「产品决定」那一层（收不收、收多大），于是后者被每个入口各写了一遍。
**结论：不新造类型表，只补它缺的那一层。**

## ③ 生态里已有吗

问题 ③「这段视频要不要转码」在生态里有明确答案，而且推翻了我们原来的做法（一张按平台猜的常量白名单）。

- 浏览器能不能解某个 codec，是**可以直接问的**，不是要猜的：`MediaSource.isTypeSupported('video/mp4; codecs="hvc1.2.4.L153.B0"')`、
  `HTMLVideoElement.canPlayType(...)`、`VideoDecoder.isConfigSupported(...)` 三个 API 都能问。
  （2026-09-14 web 检索；社区里做 HEVC 支持判定的标准做法，见
  <https://github.com/StaZhu/enable-chromium-hevc-hardware-decoding> 与
  <https://deepwiki.com/StaZhu/enable-chromium-hevc-hardware-decoding/2-hevc-support-in-chromium>）
- **同一次检索里查到的反面证据（一并记下，因为它划定了我们结论的边界）**：
  `MediaSource.isTypeSupported()` 可能在**没有硬解**时也返回 true，要判「有没有硬件加速」得用
  `navigator.mediaCapabilities.decodingInfo()`
  （来源同上：<https://deepwiki.com/StaZhu/enable-chromium-hevc-hardware-decoding/5.2-troubleshooting>）。
  **这不影响本次的判据**：我们要回答的是「**播不播得了**」（播不了才需要转码），不是「快不快」——
  软解能播就不该让用户白等十几分钟的转码。真要区分软/硬解，才需要 `decodingInfo`，那是另一个问题。
- HEVC 在 Chromium 上**因平台/构建而异**（macOS 有系统解码器，Windows 要看有没有 HEVC 扩展），
  这正是原注释「按最差平台归一」的出发点。生态的做法是**每台机器各问各的**，而不是按最差平台一刀切——
  所以本次改成渲染层探一次真本机能力送进主进程，探不到才回落到原来的保守白名单。

问题 ①②在生态里没有找到可直接借用的成品：「哪个面收哪些媒体」是产品决定，本来就该自己声明；
「上限按磁盘余量派生」是个直白做法，没有值得引入依赖的现成件（见第①格）。

## ④ TikHub 自媒体观点

**没查。** TikHub 那条源是用来看自媒体/创作者社区在讨论什么框架、什么观点
（见 `docs/lessons/tikhub-research-source.md` 的定位）。本次三个问题分别是
「存储边界的准入语义」「磁盘余量」「codec 解码能力」——都是可以在依赖、仓库、规范里直接验证的事实问题，
不是观点问题。为这种问题去翻自媒体内容属于凑数，所以明写没查，而不是编一段。

---

## 落到方案里的三条结论

1. **不新造媒体类型表**：`mediaTypes.ts` 已经是单源，本次只在它上面补「哪个面收哪些 kind」这一层
   （它缺的正是这一层：全仓只有一个生产消费者）。
2. **不引磁盘空间依赖**：用 Node 自带 `fs.statfsSync`（`@types/node/fs.d.ts:1216`），Electron 不提供替代品。
3. **不按平台猜 codec**：改成问本机（`MediaSource.isTypeSupported`），并接受它「不区分软/硬解」的
   已知局限——因为我们要判的是能不能播，不是快不快。
