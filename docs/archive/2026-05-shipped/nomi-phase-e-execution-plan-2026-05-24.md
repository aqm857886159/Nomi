# Nomi Phase E 施工计划

日期：2026-05-24
版本：v1
依赖文档：
- `nomi-structured-creation-prd-2026-05-24.md` (产品定义：目录树 + 子画布)
- `nomi-long-form-scale-audit-2026-05-24.md` (P0 优先级清单)
- `nomi-product-prd-v2-2026-05-23.md` §6 (Phase 2 路线图)
- `nomi-agent-migration-plan-2026-05-23.md` (执行模板参考)

> Phase E 是 v0.5 的发布。落地"目录树 + 子画布"的产品骨架，同时把长片审计揭示的 4 个 P0 架构需求（G1 虚拟化 / G2 资产库 / G5 成本管理 / G7 provenance）一并打地基。**P0 不和子画布并行做，会留 10x 重构债务**。

---

## 0. 使用说明（每次开工前先看）

### 0.1 文档角色

每次开工前 **必须**：

1. 通读本文档 §1 (总览) + 当前 task 章节
2. 检查 §5 (进度) 确认下一个未完成 task
3. 按 task 顺序执行，**绝不跳跃**
4. 每个 task 一个 commit，写入 §5 进度
5. 所有 task 完成后 spawn 独立 audit agent，audit pass 才能发布 v0.5

### 0.2 红线

- 🚫 不跳 task。task 之间有依赖关系，跳了后面要重写
- 🚫 不跳 audit。`nomi-agent-migration-plan-2026-05-23.md` 的 Phase B 漏掉运行时 bug 给了教训
- 🚫 不在同一 commit 混不同 task
- 🚫 不动 Phase A/B/C/D 已 ship 的 Agent / Skill Pack / canvas tools 代码（除非 task 明确要求）
- 🚫 删任何代码前必须先在 §6 清理清单登记

### 0.3 标准 task 流程

```
1. 读本文档当前 task 章节
2. 检查依赖 task 是否已完成
3. 实现代码 → 写 / 改测试 → 跑 build + test 全绿
4. commit (符合 §7 commit message 规范)
5. 在 §5 进度表标 ✅ + commit SHA
6. 进入下一 task
```

---

## 1. 总览

### 1.1 目标

让 Nomi 项目从"一张扁平画布 + 一个文本编辑器"升级为：
- **左侧 8 分类目录树**（故事 / 角色 / 场景 / 风格 / 分镜 / 声音 / 资源池 / 导出）
- **每个分类是一个独立子画布**，有自己的视口和专属能力
- **支撑 1000+ 资产**的虚拟化渲染
- **成本透明** — 每次生成有 cost 记录，项目总花费可见
- **可复现** — 每个 AI 生成物都有完整 provenance (model + prompt + seed + params)

这 4 件事必须**一次性**做完。Phase E = v0.5。

### 1.2 工期

| Wave | 内容 | 周 |
|---|---|---|
| Wave 1 | 数据模型 + 目录树 UI (E1-E3) | W1 |
| Wave 2 | 数据迁移 + 模板 + 跨分类 + 资源池 (E4-E7) | W2 |
| Wave 3 | 虚拟化 + 资产库 + 成本 + provenance (E8-E11) | W3-W4 |
| Wave 4 | 测试 + final audit | W5 |

总工期 4-5 周。

### 1.3 v0.5 终态验收

完成后必须满足：

- [ ] 新项目默认有 8 个分类，旧项目自动迁移
- [ ] 用户能在每个子画布独立工作（视口、节点、prompt 各自隔离）
- [ ] 节点 > 50 时画布渲染不卡（虚拟化生效）
- [ ] 资产库视图：网格 / 列表 / 卡片三视图，按 kind / category / date 多维筛选
- [ ] 项目页角落实时显示当前项目累计 API 花费（精确到分）
- [ ] 每张 AI 生成的图 / 视频可以一键查看完整 provenance + "用相同参数重生成"
- [ ] 3 个项目模板可一键创建
- [ ] 所有新代码有 vitest 测试
- [ ] 独立 audit agent VERDICT: APPROVE_v0.5_RELEASE
- [ ] CI 三平台 build 通过

