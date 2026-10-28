# 导演台收进生成页 · 证据（2026-10-29）

用户原话：「2.导演台 我打开以后 画布右侧还有漏出」；「点入导演台之后呢？然后我点其他页面我都出不去了。我点创作也出不去，预览也出不去。」在「现在 vs 收进生成页」的对比里选了「收进生成页（推荐）」。
拍板图清单：`docs/design/boards/2026-10-29/DirectorInPage.board.json`；设计卡：`docs/plan/2026-10-29-director-layer-in-page.md`；走查：`tests/ux/director-layer-in-page.walk.mjs`。

## 怎么量的

- before = origin/main `87d899fed` 的构建，after = 本分支的构建；同一份走查脚本，Electron 真机、隔离资料目录、零额度、不碰真实项目、不调模型。
- 几何量真实矩形，命中用 `elementFromPoint`（不是「Playwright 点得动」，CDP 合成点击会绕过命中测试）；3 种 Agent 形态（停靠 / 浮窗 / 小球）× 3 种窗口（1440×900、1920×1080、1280×720）× 中英。
- 渲染循环用 WebGL 绘制调用计数 + `app.getAppMetrics()` 的 CPU 量；键盘用文档级探针（被窗口捕获期监听吞掉的键到不了它）。
- 走查末尾核「板上 16 个 implemented 元素每个都有检查挂着且全过」。终版：中文 103/103、英文 103/103（改前 main 构建上同一套步骤：中文 33/74、英文 35/82，当时脚本条目少一些）。

## 一页成绩单

| 场景 | 完成 | 主指标 现状 → 当前（实测，Electron 真机，9 格 × 中英） | 护栏 | 最大摩擦与决定 | 没验证的 |
|---|---|---|---|---|---|
| T1 开导演台 → Agent 三形态 → 点创作 / 预览 → 回生成 | 机器 2 / 2（中、英各 1，失败不丢：改前 main 上红） | 导演层矩形 = 页格矩形：0 / 9 → 9 / 9；页格内导演层之外可点的画布命中点：浮窗 1440 / 1920 各 6 个 → 0 | 点创作 / 预览后导演层不可见 0 / 2 → 2 / 2；左栏命中落在按钮上 0 / 9 → 9 / 9；顶栏三个模式钮命中 9 / 9 → 9 / 9；切回来选中镜头与标题不变、暗色锁重新生效 | 走查里把 Agent 浮窗拖到画布中间会盖住底部加节点条（浮窗在画布之上是对的），走查改为先收成小球 | 全景「回到生成页还开着」（见下，unverified） |
| T2 小球叫出 Agent、浮窗拖到导演层上面 | 机器 2 / 2 | 小球中心点命中 Agent 层：0 / 3（被导演层盖住）→ 3 / 3；浮窗 3 / 3 → 3 / 3 | 点开小球后输入框能聚焦、中心点命中在 Agent 面板里 | — | — |
| T3 ← / Esc 退出确认；创作页按 Esc；回项目库 | 机器 2 / 2 | 藏着时 Esc / 1 2 3 / Delete / Backspace / ⌘Z 到得了文档级监听：0 → 全部；回库后导演层卸载（持续没有） | 创作页按 Esc 不弹退出确认；确认框、设置对话框在导演层 / Agent / 左栏之上 | — | — |

渲染循环（藏着 = 在预览页）：2 秒绘制调用 看得见 7680 → 藏着 3600（改前，导演台还盖在预览页上，一直在画）/ **0**（改后）；CPU（渲染 + GPU + 其它进程合计 %）改后 5.2–5.4 → 0.2–0.6；切回来 1.5 秒 5792–5856 次绘制恢复。
真人 SEQ、误点、回退、求助：null（没做真人测试）。不出总分。

## 截图对照（左 before = main，右 after = 本分支）

| 文件 | 看什么 |
|---|---|
| `zh-CN-` / `en-` `1440x900-float-open.png` | 浮窗：after 导演台铺满页格、左栏露出、右侧不再露出画布；浮窗在导演台之上 |
| `…1440x900-dock-open.png`、`…1920x1080-dock-open.png` | 停靠：导演层让出右边那一列，不重叠 |
| `…1440x900-ball-open.png`、`…1920x1080-ball-open.png` | 小球：after 小球浮在导演台右下角之上（before 看不见） |
| `…1920x1080-float-open.png`、`…1280x720-float-open.png` | 大窗 / 窄窗同样不漏、不盖左栏 |
| `…nav-creation.png` | 导演台开着点「创作」：before 导演台还盖在最前面，after 切到创作页（浅色，左栏在） |
| `…nav-back-generation.png` | 点回「生成」：导演台还开着，选中的镜头 2 不变 |
| `…exit-confirm.png` | 退出确认框在导演层和 Agent 之上 |
| `zh-CN-rail-docs-drawer-open.png` | 导演台开着真点左栏「文稿」，抽屉打开（before 点不到） |
| `zh-CN-agent-float-dragged-over-director.png` | 浮窗拖到导演台中央仍在其上 |
| `zh-CN-list-view-director-hidden.png`、`zh-CN-timeline-expanded.png` | 列表视图导演层跟着藏；时间轴展开页格变矮、导演层跟着 |
| `zh-CN-director-settings-dialog.png` | 设置对话框在导演层、Agent、左栏之上 |
| `zh-CN-panorama-open.png`、`zh-CN-panorama-nav-creation.png` | 全景查看器同一个挂法：层 = 页格、左栏在；点创作后不再盖在最前面 |
| `after-zh-CN-record-cancelled-after-return.png`、`after-zh-CN-panorama-back-generation.png` | 只有 after：录运镜到一半切走再回来，录制已放弃；全景回到生成页的样子（见下） |

