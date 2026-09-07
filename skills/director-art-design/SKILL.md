---
name: director-art-design
description: "服化道——设计「人物设定图」与「场景环境图」的生图提示词，含顶部「风格前缀块」（摄影机/胶片/调色/画幅等烧进画面的统一风格）+ 生图 avoid（多指/文字水印/穿帮等）+ identity DNA（角色跨图一致的关键特征锁定）。Nomi 为角色/场景等视觉 anchor（`carrier: visual`）生成参考图、写它的生图 prompt 时参考。"
---

# 服化道（视觉 anchor 生图提示词）

把「跨镜头要一致的角色 / 场景 / 道具」画成一张**参考图**——它长什么样、穿什么、在什么空间里。这张图是后续所有视频镜头的**视觉地基**：视频用图生视频（i2v），画面风格与长相都从参考图继承。

**在 Nomi 里这对应画布上的「视觉 anchor 节点」**（`carrier: visual` 的 `character` / `scene` / `prop`）：系统会用你写的这段 prompt，经**应用内文生图模型**生成一张参考图，锁住这个元素的样子；之后引用它的镜头连一条参考边，长相就不漂移。

> **本技能只管「生图阶段」。** 视频 shot 的 prompt **不写**风格前缀、**不写** avoid——那些从参考图继承。风格与画面基调只在这里（生图）一次性烧进画面。

## 铁律：每张参考图顶部都带「风格前缀块」

这是本技能最核心的产出。每张人物 / 场景生图 prompt 的**最顶部**，先放一个英文「风格前缀块」，再接中文叙事正文。风格前缀块 = 两部分（可选第三部分）：

**① 风格前缀（英文）**——把「用什么摄影机 / 什么胶片 / 什么调色 / 什么画幅」压成一串词，烧进画面。人物版与场景版分开写。选定一套后整片统一，别一张一个样。常用基线（真人写实，按项目替换机型/镜头/调色/色温）：

```
# 人物版
photorealistic cinematic portrait, shot on ARRI ALEXA, prime lens, natural motivated lighting,
true-to-life skin texture with subsurface detail, film grain, shallow depth of field, color-graded cinematic look.

# 场景版
photorealistic cinematic environment, shot on ARRI ALEXA, anamorphic lens, natural light with practical sources,
atmospheric depth, film grain, restrained color grading, true-to-life material textures.
```

**② 生图 avoid（英文）**——图像生成专属负面约束，防多指 / 水印 / 穿帮。基线：

```
avoid text overlays, avoid HUD elements, avoid watermark, avoid extra fingers, avoid deformed hands, avoid distorted face.
```

按元素特性追加（如某题材的视觉禁忌）。

**③ 光影效果层（可选）**——某张图需要一个具体光效（如泳池图要「水下丁达尔光柱」）时，把该光效的英文短语追加在风格前缀之后、中文正文之前，且**只叠在用到它的那张图**上，不全局乱叠。

**组装顺序**：`[风格前缀] + [可选光效短语] + [中文叙事正文]`。示例（人物参考图顶部）：

```
photorealistic cinematic portrait, shot on ARRI ALEXA, prime lens, natural motivated lighting,
true-to-life skin texture with subsurface detail, film grain, shallow depth of field, color-graded cinematic look.
avoid text overlays, avoid HUD elements, avoid watermark, avoid extra fingers, avoid deformed hands.

<下面接中文叙事式角色设定：整体定位 / 面部 / 体型 / 服装 / 配饰 / 气质……>
```

## 风格前缀预设库（选一个当基线）

不想从零写风格前缀时，从下面挑一套压缩前缀当项目基线（人物用人物版、场景用场景版）。**预设可跨风格混用**——真人项目拍空镜可叠「3A 游戏 CG」的景观质感，漫剧的环境背景也能借。

