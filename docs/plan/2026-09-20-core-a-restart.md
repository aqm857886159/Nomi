# 简化 A＋完整 T7：重新执行的唯一现行顺序

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：已实现未推送；正在系统验收；用户于 2026-09-20 在审查后授权重新执行。不是完成声明。

## 范围与依据

### 用户实测漏项：原侧栏新建空白方案

用户在当前预览点击“新建方案”仍触发 Agent。原附件明确区分“新建空白方案”和“从当前文稿交给 Agent”；既有 Electron 旅程从 Agent 创建方案开始，未覆盖这个手动入口，不能作为此项通过证据。

最小修复限定为原侧栏和 `workbenchDocumentSlice.addStoryboardDesign`：无 source 时使用既有 `createEmptyStoryboardPlan`，显式 source 的复制行为保留；原侧栏同步创建并选择指定文稿下的新方案，移除延迟调用 planner。沿用原编辑器、保存和节点绑定，不增加新 UI、Run 或执行入口。旧项目不迁移，修改仅影响新建操作。回退仅撤此接线增量。

先跑原按钮的实际 Electron 红测，再验证两文稿各两方案的创建、编辑、磁盘保存、冷重开、稳定 ID、既有内容保留及零 Agent/媒体请求。store 测试覆盖无既有方案、非当前文稿、重复新建、复制、无效文稿及零节点写入。测试使用隔离 profile，不关闭用户正在试用的窗口；截图与构建身份单独记录。这一条通过也不代表整个 A＋T7 验收完成。

基线核对补充：`dc113e712`（2026-09-10）已批准并实现显式方案编辑创建引用原正本的 `shot_table` 视图，`shotTableProjection.integration.test.ts` 明确覆盖；它不是媒体节点或生成提交。新空白创建不调用 projection；已有显式编辑和复制的表视图行为保留。本项断言分别记录创建时零节点、作者编辑后原表视图、零媒体节点/执行请求及冷重开不新增节点，不把删除原表投影当成修复。

以用户指定 `Nomi_plan_A_core_fixes_2026-09-19.md` 全文、B 仅完整 T7、`Nomi_simplified_A_plus_T7_original_storyboard_plan_2026-09-20.md` 和 `docs/audit/2026-09-20-core-a-full-review.md` 的六项澄清为准。K0–K7、C01–C30、CJ1–CJ4、T7.P01–P08 和 W00–W10 均须逐项交证据。历史执行记录是证据，不再发行指令；其中自动转完整 T3 的解释失效。

保留原 `StoryboardPlanEditor → storyboardRowActions → canvas runner`，原表、参考槽、模型参数、单镜、×3、首帧依赖波次、批量、结果历史与 Undo 都保留。新建／保存／重开不自动创建缺失节点；显式放置与纯查看保留，原生成仍按需建节点，不强加先放置步骤。

不新建页面、执行框架、付款服务、双可写方案或全量 T3 迁移。原字段、稳定绑定和安全修复不因减少代码而删掉。报价批准必须与展开后的实际付费集合一致。正式方案、付款卡未批准草稿、画布覆写和执行记录各守自己的写入边界。

## 基线与保护

工作树 `/Users/aoqimin/Desktop/Nomi-core-a-0919`，唯一集成分支 `codex/core-a-integration-20260919`；沿用原因：接续用户明确指定且已有完整审计的 16 commits 和未提交施工，避免复制／遗漏源改动。

开工 `pnpm run delivery:preflight` 已刷新 origin/main 到 `dfca9990b89c9c401b8ac81ea9ce30ab032e1be4`，比较 HEAD `a44c0f5899effa7f94e4b124a5143d68e8b2a47e` 为 0 behind / 16 ahead；因已有 dirty 施工退出 1，不伪称干净预检通过。先保存源文件快照和完整 diff，保留工作区继续修；不 reset/stash 掩盖现场，不动 main，不整文件还原覆盖共享修改。提交前再刷新并核查最新底座。

## 先查别人：复用已有实现与反方约束

已有源码就是这次修复的可复用实现：`exec/storyboardRowActions.ts` 已有 `generateShotRow`、`generateShotRowVariants`、`runStoryboardBatch`；`storyboardProjection.ts` 处理覆写；`storyboardNodeBinding.ts` 处理稳定身份；canvas runner 管付费确认与波次。审查 F01/F06 是反方证据：把旧动作换成 `host.present` 即使复用了 JSX，也删减了功能。

既有 pi history/admission、taskReference、安全错误、参数条控件不重做。本轮不换第三方 API／框架；如确实出现新依赖决策，再按 R5 核官方来源，不能借调研扩任务。

