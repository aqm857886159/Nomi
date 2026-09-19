# #685 第二轮 Electron 截图

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：八态已通过且逐张人工复核。原始窗口 1280×933，真实设置切换主题，真实拖拽节点到 240px。

- [短提示词 light](short-light.png) / [dark](short-dark.png)
- [超长提示词 light](long-light.png) / [dark](long-dark.png)
- [拥挤空态 light](cramped-light.png) / [dark](cramped-dark.png)：推荐行只能分到 4px，四项全隐藏，更多保留在底栏。
- [窄节点 light](narrow-light.png) / [dark](narrow-dark.png)：推荐一行，输入 72px。
- [DOM 几何与 hit-test 读数](geometry.json)

复现：构建后运行 `node tests/ux/smoke.e2e.mjs`；新增验收在 `tests/ux/_composerFixedFooter.mjs`。所有输入、尺寸与主题变化由 UI 完成，evaluate 只读几何。

分组拥挤布局（点击前截图）：[1280×933](group-default.png) / [1680×1050](group-wide.png)。固定底栏完整；推荐项先隐藏，参考区只取扣除输入/底栏后的剩余高度，并可内滚访问模式控件。
