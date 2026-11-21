# 设计卡 · 分镜表镜头行与参考卡复用画布交互（L-sbui）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：分镜表复用画布交互（参数 / 参考 / 自动引用 / 视觉列版面）      线/负责人：L-sbui（实现）      类别：[新界面][其他]
```

状态：**三轮样张均已拍板（第一轮方向、第二轮版面、第三轮选 A），实现完成，待独立验收**。成对图：`docs/evidence/2026-10-06-storyboard-reuse/`（第一轮）、`round2/`、`round3/`。

依据：用户 10-05 晚原话 4 条；10-06 第二轮原话（「优化左侧的显示……注意各个比例的展示……对齐……原来的设计是把参考放左边」）；10-06 第三轮「选 A 竖版参考挪右边」。审计 `docs/research/2026-10-05-storyboard-plan-user-audit.md` U2 / U4 / U5 / U7 / U9、批 B1 / B3 / B4。

**独立验收**：这是「新界面」四类，合并前必须由另一条验收线对着本卡逐格核（协调会话另派，验收线编号 ≠ L-sbui），PR 正文 `## 独立验收` 带报告链接。验收清单见 ★9。

## 定稿 9 格

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我在分镜表里排一组镜头，我想**用画布上已经会用的那套**选模型和参数、在每行左边看清这一镜长什么样和挂了哪些参考、随手删掉，参考卡出图后引用它的镜头自己挂上，以便不用一镜一镜点。步骤：①打开方案 → ②参考卡点参数汇总按钮调比例 / 清晰度 → ③生成参考卡 → ④镜头提示词里「林薇」后面自动出现 @ 芯片、视觉列参考条多一张带序号的缩略图 → ⑤不要就点缩略图右上角 × 或删 @（另一边跟着没）→ ⑥点「生成」。**不做**：批量 / 多选参数（B7，等 L-aspect）、「生成剩余」阶段化（B2）、勾选框语义与结果移除（B5b，L-sbtable）、Agent 起草协议（B6，L-sbplan）、变体选择器（LAW11-SB-VARIANT，碰花钱边界）、芯片双击灯箱的动作集（AUD-05 残留）。**已知坑**：见「残余」。真实任务：T1 Agent 起草 3 镜 + 1 角色卡，生成角色卡后看自动引用；T2 镜头换 Seedance「全能参考」配 2 张参考再删 1 张；T3 最小窗口 1100×690 + Agent 面板展开，整片 9:16，逐镜改比例并生成。主指标：每镜挂上参考卡所需点击（现在 ≈ 4 次 × 镜数，目标 0）；质量：界面参数 = 落画布参数（同一构造器）；护栏：行高不涨（竖版 264 / 横版 201）、最小窗口「生成」可达、横向溢出 0。新手人设：第一次用分镜表的创作者；老手：天天在画布上用节点的人——两人都不该需要读说明。 | 三轮成对图 README；T1–T3 由独立验收线按 `tests/ux/audit-storyboard.walk.mjs` 零额度夹具跑 |
| ★2 谁说了算 | ① 自动引用：唯一 owner `insertAutoMentions`（`electron/shared/storyboard/promptMentions.ts`）；调用方 A `autoReferencePlan`（`src/workbench/creation/storyboard/exec/storyboardAutoReference.ts`，`StoryboardPlanEditor` 在出图签名变化时调）；调用方 B `initCanvasAutoReferenceBridge`（`src/workbench/generationCanvas/store/canvasAutoReference.ts`，`NomiStudioApp` 挂载）。账本：分镜 `PlanShot.autoReferenced`（锚 id，不进 Agent 起草 schema），画布 `node.meta.autoReferenced`（来源节点 id）。② 参数显示 = 写回：`storyboardComposerMeta`（`buildPlannedNodeMeta`）——底栏显示与 `syncAnchorNodeWithCard` 写回同一个函数。③ 删参考 ↔ 删 @：`removeReferenceWithMention` / `dropBindingsForUrls` + `droppedMentionUrls`。④ 版面几何：`shotFrameGeometry`（表级预览框、窄档、竖版视觉列宽）+ `storyboardRowDensity`（宽 / 窄档，判据 = 行宽 < 740）。 | `node scripts/door-map.mjs insertAutoMentions`：写 2 扇（分镜 / 画布）；`storyboardComposerMeta` 2 扇；`removeReferenceWithMention` 1 扇（+ 实验室夹具）；根因合同 `docs/fixes/2026-10-06-storyboard-reuse-canvas-composer.root-cause.json` |
| ★3 一致与复用 | 参数 = 画布 `InlineParameterBar`（summary 摆法，生成方式进面板顶上一组）；参考缩略图 = 画布 `AssetTile`（cover、hover 放大、右上 ×）+ `AssetAddTile` + `AssetPicker` / `AssetPickerPopover`；+N 浮层 = `AnchoredPopover`；参考卡 ⋯ = `WorkbenchMenu`；画布侧绑定 = 手动 @ 的 `resolveMentionReference` + `validateReferenceEdge` + `connectNodes`。对共享组件的改动：`InlineParameterBar` 加 `leadingModelOption`（分镜「默认模型」）与 `summaryWidth: { hug }`；`composerHeadlineSummary` 「自动」档本地化（画布同受益）。**自写的只有适配层**：`storyboardComposerModel.ts`（理由：分镜的画幅是「整片默认 + 行覆盖」两段、视频时长住 `durationSec`，领域独有）与 `ShotReferenceStrip.tsx` 的排布（理由：表格要求视觉列定宽对齐、竖版放框右边，画布浮框没有这个约束；单元仍是 AssetTile）。删掉的第二份定义：旧底栏胶囊 + `composerBarModel` / `composerBarGeometry`、`ShotReferenceZone` / `ShotReferenceSlotPopover` / `shotReferenceStackGeometry`、锚行类型按钮排与「生成模型」下拉。 | 结构测试 `StoryboardShotRow.structure.test.ts` / `StoryboardAnchorZone.structure.test.ts`；`check:self-written` |
| ★4 全状态 | 无参考：横版 / 方图在框下只一格「+」，竖版在框右边一格「+」；有参考：36 方块（窄档 28）+ 序号 + ×，末格「+」；放不下：「+N」浮层（竖版按右边那条带的格数，横版窄档一行）；契约未知（默认模型）：「+」= 在提示词起 @；不吃参考的模式：「+」= 切到同模型能收参考图的模式再放（方案 A，用户已拍板）；计划首帧：参考条最前一格只读（出图前虚线占位、出图后就是那张图）；模型未选：模型按钮写「默认模型」（可选回）、无参数汇总；生成中：「生成」忙态 disabled；已生成 / 锁定 / 可找回：底栏右端换状态标签；失败：预览框红框 + 框下重试；缺必填参考：预览框红态（唯一一处）；单镜画幅 ≠ 整片：框内 contain + 左下角画幅标签，未生成画该画幅的虚线轮廓；自动引用失败（参考框满）：@ 与绑定都不留、账本不记；取消中：不适用（不新增异步动作）；过期：参考卡重生成后 url 变 → 现有「参考已变」警示。文案：新增 i18n 2 条（出图方式两个选项名，取自被删的区头说明）；删 33 个死键（中英各一份）。不谈钱。 | 三轮成对图（zh / en / 暗 / 窄 / 横竖方 / 混排 / 三状态）；`check:i18n` |
| 5 中途表 | 本改动不新增花钱动作、不新增异步链：参数改的是方案字段（同步、可撤销）；「生成」的语义与落点不变（参考卡重生成前写回模型参数，属同一次点击里的同步写入）。自动引用是一次同步方案写入（一条撤销记录）；画布侧是同步的切模式 + 建边 + 写提示词（失败整条撤回）。关窗 / 重启：账本在方案 / 节点里，重开不会重复补；画布侧打开旧项目不触发。连点「+」只开关同一个选择器。 | 人工；独立验收线真窗口走查 |
| 6 外部数据与失败 | 外部来源只有模型档案（内置，参数 / 模式 / 槽从档案 derive，与画布同一份）与用户上传 / 素材库（复用现有上传通道与拒绝理由文案）。模型不在目录 → 「默认模型」、不出参数（不假装知道）。跨字段约束（MiniMax-H3 自适应比例）按档案 optionConstraints 收窄，与画布同一函数。 | ⑪ 矩阵豁免条目（reachabilityLedger.json） |
| 7 性能预算 | 每行一个 `InlineParameterBar`（与画布节点同量级，面板 portal 只在点开时渲染）、参考条按需渲染；`autoReferencePlan` 只在出图签名变化时跑（O(镜数 × 名字数)）；画布桥只对新出图结果跑。未量真规模。 | unverified（交独立验收在 30 镜方案上量首屏与滚动） |
| 8 真实条件 | Windows：是（本机 Win11 实验室真组件截图）；英文界面：是；最小窗口：是（664 宽）；暗色：是；横 / 竖 / 方 / 混排：是；真规模 / 干净安装 / 真付费 / 键盘全程 / 真 App 走查：**unverified**（本线没起真 App，走查脚本已按新 DOM 改写，交独立验收线跑）。 | `docs/evidence/2026-10-06-storyboard-reuse/{,round2/,round3/}`，全部亲眼看过；对齐实测在 `round2/measures.json`、`round3/measures.json` |
| ★9 验收与回滚 | 验收（独立验收线，编号 ≠ L-sbui）：①对着三轮 README 逐张对账（左缘 / 「生成」右缘 / 行高数值见 measures）；②硬门 ⑩（显示 = 请求：参数汇总与落画布同一构造器、参考卡重生成同步模型参数）/ ⑪（`tests/experience-laws/parameterReachability.test.mjs` 全量矩阵绿，分镜两入口 21 个缺口类已消失）/ ⑫（删一边另一边跟着）逐项对账；③真 App 跑 `tests/ux/storyboard-narrow-row.walk.mjs`、`storyboard-first-frame-false-alarms.walk.mjs`、`storyboard-table-phasec.walk.mjs`、`project-switch-background-run.walk.mjs`（零额度夹具，窗口在屏幕外）；④AI 创作者任务 T1–T3。逃逸账本：AUD-20261005-02 / 04 / 05 / 18、LAW11-ANCHOR-CARD / SB-DURATION / SB-NUMBER-TEXT 已复核（reviewed，PR 号开后转 fixed）。回滚：整个分支一个概念，revert 合并提交即可；数据层只多了可选字段 `autoReferenced`，回滚后旧版忽略它。 | PR 正文 `## 独立验收`；`tests/ux/full-walk/escapeLedger.json` |

