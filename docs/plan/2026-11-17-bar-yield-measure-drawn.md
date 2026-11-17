# 生成底栏「窄了谁先让」：所有候选自然宽直接定让级（短版设计卡）

方向检查：`docs/engineering/direction-checks/2026-11-17-bar-yield.md`；第二轮按已定 D-1117-bar-yield-hide-value / D-1116-unwritable-first 执行，梯子与顺序不改。

- ★1 修复什么：底栏每个可点控件中心可命中，摘要只显示当前整值；同一内容/语言/宽度的让级与到达路径无关。真实逃逸：485px、Seedance 2.5、列表详情，英文方式收图标后经设置切中文仍停第4级，重开才回第3级。量具：`tests/ux/composer-bar-yield-history.walk.mjs`（四生产宿主×中英×485/574/598/600/650，固定种子，逐步与同最终数据的新挂载比）、`composer-bar-yield-transitions.walk.mjs`、`composer-bar-yield-cycle.walk.mjs`（真 Electron、回环假服务、不花钱）。未验证：线上静止态165格对比，本机按任务书不运行。★1c 老用户：无存储改动。画布第①级空级（Boolean(footer.action)）只记录，不动。
- ★2 谁说了算：`node scripts/door-map.mjs composerYieldLadder` 工具输出1扇写门：`src/workbench/generationCanvas/nodes/InlineParameterBar.tsx`，symbol `composerYieldLadder`；两跳调用为 NodeParameterControls（画布/列表）与 StoryboardComposerParams（镜头/参考）。其它组件只读 ComposerBarYieldContext。四宿主行宽由 ComposerAnchor/composerCanvasPlacement、列表卡宽、StoryboardRowsBox 的网格内容列给定，底栏 w-full/min-w-0，不随内容反撑。
- ★3 为何这样改：症状是多让或压住；直接原因是仅观察已画出的格；类根因是让级依赖未画出的样子，而观察源依赖让级。复发类。补语言/参数清单会继续漏；纯CSS做不了已拍板的离散顺序；选甲：所有候选参数样子与发送钮用相同生产组件隐身排版，以实际间距/固定格自然宽直接求首个可容纳级。固定工具/数量读取原件，避免复制其浮层/ref/生命周期。观察行宽、量层候选和固定格，均不随让级改变；内容/字体/语言变化由尺寸变化驱动。删逐级试排、yieldWatchedElements、sizeSignature、seen比较及每提交重挂的旧effect，无并存兜底。组件内部量法之外的函数行为不改。
- ★4 全状态：面板开着即显示当前值，放不下整值减少；方式、生成钮和末级模型省略仍按原梯子。静止态不增减元素/样式/文案；不改存储及生成请求路径；验证须回环假服务、不得访问用户资料（本轮首次窗口隔离失误另在交付报告披露）。量层 invisible/absolute/inert/aria-hidden，不占位、不点、不读屏，面板portal只存在于真实触发器。
- 系统改进：最早漏在验收。第一轮T1/T2只验不出界，T3只看静置，无法发现「不出界但多让」。新增总测试每一步同时验命中/当前整值/等于重开；删一个量层观察对象应红。两条真实旧案为冻结旧值/关面板出界（main）和短语言多让（fe2d94857），反误伤样本为节点上方浮条自己的夹紧测量。门岗改为两目录默认禁尺寸读取，现有无关量法逐文件附理由豁免；data-yield-item 对全src生效，只许本组件。预测：所有720步0失败，六个静态改坏及一个观察改坏均红→还原绿；复查日2026-11-24，有新让位内容/入口合入时重跑该总测试，任一不成立重开。
- ★7 性能：沿用 `canvas-select-composer-video-200`（100ms）与 `storyboard-plan-open`（1000ms）量具；不写基线，数字与预算收据随报告。标准夹具与回环配好模型的夹具分开报；后者在计时终点确认真实选中 Seedance 2.5、摘要含5s及量层候选已挂载。探针金丝雀只写 stderr，不能污染子进程的密文/版本 stdout 协议。超预算停。

## ★0 保护出口

出口：不涉及：本轮没有新增挡人的保护、拦截或恢复流程；底栏放不下时按既定梯子整值减少，不禁用已有动作。

## ★9 验收与反例（独立目标测试合同，L-bar-yield-goal-tests）

测试目标：任何路径/参数/语言/宽度后按钮可点、摘要为当前整值，只有真放不下才少显示；每只底栏只有一份按钮；配好模型后打开分镜不明显变慢。本线只改测试、perf 登记与本节，不修产品。完整定义以协调私仓方向检查 `2026-11-17-bar-yield-r2.md` 第 6 节为准。

1. **G1 等于重开**：`tests/ux/composer-bar-yield-history.walk.mjs` 四宿主×中英×五宽，逐步检查控件命中、出界、整值及同数据重挂的让级/摘要。反例：产品换回 `origin/main`，预期 canvas/en/485 第0步红；恢复 PR 后绿。随机数取高位，20261117/20261118 各跑一遍，报告实际随机动作的语言、busy、四种清晰度覆盖。
2. **G2 放得下就全显示**：`composer-bar-yield-goals.walk.mjs`，canvas/en/650 与各宿主/中英/1200：显示方式名、全量摘要、模型名无省略；分镜行/参考卡还要显示生成按钮文字。反例：让级固定最后一级，应红；恢复后绿。读显示文字，title 只用于核对全量值，不能当显示文字。
3. **G3 不多让**：同一走查在400–1200寻找屏上样子变化并二分到最小宽，参数条右缘减最后一个 data-yield-item 右缘应≤2px（容许0.5px布局误差）；不以级号定义样子，不用行宽减子项宽。必须发现方式名/摘要值/发送钮文字恢复的换点；仅模型名自然解除裁切不能冒充这些值恢复。反例：固定最后一级没有字恢复→红；恢复后换点余量绿。若真实PR也红，保留事实，交下一实现线。
4. **G4 没有第二份**：同一走查数每只底栏宿主里的 generate、模型 aria-label、data-storyboard-generate-state、data-parameter-summary，全部数=可见数=1（宿主没有的标记为0）；document 下拉数=画着的 NomiSelect 数。反例：当前PR隐形复制层必须红；换回main应绿，不准用 :visible 过滤掉副本再计总数。副本问题尚未实现，恢复PR仍红，明确记录。
5. **G5 打开不明显变慢**：现有 `document-switch-bench.mjs --scenario plan-open --configured-model`，loopback/合成凭据，终点核实 Seedance2.5 与5s摘要；登记 `storyboard-plan-open-configured`。main五次中位作基准，预算提议=中位×1.10，`budgetStatus: proposed`，协调定数；三个版本照量，不能把旧的无模型1000ms预算冒充本判据。

首挂载：`composer-bar-yield-cycle.walk.mjs` 由尺寸回调启动，在每帧布局/RO后记录30帧；宿主定宽后每一帧的让级都应等于同数据重开，并且无出界。两轨截图须看过。既有按 data-yield-item/data-bar-segment/data-storyboard-generate-state 量到的 walk/.test 全部运行，失败和未完成如实记。

反例与恢复日志、三版本5×3表、perf原始样本都写协调指定仓库外目录；不以未来修复的绿替代当前实测。停止条件依任务书，当前PR上G4/G5红是要揭示的产品缺口。
