#!/usr/bin/env bash
# PreCompact hook —— 仅在「自动压缩」前一刻，把当前会话浓缩成一张交接卡落盘。
# 手动 /compact 视为用户主动操作，不打扰。供 handoff-read.sh 在新会话注入。
#
# 设计说明（2026-06-21）：原计划 spawn `claude -p` 生成卡片，但本 app 环境注入
# ANTHROPIC_AUTH_TOKEN（会话级 scoped token），子进程 claude -p 用它打 API 会 401。
# 故改为「确定性提取」——零认证零依赖、100% 可靠：抽「你最近提的几条 + 我上次停在哪」，
# 这正是手动「吐 context」会吐的东西。不引入会写出错误内容的 LLM 路径（P1/P2）。
# 方案：docs/plan/2026-06-21-context-handoff-and-self-iterating-control-files.md（S1）
set +e
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -z "$ROOT" ] && exit 0

INPUT=$(cat)
TRIGGER=$(printf '%s' "$INPUT" | jq -r '.trigger // empty' 2>/dev/null)
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)

# 只在自动压缩时接力
[ "$TRIGGER" != "auto" ] && exit 0
{ [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; } && exit 0
command -v python3 >/dev/null 2>&1 || exit 0

DIR="$ROOT/.claude/handoff"
mkdir -p "$DIR"
TS=$(date +%Y%m%d-%H%M%S)

CARD=$(python3 - "$TRANSCRIPT" "$TS" <<'PY'
import json, sys

path, ts = sys.argv[1], sys.argv[2]
users, last_assistant = [], ''
try:
    for line in open(path):
        line = line.strip()
        if not line:
            continue
        try:
            o = json.loads(line)
        except Exception:
            continue
        msg = o.get('message') or o
        role = msg.get('role') or o.get('type')
        if role not in ('user', 'assistant'):
            continue
        content = msg.get('content')
        txt = ''
        if isinstance(content, str):
            txt = content
        elif isinstance(content, list):
            for b in content:
                if isinstance(b, dict) and b.get('type') == 'text':
                    txt += b.get('text', '')
        txt = ' '.join(txt.split())
        if not txt:
            continue
        if role == 'user':
            # 跳过明显是 hook/系统注入的噪音
            if txt.startswith(('⚠️', '【三闸', 'UserPromptSubmit', '<')):
                continue
            users.append(txt)
        else:
            last_assistant = txt
except Exception:
    pass

if not users and not last_assistant:
    sys.exit(0)

out = ['# 上次会话交接卡（%s · 自动压缩前生成）' % ts, '']
out.append('## 最近你提的（新在下）')
for u in users[-10:]:
    out.append('- ' + (u[:160] + ('…' if len(u) > 160 else '')))
out.append('')
out.append('## 我上次停在')
out.append((last_assistant[:700] + ('…' if len(last_assistant) > 700 else '')) if last_assistant else '（无）')
print('\n'.join(out))
PY
)
[ -z "$CARD" ] && exit 0

printf '%s\n' "$CARD" > "$DIR/latest.md"
cp "$DIR/latest.md" "$DIR/$TS.md" 2>/dev/null
exit 0
