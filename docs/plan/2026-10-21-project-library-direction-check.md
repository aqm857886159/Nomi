# 方向检查：项目库「回库」慢（P-library，RW）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> **用户 10-21 放行**：按本页推荐的「接入现成」方案做结构改动（列表摘要收成唯一异步读面、主进程内部异步限并发、渲染层统一异步、状态检查批量限并发、同一 PR 删同步通道与 `desktop.projects.list`、给 `invokeSync` 登记门岗）。
> 触发：`node scripts/fix-churn.mjs` 对 `electron/projects/projectsIpc.ts`、`electron/preload.ts`、`src/workbench/library/localProjectStore.ts` 命中（目录 / 概念 14 天内已有 3 个 fix，这一刀是第 3–4 个）。按规矩停手，本页交协调拍板，未改任何实现代码。

## 0. 一句话根因

「项目列表摘要」没有唯一主人：渲染层有同步通道（`nomi:projects:list`，sendSync）和异步通道（`list-async`）两条，主进程里两条读的都是同一个**同步**全库扫描 `listProjects()`；加异步只是换了个门，主进程照样被堵。

## 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 61738de3f6 / aae1a31bbc（主进程写口、退出排空） | 同一份项目文件有多个写口 | 主人不唯一 |
| 9a24cecc24（暂存件回收） | 清理挂在「打开项目」上 | 生命周期没单一主人 |
| 71181df6f9（库报错直送主进程原文） | 列表读失败的错误态没有统一出口 | 读面没主人 |
| 本题：回库 sendSync 等全库 + 卡片出来后全库同步检查 | 读面有同步 / 异步两条、内部同步扫描、状态检查挂在 mount + focus | 读面没主人 |

## 2. 为什么会一直出现

- `electron/projects/projectsIpc.ts:56-60`：同一个 `listProjects` 同时挂 `registerSyncIpc("nomi:projects:list")` 和 `ipcMain.handle("...list-async")`。
- `electron/projects/repository.ts:137-185`：`listProjects()` 内部 `listWorkspaceProjects` 对每个项目做 manifest 快照读（同步 fs），再有 GC、`existsSync`。换成 handle 也是在主进程事件循环里一口气跑完。
- 渲染层：`src/workbench/project/projectRepository.ts:116-120` 的 `listLocalProjects()` 仍调同步 `desktop.projects.list()`；`localProjectStore.ts` 的 SWR fetcher、`publishLocalProjectRecord`、`unpublishLocalProject` 都落到它；`src/workbench/assets/useAllProjectAssets.ts:159` 已经走 `listAsync`，说明异步面早就有，只是没收口。
- 卡片后：`ProjectLibraryPage.tsx:186-210` 的 `inspectSyncProjects` 对所有带 rootPath 的项目 `Promise.all` 一把发 `workspace.syncInspect`，无并发上限，且挂在 mount + window focus 上。
- 门岗：`electron/preload/ipcCall.ts` 的 `invokeSync` 没有白名单，谁都能加一条 sendSync。

## 3. 不改结构的话会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 把渲染层换成 `listAsync` 但不改 `listProjects` 内部：渲染层不再干等，但主进程 340ms 级的阻塞原样在，别的 IPC（保存、生成事件）排队，perf 数字几乎不变 | 只改渲染层后跑 `project-library-list`，同时看 `main-process-while-generating` |
| 库规模翻倍（80+ 项目）线性变慢 | 场景加 `--library-projects 80` |
| 下一条新通道又写成 `invokeSync` | 没有门岗，grep 即见 |

## 4. 靶子独立性

场景 `project-library-list` 与 10-16 追踪是同一条线（C-trace）出的数；本次按任务书先在最新 main 重测（数字见交付报告）。预算 300ms 已批准，不动。

## 5. P0：是我们独有的吗

