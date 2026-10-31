# 方向检查：一份没填完的分镜草稿否决整份工程的保存（RW）

> **触发**：`node scripts/fix-churn.mjs` 命中——文件 `projectRepository.ts`（14 天第 6 刀）、`projectOperationFailureText.ts`（第 4 刀）、`projectRecordSchema.ts`（第 3 刀）、`NomiStudioApp.tsx`（第 6 刀）；目录 `src/workbench/project/`（第 9 刀）、`src/workbench/generationCanvas/agent/`（第 10 刀）；概念「项目名（改名只有一个主人，内容保存不写名字）」（第 9 刀）；自写登记 **`ipc-invoke-failure-text`**（under-review，30 天第 2 刀）。文件本身命中，结构性结论交用户拍板。
> **来源**：用户反馈（2026-10-29）。一次会话里，项目保存连续失败 30 次：自动保存 27 次，关窗 3 次。顶部红字一直是「项目保存失败，请检查本地磁盘权限」。关窗被拦，最后只能强制结束。
> **范围**：本页只写复盘，没有改实现代码。代码基线是 main `d13bba332`。文中「实算」指：用仓库里的真函数产出状态，再喂给真正的存盘 schema（`workbenchProjectPayloadSchema`），不手写夹具。用到的真函数有 `addAnchor`、`updateAnchor`、`setPlanDefaultAspect`、`patchStoryboardSubject`。

## 0. 一句话根因

存盘口复用了给规划模型和 Agent 入参用的严格分镜 schema，它要求人物卡名字、整片画幅都非空。编辑器的正常操作却会产出空名字和空画幅。仓库里没有「编辑器能产出的状态一定存得下、读得回」这条契约，存盘门又是全有全无，所以一张还没起名的人物卡就否决了整份工程。失败原因在半路被丢掉了：schema 的字段位置没了，主进程的错误码也没了。界面上只剩一句错的「请检查本地磁盘权限」。

## 1. 归类表

### 1a. 这一类的历次出现

| 时间 / 提交 | 现象 | 直接原因 | 类 |
|---|---|---|---|
| 06-22 `bdd439560` | 缺两个可默认字段的项目，整份打不开 | payload schema 把 `workbenchDocument` / `timeline` 当成硬必填 | 存盘/读盘契约比实际内容严（读侧）。当时只放宽了这两个字段 |
| 09-21 `6dab1bd23` | 方案里多一个历史键，整份项目打不开 | 分镜 schema 加过 `.strict()` | 同上（读侧）。当时只去掉了 strict |
| 09-24 `a4db9d337` | 锁被别处占着，界面却说「检查磁盘权限」 | 渲染层认不出主进程的错误类 | 失败没有机器可读的原因。当时加了「锁忙」特例 |
| **10-29（本次）** | 自动保存和关窗全部失败，只能强制结束 | 1. `addAnchor` 默认 `name: ''`（`storyboardPlanEdits.ts:105`）。<br>2. 存盘 schema 对每份方案都套 `storyboardPlanSchema`（`projectRecordSchema.ts:72`），其中 `name` 要求非空（`storyboardPlanSchema.ts:20`）。<br>3. 拒绝后 `normalizePayload` 只抛一句不带位置的「记录损坏」（`projectNormalize.ts:79-81`）。<br>4. 出口把它一律说成「检查磁盘权限」（`projectOperationFailureText.ts:62-69`） | 存盘契约等于模型面契约（写侧），加上失败没有机器可读的原因 |
| 本复盘新发现 | 整片画幅先选具体比例、再选「默认」 | 1. 「默认」选项的值是 `''`，代码注释写明「'' = 还没定，按模型默认走」（`StoryboardBulkBar.tsx:95-98`）。<br>2. `setPlanDefaultAspect` 把它原样写进 `aspectRatio`（`storyboardShotScope.ts:254`）。<br>3. schema 要求非空（`storyboardPlanSchema.ts:94`）。<br>这条入口在 v0.24.0 里已经存在 | 同本次（写侧） |
| 本复盘新发现 | Agent 去改一张用户新建、还没起名的人物卡 | `patchStoryboardSubject` 把卡的现状和改动合并后，用严格 schema 解析（`storyboardSubjectAdapter.ts:87`），抛 `too_small` | 同一份严格 schema 套在了用户草稿上（Agent 面） |

### 1b. fix-churn 计入的那 8 刀：没有一刀属于这一类

这里指 `src/workbench/project/` 近 14 天的 8 个 fix 提交。

