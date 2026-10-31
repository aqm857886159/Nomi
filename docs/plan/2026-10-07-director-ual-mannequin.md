# 2026-10-07 导演台人偶换成 UAL（3D-BOX 方案第 10 节「3R」施工计划）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：施工计划 v1（只做核查与设计，不含实现）。基准 `origin/main @ d6e0c8140`。
> 用户 10-07 拍板：**直接把导演台替换掉，不一点一点切换**（所以没有开关、没有并行版、无 fallback；旧工程靠读时迁移）。
> 来源：`docs/plan/2026-10-04-director-3dbox-phase3.md` §10 的 3R + §1 第 7 条（默认角色 = Quaternius UAL CC0 + 原生 45 动作）；资产事实 `docs/plan/2026-10-04-director-3dbox-assets-a.md`、`docs/fixes/2026-10-04-director-assets-native-ual.root-cause.json`。
> 路径简写：`D/` = `src/workbench/generationCanvas/nodes/director/`。

## 0. 一句话

编辑器里加人、群众、动作库、姿势、IK、视线、出片截帧，全部从「x-bot.glb + 9 个 Mixamo FBX」换成「一个 `ual-mannequin.glb`（网格 + 骨架 + 45 个原生动作同文件）」；旧工程打开时在内存里迁成 UAL，不动用户文件，用户第一次真改动才落盘；同一个 PR 删掉 x-bot.glb 和 9 个 FBX（顺手清掉两处「许可证待定」的灰区资产）。

## 1. 先看这四个实测事实（决定了施工怎么切）

全部用仓库里的 glb 在 node 里真加载量出来的（three GLTFLoader），不是读文档推的。

1. **骨名被 three 改了名。** glb 里骨叫 `DEF-upper_arm.L`，three 加载时把 `. : / [ ]` 去掉，运行时变成 `DEF-upper_armL`（原名留在 `userData.name`）。`ual-rig.json` / manifest 里写的是带点的原名，**直接拿去 `findBoneByName` 一根都找不到**。动画轨道名同样是去点后的。运行时骨名表必须写去点后的名字（`DEF-spine001`、`DEF-handL`…）。
2. **骨的局部坐标轴和 Mixamo 完全不同。** 22 根语义骨里，大臂 / 前臂 / 手差 90°，大腿 / 小腿 / 脚 / 肩差 180°，髋 / 脊 / 颈 / 头差 5–18°。所以存档里的 `boneRotations`（欧拉度数，骨局部轴）、关节滑条、左右镜像（x,−y,−z）、视线分配（直接 `bone.rotation.y/x +=`，`characterRig.ts:96-97`）、静态姿势预设（`posePresets.ts` / `assetCatalog/staticPoses.ts`）都是按 Mixamo 轴写的，直接用在 UAL 上会拧出怪姿势。
3. **按骨头量身高会量错。** UAL 没有头顶末端骨：骨的竖向范围只有 0.015–1.568 m，网格实高 1.829 m。`CharacterEntity.tsx:101-108` 现在用「骨范围」缩放到 1.75 m，套在 UAL 上人会被放大到 2.06 m。UAL 要直接用 manifest 里的 `heightM = 1.828717`（`UAL_MANNEQUIN_HEIGHT_M`），原点本来就是脚底（`ground-min-z`）。
4. **UAL 朝向和 Mixamo 一致。** Y 向上、脸朝 +Z、T 字站姿（手臂沿 ±X）、髋高 0.916 m（x-bot 1.04）、肩高 1.44 m（和 x-bot 同）。所以现有的「按骨基名套世界增量」重定向（`poseSnapshot.ts`）不用改算法，UAL 动作套到 UAL 身上等于原样，套到用户上传的 Mixamo 角色上也成立。

## 2. 现在一个人从加载到出片经过哪些代码（文件:行号）与要改什么

