# Nomi 任意文件夹 Workspace 项目实施计划

> 裁决：已被现行 Workspace/Project Explorer 实现取代；证据：`electron/workspace/workspaceIpc.ts:97-120`、`src/workbench/explorer/ProjectExplorerSidebar.tsx:21-52`。

> **For Hermes:** 后续执行必须使用 `test-driven-development` + `subagent-driven-development`。每个任务先写失败测试，确认 RED，再写最小实现，确认 GREEN，再重构。每个完成且验证通过的 Wave 单独提交 commit。

**Goal:** 把 Nomi 从“固定 `~/Documents/Nomi Projects` 下管理项目”升级为“用户选择任意文件夹作为项目 Workspace，所有生成文件写入该文件夹，并在左侧统一项目面板中显示该文件夹的文件树”。

**Architecture:** 采用 Workspace Manifest 架构：用户文件夹是项目根目录，Nomi 私有元数据放在 `.nomi/`，生成资产进入 `assets/generated/`，导出进入 `exports/`。Electron main 侧作为唯一文件系统边界，renderer 只通过 `projectId + relativePath` 访问，不直接操作绝对路径。

**Tech Stack:** Electron main/preload IPC + Node `fs/path/crypto` + React 18 + TypeScript + Zustand + SWR + Zod + Vitest。P0 不引入 SQLite；文件目录树先用受限递归扫描，P1 再考虑 `chokidar` 实时监听。

---

## 0. 产品与架构原则

### 0.1 用户价值硬约束

这次改造必须满足用户真实心智：

1. 用户选择哪个文件夹，Nomi 就在这个文件夹工作。
2. 生成的图片、视频、导出文件都能在系统 Finder 里直接看到。
3. Nomi 左侧目录树能看到文件夹内的文本、图片、视频。
4. 删除“项目引用”不能误删用户整个文件夹。
5. 路径丢失、权限失效、文件被外部移动时，UI 要给清晰状态，而不是静默失败。

### 0.2 设计系统约束

设计必须基于现有设计文档：

- `Design.md`
  - light-only
  - dense production workspace
  - no fake progress
  - local project and asset visibility obvious
- `src/design/README.md`
  - 共享视觉 primitives 统一从 `src/design` 入口使用
  - 不在 feature 页面重复造样式
  - `WorkbenchButton` / `WorkbenchIconButton` 用于 workbench 密集操作区
  - `DesignModal` / `DesignDrawer` 用于弹窗/抽屉

目录树 UI 要保持 Nomi 当前“本地优先、高密度创作工具”的风格，不做营销式大卡片。

### 0.3 架构硬约束

1. 不把新逻辑继续堆进 `electron/runtime.ts`。
2. 新增 workspace 模块，逐步迁移旧项目路径逻辑。
3. 不能长期保留两套并行项目系统。
4. 如果新架构替换旧逻辑，必须删除旧 helper 或改成薄适配层。
5. 所有生产代码必须有测试先行。
6. 所有路径解析必须在 main 侧做安全校验。
7. renderer 不能拿绝对路径去任意读写文件。


### 0.4 多 Agent Review 后的 P0 修订

本计划已由三类专门 Agent 对照设计文档与代码完成审阅：

- **用户价值 / 产品 Agent**：检查真实用户路径、迁移体验、失败状态、删除语义。
- **设计系统 / UI Agent**：检查 `Design.md`、`src/design` primitives、生成区布局、文件树交互。
- **架构 / TDD / 代码质量 Agent**：检查 main/renderer 边界、路径安全、旧 fixed-root 替换、测试切分。

审阅后形成以下 P0 修订，后续实现必须以这些修订为准：

1. **Manifest 不以绝对路径为项目真相**
   - `.nomi/project.json` 是可迁移项目元数据，不应 required `rootPath`。
   - 当前 workspace root 由“用户本次选择/打开的文件夹路径”决定。
   - `recent-workspaces.json` 可以保存本机绝对 `rootPath`，因为它只是最近项目引用。
   - 若 manifest 需要记录路径，只能使用 `lastKnownRootPath?: string` 作为 debug / relink 提示，不参与安全边界判断。

2. **任意文件夹必须有完整用户路径**
   - 打开空文件夹：提示将创建 `.nomi/`、`assets/`、`exports/`，确认后初始化。
   - 打开已有素材文件夹：不移动、不删除、不重命名已有文件；文件树显示已有文本/图片/视频。
   - 打开已有 Nomi workspace：直接复用 `.nomi/project.json`，刷新 recent registry。
   - 打开旧版 Nomi 项目：升级为 workspace，但不移动旧资产；旧资产继续可见，新生成物进入 `assets/generated/`。
   - 最近项目路径丢失：项目库显示 missing 状态，提供“重新定位文件夹”和“从项目库移除”。

3. **删除语义提前收口**
   - 新 workspace 语义下，普通删除必须改为“从项目库移除”。
   - 不得递归删除用户选择的 workspace folder。
   - UI 禁止继续使用“项目文件夹和本地资源会一起删除”这类文案。
   - 如仍需 legacy cleanup，必须是独立 API，不能混入普通项目删除流程。

4. **文件树是物理文件树，不是分类目录树**
   - `CategorySidebar` 表示画布分类 / 创作组织。
   - `ProjectFileTree` 表示 workspace 磁盘文件。
   - P0 不做自动归类、不做 Nomi Script、不做关系图谱、不替代结构化创作 PRD。
   - UI 文案统一使用“项目文件”或“文件夹内容”，避免与“分类目录”混淆。

5. **文件树必须有真实状态**
   - loading：不显示假进度。
   - empty：文件夹没有可用素材。
   - error：权限/读取失败，不能伪装成 empty。
   - missing：workspace 文件夹不存在或已移动。
   - truncated：大目录被截断时必须显示用户可理解提示。
   - 生成/导入/导出完成后主动触发刷新；P0 可不做实时监听。

### 0.5 统一 Project Explorer 设计约束

最终设计决策：**不要新增第二个左侧栏，也不要把分类树和文件树混成同一套数据模型。**

P0 必须把现有 `CategorySidebar` 升级为统一左侧项目面板：

