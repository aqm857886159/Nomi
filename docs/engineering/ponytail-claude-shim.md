# 用 Claude Code 跑 Ponytail 评审（临时壳）

R25 要求每次 commit / push 前真跑一次 `/ponytail-review`。默认执行者是 `codex exec`。
Codex 账号额度用尽期间（本次：恢复日 **2026-09-11**），`scripts/ponytail-review-hook.mjs`
会稳定 fail-closed，所有提交和推送都被拦住。

`scripts/ponytail-review-claude-shim.mjs` 把同一次评审换到 Claude Code CLI 上执行。
**这不是绕过闸门**：同一份 diff、同一份评审规则、同一套结果标记，只是换了跑模型的宿主。
钩子本身一行没改，`node --test scripts/ponytail-review-hook.node-test.mjs` 25/25 仍绿。

## 它是怎么接上的

钩子对评审器的全部契约只有三条：接受 Codex 那串参数、从 stdin 拿 prompt、把最终报告写进
`--output-last-message` 指到的文件。所以任何满足这三条的可执行文件都能通过
`PONYTAIL_REVIEW_CODEX_BIN` 顶上去。壳做的就是：

1. 从 Codex 参数里只取 `--output-last-message` 和 `--cd`，其余忽略；
2. 从 stdin 读钩子拼好的评审 prompt（含精确的 staged / outgoing diff）；
3. 把**已安装的 Ponytail skill 原文**（`~/.codex/plugins/cache/ponytail/ponytail/<版本>/skills/ponytail-review/SKILL.md`）
   逐字塞进 `--append-system-prompt`，再补一段「输出传输契约」——因为 skill 本身不知道钩子
   分类器要的那行 `PONYTAIL_REVIEW: PASS|FINDINGS` 标记；
4. 跑 `claude --print --output-format text`，把最终文本写进报告文件，退出 0。

**评审规则的真相源仍然是那份 skill 文件，壳不自己编一套。** 找不到 skill 就直接失败，
不会退化成「Claude 用自己的风格随便审一下」。

## 只读保证

壳里没有任何写仓库的动作，`claude` 那一侧叠了四层：

- `--tools ''` —— 一个工具都不给。评审只需要 prompt 里的 diff，不需要读盘、不需要跑命令。这是最硬的一层。
- `--permission-mode manual` + `--permission-prompts none` —— 任何会弹权限的动作直接拒绝。
- `--safe-mode` + `--strict-mcp-config` —— 关掉 CLAUDE.md / skills / plugins / hooks / MCP。既让这一轮保持干净，也防止「git hook 触发 claude、claude 又触发自己的 hook」这种回环。
- `cwd` 设成临时目录，**不在仓库里跑** —— 从根上取消它碰到工作树的可能。

外加 `--no-session-persistence`，对齐 Codex 那边的 `--ephemeral`。

## 全部 fail-closed 的路径

壳只在拿到非空模型输出后才写报告文件；在那之前的任何失败都让报告保持钩子预建的 0 字节，
钩子于是判 `runner_failed` 并拦住 Git。已实测的路径见下方验证表。

超时：壳自限 165s（可用 `PONYTAIL_REVIEW_CLAUDE_TIMEOUT_MS` 调，上限 175s），压在钩子的
`REVIEW_TIMEOUT_MS = 180s` 之下，好让超时由壳报出来而不是被信号砍掉。

## 怎么设 env

### 推荐：写进 `~/.zshenv`

```sh
echo 'export PONYTAIL_REVIEW_CODEX_BIN="/Users/aoqimin/Desktop/Nomi/scripts/ponytail-review-claude-shim.mjs"' >> ~/.zshenv
```

**为什么是 `~/.zshenv` 而不是命令前缀**：git hook 是 git 自己起的子进程，你没机会在它前面加
环境变量——`PONYTAIL_REVIEW_CODEX_BIN=... git commit` 虽然能生效（子进程继承），但这台机器上
常年挂着 20+ worktree，每次 commit 和每次 push 都要记得加前缀，漏一次就是一次被拦。
zsh 的**所有**非交互 shell（git hook、Claude Code 的 Bash 工具、脚本）都会 source `~/.zshenv`
（`~/.zshrc` 只对交互 shell 生效，**不要写那里**），所以它是唯一一处能一次覆盖全部入口的地方。

漏设的后果是「被拦」而不是「静默放行」，所以这条路是安全的：忘了设，只是提交不了。

