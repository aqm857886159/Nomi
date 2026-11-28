# U-2 旧会话格式停写版本与自动迁移版本 Git 历史事实考证报告（SM-legacy-facts）

> 状态：📋 方案待拍板（只读事实考证报告，供协调结合线上版本分布裁定删除窗口）
> 关联看板：`#1586`（`SM-legacy-facts` · 承接 `Q-smell` 第一段报告 §3.2 `U-2` 与 `#1586#issuecomment-7225010070` / `#1586#issuecomment-7226347818`）
> 实查基线：`origin/main` @ `e0ad90bffc5f62600096f8d9a59e38cdd5bdc380`
> 统一规矩：我们是一个小的桌面应用。只做创作者常走的路，以及这条路上的钱和数据安全；边角记一行，不写代码。每个 PR 写一节「明确不做」。

---

## 一句话结论判定式与协调裁定矩阵（醒目摘要）

> [!IMPORTANT]
> **「哪个版本以后可以删」一句话事实判定式**：
> Nomi 历史上在正式发版客户端中实际落盘过、且由 `laneLegacy*` 迁移层承接的旧会话格式**只有 1 种**——`v0.10.0` 至 **`v0.21.0`** 写入的 `<project>/.nomi/agent-session.json`（其余 3 种 `laneLegacy*` 兼容源均仅存在于 `v0.21.0` 之后、`v0.22.0` 之前的 14 天未发版 `main` 提交窗口内，对外发版安装包用户数为 **`0`**）；自 **`v0.22.0`**（`bf8cbd77b`，2026-09-24 仅打 git tag、未发 GitHub Release）与 **`v0.22.1`**（`a5fd5e4d1`，2026-09-26 **首个正式发版**，合入自 PR `#646` `5c507a5cc`）起，全部旧会话格式已彻底停写（当前全仓生产代码隐藏写入点为 **`0`**），且用户在 `>= v0.22.1` **只要打开过一次某项目（`workspace-open` 立即执行事务写盘并归档移除旧源文件，无需任何编辑或保存，亦不受 `F-S-1` `#1713` 老项目只读打开不写 `project.json` 的影响）**，该项目的会话就已永久落为新格式 `.nomi/agent-sessions/*.jsonl`；**但该自动迁移是按单项目打开触发，没有应用启动时的全库扫描**——因此，当协调从本机用量数据确认线上仍在运行 **`<= v0.21.0`** 的活跃用户归零（或低于可接受阈值），并对「客户端已升至 `>= v0.22.1` 但从未点开过的 `<= v0.21.0` 休眠老项目」拍板处置方式（直接只读提示 / 在最后一版升级时全库批迁一次）后，即可自 **`v____`（待协调结合线上版本分布填入）** 起整包删除 `laneLegacy*` 一次性磁盘迁移引擎（**9 个生产文件、`1,020` 物理行 / `1,485` 格式化代码行**），同时保留 `laneLegacyNote.ts` 等 **`~36` 行**已迁入 `.nomi/agent-sessions/*.jsonl` 内部标记的读取与首次续聊工具初始化逻辑。

### 协调结合线上版本分布裁定矩阵（留空栏待填）

| 历史会话格式 / 存储路径 | 写入版本区间（已发版安装包） | 彻底停写版本与精确 Commit | 自动迁移上线版本与精确 Commit | 迁移落盘触发条件（纯代码事实） | 线上存量与待协调填入裁定栏 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **① AI SDK 会话工作缓存**<br>`<project>/.nomi/agent-session.json`<br>（v1 单会话 / v2 多分区 `CoreMessage[]`） | **`v0.10.0` ~ `v0.21.0`**<br>（`2026-06-14` ~ `2026-08-27` 全部正式版） | **`v0.22.0` tag / `v0.22.1` 正式版**<br>旧写者删除：`c48d0354c`（2026-08-27，PR `#181` 合入 `1394abbbb`，晚于 `v0.21.0` 9 小时）；路径停用：`d0e7768c5`（2026-09-05） | **`v0.22.0` tag / `v0.22.1` 正式版**<br>实现：`3a058ef00`（2026-09-08）<br>合入 `main`：`5c507a5cc`（2026-09-10，PR `#646`） | **按单项目打开立即写盘**（`NomiStudioApp` → `workspace-open` → `migrateLaneLegacy`；只读打开也会完成写盘归档，不依赖编辑/保存，不受 `F-S-1` `#1713` 阻塞；但**未打开过的休眠项目仍在盘上保留原文件**） | · 线上 `<= v0.21.0` 活跃人数：**`[待协调填入]`**<br>· 休眠未打开老项目策略：**`[待协调拍板：直接退役+只读提示 / 升级时全库扫一次再删]`**<br>· 裁定可删版本：**`v____ [待协调填入]`** |
| **② 早期渲染层对话气泡副本**<br>`<project>/.nomi/conversations.json`<br>（v1 / v2 纯展示文本，上限 200 条） | **`v0.10.0` ~ `v0.21.0`**<br>（与①同回合双写，存 UI 展示气泡） | **`v0.22.0` tag / `v0.22.1` 正式版**<br>渲染写端移除：`d270d34ec`（2026-09-01，PR `#301` 合入 `13a78c02b`）<br>主进程死 IPC 删除：`4da8d99b1`（2026-10-07，PR `#1064`，首进 `v0.24.0`） | **不适用（从未接入 `laneLegacy*`）**<br>`laneLegacy*` 从①读取完整 `CoreMessage[]` 与工具对，不读此文件；其代码已于 `v0.24.0` 清零 | 无运行时读写；`<= v0.21.0` 老项目目录内若残留该文件现为静默死文件 | **代码早已删净（`v0.24.0`）**，与本次 `U-2` 删除无阻塞关系 |
| **③ pi 工作上下文快照信封**<br>`<project>/.nomi/agent-thread-context-v1.json`<br>（及同期的 `.nomi/agent-session.json` `version: 3`，内含 `nomi.pi-work-context`） | **无任何发版安装包**<br>（仅 `2026-08-27` ~ `2026-09-10` 期间未发版 `main` 分支） | **`v0.22.0` tag / `v0.22.1` 正式版**<br>删除提交：`6a6a1775d` & `856a8a701`（2026-09-08 `[switch 4/6 04-05]`，PR `#646` 合入 `5c507a5cc`） | **`v0.22.0` tag / `v0.22.1` 正式版**<br>同 PR `#646`（`5c507a5cc`）；其中 `version: 3` 仅归档不导入，`version: 4` 按单项目打开写盘导入 | 同①（单项目打开立即写盘）；但因从未进入任何 git tag 或 GitHub Release（连作者本机 370 个项目实扫亦为 `0` 份），**外部用户盘上存量为 `0`** | 外部发版存量恒为 **`0`**（不构成退役窗口约束） |
| **④ 独立宿主分区状态快照与命令账本**<br>`<userData>/project-agent-host/<partition>/snapshot-v1.json` · `snapshot-v1.backup.json` · `commands-v1.jsonl` | **无任何发版安装包**<br>（仅 `2026-09-02` ~ `2026-09-10` 期间 8 天未发版 `main` 分支） | **`v0.22.0` tag / `v0.22.1` 正式版**<br>断连：`2663e7c67`（`[switch 2/6 e]`）<br>删除写仓：`082706708`（2026-09-08 `[switch 4/6 12]`，PR `#646` 合入 `5c507a5cc`） | **`v0.22.0` tag / `v0.22.1` 正式版**<br>同 PR `#646`（`5c507a5cc`） | 同①（单项目打开立即写盘并移除源快照/账本）；因从未进入任何发版安装包，**外部用户盘上存量为 `0`** | 外部发版存量恒为 **`0`**（注：`diagnosticsIpc.ts:44` 仍残留一处指向 `commands-v1.jsonl` 的只读诊断路径，可随 `U-2` 一并清退） |
| **⑤ 宿主切换期过渡归档对**<br>`<project>/.nomi/project-agent-cutover.json` + `project-agent-cutover-preparation.json` + `project-agent-legacy-archive-v1/<stamp>-agent-session.json` | **无任何发版安装包**<br>（仅 `2026-09-02` ~ `2026-09-10` 期间 8 天未发版 `main` 分支打开过 `<= v0.21.0` 项目时生成） | **`v0.22.0` tag / `v0.22.1` 正式版**<br>删除提交：`548c2a3a9` & `5505c1f3c`（2026-09-08 `[switch 4/6 06,09]`，PR `#646` 合入 `5c507a5cc`） | **`v0.22.0` tag / `v0.22.1` 正式版**<br>`3a058ef00`（`laneLegacyPriorArchive.mts`），PR `#646` 合入 `5c507a5cc` | 单项目打开时若活跃 `agent-session.json` 已不在但上述归档对完整，则从中恢复导入（原归档保留不删）；**外部发版用户盘上存量为 `0`** | 外部发版存量恒为 **`0`**（不构成退役窗口约束） |
| **⑥ 现役格式（对照基线）**<br>`<project>/.nomi/agent-sessions/--nomi-lane-<name>--/*.jsonl` + `.nomi/agent-workspace.json` | **`v0.22.1` ~ 当前 `main`**（及未发安装包 tag `v0.22.0`） | **现役唯一写口**（`laneSession.mts` / `JsonlSessionRepo` + `laneWorkspaceSelection.ts`） | 现役目标格式（含已迁移会话写入的 `nomi.ui.legacy*` 自定义条目） | 每次回合/切换写盘；已在 `>= v0.22.1` 迁完的旧会话即住在此目录 `legacy-<32位hex>` 子目录中 | **现役保留**；其中读取内嵌 `nomi.ui.legacy*` 条目的 **Scope B（`~36` 行）永久保留**，保障已迁会话续聊不坏 |