| 阶段 | 现在（x-bot） | 换成 UAL 要改什么 |
|---|---|---|
| 资产地址 | `D/scene/character/mannequinAssets.ts:11` 单一入口 `MANNEQUIN_MODEL_URL`（x-bot.glb）；`:16-27` 9 个 FBX 的 URL；`:30-33` `poseClipAssetFor` | 改成 `new URL('…/director/ual/ual-mannequin.glb')` 一条；9 个 FBX 的表和 `poseClipAssetFor` 删（动作都在同一 glb）。`bundleAssetUrlBoundary.test.ts:22-23` 的登记理由改文案 |
| 内置模型判定 | `D/scene/character/characterAsset.ts:14-16` `builtin:*` → 内置模型；`:19` `hasMixamoRig` | `builtin:*` 仍指向默认人偶（不需要改存档里的 `modelPath`）；`hasMixamoRig` 保留（用户上传 Mixamo 角色仍要升格，见 §8 风险 4） |
| 加载 + 归一 + 定高 | `D/scene/entities/CharacterEntity.tsx:78-110`（克隆骨架、`rememberMannequinRestPose`、`normalizeMannequinModel` 归一成单位高、骨范围量身高、`fit`）；`:165` `rig: object.rig ?? 'mixamo'`；`:178` 预载 | 默认 rig 改 `'ual'`；`fit` 对内置 UAL 用 `UAL_MANNEQUIN_HEIGHT_M`（事实 3），仍缩放到 `CHARACTER_HEIGHT = 1.75`（`model/directorSpace.ts:15`，**不改**，见 §5）；`:178` 的 `useGLTF.preload` 指向新地址。材质仍是单一中性白模材质，`clay`/颜色逻辑不动 |
| 拾取代理 | `CharacterEntity.tsx:58-71` 胶囊 0.36 半径、1.9 m 高 | UAL 1.75 m、臂展 1.94 m，胶囊够用，不改 |
| 骨名映射 | `D/model/rigs.ts:17-69`（`MIXAMO`/`UE4` 两张表）、`:71` `RIG_BONE_MAPS`；`D/model/directorTypes.ts:28` `DirectorRig = 'mixamo'｜'ue4'`；`D/model/directorProject.ts:179` 读档只认两种 rig | 加 `'ual'`：22 个语义骨 → 去点后的 UAL 名（`spine→DEF-spine001`、`spine1→DEF-spine002`、`spine2→DEF-spine003`、`leftToeBase→DEF-toeL`…）；`:179` 放行 `'ual'`；`assetCatalog/types.ts:29` 已有 `'ual'` |
| 骨基名（重定向键） | `D/scene/character/poseSnapshot.ts:20-29` `baseBoneName`（去 `mixamorig` 前缀、去 `_N`）；`:25` | 加一张 UAL 去前缀别名表：`def-upper_arml → leftarm`、`def-handl → lefthand`、`def-hips → hips`、手指 `def-f_index01l → lefthandindex1`…（共 53 根，用 Mixamo 基名当「规范名」）。这样 `poseSnapshot`、`CaptureBinder.tsx:134-135` 的肩手读回（读 `leftarm/lefthand`）、`HIPS_BASE_NAME`（`:18`）全部不用改，上传的 Mixamo 角色也还能吃 UAL 动作 |
| 骨轴差异 | `D/scene/character/characterRig.ts:73-81` `applyBoneRotationOffsets`（欧拉 → 右乘）、`:227` `offsetFromBase`（IK/Gizmo 写回）、`:90-100` `applyLookAtOffsets` | 引入**规范轴修正表**（§4）：每根语义骨一个四元数 `rel`；写入时 `q_ual = rel⁻¹·q_规范·rel`，读回时反过来。`SkeletonTab.tsx:51-56` 的滑条、`storeCharacterActions.ts:113,154` 的镜像 / 复位、`StoryAI` 静态姿势、AI 来导词表**全部保持 Mixamo 规范轴不变** |
| 每帧管线 | `D/scene/character/useCharacterRig.ts:158` 预载；`:139-141` 按基名建索引；`:164` `applySnapshot`；`:175` 动作层；`:322` `useFrame`（复位 → 动作层 → 偏移 → IK → 视线 → 骨盆） | 结构不变；换动作源（见下行）；首帧贴地 `:350-354` `lowestSkinnedY` 对 UAL 同样适用 |
| 动作库 | `D/model/actionLibrary.ts:22-33` 9 个条目 + tpose；`:36-82` 别名；`:84-98` `LEGACY_POSE_TO_ACTION`；`D/scene/character/poseClipLibrary.ts:33-98` 每个 FBX 一个 mixer；`:56-` 载入；`:101-119` 采样 | 条目改为 UAL 的 id（见 §3）；`poseClipLibrary` 改成**只加载一个 glb**，从 `gltf.animations` 取 clip，一个源骨架 + 一个 mixer 采样所有动作；循环 / 非循环用 `UAL_ACTIONS.loop`（现在是「时长 ≤0.05s 才算静态，其余一律取模循环」，`:21-22,107-112`，UAL 里 0.16s 的瞄准、0.3s 的受击会被无限循环抖动，非循环要夹在末帧）；`Sword_Idle` 在元数据里 `loop:false` 但是待机，实现时按 tags 含 `idle` 当循环 |
| 动作选择器 / 预览 | `D/panels/dialogs/ActionSelectModal.tsx:15-34`、`D/panels/inspector/PoseTab.tsx:13,51,58`、`ActionClipInspector.tsx:14,59`、`D/panels/dialogs/ActionPreview.tsx:18,28-47`（用 `MANNEQUIN_MODEL_URL`，高度写死 1.8，`:25`）；名称走 `src/i18n/locales/director.ts:855-863`(zh) / `:1800-1808`(en) 的 `director.action.library.<id>` | 都按 `ACTION_LIBRARY` 渲染，只需换数据；名称 key 换成 UAL 的 43 个 id（`UAL_ACTIONS` 已带 `nameZh/nameEn`，i18n 两个文件各写 43 条，旧 9 条删）；`ActionPreview` 的 `CHARACTER_HEIGHT` 同样改用常量 |
| 加人 | `D/scene/creation/useCharacterPlacement.ts:26-29` 男 / 女都 `builtin:x-bot + mixamo`（同一个模型，只颜色不同） | 改 `builtin:ual + 'ual'`；男女仍只差颜色（UAL 只有一个中性人偶；「女人 / 男人」是否要两个模型是另一个决定，本计划不扩） |
| 群众 | `D/model/storeEntityActions.ts:282-318` `batchCreateCrowd`：整份对象深拷贝 N 份，每份各自一个 `CharacterEntity` + `useCharacterRig` + `useFrame` | 逻辑不动（自动继承 UAL）；性能见 §6 |
| 站位 / 体形 | `D/model/rigs.ts:111-120` `BODY_TYPE_PRESETS` 缩放 | 不动 |
| 名牌 / 景别 | `D/scene/character/characterLabel.ts`（头顶锚点，用 `CHARACTER_HEIGHT` 传入）、`CaptureBinder.tsx:75`、`LabelProjector.tsx:33`；`directorSpace.ts:63-64` 脚印 0.6×0.4、高 1.75 | 不动（人偶仍缩放到 1.75 m）；`CaptureBinder.tsx:132-139` 的 `characterPoses` 靠基名别名表即可 |
| 骨骼可视化 | `D/scene/character/SkeletonVisual.tsx:28` `SKIP_BONE = /Thumb\|Index\|Middle\|Ring\|Pinky\|_End$\|Toe_End/i` | UAL 手指名 `f_index/f_middle/f_ring/f_pinky/thumb` 恰好被忽略大小写的这条正则命中，不用改；加一条单测钉住 |
| 出片 / 预演截帧 | `D/agent/DirectorHeadlessCapture.tsx:30,93`、`DirectorHeadlessCaptureUtils.ts:3,6` 等所有动作片段加载完（`poseClipStatus`）；`D/scene/capture/CaptureBinder.tsx` | 只依赖 `poseClipStatus`，换成单文件后状态更简单（一次加载，不再 9 个各等各的）；`E2EBridge.tsx:11,32-33,159-160` 签名不变 |
| 编译器 | `D/model/compiler/directorPlanCompiler.ts:16,203-247`：`'running'` / `'standard_walk'` / `'standing_idle'` 写死；`:236` 空档补 `standing_idle`；`D/model/compiler/directorStage.ts:80` 造人不写 rig / modelPath（走默认） | 3 个写死 id 换成 UAL id（走 `resolveActionAlias`，不再各写一遍）；造人不用动，默认 rig 变 `'ual'` 自然生效 |
| 规划器提示词 | `D/model/plan/directorPlanner.ts:28` 一整句里列了 10 个动作 id | 从动作库**生成**这句话，不再手抄；提示词只列 12–16 个常用 id（待机 / 说话待机 / 走 / 跑 / 冲刺 / 坐 / 坐着说话 / 蹲 / 跪修 / 受击 / 倒地 / 跳 / 交互），43 个全列会涨提示词也让小模型乱选 |
| 评测尺子 | `evals/director/scorer.ts:111-125`（`MOVEMENT_ACTION_BY_VERB`、`STATIC_ACTION_IDS`）、`evals/director/adapters.ts:128,291-297` | `STATIC_ACTION_IDS` 改为从动作库的 `loop && !locomotion` 推出，不再手写集合；adapters 的默认 id 换成 UAL；`directorPlanCompiler.regressions.json` 重录 |

