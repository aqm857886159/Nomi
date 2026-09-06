#!/usr/bin/env bash
# PreToolUse(Bash) 闸门共用的**命令理解层**（2026-09-02）。
#
# 为什么要有它：两个 Bash 闸门（pre-push-check.sh 认推送、secret-guard.sh 认
# `commit --no-verify` / `add -f`）此前各自用正则在字符层面近似 shell 语义，
# 于是犯了**同一类错**，实测各自都两个方向全漏：
#   · 漏判——`git -C <path> ...` / `git -c k=v ...` / `git --no-pager ...`：git 与子命令之间
#     隔了全局选项，正则要求二者紧邻，于是整条命令隐身、闸门根本不运行（无声）；
#   · 误伤——`echo "git push"` / `grep -rn "git commit --no-verify"`：正则看不见引号边界，
#     把数据当成了命令。会误报的闸门用不了几次就会被人绕过。
# 注：上面两条都是 2026-09-02 实测记录，不是假想。
#
# 根因是**用正则理解 shell 语法**。正解是做一次真正的词法分析，并且只做一次：
# 命令怎么理解这件事收敛到本文件，闸门各自只消费结果、不再碰命令字符串。
#
# 输出契约（行式，避免在 bash 3.2 上依赖 mapfile）：
#   第 1 行：ok | unparsable
#   第 2 行：hook 报的 cwd
#   第 3 行起：每个 git 调用一行，制表符分隔五列——
#       <子命令>\t<该调用发生的目录，`?` = 无法可靠还原>\t<该子命令的选项，逗号分隔>
#       \t<git 全局 `-c k=v` / `--config-env=` 配置，逗号分隔>\t<命令前置的环境赋值，逗号分隔>
#
# 消费方按需过滤：pre-push 只看 push 行取目录；secret-guard 只看 commit/add 行取选项；
# commit-bypass-check 还要看第 4、5 列（`-c core.hooksPath=` 与 `HUSKY=0` 这类**藏在
# 子命令之外**的绕过写法——它们不出现在选项列里，只看第 3 列的闸门对它们完全失明）。
#
# 2026-09-06 补第 4、5 列 + 选项参数跳过（第 3 列）：
#   · 第 3 列此前把「所有以 `-` 开头的 token」都当选项，于是 `git commit -m "--no-verify"`
#     （提交信息里恰好写了这个词）被读成带 `--no-verify` 的提交——**误伤**。现在 `-m` 这类
#     确定带值的选项，其后一个 token 一律跳过；`--` 之后全是 pathspec，也不再进选项列。
#     只跳「确定带值」的那几个：`-s` 在 commit 是 --short（不带值）、在 merge 是 --strategy
#     （带值），一律跳会把 `git commit -s --no-verify` 的 `--no-verify` 吞掉——那是**漏放**，
#     比误伤更糟。所以 `-s` 不在名单里，`--strategy` 在。
#   · 第 4、5 列此前被直接丢弃（`-c k=v` 走 `j += 2` 消费掉、`FOO=bar` 走 `continue`）。