## 残余（交协调会话 / 下一刀）

- `StoryboardShotTable`（L-sbtable 禁区）只递每镜生效画幅：预览框按「镜数最多的画幅」近似整片画幅；L-sbtable 合入后补传整片默认、删 `aspectOverridden` / `aspectOptions` 传参（协调会话通知后做）。
- 表格里手动 @ 的落槽判据（`ShotRowWithMention.onBindReference`）与参考条「+」的 `slotFor` 仍是两份，同在禁区文件。
- 首尾帧模式下「+」按「先空着的那一格」落（首帧 → 尾帧，都满了替换首帧）；两张都在时想单换尾帧要先点尾帧的 ×。
- 芯片双击灯箱仍只有「关闭预览」（AUD-05 残留）。
- 变体选择器（LAW11-SB-VARIANT）未做：会改实际调用的模型，属花钱边界。
- `tests/ux/storyboard-reference-slots.walk.mjs` 在 main 上就已过期（断言的 `data-asset-slot` 来自 v5 的 AssetReference），本线未改，建议随下一刀重写或删除。
- `electron/shared/modelArchetypes/anchorPolicy.structure.test.ts` 在本机（Windows）红，与本线无关（文件未动，main 上同样）。
- 设计实验室 `storyboard` 屏（分镜表 v6）画的是真镜头行，现有基线全部过期，已登记进 `pendingApprovalScreens`，与 `storyboard-reuse` 同一次拍板后在 darwin 上重录；只能画已删界面的 4 格已连同基线删除。

