# 方向检查：花钱确认弹窗 14 天 5 个 fix（2026-11-08 → 11-22）

> 草稿，R-spend-confirm-direction 只读线写（没参与过前几轮）。只用了提交、代码、PR 的「摘要 / 做了什么 / 系统改进」三节；写完前没读任何已有复盘。证据都在 `/Users/aoqimin/Nomi-coord/tmp/R-spend-confirm-direction/`（下文写证据文件名）。行号：没写提交号的都是 `origin/main` 1745327c7。

**这一处的全图在哪**：表外（`docs/engineering/seams.json` 没有 spend / modal / dialog 条目）。概念主人：`ui.dialog-layout`（主人是 `src/design/overlays.tsx#DesignModal`，只管高度、滚动和决定栏）、`spend.confirmation-card-mount`（管挂载点）。**弹窗的读屏名字、走查锚点没有概念主人。** 自写登记没命中（`self-written.json` 只有 `modal-input-layer`）。

### 0. 一句话根因

弹窗对读屏、走查、键盘的承诺（名字只念标题、关闭键锚点、锚点取值、滚动归谁）有一半没有主人：外壳只登记了高度和决定栏，其余承诺散在各弹窗手写的 DOM 里；外壳的 `title` 什么 ReactNode 都收，属性包也随便传。所以换壳时这些承诺会悄悄丢，只能靠合入前的独立验收（e9c）、CI 走查（cdc 的设置锚点）和普查（c5b）一件件撞出来。每撞出一件就加一个可选口子，旧补丁不删。

### 1. 归类表

| 提交 / PR / 日期 | 创作者看到了什么 | 直接原因（file:line） | 类 |
|---|---|---|---|
| 5eb4868c5 / #1476 / 11-09 | 最小窗口加英文时，反馈卡的「发送」被裁（夜跑 #076）；花钱卡是阶段① 迁的三个代表之一，它自己被裁过没有我没核 | 迁前 `5eb4868c5^:SpendConfirmDialog.tsx:144`：手写 `max-h-[88vh]`，`:146` 自己选两种滚法（04b） | A 承诺由各弹窗手写（起点：高度这一项收进了外壳） |
| feeea7037 / #1476 / 11-09 | 合入前改掉，用户没见过 | `feeea7037^:MultiShotContractSummary.tsx:132` 的 `max-h-[40vh]` 是给旧壳配的，外壳接管滚动后变成两层滚动（03b） | A 旧壳的配套留在内容里（同目录，不碰本文件） |
| cdcae82d4 / #1476 / 11-13 | 合入前改掉 | `5eb4868c5:SpendConfirmDialog.tsx:132` 的 `title={header}` 连 `:113` 的 Agent 副标一起成了名字。迁前名字只指 `<p id={titleId}>`（04b:129、:159）。走查靠旧壳类名 `div.fixed.inset-0` 认卡（03c） | A 读屏名字没有主人；锚点没有主人 |
| e9c8c5e39 / #1476 / 11-13 | 合入前独立验收抓到 | `5eb4868c5:SpendConfirmDialog.tsx:133` 的 `closeButtonProps` 只传了 aria-label，迁前 04b:172 的 `data-spend-confirm-action="close"` 丢了；消费方是 `tests/ux/_generationLockExitApprovedCard.mjs:81-84`（08c）动态拼的 `${action}`，静态搜索找不到 | A 锚点没有主人 |
| c83694a96 / #1556 / 11-17 | 第一次托管时卡上的告知块和「记住」勾选没了（产品改成只看设置） | `c83694a96^:SpendConfirmDialog.tsx:212-235`、`c83694a96^:spendConfirm.ts:150,196,250`：托管同意这个别的概念从 b16b8dfe6（08-26）起住在花钱卡里 | B 花钱卡兼做别的概念的决定（不评那条决定） |
| c5b68c048 / #1594 / 11-22 | 按仓库自己的 G2，读屏这次听不出变化：`c5b68c048^:SpendConfirmDialog.test.tsx:18` 已断言名字只剩标题（运行时没验证） | 普查 `modalTitleAccessibleNameCensus.test.ts` 的存量名单里列着本文件；普查按语法判（title 里有 JSX 且没传 accessibleName），认不出 aria-hidden 那套已经修好 | A 加新没删旧：`:117` aria-hidden + `:160` sr-only 和 `:136` accessibleName 现在管同一件事 |

