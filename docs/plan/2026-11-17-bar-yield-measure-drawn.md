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

## ★9 验收与反例（实现线自验）

1. 总测试：四处宿主×中英×五档宽度，固定种子20261117；改值、开关参数面板、语言、模型/方式、宽度、生成中往返。每步所有可点控件中心 elementFromPoint 命中自身/子元素；摘要为当前整值、无截断；让级/摘要与同最终数据新挂载相等。fe2d94857必须抓短语言多让；main记录真实结果；修后全过。原有DOM走查以data-node-composer-footer为可操作底栏，inert量层不计第二颗按钮，数量与命中判据保留。
2. T1「面板开着改长→关」不出界、不相压、当场新值；T2「摘要不变、方式名字变宽」重量；T3三次参数改动/关后静置让级零抖动。原三轮真窗走查中英各跑，摘要、滑杆/清晰度、Esc均真点。
3. 真窗构造①：Seedance2.5、列表详情、停靠后拖到底栏485px，英文→设置中文，不回列表读/截；第一轮应4≠重开3，修后等于重开；两种语言都读回，截图亲眼查看。
4. 真窗首挂载：在分镜行挂载前安装逐帧记录（代码在cycle.walk），连续30帧记录宽度/让级/出界；宿主定宽后的每帧均不出界，末帧级=同数据重开；中英截图查看。
5. 原四门岗反例：ComposerSendButton 加 getBoundingClientRect / offsetWidth / new ResizeObserver，NodeFloatingToolbar 打 data-yield-item，分别红→字节还原绿。
6. 三个卡外洞：NodeParameterControls 实挂观察且不引让位模块→红；ComposerSendButton 真按钮打标→红；原「删签名比较不红」路径随签名整段删除，不再有此比较可删。新的动态反例：删量层候选观察→总测试红，按字节还原→绿。
7. 新反例三条为5/6之外的短语言多让（只看已画格）、宿主晚定宽（只取700ms后末态）、只看当前让级不与新挂载比；均由总测试或首挂载逐帧记录守。非误伤样本 NodeFloatingToolbar 的原有定位观察应保持绿。
8. 静止态165格与主分支逐格相同由线上 check:design-lab 核；本机不写基线、不跑该项。回滚为revert本轮提交；无迁移。
