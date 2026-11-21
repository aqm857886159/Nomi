# 编辑器入口只认 owner 的 getSnapshot（设计卡）

纯修复，换结构：分镜一镜写字后，创作 → 生成画布 → 回创作，提示词框只剩占位字（盘上字还在）。#1573 第一版（重建后灌回真值的钩子 + 扫描守卫查「都调了」）两轮独立验收没过，用户 2026-11-21 定换方向（D-1121-1573-structural）：编辑器唯一入口只收真值读写口，不收初始内容。方向检查、三条路、归类表见 `docs/engineering/direction-checks/2026-11-20-prompt-editor-remount.md`。

## 真实场景复现

- 用户那次：分镜页写好提示词 → 切到生成画布 → 切回来，框里只剩占位字，盘上的字还在（#1573 来由，任务书 `L-editor-owner-door.md`「来由」节）。
- 我怎么走：真窗口、旧版项目夹具 `v0.24.1-storyboard`，把第 2 镜提示词清空（打开时框是占位字）→ 进分镜 → 空框里敲一句 → 去生成画布 → 回创作再进分镜，读 `[data-storyboard-row="2"] [data-prompt-box="true"] [contenteditable="true"]` 的字，并核落盘 `project.json`（`tests/ux/storyboard-prompt-reentry.walk.mjs --leg storyboard-empty`）。
- 和用户那次差在哪：用户写完点了「生成」（花钱）才切走，走查不点生成；用户项目里那一镜出生时是空的，这是从「只剩占位字」推出来的，走查用清空的夹具镜头还原；夹具是旧版真实落盘，不是用户本人的项目。
- 修前（主分支 `13db794b1` 的生产代码）：第 2 镜框里是占位字「这镜画什么：运镜 + 动…」，走查退出 1（`unexpected value ""`），截图 `/Users/aoqimin/Nomi-coord/tmp/L-editor-owner-door/shots-base/storyboard-empty-after-return-zh-CN.png`。
- 修后：同一走查中、英两轨退出 0，框里是「雨夜街口，她回头」/「Rainy corner, she turns back」，另一镜没被串，落盘里有这句。

## 先查别人

- `node_modules/@tiptap/react/src/useEditor.ts:214-237`（3.23.5）· 选项放 ref；`deps` 变了或实例被销毁就用当时最新的选项和回调重新造实例，`deps` 为空时选项变了只 `setOptions` · **确认了**：内容只能在实例出生那一刻给对，入口不能每次渲染传 `content`；出生时读什么值，决定了重建后框里是什么。
- `node_modules/@tiptap/core/src/Editor.ts:123-145, 266-275` · 构造顺序是 `setOptions` → 建 schema → 发 `beforeCreate` → `createDoc(options.content)`；没有 view 时 `setOptions` 只合并选项 · **改了**：出生填入改成入口自己的 `onBeforeCreate` 里 `setOptions({ content: toDoc(owner.getSnapshot()) })`，文档在实例出生时就等于真值，不走事务、不进撤销历史、不发 update；删掉 #1573 第一版「建好后再灌一次」。
- <https://tiptap.dev/docs/editor/api/events> · 官方事件 `beforeCreate`：「Before the editor view is created」 · **确认了**：出生填入挂在官方公开事件上，不是私有钩子，升级 TipTap 时有文档可核。
- `node_modules/@tiptap/core/src/commands/setContent.ts:50-69` + <https://tiptap.dev/docs/editor/api/commands/content/set-content> · `setContent` 是整篇替换，`emitUpdate: false` 只是不发 update；文档页没提撤销历史，源码也不设 `addToHistory` · **确认了**：框开着时 store 被外部改了（Agent 写提示词、撤销提示）仍用 `setContent(doc, { emitUpdate: false })`，算一步可撤销的外部写入（与 `promptHistoryCarry` 一致）；出生填入不用它。
- <https://raw.githubusercontent.com/steven-tey/novel/main/packages/headless/src/components/editor.tsx> · Novel 的 `EditorContentProps = Omit<EditorProviderProps, "content">`，只收 `initialContent` 转给 TipTap，没有任何受控同步 · **确认了**：在类型上收掉 `content` 是现成做法；**改了**：我们不能照搬「只给初始值」——值归 store，框开着时 store 会被别处改，要跟。
- <https://raw.githubusercontent.com/TypeCellOS/BlockNote/main/packages/react/src/hooks/useCreateBlockNote.tsx> · `useMemo(() => BlockNoteEditor.create(options), deps)`，选项只在创建时读，没有受控同步 · **确认了**：主流做法都是「创建时读一次」；差别只在创建时读的是什么——我们读 owner 此刻的值，不读渲染时传进来的副本。
- <https://remirror.io/docs/controlled-editor/> · 受控模式要父组件持有整份 EditorState（`state` + `onChange`），文档警告 React 异步更新与 ProseMirror 同步派发之间有延迟、连续命令后一条覆盖前一条，建议先用不受控 · **改了**：不接 Remirror 式受控（我们的 store 存提示词串 / 文稿 JSON，不是 EditorState），没有能直接接的现成受控绑定；入口保留一层薄胶，不新增自写登记（以 `check:self-written` 为准）。
- <https://react.dev/reference/react/useSyncExternalStore> · `subscribe` / `getSnapshot` / `getServerSnapshot` 三件；store 没变时 `getSnapshot` 必须返回同一个值，可变 store 要缓存上一次的快照；不给 `getServerSnapshot` 时服务端渲染会抛错 · **改了**：owner 用的就是这个形状；文稿宿主的 `getSnapshot` 按原始引用缓存规范化后的文档，三个用 `useSyncExternalStore` 的地方都传第三个参数（静态渲染测试要用）。
- 出口：不涉及：纯修复，不新增、不扩大、不挪动任何挡人的保护。