| 提交 | 修了什么 | 碰到的文件 | 和本次的关系 |
|---|---|---|---|
| `cbc8173a0` 10-29 | 导演台、全景的页内状态跟随项目释放 | `releaseWorkbenchProjectSession.ts`，加一行 import | 只撞目录 |
| `ce1b14c81` 10-24 | 删除后按主进程的真实回答提示 | `projectRepository.ts`，删除返回 `deleted` | 只撞文件，属于删除类 |
| `87baf3eed` 10-23 | 删项目改成进系统回收站，失败分四类说清 | `projectOperationFailureText.ts` 加回收站特例；`projectRepository.ts` | 删除类。但文案出口因此多了一类特例，和本次「文案」那一半同形 |
| `52f6d199a` 10-22 | 项目列表不再藏空白草稿 | `projectRecordSchema.ts`、`projectRepository.ts`，**只改了注释** | 只撞文件 |
| `9a1237e76` 10-22 | 删除意图契约挪到别的目录 | 两个文件只改 import 路径 | 只撞文件（机械改动） |
| `0bf38c3f1` 10-22 | 删除严格照用户确认的意图执行 | `projectOperationFailureText.ts` 加「状态变了」特例；`projectRepository.ts` | 删除类，文案出口又多一类特例 |
| `c219118e8` 10-22 | 列表只读；一项读不出只坏这一张卡 | `projectRecordSchema.ts`，加 `unreadableReason` 摘要字段和注释 | 不同类。但「一项坏只坏这一张卡」正是 §6a 选项 C 的原则，列表侧已经这么做了 |
| `42736b307` 10-17 | 生成产物按期望类型核对字节 | `projectMediaMigration.ts`，传 `expectedKind` | 只撞目录 |

其余命中也都不是这一类：
- `NomiStudioApp.tsx` 的 5 刀（`ce1b14c81`、`87baf3eed`、`0e7032d39`、`0bf38c3f1`、`c219118e8`）都是项目库的删除和列表。红字插槽是共用管道。
- `generationCanvas/agent/` 的 9 刀没有一刀碰 `storyboardPlanEdits.ts`，只撞目录。内容是视频比例默认值、候选投影、shotKind 默认值、画布读取分页、站位参考。
- 概念「项目名」被计入，是因为 `projectRepository.ts#saveProjectRecord` 在它的写口表里。它管的是**项目**名，本次是**人物卡**名，只是用词相同。
- 自写登记 `ipc-invoke-failure-text` 的上一刀是 `c2709c75d`（10-24，主进程错误类名经 invoke 进日志）。本次的 schema 拒绝发生在发 IPC 之前，不经过它。但修「按原因说话」时，主进程那一半会经过它，见 §5、§6b。

文案这一半已经越过 P1 的特例线：`projectOperationFailureText` 现在有三类特例（锁忙、删除状态变了、回收站失败）。再为「保存内容不合格」加一个，就是第 4 个特例分支。

## 2. 为什么这一类会一直出现

### 三层

**症状**
- 红字常驻，自动保存和关窗全部失败。
- 关不掉窗口，只能强制结束。
- 强制结束会丢掉未保存的编辑。现场诊断已复现：清空人物卡名字后强制结束，重开时这次编辑没了。

**直接原因**：见 §1a 本次那一行。

**类根因（契约层）**
- 同一份 `storyboardPlanSchema` 被当成五张脸用：
  - 存盘和读盘：`projectRecordSchema.ts:72`
  - 旧数据迁移：`projectNormalize.ts:117,123`
  - 规划模型输出：`runStoryboardPlanner.ts:41,56`
  - Agent 入参和落画布：`applyCanvasToolCall.ts:315`、`capabilityApplyHandler.ts:561`、`agentStoryboardDesign.ts:39,89`
  - Agent 改单镜：`storyboardSubjectAdapter.ts:52,87`
- 它的头注释（`storyboardPlanSchema.ts:10-15`）已经承认「存盘这一面要宽」，但只落实到「不认识的键剥掉」，值约束（非空）仍然按模型面写。
- 两张脸的需要相反：
  - 模型面该严：模型必须给人物卡起名。
  - 存盘面该宽：用户可以先加卡、后起名。批量条甚至把 `''` 明确设计成「还没定」。
- 没有一条契约规定「存盘面要容得下编辑器能产出的一切状态」，存盘门又是全有全无。所以每给模型面加一条约束，或每加一个能清空字段的编辑入口，都可能让整份工程存不下或打不开。06-22 和 09-21 出在读侧，10-29 出在写侧，每次都只放宽了出事的那一个字段。

**类根因（失败表达层）**
- 失败没有机器可读的原因。
- schema 的 `issues` 本来带字段路径，在 `projectNormalize.ts:80-81` 被丢掉了。
- 主进程错误经 `invoke` 回来只剩一句话，这是 Electron 的官方行为。
- 出口只能逐个认类名、加特例，认不出的一律说成「检查磁盘权限」。

### 为什么之前没拦住