六角色复核问题：CTO 查单一状态主人与无并行执行；设计查原完整页面／交互保留；PM 查 A＋T7 不扩范围；前端查异步目标与输入保留；后端查持久化／批准边界；用户视角查新建到生成重开的连续流程。跨领域 agent 给证据，root 亲核方案与交付；跨模型池审核未获得前不冒称独立跨池通过。


- 原执行已有：`src/workbench/creation/storyboard/exec/storyboardRowActions.ts:173`、`:230`、`:315` 分别负责单镜、变体和批量；本次输入适配必须调用这些入口，禁止替代 runner。
- 原投影已有：`src/workbench/creation/storyboard/exec/storyboardProjection.ts:73` 统一处理已绑定节点与画布覆写；保存只接该 owner，不添加并行同步器。
- 原持久化已有：`electron/productionRun/productionRunRepository.ts:409` 是保存命令实际提交点；内容 CAS 在此校验，不在 renderer 盲读新版本重试。
- 依赖提供状态机制：`node_modules/zustand/middleware.d.ts:3`/`:5` 导出 subscribeWithSelector/persist，但不能替代现有项目 Run 的磁盘事务与目标身份；不引入第二持久化库。本轮复用已安装库与原 API，不新增框架能力或外部服务。
- 反方证据：[完整审查 F01/F03/F05](../audit/2026-09-20-core-a-full-review.md) 已证明复用 JSX 却替换动作、双写作者/执行候选会丢原功能和字段。因此选择原 owner 最小接线；外部新框架并不能修复本地目标归属，未声称本轮新增外部检索。

## 分工、顺序与停止越界的条件

所有执行者先完整读 AGENTS、根因技能及合同模板、原任务书和本方案，回报实际复用 owner、允许文件、未改项。先生成 door-map，再红测，再修改共享边界。任何超预算／新状态主人／新入口须先由 root 核实，不能各自扩大。

| 工作单元 | 文件归属与预算 | 先证明什么 | 收货条件 |
| --- | --- | --- | --- |
| 原执行接线（root） | editor/host、原 rowActions/binding、service landing、compiler 接线；约 12 个生产文件，超过逐类说明 | 原动作和已落节点可被 Run 目标直接复用 | 原四类生成调用原 runner；放置幂等；覆写／结果不丢；撤重复执行和 landing owner |
| 完整保存（分镜代理） | editorial、authoring、Agent producer、保存 CAS；约 5–9 文件 | 单／多候选、anchor、模型切换、提交后编辑、无关 Run 更新 | 一个实际保存对象；字段完整；源/内容冲突；保存重开；不可改写已批准合同 |
| 付款（付款代理） | 卡片草稿／参数／引用、revise RPC 与 host；约 11–12 文件 | 旧 quote、新参数、关闭副作用、参考角色、模糊失败 | 未批准草稿隔离；host CAS；准确提示；不依赖刷新猜报价 |
| K3（身份代理） | repository.read、verb schema 与测试合同；4–7 文件含测试 | 真实损坏存储与缺 domain schema | 不存在／损坏准确区分；schema/runtime 一致；安全路由保留 |
| 集成（root） | appIntegration 正式参考 resolver、静态门禁与验收记录 | 实际组装而非 helper 孤岛 | 真实执行装配测试、A/T7 全范围证据与最终树一致 |

共享文件实行分时编辑：repository.read 先由 K3 完成，保存 CAS 再接；root 独占 editor/rowActions/appIntegration/service；付款与分镜如需要 operationStore/types/reducer 同段，先交换精确 patch 范围再编辑。子 agent 不 commit/push，不自行再派施工；root 统一审 diff、集成和交付。

阶段顺序：

1. **准备**：冻结范围／快照；具体最小接口、门表和红测由 root 复核后放行。
2. **保存**：完整原 plan 与真实唯一 owner 往返，四份方案目标互不影响；无关 job/binding 更新不制造内容冲突。
3. **原动作**：flush 正确目标，原 materializer/binding/runner 消费原 plan；先证等价，再删除重复增量，不留可调用 fallback。
4. **安全及双宿主**：并行完成 K1/K2/K3，核对正式参考接线、T7 双宿主和异常手势；既有 K5/K7 修复回归。
5. **组合验收**：冻结生产文件，跑相关测试／contracts／类型／build、Electron 真旅程和适用候选包。变化后只更新相关失效证据；不过门不报完成。
6. **交付**：对完整交付树做分支评审并解决 findings，按风险验证和集成 ci-chain 后 scoped commit/push/PR；不自动 merge／发布。最终树必须包含已审 dirty/untracked 增量。

## 验收表与证据纪律

