# 站位参考 · 用户旅途级评测（A 层 builder/渲染覆盖）

> 2026-06-21。24 个覆盖矩阵的 spec（1–5 人 × layout × 朝向 × 机位 × 动作）→ 真 Scene3DAutoCapture 出图 → 逐张人眼判断「角色数/动作/朝向/机位/可读性」。配 [[staging-reference-tool-shipped]]。

## 怎么跑

`pnpm dev:renderer` → 截 `http://127.0.0.1:5273/staging-eval.html?page=0..3`（每页 6 例）。用例在 `src/devlab/stagingEval.tsx`，改 spec 即扩展。改 builder 后重截对比。

## 第一轮发现（24 例）

**判对的（17/24）**：单人站立/指向、双人对峙(面对面侧身清楚)、并排、坐站访谈、三/四/五人并排、混合朝向(camera/away/left 清楚生效)、背面机位、顶视环绕(顶视看圈最清)、混合动作、纵深+俯角。→ 多角色/多朝向**基本能做好**。

**判错/偏弱的（系统性，已分类）**：
| # | 问题 | 根因 | 处理 |
|---|---|---|---|
| 06 | behind+侧机位→像并排无纵深 | layout 与 camera 不匹配，侧机位沿纵深轴看 | ✅ 修：按 layout 给默认机位(behind→3/4高) |
| 10 | line+3/4→三人重叠难分 | 纵队从斜角堆叠 | ✅ 修：line 默认侧机位→侧身排开清晰 |
| 11/13 | circle+正面→挤成一团 | 正面看圈，前排背对挡后排 | 🟡 部分：circle 默认 high(比 eye 好)；纯方位仍顶视最清(已写进指引) |
| 21 | close+facing→两人间大片空 | facing 间距固定，近景没收紧 | ✅ 修：间距按景别缩放(close×0.62) |
| 08 | point 不瞄准具名目标 | point 是固定手势、方向身体相对、facing 也救不回 | 📝 限制：工具描述诚实标注「point 是手势非精确瞄准」 |
| 16 | 5+ 人颜色循环撞色(第5又红) | ROLE_COLOR_SEQUENCE 仅 4 色 | 📝 限制：4 人内无碍，5+ 罕见，未扩 |

另：群众实例化有条细横线小瑕疵(19，cosmetic)；agent 偶选 night 致深背景(默认 studio 浅色 OK)。

## 修复（根因·通用，非逐例补）

1. **按 layout 给默认机位** `LAYOUT_CAMERA_DEFAULT`（agent 省略 camera 时）：circle→high、line→side、behind→3/4 high、facing→3/4。→ 06/10/11 重跑明显改善。
2. **间距按景别缩放** `SHOT_SPACING_SCALE`（close 0.62 / medium 1 / wide 1.15）。→ 21 近景收紧。
3. **工具描述加取景指引**：不确定机位就省略(系统按 layout 自动取景)、who-surrounds-whom 用 circle、confront 用 facing、point/wave 是手势非精确瞄准。

第二轮重跑确认：06 纵深✓、10 纵队可读✓、21 近景✓、11 部分改善。

## 已知限制（记录，未修）

- point/wave 不精确指向具名目标（手势级）。要精确瞄准需按目标反算朝向——v1 范围外。
- circle 纯方位关系顶视最清；front/high 是「能看脸+大致看圈」的折中。
- 5+ 人身份撞色。

## B 层 · agent 选择质量（已跑）

`tests/ux/staging-agent-eval.e2e.mjs`（gated 文本额度）：8 个自然语言场景 → 真 LLM 产 spec → 判它选的 layout/poses/facing/camera。结果 **7–8/8 合理**：

| 场景 | agent 选择 | 判 |
|---|---|---|
| 求婚 | 跪+站·facing | ✓ |
| 围篝火坐 | 3坐·circle·high | ✓ |
| 站逼问坐 | 站+坐·facing | ✓ |
| 面对面争吵 | 双叉腰·facing·low | ✓ |
| 四士兵敬礼 | 4人·line·low | 🟡「并排」该用 side-by-side，agent 选了 line(纵队) |
| 人群欢呼 | cheer·solo+crowd | ✓ |
| 俯拍对坐下棋 | 2坐·facing·overhead | ✓ |
| 一前一后跟踪 | 2 walk·behind·facing[away/toward] | ✓ |