```txt
ProjectExplorerSidebar
  ExplorerHeader: 项目
  ExplorerTabs: [分类] [文件]
  ExplorerContent:
    CategoryExplorerPanel | WorkspaceFileExplorerPanel
```

合并原则：

1. **合并 UI 容器，不合并数据模型**
   - `CategoryExplorerPanel` 表示画布分类 / 创作组织。
   - `WorkspaceFileExplorerPanel` 表示 workspace 磁盘文件。
   - 两者共享左侧容器、折叠、宽度、视觉框架。
   - 两者保留独立状态：`activeCategoryId` 不等于 `selectedFileRelativePath`。

2. **位置与语义**
   - `ProjectExplorerSidebar` 位于 `WorkbenchShell` body 的左侧，替换现有 `CategorySidebar`。
   - `GenerationWorkspace` 继续只负责 canvas、AI sidebar、timeline，不再额外内嵌 `ProjectFileTree` 左栏。
   - 左侧栏标题使用“项目”，tab 使用“分类 / 文件”。
   - 文件 tab 内标题或 aria 使用“项目文件”。

3. **默认 tab 策略**
   - `creation` mode 默认打开“分类”。
   - `generation` mode 默认打开“文件”。
   - `preview` mode 默认打开“文件”。
   - 用户手动切换后可持久化 `activeExplorerPanel`，但首次进入不同 mode 要给合理默认值。

4. **尺寸与响应式**
   - 默认宽度：`240px`。
   - 最小宽度：`200px`。
   - 最大宽度：`320px`。
   - 折叠宽度沿用现有 `60px`。
   - P0 不做两个左侧栏并排。
   - `>=1280px`：统一 Project Explorer + Canvas + AI sidebar 可同时显示。
   - `960px - 1279px`：优先保证 Canvas，AI sidebar 可进入 overlay。
   - `<960px`：Project Explorer 默认折叠或使用 `DesignDrawer`。
   - `<700px`：Project Explorer 不允许固定占据画布列。

5. **折叠行为**
   - 折叠后显示分类 / 文件两个 icon 入口。
   - 点击 icon 时展开 sidebar，并切换到对应 panel。
   - 折叠状态属于 `ProjectExplorerSidebar`，不是分类树或文件树某一个 panel 的私有状态。

6. **视觉 token 与 primitives**
   - workbench 内优先使用 `--workbench-*` token：`--workbench-bg`、`--workbench-surface`、`--workbench-border`、`--workbench-muted`、`--workbench-ink`、`--workbench-hover`、`--workbench-pressed`、`--workbench-focus`、`--workbench-danger`。
   - 刷新、折叠、Finder 操作用 `WorkbenchIconButton`。
   - 面板内 secondary action 用 `WorkbenchButton`。
   - 初始化确认用 `DesignModal`。
   - missing / warning 状态使用 `StatusBadge` 或现有状态组件。
   - 不新增 feature-local 基础按钮样式。

7. **文件行密度**
   - row height：`28px`。
   - header height：`36px`。
   - icon size：`16px`。
   - indent step：`14px` 或 `16px`。
   - 文件名单行 ellipsis，完整名称放入 `title`。
   - focus-visible 必须可见。

8. **P0 点击行为**
   - 分类 panel 保持现有分类点击 / node drag-drop 行为。
   - 文件 panel 单击只选中文件行。
   - 文件 panel 双击默认 Reveal in Finder。
   - 右键菜单、拖拽文件到画布、文件预览、缩略图列为 P1。

9. **P1 增强，不进入 P0**
   - 宽屏 split 模式：同一个 Project Explorer 内上下分区同时显示“分类”和“文件”。
   - 文件拖拽到 canvas。
   - 文件搜索。
   - 文本/图片/视频预览。
   - 文件与分类/画布节点的引用关系。

### 0.6 路径安全与真相源原则

1. 所有 workspace 相关路径解析只在 Electron main 侧完成。
2. renderer 只传 `projectId + relativePath`，不能传绝对路径请求任意读写。
3. 路径校验必须拒绝：
   - `..`
   - 绝对路径
   - Windows drive / UNC path
   - `\0`
   - 空 segment / 异常 `.` segment
   - symlink 逃逸到 workspace 外部
4. `.nomi/`、`assets/`、`exports/` 必须共享同一套 path guard，不允许各自实现一套边界判断。
5. `.nomi/project.json` 是项目元数据真相；`recent-workspaces.json` 是本机最近打开索引。
6. registry 指向的 folder 缺失时保留条目并标记 missing，不得静默删除。
7. duplicate project id / manifest 与 registry 冲突必须进入显式冲突态或报错，不能静默覆盖。

### 0.7 用户价值验收场景

P0 完成后必须用以下 Given/When/Then 验收：

1. **空文件夹成为项目**
   - Given 用户有空文件夹 `MyFilm`
   - When 用户点击“打开文件夹”并选择 `MyFilm`
   - Then Nomi 提示将创建 `.nomi/`、`assets/`、`exports/`
   - And 用户确认后进入工作台

2. **已有素材文件夹成为项目**
   - Given 文件夹里已有 `script.md`、`ref.png`、`shot.mp4`
   - When 用户把该文件夹作为 Nomi 项目打开
   - Then 左侧“项目文件”显示这三个文件
   - And Nomi 不移动、不删除、不重命名已有文件

3. **生成物落在用户文件夹**
   - Given 用户已打开 workspace
   - When 用户生成图片或视频
   - Then 文件写入 `<workspace>/assets/generated/YYYY-MM-DD/`
   - And 左侧项目文件刷新后可见
   - And Finder 中可直接看到该文件

4. **导出物落在用户文件夹**
   - Given 用户已打开 workspace
   - When 用户导出视频
   - Then 导出文件写入 `<workspace>/exports/`

5. **移除项目不会删除文件夹**
   - Given 项目库里有一个 workspace 项目
   - When 用户点击“从项目库移除”
   - Then Nomi 只删除 recent registry entry
   - And 用户的文件夹仍完整存在

6. **文件夹被移动后可恢复**
   - Given 项目文件夹被外部移动
   - When 用户从项目库打开该项目
   - Then 卡片显示“文件夹已移动或不可访问”
   - And 用户可以重新定位文件夹
   - And 重新定位成功后项目可打开

