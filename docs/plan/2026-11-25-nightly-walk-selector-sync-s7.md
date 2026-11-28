# #1121 夜跑走查现役契约同步第七批

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

协作看板 #1586 · 基线 `8ac07cffb` · 实现线 Codex 6.2 Sol

## 短版设计卡

- ★1 目标与验收 — 夜跑值守者能从走查红灯定位产品问题。11 个候选逐一回放，6–9 条有现役契约和真实窗口证据的脚本从 FAIL 变 PASS。量具见下表，每条命令单独串行执行。生成链只走隔离的本地夹具，网络闸记录付费请求为 0。每次走查用 `git status --porcelain=v1 --untracked-files=all`、工作树内容差异和进程清单核对写入及退出。
- ★2 范围与非目标 — 候选清单内的走查与本卡。产品源码、发版、存量迁移和真实供应商推理均不涉及。现役行为缺失、已删除功能、已经全绿或未能证明为测试漂移的候选保留原脚本，见逐条记录。基线和最终改动清单分别用 `git rev-parse HEAD origin/main`、`git diff HEAD --name-only` 对账，文件与协调线在途清单比对。
- ★3 这一整块归谁（P0） — 设置定位归 `tests/ux/_shell.mjs` 的 `openSettings` 及生产设置锚点，界面名字归 i18n，生成发送归 `ComposerSendButton`，模型身份归 `electron/shared/modelCanonicalIds.ts`，窗口边距归 `ShellFrame` 和 `SHELL_GUTTER`，工具栏与分隔条分别归 `TimelinePanel` 和 `AssistantPane`。启动和进程回收归 `launchNomiApp`，临时目录归 `makeTempDir`。每条完成或超时由走查进程关闭自己的窗口及服务。
- ★4 删旧与迁移（P1） — 在入选脚本删掉过时定位、旧几何前提和仓内输出路径，复用现成入口和临时目录工具。通过 `pnpm run check:test-temp-static` 与 `node --test tests/ux/launcherDirs.test.mjs` 验证先前登记的显式目录边界。关闭或重启后用同一条走查的已有断言验原状态。产品没有数据或状态迁移。
- ★9 验收清单与反例 — 实现线逐条回放并记录首次失败、最终通过、路径、进程回收和本地请求。协调线可按同一表复核。静态量具为上述两条门岗、`pnpm run check:test-types`、`node ./scripts/check-design-card.mjs docs/plan/2026-11-25-nightly-walk-selector-sync-s7.md`。验收和回滚见下文。

### 候选与量具

| 命令 | 必须保留的判据 |
| --- | --- |
| `node tests/ux/screenshot-hotkey.walk.mjs` | 通用页目标开关、真实主进程热键注册、换键撤旧、关掉撤新，按系统权限校验提示或截图落地。 |
| `node tests/ux/feedback-share-center.walk.mjs` | 设置内嵌、分享复制、情境入口脱敏，按生产路径检查旧 Tally 与草稿流程是否仍存在。 |
| `node tests/ux/comfy-t2v-gate-and-error-dismiss.walk.mjs` | i2v 零参考禁用、Comfy 文生可用，点关闭保留已有产物。 |
| `node tests/ux/runway-vendor-honest-modes.walk.mjs` | 绑定准确供应商与模型，逐一最终匹配完整有序模式表，同模型跨渠道保持不同模式。 |
| `node tests/ux/model-catalog-keep-on-failure.walk.mjs` | 中英文刷新失败均保留已读的选项并解释冷启动失败。 |
| `node tests/ux/layout-timeline-panel-span.walk.mjs` | 时间轴左右贴合工作区，右缘留外壳规定间距；两轨可见、助手互不覆盖，能收起和复开。 |
| `node tests/ux/timeline-toolbar-row.walk.mjs` | 三组单行且不盖标尺和轨道，窗口压缩后仍可访问操作，故意挤窄时滚到行尾，收展保持高度。 |
| `node tests/ux/director-timeline-pointer.walk.mjs` | 取消拖动不提交、点空白定位、框选准确关键帧。 |
| `node tests/ux/comfy-workflow-multiref.walk.mjs` | 导入确认、三槽独立连线和重启，精确验证本地上传、请求绑定和结果可播。 |
| `node tests/ux/comfy-workflow-feedback.walk.mjs` | 视频分类、工作流设置、长文件名与手势保留，重启后发送的参数与结果匹配。 |
| `node tests/ux/node-composer-placement.walk.mjs` | 加宽助手确实缩小画布，选中节点的浮框仍保持 600px 及居中、钉在节点下方。 |

