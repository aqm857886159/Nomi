# 3D-BOX 第三棒：工具 + skill + 导演视图（全部在构建开关后）

> 状态：📝 方案 v2（2026-10-04）。v1 → 用户 grill 拍板 → R7 六角色 + 对抗评审（10 条阻断，全文存编排者资料 `phase3-review.md`）→ 本版逐条吸收，并据评审追加两项用户拍板。基准 `origin/main @ 9bd8bf426`。
> 前序（均已合入并有 `delivery:verify-merged` 收据）：评测底座 #970、S1 计划 + 编译器 #971、盲测终审 #972、素材（Quaternius CC0 人偶 + Kenney）#973；尺子专班 #974（draft）。
> 关联：`docs/plan/2026-10-03-director-3dbox-eval.md`、`docs/plan/2026-10-04-director-3dbox-s1.md`、`docs/plan/2026-10-04-director-3dbox-assets-a.md`、工具面设计正本 `docs/plan/2026-09-14-agent-tool-face-v2.md`。

## 0. 一句话

用户在右侧 Agent 面板说一句话 → Agent 交一份**导演计划**（意图，无坐标）→ 确定性编译器出 3D 工程 + 测量问题清单 → **导演视图**显示镜头条（实测景别 / 运镜）与预览 → 用户继续聊着改（Agent **只交改动处**，手调默认保留）→ 「用这段预演出成片」= 整段预演挂一个视频节点 video_ref，由 `generate` 出报价卡花钱。旧导演台保持默认；新版全部在构建开关后。

## 1. 用户拍板（2026-10-03 / 04）

1. 架构：LLM 只出导演计划 → 确定性求解 → 测量自检。证据：尺子专班分支 `0d59c1d06` 上实体对应修好后，s0-pr960-raw 0.264、s1 0.577（收据 `evals/runs/director-20261004015947-s1/`、`…015948-s0-pr960-raw/`）；main 上旧尺子的 0.213 因没有实体对应而作废。
2. 入口复用右侧 Agent 面板；导演台由全屏覆盖层改为占画布区（布局 A），默认「导演视图」v2，现有工具收进「精修」。样张已拍，实施时入库 `docs/design/`。
3. 出片：整段计划 → 一段预演 → 一个视频节点（video_ref）；花钱只走 `generate`。
4. 工具：不新增 director_* 一组；升级 `stage_shot`；**首次搭建交整份计划，修改只交改动处（补丁）**；读计划走 `look_at_canvas`。
5. **撤销做统一的**：按工具面设计正本 §7 的原目标（任一写动词返回 changeId，`undo` 按它回退），给画布写补撤销契约，导演计划修订记进画布同一本历史；⌘Z 与对 Agent 说「撤销」回退同一本账。（用户 10-04：「从逻辑上以及长期价值上哪个更好，而不是为了简单和着急」。）
6. **按指令最小改动**：指令不引起计划变化就不动；手调默认保留；只有被新指令直接改到的那一项才重算，并明说、可撤销。
7. 3D-BOX 默认角色 = Quaternius UAL CC0 人偶 + 原生 45 动作（#973）；X Bot 重定向搁置。
8. 动作库缺的细节动作（「藏信」「横步挡门」）交给视频模型：写进喂视频节点的提示词；评测单列。
9. 发布：逐步合入 main，旧导演台默认；开关后测试（PR 预览包或 dev）；开关 2026-11-15 到期。
10. 切换门槛（全满足才切）：① **真实 Agent 模型走真实工具调用**的端到端评测，S1 总分 ≥ 0.80 且计划合格率 ≥ 95%（DeepSeek 替身只用于开发迭代，不算门槛）；② 盲测通过、诱饵检出 ≥ 90%、与用户 12 段打分一致；③ 样张逐项对账；④ 三条真实用户任务真机走查全修完。到期未达标问用户继续还是放弃。

## 2. 现状事实（实查，以 `9bd8bf426` 为准）

