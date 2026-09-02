# Nomi 跨设备继续编辑实施计划

日期：2026-09-01 · 状态：📋 方案待拍板（写于 09-01，一直没提交进 git；09-02 打捞入库，未开工、未评审）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户把 Nomi 项目放在任意可同步的本地文件夹中，在另一台电脑上安全地继续编辑；第一阶段不承诺多人同时编辑或实时协作。

**Architecture:** 采用“项目文件夹同步 + 可移植配置包 + 单写者安全护栏”的本地优先架构。Nomi 不在第一版内置云盘账号和服务商 SDK，而是把工作区保持为可复制、可校验的目录；设备级设置和密钥留在本机，配置通过显式导出/导入迁移。同步检测只负责发现外部变更、阻止覆盖和提供恢复，不实现分布式实时合并。

**Tech Stack:** Electron 主进程文件系统、现有 `workspaceRepository`/`workspaceManifest`、Zod 运行时校验、IPC + preload bridge、React 设置页、Vitest、Playwright Electron 真实旅程测试、`ffprobe` 媒体验收。

**Spec:** 本文的“产品契约”“数据边界”“验收闸”章节即为实现规格；现状依据见 `electron/runtimePaths.ts`、`electron/settings/projectLocationSettings.ts`、`electron/workspace/workspacePaths.ts`、`electron/workspace/workspaceManifest.ts` 和 `electron/workspace/workspaceRepository.ts`。

## Global Constraints

- 只支持“单设备编辑 → 完全退出 → 等待同步完成 → 另一设备打开”；不把文件同步宣传为实时协作。
- 不同步 API Key、操作系统钥匙串密文、缓存、日志、最近项目绝对路径和设备状态。
- 项目路径必须继续通过现有的安全目录校验和工作区边界校验；不得绕过 native picker 或 `assertInsideWorkspace`。
- 项目清单和配置包必须有版本号、严格 schema 和向后兼容策略；坏包整体拒绝，不能留下半导入状态。
- 保留现有 `.nomi/project.backup.json` 恢复机制；冲突时复制为隔离文件，禁止静默覆盖。
- UI 所有新文案走 i18n；不新增全局 CSS；单文件不超过 800 行。
- 完成标准不是静态测试全绿：必须用两份临时工作区跑跨设备模拟旅程，且验证画布、素材、时间轴、导出文件和重开。
- 第一版不引入 WebDAV/云厂商 SDK。原生 WebDAV 作为后续独立计划；当前可兼容 VerySync、坚果云同步客户端、Syncthing 等能映射成本地文件夹的工具。

## 1. 现状与用户价值边界

当前 `getProjectLocationState()` 已支持环境变量、自定义目录和默认目录；`workspacePaths` 已把 `.nomi/project.json`、备份、`assets/generated`、`assets/imported`、`exports` 组织在工作区内；`workspaceRepository` 已具备原子保存、revision 和损坏恢复。这意味着“把项目目录放到同步文件夹”不需要重写项目存储。

当前不能直接跨设备搬运的内容：

- `electron/settings/settingsRoot.ts` 下的设置是设备级目录。
- `electron/catalog/secrets.ts` 使用 macOS Keychain、Windows DPAPI 或 Linux libsecret；同一密文不能假设能在另一台电脑解开。
- `electron/workspace/workspaceRegistry.ts` 记录本机绝对路径，不能作为跨设备项目索引。
- `electron/catalog/catalogStore.ts` 的 `exportModelCatalogPackage({ includeApiKeys: true })` 会生成明文凭据包，只能保留为用户主动触发的已有高级能力，不能纳入自动同步。

产品承诺应写成：

> “把 Nomi 项目放进同步文件夹，关闭后即可在另一台电脑继续编辑；首次在新电脑使用时导入配置并重新填写模型密钥。”

不承诺：同时打开、多人编辑、秒级同步、冲突自动合并、跨平台直接迁移系统密钥。

## 2. 目标目录和同步边界

### 2.1 同步内容

```text
<project-root>/
  .nomi/
    project.json              # 必须同步，项目唯一真相源
    project.backup.json       # 必须同步，恢复点
    sync-state.json           # 新增，设备切换/冲突元数据
    conflicts/                # 新增，冲突隔离副本
  assets/
    generated/                # 必须同步
    imported/                 # 必须同步
  exports/                    # 默认同步，可在设置中关闭
```

### 2.2 不同步内容