## ★1 用户怎么用

当创作者在分镜页 / 创作文稿 / 画布文字节点里写了字，切去别的工作区再回来，我想框里还是我刚写的字，以便接着写、接着生成，不用重敲也不用怀疑字丢了。

步骤：①打开项目 → 进分镜（或文稿、画布）；②在框里写字（空框或已有字都算）；③切到另一个工作区（生成画布 / 创作）；④切回来；⑤回项目库再开同一个项目；⑥看框里的字，和盘上一致。

不做什么：不改任何看得见的元素、文案、布局、`data-*`；不改存储格式、不升项目版本；不碰 `@` 提及的行为。已知坑：只有分镜槽开了「藏起时冻结」（`WorkbenchShell.tsx` 的 `freezeWhenHidden`），文稿和文字节点在主分支上本来就绿，那两条走查守的是这次重构不弄坏它们；旧走查在主分支上红的是「Old shot 1」（敲的字丢了），不是用户那次的占位字，所以加了空框那一腿。

真实任务（真窗口、旧版真实落盘夹具，不花钱）：
1. 分镜空框写一句 → 去生成画布 → 回来（用户那次的原样，`--leg storyboard-empty`）。
2. 分镜已有字的框敲一个字 → 切走再回来；回项目库再开（`--leg storyboard`）。
3. 文稿敲一句 / 画布文字节点敲一句 → 切走再回来 → 回项目库再开（`--leg creation`、`--leg canvas-text`）。

指标（目标 → 信号 → 指标）：
- 主指标：回来后框里的字 = 盘上的字。量具：`tests/ux/storyboard-prompt-reentry.walk.mjs` 四条腿通过的比例，中英各一遍。基线（主分支）：分镜两条腿红，文稿 / 文字节点绿；目标：中英两轨四条腿全过。
- 质量指标：出生填入不回写、不进撤销历史。量具：`src/workbench/common/useNomiTiptapEditor.browser.test.ts`（真 React + 真 TipTap + Activity，`write` 次数与 `can().undo()`），走查 ④「只看不敲，项目文件逐字节不变」。
- 护栏指标：入口收不进初始内容。量具：`src/workbench/common/useNomiTiptapEditor.types.test.ts`（`check:test-types`）。

### ★1b 连带界面

同一个入口还在这些地方露出字，都只多一条「回来后字在」，不新增任何文字或状态：
- Agent 输入框草稿（`ProjectAgentResidentShell` → `AgentPanelV4Composer`，owner = `workbenchStore.projectAgentDraft`）：真窗口没走，`unverified`；入口单测覆盖 `PromptEditor` 本体。
- 画布生成节点的提示词框（`NodeGenerationComposer`，owner = `generationCanvasStore` 里这个节点的 prompt）：真窗口没走，`unverified`；提示词库追加、撤销提示两处创作者动作写入照旧。
- 创作文稿（`WorkbenchEditor`）、画布文字节点（`TextDocumentNode`）：真窗口中英两轨走过。
- 设计实验室（分镜、复用、助手输入框、选区浮条几屏）：交写死的 owner，`check:design-lab` 相对主分支没变。
- Agent 回执、通知、错误卡、撤销提示：不涉及（没有新操作）。