本文件 5 个提交里 4 个（5eb、cdc、e9c、c5b）归 A，同目录的 feeea 也归 A：6 个提交里 5 个。数法：5eb 是起点，它把同一原因里的高度这一项收进了外壳（现在有主人，`ui.dialog-layout`）；cdc、e9c、c5b 是名字和锚点两项还没主人的后果，feeea 是旧壳配套留在内容里的后果。只数后果的话，本文件是 3 个，加 feeea 是 4 个。c83 是 B。

### 2. 为什么这一类会一直出现

- 外壳类型 `DesignModalProps = ModalProps & {…}`（`overlays.tsx:7`）：`title` 是任意 ReactNode，`closeButtonProps`、`contentAttributes`（`:22`）是任意属性包。名字和锚点写错了照样能编译、能渲染。
- 锚点各弹窗自己起名、自己挂：6 处 `contentAttributes={{…}}` 名字和值的写法都不一样（08d；Settings 的 `''`/`'true'` 在 cdc 里丢过一次）。外壳不出标准锚点。
- 迁壳前没钉住旧壳的承诺：迁前单测 G1 只钉了 cancel 和 confirm 两个锚点（`5eb4868c5` 里 `SpendConfirmDialog.test.tsx` 的 diff），名字、关闭键都没钉。a11y 走查 `tests/ux/spend-confirm-a11y.walk.mjs:113-129` 量的是 `textContent`，开的是用户直发卡（`:90-100`，没有副标），量不出「副标并进名字」。
- 每撞出一件就给外壳加一个可选口子（accessibleName `overlays.tsx:23-28`、contentAttributes `:18-22`）。调用方得自己记得传，普查只能事后按语法追。
- 铁律：⑩ ⑪ 不适用（没有意图参数、没有可选项清单）。⑫ 部分适用：`tests/ux/full-walk/catalog.mjs:257` 的 `confirming-spend` 只列了「确认生成 / 取消」，没有关闭键、Esc、点遮罩，也没写 `userExpectation`。建议记一条 escapeLedger `candidate`（本线只读，没写）。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 下一批迁壳又丢锚点值或名字：生产代码里手写 `role="dialog"` 属性 26 处（08a，去掉了选择器和注释；不少是浮层、导览、面板，其中多少该迁成弹窗我不知道）；`scripts/overlay-z-baseline.json:4` 明写更新弹窗迁 dialog 档要连花钱卡一起重测 | 下一次迁壳的 PR 里数「合入前补锚点 / 名字」的提交；08a 的命令见 `00-index.txt`（原始 grep 39 行里有 13 行是 `closest('[role="dialog"]')` 一类选择器和注释） |
| 普查漏判：title 变量要绕 3 层以上（census `:81` `depth > 3`），或初始值不在同一文件（`:57-58` 找不到就当纯文字） | 造一个 title 从别的文件 import 来的 JSX，普查保持绿 |
| 卡上注释和代码对不上的情况继续积累：`SpendConfirmDialog.tsx:15`、`ProductionCanvasLandingHost.tsx:87` 现在还写着「托管告知 / 披露块」（c83 已删） | grep「托管」「披露」 |
| 花钱入口之间金额拼法继续分叉：`ai/v4/formatMoney.ts`（发送键胶囊 `sendCostFormat.ts:3` 和 Agent 花钱卡共用）、`ProductionContractSummary.tsx:9`、`SpendConfirmDialog.tsx:291`、`generationGateConfirm.ts:82-85`，一共四种写法 | 同一个 USD 金额在四处的输出做对照测试 |

### 4. 靶子独立性检查

- 计数器 `scripts/fix-churn.mjs:204` 用 `git log --no-merges` 一个提交一个提交地数，`:44` 按标题前缀 `fix` 判。所以 #1476 合入前的 3 个更正提交各算一次（#1476 在 2026-11-13T07:24Z 合入），产品决定删功能的 c83 也算一次。A 类（外壳迁移）里，14 天有据可查的「创作者遇到回归、我们修好」是 0 次；类是真的，但次数被放大了。c83 不在此列：它挂着用户报告的逃逸账本 `tests/ux/full-walk/escapeLedger/USER-20261117-hosting-setting-only.json`（「用户报告默认托管策略下参考图未经告知传到第三方」，08e），是 B 类，不是这个弹窗外壳的回归。
- 量读屏名字的三把尺各量各的：G2 用正则去掉 aria-hidden，a11y 走查量 textContent，普查看有没有这个属性。没有一把按真实的 accname 计算。c5b 就是普查把一处已经修好的弹窗判成不合格，逼出第二套机制。这些尺是不是同一条线写的，我不知道。
- 「修对了反而掉分」：没找到先例。

