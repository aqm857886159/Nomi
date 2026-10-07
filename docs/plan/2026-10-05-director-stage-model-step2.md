# 导演编译器第二步：舞台模型（设计卡）

> 来源：`docs/plan/2026-10-05-director-compiler-root-cause.md` 选项 ②（第一步 = PR #990，`docs/plan/2026-10-05-director-stage-truth-step1.md`）。
> 线：L-stage2。类别：其他（新增结构层；不碰花钱 / 长跑 / 可打断 / 新界面）。分支 `feat/director-stage-model-step2`（从 #990 切出）。
> 边界：**不改计划契约**——`DirectorPlan` schema 的形状、`stage_shot` / `director.write`、实体稳定 id（`actor:` / `setPiece:` / `shot:` / 模板 `s1-*`）都不变。舞台模型只活在编译这一侧。

改动名：计划与工程之间插一层「舞台模型」——东西有种类和真尺寸、模板标命名站位、关系词解析到站位、携带物挂父子、机位保证看得见主体、GLB 用实量包围盒

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当用户让导演台把一句话编成预演（或 Agent 经 `director.write` 交计划），我想看到「侍卫站在院门里侧、和女子面对面」「信在女子手里跟着走」「远景机位在院子里、看得见人」「咖啡桌不挡主角」，以便不用逐个挪人挪机位。步骤：Agent 交计划 → 编译器先建舞台（种类 / 尺寸 / 站位）→ 关系解析成站位与朝向 → 走位到站位 → 解机位并验视线 → 出工程。**不做**：改计划 schema 与提示词、让规划器直接引用站位 id（那是选项 ③）、物理库 / 导航网格、3c 覆盖层本身。**已知坑**：机位求解仍是自由的（只对已知主体验视线）；角色宽深仍是假设值（unverified）；GLB 在没加载过的工程里只能按 1 米方盒兜底并标出。真实任务：庭院对峙（oracle + 3 份真实规划器回归计划）、香水瓶转台、警匪街道、t3-cafe 两人一桌。 | `directorSpatialInvariants.characterization.test.ts` 违例账；`pnpm run eval:director -- --scheme s1-oracle-plan`；设计实验室截图 |
| ★2 谁说了算 | 「这东西是什么、多大、站哪、朝哪」唯一 owner = 新模块 `model/compiler/directorStage.ts`（舞台模型）；「关系词的空间含义」和「名词 → 舞台种类」唯一 owner = `electron/shared/director/vocab.ts`（与计划词表同一 owner，schema 的 relation 枚举改为从这里取，成员不变）；「包围盒 / 视线射线 / 模型实量」仍归 `model/directorSpace.ts`（第一步的空间事实 owner，GLB 实量写在对象上、由它读）；「父子姿态合成」沿用编辑器 `sceneObjectGraph` / `evaluatedSceneObject`，不另写。不新增 concept-owners 概念。 | `node scripts/door-map.mjs clearOfSolids`（今 1 扇：编译器两处调用，将并进舞台模块）、`scaledBounds`（4 扇，GLB 实量后改走 `objectBounds`） |
| ★3 一致与复用 | 视线判断用 three 的 `Ray.intersectBox` + `Box3`（已是依赖）；**不接 three-mesh-bvh**：舞台上全是图元 / 角色 / 已量的模型包围盒，BVH 加速的是三角网格逐面射线，二十几个盒子用不上，接了反而多一份「网格 vs 包围盒」两套真值——等真 GLB 网格级遮挡（不是盒级）成为需求再接，退出条件写在下面。携带物用编辑器现成的 `parentId`（渲染、测量、物理判据都已按父链合成），不写跟随轨迹。站位结构借 FilmAgent 的离散站位思路（只借结构，站位自己标）。删：编译器里的 `positionActors` 偏移表、`HELD_CENTER_HEIGHT`、按名字的 `byPlanId` 模糊匹配、`clearOfSolids` 的两处调用点（并成舞台模块一处）。自写登记：站位表与关系解析（领域：分镜关系词 → 站位 / 朝向，是取景知识）。 | `git grep`；`check:self-written` |
| ★4 全状态 | 不适用：无新界面。可见变化是 3D 预演画面本身，用设计实验室里庭院 / cafe / 警匪三题前后对比截图核对。编译问题清单多出 `occluded`（换遍候选机位仍挡）与 `nominal-size`（尺寸是兜底值）两类条目，`director.write` 的 issues 是开放字符串，3b 结果分级「成功带问题」已有位置。 | 截图路径见交货报告 |
| ★9 验收与回滚 | 验收：特征测试违例账 occluded 12→0、carriedDrift 1→0，floating / interpenetrating / offFloor / cameraInside 不升；离线 oracle 分（不调模型）每步前后对比，掉分逐项说明是不是「物理对了、旧靶子不认」；三题截图亲眼看过。回滚：五个提交各自 `git revert`（舞台模型 + 站位 → 关系解析 → 携带物 → 视线 → GLB），每步编译器都能独立工作。 | 提交 SHA 见交货报告 |

