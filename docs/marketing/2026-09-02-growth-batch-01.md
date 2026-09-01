# Nomi 增长内容批次 01：真实 60 秒工作流

> 发布窗口：2026-09-02 至 2026-09-08
> 状态：英文 16:9 可发布；中文与竖版待取回；所有渠道待账号发布
> 母素材：当前 worktree 有 `marketing/assets/video/launch-film-en.mp4`；中文母版及竖版须按制作追踪记录从 ChatCut / 旧机器取回
> 目标：验证“完整导演工作流”是否能把已有自然兴趣转成官网、GitHub 与下载意图

## 1. 统一事实与归因

这批内容只使用已经完成 QA 的真实产品录屏和成片，不宣称“全自动成片”“全部本地运行”或未经验证的节省比例。画面中含 AI 生成内容时，发布页显式标记“含 AI 生成画面 / Includes AI-generated visuals”。

发布前先核对素材文件：中文母版 Render `76bae80284`、中文 9:16 Render `f95b597b3e`、英文 9:16 Render `0977e8f3dd`、X 安全版 Render `a8b15ff5ad`。取回前不得把对应渠道标记为已发布。

所有链接以 `https://nomiaqm.com/` 或 `https://nomiaqm.com/en/` 为落点：

| 渠道 | 链接 |
|---|---|
| B站 | `https://nomiaqm.com/?utm_source=bilibili&utm_medium=video&utm_campaign=workflow_60s_202609&utm_content=cn_master` |
| 即刻 | `https://nomiaqm.com/?utm_source=jike&utm_medium=social&utm_campaign=workflow_60s_202609&utm_content=cn_clip` |
| 知乎 | `https://nomiaqm.com/?utm_source=zhihu&utm_medium=article&utm_campaign=workflow_60s_202609&utm_content=workflow_post` |
| 小红书 | `https://nomiaqm.com/?utm_source=xiaohongshu&utm_medium=social&utm_campaign=workflow_60s_202609&utm_content=vertical` |
| 抖音 | `https://nomiaqm.com/?utm_source=douyin&utm_medium=video&utm_campaign=workflow_60s_202609&utm_content=vertical` |
| YouTube | `https://nomiaqm.com/en/?utm_source=youtube&utm_medium=video&utm_campaign=workflow_60s_202609&utm_content=en_master` |
| X | `https://nomiaqm.com/en/?utm_source=x&utm_medium=social&utm_campaign=workflow_60s_202609&utm_content=en_clip` |

发布台账至少记录：发布时间、公开 URL、实际素材版本、UTM、48 小时数据、7 天数据、评论中重复出现的问题。

## 2. B站

**标题 A**：`我把脚本、分镜、生成和剪辑放进了一个开源 AI 视频工作台`

**标题 B**：`不用在十个工具间搬素材：Nomi 的 60 秒真实工作流`

**简介**：

> 这是 Nomi 的 60 秒真实产品流程：先写故事和分镜，锁定人物、场景、道具与风格，再在画布组织生成，把采用的结果放回时间线继续剪辑和导出。Codex、Claude Code、Cursor 可以通过 MCP 做重复操作，但方向、付费生成、采用和导出仍由人确认。
>
> Nomi 是开源、本地优先的 AI 视频工作台。项目、素材和密钥保存在自己的电脑；外部模型仍按对应服务收费。
>
> 下载与源码：{B站 UTM 链接}
>
> 本视频含 AI 生成画面。

置顶评论只问一个问题：`你现在做 AI 视频，最耗时间的是人物一致性、模型切换，还是最后收进时间线？`

- 假设：完整流程比功能截图更能带来 30 秒留存和官网点击。
- 素材：中文 16:9 母版；封面用 `A1-one-project.png`，不要用六图拼贴。
- CTA：官网下载安装。
- 复盘：48 小时看点击率和前 30 秒留存，7 天看官网点击、GitHub referrer 和安装包增量。

## 3. 即刻

**正文**：

> 过去几个月我一直在做 Nomi，一个开源、本地优先的 AI 视频工作台。
>
> 这次不发功能清单，直接放一条 60 秒真实流程：故事和分镜先留在同一个项目里，人物、场景、道具和风格作为参考继续传给后面的镜头；生成结果不散落在下载目录，而是回到时间线继续剪。
>
> Codex / Claude Code / Cursor 也能通过 MCP 操作项目，但方向、花钱、采用和导出都会停下来等人确认。
>
> 现在最想验证的是：对真实创作者来说，跨工具搬运和人物漂移，哪个更痛？
>
> {即刻 UTM 链接}
>
> 含 AI 生成画面。

- 假设：开发过程和真实取舍能带来高质量问题，而不是泛点赞。
- 素材：中文 60 秒或 30 秒裁切版 + 一张 `A1-one-project.png`。
- CTA：评论反馈真实工作流阻塞；链接负责下载。
- 复盘：48 小时记录主页访问、有效评论、官网点击；有效评论定义为描述具体流程或安装问题。

## 4. 知乎 / 公众号长文母稿

**标题**：`做 AI 视频真正贵的，往往不是单次模型调用`

