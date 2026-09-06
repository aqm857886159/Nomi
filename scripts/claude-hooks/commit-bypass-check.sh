#!/usr/bin/env bash
# PreToolUse(Bash) hook：**提交阶段**的绕口闸门（2026-09-06）。
#
# 为什么是「拒绝」而不是「留痕」——和 push 那条刻意不同（R28：防线建在最早能拦住的那层）：
#   · commit 阶段拦下的代价是**零**：去掉那几个字符重跑一次，工作树原封不动，没有任何
#     合法场景需要「先偷偷提交、事后解释」。而版本化 pre-commit 干的是敏感数据扫描
#     （scripts/check-no-secrets.mjs：微信聊天记录 / db_key）+ Ponytail 评审（R25）——
#     跳过它 = 敏感数据直接落进 git 历史，**永久**，push 之后就洗不掉了。
#   · push 阶段有合法的并线场景（远落后分支 15-88MB diff 会撞 ponytail ENOBUFS），
#     所以那边是 pre-push-check.sh 留痕 + check:push-bypass 审计，不是拒绝。
#   详见 docs/lessons/commit-bypass-must-be-blocked-not-audited.md。
#
# 起因（2026-09-06 实测）：同一天两个子 agent 各自「习惯性」写出
# `git -c core.hooksPath=.git/hooks commit ...`——等于把版本化 pre-commit 换成了空目录。
# 两次都靠自己发现、自己撤回；纯靠自觉的防线不是防线。
# 现役 secret-guard.sh 只认**子命令上的** `--no-verify` / `-n`，对
# `-c core.hooksPath=` 和 `HUSKY=0` 这类**藏在子命令之外**的写法完全失明。
#
# 判什么：任何会**产生提交**的 git 子命令 + 任一绕过写法 → block(exit 2)。
#   ① `-c core.hooksPath=...`（git 全局选项，把 hook 目录换掉）
#   ② `--no-verify`
#   ③ `-n`（仅 commit：merge/pull 的 -n 是 --no-stat、cherry-pick 的 -n 是 --no-commit，不是绕口）
#   ④ `HUSKY=0` 等 hook 管理器的关闭开关（前置环境赋值）
#   ⑤ `GIT_CONFIG_KEY_*=core.hooksPath` 等环境变量形式的 core.hooksPath 覆盖
#   ⑥ `git commit-tree`（底层管道命令，天生不跑任何 hook——无需任何标志就是绕口）
#
# 命令怎么理解一律走共用词法层（_bash-command-analysis.sh）：引号里的词组不算命令
#（`echo "git commit --no-verify"` 不该被拦），`-m "解释 --no-verify 的提交信息"` 里的
# 提交信息也不算选项（共用层已按 `--` 与「确定带值的选项」跳过其值）。
set +e

INPUT="$(cat)"

# 原始命令只用于两种 fail-closed 判断（读不懂时不许放行），不用于归因。
_raw_cmd="$(printf '%s' "$INPUT" | python3 -c '
import sys,json
try: print(json.load(sys.stdin).get("tool_input",{}).get("command",""))
except: print("")
' 2>/dev/null)"

# 绕过写法的字面痕迹。只在「读不懂命令」时用它兜底拦人。
_smells() {
  printf '%s' "$_raw_cmd" | grep -qE 'core\.hooksPath|--no-verify|HUSKY=|SKIP_SIMPLE_GIT_HOOKS|LEFTHOOK=|commit-tree'
}

block() {
  cat >&2 <<EOF
⛔ 提交闸门：$1

  这条命令会**跳过版本化 pre-commit**——它干两件事：
    ① 敏感数据扫描（scripts/check-no-secrets.mjs）：微信聊天记录 / db_key / 私有配置一旦
       提交进历史就是永久的，push 之后洗不掉；
    ② Ponytail 评审（R25）：只读、限时，发现过度工程化时才记录阻断状态。
  跳过的收益是省几秒，代价是不可逆——所以这里是**拒绝**，不是留痕。
  （push 阶段有合法并线场景，那边才是留痕 + check:push-bypass 审计。）

  正确做法：去掉绕过写法，正常提交。
    git commit -m "..."
  钩子随 checkout 就在（.claude/settings.json 直指 scripts/claude-hooks/，2026-09-07 起不再需要
  pnpm install）；钩子真的坏了 → 修钩子，不是绕开它。
EOF
  exit 2
}

