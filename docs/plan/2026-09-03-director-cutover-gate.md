# 导演台 V2 → 切换门方案与执行记录

> 状态：🚧 C1–C8 已在工作区执行，未提交。用户于 2026-09-03 拍板「切吧，修完了再列出测试列表」；实施与测试清单见 §8，下文取舍保留为当时的决策依据。
> 前置：[2026-09-02-director-console-v2.md](2026-09-02-director-console-v2.md) §0.3 切换门 + §7 分期表（S0–S9 每期的落地与走查记录）。
> 读之前先过 `docs/ARCHITECTURE-NOW.md`：现役入口是 `nodes/director/`（节点 `director`，已在画布上架）；旧 `scene3d` 经单向迁移进入 director，AI 工具通过 director 的常驻 Host 出图/出片。

## 1. 你要权衡的那一个东西

**现在切（V2 对等即删 V1）** vs **再养一期（V2 先当「新导演台」并列上架，V1 留一个版本周期）**。

- 切的收益：一套代码、一套 AI 工具协议、一套走查；V1 的 12 个巨壳文件、两份 3D 词表、两份快捷键表都归零；用户不用在两个 3D 入口之间猜。
- 切的代价：老工程里的 `scene3d` 节点要迁移（数据形状不同：V1 是单场景 + take 录制，V2 是多图层 + 片段时间轴）；agent「AI 来导」链路要改产出目标；V1 特有但 V2 没有的能力（见 §3）会随 V1 一起消失。
- 养的代价：两套并行 = 违反 P1；每修一个 3D bug 要修两遍；R14 审计里「同一语义几份定义」立刻翻倍。

我的判断：**切，但分两步同一 PR 内完成**（先迁移再删，不留 fallback）。理由在 §4。

## 2. V2 现在是什么（验收事实，不是承诺）

| 项 | 事实 |
|---|---|
| 功能覆盖 | 参考产品导演台功能清单逐项实现；差异只有 §0.1 覆盖表里事先声明的 Nomi 化改法（如画笔路径按弧长定时长、Esc 归属链、画中画不另起渲染器） |
| 真实任务 | R16 六条旅程 `tests/ux/director-j1…j6-*.walk.mjs`（三人场景 / 走到 B 身边 / 三机位切换 / 跪下起身回头 / 泼溅山谷视差 / 截图录像送画布）全部绿，截图人眼核过 |
| 桌面运行时分支 | 资产落盘 / ffmpeg 帧转视频 / 手机桥 IPC 在 devlab 里按「明说降级」验证；Electron 真机只过了 typecheck，**未做真机走查**（V1 的 `scene3d-*.walk.mjs` 有 18 条真机走查，切换后要有对等的 director 真机走查） |
| 性能 | Intel Iris Xe 核显、1036×449：纯几何 47 fps、3 角色 + 4 万高斯泼溅 33–36 fps（描边只吃 2 fps，泼溅是大头）；RTX 级未实测 |
| 门岗 | typecheck（app + electron）/ eslint / vitest 108 / lint:ci / i18n / filesize / tokens / heavy-path / boundaries / vocabularies / controls / walkthroughs / test-waits 全绿 |
| 对用户隐藏 | registry `quickAdd:false`、不进工具栏；唯一入口 `director-lab.html`（dev） |

## 3. 切换前必须补的（V1 有、V2 没有或没验的）

