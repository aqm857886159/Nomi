# 来源与证据表

| sourceId | 来源 | 一手来源 | 访问/版本 | 证据状态 | 可证明 | 不可证明 | 许可/下架处理 |
|---|---|---|---|---|---|---|---|
| `agent-skills-spec` | Agent Skills 格式规范 | https://github.com/Open-Dot-Agents/SKILL.md | 页面检索：2026-09-05 | `observed` | SKILL.md、目录结构、渐进披露和 Apache-2.0/CC-BY-4.0 声明 | 不证明每个第三方 Skill 可再分发 | 只记录规范来源；逐包核对许可证 |
| `anthropic-skill-creator` | 官方 Skill 创建指南 | https://github.com/anthropics/claude-plugins-official/blob/main/plugins/skill-creator/skills/skill-creator/SKILL.md | 页面检索：2026-09-05 | `observed` | manifest/SKILL.md/资源分层建议 | 不证明第三方包版权或质量 | 仅作格式/质量参考，不复制正文 |
| `deer-flow-video-generation` | 视频生成 Skill 示例 | https://github.com/bytedance/deer-flow/blob/main/skills/public/video-generation/SKILL.md | 页面检索：2026-09-05 | `observed` | 结构化视频 prompt、参考图和异步生成流程 | 不证明可在 Nomi 直接运行或可再分发 | 需打开仓库 LICENSE/目录许可后再评估 |
| `open-video` | 开源视频工作流 Skill | https://github.com/open-video-ai/open-video/blob/master/skill/open-video/SKILL.md | 页面检索：2026-09-05 | `observed` | prompt→生成→质量判断→拼接的流程形态 | 不证明 provider/API 或质量判定在 Nomi 已接通 | 下载/改编前核对仓库许可证和依赖 |
| `create-storyboard` | 剧本到分镜/animatic Skill | https://github.com/grahama1970/agent-skills/blob/main/skills.pre-symlink-1776435493/create-storyboard/SKILL.md | 页面检索：2026-09-05 | `observed` | screenplay→镜头/构图/时长的协作工作流 | 不证明其脚本、记忆系统或 CLI 可在 Nomi 运行 | 只保存摘要与链接，逐项核许可 |
| `tikhub-social-research` | TikHub/社交平台候选 | 用户指定渠道 | 当前会话尚未获得可验证连接/账号证据 | `blocked` | 需要真实工具/登录态后才能确认的来源 | 不证明已浏览任何 TikHub/抖音/小红书/X 内容 | 等用户提供可用连接或导出；不编造 |
| `nomi-user-feedback` | 最近两个 Nomi 用户群反馈 | 本地私有导出（不入仓） | 2026-08-17 导出；1747 + 386 条；仅做脱敏关键词计数 | `observed` | 历史需求热度信号：视频/生成/模型/供应商/API/画布/分镜/技能 | 不代表 2026-09 实时反馈；不替代逐条访谈 | 原始文件保留私有；后续用新导出复核 |
| `alex-chat` | 用户与 Alex 的聊天 | 本地会话/连接器待定位 | 当前 worktree 无聊天导出或可检索会话入口 | `blocked` | 无 | 不证明聊天结论 | 用户提供导出/链接/授权后补录 |

## 证据状态说明

- `documented`：官方文档明确声明，未做现场操作。
- `observed`：在可复核页面/仓库看到具体内容，并保留 URL/日期。
- `inferred`：由多条证据推导，不能当作实现事实。
- `proposed`：Nomi 的设计建议，不是外部事实。
- `blocked`：缺少访问、许可、凭据或真实环境，不能继续推断。

## 候选长名单（仅元数据，不等于纳入产品）

| 候选 | 组织/作者 | 原始来源 | 类型 | 许可/复制判断 | 预览/质量判断 | 处理 |
|---|---|---|---|---|---|---|
| Fountain | Fountain authors | https://fountain.io/ | 剧本格式 | 规范页未授再分发许可 | 官方语法/示例；A- | link-only |
| Fountain Parser | Nima Yousefi / John August | https://github.com/nyousefi/Fountain | 文本/解析器 | MIT；保留 notice | 测试明确；A- | 纳入技术适配 |
| Spec Kit Screenwriting | Andreas Daumann | https://github.com/adaumann/speckit-preset-screenwriting | 文本/模板 | MIT；可改编但保留许可 | 32 commands/26 templates；A- | 纳入试用 |
| Narrative Context Protocol | Narrative First | https://github.com/narrative-first/narrative-context-protocol | 文本/工作流 | MIT + COPYRIGHT；schema 不决定用户作品归属 | provenance/schema；A- | 纳入叙事数据参考 |
| Open-Write | Open-Write | https://github.com/Open-Write/Open-Write | 文本/工作流 | Apache-2.0；保留 NOTICE | demo project；B+，作者自述未独立 benchmark | 小范围试用 |
| Storyboarder | Wonder Unit | https://github.com/wonderunit/storyboarder | 图像/视频/工作流 | EULA/商业再分发边界不清 | 分镜/animatic 相关性高；C+ | 仅链接，暂不复制 |
| BFL Skills | Black Forest Labs | https://github.com/black-forest-labs/skills | 文本/图像/视频/工作流 | 仓库 MIT；模型、API 输出、预览另行核对 | 官方 staged workflow；A | 优先纳入 |
| Wan-skills | Wan-Video / Alibaba Cloud | https://github.com/Wan-Video/Wan-skills | 图像/工作流 | Apache-2.0 仓库；服务/API 条款另行核对 | 官方 Skill；B+，需 key | 纳入但标 credentials |
| ComfyUI Workflow Templates | Comfy-Org | https://github.com/Comfy-Org/workflow_templates | 图像/视频/音频/工作流 | MIT 仓库；模型/节点/缩略图逐资产核对 | 版本、模型元数据、缩略图/校验；A | 优先纳入 |
| Wan2.2 | Wan-Video | https://github.com/Wan-Video/Wan2.2 | 视频/工作流 | Apache-2.0；权重/输出须遵守各自条款 | T2V/I2V/TI2V 示例；A- | 只做模型工作流参考 |
| LTX-Video | Lightricks | https://github.com/Lightricks/LTX-Video | 视频/工作流 | Apache-2.0 仓库；checkpoint 逐项核验 | 多关键帧/V2V；A | 只做模型工作流参考 |
| Runway I2V Prompting Guide | Runway | https://help.runwayml.com/hc/en-us/articles/48324313115155-Image-to-Video-Prompting-Guide | 文本/视频 | 页面未授镜像许可 | 一手提示词原则；B+ | link-only + 原创摘要 |
| Google Veo Prompt Guide | Google DeepMind | https://deepmind.google/models/veo/prompt-guide/ | 文本/视频 | 页面/服务条款适用 | 一手镜头/声音/叙事原则；B+ | link-only + 原创摘要 |
| Blender Video Editing Manual | Blender Foundation | https://docs.blender.org/manual/en/latest/video_editing/index.html | 文本/工作流 | CC BY-SA 4.0；署名/相同方式共享 | 官方 VSE/合成/音频；A- | 少量 CC 摘要/链接 |
| Kdenlive Manual | KDE / Kdenlive | https://docs.kdenlive.org/en/ | 文本/视频/工作流 | 文档 CC BY-SA 4.0；保留署名 | 时间线/字幕/语音转文字/导出；A- | 后期参考 |

长名单的“作者自述”“仓库存在”“可运行”分别是不同证据；没有真实 Nomi adapter、provider 和重启 receipt 时，只能标研究候选，不能标成 Nomi 可用 Skill。