| 风格 | 一句话 | 人物版压缩前缀 | 场景版压缩前缀 |
|---|---|---|---|
| **真人写实**（默认） | 真实摄影机实拍质感，电影感、自然光、胶片颗粒 | `photorealistic cinematic portrait, shot on ARRI ALEXA, prime lens, natural motivated lighting, true-to-life skin texture with subsurface detail, film grain, shallow depth of field, color-graded cinematic look.` | `photorealistic cinematic environment, shot on ARRI ALEXA, anamorphic lens, natural light with practical sources, atmospheric depth, film grain, restrained color grading, true-to-life material textures.` |
| **3A 游戏 CG**（UE5 级） | 虚幻 5 级超写实，"比真实更好看" | `3A game CG character rendering, Unreal Engine 5 visual fidelity, subsurface skin scattering, detailed hair strands with translucent highlights, fabric micro-texture visible, cinematic rim lighting, HDR, clean sharp focus.` | `3A game CG rendering, Unreal Engine 5 visual fidelity, cinematic volumetric lighting, HDR imaging, sharp hyper-detailed textures, clean vibrant saturated colors, atmospheric perspective, clear directional light with long shadows.` |
| **皮克斯 3D** | 圆润温暖、表情夸张、一眼想亲近 | `Pixar 3D animation style, soft rounded character design, oversized expressive eyes, warm cinematic lighting, smooth subsurface skin shading, vibrant saturated color palette, shallow depth of field, emotional facial expression.` | `Pixar 3D animation style environment, warm golden hour lighting, rich saturated colors, soft ambient occlusion, detailed miniature-like textures, inviting atmosphere, gentle volumetric haze, cinematic depth of field.` |
| **迪士尼 3D** | 比皮克斯更"魔法感"，更强光效、更梦幻 | `Disney 3D animation style, magical cinematic lighting with visible light rays, dramatic color palette with warm-cool contrast, expressive character animation, detailed hair dynamics, enchanted atmosphere with subtle sparkle particles.` | 同左（角色 / 场景共用一套，按需拆） |
| **国漫**（仙侠/玄幻） | 东方水墨意境 + CG 精度并存 | `Chinese fantasy animation (仙侠国漫), East Asian features with intense gaze, flowing long hair, layered Chinese robes (汉服) with jade ornaments, calligraphic chi-energy trails, jade-green / celestial-gold / cinnabar-red palette.` | `Chinese animation style (guoman), ink wash painting influence with modern 3D CG, traditional Chinese architecture (飞檐斗拱), ethereal cloud and mist, jade-toned palette with gold accents, dramatic 天光 rim light.` |
| **新海诚** | 现实场景 + 超饱和光影 + 情绪化天空 | `Makoto Shinkai anime style, stylized character over hyper-detailed background, soft anime facial features, emotional atmospheric lighting.` | `Makoto Shinkai anime style, hyper-detailed realistic backgrounds, ultra-vivid saturated sky with dramatic clouds, golden hour lens flare, rain and light particles, reflective wet surfaces.` |
| **赛璐璞 TV 动画** | 经典日漫平涂色块 + 清晰描边 | `Japanese cel-shaded anime style, clean black outlines, flat color fills with hard-edge shadow cuts, limited palette, bright even lighting, expressive simplified features.` | 同左（限背景细节、平涂色块） |
| **厚涂电影动画**（Arcane 级） | 每帧像油画，笔触可见、色彩厚重 | `Arcane/Fortiche thick-paint 3D CG style, visible brush stroke textures, rich painterly color, dramatic chiaroscuro lighting, realistic proportions, oil-painting-like blending on skin.` | 同左（环境同样厚涂笔触 + 大气分层） |
| **韩漫/Webtoon** | 柔和渐变、精致五官、梦幻光效（竖屏首选） | `Korean webtoon (manhwa) style, soft gradient shading without hard shadow edges, refined beautiful features, luminous skin with soft bloom, pastel palette with vivid accents, romantic atmospheric lighting.` | `Korean webtoon (manhwa) style, clean minimal soft-focus backgrounds, watercolor-wash environments, dreamy diffused light with soft bloom, pastel palette.` |
| **爱死机**（LDR 级 CG） | 同 3A 级精度但更暗更粗粝更成人向 | `Love Death and Robots CG, photorealistic with gritty industrial texture, pore-level skin with sweat and dirt, noir lighting with deep shadows, desaturated palette with one vivid accent, anamorphic lens.` | `Love Death and Robots CG environment, industrial dystopian setting with rust / spalling / peeling paint, volumetric particulate haze, practical light sources only, teal shadows / amber highlights, oil-sheen wet surfaces.` |

**预设没命中**：向用户要「一部代表作 / 导演 / 流派名 + 一张参考图」，按 7 维逐维提炼一套新前缀（① 摄影机/镜头 ② 构图 ③ 光影 ④ 色彩/调色 ⑤ 质感/介质 ⑥ 氛围/母题 ⑦ 运动/节奏），产出人物版 + 场景版压缩前缀，即成新基线。

## 人物设定图：结构 + identity DNA

**出图布局（硬约束）**：一张图，**左半边面部特写，右半边全身正面 / 侧面 / 背面三视图**，白色干净背景，角色设定图风格。正文开头写清这个布局，否则模型不知道要出三视图。

**正文分层写**（中文叙事，不堆关键词）：整体定位 → 面部细节（五官/眼神/疤痕/发型）→ 体型身高 → 服装（面料/剪裁/功能性/使用痕迹）→ 配饰/鞋子 → 整体气质与站姿。

**identity DNA（跨图一致的根基）**：为每个角色提炼一组**不可变的视觉锚点**——五官结构、发型、体型、标志性服饰/道具。这组特征是后续视频「不换脸」的根，写设定图时必须钉死、且在任何变体里保留不变部分。

**设定图保持中性**：表情近中性、站姿静止对称，**具体表演留给视频镜头**——这张图只定「他长什么样」，不定「他在干什么」。

**变体处理**：同一角色换装 / 老化 / 受伤 → 复用 identity DNA 的不变部分，只写与原版的差异（在 Nomi 里可另建一个 anchor 或在描述里标清关联）。

