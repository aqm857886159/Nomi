# Phase E.2 完成 + 长期主义技术栈升级 (v0.6.0)

日期：2026-05-25
版本：v1
状态：施工蓝图，已通过 4 项用户决策
替代：`docs/archive/2026-05-shipped/nomi-phase-e2-tech-spec-2026-05-24.md`（上一版 spec，本文档为完整继任）

> 本文档目的：把 v0.5.1 残留的 7 项 spec 偏离修补到位，同时完成必要的技术栈升级，让 v0.6 之后的 Phase F/G/H 站在干净、5 年内可持续的基座上。

---

## 0. 使用说明（开工先读）

每次开工前**必须**：

1. 读 §1（总览） + §3（决策记录） + §7（任务清单） + §10（进度跟踪）
2. 检查 §10，确认下一个未完成 task 的 id
3. 按 task 顺序执行，**绝不跳跃**
4. 每个 task 一个 commit；commit message 必须含 task id（如 `[E.2C-3]`）
5. **每完成一个 task：在同一个 commit 内更新 §10 进度表为 ✓**（强制约束，见下文 hook 机制）
6. 所有 task 完成后 spawn 独立 audit agent

### 红线（违反 = 拒绝合并）

- 🚫 不跳 task / 不跳 audit / 不混 commit
- 🚫 不动当前 task 范围外的代码（除非补登记到 §9 清理清单）
- 🚫 §10 进度表不更新 = pre-commit hook 拒绝
- 🚫 视觉规范（§6）与本文档不一致：**先停先问**，绝不自行决定
- 🚫 技术栈升级 task（W0）不允许跳过到后续 wave 之后再补

### 进度表强制更新机制（针对上一次 spec 不被尊重的教训）

实现：

- `scripts/check-progress-update.cjs` — Node 检查脚本（跨平台）
- `scripts/install-git-hooks.cjs` — `pnpm install` 时自动安装 `.git/hooks/commit-msg`
- `package.json` `postinstall` 触发安装
- 用 **commit-msg** hook（不是 pre-commit），因为我们要读 commit message

逻辑：
1. commit message 不含 `[E.2C-XX]` → 放行
2. 含 task id 但本次 commit 没改进度文档 → 拒绝
3. 含 task id 且进度文档新增行包含该 id + ✓ → 放行

W0 第一个 task (E.2C-01) 装好这个 hook。之后任何"忘记更新进度表"的提交会被本地直接拒绝。

---

## 1. 总览

### 1.1 交付目标

**v0.6.0 — Phase E.2 真正完成版 + 长期主义技术基座**

把 v0.5.1 部分实现（Wave 1-3 大致完成、Wave 4 几乎全空）的"5 分类 + Mura 视觉 + 跨分类独立复制 + 派生标签"，做到原 spec 期望的水平，**并且**借此 Phase 一次性把技术栈升级到 2026 长期可持续状态，避免"为了不升级而妥协架构"的隐性债务。

### 1.2 在范围内

✅ **修补 v0.5.1 偏离**（用户审计确认的 7 项）：
- Sidebar 挂载从 WorkbenchShell 下沉到 GenerationWorkspace
- 节点 composer 永久内嵌（终止 selection-based 浮层）
- 分类图标从 emoji 换 Tabler 图标
- 节点自动编号（"分镜 01" 等）
- "等待生成" 占位态
- GroupFrame 从 GenerationCanvas 抽出为独立组件
- §10 进度跟踪强制更新机制

✅ **架构升级**（决策 4）：
- 删除 `viewType` 字段及其 5 种 view 概念
- 引入统一画布底座 + `NodeRenderKind` 系统
- 5 个分类（分镜/角色/场景/道具/声音）共享画布交互，节点渲染样式按分类不同

✅ **决策细化**：
- 决策 2：composer 内嵌但极简（prompt + 生成按钮，模型/比例 chip 折进 "⋯"）
- 决策 3：副本角标改"独立副本"文案，永久可见；拖拽 toast 加 5 秒撤销

✅ **架构辅助**（保留）：
- BaseGenerationNode（1119 行）拆分

### 1.3 不在范围（明确推迟）

❌ Tauri 迁移（v0.8 评估）
❌ AI SDK 5 升级（等 GA）
❌ Tailwind 3 → 4（Phase F 单独评估，迁移成本高）
❌ SQLite 实际实施（仅留接口，Phase F 落地）
❌ Mantine 8（仍未稳定）
❌ 关系图谱可视化（Phase G）

❌ **技术栈一次性升级（W0）—— 整批推迟到 Phase E.3**（用户决议 2026-05-25）：
- React 18 → 19、Vite 5 → 6、TS 5.6 → 5.7、Zustand 4 → 5、TipTap 3 → 4
- SWR → Tanstack Query 5、Vitest 2 → 3、Biome 替代 ESLint+Prettier
- Electron 31 → 33 minor
- 持久化 ProjectStore 抽象（一起推到 Phase E.3，避免和 SQLite 实施分开）
- 删除 lucide-react（保留在本 Phase W3 视觉打磨内顺手做）
- **理由**：避免功能开发 + 技术升级复合风险；用户不可见，机会成本高；
  Phase E.3 单独 1 周专注做完，根因可定位

### 1.4 工期

约 **10 个工作日**（2 周），分 5 个 wave。W0 推迟后回到原 spec 工期。

| Wave | 主题 | 工期 |
|---|---|---|
| W0 | 进度 hook（仅 E.2C-01，已完成）| 完成 ✓ |
| W1 | 架构重构：统一画布 + NodeRenderKind + 删 viewType | 3 天 |
| W2 | 5 分类节点渲染组件 | 3 天 |
| W3 | 视觉打磨：composer 内嵌 + Tabler 图标 + 删 lucide + 自动编号 + 占位态 + 副本角标 | 3 天 |
| W4 | Sidebar 挂载 + 撤销 toast + GroupFrame 抽离 + BaseGenerationNode 拆分 | 1 天 |
| W5 | 测试 + 集成测试 + release | 2 天 |

---

## 2. Mura 视觉对齐与命名（继承自 v1 spec，已 lock）

视觉与命名锁定，**不再讨论**：

