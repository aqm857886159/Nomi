# UX6 方向检查 · 从空文稿到打开项目

独立复盘基线 `8ac07cffb`。近 14 天 `WorkbenchEditor.tsx`、`src/workbench/library/` 和 `editor.rich-text-actions` 各有 2 个 fix，本次再改触发第三次检查。计数说明改动频繁，不能据此把打开项目和富文本归成同一个代码缺陷。

**全图**　提示 → 选区 / 全文 → 分镜启动器或画布节点；线程用量投影 → Agent 标题栏；项目卡 → 打开项目或提交新名称。这三段交互在基线 `docs/engineering/seams.json` 表外。格式命令的既有登记见 `docs/engineering/concept-owners/editor.rich-text-actions.json`。下列行号均指基线。

### 0. 一句话根因

界面按控件是否存在来给入口，缺少用创作者当下能拿什么内容、点完到哪里来验收入口的约束，归类为 `recurring`。

### 1. 归类表

| 现场 | 直接原因 | 类 |
|---|---|---|
| 空文稿叫人「点右侧」，全文没有直接拆镜入口 | `src/i18n/locales/creationAi.ts:30` 指定方位。`src/workbench/creation/WorkbenchEditor.tsx:252` 只向选区浮条交启动器 | 文字承诺与可执行范围脱节 |
| 344 px 下选一句，重复出现 B/I/H1/H2，拆镜、图、视频只有图标 | `src/workbench/creation/SelectionGeneratePopover.tsx:91` 再取顶栏已有格式命令，`:133` 用图标呈现领域动作。11 月 8 日已有把拆镜读成视频的实案，见 `src/workbench/creation/selectionActions.ts:10` | 可见目标未交代后果 |
| 新线程的「—」可展开，显示三项 0 和未知费用 | `src/workbench/ai/lane/laneViewModel.ts:492` 格式化累计值，`src/workbench/ai/v4/AgentPanelV4Panel.tsx:412` 始终挂载用量入口 | 汇总初值成为可查询记录 |
| 可打开卡片的标题单击后留在项目库 | `src/workbench/library/ProjectLibraryPage.tsx:636` 为双击改名截断单击，卡片 `:540` 收不到打开事件 | 主动作与编辑动作争同一目标 |

### 2. 为什么会复发

最早漏在设计验收的 **⑫ 点了=以为的**。基线即有动作分派测试，但它在拿到正确动作 ID 后才开始断言。格式测试还要求三个壳都画格式钮，用量测试要求空数据印「—」。这些断言都允许用户按文案找不到入口。类检查应按 `tests/ux/full-walk/catalog.mjs` 的 `userExpectation` / `actualObservation`，核到真实内容、落点与结果。⑩ 模型参数和 ⑪ 档案可选项均未参与此次故障。

### 3. 可证伪的预测

| 若保留现结构 | 复查方法 |
|---|---|
| 英文动作名变长，选区浮条会优先给重复格式占位置 | 在 344 px 选一句，中英各按可见名称从浮条或「更多」下达三种动作，查选句与实际去处 |
| 仅按数值或字符串判有无记录，会漏报实测 0 或把新线程默认 0 当已测量 | 对照新线程、已测且缺窗口上限、已测且有上限三例，分别核入口、已用量和百分比 |
| 给双击留等待时间会拖慢日常打开 | 单击可用标题立即进入对应 ID；直接改名只更新该项目，可用键盘提交或取消 |

### 4. 靶子独立性

上述真实 Electron 现象由协调线提供，本复盘未参与实现、复现或此前修补。此前实际「修对反而掉分」的记录未知。已确认旧尺子会要求空线程显示「—」、选区继续画格式按钮；仅改这两条旧期望，同时保留无分母的真实用量、顶栏与画布格式动作等正例。全部隐藏或去掉分镜、改名均须验收失败。

### 5. 这一整块归谁

这一整块：文稿动作的对象和去处、当前线程的用量入口、项目卡的打开与改名。
归谁：选区分派 `src/workbench/creation/selectionActions.ts:67`，格式 `src/workbench/common/richTextActions.tsx:91`，溢出 `src/design/NomiOverflowRow.tsx:161`；线程数据 `src/workbench/ai/lane/laneViewModel.ts:485`，显示 `src/workbench/ai/v4/AgentPanelV4Context.tsx:24`；改名与打开 `src/workbench/library/ProjectLibraryPage.tsx:165`、`:229`。
我们哪里绕开了它：`src/workbench/creation/SelectionGeneratePopover.tsx:133` 使用正确分派却隐藏动作名称；`src/workbench/creation/WorkbenchEditor.tsx:251` 顶栏未利用已有全文读取口；`src/workbench/ai/v4/AgentPanelV4Context.tsx:79` 无记录也画可展开目标；`src/workbench/library/ProjectLibraryPage.tsx:636` 标题截走整卡打开动作。

### 6. 三条路

| 路线 | 做法与代价 | 复发与风险 |
|---|---|---|
| 沿原方向修 | 改图标、补 tooltip、协调单双击；代码改得少 | 仍要猜图标与手势，全文仍需手选 |
| 换交互，复用现有组件（推荐） | 文稿提示指明真实动作，选区动作写名称，超宽交现有溢出；全文与选区用同一分镜入口；空线程隐去用量；标题走整卡打开，显式改名沿用原编辑器 | 窄时次要动作多一步；需验证选区在菜单打开后仍准确、旧会话可查、改名无导航。#1548 持有的 Agent 文件由其原线维护 |
| 最小删除 | 删除选区内的四颗格式钮，顶栏和快捷键保留；删除空线程的用量入口。不涉及项目数据迁移 | 可减少占位；单靠删除仍缺全文拆镜，删去标题改名手势前须有直接替代入口 |

### 7. 用户权衡

窄窗里可以为次要动作多开一次菜单，换取第一眼知道能对哪些文字做什么；每天点项目标题直接进入，改名保留一个可见且可键盘操作的目标。

**基线特征测试**　`src/workbench/creation/selectionActions.test.ts:30` 钉住三种去处及空白输入；`src/workbench/creation/WorkbenchEditorToolbar.structure.test.ts:1` 钉住测宽和撤销重做；`src/workbench/common/richTextActions.structure.test.ts:15` 守格式主人；`src/workbench/ai/v4/agentPanelV4Blocks.test.ts:583` 覆盖已用无上限和有上限；`src/workbench/library/ProjectLibraryPage.folderMissing.test.tsx:72` 覆盖目录丢失样本。原测试未锁住上表的标题点击、344 px 选区可读性与真实新线程，实机复现为修前依据。

**独立结论写定后对照拍板**　协调先准分桶 A，#5②、#11 当时仍待用户定。随后用户「都按推荐」，与上述方向一致，并指定选句三种动作显示短字，顶栏行内代码、分隔线、表格收进同一个「⋯」，右端放「拆成分镜」，第一轮真实用量到达后才露入口。依此执行；正常空会话不能仅因宿主给出 `"0"` 和 `"—"` 就显示按钮。标题单击及直接改名按本轮任务单验收。[协调分桶 A](https://github.com/aqm857886159/Nomi/issues/1586#issuecomment-7126279479) · [分桶 B 用户拍板](https://github.com/aqm857886159/Nomi/issues/1586#issuecomment-7126560423)
