# 方向检查：选区芯片 × 与常驻助手外壳的职责

只读复盘；2026-11-17；借用工作树 「协调证据目录」，全部代码行号固定在 `3ba25d8dd4f669bbf9bdcf1bd012d973b04cef3d`（原实现 PR）。本线未参与此前实现，未改仓库、未复现新窗口。以下“建议／应当／待补”均未实现。

**这一处的全图在哪**：普查链「助手」的 `assistant.context`；本仓 `docs/engineering/seams.json:3–96` 没有这条交接处，按模板记“表外”，本线不修改登记。全图为第 2 节；机器数门原件在 「协调证据目录」。

### 0. 一句话根因

芯片的显示适配丢了对象身份、也未绑定主人的动作，外壳再按显示类型猜该改谁，而类型与验收只保证“有芯片／主人算得对”，没有保证“每颗可点的 × 能改主人并改变这一轮请求”。

已定约束全部沿用：既定决定（当前芯片与新发送一致、无“已变更”）；既定决定（先删掉能写错的结构）；既定决定（主人规整、外面只读）；既定决定（见第 6 节）。不重新评这几个决定，不处理 既定决定 的画布／文稿缺芯片，不改 UI 样张。

### 1. 归类表：bug → 直接原因 → 类

| 提交／bug | 直接原因与证据 | 类；与本次关系 |
|---|---|---|
| `14d1d609b`，窄窗点开后存下的形态被改成停靠 | `git show`：外壳挑参考图时直接 `setForm`，改为瞬时 `requestForm`；主人区分持久选择与临时显示 | 持久／瞬时语义混用；外壳跨域写口，非选区复发 |
| `8acd4bfb0`，创作区“视频图标”实际拆分镜并发送文本 | `git show`：动作表统一图标与去处；外壳删内联消息拼接，改用 `storyboardLaunchMessage` | 显示意图与动作去处分家；外壳另拼一份领域决定，非选区 × 旧修复 |
| `08f780393`，对话跟底／换线程位置错误 | `git show`：删自写跟随及线程位置记忆，接 use-stick-to-bottom；外壳由 `flowScrollMemoryFor` 换成 `conversationKey` | 通用滚动自写／生命周期；外壳仅接线变更，不能归成选区多算 |
| 本次选区芯片 × 无效（修前也有） | `ProjectAgentResidentShell.tsx:505–511` 仅 skill/file 分支；`v4/useAgentPanelV4Data.ts:317` 只保留 kind/label、丢 member.id；`v4/AgentPanelV4Composer.tsx:74–76,226` 仍画按钮并调用可选通用回调 | 可交互表示没有绑定身份及主人的动作；既有缺口，非 既定决定 新引入。`git blame -L 505,511` 全段来自 `8e89e19cea`（09-19） |
| X1：芯片名字另转大写，检查全绿 | `useAgentPanelV4Data.ts:317` 消费主人后仍可加工名字；验收 `X1-other-name-algorithm.diff`、broken.log（11 条过、EXIT 0）及 X1-lint/concept-broken.log（EXIT 0） | 主人输出下游再次解释；只测主人，没测实际显示 |
| X2：发送优先草稿旧快照，检查全绿 | `useAgentPanelV4Actions.ts:213` 改成 `capturedIntent?.contextSnapshot ?? captured.snapshot`；`X2-old-snapshot.diff`、broken.log（63 条过、EXIT 0）及 X2-lint/concept-broken.log | 请求组装层还能绕开当前选区；只测局部恢复合并，没覆盖发送端带旧快照的实际输入 |
| X3：换词加回 updated 后缀，检查全绿 | `useAgentPanelV4Data.ts:317` 拼 `' · updated'`；`X3-renamed-suffix.diff`、broken.log（11 条过、EXIT 0）及 X3-lint/concept-broken.log | 同 X1；删除符号断言只封旧拼法，没封显示结果漂移 |

表内代码根目录均为 `src/workbench/ai/`；X 系列原件根目录均为 「协调证据目录」。全量改坏汇总已读 `mutations.json` 与 `mutations-extra.json`；本线没有重新改坏仓库。

