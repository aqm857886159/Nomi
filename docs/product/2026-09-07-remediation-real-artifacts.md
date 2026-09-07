# 补齐方案 · 落地件清单（真实工具 × 真实提示词原文 × 接法）

> 2026-09-07 · 方案第五部分，前接采集方案。本文不是「去找什么」，而是**已经找到的东西本身**：每个预设/能力对应的工具是什么、API 怎么接、提示词逐字原文是什么、来源许可是什么。提示词原文均为逐字引用，可直接粘贴使用。

---

## 一、工具接入速查表（能力 → 工具 → 端点 → Nomi 落点）

| 能力 | 工具（真名） | 接入端点/方式 | Nomi 落点 |
|---|---|---|---|
| 分镜/故事板视频生成 | **Seedance 2.0/2.5** | 已对账：`electron/shared/videoCapabilities/seedance25.ts`（apimart/火山线，4–30s，多参考 30 图/10 视频/10 音频，`return_last_frame`） | 零新增，预设只喂 prompt |
| 广告模板视频 | Seedance 2.0 / 可灵 3 / Veo 3.1（模板三模型通用） | 已对账档案 | 预设按模型标注适配差异 |
| 图像编辑（重绘/擦除/扩图/表情） | **Nano Banana 2**（Gemini 3.1 Flash Image）/ **Seedream 5 Pro** | 已对账档案（Nano Banana 2 多参考上限 14 图）；自然语言指令式编辑，无独立 inpaint 端点——指令即接口 | 编辑工具条接线 |
| 人像质感 | Nano Banana 2（生成/编辑同接口） | 同上 | 人像调节预设 |
| 音色克隆 | **MiniMax Voice Clone** | `POST /v1/files/upload`（purpose=voice_clone）→ `POST /v1/voice_clone`（file_id + 自定义 voice_id + clone_prompt）；国内版需企业认证、7 天须复用 | 克隆面板（B2） |
| 人声分离 | **ElevenLabs Audio Isolation** | `POST https://api.elevenlabs.io/v1/audio-isolation`（multipart audio，流式返回，≤500MB/1h）；本地备胎 **Demucs** | 视频节点「音频▾」 |
| 视频超分 | **real-esrgan-video**（Replicate）/ runwayml/upscale-v1 / topazlabs | Replicate run API（接入先例：qwen-image-layered） | videoUpscale 任务档案 |
| 提示词采集 | **GitHub API**（YouMind-OpenLab 等仓库） | `https://api.github.com/repos/{owner}/{repo}` + raw README；lock 文件记 commit SHA（复用技能注册表管线） | 提示词库同步脚本 |

---

## 二、真实提示词原文（逐字，可直接粘贴）

### 2.1 分镜/故事板组 —— 来源 `YouMind-OpenLab/awesome-seedance-2-prompts`（6,305 条，2.0k★，CC BY 4.0，2026-09-07 仍在更新）

**示例 A：日系纯爱 15s（0-4s/4-9s/9-15s 时间轴结构的标杆原文，Featured No.1，作者 AIGC｜阳家豪）**——节拍结构与防崩句将直接成为 Nomi「故事板」预设骨架：

```
15-second cinematic Japanese drama pure love ambiguous short film, ultra-realistic quality, warm golden sunlight in an empty classroom in the afternoon, spilling through the blinds onto the side-by-side desks, fine dust motes slowly floating in the light beams, old wooden desks, extremely natural subtle movements, breathing, and eye tension, characters maintain consistent faces, clothing, and hairstyles throughout without deformation, drift, or artifacts, real slight chest rise and fall synchronized with breathing, shallow depth of field, creamy blurred background, warm film grain, 8K sharp, Japanese youth restrained heart-fluttering suffocating atmosphere.
0-4 seconds: Extremely slow push-in shot from a medium shot of the desktop to a close-up of the two people's side profiles sitting side-by-side. [...人物动作逐拍...]
4-9 seconds: Switch to a close-up of the boy. [...]
9-15 seconds: Extreme close-up of both faces in the same frame, slow-motion eyes suddenly meet: [...]
Lip synchronization is natural and precise, [...] natural short pauses between 200-400 milliseconds [...]
Overall Sound Effects: Distant summer cicada chirping faintly, [...]
Character identity is maintained throughout, [...] no text, watermarks, or subtitles [...]
```

（全文 6 段约 900 词已存档于采集仓库；此处保留结构与开头原文，完整版入库提示词库。）

