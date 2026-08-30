# 开源协议切换：Apache-2.0 → AGPL-3.0 双轨（2026-08-01）

> 历史方案：现行政策已改为只发布 AGPL-3.0-only、不要求 CLA；请以 [AGPL-only 与不要求 CLA](2026-08-29-agpl-only-no-cla.md) 为准。以下内容保留当时的决策背景，不代表当前商业授权承诺。

## 背景与拍板

- 用户诉求：开源继续当获客/反馈通道，但**公司不能白拿去改成闭源产品**；深度定制走付费（定开/商业授权）。
- 2026-08-01 用户拍板：按推荐方案执行——**AGPL-3.0 + 商业授权双轨**（MySQL/Qt 模式；同类先例 A1111=AGPL、ComfyUI=GPL）。
- 机制一句话：AGPL 不拦「个人使用/公司内部使用」（漏斗顶部保持自由），只拦「改完拿出去闭源分发/架成在线服务」——这类使用要么连源码开源、要么回来买商业授权。协议把白嫖变成销售线索。

## 范围（本次改动的全部文件）

| 文件 | 改什么 |
|---|---|
| `LICENSE` | Apache-2.0 全文 → GNU 官方 AGPL-3.0 全文（gnu.org/licenses/agpl-3.0.txt，661 行，逐字未改） |
| `package.json` | `license` 字段 → `AGPL-3.0-only` |
| `README.md` | 徽章 → AGPL-3.0；新增「协议与商业授权」小节（3 行）；尾行口径 |
| `marketing/index.html` | footer `© 2026 · Nomi · 开源 · Apache-2.0` → AGPL-3.0（官网 CF 随 push 自动部署） |
| `CHANGELOG.md` | 顶部加「协议变更」条目 |
| `CLA.md` | 新增：贡献者授权书（含「可用于商业授权轨」条款，Dify 同思路） |
| `.github/workflows/cla.yml` | 新增：cla-assistant lite（contributor-assistant/github-action@v2.6.1），签名存本仓 `signatures/cla.json`，只用 `GITHUB_TOKEN`、无需额外 secret |

## 不动项

- **历史版本不追溯**：≤v0.18.1 已按 Apache-2.0 发布，授权不可撤回，永远停在 Apache。这不是漏洞：月更节奏下旧 fork 数月即失去竞争力，真护城河是迭代速度。
- `src/config/knownVendors.ts` / `src/i18n/locales/onboardingProviders.ts` 里的 “Apache 2.0” 是**描述 Replicate 托管的第三方模型 qwen-image-layered 的协议**，与 Nomi 自身协议无关，不改。
- `docs/` 历史文档中的旧协议提法不回溯改写。
- 不新建 CONTRIBUTING.md（避免文档摊大饼）：贡献口径由 README「协议与商业授权」小节 + `CLA.md` 承载。
- 第三方依赖兼容性：npm 依赖均为宽松协议（MIT/BSD/Apache→可并入 AGPL 分发）；ffmpeg/ffprobe 以独立可执行文件 spawn 调用，属 mere aggregation，不受影响。

## 法律干净度（为什么不用挨个找贡献者签字）

- Apache-2.0 §5：提交给项目的贡献默认按 Apache-2.0 授权给项目。历史 7 位外部贡献者（Bayiyan ~119 commits 等）的代码以 Apache-2.0 并入 AGPL 组合作品是单向兼容的（Apache→GPLv3/AGPLv3 合法），署名与 git 历史保留即可。
- 对比反例：A1111 无协议起步、后补 AGPL，早期第三方 commit 成了「All rights reserved」烂账。Nomi 现在切是最便宜的时点。
- **CLA 的作用**：切换后新贡献默认按 AGPL 进来，**不签 CLA 就不能进商业授权轨**。所以 CLA 与协议同 commit 上线，一劳永逸；将来收紧、放宽、卖商业授权都有权利基础。

## 回滚

单 commit，`git revert` 即回 Apache-2.0。注意：若已发布过 AGPL 版本再回滚，该版本的 AGPL 授权同样不可撤回（对称于「老版本停在 Apache」）。

## 验收门

1. 五门 `pnpm run gates` 全过（EXIT=0 亲验，不经管道）。
2. LICENSE 头尾与行数对 gnu.org 原文核验（已做：661 行，头「GNU AFFERO GENERAL PUBLIC LICENSE / Version 3, 19 November 2007」，尾指向 gnu.org/licenses）。
3. README / CHANGELOG 渲染 spot-check；GitHub 仓库页协议自动识别为 AGPL-3.0（push 后看仓库侧栏）。
4. CLA 工作流首个 PR 实跑验证（无法本地验 Action，标注：下一个外部 PR 观察机器人是否评论）。

## 公告草稿（发布归用户手工）

### 微信群版

> 📢 Nomi 开源协议调整：Apache-2.0 → AGPL-3.0（今天起生效）
>
> 对 99% 的人零影响：
> - 个人用 Nomi 做视频（包括商用接单）→ 完全不变
> - 公司内部用、内部改 → 完全不变
> - 看源码、提 PR、fork 学习 → 完全不变
>
> 变的只有一件事：把 Nomi 改一改、换个名字**闭源**拿去卖（或架成收费网页服务）——以前协议管不了，现在必须把改动同样开源。想闭源集成 / 企业定制的朋友，欢迎直接找我谈商业授权（微信 TZ857886159）。
>
> 为什么改：Nomi 会一直开源迭代，但不想变成别人换皮产品的免费车间。AGPL 是创作工具圈的常规选择（A1111 同款，ComfyUI 的 GPL 也是同一族）。
>
> 给贡献者：历史贡献不受影响、署名都在；以后提 PR 首次会有机器人引导签一个一次性 CLA，复制一句话就行。

### GitHub Discussions / Release notes 版

> **License change: Apache-2.0 → AGPL-3.0 (dual licensing)**
>
> Starting today, Nomi is licensed under **AGPL-3.0**. Nothing changes for personal use, internal company use, forks, or contributions. What changes: shipping a modified closed-source Nomi (or offering it as a hosted service) now requires either open-sourcing your changes under AGPL, or a **commercial license** — contact the maintainer (WeChat TZ857886159 or open an issue). Previously released versions (≤v0.18.1) remain Apache-2.0. Past contributions were accepted under Apache-2.0 §5 and stay credited; future PRs sign a one-time CLA via bot.

### 给历史贡献者的说明（贡献者多的 issue/群里发）

> 各位贡献者：今天起仓库协议从 Apache-2.0 切换为 AGPL-3.0。你们此前的贡献是按 Apache-2.0 授权合入的（Apache 协议第 5 条），继续有效、署名保留，**不需要任何操作**。今后的新 PR 会有 CLA 机器人首次引导签署（一次签、永久有效）。有疑问随时找我。

## 用户待办（我做不了的）

1. **注册「Nomi」商标**（国内几百块）：协议管代码、商标管名字，换皮者真正拿不走的是牌子——防换皮性价比最高的一步。
2. **发公告**：上面三份草稿（群/Discussions/贡献者说明）按渠道发出。
3. **将来真有商业授权询单**：授权合同模板找律师过一遍。本次协议文本与 CLA 为工程落地，不构成法律意见。
4. 无需其他操作：CLA 机器人只用 GitHub 自带 token，不用装 App、不用配 secret。

## 花销

本次全程 WebSearch/WebFetch 与文本改动，未消耗模型生成额度。