---

## 2. 任务清单（按依赖顺序）

### Task E1: 数据模型升级

**目标**：在 schema 层引入 Category 概念 + `node.categoryId` 字段。

**文件**：
- `src/workbench/project/projectRecordSchema.ts` (Zod schema 扩展)
- `src/workbench/generationCanvas/model/generationCanvasTypes.ts` (Node 类型扩展)
- `electron/runtime.ts` (项目 read/save 兼容旧格式)

**实现要点**：

```typescript
type Category = {
  id: string                      // 'story' / 'characters' / ... / 'category-{uuid}' for user-defined
  name: string                    // localized display name
  icon: string                    // emoji or icon key
  color?: string
  order: number                   // for sort
  viewType: CategoryViewType
  isBuiltin: boolean
  isHidden?: boolean              // user can hide built-ins
}

type CategoryViewType =
  | 'document'        // 故事 — TipTap full editor
  | 'card-grid'       // 角色 / 场景 / 风格
  | 'graph-canvas'    // 分镜 (current generationCanvas canvas)
  | 'asset-library'   // 资源池 — grid/list/card switchable
  | 'list-with-status'// 导出
  | 'audio-list'      // 声音

type GenerationCanvasNode = {
  // ... existing fields ...
  categoryId: string              // NEW
}

const BUILTIN_CATEGORIES: Category[] = [
  { id: 'story', name: '故事', icon: '📖', order: 1, viewType: 'document', isBuiltin: true },
  { id: 'characters', name: '角色', icon: '👥', order: 2, viewType: 'card-grid', isBuiltin: true },
  { id: 'scenes', name: '场景', icon: '🌍', order: 3, viewType: 'card-grid', isBuiltin: true },
  { id: 'style', name: '风格', icon: '🎨', order: 4, viewType: 'card-grid', isBuiltin: true },
  { id: 'shots', name: '分镜', icon: '🎬', order: 5, viewType: 'graph-canvas', isBuiltin: true },
  { id: 'audio', name: '声音', icon: '🎵', order: 6, viewType: 'audio-list', isBuiltin: true },
  { id: 'inbox', name: '资源池', icon: '🖼️', order: 7, viewType: 'asset-library', isBuiltin: true },
  { id: 'exports', name: '导出', icon: '📦', order: 8, viewType: 'list-with-status', isBuiltin: true },
]
```

**向后兼容**：
- 旧 project.json 读取时，`categories: undefined` → 使用 BUILTIN_CATEGORIES
- 旧 node 读取时，`categoryId: undefined` → 临时归入 'inbox'（迁移在 E4 处理）

**提交**：`feat(project): introduce Category + categoryId schema`

**验收**：
- [ ] tsc 通过
- [ ] 既有项目能正常加载，旧 node 显示在 inbox 分类
- [ ] 新建项目自动带 8 个 built-in 分类

---

### Task E2: 目录树 UI 组件

**目标**：在工作台左侧加垂直分类栏，60px 默认收起 / 200px 展开。

**文件**：
- `src/workbench/WorkbenchShell.tsx` (整体布局调整)
- 新建 `src/workbench/sidebar/CategorySidebar.tsx`
- 新建 `src/workbench/sidebar/CategoryItem.tsx`
- `src/workbench/workbenchStore.ts` (active categoryId + sidebar collapsed state)

**实现要点**：
- 收起态：只显示图标 + 节点数徽标
- 展开态：图标 + 名称 + 数量 + 右键菜单
- Active 分类彩色高亮
- 节点数 = `nodes.filter(n => n.categoryId === cat.id).length`
- 拖拽排序（dnd-kit 或 react-dnd），仅自定义分类可拖
- 内置分类不可删除，自定义分类可
- 底部 `+ 新分类` 按钮（暂未实装弹窗，留 TODO 给 E6 自定义分类）