| 层 | 漏在哪 |
|---|---|
| 类型 | `z.infer` 把 `min(1)` 推成普通 `string`。`storyboardPlanSchema.ts:102-116` 的漂移守卫只核对键，不核对值约束。所以编辑器往 `name` 写 `''`，编译器认为它和 schema 一致 |
| 测试 | 1. 编辑函数的测试（`storyboardPlanEdits.test.ts`）不经过存盘口。<br>2. 存盘测试（`projectNormalize.test.ts`）用的是手写、带名字的夹具。<br>3. `storyboardPlanSingleOwner.loopback.test.ts:241-248` 已经用真函数造出两张空名卡并写进 store，但只断言方案唯一、镜号、锚不占号，从没问过「存得下吗」。<br>4. `projectErrorSurface.test.ts:62-80` 和 `useProjectWindowLifecycle.test.ts:51-58` 把「锁忙以外的保存失败一律说检查磁盘权限」钉成了期望值 |
| 门岗 | 没有「编辑器产出必须存得下」的门。fix-churn 只在事后数刀数 |
| 现场 | 1. 问题会自愈：用户一填上名字，下一次保存就成功，红字消失，所以平时看不见。<br>2. 只有空名卡一直留着，生成进度又不停触发保存（`canvasRunActions.ts:43-49`，每次 700ms 防抖）时，才会累积成几十次失败。<br>3. 错误文案把排查引向了磁盘。<br>4. 空名卡照常能出图：单卡生成按钮不看名字（`StoryboardAnchorRow.tsx:175`）。也就是说，花钱的门比存盘的门还松 |

### 三条体验铁律

- ⑩ 不适用：这次不是意图和参数不一致。
- ⑪ 不适用。
- ⑫ **适用**：
  - 用户点「新增人物卡」，预期是多一张待填的卡；实际是整份工程从此存不下。
  - 用户把整片画幅选回「默认」，预期是回到默认；实际同样是整份存不下。
  - 用户点「关闭」，预期是存好再关；实际是被拦住、无路可走。

`tests/ux/full-walk/catalog.mjs` 里没有这几个目标的「预期 / 实际」对照。修补线要把它们记进逃逸账本，状态写 `candidate`，结账挂 §8 刀 1 的属性测试（matrix 类检查）。

### 2b. 同类入口清单：存盘 schema 逐条对照编辑入口

| 字段路径 | 产出它的编辑入口 | 存盘约束 | 状态 |
|---|---|---|---|
| `storyboardDesignsByDocumentId.*[].plan.anchors[].name` | 新增人物卡：`StoryboardPlanEditor.tsx:625` → `addAnchor`（`storyboardPlanEdits.ts:101-111`，空名在 `:105`） | `storyboardPlanSchema.ts:20` 的 `min(1)`，经 `projectRecordSchema.ts:72` 套用 | 实算拒收；现场已复现 |
| 同上 | 清空名字输入框：`StoryboardAnchorRow.tsx:226-228` → `StoryboardPlanEditor.tsx:616` → `updateAnchor`（`storyboardPlanEdits.ts:113-116`） | 同上 | 实算拒收；现场已复现 |
| 同上（风格类文字人物卡） | `addAnchor(plan, 'style')` | 同上 | 实算拒收。`validatePlan` 不拦文字人物卡空名（`storyboardPlanEdits.ts:340-344`），存盘比生成还严 |
| `…plan.aspectRatio` | 整片画幅选「默认」：`StoryboardBulkBar.tsx:97-100,155` → `setPlanDefaultAspect`（`storyboardShotScope.ts:250-262`） | `storyboardPlanSchema.ts:94` 的 `min(1).optional()` | 实算拒收。读代码确认：选项值 `''` 经 Mantine 8.3.18 的 `onOptionSubmit` 原样回调。**未在真 App 里点过** |
| Agent 改人物卡 | `patchStoryboardSubject`（`storyboardSubjectAdapter.ts:59-87`） | `planAnchorSchema.parse(merged)`（`:87`） | 实算抛 `too_small`。不是存盘问题，是同一契约错位在 Agent 面的表现 |
| `generationCanvas.nodes[].result.url`、`history[].url`、`timeline` 片段 `url` 为 `blob:` | 没找到桌面端编辑入口会写进这几处。导演台截图只在没有桌面运行时退回 blob，而且写进的是导演台自己的产物表（`useDirectorOutputs.ts:81`） | `assertWorkbenchProjectMediaUrlsPersistable`（`projectMediaMigration.ts:494-512`）会让整份保存抛错 | 同样是全有全无的门，目前没有产出者 |

**查过、没发现编辑器能产出违规值的**
- 各种 id（人物卡、镜头、场）：都由 `nextStoryboardSubjectIds` / `makeSceneId` 发号。复制镜头时 `shotId` 置为 `undefined`，合法。移场只用已有的场 id（`StoryboardShotTable.tsx:597`）。
- 标题、描述、提示词、场名：schema 本来就是普通 `string`。`addScene('')` 实算通过。
- `durationSec`：参数控件经 `parseControlInput` 只放有限数（`parameterControlModel.ts:280-284`）；停留时长是固定选项（`ShotComposerBar.tsx:60-70,90`）；`applyDurationToAll` 拒绝非正数。
- 参考绑定 `url`：`shotReferenceSlots.ts:95-96` 去空白后拒空串。人物卡 `referenceUrl`：`rememberAnchorReferenceUrl` 拒空串。
- 分类：`setCategories` 先按 schema 过滤（`workbenchStore.ts:260-262`）；改名拒空（`:274-276`）。
- 新增、插入、复制镜头：实算都通过。