## 3. 旧 9 个动作 → UAL 对应表

UAL 实际是 **45 个原生动作**，其中 `Roll_RM`、`Sword_Attack_RM` 是带根运动的重复版，我们的重定向只套髋，根运动播不出来，**动作库只收 43 个，`_RM` 两个不收**（`ual-rig.json`/目录里仍保留不动）。下表同时是读档迁移表和 AI / 自然语言别名表（一份数据，放 `ACTION_ALIASES`，不另建第二张）。

| 旧动作 id（中文名） | → UAL 动作 | 对应质量 | 备注 |
|---|---|---|---|
| `tpose`（T 型 / 绑定姿态） | `tpose`（保留，不对应文件） | 直接 | UAL 绑定姿态本身就是 T 字，核查过 |
| `standing_idle`（站立） | `Idle_Loop` | 直接 | 说话场景另有 `Idle_Talking_Loop`（新增能力） |
| `standard_walk`（行走） | `Walk_Loop` | 直接 | 另有 `Walk_Formal_Loop` |
| `running`（跑） | `Jog_Fwd_Loop` | 近似 | Mixamo 的 Running 是慢跑速度；追逐 / `chase` 用 `Sprint_Loop` |
| `male_sitting_pose_1`（普通坐姿） | `Sitting_Idle_Loop` | 直接 | 另有 `Sitting_Talking_Loop`、`Sitting_Enter/Exit`（新增）；坐姿需要椅子，和旧版一样 |
| `male_sitting_pose`（坐地上） | `Crouch_Idle_Loop`（蹲） | **无对应** | UAL 没有「席地而坐」。蹲是最近的低姿，但不是坐。需要用户知道：此动作丢了 |
| `kneeling`（单膝跪） | `Fixing_Kneeling` | **近似较远** | 跪姿存在，但带「修东西」手部动作，5 秒非循环 |
| `kneeling_idle`（双膝跪） | `Fixing_Kneeling` | **近似较远** | 同上；UAL 没有静止的跪姿待机 |
| `kneeling_down`（站立到单膝跪） | `Fixing_Kneeling` | **无对应（只有结果姿态）** | 没有「下跪」过渡 |
| `standing_up`（单膝跪起身） | `Idle_Loop` | **无对应** | 没有「跪起身」；`Sitting_Exit` 是坐着起身，不是一回事 |

