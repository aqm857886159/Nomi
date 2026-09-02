# 参考槽：声明上限不是有效上限，锚→槽是语义绑定

> 📎 教训 · 首次记录 2026-09-01 · 状态：现行
> **触发场景**：要显示「这个模型最多能接几张参考」时；要根据「第 N 张参考图」推断它是角色还是风格时；准备让 Agent 修改**已建好**节点的模型 / 模式 / 参数 / 参考时。

> 参考槽的**架构现状**（六种 slot kind、`ArchetypeMode.slots` 结构、`modeId` 决定显示、`AssetReference` 渲染器、`inputKey` → `archetypeInput` 映射链）以 [`../ARCHITECTURE-NOW.md`](../ARCHITECTURE-NOW.md) 的「模型参考槽」「参考槽渲染与请求体映射」两行为准——那些会随代码漂移，只在一处维护。本条只留**不随代码漂移的判断规则**。

**结论**：这套数据已经是声明式的、渲染器也已拍板存在，**别新建抽象**（2026-09-01 做分镜表设计时差点重造一遍）。真正会反复咬人的是下面三条——它们不是「代码在哪」，是「读这份数据时容易读错什么」。

## 坑一：声明上限 ≠ 有效上限

`slot.max` 是**档案声明的**上限；一个声明 `max: 9` 的槽，会被具体供应商的映射体静默压到 1。运行时的真实可达性另有一层（记录时是 `NodeParameterControls.tsx:157` 的 `slotReachByKey`，返回 `none / single / …`）。

**UI 要显示的是有效上限，不是声明上限**。直接渲染 `slot.max` 的后果是「显示能加、点了没反应」——撞设计系统 §1.6 C1 门岗。

## 坑二：锚 → 槽是语义绑定，不是位置绑定

`character_ref` / `style_ref` / `reference` 三种边模式**全部汇进同一个 `image_ref` 数组槽**，顺序由 `edge.order` 决定。只有 `first_frame` / `last_frame` 是独立具名槽。

所以「第 2 张参考图 = 风格参考」这种按下标推语义的写法**必错**。需要语义时读边模式（记录时在 `src/workbench/generationCanvas/agent/referenceEdgeCapability.ts`），不要数数组下标。

## 坑三：Agent 能建、不能改

Agent 的画布写入面是白名单 schema（记录时在 `electron/shared/agentCapabilities/canvasWrite.ts`，权限链在 `electron/harness/agentChatPolicy.ts`）。建节点时能设 `modelKey` / `modeId` / `params`；**建完之后，唯一能改节点自身的操作是 `set_node_prompt`**——没有 `set_node_model` / `set_node_mode` / `set_node_params` / `set_node_reference`。其余写操作（连边、整理、分镜、落轴、运镜、参考锚）都是**新建**，不是回头改已建节点的模型或参数。

要让 Agent 改已有节点的模型 / 模式 / 参数，**必须新增工具并同步权限链**——别假设它已经能改。这条随版本变动：**动手前先列一遍现有 operation**（`grep -n 'operation: z.literal(' electron/shared/agentCapabilities/canvasWrite.ts`），别照抄本文。

## 怎么用

- 显示任何「最多 N 个参考」之前，先过一遍运行时可达性，别渲染 `slot.max`。
- 需要「这张图是角色还是风格」时读边模式，不要数下标。
- 规划任何「让 Agent 调整已有节点」的功能前，先实扫 canvas-write 的 operation 列表，确认要的工具存不存在。

**出处**：2026-09-01 查实；2026-09-02 逐条复核后把架构事实搬进 `ARCHITECTURE-NOW.md`（`ArchetypeMode.slots` 行号由 93 修正为 92；canvas-write operation 面已扩到 8 个，但「建完只能改 prompt」仍成立）。相关：[`shot-table-is-a-projection-of-canvas-nodes.md`](shot-table-is-a-projection-of-canvas-nodes.md)。
