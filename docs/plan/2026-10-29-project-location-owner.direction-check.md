# 方向检查：「项目在哪」没有主人（D-project-location，RW，2026-10-29）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 触发：`node scripts/fix-churn.mjs`（基线 main 693d890d7）——`electron/projects/repository.ts` 14 天第 6 个 fix、`electron/workspace/workspaceRepository.ts` 第 8 个、目录 `electron/projects/` 第 11 个、概念「项目目录的生死」第 8 个、「项目名」第 9 个。按用户 10-29 批准的 D1（一个单元 ≥10 个 fix 开收敛单），这一页是**收敛单**，不是补丁。
> 本段只交特征测试、本页和设计卡草稿（第 2 段定稿为 `2026-10-29-project-location-owner.md`），没改生产代码。
> 特征测试：`electron/projects/projectLocation.characterization.test.ts`（21 条，全部走真实生产函数 + 临时目录，现状全绿；标「坏行为」的由收敛单翻过来——改断言，不删用例）。

## 0. 一句话根因

「项目在哪」没有主人：登记表里的路径不是用户这一次真打开的目录，而是抄清单里创建时写下的旧提示；读面上另有三套各自推断的补位（列表凭「native + 文件夹不在 + 默认根在」推断「用户删了」就摘登记；`projectDirById` / `readProject` 凭「按 id 扫默认根」找目录，扫之前先把默认根建出来）。这些推断互相触发，一次升级、改名、搬家、复制就能让项目从库里永久消失，或者让修改写进另一个文件夹。

## 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 用户 1：升级后第一次 5 张灰卡，关掉再开全没了（**已证实**） | `repository.ts#listProjects` 对「native + missing + 默认根存在」的项目调 `removeWorkspaceReference`；默认根被升级删掉时第一次保留，随后 6 扇门里任何一扇把默认根建回来（新建项目、素材库「所有项目」逐个列素材、`projectDirById`、`readProject`、设置「检查目录」、设置「打开目录」，逐扇实测），下一次列表就把 5 条登记物理删除 | A 读面凭推断忘记项目 + B 读面建根 |
| 用户 2a：改名后项目从库里消失（**已证实**） | 同上：改名 = 文件夹不在 + 默认根在 → 摘登记（同一会话刷新一次库就没） | A |
| 用户 2b：「选文件夹」打开改名后的文件夹，提示文件夹不存在（**已证实**） | `createWorkspaceProject` → `initializeWorkspace` 对已有清单原样返回；`rememberWorkspace` → `workspaceRegistry.ts#mergeWorkspaceEntry` 用 `record.lastKnownRootPath`（创建时的旧路径）做登记路径；随后打开 → 诊断 `missing-folder` →「项目文件夹不存在或磁盘未连接」 | C 登记路径不来自用户所选目录 |
| 2c（本次新发现）：上一步之后 `readProject` 返回一份**别的 id、无内容的「Untitled Project」**（已证实） | `legacyProjectDirById` 按 `.nomi/project.json` 认出改名的目录，`readProject` 却读根上的 `project.json`（不存在 → `{}` → `normalizeProjectRecord` 现造 id） | D 第二套「在哪」答案 |
| 2e（本次新发现）：开着的项目在默认根里被改名，之后的自动保存写进根上旧格式 `project.json`，`.nomi` 清单不动，重启后读到改名前的内容（已证实） | 登记被 A 摘掉后，`saveProject` 走 legacy 分支：`legacyProjectDirById` 找到目录 → 写根 `project.json`；渲染层自动保存不带 `expectedBinding`，挡不住 | D |
| 2f（本次新发现）：复制项目文件夹、打开副本，之后的保存全写进原文件夹（已证实） | 同 C：登记 = 清单旧路径 = 原文件夹 | C |
| 2g（本次新发现）：在默认根里复制项目文件夹（「xxx - 副本」），之后只是重启：每次启动登记在原件和副本之间来回改绑，修改轮流写进两个文件夹，上一次启动后的修改下一次看不到（已证实） | 启动发现 `legacyProjectMigration.ts#discoverLegacyProjects` 只按路径跳过已登记目录；副本（或改绑后的原件）是未登记路径、清单 id 相同 → `rememberWorkspaces` → `mergeWorkspaceEntry` 按 id 覆盖条目 | C（登记路径由推断而来）+ 读面写登记 |
| 用户 3：画布图卡「加载失败」、素材面板里那张图在（**未证实**，缺用户数据） | 三个候选都能复现出同样的症状：3A 预览文件 `*.preview.*` 不在了——画布只挂 `thumbnailUrl`、失败不回落原图，面板列的是源文件（**不是这一类**）；3B 节点 URL 带的是别的项目的 id、那个项目的位置已经找不到（**这一类**）；3C 清单走不了无锁快照时，每次媒体解析都取清单锁，撞上自动保存就 404（这一类的副作用：问「在哪」要重读整份清单） | 3A 另一类（画布预览无回落）；3B / 3C 属 D |
| 05-31 92f917be0 add workspace registry | 登记路径取 `record.lastKnownRootPath`（错误信息却写着 "requires rootPath from the selected workspace"） | C 的源头，潜伏 5 个月 |
| 06-08 9060a6ff5「文件夹改名 404」 | 给 `legacyProjectDirById` 加 `.nomi/project.json` 扫描，补第二套答案而不是让登记跟上 | D 的源头 |
| 06-14 2680d3e4a「native 幽灵项目列举时自愈摘除」 | 前提「本地盘不会临时消失，文件夹没了 = 真删」 | A 的源头 |
| 10-21 5b2f4d05c、10-22 c219118e8（N1 / N2） | 列表回收空白草稿会删掉排队中的保存；取锁会造孤儿根 | A / B：只收了「读面删目录」和「取锁建根」，读面摘登记、`legacyProjectDirById` 建默认根没收 |
| 10-22 0e7032d39 | 启动发现一项读不出拖垮整页 | 读面（发现）失败域 |
| 10-22 0bf38c3f1 / 9a1237e76 | 删除时刻重新读状态、自己判断该删多少 | 凭此刻状态猜意图（A 同形） |
| 10-22 52f6d199a | 列表藏起零编辑草稿 | 读面做取舍 |
| 10-23 87baf3eed / 7119cd63f、10-24 ce1b14c81 | 删除进回收站、失败原因分类 | 删除这扇门自己的表达（不同类） |

