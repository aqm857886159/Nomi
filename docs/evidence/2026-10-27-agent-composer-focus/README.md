# ⌘J 打开 Agent 后光标进输入框——验收证据

分支 `fix/agent-composer-focus`。设计卡 `docs/plan/2026-10-27-agent-composer-focus.md`（★9 验收清单 A–F、反例 R1–R6）。
全部是真 Electron 跑 `pnpm run build` 的产物（仓库目录启动、未打包成 .app）+ 隔离 profile，零花费；截图都由实现线亲眼 Read 过。机器：Mac（Darwin 25.5，arm64），Electron 43.4.1。
最终一轮在合入 origin/main 之后的 `fc092374c` 上重新 typecheck（exit 0）、build（exit 0）、全部走查重跑；shell-redesign 三轨的截图与合入前那一轮逐字节相同。

## 截图

| 文件 | 是什么 | 走查 / 站 |
|---|---|---|
| `a1-mod-j-zh-1280.png` | 画布页小球 → ⌘J → 直接打「把第三镜的光调暗一点」，字在 Agent 输入框里 | `tests/ux/shell-redesign.walk.mjs` check-mod-j，中文 1280×800 |
| `a1-mod-j-en-1280.png` | 同上，英文轨（「Dim the light on shot three」） | 同上，英文 1280×800 |
| `a1-mod-j-zh-1000x700.png` | 同上，窄窗 | 同上，中文 1000×700 |
| `a3-ball-zh-1280.png` / `a3-ball-en-1280.png` | 点小球打开浮窗（焦点断言在截图之前，截图里光标被 Playwright 隐去） | shell-redesign canvas-agent |
| `a4-starter-zh-1280.png` | 空态点「写脚本」，句子在输入框里（焦点断言在截图之前） | `tests/ux/agent-v4-short-film.walk.mjs` 01b |
| `e2-tikhub-deeplink-zh.png` | 没配 TikHub key，「找参考」框贴抖音链接回车 → 页面提示先配 key，设置开到「模型 → 数据源」TikHub 那一节，Key 输入框是焦点（焦点断言在截图之前，边框是聚焦态，光标被 Playwright 隐去） | `tests/ux/tikhub-connector.walk.mjs` 04，中文 1280×933 |

## 走查退出码

| 走查 | 结果 |
|---|---|
| shell-redesign 中文 1280×800（canvas-agent、check-shortcuts、check-mod-j、check-mod-backslash-dock） | exit 0 |
| shell-redesign 英文 1280×800 | exit 0 |
| shell-redesign 中文 1000×700 | exit 0 |
| agent-v4-short-film | 本 PR 的起手句断言（第 102 行）过；整条在本机红在第 216 行（最小窗 1100×720 下对话流只溢出 35px，不够做「收起前后滚动位置」那条正对照，走查拒绝往下测——是走查的前提，不是产品断言）。main 上本机红不红：未验证（协调另派发版线修这条走查）。main 夜跑 run 40478193665（`0c87662bc`，ubuntu-latest）过了这条前提、红在第 262 行：运行中按 textarea 时代的 `placeholder` 属性判，TipTap 输入框没有这个属性 |
| tikhub-connector（中文 1280×933） | exit 0：「深链后光标在 TikHub 那一节的 Key 输入框里」「深链落下的焦点没被抢走（700ms 后仍在 Key 输入框里）」都过 |

## 反例（逐个改坏 → 跑必须红的那一项 → 还原并核对与 HEAD 逐字节一致）

R1–R6：改坏 → 跑必须红的那一项 → `git checkout HEAD --` 还原，核对与 HEAD 逐字节一致（7 次还原都一致）；真窗口那几条是在改坏的代码上重新 build 后跑的。R7–R9 改的是当时还没提交的 `settingsSectionFocus.ts`，从改坏前的副本还原，提交前核对三处保护（焦点已在对话框里不抢、落上才算、试满才停）都在。

| 反例 | 必须红的 | 结果 |
|---|---|---|
| R1 外壳换回修之前的 `ShellAgentHost.tsx`（按 `textarea` 找） | 渲染层普查、A1、A3 | 普查红 1 条（62/63）；shell-redesign 中文 check-shortcuts 红「Mod+J 打开后焦点不在 Agent 输入框」，canvas-agent 红「点小球打开浮窗后焦点不在 Agent 输入框」 |
| R2 换个选择器接着猜 `#project-agent-resident [contenteditable="true"]` | ESLint 渲染层块、普查 | ESLint 在 `ShellAgentHost.tsx:65` 报 `focus-owner/no-restricted-syntax`；普查红 1 条 |
| R3 `focusEditorAtEnd` 调了 focus 就返回 true | B7 | 恰好红「调了 focus 但没落上」（9/10） |
| R4 去掉 30 帧预算 | B3 | 红「试满 30 帧」与「新请求顶掉旧请求」（8/10） |
| R5 ⌘J 那一支不发请求 | A1 | shell-redesign 中文 check-shortcuts 红「Mod+J 打开后焦点不在 Agent 输入框」 |
| R6 走查改回 `tagName === 'TEXTAREA'` | ESLint 走查块、走查侧普查 | ESLint 在 `shell-redesign.walk.mjs:463` 报；走查侧普查红 1 条 |
| R7 设置深链只试一次 | settingsSectionFocus.test.ts | 红「晚几帧才挂出来」「调了没落上」「试满就停」3 条（3/6） |
| R8 设置深链调过 focus 就算 | settingsSectionFocus.test.ts | 红「调了没落上」1 条 |
| R9 焦点已在对话框里照样抢 | settingsSectionFocus.test.ts | 红「焦点已在对话框里」1 条 |

普查那一半第一轮误用 `node --test` 跑（它是 vitest 文件，整个文件起不来 = 假红），已用 vitest 重跑：HEAD 上 63/63 绿，R1 / R2 / R6 各恰好红普查那一条。

## 设置深链诊断（为什么深链从来没落上）

临时诊断走查（每帧记焦点与设置对话框状态，跑完删除）：按下回车后——

| 版本 | 场景 | 对话框出现 | TikHub 那一节出现 | 焦点 |
|---|---|---|---|---|
| main 的写法（手写 `button, input, [tabindex]`） | 先进过设置 | 18ms | 40ms | 5 秒内一直在对话框后面的「找参考」框里 |
| main 的写法 | 第一次打开设置（「模型」页懒加载） | 22ms | 348ms | 同上 |
| 本分支第一版（tabbable，仍只试一次） | 先进过设置 | 26ms | 48ms | 同上 |
| 本分支第一版 | 第一次打开设置 | 75ms | 415ms | 同上 |

对话框只在自己状态变的那一刻试一次聚焦，那一节那时还不在。改成 `src/workbench/settings/settingsSectionFocus.ts` 每帧试到落上为止、落在这一节声明的 Key 输入框；最终树上 tikhub-connector 走查过（见上面「走查退出码」与 `e2-tikhub-deeplink-zh.png`）。