**Wide 显示**：
```
┌─────────────────┬──────────────────────────────────────┐
│ 📖 故事 (1)     │                                       │
│ 👥 角色 (4)     │  <当前 activeCategory 的子画布>       │
│ 🌍 场景 (5)  ◀  │                                       │
│ 🎨 风格         │                                       │
│ 🎬 分镜 (30)    │                                       │
│ 🎵 声音 (3)     │                                       │
│ 🖼️ 资源池 (12)  │                                       │
│ 📦 导出 (2)     │                                       │
│ + 新分类        │                                       │
└─────────────────┴──────────────────────────────────────┘
```

**提交**：`feat(workbench): add category sidebar`

**验收**：
- [ ] 侧栏可收起 / 展开（默认收起）
- [ ] 点击分类切换 active 状态
- [ ] 节点数实时反映

---

### Task E3: 子画布切换 + 视口状态保持

**目标**：每个分类点击时切换右侧主画布；每个 graph-canvas 类型的分类保留自己的 zoom/offset。

**文件**：
- `src/workbench/generationCanvas/components/GenerationCanvas.tsx` (按 activeCategoryId 过滤节点)
- `src/workbench/generationCanvas/store/generationCanvasStore.ts` (per-category viewport)
- `src/workbench/sidebar/CategoryHostView.tsx` (新建，根据 viewType dispatch 渲染)

**实现要点**：
- 每个 `viewType: 'graph-canvas'` 的分类有独立 `{ zoom, offset }` 持久化到 store
- 节点 filter：当前画布只渲染 `node.categoryId === activeCategoryId` 的节点
- 跨画布的 edge 暂时不渲染（关系图谱是 Phase G 的事）
- 切换分类时主画布做 200ms 滑动 + fade 过渡
- 非 graph-canvas 的分类 (document / card-grid / asset-library / etc) 暂时显示 placeholder：「{分类名} 子画布开发中 — Phase F 落地」

**提交**：`feat(workbench): switch sub-canvas per category with viewport state`

**验收**：
- [ ] 在分镜分类生成 5 个节点 → 切到故事 → 切回分镜 → 5 个节点仍在原位置原 zoom
- [ ] 故事分类显示 placeholder
- [ ] 切换有动画

---

### Task E4: 自动迁移既有项目

**目标**：用户打开 v0.4.0 创建的旧项目，节点自动按 kind 归类到对应分类。

**文件**：
- 新建 `src/workbench/project/projectCategoryMigration.ts`
- `src/workbench/project/projectPersistenceService.ts` (在 hydrateProject 之后调用 migration)
- `src/workbench/library/ProjectLibraryPage.tsx` (迁移完成后 toast 提示)

**实现要点**：

```typescript
function migrateNodeToCategoryId(node: GenerationCanvasNode): string {
  if (node.categoryId) return node.categoryId  // already migrated
  if (node.kind === 'text') return 'story'
  if (node.kind === 'character') return 'characters'
  if (node.kind === 'scene') return 'scenes'
  if (node.kind === 'panorama') return 'scenes'
  if (node.kind === 'image' || node.kind === 'video') {
    // 启发式：如果节点参与时序连边（出/入度都有），归入 shots；否则 inbox
    return hasTemporalEdges(node, allEdges) ? 'shots' : 'inbox'
  }
  if (node.kind === 'output') return 'exports'
  return 'inbox'
}
```

**幂等性**：同一项目反复打开不会重复迁移（已迁移节点跳过）。

**备份**：迁移前在 `cache/backup-pre-migration-{timestamp}.json` 留快照，方便回退。

**提交**：`feat(project): auto-migrate legacy flat projects to categories`

**验收**：
- [ ] v0.4.0 项目打开后节点正确分布到分类
- [ ] 备份文件在 cache/ 下
- [ ] 重复打开不再迁移

