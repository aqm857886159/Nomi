# 补齐方案 · 来源采集方案（市场验证优先原则）

> 2026-09-07 · 方案第四部分。回答「实现内容从哪来」——提示词预设、词表、模板不是拍脑袋写的，**先采被市场验证的顶尖实践，自造只做兜底**。
> 本文即按此原则执行后的调研结果：每个预设类别都找到了有验证信号的来源，并标明采用方式与剩余缺口。

---

## 一、采集三梯原则（新增为方案总则）

| 梯 | 什么时候 | 做什么 | 准入门槛（验证信号） |
|---|---|---|---|
| **T1 直接采用** | 存在许可兼容、质量被验证的现成实践 | 原样引入（提示词进提示词库、模板进模板库），附来源署名 | ① 开源许可兼容（MIT / CC BY 4.0 / 官方文档）② 任一信号：GitHub star≥100、平台赞/藏/下载量领先、有实测数据背书、官方出品 |
| **T2 改造适配** | 有好结构但参数/语言/模型不适配 | 保留验证过的结构骨架，替换：中文表达、Nomi 在售模型语法（Seedance/Nano Banana/即梦）、占位符接 @引用体系 | T1 来源存在但不完全适配；改造必须保留原结构可追溯（记来源） |
| **T3 自造** | T1/T2 全空缺 | 自己写 + 自己验收 | 必须先记录「查过什么、为什么没有」，防止重复造有现成答案的轮子（R20 精神） |

**验证信号的具体口径**：GitHub star/fork 与更新时间（活跃度）；Civitai/哩布等平台的 like/下载/评论实测图；教程作者的实测样张数（如「跑了四十多张」这类证据）；官方文档（最高优先，供应商最懂自家模型）。

---

## 二、逐类来源调研结果（本次已完成的实查）

### 2.1 视频分镜 / 运镜词表 / 分镜预演组

| 来源 | 验证信号 | 许可 | 采用方式 |
|---|---|---|---|
| **awesome-seedance-2-prompts**（GitHub） | 收录 6,187 条 Seedance 社区提示词，约 1,900 star / 200+ fork，2026-08 仍在更新 | CC BY 4.0 | **T1+T2**：直接采其「分镜公式」六零件结构（总设定/角色连续性/分秒动作/镜头调度/场景反馈/声音收束）作为调度故事板、剧情推演、分秒运镜词表的骨架；中文语料直接复用 |
| **awesome-ad-video-prompts**（LichAmnesia，GitHub + V2EX 发布） | 10 大类广告级结构化模板（产品/UGC/开箱 ASMR/高奢质感/美食…），带分秒节奏（0-2s/2-4s）、真实运镜术语、**按模型的防崩守则**（防变形/漂移/闪烁） | 开源免费 | **T1**：运镜词表直接采用（推拉摇移/微距/特写 + 防崩词组）；广告类模板入「批量广告」场景预设 |
| **ai-shortfilm-prompts**（jnMetaCode，GitHub） | 367 star，21 种类型模板、5 阶段结构、**eval-tested**（作者被好莱坞短片导演点名背书） | 开源 | **T2**：短片类分镜模板改造为「故事板」预设的骨架 |
| LibTV 自家 showcase 提示词（《无限梦境 MV》《好莱坞一镜到底》全文） | 竞品官方放出的、可直接运行的完整提示词（已从 docx 提取存档） | — | **T2**：抽取其镜头轴旋转/动量延续/素材锚点 {{}} 语法 → 改造为 Nomi 资产锚 @引用语法 |

### 2.2 三视图 / 角色设定图

