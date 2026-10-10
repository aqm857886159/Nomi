# 竞品学习周期报告：2026-10-10

> 状态：partial。五家官网公开入口与五组 TikHub 检索已完成；Chrome/CUA 请求头策略仍不可用，因此登录应用、真实鼠标录制、原站视频回看与生成/取消/恢复旅程未完成。

## 周期与检查点

| 字段 | 值 |
|---|---|
| cycle_id / mode | 2026-10-10 / cycle（10-11 补跑，不重置锚点） |
| schedule_anchor / scheduled_for / next_due | 2026-09-22T10:00:00+08:00 / 2026-10-10T10:00:00+08:00 / 2026-10-13T10:00:00+08:00 |
| attempted_at / completed_at | 2026-10-11T00:00:00+08:00 / 留空（partial） |
| observation_window / baseline | 官网公开页 2026-10-11；TikHub since 2026-10-07；上一成功基线 2026-10-07，登录成功基线仍无 |
| Nomi build / commit | `4e1eecdad8c3ab6a3d44d38065faeb769c613be4`（最新 origin/main，未启动应用） |
| branch / worktree / PR | `research/competitive-radar-2026-10-10` / `/Users/aoqimin/.codex/worktrees/competitive-radar-2026-10-10/Nomi` / 待创建 |
| evidence_root | `outputs/competitive-radar/2026-10-10/` |
| next_action | 恢复浏览器请求头策略后优先补 LibTV 插件/Blender、TapNow 真实生成/取消/恢复、RunningHub 工作台 |

## 本轮结论

1. LibTV 公开页已可读取：Plugin 明确给出 marketplace → `codex plugin add libtv@libtv` → 新建任务授权三步，并列出 OpenAI、Claude、Claude Code、OpenClaw、Hermes、CodeBuddy 等宿主；Blender 页的标题/描述承诺“在 Blender 内完成白模视频，一键导出到 LibTV 创作成片”。这些是官方声明，尚未完成安装、授权或结果回流验证。
2. TapNow 官网把产品实体定义为面向创作者和团队的 Creative OS / AI Agents 编排层，官方结构化数据反链到 `app.tapnow.ai/home`、X、YouTube、TikTok、Discord、Instagram；本轮未能进入登录应用。不能把官网的“Agent/社区”文案当作真实生成成功。
3. Higgsfield 首页把 MCP、API、ChatGPT Plugin、AI Influencer、Ads/Cinema Studio、Supercomputer、Community、Plugins 并列；MiniMax Design 首页把“Brief → Planning → Agents → Output”写成五步生产链，强调本地资产中心与可复用 Skills；RunningHub 首页同时承诺原生 Agent、ComfyUI、无限画布、AI Apps、模型 API，并展示 Blender Plugin Upgrade。均为公开页声明，登录工作流与插件首次成功未验证。

## 五家 × 来源覆盖矩阵

状态：`checked`=本轮直接读取；`partial`=只有公开声明/上次登录证据；`unverified`=本轮没拿到可靠来源；TikHub 结果仅作发现，不等于官方身份。

| 对象 | 官方更新 | 新手教程 | 官网具体页 | 登录应用 | 官方社媒 | 社区 | 深挖/缺口 |
|---|---|---|---|---|---|---|---|
| LibTV | unverified | partial（Plugin 使用指南链接可见，未跑） | checked（Plugin、Blender） | unverified（Chrome 策略阻断） | unverified | partial（TikHub 40，身份未全核） | 插件安装、授权、Blender、生成回流均未验证 |
| TapNow | unverified | partial（首页/产品结构化描述） | checked（首页、pricing/enterprise 链接） | unverified | checked（官网 sameAs 反链） | checked（TikHub 33） | 真实任务、版本/更新、取消恢复和导出未验证 |
| Higgsfield | unverified | partial（Academy/Help 入口可见） | checked（MCP/API/Plugin/工作室/社区） | unverified | checked（官网 sameAs 反链） | checked（TikHub 26） | MCP 安装与首个回执未验证 |
| MiniMax Design | unverified | checked（官网 Tutorial 链接） | checked（产品首页、Membership、下载） | unverified | partial（Discord 反链；账号时间线未核） | checked（TikHub 25，XHS empty） | macOS/Windows 安装、Skills、计费未验证 |
| RunningHub | partial（首页模型/Blender upgrade/banner） | unverified | checked（ComfyUI、AI Apps、API、社区入口） | unverified | unverified | checked（TikHub 38） | 工作台、API 首次成功、插件更新未验证 |

## 变化记录