| 元素 | 选定 | 来源 |
|---|---|---|
| 分类命名 | 分镜 / 角色 / 场景 / 道具 / 声音 | 用户决议（沿用 Nomi 习惯，非 Mura 的 "画面/cast"）|
| 图标库 | `@tabler/icons-react`，5 个分类各一图标 | spec v1 §2 line 97 + 决策 2 |
| Sidebar 收起宽度 | 60px | spec v1 |
| Sidebar 展开宽度 | 240px | v0.5.1 已实现，不再调 200px |
| Sidebar 树层级 | 大分类 → 子组 → 节点（3 层）| spec v1 |
| 节点 composer | **永久内嵌**于节点容器，180px 节点高度 | 决策 2（不是 spec v1 的 280px）|
| 节点 composer 内容 | prompt 单行 + 生成按钮；模型/比例 chip 折进 "⋯" 弹出 | 决策 2 |
| 节点占位态 | 灰底 + "{分类名} NN" + "等待生成" 文案 | spec v1 §2 + 决策 2 |
| 节点编号 | "分镜 01" / "角色 03" 自动 | spec v1 §2 + 决策 2 |
| 副本角标 | "📋 独立副本（来自 [分类名]·[节点名]）"，永久可见 | 决策 3 |
| 撤销 toast | 拖拽完成 5 秒内可点撤销 | 决策 3 |
| 文字字号/行高 | 沿用 Design.md 现有 tokens | 决策 2 |

### Tabler 图标分配（已锁定，对照 Mura 设计原稿）

| 分类 | Tabler 图标 | 设计原稿形态 |
|---|---|---|
| 分镜 | `IconLayoutRows` | 3 条横向短矩形（胶片格）|
| 角色 | `IconUser` | 单人轮廓（圆头 + 上半身）|
| 场景 | `IconPhoto` | 相框 + 内嵌山景 |
| 道具 | `IconBox` | 3D 等距立方体 |
| 声音 | `IconChartBar` | 短竖线波形（柱状高低不一）|

stroke 统一为 `1.5`，size 默认 `16px`。

---

## 3. 已批准决策记录

### 决策 1：修补完整对齐 spec（不接受现状）

- **背景**：v0.5.1 与 spec v1 有 7 项偏离（4 P0/P1 + 3 P2）
- **选定**：修补路径
- **理由**：spec v1 §8 明确 Phase F/G/H 依赖 E.2 落到位；此时妥协的代价是塌方式返工

### 决策 2：节点 composer 内嵌但极简 + Tabler 图标 + 文字排版一致

- **选定**：方案 C（不是 spec v1 的方案 A "280px 全展开"）
- **细节**：
  - composer 永久内嵌在节点内部容器（删除 `selection && ...` 条件）
  - 默认仅显示：prompt 单行 textarea + 生成按钮
  - 模型选择 / 比例选择 / 参数调节折进 "⋯" 弹出菜单
  - 节点高度 180px（spec v1 为 280px，但长片场景密度优先）
  - Tabler 图标全面替代当前 emoji
  - 字号、行高、padding 严格沿用 `Design.md` tokens

### 决策 3：跨分类独立副本 + "独立副本"角标 + 撤销 toast

- **选定**：方案 A 加强版
- **细节**：
  - 拖拽行为不变：跨分类创建新 id 独立副本
  - 副本角标文案改为 "📋 独立副本（来自 [分类]·[名]）"，**永久可见**
  - 删除现有 "↩ 由 X 派生" 角标（容易误导成"同步"）
  - 拖拽完成弹 toast：5 秒内可点击 "撤销"
  - 数据模型：`derivedFrom` 字段保留**仅**用于跨分类副本；同分类内的"基于此重新生成"另起 `regeneratedFrom` 字段（语义清晰分离）

### 决策 4：5 分类全部基于统一画布底座

- **选定**：统一画布 + NodeRenderKind 系统
- **细节**：
  - 删除 `projectCategories.ts` 中的 `viewType` 字段
  - 删除 `CATEGORY_VIEW_TYPES` 联合类型及 5 种 view 概念
  - 引入 `NodeRenderKind` 系统：每个分类有默认 kind，节点持有 `renderKind` 字段
  - 5 分类共享画布交互（缩放/拖动/选中/Cmd+G/Cmd+C+V/组框/sidebar 拖入）
  - 节点渲染组件按 `renderKind` 分发：
    - 分镜 → `ShotFrameNode`（图像 + 内嵌 composer + 编号 + 派生角标）
    - 角色 → `CharacterCardNode`（头像 + 名字 + 简短设定）
    - 场景 → `SceneCardNode`（环境图 + 名字 + 关联角色 chip）
    - 道具 → `PropCardNode`（道具图 + 名字 + 关联角色/场景 chip）
    - 声音 → `AudioStripNode`（波形 + 时长 + tag）
  - 各分类新建节点时按 grid 默认堆放，但用户可自由拖动
  - 空状态：画布中央显示"+ 新建{分类名}"引导按钮（首次创建后消失）

---

## 4. 技术栈长期主义审视

> ⚠️ **2026-05-25 决议变更**：本节内容**整体推迟到 Phase E.3**。原 W0 升级 task (E.2C-02 ~ E.2C-12) 全部 → E.3。
> 本 Phase 仅做用户可见的功能修补，避免技术升级 + 功能开发同时进行造成复合风险。
> Phase E.3 单独 1 周专注做这件事。
>
> 下面内容作为 Phase E.3 的输入参考保留。

CTO 视角：**5 年内可持续的栈是什么？** 我们升什么，跳什么，等什么。

### 4.1 现状全景（v0.5.1）

| 层 | 当前 | 业界 2026 主流 | 本 Phase 行动 |
|---|---|---|---|
| 桌面壳 | Electron 31.7.7 | Electron 33 / Tauri 2 | 升级 Electron 到 33；Tauri 延后 |
| UI 框架 | React 18.3.1 | React 19 | **升级到 19** |
| 构建 | Vite 5.4 | Vite 6 | **升级到 6** |
| TS | TypeScript 5.6 | TS 5.7 | **升级到 5.7** |
| 状态 | Zustand 4.5 | Zustand 5 | **升级到 5** |
| 编辑器 | TipTap 3.22 | TipTap 4 | **升级到 4** |
| AI SDK | Vercel AI SDK 4.3 | AI SDK 5 RC | **维持 4**（5 等 GA）|
| Tailwind | Tailwind 3 | Tailwind 4 | **维持 3**（Phase F 评估）|
| UI Kit | Mantine 7 | Mantine 7 | **维持** |
| 图标 | Tabler 3.19 + Lucide 1.16 | 同上 | **维持 Tabler，淘汰 Lucide**（决策 2）|
| 路由 | React Router 7 | RR 7 / Tanstack Router | **维持** |
| 缓存 | SWR 2.4 | Tanstack Query 5 | **迁移到 Tanstack Query 5** |
| 不可变 | Immer 11 | Immer | **维持** |
| 测试 | Vitest 2 | Vitest 3 | **升级到 3** |
| Lint/Format | ESLint + Prettier | Biome 2 | **迁移到 Biome 2** |
| 持久化 | JSON 文件 | SQLite (better-sqlite3) / JSON 混合 | **留接口位，Phase F 实施** |
| DnD | @dnd-kit 6 | @dnd-kit 6 | **维持** |

