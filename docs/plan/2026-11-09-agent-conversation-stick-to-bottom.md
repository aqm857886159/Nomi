# 设计卡：Agent 对话「跟到底」换成现成的 use-stick-to-bottom

```
改动名：Agent 对话跟到底换现成库 + 回到最新按钮    线/负责人：实现线（Claude）    类别：[新界面][其他]
```

方向检查：`docs/engineering/direction-checks/2026-11-09-agent-conversation-stick-to-bottom.md`（P1 例外，协调代批）。

## 用户原话

- 「每次切换agent都放到最上面了，我还得波动鼠标弄到最下面，太麻烦了」（2026-11-08 反馈）
- 「agent发送的时候感觉会卡一下，然后页面才变化。并且他不会自动滑动，而是卡在我的位置上，导致我还得自己滑右侧的滚轮才能看到下面。」（2026-11-08 反馈）
- 「我们遇到了这两个问题，背后是不是我们没有用一个通用的组件…找一个牛逼的方案，然后直接把这个方案挪过来」（2026-11-09）

## 协调已定（事后报用户）

1. 切换对话总落到底；收起 / 展开仍按 09-01 §11.2 还原到原位。
2. 人正往上翻着时发送：回到底。
3. 加「回到最新」按钮（单元素档：生产组件搭、清单、zh/en × 亮暗截图交协调，用户看过才合）。
4. 这一轮不做虚拟化，先跑 500 条的量具。
5. 不装 Mermaid。

### 功能分类
- [x] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [x] Agent 行为
- [x] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [x] 新增功能 / 性能

（「Agent 行为」由路径推出：只改对话流的滚动位置和一颗按钮，不碰模型请求、工具、提示词、回合状态。）

## ★0 先查别人

