# 每日雷达与三日竞品雷达（L2）

> 从 CLAUDE.md 搬来。**现在由 SessionStart hook（`scripts/claude-hooks/daily-radar.sh`）直接跑脚本并把结果注入会话**，不再靠 agent 自觉在第一条消息里去跑；失败时 hook 会明说「今天没查成」。本文是细则与分诊规矩。
>
> **hook 的三条不变量**（`scripts/daily-radar-session.mjs`）：
> 1. **一台机器一天只跑一次，标记和当天摘要放仓库外**（intake 缓存目录下的 `daily-radar.json`，`NOMI_INTAKE_CACHE` 可改）；后开的会话直接拿缓存摘要（带跑的时间）。因为用户反馈雷达的增量状态（seenKeys）是整台机器共享的——标记若放在各自的 worktree 里，先开的会话会把「新反馈」吃掉，后开的协调会话就只看到「新增 0」。失败的不记成功，下次会话重试。
> 2. **hook 不动工作树里任何文件**：模型雷达的运行结果（`latest.json`、`liveness.json`）也在仓库外（intake 缓存目录下的 `model-radar/`，唯一输出位置）；基线快照 `docs/research/model-radar/{apimart,kie}.json` 照旧进仓库，只由 `-- --update-baseline` 写。
> 3. **hook 路径里没有扣费请求**：模型雷达带 `--no-liveness`，跳过每周一次的存活探测（那是向供应商发真实付费请求）；手动跑 `pnpm run radar:models` 仍会探测。
>
> 两个雷达并行跑。**分诊只由协调会话做；其他会话看到不动手、不写待办。**
>
> **技能不在就明说，不叫人去跑**：hook 对仍有技能的两个雷达（用户反馈 `nomi-intake-radar`、三日竞品 `nomi-competitive-radar`）先查 `agent-skills/<名>/SKILL.md`、`.claude/skills/<名>/SKILL.md`、`~/.claude/skills/<名>/SKILL.md`；不在就输出「技能 X 在这台机器上没有，今天没查成」。**论文雷达改为按需（2026-10-01 用户拍板），不再每日提醒**——用户想看时由协调会话跑；**模型雷达不恢复技能，分诊一律按 `docs/plan/2026-08-27-vendor-model-radar.md` 的规则由协调会话手做**。三日竞品雷达、分诊这几句要动手的提醒前面都有「只由协调会话做」。

**③ 用户反馈雷达**：（SessionStart hook 已跑） `pnpm run intake:radar`（从 Cloudflare 增量拉用户反馈 / 匿名用量事件 / Agent 轨迹，算成功率、错误码排行、和上一窗口比的突增）。凭据由官方 `npx wrangler auth token --json` 提供（OAuth 过期由 Wrangler 自动刷新；账号 id 用 `NOMI_CF_ACCOUNT_ID` 或 `npx wrangler whoami`），脚本不读 Wrangler 配置文件。确定性脚本，不烧额度；待分诊不为 0 或有突增时才起 `nomi-intake-radar` 技能做分诊（归真 bug / 配置问题 / 体验问题 / 数据上报问题，挂私有待办）。脚本报错 = 明说「今天没查成」，**不许**说成「没有新反馈」。原始数据与报告只落仓库外缓存目录（`%LOCALAPPDATA%\nomi-intake\`，可用 `NOMI_INTAKE_CACHE` 改），不进仓库、不进提交。

**「新增」和「待分诊」是两个数**：「新增 N 条」只回答这一轮多了什么，看过一次就清零；「待分诊 N 条」回答还有几条没人管，来自缓存目录的 `inbox.json`，hook 每次开会话现读（不走缓存摘要，脚本跑败也照报）。进账是自动的，出账必须说清记到了哪个待办：`pnpm run intake:radar -- --triaged <编号…> --todo <待办号或说明>`。每轮一份报告，文件名到秒，同一天多跑不会互相覆盖。

**② 供应商模型雷达**：（SessionStart hook 已跑，带 `--no-liveness`）`pnpm run radar:models`（apimart / kie 有没有上新生图/生视频/音频模型）。确定性脚本，不烧额度；`新增 > 0` 时按 `docs/plan/2026-08-27-vendor-model-radar.md` 的分诊规则由协调会话手做。脚本报错 = 明说「今天没查成」，**不许**说成「没有新模型」。用户点头要接某个 → **先出接入方案**（契约摘要+档案设计+分档理由），点头后才写码。快照要等用户看过再 `-- --update-baseline`。

**① 论文雷达**：**改为按需（2026-10-01 用户拍板），不再每日提醒**；用户想看时由协调会话跑，出 `docs/research/<今天>-radar.md`（筛选维度：最新·火不火·有没有用·成熟度，低于 bar 的筛掉）。

## 三日竞品学习雷达

**对标名单见私有仓 Nomi-service 的 `research/competitive/ROSTER.md`，公开主仓不写竞品名。** 产品、设计、引导、功能交互、Agent、生态、社区与自媒体营销统一走 [`nomi-competitive-radar`](../../agent-skills/nomi-competitive-radar/SKILL.md)。**报告与原始抓取只落私有仓的 `research/competitive/<日期>/`，绝不在公开主仓提交、绝不开公开 PR**；本机定位私有仓读环境变量 `NOMI_PRIVATE_REPO`，没设就明说「今天没查成」，不许落回公开仓。公开仓 docs 下的 [竞品资料目录](../research/competitive/README.md) 只留一个指路 README，`check:skills-format` 守这一条。每个 Nomi session 首轮检查到期/未完成周期；每 3 天扫描全部对象并轮换深挖，和本机定时器共用规程中的去重/锁/检查点。用户明确只建流程时不展开调研。实际交互要鼠标操作与录屏回看，自媒体用 TikHub + 原站观看；失败不能记“无更新”，研究建议不能自动变成开发或发布授权。
