# 设计卡：最小窗口下弹窗的决定栏被裁（按整类修）

```
改动名：弹窗外壳接管可用高度与滚动归属      线/负责人：I-min-window-dialog-clip      类别：[花钱][新界面]（改共用弹窗外壳 + 新增一条设计规则；花钱确认卡迁入外壳，所以也是花钱类；按四类填 9 格）
```

来由：夜跑分诊 #076（`feedback-delivery.walk.mjs` ②，Linux 夜跑 11-02 起 `RR?RRRR`）：App 最小窗口、英文、反馈卡内容最多时，「发送」被祖先的滚动区切掉。用户 11-09：「不要只修那个……把底层这些问题都修掉……建立系统，让底层这些问题不再反复发生」。

规则（用户 11-09 批方向 A、认过措辞，写进 `docs/design/nomi-design-system.md` §3.5）：**弹窗最高 = 窗口内容区减上下留白；标题栏和决定栏不滚，中间内容区自己滚；决定栏在任何窗口尺寸、任何语言下都完整可见。**

阶段：①（本次）外壳插槽 + 3 个代表弹窗（反馈卡、花钱确认 `SpendConfirmDialog`、模型设置详情）迁入 + 修前 / 修后配对图交用户看；② 用户认图后迁其余弹窗、普查加最小窗口档、跑全套。★2–★9 里标「阶段②」的项在第②步补齐。

## ★0 先查别人

