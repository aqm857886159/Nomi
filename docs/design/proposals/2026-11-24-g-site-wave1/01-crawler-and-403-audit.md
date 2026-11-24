# 01 · `nomiaqm.com` HTTP 403 根因核查、AI 爬虫可达性与 Cloudflare 放行指南

> 审计日期：2026-11-24
> 覆盖范围：`docs/seo/README.md`、`docs/seo/config.json`、`docs/seo/reports/`、`scripts/seo/seo-audit.mjs`、`marketing/robots.txt`、线上 `https://nomiaqm.com` 实测（13 种 User-Agent × 6 条核心路径 = 78 次请求）及 GitHub Actions `seo-radar.yml` 连续 6 周运行记录对账。

---

## 一、核心结论（区分已观测事实与机制判断）

1. **已观测事实 A（非机房 IP 实测：78/78 全部 `HTTP 200`）**：
   从本机非数据中心网络向 `https://nomiaqm.com` 的 6 个目标地址（`/`、`/quickstart`、`/docs`、`/models`、`/robots.txt`、`/sitemap.xml`）逐一用 13 种 UA 发起真实请求（含 `Chrome`、Node `undici` 默认 UA、`Nomi-SEO-Observatory/1.0`、`GPTBot/1.0`、`OAI-SearchBot/1.0`、`ChatGPT-User/1.0`、`PerplexityBot/1.0`、`ClaudeBot/1.0`、`Google-Extended`、`Bingbot/2.0`、`Bytespider`、`Googlebot/2.1`），**78 次请求全部返回 `HTTP 200`**（`server: cloudflare`，无 `cf-mitigated: challenge`）。
   → **证明 Cloudflare 后台并未开启按 UA 名字一刀切封禁 AI 爬虫的「Block AI Bots」或托管 `robots.txt` 拦截**。

2. **已观测事实 B（机房 IP / GitHub Actions 连续 6 周 `HTTP 403`）**：
   核查 `.github/workflows/seo-radar.yml` 最近 6 次定时运行（含昨日 `2026-11-23` Run `45147557736` / PR `#1552`，以及 `2026-11-09` PR `#1474`、`2026-09-28` 已合入快照），在 GitHub Actions `ubuntu-24.04`（Microsoft Azure 数据中心 ASN `AS8075`）上：
   - `/sitemap.xml` 与 `/robots.txt` 静态后缀文件返回 **`HTTP 200`**；
   - `224` 个无后缀 HTML 干净路由中，**恰好 `112` 个（偶数序号 `0, 2, 4, ...`，含首页 `/`）稳定返回 `HTTP 403`**，导致每周巡检恒定报 `112` 条 `NETWORK-PAGE` 错误并以 `exit code 1` 失败。

3. **根因与 GEO 真实风险**：
   - `nomiaqm.com` DNS 解析指向 Cloudflare（`172.67.163.9` / `104.21.42.149`，NS：`delilah.ns.cloudflare.com` / `reese.ns.cloudflare.com`）。
   - 拦截源是 **Cloudflare Bot Fight Mode（或 Super Bot Fight Mode 对数据中心 ASN + 非浏览器 TLS JA3/JA4 指纹的自动质询）**：它放行静态扩展名（`.xml`/`.txt`）和住宅 IP，但对来自云厂商机房（Azure `AS8075`、AWS `AS16509`、GCP 等）且未进 Cloudflare Verified Bots 名单的 HTTP 客户端返回 `403` 质询页；配合 `seo-audit.mjs` 遇到 `!response.ok` 直接抛错未消费 `response.body` 触发连接池轮转，在双栈/多连接下形成稳定的交替 `403`。
   - **对 GEO 的影响**：`Googlebot`、`Bingbot`、`OAI-SearchBot`、`GPTBot` 属于 Cloudflare 官方 **Verified Bots**（走反向 DNS / IP 白名单校验），通常可过；但**实时按需抓取网页的 Agent 检索器、国内大模型联网爬虫（豆包/Kimi 部分出口）、第三方 RAG 搜索节点以及我们的每周巡检 `Nomi-SEO-Observatory/1.0`** 跑在公有云机房 IP 上且不在 Verified Bots 名单内，**会被同一道 Bot Fight Mode 直接挡成 `403`**！
   - **关键陷阱**：Cloudflare 官方文档明确说明——免费版的 **Bot Fight Mode 运行在 Ruleset Engine 之外，任何自定义 WAF `Skip` 规则都绕不过它**！如果在免费版开了 Bot Fight Mode，配再多 WAF 白名单也没用，必须关掉 Bot Fight Mode 改用自定义 WAF 规则精准管。

