# 方向检查：提示词编辑器实例重建后框是空的（2026-11-20）

**拍板**：协调会话 2026-11-20 代批（用户 2026-10-22 授权的例外：只因目录口径命中、改法是换并删旧、不新增分支；事后报用户）。
`node scripts/fix-churn.mjs` 对 `src/workbench/assets/PromptEditor.tsx` 只因目录 `src/workbench/assets/`（14 天 8 个 fix，涉及 6 个别的文件，全是素材库删除 / 存活判定，和提示词编辑器无关）命中；`PromptEditor.tsx` 文件本身 14 天内没有 fix 提交（`git log --since=14.days -- src/workbench/assets/PromptEditor.tsx` 为空）；`controlledEditorSync.ts`、`useNomiRichTextEditor.ts` 同样只因目录 `src/workbench/common/` 命中。

**这一处的全图在哪**：表外（`docs/engineering/seams.json` 没有编辑器同步这一条；受控同步账见 `src/workbench/common/controlledEditorSync.ts` 文件头）。

### 0. 一句话根因

两套编辑器内核（`PromptEditor`、`useNomiRichTextEditor`）各自写了一份「受控同步」的接线，「实例被重建时文档要等于 owner 当前的值、账要重开」这一步只有一套写了（且只写了重开账）——另一套把创建那一刻的内容冻在 ref 里，重建的新实例拿着旧内容、账又认为已同步，回流永远判成回声。

### 1. 归类表：bug → 直接原因 → 类

| bug | 直接原因 | 类 |
|---|---|---|
| 分镜一镜写完字、生成后，创作 → 生成画布 → 回创作，提示词框空（落盘里字在，页脚也认这镜有提示词） | `WorkbenchShell` 用 React `<Activity>` 藏起创作区，effect 全卸再重放，TipTap 重建编辑器；`PromptEditor` 的 `initialContentRef` 在首次挂载（提示词还空）时冻住，新实例拿空内容；账上 `current == value`，`receive(value)` 返回 false 不写 | 受控编辑器实例重建没有统一生命周期 |
| 同样的路径上，敲过字再切走回来，框里是旧字（比空更糟，敲的字丢了） | 同上，冻住的是首次挂载那一刻的内容 | 同上 |
| 撤销历史跨卸载（`promptHistoryCarry`）重放时把「挂上的空文档」补成最后一步，把空固化 | 它信「挂上的文档就是 owner 的值」，实际不是 | 同上（下游症状；挂上的文档对了它自然对） |

### 2. 为什么这一类会一直出现

两个内核都是「编辑器是自己文本的唯一 owner，外部值只在真正来自外部时写入」的同一份账（`createControlledEditorSync`），但账只管「值和值的比较」，不管「编辑器实例换了、新文档是什么」。这一步没有归属，谁碰到谁在自己的文件里补：`useNomiRichTextEditor` 补了一个 `sync.reset`，`PromptEditor` 没补。结构上：同一件事两个家。类根因落到铁律 ⑫ 点了=以为的：用户切走再回来，以为的是「我写的字还在」。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 画布节点提示词框、Agent 输入框（都是 `PromptEditor`）在被 `<Activity>` 藏起再放出、或 deps 变化重建后，同样一直是首次挂载时的内容 | 修前：`node tests/ux/ui.mjs` 起窗口，节点框打字 → 切别的工作区 → 回来读框（本次修前未单独复现这两处，只复现了分镜；列为同类入口，修后读回正常） |
| 再加第三个用同步账的编辑器内核，会再写一份自己的重建处理 | `src/workbench/common/editorRebuildSync.structure.test.ts`：用同步账的内核只许这两个，都必须走 `useEditorRebuildSync`，不许自写 `sync.reset` |

### 4. 靶子独立性检查

- 尺子：真窗口里读 `[data-storyboard-row] [contenteditable]` 的文字（与落盘 `project.json` 对账）和每帧录像（`requestAnimationFrame` 逐帧读），不是测试线自己的断言；单元测试用真 ProseMirror 状态，反例（什么都不做 / 全部拦下）各跑一次必红。
- 没有「修对了反而掉分」的先例。

### 5. P0：这些是我们独有的吗？

不是。受控富文本编辑器的外部值同步是通用能力；已经接入现成的 TipTap，本次不新增自写，只把两个内核里重复的接线合成一处共享钩子（`useEditorRebuildSync`）。TipTap 官方的 `useEditor` 重建行为不变，改的是我们这一侧对重建的响应。

### 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 沿原方向修 | 在 `PromptEditor` 里再加一个 effect | 小 | 两个内核继续各写一份，下一个内核再漏 | 否 |
| 换一种做法 | 重建生命周期收成一处共享钩子（`useEditorRebuildSync`，放在 `createControlledEditorSync` 旁）：实例一换，先把文档灌成 owner 当前的值（不进撤销历史、不回写）、再重开账；两个内核都用它，`PromptEditor` 删掉冻结的 `initialContentRef`，`useNomiRichTextEditor` 原有的 `sync.reset` 改走它 | 中（本次做完） | 首帧闪空：用 layout effect，真窗口逐帧录像验证第 0 帧起有字 | 是 |
| 删掉 | 不适用（要保住用户写的字） | | | 否 |

老用户怎么过：不改存储格式，不升项目版本；旧项目里落盘的提示词打开后照样显示（`tests/ux/storyboard-prompt-reentry.walk.mjs` 用 `tests/fixtures/old-user-data/projects/v0.24.1-storyboard` 夹具核对）。

### 7. 用户要权衡的核心

无需权衡：纯修复，不改用户可见元素；事后报用户。

## 特征测试清单（动结构前先锁住）

- `src/workbench/common/useEditorRebuildSync.test.ts`：灌入判与写（新实例空 / 另一镜不串 / 已删旧提示词不复活 / 已相等不写 / 不进撤销历史）+ 撤销重放不再固化空。
- `src/workbench/common/editorRebuildSync.structure.test.ts`：重建生命周期只有一个家。
- `tests/ux/storyboard-prompt-reentry.walk.mjs`：真窗口走查（旧项目夹具、敲字后切走再回、回项目库再进、打开不写、反例）；修前在旧代码上红（敲过的字丢了）。
