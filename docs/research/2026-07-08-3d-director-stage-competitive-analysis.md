# 3D 导演台竞品对标 + 最新运镜控制技术全景（2026-07-08）

> 触发：用户「研究 TapNow 和 LibTV 的 3D 导演台，研究最新做类似技术的东西，做对比，提优化」。
> 这份文档同时充当当天的论文/情报雷达（07-08，覆盖近 12 月）。竞品能力全部实查/实抓，不凭记忆（D3）。
> 配套优化 plan：`docs/plan/2026-07-08-director-stage-optimization.md`。

## 一句话结论

**「3D 站位导演台」已从 Nomi 的差异化，变成赛道标配——LiblibAI(LibTV) 和 TapNow 两个大厂 2026-06 前后都上线了几乎一模一样的东西（素模+机位+截图→参考图），UX 还更 polish。** 但它们的导演台**只做"站位（静帧参考图）"，把"运镜（相机移动）"整个甩给 prompt**。Nomi 唯一真正甩开它们的，是**运镜出视频（灰模相机路径→mp4→video_ref）+ 游戏式角色操控（走位/录 take/pose-over-time）**这块「动态 previz」。而全球轻路径领跑者（Higgsfield / 可灵 Motion Control）在用「参数化光学仿真 / 单图推深度」绕开搭 3D 这件事，覆盖了 Nomi 和 LibTV/TapNow 都没覆盖的「不想搭 3D 就想精确调运镜」的大多数镜头。

**战略含义：站位导演台=商品化（solo 跟大厂拼迭代必输）；护城河=「节点画布(跨镜身份+版本树) × 精确 3D 几何 × 动态 previz」这个组合（对手要么没画布、要么没动态 previz）。优化应主押「动态 previz」+ 补一个轻运镜入口，不打站位 polish 军备赛。**

---

## 一、TapNow 3D 导演台（已核实）

TapNow = 聚合 35+ 模型（Sora 2 Pro/Veo 3.1/可灵/即梦等）的**节点式无限画布**创作平台 + AI 执行导演 Agent。它的「3D 导演台」：

- **摆积木式 3D 空间**：放**人体素模 / 基础几何 / 群众阵列(3×3) / 场景元素**，调位置/角度/大小。明说「不要求会 Blender，不需要从零建模」。
- **两种视角**：导演视角（站片场看全局站位关系）↔ 机位视角（相机看到的构图）。
- **截图→发送到画布**：摆好机位截图 → 右侧「摄像机截图」→ 发送到画布当参考图，喂后续图/视频生成。
- **多机位一键分镜**：摆好后建多个机位（全景/特写/过肩），**三个画面同时截出**当分镜——一次出一组。
- 另有影棚级灯光、多角度镜头控制、影视工业级相机参数模拟；运镜靠 **JSON 参数化 prompt**（镜头型号/焦段/光圈/推拉摇移），非 3D 渲染。
- 定位：解决「空间关系 / 人物站位 / 镜头角度」三个 AI 视频最难稳的问题，「先固定立体站位，再让 AI 按参考生成，避免瞎猜」。