4. **绕开 403 后暴露出的 52 条真实站内 SEO 问题（今天全站 224 页 `networkFailures: 0` 实跑结果）**：
   此前每周 `112` 个 `403` 噪音掩盖了真实的生成页元数据缺口。今天对线上 `https://nomiaqm.com` 与本地 `marketing/` 跑通全部 `224` 页（`2,466` 项检查）结果完全一致，共 **`52` 条真实 Finding**（首页 `/`、`/en/`、`/quickstart`、`/en/quickstart` 均为 **0 错误**）：
   - **`SCHEMA-WEBPAGE`（32 条）**：`/models`、`/en/models`、`/prompts`（及分类子页）、`/skills`、`/en/skills` 等索引页 JSON-LD `@type` 写了 `CollectionPage`，未包含 `seo-audit.mjs` 要求的 `WebPage`；
   - **`META-OG`（12 条）**：Astro Starlight 构建出的 `/docs/**` 与 `/en/docs/**` 共 12 页缺少完整的 `og:image` + `og:image:alt`；
   - **`META-DESCRIPTION`（8 条）**：7 个 `/en/models/*` 详情页与 `/skills/writer-style-schrader` 的 `<meta name="description">` 长度超出 `50–160` 字符区间。

---

## 二、13 种 User-Agent × 6 条路径实测矩阵（2026-11-24）

测试命令：`curl -sS -D - -o /dev/null --max-time 12 -A "<UA>" <URL>`（原始响应明细已存同目录 `crawler-probe.json`）。

| User-Agent 类别 | 具体 UA 标识 | `/` | `/quickstart` | `/docs` | `/models` | `/robots.txt` | `/sitemap.xml` | Server / 拦截头 |
|---|---|---:|---:|---:|---:|---:|---:|---|
| 标准桌面浏览器 | `Chrome/131.0.0.0` (macOS) | `200` | `200` | `200` | `200` | `200` | `200` | `cloudflare` / 无拦截 |
| Node `undici` 默认 | `node` | `200` | `200` | `200` | `200` | `200` | `200` | `cloudflare` / 无拦截 |
| Nomi 每周巡检脚本 | `Nomi-SEO-Observatory/1.0` | `200` *(CI 机房为 `403`)* | `200` | `200` | `200` *(CI 机房为 `403`)* | `200` | `200` | 非机房 `200`；GitHub Actions Azure 机房 `403` |
| `curl` 默认 | `curl/*` | `200` | `200` | `200` | `200` | `200` | `200` | `cloudflare` / 无拦截 |
| OpenAI 训练爬虫 | `GPTBot/1.0` | `200` | `200` | `200` | `200` | `200` | `200` | `cloudflare` / 无拦截 |
| ChatGPT Search 索引 | `OAI-SearchBot/1.0` | `200` | `200` | `200` | `200` | `200` | `200` | `cloudflare` / 无拦截 |
| ChatGPT 实时取页 | `ChatGPT-User/1.0` | `200` | `200` | `200` | `200` | `200` | `200` | `cloudflare` / 无拦截 |
| Perplexity 搜索爬虫 | `PerplexityBot/1.0` | `200` | `200` | `200` | `200` | `200` | `200` | `cloudflare` / 无拦截 |
| Anthropic 爬虫 | `ClaudeBot/1.0` | `200` | `200` | `200` | `200` | `200` | `200` | `cloudflare` / 无拦截 |
| Google AI 训练/接地控制 | `Google-Extended` | `200` | `200` | `200` | `200` | `200` | `200` | `cloudflare` / 无拦截 |
| Bing / Copilot 索引 | `bingbot/2.0` | `200` | `200` | `200` | `200` | `200` | `200` | `cloudflare` / 无拦截 |
| 字节跳动 / 豆包爬虫 | `Bytespider` | `200` | `200` | `200` | `200` | `200` | `200` | `cloudflare` / 无拦截 |
| Google 核心搜索索引 | `Googlebot/2.1` | `200` | `200` | `200` | `200` | `200` | `200` | `cloudflare` / 无拦截 |

---

## 三、`pnpm run seo:audit` 实测数据对比

| 运行环境 | 检查页面数 | 总检查项 | `NETWORK-PAGE` (403) | 元数据 / Schema 问题 | 总 Findings |
|---|---:|---:|---:|---:|---:|
| 历史基线 `docs/seo/reports/2026-09-28.md`（GitHub Actions） | 2 / 5 | 27 | 3 | 2 | **5** |
| 昨日定时任务 `2026-11-23` Run `45147557736`（GitHub Actions） | 112 / 224 | 1,346 | **112** | 30 | **142** |
| 今日线上实跑 `https://nomiaqm.com`（非机房网络） | **224 / 224** | **2,466** | **0** | **52**（32 `SCHEMA-WEBPAGE` + 12 `META-OG` + 8 `META-DESCRIPTION`） | **52** |
| 今日仓库 `marketing/` 本地静态回放 | **224 / 224** | **2,466** | **0** | **52**（与线上逐条完全一致） | **52** |

