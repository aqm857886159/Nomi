# Lovart「元素拆解」研究：一张图拆成可编辑分层（像 PS 改字 / P 图）

> 状态：**研究文档，不动代码**。用户 2026-06-27「研究一下 Lovart 拆解元素——一张图拆出元素/文字，像 PS 上直接改字、P 图」。
> 关系：上承 `docs/plan/2026-06-25-canvas-image-editing-research.md`（那份是**区域级改图**：inpaint/erase/matting/relight/outpaint/upscale）。本份是**另一个维度——图层化拆解（image → 多个可独立编辑的 RGBA 图层 + 可改文字）**，技术栈不同。

---

## 0. 一句话结论（先行）

Lovart 的「Edit Elements」= 把一张**拍平的成品图**，AI 一键炸成「**文字层 / 主体层 / 背景层**」多个可独立挪/缩/改/改字的图层（≈ JPG 变 PSD）。底层不是单一魔法，是一条**「OCR 认字 → 抠主体 → 补背景（inpaint 填洞）」的迭代拆解流水线**；当前 SOTA 且**开源可达**的现成模型是 **Qwen-Image-Layered（阿里，2025.12.19，Apache 2.0）**，直接做「RGB → 可变数量 RGBA 层」。

**可达性已查实（2026-06-27）**：Qwen-Image-Layered 权重 **57GB+**，**跑不进本机**，必须走云。但**已有现成托管 API**——**fal.ai `fal-ai/qwen-image-layered` ≈ $0.05/张（拍平价，不随层数/步数涨），1–10 层，15–30s**；Replicate `qwen/qwen-image-layered` ≈ $0.03/张；RunComfy 也有。**Apache 2.0 可商用**。接入路径 = 和 6/25 §4 的 BiRefNet matting **完全同一条**（fal 新 vendor + key）——**一把 fal key 同时解锁 matting 和分层**。

**质量裁决（用户要『接近完美否则不做』）→ 反转结论（§3.6）**：「拆一张已拍平的图」2026 没人做到接近完美——**连 Lovart 在客观盲评里都排质量最差**，质量榜首 MRT 是够不到的纯研究；这是原理性天花板（逆向去烘焙必出残影/糊边）。**所以「拆已存在的拍平图」这条不达标，砍。** 但要的「效果」（可独立编辑的分层元素）能用另一条路接近完美：**Nomi 是生成工具，应当 compose 不 decompose——角色从生成那一刻就用透明底单独出层（`nano-banana-2-transparent` 已可达），根本不烘焙 = 无残影、边缘干净。**

**对 Nomi 的判断（D2 先于功能）**：完整版（海报→可编辑文字 PSD）是**平面设计商品化**地盘，照搬违反「广度是敌人」。要的子集 =**「分镜画面的角色/背景天然分层」**，喂 Nomi 真痛点（跨镜身份复用、挪站位、合成），是 6/25 matting/站位 那条线的升级。**取舍点 = 取「分层元素」效果、用 compose 实现、砍 decompose 和文字层/海报 PSD。**

---

## 1. Lovart 到底做了什么（机制拆清）

三个相互配合的功能，2025 年 11 月起陆续上线：

| 功能 | 干什么 | 用户体验 |
|---|---|---|
| **Edit Elements**（元素拆分）| 选中图 → 点「编辑元素」→ AI 自动拆成**文字层 / 主体层 / 背景层**多层 | 实测一张海报被拆成 5 层（图片 1 层 + 标题文字 4 层）；每层可拖动/旋转/缩放/替换/局部重绘/改字，全在画布内 |
| **Text Edit**（文字编辑）| 图里所有字重新变成可编辑文字，**保留原字体/光影/材质** | 英文海报改成中文，字体完全一致；连艺术变形字、被遮挡的字都能认 |
| **Touch Edit**（触碰编辑）| 按 M 键 / Ctrl+点击，AI 识别点中的元素直接拎进对话框 | 「指哪改哪」，和 Text Edit 配合 |

**关键点**：
- 这不是「抠图」（抠图只是前景/背景二分）。Edit Elements 是**语义多层拆解**——它「理解」画面里有哪些离散元素，再分层。被主体遮住的背景，AI 会**智能补全**（匹配原图纹理颗粒）。
- 边缘「数学级精确」，号称零手动 lasso/钢笔修边。
- Lovart 把它定位成范式转移：从「预测式生成」走向「精确编辑」，并已规划**扩展到视频帧的元素分离**（← 这点对 Nomi 是直接信号）。