### 验收与回滚

- 第一条变异让两个零参考生成按钮都不可用。Comfy 文生的可用性判据必须失败；让两个都可用时，图生阳性对照必须失败。点关闭后数据丢失或遮罩仍在也应报红。
- 第二条变异把展开的时间轴缩到助手左侧，或保持工作区对齐并把右边的外壳间距改成 0。横贯与边距判据各自必须失败；正常外壳间距不误报。
- 第三条变异给 APIMart 渠道注入与 Runway 相同的 Veo 模式列表，或仅替换 Grok 渠道。完整模式表或节点身份判据必须失败。
- 第四条变异让发送动作空转，或只返回导入认证的结果。工作流走查应因后续提交、参数或本地视频结果缺失失败。
- 根因分类为 recurring。最早可拦在现役契约变更的验收，设置弹窗和发送入口分散引用旧选择器，局部验收时跑不到另一头。两个旧案是 #1604 设置弹窗角色命名和画布发送词典切换。共用当前产物的入口辅助器、稳定锚点和正反样本，保留各入口业务断言。仅测试侧迁移，依赖生命周期不适用。
- 数门取自 `node scripts/door-map.mjs FeedbackShareContent`（AboutSection 一处）、`node scripts/door-map.mjs TrackLanes`（DirectorTimeline 一处）、`node scripts/door-map.mjs data-assistant-resize`（AssistantPane 一处）。再用 `rg` 核对弹窗两种入口、生成与剪辑两个时间轴宿主、画布多个发送状态、Comfy 导入与已保存工作流入口。沿现役测试入口修复失配。删除走查会丢掉正常任务的正反样本，保留旧兼容定位会把失配继续藏在脚本中。
- 协调线以修后首次夜跑复查，以本卡入选脚本清单为范围，预期零旧锚点或旧布局前提超时、零占用在途文件。复查日 2026-11-26，若同类再红就重开核对现役锚点的共享入口。
- 回滚用 `git revert <本批提交>`。纯测试/文档短档，无界面改版、付费采样或逃逸账本转档。

### 逐条记录

