#!/usr/bin/env bash
# PreToolUse hook（命中 Bash 里的推送命令）= push 前的**真闸门**（R11 + P3 决策点强制）。
# 设计见 docs/plan/2026-06-17-discipline-system-overhaul.md（杠杆 1）。
#
# 规则：
#  · 命令里没有推送 → 放行（exit 0）。
#  · outgoing 改动全是 doc/hook（.md / docs/ / .claude/）→ 放行（这类不需五门，R11 例外）。
#  · 本 worktree 自己的五门戳（`$GIT_DIR/nomi-gates-ok`，`pnpm run gates` 全过时盖）**三项全对** → 放行：
#      ① 30 分钟内盖的  ② 盖戳的 worktree 就是这棵  ③ 盖戳时的 HEAD 就是现在的 HEAD
#  · 否则 → **block(exit 2)** 弹清单，逼我先过五门 + 完成对账 + 真机走查。
#  · **fail-open 只留给「连仓库根都拿不到」**；戳本身的三项判定一律 fail-closed。
#
# 2026-09-02 一天内两次实测，说明这三项缺一不可（此前的戳只有「主仓固定路径 + mtime 新鲜」两维）：
#   · 误放——sibling worktree 里 gates 实际 exit=1 的分支，被主仓里一枚别处盖的旧戳放上了远端；
#   · 误杀——nomi-brand-mark 里 gates 连过两轮，仍被会话树那枚过期戳拦了三次。
# 根因同一个：戳**不认树、也不认提交**，只认一个固定路径和时间。所以戳落进
# `git rev-parse --absolute-git-dir`——git worktree 的 gitdir 一树一份（主仓 `.git/`，
# worktree 是 `.git/worktrees/<name>/`），物理上不可能互相顶用——再带上树路径与 HEAD 两维身份。
#
# 2026-09-02 第二轮：**判「是不是推送、推的哪棵树」不再用正则猜命令字符串**。
# 旧写法用 `grep -E 'git[[:space:]]+push'` 加一段 sed 抓第一个 `cd`，四个方向实测全漏：
#   · `git -C <另一棵树> push` —— git 与 push 之间隔了全局选项，正则匹配不到，闸门**根本不运行**；
#     于是本树那枚有效戳给另一棵**没过五门**的树背了书（这正是闸门要防的误放）；
#   · `git -c k=v push` / `git --no-pager push` —— 同上，匹配不到；
#   · `cd A && cd B && git push` —— sed 取的是**第一个** cd，而推送发生在 B，拿 A 的戳判 B 的推送；
#   · 反向误伤：`echo "git push"` / `grep -rn "git push" docs/` 这类只读命令被当成推送拦下
#     （开发中真实撞到两次）——而会误报的闸门用不了几次就会被人绕过。
# 根因是**用正则去理解 shell 语法**。改成让已有的那次 python3 顺手做词法分析（`shlex`）：
# 引号内的内容成为单个 token（所以 echo/grep 里的词组不再命中）、只在**命令位置**认 git、
# 认全局选项后再判 push、`cd`/`pushd` 按顺序累积（末个 cd 才是推送发生地）、`-C` 优先。
# 没加进程：JSON 解析本来就要跑这一次 python3。
set +e

INPUT="$(cat)"

# ── push 绕口留痕（2026-09-03）───────────────────────────────────────────────
# 检测 `git -c core.hooksPath=...` 或 `git --no-pager -c core.hooksPath=...` 等变体。
# 目的：留痕而非禁止——绕口被写进 .claude/push-bypass.log，`check:push-bypass` 门岗审计。
# 只读 INPUT 一次，不影响下面的词法分析流程。
_raw_cmd="$(printf '%s' "$INPUT" | python3 -c '
import sys,json
try: print(json.load(sys.stdin).get("tool_input",{}).get("command",""))
except: print("")
' 2>/dev/null)"