**净变化**：9 个 → 43 个；「走 / 跑 / 站 / 坐」保住，「跪、坐地、跪起身」三类**变弱或丢失**（这是换 UAL 的真实代价，上述 4 条无对应 / 近似较远的，实现时迁移后在编辑器里不静默：迁移器记录「动作已换成相近动作」数量，进入编辑器时用现有 toast 说一句；用户要补这三类，后续用关节姿势 / 静态姿势组合做，不在本 PR）。
新增能力（原来没有）：说话待机、坐着说话、蹲行 / 蹲待机、冲刺、跳（起 / 空 / 落）、翻滚、打斗（拳 / 剑 / 手枪 / 施法共 16 个）、倒地、受击、交互、拾取、推、游泳、驾驶、跳舞。

姿势预设怎么映射：`posePreset` 与动作片段 `actionPose` 是同一份动作库 id（`actionLibrary.ts:3-9` 的头注释），所以姿势预设 = 上表同一条映射；`posePresets.ts` 的 V1 欧拉预设（`MANNEQUIN_POSE_PRESETS`）只被迁移器和 AI 来导词表用（`migrateScene3d.ts:24`、`agent/stagingBuilder.ts:9`、`agent/cameraMoveBuilder.ts:10`、`agent/stagingVocab.ts:9`），键是 `mixamorig*` 规范名，经 §4 的规范轴修正后在 UAL 上同样成立，不动。

## 4. 骨轴「规范修正表」（本计划最核心的一处设计）

**问题**：存档、滑条、镜像、视线、静态姿势都是 Mixamo 骨局部轴。
**做法**：把 Mixamo 骨轴当「规范轴」，UAL 每根语义骨存一个常量四元数 `rel = 规范骨绑定世界朝向⁻¹ · UAL 骨绑定世界朝向`（实测见 §1 事实 2）。
- 写入（偏移 → 骨）：`q_ual = rel⁻¹ · q_规范 · rel`（`characterRig.ts:73-81`、`:90-100`、姿态关键帧 `applyPoseSample`）。
- 读回（骨 → 偏移）：`q_规范 = rel · q_ual · rel⁻¹`（`characterRig.ts:227` `offsetFromBase`，IK 拖拽 / 旋转 Gizmo 写回都走它）。
- IK 两骨解析 / CCD / 胸腔朝向（`characterRig.ts` 的 `solveTwoBoneIk`、`solveCcd`、`:303` `solveChestToward`）全部在世界坐标里算，不依赖骨局部轴，**不用改**。
- 数据来自 x-bot.glb 和 UAL glb 的绑定姿态，由一个生成脚本（放 `scripts/director-assets/`，和 `check-ual-asset.mjs` 同处）算出来写进 `src/assets/director/ual/ual-frame-correction.json`；**必须在删 x-bot.glb 之前生成并入库**，删了就没法再算。
- 单测：对 22 根骨，随机规范偏移 → 写到 UAL → 世界朝向变化量必须等于「同一偏移写在 x-bot 上」的世界朝向变化量（x-bot 数据取自入库的 json 里的规范绑定朝向，测试里不再依赖 x-bot.glb）。
- 为什么不重写 FK 滑条 / 镜像 / 预设：它们加起来有几十处，且改了就和所有旧存档、AI 词表对不上；一张 22 行的表一次解决，旧工程迁移时 `boneRotations` 的**数值原样保留，只换键名**。