## 历史 · 第一轮的 9 格（样张阶段，已被下面的定稿替换；保留作对账）

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我在分镜表里排一组镜头，我想**用画布上已经会用的那套**选模型和参数、看见每镜引了哪张参考图、随手删掉，并且参考卡出图后引用它的镜头自己挂上，以便不用一镜一镜点 30 次。步骤：①打开方案 → ②参考卡选模型、点参数汇总按钮调比例 / 清晰度 → ③生成参考卡 → ④镜头里「林薇」后面自动出现 @ 芯片、提示词框上方出现那张缩略图 → ⑤不要就点缩略图右上角 × 或删掉 @（另一边跟着没）→ ⑥点「生成」。**不做**：批量 / 多选参数（B7，等 L-aspect）、「生成剩余」阶段化（B2）、勾选框语义与结果移除（B5b，归 L-sbtable）、Agent 起草协议（B6，归 L-sbplan）。**已知坑**：见文末「不确定」。真实任务：T1 Agent 起草 3 镜 + 1 角色卡，生成角色卡后看自动引用；T2 镜头换 Seedance「全能参考」配 2 张参考再删 1 张；T3 最小窗口 1100×690 + Agent 面板展开，逐镜改比例并生成。主指标：每镜挂上参考卡所需点击（现在 ≈ 4 次 × 镜数，目标 0）；质量：界面上的参数 = 落画布的参数（同一构造器）；护栏：行高不涨、最小窗口「生成」可达。新手人设：第一次用分镜表的创作者；老手：天天在画布上用节点的人——两人都不该需要读说明。 | 成对图 README；T1–T3 拍板后按 `tests/ux/audit-storyboard.walk.mjs` 零额度夹具跑 |
| ★2 谁说了算 | ① 自动引用：**唯一 owner `insertAutoMentions`**（`electron/shared/storyboard/promptMentions.ts`，与 @ 持久化格式同一个文件）——只管「插在哪、插不插、账本」，纯函数。调用方 A = 分镜 `autoReferencePlan`（`src/workbench/creation/storyboard/exec/storyboardAutoReference.ts`，由 `StoryboardPlanEditor` 在参考卡出图签名变化时调）；调用方 B = 画布（**未实现**，拍板后接：新文件 `src/workbench/generationCanvas/nodes/canvasAutoReference.ts`，节点出图时对同画布未出图节点调同一个函数，绑定走现有 `planMentionInsert` 的 connect 路径建真边）。账本：分镜 `PlanShot.autoReferenced`（锚 id），画布 `node.meta` 同名键（节点 id）。② 参数显示：画布节点 meta 的构造器 `buildPlannedNodeMeta`（落画布同一个），分镜不另拼。③ 删参考 ↔ 删 @：`removeReferenceWithMention` / `dropBindingsForUrls`（`shotReferenceSlots.ts`）+ `droppedMentionUrls`（`promptMentions.ts`）。碰的概念：分镜方案（plan）、参考绑定（referenceBindings）、@ 引用（promptMentions）。 | `node scripts/door-map.mjs insertAutoMentions`：写 1 扇；`removeReferenceWithMention`：写 2 扇（行 + 实验室夹具）；`autoReferenced`：读 1 扇 |
| ★3 一致与复用 | 参数区 = 画布 `InlineParameterBar`（summary 摆法，模型按钮 + 参数汇总按钮 + 平铺面板，生成方式进面板顶上一组——Agent 提案卡已在用的 `modeChoices` 那条缝）；参考图 = 画布 `AssetReference` / `AssetTile`（自带 ×）/ `AssetPicker`；参考卡 ⋯ 菜单 = `WorkbenchMenu`（radio 组）；「加参考」按钮 = `WorkbenchIconButton`。对共享组件只加了 2 处小口子：`InlineParameterBar.modelPlaceholder`（分镜「默认模型」）、`summaryWidth: { hug }`（中英文宽差近一倍）；另外修了共享摘要 `composerHeadlineSummary` 的「自动」档露英文原值（审计 A11，画布同受益）。**自写的只有适配层**：`storyboardComposerModel.ts`（分镜字段 ↔ 画布 meta，理由：比例住「整片默认 + 行覆盖」、视频时长住 `durationSec`，这是分镜领域独有的两段作用域）。删掉的第二份定义：`ShotComposerBar` 旧胶囊排 + `composerBarModel` / `composerBarGeometry`（让位表）、`ShotReferenceZone` / `ShotReferenceSlotPopover` / `shotReferenceStackGeometry` / `storyboardRowDensity`（参考列与宽窄两档）、锚行 `ANCHOR_KINDS` 按钮排与「生成模型」下拉。 | `git show 3030e8bc3 --stat`；`check:self-written` 拍板后跑 |
| ★4 全状态 | 空参考：不占行，底栏一颗「加参考」图标；有参考：提示词上方一排缩略图 + 「+」；模型未选：模型按钮写「默认模型」、无参数汇总按钮；生成中：「生成」变忙态且 disabled（原样）；已生成 / 锁定 / 可找回：「生成」位置换状态标签（原样）；失败：画面格红框 + 重试（原样）；自动引用失败（参考框满）：@ 与绑定都不留、账本不记；取消中：不适用（本改动不新增异步动作）；过期：参考卡重生成后 url 变 → 现有「参考已变」警示行（原样）。文案：新增 i18n 2 条（`anchor.carrierVisual` 生成参考图 / `carrierText` 仅提示词，取自被删的那句区头说明）；删掉区头说明、每格说明、「不吃参考·切…」整句。不谈钱。 | 成对图 13 组 × zh / en；`check:i18n` 拍板后跑 |
| 5 中途表 | 本改动不新增花钱动作、不新增异步链：参数改的是方案字段（同步、可撤销），「生成」按钮的语义与落点不变。自动引用是一次同步方案写入（一条撤销记录）；关窗 / 重启后方案已落盘，账本在方案里，重开不会重复补。连点「加参考」只开关同一个选择器。 | 人工（拍板后真窗口走查补） |
| 6 外部数据与失败 | 外部来源只有模型档案（内置，参数 / 模式 / 槽从档案 derive，与画布同一份）与用户上传 / 素材库（复用现有上传通道与拒绝理由文案）。模型不在目录 → 模型按钮回落「默认模型」、不出参数（不假装知道）。 | 不适用外部 API |
| 7 性能预算 | 每行多挂一个 `InlineParameterBar`（与画布节点同量级，面板 portal 只在点开时渲染）；未量真规模，拍板后在 30 镜方案上量首屏与滚动。 | unverified |
| 8 真实条件 | Windows：是（本机 Win11 实验室截图）；英文界面：是（en 轨 13 组）；最小窗口：是（664 宽 = 1100×690 + Agent 面板）；暗色：是；真规模 / 干净安装 / 真付费 / 键盘全程：**unverified**（样张阶段只跑实验室真组件，没起真 App）。 | `docs/evidence/2026-10-06-storyboard-reuse/` 全部亲眼看过 |
| ★9 验收与回滚 | 验收：另一条线对着本卡逐格核；硬门 ⑩（显示=请求：参数汇总与落画布同一构造器）/ ⑪（档案声明的参数在镜头行与参考卡都选得到——反馈 #3 #11）/ ⑫（删一边另一边跟着）逐项对账；AI 创作者任务 T1–T3。回滚：revert 样张提交 `3030e8bc3`（实验室屏 `fcdfc92a4` 可留作对照）。独立验收报告：拍板实现后补。 | 本卡；`git revert 3030e8bc3` |

