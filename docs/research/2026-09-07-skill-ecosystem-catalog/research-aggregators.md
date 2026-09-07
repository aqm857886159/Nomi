# 顶尖聚合站逆向：收录格式与展示格式

> 真实访问：skills.sh ✅ · SkillsMP ✅ · agentskills.io ✅ · LobeHub ✅ · anthropics/skills ✅（各站首页 + 热门技能详情页）。SkillRegistry.io 未访问（agentskills 生态页已足够）。2026-09-07。

## 1. skills.sh（Vercel 运营）

| 维度 | 实测 |
|---|---|
| 收录机制 | 只索引**经开放 skills CLI 发布**的公开 GitHub repo 技能（非全网爬虫）；摄取管线全开源；按匿名安装遥测排序（opt-in、每小时去重防刷）；**About 页明说无人工策展** |
| 来源组织 | URL=`/owner/repo/skill`；来源含 GitHub repo，也见 `site/open.feishu.cn`（site 域名为 ID） |
| 卡片字段 | 排名序号、技能名、owner/repo、Installs 数；同 repo 技能折叠「+N more from repo」 |
| 排序 | All Time(135万+)/ Trending(24h) / Hot 三榜 |
| 详情页 | 标题 → 安装区(Command/Prompt 双 tab) → Summary 锚点 → SKILL.md 全文 → **安全审计区** → 来源 repo |
| 安装命令 | `npx skills add <owner/repo> --skill <name>` |
| 策展 | **partner 安全审计例行执行，结果公开在每页；全部审计失败即整体剔除** |
| 投稿 | 无上传表单；「发布即收录」（经 CLI 上 GitHub） |

## 2. SkillsMP（90 万+）

| 维度 | 实测 |
|---|---|
| 收录 | 扫公开 GitHub 的 SKILL.md（含 `skills/`、`cursor-skills/` 等多形态目录），**按 U.S. SOC 职业分类法（23 组/867 细职业）自动映射**；大量「收录 ≠ 质量/安全/被采用」免责声明 |
| 详情页 | 标题+描述 → SOC 职业映射 → Source facts 表 → **Install options 三 tab（Prompt 默认/Command/Download Zip）** → 文件浏览器（列 LICENSE+SKILL.md，渲染 frontmatter）→ SKILL.md 只读预览 |
| 安装 | 默认「复制 prompt 让 Codex/Claude 先审页面再自己装」；review-first |
| 垂直页 | 组织为 职业组→细职业；**每 repo 至多 1 个技能**采样 + 完整列表折叠；多语言副本也独立收录 |

## 3. agentskills.io

非注册表，是**生态门面 + 规范站**：定义目录结构、渐进披露三阶段、48 个支持客户端 Logo 墙、`skills-ref validate` 校验器、frontmatter 字段规范（可直接当投稿表单 schema）。**没有技能列表。** → 值得抄的是"规范即表单"的做法。

## 4. LobeHub 技能市场

| 维度 | 实测 |
|---|---|
| 分类 | 16 类（含 Image & Video Generation、Notes & PKM…）；排序仅 ratingAverage/updatedAt |
| 卡片 | 图标、技能名、作者、触发式描述、评分(0–5)、评论数、使用次数、安装量、分类、日期、Featured 角标 |
| 详情页 | 标题信息区(name/author/category/rating/评论数/usage/installs/license/时间) → 描述 → **SKILL.md 全文渲染** → 用户评论列表 |
| 认证 | 无独立 Verified 徽章；官方感靠作者名(anthropics/lobehub) + Featured 标签 + 评分/评论闭环（评论含「沙箱冒烟测试」式实测证据） |
| 评论提交 | `npx -y @lobehub/market-cli skills comment <id> -c "..." --rating 5`；页面 I'm an Agent / I'm a Human 双入口 |

## 5. anthropics/skills 官方仓库

- `skills/` **平铺 17 个技能文件夹**（不按类分目录），README 文字分 creative/dev/enterprise/document；另有 `spec/`、`template/`、`.claude-plugin/marketplace.json`。
- 每技能 = 独立文件夹 + SKILL.md + 可选 scripts/references/assets。
- 约束实测：技能名禁含 "claude"/"anthropic"；description 有 1024 上限（提交记录里因超长被截）。
- 安装：`/plugin marketplace add anthropics/skills` → 按插件粒度；无投稿入口，PR 合并制。

## 6. 对建垂直聚合站的 10 条可抄清单（已并入本设计）

1. **来源可溯是地基**：URL 统一 `/owner/repo/skill`，每页永久展示来源 GitHub 链接与文件树。
2. **SKILL.md 是唯一事实源**：列表与详情描述直接用 frontmatter description（保证触发词一致），正文只读预览 + license 透出。
3. **卡片字段取最小可判集**：技能名、作者/org、owner/repo、一句描述、star/installs、更新时间。
4. **三态安装入口**：Agent-prompt(默认，先审后装) / 直接命令 / 本地下载 zip——匹配桌面库双路径。
5. **榜单要口径 + 防刷**：All Time/Trending/Hot + telemetry 去重声明；带「收录≠官方推荐」脚注。
6. **双轨分类**：领域标签（LobeHub 式，视频/图像/音频类齐全）+「内容工种」映射（SkillsMP 式，垂直站换成本行业工序/角色 taxonomy）。
7. **防刷屏采样**：同一来源折叠「+N more」或「每 repo 至多 1 个」，完整列表二级展开。
8. **安全信号四件套**：第三方审计公开 + 全挂剔除 / review-first 与「先读 SKILL.md」提示 / 评分+实测评论闭环 / Featured·官方作者徽标。
9. **校验即收录门槛**：投稿按 agentskills.io 规范跑 name≤64 / description≤1024 / 保留词 / license，失败拒收。
10. **机器可读为桌面端铺路**：public API 与页面同数据源、SKILL.md 聚合清单、agent/human 双入口、评论 CLI 化。
