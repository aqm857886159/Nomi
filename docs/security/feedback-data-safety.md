# 反馈数据安全系统

> 防「微信聊天记录 / db_key / 私有渠道配置」进 git（一旦 push 到公开 GitHub，历史永久留存、删不掉）。
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
| ② **git pre-commit hook** | 每次 commit 扫 staged 的路径+内容（`scripts/check-no-secrets.mjs`），对**所有** git 客户端生效 | 路径黑名单 + 内容正则（db_key/wxid/群消息/微信路径） | `git commit --no-verify` |
| ③ **Claude secret-guard hook** | PreToolUse(Bash) 拦 AI/agent 的 `--no-verify` 和 `add -f` | 绕过 ①② 的两个动作 | 只对 Claude 生效 |
| ④ **gates `check:secrets`** | `pnpm run gates` 里全仓 tracked 审计（push 前兜底） | 任何历史遗留的敏感数据 | — |

要真泄露，得**同时绕过所有四层**。

## 扫的敏感物（`scripts/check-no-secrets.mjs`）

- **内容**：微信 db_key 内存格式 `x'<96 hex>'`、`db_key/session_key` 字段赋值、`wxid_*`、`<数字>@chatroom` 群 id、`xwechat_files/.../db_storage` 路径
- **路径**：`docs/feedback/*-raw.json`、`*-digest.md`、`sources.json`、`state.json`、`welive.yaml`、`*.db`、`keys.json`、`wechat-export/`

## 日常怎么用

- **正常提交**：什么都不用做——pre-commit 自动扫，干净就放行。
- **误报**（例子/文档被拦）：加进 `scripts/check-no-secrets.mjs` 的 `ALLOWLIST`（集中、可审计，别散落 inline 注释）。
- **手动全仓审计**：`pnpm run check:secrets`。

## 如果敏感数据已经泄露了（应急，按开源 remediation）

1. **立即 rotate**：db_key 泄露 = 全部聊天记录可解密。退出微信 → 重签 → 重新取钥（`scripts/welive-setup-mac.sh`），旧 key 作废。
2. **只在 working tree / staged**：`git rm --cached <file>`，确认它在 `.gitignore`，重新提交。
3. **已 commit 但没 push**：`git reset` 掉那个 commit，或 `git commit --amend` 去掉敏感内容。
4. **已 push 到 GitHub**（最严重）：删当前文件不够——secret 在历史里。用 `git filter-repo`（优于 filter-branch）重写历史移除，`--force` push 所有分支；**通知所有协作者**（旧 clone 仍有）；去 GitHub 仓库设置开 **Secret scanning + Push protection**。
5. 详见 [gitleaks](https://github.com/gitleaks/gitleaks) 的 remediation 章节。

## 装配（换机/新 worktree 时）

- **pre-commit hook**：`scripts/install-git-hooks.cjs`（`pnpm install` 的 postinstall 自动跑）装到共享 `.git/hooks`，所有 worktree 一次生效。手动补装：`node scripts/install-git-hooks.cjs`。
- **secret-guard**：注册在 `.claude/settings.json` 的 PreToolUse→Bash。`.claude/` 不随 git，换机需手动复制 `.claude/hooks/secret-guard.sh` + settings.json 那条注册（与其它 hook 同）。
