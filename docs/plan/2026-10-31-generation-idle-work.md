# 生成等待期间删除无进展的工作

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

负责人：本实现线。类别：长跑、可打断、画布、性能修复。范围：等待视觉、前台进度 dirty 边界、主进程 pending 快照；不改变提交、取消和恢复协议。

## ★0 先查已有实现

纯 bug 修复，使用仓库现状作为决策依据：

- `src/workbench/generationCanvas/nodes/GenerationWaitingSurface.tsx` · reduced 分支已有灰格及进度 · 确认直接保留这套视觉、删 shader，不新设计。
- `src/workbench/generationCanvas/runner/generationRunController.ts` · 后台仅首次新 taskId 落盘 · 确认前台也区分恢复事实与百分比。
- `electron/productionRun/productionGenerationSubmission.ts` · materialized 直接读既有回执 · 确认重复 pending 不改快照，而终态 raw 仍须保留供 materialize 使用。

## ★1 用户任务、指标和连带界面

当创作者同时生成多张卡时，希望等待期间仍能操作画布，并在重启后继续原单。步骤：打开项目 → 提交 → 显示灰格与真实进度 → 操作画布 → 关闭重启 → 找回原单 → 结果落卡。没有新操作、供应商分支或配置开关。

任务形态：多镜视频同时生成；有真实字节回执的大媒体导入；聊天指向同一生成节点。此次资源使用本地模拟供应商及仓库素材，真实账号/Windows 用户现场仍 unverified，不把模拟供应商当成真实付费验收。

目标 → 信号 → 指标：等待无需持续绘制 → canvas draw 计数 → 纯 pending draw/s=0；没有恢复事实变化 → 保存 IPC 计数 → 30 秒为 0；轮询不重复落盘 → 快照写入和文件字节 → 同状态 pending 写完整快照=0；交互跟手 → 现有 canvas-scale 帧探针 → frameGapP95≤33ms。量具：`GenerationWaitingSurface.test.ts`、`canvasRunActions.idle.test.ts`、production submission/envelope 测试及 `generation-idle-60`/`generation-idle-100` 性能场景。基线待测，未验证不记为 0。

★1b：画布卡、聊天 NodePointer、任务列表继续显示原阶段/百分比/失败与取消状态；导入仍读字节比例和已有中英文标签；不新增文案或预览编辑器。

## ★2 状态归属

主进程 Run 与 runtime envelope 是提交/恢复事实 owner；画布 run record 保存节点身份和 taskId，瞬态百分比仅更新内存。`setNodeProgress` 7 个写门必须共享 dirty 判定；WaitingSurface 3 个读门共用静态视觉；poll 与 markPolled 在各自边界拒绝重复 pending 快照。门图来自 `node scripts/door-map.mjs`，不手写猜测入口。

## ★3 一致与复用

复用现有静态灰格、ProgressRevealCanvas 的字节事件绘制、nodeRunOutcomePatch、现有 provider 状态分类、既有 canvas-scale 量具。不加包。删除 img-fx、patch、preset 类型与传参；BaseGenerationNode 仅删协调放行的四处。

## ★4 全状态

空：原空卡；排队/生成：静态灰格、原进度与状态；成功：等待层立即退出、原结果；失败：原失败卡和原因；部分成功：已完成卡照常落地、其他卡仍等待；取消中：沿用原取消语义；过期：原 recoverable/找回；能力不可用：沿用原模型启用或重新选择入口。本修复不改中英文状态文案。

## 5 打断矩阵

| 状态 | 停止 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 排队 | 原取消入口及回执 | 保存运行身份 | 原错误/恢复回执 | 读既有任务 | 原幂等协议 |
| 已获 taskId / pending | 原取消入口，终态照写 | 保留 taskId | 原 recoverable / 重查 | 接回原单不重发 | 不改变提交去重 |
| 成功 | 保留结果 | 保存结果 | 已有结果可见 | 结果重载 | 不重复落地 |
| 失败 / 取消 | 保留原因/终态 | 保存终态 | 不伪造成功 | 重载终态 | 原重试入口 |

所有格沿用既有费用与退款责任，本修复不发起新提交、不改变计费；回执仍在节点、运行记录、任务列表和主进程 Run 中。模拟供应商验证零真实费用。

## 6 外部数据与失败

供应商状态由现有 providerStatus 分类；未知状态仍 needs_attention，不因节流被隐藏。pending raw 的进度/时间不决定恢复；状态改变及终态 raw 仍写。首次 taskId/换 taskId、taskKind、runId 接管及 queued→running 继续 dirty。旧数据无需迁移。未改变外部 API，不引入新的供应商假设。