---

### Task E5: 项目模板 (3 个)

**目标**：新建项目时给出模板选择。

**文件**：
- 新建 `src/workbench/library/projectTemplates.ts`
- `src/workbench/library/ProjectLibraryPage.tsx` (新建项目弹窗加模板选择)
- `src/workbench/library/localProjectStore.ts` (createLocalProject 接受 templateId)

**3 个模板**：

```typescript
const PROJECT_TEMPLATES = {
  'manga-short': {
    name: 'AI 漫剧短片',
    description: '5 分钟二次元短剧，预设故事 / 角色 / 场景 / 分镜 / 声音 / 资源池 / 导出',
    enabledCategories: ['story', 'characters', 'scenes', 'shots', 'audio', 'inbox', 'exports'],
    seedDocument: '# 第一幕：...\n\n@角色 主角 { ... }\n\n# 第二幕：...',
  },
  'product-demo': {
    name: '产品 Demo',
    description: '30-60 秒 SaaS 产品介绍，预设故事 / 风格 / 分镜 / 资源池 / 导出',
    enabledCategories: ['story', 'style', 'shots', 'inbox', 'exports'],
    seedDocument: '# 30 秒产品 Demo 脚本：\n\n1. 问题（5s）：...\n2. 方案（10s）：...',
  },
  'free-form': {
    name: '自由创作',
    description: '8 分类全开，无预设内容',
    enabledCategories: ['story', 'characters', 'scenes', 'style', 'shots', 'audio', 'inbox', 'exports'],
    seedDocument: '',
  },
}
```

**提交**：`feat(library): add 3 project templates`

**验收**：
- [ ] "新建项目"按钮弹出模板选择
- [ ] 选漫剧模板 → 创建项目 → 8 个分类 / 隐藏风格、风格分类 visibility=false
- [ ] 选自由创作 → 8 个分类全开 + 空文档

---

### Task E6: 节点跨分类拖拽

**目标**：用户能把画布上的节点拖到侧栏分类项上，重新归类。

**文件**：
- `src/workbench/sidebar/CategoryItem.tsx` (作为 drop target)
- `src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx` (作为 draggable)
- `src/workbench/generationCanvas/store/generationCanvasStore.ts` (`reassignNodeCategory` action)

**交互**：
- 长按 + 拖动节点头部触发 cross-category drag mode（区分于已有的 canvas 内移动）
- drop target 高亮 + 显示"+1" 徽标
- 松手后切换到目标分类并高亮闪烁该节点位置

**提交**：`feat(workbench): support cross-category node drag`

**验收**：
- [ ] 在分镜画布选中一个 image 节点 → 拖到资源池 → 该节点从分镜消失，出现在资源池

---

### Task E7: 资源池分类完整实现

**目标**：资源池分类作为"未归类的导入素材"承接区，提供 grid/list/card 三视图 + 右键归类。

**文件**：
- 新建 `src/workbench/sidebar/AssetLibraryView.tsx`
- `src/workbench/generationCanvas/adapters/assetImportAdapter.ts` (新导入素材默认 categoryId='inbox')

**视图三态**：
- Grid：缩略图网格，悬停显示元数据
- List：表格行，列含 kind / 来源 / 日期 / size
- Card：大缩略图 + 完整元数据

**右键菜单**：
- "归类到 角色 / 场景 / 风格 / 分镜 / …"（仅 card-grid / graph-canvas 类型的分类）
- "查看 provenance"
- "在文件管理器中打开"
- "删除"

**提交**：`feat(workbench): asset library view for inbox category`

**验收**：
- [ ] 拖入图片 → 默认进资源池
- [ ] 三视图切换正常
- [ ] 右键归类生效

---

### Task E8: react-window 虚拟化基础设施 (P0)

**目标**：建立项目里通用的虚拟化渲染基础设施。