---

## ★0 先查别人

- https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/prefs/README.md · Chromium 本地状态退役规范严格区分浏览器进程启动时跑一次的全局 `MigrateObsoleteLocalStatePrefs()` 与打开具体用户目录时才执行的 `MigrateObsoleteProfilePrefs()`，同时明确规定「从未向真实终端用户 JSON 文件写出过的内部配置，无需保留一年的自清理迁移期」 · **改了**本文对旧格式暴露面与触发粒度的两项核心判断——① 实核 Git 拓扑后将仅存活于 `v0.21.0`（08-27）与 `v0.22.0`（09-24）之间未发版 `main` 上的 ③/④/⑤ 三种中间格式单列为「零外部发版存量」，不再让它们虚增兼容负担；② 明确指出 `migrateLaneLegacy` 等同于 Profile 级惰性迁移（打开单个项目才写盘，非启动全库扫描）。
- https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definition-versioning/ · Kubernetes 存储版本退役流程将「停写旧版本（`storage: false`）」与「移除旧版本读取/转换代码（`served: false` 并确认 `status.storedVersions` 清空）」拆为两个独立阶段：即便集群二进制已全部升级到新版本，从未被重新打开写回的历史对象在底层存储中仍保留旧序列化字节，直接删读取转换器会导致休眠旧对象不可读 · **确认了**本文的跨版本升级与休眠老项目判定矩阵——区分「客户端仍在 `<= v0.21.0`」与「客户端已升到 `>= v0.22.1` 但盘上仍有从未点开过的 `<= v0.21.0` 休眠项目」两种截然不同的真实数据状态，把协调在 `#1586#issuecomment-7225010070` 提出的「能不能升级时迁一次就删」落成精确工程条件。
- https://www.sqlite.org/pragma.html#pragma_legacy_file_format · SQLite 在淘汰旧磁盘格式写入时将 `PRAGMA legacy_file_format` 置为废弃无操作（彻底停写旧格式），但对已经落入现役数据库文件内的历史记录格式标识保持轻量兼容解析，绝不因清理旧写入器而破坏已入库历史记录 · **改了**本文第 5 节的删除边界切分——将 `U-2` 严格一分为二：**Scope A**（从外部旧文件导入的 `laneLegacy*` 事务引擎，9 个生产文件 `1,020` 行）到期整包删除；**Scope B**（解析已落入现役 `.nomi/agent-sessions/*.jsonl` 内 `nomi.ui.legacy*` 条目的 `laneLegacyNote.ts`、`laneProjection.ts:285-289` 与 `laneHost.mts:320-327` 首次续聊工具初始化，合计仅约 `36` 行）明确保留，防止已迁移老对话在续聊时丢失活跃工具集。
- https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/platform/storage/common/storageService.ts · VS Code 工作区存储层将「打开工作区即执行的底层存储版本迁移落盘」与「编辑器业务文档脏状态触发的显式/自动保存」分层隔离，只读浏览工作区不改业务文件，但存储层格式升级在打开工作区初始化阶段即原子落盘 · **确认了**本文对 `F-S-1`（`#1713`）交互关系的实查结论——核实 `F-S-1` 只把 `project.json` 业务载荷归一化改为内存态、等真编辑才写盘，而 `NomiStudioApp.tsx:332` 的 `workspace-open -> migrateLaneLegacy` 仍保持打开项目即完成旧会话落盘迁移与归档清理。

---

## 短版设计卡