**没查完的**
- `promptSegments`：只读到 `replacePromptSkeletonRange` 的调用处，没逐行核下标。
- `editingPanelLayout`：只看到 clamp，没核全部写口。
- `pendingAssetDeletions`、片种 `storyboardProfile` 的写口。
- Agent 和 MCP 起草、续写方案的路径：走严格的作者 schema，没有逐条核。
- 画布节点内部字段：存盘 schema 对节点是 `z.unknown()`，不在本表范围。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 整片画幅先选 16:9 再选「默认」，会出现和本次同一句红字；此后每次保存都失败，直到换回一个具体比例 | 用隔离资料起 App → 打开分镜页批量条的「画幅」→ 选 16:9 → 再选「默认」→ 等 1 秒 → 看顶部红字和诊断日志里的错误指纹 |
| 让 Agent 改一张用户刚新建、还没起名的人物卡（改描述或换模型），工具会报出 zod `too_small` 原文 | 已实算复现：`patchStoryboardSubject(addAnchor(createEmptyStoryboardPlan()), 'anchor-1', { prompt: '…' })` 抛错 |
| 下一次为模型面给某个内容字段加非空或枚举约束时，只要编辑器能把这个字段清空，就会再出一次「整份存不下」或「整份打不开」 | 门建成前：`rg "min\(1\)" electron/shared/storyboard/storyboardPlanSchema.ts`，逐条对照编辑入口。门建成后：§8 的属性测试会红 |

## 4. 靶子独立性检查

- 这次出错的正是靶子本身。存盘 schema 本该是「读得回的形状」这把尺子，却抄了模型面的规则。要先修靶子，把存盘面单独定义出来，再谈修补哪一处。
- 现有存盘测试的夹具和 schema 出自同一批作者，都是手写、带名字的，不独立。新门的输入必须由编辑函数现场算出来。复现来自现场诊断和另一条排查线，不是本线。
- 「修对了反而红」会发生：`projectErrorSurface.test.ts:62-80` 和 `useProjectWindowLifecycle.test.ts:51-58` 把「保存失败只有一句话」钉成了期望值。改成按原因说话（刀 2）、或改关窗行为（刀 3）时，它们会红。它们是错靶子，在同一提交里改，不算回归。

## 5. P0：这些是我们独有的吗？现成方案有哪些

**分镜方案的形状、什么叫「能生成」**：领域知识，自己写（`electron/shared/storyboard/` 在领域目录里）。生成前拦截的唯一真相源已经有了：
- `validatePlan`（`storyboardPlanEdits.ts:336-355`）：人物卡空名、提示词为空，在对应行上标红框。
- 落画布时的严格解析（`capabilityApplyHandler.ts:561`）。

存盘口不该再管这件事。

**「草稿先存，发布或出站时才校验必填」**：通用做法，不自己写。
- Payload CMS 草稿文档原话：「When `draft: true`, required fields are not enforced, allowing you to save incomplete documents」。草稿校验开关 `validate` 默认是 `false`（https://payloadcms.com/docs/versions/drafts ）。
- 用现成的 zod 组合来表达：存盘面是基础形状；严格面等于基础形状 `.extend()` 再加回非空。仓库已在用 zod 3.25.76。
- 字段级报错用 zod 的 `issues[].path`（https://github.com/colinhacks/zod/blob/v3.24.2/README.md 的「ZodError」一节）。

**「编辑器产出全集」的门**：用现成的 fast-check，不自己写随机生成器。仓库已有 `^4.8.0`，先例有 `canvasEventReplay.property.test.ts`、`proposalTxn.property.test.ts`。

**主进程错误怎么经 IPC 带回来**：通用能力。对应自写登记 **`ipc-invoke-failure-text`**（under-review，reviewBy 2026-11-23）。
- Electron 官方说明：handle 里抛的错「only the `message` property from the original error is provided to the renderer process」。出处：v43.4.0 `docs/api/ipc-main.md` 的 handle 一节。相关 issue #24427 以纯文档 PR #36127 结案，没有改序列化行为。
- 进程之间传的普通数据走 HTML 结构化克隆，原样到达（`docs/tutorial/ipc.md`「Object serialization」）。
- 经 contextBridge 时，普通对象能原样过，Error 的自定义属性会丢（`docs/api/context-bridge.md` 的类型表，#25596）。
- 现成方案有三个：
  - **electron-trpc 1.0.0**：peer 依赖 `@trpc/server ^11.10.0`、`electron >=35`（https://github.com/jsonnull/electron-trpc ）。
  - **electron-better-ipc**：内部用 serialize-error。README 写明需要 Electron 44，我们是 43.4.1（https://github.com/sindresorhus/electron-better-ipc ）。
  - **serialize-error 13.0.2**：仅 ESM，Node ≥20。会把 message、stack 和自定义属性整个带过去，其中包括文件路径（https://github.com/sindresorhus/serialize-error ）。