ANALYSIS_LIB="$(dirname "$0")/_bash-command-analysis.sh"
# 共用层缺失 = 失去理解命令的能力。不猜：命令里有绕过痕迹就拦（fail-closed）。
if [ ! -f "$ANALYSIS_LIB" ]; then
  _smells && block "命令理解层 $ANALYSIS_LIB 缺失（它随仓库走，缺了说明工作树不完整），不允许在读不懂的情况下放行。"
  exit 0
fi
# shellcheck source=/dev/null
. "$ANALYSIS_LIB"

PARSED="$(printf '%s' "$INPUT" | analyse_bash_command)"
STATUS="$(printf '%s\n' "$PARSED" | sed -n '1p')"
CALLS="$(printf '%s\n' "$PARSED" | sed -n '3,$p')"

# 词法失败（引号不配对等）= 读不懂。同样 fail-closed。
if [ "$STATUS" != "ok" ]; then
  _smells && block "这条命令无法可靠解析（引号不配对？），但里面出现了绕过钩子的写法——不允许在读不懂的情况下放行。"
  exit 0
fi

[ -n "$CALLS" ] || exit 0   # 没有 git 调用 → 放行（引号里的词组不算）

# 会产生提交的子命令。`stash` / `commit-tree` 之外的低层管道命令不在此列。
is_commit_producing() {
  case "$1" in
    commit|merge|cherry-pick|revert|rebase|am|pull) return 0 ;;
    *) return 1 ;;
  esac
}

# 分隔符**不能直接用 TAB**：tab 属于 IFS whitespace，`read` 会把连续的 tab 折成一个、
# 并吃掉首尾的空字段——于是「选项列为空、配置列有值」的行（`git -c core.hooksPath=… cherry-pick`）
# 会把配置读进选项列，闸门静默漏放。实测三条用例栽在这上面。换成控制字符（非 IFS 空白）
# 后，空列原样保留。
# 也**不能用 \001**：bash 内部拿它当 CTLESC，`read` 会把它直接吃掉而不是拿来分列
#（实测 `a\001b\001\001c` 读成一个字段 `abc`），比 tab 那版更糟——一个字段都不分，
# 于是所有绕口写法全部漏放。用 \037（US，单元分隔符）。
SEP="$(printf '\037')"
while IFS="$SEP" read -r SUB _WHERE FLAGS CONFIGS ENVS; do
  [ -n "$SUB" ] || continue

  # ⑥ commit-tree：底层管道，天生不跑 hook，没有正当用途。
  if [ "$SUB" = "commit-tree" ]; then
    block "\`git commit-tree\` 是底层管道命令，**天生不跑任何 hook**——不需要任何标志就已经是绕口了。"
  fi

  is_commit_producing "$SUB" || continue

  # ① -c core.hooksPath=...
  case ",$CONFIGS," in
    *core.hooksPath*) block "\`git -c core.hooksPath=…\` 把钩子目录换掉了（子命令：$SUB）。" ;;
  esac

  # ④⑤ 前置环境赋值：core.hooksPath 覆盖 / hook 管理器关闭开关
  case ",$ENVS," in
    *core.hooksPath*)
      block "环境变量把 core.hooksPath 覆盖掉了（$ENVS，子命令：$SUB）。" ;;
  esac
  printf '%s\n' "$ENVS" | tr ',' '\n' | grep -qE '^(HUSKY=0?|HUSKY_SKIP_HOOKS=.+|SKIP_SIMPLE_GIT_HOOKS=.+|LEFTHOOK=0|GIT_CLONE_PROTECTION_ACTIVE=.*)$' &&
    block "前置环境赋值关掉了钩子管理器（$ENVS，子命令：$SUB）。"

  # ② --no-verify（任何会产生提交的子命令）
  case ",$FLAGS," in
    *,--no-verify,*) block "\`$SUB --no-verify\` 会跳过 pre-commit。" ;;
  esac

  # ③ -n：只有 commit 的 -n 是 --no-verify。
  if [ "$SUB" = "commit" ] && flag_has "$FLAGS" n --no-verify; then
    block "\`git commit -n\` 就是 \`--no-verify\` 的短写法。"
  fi
done <<EOF
$(printf '%s\n' "$CALLS" | tr '\t' "$SEP")
EOF

exit 0
