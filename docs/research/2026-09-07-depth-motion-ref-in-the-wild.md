# 「深度视频当动作参考」在野实证调研（2026-09-07）

日期：2026-09-07
基线：`origin/main@d230da0a6`
性质：**只取证，不下产品结论以外的判断**。用户命题：「最近推特很多人都在弄『深度视频当动作参考』，应该已经被验证了。」本文要回答的不是「这个想法好不好」，而是**在野到底有没有人真的这么干、喂给谁、效果怎么说、有没有对照**。
口径纪律：分不清模型的一律标「未说明」，**不猜**。营销稿与个人实测分开标。

---

## 1. 一句话结论（先说答案）

> **已被验证——但验证发生在「闭源模型的通用参考视频槽」上，不是「闭源模型新增了一个深度输入」。**
> 主战场是 **Seedance 2.0 / 2.5（即梦）**：创作者自己把普通视频转成灰白深度视频，塞进 Seedance **原有的通用 `@video1` 参考槽**，靠提示词声明「这条只做动作与空间参考」。抓到 38 条 Seedance 相关帖里 **24 条明确在做深度参考**，跨 X / 抖音 / 小红书 / B 站四平台、从 2026-07 中旬起连续两个月不断更，多条帖子给了原视频 vs 深度视频的并排对照与失效边界（丢手指、丢表情、人物-道具语义弱）。
> **唯一把深度做成产品一等公民的闭源家是 PixVerse**（`Depth Map Control` Mini App，2026-07 底上线），但那是 App 里的功能，其公开 API 文档里**查不到对应参数**。
> ComfyUI/开源那条线（Wan VACE、Wan 2.2 Animate、MiniMax-H3-Fun-ControlNet、SCAIL-2）确实也有深度/姿态控制通道，但它是**另一条线**——那边深度是显式控制端口，这边深度只是「一段恰好长这样的参考视频」。

**对 Nomi 的直接含义（这是决定接法的关键）**：我们**不需要等任何供应商新增深度输入**。Seedance 2.5 的参考模式已经收视频（`video_urls` / `@video1`），深度化是**我们这一侧的预处理**。要做的是「把普通视频转深度视频」这一步 + 一段固定的槽位声明提示词，而不是去谈一个新的模型能力槽。

---

## 2. 方法与口径（可复核）

- 工具：`scripts/research/tikhub-search.mjs`（仓库现役，`origin/main@d230da0a6` 版本），密钥只从 `TIKHUB_API_KEY` 环境变量读，产物已核验不含密钥。
- 关键词 10 组（英文 6 组打 X，中文 4 组打抖音/B 站/小红书），每平台每组上限 20 条。
- 原始记录 **321 条 → 去重 302 条**（X 96 / 抖音 71 / B 站 77 / 小红书 58）。
- 用「depth / 深度图 / 深度视频 / vace / controlnet / 骨架 / pose / 动作迁移 / 参考视频 / scail / animate」正则过一遍，**得到有信号的 153 条**（X 38 / 抖音 41 / B 站 40 / 小红书 34）。下表从这 153 条里挑出**有实质内容**（说清了喂什么、喂给谁、或给了结论）的 26 条。
- 没查成的：`q10「即梦 动作参考 视频」` 的**小红书**那腿三次 400 失败（TikHub 侧 `Request failed`，其余 9 组小红书全部正常），该组小红书数据缺失；抖音/B 站正常。X 只走 `search_type=Top`，未做 Latest 全量翻页。
- 原始 JSON 全量落在 `docs/research/2026-09-07-depth-motion-ref-in-the-wild/tikhub/`（10 个子目录，各含 `tikhub-search.json` + `tikhub-search.md`）。

---

## 3. 实证清单（26 条）

**列的读法**：「喂的是什么」= 送进模型的那个文件的形态；「喂给哪个模型」= 帖子自己说的，没说就是「未说明」；「有无对照」= 帖子里有没有原始视频 vs 深度视频的并排/结论比较。