## ★7 性能

无新增交互。规模 N=60/100、其中 k=12 在生成，等待至少 60 秒。本地模拟供应商；固定 pure pending 窗口 30 秒数保存 IPC、整个窗口数 draw 和快照写入；共用 canvas-scale 帧探针，p95≤33ms。登记 `generation-idle-60`、`generation-idle-100`，`pnpm run perf:scenarios -- --id <id> --measure-only`。每条至少 5 次；实现线只交数字，不自行批准/刷新正式基线。改前/后值见文末「正式量数」。

## 8 真实条件

隔离 Mac App、中英两轨、静止等待/重启接单/成功落卡、导入及聊天读门，截图逐张查看。Windows、用户真实工程和真实供应商 unverified。起窗前检查前台非 Claude、5 分钟负载<10；重活用门岗锁，不改启动器。

拍板图：不适用。用户批准删除动画，复用现有 reduced 灰格，不画新视觉。

## ★9 验收清单、反例与回滚（实现前确定）

1. 7 个写门从清单生成事件矩阵：百分比/时间/阶段叙述不 dirty；首次及变更 taskId、taskKind、runId、queued 接管 dirty；清进度不吞终态。状态、结果、取消仍 dirty。保存订阅响应等同实际 autosave 的 persistRevision 信号；真窗另数 IPC。
2. 首次 taskId 随 dirty 进入现有保存链；序列化重载后可读 taskId；生成中重启 App 接原单、供应商 submit 数不增加。
3. 成功、失败、取消照样持久化；materialize 保终态 raw；未知状态仍显式注意；重新实例化 runner/envelope 后仍按冻结合同查询。
4. 后台首次 taskId 照存；后台纯进度不新增整工程写；节点不在时不累积瞬态进度，运行开始/终态/结果暂存仍可重放。
5. WaitingSurface 的画布/聊天/导入三读门：灰格静止；预览帧/状态仍可见；导入真实字节标签及比例仍更新；终态等待层卸载。
6. 同状态 pending 重复 poll 不写 envelope/Run 快照，首次观察和状态变化照写；相同 terminal 再观察仍保新 raw；幂等和恢复测试继续通过。
7. 反例 A：仅还原等待动画路径，draw>0，等待特征测试红；反例 B：仅还原无条件 bump，保存特征测试红；反例 C：仅还原 poll/envelope 重复写，快照特征测试红。每次保存产品文件原始字节/哈希、串行实验、finally 还原并校验哈希，不提交反例。
8. 性能 N=60/100、k=12、≥60 秒；draw/s=0、30 秒 saveIPC=0、重复 pending 快照写=0、frameGapP95≤33ms，改前改后均交实测。
9. gates、根因 checker、性能登记 checker、推送前快检退出 0；逃逸账本 reviewed，completionCommits 指真实产品提交；另一条线合并前独立验收（本线不冒充独立线）。

反例 → 结果 → 证据在实现后填写。回滚使用产品提交的 revert PR，不加动画开关，不直接改主分支。独立验收待协调安排，本线交本地实现与证据，不自行推送/合并。

### 功能分类
- [x] 新界面 / 改交互
- [ ] 花钱
- [x] 长跑 / 可打断
- [ ] Agent 行为
- [x] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [x] 新增功能 / 性能


## 实现期间补充

协调明确静态等待现状不增加转圈或文字；有百分比/无百分比、中/英四张真窗截图供后续样张另行拍板。性能量具 `pendingMotionCensus` 预留等待卡内小转圈和动画计数，本轮不会挂载小转圈。

7 写门核查：designLab 只改阶段；ComfyUI 可能首次带 promptId，之后为叙述/百分比；trimVideoToNode 先 updateNode 建运行态、后续纯本地字节/百分比；generationRunController 先 appendRun、前台 setProgress / 后台仅新 taskId；recoverTaskActions 先显式 setStatus 接管，随后原 taskId 纯轮询；runProjectDelivery 前后台共享恢复判定、缺节点不暂存 progress；videoDepth 先 setStatus、后续本地处理状态与字节比例。终态都走既有 status/result 入口，没有用进度代替终态。

主进程性能夹具单独创建 1 个零费用 Run，调用真实 submission.poll 与 envelope 写边界；12 张卡的 UI 本地供应商任务由既有 process fixture 创建。指标分别保留来源，不把两条提交路径说成一条。


## 本地自验记录（尚未完成真实闭环）

