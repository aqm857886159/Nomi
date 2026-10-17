# 方向检查：点卡出生成框这条链路（2026-10-16，卡顿波 P-compose）

> 触发：`node scripts/fix-churn.mjs` 命中 `nodes/NodeGenerationComposer.tsx`（14 天 5 个 fix，这刀第 6 个）、`nodes/BaseGenerationNode.tsx`（9 个）、`nodes/controls/`（目录 3 个）、`electron/preload/`（目录 6 个）、`assets/PromptEditor.tsx`（概念「TipTap 编辑器的唯一入口」3 个）。
> 用户 10-16 拍板：链路上一眼能定、框架明确的卡顿直接修，不等测量；结构性岔路只写对比交协调。

### 0. 一句话根因

本波共同类根因（_perf-method）：选中、显示这些高频路径上，各功能各自往里挂东西（同步 IPC、全量扫描、挂载时回写、整表订阅），既没有结构约束，也没有按操作计数的预算，所以每加一个功能就再慢一点，只在用户手里才被发现。
本概念的特化：**生成框是「每点一下卡就整套挂一次」的东西，但它的数据从来没有一个「挂之前就该在内存里」的家**——模型目录映射、素材库、默认值都是谁挂载谁去取，图的派生值是谁订阅谁整表扫。

### 1. 归类表：近 14 天命中热点的 fix → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| ee1368885 分组框头盖住生成框 / 847e0be3d 加节点条压生成框 | 叠层各写各的 z-index | 画布叠层（已收进层级表，不是本类） |
| ae5e686ef 剪辑面板与生成面板互斥 | 贴着节点的面板各自挂 | 节点浮层归属（不是本类） |
| 30dfd448a / ed77bae92 / b2e836859 / e48aa37e5 空节点档位、拉环、「+」菜单 | 节点壳的空态与交互规则 | 节点壳 UI（不是本类） |
| c9a2067c2 / 7a46a021f / 184ea8997 / dc21430cd 付费卡参考、价格文案 | 付费卡与画布节点两份真相 | 花钱卡归属（不是本类） |
| D-perf 可疑点 b–m（本刀） | 挂载时同步 IPC、全项目扫描、整表订阅、挂载回写、每次新建编辑器 | **挂载路径没有「数据先在内存里」的家，也没有计数预算** |

结论：热点是「生成框这个文件被很多概念共用」造成的，近 14 天的 fix 与本刀的卡顿不是同一个类；本刀不在任何一个旧 fix 上再补，而是给挂载路径补上它缺的那一层（内存里的数据 + 计数预算）。

### 2. 为什么这一类会一直出现

- 生成框 = 「选中才挂、取消就卸」。每个功能作者只看自己那一块，都觉得「挂载时取一次」是合理的；没人看见的是这一刻要同时做 3 份参数控件 × 每份各自取一次。
- 读图的派生值（必需模式、能不能生成、缺的伴随参考、未生成上游、@ 编号）每个都写成 `useStore((s) => f(node, s.nodes, s.edges))`——每次 store 写（别的卡的生成进度一秒好几次）都整表重算，算出对象的再 `JSON.stringify` 一遍防抖。
- 没有门：没有「挂载时 IO 次数 / store 写次数 / 无关写入重渲次数」的测试，`invokeSync` 在渲染进程里没有任何棘轮（35 条通道）。
- 三条体验铁律：不适用（这是性能类，不是「说的 / 摆的 / 点的」不一致）。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 项目数一多（真实用户 40+ 项目），点卡变慢，单项目夹具看不出 | `canvas-select-composer-image-100-many-projects` 对比 `canvas-select-composer-image-100` |
| 主进程一忙（视频在生成），点卡跟着卡 | 冒烟 ⑧ 里主进程往返峰值 200–360ms；`listMappings` 是 sendSync |
| 再加一个读图的派生值，又是一个整表选择器 | `composerMountBudget.test.tsx` 第 3 条（无关写入重渲 = 0）会红 |

### 4. 靶子独立性检查

- 尺子：D-perf 线的 perf 场景（毫秒，噪声大）+ 本线的计数测试（确定性）。计数测试是本线写的，所以修前必须先红，红的原因要和可疑点一一对得上（见 PR「计数修前 / 修后」）。
- 没有「修对了反而掉分」的先例。