**计数重核**：运行 `node scripts/fix-churn.mjs src/workbench/ai/ProjectAgentResidentShell.tsx src/workbench/ai/resident/ --json`，退出 1 是“命中热点”的预期结果；外壳近 14 天 fix=3、revert=0，确为拟第 4 次；就是上表三个提交。resident 在修前 `bd819e18c` 是 3 个 fix（`cdb2d35e1`、`08f780393`、`228ca124d`），在借用 HEAD 已是 6 个（多本 PR `2e66d1212`、`2b428cee1`、`d17abc78f`），涉及 7 个源码文件，超脚本目录上限 6，当前不按整目录判热；其中 timelineAgentSurface 文件单独已有 3 个 fix。任务书“目录 3 个”是修前口径，不能冒充当前数。原件：`fix-churn.json`、`history.txt`；另用 `git log bd819e18c --since=2026-11-03 --no-merges -- src/workbench/ai/resident/` 核了修前值。

### 2. 为什么这一类会一直出现：读、改、发的全图

| 环节／主人 | 实际路径 | 缺口 |
|---|---|---|
| 工作台选中 | `src/workbench/workbenchStore.ts:669–687,760–763`；媒体 ID 数组与文字单 ID | 当前媒体／字幕点选互相清空；不能拿普通单选操作冒充混合选区复现 |
| 规整与命名 | `resident/residentContextSnapshot.ts:128–162,210–244,272–288` 的 selectTimeline／resolveResidentSelection | 这一层已共用成员过滤、顺序、名字；这里不是 × 的写主人 |
| 实时订阅与显示适配 | `resident/timelineAgentSurface.tsx:93–104` → `v4/useAgentPanelV4Data.ts:309–319` | 成员原有 `{id,title}`，转 V4Chip 时只剩 `{kind:'clip',label}`；显示类别被当成业务类别 |
| 点击 | `v4/AgentPanelV4Composer.tsx:54,74–76,101,221–226` → 外壳 `:505–511,625` | 只读历史与当前可移除项共用 V4Chip；id 可选、onRemoveChip 可选；有按钮不等于有动作；外壳没有 clip 分支 |
| 新发送 | `v4/useAgentPanelV4Actions.ts:47–73,163,200–223` | 主人输出正确，但请求组装处还接受一份旧 `capturedIntent`，有机会重新选快照（X2） |
| 草稿带回／重放 | `projectAgentDraftRecovery.ts:9–16,28–57,62–71`；`electron/agentLane/laneInputIntent.mts:59–65`；`laneHost.mts:553–569` | 草稿恢复只保留旧模板、当前目标／快照不被覆盖已实现；继续／重试保留原轮是另一条有意路径，不应误封 |

机器扫描：第一组 3143 文件、5 个文件＋符号门（5 次出现），含 removeComposerChip 转交与主人两头调用；第二组 17 门（35 次出现），涵盖时间轴／预览、技能库、附件与行内引用写入口。注意工具把 `residentSelectionInput` 按命名启发式报 write，它实际是纯适配，不能把 5 门误报成 5 个状态写者；同名符号转交也会计入。完整原件保留，不用人工表替代。再跟一跳确认：外壳 `:625` → Panel 的 composer props（`v4/AgentPanelV4Panel.tsx:115–118`）→ Composer `:226` → 外壳 `:505`。

**芯片种类数清**：当前类型 3 种 kind（`v4/agentPanelV4Types.ts:96–97`），来源 4 类；选区分媒体／字幕两子型，共 5 种内容。不能只补视频。

