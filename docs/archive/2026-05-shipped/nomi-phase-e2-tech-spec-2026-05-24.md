# Phase E.2 技术执行文档（CTO 视角）

日期：2026-05-24
版本：v1
状态：施工蓝图，开工前请确认
依赖：
- `nomi-mura-architecture-decision-2026-05-24.md` (产品决议)
- `nomi-canvas-architecture-comparison-2026-05-24.md` (方案对比)
- `nomi-long-form-scale-audit-2026-05-24.md` (P0 优先级)

> 本文档以 CTO 视角回答 3 个问题：
> 1. 我们要做的功能是什么（产品 + 视觉规范）
> 2. 当前技术栈能不能扛得住（5-10 年视角）
> 3. 怎么拆任务，executor 怎么干

---

## 0. 使用说明（开工先读）

每次开工前**必须**：
1. 通读 §1（总览）+ §6（任务清单）
2. 检查 §9（进度跟踪）确认下一个未完成 task
3. 按 task 顺序执行，**绝不跳跃**
4. 每个 task 一个 commit
5. 所有 task 完成后 spawn 独立 audit agent

红线：
- 🚫 不跳 task / 不跳 audit / 不混 commit
- 🚫 不动 Phase A-E 已 ship 的代码（除 task 明确要求）
- 🚫 不删任何东西不登记 §10 清理清单
- 🚫 视觉与 Mura 不一致时**先问，再动**（命名除外，下面 §2 已 lock）

---

## 1. 总览

### 1.1 我们要交付什么

**v0.6.0 — 5 个固定分类 + 用户自建子组 + 跨分类独立复制 + 派生标签 + Mura 视觉**

让 Nomi 项目从「一张大白板上扔便利贴」升级成「带抽屉柜的工作室」：用户的角色、场景、道具能在当前项目内按分类整理；拖到另一分类时创建独立副本，避免一处改动影响另一处；画布上的资产能左右两侧（目录 + 画布）双向操作，AI 生成自动留下血缘记录。

### 1.2 范围

✅ 在范围内：
- 5 个固定大分类（**分镜 / 角色 / 场景 / 道具 / 声音**）
- **目录树仅在生成区显示**，创作 / 预览 step 不显示（用户最新决议）
- 每分类独立子画布（独立 viewport + selection）
- 用户可在每个大分类内**手动建子组/文件夹**（1 层，不嵌套）
- 节点**只属于一个分类**；拖到另一分类时创建独立副本（新 id），不做多分类挂载
- 节点的 `derivedFrom` 派生元数据 + UI 角标
- 左右双向同步（左侧目录拖入 = 右侧画布框入；反向亦然）
- Cmd+C/V 真复制；拖到另一分类 = 独立复制（复制当前图片 / prompt / metadata，新 id）
- 删除语义：删除当前节点；跨分类副本互不影响
- 视觉照 Mura 原型（命名调整见 §2）
- **v0.5 老节点中 categoryId 属于已废除 4 个分类（故事/风格/资源池/导出）的，直接删除**（用户最新决议 — 老 user base < 20 人，不需要兜底归档）

❌ 不在范围内（推到 Phase F/G）：
- 用户自建大分类（5 个固定）
- 节点父子层级（已决定不做）
- Nomi Script 结构化创作（Phase F）
- 关系图谱可视化（Phase G）
- AI 自动归类（明确说"不做"）
- 跨项目资产复用（Phase H / v0.8）

### 1.3 工期

约 **2 周**（10 个工作日），分 4 个 wave：

| Wave | 内容 | 工期 |
|---|---|---|
| W1 | 数据模型 + Zustand 重构 | 2-3 天 |
| W2 | Sidebar 树视图 + 跨分类拖拽 | 3 天 |
| W3 | Canvas 组框 + 双向同步 + 复制/删除 | 3 天 |
| W4 | 迁移 + 测试 + 视觉打磨 | 2 天 |

---

## 2. Mura 视觉对齐与命名调整

锁定（与 Mura 不同的命名 / 细节）：

| Mura 原型 | Nomi 采用 |
|---|---|
| 画面 (shots) | **分镜** (id: shots) |
| 角色 (cast) | 角色 (id: cast) |
| 场景 (scene) | 场景 (id: scene) |
| 道具 (prop) | 道具 (id: prop) |
| 声音 (audio) | 声音 (id: audio) |

视觉对齐的关键点（**严格照 Mura**）：