| 反例 / 检查 | 结果 | 证据 |
|---|---|---|
| 还原等待动画 | 12 张等待面在 1.1s 内绘制 198 次，测试红；恢复静态后 0 次 | GenerationWaitingSurface.test.ts；计数同时包含 GL draw 和 2D drawImage，不与单独 GL 口径混用 |
| 还原无条件 dirty | 30 次进度产生 30 个 dirty 信号，重复 taskId 后 1→11，测试红；修后纯进度为 0 | canvasRunActions.idle.test.ts；此数是 dirty 信号，不冒充真实 IPC |
| 还原 poll/envelope | 5 次重复 pending Run revision 11→16，envelope 字节变化，两文件分别红；恢复后稳定 | productionGenerationSubmission.test.ts、productionRunRuntimeEnvelope.test.ts |
| 还原后台投递 | 后台纯进度改了项目快照，测试红；恢复后身份/终态照存、瞬态不存 | runProjectDelivery.background.test.ts |
| 旧数据 taskId/taskKind 不一致 | 去掉运行记录身份比较时两项均红，恢复后通过 | canvasRunActions.idle.test.ts 的 legacy 参数化检查 |
| 导入 / 聊天 | 导入 8 项、指向元素 38 项通过；不替代真窗 | NodeImportingOverlay.test.ts、NodePointer.test.tsx |
| 续跑 build / 冒烟 | 槽 B build 0；N60/N100 各一次 60 秒冒烟，draw / 30 秒保存 IPC / 重复 pending 快照均 0，帧 p95=9.1/9.2ms | docs/evidence/2026-10-31-generation-idle-work/smoke-counters.json；不是正式基线 |
| 真窗 / 新阻断 | 中文较早量具一轮 12/12 落卡并持久化；英文两轮 11/12，最新一轮捕获 RuntimeEnvelopeConflictError；新确定性交错测试两项红，测试文件字节还原 | docs/evidence/2026-10-31-generation-idle-work/restart-blocker.json |
| 正式性能 / gates / 快检 | 未运行：按任务书新分支规则停在重启验收；未扩大产品改动 | 本地三删不等于完整验收，不得标已解决 |

全部反例由脚本 finally 还原原始字节，SHA256 前后相同；等待面一轮单文件测试曾在资源拥塞期超时，后续定位运行及最终运行通过，未调高超时。N=60/100 是静态背景数，额外 k=12 个真实 loopback 任务（实际 72/112 节点）。两档 60 秒冒烟已执行，正式五次改前后仍未运行；中英静止灰格及 75% 条的 100% 缩放截图已逐张查看，重启闭环整体未通过。性能场景保持 proposed/pending，不由实现线批准基线或预算。

执行条件以任务书 10-30 23:3x 裁定为准：load5<10 且前台不是 Claude 或 HIDIdle≥600 秒；构建/冒烟/走查走 B，正式量数双槽。本轮未改原 ★9 清单、未重做门图/反例/账本。新增恢复竞态需查询返回后再次核完成态，会新增状态处理分支，按任务书先停并交协调裁定。


## ★9 扩围类合同（10-31 03:5x，产品修改前）

用户裁定原话：“并进这条线修”。范围仅 productionGenerationSubmission 的 poll/materialize 与 productionRunRuntimeEnvelope 共享生命周期。

1. 两扇门等待外部调用后，依据最新持久事实提交；已 materialized 读已有回执，不改信封字节/Run revision，不误报尚未受理。
2. 未完成时，Run 命令在写入前取最新 revision，保留其他作者的 metadata/状态写入。
3. 每次查询持有开始时的观察版本；只接受仍基于当前版本的回执。对方只记 completed 未落地时，旧 processing/failed/unknown/completed 均不能覆盖新 raw。旧数据无版本按0，真实观察变化才推进版本。
4. materialize 的供应商取回/提取在锁外；回来后在共享文件级生命周期边界重新裁定。观察已变则重读当前已受理任务的结果；已落地直接读回执。实际 materializeOutput 只在持有同一信封互斥租约时执行，完成前再次核验所有权/最新Run，不重复落盘。复用已有 ProductionRunLock，不新增依赖或供应商特例。
5. 相同 pending 快路径不拿写锁、不写锁文件、不重写快照；变更/落地才用互斥。报告逐次新增同步读取、锁文件I/O；双档三个零断言不变。
6. 清单 tests/fixtures/generation-lifecycle-cases.json 逐行驱动一个矩阵测试。poll×poll、poll×materialize、materialize×materialize × 四种迟到结果 × materialized/completed/revision 三时机；另有未完成阳性。materialize API不返回status，四种迟到结果在清单显式投影成空产物/单产物/失败/不支持。
7. 每格核返回/真实失败分类、无生命周期或revision冲突、落地后字节和revision不变、submit及materializeOutput次数、并发metadata未丢。Promise握手固定交错，无sleep。原两个红测先纳入；清单多一行测试数多一项。
8. 只去掉共享“等完重判”的门，防重矩阵红，未完成阳性绿；finally逐字节还原。不能只改单个调用者/只重试失败卡。
9. 验证顺序：矩阵+原138 → B构建 → 最终产品HEAD双语12/12（12→12、落卡落盘、每图Read）→ gates及快检 → 最后exclusive每档改前后各≥5。超预算停。旧三删门图/反例/账本不重做。