## 方向检查（对着类根因报告）

- 根因是「编译器逐对猜空间语义」。本卡的每条规则都按**一类东西**写（按舞台角色：地面 / 结构 / 家具 / 演员 / 手持物），不按「谁和谁」写；新组合（人-门、人-桌、车-机位）不需要新特例。
- 物理判据 `directorSpatialAudit.ts` 不改（只许照物理写，不许为分数回调）；视线求解在编译器侧用 three 射线，判据侧保留自己的 slab 实现，两边不共用同一段判定代码。
- 分数不是方向盘：oracle 分若因「物理对了」而下降，照实记录，不回滚。

## 舞台模型的数据形状（编译侧，不出编译器）

```ts
type StageRole = 'surface' | 'structure' | 'furniture' | 'performer' | 'handheld'
type StageThing = {
  objectId: string          // 稳定 id：s1-* / setPiece:* / actor:* / dressing:*
  planId?: string           // 计划里的名字（actor / setPiece / 模板件 id）
  kind: string              // 舞台种类：ground / wall / gate / tree / pedestal / table / seat / counter / person / vehicle / product / prop …
  role: StageRole           // 由种类决定，关系词的空间含义按 role 解释
  object: DirectorObject    // 渲染图元 + scale；包围盒一律经 directorSpace 量
  sizeSource: 'render' | 'measured' | 'nominal'   // nominal = 兜底尺寸，编译问题清单里标出
  facing: number            // 朝向（yaw 度，0 = +Z）
}
type StageMark = { id: string; at: { x: number; z: number }; facing: number; use: 'stand' | 'set' }
type Stage = { things: Map<string, StageThing>; marks: Map<string, StageMark[]>; interior: { min: {x,z}; max: {x,z} } }
```

- **种类与尺寸**：模板件在模板里直接声明种类；计划里的布景件 / 演员按 `vocab.ts` 的名词表归类（「院门」「gate」→ gate，「cafe_table」「餐桌」→ table，「信」「letter」→ handheld …），尺寸取舞台模型的名义尺寸表；认不出的仍是 1.4 米方盒，`sizeSource: 'nominal'` 并报问题。
- **同名合并**：计划里的布景件与模板里**同种类**的件指的是同一个东西（「院门 at s1-courtyard-gate」= 模板院门），不再造第二个盒子——这条消掉「人站在规划器放的院门原点上」。

## 站位怎么标

每个模板手标命名站位（id = `<模板件 id>#<名>`）与可站区域 `interior`（墙里侧、地面以内）：

| 模板 | 站位（at / facing / use） |
|---|---|
| courtyard | `ground#center`（0,0）→ +Z stand；`ground#set`（-3,-4.5）set；`gate#front`（0,-6.9）面向院内 stand；`wall-north#front`、`wall-east#front`、`tree#front` |
| product_stage | `ground#center`（0,1.5）；`pedestal` 用顶面承托；`backdrop#front` |
| room | `floor#center`（0,0.5）；`floor#set`（0,-2.2）set（家具靠里放，不挡镜头一侧）；`back#front`、`left#front` |
| street | `ground#center`（0,0）；`ground#set`（-4,-6）；两侧楼 `#front` |

没有手标站位的件（规划器布景件、dressing）由同一条规则派生 `#front`：在它朝场景内侧的那一面外，留演员半身 + 30cm。

## 关系词表（`electron/shared/director/vocab.ts`，与计划词表同一 owner）