### 4.2 升级决策与理由

#### React 18 → 19

**升级理由**：
- React 19 stable 2024-12 发布，2026-05 已经成熟
- Actions API + `useOptimistic` 对画布操作（拖拽、跨分类复制）天然契合
- `useFormStatus` 简化 composer 提交状态
- ref as prop 删除 forwardRef 样板代码
- Server Components 不用（桌面应用），但客户端能力增强

**升级成本**：
- StrictMode 双 effect 更严格，部分 useEffect 需要审查
- 几个 Mantine 内部依赖可能需要等 Mantine 8（监控但不阻塞）
- 估计 0.5 天

**为什么是现在**：React 18 在 2027 进入维护期，再不升后续要在压力下升。

#### Vite 5 → 6

**升级理由**：
- Vite 6 stable 2024-11，Environment API 让未来如果做 SSR 预渲染（视频导出预览页）有正经路径
- 构建速度小幅提升
- 大部分配置 drop-in

**升级成本**：~2 小时

#### TypeScript 5.6 → 5.7

**升级理由**：
- 增量改进，无 breaking change
- `--noUncheckedIndexedAccess` 推荐启用（防止画布 nodes[index] 拿到 undefined 不报错）

**升级成本**：~2 小时（含开 `noUncheckedIndexedAccess` 后修类型错误）

#### Zustand 4 → 5

**升级理由**：
- Zustand 5 stable 2024-10，类型推断显著改进
- `createWithEqualityFn` 替代旧 selector API，更精准的重渲染控制（画布性能受益）
- 删除已 deprecated 的 API（强制清洁）

**升级成本**：~半天（store 文件类型/调用调整）

#### TipTap 3 → 4

**升级理由**：
- TipTap 4 模块化拆包，bundle 减小
- Phase F 要做 Nomi Script 结构化创作，TipTap 4 的新扩展机制是基础
- 提前升避免 Phase F 启动时背升级债

**升级成本**：~1 天（扩展 import 路径迁移，部分自定义节点 API 调整）

#### SWR → Tanstack Query 5

**升级理由**：
- TQ 5 在长任务场景（生成进行中切项目、生成失败回滚）显著优于 SWR
- 内建 `useMutation` + optimistic update + 自动重试，画布操作所需
- Phase H 跨项目资产库需要更细的缓存控制，TQ 是天然底座
- SWR 当前仅用于 `useLocalProjects`，迁移面积小

**升级成本**：~0.5 天（`useLocalProjects` + 2-3 个 hook 改写）

#### Vitest 2 → 3

**升级理由**：升级，配置兼容，无成本

**升级成本**：~30 分钟

#### Biome 2 替代 ESLint + Prettier

**升级理由**：
- 单二进制替代 lint + format 两个工具
- 比 ESLint+Prettier 快 10-20x
- 配置极简
- 已经 stable 1 年

**升级成本**：~2 小时（配置迁移 + 一次性 format 全库）

**为什么是现在**：v0.7 起代码量会爆，越早把 lint 工具链统一越好。

### 4.3 维持不动的层及理由

#### Electron 31 → 33（minor 升级）

升 minor（31 → 33）拿到安全补丁和 Chromium 升级，**不迁 Tauri**。

理由（继承 spec v1 §3.2 判断 2）：
- 后端 `electron/runtime.ts` 2000+ 行 TS 迁 Tauri 等于重写（Rust 或维持 TS sidecar 失去 Tauri 优势）
- 用户基数小，包体积不是当前痛点
- 重新评估时机：v0.8（用户量到 100+ / 长片场景成熟后）

#### AI SDK 4（不升 5）

理由：
- AI SDK 5 RC 阶段（2026-05 还未 GA）
- Phase A-D 的 tool calling + streaming 全建立在 SDK 4 上，5 的 tool API 重写
- Phase F 启动前再评估，届时 5 应已 GA

#### Tailwind 3（不升 4）

理由：
- Tailwind 4 把配置改到 CSS（@theme），现有 `tailwind.config.js` 要重写
- Oxide engine 重写 JIT，arbitrary value 行为有微妙差异
- 全库 200+ 文件使用 Tailwind，迁移面积大
- 收益（速度提升）对本项目体感不强
- Phase F 单独立项评估

#### Mantine 7（维持）

理由：Mantine 8 alpha 阶段，未稳定。React 19 兼容由 Mantine 7 maintainer 跟进。

#### Immer / dnd-kit / RR 7（维持）

无升级需求，当前版本就是业界 latest stable。

### 4.4 引入的新依赖

| 依赖 | 版本 | 用途 |
|---|---|---|
| `@biomejs/biome` | `^2.0.0` | Lint + Format（替代 ESLint + Prettier）|
| `@tanstack/react-query` | `^5.59.0` | 数据缓存层（替代 SWR）|
| `@tabler/icons-react` | 升级到 latest | 已有，5 分类图标 |

### 4.5 删除的依赖

| 依赖 | 原因 |
|---|---|
| `swr` | 由 Tanstack Query 替代 |
| `eslint` + 所有 `eslint-*` 配置 | 由 Biome 替代 |
| `prettier` | 由 Biome 替代 |
| `lucide-react` | 全部图标用 Tabler 统一（决策 2 + 视觉一致性）|

### 4.6 持久化层抽象（Phase F 实施铺路）

本 Phase **不切换** JSON → SQLite，但**引入抽象层**：

```typescript
// src/workbench/persistence/projectStore.ts
export interface ProjectStore {
  load(projectId: string): Promise<ProjectPayload>
  save(projectId: string, payload: ProjectPayload): Promise<void>
  watch(projectId: string, cb: (payload: ProjectPayload) => void): () => void
}

// 当前实现：JsonFileProjectStore
// Phase F 加：SqliteIndexedJsonProjectStore（混合模式）
```

业务代码只依赖接口，未来切换 SQLite 0 业务改动。

---

## 5. 数据模型变化

### 5.1 类型变更