7. **旧项目迁移不丢资产**
   - Given 用户有旧版 Nomi 项目
   - When 用户用新版 Nomi 打开
   - Then Nomi 创建 `.nomi/project.json`
   - And 旧资产仍可见
   - And 新生成物写入 `assets/generated/YYYY-MM-DD/`

---

## 1. 当前代码基线

### 1.1 当前固定项目根目录

文件：`electron/runtime.ts`

当前逻辑：

```ts
const PROJECT_FILE = "project.json";
const PROJECT_ROOT_ENV = "NOMI_PROJECTS_DIR";

function getProjectsRoot(): string {
  const configured = String(process.env[PROJECT_ROOT_ENV] || "").trim();
  return configured || path.join(app.getPath("documents"), "Nomi Projects");
}
```

问题：只能从固定 root 扫描项目，不能真正支持任意 folder-as-project。

### 1.2 当前项目查找逻辑

文件：`electron/runtime.ts`

当前逻辑：

```ts
function projectDirById(projectId: string): string | null {
  const root = getProjectsRoot();
  ensureDir(root);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const projectFile = path.join(root, entry.name, PROJECT_FILE);
    if (!fs.existsSync(projectFile)) continue;
    const record = readJson<ProjectRecord | null>(projectFile, null);
    if (record?.id === projectId) return path.join(root, entry.name);
  }
  return null;
}
```

目标：改为 workspace registry / manifest 定位。

### 1.3 当前资产写入逻辑

文件：`electron/runtime.ts`

当前逻辑：

```ts
function uniqueAssetPath(projectId: string, fileName: string) {
  const projectDir = projectDirById(projectId);
  const today = new Date().toISOString().slice(0, 10);
  const assetDir = path.join(projectDir, "assets", today);
}
```

目标：生成资产统一写入：

```txt
<workspace>/assets/generated/YYYY-MM-DD/
```

手动导入资产进入：

```txt
<workspace>/assets/imported/YYYY-MM-DD/
```

导出文件进入：

```txt
<workspace>/exports/
```

### 1.4 当前 UI 布局

相关文件：

- `src/workbench/WorkbenchShell.tsx`
- `src/workbench/sidebar/CategorySidebar.tsx`
- `src/workbench/generation/GenerationWorkspace.tsx`

当前结构是：

```txt
WorkbenchShell
  CategorySidebar          # 只承载画布分类
  GenerationWorkspace      # 画布 + AI 侧栏 + 时间轴
```

最终目标不是在 `GenerationWorkspace` 内再塞一个第二左栏，而是把 `CategorySidebar` 升级为统一 `ProjectExplorerSidebar`：

```txt
WorkbenchShell
  ProjectExplorerSidebar
    [分类] CategoryExplorerPanel
    [文件] WorkspaceFileExplorerPanel
  GenerationWorkspace
    GenerationCanvas
    AI Sidebar
    TimelinePanel
```

这样 UI 上只有一个左侧项目面板；分类树和文件树通过 tab 切换，底层数据模型保持分离。

---

## 2. 目标目录结构

用户选择文件夹后，Nomi 初始化：

```txt
用户选择的文件夹/
  .nomi/
    project.json
    settings.json
    index.json              # P0 可选，可后置
    jobs/
    cache/
      thumbnails/
  assets/
    generated/
      2026-05-31/
    imported/
      2026-05-31/
  exports/
  用户自己的文本、图片、视频...
```

### 2.1 `.nomi/project.json` 目标 schema

文件：新增 `electron/workspace/workspaceTypes.ts`

```ts
export type WorkspaceProjectRecordV2 = {
  id: string;
  name: string;
  version: 2;
  createdAt: number;
  updatedAt: number;
  savedAt: number;
  revision: number;
  lastKnownRootPath?: string; // debug / relink hint only; not a security boundary
  payload?: unknown;
};
```

### 2.2 最近项目 registry

位置：`app.getPath("userData")/recent-workspaces.json`

```ts
export type RecentWorkspaceEntry = {
  id: string;
  name: string;
  rootPath: string;
  lastOpenedAt: number;
  missing?: boolean;
};
```

registry 只保存“最近打开引用”，不是项目真相。真相在 `.nomi/project.json`。但 `.nomi/project.json` 也不能把某台机器上的绝对路径当作安全边界；有效 workspace root 永远来自用户本次选择/打开的文件夹。

---

## 3. 测试策略总则

### 3.1 TDD 铁律

每个生产代码任务必须按这个顺序：

1. 写失败测试。
2. 运行单测，确认失败原因正确。
3. 写最小实现。
4. 运行单测，确认通过。
5. 运行相关测试文件，确认无回归。
6. 必要时重构。
7. Wave 完成后运行 `pnpm test` 或相关全量测试。

### 3.2 测试命令

项目使用 Vitest：

```bash
pnpm test -- electron/workspace/workspacePaths.test.ts
pnpm test -- electron/workspace/workspaceManifest.test.ts
pnpm test -- electron/workspace/workspaceRepository.test.ts
pnpm test -- src/workbench/explorer/ProjectExplorerSidebar.test.tsx
pnpm test
pnpm run build
```

如果新增 React 组件测试需要 testing-library，而项目当前没有，则 P0 先测试纯函数和 hook 层；组件视觉交互以可测状态结构为主，不为了测试引入过重依赖。

### 3.3 测试覆盖边界

必须覆盖：

- 正常打开空文件夹
- 打开已有 `.nomi/project.json` 的文件夹
- 非空普通文件夹初始化
- rootPath missing
- 路径逃逸：`../outside.png`
- symlink 策略
- assets/generated 写入位置
- exports 写入位置
- 文件树只展示允许类型
- 大目录扫描限制
- 删除项目只移除 recent entry，不删除用户目录
- 旧项目迁移路径

---

## 4. Wave 1 — Workspace 路径与 Manifest 基础

**目标:** 建立新的 workspace 基础模块，先不接 UI，不改生成逻辑。

**用户价值:** 为“任意文件夹即项目”建立正确底座，避免在旧 fixed-root 上打补丁。

**架构价值:** 从 `electron/runtime.ts` 拆出路径、manifest、registry，避免继续膨胀。

### Task 1.1: 新建 workspace 类型定义

**Files:**

- Create: `electron/workspace/workspaceTypes.ts`
- Test: `electron/workspace/workspaceTypes.test.ts`

