测了 7 份项目 × 4 页 × 2 种窗宽（共 56 次）+ 1 份项目 × 2 种存档 × 3 种本机状态 × 4 页 × 1440 / 1100（28 次）+ 反例与复跑 6 次，共 90 次真窗 · 项目目录里被改写或新增 7 个文件（内容变 2、只改修改时间 1、新增 5），项目文件内 6 类字段（新版项目）到 16 类（老格式项目），其中内容变 15 类、只改时间戳 3 类（savedAt / updatedAt / revision）· 没人动手就会落盘的路 4 条（项目文件 2 条，项目目录新文件 2 条）· 14 天内同类 fix 2 个 · 推荐「换做法」

# 打开项目什么都不点就关，项目文件为什么被改写：类根因复盘

状态：复盘当时只读、未改仓库；由没参与过修补的线独立写成，入库时只去掉了本机路径。尺子：真窗（隔离资料目录、`tests/ux/_launchApp.mjs`）+ 前后逐文件哈希 + `.nomi/project.json` 字段级 diff。测量脚本与原始结果留在复盘线本机，没有入库；常驻量具见 `tests/ux/open-writes-nothing.walk.mjs`。

## 0. 一句话根因

同一个界面状态「Nomi 栏开还是收（和宽多少）」有两个主人：项目文件里的 `editingPanelLayout`（跟着项目走）和本机每页的形态偏好 `bySurface`（跟着这台机器走）。打开项目时外壳要让两边一致，这个「对齐」走的是保存项目的同一条漏斗（任何一次 `persistRevision` 变化 → 整份项目重写），于是一次没人操作的对齐就把整个项目文件改了。

## 1. 量出来的事（真窗，零点击）

| 起始 | 页 | 项目文件 | 改了什么 |
|---|---|---|---|
| 新版项目（存档里 Nomi 栏展开），本机偏好为空 | 生成页（项目一打开就在这页） | 内容变 | `visibility.assistant` 真 → 假；`generationCanvasLastSeq` 0→1；`lastKnownRootPath` 换成本机路径 |
| 同上 | 分镜页 | 内容变 | 同生成页（这页默认也是小球） |
| 同上 | 创作页 | 内容变 | 文稿 `contentJson`（`[]` → 一段空段落）+ 该文稿 `updatedAt`；lastSeq；rootPath；栏开关净值不变，但文件写过至少两次（先收后开） |
| 同上 | 预览页 | 内容变 | 只有 lastSeq、rootPath（栏先收后开，净值不变） |
| 同上，窗宽 1100 | 生成 / 分镜 / 创作 / 预览 | 内容变 | 以上再加 `assistantWidth` 390 → 340（还原时按窗宽夹一下，下一次保存带出去） |
| 本机偏好全设成「停靠」，任何窗宽，生成 / 分镜 / 预览 | — | 内容不变（备份文件只改修改时间） | 没有任何项目字段被写（6/6 次，含 1100 窄窗、含存档宽 534） |
| 本机偏好全设成「停靠」，创作页 | — | 内容变 | 只有文稿空段落那一项 |
| 老格式项目（v0.20 / v0.24，payload 只有一个 marker） | 任何页，只要触发了上面任一次写入 | 内容变 | 整份补全：marker 删掉；多出空文稿、`activeDocumentId`、`timeline`、`generationCanvas`、`categories`、lastSeq、`editingPanelLayout`；v0.20 还多 `immutableProjectUuid`、`projectGeneration` |

项目目录里别的文件（每次都出现，与是否写 project.json 无关，84/84 次）：`.nomi/agent-workspace.json`（新增）、`.nomi/agent-sessions/…`（新增 3 个：trace.jsonl、trace.md、会话 jsonl）、`.nomi/events/log-0.jsonl`（新增，开场快照事件）。机器外：`recent-workspaces.json` 的最近打开时间（78 次；这个不在项目里，不同步）。`project.backup.json`：项目文件写了就跟着内容变（66 次），没写则只改修改时间（12 次）。

计数口径：84 次里 78 次项目文件内容变、6 次不变，6 次不变全是「本机偏好=停靠」的非创作页。

## 2. 每个被改写的字段：谁写的、为什么在、归谁

