# 0.25「已合入待验证」22 个 PR 今日 `main` 真窗口复核报告（任务 C-1）

> **构建基准**：`origin/main` = `35d9ce445`（本工作树单次 `pnpm run build` 新鲜生产构建，Electron `43.4.1`）  
> **测试环境**：macOS 屏外安静真窗口（`UIElement`，前台抽样全程 0 次抢焦点）、全隔离临时资料目录、合成钥匙串、`NOMI_TEST_NETWORK_GUARD=1` + 本机 `127.0.0.1` 回环替身、零真实付费、零业务代码改动  
> **证据规模**：52 张中/英真实窗口 PNG 截图（全部已逐张目视核对，无白屏、无断图、无乱码、渲染层 `pageerror = 0`）

## 1. 一句话结论

【已核实】22 个已合入 `main`（`35d9ce445`）的创作者可见 PR 在今日同一套生产构建的真实桌面窗口上 **过 22 个、不过 0 个**：所有功能合在一起无互相冲突或核心回归，中英两轨可见状态、交互读数与真实落盘/导出闭环均成立（同时如实记录 3 处不影响通过的细微差异与本轮实测边界）。

---

## 2. 22 个 PR 逐行总表

| PR | 照哪条判据 | 过 / 不过 | 截图文件名（zh / en） | 和 PR 说法差在哪 |
|---|---|---|---|---|
| `#1548` | 对话内一行一个镜头行（无行尾状态图标）、输入框上方仅留 `V4SpendBar`（共同参数行 + `32px` md 按钮；英文主按钮无名词 `Generate 3`）、悬停点亮画布节点、点击走画布单节点提交 | 过 | `1548-spend-split-zh.png` / `1548-spend-split-en.png` | 无实质差异；本轮按 3 镜快草稿实测（未额外构造 >4 镜折叠态与分镜镜号胶囊行） |
| `#1624` | 发送键旁紧凑积分胶囊（`1.95` 无多余 `约/~`）、单位菜单单标题+右侧蓝勾+自然宽（`130.6px` / `129.2px`）、切人民币/美元紧凑胶囊（`≈¥1.31` / `≈$0.195`）、余额不足同排警示色缺额 + `去充值 / Top up` | 过 | `1624-unit-menu-zh.png` / `1624-unit-menu-en.png`、`1624-low-balance-zh.png` / `1624-low-balance-en.png` | 无差异；本轮以余额 `14.0` 对照 `14.63`（差 `0.63` 积分）在同一窗口完成全态实测，单位菜单实测宽与 PR 所报像素一致 |
| `#1687` | 画布视频节点选 APIMart `Seedance 2.5` 文生视频在发送键旁稳定亮出约价（`13.5`），切回 `Seedance 2.0` 仍正常亮价（`1.95`），且仅发只读 `GET` 价目查询（非 GET = `0`） | 过 | `1687-seedance25-zh.png` / `1687-seedance25-en.png` | 无差异 |
| `#1612` | 视频节点点「提取深度」后源视频保持选中且浮条/生成框常开、派生深度卡不抢选中不挂云端生成框；权重下载准备期再次点击被互斥锁当场拦截提示且不建第 2 张卡、不发起第 2 次下载 | 过 | `1612-depth-no-steal-zh.png` / `1612-depth-no-steal-en.png` | 无差异；以本机回环挂起权重响应模拟 49.6MB 下载期，完整复现单项目互斥与不抢选中 |
| `#1616` | 多版本图片卡悬停上移跨越 `6px` 间隙进入 `VersionCardBar` 不闪退；两卡 `80px` 净距下选中左卡时右侧磁吸把手命中带收窄至 `66px`（`80 - 14`）不侵入邻卡 | 过 | `1616-hover-magnetic-zh.png` / `1616-hover-magnetic-en.png` | 无差异 |
| `#1621` | 可灵 `4.0 Flash` 连入源视频时，全能参考保持 `16:9 · 5s`，切到「视频编辑 / Video editing」方式自动清除机器铺的 `16:9`、比例摘要切回「自动 / Auto」且面板「自动」瓷砖选中 | 过 | `1621-kling-edit-auto-zh.png` / `1621-kling-edit-auto-en.png` | 无差异 |
| `#1625` | `1280×800` 空画布新建图片（`340×340`）与视频（`420×236`）出生即定形、顶标签+节点+底栏最下行按钮+底部加节点条四件全露且 `elementFromPoint` 命中、视口零平移（`0,0,zoom=1`） | 过 | `1625-born-shape-zh.png` / `1625-born-shape-en.png` | 无差异 |
| `#1654` | 画布 Immer 补丁撤销/重做单手势 1 步还原位置；经假 APIMart 真实落盘的付费图片产物在 `⌘Z` / `⌘⇧Z` 往返后保持 `status=success` 绝不回退 | 过 | `1654-canvas-undo-zh.png` / `1654-canvas-undo-en.png` | 无差异 |
| `#1668` | 首进自动取景上限 `zoom <= 1`（`100%` 非 `188%`）；已出图图片浮条首位为「生成视频 / Video」，点击免扣费派生连线视频节点、自动对齐首帧 `1:1` 比例、无假等待文案、无重复标题 | 过 | `1668-ux1-canvas-zh.png` / `1668-ux1-canvas-en.png` | 英文浮条首位按钮文案实际为短词 `Video`（图标+词，中文为 `生成视频`），语义与交互一致 |
| `#1685` | 选中节点生成框贴近底部加节点条时，点「+」展开空间菜单走 `AnchoredPopover` Portal 落在 `dock` 之外不被 `clip-path` 裁切，4/4 项 `elementFromPoint` 全命中、点「3D 模型」建卡成功、切列表视图自动收起 | 过 | `1685-more-menu-zh.png` / `1685-more-menu-en.png` | 无差异 |
| `#1623` | Agent 输入框键入 `/` 弹出 3 分类（`全部/技能/提示词` · `All/Skills/Prompts`）、搜索占位与分组头合规、行内无 `/id` `<code>`、`ArrowDown+Enter` 挂技能芯片（`IconBooks`）、提示词挂芯片（`IconBulb`）、`@` 互不冲突、节点预设 4 分类 | 过 | `1623-slash-picker-zh.png` / `1623-slash-picker-en.png` | 细节提示：英文态下 `Prompts · Expressions` 分组头已英文化，但内置表情包单条预设内容名仍为中文（如 `喜悦 1/5 · 一丝笑意`），属内置素材数据包现状，非弹层与芯片逻辑回归 |
| `#1630` | 真实经 `production.verify-shots` 触发审片且回环裁判返回不可解析文本时，跨进程回传诚实 `status=unverified`、`passed=false`、`unverifiedReason=invalid_verdict_json`，对账卡隐藏「AI 修复」、默认折叠原因、展开显示白话原因 | 过 | `1630-1659-qa-card-zh.png` / `1630-1659-qa-card-en.png` | 无实质差异；本轮真窗重点实测画布 Agent 对账卡与真实 IPC 三态回执，未单独再开任务中心 `ProductionDetails` 审片详情行 |
| `#1659` | 单镜未校验对账卡行内按钮统一收口为短词条 `重审 / 照用`（英文 `Re-check / Use`），替代旧 `重新审片 / 照用此镜`（`Re-check / Use shot`），点击「照用 / Use」立即收起卡片 | 过 | `1630-1659-qa-card-zh.png` / `1630-1659-qa-card-en.png` | 无差异 |
| `#1628` | 文稿侧栏行右键唤起唯一 `WorkbenchContextMenu`（Radix 内核），触发行标记 `data-state="open"`、项序/禁用态与分隔线正常、按 `Esc` 仅收起菜单 | 过 | `1628-context-menus-zh.png` / `1628-context-menus-en.png` | 本轮真窗抽检 `DocumentListSidebar` 迁移入口（`CategoryTree` 与导演台时间轴右键已在原 PR 真 Chromium 浏览器单测覆盖） |
| `#1657` | 已迁入 `@floating-ui/react`（`useFloatingOutsideDismiss`）的画布浮层在展开态点击画布空白舞台（捕获期 `pointerdown` 先于 React Flow `d3-zoom`）立即干净收起 | 过 | `1657-floating-dismiss-zh.png` / `1657-floating-dismiss-en.png` | 无差异 |
| `#1667` | 新建分镜表 0 张参考卡时隐藏「全部展开」、直出「+ 添加参考」，点完立即新建展开并聚焦名称框；「+ 添加镜头」常驻固定底栏，连加至 4 镜仍全程免滚屏可达 | 过 | `1667-storyboard-zh.png` / `1667-storyboard-en.png` | 无差异 |
| `#1650` | 删除 13 秒全屏开屏动画与「关于」页重看钮；0 项目 + 0 可用模型库首屏展示主卡，点「连接模型」进入整窗 `ApimartConnectPage`（面包屑 + 宽屏拼贴 + 密码框 + `Esc` 返回）；有项目后主卡消失 | 过 | `1650-hero-zh.png` / `1650-hero-en.png`、`1650-connect-page-zh.png` / `1650-connect-page-en.png` | 无差异 |
| `#1653` | 全新空库下 `dreamina` / `volcengine-speech` 默认 `enabled=false`；有项目未连模型时库顶栏现单段提示条、画布生成框现「未连模型 / 连接模型」、Agent 面板现指路卡且零内联密码框 | 过 | `1653-canvas-agent-zh.png` / `1653-canvas-agent-en.png`、`1653-library-banner-zh.png` / `1653-library-banner-en.png` | 无差异 |
| `#1660` | 整窗接入页格式错误本地拦（0 出站）、401 错 Key 原位报错；0 余额展示 `O5` 充值卡且隐藏后回窗自动复查 `/v1/balance` + `/v1/user/balance` 转绿返回；正余额 4 项全绿自动回画布并保留原草稿 + `已连接 APIMart · 余额 52.3 积分` 绿提示 | 过 | `1660-check-topup-zh.png` / `1660-check-topup-en.png`、`1660-connected-zh.png` / `1660-connected-en.png` | 无差异 |
| `#1651` | 预览时间轴经统一 `dispatchHistoryShortcut` + `zundo` 响应 `⌘Z` / `⌘⇧Z` 单步撤回与重做片段入轨，零双撤竞争与控制台报错 | 过 | `1651-preview-undo-zh.png` / `1651-preview-undo-en.png` | 本轮实测「入轨 → `⌘Z` 撤空 → `⌘⇧Z` 恢复」单步闭环；未在同窗额外叠加拖拽分隔条布局历史优先测试 |
| `#1666` | 根样式 6 档动效变量（`0 / 110 / 150 / 220 / 360 / 550ms`）与退场镜像（`100 / 150 / 240ms`）到位，按压缩放 `active:scale-[0.97]` 仅挂文字/发送按钮（图标条 = `0`），`prefers-reduced-motion: reduce` 下全部时长坍缩为 `0ms` | 过 | `1666-motion-tokens-zh.png` / `1666-motion-tokens-en.png` | 无差异（`morph-exit` 的 `370ms` 按设计由 TS `exitDurationMs(550)` 供应，CSS 仅镜像 `fast/normal/spatial-exit`） |
| `#1670` | 空时间轴顶栏「导出 MP4」原生 `disabled` 且无重复原生 `title`、收起左栏横排显示 `片库 / Clips`（`32px` 宽 `horizontal-tb`）、导入 `360×640` 竖屏视频入轨自动对齐 `9:16` 舞台、真实本地 FFmpeg 导出 `1080×1920`（`9:16`）MP4 并弹应用内 `打开文件夹 / Show file` Toast 不抢焦点 | 过 | `1670-preview-empty-zh.png` / `1670-preview-empty-en.png`、`1670-preview-916-export-zh.png` / `1670-preview-916-export-en.png` | 无差异 |