| 元素 | Mura 规格 | Nomi 实现要点 |
|---|---|---|
| Sidebar 收起 | 60px 宽，仅图标 + count 徽标 | 复用现有 CategorySidebar，已基本对齐 |
| Sidebar 展开 | ~200px，图标 + 名称 + count | 同上 |
| 分类图标 | 拼接 SVG（每个 1.5 stroke） | 用 `@tabler/icons-react` 替代（一致风格） |
| Sidebar 树展开 | 大分类下点 ▶ 展开看子组 + 节点 | **新增** — 需开发 tree expander |
| 顶部 stepper | "创作 / 生成 / 预览" 三段，hint 文案 + 数字徽标 | 复用现有 NomiStepper（已对齐） |
| 节点：分镜 frame | 图像区 + 内嵌 composer（textarea + 模型 chip + 比例 chip + 生成按钮）| **改造** — 现节点 composer 仅选中时浮出 |
| 节点编号 | "分镜 01" / "分镜 02" 自动 | **新增** — 按 (categoryId, position-or-edge-order) 计算 |
| 节点占位态 | 灰底 + "{分类名} NN" + "等待生成" | **改造** — 当前是棋盘背景 |
| 组框 (canvas frame) | 浅色半透明背景 + 左上角组名标签 | **新增** — 像 Figma Frame |
| 节点间连线 | 虚线贝塞尔（next frame's left → current's right） | 已实现（generationCanvasStore edge 渲染） |

不照 Mura 的部分：
- **命名**：分镜 vs 画面（用户决定保留 Nomi 习惯）
- **图标库**：Tabler vs 手绘 SVG（用 Tabler 更工程化）
- **顶部 AppBar**：保留 Nomi 现有（NomiBrand + 项目名 + Stepper + 模型接入 + 素材库 + 导出）

---

## 3. 当前技术栈 CTO 审视

### 3.1 现状全景

| 层 | 技术 | 当前版本 | 业界 2026 主流 | 评估 |
|---|---|---|---|---|
| **桌面壳** | Electron | 31.7.7 | Electron 33+ / Tauri 2 | ⚠️ Electron 主流，Tauri 2 是替代但 Rust 学习曲线高 |
| **UI 框架** | React | 18.3.1 | React 19 | ⚠️ 可升 19（Actions / useOptimistic 对画布有用） |
| **构建** | Vite | 5.4.8 | Vite 6 | ✓ 升 6 小幅收益 |
| **TS** | TypeScript | 5.6.3 | TS 5.7+ | ✓ 升次要版本 |
| **状态管理** | Zustand | 4.5.4 | Zustand 5 / Jotai / Valtio | ✓ Zustand 5 类型更好但 4 够用 |
| **编辑器** | TipTap | 3.22.5 | TipTap 4 | ⚠️ 4 拆包优化，升级有兼容风险 |
| **AI SDK** | Vercel AI SDK | 4.3.19 | AI SDK 5 / Mastra | ✓ 4 是 Phase A-D 基石，5 还在 RC，先不动 |
| **Tailwind** | Tailwind CSS | 3 | Tailwind 4 | ⚠️ 4 重写，升级需大改 |
| **UI Kit** | Mantine | 7 | Mantine 7 (current) | ✓ |
| **图标** | Tabler / Lucide | 3.19 / 1.16 | 同上 | ✓ |
| **路由** | React Router | 7.9.6 | React Router 7 / Tanstack Router | ✓ |
| **状态/缓存** | SWR | 2.4.1 | SWR / Tanstack Query | ⚠️ Tanstack Query 在长任务上更好 |
| **不可变** | Immer | 11.1.8 | Immer | ✓ |
| **测试** | Vitest | 2.1.9 | Vitest 3 | ✓ 可升 |
| **持久化** | JSON 文件 | - | SQLite (better-sqlite3) / JSON | ⚠️ 长片项目 JSON 性能瓶颈 |

### 3.2 CTO 视角的几个判断

#### 判断 1: 暂时不要升 React 19

虽然 React 19 的 Actions / useOptimistic 对画布有用，但：
- 当前已稳定的 React 18 + Suspense 在 v0.5 跑得很好
- 升级带来的 breaking change（StrictMode 双 effect、CommonJS 边界）会让本次 Phase E.2 多花 1-2 天处理
- **本次专注产品功能，技术升级单独排到 v0.7 backlog**

#### 判断 2: 不迁 Tauri

Tauri 2 的 30x 包体积优势（5MB vs 150MB）听起来诱人，但：
- 整个 Nomi 后端 (`electron/runtime.ts` 2000+ 行) 是 TS，迁 Tauri 要么继续 TS（用 sidecar）要么改 Rust（重写成本极高）
- Phase A-D 的 AI SDK 集成是 TS 原生 — Tauri 跨 Rust/TS 边界增加 IPC 复杂度
- 现在 user base 还小，包体积不是核心痛点
- **6 个月后用户反馈 + 长片场景跑通后再评估**

