# 方向检查：分镜编辑器把「浮层里的焦点」算成外人（RW）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 触发：`StoryboardPlanEditor.tsx` 14 天内第 4 个 fix（`fix-churn` 命中）。本页按 `docs/engineering/direction-check-template.md` 写。

### 0. 一句话根因

编辑器判断「这个焦点 / 这次按键是不是我的」只看 DOM 包含关系；行菜单改走 portal（`AnchoredPopover`）后不在编辑器 DOM 里，这条判断就把自己弹出的菜单当成外人。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 7973d9a3a 文稿方案 generate 确认后的结局 | 花钱确认的结果没走回模型 | 花钱结局回传（与本页无关） |
| 0ea7215c9 删掉「每次生成前确认花费」承诺 | 文案许了做不到的承诺 | 文案诚实（与本页无关） |
| bc45ad4b3 react19 JSX 类型 | 升级后类型收窄 | 依赖升级（与本页无关） |
| 本次：从「⋯」菜单删除后立刻 Cmd+Z 不撤销 | 删除时焦点在 portal 菜单项上，`editorRef.contains` 为假，没记下要还的焦点，焦点落到 body | **编辑器表面归属只认 DOM，不认自己弹出的 portal** |

前三个 fix 和本次不是同一类；本次是这一类的第一个，但 portal 迁移还在继续（表格结构线 L-sbtable 正把表内弹层统一走 portal），不收口就会接着冒。

### 2. 为什么这一类会一直出现

「表面归属」在这个文件里有两处各写一份：删除时记焦点（`deletedFocusRef`）和撤销快捷键（`onUndo`），都用 `root.contains(target)`。React 的焦点 / 键盘事件沿 React 树冒泡（portal 里的也会冒到编辑器的 `onFocusCapture` / `onKeyDown`），DOM 包含却不认 portal。两种「归属」各说各话，每把一个弹层挪进 portal 就会少一块。

铁律：⑫ 点了=以为的——用户在菜单里点「删除」，以为 Cmd+Z 能撤回；`tests/ux/storyboard-delete-undo.test.mjs` 的 `immediate` 场景就是这条预期的确定性检查。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 菜单打开时按 Cmd+Z，撤销被忽略（键盘事件 target 在 portal 里） | 打开「⋯」菜单后按 Cmd+Z，看上一次删除是否恢复 |
| L-sbtable 把「用作…」等弹层迁到 portal 后，同样的删除 / 撤销链断掉 | 在迁移后的弹层里触发会删行的动作，再跑 `storyboard-delete-undo` |

### 4. 靶子独立性检查

靶子是既有的 `storyboard-delete-undo` 10 个场景（写于本线之前，不是这次的实现线写的）；它在 CI 上抓到了回归，靶子本身没问题。

### 5. P0

不是我们独有的能力，但也不需要新库：React 的事件本来就沿组件树冒泡，`onFocusCapture` 记下的元素就是「编辑器自己的焦点」。收口办法是两处判断共用同一个依据——「DOM 包含，或者就是编辑器 `onFocusCapture` 刚记下的那个元素」——不另写一套 portal 归属登记。

### 6. 结构性结论

- 编辑器表面归属只有一个判据：`root.contains(el) || el === lastEditorFocusRef.current`；删除记焦点与撤销快捷键都用它（本次两处一起改）。
- 后续把弹层挪进 portal 的线（L-sbtable）沿用同一判据，不各自加特例。
- 不涉及产品方向，属实现细节，协调会话自定；特征测试：`storyboard-delete-undo` 10 个场景全过。