| 来源 | 验证信号 | 采用方式 |
|---|---|---|
| 社区实测公式（FlowPix 实测 40+ 张过半可用；塔猴「万能公式」五法则） | 「character sheet + three views turnaround + front view, side profile view, back view + full body + standing pose + plain white background + reference sheet style」——多个独立来源交叉验证同一结构 | **T1**：作为三视图预设主公式（中英双版） |
| 特征锚定法（塔猴法则二） | 颗粒度细化（「深红色皮革机车夹克带金色拉针」而非「红色外套」）+ 色块锁定（发/眼/衣/裤/鞋分别锚色） | **T1**：与 Nomi 定妆卡的身份 DNA 字段天然对齐——预设直接把锚定项映射到 DNA 字段填空 |
| Civitai CharTurner / CharacterSheet 系列 LoRA 触发词 | 4 万+ 下载量级 | **T2 参考**：触发词模式（`CharacterSheet:1` 权重写法）用于 ComfyUI 本地档 |

### 2.3 人像去 AI 感 / 质感修复组

| 来源 | 验证信号 | 采用方式 |
|---|---|---|
| **Nano Banana 官方式提示词指南**（nanobanana.io 中文指南 + Google 官方「describe, don't list keywords」） | 官方出品 | **T1**：编辑指令四段式「保持(不可变)+改变+如何+约束」作为所有图像编辑预设的语法骨架——直接对应重绘/擦除/扩图的系统词 |
| 50 条实拍感 prompt（miraflow）+ 超写实皮肤公式（wearecentric） | 公开实测合集；皮肤公式含 visible pores / fine lines / peach fuzz / subsurface scattering / 85mm f/1.4 全要素 | **T1**：人像调节预设直接采用（中文版已可直译），去塑料感 = 该公式子集 |
| morphed 80+ prompts 实测报告 | **量化证据：整句式 prompt 首次出图可用率 73% vs 关键词堆叠 41%**（50 组对照实测）；「形容词 ≤5」法则 | **T1**：此数据直接写进预设书写规范——Nomi 所有预设必须整句式、形容词≤5 |

### 2.4 表情 / 情绪调节

| 来源 | 验证信号 | 采用方式 |
|---|---|---|
| **Plutchik 八情绪轮词表**（neverbiasu 整理，含 joy/anger/disgust/sadness/surprise/fear/trust 全族细分，如 grin/smirk/furious/pouty/sobbing/flustered…60+ 词，附适用说明） | 社区长期引用的标准分类（心理学八情绪论） | **T1**：情绪调节 25 表情的词表骨架直接从八情绪轮取 25 个高频词，中文配对 + 面部肌肉描述（「眉头紧皱/下颌紧绷/眼角弯起」——一聚教程 11 条实测表情摄影 prompt 提供肌肉级描述词） |
| Midjourney Compendium 表情章节 | 长期维护的社区手册 | **T2 参考**：补充强度分级（smile<laugh<LOL） |

### 2.5 摄像机参数 / 镜头聚焦 / 多角度

| 来源 | 验证信号 | 采用方式 |
|---|---|---|
| morphed / nanobanana 官方示例（「shot on Canon EOS R5 85mm f/1.4」「35mm 镜头，浅景深」「Kodak Portra 400 film grain」） | 官方 + 多源实测一致 | **T1**：摄像机控制参数预设 = 机身×镜头×光圈×胶片 片段库（约 30 组组合，全部来自被验证的写法），按人像/产品/风光分组 |

### 2.6 光影矫正 / 打光

| 来源 | 验证信号 | 采用方式 |
|---|---|---|
| Nano Banana 指灯光影条目（柔光/硬光/逆光/霓虹/冷暖对比/金蓝时刻）+ Midjourney Compendium Emotional Photography（光线×情绪映射表） | 官方 + 社区手册 | **T2**：组合成「电影级光影矫正」预设 + 情绪-光影映射词组 |

### 2.7 全景等距柱状 / 25宫格连贯分镜 / 调度故事板手绘

| 类别 | 调研结论 | 判定 |
|---|---|---|
| 全景 2:1 等距柱状 | 各图像模型均无专用语法，社区经验是「equirectangular projection, 2:1, 360 panorama」+ 概率不稳 | **T3 自造**（已记录查证过程：无专用公开语料），走 spike 验证 |
| 25宫格连贯分镜 | LibTV 自有能力，无公开语料；但 awesome-seedance 的「分秒动作拆解」结构可改造 | **T2 改造**：把 25 格 = 分秒动作表投影到 5×5 宫格 prompt |
| 调度故事板（手绘风） | 手绘分镜风格词（sketch/arrow/motion line）散见于社区，无整链验证 | **T2+T3 混合**：风格词采集 + 动作线/走位描述自造 |