- `stage_shot`：`electron/shared/agentCapabilities/verbs/writeVerbs.ts:330-368`，契约 `canvas.write`——**它同时投影成对外 MCP 的 `nomi_canvas_edit`**（`canvasWrite.ts:597-604`、`mcpCapabilityProjection.ts:367`），preload 另有手写操作白名单（`electron/surfacePortPreloadBridge.ts:110-121`）。
- `undo`：`writeVerbs.ts:393-404`，契约 `timeline.write`（`verbProjections.ts:204-219`），notWhen 写死「画布节点由用户 Cmd+Z 撤」（`:398`）。设计正本 §7（`2026-09-14-agent-tool-face-v2.md:87`）：跨状态撤销未做。画布撤销今天在渲染层：会话日志前缀重放（`store/generationCanvasStore.ts:191-196`）。
- 工具注册表在**模块导入时**装配成常量（`verbDeclarations.ts:17`、`modelFacingToolRegistry.ts:55`、`laneToolCatalog.ts:44`），被主进程、渲染端、pi 岛、MCP 启动进程、门岗脚本、vitest 导入。现成同步 IPC：`electron/preload/ipcCall.ts:19`。主进程「构建时烤配置」先例 `scripts/write-intake-config.mjs`（但它**环境变量优先**，`telemetry/intakeClient.ts:87`，开关不能照抄这一点）。
- 编译器实体 id 带整份计划的哈希（`model/compiler/directorPlanCompiler.ts:186-198`），各镜头互相牵连（连续镜头接上一镜终点、越轴方向全片共用、演员位置看排序）。
- 导演编辑器挂载时建一次 store，之后每 2 秒空闲与退出时把整份工程写回节点 meta（`DirectorEditor.tsx:259-318`）；导演台自己的撤销栈（`model/directorStore.ts:96`）、画布撤销（上文）——同一份工程上两本历史。
- 离屏出片 `nodes/director/agent/DirectorHeadlessCapture.tsx`（#972 加了 `cameraIdAt` / `captureSize` / 等动作片段）；挂接核心 `attachCameraMoveToTarget.ts#computeAttachCameraMove` 只收单个运镜；录制上限 240 帧（`CameraMoveCaptureHost.tsx:37`）。
- 计划 schema 引用 `aiSceneSchema`、`EVAL_SHOT_SIZES`、`CAMERA_MOVES`；electron 不许引用 src（`.dependency-cruiser.mjs:69-73`）。
- 编译器 / 规划器 / 尺子只认 X Bot 动作 id（`directorPlanCompiler.ts:82-87`、`directorPlanner.ts:8`）；姿势预设按 Mixamo 骨名写死（`posePresets.ts:37-40`）。

## 3. 概念占用表（R33）

| 概念 | 唯一 owner | 允许消费 |
|---|---|---|
| 导演计划 schema | `electron/shared/director/directorPlanSchema.ts`（从 `src/.../model/plan/` 搬来，原处删） | 工具声明（经模型面投影）、编译器、评测、规划器 |
| 导演词表（景别 / 运镜 / 场景模板） | `electron/shared/director/vocab.ts`（从测量与 aiScene 搬来；测量改为消费方） | schema、测量、编译器、UI |
| 计划写法指导 | `stage_shot` 的 `promptGuidelines` + `skills/director-3dbox/SKILL.md`；范例**不取题库任何卡** | Agent；评测规划器机器拼同一份文本 |
| 计划 → 3D 工程 | `model/compiler/directorPlanCompiler.ts`（**实体 id 由计划里的名字派生**，不带哈希） | 执行体、评测 |
| t 时刻机位位姿 | `model/cameraPoseEval.ts`（#974） | 播放、测量、出片回读 |
| 导演工程的唯一写者 | 编辑器开着 → 编辑器 store；关着 → 节点 meta（AI 写入同样走这条） | stage_shot 执行体、精修编辑、自动保存 |
| 撤销历史 | 画布历史（会话日志）为唯一一本；导演计划修订、编辑器内手改都作为条目记进去 | ⌘Z、Agent `undo`、导演视图撤销按钮 |
| 画布写撤销契约 | `canvas.write` 新增撤销分支 + changeId（设计正本 §7 的目标） | Agent `undo` |
| 手改覆盖层 | `nodes/director/model/planOverrides.ts`（按稳定 id 的逐属性差量） | 精修写入、重编译后重放、执行体结果 |
| 计划补丁与差异 | `electron/shared/director/planPatch.ts`（补丁应用 + 受影响实体） | 执行体、评测 |
| 3D-BOX 开关 | `electron/shared/featureFlags/director3dbox.ts`（每个进程首个导入的引导模块） | 注册表装配、导演台外壳、角色运行时、门岗 |
| 预演挂接 | `computeAttachCameraMove` 扩展为整段预演的唯一挂接核心 | 预演出片、视频节点 |
| 素材目录 / UAL 动作 | `model/assetCatalog/`（#973） | 编译器、规划器、角色运行时 |

