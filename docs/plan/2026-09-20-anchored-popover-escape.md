# 锚点浮层 Escape 所有权修复

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：已合入 main（PR #825，b5cf48bc0）；原失败来源 run 35470504652、job 105970540183。新 PR run 35473446279 的 Linux smoke、完整桌面旅程及性能检查通过。

## 症状与范围

Electron smoke 打开节点更多效果菜单后按 Escape，菜单连同节点编辑卡一起消失，下一次读取 composer 超时。CI failure.json 指向 `_composerFixedFooter.mjs:66`；截图节点仍在、无渲染错误，尺寸为 340×340。失败在首个 short/light 状态，尚未执行 resize，不能解释成媒体尺寸变化后坐标点空白。

只修共享 `AnchoredPopover` 对 Escape 的所有权，复用现有关闭回调、`overlayLayers` 的 popup/dialog 让位规则。消费事件必须早于 React Flow 节点的 React keydown，否则节点先取消选中；输入法组合期间不关闭。保留嵌套浮层先关、下一次 Escape 才关本层的语义。无视觉布局、项目数据、媒体尺寸或依赖升级变更。

## 先查别人

- 已读当前安装的 `node_modules/@xyflow/react/dist/esm/index.mjs:2299` NodeWrapper.onKeyDown（12.11.5）：非输入事件的 Escape 调用 handleNodeClick(unselect=true)。React Portal 仍可沿组件树传播到节点。
- 仓内 `src/design/AnchoredPopover.tsx:126` 的 document 冒泡监听仅 onClose；`src/design/useOverlayEscape.ts:27` 消费事件但同样是 document 冒泡，不能提前拦住 React NodeWrapper，不能直接替换后宣称修复。
- `src/design/overlayLayers.ts:98` / `src/design/overlayLayers.ts:169` 已有 `hasOpenDialogAbove`/`hasOpenPopupAbove`，复用它们。需让 dialog 判断使用浮层自己的 dialog 元素，避免把浮层内部的 role=dialog 误认为上层。
- `door-map.mjs src/design/AnchoredPopover.tsx` 输出七个消费者入口，合同保留机器门表。`src/workbench/generationCanvas/nodes/NodeEffectChips.tsx:53`、`src/workbench/creation/storyboard/shotRow/ShotComposerBar.tsx:349`、`src/workbench/assets/AssetPickerPopover.tsx:11` 均使用同一边界。

## 实施与验证

1. 在现有 `_feel.browser.mjs` 浏览器机制套件中挂真实 AnchoredPopover + React Flow，真实点击/按键记录焦点；修复前验证菜单 Escape 错误取消选中的红灯。
2. 共享关闭判据：焦点在 portal 外（如 trigger）时用 document capture，portal 内部用 React bubble，让子控件先执行并尊重 preventDefault/stopPropagation，再拦住 React Flow 祖先。上层 popup/dialog、defaultPrevented 和 isComposing 继续让位，不造调用方特例。
3. 增强 smoke：菜单关闭后明确断言菜单隐藏、composer 可见、原节点仍选中，不重新选中、不加 timeout。
4. 跑目标浏览器回归、合同校验、build 与真实 smoke；CI Linux 再验由父任务交付，不能把 macOS 本机绿冒认为 Linux 绿。

## 回滚与风险

回滚本次共享 handler 与回归改动即可；无需数据迁移。捕获期提前处理 Escape 可能影响嵌套控件，因此回归必须覆盖子 popup、更高 dialog、输入法、已消费事件和普通点外关闭。门岗/commit/push 由父任务统一完成。

## 红绿证据

- 修复前 Chromium 的 natural/trigger/menu-button 三条真实按键路径均取消节点选中（expected true, received false）。自然打开后焦点确实在 BUTTON Effects；输入框初挂时父浮层 visibility:hidden，声明 autoFocus 不等于实际获得焦点。输入框焦点、嵌套 popup/dialog、组合输入和已消费事件路径原先通过。
- 修复后同一浏览器机制测试九个子场景全部通过；既有普通点外关闭测试在画布之外的真实按钮执行，避免 React Flow 主动截断节点鼠标事件改变测试前提。
- 待补 build、完整 smoke 和最终父任务检查结果；Linux 首发失败仍需 CI 验证。

## 全量审计补充：内部控件优先权

初次捕获期修复只测试了派发前已经 defaultPrevented 的合成事件，漏掉真实输入框收到按键后才 preventDefault/stopPropagation 的路径。无条件 document capture 会使子控件完全收不到 Escape，违背既有控件取消编辑/清搜索语义。补真实 React input 两种处理及 native target listener 三个子例，先红后修。单一关闭判据拆事件路由：内部在 React portal bubble 阶段、外部在 document capture 阶段；内部 defaultPrevented 时仍阻断祖先但不关闭，stopPropagation 时自然到不了 portal。真实嵌套 popup/dialog、输入法与外点原矩阵保留。

- 第二轮对偶红测：上层 listbox/dialog 已打开、焦点仍在下层 input，首版 portal bubble 无条件 stopPropagation 会让上层 document listener 收不到 Escape；两条先红。最终共享判据返回是否属于本层，只有属于本层才停止 React 冒泡，尊重上层的关闭优先权。
- 最终 Chromium 矩阵 14 子场景全部通过（node:test 加父项统计 15）；日志 `/tmp/nomi-popover-input-escape-green.log`。内部 handler 三条旧版红灯见 `/tmp/nomi-popover-input-escape-red.log`，上层保焦两条见 `/tmp/nomi-popover-layer-focus-red.log`。