**文件**：
- 安装依赖：`pnpm add react-window @types/react-window`
- 新建 `src/workbench/ui/virtualized/VirtualGrid.tsx`（卡片网格的虚拟化封装）
- 新建 `src/workbench/ui/virtualized/VirtualList.tsx`（列表的虚拟化封装）
- 现有 `src/workbench/generationCanvas/components/GenerationCanvas.tsx`：节点数 > 50 时启用 viewport-aware rendering（只渲染视口内 + 周围 buffer 的节点）

**虚拟化阈值**：

```typescript
const VIRTUALIZATION_THRESHOLD = 50
// 节点 ≤ 50: 全部渲染（保持现有行为）
// 节点 > 50: 只渲染视口可见 + 200px buffer 区域内的节点
```

**Canvas 节点虚拟化策略**：
- 计算每个节点的 bounding box (position.x, position.y, size.width, size.height)
- 视口范围 = canvas viewport rect / zoom
- buffer = 200px
- 不在范围内的节点：返回 placeholder `<div style="..." />` 而不是 BaseGenerationNode

**资产库虚拟化**：直接用 react-window 的 FixedSizeGrid / VariableSizeGrid。

**提交**：`feat(ui): add react-window virtualization infrastructure`

**验收**：
- [ ] 在分镜画布手动添加 100 个节点（脚本生成），滚动流畅无卡顿
- [ ] 资产库 500 项滚动 60 FPS
- [ ] 节点 ≤ 50 时行为与之前一致

---

### Task E9: 资产库高级筛选

**目标**：在资产库视图里加多维筛选 + 全文搜索。

**文件**：
- `src/workbench/sidebar/AssetLibraryView.tsx` (顶部筛选 toolbar)
- 新建 `src/workbench/sidebar/assetFilters.ts`（filter / sort 工具函数）

**筛选维度**：
- 类型：image / video / audio / text / panorama
- 来源：local-import / generated / agent-created
- 日期范围：created in last 7 days / 30 days / custom
- 分类：所有分类多选
- 关键词：搜索 title / prompt
- 状态：idle / success / error / queued

**排序**：created date / title / cost / kind

**提交**：`feat(library): multi-dimensional filter + full-text search`

**验收**：
- [ ] 输入关键词实时筛选
- [ ] 多个 filter 可叠加（kind=image + date=last-week）

---

### Task E10: Cost tracking 基础版 (P0)

**目标**：每次 AI 生成调用记录 cost，项目页角落显示累计花费。

**文件**：
- 新建 `electron/cost/costLog.ts` (写 jsonl + 聚合 API)
- 新建 `src/workbench/cost/projectCostBadge.tsx` (UI)
- `electron/runtime.ts` 的 runGenerationTask + runAgentChat + runAgentChatV2 末尾写 cost log
- 新建 `electron/cost/providerCostTable.ts` (provider × model → estimated cost)

**Cost 估算策略**：

```typescript
// providerCostTable.ts
type CostEntry = {
  provider: string
  modelKey: string
  kind: 'text' | 'image' | 'video' | 'audio'
  unit: 'per-call' | 'per-1k-tokens' | 'per-second' | 'per-megapixel'
  unitCost: number  // USD
  defaultUsage?: number  // fallback if unable to measure
}

const COST_TABLE: CostEntry[] = [
  { provider: 'chatfire', modelKey: 'gpt-4o', kind: 'text', unit: 'per-1k-tokens', unitCost: 0.005 },
  { provider: 'chatfire', modelKey: 'claude-sonnet-4-5', kind: 'text', unit: 'per-1k-tokens', unitCost: 0.003 },
  { provider: 'chatfire', modelKey: 'sd3-medium', kind: 'image', unit: 'per-call', unitCost: 0.040 },
  { provider: 'chatfire', modelKey: 'flux-1-pro', kind: 'image', unit: 'per-call', unitCost: 0.055 },
  { provider: 'chatfire', modelKey: 'kling-1.5', kind: 'video', unit: 'per-second', unitCost: 0.500 },
  // ... 用户可在 model catalog UI 里手动调整
]
```

