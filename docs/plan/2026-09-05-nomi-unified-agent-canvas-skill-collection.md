# Nomi 统一 Agent、画布与 Skill 聚合区：计划入口

状态：📋 方案待拍板；等待样张和用户确认，未进入生产实现。

本计划的完整证据和逐项母表在：

- [研究总报告](../research/2026-09-05-nomi-unified-agent-canvas-skill-solution/report-source.md)
- [执行计划](../research/2026-09-05-nomi-unified-agent-canvas-skill-solution/execution-plan.md)

## 目标

把 Nomi 的“找方法 → 写剧本 → 分镜计划 → 画布生成 → 视频拆解 → 继续调整 → 预览/导出”收敛成一个可追踪的用户旅程：

- 画布是视频拆解和生成产物的主要操作面；
- Agent 是同一项目中的意图、编排、解释和局部修改入口；
- Skill 是从具体任务开始的引导和方法加载，不是空白输入框；
- 创作区 `分镜计划` 与画布 `视频拆解表` 是两个不同对象，底层共享镜头生成协议但不合并语义；
- 结果可以收起、回看、下载或继续使用，不永久挤占对话。

## 第一闸：不漏项

执行任何代码前，必须使用研究报告第 13 节的母表逐项挂任务 ID：

- Agent 全屏、结果收纳、五个 composer 按钮、加号资料入口、提示词框增长/滚动/小屏大屏；
- Icon 的 hover/pressed/selected/disabled 动效、固定左栏、新项目和库的分组、三工作区信息架构；
- Skill 空状态卡、标题/描述/图片视频、点击加入上下文、三类 Skill 分类、来源/作者/版权/下架/SEO；
- 创作区 `分镜计划`、画布 `视频拆解表`、视频获取节点、视频拆解节点、关键帧和表格编辑；
- 视频拆解表到逐镜 Prompt 编译和图片/视频生成；
- 新版本弹窗、供应商全局偏好/fallback、可选遥测；
- HyperFrames、独立字幕节点、节点微调等明确暂缓项。

## 第二闸：先样张再写 UI

先交付并确认三张样张：

1. Agent docked/collapsed/fullscreen/result-focus + 五按钮 composer；
2. 左栏固定、画布视频获取 → 视频拆解表 → 选行生成；
3. 空状态任务卡 + 顶栏现有 `上手 N/4` + 展开后的完整可勾选 checklist。

样张必须是真实布局、真实中文文案、真实状态和设计 token；可以用 HTML/SVG/ImageMagick/生图制作参考素材，但不能以静态概念图代替生产验收。

## 第三闸：实现顺序

1. 复用现有 onboarding/checklist、Agent Host、AutoGrowTextarea、React Flow 和 storyboard canonical bridge；
2. 先做 shell/左栏/composer/结果收纳和引导；
3. 再做共享 artifact/revision/context handle；
4. 再做视频获取节点与画布视频拆解表；
5. 再做 Skill Hub catalog、来源权利和 SEO；
6. 最后做 provider priority 和 opt-in telemetry；
7. 每阶段用真实 Electron 用户任务、持久化/重启和截图人眼对账验收。

## 明确的反向约束

- 不将当前右侧 Portal 直接放大当最终方案；
- 不把拆解关键帧默认铺成图片节点堆；
- 不把两张分镜表改成一张模糊的大表；
- 不重复造 Agent runtime/store；
- 不把所有工具都变成画布节点；字幕、转写等保留 Agent Skill；
- 不把 GitHub 公开仓库或 TikHub 可抓取内容当成转载授权；
- 不因 SEO 数量压力批量生成无原创价值的薄页；
- 不静默切换供应商、不收 prompt/媒体/源 URL/API key/微信内容；
- 不把 loopback fixture、store injection 或仅静态页面当成真实完成证据。

## 当前必须确认的边界

- 推荐名称：创作区“分镜计划”，画布“视频拆解表”；
- 推荐全屏：保留 Nomi 全局左栏和项目上下文，只把当前工作面变成聚焦状态；
- “Agent DMD”的准确文档/PR/方法来源目前未在仓库找到，需要补充后再做专门对齐。