| 关系 | 空间含义（按承托 / 参照物的 role 解释） |
|---|---|
| `at` | 参照是地面 → 该地面的站位（演员用 stand，家具 / 结构用 set）；参照是结构 / 家具 → 它的 `#front` 站位，朝向随站位；参照是人 → 同 `near` |
| `near` | 参照旁 1.2m（人际距离），按出场序左右交替；朝向同参照 |
| `in_front_of` / `behind` / `left_of` / `right_of` | 参照**自己朝向**坐标系里的前 / 后 / 左 / 右，距离 = 两者半深 + 间隙（人 1.2m、车 2m）；`in_front_of` 一个人 = 面对他 |
| `on` | 参照是人 → 手持：人和东西挂到同一个携带分组 `carry:<人的对象 id>` 下（编辑器父子关系；编辑器不变量是「父级只能是分组」，见实施记录），东西在手的位置；否则底落在参照顶面 |
| `between` / `along` | 单参照下 `between` 按 `near`；`along` 沿参照长边排开 |
| 手持物 `at` / `near` 一个人 | 就是那人拿着（同 `on`） |

「对峙」不是新关系词：两人分别站到站位后，`turn_to` / `in_front_of` 让朝向互指；走位 `walk_to X` 走到 X 的站位，站位已被人占着就停在那人面前人际距离处并面对他（「走到院门」= 走到守门人跟前）。走动时朝行进方向，停下保持朝向（不再每段归零）。

## 机位视线

- 镜头的 `angle`（front / side / back …）相对**主体朝向**解释，不再相对世界 +Z。
- 每个镜头解完整条路径后，在窗口内 9 个时刻验「机位 → 主体中心」与「机位 → 瞄准点」两条视线：被任何实心件（非地面、非主体自己和它拿着的东西）挡住，就对整条路径做同一个变换去找候选——绕主体转 ±20°…±180°、抬高 0.5…3m、拉近到 0.75 / 0.5——按偏离代价取第一条全程看得见、机位不在任何实心件里、不越轴的；全都不行就照原样出并报 `occluded` 问题（不藏）。墙外的机位自然被墙挡住，不需要另写「不许出墙」。

## 与 3c 覆盖层的关系

3c 覆盖层按稳定 id 记逐属性差量（`docs/plan/2026-10-04-director-3dbox-phase3.md` §手改覆盖层）。有了站位以后，**手改人物位置应当记成「换到站位 X」**（站位 id 稳定、跟模板走），而不是一串坐标：重编译换了模板尺寸或改了走位，人仍站在作者意图的那个点。手改到不是站位的地方，才退回按坐标记。本步只交站位 id（`StageMark.id`）与解析结果，不实现覆盖层。

## GLB 包围盒

- `ModelEntity` 加载完用 `Box3.setFromObject` 量一次局部包围盒（未乘 scale），写到对象的 `measuredBounds`（工程里新增的可选字段，旧工程没有它照常打开）；`directorSpace.objectBounds(object)` 是唯一读口：有实量用实量，没有就按 1 米方盒兜底并返回 `source: 'nominal'`，编译器把它报成问题。
- three-mesh-bvh 的退出条件：出现「盒级视线说挡住、真网格其实看得见」的真实截图（如拱门、树冠），再升为直接依赖做网格级射线。

## 步骤（每步一个提交，都更新违例账与 oracle 分）

0. 本设计卡 + 目标特征测试（occluded 0、carriedDrift 0 先写成「预期失败」）。
1. 舞台模型 + 站位标注（种类、名义尺寸、同名合并、模板站位与可站区域）。
2. 关系解析（关系词表进 vocab、站位与朝向、走位到站位）。
3. 携带物父子（`parentId`）。
4. 机位视线（相对主体朝向 + 视线候选）。
5. GLB 包围盒（`measuredBounds` + `objectBounds`）。

## 实施记录（2026-10-05）

- 携带物：编辑器的父子不变量是「父级只能是分组」（`normalizeDirectorProject` 会剥掉非分组父级，3b 的写入路径经 `loadProject` 走它），所以没有直接把东西挂到人身上，而是人和东西一起挂到携带分组下，分组承载人的落点、朝向与走位轨迹。代价：精修里这个人的路径住在携带分组上（点人会选到分组）；3c 覆盖层按 `actor:<id>` 记的位置手改要转写到 `carry:actor:<id>`。另一条路是放宽编辑器不变量允许角色当父级——属于编辑器规则变更，未做，留给协调会话定。
- 家具：上面放着演员（柜台上的产品）的家具算表演区，站演员站位；空家具靠里放（布景站位）。
- 视线：越轴保护会把机位镜像到轴另一侧（可能镜像到墙外），所以「会被镜像」也算不可用，一起找候选。静止镜头绕镜头开始时的主体变换（仍静止），跟拍绕每一刻的主体变换（仍跟拍）。
- 结果：34 道计划 6 条判据全 0；oracle 0.960 → 0.964（P 层 0.982 → 1.000）。
