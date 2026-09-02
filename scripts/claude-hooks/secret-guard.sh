#!/usr/bin/env bash
# PreToolUse(Bash) hook：安全门岗**加固层**——防 AI / 定时 agent 用「绕过」手法把敏感数据
# （微信聊天记录 / db_key / 私有配置）塞进 git。
#
# 核心扫描在 git pre-commit hook（scripts/check-no-secrets.mjs，对所有 commit 生效）。
# 本 hook 只专拦「绕过 pre-commit」的两条路（AI/agent 没有正当理由走它们）：
#   ① git commit --no-verify / -n  → 唯一能跳过 pre-commit 的方式，禁止。
#   ② git add -f / --force          → 强制 add 被 .gitignore 挡掉的文件（多半是微信数据），禁止。
#
# fail-open：脚本自身任何异常一律放行（exit 0），绝不卡死正常 git 操作。
set +e

INPUT="$(cat)"

# 命令怎么理解，交给两个 Bash 闸门共用的那一层。此前这里用的是
# `git[[:space:]]+commit[[:space:]]+...--no-verify` 这类正则，与 pre-push 犯同一类错——
# 2026-09-02 实测：`git -c k=v commit --no-verify`、`git -C <path> commit --no-verify`、
# `git --no-pager commit --no-verify`、`git -c x=y add -f` 四种写法**全部漏放**
#（git 与子命令之间隔了全局选项，正则要求二者紧邻），而 `echo "git commit --no-verify"` 被误拦。
ANALYSIS_LIB="$(dirname "$0")/_bash-command-analysis.sh"
[ -f "$ANALYSIS_LIB" ] || exit 0   # 本 hook 按设计 fail-open（核心扫描在 pre-commit，见抬头）
# shellcheck source=/dev/null
. "$ANALYSIS_LIB"

PARSED="$(printf '%s' "$INPUT" | analyse_bash_command)"
CALLS="$(printf '%s\n' "$PARSED" | sed -n '3,$p')"
[ -n "$CALLS" ] || exit 0          # 没有 git 调用 → 放行（引号里的词组不算）

COMMIT_FLAGS="$(printf '%s\n' "$CALLS" | awk -F'\t' '$1=="commit"{print $3}')"
ADD_FLAGS="$(printf '%s\n' "$CALLS" | awk -F'\t' '$1=="add"{print $3}')"

# ① git commit --no-verify / -n（跳过 pre-commit 安全扫描）
if flag_has "$COMMIT_FLAGS" n --no-verify; then
  cat >&2 <<'EOF'
⛔ 安全门岗：git commit --no-verify / -n 会跳过 pre-commit 敏感数据扫描。
反馈雷达持续产生微信聊天记录 / db_key，这类绝不能进 git（会 push 到公开 GitHub、历史永久留存）。
去掉 --no-verify 正常提交，让安全门岗扫过 staged 内容再放行。
EOF
  exit 2
fi

# ② git add -f / --force（强制 add 被 gitignore 保护的文件）
if flag_has "$ADD_FLAGS" f --force; then
  cat >&2 <<'EOF'
⛔ 安全门岗：git add -f / --force 会强制加入被 .gitignore 挡掉的文件。
docs/feedback/ 下的微信记录、welive.yaml、db_key、*.db 正是靠 .gitignore 保护的。
如确需 add 某个安全文件，去掉 -f，并确认它不匹配 .gitignore 的敏感规则。
EOF
  exit 2
fi

exit 0
