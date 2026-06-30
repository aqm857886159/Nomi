# Feedback Radar —— 三渠道单向反馈雷达

> 2026-06-28 · 状态：实现中 → 第①期(GitHub) 先落地，②(B站) ③(微信) 随后
> 决策已拍板：**单向收集**（不回话）+ **修在分支上等用户拍板**（见对话 2026-06-28）

## 1. 这是什么 / 为什么

把散在三个渠道的用户反馈**单向收进来**，分诊成 bug/需求/噪音，能复现的 bug 修在分支上等用户拍板。
**不是聊天机器人**——风险和翻车几乎全在「往群里/评论区发消息」那一半，而我们不需要发。
本质和 `nomi-research-radar` 同骨架：**脚本只管确定性抓取，skill 管 LLM 分诊 + 修复编排**。

## 2. 三渠道难度与风险（实查 2026-06-28，见对话 Sources）

| 渠道 | 读取 | 关键约束 | 风险 |
|---|---|---|---|
| GitHub issues | 官方 API，无需 token（公开仓库） | repo 从 git remote 推断（aqm857886159/Nomi） | 零 |
| B站评论 | 非官方但稳定的 `reply/wbi/main` | 需 WBI 签名 + bv2av + 浏览器 UA + dm_img_* 防 -352 | 低（只读、可匿名） |
| 微信群 | WeLive CLI 只读导出 JSONL | 见下「微信前置」 | 只读≈零，但取钥要关 SIP |

微信收发类框架（WeChatFerry/ntchat）**全 Windows-only**；原 chatlog 已被微信官方发函下架（2025-10）。
macOS 上现役干净路 = **WeLive**（chatlog 维护中的继任，github.com/hicccc77/WeLive-release）只读导出。

### 微信前置（macOS，2026-06-28 实测确认）
WeLive 在 macOS 上**不自动取微信库密钥**（只 Windows 自动）。本机实测：微信 4.1.10、SIP enabled → `welive init` 只到 `needs_keys`。要跑通微信渠道：
1. **临时关 SIP**（重启进 Recovery，`csrutil disable`，再重启）——这是降系统安全等级的不可逆决策，**只能用户本人物理操作**，是整条微信链路唯一的人工卡点。
2. 关 SIP 后才能读微信进程内存取 `db_key`，填进 `welive.yaml` → `welive init` 到 `status:ok`。
3. 之后 adapter 全自动：`welive sessions` 找群 → `welive export-session --jsonl` 导出群消息。

WeLive 已装在 `~/welive/`（本机）。adapter 在未初始化时优雅跳过，不连累 GitHub/B站。

## 3. 分层（R9，单文件 ≤800 行）

```
scripts/feedback-radar.mjs            orchestrator CLI（串 adapter→去重→写 raw.json + 摘要）
scripts/lib/feedback/
  normalize.mjs                       FeedbackSignal 形状 + 稳定 id + seen 状态 + 配置加载
  github.mjs                          GitHub issues/评论 adapter
  bilibili.mjs                        WBI 签名 + bv2av + 评论 adapter（含单测）
  bilibili.test.mjs                   bv2av/mixinKey 已知向量校验
  wechat.mjs                          chatlog HTTP adapter（服务没起优雅跳过）
docs/feedback/
  sources.example.json                配置模板（用户复制成 sources.json 填自己的渠道）
  sources.json                        用户真实渠道（gitignore，不入库）
  state.json                          seen 去重状态（gitignore）
  <date>-raw.json                     当轮归一化信号（脚本产物）
  <date>-digest.md                    分诊后人看的日报（skill 产物）
.claude/skills/nomi-feedback-radar/   分诊 + 修复编排技能
```

## 4. 数据流

```
3 adapter → FeedbackSignal{source,sourceId,author,text,url,createdAt,raw}
  → 按稳定 id 去重（vs state.json 已见集）
  → 写 docs/feedback/<date>-raw.json + 打印摘要
  → [skill] 读 raw → 分诊(bug/需求/夸/噪音) + 去重 vs 现有 GitHub issue
  → [skill] 能复现的 bug：定位 file:line → 建分支 → 修 → 跑五门 → 停在分支等拍板
  → [skill] 写 docs/feedback/<date>-digest.md：已修 N(待你 merge) / 待你拍板 M / 噪音 K
```

## 5. 不动项（明确不做）

- **不发任何消息**到任何渠道（不回评论、不回群）。脚本里没有任何 POST 到外部的代码。
- **不自动 push 修复**：修只停在分支，等用户 merge（拍板档已选）。
- 不接 WeChatFerry/ntchat（Windows-only + 封号）。微信只走 chatlog 只读。
- 脚本不调 LLM、不花额度：抓取是纯确定性的；分诊/修复由 skill 的 agent 做。

## 6. 回滚

纯新增，无改动现有运行时代码。回滚 = 删 `scripts/feedback-radar.mjs` + `scripts/lib/feedback/` + skill 目录 + package.json 那一行 + vitest include 那一行。零耦合。

## 7. 验收门

- [ ] GitHub adapter 真跑通：拉到本仓真实 open issues，归一化正确（零成本，必做）
- [ ] Bilibili adapter 真跑通：WBI 签名对一个公开视频返回 code=0 评论（零成本，必做）
- [ ] bv2av/mixinKey 单测过已知向量（`BV1L9Uoa9EUx`→111298867365120）
- [ ] 微信 adapter：chatlog 没起时优雅跳过并给出清晰指引（真接需用户开 chatlog）
- [ ] 去重幂等：同日重跑不重复产信号
- [ ] `pnpm run gates` 全过
- [ ] skill 能读 raw → 出一份 digest（在本仓 issue 上真走一遍）

## 8. 分期

1. **第①期 GitHub**（零风险零成本，先验证整条闭环）
2. **第②期 B站**（加 WBI adapter）
3. **第③期 微信**（接 chatlog）

三期一次性把代码都建齐，差别只在用户要不要在 sources.json 里填对应渠道 + 微信要不要开 chatlog。
