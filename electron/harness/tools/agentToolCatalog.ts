import type { ZodTypeAny } from "zod";
import type { RuntimeToolDescriptor } from "../runtime/runtimePort";
import { capabilityAliasesFor, capabilityOperationAliasesFor } from "../../shared/agentCapabilities/registry";
import { CANVAS_READ_CAPABILITY } from "../../shared/agentCapabilities/canvasRead";
import {
  CANVAS_DELETE_CAPABILITY,
  canvasDeletePiDescriptionForAlias,
  canvasDeletePiInputSchema,
} from "../../shared/agentCapabilities/canvasDelete";
import {
  CANVAS_WRITE_CAPABILITY,
  canvasWritePiDescriptionForAlias,
  canvasWritePiInputSchema,
  canvasWritePiInputSchemaForAlias,
} from "../../shared/agentCapabilities/canvasWrite";
import { DOCUMENT_READ_CAPABILITY } from "../../shared/agentCapabilities/documentRead";
import {
  PRODUCTION_ARTIFACT_WRITE_CAPABILITY,
  PRODUCTION_RUN_READ_CAPABILITY,
  PRODUCTION_RUN_WRITE_CAPABILITY,
} from "../../shared/agentCapabilities/productionRun";
import { canvasToolDescriptors } from "./canvasDescriptors";
import { documentToolDescriptors } from "./documentDescriptors";
import { productionRunToolDescriptors } from "./productionRunDescriptors";
import { editingPiDescriptors } from "./editingPiDescriptors";
import { skillToolDescriptors } from "./skillDescriptors";
import { modelToolSurfaceManifest } from "./modelToolSurfaceManifest";

export type AgentToolDescriptor = Readonly<{
  name: string;
  description: string;
  parameters: ZodTypeAny;
}>;

function runtimeDescriptor(descriptor: AgentToolDescriptor): RuntimeToolDescriptor {
  return { name: descriptor.name, description: descriptor.description, schema: descriptor.parameters };
}

function semanticDescriptor(descriptor: (typeof modelToolSurfaceManifest.generation)[number] | (typeof modelToolSurfaceManifest.editing)[number]): AgentToolDescriptor {
  return {
    name: descriptor.name,
    description: descriptor.intent,
    parameters: descriptor.inputSchema,
  };
}

function registryDescriptors(
  capability: typeof CANVAS_WRITE_CAPABILITY,
  descriptionForAlias: (alias: string) => string | undefined,
  schemaForAlias: (alias: string) => ZodTypeAny | undefined,
): AgentToolDescriptor[] {
  return [
    ...capabilityAliasesFor(capability.id, "pi"),
    ...capabilityOperationAliasesFor(capability.id, "pi"),
  ].map((alias) => ({
    name: alias,
    description: descriptionForAlias(alias) ?? capability.projections.pi.description,
    parameters: schemaForAlias(alias) ?? canvasWritePiInputSchema,
  }));
}

const canvasWriteDescriptors = registryDescriptors(
  CANVAS_WRITE_CAPABILITY,
  canvasWritePiDescriptionForAlias,
  canvasWritePiInputSchemaForAlias,
);
const CANVAS_DOMAIN_DESCRIPTOR_NAMES = new Set<string>([
  "propose_storyboard_plan",
  "arrange_storyboard_to_timeline",
  "create_staging_reference",
  "create_camera_move",
]);
// These four descriptors retain their richer domain schemas/descriptions in
// canvasDescriptors.ts.  The registry still owns their executable alias, but
// the catalog must not expose duplicate names with a looser schema.
const canvasWriteCoreDescriptors = canvasWriteDescriptors.filter(
  ({ name }) => !CANVAS_DOMAIN_DESCRIPTOR_NAMES.has(name),
);
if (canvasWriteCoreDescriptors.length !== 4) throw new Error("Missing canvas.write Pi Registry projections");

const canvasDeleteDescriptor: AgentToolDescriptor = {
  name: CANVAS_DELETE_CAPABILITY.aliases.pi,
  description:
    canvasDeletePiDescriptionForAlias(CANVAS_DELETE_CAPABILITY.aliases.pi) ??
    CANVAS_DELETE_CAPABILITY.projections.pi.description,
  parameters: canvasDeletePiInputSchema,
};