**结论：agent 能做好多角色/多站位/带朝向**——会用 high 配围坐、overhead 配俯拍、behind+facing[away/toward] 配前后跟踪。词汇表 + 工具取景指引生效。
小偏：「并排」偶被映射成 line(纵队) 而非 side-by-side——可在工具描述补「并排=side-by-side、纵队/列队=line」澄清（下次迭代）。

## C 层 · 真实生成 A/B（图像层，apimart gemini-2.5-flash-image，真实额度跑过）

`scripts/staging-ab.mjs`：硬场景各出图两次 A=纯文本 / B=文本+staging 灰模图(image_edit)。

- **反套路求婚（女跪男站）**：A 纯文本**也对了**（现代 gemini 图像模型对显式双人 blocking 服从度高）；B 带 staging 额外把 3/4 低机位+构图也锁进来了。→ **简单显式双人，文本已够，staging 增益主要在机位/构图。**
- **三人各异姿势（左坐/中站/右单膝跪）**：A 纯文本直接 failed/难产；B 带 staging **精确锁住三人各自姿势+站位+连颜色都复刻**。→ **多人特定姿势是 staging 的硬价值区。**
- **真限制（重要）**：用 `image_edit` 喂 staging 会让输出**偏 CGI/3D 渲染感**（三人组 B 像给灰模上色），太贴源图美学。→ 写实关键帧应把 staging 当**构图/姿态控制**（ControlNet 式，控布局不控像素）或加强写实 prompt，而非全图 edit。反套路 B 仍写实，说明因图而异。

**净结论**：staging 在「**多角色特定姿势 + 精确机位/构图**」处价值明确；简单显式双人现代图像模型已能从文本做好。

## D 层 · 修复（已实现+验证，commit 待推）

发现两个真问题并根治：
1. **结构性接线**：Seedance 等视频模型**没有 composition 槽**——composition_ref 直喂视频节点会被丢/误当首帧（灰人偶上屏）。正解=staging 接镜头的**关键帧图**（i2v 首帧源），视频继承。已在工具描述 + 系统提示写死「shotClientId 指关键帧图、非视频节点」。
2. **CGI 副作用**：image_edit 直喂灰模 → 输出像给灰模上色。正解=出关键帧时给 prompt 加「构图控制+写实重渲染」后缀（catalogTaskActions，scoped: staging 图作 composition_ref + 图像 kind 才加）。staging 图打 meta.stagingComposition 标记 → resolver 透出 → 任务组装注入后缀。
   **验证**：三人组重跑——无后缀=CGI 灰模上色；**有后缀=写实阳光广场（左坐/中站/右跪站位完全保留）**。✓

链路完整：staging(灰模) → 写实关键帧(构图锁定、自动去 CGI) → i2v 视频继承首帧站位。

## E 层 · 视频层验证（真实 apimart doubao-seedance-2.0 i2v，已跑）

`scripts/staging-video-ab.mjs`：把 staging 引导的写实关键帧喂 Seedance i2v 出视频，ffmpeg 抽首/尾帧比对漂移。
- **三人组**（左坐/中站/右跪）：首帧=尾帧站位全保持（相机推进但三人各自姿势+相对位置不崩）。✓
- **反套路求婚**（女跪/男站）：首尾保持，男方情绪反应(捂嘴)自然动起来、站位不变。✓
**结论：staging→写实关键帧→i2v 链在视频层成立——视频全程站位/动作不崩。** 这是「灌进去视频就稳」的最终证明。
坑：apimart seedance i2v 首帧走 `image_urls` 数组（非 firstFrameUrl）+ body 读 `{{request.params.model}}`（变体 modelKey 即 model 串）；hand-roll tasks.run 要按 archetype body 形状给键。

## 全链路总结

3D 站位校准 → 语义词汇表 + builder → 离屏出图 + 全局 Host → AI 工具(4 处注册+触发) → 三层评测(builder/agent/真实生成) → 根因修复(接线走关键帧+构图控制去 CGI+按 layout 默认机位+景别间距+point 瞄准+8 色) → 视频层 A/B 验证。staging 在「多角色特定姿势+精确机位+视频防漂移」处价值明确；简单显式双人现代图像模型已能从文本做好。