#### 判断 3: 持久化层留一手

现在 `~/Documents/Nomi Projects/{id}/project.json` 单文件 + `assets/` + `logs/` 够用。

长片场景（100MB+ JSON）会撞到：
- 每次保存重写整个文件 → 慢
- 启动时一次性 parse → 慢
- 没有索引 → 任何"按 categoryId 搜节点"都是 O(n)

**未来路径**（不在本 Phase）：
- 引入 `better-sqlite3` 作为索引层
- 主数据仍存 JSON（人可读，可 Git 化），索引用 SQLite 缓存
- 启动时 lazy-load + 按需 hydrate

**现在不做的理由**：
- 当前 user base 极少做大项目
- 增加 sqlite 依赖增加桌面包体积 + native 编译复杂度
- 等长片用户反馈再做 — **避免过早优化**

#### 判断 4: 增加 dnd-kit (本 Phase 必需)

Phase E.2 涉及大量拖拽：
- 节点拖到 sidebar 另一分类 → 创建独立副本
- sidebar 节点拖入子组文件夹 → 加组
- canvas 组框拖动 → 整组移动
- sidebar 文件夹拖动 → 重排顺序

当前没有 dnd 库。手写 HTML5 DnD 复杂度高、跨浏览器一致性差。

**引入 `@dnd-kit/core` + `@dnd-kit/sortable`**（业界标准，Atlassian、Figma 都在用）：
- 体积 ~30KB gzipped
- 可访问性内建（键盘 / 屏幕阅读器）
- 已稳定（v6.x）

#### 判断 5: SWR → Tanstack Query

当前 SWR 用于 `useLocalProjects`。长片场景下需要：
- 取消进行中的查询（用户切项目）
- 乐观更新 + 回滚（生成失败时）
- 缓存细粒度控制

Tanstack Query (v5) 在这些场景明显更优。

**但不在本 Phase 切换** — 把它列到 v0.7 backlog。SWR 现在够用。

#### 判断 6: 不引入新前端框架 / meta 工具

我看了 Bun / Biome / 等新工具，结论：
- Bun: 启动快但 Electron 集成有边界问题，etc。**不切换**
- Biome: 替代 ESLint+Prettier，速度快但生态小。**v0.7 评估**
- 当前 vite + vitest + tsc 工具链已稳定

**核心原则**：本 Phase 不做技术栈升级，专注产品功能落地。技术升级列入 Phase E.3 / v0.7 单独评估。

### 3.3 本 Phase 要新增的依赖

仅 1 个：

```jsonc
{
  "dependencies": {
    "@dnd-kit/core": "^6.1.0",
    "@dnd-kit/sortable": "^8.0.0"
  }
}
```

`@dnd-kit/modifiers` 可能也要（限制拖拽方向）。

无后端 / 持久化 / 网络层变化。

---

## 4. 数据模型设计

### 4.1 当前 (v0.5.0)

```typescript
type GenerationCanvasSnapshot = {
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
  selectedNodeIds: string[]
}

type GenerationCanvasNode = {
  id: string
  kind: GenerationNodeKind
  categoryId: string              // 单分类 tag
  position: { x, y }
  result?, history?, meta?, ...
}
```

### 4.2 v0.6.0 提议

```typescript
type GenerationCanvasSnapshot = {
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
  groups: NodeGroup[]                          // ★ NEW
  selectedNodeIds: string[]
  categoryViewports: Record<CategoryId, Viewport>  // 已存在 (E3) — 保留
}

type CategoryId = 'shots' | 'cast' | 'scene' | 'prop' | 'audio'  // 5 个固定

type GenerationCanvasNode = {
  id: string
  kind: GenerationNodeKind
  categoryId: CategoryId        // ★ KEEP — 单分类归属；跨分类拖拽创建独立副本，不共享数据
  groupId?: string                // ★ NEW — 节点所在组（每分类独立判断由 groups 表反向查）
                                  // 实际通过 groups[].nodeIds 反查，这里 redundancy 留 cache
  derivedFrom?: string             // ★ NEW — 派生自哪个 nodeId（只读 metadata）
  position: { x, y }
  // ... existing fields
}

type NodeGroup = {                 // ★ NEW
  id: string                       // group-{uuid}
  name: string                     // "第一幕" / "小苏表情包"
  categoryId: CategoryId           // 组归属哪个大分类
  nodeIds: string[]                // 成员节点 id 列表，按用户顺序
  color?: string                   // 可选：组框颜色
  frameBounds?: { x, y, w, h }     // 可选：canvas 上 frame 的位置/大小（拖动后存）
  collapsed?: boolean              // sidebar 中是否折叠展示
  createdAt: number
  updatedAt: number
}
```

