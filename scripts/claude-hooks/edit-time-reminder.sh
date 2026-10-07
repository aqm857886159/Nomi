#!/usr/bin/env bash
# PreToolUse hook（Write|Edit）—— 「动手那一刻」的两个提醒，判断全在 scripts/edit-time-reminder.mjs（可被 node-test 直接测）：
#   (a) 在 src/、electron/ 新建文件 → 附接口级「已有能力清单」（scripts/build-capability-index.mjs 现算，来源是
#       docs/engineering/concept-owners/ + framework-boundaries.json，不另起真相源），请回一行「已查过 / 没找到」；
#   (b) 改的文件近 14 天已有 ≥3 次 fix 提交 → 提醒先过重写判据。
# 只提醒、不拦、fail-open。回馈走 JSON 的 hookSpecificOutput.additionalContext（PreToolUse 的普通 stdout 不进上下文）。
# 完整规则见 docs/engineering-rules.md「重写判据」与 R5.3；设计与出处见 docs/research/2026-10-01-ai-collaboration-rules/report.md。
set +e
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -f "$ROOT/scripts/edit-time-reminder.mjs" ] || exit 0
exec node "$ROOT/scripts/edit-time-reminder.mjs"