- **为什么现在换不了整条 IPC**：要改 6 个 preload 文件里的 219 处 `ipcRenderer.invoke` 和 233 处 `ipcMain.handle`，是架构级迁移，不该进补丁版。
- **哪天换**：按登记的 reviewBy（2026-11-23）出结论。
- **这次不新增读法**：只把保存这一条通道改成返回结果包络。这是官方建议的显式序列化方向；仓库已有同形的 `IpcResult`（`electron/preload/ipcCall.ts:9-16`）。改完后保存失败不再经过「读那句话」，登记的消费者少一个。这是「换」，不是「补」。

**关窗时保存失败**：通用做法。可参考 VS Code 的 Hot Exit：退出时记住未保存的改动并写备份，下次启动恢复（https://code.visualstudio.com/docs/editing/codebasics 的「Hot Exit」一节）。

## 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

### 6a. 存盘方向

**A 接入成熟做法：存盘只认「可编辑草稿」（推荐）**
- 做什么：
  - 分镜 schema 拆成两面。
  - 草稿面只管结构：类型、枚举、整数、有限数，以及程序发号的 id 非空。人物卡名字、整片画幅这类**内容字段不要求非空**。
  - 严格面 = 草稿面 `.extend()` 加回非空，只给规划模型输出、Agent 入参、落画布用。
  - 存盘和读盘都用草稿面；生成前拦截照旧由 `validatePlan` 按行标红。
- 代价：3 个源文件加测试，没有新依赖。
- 风险：
  - 磁盘上会出现「没填完」的方案。
  - 用 0.24.1 存过空名卡的工程，退回 0.24.0 打不开，因为旧版读口是严的。

**B 补：让编辑器产不出坏形状（不推荐）**
- 做什么：新增人物卡时给默认名；名字框不许清空；「默认」画幅写 `undefined`。
- 代价：3 处小改。
- 风险：
  - 下一个能清空字段的入口会再来一次。06-22、09-21、10-29 都是这样一处一处补的。
  - 默认名会进付费提示词：`storyboardPromptCompiler.ts:67,92` 把名字写进定妆卡提示词，用户没写过的「角色 1」会发给模型。

**C 重写一层：坏的那份单独隔离，其余照存（现在不推荐）**
- 做什么：存盘时逐份方案校验，过不了的原样存进隔离区，界面标出来；读盘同理。
- 代价：新字段，加上新的界面状态（要走设计流水线）。
- 风险：
  - 把用户的正常操作（先加卡、后起名）当成「损坏」展示。
  - 隔离区处理不好，就是静默丢数据。
- 日后可以只做读盘那一半当兜底，只兜旧版本或新版本的数据、以及程序 bug。

**D 删：存盘不做校验（不推荐）**
- 做什么：payload 整体当 `z.unknown()` 直接写。
- 代价：最小。
- 风险：
  - 程序 bug 写进去的坏形状会让工程**打不开**，比存不下更糟。
  - 失去「写进去的一定读得回」这条保证。

### 6b. 错误怎么跨 IPC 带回来

先说清分工：10-29 那批失败发生在发 IPC **之前**（`projectRepository.ts:270` 拒绝，`:279` 才发 IPC），本组选项解决不了它，解决它的是 6a 的 A。本组解决的是主进程那一半：锁、占用、权限、满盘。这些失败现在回到渲染层只剩一句话，界面分不清原因。

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| I1 接入现成方案：整条 IPC 迁到 electron-trpc 1.0.0 | 主进程抛 `TRPCError`，渲染层拿到带 `code` 的 `TRPCClientError` | 改 219 处 invoke 和 233 个 handle | 迁移期两套并存，补丁版做不完 | 本次不做。按登记 reviewBy 出结论 |
| **I2 接入标准做法：保存通道返回结果包络** | 详见表后说明 | 改 1 条通道：`projectsIpc.ts`、`preload.ts`、`ipcCall.ts`、`projectRepository.ts`、`projectOperationFailureText.ts` | 包络要和现有 `IpcResult` 的拆封合成一处，不能出现第二种拆信封写法 | **推荐，进下一版** |
| I3 serialize-error 13.0.2 | 在 handle 里调 `serializeError`，在渲染层调 `deserializeError` | 小；仅 ESM | 1. message、stack、含用户路径的属性会被整个带过来，和「失败落盘只收结构事实」冲突。<br>2. 界面要的仍是一张闭合的原因表，还得再映射一层 | 不推荐 |
| I4 补 | 继续从 invoke 那句话里认类名，在出口加第 4 个特例 | 最小 | 1. 特例分支数越过 P1 的触发线。<br>2. 只剩一句话、看不出错误类名的失败照样认不出 | 不推荐 |
| **I5 删错话** | 删掉「请检查本地磁盘权限」这句假原因。原因不明时只说「没能保存，改动还在当前窗口里」，并指明导出诊断包的位置（设置 → 通用 → 导出诊断包，沿用 `feedbackReport.ts:15` 的现成说法）。只改文案，不加界面元素 | i18n 改两行 | 无 | **推荐，随刀 1 进 0.24.1**；和 I2 不冲突 |

