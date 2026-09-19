# 对标对象与核心资料登记

> 状态：长期维护；初始登记 2026-09-19。下表是研究范围和检索种子，不是本轮实查结果。

## 对象登记

| ID | 对象/优先级 | 检索种子与身份状态 | 已知入口 | 首轮要确认 |
|---|---|---|---|---|
| libtv | LibTV，核心 | LibTV / Liblib；两者产品/平台关系待官网核实 | 用户提供：[插件](https://www.liblib.tv/plugin)、[Blender](https://www.liblib.tv/blender?entrySource=homepage_feature&entryItemKey=blender) | 官网更新、新手教程、应用、官方账号；插件/CLI 实际名称与支持宿主 |
| tapnow | TapNow，核心 | TapNow / Tap Now；别名用检索验证 | 待从已登录浏览器/官方交叉链接确认 | 官网、更新、新手教程、应用、账号/社区、核心创作旅程 |
| higgsfield | Higgsfield，扩展 | 用户写 higgifield，按 Higgsfield 作为待核实检索词 | 待核实 | 官方产品实体、功能入口、更新、教程、账号与视频营销 |
| minimax-design | MiniMax Design，扩展 | MiniMax Design；不得自动等同全部 MiniMax 产品 | 待核实 | 精确域名/产品实体、官方 X 账号、网站与自媒体关系 |
| runninghub | RunningHub，扩展 | RunningHub / Running Hub | 待核实 | 站点语言/区域、工作流应用、社区、教程与官方账号 |

不把“未确认 URL”补成看起来像真的链接。发现新对标对象可作为候选记录，不自动降低两家核心对象优先级。

## 每家来源表（首次运行逐行填）

对每个对象保存以下字段：来源 ID、类型、公开 URL、官方身份依据、语言/区域、是否需登录、last_attempted、last_successful、状态与替代访问路径。类型至少包括：

| 类型 | 必须取得的内容 | 验证方式 |
|---|---|---|
| changelog | 官方更新日志/公告与发布日期 | 从官网导航/页脚/帮助中心找到；没有独立日志时用已核实官方公告并说明 |
| tutorial | 新手教程/帮助中心/官方入门视频 | 看完整首次成功路径，记录过时步骤和版本 |
| website | 具体功能/插件/CLI/Blender/价格页面 | 记录桌面与移动入口、按钮落点及承诺 |
| app | 登录后应用/桌面插件 | 真实任务、鼠标操作、录屏及账户档位 |
| social | 官方抖音/小红书/B站/X 等账号 | 官网反链/交叉认证，存稳定账号 ID，不只记显示名 |
| community | 公开社区、作品、评论、活动与独立教程 | 区分官方/用户/推广；没有公开面则记覆盖缺口 |

跨站访问路径需保留必要参数到本地证据；公开归档移除认证/追踪/私有项目参数。账号凭据与 Cookie 不进来源表。

## Nomi 对照资料

- [现役架构](../../ARCHITECTURE-NOW.md)、[TODO](../../roadmap/TODO.md)、[设计系统](../../design/nomi-design-system.md)。
- 历史材料：[竞品核心架构对标](../2026-09-09-competitor-core-architecture-benchmark.md)、[LibTV 首稿调研](../2026-08-20-libtv-infinite-canvas-first-draft-competitive-research.md)。历史材料只作线索，版本和功能要重新实查。
- [TikHub 接口笔记](../tikhub-api-notes.md) 和 `scripts/research/tikhub-search.mjs`；输出逐平台核验。