**开头**：

> 一条 AI 视频从脚本走到成片，成本不只发生在模型扣费的那一刻。人物在第 4 镜和第 9 镜变了，要重抽；参考图在浏览器、节点工作流和剪辑软件之间来回搬；换一个供应商，项目上下文又要重建。单次价格很容易比较，这些重复劳动和失败重试却经常不在账单里。

**结构**：

1. 同一种能力为什么会重复购买
2. 没有视觉锚点时，失败重试如何扩大成本
3. 为什么“生成完”不等于“有一条可交付的视频”
4. Nomi 的边界：工作台开源且本地优先，外部推理不等于离线或免费
5. 60 秒真实流程与当前限制

**结尾**：

> 下一篇会公开一个 8-10 镜人物一致性项目：最终成片、失败镜头、完整重试账单和复现材料一起放出。只有成功镜头、没有失败成本的案例，不足以说明问题。

- 假设：成本拆解能承接搜索和收藏，长尾价值高于短期点赞。
- 素材：60 秒成片、`A2-same-person.png`、真实时间线截图；不放尚未完成的账单数字。
- CTA：官网体验并提交具体流程问题。
- 复盘：7 天看完读、收藏、搜索进入、官网点击；28 天看长尾搜索和引用。

## 5. 小红书 / 抖音

**封面字**：`一条 AI 视频，不该散在十个工具里`

**20-30 秒口播 / 字幕**：

> 写完脚本，不应该丢掉人物设定。
>
> 生成完镜头，也不应该再去下载目录捞素材。
>
> 我把故事、分镜、视觉参考、生成画布和时间线放进了同一个开源工作台。
>
> AI 助手可以做重复操作，但花钱和采用镜头仍然要等你确认。
>
> 它叫 Nomi。完整流程和下载地址在主页。

发布说明：`产品实录；含 AI 生成画面。开源项目仍在快速迭代，外部模型按各自服务收费。`

- 假设：单一痛点开头比“产品发布”开头有更高的 3 秒留存。
- 素材：9:16 成片；只截取故事、参考、画布、时间线四段，首帧直接显示产品。
- CTA：主页官网，不在正文塞多个链接。
- 复盘：3 秒 / 5 秒留存、完播、主页访问、收藏；72 小时后只保留胜出标题结构。

## 6. YouTube

**Title**: `An Open-Source, Local-First AI Video Workflow in 60 Seconds | Nomi Video`

**Description**:

> Nomi Video keeps scripts, storyboards, visual references, generation, and a real editing timeline in one local-first project.
>
> Bring your own model APIs or ComfyUI. Coding agents can operate the workbench over MCP, while direction, paid generation, shot acceptance, and export remain explicit human decisions.
>
> Download and source: {YouTube UTM link}
>
> Nomi is AGPL-3.0 open source. Projects, media, and keys stay on your computer; external model calls still follow each provider's pricing and data policy.
>
> Includes AI-generated visuals.

- Hypothesis: category wording in the title will capture qualified search better than a brand-only launch title.
- Asset: English 16:9 master, English captions, `social-preview-en.jpg` thumbnail.
- CTA: English homepage and download.
- Review: 48-hour CTR and first 30-second retention; 7-day search terms, site clicks, and installer delta.

## 7. X

**Post 1**:

> AI video projects should not fall apart between the prompt, generation tab, downloads folder, and editor.
>
> I built Nomi Video to keep the script, storyboard, visual anchors, generation canvas, and timeline in one open-source, local-first workbench.
>
> 60-second real workflow ↓

**Post 2**:

> Bring your own APIs or local ComfyUI. Codex, Claude Code, and Cursor can operate the workbench over MCP.
>
> Direction, paid generation, shot acceptance, and export still stop for a human decision.

**Post 3**:

> Source + downloads: {X UTM link}
>
> Includes AI-generated visuals. External models still follow their own pricing and data policies.

- Hypothesis: a native product clip plus one concrete workflow problem will outperform a link-first announcement.
- Asset: X-safe English vertical clip; attach the link only in the final post.
- CTA: English homepage.
- Review: 48-hour video retention, profile visits, link clicks, qualified replies; 7-day GitHub referrer.

## 8. 本批不发布

- Show HN：等旗舰工程、账单、复现材料和英文 quickstart 齐全。
- Product Hunt：当前安装签名和英文承接仍不足，且不应与 Show HN 同日争夺反馈。
- Reddit：先参与具体技术讨论；只有 ComfyUI 或 MCP 技术复盘能针对单一社区规则改写时再发。
- “10 镜人物一致性”：真实工程尚未完成，不能把产品能力截图包装成案例。

## 9. 复盘模板

| 字段 | 内容 |
|---|---|
| 渠道 / URL | |
| 发布时间 / 素材版本 | |
| 内容假设 | |
| 48 小时展示 / CTR / 留存 | |
| 7 天官网点击 / GitHub / 下载增量 | |
| 有效评论与重复问题 | |
| 同期 release 或其他干扰 | |
| 决策：保留 / 改标题 / 改前 15 秒 / 停止 | |
