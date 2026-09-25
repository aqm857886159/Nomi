# 竞品学习周期报告：2026-09-25

> 本轮是固定锚点 `2026-09-22T10:00:00+08:00` 的补跑；不移动锚点。结论为 `partial`：公开面和 TikHub 已完成，LibTV 画布旅程有真实证据，TapNow/扩展对象登录应用与录屏回看仍缺。

## 周期与检查点

| 字段 | 值 |
|---|---|
| cycle_id / mode | 2026-09-25 / cycle（补跑） |
| schedule_anchor / scheduled_for / next_due | 2026-09-22T10:00:00+08:00 / 2026-09-25T10:00:00+08:00 / 2026-09-28T10:00:00+08:00 |
| attempted_at / completed_at | 2026-09-25T23:55:00+08:00 / 留空（partial） |
| status | partial |
| observation_window / baseline | 首轮基线：2026-08-23 至 2026-09-25；前周期 2026-09-22 partial，无成功基线 |
| executor / branch / PR | Codex / `research/competitive-radar-2026-09-25` / pending |
| Nomi build / commit | `origin/main` 基线 `504984bd21bf0be601f29a64fdcbb1f67259f7b6`；未启动 Electron，Nomi 对照为 unverified |
| evidence_root | `/Users/aoqimin/Desktop/Nomi/outputs/competitive-radar/2026-09-25/` |
| next_action | 2026-09-28 优先补 TapNow 登录应用、录屏与取消/错误恢复；再补扩展对象应用和四轮维度欠账 |

## 本轮结论

1. **LibTV 把 Agent 的价值落在可继续编辑的画布，而不是聊天回复。** Plugin 页直接给出一句话安装指令、插件市场地址、授权步骤；CLI 指南把“创建项目、搭节点、上传素材、查询进度/失败、返回画布链接”写成一条生产闭环。真实画布证据显示首页→新建画布→图片节点→输入提示词→选择 `Lib Image 2.5 Pro`→提交后的状态连续可见。证据：`E-LIBTV-PLUGIN`、`E-LIBTV-CLI-GUIDE`、`E-LIBTV-J01/J02`。
2. **LibTV 公开入口把复杂能力分成“脚本/角色/导演/3D/样片”而非单一模型列表。** 首页同时暴露“剧本生成、图片生成、视频生成、智能剪辑”和最近项目；更新视频文案还把 1.5 的原创编剧、角色造型、导演分身、3D Box、Seedance 样片模式拆成连续剧集。这是降低发现成本的内容机制，但不证明每个功能都已在本轮独立实测。
3. **营销样本的有效镜头是“具体摩擦→可见控制点→结果”，而非泛泛展示模型。** LibTV 官方短视频明确说“改台词/调冲突/动伏笔会提示全篇影响”，TapNow 用户作品用 0–13 秒分段提示词描述剑枪动作与镜头路径。两条原站页面都能读到正文与时间码，但视频元素在当前会话无法得到可用 duration，故内容卡为 `partial`，不宣称完整回看。

## 覆盖矩阵与变化

| 对象 | 官方更新 | 新手教程 | 官网具体页 | 登录应用 | 官方社媒 | 社区 | 本轮深挖与缺口 |
|---|---|---|---|---|---|---|---|
| LibTV | checked：官网首页“版本更新记录 v1.5”；官方抖音结果 | checked：CLI/Plugin 飞书指南 | checked：home、plugin、Blender | partial：真实画布旅程；未做完整取消/错误恢复 | checked：TikHub + 官方抖音条目 | checked：TV Show/作品区 | 已深挖插件、CLI、Blender、画布；缺完整录屏回看与取消/失败恢复 |
| TapNow | unverified：官网 Blog 入口未登录核验 | unverified | checked：`https://tapnow.ai/` 公开声明 | blocked：代理页可达但登录应用/测试项目未建立 | checked：TikHub 40 条 | partial：抖音作品与评论可读 | 缺登录态、真实鼠标旅程和结果回流 |
| Higgsfield | checked：官网公开首页与产品导航 | unverified | checked：官网显示 Image/Video/Audio/MCP/API/Plugin/Genjutsu | blocked：代理页 about:blank；未做登录 | checked：TikHub 40 条 | partial：公开内容发现 | 本轮轮换对象；只完成公开声明，缺应用/录屏 |
| MiniMax Design | unverified | checked：官网 Tutorial 入口 | checked：`https://design.minimax.io/`，公开写明 Agent、Canvas、Skills/Plugins、本地资产中心、下载桌面端 | blocked：未启动桌面/登录 | checked：TikHub 40 条 | partial：公开内容发现 | 公开页有强线索，未验证产品内路径 |
| RunningHub | checked：官网公告含 Blender 插件升级、Seedance 2.5、API | unverified | checked：官网公开 ComfyUI/Workflow/API/rhTV/AI Canvas | blocked：未登录 | checked：TikHub 40 条 | partial：公开作品/反馈 | 用户反馈出现成本抱怨，需下轮核对价格与实际扣费 |