| # | 缺口 | 为什么必须 | 工作量 |
|---|---|---|---|
| G1 | **`scene3d` 节点数据迁移** `meta.scene3d → meta.directorProject`：角色 / 相机 / 物体 / 灯光 / 全景 / take 录制轨迹 → V2 图层 + 片段 | 老工程打开不能变空白；迁移必须可逆（保留原 meta 一段时间 = 逃生口，违反 P1 → 改为：迁移一次性、迁前自动备份工程文件） | 1 期（含迁移单测 + 用真实老工程走查） |
| G2 | **agent 工具重定向**：`create_staging_reference / create_camera_move` 产出 `director` 节点（链路 `canvasDescriptors → agentToolCatalog → canvasWrite → applyCanvasToolCall`）；AI 搭场景可作为 staging reference 的一个输出模式 | 「AI 来导」是 Nomi 差异化，不能断 | 1 期 |
| G3 | **Electron 真机走查**：产物落盘 / 帧转视频 / 发送到画布连边 / 手机桥（扫码 + 证书 + 陀螺仪，用户资源）| devlab 只能证明降级文案对，证不了真机成功 | 0.5 期 + 你的手机 |
| G4 | **V1 独有能力盘点**：V1 的 `scene3d-ux-shots`、`reference-pack`、`context-loss-recovery` 等走查覆盖的行为在 V2 里要么已有等价物、要么明确放弃并写进 GLOSSARY | 不留「切了才发现少了」 | 0.5 期 |
| G5 | **registry 上架**：`quickAdd:true`、进「场景」分组、节点面板文案 / 图标 / 空态；删 `director-lab.html` 的「对用户隐藏」注释 | 用户真正的入口 | 0.2 期 |

## 4. 建议的切换步骤（同一 PR，按序，任一步红即整体不合）

1. G1 迁移器 + 单测 + 真实老工程对账（迁移前后实体数 / 相机数 / 全景一致）。
2. G2 agent 工具改产出目标；旧工具名保留、行为改（不加新工具）。
3. G5 上架；同 commit 删 `nodes/scene3d/**`、V1 词表登记、V1 走查（18 条 `scene3d-*.walk.mjs`）→ 对应写 director 真机走查（G3）。
4. 门岗：`check:vocabularies` / `check:filesize` 基线随删除下降；`check:boundaries` 不新增越界；R14 七维横扫「同一语义几份定义」归一。
5. 切换后一周内不接新功能，只修真机走查冒出的问题。

## 5. 不切的话（备选，不推荐）

V2 以「新导演台」并列上架、V1 保留一个版本周期：需要在 `ARCHITECTURE-NOW.md` 明写「两套 3D 导演台并存到 X 日期」，并把 R14 审计里的重复定义标成已知债务。代价见 §1。

## 6. 决定

- [x] **切**（2026-09-03 用户拍板「切吧，修完了再列出测试列表」）
- [ ] 养一期（§5）

## 7. 实施方案（拍板后补，R4）

侦察结论（2026-09-03）：V1 = `nodes/scene3d/` 128 文件 / 2.1 万行 + `Scene3DEditor.tsx` + 7 个 devlab 页 + 13 个 `scripts/scene3d-*` 走查 + 18 条 `tests/ux/scene3d-*` 走查 + i18n `scene3d.ts`（842 行）/ `scene3dJourney.ts`。V2 借用 V1 的只有纯函数：假人骨架数学（`normalizeMannequinModel / rememberMannequinRestPose / applyMannequinSkeletonPose / mannequinBoneNameVariants`）、常量（模型 / 动画 URL、姿态预设、editor-only 旗标、`FULLSCREEN_Z_INDEX`）、全景导入常量、两个资产桥（截图落盘 / 帧转视频）、WebGL 上下文恢复、`isArmLocomotionTrackName`。「AI 来导」= `create_staging_reference / create_camera_move` → V1 词表 builder → `scene3d` 节点 + 自动出图标志 → 两个常驻离屏 Host（`StagingCaptureHost / CameraMoveCaptureHost`）→ image 节点 + composition_ref / mp4 喂 video_ref（含重试看门狗）。老工程节点数据在 `meta.scene3dState`（对象 / 相机 / 轨迹 + 绑定 / 姿态轨 / 环境 / 编辑相机）。

**范围（同一工作区、按序做，任一步门岗红就停在那一步修）**