## 5. 尺寸与空间（不会被连带改坏的部分）

| 项 | 现状 | 换后 | 影响 |
|---|---|---|---|
| 身高 | `CHARACTER_HEIGHT = 1.75`（`directorSpace.ts:15`），`CharacterEntity` 把任何模型缩到这个高 | 不改。UAL 网格 1.829 m 缩到 1.75（×0.957） | 编译器脚印 / 景别计算 / 名牌 / 机位预设全部按 1.75，**不动** |
| 髋高比例 | x-bot 髋 / 身高 ≈ 0.57 | UAL ≈ 0.50（腿更长一些的比例） | 视觉上人比例略不同；机位「视线高度」按头 / 眼，不按髋，影响很小；坐姿髋落点高度会略变，迁移后有坐姿镜头的旧工程要看一眼 |
| 臂展 | T 字 ≈ 1.8 m | 1.94 m（`UAL_MANNEQUIN` 包围盒宽） | 只影响 T 字 / 张臂姿势，脚印（0.6×0.4）按站姿算，不变 |
| 舞台模型典型尺寸 | `compiler/directorStage.ts:80` 人固定 `scale 1` | 不变 | 站位、间距、`clearOfSolids` 全部不变 |
| 三角面 | x-bot 约 5 万（`CharacterEntity.tsx:58` 注释） | UAL 13,743 | **更轻**：100 人 = 137 万三角，x-bot 要 500 万 |

## 6. 性能：10×10 群众（100 个 UAL 人偶）

实测（node 里真加载、`AnimationMixer` + 现有 `poseSnapshot` 套骨、**纯 CPU、不含 GPU 渲染与蒙皮上传**，Windows 本机，量 60 帧取平均）：

| 人数 | 现有管线（每人各采样一次快照） | 同帧同动作共享快照 | 原生 mixer（UAL 动作直驱同骨架） |
|---|---|---|---|
| 1 | 0.34 ms/帧 | 0.28 | 0.13 |
| 10 | 2.2 | 1.05 | 0.94 |
| 100 | **39 ms/帧** | **25 ms/帧** | **7.9 ms/帧** |

- 结论：**按现有管线，100 人光 CPU 就吃掉 39 ms（只够 25 帧），还没算渲染 / 阴影 / 视口其它开销 → 必须治。**
- 没量到的：真实 GPU 帧率、阴影开销。本机不起可见窗口，这一项记 `unverified`，实现线要在真机量（设计卡 ★9 里列出）。
- 治法（按顺序，每一步后重量）：
  1. **同帧同动作共享快照**：`poseClipLibrary.samplePoseClip` 对 `(动作 id, 量化后的时间)` 做帧内缓存；群众几乎全是同一动作同一时刻，100 人只采样 1 次（−35%，还不够）。
  2. **群众走快路径**：没有手调偏移 / 骨盆偏移 / IK / 视线、也没被选中的角色，每帧只做「复位 → 套快照 → 更新矩阵」，跳过 `basePoseRef` 拷贝和偏移分支；离相机很远 / 在画外的不更新（`frustumCulled=false` 是现在为了蒙皮包围盒故意关的，`CharacterEntity.tsx:90`，需改成按角色整体包围盒做可见性判断）。
  3. 仍不到预算（目标：100 人编辑器视口 ≥30 fps 的逐帧 JS ≤ 12 ms）：对未被编辑的角色改用**原生 mixer 直驱**（上表第三列，8 ms）。这是第二条动画路径，只在 UAL 内置人偶上用，上传的 Mixamo 角色不走；属于「同一概念两条路」，实现线要先把 1、2 做完量出数字、**确需**才加，并在 PR 里写明理由。
  4. 阴影：群众不投影（`castShadow=false`）作为最后手段，需用户知道。
- 量法要进测试：写一个 vitest 基准，不进 CI 门（只记录），输出 N=1/10/100 的 ms；数字写进 PR。

## 7. 旧场景迁移（只读迁移）

**入口只有一个**：`D/model/directorProject.ts:170-215` 的 `normalizeDirectorObject`（所有读档都经 `normalizeDirectorProject`：编辑器 `createDirectorStore`、`agent/applyDirectorWrite.ts:162`、`CameraMoveCaptureHost.tsx:109,252`、`directorPreviewCapture.ts:40,81,87`）。迁移写在这里，一处覆盖编辑器、Agent、预演截帧、出片。