## 收掉的空间（每一处挪去了哪）

| 收掉的 | 功能挪到哪 |
|---|---|
| 画面格虚线框中间的「生成」（与行尾那颗重复） | 只留提示词框底栏右端那一颗（镜头行、参考卡都一样） |
| 镜头行三个空参考大方框 + 每格一行说明（角色参考 / 参考视频 / 参考音频） | 空的时候一格都不占：底栏一颗「加参考」图标（点开同一个素材选择器）；放进第一张后，提示词上方出现画布同款缩略图排 + 「+」 |
| 「文生视频 不吃参考 · 切「首帧」模式可挂参考」整句 | 删。底栏那颗「加参考」在不吃参考的模式下照样在，选完素材 = 切到同模型能收参考图的模式（方案 A，待拍板） |
| 200px 参考列（以及它的宽 / 窄两档、窄档「+N」折叠） | 参考图搬进提示词框（画布浮框同一位置），省下的宽度全给提示词；最小窗口下「生成」第一次完整可见（审计 A13） |
| 底栏一排胶囊：模式 / 时长 / 清晰度 / 输出格式 / ⋯（开关弹层） | 两颗按钮：模型 + 参数汇总（「全能参考 · 16:9 · 5s」），点开平铺面板：生成方式、清晰度、比例（带图形）、时长滑条、开关全在里面 |
| 行 ⋯ 菜单里的「画幅」子清单 | 参数面板的「比例」一组（选回整片默认 = 收回覆盖） |
| 参考卡：画面格大空框里的「生成」+「先写好描述」 | 底栏右端「生成」 |
| 参考卡：默认模型行的「@ 加参考」禁用方框 + 「仅文字锚不吃参考——…」说明 | 删（不吃参考就不摆；能吃参考时同镜头行，底栏「加参考」） |
| 参考卡：类型四枚 + 「参考图」载体开关一整排 | 行首 ⋯（与镜头行 ⋯ 同一位置）：类型四选一、生成参考图 / 仅提示词、删除参考卡；类型仍由行首图标常显 |
| 参考卡：名字行右端的垃圾桶 | 行首 ⋯ 菜单「删除参考卡」 |
| 锚区区头说明「生成参考图=锁长相 · 仅提示词=写进 prompt」 | 删；这两个词成了 ⋯ 菜单里两个选项的名字 |

