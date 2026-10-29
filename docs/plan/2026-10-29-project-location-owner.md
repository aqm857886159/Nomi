# 设计卡：「项目在哪」收敛单（第一刀进 0.24.1，第二刀进 0.24.2）

> 方向检查与删除清单：`2026-10-29-project-location-owner.direction-check.md`（第 1 段，含特征测试 21 条）。
> 用户 10-29 批准四条方向（原话「按推荐方向修」）：①「项目在哪」只认用户这次真打开或新建的目录，不信清单里的 `lastKnownRootPath`；②读路径不删、不忘、不建，找不到的项目一直留在库里显示「找不到」；③改名 / 移动后用「选文件夹」重开就接上原项目（同一 id，更新登记路径）；④每个入口都拒绝把项目位置放进应用自己的目录。
> 协调 10-29 补充：分两刀；同一 id 两个活文件夹先拒绝、不改绑、不写任何一个；问题 3 只管 3B / 3C 这一类。
> 本卡只填 ★ 五格（1、2、3、4、9）。不碰花钱、长跑、可打断；界面只改现有卡片文案、现有报错位置的文案，不加新界面。

```
改动名：项目在哪只有一个主人        线/负责人：I-project-location        类别：[数据格式]（登记写入来源、读面行为、入口拒绝；登记文件形状不变）
```

## 两刀怎么切

| 刀 | 范围（删除清单编号见方向检查） | 进哪版 |
|---|---|---|
| 第一刀 | 第 1 条（列表摘登记）、第 2 条（登记路径抄清单）、第 7 条（设置「检查」「打开」建目录）、第 3 条里的 `ensureDir(默认根)` 与「按 id 覆盖改绑」；不变量 ④ 入口拒绝、⑤ 副本拒绝；门岗加门 + 反例测试；卡片「找不到」文案 | 0.24.1 |
| 第二刀 | 第 4 条（两个解析合成 `locateWorkspaceProject`）、第 5 条（readProject / saveProject / unbind / delete 的 legacy 分支）、第 6 条（`removeWorkspaceProjectReference`）、第 8 条（列表里的两处写挪进启动对账）、第 9 条（7 份手写「在不在根里」收成一个）、第 10 条剩余旧尺子；3C（媒体解析不重读清单） | 0.24.2（依赖 0.24.1 发出，roadmap A5） |