规则（纯函数，幂等，在内存里改；**判据 = 内置人偶**：`type==='character'` 且 `modelPath` 缺省或以 `builtin:` 开头，且 `rig` 缺省或为 `'mixamo'`）：
1. `rig → 'ual'`。`modelPath` 保持原样（`builtin:*` 本来就指默认人偶，不需要改存档里的字符串）。
2. `posePreset`、每个 `actionClips[].actionPose` 按 §3 表映射；`clip.name` 若恰等于旧 id（编译器就是这么写的：`directorPlanCompiler.ts:214`）一并改。未知 id 原样不动（保持现有「找不到条目 → 静止」行为）。
3. `boneRotations` 与每个关键帧的 `boneRotations`：键 `mixamorig*` → 对应 UAL 骨名，**值不变**（§4 保证语义不变）；没有对应骨的键（`HeadTop_End`、手指等）丢弃并计数。`hipsOffset` 是米，不变。
4. 用户上传的 Mixamo 角色（`modelPath` 是上传资产）**完全不碰**，仍 `rig:'mixamo'`。
5. 迁移结果带一个只存内存的「迁移说明」（换成近似动作的次数 / 丢弃的骨数），编辑器打开时用现有 toast 说一次；不写进工程。

「不改用户文件直到保存」怎么保证：
- `normalizeDirectorProject` 是纯读。编辑器写回有两处：`DirectorEditor.tsx:327-335`（store 变化后 2 秒落盘，只在改动后触发）和 `:365`（**关闭时无条件写回**）。后者要加「store 从没改过就不写」的判断，否则「只是打开看了一眼」也会把迁移结果落盘。
- 迁移完的工程再打开，因为 `rig==='ual'` 不再触发迁移，幂等。
- 回退风险：旧版本应用打开已迁移工程会不认 `rig:'ual'`（`:179` 当前会丢掉未知 rig）→ 回到 mixamo 默认但骨名是 UAL → 人偶不动。可以接受（单向升级），但要在发版说明里写；是否把 `DIRECTOR_PROJECT_VERSION`（`directorTypes.ts:13`，现为 2）升到 3 由实现线定，我倾向**升**，让旧版明确读不了，而不是静默坏。
- 测试：把一份真实的旧版工程（含走路 + 坐姿 + 手调骨骼 + 单膝跪）做成 fixture，断言迁移后动作 id / 骨键 / 值，二次迁移不变，且 `exportProject()` 在没改动时与输入逐字段一致（只读）。

## 8. 包体与删除（P1：换了新的就删旧的，同一个 PR）

- 删：`src/assets/x-bot.glb`（1.84 MB）、`src/assets/director/pose/*.fbx` 共 9 个（约 4.3 MB）。加载 UAL 6.6 MB。**净增约 +0.5 MB**，不用做懒加载（编辑器本来就在导演台 chunk 里按需加载，`useGLTF` 缓存后群众共用一份）。可选后续：用 gltf-transform 去掉用不上的 `_RM` 动作和动画里的 scale 轨道，大概能再减 1–2 MB，不在本 PR。
- 同步删 / 改：`docs/engineering/third-party-assets.json:227`（x-bot 条目）及 9 个 FBX 条目（`pending-review` 灰区，删掉后灰区资产少两类）；`third-party-assets.md`；`D/scene/character/CLAUDE.md`、`D/model/CLAUDE.md` 的成员清单（`mannequinAssets`、`poseClipLibrary`、`actionLibrary`、`characterAsset` 描述）；`bundleAssetUrlBoundary.test.ts:22-23`。
- 顺带发现但**不在本 PR 动**：`src/assets/ue-mannequin-retopology.glb`（750 KB，`src/` 里没有任何引用，且是 Sketchfab 灰区）。另开清理。
- 只有 `hasMixamoRig` / 上传 Mixamo 升格路径（`ModelEntity.tsx:19,53-55`、`AssetsTab.tsx:197`）保留，因为用户自己上传的 Mixamo 角色不能因为换默认人偶就失去动作能力；它们吃 UAL 动作靠 §2 的基名别名表。

## 9. 施工切分（同一个 PR 内，每刀一个提交，每刀能单独验证）

> 顺序有依赖：1 → 2 → 3 → 4 → 5 → 6。第 6 刀删旧资产必须在最后，且前 5 刀每一刀结束时旧资产仍在（便于二分定位）。