| 出处 | 它怎么做 | 对哪个决定的影响 |
|---|---|---|
| [use-stick-to-bottom](https://github.com/samdenty/use-stick-to-bottom)（1.1.6，MIT，零依赖，源码 `src/useStickToBottom.ts`） | 内容外包一层，`ResizeObserver` 盯内容高度：贴着底时内容长高就滚到底；人往上滚（滚轮向上、拖滚动条往上、选中文字）立刻松开；离底 70px 内自己重新贴上；`scrollToBottom()` 显式回底；`isAtBottom` 给「回到最新」按钮用 | **改了**：不再修自写的「按条目数跟随」，换成按内容高度跟；**确认了**：发送时显式调 `scrollToBottom()`，不靠状态去猜 |
| [AI SDK Elements · Conversation](https://elements.ai-sdk.dev/components/conversation) | 聊天流组件直接包 `StickToBottom`，自带「不在底部时出现」的回到底部按钮 | **确认了**：「回到最新」只在不在底部时出现，点了回到底并继续跟；我们只要库的 hook，按钮用自己的 `IconButton` |
| 方向报告（协调交接区）里核对过的开源聊天实现：按话题持久化滚动位置的那一家（`useTopicScrollPersist`，538 行） | 每个话题记锚点 id + 偏移，回来时等列表高度静止 150ms、最多 1000ms 再跳 | **改了**：切换对话不还原到半路，一律落到底（用户原话要的是「到最下面」，还原半路要 500 多行且异步到达会抖）；按线程 16 条的滚动记忆整个删掉（收起不卸载面板，位置由面板自己在收起那一刻记下） |
| `docs/plan/2026-09-27-agent-panel-long-conversation-freeze.md`（09-27 长对话卡死的治理） | 用 memo 和缓存让流式更新只重画变了的行 | **确认了**：这一轮不做虚拟化，先用 500 条量具看帧时，不达标先试 `content-visibility` |
| [MDN · ResizeObserver](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver) | 元素尺寸变化时回调，按帧合并 | **确认了**：库的观察点是内容层，需要在滚动容器里多包一层内容 `div`（不改卡片本身） |

出口：[use-stick-to-bottom 源码 `useStickToBottom.ts`](https://github.com/samdenty/use-stick-to-bottom/blob/main/src/useStickToBottom.ts) · 自动跟随是一把「锁」，人一往上滚、一选字就立刻松开，离底 70px 内或点按钮才重新锁上 · 确认了我们的出口：往上翻永远不被拽；「回到最新」按钮是重新跟上的一步可走的路；发送也算「我要看最新」。

## ★1 用户怎么用

当我在 Agent 面板里和它来回聊、切到另一条对话、或者发出一句话时，我想**直接看到最新那一句**，以便不用再拖右边的滚动条去找。

1. 打开项目，展开 Agent 面板：落在对话最底部。
2. 发一句话：自己那句马上出现在可见区，回答一边吐字一边往下跟。
3. 回答吐到一半，往上翻看前面：不被拽回去；面板底部出现「回到最新」。
4. 点「回到最新」：回到底，接着跟。
5. 往上翻着又发一句：回到底，看得见自己刚发的。
6. 打开会话列表切到另一条对话：落在那条的最底部（不是最上面）。
7. 收起面板再展开：回到收起前的位置（翻在半路就回半路，在底部就在底部）。
8. 往上翻到最顶：照旧加载更早的消息，读的那一行不跳。

不做什么：不还原「每条对话上次读到哪」（切换一律到底）；不做虚拟化；不做发送即回显（第 1 步量出 p50 > 100ms 才做）；不改起草卡、批准卡、指向元素这些我们自己的卡。

已知坑：收起是把面板 DOM 挪进一个隐藏容器（不卸载；`ShellAgentHost` 的 reverse portal），隐藏时内容高度变 0，库会以为「变矮了、重新贴底」，浏览器也把滚动位置清零——展开时要按收起前那一刻的位置还原（main 上那份按线程的记忆只在切线程时才触发，收起展开根本没用上它）；「加载更早」把旧消息插在上面，人此刻没贴底，锚点照旧写滚动位置，贴着底时不写（库自己管）。

真实任务（假模型、隔离资料，免费）：
- A、B 两条各 5 轮长回答的对话，A→B→A 来回切，离开 B 时翻在半路。
- 停在底部发一句，假模型约 10 秒吐 3000 字；吐到一半往上翻 600px，再点「回到最新」。
- 往上翻 1500px 时再发一句。

指标（目标 → 信号 → 指标 → 量具）：
- 主指标：切换对话后落在底部 → 切换后 0 / 250 / 1000ms 距底像素 → 三个时刻都 ≤24px 的比例 → 走查 `tests/ux/agent-conversation-follow.walk.mjs`（`switch-*` 三条 × zh/en）。基线：main 上红（用户原话）；目标 100%。
- 质量指标：流式时跟得住 → 每帧距底像素最大值 ≤70px、结束时 ≤24px → 同一走查 `streaming-*`；往上翻不被拽 → 再进 20 个分片后滚动位置变化 ≤1px → `scrolled-up-reader-is-not-dragged`；发送回到底 → `send-while-scrolled-up-returns-to-bottom`。
- 护栏指标：收起 / 展开还原 ±24px（`collapse-expand-*`）；发送到看见 p50 ≤100ms、p95 ≤150ms（性能场景 `chat-send-visible` / `-10` / `-1000`）；500 条滚动帧间隔 p95 ≤16.7ms（`chat-scroll-500`、`chat-scroll-500-cpu4x`）；流式时平移画布不比 main 差（`canvas-pan-while-agent-streaming`）。

### ★1b 连带界面

- 三个界面（创作 / 生成 / 预览）的常驻 Agent 面板共用同一个对话流组件，一处改三处生效；没有别的界面读对话流的滚动位置。
- 新文案只有一句：「回到最新」/「Jump to latest」（按钮的可见名和悬停提示，`agentPanelV4.jumpToLatest`）。Agent 回执、通知、任务列表、错误卡都不变。

### ★1c 老用户

- 不碰存量数据：滚动位置从不落盘（原来那份按线程 16 条的记忆只在内存里），升级后什么都不用做。
- 唯一的行为变化：切回一条对话时以前会回到上次读到的位置（实际多数时候是最上面），现在一律落到底。这正是用户要的（原话见上）。
- 退回上一版：没有任何数据格式变化，旧版照常打开。

## ★2 谁说了算

- 「对话流此刻贴不贴底、滚动到哪」→ 唯一 owner：`use-stick-to-bottom` 的 hook（在 `AgentPanelV4Panel` 里调用一次）。只有它写滚动位置，例外两处，都在同一个组件里：「加载更早」的锚点（人没贴底时才写）、收起 / 展开还原（展开那一刻写一次）。
- 收起 / 展开那一份位置：面板自己记。收起成小球、换停靠 / 浮窗都只是把同一棵面板的 DOM 挪地方（不卸载），所以位置不用活在面板外面；面板给滚动容器挂一个 `ResizeObserver`，高度变 0 那一刻冻住「最后一次滚到哪、在不在跟着底」，回来时照它还原。`agentPanelV4ScrollMemory.ts`（按线程 16 条）整个删掉。同一个观察点也管「对话流这块变矮」（输入框长高、介入槽冒出来）：跟着底的人照样看得见最后一行。
- 同一份事实存几份：1（库的状态）。原来的 `atBottomRef` 和按条目数跟随的 effect 删掉。
- 意图走显式事件：发送 = composer 的 `onSubmit` 包一层调 `scrollToBottom()`；切换对话 = 宿主给的 `conversationKey`（项目 + 面 + 线程）变化时调 `scrollToBottom('instant')`；不靠「条目数变了」猜。
- 门表：`node scripts/door-map.mjs AgentPanelV4Panel`、`node scripts/door-map.mjs flowScrollMemoryFor`（入口：`ProjectAgentResidentShell` 一处，随模块一起删）。

## ★3 一致与复用

- 以前定过什么：09-01 §11.2「收起 / 展开回到原处」（还算数，保留）；09-27 长对话卡死治理（memo + 缓存，还算数，不动）；`residentTranscriptScroll.ts` 是更早一版常驻面板的贴底判断，现在没人调用（`self-written.json` 里登记成排除项），死代码。
- 三条路：沿原方向修（再补「高度变了也跟」「切线程清记忆」两刀，第三处补丁，自写跟随会继续长）／换做法（接 `use-stick-to-bottom`，聊天界面通用做法，按内容高度跟、人往上滚就松开）／删掉（不自动跟，人自己滚——用户原话就是不要这个）。选换做法：用户 11-09 原话要「找一个牛逼的方案直接挪过来」，方向报告核对过这个库就是通用做法，且能和我们的「加载更早」、收起还原相处。
- 复用：库的 hook；按钮用现有 `WorkbenchIconButton`（`src/design/actions.tsx`）+ 词典里已有的 `IconArrowDown` + token；不新增全局 CSS、不新增 tsx 文件。
- 第二份定义：删掉自写贴底判断（`atBottomRef`、跟随 effect、`residentTranscriptScroll.ts`）后没有第二份。
- 登记：新依赖进 `docs/engineering/framework-boundaries.json`（四列表和逐层对照见下一节；禁写规则：v4 面板与常驻目录里不许再出现「把 scrollTop 设成 scrollHeight」这种自写贴底）；`self-written.json` 的排除项从指向死文件的 `residentTranscriptScroll*` 改成 `resident/*Scroll*`（死文件删了，但「常驻目录里新写的滚动跟随是通用代码、要登记」这道拦还要在：`check-self-written` 的用例 `residentTranscriptScrollV2.ts` 照旧报）。

### 四列表（use-stick-to-bottom 1.1.6，2026-11-09 读的发布包 `dist/useStickToBottom.js`）

| 它提供 | 我们用了 | 我们另写了 | 我们拆散了 |
|---|---|---|---|
| `useStickToBottom()`：`scrollRef` / `contentRef` 两个回调 ref，`ResizeObserver` 盯内容层高度，贴着底时长高就滚到底 | 对话流滚动层 + 内层行容器（`AgentPanelV4Panel.tsx`），`initial` / `resize` 都是 `instant` | 无 | 无 |
| 往上滚 / 滚轮向上 / 按着鼠标选字 → 松开跟随；离底 70px 内重新贴上 | 原样用 | 无 | 无 |
| `scrollToBottom()` / `stopScroll()` / `isAtBottom` | 发送、切换对话、点「回到最新」调 `scrollToBottom('instant')`；按钮读 `isAtBottom` | 收起 / 换挂点还原（库没有「DOM 被挪走又挪回来」这件事）：滚动层的 `ResizeObserver` 里冻住位置、回来时 `stopScroll()` + 写回原位，或 `scrollToBottom()` | 无 |
| `<StickToBottom>` 组件（包好的两层 div + context） | 没用 | 无 | 只用 hook：滚动层和行容器是我们自己的 div，卡片和面板结构不动 |
| 弹簧动画 | 没用（`instant`） | 无 | 流式 12 字一帧时弹簧会和吐字抢帧 |
| 「加载更早」 | 库不管 | 锚点钉位（原有，`asyncReadIdentity.test.ts` 守）；跟着底时不钉，交给库 | 无 |

### 参考实现逐层对照

参考实现：[AI SDK Elements · Conversation](https://elements.ai-sdk.dev/components/conversation)（包 `StickToBottom` 的聊天流组件）。只对照和这件事有关的两层。

| 层 | 它怎么做 | 我们怎么做 | 判定 | 若没想到补在哪个阶段前 |
|---|---|---|---|---|
| 转录渲染 | `<Conversation>` = `StickToBottom`，内容放 `StickToBottom.Content`，`initial="smooth" resize="smooth"`；`ConversationScrollButton` 在不贴底时出现，点了 `scrollToBottom()` | 同一个库的 hook；`instant`；「回到最新」同样只在不贴底时出现 | 一致（动画有意不同：流式吐字快，弹簧会抢帧） | 不适用：已想到 |
| 观测与测试 | 上游无端到端用例 | 走查 `agent-conversation-follow.walk.mjs`（切换、收起展开、流式、往上翻、按钮、发送）+ 5 个性能场景 + 分页钉位单测 | 一致，增加领域回归 | 不适用：已想到 |

## ★4 全状态

| 状态 | 用户看到什么 |
|---|---|
| 空（新对话没有消息） | 和现在一样的空态；不出「回到最新」 |
| 加载（打开项目 / 切换对话，历史还在读） | 读完落在底部；读的过程中不出按钮 |
| 成功（贴着底） | 新内容一边长一边跟；不出按钮 |
| 往上翻着 | 位置不动；面板底部、输入框上方出现「回到最新」（向下箭头图标按钮，可见名 / 悬停提示「回到最新」/「Jump to latest」） |
| 流式中往上翻 | 同上，不被拽；点按钮回到底并接着跟 |
| 失败（这一轮报错） | 错误行照旧出现在底部；贴着底就跟到错误行 |
| 部分成功 | 不适用：滚动没有部分成功 |
| 取消中（按了停止） | 回合按现在的样子收尾；滚动不变 |
| 过期 | 不适用：滚动位置不落盘 |
| 能力不可用 | 不适用：滚动和按钮不需要模型或外部资源 |
| 加载更早 | 翻到顶照旧拉一页旧消息，读的那一行不跳 |
| 收起 / 展开 | 回到收起前的位置 |

文案只有 `agentPanelV4.jumpToLatest`（zh / en），不谈钱。

## 5 中途表

| 状态 \ 打断 | 停（按停止） | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 贴着底、流式中 | 回合收尾，停在底部 · 花费照现有回合规则 · 回执照旧在流里 | 下次打开落在底部 · 同左 · 同左 | 错误行在底部，跟到它 · 同左 · 同左 | 落在底部 · 同左 · 同左 | 连点「回到最新」：按钮点一次就消失，后几下点不到 · 不涉及花费 |
| 往上翻着、流式中 | 停在原位，按钮还在 · 同上 | 下次打开落在底部 | 停在原位，按钮还在 | 落在底部 | 连发几句：每次都回到底 |
| 收起着 | 展开回到原位 | 下次打开落在底部 | 展开回到原位 | 落在底部 | 连点收起 / 展开：每次回到同一位置 |

滚动不碰花费，「花费」一列都按现有回合规则，本改动不改。

## 6 外部数据与失败

- 外部来源只有一个：npm 包 `use-stick-to-bottom@1.1.6`（[仓库](https://github.com/samdenty/use-stick-to-bottom)，MIT，零依赖，peer `react ^16.8 || ^17 || ^18 || ^19`，最后发布 2026-06-04）。锁版本进 `pnpm-lock.yaml`。
- 偏差：我们不用它的 `<StickToBottom>` 组件，只用 hook（滚动容器是我们自己的 `div`，卡片不动）；动画用 `instant`（流式时不做弹簧动画，避免和 12 字一帧的吐字抢帧）。
- 失败时：库只读写这一个滚动容器；它出错最坏是不跟，人照样能自己滚，不丢数据、不影响回合。

## ★7 性能

1. 新增 / 改动的用户操作：按回车发送（到自己那句看得见）；流式时跟随；往上翻；点「回到最新」；长对话里滚动。
2. 最坏规模：当前对话 1000 条历史（发送）；500 条混合消息（Markdown 标题、列表、代码块）全部加载后滚动；CPU 降速 4 倍。
3. 预算：发送到看见 p50 ≤100ms、p95 ≤150ms；滚动帧间隔 p95 ≤16.7ms、>50ms 长任务 0 个；流式平移画布不比 main 差（`canvas-pan-while-agent-streaming` 预算 33ms）。
4. 场景（`tests/perf/scenarios/`，量具 `tests/perf/canvas-scale-bench.mjs` 的工作台场景，旧版对话走产品自己的迁移进当前对话）：`chat-send-visible`（100 条）、`chat-send-visible-10`、`chat-send-visible-1000`、`chat-scroll-500`、`chat-scroll-500-cpu4x`；新登记为待测，main 与修后数字见 PR 正文，基线由协调写。

## 8 真实条件

- 英文界面：走查 en-dark 一轮全跑。
- 最小窗口：走查固定 1100×720（面板只剩四百多像素高才会溢出）。
- 真规模：性能场景 1000 / 500 条。
- 暗色：en-dark 全跑，zh-dark / en-light 拍按钮。
- Windows：`unverified`（本机是 Mac）。
- 真模型：`unverified`（用户当时用真模型；这里是本机假模型按固定节奏吐字）。
- 键盘全程：`unverified`（按钮是原生 button，可 Tab 到、回车触发，未单独走查）。

## 拍板图清单

`docs/design/boards/2026-11-09-conversation-jump-to-latest/ConversationJumpToLatest.board.json`（单元素档：生产组件人工普查，跳过 Claude Design 探索；截图 zh/en × 亮暗交协调，用户看过才合）。

## ★9 验收与回滚

验收命令（另一条线）：`pnpm run build` 后 `node tests/ux/agent-conversation-follow.walk.mjs`（结束时打印 `checks: N green / 0 red`，`.tmp/pi-agent-conversation-follow-*/checks.json` 逐条；退出码 1 且只有 `[quiet-walk] 走查抢了前台`、全部检查绿算过）；`pnpm run perf:scenarios -- --id chat-send-visible --measure-only --out <文件>`（其余四个同法）；`pnpm run perf:scenarios -- --id canvas-pan-while-agent-streaming --measure-only --out <文件>`；`pnpm exec vitest run src/workbench/ai/v4`；`pnpm run check:board-parity`。

验收清单（实现线按它自验，附「反例 → 结果 → 证据」表）：

1. 切换对话 B→A、A→B、离开 B 时翻在半路再切回 A：切换后 0 / 250 / 1000ms 距底都 ≤24px（zh-light、en-dark 各一轮）。
2. 重载渲染层（面板重新挂载）：落在底部。
3. 翻在中间收起再展开：位置差 ≤24px；在底部收起再展开：仍在底部。
4. 流式跟随：停在底部，假模型约 10 秒吐 3000 字，每帧距底 ≤70px，结束 ≤24px。
5. 流式中往上翻 600px，再进 20 个分片：滚动位置变化 ≤1px；「回到最新」出现，可见名 / 悬停提示是词典里那句。
6. 点「回到最新」：≤24px，之后 600ms 仍 ≤70px（接着跟）；按钮消失。
7. 往上翻 1500px 发送：自己那句出现时、回答落地时都 ≤24px。
8. 「加载更早」：翻到顶加载一页旧消息，读的那一行不跳（现有单测 + 500 条场景里一页页加载）。
9. 发送到看见：`chat-send-visible*` 三档 p50 ≤100ms（超了记下，第 4 步才做回显）。
10. `canvas-pan-while-agent-streaming` 修后不比 main 差（中位数差 ≤20%）。
11. 删干净：`git grep -n "atBottomRef\|residentTranscriptScroll\|flowScrollMemoryFor" -- src` 为空；`self-written.json` 里不再指向死文件（改成 `resident/*Scroll*` 的拦）；`pnpm run check:framework-boundary` 绿。

反例（这一类会从哪些入口、形状、边界回来）：

| 反例 | 期望 |
|---|---|
| 三个面（创作 / 生成 / 预览）各自的面板 | 同一个组件，同一套行为；走查跑创作面，组件只有一个 |
| 内容变高但条目数不变（流式吐字、图片晚到、卡片展开） | 库按内容高度跟，不按条目数（流式那条就是这一类） |
| 切换到一条历史还没读完的对话（异步到达） | 读完时仍在底部（1000ms 时刻那一读） |
| 收起时面板不卸载、只是藏起来（内容高度变 0） | 展开回原位，不被「重新贴底」吞掉 |
| 往上翻时正好有新分片进来 | 不被拽（≤1px） |
| 翻在顶部触发加载更早 | 锚点照旧；贴着底时不写滚动位置 |
| 选中文字时 | 库松开跟随（库的行为，不额外写） |
| 旧数据 | 无：滚动位置不落盘 |

### 真实场景复现

- 用户的流程：用户在常驻 Agent 面板里用真模型来回聊，切换对话后落在最上面，要拖滚动条到底；发送后不自动滑动、卡在原来的位置（原话见上，2026-11-08 反馈）。
- 我走的：隔离资料、本机假模型，创作页面板，最小窗 1100×720；两条各 5 轮长回答的对话来回切；流式 3000 字；往上翻着发送。中英两轮。
- 差别：用户是真模型（吐字节奏、长度不固定），这里是假模型固定 12 字一帧、40ms 一帧；用户窗口大小不知道，这里是最小窗；用户可能在生成 / 预览面，这里走创作面（同一个组件）。
- 修前：main 上走查红的那几条（切换落点、往上翻着发送、回到最新按钮）——见 PR 正文和走查输出。
- 修后：同一条走查全绿，截图 zh/en × 亮暗。

回滚：revert 换库那个提交（依赖、组件、删掉的旧文件一起回来）；按钮提交可单独 revert。