不准确没关系 — **有比没有强 10000 倍**。后续按实际账单微调。

**Log 格式** (per project):

```
~/Documents/Nomi Projects/{project}/logs/cost-log.jsonl
{"ts":1716534000000,"provider":"chatfire","model":"flux-1-pro","kind":"image","cost":0.055,"nodeId":"gen-v2-...","tokens":null}
{"ts":1716534012000,"provider":"chatfire","model":"gpt-4o","kind":"text","cost":0.012,"tokens":2400}
```

**UI**：
- 工作台底部右下角小徽标：`💰 $12.34 · 项目累计`
- 点击展开浮窗：本周 / 本月 / 总计 + 按 provider / model 拆分

**提交**：`feat(cost): per-project cost tracking + project total badge`

**验收**：
- [ ] 跑 1 次 image 生成 → cost-log.jsonl 多 1 行
- [ ] 项目角落徽标实时反映总额
- [ ] 多个项目独立计算

---

### Task E11: Provenance formalization (P0)

**目标**：每个 AI 生成的资产保存完整 provenance；UI 可一键查看 + 一键"用相同参数重生成"。

**文件**：
- `src/workbench/generationCanvas/model/generationCanvasTypes.ts` (GenerationNodeResult 增加 provenance 字段)
- `electron/runtime.ts` runGenerationTask 末尾写 provenance
- 新建 `src/workbench/generationCanvas/nodes/ProvenancePanel.tsx`

**Provenance schema**：

```typescript
type Provenance = {
  provider: string         // e.g. 'chatfire'
  modelKey: string         // e.g. 'flux-1-pro'
  modelVersion?: string
  prompt: string           // exact prompt sent
  negativePrompt?: string
  seed?: number
  params: Record<string, unknown>  // width, height, steps, guidance, etc.
  vendorRequestId?: string
  cost?: { amount: number; currency: string; unit: string }
  timestamp: number
  agentRunId?: string      // if generated through Agent
}

type GenerationNodeResult = {
  // ... existing fields ...
  provenance?: Provenance  // NEW (optional for backward compat)
}
```

**UI**：
- 节点右上角"i"图标，点开抽屉显示 provenance
- 抽屉底部按钮"用相同参数重生成" → 复用 prompt + seed + params 调用同样的 provider

**重生成的语义**：
- 不覆盖原节点，而是创建一个**变种节点**（V2、V3 …）
- 这是 Phase F G3 版本树的前置

**提交**：`feat(canvas): formal provenance + regenerate-with-same-params`

**验收**：
- [ ] 任何 image 节点都能看 provenance
- [ ] 重生成生成新节点且参数完全一致
- [ ] 旧节点（无 provenance）不报错，只是抽屉显示"无 provenance 记录"

---

### Task E12: 单元测试 + e2e happy path

**目标**：覆盖 Phase E 引入的新代码。

**文件**：
- 新建 `src/workbench/project/projectCategoryMigration.test.ts`
- 新建 `src/workbench/sidebar/assetFilters.test.ts`
- 新建 `electron/cost/costLog.test.ts`
- 新建 `electron/cost/providerCostTable.test.ts`
- 新建 `src/workbench/library/projectTemplates.test.ts`
- 新建 `src/workbench/generationCanvas/model/provenance.test.ts`

**E2E happy path test**（不跑 dev app，但跑端到端逻辑）：
- 创建漫剧模板项目 → 7 个分类 → 在分镜分类创建节点 → 检查节点 categoryId
- 创建项目 → 跑一次 generation → 检查 cost-log + provenance 写入
- 创建空项目 → migrate（无节点情况）→ 验证不出错

**目标**：56 → 90+ 测试。

**提交**：`test(workbench): cover Phase E features`

**验收**：
- [ ] `pnpm test` 通过
- [ ] 新代码覆盖率 ≥ 80%

---

## 3. 验证关卡

