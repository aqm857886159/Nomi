import { CAPABILITY_CONTRACTS, capabilityAliasesFor, capabilityOperationAliasesFor } from "../../../electron/shared/agentCapabilities/registry.js";
import { MODEL_FACING_TOOL_SPECS } from "../../../electron/shared/agentCapabilities/modelFacingToolRegistry.js";
const specNames = new Set(MODEL_FACING_TOOL_SPECS.map(s => s.name));
const rows: string[] = [];
for (const c of CAPABILITY_CONTRACTS) {
  for (const surface of ["pi", "mcp"] as const) {
    const all = [...capabilityAliasesFor(c.id, surface), ...capabilityOperationAliasesFor(c.id, surface)];
    for (const a of all) {
      const inSpecs = specNames.has(a);
      rows.push(`${inSpecs ? "  ok " : "GHOST"} ${surface.padEnd(4)} ${a.padEnd(36)} ${c.id}  effect=${c.effect}`);
    }
  }
  const proj = (c as any).projections;
  if (proj?.pi?.description) rows.push(`  PROJDESC pi   ${c.id}: ${JSON.stringify(proj.pi.description)}`);
  if (proj?.mcp?.description) rows.push(`  PROJDESC mcp  ${c.id}: ${JSON.stringify(proj.mcp.description)}`);
}
console.log(rows.join("\n"));
console.log(`\ncontracts: ${CAPABILITY_CONTRACTS.length}, specs: ${MODEL_FACING_TOOL_SPECS.length}`);