I2 的做法：
- `nomi:projects:save-async` 不再抛错，改为返回 `{ ok: true, value }` 或 `{ ok: false, error, reason }`。
- `reason` 取自一张闭合表：`workspace-busy`、`binding-stale`、`write-denied`、`in-use`、`disk-full`、`not-found`、`unknown`。
- 附带的事实只有 code、errno、syscall、出错阶段，不带路径和原文。
- 渲染层由唯一的 owner 拆包。
- 出口按 `reason` 查 `Record<reason, 文案键>` 这张穷举表；漏配一条，类型检查就会红。

### 6c. 关窗时保存一直失败（用户可见行为，单独交用户）

**现状**
- 确认关闭后先保存（`useProjectWindowLifecycle.ts:37-43`）。存不上就弹 toast 并取消关闭（`:44-48`），没有第二条路。
- 主进程的「未响应 → 强制退出」对话框（`windowCloseConfirmation.ts:33-56`）只在渲染层不回话时出现，而且只有英文。
- 结果是用户只能强制结束，未保存的编辑丢失。

| 做法 | 会发生什么 | 代价 |
|---|---|---|
| W1 先留应急副本，再让关 | 1. 关窗时保存失败，就绕过 schema 门，把当前内存内容原子写成一份应急副本，放在应用数据目录，避开出问题的项目盘。<br>2. 写好后允许关闭。<br>3. 下次打开这个项目时提示「有一份没存上的改动，恢复吗」。<br>4. 如果副本也写不进去，就明说「关掉会丢失这次的改动」 | 新写口，加上打开时的恢复提示（新界面，要走设计流水线） |
| W2 提供「不保存，直接关闭」 | 保存失败时弹确认框：「没能保存。关掉会丢失上次成功保存之后的改动。」两个按钮：「留下来」（默认）、「不保存，关闭」 | 小：复用现有确认框，加中英文案 |
| W3 维持现状，继续拦住 | 只把失败原因说清楚 | 无。但存不上时用户仍然只能强制结束 |

**默认推荐**：先上 W2。它小、能独立验收，能结束「只能强制结束」的局面。W1 作为下一步的目标做法。A 落地后，编辑器产出的状态不会再让保存失败；剩下的是环境类失败（权限、占用、满盘），频率低，但仍会把人困住。

## 7. 用户要权衡的核心

要不要允许磁盘上存「没填完」的分镜，比如还没起名的人物卡？
- 换来的：任何编辑都存得下，一份草稿不会再否决整份工程。
- 代价：
  - 「内容完整」只在点生成那一刻检查。那里本来就有红框拦。
  - 存过这种草稿的工程，不能再退回 0.24.0 打开。

## 8. 修补线切法（按发版）

**约束**：`electron/productionRun/` 归另一条线独占。主进程轮询的写放大排在它合并之后，不在本表。

| 刀 | 版本 | 做什么 | 碰的文件 | 依赖 |
|---|---|---|---|---|
| 1 | **0.24.1** | 1. 存盘和读盘改用草稿面（A）。<br>2. 拒绝时把 `issues` 的字段路径写进日志字段；记录里的键（如文稿 id）一律替换成 `*`。<br>3. I5 删掉假原因 | `electron/shared/storyboard/storyboardPlanSchema.ts`<br>`src/workbench/generationCanvas/agent/storyboardPlanSchema.ts`（重导出）<br>`src/workbench/project/projectRecordSchema.ts`<br>`src/workbench/project/projectNormalize.ts`<br>`src/i18n/resources.ts`（`studio.projectSaveFailed` 中英各一行）<br>测试 | 无 |
| 2 | 0.24.2 | 保存通道改成结果包络，加原因表（I2） | `electron/projects/projectsIpc.ts`<br>`electron/preload.ts`<br>`electron/preload/ipcCall.ts`<br>`src/workbench/project/projectRepository.ts`<br>`src/workbench/project/projectOperationFailureText.ts`<br>`src/i18n/resources.ts` | 排在刀 1 之后。原因不明时沿用 I5 的中性句 |
| 3 | 按用户拍板（W2 可进 0.24.1 或 0.24.2） | 关窗时保存失败的出口 | `src/workbench/project/useProjectWindowLifecycle.ts`<br>`src/i18n/resources.ts` | 无 |
| 4 | 0.24.1 或 0.24.2（不在热点里，独立一刀） | 进度更新不再触发整工程保存：只有状态跳变、首次拿到 taskId 或 taskKind 时才 bump；单纯的百分比变化不 bump | `src/workbench/generationCanvas/store/canvasRunActions.ts:43-49`；必要时让 `nodeRunOutcome.ts` 给出「这次补丁有没有改持久事实」 | 和保存方向没有代码依赖。建议排在刀 1 之后验收，这样量到的是保存能成功时的真实写盘次数 |
| 5 | 0.24.x 之后 | Agent 改人物卡时：作者给的改动用严格面校验，合并后的整张卡用草稿面校验 | `electron/shared/storyboard/storyboardSubjectAdapter.ts` | 刀 1 之后 |
| 6 | 待定 | 1. 读盘侧逐份隔离（C 的读侧一半）。<br>2. 单卡生成遇到空名人物卡时是拦是放，属于出站层的决定 | `projectNormalize.ts`<br>`StoryboardAnchorRow.tsx` 或 `storyboardPromptCompiler.ts` | 刀 1 之后 |