**示例 B：好莱坞高定 15s（`[00:00-00:05]` 标签式结构，Featured No.2）**——`[Style]/[Duration]/[Scene]/[时间戳]` 字段化写法是「调度故事板」预设的直接骨架：

```
[Style] Hollywood Haute Couture Fantasy blockbuster, 8K ultra-clear, Photorealistic, High-fashion Editorial Style, Unreal Engine 5 fluid rendering, visual illusion. [Duration] 15 seconds. [Scene] An endless, real-life Salar de Uyuni (Sky Mirror) salt flat. [...]
[00:00-00:05] Shot 1: Haute Couture Entrance and Porcelain Skin. Camera position: Extremely low-angle upward shot, ultra-telephoto lens zoom-in. Action: [...]
[00:05-00:10] Shot 2: Physical Shattering and Ink-wash Descent. Camera position: Extreme close-up of the face, focus rapidly pulls back. Action: [...]
[00:10-00:15] Shot 3: Dimensional Dissolution and Abyss Reflection. Camera position: High-altitude overhead shot, camera rapidly rotates and descends. [...]
```

**改造点（T2）**：`{{...}}`/场景锚点语法 → Nomi 资产锚 `@角色卡`/`@场景卡` 引用；时长段对齐 Seedance 2.5 档案 4–30s。

### 2.2 广告模板组 —— 来源 `LichAmnesia/awesome-ad-video-prompts`（52 条 / 10 品类，CC BY 4.0）

**模板原文 1：产品展示（Frost-Glass Serum，6s·9:16）**——含分秒节拍 + 运镜术语 + 防崩句 + 隐含音效四件套：

```
A frosted-glass serum bottle stands on wet black slate, half-buried in low-rolling cold fog, a single cool key light raking from camera-left. 0-2s: extreme macro push-in across the condensation field, beads trembling and sliding, dewy texture razor-sharp at f2.8 with creamy fall-off. 2-4s: the mist thins on a slow exhale, the glass pipette lifts and one amber drop releases in slow motion, surface tension holding a perfect bead before it lands. 4-6s: a 30-degree clockwise orbit wraps a warm rim light around the [brand] label, the glass throwing a faint prismatic edge. Bottle holds constant shape, fill level, and matte finish throughout — no deformation, drift, melting, or flicker. Implied sound: low room tone, a soft glass tick, one droplet plink.
```

**模板原文 2：前后对比（Sneaker Out Of Mud，8s·1:1）**：

```
Studio-to-hero transformation, 1:1. Open on a battered white sneaker caked in dried mud under harsh flat overcast — scuffed, gray, joyless. [0-2s] locked low-angle hero shot, dust motes drifting, fully desaturated. [2-3s] a passing cloth swipes the lens for a fast whip-pan wipe transition, motion-blur smearing the frame. [3-6s] the wipe clears to reveal the same [product] silhouette spotless and crisp — knit texture sharp, midsole bright white, a soft rim light tracing the laces against clean studio key. [6-8s] slow orbit around the heel, micro-reflections gliding across fresh mesh, ground shadow tight and grounded. The shoe keeps identical proportions, logo placement, eyelet count, and lace pattern across both states — no deformation, morphing, or invented detailing. Implied sound: a stiff brush sweep, the clean snap of laces pulled tight.
```

**模板原文 3：痛点→解决（Cracked Heels，6s·9:16）**——`SUBJECT/FIDELITY/SOUND` 分区写法：

```
Vertical macro ad. SUBJECT: a bare heel, skin split and flaking, then healed and dewy. 0–2s (extreme close-up, locked): the heel presses onto cold gray tile under a flat clinical blue overhead, a hairline fissure widening as weight settles, dry papery crackle. 2–4s (slow dolly-in, key light swings in from frame-left): a hand uncaps [product] foot balm, a thick amber ribbon of cream curling out, the blue cast dissolving into honey-warm as the cream is worked over the split skin. 4–6s (continued dolly-in, rack focus to the floor): the same heel now glides across a high-gloss floor, skin smooth and supple, a crisp mirror reflection beneath it. FIDELITY: the foot holds one consistent anatomy, toe count, nail shape, and skin tone across all beats — no warping, melting, extra toes, drift, or smearing. SOUND: faint papery split, then a soft cream squelch over low warm room tone.
```