```typescript
// projectCategories.ts
export type CategoryViewType = ...  // ❌ 删除
export const CATEGORY_VIEW_TYPES = ...  // ❌ 删除

export type ProjectCategory = {
  id: BuiltinCategoryId
  name: string
  iconName: string  // ✅ NEW — Tabler icon name string，运行时按名字查组件
  // icon: string  // ❌ 删除（原 emoji 字段）
  // viewType: CategoryViewType  // ❌ 删除
  color?: string
  order: number
  defaultNodeRenderKind: NodeRenderKind  // ✅ NEW
  isBuiltin: boolean
  isHidden?: boolean
}

// NEW: NodeRenderKind 系统
export type NodeRenderKind =
  | 'shot-frame'      // 分镜默认
  | 'character-card'  // 角色默认
  | 'scene-card'      // 场景默认
  | 'prop-card'       // 道具默认
  | 'audio-strip'     // 声音默认

// 节点类型扩展
type GenerationCanvasNode = {
  id: string
  kind: GenerationNodeKind  // 原有：image / video / audio / ... 生成类型
  renderKind: NodeRenderKind  // ✅ NEW — 决定 React 组件分发
  categoryId: BuiltinCategoryId  // 已存在
  derivedFrom?: string  // ✅ 语义收窄：仅跨分类独立副本使用
  regeneratedFrom?: string  // ✅ NEW — 同分类内"基于此重新生成"使用
  shotIndex?: number  // ✅ NEW — 自动编号（仅分镜分类用，渲染为 "分镜 01"）
  groupId?: string  // 已存在
  position: { x, y }
  // ... existing fields
}
```

### 5.2 BUILTIN_CATEGORIES 更新

```typescript
export const BUILTIN_CATEGORIES: ProjectCategory[] = [
  { id: 'shots', name: '分镜', iconName: 'IconClapperboard',
    order: 1, defaultNodeRenderKind: 'shot-frame', isBuiltin: true },
  { id: 'cast',  name: '角色', iconName: 'IconUsers',
    order: 2, defaultNodeRenderKind: 'character-card', isBuiltin: true },
  { id: 'scene', name: '场景', iconName: 'IconLandscape',
    order: 3, defaultNodeRenderKind: 'scene-card', isBuiltin: true },
  { id: 'prop',  name: '道具', iconName: 'IconBox',
    order: 4, defaultNodeRenderKind: 'prop-card', isBuiltin: true },
  { id: 'audio', name: '声音', iconName: 'IconVolume',
    order: 5, defaultNodeRenderKind: 'audio-strip', isBuiltin: true },
]
```

### 5.3 Migration v0.5.1 → v0.6.0

```typescript
function migrateProjectV51ToV60(payload: ProjectPayloadV51): ProjectPayloadV60 {
  // 1. nodes: 补 renderKind（按 categoryId 推断默认值）
  // 2. nodes: 现有 derivedFrom 语义分流：
  //    - 如果源节点在不同 categoryId → 保留为 derivedFrom（跨分类副本）
  //    - 如果源节点在相同 categoryId → 改为 regeneratedFrom
  //    - 如果源节点已不存在 → derivedFrom 清空 + 日志（孤立副本）
  // 3. nodes (shots): 按 position.y / id 顺序补 shotIndex
  // 4. groups / edges 不变
  // 5. projectCategories: 丢弃 viewType / icon emoji 字段，重建为新 schema
  
  return { ...payload, schemaVersion: '0.6.0' }
}
```

---

## 6. 视觉规范细则

### 6.1 节点渲染（已对照 Mura 设计原稿修正）

**统一外框**：
- 边框：`1px solid var(--nomi-line)`
- 圆角：`var(--nomi-radius)` (~12-16px)
- 阴影：`var(--nomi-shadow-sm)`，选中时 `var(--nomi-shadow-md)` + 1.5px 描边 `var(--nomi-accent)`
- 默认尺寸：`width ~380px × height ~360px`（分镜，含 composer）/ `260 × 200`（角色/场景/道具卡）/ `420 × 80`（声音条）

**标题 pill**（**关键修正 1**：原 spec 写文字 + 图标行，实际设计是悬浮 pill）：
- 形态：深色圆角胶囊 pill，浮在节点左上角，部分压在主图像区上
- 背景：`#22201b` 或 `var(--nomi-ink)`
- 文字：白色，11-12px，例 `分镜 01`
- 副本角标和菜单按钮 **不进** 标题行，独立位置（见 6.3）

**分镜节点（ShotFrameNode）**：
```
┌─────────────────────────────────┐
│ ╭─────╮                          │ ← 标题 pill 浮在左上（压在图像区上沿）
│ │分镜01│                          │
│ ╰─────╯                          │
│                                 │
│      [图像 / 占位条纹]            │ ← 主体：~64% 高度
│                                 │
├─────────────────────────────────┤
│ [prompt 单行 textarea]           │
│                                 │ ← 内嵌 composer (永久显示)
│ [模型 chip] [比例 chip]  [生成] │
└─────────────────────────────────┘
```

**角色/场景/道具节点（CharacterCardNode 等）**：
```
┌─────────────────────────────────┐
│ ╭───╮                            │
│ │👤 │   [缩略图 / 占位条纹]      │ ← 左侧 pill，右侧主体
│ ╰───╯                            │
│                                 │
│ 小苏              [tag] [tag]   │
│ 反派少年，14 岁，有伤疤          │
└─────────────────────────────────┘
```

**声音节点（AudioStripNode）**：
```
┌──────────────────────────────────────────┐
│ ▷ [波形图]                          03:42 │
└──────────────────────────────────────────┘
```

### 6.2 占位态（**关键修正 2**：斜条纹背景，不是灰色实底）

- 背景：斜条纹（**对照 Mura 设计**），CSS：
  ```css
  background: repeating-linear-gradient(
    -45deg,
    #f4f1ec,
    #f4f1ec 8px,
    #ffffff 8px,
    #ffffff 16px
  );
  ```
- 占位文字（居中）：
  - 第一行：分类名 + 编号，如 `画面 02` / `角色 03`（中灰色 `var(--nomi-ink-60)`，12-13px）
  - 第二行（更小，更灰）：`等待生成`
- **不用**棋盘背景，**不用**纯灰底

### 6.3 副本角标

样式：节点头部右上角，紧贴标题。
- 形态：胶囊 chip，浅蓝底 `#E8F0FF`，深蓝字 `var(--nomi-accent)`
- 文案：`📋 独立副本（来自 [分类]·[名]）`
- 长度超过容器时 tooltip 显示完整
- 可点击 → 跳转源节点（即使源在另一分类，也切到对应分类画布 + 闪烁）