- ★1：完成看板 `#1586` `SM-legacy-facts` 只读考证，查清 `U-2` 涉及的全部历史会话格式在哪个版本停写、哪个版本起自动迁移、真实写盘触发条件（含与 `F-S-1` `#1713` 的关系）、跨版本跳升走向及删除影响面清单，产出精确判定矩阵供协调结合本机线上版本分布裁定退役版本；量具：`git log -S`、`git merge-base --is-ancestor`、`scripts/prior-art-lib.mjs`、`scripts/doc-status-lib.mjs`、`scripts/check-pr-judgement.mjs`；不做什么：不改任何生产代码/测试/门岗、不猜测线上各版本人数；老用户升级影响：不适用（纯只读计划报告，零运行时改动）。
- ★2：本报告唯一交付物为 `docs/plan/2026-11-28-legacy-session-format-facts.md`；所考证概念 `agent-lane.legacy-migration` 的现役唯一 owner 为 `electron/agentLane/laneLegacyMigration.mts`（`migrateLaneLegacy`，经 `electron/agentLane/laneNativeLoader.cts` 唯一 CJS→ESM 桥供 `electron/agentLane/laneDesktopRuntime.ts:149` 调用）；证据：`docs/engineering/concept-owners/agent-lane.legacy-migration.json` 与全仓 `git grep`。
- ★3：衔接 `docs/plan/2026-11-28-code-smell-census-phase1.md` §3.2 `U-2`、`docs/plan/2026-09-08-agent-lane-stage4-switch.md`、`docs/plan/2026-09-08-agent-lane-legacy-migration.md` 与 `docs/engineering/direction-checks/2026-11-27-project-readonly-open.md`（`F-S-1`）；采用 Git 拓扑祖先核验 + AST/Prettier 双口径行数实测，消除轻量/附注标签排序偏差与文件名误判；证据：`git merge-base --is-ancestor` 与 `scripts/check-file-sizes.mjs` 同口径扫描。
- ★4：空态/加载/成功/失败/取消中/过期/能力不可用均不适用（纯只读考证文档，不触碰任何 UI 组件、IPC 通道或持久化状态）。
- ★9：正向核验 `evaluatePlans`（`0` 错误）、`documentStatus`（识别 `📋`）、`check-pr-judgement.mjs`（`push` / `merge` 双阶段均 `0` 错误）、仓库 diff 仅 1 个新增 `.md` 文件且零本机绝对路径；反例检查：验证未将仍有 6 个现役生产消费者的 `electron/shared/legacyAgentJson.ts` 或保障已迁会话续聊工具集的 `laneLegacyNote.ts` 误列入删除名单；回滚：`git revert` 本次单文档提交即可。

---

## 明确不做

1. **不修改任何生产代码、测试代码、门岗脚本或登记表 JSON**：严格执行只读考证红线，不在本分支顺手删一行 `laneLegacy*` 或 `diagnosticsIpc.ts` 代码。
2. **不臆测或捏造各版本线上活跃用户数**：线上遥测用量数据保存在协调本机、不在公开仓库；本文只给可复核的 Git 历史事实、代码落盘条件与判定公式，把最终版本号留作协调待填槽位。
3. **不把非会话类的其他迁移混入 `U-2`**：工作区目录清单迁移 `electron/workspace/legacyProjectMigration.ts`、技能包清单迁移 `electron/skills/skillManifestMigration.ts`、素材面板提示词/文件夹迁移 `src/workbench/assets/assetSurfaceMigration.ts` 与目录密钥迁移 `electron/catalog/customConfigStore.ts` 均属各自独立领域，不在 `U-2`（`lane-legacy-migration`）范围内。

---

## 一、全部历史会话格式盘点与停写版本考证（问题 1）

通过全仓源码检索（`electron/agentLane/`、`electron/ai/`、`electron/harness/`、`electron/projects/`、`electron/workspace/`、`src/workbench/ai/`）及 Git 全历史回溯，Nomi 在现役 `agent-lane`（`<project>/.nomi/agent-sessions/--nomi-lane-<name>--/*.jsonl`）之前共出现过 **5 类本地会话/对话持久化产物**（外加 1 处未发版的渲染层 `localStorage` 临时投影）。

### 1.1 逐格式诞生、停写与发版暴露面详表

| 编号 | 格式代号与磁盘路径 | 结构形态与历史写者（Writer） | 首次引入 Commit · 日期 · 首个发版 | 彻底停写（Stop-Writing）Commit · 日期 · 合入 PR | 首个不再写入该格式的 Tag / 正式 Release | 对外发版暴露结论 |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **`agent-chat-v2`**<br>`<project>/.nomi/agent-session.json`<br>*(注：未开项目的 `local` 桶曾写 `<userData>/.nomi/agent-session.json`)* | · v1：单会话 `CoreMessage[]`<br>· v2：`{ version: 2, sessions: Record<sessionKey, CoreMessage[]> }`（Vercel AI SDK 消息数组）<br>· 写者：`electron/ai/agentSessionStore.ts` | · v1：`0d020c48a6a0b152e04299928f61b227f37c5bea`（`2026-06-13 13:06:50 +0800`）<br>· v2：`800896248c95275fbd72e9b815975157ed928f55`（`2026-06-14 12:55:39 +0800`）<br>· 首个发版：**`v0.10.0`**（v2 随 `v0.10.1` 起发版，一路延续至 **`v0.21.0`** `4a405088a` `2026-08-27 06:41:23 +0800`） | · 删除 `agentSessionStore.ts`：`c48d0354c6e386273b6433b54d05b2754e980e13`（`2026-08-27 06:17:29 +0800`，经 PR `#181` `1394abbbb` 于 **`2026-08-27 15:56:31 +0800`** 合入 `main`，晚于 `v0.21.0` 发布约 9 小时）<br>· 彻底停用 `agent-session.json` 文件名：`d0e7768c5d08ed939be6a75fb2ec8c12a3b3ba78`（`2026-09-05 23:37:35 +0800`，PR `#515` `747adf599`） | · Git Tag：**`v0.22.0`**（`bf8cbd77b`，`2026-09-24`，未发 Release 包）<br>· 正式发版：**`v0.22.1`**（`a5fd5e4d1`，`2026-09-26`） | **唯一真实对外发版过的被迁旧格式**（覆盖 **`v0.10.0` ~ `v0.21.0`** 全部正式版） |
| **2** | **`conversations.json`**<br>`<project>/.nomi/conversations.json` | · `{ v: 2, creation, generation, committedProposal }`（渲染层防抖 1s 写入的展示气泡文本，上限 200 条）<br>· 写者：`src/workbench/ai/conversationPersistence.ts` → `electron/conversations/conversationsIpc.ts` | · `8acd863de9077659f4362691a0dbedff330a2df6`（`2026-06-11 23:12:46 +0800`）<br>· 首个发版：**`v0.10.0`**，延续至 **`v0.21.0`** | · 渲染层停写：`d270d34ec25fac7d090eb5729a36ba1505fdda43`（`2026-09-01 12:43:55 +0800`，PR `#301` `13a78c02b` 于 `2026-09-02` 合入 `main`）<br>· 删除死 IPC `electron/conversations/`：`4da8d99b1552f9d14ca58ee70bb7234f93df20f4`（`2026-10-07 06:02:22 -0300`，PR `#1064` `60910c8a6`） | · 停写：**`v0.22.0` tag / `v0.22.1` 正式版**<br>· 死代码移除：**`v0.24.0`**（`fe9064e7e`，`2026-10-29`） | `v0.10.0` ~ `v0.21.0` 与格式 ① 双写；**`laneLegacy*` 从不读取此文件**，相关代码已于 `v0.24.0` 彻底删净 |
| **3** | **`pi-snapshot`**<br>`<project>/.nomi/agent-thread-context-v1.json`<br>（及过渡期同路径前的 `.nomi/agent-session.json` `version: 3`） | · 外层容器 `version: 3` 或 `version: 4`（`records` 字典），内嵌 `format: "nomi.pi-work-context"`（`piVersion: "0.84.3" \| "0.85.1"` + SHA-256）<br>· 写者：`electron/harness/context/contextStore.ts` + `electron/harness/runtime/pi/snapshot.mts` | · `version: 3`：`c48d0354c6e386273b6433b54d05b2754e980e13`（PR `#181` `1394abbbb`，`2026-08-27 15:56:31 +0800`）<br>· `version: 4`（改名 `agent-thread-context-v1.json`）：`d0e7768c5d08ed939be6a75fb2ec8c12a3b3ba78`（PR `#515` `747adf599`，`2026-09-06 00:45:11 +0800`） | · 删除 `contextStore.ts`：`6a6a1775deff4e7c0d2637a0a9b6b7f223eae29b`（`2026-09-08 22:14:13 +0800`，`[switch 4/6 04]`）<br>· 删除 `snapshot.mts`：`856a8a7011cc5db524037b4849fe64b3b3fe5cd2`（`2026-09-08 22:15:16 +0800`，`[switch 4/6 05]`）<br>· 合入 `main`：**`5c507a5cc3ee74f5fa25706165cb94cd3d2e8165`**（PR `#646`，`2026-09-10 02:22:24 +0800`） | · 从生到死均在 `v0.21.0` 之后、`v0.22.0` 之前<br>· 首个包含删除态的发版：**`v0.22.0` tag / `v0.22.1` 正式版** | **零对外发版（`0` 外部用户）**：仅存活于 `main` 14 天开发期；2026-09-08 实扫 370 个本地项目亦为 `0` 份 |
| **4** | **`host-snapshot`**<br>`<userData>/project-agent-host/<partition>/snapshot-v1.json` · `snapshot-v1.backup.json` · `commands-v1.jsonl` | · `schemaVersion: 1` 自研宿主状态机快照 + SHA-256 校验和 + JSONL 幂等命令账本<br>· 写者：`electron/projectAgentHost/projectAgentRepository.ts` & `projectAgentCommandLedger.ts` | · `0b6441c6963cadce10afebc4797435db39b5abaf`（`2026-09-01 11:31:29 +0800`，经 PR `#301` `13a78c02b` 于 **`2026-09-02 03:02:43 +0800`** 合入 `main`） | · `main.ts` 切离旧宿主：`2663e7c67bbb46173974d199dc840b16508c95f0`（`2026-09-08 17:17:40 +0800`，`[switch 2/6 e]`）<br>· 删除 `projectAgentRepository.ts`：`08270670884d92667a1a2b2dfc1891b618c28010`（`2026-09-08 22:22:31 +0800`，`[switch 4/6 12]`）<br>· 合入 `main`：**`5c507a5cc3ee74f5fa25706165cb94cd3d2e8165`**（PR `#646`，`2026-09-10 02:22:24 +0800`） | · 从生到死均在 `v0.21.0` 之后、`v0.22.0` 之前<br>· 首个包含删除态的发版：**`v0.22.0` tag / `v0.22.1` 正式版** | **零对外发版（`0` 外部用户）**：仅存活于 `main` 8 天开发期 |
| **5** | **`prior-cutover-archive`**<br>`<project>/.nomi/project-agent-cutover.json` + `project-agent-cutover-preparation.json` + `project-agent-legacy-archive-v1/<stamp>-agent-session.json` | · `schemaVersion: 1, mode: "archive-only"` 宿主期归档凭证对 + 重命名的原 `agent-session.json`<br>· 写者：`electron/projectAgentHost/projectAgentMigration.ts` & `projectAgentCutoverManifest.ts` | · 同④：`0b6441c6963cadce10afebc4797435db39b5abaf`（PR `#301` `13a78c02b`，`2026-09-02 03:02:43 +0800`） | · 删除 `projectAgentCutoverManifest.ts`：`548c2a3a965802a4370bc7e5a8354170e0e84f9e`（`[switch 4/6 06]`）<br>· 删除 `projectAgentMigration.ts`：`5505c1f3c3df156dffe5fa51bb75926749b585d3`（`2026-09-08 22:19:18 +0800`，`[switch 4/6 09]`）<br>· 合入 `main`：**`5c507a5cc3ee74f5fa25706165cb94cd3d2e8165`**（PR `#646`，`2026-09-10 02:22:24 +0800`） | · 从生到死均在 `v0.21.0` 之后、`v0.22.0` 之前<br>· 首个包含删除态的发版：**`v0.22.0` tag / `v0.22.1` 正式版** | **零对外发版（`0` 外部用户）**：仅 `2026-09-02 ~ 09-10` 跑过源码 `main` 的开发机可能生成 |