### 4.3 关键设计点解释

#### 为什么保留 `categoryId: string`，不做 `categoryIds: string[]`

用户最新决议：**一张图拖到另一个分类时，要变成独立副本，不是同一份数据多处挂载**。

典型例子：小苏角色卡复制到分镜分类后，角色里的小苏和分镜里的小苏是两张独立图。后续改角色卡 prompt，不应自动改分镜里的图；改分镜里的构图 prompt，也不应污染角色资产。

因此节点保持单分类归属：
- 拖到另一分类：创建新 node（新 id），复制当前 `prompt / result / history / meta` 等必要字段
- 新副本可用 `derivedFrom = source.id` 标记来源，但只是只读血缘，不做同步
- 查询当前分类：`nodes.filter(n => n.categoryId === activeCategoryId)`，语义简单，删除也简单

#### 为什么 group 单独表而不是 `node.groupId`

- 一个组有 name / color / frameBounds 等元数据，挂在节点上冗余
- 组是 first-class entity（用户能直接操作"组"，比如改名 / 拖动整组 / 删除组）
- 反查"该组包含哪些节点" → 用 `groups[].nodeIds`
- 反查"该节点在哪个组" → 用 index Map<NodeId, GroupId>（运行时构建）

#### 为什么 `derivedFrom: string` 不是 array

派生关系是 1:N（一个源 → 多个变体），不是 M:N。每个变体只有一个直接源头。

如果以后要做"基于 V1 和 V2 混合生成 V3"，再升级为 `derivedFromIds: string[]`。

#### 为什么不做 group 嵌套

- 嵌套 = 树形 = 上一轮决议否决了
- 1 层组已经能满足"小苏表情包" / "第一幕镜头" 这种典型需求
- 嵌套需求出现时再讨论（很可能不会出现）

### 4.4 v0.5 → v0.6 数据迁移

**用户决议：旧节点直接删除，不兜底归档。**

理由：当前阶段尚无真实客户/生产数据依赖，因此**不需要为 v0.5 旧分类做向后兼容或数据保留**。这不是降低最终产品质量要求；v0.6 完成后的新项目数据模型、删除语义、持久化恢复必须稳定可靠。归档组兜底反而增加实现复杂度和用户清理负担。直接删，干净。

迁移函数：

```typescript
function migrateProjectV5ToV6(payload: ProjectPayloadV5): ProjectPayloadV6 {
  const KEEP: Set<string> = new Set(['shots', 'characters', 'scenes', 'audio'])
  const KIND_MAP: Record<string, CategoryId> = {
    shots: 'shots',
    characters: 'cast',
    scenes: 'scene',
    audio: 'audio',
    // story / style / inbox / exports → 不在 KEEP，会被过滤
  }
  
  const survivingNodes = payload.generationCanvas.nodes
    .filter(node => KEEP.has(node.categoryId))
    .map(node => ({
      ...node,
      categoryId: KIND_MAP[node.categoryId],
    }))
  
  const survivingEdges = payload.generationCanvas.edges
    .filter(edge => {
      const validIds = new Set(survivingNodes.map(n => n.id))
      return validIds.has(edge.source) && validIds.has(edge.target)
    })
  
  // 道具 (prop) 分类无任何旧节点对应 — 它是新引入的
  
  return {
    ...payload,
    generationCanvas: {
      ...payload.generationCanvas,
      nodes: survivingNodes,
      edges: survivingEdges,
      groups: [],  // 老项目没有 groups
    },
  }
}
```

**Migration toast**：弹一次性提示（仅面向开发期/内部旧项目）
> 项目升级到 v0.6.0。已删除旧版"故事/风格/资源池/导出"分类下的 N 个节点。

**用户操作路径**：
- 用户接受 → 继续工作
- 不提供正式用户级回滚路径；当前无真实客户，不为旧版本兼容增加产品复杂度
- 开发/内部调试如需找回旧数据，可从 `cache/backup-pre-migration-*.json` 手动恢复（v0.5 Phase E 已建的备份机制）

---

## 5. 状态管理 (Zustand) 重构

### 5.1 当前 store 树

```typescript
// src/workbench/generationCanvas/store/generationCanvasStore.ts
useGenerationCanvasStore = {
  // state
  nodes: [...]
  edges: [...]
  selectedNodeIds: [...]
  // actions
  addNode, updateNode, removeNode, ...
}
```

### 5.2 v0.6.0 提议

新增 actions + 索引（不重构 store 结构）：