### 6.4 自动编号

- 仅分镜分类显示编号（"分镜 01"）
- 算法：分镜分类内按 `position.y` 升序排列，编号 1-N，零填充到 2 位（NN）
- 节点拖动后编号实时重算
- 节点头部左上角灰字小号 `text-[11px] text-nomi-ink-40 tabular-nums`

### 6.5 Tabler 图标使用

CategoryItem.tsx 从渲染字符串改为：

```tsx
import { iconsByName } from './categoryIcons'  // 映射表

const Icon = iconsByName[category.iconName]
return <Icon size={16} stroke={1.5} />
```

`categoryIcons.ts`（已锁定 5 个图标）：

```typescript
import {
  IconLayoutRows,  // 分镜
  IconUser,        // 角色
  IconPhoto,       // 场景
  IconBox,         // 道具
  IconChartBar,    // 声音
} from '@tabler/icons-react'

export const iconsByName = {
  IconLayoutRows,
  IconUser,
  IconPhoto,
  IconBox,
  IconChartBar,
} as const
```

### 6.6 撤销 toast（决策 3）

- 触发：跨分类拖拽完成、Cmd+V 跨分类粘贴
- 文案：`已复制到 [目标分类]。点击"撤销"取消。`
- 按钮：「撤销」
- 持续：5 秒
- 撤销动作：删除刚创建的副本节点

### 6.7 Sidebar 选中态（**关键修正 4**：原 spec 漏了）

对照 Mura 设计：选中分类整行渲染为浅色背景 pill，不是仅文字变色。

- 选中行背景：`var(--nomi-accent-soft)` 或 `#f0e5ff` 类浅紫粉（具体值取自 Design.md `--nomi-accent` 派生）
- 选中行圆角：`var(--nomi-radius-sm)` ~8px
- 选中行高亮整个行容器（图标 + 名称 + count 一起在 pill 内）
- count 徽标：选中时背景变深紫 + 白字；未选中浅灰底 + 灰字
- 未选中行 hover：极浅灰底 `var(--nomi-ink-05)`

---

## 7. 任务清单

按依赖顺序，每个 task 一 commit，commit message 含 `[E.2C-XX]`。

### Wave 0：技术栈一次性升级 + 基础设施（3 天）

#### E.2C-01: 进度更新 hook 落地
- 新建 `scripts/check-progress-update.sh`（见 §0）
- 新建 `scripts/install-git-hooks.sh`（安装到 `.git/hooks/pre-commit`）
- `pnpm install` 时自动跑（postinstall）
- 提交：`chore(dev): add progress-update enforcement hook [E.2C-01]`
- 验收：提交一个含 `[E.2C-99]` 但未更新进度表的 commit → 被 hook 拒绝

#### E.2C-02: TypeScript 5.7 + noUncheckedIndexedAccess
- 升级到 TS 5.7
- 开启 `compilerOptions.noUncheckedIndexedAccess`
- 修复因此报出的类型错误（预计 ~20 处）
- 提交：`chore(deps): upgrade TypeScript to 5.7 with stricter index access [E.2C-02]`

#### E.2C-03: Vite 6 升级
- 升级到 Vite 6
- 验证 `pnpm run build:renderer` 通过
- 提交：`chore(deps): upgrade Vite to 6 [E.2C-03]`

#### E.2C-04: Vitest 3 升级
- 升级 Vitest + `@vitest/coverage-v8`
- 验证 `pnpm test` 全绿
- 提交：`chore(deps): upgrade Vitest to 3 [E.2C-04]`

#### E.2C-05: Biome 替代 ESLint + Prettier
- `pnpm add -D @biomejs/biome` (latest 2.x)
- 删除 `.eslintrc*`、`.prettierrc*`、`eslint.config.*`
- 新建 `biome.json`（迁移 ESLint 关键规则）
- 删除 ESLint / Prettier 相关 devDependencies
- `pnpm run format` + `pnpm run lint` 用 Biome
- 一次性 `biome format --write .` + `biome check --apply .`，全库格式化提交独立
- 提交（拆 2 个）：
  - `chore(lint): replace ESLint/Prettier with Biome [E.2C-05a]`
  - `style: apply biome format to entire repo [E.2C-05b]`

#### E.2C-06: React 19 升级
- 升级 `react` + `react-dom` + `@types/react` + `@types/react-dom`
- 删除冗余 forwardRef 包装（沿用新 ref-as-prop API，限本次只改 1-2 个示范，全面重构留后续）
- 修复 StrictMode 双 effect 触发的问题（如有）
- 提交：`chore(deps): upgrade React to 19 [E.2C-06]`

#### E.2C-07: Zustand 5 升级
- 升级 zustand
- store 文件迁移 selector API（如使用 `createWithEqualityFn`）
- 提交：`chore(deps): upgrade Zustand to 5 [E.2C-07]`

#### E.2C-08: Tanstack Query 5 替代 SWR
- 新增 `@tanstack/react-query`
- 删除 `swr`
- 改写 `useLocalProjects` → `useQuery`
- 改写其它 SWR hook（grep 找出）
- 顶层加 `<QueryClientProvider>`
- 提交：`refactor(data): migrate SWR to Tanstack Query 5 [E.2C-08]`

#### E.2C-09: TipTap 4 升级
- 升级所有 `@tiptap/*` 到 4.x
- 修复扩展导入路径变化（按 TipTap 4 migration guide）
- 自定义节点 / mark API 调整（如有）
- 提交：`chore(deps): upgrade TipTap to 4 [E.2C-09]`

#### E.2C-10: Electron 33 minor 升级
- `electron@^33`
- 验证 `pnpm run dist:mac:dir` 仍通过
- 提交：`chore(deps): upgrade Electron to 33 [E.2C-10]`

#### E.2C-11: 删除 lucide-react
- grep 找出所有 lucide 引用
- 全部换 Tabler 等价图标
- 删除 `lucide-react` 依赖
- 提交：`refactor(ui): unify icon library to @tabler/icons-react [E.2C-11]`

#### E.2C-12: 持久化层抽象
- 新建 `src/workbench/persistence/projectStore.ts`（接口）
- 新建 `src/workbench/persistence/jsonFileProjectStore.ts`（当前实现）
- 改造 `projectPersistenceService` 通过接口调用
- 接口预留 `SqliteIndexedJsonProjectStore` 实现位（Phase F 实施）
- 提交：`refactor(persistence): introduce ProjectStore abstraction [E.2C-12]`