## 按钮普查（可点目标 · 七字段）

| 目标 | 设计来源 / 组件·变体·状态 | 无障碍角色 + 名称 | 用户动作 | 预期的界面状态和副作用 | 测试 ID | 证据 |
|---|---|---|---|---|---|---|
| 左栏「文稿」「素材」 | 板 chrome.rail；外壳左栏按钮，导演台开着 | button「文稿 / Docs」「素材 / Assets」 | 点击 | 抽屉打开，导演台不动 | `4.rail-click`、`1.*.rail` | 走查 + `rail-docs-drawer-open` |
| 顶栏「创作」「预览」 | 板 chrome.topbar / nav.away-hides | button | 点击 | 导演台随生成页藏起来，目标页按自己的明暗显示 | `4.creation.hidden`、`4.preview.hidden`、`4.*.scheme` | 走查 + `nav-creation` |
| 顶栏「生成」 | 板 nav.back-keeps | button | 点击 | 导演台原样还开着、镜头不变 | `4.back.visible`、`4.back.state` | 走查 + `nav-back-generation` |
| Agent 小球 | 板 agent.ball-above；外壳 Agent 层（z-60） | button | 点击 | 变浮窗，输入框可聚焦 | `1.*.ball`、`2.ball-click`、`2.composer-usable` | 走查 + `*-ball-open` |
| Agent 浮窗拖动手柄 | 板 agent.float-above | 拖动 | 拖到导演台中央 | 仍在导演台之上、点得到 | `2.float-drag` | 走查 + `agent-float-dragged…` |
| 停靠栏分隔条 | 板 agent.dock-beside | separator | 键盘 End / Home | 页格宽变、3D 画布宽跟着变 | `2.dock-resize.*` | 走查 |
| 导演台「←」 | 板 exit.confirm-on-top | button | 点击 | 退出确认框在最上面；取消留下、确认卸载 | `6.arrow-confirm`、`6.cancel-stays`、`6.exit` | 走查 + `exit-confirm` |
| 生成页「画布 \| 列表」 | 板 nav.away-hides / nav.back-keeps | button | 点击 | 切到列表导演层藏起来，切回还在 | `3.list-hides`、`3.list-back` | 走查 + `list-view-director-hidden` |
| 时间轴窄条 | 板 layer.fills-cell | button | 点击展开 / 收起 | 页格高度变，导演层跟着 | `3.timeline-expand` | 走查 + `timeline-expanded` |
| 导演台设置（视图菜单 → 偏好） | 板 exit.confirm-on-top | menuitem / dialog | 点击 | 对话框在最上面，Esc 只收它 | `5b.*` | 走查 + `director-settings-dialog` |
| 全景查看器「进入」 | 板 panorama.same-mount | button | 点击 | 页格内铺满；点创作藏起来；Esc 关 | `7.*` | 走查 + `panorama-open` |

## 没验证的 / 已知缺口

- **全景查看器「切走再回来还开着」没做到（unverified，板元素 `panorama.back-keeps` = missing，交协调）**：完整走查里（先开关过导演台、建过第二个导演台节点之后）点回「生成」那一刻，全景节点的外壳 DOM 被画布卸载又挂回（打的标记丢了、查看器 id 变了），全屏态是节点里的本地 state 跟着丢，回来时查看器是关着的；节点上存的图没变。单跑第 7 小节（`--only=7`）不复现；导演台节点（open 在节点组件自己身上）没这个现象。复现：`node tests/ux/director-layer-in-page.walk.mjs`（完整跑），看 note「7.back 已知缺口」里三次快照与标记。
- Windows 真机：页格由构造在顶栏之下，`windowChrome.test.ts` 的整窗 fixed 根 / 页格名单覆盖；40px 系统拖拽带的真机命中 unverified。
- Fast Refresh / StrictMode 重挂：dev 专属，单测环境无 DOM；用「反复退出再进入、第二个节点先后打开」的走查代替，Fast Refresh 本身 unverified。
- 走查进程退出码：本机偶尔被 `quiet-walk` 前台守卫判红（走查的 Electron 在抽样那一刻是最前的应用），不影响断言；同一条守卫在干净 main 上跑 `director-windowbar.walk.mjs` 也会红。