第二个写口即违规；渲染层替主进程判断开关的补偿逻辑打回。

## 4. 开关

- 构建变量 `NOMI_DIRECTOR_3DBOX=true` → `build-electron.mjs` 烤进 `dist-electron/feature-flags.json`；渲染端 Vite 构建同一变量 define 进去（两边同一次构建、同一个值）。
- **打包后只认烤进去的值，忽略运行时环境变量**（与 intake 先例相反，防止正式版用户自设变量打开）；dev 才读环境变量。
- 每个进程（主进程、渲染端、pi 岛、MCP 启动进程）第一个导入引导模块；主进程启动时算开关指纹，其它进程经同步 IPC 核对，不一致 → 全部按关处理并记日志。
- 预览包：`desktop-preview.yml` 在 PR 带 `director-3dbox` 标签**或** `workflow_dispatch` 输入 `director3dbox=true` 时打开；新增 `check-packaged-flags`（照 `check-packaged-intake`）确认配置真的进了包。
- 登记带到期日（2026-11-15）的临时债，到期即红。

## 5. 工具面

- **契约层换芯，不动对外面**：新建**仅内部**的 `director.write` 契约（不投影到 MCP，preload 白名单只在开关开时追加），升级版 `stage_shot` 指向它。开关关时对外 MCP 面、preload 白名单逐字节不变。
- 升级版 `stage_shot`（同名换芯，任何一次构建只装配一份）：
  - 新建：`target`（`{ shotId }` 为镜头新建 / 省略新建独立预演）+ `plan`（完整计划，经**模型面投影**：strict、每字段有描述、无根级 union / const）。
  - 修改：`target: { directorNodeId }` + `baseRevision` + `edits`（补丁：对命名镜头 / 角色 / 场景件的增删改，参照 RFC 6902 的语义，操作集在实施方案里收窄）。过期修订即拒。
  - 结果：`revision`、`changeId`、`unchanged: true`（补丁不改变规范化计划时）、**规范化后的完整计划**、编译问题清单、每个 cut 的实测景别 / 运镜、**被重排的手改列表**、预演状态。
  - `prepareArguments` 用 `modelArgumentTolerance` + 无损同义归一（`normalizeDirectorPlan` 的无损子集）；`reversible_local`，永不花钱。
- `look_at_canvas`：3D-BOX 节点给修订号、镜头 / 角色名单（补丁要用的名字）、问题数；完整计划在每次 `stage_shot` 结果里。
- **统一撤销**（单独一段，产品级，不在开关后）：`canvas.write` 补撤销分支与 changeId；`undo` 按 changeId 前缀分派到时间轴或画布；冲突规则——要撤的条目之后同一对象又有别人的改动 → 拒绝并说明，不静默连带撤。改内部面语义，PR 里写清并请用户签字（`check:model-face-frozen` 更新基线）。
- **开关开的那张面进 CI**：新增一个 CI 任务用开关开跑 `check:model-schema`、`check:tool-face`、`check:model-face-frozen`（第二份快照 `scripts/model-face-baseline.director3dbox.json`）、`check:agent-tool-face-usecases`（`requiresFlag` 用例；门岗里显式只认这一个开关）、`check:skill-tool-binding`（两张面各比一次）。开关参数用环境变量传，不靠 `-- --flag` 透传（`node --test` 不收）。
- skill 文案避开花钱判据（不写「generate 出报价卡」这种句子；改为「用户确认后由生成环节出价」，以 `check:skill-tool-binding` 为准）。