---

## 3. 分组核验明细与真窗实测读数

### 3.1 发送和花钱（`#1548`、`#1624`、`#1687`）
- 【已核实】**`#1687`**：在 `1260×840` 隔离窗口连接回环假 APIMart（仅放行只读 `GET /api/pricing/model` 与 `/v1/user/balance`，非 GET 一律 `405`）。视频节点选择 `Seedance 2.5` 后发送键旁胶囊稳定读回 `13.5`（中/英一致），切回 `Seedance 2.0` 读回 `1.95`，全程非 GET 请求数 = `0`，渲染层 `pageerror = 0`。
- 【已核实】**`#1624`**：点击 `1.95` 胶囊展开单位菜单，实测宽 **`130.6px`（zh）/ `129.2px`（en）**，单标题 `预计` / `Estimated`（`headingCount = 1`），三行纯净尾值 `["1.95", "¥1.31", "$0.195"]`，选中行右侧蓝勾无左侧死白；切换人民币/美元后胶囊读回 `≈¥1.31` / `≈$0.195`；在假余额 `14.0` 积分下将 `Seedance 2.0` 调至 `1080p · 15s`（`14.63` 积分），同排立即切出低余额态 `还差 0.63 积分 去充值`（zh）/ `Short 0.63 credits Top up`（en），目视浅色下对比度清晰。
- 【已核实】**`#1548`**：经回环 Agent 运行时起草 3 段 `Seedance 2.0` 视频镜头。确认条 `titleOnBar = null`、`pointersOnBar = 0`、`editorsOnBar = 0`，对话内展示 3 条镜头行（`pointersInChat = 3`，无行尾 ✓/转圈/⚠）；共同参数行 `Seedance 2.0（Nomi 选的）· 16:9 · 720p · 每段 5s` / `Seedance 2.0 (Nomi's pick) · 16:9 · 720p · 5s each`；主按钮文案中文 `生成 3 段`、英文 `Generate 3`（无多余名词），取消/主按钮实测高度均为 `32px`；悬停第 1 行画布对应节点同步进入 `hover` 高亮，点击确认后 3 笔视频请求落达回环服务端、确认条自动收起。