| change_id | 对象/维度 | before → after | 观察/证据 | Nomi 影响 |
|---|---|---|---|---|
| CH-20261010-01 | LibTV / 生态 | 上轮插件页受阻 → 本轮公开 HTML 可读，出现明确 marketplace/CLI/授权步骤 | 2026-10-11；`E-LIBTV-PLUGIN-1011` | 值得观察“宿主 Agent 复制粘贴安装”是否比独立设置页更低摩擦；不能据此开发 |
| CH-20261010-02 | LibTV / Blender | 上轮未核实 → 官方标题/描述直接承诺 Blender→LibTV 回流 | 2026-10-11；`E-LIBTV-BLENDER-1011` | 需真实安装与结果回流后再评估是否适用 |
| CH-20261010-03 | MiniMax Design / 工作流 | 产品实体已确认 → 首页公开“五步生产链”、Skills/Plugins、Local-First Asset Center | 2026-10-11；`E-MMD-1011` | 可作为 Nomi Agent→画布→时间轴的对照假设，尚无用户任务证据 |
| CH-20261010-04 | Higgsfield / 生态 | 上轮公开入口 → 本轮仍同屏 MCP、API、ChatGPT Plugin、工作室与社区 | 2026-10-11；`E-HF-1011` | 观察入口命名与结果证明的关系，不把入口数量当能力优势 |
| CH-20261010-05 | RunningHub / 商业+生态 | 上轮首页矩阵 → 本轮仍显示 ComfyUI、无限画布、API、AI Apps、Blender 更新与促销 banner | 2026-10-11；`E-RH-1011` | 需实测促销信息是否干扰首次任务；暂不转 TODO |

## 旅程卡

### J-LT-20261010：LibTV Plugin 安装→授权（partial）

- 任务/成功标准：从 Plugin 页面让一个支持的 Agent 安装插件，新建任务完成授权并收到可创作回执。
- 公开入口：`https://www.liblib.tv/plugin`；页面给出 marketplace add、plugin add、账户授权三步，并列出多个宿主。
- 本轮结果：只读取公开 HTML；Chrome 真实浏览器连接因 request-header policy 失败，未执行复制、安装、登录或生成。
- 指标：公开步骤 3；真实首成功、等待、回执、错误恢复均 `unverified`。
- Nomi 对照：Nomi 现有 MCP/Agent 注册表与画布入口；同任务本轮未启动，差距 `unverified`。

### J-TP-20261010：TapNow 首页→首个可编辑结果（blocked）

- 任务/成功标准：使用日常登录态输入一句创作目标，得到可继续修改/导出的结果，并验证取消或恢复。
- 公开入口：`https://www.tapnow.ai/`；结构化数据指向 `https://app.tapnow.ai/home`。
- 本轮结果：CDP proxy 未建立连接，CUA 报浏览器 request-header policy 不可用；未提交输入，未产生额度消耗。
- 指标：公开发现入口 1；真实输入负担、首次结果时间、取消恢复、跨页数均 `unverified`。
- Nomi 对照：Nomi Agent/React Flow 画布真实任务未跑，不能声称优于或落后 TapNow。

### J-RH-20261010：RunningHub 首页→工作台（blocked）

- 任务/成功标准：从首页找到 AI App/ComfyUI/无限画布之一，运行一个免费或已授权任务，回到结果并记录状态。
- 公开入口：`https://www.runninghub.ai/`；页面描述明确列出 native agents、ComfyUI、infinite canvas、AI Apps、model API。
- 本轮结果：仅读取公开页；工作台、登录、生成、API 调用未验证。

## 内容卡

本轮没有完成两条“原站观看 + 时间码 + 亲自回看”的新内容卡：Chrome/CUA 请求头策略阻断真实浏览器，直接 curl 只能证明页面源码存在，不能证明视频播放。上轮 `C-TAPNOW-12S` 与 `C-HIGGSFIELD-05S` 仍保留为历史证据，未刷新为本轮成功。下一轮优先补两条并保存录屏或截图序列。

## TikHub 自媒体扫描

每家一个唯一查询目录，`--platform all --limit 10 --since 2026-10-07`，费用接口未提供，记为未知。五次 `failures=[]`，各平台 `missingFields={}`；XHS 的 0 条是 `empty`，不是“没人讨论”。

| 对象 | 总数 | 抖音 | 小红书 | B站 | X | 证据目录 |
|---|---:|---:|---:|---:|---:|---|
| LibTV | 40 | 10 | 10 | 10 | 10 | `outputs/competitive-radar/2026-10-10/tikhub/libtv/attempt-01/` |
| TapNow | 33 | 3 | 10 | 10 | 10 | `outputs/competitive-radar/2026-10-10/tikhub/tapnow/attempt-01/` |
| Higgsfield | 26 | 4 | 2 | 10 | 10 | `outputs/competitive-radar/2026-10-10/tikhub/higgsfield/attempt-01/` |
| MiniMax Design | 25 | 5 | 0 (`empty`) | 10 | 10 | `outputs/competitive-radar/2026-10-10/tikhub/minimax-design/attempt-01/` |
| RunningHub | 38 | 8 | 10 | 10 | 10 | `outputs/competitive-radar/2026-10-10/tikhub/runninghub/attempt-01/` |