```typescript
useGenerationCanvasStore = {
  // existing state
  nodes, edges, selectedNodeIds, categoryViewports,
  // NEW state
  groups: NodeGroup[],
  
  // NEW computed/derived (selectors, not state)
  // 用 zustand subscribeWithSelector + memoization
  // — Map<CategoryId, NodeId[]> — fast category → nodes lookup
  // — Map<NodeId, GroupId | null> — fast node → group lookup
  // — Map<GroupId, NodeId[]> — group → nodes (sorted by user order)
  
  // NEW actions
  duplicateNodeToCategory(nodeId, categoryId), // 跨分类独立复制（新 id）
  moveNodeToCategory(nodeId, categoryId),      // 可选：显式移动，不保留源分类副本
  createGroup(categoryId, name, nodeIds),    // 建组
  renameGroup(groupId, newName),
  addNodeToGroup(nodeId, groupId),
  removeNodeFromGroup(nodeId),
  deleteGroup(groupId, strategy: 'keep-nodes' | 'delete-nodes'),
  moveGroupBounds(groupId, bounds),          // 拖动组框
}
```

### 5.3 衍生 selector

用 `subscribeWithSelector` 中间件 + `useMemo` 在组件层做：

```typescript
function useNodesInActiveCategory() {
  const { nodes, activeCategoryId } = useWorkbenchStore()
  return useMemo(
    () => nodes.filter(n => n.categoryId === activeCategoryId),
    [nodes, activeCategoryId]
  )
}
```

避免每次渲染 filter，未来如有性能问题再上 Reselect / Tanstack Store。

---

## 6. 任务清单 (Phase E.2)

按依赖顺序，每个一 commit。

### Wave 1: 数据模型 + 迁移 (W1)

#### Task E.2-1: 类型 + Zod schema 升级
- 修改 `src/workbench/generationCanvas/model/generationCanvasTypes.ts`：
  - 保留 `categoryId: CategoryId` 单分类字段（不引入 `categoryIds[]`）
  - 明确跨分类拖拽创建独立副本，不做多挂载
  - 加 `derivedFrom?: string`
  - 加 `NodeGroup` 类型
  - 加 `groups: NodeGroup[]` 到 snapshot
- 修改 `src/workbench/generationCanvas/model/generationCanvasSchema.ts`：
  - 同步 Zod schema 更新
- 提交：`feat(canvas): extend schema for groups and source metadata`
- 验收：tsc 通过 + vitest 不挂

#### Task E.2-2: Migration v5 → v6
- 新建 `src/workbench/project/projectV5ToV6Migration.ts`
- 在 `projectPersistenceService.hydrateProject` 里调用
- 迁移逻辑见 §4.4
- 旧节点 `categoryId` 映射到新的 5 分类 `categoryId`
- 旧 4 个废除分类（story/style/inbox/exports）下的节点**直接删除**，不做归档组、不保留兜底数据；原因是当前无真实客户，不需要兼容旧版本，而不是允许 v0.6 新数据出问题
- 提交：`feat(project): migrate v0.5 8-category projects to v0.6 5-category + groups`
- 验收：测试覆盖保留分类映射、废除分类节点过滤删除、失效 edge 清理、migration toast 计数

#### Task E.2-3: Built-in categories 调整
- 修改 `src/workbench/project/projectCategories.ts`：
  - 从 8 个改成 5 个：shots（分镜）/ cast（角色）/ scene（场景）/ prop（道具）/ audio（声音）
  - **彻底删除** story/style/inbox/exports 的 built-in 定义（不保留兼容字段，迁移时已处理）
- 修改 Mura 风格图标（Tabler 选 5 个）
- 提交：`refactor(project): collapse to 5 fixed top-level categories`

#### Task E.2-3b: Sidebar 挂载点下沉到生成区
- 修改 `src/workbench/WorkbenchShell.tsx`：**移除** `<CategorySidebar />` 挂载（line 104）
- 修改 `src/workbench/generation/GenerationWorkspace.tsx`：在 main 区域**新增** `<CategorySidebar />` 挂载
- 创作 step (CreationWorkspace) 与预览 step (PreviewWorkspace) 不再渲染 sidebar
- 创作 + 预览 step 的 body 重新获得全宽
- 提交：`refactor(workbench): mount category sidebar only inside generation step`
- 验收：3 个 step 切换时仅生成 step 显示左侧目录树

### Wave 2: Sidebar 树视图 (W2)

#### Task E.2-4: 安装 dnd-kit
- `pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/modifiers`
- 提交：`chore: add dnd-kit for drag-and-drop`

#### Task E.2-5: Sidebar 树渲染
- 重构 `src/workbench/sidebar/CategorySidebar.tsx`：
  - 大分类 → 可展开 ▶
  - 展开后渲染：散装节点列表 + 子组（折叠态/展开态）
  - 子组展开看成员节点