1. Mantine 8.3.18 Modal（我们现在的外壳）· `node_modules/@mantine/core/styles.css`：内容块 `.m_54c44539 { max-height: calc(100dvh - var(--modal-y-offset) * 2); overflow-y: auto }`、`--modal-y-offset: 5dvh`，标题栏 `.m_b5489c3c { position: sticky; top: 0 }`；文档 <https://mantine.dev/core/modal/> 的滚动演示标题就叫 "Header is sticky"，没有 footer 的概念 · **确认了**根因：整个内容块一起滚、只有标题粘顶，按钮写在内容里就会被滚出去；**确认了**不换库——可用高度沿用 Mantine 这一处算好的上限（不再各写魔数），只把滚动挪到中间那块。
2. Atlassian Design System · Modal dialog <https://atlassian.design/components/modal-dialog/examples>：「the body content will scroll while the header and footer remain fixed」，另有 `shouldScrollInViewport` 一档改成整窗滚 · **确认了**方案 A 的默认（头尾固定、中间滚）；**决定**我们只给这一种，不提供「整块滚」那一档（少一个分支，规则一句话说得完）。
3. Fluent 2（Fluent UI React v9 Dialog）源码 · [DialogBody 样式](https://github.com/microsoft/fluentui/blob/master/packages/react-components/react-dialog/library/src/components/DialogBody/useDialogBodyStyles.styles.ts)：`maxHeight: calc(100dvh - 2 * 24px)`、grid 行 `auto 1fr`，动作排在内容之下；[DialogContent](https://github.com/microsoft/fluentui/blob/master/packages/react-components/react-dialog/library/src/components/DialogContent/useDialogContentStyles.styles.ts)：`overflowY: 'auto'`、`minHeight: '32px'`；[常量](https://github.com/microsoft/fluentui/blob/master/packages/react-components/react-dialog/library/src/contexts/constants.ts)：屏高 ≤359px 时取消上限、内容不单独滚 · **改了**：可用高度由外壳一处给，删掉各弹窗自带的魔数（反馈卡 `100vh-24rem`、`SkillDetail` `100vh-96px`、`ModelSettingsDetailDialog` `100svh-16px / 48px`、设置弹窗 `100svh-48px`、花钱确认 `88vh`）；**确认了**不做极矮屏退路：App 最小窗口高 720，远高于 359（写进「不做什么」）。
4. Material Components Web · [mdc-dialog README](https://github.com/material-components/material-components-web/blob/master/packages/mdc-dialog/README.md)：`mdc-dialog--scrollable`「Applied automatically when the dialog has overflowing content」，分隔线「display around scrollable content」 · **确认了**用户会看到的那处可见变化：内容一长，决定栏上方出现内容被截断的分界；第①步先不加分隔线（密度优先），修后图里把这一处单独指给用户看，要不要加线由用户定。
5. 仓库内先例 · `src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx:71-74,146,361`（多镜卡 / 形象卡「flex 列 + footer shrink-0，内容区滚动、footer 恒在」）、`docs/design/nomi-design-system.md` §4.5 toast（9-30：「正文再长在自己的文字区里滚动，按钮那一行的位置预留」）、`src/workbench/skillLibrary/SkillDetail.tsx:41,70` · **确认了**方向是仓库里已经在用的做法，只是散成 4 份手写；这次收进 `DesignModal` 一处。
6. 以前定过 · `docs/engineering/direction-checks/2026-11-01-feedback-manifest-copy.md` §6：「发送固定在底部、清单单独滚动」留到「清单再长一次时做」、要走界面拍板 · **确认了**这次就是那个触发点（Linux 夜跑 4 连红），且已按它说的走拍板。

出口：不涉及：只改布局和滚动归属，不新增、扩大或挪动任何挡人的保护。

## ★1 用户怎么用

当我用笔记本小屏（或把 Nomi 拉到最小 1100×720）、英文界面，某一步失败了，我想点「反馈这个问题」把情况发出去，以便开发者修：①失败面点「反馈」→ ②卡打开 → ③勾「带上内容」→ ④点「查看」看清单 → ⑤填一行留言 → ⑥点「发送」→ ⑦看到编号。卡在第⑥步：Linux / Windows 字体下英文清单多出一两行，「发送」被弹窗的滚动区切掉一截或整个滚出去，用户不知道要往下滚，或以为卡坏了。

同一类：分镜方案整批生成的确认（参考卡 + 十几镜的勾选清单）在小窗口里「生成 N 项」被滚出去；设置类弹窗各自写死高度。

- 不做什么：不改弹窗内容、文案、按钮顺序（§1.9.1 不变）；不改花钱语义（金额、勾选清单、回车 = 主动作、焦点落点、焦点陷阱、Esc / 点外面 = 取消、层级 dialog 9100）；不加横向滚动；不做屏高 ≤360 的退路（App 最小 720）；不改主进程最小窗口的值（只导出）；不碰锚点浮层（AnchoredPopover / Radix 菜单，普查已管）；第①步不迁其余弹窗。
- 已知坑：外壳和弹窗自己各套一层滚动会出现双滚动条；滚动区会把输入框的焦点环左右裁掉（滚动区要留出焦点环的边）；弹窗里没 portal 出去的内嵌浮层会被新的滚动区裁掉（第②步普查）；焦点陷阱、Esc、`useModalInputLayer` 都不能丢；弹窗只有 `max-height`、高度不确定，中间区里的 `max-h-full` 解析不出来（第一版反馈卡这样写，英文最小窗口留言框被滚出去、走查红），所以中间区要能做成 flex 列，要缩的那段写 `min-h-0`；但成列不能当默认——第二版让所有弹窗的中间区都成列，花钱确认内容最多那档的勾选清单（自带 17rem 滚动，flex 子项的自动最小高度是 0）被压成一条缝，所以改成弹窗自己传 `innerScroll` 才成列。
- Mac 复现（修前取证 `before/measure.json`）：反馈卡「发送失败」那一行出现时（勾内容 + 清单展开 + 错误说明），最小窗口下「发送」被裁 41px（中文）/ 59px（英文），亮暗都一样；Linux 夜跑那次是英文字体更宽，在没有错误行时就已超出。分镜整批确认修前没被裁（清单有自己的 17rem 上限）。
- 真实任务：T1 反馈卡最高状态（`feedback-delivery.walk.mjs` ② 的真实流程，隔离资料真起 App）；T2 分镜方案整批生成确认（真调用处 `storyboardRowActions.ts:456` 的形状：参考卡 2 张 + 镜头 12 个）；T3 设置 → 模型 → 内置那一家的模型设置详情弹窗。
- 指标（目标 → 信号 → 指标）：
  - 主：决定栏永远看得全 → 最小窗口 × 中 / 英下打开的弹窗里决定栏被裁 → 被裁弹窗数 / 量到的弹窗数 = 0（基线：修前取证 `docs/evidence/2026-11-09-min-window-dialog-clip/before/measure.json`）。量具：`feedback-delivery.walk.mjs` ② 断言（现有）、修前取证脚本；第②步起由弹层几何普查的最小窗口档守（阶段②）。
  - 质量：内容不超高的弹窗外观不变 → 1440×1000 原档普查全绿、实验室视觉基线无意外差异。量具：`popupGeometry.census.mjs`、`design-lab.visual.spec.mjs`。
  - 护栏：普查多一档后 PR CI 的增量时间（★7，阶段②实测）；量具：CI 计时。
- 新手 / 老手：新手第一次在小屏英文里发反馈；老手常在小窗口里批量生成。每步「预期 → 实际」用修前 / 修后配对图记（`docs/evidence/2026-11-09-min-window-dialog-clip/pairs/`）。

★1b 连带界面：所有走 `DesignModal` 的弹窗（13 个文件）与第②步迁入外壳的手写弹窗；不涉及 Agent 回执、通知文案。

第①步带出的可见变化（修后图里逐条指给用户，由用户认）：
- 反馈卡（失败面弹出的那张）：「发送」从卡内左下挪到弹窗决定栏最右，左边多一个「取消」（§1.9.1 决定栏：有主按钮就要有取消）。设置 → 关于里内嵌的那张卡不变。
- 花钱确认卡：遮罩色、关闭钮、标题栏间距换成 `DesignModal` 的（与其它弹窗一致）；Agent 发起时的副标并进标题（读屏一起念）。
- 嵌套滚动留到第②步：`PlanRows` 自带 17rem、`MultiShotContractSummary` 自带 `max-h-[40vh]`，在外壳中间区里仍各自内滚（第①步不动，避免同时改两件事）。
- 外壳一处、所有 `DesignModal` 都带上的：标题栏和决定栏不滚、超高时只滚中间（默认整块滚，`innerScroll` 才把高度分给内容）。内容不超高的弹窗外观不变（量具：`confirm-dialog` 修前 / 修后图、`design-lab-primitives-surfaces.walk.mjs`）。
- 花钱确认卡标题行距：Mantine 标题行距是 1，迁移后标题和 Agent 副标挤在一起；标题跟回正文行距（`leading-[inherit]`），和迁移前一样。

★1c 老用户：不适用：只改布局与滚动，不碰项目、设置、数据。

## ★2 谁说了算

- 「弹窗可用高度与滚动归属」→ 唯一 owner `src/design/overlays.tsx` 的 `DesignModal`；弹窗只给内容和决定栏（`actions` 插槽），不再自己写高度上限和外层滚动。同一份事实：修前 5 份魔数 → 1 处（Mantine 的上限）。
- 「App 最小窗口」→ owner 主进程（`electron/main.ts` 导出常量，值不变）；普查和走查只读它（阶段②）。
- 门表：`node scripts/door-map.mjs DesignModal`（13 扇读门）。

## ★3 一致与复用

以前定过：11-01 方向检查 §6（见 ★0-6），还算数。三条路：沿原方向修（再收文案 / 调魔数）= 同一处第 3 刀，撞 P1 停点，不选；换做法（外壳接管滚动、决定栏插槽）= 选，理由见 ★0；删（清单不写这么细）= 清单是同意书，不选。复用 Mantine Modal 与现有 `DecisionBar`，不自写弹窗、不换库。fix-churn 命中（反馈卡第 4 刀、花钱确认卡第 3 刀）的方向检查：`docs/engineering/direction-checks/2026-11-09-dialog-decision-bar-clip.md`（实现线写，独立的那份是 11-01 的复盘）。

## ★4 全状态

内容不超高：和修前一样，决定栏紧跟内容；超高：标题栏和决定栏不动、中间滚；加载中（清单 loading）：同上；发送失败 / 没配接收端：说明行在内容区里、按钮在决定栏；能力不可用（没有桌面桥）：发送禁用并写明原因（C1，不变）；发完：卡收成一行回执，决定栏消失。文案不变，不新增 i18n。

## 5 中途表

不适用：只改布局，不引入新状态或新异步；关窗 / 重启 / 断网的行为与修前相同（由 `feedback-delivery.walk.mjs` ③④⑥ 守）。

## 6 外部数据与失败

不适用：不碰外部来源。

## ★7 性能

不是新增功能：不新增用户操作。普查多一档的 CI 时间在阶段②实测后填。

## 8 真实条件

最小窗口 ✓、英文 ✓、亮 / 暗 ✓（修后图）；Linux 字体：本机复现不出（Mac 上 main 走查是绿的），以修前取证量出的余量说明，Linux 实证待第②步 CI 跑；Windows：unverified。

## 拍板图清单

第①步用真图 + 实验室真组件格交用户看；认图后在第②步登记清单。

## ★9 验收与回滚

验收清单（动手前写全）：
1. 反馈卡：最小窗口 × 中 / 英 × 亮 / 暗、内容最多（对话里的问题 + 勾内容 + 清单展开），「发送」完整可见，不用滚就点得到；`feedback-delivery.walk.mjs` 两轨绿。
2. 反馈卡的清单不再写自己的高度数字（`100vh-24rem` 删掉）：在弹窗里清单是卡里唯一会缩的那段（反馈卡传 `innerScroll`，外壳中间区成 flex 列；卡根 `min-h-0`、清单 `min-h-0 overflow-y-auto`，窗口多高给多高），留言框和发送后的说明行始终看得见（`feedback-delivery.walk.mjs` ②「留言框点得到」）；内嵌在设置 → 关于时随页面滚。
3. 花钱确认（分镜整批）：最小窗口 × 中 / 英，「取消 / 生成 N 项」完整可见；勾选清单在中间滚。
4. 设置类（模型设置详情）：最小窗口 × 中 / 英，弹窗整块在窗口里，不再自带高度魔数。
5. 内容短的弹窗（`confirmDialog`）修前修后外观一致。
6. 焦点陷阱、Esc 关闭、点遮罩关闭、`useModalInputLayer` 照旧。
7. 花钱确认卡语义不变：金额与勾选清单（`PlanRows`、`togglePlanRow`）一行没改；打开时焦点落在对话框本体、不落在「确认」上；焦点在卡里非控件处时回车 = 主动作，焦点在按钮 / 输入框上时回车归那个控件（同一判据从卡挪到弹窗根）；焦点陷阱由外壳给；Esc / 点外面 = 取消；关闭后焦点还给打开前的元素；层级 dialog 9100（高过任务中心 4000，低过破坏性确认 9300）。量具：`tests/ux/spend-confirm-a11y.walk.mjs`（免费走查）+ `SpendConfirmDialog.test.tsx` / `SpendConfirmHost.test.tsx`。

反例（交回前自己做「改坏 → 红、还原 → 绿」）：
- 把 `DesignModal` 的滚动归属改回 Mantine 默认（内容块整块滚）→ `feedback-delivery.walk.mjs` 最小窗口英文那条在本机能红的条件下必须红；第②步起普查最小窗口档必须红。
- 外壳结构测试 `src/design/overlays.structure.test.tsx` 的三个反例（已做，日志在 `docs/evidence/2026-11-09-min-window-dialog-clip/counterexample/unit/`，还原后 cmp 一致、4 条全绿）：
  - 中间区改回 Mantine 默认（`display: contents`，整块滚）→ 红 2 条（「三段是一列」「默认不成列 / innerScroll 才成列」）；同一反例构建里反馈卡英文最小窗口「取消 / 发送」被裁（`counterexample/*.png`）。
  - 中间区不管传不传 `innerScroll` 都成列（第 2 版的做法，花钱确认的勾选清单被压扁）→ 红 1 条「默认不成列」。
  - 决定栏挪进中间滚动区里 → 红 1 条「决定栏住在中间滚动区之外」。
- 把普查的最小窗口写成测试里的数字 → 新加的「普查用的值等于主进程的值」断言必须红（阶段②）。
- 这一类会从哪回来：新写的弹窗不用 `actions` 插槽、把按钮塞进内容里；手写弹窗自己再写 `max-h`；英文 / Linux 字体更宽；窗口更矮。

回滚：revert 本 PR 的提交（外壳与 3 个弹窗同一提交）。真实场景复现：用户流程 = 夜跑 #076 的 Linux 最小窗口英文；我走的 = Mac 隔离资料真起 App、同一流程；差别 = 字体（Mac 余量约一行内，Linux 超出）；修前 / 修后见 `pairs/`。

## 用户拍板（2026-11-09）

用户看过阶段①三张修前修后配对图（反馈卡、花钱确认内容最多档、模型设置详情，中文亮色；英文和暗色同目录）后回复：「认可，不加线」。
- 认可的可见变化：反馈卡「发送」挪到弹窗底部按钮排右侧、左边加「取消」；花钱确认卡换成标准弹窗的遮罩、关闭按钮和标题栏间距，Agent 发起的副标题并进标题。
- 底部按钮排上方不加分隔线。

## 阶段②实施合同（2026-11-09，动手前）

范围：普查 DesignModal 14 个调用文件（其中 1 个实验室）及所有手写 role=dialog / Portal / fixed 外壳。全量迁移至少涉及 16 个产品外壳及各自测试、取景，超过任务书 25 文件限额；本批优先迁设置、浏览器提取设置、技能详情，余项逐个列入交接报告。仅沿用用户认可的标准遮罩 / 标题栏 / 底部按钮排；不新增控件、文案、分隔线，不动花钱语义。

★0 沿用本卡已查的 Mantine / Atlassian / Fluent 三条：保留 Mantine 可用高度、同一 actions 插槽，删手写高度计算；不更换依赖。出口：不涉及：没有新增拒绝或等待。
★1 用户打开设置或技能详情，在最小窗口下读长内容并完成保存 / 放进对话。量具：现有 popupGeometry.census.mjs 扩展 1100×720 中英档，量决定按钮相对所有裁切祖先与视口的矩形；迁移三张真组件中英亮暗修前修后截图。基线先测，不猜。★1b 不改回执；★1c 不改数据、存储及入口，无升级迁移。
★2 唯一高度和滚动 owner 是 DesignModal；设置原有未保存确认、Esc 下钻逻辑照旧，仅删 Portal / 遮罩。入口表由 door-map.mjs DesignModal 生成，完整输出进本线 tmp。
★3 用户规则 A 及阶段①「认可，不加线」继续有效。三条路：调魔数会复发；采用现成外壳可消除重复归属；删内容损失创作功能。因此迁外壳、删旧。
★4 空 / 加载 / 成功 / 失败 / 部分成功 / 取消中 / 过期 / 能力不可用全沿用原组件；仅将已有决定按钮放 actions。
5 关闭 / Esc / 连点 / 断网 / 重启：保留原回调、未保存确认及持久化行为；没有生成请求和费用变化。
6 外部数据：不改来源和验证。
★7 非新增功能；普查新增档耗时本机实测，CI 耗时未验证。
8 真实条件：Mac 真组件隔离实验室；设置再用隔离 Electron 用户流程验证；Linux / Windows 留 unverified，不能以本机绿顶替。
★9 动手前验收及反例：
- 三张迁移组件均使用 DesignModal、删掉自带 Portal / viewport 高度；技能与提取设置的决定栏只在 actions，标题不随内容滚；每张中英亮暗配对截图。
- 设置无通用决定栏（各区块即时保存、模型子页各自决定），保留侧栏和 Esc 下钻，不凭空添加保存。原任务提到的保存裁切另由提取设置卡实测辨认。
- 把每张有决定栏的迁移弹窗 actions 整段挪回 children → 对应结构测试必须红，按字节还原后绿；设置改回手写外壳 → 结构测试红。
- 最小窗口档读主进程共享常量，不抄 1100/720；改坏为固定过高高度 → 几何普查红，还原绿；把最小窗口改成字面量 → owner 结构断言红。
- PlanRows 是对话流与弹窗共用清单，17rem/13.5rem 保留：它控制清单可读范围，决定栏已在外壳之外，不定义弹窗高度；MultiShotContractSummary 只在花钱弹窗中，删其 40vh 内层滚动，由外壳中间区滚，避免双滚动。
- 对比点：按钮完整可见、不在滚动区；标题不滚；内容能滚；无新增分隔线；原有输入 / 取消 / 保存回调、设置未保存确认与层级保持。

限制：其余手写媒体 / 全屏工作区 / 引导特殊形态更换外壳会改变布局结构，须另行看图；不得以本批完成宣称全类已解决。
