# 生成底栏让位：宿主交数据，主人只量文字

方向已定：D-1118-bar-yield-route-yi（按乙重做）；复盘：[方向检查](../engineering/direction-checks/2026-11-17-bar-yield-r2.md)。梯子顺序、样子、文案和行为不改。

## 先查别人

- 出口：不涉及：不新增挡人的保护、权限、等待或恢复流程；放不下按已有梯子减少整值显示，不拦动作。
- [rc-overflow Item](https://github.com/react-component/overflow/blob/f1c801c98d76af8763448d3c55f88a7fc40ab5bc/src/Item.tsx#L73-L88)：隐藏的仍是原节点，用 ResizeObserver 登记宽度；确认不复制带身份的组件、直接按宽求解，但本域有多控件多样子，不能直接套其列表模型。
- [React Spectrum ActionGroup](https://github.com/adobe/react-spectrum/blob/360e35170568dfc99a2baaa78e6b7bdd36458d91/packages/%40adobe/react-spectrum/src/actiongroup/ActionGroup.tsx#L142-L195)：原地试画带字/图标态，collection 变动重试；确认不需要组件副本，本轮不引入会漏语言的重算钥匙。
- [Primer #7506](https://github.com/primer/react/pull/7506)、[#8133](https://github.com/primer/react/pull/8133)：先用换行裁切和交叉观察，后改固定断点消除图标抖动，代价是提早隐藏；确认固定断点不能满足本域“不多让”，必须用与当前让级无关的候选宽。
- [pretext](https://github.com/chenglou/pretext/blob/0d102a5cd933611e86a7e60bda7b4baa5995c6b0/README.md#L263-L272)：只量文字，但列出 macOS 系统字体、字体加载和 font-feature-settings 限制；确认沿用浏览器 DOM 排版和继承字体的文字尺子，不接 canvas 测量库。

## 短版设计卡

- ★1：创作者改参数、切语言、开关面板或重开宿主后，每颗按钮可命中，摘要只显示当前整值，只有真放不下才让；G1 用 `composer-bar-yield-history.walk.mjs` 四宿主×中英×五宽、两个随机种子各720步量路径一致性/命中/整值；G2 用 `composer-bar-yield-goals.walk.mjs` 量650真实样本和1200夹具上界全显示；G3 同一走查量换点叶子余量≤2px；G4 同一走查量全部数=可见数=1、下拉数=实际选择器数。★1b：引导聚光灯、模型报错指路和自动化读者仍指向唯一真控件。★1c：不改任何存储，项目/模型/设置和入口原样保留，无迁移。
- ★2：InlineParameterBar 是唯一量宽与定让级的主人；宿主交 `footer.send` 数据，底栏画唯一 ComposerSendButton。工具数门：`node scripts/door-map.mjs InlineParameterBar` 的直接入口为 NodeParameterControls、StoryboardComposerParams、nodeComposerBarLabKit；`node scripts/door-map.mjs composerYieldLadder` 的唯一写入口是 InlineParameterBar。前两入口覆盖画布、列表、镜头行、参考卡；实验室只复用生产组件。宿主生成动作生命周期仍归原 onClick 所属模块，本修复不新增超时或把未知当失败。
- ★3：复发类；主分支用钥匙漏输入，第一轮只观察当前样子漏掉隐藏文字，第二轮复制组件又复制身份和下拉。用户选乙：宿主提供生成文字数据，方式文字复用 NomiSelect 的取字逻辑；关闭影子根仅有文字 span，逐级宽从真实控件加减候选文字/外框算出。每次渲染和行/真实格/文字尺寸回调都重算，不存历史/签名。沿原方向给副本消身份仍有两套渲染路；删成固定断点会多让，均不采用。无新增依赖。
- ★4：空目录/加载骨架/失败与旧目录保留的显示照旧；busy、disabled、取消中和错误处理仍由宿主决定。可用宽变化只改变既定的生成字/摘要整值/方式字/模型省略；能力不可用仍走现有说明和配置入口。文字尺子 aria-hidden、不占位；尺寸只在同一布局坐标系相加，模型末级将被裁掉的文字宽加回，保留原模型控件的 maxWidth。中英文均量，不复制按钮、菜单或 Portal。
- ★7：无新增用户动作；320镜头、160文稿、配好Seedance2.5的打开性能场景 `storyboard-plan-open-configured`，主分支五次中位427.2ms，已定预算469.9ms；另跑 `canvas-select-composer-video-200`（200节点，预算100ms），报告中位/p95/长任务，不写基线。

## 调用方后果表

| 宿主 | 依赖 | 改后 |
|---|---|---|
| `creation/storyboard/anchorZone/StoryboardAnchorRow.tsx`（参考卡，任务书简写路径已核正） | 带字生成、忙态、参考卡读屏名/标记 | 数据原样传 send，回调原样保留 |
| `creation/storyboard/shotRow/ShotComposerBar.tsx`（镜头行） | 带字生成/状态标签、生成镜N | 生成数据传 send，状态标签放 trailing，位置和行为不变 |
| `generationCanvas/nodes/NodeGenerationComposer.tsx`（画布/列表） | 圆生成钮、数量、预览重渲 | 生成数据传 send，数量与重渲按原顺序放 trailing，圆钮无空的第①级 |
| `InlineParameterBar.test.ts`、`StoryboardShotRow.structure.test.ts`、`ShotBusyStates.test.ts`（快检发现的测试调用方） | 旧 action 数据与宿主直接画钮的结构断言 | 一并迁移 send，保留忙态和标记断言，并断言唯一主人只画一个生成钮 |

## 系统改进

最早应拦在设计：`ComposerFooterSlots.action` 是不透明 ReactNode，主人拿不到另一种样子的文字，只能在别处猜或复制。改为 send 数据并在唯一主人渲染，尺子构造仅接受文字、仅创建 span，删除量层副本、measuring、量层子节点观察。验收曾只量不出界/等于重开，没量不多让/身份唯一/性能；本轮保留独立的G1–G5，再加闭根结构检查与外框校准。两条真实旧案：主分支切语言/出界由G1/G3拦，复制版由G4/G5拦；反误伤：没有标签的画布圆钮仍能完整显示，不人为多一级。预测：两个种子各720步零失败、所有校准差≤0.5px、闭根只有文字、打开≤469.9ms；2026-11-24复查，任一失效重开，外框校准一个月改两次以上回到方向复盘。

## ★9 验收与反例

1. 原样运行 G1–G5；G1 两种子20261117/20261118，各720步；G2–G4 四宿主×中英。全部隐藏与主分支及复制版各作为反例：目标测试整体须红，逐项结果照实报告，不要求与缺陷无关的项也红。
2. `composer-bar-yield-calibration.walk.mjs`：每宿主×中英×每一级都真画，独立从完整样子的实测宽、文字宽和外框计算，与真画宽差≤0.5px；改坏 ComposerSendButton 外框常数应红、还原绿。470→660→470每2px往返与静置形状一致。
3. 同一校准走查加载前包装 attachShadow（仍建立 closed 根），只在测试持有根；断言每只底栏一个 aria-hidden 闭根、仅有纯文字 span，无按钮/角色/data-*；在尺子加按钮应此结构检查红、还原绿。它不冒充G4能穿越闭根。
4. 真实流程：隔离Electron、回环假供应商，Seedance2.5列表详情485px，英文→设置切中文，不回列表直接读让级，再重开比较；与用户真实条件的差别是临时项目与回环供应商，不做付费生成。生成钮、摘要、方式、模型、预览重渲、Esc、设置语言均真点并记结果。`composer-bar-yield-cycle.walk.mjs` 中英首挂载30帧逐帧不出界/与重开一致；分镜每行生成钮及各选择器唯一。截图逐张打开看。
5. `composer-bar-yield-transitions.walk.mjs` T1–T3；原 `original-storyboard-editor.test.mjs` 不改且须绿；标记读者全部按工具扫描运行。静止态与主分支逐格相同，出现变化立即停，不更新基线；线上完整设计实验室检查本机按任务书不跑。
6. 对改动文件eslint零新增警告，contracts按任务书排除禁止在本机跑的design-lab，prior-art、scan-guard-census与提交后pre-push；未测/失败/资源缺失分别记录，不以脚本退出0替代内部断言。

当前验收状态：未验证，结果写任务报告；真实复现、截图、各反例及恢复、性能数字均以本轮指定证据目录的实测为准。回滚为 revert 本轮实现提交，不动存量数据。