### 3.2 画布（`#1612`、`#1616`、`#1621`、`#1625`、`#1654`、`#1668`、`#1685`）
- 【已核实】**`#1625`**：`1280×800` 空画布新建图片节点实测 `340×340`（`labelTop = 76px`，底栏最下行 `7/7` 按钮 `elementFromPoint` 全命中），新建视频节点实测 `420×236`（`labelTop = 180px`，底栏最下行按钮全命中），新建前后视口保持 `{ x: 0, y: 0, zoom: 1 }` 零平移（中/英一致）。
- 【已核实】**`#1685`**：选中视频节点后点底部加节点条「+」，空间菜单（`导演台 / 3D 模型 / 全景图 / 画板` · `Director / 3D model / Panorama / Whiteboard`）通过 `AnchoredPopover` 渲染在 `dock` 之外（`inPortalOutsideDock = true`），4 项 `elementFromPoint` 命中 `4/4`；切到列表视图后菜单自动卸载收起（`autoClosedInListView = true`）；重开点击「3D 模型 / 3D model」成功新建节点（中/英一致）。
- 【已核实】**`#1654`**：通过回环假 APIMart 在画布生成一张真实图片产物（`status = success`），拖拽平移 `108px` 后按 `⌘Z` 位置 1 步精确归位（`undoRestoredX = true`），且已落盘付费产物状态保持 `success` 不丢失；再按 `⌘⇧Z` 位置恢复（`redoRestoredX = true`），产物仍为 `success`（中/英一致）。
- 【已核实】**`#1616`**：2 版本图片卡展开宫格后悬停第 2 张卡并分步平滑穿越 `6px` 间隙移入 `VersionCardBar`（`设为主图 / 下载 / 删除` · `Make primary / Download / Delete`），动作条稳定不闪退（`versionBarSurvivedGap = true`）；相邻 `80px` 间距的双卡中选中左卡时，右侧磁吸把手命中带实测宽 `66px`（`80 - 14`），紧邻右卡左侧边缘 `elementFromPoint` 仍归属邻卡本体（`neighborLeftEdgeBelongsToNeighbor = true`，中/英一致）。
- 【已核实】**`#1668`**：多节点项目首进画布自动取景 `zoom = 1`（`zoomCappedAtMost1 = true`）；已出图图片节点浮条首位展示 `生成视频` / `Video`，点击后免费派生连线视频节点，自动继承上游首帧 `1:1` 比例（`1:1 · 720p · 5s`）、无「等上游产出后继续」假等待提示（`hasFakeWaiting = false`）、标题纯净为 `视频` / `Video` 无跨语种重复（`hasDupTitle = false`）。
- 【已核实】**`#1621`**：源视频连入目标视频节点并选 `可灵 4.0 Flash / Kling 4.0 Flash`：在「全能参考 / Omni reference」方式下参数摘要保持 `16:9 · 5s`（守住反例边界）；切换为「视频编辑 / Video editing」后参数摘要自动清回 `自动` / `Auto`，展开比例浮层确认 `自动 / Auto` 瓷砖处于选中态（`aria-checked="true"`，中/英一致）。
- 【已核实】**`#1612`**：将权重下载端点重定向至本机挂起回环服务模拟 49.6MB 下载期。选中源视频点击「提取深度 / Extract depth」后新建派生深度卡显示 `下载模型 47 MB... 0%` / `Downloading model 47 MB... 0%`，源视频保持选中（`srcStillSelected = true`）且浮条与生成框常开（`composerStillVisible = true`）；下载期再次点击「提取深度 / Extract depth」，源视频下方立现互斥提示「这个项目已经有一个深度任务在跑。等它结束或先取消它。」/「This project already has a depth run going. Wait for it or cancel it first.」，画布节点数保持 `6` 不增且每轮仅发起 `1` 次权重请求。

