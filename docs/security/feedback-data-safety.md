# 反馈数据安全系统

> 防「明文 API key / 微信聊天记录 / db_key / 私有渠道配置」进 git（一旦 push 到公开 GitHub，历史永久留存、删不掉）。
> 建于 2026-07-15。对标开源 gitleaks / git-secrets 的 **defense-in-depth**，但轻量自包含、零依赖、只认 Nomi 的敏感物。

## 为什么需要（不是被动 gitignore 就够）

反馈雷达持续产生微信群消息（`docs/feedback/*-raw.json`、`*-digest.md`）、取钥产生 db_key（`~/welive/welive.yaml`）。这些是高敏感隐私，而且**定时 agent 无人值守自动跑**，「一不留神」提交的风险真实存在。

单靠 `.gitignore` 不够：
- `git add -f` 能强制绕过 gitignore；
- **内容级泄露**它根本挡不住——把一条群消息、一个 db_key 粘进某个 `.md`/`.ts`，gitignore 只看路径、看不到内容。

所以要主动门岗（shift-left），在提交那一刻扫内容。

## 四层防护（任一层被绕，下一层兜底）

| 层 | 机制 | 拦什么 | 能被谁绕过 |
|---|---|---|---|
| ① **gitignore（whitelist）** | `docs/feedback/` 默认全 ignore，只放行 `sources.example.json`/README；`*.db`/`welive.yaml`/`keys.json` 全局 ignore | 数据文件默认进不了 git | `git add -f` |
| ② **git pre-commit hook** | 每次 commit 扫 staged 的路径+内容（`scripts/check-no-secrets.mjs`），对**所有** git 客户端生效 | 明文凭证（API key/token）+ 路径黑名单 + 内容正则（db_key/wxid/群消息/微信路径） | `git commit --no-verify` |
| ③ **Claude secret-guard hook** | PreToolUse(Bash) 拦 AI/agent 的 `--no-verify` 和 `add -f` | 绕过 ①② 的两个动作 | 只对 Claude 生效 |
| ④ **gates `check:secrets`** | `pnpm run gates` 里全仓 tracked 审计（push 前兜底） | 任何历史遗留的敏感数据 | — |

要真泄露，得**同时绕过所有四层**。

## 扫的敏感物（`scripts/check-no-secrets.mjs`）

- **明文凭证**（`CREDENTIAL_PATTERNS`，**不受路径白名单管**，见下）：供应商前缀 key（`sk-ant-`/`sk-`/`ghp_`/`AKIA`/`AIza`/`r8_`/`hf_`/`xox*-`）、裸 32 位 hex（kie.ai 等国内厂商的 key 形状）、`api_key = "<长随机串>"` 这类关键词赋值
- **内容**：微信 db_key 内存格式 `x'<96 hex>'`、`db_key/session_key` 字段赋值、`wxid_*`、`<数字>@chatroom` 群 id、`xwechat_files/.../db_storage` 路径
- **路径**：`docs/feedback/*-raw.json`、`*-digest.md`、`sources.json`、`state.json`、`welive.yaml`、`*.db`、`keys.json`、`wechat-export/`

### 裸 32 位 hex 怎么做到不误报（不是靠加白名单）

那次真泄露的行是 `` Target: kie.ai (`<32位hex>`) ``——**一个上下文词都没有**，所以「附近有 key/token/secret」这类
收窄行不通，只能靠形状 + 熵。全仓实扫有 8 处合法的 32 位 hex（哈希文件名、sketchfab 模型 ID、无横线 UUID、
MP4 magic bytes、B站 WBI 测试向量），用两条结构判据分开，**没给它们加任何路径白名单**：

| 判据 | 滤掉什么 | 实测依据 |
|---|---|---|
| **不粘连**（前后不紧邻 `[A-Za-z0-9_-./]`） | 哈希文件名 `<hex>_<hex>.png`、URL 段里的 UUID、sketchfab 模型 ID | 这些 hex 是更大标识符的一段，不是独立凭证 |
| **熵 ≥ 3.0** | MP4 magic bytes 这类结构化 hex | 实测 magic bytes H=2.476，真凭证 H≥3.44，阈值落在空档正中 |
| **恰好 32 位** | git SHA-1(40)/SHA-256(64)——仓库里 60+ 处合法出现 | 40/64 位改由「关键词赋值」兜（要求有凭证上下文词），是刻意的精度/召回取舍 |

剩下真分不开的只有 B站 WBI 公开测试向量（形状和熵都与真 key 一致），用**行级**标记豁免，见下。

## 日常怎么用