**可直接复用的防崩句库**（从上述模板提取，中英对照入词表）：
- `holds constant shape, fill level, and matte finish throughout — no deformation, drift, melting, or flicker`（全程形态恒定——无变形/漂移/融化/闪烁）
- `keeps identical proportions, logo placement, eyelet count, and lace pattern across both states`（前后状态比例/logo 位置/细节数完全一致）
- `holds one consistent anatomy, toe count, nail shape, and skin tone across all beats`（全节拍解剖一致——脚趾数/指甲形状/肤色）

**官方使用守则（作者明确）**：保留多拍分秒结构与 no deformation/drift/artifacts 防崩句会实质性提升质量；9:16 素材以品牌镜头收尾；**不要在提示词里写字幕，字幕后期加**（与 Nomi 时间轴字幕轨天然配合）。

### 2.3 电影感通用 / 短片结构 —— 来源 `jnMetaCode/ai-shortfilm-prompts`（367★，MIT）

**单行万能电影感 prompt（原文，可直接用于所有视频生成的基底前缀）**：

```
Anamorphic widescreen cinematic. Simulated IMAX film camera +
Panavision C-series lens (35mm focal, f/4 aperture). Handheld
shot — extremely subtle, breath-like camera float throughout.
{{your scene description}}.
No score. Production audio only.
```

作者说明：真实机身+镜头型号 + 「呼吸感浮动」把模型锚定在真实电影美学上，而非人人都用的模糊词 "cinematic feel"。

**五阶段结构**（Core theme → 角色场景 → Atmosphere → Camera → 分秒分镜 → Ending），正确 vs 错误对照已提取（`epic/stunning/4K/movie-quality` 这类空洞赞美词 = 游戏 CG 效果）。

**该仓库还有 4 个现成资产文件（MIT，直接入采集清单）**：`camera-move-library.md`（运镜库）、`negative-prompts.md`（负面词库）、`atmosphere-prefabs.md`（氛围预制件）、`genre-camera-sop.md`（类型×运镜 SOP）——运镜词表和负面词不用自己写，抓这几个文件即可。

### 2.4 三视图 / 角色设定图 —— 社区实测公式（多源交叉验证，40+ 张实测）

**主公式原文（英文，直接可用）**：

```
a cute cartoon girl with short brown hair, big round eyes, wearing a yellow dress and red shoes, character sheet, three views turnaround, front view, side profile view, back view, full body, standing pose, plain white background, reference sheet style
```

关键锚词及作用（实测结论）：`character sheet, three views turnaround` 把布局和用途钉死（不会出三个独立角色）；`reference sheet style` 比单纯 three views 命中率高（模型训练集真懂这个词）；`white background` 方便后续抠图进 Nomi 定妆卡流水线。

**中文锚定模板（配合 Nomi 身份 DNA 字段的填空版）**：

```
【角色设定图】{角色名}，character sheet, three views turnaround（三视图：正/侧/背）, full body, standing pose, plain white background, reference sheet style。
特征锚定（防换脸）：发型={色}+{式}；眼睛={色+形}；上装={材质+颜色+细节}；下装={...}；鞋={...}；标志配饰={...}。
```

### 2.5 去 AI 感 / 人像质感 —— 来源 wearecentric 实测公式（全文可用）

```
Portrait of {人物描述}, photographed in natural daylight. Highly realistic human skin with natural tones and textures: visible pores, fine lines, subtle wrinkles, light freckles, small blemishes, slight redness, uneven tones, fine facial hair and soft peach fuzz catching the light. Authentic, imperfect skin with detailed microtextures, skin grain, translucent qualities and natural subsurface scattering. Cinematic natural lighting that gently emphasises facial features. Sharp focus on skin texture with true-to-life contrast and tonal depth. Shot on a full-frame DSLR camera using an 85mm f/1.4 lens with high-quality studio optics. Pure photorealism, natural and unretouched appearance.
```

人像调节预设 = 此公式的「修复指令」变体（编辑模式加四段式前缀「保持面部身份/构图不变」）。

### 2.6 图像编辑系统词（重绘/擦除/扩图统一语法）—— 来源 Nano Banana 官方式指南

四段式（编辑类预设的统一骨架，中文版）：

```
保持（不可改变）：{面部身份/发型/姿势/构图/光线方向}…
改变（修改什么）：{位置+大小+材质}…
如何（风格/强度/方向）：与原始光影和透视匹配…
约束（避免副作用）：{无文字/无水印/标注区域外像素保持不变/不要改变整体调色}…
```