| 内容 | 显示来源／身份 | × 现在由谁处理、改哪份状态 |
|---|---|---|
| 文件（含上传未完成／错误的媒体） | Data `:311`，有附件 id | 外壳 `:507–509` 找附件 → `composer/useComposerAttachments.ts:200–209` 按 ID 删 `projectAgentAttachments` 并释放预览 URL；不删源素材 |
| 技能 | Data `:312–314`，未携带 skill key | 外壳 `:506` → 真 store `setCreationActiveSkill(null)`；`workbenchStore.ts:370–373` 同时清 selectedLibraryPrompt、递增草稿 revision 并清恢复模板 |
| 提示词库条目 | Data `:315`，也伪装成 kind=skill | 走同一个 `setCreationActiveSkill(null)`，真 setter 同时清提示词，代码上可生效；不能因 kind=skill 就误报提示词 × 无效（本线未做窗口验证） |
| 时间轴媒体选区 | Data `:317`，丢 member.id | 外壳没有对应分支；`selectedTimelineClipIds` 不变，请求仍带该段 |
| 时间轴字幕选区 | 同上，使用同一个 kind=clip | 同样无动作；`selectedTextClipId` 不变，非视频专属问题 |

相邻入口也核过：①导演台焦点标签不是 V4Chip，`v4/AgentPanelV4FocusTag.tsx:11–18,30–35` 必有 onClear，`src/workbench/generationCanvas/nodes/director/panels/shotStrip/useShotFocusTag.ts:39–44` 直接给 `clearDirectorShotFocus`；这是仓内可复用的正例。②已就绪媒体改为编辑器行内引用，外壳 `:613` 隐藏重复附件签；删除引用走 `resident/useAgentReferenceMentions.ts:77–81` → 同一附件 remove；不是另一个待补 clip 分支。③历史气泡仍用只读 V4Chip（`v4/AgentPanelV4Message.tsx:29,60`），不要给历史消息补取消选中副作用。④分镜勾选引用走 Actions `:171–181`，画布／文稿选区不出这行芯片，沿任务边界不扩 UI。

**共同结构与边界**：外壳反复被改有“容器汇集不同职责”的原因，三次历史修复不是一个 bug 回来三次；但这次与 `8acd4bfb0` 都暴露“显示的东西和实际动作分开声明”。只把外壳拆小文件不会自动修这类问题；必须删掉外壳猜业务动作、显示端重新命名和发送端另选快照的机会。ID 决定对象、kind 只决定样式；可移除能力由主人给，不能从颜色／label 推断（上述 Data／Composer／外壳链）。

**落到体验铁律**：主挂 ⑫“点了＝以为的”：点 × 后应取消这一对象的选中，芯片消失，下个新发送不含它，源片段不删除。⑩可借用“显示和请求一致”的比较思想，但原条讲生成参数，本线不伪称已完成参数全链；⑪模型参数可选项不适用。任务未指定逃逸账本 ID，catalog/escapeLedger 检索未找到本条现有记录，不能结账；后续实现应按 ⑫ 建正式回归，本线不越权写账本。

**最早本应拦住的步骤：设计／接口定义。** V4Chip 把业务身份做成可选项，而 Composer 无条件画 ×；这一表示本身允许“有按钮但没有动作”，之后再查有没有 chip／有没有 owner 无法补齐。实现阶段少 clip 分支未被类型拒绝；验收阶段 `residentSelection.test.ts:42–53,75–107` 比的是两个纯解析结果，并未渲染 Data／外壳／按钮；`useAgentPanelV4Actions.test.ts:16–72,376–383` 用局部 store 和 say mock，旧恢复样本无旧快照字段；`residentSelection.test.ts:143–148` 只禁旧符号；`scripts/resident-selection-owner.mjs:14–32` 只禁原始字段读取。因此三个 X 都没触线。原因不是“人没注意”，是合同边界和量具形状都漏了点击及最终组装。

### 3. 不改结构，接下来会冒出什么（预测先写死）

| 预测 | 量具／复查日期／失败标准 |
|---|---|
| 给 clip 补一个外壳分支后，新增一种引用还会出现“显示支持、动作漏接”；同名片段可能无法区分 | 后续实现前新增“同名双片段、单字幕、失效旧按钮”的交互夹具；核 stable ID、剩余选中和最后一条新输入快照。2026-12-01 复查；任何有 × 无动作、按 label 找对象、又给外壳加业务分支即失败 |
| 主人纯函数全绿，显示适配仍能改字／加后缀 | 重放现成 X1、X3 的实际 diff，运行真实显示与请求比较；改坏必须红、还原绿。2026-12-01 复查；大写或任意新后缀仍全绿即失败，不能只换禁词 |
| 草稿主人已修，发送端仍能重新借旧快照 | 带旧 contextSnapshot 的真实旧形状草稿 A，工作台改选 B，经实际 send 到 lane 接纳／回环请求；新发送只含 B，另测 retry/continue 仍为 A。2026-12-01 复查；X2 仍全绿或重放被误改即失败 |