## B 自动引用 · 模式不带参考槽时怎么办（待拍板）

背景：Agent 起草的视频镜默认「文生视频」，这个模式没有参考槽——什么都不做，自动引用在大多数镜上等于没做（审计 U8-2）。

| 方案 | 发生什么 | 代价 |
|---|---|---|
| **A（推荐）** | 同一个模型里有「能收参考图、且除参考图外没有别的必填槽」的模式（Seedance → 全能参考，Veo → 参考图，Nano Banana → 改图，GPT Image → 图生图），**且这一镜还没出过结果** → 切过去、补 @、绑参考。参数汇总按钮上立刻看得到模式变了。切过一次记账，用户切回去不会被再切。没有这样的模式（只有首帧槽的模型）→ 这一镜不补（人像当首帧会毁构图）。行上的「加参考」按钮用同一条规则。 | 模式变了，生成结果的性质和时长档可能跟着变；用户若刻意选了文生视频，要自己切回去一次（之后不会再被切）。已有 Agent 起草准入（`normalizeStoryboardAnchorDefaults`）就是这么切的，判据一致。 |
| B | 不切模式也不补（现状） | 自动引用对默认文生视频镜不生效，用户仍要逐镜切模式 + 挂图 |
| C | 补 @ 和绑定，但不切模式 | 行上出现「不会发出去」的参考与芯片（现有 ignored 警示句兜着），显示 ≠ 请求的风险，用户还得自己切 |