---

## 四、Cloudflare 控制台可执行的精确修改步骤（交协调与用户操作）

`nomiaqm.com` 是纯公开静态官网（无登录态、无私有接口、无计费后端），防机器人的唯一正当诉求是防 DDoS 洪泛，**绝不应在边缘用 JS Challenge 拦截无头检索器与 CI 巡检**。请按顺序核对并修改 Cloudflare 控制台（域名 `nomiaqm.com`）以下 4 项开关：

### 第 1 步：关闭免费版「Bot Fight Mode」（最关键！）
- **路径**：Cloudflare Dashboard → 选择域名 `nomiaqm.com` → 左侧 **Security（安全性）** → **Bots（机器人）**（新版界面在 **Security → Settings**，筛选 `Bot traffic`）。
- **操作**：
  1. 若账号为 **Free 计划**：将 **Bot Fight Mode** 设为 **`Off`（关闭）**。
     - *原因*：Cloudflare 官方架构规定 Free 版 Bot Fight Mode 在 WAF 自定义规则之前硬执行，无法用 Custom Rule `Skip`，开启即无差别拦截 Azure/AWS 上的 `seo-radar`、第三方 AI 实时阅读器与开源社区聚合抓取器。
  2. 若账号为 **Pro / Business 计划**（显示为 **Super Bot Fight Mode**）：将 **Definitely automated（确定为自动程序）** 从 `Block` / `Managed Challenge` 改为 **`Allow`**（或保留保护并执行下方第 4 步 Skip 规则）。

### 第 2 步：确认关闭「Block AI Bots」与「AI Labyrinth」
- **路径**：同一页面（**Security → Bots** 或 **Security → Settings → AI Crawl Control / AI Scrapers and Crawlers**）。
- **操作**：
  1. **Block AI bots（拦截 AI 机器人）**：设为 **`Off`（关闭）**（或 `Do not block`）。
  2. **AI Labyrinth（AI 迷宫 / 蜜罐链接）**：设为 **`Off`（关闭）**——避免向未认证的 AI 搜索抓取器注入无关诱饵链接污染模型对 Nomi 的实体认知。
  3. **Manage `robots.txt` / Instruct AI bot traffic with `robots.txt`（Cloudflare 托管注入 `robots.txt`）**：设为 **`Off`（关闭）**——确保线上 `/robots.txt` 100% 由仓库 `marketing/robots.txt` 真相源控制，不被 Cloudflare 在文件头部自动拼接 `Disallow: /` 规则。

### 第 3 步：检查 Security Level 与 Browser Integrity Check
- **路径**：**Security → Settings**（旧版在 **Security → Settings**）。
- **操作**：
  - **Security Level**：保持 `Medium` 或 `Essentially Off`（不要开 `Under Attack Mode`）。
  - **Browser Integrity Check（浏览器完整性检查）**：建议设为 **`Off`**（否则部分精简 Header 的 AI 检索代理与 CLI 链接检查器会被弹 403）。

### 第 4 步：添加一条显式 WAF Custom Skip 规则（Pro 版及未来托管规则兜底）
- **路径**：**Security → WAF → Custom rules（自定义规则）** → **Create rule（创建规则）**。
- **规则名**：`Allow Verified Bots, AI Search Crawlers & Nomi SEO Radar`
- **点击 `Edit expression`（编辑表达式）粘贴**：
  ```txt
  (cf.client.bot) or (http.user_agent contains "Nomi-SEO-Observatory/1.0") or (http.user_agent contains "OAI-SearchBot") or (http.user_agent contains "GPTBot") or (http.user_agent contains "ChatGPT-User") or (http.user_agent contains "PerplexityBot") or (http.user_agent contains "ClaudeBot") or (http.user_agent contains "Claude-SearchBot") or (http.user_agent contains "Google-Extended") or (http.user_agent contains "Bytespider") or (http.user_agent contains "Applebot")
  ```
- **Then take action（执行动作）**：选择 **`Skip`**，勾选跳过：
  - `[x] All remaining custom rules`
  - `[x] All rate limiting rules`
  - `[x] All managed rules`
  - `[x] Super Bot Fight Mode Rules`（如可见）
- **保存并部署（Deploy）**。

### 第 5 步：改完后的 1 分钟验证闭环
在 GitHub Actions 页面手动点一次 **SEO Radar → `Run workflow`（`workflow_dispatch`）**：
- **判据**：工作流跑完 `NETWORK-PAGE` 403 数量从 `112` 降为 **`0`**（退出码由 `1` 变 `0`），生成的报告 `Pages checked` 从 `112` 升至 **`224`**！