### 3.3 Agent 与审片（`#1623`、`#1630`、`#1659`）
- 【已核实】**`#1623`**：Agent 输入框输入 `/` 弹出技能/提示词弹层，搜索占位为 `搜索技能和提示词` / `Search skills and prompts`，分类严格 3 项 `["全部", "技能", "提示词"]` / `["All", "Skills", "Prompts"]`，底栏 `去 Skill 库` / `Skill library`，行内内部 `/id` `<code>` 数 = `0`；输入过滤后 `ArrowDown + Enter` 成功挂上技能芯片（`[data-v4-chip-icon="skill"]`），展开提示词分组点选成功挂上提示词芯片（`[data-v4-chip-icon="prompt"]`）；输入 `@` 时 `/` 弹层数为 `0`；画布图片节点「提示词预设」弹层分类读回 4 项 `["All", "Mine", "Built-in", "Public"]`。
- 【已核实】**`#1630` & `#1659`**：真实生成 1 张画布镜头后，经主进程→渲染层真实通道 `nomi:capability:apply`（`production.verify-shots`）调用回环审片裁判并返回非 JSON 文本，通道原样回传 `verdicts: [{ status: "unverified", passed: false, unverifiedReason: "invalid_verdict_json" }]`。画布 Agent 对账卡中文显示 `1 镜没审成，不代表已通过 查看原因`、默认折叠原因（`reasonCollapsedBefore = 0`）、展开白话原因 `审片模型的回答读不出来`、隐藏「AI 修复」（`aiFixCount = 0`）、行内短按钮严格为 **`重审` / `照用`**；切英文显示 `1 shot not checked, not confirmed as passing Why`、行内短按钮严格为 **`Re-check` / `Use`**，点击 `Use` 后卡片干净收起。