## 2. 为什么这一类会一直出现

- **同一个事实存了三份**：登记 `rootPath`、清单 `lastKnownRootPath`、默认根下的目录结构（按 id 扫）。三套读者各取一份：`resolveWorkspaceProjectDir`（只信登记；20 扇门 / 30 处：Agent、MCP、生产、事件日志）、`projectDirById`（登记，不行就扫默认根；9 扇 / 17 处 + `resolveProjectRelativePath` 4 扇：媒体、素材、导出）、`readProject`（登记，不行就扫默认根再读根 `project.json`；15 扇 / 25 处）。特征测试「当前项目在默认根里被改名」实测：同一时刻媒体能出图、`readProject` 却给出别的 id。
- **写入口的路径是隐式的**：`mergeWorkspaceEntry` 从 record 字段取路径；谁传 record 谁就决定登记在哪。`createWorkspaceProject` 传进去的是盘上已有清单 → 旧路径。
- **读面被允许写**：列表摘登记（`removeWorkspaceReference`）、列表补登记（发现 `rememberWorkspaces`）、列表冻结来源（`backfillWorkspaceOrigins`）、读 / 解析建默认根（`legacyProjectDirById` 的 `ensureDir`）、设置「检查」「打开」建目录。N1 只把「读面删目录」收了。
- **门岗看不见**：`check:read-path-writes` 只认 `atomicWrite` / `writeConnectorPrefs` / `deleteWorkspaceProject` 三个写门，`removeWorkspaceReference`、`ensureDir`、`rememberWorkspaces` 都不在图上——`listProjects` 摘登记这一条在门岗上是绿的。
- **前提错了**：「文件夹不在」从来不等于「用户要把它从库里去掉」。实际原因是改名、搬家、升级清空安装目录、同步盘晚挂载、换盘符、默认根被 Nomi 自己重建。

### 三条体验铁律