| 刀 | 内容 | 主要文件 | 单独怎么验证 |
|---|---|---|---|
| 1 骨架与轴 | `DirectorRig` 加 `'ual'`；`rigs.ts` 加 UAL 骨名表（去点后）；`directorProject.ts:179` 放行；`poseSnapshot.baseBoneName` 加别名表；生成并入库 `ual-frame-correction.json` + 生成脚本；`characterRig.ts` 的 offsets / `offsetFromBase` / `applyLookAtOffsets` 接修正 | `D/model/rigs.ts`、`directorTypes.ts`、`directorProject.ts`、`scene/character/poseSnapshot.ts`、`characterRig.ts`、`scripts/director-assets/` | 单测：① 22 根语义骨在 UAL glb 里都能按去点后的名字找到；② 53 根骨的别名都落在规范名上、无重复；③ §4 的世界朝向等价测试；④ 视线偏移在 UAL 上的世界朝向与 x-bot 一致。纯逻辑，没有渲染变化 |
| 2 动作库 | `ACTION_LIBRARY` 换 43 个 UAL id；`ACTION_ALIASES` 吸收旧 id 与中文别名；`poseClipLibrary` 单 glb 加载 + 循环 / 夹末帧；`mannequinAssets` 指向 UAL；i18n zh / en 43 条；动作选择器 / 姿势页 / 片段检查器 / 预览换数据 | `actionLibrary.ts`、`poseClipLibrary.ts`、`mannequinAssets.ts`、`i18n/locales/director.ts`、`panels/dialogs/ActionSelectModal.tsx`、`ActionPreview.tsx`、`PoseTab.tsx`、`ActionClipInspector.tsx` | 单测：别名表对 §3 每个旧 id 解析到预期 UAL id；非循环动作采样夹末帧；循环动作取模。真渲染：动作弹窗里逐个预览 43 个动作的截图 / 帧序列 |
| 3 人偶上场 | `CharacterEntity` 定高 / 贴地 / 默认 rig；加人默认 `ual`；`CaptureBinder` 读回；`SkeletonVisual` 钉测试 | `scene/entities/CharacterEntity.tsx`、`scene/creation/useCharacterPlacement.ts`、`scene/capture/CaptureBinder.tsx` | 真渲染截图：单人站 / 走 / 坐 / 说话；身高 = 1.75 ±1 cm、脚在地面（量蒙皮最低点）；FK 滑条、IK 把手拖手 / 拖脚、视线看向，在 UAL 上真拖一遍并看截图；中 / 英界面 |
| 4 读档迁移 | `normalizeDirectorObject` 迁移 + 迁移说明 toast + `DirectorEditor.tsx:365` 的「没改过不写回」 | `D/model/directorProject.ts`、`D/DirectorEditor.tsx` | §7 的 fixture 测试（含只读断言）；真打开一份旧工程截图对照迁移前后（人在原位、动作对应、手调姿势没拧） |
| 5 编译器 / 规划器 / 尺子 | 编译器 3 个写死 id；规划器那句话改为生成；`scorer.ts`、`adapters.ts`；`skills/director-3dbox/SKILL.md` 里若有动作词；重录 regressions | `D/model/compiler/directorPlanCompiler.ts`、`D/model/plan/directorPlanner.ts`、`evals/director/scorer.ts`、`adapters.ts`、`directorPlanCompiler.regressions.json` | 编译器单测（含「旧 id 仍能被解析」）；`pnpm run` 评测里的离线尺子重跑对比旧分（不花钱：只跑编译与测量，不调模型）；真实 Agent 在环评测不在本 PR（属 3d） |
| 6 群众性能 + 删旧 | §6 的 1、2（必做）与 3、4（有数字再定）；删 x-bot / 9 FBX / 登记 / 头注释 | `poseClipLibrary.ts`、`useCharacterRig.ts`、`CharacterEntity.tsx`、`third-party-assets.*`、`CLAUDE.md` 若干 | 基准输出 N=1/10/100；10×10 群众在真视口截图 + 帧时间；`pnpm run gates` 与 `check:*` 全绿（含第三方资产登记、资产 URL 边界）；`rg "x-bot|mixamorig|StandingIdle"` 只剩 Mixamo 上传路径的合法引用 |

**测试表（实现线交付时按此填）**：每刀对应一行「怎么验证」，加上跨刀的三条真实任务：①新建工程加人 → 选动作 → 摆姿势 → 预演截帧 → 出片；②打开 10-06 之前存的真实旧工程（走路 + 坐姿 + 手调）→ 看迁移 → 改一笔 → 保存 → 重开；③10×10 群众拖时间轴播放。每条任务要 zh / en 两轨真截图，实现线自己逐张看过再报；没跑到的写 `unverified`。

## 10. 设计卡（★1 / 2 / 3 / 4 / 9）