*(附注：① 2026-09-01 至 09-08 宿主开发期还曾有过渲染层 `src/workbench/ai/resident/residentToolProjection.ts` 向 `localStorage` 缓存工具正文，已于同批 `bfcf1ec85` `[switch 4/6 16]` 删除，零对外发版；② 仓库 `v0.10.0 ~ v0.16.6` 与 `v0.23.1 ~ v0.23.2` 的 git tag 打在发版分支提交上而非 `main` 第一父链，本文全部采用 `git show <tag>:<path>` 与 `git merge-base --is-ancestor <sha> <tag>^{commit}` 双重校验，并通过 `gh release list` 核实 `v0.22.0` 无已发布 Release、首个含 `agent-lane` 的正式公开 Release 为 **`v0.22.1`**。)*

### 1.2 当前全仓是否存在隐藏写入点（Hidden Writers 核查）

在基线 `e0ad90bff` 对 `src/` 与 `electron/` 执行全量正则检索，结论为 **全部 5 种旧会话格式在生产代码中均是 `0` 写入点**：

1. **生产写口唯一性**：现役 Agent 会话转录唯一写口为 `electron/agentLane/laneSession.mts`（委托 `@earendil-works/pi-agent-core/harness/session` 的 `JsonlSessionRepo` 写入 `<project>/.nomi/agent-sessions/--nomi-lane-<name>--/*.jsonl`），当前选中会话指针唯一写口为 `electron/agentLane/laneWorkspaceSelection.ts`（写入 `<project>/.nomi/agent-workspace.json`）。
2. **`laneLegacy*` 自身仅在首次发现未迁移旧文件时写迁移归档与清单**：`laneLegacyMigration.mts` 仅写出 `.nomi/lane-legacy-migration.json`、`.nomi/legacy-archive/<transactionId>/*`（只读 `0o400` 备份）及向现役 `JsonlSessionRepo` 追加迁移后的新格式条目，**绝不反向写入任何旧格式文件**。
3. **测试合成写点（仅限 `os.tmpdir()` 隔离目录）**：仅 `tests/agent-runtime/lane-legacy-*.test.mts`、`tests/ux/agent-lane-legacy-migration.walk.mjs`、`tests/perf/canvas-scale/workbenchScenarios.mjs:236`（`project-open-legacy-first-open` 造数辅助）与 `tests/ux/agent-lane-observer.test.mjs:46` 在临时目录构造合成旧格式字节以验证迁移逻辑。
4. **顺手检出的 1 处历史只读残留（非写点）**：`electron/diagnostics/diagnosticsIpc.ts:33-51` 的 `resolveAgentLedgerPath` 仍在拼接已退役的 `<settingsRoot>/project-agent-host/<partition>/commands-v1.jsonl` 供诊断包导出读取（现役项目上恒不存在），后续执行 `U-2` 清理时可顺手一并退役或改指 `.nomi/agent-sessions/` 轨迹索引。

---

## 二、自动迁移上线版本、真实写盘条件与跨版本跳升路径（问题 2）

### 2.1 哪个版本起上线自动迁移

