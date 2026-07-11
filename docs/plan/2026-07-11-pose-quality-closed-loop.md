# 姿势人眼质量闭环 — 观察器补强 + 受约束调参 + 循环收敛（2026-07-11）

> 工单：姿势预设「人眼一看就不对，但 AI 截图盲改欧拉角收敛不了」。用户要求：搭脚手架让观察测试**真正检出人眼问题**（它是最终闸），循环调整直到全过，然后才发 v0.16.4。
> 调研支撑：`research/2026-07-11-pose-correction-scaffolding.md`（5 路收敛：确定性几何当主判据、VLM 降残差判官、诊断→受约束算子、绝不让 VLM 直接吐欧拉角）。

## 0. 人眼 ground truth（2026-07-11 本人逐图判读 .pose-lab/ 全量 13 预设 ×3 视角）

**系统性缺陷 G1**：几乎全部预设**头栽向胸口 + 含肩**（standing/t-pose/walk/run/squat/crouch/double-knee 全中）——疑似默认姿势基线或复制粘贴的同组颈椎值，先查 `MANNEQUIN_DEFAULT_POSE`，可能一个根因打穿全库。

| 预设 | 人眼判定 | 可测量化 |
|---|---|---|
| squat 蹲下 | ❌ 上身极度前趴、头埋、踮脚、正面蛙式劈胯，「要栽倒」 | COM 前越支撑面；脚跟离地；躯干俯仰角；髋外展角 |
| crouch 半蹲 | ❌ 后仰依旧（骨盆前顶、肩在脚跟后、像靠隐形墙）；Spine+12 那刀没到根 | COM 后越支撑面（侧视矢状面）；躯干-骨盆链角 |
| single-knee 单膝跪 | ❌ 后小腿/脚整条翘空（应平贴地）；跪膝内扣交叉 | 接触集合缺失（后胫骨+脚背应触地）；膝内旋角 |
| double-knee 双膝跪 | ❌ 塌成趴伏（应上身立直跪坐）；手臂垂到近地 | 躯干俯仰角；手-地距离 |
| walk 行走 | ⚠️ 步幅夸张如弓步 + 头栽 | 步幅/腿夹角；颈俯仰 |
| run 跑步 | ⚠️ 弓背前趴 + 头深埋 | 躯干+颈俯仰 |
| sit 坐姿 | ⚠️ 轻度含胸、正面大腿外张偏宽 | 髋外展角 |
| standing/t-pose | ⚠️ 头低视地、含肩（G1） | 颈俯仰角 ∈ 自然区间 |
| hands-on-hips/point/wave/cheer | ✅ 大体可接受（循环里仍全量复判） | — |

**正面几乎看不出 crouch 的病、侧面一目了然** → 侧视是矢状面问题的权威视角，front-only 判定不可信（实证）。

## 1. 根因表述（P2）

人眼能看出而系统放行，因为：**确定性层只判「几何合法性」（落地/结构/id/间距），对「重心失衡、姿势走形、反关节、头颈异常」结构上无从发声；唯一能发声的 VLM 层 rubric 只有 1 句(仅 sit)、pass 保底 0.5 分、EPS=0.01 即固化、校准门(P/R≥0.8)从未强制、且默认模式(self/detect)根本不跑 VLM。** 而「AI 盲改欧拉角不收敛」的根因是：让 VLM/LLM 在它最弱的维度（左右/精确角度，实测≈瞎猜）上直接闭环，且观察无测量（像素→十几个欧拉角之间没有数字化中间层）。

## 2. 方案（对齐调研采用路线）

新增**确定性度量层**为主判据（人眼可见 ⇒ 观察器必报），VLM 降级为残差判官，修正走「诊断→受约束语义算子」，循环 τ+N_max。