```
改动名：导演台人偶换 UAL（3R）        线/负责人：L-ual（计划）→ 另一条线实现        类别：[其他]（数据格式 + 大数据量，无花钱 / 长跑 / 可打断 / 新界面）
```

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我在导演台摆镜头时，我想直接拖出一个人、选「待机 / 走 / 坐 / 说话 / 打斗…」并摆好姿势，以便出预演；打开旧工程时人和动作还在、不用我手动换。不做：男女两个不同人偶；跪 / 坐地补全；新界面。已知坑：跪 / 坐地 / 跪起身三类丢失或变近似（§3）。真实任务：§9 末尾三条 | 人工 + 截图 `docs/evidence/…`（实现线建） |
| ★2 谁说了算 | 角色模型与骨名：`scene/character/mannequinAssets.ts` + `model/rigs.ts`；动作词表：`model/actionLibrary.ts`（唯一一份，规划器提示词、评测尺子、动作选择器都从它推）；骨轴修正：`ual-frame-correction.json`（一份）；旧→新迁移：`normalizeDirectorObject`（唯一读档入口）。触碰 4 个概念，没有新增第二写口 | `node scripts/door-map.mjs ACTION_LIBRARY`、`findActionEntry`、`MANNEQUIN_MODEL_URL` |
| ★3 一致与复用 | 复用：现有 `poseSnapshot` 世界增量重定向、`useCharacterRig` 管线、rig 映射层（`rigs.ts` 本来就支持多 rig）、`UAL_ACTIONS` 元数据、`ual-rig.json`。自写且必须：骨轴修正表（领域约束：存档 / 滑条 / 预设绑定的是 Mixamo 轴）；读档迁移（存档格式）。不引入第二份动作定义、不留 x-bot 旁路 | `pnpm run check:self-written`；`rg "x-bot"` 清零 |
| ★4 全状态 | 加载中：胶囊占位（现有，`CharacterEntity.tsx:41-52`）；动作未载完：保持静止姿态，出片等 `poseClipStatus`（现有）；资产失败：退化胶囊（现有）；迁移有近似 / 丢弃：toast 说明数量；旧版打开新工程：不兼容（§7）；无「花钱 / 取消中 / 过期」状态：不适用，这是纯本地渲染 | 单测 + 人工 |
| ★9 验收与回滚 | 验收（另一条线）：跑 §9 的测试表 + 三条真实任务 + 迁移 fixture + 基准数字；用设计实验室 / 真编辑器真渲染逐张看（光暗不适用，导演台常暗；中英各一轨）。回滚：整个 PR 可 revert（旧资产随 revert 回来）；但**已被新版保存过的工程无法被旧版读**，所以合并前要用户同意「单向」，且不能在合并后单独 revert 而不顾已保存的工程 | 人工 + 报告链接（实现线 PR 正文 `## 独立验收`） |

## 11. 风险清单（按严重度）

1. **骨名被 three 去点，参考文件 `ual-rig.json` / manifest 的名字直接用会全部找不到骨。** 已实测确认（§1 事实 1）。不先处理，加载后人偶是僵的、IK / 视线 / 贴地全失效而且不报错（`findBoneByName` 返回 undefined 是静默的）。第 1 刀的第一个测试就要钉它。
2. **骨轴不同导致旧工程里手调过骨骼的人会拧**，且视线、镜像、静态姿势同理。靠 §4 的修正表解决；这张表错一根，该肢体所有预设 / 旧存档都会错，所以单测要覆盖全部 22 根并拿 x-bot 的世界朝向对账（对账数据必须在删 x-bot 之前入库）。
3. **群众 100 人：现管线 CPU 39 ms/帧，加上渲染必然低于 25 fps。** 只量了 CPU（§6），GPU / 阴影 `unverified`；治法已分层，但第 3 步（原生 mixer）会引入第二条动画路径，需要实现线有数字再决定。
4. **上传的 Mixamo 角色吃 UAL 动作没有现成验证。** 重定向算法对「T 字 + 同朝向」成立，但没有真实上传模型样本；删 x-bot 后连内置的 Mixamo 样本也没了。需要在测试里造一个 Mixamo 命名的合成骨架（或保留一个极小的测试夹具），且在真编辑器里拿一个用户真实的 Mixamo 模型试一次，不能试就记 `unverified`。
5. 跪 / 坐地 / 跪起身没有对应动作（§3），使用这三类的旧工程迁移后动作会变；需要用户知道并认可。
6. 单向升级：已迁移并保存的工程旧版读不了（§7）。
7. 身高量法改动（骨范围 → 常量）会影响任何用 `measureSkeletonExtent` 的地方（`ActionPreview.tsx:36-39` 同款算法，也要改），漏一处会出 2 m 高的预览人。
8. 动作元数据个别项需要人工确认：`Sword_Idle` 标 `loop:false` 却是待机；`Pistol_Aim_*` 只有 0.16 秒（实为单姿势）。实现线按 tags 兜底并在动作弹窗里看一遍 43 个。
9. 群众来源 `batchCreateCrowd` 每人深拷贝整份动作片段 / 轨迹（`storeEntityActions.ts:297-310`），100 人的工程体积和撤销栈（完整工程 50 步）也可能是瓶颈，本计划没有测，记为实现线要量的一项。

## 12. 不在本计划里

不做：新界面 / 设计实验室样张（用户 10-07 取消）、男女两个人偶、补跪与坐地动作、用 UAL 的 StoryAI 静态姿势上架、真实 Agent 在环评测（属 3d）、开关与并行版。
