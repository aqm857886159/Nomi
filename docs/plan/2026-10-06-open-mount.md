# 设计卡 + 方向检查：打开项目「画布可见 → 节点挂上」与全选拖动余量

```
改动名：全选拖动时边组件不做贵派生（首挂段定位与残余）      线/负责人：L-perf      类别：[其他：性能]
```

来源：用户 10-05 反馈 #1「进项目卡」；逃逸 FB-20261005-01 一族（#1041 打开零写盘、#1044 Agent 运行时按需加载、#1045 占位扫光）。

### 功能分类
- [ ] 新界面 / 改交互（无外观、无交互变化）
- [x] 大数据量 / 画布 / 长列表
- [ ] 花钱 / 长跑 / 可打断 / Agent 行为 / 生成效果 / 数据格式

## 定位（开发版非压缩构建，只做定位）

I300 冷开「画布可见 → 节点挂上」约 0.8–0.95 秒里：

| 谁 | 约多少 | 结论 |
|---|---|---|
| react-i18next `useTranslation` 每个组件实例首挂都复制一遍 i18n 实例的全部属性描述符（`createI18nWrapper`，17.0.10 与最新 17.0.15 都如此） | 46ms 自身时间 | **不修**（见「残余」）：试过 pnpm patch 共享包装，900 个实例的压测 51–54 → 15–18ms，真实规模下省的比机器波动小，给第三方库背补丁不划算，已 revert |
| Agent 输入框 `useLayoutEffect` 量高度触发整页强制布局 | 74ms | **不修**：试过改成 ResizeObserver 首次回调，强制布局原样挪给了下一个在同一提交里读布局的人（Agent 对话流恢复滚动位置，103ms）。这是整页（刚挂上的 180 张卡）的第一次排版，迟早要付；大排版次数改前改后一样（各 2 次大于 15ms 的 UpdateStyleAndLayout）。要省只能把 Agent 面板和画布拆成两次提交——涉及打开流程的先后顺序，留作选项 |
| 模型目录 4 次同步 IPC（`modelCatalog.listVendors/listModels` 走 `invokeSync`，Agent 面板挂载时 reloadModels） | 30–40ms | **不在本刀**：同步 IPC 还有另外 5 处调用方依赖同步返回，改成异步要动 preload 契约；建议单列一刀 |
| React Flow 量节点（`updateNodeInternals` / `getHandleBounds`） | 约 30ms | 框架自身，必要 |
| 节点组件渲染与文案解析（`t()`） | 约 60–70ms | 已是逐节点必要工作 |

全选拖动（XL，选中 180、拖 250 下）剩下的脚本里，边组件 `GenerationFlowEdgeView` 占约 5.3 秒：每帧对每条连到被拖节点的边都按目标模型档案校验可选连线模式（`availableEdgeModes` 约 2.5 秒）、重新解析无障碍文案（约 1.9 秒）。**修**（见「改法」）。其余大头是浏览器渲染管线（640 条 SVG 边每帧重绘，样式 / 布局 / 绘制），本刀不动。

## 改法

边组件 `GenerationFlowEdgeView`：可选连线模式只在模式菜单打开时算；文案按真正依赖的值（两端标题、语言、聚合方向）useMemo。路径照旧每帧重算。无外观、无交互变化。

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 全选一大片卡拖动时跟手。不做：不改首挂、不拆打开提交、不改同步 IPC、不动 SVG 边的绘制方式。真实任务：XL（160 图 + 160 视频）全选拖动。 | `node tests/ux/canvas-performance-benchmark.e2e.mjs <label> --scale XL --scenario drag-nodes-all --runs 5 --warmup 1 --exe release/win-unpacked/Nomi.exe`（`NOMI_PERF_OFFSCREEN=1`） |
| ★2 谁说了算 | 边的可选模式 owner 仍是 `edgeModeMenu.availableEdgeModes`，只改调用时机；边组件唯一注册点 `edgeTypes`。 | `node scripts/door-map.mjs availableEdgeModes` |
| ★3 一致与复用 | React `useMemo`，没有第二份定义。 | — |
| ★4 全状态 | 无界面变化：文案、菜单内容、换语言行为都不变。 | 单测 |
| ★9 验收与回滚 | 验收：同机打包版拖动基准改前改后各 5 次（紧挨着连跑）；`edgeViewDragCost.test.ts`。回滚：revert 实现提交。 | PR `## 测试` |

## 方向检查（14 天三次）

触发：`src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlowNodes.tsx` 14 天 5 个 fix（含本线 #1041 的两个）。

- **一句话根因**：拖动热路径上的组件把「只依赖节点数据」的派生放在「每帧都会重跑」的渲染函数里；节点外壳上次用 memo 隔开了坐标，边组件因为坐标就是它要画的东西、隔不开，派生就得自己挪出渲染路径。
- **会冒出什么**：下一个往边组件里加的派生又会每帧跑 → `edgeViewDragCost.test.ts` 按边类型登记表逐个核（菜单没开时不许调档案校验）；更一般的「渲染里不做只依赖数据的贵派生」靠评审，测试只钉住已知的那条贵路径。
- **P0**：useMemo 是 React 标准做法；i18n 那一项不打补丁，留给上游（见残余）。
- **用户要权衡的核心**：无（无外观、无交互变化）。

## 特征测试清单

- `src/workbench/generationCanvas/reactFlow/edgeViewDragCost.test.ts`（新）：edgeTypes 登记表遍历。
- 既有：`src/i18n`、`src/workbench/ai/v4`、`src/workbench/generationCanvas/reactFlow` 单测全过。

## 残余（不在本刀）

- **react-i18next 每实例复制 i18n**：上游 `useTranslation`（17.0.10，最新 17.0.15 同样）给每个组件实例首挂都 `Object.getOwnPropertyDescriptors(i18n)` 建一个包装，只为让包装身份随语言变化。可以按（实例, 语言）共享。打开大项目首挂里约 46ms。可考虑向上游提 issue（发不发由协调会话问用户）。
- **整页第一次强制排版**：Agent 输入框 / 对话流在与画布同一次提交里读布局，排版被提前强制；是迟早要付的第一次排版，要省需拆开 Agent 面板与画布的挂载提交（打开流程先后顺序，另议）。
- **模型目录同步 IPC**：Agent 面板挂载时 4 次 `invokeSync`（约 30–40ms），另有 5 处调用方依赖同步返回，另议。
- **拖动剩下的渲染管线成本**：640 条 SVG 边（每条还有 30px 透明命中路径）每帧重绘、样式 / 布局 / 绘制，本刀不动。
- **打开路径端到端**：今天这台机器同一份构建两轮之间相差 0.3–0.4 秒，首挂段的改动（几十毫秒级）在噪声内，不报端到端数字。
