# 提示词编辑器实例重建后按 owner 当前值灌入（设计卡）

纯修复：分镜一镜写字、生成后，创作 → 生成画布 → 回创作，提示词框空。方向检查见 `docs/engineering/direction-checks/2026-11-20-prompt-editor-remount.md`（根因、三条路对比、归类表、老用户怎么过）。

## ★0 先查别人

- `node_modules/@tiptap/react/src/useEditor.ts:218-237`（3.23.5）· `content` 等选项只在创建那一刻读，`deps` 变了就销毁重建，没有「重建后按外部值灌入」的钩子 · **确认了**：灌入这一步必须我们自己挂在实例变化上，不能指望 TipTap 重建时带上最新值。
- `node_modules/@tiptap/core/src/commands/setContent.ts:50-69` · `setContent` 带 `emitUpdate:false` 即 `preventUpdate`（不回写），但命令不设 `addToHistory:false`，灌入会进撤销栈 · **确认了**：灌入用同款 `replaceWith` 事务并自己带 `addToHistory:false`，否则撤销会退回空文档。
- <https://www.mintlify.com/ueberdosis/tiptap/api/react/use-editor> · 官方做法是 `useEffect` 里对比 `getHTML()` 再 `setContent`，以免回环 · **改了**：我们用受控同步账（`createControlledEditorSync`）判「是否真来自外部」，灌入前先比文本，已相等不写（首次挂载不灌）。
- `src/workbench/common/useNomiRichTextEditor.ts`（本仓库另一内核，修前）· 自己写了一个 `sync.reset`，另一内核（`PromptEditor`）没有 · **改了**：重建生命周期收成一处共享钩子，两个内核都用，删掉两份各写的。
- 出口：不涉及：纯修复，不新增、不扩大、不挪动任何挡人的保护。

## ★1 目标 / 量具

创作者在分镜页写了提示词，切到生成画布再回创作，提示词框里还是他写的字。量具：真窗口里读 `[data-storyboard-row] [contenteditable]` 的文字并与落盘 `project.json` 对账，中英各一遍；逐帧（rAF 读 DOM）确认重进第 0 帧起有字。修前复现为空（敲过字再切走则回到旧字）。

## ★2 删了什么 / 为什么能删 / 现有调用方怎么过

删 `PromptEditor` 里冻结的 `initialContentRef`（首次挂载那一刻的内容）和 `useNomiRichTextEditor` 里自写的 `sync.reset`；两处改走新增的 `useEditorRebuildSync`。调用方（六处入口）：分镜提示词框、画布节点提示词框、Agent 输入框共用 `PromptEditor`；创作正文、画布文字节点、设计实验室共用 `useNomiRichTextEditor`。首次挂载时文档已等于值，灌入不发生，行为同前。

## ★3 不改什么

不改分镜页的元素、布局、文案；不改存储格式、不升项目版本，旧项目落盘的提示词照样显示。

## ★4 全状态

用户看到的界面状态不变，只多「回来后字在」。空提示词：框里仍是占位字（灌入的是空，等于现状）；很长的提示词：照现状滚动，灌入一次性完成；zh / en 文案不动。取消中、过期、能力不可用：不涉及（没有新操作）。

## ★7 性能

不新增用户操作。重建时多一次文档灌入（一次 `replaceWith` 事务，在 layout effect 里同步完成，不触发回写），最坏规模 = 一镜提示词长度（含最长的几千字）。预算按默认（操作到可见反馈 ≤100ms，无 >50ms 长任务）。不登记新的 perf 场景：这一步只在实例被重建时发生，不在任何输入、拖动、平移路径上，没有可测的新交互；`perf-scenario：不适用：不新增交互，只在编辑器重建时灌入一次`。

## ★9 验收清单 / 反例 / 回滚

- 验收清单：①分镜写字、生成、切到生成画布、回创作，框里是这一镜的字（中英各一遍）；②敲过字再切走回来，框里是新字不是旧字；③重进后第 0 帧起有字，不闪空；④重进不写项目文件、不进撤销历史；⑤旧项目夹具 `v0.24.1-storyboard` 已落盘的提示词照样显示；⑥另一镜的字不串、已删的旧提示词不复活。
- 反例：「什么都不做」（钩子里去掉灌入）→ 单元测试与真窗口走查 ⑤ 红；「全部拦下」（无条件灌入）→ 「已相等不写」「不进撤销历史」两条红；某内核自写 `sync.reset` → 结构测试红。各改坏一次均为红，还原为绿。
- 接线反例：钩子删 `hydrate` 调用 → `useEditorRebuildSync.wiring.test.ts` 的「共享钩子先灌入」和「PromptEditor」红。
- 接线反例：`PromptEditor` 不传 `hydrate` → 同文件的「PromptEditor」红；富文本内核当前通过 TipTap 的 `content` 创建新实例，同文件的「富文本内核」守住该路径。
- 顺序反例：钩子把 `hydrate` 放到 `reset` 之后 → 同文件的「共享钩子先灌入」红（`reset` 必须收到灌入后的文档）。
- 同类入口（六处，调用方表见 ★2）：真窗口只验了分镜与画布节点框；Agent 输入框、创作正文、画布文字节点、设计实验室记 `unverified`。结构测试 `editorRebuildSync.structure.test.ts` 守「用同步账的内核只有这两个、都挂这个钩子」。
- 回滚：revert 本提交即可，无数据迁移。
- 独立验收：待派（协调派）。