| 字段 | 没人操作时是谁写的 | 为什么有（git log -S） | 内容 / 习惯 | 现在存在哪 | 谁说了算 |
|---|---|---|---|---|---|
| `visibility.assistant`、`projectAgentDockCollapsed` | `ShellAgentHost.tsx` 里 `useEffect(… [form])` 挂载就把「这页的形态是不是小球」写进项目（`setProjectAgentDockCollapsed`，会 bump） | f59b38d80（10-08 外壳重设计）：让本机每页形态成为这个字段的「唯一写入者」；它之前 e738ecc65（09-06 用户拍板）让 Nomi 栏开合随项目记住 | 这台机器 / 这个人的界面习惯；却存进了项目 | 项目文件 + `nomi:shell-agent-form:v1`（localStorage）+ 内存里两个 store 字段；生命期登记也不一致（`workbenchStoreLifetime` 记 project，`agentFormStore.bySurface` 记 window） | 打开时本机说了算，项目里的值被覆盖；用户拖或 Agent `layout.write` 时项目值又说了算——没有单一出处 |
| `assistantWidth`、`preset` | 还原存档时 `setEditingPanelLayout` 按当前窗宽夹一下（`clampEditingPanelLayout`），夹出来的值下一次保存写回 | 夹宽是为了窄窗别撑爆；写回是漏斗的副作用，没人决定过 | 窗口 / 习惯（窗口的派生值） | 项目文件里存了一个与窗宽相关的值 | 谁都没拍板——是「派生值被当意图写回」 |
| 文稿 `contentJson`、`updatedAt` | `WorkbenchEditor.tsx` `handleChange`：TipTap 挂载后发 init update，`normalizeWorkbenchContentJson` 的结果和编辑器输出字符串不等（`[]` 对 `[{paragraph}]`）就当用户改了 | d0ff95aed（08-29）加了「打开草稿不许改 revision」的相等判断，但空文稿的两种写法没算相等 | 项目内容（但这次不是用户写的） | 项目文件 | 编辑器的规范化；与用户无关 |
| `generationCanvasLastSeq` | `replayCanvasEventTailAndSealGenesis` 打开时补发 `canvas.snapshot.restored`（来源标 user），seq 0→1；下一次保存带出去 | 507c3607c / 62507bbf6（06-12）崩溃恢复：「快照 + 尾部重放」 | 项目内容（事件序号） | `.nomi/events/log-0.jsonl` + project.json | 引擎；本身没问题，问题是它搭别的写入的车才落进项目文件 |
| `lastKnownRootPath` | `workspaceRepository.ts` 读取时换成本机当前绝对路径，下一次保存写回（5628a820c，10-29） | 项目被搬动后能找回 | 这台机器（绝对路径） | 项目文件里 | 读取时的派生；**跨机器同步的文件里一定带着另一台机器的路径** |
| 老格式补全（marker 删、timeline、categories、layout、uuid、generation） | `hydrateProject` 迁移 + 第一次保存写整份规范化 payload | 数据迁移（原本就该做一次） | 项目内容的规范化 | 项目文件 | 迁移；实测它不会自己写——只在上面任一触发后才落盘 |
| `.nomi/agent-workspace.json`、`agent-sessions/*` | `laneWorkspace.mts` 的 `writeLaneWorkspaceSelection` 和会话轨迹，打开项目打开 Agent 通道时写 | Agent 通道把工作区放进项目目录 | 机器 / 会话产物 | 项目目录里 | 通道；不是用户的项目内容，却和项目一起同步 |

要点：真正让整个项目文件落盘的**触发**只有两个（Nomi 栏对齐、编辑器挂载）；其余字段（lastSeq、rootPath、夹宽、迁移补全）本身都不会触发保存，只是搭上这趟车。实证：本机偏好=停靠且在非创作页，6/6 次没有任何项目字段被写，连老格式迁移、lastSeq、夹宽都没落盘。

## 3. 入口与归类（door-map）

| 项 | 数 | 说明 |
|---|---|---|
| 保存项目的写入口 | 2 | `saveLocalProject`：`deleteAssetResult.ts:144`（删素材后清扫）、`projectPersistenceService.ts`（改名 / 自动保存 / 迁移保存） |
| 自动保存订阅 | 1 | `subscribeWorkbenchProjectPersistence`：任何一个 store 的 `persistRevision` 变 → `saveIfReady` → 去抖 → 整份重写；`isHydrating` 时不动；`pagehide` / `beforeunload` 同步冲刷 |
| `persistRevision` 变化点（src，非测试） | 约 60 处 bump | `workbenchStore.ts` 32（时间轴 / 分类）、`workbenchDocumentSlice.ts` 13、布局 slice 8、`timelineClipWritesSlice.ts` 4、画布 store 6；另有画布动作的写入层登记（见 §6） |
| 归类（按文件，未逐条） | — | 用户动作：时间轴 / 文稿 / 分类 / 布局拖动；Agent 动作：画布动作与 `layout.write`、`capabilityApplyHandler`；**加载或挂载时的同步：2 条已实证（Nomi 栏对齐、编辑器 init）**；窗口变化：还原夹宽（只改值、自己不触发保存） |
| 没人动手就落盘的路 | 4 | 项目文件 2：Nomi 栏对齐、编辑器 init；项目目录新文件 2：通道工作区 + 会话轨迹、事件日志开场快照 |
| 未触发、未实证 | — | 本地图片 `previewState` 后台回填、删素材清扫：夹具里没有对应数据，**未验证**，不记入上面的 4 条 |