- **上线 Commit 与合入时间**：
  - 核心事务与桌面入口接线：`3a058ef00ec05f5fa7c2c48a7f40f10da5220213`（`2026-09-08 21:11:37 +0800`，`feat(agent-lane): [switch 3/6 i] restore proven archives before exposing migrated workspaces`）与 `3e02116df1a18e7b2c792ac169b96b32c2fc66d3`（`2026-09-08 21:26:09 +0800`，`[switch 3/6 j]`）；
  - 合入 `main` 第一父提交：**`5c507a5cc3ee74f5fa25706165cb94cd3d2e8165`**（`2026-09-10 02:22:24 +0800`，`Merge pull request #646 from aqm857886159/feat/agent-lane-stage4-switch-20260908`）；
  - 所属版本号：当时 `package.json` 为 `0.21.0`（开发态），首个包含它的 git tag 为 **`v0.22.0`**（`bf8cbd77b`，`2026-09-24`），首个对外正式发布的 GitHub Release 为 **`v0.22.1`**（`a5fd5e4d1`，`2026-09-26`），此后 **`v0.22.1` ~ `v0.24.1` 及当前 `main` 全系版本均内置该自动迁移**。
- **后续唯一一次行为优化（无锁快路）**：
  - `1a84ba59fa53d635df4c35be1468286aac87fbad`（`2026-10-05 21:25:43 -0300`，PR `#1041` 合入 `9f8245553`，首进正式版 **`v0.24.0`**，因 `v0.23.1`/`v0.23.2` 从 `v0.23.0` 分支热修未合此单）新增 `settledWithoutLock`：当项目**既无未迁移旧源文件又无旧归档**，或 `.nomi/lane-legacy-migration.json` 已处于 `phase: "completed"` 时，直接无锁返回、零写盘零 `fsync`；**一旦检测到存在未迁移旧源文件，仍照常进入加锁落盘迁移**。

### 2.2 落盘触发条件实核（特别核对 `F-S-1` `#1713` 之后的真实行为）

这是裁定退役窗口最关键的工程事实，**必须将「单项目打开即写盘」与「未打开的休眠项目不写盘」两面同时说清**：

1. **对「被打开过的项目」：打开即自动完成持久写盘迁移，不依赖用户编辑或保存，也不受 `F-S-1`（`#1713`）影响**：
   - 调用链：`src/workbench/NomiStudioApp.tsx:332-340` 在每次打开任意项目进入工作台时（无论落在生成画布、分镜、创作还是预览页，哪怕 Agent 面板处于收起态、用户零点击立即关窗），都会无条件调用 `openProjectAgentLane` → `laneClient.open(binding)` → IPC `workspace-open` → `electron/agentLane/laneDesktopRuntime.ts:148-152` `migrateLaneLegacy(...)`。
   - 写盘事务：只要该项目存在未迁移的 `.nomi/agent-session.json`（或 ③/④/⑤ 任一源），`migrateLaneLegacy` 当场持 `.nomi/lane-legacy-migration.lock` 执行完整落盘事务：
     1. 写 `.nomi/lane-legacy-migration.json`（`phase: "prepared"`）；
     2. 将旧源原字节校验并硬链归档至 `.nomi/legacy-archive/<transactionId>/`（`0o400` + `fsync`）；
     3. 经 `openLegacyImportLane` → `JsonlSessionRepo` 创建 `<project>/.nomi/agent-sessions/--nomi-lane-legacy-<32位hex>--/<timestamp>_<sessionId>.jsonl`，追加全部历史消息与 `nomi.ui.legacy-source` / `nomi.ui.legacy-complete` 条目，并冷重启重读核验条数；
     4. 若尚无 `.nomi/agent-workspace.json`，写入默认选中该迁移会话；
     5. 删除原路径下的活跃旧源文件（如 `.nomi/agent-session.json`），将 `.nomi/lane-legacy-migration.json` 更新为 `phase: "completed"`。
   - **与 `F-S-1`（`#1713`，`8ac788921`，2026-11-28 合入）的精确边界核实**：实核 `git diff 8ac788921^1..8ac788921^2` 确认，`F-S-1` 改的是 `projectPersistenceService` / `workbenchProjectSession` 对 **`.nomi/project.json` 业务快照**的只读内存基线（老 `project.json` 只看不改不落盘，等真编辑或运行结局才落盘），**完全未触碰 `NomiStudioApp.tsx:332` 或 `migrateLaneLegacy`**。（`F-S-1` 走查夹具为 `v0.24.1` 项目，盘上本来就是 `.nomi/agent-sessions/` 而无旧会话文件，故命中 `settledWithoutLock` 零写盘。）因此，**不存在「打开过项目但因没编辑/保存而停留在内存旧会话格式」的情况**。
2. **对「从未在 `>= v0.22.1` 点开过的休眠老项目」：盘上仍是旧格式 `.nomi/agent-session.json`**：
   - 全仓没有任何在应用启动时遍历 `recent-workspaces.json` 或 `Nomi Projects/` 批量跑 `migrateLaneLegacy` 的逻辑；`migrateLaneLegacy` 的唯一生产入口是单项目 `openWorkspace`。
   - **诚实推论**：即便某个老用户的客户端早已升级到 `v0.24.1`（在线上版本统计里显示为新版本用户），如果他电脑里还有一个 `<= v0.21.0` 时期创建、但升级后**一次都没点开过**的旧项目，那个旧项目文件夹里的对话至今仍是 `.nomi/agent-session.json`（及 `.nomi/conversations.json`），尚未生成 `.nomi/agent-sessions/`。

### 2.3 不经过中间版本直接跨版本跳升（如 `v0.19.0` / `v0.21.0` 直升 `v0.25.0+`）数据怎么走

1. **在未删除 `laneLegacy*` 的版本上跳升（如 `v0.10.0 ~ v0.21.0` 直接跳升到 `v0.24.1` / 当前 `main`）**：
   - **一步直达，无需经过 `v0.22.x` / `v0.23.x` 中间版本**。
   - 对更早无 `immutableProjectUuid` 的 `<= v0.20.x` 项目，`laneDesktopRuntime.ts:145` 在调 `migrateLaneLegacy` 之前会先执行 `ensureWorkspaceProjectIdentity(projectDir)` 补齐项目身份绑定，随后 `migrateLaneLegacy` 直接将 `.nomi/agent-session.json` 一次性转为 `.nomi/agent-sessions/--nomi-lane-legacy-<hash>--/*.jsonl`。
