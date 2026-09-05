import { ASSET_READ_CAPABILITY } from "./assetRead";
import { CANVAS_DELETE_CAPABILITY } from "./canvasDelete";
import { CANVAS_READ_CAPABILITY } from "./canvasRead";
import { CANVAS_WRITE_CAPABILITY } from "./canvasWrite";
import { DOCUMENT_READ_CAPABILITY } from "./documentRead";
import { DOCUMENT_WRITE_CAPABILITY } from "./documentWrite";
import { EXPORT_READ_CAPABILITY, EXPORT_WRITE_CAPABILITY } from "./exportCapabilities";
import { TIMELINE_READ_CAPABILITY } from "./timelineRead";
import { TIMELINE_WRITE_CAPABILITY } from "./timelineWrite";
import { LAYOUT_READ_CAPABILITY, LAYOUT_WRITE_CAPABILITY } from "./layout";
import {
  GENERATION_CONTEXT_READ_CAPABILITY,
  GENERATION_PLAN_CAPABILITY,
  GENERATION_GATE_CAPABILITY,
  GENERATION_RUN_READ_CAPABILITY,
  GENERATION_CONTROL_CAPABILITY,
} from "./generation";
import {
  PRODUCTION_ARTIFACT_WRITE_CAPABILITY,
  PRODUCTION_RUN_READ_CAPABILITY,
  PRODUCTION_RUN_WRITE_CAPABILITY,
} from "./productionRun";
import { SKILL_WRITE_CAPABILITY } from "./skillWrite";
import { SKILL_READ_CAPABILITY } from "./skillRead";
import type { CapabilityContract, CapabilityEffectClass, CapabilityProjectionSurface } from "./capabilityContract";

type AnyCapabilityContract = CapabilityContract<unknown, unknown>;
type ContractOnly<Contract extends AnyCapabilityContract> =
  Exclude<keyof Contract, keyof AnyCapabilityContract> extends never ? Contract : never;
export type ContractOnlyRegistry<Contracts extends readonly AnyCapabilityContract[]> = {
  readonly [Index in keyof Contracts]: Contracts[Index] extends AnyCapabilityContract
    ? ContractOnly<Contracts[Index]>
    : never;
};

const REGISTERED_CONTRACTS = [
  ASSET_READ_CAPABILITY,
  CANVAS_DELETE_CAPABILITY,
  CANVAS_READ_CAPABILITY,
  CANVAS_WRITE_CAPABILITY,
  DOCUMENT_READ_CAPABILITY,
  DOCUMENT_WRITE_CAPABILITY,
  EXPORT_READ_CAPABILITY,
  EXPORT_WRITE_CAPABILITY,
  TIMELINE_READ_CAPABILITY,
  TIMELINE_WRITE_CAPABILITY,
  LAYOUT_READ_CAPABILITY,
  LAYOUT_WRITE_CAPABILITY,
  PRODUCTION_RUN_READ_CAPABILITY,
  PRODUCTION_RUN_WRITE_CAPABILITY,
  PRODUCTION_ARTIFACT_WRITE_CAPABILITY,
  SKILL_READ_CAPABILITY,
  SKILL_WRITE_CAPABILITY,
  GENERATION_CONTEXT_READ_CAPABILITY,
  GENERATION_PLAN_CAPABILITY,
  GENERATION_GATE_CAPABILITY,
  GENERATION_RUN_READ_CAPABILITY,
  GENERATION_CONTROL_CAPABILITY,
] as const satisfies readonly CapabilityContract<unknown, unknown>[];

export const CAPABILITY_CONTRACTS: ContractOnlyRegistry<typeof REGISTERED_CONTRACTS> = REGISTERED_CONTRACTS;

function aliasEntriesFor<Contract extends AnyCapabilityContract>(contract: Contract) {
  const contractView: AnyCapabilityContract = contract;
  return Object.entries(contractView.aliases).flatMap(([surface, alias]) => {
    if (!alias) return [];
    const additional = contractView.additionalAliases?.[surface as CapabilityProjectionSurface] ?? [];
    return [
      { contract, surface, alias },
      ...additional.map((additionalAlias) => ({ contract, surface, alias: additionalAlias })),
    ];
  });
}

/**
 * All public tool aliases are derived from the canonical registry. Scope aliases
 * such as read_selection do not create a second document contract.
 */
export const CAPABILITY_ALIAS_ENTRIES = Object.freeze([...CAPABILITY_CONTRACTS.flatMap(aliasEntriesFor)]);

export function resolveCapabilityAlias(
  alias: string,
): Readonly<{ contract: (typeof CAPABILITY_CONTRACTS)[number]; surface: string; alias: string }> | undefined {
  return CAPABILITY_ALIAS_ENTRIES.find((entry) => entry.alias === alias);
}

/** True when the descriptor says its payload is a plan the user must read first. */
export function capabilityRequiresPlanReview(toolName: string): boolean {
  return (resolveCapabilityAlias(toolName)?.contract as AnyCapabilityContract | undefined)?.requiresPlanReview === true;
}

/** Resolve side-effect policy from the descriptor and its explicit operation map. */
export function resolveCapabilityEffectClass(
  toolName: string,
  args?: unknown,
): CapabilityEffectClass | undefined {
  const resolved = resolveCapabilityAlias(toolName);
  if (!resolved) return undefined;
  const operation = args && typeof args === "object" && !Array.isArray(args)
    ? (args as Record<string, unknown>).operation
    : undefined;
  if (typeof operation === "string") {
    const contract = resolved.contract as AnyCapabilityContract;
    return contract.operationEffectClasses
      ? contract.operationEffectClasses[operation]
      : contract.effectClass;
  }
  return resolved.contract.effectClass;
}

export function capabilityAliasesFor(contractId: string, surface: string): readonly string[] {
  return Object.freeze(
    CAPABILITY_ALIAS_ENTRIES.filter((entry) => {
      const primaryAliases = new Set<string>(Object.values(entry.contract.aliases));
      return entry.contract.id === contractId && entry.surface === surface && primaryAliases.has(entry.alias);
    }).map((entry) => entry.alias),
  );
}

export function capabilityOperationAliasesFor(contractId: string, surface: string): readonly string[] {
  return Object.freeze(
    CAPABILITY_ALIAS_ENTRIES.filter((entry) => {
      const primaryAliases = new Set<string>(Object.values(entry.contract.aliases));
      return entry.contract.id === contractId && entry.surface === surface && !primaryAliases.has(entry.alias);
    }).map((entry) => entry.alias),
  );
}
