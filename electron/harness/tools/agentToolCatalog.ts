import type { ZodTypeAny } from "zod";
import type { RuntimeToolDescriptor } from "../runtime/runtimePort";
import {
  PRODUCTION_ARTIFACT_WRITE_CAPABILITY,
  PRODUCTION_RUN_READ_CAPABILITY,
  PRODUCTION_RUN_WRITE_CAPABILITY,
} from "../../shared/agentCapabilities/productionRun";
import { productionRunToolDescriptors } from "./productionRunDescriptors";
import { editingPiDescriptors } from "./editingPiDescriptors";
import { skillToolDescriptors } from "./skillDescriptors";
import { modelToolSurfaceManifest, type SemanticToolDescriptor } from "./modelToolSurfaceManifest";

export type AgentToolDescriptor = Readonly<{
  name: string;
  description: string;
  parameters: ZodTypeAny;
}>;

function runtimeDescriptor(descriptor: AgentToolDescriptor): RuntimeToolDescriptor {
  return { name: descriptor.name, description: descriptor.description, schema: descriptor.parameters };
}

function semanticDescriptor(descriptor: SemanticToolDescriptor): AgentToolDescriptor {
  return {
    name: descriptor.name,
    description: descriptor.intent,
    parameters: descriptor.inputSchema,
  };
}

/**
 * The only model-facing catalog entry point. Domain contracts remain in
 * shared/agentCapabilities; this module only projects them into Pi schemas.
 * Keep array order stable: it is part of the prompt/KV-cache contract.
 */
export const agentToolCatalog = Object.freeze({
  document: Object.freeze(modelToolSurfaceManifest.document.map(semanticDescriptor)),
  canvas: Object.freeze(modelToolSurfaceManifest.canvas.map(semanticDescriptor)),
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
  documentRead: Object.freeze(agentToolCatalog.document.filter(({ name }) => name === "nomi_document_read").map(runtimeDescriptor)),
  documentAll: Object.freeze(agentToolCatalog.document.map(runtimeDescriptor)),
  canvasRead: Object.freeze(agentToolCatalog.canvas.filter(({ name }) => name === "nomi_canvas_read").map(runtimeDescriptor)),
  canvasCore: Object.freeze(agentToolCatalog.canvas.filter(({ name }) => ["nomi_canvas_read", "nomi_canvas_plan", "nomi_canvas_edit"].includes(name)).map(runtimeDescriptor)),
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