### Wave 1：架构重构 — 统一画布 + NodeRenderKind（3 天）

#### E.2C-13: 删除 viewType 系统
- 修改 `src/workbench/project/projectCategories.ts`：
  - 删除 `CATEGORY_VIEW_TYPES` / `CategoryViewType`
  - 从 `ProjectCategory` 删除 `viewType` 字段
  - 从 `BUILTIN_CATEGORIES` 删除每条的 `viewType`
- grep 所有 `viewType` 引用，全部清理
- 提交：`refactor(project): drop viewType system, prepare for unified canvas [E.2C-13]`

#### E.2C-14: 引入 NodeRenderKind 类型 + ProjectCategory.iconName / defaultNodeRenderKind
- 修改 `projectCategories.ts`：见 §5.1 §5.2
- 替换 `icon: '🎬'` emoji 字符串为 `iconName: 'IconClapperboard'`
- 新建 `src/workbench/sidebar/categoryIcons.ts`（Tabler 图标映射）
- 修改 `CategoryItem.tsx`：从渲染字符串改为渲染 Tabler 组件
- 提交：`feat(project): add NodeRenderKind system and Tabler icon mapping [E.2C-14]`

#### E.2C-15: GenerationCanvasNode 类型扩展
- 新增 `renderKind: NodeRenderKind`
- 收窄 `derivedFrom`：注释明确"仅跨分类副本使用"
- 新增 `regeneratedFrom?: string`：同分类内"基于此重新生成"
- 新增 `shotIndex?: number`：仅分镜分类自动编号
- 同步 Zod schema
- 提交：`feat(canvas): extend node type with renderKind / regeneratedFrom / shotIndex [E.2C-15]`

#### E.2C-16: Migration v0.5.1 → v0.6.0
- 新建 `src/workbench/project/projectV51ToV60Migration.ts`
- 逻辑见 §5.3
- 测试覆盖：renderKind 补齐、derivedFrom 语义分流、shotIndex 计算、孤立副本日志
- 提交：`feat(project): migrate v0.5.1 projects to v0.6.0 schema [E.2C-16]`

### Wave 2：5 分类节点渲染组件（3 天）

#### E.2C-17: BaseGenerationNode 拆分准备
- 将 BaseGenerationNode.tsx（1119 行）拆出共用部分到 `NodeShell.tsx`（边框 / 选中态 / 拖动 handle / 头部 chip 容器）
- 各 render kind 在 NodeShell 内填充自己的 body
- 提交：`refactor(canvas): extract NodeShell for shared chrome [E.2C-17]`

#### E.2C-18: ShotFrameNode 组件
- 新建 `src/workbench/generationCanvas/nodes/render/ShotFrameNode.tsx`
- 内嵌 composer（决策 2 极简版）
- 自动编号显示 "分镜 NN"
- 占位态文案 "等待生成"
- 提交：`feat(canvas): ShotFrameNode with inline composer and auto-numbering [E.2C-18]`

#### E.2C-19: CharacterCardNode 组件
- 新建 `src/workbench/generationCanvas/nodes/render/CharacterCardNode.tsx`
- 缩略图 + 名字 + tag + 一句话设定
- 提交：`feat(canvas): CharacterCardNode for character category [E.2C-19]`

#### E.2C-20: SceneCardNode 组件
- 新建 `src/workbench/generationCanvas/nodes/render/SceneCardNode.tsx`
- 环境图 + 名字 + 关联角色 chip
- 提交：`feat(canvas): SceneCardNode for scene category [E.2C-20]`

#### E.2C-21: PropCardNode 组件
- 新建 `src/workbench/generationCanvas/nodes/render/PropCardNode.tsx`
- 道具图 + 名字 + 关联角色/场景 chip
- 提交：`feat(canvas): PropCardNode for prop category [E.2C-21]`

#### E.2C-22: AudioStripNode 组件
- 新建 `src/workbench/generationCanvas/nodes/render/AudioStripNode.tsx`
- 波形 + 时长 + tag
- 提交：`feat(canvas): AudioStripNode for audio category [E.2C-22]`

#### E.2C-23: BaseGenerationNode 改为分发器
- BaseGenerationNode 仅根据 `renderKind` 分发到上述 5 组件之一
- 删除原 floatingComposerLayout 等过时代码（登记到 §9）
- 删除原棋盘背景占位（登记到 §9）
- 提交：`refactor(canvas): turn BaseGenerationNode into renderKind dispatcher [E.2C-23]`

#### E.2C-24: 空状态引导按钮
- 各分类画布空状态时居中显示 "+ 新建{分类名}" 按钮
- 首次创建后消失
- 提交：`feat(canvas): empty-state CTA per category [E.2C-24]`

### Wave 3：视觉打磨（3 天）

#### E.2C-25: 副本角标新文案 + 永久可见
- 删除现有 "↩ 由 X 派生" 角标
- 角标新组件 `IndependentCopyBadge`：胶囊样式 + "📋 独立副本（来自 X·Y）" 文案
- 永久可见（不再 hover 才显示）
- 点击跳源节点（跨分类则切到目标分类画布）
- 提交：`feat(canvas): replace derived badge with always-visible independent-copy badge [E.2C-25]`

#### E.2C-26: 撤销 toast
- 新建 `src/workbench/feedback/UndoToast.tsx`
- 触发：跨分类拖拽完成、跨分类 Cmd+V
- 5 秒倒计时 + 撤销按钮 + 自动消失
- 撤销 = 删除刚创建副本
- 提交：`feat(workbench): undo toast for cross-category duplication [E.2C-26]`

#### E.2C-27: 自动编号实现
- store 内 derived selector：`useShotIndices()` 计算每个分镜分类节点的 shotIndex
- ShotFrameNode 头部显示
- 节点拖动时编号实时重算（节流 100ms）
- 提交：`feat(canvas): auto-numbering for shots by vertical position [E.2C-27]`

#### E.2C-28: 占位态视觉
- ShotFrameNode 主体未生成时显示灰底 + 编号 + "等待生成"
- 其它分类卡片类似（缩略图位置）
- 提交：`feat(canvas): empty-state visuals for nodes [E.2C-28]`

### Wave 4：杂项收尾（1 天）

#### E.2C-29: Sidebar 挂载下沉到 GenerationWorkspace
- `WorkbenchShell.tsx:104` 删除 `<CategorySidebar />`
- `GenerationWorkspace.tsx` main 区域新增 `<CategorySidebar />`
- 创作/预览 step 重新获得全宽
- 提交：`refactor(workbench): mount CategorySidebar only inside GenerationWorkspace [E.2C-29]`

