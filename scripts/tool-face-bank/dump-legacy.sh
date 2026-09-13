#!/usr/bin/env bash
# 阳性对照臂的量尺：把**旧的 6-action 工具面**从 origin/main 原样取出 dump 成 JSON。
# 本分支已经删掉那两个文件（P1 加新必删旧），所以只能从 origin/main 取——
# 这也保证对照臂量的是真的旧面，不是手抄的近似（docs/lessons/assert-you-are-in-the-situation-you-claim）。
set -e
cd "$(dirname "$0")/../.."
OUT="${1:-/tmp/ot-legacy-tools.json}"
git show origin/main:electron/capabilityCore/mcpIntegrationTools.ts > electron/capabilityCore/.legacy-mcpIntegrationTools.ts
git show origin/main:electron/capabilityCore/mcpIntegrationManagementTools.ts > electron/capabilityCore/.legacy-mcpIntegrationManagementTools.ts
cat > scripts/tool-face-bank/.dump-legacy.ts <<'EOF'
import { MCP_INTEGRATION_TOOL } from '../../electron/capabilityCore/.legacy-mcpIntegrationTools'
import { MCP_INTEGRATION_MANAGEMENT_TOOL } from '../../electron/capabilityCore/.legacy-mcpIntegrationManagementTools'
process.stdout.write(JSON.stringify([MCP_INTEGRATION_TOOL, MCP_INTEGRATION_MANAGEMENT_TOOL], null, 2))
EOF
trap 'rm -f electron/capabilityCore/.legacy-mcpIntegrationTools.ts electron/capabilityCore/.legacy-mcpIntegrationManagementTools.ts scripts/tool-face-bank/.dump-legacy.ts' EXIT
pnpm exec tsx scripts/tool-face-bank/.dump-legacy.ts > "$OUT"
echo "legacy tool face dumped to $OUT"
