# G-site Wave 1 · 暂停点总览包（`00-STOP-POINT-SUMMARY`）

> 归属议题：`#1586`（`#7108073914` · `#7108114530` · `#7108139807` · `#7108189580` · `#7108399586`）
> 执行线：`g-site-wave1` · 日期：`2026-11-24`
> 边界核查：未推远端（`git push` = 0）、未碰 `src/` 与 `electron/`、未碰 `#1552` 与 `#1553` 同步资产、0 行拷入 MkSaaS 私有源码、仓库提交文件 0 本机路径泄露。

---

## 一、需协调与用户拍板的 3 个关键决定（Wave 1 → Wave 2 闸门）

| 序号 | 待拍板事项 | 实证依据 | 推荐项与一句话权衡 |
|---:|---|---|---|
| **1** | **Cloudflare 边缘防爬开关调整**（外部控制台操作） | 非机房网络 13 种 UA × 6 路径 = `78/78` 全 `200`，证明未按 UA 封 AI 爬虫；但 GitHub Actions（Azure `AS8075`）连续 6 周 `112/224` 页返 `403`（`seo-radar` 全红）。Cloudflare Free 版的 **Bot Fight Mode** 跑在 WAF 规则引擎之前，配 Skip 白名单也绕不过。 | **按 `01-crawler-and-403-audit.md` 第四节 4 步关掉 Free 版 Bot Fight Mode，保持 `Block AI bots` / `AI Labyrinth` / `Managed robots.txt` 为 `Off`，加一条自定义 WAF Skip 兜底**。纯静态官网无私有接口，放开机房检索器零安全损失，换回每周自动巡检与第三方 AI 实时取页畅通。 |
| **2** | **`llms.txt` 策略确认** | 2025–2026 官方核查：Google Search / AI Overviews（John Mueller 明示忽略）、OpenAI `OAI-SearchBot`、Anthropic、Perplexity 均**不消费外部站点的 `llms.txt` 做搜索发现或排名**。 | **维持「不做全站 SEO 型 `llms.txt`」（Keep Skipping）**。不养容易漂移的第二份 Markdown 摘要（守 P1），把精力集中在修清现存 52 条结构化元数据缺口与首屏 HTML 实体直答。 |
| **3** | **官网首页改版方向拍板**（三选一或混合） | 已按 Nomi Design System v2 做出 A / B / C 三套独立可交互 HTML 原型，覆盖 `1440×900` 与 `375×812` 明暗双模且全部 `overflow = 0`。 | **推荐「以方向 A 为主骨架 + 融入方向 B 的首屏 GEO 实体锚点与样片省废片对比器 + 方向 C 的 11 月模型参数表」**：既让访客免下载亲手点通「文稿→分镜→画布→时间轴」（Qoder 式交互感），又把「自带 Key 原价 + 480p 样片少花冤枉钱」和 GEO 品类词一次立住。 |

---

## 二、四项交付物核心结果速览

### 1. `403` 根因与 AI 爬虫可达性审计（`01-crawler-and-403-audit.md`）
- **真请求矩阵**：对 `https://nomiaqm.com/`、`/quickstart`、`/docs`、`/models`、`/robots.txt`、`/sitemap.xml` 实跑 13 种 UA（`Chrome`、`node`/`undici`、`Nomi-SEO-Observatory/1.0`、`GPTBot/1.0`、`OAI-SearchBot/1.0`、`ChatGPT-User/1.0`、`PerplexityBot/1.0`、`ClaudeBot/1.0`、`Google-Extended`、`Bingbot/2.0`、`Bytespider`、`Googlebot/2.1`、`curl`），本机非机房 IP **`78 / 78` 全 `HTTP 200`**；GitHub Actions Azure `AS8075` 机房连续 6 周在无后缀 HTML 路由报 **`112 / 224` `HTTP 403`**（静态 `.xml`/`.txt` 为 `200`）。
- **绕开 403 后的真实 `seo:audit` 全量体检（`224` 页 / `2,466` 项检查，`networkFailures: 0`）**：
  - 首页 `/`、`/en/`、`/quickstart`、`/en/quickstart`：**`0` 错误**；
  - 全站共 **`52` 条真实元数据与结构化数据问题**（此前被 403 掩盖）：
    1. `SCHEMA-WEBPAGE`（**32 条**）：`/models`、`/prompts`、`/skills` 等集合索引页 JSON-LD 只写了 `CollectionPage`，缺 `WebPage`；
    2. `META-OG`（**12 条**）：`/docs/**` 与 `/en/docs/**` Starlight 文档页缺 `og:image` 与 `og:image:alt`；
    3. `META-DESCRIPTION`（**8 条**）：7 个 `/en/models/*` 页与 `/skills/writer-style-schrader` 描述长度越出 `50–160` 字符。