| # | 日期 | 作者 | 平台 | 喂的是什么 | 喂给哪个模型 | 入口 | 声称效果 | 对照 | 链接 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 2026-07-16 | @NexlowX | X | 原始视频 → 深度图视频 | **Seedance 2.0** | 未说明（官方 App/中转皆可） | 「喂原片模型要同时解释人、衣服、灯光、房间；喂深度图就只剩动作可解释」——舞蹈准确度被修好 | ✅ 明确对照论述（原片 vs 深度） | https://x.com/NexlowX/status/2077796149617139742 |
| 2 | 2026-07-19 | @Primee32 | X | 深度图视频 + GPT Image 2 生成的角色图 | **Seedance 2.0** | 未说明 | 同一套深度技巧从舞蹈扩到**表情/反应**也成立 | ✅ 对照论述 | https://x.com/Primee32/status/2078941698214809645 |
| 3 | 2026-07-24 | @NexlowX | X | 深度图视频 | **Seedance 2.0** | 未说明 | 从舞蹈推到**跑酷**（墙面接触、重心转移、手抓边缘的时刻）仍然稳 | ➖ 无并排，但点名「更难的问题」 | https://x.com/NexlowX/status/2080623646406525307 |
| 4 | 2026-07-19 | @PurzBeats | X | 参考视频→深度图→深度图作参考 + 参考图 + 原音轨 | **Seedance 2.0**（`Reference Video` 槽） | 未说明 | 六步 SOP：**深度图是放进「参考视频」槽的**，不是另一个入口 | ➖ | https://x.com/PurzBeats/status/2078871985841475772 |
| 5 | 2026-07-21 | @CuriousRefuge | X | 参考素材→深度→深度 + 角色参考 + 环境参考 | **未说明**（Seedance 系工作流） | 未说明 | 「我们测过最准的动作迁移工作流」 | ➖ | https://x.com/CuriousRefuge/status/2079660231265824859 |
| 6 | 2026-08-11 | @CuriousRefuge | X | 同上，二次实测 | 未说明 | 未说明 | 「要复刻非常具体的身体动作时，效果出奇地好」 | ➖ | https://x.com/CuriousRefuge/status/2087276113672475117 |
| 7 | 2026-08-01 | @underwoodxie96 | X | 深度视频 | **Seedance 2.0**，并**对比 Kling Motion Control** | 未说明 | 「深度视频 + Seedance 2.0 比直接用 Kling Motion Control 得到更自然的动作迁移」；理由是深度剥掉了原角色与场景细节 | ✅✅ **跨模型对照**（本轮最强对照条） | https://x.com/underwoodxie96/status/2083582829993300164 |
| 8 | 2026-08-15 | @SamJWasserman | X | 自建深度图参考 | **Seedance 2.5** + 参考图 | 未说明 | 「复杂编舞/打斗序列上深度映射非常强」，附深度图与成片 | ➖ 附前后素材 | https://x.com/SamJWasserman/status/2088684000059732006 |
| 9 | 2026-09-01 | @marveldcreator | X | **Blender 里生成的原片深度图** | 未说明（自述「笔记本上做完」） | 未说明 | 重建《黑客帝国》道场打斗：换演员换场景，**同样的运镜、同样的编舞** | ➖ | https://x.com/marveldcreator/status/2094801411863179345 |
| 10 | 2026-09-03 | @paripune | X | **Python 手写的深度图** | **Seedance 2.5** | 第三方前端 Flova | 手搓深度图也能驱动 | ➖ | https://x.com/paripune/status/2095461775680626963 |
| 11 | 2026-08-14 | @hazemoriartyy | X | —（教怎么产深度图） | — | **Google Colab**（浏览器即可） | 深度图的**制作门槛**已经降到「一个浏览器」 | ➖ | https://x.com/hazemoriartyy/status/2088257794734805483 |
| 12 | 2026-07-31 | @QCXINT_ | X | 参考视频 → 黑白深度（动作）视频 | 未说明 | 未说明 | 时尚类爆款视频「近乎零成本」；核心是**把动作与身份分离** | ➖ | https://x.com/QCXINT_/status/2083219185250038169 |
| 13 | 2026-07-30 ~ 08-02 | @Nusaiba0_ / @AIwithNatalia / @VictoriaBlddd / @girlxid / @Emma_Sterling1 / @jji1jj / @TheMrNexus / @EE5ii5（8 账号同期同文案） | X | 参考视频 → 深度数据 | **PixVerse `Depth Map Control`** | **PixVerse 官方 App（Mini App）** | 锁住运镜/物体位置/空间关系；武打序列实测 | ➖ ⚠️ **文案高度雷同、同窗口发布 = 推广投放，非独立实测** | https://x.com/Nusaiba0_/status/2082806028983566837 |
| 14 | 2026-09-02 | @matpuszczynski | X | **原始视频**（非深度） | **Kling** Motion Control | 未说明 | 一张照片 + 参考片，无提示词一次过 | ➖ | https://x.com/matpuszczynski/status/2095235043308281946 |
| 15 | 2026-02-12 | @RyanOnTheInside | X | 深度 / 姿态 / 光流 / 涂鸦 / 边缘 图 | **Wan VACE**（实时自回归改造） | **开源 / ComfyUI 侧** | 全套 v2v 控制通道实时跑 | ➖ | https://x.com/RyanOnTheInside/status/2021958994206577086 |
| 16 | 2025-10-15 | @ComfyUI（官方） | X | **多路控制视频：z-depth + pose + 相机运动** | **Wan 2.1 + VACE** | **ComfyUI** | 重建 Corridor Digital 的子弹时间 | ➖ | https://x.com/ComfyUI/status/1978514991574573384 |
| 17 | 2025-07-14 | @ChetiArt | X | 抠主体 → 对主体上深度图 | **Wan VACE** + Wallace&Gromit LoRA | ComfyUI | 拆解式复盘 | ➖ | https://x.com/ChetiArt/status/1944845772073398299 |
| 18 | 2026-07-22 | @大象学长 | 抖音 | 普通舞蹈/武打视频 → 深度视频 | **Seedance 2.0**（做参考） | 即梦 + Codex 产深度 | 「百分百动作完美复刻」 | ➖ | https://www.douyin.com/video/7665298660867001638 |
| 19 | 2026-07-27 | @诺皮克NovaPix | 抖音 | **深度视频 + 骨骼绑定叠加**（组合） | **Seedance 2.0** | 即梦；Kimi K3 写 Skill 产素材 | 全场最系统的一条：给出**槽位声明提示词**（「骨骼轨迹定义动作与时序须严格还原；深度图仅表达纵深与运镜，禁止模仿其颜色质感」）+ **5 条优点 2 条缺点**（缺点：丢手指细节/表情/衣物飘动；人-物交互语义变弱） | ✅ 明列失效边界 | https://www.douyin.com/video/7667078251226942763 |
| 20 | 2026-08-03 | @AIGC 作业本 | 抖音 | 深度视频 + 角色图 + 场景图 | **Seedance 2.5**（文中写 SD2.5） | 即梦 | 深度只负责站位/肢体/脚步节奏/运镜/构图/纵深；风格光影交给角色与场景图 | ➖ 有职责划分论述 | https://www.douyin.com/video/7669779308189175046 |
| 21 | 2026-08-13 | @北岛Travis | 抖音 + 小红书 | 原视频 → 深度图 + 自己的角色参考 | **Seedance（seedance mini）** | 未说明 | 三步 SOP；「mini 模型已经有很好的效果，但提示词要写详细」 | ➖ | https://www.douyin.com/video/7673535130534694182 |
| 22 | 2026-04-20 | @电磁波Studio | 抖音 | **Blender 3D 假人渲染出的标准动作参考视频** | **Seedance 2.0** | 即梦 + Blender + RunningHub | 大幅提升动作一致性、减少抽卡 | ➖ | https://www.douyin.com/video/7630838537377832335 |
| 23 | 2026-08-26 | @像素诗人·公子慕辰 | 抖音 | 黑白深度视频（**多角色**） | **Seedance 2.5** | 即梦 + Codex | 「网上教程基本都是单一角色，我解决群角参考」 | ➖ | https://www.douyin.com/video/7678201739505437995 |
| 24 | 2026-08-25 | @小枫 AI｜ComfyUI | 抖音 | **去色/黑白预处理后的动作参考视频**（注意：去色 ≠ 深度） | **MiniMax H3** | ComfyUI | 去色消除色彩干扰，解决生成模糊/画面崩坏 | ➖ | https://www.douyin.com/video/7677832078259539219 |
| 25 | 2026-07-23 | @小方薯 | 小红书 | **深度图视频 + pose**（组合） | **Wan 2.2 Animate** | ComfyUI | 「原来 wan2.2animate 的参考视频是支持深度图（视频）的」 | ➖ | https://www.xiaohongshu.com/explore/6a625468000000001303e229 |
| 26 | 2026-09-05 | @紫色土豆33 | B 站 | 深度/姿态控制 vs 角色替换 | **MiniMax H3 Fun ControlNet** vs **SCAIL-2** | ComfyUI | 横评 | ✅ **模型间横评**（开源线） | https://www.bilibili.com/video/BV1rzt26gEZz |