| 铁律 | 本类的回答 | 证据 |
|---|---|---|
| ⑩ 说的=摆的 | 不适用：不涉及意图抽取写下的模型 / 比例 / 时长参数 | — |
| ⑪ 能选到 | 不适用：不涉及模型档案参数清单 | — |
| ⑫ 点了=以为的 | **适用**。「选文件夹」选 X：预期打开 X；实际登记旧路径 → 提示 X 不存在（2b），或之后的修改写进另一个文件夹（2f）。「新建项目」：预期项目在我设的位置、安全；实际放进安装目录，升级即删（4a） | 特征测试 2b / 2f / 4a；`tests/ux/full-walk/escapeLedger/` 还没立账（本段只交测试与本页，交协调定是否立三条 candidate） |

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 复制项目文件夹当副本、打开副本接着做 → 修改静默写回原文件夹 | **已验证**：特征测试「坏行为 2f」 |
| 把项目文件夹挪到别的盘再打开 → 库里永远「找不到」，重开、重启都回不来 | **已验证**：特征测试「坏行为 2d」（外部文件夹同形）；native 挪盘 = 2a 摘登记 + 2b 登记旧路径 |
| 默认根放在同步盘 / 外置盘：盘晚挂上、或同步客户端先建出一个空的「Nomi Projects」→ 全库 native 项目被摘 | 机制已验证（「坏行为 1」：默认根被任何一扇门建回来就摘）；真机同步盘场景 unverified |
| 默认根放在同步盘：同步客户端生成冲突副本（同一份清单、同一个 id）→ 与 2g 同形，每次启动在两个文件夹之间来回改绑 | 机制已验证（「坏行为 2g」）；真机同步盘场景 unverified |
| 开着的项目在默认根里被改名 → 之后的自动保存写进旧格式文件，重启后看不到 | **已验证**：特征测试「坏行为 2e」 |

## 同类还能不能从别的地方回来（逐条答）

- **另一个入口**：能。能把默认根建回来的门 6 扇，逐扇实测（`it.each` 一扇一条）；MCP `createNamedProject` 经 `createProject` 同一扇。读面摘登记的门 1 扇（`listProjects`），读面写登记的另有 2 处（发现、来源冻结）。
- **另一个平台**：能。Windows 不分大小写，7 个函数里手写 `startsWith(root + sep)` 判「在不在某个根里」（`repository.ts#unbindProject` / `#deleteProject`、`workspaceRegistry.ts#strictDescendantOf`、`workspaceRepository.ts#createWorkspaceProject` / `#deleteWorkspaceProject`、`workspaceIpc.ts#isProtectedSystemPath`（它的 win32 原始串分支会转小写，`resolved` 分支不会）、`workspaceFileIndex.ts`）；`path.win32` 推导：`f:\nomi_new\xiangmu\a` 对 `F:\Nomi_new\xiangmu` 判成「不在里面」。盘符路径下 C 同样成立（`path.win32` 推导：登记 = 清单旧路径 ≠ 用户所选）。
- **旧数据**：能。每个项目的清单都带着创建时的 `lastKnownRootPath`；任何改过名、挪过、复制过的老项目，下一次「选文件夹」都登记旧路径。没有来源字段的老登记，首次列举按**当前**默认根冻结来源，默认根改过的用户来源会判错，A 的摘除跟着判错。
- **改名 / 移动 / 复制**：能，三种都实测（2a–2g），外加「开着改名」的保存分叉（2e）和「默认根里复制后只重启」的来回改绑（2g，不需要用户做任何打开动作）。

## 入口数（door-map 实数，门 = 文件 + 符号）

