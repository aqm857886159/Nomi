# 弹层被祖先 overflow 裁掉：DOM 断言、rect、Playwright 点击三样证据同时失明

> 📎 教训 · 首次记录 2026-09-06 · 状态：现行
> **触发场景**：① 写或改「从容器里弹出来」的浮层（选择器 / 菜单 / 气泡 / 面板）；② 用户说某个弹层「只露出一条边」「点不到」「没有那个选项」；③ 走查里出现 `expectVisible(弹层)` 后面直接 `click(弹层里的按钮)` 的写法。

**结论**：浮层的走查判据**不能**用 `toBeVisible` / `getBoundingClientRect` / 「点得动」。这三样在「被祖先 `overflow` 裁掉」这一族上**同时失明**。判据只能问渲染结果：`document.elementFromPoint(采样点)` 必须命中浮层自己或它的后代。仓库里已有现成的：`tests/ux/_assert.mjs` 的 `expectOverlayReachable(locator, label)`（整块 7×7 采样）和 `expectHittable(locator, label)`（单个控件中心点）。
修法也只有一条：走 `src/design/AnchoredPopover.tsx`（Portal 到 body + fixed 贴锚点 + 翻转/夹进视口）。**不许**给弹层加 z-index，也**不许**把祖先改成 `overflow: visible`——那两个都是症状修法（P2），而且第二个会把轨道内容漏出格子。

**为什么会踩**：2026-09-06 用户真机撞上——预览页时间轴接缝上的「12f」转场标记点开后，选择器只露出「时长 − 12f +」一行，五个转场类型和「删除转场」看不见也点不到。
根因是几何：`TimelineTransitionPicker` 当时写的是原地 `absolute`（`absolute left-1/2 top-7 z-20`），而它的宿主 `TimelineTransitionMarker` 住在 `src/workbench/timeline/TimelineTrack.tsx:256` 的 `.workbench-timeline-track__clips` 里——那一格是 `relative overflow-hidden`。定位祖先带 `overflow-hidden`，弹层就被切成一条边。
真正值得记的是**为什么上一轮走查把它判成了绿的**。当时的写法是 `expectVisible(picker)` 然后 `click(picker.getByRole('button', { name: '淡入淡出' }))`，三样证据全绿：

- `toBeVisible()` 只看 DOM 在不在、有没有 `display:none`、rect 是否非零——**祖先裁切它一概不知**；
- `getBoundingClientRect()` 报的是**未裁切**的几何。被裁掉四分之三的弹层照样报满尺寸、照样算「在视口内」，所以「rect 在视口里」这条断言也拦不住；
- Playwright 的 `click()` 在点之前会 `scrollIntoViewIfNeeded`，**把那个 `overflow` 容器滚一下**再点。于是脚本点得动、断言全过，而用户永远点不到。

实测数据（用 `measureOverlayReach` 对剪辑面六个浮层各开一次的一次性探针，跑完即删；修复前）：选择器矩形上 49 个采样点只有 **7** 个命中它自己，8 颗按钮里 7 颗的 `elementFromPoint` 落在别的轨道或视口外；截图 `tests/ux/shots/editing-real-user-pass/03-transition-picker.png` 修复前只露出「时长」那一行。

**怎么用**：
- **动手前先实扫同族**，别只修撞上的那一个。扫法：`grep -n "absolute" src/<子系统>/*.tsx` 找出所有在容器内渲染的浮层，写一条一次性走查把它们逐个开出来、各跑一次 `measureOverlayReach`。2026-09-06 扫剪辑面六个浮层的结果是：转场选择器 7/49（红），右键菜单 / 快捷键面板（`fixed`，天然逃出 overflow）、预览控制条「文字」菜单、顶栏「布局」菜单、「+配乐」素材选择器（已 Portal）都是 49/49。**那五个是阳性对照**——没有它们，你分不清「采样法真的能测出东西」和「这把尺子根本没生效」（同 `race-repro-needs-positive-control`）。
- 新浮层一律用 `src/design/AnchoredPopover.tsx`，不要再各写各的 `absolute`，也不要引第三套定位库（P1 / R20）。它的几何有纯函数单测：`src/design/anchoredPopoverPlacement.test.ts`。
- Portal 到 `document.body` 之后**配色不会掉**：`--workbench-*` 定义在 `:root`（在 `dist/tailwind.generated.css` 里只有这一处定义），不是 `.workbench-shell` 作用域。别照抄画布节点面板那几行「Portal 到画布视口所以只能用 `--nomi-*`」的注释——那是另一个 Portal 目标的约束。
- 顺带一条同族的：**走查里也别写死几何**。同一次跑动里 `.workbench-timeline__tracks` 上写死的 `{ x: 600, y: 6 }` 空白点，在窗口被压到 1512 宽之后正好落进浮在轨道区右上角的时间轴工具条，点击被 intercept 干等 30 秒超时。空白点要**算**出来（`tests/ux/editing-real-user-pass.walk.mjs` 的 `clickTimelineBlank()`，同样用 `elementFromPoint` 找第一个真空白）。

**出处**：PR #517 / 分支 `fix/closing-editing-real-user-pass-20260906`。修复：`src/design/AnchoredPopover.tsx`（新）、`src/workbench/timeline/TimelineTransitionPicker.tsx`、`src/workbench/timeline/TimelineTransitionMarker.tsx`、`src/workbench/assets/AssetPickerPopover.tsx`（收敛到同一机制）。判据：`tests/ux/_assert.mjs` 的 `measureOverlayReach` / `expectOverlayReachable` / `expectHittable`。红→绿证据：同一份新断言在修复前的构建上报 `7/49`，修复后 `49/49`。同族参考 `vendor-manage-is-a-discoverability-problem.md`（控件被 overflow 裁出视口，也是「功能在、够不着」）。