2. **在删除 `laneLegacy*`（Scope A）之后的版本上跳升或打开项目**：
   - **情形 A（曾在 `v0.22.1` ~ 删除前一版打开过至少 1 次的项目）**：盘上已是标准 `.nomi/agent-sessions/--nomi-lane-legacy-<hash>--/*.jsonl` 与 `.nomi/agent-workspace.json`，`openLaneWorkspace` 直接通过 `JsonlSessionRepo` 原生读取，**历史对话、上下文续聊与顶部「这段对话来自旧版本」提示 100% 完好无损**（前提是保留下述 §4.2 的 Scope B `~36` 行内嵌标记读取代码）。
   - **情形 B（从 `<= v0.21.0` 直升新版本，或升级后从未打开过的 `<= v0.21.0` 休眠项目首次打开）**：项目本身的文稿、分镜、画布、时间轴与素材全部照常打开；Agent 通道因 `.nomi/agent-sessions/` 为空，会新建一条空白 `main` 会话，盘上原有的 `.nomi/agent-session.json` 原封不动留在 `.nomi/` 下但不再自动导入（若按 `Q-smell` `U-2` ★1c 建议保留 10 行存在性检测，可在面板给出一行只读说明，而非静默装作无历史）。
   - **可选加速方案（回应 `#1586#issuecomment-7225010070`「升级时迁一次就删」）**：若协调希望连「已升新版客户端但未点开的本地库内老项目」也一并兜住，可在即将发布的最后一版（如 `v0.25.0`）应用启动空闲期对 `workspaceRepository` 已登记项目目录后台跑一次 `migrateLaneLegacy`（已落定项目走 `settledWithoutLock` 仅几次 `lstat`、零写盘；未迁老项目自动迁完），到 `v0.26.0` 即可连休眠库内项目的顾虑一起消除并整包删掉 `laneLegacy*`。

---

## 三、Git 历史证据完整时间线表

| 阶段 | 日期（含时区） | Commit SHA（含合入提交） | 当时 `package.json` / 首个发版 Tag | 关键改动文件与会话格式行为 |
| :--- | :--- | :--- | :--- | :--- |
| 旧格式诞生 ① | `2026-06-11 23:12:46 +0800` | `8acd863de9077659f4362691a0dbedff330a2df6` | `0.9.6` → **`v0.10.0`** | 新增 `electron/conversations/conversationsIpc.ts` 与 `src/workbench/ai/conversationPersistence.ts`，按项目写入 `.nomi/conversations.json` 展示气泡（上限 200 条）。 |
| 旧格式诞生 ② | `2026-06-13 13:06:50 +0800` | `0d020c48a6a0b152e04299928f61b227f37c5bea` | `0.9.6` → **`v0.10.0`** | 新增 `electron/ai/agentSessionStore.ts`，将 AI SDK `CoreMessage[]` 工作缓存落盘至 `<project>/.nomi/agent-session.json`（v1 单会话）。 |
| 旧格式演进 ②' | `2026-06-14 12:55:39 +0800` | `800896248c95275fbd72e9b815975157ed928f55` | `0.10.0` → **`v0.10.1`** | `agentSessionStore.ts` 升为 `SESSION_FILE_VERSION = 2`（`{ version: 2, sessions: Record<sessionKey, CoreMessage[]> }`），按 `creation` / `generation` 分区隔离记忆。 |
| **末个旧格式正式版** | **`2026-08-27 06:41:23 +0800`** | **`4a405088af583aabf2585eb11c78e83ec1cb792e`**<br>（合入 `main`：`0f363e694` PR `#197` `07:00:47`） | **`v0.21.0`**（正式 GitHub Release） | **最后一个写入旧会话格式的正式发布版**：树内仍为 `agentSessionStore.ts`（写 `.nomi/agent-session.json` v2）与 `conversationsIpc.ts`（写 `.nomi/conversations.json` v2）。 |
| 未发版过渡 A | `2026-08-27 15:56:31 +0800` | `c48d0354c6e386273b6433b54d05b2754e980e13`<br>（合入 `main`：`1394abbbb` PR `#181`） | `0.21.0` 开发期（未打 tag） | 删除 `electron/ai/agentSessionStore.ts`（**AI SDK `CoreMessage` 格式停写**）；引入 `contextStore.ts`（`version: 3` + `nomi.pi-work-context` 信封，暂复用 `agent-session.json` 路径）。 |
| 未发版过渡 B | `2026-09-02 03:02:43 +0800` | `0b6441c6963cadce10afebc4797435db39b5abaf` & `d270d34ec25fac7d090eb5729a36ba1505fdda43`（PR `#301` 合入 `13a78c02b`） | `0.21.0` 开发期（未打 tag） | 引入 `electron/projectAgentHost/`（写 `<userData>/project-agent-host/<partition>/snapshot-v1.json` + `commands-v1.jsonl` 及 `.nomi/project-agent-cutover*.json`）；同批移除渲染层 `conversationPersistence` 调用（**`conversations.json` 停写**）。 |
| 未发版过渡 C | `2026-09-06 00:45:11 +0800` | `d0e7768c5d08ed939be6a75fb2ec8c12a3b3ba78`<br>（合入 `main`：`747adf599` PR `#515`） | `0.21.0` 开发期（未打 tag） | `contextStore.ts` 升为 `version: 4`，路径迁至 `<project>/.nomi/agent-thread-context-v1.json`（**`.nomi/agent-session.json` 路径彻底停写**）。 |
| 新格式影子切片 | `2026-09-07 10:14:08 +0800` | `3dde3365c8265e9ba96ec6948c6c8fb46d39fa64`<br>（合入 `main`：`0ad7d97ef` PR `#567`） | `0.21.0` 开发期（未打 tag） | 新增 `electron/agentLane/laneSession.mts`，确立现役 `<project>/.nomi/agent-sessions/`（pi `JsonlSessionRepo`）存储结构（影子期）。 |
| **原子切换与自动迁移落地** | **`2026-09-08 17:17 ~ 22:31 +0800`**<br>（**`2026-09-10 02:22:24 +0800`** 合入 `main`） | 切换：`2663e7c67`（`[switch 2/6 e]`）<br>迁移：`3a058ef00`（`[switch 3/6 i]`）<br>删旧：`6a6a1775d` / `856a8a701` / `548c2a3a9` / `5505c1f3c` / `082706708`<br>**合入 `main`：`5c507a5cc3ee74f5fa25706165cb94cd3d2e8165`（PR `#646`）** | `0.21.0` 开发期 → 首进 **`v0.22.0`** tag / **`v0.22.1`** 正式版 | **一次性切入现役 `agent-lane`**：① `openWorkspace` 接入 `migrateLaneLegacy` 打开项目自动落盘迁移；② 同 PR 删除 `contextStore`、`snapshot.mts`、`projectAgentHost`（52 文件）与 `agentChatV2`，**所有旧格式与过渡格式全部彻底停写**。 |
| 首个含迁移的 Tag | `2026-09-24 06:51:21 +0800` | `bf8cbd77b130c3e990fda3da30d7e40671ba76d9` | **`v0.22.0`**（仅 git tag，未发 GitHub Release） | 首个包含 `agent-lane` 与 `migrateLaneLegacy` 的版本标签。 |
| **首个含迁移的正式版** | **`2026-09-26 18:21:57 +0800`** | **`a5fd5e4d13c7205d51c17f16eed3f93ed43c950b`**<br>（合入 `f2e159223` PR `#896`） | **`v0.22.1`**（正式 GitHub Release `Nomi v0.22.1`） | **首个面向外部用户分发安装包的新会话格式与自动迁移正式版**。 |
| 打开零写快路 | `2026-10-05 21:25:43 -0300` | `1a84ba59fa53d635df4c35be1468286aac87fbad`<br>（合入 `main`：`9f8245553` PR `#1041`） | `0.23.0` 开发期 → 首进 **`v0.24.0`** | `laneLegacyMigration.mts` 新增 `settledWithoutLock`：无旧文件或已 `completed` 时无锁直答、零写盘；有旧文件仍加锁写盘迁移。 |
| 清退 `conversations` 死码 | `2026-10-07 06:02:22 -0300` | `4da8d99b1552f9d14ca58ee70bb7234f93df20f4`<br>（合入 `main`：`60910c8a6` PR `#1064`） | `0.23.0` 开发期 → 首进 **`v0.24.0`** | 删除早已无调用方的 `electron/conversations/` 与 `conversationPersistence.ts`。 |
| 老项目 `project.json` 只读打开 | `2026-11-28 01:22:53 +0800` | `8ac7889214511c3e437d847284d5d9b359ad55d7`（PR `#1713` `F-S-1`） | `0.24.1` 后 `main`（待发 `v0.25.0`） | `project.json` 内存归一化不再在只读打开时落盘；**未改动 `migrateLaneLegacy`**，含旧会话文件的项目打开时仍立即写盘迁入 `.nomi/agent-sessions/`。 |