| 编号 | 必须跑的用户／边界场景 | 不能拿什么替代 |
| --- | --- | --- |
| W01–W05 / C16–18 | 两文稿各两方案；真实新建与 Agent 指定创建／修改；prompt、参考、模型、首帧完整保存重开；等待中切目标、原目标变化／删除 | 只预置 Run、只改 title/prompt |
| W06–W08 | 显式放置／查看，原单镜／×3／首帧／批量；重复并发落地；画布覆写和结果历史保留 | 普通主体节点落地、仅 DOM 按钮存在 |
| C02–11 / W09 | 精确 scope、连续批次、quote 变更、关闭零提交、模糊提交结果 | catch 后声称未花钱；helper 测试替代正式装配 |
| C12–15 | 同 ID 不同 domain、取消／查询、真实损坏存储、安全错误 | mock owner 的 not-found |
| C19–23 | 删除/Undo；原输入与附件技能；重发不清新草稿；pi 压缩历史；Stop | 仅框架替身或静态断言 |
| C24–27 / P01–08 | 单多选／历史切换；blur/cancel/卸载；失败恢复／零尺寸／边缘；画布＋付款卡可输入可点击写对对象 | visible/DOM 截图而无实际输入和写入检查 |
| C28–30 | 安全诊断与轨迹；最终包旧项目副本编辑保存重开／适用导出；最终提交树证据 | 开发构建代替安装包；历史绿灯代替当前树 |

零收费 loopback／受控工具轨迹与真实 Electron UI 可共同验证接线，但报告分别记录模拟服务、真实供应商、开发构建、安装包和平台。未验证项明确保留；不迁移／删除真实项目、不输出凭据。2026-09-20 用户已明确要求最终真实花费测试：本轮必须在隔离项目经原页面与原 runner 调用真实供应商，记录任务身份、真实产物、重开及供应商返回的费用；未知费用不伪称估价为实付。此前仅用受控服务的限制撤销。

## 回滚与进度

按 scoped diff 回退本次具体增量；原施工快照可核对，禁止整树回滚。每个单元记录修改路径、红/绿命令、失败输出、未验证项；root 收货核真实差异，不只采纳总结。

当前：正在系统验收。上一轮 86/99 contracts 与付款超时是历史现场，不能当作本轮结果；当前结果以本节追加日志与验收表为准，完整门禁尚未重新全绿。

## 2026-09-20 追加验收约束（用户明确要求）

验收必须同时覆盖行为与工程结构。每项证据标注入口、真实依赖/替身边界、构建/平台、红绿日志与当前文件版本；不得以子任务总结替代主代理源码核对。

- 架构：唯一作者正本、原编辑器/runner复用、无重复执行/付款/页面；每个新增接口必须给原owner及必要性。
- 数据：两文稿四方案完整字段、稳定节点绑定、覆写及历史；保存/切换/重启独立验证。
- 并发：模型读取、保存、素材解析、确认期间切换/删除/修改目标，晚回包不串写。
- 费用：scope与原批量准入一致，已锁/可恢复不重复付费；关闭未批准卡零提交且草稿保留。
- 交互：完整T7两宿主，实际键盘/点击/拖动异常/失焦/卸载/零尺寸/历史切换；zh/en截图人工检查。
- 工程：AGENTS P1–P5、根因门表/回归、不靠放宽预算掩盖失败、适用全维度门禁、最终树评审和分支PR。P5 工具体积因本次完整作者字段接入的明确增量，按下方独立裁决记录；旧工具部分预算保留。

独立审查新增 F14–F17 已复现并修复，原动作3文件26测通过；T7原脚本只覆盖部分路径，正在补全，不宣称完整T7通过。正式参考角色F09补测110项通过；免费上传沿既有传输同意规则，不能将其描述成未批准零上传，零付费媒体请求单独断言。

### 本轮系统验收中间记录（2026-09-20）