## 不确定（拍板时一并定，带默认）

1. **触发时机**：默认只在「参考卡出图」和「打开方案」时补，用户正在打字时写下名字**不**即时补（打着字冒出芯片会抢光标）。另一选择：失焦时补。
2. **「引用它的镜」判据**：默认 = 提示词文字里出现了它的名字（与画布同一把尺）；方案里的 `anchorIds` 不单独触发（名字不在提示词里就没有「名字后面」这个位置）。如果要求「anchorIds 里有、名字没写」也挂参考（不插 @），需要另定——那会出现无 @ 的参考，与反馈 #7 的「一一对应」相冲。
3. **账本的身份**：默认按锚（「这一镜别再自动挂林薇」）。参考卡重生成后 url 变了，不会自动换新图（走现有「参考已变」警示）。
4. **「默认模型」选项**：新模型按钮里没有「默认模型」这一项，选过具体模型后回不到「默认」（旧下拉能）。默认：实现阶段给 `InlineParameterBar` 加一个可选的首项，补回来。
5. **「忽略特征」输入框**：随旧参考浮层一起没了。查过：这个值从没进过发出去的提示词（`ignore` 只在 schema 和那个输入框里出现）——界面写了、请求没带。默认：不搬，提示词里直接写「@林薇 但不要她的风衣」即可；已有数据不删、不读。
6. **参考多时行高**：画布同款缩略图排会换行，参考很多（> 8 张）的镜头会比别的行高。默认接受（扫视时「这镜参考多」本身就是信息）。
7. **画布侧调用方**：样张只做了分镜侧；画布侧候选范围默认 = 同一画布上还没出图、提示词里写了那个节点标题（≥ 2 个字、不是默认标题）的图片 / 视频节点。
8. **英文参数汇总按钮**：贴文字宽、最宽 210px，英文「Omni reference · 16:9 · 5s」放得下；更长的模式名会截断（title 里有全文）。

