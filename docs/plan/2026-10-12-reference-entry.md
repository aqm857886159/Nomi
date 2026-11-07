# 小鼠标参考入口与真实 Agent 附件

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

最终拍板：2026-10-12 用户要求“放在一排”“都用和右边一样的框 里面放icon”，看过真实截图后确认“ok 实现好了 提交pr上去”。节点鼠标与原加号同排、同 56px 虚线方框，内部仅 icon；Agent 保留原紧凑鼠标图标和文件加号。实现基线 origin/main 6d28f38632；独立线 reference_census。

类别：新界面/改交互、Agent行为、画布。选择参考只准备输入，发送/生成仍由用户执行。

| 设计卡 | 决定与证据 |
| --- | --- |
| 1 用户怎么用 | 打开节点→看到参考→选素材或画布点选→原槽位显示→输入要求→用户生成；Agent→参考立即画布点选 / 原+批量上传 / @选现有素材→句中缩略图→分别写要求→发送。真实任务：本地人物定妆图生图、真实视频节点首尾帧、Agent参考图片与视频原件定向修改当前节点。主指标：首屏能找到参考（基线隐藏在+，目标直接可见）；质量：所选原件身份进入request（目标0静默丢失）；护栏：无自动生成/选源不改目标/已有槽不丢。按每步预期→实际记录，真实provider待验。 |
| 1b 连带界面 | 节点同框 icon / Agent 紧凑 icon、中文/英文无障碍名称、picker点选、类型限制与附件准备失败；原上传/拖放/粘贴/首尾帧/重排/@引用/撤销保留。完整普查见独立报告。 |
| 2 owner | Node: AssetReference→NodeParameterControls原槽写入与resolveReferenceSlots；点选只用canvasPickMode；Agent: useComposerAttachments→projectAgentAttachments→claims→main projectAssetStore→laneDesktopInput。来源选择不改selectedNodeIds，目标发送时走原captureSendContext。 |
| 3 复用 | 复用AssetPicker/AssetPickerPopover/IconPointer/AssetTile/原上传API/原main身份解析；不新增参考store、不从renderUrl直接发送vendor。 |
| 4 全状态 | 空入口常显；上传中附件不可发送；成功现有缩略图；失败保留可移除并重选；部分成功各附件独立；取消点选不写；失效main拒绝且保留草稿；槽满显示原因且可移除；没有参考槽的纯文本生成不捏造槽。zh/en i18n。 |
| 5 中途 | picker Esc/外点关而保留草稿；点选Esc/空白取消；上传关窗不自动发送；断网失败可移除重选；切项目由project context阻止跨项目落入；重启不恢复未持久化临时picker。所有准备过程不发起生成；发送ACK才清对应附件。 |
| 6 外部数据 | 现有main导入与项目绑定验证原件，renderer只声明身份；图片vision按原模型能力发送；视频/音频以可执行assetId素材引用进入prompt，用于生成参考和技术事实读取，不能声称模型已经理解画面/声音。原生视频/音频语义分析不在现有lane能力内。 |
| 7 性能 | 复用现有素材池与导入边界；输入按引用数重复解析、句中图片未传缩略图、点选重复查全画布、主进程同步原件哈希均有优化空间，尚未优化。隔离探针仅证明子路径成本，不代表 Electron 输入/帧耗时；1000素材、最大画布、真实编辑器 p95/long-task/内存峰值 unverified。 |
| 8 条件 | macOS真Electron、中英/暗色/窄窗/键盘已走查（loopback文本supplier，0付费）；Windows/打包版/真实provider unverified，测试fixture不能替代。 |
| 9 验收 | red→green同类传输回归，入口原路径Electron截图，独立reference_census复核；提交前风险gates；PR不合并。回滚revert本任务commit，不改用户数据schema。 |

motion-contract：复用现有AnchoredPopover入退场、AssetTile450ms预览；不加自写动画，reduced-motion沿用已有实现。点选不缩放或移动目标。

拍板清单：docs/design/boards/2026-10-12/ReferenceEntry.board.json；阶段先用生产组件搭建并捕获真实截图，然后按清单核对。探索图不是生产合同。

