# 选中即主语 · 补格画布副本与改前截图

画布原件：Claude Design「Nomi 0.24 补格：选中即主语」（2026-10-22 版，在用户账号里）。设计卡：[docs/plan/2026-10-21-select-to-iterate.md](../../../../plan/2026-10-21-select-to-iterate.md)；清单：[docs/design/boards/2026-10-18/AnnotateToAgent.board.json](../../2026-10-18/AnnotateToAgent.board.json)。

用户 2026-10-22：「问题在于能不能把这个原来这些东西和你现在最新的设计做分离，然后做接入呢？为什么要重新的去做这个设计？」「可以。画布撤掉 8 张整屏，换成 5 格组件级新增稿（旁边放现有组件真实截图对照），清单和设计卡改成接入结构，整屏效果用设计实验室拼。」

## 目录

| 路径 | 是什么 |
|---|---|
| `source/canvas.json` + 5 个 `.dc.html` | 画布原样副本，文件名照原样：`Main.dc.html`（Δ1 输入框 chip 多一种：选中的节点）、`D2-version-draft.dc.html`（Δ2 版本卡「第 N 版 · 待生成」）、`D3-confirm-target.dc.html`（Δ3 D2 确认卡多一行：改谁 / 新建什么）、`D4-over-limit.dc.html`（Δ4 选区超过 12 个）、`D5-draft-node.dc.html`（Δ5 用这些做新的：草稿节点）。Δ6（M3「放弃」→「回到第 N 版」）只改字，不画。原来的 8 张整屏（S1–S6、暗色、英文）已从画布撤掉，不收 |
| `source/assets/` | 每格左边的「现在」对照截图 |
| `before/` | 39 张改前真实截图（真机屏幕外窗口 zh 亮 / en 暗 + 设计实验室生产组件），每张都亲眼看过 |

## 对照截图的来源

画布里 `<img>` 引用的是画布的 `/_blob/…` 地址（仓库里打不开）；仓库副本在 `source/assets/`，是下面这些原图的裁剪 / 重存：

| 格 | 画布引用 | 仓库副本 | 原图 |
|---|---|---|---|
| Δ1 `Main.dc.html` | `/_blob/20fa75be5303581a742c72884ced2ad3` | `source/assets/before-chips.png` | `before/lab-zh-light-composer-chips-file-skill-clip.png` |
| Δ2 `D2-version-draft.dc.html` | `/_blob/5c487da91c044a5e09a3e88eff7dd98f` | `source/assets/before-version-cards.png` | `before/lab-zh-light-version-cards-new-version-pending.png`（裁剪） |
| Δ3 `D3-confirm-target.dc.html` | `/_blob/0a9661abdc0f5a6d6cdaf7764884a864` | `source/assets/before-d2.png` | `docs/design/proposals/2026-10-18/preview/D2b-single.png`（裁剪；D2 已拍板未实现，没有真机图） |
| Δ4 `D4-over-limit.dc.html` | `/_blob/d1d5ed8984866aeff55862b67359689d` | `source/assets/before-composer.png` | `before/lab-zh-light-composer-idle.png` |
| Δ5 `D5-draft-node.dc.html` | `/_blob/a0ca68829e2579654cc849964e3c038f` | `source/assets/before-nodes.png` | `before/real-zh-light-03-multiselect-3-no-chip.png`（裁剪） |

## 预览图

**预览待补：缺本地渲染器。** 0.24 的 124 格预览（`docs/design/proposals/2026-10-18/preview/`）是「无头浏览器按格子自身宽高截取」，但仓库里没有对应脚本（#1251 / #1257 只提交了 PNG）；`.dc.html` 还依赖画布运行时 `./support.js` 和 `/_blob/` 图片，都不在仓库。按任务书不自写渲染器。

## 整屏效果

不在画布上手画整屏：下一步在设计实验室（`src/devlab/designLab`）里用生产组件把 Δ1–Δ5 接进去拼，截图和这 5 格逐项对账。