---

## 四、删除旧会话兼容层涉及的文件、符号、行数与测试夹具清单（问题 3）

按 SQLite「退役旧格式写入/导入器，但永久保留已入库记录的轻量读取兼容」原则，删除工作必须严守 **Scope A（可整包删除的一次性旧文件迁移引擎）** 与 **Scope B（严禁误删的已迁移会话内嵌标记读取与共享工具）** 的边界。

### 4.1 Scope A：到期可直接删除的生产文件与调用点（合计整删 9 文件：`1,020` 物理行 / `1,485` 格式化代码行）

#### A1. 整文件删除的生产模块（9 个文件）

| 序号 | 精确文件路径 | 物理行（`raw`） | 格式化代码行（`fmt`，`check:filesize` 口径） | 导出符号（Exports） | 职责说明 |
| :---: | :--- | :---: | :---: | :--- | :--- |
| 1 | `electron/agentLane/laneLegacyFiles.ts` | 159 | 226 | `createLegacyFileAccess`, `withLegacyMigrationLock` | 旧文件 `O_NOFOLLOW` 身份校验读取、硬链归档、`.nomi/lane-legacy-migration.lock` 锁 |
| 2 | `electron/agentLane/laneLegacyImportLane.mts` | 33 | 55 | `openLegacyImportLane` | 无凭据/无工具的只写导入用 `AgentHarness` 包装 |
| 3 | `electron/agentLane/laneLegacyImportPlan.mts` | 213 | 321 | `LegacyAppendOperation`, `LegacyConversationPlan`, `planLegacyImport` | 将 `pi` / `ai-sdk` / `host` 三种旧消息转换为 pi `AgentMessage` 与工具对校验 |
| 4 | `electron/agentLane/laneLegacyIntegrity.mts` | 99 | 135 | `ValidatedLegacyConversation`, `ValidatedLegacySource`, `validateLegacySource` | 旧容器 SHA-256、分支图、项目 UUID 绑定准入校验 |
| 5 | `electron/agentLane/laneLegacyMigration.mts` | 217 | 373 | `migrateLaneLegacy` | 迁移主事务（`settledWithoutLock` → 归档 → 追加 → 冷验 → 清理旧源 → 写 `lane-legacy-migration.json`） |
| 6 | `electron/agentLane/laneLegacyPriorArchive.mts` | 36 | 53 | `readLegacyPriorArchive` | 读取未发版宿主期 `.nomi/project-agent-cutover*.json` 归档对 |
| 7 | `electron/agentLane/laneLegacySources.ts` | 130 | 120 | `LegacySourceKind`, `LegacyFormat`, `LegacyItem`, `LegacyConversation`, `LegacySource`, `legacyRecord`, `parseLegacySource` | 三种旧容器 JSON 解包器（`self-written.json` 登记的 7 个 `laneLegacy*` 小计：**`887 raw / 1,283 fmt`**） |
| 8 | `electron/shared/agentLane/laneLegacyMigrationContract.ts` | 17 | 27 | `LegacyImportLabels`, `LegacyMigrationOptions`, `legacyMigrationCountsSchema`, `LegacyMigrationCounts`, `MigrateLaneLegacy` | 跨 CJS/ESM 桥的迁移入参、多语言标签与计数 Zod 契约（仅 Scope A 引用） |
| 9 | `electron/shared/agentLane/legacyPiSnapshot.mts` | 116 | 175 | `LEGACY_PI_SESSION_VERSION`, `snapshotEntrySchema`, `legacyPiDigest`, `validateLegacyPiData`, `validateLegacyPiEnvelope` | 旧 `nomi.pi-work-context` 信封 schema（生产侧仅 `laneLegacyIntegrity.mts` 引用） |
| **合计** | **9 个整删生产文件** | **`1,020`** | **`1,485`** | **25 个导出符号** | — |

#### A2. 需同步修剪的生产接线点（5~6 个文件，净删约 `25~45` 行）

1. `electron/agentLane/laneDesktopRuntime.ts`（第 7、148–152 行）：移除 `MigrateLaneLegacy` 类型导入及 `openWorkspace` 中 `measureProjectOpenMainStage('lane-legacy-migration', () => migrateLaneLegacy(...))` 调用（若拍板对极老未迁 `.nomi/agent-session.json` 给一行只读提示，则在此处或投影层换为 ~10 行无锁 `existsSync` 提示标记）。
2. `electron/agentLane/laneNativeLoader.cts`（第 1、42–43 行）与 `electron/agentLane/laneNativeLoader.entries.json`（第 11 行）：移除 `migrateLaneLegacy` 动态 `import('./laneLegacyMigration.mjs')` 转发桥及入口白名单项。
3. `electron/projects/projectOpenTimeline.ts`（第 10 行）：从 `ProjectOpenMainStage` 联合类型移除 `"lane-legacy-migration"` 阶段名。
4. `electron/i18n.ts`：清理仅 `migrateLaneLegacy` 使用的 `agent.legacySummary` 与 `agent.legacyUnverifiedTool` 两条主进程词条（核实无其他消费者后移除）。
5. *(可选顺手清理)* `electron/diagnostics/diagnosticsIpc.ts`（第 33–51 行 `resolveAgentLedgerPath`）及 `electron/diagnostics/diagnosticsBundle.test.ts:68`：清退指向未发版旧宿主 `project-agent-host/<partition>/commands-v1.jsonl` 的死路径拼接。

---

### 4.2 Scope B 与同名共享工具：严禁随 `U-2` 误删的两处红线

> [!WARNING]
> **防误删红线 1 — `electron/shared/legacyAgentJson.ts`（`42 raw / 38 fmt`，导出 `stableProjectAgentJson`、`ProjectAgentSnapshotError`）不可删除！**
> 虽然文件名带 `legacyAgent`，但全仓 `git grep` 实核表明它正被 **6 个现役核心生产模块**直接导入用于确定性 JSON 序列化：`electron/providerAdapter/promotionMeta.ts:3`、`electron/shared/director/planPatch.ts:19`、`src/workbench/creation/storyboard/exec/storyboardActionGuard.ts:5`、`src/workbench/generationCanvas/nodes/director/model/directorPreviewState.ts:16`、`src/workbench/generationCanvas/nodes/director/model/planOverrides.ts:16`、`src/workbench/generationCanvas/runner/runProjectDelivery.ts:1`。退役 `U-2` 时**严禁删除该文件**（日后可单独重命名为 `canonicalJson.ts`）。

