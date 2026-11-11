# 换模型参数：写入时合法（第 0 步设计卡与 C1 参数尺子）

改动名：换模型参数写入边界。实现线：I-model-params-step0。类别：新界面（后续就地说明是新元素）。
本提交只定设计与量具，不改产品代码、不修入口、不迁移存量、不改界面；第 1–4 步另交。

## ★0 先查别人

以下按协调研究报告 `R-model-switch-params.md`「先查别人」迁入，属研究线已读结论，本线未重做外部调研；未实查部分不作为确定结论。

- [后端输入验证源码](https://github.com/comfyanonymous/ComfyUI/blob/master/execution.py) · `validate_inputs` 拒绝范围外与枚举外的输入 · 确认发送口只判不改，修正在写入边界完成。
- [旧前端源码](https://github.com/comfyanonymous/ComfyUI/blob/master/web/scripts/widgets.js) · `refreshComboInNodes` 把不在新列表的值换首项而不说明（研究线记录，新前端未验证） · 改变我们的说明合同：静默回默认是反例。
- [模型切换状态源码](https://github.com/invoke-ai/InvokeAI/tree/main/invokeai/frontend/web/src/features/parameters) · 研究线核到不兼容项停用/清空并汇总警告，尺寸保留比例意图重算 · 确认兼容值保留、发生调整就地解释；不引入每模型历史缓存。
- [验证库的默认值与修改行为](https://ajv.js.org/guide/modifying-data.html) · 默认值只补缺失，删除/转换是可配置行为 · 确认领域政策集中在一个函数，不能让每个调用者自行组合。
- 出口：不涉及：第 0 步不新增、扩大或挪动挡人的产品保护；后续发送保险拦截须指向行内调整/拆镜，允许取消和重试，不自动发送。

## ★1 用户怎么用、指标与量具

当创作者在图片/视频之间切换，或给一镜选择新模型时，我想看到的秒数本来就合法，以便不等发送后才失败。
1. 打开已有项目，只读检查这一镜/节点与当前目录。
2. 看行上的不合法标记；不自动写盘。
3. 选择模型、类型、模式或变体；写入当场规整。
4. 手改时长只给合法值；起草先取合法秒数后分配。
5. 真调整时参数条旁一行写旧值→新值与原因；超上限可一键拆两镜。
6. 确认所见值后发送；相同函数复查发现差异即记录 bug 并拦下。

主指标：写完即合法 → 存值通过当前目录约束 → 入口中全部样本合法的比例，目标 100%；量具 `tests/model-params/contracts.test.mjs` 的 `legal` 列。
质量指标：调整可理解 → 每个实际改动都有旧/新值和非空解释 → `explanation` 列通过比例，目标 100%。
护栏指标：打开不写 → 发现旧值不合法但文件/对象不变 → `open` 列通过比例，目标 100%。
样本来自当前内置图片/视频目录，模型两两、同模型模式两两、变体两两、图片↔视频；每个控件上下限/所有选项，以及意图时长 3/5/8/12/20。
基线由第 0 步尺子实际运行后报告；`it.fails` 是有执行的已知缺口，不是通过率变绿。缺目录范围的样本单列「未验证：缺量具」，不混进绿格。

真实任务（后续执行，本步不触用户资料）：①用户图片镜 3 秒换最短 4 秒的视频模型；②已有 12 秒视频切到上限 10 秒模式；③20 秒脚本起草到最多 10 秒模型，调整并拆两镜。
新手：只认当前秒数和解释；老手：批量/Agent 入口必须等价。Brief：在参数的家里一次看懂值为什么变。每步记录预期→实际、中英截图和存值，不能用测试夹具代替真实模型任务。
不做：每模型记历史、聊天编辑器、弹窗、发送时悄悄修正、产品修复。已知坑：图片停留时长不是生成参数，跨类型后必须用目标视频目录重新判断。

### ★1b 连带界面

画布/列表同一节点参数区、分镜参数条显示同一调整结果；参考条换模式也是写口；Agent 读工具读同一个只读标记，回执只指向行；发送保险报错指回参数家。zh/en 文案及无调整不显示由后续样张合同确定。

### ★1c 老用户

打开不写，只读标出加一键调整。项目、模型、设置、原有入口保留；旧值不合法不自动覆盖。调整是显式操作，失败保留原数据；不新增存储格式，第 0 步退回无数据影响。后续须用真实旧版本夹具交 upgrade-path，本步未验证。

## ★2 全部家与 owner

概念：`generation.model-switch-params`（本基点尚无该 concept-owner 登记，不冒称已收口）。合法性 owner 是 `electron/shared/videoCapabilities/paramConstraints.ts:isParamValueAllowed`；未来写入政策 owner 是共享 `resolveModelParams`，第 0 步不创建它。
状态仍在主进程/既有项目存储；renderer、Agent、MCP、发送、打开检查共用同一结果，不按参数名猜用户意图。1 个概念；当前合法性一份、修正政策散九种，目标一份；品牌类型只许规整函数造，后续收口。

### door-map 原始输出

以下直接取自 `node scripts/door-map.mjs <符号>`，不是手填。扫描 3130 个生产文件；工具按名字将判定函数调点归作 write，不表示真的写盘。

#### `isParamValueAllowed`

```json
[
  {
    "kind": "read",
    "path": "src/workbench/generationCanvas/agent/plannedNodeMeta.ts",
    "symbol": "isParamValueAllowed"
  },
  {
    "kind": "write",
    "path": "electron/shared/videoCapabilities/planResolver.ts",
    "symbol": "isParamValueAllowed"
  }
]
```

#### `clampToRange`

```json
[
  {
    "kind": "write",
    "path": "electron/shared/videoCapabilities/planResolver.ts",
    "symbol": "clampToRange"
  }
]
```

#### `defaultPatchForControls`

```json
[
  {
    "kind": "write",
    "path": "src/workbench/generationCanvas/nodes/buildNodeModelChangePatch.ts",
    "symbol": "defaultPatchForControls"
  },
  {
    "kind": "write",
    "path": "src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts",
    "symbol": "defaultPatchForControls"
  }
]
```

#### `shotKindPatch`

```json
[
  {
    "kind": "write",
    "path": "src/workbench/generationCanvas/agent/storyboardPlanEdits.ts",
    "symbol": "shotKindPatch"
  }
]
```

#### `planModelSelection`

```json
[
  {
    "kind": "write",
    "path": "src/workbench/creation/storyboard/anchorZone/StoryboardAnchorRow.tsx",
    "symbol": "planModelSelection"
  },
  {
    "kind": "write",
    "path": "src/workbench/creation/storyboard/shotRow/ShotComposerBar.tsx",
    "symbol": "planModelSelection"
  },
  {
    "kind": "write",
    "path": "src/workbench/creation/storyboard/storyboardBulkModelScope.ts",
    "symbol": "planModelSelection"
  },
  {
    "kind": "write",
    "path": "src/workbench/generationCanvas/agent/storyboardPlanEdits.ts",
    "symbol": "planModelSelection"
  }
]
```

### 再追一跳与按形状查到的家

| 家 | 生产入口/读面 | 本步量具或后续去向 |
|---|---|---|
| 画布单选、列表详情、批量、失败换同能力、派生 | `nodes/buildNodeModelChangePatch.ts` | `canvas-model` |
| 画布手动/连线自动/配方/收窄/发送前对账 | `nodes/controls/archetypeMeta.ts:applyArchetypeModeSwitch` | `canvas-mode` |
| 画布变体 | 同文件 `applyArchetypeVariantSwitch` | `canvas-variant` |
| 新节点默认、供应商断开 | `nodes/useNodeModelAutoSelect.ts` | 第 1/3 步；默认与断开行为不同 |
| 老项目变体归一 | `normalizeArchetypeVariantMeta` | 第 3 步只读漂移检查 |
| 目录/声明卡更新、模型下线 | 当前无参数漂移标记 | `open` 列；第 3/4 步 |
| 分镜单镜/参考卡/整片/框选模型 | `planModelSelection`，四个文件五处调点 | `storyboard-model`；锚也要同函数 |
| 类型与首帧开关 | `shotKindPatch` / `applyShotKindToAll`；现有整片类型选择器调用 applyShotKindToAll | `storyboard-kind` / `first-frame` |
| 分镜模式 | `shotRow/ShotComposerBar.tsx:onModeChange` | `storyboard-mode` |
| **参考条独立换模式** | `shotRow/StoryboardShotRow.tsx:onSwitchMode` 只写 modeId | 研究报告未分列；`storyboard-reference-mode`（真实行回调） |
| 手改时长、批量时长 | `ShotComposerBar.tsx:onChange` → `updateShotAt`；`applyDurationToAll` | `storyboard-duration`；批量第 2 步 |
| 分镜显示/落画布 | `exec/storyboardProjection.ts:projectShotNode` | 第 1/3 步；duration 覆盖默认 |
| Agent 建节点/落画布 | `agent/plannedNodeMeta.ts:buildPlannedNodeMeta` | `agent-node` |
| Agent 改镜 | `agent/storyboardPatchShots.ts:previewStoryboardPatchShots` | `agent-patch` |
| Agent/MCP 起草 | `capabilityCore/mcpGenerationTools.ts` → `executionContract.ts:admitPlanCandidate` | `agent-draft` |
| **确定性拟镜 4/15** | `electron/capabilityCore/mcpStoryboardPlanner.ts:planStoryboardFromScript` | 研究报告原 17 组外补查；`deterministic-planner` |
| try_model | `capabilityCore/modelOnboarding/tryModel.ts` | 供应商直测按原设计，不是保存创作参数 |
| 发送边界 | `buildCatalogTaskRequest` / `planResolver` | 第 3 步同函数复查，拦下并报 bug |

首帧结论：它是 `video`/`image-video` 类型开关，不是独立首帧布尔写口。`shotKindPatch` 会清模型、模式、参数；不会当场选择收首帧的模式。落画布后连线才可能由画布的模式提升选到对应档。`plannedFirstFrameSlot` 只读当前模式，不负责换模式。第 0 步把开/关分别枚举，缺省模型不能假判合法。

## ★3 一致、三条路与类根因

依据：2026-09-07 `docs/plan/2026-09-07-generation-strategy-resolver.md` 的就地钳并说明；2026-10-22 打开不写；协调研究报告末尾用户拍板（2026-11-09）为本次真源。早期低于下限拦并建议合并不作为现行拍板。
症状：图片 3 秒换视频模型仍存 3；直接原因：类型补丁保留时长、参数只在后面检查；类根因：参数合法性有 owner，写入政策和通知无统一边界，入口/目录变更不变量没有门岗。
三路：各面补（保留九种政策，拒）；共享函数写时规整（选，复用合法性/范围/比例 owner，并删旧）；删规整只发送拦（违背原来就写对，拒）。
复用 `isParamValueAllowed`、`numericRangeOf`、`clampToRange`、`aspectRatioValue` 与现有 Vitest `it.fails`，不造第二套规整器，不新增依赖。库的验证不是领域修正政策；依赖生命周期 not-applicable（本步无运行时改动）。第 1 步前另立 schema-v3 根因合同，七个热点须独立方向检查，本步不改。

## ★4 全状态与界面

空：无镜头无标记；加载：保留旧值等目录；成功：合法且无改动不显示说明；失败：保留值并指向参数；部分成功：只列有问题的行；取消中：取消调整不写新值；过期：目录更新只读重算；能力不可用：显示模型不可用并可点击换模型。
界面：**待协调出 Claude Design 样张，用户拍板后才实现**。依据设计系统 §1.0 / §1.5，一功能一个家，就地说明不进聊天、不弹窗；说明/调整/拆镜为 L2 情境，参数不退进高级菜单。本步无图、无组件、无新文案。
拍板图清单：尚未产生；后续协调出板，本步不适用 board-parity 元素认领。

## 5 中途表

本步不启动生成；后续调整是同步显式编辑，任何中断都不触发提交供应商。

| 状态 | 停 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 空/加载 | 无写·无生成·无回执 | 旧盘保留·无生成·行上待查 | 等目录·无生成·行上待查 | 只读重查·无生成·行标记 | 同读·无生成·无重复回执 |
| 合法/已调整 | 保留已提交编辑·无生成·行说明 | 按既有保存·无生成·行说明 | 本地编辑可用·无生成·行说明 | 只读重查·无生成·行说明 | 同值幂等·无生成·同一行说明 |
| 失败/部分/过期 | 保留原值·无生成·行标记 | 保留旧盘·无生成·行标记 | 保留标记·无生成·行标记 | 只读重查·无生成·行标记 | 不重复覆盖·无生成·行标记 |
| 取消中/不可用 | 原值·无生成·行指路 | 原盘·无生成·重开可换模型 | 原值·无生成·换可用模型 | 只读重查·无生成·行指路 | 不发任务·无生成·原回执 |

## 6 外部数据与失败

模型目录/声明卡来自现有 archetype/控件合同，保留 vendor 特化与变体特化；缺 min/max 或档位不能自定范围，标「未验证：缺量具」。未知键、数值字符串、NaN/Infinity、缺模型、下线模型在后续共享边界给字段级错误，不甩锅 key。第 0 步只读仓库目录，不读真实 Key、不接供应商、不访问用户资料。

## ★7 性能

新增操作：后续打开项目/目录更新只读扫描、显式一键调整、换模型/模式/类型/变体。最坏规模 1000 镜头 + 200 节点，每项最多 32 标量参数；一次构建目录索引再线性扫，不每镜两两比较。
预算：打开扫描增量 p95 ≤100ms，100 节点打开到能操作 ≤1s；单次编辑反馈 ≤100ms（p95 ≤150ms），交互长任务 >50ms 为 0。超过 50ms 分批只读计算，不在打开时写盘。
量具：拟登记到现有 `tests/ux/project-open-stages.e2e.mjs`/`tests/perf/scenarios/` 场景 `model-params-open-readonly`；当前未验证：产品扫描函数未建，第 0 步不制造假的性能基线。第 3 步实现时登记并跑 `pnpm run perf:scenarios`，超预算不合并。

## 8 真实条件

Mac/本地目录与纯函数：第 0 步执行。Windows、英文界面、最小窗口、真规模、干净安装、真付费、键盘全程：unverified（本步无产品实现、不起 App、不花钱）。真实任务闭环与截图由后续实现/独立验收执行。

## ★9 验收清单、反例与回滚

### 第 0 步（本次执行）

- C1 参数列登记 `tests/model-params/README.md`，列为 legal / explanation / open；当前登记 13 个入口，每个入口恰三格。每格聚合全部样本，有一例失败即红；`it.fails` 固定已知红格，修好即去 `.fails`，不得动态吞异常/自动把新红当已知。固定已知红格集合是静态登记，夹具异常由普通测试独立硬拦。
- 模型两两/模式两两/变体两两、图片↔视频、上下限/全选项与 3/5/8/12/20 可点数；调用真实产品函数/真实 UI 回调，不在测试中代写产品逻辑。
- 绿格反例 M0：临时改坏 `plannedNodeMeta` 的合法参数校验，使非法数值被写入 → `agent-node/legal` 必红；逐字节还原 → 绿。临时变异不提交、七热点最终零差异。
- 红格反例 M1：`storyboard-model/legal` 去 `.fails` → 必红，恢复 `.fails` → 绿；证明量的是现存缺陷。
- 模块加载/夹具/目录缺失先用普通测试硬断言，不许 `it.fails` 因 import/throw 误过；打开列经过 normalizeRecord 后分别读取真画布参数条、分镜策略/行警示、Agent generation read 回执；同时断言对象与隔离文件不变并统计 operation store patch，不拿测试自算标记充当产品标记。
- 跑尺子、typecheck、排锁快检、正文预检六项，结果写实现报告；同一检查连红三次停。

### 第 1 步验收合同（未实施，未来执行）

共享 `resolveModelParams` 以今天政策做逐字节请求体零差异重构；模型/模式/变体/起草/投影/planResolver 全部走共享函数，同提交删旧循环、别名与无人读取 changeset。反例类别：某调用者保留旧逻辑、字符串枚举和数值范围差异；复用尺子全目录样本，任一请求字节漂移即拒。七热点无方向检查不得提交。

### 第 2 步验收合同（未实施，未来执行）

合法值留、不合法回默认；时长最近合法档/范围，超上限钳并说明且一键拆镜。手改/Agent patch/起草/拟镜/首帧/参考条所有入口写完即合法；不按模型存历史。反例类别：3秒→最短4、12→上限10、20→拆镜、image↔video、数值/枚举/变体、缺省模型；legal 红格逐格去 `.fails`。说明必须逐字段旧→新正确且非空；无变化不得伪造说明。新 UI 先对已拍板 Claude Design 清单，中英真截图。

### 第 3 步验收合同（未实施，未来执行）

目录更新/打开只读标不合法、Agent 读同标记，一键调整才写；发送同函数复查，触发记 bug 并拦、不钳后照发。反例类别：旧项目非法值、目录收窄、断供应商、旧变体、发送与付费卡差异；open 红格去 `.fails`，fs 写入 spy 与文件哈希零差异。跑真实旧数据升级与性能场景。

### 第 4 步验收合同（未实施，未来执行）

品牌参数类型只可由规整函数造；concept-owner 收口，禁 owner 外派生合法性/默认值；目录新旧比对与 E3 入口等价。反例类别：绕过品牌构造/在调用者重写校验/目录收窄/新入口不登记；结构性门岗故意违规须红、还原绿；本步尺子 100% 真绿且无 `.fails`，不能仍有未验证范围却报全覆盖。

独立验收：待协调安排其它线核本卡与变异日志；实现线不自签验收。硬门⑩/⑪/⑫与真实资源证据在对应实现步骤交，本步不报已解决。
回滚：仅回退本线两个本地提交，无存量数据写入；后续删旧与新函数同提交回退，不能只回退一个调用者。