入口清单来自 recovery-doors-poll-materialize.json（23项）及 recovery-doors-envelope.json（4项），不是手造门；同名但非Run生命周期的素材/预览/供应商底层方法保留在合同并标not-affected。Electron入口与独立stdio入口均须使用同一文件级门。

### 恢复竞态的确定性验收记录

- 清单 `tests/fixtures/generation-lifecycle-cases.json` 当前46格，单个驱动逐行取数；临时多加一行实跑47格全绿，已按字节还原。
- 只将共享 `superseded` 判据改为 false：23格红、23格绿；9格未完成阳性对照全绿；恢复文件 SHA256 相同。原版46格全绿。
- 同 pending 实测改前/改后完全相同：Run journal + snapshot 各读1次，信封读2次，无 open/write/rename。新增同步读写为0；真实变化才获取文件租约并重读信封、最新 Run。
- 确定取回失败已落入 needs_attention 时，另一条仍在等待的提取按最新失败事实停下，禁止写出资产后再触发非法 ready 转移。矩阵两格同时断言输出写入0、状态保持；不把真失败吞成成功。

### 完整门岗后的结构收尾（不新增行为）

首轮107项门岗收齐6个失败：提交模块格式化体积887>冻结855；退役shader陈列PNG、img-fx框架登记与旧patch主人未清；合同4类共享主人未登记（旧poll边界并入信封生命周期后，Run写回调也受其保护）；钩子集成测试受旧patch主人失败连带影响。

处理合同：结果回执类型、三种取回错误和确定性错误识别原样移入 `electron/productionRun/productionGenerationMaterialization.ts`，原submission重导出原API；不加分支，不改字面码/文案/判据，不提高文件上限。旧shader基线和依赖登记删除，patch不变量随引擎删除正式退役。静态等待、进度耐久判定、主进程观察生命周期分别登记单一主人；不增加存量债或unverified。

★9补验：原186项、门岗反例不变；拆分后构建和双语全流程重跑，再完整gates/快检，最后exclusive正式5次对比。旧结果保留，不冒充拆分后最终源码证据。

同模块原有provider状态分组/三种状态谓词也原样迁移到结果契约模块；底层状态词表仍只认shared/taskStatus，不增加词表、分支或供应商例外。

词表迁移收尾：完整门岗第二轮106/107通过，仅 `ProviderPollStatusClass` 的 registered.site 仍指向抽取前文件。只把该锚迁至 productionGenerationMaterialization.ts，members/reason/debtCap/债清单原样保留；不改检查算法。该元数据被构建身份保守计入，因此补一次槽B构建和最终HEAD双语12/12，再重跑完整门岗与快检，最后正式性能量数。

### 正式量数（10-31，HEAD 0041f4b15）

每档改前、改后各 5 次，12 张卡等待 60 秒。改前只还原四个基线文件并重新构建，其余源码相同，事后按 SHA256 还原。屏幕锁定、应用不在前台，每组开始时 5 分钟负载 <10，双槽独占。下表是 5 次中位数。

| 指标 | 预算 | 60 节点 改前 → 改后 | 100 节点 改前 → 改后 |
|---|---|---|---|
| 等待绘制（次/60 秒） | 0 | 14568 → 0 | 14568 → 0 |
| 纯进度保存 IPC（次/30 秒） | 0 | 9 → 0 | 9 → 0 |
| 重复 pending 快照写（次/60 秒） | 0 | 598 → 0 | 598 → 0 |
| 帧间隔 p95（ms） | 33 | 10.1 → 10.2 | 9.3 → 10.1 |

四项预算都达标。帧间隔在这台 Apple M5 上改前改后都约 10ms，这项分不出差别：量到的是等待成本降到 0，不是这台机器变跟手。弱机和 Windows 没量。原始结果：`docs/evidence/2026-10-31-generation-idle-work/formal-*.json`。
