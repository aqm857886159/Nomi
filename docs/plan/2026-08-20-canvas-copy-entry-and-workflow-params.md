# 画布：节点右键菜单 + 导入工作流参数的可识别标签

> 来源：2026-08-19/20 画布群反馈（G1#4968「copy 键是啥呢」、G2#433「勾了功能画布里没对应按钮」）。
> 样张已拍板：用户 2026-08-20「样张 A 和 B 都按这个做」。

## 背后逻辑（两条都不是「加功能」，是「让已有的功能被看见」）

**A. 右键节点现在什么都不弹。** `.generation-canvas-v2-node` 被写在右键菜单的**排除名单**里
（[useCanvasContextNodeMenu.ts:41](../../src/workbench/generationCanvas/components/useCanvasContextNodeMenu.ts)），
所以右键节点 = 死路。而复制/剪切/粘贴自 2026-06-12 就能用，只有键盘一条路，
且只写在底部键盘图标的帮助面板里——用户原话「**copy 键是啥呢**」问的是「键在哪」，不是「键坏了」。
菜单每项右侧标出快捷键，用一次就学会了（菜单是**发现入口**，快捷键是**加速器**，§1.5.2 第 1 条）。

**B. 参数 pill 拿「当前值」当标签，对任意工作流不可读。**
底栏那颗摘要 pill 显示的是当前参数值：档案模型上是 `1:1 · 2k`，你一眼认得出比例和清晰度；
但 ComfyUI 导入的参数是任意的，会显示成 `15 · 24`（采样步数和帧率）——**没人看得出那是自己勾的东西**。
参数本身**渲染是正常的**（`resolveRenderedControls` 在无 archetype 分支会读 `meta.parameters`），
缺的只是「这里面装的是什么」这个名字。

## 不动的地方（都有拍板记录，§1.5.4：拍板形态默认不动）

- **不重排节点底栏**「模型 + 变体 + 参数」——2026-07-17 拍板形态，§1.5.4 明确列为反例。
- **不动摘要 pill 的交互**（点开弹统一参数面板）——同批拍板，样张 `docs/design/mockups/node-param-panel.html`。
  B 只换**这一类模型的 pill 文案**，是拍板形态内的一处窄例外（2026-08-20 用户拍板）。
- 不新增任何常驻按钮：右键菜单是 L3 收纳（§1.5.1），不占常驻预算。

## 范围

| 文件 | 改什么 |
|---|---|
| `components/useCanvasContextNodeMenu.ts` | 把 `.generation-canvas-v2-node` 移出排除名单；pending 菜单带上 `nodeId`；提交时按有无 nodeId 分流「节点菜单 / 空白添加菜单」 |
| `components/NodeContextMenu.tsx`（新）| 菜单壳沿用 NodeAddMenu 的视觉（border/rounded/bg/shadow），每项右侧一列快捷键提示 |
| `components/GenerationCanvas.tsx` | 渲染 NodeContextMenu；接上 copy/cut/paste/group/delete 五个 store 动作 |
| ~~`nodes/InlineParameterBar.tsx`~~ | 曾新增 `summaryOverride?: string`（pill 文案覆盖）。**2026-09-11 已随摘要 pill 一起删除**：底栏改成逐参数下拉 chip 后，「工作流参数 · N 项」这句话由 ⚙ 的名字（`更多参数 · {{count}} 项`）承担，不再需要按供应商分叉的摘要通路。见 `docs/design/2026-09-10-node-composer-bar-v1.md` §B |
| `nodes/NodeParameterControls.tsx` | 导入工作流（`meta.comfyWorkflowImport` 存在）时算出 `工作流参数 · N 项` 传下去 |
| `i18n/locales/generationCommon.ts` | 菜单五项 + 工作流参数文案，zh-CN / en 双语（R15） |

## 关键取舍

- **右键节点要不要顺带选中它？** 要。不选中的话「复制」没有作用对象，等于又一个「点了没反应」（§1.6 C1）。
  已在多选里的节点右键 → **保留整个多选**，不要塞回单选（否则批量操作被右键打断）。
- **粘贴项要不要常驻？** 要，但剪贴板为空时 `disabled` + `title` 说明为什么（§1.6 C1 有门岗 `check:controls`）。

## 验收门

1. `pnpm run gates` 全绿（含 `check:controls` 与 `check:i18n`）。
2. 单测：菜单项目录与快捷键文案随平台切换（⌘ / Ctrl）；空剪贴板时粘贴项 disabled。
3. 走查 `tests/ux/canvas-node-context-menu.walk.mjs`：右键节点**真的弹出菜单**、点「复制」+ ⌘V **节点数真的 +1**
   （判据取副作用不取截图）；右键空白仍弹「添加节点」菜单（不回归）。
4. 真机截图自己 Read 过，与本样张逐项对账。

## 回滚

单 commit，`git revert`。B 只改 pill 文案与一个可选 prop，A 是新增组件 + 一处分流，都无数据迁移。