| 片 | 做什么 | 验收 |
|---|---|---|
| C1 入籍 | V2 借用的 V1 纯函数搬进 V2 各自的家（骨架数学 → `scene/character/mannequinSkeleton.ts`、姿态预设 → `model/posePresets.ts`、资产桥 → `bridge/`、上下文恢复 → `scene/`、全景常量 → `panels/`、`FULLSCREEN_Z_INDEX` → `nodes/fullscreenZIndex.ts`（画板也用）），V2 与画板不再 import `scene3d/` | `grep scene3d/ nodes/director` = 0；vitest / typecheck 绿 |
| C2 迁移器 | `director/migration/`：`Scene3DState → DirectorProject`（对象 / 假人 → 角色（姿态弧度 → 度）/ 群众 → 角色组 / 道具 → 图元组 / 模型 / 灯 / 全景与天空 / 画幅；轨迹绑定按 30fps 采样烘成 V2 路标（含 aim 轨迹 / follow 目标 / 变焦 fov）；姿态轨 → 姿态片段骨骼关键帧；locomotion → 循环动作片段）；V2 路标加可选 `fov` 并在求值 / 播放 / 出片里插值（变焦族靠它活）；`canvasSnapshotNormalizer` 加载时 `scene3d` 节点 → `director` 节点（`meta.directorProject` + 原样保留 `stagingAutoCapture / cameraMoveAutoCapture`） | 迁移单测（对象数 / 相机数 / 路标数 / 姿态 / 全景一致）+ 用真实老工程快照对账 |
| C3 AI 来导 | V1 词表 builder（站位 / 运镜 / 道具 / 模板 / 时刻表 / 重试判定 / 附着核）整体搬到 `director/agent/`，输出经迁移器落成 `director` 节点；`DirectorHeadlessCapture`（隐藏 DirectorCanvas + store + V2 FrameRenderer）替代 V1 两个离屏渲染器；两个 Host 改扫 `director` 节点；工具执行器 / 手动运镜控件 / 工具摘要改指向 | `applyCanvasToolCall` 单测改成 `director`；Electron 真机：建带标志的 director 节点 → 出 image 节点 + composition_ref、出 mp4 喂 video_ref |
| C4 上架 | registry `quickAdd:true` + 进「场景」分组；工具栏 / 插件内置类型 / electron nodeKindDomain / 分类 / 编号 / 卡片外壳 / chunk 边界 / onboarding 教练 / i18n 节点文案全部改 `director`，删 `scene3d` 分支 | 工具栏能加导演台节点；节点卡片打开编辑器 |
| C5 删旧 | `rm nodes/scene3d/**`、`Scene3DEditor.tsx(.test)`、7 个 devlab 页、13 个 scripts 走查、18 条 V1 走查；改引用它们的其它测试 / 走查 / `tests/system/capabilities.json`；i18n 删 `scene3d.ts / scene3dJourney.ts` 与 resources 接线；preload / bridge `scene3d.framesToVideo` → `director.framesToVideo`（IPC 通道名不动）；基线：词表（−2 V1 登记）、走查（−4）、语言脆弱匹配（−2）、巨壳白名单（−V1 项） | `grep -ri scene3d src electron tests scripts` 只剩 IPC 通道名与迁移器里的「legacy」类型 |
| C6 文档 | `ARCHITECTURE-NOW`（3D 一节改现状）、`GLOSSARY`（3D 场景 = 导演台 = director 节点）、`ENTRY.md`、director 各 L2 | docs-index / doc-status 绿 |
| C7 真机 | `tests/ux/director-electron.walk.mjs`：真 Electron 里加导演台节点 → 摆场 → 截图落盘 → 录 MP4（ffmpeg）→ 发送到画布连边 → AI 来导两条链路 | 截图人眼核 |
| C8 门岗 + 测试清单 | 全门岗 + 六条 devlab 旅程 + 新单测 + 真机走查，列表交付 | — |