### ★1c 老用户

- 项目：不改存储格式、不升项目版本、不迁移。升级后什么都不做，旧项目照常打开；走查用 `tests/fixtures/old-user-data/projects/v0.24.1-storyboard`（v0.24.1 真实落盘）打开，两镜提示词「Old shot 1 / Old shot 2」照样显示，只看不敲项目文件逐字节不变（走查 ①–④）。
- 用惯的入口：分镜、文稿、画布、Agent 输入框的位置和操作都不变。
- 退回上一版：没写新字段，上一版照样打开。

## ★2 谁说了算

**入口只认 owner 的 getSnapshot。** 编辑器的字归宿主的 store，编辑器只是它的视图：入口参数是 owner（`subscribe` / `getSnapshot` / `write`）+ 编解码，每个实例出生时入口自己调 `owner.getSnapshot()` 造文档，之后经 `useSyncExternalStore` 跟 store；入口类型上没有 `content` / `value` / `onUpdate` / `onBeforeCreate` / `onCreate`。

| 宿主 | owner 读的 store | 写回 |
|---|---|---|
| 分镜一镜的提示词框（`PromptSkeletonSegments`） | `workbenchStore` 里当前方案（`selectActiveStoryboardDesign`）这一镜的 `prompt` | 原 `onChange`（提示词 + 清空分段） |
| 画布生成节点提示词框（`NodeGenerationComposer`） | `generationCanvasStore` 里这个节点的 prompt | `updateNode` |
| Agent 输入框草稿（`ProjectAgentResidentShell`） | `workbenchStore.projectAgentDraft` | 提及控件的 `onChange` |
| 创作文稿（`WorkbenchEditor`） | `workbenchStore` 当前文稿（`activeDocumentOf`，渲染和 owner 共用） | `handleChange` |
| 画布文字节点（`TextDocumentNode`） | `generationCanvasStore` 里这个节点的 `contentJson` | `handleChange` |
| 设计实验室 | 写死的一份（`src/devlab/designLab/fixedEditorOwner.ts`）；选区浮条舞台用 zustand `createStore` | 不写回 |

全部家（`node scripts/door-map.mjs`，`/Users/aoqimin/Nomi-coord/tmp/L-editor-owner-door/door-map.txt`）：TipTap `useEditor` 1 扇（入口里）；`useNomiTiptapEditor` 2 扇（`PromptEditor`、`useNomiRichTextEditor`）；`useNomiRichTextEditor` 3 扇（文稿、文字节点、选区浮条舞台）；`PromptEditor` 3 处（Agent 输入框、分镜提示词、节点提示词）。「选当前方案」原来分镜页两处各写一份，收成 `activeStoryboardDesign.ts` 一份。

「1」靠什么保持：
- 别处拿不到原料：入口类型收不进初始内容（类型测试，`@ts-expect-error` 多余即红）；TipTap `useEditor` 只有入口能用（eslint `no-restricted-imports`，2026-09-28 起）；写死一份值的 owner 只住设计实验室，产品代码引它被 `check:boundaries` 的 `src-no-import-devlab` 拦。
- 各出口对拍：离开再回来，各屏读回的字和盘上一致（走查）。
- 不靠「东西不见了」猜意图：外部写入走 store 订阅，不靠实例消失 / 出现去推断。

## ★3 一致与复用

以前定过什么：
- 2026-09-21 同步账 `controlledEditorSync`（只有真正来自外部的值才写进框）：仍算数，挪进入口内部，两个内核共用一份。
- 2026-09-28 `useNomiTiptapEditor` 是 TipTap 的唯一入口：仍算数。
- #1573 第一版（`useEditorRebuildSync` 钩子 + 扫描守卫 + `editor-rebuild-sync` 自写登记）：被 D-1121-1573-structural 取代，已删。

三条路：沿原方向修（再补一个钩子 / 扫描）——新写一个编辑器忘了调照样编得过，否；删掉——要保住创作者写的字，不适用；**换一种做法**（入口只认 owner）——选这条，拿着旧副本的编辑器在类型上写不出来。

复用：TipTap 官方 `onBeforeCreate` + `setOptions`、React `useSyncExternalStore`、zustand 的 `subscribe` / `getState`，不自写订阅机制。两个内核原来不一样的三处，统一成：比较相等就不写（少一条等价撤销记录）、`docChanged` 才回写（少一次没改字的回写）；聚焦时外部写入保不保留光标做成显式选项 `keepSelectionOnExternalWrite`（文稿开、提示词框不开，两处保持原来的行为）。