if printf '%s' "$_raw_cmd" | grep -q 'push' && printf '%s' "$_raw_cmd" | grep -qE 'core\.hooksPath|--no-verify'; then
  _ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date +%Y-%m-%dT%H:%M:%SZ)"
  _log_root="${CLAUDE_PROJECT_DIR:-$(git -C "${HOOK_CWD:-$PWD}" rev-parse --show-toplevel 2>/dev/null)}"
  if [ -n "$_log_root" ]; then
    mkdir -p "$_log_root/.claude"
    _bypass_log="$_log_root/.claude/push-bypass.log"
    # 尽力抓分支和 SHA（失败只是字段空，不影响主流程）
    _br="$(git -C "${HOOK_CWD:-$PWD}" branch --show-current 2>/dev/null || echo '')"
    _sha="$(git -C "${HOOK_CWD:-$PWD}" rev-parse HEAD 2>/dev/null || echo '')"
    _wt="$(git -C "${HOOK_CWD:-$PWD}" rev-parse --show-toplevel 2>/dev/null || echo '')"
    # 命令截断（避免超长行）
    _cmd_short="$(printf '%s' "$_raw_cmd" | head -c 200)"
    printf '%s|bypass|branch=%s|sha=%s|worktree=%s|cmd=%s|confirmed=no\n' \
      "$_ts" "$_br" "$_sha" "$_wt" "$_cmd_short" >> "$_bypass_log"
    printf '⚠️  push 绕口已记录（%s）。本次 push 将照常执行，但 check:push-bypass 门岗会要求解释。\n' \
      "$_bypass_log" >&2
  fi
fi
# ─────────────────────────────────────────────────────────────────────────────

# 命令怎么理解，交给两个 Bash 闸门共用的那一层（见 _bash-command-analysis.sh 的抬头注释：
# 此前两个闸门各用一套正则，犯的是同一类错）。这段**每条 Bash 命令都要跑**，
# 所以进程数是所有命令共担的交互延迟：保持恰好一次 python3。
ANALYSIS_LIB="$(dirname "$0")/_bash-command-analysis.sh"
# 共用层缺失 = 我们失去了理解命令的能力。不猜：只要命令里出现 push 就拦（fail-closed）。
if [ ! -f "$ANALYSIS_LIB" ]; then
  printf '%s' "$INPUT" | grep -q 'push' && {
    printf '⛔ push 闸门：命令理解层 %s 缺失（跑 `pnpm install` 重装 hook），不允许在读不懂的情况下放行。\n' \
      "$ANALYSIS_LIB" >&2
    exit 2
  }
  exit 0
fi
# shellcheck source=/dev/null
. "$ANALYSIS_LIB"

PARSED="$(printf '%s' "$INPUT" | analyse_bash_command)"
STATUS="$(printf '%s\n' "$PARSED" | sed -n '1p')"
HOOK_CWD="$(printf '%s\n' "$PARSED" | sed -n '2p')"
# 只取 push 那些行的目录列（第 2 列）。
TARGETS="$(printf '%s\n' "$PARSED" | sed -n '3,$p' | awk -F'\t' '$1=="push"{print $2}' | sed '/^$/d')"