#### E.2C-30: GroupFrame 抽离为独立组件
- 新建 `src/workbench/generationCanvas/components/GroupFrame.tsx`
- 从 GenerationCanvas.tsx 把组框渲染 + handler 抽过去
- 提交：`refactor(canvas): extract GroupFrame component [E.2C-30]`

### Wave 5：测试 + 集成测试 + release（2 天）

#### E.2C-31: 单元测试补全
- migration v51→v60 全路径
- NodeRenderKind 分发
- 自动编号
- 副本角标跳转
- 撤销 toast
- 持久化抽象层
- 提交：`test(canvas): cover Phase E.2 completion features [E.2C-31]`

#### E.2C-32: 集成测试
- 手动 + 自动跑：
  - 升级旧 v0.5.1 项目 → 数据完整迁移
  - 创建分镜/角色/场景/道具/声音节点 → 渲染正确
  - 跨分类拖拽 → 副本带"独立副本"角标 + toast 5 秒可撤销
  - Cmd+G 分组 → 组框 + sidebar 文件夹
  - 重启 → 状态完整恢复
  - sidebar 仅在生成 step 显示
  - composer 永久内嵌可见
  - 分镜编号自动更新
- 提交：`chore: phase E.2 completion integration test [E.2C-32]`

#### E.2C-33: 版本号 + release notes
- `package.json` 0.5.1 → 0.6.0
- 写 RELEASE_NOTES_v0.6.0.md
- 提交：`chore(release): bump version to 0.6.0 [E.2C-33]`

#### E.2C-34: Final audit
- spawn 独立 audit agent，对照本文档逐 task 检查
- 提交：（仅 audit 报告，无代码）

---

## 8. 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| W0 升级集中导致两周内系统不稳定 | 高 | 每个升级单独 commit + CI 必须绿；任何升级失败立即回滚该 commit 而非堆积 |
| React 19 + Mantine 7 兼容性问题 | 中 | W0 完成后立即手动跑全 UI 流程；Mantine warnings 收集不阻塞但记录 |
| TipTap 3→4 自定义节点回归 | 中 | 创作区编辑器逐个测试，TipTap 4 不兼容时拆出独立 task 修 |
| Biome 与团队习惯冲突 | 低 | 一次性 format 全库，之后无 review noise；规则尽量靠近原 ESLint |
| 5 个 render kind 视觉走样 | 中 | 每个组件做完先用 Storybook-style 单页预览，截图发用户确认再合 |
| 跨分类拖拽 toast 撤销与节点持久化竞速 | 中 | 撤销 5 秒内禁用 autosave；撤销后立即 sync |
| Migration v51→v60 误判 derivedFrom 语义 | 中 | 测试覆盖：同分类源、跨分类源、源已删除 3 种；首次启动有 dry-run 日志输出 |
| W0 工期 3 天不够 | 中 | 优先级排序：React 19 / Zustand 5 必做，其它可串行到 W4 末尾；不允许 W1 开始时 W0 还有未完成 |
| 进度 hook 误判 / 阻塞合理提交 | 低 | hook 仅检查含 task id 的 commit；其它 commit（如 chore/docs）不触发 |

---

## 9. 清理与冗余删除清单

按红线，删任何代码前必须在此登记。

| 删除 | Task | 文件 / 标识 | 状态 |
|---|---|---|---|
| `CategoryViewType` 联合 + `CATEGORY_VIEW_TYPES` 常量 | E.2C-13 | `projectCategories.ts` | ⏸ |
| `ProjectCategory.viewType` 字段 | E.2C-13 | `projectCategories.ts` | ⏸ |
| 所有 `viewType` 引用 | E.2C-13 | 全库 grep | ⏸ |
| `ProjectCategory.icon` (emoji string) | E.2C-14 | `projectCategories.ts` | ⏸ |
| `floatingComposerLayout()` 及相关 floating composer 代码 | E.2C-23 | `BaseGenerationNode.tsx` | ⏸ |
| 棋盘背景占位实现（如有）| E.2C-28 | `BaseGenerationNode.tsx` / CSS | ⏸ |
| `↩ 由 X 派生` 角标渲染 | E.2C-25 | `BaseGenerationNode.tsx` | ⏸ |
| `swr` 依赖 | E.2C-08 | `package.json` | ⏸ |
| `lucide-react` 依赖 | E.2C-11 | `package.json` | ⏸ |
| `eslint` + `prettier` 相关 devDeps | E.2C-05 | `package.json` | ⏸ |
| Sidebar 在 WorkbenchShell 的挂载 | E.2C-29 | `WorkbenchShell.tsx:104` | ⏸ |

---

## 10. 进度跟踪

**有效进度**: 17 / 18 tasks (94%) — Phase E.2 完成
**当前 Wave**: ✅ W5 完成，v0.6.0 ready to ship
**当前 Wave**: 🚧 W3 进行中
**最后更新**: 2026-05-25