**RED:** 测试 `isWorkspaceProjectRecordV2` 或 Zod schema 能接受不含绝对 `rootPath` 的可迁移 manifest，并拒绝错误 `version` / 缺少必填元数据的输入。

测试点：

```ts
it('accepts records without rootPath because manifest is portable', () => {})
it('accepts a valid v2 workspace record with optional lastKnownRootPath', () => {})
it('normalizes missing revision and savedAt defaults', () => {})
```

**GREEN:** 实现：

- `workspaceProjectRecordSchema`
- `normalizeWorkspaceProjectRecord(input, rootPath)`
- `RecentWorkspaceEntry` 类型/schema

**Verify:**

```bash
pnpm test -- electron/workspace/workspaceTypes.test.ts
```

### Task 1.2: 新建安全路径模块

**Files:**

- Create: `electron/workspace/workspacePaths.ts`
- Test: `electron/workspace/workspacePaths.test.ts`

**RED:** 先写路径逃逸测试：

```ts
it('resolves a relative path inside workspace root', () => {})
it('rejects parent directory traversal', () => {})
it('rejects absolute paths as relative input', () => {})
it('keeps .nomi internal paths explicit', () => {})
```

**GREEN:** 实现：

```ts
export function assertInsideWorkspace(rootPath: string, targetPath: string): string
export function resolveWorkspaceRelativePath(rootPath: string, relativePath: string): string
export function workspaceNomiDir(rootPath: string): string
export function workspaceProjectFile(rootPath: string): string
export function workspaceAssetsGeneratedDir(rootPath: string, date?: Date): string
export function workspaceAssetsImportedDir(rootPath: string, date?: Date): string
export function workspaceExportsDir(rootPath: string): string
```

**Refactor:** 路径模块不得 import Electron `app`，保持纯函数可测。

**Verify:**

```bash
pnpm test -- electron/workspace/workspacePaths.test.ts
```

### Task 1.3: 新建 Manifest 读写模块

**Files:**

- Create: `electron/workspace/workspaceManifest.ts`
- Test: `electron/workspace/workspaceManifest.test.ts`

**RED:** 测试初始化行为：

```ts
it('initializes .nomi/project.json in an empty folder', () => {})
it('reuses an existing workspace manifest', () => {})
it('creates assets and exports directories', () => {})
it('does not overwrite an existing manifest id', () => {})
```

**GREEN:** 实现：

```ts
export function hasWorkspaceManifest(rootPath: string): boolean
export function readWorkspaceManifest(rootPath: string): WorkspaceProjectRecordV2 | null
export function writeWorkspaceManifest(rootPath: string, record: WorkspaceProjectRecordV2): WorkspaceProjectRecordV2
export function initializeWorkspace(rootPath: string, input?: { name?: string; payload?: unknown }): WorkspaceProjectRecordV2
export function ensureWorkspaceFolders(rootPath: string): void
```

**Verify:**

```bash
pnpm test -- electron/workspace/workspaceManifest.test.ts
```

### Task 1.4: 新建 Recent Workspace Registry

**Files:**

- Create: `electron/workspace/workspaceRegistry.ts`
- Test: `electron/workspace/workspaceRegistry.test.ts`

**RED:** 测试 registry 行为：

```ts
it('stores recent workspaces sorted by lastOpenedAt desc', () => {})
it('dedupes by project id', () => {})
it('marks missing root paths without deleting entries', () => {})
it('removes a workspace reference without deleting the folder', () => {})
```

**GREEN:** 实现：

```ts
export function recentWorkspacesPath(settingsRoot: string): string
export function listRecentWorkspaces(settingsRoot: string): RecentWorkspaceEntry[]
export function rememberWorkspace(settingsRoot: string, record: WorkspaceProjectRecordV2): RecentWorkspaceEntry[]
export function removeWorkspaceReference(settingsRoot: string, projectId: string): RecentWorkspaceEntry[]
```

**Verify:**

```bash
pnpm test -- electron/workspace/workspaceRegistry.test.ts
```

### Wave 1 完成标准

- [ ] 所有新增 workspace 纯模块测试通过
- [ ] `electron/runtime.ts` 还没有行为变更，避免大爆炸
- [ ] 没有 UI 改动
- [ ] commit：`feat: add workspace manifest foundation`

---

## 5. Wave 2 — Repository 替换 fixed-root 项目定位

**目标:** 让现有 `projects.list/read/create/save/delete` 可以走 workspace repository，同时保留旧项目迁移入口，但不长期两套并行。

**用户价值:** 让项目可以真正定位到任意 folder。

**架构价值:** 替换 `projectDirById` 的 fixed-root 扫描。

### Task 2.1: 新建 workspace repository

**Files:**

- Create: `electron/workspace/workspaceRepository.ts`
- Test: `electron/workspace/workspaceRepository.test.ts`

**RED:** 测试核心行为：

```ts
it('creates a project in the selected root path', () => {})
it('reads a project by id through recent registry', () => {})
it('saves payload into .nomi/project.json', () => {})
it('removes a project reference without deleting rootPath', () => {})
it('returns missing=true when the folder no longer exists', () => {})
```

**GREEN:** 实现：

```ts
export type WorkspaceRepositoryDeps = {
  settingsRoot: string;
  defaultProjectsRoot: string;
};

export function createWorkspaceProject(input: { rootPath: string; record: unknown }, deps: WorkspaceRepositoryDeps): WorkspaceProjectRecordV2
export function listWorkspaceProjects(deps: WorkspaceRepositoryDeps): Array<Omit<WorkspaceProjectRecordV2, 'payload'>>
export function readWorkspaceProject(projectId: string, deps: WorkspaceRepositoryDeps): WorkspaceProjectRecordV2 | null
export function saveWorkspaceProject(projectId: string, record: unknown, deps: WorkspaceRepositoryDeps): WorkspaceProjectRecordV2
export function removeWorkspaceProjectReference(projectId: string, deps: WorkspaceRepositoryDeps): { id: string; deleted: boolean }
export function resolveWorkspaceProjectDir(projectId: string, deps: WorkspaceRepositoryDeps): string | null
```

