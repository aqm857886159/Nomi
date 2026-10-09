# 方向检查：连线总闸只挡了一部分入口（2026-10-10，I-edgecheck）

触发：`node scripts/fix-churn.mjs` 命中——`generationCanvasStore.ts` 近 14 天第 9 个 fix、`canvasGraphActions.ts` 第 6、`referenceEdgeCapability.ts` 第 3、`canvasDocumentCommit.ts` 第 6；自写登记 `canvas-undo-journal-write-boundary`（under-review）30 天内第 18 个。协调会话在任务书里明确要求写方向检查后继续，所以这份是「先复盘、再做结构改法」，不是又补一刀。

### 0. 一句话根因

「这条边合不合法」的规则只存在于渲染层，而「往画布写边」有十几扇门，规则只挂在其中几扇上——缺的是一道所有门共用、且主进程也能调的总闸。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 复审 2：MCP connect_canvas_edges 写出 video/audio → text | headless `canvasGraph.connectNodes` 只查端点 / 自环 / 重复 | 写边门没过总闸 |
| 复审 2：粘贴 / 拖动复制搬运非法边 | `state.edges = [...state.edges, ...cloned.edges]` 原样追加 | 同上 |
| 同源：组复制 / 复制为变体 / 模板落画布 | 同样的整条追加 | 同上 |
| 历史：手动连线 / Agent 各补一次校验（T8、B2 第 3 轮） | 每次发现一扇门就在那扇门补 | 同上（逐门补） |

### 2. 为什么这一类会一直出现

规则（`validateReferenceEdge`）和它依赖的 `connects` 表在渲染层，主进程 `check:boundaries` 不许 import 渲染层，于是 headless 路径天然没法调它；渲染层的整条追加又散在四个 action 里各写一遍。体验铁律归类：⑪「能选到」的反面——界面藏起来的东西，换个入口就能造出来。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 新加的写边入口（新 action、新 MCP 工具）又不过闸 | 在 `src` 里加一处 `state.edges = [...state.edges, x]`，看 `check:canvas-edge-writers` 红 |
| `connects` 表改了，主进程那份漂开 | 注册表引用 `NODE_KIND_CONNECTS`，只有一份 |

### 4. 靶子独立性检查

靶子是复审（Codex）给的探针，不是我们自己写的 oracle；探针（video/audio→text 纯函数、剪贴板）已原样做成测试。

### 5. P0：这些是我们独有的吗

领域判据（哪类卡收哪类素材）是我们独有的，且已经有唯一 owner（种类定义 `connects`）；没有通用库可接。自写登记 `canvas-undo-journal-write-boundary`（under-review）：本刀不动撤销日志本体，只是不让它成为新边的入口——撤销 / 重做仍只恢复原有边。

### 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 无适用的库 | — | — | 否（领域判据） |
| 补 | 在 MCP、粘贴各加一次判断 | 小 | 下一扇门还会漏 | 否 |
| 换（本刀） | 规则搬进 shared 一份；整条追加收口到 `appendAdmittedEdges`；headless / 外部写回调同一函数；门岗钉死写边名单 | 中 | 搬动 validateReferenceEdge 依赖 | **是** |
| 删 | 删注册表里 17 份 `connects` 字面量（改引用一张表）、删 renderer 里的规则副本 | 已含在「换」里 | — | 已做 |

### 7. 用户要权衡的核心

旧项目里已有的非法边：只保留（不删用户数据）+ 执行时忽略，还是要在界面上提示用户处理——提示怎么做，等协调会话拍板。

## 特征测试清单

先钉现状再改：`canvasEdgeAdmission.test.ts`（每个入口各一条非法边，视频→文本 / 声音→文本 / 剪辑→图片）已写在改动之前的红绿对照里，改回旧行为必红（已做变异校验）。