「读一个目录下 N 个小 JSON 摘要、带缓存与失效」不是领域特有，是通用的异步读 + 缓存。渲染层已用 SWR（现成）；主进程这边应当用 `fs.promises` 限并发读，或由 registry 持有摘要缓存（manifest mtime 失效）。没有需要自写的新基础设施。

## 6. 对比表

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成 | 渲染层 SWR 继续用；主进程用 `fs.promises` + 现成限并发（p-limit 一类，已在依赖里则复用）读摘要 | 改 `repository.ts` / `workspace` 列举为异步，波及所有调用 `listProjects` 的主进程内部入口 | 触碰「项目目录单写口」概念（热点） | 是 |
| 补 | 只把渲染层换 `listAsync`、删同步通道 | 小 | 主进程仍同步扫描，预算大概率达不到（预测 1） | 否 |
| 重写 | 摘要缓存表（registry 内存 + mtime 失效） | 中 | 失效策略错了会出现陈旧卡片 | 备选，作为接入方案的第二步 |
| 删 | 删 `nomi:projects:list` 同步通道与 `desktop.projects.list` | 要先把渲染层所有入口改异步（见下 door-map） | 测试脚本 `tests/ux/*` 若干处还在用 `projects.list()` | 随接入方案一起做 |

## 7. 要用户（协调）权衡的核心

要不要放行一次「碰热点」的结构改动：把项目列表摘要读面收成单一异步主人（主进程内部也异步 + 限并发状态检查），一次删掉同步通道，而不是再补一刀。我的推荐：放行，因为只补渲染层一定达不到 300ms。

## door-map（已数）

- `listLocalProjects`：读入口 1 扇（`projectRepository.ts:116`，经 `localProjectStore.ts` 转出）。
- `refreshProjects`：读 3 扇、写 2 扇，共 13 处（`localProjectStore.ts`、`ProjectLibraryPage.tsx`、`NomiStudioApp.tsx` 的首屏 / 回库 / 导入后 / 删除后 / 外部改动后，`openWorkspaceFlow.ts:79`）。
- 同步通道残留：`desktop.projects.list` 在 `projectRepository.ts:119`；测试脚本 `tests/ux/antigravity-cli.live.walk.mjs`、`shot-nodes-media.e2e.mjs`、`library-load-error.walk.mjs`（注入 `nomi:projects:list` 故障）。

## 特征测试清单

未写：本页是停手报告，特征测试在协调放行后、动结构之前补（覆盖摘要读面、坏项目、回库首屏不等状态检查）。

---

# N1：回收与保存排队（P-library-2，10-22）

> 触发：`node scripts/fix-churn.mjs electron/workspace/workspaceRepository.ts` 报**文件本身**近 14 天第 3 个 fix（目录 electron/workspace/ 第 4 个）。不是只因目录口径命中，按规矩交协调转用户。
> 特征测试已写、已红：`electron/projects/draftGcInterleave.test.ts`「保存正在排队等锁时列举收尾：不回收；保存成功落盘」（照 V-plibrary 用例 C）。实测：列举收尾后草稿目录已被删（`folderAfterGc=false`）。实现代码未动。

## 0. 一句话根因

空草稿回收的「销毁授权」只看「此刻盘上的清单」，看不到「本进程已经发出、正在排队等锁的写」；写的那一侧取锁时又会 `mkdirSync(.nomi, {recursive:true})`，把已经删掉的项目根重新建出来。两边各缺一条不变量：**删之前要问「有没有人正要写它」，取锁时不能凭空造出项目根。**

## 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 5b2f4d05c5（F1：列举途中已保存的草稿被删） | 回收拿列举开始时的旧摘要当授权 | 销毁授权看不全「谁在写」 |
| 本题 N1（保存排队等锁时被删） | 授权重读时锁刚空，看不到排队中的保存 | 销毁授权看不全「谁在写」 |
| 本题 N1 附带：孤儿目录 | 取锁 `mkdirSync(nomiDir, {recursive:true})` 在根被删后重建根 | 写口能凭空创建项目根 |