**重要:** `delete` 的语义改成 remove reference，不递归删除用户根目录。旧 fixed-root 项目迁移期可以另设 `deleteLegacyProjectFolder`，但不能混进普通删除。

**Verify:**

```bash
pnpm test -- electron/workspace/workspaceRepository.test.ts
```

### Task 2.2: 接入 `electron/runtime.ts` 项目 API

**Files:**

- Modify: `electron/runtime.ts`
- Test: `electron/runtime.workspace-projects.test.ts` 或扩展现有 runtime 测试

**RED:** 针对 runtime 导出函数写测试：

```ts
it('createProject accepts rootPath and writes .nomi/project.json', () => {})
it('readProject finds workspace project outside default projects root', () => {})
it('saveProject updates workspace manifest payload', () => {})
it('deleteProject only removes recent reference for workspace projects', () => {})
```

**GREEN:** 修改：

- `createProject(input)` 检测 `input.rootPath`
- `listProjects()` 读 workspace registry
- `readProject(projectId)` 走 repository
- `saveProject(projectId, input)` 走 repository
- `deleteProject(projectId)` 改为 remove reference
- `projectDirById(projectId)` 改为调用 `resolveWorkspaceProjectDir`

**删除/收敛旧逻辑:**

- 原 fixed root 扫描逻辑不能继续作为主路径。
- 保留 `getProjectsRoot()` 只作为 legacy/default create fallback。
- 旧 `PROJECT_FILE` root 直存模式在迁移完成后删除或降级为 legacy importer。

**Verify:**

```bash
pnpm test -- electron/runtime.workspace-projects.test.ts
pnpm test -- electron/export/exportPaths.test.ts electron/export/exportJobManager.test.ts
```

### Task 2.3: 旧项目迁移入口

**Files:**

- Create: `electron/workspace/legacyProjectMigration.ts`
- Test: `electron/workspace/legacyProjectMigration.test.ts`
- Modify: `electron/runtime.ts`

**RED:** 测试旧目录：

```txt
~/Documents/Nomi Projects/Old Project/project.json
```

能迁移为：

```txt
~/Documents/Nomi Projects/Old Project/.nomi/project.json
```

测试：

```ts
it('migrates legacy project.json into .nomi/project.json', () => {})
it('does not duplicate already migrated projects', () => {})
it('keeps existing assets and exports directories', () => {})
```

**GREEN:** 实现：

```ts
export function migrateLegacyProjectFolder(rootPath: string): WorkspaceProjectRecordV2 | null
export function discoverLegacyProjects(defaultProjectsRoot: string): WorkspaceProjectRecordV2[]
```

`listProjects()` 可以在 P0 扫一次 legacy root，并写入 recent registry，然后后续以 workspace registry 为准。

**Verify:**

```bash
pnpm test -- electron/workspace/legacyProjectMigration.test.ts
```

### Wave 2 完成标准

- [ ] 项目 API 已支持任意 rootPath
- [ ] fixed-root 扫描不再是主路径
- [ ] 删除项目不删除用户 folder
- [ ] 旧项目可迁移
- [ ] 相关 runtime/export 测试通过
- [ ] commit：`feat: route projects through workspace repository`

---

## 6. Wave 3 — Folder Picker IPC 与 Project Library UI

**目标:** 用户可以从项目库选择任意文件夹创建/打开项目。

**用户价值:** 入口可用，用户不需要理解环境变量或默认目录。

**设计约束:** 使用现有 `DesignModal`/`WorkbenchButton` 风格。项目库保持轻量，不做大而空的营销 UI。

### Task 3.1: Main/preload 增加 folder picker IPC

**Files:**

- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/desktop/bridge.ts`
- Test: `electron/workspace/workspaceIpc.test.ts` 或 main handler 单测

**RED:** 测试 preload contract 类型和 handler 行为：

```ts
it('returns canceled=true when user cancels folder selection', () => {})
it('returns selected rootPath when user chooses one directory', () => {})
it('opens existing workspace when manifest exists', () => {})
it('initializes a workspace when requested', () => {})
```

**GREEN:** 增加 bridge：

```ts
workspace: {
  selectFolder: () => Promise<{ canceled: boolean; rootPath?: string }>;
  openFolder: (payload: { rootPath: string; initialize?: boolean; name?: string }) => Promise<WorkspaceProjectRecordV2>;
}
```

IPC：

```ts
nomi:workspace:select-folder
nomi:workspace:open-folder
```

### Task 3.2: Project Library 增加“打开文件夹”入口

**Files:**

- Modify: `src/workbench/library/ProjectLibraryPage.tsx`
- Modify: `src/workbench/NomiStudioApp.tsx`
- Test: pure handler tests if available; otherwise extract handler to testable module

**RED:** 抽出 testable flow：

- Create: `src/workbench/library/openWorkspaceFlow.ts`
- Test: `src/workbench/library/openWorkspaceFlow.test.ts`

测试：

```ts
it('does nothing when folder selection is canceled', () => {})
it('opens existing workspace without reinitializing', () => {})
it('initializes selected folder when user confirms', () => {})
it('surfaces permission errors as user-facing messages', () => {})
```

**GREEN:** UI 增加按钮：

```txt
打开文件夹
```

交互：

1. 用户点击“打开文件夹”。
2. Electron 选择 folder。
3. 如果已有 `.nomi/project.json`，直接打开。
4. 如果没有，弹窗确认初始化。
5. 成功后 hydrate project，进入 studio。

**设计要求:**

- 按钮使用 `WorkbenchButton` 或项目库当前已有按钮体系。
- 确认初始化用 `DesignModal`。
- 文案强调：会创建 `.nomi/`，生成文件保存到 `assets/` 和 `exports/`。

### Task 3.3: 默认新建项目也走 folder 选择

**Files:**

- Modify: `src/workbench/NomiStudioApp.tsx`
- Modify: `src/workbench/library/localProjectStore.ts`
- Modify: `src/workbench/project/projectRepository.ts`
- Test: `src/workbench/project/projectRepository.workspace.test.ts`

**RED:** 测试 desktop project create 需要 `rootPath`：

```ts
it('desktop createLocalProject passes rootPath to desktop.projects.create', () => {})
it('browser fallback still creates localStorage project for non-desktop runtime', () => {})
```

**GREEN:** desktop runtime 下新建项目默认先选文件夹。browser fallback 仍走 localStorage，避免 web preview 崩。

### Wave 3 完成标准

- [ ] 项目库可打开任意文件夹
- [ ] 新建项目可选择文件夹
- [ ] 初始化提示清晰
- [ ] 没有绕过 bridge 的绝对路径读写
- [ ] commit：`feat: add workspace folder picker`

---

## 7. Wave 4 — 生成资产与导出路径迁移

**目标:** 所有生成文件都进入当前 workspace folder。

**用户价值:** 用户可以在自己选择的文件夹内找到生成结果，不再被藏在 App 默认目录。

### Task 4.1: 资产写入目录分层

**Files:**

- Modify: `electron/runtime.ts`
- 或 Create: `electron/assets/localAssetStore.ts`
- Test: `electron/assets/localAssetStore.test.ts`

**RED:** 测试写入路径：

```ts
it('writes generated remote assets under assets/generated/YYYY-MM-DD', () => {})
it('writes imported user files under assets/imported/YYYY-MM-DD', () => {})
it('dedupes colliding asset filenames', () => {})
it('returns nomi-local url using project id and relative path', () => {})
```

**GREEN:** 把这些函数从 `runtime.ts` 拆到 `electron/assets/localAssetStore.ts`：

- `contentTypeFromPath`
- `assetKindFromContentType`
- `stableAssetId`
- `collectFilesRecursively`
- `uniqueAssetPath`
- `writeAsset`
- `importRemoteAsset`
- `importLocalFile`

`runtime.ts` 只保留导出 API 包装。

**删除旧逻辑:**

- 删除 `runtime.ts` 内旧 `uniqueAssetPath` 主实现。
- 旧 `assets/YYYY-MM-DD` 不再作为新写入路径。
- 兼容读取可以保留，但不能继续写入旧路径。

### Task 4.2: 任务生成本地化路径测试

**Files:**

- Modify: `electron/runtime.ts`
- Test: `electron/runtime.task-assets.test.ts`

**RED:** 测试 `localizeTaskAsset`：

```ts
it('localizes successful image generation into workspace assets/generated', () => {})
it('localizes successful video generation into workspace assets/generated', () => {})
it('does not download assets when projectId is missing', () => {})
```

**GREEN:** `localizeTaskAsset()` 使用新 asset store。

### Task 4.3: 导出路径确认

**Files:**

- Modify: `electron/export/exportPaths.ts`
- Test: `electron/export/exportPaths.test.ts`
- Test: `electron/export/exportJobManager.test.ts`

**RED:** 确认：

```ts
it('creates exports under workspace root', () => {})
it('rejects relative paths outside exports folder for showInFolder', () => {})
it('keeps job metadata under .nomi/jobs when available', () => {})
```

**GREEN:** 确保导出：

```txt
<workspace>/exports/
```

job 临时数据/日志：

```txt
<workspace>/.nomi/jobs/<jobId>/
```

### Wave 4 完成标准

- [ ] 新生成图片/视频写入 `assets/generated/YYYY-MM-DD`
- [ ] 手动导入写入 `assets/imported/YYYY-MM-DD`
- [ ] 导出写入 `exports/`
- [ ] 旧路径不再作为新写入目标
- [ ] commit：`feat: store generated outputs in workspace folders`

---

## 8. Wave 5 — Workspace 文件目录树

**目标:** 在统一 `ProjectExplorerSidebar` 的“文件”tab 中显示当前 workspace 内文本、图片、视频；不再在 `GenerationWorkspace` 内新增第二个左侧栏。

**用户价值:** 用户可以直接看到项目文件夹内已有素材和 Nomi 生成物，同时保留原有“分类”tab 的创作组织能力。

**设计约束:** 高密度、本地可见、轻边框、使用 workbench/design token，不做花哨卡片；分类树和文件树共享左侧容器但保持数据模型分离。

### Task 5.1: 文件分类与扫描模块

**Files:**

- Create: `electron/workspace/workspaceFileIndex.ts`
- Test: `electron/workspace/workspaceFileIndex.test.ts`

**RED:** 测试：

```ts
it('classifies markdown and txt as text', () => {})
it('classifies png jpg webp gif as image', () => {})
it('classifies mp4 webm mov as video', () => {})
it('skips .git node_modules and .nomi/cache by default', () => {})
it('does not follow symlinks outside workspace by default', () => {})
it('limits large directory scans', () => {})
it('returns relative paths with forward slashes', () => {})
```

**GREEN:** 实现：

```ts
export type WorkspaceFileKind = 'directory' | 'text' | 'image' | 'video' | 'audio' | 'document' | 'file';

export type WorkspaceFileNode = {
  id: string;
  name: string;
  relativePath: string;
  kind: WorkspaceFileKind;
  contentType?: string;
  size?: number;
  updatedAt?: string;
  children?: WorkspaceFileNode[];
};

export function listWorkspaceFiles(input: {
  rootPath: string;
  maxFiles?: number;
  includeHidden?: boolean;
}): WorkspaceFileNode[];
```

### Task 5.2: IPC 暴露文件树

**Files:**

- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/desktop/bridge.ts`
- Test: IPC handler tests

**RED:** 测试：

```ts
it('lists files for a valid project id', () => {})
it('rejects missing project id', () => {})
it('does not expose absolute paths to renderer DTO', () => {})
```

**GREEN:** bridge：

```ts
workspace: {
  listFiles: (payload: { projectId: string; cursor?: string; limit?: number }) => Promise<{ items: WorkspaceFileNode[]; truncated: boolean }>;
  revealFile: (payload: { projectId: string; relativePath: string }) => Promise<{ ok: boolean }>;
  readTextFile: (payload: { projectId: string; relativePath: string }) => Promise<{ content: string; contentType: string }>;
}
```

P0 可以只实现 `listFiles` + `revealFile`，`readTextFile` 如无 UI 预览可后置。

### Task 5.3: Renderer hook

**Files:**

- Create: `src/workbench/workspace/useWorkspaceFiles.ts`
- Test: `src/workbench/workspace/useWorkspaceFiles.test.ts`

**RED:** 测试 hook 的纯状态 reducer：

- Create: `src/workbench/workspace/workspaceFileState.ts`
- Test: `src/workbench/workspace/workspaceFileState.test.ts`