### 5. P0：这些是我们独有的吗

都不是独有的。弹窗的名字和说明，WAI-ARIA APG 的 Dialog (Modal) 模式规定：标题用 `aria-labelledby`，说明用 `aria-describedby`（https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/）。外壳已经接在 Mantine 8.3.18 上（`package.json:325`）。Mantine 内部是怎么做的，我只有仓里注释作证（`overlays.tsx:24-27`），没有 node_modules，没验证。组合式 `Modal.Root/Modal.Title` 仓里用了 0 处。领域独有的只有卡里的内容：多镜合同、形象过目、清单。

### 6. 三条路

| 选项 | 做什么 | 代价（含老用户） | 同类还会不会再来、从哪来 | 风险 | 推荐 |
|---|---|---|---|---|---|
| 沿原方向修 | 留着可选口子和普查。删 `:117`/`:160` 和 `:136` 两套里的一套；G1 加钉关闭锚点 | 小。创作者那一刻：样子不变，读屏念的名字不变（副标念的位置会不会变没验证）。老用户：没有持久数据（pending 只在内存，`spendConfirm.ts:169-178`），升级后无感 | 会。另一个调用方：19 处 DesignModal 照样能传 JSX 标题、能自起锚点；下一批迁壳照样会丢。另一个花钱入口：Agent 聊天花钱卡（`ai/v4/AgentPanelV4SpendCardBody.tsx`）不走这个外壳，不受影响也不受保护。旧数据：没有这条路 | 门岗越来越多 | 否 |
| 换一种做法 | 外壳接管名字和锚点：`title` 只收字符串（就是名字）；名字以外的头部内容（图标、副标、封面、元信息）走外壳的头部插槽，放在名字元素之外，副标这类说明由外壳挂成 `aria-describedby`。插槽得是通用的：7 处 `accessibleName=` 里技能详情（`SkillDetail.tsx:34-62`，08n2）的标题装着封面、简介、来源链接、许可证和关闭键，装不进「图标 + 副标」两格；另外 6 处是图标 / 标题 / 副标或两段文字（08n、08n3、08n4）。外壳能不能在 Mantine 的标题元素之外渲染这些内容没验证（没有 node_modules，组合式 Modal 仓里 0 处，08k）。对话框锚点和关闭键锚点由外壳按调用方给的 id 统一出；新登记一个概念主人。删 `accessibleName` 口子（`overlays.tsx:23-28,60`）、普查测试、7 处 `accessibleName=`、本文件 `:22`/`:117`/`:160`。由一条实现线一次做完，单位是外壳加 19 个调用方；时机是下一批迁壳（26 处手写 `role="dialog"` 里要迁的那些）开工之前 | 中。创作者那一刻：样子应该不变，要按设计实验室基线（`04-dialogs.tsx:331`）和拍板图逐张对；读屏：名字是标题，副标作为说明念出来（替掉 sr-only 复本）。老用户：没有数据要迁 | 另一个调用方：标题类型不收 JSX，写不出来（tsc 拦）；锚点由外壳出，迁壳不会丢值。另一个花钱入口：Agent 聊天卡不是弹窗，不在范围内，它的读屏名字规则我不知道。还会来的：26 处手写 `role="dialog"` 迁之前不受保护。「拆开」花钱卡（#1548）是并列候选，这里不下结论 | 改 19 处调用方、碰用户可见的标题栏。锚点值保留原名的话，60 个认 `[data-spend-confirm-dialog]` 的走查不用改 | **是** |
| 删掉 | 最小单位：花钱卡标题栏里名字以外的东西。Agent 副标（`:114-121`）挪到正文第一行（就是今天 `:160` 那个 sr-only 复本，改成看得见），类型图标（`:104-111`）删掉或挪走。title 变成 `pending.title`，三套名字机制一起删 | 小。创作者那一刻：标题栏只剩一句话，「Agent 发起」挪到正文第一行，金币、机器人、分镜这些类型图标可能没了，要出图拍板。老用户：没有数据，升级后标题栏样子变了 | 这张卡：不会再来。另一个调用方：会，另外 6 个带 accessibleName 的弹窗不变；锚点问题不受影响。另一个花钱入口：Agent 聊天卡不走这个外壳，不受影响。旧数据：没有这条路 | 用户可见变化；Agent 发起这个信号变弱 | 否 |

推荐「换一种做法」：成熟标准（APG 的 labelledby / describedby）已经有了，它让名字和锚点在外壳这一层写不错，是三条里唯一能管住其它 18 个弹窗和下一批迁壳的。