**路径要指向哪一份**：上面写的是主仓库路径，**本分支合并进 `main` 之后**才存在。合并前先指向
当前工作树里的那份：

```sh
export PONYTAIL_REVIEW_CODEX_BIN="/Users/aoqimin/Desktop/Nomi/.claude/worktrees/gpt-discussion-review-06eb91/scripts/ponytail-review-claude-shim.mjs"
```

注意 `resolveCodexBinary` 对「带 `/` 但不存在」的路径直接抛错，所以一旦那棵 worktree 被删掉，
**所有仓库的提交都会被拦**（不会偷偷退回 Codex）。这是刻意的 fail-closed，但换路径时要记得
同步改 `~/.zshenv`。

### 前置条件：`claude` 必须自己登录过

壳跑的是**独立的 `claude` 进程**，它不共享 Claude Code 桌面宿主的登录态。当前这台机器上
standalone `claude` 是未登录的（keychain 里默认那条 credentials 是空的，带 profile 后缀那条
2026-08-23 就过期了），任何 `claude --print` 都会直接：

```
Failed to authenticate: OAuth session expired and could not be refreshed
```

**用之前必须先在终端里跑一次 `claude`，执行 `/login` 走完 OAuth**（或 `claude setup-token`
后 export `CLAUDE_CODE_OAUTH_TOKEN`）。没登录的话钩子会 fail-closed —— 拦得对，但拦的原因
是登录不是评审。验证登录是否够用：

```sh
printf 'Reply with exactly: OK' | claude --print --output-format text
```

## 可选 env

| 变量 | 作用 | 默认 |
|---|---|---|
| `PONYTAIL_REVIEW_CODEX_BIN` | 让钩子改用这个壳 | `codex` |
| `PONYTAIL_REVIEW_CLAUDE_BIN` | 壳调用的 claude 可执行文件 | `claude`（走 PATH） |
| `PONYTAIL_REVIEW_CLAUDE_MODEL` | 传给 `--model` | 不传，用 CLI 默认 |
| `PONYTAIL_REVIEW_CLAUDE_TIMEOUT_MS` | 壳自限超时，上限 175000 | `165000` |
| `PONYTAIL_REVIEW_SKILL_PATH` | 指定 Ponytail skill 原文路径 | `~/.codex/plugins/cache/ponytail/ponytail/` 下版本号最大的那份 |

## 已验证

在一次性 worktree `/Users/aoqimin/Desktop/Nomi-ponytail-shim-test`（`origin/main` @ `18e510da`）
上，对同一个 staged 改动（`docs/release-process.md` 加一行）直接跑
`PONYTAIL_REVIEW_CODEX_BIN=<壳> node scripts/ponytail-review-hook.mjs --scope staged`：

| 场景 | 钩子分类 | 退出码 |
|---|---|---|
| 干净报告（三行 PASS 形状） | `pass` | 0 |
| 有发现报告（发现行 + `net:` + `FINDINGS`） | `completed with findings` | 0 |
| 模型输出不合格式（寒暄一句） | `invalid_review` → BLOCKED | 1 |
| 评审器崩溃（非 0 退出） | `runner_failed` → BLOCKED | 1 |
| `claude` 可执行文件不存在 | `runner_failed` → BLOCKED | 1 |
| skill 原文找不到 | `runner_failed` → BLOCKED | 1 |
| 真 `claude`（未登录） | `runner_failed` → BLOCKED | 1 |

同时核对过壳真的把「skill 全文 + 传输契约」放进了 `--append-system-prompt`、把带 diff 的
prompt 放进了 stdin。

**还没验的一条**：因为 standalone `claude` 未登录，**真模型跑出的评审内容**（包括故意塞一段
过度工程化代码看它报不报阻断）没能跑通。登录之后按上面的步骤复跑一次即可补上——阳性对照建议
staged 一段明显的 `yagni`/`stdlib` 代码，期望拿到 `completed with findings`。

## 什么时候撤掉

Codex 额度恢复（2026-09-11）后：

```sh
# 从 ~/.zshenv 删掉那行，然后开个新 shell
sed -i '' '/PONYTAIL_REVIEW_CODEX_BIN/d' ~/.zshenv
```

钩子随即回到 `codex` 默认路径。壳留在仓库里当额度/宿主故障时的备用执行器即可；
真要清掉的话，一并删掉本文档和 `scripts/ponytail-review-claude-shim.mjs`（R1 加新必删旧）。
