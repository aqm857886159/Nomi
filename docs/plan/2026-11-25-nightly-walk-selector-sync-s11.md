# 夜跑走查现役契约同步第十一批

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

## 短版设计卡

- ★1 创作者仍能打开方案、操作参考槽与镜头、选择模型、在任务中心追踪队列；夜跑维护者需要逐段读回当前界面的结果。真实任务用隔离 Electron 执行，生成走仓内环回供应商夹具。主指标是入选脚本按原用户路径由失败转通过的比例（逐脚本退出码与日志，目标 100%）。质量指标是原有正反面业务结果仍可区分的比例（各脚本的分镜行状态、模型选择读回、排队与恢复断言，目标 100%）。护栏指标是隔离和回收检查通过的比例（`check:test-temp-static`、`launcherDirs.test.mjs`、每轮 `git status --porcelain` 与进程表，目标 100%）。连带面包括文稿抽屉、模型菜单、任务面板及 Agent 会话。升级不适用，本批仅更改测试消费者。
- ★2 分镜入口由 `DocumentListSidebar` 和 `openStoryboardEditor` 管理，虚拟镜行由 `StoryboardShotTable` 管理，画布实际节点由画布状态管理，模型行由 `InlineParameterBar` 的选项和 `NomiSelect` 渲染，隔离目录由 `makeTempDir` 与启动器管理。`door-map` 枚举 `StoryboardShotTable` 的生产编辑器及实验室两处消费者、`NomiSelect` 的 26 处读取入口。测试端用 `rg` 复查 `openStoryboardEditor`、`canvasFitView`、菜单行锚点和目录边界。脚本拥有启动、读回与清理，跑不到的状态记未验证，被测应用继续拥有相应状态与持久化。
- ★3 沿原方向同步脚本，复用现役入口、框架的结构锚点、真实滚动和隔离目录。`805096d41` 删除分镜摘要入口，`91711c57f` 增加模型能力说明，`6f8cd1ede` 记录任务中心真实加节点路径。每份走查继续验证同一结果。替换驱动或删除断言都会降低故障定位能力。
- ★4 空态仍靠空库、空画布和未连模型呈现；加载等现役 UI 或状态锚点；成功需要真实读回；失败保留脚本原有断言和截图；部分成功按各镜与各任务分别读回；取消中沿用原交互；过期、能力不可用走现役提示与接入模型入口。截图覆盖窄窗、长说明及列表滚出视口的条件，按原脚本语言运行。
- ★9 先原样串行跑九个候选。入选仅限测试消费者、并逐个在隔离窗口复跑到退出码 0。核对原业务正例与拒绝反例、截图、外置目录、无残留进程、改动文件白名单和冲突清单。提交后在同一 HEAD 跑指定七项定向门岗。回滚用 `git revert` 本批提交。反例一恢复已删的摘要按钮选择器，分镜打开后仍应在旧按钮处失败。反例二镜头未滚入视口时，用全屏 DOM 数量当真实清单或直接索引行 6，应失败。反例三恢复聚合整行文字长度来推断模型说明，应在现役英文能力副标题出现时失败。反例四禁止添加节点或只造可见节点，真实项目的节点数及跨批次分片必须失败。对照样本是现役入口进入真实分镜、菜单切换到目标模型和可见任务状态。

## 系统改进

分类为 `recurring`。现役 UI 与其走查消费者独立演化，仓内其他走查也会把已删入口、视口 DOM 或历史证据路径当稳定接口。最早漏过的是 `check:walkthroughs` 的静态接线阶段，现有检查不执行真实交互，也不能判断聚合文字或 DOM 数量代表的业务含义。已有分镜入口归口测试及临时目录门岗继续约束新写法，本批在允许修改的消费者处消除重复入口与错误读面，并保留可失败的业务断言。沿用现有 Playwright、TanStack Virtual、React Flow 与隔离目录实现，本批没有依赖升级或存量迁移。复查日 2026-12-02，以夜跑同批条目的相同漂移失败占比为量具，预测已验证条目中为零。

## 候选记录

九个候选依次以真实窗口日志与现役源代码分类。付费确认与对话跟随中观察到的生产行为单独记录。证据目录在仓外，以下使用相对证据文件名。