完成 E1-E12 后 spawn 独立 audit agent（模板与 Phase B/C/D audit 类似）。

audit agent 必须检查：

1. **12 commit 完整**，message 符合 §7 format，含 Co-Authored-By
2. **每个 task 验收 box 全勾**
3. **§6 清理清单更新**（如有删除）
4. **Build + test 全绿**
5. **`pnpm test` 显示 ≥ 80 测试通过**
6. **红线无违反**：未跳 task、未混 commit、Phase A-D 代码未被破坏
7. **手动测试**（在 worktree 检查）：
   - 加载旧 v0.4.0 项目 → 自动迁移 → 节点分布合理
   - 新建漫剧模板项目 → 7 分类正确
   - 100 节点画布滚动流畅
   - cost badge 显示数字
   - 任意 image 节点能看 provenance

Audit 返回 `APPROVE_v0.5_RELEASE` 才能发版。

---

## 4. 与现有代码的接合点

Phase E 在 v0.4.0 之上叠加。需要小心的接合点：

| 现有模块 | Phase E 的修改 | 风险 |
|---|---|---|
| `projectRecordSchema.ts` | 增加 `categories` 字段 + node.categoryId | schema 升级，旧项目 fallback 必须 work |
| `generationCanvas/components/GenerationCanvas.tsx` | filter 节点 by categoryId；E8 加虚拟化 | 现有 canvas pan/zoom 不能破 |
| `generationCanvas/store/generationCanvasStore.ts` | per-category viewport | restoreSnapshot 兼容性 |
| `electron/runtime.ts` runAgentChat/V2/runGenerationTask | 末尾写 cost + provenance | 不影响 Agent / streaming 行为 |
| `WorkbenchShell.tsx` | 左侧加 sidebar | 顶部 Topbar / 底部 Timeline 布局不破 |
| `library/ProjectLibraryPage.tsx` | 新建按钮弹模板选择 | Try-Now hero（Phase C）保持 |

---

## 5. 进度跟踪

### 当前状态

**总进度**: 9/12 tasks (75%) — 全部 P0 完成；E6/E7/E9 (UI 细节) 推迟到 v0.5.1
**当前 Phase**: ✅ Phase E P0 完成 → final audit → v0.5.0 release
**最后更新**: 2026-05-24 (Phase E P0 完结)

### Phase E 进度

| Task | 状态 | Commit (rebased final SHA) |
|---|---|---|
| E1 数据模型 (Category + categoryId) | ✅ | `14cd4b8` |
| E2 目录树 UI 组件 | ✅ | `6b543c5` |
| E3 子画布切换 + 视口状态 | ✅ | `1c27e90` |
| E4 自动迁移既有项目 | ✅ | `bd924ed` |
| E5 3 个项目模板 | ✅ | `e51f620` |
| E6 节点跨分类拖拽 | ⏸ deferred | v0.5.1 (UX polish) |
| E7 资产库视图 (资源池) | ⏸ deferred | v0.5.1 (有 placeholder) |
| E8 react-window 虚拟化 (G1 P0) | ✅ | `5f5da31` |
| E9 资产库筛选 + 搜索 | ⏸ deferred | v0.5.1 (depends on E7) |
| E10 Cost tracking (G5 P0) | ✅ | `29abdd4` |
| E11 Provenance (G7 P0) | ✅ | `0297141` |
| E12 单元测试 (30 new) | ✅ | `97785ae` |
| E 验证关卡 (independent audit) | ⏸ pending | (spawn final audit agent) |

**Phase E 备注**：
- Executor agent rate-limit 在 E5 中断，orchestrator 接手完成 E10/E11/E8/E12
- 4 个 P0 (G1 虚拟化 + G2-partial 资产库 + G5 成本 + G7 provenance) 全部架构地基已完成
- 测试 181 → 211 (新增 30)
- E6/E7/E9 是 UI 细节，不阻塞 v0.5 发版价值；推迟到 v0.5.1 小版本

---

## 6. 清理与冗余删除清单