**不动项**：`electron/video/framesToVideo.ts` 与 IPC 通道 `nomi:scene3d:frames-to-video`；画布 React Flow 内核；agent 工具名与参数 schema（`canvasDescriptors` 不改，只换执行器产出）。
**回滚**：全部在工作区未提交；任一片失败可 `git checkout` 该片文件。
**已知损失（明说）**：V1 相机「手持抖动」与「镜头景深偏移」不迁（V2 无对应；迁移时丢弃并在迁移报告里列出）；V1 编辑相机位姿不迁（V2 自由相机归位）；V1 群众按 instanced 渲染，V2 展开成独立角色（>40 人的群众截到 40）。

## 8. 实施状态（2026-09-03，工作区未提交）

| 片 | 状态 | 证据 |
|---|---|---|
| C1 入籍 | **完成** | `grep scene3d/ nodes/director` = 0；骨架数学 / 姿态预设 / 资产桥 / 上下文恢复 / 全景常量 / `FULLSCREEN_Z_INDEX` 各归其位；tsc 双向绿 |
| C2 迁移器 | **完成** | `migration/` 6 文件：`migrateScene3d.test.ts` 11 例（对象 / 灯世界坐标 / 相机角度 / 路标数与 fov 端点 / 动作片段 / 环境 / 报告 / 非法输入）+ `legacySceneBuilders.test.ts`；`canvasSnapshotNormalizer.legacyScene3d.test.ts` 证老节点加载即迁成 `director`（标志保留）；V2 路标 `fov` 在求值 / 播放 / 画中画 / 出片里插值 |
| C3 AI 来导 | **完成** | `agent/` 19 文件：词表 / builder / 时刻表 / 重试 / 附着核 + `createStagingReferenceNode` / `createCameraMoveReferenceNode`（建 `director` 节点 + 标志）+ `DirectorHeadlessCapture`（隐藏画布 + 独立 store + CaptureBinder 同一条管线）+ 两个常驻 Host；节点 meta 键收口到 `model/directorNodeMeta.ts`；`applyCanvasToolCall.test` 35 例改成 `director` 全绿；`agent/` 单测 56 例绿 |
| C4 上架 | **完成** | registry `quickAdd:true`、工具栏第二组 `director`、插件内置类型、electron `nodeKindDomain`、分类 / 编号 / 卡片外壳 / chunk 边界 / i18n 节点文案全部改 `director`；`scene3d` 分支全删 |
| C5 删旧 | **完成** | 删 `nodes/scene3d/**`（128 文件）、`Scene3DEditor.tsx(.test)`、7 devlab 页 + 6 html、17 scripts、20 条 V1 走查 / e2e、i18n `scene3d.ts / scene3dJourney.ts`、preload / bridge `scene3d` 块、onboarding 3D 教练标记；基线：词表 −2、走查 −4（并 `--update-baseline` 拧紧）、语言脆弱匹配 −2、巨壳 `BaseGenerationNode` 713→705；`grep -ri scene3d src electron tests scripts` 只剩 IPC 通道名、迁移器的 legacy 类型与注释 |
| C6 文档 | **完成** | `ARCHITECTURE-NOW`（导演台一行）、`GLOSSARY`（3D 场景 = 导演台）、`ENTRY.md`、director 根 / model / migration / agent L2 |
| C7 真机 | **完成** | `tests/ux/director-electron.walk.mjs` 全绿（四条链路：截图落盘 + 发送到画布连边 / 运镜 mp4 喂 video_ref / 站位出图连两条边 / 无 console error）；截图与产物人眼核过；挖出 5 个真机问题全部修掉（见 §8.1） |
| C8 门岗 + 测试清单 | **完成** | §8.1 |
| （用户反馈）姿态 / 骨骼与参考产品对不上、内置动作片段没有 | **修复** | 根因：我们的动作库是 x-bot.glb 自带 3 个循环 + 13 个手写静态姿态，参考产品是 T-Pose + 9 个 Mixamo FBX 动画。现在改为：9 组 Mixamo FBX 入库 `src/assets/director/pose`，`model/actionLibrary` 逐条对应，同一份清单既是姿态页预设（posePreset：无片段时按它采样，循环动画一直动）也是动作片段可选项；套骨走 `scene/character/poseSnapshot`（相对源 bind 的增量乘到角色 bind 上，骨盆跨坐标系换算——x-bot.glb 骨盆父系与 FBX 差 −90°，照抄会躺倒）；动作库弹窗用实时 3D 预览；旧 glb 循环 clip、手写预设 UI、retarget 代码删除（手写预设只剩迁移用）。devlab 量到：单膝跪地骨骼高 0.60 / 坐地上 0.45 / 普通坐姿 0.71 / 站立 0.95（T-Pose 0.97），J4 跪起回头旅程重跑绿 |
| （C7 挖出）Windows 打不开任何项目 | **根因修复** | 真机走查第一步就卡在项目库：新建 / 打开项目在主进程炸成 `project_agent_unavailable`。根因 = 「开目录 fd 只为 fsync」这段逻辑在 8 个模块各抄一份、Windows 处理各不相同，两份（`projectAgentMigration` / `projectAgentRepository`）没兜 `fsyncSync` 的 EPERM。收口到 `electron/durability.fsyncDirectoryIfDurable`（唯一实现 + 平台不支持码只判一次），8 份副本全删；类级回归测试钉住「只有 durability.ts 能把只读目录 openSync 和 fsync 配对」；合同 `docs/fixes/2026-09-03-windows-directory-fsync-barrier.root-cause.json`；受影响主进程单测里 fsync 一族失败全部消失（剩下的是本机 symlink 权限 / 超时） |

