# 仓库发现性：窄改动记录

🚧 文案已改，GitHub About / topics 尚未改（本环境没有可写的设置工具）。未合并，未部署官网。

这不是流量下降的根因报告。用户没有给出时间序列。本环境对 Traffic API 的只读请求返回 `403 Resource not accessible by integration`（views、clones、paths、referrers 都是这条）。没有视图、独立访客、来源或克隆数字，就不能写下降幅度或原因。Star 不是访问量，这里不用它代替。

GitHub 仓库搜索默认匹配 name / description / topics。README 正文要加 `in:readme` 才进那一档。站外 Google / Bing 看的是官网 HTML。两边不是同一个排名系统。改 title 或 description 不保证收录或名次。

## 已核对的事实

- 官网源码就在本仓库 `marketing/`，由 `scripts/build-marketing-site.mjs` 生成静态 HTML，Cloudflare 直接托管（`scripts/marketing/serving-contract.test.mjs`）。不是另一套 SSR 应用。`robots.txt` 与 `sitemap.xml` 是提交进仓库的静态文件。
- 仓库 About（2026-11-08 用 `gh repo view` 读到，未改）：description 为 `Open-source AI video workbench. Bring any model or your local ComfyUI, and let Claude Code / Codex / Cursor direct it over MCP — storyboard, references, generation, editable first cut on a real timeline. Local-first: projects, prompts, and keys stay on your machine. No account, no telemetry.` homepage 为 `https://nomiaqm.com`。topics 已满 20 个：`ai-agent`、`ai-video`、`ai-video-generator`、`bring-your-own-key`、`creative-tools`、`desktop-app`、`image-generation`、`local-first`、`offline`、`storyboard`、`text-to-image`、`text-to-video`、`timeline-editor`、`video-editing`、`video-generation`、`comfyui`、`mcp`、`ai-filmmaking`、`claude-code`、`seedance`。
- 「No telemetry」与实现不符。匿名统计默认关闭：`electron/telemetry/telemetrySettings.ts` 的 `DEFAULT_TELEMETRY_SETTINGS.enabled` 是 `false`，只有用户打开才发送。安装包还会查更新：`electron/update/autoCheck.ts` 在启动约 30 秒后首查，之后大约每 6 小时一次。生成时会把该次请求发给用户自己接的供应商。对外文案禁止绝对的 `no telemetry` / `不上报数据`（`electron/telemetry/telemetryClaims.test.ts`）。
- `offline` 这个 topic 说过头。项目在本机，也可以接本地 ComfyUI；云端模型 API 和更新检查都要联网。已有 `timeline-editor` 与 `video-editing`。时间轴剪辑和导出 MP4 是 README 与产品路径里写明的能力，所以 `video-editor` 比 `offline` 更贴切，而且不是把整个传统非编都说成已经对齐。
- 最新发布是 `v0.24.1`（2026-11-06）。资源名包含 `Nomi-mac-arm64.dmg`、`Nomi-mac-intel.dmg`、`Nomi-windows-setup.exe`。README 三个直链与这些名字一致，本环境 HEAD 均为 200。宣传片文件仍是 `marketing/assets/video/nomi-0.22-film.mp4`。
- 首页原先的 `<title>` 中文是「商业级体验，模型按原价」，没有「开源 / AI 视频」。英文 title 有 AI video，但没有 open-source / local-first。可见的 H1 口号没有改。canonical、hreflang、`robots.txt` 的 `Allow: /` 与 Sitemap 声明、sitemap 与页面的对应关系都没有发现要修的断档。
- 本环境请求 `https://nomiaqm.com/`、`/en/`、`/sitemap.xml`、`/quickstart` 得到 Cloudflare challenge（`cf-mitigated: challenge`，标题是 Just a moment...）。同一环境请求 `/robots.txt` 得到 200，正文与仓库文件一致。这不能证明真人浏览器或 Googlebot 被拦。不据此改 robots、不加重试、不加验证文件。
- `docs/quickstart.md` 仍指向 `https://nomiaqm.com/quickstart.html`。页面 canonical 与 sitemap 用的是 `/quickstart`。源文件 `marketing/quickstart.html` 在。线上两种地址这次都被 challenge 挡住，所以没有改这一行。

## 这次改了什么

- `README.md`、`README.zh-CN.md`：首屏改成品类加结果（开源、本地优先、macOS/Windows、分镜、自己的模型或 ComfyUI、时间轴、无需 Nomi 账号）。英文 README 放了一句自然的中文，便于 `in:readme`。主导航收成宣传片、下载、快速上手、语言。官网、AtomGit、接入文档、社区、夸克和团队合作留在后文。赞助、推荐码披露、未签名提示、三个安装包直链都还在。宣传片标明录制于 0.22，不假装是当前界面，也不替换成还没拍的新片。隐私句改成「统计默认关、安装包会查更新、生成发给你接的供应商」。去掉了未复核的「24 个 MCP 工具」和「商业产品常常贵几倍」。MCP 服务本身仍在 `electron/capabilityCore/mcpToolCatalog.ts`；`scripts/tool-face-baseline.json` 里那 17 个名字只是手写传输面的棘轮，不是 `tools/list` 总数，所以不另写一个新数字。
- 首页 title / description：只改 `scripts/marketing/content.mjs` 的中英 `meta`，以及已提交的 `marketing/index.html`、`marketing/en/index.html` 里 title、Open Graph、Twitter 和 JSON-LD WebPage 的同一组字符串。H1、功能页和 robots 未改。`node scripts/build-marketing-sitemap.mjs` 只把 `/` 与 `/en/` 的内容哈希和 `lastmod` 从 2026-11-07 改到 2026-11-08。URL 与 hreflang 没有增减。