- K3/K5/K7 12 文件194项通过，真实已安装SDK＋loopback 12文件68项通过；C23 另增client25项、实际session history7项通过。日志见 remaining-acceptance 清单。
- 原动作并发审查复现同一物化身份等待catalog/target后重复建节点（期望2，实际4），已将所有await移至原stamp检查之前，原apply写边界4文件70测通过。仅含参考卡的显式放置也补红绿，13项通过；均无新执行owner。
- macOS 开发构建实际Electron画布旅程已通过图片/视频真实键盘及参数修改、单多单切换、history A→B→A、blur后编辑与新进程中英文恢复。`/private/tmp/nomi-electron-composer-complete.log`；截图在 tests/ux/shots/core-a-composer，主代理已看zh-image及en-restored-image/video。历史结果为受控注入的两张bundled真实jpg，因此只证明结果面板生命周期，不冒充实际生成。
- 首轮分镜新建Electron失败：ModelSchemaInformationLoss，HTTP请求0；不是服务或pi SDK不可用，而是新增输入schema投影丢信息。改为从原schema派生不重复作者语义字段，完整原editorial/save形状保留；真实工具装配12项通过，待新构建重跑页面。
- 一次composer测试记录真实node.removed导致节点消失，未以增加等待掩盖；已保留隔离项目event log并加只读输入/删除栈探针。其后三次无相同删除，最终旅程通过，但根因尚未定位，不能以重跑绿消除这一条观察。其余点击阻断已核截图为其他节点浮层覆盖固定中心；脚本复用原_canvasHit选择可点击区域，不强制穿透。
- 候选安装包、原单镜/×3/首帧/批量实际执行组合、确认卡冷重启仍待后续系统证据。Windows和真实供应商均未验证；当前不报整体验收通过。

### 用户再次明确的原布局边界（2026-09-20）

用户明确拒绝 Agent 栏上方新增“当前文稿／当前方案／来源版本”。这次错误把内部目标绑定要求转换成了未经批准的可见布局。原请求目标继续由发送时快照和后端校验负责；撤回新增 CreationAgentTarget、两处挂载及仅显示用 pendingTarget/i18n。真实 Electron 位置红测已测出面板偏移 66.5px（/private/tmp/nomi-agent-header-red.log），修后须证明原面板与宿主顶部对齐并附用户可看的截图。展开／收起、创作／分镜及中英文均需核对，不以隐藏技术字段或换位置伪装保留。

本轮最新受控/真实证据：分镜12项实际 Electron检查已覆盖四Run真实Agent创建、原表选择/保存/落地/新进程恢复、原单镜及批量批准后各一次loopback请求和真实JPG解码、结果冷重启；付款确认卡真实关闭/冷重启/再申请草稿保持，images=0；Stop与完整文稿历史冷重启、轨迹入口分别通过。日志路径为 /private/tmp/nomi-electron-creation-execution2.log、nomi-electron-spend-current2.log、nomi-electron-stop-current.log、nomi-electron-history-current2.log、nomi-electron-trace-current2.log。它们均为开发构建+loopback，不能替代最终构建/安装包/真实供应商。

全contracts本次99项中95通过、3 advisory、1阻断（新执行测试误用固定超时）；固定超时已改回原 stationTimeout owner，单项重跑通过，不提高预算。随后因原布局撤回和T7新发现底dock遮挡，相关最终树证据须重验。

原基线×3抽屉接线缺失的证据已核对merge-base及shotVariants.ts“实验室优先/下一刀”注释。本次不自动补成新变体产品或接T3；保留原runner，真实页面×3不能宣称通过。首帧视频正式完整旅程仍未取得。

## 原左栏交互复核（用户再次指明既有 PR）

PR #808 纳入 08dfb2b4f（左栏收起）、7df9a18c3（英文布局）和 af61d73c9（控件让位）。以 `docs/design/2026-09-17-creation-left-column-drawer-a1.md` §8.1 为准：未设置偏好时分镜默认收起，手动偏好跨面与重启记住。实际验收脚本曾主动展开左栏后在 440px 编辑器上要求全控件可见，此要求不能替代获批布局；红日志保留为该状态证据，不据此扩大布局设计。本轮临时 640px 最小宽和横滚增量已撤回；生产仍复用原收起/展开及底栏参数降级策略。测试改为验证默认、手动收起/展开、内容保持和原支持宽度下实际点击。

## 后续设计待办（用户明确延后）

用户 2026-09-20 原话：「不过你也计入todo list吧 因为这个其实是权宜之计 我们之后改设计的时候再改吧」。已并入唯一 TODO 的 T-DS-01／A-2，保留 #808 收起让位方案作为当前行为。后续设计统一处理左右栏同时展开时分镜空间不足，不在本次简化 A＋T7 收尾中另造宽度策略或页面。


## 交付后的独立 PR 审查

用户 2026-09-20 明确要求：本轮完成后提交任务分支并创建 PR，交由另一位 AI 审查，再由用户明确决定合入。不得 merge、squash、auto-merge 或直接推默认分支。审查提示词见 [独立 PR 审查提示词](../audit/2026-09-20-core-a-pr-review-prompt.md)。仓库 Ponytail 与本轮跨池审查不能替代用户指定的这次外部审查。


## 用户要求的全差异回归审计（2026-09-20）

