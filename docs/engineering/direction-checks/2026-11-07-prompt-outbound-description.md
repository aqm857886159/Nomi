# 方向检查：参考卡出站提示词丢描述（协调代批 P1 例外）

日期：2026-11-07

## 命中了什么

提交 `src/workbench/generationCanvas/agent/storyboardPlan.ts`（只改一句已经失真的注释）和 `storyboardPlan.test.ts`（一条断言随修复改写）时，方向检查报：目录 `src/workbench/generationCanvas/agent/` 近 14 天 4 个 fix，这一刀是第 5 个。

## 命中的是目录口径，不是文件本身

- 要改的两个文件本身 14 天内零 fix 提交，命中只来自目录口径。
- 真正的修复在 `electron/shared/storyboard/storyboardPromptCompiler.ts`，不在热点目录。

## 改法是删，不是补

- 删掉「有 staticFeatures / dynamicFeatures 就只发它们、丢掉 description」这一分支，以及把结构化特征追加进提示词的写法。
- 参考卡提示词正文只剩 description（描述框里的字）；description 为空的旧草稿才退回旧写法，不新增分支或特例。
- 同一原则 2026-09-30 已用于镜头行（`compileShotOutbound`），这次是把参考卡并入同一类。

## 批准

协调 2026-11-07 依 CLAUDE.md P1 例外代批，事后报用户。设计卡：`docs/plan/2026-11-07-prompt-outbound-description.md`。
