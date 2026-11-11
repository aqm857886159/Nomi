# 2026-11-09 · 创作文档选区动作：一张表、一条分派；「拆成镜头」按样张 B 换图标挪位

改动名：选区浮条动作收成一张表 + 一个分派函数；「拆成镜头」换分镜图标、挪到「AI 编辑」右边；对话里的技能名改走主进程同一份查找　类别：[新界面]（改已有浮条的长相与位置，用户 2026-11-12 拍板样张 B）

> 2026-11-12 更新：看得见的那半不再交出图待定——用户在 Claude Design 画布上对比现状 / 方案 A / 方案 B 后说「图标样张选 B」。本卡从「看不见的修复」升到标准档、按新界面填 9 格。拍板清单：`docs/design/boards/2026-11-12-selection-storyboard/SelectionStoryboard.board.json`。

## 用户报的问题与真实复现

- 原话（2026-11-08）：「我在文本区域点击了，滑中句子，点击视频icon，然后为什么发送了文字，这个是个问题。」
- 修前真机复现（隔离资料、loopback 夹具模型、零花费，开发构建，中 / 英各一遍）：创作页点正文 → 鼠标拖选一句 → 浮条右侧三颗图标依次点。
  - 第二颗**摄像机**（「生成视频」）：建一个视频节点（提示词 = 这句），切到生成画布；夹具文本请求 0 次，对话里没有消息。这是拍板设计（`docs/design/boards/2026-10-19/CreationAiRewrite.board.json` FUN-06）。
  - 第三颗**胶片**（`IconMovie`，「拆成镜头」）：选中的句子作为一条用户消息发进右侧 Agent 对话，夹具收到 1 次文本请求；气泡上只有这句话和一颗印着原始 key `workbench.storyboard.planner` 的小签。**这就是「发送了文字」**：胶片在设计系统盲测下读作「视频」，后果却是把文字发进对话。
- 和用户那次的差别：夹具模型不是真模型（这里只看「发出去的是什么」，与模型无关）；用户原图没有留，用户点的是哪一颗由「发送了文字」这个后果反推（只有胶片会发）。

## 设计卡（9 格）

- ★0 先查别人：
  - NN/g 图标可用性（https://www.nngroup.com/articles/icon-usability/）· 大多数图标有歧义，要靠文字标签消除，不要只靠悬停露名字 · 影响「换不换图标」：换成语义表里已登记为「拆解」的 `IconLayoutRows`；没照学常显文字（浮条密度优先，用户拍板尺寸、名字不变）。
  - Microsoft 命令栏指南（https://learn.microsoft.com/en-us/windows/apps/design/controls/command-bar）· 命令按逻辑分组、组间用分隔符、同一命令放稳定位置 · 影响「放哪组」：建节点的两颗一组，交给 AI 的放「AI 编辑」那组，沿用已有分隔线。
  - Notion「Edit with AI」（https://www.notion.com/help/guides/notion-ai-for-docs）· 选中文字后 AI 处理是独立于格式化的一类入口 · 影响：挨着「AI 编辑」比挨着「生成节点」好认；但两颗去处不同（原地改写 vs 进对话），不合成一颗。
  - 出口：用户点错了怎么退——「拆成镜头」发出的消息照 Agent 面板现有的停止 / 撤回走，本次不变。
- ★1 用户怎么用：当我在创作文档里拖选一句、点浮条上的某颗图标，我想要那颗图标说的那件事（图片节点 / 视频节点 / 交给 Agent 拆镜头），以便不用再读一遍才知道自己触发了什么。步骤：点正文 → 拖选一句 → 浮条出现 → 看图标认出「拆成镜头」在「AI 编辑」旁边、「生成」组只有图片和视频 → 点 → 对话里看到「分镜规划」。不做：不改「AI 编辑」、不改钮的尺寸 / 间距 / 悬停样式 / 名字；不合并「AI 编辑」和「拆成镜头」。已知坑：「AI 编辑」原地改写、不进对话，不能把挪位理由写成「两颗都交给 Nomi」。真实任务：①中文分镜文案里选一句拆镜头；②英文界面同一路径；③选一句生成视频节点（用户原来那一下）。主指标：点了「视频」不再发文字（走查计数：文本请求 0）；量具 `tests/ux/creation-selection-actions.walk.mjs`（中 / 英）+ `src/workbench/creation/selectionActions.test.ts`。
  - ★1b 连带界面：对话气泡上的技能小签、回复头上的「已载入技能：」都改成印技能库名字「分镜规划 / Storyboard planning」（同一份查找）；输入框里的技能小签和技能封面也走同一份查找。
  - ★1c 老用户：不碰存量数据。升级后浮条位置变了：老用户找「拆成镜头」从第三颗挪到「AI 编辑」右边，图标从胶片变分镜，悬停名字不变；旧消息里存的 key 不动，下次渲染就显示名字。
