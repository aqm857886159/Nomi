# 方向检查：AnchoredPopover 的焦点管理缺口（RW）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 触发：`src/design/AnchoredPopover.tsx` 14 天内已有 2 个 fix（bc45ad4b3 react19 类型、879aa9156 表结构），本次是第 3 个（V-1039 评审的键盘回归）。按 `docs/engineering/direction-check-template.md` 写。
> 来源是逃逸账本的修复：结账挂的类级检查 = 铁律 ⑫（`tests/ux/full-walk/catalog.mjs`），键盘合同由 `tests/ux/storyboard-popover-keyboard.test.mjs` 遍历四个 Portal 弹层。

### 0. 一句话根因

`AnchoredPopover` 把浮层 Portal 到 body 末尾，却只负责「放哪、怎么关」，不负责**焦点**——浮层不在触发器后面的 DOM 顺序里，Tab 进不去，关闭后焦点也不回触发器；每个把弹层挪进 Portal 的人都会丢一次键盘可达性。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| bc45ad4b3 react19 JSX 类型 | 升级后类型收窄 | 依赖升级（无关） |
| 879aa9156 表结构：弹层原地 absolute 被表格裁掉 | 弹层没走 Portal | 浮层定位（已修，是这次迁移的起因） |
| V-1039：「用作…」菜单、片段菜单 Tab 进不去 | 迁进 Portal 后浮层脱离 Tab 顺序，AnchoredPopover 没有焦点进入 / 回还 | **共享浮层缺焦点管理**（行 ⋯ 菜单原本就有同一缺口） |

### 2. 为什么这一类会一直出现

定位（Portal）和焦点是同一件事的两半，共享层只做了前一半。于是「逃出裁切」的每一次迁移都会把键盘用户留在原地，而各菜单又倾向于自己补一段（底栏 ⋯ 早就在自己的 `closeOverflow` 里补了「焦点还给 ⋯」），补法各不相同。

铁律：⑫ 点了=以为的——键盘用户按 Enter 以为打开了菜单、Tab 以为走进菜单。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 下一个迁进 Portal 的弹层（如参考槽、画布节点浮层）同样 Tab 进不去 | `pnpm exec vitest run tests/ux/storyboard-popover-keyboard.test.mjs` 往清单里加一行 |
| 各菜单继续各自补焦点回还，行为不一致 | `git grep "\.focus()" src | grep -i menu` |

### 4. 靶子独立性检查

靶子是评审线（V-1039，与实现线不同）按真实键盘复现出来的，不是实现线自己写的；本线新加的键盘合同测试对「关掉 `managesFocus`」变异必红（4/4 红）。既有 `storyboard-delete-undo` 10 条（#1029 的编辑器表面归属判据 `root.contains(el) || el === lastEditorFocusRef.current`）是独立靶子，本次改动后仍全绿。

### 5. P0：这些是我们独有的吗？现成方案有哪些

不是领域能力，**接入现成的，不自写**：Radix `@radix-ui/react-focus-scope`（1.1.16）。它本来就在依赖树里（`@radix-ui/react-dropdown-menu` → react-menu 的依赖，`src/design/menu.tsx`、`tooltip.tsx` 同一家），这次提为直接依赖（锁文件只多一行直接依赖，版本对齐已有那份）。`@floating-ui/react` 未安装；`AnchoredPopover` 的定位（翻边、点外面关）仍是自写通用能力，未登记在 `self-written.json`，是后续换 floating-ui 时一并处理的事。

### 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案（焦点） | `AnchoredPopover` 对带 `onClose` 的浮层套 `<FocusScope asChild loop>`（不加 `trapped`：非模态，trap 会把关闭时同步还给触发器的焦点又拽回浮层，见 composerLifecycle）；`onUnmountAutoFocus` 里「焦点已被用户挪走就不抢回」 | 一行直接依赖；放好位置前用 opacity 0 代替 visibility:hidden（FocusScope 挂载即聚焦） | 对其他带 onClose 的消费者行为有变；子树 autoFocus 的输入框不被抢（FocusScope 只在焦点不在内部时才聚焦第一项） | **本次采用** |
| 接入现成方案（定位也换） | 整个换成 `@floating-ui/react` | 新依赖、12 个消费者回归 | 面大 | 后续单独做 |
| 补（自写 tabbable 查询 + Tab 循环） | 第一版做过（~25 行） | 小 | 通用能力自写，评审否掉 | 否（已删） |
| 删 | 去掉 Portal | 又被表格裁掉 | 回到 879aa9156 之前 | 否 |

### 7. 用户要权衡的核心

共享浮层要不要对**所有**可关闭的浮层默认接管焦点（本次是），还是做成按消费者开关；默认接管换来一致，代价是其他面（素材选择器、转场选择器、同步徽标、画布浮层）的键盘行为也变了。

## 特征测试清单

- `tests/ux/storyboard-popover-keyboard.test.mjs`：四个 Portal 弹层（行 ⋯、用作…、片段菜单、底栏 ⋯）遍历：打开 → 焦点进浮层 → Tab / Shift+Tab 循环 → Esc 关 → 焦点回打开前的元素。
- `tests/ux/storyboard-delete-undo.test.mjs`（10 条）：#1029 的编辑器表面归属不被破坏。
- `tests/ux/storyboard-table-structure.walk.mjs`：真窗口里 Esc 关闭「用作…」与片段菜单。