测试：

```ts
it('loads files when projectId changes', () => {})
it('shows empty state when no desktop bridge exists', () => {})
it('preserves expanded directories after refresh', () => {})
it('surfaces list errors as user-facing state', () => {})
```

**GREEN:** 实现：

```ts
export function useWorkspaceFiles(projectId: string | null): {
  items: WorkspaceFileNode[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}
```

### Task 5.4: `ProjectExplorerSidebar` + 文件 panel UI

**Files:**

- Create: `src/workbench/explorer/ProjectExplorerSidebar.tsx`
- Create: `src/workbench/explorer/ExplorerTabs.tsx`
- Create: `src/workbench/explorer/CategoryExplorerPanel.tsx`（从现有 `CategorySidebar` 拆出）
- Create: `src/workbench/explorer/WorkspaceFileExplorerPanel.tsx`
- Create: `src/workbench/explorer/FileTreeNode.tsx`
- Create: `src/workbench/explorer/projectExplorer.css` 或并入现有 workbench css
- Test: reducer/presenter tests；组件测试如环境支持再加

**RED:** 先测 presenter：

- Create: `src/workbench/workspace/projectFileTreePresenter.ts`
- Test: `src/workbench/workspace/projectFileTreePresenter.test.ts`

测试：

```ts
it('renders directory nodes before files', () => {})
it('uses compact labels for generated folders', () => {})
it('shows text/image/video icons by kind', () => {})
it('hides .nomi by default', () => {})
```

**GREEN:** UI 要求：

- 顶部标题：`项目文件`
- 刷新按钮
- 空状态：`这个文件夹还没有可用素材`
- 错误状态：`无法读取项目文件夹，请检查权限或重新打开文件夹`
- 文件行密度约 28px 高
- 使用 `--nomi-bg`, `--nomi-paper`, `--nomi-ink`, `--nomi-ink-60`, `--nomi-line`
- 操作按钮用 `WorkbenchIconButton`

### Task 5.5: 接入生成区布局

**Files:**

- Modify: `src/workbench/generation/GenerationWorkspace.tsx`
- Modify: `src/workbench/WorkbenchShell.tsx`
- Modify: `src/workbench/NomiStudioApp.tsx`
- Test: layout presenter / prop tests

**RED:** 测试 props 传递：

```ts
it('passes projectId into GenerationWorkspace', () => {})
it('shows file tree only when projectId exists', () => {})
it('keeps ai sidebar layout independent from file tree', () => {})
```

**GREEN:** 修改：

```tsx
<GenerationWorkspace
  projectId={projectId ?? null}
  canvas={generation}
  aiSidebar={generationAi}
  aiLayout={generationAiLayout}
/>
```

布局建议：

```tsx
'grid grid-cols-[240px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_var(--workbench-timeline-height)]'
```

如果 AI sidebar 是 sidebar 模式：

```tsx
'grid-cols-[240px_minmax(0,1fr)_340px]'
```

### Wave 5 完成标准

- [ ] 统一 Project Explorer 的“文件”tab 显示目录树
- [ ] 文本/图片/视频可见
- [ ] `.nomi` 默认隐藏
- [ ] 生成后刷新能看到新文件
- [ ] 文件树不破坏 AI 侧栏和时间轴布局
- [ ] commit：`feat: show workspace file tree in generation area`

---

## 9. Wave 6 — 旧代码删除、迁移收口与质量门禁

**目标:** 避免新旧两套项目系统长期并行。

**用户价值:** 减少保存错位置、项目列表重复、删除语义混乱等问题。

### Task 6.1: 删除旧 fixed-root 主路径

**Files:**

- Modify: `electron/runtime.ts`
- Modify: `src/workbench/project/projectRepository.ts`
- Tests: project repository/runtime 相关测试

**RED:** 测试不能再依赖旧 root 扫描：

```ts
it('does not create new desktop projects directly under default projects root without a rootPath', () => {})
it('uses workspace registry as source of truth for desktop project list', () => {})
```

**GREEN:** 删除或降级：

- 旧 `uniqueDir(getProjectsRoot(), record.name)` 作为新项目默认路径的逻辑
- 旧 `project.json` 根目录主写入逻辑
- 旧 `deleteProject` 递归删除项目目录逻辑

保留 legacy importer 但要命名清晰：

```ts
legacyProjectMigration.ts
```

### Task 6.2: 用户价值验收测试清单

**Files:**

- Create: `docs/qa/workspace-folder-projects-qa.md`

手工 QA 场景：

1. 选择空文件夹创建项目。
2. 选择已有素材文件夹初始化项目。
3. 生成图片，确认在 Finder 里看到 `assets/generated/YYYY-MM-DD/`。
4. 生成视频，确认在 Finder 里看到文件。
5. 导出 MP4，确认在 `exports/`。
6. 统一 Project Explorer 的“文件”tab 显示文本/图片/视频。
7. 外部拖入图片后刷新能看到。
8. 删除项目引用，确认用户文件夹没有被删除。
9. 移动项目文件夹后，最近项目显示 missing 或打开失败提示。
10. 旧项目可迁移打开。

### Task 6.3: 全量验证

命令：

```bash
pnpm test
pnpm run build
```

如果任何测试失败，不允许进入下一步。

### Wave 6 完成标准

- [ ] 新旧路径主逻辑已收口
- [ ] 无两套并行项目系统
- [ ] QA 文档完成
- [ ] 全量测试通过
- [ ] build 通过
- [ ] commit：`refactor: remove legacy fixed-root project path`


---

## 9.5 用户价值到实现能力映射

本节用于校验：当前实施计划是否真正能兑现用户核心价值，而不是只完成技术改造。