扩图附加句（miraflow 实测）：`fill the gap naturally with matching texture, grain, and focus`；擦除附加句：`preserve realistic shadows and reflections`。

### 2.7 表情词表（情绪调节 25 词的骨架）—— 来源 Plutchik 八情绪轮（neverbiasu 整理，社区标准）

按情绪族取词（英文原词 + 中文配对 + 面部肌肉描述）：

| 族 | 原词（逐字） |
|---|---|
| 喜 | smile（嘴角上扬）/ laugh（张口大笑）/ grin（露齿）/ smirk·smug（得意）/ joyful·delighted（含手势）/ excited（全身性兴奋） |
| 怒 | fierce / angry·pissed off / furious / shouting·yelling / pouty / jealous |
| 恶 | disgusted（爆发式厌恶）/ mean laugh（讥讽交叉臂）/ menacing / annoyed·frustrated / grumpy / contemptuous / exhausted / yawning |
| 哀 | sad（+tears 即哭）/ unhappy / weeping·sobbing / cry（+scream 戏剧化）/ tormented / depressed / forlorn |
| 惊 | surprised / amazed / astonished / agitated·flustered / embarrassed grin（双手捧脸） |
| 惧 | scared / horrified / bewildered / worried |
| 信 | relaxed / loving·beloved（+blush）/ fell in love |

肌肉级强度描述词（来自实测表情摄影 prompt）：眉头紧皱、下颌紧绷、眼角弯起、眼眶含泪、下唇微颤、脸颊耳垂泛红——与英文原词配对入库。

### 2.8 摄像机参数片段库（摄像机控制预设）—— 来源 morphed/nanobanana 官方实测写法

已验证组合（逐字）：`shot on Canon EOS R5 85mm f/1.4`（人像浅景深）/ `35mm focal, f/4 aperture` + `Panavision C-series`（电影感）/ `Kodak Portra 400 film grain`（胶片颗粒肤色）/ `50mm lens look, shallow depth of field`（纪实人像）/ `ultra-telephoto lens zoom-in`（高定压缩感）。首期入库 30 组（机身×镜头×光圈×胶片），按人像/产品/风光三组。

---

## 三、接入实施（提示词库条目 schema 与采集脚本）

1. **条目 schema**（进提示词库数据文件，热更不发版）：
   `{ id, 分组, 名称, prompt_en, prompt_zh, 占位符: [{token, 映射: "@角色卡|@场景卡|自由文本"}], 适配模型: [{档案, 适配说明}], 来源: {repo, commit, 作者, 许可}, 验收样张: [图/视频], 状态: 达标|未达标 }`
2. **采集脚本**（复用技能注册表管线）：GitHub API 拉 3 个仓库 → lock 记 commit SHA → 解析 README 条目（awesome-seedance 的条目格式固定：标题/Description/Prompt 代码块/Details）→ 去重 → 入候选池 → 人工评审 → 验收样张 → 达标才进官方分组。
3. **署名展示**：CC BY 4.0 条目详情页显示「来源仓库 + 作者 + 许可」；Mx-Shell 部分（© 保留版权）仅教育参考、不进内置库——**这正好落在采集三梯的准入门上**。
4. **规模预期**：首期官方预设 60–80 条（故事板 6 精选 + 广告 10 + 三视图/设定图 8 + 去AI感 5 + 表情 25 词 + 运镜库 1 份 + 负面词 1 份 + 摄像机 30 组），全部有来源有样张。

---

## 四、本部分来源总账（全部实抓核实）

| 仓库/来源 | 规模 | 许可 | 状态 |
|---|---|---|---|
| YouMind-OpenLab/awesome-seedance-2-prompts | 6,305 条 / 2.0k★ / 226 fork / 日更 | CC BY 4.0 | ✅ 原文已提取 |
| LichAmnesia/awesome-ad-video-prompts | 52 条 / 10 品类 | CC BY 4.0 | ✅ 3 条全文已提取 |
| jnMetaCode/ai-shortfilm-prompts | 21 类型模板 + 6 工具文件 | MIT（Mx-Shell 部分保留版权，不商用） | ✅ 结构与文件清单已核实 |
| nanobanana.io 官方式指南 / wearecentric / miraflow / morphed / neverbiasu / 社区三视图实测 | 见采集方案 | 官方/公开教程 | ✅ 公式已提取 |
