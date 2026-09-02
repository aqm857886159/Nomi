#!/usr/bin/env bash
# violations.log 写入助手（ACE 式 ID + hits 计数 + 结构化 class/status）。
# 「是不是同一个坑/属哪 class」的语义判断由调用者（我 / reflect-and-propose 技能）决定；
# 这里只做确定性的增/改。
# 并发安全：所有写入经 python fcntl.flock 串行化——macOS 无 flock 二进制，故用 fcntl
#   （后端评审 2026-06-27：原版无锁 read-modify-write 全文件重写，并行会话会丢写）。
# 行格式（结构化，向后兼容旧 5 字段平铺行；text 内不得含 '|'）：
#   vNN | hits=N | first=MM-DD | last=MM-DD | <text> [| class=<slug>] [| status=active|dead]
#   缺省 status=active；status=dead 的行 self-check 不再注入（= 软 prune，留历史不删）。
# 用法：
#   viol-add.sh "<一句话坑>" [--class <slug>]   新增 hits=1（自动分配下一个 id）
#   viol-add.sh --bump <id>                      已有坑再犯一次：hits++ 且更新 last
#   viol-add.sh --set <id> <key> <val>           设结构化尾字段（如 --set v03 status dead）
# 方案：docs/plan/2026-06-27-self-improving-control-files-mechanism.md（S1）
set +e
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -z "$ROOT" ] && { echo "no project root"; exit 1; }
LOG="$ROOT/.claude/violations.log"
TODAY=$(date +%m-%d)
touch "$LOG"
command -v python3 >/dev/null 2>&1 || { echo "need python3"; exit 1; }

python3 - "$LOG" "$TODAY" "$@" <<'PY'
import sys, os, fcntl
log, today = sys.argv[1], sys.argv[2]
args = sys.argv[3:]

def parse(ln):
    return [p.strip() for p in ln.split('|')]

lock = open(log + '.lock', 'w')
fcntl.flock(lock, fcntl.LOCK_EX)
try:
    lines = open(log).read().splitlines() if os.path.exists(log) else []

    if args and args[0] == '--bump':
        idv = args[1] if len(args) > 1 else ''
        if not idv:
            print('用法: viol-add.sh --bump <id>'); sys.exit(1)
        found = False
        for i, ln in enumerate(lines):
            p = parse(ln)
            if len(p) >= 5 and p[0] == idv and p[1].startswith('hits='):
                try: h = int(p[1][5:])
                except Exception: h = 1
                p[1] = 'hits=%d' % (h + 1)
                p[3] = 'last=%s' % today
                lines[i] = ' | '.join(p)
                found = True
        msg = ('bumped ' + idv) if found else ('id not found: ' + idv)

    elif args and args[0] == '--set':
        if len(args) < 4:
            print('用法: viol-add.sh --set <id> <key> <val>'); sys.exit(1)
        idv, key, val = args[1], args[2], args[3]
        found = False
        for i, ln in enumerate(lines):
            p = parse(ln)
            if len(p) >= 5 and p[0] == idv:
                head, tail = p[:5], p[5:]
                kv = {}
                for t in tail:
                    if '=' in t:
                        k, _, v = t.partition('='); kv[k.strip()] = v.strip()
                kv[key] = val
                lines[i] = ' | '.join(head + ['%s=%s' % (k, v) for k, v in kv.items()])
                found = True
        msg = ('set %s %s=%s' % (idv, key, val)) if found else ('id not found: ' + idv)

    else:
        text = args[0] if args else ''
        if not text:
            print('用法: viol-add.sh "<坑>" [--class <slug>] | --bump <id> | --set <id> <k> <v>')
            sys.exit(1)
        cls = ''
        if '--class' in args:
            ci = args.index('--class')
            if ci + 1 < len(args): cls = args[ci + 1]
        nums = []
        for ln in lines:
            tok = parse(ln)[0]
            if tok[:1] == 'v' and tok[1:].isdigit(): nums.append(int(tok[1:]))
        nid = 'v%02d' % ((max(nums) if nums else 0) + 1)
        row = '%s | hits=1 | first=%s | last=%s | %s' % (nid, today, today, text)
        if cls: row += ' | class=%s' % cls
        lines.append(row)
        msg = 'added ' + nid

    open(log, 'w').write('\n'.join(lines) + '\n')
    print(msg)
finally:
    fcntl.flock(lock, fcntl.LOCK_UN)
    lock.close()
PY
