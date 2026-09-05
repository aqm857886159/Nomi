# 剪辑面「资源库 / AI 素材库」调研（2026-09-05）

> 证据标签：**[实测/代码]**=本地代码或可复现源码观察；**[官方文档]**=产品官方页面/文档原文；**[评测转述]**=第三方评测或口碑转述；**[推测]**=基于上述证据的设计判断。本文只把能追溯到来源的内容写成事实。

## 0. 一句话结论

[推测] Nomi 不应该复制剪映那种“下载特效商城”，而应该把资源库收敛成一个入口、三类来源：**项目内已有资产、生成即资产、带授权快照的免费商用候选**；贵的生成在对话里给出可读的确认卡，结果统一进项目素材库，再由用户拖到正确的轨道或缝。

## 1. 四家分类对照表

| 产品 | 一级分类与来源 | 许可如何呈现 | 放在哪 | 怎么进时间轴 | 证据标签 |
|---|---|---|---|---|---|
| 剪映 / CapCut | `Media → Library`：AI materials、Trending、Green screen、Life、Scenery、Intro 等 stock video；`Audio → Music / Sound effects`；另有 Text、Stickers、Effects、Transitions、Filters。来源是平台内置资源、stock 和 AI 工具混合。[官方文档](https://www.capcut.com/resource/how-to-use-capcut) | 官方营销文案写“free / royalty-free”，但本次官方页没有展示逐条素材的 license URL、作者、抓取时间或商用风险状态；不能把“免费”当成逐条商用证明。[官方文档](https://www.capcut.com/resource/free-stock-footage) | 左侧编辑面板的 Media/Audio/Text/Stickers/Effects/Transitions；素材库和剪辑面紧贴。[官方文档](https://www.capcut.com/resource/how-to-use-capcut) | stock footage 点选后拖到 timeline；贴纸拖到目标帧；模板有 “add to timeline”；转场作用于相邻片段之间。[官方文档](https://www.capcut.com/resource/free-stock-footage)、[官方文档](https://www.capcut.com/resource/capcut-stickers)、[官方文档](https://www.capcut.com/resource/ai-capcut-template) | [官方文档] |
| ChatCut | `Library` 内置 Effects、Transitions、LUTs、Sound Effects；相邻 `Templates` 是预制编辑内容；两者与 `My Assets`（上传、录制、生成）分开。[官方文档](https://chatcut.io/docs/library) | Library 文档没有逐项 license 字段；AI Music 产品页称 royalty-free original music，但没有给出本次素材的许可快照字段。应视为“产品声明”，不是 Nomi 可复用的授权证据。[官方文档](https://chatcut.io/features)、[官方文档](https://chatcut.io/docs/music-and-sound-effects) | 可配置 workspace；默认 AI 和媒体面板在 Viewer 旁，Timeline 在下方；Workspace 菜单显示/隐藏 AI、My Assets、Library、Transcript、Timeline。[官方文档](https://chatcut.io/docs/editor-overview) | 内置效果拖到兼容 clip；转场拖到两个相邻 clip 的 cut；音效拖到 audio track；模板可 `Add to timeline` 或拖放；AI 生成结果进 My Assets，完成后拖到 Timeline，也可按 prompt 直接放置。[官方文档](https://chatcut.io/docs/library)、[官方文档](https://chatcut.io/docs/video-generation-models) | [官方文档] |
| Descript | `Stock media library`（图片/视频等预录素材）与项目媒体、Underlord 对话分工；Underlord 可以搜索 stock，也可以生成自定义 B-roll。官方把 stock 定义为预录库，把 generative B-roll 定义为从零生成或重构已有片段。[官方文档](https://www.descript.com/blog/article/underlord-ai-video-editor-primer)、[官方文档](https://www.descript.com/tools/generative-video-b-roll) | Creator 方案写 `royalty-free stock media library`；本次官方页面没有显示逐项作者、license URL 或导出授权清单。[官方文档](https://www.descript.com/tools/generative-video-b-roll) | 素材仍在编辑器/时间线语境内；Underlord 是右下角的 AI co-editor 对话入口，不是一个单独的“AI 素材商城”。[官方文档](https://feedback.descript.com/changelog/the-new-underlord-now-on-for-everyone-beta) | Underlord 可按 prompt 把 stock 加到 media placeholders；生成 B-roll 在时间线内替换 placeholder/微调，再继续编辑。[官方文档](https://www.descript.com/underlord)、[官方文档](https://www.descript.com/tools/generative-video-b-roll) | [官方文档] |
| OpenCut classic | Assets 面板一级 tab 有 Media、Sounds、Text、Stickers、Effects、Transitions、Captions、Adjustment、Settings；Media 主要是项目上传资产；Stickers 当前 `All / Flags / Shapes`；Transitions view 源码仍是 “coming soon”。[源码证据](https://raw.githubusercontent.com/OpenCut-app/opencut-classic/main/apps/web/src/components/editor/panels/assets/index.tsx)、[源码证据](https://raw.githubusercontent.com/OpenCut-app/opencut-classic/main/apps/web/src/stickers/categories.ts) | Sounds 通过后端搜索结果带 `license` 字段，并默认打开 “Show only commercially licensed”；但 Media/Effects/Stickers 没有统一 license snapshot。[源码证据](https://raw.githubusercontent.com/OpenCut-app/opencut-classic/main/apps/web/src/sounds/components/assets-view.tsx)、[源码证据](https://raw.githubusercontent.com/OpenCut-app/opencut-classic/main/apps/web/src/sounds/sounds-store.ts) | 编辑器侧边 Assets 面板；每个一级 tab 独立视图。[源码证据](https://raw.githubusercontent.com/OpenCut-app/opencut-classic/main/apps/web/src/components/editor/panels/assets/index.tsx) | Media 资产拖到 Timeline；Sounds 可预听、保存，点 `Add to timeline`，代码在当前播放头自动创建 audio element；Effects 卡片可拖放或一键在当前时间插入；Transitions 尚未实现。[源码证据](https://raw.githubusercontent.com/OpenCut-app/opencut-classic/main/apps/web/src/sounds/sounds-store.ts)、[源码证据](https://raw.githubusercontent.com/OpenCut-app/opencut-classic/main/apps/web/src/effects/components/assets-view.tsx) | [实测/代码] |

### 1.1 读表后的事实

- [官方文档] 四家都把“可直接使用的东西”放在编辑面板附近，而不是藏在项目设置里。
- [官方文档] ChatCut、Descript 把“生成”与“库”拆开：库负责可预览、可拖放的现成内容；对话负责把缺的东西生成出来。
- [实测/代码] OpenCut classic 是最接近传统“素材面板”的开源样本：项目媒体、音效、贴纸、效果各一个 tab，但转场仍未完成；音效是四家里授权呈现最明确的一个。

## 2. 「AI 素材」各家怎么做

| 产品 | AI B-roll / 视频 | AI 配乐 | AI 音效 | AI 配音 | 是 tab、对话还是两者 | 生成前花费确认 | 生成结果进哪里 |
|---|---|---|---|---|---|---|---|
| 剪映 / CapCut | `Media → Library` 有 AI materials，官网另有 Video Generation、script-to-video；本次资料没有证明“AI B-roll 结果如何命名/入库”。[官方文档](https://www.capcut.com/resource/how-to-use-capcut)、[官方文档](https://www.capcut.cn/) | AI Music 是独立 AI 能力；官方页说明可按需求生成背景音乐，但未看到逐次扣费确认卡。[官方文档](https://www.capcut.com/resource/ai-music-software) | Sound effects 库与“AI sound effects generator”并存；官方称可分析动作、转场和场景并生成/插入匹配声音。[官方文档](https://www.capcut.com/tools/sound-effects) | Text → Text to speech；生成后加回视频项目/时间线。[官方文档](https://www.capcut.com/resource/how-to-make-ai-voices) | 两者都有，但入口明显偏工具栏/面板；对话式统一编排证据不足。[推测] | 本次官方资料没有逐项确认卡证据；成本呈现不明。[官方文档] | 多数功能直接加回当前项目时间线；统一“生成资产库”证据不足。[官方文档] |
| ChatCut | AI panel 可切换 Agent / Video Gen；Video Gen 支持文本、图片、首尾帧、参考或源视频，完成后进 My Assets，可拖到 Timeline，也可在 prompt 指定放置。[官方文档](https://chatcut.io/docs/video-generation-models) | AI panel/Agent prompt 生成；先查 Library，缺少独特内容才生成；结果跟踪在 My Assets，可拖到音频轨或按 prompt 直接放置。[官方文档](https://chatcut.io/docs/music-and-sound-effects) | 同上；Library Sound Effects 是现成 tab，AI 是 prompt，两条路并存。[官方文档](https://chatcut.io/docs/library)、[官方文档](https://chatcut.io/docs/music-and-sound-effects) | `+ → Voices` 选 Voice Library/My Voices，再发脚本；生成音频出现在 My Assets，未自动放置就拖到 A1/A2。[官方文档](https://chatcut.io/docs/ai-voiceover) | 明确“两者都有”：Library/My Assets 是手动面，Agent/Video Gen 是对话面。[官方文档](https://chatcut.io/docs/editor-overview) | Video/Image/Motion Graphics 可能弹 confirmation card，显示 action、references、credit estimate；Music/SFX 文档要求有 estimate 就先看；Voiceover 说明会消耗 credits。[官方文档](https://chatcut.io/docs/generation-confirmations)、[官方文档](https://chatcut.io/docs/credits-policy) | My Assets 是生成任务与结果的统一回流点；成功后可预览、拖 Timeline。[官方文档](https://chatcut.io/docs/video-generation-models) |
| Descript | Underlord 可按一句话找 stock B-roll，也可生成自定义 B-roll；官方明确“stock = 预录库，generative = AI 从零生成/重构”。[官方文档](https://www.descript.com/blog/article/underlord-ai-video-editor-primer)、[官方文档](https://www.descript.com/tools/generative-video-b-roll) | 本次官方材料证明了 music 可加到 social clips，但没有看到一个独立 AI Music 生成器的稳定文档入口；不把它写成已证实能力。[官方文档](https://www.descript.com/clips) | 未找到本次官方资料中可核实的独立 AI SFX 生成路径。[未能访问] | AI Speech、voice clones、Underlord dubbing/配音均有官方说明。[官方文档](https://feedback.descript.com/changelog/the-new-underlord-now-on-for-everyone-beta) | 主要是对话指令 + 时间线内处理；stock library 是被 Underlord 调用的来源，不是“AI 素材 tab”。[官方文档](https://www.descript.com/blog/article/underlord-ai-video-editor-primer) | 方案按月 AI credits；本次页面没有逐次生成前的单任务确认卡说明。[官方文档](https://www.descript.com/tools/generative-video-b-roll) | 结果留在当前编辑项目/时间线语境，不是外部下载后再导入。[官方文档](https://www.descript.com/tools/generative-video-b-roll) |
| OpenCut classic | 没有 AI B-roll/视频生成入口的源码证据；当前是上传/项目资产路线。[实测/代码] | 没有 AI Music 生成入口；Sounds 是搜索已有音效/音乐源。[实测/代码] | Sounds 是第三方搜索结果 + 商用筛选，不是 AI 生成。[实测/代码] | 没有 AI 配音入口。[实测/代码] | 传统 tab 为主；没有 Agent 生成素材层。[实测/代码] | 无生成步骤，因此无生成前花费门。[实测/代码] | 已有 sound 点加号直接落当前播放头；Media/Effects 直接拖/插入。[实测/代码] |

### 2.1 对 Nomi 有用的交互机制

1. [官方文档] “先查现成库，缺了再生成”比把所有内容塞到一个 AI tab 更省钱、更可控；ChatCut 的 AI Music/SFX 文档明确写了这条顺序。
2. [官方文档] 生成结果必须有一个可回看的状态面。ChatCut 用 My Assets 显示进行中/失败/完成，避免用户重复发送同一请求。
3. [官方文档] 花费确认应是“这次具体会做什么 + 预计花费 + 允许/拒绝”，而不是只问一个 Yes/No；ChatCut 的 confirmation card 和 credits history 形成了前估算、后核对两段证据链。
4. [推测] Nomi 的 B-roll 不应另开“AI B-roll 商店”；应沿用 Agent/Video Gen 生成路径，完成后回到同一项目素材池。

## 3. Nomi 现状对账

### 3.1 已有的项目资产库

- [实测/代码] `AssetRef` 只有 `image | video | audio | model3d` 四类，来源只有 `canvas | project`，并用 `AssetOrigin` 区分画布节点或项目文件：`src/workbench/assets/assetTypes.ts:15-16, 27-55`。
- [实测/代码] 画布节点结果会派生为素材，项目文件也会派生为素材，`useAssetPool` 合并去重后成为 picker、面板和 `@` 引用的一处素材池：`src/workbench/assets/assetTypes.ts:150-192`、`src/workbench/assets/useAssetPool.ts:1-65`。
- [实测/代码] 剪辑面左侧已有“镜头 / 素材”来源栏；镜头来自生成画布，素材复用 `AssetLibraryContent`，支持 compact + audio：`src/workbench/preview/PreviewSourcePanel.tsx:16-29`、`src/workbench/assets/AssetLibraryPanel.tsx:124-176`。
- [实测/代码] 素材库支持全部项目/当前项目来源筛选、图/视频/音频/3D 类型筛选、搜索、项目文件夹，以及虚拟化网格：`src/workbench/assets/AssetLibraryPanel.tsx:137-226, 249-260`。
- [实测/代码] `AssetPickerPopover` 把快速选择器挂到 body，`AssetPicker` 显示画布横滚、最近项目素材、搜索、上传；它是快速取用器，不是第二个素材库：`src/workbench/assets/AssetPickerPopover.tsx:4-11`、`src/workbench/assets/AssetPicker.tsx:11-13, 90-141`。
- [实测/代码] 时间轴配乐空态已有 `+ 配乐` 和音频拖放区；点击后打开只接受 audio 的 AssetPicker，落点是当前播放头：`src/workbench/timeline/TimelineSecondaryAddRow.tsx:40-83`。

### 3.2 音乐 / 语音模型档案

- [实测/代码] MiniMax Music 3 已有 audio archetype，`text_to_audio`，参数包含歌词、时长、seed、推理步数和 guidance scale，结果是 `audio.url`：`src/config/modelArchetypes/minimaxMusic3.ts:12-21`。
- [实测/代码] MiniMax Speech 2.8 已有 audio archetype，`text_to_audio`，支持 voice_id、speed、volume、pitch、language_boost，结果来自 `POST /v1/t2a_v2` 的 `data.audio`：`src/config/modelArchetypes/minimaxSpeech28.ts:6-34`。
- [推测] 档案层已经能描述“生成什么”，但本次对账没有发现一个面向用户的“生成后自动写入 AssetSource/项目素材 + 预算确认卡”的统一资源回流合同；应先补这一层，而不是再造一个 AI 素材 tab。

### 3.3 来源面板与授权快照

- [实测/代码] 仓库已有 `AssetSourceEvidence` 合同，支持 `source / creator / licenseId / licenseUrl / attribution / licenseSnapshot / usageStatus / intendedRoles`；`LicenseSnapshot` 至少保存 `termsUrl / checkedAt / termsHash`：`electron/connectors/connectorDefinition.ts:145-154, 157-223`。
- [实测/代码] connector 缺失状态会降为 `rights_unknown`；browser 和 user 导入强制为 `reference_only`，不会把来源不明的本地文件升级为“可商用”：`electron/assets/projectAssetStore.ts:501-512, 518-589`。
- [实测/代码] 这证明 Nomi 已有“来源/许可快照”的底层安全边界，但当前 `AssetRef` 的 UI 素材池类型没有把 `AssetSourceEvidence` 显示为卡片字段；对用户可见的 green/amber/red 仍是缺口。
- [实测/代码] 仓库没有发现 stock provider 搜索适配器、统一素材搜索面板或导出 `asset-license-report.json` 的已落地路径；已有的是来源取证字段和 browser/connector 导入边界。此前调研也把免费商用素材标为“仍未落地”：`docs/research/2026-08-24-agent-workbench-comparison.md:116-133`。

### 3.4 是否已有 stock 接入

[实测/代码] 没有证据表明 Nomi 已接入 Pexels、Pixabay、Unsplash、Coverr、Mixkit、Videvo、Kaboompics、Bensound 等 stock provider。现有“所有项目”素材只是本地项目文件扫描，不是第三方 stock：`src/workbench/assets/useAllProjectAssets.ts:118-170`。因此不能把“素材库已有”说成“stock 已接入”。

## 4. 三层方案与第一版最小集

用户方向的三层可以直接落成三种来源，不再做四套平行入口：

1. **项目内生成资产**：画布生成结果、上传/录制文件，当前已有。
2. **生成即素材**：配乐、音效、配音、B-roll 在 Agent/Video Gen 中生成，完成后进入同一素材池。
3. **免费商用素材接入**：来源适配器抓取候选，同时落 license snapshot；搜索卡片显示 green / amber / red，不作无条件版权担保。

### 4.1 Tab 方案对比

| 方案 | 用户看到 | 代价 |
|---|---|---|
| A. 三个一级 tab：`项目` / `生成` / `免费素材` | 一眼知道“我已有的、我要生成的、我要找外部候选的”分别在哪；`生成` 不是一个下载商城，而是生成任务和结果回流面 | 多一个一级导航；必须保证三个 tab 读写同一 AssetRef/来源证据，不能各自存一份 |
| B. 一个 `素材库` tab，内部按来源筛选：`项目` / `生成` / `免费商用` | 入口最少；与现有 AssetLibraryPanel 的 source filter 方向一致 | 生成前配置和花费确认容易被挤进浏览器面板，用户可能把“搜索现成素材”和“发起生成”混在一起 |
| C. 只保留 Agent 对话，素材库只展示结果 | 最符合生成型产品；一句话“给我一个 6 秒雨夜街景”即可 | 复用/回看/授权检查变差；用户找不到已生成的音效和配音，也无法快速替换 |

[推测] **推荐 B 的壳 + A 的语义**：保留一个 `素材库` tab，内部固定三段来源筛选；`生成` 是一个高信息密度的“生成入口/任务状态”区，真正执行仍由 Agent/Video Gen 完成。这样不增加一级导航，却把三层概念说清楚。

### 4.2 第一版最小集

| 层 | 第一版做什么 | 用户动作 | 先不做什么 |
|---|---|---|---|
| 项目内生成资产 | 复用现有 `AssetLibraryContent`、`AssetPicker`、`My Assets`；补一个统一资产卡字段：来源（画布/项目）、类型、是否已放入时间线 | 搜索/预览 → 拖到轨道；音频默认落当前播放头；视频/图片拖到视频轨；转场若以后加入则拖到两片之间 | 不再新造第二个项目素材库；不做跨项目复制协议 |
| 生成即素材 | 先接已有 Music 3、Speech 2.8；AI SFX 和 B-roll 沿同一 `text_to_audio` / video generation 回流；每个结果先进入项目素材池，支持预览、重命名、拖放 | Agent/Video Gen 输入目标、时长和放置位置 → 看预计消耗 → 允许 → 结果进素材库 → 拖到轨道或按指令自动放置 | 不做独立 AI 素材商城；不做一次生成自动铺满全片；不做隐藏的自动扣费 |
| 免费商用素材 | 只接一个来源适配器做候选检索；每张卡保留 provider、原始 URL、作者、license URL、抓取时间、署名文本、人物/商标/编辑用途警告、green/amber/red | 搜索 → 预览 → 看授权证据 → 导入项目 → 卡片继续带快照 → 导出时生成授权清单 | 不承诺“免费=无条件商用”；不先接多个站点；不做下载特效包 |

### 4.3 生成与放置的最小流程

1. [推测] 用户在 Agent 中说：“给这段产品演示生成 30 秒无歌词电子配乐，放到配乐轨，告诉我会花多少。”
2. [推测] Nomi 先回一张确认卡：模型、时长、用途、预计 credits、目标轨道、是否允许自动放置。
3. [推测] 用户允许后，任务卡显示进行中；结果写入 `My Assets / 素材库 → 生成`，不覆盖原文件。
4. [推测] 默认按用户指定落点放置；若用户没指定，只进库并提示“拖到时间线”。
5. [推测] 生成失败不重复扣费；失败状态、实际扣费和重试边界都留在任务卡/账单明细。

## 5. 抄 / 避

### 可以抄

- [官方文档] **ChatCut 的双面结构**：Library 是现成、可预览、可拖放的内容；Agent/Video Gen 是缺口生成；两者都回到 My Assets。
- [官方文档] **ChatCut 的放置语义**：效果落 clip、转场落 cut、音效落 audio track；Nomi 也应让每种素材知道“轨道/缝/片段”三个落点，而不是全部都 append 到末尾。
- [官方文档] **ChatCut 的花费闸**：生成前 estimate + Allow/Deny，生成后 Credits history 是最终事实；这比模糊的“可能消耗积分”更可信。
- [实测/代码] **OpenCut 的商用音效筛选**：`commercialOnly` 默认打开，卡片同时支持预听、保存、Add to timeline；这是免费素材接入最小可用的交互骨架。
- [官方文档] **Descript 的“对话调用素材库”**：Underlord 可以按脚本寻找 stock，也可以在同一时间线生成定制 B-roll；用户不必先学会 provider 搜索语法。

### 明确避开

- [推测] **不做剪映式下载特效库**：它会把 Nomi 从“生成和编辑同一份作品”拖成素材商城，带来版权、缓存、版本和排序维护成本，却不增强 Nomi 的生成护城河。
- [推测] **不把 AI 素材做成孤立 tab**：只做 tab 会让用户生成后还要手动搬运；只做对话又会让已生成资产不可发现。推荐一库一回流、两个操作面。
- [官方文档] **不照搬“免费/royalty-free”一句话**：CapCut/Descript 的官方页面没有给出 Nomi 所需的逐项快照字段；Nomi 必须把来源证据放在卡片和导出清单里。
- [推测] **不默认把外部素材拖进别的项目**：当前 Nomi 的跨项目 all-assets 已经选择“外部项目只预览，不直接写入时间线”，这是正确的安全边界，应继续保留直到有 materialized copy 合同。
- [推测] **不让 Agent 绕过用户的贵步骤确认**：便宜的本地编辑可自动做，生成、第三方下载和可能带授权风险的导入要在动作发生前给可读确认。

## 6. 花费与未能访问

### 花费边界

- [官方文档] ChatCut credits 文档给出当前示例：AI music 0.18 credits/首，AI sound effects 0.12 credits/生成秒，AI voiceover 约 0.28–0.80 credits/千字符或 0.08–0.12 credits/生成秒；视频按模型、分辨率、秒数计费，完成后按 0.01 credit 取整。[官方文档](https://chatcut.io/docs/credits-policy)
- [官方文档] ChatCut 明确：上传、整理素材库、浏览项目、手动剪辑、转录、导出不消耗 ChatCut credits；AI video/image/motion graphics 可能先弹 confirmation card，最终金额以 Credits history 为准。[官方文档](https://chatcut.io/docs/credits-policy)、[官方文档](https://chatcut.io/docs/generation-confirmations)
- [官方文档] Descript 采用每月 AI credits/plan（Free 100、Hobbyist 400、Creator 800 的页面快照），本次没有找到每次生成前的单任务确认卡。[官方文档](https://www.descript.com/tools/generative-video-b-roll)
- [官方文档] CapCut 官方资料展示了 AI video、AI music、AI voice 等能力，但本次公开页面没有给出统一的逐次花费确认和最终扣费核对流程；不能据此假设“免费”或“生成前必确认”。

### 未能访问 / 证据缺口

- 仓库当前 `origin/main` 不包含用户点名的 `docs/research/2026-09-05-chatcut-conversational-editing-teardown.md` 和 `scratchpad/chatcut-user-screenshots-notes.md`；本次没有找到同名文件的其他副本。报告没有把“ChatCut 资源库 tab：MG 动画 / 音效 / 转场 / 特效”的用户真机截图当作已实测证据，而是用 ChatCut 官方 Library 文档核对到 Effects / Transitions / LUTs / Sound Effects。
- ChatCut `generation-confirmations` 页面可通过官方文档访问并已保存 DOM；一次 curl 连接失败后重试成功。ChatCut task-progress 搜索结果指向的路径在本次静态抓取中返回 404，因此只使用搜索返回的官方页面摘要，不把它当作本地 DOM 快照。
- Descript 官方页面明确 stock、generative B-roll、AI Speech/Underlord，但本次没有找到可核实的独立 AI Sound Effects 生成页面，也没有把 Descript 写成已具备该能力。
- OpenCut classic 仓库已归档；源码仍可读，但其 Transitions view 明确显示 “coming soon”，不能把它当作已完成能力。

### 本次证据文件

一手页面/源码 DOM 与快照保存在 `docs/research/2026-09-05-editing-library/`：CapCut、ChatCut、Descript 官方页面，以及 OpenCut classic 的 Assets/Sounds/Effects 源码。截图不进 git。

来源方法沿用仓库既有调研：先读 `docs/research/2026-08-24-agent-product-interaction-survey.md` 与 `docs/research/2026-08-24-agent-workbench-comparison.md` §5 的 green/amber/red + license snapshot 规则；本次没有重新发明“免费=商用”的判断。
