# 通知策略：发生在哪就在哪说

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：实施完成，完整交付验证中。基线 `1d565961f`，沿用 `fix/toast-action-layout-20260909`；用户任务书授权策略实施，不另造外观。沿用真实页面与既有通知组件，前后截图验收。

## 真实摩擦与范围

同一操作会同时改变卡片状态、显示局部文字、再弹右上角通知；重复调用默认随机身份，挤占可见通知与队列。用户必须转移视线确认已经看见的结果。

全量清单见 [逐调用点调查](2026-09-09-notification-inventory.md)。扫描不仅包含 toast，还包括 confirm/alert/prompt、Mantine store、通知事件投影、系统通知及主动打开的 dialog。文件行号以调查基线为准。

不动 `electron/agentLane/**`、`src/workbench/ai/lane/**`、`reactFlow/**` 和 C50 供应商切换逻辑；这些入口仍接受共享去重边界，但不修改其策略代码。付费、信任与只读边界不降级。

## 先查别人：官方依据与边界

调研由 notification_research 独立反方核实；2026-09-09 实读官方页面与安装源码。以下明确区分外部依据与 Nomi 的产品裁决。

| 产品/规范 | 原地反馈 | Toast/banner | 模态 | 对 Nomi 的裁决 |
|---|---|---|---|---|
| [Apple Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts) | “Avoid using an alert merely to provide information.” 无网络可在上下文显示指示器 | 此页不定义 toast | “Avoid displaying alerts for common, undoable actions, even when they’re destructive.” | 原地信息不升级确认；不可撤回才确认，可撤回保留 Undo |
| [Apple Notifications](https://developer.apple.com/design/human-interface-guidelines/notifications) / [Modality](https://developer.apple.com/design/human-interface-guidelines/modality) | 前台 Mail 插入新邮件，不重复通知 | 此处是系统通知规范，不能机械套应用内错误 | 可用模态完成独立短任务，如编辑照片/媒体查看 | 通知模态限必须决策；主动打开编辑器和预览是工作面 |
| [Figma notify](https://developers.figma.com/docs/plugins/api/properties/figma-notify/) | 文档操作本身提供结果 | 底部短消息，默认 3 秒、100 字符、可选按钮，可取消失效消息 | notify 不是决策 API | 动作并非 Figma 的硬性要求；Nomi 按行动价值从严 |
| [Notion Inbox](https://www.notion.com/help/updates-and-notifications) | 按页面/评论线程聚合，点通知到发生处 | 桌面 mention 延迟 10 秒；移动在 5 分钟未读/未打开后才发 | 未公布完整四级规范 | 借鉴对象聚合、已读抑制、直达对象，不虚构 toast 禁令 |
| [Linear Notifications](https://linear.app/docs/notifications) | 通知进 Inbox、按对象/状态变化分类 | 桌面实时，邮件依紧急程度延迟且仅未读发送 | 未公布完整四级规范 | 借鉴去重和紧急程度；纯成功静默是 Nomi 决策 |

近邻视频编辑器：[Shotcut mainwindow.cpp:2549](https://github.com/mltframework/shotcut/blob/master/src/mainwindow.cpp#L2549) 共用 `showStatusMessage` → 播放器状态区，`:3287` 保存成功也如此，`:5627` 更新失败附官网下一步。辅助画布近邻：[Excalidraw actionClipboard.tsx:36](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/actions/actionClipboard.tsx#L36) 普通 copy 静默，`:64` 取消粘贴不报错，`:163` 导出剪贴板成功可 toast（外部结果不可见）。

框架取舍：保留 [Mantine 8 通知](https://v8.mantine.dev/x/notifications) 原生生命周期和队列。已实读安装版 8.3.18 `node_modules/@mantine/notifications/esm/notifications.store.mjs:29` 的 `updateState`（合并可见/队列）；`:40` show 相同 id 忽略；`:63` update 不创建。Nomi 原子替换完整 NotificationData，避免继承旧动作，不另造队列/计时器/store。`NotificationContainer.mjs:25` 的 timer 只依赖 autoCloseDuration，内容更新不续时；本任务不承诺续时。框架公开字段没新增，重复计数存它允许的 data-* 扩展点。

Nomi `src/ui/toast.tsx:96` 是调查基线的随机身份源，`src/NomiAppProviders.tsx:24` 是唯一容器；容器数量限制继续由 Mantine 管。身份是对象槽，原因决定计数：同身份同原因 count+1；同身份新原因替换并重置为 1（避免“身份+原因复合主键”让同对象多个旧原因并存）。撤销每笔编辑必须有独立身份，不能按相同文案合并并丢掉一笔撤销。

## 策略与取舍

| 选择 | 用户看到 | 代价/收益 |
|---|---|---|
| 原地反馈优先（采用） | 操作旁出现原因和下一步，已有状态不再弹 | 调用方提供对象身份与局部落点，避免全局入口猜 DOM |
| 所有事件都 toast（删除） | 右上角不停重复，结果与对象分离 | 代码少但用户承担信息筛选 |
| 所有失败都 modal（拒绝） | 不断点“知道了”才能继续 | 错误原因仍未靠近对象，打断无决策价值 |

共享入口按上下文裁决：有原地反馈落点 → 内联；已有可见状态 → 状态承担；视线外且有下一步 → toast；必须暂停决定 → 既有确认机制。成功默认不弹；撤销属于有时限的行动，不是成功播报。同一身份 + 原因仅保留最新内容与回调，重复计数；关闭后再次发生重新计数。不同对象不能串动作，更新排队项也须去重。

## 根因与实现顺序

Recurring：缺失稳定身份、原因与呈现上下文契约，多个生产者可重复进入。先补真实 Mantine store 的红测试（五次同原因、不同身份、排队更新、关闭再发生、最新动作），再共享修复；删除冗余成功/进度通知，已有错误落点移除重复 toast，无局部落点的纠正以现有外壳内联承接。保持确认承诺、撤销目标合法性与安全审批。

六视角自审：CTO—复用 Mantine 而不造队列；设计—不新增弹窗样式；PM—必须有行动价值；前端—原地状态保留失败原因；后端—不改授权/执行；用户—五次同错误只一条，动作指向最新对象状态。

## 验收与回滚

真实组件/真实应用截图比较：重复错误合并、目录检查内联、状态切换无成功弹窗、不可撤回决策仍阻断。类回归先红后绿；完整 `python3 scripts/with-gates-lock.py -- pnpm run gates` 必须 exit 0；hook 正常 commit/push 当前分支，更新原 PR 正文。无持久化变更；回滚本任务提交恢复通知策略。

### 原地反馈调用点实施细节（local_feedback_cleanup）

遵循 notification_research 的 Apple 上下文反馈、Figma 可取消通知及 Shotcut mainwindow.cpp:2549–2567 状态区先例。Dreamina 安装/登录/退出以父级刷新后的状态承接，复制以既有按钮“已复制”承接；Codex 开关成功以状态承接，失败保留原因在按钮旁，重试先清旧错。项目目录的 get/pick/reveal/reset/check 失败统一回既有局部反馈区域，检查结果不再同时 toast。Updater 复用既有 badge 和 dialog：后台 pending 仅 badge，点击才打开；任务运行中允许主动查看/下载，既有安装按钮禁用并说明原因；重启主进程安全门保持。纯 visibility 函数加入主动请求维度，用阶段变更与主动请求测试防止再次自动抢焦点；不新增 UI 组件或持久化状态。

### 任务卡原地错误实施细节

`useProductionStatus` 只由 `TaskCenterPanel` 持有，命令失败的 8 个告知模态没有决定价值；保留全部 confirmDialog 与支出门。hook 将运行身份绑定的失败消息经共享 notify inline 送回调用任务卡，重试先清；切换 run 不展示旧 run 错误。一般任务行的取消/重试失败同样在该行呈现上游原因并保留动作，删除全局 toast。TaskCenterPanel 透传异步回调给制作卡，以原有 busy 生命周期阻止连点，不丢 Promise。

### 模型连接操作反馈（inventory 实施）

目录 `/Users/aoqimin/Desktop/Nomi-toast`；分支 `fix/toast-action-layout-20260909`；产出四个模型设置文件及定向回归，不独立提交。依据上述 Apple Alerts 和 Shotcut 状态区证据，ComfyUI 实例、LocalModel、工作流设置、模型抽屉中的纯错误告知不构成决定。使用共享 `notify` inline 分支，失败按供应商/模型/当前页面身份落在现有卡、工作流错误区或抽屉内容；重新操作清旧错误，切换对象不串反馈。保留费用/删除/放弃编辑确认；已有能力徽标和列表变化替代成功回声；待验证状态必须原地留下下一步。复用现有错误容器，不新建弹窗。共享 recurring 合同由主任务统一登记这四个路径；定向回归证明错误仍可读、错误不进入 modal、其他对象不继承旧错误。

### 白板与 3D 局部反馈（notification_research 实施）

目录 `/Users/aoqimin/Desktop/Nomi-toast`；分支 `fix/toast-action-layout-20260909`；范围 whiteboard 与 scene3d 通知调用，不修改绘制/3D算法、录制、导出、安全契约。依照 Apple Alerts 上下文优先及 Shotcut 状态区证据，白板保存/截图失败留在编辑器内且保留完成/截图重试入口，导入/删除限制/抠图失败在绘制工具栏反馈；全景导入校验/失败在上传区域，非 2:1 复用已有预览尺寸提示，成功由预览承接。共享 notify inline 负责裁决，组件局部 state 承载最近消息，开始新动作清理旧消息；不新增全局 store/通知组件。Fullscreen hook 消息必须由真实 Scene3DFullscreen 宿主传入呈现回调，禁止 hook 脱离宿主只吞错误。根因 recurring：缺少宿主落点，局部事件直接调用全局 toast；统一根因合同由主任务登记。定向测试覆盖重复非法导入只有一个原地错误、重试清理及不新增 toast。

### 时间轴原地反馈实施细节

时间轴轨道拖入、空配乐添加、AI 拼片与右键操作均在视线内：原有 toast 改宿主状态行；右键项执行后菜单会卸载，必须把 present 传到持续存在的 TimelinePanel。纯素材拖放 helper 增加必填 onFailure，把现有被 void 丢失的探测失败交宿主，不改时长/素材/付费算法。addAssetToTimelineEnd 已主动展开结果，删除无动作成功回声；adoption 撤销回执保留。错误在下一次同类操作开始时清理，且提供真实轨道/面板身份。设计实验室菜单宿主接同一 feedback props，不造另一份 UI。

### 素材面反馈（inventory 第二批）

素材面是导入/拖放/粘贴/删除操作的真实宿主；共享 helper 不再自己选全局容器，必须由 AssetLibraryContent 传入原地 present。项目身份隔离反馈，单次混合导入的媒体/音频/跳过原因汇合保留，不让后完成的子步骤覆盖先前失败；重新操作清旧状态。列表已展示的导入/删除成功不重复 toast；保护外部资产和不可撤回删除确认不动。3D 素材下载在既有预览按钮旁保留成功/失败文本（用户刚指定的系统保存路径仍有效），不吞文件完成结果、不虚造不存在的“打开位置” bridge。该批不更改画布媒体处理或删除语义；定向覆盖分享链接流程和素材显示结构。

采纳回执补充：轴内声明 `level: inline` 时类型强制真实 present；未声明的既有跨面采纳保持背景语义，但所有需告知的回执增加“查看时间轴”动作，applied 的安全撤销仍保留。冻结 reactFlow 调用未改触发/业务逻辑，仅受共享回执动作增强；不为冻结区添加旁路。

### 局部真实组件浏览器证据

`node tests/ux/notification-local-feedback.e2e.mjs` 已通过。真实 React/Mantine/providers/CSS 与 Codex 卡、制作 hook+任务卡、TimelineTrack；只有桌面写入边界注入明确失败再恢复。before 使用 `git show 1d565961f:<真实路径>` 经 Vite transform 渲染原组件，不手画旧图；截图均用 screenshotSettled，人工并排检查通过。Codex 与制作失败显示原地原因，恢复后再次点击成功且清旧错；轨道拒绝跨项目素材原地说明。真实 toast 五次 before=2可见+3排队，after=1可见+0排队+×5，点击执行第5次回调；关闭后再次发生从1计数。截图及 JSON 收据在 `.tmp/toast-policy-evidence/`。该证据是组件交互验证，完整 Electron 宿主目录/更新旅程另由 notification-policy.walk.mjs 覆盖。

重复 warning/error 第二次起转为可关闭持久提示，直到用户关闭或原地恢复回执撤回；不靠抖动 TTL 伪造续时，避免最新失败只剩上一次倒计时的几毫秒。普通单次通知仍沿用 Mantine 原生时长。

### 节点剩余通知清理（notification_research 第二批）

范围为 `generationCanvas/nodes/**` 与 `videoDepth/**` 的剩余约 65 个 toast/info 调用，排除 C50 `useNodeModelAutoSelect` 与冻结 ReactFlow；`CameraMoveCaptureHost` 由主任务只迁通知入口为后台消息及定位目标动作，outcome 与模型切换核不变。节点交互错误只进组件局部反馈，不写生成 `node.error/status`；composer 将同一呈现回调传给拖放/mention hooks；派生帮助函数由真实调用宿主传回原地结果，异步离开宿主或冻结调用边界采用明确身份、原因和定位动作。下载/复制完成在原按钮附近显示结果，保留失败原因与可重试控件；纯场景状态成功播报删去。无新 store/event 总线/hook；安全与生成算法不变。定向测试、实际组件截图复用本任务验证设施。

### 补全批次：设置、项目、工作流与技能库（28 个原调用）

剩余 AddComfyuiInstanceButton / ComfyuiPresetSection / ComfyuiTemplateLibrary / ComfyuiWorkflowImportPanel 9 条、WorkflowLibraryContent 2 条、SkillLibraryPanel 5 条、NomiStudioApp 9 条、projectHydrationRecovery 3 条全部纳入。成功已由列表/跳转/认证状态可见则删除；设置失败归供应商与模板、工作流失败归项目与条目、技能导入批次保留逐包错误/跳过提示。项目恢复/保存/改名失败通过库页及 AppBar 下的真实宿主插槽显示，项目身份不跨面串台。原恢复/删除确认与撤销保留。后台通知定位复用既有 production 深链的 hydrateProject 安全链，原项目确实激活后再切页/聚焦；模板素材异步复制后再验项目，禁止旧任务写新画布。此批不另建提示组件或 store。定向验证覆盖共享定位的跨项目/过期结果、原宿主落点及保留保护。

### 浏览器与分镜页（17 个剩余入口）

浏览器提取/保存提示词反馈必须回当前浏览器页，而不是弹全局 toast 或自动展开另一个素材盒。runner 必填 present，浏览器 hook 按 tabId 保存消息，放在书签条下、原生网页 bounds 之外；删除旧 runner 事件+素材盒监听的并行通道。书签改名复用书签条原位 input（Enter/失焦提交、Esc取消），无新模态；导入/删除失败回素材盒自身状态行。分镜操作失败留当前方案状态行，参考槽拒绝复用既有 uploadError；Agent 引用已有选中引用、播放已有未生成片段占位，删除重复回声。全部保留支出/删除确认与媒体算法。

浏览器/分镜批次验证：5 个测试文件 51 用例通过（提取 runner 两个新用例走真实 notify，证明成功/失败均回请求 present、无全局通知）。真实浏览器宿主书签右键→原位输入→Enter 落盘，Esc 放弃且浏览器保持打开，截图 `after-bookmark-inline-edit.png` / `after-bookmark-inline-saved.png`；旧源码基线确实发 native prompt（通过 Playwright dialog 事件核实，未伪造原生弹窗截图）。共享错误时钟回归使用 page.clock：首次 ttl1000，900ms时重复，再推进5000ms仍只显示最新错误，手动关闭生效。

本批实施收据：上述28条原toast/info调用已清除；新增项目通知定位复用原深链所有权，`isHydrating` 与 active project 双检查后才操作工作区；模板复制await后复核项目。库内项目失败在对应卡片显示，找不到卡/创建错误落库页；保存错误在AppBar下且成功保存清理；设置反馈按vendor+template键归属；技能导入成功显露实际新卡、跳过文件仍留原地说明。新增导航回归4条，连同原设置/导入/工作流/深链/事件接线共8文件75 tests通过；本批eslint零warning。真实截图与完整gates由主任务统一交付，此处不提前宣称体验验收完成。

### 取消任务与制作节点补全

localTaskControl 的取消结果必须回请求节点/任务行；productionShotActions 的重做/续拍必须回请求宿主，按 project/run/shot 身份报告实际失败原因，成功/用户拒绝静默。保留原中断、旧任务检查与支出确认语义；重试先清旧反馈，针对后端拒绝/抛错/成功和拒绝确认做定向测试。

## 最终实施边界与验收证据

清单原469条保留，307个原提示调用迁移/删除；余下业务调用仅冻结ReactFlow五处和C50一处，另有两个共享包装器。69个无引用双语提示键同删，dead-key门岗为零。

冻结ReactFlow宿主禁止增加内联插槽，因此画框/编组/批量模型操作、拖放/粘贴、批次授权等适配器暂保留带实际项目/对象身份和定位动作的通知；这不是“已内联”。全局截图热键失败带设置入口，运镜后台附着警告带目标定位，队列刹车带任务中心动作。恢复/取消/结束撤回暂停通知；不同项目同节点ID批次不会合并。错误离开预览或浮条后仍能找到原项目，不把旧异步回执贴到新对象。

[逐类真实前后截图及复现](notification-policy-evidence/README.md)。完整gates结果与准确交付身份记在TOAST-POLICY-LAST.md和PR；无完整exit0不推送。

## 并线 f708568df

仅整合 #682 与 #679 的既有实现，不扩通知策略或付费边界。冲突来自两条分支同时调整反馈入口；继续由共享通知身份边界负责去重，由报价/授权边界负责费用承诺，沿用两任务已有 recurring 合同与回归覆盖。

- `src/ui/toast.tsx`：以 #679 的单行布局、身份/原因替换、计数与最新动作回调为骨架；保留动作显示名及完整 title，不退回随机身份或旧布局。
- `StoryboardPlanEditor.tsx`：保留 #682 的生成/报价语义；执行阻断走 #679 的 reportFailure 原地反馈，busy 状态不重复弹通知。
- `batchPlanPreview.ts`：保留 #682 的节点实参报价与 finally 复位；异常在 catch 交给 #679 的项目/批次身份反馈，失败不关闭预览，不在 finally 引用不存在的 error。
- `generationRunController.ts`：保留 #682 的整批变体报价、quoteId 绑定与一次按 total 铸授权；授权/报价失败交 #679 的 reportAuthorizationFailure，生成失败仍由节点承担；单节点与原地重生成继续传递 quoteId。

验收：正常 hooks 提交 merge；指定 toast/notification/generationRun/storyboard 测试通过；带锁完整 gates exit 0 后才正常 push 当前任务分支。回滚需显式 revert 此 merge（主父 #679），不重写远端历史。

并线门岗补全：首轮完整 contracts 汇总仅 i18n/typecheck 阻断。删除已移除忙碌 toast 的双语 actionPending 词条；反馈身份与 #682 的实际 activeDesign 派生 designId 统一，移除旧 activeStoryboardId 引用，避免默认方案存在但选择 ID 为空时反馈归属错误。其余 71 个阻断门岗通过；后续完整重跑以最终 exit code 为准。