- 新建 `src/workbench/sidebar/GroupItem.tsx`
- 新建 `src/workbench/sidebar/NodeItem.tsx`（sidebar 中的节点行）
- 提交：`feat(sidebar): tree view with groups and nodes`

#### Task E.2-6: Sidebar 拖拽
- 拖节点到另一个大分类 sidebar 行 → 创建独立副本（新 id），复制当前图片 / prompt / metadata，并用 `derivedFrom` 标记来源
- 拖节点到子组文件夹 → 加入组
- 拖节点出子组 → 离开组
- 拖子组到大分类内重排 → 改顺序
- 提交：`feat(sidebar): drag-and-drop for cross-category + group membership`

#### Task E.2-7: Sidebar 右键菜单
- 节点行右键："复制 / 重命名 / 派生重新生成 / 删除"
- 子组行右键："重命名 / 改颜色 / 解组(保留节点) / 删除(连节点)"
- 大分类右键："新建子组"
- 提交：`feat(sidebar): context menus for nodes / groups / categories`

### Wave 3: Canvas 组框 + 双向同步 (W3)

#### Task E.2-8: Canvas 组框渲染
- 新建 `src/workbench/generationCanvas/components/GroupFrame.tsx`
- 计算 groupBounds：包围所有成员节点 + 内边距
- 渲染：浅色背景 + 边框 + 左上角标签
- 提交：`feat(canvas): render group frames around member nodes`

#### Task E.2-9: Cmd+G / Cmd+Shift+G
- 选中多节点 + Cmd+G → 创建组 + 名字默认 "组 N"，可重命名
- 选中组 + Cmd+Shift+G → 解组（保留节点）
- 提交：`feat(canvas): keyboard shortcuts for grouping`

#### Task E.2-10: 组框拖动联动
- 拖组框 = 所有成员节点一起 translate
- 用 dnd-kit 处理（或现有 pointer event 系统扩展）
- 提交：`feat(canvas): drag group frame to move all members`

#### Task E.2-11: 双向同步（左右联动）
- 用 zustand subscribe 机制
- 任何 group 变化（add/remove/rename）→ sidebar 和 canvas 同步
- 任何 node 加入/退出组 → 两侧同步
- 提交：`feat(canvas): bi-directional sync between sidebar and canvas`

#### Task E.2-12: 复制粘贴
- Cmd+C/V 实现：
  - 单节点：复制成新 node（新 id，position 偏移）
  - 多节点（含可能的组）：所选范围复制，所有副本生成新 id
  - 组复制：组 + 成员节点都复制
- 跨分类粘贴 = 新 node 的 `categoryId` 设为目标分类；源节点不受影响
- 提交：`feat(canvas): copy/paste nodes and groups`

#### Task E.2-13: 删除策略
- canvas / sidebar 删除按钮：
  - 无组 + 无 derived children → 直接删
  - 在某组 → 默认先移出组；二次删除再删节点
  - 跨分类复制出来的副本是独立节点，删除当前节点不影响其他分类副本
  - 有 derived children 时提示会断开血缘引用，确认后再删
- 提交：`feat(canvas): delete strategy for independent copies and groups`

### Wave 4: 派生标签 + 视觉 + 测试 (W4)

#### Task E.2-14: derivedFrom 自动建立
- 修改 `generationRunController.ts`：
  - 用户点 "基于此重新生成" → 新 node 设 `derivedFrom = source.id`
  - 用户点 "+ 新建空节点" → derivedFrom 留空
- 提交：`feat(canvas): auto-set derivedFrom on variant generation`

#### Task E.2-15: derivedFrom UI 角标
- 节点卡片右下角："↩ 由 [name] 派生"
- 点击高亮原节点（在 canvas 滚到位置 + 闪烁）
- 在 sidebar 节点行有同样小角标
- 提交：`feat(canvas): derivedFrom badge with jump-to-source`

#### Task E.2-16: 节点 composer 内嵌 (Mura 视觉)
- `BaseGenerationNode.tsx`：composer 从悬浮改为永久内嵌
- 高度增加（v0.5 ~140px → Mura ~280px）
- 占位态："等待生成" 标签（去棋盘背景）
- 提交：`feat(canvas): inline composer (Mura visual)`

#### Task E.2-17: 节点自动编号
- 节点头部显示 "分镜 01" / "分镜 02" 等
- 编号规则：按 (categoryId, position-or-edge-order) 计算
- 用户拖动节点时编号自动更新
- 提交：`feat(canvas): auto-numbering for shot nodes`

#### Task E.2-18: 单元测试 (≥ 20 个新 case)
- migration v5→v6 测试 (8 个旧分类全覆盖)
- groups CRUD
- independent cross-category copies
- derivedFrom chain
- delete strategy（组内 / 独立副本 / 含 children）
- copy/paste
- 提交：`test(canvas): cover Phase E.2 P0 logic`