## 6. 按指令最小改动

前提（**先做**）：编译器实体 id 改由计划名字派生（`actor:<id>`、`shot:<id>/camera`、`setPiece:<id>`），去掉计划哈希。
1. 补丁应用后规范化计划不变 → `unchanged: true`，不重编译。
2. 有变化 → **整份重编译**（编译器确定性，跨镜头牵连照常算），再按稳定 id 重放手改覆盖层。
3. 补丁**直接改到**的实体属性（如 `shot:2` 的景别 → 该镜机位位置 / fov）上若有手改 → 以新指令为准、丢弃该条覆盖，列进「被重排的手改」，Agent 必须告诉用户；撤销可恢复。
4. 重编译导致**未被直接改到**的实体也变了（连带）→ 该实体上的手改照常重放；结果里列出「连带变化的实体」，供 Agent 说明。
5. 编译器不知道覆盖层（编译后叠加）；测量对「编译 + 覆盖」后的工程测。

## 7. 导演视图 UI（A + v2，开关后）

1. `DirectorEditor.tsx:381` 全屏 portal → 开关开时占画布区，右侧 Agent 面板可见；嵌入后重做焦点与快捷键捕获范围（画布 / 导演视口 / Agent 输入框三者边界）。
2. **一个写者、一本历史**：编辑器开着时，AI 写入进编辑器 store（store 是唯一写者，meta 只做持久化，自动保存不再覆盖 AI 修订）；导演台内的撤销条目并入画布历史。
3. `DirectorViewport.tsx:155` 的 AiSceneBar → 开关开时不挂。
4. 默认「导演」视图（视口 + 镜头条 + 预览小窗 + 「用这段预演出成片」）；「精修」= 今天整套工具原样。
5. 镜头条 / 视口选中 → Agent composer 上下文标签「正在改：镜头 N」。
6. 全状态：空态、编译失败、预演渲染中 / 失败、花钱失败；zh / en；Windows 真机。
7. **预演要看得懂**（2026-10-04 盲评批次证据：评审与测量不一致的 80 条里 47 条是「白模太粗看不出运镜」）：地面网格可见、角色按身份配色、主体与场景件明暗区分、天空渐变给地平线参照；同一套样式用于盲评渲染与用户预览（一个 owner）。

## 8. 预演出片与花钱边界

- `DirectorHeadlessCapture` 按时刻取节目机位、打开「等动作片段就绪」；超过 240 帧分段录制或提高上限（实施方案定，需真机测内存）。
- `computeAttachCameraMove` 扩成整段预演的唯一挂接核心（不另写第二个）；挂到视频节点 video_ref；动作库缺的细节动作写进该节点提示词。
- **花钱闸**：视频节点处于「预演渲染中」时 `generate` 拒绝（返回原因，Agent 说明「预演还在渲染」）；渲染失败 → 节点显示失败与重试，不放行无参考的生成。
- 视频模型没有 video_ref 槽 → 退到提示词兜底并**明说**「这个模型不接参考视频，运镜只能靠文字描述，精度会低」（沿用现有挂接的降级做法）。

## 9. Skill

`skills/director-3dbox/SKILL.md`（开关关时不可选）：看画布 → 首次交整份计划 / 修改交补丁 → 读问题清单 → 最多 2–3 轮自修 → 告诉用户看预演；复述被重排的手改与连带变化；用户确认出片后交给生成环节。镜头语言引用 `director-cinematography`；不复述工具性质；范例 3 份取题库以外的场景。

## 10. 分段实施（概念不并发）