## 4. 为什么 14 天内的两次 fix 没断根、旧「打开不写」测试为什么没拦住

14 天内同类 fix：`67a647f76`（保留哪边的统一规则）、`c97089ff7`（窄窗侧栏：布局由舞台宽派生，只有拖分隔条才写存档）。两个都带 `Direction-Check: 2026-11-05-preview-narrow-panels.md`。那份复盘已经点出同一个类：「派生值被当意图写回」（§1 的 onResize 回写），但只修了**预览页分栏**这一条回写。同一个类还有两条没动：Nomi 栏对齐（本复盘 §2 第一行）和还原夹宽。它们在另一个文件里（`ShellAgentHost.tsx`、`setEditingPanelLayout`），不在上次复盘列的「入口」里。

先独立写、后对照：我的结论和 11-05 那份在「两个出处、派生值回写」上一致；不同的是，它把类定在「表示层缺一层这一刻怎么摆」，我把类定到更上游——**项目写入漏斗对任何调用都开着**，所以只要有一个状态既是机器习惯又存在项目里，对齐就一定变成项目写入，补一处防一处，下一处还会出来。

为什么旧门岗没抓到：
1. `electron/projects/storyboard.oldUser.test.ts` 断言「没有项目写、文件字节不变」，但只跑服务层 `hydrateProject`，从没挂载外壳，挂载期 effect 看不见。
2. 库夹具（v0.20 / v0.24）的 payload 只有 marker，没有 `editingPanelLayout`，抓不到布局这一类；本机偏好从来是空，也就从没出现过「本机说球、项目说展开」。
3. 「打开不写」只在 11-09 的模型参数设计卡出现，口径是参数合法，不是整个项目文件。
4. 没有任何走查在「零点击打开→关」前后比项目文件哈希。

## 5. 三条路

| | 沿原方向修 | 换做法（推荐） | 删 |
|---|---|---|---|
| 做什么 | 让 `ShellAgentHost` 对齐不 bump：只改内存，不进项目文件；编辑器空文稿算相等 | 机器习惯（Nomi 栏开合、宽、形态）不再写进项目：由本机偏好单一持有；项目里的旧值只在本机没偏好时当初始种子，永不写回；项目写入入口加「写入层登记」：每个写项目的 action 必须声明是用户动作 / Agent 动作 / 事实，挂载期对齐没有资格；编辑器初始化事务不算编辑 | 把 `editingPanelLayout.visibility.assistant`、`assistantWidth`、`preset` 整体从项目文件拿掉 |
| 证据 | 内存里两份会不同（球页内存「收」、文件「开」），之后任意一次无关保存（比如加一个节点）就把「收」写进文件，**漏出来的还是这个字段**，只是推迟到用户动手时 | 11-05 复盘 §5 同方向；画布已有先例 `CANVAS_ACTION_LAYERS`（`satisfies Record<ActionName, Layer>`，漏登记编译不过） | 09-06 用户拍板过「Nomi 栏开合随项目记住」，删等于推翻这条产品裁决 |
| 代价 | 小，约 2 个文件；但同类还会再来第三次（第三个特例） | 中：布局 slice 的 8 个 bump 逐个登记，加一个编译期登记表，改 `ShellAgentHost`、restore、编辑器 init，补 1 条走查 | 中偏大 + 要用户重新拍板；且老项目里的值要怎么读还得设计 |
| 会不会再来 | 会（换个页面 / 窗宽 / 新的挂载 effect） | 登记表让「挂载期写项目」做不出来；新字段必须归层 | 不会（字段没了），但别的挂载期写入（编辑器、lastSeq）不是它管的 |
| 老用户升级 | 不变（文件格式不动） | 老项目里存的值照旧能读，不丢；跨机器不再被另一台机器的习惯改写；上一次存的栏宽 / 开合在新机器上变成「初始种子」，行为上多数人看不出区别 | 老项目里这几个字段读到就忽略；用户原来「项目记得 Nomi 栏开着」的体验消失 |
| 对 Agent `layout.read/write` 契约 | 不变 | id / 输入输出形状不变；`layout.read` 返回的 `visibility.assistant` 改读本机有效状态；`layout.write` 仍是 Agent 动作（写本机偏好 + 照旧进撤销栈）；另顺手核对 `assistantWidth` 契约上限（320–600）与代码（300 起）的不一致 | 去掉这三个字段后契约要改版（`version: 2`）或在读里按固定值返回 |