## 2. 为什么一直出现

- 回收挂在「列举」这个读动作上（`electron/projects/repository.ts` 的 once-guard）：读的时机变成了删的时机，而列举在 #1268 后是异步的，期间同进程什么写都能插进来。F1 修了「已经写完的」，没修「正在排队的」。
- 本进程「正在排队的清单写」没有可查询的状态：`workspaceManifestTransaction.ts` 只有给 staged 事务排序用的 `stagedTransactionTails`，非 staged 的 `withWorkspaceManifestTransaction` 等锁时完全不可见。门数（door-map）：`acquireWorkspaceManifestLock` 只有 `workspaceManifestTransaction.ts` 里两处调用（staged / 非 staged 两扇门），同步写 `withWorkspaceManifestTransactionSync` 在同步段里一口气做完，不会跨过回收那段同步代码。所以「本进程正要写某根」可以在这一个文件里收全。
- 取锁层没有「根必须已存在」的不变量：`tryAcquireCanonicalWorkspaceManifestLock` 每次重试都 `mkdirSync(nomiDir, {recursive:true})`。
- 铁律 ⑩⑪⑫ 不适用（这是存储层生命周期，不是意图 / 入口 / 点击预期）。

## 3. 不改结构会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 只给 `stagedTransactionTails` 加一判：非 staged 写（`withWorkspaceManifestMutation`，改名 / 修复等）排队时照样被删 | 用例 C 把 `saveProject` 换成走 `withWorkspaceManifestMutation` 的写 |
| 只修授权不修取锁：任何「写者排队期间目录被外部删掉」（用户在资源管理器删 / 同步盘挪走）仍重建孤儿目录 | 等锁期间 `rmSync` 根目录，放锁后看根是否被重建 |
| 换成「重读 + 删」放进同一次 `withWorkspaceManifestTransactionSync`：解决跨进程那一瞬，但本进程排队的保存在回收放锁后照样拿锁、发现项目没了、报错 | 同用例 C |

## 4. 靶子独立性

用例 C 来自验收线 V-plibrary（另一条线），不是本线写的；特征测试照抄它的时序。

## 5. P0

「删之前确认没人要写」是通用的意图登记 / 引用计数，不需要新依赖；仓库里锁、事务都已自写并登记在 electron/workspace（领域：项目目录单写口）。没有现成库能替这段同步授权。

## 6. 选项

不管选哪个，都保留同一条共用改动：**取锁时根不在，就抛明确的「项目文件夹已不存在」**。
- 不重试；
- 不再用 `mkdirSync(recursive)` 重建孤儿目录；
- 改在 `workspaceManifestLock.ts`，约 10 行。

下面只比回收本身。

### A：回收仍挂在列举上，删除授权补看「排队中的写」

- 回收仍挂在首次列举上。
- `workspaceManifestTransaction.ts` 把两扇异步写门统一登记成「本进程对某根有待办写」：进门就登记，finally 撤掉。
- 导出一个查询，回收授权 `isStillEmptyNativeDraft` 在同一段同步代码里问它；有待办写就不删。

### B：「重读 + 删」放进同一把锁

- 回收在锁里重读，然后删整个根，锁目录跟着一起删。
- 锁模块要新加一条「消费掉租约」的退场路径。
- 只挡得住跨进程那一瞬；本进程排队的保存照样丢（见预测 3），所以仍然要 A 的查询。不单独选它。

### C：回收搬到启动、接受写入之前

- 主进程启动时，在 IPC / MCP 注册之前，自己扫一遍候选再删。

### C′：列表只读，空草稿在「离开 / 退出」时收（协调 10-22 要求补）

**1. 列表只读**
- `listProjects` 删掉回收调用和 once-guard，`resetEmptyDraftGcGuard` 一起删。
- `native + draft + revision 0` 的项目不出现在返回里。

