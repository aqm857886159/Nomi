# 素材面二次收敛：决策逻辑 + 施工方案（2026-07-22）

> 状态：**待用户拍板，未动任何产品代码。**已拍：收敛方向（改回 07-12 方案一）、文件夹迁进素材库。待拍：三张样张（用户反馈"要改"，待指出哪里）、托盘裁剪清单。
> 本文第一篇是决策逻辑（为什么），第二篇是施工细节（怎么做）。读完第一篇应能回答：为什么触发、为什么这样改而不是别的、改了哪些、对用户有什么用、不改会怎样。

---

## 第一篇：决策逻辑（通俗讲解）

### 1. 什么触发了这次改动

- **2026-07-22 用户提出**：「页面既有素材库又有素材盒，功能重复，分析一下怎么调。」
- 摸底代码 + git 历史后发现：**这不是新问题，是旧决策被翻掉了**——
  - 07-12：用户提过一模一样的体感（commit dee486de 原文「用户体感两组重复」），出三态样张对比后**用户拍板方案一**：「找素材=浏览器，存素材=素材库，素材盒只在捕捞现场出现」，当天执行干净（三处顶栏入口删光、宿主文件整删、走查加"顶栏无素材盒"负断言）。
  - 07-19：合并外部协作者 PR#41（主体是模型配置/参考图提示词，都是想要的）时，**捎带一条 `25a181e5 restore global asset library popover` 把删掉的东西原样复活**，PR 描述一句带过、零理由、零提及在推翻拍板。
  - 防线为什么没响：「顶栏无素材盒」断言活在手动 R13 走查里（reference-capture.walk.mjs:202，现在跑必红），但 PR 合并只跑 typecheck/test/build——**守卫不在合并必经之路上**。
- 所以触发本次改动的不是"想优化"，而是：**已拍板的产品边界被无声翻掉，且暴露了两个流程漏洞**（外部 PR 未拆合、设计不变量守卫放错 lane）。

### 2. 不改会怎样：现状对用户的具体伤害（每条真机实证）

| 现象 | 用户遭遇 | 实证 |
|---|---|---|
| 两个门面名字一字之差 | 「找素材去素材库还是素材盒？」每次都要想；两边功能还不一样（音频只有素材库有） | 截图 02/03/04（tests/ux/shots/asset-surface-survey/） |
| 删除口径分裂 | 在素材盒删掉的图，素材库里还活着——用户以为删了其实没删（素材盒只在 localStorage 记"别显示"，文件没动） | useBrowserAssetActions.ts:330 全程零文件操作 |
| 提示词库 ×2 | 截图提取/画布保存的提示词进素材盒私账，正牌提示词库面板找不到 | 两套存储互不相通（IPC 主库 vs localStorage promptCards） |
| 素材盒自己也分裂 | 顶栏素材盒和浏览器素材盒各记各的账（global 桶 vs 项目桶）：**浏览器里存的提示词卡，顶栏素材盒永远看不到**，其「提示词库」tab 恒空，空态文案「从浏览器提取后会出现在这里」永不兑现＝UI 对用户撒谎 | 真机复现：同一预埋卡，托盘可见（截图 08）、顶栏浮窗不可见（截图 05） |
| 文件夹半个世界认识 | 素材盒建的文件夹素材库不认识；素材库的智能分组素材盒不认识——两套整理系统 | browserAssetLibraryStorage.ts（localStorage 私有层） |
| 工程债连坐 | 同名映射函数三份平行版（代码自标"待收敛"）；副面 5.6k 行 > 正面 2.1k 行——以后每加一个素材功能都要做两遍或再漂一次 | BrowserAssetOverlayApp.tsx:46 注释 |

**不改的长期后果**：以上每条持续存在并随功能增长恶化；且既然 07-12 修过一次又漂回来，证明**不加结构防线它还会第三次漂**。

### 3. 为什么这样改，而不是别的