### 2. 2026 `llms.txt` 调研与 30 问创作者真实基线（`02-geo-research-and-baseline.md`）
- **★0 四条一手研究与官方规范**：Google Search Central《AI features and your website》（Query Fan-Out 与结构化数据一致性）、OpenAI《Overview of OpenAI Crawlers》（`OAI-SearchBot` 独立准入）、CapstonAI 2026《Entity Clarity vs. Site-Wide Consistency》（990 查询实证首屏实体清晰度决定入选率）、Moz/Ahrefs/Muck Rack 2025–2026 跨引擎引用分布（84% 引用来自 GitHub / 评测目录 / 社区等第三方高权威源）。
- **固定 30 问（中 15 + 英 15）今日实测基线分**：
  - **`nomiaqm.com` 官网被引用**：**`0 / 30`（`0.0%`）**
  - **`github.com/aqm857886159/Nomi` 被提及并引用**：**`1 / 30`（`3.3%`）**——仅 `ZH-02`（`本地优先 AI 视频工作台`）排第 1 名，引用源为 GitHub 仓库 + CSDN 文章，官网未被抽中；其余关于 `Seedance 2.5`、`Seedream 5.5`、`Kling 4.0 Flash`、`MiniMax H3 Max`、`自带 API Key 视频软件`、`ComfyUI 分镜时间轴`、`Claude Code MCP 视频剪辑` 及全部 15 条英文查询均为 `0` 命中，增量空间巨大且对手薄弱（如搜「自带 API Key 视频软件」AI 甚至回答市面上几乎没有成熟桌面客户端）。

### 3. 本地干净分支 `fix/site-community-qr-and-crawler-robots`（已提交本地，未 Push）
- **分支与提交**：`fix/site-community-qr-and-crawler-robots` @ `4a53e6cc0`（任务提交 `44473f3eb` + 合并最新 `origin/main` `1730b7ea3`，仅改 **19 个文件**，`marketing/data/site-data.json` 与 200+ 模型/技能 HTML 子页 **0 改动**，与 `#1552` / `#1553` 零冲突）。
- **根因修复与门岗锁死**：
  1. 同提交删除已于 11 月 22 日过期的 7 天微信群二维码 `marketing/assets/group-wechat-2026-11-22.jpg` 与 `docs/media/nomi-canvas-group-wechat-2026-11-22.jpg`；
  2. 官网中英首页 `#community` 与 `README.md`、`README.zh-CN.md`、`README.ja.md`（顺手修掉日文版遗留的 `2026-11-13.jpg` 断链！）统一改为永不过期的社区入口（GitHub / Discussions / Issues / Bilibili）+ 长期有效维护者个人微信码 `qingyang-wechat.jpg`（`TZ857886159`，加好友拉最新画布群）；
  3. `scripts/build-marketing-sitemap.mjs` 纳管 `marketing/robots.txt` 生成与 `--check`，显式放行 `Googlebot`、`Bingbot`、`GPTBot`、`OAI-SearchBot`、`ChatGPT-User`、`PerplexityBot`、`ClaudeBot`、`Google-Extended`；`scripts/seo/seo-audit.mjs` 新增 `ROBOTS-CRAWLER-DISALLOW` 审计；
  4. `tests/ux/marketing-home.static.mjs` 新增目录级拦截 `*group-wechat*` 临时群码与 `README*.md` 本地图片断链检查；`scripts/marketing/styles.mjs` 在 `homeCss` 补齐 `380px` 以下极窄屏顶栏紧凑间距。
- **验证全绿**：先红后绿实证齐全；`pnpm run check:site`（21/21）、`pnpm run test:seo`（27/27）、`node tests/ux/marketing-home.visual.mjs`（含 `en-320` / `no-JS` / `reduced-motion` / `blocked-media`）、`check-pr-judgement.mjs --stage=push` 与 `--stage=merge` 全部通过；已亲眼检查修复后中英桌面/移动社区区截图（`screenshots/after-home-community-*.png`）。PR 正文草稿已备好于同目录 `pr-qr-robots-body.md`。