**已知局限（诚实标注，D4）**：
- 个别字体识别会漂移（手表海报几个字字体悄变、摩托海报印章小字丢失）。
- 图层精度弱于专业 PS（高精度抠图+复杂渐变+多重遮罩还得 PS 收尾）。
- **导出只能 PNG**——拆完进不了 Illustrator/PS 深度编辑（文字层出了 Lovart 就不再「可改字」）。

来源：[aibase 报道](https://news.aibase.com/news/22743)、[Lovart 官方 blog](https://www.lovart.ai/blog/saving-the-shot-product-photography-edit-elements)、[UIED](https://www.uied.cn/104836.html)、[知乎实测](https://zhuanlan.zhihu.com/p/1972339240995119500)。

---

## 2. 底层技术：这套「图→分层」怎么实现的

拆解不是一步到位，是**迭代式「剥洋葱」**——这是所有方案的共同骨架：

```
输入拍平图
  → ① OCR 认字（文字内容 + bounding box + 字体/颜色/光影估计）→ 文字层
  → ② 抠主体/物体（语义分割 SAM / Hi-SAM 文字笔画分割）→ 前景层们
  → ③ inpaint 补洞（把抠掉元素后留下的空洞，按周围纹理「脑补」填回）→ 干净背景层
  → 递归：背景里还能再拆就重复
```

「补洞 inpaint」是把**分层**和**单纯抠图**区分开的关键——抠图留个洞，分层要把洞补成完整背景。

### 现役方案对标（2025-12 ~ 2026，R5 实搜）

| 方案 | 形态 | 可达性 | 要点 |
|---|---|---|---|
| **Qwen-Image-Layered**（阿里）| 开源端到端扩散模型，Apache 2.0，2025.12.19 发布 | ✅ **开源+多家托管 API**（见 §3 详表）| **最对口、唯一现成可商用**。RGB→可变数量 RGBA 层（2–10 层随点）；可**递归无限拆**；支持缩放/挪位/改色；可导出 pptx/zip/psd。基于 Qwen2.5-VL（懂语义，分清产品/影子/桌面）。训练数据从真实 PSD 抽层。~2k★ |
| **Qwen-Image-Layered-Control**（DiffSynth）| 上面的可控变体 | ✅ HF 开源 | 原版**不能指定「每层要什么」**（只给层数）；这个能按文字描述拆指定内容层（8×A100 训 3 天）。← 若要「精确拆出角色 X」很关键 |
| **OmniPSD**（showlab）| 研究，arXiv 2512.09247，2025.12.10 | ⚠️ **未见公开代码/权重** | Flux-Kontext + 双 LoRA（一个抠前景、一个删前景补背景）交替迭代；含文字→矢量（PaddleOCR + 字体恢复 + 重渲染）。架构漂亮但暂不可直接用 |
| **Canva Magic Layers** | 闭源产品，2026.03 | ❌ | 同类商业功能，证明这是行业趋势 |
| **nano-banana / Seedream / GPT-Image** | 改图模型 | （Nomi 已接）| ⚠️ **不原生出分层**。做的是「改图→新栅格层」，不是语义拆层。要分层必须另配 Qwen-Image-Layered 这类专用模型 |
| **SAM 2** | 分割模型 | 开源 | 只出**二进制蒙版**（哪些像素属于谁），不补洞、不出 RGBA 完整层；优势是**视频原生跟踪**（Qwen 只能逐帧）。可作分层的「定位」前置，但单独不够 |

**结论**：Lovart 那套效果，**开源世界唯一对口又现成可商用的 = Qwen-Image-Layered**（OmniPSD 无码、Canva 闭源、改图模型不对口、SAM 只蒙版）。Nomi 已接的改图模型们（nano-banana 等）做不了真分层，它们只「改」不「拆」。

来源：[Qwen-Image-Layered GitHub](https://github.com/QwenLM/Qwen-Image-Layered)、[HF 权重](https://huggingface.co/Qwen/Qwen-Image-Layered)、[paper 2512.15603](https://huggingface.co/papers/2512.15603)、[OmniPSD arXiv](https://arxiv.org/abs/2512.09247)、[DataCamp 实操](https://www.datacamp.com/tutorial/qwen-image-layered)。

---

## 3. Nomi 能不能够到（可达性 —— 已查实）

**模型形态硬事实**：Qwen-Image-Layered 权重 **57GB+**，DataCamp 实测 Colab T4 直接 OOM、磁盘吃到 90GB——**绝无可能跑进用户本机**（Nomi 本地优先 Electron）。所以路径只能**走云端 API**。好在**托管 API 已经现成**：

| 托管 | endpoint | 价格 | 形态 | 备注 |
|---|---|---|---|---|
| **fal.ai** ✅ | `fal-ai/qwen-image-layered` | **≈ $0.05/张**（拍平价，不随层数/步数涨）| 1–10 层，15–30s，吃 JPEG/PNG/WebP/GIF/AVIF | **最清晰**。还有 LoRA 训练端点 `.../lora`。**和 6/25 §4 BiRefNet matting 同一个 fal vendor——一把 key 两用** |
| **Replicate** ✅ | `qwen/qwen-image-layered` | ≈ $0.03/张 | 2–8 层，可复现 seed，输出 RGBA PNG 列表（index0=背景，下→上）| 异步 |
| **RunComfy** ✅ | `model-api.runcomfy.net/v1/models/qwen/qwen-image-layered` | 待查页 | 异步（request_id + 轮询）| schema 同 fal |
| **HF Space / ModelScope Studio** | demo | 免费 | 网页手动，无稳定 API | 只能验效果，不能集成 |
| **自部署** | — | GPU 成本+运维 | — | ❌ solo 不现实，违 D2 |

**接入路径 = 完全复刻 6/25 §4 的 BiRefNet 方案**（fal 新 vendor seed + 异步 create/query op + `image_edit` 风格档案 + 本地图吞入 `AssetIngestion`）。框架原语全现成。**唯一外部依赖 = fal/Replicate key（产品级，按家规用户拍）**。
> **省 key 核查（2026-06-28 已查）**：❌ ModelScope 只放权重下载、**未开 Qwen-Image-Layered 推理 API**，已连的 modelscope/apimart key 够不到。✅ **一把 Replicate key 同时覆盖 `qwen/qwen-image-layered`（decompose）+ `nano-banana-2-transparent`（compose 透明底生成）**，是验证效果最省的单一 key。

**真正的工程缺口**（模型已可达，难点在 Nomi 侧）：
1. **多层结果的承载**——现在 Nomi 一个生成节点 = 一张图。分层拆出来是「N 个 RGBA 层 + 各自位置」，画布得能把一张图**炸成一组可分别选中/挪动的子层**（这是新交互，不是现有节点能装的）。
2. **文字层「可改字」**——要真做到 Lovart 那种「出了模型还能改字」，得在 Nomi 里维护「文字层 = 内容+字体+位置」的结构化对象，不只是栅格 PNG。**成本高、且偏平面设计**。
3. 边缘对齐画布坐标系（同 6/25 蒙版工具的坑）。

---

## 3.5 开源项目深挖（Qwen-Image-Layered，R6 读真实仓库）

**仓库**：[github.com/QwenLM/Qwen-Image-Layered](https://github.com/QwenLM/Qwen-Image-Layered)（Python 100%，~2k★，Apache 2.0），权重 [HF](https://huggingface.co/Qwen/Qwen-Image-Layered) / ModelScope。月下载 5w+。

**怎么跑（官方 diffusers 例子）**：
```python
from diffusers import QwenImageLayeredPipeline
pipe = QwenImageLayeredPipeline.from_pretrained("Qwen/Qwen-Image-Layered").to("cuda", torch.bfloat16)
out = pipe(image=Image.open("x.png").convert("RGBA"),
           layers=4, resolution=640, num_inference_steps=50, true_cfg_scale=4.0)
# out.images[0] = 一组 RGBA 层，逐个 .save()
```
- `transformers>=4.51.3` + 源码版 diffusers；Apple `mps` 也支持（但 57GB 权重本机仍不现实）。
- 自带 Gradio 工具：`src/app.py`（拆解+导出 pptx/zip/psd 的 web UI）、`src/tool/edit_rgba_image.py`（用 Qwen-Image-Edit 改某一层）、`src/tool/combine_layers.py`（从底层到顶层重新合成）。

**输入/输出契约**（集成要点）：
- 入：单图（+ 可选描述整图内容的 prompt，含被遮挡元素）；出：**N 张 RGBA PNG，index 0 = 背景，下→上排序**。
- 层数 `layers` 2–10 可变；**可递归**（任一层再拆）。
- prompt **不能控制单层语义内容**（原版只给层数）→ 要「精确拆出角色 X」得用 **DiffSynth 的 Control 变体**（按文字描述拆指定层）。

**已知弱点（诚实，影响 Nomi 取舍）**：
- **影子残留**：被抠主体的影子，背景重建时会留淡淡残影；影子越重，伪影越明显。← 对「角色挪站位」是真问题（地面影子会穿帮）。
- **无视频跟踪**：纯静态图，逐帧跑、帧间不连续（SAM 2 才有原生 object tracking）。← Nomi 若想做「视频帧元素分离」（Lovart 的 roadmap 方向），单靠它不够，要配 SAM 2 做跨帧关联。
- 一代模型，精度弱于专业 PS。

## 3.6 质量裁决（针对用户「接近完美，否则不做」）—— 关键反转

用户定了硬标准：**要么接近完美不穿帮，要么别做**。实查质量前沿后，结论是个反转：

**① 「把拍平的成品图拆成完美图层」这条路，2026 年还没人做到接近完美——包括 Lovart 自己。**
- CVPR 2026 的 **MRT（Canva Research）盲评**里：**Lovart 排最差（poor decomposition quality）**，RoboNeo 有伪影，Qwen-Image-Layered / LayerD 会「过度合并图层」。换句话说，**你欣赏的 Lovart 那个效果，在客观榜上恰恰是质量垫底的那个**。
- 质量真正最强的 **MRT**（20B，统一 text/image/layers）= **纯研究，无代码无权重无 API，今天用不了**（和 OmniPSD 一样够不到）。
- 这是**原理性天花板**，不是某个模型不努力：拆「拍平图」=**逆向去烘焙**，影子、头发/毛发/玻璃/动态模糊的软边、反光、重叠纠缠——这些信息在拍平那一刻就已经糊在一起，再聪明的模型也只能「猜」，必出残影/糊边。Qwen 的影子残留就是这个原理的体现。
- **裁决**：若标准是「接近完美」，**「拆一张已存在的拍平图」这条路今天不达标 → 按用户『做作就算了』，砍。**

**② 但有一条能接近完美的路——反过来：不要 decompose，要 compose（从生成那一刻就分层，根本不烘焙）。**
- 第一性想（D3）：**Lovart 必须 decompose，是因为它的用户上传的是已拍平的成品**。**Nomi 是生成工具——它不必先烘焙再拆，可以从一开始就让角色和背景分开生成、各自成层。** 没烘焙过 = 没有残影/糊边可言 = 天然接近完美。
- 落点：生成一个分镜时，**角色用「透明底生成」单独出一张 RGBA**（`nano-banana-2-transparent` 这类已可达，输出永远是 RGBA PNG），背景单独生成，画布上天然是两层 → 角色可任意挪站位、跨镜复用、换背景，**边缘干净、无影子穿帮**。
- 这恰好把 6/25 的 matting/站位 这条线，升级成「**元素从出生就分层**」，且**质量上限远高于事后拆解**。Nomi 已接 nano-banana，可达性比拆解模型还低门槛。

> 一句话：**Lovart 的「效果」（可独立编辑的分层元素）值得要；Lovart 的「做法」（拆已拍平的图）质量不达标、且不是 Nomi 该走的路。Nomi 应当 compose 不 decompose。**

来源：[MRT (Canva Research, CVPR 2026)](https://mrt-cvpr.github.io/)（盲评排名，注：出自 MRT 作者，含自评偏向）、[nano-banana-2 透明输出实测](https://jidefr.medium.com/nano-banana-2-with-transparency-4673640bb9e6)、[Lovart 是模型编排层](https://magiclight.ai/academy/lovart-ai-review/)、[Qwen-Image-Layered 软边/影子局限](https://www.datacamp.com/tutorial/qwen-image-layered)。

## 3.7 真生成实测结论（2026-06-28，Replicate，~$1.15，4 轮 ~28 次生成）

用真图实测 `qwen/qwen-image-layered`（decompose）+ `google/nano-banana-2`（生成/改图）。**结论推翻了我先前的理论预测**（再次印证 P3：全绿/理论≠对，必须真跑）。

**✅ DECOMPOSE 成立的能力：**
| 测试 | 结果 |
|---|---|
| 多元素拆解（侦探+灯+WANTED海报+砖墙）| **优**：干净拆成 背景/海报/桌/角色/灯 各独立透明层（T1）|
| 文字作为元素隔离（RONIN/WANTED 海报）| **成**：标题文字独立成层，可挪可替换（T2）|
| 画面内移动元素（街道角色/玫瑰/城堡骑士公主）| **优**：光照一致、原位背景自愈、**无影子鬼影**（模型输出独立影子层）（R1/T9/R4a）|
| 删除元素→背景自愈 | **优**：删掉角色后大厅/地面完整补全、无鬼影（R4b）|
| num_layers 无损可复原 | **成**：n=2/4/6/8 叠回都还原（T4）|
| 双人分离 | **⚠️ 需调高 n**：n=5 把人并进背景（over-group），**n=8 才分出两人**（T5a/T8）|
| 遮挡补全 | **⚠️ 有限**：能把遮挡物(植物)与主体分开，但被挡的身体下半部不完整补全（T5b）|
| 分辨率 | **⚠️ 天花板**：输入 896×1200 → 分层降到 **544×736**（长边~0.6x），拆完掉分辨率，需后接超清（T-res）|

**✅ 改字（Lovart「Text Edit」）—— 重大发现，不用新模型：**
- 用 Nomi **已接的 nano-banana** 直接「把 RONIN 改成 SHOGUN，字体/金属质感/位置/其余全不变」**效果惊艳**（T7）。→ Lovart 的改字能力 **= nano-banana 定向改图，已在手**，无需拆文字层、无需新模型。

**跨镜复用同一角色：**
- ✅ **decompose 抠角色 + nano-banana relight 进新场景** = 自然融入、不穿帮（侦探搬到海滩，重打光后像真在那）（T6）。
- ❌ **naive compose（角色、背景各自生成直接叠）= 贴纸**，光照/颗粒对不上（R1 compose）。

**成本**：decompose ≈ $0.05/张，改图 ≈ $0.034/张。

**对方案的含义**：① 招牌能力 = decompose 做「画面内拆元素/挪/删/换」+ nano-banana 做「改字/relight」，两者都已实测可达且效果好；② 已知边界要在产品上诚实处理：多人拆解默认用高 num_layers、拆完自动接超清补分辨率、遮挡补全标注「可能不全」。

## 4. 对 Nomi 的战略判断（D1 摩擦 + D2 结构）

**先问：这服务 Nomi 的哪个真实摩擦？**

- ✅ **有用的那一刀**：把一个**分镜画面拆成「角色层 / 背景层」**——
  - 角色抠成独立层 → 在场景里**挪站位**、跨镜**复用同一角色**、合成到新背景 → 直接喂「跨镜身份一致 + 站位」这条 Nomi 招牌痛点（和 6/25 的 matting、站位参考工具 `create_staging_reference` 是**同一条价值线，能合流**）。
  - Lovart 自己都说要扩到「视频帧元素分离」——印证这个方向对视频工具成立。
- ❌ **该砍的那一刀**：**文字层 / 海报→可编辑 PSD / 改字保字体**——这是平面设计（电商海报、KV、PPT）的核心摩擦，**不是叙事视频的摩擦**。Nomi 是导演台不是 Canva。做这块 = 在已被 Lovart/Canva 商品化的工具层正面拼广度，违反 solo「广度是敌人」。

**所以核心取舍点（一句话给用户拍）**：
> **「分层」只取『画面拆成角色/背景层、服务跨镜身份与站位/合成』这半边；砍掉『文字层、改字、海报变 PSD』那半边（那是平面设计，偏离导演定位）。**

这样它就不是「抄 Lovart 一个功能」，而是**把 6/25 的 matting/站位 这条线，从「抠一层」升级成「拆多层 + 可重新合成」**，长在 Nomi 自己的价值链上。

---

## 5. 若要落地（待拍板后才写 plan）

**主推路线 = compose（接近完美）**：
- **批 1（贴 Nomi 摩擦、质量上限高）**：生成分镜时，**角色用透明底单独出 RGBA 层**（`nano-banana-2-transparent` 类，Nomi 已接 nano-banana 路径），背景单独生成 → 画布上天然「角色层 + 背景层」可分别挪/换/复用。无烘焙 = 无残影。复用 6/25 站位/matting 工程地基。
- **批 2（可选增强）**：对**用户上传的已存在图**才需 decompose（Qwen-Image-Layered@fal），明确标注「拆解质量受限、可能有残影」诚实兜底，不当主路。
- **砍**：拆已拍平图当主路、文字层可改字、海报 PSD、PPTX 导出（质量不达标 / 平面设计向）。
- 任何 UI 可见改动：先读 `docs/design/nomi-design-system.md` + 出可体验样张 + 拍板（R8）；多文件先写 plan（R4）；五门 + 真机走查（R11/R13）。

> 验证欠口（额度默认授权，方向定后我直接跑）：拿一张真分镜，跑 `nano-banana-2-transparent`（compose）vs `qwen-image-layered`@fal（decompose）真生成对比，**用真图实证哪条接近完美**，再写 plan。

---

## 6. 待用户拍板

1. **核心方向（compose vs decompose）**：认不认「**要 Lovart 的效果（可独立编辑分层元素），但用 compose 实现（角色从生成就分层）、不抄它 decompose 拆拍平图的做法**」？这是质量能否接近完美的分水岭（§3.6）。
   - 若认 → 主路是「透明底单独生成角色层」，decompose 仅作上传图的诚实兜底。
   - 若你坚持要「拆任意已存在的图」→ 须接受当前质量天花板（残影/糊边），按你「做作就算了」这条，我倾向不做主推。
2. **要不要我先真生成对比实证**（额度已授权，我可直接跑 compose vs decompose 各几张真图给你看效果再定）？
3. 方向定后我写 `docs/plan` 细化（**画布承载「一组可独立挪动子层」= 最大工程块**）。

---

## 来源（R5，2026-06-27 实搜）
- Lovart 官方：[Edit Elements blog](https://www.lovart.ai/blog/saving-the-shot-product-photography-edit-elements)、[Edit AI images](https://www.lovart.ai/features/edit-ai-generated-images)
- 报道/实测：[aibase](https://news.aibase.com/news/22743)、[agiyes](https://www.agiyes.com/ainews/lovart-edit-elements/)、[UIED](https://www.uied.cn/104836.html)、[知乎-图层编辑实测](https://zhuanlan.zhihu.com/p/1972339240995119500)、[知乎-能改字能拆层](https://zhuanlan.zhihu.com/p/1988905710684227333)
- 底层模型：[Qwen-Image-Layered GitHub](https://github.com/QwenLM/Qwen-Image-Layered) / [HF](https://huggingface.co/Qwen/Qwen-Image-Layered) / [paper 2512.15603](https://huggingface.co/papers/2512.15603)、[OmniPSD arXiv 2512.09247](https://arxiv.org/abs/2512.09247) / [项目页](https://showlab.github.io/OmniPSD/)、[DataCamp Qwen-Image-Layered 实操](https://www.datacamp.com/tutorial/qwen-image-layered)
- 托管 API：[fal Qwen-Image-Layered API](https://fal.ai/models/fal-ai/qwen-image-layered/api) / [fal 开发指南](https://fal.ai/learn/devs/qwen-image-layered-image-to-image-developer-guide)、[RunComfy API](https://www.runcomfy.com/playground/qwen/qwen-image/layered/api)、Replicate `qwen/qwen-image-layered`（≈$0.03/张，见 DataCamp）
- 综述：[AI Layer Extractor (Jenova)](https://www.jenova.ai/en/resources/ai-layer-extractor)、[Atlas Cloud 2026 image API benchmark](https://www.atlascloud.ai/blog/guides/2026-ai-image-api-benchmark-gpt-image-2-vs-nano-banana-2-pro-vs-seedream-5-0)
