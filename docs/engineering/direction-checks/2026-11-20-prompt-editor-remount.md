# 方向检查：提示词编辑器实例重建后框是空的（2026-11-20，11-21 换方向）

**拍板**：
- 第一版（重建后灌回真值的钩子）：协调会话 2026-11-20 代批（用户 2026-10-22 授权的例外：只因目录口径命中、改法是换并删旧、不新增分支；事后报用户）。
- 现方向（入口只认 owner 的 getSnapshot）：**用户 2026-11-21 拍板**（D-1121-1573-structural：「改结构版再合」，编辑器唯一入口只收真值读写口，不收初始内容）。起因是第一版两轨独立验收没过、用户追问「为什么会出现、能不能不再出现」，复盘见 `coord-handoff/reports/R-storyboard-reentry-two-fails.md`。

`node scripts/fix-churn.mjs` 对 `src/workbench/assets/PromptEditor.tsx` 只因目录 `src/workbench/assets/`（14 天 8 个 fix，涉及 6 个别的文件，全是素材库删除 / 存活判定，和提示词编辑器无关）命中；`PromptEditor.tsx` 文件本身 14 天内没有 fix 提交；`controlledEditorSync.ts`、`useNomiRichTextEditor.ts` 同样只因目录 `src/workbench/common/` 命中。

**这一处的全图在哪**：表外（`docs/engineering/seams.json` 没有编辑器同步这一条）；入口与 owner 的全图见设计卡 `docs/plan/2026-11-21-prompt-editor-remount.md` ★2。

### 0. 一句话根因

编辑器入口收的是「渲染时传进来的值」：谁拿着一份副本都能建出一个编辑器，副本旧了（首次挂载那一刻冻住、或编辑器在 memo 后面、藏起期间 store 变了），重建出来的框就是旧的。第一版只补了「重建后再灌一次」，入口本身照样收副本，新写一个编辑器忘了调钩子照样编得过。

### 1. 归类表：bug → 直接原因 → 类

| bug | 直接原因 | 类 |
|---|---|---|
| 分镜一镜写完字，创作 → 生成画布 → 回创作，提示词框只剩占位字（落盘里字在） | `WorkbenchShell` 用 React `<Activity>` 藏起分镜槽，TipTap 重建编辑器；`PromptEditor` 的 `initialContentRef` 在首次挂载（提示词还空）时冻住，新实例拿空内容；同步账认为已同步，不写 | 编辑器拿着旧副本出生 |
| 同样路径上，敲过字再切走回来，框里是旧字（敲的字丢了） | 同上，冻住的是首次挂载那一刻的内容 | 同上 |
| 第一版修后：编辑器在 memo 后面、藏起期间 store 变了，放出时字对了但撤销一步退回旧字 | 放出那一刻渲染拿到的还是旧值，新文档靠一次外部写入补上，进了撤销历史 | 同上（入口仍收渲染值） |
| 撤销历史跨卸载（`promptHistoryCarry`）把挂上的空文档补成最后一步 | 它信「挂上的文档就是 owner 的值」 | 同上（下游症状；出生即真值后自然对） |

### 2. 为什么这一类会一直出现

入口的参数是一个值，不是值的主人。值在哪一刻被读、读的是不是最新，由每个调用方各自负责：`PromptEditor` 冻在 ref 里，富文本内核每次渲染传，第一版再加一个「重建后补灌」的钩子让大家去调。只要入口收值，「拿着旧副本建编辑器」就有入口；扫描守卫只能查「调没调」，查不出「传进来的值旧没旧」。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 画布节点提示词框、Agent 输入框（都是 `PromptEditor`）被藏起再放出、或 deps 变化重建后，同样是旧副本 | 入口单测 `useNomiTiptapEditor.browser.test.ts` 的 `promptEditorActivity` / `promptEditorBehindMemo`（框开着、藏放、memo 后面三种）；真窗口这两处没走，记 `unverified` |
| 再加一个编辑器宿主，传一份渲染时的值进来 | 现在编不过：入口类型没有 `content` / `value`（`useNomiTiptapEditor.types.test.ts`）；设计实验室那个「写死一份值的 owner」产品代码引不进来（`check:boundaries` 的 `src-no-import-devlab`） |

### 4. 靶子独立性检查

