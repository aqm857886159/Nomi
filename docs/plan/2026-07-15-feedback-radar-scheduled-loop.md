# 反馈雷达 · 固定时间闭环（定时 → 读 → 分诊 → 自动修 → digest）

> 2026-07-15 · 状态：实现中
> 前身：`docs/plan/2026-06-28-feedback-radar.md`（三渠道抓取骨架，已落 main 但从没真正运转）
> 用户拍板（2026-07-15 对话）：**自动化档 = 收集+分诊+自动修 bug 在分支**；**频率 = 每天两次（早+晚）**

## 1. 这是什么 / 为什么（通俗）

反馈雷达的**抓取+分诊 skill 骨架 2.5 周前就搭好了**，但一直没跑起来——微信卡在取钥、没有定时、从没出过 digest。这次把它**变成固定运转的闭环**：每天定时两次，自动把三渠道（GitHub issue / B站评论 / 微信 nomi画布群）的用户反馈收进来 → 分诊成 bug/需求/夸/噪音 → 能复现的 bug 自动修在分支 → 出一份 digest 日报，用户 review + merge。

核心不变（延续 06-28 拍板）：**单向情报雷达，从不往任何渠道发消息**。

## 2. 用户拍板的决策（本次）

| 决策 | 选择 | 含义 |
|---|---|---|
| 自动化程度 | **收集+分诊+自动修 bug 在分支** | 能复现的**非 UI** bug 自动修在分支+五门；**UI 可见改动不自动改**（停下等走查，守 P3）；修在分支**不 push**，用户 merge |
| 频率 | **每天两次（早+晚）** | scheduled-tasks cron，Claude Code app 开着时跑，关着下次启动补跑 |

**红线（写死进 skill 编排）**：
1. 只自动修**能复现 + 非用户可见（非 UI）**的确定性 bug。UI 改动一律停下，digest 标「待你走查」，绝不自动改（P3：全绿≠体验对）。
2. 修**只停在分支**，跑五门但**不 push**（延续 06-28 铁律）。
3. 陌生人报的 bug **先复现**再修，复现不了标「待复现」，不瞎修（P2）。
4. 去重 vs 现有 GitHub issue + 历史 digest，不重复修。

## 3. 架构（复用为主，delta 极小）

```
【定时层 · 新】 scheduled-tasks (cron 每天两次)
   └─ 唤起 agent，自包含 prompt（下面「定时任务 prompt」）
        │
        ├─【抓取层 · 已有，零改动】 pnpm run feedback:radar
        │     GitHub(稳定) + B站(稳定) + 微信(WeLive，需取钥，可选优雅跳过)
        │     └→ docs/feedback/<date>-raw.json（确定性、零额度）
        │
        ├─【分诊层 · skill 已有，升级编排】 读 raw.json
        │     bug🔴 / 需求🟡 / 夸🟢 / 噪音⚪ 四档
        │     结合 Nomi 代码核实根因（grep/读组件），不凭症状猜
        │
        ├─【自动修层 · 新增编排】 能复现的 bug
        │     ├─ 非 UI（导出/数据/逻辑）→ 分支 fix/feedback-* → 五门 → 停（不 push）
        │     └─ UI 可见 → 不改，digest 标「待走查」+ 建议修法
        │
        └─【digest · 已有格式】 docs/feedback/<date>-digest.md
              一句话总览 / 🟢已自动修待merge / 🔴待走查/待复现 / 🟡需求池 / ⚪噪音计数
```

**复用清单（不重造）**：
- `scripts/feedback-radar.mjs` + `scripts/lib/feedback/*`：抓取层零改动。
- `.claude/skills/nomi-feedback-radar/SKILL.md`：分诊/修复编排——**只升级到「自动修档」**（加 UI/非UI 分流 + 定时上下文）。
- digest 格式：延续 skill 里已定义的分档结构。
- 设计系统三闸（R8/R13）、五门（R11）：UI 改动走原有流程，不新造。

## 4. 微信路的诚实评估（D4 明着标缺口）

**取钥现役方法（R5 实查 2026-07-15，纠正记忆里「必须关 SIP」的过时说法）**：
- **不用关 SIP**。微信默认 Hardened Runtime 挡内存读取，`killall WeChat` + `sudo codesign --force --deep --sign - /Applications/WeChat.app` 重签成 ad-hoc 即可，只影响微信一个 app、不降整机安全、不重启。
- **取钥用 lldb 内存扫描**（4.1.x 上 Mach VM 法会 "no memory regions found"，只有 lldb 法可行）。内存里 key 格式 `x'<64hex key><32hex salt>'`。
- 本机环境齐全：Xcode/Python 3.14/lldb/微信 4.1.10 容器（账号目录 `fu3k_mmm_5f45`）都在。

**未验证的风险（不下定论，需真机验）**：
- ⚠️ **WeLive 单 `db_key` vs 微信 4.x per-db key 模型是否匹配未验证**。WeLive 对 4.1.10 从没真跑通过。若不匹配，fallback = 用取到的 raw key 直接走 sqlcipher 解密 session.db + message.db（绕过 WeLive）。
- ⚠️ **结构性脆弱**：同类工具腾讯 2026-01 发过 DMCA（`nalzok`、`Thearas` README 已被作者清空）；微信每次更新后要重新重签取钥。

**策略**：取钥脚本我备好（`scripts/welive-setup-mac.sh`），需要用户 sudo 跑一次 + 我在旁验证 WeLive 能否导出 nomi画布群。**通不通都不连累 GitHub/B站 主体闭环**（微信 adapter 未初始化时优雅跳过）。

## 5. 不动项（明确不做）

- **不发任何消息**到任何渠道（延续）。
- **不自动 push**：修只停分支，等用户 merge。
- **不自动改 UI**：用户可见改动一律走三闸（样张+走查），定时任务里绝不自动改。
- **不接 WeChatFerry/ntchat**（Windows-only + 封号）。
- 定时任务**不花额度在抓取**（抓取纯确定性）；额度只花在分诊+修（评测/测试额度已默认授权）。

## 6. 回滚

- 定时任务：`scheduled-tasks` 删任务即停，零代码残留。
- skill 升级：git revert skill 那一个文件。
- 取钥脚本：纯新增 `scripts/welive-setup-mac.sh` + 未改微信/系统（重签是用户操作，可用 `codesign` 恢复或重装微信）。
- sources.json / raw.json / digest / state.json：全 gitignore，删即回滚。
- **零改动现有运行时代码**（Nomi app 本身不碰）。

## 7. 验收门

- [ ] GitHub 渠道端到端：抓真实 issue/评论 → 分诊 → 出一份真 digest（零成本，必做）
- [ ] 分诊正确剔除噪音（bot 部署通知、自己的回复不算用户反馈）
- [ ] 自动修档：构造/找一个能复现的非 UI bug，走通「分支→五门→停（不push）」，且 UI bug 正确停在「待走查」
- [ ] 定时任务创建成功，prompt 自包含（新 session 无上下文也能跑）
- [ ] `pnpm run gates` 全过
- [ ] 微信路（需用户 sudo）：取钥脚本跑通 → WeLive 导出 nomi画布群真实消息 → 进 raw.json（或诚实标注 WeLive 不支持 4.1.10 + fallback）

## 8. 分期

1. **主体闭环**（GitHub+B站+定时+自动修档 skill+digest）——不需用户配合，先交付验证。
2. **微信路**（取钥脚本+用户 sudo 配合+验证 WeLive）——独立步骤，随后。