**其余 100+ 条同主题但只有标题、没有可引用实质**（例：抖音 @三水AIGC「测试一下最近很火的深度视频参考的玩法」2026-07-30、@刘量AI「一段深度视频，AI 就能精准复刻所有动作」2026-09-02、B 站 @继-续-微-笑「一键把普通视频变成深度视频！Depth Anything 3 保姆级教学」2026-08-31、@鸡你太太太美v「通过深度图 depth map 白模视频复刻视频动作」2026-09-05），全部在附件 JSON 里，可自行翻。它们不进表，但它们是「这事有多热」的量本身。

---

## 4. 按模型分桶（153 条有信号记录里的提及次数）

| 模型 / 家族 | 相关帖 | 其中提到 **深度** | 其中提到 **骨架/pose** | 性质 |
|---|---|---|---|---|
| **Seedance 2.x / 即梦** | 38 | **24** | 5 | **闭源 API/App，走通用参考视频槽** |
| ComfyUI 工作流（泛指，未点名模型） | 18 | 4 | 5 | 开源侧 |
| **Wan（VACE / 2.2 Animate）** | 11 | 7 | 6 | **开源，深度是显式控制端口** |
| **Kling 可灵**（动作控制 2.6/3.0） | 10 | 2 | 0 | 闭源，**吃原始视频不吃深度** |
| **MiniMax H3 / 海螺** | 9 | 1 | 0 | 闭源 API 走通用参考；深度走开源 Fun-ControlNet |
| **SCAIL / SCAIL-2** | 9 | 0 | 1 | 开源，姿态/身份迁移 |
| **PixVerse** | 8 | **8** | 0 | 闭源，**唯一把深度做成一等功能**；但 8 条疑似同一波投放 |
| **Runway（Act-Two）** | **0** | 0 | 0 | 本轮四平台**一条都没抓到** |