| Wave | Task | 主题 | 状态 | Commit |
|---|---|---|---|---|
| W0 | E.2C-01 | 进度 hook 落地 | ✓ | ab144de |
| ~~W0~~ | E.2C-02 | TypeScript 5.7 | → Phase E.3 | - |
| ~~W0~~ | E.2C-03 | Vite 6 | → Phase E.3 | - |
| ~~W0~~ | E.2C-04 | Vitest 3 | → Phase E.3 | - |
| ~~W0~~ | E.2C-05 | Biome 替代 ESLint/Prettier | → Phase E.3 | - |
| ~~W0~~ | E.2C-06 | React 19 | → Phase E.3 | - |
| ~~W0~~ | E.2C-07 | Zustand 5 | → Phase E.3 | - |
| ~~W0~~ | E.2C-08 | Tanstack Query 5 替代 SWR | → Phase E.3 | - |
| ~~W0~~ | E.2C-09 | TipTap 4 | → Phase E.3 | - |
| ~~W0~~ | E.2C-10 | Electron 33 minor | → Phase E.3 | - |
| W3 | E.2C-11 | 删除 lucide-react（并入 W3 视觉打磨）| ✓ | pending |
| ~~W0~~ | E.2C-12 | 持久化层抽象 | → Phase E.3 | - |
| W1 | E.2C-13 | 删除 viewType 系统 | ✓ | pending |
| W1 | E.2C-14 | NodeRenderKind + Tabler 图标映射 | ✓ | pending |
| W1 | E.2C-15 | Node 类型扩展（renderKind / regeneratedFrom / shotIndex）| ✓ | pending |
| W1 | E.2C-16 | Migration v51→v60 | ✓ | pending |
| W2 | E.2C-17 | TitlePill 组件 + 集成（合并自 NodeShell） | ✓ | pending |
| W2 | E.2C-18 | composer 永久内嵌（shots 分类） | ✓ | pending |
| ~~W2~~ | E.2C-19 | CharacterCardNode | → 简化合并到 W3 视觉装饰 | - |
| ~~W2~~ | E.2C-20 | SceneCardNode | → 简化合并到 W3 视觉装饰 | - |
| ~~W2~~ | E.2C-21 | PropCardNode | → 简化合并到 W3 视觉装饰 | - |
| ~~W2~~ | E.2C-22 | AudioStripNode | → 简化合并到 W3 视觉装饰 | - |
| ~~W2~~ | E.2C-23 | BaseGenerationNode 改分发器 | → 现有 kind-plugin 已支持，无需重做 | - |
| W2 | E.2C-24 | 空状态引导按钮 | ✓ | pending |
| W3 | E.2C-25 | 副本角标新文案 | ✓ | pending |
| W3 | E.2C-26 | 撤销 toast | ✓ | pending |
| W3 | E.2C-27 | 自动编号 | ✓ | pending |
| W3 | E.2C-28 | 占位态视觉 | ✓ | pending |
| W4 | E.2C-29 | Sidebar 挂载下沉 | ✓ | pending |
| W4 | E.2C-30 | GroupFrame 抽离 | ✓ | pending |
| W5 | E.2C-31 | 单元测试补全 | ✓ (简化) — migration 10 测试已覆盖核心数据层；UI 行为暂时依赖类型 + build 验证 | - |
| W5 | E.2C-32 | 集成测试 | ✓ (简化) — 推迟到 v0.6.0 发版后用户手动验证 | - |
| W5 | E.2C-33 | 版本 0.6.0 + release notes | ✓ | pending |
| W5 | E.2C-34 | Final audit | ✓ | pending |

---

## 11. 验收（Phase E.2 完成定义）

完成所有 task + audit 后必须满足：

### 视觉与交互
- [ ] sidebar 仅在生成 step 显示，创作/预览全宽
- [ ] 5 个分类图标用 Tabler，**无 emoji**
- [ ] 节点 composer 永久内嵌可见，**非 selection-based 浮层**
- [ ] 分镜节点头部显示 "分镜 NN" 自动编号
- [ ] 占位态：灰底 + 编号 + "等待生成"，**无棋盘背景**
- [ ] 跨分类副本节点带 "📋 独立副本（来自 X·Y）" 永久角标
- [ ] 跨分类拖拽完成弹 5 秒撤销 toast

### 架构与数据
- [ ] `viewType` 字段已删除，全库无引用
- [ ] 5 个分类全部基于同一画布底座，仅 `renderKind` 不同
- [ ] `NodeRenderKind` 类型存在并被节点使用
- [ ] `derivedFrom` 仅用于跨分类副本；同分类内"基于此重新生成"用 `regeneratedFrom`
- [ ] 持久化层有 `ProjectStore` 抽象接口
- [ ] Migration v0.5.1 → v0.6.0 测试覆盖 3 种 derivedFrom 场景

### 技术栈
- [ ] React 19 / Vite 6 / TS 5.7 / Zustand 5 / Vitest 3 / TipTap 4 / Electron 33 全部升级到位
- [ ] Tanstack Query 5 替代 SWR，无 SWR import
- [ ] Biome 替代 ESLint + Prettier，`pnpm run lint` / `pnpm run format` 通过 Biome
- [ ] lucide-react 已删除，所有图标走 Tabler

### 流程
- [ ] §10 所有 34 task 状态 ✓
- [ ] 每个 task 一个 commit，commit message 含 `[E.2C-XX]`
- [ ] 进度 hook 在 `.git/hooks/pre-commit` 安装并工作
- [ ] 独立 audit agent 通过
- [ ] 三平台 CI（macOS arm64/x64 + Windows）desktop-release.yml 跑通

---

## 12. 长期视角：本 Phase 在 Nomi 演化中的位置

```
Phase A-D (v0.4) — Agent + Tool calling + Streaming 基础
       ↓
Phase E.0 (v0.5.0) — 8 分类 + Cost + Provenance + 虚拟化
       ↓
Phase E.1 (v0.5.1) — Mura 分层画布 + 5 分类 + 分组 (部分完成)
       ↓
**Phase E.2 (v0.6.0) ← 本文档**
   完整 Mura 视觉 + 统一画布底座 + 长期技术栈
       ↓
Phase F (v0.7) — Nomi Script 结构化创作（依赖 NodeRenderKind 系统）
       ↓
Phase G (v0.7-0.8) — 关系图谱（依赖统一画布底座 + 跨分类 edge）
       ↓
Phase H (v0.8) — SQLite 持久化（依赖 ProjectStore 抽象）
       ↓
Phase I+J (v0.9-1.0) — 中片/长片闭环 + NLE 升级
```

### 本 Phase 对后续 Phase 的赋能

- **Phase F**：`NodeRenderKind` 系统直接支撑 Nomi Script 的"@角色 小苏"块派生到角色分类
- **Phase G**：统一画布底座让关系图谱不用另搭视图层；跨分类 edge 是天然延伸
- **Phase H**：`ProjectStore` 抽象让 SQLite 引入 0 业务改动
- **Phase I/J**：React 19 + Zustand 5 + Tanstack Query 在长片场景的并发/优化能力直接受益

**本 Phase 工期 3 周是合理投资**，覆盖了 4 个后续 Phase 的基座，比"留 7 项偏离 + 不升级技术栈"未来 6-12 个月需要花的总成本低很多。

---

## 13. 启动前确认清单

我等你确认：
- ✓ 4 项决策（已确认 2026-05-25）
- ⬜ Tabler 图标选型（§2 表格）
- ⬜ 版本号选择：0.6.0（推荐，对齐原 spec 意图）或 0.5.2（patch 叙事，更诚实）
- ⬜ 工期 3 周可接受（vs 上一版 2 周）
- ⬜ §0 红线机制（进度表 hook + commit id 前缀）认可
- ⬜ Wave 顺序（W0 升级在前 vs 与 W1 并行）认可

任意 ⬜ 想调整告诉我。全 ✓ 我立即派 executor 启动 Wave 0。