**2. 离开时收**
- 时机：`NomiStudioApp.leaveProject` 里，`await unbindPersistence()` 之后。这时这个项目自己的保存队列已经排空，回执也到了。
- 调新的主进程口 `discardEmptyDraftProject(id)`。主进程侧分两步：
  - 先排进这个根的写队列（复用 `stagedTransactionTails`），所以排在它前面的保存一定先落盘；
  - 轮到它时在锁里重读，下面几条全满足才删，否则什么都不做：仍是 draft、rev 0、native；`assets/` 里没有文件；本进程没有别的待办写。
- 它替掉现在的 `gcEmptyDraftWorkspaceProjects` 和 `isStillEmptyNativeDraft`，同一提交删掉旧的。
- 不挂在持久化 unbind 上。原因：`activeProject` 每次换对象，effect 都会 cleanup 一次，unbind 就跟着跑一次。挂在那里，用户还在项目里时就可能误收。

**3. 退出时收**
- 时机：现有退出排空项 `renderer-project-flush` 收到渲染层回执之后。
- 对象：主进程记着的当前打开项目（`canvasReadSurfaceRuntime.getCommittedProjectSelection()`），调同一个 `discardEmptyDraftProject`。
- 只在正常退出时做。系统关机 / 注销是 500ms 紧急退出，不做，留给下面第 4 条。

**4. 崩溃残余：推荐一直隐藏、不删**
- 占的地方很小：零编辑草稿只有清单 + 备份两个小文件，几 KB。
- 来源很窄：只有「开着一个没动过的空白项目时崩溃」才会留下。
- 后台再扫一遍，就又多了一个「删东西的主人」，又回到「它和谁并发」的老问题。
- 列表已经不显示它，用户看不到；代价只是注册表多一行。
- 以后真攒多了，可以在「离开项目」那一刻顺手收，不用新开时机。

**5. 改动量**

生产代码约 +120 / −120 行，8–9 个文件：

| 文件 | 改动 |
|---|---|
| `electron/projects/repository.ts` | −30 / +12：删 GC 块和 guard，加隐藏过滤和 discard 包装 |
| `electron/workspace/workspaceRepository.ts` | −55 / +35：旧 GC 换成单项目 discard |
| `electron/workspace/workspaceManifestTransaction.ts` | +15：排进根队列，加待办写查询 |
| `electron/workspace/workspaceManifestLock.ts` | +10：即共用改动 |
| `projectsIpc.ts`、preload、桥类型 | +10 |
| `src/workbench/NomiStudioApp.tsx` | +3 |
| 退出排空：`shutdownProjectFlush.ts` 或 `main.ts` 注册处 | +8 |
| `scripts/check-read-path-writes.mjs` | +2（见第 9 条） |

- 测试：约 8 条 GC 测试要改写成「离开 / 退出时收」。
- 热点：`NomiStudioApp.tsx` 是这个文件 14 天内第 3 刀，`electron/projects/` 目录也是第 3 刀。

**6. 启动顺序：不碰**
- `main.ts` 的启动顺序不变，只在退出排空里多挂一步。

**7. 退出多花多久**
- 当前项目不是空草稿：只多一次清单读，约 1ms。
- 是空草稿：多一次取锁、重读，再删一个几 KB 的目录，本机约 5–20ms。
- 这一步排在 flush 之后，不占紧急退出的 500ms 预算。

**8. 跨进程残留窗口：还在，但缩到「离开那一下」**
- MCP 新路走本机 HTTP 转发进主进程（`mcpHttpForwarder.ts`），算本进程写者，排进同一条根队列，已覆盖。
- 剩下的跨进程写者是 `isMcpStdio` 旧模式，以及另一台机器经同步盘写进来。
- 它们只在用户离开 / 退出一个零编辑草稿的那一瞬才会撞上。撞上了，那次写会明确报错（共用改动保证）：不丢已确认的内容，也不造孤儿目录。
- 和现在比：窗口从「每次启动的首次列举」缩到「离开那一下」，而且只涉及那一个项目。