全集口径：153 条里 **83 条提深度**、23 条提骨架/pose。深度是主流叫法，骨架是次流且常作为深度的**补充**（见 #19、#25）。

---

## 5. 三个关键切分

### 5.1 「闭源 API 直接吃深度视频且效果好」的实例 = **有，但它吃的是通用参考槽**

抓到 **11 条**「深度视频 → **点名了的**闭源模型」的个人实测（表中 #1、#2、#3、#4、#8、#10、#18、#19、#20、#21、#23），**11 条全部落在 Seedance 2.0/2.5 上**——没有第二家闭源模型被点名吃深度视频。另有 4 条（#5、#6、#9、#12）确实在喂深度但**没说清喂给谁**，按口径记「未说明」，不计入。**最强的一条是 #7 @underwoodxie96**：他不是只说「好用」，而是把「深度视频 + Seedance 2.0」和「直接用 Kling Motion Control」放在一起比，结论是前者动作更自然，并给出机制解释（深度剥掉了原角色与场景细节，降低污染）。这是本轮唯一一条**跨模型、带机制解释的对照**。

**但必须说清楚的机制真相**：Seedance 那边**没有任何叫「深度」的参数**。核对官方与聚合文档（见 §7），Seedance 2.0/2.5 的参考是**无类型的多模态参考**——图/视频/音频统一进 `content[]`，提示词里用 `@video1` / `@image1` 按提交顺序指名。所以「闭源模型吃深度」的准确说法是：

