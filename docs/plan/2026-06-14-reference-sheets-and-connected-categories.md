# 定妆卡/场景卡 + 「分类×连接并存」 方案（待拍板）

> 来源对话：用户要求 ①角色/场景用「一张大图装多视图/多变体的定妆卡」喂视频参考；②模型只用 GPT Image 2（图）+ Seedance 2.0（视频）；③分类与连接要并存；④顺手解决连边丢失 + 分镜方案丢失。
> 本文先**调研 + 设计 + 提示词模板**，拍板后才实现（R4/R6/R7/R8）。

## 0. 调研结论（R6：别人怎么做这种「一张图多视图」的卡）

**角色定妆卡（character/turnaround sheet）核心套路**：
1. **结构化分段提示词**：Style（风格）→ Character Description（身份：脸/发/服装/标志物，**先锁身份再说视角**）→ Technical（布局：几视图、怎么排）。
2. **把图当「版面/网格」描述，而不是「让同一个人转身」**：明确写「character design reference sheet, same character shown in N views arranged left to right / 3×3 grid」。这是纯提示词里最稳的招。
3. **身份锁 + 服装复述**：身份描述重复一遍、跨视图「consistent facial features / outfit / proportions」。
4. **动画级最少 5 视图**：front / 3-4 left / side / 3-4 right / back；可加表情行、动作行、年龄/状态变体行。
5. **中性背景 + 平光 + 标签**：`white/neutral background, flat studio lighting, reference sheet style, readable labels`，A-Pose 比 T-Pose 更稳。
6. **负向**：防 view-merging / feature-drift / 背景污染。
7. **比例**：横向定妆卡 16:9（或 3:2）。
8. **GPT Image 2 尤其擅长这种多面板版面遵循**（来源专门有 GPT Image 2 定妆卡教程）——和用户「只用 GPT Image 2」一致。

**场景卡（environment/scene sheet）**：同理——master establishing shot 定基调 → 多角度（wide 远景 / close-up 近景 / overhead 俯视 / 3-4 视）只变机位不变内容 → 锁视觉常量（色调/光源/关键道具）→ 整张喂 reference-to-video。