先冻结生产修改，增加一次性审计脚本 `scripts/audit-core-a-changes.mjs`。复用 `package-build-stamp.sourceIdentity` 快照全部 tracked/untracked 工作树，以真实 merge-base 对比，不遗漏未提交文件；不修改真实 Git index，不提交或合并。输出完整 diff、逐文件 hash/处置清单、原有测试改动与门禁/基线改动专项 diff。机械扫描只负责完整收集，不把删行或断言变动自动判成缺陷，也不把没有命中当作通过。

执行阶段复用 `tests/system/profiles.mjs` 的原 matrix/contracts/unit/build/Electron/canvas/performance/journeys 命令，按顺序执行并保留所有阶段结果。每阶段校验源树未漂移；构建失败后禁止启动旧产物冒充当前测试。失败不自动改源代码/基线/预算，报告必须保留失败。实时付费、安装包、Windows 和逐文件语义审查分别标明未由该脚本证明；不自动合并或宣称无回归。审计输出放仓库外临时目录，避免自身结果改变构建身份。

原行为审查逐项记录是否基线已有、本轮引入或证据不足；只有红测和调用链证明的问题才修。最终 PR 独立 AI 审查仍必需，不由脚本替代。


## 冻结审计后的修复批次（2026-09-20 05:06）

冻结身份：base `b06270627c099394881ca2f8c546d7c7facc5c3c`，HEAD `867ee22d187ff15b81ff55b6e5f373a7920f751c`，tree `03f56d4465f755f3f483bc9636c4bf9977712f6c`。334 文件／721 差异块逐处复核：695 correct、25 incorrect、1 uncertain；这些是差异块数，不是独立缺陷数。完整证据 `/private/tmp/nomi-core-a-every-change-frozen/semantic-audit.{json,md}`，原失败和生成产物漂移报告保留。

冻结全量结果：matrix、build通过；contracts有model-face旧shotKind快照、walkthrough旧shotKind夹具两项阻断；unit 13,820通过、1失败、3跳过，失败也是旧shotKind夹具；原smoke外卡滚动契约失败；canvas-full 12/14（未选中历史按钮、平移拖动态）；性能21场景通过；原journeys 2/2通过（含真实本地MP4导出）；real-user-journeys 7/7通过。后者均不证明真实收费供应商或最终候选包。

本批只修已证机制，复用原编辑器、runner、付款入口及布局。主代理负责派工与跨边界收货，不以子代理统计代替判断：

| 修复边界 | 原因／最小改动 | 回归要求 |
|---|---|---|
| 共享canvasDraggingFlag | 捕获的子元素blur被误当window失焦，调用栈已证取消新pan；只修事件作用域 | 子元素换焦点不取消、真window失焦仍取消，原手势测试不改断言 |
| 原历史打开与composer滚动 | 未选中按钮阻止冒泡又被selected闭包拒绝；外卡改scroll违反原固定底栏 | 原按钮显式选择并记录有效打开意图，失选仍关闭；恢复内部滚动／固定底栏，原smoke与card-stack验收 |
| 现有creation列表与Panel分页 | A保存／分页晚回包改变B列表或错误状态 | 明确读投影绑定和请求身份，不新增可编辑方案；跨项目／会话切换、卸载、晚失败与新请求红绿测试 |
| 原Run金额边界 | 先减余量消差、前缀裸累加，合法刚好到预算的金额被拒 | 复用budgetLedger精度边界，核完整累计负债；精确上限、真实超额、未知价、后续批次均验 |
| 原付款草稿恢复 | localStorage仅typeof校验，null／损坏结构穿透恢复 | 在恢复边界验证完整形状、不能带入上一quote草稿；正常草稿与部分提交恢复保持 |
| 原测试与活动文档 | 旧full-auto/无modal断言被删、shotKind夹具/快照和技能说明过期、测试否定oracle不独立 | 恢复既有断言，仅删非法fixture字段，独立检查gate scope；更新真实owner描述，不按旧文档重造已撤回流程 |

先补每类红测与共享边界合同，再实施；仅定向测试可并行，Electron/浏览器/性能/最终构建统一串行。所有施工受上述文件owner范围约束，遇到新机制先报证据，不趁机重构。既有半成品不作为通过项：真实付费旅程从已完成首镜继续，避免重复计费；最终包与Windows分别记状态。

按用户新增要求，审计方法进入现有 R14.3，编排手册只索引职责分层，CLAUDE摘要生成AGENTS；不新造另一套规则。确定性脚本／中等能力模型承担机械核查与低风险初审，高风险语义和最终收货由强审查者负责。修复全部收敛后重新冻结最终树，重新完整清点差异、复核修复与受影响链、按R22重验，最后才做R25／PR交付，不合并。回退只撤本批已定位增量，不整文件覆写或清空工作树。