### Wave 5: 升版 + 发布

#### Task E.2-19: 版本号 + release notes
- `package.json` 0.5.0 → 0.6.0
- 写 release notes
- 提交：`chore: bump desktop version to 0.6.0`

#### Task E.2-20: 完整集成测试
- 手动 / 自动跑：
  - 新建项目 → 5 分类显示
  - 生成 3 个分镜节点 → 选中 2 个 Cmd+G → 组框出现 + sidebar 文件夹出现
  - 拖角色侧栏小苏到分镜侧栏 → 分镜生成一张独立副本（新 id），两处都可见但互不共享
  - 改角色小苏 prompt → 分镜副本不变；改分镜副本 prompt → 角色原图不变
  - "基于 V1 重新生成" → 新节点带 derivedFrom 角标
  - 删除组（保留节点）→ 节点散落
  - 删除组（连节点）→ 节点全删
  - 重启 → 状态完整恢复
- 提交：`chore: phase E.2 integration test pass`

---

## 7. 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| 跨分类复制后用户误以为仍会同步 | 中 | 拖拽完成 toast："已复制到分镜，后续改动互不影响"；副本角标显示来源但不显示同步状态 |
| 组框拖动时性能（成员节点多）| 中 | 拖动时 batch update，结束时一次 commit |
| sidebar 树状渲染性能（深层展开）| 中 | virtualized list (react-window)；超过 50 项启用 |
| migration 直接删除"故事/风格/资源池/导出"旧节点 → 内部/开发期旧项目数据丢失 | 低 | 已确认当前无真实客户，不为旧版本兼容增加复杂度；migration toast 明确提示删除数量；v0.6 新项目的数据正确性和持久化可靠性仍是硬要求 |
| Cmd+C/V 与浏览器原生剪贴板冲突 | 低 | preventDefault + 自定义剪贴板格式（仅 Nomi 内） |
| dnd-kit 学习曲线 | 低 | 官方文档详尽，引入 30 分钟上手 |
| derivedFrom 跨项目复制时打破链路 | 低 | 复制时 derivedFrom 清空（变孤立根） |

---

## 8. 长期视角：本 Phase 在 Nomi 架构演化中的位置

```
Phase A-D (v0.4) — Agent + Tool calling + Streaming 基础
       ↓
Phase E.0 (v0.5) — 8 分类 + Cost + Provenance + 虚拟化 (P0 架构)
       ↓
**Phase E.2 (v0.6) ← 当前**
   5 分类 + 独立跨分类复制 + 组 + Mura 视觉
       ↓
Phase F (v0.7) — Nomi Script 结构化创作（依赖 5 分类作为派生槽位）
       ↓
Phase G (v0.7-0.8) — 关系图谱 + Agent 项目记忆 + 跨项目资产
       ↓
Phase H+I+J (v0.9-1.0) — 中片闭环 + NLE 升级 + 长片闭环
```

**Phase E.2 不是孤立的功能**，它是后续 3 个 Phase 的前提：
- **F 需要它**：`@角色 小苏` 块要派生到「角色」分类下的实体卡片
- **G 需要它**：独立副本的 `derivedFrom` 来源关系是关系图谱的可视化原料
- **H 需要它**：跨项目资产库的基本单元就是分类下的资产

如果 E.2 设计不到位（比如跨分类复制语义不清、误做成共享同步），F/G/H 都得在它之上打补丁，长期债务巨大。

**所以本 Phase 工期 2 周是合理的投资**，不是"我们多花了 1 周"。

---

## 9. 进度跟踪

### 当前状态

**总进度**: 0 / 20 tasks (0%)
**当前 Wave**: ⏸ 待启动 Wave 1
**最后更新**: 2026-05-24

### Task 进度表