- **正常提交**：什么都不用做——pre-commit 自动扫，干净就放行。
- **误报**——分两种，别用错：
  - **凭证类误报**：在**那一行**加注释 `nomi-secret-scan:allow <为什么不是凭证>`（必须写理由，不写不生效）。
    **不要往 `ALLOWLIST` 加路径**——路径白名单赦免整份文件，正是 2026-08-25 那次真泄露漏掉的病根（见下）。
    行级标记只赦免那一行、写在现场、review 看得见、可 grep 审计，并且有棘轮（`MAX_INLINE_ALLOWS`，只减不增）。
  - **非凭证类误报**（微信规则命中文档里的占位示例）：加进 `scripts/check-no-secrets.mjs` 的 `ALLOWLIST`。
- **手动全仓审计**：`pnpm run check:secrets`。

## 如果**明文凭证**泄露了（API key / token）

> 真实案例：一把可用的 kie.ai key 从 2026-05-28 起明文写在 `docs/onboarding-trials/fixtures/SECURITY-AUDIT.md:5`，
> 本仓库是 **PUBLIC** 的，躺了约 3 个月才在 2026-08-25 被发现。当时门岗没拦住的两个原因：
> ① 根本没有 API key 模式；② 就算有也没用——`ALLOWLIST` 的 `/docs\/.*(security|安全).*\.md$/i` 把整份文件放行了，
> 而 `scan()` 里 `if (isAllowed(f)) continue` 是**整体跳过**，路径白名单顺带赦免了内容扫描。两处都已修。

**处置顺序（第 1 步最要紧，别先去折腾 git）：**

1. **立刻去厂商后台轮换/吊销那把 key。这是唯一真正的止血。**
   公开仓库里**改 git 历史没有意义**：内容一旦 push 过就已经被 GitHub 事件流、各种镜像/爬虫、fork
   和搜索缓存抓走了；GitHub 上被 force-push 掉的 commit 仍能通过 SHA 直接访问，除非联系 GHS 清理。
   所以别把时间花在 `filter-repo` 上再慢慢去轮换——**顺序反了，泄露窗口就一直开着**。
2. **本仓库正文脱敏**：删掉明文串，换成「见 `.secrets/xxx.key`，不入库」之类的指针，正常提交。
3. **查这把 key 被用过没有**：厂商后台看调用记录/账单有没有你不认识的用量。
4. **补门岗**：确认 `scripts/check-no-secrets.mjs` 能拦住这个形状；拦不住就补规则 + 补
   `scripts/check-no-secrets.test.mjs` 的用例（正例 + 反例），别只删了事——不然下次照漏。
5. **私有仓库/尚未 push** 才值得考虑重写历史（见下面第 4 条）。
6. 去 GitHub 仓库设置开 **Secret scanning + Push protection**（免费公开仓库可用），作为第五层。

## 如果敏感数据已经泄露了（应急，按开源 remediation）

1. **立即 rotate**：db_key 泄露 = 全部聊天记录可解密。退出微信 → 重签 → 重新取钥（`scripts/welive-setup-mac.sh`），旧 key 作废。
2. **只在 working tree / staged**：`git rm --cached <file>`，确认它在 `.gitignore`，重新提交。
3. **已 commit 但没 push**：`git reset` 掉那个 commit，或 `git commit --amend` 去掉敏感内容。
4. **已 push 到 GitHub**（最严重）：删当前文件不够——secret 在历史里。用 `git filter-repo`（优于 filter-branch）重写历史移除，`--force` push 所有分支；**通知所有协作者**（旧 clone 仍有）；去 GitHub 仓库设置开 **Secret scanning + Push protection**。
   ⚠️ 但**先分清能不能撤回**：重写历史只对**私有仓库**算数。本仓库是 PUBLIC 的——公开过的内容已被抓取/fork/缓存，
   重写历史只是让它从当前分支消失，**并不等于收回**。所以凡是「换一把就能作废」的东西（API key/token），
   第一动作永远是**去厂商后台轮换**（见上一节），重写历史最多是事后清理。反过来，「换不掉」的东西
   （已泄露的聊天记录原文、用户隐私）才是真的覆水难收——那更说明门岗必须挡在 push 之前。
5. 详见 [gitleaks](https://github.com/gitleaks/gitleaks) 的 remediation 章节。

## 装配（换机/新 worktree 时）

- **pre-commit / pre-push hook**：`scripts/install-git-hooks.cjs`（`pnpm install` 的 postinstall 自动跑）安装到当前 Git hooks 配置。pre-commit 先扫 staged 敏感数据，再把同一份 staged diff 交给只读、限时的 `scripts/ponytail-review-hook.mjs`；pre-push 审 Git 传入的 outgoing ref ranges。普通 worktree 使用其 configured hooks 路径；linked worktree 只有在 `extensions.worktreeConfig=true` 时才写入专属目录，无法隔离则跳过并提示，避免一个分支改坏并行 worktree。手动补装：`node scripts/install-git-hooks.cjs`。
- **secret-guard**：注册在 `.claude/settings.json` 的 PreToolUse→Bash。`.claude/` 不随 git，换机需手动复制 `.claude/hooks/secret-guard.sh` + settings.json 那条注册（与其它 hook 同）。
