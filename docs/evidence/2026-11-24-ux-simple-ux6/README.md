# PR-UX6 · 真实窗口验收

在基线 `8ac07cffb` 的隔离 Electron 窗口里，选中文稿后浮条宽 344 px，有四颗格式钮，三个分镜及生成动作的按钮文字均为空。空会话头部显示「—」，展开内容包含累计输入、累计输出和缓存命中三个零值。单击项目标题后，项目卡仍在，编辑器没有打开。[修前截图](before-zh-light.png)

## 创作者少做了什么

| 操作 | 修前 | 本次真窗结果 |
| --- | --- | --- |
| 从标题打开已有项目 | 点标题无反应，再点卡片才能进入，共两次点击 | 单击标题一次，核对同名项目和保存的两段正文 |
| 在库中改名 | 双击项目名进入编辑 | 一次点击铅笔进入编辑；键盘 Enter 也可进入，Escape 取消 |
| 将整篇文稿交给分镜规划 | 要先选择全文，再点选区分镜 | 已有正文时点右端按钮一次，即使只选中了末段，也送出两段 |
| 判断选中文字后要做什么 | 8 颗钮，其中 4 颗重复格式，3 个动作需要辨认图标或悬停 | 4 颗带文字的按钮，选段分镜与图片、视频节点按用途分组 |
| 插入表格、分隔线或行内代码 | 宽窗直接点格式钮 | 打开更多再选，共两次点击；腾出三个常驻位置 |
| 新会话查看用量 | 头部有一处空指标 | 首轮前隐藏，收到本地模型夹具返回的用量后显示 |

点击数按上述起点和路径计数。浮条收缩与文本裁切按浏览器布局读取，未测量人的决策用时。

## 截图

每格均来自桌面窗口。项目截图中的铅笔在悬停卡片时可见；打开后的截图在创作页展示重新读出的文稿。

| 语言、配色及内容区 | 空文稿与 Agent 头部 | 选区动作 | 工具栏与更多菜单 | 项目卡 → 打开 |
| --- | --- | --- | --- | --- |
| 中文浅色 · 1280×800 | [空态](zh-light-empty.png) | [选区](zh-light-selection.png) | [菜单](zh-light-toolbar.png) | [卡片](zh-light-library.png) → [正文](zh-light-opened.png) |
| 中文深色 · 1280×800 | [空态](zh-dark-empty.png) | [选区](zh-dark-selection.png) | [菜单](zh-dark-toolbar.png) | 同流程已断言 |
| 英文浅色 · 1280×800 | [空态](en-light-empty.png) | [选区](en-light-selection.png) | [菜单](en-light-toolbar.png) | 同流程已断言 |
| 英文深色 · 1280×800 | [空态](en-dark-empty.png) | [选区](en-dark-selection.png) | [菜单](en-dark-toolbar.png) | [卡片](en-dark-library.png) → [正文](en-dark-opened.png) |
| 中文浅色 · 1100×690 | [空态](zh-light-narrow-empty.png) | [选区](zh-light-narrow-selection.png) | [菜单](zh-light-narrow-toolbar.png) | [卡片](zh-light-narrow-library.png) → [正文](zh-light-narrow-opened.png) |

## 实际断言

- 用 `uiDriverOptions.mjs` 与 `launchNomiApp` 启动安静窗口，每轮使用系统临时目录下的独立资料。通过界面新建项目、输入两段、回到库中改名，用 Enter 保存，再次进入改名后用 Escape 取消。单击标题后验证项目名，进入创作页核对两段内容。
- 五种窗口下，空文稿时全文按钮禁用，输入后启用。占位提示含相应语言的全文按钮名。选中末段时测得中文浮条宽约 359 px，英文约 326 px。每个按钮均有可见文本，内容在按钮边界内；末钮到浮条右边缘均为 5 px。
- 五种窗口均打开菜单并实际插入表格、分隔线、行内代码，逐项读取正文元素并撤销。1100×690 下额外收起的格式项与三项低频格式共用一个菜单，行尾保留撤销、重做与全文分镜。
- 每次先确认 Agent 面板可见，再断言零用量的头部无用量控件。另一只隔离窗口启用本地回环文本模型，只选末段，点全文分镜。收到一个含两段正文的请求，对话出现一条含两段的用户消息，首轮结束后用量控件可见。付费调用为 0。
- 旧走查 `tests/ux/agent-v4-short-film.walk.mjs` 的冷启动断言仍要求空会话显示「—」，与本轮 #11 拍板冲突。按 #11 的文件边界保留该走查，空态与首轮实际行为由本次真窗及专项目标测试核对。

## 本地验证

构建、应用 TypeScript 检查、8 个 Vitest 文件的 129 个用例全部通过。独立运行 `rich-editor-p1.walk.mjs` 的 15 项检查全部通过。拍板图、控件、token、词表、测试文案、设计实验室 mirrors、概念登记、根因合同、自写登记和文件体积检查全部通过。

此基线将测试文案和设计实验室 mirrors 两项登记在 `scripts/pre-push-contracts.mjs`。本次分别运行 `node scripts/check-test-copy-literals.mjs` 和 `node scripts/check-design-lab.mjs --mirrors-only`。