function canvasWriteDescriptorFor(name: string): AgentToolDescriptor {
  const descriptor = canvasWriteCoreDescriptors.find((candidate) => candidate.name === name);
  if (!descriptor) throw new Error(`Missing canvas.write descriptor for ${name}`);
  return descriptor;
}

const canvasCoreDescriptors: AgentToolDescriptor[] = [
  canvasToolDescriptors[CANVAS_READ_CAPABILITY.aliases.pi],
  canvasWriteDescriptorFor("set_node_prompt"),
  canvasWriteDescriptorFor("create_canvas_nodes"),
  canvasWriteDescriptorFor("connect_canvas_edges"),
];

const documentReadDescriptors = capabilityAliasesFor(DOCUMENT_READ_CAPABILITY.id, "pi").map((alias) => {
  const descriptor = Object.values(documentToolDescriptors).find((candidate) => candidate.name === alias);
  if (!descriptor) throw new Error(`Missing document tool projection for ${alias}`);
  return descriptor;
});

/**
 * The only model-facing catalog entry point. Domain contracts remain in
 * shared/agentCapabilities; this module only projects them into Pi schemas.
 * Keep array order stable: it is part of the prompt/KV-cache contract.
 */
export const agentToolCatalog = Object.freeze({
  document: Object.freeze([
    ...documentReadDescriptors,
    ...Object.values(documentToolDescriptors).filter((descriptor) => !documentReadDescriptors.includes(descriptor)),
  ]),
  canvas: Object.freeze([
    ...Object.values(canvasToolDescriptors),
    ...canvasWriteCoreDescriptors,
    canvasDeleteDescriptor,
  ]),
  timeline: Object.freeze(Object.values(editingPiDescriptors)),
  production: Object.freeze(Object.values(productionRunToolDescriptors)),
  skills: Object.freeze(Object.values(skillToolDescriptors)),
  generation: Object.freeze(modelToolSurfaceManifest.generation.map(semanticDescriptor)),
});

export const agentToolNames = Object.freeze({
  document: Object.freeze(agentToolCatalog.document.map(({ name }) => name)),
  canvas: Object.freeze(agentToolCatalog.canvas.map(({ name }) => name)),
  timeline: Object.freeze(agentToolCatalog.timeline.map(({ name }) => name)),
  production: Object.freeze(agentToolCatalog.production.map(({ name }) => name)),
  skills: Object.freeze(agentToolCatalog.skills.map(({ name }) => name)),
  generation: Object.freeze(agentToolCatalog.generation.map(({ name }) => name)),
});

export const agentToolProjection = Object.freeze({
  documentRead: Object.freeze(documentReadDescriptors.map(runtimeDescriptor)),
  documentAll: Object.freeze(agentToolCatalog.document.map(runtimeDescriptor)),
  canvasRead: Object.freeze([
    canvasToolDescriptors[CANVAS_READ_CAPABILITY.aliases.pi],
  ].map(runtimeDescriptor)),
  canvasCore: Object.freeze(canvasCoreDescriptors.map(runtimeDescriptor)),
  canvasAll: Object.freeze(agentToolCatalog.canvas.map(runtimeDescriptor)),
  timelineAll: Object.freeze(agentToolCatalog.timeline.map(runtimeDescriptor)),
  productionAll: Object.freeze(agentToolCatalog.production.map(runtimeDescriptor)),
  skills: Object.freeze(agentToolCatalog.skills.map(runtimeDescriptor)),
  generationAll: Object.freeze(agentToolCatalog.generation.map(runtimeDescriptor)),
});

export const productionCapabilityContracts = Object.freeze([
  PRODUCTION_RUN_READ_CAPABILITY,
  PRODUCTION_RUN_WRITE_CAPABILITY,
  PRODUCTION_ARTIFACT_WRITE_CAPABILITY,
]);

export function runtimeToolsForCatalog(
  groups: readonly (keyof typeof agentToolCatalog)[],
): RuntimeToolDescriptor[] {
  return groups.flatMap((group) => agentToolCatalog[group].map(runtimeDescriptor));
}
