# 第⑥刀设计卡 · 一次撤销只撤当前编辑面的那一步

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

设计线 `t8-r6-undo-plan`，源码基线 `6ed4c34b8`。本文供实现前拍板。建议共用一个会话历史契约，时间轴和导演台接 zundo，画布用 Immer 的正反补丁。白板沿用 Mantine。普查另发现剪辑面板布局有 20 步 undo-only 历史，建议在时间轴这刀一并接入路由，保留独立的撤销对象。一次 Ctrl+Z 的归属由输入面决定；用户在导演台摆好机位后切回画布，两个面的历史各有自己的寿命。[协调拍板](https://github.com/aqm857886159/Nomi/issues/1586#issuecomment-7103051778) · [白板与 React Flow 胶合沿用的原决定](https://github.com/aqm857886159/Nomi/issues/1586#issuecomment-7082205132)

### 功能分类

- [x] 花钱（已落地产物与 Run 事实的保护）
- [x] 长跑 / 可打断（运行中编辑、手势取消、Agent 提议）
- [x] Agent 行为
- [x] 大数据量 / 画布 / 长列表
- [x] 数据格式（既有快照、磁盘事件与回执的双向兼容）
- [x] 新增功能 / 性能（替换实现的性能验收）

## ★0 先查别人

| 出处 | 查到的行为 | 对本刀的决定 |
|---|---|---|
| 本机 `node_modules/immer/package.json` 11.1.8；`src/immer.ts:54,86,121`、`src/core/immerClass.ts:205`（均相对该包） | 启动时启用 patches；`produceWithPatches` 返回 next、forward、inverse，`applyPatches` 接受兼容的基底。路径是键数组，整根替换也合法，库不保证最小补丁。Map/Set 另需 `enableMapSet()`。 | 确认只在画布适配器初始化一次 `enablePatches()`。补丁空间用普通对象、稳定业务 ID 和显式顺序，禁把含方法的 Zustand store、RF 内核 Map、draft 或整节点事实作为编辑根。[Immer patches](https://immerjs.github.io/immer/patches/) |
| React Flow 的性能指南；本仓 `reactFlow/canvasDragWriteback.ts` | 移动会高频通知，订阅整张 nodes/edges 会放大渲染。现有节点拖动由内核持有，松手才提交位置。 | 确认保留 RF 胶合及未变节点、边和 data 的引用；中途取消回到权威坐标，手势提交才出补丁。不给 RF 内部选区、测量尺寸和 dragging 建历史。[React Flow performance](https://reactflow.dev/learn/advanced-use/performance) |
| zundo 2.3.0 发布 tarball 的 `dist/index.js`，peer Zustand `^4.3.0 || ^5.0.0`；本仓锁定直接使用 4.5.7，尚无 zundo | `partialize` 在 set 两端取得投影，`equality` 相等才跳过，`handleSet` 可包装记录函数。新步清 future，undo/redo 用 `userSet(nextState)` 做顶层合并。temporal 是独立可订阅的 store，`pause/resume` 本身不补记暂停期间的修改。 | 确认时间轴与导演台各绑定自己的编辑域；判等只去掉无变化，分组由手势首尾确定。禁止把残缺的嵌套 timeline/project 直接浅合并回主 store。按钮订阅 temporal 的可撤/可重做布尔值。[发布包](https://registry.npmjs.org/zundo/-/zundo-2.3.0.tgz) · [上游 API](https://github.com/charkour/zundo) |
| tldraw History | 手势可以 mark、squash 或 bail；远端写不录入，本地有 ignore 模式且可保留 redo。 | 确认运行进度/结果不占用户的一步，不冲掉 redo；取消拖拽不留可复活的半步。远端来源过滤本身处理不了 Nomi「撤创建时保住后来出图的容器」。[tldraw History](https://tldraw.dev/sdk-features/history) |
| Yjs UndoManager | 可按 scope 和 trackedOrigins 选择事务，stopCapturing 显式切断合并。 | 确认用动作层、来源和事务身份判定边界。两次不同用户动作再近也分开，一笔跨异步提议按其事务结束；无协同文档迁移需求。[Yjs UndoManager](https://docs.yjs.dev/api/undo-manager) |

出口： [tldraw bailToMark](https://tldraw.dev/sdk-features/history) · Esc 可丢弃进行中的交互并立刻继续编辑 · 支持取消的入口只处理当前手势；画布节点与组拖拽沿用松手提交的既有约定；Agent 整笔撤销遇同对象冲突沿用现有回执，保留后来编辑，用户可读当前状态后重新发起。没有新增锁或等待界面。

**依赖准入。** 只下载查验了 zundo 2.3.0 发布物，未安装。npm 清单解包大小 61,105 B，发布的 ESM 为 3,831 B，原文件 `gzip -nc` 为 1,028 B；用本仓 esbuild 0.27.7 单文件 minify 后为 1,391 B，gzip 为 537 B（未含 peer），均不等于 Nomi 安装包增量。PR A 依本仓 immer/Zustand 的 `devDependencies` 分类锁定该版本，由 renderer 构建打包，复用一个 Zustand 实例，无主进程运行时目录或原生文件。对同基线构建比较 renderer chunk gzip、asar 和安装包；建议库本身 gzip 增量 ≤2 KiB，包装层另列。跑 `pnpm run check:packaged-deps`、`pnpm run check:package-budget` 并用实际产物跑 `scripts/audit-package.mjs`。遵守 `docs/engineering/package-budget.json` 两平台既有预算和 5% 余量；若包身份或体积异常，先查重复引入，不以加 runtimeAllowlist 或抬预算放行。

## ★1 创作者要保住的结果

真实任务 A（有生成历史的作品）：①打开图片节点，记下主图、版本和 Run ID → ②改比例或提示词 → ③用真实生成入口出一张新图 → ④按 Ctrl/Cmd+Z → ⑤核对参数回退、刚出的图仍是主图、版本与账本完整 → ⑥重做并保存重开，再核一次。真实任务 B：将已有真实视频采纳到时间轴，连续 trim 后撤销；另一轮在拖动中按 Esc，核对原起止帧及导出使用的轨道。真实任务 C：在有运镜的 3D-BOX 中滚轮/键盘改机位，撤一次；让 Agent 改同一镜后手调，再点回执撤销，检查后改的镜头受到保护。白板做连续笔画→撤笔→完成→回到画布撤外层编辑。

| 目标 → 用户所见 | 主/质量/护栏指标与基线 | 实现验收量具 |
|---|---|---|
| 一次意图回退一次 → 编辑前后值可读 | 应撤的编辑成功率 100%，空手势/纯运行推送新增步比例 0%；基线现有用例见 ★9 | 真实手势 + `timelineUndo.test.ts`、`directorStore.test.ts`、`proposalTxn.property.test.ts` |
| 已交付的产物仍可用 → 预览、保存再打开都能读到同一版本 | 丢失落地的样本比例 0%，额外发起、重复扣费/回滚 Run 的比例 0%；旧案曾失败，当前单测绿 | `undoKeepsLandedResults.test.ts`、`productionCanvasHistorySignals.test.ts` + 在真实任务 A 比对资产、版本 ID 和 Run 事件 |
| 手势跟手、键盘留在活动面 → 一笔只走一个目标 | 跨面误撤比例 0%，100% 手势样本在 ★7 预算内 | `shortcutSurface.ts` 对应测试、双语桌面走查与 perf 场景 |

**★1b 连带界面。** 范围含画布快捷键、ClipNode 内嵌剪辑器的快捷键、多删/版本提示条、时间轴按钮和采纳 toast、导演台顶栏和快捷键、白板工具栏与编辑器键盘、Agent 工具卡。版本 toast 校验发出时的 head；Agent 卡校验同一工具调用、approvalId、actionHash 和目标。zh/en 沿用已有可用态、禁用态与冲突文案；文本输入、TipTap、遮住的面和 keep-alive 时间轴按各自主人的输入约定。拍板图不适用，本刀沿用现有元素。

**★1c 老用户。** 已保存的作品、模型、设置和熟悉的入口照常使用。画布和时间轴盘上存内容，导演台工程存在节点 meta，白板提交保存文档；这些快照不带会话的 past/future。盘上另有真实的画布事件和提案回执，逐项读法、读不全时的行为和退版证据见 ★4。无需批量改写工程、清缓存或为首次打开制造一条撤销步。

## ★2 全部门与唯一 owner

下表回答谁能“撤什么”；附录给出本次实际运行的 AST 门表，含每个文件的读/写符号。根为 `src,electron`，另以 `rg` 查属性赋值、字符串键位、菜单和第三方命令。源码路径下文简写的 `GC/` 为 `src/workbench/generationCanvas/`，`WB/` 为 `src/workbench/`。

| 家与寿命 | 写入、消费与现状 | 替换时的职责 |
|---|---|---|
| 画布实例/项目会话 | `GC/events/canvasUndoJournal.ts`：80 个 barrier，append-only 事件；push/pop、前缀投影、之后落地、同对象冲突、历史可达节点、淘汰通知与 generation 集于一处。写口散在 node/graph/group/frame、默认参数派生、导入/外写、提案、删素材；`GC/store/canvasDocumentCommit.ts` 真正提交 undo/redo。 | 仅会话前缀回放退役。统一提交口依旧独占整写，`CANVAS_ACTION_LAYERS` 的类型约束区分 edit/session/fact/document。键盘、菜单、toast、Agent 补偿后的本地一步都走同一历史端口。 |
| 工作台时间轴/项目 | `WB/workbenchStore.ts` 的 `pushTimelineUndo/captureTimelineUndo/undoTimeline/redoTimeline`、`timelineClipWritesSlice.ts`、`adoptionStorePorts.ts` 三处能动栈，30 步的常数还抄了两份。旧条目可以是 TimelineState 或带 agentMetadata 的 before-image。两处 TimelinePanel、Agent、采纳验证读取它。 | zundo 独占 past/future；共用一条提交门覆盖 store 内的剪切、音频、字幕等离散写口及 store 外 `setState` 的采纳。取消/验证失败同时还原内容和原栈。 |
| 预览面板布局/项目会话（协调清单以外实际命中） | `WB/preview/editingPanelLayoutSlice.ts:93,194,210,294` 另有 `editingPanelUndoStack`，上限 20、只撤不重做。预设/显隐等记录 `displayEditingPanelLayout`；`PreviewWorkspace.tsx:200` 在宿主活跃时另听 ⌘Z。只有布局进入项目 payload，历史按项目清零。 | 建议 A 将此栈也接公共端口的 layout scope，只有布局动作取得输入权时使用；在时间轴上 trim 或文本编辑后不得再透传到 layout。恢复经旧 `commitLayout/keepAfterLayoutChange`，守住面板让位、机器上 Nomi 栏开合与项目持久值的区分。 |
| 导演台/每次打开的 3D-BOX store | `GC/nodes/director/model/directorStore.ts:createDirectorStore`：工程快照 50 步，`saveState` 克隆/比较，`withHistory` 可嵌套且异常回退，滚轮滑动窗口 200 ms，`commitStep` 按字段组及外来写划分。顶栏和 hotkeys 使用同一 store。 | zundo 跟踪 `project`，工程内人为生成/删除的本地截图与视频句柄仍是编辑；选择、播放、录制进度、求值缓存归会话。`loadProject({keepView:true})` 亦清编辑历史，按新工程裁剪选区；跨实例禁止共享。 |
| 导演台计划修订/项目数据 | `nodes/director/agent/applyDirectorWrite.ts` 写 plan revision 与 compiledBase；`directorPreviewCapture.ts:applyPreviewCaptured` 检查 revision/源指纹。整笔撤回前 `flushEmbeddedEditors` 让尚未回写的手调进入冲突判定。 | 这两个版本号分别保证计划前置条件与预演归属。都不作为 zundo 游标。外部重载不得把旧预演贴回新修订。 |
| 白板/单个已挂载编辑器 | `GC/nodes/whiteboard/WhiteboardDrawingTool.tsx:129–150,553–560`：Mantine 8.3.18 `useStateHistory(0)` 存 revision ID；Map 存文档，保留至多 50 份，邻项还在 Map 才可回退。笔画/图层是内层，完成后的节点修改是外层。 | 保留 Mantine 和 Map；只对齐活动面命令与按钮谓词，以组件生命周期注销。第 51 份后按钮和快捷键一致。全局清历史不会改写已提交白板文档。 |
| Agent 批准/跨进程补偿 | `electron/capabilityCore/approvalReceipt.ts:createApprovalReceiptAuthority` 为有作用域的 HMAC 人工授权；`projectAgentProposalReceiptStore.ts` 为 project binding 下的持久 CAS，文件为 `.nomi/project-agent-proposal-receipt.json`。renderer 的 `GC/agent/proposalUndo.ts` 消费 committed before-image/补偿，倒序执行，失败/丢 ack 回读；键盘历史无权签发/消费授权。 | 保留 preparing→committed→undoing→undone 和恢复分支。UI 的 `runProposalUndo` 走 durable CAS；同步 `runProposalUndoByChangeId` 有自身现行冲突/去重判定。时间轴 `timelineCapabilityTarget.ts:undoPlan` 另验项目、顶条目、token/changeId、当前 revision 和写后 revision。禁止将“撤这笔”翻译为任意当前栈顶。 |
| 文本历史、定向恢复及同名入口 | TipTap/ProseMirror 与原生输入框拥有文本历史；`creation/storyboard/shotRow/promptHistoryCarry.ts` 跨虚拟行挂载带回文本历史；`StoryboardPlanEditor.tsx`/`storyboardDeleteUndo.ts` 反向插回特定分镜及关联对象。文档/方案删除、CategoryTree 复制、提示词/技能源库删除、采纳与版本条用一次性回调或回执。图像版本/文本改写结果、Run 历史、Agent 聊天记录均有独立业务身份。另核 `nodes/localStepRedo.ts` 是重试导入/取帧/裁切，`fixation/freezeAnchor.ts:undoAnchorLook` 是解除定妆并通过画布更新节点。 | 前四个本地编辑面之外，这些入口继续恢复明确对象或调用所属编辑面。保留 prompt/skill 的 `user-restore`/导出包语义及失效保护。 |

**共享契约（拟建 `src/workbench/history/historyMiddleware.ts`）。** 按 store 实例绑定 `projectId + generation + surface`；显式 `begin / commit / cancel` 记用户意图，`undo / redo / clear / subscribe` 是消费者唯一的历史命令和可用态。策略表规定现有容量（画布 80、轴 30、布局 20 且不提供 redo、导演 50；白板沿用本地 50），只合并同一活手势或导演同一滚轮序列。Zustand temporal 已有的历史容器不再复制。画布侧使用有界双端队列存正反 patches（Immer 负责产生、应用，不提供历史容器）。`shortcutSurfaceMayHandle` 仍裁决宿主、最后指针、模态；白板/导演台内层优先，文本编辑优先。按键命令仅消费一次，支持各面既有组合（如画布 Ctrl+Y）；显式菜单/按钮投给其宿主，版本提示条还须校验 token。无全局按时间拼接的作品历史。

**同宿主的两种撤销目标。** 现有布局监听只看 preview 宿主和 meta+z，有机会与时间轴监听认领同一事件。A 在活动输入面上分发一次：布局的面板拖柄/显隐/预设明确认领 layout，片段/轨道认领 timeline，焦点在编辑器则留给编辑器。两者都可撤时仍只调用获权的一方，包括 Shift+Z，不依赖监听注册顺序。布局适配器可用单独的 zundo vanilla 实例只保存布局历史帧（begin 对齐当前显示布局，commit 写入 after，撤销经旧领域函数写回），业务读写始终取既有 layout owner。不能在同一个 workbench StoreApi 上叠两次 temporal 覆盖同一 `.temporal` 属性。布局没有 redo 命令，已撤步的 future 可释放；加载/切项目清空两者。

**两种后端的提交算法。**

1. **时间轴/导演台。** 在现有 store 的 `temporal` 外侧接领域恢复写口，`partialize` 返回可由顶层 set 的 `{timeline}` / `{project}`，结构共享；`equality` 做引用/内容域浅判等。时间轴以 `timelineKernel.ts:timelineContentOf` 忽略仅缩放/播放头的变更作为**录步信号**，还原旧步时保持旧合同的完整 TimelineState（原实现也放回当时的 playheadFrame/scale）。播放停止、失效的媒体/文本选择裁剪、persistRevision bump 一次；导演撤销沿用 commitProject 的派生校正，清 evaluatedPoses。undo/redo 时由外层域 setter 在发布前一起构造后态，订阅者不读半帧。临时选区、动作函数和过期录制进度不会由 temporal 恢复。`WB/workbenchStore.ts` 已用 `subscribeWithSelector`；保留现有 selector 订阅签名，单测覆盖 action 内的 set 及 `workbenchAdoptionPorts` 的外部 setState。
2. **录步时机。** 只在原有可撤动作/显式手势录。取景实时预览 `setTimelineClipFraming` 本来不独立压栈，音频与 trim 各按实际动作捕获；不能把每个 set 或 persistRevision 当作编辑。用公开 `handleSet(save)` 在事务中保存第一份 before 和最新 after，结束同步调一次 save；离散提交立即录，空变更直接释放。拖动临时态可即时渲染，禁止延时器在切项目后补写。嵌套沿用外层，取消仅恢复自己捕获的基线并丢弃待录步；没有首动时绝不弹上一步。滚轮首帧捕获、同域同键 200 ms 内合并，切对象/字段、外来写、undo 或卸载划界。时间轴采纳/Agent 的验证事务保留先前 past/future 的浅拷贝作短期回滚（zundo pop 会 splice），成功即释放；entry 身份关联 Agent metadata，不按相等的时间轴内容认人。原语中普通 redo 回填的是裸条目，不凭 redo 重新授权旧 token。保留签名重放及同 planId 异参拒绝。
3. **画布。** 从显式动作边界产生 ID 定位的编辑片段（节点、边、组及各自顺序）；在被触及的对象上用 `produceWithPatches`，提交 forward/inverse、目标方向的事实水位、创建/删除 ID、事务/项目身份和显式 ProductionCanvasHistoryIntent。重做按正序，撤销按**事务子修改逆序**应用各自 inverse。不得对混着结果的整 store 取补丁再按路径黑名单过滤：父对象 replace、数组下标移动、角色相同的 contentJson 都能穿透。适配器按编辑操作先投影，再同时校验正反两边的路径/值；写入规则新增字段时须在动作分层表里声明来源。新增/删除用稳定 ID 和相邻顺序锚点，检查对象身份；RF 的 nodes/edges 仍是数组投影，未动元素引用原样复用。内核拖动只在 stop 提交，方向键、分组拖动、Alt 复制、同事务默认参数/派生边用同样边界。打断和 no-op 不冲 redo。
4. **事实在读时合回。** 唯一领域判据沿用 `electron/shared/canvas/landedNodeFields.ts`：运行态为 `runs/status/error/progress`；落地涉及 `result/history/resultVersionMax/contentJson` 和主媒体尺寸 meta。需求中的 generationStatus/landedOutputs 是概念称呼。事实经 `GC/store/canvasRunActions.ts` 与 `nodeRunOutcome.ts` 到达；在原写口按节点及单调序号索引真实 outcome，能由任一方向到达的最老水位决定保留区间。撤销提示词/位置无需倒写结果。对可编辑的**同字段**（手动设主图、删版本、裁剪/白板新版本、文本），记录用户的选择/版本 ID 或编辑前后值；恢复时先还原该次编辑，再由 `canvasDocumentCommit.ts` 用现有 `reapplyLandedOutcomes/withLiveRunState` 按序合入目标水位以后的落地，重复 ID 幂等。删除前已有结果用被删节点的不可变恢复材料；删除期间来的事实归 `heldNodeOutcomes`，节点回来才接一次。撤“创建”遇后来实际落过图/文本的节点保留该容器，解除已撤组，其余兄弟、边照撤；重做显式删除仍能删。只有进度更新不触发保留创建。若因定案 B 已保留该 ID，redo 创建按 ID 复用它，防止复制一个装着同一结果的节点。Run/作业账本仍由主进程写，回放绝不重新提交、取消、退款或覆盖它。
5. **日志退役后的消费者。** 事务 begin/end/abort 用同代次单调步 ID 代替数组下标；并发提案沿用 `ownPendingCanvasWrite/interruptPendingCanvasWrite`。从写口给 changeId 保存 touched IDs、事务、后续写来源和类型，保留 `findCanvasChange` 对运行态 vs 编辑冲突、整图恢复以及两种 Agent 入口的不同现有判定。针对持久回执失去会话证据时仍走原回读和 before-image 校验，不能把清空的本地栈当作授权。冲突证据的寿命至少覆盖当前有效回执；不能因第 81 次编辑淘汰 UI 步而误认目标无人再改。版本 toast 的 head 随任何有效写（含异步落地）失效。每个可达步显式索引其前后能恢复的资产引用（含仅在**未改**节点里的引用，沿用基底集合加增量，不只扫变动 payload），给 `assets/deleteAssetResult.ts` 返回最近可达位置；淘汰、截 redo、关闭项目按代次通知 `pendingAssetDeletions.ts`，再检查活引用才可回收。按最老可达水位压缩 outcome 索引并保留缺席节点的 held 事实。撤/重做带原来的 detach/reattach 意图，按项目校验，经 `canvasTimelineBridge.ts` 对齐片段；不从“节点消失”推断要取消 Run。磁盘订阅仍收到能独立恢复的 post-state 事件。

## ★3 历史决定与三条路

| 路 | 收益与代价 | 取舍 |
|---|---|---|
| 沿用前缀日志，优化 coalesce/缓存 | 保住现有粒度，仍需投影整段和扫描随后的落地，淘汰还要折叠 base，另两套自写栈依旧各自实现。 | 保留其领域合同和磁盘 reducer，换掉本地回放。 |
| 共用会话命令，画布 Immer，时间轴/导演 zundo | 直接替掉三个自写通用机制；能分别保住“付费节点留下”和 Agent 指定回执。代价在画布步的事实/引用索引以及各面的事务切口。 | 推荐，分 A/B/C 实施。 |
| 删除领域历史，只留原生编辑器或一个整图快照栈 | 省存储/代码，但拖动、剪辑、导演场景无法各自还原，恢复整图会覆盖后来结果，单独撤一笔 Agent 也失去对象身份。 | 和已拍板的可见行为冲突。 |

`self-written.json#canvas-undo-journal-write-boundary` 是 under-review，复查日 2026-12-06。10-04 的统一 changeId、10-07 定案 B 与“整写取活事实”仍有效。09-08 barrier 漏边/锁定、09-07 导演键盘/色板/Esc、10-11 删节点连带时间轴、10-24 提示词完整恢复和持久回执丢 ack 是不同的回归入口。实现 C 同提交更新登记与 `concept-owners/canvas.undo-restore.json`，去掉已替换的通用日志，列明存活的领域规则与测例；不删除写边界的分层表。[整写方向复盘](2026-10-07-canvas-landing-direction-check.md) · [已落地结果的选项 B](2026-10-07-undo-keeps-landed-results.md) · [已有 changeId 合同](../fixes/2026-10-04-unified-undo.root-cause.json) · [落地根因合同](../fixes/2026-10-07-undo-keeps-landed-results.root-cause.json)

## ★4 全状态及盘上兼容

| 状态 | 用户结果 / 下一步 |
|---|---|
| 空、首次打开 | 当前工程可编辑，撤销/重做不可用。首笔编辑后只退回打开时已恢复的内容。 |
| 加载 | `restoreWorkbenchProjectPayload` 先装快照；`replayCanvasEventTailAndSealGenesis` 守 hydration epoch，先应用可信尾巴再封 genesis。就绪后才接受该项目的新编辑。 |
| 成功、部分成功 | 成功时一个命令移动一步；同时出现“节点有落地 + 同批空兄弟”，留下有结果的一项，其余照撤。无需再生成。 |
| 失败、取消中 | 指定回执冲突展示现有原因，用户读当前镜头继续手调/重新提案；未完成的本地手势取消回到原内容，旧 Run 的取消/失败态仍由任务页反映。 |
| 过期、能力不可用 | 换项目、另一次调用或后续写使旧回执/提示失效；使用当前项目实际可用的编辑命令。离线可撤本地编辑；主进程不可达时持久提案先保留原回执，恢复连接后读同一 operationId，再决定能否重试。 |
| 最大规模、最长文案 | 600 节点、80 个画布步、多版本大文本见 ★7；长镜头名/冲突原因用原 zh/en 回执组件，最小窗口核可读、可返回。 |

**磁盘的两条链。** `.nomi/project.json` 的 payload 含 `generationCanvas` 和可选 `generationCanvasLastSeq`；`electron/events/eventLogRepository.ts:appendEvents/readEvents` 管 `.nomi/events/log-<seg>.jsonl` 及大字段 sidecar。现有逻辑只在 seq 存在且 >0 时读其后事件，筛 canvas.*、还原 sidecar、幂等重放，再发 `canvas.snapshot.restored`。旧项目缺 seq 或为 0 以现存快照起步，不能从头扫日志覆盖它。保留 reducer 的旧事件/镜号回填、保存 seq、事件顺序和既有错误路径（撕裂末行、读失败沿用可读快照；损坏或从未写盘的字节无法凭空恢复）。`GC/events/canvasUndoJournal.ts` 中的 base/barriers/records 都是模块内存，项目 release 与 restore 使其换代。C 在尾巴收敛**之后**建立新会话空历史，首撤回到含尾巴的状态。patches/zundo、项目代次和历史 watermark 一律不进项目文件，沿用原 pendingAssetDeletions 与独立提案 receipt 格式。

**upgrade-path 考古证据。** 仓中 `tests/fixtures/old-user-data/projects/v0.24.1-pending-asset/project/.nomi/project.json` 为正式包退出产物，seq=4、1 个节点；`v0.24.1-storyboard` 实际为 0；`v0.20.0-library` 还有缺字段样本。在隔离目录取 `git archive v0.24.1 electron src`，对正式样本用该 tag 的 `appendEvents` 写 5 条位置事件，当前 `readEvents(project,{fromSeq:4})` 只得 #5；两版 `replayCanvasEvents` 的整个 nodes/edges/groups 深相等，重复应用 #5 仍相等；当前 append #6 post-state 后清旧读者内存，再用旧版读回 #6，整投影相等。此实验用真正的旧版写/读代码和新造的尾巴，未把它冒称客户崩溃现场。实现 PR 还须用这些**副本**完成下述桌面升级、保存、退版检查；无人为迁移，原项目与备份可由旧版照常读。

## ★5 中途表

每格依次给出可见结果、对运行的影响和查证位置。这里“原 Run”指已发起任务的花费/结算继续归原账本，本地历史命令没有再次发起请求的能力。“工程”指重新打开后实际保存或尾部恢复出的内容。

| 正在做什么 | 停/Esc | 关窗 | 断网 | 重启 | 连点/重试 |
|---|---|---|---|---|---|
| 画布节点与组拖拽 | 拖拽期间忽略 Escape；松手提交一次位移，可用 Undo 恢复起点；查坐标、revision 和历史 | 沿用宿主的结束规则；查工程 | 本地手势仍可结束；查坐标 | 装入工程，历史重新开始 | 一次 Undo 恢复起点；查坐标和历史 |
| trim、画笔、滚轮 | 当前可取消手势回到起点，独立编辑仍在；本地，查活动面 | 宿主结束/取消手势，保存已提交内容；本地，查工程 | 手势仍可结束；本地，查当前坐标/帧/笔画 | 装入工程，历史重新开始；本地，查工程 | 每个结束的手势最多一步，第二次 Undo 作用于上一笔；本地，查可见值 |
| 已提交编辑，同时运行在途或刚落地 | 撤编辑；停止生成仍用任务原入口，查原 Run | 按原保存/恢复协议，查工程及原 Run | 离线可撤；尚未返回的请求状态以原 Run 查证，不能写成失败 | 尾巴后再建空栈，查节点/原 Run | Undo/Redo 均保版本与运行身份，查原 Run 与版本列表 |
| Agent preparing/committed/undoing | 原事务协调器仲裁、必要时补偿，查绑定回执；原 Run | 重开后由回执状态决定恢复，查 operationId；原 Run | IPC/连接不可确认时回读再裁决，查回执；原 Run | 同项目读持久 receipt，不复活本地栈，查绑定/版本；原 Run | 同 operationId 幂等；过期/不同目标不给别的调用代撤，查回执与工程；原 Run |
| 项目切换、待删资产 | 切换未生效前仍由原代次负责；本地，查项目文件 | 已登记待删跟项目保存，回收仍由资产 owner 负责；本地，查待删清单 | 本地检查可达与活引用；查文件/清单 | 读原项目 persisted pending，按原来源/活引用判定；本地，查实际文件 | 旧 promise/淘汰回调仅对发起项目有效；本地，查 A/B 两边 |

### PR 6C 的 CI 回归修正

创作者要在拖拽过程中按下 Escape 后仍能松手完成位移，并用一次 Undo 回到起点。已有浏览器契约由 selection-drag-lifecycle.test.mjs 守住。CI 45281591359 同时发现行为回归和租约与快捷键路由之间的静态循环。租约与快捷键路由的职责以 canvas.gesture-lifetime 的登记为准。door-map 找到七个租约生产入口，其中独立节点、React Flow 节点和组框共用租约。

保留 Escape 取消并拆依赖仍会改变手势约定；把取消移到各调用者会增加另一套事件所有权。删除新增的键盘接线，恢复租约边界。最早应拦在实现线验收，特征测试曾把 Escape 取消误写成验收成功，已有浏览器用例和静态边界门岗到 CI 才给出相反结果。

6C 保留三项修复。Immer 正反补丁替换 canvasUndoJournal.ts 的日志前缀重放。截断 redo 与容量淘汰共用回收通知。缩放移动时更新预览，松手提交一次，回到原点时保留原 redo。已落地付费事实继续由 landedNodeFields 保留，磁盘格式沿用既有契约。

验收用 check-boundaries.mjs 检查静态环，用浏览器组拖拽与 React Flow 节点特征测试检查 Escape 后松手的位移、单步提交和一次 Undo。空操作、取消拖拽、提前或重复写入都会失败。容量淘汰和 redo 截断分别验证回收通知；缩放提交和原点往返分别验证写入与零步；十次 Undo 验证已落地付费事实。合并保留主线的 525 行冻结上限，节点外壳直接读取预览坐标与尺寸以保持在预算内。原 Escape 取消桌面记录属于修正前版本，修正后的独立桌面验收待接手。合同复查日为 2026-12-24，量具为上述两条 CI 回归用例及静态边界门岗，任一再红即重开。

## ★6 外部数据与失败

| 边界/规范 | Nomi 的读法 | 失败后创作者能做什么 |
|---|---|---|
| RF 坐标，浏览器键盘/指针 | 核对目标 ID、gesture lease 和活动宿主；旧 pointerup、blur、模态、输入法和焦点切换不能变成另一面的一步。[React Flow](https://reactflow.dev/learn/advanced-use/performance) | 维持最后有效提交，返回活动面重做手势。 |
| 快照、事件与持久资产 | `project/workbenchProjectSession.ts`、`electron/events/eventLogRepository.ts` 和资产 owner 读旧字段、重复 seq 后态、sidecar 与待删记录。payload 的二进制资产只经句柄引用。 | 保存副本后可重开原工程/已有备份。失败或资料缺失沿用现行恢复行为，不用空图覆盖一份可读工程。 |
| Run 完成、错误、进度、文本定稿、外部 MCP 整图 | 只接受绑定项目/节点/运行的领域写口；MCP 用 `externalCanvasWrite` 三方合并，候补结果归 held；历史层不调用供应商 API。[画布事实合同](../engineering/concept-owners/canvas.undo-restore.json) | 失败态与下一步由任务面显示；重试仍使用任务原入口，Ctrl+Z 可独立还原编辑。 |
| 提案/批准数据 | 遵守 `electron/shared/projectAgentProposalReceipt.ts` 的形状、绑定、revision 与 lifecycle；`approvalReceipt.ts` 校验授权。当前 `changeId` 与 legacy undoToken 均沿原解析器。 | 错项目、旧 token、错误 actionHash、过期 revision 或同对象后改返回原有冲突/不可用；保住内容，重新读取当前镜头或建立新提案。 |

## ★7 性能预算与证据口径

目标是 60 Hz 手势流畅度。单帧目标 16.7 ms；按仓库门槛帧间隔 p95 ≤33 ms、交互期间 >50 ms 长任务为 0。点击/快捷键到可见反馈通常 ≤100 ms、p95 ≤150 ms；100 节点打开到可操作 ≤1 s。帧预算通过不等于所有帧都达 60 fps。沿用 [性能规范](../engineering/perf-scenarios.md)，以下基线均注明量的是哪种操作。

| 操作、规模 | 当前证据（median/p95，ms） | 实现时的量具与新增判据 |
|---|---|---|
| RF 多选约 20 个拖动；150/200/600 节点 | `canvas-drag-20-nodes` I150：9.3/9.7，5 轮；`canvas-drag-20-nodes-600` I600 是 pending，选择框挡住了量具 | `tests/perf/canvas-scale-bench.mjs` 扩为 I200，同跑原 I150/I600；I600 必须先量到实际拖动。各 5 轮，pointermove 新历史数 0、松手 1 步，单节点及 20 选均核未触及对象引用。 |
| 连续涂抹 2 s；连续 trim 2 s，24/200 片段 | `inline-whiteboard-drag` 为移动图片 9.6/9.6（有噪声）；`timeline-scrub` 为 24 片段拖播放头 18.3/25.1。均未测笔刷或 trim | 在现有 `tests/ux/whiteboard-refactor.walk.mjs` 和 canvas-scale-bench 补 `whiteboard-stroke-history`、`timeline-trim-history` 场景；读笔画数/起止帧、撤销和 Esc，要求上述帧与长任务预算。 |
| 导演台同字段 2 s 滚轮/连续滑条、快速切两字段，50 步满容量 | 尚无直接基线 | 扩同一桌面量具，拟登记 `director-gesture-history`；60 Hz 预算；首帧至最后一帧一笔，不对工程逐帧 stringify/深拷贝。 |
| 200/600 节点、约 20 个一起移动、80 步满，Undo/Redo 后继续拖；并发落地 | 下面的纯运算微测，仅比较随事件长度变化的部分 | 拟登记 `canvas-undo-landed-200`，复用 canvas-scale-bench 并加 I600；每方向各采 80 次，报告输入→下一次绘制、history 字节、事件访问数、长任务、堆保留量。另跑 `canvas-run-outcome-projection-200x20`、`project-open-100-nodes`。 |

**复杂度与大小。** 旧 `restoreTo` 调 `replayTo + landingsAfter + nodeIdsSeenBefore`。H 条历史事件的 1 次移动投影还可能 map 全部 V 节点。新栈取一步随 H 为 O(1)；应用 K 条正/反补丁、复制被改容器、物化 RF 数组、合并受影响节点的 L 条后续落地及派生提交仍有成本，典型 O(K + V + L)，不是整次撤销绝对 O(1)。磁盘 post-state 发射/深拷贝、跨轴对齐也计入桌面耗时。验收要证明 H 取 20/200/1600 时一步仍只读本步 patches 和相关事实，无关历史前缀访问数恒 0。

基线微测于本分支 Node 22.23.5：200 个 ID、零边、1 个图片节点连续移动，分别调用当前真实 `replayCanvasEvents(events,base)` 与 11.1.8 的 `applyPatches(next,inverse)` 恢复同一 x；后者用 keyed record，前者用生产数组。各预热 20 次、测 100 次，p95（ms）为 **H=20：0.066 / 0.040；200：0.680 / 0.031；1600：2.326 / 0.027**。最后一次编辑的正反 JSON 共 119/121/123 B。两侧都校验坐标；不含事实合回、落盘或绘制，不据此承诺桌面加速倍数。

初定体积预算按 UTF-8 序列化正反 patches 之和计：单节点移动 ≤1 KiB；20 选移动 ≤8 KiB/步；80 个这样的步 ≤640 KiB。字节统计在量具中做，不在 pointermove 上 stringify。批量删除 200 节点/含长文、图像句柄的剪贴事务另单列：普通控制补丁建议 ≤64 KiB/步，大对象用按 ID 共享的不可变恢复材料，**连同材料**报告 retained bytes；不得靠切断一笔、丢文本/版本或提前回收资产来过预算。预算是合并判据，超出先改表示、再测；换代/淘汰后无已失效会话引用。实现 A/B/C 各自提交涉及场景的五轮原始报告、机器、median/p95，不用替代场景或上述微测签收。

## ★8 真实条件

本轮核过已装依赖、包发布物、旧版真实工程与磁盘 reader/writer，跑过 ★9 基线。Windows / 英文和中文桌面 / 最小窗口 / 实际 200–600 节点手势 / 干净安装 / 真付费 / 全程键盘均为 **unverified（新实现尚不存在）**。实施线须走真实任务 A–C：在隔离的发布版工程副本做旧→新→旧，在 Windows 与 macOS 核对 Ctrl/Cmd 归属，zh/en 各保留读过的前后截图，真规模用桌面量具采帧。付费先演练，用含实现标记 `undo-keeps-landed-results` 的专用工作树只跑一次，记录 runId、版本 ID、assetId 与前后项目绑定；本轮没有发生生成费用。

## ★9 分刀、目标测试与回滚

**拆成三笔实现 PR。** A 先给可执行契约并替换时间轴及同宿主的布局栈；B、C 在 A 接口稳定后可并行，分别移植导演台和画布。无需等画布通过才交付时间轴；三刀完全无依赖并不成立。每刀旧实现和对应消费者同一提交切换，无双写/影子第二栈。

| PR | 老实现删除点与保留点 | 独立交付条件 |
|---|---|---|
| A · 公共契约 + 时间轴 zundo | 新 `WB/history/historyMiddleware.ts`；删除 `workbenchStore.ts` 的 pushTimelineUndo、栈字段/数组读写和 `adoptionStorePorts.ts` 的另一份 30 与栈运算，替换 `timelineClipWritesSlice.ts` 的手工 pop。`timelineUndoHistory.ts` 中裸快照/包装条目及解包函数随最后消费者一起删，仍在用的 metadata 类型迁到时间轴适配器。改 `workbenchStoreLifetime.ts`、`workbenchProjectContent.ts` 的会话边界、TimelinePanel/receipt 订阅与 capability target；当前 API 名可作命令路由。布局同提交删 `editingPanelUndoStack/pushUndo` 和 `PreviewWorkspace` 单独认领 ⌘Z 的分支，保留布局写口。 | trim/取消/no-op、采纳失败两栈回滚、同 plan 幂等、旧 token 和 ABA/跨项目拒绝、30 步及布局 20 步边界，布局与片段各有未撤动作时只动选中的面（`editingPanelKeep.test.ts`、`agentDockPersistence.test.ts` 与真键盘）；包审计、时间轴实测。回滚 A 用 revert A，若 B/C 已落先撤依赖方。 |
| B · 导演台 zundo | 在 `createDirectorStore` 挂 temporal；同提交删 HistoryEntry、两个数组、clone/stringify 判历史、手工 push/pop/wheel 栈操作；保留 `commitProject` 结构共享、工程导出克隆、场景派生与具名手势。更新 `panels/topbar/shellChrome.tsx` / `useDirectorHotkeys.ts`，不动 plan revision 协议。 | 一笔机位/两字段/嵌套抛错/200 ms 连续滚轮/打开两节点/同节点 reload keepView/50 步边界；真实工程导出再开。可单独 revert B。 |
| C · 画布 Immer | 同提交**删除** `GC/events/canvasUndoJournal.ts`（本基线 wc -l 为 291，协调记录约 292 行）及 emitter 的 appendToUndoJournal，替换所有 barrier/紧凑化/前缀重放调用；迁移事务、回执冲突、资产可达性、生产信号、head token、release/hydrate。`canvasEventReducer.ts:replayCanvasEvents`、`canvasEventEmitter.ts` 的磁盘发射、`canvasWriteBoundary.ts`、`canvasDocumentCommit.ts`、Run/receipt owner 均有独立消费者。白板只验证已有行为。 | ★4 双向磁盘验收、★7 画布预算、下表产物/回执/资源矩阵均过后才替换。不改盘上格式，独立 revert C 即可由旧版打开新保存的作品。 |

**独立验收清单。** 实现线先做，另一条验收线在各 PR 的 `## 独立验收` 回填报告链接、实现/验收 SHA、双语实操和反例逐行结果。当前是设计卡，尚无实现收据。公共判据同时断言“编辑确实回退”和“此刻仍应保留的事实完整”；分别注入 no-op、阻断所有编辑、直接恢复整幅旧节点三种变异，目标测试都应报红。

| 入口 × 输入/反例 | 从真正使用结果的一侧判定 | 回归入口（现有测试文件按名可定位） |
|---|---|---|
| 画布参数/提示词、移动、连线、删他节点，之后图片/视频、找回、文本定稿/选区改写等异步落地；先撤再落地再重做 | 修改确实撤回，主图 URL/assetId、唯一版本、尺寸和文本完整；运行中、失败、完成的 runId/status/进度不倒走。比对 Run 事件无第二次提交/回扣。手动删版本/设主图或本地裁剪仍能撤，后来产物仍在。 | `undoKeepsLandedResults.test.ts`、`wholeWriteKeepsFacts.test.ts`、`externalCanvasWriteKeepsLanded.test.ts`；真窗口任务 A |
| 手建/Agent 批建/复制组 × 有无付费落地，节点缺席时晚到；显式删后重做 | 有结果的容器留下且无悬空组/边，未落地兄弟能撤；撤显式删带回原版本与 held 一次，重做显式删仍生效。时间轴恢复对应 clip；Production detach/reattach 信号只随原意图与项目。 | `deletedNodeArrivingOutcome.test.ts`、`productionCanvasHistorySignals.test.ts`、`storyboardDeleteUndoClips.test.ts`、`tests/ux/p4-s5-canvas-landing.e2e.mjs` |
| 连续首动/松手、零位移、Esc、blur、模态、Alt 复制、群组、键盘、嵌套与字段切换 | 满 200+ 节点仍一步；连续两笔各退一次。画布节点与组按 Escape 后仍在松手提交一次，缩放回原点保留 redo；支持取消的入口取消后 redo 不会复活半截或抹去无关编辑。导演台播放/预览仍合法；白板第 51 次及分支重做在内层停止。 | `timelineGesture.test.ts`、`timelineUndo.test.ts`、`directorStore.test.ts`、`tests/ux/whiteboard-refactor.walk.mjs` + ★7 |
| Agent 说“撤这笔”、工具/卡/回执/直接 changeId；提案中途被接管、丢 ack、旧 binding、同对象后改、其他对象后改、嵌入导演未 flush | 原判据允许时只撤指定对象，拒绝时当前画面不动，不泄漏半批；重启仅恢复合法持久回执；时间轴授权必须同时对上顶条与当前 revision。采纳验证失败不得留幽灵步或吞旧 redo。 | `proposalTxn.property.test.ts`、`proposalUndo.test.ts`、`proposalUndoReceiptLifecycle.test.ts`、`proposalUndo.embeddedEditor.test.ts`、`timelineCapabilityTarget.test.ts`、`laneReceiptUndo.test.ts` |
| 资产只在可达历史、同时被别处引用、80→81 步淘汰、redo 分支被截、A→B→A、旧回调晚到 | 能撤时文件可打开；不可达后由资产 owner 复查；另有分镜/素材/轨道引用就不回收。B 的 undo/redo 均不碰 A 或 A 的 Run。 | `deleteAssetResult.realStore.test.ts`、`assetDeletionMatrix.test.ts`、`assetLivenessScan.test.ts`、`tests/ux/asset-liveness-storyboard-ref.walk.mjs` |
| 正式旧工程缺 seq/seq=0、正 seq + 尾巴、重复/撕裂末行、含 sidecar、hydrate IPC 中途换项目、退版 | 校验节点/边/组、镜号、顺序、版本、工程 meta、文件、待删项和 receipt；第一步编辑撤回打开态。旧读者可读新保存与旧回执，磁盘无新增历史格式。 | ★4 的正式样本；`workbenchProjectSession.hydration.test.ts`、`shotNumberingLegacyReplay.test.ts`、`canvasEventReplay.property.test.ts`、`eventLogRepository.test.ts`；桌面旧→新→旧 |
| 同屏两面/隐藏时间轴/模态/文本输入/白板/版本 toast 已过期；两种语言、两平台 | 最近有权的面或文本编辑器只消费一次；键与按钮可用性相同，过期 toast 不误撤下一笔。⑩ Agent 所述 changeId 对上实际改动；⑪ 当前面可撤的一步确能触达；⑫ 点撤销确实得到上述编辑/事实结果。 | `WB/shortcutSurface.ts`、`timelineShortcuts.test.ts`、`tests/ux/agent-runtime-editing.walk.mjs`；回看逃逸 `FB-20261007-undo-drops-landed-result`、`FB-20261007-proposal-undo-overwrites-landed` |

**基线与复跑。** 本轮在未改实现的基线上，第一组 10 文件 **128/128**，第二组 6 文件 **1485/1485**（含属性/旧数据样本）。安装包增量、真实出图与桌面帧耗时仍须在实现 SHA 上验。实现另跑 `pnpm run check:concept-owners`、`pnpm run check:root-cause-contracts`、`pnpm run gates` 和相关 `pnpm run perf:scenarios -- --id <场景>`，报告原始分布。

```sh
pnpm exec vitest run src/workbench/generationCanvas/store/{undoKeepsLandedResults,wholeWriteKeepsFacts,productionCanvasHistorySignals}.test.ts src/workbench/generationCanvas/events/shotNumberingLegacyReplay.test.ts src/workbench/timelineUndo.test.ts src/workbench/timeline/{timelineGesture,agent/timelineCapabilityTarget}.test.ts src/workbench/generationCanvas/nodes/director/{model/directorStore,agent/proposalUndo.embeddedEditor}.test.ts src/workbench/generationCanvas/agent/proposalUndoReceiptLifecycle.test.ts
pnpm exec vitest run src/workbench/assets/assetLivenessScan.test.ts src/workbench/generationCanvas/store/canvasModeOldUser.{target,rollback}.test.ts src/workbench/project/workbenchProjectSession.hydration.test.ts electron/events/eventLogRepository.test.ts src/workbench/generationCanvas/events/canvasEventReplay.property.test.ts
```

## 附录 · 可复跑的 door-map 门表

三次默认生产根扫描各 3,179 个文件。第一组 106 写 + 53 读 = 159 门（365 处），第二组 42 写 + 23 读 = 65 门（103 处），布局/同名操作补扫 8 写 + 3 读 = 11 门（23 处）。下表按文件合并展示，每个符号仍对应原始的 `(kind,path,symbol)`。读/写是工具对标识符和调用的分类：例如 `timelineUndoStack` 属性作为值被读，在赋值的对象里却未必是调用；同名 undo 包含富文本。没有命中的符号也保留在复跑命令里。各门实际语义以上述写口和消费端为准。

<details>
<summary>会话、批处理与持久边界 · 159 门</summary>

```sh
node scripts/door-map.mjs appendToUndoJournal applyCompensationOps applyEventTail cancelTimelineGesture captureHistory \
  captureTimelineUndo clearHistory commitCanvasNodeDragStop commitProposalReceipt createApprovalReceiptAuthority \
  createProjectAgentProposalReceiptService createProjectAgentProposalReceiptStore createTimelineAgentUndoEntry dropUndoBarriersAfter findCanvasChange \
  getHistoryFlags getLatestUndoBarrierAbsolutePosition getOldestReachableUndoPosition getUndoHeadToken getUndoJournalGeneration \
  getUndoJournalPosition moveHistory popRedo popUndo prepareProposalReceipt \
  pushTimelineUndo pushUndoSnapshot readReachableUndoNodes recordProductionCanvasSignal recoverPendingProposalReceipt \
  redoStack redoTimeline registerUndoHistoryEvictionHandler replayCanvasEventTailAndSealGenesis replayCanvasEvents \
  runProposalUndo runProposalUndoByChangeId saveState saveStateForWheel seedUndoJournalBase \
  timelineAgentUndoMetadata timelineRedoStack timelineUndoStack undoStack undoTimeline \
  useStateHistory withHistory
```

| 文件 | 写 | 读 |
|---|---|---|
| `electron/agentLane/laneDesktopRuntime.ts` | `createProjectAgentProposalReceiptService` | `createProjectAgentProposalReceiptService` |
| `electron/capabilityCore/approvalReceipt.ts` | — | `createApprovalReceiptAuthority` |
| `electron/capabilityCore/approvalReceiptRuntime.ts` | `createApprovalReceiptAuthority` | — |
| `electron/capabilityCore/canvasShotTestUtils.ts` | `createApprovalReceiptAuthority` | — |
| `electron/capabilityCore/mcpStdioServer.ts` | — | `createProjectAgentProposalReceiptService` |
| `electron/capabilityCore/projectAgentProposalReceiptStore.ts` | `createProjectAgentProposalReceiptStore` | — |
| `electron/capabilityCore/projectAgentReceiptResolver.ts` | `createProjectAgentProposalReceiptService` | `createProjectAgentProposalReceiptService` |
| `electron/capabilityCore/runOwnedGenerationGateAuthority.ts` | — | `createApprovalReceiptAuthority` |
| `src/workbench/NomiStudioApp.tsx` | `recoverPendingProposalReceipt` | — |
| `src/workbench/adoption/adoptionReceipt.ts` | `undoTimeline` | — |
| `src/workbench/adoption/adoptionStorePorts.ts` | — | `timelineRedoStack`、`timelineUndoStack` |
| `src/workbench/ai/resident/TimelineAgentReceiptEffect.tsx` | `timelineAgentUndoMetadata`、`undoTimeline` | `timelineUndoStack`、`undoStack` |
| `src/workbench/ai/v4/useAgentPanelV4Actions.ts` | `runProposalUndo` | — |
| `src/workbench/assets/deleteAssetResult.ts` | `dropUndoBarriersAfter`、`pushUndoSnapshot` | `getLatestUndoBarrierAbsolutePosition`、`getUndoJournalGeneration`、`getUndoJournalPosition`、`readReachableUndoNodes` |
| `src/workbench/assets/pendingAssetDeletions.ts` | `registerUndoHistoryEvictionHandler` | — |
| `src/workbench/assets/removeAssetVersion.ts` | `dropUndoBarriersAfter`、`pushUndoSnapshot` | `getUndoJournalPosition` |
| `src/workbench/capability/multiShotCanvasLanding.ts` | `pushUndoSnapshot` | — |
| `src/workbench/creation/storyboard/exec/applyStoryboardPlanProjection.ts` | — | `getUndoJournalGeneration` |
| `src/workbench/creation/storyboard/exec/storyboardOverrideActions.ts` | `pushUndoSnapshot` | — |
| `src/workbench/creation/storyboard/exec/storyboardRowActions.ts` | `pushUndoSnapshot` | `getUndoJournalGeneration` |
| `src/workbench/creation/storyboard/storyboardDeleteUndo.ts` | `captureHistory` | `getUndoJournalGeneration` |
| `src/workbench/generationCanvas/adapters/assetImportAdapter.ts` | `pushUndoSnapshot` | — |
| `src/workbench/generationCanvas/agent/applyCanvasToolCall.ts` | — | `getUndoJournalGeneration` |
| `src/workbench/generationCanvas/agent/proposalTxn.ts` | `applyCompensationOps`、`dropUndoBarriersAfter`、`pushUndoSnapshot` | `getUndoJournalGeneration`、`getUndoJournalPosition` |
| `src/workbench/generationCanvas/agent/proposalUndo.ts` | `applyCompensationOps`、`commitProposalReceipt`、`prepareProposalReceipt`、`pushUndoSnapshot` | `findCanvasChange` |
| `src/workbench/generationCanvas/components/useCanvasSelectionDrag.ts` | `captureHistory` | `captureHistory`、`getUndoJournalGeneration` |
| `src/workbench/generationCanvas/events/canvasEventEmitter.ts` | `appendToUndoJournal` | — |
| `src/workbench/generationCanvas/events/canvasUndoJournal.ts` | `clearHistory`、`replayCanvasEvents` | `getOldestReachableUndoPosition` |
| `src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx` | — | `captureHistory` |
| `src/workbench/generationCanvas/nodes/ClipNode.tsx` | `captureHistory` | `captureHistory` |
| `src/workbench/generationCanvas/nodes/controls/referenceWrites.ts` | `captureHistory` | — |
| `src/workbench/generationCanvas/nodes/director/model/directorStore.ts` | `saveState`、`withHistory` | `redoStack`、`undoStack` |
| `src/workbench/generationCanvas/nodes/director/model/storeAiSceneActions.ts` | `saveState` | — |
| `src/workbench/generationCanvas/nodes/director/model/storeAssetActions.ts` | `saveState` | — |
| `src/workbench/generationCanvas/nodes/director/model/storeCameraActions.ts` | `withHistory` | — |
| `src/workbench/generationCanvas/nodes/director/model/storeCharacterActions.ts` | `saveState` | — |
| `src/workbench/generationCanvas/nodes/director/model/storeClipActions.ts` | `saveState`、`withHistory` | — |
| `src/workbench/generationCanvas/nodes/director/model/storeEntityActions.ts` | `saveState` | — |
| `src/workbench/generationCanvas/nodes/director/model/storeOutputActions.ts` | `saveState` | — |
| `src/workbench/generationCanvas/nodes/director/model/storeTimelineActions.ts` | `saveState`、`withHistory` | — |
| `src/workbench/generationCanvas/nodes/director/panels/inspector/ActionClipInspector.tsx` | `saveState` | — |
| `src/workbench/generationCanvas/nodes/director/panels/inspector/BatchWaypointsCard.tsx` | `saveState` | — |
| `src/workbench/generationCanvas/nodes/director/panels/inspector/CameraInspector.tsx` | `saveState`、`withHistory` | — |
| `src/workbench/generationCanvas/nodes/director/panels/inspector/CharacterInspector.tsx` | `saveState` | — |
| `src/workbench/generationCanvas/nodes/director/panels/inspector/CloseupClipInspector.tsx` | `saveState` | — |
| `src/workbench/generationCanvas/nodes/director/panels/inspector/LightInspector.tsx` | `saveState`、`withHistory` | — |
| `src/workbench/generationCanvas/nodes/director/panels/inspector/LookAtClipInspector.tsx` | `saveState` | — |
| `src/workbench/generationCanvas/nodes/director/panels/inspector/PrimitiveInspector.tsx` | `saveState` | — |
| `src/workbench/generationCanvas/nodes/director/panels/inspector/SceneLayerInspector.tsx` | `saveState`、`withHistory` | — |
| `src/workbench/generationCanvas/nodes/director/panels/inspector/SkeletonTab.tsx` | `saveState` | — |
| `src/workbench/generationCanvas/nodes/director/panels/inspector/TrajectoryClipInspector.tsx` | `saveState` | — |
| `src/workbench/generationCanvas/nodes/director/panels/inspector/TransformSection.tsx` | `saveState` | — |
| `src/workbench/generationCanvas/nodes/director/panels/inspector/WaypointCard.tsx` | `saveState` | — |
| `src/workbench/generationCanvas/nodes/director/panels/side/AssetsTab.tsx` | `saveState` | — |
| `src/workbench/generationCanvas/nodes/director/panels/side/SceneObjectsTab.tsx` | `withHistory` | — |
| `src/workbench/generationCanvas/nodes/director/panels/topbar/shellChrome.tsx` | — | `redoStack`、`undoStack` |
| `src/workbench/generationCanvas/nodes/director/panels/usePanoramaImport.tsx` | `saveState` | — |
| `src/workbench/generationCanvas/nodes/director/scene/TransformGizmo.tsx` | `saveState` | — |
| `src/workbench/generationCanvas/nodes/director/scene/ViewCamera.tsx` | `saveState`、`withHistory` | — |
| `src/workbench/generationCanvas/nodes/director/scene/character/SkeletonHandles.tsx` | `saveState` | — |
| `src/workbench/generationCanvas/nodes/director/scene/character/useCharacterRig.ts` | `saveState` | — |
| `src/workbench/generationCanvas/nodes/director/timeline/TrackLanes.tsx` | `saveState` | — |
| `src/workbench/generationCanvas/nodes/director/useDirectorHotkeys.ts` | `withHistory` | — |
| `src/workbench/generationCanvas/nodes/director/useMobileCamera.ts` | `saveState` | — |
| `src/workbench/generationCanvas/nodes/shotTable/factBridge.ts` | `pushUndoSnapshot` | `getUndoJournalGeneration` |
| `src/workbench/generationCanvas/nodes/useNodeDragResize.ts` | `captureHistory` | — |
| `src/workbench/generationCanvas/nodes/versionCards/NodeVersionCardsHost.tsx` | — | `getUndoHeadToken` |
| `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardDrawingTool.tsx` | `moveHistory`、`useStateHistory` | — |
| `src/workbench/generationCanvas/quickActions/nodeInputActions.ts` | `pushUndoSnapshot` | — |
| `src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx` | `captureHistory` | `captureHistory` |
| `src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlowNodes.tsx` | `captureHistory` | `captureHistory` |
| `src/workbench/generationCanvas/reactFlow/canvasDragWriteback.ts` | `captureHistory`、`commitCanvasNodeDragStop` | `commitCanvasNodeDragStop` |
| `src/workbench/generationCanvas/reactFlow/useCanvasArrivalHint.ts` | — | `getUndoJournalGeneration` |
| `src/workbench/generationCanvas/store/canvasDocumentCommit.ts` | `popRedo`、`popUndo`、`pushUndoSnapshot`、`replayCanvasEvents`、`seedUndoJournalBase` | `getHistoryFlags` |
| `src/workbench/generationCanvas/store/canvasFrameStoreActions.ts` | `pushUndoSnapshot` | `getHistoryFlags` |
| `src/workbench/generationCanvas/store/canvasGraphActions.ts` | `pushUndoSnapshot` | `getHistoryFlags` |
| `src/workbench/generationCanvas/store/canvasGroupMoveActions.ts` | `pushUndoSnapshot` | `getHistoryFlags` |
| `src/workbench/generationCanvas/store/canvasNodeActions.ts` | `pushUndoSnapshot` | `getHistoryFlags`、`getUndoJournalGeneration` |
| `src/workbench/generationCanvas/store/generationCanvasStore.ts` | `pushUndoSnapshot` | `getHistoryFlags` |
| `src/workbench/production/productionCanvasSignals.ts` | `recordProductionCanvasSignal` | — |
| `src/workbench/project/projectPersistenceService.ts` | `replayCanvasEventTailAndSealGenesis` | — |
| `src/workbench/project/releaseWorkbenchProjectSession.ts` | `clearHistory` | — |
| `src/workbench/project/workbenchProjectSession.ts` | `applyEventTail` | — |
| `src/workbench/timeline/TimelineClip.tsx` | `captureTimelineUndo` | — |
| `src/workbench/timeline/TimelinePanel.tsx` | `redoTimeline`、`undoTimeline` | `redoTimeline`、`timelineRedoStack`、`timelineUndoStack`、`undoTimeline` |
| `src/workbench/timeline/TimelineTextTrack.tsx` | `captureTimelineUndo` | — |
| `src/workbench/timeline/agent/timelineCapabilityTarget.ts` | `createTimelineAgentUndoEntry`、`runProposalUndoByChangeId`、`timelineAgentUndoMetadata`、`undoTimeline` | `timelineAgentUndoMetadata`、`timelineUndoStack` |
| `src/workbench/timeline/timelineClipWritesSlice.ts` | `pushTimelineUndo` | `timelineUndoStack` |
| `src/workbench/timeline/timelineGesture.ts` | `cancelTimelineGesture` | — |
| `src/workbench/workbenchStore.ts` | `pushTimelineUndo` | `pushTimelineUndo`、`timelineRedoStack`、`timelineUndoStack` |

</details>

<details>
<summary>命令、补偿与事实写口 · 65 门</summary>

```sh
node scripts/door-map.mjs addNodeResult applyExternalGraph applyRunOutcome deleteSkillWithUndo holdRunOutcome \
  hydrateCommittedProposalReceipt landNodeContent redo restoreGraph restoreNodeFields \
  restoreStoryboardDeletion shortcutSurfaceMayHandle showUndoToast undo undoableLaneToolCallId
```

| 文件 | 写 | 读 |
|---|---|---|
| `electron/agentLane/laneVerbTransport.ts` | — | `undo` |
| `electron/capabilityCore/mcpCapabilityProjection.ts` | — | `undo` |
| `electron/shared/agentCapabilities/timelineWrite.ts` | — | `undo` |
| `electron/shared/agentCapabilities/verbs/verbProjections.ts` | — | `undo` |
| `electron/shared/agentCapabilities/verbs/writeVerbs.ts` | — | `undo` |
| `src/devlab/designLab/processFeedback/processFeedbackLabKit.tsx` | `addNodeResult` | — |
| `src/devlab/designLab/v4/states/01-vocabulary.tsx` | — | `undo` |
| `src/devlab/nodeTimelineInteraction.tsx` | — | `undo` |
| `src/workbench/NomiStudioApp.tsx` | `hydrateCommittedProposalReceipt` | — |
| `src/workbench/adoption/adoptionReceipt.ts` | `showUndoToast` | — |
| `src/workbench/adoption/adoptionStorePorts.ts` | — | `redo`、`undo` |
| `src/workbench/ai/resident/TimelineAgentReceiptEffect.tsx` | `showUndoToast` | — |
| `src/workbench/ai/resident/residentToolDisplay.ts` | — | `undo` |
| `src/workbench/ai/v4/AgentPanelV4Cards.tsx` | — | `undo` |
| `src/workbench/ai/v4/AgentPanelV4Panel.tsx` | — | `undo` |
| `src/workbench/ai/v4/useAgentPanelV4Actions.ts` | `undoableLaneToolCallId` | — |
| `src/workbench/ai/v4/useAgentPanelV4Data.ts` | `undoableLaneToolCallId` | — |
| `src/workbench/assets/assetResultDeletion.ts` | — | `undo` |
| `src/workbench/capability/capabilityApplyHandler.ts` | `applyExternalGraph` | — |
| `src/workbench/capability/multiShotCanvasLanding.ts` | `addNodeResult`、`holdRunOutcome` | — |
| `src/workbench/common/richTextActions.tsx` | `redo`、`undo` | — |
| `src/workbench/creation/DocumentListSidebar.tsx` | `showUndoToast` | — |
| `src/workbench/creation/storyboard/StoryboardPlanEditor.tsx` | `restoreStoryboardDeletion` | `undo` |
| `src/workbench/creation/storyboard/shotRow/promptHistoryCarry.ts` | `undo` | — |
| `src/workbench/creation/storyboard/storyboardDeleteUndo.ts` | `restoreGraph` | `undo` |
| `src/workbench/generationCanvas/agent/proposalUndo.ts` | `restoreGraph`、`restoreNodeFields` | — |
| `src/workbench/generationCanvas/components/useCanvasShortcuts.ts` | `redo`、`shortcutSurfaceMayHandle`、`showUndoToast`、`undo` | `redo`、`undo` |
| `src/workbench/generationCanvas/nodes/ClipNode.tsx` | `redo`、`undo` | — |
| `src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx` | `showUndoToast` | — |
| `src/workbench/generationCanvas/nodes/director/panels/topbar/shellChrome.tsx` | `redo`、`undo` | `redo`、`undo` |
| `src/workbench/generationCanvas/nodes/director/useDirectorHotkeys.ts` | `redo`、`undo` | — |
| `src/workbench/generationCanvas/nodes/versionCards/NodeVersionCardsHost.tsx` | `undo` | — |
| `src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx` | — | `redo`、`undo` |
| `src/workbench/generationCanvas/runner/runProjectDelivery.ts` | `addNodeResult`、`applyRunOutcome`、`holdRunOutcome`、`landNodeContent` | — |
| `src/workbench/generationCanvas/runner/textActions.ts` | `landNodeContent` | — |
| `src/workbench/generationCanvas/store/canvasRunActions.ts` | `applyRunOutcome` | — |
| `src/workbench/onboarding/journeyTourStore.ts` | `addNodeResult` | — |
| `src/workbench/promptLibrary/PromptLibraryPanel.tsx` | `showUndoToast` | — |
| `src/workbench/shortcutSurface.ts` | — | `shortcutSurfaceMayHandle` |
| `src/workbench/sidebar/CategoryTree.tsx` | `showUndoToast` | — |
| `src/workbench/skillLibrary/SkillLibraryPanel.tsx` | `deleteSkillWithUndo` | `showUndoToast` |
| `src/workbench/skillLibrary/deleteSkillWithUndo.ts` | `showUndoToast` | — |
| `src/workbench/timeline/TimelinePanel.tsx` | `shortcutSurfaceMayHandle` | — |
| `src/workbench/timeline/timelineShortcuts.ts` | `shortcutSurfaceMayHandle` | — |

</details>

<details>
<summary>预览布局及同名操作 · 11 门</summary>

```sh
node scripts/door-map.mjs undoEditingPanelLayout editingPanelUndoStack setEditingPanelLayout displayEditingPanelLayout undoAnchorLook localStepRedoOf
```

| 文件 | 写 | 读 |
|---|---|---|
| `src/workbench/capability/capabilityApplyHandler.ts` | `displayEditingPanelLayout` | — |
| `src/workbench/generationCanvas/fixation/freezeAnchor.ts` | `undoAnchorLook` | — |
| `src/workbench/generationCanvas/nodes/NodeErrorReport.tsx` | `localStepRedoOf` | — |
| `src/workbench/preview/EditingLayoutMenu.tsx` | `displayEditingPanelLayout` | — |
| `src/workbench/preview/PreviewWorkspace.tsx` | `setEditingPanelLayout`、`undoEditingPanelLayout` | `setEditingPanelLayout`、`undoEditingPanelLayout` |
| `src/workbench/preview/editingPanelLayoutSlice.ts` | `displayEditingPanelLayout` | `editingPanelUndoStack` |
| `src/workbench/project/workbenchProjectSession.ts` | `setEditingPanelLayout` | — |

</details>