TikHub 结果用于发现，不把结果卡片自动判作官方账号；本轮未能打开原站 B 站/小红书视频逐段回看。

## Nomi 决策与实验建议（最多三条）

| finding_id | 证据/摩擦 | 适用判断 | 最小验证与成败指标 | TODO |
|---|---|---|---|---|
| F-101 | LibTV Plugin 的“复制给 Agent→安装→授权”三步；`E-LIBTV-PLUGIN-1011` | 值得试验，先不开发 | 给 Nomi 新用户同一目标；比较发现→连接→首个工具回执步数、工具写对率、失败可恢复率 | 查现有 MCP/Agent 引导条目，避免重复 |
| F-102 | MiniMax Design 的 Brief→Planning→Agents→Output 与本地资产中心；`E-MMD-1011` | 持续观察 | 用同一素材跑 Nomi Agent→画布→时间轴；指标为跨页数、首个可编辑结果时间、旧结果保留率 | 不新增 TODO，先核现有 Director/Agent 任务 |
| F-103 | Higgsfield/RunningHub 把 MCP/API/ComfyUI/AI Apps 与结果展示并列；`E-HF-1011`、`E-RH-1011` | 不采用“入口越多越好”；只验证任务可达性 | 新用户盲测能否在 60 秒找到正确入口并拿到回执；失败即保留当前单一通用入口 | 不新增 TODO |

## 证据索引

| evidence_id | 类别 | 来源/观察时刻 | 本地相对路径 | SHA-256 | 对应结论 | 范围/限制 |
|---|---|---|---|---|---|---|
| E-LIBTV-PLUGIN-1011 | 官方声明/HTML | https://www.liblib.tv/plugin · 2026-10-11 | `outputs/competitive-radar/2026-10-10/evidence/public-pages/radar-libtv-plugin.html` | `e433f7752e38e86e9b9fb2ff13c5cf0f2eb891aa411b40bca5eecee22107422a` | CLI/宿主/授权三步 | 源码证据，未执行 |
| E-LIBTV-BLENDER-1011 | 官方声明/HTML | https://www.liblib.tv/blender · 2026-10-11 | `outputs/competitive-radar/2026-10-10/evidence/public-pages/radar-libtv-blender.html` | `deafaedc08b1bd72ffaebb30330bbbb841d984abafdf6a05a3d20465ff9e31d0` | Blender→LibTV 承诺 | 源码证据，未安装 |
| E-TAPNOW-1011 | 官方声明/HTML | https://www.tapnow.ai/ · 2026-10-11 | `outputs/competitive-radar/2026-10-10/evidence/public-pages/radar-tapnow.html` | `5c59d56eee9675fabadf2add1e8d262ff159f039f9d67215ba3df06114508701` | Creative OS/Agent/社区反链 | 未进入 app |
| E-HF-1011 | 官方声明/HTML | https://higgsfield.ai/ · 2026-10-11 | `outputs/competitive-radar/2026-10-10/evidence/public-pages/radar-higgsfield.html` | `b1a366d2714bded32b9aa36252c0fecdae18ceb598392e064d9e5834d8ce18ac` | MCP/API/Plugin/工作室矩阵 | 未登录 |
| E-MMD-1011 | 官方声明/HTML | https://design.minimax.io/ · 2026-10-11 | `outputs/competitive-radar/2026-10-10/evidence/public-pages/radar-minimax-design.html` | `d7b3e7d4c765e88c7666af595a610e454ae32ce0ba31bf552fa3ce916be4a442` | 五步链/Skills/本地资产 | 未安装 |
| E-RH-1011 | 官方声明/HTML | https://www.runninghub.ai/ · 2026-10-11 | `outputs/competitive-radar/2026-10-10/evidence/public-pages/radar-runninghub.html` | `24648b0785efdbb52ca8ed2ffde78000e04927cdbfa88b8074e62f27be6b01aa` | Agent/ComfyUI/画布/API/Blender banner | 未登录工作台 |

## 覆盖轮换与验收

- 五家 × 六类来源均有状态；`unverified`/`partial` 没有被写成无变化。
- 核心两条完整真实旅程、扩展对象成功旅程、两条新内容卡均未满足，故 `partial`，不填写 `completed_at`。
- TikHub 五份 JSON/MD 已保存，逐平台 `summary`/`failures`/`missingFields` 已核对。
- 原始公开 HTML 与 TikHub 证据仅保留在稳定主仓 `outputs/competitive-radar/2026-10-10/`；报告不含账户 Cookie、私密项目或带认证参数的 URL。
- 具体阻塞：`check-deps.mjs` 能看到 Chrome 9222，但 CDP proxy `connected=false`；CUA 报 request-header policy 加载失败，无法满足真实鼠标/录屏协议。
