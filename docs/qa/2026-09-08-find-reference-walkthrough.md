# 「找参考」真机走查报告

> 状态：📎 走查记录（2026-09-08 · 真 TikHub key · 真 Electron · 跑了 2 次结果一致）

脚本：`tests/ux/find-reference.walk.mjs` · 截图与轨迹：`tests/ux/shots/find-reference/`
被测：PR #619 的 find-reference 功能 · 设计：[`../design/2026-09-07-find-reference-design.md`](../design/2026-09-07-find-reference-design.md)

**刻意打真接口**（不是 fixture）：这条线的价值全在真实数据上——fixture 只能证明界面在，
证明不了「搜出来的东西对不对、看不看得懂」。缺 `TIKHUB_API_KEY` 时脚本明确跳过，不假绿。

---

## 走通了的（有截图 + DOM 证据）

| 环节 | 证据 |
|---|---|
| 空态 CTA 出现 | `[data-find-reference-cta]` 数量 = 1；文案「拖文件进来，或看看 **抖音** 同类目正在跑的片子长什么样」——平台名插值生效 |
| 面板展开 | 三个平台 chip `["抖音","小红书","TikTok"]`，默认「抖音」 |
| 真实检索 | 关键词「护肤精华」→ **7 条真实抖音结果** |
| 角标语义正确 | `♥ 74.1万` 主角标 + `收藏 18.4万` 副行 —— 抖音那套指标 |
| 封面质量 | 真实抖音封面，带大字标题（「好物推荐」「618购物清单」「穷鬼测评好物」「13款精华评测结果」）——正是挑片子要看的 |
| 加入素材库 | toast「已加入素材库」→ 按钮变「已加入素材库」→ 落库 `douyin-ref-7103431378309532942.mp4`，`usageStatus: reference_only`，`platform: douyin` |
| 稳定性 | 同一脚本跑 2 次，结果逐项一致；控制台零错误 |

---

## 抓到的问题

### 🔴 P0-1 素材库是「一大片」，我按「空的」设计了（用户 2026-09-08 当场指出）

走查用的是**空项目**，所以「面板展开」看着很自然。**真实用户进来是一整片已有素材**，那时：
- 面板插在工具栏与网格之间、把网格往下推 → **上下文全丢**
- 点完「已加入素材库」后**看不到刚加的那条去哪了**（面板占满了素材库区域）

**这是卡点表的漏洞**：卡点① 我只想了「空态怎么发现」，没想「非空态怎么共存」。
**空态是特例，一大片才是常态。**

现有可复用的三层筛选（已实读）：
- 来源 tab `全部素材 | 项目素材`（`AssetLibrarySourceFilter = 'all' | 'project'`，`assetLibraryUsage.ts:5`）
- 分类漏斗 `全部/图片/视频/音频/3D`（`assetLibraryPanelFilters.ts`）
- 名字搜索

**筛「参考素材」的数据本来就在**：落库素材带 `connectorId: 'tikhub'` / `platform` / `usageStatus: 'reference_only'`（走查实测）。

拟修（待拍板）：
- **A 切换**：不加第三个 tab（现有两个 tab 是**范围**维度，混进「参考」= 两套心智，违 §1.5 pattern 2）。
  改成面板**接管网格区**、顶上一条「← 回到我的素材（N）」。切换成本 1 次点击，上下文不丢。
- **B 筛选**：进现有漏斗加一组「来源」：全部 / 我上传的 / 生成的 / 参考素材。**不加新控件**，常驻数不变。

### 🔴 P0-2 切平台后结果不换

截图 `11-platform-switched.png`：TikTok chip 已高亮，**下方仍是抖音的结果**——
副行还写着「收藏 18.4万」，而**收藏是抖音/小红书的指标，TikTok 广告库根本没有**。
用户会以为这些就是 TikTok 上的片子。连带**筛选维度与转译回显也没出现**（它们本该随平台 derive）。

根因：`onPlatformChange` 只改了 state，没有清空 `result`，也没有重搜。
**「平台变了、结果没变」违反了这个功能自己的核心主张**（证据格按平台 derive）。

### 🟡 P1-1 首屏 4/7 封面是空白