### 4. 三套官网首页方向探索原型与全尺寸明暗截图（`03-homepage-directions.md`）
- **方向 A（`dir-a-interactive-stage.html` · 推荐主骨架）**：暖纸片场大标题 + 下方整宽**可点击 Nomi 工作台复刻舞台**（左切换 `文稿 / 分镜 / 画布 / 时间轴` 实时联动右侧节点/分镜表与严格遵守 `§1.0 只指路` 的常驻 Agent，显式标 `演示原型`）+ 11 月四大新模型信号带（`Seedance 2.5`、`Seedream 5.5`、`Kling 4.0 Flash`、`MiniMax H3 Max`）+ Bento 能力格 + GitHub 爆款精选预览（无盗图，写清「在 Nomi 里怎么配合用」）。
- **方向 B（`dir-b-creator-pipeline.html`）**：顶部显式 **GEO 实体事实卡** + 四步胶片管线分步联动切换器 + 交互式 **APIMart 原价直连 & 480p 样片省废片对比器**。
- **方向 C（`dir-c-dense-craft-bento.html`）**：Linear/Raycast 级克制高密度左右分栏（左一句话品类定义 + 下载 + `$ claude mcp add nomi`，右实时可切换 4 大模型参数的节点生成框检视器）+ 本地项目目录树 + 11 月新模型规格矩阵表。
- **截图矩阵核验**：Playwright 实测 12 组响应式明暗视图（`1440×900` & `375×812` × `Light` & `Dark`）全部 `scrollWidth === clientWidth`（`overflow = 0`）、`brokenImgs = 0`，并逐张经 `read_file` 亲眼复查修正了全部排版细节（节点徽章位置、中文标题防单字孤行、375px 信息条自适应换行）。

---

## 三、交付目录完整清单（本提案目录）

- `00-STOP-POINT-SUMMARY.md` — 本总览与拍板决策表
- `01-crawler-and-403-audit.md` — `nomiaqm.com` 403 根因、78 次 UA 探测矩阵、52 条真实 SEO 问题与 Cloudflare 4 步放行手册
- `02-geo-research-and-baseline.md` — 2026 `llms.txt` 官方核查、4 项一手 GEO 研究对标与中英 30 问真实基线明细表
- `03-homepage-directions.md` — 同类网站真图对标（Qoder / LibTV / TapNow）、三套方向原型优劣对比与视觉自检表
- `pr-qr-robots-body.md` — `fix/site-community-qr-and-crawler-robots` 分支标准档 PR 正文草稿（已过 `check-pr-judgement` 推送档与合并档）
- `dir-a-interactive-stage.html` — 方向 A 独立可交互原型（暖纸片场 + 可点击四栏工作台复刻）
- `dir-b-creator-pipeline.html` — 方向 B 独立可交互原型（叙事四步胶片管线 + GEO 事实卡 + 省废片对比器）
- `dir-c-dense-craft-bento.html` — 方向 C 独立可交互原型（高密度精密工具直展 + 实时节点参数检视器）
- `crawler-probe.json` / `live-seo-audit.json` / `local-seo-audit.json` — 线上 78 次探测与全站 224 页审计原始 JSON 数据
- `screenshots/`：
  - 现状基线：`before-home-1440.png`、`before-home-1440-dark.png`、`before-home-375-light.png`、`before-home-community-1440.png`
  - 本次分支修复后实证：`after-home-community-zh-1440-light.png`、`after-home-community-en-1440-dark.png`、`after-home-community-zh-375-light.png`、`after-home-community-en-375-light.png`
  - 方向 A：`dir-a-1440-light.png`、`dir-a-1440-dark.png`、`dir-a-375-light.png`、`dir-a-375-dark.png`、`dir-a-full-light.png`
  - 方向 B：`dir-b-1440-light.png`、`dir-b-1440-dark.png`、`dir-b-375-light.png`、`dir-b-375-dark.png`、`dir-b-full-light.png`
  - 方向 C：`dir-c-1440-light.png`、`dir-c-1440-dark.png`、`dir-c-375-light.png`、`dir-c-375-dark.png`、`dir-c-full-light.png`