> 深度视频只是**一段恰好只剩几何、不剩身份与风格的视频**，被塞进本来就存在的参考视频槽；模型没有为它做任何特化，是**创作者用预处理把信噪比调干净了**。

这也解释了为什么这套玩法能在一夜之间铺开——它不依赖任何供应商发版。

### 5.2 「其实是 ComfyUI / 开源控制通道」的那一条线

**Wan VACE**（#15–#17）、**Wan 2.2 Animate**（#25）、**MiniMax-H3-Fun-ControlNet-Union**（#26，Canny/Depth/HED/MLSD/Pose 五种控制）、**SCAIL-2** 属于另一类：那里深度是**显式的 ControlNet 条件端口**，模型被训练成读它。这条线技术上更"正统"，但它在中文自媒体里的呈现是**工作流/整合包/显存优化**，受众是 ComfyUI 用户，不是即梦用户。

⚠️ 一个易混淆点：**MiniMax H3 出现在两条线上**。托管 API（`platform.minimax.io`）只有通用的 `reference_video` 角色（图 ≤9 / 视频 ≤3 / 音频 ≤3），**没有 depth/pose 参数**；深度与姿态控制来自**开源权重 + Fun-ControlNet**，只能在 ComfyUI 跑。#24 @小枫那条讲的是**去色预处理**（消除色彩干扰），**不是深度** —— 别把它算进深度桶。

### 5.3 有没有人贴过「原始 vs 深度」的对照结论？

**有，4 条，但没有一条是量化 A/B。**

- **#7 @underwoodxie96**：深度+Seedance 2.0 vs Kling Motion Control 直接吃原片 → 前者更自然（最强）。
- **#1 @NexlowX**：机制级对照论述——喂原片 = 模型要同时解释人/衣服/灯光/房间；喂深度 = 只剩动作可解释。
- **#19 @诺皮克NovaPix**：唯一**主动列失效边界**的——丢手指细节、丢表情、丢衣物飘动；人-物交互（踢球、持剑）语义变弱，因为深度图有轮廓没语义。
- **小红书 @大星AI实用派（2026-07-25）**：整条笔记的题目就是「为什么不用原视频，反而要先转成深度视频」。

全部是**创作者主观并排**，没有人跑过多样本、多 seed 的量化评测。**证据强度：一致性高、独立性高、严谨度低。**

---

## 6. 官方文档核对（R5，2026-09-07 实查）