**为什么收敛到素材库、而不是收敛到素材盒？**
素材库是两者中更完整的那个（双源数据、音频、AI 智能分组、真删除、跨项目视图、虚拟化）；素材盒唯一不可替代的价值只有一个＝**吸附在浏览器旁的捕捞托盘形态**（上网捞图时就地接住）。所以方向是：素材库当唯一素材面，素材盒回到出生身份只干托盘。反向收敛等于拿 5.6k 行的副面重建正面的全部能力，工程量大且没有用户收益。

**为什么不选 B（两个熔成一个组件、三处渲染）？**
用户看到的效果和 A 几乎一样，但浏览器托盘是独立透明窗（鼠标穿透轮询、跨窗口 IPC 一整套特殊机制），熔进主面板后主面板永久背上这份复杂度——花几倍工夫买对用户不可见的差别。

**为什么不选 C（两个都留、只修账）？**
治标。两套心智的困惑原样保留；且 07-12→07-19 已经证明：没有结构防线，修完还会漂回来。C 是最便宜的，也是最会重演的。

**为什么改的是这些地方、而不是别处？（分层定位）**
- **入口层**删宿主A（顶栏浮窗）：因为它就是"并行版素材库"本体（P1 违规载体），且它自己的提示词库 tab 恒空、是半残的；
- **数据层**解散 localStorage 私账：因为分裂的根源全在这层（软删标记/文件夹/提示词卡都记在这本互不相通的私账里）——只改 UI 不拆这层，分裂还在；
- **守卫层**把"顶栏无素材盒"做成五门内的单测：因为上次翻车的直接原因就是守卫在手动 lane——把检查放进每次合并必跑的路上，这类翻回才"整类不再复发"（P2）；
- **不动**浏览器托盘的窗口机制和捕捞链路：它们与本次问题无关，是托盘的本职。

**为什么素材库的家在左侧栏、顶栏不放素材库按钮？（2026-07-22 用户追问后修正）**
初版样张曾把顶栏素材盒按钮改名成「素材库」开抽屉——用户追问「为什么在上面不在左边」，追问是对的，撤回：① 左侧栏住"干活时打开的工作面板"（素材库/分组/提示词/技能），贴画布、拖拽路径最短；顶栏住"全局动作"（浏览器/模型接入/导出）——素材库是工作面板，归侧栏族；② 素材盒当年在顶栏正因它自称"跨项目全局浮窗"，那就是并行面的病灶位，换牌子等于同一面板两个门、再造一次入口重叠；③ 07-12 方案一原样就是"删掉不替换"，跨项目找素材侧栏里就有（「全部素材」tab）。**顺着这问还挖出：右侧抽屉是孤儿面**——`nomi-open-asset-library` 全仓只有监听器（NomiStudioApp.tsx:210）没有一处 dispatch（2026-07-22 实查），素材库 v1 纯抽屉时代的遗留，一并删除。最终：**素材库唯一的门＝左侧栏第一个 tab（默认选中），文件夹能力加在这里面。**

**为什么文件夹落 `.nomi/folders.json`、而不是继续 localStorage 或塞 sidecar？**
localStorage 是这次分裂的根源（按 projectId||'global' 分桶、清缓存即丢、别的面看不见），不能再用；素材 `.meta` sidecar 是"每素材一条"，装不下文件夹自身的定义/顺序/空文件夹；`.nomi/<name>.json` 有现成活先例（projectMemory 的 `.nomi/memory.json`），per-project、随项目走、迁移是 localStorage 结构的 1:1 平移——不发明新存储。

### 4. 改了哪些 → 用户看到什么 → 有什么用

