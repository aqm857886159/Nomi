# UX-simple Phase 2 · PR-UX4

2026-11-24 · 分镜编辑器 · Phase 1 #8 和 #17①，基线为 `1730b7ea3`。 [协调批准](https://github.com/aqm857886159/Nomi/issues/1586#issuecomment-7126279479) · [验收要求](https://github.com/aqm857886159/Nomi/issues/1586#issuecomment-7125128356)

## ★0 先查别人

- [StoryboardOnlyWhatWorks 拍板图](../design/boards/2026-11-02/StoryboardOnlyWhatWorks.board.json) · 有卡才有可展开的内容，页脚已承载常驻动作 · 确认空态单独给动作，添加镜头进入页脚。
- [WorkbenchButton](../../src/design/actions.tsx) · 次级动作使用默认变体，小尺寸自带图标档位 · 确认两处共用按钮，沿用已有词条。
- TanStack Virtualizer 3.17.0 的已安装源码 · `scrollToIndex` 按项目下标滚动，动态行高变化后校准位置 · 统一由分镜表定位和交出焦点。 [TanStack Virtualizer](https://tanstack.com/virtual/latest/docs/api/virtualizer)
- 出口：不涉及：两处为本地计划编辑，未加入拒绝、等待或锁。

## ★1 用户怎么用

创作者打开空参考区的分镜，先写镜头或加共享参考卡。即使两镜塞满屏幕，也能立即续写第三镜。判据由协调审批与本次任务给定。

1. 在隔离 Nomi 新建项目，从创作打开两镜方案。
2. 首屏确认空提示同行有添加参考动作，展开开关没有出现。
3. 点一次添加参考，立刻看到可编辑行。填一个名字。
4. 返回同一方案，读回卡名。
5. 从当前滚动位置点固定页脚的添加镜头。新镜进入可见范围。
6. 填第三镜提示词，重开同一方案核对镜数、提示词和已有镜头。

真实任务是录入故事的共享角色参考，以及从双镜计划继续写第三镜。两条路径使用真实桌面和真实本地保存，过程无需素材或付费账号。Phase 1 同类样本是初建两镜和已拉窄的两镜窗口。

| 目标 | 信号与指标 | 基线 → 目标 / 量具 |
| --- | --- | --- |
| 首屏可创建首张参考卡 | 首次点击就进入可编辑态的轨道比例 | 0/5 → 5/5，`verify-nomi` 点击前后 DOM、真窗截图，浏览器单测另查动作被拦的反例 |
| 加镜后可接着编辑 | 首屏加镜成功且新行进入视口的轨道比例 | 0/5 → 5/5，`verify-nomi` 页脚命中测试、滚动区与行 DOM 矩形 |
| 既有动作可达 | 固定栏保留动作、重开读回成功的轨道比例 | 目标 5/5，`verify-nomi` 真窗与读回，`check:board-parity` 校验已签断言 |
| 大方案仍可打开 | 首屏可编辑耗时 | 预算 1000 ms，`storyboard-plan-open` 五次运行 |

**★1b 连带界面**。计划计数和进度随同一份数据刷新。Agent、通知、队列与生成回执沿用各自现有入口。
**★1c 老用户**。项目、镜号、模型参数及设置继续由既有计划结构保存。旧方案直接打开，升级与回退无需迁移。添加镜头从表尾移到页脚，按钮名称和已有选择器沿用。

## ★2 谁说了算

`StoryboardAnchorZone` 管理空态、展开动作和增删后的焦点，生产版展开状态由编辑器持有。`StoryboardPlanEditor` 将点击转换成计划编辑，`setStoryboardPlan` 按文稿和方案写入原 store（概念 `storyboard.plan-per-request`）。新镜由主体身份分配器发号，保存成功后将身份交给虚拟表。表负责展开目标场、滚动及聚焦提示词（`storyboard.table-windowing`）。保存由原项目持久化处理，重新打开可核对。两处无异步生成请求。

### Door map

以下结果来自逐一运行 `node scripts/door-map.mjs <symbol>`。共享读写路径按文件去重，后续核对了文稿/方案 store、实验室和依赖按钮名的走查。

| Symbol | Kind | Paths counted by tool |
| --- | --- | --- |
| `StoryboardAnchorZone` | 5 read | `src/workbench/creation/storyboard/StoryboardPlanEditor.tsx`，`src/devlab/designLab/nodeComposerBar/yieldHistoryLab.tsx`，`src/devlab/designLab/storyboard/states/03-zone.tsx`，`src/devlab/designLab/storyboardReuse/storyboardLayoutLabKit.tsx`，`src/devlab/designLab/storyboardReuse/storyboardReuseLabKit.tsx` |
| `StoryboardPlanEditorFooter` | 2 read | `src/workbench/creation/storyboard/StoryboardPlanEditor.tsx`，`src/devlab/designLab/storyboardBatch/storyboardBatchLabKit.tsx` |
| `addAnchor` | 1 write | `src/workbench/creation/storyboard/StoryboardPlanEditor.tsx` |
| `setSelfExpanded` | 1 write | `src/workbench/creation/storyboard/anchorZone/StoryboardAnchorZone.tsx` |
| `addShot` | 1 write | `src/workbench/creation/storyboard/StoryboardPlanEditor.tsx` |
| `setStoryboardPlan` | 1 read, 7 write | 读写 `src/workbench/creation/storyboard/StoryboardPlanEditor.tsx`，写 `src/workbench/capability/storyboardPresent.ts`、`src/workbench/creation/storyboard/agentStoryboardDesign.ts`、`src/workbench/creation/storyboard/exec/storyboardActionGuard.ts`、`src/workbench/creation/storyboard/exec/storyboardOverrideActions.ts`、`src/workbench/generationCanvas/agent/applyCanvasToolCall.ts`、`src/workbench/onboarding/journeyTourStore.ts` |

## ★3 一致与复用

v6 §2.2 保留参考区全开/全收，已签板的参考区示例有两张卡。11-02 板的 footer.back / footer.progress / footer.generate-remaining 继续沿用。比较了沿现有 owner 调整、复制快捷入口和删除动作。选前者，两个动作在各自状态下各有一个可用入口。分镜尾部原有虚线按钮随迁移撤下。沿用 `addAnchor` / `addShot`、`WorkbenchButton`、`storyboardEditor.addAnchor` / `addShot` 和表格窗口化。走查含对旧文案的精确点击。

**系统改进**。归为 recurring，同一用户可在每个零卡方案复现 #8，并可在每次滚动区高于视口时复现 #17①。最早可拦处是设计/验收时的状态覆盖。已签板参考区使用有卡样本，页脚断言聚焦生成，已有测试只看能否滚动或手动展开后再添加。结构上让空态自带添加、展开只服务有卡状态，并让唯一加镜入口脱离滚区。新增验收从可视点位直接点击并读回，零卡旧实现和拦掉写入应红，有卡展开与短表正常交互应绿。根因合同随本次允改的证据目录保存。下次同类分镜变更复查这三个样本及 5/5 轨通过率，复查日 2026-12-01。

## ★4 全状态

| 状态 | 界面表现 |
| --- | --- |
| 空 | 参考卡空提示和次按钮同行，容器窄时可换行，加镜常驻页脚。 |
| 加载 | 方案可用即显示本地动作，其他加载状态沿用现有组件。 |
| 成功 | 首张卡展开并可改名，新镜继承原加镜逻辑并滚到可编辑位置。 |
| 失败 | 计划 owner 判定写入，真实结果由行和镜头数显示。 |
| 部分成功 | 加卡和加镜各自写入，卡/镜数分别反映结果。 |
| 取消中 / 过期 | 两项操作同步提交，保存由项目持久化处理。 |
| 能力不可用 | 无模型配置仍可以加卡、加镜和写提示词。 |
| 最大值 / 最长文案 | 大方案保留窗口化，页脚沿用摘要的 min-width 和截断，让出中英文操作宽度。 |

## 5 中途表

| 阶段 | 停 | 关窗 | 断网 | 重启 | 连点 |
| --- | --- | --- | --- | --- | --- |
| 点击前 | 可返回 | 重开可继续 | 本地动作可用 | 读回旧计划 | 每次有效点击由原编辑器处理 |
| 写入后 | 可直接编辑 | 走原项目保存 | 无需网络 | 读回落盘卡或镜 | 每次有效点击新增一项，列表与计数更新 |

本地计划编辑不发生成请求，每格回执都在方案。

## 6 外部数据与失败

唯一输入是已打开的用户计划，store 继续校验写入。滚动与动态窗口化由现存表格处理。网络旁证通过隔离驱动的供应商请求记录。

## ★7 性能

### 推送前复验

**★1 / ★9**。保住手建与 Agent 对 `shot-1`、`shot-2` 的双语寻址。51 镜删第 2 镜后，新增行号 51、身份 `shot-52`，其余身份保持原样。用双语 loopback、编辑单测和浏览器动作测试验收。原 UUID 路径与按行号碰撞的反例均应失败。用 `check:filesize` 核编辑器和表格低于 856 / 742 行，用本节登记的场景复测。

**★2 / ★3**。继续使用唯一身份分配器发号。保留 UUID 会破坏首建寻址，删加镜会阻断续写。最早的拦截点是第一次调整发号时的实现验收，原点击测试覆盖目标行但没有核对身份契约。双语矩阵核对手建和 Agent 入口的前两镜，编辑单测核对长方案与旧行重排。把焦点交接移到两个编辑器 hook。2026-12-01 复查双语矩阵及 51 镜反例。

**★4**。空表可续写。已有方案的显式 ID 保持，追加身份与显示行号分开。失去焦点的删除和虚拟化后才挂载的目标行继续使用各自的原交接逻辑。

点击一次触发一次计划写入及一次请求定位。以 320 镜为样本，`storyboard-plan-open` 量到首屏可编辑，预算 1000 ms，登记基线中位数 18219.5 ms（历史欠账）。交叉评审要求在已提交的干净源码上重建并测量 5 次，以 JSON 中的 `head`、`dirty` 及响应分位数为准。场景适配器通过已有的 `NOMI_PERF_OUTPUT_DIR` 将量具的中间样本写到仓库外。 [原始结果](../evidence/2026-11-24-ux-storyboard-actions/storyboard-plan-open.perf.json)

## 8 真实条件

证据目录 [零卡与固定栏](../evidence/2026-11-24-ux-storyboard-actions/README.md)。macOS 干净隔离资料实测 7/7，含 zh-CN 和 en 的四个配色轨、1280×800 及 1100×690。320 镜已另用性能场景测量。Windows、真付费、键盘全程属于未验证范围。

## 拍板图

[StoryboardOnlyWhatWorks](../design/boards/2026-11-02/StoryboardOnlyWhatWorks.board.json) 中的受影响元素为 `anchor.section`、`footer.back`、`footer.progress`、`footer.generate-remaining`。Phase 1 批准对现有两个动作做直修，有卡状态按原样张验收。

## 功能分类

- [x] 新界面 / 改交互
- [x] 新增功能 / 性能

## ★9 验收与回滚

Phase 1 复现场景是创作 → 两镜方案 → 首屏空卡和表尾藏扣。本次沿相同桌面用户路径走，使用独立资料与本机回环供应商。修前截图要能看到零卡展开和固定栏中缺失加镜。修后需同时通过以下判据：

| 反例 / 边界 | 预期 |
| --- | --- |
| 零卡仍显示展开，或直接添加缺失 | 首屏和真交互测试失败 |
| 点击回调空操作或禁止添加 | 首张可编辑卡断言失败 |
| 既有卡已有展开开关 | 开关仍能往返切换 |
| 短窗口、滚动区还在顶部 | 唯一加镜按钮可点击，新镜进入视口 |
| 实际写入被阻断 | 镜数及新行断言失败 |
| 旧按钮名的自动化 | 精确角色选择仍只匹配一颗按钮 |
| 返回后同一计划 | 卡名、镜头与提示词从保存读回 |
| 签板、token、i18n、静态检查 | 运行本次门岗，保留有卡样张及三个旧页脚元素 |

独立验收由协调线对照此表，当前交付实现线证据。回滚使用本次提交的 `git revert`，原数据格式兼容。

## GPT 交叉评审与独立验收补项

2026-11-24 · `gpt-6.2-sol` / `@v-1612-accept` 复核 `80e6fc2f1`。以下现象均可由正常的本地编辑重复触发。最早拦截点是计划编辑边界和 UI 验收。之前只核对加完后的数量、行可见与字段可编辑，漏掉删后重加、跨窗跳转、场折叠、选择和键盘焦点。已有场外定位继续服务画布定位；页脚继续交给同一张虚拟表；移除两个按 DOM 挂载与否分叉的页脚路径。

| 补项 | 共享边界与预期 | 验收与反例 |
| --- | --- | --- |
| 删除前排镜头后再添加 | `nextStoryboardSubjectIds` 从现存最大镜头编号续发 `shot-N`。镜号用于显示，旧行在重排前保留身份，新增时跳过删除撤销保留的 ID。 | 51 镜删第 2 镜，再加回 51 镜。按 `shot-52` 查找须命中新增空镜。另验旧版镜头重排、新镜删后重加。跳过写入、复用现有 ID 均应红。 |
| 页脚从顶部续写 | `StoryboardShotTable` 打开目标场，并通过同一虚拟列表定位和聚焦新镜的提示词。原多选与其他场折叠保留。 | `StoryboardPlanEditor.actions.test.ts` 核对短表和 320 镜。长表点按时第 1 镜可见且末镜未挂。点击后第 321 镜可见、提示词获焦，选中计数仍为 2，另一折叠场保持关闭。真实 Electron 走查同样从顶部点击。 |
| 参考区展开与焦点 | 空态的有效展开值为 `false`。创建后聚焦新卡名称，删除最后一张后返回添加按钮。 | 浏览器以空态、有卡的展开及收起态进入添加，再独立覆盖删到空。卡数量与焦点均须改变。 |
| 删除后参考卡身份 | 删除参考卡时移除镜头素材上指向它的 `anchorId`，保留槽内已选素材。分配器也为旧方案保留仍被素材或自动引用记录使用的 ID。旧 `anchorIds` 保留原合同。 | 领域测试覆盖删掉 `anchor-2` 后原素材仍在、旧来源消失、其他绑定保留、已存在的悬空 ID 不被手加或导入复用。 |

复查日 2026-12-01。量具为上表目标测试、分镜窗口化走查和干净源码性能记录。预测四项回归全部通过，打开详情预算仍为 1000 ms。此轮测试沿用真实编辑器和方案 store，长表复现使用 320 镜的隔离测试夹具，参考素材使用本地测试数据，无生成请求。

### 参考区方向检查

参考区空态和增删的交接在 `seams.json` 表外。该目录的两次 fix 是 `86eed2e87` 的底栏控件归并和 `662b42e2d` 的空态动作可达。前者的交接图见 [底栏让位复盘](../engineering/direction-checks/2026-11-21-bar-yield-r3.md)。两处源码各命中一次，第三次只命中目录。未参与实现的复核线独立读了基线源码与红测记录，推荐收拢三处添加入口和增删后的焦点交接。按目录命中且替换旧路径的规则继续交付。

| 案例 | 直接原因 | 类 |
| --- | --- | --- |
| 首张卡、收起后加卡、删到空 | 三个添加入口各管一段，菜单消失后没有后继焦点，空态仍报出内部展开偏好 | ⑫ 点了以后，用户到不了接着编辑的位置 |
| 删掉旧卡后添加 | 删除只改卡数组，发号只看当前主体，旧绑定继续声明来源 | ⑩ 显示的引用来源与留下的素材不一致 |

旧验收只看控件能点、行出现以及字段可编辑，未覆盖 `activeElement`、有效展开值和历史绑定。预测重放空→一张→空会让两个焦点交接都失败，重放旧 `anchor-2` 导入会误认这张卡。复核线以复现输入为判据，独立于实现。`StoryboardPlanEditor.actions.test.ts` 直接核对三处添加、删除后的可见状态与焦点。`storyboardPlanEdits.test.ts` 核对同槽无关素材、旧绑定与正常新卡；修前分别看到了未聚焦、空时为 `true`、旧 `anchorId` 留存和 ID 复用。

这一整块：用于多镜共享的参考卡创建、删除、展开、引用来源及编辑焦点。
归谁：`src/workbench/creation/storyboard/anchorZone/StoryboardAnchorZone.tsx:49` 负责呈现和焦点，`electron/shared/storyboard/storyboardSubjectIdentity.ts:78` 负责发号，沿用应用已有的 React DOM 焦点方式。
我们哪里绕开了它：原 `StoryboardAnchorZone.tsx:130` 将收起态的添加直接转发给编辑器。`storyboardPlanEdits.ts:159` 删卡后仍保留素材里的活动来源。

| 选项 | 结果与代价 |
| --- | --- |
| 分别补每个按钮 | 初次改动少。后续添加入口和卡卸载时仍会重复处理焦点。 |
| 替换为参考区统一交接，推荐 | 三个入口共用创建完成处理。数据库存量保持可直接打开，分配器保护历史来源。 |
| 删掉收起态添加或卡片折叠 | 能少一个状态，创作者却得多展开一次或失去总览。 |

权衡是用一次共享交接承接编辑焦点与引用身份，让创作者在任何参考区状态都能接着写。