```text
<settings-root>/
  recent-workspaces.json      # 每台设备自己生成
  model-catalog.json          # 不自动同步；通过配置包迁移
  cache/ logs/ downloads/      # 设备缓存和临时状态
```

同步工具的忽略规则不能依赖某一家供应商；Nomi 自己只写入上述稳定文件，并在健康检查中忽略临时文件（`.tmp`、`.partial`、供应商冲突副本）。

### 2.3 跨平台路径原则

`project.json` 里的资源引用继续使用相对于工作区的 `localAssetUrl`，禁止持久化 `/Users/...` 或 `C:\...`。打开项目时只根据当前工作区根解析相对路径。若发现旧数据包含绝对路径，诊断结果必须是 `path-migration-required`，提供“重新定位资源”入口，不自动删除原引用。

## 3. 分阶段交付

### Phase 0：验证现有能力（无代码）

用 VerySync 或坚果云客户端在两台真实电脑上建立同步目录，执行“创建项目 → 导入图片/视频 → 生成一个结果 → 入轴 → 导出 → 关闭 → 等待同步 → 第二台打开 → 重开项目”。记录同步耗时、文件大小、项目是否完整、导出文件是否能在 App 外播放。

VerySync 官方定位是用户设备间的私有文件夹同步和加密传输：[官方介绍](https://www.verysync.com/manual/introduction/)、[多设备使用说明](https://www.verysync.com/manual/users/start.html)。坚果云可以通过 WebDAV 或客户端工作，但官方帮助页列出文件大小、请求频率和目录分页限制，直接接入时必须单独处理：[坚果云 WebDAV 帮助](https://help.jianguoyun.com/?tag=webdav)。

### Phase 1：项目同步体验（第一版必须完成）

- 在现有“项目位置”设置下增加同步文件夹说明、同步安全状态和“打开项目文件夹”入口。
- 打开项目时运行一次 `inspectWorkspaceSync`，识别正常、同步中、外部变更、冲突、缺失素材、清单损坏。
- 发现外部变更时，先阻止保存并提示重新加载；用户确认后再读取新清单。
- 保存前写入同步元数据；保留旧清单备份。
- 提供“复制当前项目为副本”作为冲突恢复动作。

### Phase 2：可移植配置（第一版紧随项目同步完成）

- 新增“导出 Nomi 配置”和“导入 Nomi 配置”。
- 默认导出供应商公开信息、模型、映射、默认参数、系统/用户提示词和非敏感偏好。
- 导入采用事务边界：所有 vendor/model/mapping 校验成功后一次性写盘；任何错误返回错误列表且磁盘不变。
- 导入结果明确显示“需要重新填写的密钥供应商列表”。
- 删除/禁用现有的“自动同步 `userData`”想法；不要把 `safeStorage` 内容复制到另一台机器。

### Phase 3：增强恢复和诊断

- 增加跨设备诊断报告：项目 ID、清单 revision、最后写入设备、文件完整性、未同步临时文件、缺失资源计数。
- 增加冲突隔离目录和恢复预览。
- 对超大媒体给出同步耗时和磁盘空间提示，不在 Nomi 内复制第二份媒体。

### Phase 4：原生 WebDAV（暂不进入本计划实施）

抽象 `SyncProvider` 接口后，再单独接 WebDAV/Nextcloud。不能先为坚果云、VerySync 各写一套业务逻辑；第一版只依赖它们提供的本地文件夹。

### 实时协作（明确延期）

实时协作需要操作日志、身份、权限、锁或 CRDT，以及断线重放；它不是“把文件同步快一点”。后续如启动，应另开产品计划，先做只读远程预览，再做单主机写入，最后才评估多人编辑。

## 4. 文件与接口设计

### Task 1：同步状态纯函数和 schema

**Files:**
- Create: `electron/workspace/workspaceSync.ts`
- Create: `electron/workspace/workspaceSync.test.ts`
- Modify: `electron/workspace/workspaceTypes.ts`（增加稳定类型，不改变现有 payload schema）

**Interfaces:**

```ts
export type WorkspaceSyncStatus =
  | "ready"
  | "syncing"
  | "external-change"
  | "conflict"
  | "missing-assets"
  | "corrupt-manifest"

export type WorkspaceSyncState = {
  schemaVersion: 1
  workspaceId: string
  revision: number
  contentHash: string
  writerId: string
  writtenAt: string
  status: WorkspaceSyncStatus
}

export type WorkspaceSyncInspection = {
  status: WorkspaceSyncStatus
  manifestExists: boolean
  backupExists: boolean
  referencedAssetCount: number
  missingAssetCount: number
  observedRevision: number | null
  lastWriterId: string | null
}

export function inspectWorkspaceSync(rootPath: string, expected?: {
  revision: number
  contentHash: string
}): WorkspaceSyncInspection
export function writeWorkspaceSyncState(rootPath: string, state: WorkspaceSyncState): void
export function quarantineWorkspaceConflict(rootPath: string, source: "local" | "remote"): string
```

- [ ] 先写测试：正常清单、缺少清单、备份可恢复、revision 变化、hash 变化、缺失资产、临时文件存在、路径越界。
- [ ] 使用现有 `workspaceProjectFile`、`workspaceProjectBackupFile` 和 `resolveWorkspaceRelativePath`，不得重新拼接路径。
- [ ] hash 只针对规范化后的 `project.json` 字节；写入时采用现有原子 JSON 写入。
- [ ] `writerId` 是每台安装随机生成并存于设备设置，不能使用用户名或 MAC 地址。
- [ ] 冲突隔离副本写入 `.nomi/conflicts/project-<writerId>-<timestamp>.json`，不覆盖主清单。

### Task 2：保存边界接入

**Files:**
- Modify: `electron/workspace/workspaceRepository.ts`
- Modify: `electron/workspace/workspaceManifest.ts`
- Test: `electron/workspace/workspaceRepository.test.ts`, `electron/workspace/workspaceManifest.test.ts`

**Behavior:**

- `saveWorkspaceProject` 保存前读取 `sync-state.json` 和当前清单。
- 若当前磁盘 revision/hash 与进程最近一次打开的快照不一致，返回结构化 `WorkspaceSyncConflictError`，不写主清单。
- 正常保存顺序：写 `project.backup.json` → 写 `project.json` → 写 `sync-state.json`。
- 任何一步失败都保留旧主清单，返回可读错误，并在诊断中标为 `corrupt-manifest` 或 `sync-write-failed`。
- 继续复用现有 `diagnoseWorkspaceProject`/`recoverWorkspaceProject`，不另造恢复逻辑。

### Task 3：IPC 和 preload bridge

**Files:**
- Create: `electron/workspace/workspaceSyncIpc.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/desktop/settingsBridge.ts` 或现有 workspace bridge 类型文件
- Test: `electron/workspace/workspaceSyncIpc.test.ts`

**IPC contract:**

```ts
"nomi:workspace:sync-inspect"  (rootPath: string) => WorkspaceSyncInspection
"nomi:workspace:sync-refresh"  (projectId: string) => WorkspaceProjectRecordV2
"nomi:workspace:sync-copy-conflict" (projectId: string) => { rootPath: string }
"nomi:workspace:sync-reveal" (projectId: string) => WorkspaceProjectLocationResult
```

- [ ] 每条 handler 使用现有 `assertTrustedSender`。
- [ ] renderer 只能传已由 native picker 选择或已注册的项目 ID；不接受任意路径写入。
- [ ] `sync-refresh` 在重新加载前保留当前编辑器未保存状态，UI 必须先让用户确认。
- [ ] preload 只暴露窄接口，不把 `fs`、`path` 或原始 token 暴露给 renderer。

### Task 4：配置包（不带密钥）

**Files:**
- Create: `electron/settings/portableConfig.ts`
- Create: `electron/settings/portableConfig.test.ts`
- Modify: `electron/main.ts`, `electron/preload.ts`, `src/api/desktopClient.ts`
- Modify: 现有设置页组件和 i18n 文件

**Bundle schema:**

```ts
type PortableConfigBundleV1 = {
  schemaVersion: 1
  exportedAt: string
  app: { product: "Nomi" }
  catalog: {
    vendors: Array<PublicVendor>
    models: Array<ModelWithoutSecrets>
    mappings: Array<MappingWithoutSecrets>
  }
  defaults: GenerationModelDefaults
  prompts: SystemPrompts
  preferences: { language?: "zh-CN" | "en"; theme?: "light" | "dark" }
  redactions: { apiKeys: "omitted"; absolutePaths: "omitted"; deviceState: "omitted" }
}
```

- [ ] 复用 `exportModelCatalogPackage()` 的公开 vendor/model/mapping 结构，但强制忽略 `includeApiKeys`。
- [ ] 导出前递归拒绝 `apiKey`、`customConfig`、绝对路径和 `userData` 文件名。
- [ ] 导入先用 Zod 解析完整 bundle，再调用现有 `importModelCatalogPackage` 的事务边界；失败返回错误列表，磁盘不变。
- [ ] 导入后返回 `{ imported, credentialsRequired: string[] }`，UI 显示逐供应商重填密钥入口。
- [ ] 增加恶意包测试：未知字段、超大字符串、重复 ID、错误 task kind、路径注入、密钥字段和部分成功回滚。

### Task 5：设置页和用户引导

**Files:**
- Modify: `src/workbench/settings/ProjectLocationSection.tsx`
- Create: `src/workbench/settings/WorkspaceSyncStatus.tsx`
- Modify: `src/workbench/settings/ModelSettingsWorkspacePages.tsx`（放置配置导入/导出入口）
- Modify: `src/i18n/locales/zh-CN/*`、`src/i18n/locales/en/*`
- Test: `src/workbench/settings/*.test.tsx`

**UI contract:**

- 项目位置区显示当前路径、工作区类型、最近一次检查结果和“打开文件夹”。
- 状态文案只给行动：`已准备好`、`同步尚未完成，请稍候`、`另一台设备有新版本，请重新加载`、`发现冲突，已保留副本`。
- 第一次选择同步目录时显示三行说明：关闭 Nomi、等待同步完成、再在另一台电脑打开。
- 配置区提供“导出配置”和“导入配置”，导入完成明确显示“API Key 不会同步，需要重新填写”。
- 不增加常驻顶部工具栏；状态放在项目位置和打开项目流程中，避免重复控件。

### Task 6：真实跨设备测试系统

**Files:**
- Create: `tests/system/cross-device-continuation.walk.mjs`
- Create: `tests/system/fixtures/cross-device-project.ts`
- Create: `tests/system/cross-device-continuation.contract.test.ts`
- Modify: `package.json` 测试脚本和 CI 分类器（只增加受影响风险面）
- Document: `docs/tutorials/cross-device-continuation.zh-CN.md`

**Harness model:**

- 每次测试建立 `machineA/Projects/Film` 与 `machineB/Projects/Film` 两个临时目录。
- 用一个可控的 `syncMirror` 测试适配器模拟 VerySync/Nutstore 的“复制完成”和“复制中”状态；不要在单测里依赖真实墙钟或 `Date.now()` 轮询。
- 两个 Electron profile 使用不同 settings root 和不同 `writerId`，但共享同步目录镜像。
- 所有断言同时检查用户看到的界面和磁盘结果；不接受只截图、不检查持久化的测试。

**必须覆盖的真实任务：**

1. 新建项目 → 导入图片、视频、音频和 PDF → 保存 → 关闭。
2. 同步到机器 B → 打开项目 → 画布节点仍在 → 资产可预览 → 时间轴可播放。
3. 在机器 B 导出 MP4 → 记录路径、文件大小、codec → `ffprobe` 检查 → App 外独立播放。
4. 机器 A 未关闭时机器 B 尝试打开 → 显示同步/锁定提示，不覆盖 A 的版本。
5. 机器 A、B 先后修改 → B 发现 revision/hash 变化 → 重新加载后两次修改均可追溯。
6. 制造半个 `project.json`、缺少资产、损坏 JSON → UI 显示可理解诊断 → 从 backup 或冲突副本恢复。
7. 导出配置（不带 key）→ 清空 B 的 catalog → 导入 → 模型和映射恢复 → key 状态显示 `missing` 并可重新填写。
8. 导入包含 key/path 的恶意配置包 → 整包拒绝 → 原有 catalog 完全不变。
9. macOS、Windows、Linux 至少各跑一次相对路径和换盘符/换用户目录场景；绝对路径不得写入项目清单。

**验收证据：**

- Playwright trace、关键步骤截图、两台 profile 的日志和最终目录清单。
- `project.json`、backup、sync-state 的 revision/hash 对账表。
- 导出 MP4 的 `ffprobe` 输出和 App 外播放截图/记录。
- 配置包脱敏扫描结果（无 `apiKey`、`customConfig`、绝对路径）。

### Task 7：文档、故障手册和发布门

**Files:**
- Create: `docs/tutorials/cross-device-continuation.zh-CN.md`
- Create: `docs/tutorials/cross-device-continuation.en.md`
- Create: `docs/plan/2026-09-01-cross-device-sync-acceptance.md`
- Modify: `docs/ARCHITECTURE-NOW.md`（实现完成后补现状，不提前写未来状态）
- Modify: `docs/release-process.md`（增加跨设备测试证据要求）

文档必须用用户任务写法，不让用户理解 `.nomi` 内部结构。故障表至少包含：同步未完成、另一台设备有新版本、项目清单损坏、素材缺失、配置导入失败、密钥需要重填、磁盘空间不足、服务商客户端冲突副本。

发布前执行：

```bash
pnpm run check:filesize
pnpm run check:i18n
pnpm run check:heavy-path
pnpm run typecheck
pnpm run test -- electron/workspace/workspaceSync.test.ts electron/settings/portableConfig.test.ts
pnpm run test:system:focused -- cross-device-continuation
pnpm run test:e2e -- cross-device-continuation
```

Electron 和媒体导出路径按 R22 额外触发；没有真实跨设备证据时只能称“已实现”，不能称“已解决”。

## 5. 失败分类与处理原则

| 情况 | 用户看到什么 | 系统动作 |
|---|---|---|
| 同步客户端仍在复制 | “同步尚未完成，请稍候” | 禁止保存/覆盖，允许查看本地旧版本 |
| 外部 revision 变更 | “另一台设备有新版本，请重新加载” | 阻止写入，保留编辑器未保存草稿 |
| 双方都改过 | “发现冲突，已保留副本” | 写入 `conflicts/`，主清单保持先到版本 |
| JSON 损坏 | “项目文件损坏，可从备份恢复” | 隔离坏文件，调用既有 recover 流程 |
| 资产缺失 | “有 N 个素材未同步” | 标出相对路径，禁止假装生成成功 |
| API Key 不可用 | “配置已导入，请重新填写密钥” | 只迁移公开 catalog，密钥状态为 missing/locked |
| 绝对路径失效 | “资源需要重新定位” | 不删除节点，不写入另一台设备路径 |

## 6. 安全与隐私审查

- 自动同步范围只允许工作区目录；不得读取或复制整个 `settingsRoot`。
- 配置导出默认脱敏；带明文 key 的现有高级导出必须继续由用户明确触发，并在 UI 显示风险，不得被跨设备向导调用。
- 所有路径通过现有 `assessWorkspaceFolderSafety`、`assertInsideWorkspace` 和相对路径拒绝规则。
- 冲突文件命名不包含 API Key、用户主目录中的敏感片段或远端 URL。
- 日志只记录状态、revision、hash 前缀和路径相对部分；不记录 prompt 中的密钥或完整媒体 URL token。

## 7. 完成定义（Definition of Done）

只有同时满足以下条件，才可以对用户说“跨设备继续编辑已完成”：

1. 项目同步、配置迁移、冲突保护和恢复四条链均有代码测试。
2. 两个独立 Electron profile 完成真实任务闭环，包含生成结果、时间轴、导出和重开。
3. 至少一个 VerySync/坚果云本地同步目录完成手动走查；同步客户端只作为文件传输层，不把其不稳定性伪装成 Nomi 能力。
4. 所有失败场景都有用户可行动的提示，不能只显示“打开失败”。
5. `pnpm run typecheck`、受影响 unit/system/e2e、i18n/filesize/heavy-path 全绿。
6. 文档与实际 UI、目录结构、密钥行为一致；没有把实时协作写进第一版承诺。
7. 评审报告明确列出未支持项：同时编辑、自动合并、原生 WebDAV、云端历史版本和 LAN 实时协作。

## 8. 推荐执行顺序

1. 先做 Phase 0 双机验证；如果现有目录同步已经能完整打开项目，就保留代码范围只做状态和护栏。
2. 实施 Task 1 → Task 2，先把同步状态和保存边界做成纯函数/单测。
3. 实施 Task 3 → Task 5，把能力接到现有 IPC 和项目设置页。
4. 实施 Task 4 的配置包，完成密钥脱敏和事务导入。
5. 实施 Task 6 真实任务测试系统，再根据走查结果修复 UI/恢复/路径问题。
6. 最后补 Task 7 文档和发布门；没有跨设备证据不发布“支持多设备”营销文案。

这条路线的核心取舍是：先用本地同步工具覆盖最多用户，而不是现在就承担云端账户、WebDAV 兼容性和实时协作的长期维护成本。
