# pi 包生态调研（2026-09-07）

> 状态：📎 交接/日志 —— **只调研不改码，一行产品代码未动。**
> 日期：2026-09-07 · 基线：`origin/main@620b658cb` · 依赖：`@earendil-works/pi-{coding-agent,agent-core,ai}@0.85.1`（`package.json:202-204` 已锁精确版本）
> 服务对象：[`docs/plan/2026-09-07-agent-runtime-rebuild.md`](../plan/2026-09-07-agent-runtime-rebuild.md)（Agent 运行时重做）的阶段 3 / 阶段 5，以及 [`docs/research/2026-09-07-pi-reference-implementation-conformance.md`](2026-09-07-pi-reference-implementation-conformance.md)（参考实现逐层对照）留下的层 7「扩展 API」缺口
> 起因：2026-09-07 用户原话 —— **「有调查 pi agent package 吗，类似他们的生态，可能对我们有帮助」**

---

## 0. 一句话先答

pi 的「包」= **一个 npm/git 包，用 `package.json` 里的 `pi` 键声明四类资源（extensions / skills / prompts / themes），`pi install` 装进 `~/.pi/agent/` 或 `.pi/`，装完那段代码就以你的完整系统权限跑**。生态是真的：npm 上带 `pi-package` 关键字的包**实测 5 250 个**，其中 **2 791 个是 2026-08 一个月里冒出来的**，官方目录分页到第 106 页。

对 Nomi 的三句判断（详见 §5–§6）：**扩展一个都不装**（它把「任意代码 + 完整系统权限」引进一个握着用户密钥和钱包的桌面应用）；**技能格式该换 owner**（pi / Claude Code / Codex 三家已经收敛到 Agent Skills 标准的单文件 frontmatter，我们还在维护第二份 `skill.json`）；**「发」的最短路不是发包，是给 MCP 补一个 pi 客户端档**——半天的事，而且和现有 MCP 完全同源。

---

## 1. 方法与证据边界

**读的是什么**：① `node_modules/@earendil-works/pi-coding-agent@0.85.1` 的编译产物 `.js`/`.d.ts` + 随包 `docs/`（33 篇）+ `examples/`（79 个示例扩展、13 个 SDK 示例、1 个 plugin 示例）；② npm registry 与 downloads API 实测；③ `https://pi.dev/packages` 官方目录页实抓 HTML；④ TikHub 三组关键词（见 §7）。

**引用格式**：`node_modules/@earendil-works/` 下的一律相对该目录（例：`pi-coding-agent/docs/packages.md:63`）；仓库侧一律相对仓库根；外部给完整 URL。

**数字怎么来的（可复核）**：`https://registry.npmjs.org/-/v1/search?text=keywords:pi-package&size=250&from=0…5000` 共 20 次请求、按包名去重得 **5 250**。npm search 自报的 `total: 9267` 是相关度分页的模糊值，**不作数**——但抽查 `from=0/200/1000/4000` 四页，返回的 20/100 条 **100% 真的带 `pi-package` 关键字**，所以「几千个」这个量级是硬的，只有精确到个位数的那个 9267 不可信。

**没查成的，明着标**：

| 没查成的 | 为什么 |
|---|---|
| `pi.dev/packages` 的**逐条**清单与 5 250 的差集 | 只抓了第 1 页与第 106 页确认分页边界（`?page=106` 是最后一页），没有逐页抓 106 页 |
| GitHub topic 计数 | `api.github.com/search/repositories?q=topic:pi-package` 自报 `total_count: 1002`，但 search API 本身只允许翻前 1000 条，无法自证；**且 star 数在这个生态里不可信**——`mksglu/context-mode` 直连仓库 API 是 20 492 star 而周下载只有 17 960，另有若干两三个月新仓带着 1 900–4 500 的整数 star。**本文一律用 npm 下载量，不用 star** |
| 「Oh My Pi」发行版（`@oh-my-pi/*`，核心分发 113 949/wk）的源仓库 | 猜 `github.com/oh-my-pi/pi` 是 404，没找到真实 org |
| Discord（`https://discord.com/invite/3cU7Bz4UPx`，从主仓 README 链出）里的讨论 | 没加入，未取样 |
| 下载量的时间窗 | `api.npmjs.org/downloads/point/last-week/*` 当天返回的是 **2026-08-23 → 08-29** 那一周，不是最近 7 天。所有下载数字都指这一周 |

---

## 2. 包系统本身

### 2.1 清单格式与「一个包能装什么」

