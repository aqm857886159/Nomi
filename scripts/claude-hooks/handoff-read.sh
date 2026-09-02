#!/usr/bin/env bash
# SessionStart hook —— 新会话/恢复时，若存在 24h 内的交接卡，注入回上下文。
# stdout 在 SessionStart 会被 harness 注入。配 handoff-write.sh 形成「自动接力」。
# 方案：docs/plan/2026-06-21-context-handoff-and-self-iterating-control-files.md（S1）
set +e
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -z "$ROOT" ] && exit 0
CARD="$ROOT/.claude/handoff/latest.md"
[ -f "$CARD" ] || exit 0

NOW=$(date +%s)
MOD=$(stat -f %m "$CARD" 2>/dev/null || stat -c %Y "$CARD" 2>/dev/null)
[ -z "$MOD" ] && exit 0
AGE=$(( (NOW - MOD) / 3600 ))
# 过期（>24h）不打扰
[ "$AGE" -gt 24 ] && exit 0

echo "🧭 接上次进度（约 ${AGE}h 前自动压缩时生成的交接卡；若已过时就忽略）："
echo ""
cat "$CARD"
exit 0