| 段 | 内容 | 前置 / 并行 |
|---|---|---|
| P1 | S1 第三轮（规划器质量，进行中）→ S1 第四轮：编译器稳定 id、计划 schema 的模型面投影 | S1 持有编译器 / 规划器 |
| P2 | 词表与计划 schema 搬到 `electron/shared/director/` | #974 合入后（测量的景别刻度归尺子专班，届时概念空出来） |
| U | 统一撤销（`canvas.write` 撤销契约 + changeId + `undo` 分派 + 冲突规则），产品级、独立 PR、用户签字 | 与 P1 并行（不碰计划 / 编译器） |
| 3a | 开关引导模块 + 指纹核对 + 预览包 + 导演视图外壳（布局 A、导演 / 精修、AiSceneBar 不挂、镜头条只读）+ 一个写者一本历史 + 焦点快捷键 | 不碰计划 schema，可与 P1 / U 并行；历史并入依赖 U |
| 3b（设计卡 `docs/plan/2026-10-04-director-3dbox-3b-design-card.md`） | `director.write` 契约 + 升级 stage_shot（新建 + 补丁）+ look_at_canvas + 预演挂接与花钱闸 + skill + 开关开的面进 CI | P1、P2、U 之后 |
| 3c | 覆盖层 + 最小改动 + 镜头条选中联动 | 3b 之后 |
| 3R | UAL 角色运行时：编译器 / 规划器 / 尺子动作 id 切到 UAL、`ual-rig.json` 接姿势与 IK、旧 X Bot 工程可读 | 编译器（S1）、尺子（ruler）协同一轮；3b 之后 |
| 3d | 样张对账、真机走查、**Agent 模型在环评测**（真实 Agent 模型调 stage_shot）、盲测复核 → 门槛评估 | 全部之后 |

每段：draft PR、门岗、合入后 `delivery:verify-merged` 收据；没收据不合下一段。

## 11. 不动项与回滚

- 不动：开关关时的一切（旧导演台、旧 stage_shot、对外 MCP 面、preload 白名单、AiSceneBar、X Bot）；正式发版工作流。例外：段 U 是产品级改进（Agent 能撤画布改动），独立 PR、独立验收。
- 回滚：每段独立 PR 可整体 revert；开关关即回旧行为。
- 切换 PR（门槛达标后）同 commit 删：旧 stage_shot 两支及其 `canvas.write` 操作、`stagingBuilder` / `cameraMoveBuilder`、AiSceneBar + `useAiSceneBuilder`、开关与分叉、第二份快照、`DirectorHeadlessCapture` 的「等动作片段」开关（翻成默认）；关闭 PR #960。

## 12. 验收（R13）

工具写对率 + 回合成功率写进每段 PR（真实应用 / 页面输入 / 工具轨迹 / 素材）。真实用户任务**不只用标尺题**：标尺三题做走查之外，另写 3 条题库外任务（如「两人在咖啡馆对话，正反打 + 慢推」）作为门槛评测的留出集；每条任务含一次「已经是了」与一次与手改冲突的修改，最后到出成片报价卡。

## 先查别人

- LibTV 3D-BOX（1.5 评测，用户提供）：[文章](https://x.com/aiwarts/status/2103835392961339504)——一句话 → 场景 + 运镜 + 预演，对话改。
- E.T. 相机轨迹生成：[arXiv 2407.01516](https://arxiv.org/abs/2407.01516)；ChatCam 对话式相机控制：[arXiv 2409.17331](https://arxiv.org/abs/2409.17331)；Director3D：[arXiv 2406.17601](https://arxiv.org/abs/2406.17601)；Holodeck（LLM 出约束、求解器出布局）：[arXiv 2312.09067](https://arxiv.org/abs/2312.09067)——都是「意图 / 约束由 LLM 出，几何由求解出」，与本方案同类。
- FilmAgent（Apache 2.0）：[HITsz-TMG/FilmAgent](https://github.com/HITsz-TMG/FilmAgent)——命名站位 + 动作 / 机位清单，作规划器词表参照（署名）。
- JSON Patch 语义：[RFC 6902](https://www.rfc-editor.org/rfc/rfc6902)——补丁操作参照，实施时收窄操作集。
- 本仓工具面设计正本 `docs/plan/2026-09-14-agent-tool-face-v2.md:87`（跨状态撤销的原目标）。