**9. 和 `check:read-path-writes` 的关系：为什么它没拦住「列举时删东西」**
- 这不是豁免：`read-path-writes-baseline.json` 是空的。原因是**不在它的范围里**。
  - 这条门岗的写盘门刻意只有 `atomicWrite`、`writeConnectorPrefs` 两个，管的是「名字说只读的函数，不许改用户设置」。
  - 项目内容落盘明写了归根因合同的 doors 管。
  - 所以 `listProjects → gcEmptyDraftWorkspaceProjects → deleteWorkspaceProject → fs.rmSync` 这条链根本不在它的图上。
- C′ 做完后，把 `deleteWorkspaceProject` 作为销毁门加进它的写盘门：
  - 列举路径已经走不到它，门岗是绿的；
  - 以后谁让 `list* / read* / resolve* / get*` 能走到删项目，门岗自动变红。
- 注册表写这次不加（`removeWorkspaceReference`、`rememberWorkspaces`、`backfillWorkspaceOrigins`，列举时也会调）。它们是登记自愈，不是销毁；一加就得登记一串豁免。
- 选 A 的话，这扇门加上就会立刻变红（列举还能走到删除），只能登记豁免，门岗等于没用。

**10. 用户看得见的变化**（⚠ 第一条写错了，以文末「§8 10-22 更正与落地范围」为准）
- ~~新建空白项目、一下没动就回项目库：卡片当场消失。现在要下次启动才消失。~~
- MCP / Agent 的项目列表里，看不到还没保存过的空白项目。当前绑定的项目不靠列表，不受影响。

### 对比

| 选项 | 代价 | 风险 | 推荐 |
|---|---|---|---|
| A | 小：2 个热点文件各十几行；界面行为不变 | 列表仍在删东西；「首次列举 = 本进程还没写过」仍只靠调用顺序；`check:read-path-writes` 加不上销毁门（一加就红）；跨进程窗口在每次启动 | 可以止血，不推荐当终版 |
| **C′** | 中：约 ±120 行、8–9 个文件、约 8 条测试改写；碰 `NomiStudioApp.tsx` 热点 | 用户看得见：空白项目回库即消失；退出多 1–20ms；跨进程窗口只剩「离开那一下」，撞上是明确报错 | **是** |
| C | 改 `main.ts` 启动顺序；多扫一遍候选，10-16 共用列举省下的 55–63% 冷启动又要付回去 | 动冷启动预算和启动路径；仍是「启动时删东西」，跨进程窗口在每次启动 | 否 |

**推荐 C′，理由：**
- 删除从读路径上彻底拿掉，只发生在这个项目自己的生命周期终点，而且排在它自己的写后面。「回收和保存并发」在结构上不成立。
- 门岗能把「读路径走得到销毁」变成自动红。
- 不碰启动顺序。

代价是一次中等改动，加一个用户看得见、但符合原意的变化：没动过的空白项目不留卡。

**更根本的问法：空草稿回收该不该挂在「列举」上？不该。**
- 列举是读，读的时机不该决定删的时机。
- 「首次列举 = 本进程还没写过」这个前提只靠调用顺序维持，没有结构保证。比如只要哪天启动时自动恢复上次项目并保存（今天没核实有没有），就会和首次列举并发。

C′ 就是这个答案的落地。

## 7. 要用户权衡的核心

- A：列表里继续删，只是把删除授权补严。
- C′：列表只读，删除挪到「离开 / 退出这个项目、它的保存排空之后」。

一句话：**要不要接受「没动过的空白项目一回库就消失」，换来「读列表永远不会删东西」这个结构保证。** 推荐 C′。

**拍板（10-22）**：用户选 C′。实现时查出第 2、3 步走不到，按协调确认只做共用部分，见下节。

## 8. 10-22 更正与落地范围（实现时查实）

