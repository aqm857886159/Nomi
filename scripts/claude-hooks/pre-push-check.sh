#!/usr/bin/env bash
# PreToolUse hook（命中 Bash 的 `git push`）= push 前的**真闸门**（R11 + P3 决策点强制）。
# 设计见 docs/plan/2026-06-17-discipline-system-overhaul.md（杠杆 1）。
#
# 规则：
#  · 非 git push → 放行（exit 0）。
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
set +e

INPUT="$(cat)"
CMD="$(printf '%s' "$INPUT" | python3 -c 'import sys,json;
try:
    d=json.load(sys.stdin); print(d.get("tool_input",{}).get("command",""))
except Exception:
    print("")' 2>/dev/null)"
HOOK_CWD="$(printf '%s' "$INPUT" | python3 -c 'import sys,json;
try:
    d=json.load(sys.stdin); print(d.get("cwd",""))
except Exception:
    print("")' 2>/dev/null)"

# 只管 git push；其余一律放行。
printf '%s' "$CMD" | grep -Eq 'git[[:space:]]+push' || exit 0

# **推送发生在哪棵树，就查哪棵树**：命令形如 `cd <path> && git push ...` 时以那个目录为准；
# 没写 cd 就用 hook 报的 cwd，再退到会话目录。
# 为什么不能只信 CLAUDE_PROJECT_DIR：它固定指向**会话**那棵 worktree，而这台机器常有 20+ 棵并行。
CD_TARGET="$(printf '%s' "$CMD" | sed -n 's/^[[:space:]]*cd[[:space:]]\{1,\}\([^&;|]*\).*/\1/p' | head -1 | sed 's/[[:space:]]*$//' | tr -d "\"'")"
ROOT=""
for CANDIDATE in "$CD_TARGET" "$HOOK_CWD" "$CLAUDE_PROJECT_DIR" "$PWD"; do
  [ -n "$CANDIDATE" ] && [ -d "$CANDIDATE" ] || continue
  ROOT="$(cd "$CANDIDATE" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)"
  [ -n "$ROOT" ] && break
done
[ -z "$ROOT" ] && exit 0   # 拿不到根 → 放行

cd "$ROOT" 2>/dev/null || exit 0
GITDIR="$(git rev-parse --absolute-git-dir 2>/dev/null)"
[ -z "$GITDIR" ] && exit 0
MARKER="$GITDIR/nomi-gates-ok"

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

# 没有 outgoing commits（已同步/无新提交）→ push 是 no-op，放行。
git rev-parse origin/main >/dev/null 2>&1 && [ -z "$(git log origin/main..HEAD --oneline 2>/dev/null)" ] && exit 0

# outgoing 改动全是 doc/hook → 放行。拿不到文件列表就继续往下验戳（不放行也不误杀）。
is_docs_only "$(git diff --name-only origin/main...HEAD 2>/dev/null)" && exit 0

# —— 到这里 = 有代码改动，开始验戳：三项全对才放行 ——
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

exit 0