公开页面证据：`E-WEB-LIBTV-*`、`E-WEB-TAPNOW`、`E-WEB-HIGGSFIELD`、`E-WEB-MINIMAX`、`E-WEB-RUNNINGHUB`。代理页失败均保留 `about:blank` info，不把失败写成无变化；其余四家静态 HTTPS 响应只作为官网声明证据。

## 旅程卡

### J-LIBTV-01 / LibTV / 画布生图

- **任务/成功标准**：从首页新建可编辑画布，添加图片节点，输入提示词并提交一次生成；成功标准是模型、参数、节点状态和可继续编辑画布同时可见。
- **环境**：用户 Chrome CDP，公开 LibTV 页面，账户层级/版本未知；Nomi 对照未运行。
- **轨迹**：首页 → `新建画布创作` → 图片节点 → 输入“戴红色围巾的白猫…” → `Lib Image 2.5 Pro` → `16:9 · 标准画质 · 2K · 1张` → 提交后保留“尝试/生成中/取消 ESC”状态。
- **结果**：主路径 `checked`；取消/错误恢复 `unverified`；录屏未生成，使用截图序列，故交互验收 `partial`。
- **步数口径**：5 个主要 UI 动作；网络/模型等待未计入；跨页 0。
- **证据**：`E-LIBTV-J01`、`E-LIBTV-J02`，本地 `outputs/competitive-radar/2026-09-25/evidence/libtv/journeys/`。

### J-TAPNOW-01 / TapNow / Creative OS 首次成功

- **任务/成功标准**：从官网 Get started/download 进入应用，用自然语言编排文本/图像/音频/视频并回流结果。
- **环境/结果**：官网静态页声明“Your Creative OS”“Orchestrate text, image, audio, and video models”；登录应用未建立，无法用真实鼠标完成，状态 `blocked`。
- **缺口**：没有账户/项目/结果回流/取消或错误恢复证据；下轮优先补。

### J-HIGGSFIELD-01 / Higgsfield / MCP/Plugin 到成片

- **结果**：公开 HTML 显示 Image、Video、Audio、MCP、API、ChatGPT Plugin、Canvas、Pricing；登录应用代理页为 about:blank，状态 `blocked`。不能由首页导航推断安装或生成成功。

## 内容卡

### C-LIBTV-20260923 / 官方抖音

- URL：`https://www.douyin.com/video/7688585271088057651`；作者 LibTV，发布时间 2026-09-23；官方账号证据来自页面显示“LibTV / 认证徽章”。
- 标题/主张：`LibTV1.5 原创编剧上线`；可见主张是题材、人设、背景打磨，改台词/调冲突/动伏笔会提示全篇影响，支持 AI 调试与手动精修。
- 时间码：页面显示视频 `00:19`；同页连续内容列出角色造型 `00:53`、导演分身 `02:14`、原创编剧 `00:30`、3D Box `00:20`、Seedance 样片模式 `00:10`。这些是页面播放器/列表时间码，当前未取得可靠 video duration，标 `partial`。
- 机制解释：把版本更新拆成可复述的单一摩擦和单一能力，降低“新功能到底解决什么”的理解成本；反方是短视频文案不等于实际可用性。

### C-TAPNOW-20260906 / 用户作品

- URL：`https://www.douyin.com/video/7682370643907661090`；作者“小王不AI干正事”，发布时间 2026-09-06；页面标注“本作品在 Tapnow 中完成”。
- 内容/时间码：页面正文提供 0–2、2–5、5–8、8–10、10–13 秒动作与镜头调度，包含 24mm 超广角、低机位、剑枪碰撞、升格、跟拍与遮挡；播放器列表显示该集 `01:25`，但当前视频 duration 未返回，未宣称完整回看。
- 评论反馈：页面可见评论要求给长枪女中景、询问人物生成方法；作者回复“用 mj 生成写实风格”。这是用户反馈/作者回复，不等于 TapNow 官方承诺。
- 机制解释：用可复制的时间分段提示词把“动作”和“摄影机”绑定，减少只写风格词的摩擦；反方是样本可能主要由提示词/参考图/模型共同造成，不能归因 TapNow 单一能力。

## 自媒体来源（TikHub）