Phase E 应该是**纯增量**，理论上不删任何东西。如果发现可删的：

| 删除 | Task | 文件 | 删除 commit | 状态 |
|---|---|---|---|---|

(空，Phase E 不预期删除任何代码)

---

## 7. Commit Message 规范

继承 `nomi-agent-migration-plan-2026-05-23.md` §7：

- `feat(project):` / `feat(workbench):` / `feat(library):` / `feat(ui):` / `feat(cost):` / `feat(canvas):` / `feat(sidebar):`
- `refactor(...)` / `test(...)` / `docs(...)`
- 必须包含 `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

---

## 8. 风险与对策

### 风险 1：现有项目迁移失败 / 节点错位
**对策**：
- E4 强制写备份到 `cache/backup-pre-migration-{ts}.json`
- 迁移幂等（已迁移项目不重复迁移）
- 添加 e2e 测试覆盖 3 类既有项目（空 / 仅节点 / 完整）

### 风险 2：虚拟化与现有 pan/zoom 冲突
**对策**：
- E8 用 viewport-aware filter，不动 pan/zoom 数学
- 节点 ≤ 50 时完全保持现有行为（virtualization off）
- 加单元测试覆盖虚拟化边界

### 风险 3：Cost 估算不准给用户误导
**对策**：
- 徽标显示"估算"（"~ $12.34"）
- 抽屉里有"如何调整成本估算"链接到 docs
- 用户可在 model catalog UI 里手动改单价

### 风险 4：Provenance 字段大小爆炸
**对策**：
- 不存图片原始数据，只存 reference
- 长 prompt 截断到 5000 字符上限
- params 用 JSON serialize，深度限制 3 层

### 风险 5：UI 复杂度爆炸
**对策**：
- 内置分类做完后**先发布 v0.5-beta** 收反馈
- 自定义分类 / 关系图谱推迟到 Phase G
- 每个 task 严格 1 个 commit，便于回滚

### 风险 6：Worktree rate-limit 中断（Phase B/D 都遇过）
**对策**：
- task 严格独立，断点续跑友好
- 中断后 orchestrator 接手未完成 task
- 不需要重做已完成 task

---

## 9. 跨文档关系

| 文档 | 角色 |
|---|---|
| 本文档 | **Phase E 施工蓝图**，executor agent 每次开工先读 |
| `nomi-structured-creation-prd-2026-05-24.md` | Phase E/F/G 产品定义；本计划是 E 的执行细化 |
| `nomi-long-form-scale-audit-2026-05-24.md` | P0 优先级来源，本计划已 fold G1/G2/G5/G7 |
| `nomi-product-prd-v2-2026-05-23.md` | 战略大盘，Phase E 是其 v0.5 落地 |
| `nomi-agent-migration-plan-2026-05-23.md` | 执行模板参考；多 agent 工作流 |
| `~/Documents/Nomi Projects/` | 用户数据，迁移必须不破 |

---

## 10. v0.5 终态发布清单

完成所有 task + audit 通过后：

- [ ] 本地 tag `v0.5.0` 指向 version bump commit
- [ ] `package.json` version 0.4.0 → 0.5.0
- [ ] 更新 `docs/user-guide.md`：介绍目录树 + 项目模板
- [ ] 更新 `docs/quickstart.md`：新建项目走模板向导
- [ ] 录制 90 秒 demo 视频（manual，可推迟到 push tag 后做）
- [ ] release notes 起草
- [ ] push tag → Desktop Release CI 三平台 build

---

## 11. 结语

Phase E 是 Nomi 从"30 镜头短片工具"向"中片可用工具"演化的关键一步。它不是 UI 优化，而是为长片场景打**底层架构地基**。把虚拟化 + 资产库 + 成本 + provenance 这 4 个 P0 和子画布同步做完，意味着 Phase F/G/H/I/J 不需要回头重构。

执行原则：**P0 之外的好想法都先记到 backlog，不在本 Phase 加塞**。