| # | 改动 | 你会看到 | 好处 |
|---|---|---|---|
| A | 删顶栏/库页素材盒入口（**不替换**）；删孤儿右抽屉；守卫单测进五门 | 顶栏只剩 上手/浏览器/模型接入/导出；素材库唯一的门＝左侧栏第一个 tab（默认选中，跨项目「全部素材」tab 在里面）；素材盒只在浏览器旁出现 | 「找素材去哪」只剩一个答案（一个能力一个门）；外部 PR 再想把并行面塞回来，合并直接红 |
| B | 提示词卡并入主提示词库；提取/保存改道直存主库 | 所有提示词只有一个家；截图提取完 toast 告诉你去哪找 | 「存了找不到」消失；顶栏那个永远空的提示词库 tab 连同它的假承诺一起消失 |
| C | 文件夹转正为素材库正式能力（落盘）；旧文件夹全量迁移 | 素材库「项目素材」tab 里有文件夹瓦片，点进/返回/拖拽归属；你已建的文件夹原样还在 | 手动整理从"半个世界认识"变成全局一等公民，换机/清缓存不丢 |
| D | 托盘瘦身；删除改真删；三份平行版收敛 | 托盘=纯捕捞收件箱；在哪删都是真删（有确认弹窗） | 「删了还在」消失；一份代码一套口径，以后素材功能只做一遍 |

### 5. 拍板状态

- **已拍**（2026-07-22 用户）：方向=改回方案一并做死；文件夹=迁进素材库成正式能力。
- **待拍**：① 三张样张（用户反馈"要改"，待指出改哪里）；② 托盘裁剪清单（提示词 tab/文件夹/上传三样是否都裁）。
- **拍板后才动代码。**

---

## 第二篇：施工细节（技术讲解）

### 切片 A：入口收敛 + 唯一门守卫进五门

**删（P1 同 commit 删干净）**：`GlobalAssetFloatingWindow.tsx` 整删（唯一消费者 NomiStudioApp.tsx:110/:615）；`useGlobalBrowserAssets.ts` 整删（两导出的消费者均随入口消失，徽章不保留=07-12 原样）；死文件 `useBrowserAssetCount.ts`（全仓 0 引用）；`AssetCountBadge`（NomiAppBar.tsx:20）；`globalAssetPopoverEvents.ts` 删 GlobalAssetPopover 三件套 + 死导出 `dispatchBrowserAssetPopoverOpen`，**保留** `subscribeBrowserAssetPopoverOpen`（托盘用 useBrowserDialogActions.ts:478）与 `dispatch/subscribeBrowserAssetsImportToCanvas`（托盘→画布主链路）。

**改**：NomiAppBar.tsx:251-260 素材盒按钮**直接删不替换**（07-12 原样；理由见第一篇§3"为什么在左不在顶"）；WorkbenchShell.tsx:255-270（win32 自绘栏）同删（改哪面验哪面）；ProjectLibraryPage.tsx:166-175 直接删；NomiStudioApp.tsx:234 调用点随删。**连删孤儿右抽屉**：AssetLibraryPanel 浮层壳（AssetLibraryPanel.tsx:686-756）及 `nomi-open-asset-library` 事件+监听+挂载（NomiStudioApp.tsx:61-64/:209-210/:694-699）——全仓无 dispatcher（2026-07-22 实查），素材库 v1 纯抽屉时代遗留；**保留 `AssetLibraryContent`**（侧栏内嵌是唯一真实消费者）。

**守卫**（新增 `src/ui/browser/assetSurfaceInvariants.test.ts`，vitest 随五门 `test` 必跑）：① 宿主A两文件不存在；② 静态扫描 `aria-label="打开素材盒"` 仅允许出现在 `src/ui/browser/dialog/`；③ `dispatchGlobalAssetPopoverOpen` 全仓零引用。恢复宿主A任何一件至少一条红——这就是"这类不再复发"的结构保证。

### 切片 B：提示词卡并入主提示词库 + 迁移

主库现状（实查）：「我的库」走 IPC 主进程存储（promptLibraryApi.ts:26），现成 API `addUserPrompt({title?,prompt,promptType:'image'|'video'})`（:75）。两个字段缺口的处理：`referenceImages[]` → **additive 扩展** `UserPromptDraft`/`LibraryPrompt` 加可选同名字段，`mediaUrl` 取首图（现 UI 零改动兼容）；素材盒自定义分类 → 映射进主库现成 `tags[]`，`promptType` 归一 image|video。