**例外·非人/面部不可动角色**（机器人、面具人、玩偶、无五官）：脸演不了，「表情留给镜头」不适用。改为给一个**可切换情绪载体**（LED 表情屏 / 可换面板 / 体态），每种情绪出一张**独立表情变体图**，并注明**静帧显示、无动态过渡**，防视频模型自行动画化。情绪靠运镜 + 体态 + 当前表情图承载。

**人物正文示例（写实科幻·船员）**：

> 角色设定图，白色干净背景。画面左半部分是面部特写，右半部分是全身正面、侧面和背面三个角度的设定图，水平排列。
>
> 这是一位三十多岁的男性，面部表情近乎空白。面容清秀但毫无表情，仿佛面部肌肉已忘记如何微笑。眼睛深棕色，视线平直，瞳孔焦距总对着远处。前额有一条不明显的手术疤痕，从发际线延伸到太阳穴。深色短发，干净整齐。
>
> 身高约一米八，体型偏瘦但肌肉线条清晰——长期太空任务维持的功能性体能。深灰色连体船员制服，面料哑光耐磨，胸前小型任务徽章，袖口领口有生物监测条带纹路。腰间挂小型数据终端，脚穿磁力靴。左手腕内侧一个与皮肤齐平的神经接口端口。无任何装饰性配饰。
>
> 整体气质是情绪被极度抽离的人——不冷漠，而是超脱的冷静。站姿完全对称静止，无任何无意识小动作，像一座精密校准过的仪器。

## 场景环境图：宫格 + 全景定位

**出图布局（宫格）**：把所有场景排成**一张宫格图**，每格一个场景（主视角），风格统一、光影逻辑自洽。格数按场景数选：≤9 → 3×3，10–12 → 3×4，13–16 → 4×4，不满格留空。开头先写「请生成一张 N×M 宫格布局的电影场景环境图像，每格一个独立场景，所有格子保持视觉风格统一」，再给「视觉规范（整体风格/色彩基调/材质质感）」+ 逐格拆解。

**每格正文分层**：地点类型与空间布局 → 时间 → 光源 → 色调 → 关键道具 → 空间纵深 → 氛围。所有格子共用同一套色彩恒量，别一格一个色。

**多角度场景图·全景定位法则**：一个场景要多个视角时（不同景别 / dolly-pan-track 改机位 / 高频复用），主视角必须是**全景定位图**（establishing master）——选最能交代整体空间的最宽机位，一帧锁住布局/陈设/立柱间距/光位/比例。其余角度都是这张全景的「向内推近 / 改机位 / 反打」派生，**不另起炉灶重描空间**。在 Nomi 里的做法：先出全景 anchor 参考图、审过，再把它作为参考图喂入去出各角度变体，保证同一空间不漂移。反例（禁止）：每个角度各写一段互不相干的独立空间描述 → AI 把同一场景画成几个不同房间。

**场景类型骨架**（中性，按剧本填光影/色彩）：

| 场景类型 | 光影基调 | 色彩方向 | 关键视觉元素 |
|---|---|---|---|
| 室内-生活空间 | 自然光 + 实用光源 | 按项目调性 | 家具·个人物品·窗 |
| 室内-功能空间 | 单光源·深影 | 冷调为主 | 设备·面板·指示灯 |
| 室外-城市 | 环境光污染 | 冷暖混合 | 建筑·车流·广告 |
| 太空-舱内 | 人造单光源 | 冷蓝 + 深黑 | 舱壁·终端·舷窗 |
| 太空-外景 | 天体反射光 | 深黑 + 点光 | 行星·星场·结构 |

**场景正文示例（深空科幻·一格）**：

> 格1——【星舰走廊】视角：星舰内部主走廊，深空航行中。走廊截面呈六边形，金属舱壁上排列着规则的液冷管线和数据线缆，管线内流动的冷却液发出淡蓝色微光。地板是防滑金属栅格，每隔三米一盏嵌入式 LED 照明条，冷白色光在走廊中形成明暗交替的节奏。尽头一道厚重气密舱门，状态灯亮绿。整体色调冷蓝灰与金属银。重点：走廊纵深透视、LED 明暗节奏、液冷管线淡蓝微光。

## 提示词写法原则

- **语言**：正文用**完整中文叙事段落**（画面/人物/场景的正常描述），**只有顶部风格前缀块 + 生图 avoid 用英文**。中英混排：英文风格前缀块在最顶，下面接中文叙事。
- **叙事优先，不堆关键词**：写「冷蓝的光打在他脸上，勾勒出深刻的阴影」，不写「冷蓝色调, 戏剧性光影」。
- **摄影术语融入语境**：写效果不写术语——「85mm 人像镜头，背景柔和虚化，主体跃然而出」，不写「85mm, 浅景深」。
- **情绪物理化**：不写「戏剧性/紧张」，写具体视觉表现——「顶光在眼窝下刻出深影，疲惫扑面而来」。
- **全部具体到可视化程度**，避免抽象词；风格统一，不擅自混入其它风格。