预测目前是待检验，未运行新测试。后续以这三条为设计卡 ★9；一条失败即重开方向检查，不以补更多关键词结束。热点指标只算选区／芯片职责的修复，不把滚动修复算成选区回归。

### 4. 靶子独立性检查

- 本线只借验收线既有真窗口证据，亲眼读了 zh/en 的 chip-x-after-click 图片：Reaction 仍在，时间轴仍高亮；commands.jsonl 中文 `:110–115`、英文 `:81–85` 有实际 click，不是截图推断点击。`after-zh/requests.json` 的零起序号 7、after-en 的 10，最后一条用户输入 `V_chip_x` 的当前快照均有 `clip-b`、Reaction、startMs=5067；本线提取在 `request-excerpts.json`。对比清空工作台后中文 8／英文 11 当前快照没有 timelineClip。只解析当前输入，不能因历史消息仍含旧段就判“仍发送”。
- 证据差异：现有 × 样本只有单片段；真实“视频＋字幕两颗，删其一留其一”尚未构造成功（验收报告 `既定决定.md:23–24,38`）。不能把纯函数混合样本 `residentSelection.test.ts:85–88` 写成真实混选验过；本线未开窗口、未补造证据。
- 验收线独立于实现线；本线未参与旧修复。实现侧纯函数对拍共享同一 selectTimeline 算法，能证明主人内部一致，不能独立证明 Data 展示／Shell 点击／Actions 最终请求。X1/X2/X3 是独立反证；诊断概念门岗绿只覆盖所声明范围，不能扩大成所有 CI 均已验证。
- 未查到“此处修对反而掉分／被回滚”的实际先例；git 近 14 天所查范围 revert=0，不外推全仓。旧 AnnotateToAgent 板 `docs/design/boards/2026-10-18/AnnotateToAgent.board.json:615` 还写版本变标“已变更”，它已被任务书中更新的用户决定覆盖；后续验收靶子须同步，不应为旧板把后缀加回。本线不改板。
- 新靶子应由后续独立验收线从点击目标的身份、源工作台和最后一条回环请求核对，不照抄新实现的数组作为 expected。

### 5. P0：哪些独有、现成怎么做

下列均于 2026-11-17 真实读取官方网页，详见 tmp 的 `sources.md`；不是凭记忆。当前装的是 React 19.3.0、Zustand 4.5.7、TypeScript 5.9.3。