- **写 / 改 / 摘登记**：7 扇门、13 个生产调用点，经 4 个登记原语（`backfillWorkspaceOrigins` / `rememberWorkspace` / `rememberWorkspaces` / `removeWorkspaceReference`）。其中 3 处在读面上（`listProjects` 摘 + 补、`listWorkspaceProjects` 冻结来源）；`workspaceRepository.ts#removeWorkspaceProjectReference` 0 调用。测试 / 脚本夹具另有约 8 处直接写或拷贝 `recent-workspaces.json`（`tests/ux/core-smoke/fixture.mjs`、`tests/system/mcp-real-client.mjs`、`tests/perf/canvas-scale-bench.mjs` 等，登记形状变了要一起改）。
- **读 `lastKnownRootPath`**：生产 9 个文件；真正信「清单里持久化的那份」的只有 1 处——`workspaceRegistry.ts#mergeWorkspaceEntry`（其余经 `readProject` 读到的已被换成登记路径）。**读 `nativeRootPath`**：4 个文件，`repository.ts#listProjects` 拿它推断「真删了」。**读登记 `rootPath`**：上面三套解析，约 55 扇读门。
- **读面建目录 / 摘引用**：`listProjects`（摘、补登记）、`listWorkspaceProjects`（写来源）、`legacyProjectDirById`（建默认根；经 `projectDirById` 17 处与 `readProject` / `saveProject` / `unbindProject` / `deleteProject` 可达）、`checkProjectLocation`（建目录 + 写探针文件）、`revealProjectLocation`（建目录）。门岗一扇都不认。

## 4. 靶子独立性

- 特征测试由本线写，只钉现状（含坏行为），不当判据；收敛单的验收由另一条线按设计卡 ★9 的清单核。
- **有错靶子，先翻**：`electron/runtime.workspace-projects.test.ts`「listProjects self-heals: prunes native projects whose folder was deleted outside the app」（06-14）把「文件夹不在」钉成「该摘」；`electron/projects/repository.test.ts`「legacyProjectDirById（folder rename 自愈）」三条钉住要删的兜底。
- 「修对了反而像回归」的先例：06-14 的自愈是按「真机幽灵卡 90 → 3」验收的，同一把尺子会把今天的丢项目也记成「自愈成功」。

## 5. P0：是我们独有的吗？现成方案有哪些

- **领域**：「项目 id ↔ 项目文件夹」的绑定、项目库里的卡片生死，属 `self-written.json` 的领域根 `electron/projects/`（项目库：目录、最近项目与项目身份）与 `electron/workspace/`（项目工作区：项目身份、清单、迁移的盘上形态）。没有能整块接入的库。
- **查过的现成做法**：
  1. Apple《File System Programming Guide》Accessing Files and Directories：路径型 URL 在 Finder 里一挪就失效，跨启动可靠定位要用 bookmark（「usually」能找回）· 确认了「路径只是提示、身份另算」：身份用清单里的项目 id，路径只认用户这次打开的目录。
  2. Electron `dialog.showOpenDialog` 的 `securityScopedBookmarks`：只在 Mac App Store 包里生成，非 MAS 返回空数组（electronjs.org/docs/latest/api/dialog）· 改了决定：不做「自动找回挪走的文件夹」——Windows NSIS 包、非 MAS mac 包都拿不到系统书签；重新定位只靠用户再打开一次。
  3. VS Code `src/vs/platform/windows/electron-main/windowsMainService.ts`：只在用户真去打开、`stat` 失败时（`doResolveFilePath`）才把条目从「最近打开」移除，渲染列表时不删 · 确认了「读面不删」；但它「打开失败就自动移除」我们不照抄——最近列表丢一条无所谓，项目库丢一条用户就以为项目没了。
  4. 坏先例（我们自己）：06-14 2680d3e4a 的「文件夹没了 = 真删」。
- **通用小件**：Windows 不分大小写的路径相等 / 包含判断现在手写 7 份——收成一个函数；Node 没有内置，先查 npm 现成包，没有合适的再登记自写（理由：要同时认 win32 大小写与 realpath）。登记文件的跨进程锁（`withRegistryLock`，mkdir 自旋锁）是通用能力，不在本单范围，另记一笔。

