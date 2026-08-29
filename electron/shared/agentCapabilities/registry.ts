import { CANVAS_READ_CAPABILITY } from "./canvasRead";
import { DOCUMENT_READ_CAPABILITY, DOCUMENT_READ_ALIASES } from "./documentRead";
import { DOCUMENT_WRITE_ALIASES, DOCUMENT_WRITE_CAPABILITY } from "./documentWrite";
import type { CapabilityContract } from "./capabilityContract";

type AnyCapabilityContract = CapabilityContract<unknown, unknown>;
type ContractOnly<Contract extends AnyCapabilityContract> =
  Exclude<keyof Contract, keyof AnyCapabilityContract> extends never ? Contract : never;
export type ContractOnlyRegistry<Contracts extends readonly AnyCapabilityContract[]> = {
  readonly [Index in keyof Contracts]: Contracts[Index] extends AnyCapabilityContract
    ? ContractOnly<Contracts[Index]>
    : never;
};

const REGISTERED_CONTRACTS = [CANVAS_READ_CAPABILITY, DOCUMENT_READ_CAPABILITY, DOCUMENT_WRITE_CAPABILITY] as const satisfies readonly CapabilityContract<
  unknown,
  unknown
>[];

export const CAPABILITY_CONTRACTS: ContractOnlyRegistry<typeof REGISTERED_CONTRACTS> = REGISTERED_CONTRACTS;

/**
 * All public tool aliases are derived from the canonical registry. Scope aliases
 * such as read_selection do not create a second document contract.
 */
export const CAPABILITY_ALIAS_ENTRIES = Object.freeze([
  ...CAPABILITY_CONTRACTS.flatMap((contract) =>
    Object.entries(contract.aliases).map(([surface, alias]) => ({ contract, surface, alias })),
  ),
  { contract: DOCUMENT_READ_CAPABILITY, surface: "pi", alias: DOCUMENT_READ_ALIASES.selection },
  { contract: DOCUMENT_WRITE_CAPABILITY, surface: "pi", alias: DOCUMENT_WRITE_ALIASES.replace },
  { contract: DOCUMENT_WRITE_CAPABILITY, surface: "pi", alias: DOCUMENT_WRITE_ALIASES.append },
]);

export function resolveCapabilityAlias(alias: string):
  | Readonly<{ contract: (typeof CAPABILITY_CONTRACTS)[number]; surface: string; alias: string }>
  | undefined {
  return CAPABILITY_ALIAS_ENTRIES.find((entry) => entry.alias === alias);
}

export function capabilityAliasesFor(contractId: string, surface: string): readonly string[] {
  return Object.freeze(
    CAPABILITY_ALIAS_ENTRIES
      .filter((entry) => entry.contract.id === contractId && entry.surface === surface)
      .map((entry) => entry.alias),
  );
}