| 用户核心价值 | 文档内对应实现 | 当前覆盖判断 | 必须验收 |
| --- | --- | --- | --- |
| 用户选择的文件夹就是项目本身 | Workspace Manifest、folder picker、`.nomi/project.json`、recent registry | 已覆盖 | 打开空文件夹、已有素材文件夹、已有 workspace 都能进入同一工作台 |
| 生成物真的落在用户文件夹里 | Wave 4：`assets/generated/YYYY-MM-DD/`、`assets/imported/YYYY-MM-DD/`、`exports/` | 已覆盖 | 生成图片/视频/导出后，Finder 中能看到文件，文件 tab 刷新后也能看到 |
| 用户已有素材和 Nomi 生成物在同一空间 | Wave 5：workspace file index + `WorkspaceFileExplorerPanel` | 已覆盖 | `script.md`、`ref.png`、`shot.mp4` 与新生成物同在“文件”tab 可见 |
| 项目可迁移、可备份、可协作 | `.nomi/project.json` 不 required `rootPath`，只允许 `lastKnownRootPath?: string` | 已覆盖，但实施时要严守 | 复制/移动整个 workspace 后重新打开仍成功；manifest 中旧路径不能参与安全边界判断 |
| 左侧项目面板给用户项目全貌 | `ProjectExplorerSidebar`：`[分类] [文件]` | 已覆盖 | 不出现两个并排左栏；分类和文件都在统一项目面板里切换 |
| 专业创作工具感，而不是玩具生成器 | workspace 目录结构、资产落盘、导出目录、文件树状态、无假进度 | 已覆盖 | 生成/导出/失败/截断状态都能解释真实发生了什么 |
| 用户敢把真实项目文件夹交给 Nomi | 初始化确认、不会移动/删除/重命名已有文件、删除改为“从项目库移除” | 已覆盖 | 删除项目引用不删除文件夹；初始化 modal 明确说明会创建什么、不会动什么 |
| 文件夹丢失后可恢复 | missing 状态 + relink 流程 | 已覆盖，但必须作为 P0 验收 | 移动文件夹后项目库显示 missing；重新定位到同 id manifest 后恢复 |
| 大文件夹不会拖垮体验 | file index 限制 `maxFiles` / depth / hidden dirs，truncated 状态 | 已覆盖 | 超大目录扫描被截断并展示提示，不静默少显示，不阻塞 UI |
| 路径安全和隐私 | main 侧统一 path guard，renderer 只传 `projectId + relativePath` | 已覆盖 | DTO 不含 absolutePath；拒绝 traversal、absolute path、UNC、Windows drive、null byte、symlink escape |

### 9.5.1 用户价值验收门禁

后续每个 Wave 完成时，除了单测/集成测试，还必须回答：

1. 这个 Wave 是否让用户更接近“我的文件夹就是项目”？
2. 是否有任何行为会让用户误以为文件被移动、删除或锁进 Nomi？
3. 是否能在 Finder 中验证生成物和导出物？
4. 是否避免了两个左侧栏或两个项目系统并存？
5. 失败状态是否给了用户下一步动作，而不是只显示错误？
6. 是否没有把绝对路径暴露给 renderer 或写成 manifest 真相？

任一答案为“否”时，不允许进入下一 Wave。

### 9.5.2 当前识别的高风险价值缺口

虽然计划已经覆盖核心价值，但实现时必须重点盯住三个风险：

1. **Relink 不能后置**
   - missing 状态如果没有“重新定位”，用户价值是不完整的。
   - relink 必须进入 P0 验收。

2. **删除文案和删除行为必须同步改**
   - 只改底层不改文案，用户仍会害怕。
   - 只改文案不改底层，会有误删风险。

3. **Project Explorer 不能退化成双左栏**
   - 如果实现时又把文件树塞回 `GenerationWorkspace`，会破坏本轮设计决策。
   - 必须用测试确保只有一个统一左侧项目面板。

## 10. 最终验收标准

### 10.1 功能验收

- [ ] 用户可以打开任意 folder 作为 Nomi 项目。
- [ ] 没有 `.nomi` 的 folder 可以初始化为 Nomi 项目。
- [ ] 有 `.nomi/project.json` 的 folder 可以直接打开。
- [ ] 所有新生成图片/视频写入当前 workspace。
- [ ] 所有新导出写入当前 workspace。
- [ ] 统一左侧 `ProjectExplorerSidebar` 的“文件”tab 显示项目文件目录树。
- [ ] 目录树能看到文本、图片、视频。
- [ ] 删除项目不会删除用户 folder。
- [ ] 项目 folder 丢失时有明确错误提示。

### 10.2 架构验收

- [ ] workspace 逻辑拆在 `electron/workspace/*`。
- [ ] asset 逻辑拆在 `electron/assets/*` 或等价清晰模块。
- [ ] `electron/runtime.ts` 只做 API orchestration，不继续堆业务细节。
- [ ] renderer 不直接读写绝对路径。
- [ ] fixed-root 项目写入逻辑不再作为主路径。
- [ ] legacy 逻辑只有迁移入口，不参与新项目创建。

### 10.3 测试验收

- [ ] 每个生产代码任务都有先失败后通过的测试记录。
- [ ] workspace path/manifest/repository/file index 有单测。
- [ ] runtime 项目 API 有单测。
- [ ] asset 写入路径有单测。
- [ ] file tree presenter/hook 有测试。
- [ ] `pnpm test` 通过。
- [ ] `pnpm run build` 通过。

### 10.4 设计验收

- [ ] 遵守 `Design.md` light-only、本地文件可见原则。
- [ ] 使用现有 design primitives。
- [ ] 不新增孤立的一套按钮/面板样式。
- [ ] 文件树密度适合生产工具。
- [ ] 错误/空状态文案明确，不假装成功。

---

## 11. Commit 策略

用户偏好是每个完成且验证过的阶段单独 commit。建议：

1. `feat: add workspace manifest foundation`
2. `feat: route projects through workspace repository`
3. `feat: add workspace folder picker`
4. `feat: store generated outputs in workspace folders`
5. `feat: add project explorer files panel`
6. `refactor: remove legacy fixed-root project path`
7. `docs: add workspace folder qa checklist`

每个 commit 前必须至少运行对应测试；Wave 结束运行相关测试集合；最终运行 `pnpm test && pnpm run build`。

---

## 12. 不做事项

P0 明确不做：

- SQLite 资产数据库
- 全文搜索
- 文件内容编辑器
- 云同步
- 自动标签系统
- 实时 chokidar 监听，除非 P0 扫描刷新体验明显不够
- 删除用户原始文件
- 把 `.nomi` 暴露为默认可操作目录

这些可以作为 P1/P2，而不是阻塞“任意文件夹作为项目”的核心价值。