---

## 三、采集管线（复用已有基建，不新造）

1. **抓取**：GitHub API 拉取 awesome 仓库内容（复用技能注册表的采集管线经验：API 存活核验 → 结构化落库 → lock 文件锁源）；Civitai/平台数据人工摘录即可（量小）。
2. **清洗与本地化**：去重 → 英文语料中文配对（保留英文原句，模型对英文运镜术语响应更稳，中文做注释）→ 占位符改造为 Nomi @引用语法（`{{角色}}` → `@角色卡`）→ 按在售模型适配（Seedance/Nano Banana/即梦三档语法差异写进预设的「适配说明」字段）。
3. **署名与许可**：CC BY 4.0 来源在提示词库条目详情页显示来源与作者（既是合规也是信任资产）；MIT 直接用；官方指南无版权负担。
4. **验收门（对抗评测补充）**：每条预设入库前做**借用 vs 自造 A/B**——同题跑 Nomi 在售模型，与 LibTV 公开 showcase 对比；T1 借用项的目标是「不劣于原验证环境」，T3 自造项目标是「与 T1 同题不落下风」。预设效果不达标不上线（宁缺毋滥）。
5. **更新机制**：awesome 仓库有更新时提示重新同步（lock 记录 commit SHA），预设库只增不减地迭代。

---

## 四、把同一原则扫过方案其余部分（不只在提示词）

| 方案项 | 市场验证的来源 | 状态 |
|---|---|---|
| 人声分离 | Demucs（Meta）/ MossFormer2（SDR 24+ 公开评测）| ✅ 已是 T1 采用 |
| 视频超分 | Real-ESRGAN（Tencent ARC，开源标杆）/ Topaz（商业标杆）| ✅ T1 采用 |
| 抠图 | @imgly isnet（U²-Net 系，开源标杆）| ✅ 已在用 |
| 音频变速 | ffmpeg atempo（二十年的标准实现）| ✅ T1 |
| 时间轴交互 | Final Cut / DaVinci / OpenCut 的 selection-driven 范式（设计系统 §1.6 C2 已实查三家源码）| ✅ T1 采用 |
| 交互路径设计 | LibTV 同类功能交互 + Nomi 设计系统既有范式 | ✅ T2 改造 |
| 智能剪辑编排 | 剪映「图文成片」/ CapCut 的口播剪辑范式（待立项时实查）| 🟡 立项时按本原则补调研 |
| 深度动捕 | Depth Anything V2（论文+社区大规模验证）| ✅ T1，收益待 spike |

**结论**：14 项补齐中，**11 项的底层实现/内容来源已是市场验证的现成实践**；真正需要 T3 自造的只有 2.5 个（全景生成语法、调度故事板链路、25宫格的投影改造半自造）——且每个都记录了「查过什么、为什么没有」。

---

## 附：本次调研的原始来源清单

- github.com（awesome-seedance-2-prompts ~1.9k★ / awesome-ad-video-prompts / jnMetaCode/ai-shortfilm-prompts 367★ / geekjourneyx/awesome-ai-video-prompts 71★）
- nanobanana.io/zh/prompt-guide（Nano Banana 官方式指南）· dev.to（六部件编辑公式）
- morphed.app（80+ prompts + 73% vs 41% 实测数据）· miraflow.ai（50 条实拍感 prompt）· wearecentric.com（超写实皮肤公式）
- neverbiasu.github.io（Plutchik 八情绪词表）· midjourneycompendium.ch（情绪摄影）· 111cn.net（11 条表情实测）
- flowpixai.com / tahou.com / CSDN（三视图社区实测公式与五法则）
- 今日头条（awesome-seedance-2-prompts 项目解读，6,187 条/CC BY 4.0）· V2EX（awesome-ad-video-prompts 发布帖）