### 7. 用户要权衡的核心

要不要把 19 个弹窗的标题接口换一次（样子不变、要逐张核对），换来以后新弹窗、迁壳都写不出错名字、丢不了锚点；不换的话，每迁一批就靠验收和普查再撞一次。

## 特征测试清单（动结构前先锁住）

- 已钉：`SpendConfirmDialog.test.tsx` G1（cancel/confirm 锚点）、G2（名字只剩标题）；`modalAccessibleNames.test.tsx`（4 个弹窗的名字，中英）；`overlays.structure.test.tsx`（决定栏、accessibleName）；`dialogMigration.structure.test.ts`（决定栏不在 children 里）。
- 没钉：关闭键锚点（只有夜跑走查用动态字符串认它）、回车 = 主动作、还焦点、初始焦点落在对话框本体上（只有真窗口走查才量得到）、`[data-spend-confirm-dialog]` 的取值。本线只读，没补。

## 与原方案对照（写完上面以后才读 `docs/engineering/direction-checks/2026-11-22-overlay-a11y-release.md`）

- 一致的：名字的口子是外壳的 `accessibleName`，门岗是普查；本文件 14 天的 fix 是 5eb、cdc、e9c、c83 加上它自己；c83（托管）不是读屏名字这件事；花钱卡的方向复盘另写。
- 不同 ①：它说之前几刀「和读屏名字不是同一件事」。对花钱卡不成立：cdcae82d4 已经修过这张卡的名字（G2，`c5b68c048^:SpendConfirmDialog.test.tsx:18`），c5b68c048 是同一件事的第二套机制。本复盘把 5eb、cdc、e9c、c5b 归成同一类：承诺没有主人。
- 不同 ②：它的判据「什么都不做时 4 个弹窗的名字断言红」，对花钱卡，红的原因是标题元素上没有 `aria-label` 属性（`modalAccessibleNames.test.tsx` 的 `titleLabel` 只读属性），不是读屏念错了名字。和普查一样量的是属性，不是 accname。
- 不同 ③：它认为清空存量名单以后「这一类不会再靠人记着补」。本复盘认为普查是语法判据，有漏判口子（`:57-58` 找不到初始值就当纯文字、`:81` 深度上限），口子本身又是可选的，所以只算门岗；要做到写不出来，得让 `title` 只收字符串。
- 不同 ④：它没提 `SpendConfirmDialog.tsx:117`/`:160` 那套旧机制还留着（加新没删旧），也没把走查锚点（e9c、cdc）算进同一类。

## 实现时的重核与更正（实现线 I-dialog-shell-library，2026-11-22）

- 行号：实现分支从 `1745327c7` 拉出，上文 file:line 逐条在这个提交上重核过（`overlays.tsx:7`/`:22`/`:23-28`/`:60`，`SpendConfirmDialog.tsx:22`/`:117`/`:136`/`:160`，普查 `:81`，`catalog.mjs:257`），一致。之后 main 进来的 #1595 只改 `electron/` 与夹具，不碰这里列的任何文件。
- 「外壳能不能在 Mantine 标题元素之外渲染头部内容」：能。Mantine 8.3.18 的 `Modal` 本身就是 `Modal.Root` / `Modal.Overlay` / `Modal.Content` / `Modal.Header` / `Modal.Title` / `Modal.CloseButton` / `Modal.Body` 的组合（`node_modules/@mantine/core/esm/components/Modal/Modal.mjs:67-103`），各部件只认上下文，`Modal.Header` 里放什么由我们定。
- 「副标由外壳挂成 aria-describedby」：做不到、也不做。Mantine 8.3.18 在对话框本体上把 `aria-describedby` 写死指向 `Modal.Body`、`aria-labelledby` 写死指向 `Modal.Title`，而且写在 `...others` 之后，外面盖不掉（`node_modules/@mantine/core/esm/components/ModalBase/ModalBaseContent.mjs:39-43`）。协调 2026-11-22 裁定照库原样：副标放在 `Modal.Header` 里、阅读顺序上紧跟名字，删掉 sr-only 复本；代价是 NVDA 焦点刚落到对话框时不会把副标当「描述」先念，要往下读才念到。
- 锚点：协调裁定外壳删 `contentAttributes` / `accessibleName`，只留带类型的 `testId`（渲染成 `data-testid`）；消费不超过 5 个文件的锚点本刀迁成按角色 + 名字找，消费多的照原名留在对话框本体上，进冻结名单（只许减）。