# 用法：ANALYSIS="$(printf '%s' "$INPUT" | analyse_bash_command)"
# 注意：下面的 python 被单引号包住，代码里**不能出现单引号**。
analyse_bash_command() {
  python3 -c '
import sys, json, shlex, os

GLOBAL_TAKES_ARG = ("-C", "-c", "--config-env", "--exec-path", "--namespace")
OPAQUE_TAKES_ARG = ("--git-dir", "--work-tree")
GLOBAL_FLAGS = ("--no-pager", "-p", "--paginate", "--bare", "--literal-pathspecs",
                "--no-literal-pathspecs", "--glob-pathspecs", "--icase-pathspecs",
                "--no-replace-objects", "--no-optional-locks", "--no-lazy-fetch", "--no-advice")
WRAPPERS = ("sudo", "nohup", "env", "time", "command", "stdbuf", "nice", "then", "do", "else")
OPERATORS = ("&&", "||", ";", "|", "(", ")", "&", "{", "}")
# 子命令层面**确定带一个独立值**的选项：其后一个 token 是数据不是选项。
# 只收确定的——宁可漏跳（多出一个误伤面）也不能错跳（会把真选项吞掉 = 漏放）。
SUB_TAKES_ARG = ("-m", "--message", "-F", "--file", "-t", "--template",
                 "-C", "--reuse-message", "-c", "--reedit-message",
                 "--author", "--date", "--fixup", "--squash", "--cleanup",
                 "--trailer", "--pathspec-from-file", "--strategy",
                 "--strategy-option", "-X")
# 短选项簇（`-am "msg"`）：簇里带值的那个必须排在最后，所以只看末位字母。
SHORT_TAKES_ARG = "mFtCcX"

def resolve(base, p):
    p = os.path.expanduser(p)
    if os.path.isabs(p):
        return os.path.normpath(p)
    return os.path.normpath(os.path.join(base, p))

def analyse(command, cwd):
    lex = shlex.shlex(command, posix=True, punctuation_chars=True)
    lex.whitespace_split = True
    tokens = list(lex)
    calls = []
    cur = cwd
    at_cmd = True
    pending_env = []
    i = 0
    n = len(tokens)
    while i < n:
        tok = tokens[i].strip("`")
        if tok in OPERATORS:
            at_cmd = True
            pending_env = []
            i += 1
            continue
        if not at_cmd:
            i += 1
            continue
        if tok in WRAPPERS:
            i += 1
            continue
        head = tok.split("=")[0]
        if "=" in tok and head and head.replace("_", "").isalnum() and not head[0].isdigit():
            pending_env.append(tok)   # FOO=bar git ... 这类前置赋值，命令位置保持不变
            i += 1
            continue
        base = os.path.basename(tok)
        if base in ("cd", "pushd"):
            if i + 1 < n and tokens[i + 1] not in OPERATORS and not tokens[i + 1].startswith("-"):
                cur = resolve(cur, tokens[i + 1])
                i += 2
            else:
                cur = os.path.expanduser("~")
                i += 1
            at_cmd = False
            continue
        if base == "git":
            j = i + 1
            dash_c = None
            opaque = False
            configs = []
            while j < n:
                t = tokens[j]
                if t == "-C" and j + 1 < n:
                    dash_c = tokens[j + 1]; j += 2; continue
                if t in OPAQUE_TAKES_ARG and j + 1 < n:
                    opaque = True; j += 2; continue
                if t in GLOBAL_TAKES_ARG and j + 1 < n:
                    # `-c k=v` / `--config-env k=ENVVAR` 的**值**就是配置本身，别再丢掉。
                    if t in ("-c", "--config-env"):
                        configs.append(tokens[j + 1])
                    j += 2; continue
                if t in GLOBAL_FLAGS:
                    j += 1; continue
                # Git accepts `--no-verify` before `push`; recognize this
                # push-only spelling without making secret-guard miss
                # `git --no-verify commit`.
                if t == "--no-verify" and j + 1 < n and tokens[j + 1] == "push":
                    j += 1; continue
                if t.startswith("--") and "=" in t:
                    if t.split("=")[0] in OPAQUE_TAKES_ARG:
                        opaque = True
                    if t.split("=")[0] == "--config-env":
                        configs.append(t.split("=", 1)[1])
                    j += 1; continue
                break
            if j < n and not tokens[j].startswith("-"):
                sub = tokens[j]
                flags = []
                k = j + 1
                end_of_options = False
                while k < n and tokens[k] not in OPERATORS:
                    t = tokens[k]
                    if end_of_options:
                        k += 1; continue
                    if t == "--":
                        end_of_options = True   # 之后全是 pathspec，不是选项
                        k += 1; continue
                    if t.startswith("-"):
                        flags.append(t)
                        takes = t in SUB_TAKES_ARG
                        if not takes and not t.startswith("--") and len(t) > 1 and t[-1] in SHORT_TAKES_ARG:
                            takes = True        # `-am "msg"`：簇末位才是带值的那个
                        if takes and k + 1 < n:
                            k += 2              # 跳过它的值（提交信息等数据，不是选项）
                            continue
                    k += 1
                where = "?" if opaque else (resolve(cur, dash_c) if dash_c else cur)
                calls.append((sub, where, ",".join(flags), ",".join(configs), ",".join(pending_env)))
                i = k
            else:
                i = j + 1 if j < n else n
            at_cmd = False
            pending_env = []
            continue
        at_cmd = False
        pending_env = []
        i += 1
    return calls

try:
    d = json.load(sys.stdin)
    cwd = d.get("cwd", "") or ""
    command = d.get("tool_input", {}).get("command", "") or ""
except Exception:
    print("unparsable"); print(""); sys.exit(0)

try:
    calls = analyse(command, cwd)
except Exception:
    # 引号不配对等词法失败：不猜，交给各闸门按自己的 fail 策略处理
    print("unparsable"); print(cwd); sys.exit(0)

print("ok")
print(cwd)
for sub, where, flags, configs, envs in calls:
    sys.stdout.write(sub + "\t" + where + "\t" + flags + "\t" + configs + "\t" + envs + "\n")
' 2>/dev/null
}

# 短选项簇里是否含某个字母（`-nm` 含 n、`-am` 不含）。长选项直接整串比。
# 用法：flag_has "$FLAGS" n --no-verify
flag_has() {
  _flags="$1"; _short="$2"; _long="$3"
  printf '%s\n' "$_flags" | tr ',' '\n' | while IFS= read -r f; do
    [ -z "$f" ] && continue
    [ "$f" = "$_long" ] && echo hit && continue
    case "$f" in
      --*) ;;
      -*) case "${f#-}" in *"$_short"*) echo hit ;; esac ;;
    esac
  done | grep -q hit
}