| 家 | 最近有没有新增「控制视频/深度/姿态」输入 | 出处 |
|---|---|---|
| **Seedance 2.0 / 2.5（火山方舟）** | ❌ **没有**。参考是**无类型多模态**：图/视频/音频进 `content[]`，提示词用 `@video1` 指名；2.5 放宽到 30 图 + 10 视频 + 10 音频。**无 depth / control_video 参数** | https://docs.volcengine.com/docs/82379/2607688 ；聚合文档 https://docs.apiyi.com/en/api-capabilities/seedance2/overview ；仓库既有对账 `docs/research/2026-09-02-docaudit-apimart.md:56`（APIMart 侧字段 `image_urls, video_urls, audio_urls, image_with_roles`） |
| **Kling 3.0 Motion Control** | ⚠️ 有动作控制，但输入是**原始参考视频 + 参考图**，**不是深度/骨架** | https://kling.ai/document-api/api/video/motion-control ；https://kling.ai/document-api/apiReference/model/motionControl |
| **MiniMax H3（托管 API）** | ❌ 只有通用参考：`{"type":"video_url", "role":"reference_video"}`，图 ≤9 / 视频 ≤3 / 音频 ≤3。深度/姿态**只在开源权重 + Fun-ControlNet-Union**（Canny/Depth/HED/MLSD/Pose） | https://platform.minimax.io/docs/guides/video-generation ；https://huggingface.co/MiniMaxAI/MiniMax-H3 |
| **Runway Act-Two** | ❌ 吃 driving video（智能手机拍即可），官方明说**不需要深度传感器**；无深度输入 | https://help.runwayml.com/hc/en-us/articles/42311337895827-Performance-Capture-with-Act-Two |
| **PixVerse** | ✅ **唯一新增了深度控制的闭源家**：`Depth Map Control` Mini App，2026-07 底上线，流程是「参考视频 → 深度图视频 → 深度视频 + 参考图 → 生成」 | https://app.pixverse.ai/mini-apps/depth-map-control （直连 403，经官方 X https://x.com/PixVerse_/status/2081747661905092787 与二手报道核对）；⚠️ **其公开 API 文档里查不到对应参数**，见 https://www.atlascloud.ai/blog/guides/pixverse-api ——即「App 有、API 未见」，接之前必须实抓 |

---

## 7. 自媒体来源（TikHub）

本轮结论**全部**建立在 TikHub 抓到的一手自媒体帖上——论文与英文技术博客那两层讲不了「真做的人卡在哪」，而本题恰恰是「在野有没有人真的这么干」。

- 工具：`scripts/research/tikhub-search.mjs`（`origin/main@d230da0a6`），密钥只从 `TIKHUB_API_KEY` 环境变量读；产物已核验不含密钥。
- 附件：`docs/research/2026-09-07-depth-motion-ref-in-the-wild/tikhub/`，10 个子目录对应 10 组关键词，每个含 `tikhub-search.json`（结构化）+ `tikhub-search.md`（人读）。
- 覆盖：X（Twitter）/ 抖音 / B 站 / 小红书；原始 321 条，去重 302 条，有信号 153 条。
- **一处脱敏**：`q09` 的一条 B 站记录里，作者自己在简介中贴了一个 32 位 hex 的 `vd_source` 追踪串（B 站的第三方跟踪参数，非我们的凭证，也无调研价值）。仓库敏感数据门岗按「疑似明文 key」拦下，已就地替换为 `REDACTED-BILIBILI-TRACKING-TOKEN`——**这是全部 10 组产物里唯一一处对原始响应的改动**。
- **失败留痕**：`q10-cn-jimeng-motion-ref` 的小红书腿 3 次 400 失败（TikHub 侧 `Request failed`），该组小红书数据缺失；其余 9 组小红书正常。X 只走 `search_type=Top`，未做 Latest 全量翻页——所以本文的计数是**下界**，不是全网普查。

---

## 8. 建议下一步（不在本文授权范围内实施，只列）

1. **接法定型**：深度化做成 Nomi 侧的**素材预处理**（一段普通视频 → 灰白深度视频），产物走 Seedance 2.5 既有的 `video_urls` 参考槽。不新增供应商能力槽，不等任何供应商发版。
2. **槽位声明提示词是产品的一部分**：#19 那段「骨骼轨迹定义动作与时序须严格还原；深度图仅表达纵深与运镜，禁止模仿其颜色与质感」是在野收敛出来的最佳实践，值得做成模板而不是让用户手写（D1：让用户照我们格式手写 = 离谱）。
3. **诚实标限制**（D4）：深度参考**不承载**手指细节、面部表情、衣物飘动；人-物交互语义弱。这三条应当明着写在界面上，不藏。
4. **PixVerse 要实抓才算数**：App 里有 ≠ API 里有。要接先抓真实出站报文。
5. **本轮没有量化对照**——如果要把「深度 vs 原片」写进产品文案，需要我们自己跑一次多样本 A/B，而不是引用创作者的主观并排。