## 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 用系统书签记住项目文件夹，改名、搬家自动找回（Electron `securityScopedBookmarks` / macOS NSURL bookmark） | 只有 MAS 包有；Windows 要原生模块做 Shell link tracking | 平台分叉；报告人用的 Windows NSIS 包用不上 | 否：领域约束是非 MAS、Windows 为主的发行 |
| 补 | `mergeWorkspaceEntry` 改用传入路径；`listProjects` 摘除前多加条件；`legacyProjectDirById` 不再 `ensureDir` | 小，3 个文件 | 第 7 / 第 9 个 fix；三套「在哪」答案还在；推断还在，只是更难触发；2c / 2e / 3C 不动 | 否 |
| 重写（限一个模块） | 「项目在哪」收成一个 owner：登记路径只从入口显式传入；只有一个读函数；读面只读；入口统一拒绝应用自己的目录 | 中：登记 + 两个仓库文件 + 3 个入口 + 约 30 扇读门换 import；翻 2 个旧测试文件和本单 21 条特征测试 | 读者多，要一个 PR 换完；启动对账的位置要定 | **推荐**（与「删」一起做） |
| 删 | 删列表摘登记、按 id 扫默认根、readProject / saveProject / unbind / delete 的 legacy 分支、`removeWorkspaceProjectReference`、读面建目录 | 小到中 | 默认根里改名的项目要靠启动对账或重开文件夹找回；开着时改名的项目，本次会话显示「找不到」直到重开 | **推荐**，作为「重写」的删除清单 |

## 7. 用户要权衡的核心

文件夹不见了的项目，是一直留在库里显示「找不到」、直到你自己移除或重新打开那个文件夹（推荐：升级、改名、搬家、同步盘都不会再让项目悄悄消失，代价是真删掉文件夹的项目会留一张灰卡等你手动清），还是像现在这样由 Nomi 猜「你是不是删了」替你摘掉。

## 收敛单草稿

- **单元**：「项目在哪」= 项目 id → 项目文件夹的绑定（新概念 `project.location`，与 `project.directory-lifecycle` 并列登记）。
- **owner**：`electron/workspace/workspaceRegistry.ts#bindWorkspaceLocation`（唯一写：调用方必须显式给 `rootPath`，函数内核对该目录清单的 id 等于要绑的 id）+ `electron/workspace/workspaceRegistry.ts#locateWorkspaceProject`（唯一读：只读登记，核目录在、清单 id 对得上；不扫、不建、不摘，用无锁只读 id 的快路径，不重读整份清单）。入口守卫：`electron/workspace/workspaceLocationPolicy.ts#assertUserOwnedLocation`（新，设置 / 选文件夹 / 新建共用）。
- **不变量**：①登记路径只来自入口参数（用户这次选的、新建时生成的、启动对账扫到的目录），不读清单持久化的 `lastKnownRootPath`（该字段保存时照写成登记路径，留给旧版本降级用，没有读者）；②读面（list / read / resolve / get / locate / check / reveal）不摘登记、不写登记、不建目录；③「在哪」只有一个读函数，没有按 id 扫默认根；④入口拒绝应用自己的目录：安装根（Windows 为 exe 所在目录，macOS 为 `.app` 包）、`resources` / `app.asar`、`userData`（含 `NOMI_ELECTRON_USER_DATA_DIR`）、系统临时目录，Windows 不分大小写比较；⑤同一个 id 两个活文件夹（复制）不静默改绑、不静默写进另一个（现状两条路都会：选文件夹打开副本写进原件 2f；默认根里复制后启动发现每次来回改绑 2g）——默认答案（交用户确认）：原文件夹还在时，打开副本先问「改用这个文件夹？」，界面走设计流程。
- **删除清单**（现在在哪 → 删了谁接住）：
  1. `repository.ts#listProjects` 里按「native + missing + 默认根在」调 `removeWorkspaceReference` 的过滤 → 卡片照出 `missing`；摘登记只剩「从项目库移除」（`repository.ts#unbindProject`）；重新打开文件夹 → `bindWorkspaceLocation` 改路径。
  2. `workspaceRegistry.ts#mergeWorkspaceEntry` 从 `record.lastKnownRootPath` 取路径（连同 `assertRegistrableRecord`）→ `bindWorkspaceLocation` 的显式参数：`createWorkspaceProject` 传用户所选 / 新建目录，`saveWorkspaceProject` / `recoverWorkspaceProject` 传 `entry.rootPath` / `diagnostic.rootPath`，启动对账传扫到的目录。
  3. `repository.ts#legacyProjectDirById`（按 id 扫默认根 + `ensureDir(默认根)`）→ `locateWorkspaceProject`；默认根里改了名的项目由启动对账（现 `legacyProjectMigration.ts#discoverLegacyProjects`）按新路径找回，前提是该 id 当前没绑在一个还在的文件夹上（不变量 ⑤）。
  4. `repository.ts#projectDirById` 与 `workspaceRepository.ts#resolveWorkspaceProjectDir` 两个解析 → 合成 `locateWorkspaceProject`（签名不变：id → 目录 | null，约 30 扇读门只换 import）。
  5. `repository.ts#readProject` / `#saveProject` / `#unbindProject` / `#deleteProject` 的 legacy 分支（读根 `project.json` 现造记录、写根 `project.json`、按扫描结果抑制或进回收站）→ 登记里的 workspace 项目；没登记的老格式项目由启动对账登记，首次读时迁移（`migrateLegacyProjectFolder`，现有）。
  6. `workspaceRepository.ts#removeWorkspaceProjectReference`（0 调用）→ 不需要接。
  7. `projectLocationIpc.ts#checkProjectLocation` 经 `validateProjectLocationRoot` 的建目录 + 探针写、`#revealProjectLocation` 的 `ensureProjectLocationDirectory` → 「检查」只报不存在 / 不可写 / 在应用目录里；「打开」目录不在就报错。建目录只发生在用户选位置（`pickProjectLocation`）和新建项目时。
  8. 列表读面里的两处写：`listProjects` 的 `discoverLegacyProjectsOnce` + `rememberWorkspaces`、`listWorkspaceProjects` 的 `backfillWorkspaceOrigins` → 挪进启动时一次的显式对账（`reconcileProjectLibrary`，app ready 调一次），列表纯读。可作第 2 段的第二个提交。
  9. 7 个函数里手写的 `startsWith(root + sep)` → 一个 `isPathInside(root, candidate)`（win32 不分大小写）；`workspaceFileIndex.ts` 那处是越界防护，核对语义后再并。
  10. 要翻的旧尺子：`electron/runtime.workspace-projects.test.ts`「listProjects self-heals…」改成「保留并标 missing」；`electron/projects/repository.test.ts`「legacyProjectDirById（folder rename 自愈）」随功能删；本单 21 条特征测试逐条翻。