> [!WARNING]
> **防误删红线 2 — 已迁入现役 `.nomi/agent-sessions/*.jsonl` 内部自定义条目的读取与首次续聊工具初始化（合计约 `36` 行）必须保留！**
> 凡在 `v0.22.1` ~ 退役前版本打开并完成迁移的老项目，其新格式 `.nomi/agent-sessions/--nomi-lane-legacy-<hash>--/*.jsonl` 转录内**已永久写入** `nomi.ui.legacy-source`（`LANE_LEGACY_NOTE`）与 `nomi.ui.legacy-complete`（`LANE_LEGACY_COMPLETE_NOTE`）自定义条目，且导入时 `activeToolNames` 为空数组 `[]`：
> 1. `electron/agentLane/laneHost.mts:320-327`：当用户首次在某条已迁移会话里继续发消息时，靠检测 `LANE_LEGACY_NOTE` 且尚无 `LANE_LEGACY_TOOLS_NOTE` 来执行一次 `lane.setActiveTools([...activeToolNames])`；**若误删此 8 行，已在 `v0.22.1+` 迁好但尚未续聊过的历史对话在未来续聊时将没有任何可用工具！**
> 2. `electron/shared/agentLane/laneLegacyNote.ts`（`21 raw / 29 fmt`）、`electron/shared/agentLane/laneProjection.ts:285-289` 与 `src/workbench/ai/v4/AgentPanelV4Panel.tsx`（`legacy` prop → `data-v4-legacy="true"`「这段对话来自旧版本」横条）：负责过滤内部完成标记并如实展示历史来源提示。保留这 `~36` 行零维护负担，可确保所有已迁移项目永久无损。

---

### 4.3 测试、走查、性能场景、老用户夹具与受保护门岗登记影响清单

1. **可整文件删除的专属单测与桌面走查（7 个文件，合计 `863` 物理行）**：
   - `tests/agent-runtime/lane-legacy-files.test.mts`（`122 raw / 170 fmt`）
   - `tests/agent-runtime/lane-legacy-import-plan.test.mts`（`152 raw / 309 fmt`）
   - `tests/agent-runtime/lane-legacy-integrity.test.mts`（`86 raw / 137 fmt`）
   - `tests/agent-runtime/lane-legacy-migration.test.mts`（`233 raw / 363 fmt`）
   - `tests/agent-runtime/lane-legacy-sources.test.mts`（`98 raw / 192 fmt`）
   - `tests/agent-runtime/lane-legacy-transaction-sources.test.mts`（`94 raw / 195 fmt`）
   - `tests/ux/agent-lane-legacy-migration.walk.mjs`（`78 raw`）
2. **需同步更新或一并退役的关联测试与性能场景（4 处）**：
   - `tests/agent-runtime/replayShadowSources.mts`（`353 raw / 345 fmt`）与 `agent-lane-replay-shadow.mts`：第 25 行导入了 `laneLegacySources.js` 的 `parseLegacySource`，系阶段 4 切换前离线语料对比工具（`pnpm run replay:shadow`），随 `laneLegacySources.ts` 删除时可一并退役或内联最小读取器；
   - `tests/agent-runtime/lane-open-graph.test.mts:8`：移除对已删文件 `legacyPiSnapshot.mjs` 的 `LEGACY_PI_SESSION_VERSION` 导入断言（保留对 `laneHost` / `laneNativeLoader.entries.json` 的懒加载门岗断言）；
   - `tests/perf/scenarios/project-open-legacy-first-open.json` 与 `tests/perf/canvas-scale/workbenchScenarios.mjs:171-237`：该性能场景（当前 `measurement.state: "pending"`）使用 `.nomi/agent-session.json` 构造首次打开旧会话迁移负载，退役 `U-2` 时需更新为仅测旧画布无预览图首次打开或注销旧会话造数段；
   - `tests/ux/agent-lane-observer.test.mjs:46` 与 `tests/ux/g1/sweep-evidence.mjs:61`（及 `sweep-evidence.node-test.mjs:20`）：移除对旧 `agent-session.json` / `agent-thread-context-v1.json` 的扫描分支。
3. **`tests/fixtures/old-user-data/` 真实老用户夹具核查结论**：
   - 全量清点 `tests/fixtures/old-user-data/` 下全部 **148 个跟踪文件**：**没有任何旧版会话夹具（`0` 个 `agent-session.json`、`0` 个 `conversations.json`、`0` 个 `agent-thread-context-v1.json`、`0` 个 `snapshot-v1.json`）**。
   - 该目录下唯一含会话文件的夹具是 `tests/fixtures/old-user-data/projects/v0.24.1-readonly-open/` 下的 3 个项目，它们存的全部已是**现役格式** `.nomi/agent-sessions/--nomi-lane-main--/*.jsonl` 与 `.nomi/agent-workspace.json`，因此删除 `U-2` **不会破坏任何现有 `old-user-data` 夹具**（若拍板保留极老 `.nomi/agent-session.json` 一行只读提示，届时需按 ★1c 补入 1 份真实 `<= v0.21.0` 项目夹具）。
4. **受保护工程登记与历史根因合同同步项（执行删除 PR 时必须在 `## 碰到的规则与门岗` 逐一点名）**：
   - `docs/engineering/self-written.json`：删除 `entries` 中的 `"id": "lane-legacy-migration"` 条目（结清 1 项 `to-replace` 告警）；
   - `docs/engineering/concept-owners/agent-lane.legacy-migration.json`：整文件删除（PR 正文需按门岗规范注明 `删除：旧会话迁移窗口结束，owner 随模块整体退役`）；
   - `scripts/vocabularies-baseline.json`：移除 `laneLegacyMigration.mts`、`laneLegacySources.ts`（2 处）、`legacyPiSnapshot.mts`（及 `projectOpenTimeline.ts` 阶段词）共 4~5 条冻结词表记录并下调上限；
   - `scripts/boundary-owners-ledger.json`：实核确认 **`0` 命中**（无需改动）；
   - 历史根因合同与逃逸账本引用核对：`docs/fixes/2026-09-08-*.root-cause.json`（5 份阶段 4 迁移合同）、`docs/fixes/2026-09-03-windows-directory-fsync-barrier.root-cause.json`、`docs/fixes/2026-10-06-agent-runtime-lazy-load.root-cause.json`、`docs/fixes/2026-10-06-open-project-read-path-writes.root-cause.json`、`docs/fixes/2026-10-06-windows-legacy-file-identity.root-cause.json`、`docs/fixes/2026-10-31-generation-idle-work.root-cause.json`、`docs/fixes/2026-11-24-t8-raw-rename-to-jsonfile.root-cause.json` 及 `tests/ux/full-walk/escapeLedger/FB-20261005-01-open-agent-load.json` 中提及 `laneLegacy*` / `legacyPiSnapshot.mts` 路径，执行删除 PR 时需按 `check:root-cause` 规则以退役注释归档对应已删文件的 `enforcement_path`（与 `#646` `36f343204` 退役 `agentChatV2` 合同时的做法一致）。