残余：宿主故意写一个返回旧值的 `getSnapshot`。现成的「拿一份值当 owner」只在设计实验室，产品代码引不进来（`src-no-import-devlab`）。

## ★4 全状态

- 空：空提示词框照旧是占位字；空框敲字后切走再回，是敲的字（修前是占位字）。
- 加载 / 失败 / 部分成功 / 取消中 / 过期 / 能力不可用：不涉及（没有新操作，不调模型）。
- 成功：回来后框里的字 = 盘上的字。
- 最长文字：框的滚动、高度不变，出生填入一次完成。
- 文案：zh / en 都没动。

## ★7 性能

不新增用户操作，没有新交互可测，`perf-scenario：不适用：不新增交互`。代价说明：分镜每个挂着的行多一个 store 订阅，store 每变一次每行在当前方案里按镜头 id 找一次自己的提示词（镜头数线性）；表格开了窗口化，只挂看得见的行。没有单独跑性能场景（`storyboard-plan-open`、`canvas-text-node-typing` 未跑）。

## ★9 验收与回滚

验收清单（实现线已按它自验，验收线只核它）：
1. 分镜空框敲一句 → 去生成画布 → 回创作再进分镜：框里是这句，另一镜不串，落盘有（中英）。
2. 分镜已有字的框：打开即是盘上的字；切走再回、回项目库再开都是；只看不敲项目文件逐字节不变；敲一个字切走再回是新字（中英）。
3. 文稿、画布文字节点：敲一句 → 切走再回 → 回项目库再开，字在、落盘有（中英）。
4. 入口单测：首挂、deps 重建、Activity 藏起期间 store 变了（含编辑器在 memo 后面）、敲过字再藏放、文稿非规范写法、分镜提示词框——文档都等于 store 当前值，出生 / 重建 / 外部写入后 `write` 0 次，`can().undo()` 为假。
5. 入口类型：再收 `content` / `value` / `onUpdate` / `onBeforeCreate` / `onCreate`、不给 owner 都编不过。
6. 产品代码引设计实验室：`check:boundaries` 红。

反例（改坏 → 红，还原 → 绿；改坏脚本 `/Users/aoqimin/Nomi-coord/tmp/L-editor-owner-door/scripts/mutate.py`，日志同目录）：

| 反例 | 结果 | 证据 |
|---|---|---|
| ① 入口重新接受 `content` | `check:test-types` 退出 1，`TS2578 Unused '@ts-expect-error'`（`types.test.ts:22`） | `mut-m1.log` |
| ② 重建后不再填（只第一个实例出生时填） | 单测 2 条红；分镜走查 ① 红（框里是空） | `mut-m2-unit.log`、`walk-m2-storyboard.log` |
| ③ 再填改成建好后 `setContent`（发 update） | 单测「不回写」「不进撤销历史」红 | `mut-m3-unit.log` |
| ④ 再填改成建好后 `setContent`（不发 update） | 单测「不进撤销历史」红 | `mut-m4-unit.log` |
| ⑤ 什么都不做（换回主分支生产代码） | 空框腿退出 1，框里是占位字；已有字腿 ⑤ 退出 1（「Old shot 1」，敲的字丢了）；文稿 / 文字节点腿绿（主分支本来就对）；入口单测 `goal-red-on-base`：断言红 5、绿 1（主分支入口不认 owner 时抛错，算断言红，不算症状复现） | `walk-base-empty-zh.log`、`walk-base-storyboard.log`、`walk-base-creation-canvas.log`、`goal-red-on-base.log` |
| ⑥ 全部拦下（入口永远填空） | 单测 3 条红；走查三条腿都红（框里是空） | `mut-m6-unit.log`、`walk-m6-*.log` |
| ⑦ 产品文件引 `fixedEditorOwner` | `check:boundaries` 退出 1：`[src-no-import-devlab] src/workbench/assets/PromptEditor.tsx -> src/devlab/designLab/fixedEditorOwner.ts` | `boundaries-red-probe.log`；单测 `scripts/check-boundaries.devlab.test.mjs` |

还原后：单测、类型测试、`check:boundaries` 全绿；走查中英两轨四条腿退出 0（`walk-head-zh-final.log`、`walk-head-en-final.log`）。

同类入口：Agent 输入框草稿、画布生成节点提示词框真窗口没走，记 `unverified`。

回滚：revert 本 PR 的提交即可，无数据迁移。

独立验收：待派（协调派）。