### S1 度量核 `poseMetrics`（纯 TS，零渲染，vitest 可测）
`src/workbench/generationCanvas/nodes/scene3d/poseMetrics.ts`（≤800 行，必要时拆 poseRom.ts）：
- **COM**：Winter/Dempster 肢段质量系数（公有常数）按骨段加权 → 世界质心；
- **支撑面**：全蒙皮顶点 worldY < ε 的接触点 → XZ 凸包 → **COM 投影到凸包的带符号距离**（负=出界，可直接当调参目标函数）；
- **接触集合**：按蒙皮权重把顶点归到身体部位（脚底/脚跟/脚背/胫骨/膝/手…），输出「哪些部位触地」；与**每预设接触规格**（squat=双脚全掌，single-knee=前脚掌+后膝+后胫+后脚背，…）对账；
- **关节角**：骨四元数 vs rest → 逐关节局部角；AAOS ROM 硬闸（反关节）+ **每预设意图区间**（颈俯仰 ∈ [-10°,+15°]、squat 躯干前倾 ∈ [20°,45°]…）；
- **自穿插**：肢段胶囊两两最近距离（邻接豁免）；
- 输出：结构化 findings `{code, severity, measured, threshold, human(人话), suggestOps}`——posecode 思路的人话层内建。
- **铁律注释**：静态平衡判据无速度项，仅静态姿势有效；动态需 XcoM。
- 单测：在 vitest 里加载 x-bot.glb（three GLTFLoader，Node 18 有 fetch/Blob；不行则回退 walk 层跑度量），复用 `applyMannequinSkeletonPose`+`groundMannequinModel`（纯 three 数学，无渲染器）摆姿势后断言：**当前坏姿势必须被检出**（squat COM 出界、single-knee 接触缺失、G1 颈俯仰越界）= 观察器灵敏度证明（用户的「观察测试真观察到问题」验收）。

### S2 接线现有闭环（P1：升级不另起炉灶）
- `MODE=detect`（evals/loop/poseLoop.mjs）与 `staging-pose-shots.walk.mjs` 挂度量结果进 `_summary.json`；pass 条件从「落地+结构」升级为「落地+结构+**度量零 P0 finding**」。
- 诊断视角渲染加辅助线（GridHelper/AxesHelper/COM 投影标记）供 VLM 与人眼（裸截图判朝向≈0 的对策）。

### S3 VLM 残差判官改造
- rubric：13 预设逐个 checklist（意图句+失败模式，源自 §0 表+stagingTestCases ANATOMY），先 CoT 描述后判，输出 `过/不过+定位项+一句修正`，**无绝对分**；
- score 映射修掉 `max(0.5,confidence)` 保底与 EPS=0.01；确定性硬门 fail ⇒ 直接 0（不进 VLM）；
- 校准门真正执行：用 §0 人眼标注 + git 历史坏姿势当标注集，P/R≥0.8 才采信。

### S4 受约束语义算子 + 映射
`poseOps.ts`：`shiftWeight(±cm)/lowerHips/straightenTorso/liftHead/flattenFeet/tuckRearShin/adductThighs(…)`——每个算子=一组协同骨骼增量，效果可被 S1 度量预测与复验。finding→算子映射表（确定性 finding 直接映射；VLM 残差 critique 只允许从算子菜单选）。循环：detect→map→apply→re-measure，每预设 N_max=8 轮、τ=零 P0+VLM 过。

### S5 循环跑 13 预设收敛 + 终审
- 先修 G1（默认颈椎基线）再进循环（一根因打穿多预设）；
- 逐预设循环至过闸；`.pose-lab` 全量重截，**本人+VLM 人眼终审**（R13）；对比图存 docs/audit。

### S6 固化
- 度量 vitest 常驻 `pnpm test`（回归闸：好姿势的度量区间钉死）；
- 更新 `.claude/skills/nomi-pose-staging-calibration`（新脚手架用法）；
- memory 更新。

### 二期（本轮不做，backlog）
retarget 种子链（MediaPipe→Kalidokit 数学→骨名映射，全 MIT/Apache，3-5d）——若 S4 对顽固姿势收敛差再上；「摄像头示范摆姿势」用户功能另立项。

## 3. 不动项 / 回滚
- 不动：预设外的 Scene3D 运行时、序列化格式、walk 的既有结构断言、离屏渲染管线；
- 预设值变更 = 数据变更（scene3dConstants.ts），单 commit 可整体 revert；
- 新度量若误报率高：阈值收进每预设 spec 可调，不阻塞主线（gate 先只挂 P0 类）。

## 4. 验收门
1. S1 单测：13 预设当前值跑度量，§0 表里每个 ❌ 缺陷至少被一条 finding 命中（观察器灵敏度=用户验收原话）；
2. 循环后：13 预设零 P0 finding + VLM checklist 过 + 本人多视角人眼终审通过；
3. 五门全绿；
4. 发版 v0.16.4（含捕捞窗 M0 + B1 运镜，发版清单全串）。

## 5. 许可红线（碰都不碰）
SMPL/SMPL-X/AMASS/VPoser（非商用+专利）、Sapiens v1（CC BY-NC）、HybrIK、mp2signal（AGPL）。本方案全部自建纯函数 + 公有常数，零新依赖。