**门岗（C5 后）**：typecheck（app + electron）/ vitest 受影响 23 文件 255 例 / lint:ci 64 warning（≤98）/ check:i18n / filesize / tokens / heavy-path / boundaries / controls / test-waits / walkthroughs / docs-index 全绿；**check:vocabularies 红**仍是 origin/main #395 删掉的 AssistantTimeline StepTone 历史债（本工作区落后 origin/main 526 commit，基线跟着旧 main），不是本分支改动。

### 8.1 测试清单（C8 交付，2026-09-03）

| # | 层 | 命令 | 覆盖 | 结果 |
|---|---|---|---|---|
| T1 | 单测 · 迁移器 | `npx vitest run src/workbench/generationCanvas/nodes/director/migration` | 老工程 → director 工程逐项对账 11 例 + V1 造物工具 | 绿 |
| T2 | 单测 · 画布加载迁移 | `npx vitest run src/workbench/generationCanvas/store/canvasSnapshotNormalizer.legacyScene3d.test.ts` | 磁盘里的 `scene3d` 节点加载即迁成 `director`（标志保留） | 绿 |
| T3 | 单测 · AI 来导 | `npx vitest run src/workbench/generationCanvas/nodes/director/agent` | 词表 / builder / 时刻表 / 重试 / 喂入纯核 56 例 | 绿 |
| T4 | 单测 · 工具执行器 | `npx vitest run src/workbench/generationCanvas/agent/applyCanvasToolCall.test.ts` | create_staging_reference / create_camera_move 建 `director` 节点 + 标志、词表外降级 35 例 | 绿 |
| T5 | 单测 · 画布壳 Host 门 | `npx vitest run src/workbench/generationCanvas/components/directorCaptureHostActivation.test.ts` | 只有带标志的 director 节点才懒挂两个 Host | 绿 |
| T6 | 单测 · 受切换影响的画布 / 项目层 | `npx vitest run src/workbench/generationCanvas/model src/workbench/generationCanvas/store src/workbench/generationCanvas/components src/workbench/project src/workbench/generationCanvas/agent src/i18n` | 注册表 / 工具栏分组 / 分类 / 编号 / schema / i18n 键对齐 | 绿（23 文件 255 例） |
| T7 | 单测 · 导演台本体 | `npx vitest run src/workbench/generationCanvas/nodes/director electron/director` | model / store / 手机桥 108 例 | 绿 |
| T8 | 单测 · 主进程目录屏障 | `npx vitest run electron/durability.test.ts` | 共享目录 fsync：durable 真 fsync / 平台不支持码放过 / ephemeral 不开 fd / 全仓唯一实现 | 绿（8 例） |
| T9 | 单测 · CSP / 主进程受影响 | `npx vitest run electron/contentSecurityPolicy electron/projectAgentHost electron/productionRun electron/workspace/workspaceManifestLock.test.ts electron/capabilityCore/projectLeaseStore.test.ts` | fsync 一族失败全部消失；剩余红 = 本机 symlink 权限 / 1000 命令超时（环境，非本分支） | fsync 类绿 |
| T10 | 全量单测 | `pnpm run test` | 9836 通过 / 25 失败全部在 electron/* 的 symlink 权限、tsx 子进程、超时（Windows 本机环境） | 与主干同口径 |
| T11 | R16 旅程 · devlab | `NOMI_DIRECTOR_LAB_URL=http://127.0.0.1:5175/director-lab.html node tests/ux/director-j1…j7-*.walk.mjs` | J7 骨骼 IK / FK（把手 11 只 / 拖手 / 拖肘向 / 骨盆钉脚 / 3D 骨骼球 / W·E）/ J1 三人场景 / J2 走到 B / J3 三机位 / J4 跪起回头 / J5 泼溅山谷 / J6 出片（弹层改传送门后全部重跑） | 六条全绿 |
| T12 | 真机 · Electron | `pnpm run build && node tests/ux/director-electron.walk.mjs` | 新建项目 → 工具栏加导演台节点 → 进全屏 → 放角色 + 机位 → Ctrl+Shift+P 截图落盘 → 产出弹层「发送到画布」→ 退出 → 磁盘上 image 节点 + reference 边；视频镜头「运镜」芯片 → 应用 → 离屏采 72 帧 → ffmpeg mp4 → 喂进 video_ref（`referenceVideoUrls` + `@Video1` 指令）；E2E 桥塞入带 stagingAutoCapture 的节点 → 离屏出图 → image 节点 + reference / composition_ref 两条边；无 console error；截图人眼核对 10 张 + 三个产物文件（PNG / mp4 三帧 / 站位 PNG） | 全绿 |
| T13 | 门岗 | typecheck（app + electron）/ lint:ci（64 ≤ 98）/ check:i18n / filesize / tokens / heavy-path / boundaries / controls / walkthroughs / test-waits / docs-index / ipc-sender-binding / root-cause-contracts | — | 全绿；`check:vocabularies` 红 = origin/main #395 的 StepTone 历史债（工作区落后 526 commit，整合主干即消失） |

**真机走查挖出并修掉的（都在同一工作区）**：
1. Windows 上新建 / 打开任何项目炸 `project_agent_unavailable` → 目录 fsync 屏障收口到 `electron/durability.fsyncDirectoryIfDurable`（8 份副本删除，合同 `docs/fixes/2026-09-03-windows-directory-fsync-barrier.root-cause.json`）。
2. 时间轴头部「产出」弹层被视口底栏盖住、矮窗口点不到「发送到画布」 → `panels/Popover.tsx` 改 BodyPortal + fixed 定位 + 放不下翻面 / 夹回窗口（层级走 `NOMI_OVERLAY_Z_INDEX.popover`）。
3. Spark 内联 WASM 被 CSP `connect-src` 拦（console error，泼溅在 Electron 起不来）→ `electron/contentSecurityPolicy.ts` 放行 `data:`。
4. 选中实体时截图烧进平移 gizmo → `scene/TransformGizmo.tsx` 给 TransformControls 打 editor-only 旗标；E2E 桥加 `editorOnlyPaths()` 供走查验证。
5. 手播种 project.json 的老走查法在新架构下打不开项目（没有 project agent host）→ 真机走查改走 `evals/lib/isoApp` 的「新建空白项目」真路径。