改道：浏览器提取（useBrowserAssetCaptureImport.ts `extractPromptToAssetCard`）与画布两调用点（NodeGenerationComposer.tsx:12、SelectionPromptSaveController.tsx:11）的 `saveBrowserPromptCard` → `addUserPrompt` + toast 指路；素材盒「提示词库」source tab 及展示件随删。提取设置弹窗保留（挂浏览器相机流程）。

迁移：渲染层启动迁移器扫 `localStorage['nomi.browser.asset-library.v1:*']` 各桶 promptCards → `addUserPrompt`（去重键=title+prompt 哈希，幂等）；成功写 `nomi.browser.asset-library.migrated.v1:<key>` 标记，**原桶不删**（回滚后旧版本读旧数据无损）。

### 切片 C：文件夹转正进素材库 + 迁移

落点：per-project `.nomi/folders.json`，照 projectMemory.ts 范式建 `electron/assets/assetFolders.ts` + IPC `desktop.assets.folders.{get,save}`。Shape：`{version:1, folders:[{id,label,order}], assignments:{<asset relativePath>:<folderId>}}`（归属键=relativePath，与删除/列表同口径；localStorage 旧键 browserAssetStorageKey 迁移时解析映射，映射不上归"未分类"+计数 warn）。

素材库 UI（样张拍板后做）：「项目素材」tab 网格前置文件夹瓦片（点进/面包屑返回/拖素材归属/工具行新建）。「全部素材」「智能分组」不动。托盘文件夹 UI 删（整理归素材库）。

迁移：各项目桶 folders+assignments → 对应项目 `.nomi/folders.json`（同 id 跳过，幂等）；'global' 桶可归属项目的归入、归属不了的丢弃并记数（诚实标注：顶栏浮窗建夹场景极少）。

### 切片 D：托盘瘦身 + 删除统一 + 平行版收敛

软删层（deletedAssetKeys）读写全删，已软删素材重现属预期（文件本就没删、素材库一直可见）；托盘删除改真删（workspace.deleteFiles → 回收站 + 确认弹窗，口径同 AssetLibraryPanel.tsx:394）；托盘上传按钮删（待拍板确认）；`browserAssetFromDesktopAsset` 三份收敛到 browserAssetPopoverUtils.ts:193 单份；托盘保留：搜索/图视频筛选/多选框选/拖上画布/送画布/捕捞开关/提取提示词（指主库）。

### 不动项

托盘 overlay 原生窗机制（透明窗/穿透轮询/setShape/dock）；捕捞链路（context-menu、importMedia 防盗链、权限双拒、originalUrl 恒 null 隐私不变量）；`nomi:assets:updated` 写入层回流；素材库三 tab 结构与双源 selector；主提示词库面板形态。

### 顺序 / 走查随动 / 回滚

顺序 A（先钉门）→B→C→D，每片独立 commit 五门过再下一片。走查随动：reference-capture.walk.mjs 素材盒浮窗交互步改指托盘、:208 唯一门断言由红转绿；browser-overlay-interaction.walk.mjs 以宿主A为对象的步骤重写指向托盘或废弃（实现时读脚本定，几何对账思想保留）。回滚：切片粒度 revert；迁移不删原桶只加标记，`.nomi/folders.json` 不影响旧版读项目。

### 验收门

① 五门全绿+守卫 3 断言绿；② R13 真机：捕捞→托盘→拖画布→素材库回流；提取→主库可见；预埋旧 localStorage 升级启动→文件夹/提示词卡现身新家、软删素材可见；顶栏无任何素材入口（唯一门=侧栏素材库 tab）；③ 唯一门断言复绿；④ 截图逐张亲眼 Read（win 自绘栏分支另验）；⑤ 迁移幂等（连续两次启动无重复）。