### 修复收货补记（冻结审计之后）

- 付款草稿恢复：原 parser 拒绝 null/array/损坏嵌套但保留正常参数；恢复成功才发布 owner。42 项单测、19 项原宿主浏览器测试通过（`/private/tmp/nomi-final-spend-recovery-browser.log`）。Electron 原卡走查仍待最终构建。
- 原 composer：元素 blur 与窗口失焦区分、未选中历史按钮明确选择节点、恢复固定底栏外卡 overflow-hidden。4 文件 65 项定向回归通过（`/private/tmp/nomi-final-composer-regression-green.log`），未替代原 smoke/gesture/card-stack。
- 异步读身份初版 36 测通过后，独立复核追加 ACK 后再次滚动测试，暴露分页锚点覆盖（810 预期、410 实际）。红证据 `/private/tmp/nomi-pagination-ack-gap-red.log` 保留，继续在原 Panel 修复，不能以初版绿灯收货。
- 分镜技能按当前工具 schema 修正原文字：指定 Run 用 check_job；作者字段进入 storyboard；首帧保留原 modelKey/modelVendor/params；新建由宿主发 ID，随后按真实 ID 补选择性引用；不加落画布前置。原 native tool 测试执行创建/指定修改示例，4/4 通过（`/private/tmp/nomi-final-planner-runtime.log`）。
- 活动合同纠正 editorial 正本、不可变执行快照、提交后编辑、内容 CAS、PR #808 侧栏；历史审计明确标历史，不抹去原失败。
- 中等模型机械审查尝试返回 unsupported/404，未执行；本次机械清点由脚本完成，语义判断由现有审查者承担，不冒称跨模型验收。

### v2 冻结后的真实系统失败与追加收口

v2 HEAD `81020ceced424be6272049f9c1dc4793fac80d85`、tree `7fd43d9c34157ca31eb9db8986c9be5445d4470b`：345 文件/738 差异块静态复核完毕，所有阻断 contracts 与构建通过；这不等于系统验收通过。原报告 `/private/tmp/nomi-core-a-repaired-audit-v2/`、桌面收据 `/private/tmp/nomi-core-a-final-desktop-v2/receipt.json` 保留，不覆盖失败。

- 全量单测：1508 文件通过、1 文件失败；13864 项通过、1 项失败、3 项跳过。S06 最后两镜因 `fetch failed` 进入 `submission_unknown`。两次定点通过不能证明根因消失；不放宽断言、不改成安全重试，下一次全量采集受限 loopback 网络诊断。调查 `/private/tmp/nomi-s06-investigation.md`。
- 原 smoke 固定底栏初段通过，但关闭提示词菜单后参数条消失。真实事件探针 `/private/tmp/nomi-composer-escape-probe.log` 证明：菜单已开，焦点仍在触发按钮；Esc 到 document 冒泡前节点已经失选。原浮层隐藏定位使 autofocus 失败，document 冒泡监听晚于 React Flow 节点键盘处理。只在原 AnchoredPopover 修事件所有权；覆盖触发按钮、浮层控件、输入法与嵌套下拉，不禁用画布键盘、不通过重新选节点掩盖失败。
- 真实付费报告暴露陈旧工具回执：文稿草稿只保存，`draft_shots` 却告诉模型已落画布。在原 nextActionFor 和原动词说明纠正可证明的结果，保 operationId；实际 policy-started 结果复用原生成回执。不增加落画布副作用，也不改批准策略。
- C19 补原 canvas-shortcuts 的整组可见删除、一次真实撤销及文本焦点隔离；原 p4-s5 直接调用 store.undo 只能证明 store 边界，不能冒充键盘旅程。其余最终缺口按 `/private/tmp/nomi-final-remaining-matrix.md` 逐项核证，包括技能/附件队列组合、旧项目副本候选包及真实收费首帧。

此批完成后重新冻结和复审受影响差异、重新构建，旧 v2 收据只归属旧树。实际付费沿已有首图报告续跑，不重复生成已付费任务；原失败、旧未归因删除与 Windows 未验证均保留。所有确认问题必须修复并复验后才交 PR，不自动合并。

追加验收核对：C28 的恶意合成凭据冷重建已有原生测试 `tests/agent-runtime/lane-trace.test.mts` 中 `live credential echo stays redacted after deleting derived files and rebuilding without model credentials`，另有 `lane-trace-redaction.test.mts` 的原始转录不改写/UTF-16位置/恶意路径测试。最终执行原 SDK 套件归档此证据；普通 Electron Finder 走查不替代这些脱敏断言。CJ3 使用真实小文本文件、原技能菜单与单次 Enter；磁盘素材存在仅证明导入落盘，成功排队、请求原字节和原生输入身份共同证明消息准入，不冒充慢上传状态反馈验收。无需为测试读取 React 私有状态或增加生产测试桥。