来源：[cnblogs 实测](https://www.cnblogs.com/ljbguanli/p/20108131) · [CSDN 进阶指南](https://blog.csdn.net/2203_75449278/article/details/160885337) · [知乎 最像导演的 AI](https://zhuanlan.zhihu.com/p/1972112546304594378) · [官网](https://www.tapnow.ai/zh)

## 二、LibTV(LiblibAI) 3D 导演台（已核实）

LibTV = LiblibAI 的一站式 AI 视频平台，自称「首创**无限画布 + 节点式工作流**」，面向人类 + AI Agent 双入口。导演台 2026-06-01/02 前后作为**画布一级入口**上线（双击空白→导演台按钮→打开）：

- **轻量级 3D 构图节点**：人体素模（男女老少高矮胖瘦）/ 基础几何 / 群众阵列 / **本地上传模型**；移动=站位、旋转=朝向、缩放=体积。
- **导演视角 ↔ 机位视角**切换；左栏元素清单（删/重命名/打组/隐藏）+ 右栏对象属性（角色/基础模型/摄像机）。
- 相机任意角度含**俯视**、**FOV 可调**、截图比例可选 → 截图 → 发送到画布当参考图。
- **姿势/动作控制**：可指定 AI 演员摆任意姿势（静态 pose）。
- **进阶：普通场景图一键转 720° 全景图** → 再摆位设机位，适配不同镜头。
- **定位/分工明确**：「导演台负责构图和机位（静帧参考图）」，运动/运镜由画布其他能力（prompt `@视频1 参考运镜` + 预设工具箱 + 后期变速）承接。**导演台本身不出运镜视频。**

来源：[腾讯新闻 站位镜头终于有解](https://news.qq.com/rain/a/20260601A066PX00) · [腾讯新闻 多角色换机位一致性](https://view.inews.qq.com/a/20260602A033B300) · [知乎 站位一手实测](https://zhuanlan.zhihu.com/p/2045196370760423335) · [知乎 指定 AI 演员姿势](https://zhuanlan.zhihu.com/p/2044799703062246834) · [木瓜 AI 上手指南](https://www.mooko.cn/article/208) · [AIHub](https://www.aihub.cn/tools/libtv/)

**→ TapNow 与 LibTV 的导演台功能几乎一致，都是「素模摆位 + 机位 + 截图参考图」的静帧站位工具，都不出运镜视频。与 Nomi 的 `create_staging_reference` + `StagingCaptureHost → composition_ref` 同构。**

## 三、轻路径领跑者：不搭 3D 也能精确运镜

### Higgsfield Cinema Studio（产品化，2025-12 起迭代到 3.x）
- **确定性光学仿真引擎**：选虚拟机身（ARRI/RED/Sony 传感器）+ 镜头（anamorphic/16mm/macro）+ 光圈/景深/焦段，**可叠最多 3 层同时运镜**（如慢 dolly-in + 软 pan），模拟真实机架。有 **Virtual Camera Rack 可视化面板**（不是纯自由文本）。
- 工作流 "Hero-Frame-First"：先出预览静帧→选 hero frame→再动画化。口号「full camera control without a camera」。
- 短板（14 天实测）：剧烈运镜/打斗约 1/5 会崩、微表情控不了、要懂光学。它本身是多模型工作台（内嵌 Seedance/Kling/Veo/Sora/Wan），Cinema Studio 是自研控制层。**是"轻入口精确运镜"的标杆。**
- 来源：[Cinema Studio 指南](https://higgsfield.ai/blog/cinema-studio-guide) · [Camera Controls](https://higgsfield.ai/camera-controls) · [2.5 版 14 天实测](https://www.michydev.com/higgsfield-cinema-studio-2-5-review-first-14-days/)

### 可灵 Kling Motion Control（产品化，Kling 3.0 / 2.6 2025-12）
- 两个都叫 Motion Control，别混：①**相机/运镜**：从单张 2D 图推深度与几何构一个「虚拟场景」，虚拟相机在里面 dolly/orbit/push-in/**视差**穿行，可调焦段模拟不同镜头，宣称"所见即所得、无需 3D 建模"；②**动作 Motion Control**：从参考视频迁移动作/表情/唇形/**相机线索**到静态角色。
- **官方明确定位 previz**：「suited for previsualization, storyboards, trailers」，导演用它做危险特技/动作戏预演——正是 Nomi 灰模运镜片想解决的同一痛点。
- ⚠️ 快手**没发技术论文**，"depth/NeRF/几何保持"多来自第三方托管平台营销，非官方架构确认（写 SOTA 前需知这层）。
- 来源：[Kling Motion Control 指南](https://kling.ai/quickstart/motion-control-user-guide) · [Kling 3.0(OpenArt)](https://openart.ai/ai-model/kling-3-motion-control/) · [the-decoder Kling 2.6](https://the-decoder.com/kling-2-6-adds-voice-control-and-motion-upgrades-as-ai-video-tools-race-toward-realism/)

### 大厂主力模型的运镜控制（都不搭 3D）
| 模型 | 控制手段 | 一句话 |
|---|---|---|
| Runway Gen-3 / Aleph | **滑块** + in-context 参考 | Gen-3 有相机运动滑块；Aleph「锁世界只换相机」重打光换角度 |
| Veo 3.1 | prompt 电影语义 | 镜头语言遵循最好，含原生音频 |
| Sora 2 | prompt + storyboard | 物理连贯最强，无参数化相机面板 |
| Luma Ray 3 | **帧上直接画标注** | reasoning 视频模型，Draft 快 20× |

**→ 消费级没有一个赢家让用户搭 3D 场景。控制手段是滑块/prompt 电影语义/帧上标注/参考视频换角度。**

## 四、学术前沿：3D 在退成"模型内部"，参考视频迁移成一等公民

- **PrevizWhiz（Autodesk Research, 2026-02）= Nomi 灰模路径的学术孪生**：用**粗糙 3D（grayblock）做 blocking**（角色位置+相机）→生成模型风格化→参考视频驱动动作 refine。明说「rough 3D 编码空间/时间线索，不打磨资产」。→ **Nomi 方向被顶级研究背书，不是野路子。** [arXiv 2602.03838](https://arxiv.org/html/2602.03838v1)
- **CinePreGen（2024-08）**：UE 引擎渲染+扩散，专攻相机放置这个 T2V 老大难。[arXiv 2408.17424](https://arxiv.org/abs/2408.17424)
- **GEN3C（NVIDIA, CVPR'25 Highlight）= "用户不搭 3D，模型自动建 3D cache"**：输入图→预测逐像素深度→unproject 成点云 cache→按用户相机轨迹渲染 cache→条件化视频扩散。比只喂相机参数精确得多。**若开源成熟可接，是 Nomi「懒人模式」的现成方案。** [research.nvidia.com/GEN3C](https://research.nvidia.com/labs/toronto-ai/GEN3C/) · [GitHub](https://github.com/nv-tlabs/GEN3C)
- **CamTrol（ICLR'25, training-free）= 机制和 Nomi 几乎同构，但用户不碰 3D**：在 3D 点云空间建相机运动→重排 noisy latent→插到现成 T2V，单图输入。[arXiv 2406.10126](https://arxiv.org/abs/2406.10126)
- **参考视频→迁移运镜（正是 Nomi 喂 video_ref 的做法，且是 SOTA）**：ReCamMaster（ICCV'25 最佳论文入围，快手 Kling，[GitHub](https://github.com/KlingAIResearch/ReCamMaster)）、CamCloneMaster（SIGGRAPH Asia'25，直接从参考视频克隆运镜、无需估相机参数）、Go-with-the-Flow（2025，training-free，warped noise 注光流，[arXiv 2501.08331](https://arxiv.org/pdf/2501.08331)）、TrajectoryCrafter（ICCV'25 Oral，代码+HF demo）。**基础设施：[CamI2V repo](https://github.com/ZGCTroy/CamI2V) 一处实现 MotionCtrl/CameraCtrl/CamI2V/RealCam-I2V。**

**风向判断：主流不在"搭真 3D"，而在"2D 图/参考视频推几何 + 参数化/prompt 光学仿真"。3D 作为用户可见的操作步在退场，作为模型内部的几何基座在留存。参考视频迁移运镜正在成为一等公民——恰好 Nomi 已经在喂 video_ref。**

## 五、能力对比矩阵（Nomi vs 竞品，已实查）

| 能力 | Nomi | LibTV 导演台 | TapNow 导演台 | Higgsfield | 可灵 MC |
|---|---|---|---|---|---|
| 素模/几何/群众摆位 | ✅ | ✅ | ✅ | — | — |
| 导演视角/机位视角 | ✅ | ✅ | ✅ | — | — |
| 截图→参考图(站位) | ✅ | ✅ | ✅ | — | — |
| 全景背景 | ✅ 需 2:1 全景图 | ✅ 普通图自动转720° | ✅ | — | — |
| 多机位 | ✅ | ✅ | ✅ 一键批量出分镜 | — | — |
| 上传自定义 GLB | ❌ | ✅ | ✅ | — | — |
| 姿势/动作控制 | ✅✅ 12预设+逐骨骼滑块 | ✅ 静态 pose | ✅ 部分 | — | — |
| **运镜→出视频→video_ref** | ✅✅✅ **独有** | ❌ prompt | ❌ prompt/JSON | ✅ 光学仿真 | ✅ 单图推深度 |
| **WASD走位+录take+pose随时间** | ✅✅✅ **独有** | ❌ | ❌ | ❌ | 部分(动作迁移) |
| 相机轨迹系统(Catmull-Rom+时间轴) | ✅✅ | ❌ | ❌ | 叠层运镜 | 轨迹面板 |
| 参数化运镜轻入口(不搭3D) | ❌ **缺** | ❌ | JSON prompt | ✅✅ 虚拟机身/镜头/焦段 | ✅✅ |
| 参考视频→运镜迁移(video_ref) | 半(只灰模片) | ❌ | ❌ | ✅ | ✅✅ |
| 节点画布(跨镜身份+版本树) | ✅✅✅ | ✅ | ✅ | ❌ | ❌ |

读法：
- **静帧站位**这一档，Nomi 与 LibTV/TapNow **大致持平**，只差 3 个便利功能（上传 GLB / 普通图自动转全景 / 多机位一键批量分镜）——都是 polish，非解锁。
- **动态 previz**（运镜出视频 + 角色操控 + 轨迹）这一档，**Nomi 独有，LibTV/TapNow 完全没有**。这是护城河。
- **轻运镜入口 + 参考视频迁移**这一档，**Nomi 缺 / 只半条**，Higgsfield/可灵领先——这是 Nomi 该补的「effect-first 轻入口」。

## 六、优化方向（详见 plan 文档，此处结论）

**核心取舍（给用户拍板）：精力有限（solo），主押哪条？**
- **A｜追站位 polish 军备赛**（补上传 GLB/自动全景/多机位批量分镜）：代价=商品化能力，两个大厂随时跟平，护城河≈0。
- **B｜押它们做不到的「动态 previz」**：把独有的"运镜出视频 + 角色操控"做深做顺 + 学 Higgsfield 加**参数化运镜轻入口**（不搭 3D 也能精确调运镜）+ 接**参考视频→运镜迁移**（让 video_ref 不只来自灰模）。代价=更难做对/难 demo，但对手结构上抄不动。

**推荐：主押 B，A 只做最小止血。** 依据 D2（结构先于功能）+ D1（effect-first）+ `nomi-solo-founder-strategy`（广度是敌人、别做易被抄的商品化层）。站位导演台已商品化，solo 拼迭代必输；护城河在「节点画布 × 精确 3D × 动态 previz」的组合。

**顺带 P0（与方向无关、纯该修）**：主编辑器 `Scene3DFullscreen.tsx` Canvas 未声明 `frameloop`（默认 always），静止满帧 GPU（`docs/audit/perf/04-scene3d.md` 已标）——耗电/风扇第一根因，轻路径优化前先修掉。
