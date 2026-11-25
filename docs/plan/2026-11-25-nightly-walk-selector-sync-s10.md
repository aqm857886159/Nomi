# #1121 夜跑走查现役契约同步 · 第十批

协作看板 #1586 · I-1。基线为 `8ac07cffb`。

## 短版设计卡

- ★1 依赖夜跑的维护者需要从真实界面的断言区分脚本漂移和生产回归。以原命令复现、同命令复验，目标为 5–8 条退出码由非零变为 0，按脚本日志、实际渲染和回环请求记录计数，付费请求为 0。以 `git status --porcelain`、进程表和树守卫核对每轮只用一扇隔离窗口且收尾干净，以在途文件清单核对零冲突。存量项目迁移不适用，本批只修走查。
- ★2 状态由实际渲染组件和样本注册表持有，外壳入口由 `tests/ux/_shell.mjs` 指引，画面和请求由走查记录。用 `node scripts/door-map.mjs DiagnosticsBundleSection ModelPickerStage AssetsDrawer ProduceButton AssetReferenceButton --include-tests` 枚举诊断页、实验室、导演台和参考入口，结合概念登记 `catalog.model-text-declaration`、`agent.reference-attachment-claims`、`storyboard.shot-outbound`、`spend.confirmation-requirement`、`production.shot-generation-ownership` 及 `rg` 查同类入口。测试从组件读事实，进程退出后由启动器收尾，失败由日志保留。
- ★3 按现役样本和启动器调用约定同步走查，保留现有截图和断言机制。工具为 `git log`、`rg`、`launcherDirs.test.mjs`。历史夜跑分诊已区分选择器、真产品问题与夹具，各批重复发生说明这是走查契约漂移；最早能拦在组件或样本变动的验证环节，当时结束前未执行受影响走查，静态门岗只能查形状。实验室与外壳共享现成测试边界；生产修复、改运行模式或删走查均与本批目标不符。
- ★4 空态应显示出路，加载应保留进行中或禁用，成功应看到结果或准确请求数，失败应看到错误或留下失败日志，部分成功应按镜头统计，取消中和过期沿用现役行为。本批能力不可用时保留可见的连接入口或上游错误，能连接时由用户进入设置重试。用真窗截图、DOM 状态、任务文件和回环请求计数核对受影响样本的实态，覆盖脚本既有中英或明暗路径。
- ★9 逐条重放原命令并核对付费计数与进程退出，按任务书执行 `check:walkthroughs`、`check:test-temp-static`、`check:test-waits`、lint-changed、launcherDirs 定向测试、`check:test-types` 与 `checkDesignCard`。变异一恢复未认领的设置样本，现役失败卡将无法通过状态覆盖；变异二恢复按旧尺寸裁切，完整下拉需报溢出。保留能发现未发生用户动作、目标未落地或请求数错误的断言。回滚用 `git revert` 本批提交。

## 实际回放

| 走查 | 基线观察 | 现役契约与复验判据 |
| --- | --- | --- |
| `design-lab-settings` | 6 个 assisted 样本未认领 | 退出 1 → 0。`AiAssistedOnboardingCard` 与 `AssistedIntegrationProgress` 给出接入、进行中和失败的读口。暗色失败格显示确切步骤与原始 402 原因，诊断 5 格继续验原状态，共 11 格通过。 |
| `design-lab-vendor-order` | 下拉底部比取景舞台多 45 px，空态已换词 | 退出 1 → 0。在截图前把采样框从 320 px 扩到 384 px，原宽 460 px 足够，四边均在框内。11 格通过，空态只有带现况和连接动作的一行。 |
| `design-lab-catalog-liveness` | 等不到「更多」 | 退出 1 → 0。`793ab8b25` 从取景样本移走退役型号，现役夹具只含四个当前型号。明暗两格都验证当前型号可见、未列出型号可手动启停与删除、本页无历史分组按钮。 |
| `director-j5-splat-valley` | 本机基线退出 0，抽屉可关 | 保留原文件。本机真实解码 15,000 个点并实测视差 114 px 对 29 px。夜跑的关抽屉故障在本机未复现。 |
| `director-reference-attach` | A 已通过「出成片」并向回环提交 1 笔，旧脚本继续等确认框 | 退出 1 → 0，中英复验均通过。`ProduceButton` 仍在导演视图顶栏。`spendConfirmationRequirement` 允许人手单镜直发，A 至 D 各语言共 5 笔回环请求，核对删参考后撤销、参考顺序与提示词编号。 |
| `agent-process-tone` | 成功的工具行没有 `summary` | `1830b25ad` 明确移除了成功回包展开体，原脚本还核对成功回包中的 Markdown。保留原文件。 |
| `agent-inflight-shots-reload` | 卡已显示，找不到单独的「全部」切换；通过该步后还存在旧的「↑ 置灰」断言 | 保留原文件。试走现役双镜主按钮和 `_generatingResendGate.mjs`，重载前两镜都在生成，取消重发无额外请求。首次重载时回环任务仍在 processing，两个节点立即变为「任务可能已在上游完成」，出现「重新取回」，与该走查的持续在途判据不同。留待核对现役生产恢复约定和 Run 状态。 |
| `storyboard-confirm-selection` | 排除两镜后正确发出两笔图片；第 1 镜切视频后保留 3 秒，被 Seedance 2.0 的 4 秒下限挡下 | 退出 1 → 0。夹具给 5 秒合法时长。视频 POST 恰好 1 笔，回环夹具结束 processing 后视频落盘，切默认模型后仍是视频镜。 |
| `reference-entry` | 英文深色的最小窗里 Nomi 面板已收起 | 退出 1 → 0。通过 `ensureAgentPanelOpen` 走 `ShellNomiEntry` 的现役入口，直接拾取、`@` 搜索、选中目标与参考的实际出站数据均通过。 |
| `anchor-real` | 真窗到达分镜表后报「旧行为锚未消费」，找不到 `data-anchor-consumption-warning` | `ec786acb2` 退役锚点隐式消费警告，`compileShotOutbound` 按行上实际参考编译。保留原文件。 |

两条变异对照来自基线实跑。设置图漏认领时明确报出 6 格；供应商浮层原高时明确报下方溢出 45 px。命令日志、回环报告、基线和复验截图均归档于仓外取证目录。

六条入选走查均按各自入口串行执行。三条实验室走查使用 Chromium 读现役组件，另外三条使用隔离 Electron，回环接收方或本地渲染共 0 付费请求。每条最终复验的树守卫、`git status --porcelain` 对照及子进程回收检查均通过。在途清单无交集。

用夜跑汇总在 2026-12-02 复查本批。预期入选走查的旧失败签名为 0；再次出现时按失败签名回到相应组件或测试边界分诊。