**更正：用户看得见的变化写错了。**
- 今天离开项目（`leaveProject`）和关窗口（`useProjectWindowLifecycle` 的关闭确认）都会先调 `persistActiveWorkbenchProjectNow`。它无条件把当前状态整存一次，`saveWorkspaceProject` 首存即清 draft、revision +1。
- 所以离开或关窗口过的空白项目会被「转正」，永久留在库里。今天如此，C′ 共用部分落地后也如此，**可见行为不变**。
- 今天能留下 draft + rev 0 的只有崩溃、系统关机 / 注销（那条排空只写欠着的）、强杀。旧的启动回收实际上也只收这些。
- 「空白项目离开即消失」要等「离开只写欠着的」（协调记账的 A 项）落地。

**所以 C′ 的第 2、3 步（离开时收、退出时收）现在写了也走不到。**
- 它们运行时草稿早已转正，等于两段死代码，还要多碰热点 `NomiStudioApp.tsx`。
- 按协调 10-22 确认，并进 A 项：A 让离开只写欠着的之后，「离开 / 关闭后经根队列在锁里重核再收」才是活代码。

**本 PR 落地的共用部分：**
- 列表只读：删掉 `gcEmptyDraftWorkspaceProjects`、`isStillEmptyNativeDraft`、once-guard、`resetEmptyDraftGcGuard`。
- 能证明为空的草稿不显示：native、此刻清单仍是 draft + rev 0（对候选再读一次）、`assets/` 无真实文件。
- 崩溃残余隐藏、不删。
- 取锁时根不在抛 `WorkspaceRootMissingError`，不重试，不再递归建目录。
- `deleteWorkspaceProject` 进 `check:read-path-writes` 的销毁门。
- N2：列表每项错误只落在这一张卡。

**代价：** 崩溃 / 关机 / 强杀留下的空草稿目录在盘上隐藏保留（每个几 KB，列表看不到），直到 A 项落地。今天它们在下次启动时被删。

**结果：** 进程里现在没有任何东西会自动删项目（删除器已删），「回收与保存并发」此刻无从发生。以后有人把删除接回读路径，由 `check:read-path-writes` **门岗自动拦**——它只认门函数名和 read / list / resolve / get 前缀，读路径里直接 `fs.rmSync` 或从别的前缀走到删除能绕过，那一层靠测试兜（V-plibrary2 S7 更正措辞）。

## door-map（已数）

- `gcEmptyDraftWorkspaceProjects`：1 扇（`electron/projects/repository.ts` listProjects）。
- `acquireWorkspaceManifestLock`：1 个文件 2 处（`workspaceManifestTransaction.ts` 的 staged / 非 staged 写门）。
- `withWorkspaceManifestTransaction`：1 扇（`workspaceManifest.ts` 的 `withWorkspaceManifestMutation`）；`withWorkspaceManifestStagedTransaction`：1 扇（`withWorkspaceManifestStagedMutation`，保存走这里）。

### 8a. 自写登记命中：gate-family

本 PR 改了 `scripts/check-read-path-writes.mjs`，它属于自写登记 `gate-family`（status: under-review，reviewBy 2026-10-31，paths: `scripts/check-*.mjs`）。这次只是在这道已有门岗的写盘门名单里加一扇 `deleteWorkspaceProject`，不新开门岗。

**为什么现在换不了现成方案：**
- 要守的是我们独有的领域不变量：名字承诺「只读」的函数（list / read / resolve / get）不许沿调用链走到「删项目目录」。
- 考察过 dependency-cruiser 和 eslint-plugin-boundaries，它们管的是「哪个模块能 import 哪个」，表达不了「函数名前缀 → 跨文件调用链 → 某个具体函数」这种可达性。
- ESLint 的 `no-restricted-syntax` 只看单个文件里的语法形状。

**哪天换：** gate-family 在 2026-10-31 前出合并 / 删除清单时一并评估。届时考虑把「删项目」收进一个只能由删除 IPC 拿到的能力对象（类型层做不出读路径调用），这条门岗规则随之删除，不留两份。