## 禁区与协作

没碰：`StoryboardShotTable.tsx`、`StoryboardSelectionToolbar.tsx`、`StoryboardFrameActions.tsx`、行首复选框语义（L-sbtable）；`mcpGeneration*`、`writeVerbs.ts`、`storyboardPlanFromDraftSubjects`（L-sbplan）。
需要协调的：①表格仍给行传 `aspectOverridden` / `aspectOptions`（行已不读，类型里标了可选），L-sbtable 顺手删传参；表格里 `ShotRowWithMention.onBindReference` 的「放进哪个槽」与本线 `ShotReferenceAddButton` 是两份判据，拍板后合到一处需要碰表格文件。②`generationPlanSchemas.ts` 加了一行 omit（`autoReferenced` 不进 Agent 起草 schema），L-sbplan 若在改同文件要知会。③旧屏 `storyboard`（分镜表 v6）的基线会因行结构变化而红，拍板后与本屏一起重录。

## 第二轮（2026-10-06 用户：优化左侧显示、注意各比例与对齐、参考放回左边）

版面由协调会话定，第一轮其余部分（参数复用画布、自动引用、删参考同步、方案 A）不变。成对图：`docs/evidence/2026-10-06-storyboard-reuse/round2/README.md`。

- **行网格**（`StoryboardRowShell`）：`[行首 14 | 视觉列 | 内容列 1fr]`，内边距 12，内容列撑满行高。底栏和「生成」因此每行在同一位置（实测右缘一致）。
- **预览框**（`shotFrameGeometry`）：由全表画幅定，全表同一只。横版宽 240、竖版高 240、1:1 为 180；窄档（行宽 < 740）等比缩到 176/240。单镜画幅不同时在框里 contain，浅底补空，左下角标画幅；未生成时画这一镜画幅的虚线轮廓。
  - 「全表画幅」取的是**全表镜数最多的生效画幅**。原因：表格（L-sbtable 的文件）只递下来每镜的生效画幅，没有递整片默认。覆盖的镜不过半时，这就等于整片默认。要严格用整片默认，需要表格多递一个参数，改动就一行。
- **参考缩略图条**（`ShotReferenceStrip`）：在视觉列、预览框下面。用画布同款 `AssetTile`，宽档 36、窄档 28、间距 4、折行；右上角 ×，左上角序号与芯片编号读同一份有序列表；末格「+」打开同一个素材选择器（方案 A 在这里切模式）。窄档一行放不下时折成「+N」浮层。第一轮里提示词框里的参考区和底栏的「加参考」按钮都删了。
- **参考卡区**：同一套网格，参考卡按自己的画幅（`params.aspect_ratio`）contain 进框里。
- **不确定（新增）**：
  - ① 竖版整片时行高 ≈ 300，内容列里提示词下面有一大块空白（按「行高取较高一列」的规则就是这样）。可选做法：提示词区最多 5 行，底栏不贴底，紧跟提示词。但这样「生成」的 y 就不再逐行一致了。
  - ② 「移除结果」不在框下的动作条里：那条动作条是 `StoryboardFrameActions`（L-sbtable 的文件），归 B5b。
  - ③ 预览框上沿与内容列（提示词框的边框）上沿对齐；提示词第一行文字比框上沿低 8px（框内边距）。
  - ④ 锚区和镜头表是两个容器，要让两区的框左缘对齐，需要在编辑器层统一两个容器的内边距。
