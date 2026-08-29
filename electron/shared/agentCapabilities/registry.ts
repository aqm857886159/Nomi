import { CANVAS_READ_CAPABILITY } from "./canvasRead";
import { CANVAS_WRITE_CAPABILITY } from "./canvasWrite";
import { DOCUMENT_READ_CAPABILITY } from "./documentRead";
import { DOCUMENT_WRITE_CAPABILITY } from "./documentWrite";
import { TIMELINE_READ_CAPABILITY } from "./timelineRead";
import { TIMELINE_WRITE_CAPABILITY } from "./timelineWrite";
import type { CapabilityContract, CapabilityProjectionSurface } from "./capabilityContract";

type AnyCapabilityContract = CapabilityContract<unknown, unknown>;
type ContractOnly<Contract extends AnyCapabilityContract> =
  Exclude<keyof Contract, keyof AnyCapabilityContract> extends never ? Contract : never;
export type ContractOnlyRegistry<Contracts extends readonly AnyCapabilityContract[]> = {
  readonly [Index in keyof Contracts]: Contracts[Index] extends AnyCapabilityContract
    ? ContractOnly<Contracts[Index]>
    : never;
};

const REGISTERED_CONTRACTS = [
  CANVAS_READ_CAPABILITY,
  CANVAS_WRITE_CAPABILITY,
  DOCUMENT_READ_CAPABILITY,
  DOCUMENT_WRITE_CAPABILITY,
  TIMELINE_READ_CAPABILITY,
  TIMELINE_WRITE_CAPABILITY,
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