### 5. P0：这些是我们独有的吗

都不是领域本身，全部接现成的框架能力：

| 问题 | 现成能力（出处） |
|---|---|
| 同步 IPC | Electron 官方：`sendSync` 会阻塞整个渲染进程，用 `invoke`（electron 43，docs/api/ipc-renderer.md、docs/tutorial/performance.md） |
| 数据在内存里、按事件失效 | React 19 `useSyncExternalStore`（getSnapshot 必须返回缓存的不可变值，react.dev reference/react/useSyncExternalStore） |
| 选择器只在相关数据变了才给新引用 | Zustand 4.5：默认 `Object.is` 比较，选择器返回稳定引用就不重渲（pmndrs/zustand v4 readme「Selecting multiple state slices」）；React Flow 性能指南同一条（reactflow.dev/learn/advanced-use/performance） |
| @ 素材按需取 | TipTap `@tiptap/suggestion` 的 `items` 官方允许返回 Promise（node_modules/@tiptap/suggestion/dist/index.d.ts:139） |
| 编辑器不随事务重渲 | TipTap 性能指南：`immediatelyRender: true` + `shouldRerenderOnTransaction: false`（tiptap-docs guides/performance.mdx）——仓库已经在 `useNomiTiptapEditor` 统一开着 |

### 6. 接入 / 补 / 重写 / 删 对比 + 推荐

本刀（A 类，直接做）：

| 可疑点 | 做法 | 档 |
|---|---|---|
| k 全项目素材扫描 | 一份进程内清单（`useAllProjectAssets.ts` 唯一 owner），打 @ 才取，素材写入广播失效；剪辑卡挂载不再扫 | 换（同提交删每实例扫描） |
| j / e 同步 IPC、首选等默认值 | 映射改 `invoke`，删 sync 通道；启动后后台载入目录 / 映射 / 默认模型 / 提示词库 | 换 + 删 |
| g / h / f 整表订阅、选择器遍历、3 份模型清单 | 一个「这张卡读得到的那一小片图」快照（依赖面签名不变就返回同一个引用），生成框算一次往下传 | 换 |
| i 挂载回写级联 | 回写只由一份控件做；已落好的卡 0 次写 | 补（见下方结构岔路） |
| l 每次新建编辑器 | 不随事务重渲已在；实例复用依赖结构岔路 B | 不动 |

**结构岔路（交协调，不在本刀做）**：

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| A 保持「每张卡各挂一个生成框」 | 本刀做完后挂载已是 0 IO、0 写（已落好的卡） | 每次点卡仍新建一份生成框和一个 TipTap 实例 | 低 | 先用 A，量完再定 |
| B 全画布共用一个生成框 | 生成框挂在画布层，跟着选中的卡换 `node`，编辑器 `setContent` 复用 | 改 BaseGenerationNode / 画布层 / 拖动隐身逻辑 / 列表详情宿主，跨 P-canvas 文件 | 中：未提交输入、撤销、拖动期间保实例这几条现有约定都要重证 | 等安静窗口 perf 数字：A 之后挂载仍超 100ms 预算才做 |
| C 新卡默认模型「建卡时一次写好」 | 默认模型 / 档案 / 比例在建卡门（工厂 + 画布 store 入口 + Agent 投影）一次写好，挂载 0 写 | 建卡门不止一个（含主进程工厂）；旧项目里没模型的卡仍要有人补 | 花钱边界：显示的模型 = 扣费的模型必须在每个门都成立 | 交协调定（见 P-compose 报告「交协调」） |

### 7. 用户要权衡的核心

点卡快不快，现在只剩「每次点卡都新建一份生成框」这一件结构成本；要不要为它动画布层（B），等安静窗口的真数字说话。

## 特征测试清单

- `src/workbench/generationCanvas/nodes/composerMountBudget.test.tsx`：挂载 0 IO、0 写、无关写入 0 重渲、新卡最多 1 写（修前红）。
- `src/workbench/generationCanvas/nodes/composerGraphSnapshot.test.ts`：依赖面签名不变 ⇒ 生成框读到的所有派生值不变（随机图 + 随机改动）。