| 出处 | 现成做法 | 对本次决定的影响 |
|---|---|---|
| [React：Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure) | 避免矛盾／重复状态，从现有状态可推导的值不另存 | 不添加 dismissedClipIds／芯片隐藏副本；× 改现有工作台选中，显示与发送继续派生同一份 |
| [React：Sharing State Between Components](https://react.dev/learn/sharing-state-between-components) | 一个状态由一个主人持有，受控子件拿状态及事件处理器 | 复用现有 store 与受控件；名字、身份、动作在主人一侧绑定，壳不按显示种类猜动作 |
| [TypeScript：判别联合与穷尽检查](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions) | 成员所需字段写成必填；never 检查暴露遗漏分支 | 当前可移除项必须有 ID 和动作；历史只读项保留只读表示。没有动作就不能构造一颗“可移除”的项 |
| [AI Elements：Attachments](https://elements.ai-sdk.dev/components/attachments) | 官方例子按 file.id 绑定 onRemove，移除按钮是组合件 | 采用绑定身份与动作的现成做法；不要新造通用 chip 框架。它不负责取消 Nomi 时间轴选中，也不能替代领域 owner；网页公告月底迁至 shadcn/ui，本次不引入该组件 |

领域独有的是“当前工作面哪些对象算本轮选区、字幕顺序、文稿 source、恢复与重放的区别”，留在现有主人；受控状态、身份绑定动作、穷尽类型均不独有。`docs/engineering/self-written.json:521–525,556–557` 将 resident／外壳列为领域目录，这不是可豁免通用错误表示的理由；本次未命中独立 under-review/to-replace entry ID，不虚构登记。依赖决策：保留已安装 React/Zustand/TypeScript，不加依赖；未发现需要靠升级第三方修复的机制。Zustand 两个旧官方文档地址 404，未作为依据。

### 6. 三条路对比表 + 推荐

下列路径从仓库根目录计；行号均为借用 HEAD。**先定用户结果**：× 是取消该对象的选中，并不删除素材；剩余芯片与下一条新发送一致；发送中的已冻结回合与历史重试不被追溯改写（延续 Actions `:43–45,163–189` 的同步捕获、异步接纳边界）。若想“时间轴仍高亮 A，但这一轮暗中排除 A”，就需要第二套纳入规则，本线不默认新增这种产品概念。

| 选项 | 做什么／改哪些文件 | 能整段删掉什么（确切现有位置） | 代价／风险／新增创作者概念 | 证明“显示＝新发送”的测试 |
|---|---|---|---|---|
| 沿原方向修 | 保持 Data→V4Chip→Shell 通用分派；Data 保留成员 ID；Types 强制当前可移除项 ID，Composer key 改用身份；Shell 改成穷尽分派；workbenchStore 加原子取消单个媒体／字幕选中动作，不能调用会互清另一域的现有 setter。改 `useAgentPanelV4Data.ts`、`agentPanelV4Types.ts`、`AgentPanelV4Composer.tsx`、`ProjectAgentResidentShell.tsx`、`workbenchStore.ts`、相关测试 | 替换删除外壳旧两分支函数 `ProjectAgentResidentShell.tsx:505–511`（新分派仍在外壳，不算职责消失）；删其 `:508` 按文件名兜底识别；替换 Data `:317` 丢 ID 的投影和 Composer `:223` 按名字 key | 最小现场 diff；无新用户概念，但每类新增引用仍要在显示与分派两处接，X1/X2/X3 仍写得出；须靠边界测试发现，未满足“以后写不出来”的目标 | 扩 `tests/ux/agent-selection-one-home.walk.mjs`：实际 × 后核工作台、剩余 DOM 签与最后输入 snapshot 的有序 ID/标题；同名双片段、字幕、混合互不误清；再覆 X1/X2/X3，不能只跑 residentSelection.test |
| 换一种做法（推荐） | 复用现有 React 受控组合／TS 必填能力，不换状态库。保留 `residentContextSnapshot.ts` 规则主人；由主人附近的局部组合点给“已绑定身份和移除动作的当前引用件”，外壳只摆这些件，不再收 kind/label 猜写口。可新增局部 `resident/ResidentComposerContext.tsx`，收走当前芯片组合（复用附件 remove 和技能 setter），选区移除由 `workbenchStore.ts` 的原子、幂等动作负责（不是 toggle；重复点击不重选，不误清另一子型；过期项目／会话的按钮不能改新项目）。将本轮选区 target/snapshot 的配对组装收回主人边界，Actions 只用完整当前结果，不单独选择旧快照。改上述文件、`timelineAgentSurface.tsx`、`useAgentPanelV4Actions.ts`、Panel composer 接口和概念登记／测试；不搬整个外壳 | 删除整个外壳 `:505–511`、`:625` 通用 remove 路由；删除 Data `:309–319` 在外侧重造当前芯片的整块（职责收进局部主人组合，不声称逻辑凭空消失）；移除 Composer `:101,226` 的跨层 kind/index 分派和 `:223` label key；搬走 Actions `:200–202,213` 分别挑 target/snapshot 的权力。只读历史仍用 V4Chip，不能全仓删该类型 | 中等；不添创作者概念。× 同步取消工作台高亮；源视频／字幕内容不动。不写排除名单、插件框架、第二个通用 controller。主要风险是误清另一种选中、旧草稿／重放被混同；需独立闭环验收 | 同一真实操作经现役组合件到回环请求对比；再加类型反例：缺 ID／缺 remove 的可移除项不能构造；X1/X3 旧外侧修改点已消失，若在新显示边界改字必须被 DOM 对拍判红；X2 旧独立快照选择口消失，若在最终接纳处改回旧快照必须红；还原均绿 |
| 删掉（最小单位：只删选区签的 ×） | 保留选区签只读，用户回时间轴改选；文件／技能／提示词的 × 保留。改 `AgentPanelV4Composer.tsx` 的可移除表示及 `agentPanelV4Types.ts`；同步原走查／组件夹具，不删 selection owner，也不删除任何片段 | 删除 Composer `:74–76` 的“无条件可移除”按钮块，改为仅可移除项有按钮；clip 不再实例化这一块。这里没有可单删的 clip 专属处理函数（壳本来就没有），不可声称删掉整个 ComposerChip 或壳 `:505–511`；其余项仍需它们 | 代码最少、无新概念，但多一次回工作台改选，直接损失用户想就地移除一项的便利；它只消灭空动作，不消灭 X1/X2/X3，不能当整类解决 | 组件/窗口断言选区签无 ×，其他 × 仍有效；工作台改选后，实际 DOM 签与最后输入 snapshot 精确对拍。此路径不可能交“点击选区 × 生效”收据，必须明示能力撤掉 |

**三条路逐项过老用户／旧数据**（不读取用户真实项目）：

- 沿原方向修：保留 `AgentContextSnapshot v1`、LaneDraftIntent、附件、技能和模板格式。旧草稿按 `projectAgentDraftRecovery.ts:28–57,62–71` 恢复文字/附件/技能/意图；芯片由当前状态重建，不能给仅有旧 label 的项猜 ID。旧 intent 的目标/快照继续由 `laneInputIntent.mts:59–65` 不采纳，只取当前选区；继续／重试仍按原轮。旧项目内容不改；选择字段按现有会话初始化/存活过滤。缺 ID 的不可解析对象不显示虚假删除能力，不静默删除源素材。
- 换：完全沿用上述磁盘与草稿格式，只在渲染时重建绑定 ID/动作的当前引用件；函数不序列化、不写草稿。旧快照只留历史／重放，不作为新轮候选；旧有附件 ID、技能 key 能重建动作。旧项目的选中仍回现有 owner 处理，不另迁一套芯片状态；不批量改项目、不清用户草稿、不增加 schema 版本。旧 label 不能唯一识别时沿现有当前工作台状态重建，不能据名字改对象。
- 删：旧草稿、附件、技能、提示词及历史快照全保留，旧选区重建为只读签；用户到时间轴改选后仍可发送。无数据迁移，但旧用户看到 clip 的 × 消失，这是可见能力削减，需用户选这条路后才派实现；不得顺便删技能／文件移除能力。

这些兼容判断来自：`src/workbench/project/workbenchProjectSession.ts:10–26,29–40` 当前项目保存不含芯片/草稿/时间轴选中，画布保存 document snapshot；`projectRecordSchema.ts:129–145` 无 V4Chip；`workbenchStoreLifetime.ts:50–69,92–109` 定义会话归属和初始化；`projectAgentDraftRecovery.ts:9–16` 保存的是领域输入而非 V4Chip。它们支持“不新增迁移”的方案判断，**不能证明所有历史版本冷启兼容**；真实旧会话冷启仍未验，沿验收报告 partial。

**推荐“换”，限定为这一块的职责收口。** 现成的受控组合、ID 绑定事件和 TS 必填字段已够用；仓内焦点标签是直接样板（第 2 节），不引新依赖、不重写整块 Agent。相比只加 clip 分支，它删掉了外壳按显示类型做决定的机制；相比删 ×，它保住用户此刻就地减掉一个引用的结果。只读结果指向同一主人，取消也回同一主人，符合一个东西一个家（`docs/design/nomi-design-system.md:100–120`）。

“写不出来”的可核范围：正常扩展路径不能再构造无 ID/动作的可移除项，不能在外壳另设 kind 分派，不能给新发送同时传“当前”和“恢复旧值”两个可选选区。TypeScript 的 readonly 不会禁止开发者复制后改 label，任何人也能改主人代码；因此仍须保留实际显示→请求的独立比较，不能宣传任意改坏都不可能。新的边界若只挪函数、仍把原始 store／任意 label／旧 contextSnapshot 交给两头，判为未达到推荐方案，不用再添禁词补救。

**系统改进的验收单元（待实现，不冒称已拦住）**：

1. 先在接口结构上分开“当前可移除引用”和“历史只读显示”，把删除动作与 ID 绑定；生产 Composer 不再接壳的通用 onRemoveChip；当前选区配对的请求字段只在主人内部构造。缺字段的 fixture 必须类型红，新增类型漏动作也应红；不为静态取景伪造动作。
2. 量具从主人函数对拍升到现役 UI／动作／最终新输入的比较，比较的是 timelineClip 子集的 ID、顺序、原始标题；不拿包含 document source、导演焦点、@素材的总 handle 数等于 clip 签数，否则误伤已知有意不同。40 节点压缩预算、画布/文稿缺签不在本轮改。
3. 用两个真实案例和一条正例检验：本次“Reaction × 无效”须先红；旧 `8acd4bfb0` 那个显示意图/去处分家的浮条案例应由其现有动作表唯一分派保持约束（不再把消息组装搬回壳）；正例焦点标签 onClear→主人清选中、以及 retry/continue 保留原轮都须绿。前者证明移除闭环，旧案证明单点定义动作的做法能复用；不是声称一个新 chip 类型可包办所有浮条图标语义。
4. 独立验收线重放 X1/X2/X3：新生产显示改名／加任意后缀→红，最后新输入优先旧快照→红，还原→绿；中文/英文均看截图并核请求。门岗补的是边界合同的接入，不能仅再登记 3 个禁词。2026-12-01 按第 3 节复查，任一失败重开；本线没有这些未来测试收据。

### 7. 用户要权衡的核心

要保留输入框里就地取消一项的便利，就让 × 直接取消它在工作台主人那里的选中，并收掉外壳猜动作的权力；若不愿付这次收口代价，最诚实的退路是删掉选区 ×、回时间轴改选，不能只隐藏芯片却照发。

## 特征测试清单与自验

- 已有但只读未跑：`src/workbench/ai/resident/residentSelection.test.ts`（成员/字幕/名字/存活/去重）、`residentContextSnapshot.test.ts`（快照）、`v4/useAgentPanelV4Actions.test.ts`（发送与草稿）、`tests/agent-runtime/lane-replay-admission.test.mts:34–43,93–132`（恢复当前、重放原轮）、`tests/ux/agent-selection-one-home.walk.mjs:217–223`（既有窗口对照）。验收线日志为既有收据：四文件 79 过、runtime 8 过；不算本线新验证。
- 尚未钉住：实际 ×→选中→最后请求；同名双片段；真实媒体＋字幕混合移除；X1/X2/X3 的端到端反例。现成测试缺口见第 2/4 节，不能给修复报绿。
- 设计卡 ★9 反例改坏→红／还原→绿：本线只读、不写实现，**不适用**；只审了验收线已有 diff/日志。没有自写函数级执行探针，因此无 fetch 金丝雀需要执行；日志提取仅 Python JSON 读取，不加载产品函数、不联网。
- 未跑 gates、gates:contracts、全量 pnpm test、check:design-lab；未构建、未起窗口、未花钱、未读取 Key/用户真实资料、未连接供应商、未动代理、未起子 agent；没有提交/推送/留言/PR/合并。仅写本文件、指定报告和 tmp/既定决定。
- 终态 HEAD、已跟踪文件状态及磁盘以报告和 tmp/final-state.txt 的结束前实查为准；这份是方向建议，不是修复完成收据。

用户 2026-11-17 选：换