| 候选 | 修前失败点与生产来源 | 本批结果 |
| --- | --- | --- |
| `screenshot-hotkey` | #1604 后设置名由弹窗标题提供，旧 `aria-label` 属性选择器超时。`SettingsDialog` 提供稳定锚点，`ScreenshotHotkeySection` 提供具名开关。 | FAIL → PASS。主进程注册 Q、换成 S 并撤 Q、关掉撤 S。授权环境中抓屏选区确认后节点数 0 → 1。 |
| `feedback-share-center` | 关于入口已叫「反馈」。`FeedbackReportCard` 和 `FeedbackShareHost` 已替换 Tally/GitHub 外跳提交流程，旧 outbox、URL 核心断言涉及退役路径。 | 原稿保留，首个红点为「反馈与分享」旧入口名。 |
| `comfy-t2v-gate-and-error-dismiss` | 旧走查的 Comfy mapping 没有显式启用，界面默认退到未连模型。当前 `modelPublication` 只发布启用的 mapping。旧 Seedance 对照没输入时按 11-12 拍板回到文生。 | FAIL → PASS。图生对照绑定只有图生方式的 Runway Gen-4 Turbo，零参考禁用。生产 UI 显示 H3 文生工作流且按钮可用。收起报错后状态回 success、错误清空、原产物保留。 |
| `runway-vendor-honest-modes` | Grok 收在「更多」中的规范模型行，Runway Dev 是行内渠道。`modelCanonicalIds`、`NomiSelect` 和 `modeMenuModel` 决定展示。Grok 的图片数组对应「全能参考」，传输仍走 image_to_video。 | FAIL → PASS。10 条判据，包括真实节点模型绑定、完整有序模式表和 Veo 跨渠道 3 对 2 的对照。 |
| `model-catalog-keep-on-failure` | 路由和 state 仍在。Design Lab 的 `installCatalogBridge` 在挂载前通过 `seedModelCatalogForTests` 预热目录，cold 夹具因此看到 Seedance 2。`InlineParameterBar` 的空目录分支也没有现役的失败原因文字。 | 原稿保留。热刷新保留通过，旧冷态成因和产品空态都需另验。 |
| `layout-timeline-panel-span` | 原探针把工作面内的底边窄条排除在覆盖之外，并要求时间轴贴到窗口。拍板卡 `docs/plan/2026-10-08-shell-redesign.md` 与 `ShellFrame` 保留 8px。助手列宽还需等动画落定。 | FAIL → PASS。窗口 1280px，工作区和时间轴宽均 1212px、右缘 1272px。240px 默认高度装下两轨，四态与复开均过。 |
| `timeline-toolbar-row` | `TimelinePanel` 的滚动区是 `flex-1`，旧量具写 `width` 后实际没有压到 320px。 | FAIL → PASS。实测滚动区 320px 时仍保持单行、能横滚且尾组可达，收展及轨道断言通过。 |
| `director-timeline-pointer` | 旧夹具未提供 `TrackLanes.renderRowMenu` 和活跃画布输入宿主。`shortcutSurface.canvasWindowInput` 会拒绝无宿主的全局指针事件。 | FAIL → PASS。现役组件在隔离 Electron 中实测拖动预览后取消不提交、点空轨定位到 6 秒、框选 1/2 秒关键帧。 |
| `comfy-workflow-multiref` | 旧确认标题已改为「开始自检」。诊断继续完成自检、在实际首帧置入后选中已认证工作流，画布仍只显示通用参考摘要并提示该中转发不出图生视频，独立槽和移除入口未出现。 | 诊断改动已还原。真实窗口未证明三槽闭环，保留原断言，需产品链排查。 |
| `comfy-workflow-feedback` | 真实窗口通过入口与初段缩放，首个失败在 `_comfyWorkflowZoom` 的保存后直接读回。现役 `ComfyuiWorkflowSettingsPage.save` 先准备接入会话，界面还要自检才能落正式绑定。 | 原稿保留。当前共享验收前置需要同步接入会话，后续手势、冷启与发送未复验。 |
| `node-composer-placement` | 首屏实际宽 600px 且钉在节点下。全模型共用的旧 ×N 断言与已批 `ComposerB3.board.json` 的「仅模型声明数量时显示」冲突，空目录也没有可用的参数 pill。 | 原稿保留。已删除的通用 ×N 判据和真实窄窗段落需另立走查边界。 |

### 定向门岗与证据

- `check:test-temp-static` 和 `check:test-types` 通过。`launcherDirs.test.mjs` 依赖 Vitest，直接用 Node 的测试运行器在载入时报错，使用 `pnpm exec vitest run tests/ux/launcherDirs.test.mjs` 单文件通过 4 项。
- 基线没有 `scripts/check-design-card.mjs`。调用现役 `scripts/pr-body-criteria.mjs` 导出的 `checkDesignCard`，短档 5 格通过。
- 本机以隔离 macOS Electron 串行复跑入选脚本，逐条核对退出、工作树状态和内容。中英文设置页均从顶栏齿轮到达通用页，读回具名截图热键开关。网络闸记录无放行至外部供应商，Comfy 导入诊断仅访问本地 HTTP 夹具。真实供应商、Windows 未验证。
- 去掉外壳右侧 8px 的变异使横跨度检查在右缘 1280 时拒绝。把文生发送钮改成禁用，图生对照仍过，文生可用性判据拒绝。变异只在验证进程中注入，工作树内容一致。