关于刀 4 的门表：door-map 数出 `setNodeProgress` 有 7 个写入口、13 处调用（runner、续查、ComfyUI、裁剪、视频深度）。bump 的判断要放在 `createCanvasRunActions.setNodeProgress` 这一处，不在调用点各自判断。

### 刀 1（0.24.1）

**先写的特征测试，钉住现状**
- 修前红（复现）：
  - 用真函数产出方案：`createEmptyStoryboardPlan` 后接 `addAnchor`；`updateAnchor(…, { name: '' })`；`setPlanDefaultAspect(…, '')`。
  - 经真 store 的 `setStoryboardPlan` 写入，再走 `readCurrentWorkbenchProjectPayload()` → `normalizePayload`。
  - 今天三条都抛 `corruptPayload`。
- 修前修后都要绿（不许变）：
  - 规划模型输出和 Agent 入参里，空名人物卡、空整片画幅仍被拒（`parseStoryboardPlan`）。
  - `validatePlan` 对视觉人物卡空名仍报 `anchor-no-name`。
  - `projectNormalize.test.ts` 里的未知键剥离和旧键迁移。
  - `storyboardPlanSingleOwner.loopback.test.ts` 的三条不变量。

**★9 验收清单（动手前写全）**
1. 新增人物卡、不填名字：自动保存成功，没有红字。关掉整个 App 再打开，空名卡还在，行上的红框也还在。中英文各验一遍，截图亲眼看过。
2. 清空已有人物卡的名字：结果同第 1 条。
3. 整片画幅先选 16:9、再选「默认」：保存成功；重开后显示「默认」。
4. 处于 1–3 任一状态时，等 2 秒后强制结束：重开后编辑都在。这是把现场「强制结束丢编辑」翻过来。
5. 往返：存盘内容经 `JSON.stringify` / `JSON.parse` 后再走读盘（`normalizeRecord`），得到同一份方案。用来抓「存得进、读不回」，比如 `Infinity` 落盘后变成 `null`。
6. 规划模型或 Agent 给出空名人物卡时，仍被拒，报错能指到字段。
7. 空名视觉人物卡仍会拦住批量生成（`validatePlan` 不变）。
8. 注入一个 schema 不认识的形状让保存失败：日志里有字段路径，红字不再提磁盘权限。

**反例（必须红）**
- 把 `projectRecordSchema.ts` 改回引用严格面，或把草稿面的 `anchors[].name` 改回 `min(1)`：属性测试和静态守卫都必须红。
- 在编辑函数层新增一个会把内容字段写成 `''` 的动作，却没登记进门：覆盖棘轮必须红。
- 去掉往返断言：用 `durationSec: Infinity` 的变异样本跑，必须红，以证明往返确实在测。

**结构性预防**
- **结构上做不出来**：
  - 严格面 = 草稿面 `.extend()`，规则只能往严格面上加。
  - `src/workbench/project/**` 不许 import 严格面。用 ESLint `no-restricted-imports` 实现，或并进现有的 check 脚本。
- **门岗自动拦**：用 fast-check 写属性测试。
  - 随机编辑序列从编辑函数表里取：`storyboardPlanEdits.ts` 导出的全部方案变换、`storyboardShotScope.ts` 的画幅设置、批量参数作用域、store 的方案增删改名。
  - 自由文本取任意字符串，包括 `''`。
  - 下拉取界面上的真实选项：把批量条的画幅选项从 `StoryboardBulkBar.tsx:97-100` 抽成纯函数，测试和界面读同一份。
  - 每个序列经真 store 落到 `readCurrentWorkbenchProjectPayload()`，断言两件事：存盘口通过（`normalizePayload` 和 `assertWorkbenchProjectMediaUrlsPersistable`）；JSON 往返后读回同一份。
  - 加覆盖棘轮：编辑模块新增导出的方案变换没进表，测试就红。
  - 画布那一半不另起炉灶：在现有 `canvasEventReplay.property.test.ts` 的每个随机序列之后，加一句「存盘口通过」断言。