- **新增拦截**（结构 > 门岗）：`bindWorkspaceLocation` 的 `rootPath` 必填、record 上没有路径可传——写不出「抄清单路径」；`locateWorkspaceProject` 所在模块不 import `ensureDir` / `removeWorkspaceReference`；`check:read-path-writes` 写门加 `removeWorkspaceReference`、`bindWorkspaceLocation`，读前缀加 `locate`（变异：往 `listProjects` 里加回摘登记 → 红）；本单特征测试翻转后即类回归（6 扇建根门逐扇、改名 / 搬家 / 复制 / 开着改名、win32 推导）。
- **0.24.0 已经把项目放进安装目录的用户**（只写方案，界面走 `docs/engineering/design-pipeline.md`，本段不做）：启动对账时判「新项目默认位置」或任一登记项目在应用目录里 → 项目库顶部一条常驻提示（不弹窗）：说清「升级会清空安装目录」，给「移到 文档 / Nomi Projects」（复制 → 逐个核清单 id → 改登记 → 原处保留不删）和「以后再说」；已经被升级删掉的灰卡说「找不到这个文件夹」，给「重新打开文件夹…」（从备份 / 回收站恢复后选它，同 id 改绑）和「从项目库移除」。与安装器那条线（I-installer-keep-user-files）对齐：安装器保住用户文件是第一道，应用侧拒绝 + 提示是第二道。
- **截止**（建议，协调定）：第 2 段实现 + 特征测试翻转 + 独立验收报告，2026-11-03 开 PR；要不要进 0.24.x 补丁由协调排。

## 特征测试清单

`electron/projects/projectLocation.characterization.test.ts`（21 条）：