### 3.4 菜单、浮层与分镜（`#1628`、`#1657`、`#1667`）
- 【已核实】**`#1628`**：在创作页展开「文稿 / Docs」抽屉，右键点击原稿行弹出唯一 Radix `WorkbenchContextMenu`（`triggerState = "open"`），项序为 `["重命名", "删除原稿"]` / `["Rename", "Delete draft"]`（末项正确禁用并带分隔线），按 `Esc` 立即关闭菜单（`closedOnEsc = true`）。
- 【已核实】**`#1657`**：在画布展开浮层后点击空白画布舞台（经过 React Flow `d3-zoom` 区域），捕获期 `pointerdown` 立即将浮层收起（`dismissedOnCanvasClick = true`，中/英一致）。
- 【已核实】**`#1667`**：打开空白分镜表，0 参考卡时 `data-storyboard-anchors-expanded="false"`、「全部展开 / Expand all」按钮数为 `0`、直接呈现「+ 添加参考 / Add Reference」；点击后新建首张参考卡并自动聚焦名称输入框（`anchorFocusedAfterAdd = true`）；「+ 添加镜头 / Add shot」常驻固定底栏，连加至 4 镜后依旧清晰固定可见、无滚动遮挡。

### 3.5 接入引导（`#1650`、`#1653`、`#1660`）
- 【已核实】**`#1650`**：空库首启无 13 秒开屏遮罩（`splashCount = 0`），「设置 › 关于」无重看开屏按钮；0 项目 + 0 模型库首屏呈现主卡（`连接模型` / `Connect`），「新建空白项目」降级为普通卡；点入整窗 `ApimartConnectPage` 呈现宽屏拼贴（`layoutAttr = "wide"`）、面包屑 `项目库 连接 APIMart` / `Projects Connect APIMart`、密码框（`type="password"`）与剪贴板粘贴钮，按 `Esc` 返回原处；建项目后主卡出现次数归 `0`。
- 【已核实】**`#1653`**：核对全新空目录落盘 `model-catalog.json`，`dreamina.enabled = false`、`volcengine-speech.enabled = false`；1 项目 + 0 模型回到项目库顶栏展示单段提示条「还没连模型...」/「No model connected yet...」；画布图片节点底栏左显 `未连模型` / `No model`、右显 `连接模型` / `Connect`；Agent 面板展示 Nomi 身份行与「连接 APIMart / Connect APIMart」指路卡，聊天区内联密码框数 = `0`。
- 【已核实】**`#1660`**：在整窗接入页输入非法网址，本地直接报 `format` 错且出站请求数为 `0`；输入 `401` 错 Key 原位报 `invalid`；在独立真实可见性会话输入 0 余额 Key 弹出 `O5` 充值提示卡（第 2 行 `0 积分 / 0 credits`），模拟切出浏览器充值后切回窗口自动复查 `["/v1/balance", "/v1/user/balance"]` 转绿并自动关页返回；从画布带草稿进入输入正余额 Key，4 项全绿后自动回画布，原提示词草稿（`一只橘猫坐在窗台上晒太阳` / `An orange cat sitting by the window`）100% 保留，Composer 上方现 `已连接 APIMart · 余额 52.3 积分` / `Connected to APIMart · Balance 52.3 credits`。