- **局限，明说**：
  - 组件里直接拼对象再调 `setStoryboardPlan` 的写法，门看不到，例如 `StoryboardShotTable.tsx:597,634`。
  - 这些写法受 TS 类型约束，而草稿面只保留类型能表达的约束，所以类型对就存得下。
  - 剩下唯一的缝是数值有限性，由往返断言兜住。

**回滚**
- 读盘的放宽不能回退。回退后，存过空名卡的工程会打不开。
- 如果要撤，只撤写口：在 `saveProjectRecord` 前加回一行严格检查，读口保持宽。也就是前滚，不整刀 revert。

### 刀 2–4 简表

**刀 2：保存失败的原因**
- 特征测试：
  - 先跑绿现有断言：锁忙能认出来，其余失败一律同一句。
  - 新增：在主进程注入 EBUSY、EPERM、ENOSPC、锁忙、身份过期，各走一遍真 handler，记下现状。
- ★9 要点：
  - 五类注入各得到不同的人话。
  - 日志有 reason、errno、syscall、channel，没有路径和原文。
  - 锁忙仍说「项目正被别处占用」。
  - Windows 上的 EPERM 只说「写入被拒（可能是权限、占用或安全软件）」，不归成某一个确切原因。
- 反例：
  - handler 改回抛错 → 包络测试红。
  - 新增一个 reason 却没配文案 → 类型检查红。

**刀 3：关窗出口（W2）**
- 特征测试：`useProjectWindowLifecycle.test.ts:51-58`（失败就留窗）先跑绿，修完按新行为改写。
- ★9 要点：
  - 保存失败时弹框，默认按钮是「留下来」。
  - 选「不保存，关闭」：窗口关闭、App 退出，不需要强制结束。
  - 选「留下来」：一切照旧。
  - 系统关机那条路不弹框，沿用 `flushPendingWorkbenchProjectSaves`。
  - 中英文都截图。
- 反例：
  - 去掉弹框、直接关 → 测试红。
  - 默认按钮改成「关闭」→ 测试红。

**刀 4：进度不再触发整工程保存**
- 特征测试：
  - 钉住今天的行为：同一 taskId 的 N 次进度会 bump N 次。
  - 钉住要保留的行为：第一次带 taskId 的进度会写进节点的 `runs[0].taskId`。
- ★9 要点：
  - 免费夹具生成两张图、等待 20 秒：这段时间主进程收到的保存 IPC，从十几次降到最多 3 次（首次 taskId 一次，加上终态）。
  - 生成中强制结束 → 重开 → 节点可以找回，免费续查能用，因为 taskId 已经在盘上。
- 反例：
  - 去掉首次 taskId 的 bump → 续查测试红。
  - 恢复每次进度都 bump → 计数测试红。

## 特征测试清单（动结构前先锁住）

**已有、要保持绿的**（本线只读，没运行）
- `src/workbench/project/projectNormalize.test.ts`：未知键剥离、旧键迁移、迁移失败告警。
- `src/workbench/creation/storyboard/storyboardPlanSingleOwner.loopback.test.ts`：手工编辑入口那一扇门。
- `src/workbench/generationCanvas/agent/storyboardPlanEdits.test.ts`。
- `src/workbench/library/projectErrorSurface.test.ts:62-80`、`src/workbench/project/useProjectWindowLifecycle.test.ts:51-58`：错靶子。刀 2、刀 3 在同一提交里改写，刀 1 不动它们。

**要先写的**（建议的文件名）
- `src/workbench/project/projectSaveDraftContract.test.ts`：三条修前红的复现，加往返断言。
- `src/workbench/project/editorPersistability.property.test.ts`：fast-check 门和覆盖棘轮。

**登记**
- 逃逸账本：建议条目 `USER-20261029-project-save-draft-veto`，铁律 ⑫，结账挂上面这个属性测试（matrix 类检查）。
- 根因合同的 doors：door-map 数出 `normalizePayload` 有 2 个入口、3 处调用：读两处（`projectNormalize.ts:194,212`），写一处（`projectRepository.ts:270`）。三处都改走草稿面，不合并入口，理由是读和写本该同一契约。

## 裁定

用户原话：「都按推荐」。

2026-10-30 批准存盘方向 A「照样存下」：没填完的草稿照样存，点生成时才提醒补全；保存失败说出真实原因。刀 1 + 刀 2 均进 0.24.1。用户已知代价：存过草稿的项目退回 0.24.0 会打不开。热点文件照常写复盘、提交带 Direction-Check，继续做；只有要加新分支、新特例时才停。关窗 W2 需样张拍板，另线实施；进度刷新和主进程轮询写放大不在本次范围。