历史夜跑 [45179348727](https://github.com/aqm857886159/Nomi/actions/runs/45179348727) 的五条相关记录都为退出码 1。与开发基线同 SHA 的夜跑 [45407702390](https://github.com/aqm857886159/Nomi/actions/runs/45407702390) 中，任务中心与 Composer 已返回 0，另外七条仍返回 1。两个夜跑的原始日志与本机基线分开保存。

| 候选 | 原脚本及生产核对 | 处理 |
| --- | --- | --- |
| `storyboard-reference-slots` | `before-storyboard-reference-slots.log` 复现旧按钮超时。失败截图已显示编辑器打开。后段还要求已由 `0fc4768fb` 删除的镜行展开功能，`StoryboardShotRow.structure.test.ts` 锁住该删除。 | 整条保留原样。 |
| `storyboard-table-exec` | `before-storyboard-table-exec.log` 同时复现第 6 行未挂载和镜 2 实际为 `ready`。`ec786acb2` 明确删除镜行等待参考卡这一行为，生产状态枚举也已删除 `waiting-refs`。 | 整条保留原样。 |
| `task-center` | `before-task-center.log` 的默认窗及 `before-task-center-narrow.log` 的 1100×720 窗在适应视图后都读到 8 个 DOM 节点。默认运行复现了证据和 User Data 写到仓内。`GenerationCanvasReactFlowViewport` 启用可见节点裁剪。 | `after-task-center.log` 在 1100×720 的真实窗口读到 8 个实际节点、6 个已挂载节点。两波任务使用实际 ID，取消后读回排队数 0。整窗已查看，原有的角标独立裁图探针仍报提示。 |
| `composer-b3-real` | `before-composer-b3-real.log` 本机原断言共 74 条通过，但英文截图已显示每个有档案模型带能力说明，且原脚本生成了两张未跟踪截图。历史夜跑在整行长度门槛报错。 | `after-composer-b3-real.log` 通过原有 74 条检查。中英均从 `NomiSelect` 独立读出 Wan 2.7 能力说明，并实际切换模型。真实分镜窗口另证有默认模型时显示继承说明和品牌图标。已查看中英截图。 |
| `model-menu-icons` | `before-model-menu-icons.log` 中英明暗四组均失败，分镜 3 行里有 2 个目录模型和 1 个「默认模型」操作。`StoryboardComposerParams` 将继承说明放进操作行，有可用默认模型时才给它品牌图标。 | 保留三面与变体断言，分别检查目录模型与继承行。`after-model-menu-icons.log` 在隔离 Chromium 中通过 128 条。已查看中英截图。 |
| `run-retrieval-recovery-real.rehearsal` | 夜跑的 Linux 关窗监听等待一个不会出现的新窗。macOS 隔离窗口调整监听与补试验目录刷新后，前七段通过。最后一段在 `windowOpenJourney` 点重试时，原断言使用已清空的 `nodeInFlight.hint`。截图 `retry-run-retrieval-recovery-real.rehearsal/zh-CN-fail.png` 显示现役「再发一次这张图片？」确认框。`3797fde0c`、`ff4749326` 明确以需确认的重发替代旧的持续拒绝。 | 旧旅程要求已删除的行为，已还原脚本。Linux 修改尝试未上真机。 |
| `generation-lock-exit-real.rehearsal` | 夜跑的 `ERR_INVALID_ARG_TYPE` 先于 `ENOENT`。显式给旧脚本传两条仓外路径后，关窗与强制退出通过。重载子场景收到 1 次 POST，点「重新取回」后状态从 `recoverable` 变为 `error`，界面显示缺少任务标识，60 秒内未取得原结果。收据为 `before-generation-lock-exit-real.rehearsal/reload/zh-CN-i6-reload.json`，同目录有失败截图。 | 真实恢复流程仍红，已还原脚本，目录修复未纳入。 |
| `agent-reference-upload-scope` | 相同 SHA 的夜跑已打开生成区付费卡且环回 multipart 上传已到，后续卡内提示词可编辑断言红。选择器指向现役生成区，卡内编辑和确认条的归属涉及在途 [#1548](https://github.com/aqm857886159/Nomi/pull/1548)。 | 整条保留原样。 |
| `agent-conversation-follow` | 相同 SHA 的夜跑出现 103/104 px 的流式距底峰值，跳回最新后仍有 26 px。`V4_FLOW` 对应 `AgentPanelV4Panel` 实际绑定 `scrollRef` 的容器，本机 `before-agent-conversation-follow.log` 复现流式距底峰值 104/83 px。 | 整条保留原样，包括原有距离阈值。 |

三条入选，六条保留原样，未达到五条的下限。`model-menu-icons` 在相同基线上由红转绿。任务中心与 Composer 保持当前基线的绿灯，并真实验证了原断言与现役契约的差异。修改后的三个脚本均已串行跑完。每条退出后核对工作树及进程，树守卫返回 0。