推荐「换做法」。用户要权衡的一句话：**Nomi 栏是开着还是收着，该跟着项目走，还是跟着这台机器走？**（09-06 拍的是跟着项目走；但实测它让「只看一眼」变成改文件，且这个值在一个人有多台机器、多个窗宽时本来就不该共用。）我的判断是跟着机器；这是在改用户 09-06 拍板的行为，需要用户点头，所以请协调会话把这一条原话交用户确认，再动手。其余（编辑器 init 相等、写入层登记、走查）是纯修，不问。

## 6. 系统哪里没拦住（强弱依次）

1. 删：本机习惯类字段退出项目文件（见上面推荐，等用户点头）；`lastKnownRootPath` 改成不进同步文件（只留本机 `recent-workspaces.json`）；`.nomi/agent-sessions` 放进默认忽略清单，不再和项目同步。
2. 结构上做不出来：布局 slice 照搬 `CANVAS_ACTION_LAYERS` 做一张 `PROJECT_WRITE_LAYERS`（`satisfies Record<ActionName, 'user' | 'agent' | 'fact'>`），`bumpPersist` 只收带层的调用；挂载 / 还原 / 窗口变化没有层，写不进去。
3. 门岗自动拦：把 measure.mjs 缩成常驻走查「打开不写」：存档一份真完整 payload 的夹具（v0.24.1 storyboard）× 4 页 × 本机偏好 3 种（空 / 全球 / 全停靠）× 窗宽 1440 / 1100，零点击打开→关，断言 `project.json` 字节不变（备份和 recent 不算）。每次约 14–22 秒，24 次约 6–8 分钟，适合夜间 / 合并前档；挑 8 个代表组合约 2.5 分钟可进常规档。抖动风险低：判定是文件哈希，不是像素；已有 3 点需要处理：时间戳不参与、等待 3 秒让去抖保存落地、结束前强制 `pagehide`。另加一条单测：挂载外壳后断言 `persistRevision` 不变（毫秒级，进推送快检）。
4. 写规则文字：生命期登记里 `project` 的字段不许由 `bySurface`（window 生命期）写入——可由现有 `workbenchStoreLifetime` 检查扩一条；这条最弱，只作补充。

## 7. 反例与复跑（量具自检）

- 反例 1（故意改一下）：`MEASURE_POKE=1`，打开后按 ⌘\ 切 Nomi 栏 → 表里出现 `visibility.assistant`、`assistantWidth` 等改动。
- 反例 2（复跑）：同一输入（v0.24.0 docs、存档宽 534、创作页）跑两遍，改写字段完全一致（`assistantWidth` 534→390、`preset` custom→default、文稿空段落、整份补全）。
- 对照：存档宽 534 在老格式夹具上总被重置成 390（marker 型 payload 走的是默认值），在完整 payload 的 v0.24.1 夹具上不会，**以完整 payload 夹具的数为准**；这点我没追到还原路径的具体行，记为未验证。

## 8. 没做完 / 限制

- 每个项目文件内的字段计数基于 78 次写入的 diff；`persistRevision` 约 60 处 bump 没逐条分类，只实证了 2 条挂载期写入，其余按文件归类。
- 没有测「真实用户的另一台机器上打开」，只测了机器偏好的三种起始值。
- 磁盘剩 20G，未触发停点。SecurityAgent 无进程。

## 9. 拍板与落地

用户 2026-11-13 拍板：跟机器走

落地范围（这一刀）：只动 `visibility.assistant`（Nomi 栏开 / 收）这一项。它在项目文件里的字段保留、格式不变，打开时读一次，之后任何动作在结构上都改不到它（布局 slice 唯一的落盘口把它钉在打开时的值）；显示改读本机每页形态。编辑器初始化不算编辑。布局 slice 的落盘动作进写入层登记表（`LAYOUT_ACTION_LAYERS`），没登记的动作编译不过。栏宽、预设、`lastKnownRootPath`、项目目录里的 Agent 会话文件不在这一刀里，见 PR 的「已知限制」。

落地中新发现（协调会话 2026-11-13 批准扩到工作区层这一处）：没有身份字段的 v0.20 那一代项目，打开时补身份（`immutableProjectUuid`、`projectGeneration` 两个字段）会写一次项目文件。修前这一笔被紧跟的整份重写盖住、同步基线随之更新；去掉整份重写后，基线停在补身份之前，第二次打开就冒「另一台电脑有新版本」。修法在补身份函数内部（它的 7 个调用方都经过这里）：写之前的内容哈希等于基线时，写完把基线跟上；不等（别处真改过）就不动基线，冲突照报；这台机器没有基线记录也不造。反例：去掉这一行，走查第二次打开红；手改项目文件，冲突照报。