- 尺子：真窗口里读编辑器的字并与落盘 `project.json` 对账（`tests/ux/storyboard-prompt-reentry.walk.mjs`，四条腿，中英两轨），不是实现线自己的断言；入口单测用真 React + 真 TipTap + `<Activity>`；反例（什么都不做 / 全部拦下 / 重建后不填 / 回写 / 进撤销历史 / 收 content / 引实验室 owner）各跑一次必红。
- 主分支上的红：空框腿红在占位字（用户那次的原样），已有字腿红在「Old shot 1」（敲的字丢了）；入口单测在主分支上的红是入口不认 owner 时抛错，只算「测的是新合同」，不算症状复现。
- 没有「修对了反而掉分」的先例。

### 5. P0：这些是我们独有的吗？

不是。受控富文本编辑器的外部值同步是通用能力：编辑器用 TipTap（出生填入挂官方 `onBeforeCreate`），订阅用 React `useSyncExternalStore` 与 zustand 的 `subscribe` / `getState`。查过 Novel、BlockNote、Remirror，没有能直接接的受控绑定（前两家不受控，Remirror 要父组件持有整份 EditorState）。入口是一层薄胶，同步账 `controlledEditorSync` 2026-09-21 起就有；第一版新加的 `editor-rebuild-sync` 自写登记已删，不新增登记。

### 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 选了以后同一类还会不会再来 | 推荐 |
|---|---|---|---|---|---|
| 沿原方向修 | 在 `PromptEditor` 里再加一个 effect | 小 | 两个内核继续各写一份 | 会：下一个内核再漏 | 否 |
| 换一种做法 A（第一版，11-20） | 重建生命周期收成共享钩子 `useEditorRebuildSync`：实例一换先灌 owner 当前值、再重开账；扫描守卫查「用同步账的内核都调了它」 | 中 | 灌入是建好后的一次写入：编辑器在 memo 后面时渲染值本身就旧，补灌进撤销历史 | 会：入口仍收值，新编辑器忘了调钩子照样编得过，扫描只查写没写。两轨独立验收没过，已删 | 否 |
| **换一种做法 B（现方向，11-21）** | 入口只认 owner（`subscribe` / `getSnapshot` / `write`）+ 编解码；每个实例出生时入口自己读 `getSnapshot()`，之后经 `useSyncExternalStore` 跟 store；类型上收不进 `content` / `value` / `onUpdate` / `onBeforeCreate` / `onCreate`；5 个宿主各交自己 store 的读口，设计实验室交写死的 owner 且产品代码引不进来 | 中（本次做完；src 下非测试文件 23 个 +331 / −158 行：产品 15 个 +291 / −147，设计实验室 8 个 +40 / −11；其中注释 +86 / −28） | 宿主故意写一个返回旧值的 `getSnapshot` | 不会从入口来：拿旧副本建编辑器在类型上写不出来；剩的只有宿主自己写错读口 | **是** |
| 删掉 | 不适用（要保住创作者写的字） | | | | 否 |

老用户怎么过：不改存储格式，不升项目版本；旧项目落盘的提示词打开后照样显示，只看不敲项目文件逐字节不变（走查用 `tests/fixtures/old-user-data/projects/v0.24.1-storyboard` 夹具核对）。

### 7. 用户要权衡的核心

已由用户 11-21 定（结构版）。不改用户可见元素。

## 特征测试清单（动结构前先锁住）

- `src/workbench/common/useNomiTiptapEditor.types.test.ts`：入口再收 `content` / `value` / `onUpdate` / `onBeforeCreate` / `onCreate`、不给 owner 都编不过（`check:test-types`）。
- `src/workbench/common/useNomiTiptapEditor.browser.test.ts`：首挂、deps 重建、`<Activity>` 藏起期间 store 变了（含 memo 后面）、敲过字再藏放、文稿非规范写法、分镜提示词框——文档 = store 当前值，`write` 0 次，不可撤销；框开着时外部写入跟上。
- `scripts/check-boundaries.devlab.test.mjs`：产品代码引设计实验室的固定 owner 被拦，实验室自己 / 组件测试不拦。
- `tests/ux/storyboard-prompt-reentry.walk.mjs`：真窗口四条腿（分镜已有字、分镜空框、创作文稿、画布文字节点），中英两轨；修前在主分支上分镜两条腿红。