block_plain() {
  cat >&2 <<EOF
⛔ push 闸门（R11 + P3）：$1

push 前必须先在**推送发生的那棵树里**跑 \`pnpm run gates\`（全过自动盖戳放行）。
若确已过五门只是没走 gates 脚本：\`node ./scripts/stamp-gates-ok.mjs\`。
EOF
  exit 2
}

# 词法分析失败 = 我们读不懂这条命令。**不猜**：只要它里面出现 push 就拦（fail-closed）。
if [ "$STATUS" != "ok" ]; then
  printf '%s' "$INPUT" | grep -q 'push' &&
    block_plain "这条命令无法可靠解析（引号不配对？），但里面出现了 push——不允许在读不懂的情况下放行。"
  exit 0
fi

# 没检测到推送 → 放行。引号里的词组不算（`echo \"git push\"` 不会走到这里）。
[ -n "$TARGETS" ] || exit 0

# 一组文件是否**全是** doc/hook（这类不需五门）。空列表 → 判不了 → 不放行。
is_docs_only() {
  [ -n "$1" ] || return 1
  printf '%s\n' "$1" | grep -Ev '(\.md$|\.txt$|^docs/|^\.claude/)' | grep -q . && return 1
  return 0
}

block() {
  cat >&2 <<EOF
⛔ push 闸门（R11 + P3）：$1

  推送的 worktree：$ROOT
  本树的五门戳：  $MARKER

push 前必须：
  1) 五门全过 —— 在**这棵树里**跑 \`pnpm run gates\`（filesize→tokens→lint→typecheck→test→build，
     全过自动盖戳放行）。戳只对这棵树、这个 HEAD、30 分钟内有效——别处的戳不作数。
  2) 用户可见改动？—— 和获批样张逐项对账 + 真机走查（截图人眼判断），全绿 ≠ 完成（P3/R13）。
若确已过五门只是没走 gates 脚本：\`node ./scripts/stamp-gates-ok.mjs\`（老 checkout 里没有这个
文件的，先把 origin/main 并进来）。
（doc/hook-only 改动会自动放行，不会卡到这里。）
EOF
  exit 2
}

# 逐棵校验：一条命令可以推多棵树（`cd A && git push && cd B && git push`），
# 任意一棵不合格就拦——闸门的判据是「每一棵被推的树都过了五门」。
while IFS= read -r TARGET; do
  [ -n "$TARGET" ] || continue

  [ "$TARGET" = "?" ] &&
    block_plain "命令用 --git-dir/--work-tree 指定了推送目标，无法可靠还原是哪棵树——请直接在目标树里推送。"

  ROOT=""
  for CANDIDATE in "$TARGET" "$HOOK_CWD" "$CLAUDE_PROJECT_DIR" "$PWD"; do
    [ -n "$CANDIDATE" ] && [ -d "$CANDIDATE" ] || continue
    ROOT="$(cd "$CANDIDATE" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)"
    [ -n "$ROOT" ] && break
  done
  [ -z "$ROOT" ] && continue   # 连仓库根都拿不到 → 唯一的 fail-open

  cd "$ROOT" 2>/dev/null || continue
  GITDIR="$(git rev-parse --absolute-git-dir 2>/dev/null)"
  [ -z "$GITDIR" ] && continue
  MARKER="$GITDIR/nomi-gates-ok"

  # 没有 outgoing commits（已同步/无新提交）→ 这棵树的推送是 no-op，看下一棵。
  if git rev-parse origin/main >/dev/null 2>&1 && [ -z "$(git log origin/main..HEAD --oneline 2>/dev/null)" ]; then
    continue
  fi

  # outgoing 改动全是 doc/hook → 放行这棵。拿不到文件列表就继续往下验戳（不放行也不误杀）。
  is_docs_only "$(git diff --name-only origin/main...HEAD 2>/dev/null)" && continue

  # —— 到这里 = 这棵树有代码改动，开始验戳：三项全对才放行 ——
  [ -f "$MARKER" ] || block "本次有代码改动，但**这棵 worktree** 没有「五门刚过」的戳。"

  # ① 新鲜度
  [ -n "$(find "$MARKER" -mmin -30 2>/dev/null)" ] || block "五门戳超过 30 分钟，已过期。"

  STAMP_SHA="$(sed -n 's/^sha=//p' "$MARKER" | head -1)"
  STAMP_WT="$(sed -n 's/^worktree=//p' "$MARKER" | head -1)"
  [ -n "$STAMP_SHA" ] && [ -n "$STAMP_WT" ] || block "五门戳格式不认识（旧版那个只有时间的空文件？），不能作为凭据。"

  # ② 认树：戳被拷贝/继承过来的一律不作数
  [ "$STAMP_WT" = "$ROOT" ] || block "这枚戳盖的是另一棵 worktree（$STAMP_WT），不能给本次推送背书。"

  # ③ 认提交：盖完戳又提交了代码 = 那份代码没过门
  HEAD_SHA="$(git rev-parse HEAD 2>/dev/null)"
  if [ "$STAMP_SHA" != "$HEAD_SHA" ]; then
    DELTA=""
    git merge-base --is-ancestor "$STAMP_SHA" HEAD 2>/dev/null && DELTA="$(git diff --name-only "$STAMP_SHA"..HEAD 2>/dev/null)"
    # 盖戳后只补了 doc/hook → 用与上面同一把尺放行；只要沾代码就得重新过门。
    is_docs_only "$DELTA" || block "戳盖在 ${STAMP_SHA:0:12}，现在的 HEAD 是 ${HEAD_SHA:0:12} —— 盖戳之后又动了代码，这份没过门。"
  fi
done <<EOF
$TARGETS
EOF

exit 0