### P5 工具体积契约核对（不是生产失败豁免）

全量原生测试实测 `draft_shots` schema 6689 字符、描述 131 字符，pi 原估算器共 1706 token，旧上限 1220，原失败保存在 `/private/tmp/nomi-core-a-v3-native-runtime.log`。两位独立审查者核对原作者字段及消费链：首帧配置、锚点身份/状态/机位、按槽引用及其元数据都有既有创作语义；UI 保存保真不能替代 Agent 可以写入。仅移除可丢视图标注也不足以回到旧上限；删除作者字段全部描述仍约 1339 且违反字段说明完整性。拆新工具、改成不透明 JSON、删字段或修改估算器均不采用。

本次自主收货裁决是明确记录已授权能力接入的成本，而不是改变产品范围：保持所有生产 schema、校验与工作流不变；原工具部分（结构化副本只去新增 storyboard 属性）继续守住 1220，完整工具单列实测 1706 上限，不额外留增长余量。P5 同时核对发布的作者子树与原 canonical author schema，包括全部嵌套校验，防止通过裁字段伪装变小。原生参数容错三组阳性/阴性对照保留；真实模型成功率另由原付费旅程测量，schema 尺寸通过不证明模型能正确用它。

这项总预算确实增加 486，PR 与审计报告必须明示；先前笼统的“无预算上调”不能继续作为本候选版的验收结论。其余门禁预算、警告上限、超时、付款和未知提交保护均不因本裁决改变。依据是 P5 探针本来用于让有意能力增长可见，且已有 2026-09-12 aspectRatio 有意增长的记账先例；不是把所有超限视为自动更新许可。

### v3 全量失败后的最终修补边界

保留 v3 静态树 `c54110a0873f108b4df3fa43d63af6e8b3ba8f63` 与失败日志；之后的改动需要新的树身份。S06 的请求 33 在发出后 1ms 内 ECONNRESET，服务端未收到；上一复用连接距响应 6.121s，命中本地 Node 5s keep-alive＋1s buffer。仅共享 spend-confirm 测试服务器明确 Connection: close；红测证明原连接可复用，绿测同时核响应头与连接更换。32 项受影响测试通过，生产未知提交／无自动重付保护未改。

原生测试同步真实 native entryId/history/retry 字段，先核原生日志身份再按 seq 归一；不删字段以凑快照。旧草稿回执断言改为已保存事实；L1 三次查询与一次取消补正式必需的 generation domain，非法缺 domain 拒绝仍保留。定向原 SDK 34/34、renderer 与收据 32/32；完整运行稍后归新树。

追加复核确认本轮新增 `patchStoryboardSubject` 漏了两条原行为：prompt 改写后旧范围仍可能合法但指错文字；durationSec 经工具映射成 parameters.duration 后没有回写编辑器的 durationSec，原投影会覆盖成旧时长。先各自红测，再在该原共享适配函数最小修补。原文未变或只改模型仍保范围，显式新范围优先；数值时长同步原作者字段，显式 storyboard.durationSec 沿用创建时优先级，锚点不混镜头字段，参数 map 保持原 replace 契约。三文件 25 项通过、类型修正后该文件 15/15，test-types／根因合同通过；这些不能替代最终 Electron。


### 最终审计发现收货与主线整合（2026-09-20）

- Stop/Continue 的“准入锁阻塞整轮”诊断已被原 `laneIpc.onAccepted` 与失败截图推翻；错误生产补丁已撤销。队列原按钮是“取消这条指令”，修测试定位后完整技能/附件排队、撤回恢复、重发保新输入及冷恢复通过（`/private/tmp/nomi-core-a-stop-correct-locator.log`）。
- 33 镜付款 scope 的错误 oracle 已纠正：画布 draft 已有 33 image + 1 shot_table，present 修改 included，prompt 在 candidate 内。原生成/关闭零写断言保留，完整 Electron 通过（`/private/tmp/nomi-core-a-spend-scope-v3.log`）。
- 原 smoke 长 contenteditable 中心不在可视滚动区；测试改为真实可见交集命中检查后鼠标点击，未 force、未改产品布局；17 assertions 通过（`/private/tmp/nomi-core-a-smoke-visible-editor.log`）。
- 全量 v5 的 S06 超时仍保留失败。CPU profile 证明原基线也存在反复解析完整 Run 事件历史的热点；本轮仅在原 repository 保留每次读盘并复用已验证 UTF-8 内容索引，变化、损坏及末行扩展均重新验证，返回对象独立。新类级红测、35 项邻接测试及48合同检查通过，S06 定点24.53秒→13.06秒；没有调整60秒上限。完整套件仍待最终集成树。
- 真实付费已生成两张图片、一张首帧及一个4秒视频，共1.8936 credits供应商回执，工具3/3、回合2/2；v7 后续媒体探测脚本错误保留，改为原 ffprobe owner 在测试 Node 进程只读校验并重启，不重付。最终通过收据另列。
- `git fetch origin` 已刷新到 `96d368c26`，当前18 ahead/17 behind。先保存完整施工快照及本地检查点，再逐hunk合并；保上游镜头/媒体唯一owner与本轮任务身份、保存、参数条语义。四处dirty冲突分别核对，不整文件选边。合并后重新验相关组合和全量门禁，PR不合并。