最终交互合同：
- 节点小鼠标与原参考缩略图/加号框同排、垂直居中；左框使用原 IconPointer，只有图标，56px 虚线框与原加号同源 AssetActionTile。点击直接进入现有 canvasPickMode，不先弹搜索。
- 声明槽保留原队列末尾 / 首尾帧 / 源视频槽内 + 与容量规则，不增加第二个顶部 +。无声明槽入口复用原左输入 owner 的素材选择与连接。原 + 的外观和点击行为保持。
- Agent 只保留原小鼠标 IconPointer（原 24px 控件、16px icon），原 + 直接 multiple 上传，不增加方框、目标标签或上方 ready 媒体条。
- @ 和点选都在共享 PromptEditor 的指令句中显示缩略图。最后一处引用删除释放 claim；ACK 期间保留仍引用的原件。编号按 canonical assetId/version 去重，与 main manifest 一致；Shift+Enter 保留换行。
- 显式画布来源的精确 resultId 发送时再验，只读 ContextSnapshot 带编号到源节点映射，原选中 target 不变。点选仅取卡面当前主版本，不暗取历史；历史版本仍经原 + 选择。
- 同一原件被多个节点复用时需要在指令中明确节点名，不把同 URL 媒体身份当作两个独立编辑目标。视频/音频携带可执行原件身份，不声称已经观看或试听。

## 类根因复盘（最终范围内的共享边界修正）

0. 一句话根因：参考入口复用不完整——显示、编辑器事务和 canonical claim 原来按不同时间点判断同一引用。

1. 归类：重复 header + 源于叠加新入口；选来源改 target 源于 pointerdown 结束太早；异步插入重复和删除后重现源于滞后的 draft props；收起后的首击取消源于 generation form 改变晚于点选启动。分别收回原槽 owner、完整手势 owner、实际编辑器事务和既有 form owner。

2. 结构：⑫ 点了=以为的。引用必须沿原控件/事务走到主进程原件身份，不能仅以出现过缩略图或瞬间 count=0 当成功。用户已明确拍板“原小鼠标和交互”“不自作主张加东西”；结构性方向继续复用原实现、删除重复入口，本轮没有另起产品或架构方案。

3. 不修的可验证预测：刚上传立即清空会重插（持续 expectAbsent）；generation 记住 ball 时首击取消（真实界面先收起再切创作）；pointerdown 后 source 改写 target（读取选中集与 nomi.input TargetRef）。都固定在同一真实 Electron walk 中。

4. 靶子独立性：reference_census 只读复审代码与 owner；实现线执行真实 Electron。测试宿主缺 mutation 方法曾造成重挂，已补原宿主接口并外显异常；无 DOM 的性能测试只隔离 editor adapter，不拿它证明编辑器正确。真实视觉与 wire 另验。

5. P0：编辑能力复用已安装 TipTap/ProseMirror transaction.before、现有 mapped bookmark 与 PromptEditor；形态复用 agentFormStore；类型复用 mediaKindFromContentType/dropKindFromFile。自写仅 Nomi 的节点/原件 claim 对应，没有新通用编辑器或选择器。

6. 取舍：接入原 owner（采用，修改小且统一入口）；逐场景补延时（放弃，仍读旧 props）；另写 reference store/编辑器（放弃，重复身份与 UI）；删除参考能力（放弃，违背用户核心任务）。用 transaction.before 同时覆盖延迟回流和立即删除，不加 timeout 特例。

7. 核心权衡：保持原小鼠标、原加号与句中缩略图，并让它们真的携带所选原件。没有新增用户配置或界面。

特征与类检查：electron/ai/agentUserContent.test.ts（全媒体 × vision 能力矩阵）、src/workbench/ai/composer/useComposerAttachments.behavior.test.tsx（延迟 echo 删除）、AssetReference.test.ts（原加号容量）、tests/ux/reference-entry.walk.mjs（持续消失、首击、目标和 wire）。逃逸条目 USER-20261012-reference-entry。

## 先查别人

- [共享 PromptEditor](../../src/workbench/assets/PromptEditor.tsx)：已接入现有 TipTap 编辑器与 AssetMentionSuggestion；不再实现 Agent 专属编辑器或 @ 弹层。
- [mapped bookmark 插入](../../src/workbench/assets/insertAssetMentionWhenReady.ts)：已接入现有 ProseMirror 映射边界；在途原件准入沿同一插入 owner 保持句中位置。
- [项目附件准入](../../src/workbench/ai/composer/useComposerAttachments.ts)：已接入现有原件导入、去重、项目动作绑定与 canonical claim；媒体数据不落第二套参考 store。

登记 `agent-inline-reference-admission` 仅声明 `useAgentReferenceMentions.ts` 这一领域接线文件的约束与删除条件。React hook 文件即使位于 resident 领域目录仍受 genericZones 管理，因此登记具体文件，不扩大 domainRoots、不放宽检查。性能审查本轮只记录，未实施优化或改动已确认的界面。
