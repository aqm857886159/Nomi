#!/usr/bin/env bash
# PreToolUse(Agent)：引用任务书时复用派工检查；缺项阻断，补齐后可重新派线。
command -v node >/dev/null 2>&1 || exit 0
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
node -e '
const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
let prompt
try {
  prompt = JSON.parse(fs.readFileSync(0, "utf8"))?.tool_input?.prompt
} catch { process.exit(0) }
if (typeof prompt !== "string") process.exit(0)
const files = new Set((prompt.match(/\/[^\s\x27"`<>「」]*\.md/g) || []).filter(file => file.includes("/briefs/")))
let blocked = false
for (const file of files) {
  if (!fs.existsSync(file)) continue
  const result = spawnSync(process.execPath, [path.join(process.argv[1], "scripts/check-dispatch-brief.mjs"), file], { encoding: "utf8" })
  if (result.status === 1) {
    process.stderr.write(result.stdout || "")
    process.stderr.write(result.stderr || "")
    blocked = true
  }
}
process.exit(blocked ? 2 : 0)
' "$repo"