来源：[Scenario turnarounds](https://help.scenario.com/en/articles/generate-character-turnarounds) · [GPT Image 2 定妆卡(dreamina)](https://dreamina.capcut.com/resource/gpt-image-2-for-character-turnaround-sheets) · [banana-prompts 视角指南](https://www.banana-prompts.net/character-turnaround-ai-prompt/) · [Apatero 2026 指南](https://apatero.com/blog/ai-character-turnaround-sheet-generation-guide-2026) · [PixVerse GPT Image 2 提示词](https://pixverse.ai/en/blog/gpt-image-2-review-and-prompt-guide) · [Envato AI 视频一致性](https://elements.envato.com/learn/ai-video-consistent-character) · [ReelMind 场景一致性](https://reelmind.ai/blog/the-art-of-the-digital-scene-creating-consistent-environments-with-ai)

## 1. 「分类 × 连接 并存」——能，而且这才是对的（回答用户的疑问）

**技术事实**：参考的**投递本来就不分分类**——`generationReferenceResolver.ts:71` 顺着边取源节点的图喂模型，从不看 categoryId。当初坏的只是两件事：① 你停在「镜头」分类**看不到**角色卡；② 跨分类**没法手动连/管理**那条边。

⇒ 所以「既分类又连接」完全可行，且比上一版「全堆进 shots」(Option A) 更好——尤其配合定妆卡：**一个角色/场景 = 一张卡**，天然属于 cast/scene 资产库可复用。

**改法（替换已发的 Option A）**：
- 角色卡留 `cast`、场景卡留 `scene`、镜头留 `shots`（分类回归）。
- **把跨分类参考做成可见可管**：
  - 镜头节点上显示**参考芯片**：`参考：角色·林夏（待生成/已生成）｜场景·天台`，点击跳到那张卡。
  - 镜头节点提供**参考选择器**（不靠跨 tab 拖线）：从 cast/scene 已有卡里勾选作为参考 → 建立 character_ref/style_ref 边。
  - 落画布即按计划自动建好这些边（依赖波次：先生成定妆卡，再生成镜头）。
- 这样：分类清爽（资产库），连接可见可管，参考真的喂进视频。

## 2. 定妆卡/场景卡生成（核心新能力）

**形态**：一个角色锚 → **一张定妆卡大图**（多视图 + 表情 + 用户点名的年龄/状态变体，如成年/童年同图）。一个场景锚 → **一张场景卡大图**（多角度 + 近景/远景）。整张卡作为 `character_ref`/`style_ref` 边的源，喂给镜头视频。

**数据模型扩展**：`PlanAnchor` 增加可选 `variants?: string[]`（角色：如「成年」「童年」「战损」；场景：如「白天远景」「夜晚近景」），planner 产出、用户在方案编辑器可改。

**提示词模板（待拍板，基于调研）**：
- 角色卡：
  ```
  角色定妆参考卡（character reference sheet），白色中性背景，平光，版面横向排列、清晰分隔、每格下方小标签。
  同一角色 {name}，跨所有格保持脸型/发型/服装/标志物一致：{description}。
  视图：正面全身A-Pose｜侧面｜背面｜3/4侧｜表情行(中性/微笑/愤怒)。
  {variants 非空时追加：变体行：{variants 每项一格，标注年龄/状态}}。
  负向：避免格子合并、跨格五官漂移、场景背景。
  ```
- 场景卡：
  ```
  场景参考卡（environment reference sheet），版面横向排列、清晰分隔、每格小标签，统一色调/光源。
  同一地点 {name}：{description}。
  角度：远景establishing｜近景细节｜俯视overhead｜3/4视。
  {variants：如白天/夜晚 各一格}。
  负向：避免风格漂移、人物入镜。
  ```

**模型约束（用户铁律）**：本主链路生成**只用** GPT Image 2（所有图：定妆卡/场景卡/关键帧）+ Seedance 2.0（视频）。落画布注入默认模型时锁死这两个，不解析其它；编辑器/节点上这条链路不给换别的模型（其它模型仍可在自由画布用，不在本链路）。

## 3. 同时解决（用户点名）
- **连边丢失**：参考边随计划一次落地已有（applyCanvasToolCall），本方案再加「镜头参考芯片 + 选择器」让边可见可补，根治「连了看不到/没连上」。
- **分镜方案丢失**：确认落画布后 `StoryboardPlanEditor` 把 plan 清空（`:83 setStoryboardPlan(null)`）。改为**落画布后方案不清空**（或在画布顶部留「本画布来自方案 X · 查看/重开」入口），让用户随时找回原方案。具体形态拍板。

## 4. 决策（已拍板 2026-06-14）
| # | 决策 | 结论 |
|---|---|---|
| D1 | 分类模型 | **B：分类回归（角色→cast/场景→scene/镜头→shots）+ 跨分类参考可见可管**。撤上一版 groupCategoryId 全堆 shots——但要等 B 的 UI（镜头参考芯片/选择器）就绪再切，避免回退到「看不到」。 |
| D2 | 定妆卡模板 | 用 §2 模板（用户未否，按可逐字改推进） |
| D3 | 变体来源 | **AI 猜 + 用户手改**：planner 产出 variants，方案编辑器可增删改 |
| D4 | 分镜方案找回 | **一定要留**，位置/形态由我设计（见 §6） |
| D5 | 模型默认（不强制锁，改判 2026-06-14）| 图片**偏好级联**：GPT Image → 没有则 Nano Banana → 再没有取第一个可用图片模型（推荐而非强制，用户仍可换）。视频续偏好 Seedance。 |

## 5. 实现切片（避免一次性大改 + UI 走样张）
- **S1（安全核心，无 UI 回归，可单测，先做）**：`PlanAnchor.variants` schema + 定妆卡/场景卡提示词构造器（纯函数）+ 转换器让视觉锚生成「大卡」+ 模型锁（图=GPT Image 2、视频=Seedance 2.0）。期间保留上一版 groupCategoryId 作 stopgap，不回退可见性。
- **S2（UI，先出样张拍板 R8）**：镜头节点「参考芯片 + 参考选择器」、跨分类参考可见可管 → 就绪后切 D1=B（撤 groupCategoryId）。
- **S3（UI，先出样张）**：分镜方案找回入口（§6）。

## 6b. 连接思路最终拍板（2026-06-14 对话）
- **D1 改判 → A 参考槽**：不跟跨画布连线较劲。镜头节点用既有「参考槽」（`NodeParameterControls.handleSlotAssignment`，可指任意节点、自动建边、显示在镜头上）。角色/场景卡留 cast/scene 库，引用长在镜头上、跨分类 picker 挑。撤 groupCategoryId stopgap（注意：已有平行会话把分类做成「单画布按 activeCategoryId 过滤」E3，需协调）。
- **自动化（用户要）**：① 分镜方案落画布**自动把镜头的参考槽填上**对应锚（character→character_ref 槽、scene→style_ref 槽），用户不手连；② 生成走依赖序（参考先生成），单节点「生成」也respect（见下）；③ 参考卡生成完 → 依赖它的镜头标「参考就绪/已更新」。**不自动重生成视频**（耗用户额度，除非用户明确要）。
- **边 bug 调查结论（只读代码）**：① 单节点 `canRunGenerationNode` 其实已对 video 节点要求「参考解析得到 URL 才可生成」(:383)，并非裸跑无门；② 投递路径 `character_ref→referenceImages 超集→buildArchetypeInputParams` 看起来通（:72-78）。⇒ 最可能真因 = **镜头所选视频模式没有 image_ref 槽**（换了模型/模式或默认解析失败），解析出的角色图无槽可投 → 静默丢。此点**读码无法确诊，需真实生成埋点**（vendor HTTP 在主进程，渲染层抓不到——`docs/workflow/2026-06-06-real-generation-e2e-loop.md`）。
- **本轮做**：S2 参考槽自动填 + 就绪信号（安全、无 auto-spend）+ 真实生成埋点确诊投递。修到 file:line 后再补精确修复。

## 6. 分镜方案找回设计（D4，待样张细化）
方案数据已落 workbench store（`storyboardPlan`），确认后被 `setStoryboardPlan(null)` 清掉。设计方向：① 落画布后**不清空**，方案在创作区保留为「已落地」态可回看/重开；② 画布顶部留「本画布来自方案 X · 查看」入口跳回；③ 方案随项目持久化（不只内存），重开项目还在。具体形态出样张后定。

## 5. 不在本轮 / 风险
- 定妆卡是「最难的提示词类型」（调研原话，失败率高）——需要重试/多出几张选最好；首版接受「不完美、可重生成」。
- 单图多变体 vs 拆成多图各生成：首版走单图（用户已验证「效果没啥问题」），留拆图 fallback 为后续。
- 实现属「分镜主链路」大改，走 R7 评审 + R8 样张（镜头参考芯片/选择器要出 mockup）再落地。