### 最终审计追加：参数滑块名称与 F15

T7 实测发现原共享数值控件将名称传到 Mantine 容器而非滑块。先以原 numeric-panel 夹具新增名称/键盘/范围与多参数、单数值参数面板红测，再在 ParameterControlBody 将 aria-label 改为框架 thumbLabel；保留值、布局与写入接口，不新增组件。原 Electron ArrowRight 写入失败独立调查，不拿名称修复冒充值恢复。F15 普通多镜落地的异步项目复验由原 owner 定点补红测核实，禁止标记关闭或新增落地服务。

### v8 真实整套验收追加修复

原 canvas full 为11/14，阻断为历史未选中直接打开、C19首次hydrate与磁盘比较、磁吸带固定168断言。历史以原hook生命周期effect修复，真实RF延迟投影红测后29项通过。C19首次hydrate允许原owner补frameBounds及非持久化媒体测量，保真实Undo全内容和持久化断言；磁吸沿原min(168,实际卡高+28)合同核值，不能为上游intrinsic aspect变更改生产。另真实Electron证明取消拖动后late mouseup会误保存（revision23→24）；非拖动位置仅接当前同步框架keyboard dispatch，RF继续决定键与移动，不重写算法；原canvasDragWriteback承接事务避免巨壳超800行。初次v8合同仅filesize阻断，旧失败保留。新构建后重跑这些旅程与整体画布，尚未完成。


### 最终宿主复验：参数 portal 的框架键盘边界

真实参数输入新增“所有节点位置不变”断言，发现duration改变时选中节点也移动5px。原外composer的nokey不覆盖document.body portal，但React事件仍回到NodeWrapper。同类原NomiSelect供应商按钮也缺此边界。按原InlineParameterBar表面根（inline/portal）和原NomiSelect.Dropdown补框架nokey；不改节点移动算法、参数值、付款权限或布局。真实RF原组件五路红测先行，原节点Arrow阳性及真实Electron旅程验修后结果，截图和完整差异账本再核。


### PR #828 EV-01：真实资源图补验

独立审查要求应用级资源失败，本轮在旧已测 build tree e96a8390 用 Electron session.webRequest 取消真实 NodeGenerationComposer chunk，截图证明整个工作台失败。Base 的 local lazy 被 resident 静态 import 绕过。最小修复是两生产宿主共用既有 local lazy 入口，删除静态旁路；canvas与付款卡保留各自 loading/error 几何，不改原组件、执行或写入owner。真实资源失败/原位重试与 native window minimize/focus 由 tests/ux/core-a-t7-recovery.e2e.mjs 补证，不以factory mock或dispatch blur替代。最终构建、双宿主恢复、原节点/草稿及零未授权提交仍须实测；应用没有 workspace readOnly 动态入口，该项不伪装为真实UI测试。

### PR #828 Golden 旅程对齐与表专有覆盖保留

旧Golden把文稿draft直接自动production落画布当作前提，与本次已批准“文稿方案保存后按原动作落地”冲突。默认旅程改为原划词建Run且零节点→原editor读完整字段→显式原放置三镜→原画布Agent只改第二镜/视口不变→原editor单镜确认→真实JPG及冷启不丢。原节点按storyboardDesignId/shotId归属，不要求凭空长production元数据；原materializer标题“镜头N”保持，Run模型信封标题另外逐字核保存/恢复。旧production表密度、行选择、表执行、视口和冷启阳性断言保留为同脚本`--production-table`，通过真实画布Agent无文稿目标入口建立原表；`test:golden`在原锁下串行跑两种，两者缺一不通过。只改测试及该命令，不为旧测试反改产品。