DOM 探针（不是肉眼猜的）：
- 结果刚出来：`{total:7, drawn:2~3, failed:0, pending:4~5}`
- 再等 6 秒：`{total:7, drawn:7, failed:0, pending:0}`

**不是挂，是慢。** 但用户第一眼看到的是一片灰。缺骨架屏 / 占位。

### 🟡 P1-2 结果里长视频占多数，与任务卡不符

实测时长：`4:43 / 5:58 / 4:55 / 1:42 / 1:51 / 1:03 / 3:23`。
`sort_type=1`（最多点赞）拿到的是**长视频**。任务卡说的是「找几条能照着拍的短片子」，
4-6 分钟的合集参考价值低。可考虑默认加时长偏好，或在结果上让时长更醒目。

### 🟡 P1-3 caption 噪声大

原样透传抖音 `desc`：「妮儿的推荐也忒er好辣~ @DOU+小助手 #好物推荐 #主播请就位 #美…」
全是 @ 和 #，用户扫不到有用信息。可考虑剥掉 @ 与话题标签再截断。

---

## 我自己在走查里犯的两个错（都是「猜」）

| 错 | 后果 | 教训 |
|---|---|---|
| **toast 选择器是猜的**：用了 `[data-toast], [role=status]`，真实是 `.mantine-Notification-root` | 「什么都没抓到」被误读成「什么都没发生」，白追两轮，还一度错误推断 `projectId` 为 null | 锚点必须实查——`grep tests/ux/*.walk.mjs` 一下就看到别人怎么写的 |
| **改了渲染层代码没重新 build 就走查** | 跑的是旧构建，`data-ref-id` 拿不到才发现 | 走查前先 `npm run build`；同族教训 [[mcp-fixes-need-repackaged-app]] |

**这两个错的性质，跟我这一整轮在批评的完全一样**：拿一个没验证过的锚点当判据。

---

## 顺带修掉的（走查触发的）

`FindReferencePanel` 的「加入素材库」原本是 `if (!projectId) return` **静默早退**——
点了什么都不发生、无 toast、无错误、按钮文案不变，用户唯一能得到的结论是「这软件坏了」。
按 §1.6 C1 改成 **disabled + 外层 `span title` 说清为什么**，并加 `data-ref-id` 便于走查定位。

⚠️ 注意：`check:controls` 这道门岗**没抓到**这个 C1 违规（它跑绿了）。门岗判据是
「守卫的那个变量被当参数传给了动作」，而我这里守卫的 `projectId` 是**闭包变量**不是入参——
**这是门岗的一个洞，值得单独跟进**。


---

## 走查之后改了什么（2026-09-08 当轮）

| 问题 | 处置 | 走查复验 |
|---|---|---|
| **P0-1 面板把一整片素材推走** | 面板**接管**素材区（新文件 `FindReferenceSection.tsx`），顶上一条「← 回到我的素材（N）」 | 返回条存在、文案「回到我的素材（1）」计数正确；点了面板消失、**刚加的那条就在网格里**（截图 `12-back-to-library.png`） |
| **P0-2 切平台后结果不换** | `onPlatformChange` 前清 `result` 与 `addedIds` | 切到 TikTok 后**卡片数 = 0**、文案**不再含「收藏」** |
| 加入按钮静默早退（§1.6 C1） | 改为 disabled + 外层 `span title`；加 `data-ref-id` 便于走查定位 | `check:controls` 通过 |
| 平台 chip 的 `if (id === platform) return` 也是同一类静默守卫 | 当前平台那颗直接 `disabled` + title「已经在看这个平台了」——点当前平台若走进清空逻辑还会白白清掉用户的结果 | `check:controls` 通过 |
| 拆分后 `AssetLibraryPanel.tsx` 801 行超限 | 抽出 `FindReferenceSection.tsx` → 787 行 | `check:filesize` 通过 |

### ✅ B「按来源筛选」已在同日补做（下面这一节保留当时的判断，作为自纠记录）