五个查询均使用 `since=2026-08-23`、`limit=10`、四平台 `douyin,xhs,bilibili,x`，每家 40 条，`failures=[]`、`missingFields={}`。原始 JSON/Markdown 位于：

- `outputs/competitive-radar/2026-09-25/tikhub/libtv/q01/attempt-01/`
- `.../tapnow/...`、`.../higgsfield/...`、`.../minimax-design/...`、`.../runninghub/...`

请求/翻页量以各 JSON 的 `summary.platforms[].pagesFetched` 为准；TikHub 只用于发现，官方身份、视频完整观看和转化均未由检索结果单独证明。

## Nomi 决策与实验回访

| finding_id | 证据/摩擦 | Nomi 当前现状 | 分诊与最小实验 |
|---|---|---|---|
| F-01 | `E-LIBTV-PLUGIN`、`E-LIBTV-CLI-GUIDE`：一句话安装 + 授权 + 画布回流 | Nomi 有 MCP/Agent 能力，但本轮未跑同任务，现状 `unverified`；TODO `T-CR-03`、`T-EC-01` 已存在 | **值得试验**：不开发；先做同任务对照走查，指标为从发现到首个可编辑产物的动作数、失败可恢复率 |
| F-02 | `E-LIBTV-J01/J02`：模型、参数、状态和取消同时在节点内可见 | Nomi 现有生成画布/声明式参考槽/Agent 工具，但未跑对应真实任务 | **持续观察**：复用 `T-DS-05`/`T-CR-02`，先核对状态信任与姿势/表情入口，不新造第二套 UI |
| F-03 | `C-LIBTV`、`C-TAPNOW`：更新/作品均把镜头语言或编辑影响写成可见证据 | Nomi 内容实验尚未建立；TODO `T-CR-04`、`T-WB-01` 已存在 | **值得试验**：形成一条内部内容实验简报；只测“真实功能镜头→官网落点→首次体验”，不发布、不预测转化 |

## 轮换与验收

- 本轮扩展轮换：Higgsfield；完成公开官网与四平台发现，登录应用/录屏缺口保留。
- 两条核心旅程要求：LibTV `partial/checked`；TapNow `blocked`，因此周期不能填 `completed_at`。
- 两条内容卡已保存页面 JSON、截图、来源 URL、观察时刻和 SHA-256；完整视频回看未完成，按 partial 记录。
- 原始证据只放稳定主仓 `outputs/competitive-radar/2026-09-25/`；公开报告未写 Cookie、认证 URL 或私有项目。
- 下一轮先补 `J-TAPNOW-01`，再补至少一条扩展对象真实应用旅程和取消/错误恢复；四轮回顾时优先检查 `Agent / 生态入口 / 状态与信任` 维度。

## 证据索引（代表项）

| evidence_id | 类别 | 来源/本地路径 | 对应结论 |
|---|---|---|---|
| E-LIBTV-PLUGIN | 声明+截图 | `https://www.liblib.tv/plugin`；`outputs/.../evidence/libtv/public/plugin.*` | Plugin 安装与授权 |
| E-LIBTV-CLI-GUIDE | 声明+指南 | `https://resonate.feishu.cn/wiki/RjelwT2UoidnTMka2nCc2chGnud`；`.../guide.text.json` | CLI 画布闭环与版本记录 |
| E-LIBTV-BLENDER | 声明+截图 | `https://www.liblib.tv/blender`；`.../blender.*` | Blender→LibTV 回流承诺 |
| E-LIBTV-J01/J02 | 实测截图序列 | `.../evidence/libtv/journeys/01-*`、`02-*` | 真实画布主路径（partial） |
| E-TAPNOW-HOME | 官网声明 | `https://tapnow.ai/`；`web/static/tapnow.summary.json` | Creative OS 定位，非登录证明 |
| E-HIGGSFIELD-HOME | 官网声明 | `https://higgsfield.ai/`；`web/static/higgsfield.summary.json` | Image/Video/Audio/MCP/API/Plugin 导航 |
| E-MINIMAX-HOME | 官网声明 | `https://design.minimax.io/`；`web/static/minimax_design.summary.json` | Agent/Canvas/Skills/Local-first |
| E-RUNNINGHUB-HOME | 官网声明 | `https://www.runninghub.ai/`；`web/static/runninghub.summary.json` | ComfyUI/Workflow/API/rhTV |
| C-LIBTV-20260923 | 内容+页面截图 | 抖音 `7688585271088057651`；`outputs/.../content/libtv_official.*` | 官方更新视频 |
| C-TAPNOW-20260906 | 内容+页面截图 | 抖音 `7682370643907661090`；`outputs/.../content/tapnow_creator.*` | 用户作品与时间码 |