| Wave | Task | 状态 | Commit |
|---|---|---|---|
| W1 | E.2-1 schema 升级 | ⏸ | - |
| W1 | E.2-2 migration v5→v6 (硬删旧分类节点) | ⏸ | - |
| W1 | E.2-3 5 大分类调整 | ⏸ | - |
| W1 | E.2-3b sidebar 挂载下沉到生成区 | ⏸ | - |
| W2 | E.2-4 dnd-kit 引入 | ⏸ | - |
| W2 | E.2-5 sidebar 树渲染 | ⏸ | - |
| W2 | E.2-6 sidebar 拖拽 | ⏸ | - |
| W2 | E.2-7 sidebar 右键菜单 | ⏸ | - |
| W3 | E.2-8 canvas 组框 | ⏸ | - |
| W3 | E.2-9 Cmd+G 分组 | ⏸ | - |
| W3 | E.2-10 组框拖动 | ⏸ | - |
| W3 | E.2-11 左右双向同步 | ⏸ | - |
| W3 | E.2-12 复制粘贴 | ⏸ | - |
| W3 | E.2-13 删除策略 | ⏸ | - |
| W4 | E.2-14 derivedFrom 自动建立 | ⏸ | - |
| W4 | E.2-15 derivedFrom UI 角标 | ⏸ | - |
| W4 | E.2-16 节点 composer 内嵌 | ⏸ | - |
| W4 | E.2-17 节点自动编号 | ⏸ | - |
| W4 | E.2-18 单元测试 | ⏸ | - |
| W5 | E.2-19 版本 bump 0.6.0 | ⏸ | - |
| W5 | E.2-20 集成测试 | ⏸ | - |
| - | E.2 最终 audit | ⏸ | - |

---

## 10. 清理与冗余删除清单

按红线 §0，删任何代码前**必须先在此登记**。

| 删除 | Task | 文件 / 标识 | 删除 commit | 状态 |
|---|---|---|---|---|
| 旧的 8 built-in categories（story/style/inbox/exports）| E.2-3 | `projectCategories.ts` 中 4 个废除分类的定义 | TBD | ⏸ |
| **旧项目中 4 个废除分类下的所有节点** | E.2-2 | migrate v5→v6 时直接过滤掉 | TBD | ⏸ |
| Sidebar 在 WorkbenchShell 的挂载 | E.2-3b | `WorkbenchShell.tsx:104` `<CategorySidebar />` | TBD | ⏸ |
| 节点悬浮 composer 旧实现 | E.2-16 | `BaseGenerationNode.tsx` 中相关 selection-based show 逻辑 | TBD | ⏸ |
| 棋盘背景（占位态）| E.2-16 | 同上 | TBD | ⏸ |

---

## 11. 验收 (Phase E.2 完成定义)

完成所有 task + audit 后必须满足：

- [ ] 新建项目：5 个固定分类（分镜/角色/场景/道具/声音）
- [ ] 旧 v0.5 项目打开后自动迁移：保留 shots/characters/scenes/audio 可映射节点；直接删除 story/style/inbox/exports 废除分类节点并清理失效 edges；不为旧版本兼容兜底，但 v0.6 新项目的数据模型、删除语义、重启恢复必须稳定可靠
- [ ] 每个大分类是独立子画布（独立 viewport / selected）
- [ ] sidebar 树状视图：大分类 → 子组 → 节点 三层
- [ ] 用户能在大分类内手动建子组（Cmd+G 或右键）
- [ ] canvas 上选多个节点 Cmd+G → 出现组框 + sidebar 文件夹
- [ ] 拖节点到另一分类 sidebar → 创建独立副本（新 id），复制图片 / prompt / metadata
- [ ] 改源节点 prompt → 目标分类副本不变；改副本 prompt → 源节点不变
- [ ] Cmd+C / Cmd+V 真复制
- [ ] 删除：删除当前节点或从组中移出；跨分类副本互不影响
- [ ] 派生：基于 X regen 创建的新节点带 derivedFrom 角标
- [ ] 节点 composer 内嵌（Mura 视觉）
- [ ] 节点自动编号 "分镜 01" 等
- [ ] 所有新代码有 vitest 测试
- [ ] 独立 audit agent 通过
- [ ] 三平台 CI 构建通过

---

## 12. 跨文档关系

| 文档 | 角色 |
|---|---|
| 本文档 | Phase E.2 施工蓝图，executor 每次开工先读 |
| `nomi-mura-architecture-decision-2026-05-24.md` | 第一轮架构对话记录（已过时部分） |
| `nomi-canvas-architecture-comparison-2026-05-24.md` | 决策辅助（C 方案最终走向 E.2） |
| `nomi-structured-creation-prd-2026-05-24.md` | Phase F 产品定义（依赖本 Phase 的分类槽位） |
| `nomi-long-form-scale-audit-2026-05-24.md` | P0/P1/P2 优先级总览 |
| `nomi-product-prd-v2-2026-05-23.md` | 战略大盘，5 阶段路线图 |
| `nomi-phase-e-execution-plan-2026-05-24.md` | E.0 (v0.5) 施工记录，已完成 |

---

## 13. 启动条件

我等你确认：
- ✓ 命名（分镜，不是画面）
- ✓ Mura 视觉对齐（除命名 + Tabler 图标外严格照）
- ✓ 技术栈不改（仅加 dnd-kit）
- ✓ 20 task / 2 周工期合理

任意 ✗ 或想调整告诉我。全 ✓ 我立即派 Phase E.2 executor 启动 Wave 1。