第一刀只删和替换：`rememberWorkspace` / `rememberWorkspaces` 换成 `bindWorkspaceLocation` / `bindWorkspaceLocations`（同一个合并函数），不留旧名；`checkProjectLocation` / `revealProjectLocation` 的建目录删掉；`legacyProjectDirById` 的建根删掉。

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我升级 Nomi、在资源管理器里给项目文件夹改名、把它挪到别处、或复制一份之后，我想项目还在库里（文件夹找不到就明说「找不到这个文件夹」），用「打开已有文件夹」重新选它就接上原来的项目，以便不丢项目、也不把修改写进别的文件夹。步骤：①打开 Nomi 看项目库；②找不到的卡显示「找不到这个文件夹」，悬停说清下一步；③点「打开已有文件夹」选改名 / 挪走后的文件夹；④原项目打开（同一个 id），画布上的图照常显示，之后的保存写进我选的文件夹；⑤不要了就删除卡片（只从项目库移除、不删文件）。**不做什么**：不自动找回挪到别处的文件夹（非 MAS 包、Windows 拿不到系统书签）；不改安装器（另一条线）；不加新界面（「改用这个文件夹？」确认框、项目在应用目录里的常驻提示条都走设计流程，后续单）。**已知坑**：同一 id 两个文件夹都还在时直接拒绝，用户要先把原文件夹移走或改名；默认位置里改名的项目，重启后由启动对账按新路径接回（第二刀把它从列表挪进启动对账）；Windows 上「检查目录」的可写判断不看 ACL（`fs.access` 的已知限制），真写在新建时才报。**真实任务**：(1) 0.24.0 用户把默认位置设在安装目录下，升级后打开；(2) 在资源管理器里给项目文件夹改名，再用「打开已有文件夹」选它；(3) 复制项目文件夹当副本，打开副本。**指标**（目标 → 信号 → 指标 → 量具）：不丢项目 → 升级 / 改名 / 搬家 / 复制后项目仍在库里 → 「入口 × 状态」矩阵里登记不少一条的比例，基线 0/6（建根门）、目标 100%，量具 `electron/projects/projectLocation.characterization.test.ts`（翻转后）+ `electron/projects/projectLocation.matrix.test.ts`；重开就接上 → 重开后登记 = 所选目录、能读出原 id 的比例，基线 0%（2b / 2d）、目标 100%，量具同上；写对文件夹 → 副本场景原文件夹字节不变，量具同上（目录快照比对）；护栏：读面写盘 0 次，量具 `check:read-path-writes`（新加门）+ 矩阵里「读调用前后目录树快照一致」；入口拒绝 → 四类应用目录 × 五个入口全拒，量具 `electron/workspace/workspaceLocationPolicy.test.ts`（含 `path.win32` 大小写）+ 矩阵；真实闭环 → 走查 `tests/ux/project-location-owner.walk.mjs` 中英各一遍；Windows 真机：未验证：缺量具（本线在 macOS，盘符与大小写用 `path.win32` 推导）；线上「找不到」卡片出现率：未验证：缺量具（没有遥测） | 方向检查 §1 / §3；特征测试 |
| ★1b 连带界面 | 只改现有元素的文案，zh / en 两轨：项目卡 missing 标签「文件夹暂不可用」→「找不到这个文件夹」，并像其他置灰卡一样给悬停提示（改名或挪走了就用「打开已有文件夹」重新选它；不要了删除卡片只从项目库移除）；「打开已有文件夹」被拒：在应用目录里 / 是另一个项目的副本，各一句，走现有项目库错误条（`projectOperationFailureText`）；「新建项目」被拒（默认位置在应用目录里）：说清为什么、去「设置 → 文件与保存」换位置，走同一个错误条；设置「新项目默认位置」：新增「在 Nomi 自己的目录里」「文件夹不存在」两种结果，走现有检查反馈行；MCP 项目列表照常带 `missing` | `check:i18n`；走查截图 |
| ★2 谁说了算 | 概念 `project.location`（项目 id → 项目文件夹，新登记 `docs/engineering/concept-owners/project.location.json`）。**唯一写**：`electron/workspace/workspaceRegistry.ts#bindWorkspaceLocation`（单条）/ `#bindWorkspaceLocations`（批量，启动对账用）——共用一个合并函数；入参 `{ id, name, rootPath, origin? }`，`rootPath` 必填，函数不收 record，写不出「抄清单路径」；同一 id 已绑着另一个还装着这个 id 的文件夹 → 单条抛 `WorkspaceFolderCopyError`、批量跳过并返回冲突（不变量 ⑤）。允许的写调用方：新建 / 打开（`createWorkspaceProject` 传用户所选或新建目录）、保存 / 恢复（传登记里的同一路径）、启动对账（传扫到的目录）。摘登记只剩「从项目库移除」与删除（`removeWorkspaceReference`）。**入口守卫**：`electron/workspace/workspaceLocationPolicy.ts#assertUserOwnedLocation`（判定 `findAppOwnedLocation` 只有一个）：设置选位置、设置检查、选文件夹（选择时 + 打开时）、新建项目、外部 Agent 建项目都调它。同一事实三份 → 第一刀后登记只从入口参数来，清单 `lastKnownRootPath` 保存时照写、没有读者（`createWorkspaceProject` 返回的记录也换成登记路径）；按 id 扫默认根这第三份由第二刀删。「文件夹不见了 = 用户删了」的推断：删除 | `node scripts/door-map.mjs bindWorkspaceLocation bindWorkspaceLocations removeWorkspaceReference assertUserOwnedLocation` |
| ★3 一致与复用 | 合并函数沿用原 `mergeWorkspaceEntry` 的锁（`withRegistryLock`）与排序，单条 / 批量共用；「这个文件夹装的是哪个 id」只读 `.nomi/project.json`（或老格式根 `project.json`）的 `id` 字段，不取清单锁、不写；拒绝的错误身份放进共享合同 `electron/shared/contracts/projectLocation.ts`（照 `ProjectTrashFailedError[原因]:` 的写法：同步 IPC 只带回信息文本，名字写进信息开头），渲染层只在 `projectOperationFailureText` 一处认它；路径包含用 Node `path.relative`（`path.win32.relative` 本身不分大小写），不加依赖，`isPathInside` 先住在位置判定模块里，第二刀把另外 7 份手写 `startsWith(root + sep)` 收过来；符号链接用「最近存在的祖先 realpath + 余下路径」比较（macOS `/var` → `/private/var`）。应用目录四类全部取自 Electron 自己的路径接口：安装目录（mac 取 exe 所在 `.app` 包，Windows / Linux 取 exe 所在目录）、`process.resourcesPath`、`app.getPath('userData')` 与设置根、`app.getPath('temp')`。**环境变量 `NOMI_PROJECTS_DIR` 托管的默认位置不判**：它不经任何产品入口选出，设置页对它只读（`managed-by-environment`），拒绝了用户也没处改；走查 / e2e 的隔离库都靠它 | `pnpm run check:self-written`；`git grep -n "startsWith(\`\${"` |
| ★4 全状态 | 项目卡：正常 / 找不到（文件夹不在：标签「找不到这个文件夹」+ 悬停下一步）/ 读不出（现有灰卡）/ 正被别处占用（现有）/ 默认根整个不在（全部「找不到」，不雪崩，不摘）。打开已有文件夹：成功（改名 / 挪走的原项目同 id 接上，登记 = 所选目录）/ 取消（什么都不变，现有）/ 在应用目录里（拒绝，原因 + 换个位置）/ 是另一个还在的文件夹的副本（拒绝，说原文件夹在哪、先移走或改名；两个文件夹都不写）/ 不是 Nomi 项目（现有初始化确认）/ 系统目录（现有）。新建项目：成功 / 默认位置在应用目录里（拒绝，去设置换；不静默改设置、不换目录）/ 默认位置被删（照建，用户动作）。设置位置：成功 / 在应用目录里（拒绝，原设置不变）/ 不是文件夹 / 不可写（现有）/ 环境托管（现有）。设置检查：可用 / 文件夹不存在（只报、不建）/ 在应用目录里 / 不是文件夹 / 不可写。设置打开：打开 / 文件夹不存在（只报、不建）/ 打不开（现有）。启动对账：新文件夹登记 / 改名的默认根项目按新路径接回（原登记文件夹已不在）/ 副本（原登记还在）不登记、原登记不动 / 读不出的跳过（现有）。能力不可用 / 加载中 / 部分成功 / 过期：不适用——都是一次本地读写 | `check:i18n`；走查截图 zh / en |
| ★9 验收与回滚 | **验收清单（动手前写全，实现线按它自验，验收线只核它）**：①升级场景：默认位置在安装目录、5 个项目、安装目录被删、重启；6 扇门（新建项目、素材库逐个列素材、`projectDirById`、`readProject`、设置检查、设置打开）逐扇碰一次：默认根不被建回、5 张卡都在且 `missing`、登记 5 条一条不少，重启再看仍是 5；默认根被别的原因建回（用户手建）后列表仍不摘；②默认根内改名：同一会话刷新，卡在、`missing`、登记不变；「打开已有文件夹」选改名后的目录：登记 = 所选目录、`readProject` 读出原 id 与内容、诊断 ok；重启后同样；③外部文件夹改名 / 挪到别的盘：重启仍是「找不到」卡；重开改名后的目录接上原 id，重启后仍接着；④副本：复制项目文件夹打开副本 → 拒绝（`WorkspaceFolderCopyError`，带原项目名与原路径），原文件夹与副本目录树字节不变，登记不变；默认根里复制后连续重启 3 次，登记始终指原件、副本不登记（2g 翻转）；原件被删后再打开副本 → 接上；⑤开着时在默认根里改名：之后的自动保存不写根上旧格式 `project.json`（2e 翻转：报项目找不到，不写别处）；⑥入口拒绝：设置选位置、设置检查、选文件夹（选择 + 打开）、新建项目（渲染层入口）、外部 Agent 建项目（`createNamedProject`）× 安装目录 / `resources` / `userData`（含设置根）/ 系统临时目录 → 全拒，原设置、登记、磁盘都不变；路径形状：`path.win32` 盘符大小写、末尾分隔符、`.app` 包内、符号链接指进应用目录、中文和空格；环境变量托管的位置不判；⑦读面不写：`listProjects`、`readProject`、`projectDirById`、`listProjectAssets`、`diagnoseProject`、设置检查、设置打开调用前后目录树快照一致（第一刀范围；启动发现的登记写由第二刀挪走，门岗基线登记在案）；⑧门岗：`check:read-path-writes` 门加 `removeWorkspaceReference`、`bindWorkspaceLocation(s)`、`backfillWorkspaceOrigins`、`ensureDir`，读前缀加 `check` / `reveal` / `locate`；反例测试往 `listX` 里加回摘登记 → 退出 1 并点名；⑨真实闭环：走查中英各一遍，截图亲眼看过：建项目 → 改名 → 重启后卡在、显示「找不到这个文件夹」→ 打开改名后的文件夹接上原项目、画布图片加载 → 副本被拒 → 默认位置设到应用目录被拒、文案对 → 默认位置在应用目录里时新建被拒、指向设置；⑩Windows 0.24.0 → 0.24.1 真机升级一次（协调跑，`unverified` 前不报完成）。**反例（必须仍成立）**：外置盘暂时拔掉 → 「找不到」、插回即恢复（不重绑、不摘）；用户「删除 / 从项目库移除」后不会被启动对账找回（现有 `removed-from-library` 标记）；同一文件夹经符号链接或末尾分隔符打开不算副本；新项目在正常默认位置（文档 / 外置盘 / 同步盘）照常建，默认位置文件夹被删时新建照建；取消选择什么都不变。**回滚**：revert 第一刀提交即可；登记文件格式不变、无数据迁移；回滚后特征测试回到现状断言。**独立验收**：另一条线按本格逐条核，报告链接进 PR 正文 `## 独立验收` | 特征测试翻转；矩阵测试；`pnpm run check:read-path-writes`；`tests/ux/project-location-owner.walk.mjs` |

### 功能分类
- [ ] 新界面 / 改交互（只改现有标签与报错文案；确认框、提示条走设计流程，不在本单）
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [x] 数据格式（登记写入来源与读面行为；登记文件形状不变）
- [ ] 新增功能 / 性能

### 后续（不在本单）
- 「改用这个文件夹？」确认框（同一 id 两个活文件夹时让用户选）：走 `docs/engineering/design-pipeline.md`。
- 已经把默认位置放进应用目录的老用户，启动时主动提示（项目库顶部常驻条 + 「移到 文档 / Nomi Projects」）：走设计流程。本单只在点新建时拒绝并指向设置。