### 3.6 撤销、动效与预览导出（`#1651`、`#1666`、`#1670`）
- 【已核实】**`#1651`**：预览页将竖屏素材点入时间轴后按 `⌘Z` 一次撤空（`0` 段，顶栏导出自动同步禁用），再按 `⌘⇧Z` 一次恢复（`1` 段，顶栏导出恢复可用），全程 `pageerror = 0`（中/英一致）。
- 【已核实】**`#1666`**：在真实窗口读回 `:root` 计算样式：`--nomi-duration-instant: 0ms`、`micro: 110ms`、`fast: 150ms`、`normal: 220ms`、`spatial: 360ms`、`morph: 550ms`、`fast-exit: 100ms`、`normal-exit: 150ms`、`spatial-exit: 240ms`；文字/发送按钮挂载按压微缩类（`16` 处），画布加节点条与左栏图标按钮挂载数 = `0`；切换 `prefers-reduced-motion: reduce` 后全部 5 档非零时长均坍缩为 `0ms`（中/英一致）。
- 【已核实】**`#1670`**：空时间轴下顶栏「导出 MP4 / Export MP4」原生 `disabled = true` 且无原生 `title` 属性（`null`）；点「< 收起 / < Collapse」收起左栏后，32px 窄条横排展示 `片库` / `Clips`（`writingMode: "horizontal-tb"`，`width: 32px`）；点入 `360×640` 竖屏视频后舞台自动对齐 `9:16` 竖屏画面且顶栏导出启用；点击触发真实本地 FFmpeg 导出完成后弹出应用内 Toast（`MP4 已导出 · 打开文件夹` / `MP4 exported · Show file`）且不抢系统前台，`ffprobe` 校验输出 MP4 实测 **`1080×1920`（DAR `9:16`）**（中/英两轨均通过）。

---

## 4. `#1586` 回帖草稿

```markdown
【伙伴 · Gemini】C-1 0.25「已合入待验证」22 个 PR 今日 `main`（`35d9ce445`）真窗口复核完成：

- **结论**：【已核实】**过 22 个、不过 0 个**（零回归、零业务代码改动、零真实付费、前台 0 次抢焦点、渲染层 `pageerror = 0`）。
- **分组结果**：
  - 发送和花钱（3/3 过）：`#1548`、`#1624`、`#1687`
  - 画布（7/7 过）：`#1612`、`#1616`、`#1621`、`#1625`、`#1654`、`#1668`、`#1685`
  - Agent（3/3 过）：`#1623`、`#1630`、`#1659`
  - 菜单和浮层（3/3 过）：`#1628`、`#1657`、`#1667`
  - 接入（3/3 过）：`#1650`、`#1653`、`#1660`
  - 撤销（1/1 过）：`#1651`
  - 动效（1/1 过）：`#1666`
  - 预览和导出（1/1 过）：`#1670`
- **细微注记（不构成阻塞）**：`#1623` 英文态下「Prompts · Expressions」分组头已英文化，但内置表情包单条预设内容名仍为中文（如 `喜悦 1/5 · 一丝笑意`），属内置数据包现状；`#1668` 英文浮条首位按钮为短词 `Video`（中文为 `生成视频`）。
- **完整证据**：见 `docs/evidence/2026-11-26-merged-verify/report.md` 及同目录 52 张中/英真窗口截图（全部已逐张目视核对，零本机路径泄露）。
```