- 问题 1：升级后不碰默认根，5 张卡一直标 missing（现状，保留）；6 扇建根门逐扇 → 摘光登记（坏行为 1，`it.each`）。
- 问题 2：默认根内改名即摘（2a）；重开登记旧路径 + 诊断 missing-folder（2b）；`readProject` 现造别的 id（2c）；外部文件夹改名重开重启都回不来（2d）；开着改名后保存写进旧格式文件（2e）；复制后保存写进原文件夹（2f）；默认根里复制后只重启，登记每次启动在原件与副本之间来回改绑（2g）；默认根内改名、重启后被发现流程找回（现状，收敛单定去留）。
- 问题 3（只钉「在哪」那部分）：别的项目 id 的 URL 解析失败（3B）；清单走不了快照时取锁失败 → 解析失败（3C）；默认根内改名后媒体解析与 `readProject` 答案不一致。3A（预览缺失、画布不回落原图）属画布预览这一类，现有 `src/workbench/generationCanvas/nodes/canvasImageSource.test.ts` 钉着「有小图只挂小图」，本单不重复钉。
- 入口：默认位置接受安装目录（4a）、接受 `userData`（4b）；选文件夹安全检查不认这两类目录（4c）。

没钉住的：Windows 真机（本线在 macOS；盘符与大小写只用 `path.win32` 推导）；渲染层拿到 2c 那份假记录之后的界面表现（渲染层没起，主进程事实已钉）。

## 第一刀验收之后的一刀：找不到文件夹的卡片删不掉（2026-11-01）

- **触发**：`electron/projects/repository.ts` 14 天第 7 个 fix，`src/workbench/library/projectDeleteFlow.ts` 第 4 个，目录 `electron/projects/` 第 12 个、`src/workbench/library/` 第 13 个。
- **算哪一类**：不是新类。第 7 节用户批准的是「一直留在库里，直到你自己移除或重新打开」，第一刀删了读路径自动摘登记，「自己移除」在本地卡上却是空操作，旧的自动摘登记曾把它遮住。归到第 1 节「删除这扇门自己的表达」。
- **补还是换**：换。`deleteProject` 里两个只回 false 的分支并进 `unbindProject`，`unbindProject` 自己的两个分支合成一个；确认框判断多认一个状态，复用现有文案。没有新特例。
- **系统哪里没拦住**：卡片状态、确认框判断、主进程三层各测各的，没有一条把它们接起来再重启。这次加跨层矩阵（`projectLocation.matrix.test.ts`「删除：卡片状态 × 确认框 × 主进程 × 重启」）。
- **往后**：第二刀第 5 条重写 unbind / delete 的 legacy 分支时，这组矩阵当合同，不改断言。

## 自写登记 `gate-family`：这一刀为什么还改自写门岗

第一刀给 `scripts/check-read-path-writes.mjs`（自写登记 `gate-family`，状态 under-review）加门、加反例测试，不新增门岗脚本。

- **现成方案查过**（登记里的 `alternativesChecked` 之外补一条）：eslint 自定义规则 / eslint-plugin-boundaries 只看单个文件或模块之间的 import，看不到「`listProjects` 经三层调用走到 `removeWorkspaceReference`」这种跨文件的函数调用链；dependency-cruiser 是模块级依赖图，分不出同一个文件里哪个函数调了谁；CodeQL 的调用图查询能表达「读命名的函数可达这些写门」，但要接进 CI 的代码扫描、为 TypeScript 维护自己的查询包，本仓库没有接入（`.github/` 里没有）。门岗本身已经用 TypeScript 编译器 API 解析源码，不是自写解析器；自写的只是 Nomi 领域的那张门表（摘登记、写登记、建目录）和成对登记的基线。
- **为什么现在换不了**：0.24.1 只等这一刀；把门岗迁到 CodeQL 是门岗族整体去留的决定（`docs/audit/2026-10-01-gate-ledger.md` 的门岗账本，用户按保留 / 合并 / 降级 / 删除逐项拍板），不该夹在一个修 bug 的提交里做。
- **哪天换**：门岗账本的清单拍板时一起定（登记 `reviewBy` 2026-10-31）。如果定了接 CodeQL，「读路径可达写门」改成它的调用图查询，本脚本、`scripts/read-path-writes-baseline.json` 和反例测试同一提交删掉；如果定了保留，门表与基线照现在的成对登记继续只减不增。