| 问 | 答 | 出处 |
|---|---|---|
| 清单在哪 | `package.json` 的 **`pi` 键**，四个可选字符串数组：`extensions` / `skills` / `prompts` / `themes` | `pi-coding-agent/dist/core/pi-manifest.d.ts:1-7`（`PiManifest` 接口 + `readPiManifest`）；文档 `pi-coding-agent/docs/packages.md:118-131` |
| 没有清单呢 | 按约定目录自动发现：`extensions/`（`.ts`/`.js`）、`skills/`（递归找 `SKILL.md` 目录 + 顶层 `.md`）、`prompts/`（`.md`）、`themes/`（`.json`） | `pi-coding-agent/docs/packages.md:158-166` |
| 路径写法 | 相对包根；支持 glob 与 `!排除`；正向 glob 只发现可见路径、点开头的要显式列；glob 不穿符号链接 | `pi-coding-agent/docs/packages.md:133` |
| 怎么被发现 | `keywords` 里加 `pi-package` 才进[官方目录](https://pi.dev/packages)；可另加 `video`（仅 MP4，hover 自动播）/ `image` 做预览图 | `pi-coding-agent/docs/packages.md:118`、`:135-154` |
| **包里没有的东西** | **工具**。四类资源里没有「tool」——工具是 extension 在运行时用 `pi.registerTool({name,label,description,promptSnippet,promptGuidelines,parameters,execute})` 注册出来的 | 示例 `pi-coding-agent/examples/extensions/dynamic-tools.ts:32-40`；API 文档 `pi-coding-agent/docs/extensions.md:1365`（`pi.registerTool`） |

**这一格的含义**：`pi install` 装的不是数据，**是一段会在你机器上执行的 Node 代码**。文档在三个地方用红字说同一句话：包以完整系统权限运行、扩展执行任意代码、技能可以指使模型运行任何东西（`pi-coding-agent/docs/packages.md:20`、`docs/extensions.md:111`、`docs/skills.md:22`）。这是后面所有判断的地基。

### 2.2 源、作用域、版本锁

| 维度 | pi 怎么做 | 出处 |
|---|---|---|
| 三种源 | `npm:@scope/pkg@1.2.3` / `git:github.com/user/repo@v1`（含 `ssh://`、`git@host:path`、裸 `https://`）/ 本地绝对或相对路径（**不复制，直接登记**） | `pi-coding-agent/docs/packages.md:52-114` |
| 全局 vs 项目 | 默认写用户设置 `~/.pi/agent/settings.json`，装到 `~/.pi/agent/{npm,git}/`；`-l` 写项目 `.pi/settings.json`，装到 `.pi/{npm,git}/` | `pi-coding-agent/docs/packages.md:43`、`:64-65`、`:92` |
| 团队分发 | 项目 settings 可以随仓库提交；**项目被信任之后 pi 启动时自动补装缺的包** | `pi-coding-agent/docs/packages.md:43` |
| 试用不安装 | `pi -e npm:@foo/bar` 装进临时目录，只对本次运行有效（scope 标 `temporary`） | `pi-coding-agent/docs/packages.md:45-50`；`dist/core/package-manager.d.ts:73` |
| **版本锁在哪** | **锁在 source 字符串本身**：带版本的 npm spec 与带 `@ref` 的 git 源都算 pinned，`pi update --extensions` / `--all` **跳过它们**；换版本要重新 `pi install …@新版` | `pi-coding-agent/docs/packages.md:63`、`:90-91` |
| 更新判据 | 读装好的 `package.json` 版本，与 registry 最新比 `gt(target, installed)`；查不到版本就**默认更新** | `pi-coding-agent/dist/core/package-manager.js:894-907` |
| **完整性 / 签名** | **没有。** `dist/core/package-manager.js` 全文 `integrity\|checksum\|signature\|verify` 零命中；唯一的 `createHash("sha256")` 用于给临时目录取名 | `pi-coding-agent/dist/core/package-manager.js:1771-1775` |
| 依赖纪律 | 运行时依赖进 `dependencies`（git 包按 `npm install --omit=dev` 装）；引用 pi 自家包（`pi-ai`/`pi-agent-core`/`pi-coding-agent`/`pi-tui`/`typebox`）必须写 `peerDependencies: "*"` 且不许打包；引用**别的 pi 包**必须 `bundledDependencies` 打进 tarball 并走 `node_modules/` 路径——**pi 用独立 module root 加载每个包，所以两个包各自装的同名依赖不会串** | `pi-coding-agent/docs/packages.md:167-188` |

### 2.3 加载顺序、过滤、去重

- **顺序即优先级**：扩展按解析出的路径顺序装载（`dist/core/resource-loader.js:447-452`），名字冲突（同名工具/命令/flag）**不报错、只记一条诊断**，"precedence is handled by load order"（`:461` 注释原文）。
- **CLI 临时包排在 settings 包之前**：`mergePaths(cliEnabled, settingsEnabled)`（`dist/core/resource-loader.js:317-319`）。
- **过滤器只收不放**：settings 里的对象形式支持 `["extensions/*.ts", "!extensions/legacy.ts"]`、`+精确路径`（强收）、`-精确路径`（强排）、`[]`（一个都不要）；文档明写 "Filters layer on top of the manifest. They narrow down what is already allowed."（`pi-coding-agent/docs/packages.md:190-216`）——**过滤器永远不能扩大包自己声明的面**。
- **去重与身份**：同一个包在全局与项目都出现时，**项目条目胜出**；若项目条目写了 `autoload:false`，它就当成叠在全局条目上的 delta。身份判据：npm 看包名、git 看去掉 ref 的仓库 URL、本地看解析后的绝对路径（`pi-coding-agent/docs/packages.md:222-227`）。
- **开关**：`pi config` 逐条启用/停用扩展、技能、提示模板、主题；Tab 在全局与项目之间切；`pi config -l` 从项目覆盖开始、继承的全局项灰显（`pi-coding-agent/docs/packages.md:218-220`）。停用的条目在 `ResolvedResource.enabled=false`，加载时被过滤掉（`dist/core/resource-loader.js:287-295`）。

### 2.4 `DefaultResourceLoader` 怎么发现它们

`DefaultResourceLoader` 内部持有一个 `packageManager`（`pi-coding-agent/dist/core/resource-loader.d.ts:120-125`）。链路是：

1. `PackageManager.resolve()` → `ResolvedPaths { extensions, skills, prompts, themes }`，**每条路径都带 `PathMetadata { source, scope: "user"|"project"|"temporary", origin: "package"|"top-level", baseDir }`**（`dist/core/package-manager.d.ts:2-18`、`:39-40`）。元数据是后面一切（诊断、去重、显示来源）的依据。
2. loader 把 `enabled` 的挑出来、记住每条的 metadata（`dist/core/resource-loader.js:287-296`），再合并 CLI 临时路径。
3. **启动之后还能再加**：`resources_discover` 事件（`dist/core/extensions/types.d.ts:403-411`，`reason: "startup"|"reload"`）允许任一扩展返回 `{ skillPaths, promptPaths, themePaths }` 动态补路径；`extendResources()` 把它们并进来（`dist/core/resource-loader.d.ts:57`）。官方示例只有 8 行：`pi-coding-agent/examples/extensions/dynamic-resources/index.ts:7-14`。
   > **这一条对 Nomi 直接有用**：技能不必躺在磁盘固定位置也能被发现——正是「skill hub / 运行时决定给哪些技能」需要的孔。

### 2.5 信任与安全模型

| 问 | 答 | 出处 |
|---|---|---|
| 什么时候问 | 只有当 cwd 下**确实存在需要信任的项目资源**时才问（`.pi/` 里的受信项 或 cwd/祖先目录的 `.agents/skills`）；没有就直接 `true` | `pi-coding-agent/dist/core/trust-manager.d.ts:20-27`、`dist/core/project-trust.js:21-23` |
| 谁能抢答 | 扩展的 `project_trust` 事件**先于**存储与 UI，返回 `{trusted, remember}` 即定夺 | `pi-coding-agent/dist/core/project-trust.js:24-36` |
| 存哪、继承吗 | `~/.pi/agent/trust.json`；**向上继承**（选项里可以「信任父目录」，`getProjectTrustParentPath`） | `dist/core/trust-manager.d.ts:16-19`、`:28-35` |
| 默认档 | `defaultProjectTrust: "always" \| "never" \| "ask"`（默认 ask） | `dist/core/project-trust.js:41-48` |
| **无 UI 怎么办** | **fail-closed 到 `false`** | `dist/core/project-trust.js:49-51` |
| 装包也归它管 | `install` / `remove` 在动项目作用域之前先 `assertProjectTrustedForScope(scope)` | `dist/core/package-manager.js:767`、`:794` |
| 路径包容 | 安装根做**前缀断言**：解析后不在根下就 `Refusing to use path outside package install root` 抛错 | `dist/core/package-manager.js:1778-1784` |
| **trust 不管什么** | 不管加载之后能干什么。信任只决定「加不加载项目本地配置与包」，**不是沙箱**；`AGENTS.md`/`CLAUDE.md` 无论信不信任都加载 | `pi.dev/docs/latest/security`（随包同文 `pi-coding-agent/docs/security.md`），本仓已在 [conformance §9.1](2026-09-07-pi-reference-implementation-conformance.md) 记过 |

### 2.6 技能格式：pi 采用的是行业标准，不是自家格式

- pi 明写实现 **[Agent Skills 标准](https://agentskills.io/specification)**，"warning about most violations but remaining lenient"，唯一有意偏离是**不要求 `name` 与父目录同名**（理由：多 harness 共享技能目录时那条规则不合适）——`pi-coding-agent/docs/skills.md:7`、`:141`。
- frontmatter 七个字段：`name`(必) `description`(必) `license` `compatibility` `metadata`（**任意键值**）`allowed-tools` `disable-model-invocation` —— `pi-coding-agent/docs/skills.md:135-146`。
- **它直接吃别家的技能目录**：文档给的例子就是把 `~/.claude/skills` 和 `~/.codex/skills` 写进 settings —— `pi-coding-agent/docs/skills.md:47-58`。
- 技能怎么到模型：启动时只扫 name+description 进系统提示词（XML 格式，按标准），正文靠模型自己用 `read` 加载；文档自陈 **"models don't always do this"** —— `pi-coding-agent/docs/skills.md:66-72`。

---

## 3. 社区生态实况

### 3.1 规模（2026-09-07 实测）

| 指标 | 数字 | 怎么量的 |
|---|---|---|
| npm 带 `pi-package` 关键字的包 | **5 250**（去重后实数） | registry search 分页 `from=0…5000, size=250`，20 次请求按包名去重 |
| npm search 自报 total | 9 267（**模糊值，不作数**） | 同上；抽查四页命中率 100%，但无法分页自证到 9 267 |
| 官方目录 `pi.dev/packages` | 分页到**第 106 页**（末页 21 条），量级与 5 250 一致 | 实抓 HTML，`?page=106` 是最后一个分页链接 |
| **月度新增/更新分布** | 2026-03: 63 · 04: 104 · 05: 258 · 06: 234 · **07: 712 · 08: 2 791 · 09（前 7 天）: 1 062** | 上述语料的 `date` 字段直方图 |
| 主仓 `earendil-works/pi` | 102 408 star，最后 push 2026-09-06 | `api.github.com/repos/earendil-works/pi` 直读 |
| 社区入口 | Discord `https://discord.com/invite/3cU7Bz4UPx`（主仓 README 链出）；官方目录页 `https://pi.dev/packages` | 见 §1「没查成」 |

**读法**：这不是一个成熟生态，是一个**两个月内炸开的生态**——8 月一个月的量是 3–6 月总和的 4 倍。对我们的意思有两面：一面是「这里有真实的人在解决和我们一样的问题」，另一面是「这批包的中位质量与存活期都未经时间检验」，**不能因为下载量高就当依赖**。

### 3.2 下载量前 15（窗口 2026-08-23 → 08-29）

> 只列能在 npm downloads API 上直接核到数字的。**不用 star**（§1 已说明理由）。

| # | 包 | 做什么 | 周下载 | 与 Nomi 的关系 |
|---|---|---|---|---|
| 1 | [`pi-mcp-adapter`](https://www.npmjs.com/package/pi-mcp-adapter) | 给 pi 接 MCP 服务器；读标准 `.mcp.json` / `~/.config/mcp/mcp.json`；**一个代理工具（~200 token）代替上百个工具定义**，服务器按需冷启 | **252 501** | ⭐ 直接相关：pi 用户接 Nomi 的现成通道；`pi` 清单见 registry：`{extensions:['./index.ts'], skills:['./skills'], video:…}` |
| 2 | [`pi-web-access`](https://www.npmjs.com/package/pi-web-access) | 网页搜索 / 抓取 / 克隆仓库 / PDF 抽取 / **YouTube 视频理解** | 132 228 | 视频**理解**不是生成 |
| 3 | [`@companion-ai/feynman`](https://www.npmjs.com/package/@companion-ai/feynman) | 基于 pi 的 research-first CLI | 125 554 | 无 |
| 4 | [`pi-subagents`](https://www.npmjs.com/package/pi-subagents) | 子 agent 派工 / 可脚本化多 agent 工作流 | 122 432 | 与 R27 编排手册同题，可读设计 |
| 5 | [`@oh-my-pi/pi-coding-agent`](https://www.npmjs.com/package/@oh-my-pi/pi-coding-agent) | 社区发行版对核心 CLI 的再分发 | 113 949 | 无（源仓未找到，见 §1） |
| 6 | [`@oh-my-pi/pi-natives`](https://www.npmjs.com/package/@oh-my-pi/pi-natives) | Rust 原生绑定（PDF/音频/图像处理、PTY、剪贴板） | 95 757 | 媒体处理放原生层，思路可参考 |
| 7 | [`billion-context`](https://www.npmjs.com/package/billion-context) | 上下文压缩代理 | 32 514 | 与压缩层同题 |
| 8 | [`pi-background-tasks`](https://www.npmjs.com/package/pi-background-tasks) | 持久后台任务 / 只读委派 agent | 26 575 | 与「生成跑几十分钟」同题 |
| 9 | [`pi-goal-x`](https://www.npmjs.com/package/pi-goal-x) | 长目标持续推进 | 20 787 | 无 |
| 10 | [`pi-lens`](https://www.npmjs.com/package/pi-lens) | 实时代码反馈 | 19 100 | 无 |
| 11 | [`context-mode`](https://www.npmjs.com/package/context-mode) | 上下文压缩 MCP 插件 | 17 960 | star 数异常，见 §1 |
| 12 | [`bigpowers`](https://www.npmjs.com/package/bigpowers) | **73 个 agent skills 的技能包** | 17 545 | ⭐ 技能包这条分发路子的样板 |
| 13 | [`pi-memory`](https://www.npmjs.com/package/pi-memory) | 语义检索记忆扩展 | 11 145 | 无 |
| 14 | [`@gotgenes/pi-permission-system`](https://www.npmjs.com/package/@gotgenes/pi-permission-system) | 权限执行扩展 | 8 568 | ⭐ 与 K2 审批同题 |
| 15 | [`pi-web-ui`](https://www.npmjs.com/package/pi-web-ui) | 给 pi 套 Web 聊天界面 | ~6 241 | 「外部宿主给 pi 换壳」的对照 |

### 3.3 按 Nomi 关心的六类分桶（对 5 250 条语料做名称+描述正则分类）

| 类 | 命中数 | 头部与最相关的 |
|---|---|---|
| **MCP 桥** | 172 | `pi-mcp-adapter` 252 501/wk（全生态第一）；`@nklisch/pi-mcp-adapter` 879/wk（"independently maintained MCP client with a programmatic source lifecycle"）；`@agimon-ai/doompi-mcp`（按域收窄 MCP 服务器可见面） |
| **技能包** | 458 | `bigpowers` 17 545/wk（73 skills）；`@getpipher/keystone`（"anti-AI-slop design skill with an executable gate engine"）；`@agimon-ai/doompi-skill`（技能目录 + 延迟发现 + 技能浏览器） |
| **审批 / 权限 / 沙箱** | 170 | `@zhushanwen/pi-permission` 269/wk（yolo/auto/approve/strict 四档 + 三层）；`@georgedong32/permission-modes` 80/wk（Claude Code 风格 ask/plan/auto）；`@agimon-ai/doompi-sandbox`（Docker 里跑 agent+扩展+工具）；`@amaster.ai/pi-security`（资源感知的工具授权策略引擎）；`@agentapprove/pi`（**在 iPhone / Apple Watch 上批准或拒绝工具调用**，91/wk） |
| **UI / TUI / 面板** | 312 | `@zhuxixi/pi-agent-board`（派工/监控/peek-reply/attach 的 agent 看板）；`@tt-a1i/openpi`（多 agent 工作台）；`pi-cockpit`、`pi-sidebar-tui` |
| **花费 / 用量** | 245 | `@robhowley/pi-openrouter`（实时 spend 覆盖层）；`@sreetej510/pi-usage`、`@alexanderfortin/pi-usage-lib`（**共享用量库**——生态自己长出了「用量」这层的公共抽象） |
| **图像 / 视频** | 125（其中真做视频生成的 ≤6） | `@amaster.ai/pi-image-gen` **2 830/wk**（gpt-image / Nano Banana / Qwen-Image）；`@amaster.ai/pi-video-gen` **1 225/wk**（AI 视频生成 + 本地合成：无损拼接、图视混排）；`@speclip/pi-media` **894/wk**（workspace-safe 媒体分析/编辑/渲染/审阅/素材库）；`@speclip/pi-talking-head` **962/wk**（口播剪辑 + B-roll 规划，**导出通用 `pi-media` EDL**）；`pi-comfyui-paint` 38/wk；`kling-ai-pi` 39/wk（可灵，带 OAuth 与中国/全球区） |

**这张表里最该被注意到的一行不是最大的那行，是 `@speclip/*`**：有人已经在 pi 上做「口播剪辑 + B-roll」，而且**在定义一个跨包的 EDL 交换格式**。它周下载不到一千，但它说明 pi 生态里正在自发长出**视频创作的中间层契约**。Nomi 在这条线上是有护城河的（画布/分镜/参考槽/时间轴是我们的领域资产），但**格式话语权是先到先得的**——这一条应该进模型雷达同款的定期观察，不是一次性结论。

---

## 4. 「借」：哪些可以拿进来，格式的唯一 owner 该是谁

### 4.1 判断：**代码一行不借；格式借，而且要借成唯一 owner**

**为什么代码不借（R20 + R28）**：pi 包 = 任意代码 + 完整系统权限（`pi-coding-agent/docs/packages.md:20`）。pi 是一个**信任本机用户的本地 CLI**；Nomi 是**打包桌面应用 + MCP 宿主 + 握着用户加密密钥存储 + 会花用户真钱**。把一个 5 250 包、中位年龄两个月、无签名无完整性校验（§2.2）的生态接进这样的进程，是把别人的威胁模型搬进我们家。

而且我们**已经**在这条线上做对了，不能为了「借」拆掉它：Nomi 的技能包导入器只收 `md|markdown|json|txt|ya?ml|csv`，`scripts/` `bin/` `hooks/` 显式识别为「可执行区」并跳过，还留了人话理由让 UI 诚实告诉用户跳过了什么（`electron/skills/skillPackage.ts:27-35`、`:43-47`）。这比 pi 严，是对的，保持。

### 4.2 格式：Nomi 现在有两份，pi/Claude Code/Codex 已经收敛成一份

| | Nomi | pi（= Agent Skills 标准） |
|---|---|---|
| 必需面 | 目录 + `SKILL.md`；**另有可选 `skill.json` 清单**（33 个内置技能里 9 个带） | 目录 + `SKILL.md`，**只有 frontmatter**，无第二份文件 |
| 权威 schema | `electron/skills/skillManifestSchema.ts:91-128`（`name/version/description/audience?/selectableInWorkbench?/requestedCapabilities?/tools/requiredProviders/permissions/inputs?/examples?/stages?`） | `pi-coding-agent/docs/skills.md:135-146`（`name/description/license?/compatibility?/metadata?/allowed-tools?/disable-model-invocation?`） |
| 没有 `skill.json` 时 | 退回正则读 frontmatter，只认 `name` / `description` / `disable-model-invocation` / `audience`（`electron/skills/skillStore.ts:89-111`）；清单存在时清单胜出（`:203-213`） | 只有这一条路 |
| 发现规则 | 只认 `<root>/<dir>/SKILL.md`，不递归、不收散落 `.md`（`electron/skills/skillStore.ts:136-220`） | 递归找 `SKILL.md`，另按位置决定收不收顶层 `.md`（`pi-coding-agent/docs/skills.md:36-41`） |
| 完整性 | 顺序无关的 SHA-256 覆盖整个文件映射，读取时比对不上就返回 null（`electron/skills/skillPackage.ts:82-91`、`skillStore.ts:336-338`） | 无 |
| 跨 harness | 无 | **文档直接教你把 `~/.claude/skills` / `~/.codex/skills` 挂进来**（`pi-coding-agent/docs/skills.md:47-58`） |

**结论（P1「一份格式」+ P4「通用第一」）：让 frontmatter 成为唯一必需面，`skill.json` 降级成可选扩展块。** 落地形状是现成的——标准的 `metadata` 就是**任意键值**（`pi-coding-agent/docs/skills.md:141`），Nomi 独有的 `requestedCapabilities` / `stages` / `audience` 全部塞进 `metadata.nomi.*` 即可，schema 与授权语义一个字不用改（`requestedCapabilities` 只能收窄能力天花板这条铁律在 `electron/harness/agentChatPolicy.ts:101-103`、`:206-208`，与格式无关）。

**为什么值得做，用大白话（D6）**：今天用户在 Claude Code 里攒了一堆技能目录，想在 Nomi 里用，得**重打一个包**；换过来也一样。改完之后是「把目录拖进来就能用」。这不是为了兼容 pi——是因为 pi、Claude Code、Codex **已经是同一个格式**，我们是唯一那个多一份文件的人。**真实摩擦在这里，不在 pi。**

### 4.3 可以借的三样设计（只读，不装）

| 借什么 | 出处 | 对 Nomi 的用法 |
|---|---|---|
| **「一个代理工具代替上百个工具定义」** | `pi-mcp-adapter` README（registry 上 2.32.1，2026-09-01）：一个 proxy 工具约 200 token，模型按需发现，服务器用到才起 | 直接打在重做方案 **S7（任一 profile ≤12 工具、schema ≤4 000 token）** 上：production profile 今天 30 个工具 / 12 641 token（方案 §3.2）。静态合并很可能压不到 12——这是 conformance **G-09**（`addedToolNames` 动态装载）之外的第二条现成解法 |
| **`tool_call → {block, reason}` 的最小形状** | `pi-coding-agent/examples/extensions/permission-gate.ts:13-33`：命中危险模式 → 有 UI 就问、**无 UI 直接 block**，`reason` 成为模型看到的正文 | 正是 K2 审批要挂的孔（方案已选对 `before_tool`）。这 34 行是官方给的最短参考实现，值得在阶段 3 开工前逐行对一遍 |
| **通用媒体 EDL 交换格式** | `@speclip/pi-talking-head`（962/wk）自陈"exported as generic `pi-media` EDLs" | 不是抄它的格式，是**知道有人在抢这个位置**。Nomi 的时间轴/分镜是领域资产，导出面该按「别人能读」设计（对照 K5 时间轴的 16 内部工具 vs MCP 1 个） |

---

## 5. 「发」：Nomi 能不能作为 pi 包发布

### 5.1 先把事实摆清楚

1. **pi 没有内置 MCP。** 文档原话：*"It intentionally does not include built-in MCP, sub-agents, permission popups, plan mode, to-dos, or background bash. You can build or install those workflows as extensions or packages"*（`pi-coding-agent/docs/usage.md:309`）。
2. **但生态补上了，而且是全生态第一。** `pi-mcp-adapter` 252 501/wk，**自动读标准 `.mcp.json` 与 `~/.config/mcp/mcp.json`**，无需额外配置。
3. **Nomi 的一键接入今天不覆盖 pi。** 固定客户端档只有三个：`~/.claude.json`、`~/.cursor/mcp.json`、`~/.codex/config.toml`（`electron/capabilityCore/mcpConfig.ts:56-60`）。**但客户端身份早已从三值泛化成可注册的 profile**（名字 + 配置路径 + 格式，`mcpConfig.ts:104-126` 的 `listCustomMcpProfiles` / `registerCustomMcpProfile`），另有「复制配置」兜底（`mcpConfig.ts:277-279`，UI 在 `src/ui/onboarding/ConnectAssistantCard.tsx:174`）。
4. **Nomi 仓库现在 `private: true`**（`package.json`），要发 npm 包必须单开一个可发布的产物，不是给主包加个字段。

### 5.2 四条路的结构对比

| 路子 | 用户看到什么 | 代价 | 和 MCP 的关系 | 判断 |
|---|---|---|---|---|
| **① 什么都不做（今天）** | pi 用户先 `pi install npm:pi-mcp-adapter`，再**手抄**一段 JSON 进 `.mcp.json`。Nomi 的一键写入帮不上他 | 0 | 同源，但缺门牌 | 摩擦在「手抄」这一步，可以消掉 |
| **② 给 MCP 一键接入加一个 pi 客户端档** | 「接入 AI 编程助手」卡片里多一个 pi；点一下，Nomi 写 `.mcp.json`（项目级）或 `~/.config/mcp/mcp.json`（全局），pi 侧只需装那个 252k/wk 的 adapter | **≈ 半天**：内置客户端档表在 `mcpConfig.ts:56-60`（今天三个），加第四条即可；写入侧 `:246-258` 的 merge / `.nomi-backup` / 原子改名一行不用改；另有已就绪的自定义档注册机制 `:104-126` 可先用它验一遍。剩下是 i18n 文案与一次走查 | **完全同源**。不新增任何契约、不新增任何可执行面 | ✅ **做。这就是「比 MCP 更短的路」的正确读法——不是绕开 MCP，是给它补一个门牌** |
| **③ 发 skills-only 的 pi 包（`pi install npm:@nomi/pi-skills`）** | 一行命令，pi 的模型立刻知道「分镜怎么拆、镜头提示词怎么写、什么时候该调哪个 `nomi_*` 工具」 | 一个可发布子包 + 发布流程 + 双语技能正文；**零可执行代码**（`pi.skills` 只指向 `.md`），零新增攻击面 | 它**教模型怎么用 ② 装好的工具**，是说明书不是第二条通路 | 🟡 **值得做，但要用户拍板**（见 §7） |
| **④ 发 extension 包，自己注册 `nomi_*` 工具绕过 MCP** | 表面上少装一个 adapter | 工具契约立刻有**两个 owner**（`mcpCapabilityProjection.ts` 的投影 + pi extension 里手写的一份）；并把 Nomi 的发布节奏耦合进 pi 的版本节奏 | **和 MCP 重复** | ❌ **不做。** 这是 P1 的并行版，也正是 #546「同一语义两份定义」的复发形状；上游 0.85.0 误发布内部实验代码直接搞坏 SDK 导入（conformance §3 坑 3）已经证明这条耦合的成本 |

### 5.3 为什么 ③ 是「技能包」而不是「扩展包」

pi 包的四类资源里，**只有 skills 是纯数据**（`.md`），其余三类都要么是代码（extensions）要么要进 pi 的渲染层（themes/prompts）。发 skills 意味着：我们发出去的东西**在别人机器上不执行**，出了问题最坏是模型被误导，不是任意代码执行。这和我们自己对导入技能的要求（`electron/skills/skillPackage.ts:27-35` 拒可执行）是**同一条纪律的两个方向**——对内不收可执行，对外不发可执行。

对照生态样板：`bigpowers`（73 skills，17 545/wk）证明纯技能包这条分发路子在 pi 生态里跑得通。

---

## 6. 「学」：R29 三档判定

> 三档：`一致` / `有意不同(理由必须是领域约束)` / `没想到`（`没想到` 必须标「补在哪个阶段前」）。对照对象是**重做方案的阶段 3（工具契约与扩展 API）与阶段 5（内外同源）**。

| # | 机制 | pi 怎么做 | 我们怎么做 | 判定 | 补在哪个阶段前 |
|---|---|---|---|---|---|
| **P-1** | **资源发现是事件驱动的，不是路径写死的** | `resources_discover`（`dist/core/extensions/types.d.ts:403-411`）在 session_start 之后触发，任一扩展可返回 `{skillPaths,promptPaths,themePaths}`；`extendResources()` 并入（`dist/core/resource-loader.d.ts:57`） | 技能根路径写死在 `electron/runtimePaths.ts:57-67`（六个固定根，用户根排最后防遮蔽）；`electron/harness/runtime/pi/resources.mts:13-27` 是**全空 loader** | **没想到** | **阶段 5 之前。** 不是要改成 pi 的实现（空 loader 是有意的，见 P-2），而是**我们自己那一层缺同款接缝**：技能一旦不都在磁盘上（skill hub 是已定方向），「哪些技能可见」就是运行时判断，而今天它是六个常量。补法：让 `formatNomiSkillIndex`（`electron/harness/skillIndex.ts:22-53`）的输入来自一个可注入的 provider，而不是直接读 `skillStore` |
| **P-2** | **空 ResourceLoader** | pi 默认加载项目本地 `.pi/*` 与 `AGENTS.md` | 全空（`electron/harness/runtime/pi/resources.mts:13-27`），理由写在 `:3-12` | **有意不同（领域约束）** | — 已在 `docs/engineering/framework-boundaries.json:158-165` 登记成有意隔离决定 + 债；conformance D-05 亦记 |
| **P-3** | **信任决策向上继承，且无 UI 时 fail-closed** | `getProjectTrustParentPath`（`dist/core/trust-manager.d.ts:16`）；`hasUI === false → return false`（`dist/core/project-trust.js:49-51`） | Nomi 无「项目信任」概念（我们的项目是自己创建的创作项目）；但**导入的技能一律强制 `audience:"internal"`，不管清单声称什么**（`electron/skills/skillStore.ts:212-213`） | **一致（同一条 fail-closed 纪律，落在不同对象上）** | — |
| **P-4** | **版本锁锁在 source 字符串里，pinned 的更新时跳过** | `npm:@foo/bar@1.2.3` 与 `git:…@ref` 都算 pinned（`docs/packages.md:63`、`:90`）；换版本要显式重装 | Nomi 技能包的 `version` 是自由字符串、无 semver 校验（`electron/skills/skillManifestSchema.ts:94-95`）；包封套版本是单一常量、不匹配硬拒（`skillPackage.ts:13`、`:122-124`） | **有意不同（领域约束：我们的技能不从网上更新，只有本地导入）** | — 但见 P-5 |
| **P-5** | **完整性校验** | **pi 没有**（`package-manager.js` 零命中；唯一 sha256 用于临时目录命名 `:1771-1775`） | **我们有**：顺序无关 SHA-256 覆盖整个文件映射，读取时 `packageVersion + contentHash` 对不上直接返回 null（`electron/skills/skillPackage.ts:82-91`、`skillStore.ts:336-338`），`load_skill` 映射成 `skill_changed_before_load`（`electron/capabilityCore/skillReadTransportAdapters.ts:76-80`） | **有意不同（我们更严）** | — **这一处别向 pi 看齐**。如果将来走 §5.3 的发布路，反过来**我们应该把 contentHash 一起发出去** |
| **P-6** | **加载顺序即优先级，冲突只记诊断不报错** | `orderedExtensions` 按路径顺序（`dist/core/resource-loader.js:447-452`）；同名冲突"Keep all extensions loaded… precedence is handled by load order"（`:461`） | 技能发现第一根胜出（`electron/skills/skillStore.ts:170-171`、`:200`），导入永不覆盖内置（改名加后缀，`skillPackage.ts:160-173`） | **一致** | — |
| **P-7** | **过滤器只能收窄，不能放宽** | `+path`/`-path`/`!glob` 层叠在 manifest 之上，文档明写"They narrow down what is already allowed"（`docs/packages.md:216`） | 同构：技能清单的 `requestedCapabilities` **只能收窄**宿主能力天花板（`electron/harness/agentChatPolicy.ts:101-103`、`:206-208`；`electron/skills/skillCapability.ts:26-42`） | **一致（而且是独立想到的同一条不变量——值得写进 ARCHITECTURE-NOW 当通用原则）** | — |
| **P-8** | **依赖纪律：核心包必须 peerDeps，别的包必须 bundled；每个包独立 module root** | `docs/packages.md:171-173` | 不适用（我们不装第三方包） | **有意不同（领域约束：不装外部代码）** | — |
| **P-9** | **安装根做路径前缀断言** | `resolveManagedPath` 解析后不在根下就抛（`package-manager.js:1778-1784`）——注意 pi 在**包路径**上做了这件事，却在**模型可达的工具路径**上一点都不做（conformance 9.3 / G-07） | 我们两边都还没有统一的 `containPath()`（conformance 已开 **S11**） | **没想到（已登记）** | **阶段 2 之前**（沿用 conformance G-07 的排期）。本次新增的只是一条证据：**pi 自己在包管理这一侧是做了包容的**，所以「上游不做」不能当作我们不做的理由 |
| **P-10** | **`pi config` 让用户逐条开关已装资源，全局/项目双层** | `docs/packages.md:218-220`；停用项在 `ResolvedResource.enabled=false` 被过滤（`resource-loader.js:287-295`） | Nomi 有 `selectableInWorkbench`（`skillManifestSchema.ts:101`）与两层 MCP 可见性（`skillStore.ts:246-263`），但**没有「用户逐条停用某个内置技能」的面** | **没想到（低优先）** | 可延后。真实摩擦要等技能数量上去才出现；今天 33 个内置技能里公开层（`audience:"mcp"`）**一个都没有**，先解决那个 |

---

## 7. 自媒体来源（TikHub）

附件：[`docs/research/2026-09-07-pi-package-ecosystem/tikhub/`](2026-09-07-pi-package-ecosystem/tikhub/) —— 三组关键词、四平台，共 80 条：

| 关键词 | 平台 | 条数 | 附件 |
|---|---|---|---|
| `pi coding agent` | 抖音 / 小红书 / B站 / X | 40 | [`tikhub/pi-coding-agent/`](2026-09-07-pi-package-ecosystem/tikhub/pi-coding-agent/tikhub-search.md) |
| `pi agent 扩展` | 抖音 / 小红书 / B站 | 24 | [`tikhub/pi-agent-extensions/`](2026-09-07-pi-package-ecosystem/tikhub/pi-agent-extensions/tikhub-search.md) |
| `pi install` | X / B站 | 16 | [`tikhub/pi-install/`](2026-09-07-pi-package-ecosystem/tikhub/pi-install/tikhub-search.md) |

**这一层给了什么别处没有的**：

1. **「装扩展」已经是中文用户的默认动作，不是极客行为。** 抖音/小红书上出现大量「给 Pi 装上这 10 个扩展能力翻倍」「9 个 Pi 扩展包｜让你的 Pi 更好用」「我的 Pi Agent 配置清单：6 个插件，够用」这类**清单式内容**（`tikhub/pi-agent-extensions/tikhub-search.md:21`、`:124`、`:151`、`:115`）。一个生态到了「有人靠推荐清单涨粉」的阶段，说明装包已经过了门槛期。
2. **自媒体里点名的包，registry 关键字搜索**未必**排在前面**——这一层补出了以下具体名字：`@tintinweb/pi-subagents`（X，作者自陈 "Dynamic Workflows … Claude Code-compatible"）、`pi-antigravity`（用 Antigravity 订阅在 pi 里跑 Gemini）、`@ff-labs/pi-fff`（FFF 模糊搜索）、mem0 的 pi 插件（跨会话语义记忆）、Neon 数据库官方发的 pi 技能包（作者原话 "It's now live in the Pi package catalog"）、`nicobailon/pi-web-access` + `pi-mcp-adapter` + `pi-powerline-footer` 三件套（B站 `tikhub/pi-install/tikhub-search.md:36`、`:54`、`:63`、`:74`、`:103`；`tikhub/pi-agent-extensions/tikhub-search.md:196`）。
3. **对「为什么是 pi」的解释在中文侧收敛得很干净**：「Pi 只有四个默认工具（读文件、写文件、改文件、运行命令），系统提示词仅一千 Token…还有极其开放的插件生态」（`tikhub/pi-agent-extensions/tikhub-search.md:214`）。另有一条把 pi 与 DeepSeek Harness 逐层对比的（`:198`、`:48`：「Pi 把扩展放在工作流附近，DeepSeek Harness 把扩展深入运行时」）——这条对我们判断「扩展 API 该开在哪一层」有参考价值。
4. **也有反面声音**：「Pi Agent，有点劝退」（`tikhub/pi-coding-agent/tikhub-search.md`，抖音 2026-09-01）；以及一条很实在的：「Pi Agent 的设计美学除了 minimal 之外，就是自己有什么需求就自己 DIY，所以我的插件不一定能适配你的需求」（`tikhub/pi-agent-extensions/tikhub-search.md:232`）。**这句话是这次调研最该记住的一句**——一个 5 250 包的生态，中位包是「作者为自己写的」，不是可依赖的组件。

**噪音说明**：`pi install` 这组混进了 Pi Network（加密货币）与 `pip install` 的无关内容，已人工剔除，未计入上面的结论。

---

## 8. 一个顺带的发现：我们已经在用一个 pi 包了，只是没走 `pi install`

`@dietrichgebert/ponytail`（npm registry 实读，latest 4.9.0）的 `keywords` 是 `["opencode-plugin","opencode","ponytail","pi-package","pi","skills","qoder"]`，`pi` 清单是 `{"extensions":["./pi-extension/index.js"],"skills":["./skills"]}` —— **它就是官方目录里的一个 pi 包**（gallery 第一页可见）。而 Nomi 的 R25 提交/推送闸调的正是它的技能面（`scripts/ponytail-review-hook.mjs:36-45`，通过宿主 skill `/ponytail-review` / `@ponytail-review` 触发，门岗 `check:ponytail-review`）。

**这条说明一件事**：同一份技能资产今天已经在**四个宿主**（pi / opencode / Claude Code / Codex）上分发，靠的就是 Agent Skills 标准那一份 frontmatter。§4.2 那个「格式换 owner」的建议不是理论——**我们自己每次 commit 都在受益于它**。

---

## 9. 我的判断（三句）

1. **现在该做**：把 **pi 加进 MCP 一键接入的客户端档**（§5.2 路子 ②，≈ 半天，`electron/capabilityCore/mcpConfig.ts:104-126` 的自定义档机制已经在，写 `.mcp.json` 即可被 252k/wk 的 `pi-mcp-adapter` 自动读到）；同时把 **技能格式的唯一 owner 定成 Agent Skills frontmatter**，`skill.json` 的 Nomi 专有字段收进标准的 `metadata`（§4.2）——这条要在重做方案**阶段 3 开工前**定下来，否则新工具契约会再绕着旧格式长一圈。
2. **不该做**：**不装任何第三方 pi extension 进 Nomi**（R20：不在护城河上；R28：把「任意代码 + 完整系统权限 + 无签名无完整性校验」引进一个握着用户密钥与钱包的桌面应用，是把防线建在最晚那层）；**不发 extension 版的 `nomi_*` 工具包**（P1 并行版，工具契约会有两个 owner，正是 #546 的复发形状）。
3. **要用户拍板的一个点**：**要不要以 `@nomi/pi-skills` 的形式，把 Nomi 的创作方法论（分镜怎么拆、镜头提示词怎么写、参考槽怎么填）做成 skills-only 的公开 npm 包发出去。** 取舍点一句话说清：**这是把我们最容易被抄的东西（方法论）免费送进一个 5 250 包的生态，换一个 `pi install` 一行的入口**——护城河在产物与工具（画布/分镜/时间轴/生成编排），不在方法论；但公开发布是不可逆的，且一旦发了就要跟着 pi 的节奏维护。**我倾向发**（成本低、零可执行面、`bigpowers` 已证明这条路走得通），但这属于「产品方向 + 不可逆」，按决策自治该停下来问。