## 还没改，要人在 GitHub 设置里做

本代理的 `gh` 被限定为只读，Traffic 也是 403。没有别的已授权设置工具。不要用页面 cookie 或仓库令牌去打内部接口。维护者在本机执行（先看一眼 About 是否仍是上面的旧值）：

```bash
gh repo edit aqm857886159/Nomi --description 'Open-source, local-first AI video studio for macOS and Windows. Plan storyboards, generate clips with your own model APIs or local ComfyUI, and edit them on a timeline. No Nomi account required.'
gh repo edit aqm857886159/Nomi --remove-topic offline --add-topic video-editor
```

description 为 194 个字符，低于 GitHub 的 350 字上限。homepage 保持 `https://nomiaqm.com`。不要把 topics 堆过 20 个，不要加购买链接或跟踪参数。改完用 `gh repo view aqm857886159/Nomi --json description,repositoryTopics,homepageUrl` 核对。

## 站内和站外

- 站内：name 已经是 Nomi，同名陪伴产品靠 description 和 topics 区分。默认搜索看不到 README，所以 About 那一行必须自己带上品类。`in:readme` 才看得到 README 里的中文句子。
- 站外：首页 title / description 现在带「开源、本地优先、AI 视频」。页面正文里的价格口号还在，只是不再独占 `<title>`。没有为抓取 403 改 robots。sitemap 只更新了首页 `lastmod`。部署前，线上 title 不会变。

## 建议的人工复核

不要加自动监控。

- 7 天：打开 GitHub 仓库页，确认 About 是否已换成上面的句子、`offline` 是否已换成 `video-editor`。用 `in:name,description,topics` 搜 `local-first AI video`，用 `in:readme` 搜「开源、本地优先的 AI 视频工作台」。各记一次第一页有没有本仓库。没有 Traffic 权限就不要填视图数字。
- 14 天：如果有仓库 Admin 在 Insights → Traffic 看这 14 天的 views、unique visitors、referring sites、popular content、clones。只和上一个同样长度的窗口比，没有上一窗口就只记快照，不写百分比。再用浏览器看 `https://nomiaqm.com/` 的 view-source，确认 title 已是新句子，并打开 `/robots.txt` 与 `/sitemap.xml`。一次 403 或质询页不算「被搜索引擎封禁」。

## 设计卡

改动名：仓库发现性文案　线/负责人：cursor/discoverability-copy-2334　类别：其他

- ★1：当有人在 GitHub 或搜索引擎里分辨「Nomi」时，我希望第一屏和首页标题写出开源本地 AI 视频工作台，以便不会只看到价格口号或同名产品。真实任务是读 README 首屏、点下载直链、打开快速上手锚点。不改应用、不加跟踪、不改供应商选择。老用户升级：不适用，不碰项目数据。量具：`node tests/ux/marketing-home.static.mjs` 与 `node scripts/check-site-locales.mjs`。未验证：缺 GitHub Traffic 时间序列。
- ★2：介绍文案的 owner 是 `README.md` / `README.zh-CN.md` 与 `scripts/marketing/content.mjs`；`marketing/index.html` 与 `marketing/en/index.html` 是同一组 title/description 的生成结果。不新增运行时状态。GitHub About 不在 git 里，这次没有写成第二份生效配置。
- ★3：沿用 2026-09-27 宣传片与静态站（`docs/plan/2026-09-27-promo-0.22-site-readme.md`），不重做站点。三条路里选「改现有文案」：换生成器或删首页都会把可见口号和 sitemap 一起掀掉。价格倍数和 MCP 个数这两句删掉，是因为这次对不上源码，不是换产品方向。
- ★4：空：README 仍有首屏，没有空白着陆页。加载：静态文件，无加载态。成功：标题含开源与 AI 视频，下载表仍指向三个现有安装包。失败：直链 404 或文案又写成绝对的 no telemetry。取消中 / 过期：不适用，没有交互任务。能力不可用：没有新宣传片时仍播放并标明 0.22，下一步是下载最新安装包。
- ★9：自验命令见上。反例：About 仍写 No telemetry；topics 仍是 offline 且没有 video-editor；首页 H1 被改掉；robots 被改成 Disallow；sitemap 被手改后与页面不一致；README 丢失未签名提示、赞助披露或夸克镜像。回滚：revert 这个提交。官网要等含此提交的 main 被另行部署后，线上 title 才会变；本 PR 不部署。

### 功能分类

- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [ ] 新增功能 / 性能