- ★2 谁说了算：「选区 → 哪颗钮长什么样、排哪组、点了去哪」只在 `src/workbench/creation/selectionActions.ts` 的 `SELECTION_ACTIONS`（含 `cluster`）和 `runSelectionAction`（唯一分派）；浮条只按 `selectionActionsIn(cluster)` 画。「技能 key 指哪个技能」只在 `electron/shared/skillKey.ts` 的 `findSkillRecord`（主进程注入与界面显示共用，渲染层经 `skillForKey`）。删掉：`createNodeFromSelection.ts`、浮条内联 `onStoryboard`、没人读的 `creationSelectionText`、渲染层三处 `skills.find(name === key)`、主进程本地的查找实现。证据：`node scripts/door-map.mjs runSelectionAction`（1 扇）、`node scripts/door-map.mjs findSkillRecord`（3 个调用方，1 份实现）。
- ★3 一致与复用：以前定过——08-26 F3 把「拆成镜头」放进浮条，和 AI 面板入口共用同一个分镜启动器（`docs/plan/2026-08-25-ux-f3-f16b.md`，仍算数）；10-19 拍板板把三颗标为「原有，不动」（被 11-12 样张 B 接替，旧板 `popover.storyboard` 加了注）。三条路：沿原代码只修分派（解决不了图标和后果对不上）／换图标并挪位（用户选 B）／删掉选区入口（推翻 08-26，不选）。复用：节点仍经 `generationCanvasStore.addNode`；分镜仍经常驻 Agent 发布的 `storyboardPlannerLauncher`，消息由 `storyboardLaunchMessage` 一处拼（带技能 key）；技能名复用主进程现成的归一查找。
- ★4 全状态：没选中 / 只选了空白 → 浮条不出（不变）；选中 → 格式钮 | AI 编辑 + 拆成镜头 | 图片 + 视频；没有「AI 编辑」时它和它的分隔线不出现，「拆成镜头」单独夹在两条分隔线之间（样张 B）；点图片 / 视频 → 建节点并切画布（不变）；点拆成镜头 → 发给 Agent，加载 / 失败 / 取消照 Agent 面板现有状态（不变）。能力不可用：没有分镜启动器（不在创作面）时「拆成镜头」灰、悬停名字照常，下一步是回到创作面（不变）。文案不新增，沿用 `creationAi.selection.*`。
- 5 中途表：点击是一次性动作，没有中途态。点「拆成镜头」后停 / 关窗 / 断网 / 重启 / 连点，都照 Agent 面板现有的一轮对话处理（本次不变，不扣钱：只发文本请求）；图片 / 视频只建草稿节点不发请求，连点建多个节点（不变）。
- 6 外部数据与失败：不新增外部来源。技能库列表由主进程给；key 查不到时名字原样显示 key（不变，`skillDisplay.test.ts` 钉住）。
- ★7 性能：不新增交互，只改既有钮的排列与图标；查找从精确比换成「精确 → 前缀 → 归一」，技能数为几十个，每次渲染线性一遍，不适用性能场景：理由同上。
- 8 真实条件：英文界面跑（走查中 / 英各一遍）；暗色看设计实验室格；Windows、最小窗口、真付费 `unverified`（不碰窗口尺寸逻辑、不花钱）。
- 拍板图清单：`docs/design/boards/2026-11-12-selection-storyboard/SelectionStoryboard.board.json`（9 个元素全部 implemented，断言在 `tests/ux/design-lab-creation-ai-rewrite.walk.mjs` 和 `tests/ux/creation-selection-actions.walk.mjs`）。
- ★9 验收与回滚：验收清单与反例（实现线逐条「改坏 → 红、还原 → 绿」，验收线只核这份）：
  1. 视频钮改成发对话（把 video 的去处改成 `agent-storyboard`）→ 单测「视频钮建视频节点、不发对话」红；
  2. 图片钮建成视频节点（`nodeKind` 换掉）→ 单测红；
  3. 拆成镜头改成建画布节点 → 单测红；
  4. 浮条里另起一颗不经动作表、自己调 `addNode` / 启动器的钮 → 结构测试红；
  5. 空选区也分派（去掉 trim 判空）→ 单测红；
  6. 没选中文字时浮条出现 → 走查「没选中不出浮条」红；
  7. 拆成镜头改回发纯文字、不挂技能（`storyboardLaunchMessage` 去掉 `skillKey`）→ `storyboardLauncher.test.ts` 红；
  8. 技能 key 归一改回精确匹配（`findSkillRecord` 只比 name）→ `skillDisplay.test.ts` 点号 / 短横线两条红，`laneViewModel.test.ts` 气泡小签与「已载入技能」两处红；
  9. 「拆成镜头」放回「生成」组（`cluster` 改回 `generate`）→ `selectionActions.test.ts`「样张 B」红，设计实验室走查从左到右对账红；
  10. 图标换回 `IconMovie` → `selectionActions.test.ts` 与实验室走查红；
  11. 外壳里再拼第二份（发送时自己补 `openStoryboardResult` 或写分镜技能 key）→ `storyboardLauncher.test.ts`「只在启动器一处拼」红。
  这一类还会从哪回来：别的入口用非 name 形式的 key 指技能（被共享查找兜住）；浮条再加钮（只能进表）；别的浮条 / 菜单把「交给 Agent」和「建节点」混排（不在本卡范围，记为残余风险）。
  回滚：revert 本 PR 的三个实现提交（选区动作表与挪位、技能 key 归一、板与走查）。独立验收：四类（新界面）强制，由协调另派验收线，报告链接写进 PR `## 独立验收`。