**当时的判断**：需要新拉一条 provenance 管线（sidecar → `WorkspaceFileNode` → `AssetRef`），是独立改动。
**被什么推翻**：这条管线根本不必存在。来源在**落盘那一刻**就已经是结构事实——
`assetBucketFromMeta`（`electron/assets/assetPaths.ts:80`）按 `meta.kind` 决定素材进 `assets/<bucket>/`，
目录遍历天然带着它。只要给「找参考」的两条外部导入路径（搜索导入 + 贴分享链接）一个自己的桶 `reference`，
`AssetRef.origin.relativePath` 的前缀就是答案，渲染层一个纯函数就能判（`src/workbench/assets/assetProvenance.ts`）。
**来源**：自查——为了给用户讲实现方案而重读 `projectAssetStore.ts:681`，
发现 `assets.list` 早就在读 sidecar，说明「事实缺失」是假的，缺的只是**让事实自己说话的结构**（R28）。
**后果**：从「一条新管线 + 每个节点多读一次 sidecar」缩成「一个新桶 + 一个纯函数」。
历史资产不迁移、id 不变、默认全选，老用户看到的集合逐条不变。

**真机复验（带真 TIKHUB_API_KEY，`node tests/ux/find-reference.walk.mjs`，退出码 0）**：
- 落库路径 `assets/reference/2026-09-07/douyin-ref-7103431378309532942.mp4`（走查断言，落错桶即红）
- 返回条文案「看看刚拿的 1 条」；点完漏斗按钮写着「找来的参考」
- 来源轴实测 `["我的素材0", "找来的参考1"]`，网格里只剩那一条（截图 `13-provenance-filter.png`）
- 走查途中抓到并当场修掉的一条：**窄栏（compact）下漏斗只有图标没有文字**——
  从「找参考」回来落在「只看参考」上时，屏幕上只剩 1 条素材而**没有任何一个字说明原因**，
  看起来就像素材丢了。改成「平时只图标、正在筛就把筛的是什么写出来」（`AssetLibraryToolbar.tsx`）。
  这条只有真机看得见：设计实验室和单测都不会把左侧栏渲染成 compact。
- 我自己在走查里又栽了两次「猜名字」：漏斗 aria-label 猜成「素材分类筛选」（真值是「筛选素材分类」），
  落盘字段猜成 `data.projectRelativePath`（真值是 `data.relativePath`，前者是 MCP 投影里的名字）。
  两次都是断言报红拦下来的——这正是把观察写成断言的价值。

落地形状：
- **落盘**：`kind: "reference"` → `assets/reference/<日期>/`（`AssetBucket` 三值，`assetPaths.test.ts` 新增 2 条断言）
- **筛选**：来源轴并进**既有漏斗**，不新增常驻控件（§1.5 硬规则 2）；最后一项取消不掉（否则空列表+看不见原因）
- **闭环**：拿过东西再点返回条，直接落在「只看参考」上，返回条也改口成「看看刚拿的 N 条」——
  否则刚拿的三条会淹进一整片旧素材里，等于让用户自己再找一遍
- **兜底**：筛空了的空态给一颗「显示全部素材」（卡点③）
- 结构合同：`docs/fixes/2026-09-08-asset-provenance-bucket.root-cause.json`

---

### ⚠️（历史判断，已被上面推翻）B「按来源筛选」本轮**没做**，理由要记下来

原计划在漏斗里加一组「来源：我上传的 / 生成的 / 参考素材」。动手后发现**做不了**，而且是两个硬事实：

1. **渲染层的 `AssetRef` 不带来源信息**——它由**文件树节点**构建（`assetTypes.ts:182 workspaceNodeToAssetRef`），
   而 `sourceEvidence`（`connectorId`/`platform`/`usageStatus`）只在素材库 sidecar 里，走 `assets.list` 这条 IPC 才拿得到。
2. **落盘桶分不出来**：`projectAssetStore.ts:208` 的 bucket 只有 `generated | imported`，
   **用户上传的和找参考拿进来的都进 `imported`**，靠路径区分不了。

所以完整的 B 需要**新拉一条 provenance 管线**（主进程投影 → `AssetRef` → 面板），是独立改动，不塞进本轮。

**已撤除的半成品**：我一度写了 `assetOriginOf()` 读 `asset.data.sourceEvidence`——那个字段在 `AssetRef` 上**根本不存在**；
而且我给新类型起名 `AssetOrigin`，与 `assetTypes.ts:28` 已有的 `AssetOrigin`（`{source:'canvas'|'project'}` = 素材住在哪）**同名两义**，
违 R14.1 单一语义 owner。两者都已 revert，没有留在代码里。
