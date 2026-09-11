/**
 * 审计工具（2026-09-11）：把两个 profile 的模型工具面 dump 成 JSON。
 * 跑法：pnpm exec tsx docs/audit/2026-09-11-model-tool-face/dump.mts
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  MODEL_FACING_TOOL_SPECS,
  modelFacingToolSpecs,
  mcpProfileTools,
} from "../../../electron/shared/agentCapabilities/modelFacingToolRegistry.js";
import { toPublishedJsonSchema } from "../../../electron/shared/agentCapabilities/modelVisibleJsonSchema.js";

const here = dirname(fileURLToPath(import.meta.url));

function specJson(spec: (typeof MODEL_FACING_TOOL_SPECS)[number]) {
  let schema: unknown;
  try {
    schema = toPublishedJsonSchema(spec.schema);
  } catch (error) {
    schema = { __error: String(error) };
  }
  return {
    name: spec.name,
    contractId: spec.contractId,
    internalGroup: spec.internalGroup ?? null,
    description: spec.description,
    promptSnippet: spec.promptSnippet,
    promptGuidelines: spec.promptGuidelines ?? [],
    effects: spec.effects,
    execution: spec.execution,
    aliasBoundInput: spec.aliasBoundInput ?? {},
    profiles: spec.profiles ?? ["internal", "mcp"],
    mcpTransportFields: spec.mcpTransportFields ?? {},
    hasPrepareArguments: typeof spec.prepareArguments === "function",
    examples: spec.examples,
    schema,
  };
}

const internal = modelFacingToolSpecs("internal").map(specJson);
const mcpSpecs = modelFacingToolSpecs("mcp").map(specJson);
const external = mcpProfileTools().map((tool) => ({
  name: tool.name,
  contractId: tool.contractId,
  description: tool.description,
  discriminators: tool.discriminators,
  transportOnlyFields: tool.transportOnlyFields,
  annotations: tool.annotations ?? null,
  inputSchema: tool.inputSchema,
  composedFromAliases: tool.specs.map((s) => s.name),
}));

writeFileSync(
  join(here, "internal.json"),
  JSON.stringify({ profile: "internal", count: internal.length, tools: internal }, null, 2) + "\n",
);
writeFileSync(
  join(here, "external.json"),
  JSON.stringify(
    { profile: "mcp", publishedToolCount: external.length, aliasSpecCount: mcpSpecs.length, tools: external, aliasSpecs: mcpSpecs },
    null,
    2,
  ) + "\n",
);
console.log(`internal aliases: ${internal.length}`);
console.log(`mcp alias specs: ${mcpSpecs.length}; published mcp tools: ${external.length}`);
console.log(`total registry specs: ${MODEL_FACING_TOOL_SPECS.length}`);
